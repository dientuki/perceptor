---
title: Per-Episode Acquisition (Search, Magnet, File) — api slice
service: api
last_updated: 2026-08-13
status: Approved
---

# PLAN: Per-Episode Acquisition — `api` (`api/plan.md`)

## Scope

This slice owns everything between the user's click and the `bull:process` job: a new `episodes/`
module exposing `addTorrentToEpisode`/`addMagnetToEpisode`, an episode-capable upload ticket and tus
finish hook, and the episode branches in the two callbacks that already exist for films
(`torrentCompleted`, `sourceScanned`). It also owns one surgical fix to working `movies/` code: the
`infoHash` collision guard, which becomes unsound the moment an episode can own a `MediaSource`.

It does **not** own: which file inside a downloaded release belongs to which episode, the series
output path, or the encode itself — all of that is `services/worker` and has its own future spec
(`../spec.md` § Out of Scope). It does not own any `web` change.

There is no migration in this feature. Every column already exists.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/movies/movies.service.ts` | Modified | `attachTorrentSource`'s collision guard must recognise a `MediaSource` owned by an **episode**, not only by a movie. Nothing else in this file changes. |
| `src/episodes/episodes.module.ts` | New | Imports `SettingsModule` (for `QbittorrentClient`); provides + exports `EpisodesService`. |
| `src/episodes/episodes.service.ts` | New | `findOneFromDb`, `addTorrentToEpisode`, `addMagnetToEpisode`, private `attachTorrentSource`. |
| `src/episodes/episodes.resolver.ts` | New | `@Resolver(() => Episode)` with the two mutations. No queries — `show(id)` already returns episodes. |
| `src/episodes/episodes.service.spec.ts` | New | Article IX suite. See § Tests. |
| `src/app.module.ts` | Modified | Register `EpisodesModule`. |
| `src/uploads/uploads.resolver.ts` | Modified | `createUploadTicket` takes two nullable args, exactly one required; ownership check branches by which. |
| `src/uploads/upload-tickets.service.ts` | Modified | Payload gains `episodeId`; `mint`/`verifyAndSpend` bind to whichever entity the ticket is for. |
| `src/uploads/uploads.service.ts` | Modified | `onUploadCreate` and `handleUploadFinish` read `episodeId` beside `movieId`; the finish path writes an episode-owned `MediaSource`. |
| `src/uploads/uploads.module.ts` | Modified | Import `EpisodesModule` alongside the existing `MoviesModule`. |
| `src/downloads/downloads.service.ts` | Modified | `include` gains `episode`; an episode moves to `ENCODING`; an `ERROR` source is not acted on. |
| `src/media-sources/media-sources.service.ts` | Modified | `SourceFile` upsert stamps `episodeId`; the `matchedFilePath === null` branch marks the `Episode` `ERROR`. |

`src/schema.gql` regenerates itself on boot. Never hand-edit it (Constitution, Article IV) — but do
diff it afterwards against `../spec.md` § GraphQL Contract Delta; that diff is the proof the
contract was honoured.

## Existing code to reuse

- **`src/movies/movies.service.ts:270` `attachTorrentSource`** — the reference implementation.
  `EpisodesService`'s equivalent is its structural twin, deliberately parallel rather than extracted
  (reasoning in `../plan.md` § Approach). Read it first; keep the same ordering, including the one
  that matters: `qbittorrent.add()` runs **before** any DB write, so a torrent qBittorrent refuses
  leaves no `QUEUED` row behind.
- **`src/clients/torrent/magnet.ts` `parseMagnet`** — pure, already tested
  (`magnet.spec.ts`), already produces the three magnet error strings in the contract. Wrap it in
  `BadRequestException` exactly as `addMagnetToMovie` does. Do not re-parse magnets by hand.
- **`src/clients/torrent/client.ts` `QbittorrentClient.add(urls)`** — returns the per-download
  savepath and throws `qBittorrent rechazó el torrent (<status>)` before any DB write. Exported by
  `SettingsModule`, so importing that module is the whole wiring; do not add it as a provider.
- **`src/shows/shows.service.ts:53` `findOneFromDb`** — the ownership-scoped `findFirst` shape.
  `EpisodesService.findOneFromDb` is the same idea one relation deeper:
  `episode.findFirst({ where: { id, season: { show: { users: { some: { userId } } } } } })`.
  Reuse the clause shape; do not invent a second way to express ownership.
- **`src/shows/entities/episode.entity.ts`** — the `Episode` `@ObjectType` already exists
  (`009-show-detail`). Import it. Declaring a second `@ObjectType()` for the same schema type name
  is a boot-time collision.
- **`src/uploads/upload-tickets.service.ts` `verifyAndSpend`** — note the ordering its comment
  defends: the target check runs **before** the Redis spend, so a mismatched ticket is not burned.
  Preserve that when the check becomes "matches whichever entity this ticket is for."
- **`src/media-sources/media-sources.service.ts:119-128`** — already writes
  `episodeId: mediaSource.episodeId` onto the `ProcessJob`. The gap is two lines up (the
  `SourceFile` upsert) and in the null-match branch. Extend; do not rewrite the method.
- **`src/auth/decorators/current-user.decorator.ts`** and the
  `principal.type === 'user' ? principal.id : ''` narrowing used across `ShowsResolver` — copy it.
  Neither new mutation gets `@AllowService()`.

## Steps

1. **Fix the collision guard in `MoviesService.attachTorrentSource`.** Include `episode` alongside
   `movie` on the `mediaSource.findUnique`, and refuse when the existing source belongs to *any*
   other target — another film, or any episode. The message stays
   `Ese magnet ya está asociado a «<title>»`; for an episode-owned source the title renders as
   `<Show> S04E01` (zero-padded, matching the search prefill). This lands first: after step 2 the
   hole is reachable. Behaviour for every film-to-film case must be byte-identical (NFR-6).
2. **`EpisodesService.findOneFromDb(episodeId, userId)`** — ownership-scoped lookup through
   `season.show.users`. Returns `null` when missing *or* unowned; callers turn that into the single
   `El episodio <id> no existe`. One message, no second "no es tuya" string.
3. **`EpisodesService.attachTorrentSource(episodeId, input, userId)`** — private, the twin of the
   movies one:
   - `findOneFromDb` → `NotFoundException('El episodio <id> no existe')`.
   - Active-source check: a `MediaSource` with this `episodeId` whose `status` is not `ERROR`.
     If one exists and `force` is unset →
     `ConflictException('Este episodio ya tiene una descarga en curso. Confirmá para reemplazarla.')`.
   - On `force`: demote every such row to `status: 'ERROR'` with an explanatory `errorMessage`,
     **before** creating the replacement. This is what makes a late `torrentCompleted` for the old
     hash harmless (`../plan.md` § Risks).
   - Collision check, symmetric with step 1.
   - `qbittorrent.add(urls)` — before any DB write.
   - Create or update the `MediaSource` with `episodeId` set; then
     `episode.update({ status: 'DOWNLOADING' })` and return the episode.
4. **`addTorrentToEpisode` / `addMagnetToEpisode`** on the service, thin, mirroring
   `addTorrentToMovie`/`addMagnetToMovie` — the magnet one parses first and wraps the parser's error
   in `BadRequestException`.
5. **`EpisodesResolver`** — the two mutations, `@CurrentUser()`, returning `Episode`. Then register
   `EpisodesModule` in `app.module.ts`.
6. **Episode-aware upload tickets.** `UploadTicketPayload` gains `episodeId?`; `mint` takes a target
   rather than a bare `movieId`; `verifyAndSpend` compares against the target the ticket carries,
   still before the spend. `createUploadTicket(movieId: Int, episodeId: Int)` rejects both-or-neither
   with `BadRequestException('Indicá exactamente uno de movieId o episodeId')` and runs the matching
   ownership check (`MoviesService.findOneFromDb` or `EpisodesService.findOneFromDb`).
7. **Episode-aware tus finish.** `onUploadCreate` reads whichever id the metadata carries and passes
   it to `verifyAndSpend`; a metadata target that disagrees with the ticket's is
   `UploadHttpError(403, 'El permiso de subida no corresponde a este episodio')`.
   `handleUploadFinish` branches: for an episode it creates the `LOCAL_FILE` / `READY` `MediaSource`
   with `episodeId` set, applies the same active-source conflict rule as step 3, moves the episode to
   `ENCODING`, and enqueues `addSourceReady` — the whole loop inside the request that received the
   last chunk, exactly as the film path already does.
8. **`DownloadsService.handleTorrentCompleted`** — `include` gains `episode`; an episode-owned source
   moves its episode to `ENCODING` inside the same transaction. Add the guard that an `ERROR` source
   (a demoted one, from step 3) does not move anything. Unknown hashes stay silently ignored; the
   signature does not change.
9. **`MediaSourcesService.sourceScanned`** — stamp `episodeId` on the `SourceFile` upsert (both
   `create` and `update`) beside the existing `movieId`, and extend the `matchedFilePath === null`
   branch to mark an `Episode` `ERROR` the way it already marks a `Movie`. Signature unchanged; the
   worker sends exactly what it sends today.
10. **Write `episodes.service.spec.ts`** (§ Tests), then regenerate and diff `src/schema.gql`
    against the frozen contract.

## Contract obligations

`api` is the producer here. What it must expose, verbatim from `../spec.md` § GraphQL Contract Delta
— which is read-only; if it is wrong, stop and report:

```graphql
addTorrentToEpisode(episodeId: Int!, infoHash: String!, urls: [String!]!, releaseTitle: String, force: Boolean = false): Episode!
addMagnetToEpisode(episodeId: Int!, magnet: String!, force: Boolean = false): Episode!
createUploadTicket(movieId: Int, episodeId: Int): UploadTicket!
```

Non-negotiable details the SDL cannot carry:

- `createUploadTicket`'s two arguments are both nullable and **exactly one** must be supplied. Both,
  or neither, is an error — never a silent preference.
- The mutations return `Episode!`. Neither carries `@AllowService()`.
- `sourceScanned` and `torrentCompleted` keep their exact current signatures. Episode support is
  semantics only. `services/worker` is not changed by this feature and must not need to be.
- `MediaSource.episodeId` already exists on the GraphQL type and the worker already selects it — do
  not add it again.
- Every user-facing string is Spanish and comes from `../spec.md`'s error table. Reuse the existing
  ones verbatim rather than writing near-misses; `El episodio <id> no existe` follows the shape
  `El mediaSource <id> no existe` already establishes.
- `movieId` is not renamed — not as an argument, not as the tus metadata key, not on
  `MediaSource.movieId`. `episodeId` goes beside it (`../spec.md` § NFR-1).

## Tests

`src/episodes/episodes.service.spec.ts` — new, following the structure of
`src/clients/torrent/magnet.spec.ts` and `src/media-roots/media-roots.service.spec.ts` (a header
comment naming the bug class, `describe` per unit, indicative `it(...)` strings **in English** per
Article VI). Do **not** imitate the `expect(service).toBeDefined()` scaffolding under `src/users/`.

The header comment names this failure class: *an episode's acquisition silently landing on a film,
or an episode's source being silently stolen — neither raises an error anywhere, and both leave the
user looking at a success message.*

Owed cases:

- `attachTorrentSource` writes `episodeId` and never `movieId` on the `MediaSource` it creates.
  Verified to fail if the field is swapped — this is the NFR-5 invariant.
- An episode the caller does not own (no `UserShow` link) throws `El episodio <id> no existe`, the
  same string a nonexistent id throws. Assert the `where` clause carries the ownership relation, the
  technique `movies.service.spec.ts`'s `findOneFromDb` block already uses.
- A second acquisition without `force` throws the conflict; with `force`, the previously active row
  is moved to `ERROR` **before** the new one is created.
- An `infoHash` already owned by a movie is refused, and one already owned by another episode is
  refused — the step-1 hole, asserted from the episode side.
- `qbittorrent.add` rejecting leaves no `MediaSource` row (ordering, not just outcome).

Not owed, with reason:

- `EpisodesResolver` — thin argument plumbing over the service, no branching worth a test. Same call
  `MoviesResolver` already reflects.
- `parseMagnet` — already covered by `src/clients/torrent/magnet.spec.ts`; re-testing it here would
  duplicate that suite, not defend anything new.
- `upload-tickets.service.ts`'s existing replay/expiry logic — already covered by
  `upload-tickets.service.spec.ts`. **Extend** that file with a cross-target case (a ticket minted
  for a movie, presented for an episode, is refused *and not spent*) rather than starting a new one;
  the not-spent half is the part that fails silently.
- `DownloadsService` / `MediaSourcesService` episode branches — mirror-image additions to code paths
  already exercised end to end by AC-7 and AC-13 in the manual pass. Add a unit test only if the
  branching turns out to be more than an `if` on which relation is populated; if it does, say so in
  the report.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
```

`tsc` reports **0 errors**. Tests are green, with the new suite included — today's baseline is 94
tests across 10 suites, so the count must go up and no existing test may go red. Report both numbers
before and after.

Then diff the regenerated `src/schema.gql` against `../spec.md` § GraphQL Contract Delta: the three
operations above, and nothing else new. Any extra field or argument in that diff is a contract
breach, not a bonus.

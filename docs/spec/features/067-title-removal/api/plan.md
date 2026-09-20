---
title: Title Removal — api slice
service: api
last_updated: 2026-09-20
status: Implemented
---

# PLAN: Title Removal — `api` (`api/plan.md`)

## Scope

`api` owns everything behind the two new mutations: the ownership count that decides which of the
two removals happens, the reference-only delete, the full title delete, and the reuse of
`047-source-deletion`'s unwind for a title's whole set of `MediaSource` rows. It also adds the
`otherOwners` field the dialog is phrased from.

It does **not** own the dialog, the copy, or the redirect — `web` does. It does **not** change
anything in `services/worker`: an encode is stopped through the `encode:cancel` publish
`EncodeQueueService` already exposes, which the worker already honours (`047`). There is **no Prisma
migration** in this slice; if you find yourself writing one, stop and report — the cascades this
feature needs are already declared.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/downloads/downloads.service.ts` | Modified | `downloadDelete`'s per-source body extracted to a private `unwindSource`; new public `unwindSourcesForTitle({ movieId } \| { showId })`. |
| `services/api/src/downloads/downloads.service.spec.ts` | Modified | Existing `downloadDelete` suite kept as the regression net for the extraction; new suite for the title-scoped unwind. |
| `services/api/src/movies/movies.service.ts` | Modified | `remove(id, userId)` — count other owners, then reference-delete or full delete. |
| `services/api/src/movies/movies.service.spec.ts` | Modified | The two branches plus the failure paths. |
| `services/api/src/movies/movies.resolver.ts` | Modified | `removeMovie` mutation, `otherOwners` `@ResolveField`. |
| `services/api/src/movies/entities/movies.entity.ts` | Modified | `otherOwners: Int!` field declaration. |
| `services/api/src/shows/shows.service.ts` | Modified | `remove(id, userId)`, the series twin. |
| `services/api/src/shows/shows.service.spec.ts` | Modified | Same coverage as the movies twin, plus the three-FK source collection. |
| `services/api/src/shows/shows.resolver.ts` | Modified | `removeShow` mutation, `otherOwners` `@ResolveField`. |
| `services/api/src/shows/entities/show.entity.ts` | Modified | `otherOwners: Int!` field declaration. |
| `services/api/src/shows/shows.module.ts` | Modified | Import `DownloadsModule` (MoviesModule already does). |
| `services/api/src/media/entities/title-removal.entity.ts` | New | The `TitleRemoval` `@ObjectType`. |
| `services/api/src/schema.gql` | Regenerated | Never hand-edited (Article IV). |

## Existing code to reuse

- `services/api/src/downloads/downloads.service.ts:669` — `downloadDelete`. Its step order **is**
  the contract: torrent client first (the only step allowed to fail the mutation), then
  `encodeQueue.publishCancel` + `removeEncode` per job, then `queue.removeSourceReady`, then
  `deleteResidue`, then the row. Extract, do not rewrite. `downloadDelete` itself must keep its
  exact current behaviour, including the `recomputeStatus` call the title path does not make.
- `services/api/src/downloads/downloads.service.ts:706` — `deleteResidue`. Already resolves the
  downloads root, already checks `isInsideRoot` before touching anything (Article V/XII), already
  swallows and logs every failure (NFR-3). Call it per source; do not wrap the loop in one `try`,
  which would let one bad path skip the rest.
- `services/api/src/clients/torrent/client.ts:279` — `remove(hashes: string | string[], deleteFiles)`
  already accepts an array. **One call with every hash of the title**, not one call per source:
  that is what makes NFR-2 reachable. `deleteFiles: true`, matching `downloadDelete` and never
  `downloadRemove`'s service-only `false`.
- `services/api/src/downloads/downloads.service.ts` — `callTorrentClient`, the wrapper that turns a
  `TorrentClientError` into `error.download.torrent_client_rejected`. The title path raises the same
  error through the same wrapper; do not add a key.
- `services/api/src/movies/movies.service.ts:254` — `findAudioMandatoryFor` is the template for an
  `otherOwners` resolver-backed read: a small `prisma.userMovie` query, one job, no includes.
- `services/api/src/movies/movies.service.ts` — `findOneFromDb(id, userId)` returns `null` both for
  a missing id and for a film the caller does not own. That indistinguishability is REQ-10; reuse it
  rather than writing a new ownership check. `ShowsService.findOneFromDb` (`shows.service.ts:78`) is
  its twin.
- `services/api/src/movies/movies.resolver.ts:180` (`setMovieContentKind`) and
  `services/api/src/shows/shows.resolver.ts:124` (`setShowContentKind`) — the exact template for
  "`assertEnabled` first, ownership second" (REQ-12). Note the deliberate asymmetry the `057` plan
  records: the movies ownership gate lives inside the service, the shows one in the resolver. Keep
  each service's own template; do not harmonise them here.
- `services/api/src/i18n/error-keys.ts` — every key this feature raises already exists
  (`MOVIE_NOT_FOUND`, `SHOW_NOT_AVAILABLE`, `MEDIA_TYPE_DISABLED`, `TORRENT_CLIENT_REJECTED`). No
  additions to `error-keys.ts` or `messages.en.ts`.

## Steps

1. Add `services/api/src/media/entities/title-removal.entity.ts` with `deleted: Boolean!` and
   `remainingOwners: Int!`, exactly as `../spec.md` declares it.
2. In `downloads.service.ts`, extract the per-source steps of `downloadDelete` into a private
   `unwindSource(source, { removeTorrent })`, where `removeTorrent` is false when the caller has
   already batched the torrent removal. `downloadDelete` now calls it with `removeTorrent: true` and
   keeps its `findOwnedSource` + `recomputeStatus` bookends. Run the existing suite before writing
   anything new — it must still pass untouched.
3. Add the public `unwindSourcesForTitle(scope: { movieId: number } | { showId: number })`. It
   loads every `MediaSource` of the title — for a show that means `OR` across
   `season.showId`, `episode.season.showId` and (defensively) nothing else, since a show has no
   direct `MediaSource` FK — collects every non-null `infoHash`, makes **one**
   `callTorrentClient(() => qbittorrent.remove(hashes, true))` when that list is non-empty, then
   runs `unwindSource(..., { removeTorrent: false })` per source. No `recomputeStatus`: the target
   is about to be deleted.
4. `MoviesService.remove(id, userId)`: `findOneFromDb` → null throws
   `i18nError.notFound(ERROR_KEYS.MOVIE_NOT_FOUND, { id })`. Count other owners. If > 0, delete the
   one `userMovie` row and return `{ deleted: false, remainingOwners: n }`. If 0, call
   `unwindSourcesForTitle({ movieId: id })`, then `prisma.movie.delete`, and return
   `{ deleted: true, remainingOwners: 0 }`.
5. `MoviesService.otherOwnersFor(userId, movieId)` — `prisma.userMovie.count({ where: { movieId,
   userId: { not: userId } } })`.
6. `MoviesResolver`: `removeMovie(id: Int!)` with `assertEnabled(MEDIA_TYPE.MOVIE)` **before** the
   ownership read, and the `otherOwners` `@ResolveField`. Add the field to `movies.entity.ts` with a
   note that it is resolver-populated, matching the existing `audioMandatory` declaration.
7. `ShowsService.remove(id, userId)` and `otherOwnersFor` — the same two branches against
   `userShow`/`show`, refusing with `ERROR_KEYS.SHOW_NOT_AVAILABLE` (no params).
8. `ShowsResolver`: `removeShow(id: Int!)` following `setShowContentKind`'s ordering
   (`assertEnabled` → `findOneFromDb` → refuse), and the `otherOwners` `@ResolveField`.
9. `shows.module.ts`: add `DownloadsModule` to `imports`. Confirm no cycle — `DownloadsModule`
   imports only `QueueModule`, `SettingsModule`, `MediaRootsModule`, and already exports
   `DownloadsService` for `MoviesModule`/`UploadsModule`.
10. Boot and confirm the regenerated `schema.gql` diff is exactly the contract delta and nothing
    else.

## Contract obligations

`api` must expose, exactly as `../spec.md` § GraphQL Contract Delta freezes it: `TitleRemoval` with
`deleted` and `remainingOwners`; `removeMovie(id: Int!): TitleRemoval!`;
`removeShow(id: Int!): TitleRemoval!`; and `otherOwners: Int!` on both `Movie` and `Show`.

`otherOwners` counts **other** users, excluding the caller — a title only the caller owns answers
`0`, which is what `web` reads as "this will delete it from Perceptor". Getting that inverted or
off by one silently gives every user the wrong warning before an irreversible action.

Four refusals, all with keys that already exist: `error.movie.not_found` (params `{ id }`),
`error.show.not_available` (no params), `error.media.type_disabled`, and
`error.download.torrent_client_rejected` from `callTorrentClient`. No new key. The delta is
read-only — if it is wrong, stop and report.

## Tests

- `services/api/src/downloads/downloads.service.spec.ts` — the existing `downloadDelete` suite
  (line 742) is the **regression net for step 2** and must pass unmodified. A new suite for
  `unwindSourcesForTitle` defends the two silent failures in `../plan.md`'s risk table: a source
  shape missed when collecting a series' sources (fixture with a `movieId`, a `seasonId` and an
  `episodeId` source at once, asserting every hash reaches one single `remove()` call), and a
  dropped `publishCancel` (asserting the full call set per source, in order). Also: a
  `callTorrentClient` rejection must leave `prisma.mediaSource.delete` and `rm` uncalled (NFR-2),
  and a throwing `deleteResidue` must not stop the remaining sources (NFR-3).
- `services/api/src/movies/movies.service.spec.ts` and `shows.service.spec.ts` — the branch
  selection is the thing worth testing, because both branches "succeed": picking the wrong one
  either deletes a title out from under another user or silently leaves a title nobody owns. Cover:
  other owners > 0 → only the join row deleted, `unwindSourcesForTitle` never called; 0 → unwind
  then delete; not found / not owned → the keyed refusal, nothing deleted; a second removal of an
  already-removed id → the same refusal, no throw from Prisma.
- **Not owed**: the `otherOwners` resolvers. A wrong count is visible in the dialog copy on the
  first manual pass (AC-17) and the query is a single `count` with no branching — an
  `expect(service).toBeDefined()`-grade test around it is the scaffolding Article IX names as the
  anti-pattern. The `TitleRemoval` entity is a declaration with no behaviour.

Every new spec file (and every new `describe` block in an existing one) opens with the paragraph
Article IX requires, naming the failure it prevents.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
git status --short services/api/prisma
```

Typecheck 0 errors, the suite green with the pre-existing count plus this slice's additions, and the
`prisma` status **empty** — no schema change, no migration. `git diff services/api/src/schema.gql`
shows exactly `TitleRemoval`, `removeMovie`, `removeShow` and the two `otherOwners` fields.

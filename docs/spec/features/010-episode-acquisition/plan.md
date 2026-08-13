---
title: Per-Episode Acquisition (Search, Magnet, File) — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-13
status: Approved
---

# PLAN: Per-Episode Acquisition (Search, Magnet, File) (`plan.md`)

## Approach

The feature adds a new `api` module, `services/api/src/episodes/`, holding `EpisodesResolver` and
`EpisodesService`. It is the structural twin of `movies/`'s acquisition half, one level deeper:
where `MoviesService.attachTorrentSource` scopes through `UserMovie`, `EpisodesService` scopes
through `episode → season → show → UserShow`. A new module rather than more methods on
`ShowsService` because `ShowsService` already implements `MediaTypeService` (TMDB search, register,
season hydration) and the mutations here return `Episode`, not `Show` — a `@Resolver(() => Episode)`
is the honest home, and it keeps the new Article IX spec file focused on one concern.

The `Episode` GraphQL entity is **not** redefined. `services/api/src/shows/entities/episode.entity.ts`
already exists (`009-show-detail`) and is imported by the new resolver; duplicating it would produce
two `@ObjectType()`s racing to own the same schema type name.

**Three things this plan deliberately reuses rather than reinvents:**

- `services/api/src/clients/torrent/magnet.ts`'s `parseMagnet` — pure, already spec'd, already
  produces the three user-facing error strings the contract lists. `addMagnetToEpisode` wraps it in
  a `BadRequestException` exactly as `MoviesService.addMagnetToMovie` does.
- `services/api/src/clients/torrent/client.ts`'s `QbittorrentClient.add(urls)` — already returns the
  per-download savepath and already throws before any DB write when qBittorrent refuses. It is
  exported by `SettingsModule`, so `EpisodesModule` gets it by importing that module; no new
  provider.
- `services/web/src/components/search/SearchTorrent.tsx` — already builds the `"{Show} S01E02"`
  query from `showTitle`/`seasonNumber`/`episodeNumber` and already renders the results table. It is
  extended, not replaced; REQ-1 through REQ-4 are mostly unblocking code that exists.

**On duplicating `attachTorrentSource`.** `EpisodesService` gets its own private
`attachTorrentSource`, structurally parallel to `MoviesService`'s rather than extracted into a
shared helper. This is the same call `006-media-search` made for `MoviesService`/`ShowsService` and
recorded in its Out of Scope. The three-line middle (qBittorrent add, create-or-update the
`MediaSource`) is genuinely identical; the surrounding ownership lookup, conflict rule and status
write are not, and the conflict rule in particular is *differently shaped*, not differently spelled
— a film's "already downloading" is a non-null `Movie.mediaSourceId` column, an episode's is a query
for a non-`ERROR` `MediaSource` with that `episodeId` (see § Migrations for why). Extracting the
common middle would mean editing `MoviesService.attachTorrentSource`, which has **no test coverage**
today (`movies.service.spec.ts` covers `findOneFromDb` and the search-cache ordering, not this
method) and which NFR-6 requires to keep behaving identically. The trade is accepted knowingly and
recorded as debt, not overlooked — see § Risks.

**But `MoviesService` is not left untouched, and this is the plan's least obvious finding.** Its
collision check reads:

```ts
if (existingSource && existingSource.movie && existingSource.movie.id !== movieId)
```

`MediaSource.infoHash` is globally `@unique`. Once episodes can own a `MediaSource`, a hash already
attached to an *episode* makes `existingSource.movie` null, the guard falls through, and the
`update()` below silently re-points that row at the film — the episode loses its source with no
error anywhere. The same hole exists in mirror image on the new episode path. Both sides must check
for an owner of *either* kind. This is a required change to working code, in scope, and is the
single highest-value thing in this feature to get right.

On `web`, the shape change that matters is replacing the `item: Movie | Episode` + separate
`mediaType: MediaType` prop pair with a discriminated union target. Today those two props can
disagree — that is precisely how an episode id reaches a `movieId` argument (spec § NFR-5) — and no
amount of care at call sites makes an illegal combination unrepresentable. A union does.

## Order of Work

`api` first: it owns the schema and the contract, and `web` cannot call a mutation that does not
exist. Within `api`, the `MoviesService` collision fix comes before the new module, so the invariant
is closed before there is anything that can violate it.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Close the `infoHash` collision hole in `MoviesService` **before** anything can create an episode-owned `MediaSource`. Doing it after means a window where the bug is live. |
| 2 | `api` | New `episodes/` module: service, resolver, module wiring. Nothing consumes it yet. |
| 3 | `api` | Episode-aware `createUploadTicket` + ticket payload + tus metadata + `onUploadCreate`/`handleUploadFinish`. |
| 4 | `api` | Episode branches in `DownloadsService.handleTorrentCompleted` and `MediaSourcesService.sourceScanned`. |
| 5 | `api` | `episodes.service.spec.ts` (Article IX — see the service plan). |
| 6 | `web` | Cannot render or call any of the above until the schema has it. |

**Parallelism.** Steps 2, 3 and 4 touch disjoint files and can overlap once step 1 has landed. Step 6
must not start before step 3 completes, because `createUploadTicket`'s argument nullability is the
one breaking SDL change and `web`'s action is its only consumer — starting `web` early means writing
against a signature that does not exist yet, which is diverging, not parallelising. The one genuine
exception is REQ-3's scroll behaviour in `SearchTorrent.tsx`'s results table: pure CSS, no contract
surface, safe to do at any point.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Implementers read
it; they do not edit it. Four things an implementer will be tempted to change and must not:

- **`createUploadTicket(movieId: Int, episodeId: Int)` — both nullable, exactly one required.**
  From inside `api` this looks sloppy: a required-one-of is not expressible in GraphQL's type system,
  so it becomes a runtime check. The alternative — a second `createEpisodeUploadTicket` mutation —
  was considered and rejected in `spec.md` § Out of Scope, because the tus endpoint behind it has one
  ticket mechanism and one `onUploadCreate`; two mutations would duplicate the branch rather than
  remove it. Do not "fix" this by adding the second mutation, and do not make one argument win when
  both are supplied — that hides a caller's bug.
- **The mutations return `Episode!`, not `Show!` and not `Boolean!`.** `web` reads the new `status`
  off the response. Returning the parent show would make every episode acquisition refetch a whole
  series.
- **`sourceScanned` and `torrentCompleted` keep their exact signatures.** Both gain episode
  *semantics* and neither gains an argument. `services/worker` sends what it sends today; a new
  argument on either would be an unannounced worker change, which is the exact failure Article VIII
  exists to prevent.
- **`movieId` is not renamed anywhere** — not the mutation arguments, not the tus metadata key, not
  `MediaSource.movieId`. `episodeId` goes *beside* it. See `spec.md` § NFR-1 and the dated entry in
  the root `CLAUDE.md` → `## Known debt`. An implementer who unifies these while "already in there"
  breaks the worker at runtime with no compile error in any service.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief both services.
Never patch it from inside one slice (Constitution, Article VIII).

## Migrations

**None.** Every column exists: `MediaSource.episodeId`, `SourceFile.episodeId`, `ProcessJob.episodeId`,
all nullable with their relations declared in `services/api/prisma/schema.prisma`. No new migration,
no backfill, nothing to roll back.

The one schema-shaped decision worth recording is the one *not* taken. A film owns its source
(`Movie.mediaSourceId Int? @unique`), so "one source per film" is a database constraint. An episode
is the pointed-at side (`MediaSource.episodeId`), so nothing stops many. A unique index on
`episodeId` was considered and rejected: an episode legitimately accumulates historical failed
attempts, and `spec.md` § REQ-9's replace path deliberately keeps the superseded row as `ERROR`
rather than deleting it. "One *active* source" is therefore an application invariant — active means
a `MediaSource` with that `episodeId` whose `status` is not `ERROR` — and application invariants that
the database does not enforce are exactly what Article IX wants a test on.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **Cross-entity `infoHash` theft** | `MediaSource.infoHash` is globally unique. `MoviesService`'s collision guard only inspects `existingSource.movie`; a hash owned by an episode falls through it and the row is silently re-pointed at the film. The episode keeps `status = DOWNLOADING` forever, pointing at a source that now belongs to a movie. No exception, no log. | Step 1 of the order of work, before any episode source can exist. Both paths check for an owner of either kind. Covered by an `episodes.service.spec.ts` case and by AC-9/AC-10. |
| **Episode id reaching a film argument** | Both are `number`. `addMagnetToMovie(episodeId, …)` finds a *different* title, attaches the torrent, returns success. This is live in the tree today (`importMagnetModal.tsx`). | `web` replaces `item: Movie \| Episode` + `mediaType` with a discriminated union, making the illegal pair unrepresentable rather than merely discouraged. `api` side pinned by the NFR-5 test. |
| **Superseded source completes late** | qBittorrent's AutoRun fires for a torrent the user already replaced. `torrentCompleted` matches by `infoHash` only and would move the episode on behalf of a source that lost. | REQ-9 demotes the previous source to `ERROR` on replace; `handleTorrentCompleted` must not act on an `ERROR` source. AC-10 is the check. |
| **Episode stuck in `ENCODING` forever** | `sourceScanned`'s `matchedFilePath === null` branch updates only `Movie`. An episode whose download contains no video is marked `ERROR` on the source but stays `ENCODING` on the episode — the UI shows work in progress that will never progress, and nothing errors. | Step 4 adds the episode branch. AC-13 is the check. |
| **`createUploadTicket` nullability silently breaks the film upload** | `movieId` goes `Int!` → `Int`. `web`'s action passes it positionally today. If the action is not updated in the same delivery, a film upload mints a ticket for `undefined` and fails at `onUploadCreate` with a misleading "permiso venció". | NFR-6 + AC-14 exercise the full film upload. `web`'s action must name the argument explicitly. |
| **Ticket/metadata target mismatch** | A ticket minted for an episode used on an upload whose metadata says `movieId` (or vice versa) would, without a check, attach the file to whichever the metadata names — bypassing the ownership check the ticket carried. | `verifyAndSpend` binds to the entity it was minted for; `handleUploadFinish` requires the metadata to match. Contract error row: `El permiso de subida no corresponde a este episodio`. |
| **Duplicated `attachTorrentSource` drifts** | Two structurally parallel methods; a future fix applied to one and not the other produces a difference nobody notices until a user hits it. | Accepted knowingly (see § Approach). Both carry a comment pointing at the other. The follow-up unification rides with the `movieId` rename already dated in the root `CLAUDE.md` → `## Known debt`, since both touch the same call sites. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
grep -rn "@prisma/client" services/web/src
```

Expected: `api` 0 errors; `api` tests green with the new suite (94 today, more after); `web`
**exactly 11** errors across 4 files (`ResultsForm.tsx` 5, `SearchForm.tsx` 2,
`ImportMagnetSeasonModal.tsx` 2, `importFolderModal.tsx` 2) — down from 12 because
`SearchTorrentModal.tsx`'s `@prisma/client` import is gone; the `grep` returns nothing.

Then the manual pass, with the stack up (`bin/dev`) and a series registered that has at least two
seasons:

1. `/shows/<id>` → open the newest season → click **buscar** on an episode. The input reads
   `<Title> S04E01`. Edit it, submit, confirm results render. Scroll the list: the column header
   stays put (AC-1, AC-2). Type in the filter box: rows narrow without a new indexer request
   (network panel, AC-3).
2. Click a result. Then:
   ```bash
   bin/mysql -e "select id, kind, status, movie_id, episode_id, info_hash from media_sources order by id desc limit 1"
   ```
   `episode_id` set, `movie_id` null. Reload the page: that episode reads `DOWNLOADING` (AC-4).
3. Click the same episode's buscar again and pick another release → the conflict message appears;
   confirm the replace → the previous row is now `ERROR` with a non-null `error_message` (AC-9).
4. Fire the completion hook for the **superseded** hash and confirm the episode does not move
   (AC-10), then for the live one and confirm `ENCODING` plus one `bull:process` job in
   `docker compose logs -f api` (AC-7).
5. Magnet modal with a valid magnet (AC-5) and with `not-a-magnet` (AC-12, `No parece un magnet
   link` inline in the modal — not an `alert`).
6. File modal: upload a small video, watch pause/resume work, confirm `kind = LOCAL_FILE`,
   `status = READY`, `episode_id` set, episode `ENCODING` (AC-6).
7. Sign in as a second user who does not own that series and call `addTorrentToEpisode` for one of
   its episodes → `El episodio <id> no existe`, byte-identical to a nonexistent id (AC-8).
8. Regression: repeat release search, magnet import and a full file upload from `/movies/<id>`
   (AC-14).
9. `createUploadTicket` with both ids and with neither, from the GraphQL playground (AC-11).

---
title: Download Status and Torrent Tags — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-19
status: Approved            # Draft | Approved | Implemented
---

# PLAN: Download Status and Torrent Tags (`plan.md`)

## Approach

The feature is three changes that happen to share a screen, and they are best understood separately
because only one of them is risky.

**The torrent client grows the methods it was always missing.**
`services/api/src/clients/torrent/client.ts` already has the exact shape every new method needs —
`baseUrl()`, `normalizeHashes()`, `HTTP_METHOD`, a `URLSearchParams` body, a JSDoc line linking the
matching wiki anchor. `add()` gains a `tags` parameter (qBittorrent takes it inline, so no second
call and no untagged window), `info()` gains an optional `tag` filter and three fields, and `start`
and `forceStart` are added beside the existing `stop`/`remove`. `mapTorrentState`'s state sets are
brought to qBittorrent 5.0 (`spec.md` NFR-7). Nothing here is a new abstraction — it is the
existing adapter finishing the interface it declares in `types.ts`.

**The `downloads/` module grows the read and control surface.** It already exists, is two files
long, and is named exactly for this. It gets `Download` (`entities/download.entity.ts`), the two
queries and the three mutations. It resolves ownership with the same
`where: { id, users: { some: { userId } } }` clause `MoviesService.findOneFromDb` and
`ShowsService.findOneFromDb` use, written locally rather than by importing those services — this
codebase has already made that call three times over (`attachTorrentSource` is deliberately
triplicated across `movies/`, `episodes/` and `seasons/`; see `010`'s plan), and importing
`MoviesModule`+`ShowsModule` into `DownloadsModule` to save four lines of `where` would be the
novel thing here, not the duplication.

**The `Movie` ↔ `MediaSource` inversion is the risky part, and it is why `api` goes first and
alone.** `Movie.mediaSourceId @unique` is a database constraint, so REQ-6 is unreachable while it
exists. Replacing it with `MediaSource.movieId` makes all four owner relations symmetric, which in
turn makes "the other sources of this target" a single query shape instead of three — that shape is
what REQ-12's race arbiter and REQ-15's cleanup are both built on.

Alternatives considered and rejected: keeping `Movie.mediaSourceId` as a "winning source" pointer
alongside the new column (two sources of truth that drift with no error — rejected with the user);
and deriving the panel's rows from qBittorrent's tag listing rather than from `media_sources` (a tag
is a title string with no ownership and no identity, so it would leak across users and pick up
hand-made tags — this is REQ-14, and it is the second thing `api`'s tests defend).

**The worker is genuinely untouched, and this was verified rather than assumed.** REQ-16 asks that a
failed encode delete nothing. `services/worker/src/jobs/encode.job.ts:146` rethrows inside the catch,
which makes the cleanup block that follows the try/catch unreachable on failure — so cleanup already
runs only on success, and REQ-16 costs nothing. Loser cleanup is added inside `downloadRemove`,
which the worker already calls with an unchanged signature.

## Order of Work

`api` first, entirely. `web` cannot render a field that is not in the schema, and — more to the
point — `web`'s changes are mostly *deletions* of a conflict flow whose server-side counterpart
disappears in the same delivery. Overlapping them means `web` briefly sends `force` to a mutation
that no longer accepts it, which is a GraphQL validation error on every acquisition, not a type error.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration; `MediaSource.movieId` must exist before anything queries siblings by target |
| 2 | `api` | The torrent client methods and the 5.0 state sets — everything else in the slice calls them |
| 3 | `api` | The `downloads/` surface, the race arbiter, the loser cleanup, and retiring `force` |
| 4 | `web` | Cannot query `movieDownloads`/`showDownloads` until step 3 ships, and must not send `force` after it |

**Nothing runs in parallel.** With two services and one of them doing only UI on top of the other's
brand-new surface, there is no honest overlap. The `web` slice is small; splitting it to run
alongside `api` would buy nothing and would break every acquisition path for the duration.

Inside `api`, steps 1–3 are strictly ordered: the migration invalidates the `Prisma` client that
steps 2 and 3 compile against.

## Contract Freeze

`spec.md`'s `## GraphQL Contract Delta` and its `### The torrent client interface is a second,
parallel contract` are frozen as of `status: Approved`. Both are read-only to implementers.

Things an implementer will want to change, and must not:

- **`progress` crosses GraphQL as 0..100 but `TorrentClientInfo.progress` stays 0..1.** From inside
  `client.ts` the conversion looks like it belongs there. It does not: the adapter reports what
  qBittorrent reports, and the single ×100 lives in the service. An adapter that silently rescales
  is the thing that makes the next bug unfindable.
- **`downloadRemove` keeps its exact signature** even though its behaviour grows a loser sweep. The
  worker calls it and is not in `services:`. Adding an argument — even a defaulted one — to "make
  the new behaviour explicit" is a contract change that no typechecker on the worker side would
  catch.
- **`downloadDelete` is a separate mutation from `downloadRemove`, not a refactor of it.** They
  differ in caller (user vs service), in scoping (ownership vs none), in file handling (always vs
  argument) and in return type. Merging them is the obvious-looking cleanup and it would hand a
  browser session an unscoped deletion primitive.
- **`root_path` stays on `TorrentClientInfo`.** It is undocumented in the 5.0 wiki and populated in
  the running container; it is not redundant with the forced `savepath`. Deleting it as "dead" is
  the reading this plan exists to prevent.
- **The three new `Download` ids (`movieId`/`seasonId`/`episodeId`) stay as three nullable ints**,
  not a union or a polymorphic target object. `006-media-search` already rejected a GraphQL union at
  this boundary for the same reason: no codegen, so every narrowing is unchecked by hand.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief both slices.
Never patch it from inside one service (Constitution, Article VIII).

## Migrations

Owned by `api`. Generated through `bin/npm api run prisma:migrate` (Constitution, Article III) —
never hand-written SQL.

1. **`add_media_source_movie_id`** — adds `MediaSource.movieId Int?` with its relation to `Movie`,
   and drops `Movie.mediaSourceId` together with its `@unique` and its relation.

2. **Backfill: none.** The user confirmed the development stack has no data worth preserving
   (`spec.md` NFR-8). The migration may drop and recreate. Any existing `media_sources` rows that
   pointed at a film through the old column lose that link; re-add the film to recreate it.

**Reversibility: no.** Rolling back restores the `@unique`, and by then several `media_sources` rows
may legitimately share one `movie_id` — the constraint would refuse to come back. This is acceptable
only because the stack is in development; on real data this migration would need a
pick-a-winner-and-discard step written and reviewed first. Recorded here so nobody reads the missing
down-path as an oversight.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **A loser's `torrentCompleted` arrives before the pause lands** | Two `MediaSource`s of one target reach `READY`, two `ProcessJob`s encode to the same output path, and the second silently overwrites the first. Nothing logs anything. | REQ-13's guard in `handleTorrentCompleted`, placed **before** the existing `ERROR` branch; `api` test (a) under Article IX |
| **Siblings selected by tag instead of by target id** | A second series sharing a title string loses downloads the user never touched. The deletion *succeeds*, so there is no error to find. | REQ-14; every sibling query goes through `movieId`/`episodeId`/`seasonId`; `api` test (b) |
| **`mapTorrentState` left at 4.x names** | `stoppedDL` falls through to `SourceStatus.ERROR`, and `ERROR` is exactly what `handleTorrentCompleted` reads as "superseded, ignore" — so REQ-12's correctly paused loser becomes indistinguishable from a discarded one, and the race arbiter quietly stops working. | NFR-7; the fallthrough must stop laundering unknown states into `ERROR`; AC-7 and AC-9 check the live states |
| **`stop`/`remove` still not checking `response.ok`** | An unacknowledged stop leaves a loser downloading while the row reads `PAUSED`; an unacknowledged delete leaves the file on disk after the row is gone. Both directions invisible. | NFR-6; AC-17 exercises it with the `torrent` container stopped |
| **`web` keeps sending `force`** | Not a type error — a GraphQL validation error on *every* acquisition, film and episode alike. | Step 4 strictly after step 3; `grep -rn "force" services/web/src/actions/` is a `[verify]` task |
| **The tus upload path breaks on the dropped column** | `uploads.service.ts:212` reads `movie.mediaSourceId` and `:232` writes it. Missing one leaves uploads compiling and failing at runtime, on a route no GraphQL test covers. | Called out explicitly in `api/plan.md` § Files; AC-18's regression pass includes a full upload |
| **`Movie.mediaSourceId` removed from GraphQL while something still selects it** | Field arrives `undefined`; consumer renders a blank instead of erroring. | Verified before planning: no selection in `web` or `worker`. Re-checked as a `[verify]` grep |

## Verification

```bash
bin/npm api run prisma:migrate
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
grep -rn "force" services/web/src/actions/
grep -rn "mediaSourceId" services/web/src services/worker/src
grep -rn "@prisma/client" services/web/src services/worker/src
```

The last three must come back clean: no `force` argument left in any acquisition action, no
selection of the removed `Movie.mediaSourceId`, and no Prisma import in either consumer
(Constitution, Article II).

Then the manual pass, which is the only way to reach most of the acceptance criteria:

1. Add a release to a film; open qBittorrent and confirm the single title tag (**AC-1**), and a
   title with a comma produces one tag, not two (**AC-3**).
2. Add a release to an episode and a magnet to a season; confirm three tags and two (**AC-2**).
3. Add a second, different release to the same film — no prompt, no error; `bin/mysql -e "select
   id, status, info_hash, movie_id from media_sources where movie_id = <id>"` shows two non-`ERROR`
   rows (**AC-4**).
4. Load `/movies/<id>`: both rows, with percent and speed; click refresh and watch the percent move
   (**AC-5**). Load `/shows/<id>` with a season pack and a single episode in flight (**AC-6**).
5. Stop a row, then force-start it; confirm in qBittorrent **and** that the panel reads it as paused
   then downloading, never as an error (**AC-7**). Watch a freshly added torrent in `metaDL` render
   as downloading with an empty `root_path` (**AC-10**).
6. Delete a row: cancel leaves it, confirm removes torrent and files (**AC-8**).
7. Let one of two racing downloads finish: winner still seeding, loser stopped, loser's row
   `PAUSED` and **not** `ERROR` (**AC-9**). Let the encode finish: both torrents gone, loser's row
   and folder gone (**AC-11**).
8. Failure pass: query another user's film (**AC-12**); `downloadStart` on a `LOCAL_FILE` source
   (**AC-13**); `docker compose stop torrent` then load the page (**AC-14**) and click stop
   (**AC-17**); fire `torrentCompleted` with the loser's hash after the winner is `READY`
   (**AC-15**); force an encode to fail and confirm nothing is deleted or resumed (**AC-16**).
9. Regression: release search, magnet import, episode acquisition and a full tus upload, all with
   `force` gone (**AC-18**).

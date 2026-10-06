---
title: Status materialization — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-06
status: Approved
---

# PLAN: Status materialization (`plan.md`)

## Why possession is a column and not the existing index

`spec.md` was amended before approval, and this section is the record of why. Its first draft said the
media server's verdict was already recorded legibly, "as a `MediaServerItem` row keyed
`mediaType:tmdbId`", with "no new column introduced — REQ-4 is satisfied by a table that already
exists". Grounding in the code showed that was **true for a film and false for an episode**:

- `MediaServerItem` is keyed `@@unique([mediaType, tmdbId])` with `mediaType` a `VarChar(10)` holding
  `'movie' | 'show'` (`prisma/schema.prisma`). `Episode` **has no `tmdbId` column at all** — it is
  identified by `@@unique([seasonId, episodeNumber])` — so the table cannot express an episode.
- Episode-level presence is never stored anywhere. Both reconciliation paths obtain it from a **live
  call**, `client.listPresentEpisodes(externalId)`, and immediately turn it into a status write:
  `reconcileShow` (`media-server-reconcile.service.ts:100`, `034` REQ-13) and `syncShow`
  (`:198`, `069`). The ref it returns is `{ seasonNumber, episodeNumber }` with **no path** —
  `MediaServerEpisodeRef` in `clients/media-server/types.ts`, whose own comment says it carries
  "only what the index needs to key on".

So an episode promoted to `COMPLETED` by the media server has `filePath` null, no `MediaSource`, no
`ProcessJob`, and no row anywhere recording why. Under REQ-2 the recompute would demote it — the exact
failure AC-8 exists to prevent, which the first draft covered for films only.

The decision the spec records ("record possession legibly, rather than reading the status column back
in") was unaffected; only the claim that it was free. Two ways to implement it were on the table:

| | Shape | Cost | Notes |
| :-- | :-- | :-- | :-- |
| **A1** | a new table keyed like `MediaServerEpisodeRef` (`showTmdbId`, `seasonNumber`, `episodeNumber`) | new table; a join per recompute; identity must be translated to an `episodeId` on every read | keeps presence out of the title rows, beside `MediaServerItem` |
| **A2** ← **chosen** | `mediaServerPresentAt DateTime?` on **`Movie`** and **`Episode`** | two nullable columns, no new table, no join | possession sits on the row whose status it justifies, so the recompute reads it in the query it already makes |

**A2**, for four reasons. It is uniform across both target kinds rather than one mechanism for films
and another for episodes. It needs no join, so the recompute's inputs all arrive in the one
`findUnique` it already does. It **backfills exactly**: every existing `Movie`/`Episode` at
`COMPLETED` with `filePath` null is in that state *precisely because* the media server had it, so
`mediaServerPresentAt = now()` is not a guess. And it **dissolved the first draft's REQ-5** — the
registration-time reconciliation writes the column directly in the same `updateMany` that today
writes the status, so there is no index to couple to and no Jellyfin-never-rebuilt hole to close.

A2 also leaves `MediaServerItem` as exactly what `034` built it to be — an index of the server's own
item ids — rather than repurposing it as a possession log, which is the cleaner separation.

The amendment landed in `spec.md` before approval: REQ-4 restated over the two columns, the old REQ-5
deleted and 6…14 renumbered to 5…13, § Data Model Changes gaining the columns and losing its "no new
column" sentence, NFR-5 restated over a null value, and the acceptance criteria gaining a dedicated
episode case (AC-9) and a dedicated demotion case (AC-10) — the Jellyfin hole is gone, because nothing
reads the index any more.

## Approach

One owner, notified by identity. A new `title-status/` module holds `TitleStatusService` — the single
writer of `Movie.status`, `Show.status` and `Episode.status`. Every path that changes something a
status depends on calls `recomputeMovie(id)` / `recomputeEpisode(id)` / `recomputeSeason(id)` and
passes **no status value**. The service reads the target's sources, jobs and possession facts, calls
the pure functions in `pipeline-status/`, and writes the answer.

This is not a new mechanism; it is the promotion of one that already exists.
`DownloadsService.recomputeMovieStatus` / `recomputeEpisodeStatus` (`downloads.service.ts:838`)
already have exactly this shape — seed at `MISSING`, read sources and jobs, `toMediaStatus`, write —
and are already called from `047`'s unwind. The work is to move them out of `DownloadsService`
(a poor owner for an upload or an encode event), give them possession inputs and a `Show` arm, and
call them from the other twenty-three sites instead of each writing a literal.

`pipeline-status/` stays a pure module with no Nest module and no Prisma import
(`services/api/CLAUDE.md` § `pipeline-status/`: "a plain exported function, no Nest module, no
injection"), which is what keeps its ladder unit-testable. `TitleStatusService` is the only thing
that reads and writes; the computation it calls still cannot.

**The alternative, rejected.** Keeping `deriveTitleStatus`'s existing signature and having each caller
pass the status it believes resulted — the shape the code has today — is what produced the defect in
`spec.md` § Context. Since `022` a title holds several racing sources and since `013` one source fans
out into N jobs, so no caller has the information to name the result; the literal it passes is an
inference. `043` § Out of Scope rejected persisting the status for exactly this reason and was right
about that mechanism; NFR-8 records why a single recomputing owner is a different one.

**What is reused, not rebuilt:**

- `src/pipeline-status/pipeline-status.ts` — `deriveTitleStatus`, `deriveEpisodeStatus`,
  `isLiftedBySeasonPack`, the `RANK` ladder and `maxStatus`. The ladder is not re-derived; it loses
  its stored-column input and gains a `Show` arm.
- `DownloadsService.recomputeMovieStatus` / `recomputeEpisodeStatus` — moved, not rewritten.
- `DownloadsService.writeStatusIfNonTerminal` (`downloads.service.ts:499`) — already the guard REQ-8
  needs, and `DOWNLOADING` is already in its `NON_TERMINAL_STATUSES`, unreachable until now.
- `DownloadsService.liveInfoByHash` / `liveInfoForHash` (`:170`, `:873`) — the readings REQ-7 writes
  back. They already return every row; nothing new is fetched (NFR-1).
- `mapTorrentState` (`clients/torrent/client.ts:42`) — already produces the coarse buckets; REQ-9 moves
  one string between two existing sets.
- `MediaServerIndexService.lookup` — **untouched**. Nothing in this feature reads the index.

## Order of Work

One service: `api`. No consumer waits on anything, because the GraphQL surface does not change
(`spec.md` § GraphQL Contract Delta: "None"). `web` and `worker` are not in `services:` and get no
plan directory.

Within `api` the order is load-bearing, because steps 4 and 5 are only safe once 1–3 exist:

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | the migration — the enum must hold `QUEUED`/`PAUSED`/`DOWNLOADED` before anything writes them, and the possession columns must exist before the recompute can read them |
| 2 | `api` | `pipeline-status/`'s pure changes — drop the stored-status input, delete `toMediaStatus`, add the possession arm and the `Show` aggregation. Pure and unit-testable in isolation, so it lands with its tests before any caller moves |
| 3 | `api` | `title-status/` — the owner, built on step 2, with `DownloadsService`'s two private methods moved into it |
| 4 | `api` | convert the 24 literal writes into notifications, file by file |
| 5 | `api` | switch the read sites to the column |
| 6 | `api` | the torrent write-back (REQ-7) and `queuedDL → QUEUED` (REQ-9) |
| 7 | `api` | the daily recompute that catches an episode airing (REQ-12) |

**Steps 4 and 5 must not be split across a release boundary, and 5 must not land before 4.** Between
them the system is in its only genuinely broken intermediate state: reads return the column while some
writers still set a literal. Step 6 is independent of 4/5 and *can* run in parallel with them; step 7
depends only on 3.

Nothing here is parallel across services, because there is only one.

## Contract Freeze

`spec.md`'s `## GraphQL Contract Delta` — **"None — no type, field, argument or error is added,
removed or retyped"** — is frozen as of `status: Approved`. The data model changes underneath a wire
that does not move, and that is the point, not an oversight.

What an implementer will be tempted to change and must not:

- **`Movie.status` / `Show.status` / `Episode.status` stay `String!`.** Widening `MediaStatus` to eight
  values makes a GraphQL enum look obvious and correct. It is out of scope by `spec.md`, and
  `docs/spec/graphql-contract.md` forbids moving one of the three without the others. A consumer that
  receives a value it does not recognise must not fail.
- **The wire keeps carrying eight values.** It does so today, from `deriveTitleStatus`. If a read is
  switched to the column before the migration widens the enum, the wire silently narrows to five and
  `QUEUED`/`PAUSED`/`DOWNLOADED` disappear from `Movie.status` — a regression `web` cannot see at
  compile time, since `StatusBadge` simply stops matching. This is why step 1 precedes step 5.
- **`Download.status` keeps being derived per row.** `deriveSourceStatus` and its six rules are not
  touched. REQ-7 changes where `DOWNLOADING` is *stored*; it does not make `/downloads` read the column
  instead of the live reading. A row's altitude stays a derivation.
- **`toMediaStatus` is deleted, not fixed.** An implementer will find call sites that look like they
  just need a wider mapping. The mapping is the bug: it collapses eight values into five and the wire
  then reports eight.
- **`SourceStatus.PENDING` is not touched**, and `DOWNLOADING` is not added to `SourceStatus` as an
  encode state. A source fans out into N jobs.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve (Article VIII). The same
applies to the amendment above — it is a `spec.md` edit, not a plan-level decision.

## Migrations

`api` owns these (Article III). Generated through `bin/npm api run prisma:migrate`, never hand-written
SQL against a running database.

1. **`widen_media_status`** — add `QUEUED`, `PAUSED`, `DOWNLOADED` to the `MediaStatus` enum (REQ-5).
   Additive on a MariaDB enum column, so no existing row changes meaning.
2. **`add_media_server_presence`** — add `mediaServerPresentAt DateTime?` to `Movie` and `Episode`
   (REQ-4). Nullable, no default. Not exposed on any GraphQL type.
3. **Backfill, in one migration with step 2 so no deploy sits between them:**
   - `update movies set media_server_present_at = now() where status = 'COMPLETED' and file_path is null;`
     and the same for `episodes`. Exact, not a guess: that state is reachable only through
     reconciliation, since `filePath` is written in exactly one place
     (`process-jobs.service.ts:307`) and is always set together with `COMPLETED`.
   - Recompute every `Movie`, `Episode` and `Show` status (NFR-3). This cannot be SQL — it is
     `deriveTitleStatus` over three tables plus the `059` season-pack lift — so it runs as a
     **one-shot script invoked after `migrate deploy`**, idempotent by construction (it recomputes from
     the rows), and safe to re-run. It is what un-sticks every title left at `DOWNLOADING` by the
     ratchet, and the only thing that moves `Show.status` off `MISSING` for an existing install.
4. **`media_sources` needs no migration.** `SourceStatus` already declares `DOWNLOADING`; REQ-7 only
   makes it reachable. Existing non-terminal rows correct themselves on the first observation
   (REQ-10), so no backfill is owed — a one-off reconcile against `info()` at boot would be a new call
   to the torrent client and NFR-1 forbids it.

**Reversibility.** Steps 1 and 2 are additive and roll back cleanly *as schema*. The data does not:
once a title holds `DOWNLOADED`, rolling the enum back leaves a value the column cannot express, and
`mediaServerPresentAt` is the only record distinguishing a media-server `COMPLETED` from a
never-acquired `MISSING` — dropping it loses that distinction irrecoverably, and the next recompute
demotes those titles. A rollback is therefore a restore from the `backups/` dump the stack already
takes before migrating, not a `migrate resolve`.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **The two acquire sweeps change what they acquire.** `acquire-movies.task.ts:46` and `acquire-episodes.task.ts:67` select work by `deriveTitleStatus(...) === 'MISSING'` / `deriveEpisodeStatus(...) === 'MISSING'`. Step 5 makes them read the column. | Silent, and it spends money on bandwidth: a column that is momentarily stale at `MISSING` makes the sweep attach a second release for a title already downloading. There is no error — `087`'s guard refuses a `COMPLETED` target, not a `QUEUED` one. | Keep both sweeps' *selection* reading the live rows, not the column, even after step 5. Their input is "is there work in flight", which is exactly what the sources and jobs say. Named as a step in `api/plan.md` rather than left to the implementer's judgement. |
| **A write-back demotes a `SCANNED` source to `READY`.** A finished torrent still seeding maps to `READY` via `COMPLETED_STATES`. | Silent and destructive: `isRaceWinner` treats `READY` as an unconditional winner, so the arbiter can hand the race to a source whose encode already failed, or re-enqueue a scan. | `writeStatusIfNonTerminal` on every write-back path, never a bare `update`. AC-4 exercises it. The guard exists; the risk is an implementer writing a faster loop that skips it. |
| **A missed notification leaves a status stuck** — the new failure mode, replacing the old one. | Silent. A title sits at the status of its last recompute. | It is at least *findable*, which a wrong argument was not: a notification is a call, so step 4 is a mechanical sweep of 24 known sites (all enumerated in `api/plan.md`), and AC-15's grep is the standing check that no literal came back. |
| **`mediaServerPresentAt` goes stale and pins a title at `COMPLETED`.** | A film the user deleted from Jellyfin reads `COMPLETED` forever. | The column is cleared by the same `069` demotion path that already clears `filePath` (`media-server-reconcile.service.ts:133`) — the clear must land in the same `updateMany`, or the demotion only half-works. Named explicitly in `api/plan.md`; NFR-5 covers the inverse (an absent value never demotes on its own). |
| **A circular Nest dependency around `TitleStatusService`.** Seven modules must inject it, and `DownloadsService` is one of them while also being where two of its methods come from. | A `forwardRef` cascade, or a boot-time failure. | `title-status/` imports **only** `PrismaModule` and the pure `pipeline-status/` functions. It injects nothing from the seven callers, so the graph stays a tree. If an implementer finds themselves needing a service from the other direction, the design is wrong — stop and report. |
| **Concurrent recomputes of the same target.** Two events land at once. | Silent: the column holds the loser's answer and disagrees with the rows until the next event. | NFR-2. Each write is a guarded `updateMany` naming the status it expects to replace, the pattern already used at `media-server-reconcile.service.ts` and `process-jobs.service.ts:402`. |
| **The `059` season-pack lift now needs an un-write.** It was a read-time projection that un-did itself. | An episode reads `QUEUED` forever after its pack is deleted, with nothing in flight — the ratchet, reintroduced in a new place. | Season-scoped source transitions must recompute **every episode of the season**, not just the season. REQ-13, AC-14, and a named step in `api/plan.md`. |
| **Backfill recomputes a title mid-flight during deploy.** | A title downloading while the migration runs could be written from a half-read view. | The recompute is idempotent and derives only from rows; the worst case self-corrects on the next event or the next `/downloads` load. `api` applies migrations before it starts listening (`049` REQ-10), so no request races the backfill. |

## Verification

Everything through `bin/` (Article I).

```bash
bin/npm api run prisma:migrate
bin/npm api run test
bin/cli api npx tsc --noEmit
bin/comments api
```

Then the inventory checks that back the acceptance criteria:

```bash
bin/mysql -e "select status, count(*) from media_sources group by status"
bin/mysql -e "select status, count(*) from movies group by status"
bin/mysql -e "select status, count(*) from shows group by status"
```

`media_sources` must show a non-zero `DOWNLOADING` while a torrent transfers (AC-3; zero today in
every state of the system). `shows` must show rows outside `MISSING` (AC-12; all `MISSING` today).

```bash
grep -rn "status: *'\(DOWNLOADING\|ENCODING\)'" services/api/src --include=*.ts | grep -v spec.ts
```

Must return nothing for a `movie.update` / `episode.update` / `show.update` call site (AC-15).

**Manual pass**, on a live stack with qBittorrent reachable:

1. Attach a torrent to a film with the client's active-download limit set below the number queued.
   The film and the source both read `QUEUED`, not `DOWNLOADING` (AC-2) — and the queued rows are
   distinguishable from the transferring ones (REQ-9).
2. Let it transfer, then press stop on `/downloads`. The film reads `PAUSED` on the next load
   (**AC-1 — this fails today**), and another queued torrent that qBittorrent promoted in the
   meantime now reads `DOWNLOADING` (AC-7).
3. Stop the `torrent` container and load `/downloads` and press start. No `media_sources` row changes
   value and the refusal is the existing `error.download.torrent_client_rejected` (AC-5).
4. With a media server configured and holding a film Perceptor never downloaded, register it, then
   open its detail page and press Refresh. It reads `COMPLETED` and keeps reading `COMPLETED`
   (AC-8), and so does an episode the server holds (AC-9). Then remove it from the media server and
   Refresh again: it demotes, and a recompute right after does not promote it back — proving
   `mediaServerPresentAt` was cleared alongside `filePath` (AC-10).
5. With `media_server` set to `none`, encode a film through the pipeline. It reads `COMPLETED` from
   its `filePath` and the null presence value demoted nothing (AC-11).
6. Attach a season pack, confirm its aired episodes read `QUEUED`, then delete the pack. They read
   `MISSING` again (AC-14).
7. A series whose aired episodes are all `COMPLETED` reads `COMPLETED` while its `tmdbStatus` still
   reads `"Returning Series"` (AC-12); after an episode airs with nothing acquired, it stops reading
   `COMPLETED` within a day, on an install with no scheduled task enabled (AC-13).

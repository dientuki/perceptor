---
title: Status materialization — one owner, one vocabulary, one writer per column
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-06
last_updated: 2026-10-06
status: Approved
services: [api]
---

# SPEC: Status materialization — one owner, one vocabulary, one writer per column (`spec.md`)

## Context & Goal

A title's pipeline status is told three different ways in `api` at once, and the three disagree.
`Movie.status` / `Episode.status` (`MediaStatus`) is written **by hand at ten call sites**, each
passing a literal it inferred from its own local event — `'DOWNLOADING'` at attach
(`movies.service.ts:732`, `movies.service.ts:780`, `episodes.service.ts:142`,
`episodes.service.ts:188`), `'ENCODING'` after a scan enqueues
(`media-sources.service.ts:233`, `uploads.service.ts:232`, `uploads.service.ts:280`,
`downloads.service.ts:1046`, `downloads.service.ts:1053`), `'ERROR'` and `'COMPLETED'` from the
failure and completion paths. The **same column** is then fed back in as an *input* to
`deriveTitleStatus` (`src/pipeline-status/pipeline-status.ts`, `043-pipeline-status-normalization`),
which maxes it against the live `MediaSource` and `ProcessJob` rows and returns the eight-value
`PipelineStatus` that actually crosses the wire (`movies.service.ts:153`, `shows.service.ts:118`).
And a *third* mechanism, `recomputeMovieStatus` / `recomputeEpisodeStatus`
(`downloads.service.ts:838`), already does the right thing — re-derives from scratch seeded at
`MISSING` and persists the result — but is called from exactly one place: after a source delete
(`047-source-deletion`).

The three-way split is not cosmetic; it produces a defect that no test and no log reports. Because
the column is both an input and an output of its own derivation, the computation can only ratchet
**upward** and can never fall. `attachTorrentSource` writes `DOWNLOADING` (rank 3). If that source
then goes to `PAUSED` — a `resolveRace` loser (`downloads.service.ts:980`), or a user pressing stop —
nothing lowers the column, and `deriveTitleStatus` maxes `DOWNLOADING` against the honest `PAUSED`
(rank 2) and answers `DOWNLOADING`. The title reads "downloading" forever, with a paused torrent
behind it and no error anywhere. The same ratchet makes the attach write wrong from the first
instant: a film whose torrent is sitting in qBittorrent's queue having transferred zero bytes reads
`DOWNLOADING` rather than the `QUEUED` its own source row says.

The root cause is that **every one of those ten call sites is guessing**. Since
`022-download-status-tags` a title holds several `MediaSource` rows racing at once, and since
`013-season-pack-processing` one source fans out into one `ProcessJob` per episode. The caller knows
its own event — "I handed a torrent to the client", "I paused this one" — and has no view of the
siblings, so the status literal it passes is an inference from incomplete information. A stale value
is therefore *a wrong argument*, which nothing can test. This feature replaces the argument with a
notification: a writer announces **which target changed**, never what it became, and one owner reads
the target's sources and jobs and writes the answer. A stale value becomes *a missing call*, which
is testable.

Two smaller leftovers of `043` are resolved in the same pass because they are the same question.
**`SourceStatus.DOWNLOADING` is a member of a persisted enum that no path persists** — `043` named it
("declared and never persisted") and left it; its only producer is `mapTorrentState`
(`clients/torrent/client.ts:42`), which builds an in-memory reading from qBittorrent's `info()` and
throws it away. The asymmetry behind that is real and worth stating: **the encoder pushes and the
torrent does not.** `worker` reports every encode transition back over GraphQL (`encodeStarted`,
`encodeProgress`, `encodeCompleted`, `encodeFailed`), which is why `ProcessJob.status` is persisted
at every step and is trustworthy; qBittorrent only runs its AutoRun hook *on completion* (what writes
`READY`) and says nothing in between, so persisting `DOWNLOADING` requires asking. It is free to ask,
because every surface that shows in-flight work **already asks**: the title detail page renders
`DownloadsPanel` through `movieDownloads`/`showDownloads`, `/downloads` through `downloads`, and the
three control mutations through `liveInfoForHash` — and the last two fetch *every* torrent with no
tag and discard all but one row. Nothing new has to be called; what the calls already return has to
stop being thrown away. **And `Show.status` is written by nobody** — `043` excluded it by explicit
request because "what a series' status *is*" was an open product question. It is no longer open: the
series' own editorial state (on air, ended, cancelled) already lives in a *separate* column,
`Show.tmdbStatus`, written from TMDB and read by `074-show-refresh-sweep` to pick its cadence.
`Show.status` is unambiguously about possession, and REQ-11 defines the aggregation.

Pipeline stages: **Download** and **Detect completion, enqueue** change how status is recorded;
**Browse library** changes where a read gets its answer. No stage changes what it *does*, and no file
moves differently as a result of this feature.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (One owner, notified by identity)**: Every path that can change a title's pipeline
      status must notify a single recompute entry point with the **target's identity alone**. No call
      site may write a status literal to `Movie.status`, `Show.status` or `Episode.status`. The ten
      existing literal writes are removed, not wrapped.

- [ ] **REQ-2 (The computation never reads the column it writes)**: The recompute must derive the
      target's status from the target's `MediaSource` rows, its `ProcessJob` rows and its possession
      facts (REQ-4) only. The stored status column must not be an input. This is what removes the
      upward ratchet: a target whose only source moves `QUEUED → PAUSED` must read `PAUSED` on the
      next read.

- [ ] **REQ-3 (Possession outranks derivation)**: A target in possession reads `COMPLETED` regardless
      of what its sources and jobs say (today's behaviour for the `filePath` half,
      `047-source-deletion` REQ-13). A recompute must not demote it.

- [ ] **REQ-4 (Possession is recorded on the row, in two columns, and the status column is neither)**:
      A target is in possession when **either**:

      - its `filePath` is non-null — written in exactly one place, `process-jobs.service.ts:307`, and
        therefore meaning "this installation's own pipeline produced this file"; **or**
      - its new `mediaServerPresentAt` is non-null — meaning "the configured media server was
        observed holding this", written by the same reconciliation paths that today write
        `COMPLETED`, and cleared by the same paths that today demote and clear `filePath`.

      Both are inputs to the recompute; the stored status column remains not an input (REQ-2).

      This is what keeps `069-title-refresh` REQ-17 true. Reconciliation promotes a title the media
      server holds **without** setting `filePath` (`media-server-reconcile.service.ts:60`) —
      correctly, since Perceptor did not produce that file and does not know its path. Without a
      second possession input, a film the media server holds and a film nobody ever downloaded
      present the recompute with identical inputs (`filePath` null, no sources, no jobs) and two
      opposite correct answers, so the recompute would silently demote the first.

      The record must live on the `Movie` and `Episode` rows rather than in the existing
      `media_server_items` index, because that index cannot express an episode: it is keyed
      `@@unique([mediaType, tmdbId])` and `Episode` has no `tmdbId` column, being identified by
      `@@unique([seasonId, episodeNumber])`. Episode-level presence is today never stored at all — both
      reconciliation paths read it live via `client.listPresentEpisodes` and turn it straight into a
      status write (`media-server-reconcile.service.ts:100`, `:198`), and the
      `MediaServerEpisodeRef` they get back carries no path. `media_server_items` therefore stays
      exactly what `034-jellyfin-library-reconciliation` built it to be — an index of the media
      server's own item ids — and is not repurposed as a possession log.

      A demotion must clear `mediaServerPresentAt` **in the same write** that clears `filePath`
      (`media-server-reconcile.service.ts:133`, `:207`). A demotion that clears one and not the other
      only half-works: the next recompute reads possession and promotes the title straight back, with
      no error anywhere.

- [ ] **REQ-5 (The stored vocabulary is the vocabulary that crosses the wire)**: The title status
      column must be able to hold every value a consumer already receives — the eight
      `PipelineStatus` values, including `QUEUED`, `PAUSED` and `DOWNLOADED`, which `MediaStatus`
      cannot express today. The lossy collapse `toMediaStatus` (`047-source-deletion` REQ-12) is
      removed: nothing collapses eight values into five and then reports eight.

- [ ] **REQ-6 (Reads return the column)**: `Movie.status`, `Show.status` and `Episode.status` are read
      from the column, not recomputed per request. This is the point of the feature — a multi-service
      pipeline status computed once at the event, not on every select.

- [ ] **REQ-7 (`SourceStatus` mirrors the torrent client)**: `MediaSource.status` must persist
      `DOWNLOADING`. Every live reading already taken from the torrent client is written back for
      **every row the call returned**, not only the row the caller was asked about — so a stop on one
      of fifty downloads also records the one qBittorrent just promoted out of its queue, at no
      additional request.

- [ ] **REQ-8 (A terminal status is never overwritten by a live reading)**: Write-back must not move a
      source out of `READY`, `SCANNED` or `ERROR`. A torrent that has finished and is seeding maps to
      `READY` (`COMPLETED_STATES`), so an unguarded write-back would demote an already-`SCANNED`
      source whose files are encoding. The existing non-terminal guard (`writeStatusIfNonTerminal`,
      `043` REQ-7) is the rule; `DOWNLOADING` is already in its non-terminal set, where it has until
      now been unreachable.

- [ ] **REQ-9 (The three buckets are distinguishable)**: `mapTorrentState` must map qBittorrent's own
      download queue (`queuedDL`) to `QUEUED`, not to `DOWNLOADING`. Today it sits in
      `DOWNLOADING_STATES` (`clients/torrent/client.ts:16`), so a torrent waiting behind the active
      limit is indistinguishable from one transferring — with fifty downloads and three active slots,
      forty-seven rows read `DOWNLOADING` and none of them is. Everything else keeps today's
      deliberately coarse grouping: `stalledDL`, `metaDL`, `allocating`, `checkingDL`,
      `checkingResumeData`, `forcedDL` and any unrecognised state all remain `DOWNLOADING`.

- [ ] **REQ-10 (Freshness comes from the observations that already happen — no poller)**: No
      background sweep, scheduled task or interval timer is added for torrent state. Every surface
      that displays in-flight work already reads the torrent client, and REQ-7 makes each of those
      reads an observation point:

      | Already-existing read | `info()` scope | What its write-back refreshes |
      | :-- | :-- | :-- |
      | `movieDownloads` / `showDownloads` — the title detail page's `DownloadsPanel` (`downloads.service.ts:368`, `:436`) | tagged by title | every source of that title, in one call |
      | `downloads` — the global `/downloads` queue (`downloads.service.ts:391`) | untagged: all | every source of every title |
      | `liveInfoForHash` — `downloadStart` / `downloadStop` / `downloadDelete` (`downloads.service.ts:873`) | untagged: all | every source of every title |

      The residual staleness must be stated rather than engineered away: a source whose title nobody
      opens goes stale until the next `/downloads` load or the next control mutation anywhere in the
      installation, either of which refreshes all of them. The column is therefore "the last observed
      state", and that is accepted — a poller would buy freshness for work nobody is looking at, at
      the cost of periodic writes and a cadence that exists nowhere in this codebase.

- [ ] **REQ-11 (`Show.status` is defined and written)**: A series reads `COMPLETED` when every
      **aired** episode reads `COMPLETED`; an episode is aired when its `releaseDate` is non-null and
      not after now — the same test `isLiftedBySeasonPack` already applies. An unaired episode never
      holds a series back. Otherwise the series takes the highest status among its episodes, by the
      same ladder a title already uses. A series with no aired episode reads `MISSING`.
      `Show.tmdbStatus` is untouched and keeps meaning what it means: a `"Returning Series"` reading
      `COMPLETED` is a series that is up to date, not one that has finished. A `Show` has no
      possession column of its own and no `filePath`; it aggregates only.

- [ ] **REQ-12 (A status that changes only because time passed still changes)**: A series at
      `COMPLETED` whose next episode has just aired must stop reading `COMPLETED`, within 24 hours of
      that air date. This is the one transition with no event behind it — REQ-11's predicate is
      time-dependent, and materializing a time-dependent predicate means something has to notice the
      clock. It needs no new scheduled task: `refresh_episodes`, `acquire_episodes` and
      `refresh_shows` (`src/scheduler/tasks/`) already walk episodes daily, and a recompute of the
      series they touch is enough. It must not depend on a task the installation has to opt into —
      a series' status is not a feature a user enables.

- [ ] **REQ-13 (The season-pack lift survives materialization)**: An episode lifted to at least
      `QUEUED` by an unscanned season pack (`059-season-pack-acquisition-ui`, `isLiftedBySeasonPack`)
      must keep reading that way, and must **stop** reading that way when the pack is scanned, errors
      or is deleted. `059` records the lift as "a read-time projection, never a stored value, so
      deleting or scanning the pack un-does it with no un-write anywhere" — materializing it means
      that un-write now has to exist, triggered by the season's source transitions and by airing.
      Every episode of the season is in the recompute's blast radius when a season-scoped source
      changes.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Not one new call to the torrent client)**: This feature must add **zero** requests to
      qBittorrent, in any code path. REQ-7 persists rows the existing `info()` calls already return
      and discard, and REQ-10 forbids a poller. If an implementation needs a new call, the premise is
      wrong and it stops and reports.

- [ ] **NFR-2 (A recompute never loses to a concurrent one)**: Two events landing on the same target
      at once must not leave the column holding the loser's answer. The existing pattern is a guarded
      `updateMany` whose `where` names the status it expects to replace
      (`media-server-reconcile.service.ts`, `process-jobs.service.ts:402`); whatever is chosen, the
      outcome must be that the column ends up agreeing with the rows, not with whichever write landed
      last.

- [ ] **NFR-3 (The migration backfills)**: Widening the title status column (REQ-5), persisting
      `DOWNLOADING` (REQ-7) and introducing `mediaServerPresentAt` (REQ-4) all leave existing rows
      holding values computed under the old rules — including every title stuck at `DOWNLOADING` by
      the ratchet this feature removes, and every series sitting at `MISSING` because nothing ever
      wrote it. The migration must backfill `mediaServerPresentAt` and then recompute every title's
      status, not only alter the schema.

      The possession backfill is exact rather than a guess: `filePath` is written in exactly one place
      (`process-jobs.service.ts:307`) and always together with `COMPLETED`, so a `Movie` or `Episode`
      at `COMPLETED` with a null `filePath` is in that state *only* because reconciliation put it
      there.

- [ ] **NFR-4 (An unreachable torrent client writes nothing)**: Both live-read helpers already swallow
      a torrent-client failure and return an empty reading (`downloads.service.ts:170`,
      `downloads.service.ts:873`). An empty reading must be read as "no information", never as "every
      source is gone" — it must not write, and must not demote. Same posture as `069-title-refresh`'s
      failed rebuild: an outcome, not an error.

- [ ] **NFR-5 (A null possession value never demotes on its own)**: `mediaServerPresentAt` is null for
      every row on an installation with no media server configured (`media_server` default `none`),
      and for every title the server does not hold. A null must only ever mean "this input says
      nothing"; it must not by itself demote a title. Demotion from a media-server verdict stays
      `069`'s business, on its own guarded path, after a listing it confirmed succeeded.

- [ ] **NFR-6 (The derivation stays pure and stays tested)**: `src/pipeline-status/pipeline-status.ts`
      is a pure module with no Prisma import, which is what makes its ladder unit-testable. The
      recompute owner may read and write; the computation it calls may not.

- [ ] **NFR-7 (Article X is satisfied by removal)**: The diff removes the ten literal writes,
      `toMediaStatus`, and the status-as-input parameter of `deriveTitleStatus`. If it adds more than
      it removes, the addition names what made it unavoidable.

- [ ] **NFR-8 (`043`'s rejection is reversed on the record)**: `043-pipeline-status-normalization`
      § Out of Scope rejected persisting the normalized status — "a column would need writing at every
      one of the existing transition sites, which is the same failure mode this feature removes" — and
      added "if a future need arises for querying by normalized status, that is when the column earns
      its place, with the use case in hand." This spec is that reversal and must say so. The objection
      is answered by REQ-1 and REQ-2, not waved away: `043` assumed persisting meant *ten callers each
      naming a value*, which is indeed the failure mode; one owner recomputing from the rows is a
      different mechanism. `043`'s own `recomputeMovieStatus` already took this shape for the delete
      path.

## GraphQL Contract Delta

**None — no type, field, argument or error is added, removed or retyped.** The wire is unchanged by
construction, which is worth stating precisely because the data model changes underneath it:

- `Movie.status`, `Show.status` and `Episode.status` already cross as `String!`, deliberately not
  `registerEnumType`'d (`docs/spec/graphql-contract.md` lines 286–288, 365–366), and already carry the
  eight-value `PipelineStatus` vocabulary rather than the five-value `MediaStatus` the column holds.
  REQ-5 and REQ-6 make the column hold what the wire already carries. `web`'s `StatusBadge`
  (`services/web/src/components/status/StatusBadge.tsx`) already has a case for all eight.
- `Download.status` already crosses as `String!` and already emits `DOWNLOADING` from the live reading
  (`043` REQ-3, Rule 5). REQ-7 changes where that value is stored, not what is sent.
- `Show.status` begins moving off `MISSING` for the first time (REQ-11). No consumer changes — it is
  the same field, in the same vocabulary, that `Movie` and `Episode` already use — but it is a
  **behavioural** change visible to any screen that renders a series' badge, and
  `docs/spec/graphql-contract.md` must record it beside the existing `Episode.status` note from `059`.
- `mediaServerPresentAt` is **not** exposed on any GraphQL type. It is an internal possession record,
  like `ProcessJob.errorKey`, and no consumer has any business reading it.

No new error condition arises: every refusal on these paths is unchanged, and a failed recompute or an
unreachable torrent client writes nothing and surfaces nothing (NFR-4).

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `MediaStatus` (enum) | add `QUEUED`, `PAUSED`, `DOWNLOADED` so the column holds all eight `PipelineStatus` values (REQ-5) | n/a | Yes — NFR-3 |
| `Movie.mediaServerPresentAt` | **new** `DateTime?` — "the media server was observed holding this" (REQ-4) | nullable, no default | Yes — `now()` where `status = COMPLETED` and `filePath is null` |
| `Episode.mediaServerPresentAt` | **new** `DateTime?`, same meaning (REQ-4) | nullable, no default | Yes — same statement |
| `Movie.status` | unchanged type, new reachable values; meaning narrows from "hand-written guess, maxed at read time" to "materialized projection" | `MediaStatus @default(MISSING)`, unchanged | Yes — recompute every row, including titles stuck at `DOWNLOADING` |
| `Episode.status` | same | same | Yes — same |
| `Show.status` | same, and written for the first time (REQ-11) | same | Yes — every series is at `MISSING` today |
| `SourceStatus` | no member added or removed; `DOWNLOADING` becomes reachable (REQ-7) and `QUEUED` gains a second producer (REQ-9) | `@default(PENDING)`, unchanged | Yes — non-terminal sources hold a status that predates write-back |
| `MediaServerItem` | **untouched.** It stays `034`'s index of the media server's own item ids, and is not read by the recompute and not repurposed as a possession log — it cannot express an episode (REQ-4) | unchanged | No |

`SourceStatus.PENDING` is deliberately left alone: unlike `DOWNLOADING` it *is* written, by upload
session creation, and it is not a torrent-client reading.

No model, relation or index is added or dropped. `Show` gains no possession column — it aggregates
(REQ-11). `Show.tmdbStatus` is untouched.

## Acceptance Criteria

- [ ] **AC-1**: Given a film with one attached torrent source, when the source is paused (either by
      `downloadStop` or by losing `resolveRace`), then the film's `status` reads `PAUSED` on the next
      read — not `DOWNLOADING`. This is the defect in § Context; it fails today.

- [ ] **AC-2**: Given a film whose torrent has just been attached and is sitting in qBittorrent's
      queue having transferred nothing, then the film's `status` reads `QUEUED`, and
      `select status from media_sources where id = <id>` returns `QUEUED` — not `DOWNLOADING`.

- [ ] **AC-3**: `bin/mysql -e "select status, count(*) from media_sources group by status"` returns a
      non-zero count for `DOWNLOADING` while a torrent is transferring. It returns zero today for any
      state of the system.

- [ ] **AC-4 (failure path)**: Given a source already at `SCANNED` whose episodes are encoding, and a
      torrent still present in the client reporting `uploading`, when a live reading is taken and
      written back, then the source is still `SCANNED` — the write-back did not demote it to `READY`
      (REQ-8). Without the guard this corrupts the race arbiter: `isRaceWinner` treats `READY` as an
      unconditional winner.

- [ ] **AC-5 (failure path)**: Given qBittorrent stopped, when `/downloads` is loaded and a control
      mutation is attempted, then no `MediaSource.status` row changes value, nothing is demoted, and
      the mutation's own refusal is the existing `error.download.torrent_client_rejected` (NFR-4).

- [ ] **AC-6 (failure path)**: Given a title whose only `ProcessJob` fails, when the failure is
      reported, then the title reads `ERROR`; and when that errored source is deleted (`047`'s
      unwind), the title no longer reads `ERROR` — the recompute lowered it rather than leaving a dead
      value behind.

- [ ] **AC-7**: Given fifty torrents with three active slots, when one active torrent is stopped and
      qBittorrent promotes a queued one, then after the next live reading the promoted row's stored
      status is `DOWNLOADING` and the stopped row's is `PAUSED` — both written from the one `info()`
      call the stop already made (REQ-7). The other forty-seven still read `QUEUED`.

- [ ] **AC-8 (failure path)**: Given a **film** the configured media server holds — promoted to
      `COMPLETED` by reconciliation, with `filePath` null, no `MediaSource` and no `ProcessJob` — when
      any recompute of that film runs, then it still reads `COMPLETED` (REQ-4). Without the second
      possession input this demotes to `MISSING` and breaks `069`.

- [ ] **AC-9 (failure path)**: Given an **episode** the configured media server holds — promoted the
      same way, by `reconcileShow`'s per-episode write (`media-server-reconcile.service.ts:101`) —
      when any recompute of that episode runs, then it still reads `COMPLETED`, and its series still
      reads `COMPLETED` (REQ-4, REQ-11). This is the case `media_server_items` could never express,
      since `Episode` has no `tmdbId`.

- [ ] **AC-10 (failure path)**: Given a demotion — the media server no longer holds a title that was
      `COMPLETED` — when `069`'s sync runs, then the row's `filePath` **and**
      `mediaServerPresentAt` are both null afterwards, and a recompute immediately after does **not**
      promote it back to `COMPLETED` (REQ-4). Clearing only one of the two makes the demotion silently
      undo itself.

- [ ] **AC-11 (failure path)**: Given `media_server` set to `none` — so every `mediaServerPresentAt`
      is null — when a film with one `COMPLETED` encode is recomputed, then it reads `COMPLETED` from
      its `filePath`, and no title anywhere was demoted by the null (NFR-5).

- [ ] **AC-12**: Given a series whose every aired episode is `COMPLETED` and whose next episode has
      not aired, then `Show.status` reads `COMPLETED` while `Show.tmdbStatus` still reads
      `"Returning Series"` (REQ-11).

- [ ] **AC-13**: Given that series, when the next episode's air date passes with no file acquired,
      then within 24 hours `Show.status` no longer reads `COMPLETED` (REQ-12), on an installation that
      has opted into no scheduled task.

- [ ] **AC-14**: Given a season with an in-flight, unscanned pack, then its aired episodes read at
      least `QUEUED`; and when the pack is deleted, they read `MISSING` again (REQ-13). The second half
      is the un-write that did not have to exist before this feature.

- [ ] **AC-15**: `grep -rn "status: *'\(DOWNLOADING\|ENCODING\)'" services/api/src --include=*.ts |
      grep -v spec.ts` returns nothing for `movie.update`/`episode.update`/`show.update` call sites
      (REQ-1).

- [ ] **AC-16**: `bin/npm api run test` and `bin/cli api npx tsc --noEmit` both pass, and the
      migration plus backfill applied to a database holding a title stuck at `DOWNLOADING` leaves that
      title reading its true status (NFR-3).

## Out of Scope

- **A background poller or sweep for torrent state.** Considered and rejected in REQ-10: every surface
  that shows in-flight work already reads the torrent client, so a poller would add a cadence that
  exists nowhere in this codebase (everything in `src/scheduler/tasks/` is daily or monthly, and those
  tasks are for re-reading the catalog and acquiring new releases, not for status) and would write
  periodically about work nobody is looking at. The accepted cost is named in REQ-10: the column is
  the last observed state.

- **Polling, websockets or live updates in `web`.** The panel still refreshes on a click (`022`
  REQ-10, restated in `043` § Out of Scope). Nothing is pushed to a browser.

- **Turning any status into a GraphQL enum.** `043` left this as "a separate, mechanical change once
  the value set is stable" and the contract's own note forbids moving one of the three without the
  others. REQ-5 stabilizes the value set, which is what makes that change possible later — it is not
  this feature.

- **Exposing `mediaServerPresentAt` on the wire.** It is an internal possession record. No screen has
  a use for "why is this COMPLETED", and adding it would invite a consumer to re-derive status
  client-side, which is the thing this feature exists to stop.

- **`MediaSource.status`'s non-torrent values.** `PENDING` stays as it is, and the upload path's
  transitions are untouched. REQ-7 is about mirroring the torrent client, and an upload has no torrent
  client.

- **`EncodeStatus` and `ProcessJob.status`.** They are already written by a pushing producer at every
  transition and are the one part of this picture that is not broken. The encode vocabulary is not
  renormalized, and no `ENCODING` member is added to `SourceStatus` — a source fans out into N jobs, so
  a source-level encode status could not say "three done, two running, one failed".

- **The media-server index: its contents, its rebuild triggers, or recording episode presence in it.**
  `media_server_items` is untouched by this feature (REQ-4). Its wholesale `deleteMany`/`createMany`
  shape and its triggers (Settings, a title's Refresh) are `034`'s and `069`'s and stay theirs. Giving
  it episode granularity was considered and rejected in favour of the two row-level columns — see
  `plan.md` § Approach.

- **Recording the media server's *path* for a title it holds.** `MediaServerEpisodeRef` and
  `MediaServerLibraryEntry` carry no path, so `filePath` cannot be filled from a media server without
  changing the client contract. `mediaServerPresentAt` records that it is held, not where — which is
  all the recompute needs.

- **The three `attachTorrentSource` twins and the `movies`/`shows` duplication.** Those are
  `088-acquisition-path-unification`'s subject. This feature removes status literals from them and
  nothing else; whichever of the two lands first, the other rebases.

- **The `movieId` rename** (root `CLAUDE.md` § Known debt). Untouched, as always.

- **Deciding what a series' *editorial* status means.** `Show.tmdbStatus` is TMDB's word, written by
  `074`, and this feature neither reads nor writes it. REQ-11 is about possession only.

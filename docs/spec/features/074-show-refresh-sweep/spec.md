---
title: Show Refresh Sweep
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-26
last_updated: 2026-09-26
status: Approved
services: [api]
---

# SPEC: Show Refresh Sweep (`spec.md`)

## Context & Goal

`035-scheduled-tasks` built the cadence machinery — the registry
(`services/api/src/scheduler/scheduler.registry.ts`), the run record, the Settings → Scheduling tab —
and shipped four handlers, three of them deliberate no-op stubs. One of the three has since grown a
body: `041-episode-info-refresh` filled `refresh_episodes`, which sweeps episodes whose air date is
still in flight and rewrites their title, overview and air date. `refresh_shows`
(`services/api/src/scheduler/tasks/refresh-shows.task.ts`) is still the original stub: it arms, it
runs, it reports zero items, and it does nothing. A series' own row and its season list are written
once, by `ShowsService.hydrate()` at registration, and never revisited by anything automatic.

`069-title-refresh` then wrote the logic that stub needs. `ShowsService.refresh()` re-reads the
series from TMDB, rewrites its row, and calls `syncSeasonsAndEpisodes()` to create every season and
episode TMDB now lists that Perceptor does not — nothing deleted, nothing blanked. That spec's § Out
of Scope named exactly this follow-up and the reason it was deferred: a sweep of the whole library
has its own cost question, since `deployment-scale` asks us to conserve external API calls, and an
unasked-for demotion is worse than a stale row. What it did not answer is **how often** a given
series is worth re-reading.

The answer is that it depends on the series, and TMDB already knows: its detail response carries a
`status` — `Returning Series`, `Ended`, `Canceled`, `In Production`, `Planned`, `Pilot` — that
`TmdbClient` maps onto `ShowDetail.status` and then nobody stores. A series still in production can
gain an episode any week and is worth a monthly look; a series TMDB calls `Ended` almost never
changes, but "almost" is the whole point — a revival, a special, or a late-announced final season
flips an ended series back to `Returning Series` and adds a season, and today Perceptor would never
find out. So: persist the status, sweep a continuing series monthly and an ended one every six
months, and when an ended series turns out to have changed, the same pass that noticed also brings
in whatever seasons and episodes came with it.

This touches the "Register title in DB" stage of the root `CLAUDE.md` pipeline table. No stage
changes status, no GraphQL surface changes, and `web` and `worker` are not involved — the only
visible artifacts are fresher rows and a `refresh_shows` run whose `itemsProcessed` is no longer
always zero. It is a spec rather than a one-file change because it adds a Prisma column
(Constitution, Article III and VII).

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Persist the air status)**: `Show` must carry TMDB's series status as it comes off the
      wire (`ShowDetail.status`, already mapped by `TmdbClient`). Every path that already reads a
      series' TMDB detail must write it: registration (`ShowsService.register()`/`hydrate()`) and the
      manual refresh of `069` (`ShowsService.refresh()`), besides this feature's own sweep. A series
      registered before this feature ships carries no status until one of those paths next runs.
- [ ] **REQ-2 (Ended cadence)**: A series whose stored status is `Ended` or `Canceled` must be
      re-read from TMDB when its catalog was last synced more than **180 days** ago.
- [ ] **REQ-3 (Continuing cadence)**: Every other series — `Returning Series`, `In Production`,
      `Planned`, `Pilot`, any value TMDB adds later, and a series with no stored status at all — must
      be re-read when its catalog was last synced more than **30 days** ago. A status the code does
      not recognise is treated as continuing, never as ended: the failure mode of refreshing too
      often is a few TMDB calls, and of refreshing too rarely is a season nobody ever sees.
- [ ] **REQ-4 (Never synced is due)**: A series that has never completed a catalog sync (a hydration
      that failed or was interrupted) must be selected on the next sweep.
- [ ] **REQ-5 (What a refresh writes)**: For each selected series the sweep must write exactly what
      the manual refresh's catalog step writes — the series' `title`, `overview`, `posterUrl`,
      `releaseDate` and `originalLanguage`, plus REQ-1's status — and then re-read every season TMDB
      lists (season 0 included) and every episode of each, overwriting an existing season's or
      episode's catalog fields and creating any TMDB lists that Perceptor does not have.
- [ ] **REQ-6 (Nothing disappears)**: A season or episode Perceptor holds that TMDB no longer lists
      must be left untouched — never deleted, never blanked — and a field TMDB answers as empty must
      never erase a value Perceptor already has. Same rule as `069` REQ-3 and `hydrate()`.
- [ ] **REQ-7 (A revival is picked up in the same pass)**: When a series stored as `Ended` comes back
      from TMDB as anything else, the pass that observed the change must also write the new status and
      create whatever seasons and episodes came with it. The next sweep then treats that series under
      REQ-3's cadence rather than REQ-2's, with no further action by anyone.
- [ ] **REQ-8 (Catalog only)**: The sweep must not touch a title's `MISSING`/`COMPLETED` status, must
      not rebuild the media-server index, and must not attach or delete any source or job. The
      media-server reconciliation of `069` REQ-7/REQ-8 stays a manual, per-title action: a nightly
      demotion of a title the user never asked about is a surprise, and rebuilding the index once per
      sweep is a cost this feature does not need.
- [ ] **REQ-9 (Classification untouched)**: `Show.contentKind` must not be re-derived or written.
      Same reason as `069` REQ-5 — it may be a manual correction (`setShowContentKind`) and nothing
      distinguishes a corrected value from a derived one.
- [ ] **REQ-10 (Due marker moves only on success)**: A series' catalog-synced marker must be advanced
      only after its refresh completed. A series whose refresh failed stays due and is retried on the
      next tick.
- [ ] **REQ-11 (One series' failure is not the sweep's)**: A TMDB failure on one series must not stop
      the sweep; the remaining due series are still processed. The run must then be recorded as
      `FAILED` with an error naming how many series failed out of how many were due and how many were
      refreshed successfully — the same shape `041`'s sweep reports.
- [ ] **REQ-12 (Items processed)**: The run's `itemsProcessed` must be the number of series
      successfully refreshed in that occurrence — zero on an installation where nothing is due, which
      is a success, not a skip.
- [ ] **REQ-13 (No new configuration)**: The task keeps its existing `schedule_refresh_shows_enabled`
      / `schedule_refresh_shows_cron` Settings (off by default, `0 5 * * *`) and its existing
      `shows_enabled` gating through the registry's `mediaType: 'show'`. The two cadences of REQ-2 and
      REQ-3 are constants, not Settings — same call `041` REQ-3 made for its grace period. The cron
      decides how often Perceptor *looks*; the constants decide what is due when it does.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Sequential TMDB)**: Series are refreshed one after another, and within a series its
      seasons one after another — never in parallel. Same rate-limit reasoning as `hydrate()`,
      `069` NFR-1 and `041` NFR-1: a burst against one shared TMDB key rate-limits and leaves the
      sweep half-done with no error anywhere.
- [ ] **NFR-2 (Idle installation costs nothing)**: A sweep that finds nothing due must make zero TMDB
      calls. Selecting what is due is a database question.
- [ ] **NFR-3 (No cap on a run)**: Every due series is processed in the occurrence that found it due;
      there is no per-run ceiling. At this installation's scale the daily default cron means a library
      of continuing series costs roughly one thirtieth of itself per night, which is below the reason
      a budget would exist.
- [ ] **NFR-4 (Partial writes survive)**: A failure partway through a series leaves whatever seasons
      were already written written — each season/episode write is an idempotent upsert, and the next
      occurrence completes the rest because REQ-10 left the series due.
- [ ] **NFR-5 (Migration)**: The new column is nullable with no default and needs no backfill: an
      absent value is REQ-3's "treat as continuing", which makes every pre-existing series due within
      30 days of its last sync and fills the column as a side effect.
- [ ] **NFR-6 (Single service)**: No GraphQL field, no `web` change, no `worker` change. `web`'s
      Settings → Scheduling panel already lists, arms, disarms and manually triggers this task and
      renders its run history unchanged.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.** The task id `refresh_shows`, its
`schedule_*` Settings, the `ScheduledTask` type and the `runScheduledTask` mutation all already exist
and are unchanged (`035-scheduled-tasks`); this feature only replaces the handler's body. The new
`Show` column is internal — nothing outside `api` reads a series' TMDB air status, and exposing it
(a "Finalizada" / "En emisión" badge on the series detail page) is out of scope below.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `Show` | `tmdbStatus String?` — TMDB's series status verbatim off the wire (`Returning Series`, `Ended`, `Canceled`, `In Production`, `Planned`, `Pilot`, or any future value) | nullable, no default | No — NFR-5: `NULL` reads as continuing, so the first sweep after this ships fills it |

A raw string rather than an enum, deliberately: the only question the code asks of it is
"`Ended`/`Canceled`, or not", and TMDB adding a seventh value must not require a migration to store
(Article X). `Show.status` is already taken by `MediaStatus` (`MISSING`/`COMPLETED`/…) and means
something entirely different — the new column must not be named `status`.

The due marker is the existing `Show.seasonsSyncedAt`, which already means "the catalog of this
series was last synced at" and is already written by both `hydrate()` and `069`'s `refresh()`. No
second timestamp column is added.

## Acceptance Criteria

- [ ] **AC-1**: Given a registered series, when `bin/mysql -e "select tmdbStatus, seasonsSyncedAt from
      shows"` is run after its registration completes, then `tmdbStatus` holds TMDB's value for that
      series (e.g. `Ended` for a finished series) and `seasonsSyncedAt` is set.
- [ ] **AC-2**: Given a series whose `tmdbStatus` is `Returning Series` and whose `seasonsSyncedAt`
      was set 40 days back by hand, when `refresh_shows` is triggered from Settings → Scheduling
      ("Ejecutar ahora"), then the run reads `SUCCESS` with `itemsProcessed: 1` and that series'
      `seasonsSyncedAt` is now.
- [ ] **AC-3**: Given the same series with `seasonsSyncedAt` set 20 days back, when the task is
      triggered, then the run reads `SUCCESS` with `itemsProcessed: 0` and `seasonsSyncedAt` is
      unchanged.
- [ ] **AC-4**: Given a series whose `tmdbStatus` is `Ended` and whose `seasonsSyncedAt` was set 100
      days back, when the task is triggered, then it is not selected (`itemsProcessed: 0`); with
      `seasonsSyncedAt` set 200 days back instead, the same trigger selects it (`itemsProcessed: 1`).
- [ ] **AC-5**: Given a series with `tmdbStatus` set to `NULL` and `seasonsSyncedAt` set 40 days back,
      when the task is triggered, then it is selected and `tmdbStatus` is no longer `NULL` afterwards.
- [ ] **AC-6**: Given a series whose `seasonsSyncedAt` is `NULL`, when the task is triggered, then it
      is selected regardless of how long ago it was created.
- [ ] **AC-7 (revival)**: Given a series stored as `Ended` with `seasonsSyncedAt` 200 days back, and
      one of its seasons deleted from `seasons` by hand to stand in for a season TMDB has since
      announced, when the task is triggered, then the deleted season and its episodes reappear with
      their TMDB titles, `tmdbStatus` reads whatever TMDB answers now, and `itemsProcessed` is 1.
- [ ] **AC-8**: Given a series manually set to `ANIME` (`setShowContentKind`) and due for a refresh,
      when the task runs, then `shows.contentKind` is unchanged.
- [ ] **AC-9**: Given a due series with an episode that is stored `COMPLETED` and a `MediaSource` in
      `DOWNLOADING`, when the task runs, then no `episodes.status`, `movies.status`,
      `media_sources` or `process_jobs` row changed — only catalog columns and `seasonsSyncedAt`.
- [ ] **AC-10 (failure)**: Given two due series and the TMDB key set to an invalid value in Settings,
      when the task is triggered, then the run reads `FAILED`, its error names 2 of 2 series failed,
      both series' `seasonsSyncedAt` are unchanged, and no catalog column was blanked. Triggering it
      again with a valid key then refreshes both and reads `SUCCESS`.
- [ ] **AC-11 (failure)**: Given `shows_enabled` set to `false`, when `refresh_shows` is triggered
      manually, then the existing `error.schedule.task_unavailable` refusal is shown and no run row is
      created — unchanged behaviour from `045`/`035`, verified not to have regressed.
- [ ] **AC-12**: `git status --short services/api/prisma` shows both a modified `schema.prisma` and
      one new migration directory, and `bin/cli api npx prisma migrate status` reports no pending
      migration after `bin/npm api run prisma:migrate`.

## Out of Scope

- **`refresh_movies`.** The third stub keeps reporting zero. A film's catalog data does change
  (poster, overview, a release date that firms up), but it has no equivalent of a series' air status
  to derive a cadence from, so the selection rule is a separate decision — probably "films whose
  release date is near or unset", which is `041`'s shape rather than this one's.
- **`acquire_pending` and `acquire_episodes`.** Finding a release for a season this sweep just
  discovered is `073-automatic-episode-acquisition`'s job. This feature writes rows; it never
  searches the indexer or attaches a source. A new season appearing here is exactly what makes `073`'s
  sweep eventually find it.
- **Media-server reconciliation in the sweep.** REQ-8. Promoting and demoting `COMPLETED`/`MISSING`
  from what the media server holds stays the manual per-title refresh of `069`.
- **Showing the air status in the UI.** No GraphQL field is added, so there is no "Finalizada" /
  "En emisión" badge on the series detail page. It would need a contract delta, `web` work and
  catalog copy in `en`/`es` — a separate, purely cosmetic feature on top of the column this one adds.
- **Per-installation cadence Settings.** REQ-13. The cron is already configurable; two more Settings
  rows for 30 and 180 days are configuration nobody has asked to change.
- **Notifying anyone that a series came back.** REQ-7 writes the new seasons and stops. There is no
  notification system in Perceptor to hook into, and inventing one for this is a feature of its own.
- **Re-deriving `contentKind`.** REQ-9, same reasoning as `069` REQ-5.
- **A Redis lock for the sweep.** `035`'s in-process `runningTaskIds` guard is still what prevents a
  second occurrence, and it is still sound only because `api` runs as exactly one container. Nothing
  about this feature changes that, or the day a replica count above one would break it.

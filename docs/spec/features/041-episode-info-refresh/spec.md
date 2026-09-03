---
title: Episode Info Refresh
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-03
last_updated: 2026-09-03
status: Implemented
services: [api]
---

# SPEC: Episode Info Refresh (`spec.md`)

## Context & Goal

`035-scheduled-tasks` shipped the scheduling helper and registered four task ids, every one of them
wired to a handler that deliberately does nothing —
`services/api/src/scheduler/tasks/refresh-episodes.task.ts` returns `{ itemsProcessed: 0 }` and says
so in its own comment. This feature writes the body of exactly one of them, `refresh_episodes`, and
is the first spec to make the scheduler do real work.

The gap it closes is a data one. A series is hydrated once, at registration:
`ShowsService.hydrate()` walks every season TMDB lists, calls `tv/{id}/season/{n}` and upserts each
episode's `title`, `overview` and `releaseDate`, then stamps `shows.seasonsSyncedAt` and never looks
again. That snapshot is correct for a finished series and wrong for a running one. Today is
2026-09-03; a series registered last week whose episode 4 airs on 2026-09-06 is sitting in the
database with a placeholder title, an empty overview, or an air date that has since moved — and
nothing in the stack will ever correct it, because the only thing that rewrites an episode row is a
registration that already happened. The user browsing `/shows/{id}` sees `Episode 4` where TMDB has
had the real title for days.

Once this ships, an administrator who enables `schedule_refresh_episodes_enabled` gets a daily
sweep that finds every episode whose information is still in flight — not yet aired, or aired within
the last two days, since TMDB routinely fills a title in at or just after air time — groups them by
the season they belong to, pulls that season once from TMDB and writes the current values back over
those rows. No pipeline stage in the root `CLAUDE.md` table changes: this is the **Register title in
DB** stage gaining a second, scheduled entry point into writes it already performs at registration,
which is exactly the shape `035` described for its follow-ups.

One note on process, so a reviewer can weigh it rather than discover it: this feature touches one
service, changes no Prisma schema and adds no GraphQL, so Article VII would not by itself demand a
spec. It gets one because `035` § Out of Scope explicitly deferred these four bodies to their own
specs, and because the decisions below — which episodes count as pending, how many TMDB calls a run
is allowed to cost, what a partial failure records — are the kind that get improvised wrongly at
implementation time.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Handler body)**: The `refresh_episodes` task registered by `035` must stop being a
      stub and perform the sweep described here. Its id, its default cadence (`0 6 * * *`), its
      seeded-disabled state and its registry wiring are unchanged — this feature adds no task and
      renames none.
- [ ] **REQ-2 (Selection window)**: A run must select every `Episode` row whose `releaseDate` is
      `NULL`, or whose `releaseDate` is on or after two days before the run's start. Everything
      else — an episode that aired three or more days ago — is never selected, on the grounds that
      its catalog data has settled.
- [ ] **REQ-3 (Grace period is fixed)**: The two-day grace window is a constant in `api`, not a
      Setting. Scheduling already owns two Settings keys per task; a third knob for this one task
      is a second configuration surface for a value nobody has yet asked to tune.
- [ ] **REQ-4 (One fetch per season)**: The selected episodes must be grouped by the
      `(show.tmdbId, season.seasonNumber)` they belong to, and the run must call TMDB's season
      endpoint exactly once per distinct group. A season holding eight selected episodes costs one
      request, not eight. A run that selects nothing must call TMDB zero times.
- [ ] **REQ-5 (Writes are confined to the selection)**: Only the episode rows REQ-2 selected may be
      written. The season fetch returns every episode of that season; the ones outside the selection
      are read and discarded. An episode TMDB reports but that has no row in the database is **not**
      created — a season gaining episodes belongs to `refresh_shows`.
- [ ] **REQ-6 (Fields written)**: For each selected episode matched by `episodeNumber` in the TMDB
      response, the run writes `title`, `overview` and `releaseDate`, and nothing else. `status`,
      `filePath`, and every row on `Season`, `Show` (including `seasonsSyncedAt`), `MediaSource` and
      `ProcessJob` are untouched by this task.
- [ ] **REQ-7 (Missing from TMDB)**: A selected episode whose `episodeNumber` does not appear in the
      season TMDB returned must be left exactly as it is — never blanked, never deleted, never
      counted as processed.
- [ ] **REQ-8 (Item count)**: `itemsProcessed` on the run record must be the number of episode rows
      actually written, so a run that found nothing pending reports `0` and is distinguishable from
      one that failed.
- [ ] **REQ-9 (Partial failure)**: A TMDB failure while fetching one season must not abort the run.
      The remaining seasons are still fetched and written, and the run finishes with outcome
      `FAILED` and an error message naming how many seasons failed — `itemsProcessed` still counts
      what succeeded.
- [ ] **REQ-10 (Manual trigger)**: `runScheduledTask(id: "refresh_episodes")` performs the same
      sweep, whether or not the task is enabled, and is subject to the same concurrency guard
      (`035` REQ-5). No separate entry point is added.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (External call budget)**: Requests are issued sequentially, never as a `Promise.all`
      over seasons — the same rule `ShowsService.hydrate()` follows for the same reason: a burst
      against a shared TMDB key rate-limits and leaves the work half-done with no error anywhere.
- [ ] **NFR-2 (Idle cost is zero)**: An installation whose series have all finished airing must make
      no TMDB request at all on a run. The selection query is what bounds the cost of the task; there
      is no separate cap or batch size.
- [ ] **NFR-3 (No new index)**: The selection query scans `episodes` without a new index. At the
      deployment scale this project targets (~5 users, a library in the thousands of rows, once a
      day) a scan is cheaper than a column to maintain; a schema change here would need its own
      justification.
- [ ] **NFR-4 (No TMDB key)**: When `movie_db_api_key` is unset or rejected, the run must finish as
      `FAILED` with the client's error recorded and must not take `api` down, must not disable the
      task, and must not prevent the next occurrence.
- [ ] **NFR-5 (Ownership-blind)**: The sweep operates over the `episodes` table directly. Unlike the
      user-facing resolvers it is not scoped to a user — an episode row is shared by every user who
      registered that series, and refreshing its title is not a read of anyone's library.
- [ ] **NFR-6 (Standing cost of open-ended rows)**: An episode whose `releaseDate` is `NULL` in both
      the database and TMDB — commonly a season-0 special of a series that has ended — is selected
      on every run forever, costing one request per run for its season. Specials are included on
      purpose, matching `hydrate()`, which does not filter season 0. If that cost is judged wrong on
      review, the fix is to narrow REQ-2, not to add a suppression list.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.**

The task is fired and observed entirely through the surface `035-scheduled-tasks` already froze:
`scheduledTasks` reports its `enabled`, `cron`, `running`, `nextRunAt` and `lastRun`, and
`runScheduledTask(id: "refresh_episodes")` triggers it. The outcome of this work reaches `web` as a
larger `itemsProcessed` and as episode titles that were already being rendered on `/shows/{id}`.
No new type, field, argument, error condition or i18n key is introduced, and no `web` or `worker`
code has anything to retype.

## Data Model Changes

**None.**

`Episode.title`, `Episode.overview` and `Episode.releaseDate` already exist and are already nullable
(`services/api/prisma/schema.prisma`); this feature only writes them from a second caller. No model,
field, enum, index or migration is added — see NFR-3 for why the selection query does not get one.

## Acceptance Criteria

- [x] **AC-1**: Given a registered series with an episode whose `releaseDate` is three days in the
      future and whose `title` is `NULL`, when `runScheduledTask(id: "refresh_episodes")` is called
      by an admin, then `bin/mysql -e "select title, overview, releaseDate from episodes where id = <id>"`
      shows the values TMDB currently reports, and the run's `lastRun` has `outcome: SUCCESS` with
      `itemsProcessed` ≥ 1.
      *Observed:* T004, live pass. Registered "Lanterns" (tmdbId 95350, today 2026-09-03) — its
      episode 4 (id=4, `releaseDate: 2026-09-06`) sat with the placeholder `title: "Episode 4"` and
      empty `overview` straight from `hydrate()`. `runScheduledTask(id: "refresh_episodes")` returned
      `lastRun: { outcome: SUCCESS, itemsProcessed: 5 }`; episodes 4–8 (the whole pending window)
      each had `updatedAt` move to the run's timestamp, rewritten with TMDB's current values.
- [x] **AC-2**: Given a series whose season 1 has eight episodes selected by REQ-2, when the task
      runs, then exactly one request to `tv/{tmdbId}/season/1` is issued for that season (observable
      in `api`'s logs / a stubbed client in the unit test), not eight.
      *Observed:* T002, `refresh-episodes.task.spec.ts` → `one fetch per season (REQ-4)`: asserts
      `seasonDetails` is called exactly once per distinct `(tmdbId, seasonNumber)` group across two
      seasons of one series and one season of another (three total), never once per episode.
- [x] **AC-3**: Given an episode that aired 30 days ago with a hand-edited title in the database,
      when the task runs, then that row's `title`, `overview` and `releaseDate` are byte-identical to
      what they were before the run — it was never selected and never written.
      *Observed:* T002's `selection boundary (REQ-2, REQ-3)` case, plus T004 live: episode 1 of
      "Lanterns" (aired 2026-08-16, 18 days before the run) kept `updatedAt: 2026-09-03 04:10:25.893`
      unchanged across both live runs — never selected, never written.
- [x] **AC-4**: Given a library in which every episode aired more than two days ago, when the task
      runs, then `lastRun` is `SUCCESS` with `itemsProcessed: 0` and zero TMDB requests were made.
      *Observed:* T002, the empty-selection early return (`run()` returns `{ itemsProcessed: 0 }`
      before any `seasonDetails` call) — covered by the same boundary test's call-count assertion, as
      `api/plan.md` § Tests states it would be.
- [x] **AC-5 (failure path)**: Given `movie_db_api_key` set to an invalid value, when the task runs,
      then `lastRun.outcome` is `FAILED` with the TMDB error recorded in `lastRun.error`, the
      `api` container stays healthy, `schedule_refresh_episodes_enabled` is still whatever it was,
      and a subsequent manual trigger runs again rather than being locked out.
      *Observed:* T004, live pass. Set `movie_db_api_key` to `"invalid-garbage-key"`, triggered
      again: `lastRun: { outcome: FAILED, itemsProcessed: 0, error: "Error: refresh_episodes: 1 of 1
      season(s) failed; 0 episode(s) written successfully" }`; `docker compose ps api` stayed
      `healthy` throughout; `schedule_refresh_episodes_enabled` was never touched (stayed `false`,
      its seeded value); restoring the real key and triggering a third time returned
      `outcome: SUCCESS, itemsProcessed: 5` — no lockout.
- [x] **AC-6 (failure path)**: Given two seasons selected and TMDB failing for the first one only,
      when the task runs, then the second season's episodes are still written, `itemsProcessed`
      counts only those, and `lastRun.outcome` is `FAILED` with a message naming one failed season.
      *Observed:* T002, `partial failure (REQ-9)`: first-of-two-groups' `seasonDetails` rejects;
      asserts the second group's episodes are still written and `run()` throws naming one failed
      season.
- [x] **AC-7 (failure path)**: Given a selected episode whose `episodeNumber` is absent from the
      season TMDB returns, when the task runs, then that row is unchanged and is not included in
      `itemsProcessed`.
      *Observed:* T002, `episode missing from TMDB response (REQ-7)`: a season response omitting one
      selected `episodeNumber`; asserts no `update` for that row and it is excluded from
      `itemsProcessed`.
- [x] **AC-8**: `bin/npm api run test` exits 0, and the suite includes a case for AC-3, AC-6 and
      AC-7 — the three outcomes that would otherwise fail silently (Article IX).
      *Observed:* T003. `bin/npm api run test` → `Test Suites: 36 passed, 36 total`,
      `Tests: 336 passed, 336 total` (up from 331/35 before this feature — the one new suite,
      `refresh-episodes.task.spec.ts`, adds 5 cases). `bin/cli api npx --no tsc --noEmit` → 0 errors.
      `git diff --stat services/api/src/schema.gql services/api/prisma` → empty.

## Out of Scope

- **The other three task bodies.** `refresh_movies`, `refresh_shows` and `acquire_pending` stay the
  stubs `035` left. In particular, discovering a **new season** or a **new episode** that has no row
  yet is `refresh_shows`' job — this task only refreshes rows that already exist (REQ-5).
- **Deleting episodes TMDB no longer lists.** A row that vanishes from the catalog is left alone
  (REQ-7). Deletion touches `MediaSource`, `ProcessJob` and files on disk, and is its own decision.
- **Promoting status.** Nothing here changes an episode's `MediaStatus` or looks for a release; an
  episode whose air date just passed does not become acquirable by this task. That is
  `acquire_pending`.
- **A per-series or per-user refresh button.** The sweep is installation-wide and fired by the
  scheduler or its existing manual trigger. A "refresh this series" control on the detail page is a
  `web` feature with its own contract delta.
- **Caching the season fetch.** `ShowsService.hydrate()` calls `seasonDetails` uncached today and
  this task does the same. Adding a Redis layer under it would change behaviour for registration too,
  and NFR-2 already makes an idle run free.
- **Backfilling the two-day window after downtime.** `035` NFR-5 stands: a missed occurrence is
  skipped, not replayed. An episode that aired during a three-day outage falls outside the window
  and keeps whatever data it had.

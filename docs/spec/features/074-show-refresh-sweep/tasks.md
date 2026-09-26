---
title: Show Refresh Sweep — Tasks
last_updated: 2026-09-26
status: Done
---

# TASKS: Show Refresh Sweep (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Single-service feature: every implementation task is `[api]`, so `[P]` buys little here — it marks
tasks with no ordering constraint between them, not a second agent to run them.

**Before the first task**, check the working tree. `073-automatic-episode-acquisition` is being
implemented concurrently and owns `scheduler.module.ts`'s `imports`/`providers` arrays and a new
`scheduler.registry.ts` entry. Rebase onto its work; never revert it. This feature does not touch
`scheduler.registry.ts` at all — `refresh_shows` is already registered there.

## Tasks

### Group 1 — the column and the shared catalog step

- [x] **T001** `[api]` Add `tmdbStatus String?` to `model Show` in
      `services/api/prisma/schema.prisma`, beside `seasonsSyncedAt`, and generate the migration with
      `bin/npm api run prisma:migrate` (name it `add_show_tmdb_status`). No backfill, no index, no
      default. Do **not** name it `status` — `Show.status` is already `MediaStatus`.
      *Done when:* `git status --short services/api/prisma` shows a modified `schema.prisma` plus
      exactly one new migration directory, and `bin/cli api npx prisma migrate status` reports
      nothing pending.

- [x] **T002** `[api]` In `services/api/src/shows/shows.service.ts`, extract the catalog half of
      `refresh()` (its inner `try`: `tmdb.details()`, the `show.update()`, `syncSeasonsAndEpisodes()`,
      the `seasonsSyncedAt` stamp, `cacheShows()`) into a private `syncCatalogFromTmdb(showId,
      tmdbId)` that still **throws** on failure, and add a public `syncCatalogClaimed(showId,
      tmdbId): Promise<boolean>` that takes the existing `show:hydrate:<tmdbId>` claim with
      `SET … EX … NX`, resolves `false` untouched when it is held, calls the private method, and
      deletes the claim in a `finally`. Behaviour-preserving: `refresh()` keeps its own claim, its own
      `try/catch` and its `RefreshCatalogOutcome`; the media-server call stays outside the extracted
      body; the `seasonsSyncedAt` stamp stays **after** the season loop.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `bin/npm api test` passes
      with every pre-existing `shows.service.spec.ts` `refresh` case **unmodified**. If a case needs
      editing, stop and report — the extraction changed behaviour (`plan.md` § Risks).

- [x] **T003** `[api]` Write the status: `tmdbStatus: detail.status` on the `show.update()` inside
      `syncCatalogFromTmdb()`, and on the `show.update()` `hydrate()` already makes for
      `seasonsSyncedAt`. Leave `register()`'s `show.create()` alone — it builds from a cached
      `MediaSearchResult` that carries no status, and hydration fills the column seconds later.
      → T001, T002
      *Done when:* registering a finished series on the dev stack and waiting for hydration,
      `bin/mysql -e 'select id, title, tmdbStatus, seasonsSyncedAt from shows'` shows both columns
      populated and the finished series reading `Ended` (**AC-1**).

### Group 2 — the sweep

- [x] **T004** `[api]` Replace the `RefreshShowsTask` stub body in
      `services/api/src/scheduler/tasks/refresh-shows.task.ts` (inject `PrismaService` and
      `ShowsService`): module-level `ENDED_REFRESH_DAYS = 180`, `CONTINUING_REFRESH_DAYS = 30` and
      `ENDED_STATUSES = ['Ended', 'Canceled']`; one `findMany` selecting due series ordered by
      `seasonsSyncedAt` ascending; an early `return { itemsProcessed: 0 }` before any TMDB call when
      nothing is due; a sequential loop calling `syncCatalogClaimed()` with a per-series `try/catch`
      (`false` → skipped, uncounted, not a failure); and a final `throw` naming failed/total/written
      counts when any series failed. The continuing branch of the `where` must be an explicit `OR` of
      `{ tmdbStatus: null }` and `{ tmdbStatus: { notIn: ENDED_STATUSES } }` — `notIn` alone silently
      excludes every `NULL` row (`plan.md` § Risks, row 1). In the same task, add `ShowsModule` to
      `SchedulerModule`'s `imports` (no `forwardRef`; if `073` already added it, that half is done).
      → T003
      *Done when:* `api` reaches healthy and Settings → Scheduling still lists every task; with one
      series aged by
      `bin/mysql -e "update shows set seasonsSyncedAt = date_sub(now(), interval 40 day) where id = <id>"`,
      "Ejecutar ahora" on `refresh_shows` records a `SUCCESS` run with `itemsProcessed: 1` and that
      series' `seasonsSyncedAt` is now (**AC-2**); re-aged to `interval 20 day` the same trigger
      records `SUCCESS` with 0 (**AC-3**).

### Group 3 — tests

- [x] **T005** `[api]` Write `services/api/src/scheduler/tasks/refresh-shows.task.spec.ts`, following
      the shape and Article IX header style of `refresh-episodes.task.spec.ts` — the header names the
      class of failure: a sweep that reports a clean `SUCCESS` while selecting the wrong set, and
      nothing else in the system notices a series that stopped being refreshed. Cases, each written
      to fail if the rule it pins is removed: a `NULL`-status series past the continuing window is
      selected (asserted against the generated `where`, so dropping the `{ tmdbStatus: null }` arm
      fails); both cadence boundaries on both sides (`Ended` at 100 vs 200 days, `Returning Series` at
      20 vs 40); `seasonsSyncedAt: null` always selected; an unrecognised status takes the continuing
      window, never the ended one; nothing due → zero calls into `ShowsService`; series two still
      refreshed when series one throws, and the handler then throws carrying both counts; a series
      whose claim is held is neither counted nor failed.
      → T004
      *Done when:* `bin/npm api test` passes with the new suite, and temporarily reverting the
      `{ tmdbStatus: null }` arm in T004's `where` makes exactly that case fail.

- [x] **T006** `[api] [P]` Extend `services/api/src/shows/shows.service.spec.ts` for the new surface
      only: `tmdbStatus` is written from `detail.status`; `syncCatalogClaimed()` resolves `false` and
      issues no TMDB call when the Redis `SET NX` does not return `'OK'`; a rejecting `seasonDetails`
      leaves the `seasonsSyncedAt` stamp unwritten. Do not edit the existing `refresh` cases.
      → T003
      *Done when:* `bin/npm api test` passes, the new cases are present, and
      `git diff services/api/src/shows/shows.service.spec.ts` shows additions only inside the existing
      `describe`, with no pre-existing case rewritten.

### Group 4 — verification and docs

- [x] **T007** `[api]` Run the full verification sweep of `api/plan.md` § Done when and record the
      numbers: `bin/cli api npx --no tsc --noEmit`, `bin/npm api test`,
      `bin/cli api npx prisma migrate status`, `git status --short services/api/prisma`,
      `git diff --stat services/api/src/schema.gql`.
      → T005, T006
      *Done when:* 0 typecheck errors; the suite passes with its new total reported as
      `<tests>/<suites>`; nothing pending in `migrate status`; a modified `schema.prisma` plus exactly
      one migration directory; and the `schema.gql` diff is **empty** (**AC-12**, Article VIII).

- [x] **T008** `[docs]` Update the `CLAUDE.md` files. In `services/api/CLAUDE.md`: the `scheduler/`
      bullet says three tasks still stub `run()` — after this, `refresh_shows` is real, so describe
      its selection rule, its two constants, the claim it shares with `ShowsService`, and that it
      writes catalog rows only; the `shows/` territory gains `Show.tmdbStatus` and the shared catalog
      step that `hydrate()`, `refresh()` and the sweep all go through. In the root `CLAUDE.md`: the
      "Register title in DB" row names `refresh_episodes` as the only scheduled sweep — add
      `refresh_shows` beside it with its cadence, and append T007's measured counts to
      § Current state.
      → T007
      *Done when:* both files describe the shipped behaviour, and `grep -n "three still stub"
      services/api/CLAUDE.md` returns nothing.

- [x] **T009** `[docs]` Walk the acceptance criteria in `spec.md` against a running dev stack,
      following `plan.md` § Verification's manual pass (steps 2 through 8 cover AC-2 to AC-11,
      including the two failure paths: a garbage `movie_db_api_key` with two series due, and
      `shows_enabled` false refusing the manual trigger). Tick each box that was actually exercised,
      and record under the criteria — as `069`, `070` and `071` do — exactly which were **not** run
      and why. Then set `status: Implemented` on `spec.md`, `plan.md` and `api/plan.md`.
      → T008
      *Done when:* every AC in `spec.md` is either ticked or named in the live-pass note with a
      reason, and the three files read `status: Implemented`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

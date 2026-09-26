---
title: Movie Refresh Sweep — Tasks
last_updated: 2026-09-26
status: Draft
---

# TASKS: Movie Refresh Sweep (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Every task in this feature is `[api]` or `[docs]`: `services: [api]`, no GraphQL delta, and
`../plan.md` § Verification ends with `git diff --stat services/web services/worker` printing nothing
(AC-14). A task that finds itself editing `services/web` or `services/worker` is scoped wrong — stop
and report.

## Tasks

### Group 1 — schema and the two independent seams

Three genuinely parallel tasks: the migration, the TMDB client and the pure closure rule touch
disjoint files and none reads the others.

- [ ] **T001** `[api] [P]` Add the five nullable columns to `model Movie` in
      `services/api/prisma/schema.prisma` — `theatricalReleaseDate`, `digitalReleaseDate`,
      `physicalReleaseDate` (`DateTime?`), `tmdbStatus` (`String?`), `catalogClosedAt` (`DateTime?`) —
      and generate the migration with `bin/npm api run prisma:migrate`. `tmdbStatus`, never `status`:
      `Movie.status` is `MediaStatus` and means the pipeline state. No backfill (NFR-5).
      *Done when:* `git status --short services/api/prisma` shows a modified `schema.prisma` **and**
      exactly one new migration directory, and `bin/cli api npx prisma migrate status` reports no
      pending migration. (AC-13)
- [ ] **T002** `[api] [P]` Replace `TmdbClient.earliestMovieReleaseDate()` in
      `services/api/src/clients/tmdb/client.ts` with a method returning all four days from the same
      single `GET movie/{id}/release_dates` request, and add the `MovieReleaseDates` shape plus the
      `MovieDBClient` signature change to `services/api/src/clients/types.ts`. TMDB release types `2`
      and `3` both feed `theatrical`, `4` feeds `digital`, `5` feeds `physical`; every entry —
      including premiere, TV, and an unrecognised or missing type — still counts toward `earliest`,
      which is what keeps REQ-2 true. Keep the existing ten-character slice and
      `^\d{4}-\d{2}-\d{2}$` validation. Do **not** add a second method beside the old one.
      *Done when:* `grep -rn "earliestMovieReleaseDate" services/api/src` returns nothing, and
      `bin/cli api npx --no tsc --noEmit` reports errors only at the two former call sites in
      `movies.service.ts` (fixed by T004/T005) and nowhere else.
- [ ] **T003** `[api] [P]` Add `services/api/src/movies/release-window.ts`: one pure function
      answering whether a film is closed, from the four days, the TMDB status and a `now`. Rule per
      `../spec.md` REQ-8 — closed when the status is `Canceled`; closed when nothing is in the future
      **and** the newest known date is more than 365 days before `now`; open when any date is in the
      future; open when no date is known at all and the status is not `Canceled`. The 365 is a
      module-level constant, not a Setting. Compare on UTC day boundaries the way
      `refresh-episodes.task.ts` builds its cutoff. Follows `media/content-kind.ts`, not the inline
      `isShortRuntime` helper.
      *Done when:* the file exports the function, imports nothing from Prisma or the TMDB client, and
      `bin/cli api npx --no tsc --noEmit` reports nothing new in it.
- [ ] **T004** `[api]` Add `services/api/src/movies/release-window.spec.ts` — the one test this
      feature genuinely owes (Article IX): a wrong closure rule produces no error, no log and no UI,
      the film simply stops being refreshed forever. Open with the header paragraph naming that
      failure. Cover both sides of the 365-day boundary, a future date sitting beside old ones (open),
      `Canceled` with a future date (closed), every date `null` with a non-`Canceled` status (open,
      never closed by age), and "newest date wins" when the four disagree. → T003
      *Done when:* `bin/npm api test -- release-window` passes, and each case fails if the rule it
      covers is removed.

### Group 2 — the write path

`refreshCatalog` and `register()` live in the same file, so T005 and T006 are sequential, not
parallel. Both need Group 1.

- [ ] **T005** `[api]` In `services/api/src/movies/movies.service.ts`, make `refreshCatalog` public
      and extend its existing `try` to write the three typed dates and `tmdbStatus` alongside the
      fields it already writes, then evaluate T003's rule against the values just read and write
      `catalogClosedAt` — a timestamp when closed, `null` when open, on every successful refresh (that
      single write is REQ-8 and REQ-11 at once). Nothing moves into the `catch`: a failed refresh must
      leave `catalogClosedAt` exactly as it was (REQ-9). Keep the "never erase" posture — an absent
      value passes `undefined`, not `null`; `catalogClosedAt` is the only column that may be set back
      to `null`. Retarget the former `earliestMovieReleaseDate` call site here at T002's method, with
      `releaseDate` still derived from `earliest` falling back to the detail's own `release_date`.
      → T001, T002, T003
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, and pressing Refresh on
      `/movies/<id>` of a film whose dates are all old writes a `catalogClosedAt`, while the same
      press on a film with a future date leaves it `NULL`. (AC-8)
- [ ] **T006** `[api]` In the same file, carry the four days and TMDB's production status on the
      cached entry: extend `topUpCatalogFacts`'s `needsRelease` branch to store all four days and its
      `needsDetails` branch to carry the status, add a **new, distinctly named** optional field to the
      cached `MediaSearchResult` in `clients/types.ts` for it — `MediaSearchResult.status` is already
      taken and already means the pipeline status on the wire, so writing TMDB's string there renders
      a bogus badge in `web` with no error anywhere — and have `register()` write the dates and status
      from the topped-up entry when present, `undefined` when not. `register()` must gain **no** TMDB
      request (REQ-3/REQ-5) and must never write `catalogClosedAt`. → T005
      *Done when:* registering a film from a cold cache fills the typed columns
      (`bin/mysql -e "select title, releaseDate, theatricalReleaseDate, digitalReleaseDate, physicalReleaseDate, tmdbStatus from movies"`),
      and a registration served from a warm cache makes the same number of TMDB calls it makes today.
      (AC-1)
- [ ] **T007** `[api] [P]` Extend `services/api/src/clients/tmdb/client.spec.ts`: retarget the
      existing `earliestMovieReleaseDate` cases at T002's method and keep them proving `earliest` is
      unchanged — a regression there silently moves every film in `062`'s calendar. Add type `2` and
      type `3` both landing in `theatrical`, earliest-across-countries per type, a type with no entry
      anywhere staying `null`, and an unrecognised or missing type counting toward `earliest` only.
      → T002
      *Done when:* `bin/npm api test -- tmdb/client` passes with strictly more cases than before.
- [ ] **T008** `[api] [P]` Extend `services/api/src/movies/movies.service.spec.ts` with two
      assertions: the TMDB call budget of a warm-cache registration is unchanged (REQ-3), and a failed
      `refreshCatalog` leaves `catalogClosedAt` untouched (REQ-9 — whose live check needs an invalid
      TMDB key and so will rarely be run). → T006
      *Done when:* `bin/npm api test -- movies.service` passes with both new cases, and the second
      fails if the closure evaluation is moved out of the `try`.

### Group 3 — the sweep

- [ ] **T009** `[api]` Replace `RefreshMoviesTask.run()`'s stub body in
      `services/api/src/scheduler/tasks/refresh-movies.task.ts`. Inject `PrismaService` and
      `MoviesService`; select `{ status: { not: COMPLETED }, catalogClosedAt: null }` taking `id` and
      `tmdbId` only; return `{ itemsProcessed: 0 }` immediately on an empty selection (NFR-2); loop
      **sequentially**, never `Promise.all` (NFR-1), calling `refreshCatalog` per film. Count a
      `FAILED` return exactly like a caught throw — `refreshCatalog` reports a TMDB failure by return
      value, so a loop that only counts throws reports every failed film as a success. Return the
      success count when nothing failed, otherwise `throw` naming failed / total / succeeded, which is
      what makes `runTask` record `FAILED`. Do not create run rows, do not catch the final throw, do
      not check `movies_enabled` — the registry's `mediaType: 'movie'` and `runTask` already do.
      → T005
      *Done when:* the handler no longer returns a hardcoded zero, and `scheduler.registry.ts` and
      `prisma/seeds/settings.ts` are absent from the diff (`git diff --stat` on both) — the task id,
      its cron and its Settings rows already exist and are correct.
- [ ] **T010** `[api]` Add `MoviesModule` to `SchedulerModule`'s imports in
      `services/api/src/scheduler/scheduler.module.ts`, then boot the stack and read the log. If Nest
      reports a circular dependency or hands the task an `undefined` `MoviesService`, wrap it as
      `forwardRef(() => MoviesModule)` — `settings.module.ts` has the pattern and the comment
      explaining why. An `undefined` service inside a cron-only task is a failure nobody sees until
      4am, so this task is not done on a clean typecheck alone. → T009
      *Done when:* the stack boots with no Nest resolution error, and triggering `refresh_movies` from
      Settings → Scheduling ("Ejecutar ahora") produces a run row rather than a `FAILED` row naming an
      injection error. (AC-2)
- [ ] **T011** `[api]` Add `services/api/src/scheduler/tasks/refresh-movies.task.spec.ts`, modelled on
      `refresh-episodes.task.spec.ts` (including its Article IX header). Three silent failures to
      cover: a selection that includes `COMPLETED` or closed films quietly spends the TMDB budget this
      feature exists to protect and makes REQ-10 unverifiable from outside; a `Promise.all` instead of
      a sequential loop rate-limits a shared key and leaves the sweep half-done with no error; and a
      run that counts a `FAILED` refresh as processed, or swallows the final throw, reports a clean
      `SUCCESS` on a sweep that did nothing. Also assert the empty selection makes zero
      `refreshCatalog` calls (NFR-2). → T009
      *Done when:* `bin/npm api test -- refresh-movies` passes and each case fails if its rule is
      removed.

### Group 4 — verification and docs

- [ ] **T012** `[api]` Run the full slice verification from `api/plan.md` § Done when.
      → T004, T006, T007, T008, T010, T011
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors; `bin/npm api test` is green
      with a strictly higher test count than the 735/52 in the root `CLAUDE.md` (re-measure, do not
      cite); `bin/cli api npx prisma migrate status` reports no pending migration;
      `git diff --stat services/web services/worker` prints nothing (AC-14); and
      `services/api/src/schema.gql` is absent from the diff — no decorator changed, so there is
      nothing to regenerate (Article IV).
- [ ] **T013** `[docs]` Update the root `CLAUDE.md` "Register title in DB" pipeline row and the
      `scheduler/` and `movies/` notes in `services/api/CLAUDE.md`: `refresh_movies` is no longer a
      stub, a film now carries three typed release dates, a TMDB production status and a closure
      marker, and the sweep never acquires anything. Record the re-measured test counts from T012 in
      the root "Current state" section. → T012
      *Done when:* neither file still describes `refresh_movies` as a stub, and the count of stubbed
      scheduler tasks named in `services/api/CLAUDE.md` matches reality (`acquire_pending` and
      `refresh_shows`, until `074` lands).
- [ ] **T014** `[docs]` Walk the manual pass in `../plan.md` § Verification against a dev stack with
      at least three registered films — one upcoming, one released within the last year, one released
      more than a year ago with no digital or physical date — ticking AC-1 to AC-14 in `spec.md`.
      AC-11 (invalid TMDB key: `FAILED`, counts in the error, nothing closed, nothing blanked) and
      AC-12 (`movies_enabled` false: the `error.schedule.task_unavailable` refusal, no run row) are
      the two failure paths and must both actually be run. Record honestly which criteria were **not**
      reached and why. Then set `status: Implemented` on `spec.md`, `plan.md` and `api/plan.md`, and
      `status: Done` here. → T013
      *Done when:* every AC box in `spec.md` is ticked or explicitly recorded as not run with its
      reason, and all four files carry their closing status.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Empty is the normal state. Contract problems always land here (Article VIII) — and for this feature
the contract is `None`, so the likeliest entry is an agent concluding one of the five new columns
ought to be exposed through GraphQL. That is a stop-and-report, not a one-line `@Field()`.

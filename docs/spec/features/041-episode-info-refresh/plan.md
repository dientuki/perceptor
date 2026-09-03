---
title: Episode Info Refresh — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-03
status: Implemented
---

# PLAN: Episode Info Refresh (`plan.md`)

## Approach

This feature replaces one stub body and adds nothing else. `services/api/src/scheduler/` already
owns everything around the work — the registry entry for `refresh_episodes`, its Settings-backed
cadence, the concurrency guard, the run record, the manual trigger, the failure containment that
keeps a throwing handler from taking `api` down. `RefreshEpisodesTask.run()` is the one seam, and
its signature (`Promise<{ itemsProcessed: number }>`) is already the contract `SchedulerService`
consumes. Nothing in `scheduler.service.ts`, `scheduler.registry.ts`, `scheduler.resolver.ts` or
the entities is touched.

The body itself is a narrower version of a walk this codebase already performs.
`ShowsService.hydrate()` (`services/api/src/shows/shows.service.ts:139`) iterates a series' seasons,
calls `TmdbClient.seasonDetails(tmdbId, seasonNumber)` and upserts each episode's `title`,
`overview` and `releaseDate`. This task reuses the same client method and the same three fields,
but inverts the traversal: instead of starting from a show and fetching everything, it starts from
the `episodes` rows that are still in flight (REQ-2), derives the distinct
`(show.tmdbId, season.seasonNumber)` pairs they belong to, fetches each of those once (REQ-4), and
writes back only the rows it selected (REQ-5).

The alternative worth naming and rejecting: **extracting a shared "sync a season" helper used by
both `hydrate()` and this task.** It looks like the Article X move and is not. `hydrate()` upserts —
it creates rows that do not exist, walks *every* season, and stamps `seasonsSyncedAt` when it
finishes. This task updates only, walks a filtered set, and is forbidden from touching `Season` or
`Show` at all (REQ-6). A helper covering both would need flags for create-vs-update, for the
season-write and for the stamp, which is three special cases in the name of removing one loop. The
duplication that remains is the `seasonDetails` call and the three field names; `movies`/`shows`
already carry deliberate duplication of the same order (`006-media-search` § Out of Scope, cited by
Article X itself). If a third caller appears, extract then, with two real use cases in hand.

The task also does **not** reuse `ShowsService` as an injected dependency. Pulling a user-facing,
ownership-scoped service into a background sweep (which is deliberately ownership-blind, NFR-5)
would couple the two for no gain; the task depends on `PrismaService` and `TmdbClient` directly,
both of which reach it through modules `SchedulerModule` already imports.

## Order of Work

One service, so there is no cross-service sequencing to get wrong and nothing runs in parallel.
The steps below are still ordered, because the test is what proves the two silent failures.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Writes the handler body in `src/scheduler/tasks/refresh-episodes.task.ts` and wires its two dependencies. Nothing else can be verified before it exists. |
| 2 | `api` | Adds `refresh-episodes.task.spec.ts` — the selection window, the one-fetch-per-season fan-in and the partial-failure outcome are the three things that fail with no error anywhere (Article IX). |
| 3 | `docs` | Updates the `scheduler/` bullet in `services/api/CLAUDE.md` (it currently states all four handlers are stubs, which stops being true) and the root `CLAUDE.md` test counts. Orchestrator task, not the `api` agent's. |

`web` and `worker` have no slice. There is no `web/plan.md` or `worker/plan.md` in this directory,
and that absence is the instruction: neither service has work here.

## Contract Freeze

`spec.md` § GraphQL Contract Delta says **None — this feature does not cross the service boundary**,
and that is frozen as of `status: Approved` exactly like a non-empty delta would be. The two things
an implementer will be tempted to add, and must not:

- **A GraphQL field, query or mutation.** The task is observed entirely through `scheduledTasks`
  and fired through `runScheduledTask`, both frozen by `035-scheduled-tasks`. A "last refreshed"
  field on `Episode`, or a per-series refresh mutation, is a different feature with its own spec.
  `services/api/src/schema.gql` must be byte-identical after this change — if it moves, something
  gained a decorator it should not have.
- **A Settings key for the grace period.** REQ-3 is explicit: two days is a constant in `api`. A
  `schedule_refresh_episodes_grace_days` row would put a third knob next to the two the Scheduling
  tab already renders, and `web` would then owe it a form field — which would make this a
  two-service feature after the contract was frozen as a zero-service one.
- **A new `error-keys.ts` entry.** A scheduled task's failure is recorded on the run row, not
  thrown at a user; `SchedulerService.runTask` stringifies whatever escapes the handler. There is
  no caller to translate for.

## Migrations

**None.**

`Episode.title`, `Episode.overview` and `Episode.releaseDate` already exist and are already
nullable. No model, field, enum or index is added — NFR-3 states why the selection query does not
get one. `services/api/prisma/` must not appear in this feature's diff at all; if it does, the
implementer has exceeded the plan and should stop and report.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The selection window is written as "not yet aired" only, dropping the two-day grace | Every episode whose title TMDB fills in *at* air time keeps its placeholder forever. Nothing errors; the sweep reports `SUCCESS` with a plausible `itemsProcessed` | REQ-2 is a single `OR` condition (`releaseDate: null` OR `releaseDate >= cutoff`), and the spec test pins an episode on each side of the boundary |
| The window is written as "aired in the last two days" only, dropping the unaired half | The exact case the feature exists for — an episode airing in three days — is never selected. Reports `SUCCESS`, `itemsProcessed: 0`, looks like an idle library | Same test, same boundary cases; AC-4 distinguishes a genuinely idle library from a broken filter by also asserting zero TMDB requests |
| One TMDB request per *episode* instead of per season | Correct output, silently 8× the external call budget on a season pack's worth of pending episodes. Invisible until TMDB rate-limits, at which point it fails as an unrelated-looking error | The fan-in is the point of REQ-4; the test asserts the mocked client's call count, which is the only place this is observable |
| A selected episode missing from TMDB's response is written as `null`/`undefined` | Silent data loss: a title that was correct is blanked, and the next run re-selects the row and blanks it again | REQ-7; the test feeds a season response that omits one selected `episodeNumber` and asserts the row is untouched *and* not counted |
| One season's fetch throws and aborts the whole run | Every season after the failing one is silently skipped. The run is `FAILED`, which looks like total failure, so nobody notices the sweep is also permanently stuck behind the same bad season | REQ-9: the per-season call is caught individually, the loop continues, `itemsProcessed` still counts the successes, and the error message names the failure count |
| `Promise.all` over seasons | Bursts against a shared TMDB key; rate-limited responses leave the sweep half-done, and REQ-9's containment turns that into a `FAILED` run with a partial write that looks the same as a legitimate partial | NFR-1 — sequential `for…of`, identical to `hydrate()`'s loop and for the identical reason stated in its comment |
| The task touches `Season`, `Show.seasonsSyncedAt` or `Episode.status` | A scheduled sweep silently rewrites acquisition state; an episode already `COMPLETED` on disk could be walked back to `MISSING` with no user action and no error | REQ-6 restricts the `data:` object to three fields. A reviewer checks the `update()` call has exactly `title`, `overview`, `releaseDate` |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
git diff --stat services/api/src/schema.gql services/api/prisma
```

The third command must print nothing: this feature adds no GraphQL surface (§ Contract Freeze) and
no migration (§ Migrations), so both paths staying out of the diff is a positive check, not an
absence of one.

Then the manual pass, against a running stack with a valid `movie_db_api_key`:

1. Register a currently-airing series from `/search` and wait for hydration
   (`bin/mysql -e "select seasonsSyncedAt from shows where tmdbId = <id>"` non-null).
2. Blank a pending episode by hand to simulate stale data:
   `bin/mysql -e "update episodes set title = null, overview = null where id = <id>"`, choosing a
   row whose `releaseDate` is in the future. Record the `title` of a second row that aired a month
   ago.
3. As an admin, run `runScheduledTask(id: "refresh_episodes")` from the Scheduling tab's
   "Ejecutar ahora" (or the GraphQL playground).
4. `bin/mysql -e "select id, title, releaseDate, updatedAt from episodes where seasonId = <id>"` —
   the blanked future episode has its TMDB title back (AC-1); the month-old row is unchanged
   (AC-3). The Scheduling tab shows `SUCCESS` with a non-zero `itemsProcessed` (AC-8's counterpart).
5. Failure pass: set `movie_db_api_key` to garbage in Settings, trigger again, and confirm the row
   shows `FAILED` with the TMDB error inline, `docker compose ps` still shows `api` healthy, and a
   third trigger after restoring the key succeeds (AC-5).

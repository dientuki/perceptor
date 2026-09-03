---
title: Episode Info Refresh — api slice
service: api
last_updated: 2026-09-03
status: Implemented
---

# PLAN: Episode Info Refresh — `api` (`api/plan.md`)

## Scope

This slice writes the body of the `refresh_episodes` scheduled task and its test. That is the whole
feature: `api` is the only service in `services:`, there is no `web/plan.md` and no
`worker/plan.md`, and neither of those services has anything to consume — the sweep produces no new
GraphQL surface, only fresher rows behind the episode fields `/shows/{id}` already renders.

Explicitly **not** in this slice, even though the files sit next to the one you are editing: the
scheduler itself (`scheduler.service.ts`, `scheduler.registry.ts`, `scheduler.resolver.ts`, the
entities) is finished and correct; the other three task stubs stay stubs; the Prisma schema and
`schema.gql` must not move (`../plan.md` § Contract Freeze, § Migrations). Writes are confined to
`services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/scheduler/tasks/refresh-episodes.task.ts` | Modified | The stub `run()` is replaced by the sweep. Gains `PrismaService` and `TmdbClient` as constructor dependencies. The class name, its `@Injectable()`, its `implements ScheduledTaskHandler` and its return shape are unchanged. |
| `services/api/src/scheduler/tasks/refresh-episodes.task.spec.ts` | New | Article IX cover for the three silent failures listed under § Tests. |

`services/api/src/scheduler/scheduler.module.ts` is expected **not** to change: `PrismaModule` is
already imported and `SettingsModule` (which exports `TmdbClient` — see
`services/api/src/settings/settings.module.ts:31`) is already imported through `forwardRef`. If
Nest cannot resolve `TmdbClient` into the task at boot, that is the one case where touching the
module is in scope; anything beyond adding it to that import list is a stop-and-report.

A new module, a new service class, or a new file outside the two above means this plan missed
something — report it rather than creating one.

## Existing code to reuse

- `services/api/src/shows/shows.service.ts:139` (`hydrate()`) — the reference implementation for
  the loop's shape: sequential `for…of` over seasons, `await this.tmdb.seasonDetails(tmdbId,
  seasonNumber)` inside it, and the same three episode fields written from
  `episode.title` / `episode.overview` / `episode.releaseDate ? new Date(...) : undefined`. Follow
  its structure; do **not** import it, call it, or refactor it into a shared helper
  (`../plan.md` § Approach says why).
- `services/api/src/clients/tmdb/client.ts:170` (`TmdbClient.seasonDetails`) — the only TMDB call
  this task makes. It already maps TMDB's raw `air_date`/`name`/`episode_number` into
  `EpisodeDetail`, and already throws a descriptive `Error` on a non-2xx response, which is what
  REQ-9's per-season `catch` receives and what NFR-4's invalid-key case surfaces as.
- `services/api/src/clients/types.ts` (`EpisodeDetail`) — the typed shape coming back; match
  episodes on its `episodeNumber`, never on array position.
- `services/api/src/scheduler/scheduler.registry.ts` (`ScheduledTaskHandler`) — the interface the
  class already implements. `run()` keeps returning `{ itemsProcessed: number }`; `SchedulerService`
  owns the run record, the timing, the concurrency guard and the try/catch, so this handler does
  **not** write to `scheduledTaskRun`, does not log its own outcome, and does not catch its own
  top-level failure.
- `services/api/src/prisma/prisma.service.ts` — injected directly. The sweep queries `episode` and
  updates `episode`; it touches no other model.

## Steps

1. **Select the pending episodes.** One `prisma.episode.findMany` with
   `where: { OR: [{ releaseDate: null }, { releaseDate: { gte: cutoff } }] }`, selecting `id`,
   `episodeNumber`, and — through the relation — `season.seasonNumber` and `season.show.tmdbId`.
   No ownership filter (NFR-5). Return `{ itemsProcessed: 0 }` immediately when it comes back empty,
   before any TMDB call, so an idle installation costs zero requests (NFR-2, AC-4).
2. **Compute `cutoff`** as the UTC start of the day two days before the run, from a single `now`
   captured once at the top of `run()`. Start-of-day truncation, not `now - 48h`: it makes the
   window independent of the hour the cron fires, so "two days of grace" means the same thing at
   06:00 and at 23:00, and it makes the boundary cases in the test deterministic. Two days is a
   module-level `const` (REQ-3) — no Setting, no argument, no environment variable.
3. **Group by season.** Build a map keyed by `` `${tmdbId}:${seasonNumber}` `` (the composite,
   never the bare season number, which collides across series) whose value carries the `tmdbId`,
   the `seasonNumber` and the list of selected episode rows.
4. **Walk the groups sequentially.** `for…of`, never `Promise.all` (NFR-1). Per group: call
   `seasonDetails`, index the response by `episodeNumber` into a `Map`, then for each *selected*
   episode of that group look it up. Present → `prisma.episode.update` with exactly
   `{ title, overview, releaseDate }` and increment the counter. Absent → leave the row untouched
   and do not count it (REQ-7). Episodes TMDB returned that are not in the selection are ignored
   entirely (REQ-5) — in particular, never `create` one.
5. **Contain a per-group failure.** Wrap each group's fetch-and-write in its own `try/catch`,
   count the failures, and keep going (REQ-9).
6. **Report.** If any group failed, `throw` an `Error` naming the failed count out of the total —
   `SchedulerService` turns a throw into `outcome: FAILED` with the message on the run row. Because
   a throw discards the return value, accumulate the successful writes into that message too, so a
   partial run stays legible on the Scheduling tab even though `itemsProcessed` records `0` for it.
   Otherwise return `{ itemsProcessed: written }`.

On step 6, resist the tempting alternative of returning a success with a partial count and logging
the failure: a sweep that half-worked must not render as `SUCCESS` on the tab, which is precisely
the silent failure AC-6 exists to catch.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **None — this feature does not cross the service
boundary**, and it is read-only. Concretely, this slice owes the rest of the system:

- **No change to `services/api/src/schema.gql`.** No `@ObjectType`, `@Field`, `@InputType`,
  `@Query` or `@Mutation` decorator is added or edited anywhere in this slice. `git diff` on that
  file after the change must be empty (`../plan.md` § Verification). It is a generated artifact
  (Article IV) — an entry appearing there means a decorator moved that should not have.
- **No change to `services/api/prisma/`.** No migration, no schema edit, no index (NFR-3).
- **The handler's return shape stays `{ itemsProcessed: number }`.** `SchedulerService.runTask`
  reads exactly that field into the run row; widening it would need `035`'s contract reopened.
- **No new key in `src/i18n/error-keys.ts` or `messages.en.ts`.** Nothing this task throws reaches
  a user through GraphQL; it reaches a run row as a string.

If any of these turns out to be wrong, stop and report — do not adapt the contract from inside
this slice (Article VIII).

## Tests

`services/api/src/scheduler/tasks/refresh-episodes.task.spec.ts`, opening with the Article IX
paragraph naming what it defends against. Prisma and `TmdbClient` are both mocked, following
`services/api/src/shows/shows.service.spec.ts` (which already mocks `seasonDetails` at line 404) and
`services/api/src/scheduler/scheduler.service.spec.ts` for the surrounding style. The four cases
that are owed, each because its failure produces no error anywhere:

- **The selection boundary.** An episode three days in the future, one that aired yesterday, one
  that aired three days ago, one with a `null` `releaseDate`. The first, second and fourth are
  written; the third is never passed to an `update`. A wrong comparison here silently either
  freezes the data this feature exists to refresh, or quietly rewrites settled rows — both report
  `SUCCESS`.
- **One fetch per season.** Several selected episodes across two seasons of one series and one
  season of another; assert `seasonDetails` was called exactly three times, with the right
  `(tmdbId, seasonNumber)` pairs. A per-episode fan-out produces identical rows and an invisible
  external-call blowup.
- **An episode TMDB does not return.** A season response omitting one selected `episodeNumber`;
  assert no `update` was issued for that row and that it is not in `itemsProcessed`. The failure
  mode is a correct title being blanked, re-blanked on every subsequent run, with no error.
- **A partial failure.** `seasonDetails` rejecting for the first of two groups; assert the second
  group's episodes were still written and that `run()` throws with a message naming one failed
  season. A swallowed failure here renders as a clean `SUCCESS` on a sweep that skipped half the
  library.

Not owed a test: the empty-selection early return (its correctness is visible in the same boundary
test's call counts), and the grouping key itself (the one-fetch-per-season test already fails if it
collides or over-splits).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
```

`tsc` reports 0 errors, the suite is green, and the new spec file's four cases appear in its output.
`git diff --stat services/api/src/schema.gql services/api/prisma` prints nothing.

---
title: Show Refresh Sweep — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-26
status: Implemented
---

# PLAN: Show Refresh Sweep (`plan.md`)

## Approach

The catalog logic this feature needs already exists and has been exercised in production since
`069-title-refresh`: the inner `try` block of `ShowsService.refresh()`
(`services/api/src/shows/shows.service.ts:369`) reads the series from TMDB once, rewrites the `shows`
row, hands the season list to the private `syncSeasonsAndEpisodes()` (which upserts every season and
every episode, sequentially, creating what is new and blanking nothing), stamps `seasonsSyncedAt`,
and replaces the series' Redis catalog-cache entry through `cacheShows()`. The whole of this feature's
per-series work is that block. Nothing about it is re-implemented: it is **extracted** into a private
method on `ShowsService` and called from both the existing manual refresh and the new sweep, so there
is exactly one copy of the catalog step in the repository (Article X).

The sweep itself follows `041-episode-info-refresh` exactly, because it is the same kind of object:
`RefreshEpisodesTask` (`services/api/src/scheduler/tasks/refresh-episodes.task.ts`) holds its own
selection query, module-level cadence constants, a sequential loop, per-item failure containment, and
a final throw carrying the counts so `SchedulerService.runTask` records the occurrence as `FAILED`
rather than a silently-partial `SUCCESS`. `RefreshShowsTask` is written to that shape and to no other.
It differs in one respect only: it does not talk to TMDB itself. It selects due series and calls
`ShowsService`, which owns the series catalog.

That choice is the one real fork in the plan. The alternative was to give the task its own
`TmdbClient` and Prisma writes — which `SchedulerModule` could do today without touching its imports,
since it already reaches both — but that would leave two implementations of "sync a series' seasons",
and the one inside `ShowsService` is the one `hydrate()` and `refresh()` already depend on. The cost
of reuse is a `SchedulerModule` → `ShowsModule` import, which `scheduler.service.ts:52` warns against
in a comment. That warning is narrower than it reads — it was written about injecting
`MediaCapabilitiesService` to answer two boolean reads — and it has already been overtaken:
`073-automatic-episode-acquisition` is landing concurrently and its working tree already has
`SchedulerModule` importing `IndexerModule` and `EpisodesModule` with no `forwardRef`, and
`IndexerModule` imports `ShowsModule`. So `SchedulerModule` already reaches `ShowsModule`
transitively on a booting stack; naming it directly changes nothing about the graph. Nothing imports
`SchedulerModule` except `AppModule` and `SettingsModule`, and that pair is already `forwardRef` on
both sides. No `forwardRef` is added.

**Concurrency with `073`.** That feature is being implemented right now and touches two of the same
files: `scheduler.module.ts` (its imports and providers array) and `scheduler.registry.ts` (it adds
an `acquire_episodes` definition). This feature adds one import to the first and does **not** touch
the second — `refresh_shows` is already registered. Rebase onto `073` rather than around it, and if
`ShowsModule` is already in `SchedulerModule`'s imports by the time step 5 runs, step 5 is done.

The second reused seam is the hydration claim. `ShowsService` already serialises every writer of a
series' catalog on one Redis key, `show:hydrate:<tmdbId>` — `hydrate()` takes it and returns silently
if it is held, `refresh()` takes it and raises `error.media.refresh_in_progress`. The sweep takes the
same key and, like `hydrate()`, skips a series whose claim is held: that series' `seasonsSyncedAt` is
left alone, so it is still due on the next tick. Without this, a nightly sweep and a user pressing
Refresh on the same series would interleave two season loops over the same rows.

The due rule needs one fact nothing stores today. `TmdbClient` already maps TMDB's series status onto
`ShowDetail.status` (`services/api/src/clients/tmdb/client.ts:81`) and every caller drops it on the
floor. This feature persists it as `Show.tmdbStatus` and branches the cadence on it.

## Order of Work

One service, so the ordering is internal rather than cross-service. It still matters: the extraction
must land before the caller that depends on it, and the column before the query that reads it.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | The `Show.tmdbStatus` migration. Every later step reads or writes the column. |
| 2 | `api` | Write the column from the three paths that already hold a `ShowDetail` (`hydrate()`, `refresh()`, and the extracted catalog step they will share). Nothing selects on it yet, so this is safe on its own. |
| 3 | `api` | Extract the catalog step out of `refresh()` into a private method plus a claimed public entry point. Behaviour-preserving: `shows.service.spec.ts`'s existing `refresh` cases are the regression guard and must pass untouched. |
| 4 | `api` | Replace the `RefreshShowsTask` stub body: selection, loop, counts, throw. |
| 5 | `api` | Wire `ShowsModule` into `SchedulerModule` and verify `api` still boots. |
| 6 | `api` | Tests, then the manual pass of § Verification. |

Nothing here runs in parallel across services, because there is only one. Steps 1–2 and step 4's
selection query could be written concurrently by two agents, but the task cannot be tested until step
3 exists, so the sequence above is also the dispatch order.

## Contract Freeze

`spec.md` § GraphQL Contract Delta says **None**, and that is the frozen part: this feature adds no
GraphQL field, type, argument or error key. Frozen as of `status: Approved`.

Two things an implementer will be tempted to add and must not:

- **A GraphQL field for the new status.** `Show.tmdbStatus` is internal. Exposing it (a "Finalizada" /
  "En emisión" badge) is named in `spec.md` § Out of Scope: it needs a contract delta, a `web` slice
  and catalog copy in `en`/`es`, none of which this feature has. A `@Field()` decorator on the new
  column would regenerate `schema.gql` and break the Article VIII check — the `schema.gql` diff for
  this feature must be **empty**.
- **A new task id, or new `schedule_*` Settings.** `refresh_shows` already exists in the registry with
  its `mediaType: 'show'` gating, and `schedule_refresh_shows_enabled` / `_cron` are already seeded
  (`false`, `0 5 * * *`). Only the handler's body changes. The two cadences are module-level constants
  (REQ-13), not rows.

## Migrations

1. `add_show_tmdb_status` — `ALTER TABLE shows ADD COLUMN tmdbStatus VARCHAR(191) NULL`, generated
   through `bin/npm api run prisma:migrate` from `tmdbStatus String?` on `model Show`. No default, no
   index: the sweep's selection reads it on a table with one row per registered series, which at this
   installation's scale is tens of rows, not millions.
2. Backfill: **none, deliberately.** `NULL` is a value the selection rule already handles —
   REQ-3 puts an unknown status on the continuing (30-day) cadence, so every pre-existing series
   becomes due within 30 days of its last sync and fills its own column on the first sweep that picks
   it up. A backfill would mean one TMDB call per registered series inside a migration, which is the
   one place a rate limit must never be able to fail.

Reversibility: dropping the column is safe on its own — no other column, query or GraphQL field
depends on it, and reverting the handler to its stub restores `035`'s behaviour exactly. A rollback
that drops the column while leaving the new handler in place would break the selection query loudly
(Prisma error, `FAILED` run row), not silently.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `NOT IN` against a `NULL` column | SQL's three-valued logic: `NOT (tmdbStatus IN ('Ended','Canceled'))` evaluates to `NULL`, not `TRUE`, for a row where the column is `NULL`, so the row matches **neither** cadence branch. Every series that predates the migration has `tmdbStatus NULL` and a non-null `seasonsSyncedAt`, so the sweep would report a clean `SUCCESS` with `itemsProcessed: 0` forever on exactly the library this feature exists to refresh. Nothing anywhere errors. | The continuing branch must be written as an explicit `OR` of `{ tmdbStatus: null }` and `{ tmdbStatus: { notIn: [...] } }`, never `notIn` alone. AC-5 is the live check; a unit case in `refresh-shows.task.spec.ts` pins the generated `where` and fails if the null arm is removed. |
| Cadence boundary off by one | A cutoff computed with the wrong comparison or the wrong unit either re-reads every series on every tick (multiplying the TMDB budget until a shared key rate-limits, which surfaces as unrelated 429s elsewhere) or never selects anything. Both look like a working sweep. | AC-2/AC-3/AC-4 exercise both sides of both boundaries (20 vs 40 days, 100 vs 200 days); unit cases pin the same boundaries. Same class of bug `041`'s suite header already names. |
| `seasonsSyncedAt` stamped before the season loop finishes | A series whose refresh died halfway would look fully synced and wait another 30 or 180 days with a missing season nobody will ever be told about. | The stamp stays where `hydrate()` and `refresh()` already put it — after the loop, inside the same method (REQ-10). The extraction must not move it. Unit case: a rejecting `seasonDetails` leaves `show.update({seasonsSyncedAt})` uncalled. |
| The extraction changes manual-refresh behaviour | `069`'s `refresh()` returns outcomes rather than throwing, and holds its claim across the media-server step. An extraction that moves the claim, or lets the catalog step's throw escape, turns a `catalog: FAILED` response into a GraphQL error — `web` would show an error toast instead of the per-step warning it was written for, with no compile error anywhere. | Step 3 is behaviour-preserving by construction: the claim stays in `refresh()`, the extracted body keeps throwing, and `refresh()` keeps its existing `try/catch`. The existing `shows.service.spec.ts` `refresh` cases must pass **unmodified** — if one needs editing, the extraction changed behaviour. |
| Sweep and manual refresh interleave on one series | Two season loops upserting the same rows from two different TMDB responses. The upserts are idempotent, so the rows end up consistent and nothing errors — but the double TMDB spend is invisible, and whichever finishes last stamps `seasonsSyncedAt`. | The sweep takes the existing `show:hydrate:<tmdbId>` claim per series and skips a held one, uncounted and still due. |
| `SchedulerModule` → `ShowsModule` cycle | Nest resolves providers to `undefined` inside a badly-broken cycle, which surfaces as a `TypeError` on first use — in a background cron callback, where `runTask` swallows it into a `FAILED` run row nobody is watching. | Largely pre-mitigated: `073` already put `IndexerModule` (which imports `ShowsModule`) into `SchedulerModule` on a stack that boots, so this edge exists in practice before this feature adds it by name. Still verified at boot rather than at first tick — step 5's check is that `api` reaches healthy and the Scheduling tab lists every task — and the manual "Ejecutar ahora" of the verification pass runs the handler in the foreground, where a bad injection is a visible error rather than a swallowed log line. |
| The sweep writes pipeline state | Catalog and pipeline are separate concerns; a stray `status` write would demote or promote titles nightly with no user action and no record. | REQ-8. The extracted body is the catalog step only — the media-server call in `refresh()` stays in `refresh()`, outside what the task can reach. AC-9 verifies no `episodes.status`, `media_sources` or `process_jobs` row changed. |

## Verification

```bash
bin/npm api run prisma:migrate
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
git status --short services/api/prisma
git diff --stat services/api/src/schema.gql
```

Expected: the migration applies and `migrate status` reports nothing pending; 0 typecheck errors; the
suite passes with the new `refresh-shows.task.spec.ts` cases and every pre-existing
`shows.service.spec.ts` case unmodified; `git status --short services/api/prisma` shows a modified
`schema.prisma` plus exactly one new migration directory (Article III); the `schema.gql` diff is
**empty** (Article VIII, § Contract Freeze).

Then the manual pass, which is where the acceptance criteria live. All of it through Settings →
Scheduling as the seeded admin, with `shows_enabled` on:

1. Register a finished series and a currently-airing one. Once each has hydrated,
   `bin/mysql -e 'select id, title, tmdbStatus, seasonsSyncedAt from shows'` — both columns populated,
   the finished one reading `Ended` (AC-1).
2. Move a series' clock by hand and trigger the task:
   `bin/mysql -e "update shows set seasonsSyncedAt = date_sub(now(), interval 40 day) where id = <id>"`,
   then Settings → Scheduling → `refresh_shows` → "Ejecutar ahora". The run reads `SUCCESS` with
   1 item and `seasonsSyncedAt` is now (AC-2). Repeat with `interval 20 day` for 0 items (AC-3), and
   with the `Ended` series at `100 day` then `200 day` for 0 then 1 (AC-4).
3. `bin/mysql -e "update shows set tmdbStatus = NULL, seasonsSyncedAt = date_sub(now(), interval 40 day) where id = <id>"`
   then trigger: the series is selected and `tmdbStatus` is no longer `NULL` (AC-5). This is the
   § Risks null-logic case — run it on an `Ended` series so a `notIn`-only query would skip it.
4. `bin/mysql -e "update shows set seasonsSyncedAt = NULL where id = <id>"` then trigger: selected
   (AC-6).
5. Revival: `bin/mysql -e "delete from seasons where showId = <ended id> and seasonNumber = 1"`, set
   `seasonsSyncedAt` back 200 days, trigger. The season and its episodes reappear with their TMDB
   titles and `itemsProcessed` is 1 (AC-7).
6. `setShowContentKind` a due series to `ANIME`, trigger, and confirm `shows.contentKind` is unchanged
   (AC-8). With an episode of that series stored `COMPLETED` and a source in `DOWNLOADING`, confirm no
   `episodes.status` / `media_sources` / `process_jobs` row moved (AC-9).
7. Failure: set `movie_db_api_key` to garbage in Settings with two series due, trigger. The run reads
   `FAILED`, its error names 2 of 2 failed, both `seasonsSyncedAt` are unchanged and no catalog column
   was blanked; restore the key, trigger again, `SUCCESS` with 2 (AC-10).
8. Failure: set `shows_enabled` false and press "Ejecutar ahora" — the existing
   `error.schedule.task_unavailable` refusal, and no new row in `scheduled_task_runs` (AC-11).

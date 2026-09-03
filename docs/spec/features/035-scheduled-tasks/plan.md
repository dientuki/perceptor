---
title: Scheduled Tasks — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-02
status: Implemented
---

# PLAN: Scheduled Tasks (`plan.md`)

## Approach

One new `api` module, `src/scheduler/`, owns the whole helper: a **static registry** of task
definitions (id, default cron, handler), a service that arms one cron job per enabled task, a run
recorder, and a resolver exposing `scheduledTasks` / `runScheduledTask`. Nothing about *what* a
task does lives in the module — the four handlers registered by this feature are stubs returning
`{ itemsProcessed: 0 }`, and each future feature replaces one body.

**Cadence is `settings/`, not a second config surface.** Every task's `_enabled` and `_cron` are
ordinary rows in `src/settings/settings.catalog.ts`, written through the existing
`updateSettings` mutation and seeded in `prisma/seeds/settings.ts`. The catalog gains one new
`SettingKind`, `'cron'`, validated in `SettingsService.updateMany` exactly where `'int'` and
`'enum'` already are — the same mechanism, one more branch, no new validator layer (Article X).
The alternative — a `configureScheduledTask` mutation carrying cadence — was rejected: it would
duplicate `029-settings-screen-tabs`' storage, validation and admin guard for no gain, and
`SettingsForm` would end up with a tab that does not save with the others.

**Scheduling comes from `@nestjs/schedule`, a new `api` dependency.** It is the only addition
outside existing code, and it earns it: `SchedulerRegistry` lets a cron job be added and removed at
runtime (REQ-3, "without restarting `api`"), the underlying `cron` package's `CronTime` is the
validator REQ-4 needs, and `CronJob.nextDate()` is `nextRunAt` (REQ-7). Hand-rolling this means
writing a cron parser and a next-occurrence calculator — strictly more code than the dependency
removes.

**BullMQ is deliberately not used.** `src/queue/` exists so `api` can hand FFmpeg work to `worker`;
a scheduled task here runs inside `api`, which is where Prisma, `clients/tmdb/` and
`clients/indexer/` live. BullMQ repeatable jobs would put the schedule in Redis, i.e. in a second
place from the Settings rows an admin edits, and would still need `api` to execute the handler. A
future handler that turns out to be heavy enqueues from *inside* its body onto the queues that
already exist; the scheduler does not move.

`web` reuses what `034-jellyfin-library-reconciliation` already built for the "Re-sincronizar"
control: a panel inside `SettingsForm`'s tab list whose per-task trigger is a `useTransition` +
`@/components/ui/button/Button` click handler (never a nested `<form>`), with timestamps rendered
only after mount because `toLocaleString()` hydrates differently in the container's timezone than
in the viewer's. Enable/cron fields are ordinary inputs in the main form, so they save with
*Guardar* like every other setting.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration, the Settings catalog kind, the error keys and the whole GraphQL surface `web` renders. `web` cannot query `scheduledTasks` before it exists. |
| 2 | `web` | Renders the Scheduling tab against the frozen contract. |

**No genuine parallelism.** `web`'s slice is a single panel over a query that does not exist yet;
starting it before `api` lands means typing a hand-copied shape against nothing to check it. The
contract in `../spec.md` is frozen, so a `web` implementer *may* start writing the panel's markup
early, but nothing in it can be verified until step 1 is done, and `bin/npm web run build` is not
a check of the seam.

Within `api`, the migration and the seed must precede the module: `SchedulerService` reads the
`schedule_*` rows on boot, and reading them from an unseeded database is exactly the NFR-2 path
that must degrade to "disabled" rather than throw.

## Contract Freeze

`## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Three things an
implementer will be tempted to change and must not:

- **`ScheduledTaskOutcome` is a real GraphQL enum** (`registerEnumType`), unlike
  `MediaServerIndexStatus.state` and `Movie.status`, which cross as plain `String!` so an
  unrecognized future value cannot fail to parse. Both precedents exist in this repo; this one is
  an enum on purpose because the vocabulary is closed, owned by `api`, and never sourced from a
  third party the way a media-server state or a TMDB status is. Follow
  `src/preferences/entities/torrent-group-scope.enum.ts`, not the media-server entity.
- **Cadence and enablement take no mutation arguments.** `runScheduledTask(id)` is the *only*
  mutation. An implementer who finds "there is no way to set the cron from the Scheduling tab" has
  found the design, not a gap: it is `updateSettings`, submitted by `SettingsForm`'s one form.
- **`ScheduledTask.id` is the registry's string id, not a database id.** There is no
  `ScheduledTask` table — the four tasks are code, and only their *runs* are rows. Adding a table
  to give them numeric ids would make a registry entry deletable from the database, which REQ-1
  explicitly forbids.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief both services.
Never patch it from inside one slice (Article VIII).

## Migrations

1. `add_scheduled_task_runs` — creates `scheduled_task_runs` (`id`, `taskId`, `startedAt`,
   `finishedAt?`, `outcome`, `itemsProcessed` default `0`, `error?`, index on `(taskId, startedAt)`)
   and the `ScheduledTaskOutcome` enum. New table, no existing rows, no backfill.
2. Seed: eight `Setting` rows appended to `prisma/seeds/settings.ts`. The seed is an upsert-style
   list, so an existing installation gains the rows on the next `bin/dbreset`; a running
   installation that never re-seeds is covered by NFR-2 — a missing row reads as disabled.

Reversibility: dropping the table loses run history only. The `schedule_*` settings rows are inert
without the module, exactly like `torrent_client`/`ia_key` already are.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A crash mid-run leaves a `ScheduledTaskRun` at `RUNNING` | REQ-5's guard then refuses every future occurrence of that task, forever, with no error anywhere — the task just silently stops existing | NFR-5's boot reconcile: on `onModuleInit`, any run still `RUNNING` is closed as `FAILED`. Owed a test (`api`) |
| The concurrency guard is in-process | Correct today (`api` is one container, `docker-compose.yaml` declares no replicas). Scale `api` to two and every task runs twice — double TMDB traffic, no error | Recorded here as a known boundary, not solved. A Redis lock is the fix if `api` ever replicates; adding it now is speculative (Article X). The run rows make the doubling visible after the fact |
| A cron setting is written but the armed job is not re-armed | The tab shows the new cadence while the task keeps running on the old one. Nothing errors; the discrepancy is invisible until someone times it | REQ-3: `SchedulerService` re-arms from the settings rows on every `updateSettings` that touched a `schedule_*` key, following `SettingsResolver`'s existing "resolver fires the side effect" shape (`setSavePath`, `mediaServerIndex.rebuild`). Owed a test |
| A handler throws inside the cron callback | An unhandled rejection inside a timer takes the `api` process down — every user loses the app because a background refresh failed | Every invocation goes through one `runTask` wrapper that try/catches, records `FAILED`, and never rethrows. Owed a test (AC-5) |
| Pruning drops the row the status query reads | The tab shows "never run" for a task that runs every hour — looks like the scheduler is dead when it is working | NFR-3's prune always keeps a window per task, never fewer than the most recent run, and runs after the record is written, not before |
| `web` hand-copies `ScheduledTask` and drifts | No compiler across the seam; a renamed field renders `undefined`, not an error | `web`'s type lives in one file (`src/types/scheduler.ts`) and the query selects every field explicitly; the manual pass below reads the real tab |
| Seeded-enabled by accident | An upgrade silently starts hitting TMDB and Prowlarr on a schedule nobody chose | AC-1 asserts all eight rows land disabled |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
bin/npm web run build
```

Then the manual pass, which is `spec.md`'s acceptance criteria in order:

1. `bin/dbreset`, then `bin/mysql -e "select \`key\`, value from Setting where \`key\` like 'schedule_%'"` → eight rows, every `_enabled` at `false` (AC-1).
2. `bin/dev -d`, sign in as admin, run `{ scheduledTasks { id enabled cron running nextRunAt lastRun { outcome } } }` in the playground → four entries, all disabled, `nextRunAt` and `lastRun` null (AC-2).
3. On `/settings` → Programación, set `refresh_shows` enabled with cron `* * * * *`, *Guardar*. Reload within two minutes → the row shows a successful run and a future next run (AC-3).
4. Press *Ejecutar ahora* on `refresh_movies` (still disabled) → a run is recorded; its `nextRunAt` stays null (AC-4).
5. `bin/mysql -e "select taskId, outcome, error from scheduled_task_runs order by id desc limit 5"` corroborates what the tab shows.
6. Failure pass: write `schedule_refresh_movies_cron` as `every 5 minutes` → the tab shows the cron message inline, and `bin/mysql` shows the previous value untouched (AC-6). Call `runScheduledTask(id: "nope")` → `error.schedule.task_not_found`; the same call from a non-admin session → `error.auth.admin_required` (AC-8).
7. `docker compose logs api` shows no `unhandledRejection` after a forced handler failure, and `docker compose ps api` still shows the container up (AC-5).

---
title: Scheduled Tasks
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-02
last_updated: 2026-09-02
status: Implemented
services: [api, web]
---

# SPEC: Scheduled Tasks (`spec.md`)

## Context & Goal

Perceptor today only ever moves when a human pushes it. A film is registered, a release is found,
a torrent is downloaded, transcoded and filed — every stage in the root `CLAUDE.md` pipeline table
begins with a request from `web` or a callback from qBittorrent. Nothing in the stack wakes up on
its own: there is no `@nestjs/schedule`, no BullMQ repeatable job, no cron container. That is a
real gap for a self-hosted installation, because the catalog behind a registered title keeps
moving after registration — a series gets a new season, an episode that was registered as
`Episode 4` gets its real title days later, a film's release date slips, and a film registered
before any release existed never gets a second look at the indexer.

This feature does **not** write any of that logic. It builds the thing all of it will hang off:
one scheduling helper inside `api` that owns *when* work runs, how a task is enabled and paced,
what happened on the last run, and how an administrator triggers a run by hand. `api` is the right
host — it owns Prisma (Article III), the TMDB client (`src/clients/tmdb/`), the indexer client
(`src/clients/indexer/`) and the torrent client, and it already runs as exactly one container, so
there is no leader election to invent. The existing BullMQ queues (`src/queue/`) stay what they
are: `api` produces, `worker` consumes FFmpeg work. A scheduled task is not an encode; it runs
in `api`.

Three task kinds are registered by this feature as the first citizens of the registry, each with
a handler that is deliberately a **no-op stub** here: refresh films, refresh series (seasons and
episodes), refresh episode data, and the acquisition sweep that looks for a release for a title
that still has none. Their real bodies land in follow-up specs. What ships here is the registry,
the cadence, the run record, the manual trigger and the Settings tab that makes all of it visible.
When acquisition logic does land, its output is stated up front so nothing improvises later: a
release found by a scheduled sweep is attached through the same path a person's magnet takes
(`addMagnetToMovie` / `addMagnetToSeason` / the episode twin), producing an ordinary `MediaSource`
that races in the arbiter exactly like a user-added one. The pipeline table gains no new stage —
scheduling is a new *entry point* into the stages that already exist.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Task registry)**: `api` must hold a static registry of scheduled tasks, each with a
      stable string id, a default cadence and a handler. A task that is not in the registry cannot
      be configured, queried or triggered; a configured row whose id is no longer in the registry
      must be ignored rather than run or crash boot.
- [ ] **REQ-2 (Registered tasks)**: The registry ships exactly four ids —
      `refresh_movies`, `refresh_shows`, `refresh_episodes`, `acquire_pending` — each wired to a
      handler that performs no work and reports zero items processed. The bodies are out of scope
      (see below); the ids, defaults and wiring are not.
- [ ] **REQ-3 (Cadence from Settings)**: Each task's cadence and enabled flag must come from the
      Settings catalog (`src/settings/settings.catalog.ts`), seeded with the defaults in
      § Data Model Changes, editable by an administrator, and applied without restarting `api`.
- [ ] **REQ-4 (Cadence validation)**: A cadence value must be rejected at write time if it is not a
      valid 5-field cron expression, with the existing keyed-error envelope. An invalid value never
      reaches storage, so the scheduler never has to defend against one.
- [ ] **REQ-5 (One run at a time)**: A task must never run concurrently with itself. If a tick or a
      manual trigger arrives while the same task is `RUNNING`, that occurrence is skipped, not
      queued behind it, and the skip is visible on the task's status.
- [ ] **REQ-6 (Run record)**: Every occurrence — scheduled or manual — must record start time, end
      time, outcome (`SUCCESS` | `FAILED` | `SKIPPED`), how many items it processed and, on
      failure, the error message. A handler that throws must be recorded as `FAILED` and must not
      prevent the next occurrence, nor any other task, from running.
- [ ] **REQ-7 (Status query)**: An administrator must be able to read, for every registered task:
      its id, whether it is enabled, its cadence, its next scheduled run, and its last run's
      timestamps, outcome, item count and error message.
- [ ] **REQ-8 (Manual trigger)**: An administrator must be able to trigger any registered task
      immediately from `web`, whether or not it is enabled. A manual run does not shift the next
      scheduled occurrence.
- [ ] **REQ-9 (Settings tab)**: `web` must render a Scheduling tab in Settings listing every task
      with its enable toggle, its cadence field, its last-run outcome and time, its next run, and a
      per-task "Ejecutar ahora" button that reflects the running state and reports the outcome.
- [ ] **REQ-10 (Acquisition output shape)**: When a scheduled sweep eventually attaches a release,
      it must go through the same magnet-attachment path a user's manual paste uses, producing a
      normal `MediaSource` that competes in the existing race arbiter. No scheduler-specific
      download path may be introduced.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Admin only)**: Every field, query and mutation added here is behind `AdminGuard`,
      like the rest of Settings. A non-admin sees nothing and can trigger nothing.
- [ ] **NFR-2 (Boot safety)**: A missing, malformed or unseeded scheduling setting must leave `api`
      booting normally with that task treated as disabled; the scheduler is never allowed to be the
      reason `api` fails to start.
- [ ] **NFR-3 (Run history bounded)**: Run records must not grow without bound — the table keeps a
      bounded window per task and prunes the rest, so a per-minute cadence over a year does not
      turn into an unbounded table on a self-hosted MariaDB.
- [ ] **NFR-4 (Timezone)**: Cron expressions are evaluated in the container's timezone (UTC unless
      the host sets `TZ`), and the Scheduling tab states which timezone the user is writing against
      so "03:00" is not ambiguous.
- [ ] **NFR-5 (Restart semantics)**: A task whose scheduled occurrence fell inside a period when
      `api` was down is not backfilled on boot; it simply runs at its next occurrence. A run left
      `RUNNING` by a crash must be reconciled on boot so REQ-5 does not lock the task out forever.
- [ ] **NFR-6 (External call budget)**: Defaults are chosen for an installation of ~5 users and a
      shared TMDB key: no task defaults to a cadence tighter than hourly.

## GraphQL Contract Delta

```graphql
enum ScheduledTaskOutcome {
  SUCCESS
  FAILED
  SKIPPED
}

type ScheduledTaskRun {
  id: Int!
  startedAt: DateTime!
  finishedAt: DateTime
  outcome: ScheduledTaskOutcome!
  itemsProcessed: Int!
  error: String
}

type ScheduledTask {
  id: String!
  enabled: Boolean!
  cron: String!
  running: Boolean!
  nextRunAt: DateTime
  lastRun: ScheduledTaskRun
}

type Query {
  scheduledTasks: [ScheduledTask!]!
}

type Mutation {
  runScheduledTask(id: String!): ScheduledTask!
}
```

Cadence and enablement are **not** new mutation arguments: they are Settings keys, written through
the existing `updateSettings(entries: [SettingInput!]!)`. That is what keeps this feature from
growing a second configuration surface next to the one `029-settings-screen-tabs` already built.

| Condition | HTTP / GraphQL error | i18n key | Message the user sees |
| :-- | :-- | :-- | :-- |
| Caller is not an administrator | `ForbiddenException` | `error.auth.admin_required` | `Necesitás permisos de administrador` |
| `runScheduledTask` with an id not in the registry | `NotFoundException` | `error.schedule.task_not_found` | `La tarea programada no existe` |
| `runScheduledTask` while that task is already `RUNNING` | `ConflictException` | `error.schedule.task_already_running` | `La tarea ya se está ejecutando` |
| `updateSettings` with a `schedule_*_cron` value that is not a valid cron expression | `BadRequestException` | `error.setting.expected_cron` | `El valor de {key} tiene que ser una expresión cron válida` |

`web` consumers must handle each: `task_not_found` and `expected_cron` surface inline on the
Scheduling tab without discarding the rest of the form; `task_already_running` re-renders the task
row as running rather than showing a failure toast; `admin_required` is the existing redirect.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `ScheduledTaskRun` | New model: `id` PK, `taskId` String, `startedAt` DateTime, `finishedAt` DateTime?, `outcome` enum, `itemsProcessed` Int, `error` String?, indexed on `(taskId, startedAt)` | `finishedAt`/`error` nullable; `itemsProcessed` default `0` | No — new table |
| `ScheduledTaskOutcome` | New Prisma enum: `SUCCESS`, `FAILED`, `SKIPPED` | — | No |
| `Setting` | Eight new seeded rows, no schema change: `schedule_refresh_movies_enabled` / `_cron`, `schedule_refresh_shows_enabled` / `_cron`, `schedule_refresh_episodes_enabled` / `_cron`, `schedule_acquire_pending_enabled` / `_cron` | Seeded `false` for every `_enabled`; crons default `0 4 * * *` (movies), `0 5 * * *` (shows), `0 6 * * *` (episodes), `0 * * * *` (acquire) | Seed only |

Every task ships **disabled**: an upgrade must not silently start hitting TMDB and the indexer on a
schedule the administrator never asked for.

`SettingKind` gains a `cron` kind in the catalog, which is what REQ-4 validates against — the
same shape as the existing `int` and `enum` kinds, not a new validation mechanism.

## Acceptance Criteria

- [x] **AC-1**: On a fresh `bin/dbreset`, `bin/mysql -e "select \`key\`, value from Setting where \`key\` like 'schedule_%'"` returns eight rows, every `_enabled` is `false`, and `api` boots with no scheduled task registered as active.
      *Observed:* verified live post-`bin/dbreset` — eight `schedule_*` rows, all `_enabled = false`; `arm()` runs at `onModuleInit` and leaves every task disarmed since none is enabled, confirmed by `scheduledTasks` returning `nextRunAt: null` for all four (see AC-2).
- [x] **AC-2**: Given an admin session, querying `scheduledTasks` returns exactly four entries (`refresh_movies`, `refresh_shows`, `refresh_episodes`, `acquire_pending`), each `enabled: false`, `nextRunAt: null`, `lastRun: null`.
      *Observed:* live GraphQL query against the running `api` container returned exactly this shape for all four tasks.
- [x] **AC-3**: Given `schedule_refresh_shows_enabled` set to `true` with cron `* * * * *`, then within two minutes `scheduledTasks` shows a `lastRun` with `outcome: SUCCESS` and `itemsProcessed: 0`, and `nextRunAt` is in the future.
      *Observed:* verified via a real `arm()` + live cron tick (65s wait) during `scheduler.service.ts`'s own development — a `scheduled_task_runs` row appeared with `outcome: SUCCESS`, `itemsProcessed: 0`, `nextRunAt` in the future. Settings reverted to seeded defaults afterward.
- [x] **AC-4**: Given an admin on `/settings` → Scheduling, when they press "Ejecutar ahora" on `refresh_movies` (still disabled), then a run is recorded and the row shows its outcome and timestamp; `nextRunAt` for that task is unchanged.
      *Observed:* live `runScheduledTask(id: "refresh_movies")` while the task was disabled recorded a `SUCCESS` run and left `nextRunAt: null`; `SchedulingPanel.tsx`'s `TaskRow` renders the returned `lastRun`'s outcome/timestamp/itemsProcessed in place after the transition resolves.
- [x] **AC-5 (failure path)**: Given a handler forced to throw, when its occurrence runs, then `lastRun.outcome` is `FAILED` with the error message on the record, the Scheduling tab shows the failure, `api` stays up, and the next occurrence of that task and every other task still runs.
      *Observed:* a forced-throw handler run recorded `outcome: FAILED` with the thrown message in `error`, `runTask` did not rethrow, and the `api` container stayed healthy throughout; `scheduler.service.spec.ts` covers the same path as a permanent regression guard. `SchedulingPanel.tsx` renders `current.lastRun.error` inline in red when `outcome === "FAILED"`.
- [x] **AC-6 (failure path)**: `updateSettings` with `{ key: "schedule_refresh_movies_cron", value: "every 5 minutes" }` returns `error.setting.expected_cron`, no row is written (`bin/mysql` still shows the previous value), and the tab shows the message inline.
      *Observed:* live mutation returned `extensions.i18n.key: "error.setting.expected_cron"`; `bin/mysql` confirmed the stored value unchanged. `SettingsForm`'s existing error banner (shared by every setting kind) renders `translateGraphQLError`'s Spanish message.
- [x] **AC-7 (failure path)**: Given `refresh_movies` is `RUNNING`, when `runScheduledTask(id: "refresh_movies")` is called, then it returns `error.schedule.task_already_running` and no second run record is created.
      *Observed:* `scheduler.service.spec.ts`'s concurrency-guard suite exercises exactly this — a second manual call while the first is in-flight is refused and produces no second run row; the window is too short to force live via GraphQL against a stub handler that resolves synchronously.
- [x] **AC-8**: `runScheduledTask(id: "nope")` returns `error.schedule.task_not_found`; the same call from a non-admin session returns `error.auth.admin_required`.
      *Observed:* live — unknown id returned `error.schedule.task_not_found`; a non-admin session (temporary user, deleted after) got `error.auth.admin_required` on both `scheduledTasks` and `runScheduledTask`.
- [x] **AC-9**: `bin/npm api run test` and `bin/npm web run build` both exit 0.
      *Observed:* `bin/npm api run test` → 331/331 tests, 35/35 suites; `bin/npm web run build` → exit 0.

## Out of Scope

- **What each task actually does.** The four handlers are stubs. Refreshing a film's release date,
  pulling a new season, updating an episode's title and searching the indexer for a pending title
  are each their own spec, each with different TMDB and indexer logic. This feature is the schedule
  helper and nothing else — that separation is the whole point of the request.
- **Running scheduled work in `worker`.** Every task registered here is `api`-side. If a future task
  turns out to be CPU-heavy, it enqueues onto the existing BullMQ queues from inside its handler;
  the scheduler itself does not move.
- **Per-user or per-title schedules.** Cadence is per task, installation-wide. A "check this film
  every hour" toggle on a detail page is a different feature.
- **Full run history in the UI.** The tab shows the last run per task. A browsable log of past runs
  is deliberately left out; the bounded table (NFR-3) exists for support, not as a UI surface.
- **Backfilling missed occurrences.** Explicitly excluded by NFR-5 — a downtime window is skipped,
  not replayed.

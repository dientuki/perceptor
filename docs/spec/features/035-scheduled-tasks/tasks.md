---
title: Scheduled Tasks — Tasks
last_updated: 2026-09-02
status: Done
---

# TASKS: Scheduled Tasks (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Every agent reads `spec.md`, `plan.md` and its own `<svc>/plan.md` before starting. The
`## GraphQL Contract Delta` in `spec.md` is frozen — an agent that finds it wrong stops and reports
into § Blocked rather than adapting it locally (Constitution, Article VIII).

## Tasks

### Group 1 — schema, settings and vocabulary

Nothing in the scheduler module can be written before the rows it reads and the keys it throws
exist.

- [x] **T001** `[api]` Add `enum ScheduledTaskOutcome` and `model ScheduledTaskRun`
      (`@@map("scheduled_task_runs")`, index on `(taskId, startedAt)`) to `prisma/schema.prisma`
      and generate the migration with `bin/npm api run prisma:migrate`.
      *Done when:* `git status services/api/prisma/` shows a modified `schema.prisma` **and** a new
      migration directory, and `bin/mysql -e 'describe scheduled_task_runs'` lists the seven columns.
- [x] **T002** `[api]` Append the eight `schedule_*` rows to `prisma/seeds/settings.ts` with the
      defaults in `spec.md` § Data Model Changes. → T001
      *Done when:* after `bin/dbreset`,
      `bin/mysql -e "select \`key\`, value from Setting where \`key\` like 'schedule_%'"` returns
      eight rows and every `_enabled` is `false` (AC-1).
- [x] **T003** `[api] [P]` Add `@nestjs/schedule` to `services/api/package.json` and install it
      through `bin/npm api install`.
      *Done when:* `bin/cli api node -e "require('@nestjs/schedule');require('cron')"` exits 0.
- [x] **T004** `[api] [P]` Add `SETTING_EXPECTED_CRON`, `SCHEDULE_TASK_NOT_FOUND` and
      `SCHEDULE_TASK_ALREADY_RUNNING` to `src/i18n/error-keys.ts` with their English renderings in
      `src/i18n/messages.en.ts`, matching the key strings in `spec.md`'s error table byte for byte.
      *Done when:* `bin/cli api npx --no tsc --noEmit` exits 0 and each key appears exactly once in
      each file.
- [x] **T005** `[api]` Add the `'cron'` kind to `SettingKind`, the eight `schedule_*` entries to
      `SETTINGS_CATALOG`, and the validation branch to `SettingsService.updateMany` — `CronTime`
      from `cron`, throwing `i18nError.badRequest(ERROR_KEYS.SETTING_EXPECTED_CRON, { key })`,
      beside the existing `'int'` and `'enum'` branches. → T003, T004
      *Done when:* `updateSettings` with `{ key: "schedule_refresh_movies_cron", value: "every 5 minutes" }`
      returns `error.setting.expected_cron` and `bin/mysql` shows the stored value unchanged (AC-6).

### Group 2 — the scheduler module

Depends on Group 1: the service reads the settings rows and throws the keys defined there.

- [x] **T006** `[api]` Write `src/scheduler/scheduler.registry.ts` (four definitions — id, default
      cron, handler token — with the settings keys *derived* from the id) and the four stub
      handlers under `src/scheduler/tasks/`, each returning `{ itemsProcessed: 0 }`. → T003
      *Done when:* the registry exports exactly `refresh_movies`, `refresh_shows`,
      `refresh_episodes`, `acquire_pending`, and no handler imports Prisma, TMDB or the indexer.
- [x] **T007** `[api] [P]` Write the three entities under `src/scheduler/entities/` —
      `ScheduledTask`, `ScheduledTaskRun`, and `ScheduledTaskOutcome` via `registerEnumType`
      (follow `src/preferences/entities/torrent-group-scope.enum.ts`, not the media-server
      `String!` precedent). → T003
      *Done when:* they match `spec.md` § GraphQL Contract Delta field for field.
- [x] **T008** `[api]` Write `src/scheduler/scheduler.service.ts`: boot reconcile of runs left
      `RUNNING`, `arm()` from the settings map into `SchedulerRegistry`, the single `runTask`
      execution path (concurrency refusal, run row, try/catch that never rethrows, prune),
      `list()` joining each registry entry to its latest run and `CronJob.nextDate()`. → T002, T006
      *Done when:* with `schedule_refresh_shows_enabled=true` and cron `* * * * *`, a
      `scheduled_task_runs` row with `outcome = 'SUCCESS'` appears within two minutes (AC-3), and a
      forced handler throw records `FAILED` while `docker compose ps api` still shows the container
      up (AC-5).
- [x] **T009** `[api]` Write `src/scheduler/scheduler.resolver.ts` (`scheduledTasks`,
      `runScheduledTask`, `@UseGuards(AdminGuard)` **per method** — the `ffprobe-logs` form, not
      `UsersResolver`'s class-level one), `scheduler.module.ts` with `ScheduleModule.forRoot()`,
      and the import in `src/app.module.ts`. → T007, T008
      *Done when:* `scheduledTasks` returns four entries, all `enabled: false`, `nextRunAt: null`,
      `lastRun: null` on a fresh seed (AC-2); `runScheduledTask(id: "nope")` returns
      `error.schedule.task_not_found` and the same call from a non-admin session returns
      `error.auth.admin_required` (AC-8); a manual trigger of a disabled task records a run and
      leaves `nextRunAt` null (AC-4).
- [x] **T010** `[api]` Add the re-arm block to `SettingsResolver.updateSettings`, after the write
      is confirmed, following the `before`/`after` map comparison the `setSavePath` and
      `mediaServerIndex.rebuild` blocks already use. → T005, T009
      *Done when:* changing a `schedule_*_cron` from the playground changes `nextRunAt` on the next
      `scheduledTasks` read, with no `api` restart.
- [x] **T011** `[api]` Write `src/scheduler/scheduler.service.spec.ts` with the Article IX header
      naming the failure it defends against (a scheduler that stops running with no error
      anywhere), covering the four silent cases in `api/plan.md` § Tests: boot reconcile of a
      stranded `RUNNING` row, a throwing handler recorded `FAILED` without escaping, a concurrent
      invocation producing no second row, and re-arming replacing rather than duplicating an armed
      job. → T008
      *Done when:* `bin/npm api run test` exits 0 with the new suite passing.
- [x] **T012** `[api] [P]` Extend `src/settings/settings.service.spec.ts` with the `'cron'`
      rejection case, in the shape of the existing `'int'`/`'enum'` cases. → T005
      *Done when:* `bin/npm api run test` exits 0 and the new case asserts the stored value is
      untouched after a rejected write.

### Group 3 — the Scheduling tab

Everything here consumes the contract produced in Group 2. `web` has no compiler across the seam —
these must not start before T009 exists to read.

- [x] **T013** `[web]` Write `src/types/scheduler.ts` (timestamps typed `string | null`, never
      `Date`) and `src/actions/scheduler.ts` — `getScheduledTasks()` selecting every field in the
      delta with `redirectToClearSession`, and `runScheduledTaskAction(id)` returning
      `{ task } | { error, errorKey }` via `toActionError`. → T009
      *Done when:* `bin/npm web run build` exits 0 and `getScheduledTasks()` returns the four tasks
      on the settings page.
- [x] **T014** `[web]` Write `src/components/settings/SchedulingPanel.tsx` and wire it as
      `SettingsForm`'s sixth tab, with `getScheduledTasks()` joining the existing `Promise.all` in
      `src/app/(dashboard)/settings/page.tsx`. Trigger button is `useTransition` +
      `@/components/ui/button/Button` (never a nested `<form>`, never a raw `<button>`); the panel
      is mounted with the others and hidden with `className="hidden"`; timestamps render only after
      mount; the timezone note (NFR-4) sits once at the top. → T013
      *Done when:* `/settings` shows six tabs, *Programación* lists four tasks each with a toggle,
      a cron field and a working *Ejecutar ahora*, and switching tabs does not reset unsaved edits.
- [x] **T015** `[web] [P]` Add the four `schedule_*_cron` keys to `EDITABLE_KEYS` and the four
      `schedule_*_enabled` keys to `BOOLEAN_KEYS` in `src/actions/settings.ts`. → T005
      *Done when:* saving the Scheduling tab persists both the toggle and the cron, verified with
      `bin/mysql -e "select \`key\`, value from Setting where \`key\` like 'schedule_%'"`, and a
      cleared cron field does not overwrite the stored expression with `""`.
- [x] **T016** `[web] [P]` Add the catalog strings to `messages/es.json` and `messages/en.json`:
      `settings.tabs.scheduling`, the `settings.scheduling.*` panel copy including the four task
      labels and the three outcome labels, `errors.schedule.taskNotFound`,
      `errors.schedule.taskAlreadyRunning` and `errors.setting.expectedCron`. `es` keeps the
      existing Rioplatense register. → T004
      *Done when:* both catalogs have the same key set and an invalid cron shows the Spanish
      message inline rather than the English fallback.

### Group 4 — verification and docs

- [x] **T017** `[api]` Run the api verification pass: `bin/cli api npx --no tsc --noEmit` and
      `bin/npm api run test`. → T011, T012, T010
      *Done when:* both exit 0, and `bin/cli api cat src/schema.gql` contains the delta exactly as
      `spec.md` writes it (AC-9, Article VIII's check).
- [x] **T018** `[web]` Run the web verification pass: `bin/npm web run build`. → T014, T015, T016
      *Done when:* it exits 0 (AC-9).
- [x] **T019** `[docs]` Update `services/api/CLAUDE.md` (a `scheduler/` bullet in the module map;
      the `settings/` bullet gains the `'cron'` kind and the eight non-obvious `schedule_*` keys),
      `services/web/CLAUDE.md` (`SettingsForm` shows **six** tabs, not five — the sentence in the
      `021-user-preferences` paragraph is now stale), and the root `CLAUDE.md` (`api` module list
      and the `Current state` test counts). The pipeline table gains no row: scheduling is a new
      entry point into existing stages, not a stage. → T017, T018
      *Done when:* no `CLAUDE.md` still says `SettingsForm` has five tabs, and the api module map
      lists `scheduler/`.
- [x] **T020** `[docs]` Walk the nine acceptance criteria in `spec.md` in order, tick each box, and
      set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`. → T019
      *Done when:* every AC box is ticked with the observed result, and no file in this directory
      still says `Approved`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

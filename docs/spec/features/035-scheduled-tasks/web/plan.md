---
title: Scheduled Tasks — web slice
service: web
last_updated: 2026-09-02
status: Implemented
---

# PLAN: Scheduled Tasks — `web` (`web/plan.md`)

Read `../spec.md` and `../plan.md` first. The GraphQL delta there is read-only.

## Scope

This slice adds a sixth tab to `/settings` — *Programación* — listing the four tasks with their
enable toggle, cron field, last-run outcome, next run and a per-task *Ejecutar ahora* button. It
adds the server actions that read `scheduledTasks` and call `runScheduledTask`, the hand-copied
types, and the catalog strings in both locales.

It owns **no** scheduling logic and no validation: an invalid cron is rejected by `api` and
rendered from the error envelope. It does not decide cadence defaults, does not compute
`nextRunAt`, and never calls `api` outside `fetchGraphQL`.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/scheduler.ts` | New | `ScheduledTask`, `ScheduledTaskRun`, `ScheduledTaskOutcome` — the hand-copied shape |
| `src/actions/scheduler.ts` | New | `getScheduledTasks()`, `runScheduledTaskAction(id)` |
| `src/components/settings/SchedulingPanel.tsx` | New | The tab's contents |
| `src/components/settings/SettingsForm.tsx` | Modified | Sixth tab entry, panel mounted with the others |
| `src/actions/settings.ts` | Modified | Four `schedule_*_cron` keys into `EDITABLE_KEYS`, four `schedule_*_enabled` into `BOOLEAN_KEYS` |
| `src/app/(dashboard)/settings/page.tsx` | Modified | `getScheduledTasks()` joins the existing `Promise.all` |
| `messages/es.json`, `messages/en.json` | Modified | `settings.tabs.scheduling`, `settings.scheduling.*`, `errors.schedule.*`, `errors.setting.expectedCron` |

## Existing code to reuse

- `src/components/settings/MediaServerFields.tsx` (`MediaServerIndexPanel`) — the exact precedent
  for *Ejecutar ahora*: `useTransition` plus `@/components/ui/button/Button` with a click handler,
  **never a nested `<form>`** (invalid HTML) and never a raw `<button>` (which defaults to
  `type="submit"` and would submit `SettingsForm`'s main form). Also the precedent for rendering a
  timestamp only after mount — `toLocaleString()` in SSR hydrates against the container's timezone,
  not the viewer's, and NFR-4 makes the displayed timezone part of the requirement.
- `src/components/settings/SettingsForm.tsx` — the structural rule: every panel is mounted at once
  and hidden with `className="hidden"`, never conditionally rendered, or `FormData` drops the
  fields of whatever tab is not showing and *Guardar* silently saves a subset.
- `src/components/settings/CheckboxField.tsx` + the hidden-input idiom in `src/actions/settings.ts`
  — a `Checkbox` is controlled and renders no named input, so each `_enabled` needs its hidden
  `'true'`/`'false'` input, read by value and not by `formData.has()`.
- `src/actions/media-server.ts` — the action shape for a non-form mutation returning
  `{ … } | { error, errorKey }` via `toActionError`.
- `src/lib/graphql-error.ts` — `translateGraphQLError` / `toActionError`. Never render a bare key;
  the English `message` is the fallback when the catalog has no entry.
- `src/lib/auth-session.ts` — `redirectToClearSession` in a read awaited during a render pass,
  `redirectIfUnauthenticated` inside an action. The settings page's existing sequencing (admin
  check first, `notFound()` for a non-admin, *then* the parallel fetches) is unchanged.
- `src/components/ui/tabs/TabNav.tsx` — the tab list; the icon comes from `lucide-react` like the
  five existing ones (`CalendarClock` fits the set).

## Steps

1. `src/types/scheduler.ts`: transcribe the delta. `nextRunAt` / `startedAt` / `finishedAt` arrive
   as strings over the wire; type them as `string | null`, not `Date`.
2. `src/actions/scheduler.ts`: `getScheduledTasks()` selects **every** field in the delta
   (`redirectToClearSession` on error, it is awaited during the page's render pass);
   `runScheduledTaskAction(id)` returns `{ task } | { error, errorKey }`.
3. `src/app/(dashboard)/settings/page.tsx`: add `getScheduledTasks()` to the existing
   `Promise.all`, after the admin check, and pass the result to `SettingsForm`.
4. `src/components/settings/SchedulingPanel.tsx`: one row per task — label from the catalog keyed
   by task id, `CheckboxField` + hidden input for `schedule_<id>_enabled`, a text input named
   `schedule_<id>_cron`, the last run's outcome and time, the next run, and the trigger button.
   The button disables itself while `running` is true or its transition is pending; on
   `error.schedule.task_already_running` it re-renders the row as running rather than showing a
   failure. Show the cron timezone note (NFR-4) once, at the top of the panel.
5. `src/components/settings/SettingsForm.tsx`: sixth `TabNav` item and a `panelClass("scheduling")`
   wrapper, following the five that exist.
6. `src/actions/settings.ts`: extend `EDITABLE_KEYS` and `BOOLEAN_KEYS`. Note that `EDITABLE_KEYS`
   filters blank values, which is correct here — a cleared cron field must not overwrite a stored
   expression with `""`.
7. `messages/{es,en}.json`: the tab label, the four task labels and descriptions, the panel copy,
   the three outcome labels, and the error strings. `es` keeps the existing Rioplatense register.

## Contract obligations

Consumes `Query.scheduledTasks` and `Mutation.runScheduledTask(id: String!)` exactly as
`../spec.md` writes them. Every error condition in that table has a defined behaviour here:

| Key | What this slice does |
| :-- | :-- |
| `error.auth.admin_required` | Already handled — the page `notFound()`s a non-admin before rendering |
| `error.schedule.task_not_found` | Inline message on that task's row; the rest of the tab keeps working |
| `error.schedule.task_already_running` | Re-render the row as running; **not** an error toast |
| `error.setting.expected_cron` | Surfaces through the existing `SettingsForm` error paragraph, like every other `updateSettings` rejection; the form state is not reset |

There is no codegen across this seam. A field renamed on `api` renders `undefined` here with no
compile error — the shape in `src/types/scheduler.ts` is the hand-copied half of the contract.

## Tests

None. `web` has no test suite (`services/web/CLAUDE.md`), and nothing in this slice can fail
silently in the Article IX sense: every failure mode here is visible on the screen the feature
exists to render. The manual pass in `../plan.md` § Verification is the check.

## Done when

```bash
bin/npm web run build
```

Exits 0, and `/settings` shows six tabs with *Programación* listing four tasks, each with a working
toggle, cron field and *Ejecutar ahora*.

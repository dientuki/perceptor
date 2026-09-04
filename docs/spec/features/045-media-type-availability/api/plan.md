---
title: Media Type Availability — api slice
service: api
last_updated: 2026-09-04
status: Implemented
---

# PLAN: Media Type Availability — `api` (`api/plan.md`)

## Scope

This slice exposes the two existing `movies_enabled` / `shows_enabled` settings to every
authenticated user through a new `mediaCapabilities` query, refuses a disabled type at the four
catalog entry points (`searchMedia`, `searchAllMedia`, `popularMedia`, `addMedia`), and makes the
scheduler aware of which tasks belong to which media type — reporting it as
`ScheduledTask.available`, refusing `runScheduledTask` for an unavailable task, and not arming its
cron.

It does **not** touch anything downstream of registration. Library listings, detail resolvers, the
acquisition mutations (`addTorrentToMovie`, `addMagnetToMovie`, `addMagnetToSeason` and the episode
twins), `uploads/`, `downloads/`, `process-jobs/` and `media-server/` are all deliberately unchanged
— REQ-11 says work already under way finishes, and leaving those files alone is the mechanism, not
an oversight. There is **no Prisma change**: `services/api/prisma/` must show no diff.

`web` owns every visible behaviour (sidebar, carousels, search copy, routes, preferences tabs,
scheduling row rendering). This slice owes it the contract in `../spec.md` and nothing else.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/media/media-capabilities.service.ts` | New | Reads the two flags off `SettingsService.getMap()`; exposes `read()`, `isEnabled(type)`, `assertEnabled(type)`, `enabledTypes()`. |
| `src/media/entities/media-capabilities.entity.ts` | New | `@ObjectType() MediaCapabilities { moviesEnabled, showsEnabled }`. |
| `src/media/media-capabilities.service.spec.ts` | New | See § Tests. |
| `src/media/media.module.ts` | Modified | Registers the new provider. `SettingsModule` is already imported — no new import. |
| `src/media/media.resolver.ts` | Modified | New `mediaCapabilities` query; `assertEnabled` before dispatch on `searchMedia`, `popularMedia`, `addMedia`. |
| `src/media/media-search.service.ts` | Modified | `searchAll` narrows to the enabled types before grouping; refuses when both are disabled. |
| `src/media/media-search.service.spec.ts` | Modified | Narrowing + refusal cases (see § Tests). |
| `src/media/media.resolver.spec.ts` | New | Refusal cases for the three gated operations (no spec file exists for this resolver today). |
| `src/scheduler/scheduler.registry.ts` | Modified | `ScheduledTaskDefinition` gains optional `mediaType`; the four entries declare theirs. |
| `src/scheduler/scheduler.service.ts` | Modified | Availability derived from the map already fetched in `arm()`, `runTask()` and `buildStatus()`. |
| `src/scheduler/entities/scheduled-task.entity.ts` | Modified | Adds `@Field() available: boolean`. |
| `src/scheduler/scheduler.service.spec.ts` | Modified | Arming and refusal cases (see § Tests). |
| `src/settings/settings.resolver.ts` | Modified | The `scheduleChanged` re-arm guard also fires for a changed `movies_enabled` / `shows_enabled`. |
| `src/settings/settings.resolver.spec.ts` | Modified | Case for the above. |
| `src/i18n/error-keys.ts` | Modified | Three new keys. |
| `src/i18n/messages.en.ts` | Modified | Their English renderings. |
| `src/schema.gql` | Regenerated | Artifact only — never hand-edited (Article IV). |

## Existing code to reuse

- `src/settings/settings.service.ts` → `getMap()` — the one way this service reads settings.
  `MediaCapabilitiesService` calls it; **do not** query `prisma.setting` directly.
- `src/process-jobs/process-jobs.service.ts:42` and `src/downloads/downloads.service.ts:90` —
  `settingsMap['compression_enabled'] !== 'false'`. That is the exact boolean idiom to copy: an
  absent row reads as **enabled**. Reading `=== 'true'` here would present a whole install as
  switched off with no error anywhere (`../plan.md` § Risks).
- `src/media/media-dispatch.service.ts` → `resolve(type)` — still the only thing that turns a `type`
  string into a service, and still what throws `MEDIA_UNSUPPORTED_TYPE` for a bogus one. The
  capability check runs *after* it in `popularMedia` (which already resolves first) and may run
  before it elsewhere; either order is fine as long as an unsupported type still yields
  `MEDIA_UNSUPPORTED_TYPE` and not `MEDIA_TYPE_DISABLED`.
- `src/i18n/i18n-error.ts` → `i18nError.forbidden(key, params?)` — the factory every user-facing
  throw goes through. Never `new ForbiddenException(...)` directly.
- `src/settings/settings.resolver.ts` → the three existing "did this submission actually change the
  key?" blocks (`changedDownloadsPath`, `mediaServerChanged`, `scheduleChanged`). The re-arm
  extension follows the `before[entry.key] !== entry.value` shape already there; do not add a fourth
  block when the third can widen its key list.
- `src/scheduler/scheduler.registry.ts` → `scheduleEnabledSettingKey` / `scheduleCronSettingKey`.
  The `mediaType` field belongs beside them, for the same reason: derived facts about a task live in
  the registry, not in its callers.
- `src/scheduler/scheduler.service.ts` → `arm()`, `runTask()` and `buildStatus()` each already hold
  a `Record<string, string>` settings map. Availability is computed from that map. **Do not inject
  `MediaCapabilitiesService` here** — it would pull `MediaModule` (and with it `MoviesModule` and
  `ShowsModule`) into `SchedulerModule`, adding a third edge to the `SettingsModule ⇄
  SchedulerModule` cycle that already needs `forwardRef` on both sides.

## Steps

1. Add `MEDIA_TYPE_DISABLED: 'error.media.type_disabled'`,
   `MEDIA_SEARCH_UNAVAILABLE: 'error.media.search_unavailable'` and
   `SCHEDULE_TASK_UNAVAILABLE: 'error.schedule.task_unavailable'` to `ERROR_KEYS`, in their existing
   sections, with English renderings in `messages.en.ts`. `error.media.type_disabled` interpolates
   `{type}`.
2. Write `MediaCapabilitiesService` in `src/media/`. It reads `getMap()` once per call and derives
   both flags with `!== 'false'`. `assertEnabled(type)` throws
   `i18nError.forbidden(MEDIA_TYPE_DISABLED, { type })` for a disabled type and returns silently for
   a type it does not know about — deciding that an unknown type is unsupported stays
   `MediaDispatchService`'s job, and duplicating it here would produce the wrong error key.
3. Add `MediaCapabilities` to `src/media/entities/` and register the service in `media.module.ts`.
4. Add the `mediaCapabilities` query to `MediaResolver`. No `@Public()`, no `@AllowService()` — it
   follows `popularMedia`'s stance exactly (NFR-2). No `AdminGuard`: every user reads it (REQ-1,
   REQ-12).
5. Call `assertEnabled(type)` in `searchMedia`, `popularMedia` and `addMedia`, before the work.
6. In `MediaSearchService.searchAll`, resolve the enabled types once, refuse with
   `i18nError.forbidden(MEDIA_SEARCH_UNAVAILABLE)` when none is enabled, and otherwise filter `rows`
   down to the enabled types **before** the grouping loop. The filter must precede every
   `dispatch.resolve(type).cacheAndEnrich(...)` call — filtering afterwards still returns the right
   rows while having already written the disabled type's TMDB rows into its Redis cache, with no
   error anywhere.
7. Add `mediaType?: MediaType` to `ScheduledTaskDefinition` and set it on the four entries:
   `refresh_movies` → movie, `refresh_shows` → show, `refresh_episodes` → show, `acquire_pending` →
   omitted (it is a no-op stub belonging to no type — `../spec.md` § Out of Scope; leave it
   unconditionally available).
8. In `SchedulerService`, add a private helper that answers "is this definition available?" from a
   settings map, and use it in three places:
   - `arm()` — skip an unavailable task exactly as it already skips a disabled one, so no cron job
     is registered for it.
   - `runTask()` — after the `findScheduledTask` miss check and before the running-guard: a
     `'manual'` trigger throws `i18nError.forbidden(SCHEDULE_TASK_UNAVAILABLE, { id })`; a `'cron'`
     trigger returns without creating a run row (unreachable while `arm()` is correct, and a
     `SKIPPED` row for it would be noise, not signal).
   - `buildStatus()` — sets `task.available`.
9. Add `available: boolean` to the `ScheduledTask` entity with `@Field()`, placed last so the
   generated SDL matches `../spec.md`.
10. Widen the `scheduleChanged` guard in `settings.resolver.ts` so a changed `movies_enabled` or
    `shows_enabled` also calls `schedulerService.arm()`. Without this, turning a type off leaves its
    task's cron armed and firing until the next restart, behind a UI that correctly shows it as
    unavailable — no error, no log line.
11. Boot once so `src/schema.gql` regenerates, and confirm the diff matches `../spec.md`'s SDL
    exactly (Article VIII's check).

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

- `Query.mediaCapabilities: MediaCapabilities!` with `moviesEnabled: Boolean!` and
  `showsEnabled: Boolean!`. Both non-null; there is no "unset" state — an absent row reads as
  enabled.
- `ScheduledTask.available: Boolean!`, additive, every other field unchanged.
- The four error rows, each reaching the wire as `extensions.i18n = { key, params? }` via the
  existing `graphql-error.formatter.ts`. `error.media.type_disabled` carries `{ type }`.
- `searchAllMedia` narrows while one type is enabled and refuses only when both are disabled. It
  must never return a row of a disabled type.

If any of this is wrong, stop and report — do not adapt it locally (Article VIII).

## Tests

Owed under Article IX, because each of these fails silently:

- `src/media/media-capabilities.service.spec.ts` — **new**. Defends against an install presenting
  itself as switched off: an empty settings map, and a map with the key set to anything other than
  `'false'`, must both read as enabled; only the literal `'false'` disables. Fault injection: change
  the derivation to `=== 'true'` and this must fail.
- `src/media/media-search.service.spec.ts` — **extend**. Defends against a disabled type's rows
  reaching that type's cache: assert `dispatch.resolve` is never called for the disabled type, not
  merely that the returned rows exclude it. Moving the filter after the grouping loop must fail this
  case. Plus the both-disabled refusal.
- `src/media/media.resolver.spec.ts` — the three refusals, and that an unsupported type still yields
  `MEDIA_UNSUPPORTED_TYPE` rather than `MEDIA_TYPE_DISABLED`. No spec file exists for this resolver
  today — write a real suite, never the `expect(service).toBeDefined()` scaffolding shape
  (Article IX).
- `src/scheduler/scheduler.service.spec.ts` — **extend**. Defends against a cron that keeps firing
  behind a disabled UI: with `movies_enabled: 'false'` and `schedule_refresh_movies_enabled: 'true'`,
  `arm()` registers no cron job for `refresh_movies`, `buildStatus` reports `available: false` with
  `nextRunAt` undefined, and `runTask('refresh_movies', 'manual')` throws. Also: the stored
  `schedule_refresh_movies_enabled` value is **not** rewritten — `enabled` still reads `true`.
- `src/settings/settings.resolver.spec.ts` — **extend**. Defends against the same stale cron from the
  other side: an `updateSettings` submission changing only `movies_enabled` must call `arm()`.

Not owed: the `MediaCapabilities` entity and the `mediaType` registry entries are declarations with
no branch to get wrong, and a mistake in either is a compile error or an immediately visible one.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
git status --short services/api/prisma
```

`tsc` reports 0 errors, the suite is green with the new cases, and the last command prints nothing
(no migration — see § Scope).

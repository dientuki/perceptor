---
title: Media Type Availability — Tasks
last_updated: 2026-09-04
status: Done
---

# TASKS: Media Type Availability (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[worker]` task exists, and none may be added: `services:` is `[api, web]`, and NFR-5 makes
`services/worker/` staying untouched the *mechanism* by which in-flight jobs finish (REQ-11), not an
omission. No `[infra]` task either — nothing about the stack's boot, wiring or `bin/` wrappers
changes, and there is no migration (`plan.md` § Migrations).

## Tasks

### Group 1 — contract and enforcement (`api`)

Everything `web` consumes is produced here. T002 and T005 are independent of each other and both
only need the error keys.

- [x] **T001** `[api]` Add `MEDIA_TYPE_DISABLED: 'error.media.type_disabled'`,
      `MEDIA_SEARCH_UNAVAILABLE: 'error.media.search_unavailable'` and
      `SCHEDULE_TASK_UNAVAILABLE: 'error.schedule.task_unavailable'` to `src/i18n/error-keys.ts`, in
      their existing sections, with English renderings in `src/i18n/messages.en.ts`.
      `error.media.type_disabled` interpolates `{type}`.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and
      `grep -n "type_disabled\|search_unavailable\|task_unavailable" services/api/src/i18n/*.ts`
      shows each key in both files.

- [x] **T002** `[api] [P]` Write `src/media/media-capabilities.service.ts` (reads
      `SettingsService.getMap()`; derives both flags with `!== 'false'`, never `=== 'true'`; exposes
      `read()`, `isEnabled(type)`, `assertEnabled(type)`, `enabledTypes()`), the
      `MediaCapabilities` `@ObjectType()` in `src/media/entities/`, and register the provider in
      `media.module.ts` (`SettingsModule` is already imported — add no import). `assertEnabled`
      returns silently for a type it does not recognise: deciding an unknown type is unsupported
      stays `MediaDispatchService`'s job. Add `src/media/media-capabilities.service.spec.ts` per
      `api/plan.md` § Tests. → T001
      *Done when:* `bin/npm api test -- media-capabilities` is green, including the case where an
      empty settings map reads as **both types enabled**, and that case fails if the derivation is
      switched to `=== 'true'`.

- [x] **T003** `[api]` Add the `mediaCapabilities` query to `src/media/media.resolver.ts` (no
      `@Public()`, no `@AllowService()`, no `AdminGuard` — every authenticated user reads it) and
      call `assertEnabled(type)` in `searchMedia`, `popularMedia` and `addMedia` before the work.
      Write `src/media/media.resolver.spec.ts` as a real suite (none exists today — never the
      `expect(service).toBeDefined()` shape). → T002
      *Done when:* `bin/npm api test -- media.resolver` is green, `addMedia(tmdbId, type: "show")`
      with `shows_enabled: 'false'` throws `error.media.type_disabled`, and an unsupported type
      still throws `error.media.unsupported_type` rather than the new key **(AC-5)**.

- [x] **T004** `[api] [P]` In `src/media/media-search.service.ts`, make `searchAll` resolve the
      enabled types once, refuse with `i18nError.forbidden(MEDIA_SEARCH_UNAVAILABLE)` when none is
      enabled, and otherwise filter `rows` down to the enabled types **before** the grouping loop —
      ahead of every `dispatch.resolve(type).cacheAndEnrich(...)` call. Extend
      `media-search.service.spec.ts`. → T002
      *Done when:* `bin/npm api test -- media-search` is green, and the new case asserts
      `dispatch.resolve` is **never called** for the disabled type (not merely that its rows are
      absent from the result) — moving the filter after the grouping loop must fail it.

- [x] **T005** `[api] [P]` Add `mediaType?: MediaType` to `ScheduledTaskDefinition` in
      `src/scheduler/scheduler.registry.ts` (`refresh_movies` → movie, `refresh_shows` → show,
      `refresh_episodes` → show, `acquire_pending` → omitted); add `@Field() available: boolean` last
      on `src/scheduler/entities/scheduled-task.entity.ts`; and in `src/scheduler/scheduler.service.ts`
      derive availability from the settings map each of `arm()`, `runTask()` and `buildStatus()`
      already holds — **do not inject `MediaCapabilitiesService`** (`api/plan.md` § Existing code to
      reuse says why). `arm()` skips an unavailable task; `runTask()` throws
      `SCHEDULE_TASK_UNAVAILABLE` for a `'manual'` trigger and returns without a run row for `'cron'`;
      `buildStatus()` sets `available`. Extend `scheduler.service.spec.ts`. → T001
      *Done when:* `bin/npm api test -- scheduler.service` is green, including: with
      `movies_enabled: 'false'` **and** `schedule_refresh_movies_enabled: 'true'`, `arm()` registers
      no cron job for `refresh_movies`, `buildStatus` reports `available: false` with `nextRunAt`
      undefined **and `enabled` still `true`** (the stored value is never rewritten), and
      `runTask('refresh_movies', 'manual')` throws **(AC-6)**.

- [x] **T006** `[api]` Widen the `scheduleChanged` guard in `src/settings/settings.resolver.ts:133`
      so a changed `movies_enabled` or `shows_enabled` also calls `schedulerService.arm()`, and add
      the case to `settings.resolver.spec.ts`. Without this, turning a type off leaves its task's
      cron armed and firing until the next restart, behind a UI that correctly shows it as
      unavailable — with no error and no log line. → T005
      *Done when:* `bin/npm api test -- settings.resolver` is green and the new case asserts `arm()`
      is called for a submission that changes only `movies_enabled`.

- [x] **T007** `[api]` Boot once so `src/schema.gql` regenerates, and check the diff against
      `spec.md` § GraphQL Contract Delta (Article VIII's check). Confirm no Prisma diff.
      → T003 → T004 → T005
      *Done when:* `git diff services/api/src/schema.gql` shows exactly `type MediaCapabilities`,
      `Query.mediaCapabilities` and `ScheduledTask.available` and nothing else, and
      `git status --short services/api/prisma` prints nothing.

### Group 2 — consumers (`web`)

Everything here depends on Group 1: the query and the field must exist before anything selects
them. T009 lands the message catalogs on its own so the six surface tasks can run in parallel
without three agents editing `messages/*.json` at once.

- [x] **T008** `[web]` Add the `MediaCapabilities` interface to `src/types/media.ts` and
      `getMediaCapabilities()` to `src/actions/media.ts`, `cache()`-wrapped like `fetchMe` in
      `src/actions/auth.ts`. On failure it throws a translated error — it must **never** fall back to
      `{ moviesEnabled: false, showsEnabled: false }`, which would render the product as uninstalled
      rather than as broken (NFR-4). → T003
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors, and a temporary server-side
      log in the dashboard layout prints the two booleans matching
      `bin/mysql -e "select \`key\`, value from settings where \`key\` in ('movies_enabled','shows_enabled')"`.

- [x] **T009** `[web]` Add every new string to `messages/en.json` **and** `messages/es.json`:
      `header.searchPlaceholderMovies` / `searchPlaceholderShows` / `searchUnavailable`, the
      billboard and `/search` both-disabled empty states, the Scheduling "unavailable" reason line,
      and `errors.media.type_disabled` / `errors.media.search_unavailable` /
      `errors.schedule.task_unavailable`. `header.searchPlaceholder` keeps its current
      "Search Movies & Series" value for the both-enabled case. The `es` strings in `spec.md`'s error
      table are canonical; the rest keeps the surrounding Rioplatense register. → T008
      *Done when:* `bin/npm web run build` exits 0 and
      `python3 -c "import json;a=json.load(open('services/web/messages/en.json'));b=json.load(open('services/web/messages/es.json'));print(a.keys()==b.keys())"`
      still reports the two catalogs structurally aligned.

- [x] **T010** `[web] [P]` Thread capabilities from `src/app/(dashboard)/layout.tsx` through
      `src/layout/AdminShell.tsx` to `src/layout/AppSidebar.tsx` (beside the existing `user` prop —
      neither layout component starts fetching), and filter Movies / Series out of `baseNavItems`
      per the flags. → T008 → T009
      *Done when:* with the seeded `shows_enabled: 'false'`, the sidebar shows **My Movies** and no
      **My Series**; every other entry, including the admin-only pair, is unchanged **(AC-1, REQ-2)**.

- [x] **T011** `[web] [P]` In `src/layout/AppHeader.tsx`, pick the placeholder from the pair and set
      `disabled` on the input when both types are off, so the form cannot submit. → T008 → T009
      *Done when:* the placeholder reads "Search Movies" with only movies enabled, "Search Series"
      with only series, "Search Movies & Series" with both, and with neither the input is disabled
      and Enter does nothing **(AC-1, AC-8, REQ-4)**.

- [x] **T012** `[web] [P]` In `src/app/(dashboard)/page.tsx`, build the `Promise.allSettled` list
      from the enabled types only — no `getPopularMedia` call is made for a disabled one — and render
      only those carousels; with both disabled render the breadcrumb and the empty state, not two
      blank carousels and not an error. Keep `unstable_rethrow` on every rejection: dropping it turns
      a stale session into a permanent error page instead of a bounce to `/login`. → T008 → T009
      *Done when:* with `shows_enabled: 'false'` the dashboard renders one carousel and the network
      trace shows a single `PopularMedia` operation with `type: "movie"`; with both off it renders
      the empty state **(AC-1, AC-8, REQ-3)**.

- [x] **T013** `[web] [P]` Add `searchMediaForPage(query, type)` beside `searchAllMedia` in
      `src/actions/media.ts` — reusing the existing `SEARCH_MEDIA_QUERY` constant and copying
      `searchAllMedia`'s `redirectToClearSession` auth-failure handling, because the existing
      `searchMedia` ends in the cookie-mutating `redirectIfUnauthenticated` and is illegal from a
      Server Component's render pass (`web/plan.md` step 6). Then in
      `src/app/(dashboard)/search/page.tsx` pick the operation from the pair, and render the
      unavailable state issuing no query when both are off. `searchMedia` itself stays untouched for
      `/movies/add` and `/shows/add`. → T008 → T009
      *Done when:* with `shows_enabled: 'false'`, searching from the header lands on `/search` with
      no series in the results and the network trace shows one `SearchMedia` operation with
      `type: "movie"` — **not** `searchAllMedia` filtered client-side **(AC-3, AC-8, REQ-5)**.

- [x] **T014** `[web] [P]` Call `notFound()` at the top of `src/app/(dashboard)/movies/page.tsx`,
      `movies/add/page.tsx`, `shows/page.tsx` and `shows/add/page.tsx` when the relevant flag is off,
      the same shape `users/page.tsx:30` already uses. `/movies/[id]` and `/shows/[id]` are **not**
      touched: an already-registered title stays reachable by direct link (REQ-11). → T008 → T009
      *Done when:* with `shows_enabled: 'false'`, `/shows` and `/shows/add` both render the not-found
      page while `/movies` lists normally, and a `/shows/[id]` link to an owned series still
      renders **(AC-2, REQ-6)**.

- [x] **T015** `[web] [P]` Pass capabilities from `src/app/(dashboard)/preferences/page.tsx` into
      `PreferencesForm`, build `tabItems` and the `TabKey` set from the enabled types, fall back to
      `general` if the active tab would be hidden, and in `handleSubmit` skip
      `setPreferredTorrentGroupsAction("MOVIE"…)` / `("SHOW"…)` when their tab is hidden — dropping
      the entry from the `Promise.all` destructuring rather than leaving a hole in it. → T008 → T009
      *Done when:* with `shows_enabled: 'false'`, `/preferences` shows General, Download Languages
      and Movies only; saving fires no `setPreferredTorrentGroups` with scope `SHOW`; and after
      re-enabling series the previously stored series torrent groups are still selected
      **(AC-4, REQ-7)**.

- [x] **T016** `[web] [P]` Add `available: boolean` to `src/types/scheduler.ts` and to **both**
      selection sets in `src/actions/scheduler.ts` (`scheduledTasks` and `runScheduledTask` — both
      return `ScheduledTask`, so a refreshed row arrives without the field otherwise). In
      `src/components/settings/SchedulingPanel.tsx`, disable the `Switch` and the run button on an
      unavailable row and show the reason, **keeping the hidden `schedule_<id>_enabled` input
      rendered at the task's stored value** — dropping it or forcing it to `"false"` means saving any
      unrelated setting silently disables the task for good (REQ-9). Add the
      `error.schedule.task_unavailable` branch to `handleRun` beside the existing already-running
      branch. → T005 → T008 → T009
      *Done when:* with `movies_enabled: 'false'`, `refresh_movies` renders with both controls
      disabled and a reason; saving Settings leaves
      `bin/mysql -e "select value from settings where \`key\`='schedule_refresh_movies_enabled'"`
      unchanged; and re-enabling movies restores the task exactly as it was **(AC-4, AC-6, REQ-8)**.

### Group 3 — verification and docs

- [x] **T017** `[docs]` Update `services/api/CLAUDE.md` (the `media/` entry gains
      `MediaCapabilitiesService` and the `mediaCapabilities` query; the `scheduler/` entry gains
      `mediaType` on the registry and `available` on the status projection, plus the note that
      flipping a media flag re-arms), `services/web/CLAUDE.md` if a convention changed, and the root
      `CLAUDE.md` — `movies_enabled`/`shows_enabled` are no longer write-only, and the § Current
      state test counts get a fresh measurement. No pipeline-stage row changes status.
      → T007 → T016
      *Done when:* `grep -n "mediaCapabilities" services/api/CLAUDE.md CLAUDE.md` hits both, and the
      § Current state paragraph names this feature with numbers taken from a re-run, not copied.

- [x] **T018** `[docs]` Walk every acceptance criterion in `spec.md` against the running stack
      (`plan.md` § Verification, steps 1–10), tick each box, and set `status: Implemented` on
      `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`. AC-7 is the in-flight non-regression
      check and AC-9 includes the untouched-worker proof — neither is covered by any implementation
      task, on purpose. → T017
      *Done when:* every `- [ ]` in `spec.md` § Acceptance Criteria is `- [x]`,
      `git status --short services/worker` prints nothing, and `bin/npm api test`,
      `bin/cli api npx --no tsc --noEmit`, `bin/cli web npx --no tsc --noEmit` and
      `bin/npm web run build` all pass.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

---
title: Media Type Availability — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-04
status: Implemented
---

# PLAN: Media Type Availability (`plan.md`)

## Approach

Two existing `Setting` rows, `movies_enabled` and `shows_enabled`, become readable by every
authenticated user and enforced at the entry points. Nothing is stored, migrated or configured — the
whole feature is a read of `SettingsService.getMap()` plumbed to two places that cannot reach it
today: `MediaResolver` (which has no reason to know about Settings yet) and `web` (whose only door
to Settings, the `settings` query, is `AdminGuard`-only).

On `api` the seam is one small service, `media/media-capabilities.service.ts`, sitting where
`MediaSearchService` and `PopularMediaService` already sit — `MediaModule` already imports
`SettingsModule`, so this costs no new module and creates no import cycle. It answers two questions:
the pair of booleans behind the new `mediaCapabilities` query, and `assertEnabled(type)` for
`searchMedia` / `popularMedia` / `addMedia`. The narrowing half of REQ-10 goes inside
`MediaSearchService.searchAll`, which already groups TMDB's multi rows by type — it drops the groups
whose type is disabled **before** handing anything to `cacheAndEnrich`, so a disabled type's rows
never reach that type's Redis cache either.

Scheduling deliberately does **not** use that service. `SchedulerService` already injects
`SettingsService` and already fetches the same map in `arm()`, `runTask()` and `buildStatus()`, so
reaching for `MediaCapabilitiesService` would mean `SchedulerModule → MediaModule →
MoviesModule/ShowsModule` — an enormous dependency for two boolean reads, and a third edge on the
`SettingsModule ⇄ SchedulerModule` cycle that already needs `forwardRef` on both sides. Instead
`scheduler.registry.ts` grows an optional `mediaType` on `ScheduledTaskDefinition`, which is where
the spec says the `taskId → flag` mapping belongs, and `SchedulerService` derives `available` from
the map it is already holding.

On `web` the seam is one `cache()`-wrapped server action, the same idiom `actions/auth.ts` uses for
`fetchMe` — one round trip per request no matter how many components ask (NFR-6). The dashboard
layout reads it once and hands it to `AdminShell` beside the `user` it already passes, which is how
`AppSidebar` and `AppHeader` get it without either becoming a data-fetching component. Pages that
must 404 call `notFound()` the way `users/page.tsx` and `settings/page.tsx` already do for their
admin check.

The alternative considered and rejected: relaxing the `settings` query's `AdminGuard` to expose these
two keys to everyone. It leaks the whole settings table (TMDB key, qBittorrent credentials,
media-server API key) to reach two booleans. A dedicated, minimal query is the same call
`defaultUiLocale` already makes for the same reason.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the contract. `web` cannot query `mediaCapabilities` or read `ScheduledTask.available` before the decorators exist, and `bin/npm web run build` will not fail on the absence — the failure would be at runtime. |
| 2 | `web` | Consumes both. Every one of REQ-2…REQ-8's visible behaviours lives here. |

The two slices **can be written in parallel** — the contract in `../spec.md` is frozen and both
agents read it rather than each other — but `web`'s manual verification (AC-1…AC-4, AC-8) cannot
run until `api` is up with the new query. Sequence the *verification*, not necessarily the *writing*.

Within `api` there are two independent halves — media enforcement and scheduler availability — that
share only `ERROR_KEYS`. Within `web` the surfaces are independent of each other once the capability
action exists; that action is the one thing that must land first.

## Contract Freeze

The `## GraphQL Contract Delta` in `../spec.md` is frozen as of `status: Approved`. Things an
implementer will want to change and must not:

- **`ScheduledTask.available` is a field on the existing type, not a new query.** From inside `web`
  it will look redundant — `web` already has `mediaCapabilities` and could derive availability from
  the task id. It must not. The `refresh_episodes → series` mapping is not guessable from the id, and
  a fifth task added to the registry later must be covered without a `web` edit.
- **`MediaCapabilities` has exactly two fields.** Not a list of enabled types, not a `searchEnabled`
  convenience boolean. `web` derives the search mode from the pair.
- **`searchAllMedia` narrows rather than refusing while one type is enabled.** From inside `api` the
  symmetric thing would be to refuse it whenever anything is disabled, since `web` is supposed to
  call `searchMedia(type)` in that case. It must not: the narrowing is what makes a direct caller,
  a stale client or a race safe.
- **`error.media.type_disabled` takes a `type` param.** Do not split it into two keys.

## Migrations

None. `movies_enabled` and `shows_enabled` are existing seeded `Setting` rows with
`kind: 'boolean'` in `SETTINGS_CATALOG`. No model, column, enum or index changes, so
`services/api/prisma/` must show no diff at all — a migration directory appearing in this feature's
diff is a bug, not a bonus.

Reversibility: the whole feature reverts by reverting the code. No data is written and none is
migrated, so a rollback leaves the two settings exactly as an administrator last set them.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Reading the flag as `map[key] === 'true'` | An install whose row is missing (a hand-edited `settings` table, a future seed change) reads as **both types disabled**. The product presents itself as switched off, with no error anywhere and nothing in the logs. | Read as `!== 'false'`, the exact idiom `process-jobs.service.ts:42` and `downloads.service.ts:90` already use for `compression_enabled`. Covered by a case in `media-capabilities.service.spec.ts` asserting an empty map reads as enabled. |
| Filtering `searchAllMedia` **after** `cacheAndEnrich` | Results look correct, but the disabled type's TMDB rows have already been written into that type's Redis cache and catalog rows. Nothing errors; the leak is invisible until someone inspects Redis. | The filter runs on `rows` before grouping, i.e. before any `dispatch.resolve(type)` call. Fault-injected test: moving the filter after the loop must fail the spec. |
| `arm()` never re-runs when a **media** flag changes | `SettingsResolver.updateSettings` re-arms the scheduler only when a `schedule_*` key was submitted. `movies_enabled` is not one, so turning movies off leaves `refresh_movies`' cron armed and firing until the next `api` restart — while the UI correctly shows it as unavailable. Nothing errors; the task just keeps running behind a greyed-out switch. | The `scheduleChanged` guard in `settings.resolver.ts:133` must also fire for a changed `movies_enabled` / `shows_enabled`, not only for `SCHEDULE_SETTING_KEYS`. Named explicitly in `api/plan.md` and covered by a `settings.resolver.spec.ts` case. |
| A disabled scheduling row stops submitting its stored value | `SchedulingPanel` renders a hidden `schedule_<id>_enabled` input inside the main settings form. If the disabled row drops that input, or emits `"false"`, then saving *any* unrelated setting silently turns the task off — and it stays off after the media type is re-enabled, contradicting REQ-9's "the stored value is never rewritten". | The row keeps emitting its hidden input at the **stored** value while unavailable; only the visible `Switch` and the run button are disabled. Verified by AC-4 (re-enabling restores the task exactly as it was). |
| Hiding a preferences tab wipes its saved values | `PreferencesForm.handleSubmit` fires all seven mutations unconditionally. A hidden Movies tab whose state was never initialised would post an empty id list and clear the user's stored movie torrent groups, reported as a successful save. | REQ-7: the two scoped `setPreferredTorrentGroups` calls are skipped when their tab is hidden. Today's state *is* initialised from `preferences`, so this is currently latent rather than live — which is exactly why it must be written down before someone refactors the initialiser. |
| `web` hides the UI but `api` does not enforce | Every REQ-2…REQ-8 surface passes review while `addMedia(type:"show")` still registers series from any GraphQL client. | REQ-10 is `api`'s slice and AC-5/AC-6 are hand-issued mutations, deliberately bypassing the UI. |
| The capability read failing is treated as "everything disabled" | A transient `api` blip renders an empty sidebar, no carousels and a dead search box. The user sees a product that looks uninstalled rather than an error. | NFR-4: the action throws and the page surfaces it through the existing `translateGraphQLError` path, the same way `getPopularMedia`'s failure already becomes `initialError` on the carousel. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
git status --short services/worker services/api/prisma
```

The last command must print nothing: `worker` is untouched (NFR-5) and there is no migration.

Manual pass, with the stack up (`bin/dev -d`) and a fresh database (`bin/dbreset`, which leaves
`shows_enabled` at its seeded `false`):

1. Sign in. The sidebar shows **My Movies** and no **My Series**; the dashboard renders one
   carousel; the header placeholder reads "Search Movies" (AC-1).
2. Navigate to `/shows` and `/shows/add` by URL — both render the not-found page; `/movies` lists
   normally (AC-2).
3. Search from the header. Results contain no series, and the browser's network tab shows one
   `SearchMedia` operation with `type: "movie"` (AC-3).
4. Open `/preferences` — General, Download Languages and Movies tabs only.
5. Settings → Scheduling: `refresh_shows` and `refresh_episodes` are disabled with a reason;
   `refresh_movies` and `acquire_pending` are interactive.
6. Settings → Media Manager: turn series on, save, reload. Everything above reverses (AC-4).
7. Turn **movies** off. Confirm `refresh_movies` goes non-interactive, then hand-issue
   `runScheduledTask(id: "refresh_movies")` from the GraphQL playground and confirm
   `extensions.i18n.key === "error.schedule.task_unavailable"` and that
   `bin/mysql -e 'select count(*) from scheduled_task_runs'` is unchanged (AC-6). Without restarting
   `api`, confirm the cron is disarmed — `scheduledTasks` reports `nextRunAt: null` for it.
8. With series still off, hand-issue `addMedia(tmdbId: 1399, type: "show")` and confirm
   `error.media.type_disabled` plus an unchanged `bin/mysql -e 'select count(*) from shows'` (AC-5).
9. Turn both off: the header input is disabled, `/search` shows the unavailable state, the dashboard
   shows its empty state (AC-8).
10. With a film mid-download, turn movies off and reload: the detail page still opens by direct
    link, progress still advances, and the encode still completes and files (AC-7).

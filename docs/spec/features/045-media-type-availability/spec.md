---
title: Media Type Availability
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-04
last_updated: 2026-09-04
status: Implemented
services: [api, web]
---

# SPEC: Media Type Availability (`spec.md`)

## Context & Goal

The Settings screen has offered two switches since long before `044-settings-screen-polish` tidied
them into the Media Manager tab: `movies_enabled` and `shows_enabled`
(`services/api/src/settings/settings.catalog.ts`, seeded in `services/api/prisma/seeds/settings.ts`
as `true` / `false`). An administrator can flip either one, `updateSettings` persists it,
`MediaManagerPanel.tsx` greys out the matching folder picker — and then nothing else in the product
reads the value. `033-billboard-and-navigation` said so in its own § Out of Scope, and
`006-media-search` before it. A fresh install therefore ships with series "disabled" while the
sidebar still offers **My Series**, the billboard still renders a series carousel, the header search
still returns series, and `addMedia(type: "show")` still registers one. The switch is decoration.

This feature makes the two flags mean something. They are a **system-wide** capability declaration,
identical for every user, administrator included — not a per-user preference. When a type is
disabled it disappears from the surfaces that would let a user acquire a **new** title of that type:
the sidebar entry (`services/web/src/layout/AppSidebar.tsx`), the billboard carousel
(`app/(dashboard)/page.tsx` + `components/billboard/PopularCarousel.tsx`), the header search box and
its results page (`layout/AppHeader.tsx`, `app/(dashboard)/search/page.tsx`), the `/movies` and
`/shows` routes and their `add` pages, the matching tab in `/preferences`
(`components/preferences/PreferencesForm.tsx`), and the scheduled tasks that sweep that type
(`components/settings/SchedulingPanel.tsx`, `services/api/src/scheduler/`). `api` enforces the same
rule at those entry points, so a hidden button is not the only thing standing between a disabled
type and a new row.

The line the enforcement stops at is deliberate, and it is the reason this is a spec rather than a
`web` patch: **work already under way finishes.** A film registered yesterday, a torrent downloading
now, a `bull:process` job the worker is holding, an `encodeCompleted` report arriving late — none of
them are refused because an administrator flipped a switch in between. Disabling a type closes the
door to new titles; it does not abandon the ones already inside. No pipeline stage in the root
`CLAUDE.md` changes status, and `services/worker/` is not touched at all — that is the mechanism by
which in-flight work survives, not an omission.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Capability query)**: Any authenticated user — administrator or not — must be able to
      read the two flags from `api`. The existing `settings` query is `AdminGuard`-only, so a regular
      user has no way to reach `movies_enabled` / `shows_enabled` today.
- [ ] **REQ-2 (Sidebar)**: **My Movies** must appear in the sidebar only while movies are enabled;
      **My Series** only while series are enabled. Every other entry (Billboard, Calendar, Downloads,
      and the admin-only Settings/Users) is unaffected.
- [ ] **REQ-3 (Billboard)**: The dashboard must render the popular-movies carousel only while movies
      are enabled and the popular-series carousel only while series are enabled, and must not call
      the catalog for a disabled type at all. With both disabled it renders its heading and an
      explanatory empty state, not two blank carousels.
- [ ] **REQ-4 (Search box copy)**: The header search input's placeholder must state what is actually
      searchable — "Search Movies" when only movies are enabled, "Search Series" when only series
      are, "Search Movies & Series" when both are. With both disabled the input is **disabled** and
      reads as unavailable; submitting it is impossible.
- [ ] **REQ-5 (Search results source)**: The results page must query through the service that matches
      what is enabled, rather than filtering a wider result set afterwards: movies only →
      `searchMedia(type: "movie")`, series only → `searchMedia(type: "show")`, both → the current
      `searchAllMedia`. Ordering is then whatever that service already returns; neither `api` nor
      `web` re-sorts. With both disabled, `/search` renders the unavailable state and issues no query.
- [ ] **REQ-6 (Routes)**: `/movies`, `/movies/add`, `/shows` and `/shows/add` must answer the existing
      not-found page while their type is disabled, so a bookmark or a hand-typed URL is not a way
      around REQ-2.
- [ ] **REQ-7 (Preferences tabs)**: `/preferences` must show the **Movies** tab only while movies are
      enabled and the **Series** tab only while series are. General and Download Languages always
      show. A hidden tab's stored preferences are left untouched in the database and are not
      submitted by the form while hidden.
- [ ] **REQ-8 (Scheduling)**: In Settings → Scheduling, a task belonging to a disabled type must be
      non-interactive — its enable switch and its "Run now" button both disabled, with the row saying
      why. `refresh_movies` belongs to movies; `refresh_shows` and `refresh_episodes` belong to
      series. `acquire_pending` belongs to neither and is never gated (see § Out of Scope).
- [ ] **REQ-9 (Scheduling enforcement)**: `runScheduledTask` must refuse a task whose type is
      disabled, and the scheduler must not arm that task's cron while its type is disabled — even if
      `schedule_refresh_movies_enabled` is still stored as `true`. The stored value is never
      rewritten: re-enabling the type re-arms the task exactly as it was.
- [ ] **REQ-10 (Entry-point enforcement)**: `searchMedia`, `popularMedia` and `addMedia` must refuse a
      disabled type. `searchAllMedia` narrows to the enabled type(s) while at least one is enabled,
      and refuses only when both are disabled — a caller must never receive series rows from it while
      series are off.
- [ ] **REQ-11 (In-flight work is never refused)**: Nothing downstream of registration is gated.
      Library listings and detail resolvers, the acquisition mutations on an already-registered title
      (`addTorrentToMovie`, `addMagnetToMovie`, `addMagnetToSeason`, the episode twins), the tus
      upload route, `torrentCompleted`, `encodeCompleted`/`encodeFailed`, and every `worker` job must
      behave identically whether or not the type is enabled. A title already in the library stays
      reachable by direct link, keeps downloading, keeps transcoding and keeps being filed.
- [ ] **REQ-12 (System-wide)**: The two flags apply identically to every user. There is no per-user
      override and no administrator bypass — an administrator sees the same sidebar, the same
      carousels and the same search box as anyone else.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No new configuration)**: This feature reads `movies_enabled` / `shows_enabled` as they
      exist today. It adds no setting, no column and no migration.
- [ ] **NFR-2 (Auth shape)**: The capability query requires a real user session. It carries neither
      `@Public()` nor `@AllowService()` — the worker/qBittorrent service token must not read it,
      matching `popularMedia`'s existing stance.
- [ ] **NFR-3 (Seeded default is a live case)**: `shows_enabled` seeds `false`, so a fresh install
      exercises the "series disabled" path on first boot. Every acceptance criterion below must hold
      on an unmodified `bin/dbreset`.
- [ ] **NFR-4 (A failed read is not a lockout)**: If the capability query itself fails, `web` must not
      silently present the product as fully disabled. It surfaces the error the way the billboard
      already surfaces a catalog failure.
- [ ] **NFR-5 (Worker untouched)**: No file under `services/worker/` changes. This is the enforcement
      mechanism for REQ-11, not an omission.
- [ ] **NFR-6 (No per-request settings storm)**: A page render reads the two flags once and passes
      them down, rather than each component querying independently.

## GraphQL Contract Delta

```graphql
type MediaCapabilities {
  moviesEnabled: Boolean!
  showsEnabled: Boolean!
}

type ScheduledTask {
  id: String!
  enabled: Boolean!
  cron: String!
  running: Boolean!
  nextRunAt: DateTime
  lastRun: ScheduledTaskRun
  available: Boolean!
}

type Query {
  mediaCapabilities: MediaCapabilities!
}
```

`MediaCapabilities` is a new type behind a new query. `ScheduledTask` gains exactly one field,
`available` — `false` when the task belongs to a media type that is currently disabled, `true`
otherwise. The `taskId → flag` mapping stays inside `api`'s scheduler registry rather than being
re-derived by `web` from `mediaCapabilities`, so a fifth task added later is covered without a `web`
edit. Every other field of `ScheduledTask` is unchanged; no field is removed and no argument changes,
so the delta is additive and an unpatched consumer keeps working.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `searchMedia` / `popularMedia` / `addMedia` called with `type: "movie"` while `movies_enabled` is `false` | `ForbiddenException`, `error.media.type_disabled` | `Las películas están deshabilitadas en este sistema` |
| `searchMedia` / `popularMedia` / `addMedia` called with `type: "show"` while `shows_enabled` is `false` | `ForbiddenException`, `error.media.type_disabled` | `Las series están deshabilitadas en este sistema` |
| `searchAllMedia` called while both flags are `false` | `ForbiddenException`, `error.media.search_unavailable` | `La búsqueda está deshabilitada en este sistema` |
| `runScheduledTask` called for a task whose media type is disabled | `ForbiddenException`, `error.schedule.task_unavailable` | `Esta tarea no está disponible: su tipo de contenido está deshabilitado` |

The three new keys (`error.media.type_disabled`, `error.media.search_unavailable`,
`error.schedule.task_unavailable`) join `ERROR_KEYS` in `services/api/src/i18n/error-keys.ts` with
their English rendering in `messages.en.ts`, and get an `en`/`es` entry in
`services/web/messages/{en,es}.json`. `error.media.type_disabled` takes a `type` param so one key
covers both of its rows.

What each consumer does with them:

- **`web` — `/search`, `/movies/add`, `/shows/add`, the billboard.** These are unreachable states once
  REQ-2/3/4/6 land: `web` never issues a query for a type it has already been told is disabled. The
  errors are the backstop for the race — an administrator flips the switch between render and submit
  — and are rendered through the existing `translateGraphQLError` path, never swallowed.
- **`web` — `SchedulingPanel`.** Reads `available` and disables the row. It must still handle
  `error.schedule.task_unavailable` coming back from "Run now", exactly as it already handles
  `error.schedule.task_already_running`, because the switch may have been flipped in another tab.
- **`worker`.** Consumes none of this. `worker`'s GraphQL surface is untouched (NFR-5).

## Data Model Changes

None. `movies_enabled` and `shows_enabled` are existing `Setting` rows with `kind: 'boolean'` in
`SETTINGS_CATALOG`; no model, field, enum or migration changes.

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| — | None | — | No |

## Acceptance Criteria

- [x] **AC-1**: After `bin/dbreset` (so `shows_enabled` is `false`), signing in shows a sidebar with
      **My Movies** and no **My Series**, the dashboard renders one carousel, and the header search
      placeholder reads "Search Movies".
- [x] **AC-2**: With `shows_enabled` `false`, navigating directly to `/shows` and to `/shows/add` both
      render the not-found page, while `/movies` lists normally.
- [x] **AC-3**: With `shows_enabled` `false`, searching from the header lands on `/search` with
      results containing no series, and the network trace shows a single `searchMedia(type: "movie")`
      operation — not `searchAllMedia` with client-side filtering.
- [x] **AC-4**: Turning `shows_enabled` on from Settings → Media Manager and reloading makes **My
      Series**, the series carousel, the **Series** preferences tab and the "Search Movies & Series"
      placeholder all appear, with no other change.
- [x] **AC-5 (failure path)**: With `shows_enabled` `false`, a hand-issued
      `addMedia(tmdbId: 1399, type: "show")` — the button that would send it is not rendered — is
      rejected with `extensions.i18n.key = "error.media.type_disabled"` and creates no row:
      `bin/mysql -e 'select count(*) from shows'` returns the same number before and after.
- [x] **AC-6 (failure path)**: With `movies_enabled` `false`, Settings → Scheduling shows
      `refresh_movies` with both its switch and its "Run now" button disabled; a hand-issued
      `runScheduledTask(id: "refresh_movies")` is rejected with `error.schedule.task_unavailable` and
      writes no `scheduled_task_runs` row.
- [x] **AC-7 (in-flight)**: With a film in `DOWNLOADING`, turning `movies_enabled` off and reloading:
      the film's detail page still opens by direct link, its progress still advances, and on
      completion the worker still transcodes and files it.
- [x] **AC-8**: With both flags `false`, the header search input is disabled, `/search` renders the
      unavailable state, and the dashboard shows its empty state rather than an error.
- [x] **AC-9**: `bin/npm api test` passes, `bin/cli api npx --no tsc --noEmit` reports 0 errors, and
      `bin/npm web run build` exits 0. `services/worker/` shows no diff (`git status services/worker`
      is clean), per NFR-5.

## Out of Scope

- **`acquire_pending`.** It is a no-op stub
  (`services/api/src/scheduler/tasks/acquire-pending.task.ts`) that returns `itemsProcessed: 0` and
  sweeps nothing, so there is no behaviour to gate and no type it belongs to. It stays
  `available: true` unconditionally. The spec that eventually implements it owns scoping its sweep to
  the enabled types; adding a gate to a stub now would be a flag with nothing behind it
  (Constitution, Article X).
- **Hiding or deleting existing titles of a disabled type.** Library listings, detail pages and their
  acquisition mutations stay fully open (REQ-11). Disabling series does not hide the series already
  registered — it stops new ones. Culling them would be destructive and is nobody's stated intent.
- **The Media Manager tab's own behaviour.** `044-settings-screen-polish` already decided how the two
  switches and their folder pickers interact. This feature reads the stored values; it does not
  restyle, relabel or revalidate the tab that writes them.
- **A per-user override.** REQ-12 is explicit that this is system-wide. Nothing here touches
  `UserPreference`/`UserLanguagePreference`, and the flags stay in `Setting` rather than moving.
- **`worker`.** Untouched, deliberately (NFR-5). A job already on the queue runs to completion under
  the rules it was enqueued with.
- **Registration side effects of a disabled type.** The background season/episode hydration, the
  media-server reconciliation and the local index are all downstream of a registration this feature
  now refuses; none needs its own gate, because none is reachable without one.
- **The `/calendar` and `/downloads` routes.** Both can list rows of either type and both are about
  work already in flight, which REQ-11 protects. Filtering them by the flags would contradict it.

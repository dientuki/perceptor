---
title: Media Type Availability — web slice
service: web
last_updated: 2026-09-04
status: Implemented
---

# PLAN: Media Type Availability — `web` (`web/plan.md`)

## Scope

This slice reads `mediaCapabilities` once per request and reshapes seven surfaces around it: the
sidebar (REQ-2), the billboard's two carousels (REQ-3), the header search placeholder and its
disabled state (REQ-4), the `/search` results source (REQ-5), the four `/movies` and `/shows` routes
(REQ-6), the `/preferences` tabs (REQ-7) and the Settings → Scheduling rows (REQ-8).

It does **not** enforce anything — `api` refuses a disabled type at the entry points, and this slice
must still handle those errors as a backstop for the race where an administrator flips a switch
between render and submit. It does not touch the Media Manager tab that *writes* the two settings
(`044-settings-screen-polish` owns that), does not filter `/downloads` or `/calendar` (both are about
work already in flight, which REQ-11 protects), and does not hide or filter any already-registered
title: `/movies/[id]` and `/shows/[id]` keep working by direct link whatever the flags say.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/media.ts` | Modified | `MediaCapabilities` interface beside the existing `MEDIA_TYPE`. |
| `src/actions/media.ts` | Modified | `getMediaCapabilities()`, `cache()`-wrapped; plus `searchMediaForPage(query, type)` — see step 6. |
| `src/app/(dashboard)/layout.tsx` | Modified | Reads capabilities beside `getCurrentUser()` and passes them to `AdminShell`. |
| `src/layout/AdminShell.tsx` | Modified | New prop, forwarded to `AppSidebar` and `AppHeader`. |
| `src/layout/AppSidebar.tsx` | Modified | `baseNavItems` filtered by the flags (REQ-2). |
| `src/layout/AppHeader.tsx` | Modified | Placeholder per mode; input disabled when both are off (REQ-4). |
| `src/app/(dashboard)/page.tsx` | Modified | Fetches and renders only the enabled carousels; empty state when both are off (REQ-3). |
| `src/app/(dashboard)/search/page.tsx` | Modified | Picks `searchMedia(type)` vs `searchAllMedia`; unavailable state when both are off (REQ-5). |
| `src/app/(dashboard)/movies/page.tsx` | Modified | `notFound()` when movies are off (REQ-6). |
| `src/app/(dashboard)/movies/add/page.tsx` | Modified | Same. |
| `src/app/(dashboard)/shows/page.tsx` | Modified | `notFound()` when series are off. |
| `src/app/(dashboard)/shows/add/page.tsx` | Modified | Same. |
| `src/components/preferences/PreferencesForm.tsx` | Modified | Tab list filtered; the two scoped saves skipped while hidden (REQ-7). |
| `src/app/(dashboard)/preferences/page.tsx` | Modified | Passes capabilities into the form. |
| `src/types/scheduler.ts` | Modified | `ScheduledTask` gains `available: boolean`. |
| `src/actions/scheduler.ts` | Modified | The query selects `available`. |
| `src/components/settings/SchedulingPanel.tsx` | Modified | Unavailable rows: switch and run button disabled, reason shown, hidden input keeps the stored value (REQ-8). |
| `messages/en.json`, `messages/es.json` | Modified | New UI copy + the three new error keys. |

## Existing code to reuse

- `src/actions/auth.ts` → `fetchMe` wrapped in React's `cache()`, with `getCurrentUser()` on top.
  That is the idiom for `getMediaCapabilities()`: one round trip per request however many components
  ask (NFR-6). Do not build a context provider or a client-side fetch for this.
- `src/app/(dashboard)/layout.tsx` + `src/layout/AdminShell.tsx` — the existing "server component
  fetches, shell distributes" seam that already carries `user` to `AppSidebar` (`isAdmin`) and
  `AppHeader`. Capabilities ride the same path; neither layout component starts fetching.
- `src/layout/AppSidebar.tsx` — `baseNavItems` and the `isAdmin ? [...] : baseNavItems` composition
  already there. Filter that array; do not add a second nav-building path.
- `src/app/(dashboard)/users/page.tsx:30` and `settings/page.tsx:35` — `notFound()` from
  `next/navigation` as the guard in a page's render. REQ-6 is the same shape.
- `src/actions/media.ts` → `searchMedia(query, type)` and `searchAllMedia(query)`. Both already
  exist, both already translate errors. REQ-5 is a choice between them, never a new action and never
  client-side filtering of a wider result.
- `src/app/(dashboard)/page.tsx` — the `Promise.allSettled` + `unstable_rethrow` + per-carousel
  `initialError` shape. Keep it; only the *set* of promises changes with the flags. `unstable_rethrow`
  must survive — dropping it turns a stale session into a permanent error page instead of a bounce to
  `/login`.
- `src/components/preferences/PreferencesForm.tsx` — `TABS`, `tabItems` and `panelClass`. Filter the
  tab list; the panels stay mounted-and-`hidden` for the visible ones as they are now.
- `src/components/settings/SchedulingPanel.tsx` — the `Switch` + hidden-input pairing and the
  `errorKey === "error.schedule.task_already_running"` branch in `handleRun`. The new
  `error.schedule.task_unavailable` branch goes beside it.
- `src/lib/graphql-error.ts` → `translateGraphQLError` — how every `extensions.i18n.key` becomes
  copy. The three new keys need entries in both message catalogs, nothing more.

## Steps

1. Add `MediaCapabilities` to `src/types/media.ts` and `getMediaCapabilities()` to
   `src/actions/media.ts`, `cache()`-wrapped, throwing a translated error on failure like its
   neighbours. It must **not** swallow a failure into `{ moviesEnabled: false, showsEnabled: false }`
   — that renders the product as uninstalled instead of as broken (NFR-4).
2. Read it in `app/(dashboard)/layout.tsx` alongside `getCurrentUser()` and pass it through
   `AdminShell` to `AppSidebar` and `AppHeader`.
3. `AppSidebar`: drop the Movies and/or Series entries from `baseNavItems` per the flags. Nothing
   else in the nav changes.
4. `AppHeader`: derive the mode from the pair and pick the placeholder — `header.searchPlaceholder`
   keeps its current "Search Movies & Series" value for the both-enabled case; add
   `searchPlaceholderMovies`, `searchPlaceholderShows` and `searchUnavailable`. With both disabled,
   set `disabled` on the input so the form cannot submit.
5. Billboard: build the `Promise.allSettled` list from the enabled types only, so no
   `getPopularMedia` call is made for a disabled one, and render only those carousels. With both
   disabled, render the breadcrumb and a new empty-state string — not two empty carousels and not an
   error.
6. `/search`: choose the operation from the pair — movies only → the movie search, series only → the
   series search, both → `searchAllMedia(query)`, neither → render the unavailable state and issue no
   query.

   **The existing `searchMedia` cannot be called from this page.** It ends in
   `redirectIfUnauthenticated`, which mutates cookies and is only legal from a Server Action or Route
   Handler; `/search` calls its action from a Server Component's render pass, which is exactly why
   `searchAllMedia` exists as a separate function ending in `redirectToClearSession` (see the comment
   above it in `src/actions/media.ts`). So add one render-safe sibling, `searchMediaForPage(query,
   type)`, directly beside `searchAllMedia`, reusing the existing `SEARCH_MEDIA_QUERY` constant and
   copying `searchAllMedia`'s auth-failure handling verbatim. This is a third function, not a third
   query, and the constraint that makes it unavoidable is Next's — not a preference (Article X).
   `searchMedia` stays exactly as it is for `/movies/add` and `/shows/add`, which are client-driven
   and legally cookie-mutating.
7. The four routes: `notFound()` at the top of the page component when the relevant flag is off.
8. `/preferences`: pass capabilities into `PreferencesForm`; build `tabItems` and the `TabKey` set
   from the enabled types. If the active tab would be hidden (it cannot be on first render, but can
   after a `router.refresh()`), fall back to `general`. In `handleSubmit`, skip
   `setPreferredTorrentGroupsAction("MOVIE"…)` / `("SHOW"…)` when their tab is hidden, and drop the
   corresponding entry from the `Promise.all` destructuring rather than leaving a hole in it.
9. Scheduler types and action: add `available` to `src/types/scheduler.ts` and to the
   `scheduledTasks` / `runScheduledTask` selection sets in `src/actions/scheduler.ts`. Both
   operations return `ScheduledTask`, so both selections need the field or the refreshed row will
   arrive without it.
10. `SchedulingPanel`: when `available` is false, disable the `Switch` and the run button and show a
    reason line. **The hidden `schedule_<id>_enabled` input must still be rendered at the task's
    stored value** — dropping it, or forcing it to `"false"`, means saving any unrelated setting
    silently disables the task for good, contradicting REQ-9's "the stored value is never rewritten".
    Add the `error.schedule.task_unavailable` branch to `handleRun` beside the existing
    already-running branch.
11. Add every new string to `messages/en.json` and `messages/es.json`, including
    `errors.media.type_disabled`, `errors.media.search_unavailable` and
    `errors.schedule.task_unavailable`. Spanish keeps the Rioplatense register of the surrounding
    copy; the strings in `../spec.md`'s error table are the canonical `es` values.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, read-only — there is no codegen, so every field
name below is retyped by hand and a typo fails at runtime:

- `query { mediaCapabilities { moviesEnabled showsEnabled } }` — both non-null booleans.
- `ScheduledTask.available: Boolean!` added to both scheduler selection sets.

Errors this slice must handle, not merely compile past:

| Key | Where it can arrive | What `web` does |
| :-- | :-- | :-- |
| `error.media.type_disabled` | `searchMedia` / `addMedia` / `popularMedia` after an administrator flipped a switch between render and submit | Surface the translated message in the surface that made the call (search error banner, carousel `initialError`, `MediaResultAction`'s add error) — never swallow it. |
| `error.media.search_unavailable` | `searchAllMedia` in the same race | Same, on `/search`. |
| `error.schedule.task_unavailable` | "Run now" on a row whose type was disabled in another tab | Own branch in `handleRun`, beside `error.schedule.task_already_running`. |

## Tests

`services/web` has no test suite (`services/web/CLAUDE.md`), so nothing here is owed a `*.spec.ts`.
The failure modes this slice can produce silently are covered instead by acceptance criteria that
inspect state rather than the screen:

- The scheduling hidden-input regression (step 10) is caught by AC-4 and by the § Verification step
  that re-enables a type and confirms the task returns exactly as it was — the visible switch alone
  would not show it.
- The preferences-tab regression (step 8) is caught by re-enabling a hidden tab and confirming the
  stored torrent groups are still selected.
- Step 6's ordering claim (`searchMedia`, not `searchAllMedia` filtered client-side) is caught by
  AC-3, which reads the network trace rather than the rendered list.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
```

0 errors and exit 0, plus the manual pass in `../plan.md` § Verification steps 1–9.

---
title: Library list paging, list view and possession filter — web slice
service: web
last_updated: 2026-11-10
status: Implemented
---

# PLAN: Library list paging, list view and possession filter — `web` (`web/plan.md`)

## Scope

`web` gives `/movies`, `/shorts` and `/shows` a toolbar (possession filter, view switch at the top
right, page-size select), a pager (first/previous/next/last, "page N of X") and a list view, reading
one page at a time from `api`'s `moviePage`/`showPage`. It owns URL state, its normalization and
correction (REQ-11), and the cookie that remembers view and page size (REQ-10). It does **not**
compute possession, clamp authoritatively, or derive a series' languages — `api` does all three and
`web` renders what it receives.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/lib/library-params.ts` | New | pure parse/normalize/serialize of `page`, `pageSize`, `filter`, `view` + cookie defaults |
| `src/actions/library.ts` | New | `getMoviePage`, `getShowPage`, `setLibraryDisplay` (cookie write) |
| `src/actions/movies.ts`, `src/actions/shows.ts` | Modified | delete `getMovies`/`getShows` (no caller left); keep the `Movie`/`Show` types, add `fileAudioLanguages`/`fileSubtitleLanguages` to `Show` |
| `src/app/(dashboard)/movies/page.tsx`, `shorts/page.tsx`, `shows/page.tsx` | Modified | accept `searchParams`, normalize, `redirect()` on correction, pass state down |
| `src/components/movies/Movies.tsx`, `Shorts.tsx`, `src/components/shows/Shows.tsx` | Modified | fetch a page, render toolbar + grid or table + pager |
| `src/components/media/LibraryToolbar.tsx` | New | client: filter select, page-size select, grid/list switch |
| `src/components/media/LibraryPager.tsx` | New | first/prev/next/last links + "page N of X" |
| `src/components/media/MediaTable.tsx` | New | the list view |
| `src/components/media/LanguageChips.tsx` | New | the chip row extracted from `FileTrackLanguages` |
| `src/components/media/FileTrackLanguages.tsx` | Modified | renders its chips through `LanguageChips` (no visual change) |
| `messages/en.json`, `messages/es.json` | Modified | `media.library.*` keys |

## Existing code to reuse

- `components/media/MediaList.tsx` / `MediaCard.tsx` — the grid view, unchanged. Pass the
  filter-empty message through `MediaList`'s existing `emptyMessage` prop only when the filter is not
  All (REQ-9); with All, keep today's behaviour (`/shorts` keeps its `emptyShorts`). This is the
  narrow, spec-mandated exception to `CLAUDE.md`'s "never pass a custom `emptyMessage`".
- `components/status/StatusBadge.tsx` — the Status column (REQ-6).
- `components/media/FileTrackLanguages.tsx` — its chip markup (`code.toUpperCase()`, compact chip
  classes) becomes `LanguageChips`, used by both it and `MediaTable`. One chip rendering, not two.
- `components/downloads/DownloadsPagination.tsx` — the layout and `Select`/`Button` primitives to
  match; do not import it (different copy, page sizes and navigation model — it is callback-driven
  client state, the library pager is URL-driven).
- `components/form/Select.tsx`, `components/ui/button/Button.tsx` — the controls.
- `actions/movies.ts` `getMovies` / `actions/shows.ts` `getShows` — the error handling to copy into
  the page actions verbatim: `redirectToClearSession(errors)` first, then `console.error` and return
  an empty page (`{ items: [], totalCount: 0, page: 1, pageSize, totalPages: 1 }`) — NFR-4. Never
  `redirectIfUnauthenticated` (it mutates cookies; these run in a Server Component render).
- `MediaCard`'s detail-link resolution from the `mediaType` prop — the table's title link uses the
  same `/movies/<id>` / `/shows/<id>` rule, from `mediaType`, never a payload field.
- `src/app/(dashboard)/search/page.tsx` — the `searchParams: Promise<…>` page-prop shape.

## Steps

1. `src/lib/library-params.ts` (pure, no React):
   - Types `LibraryView = 'grid' | 'list'`, `LibraryFilter = 'all' | 'downloaded' | 'added'`,
     `PAGE_SIZES = [12, 24, 48, 96]`, defaults `grid` / `24` / `all` / page `1`.
   - Cookie name `perceptor_library_display`, value `"<view>:<pageSize>"`; parse leniently (invalid →
     defaults). Shared by the three listings (REQ-10).
   - `normalize(raw searchParams, cookie)` → `{ state, invalid: boolean }`: a present-but-invalid
     param (non-numeric or < 1 page, size outside the set, unknown filter/view, or an array value)
     falls back (URL → cookie → default) and sets `invalid`.
   - `toPossession(filter)` → `'ALL' | 'DOWNLOADED' | 'ADDED'`.
   - `libraryHref(pathname, state, overrides)` → canonical query string: omit `page` when 1, omit
     `filter` when `all`, include `view`/`pageSize` only when they differ from the cookie defaults
     passed in. Idempotent: `normalize` of its output yields `invalid: false` (no redirect loop).
2. `src/actions/library.ts`: `'use server'`; `MOVIE_PAGE_QUERY` / `SHOW_PAGE_QUERY` selecting
   `items { id title overview posterUrl releaseDate status fileAudioLanguages fileSubtitleLanguages }`
   (+ `isShort` for films) and `totalCount page pageSize totalPages`. Never select a per-row field
   resolver (`audioLanguages`, `otherOwners`, …) — that is the N+1 the listing comments warn about.
   `setLibraryDisplay(view, pageSize)` validates against the same constants and writes the cookie
   (`path: '/'`, `sameSite: 'lax'`, one year, not `httpOnly`-sensitive data but set `httpOnly` anyway
   since only the server reads it).
3. Pages: `await searchParams`, read the cookie, `normalize`. Fetch through the component (below).
   After the fetch, if `invalid` or the response's `page` differs from the requested page (clamped,
   REQ-11), `redirect(libraryHref(...))` with the response's page. `/movies` keeps
   `isShort: capabilities.shortsEnabled ? false : undefined`; `/shorts` passes `true`.
   Keep the existing `notFound()` capability gates first.
4. `Movies.tsx` / `Shorts.tsx` / `Shows.tsx`: still `async` Server Components. Since the redirect
   needs the response, move the fetch to the page and pass the page object to the component, or let
   the component return the data to redirect on — pick whichever keeps the redirect in the page
   render; do not fetch twice.
5. `LibraryToolbar` (`"use client"`): filter select at the left, page-size select and the grid/list
   switch at the top right. On change: for view/page size, `await setLibraryDisplay(...)`, then
   `router.push(libraryHref(...))`; for filter, push only. Filter or page-size change resets page to 1
   (REQ-2, REQ-4); a view change keeps page, size and filter (REQ-5). It receives its state as props —
   no `useSearchParams` (avoids the Suspense requirement and a second source of truth).
   Hidden only when the library is empty with All selected (REQ-9 keeps the filter usable otherwise).
6. `LibraryPager`: server-renderable `<Link>`s built with `libraryHref`; disabled First/Previous on
   page 1 and Next/Last on the last page render as non-link buttons with `aria-disabled`. "Página N de
   X" from the response's `page`/`totalPages`. Hidden when `totalCount === 0` (REQ-2).
7. `MediaTable`: columns Year (`getUTCFullYear()` of `releaseDate`, `—` when null — note `MediaCard`
   uses `N/A`; the table follows the spec), Title (link + overview with `truncate` on one line,
   `min-w-0` so the ellipsis engages inside a table cell), Audio, Subtitles (`LanguageChips`, `—` for
   `null` or `[]`), Status (`StatusBadge`). Wrap in an `overflow-x-auto` container (NFR-3). Same row
   order as the response.
8. Extract `LanguageChips` from `FileTrackLanguages`; confirm the film detail page and the season
   table look identical before/after.
9. Catalog keys under `media.library`: filter labels (Todas/Descargadas/Agregadas — confirm against
   the existing `es` register), view labels, "Por página", First/Previous/Next/Last, "Página {page} de
   {totalPages}", column headers Año/Título/Audio/Subtítulos/Estado, `emptyFilter`. Both locales.
10. Check every interactive control against the 44×44 `max-md` hit-area rule and the closed text
    scale (`text-theme-sm` for the header row, never `text-xs`/`text-sm`).

## Contract obligations

Consumes exactly `../spec.md` § GraphQL Contract Delta: `moviePage(isShort, possession, page,
pageSize): MoviePage!`, `showPage(possession, page, pageSize): ShowPage!`, `Show.fileAudioLanguages`/
`fileSubtitleLanguages: [String!]` (nullable). Retype `MoviePage`/`ShowPage` by hand in
`actions/library.ts`. Error handling, per row of the spec's table:

- Auth error → `redirectToClearSession(errors)` (login).
- Service token → never happens from `web`.
- Invalid `possession` → cannot happen: `web` only sends `toPossession` output.
- Any other error → `console.error` + empty page → the listing's empty state, never Next's error
  screen (NFR-4, AC-11). Do **not** redirect for REQ-11 on an error response (its `page` is synthetic).
- `page`/`pageSize` in the response differing from the request → that is a clamp, not an error:
  redirect to the canonical URL (REQ-11).

## Tests

None, by `services/web/CLAUDE.md` § "Tests: there are none" — do not add a runner. The silent-failure
risks in this slice (redirect loop, cookie never written, a duplicated title across pages) are covered
by `../plan.md` § Verification's manual pass (AC-3, AC-8, AC-9), and the two pure pieces that would
most deserve a unit test (`library-params.ts`'s normalize/href round trip) should be kept pure and
free of Next imports so a future test runner can cover them without refactoring.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/cli web node scripts/check-messages.mjs
bin/comments web
```

All green, and the manual pass in `../plan.md` § Verification steps 1–2 and 5–9 shows the expected
results in the browser (steps 3–4 need the `api` slice live).

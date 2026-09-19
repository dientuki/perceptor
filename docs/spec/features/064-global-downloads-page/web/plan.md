---
title: Global Downloads Page and Sidebar Badge — web slice
service: web
last_updated: 2026-09-19
status: Approved
---

# PLAN: Global Downloads Page and Sidebar Badge — `web` (`web/plan.md`)

## Scope

`web` renders `/downloads` (the global panel with grouping and pagination), gates row controls on
`owned`, labels season rows from `download.showTitle`, and shows the active-title badge on the
sidebar's Downloads entry. It does **not** decide statuses, ownership, order or the count — all come
from `api`. It does **not** change the detail pages' panel behaviour beyond reading `showTitle`/`owned`
from the row (REQ-15).

Writes are confined to `services/web/` and this directory.

Precondition: `063-downloads-panel-filters` is implemented (filters in `DownloadsPanel.tsx`,
`seasonNumber` in `DownloadRow.tsx`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/types/downloads.ts` | Modified | `showId: number \| null`, `showTitle: string \| null`, `owned: boolean` |
| `services/web/src/actions/downloads.ts` | Modified | Three fields in `DOWNLOAD_FIELDS`; `getDownloads()`; `getActiveDownloadCount()` |
| `services/web/src/lib/download-groups.ts` | New | Pure, order-preserving `groupByTitle(downloads)` |
| `services/web/src/components/downloads/DownloadGroupHeader.tsx` | New | Full-width header row: title name + visible row count |
| `services/web/src/components/downloads/DownloadsPagination.tsx` | New | Previous / next, "showing X–Y of Z", page-size `Select` |
| `services/web/src/components/downloads/DownloadsPanel.tsx` | Modified | Opt-in grouped+paginated mode; empty-text variant |
| `services/web/src/components/downloads/DownloadRow.tsx` | Modified | Controls gated on `owned`; season label from `download.showTitle`; drop the `showTitle` prop |
| `services/web/src/app/(dashboard)/downloads/page.tsx` | Modified | Server page: metadata, breadcrumb, `getDownloads()`, panel in grouped mode |
| `services/web/src/app/(dashboard)/shows/[id]/page.tsx` | Modified | Stop passing `showTitle` to the panel |
| `services/web/src/app/(dashboard)/layout.tsx` | Modified | Fetch `getActiveDownloadCount()` beside `getMediaCapabilities()` |
| `services/web/src/layout/AdminShell.tsx` | Modified | Thread `activeDownloadCount` to the sidebar |
| `services/web/src/layout/AppSidebar.tsx` | Modified | Badge on the Downloads entry, expanded and collapsed, hidden at 0 |
| `services/web/messages/en.json`, `es.json` | Modified | New keys (below) |

## Existing code to reuse

- `src/actions/downloads.ts` `getMovieDownloads` — the pattern for `getDownloads` and
  `getActiveDownloadCount`: `redirectToClearSession(errors)` for auth, log and return `[]` / `0`
  otherwise. Never throw from the layout's count (NFR-8).
- `DownloadsPanel.tsx`'s `063` filter state, `bucketOf()`, `counts` — counts stay computed over the
  full `downloads` prop (rows, not titles, not the page).
- `src/lib/status-tone.ts` — unchanged; still the bucket rule.
- `src/components/form/Select.tsx` — the page-size selector. `src/components/ui/button/Button.tsx` —
  previous/next. `src/components/ui/badge/Badge.tsx` — the group header's count and the sidebar badge.
- `seasonAccordion.seasonLabel` catalog key — season rows, as `063` already does.
- `src/app/(dashboard)/calendar/page.tsx` — the page shape (`generateMetadata` from
  `pages.<name>`, `PageBreadcrumb`, card wrapper).
- `capabilities`' path `layout.tsx` → `AdminShell` → `AppSidebar` — the path the count takes.

## Steps

1. **Types + actions.** Add the three fields to `Download` and to `DOWNLOAD_FIELDS` (so every query
   and mutation selects them). Add `DOWNLOADS_QUERY`/`getDownloads()` and
   `ACTIVE_DOWNLOAD_COUNT_QUERY`/`getActiveDownloadCount()` following `getMovieDownloads`.
2. **`DownloadRow`.** Render start/stop only when `owned && infoHash != null`, delete only when
   `owned`. Season label: `download.seasonNumber != null && download.showTitle` →
   `${showTitle} ${seasonLabel}`; otherwise `label`. Remove the `showTitle` prop; remove it from
   `DownloadsPanel`'s props and from `shows/[id]/page.tsx`.
3. **`lib/download-groups.ts`.** `groupByTitle(downloads)` → `{ key, title, downloads }[]`, key
   `movie:<movieId>` / `show:<showId>` (fall back to `source:<mediaSourceId>` if both are null, so a
   malformed row is never merged with another), title from `showTitle` for a show and `label` for a
   film. A single pass, groups in order of first appearance, rows in received order. No sorting.
4. **`DownloadGroupHeader.tsx`.** A `<tr>` with one `<td colSpan>` across the five columns: title
   name and a `Badge` with the visible row count. Visually distinct from a data row (background).
5. **`DownloadsPagination.tsx`.** Props: `page`, `pageCount`, `from`, `to`, `total`, `pageSize`,
   `onPage`, `onPageSize`. Previous disabled on page 1, next on the last page; the "showing" line via
   a catalog key with `{from}`, `{to}`, `{total}` params; the `Select` with 10/25/50.
6. **`DownloadsPanel.tsx`.** Add one opt-in prop (e.g. `grouped`) that only `/downloads` passes. In
   that mode: filter rows (`063`), `groupByTitle` the visible rows, slice groups by page, render each
   group as header (only when it has ≥2 visible rows — REQ-10) + its rows, render
   `DownloadsPagination` below the table when at least one group is listed. State: `page` (1-based),
   `pageSize` (default 10). Changing the filter or page size sets `page` to 1. Clamp at render
   (`effectivePage = min(page, pageCount)`), never in an effect, so a shrinking list lands on the last
   page (REQ-14). **Do not key or remount the panel on its data** — that would reset filter, page and
   page size on every `router.refresh()`. Also accept the empty-state text so `/downloads` can say
   "No downloads yet." instead of the per-title copy.
7. **`/downloads` page.** Server component: `generateMetadata` from `pages.downloads`,
   `PageBreadcrumb`, `getDownloads()`, `<DownloadsPanel downloads={...} grouped emptyText={...} />`.
   No capability check (REQ-16).
8. **Badge.** `layout.tsx` fetches `getActiveDownloadCount()` in parallel with the existing calls;
   `AdminShell` passes it to `AppSidebar`; the Downloads `NavItem` renders a `Badge` with the number
   when `> 0` — beside the text when expanded, as a small overlay on the icon when collapsed (the text
   is hidden then). Give it an accessible label (e.g. "3 downloads in progress").
9. **Catalog.** Add to both `en.json` and `es.json` (Rioplatense register for `es`):
   `pages.downloads.{title, metadataTitle, metadataDescription}`,
   `downloads.panel.{emptyAll, showing, previous, next, perPage, groupRows}` (names indicative —
   keep them in the `downloads.panel` namespace), `nav.downloadsBadge` (the aria label, with a
   `{count}` param). Run the drift check.

## Contract obligations

Consumes exactly `../spec.md` § GraphQL Contract Delta: `Download.showId: Int`, `showTitle: String`,
`owned: Boolean!`; `downloads: [Download!]!` (unpaginated, already ordered — never re-sort);
`activeDownloadCount: Int!` (titles, excludes `PAUSED` — never recompute it from the list). Error
handling: auth errors redirect (existing helpers); any other error on `downloads` → empty list +
`console.error`; on `activeDownloadCount` → `0` (no badge), never a thrown error in the layout;
qBittorrent down is not an error at all (rows with empty live fields). A row action on a foreign row
cannot happen from the UI (no buttons); if one did, the existing row-error path renders
`error.source.not_found` as today.

## Tests

`web` has no test suite (`services/web/CLAUDE.md`). The one silent-failure unit is
`lib/download-groups.ts` (a wrong key merges two titles or splits one; a sort reorders the activity
order) — kept a pure function so a suite could cover it, and exercised in the manual pass (AC-1,
AC-3, AC-4). Everything else is rendering, verified by the build and the manual pass in `../plan.md`.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

0 typecheck errors, lint clean, build exits 0, no catalog drift.

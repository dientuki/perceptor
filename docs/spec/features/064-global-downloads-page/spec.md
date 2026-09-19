---
title: Global Downloads Page and Sidebar Badge
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-09-19
last_updated: 2026-09-19
status: Approved
services: [api, web]
---

# SPEC: Global Downloads Page and Sidebar Badge (`spec.md`)

## Context & Goal

The downloads panel (`services/web/src/components/downloads/DownloadsPanel.tsx` +
`DownloadRow.tsx`) is today only reachable from a title's own detail page: `/movies/[id]` (films and
shorts) reads `api`'s `movieDownloads(movieId)`, `/shows/[id]` reads `showDownloads(showId)`, both in
`services/api/src/downloads/downloads.service.ts`. To know what the installation is doing right now
a user has to open every title one by one. The sidebar already has a **Downloads** entry
(`services/web/src/layout/AppSidebar.tsx` → `/downloads`), but
`services/web/src/app/(dashboard)/downloads/page.tsx` returns `null` — `063-downloads-panel-filters`
explicitly left the cross-title queue out of scope because it needs its own query and its own
visibility rule.

This feature fills that page with the same panel, fed by every source of every title at once, with
the same columns, filter toggles, progress bars and row actions `063` gives the per-title panel. Two
things are added that only make sense across titles: rows are **grouped by title** (a film, a short,
or a whole series — every episode and season-pack source of a show lands in the show's group), with a
group header whenever a title has more than one row, so three films racing two torrents each read as
three titles rather than six unrelated lines; and the page is **paginated by title**, with previous/
next, "showing X–Y of Z" and a page-size selector. The queue is **installation-wide and visible to
every signed-in user** — a deliberate exception to the rule that every listing is scoped to the caller
(root `CLAUDE.md`, "One gap worth knowing"). Visibility widens; control does not: a row belonging to
a title outside the caller's library is read-only, and `downloadStart`/`downloadStop`/`downloadDelete`
keep refusing it exactly as today.

The sidebar's Downloads entry also gains a badge with the number of **titles** currently being
processed — the same unit the page paginates by: three films racing two torrents each read `3`, and a
show with two episodes and a season pack in flight reads `1`. Paused sources do not count. No pipeline
stage in the root `CLAUDE.md` changes status; this is the reporting layer (the "Browse library" /
"Download" rows gain a global reader). Depends on `063-downloads-panel-filters` having landed — it
reuses its filters, its last-activity order and its `seasonNumber` field.

## Requirements

### Functional Requirements

#### `api` — the global read

- [ ] **REQ-1 (Global list)**: `api` must expose one query returning a `Download` row for **every**
      `MediaSource` in the installation — film, short, single-episode and season-pack sources of every
      title, owned by any user or by several — in the same shape `movieDownloads`/`showDownloads`
      already return. Unpaginated: grouping and pagination are `web`'s (REQ-9..REQ-13).
- [ ] **REQ-2 (Visible to every user)**: The global list must be readable by any authenticated,
      enabled user, administrator or not. It is not scoped to the caller's library.
- [ ] **REQ-3 (Same order)**: The global list must be ordered by the last-activity rule of `063`
      REQ-6 (most recent first, ties by newest source), applied across all titles together.
- [ ] **REQ-4 (Same derived fields)**: Every row's `status`, progress, speeds and `compressionEnabled`
      must be derived exactly as the per-title queries derive them today (`043` vocabulary, live
      qBittorrent state joined by `infoHash`), so a given source reads identically on
      `/downloads` and on its title's detail page at the same moment.
- [ ] **REQ-5 (Ownership flag)**: Every `Download` row must say whether the caller's library contains
      the title it belongs to (the film, or the show of the episode/season). On `movieDownloads`,
      `showDownloads`, `downloadStart` and `downloadStop` it is always `true`, since those already
      refuse a title the caller does not own.
- [ ] **REQ-6 (Show on the row)**: Every row belonging to a series (episode or season pack) must
      carry the show's id and title — the id is the grouping key (REQ-9), the title labels the group
      and lets `web` render a season pack as `<Show> <seasonAccordion.seasonLabel>` (`063` REQ-8)
      without a per-page `showTitle` prop. Both `null` for film/short rows.

#### `web` — the page

- [ ] **REQ-7 (Page)**: `/downloads` must render a breadcrumb/page title (catalog-driven, `en`/`es`)
      and the downloads panel with the global list: same columns, same filter toggles and counts
      (`063` REQ-1..5 — counts are of **rows** over the whole global list, not of titles, not of the
      current page), same Refresh button, same delete confirmation modal. With no sources at all it
      shows the panel's existing empty state.
- [ ] **REQ-8 (Read-only foreign rows)**: On `/downloads`, a row whose `owned` is `false` must render
      with no start, stop or delete button. A row the caller owns keeps exactly the controls it has on
      the detail page (start/stop only when `infoHash` is non-null, delete always). The three
      mutations keep their current ownership check and their current `error.source.not_found`
      answer — this feature adds no way to act on another user's source.
- [ ] **REQ-9 (Grouping)**: Rows are grouped by title: a film or short by `movieId`, a series by
      `showId` (every episode and season-pack row of one show in one group). Groups appear in the
      order of their first row in the list `api` returned (i.e. the title with the most recent
      activity first); rows inside a group keep their relative order from `api`. `web` partitions the
      list, it never re-sorts it.
- [ ] **REQ-10 (Group header only when grouping)**: A group with **two or more visible rows** is
      preceded by a header row spanning the table, showing the title's name (the film's `label`, or
      the row's `showTitle`) and the number of visible rows in it. A group with exactly one visible
      row renders as a plain row with no header, as the detail-page panel does today. "Visible" means
      after the active filter (REQ-11).
- [ ] **REQ-11 (Filter then group then paginate)**: The active `063` filter applies to rows first; a
      title with no row in the active bucket disappears from the page; the remaining titles are
      grouped (REQ-9) and then paginated (REQ-12). Changing the filter returns to page 1.
- [ ] **REQ-12 (Pagination by title)**: The page shows at most *N* titles (groups) at a time — a
      title is never split across pages, however many rows it has. Below the table: a **previous** and
      a **next** control (disabled on the first/last page) and a "showing X–Y of Z" line, where X–Y is
      the range of titles on this page and Z the number of titles after the filter
      (`Showing 1–10 of 23` / `Mostrando 1–10 de 23`). The controls are shown whenever at least one
      title is listed, even if everything fits on one page.
- [ ] **REQ-13 (Page size)**: A selector next to the pagination offers **10, 25 and 50** titles per
      page, default **10**. Changing it returns to page 1. Neither the page size nor the current page
      persists across navigation away from `/downloads`.
- [ ] **REQ-14 (Refresh keeps the view)**: The Refresh button and the implicit refresh after a row
      action keep the active filter (`063` REQ-5), the page size and the current page. If the list
      shrank so the current page no longer exists (e.g. a delete emptied the last page), the view
      moves to the new last page, never to an empty one.
- [ ] **REQ-15 (Detail pages unchanged)**: `/movies/[id]` and `/shows/[id]` keep rendering the panel
      without group headers and without pagination — one title, one flat list, exactly as `063`
      leaves it.
- [ ] **REQ-16 (Page availability)**: `/downloads` must be reachable regardless of the
      `movies_enabled`/`shows_enabled`/`shorts_enabled` Settings, and must list sources of a
      disabled type too — `045` never hides work already in flight.

#### The sidebar badge

- [ ] **REQ-17 (Active title count)**: `api` must expose the number of distinct **titles** — a
      film/short by `movieId`, a series by its show — that have at least one source whose derived
      status is `QUEUED`, `DOWNLOADING`, `DOWNLOADED` or `ENCODING`. Several sources of the same film,
      or several episode/season-pack sources of the same show, count once. `PAUSED`, `COMPLETED`,
      `ERROR` and any other status do not count. Installation-wide, like REQ-1 — every user sees the
      same number.
- [ ] **REQ-18 (Count matches the list)**: The count must be derived from the same per-source status
      REQ-4 produces — a title counted as active must have a row showing one of those four statuses
      on `/downloads` read at the same moment. It is intentionally **not** the page's "working"
      filter badge, which counts rows and includes `PAUSED` (`063` REQ-2/3).
- [ ] **REQ-19 (Sidebar badge)**: The sidebar's Downloads entry must show the count as a badge when
      it is greater than zero, both with the sidebar expanded and collapsed; at zero no badge is
      shown. Every user sees it, since the entry is visible to every user.
- [ ] **REQ-20 (Badge freshness)**: The badge is read on page load and re-read whenever the app
      refreshes server data — the panel's Refresh button and the implicit refresh after a row
      action (start/stop/delete) on either `/downloads` or a detail page. No polling, no push; it may
      be stale between those moments, like the panel itself (`022` REQ-9/10).

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No migration)**: No Prisma schema change. Every column the global list, the ownership
      flag and the count need already exists.
- [ ] **NFR-2 (Bounded external calls)**: One global list read, and one count read, each make at most
      **one** qBittorrent `info` call — an untagged read of all torrents, joined by lowercased
      `infoHash` through the same single join point the per-title queries use (`053`) — and no
      TMDB or Prowlarr call. Never one call per row or per title. Paging, grouping and filtering in
      `web` make no request at all — they work over the list already fetched.
- [ ] **NFR-3 (Bounded DB reads)**: The global list loads encode jobs for all sources in one query,
      not one per source (the existing `jobsBySourceId` rule, `022` REQ-3), and resolves labels and
      ownership without a query per row.
- [ ] **NFR-4 (Torrent client down)**: If qBittorrent is unreachable, the global list still returns
      every row with its live fields null (same posture as the per-title queries), the count still
      returns a number, and neither the page nor the sidebar errors.
- [ ] **NFR-5 (Mutations unchanged)**: `downloadStart`, `downloadStop` and `downloadDelete` keep
      their signatures, ownership clause and error behaviour. Widening who can *see* a row must not
      widen who can *act* on it.
- [ ] **NFR-6 (Tested where silent)**: `api` unit tests for the two rules that fail silently
      (Article IX): the count de-duplicates by title and excludes `PAUSED` (three films with two
      active sources each → `3`; one show with an active season pack and two active episodes → `1`;
      a film whose only source is paused → not counted), and the ownership flag is `false` for a
      source whose title the caller has not added and `true` for one they have.
- [ ] **NFR-7 (No catalog drift)**: Every new key lands in both `messages/en.json` and
      `messages/es.json`; `bin/cli web node scripts/check-messages.mjs` reports no drift.
- [ ] **NFR-8 (Badge never breaks the shell)**: A failed count read (any error other than an
      authentication failure) must render the sidebar without a badge, never an error page — the
      badge lives in the dashboard layout, which every page shares.

## GraphQL Contract Delta

```graphql
type Download {
  # ...every existing field unchanged, including 063's seasonNumber and last-activity order...
  showId: Int           # NEW. Non-null exactly when the row is an episode or season-pack source;
                        # null for film/short rows. The series grouping key on /downloads.
  showTitle: String     # NEW. The show's title, same nullability as showId.
  owned: Boolean!       # NEW. Whether the caller's library contains this row's title (film, or the
                        # show of the episode/season). Always true on movieDownloads, showDownloads,
                        # downloadStart and downloadStop.
}

type Query {
  downloads: [Download!]!       # NEW. Every MediaSource in the installation, any owner, ordered by
                                # last activity desc (063 REQ-6). Unpaginated. Any authenticated user.
  activeDownloadCount: Int!     # NEW. Distinct titles (movieId, or the show of seasonId/episodeId)
                                # with at least one source whose derived status is QUEUED,
                                # DOWNLOADING, DOWNLOADED or ENCODING. Any authenticated user.
}
```

Both new queries are user-facing only — no `@AllowService()`; the worker and the AutoRun hook never
call them. `owned` is the single field that decides whether `web` renders controls on `/downloads`;
branching on `kind`, on a missing `movieId`, or on whether a row appears in some other query instead
is the class of silent bug `022`'s `infoHash`-not-`kind` rule already warns about. The grouping key
is `movieId` for a film/short row and `showId` for a series row — never `label` or `showTitle`, which
two different titles can share. Rules the schema cannot express: `downloads` is **not** caller-scoped
(every other listing query is) and is **not** paginated (web pages over it); `activeDownloadCount` is
**not** the length of `downloads` filtered to any status — it counts titles, and excludes `PAUSED`.
`docs/spec/graphql-contract.md`'s `Download` block must be updated with this delta and a section
recording the visibility exception.

Errors:

| Condition | GraphQL error | Key / params | Message the user sees |
| :-- | :-- | :-- | :-- |
| `downloads` / `activeDownloadCount` with no or invalid credential | unchanged global auth error | unchanged | unchanged — `web` redirects to login as on every page |
| `downloads` / `activeDownloadCount` while qBittorrent is unreachable | **none** — not an error | — | rows render with empty live fields; the count is computed without live state (NFR-4) |
| `downloadStart` / `downloadStop` / `downloadDelete` on a source whose title the caller does not own (e.g. crafted from a foreign `/downloads` row's id) | `NotFoundException` — unchanged | `error.source.not_found` `{ id }` — unchanged | unchanged |

`web` handling: `getDownloads` (the page) follows the existing `getMovieDownloads` pattern — an auth
error redirects, any other error logs and renders the empty list. `getActiveDownloadCount` (the
layout) does the same and renders no badge (NFR-8). Row-action errors are handled as today, in the
row.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: Given user A owns films F1, F2, F3, each with two sources currently `DOWNLOADING` or
      `ENCODING`, when A opens `/downloads`, then three groups are listed, each with a header naming
      the film and `2`, and its two rows beneath; the most recently active film's group is first; the
      sidebar's Downloads entry shows a badge `3`; the pagination line reads `Showing 1–3 of 3`.
- [ ] **AC-2**: From AC-1, pausing one of F1's two sources leaves the badge at `3` after the row
      action's refresh; pausing F1's second source too drops it to `2`. The page's **working** filter
      badge still reads `6` (it counts rows and includes `PAUSED`).
- [ ] **AC-3**: Given a show with an in-flight `S02` season pack and in-flight single-episode sources
      for `S01E01` and `S01E02`, those three rows form one group headed by the show's title with `3`,
      and the sidebar badge counts that show once. The season row reads `<Show> Season 2` in English,
      `<Show> Temporada 2` in Spanish.
- [ ] **AC-4**: Given a film with exactly one source, its row renders on `/downloads` with no group
      header. Given a film with two sources, one `ERROR` and one `COMPLETED`, with **error** active
      only its `ERROR` row is visible and it renders with no header.
- [ ] **AC-5**: Given 23 titles with sources, `/downloads` shows 10 titles and `Showing 1–10 of 23`,
      **previous** disabled; **next** twice reaches `Showing 21–23 of 23` with **next** disabled.
      Choosing 25 per page shows all 23 on page 1. A title with more rows than the page size is never
      split across two pages.
- [ ] **AC-6**: On page 3 of AC-5, activating **error** returns to page 1 and the line counts only
      titles with an `ERROR` row; clicking Refresh keeps the filter, page size and page. Deleting the
      only row of the only title on the last page moves the view to the new last page.
- [ ] **AC-7**: Given user B, who has none of A's titles in their library, when B opens `/downloads`,
      then B sees the same groups and the same badge as A, and none of those rows shows a start, stop
      or delete button. When B adds F1 to their library and reloads, F1's rows show their controls;
      F2's and F3's still do not.
- [ ] **AC-8 (failure path)**: As user B from AC-7, calling `downloadDelete(mediaSourceId: <one of
      F2's sources>)` directly through GraphiQL fails with `error.source.not_found` and the source,
      its torrent and its files are untouched — `/downloads` still lists it for A with its controls.
- [ ] **AC-9 (failure path)**: With the `torrent` container stopped, `/downloads` still renders every
      group and row (speed/progress from qBittorrent empty), the sidebar renders on every page without
      error, and no 500 appears in `web` or `api` logs beyond the existing "could not read torrent
      client" line.
- [ ] **AC-10**: With nothing in flight (every source `COMPLETED`, `ERROR` or `PAUSED`), the sidebar
      shows no badge on any page. With no sources at all, `/downloads` shows the panel's empty state.
- [ ] **AC-11**: With `shows_enabled` turned off in Settings while a season pack is in flight,
      `/downloads` still lists that row and the badge still counts its show.
- [ ] **AC-12**: `/movies/<id>` and `/shows/<id>` render their panel with no group header and no
      pagination controls, whatever the number of rows.
- [ ] **AC-13**: `bin/npm api run test` passes, including NFR-6's tests; `git status --short
      services/api/prisma` is empty; the `schema.gql` diff is exactly this delta;
      `bin/cli web node scripts/check-messages.mjs` reports no drift; `bin/npm web run build` exits 0.

## Out of Scope

- **Acting on another user's download.** Visibility is installation-wide; control stays with the
      title's owners (REQ-8, NFR-5). Admin override of that rule would be its own spec.
- **Server-side pagination.** `downloads` returns everything and `web` pages over it, so the `063`
      filter counts, grouping and pagination can never disagree. At the installation's scale (a
      handful of users) the full list is small; if it stops being, paginating in `api` means moving
      the filter there too — a later spec.
- **Collapsible groups, per-group status summaries or per-group actions** (e.g. "delete all sources
      of this title"). The header is a label and a count.
- **Links from a row or a group header to the title's detail page.** A title the caller does not own
      answers `Recurso no disponible para este usuario` there, so a link would dead-end for foreign
      rows; the detail routes' scoping is unchanged.
- **Persisting page, page size or filter** across navigation, per user or in the URL (REQ-13).
- **Retention or pruning of old sources.** Completed sources stay listed; the `063` filters narrow
      them.
- **Polling, auto-refresh or push updates** for either the page or the badge (REQ-20).
- **Counting the episodes a season pack lifts to `QUEUED` at read time** (`059`) — the badge counts
      titles from their own sources only.
- **The `movieId` naming debt** (root `CLAUDE.md` § Known debt) — untouched; the new fields are added
      beside the existing ids.

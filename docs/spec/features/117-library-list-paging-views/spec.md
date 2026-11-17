---
title: Library list paging, list view and possession filter
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-11-10
last_updated: 2026-11-10
status: Implemented
services: [api, web]
---

# SPEC: Library list paging, list view and possession filter (`spec.md`)

## Context & Goal

The three library listings — `/movies`, `/shorts` and `/shows` (`web`'s `app/(dashboard)/movies/page.tsx`,
`shorts/page.tsx`, `shows/page.tsx`, rendering `components/movies/Movies.tsx`, `Shorts.tsx` and
`components/shows/Shows.tsx` through the shared `components/media/MediaList.tsx` poster grid) — render
the caller's whole library in one unpaginated grid. `api`'s `movies(isShort)` and `shows` queries
(`MoviesService.findAll`, `ShowsService.findAll`, newest registration first) return every row at once,
and the film listing loads every source and job of every film on the way. A library of a few hundred
titles is one long scroll with no way to jump, narrow, or see at a glance what each title holds.

This feature gives the three listings the same toolbar: a pager (first, previous, next, last,
"page N of X" and a page-size selector that changes X), a possession filter (all / downloaded / added)
and, at the top right, a view switch between the current poster grid and a new list view — a table with
one row per title showing its year, title with a one-line truncated overview, the audio and subtitle
languages of what is on disk, and its status. Paging and filtering happen in `api`, so a page costs one
page of rows, not the library. The toolbar works the same in both views.

For a series the audio and subtitle columns answer "what is guaranteed across the whole series": a
language appears only when every episode in scope carries it, so a series where 25 of 28 episodes have
Castilian subtitles does not list Castilian — the gap is the point. This touches the **Browse library**
stage of the root `CLAUDE.md` pipeline table only; no acquisition, encode or media-server behaviour
changes, and the existing `movies`/`shows` queries keep their exact shape for their other callers.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Scope)**: `/movies`, `/shorts` and `/shows` each carry the toolbar of REQ-2 to REQ-5 above
      their results. `/movies` keeps excluding shorts exactly when it does today (only while shorts are
      enabled, `048`); `/shorts` lists only shorts. Every listing stays scoped to the caller's library.
- [ ] **REQ-2 (Pager)**: Must offer first, previous, next and last controls, a "page N of X" indicator
      and a page-size selector. Changing the page size recomputes X and returns to page 1. First and
      previous are disabled on page 1; next and last are disabled on the last page. With zero matching
      titles the pager is hidden and the existing empty state shows instead (REQ-9).
- [ ] **REQ-3 (Page sizes)**: The page-size selector offers 12, 24, 48 and 96, default 24 — multiples
      of the grid's column counts so a full grid page never ends in a ragged row at desktop width.
- [ ] **REQ-4 (Possession filter)**: Must offer three mutually exclusive options: **All** (every title),
      **Downloaded** (titles whose `status` is `COMPLETED`) and **Added** (every title whose `status` is
      anything else — missing, queued, in flight, paused or in error). Downloaded and Added partition All.
      For a series, `COMPLETED` keeps its existing meaning (`089`: every aired episode outside season 0
      is `COMPLETED`). Changing the filter returns to page 1. Default: All.
- [ ] **REQ-5 (View switch)**: A control at the top right of the toolbar switches between **Grid** (the
      current poster grid, unchanged) and **List** (REQ-6). Switching view keeps the current page, page
      size and filter. Default: Grid.
- [ ] **REQ-6 (List view)**: One row per title, in the same order and with the same rows as the grid
      would show for that page, with the columns **Year**, **Title**, **Audio**, **Subtitles**, **Status**:
  - **Year**: the year of `releaseDate`; `—` when null.
  - **Title**: the title on the first line, linking to the title's detail page exactly as a grid card
    does; below it the overview, always on a single line, truncated with an ellipsis when longer. No
    overview → only the title.
  - **Audio / Subtitles**: the languages of the file on disk as 3-letter upper-case chips, the same
    rendering `108` uses under a film's poster. For a film or short: `fileAudioLanguages` /
    `fileSubtitleLanguages`. For a series: the languages of REQ-7. `—` when the value is null or empty.
  - **Status**: the title's `status`, rendered with the same status badge and label the detail pages
    already use.
- [ ] **REQ-7 (Series languages are an intersection)**: A series' audio (subtitle) languages are the
      languages present in **every** episode in scope — 28 of 28 episodes with English audio lists
      English; 25 of 28 with Castilian subtitles does not list Castilian. The episodes in scope are
      only the downloaded ones: episodes whose file has been read (`fileAudioLanguages` non-null),
      season 0 excluded as `089` excludes it from `Show.status`. An episode with no file never empties
      the intersection. A series with no episode in scope reads null (`—`).
- [ ] **REQ-13 (Series languages are stored, kept fresh on write)**: A series' REQ-7 languages are
      stored on the series and recomputed whenever any of its episodes' file languages are written —
      when a file's tracks are read (`108`'s probe, which a delivery, an embed or a subtitle search's
      embed already triggers) and when they are cleared (a media-server sync that finds the file gone,
      `108` REQ-4). Reading a page never derives them.
- [ ] **REQ-8 (Order)**: Order is unchanged — most recently registered first — with a deterministic
      tie-break, so the same title never appears on two pages or on none while the library is unchanged.
- [ ] **REQ-9 (Empty states)**: With All selected and an empty library, the existing empty message of
      each listing shows unchanged (`/shorts` keeps its own). With Downloaded or Added selected and no
      matching title, a message says no title matches the filter, and the filter stays visible so the
      user can change it.
- [ ] **REQ-10 (Address and memory)**: Page, page size, filter and view are reflected in the page URL,
      so reload, back/forward and a copied link reproduce the same page. View and page size are also
      remembered in a browser cookie, shared by the three listings, and used as the defaults when the URL
      does not name them. The filter and page are never remembered outside the URL.
- [ ] **REQ-11 (Out-of-range input)**: A URL naming a page past the last one shows the last page; a page
      below 1, a non-numeric page, a page size outside REQ-3's set, an unknown filter or an unknown view
      each fall back to its default — never an error screen. The URL is corrected to what is shown.
- [ ] **REQ-12 (Copy)**: All new user-facing text (control labels, "page N of X", column headers, the
      filter-empty message) is catalog-driven in `services/web/messages/{en,es}.json` (`018`), `es` in the
      existing Rioplatense register.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (One page, bounded cost)**: Answering a page reads only that page's titles plus one count,
      in a bounded number of database queries independent of the page size — no per-row query, no
      loading of every film's sources and jobs, and no read of a series' episodes (REQ-13).
- [ ] **NFR-5 (Backfill)**: Series registered before this feature get their REQ-13 languages computed
      once, without a user action, before or while `api` boots after the migration; until then they read
      null (`—`), never a wrong intersection. The pass reads only the database — no worker job, no
      media-server or TMDB call.
- [ ] **NFR-6 (Recompute failure is not the write's failure)**: If recomputing a series' languages fails,
      the episode's own write still stands and the series keeps its previous value until the next
      episode write or backfill; the failure is logged.
- [ ] **NFR-2 (Additive contract)**: The existing `movies(isShort)` and `shows` queries keep their exact
      arguments, return type and behaviour (contract § "Additive changes are safe, and are the default").
- [ ] **NFR-3 (Phone width)**: At phone width the toolbar wraps without horizontal page scroll; the list
      view's table may scroll horizontally inside its own container, never the page.
- [ ] **NFR-4 (Failure stays the empty state)**: If the page query fails, the listing behaves as it does
      today on a failed `movies`/`shows` call — an unauthenticated caller is sent to clear the session,
      any other error is logged server-side and the empty state renders — never Next's error screen.

## GraphQL Contract Delta

Two new queries beside the existing listings, each returning one page plus the counts the pager
needs. `page`/`pageSize` are clamped by `api`, never rejected — `web` normalizes the URL first
(REQ-11), and a stale or hand-built call still answers a page.

```graphql
enum LibraryPossession {
  """Every title in the caller's library."""
  ALL
  """status COMPLETED (117 REQ-4)."""
  DOWNLOADED
  """Any status other than COMPLETED (117 REQ-4)."""
  ADDED
}

type MoviePage {
  items: [Movie!]!
  """Titles matching the filter, across every page."""
  totalCount: Int!
  """The page actually returned, after clamping to [1, totalPages] (117 REQ-11)."""
  page: Int!
  pageSize: Int!
  """ceil(totalCount / pageSize), and 1 when totalCount is 0."""
  totalPages: Int!
}

type ShowPage {
  items: [Show!]!
  totalCount: Int!
  page: Int!
  pageSize: Int!
  totalPages: Int!
}

extend type Show {
  """
  ISO 639-2 audio languages present in every episode in scope (117 REQ-7); null when no episode is in scope.
  """
  fileAudioLanguages: [String!]
  """
  ISO 639-2 subtitle languages present in every episode in scope (117 REQ-7); null when no episode is in scope.
  """
  fileSubtitleLanguages: [String!]
}

type Query {
  """
  One page of the caller's films, newest registration first (117 REQ-8). isShort behaves exactly as on movies(isShort).
  """
  moviePage(isShort: Boolean, possession: LibraryPossession! = ALL, page: Int! = 1, pageSize: Int! = 24): MoviePage!

  """One page of the caller's series, newest registration first (117 REQ-8)."""
  showPage(possession: LibraryPossession! = ALL, page: Int! = 1, pageSize: Int! = 24): ShowPage!
}
```

Clamping rules (`api`): `pageSize` outside `{12, 24, 48, 96}` becomes 24; `page` below 1 becomes 1; a
`page` above `totalPages` becomes `totalPages`. `Show.fileAudioLanguages`/`fileSubtitleLanguages` are
only selected by a page listing; `getShowById` may ignore them. On `Show` they are stored columns
recomputed on every episode file-language write (REQ-13), so reading them costs nothing extra.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `moviePage`/`showPage` without a valid session | the existing auth guard error | none — `web` clears the session and redirects to login, as `getMovies`/`getShows` do today |
| `moviePage`/`showPage` with a service token | no error — an empty page (`items: []`, `totalCount: 0`, `page: 1`, `totalPages: 1`), the same posture `movies`/`shows` have | not user-facing |
| `possession` not one of the enum values | GraphQL validation error (schema-level) | not user-facing — `web` only sends normalized values (REQ-11) |
| Any other failure (database unreachable) | `INTERNAL_SERVER_ERROR` | none — `web` logs it and renders the listing's empty state (NFR-4) |

There is no out-of-range error by design: a page or page size out of range is clamped and the response
names what was actually returned (`page`, `pageSize`), which `web` uses to correct the URL.

**Consumers.** `web` only. The `worker` never calls either query. `web` drops `getMovies`/`getShows`
(no caller is left); the `movies`/`shows` queries stay in the schema.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `Show` | add `fileAudioLanguages Json?` | nullable, no default (null = no episode in scope) | yes — NFR-5 |
| `Show` | add `fileSubtitleLanguages Json?` | nullable, no default | yes — NFR-5 |

Same shape as `Movie`/`Episode`'s `108` columns (ISO 639-2 codes). `Movie.status`/`Show.status` are
already columns (`089`), so the possession filter is a plain column condition.

## Acceptance Criteria

- [~] **AC-1**: Given a library of 30 films (no shorts), when the user opens `/movies`, then the grid shows
      24 posters, the pager reads page 1 of 2, and First/Previous are disabled.
- [~] **AC-2**: Given AC-1, when the user selects page size 12, then the pager reads page 1 of 3, the grid
      shows 12 posters, and the URL names the new size.
- [~] **AC-3**: Given AC-1, when the user clicks Last, then the grid shows the 6 oldest-registered films,
      Next/Last are disabled, and no film shown on page 1 appears again.
- [~] **AC-4**: Given a library where 10 of 30 films are `COMPLETED`, when the user selects Downloaded,
      then exactly those 10 appear and the pager reads page 1 of 1; selecting Added shows the other 20.
- [~] **AC-5**: Given the user is on page 2 of `/movies` with filter Added, when they switch to List, then
      the table shows the same titles in the same order, with Year, Title (one-line truncated overview,
      title links to the film's page), Audio, Subtitles and Status columns, and the filter and page are
      unchanged.
- [~] **AC-6**: Given a film whose file was never read, when the list view shows it, then its Audio and
      Subtitles cells read `—`; given one whose file carries English and Spanish audio, the Audio cell shows
      `ENG` and `SPA` chips.
- [~] **AC-7**: Given a series whose 28 in-scope episodes all carry English audio and English subtitles and
      25 of them carry Spanish subtitles, when `/shows` shows it in List view, then Audio shows `ENG`,
      Subtitles shows `ENG`, and `SPA` appears in neither.
- [~] **AC-7b**: Given AC-7, when Spanish subtitles are embedded into the 3 episodes that lacked them and
      their files are read again, then reloading `/shows` shows `SPA` in the series' Subtitles cell, with
      no Refresh. Given a series whose only read episode's file disappears from the media server and a
      sync clears its languages, then the series' cells read `—`.
- [~] **AC-7c**: Given a series registered before this feature with read episode files, after `api`
      restarts on the new version its Audio/Subtitles cells show the intersection without any user
      action.
- [~] **AC-8**: Given the user chose List and page size 48 on `/movies`, when they later open `/shows` with
      no query parameters (same browser), then `/shows` opens in List with page size 48 and filter All.
- [~] **AC-9 (failure)**: Given a library with 2 pages at size 24, when the user opens `/movies?page=99`,
      then page 2 shows and the URL reads page 2; `/movies?page=abc&pageSize=7&filter=foo&view=bar` shows
      page 1, size 24 (or the cookie's), filter All, view Grid (or the cookie's) — no error screen.
- [~] **AC-10 (failure)**: Given the user selects Downloaded on a library with no `COMPLETED` title, then
      the filter-empty message shows, the pager is hidden and the filter control is still usable.
- [~] **AC-11 (failure)**: Given `api` is stopped, when the user opens `/shows`, then the empty state
      renders (not Next's error screen) and `web`'s logs show the failed query.
- [~] **AC-12**: Given shorts are enabled and the library holds 5 shorts and 30 feature films, then `/movies`
      totals 30 across its pages and `/shorts` totals 5; with shorts disabled, `/movies` totals 35.
- [~] **AC-13**: Calling `moviePage(page: 1, pageSize: 7)` from GraphQL returns `pageSize: 24`; calling it
      with `page: 0` returns `page: 1`; with `page` past the end returns `page == totalPages`.
- [~] **AC-14**: At 375 px width, `/movies` in List view has no horizontal page scroll; the table scrolls
      inside its own container.
- [x] **AC-15**: The existing `movies(isShort)` and `shows` queries return the same rows in the same order as
      before this feature (NFR-2).

Legend: `[x]` observed holding; `[~]` implemented, awaiting a manual run on a live stack (none was
available while implementing: no dev database, Redis or browser session).

- AC-15 holds: `git diff --numstat` shows 0 deleted lines in `movies`/`shows` services and resolvers.
- AC-1 to AC-5, AC-8, AC-10, AC-11, AC-12, AC-14 need the browser. AC-9 was traced through the code
  (one redirect to the clean URL, none after) but not seen. AC-13's clamping is covered by the
  `findPage` unit tests, not by a GraphQL call. AC-6, AC-7, AC-7b and AC-7c are covered at unit level
  (`intersect.spec.ts`, the `completed` and `syncShow` call-site tests, the backfill) but not end to end.
- `src/schema.gql` still has to be regenerated by one real api boot (see tasks.md notes).

## Out of Scope

- **Sorting by column or by anything other than registration date.** The user asked for paging, a view
  switch and a filter; sortable columns would be a second ordering contract to keep stable across pages.
- **Text search within the library.** The header search box searches the TMDB catalog; filtering the
  library by title is its own feature.
- **`/lists/[id]`, the billboard and `/search`.** They also render `MediaList`, but none is a library
  listing of a media type and none was asked for; they keep the unpaginated grid.
- **Per-user stored view preferences.** View and page size live in a browser cookie (REQ-10), not on
  `User`; following the user across devices would need a schema change nobody asked for.
- **A per-language "how many episodes" breakdown for series.** REQ-7 shows only what every episode has;
  showing partial coverage (25/28) belongs to the series detail page, which already lists tracks per
  episode (`108`).
- **More filters (status values individually, content kind, year).** Downloaded/Added is the whole ask.

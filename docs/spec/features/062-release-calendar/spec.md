---
title: Release Calendar
spec_version: 0.2.0
author: Juan Farias
created_at: 2026-09-19
last_updated: 2026-09-19
status: Implemented
services: [api, web]
---

# SPEC: Release Calendar (`spec.md`)

## Context & Goal

`033-billboard-and-navigation` put **Calendario** in the sidebar and made `/calendar` resolve
(REQ-13 there) as a deliberately empty route: `services/web/src/app/(dashboard)/calendar/page.tsx`
returns `null`, and `033`'s Out of Scope left "what Calendario will show" to a later feature. This is
that feature. A user who follows a handful of series and films has no view that answers "what comes
out this month, and has Perceptor already got it?" — the only way today is opening every detail page
and reading release dates one by one.

Once this ships, `/calendar` shows a month grid (current month by default) with every film, short and
episode in the calling user's library whose release date falls in the visible range, each coloured by
where it stands in the pipeline: green when it is in the library, blue while it is being acquired or
transcoded, red when something failed, and uncoloured when nothing has happened yet (typically
because it has not been released). The user moves backwards and forwards month by month. Clicking an
entry opens the title's existing detail page.

The data already exists: `Movie.releaseDate`, `Episode.releaseDate` and the per-title status the
detail pages show (`deriveTitleStatus`, `services/api/src/pipeline-status/`, `043`, including `059`'s
read-time `QUEUED` lift for episodes under an in-flight season pack). What is missing is a
date-ranged, user-scoped read across films and episodes at once — no existing query can answer it
without fetching the whole library — and the page itself. A starting-point component,
`services/web/src/components/calendar/Calendar.tsx` (a template FullCalendar demo with add/edit
modals), is already in the working tree but uncommitted, and `@fullcalendar/*` is not yet a
dependency of `web`. No pipeline stage changes; this is the "Browse library" row of the root
`CLAUDE.md`.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Month view)**: `/calendar` must show a single month grid, opening on the current
      month (in the browser's local calendar) every time the page is loaded.
- [ ] **REQ-2 (Navigation)**: The user must be able to move to the previous and next month, and back
      to the current month. The URL is always `/calendar` — changing month never navigates, never
      reloads the page and never changes the URL (no query string, no path segment); the new month's
      entries are fetched in place. Only a month view exists — no week/day views.
- [ ] **REQ-3 (What is listed)**: For the visible date range, the page must list every film, every
      short, and every episode (grouped per REQ-4) **in the calling user's library** whose release
      date falls inside that range. A title with no release date never appears. A title owned only by
      another user never appears.
- [ ] **REQ-4 (Episode grouping)**: Episodes of the same series, same season, released on the same
      day must appear as **one** entry labelled with the series title and the episode span
      (e.g. `Show S01E01–E10`, or `Show S01E03` when the group holds a single episode). Episodes of
      different seasons released the same day are separate entries.
- [ ] **REQ-5 (Kind)**: Each entry must carry whether it is a film, a short or episodes, and the page
      must make that distinguishable at a glance. `isShort` is read as stored (`048`/`056`), never
      re-derived here.
- [ ] **REQ-6 (Status colour)**: Each entry must be coloured from its status, where status is exactly
      the value the title's own detail page shows for it (same derivation, same `059` `QUEUED` lift):
      - `COMPLETED` → green
      - `QUEUED`, `PAUSED`, `DOWNLOADING`, `DOWNLOADED`, `ENCODING` → blue ("in progress")
      - `ERROR` → red
      - `MISSING` → no colour
- [ ] **REQ-7 (Group status)**: A grouped episode entry (REQ-4) must take one status from its
      members: `ERROR` if any member is `ERROR`; otherwise in-progress if any member is in progress;
      otherwise `COMPLETED` if every member is `COMPLETED`; otherwise `MISSING`.
- [ ] **REQ-7b (Group completion count)**: A grouped episode entry holding more than one episode must
      show how many of its own episodes are `COMPLETED` out of how many it holds, e.g.
      `Show S01E01–E03 · 1/3`. The count is scoped to that one day's group, never the whole season: a
      series that drops E01–E03 on one day and then one episode a week (e.g. *Reacher*) shows
      `0/3` → `1/3` → `2/3` → `3/3` on the premiere day as those three complete, while each weekly
      episode is its own single-episode entry with no count (its colour alone says whether it is
      done). A partially completed group with nothing in progress and nothing failed stays
      uncoloured per REQ-7 — the count is what makes the partial state visible.
- [ ] **REQ-8 (Click-through)**: Clicking an entry must navigate to `/movies/<id>` for a film or
      short and `/shows/<id>` for episodes. Shorts use the same detail route films do today.
- [ ] **REQ-9 (Media type availability)**: Entries of a type disabled installation-wide (`045`'s
      `movies_enabled`/`shows_enabled`; `048`'s `shortsEnabled`) must not be listed, consistent with
      how the sidebar and billboard already filter them. The calendar itself stays reachable even
      when both types are disabled, and then shows an empty month.
- [ ] **REQ-10 (Read-only)**: The calendar must offer no way to create, edit, move or delete entries —
      no date selection, no drag, no add-event button. The template's modals do not ship.
- [ ] **REQ-11 (Empty and failure states)**: A month with no entries must render the empty grid (not
      an error). A failed fetch must show a translated error message in place of the entries while
      keeping navigation usable, so the user can retry by moving months or reloading.
- [ ] **REQ-12 (i18n)**: Every user-facing string — month/day names, toolbar labels, the "today"
      button, "+N more" overflow, legend, error message — must follow the active UI locale (`en`/`es`,
      `018`), including FullCalendar's own chrome.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (One status truth)**: The status the calendar shows for a film or episode must never
      differ from what that title's detail page shows at the same moment. The calendar must not grow a
      second status derivation.
- [ ] **NFR-2 (Bounded range)**: The query must refuse a range longer than 62 days or with `to`
      before `from`, so the page can never become an unbounded whole-library scan. (A month view with
      leading/trailing weeks spans at most 42 days.)
- [ ] **NFR-3 (No external calls)**: Serving the calendar must make no TMDB, Prowlarr, qBittorrent or
      media-server call — database only (see the deployment-scale constraint: conserve external API
      calls, not DB queries).
- [ ] **NFR-4 (Dates are calendar days)**: Release dates are day-precision values and must render on
      the same day TMDB lists, regardless of the browser's timezone — a `2026-09-19` release never
      shows on the 18th for a user west of UTC.
- [ ] **NFR-5 (Dependencies)**: The only new `web` dependencies are the `@fullcalendar/*` packages
      the month view needs; the `web` image must still build via `bin/build`.

## GraphQL Contract Delta

```graphql
enum CalendarEntryKind {
  MOVIE
  SHORT
  EPISODES
}

type CalendarEntry {
  kind: CalendarEntryKind!
  """Movie.id for MOVIE/SHORT, Show.id for EPISODES — the id the detail route takes."""
  mediaId: Int!
  """Film title, or the series title for EPISODES."""
  title: String!
  """Release day, YYYY-MM-DD, no time or timezone component."""
  date: String!
  """One of the eight normalized pipeline statuses (043); for EPISODES, the group status (REQ-7)."""
  status: String!
  """Null unless kind is EPISODES."""
  seasonNumber: Int
  """Null unless kind is EPISODES. Lowest episode number in the group."""
  firstEpisodeNumber: Int
  """Null unless kind is EPISODES. Highest episode number in the group; equal to firstEpisodeNumber for a single episode."""
  lastEpisodeNumber: Int
  """Null unless kind is EPISODES and the group holds exactly one episode."""
  episodeTitle: String
  """Null unless kind is EPISODES. Number of episodes in the group (not derivable from the span when numbers have gaps)."""
  episodeCount: Int
  """Null unless kind is EPISODES. Number of episodes in the group whose status is COMPLETED (REQ-7b)."""
  completedCount: Int
}

type Query {
  """Titles in the caller's library released between from and to, inclusive (YYYY-MM-DD)."""
  calendar(from: String!, to: String!): [CalendarEntry!]!
}
```

Ordering: by `date`, then `title`, then `seasonNumber`/`firstEpisodeNumber`. `status` stays `String!`
like every other status field in the schema (`043`), not a new enum.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Not signed in / invalid token | `UnauthorizedException` (existing guard) | existing session-expired handling, redirect to login |
| `from` or `to` not a valid `YYYY-MM-DD` date | `BadRequestException`, key `error.calendar.invalid_date`, params `{ value }` | en: `Invalid date: {value}` / es: `Fecha inválida: {value}` |
| `to` earlier than `from`, or range longer than 62 days | `BadRequestException`, key `error.calendar.invalid_range` | en: `Invalid calendar range` / es: `Rango de calendario inválido` |

Consumer handling (`web`): both `BadRequestException`s are programming errors in `web` itself (it
always sends a month's visible range); it shows the translated message from REQ-11 in place of the
entries and keeps navigation working. Any other error (network, `api` down) shows the generic
translated error from REQ-11. Unauthorized follows the app's existing session handling. Disabled media
types are **not** an error — they are silently filtered (REQ-9), unlike `searchMedia`'s refusal,
because the calendar is a view over the library, not a request for a type.

`worker` does not consume this query.

## Data Model Changes

None. `Movie.releaseDate`, `Episode.releaseDate`, `Movie.isShort` and the ownership tables
(`UserMovie`/`UserShow`) already hold everything this feature reads.

## Acceptance Criteria

- [ ] **AC-1**: Signed in as a user with a film released this month, when opening `/calendar`, the
      grid shows the current month and the film on its release day, linked to `/movies/<id>`.
- [ ] **AC-2**: Given a series in the library with episodes airing next month, when clicking "next",
      the grid moves to next month without a full page reload, the address bar still reads exactly
      `/calendar`, and the episodes appear; "today" returns to the current month. Reloading the page
      after navigating always opens the current month again.
- [ ] **AC-3**: Given a series that released E01–E08 of season 2 on the same day, that day shows one
      entry `<Show> S02E01–E08`, linked to `/shows/<id>`.
- [ ] **AC-4**: A `COMPLETED` film is green, an episode whose torrent is downloading is blue, a film
      whose encode failed is red, and a film releasing next month with nothing attached has no colour —
      each matching the status its own detail page shows.
- [ ] **AC-5**: Given a same-day group where one episode is `ERROR` and the rest `COMPLETED`, the
      group entry is red.
- [ ] **AC-5b**: Given a series with E01–E03 released on one day and E04 a week later, where E01 is
      `COMPLETED` and E02–E03 are `MISSING`, the premiere day shows `<Show> S01E01–E03 · 1/3`
      (uncoloured) and the E04 day shows `<Show> S01E04` with no count. Once E02 and E03 complete,
      the premiere entry reads `3/3` and turns green.
- [ ] **AC-6**: A film registered by user A does not appear on user B's calendar.
- [ ] **AC-7**: With `shows_enabled` turned off in Settings, episodes disappear from the calendar
      while films remain; turning it back on restores them.
- [ ] **AC-8**: A short appears visually distinct from a film, and links to `/movies/<id>`.
- [ ] **AC-9** (failure): Querying `calendar(from: "2026-09-01", to: "2026-12-31")` directly against
      `api` returns a GraphQL error with `extensions.i18n.key = "error.calendar.invalid_range"`;
      `calendar(from: "2026-13-01", to: "2026-13-30")` returns `error.calendar.invalid_date`.
- [ ] **AC-10** (failure): With `api` stopped, `/calendar` renders the grid chrome and a translated
      error message instead of crashing; month navigation still responds.
- [ ] **AC-11**: With the browser's timezone set to `America/Argentina/Buenos_Aires`, a title TMDB
      lists for `2026-09-19` shows on the 19th, not the 18th.
- [ ] **AC-12**: With UI locale `es`, month names, weekday headers, the "hoy" button and the legend
      are in Spanish; with `en`, in English. `bin/cli web node scripts/check-messages.mjs` reports no
      `en`/`es` drift.
- [ ] **AC-13**: Clicking an empty day or dragging an entry does nothing — no modal, no move.

## Out of Scope

- **Week and day views.** Release dates are day-precision; a time grid would show every entry in an
  all-day row and add nothing. The template's `timeGridWeek`/`timeGridDay` buttons do not ship.
- **Titles not in the library** ("upcoming popular releases" from TMDB). The calendar is a view over
  what the user already follows; showing unregistered titles means TMDB calls per month navigation
  (NFR-3) and a separate add flow.
- **Acting from the calendar** — search, add torrent, retry. The detail page already does all of
  that; the calendar links there (REQ-8).
- **Refreshing release dates.** A date is only as fresh as what is stored; `041`'s
  `refresh_episodes` task already keeps in-flight episodes current. Films' `releaseDate` is not
  re-fetched by this feature.
- **Remembering the last viewed month** across page loads, or a month in the URL. The route is always
  exactly `/calendar` (REQ-2); a reload or a shared link always opens on the current month (REQ-1).
- **Live updates.** Statuses are read when the month is fetched; no polling, no push.
- **Season-level entries.** A season pack in flight shows through its episodes' lifted `QUEUED`
  status (`059`), not as its own calendar entry.

## Verification Record (2026-09-19)

Run: `api` 603/50 suites green, 0 typecheck errors; `web` 0 typecheck errors, build exits 0, catalog check
clean at 442 keys; `git status --short services/api/prisma services/worker` empty; `schema.gql` diff matches
the Contract Delta. Covered by unit tests only: REQ-4, REQ-7, REQ-7b (incl. AC-5, AC-5b), REQ-9 (AC-7),
NFR-2 and NFR-4's date handling (AC-9, AC-11 in `api`), the error keys.

**Not run live** (no signed-in session was available to the implementing agent, and it does not enter
credentials): AC-1 to AC-4, AC-6, AC-8, AC-10 to AC-13 and the direct HTTP query of AC-9. The acceptance
boxes above are therefore left unticked until someone walks `/calendar` on a running stack.

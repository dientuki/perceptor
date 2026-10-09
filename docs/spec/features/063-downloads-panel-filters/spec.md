---
title: Downloads Panel Filters, Order and Placement
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-19
last_updated: 2026-09-19
status: Approved
services: [api, web]
---

# SPEC: Downloads Panel Filters, Order and Placement (`spec.md`)

## Context & Goal

The downloads panel (`services/web/src/components/downloads/DownloadsPanel.tsx`, one row per
`MediaSource` via `DownloadRow.tsx`) is the per-title view of the Download, Detect-completion and
Transcode stages of the pipeline. It is fed by `api`'s `movieDownloads(movieId)` /
`showDownloads(showId)` (`services/api/src/downloads/downloads.service.ts`) and rendered on the film
detail page (`/movies/[id]`, which also serves shorts) and on the series detail page
(`/shows/[id]`). Once a title has raced several sources, re-tried a season pack or accumulated
failures, the panel becomes a flat list that is hard to read: there is no way to narrow it to what
is still running or what failed, and rows come back oldest-first (`orderBy: { createdAt: 'asc' }`),
so the thing that just changed is at the bottom.

Two smaller defects ride along. A season-pack row's `label` is built by `api` as
`"<Show> Temporada <n>"` — hardcoded Spanish — so an English UI shows "Reacher Temporada 3". The same
hardcoded string is the `title` param of `error.magnet.already_attached` when the conflicting source
is a season pack (`SeasonsService.seasonDisplayTitle`), so that error is half-translated in English.
`web` already has the right copy (`seasonAccordion.seasonLabel`: `Season {number}` /
`Temporada {number}`); it just never gets the number it needs. And on the film detail page the panel
sits below and outside the detail card, after the torrent search, so the current state of the title
is the last thing on the page rather than the first thing next to the controls that act on it.

Once this ships, the panel has three mutually exclusive filter toggles — completed, working, error —
each with a live count badge, left of Refresh; rows come back most-recently-active first; a season
pack is labelled in the user's UI language; and the panel lives inside the detail card, above the
search. No pipeline stage in the root `CLAUDE.md` changes status — this is the reporting layer only.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Filter toggles)**: The panel header must show three toggle buttons, in this order and
      immediately left of the Refresh button: **completed**, **working**, **error**. Their labels are
      catalog-driven (`en`/`es`).
- [ ] **REQ-2 (Status buckets)**: Each row belongs to exactly one bucket, derived from its normalized
      `status` (the eight-value vocabulary of `043`): **completed** = `COMPLETED`; **error** =
      `ERROR`; **working** = `QUEUED`, `PAUSED`, `DOWNLOADING`, `DOWNLOADED`, `ENCODING` — the same
      grouping `web`'s existing `statusTone` already calls `completed` / `error` / `progress`. A row in
      any other status (`MISSING`, or an unrecognised value) belongs to no bucket: it is shown only
      when no filter is active and counted by no badge.
- [ ] **REQ-3 (Count badges)**: Each toggle must carry a badge with the number of rows currently in
      its bucket, computed over the full list the panel received — never over the filtered view — so
      the counts do not change when a filter is toggled. A bucket with zero rows shows `0`; its
      toggle stays clickable and selecting it shows the panel's empty state.
- [ ] **REQ-4 (Single selection, none = all)**: At most one toggle is active at a time. The panel
      starts with none active and shows every row. Clicking an inactive toggle activates it and
      deactivates any other; clicking the active toggle deactivates it and the full list returns.
      The active toggle is visually distinct and exposes its state to assistive technology
      (pressed/selected).
- [ ] **REQ-5 (Filter survives refresh)**: The active filter must survive the Refresh button and
      the implicit refreshes a row action (start/stop/delete) already triggers — a refresh re-reads
      the list, it does not reset the user's view. It need not survive a full page navigation.
- [ ] **REQ-6 (Most recent first)**: `movieDownloads` and `showDownloads` must return rows ordered
      by **last activity, most recent first**. A source's last activity is the latest of: when the
      source was added, when the source's own row last changed (status, error, scan), and when any of
      its encode jobs last changed (queued, progress, completed, failed). Ties are broken by newest
      source first. The order is `api`'s; `web` renders it as received, filtered or not, and never
      re-sorts.
- [ ] **REQ-7 (Season number on the row)**: A `Download` row for a season pack must carry that
      season's number, so `web` can label it without parsing `label`.
- [ ] **REQ-8 (Localized season label in the panel)**: `web` must render a season-pack row's name as
      the show title followed by the catalog's `seasonAccordion.seasonLabel` for that number —
      `Reacher Season 3` in `en`, `Reacher Temporada 3` in `es`. Film and episode rows keep rendering
      `label` unchanged (`Transformers`, `Reacher S03E08` — neither carries language).
- [ ] **REQ-9 (Language-neutral `label`)**: `api` must stop producing Spanish in `Download.label`.
      For a season pack the value becomes `"<Show> S<NN>"` (`Reacher S03`) — the same form as the
      season search prefill (`059`) and the episode label. It stays a fallback for any consumer that
      does not localize; `web` does not display it for season rows.
- [ ] **REQ-10 (Localized "already attached" for a season)**: When `addMagnetToSeason` /
      `addTorrentToSeason` refuse because the `infoHash` already belongs to a **different season
      pack**, the error must carry a new key `error.magnet.already_attached_season` with params
      `{ show, number }` instead of `error.magnet.already_attached` with a pre-rendered Spanish
      title. `web` renders it as `That magnet is already attached to «Reacher Season 3»` /
      `Ese magnet ya está asociado a «Reacher Temporada 3»`. The film/episode conflicts keep
      `error.magnet.already_attached` exactly as today.
- [ ] **REQ-11 (Placement)**: On `/movies/[id]` (films and shorts) the panel must render **inside**
      the detail card, after the title's details and **before** the torrent search block. On
      `/shows/[id]` it must render inside the detail card, after the show's details and before the
      season accordions (which carry the series' search buttons since `059`). The panel keeps its
      own bordered box inside the card.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No migration)**: No Prisma schema change. Every timestamp REQ-6 needs already exists
      (`MediaSource.createdAt`/`updatedAt`, `ProcessJob.updatedAt`).
- [ ] **NFR-2 (No extra external calls)**: Filtering, counting and ordering must add no qBittorrent,
      TMDB or Prowlarr call — filtering and counting are client-side over the list already fetched,
      ordering is over data `api` already reads. Each panel load keeps its single `info(tag)` read.
- [ ] **NFR-3 (Ownership unchanged)**: Both queries keep their existing ownership clause and error
      behaviour; this feature adds no way to read another user's rows.
- [ ] **NFR-4 (No catalog drift)**: Every new key lands in both `messages/en.json` and
      `messages/es.json`; `bin/cli web node scripts/check-messages.mjs` reports no drift.
- [ ] **NFR-5 (Order is tested)**: The ordering rule gets an `api` unit test — a wrong order
      produces no error anywhere (Article IX): at minimum, an old source whose encode job just
      changed sorts above a newer source that has been idle.

## GraphQL Contract Delta

```graphql
type Download {
  # ...every existing field unchanged...
  label: String!        # CHANGED VALUE, not type: "Transformers" | "Reacher S03E08" | "Reacher S03"
                        # (was "Reacher Temporada 3" for a season pack)
  seasonNumber: Int     # NEW. Non-null exactly when seasonId is non-null (a season-pack row);
                        # null for film and single-episode rows.
}

type Query {
  movieDownloads(movieId: Int!): [Download!]!   # unchanged signature; now ordered by last activity, desc
  showDownloads(showId: Int!): [Download!]!     # unchanged signature; now ordered by last activity, desc
}
```

The ordering change is invisible to the schema and is the part most likely to be missed: a consumer
that re-sorts (or an `api` change that drops the `orderBy`) compiles and renders — just in the wrong
order. `docs/spec/graphql-contract.md`'s `Download` block (which still shows `"Reacher Temporada 3"`)
must be updated with this delta.

Errors:

| Condition | GraphQL error | Key / params | Message the user sees |
| :-- | :-- | :-- | :-- |
| `addMagnetToSeason`/`addTorrentToSeason`: `infoHash` already attached to a **different season pack** | `ConflictException` | **NEW** `error.magnet.already_attached_season` `{ show: string, number: number }` | en: `That magnet is already attached to «{show} Season {number}»` · es: `Ese magnet ya está asociado a «{show} Temporada {number}»` |
| same mutations: `infoHash` already attached to a film or an episode | `ConflictException` | `error.magnet.already_attached` `{ title }` — unchanged | unchanged |
| `movieDownloads`/`showDownloads`: title missing or not owned | unchanged (`error.movie.not_found` / `error.show.not_available`) | unchanged | unchanged |

`web` handling: the season-magnet and season-search modals already surface a keyed conflict through
`translateGraphQLError`; the new key must be in the catalog so it translates rather than falling back
to the English `message`. `number` is passed as a number, not a pre-padded string. The English
`message` `api` sends alongside the key is the English rendering above.

## Data Model Changes

None.

## Acceptance Criteria

**Verification status — 2026-10-09** (pass over 002–071 on `fix/tech-debt`, no code change)

Nine of ten open, and every one of them is an **admin session in a browser plus sources in flight**.
The panel this feature filters lives on `/movies/<id>` and `/shows/<id>`; the filter chips, the
badge counts and the ordering it asserts have no non-browser equivalent to read them from.

What this installation can offer towards the setup: 3 films, 2 series, 64 episodes — and
`media_sources` holds **one** row, a pre-`053` orphan. AC-1 needs a film with four sources in four
distinct states (`COMPLETED`, two in progress, one `ERROR`), AC-5 two idle sources with different
ages, AC-6 and AC-7 a season-3 pack. Those are live acquisitions; the rows carry live qBittorrent
state, so writing them by hand would produce rows that read as errors rather than as the scenario.

Two boxes are cheaper than the rest and worth doing first once a session exists:

- **AC-4** (a title whose sources are all `COMPLETED`, **error** clicked → the empty-state copy, not
  an error) needs one completed title and no in-flight anything.
- **AC-7** is not a page assertion at all — `showDownloads(showId)` returning `seasonNumber: 3` and a
  season label, read through GraphiQL. It needs a signed-in user's token and a season-scoped source,
  nothing more. Its data half is unit-covered: `downloads.service.spec.ts` asserts
  `'showDownloads orders the same way and labels a season row with its number'`.

AC-8's refusal copy (a magnet whose hash is already attached elsewhere) is `060`'s territory and
blocked the same way — see that spec's own note.

- [ ] **AC-1**: Given a film with one `COMPLETED`, two in-progress (e.g. `DOWNLOADING`, `ENCODING`)
      and one `ERROR` source, when `/movies/<id>` loads, then the panel header shows, left of
      Refresh, `completed 1`, `working 2`, `error 1`, no toggle active, and all four rows listed.
- [ ] **AC-2**: From AC-1, when **error** is clicked, only the `ERROR` row is shown and the badges
      still read `1 / 2 / 1`; when **working** is then clicked, **error** deactivates and only the
      two in-progress rows show; when **working** is clicked again, all four rows return.
- [ ] **AC-3**: With **working** active, clicking Refresh (or stopping one of the rows) re-reads the
      list and **working** is still active afterwards.
- [ ] **AC-4 (failure path)**: Given a title whose sources are all `COMPLETED`, when **error** is
      clicked, the badge reads `0` and the panel shows its empty state — not a blank table, not an
      exception — and clicking **error** again restores the full list.
- [ ] **AC-5**: Given a film with source A added yesterday and source B added an hour ago, both idle,
      the panel lists B above A. When A's encode then progresses or fails (its job row changes) and
      the page is refreshed, A is listed above B.
- [ ] **AC-6**: With the UI language set to English, a show with a season-3 pack shows the row as
      `Reacher Season 3`; switching to Spanish shows `Reacher Temporada 3`. No English page shows the
      word "Temporada" anywhere in the panel.
- [ ] **AC-7**: `bin/cli api …` / GraphiQL: `showDownloads(showId)` returns `seasonNumber: 3` and
      `label: "Reacher S03"` for the season-pack row, and `seasonNumber: null` for an episode row.
- [ ] **AC-8 (failure path)**: With the UI in English, pasting into season 2's magnet modal a magnet
      already attached to season 3 of the same show fails with
      `That magnet is already attached to «Reacher Season 3»`; in Spanish, with `«Reacher Temporada 3»`.
- [ ] **AC-9**: On `/movies/<id>` (a film and a short) the panel appears inside the detail card, above
      the torrent search; on `/shows/<id>` it appears inside the detail card, above the first season
      accordion.
- [x] **AC-10**: `bin/npm api run test` passes, including the NFR-5 ordering test;
      `git status --short services/api/prisma` is empty; `bin/cli web node scripts/check-messages.mjs`
      reports no drift; `bin/npm web run build` exits 0.

## Out of Scope

- **A global downloads/queue page.** `/downloads` exists in the sidebar and still renders nothing;
      this feature only changes the per-title panel. A cross-title queue needs its own query and
      ownership rules.
- **Persisting the filter** across navigation or per user. It is view state; REQ-5 only keeps it
      across in-page refreshes.
- **Auto-refresh / polling.** The panel stays as fresh as the last load or click (`022` REQ-9/10).
- **Localizing labels anywhere else `api` builds a season string** (e.g. log lines, `MediaSource`
      rows written by other paths). Only the `Download.label` value and the season conflict error
      reach the UI; those are the two fixed here.
- **Film/episode conflict errors from `addMagnetToMovie`/`addMagnetToEpisode` when the existing
      source is a season pack.** Those paths do not name a season today; not changed here.
- **The `movieId` naming debt** (root `CLAUDE.md` § Known debt) — untouched; `seasonNumber` is added
      beside the existing ids, nothing is renamed.

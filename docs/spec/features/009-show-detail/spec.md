---
title: Show Detail Screen
spec_version: 0.2.0
author: Juan Farias
created_at: 2026-08-13
last_updated: 2026-08-13
status: Implemented
services: [api, web]
---

# SPEC: Show Detail Screen (`spec.md`)

## Context & Goal

`/shows/[id]` exists on disk but is unreachable and non-functional: `src/app/(dashboard)/shows/[id]/page.tsx`
is an untracked paste that imports `getMovieById` (films, not series) and references `show`,
`Show` and `SeasonAccordion` identifiers that are never bound — it does not compile. Two other
files sit next to it in the same state — `src/components/shows/Show.tsx` is a byte-for-byte copy
of `movies/Movie.tsx` never adapted to a series, and `src/components/shows/SeasonAccordion.tsx`
imports `@prisma/client` types (`Prisma.SeasonGetPayload`, forbidden in `web` — Constitution,
Article II) against a GraphQL query that has no counterpart on `api`. None of these three files are
committed and none are reused by this feature; they establish intent but not a starting point.

On the `api` side, `ShowsResolver` exposes exactly one query, `shows: [Show!]!`, a listing with no
seasons or episodes (`007-library-listing`, `shows.service.ts:39`) — deliberately, per that
feature's spec, since the detail page was "the next feature." There is no `show(id)` query and no
GraphQL type for `Season` or `Episode`, even though the Prisma models (`Season`, `Episode`) already
carry every field this screen needs (`seasonNumber`, `episodeNumber`, `title`, `overview`,
`releaseDate`, `status`) — this is a pure GraphQL-surface addition, no migration.

This feature ships the real `/shows/[id]` route: the same kind of detail screen `008-movie-detail`
built for films (poster, title, overview, metadata, ownership-scoped 404), minus the film-only
acquisition buttons (buscar/añadir torrent/añadir archivo at the top level), plus a season
accordion listing every episode. Per-episode action buttons are part of the visual design but are
explicitly inert placeholders — no search, no import, no modal wiring — since the API has no
episode-level acquisition path yet (`SearchTorrentModal`'s `handleAddTorrent` already no-ops for
non-movie media, and `src/actions/jobs.ts`, which the season/folder import modals depend on, does
not exist). Once this ships, the library-listing pipeline stage in the root `CLAUDE.md` gains a
real destination for series cards, and the "series card links to `/movies/<id>`" known issue from
`007-library-listing` is fixed as part of this feature, since a card that still links to the wrong
page would make the new route unreachable from the UI.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Show metadata)**: The show detail screen must display the same core metadata the
      movie detail screen shows for a film — poster, title, release year, original language,
      status, overview — without the torrent-search, add-torrent or add-file controls a movie
      detail screen has at the top level.
- [x] **REQ-2 (Season accordion)**: Below the show metadata, the screen must render one collapsible
      section per season, each listing that season's episodes, ordered by `seasonNumber` **descending**
      — the newest season's section appears first, the oldest last (amended 2026-08-13; originally
      ascending, corrected after first review — see § Display-order correction below).
- [x] **REQ-3 (Episode fields)**: Each episode row must display its episode number, title,
      overview, release date and status, listed within its season ordered by `episodeNumber`
      **descending** — the newest episode first (amended 2026-08-13, same correction as REQ-2).
- [x] **REQ-4 (Default expanded season)**: The season with the highest `seasonNumber` must be
      expanded when the page first renders — under REQ-2's amended ordering this is also the
      first section on the page; every other season must be collapsed.
- [x] **REQ-5 (Episode action buttons, inert)**: Each episode row must display three buttons
      (buscar, importar archivo, añadir torrent). Clicking any of them must have no observable
      effect — no modal opens, no network request fires. The code that would wire them to a modal
      is written but commented out, not deleted, so a future feature can uncomment rather than
      rebuild it.
- [x] **REQ-6 (Ownership-scoped read)**: A caller must only be able to fetch a show's detail data
      for a show linked to them through `UserShow`, identically to how `movie(id)` is scoped
      through `UserMovie` (`008-movie-detail`).
- [x] **REQ-7 (Reachable from the listing)**: A series card in the `/shows` listing must link to
      `/shows/<id>`, not `/movies/<id>`.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (No new error string)**: A show that does not exist and a show the caller does not
      own must be indistinguishable to the caller — both surface as the same
      `Recurso no disponible para este usuario` 404 the movie detail screen already uses. No new
      GraphQL error condition, no new message.
- [x] **NFR-2 (Server-side ordering is the source of truth; display order is `web`'s own reversal)**:
      `api` must keep returning seasons and episodes ordered ascending (`seasonNumber`/`episodeNumber`),
      unchanged — this is what guarantees the data itself is never silently mis-ordered. `web` is
      explicitly permitted to reverse both arrays **only for display** (REQ-2/REQ-3) — a `[...arr].reverse()`
      immediately before rendering, never a re-sort by a different key and never mutating the
      fetched array. This is not the "client-side sort masks an api bug" risk the original wording
      warned about: reversing a correctly-ascending array is a deliberate, fixed transformation that
      cannot hide a real ordering defect — an `api` bug (e.g. a missing `orderBy`) would still show up
      as visibly wrong episode numbers after the reversal, just as it would before it.
- [x] **NFR-3 (No Prisma types in web)**: The rewritten `Show`/`SeasonAccordion` components must be
      typed against the shape returned by the new `getShowById` action, never against
      `@prisma/client` (Constitution, Article II).
- [x] **NFR-4 (No new schema)**: This feature adds no Prisma migration — `Season`/`Episode` already
      carry every field needed; only their GraphQL exposure is new.

## GraphQL Contract Delta

```graphql
type Episode {
  id: ID!
  episodeNumber: Int!
  title: String
  overview: String
  releaseDate: DateTime
  status: String!
}

type Season {
  id: ID!
  seasonNumber: Int!
  releaseDate: DateTime
  episodes: [Episode!]!
}

type Show {
  id: ID!
  tmdbId: Int!
  title: String!
  overview: String
  posterUrl: String
  releaseDate: DateTime
  originalLanguage: String!
  isLiveAction: Boolean!
  status: String!
  seasonsSyncedAt: DateTime
  createdAt: DateTime!
  updatedAt: DateTime!
  seasons: [Season!]!
}

type Query {
  show(id: Int!): Show
}
```

- `Episode.status` and `Show.status` both cross as plain `String!`, same reasoning as
  `Movie.status`/`Show.status` today (`007-library-listing`): one of
  `"MISSING" | "DOWNLOADING" | "ENCODING" | "COMPLETED" | "ERROR"`, not a registered GraphQL enum.
  Introducing an enum for one field and not the others would make three structurally-parallel
  status fields diverge for no reason.
- `Season`/`Episode` carry no image field — the schema has none (only `Show.posterUrl`); this
  screen never requests a season or episode still.
- `seasons` is resolved via a nested Prisma `include` on the same query that already scopes by
  ownership (`show.findFirst({ where: { id, users: { some: { userId } } }, include: { seasons:
  { orderBy: { seasonNumber: 'asc' }, include: { episodes: { orderBy: { episodeNumber: 'asc' } } } } } })`),
  not a separate resolver-level field lookup — same one-query shape `movie(id)`'s
  `mediaSource`/`processJobs` include already uses, just one level deeper.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `id` does not exist | none — `data.show` is `null` | *(no message; caller renders its own "not found" UI)* |
| `id` exists, caller has no `UserShow` link | none — `data.show` is `null`, identical to the row above | *(same as above — deliberately indistinguishable, per `008-movie-detail`'s `movie(id)` precedent)* |
| Caller is a service credential (`SERVICE_TOKEN`) | rejected by the global `JwtAuthGuard` before the resolver runs (`show` carries no `@AllowService()`) | `No autenticado` |

`web`'s `getShowById` (`src/actions/shows.ts`) must, on receiving `data.show === null`, call
`notFound()` from the page exactly as `getMovieById`/`movies/[id]/page.tsx` already does — it must
not attempt to distinguish "missing" from "not yours." On a GraphQL `errors` response it follows
the same `redirectToClearSession` path `getMovieById` uses (this is a Server Component render, not
a Server Action — cookie mutation is illegal here, see `services/web/CLAUDE.md`
§ "Session invalidation from a Server Component render").

## Data Model Changes

None. `Season` and `Episode` already exist in `services/api/prisma/schema.prisma` with every field
this feature needs. This is a GraphQL-surface-only change (new `@ObjectType`s, a new resolver
method) — no migration.

## Acceptance Criteria

- [x] **AC-1**: Given a show the caller owns with at least two seasons, when they navigate to
      `/shows/<id>`, then the page renders the show's poster, title, release year, original
      language, status and overview, and renders no torrent-search/add-torrent/add-file control at
      the show level.
- [x] **AC-2**: On that same page load, seasons are listed newest-to-oldest (highest `seasonNumber`
      first); the first (highest-numbered) season is expanded and shows its episodes (each with
      number, title, overview, release date, status) newest-to-oldest (highest `episodeNumber`
      first); every other season is collapsed.
- [x] **AC-3**: Clicking a collapsed season's header expands it and reveals its episodes; clicking
      an expanded season's header collapses it again.
- [x] **AC-4**: Each visible episode row shows three buttons (buscar, importar archivo, añadir
      torrent); clicking any of them opens no modal and triggers no network request (verified via
      browser dev tools — no new request in the network panel after the click).
- [x] **AC-5 (failure path)**: Given a show id that exists but belongs to a different user, when the
      caller navigates to `/shows/<that id>`, then the page renders the same
      `Recurso no disponible para este usuario` 404 the movie detail screen renders for an unowned
      film — not the show's title or any of its data.
- [x] **AC-6 (failure path)**: Given a show id that does not exist in the database, navigating to
      `/shows/<id>` renders the identical 404 from AC-5.
- [x] **AC-7**: From the `/shows` listing, clicking a series card navigates to `/shows/<id>` (its
      own detail page), not `/movies/<id>`.

## Display-order correction (2026-08-13, post-ship)

The first implementation rendered seasons and episodes in ascending order (matching the API's
wire order literally, on the theory that `web` should never reorder what `api` sends). After
review, the product decision is the opposite for display purposes: **both seasons and episodes
render newest-first**, while the API keeps returning them ascending (NFR-2, unchanged). `web`
reverses each array once, immediately before rendering — `src/app/(dashboard)/shows/[id]/page.tsx`
reverses the seasons array it maps over, `src/components/shows/SeasonAccordion.tsx` reverses
`season.episodes` before mapping. Neither the `getShowById` action nor `api` changed.

The per-episode table layout was also corrected in the same pass, from card-per-episode to a real
`<table>`: `# | Título (con overview debajo) | Fecha de estreno | Estado | Acciones`, matching the
row layout of the discarded pre-feature draft (`SearchTorrent.tsx`'s results table is the closest
surviving example of the same convention). This is a rendering change only — same fields (REQ-3),
same inert buttons (REQ-5), no new component props, no contract impact.

## Out of Scope

- **Functional episode-level modals.** The buscar/importar archivo/añadir torrent buttons are
  inert. Wiring them to `SearchTorrentModal`/`ImportFileModal`/`ImportMagnetModal` (or a season-
  level `ImportFolderModal`/`ImportMagnetSeasonModal`) requires episode-aware acquisition support
  on `api` that does not exist yet (`SearchTorrent`'s add-to-library path already no-ops for
  non-movie media; `src/actions/jobs.ts`, which the season-level import modals import, does not
  exist) — a future feature's job.
- **Season or episode still images.** Not in the Prisma schema; only `Show.posterUrl` exists.
- **Season-level bulk actions** (import a whole folder or a season magnet as one job). The existing
  `ImportFolderModal`/`ImportMagnetSeasonModal` components target this but depend on the
  nonexistent `src/actions/jobs.ts` — out of scope here, same reasoning as the per-episode modals.
- **`@AllowService()` on `show(id)`.** The worker has no reason to read a user's show by id today,
  mirroring `movie(id)`'s decision in `008-movie-detail`. Add it only when a real worker call site
  needs it.
- **A `type` discriminant field on the `Show` GraphQL type.** REQ-7 is satisfied client-side (the
  listing page already knows it is rendering `Shows.tsx` vs `Movies.tsx` separately —
  `007-library-listing` kept those two screens deliberately unmerged), not by adding a `type` field
  to the schema.

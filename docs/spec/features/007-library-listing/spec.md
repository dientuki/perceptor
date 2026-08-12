---
title: Library Listing for Movies and Shows
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-12
last_updated: 2026-08-12
status: Implemented
services: [api, web]
---

# SPEC: Library Listing for Movies and Shows (`spec.md`)

## Context & Goal

`006-media-search` made registration symmetric: a user can search TMDB and add either a film or a
series to their library through `searchMedia`/`addMedia`, and both `UserMovie` and `UserShow` record
who owns what. Browsing did not follow. `movies: [Movie!]!`
(`services/api/src/movies/movies.resolver.ts`, backed by `MoviesService.findAll`) returns the
caller's films and `/movies` renders them, but there is no counterpart for series: `ShowsService`
(`services/api/src/shows/shows.service.ts`) has `search` and `register` and nothing that reads a
user's library, and no `Show` GraphQL type exists at all. A user who registers a series from
`/shows/add` watches it disappear — the row and the `user_shows` link are written, and then nothing
in the product ever shows them again.

The web side is in the same state, worse for being half-copied. `services/web/src/app/(dashboard)/shows/page.tsx`
and `services/web/src/components/Shows/` are an untracked, unfinished paste of the Movies UI: the
page imports `@/components/movies/Shows`, which does not exist, and `Shows/Shows.tsx` calls
`getMovies()` and renders `MEDIA_TYPE.MOVIE`. That import is the sixth typecheck error the root
`CLAUDE.md` records under "Current state". This feature is what makes those files real, so clearing
that sixth error is part of the deliverable rather than a side effect — the other 12, in five
pre-GraphQL files, stay exactly where they are.

Once this ships, `/shows` lists the series in the caller's library the same way `/movies` lists
their films — same card grid, same empty state, same "most recently added first" order — and the
two listings are independent implementations that happen to look alike, not one parameterized
listing. This touches only the **Browse library** row of the pipeline table in the root `CLAUDE.md`,
which moves from "working for the movie list" to working for both. No stage is added, and nothing
about search, download, encode or notification changes.

One schema change rides along. `Show.status` is `String?` today, never written by any code path,
and semantically ambiguous — TMDB's own `status` for a series is a catalog string like `"Ended"`,
while `Movie.status` is the pipeline's `MediaStatus` enum. This feature settles it as the pipeline
enum, matching `Movie`, so that a later feature wiring downloads for series has a column with the
right meaning and no all-NULL legacy to interpret.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Show listing)**: The API must expose a query that returns every series in the calling
      user's library, and nothing belonging to any other user.
- [x] **REQ-2 (Ownership scope)**: A series registered by another user, and not linked to the caller,
      must not appear in the caller's listing — even though the `shows` row itself is shared.
- [x] **REQ-3 (Order)**: Series must be returned most-recently-added first, matching the film
      listing's order.
- [x] **REQ-4 (Empty library)**: A user with no series must receive an empty list, not an error and
      not null.
- [x] **REQ-5 (Authentication)**: Every caller must be authenticated — every GraphQL operation in
      this API requires a credential, `login` being the only exception. A caller holding the service
      credential (`SERVICE_TOKEN`) must be **refused**: the listing is a per-user view, a machine
      principal has no library, and the worker has no business reading one. It must never be handed
      some user's series or the whole `shows` table. This is what the global `JwtAuthGuard` already
      does for `movies` — `guards/jwt-auth.guard.ts:49-57` rejects a service principal on any
      operation not marked `@AllowService()`, before the resolver runs. The `shows` query must not
      carry `@AllowService()`.
- [x] **REQ-6 (Shows page)**: `/shows` must render the caller's series as a card grid, using the same
      list and card components the film listing uses, with the same empty-state copy the shared
      component already produces for series ("No hay series registradas").
- [x] **REQ-7 (No parameterization)**: Films and series must be listed by two independent queries and
      two independent GraphQL types. The existing `movies` query, the `Movie` type, and the film
      listing UI must be byte-identical after this feature.
- [x] **REQ-8 (Series status is a pipeline status)**: A series' `status` must be the same
      `MediaStatus` the pipeline uses for films, must never be null, and must default to `MISSING`
      for a series with no files.
- [x] **REQ-9 (Listing files resolve)**: The `shows` listing files that currently reference
      non-existent modules must resolve. `app/(dashboard)/shows/page.tsx` must no longer produce
      `Cannot find module '@/components/movies/Shows'`, returning `web`'s typecheck to its
      documented 12-errors-across-5-files baseline.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Single query)**: The listing must resolve the caller's series in one database query.
      A per-row lookup for ownership is a regression against how `movies` already works.
- [x] **NFR-2 (Backfill)**: `Show.status` becomes non-null. Every existing row must be backfilled to
      `MISSING` in the same migration that changes the column — an unbackfilled non-null column
      fails the migration on any database that already has series in it.
- [x] **NFR-3 (No contract drift for films)**: The `movies` query's SDL must be unchanged. The
      diff of `schema.gql` for this feature must add the `Show` type and the `shows` query and
      touch nothing else that films depend on.
- [x] **NFR-4 (Regenerated schema only)**: `services/api/src/schema.gql` is regenerated from
      decorators, never edited (Constitution, Article IV).

## GraphQL Contract Delta

Two additions to the schema. `Movie` and the `movies` query are untouched.

```graphql
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
}

type Query {
  shows: [Show!]!
}
```

Notes the SDL cannot carry:

- `status` is the `MediaStatus` enum in Prisma but crosses the boundary as a `String!`, exactly the
  way `Movie.status` already does. This is deliberate consistency with the existing film contract,
  not an oversight — `web` receives `"MISSING" | "DOWNLOADING" | "ENCODING" | "COMPLETED" | "ERROR"`.
- `seasonsSyncedAt` is null while a series' season/episode hydration (`006-media-search`, REQ-13)
  has not completed or has failed. `web` must treat null as "not yet synced" and must not render it
  as an error; the listing does not surface it in the UI today, it is in the contract so a later
  feature does not need a contract change to show it.
- The type deliberately carries **no `type` field** and **no `seasons`/`episodes`**. See Out of Scope.

### Errors

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| No credential, or an expired/invalid JWT | `UnauthorizedException` | `No autenticado` |
| A service credential (`SERVICE_TOKEN`) | `UnauthorizedException` | `No autenticado` |
| Database unreachable / query fails | `InternalServerErrorException` | `Error al obtener series` |

The service principal is the **same** error row as no credential at all, and deliberately carries
the same string — `guards/jwt-auth.guard.ts:50-56` explains why a machine principal hitting a
user-only operation does not get a distinct user-facing message. `movies` behaves byte-identically.
No `ForbiddenException` is introduced here: that would be a new behaviour for this one query and
would diverge the two listings, which REQ-7 exists to prevent.

Note the string is `No autenticado`, not `Unauthorized` — the latter appears only under
`extensions.originalError.error`, and `web` reads `errors[0].message`.

What `web` does with each:

- **`No autenticado`** — `getShows()` calls `redirectIfUnauthenticated(errors)` before throwing, the same
  as `getMovies()` in `services/web/src/actions/movies.ts`. The user lands on the login screen.
- **Any other error** — thrown as `Error(errors[0].message ?? "Error al obtener series")`. The page
  logs it and renders the empty state rather than crashing the dashboard, matching what
  `components/movies/Movies.tsx` does with a failed load today.

An empty library is **not** an error condition: `[]` with no `errors` array (REQ-4).

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `Show` | `status` changes type `String?` → `MediaStatus` | non-null, `@default(MISSING)` | Yes — every existing row to `MISSING` (NFR-2) |

No new model, no new relation. `UserShow` already exists (`006-media-search`) and is the join the
listing reads through; it needs no change.

The column is all-NULL in every deployed database today — nothing writes `shows.status` — so the
backfill is a single `UPDATE`, not a data migration with judgment calls. The `"Ended"` /
`"Returning Series"` string TMDB returns under the same name is *not* persisted anywhere and is not
what this column becomes.

## Acceptance Criteria

- [x] **AC-1**: Given user A has registered two series and user B one different series, when A
      queries `shows`, then exactly A's two series are returned and B's is absent.
- [x] **AC-2**: Given a series already registered by user B, when user A registers the same series
      and then queries `shows`, then A sees it once — the shared `shows` row is listed for both
      users independently.
- [x] **AC-3**: Given a user with no series, when they query `shows`, then the response is
      `{"data":{"shows":[]}}` with no `errors` key.
- [x] **AC-4**: Given a user who registered series X and then series Y, when they query `shows`,
      then Y precedes X in the array.
      Caveat, observed during implementation: the order key is `shows.createdAt` — the shared
      catalog row — not the `user_shows` link, exactly as `MoviesService.findAll` orders on
      `movie.createdAt`. So a user who registers a series another user added months ago sees it at
      the *bottom* of their library, not the top. REQ-3 asks only for the film listing's order,
      which this is; ordering by the ownership link would have to change both listings at once and
      is therefore its own feature, not a fix here.
- [x] **AC-5** *(failure path)*: A `shows` query sent with no `Authorization` header returns a
      GraphQL error with `No autenticado` and `data: null`, so there is no `data.shows`.
- [x] **AC-6** *(failure path)*: Given a database with several users' series, when `shows` is queried
      with `SERVICE_TOKEN` as the credential, then the request is refused before the resolver runs —
      the same `No autenticado` error and `data: null` — and the response contains neither an
      arbitrary user's library nor any series in the database. Verified against `movies` with the
      same credential, which must respond identically (REQ-7).
- [x] **AC-7**: `bin/cli api npx --no tsc --noEmit` prints no errors (the `api` baseline is 0).
- [x] **AC-8**: `bin/npm api run test` passes, with a `shows.service.spec.ts` case that fails if the
      listing stops filtering by `userId` — the ownership leak in AC-1 produces no error anywhere,
      which is exactly the class Article IX asks for a test.
- [x] **AC-9**: `bin/mysql -e 'select status, count(*) from shows group by status'` after
      `bin/npm api run prisma:migrate` shows every row as `MISSING` and no NULLs.
- [x] **AC-10**: `bin/cli web npx --no tsc --noEmit` reports **12 errors across the 5 documented
      pre-GraphQL files and no others** — specifically, the sixth error on
      `app/(dashboard)/shows/page.tsx` (`Cannot find module '@/components/movies/Shows'`) is gone.
      A full `bin/npm web run build` still fails on those 12: `next.config.ts` sets no
      `typescript.ignoreBuildErrors`, so the build typechecks every included file, and clearing
      those five files is out of scope here.
- [ ] **AC-11**: In the browser, `/shows` with a library of three series renders three cards with
      poster, title and year, and `/movies` renders exactly as it did before this feature.
- [ ] **AC-12**: In the browser, `/shows` with an empty library renders "No hay series registradas".
- [x] **AC-13**: `git diff services/api/src/schema.gql` contains only the `Show` type and the `shows`
      query — no change to `Movie` or `movies` (NFR-3).

## Out of Scope

- **The detail link on a series card.** `MediaCard` builds its href from `item.type`, which the
  listing payload does not carry, so a series card links to `/movies/<id>`. This is known and
  deliberately left broken here: the fix is the next spec, together with a real
  `/shows/[id]` page. Today `services/web/src/app/(dashboard)/shows/[id]/page.tsx` is another
  untracked paste that fetches a *movie* by that id, so making the link work without fixing the
  destination would be worse than leaving it pointing at `/movies`.
- **Pagination.** Both listings return the whole library. A user with hundreds of titles will feel
  it; adding limit/offset means changing the `movies` contract too, which REQ-7 forbids in this
  feature.
- **Filters, sorting and search within the library.** Same reason — one order (`createdAt desc`), no
  arguments. Adding an argument later is additive and needs no migration.
- **Seasons and episodes in the listing.** A series' seasons are hydrated in the background
  (`006-media-search`) and rendering them belongs to the detail page, not a card grid. `Show` carries
  `seasonsSyncedAt` so a later feature can tell "no seasons" from "not synced yet" without a
  contract change.
- **A shared `library(type:)` query or a `MediaTypeService.list()` method.** Explicitly rejected
  during specification: films and series stay independent implementations. `MediaDispatchService`
  and `MediaTypeService` are not extended by this feature.
- **`services/web/src/components/Shows/Movie.tsx`.** That untracked file is detail-page scaffolding,
  not listing code; it belongs to the next spec along with the detail route.
- **A consolidated status for series.** REQ-8 gives the column the right type and a default; nothing
  in this feature ever moves a series off `MISSING`. Wiring downloads and encodes for series is a
  later pipeline feature.
- **The 12 pre-existing `web` typecheck errors across five pre-GraphQL files.** Unrelated to the
  listing; AC-10 covers only the sixth, `shows`-specific one. Because `next build` typechecks every
  included file and `next.config.ts` sets no `ignoreBuildErrors`, this means `bin/npm web run build`
  still fails after this feature — the gate here is `tsc --noEmit` returning to its 12/5 baseline,
  not a green production build. Clearing those five files is its own change.

## Decided During Specification (plan-level, not requirements)

- The listing query is `shows`, a sibling of `movies`, rather than a parameterized `library(type:)`.
  Rationale: films and series share a lot of *fields* but not a lot of *shape* — `Movie` carries
  `filePath` and `mediaSource`, `Show` carries seasons — and unifying the return type would either
  flatten both into a lowest common denominator or force a union that every consumer has to narrow.
  The dispatch pattern from `006-media-search` stays scoped to search and registration, where the
  operation genuinely is the same operation.
- `Show.status` becomes the `MediaStatus` enum rather than staying nullable or being dropped from the
  contract, so that the column has settled meaning before any feature starts writing it.

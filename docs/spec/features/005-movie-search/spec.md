---
title: Movie Search and Per-User Libraries
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-11
last_updated: 2026-08-11
status: Implemented
services: [api, web]
---

# SPEC: Movie Search and Per-User Libraries (`spec.md`)

> Depends on `003-auth-user-management` and `004-user-disable` having made the app genuinely
> multi-user: before them there was one seeded account and "the library" and "my library" were the
> same thing. This is the first feature that gives a `User` row a relation to anything — `User` is
> an isolated model today.
>
> This is also the first spec written **after** the code it describes. The search slice shipped
> without one; § Context & Goal explains what that means for the requirement checkboxes.

## Context & Goal

Searching a title and registering it is the first stage of the pipeline and the only way a movie
enters the system through the UI, yet it never got a spec. It works today: `searchMovies` in
`services/api/src/movies/movies.service.ts` queries TMDB through `src/clients/tmdb/client.ts`,
translates the wire objects into `MediaSearchResult`, fires a best-effort write of each result into
Redis under `tmdb:movie:<tmdbId>` with a 24-hour TTL, and returns immediately; `addMovie` reads that
cached record back and creates the `Movie` row from it. The root `CLAUDE.md` still describes this
stage as *"in progress, does not compile"* and points at `src/clients/TMDBClient.ts` and
`src/movies/movies.search.ts`, neither of which exists anymore. Part of what this feature does is
simply write down what is already true and flip that pipeline row to **working**. Requirements that
describe existing behaviour are marked as such in-line, so a reader can tell a retro-spec of shipped
code from new work.

The rest is new work, and it is the consequence of the app having become multi-user. Right now
`Movie` has no relation to `User` at all, `MoviesResolver` carries no auth decorator beyond the
global `JwtAuthGuard`, and the `movies` query returns every row in the table to whoever asks. That
is a single global collection wearing a multi-user login. This feature keeps the movie itself
global — `Movie.tmdbId` stays `@unique` across the whole system, so the same film is never
registered twice and never downloaded twice — and introduces a join between `User` and `Movie` to
record *whose library it is in*. One movie, many owners. The consequence that makes this worth
doing rather than merely correct: because the row is shared, its download state is shared too. If
one user is already downloading a film and a second user adds it, the second user sees it as
`DOWNLOADING` the instant they add it, and no second torrent is ever queued.

The third piece is the search screen itself. `SearchInput.tsx` renders a submit button styled with
`bg-primary`, but `web`'s Tailwind 4 theme only defines `--color-brand-*` — the class emits nothing,
so the button is a transparent rectangle with white text and the user cannot see it. `SearchContainer.tsx`
calls `router.push('/movies/<id>')` the moment an add succeeds, which throws the user out of their
search results whether or not that is where they wanted to go. And every result carries an "add"
button, including films already sitting in the user's own library, so the only way to find out that
you already have something is to add it again. All three are fixed here: a visible button, an add
that leaves you where you are and turns into **"Ir"**, and a result that already knows whether you
own it.

### The part that is not obvious

Two of the three GraphQL changes are invisible to a typechecker. `movies` and `addMovie` keep their
exact signatures and change only what they mean — `movies` narrows from "everything" to "mine", and
`addMovie` gains a side effect. There is no codegen between `api` and its consumers
(`docs/spec/graphql-contract.md`), so `web` will compile, run, and quietly return the wrong set of
movies if the two sides disagree about when that narrowing happened. That is the single highest-risk
part of this feature and the reason NFR-2 exists.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Search is specified)** *(existing behaviour — no code change expected)*: A signed-in
      user must be able to search the external catalog by title and get back a list of candidate
      films, each with enough to recognise it: title, year, poster, overview, original language.
      A blank or whitespace-only query must return an empty list without any network call. Each
      result must be recorded, keyed by its catalog id, for long enough that the user can act on it
      later, and recording it must never delay or fail the search response.
- [x] **REQ-2 (An expired cache must not break the add)**: When the user registers a film whose
      cached record is gone — expired past its TTL, evicted, or lost because the best-effort write
      in REQ-1 silently failed — the system must fetch the film from the catalog and register it
      anyway. The current behaviour, refusing with `La película X no está en cache. Volvé a
      buscarla.`, must stop happening; that string is removed. Only a film the catalog itself does
      not know about may be refused (see § Errors).
- [x] **REQ-3 (One shared catalog row, many owners)**: A film must exist exactly once in the system
      no matter how many users want it. Registering a film that is already registered must not
      create a second row, must not queue a second download, and must not overwrite anything about
      the existing row — it must only record that this user now has it too.
- [x] **REQ-4 (The library belongs to the user)**: The movie library a user browses must contain
      exactly the films that user has registered. A user must never see another user's films in
      their own library, and this must hold at the API, not only in the UI.
- [x] **REQ-5 (Download state is shared, deliberately)**: Because the film is one row, its status,
      its download source and its encode jobs are common to everyone who has it. A user who
      registers a film another user is already downloading must see the real current state
      immediately — not `MISSING`, and not a fresh download of something already in flight.
- [x] **REQ-6 (Acting on a film requires having it)**: Attaching a release or a magnet to a film
      must be refused when the caller does not have that film in their library. A user must not be
      able to start or replace a download on a film they never registered.
- [x] **REQ-7 (Registering must not hijack navigation)**: After registering a film from the search
      screen, the user must stay on the search screen with their results still on the page. The
      button on that result must become a **"Ir"** affordance, so going to the film's page is a
      decision the user makes, not one made for them. Registering several films from one search
      must be possible without searching again.
- [x] **REQ-8 (What I already have never offers to be added)**: Each search result must state
      whether the caller already has that film, and the screen must show **"Ir"** for those from
      the very first render — the user must never be offered "add" for something already in their
      library. A film that exists in the system but belongs only to *other* users is not in the
      caller's library and must still offer to be added; adding it is what REQ-3 describes.
- [x] **REQ-9 (The search button is visible)**: The search form's submit control must be visible
      and usable in both light and dark themes.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (The migration must not empty everybody's library)**: The migration that introduces
      the user↔movie link must attach every pre-existing film to the seeded administrator, and must
      do so without reading `.env` — the administrator is identified from the database itself, as
      the oldest enabled admin. Shipping the link table without that backfill leaves every existing
      installation with an empty library and no way to get it back short of re-adding each film by
      hand.
- [x] **NFR-2 (Two operations change meaning without changing shape)**: `movies` and `addMovie` keep
      identical signatures and change semantics. `web` retypes the schema by hand and nothing checks
      it, so neither change can be discovered by compiling. Both must be recorded in
      `docs/spec/graphql-contract.md` as a cross-cutting rule, not left implicit in the SDL.
- [x] **NFR-3 (User principals only)**: Every operation in this feature needs a `userId`, and a
      service principal structurally has none (`auth/auth.types.ts` — the service branch of
      `AuthPrincipal` has no `id` field on purpose). None of these operations may carry
      `@AllowService()`. The worker and the qBittorrent hook do not use them and must not start.
- [x] **NFR-4 (Language)**: Code, comments, identifiers and test descriptions in English; UI copy
      and API exception messages in Spanish (Constitution, Article VI).
- [x] **NFR-5 (These failures are silent by nature)**: One user's library leaking into another's,
      and a backfill that covers only some rows, both produce a perfectly successful response with
      the wrong contents — no exception, no log, nothing to notice. Constitution Article IX applies:
      REQ-4 and NFR-1 must be covered by tests, not by a manual look at the screen.

## GraphQL Contract Delta

Frozen once `status: Approved` (Constitution, Article VIII). No new operations and no new types —
two additive fields plus two changes of meaning.

```graphql
type MediaSearchResult {
  """Id of the Movie row when this film is already registered by anyone; null when it is not."""
  movieId: Int

  """True only when the calling user already has this film in their own library."""
  inLibrary: Boolean!
}

type Query {
  """Unchanged shape. Now returns only the films the calling user has registered."""
  movies: [Movie!]!
}

type Mutation {
  """Unchanged shape. Now also links the film to the calling user."""
  addMovie(tmdbId: Int!): Movie!
}
```

The two fields on `MediaSearchResult` are additive and safe by the rule in
`docs/spec/graphql-contract.md` — an existing consumer that does not select them keeps working. The
two semantic changes are the opposite of safe, and are the whole of NFR-2.

`movieId` and `inLibrary` are separate on purpose rather than collapsed into one nullable id.
`movieId` answers "does this exist in the system", which REQ-3 needs; `inLibrary` answers "is it
mine", which REQ-8 needs. After `003`/`004` those are genuinely different questions, and a single
field would force one of them to be inferred.

**Deliberately not added**: no `removeMovie`/unlink mutation, and no `owners` field on `Movie`
exposing who else has a film. See § Out of Scope.

### Errors

| Condition | GraphQL / HTTP error | Message the user sees |
| :-- | :-- | :-- |
| `addMovie` with a `tmdbId` the external catalog does not know | `NotFoundException` | `No encontramos la película en el catálogo` |
| `addTorrentToMovie` / `addMagnetToMovie` on a film the caller does not have | `NotFoundException` | `La película <id> no existe` |
| Any of these operations called with a service credential | `UnauthorizedException` | `No autenticado` |

`No encontramos la película en el catálogo` **replaces** `La película <id> no está en cache. Volvé a
buscarla.`, which disappears with REQ-2. The old string told the user about an implementation detail
they cannot act on and then asked them to repeat work the system should have done itself.

The second row **reuses an existing string rather than adding one**: `attachTorrentSource` already
answers `La película <id> no existe` for an unknown id, and an unowned film returns the same message
rather than a distinct "no es tuya". This is not enumeration protection — the reasoning
`004-user-disable` gave for *not* hiding a disabled account applies here too, this being a
self-hosted app for a known set of people. It is that the two cases are genuinely the same from the
caller's side: a film outside your library is, as far as anything you can do with it goes, a film
that is not there. Adding a second string would document a distinction the API does not otherwise
make.

`No autenticado` is one of the five strings frozen by `002-auth-login` and is quoted here, not
amended — the global `JwtAuthGuard` already produces it for a service principal on any operation
without `@AllowService()`. This row records the behaviour NFR-3 depends on; it adds nothing.

What `web` does with each: `SearchContainer.tsx` already renders a caught error inline above the
results grid and must render these the same way — the add failure must clear the pending state on
that card and leave the rest of the results untouched. The two `NotFoundException`s reach `web`
through the existing `errors[0].message` path in `src/actions/movies.ts`; `No autenticado` is
already routed to `/login` by `redirectIfUnauthenticated` and needs no new handling.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `UserMovie` (new) | join between `User` and `Movie`: `userId`, `movieId`, `createdAt`; composite primary key on the pair; indexed by `movieId`; both relations `onDelete: Cascade` | — | **Yes** — see NFR-1 |
| `User` | `+ movies UserMovie[]` back-relation | — | No |
| `Movie` | `+ users UserMovie[]` back-relation | — | No |

`Movie.tmdbId` keeps its global `@unique`. That constraint is load-bearing for REQ-3, not
incidental: it is what makes "the same film twice" unrepresentable rather than merely discouraged,
and therefore what makes a duplicate download impossible rather than unlikely.

This is **the first relation `User` has ever had** — it is an isolated model today, which is why
deleting a user has so far had no consequences beyond the row itself. With `Cascade` on the user
side, deleting a user removes their links and never touches the shared `Movie` rows, which is the
right asymmetry: a film another user is downloading must survive the departure of the person who
first asked for it.

The backfill runs in the same migration, immediately after the table is created, as an
`INSERT ... SELECT` over the existing `movies` rows. It resolves its target from the database — the
oldest enabled administrator — rather than from `ADMIN_USER`, because a migration has no access to
`.env` and because the username in `.env` may have been changed since the seed ran. On an
installation with no movies, or with no enabled admin, it inserts nothing and does not fail.

## Acceptance Criteria

- [x] **AC-1**: On `/movies/add`, the search form's submit button is visible against the page
      background and clickable, in both the light and the dark theme.
- [x] **AC-2**: Registering a film from a search result leaves the browser on `/movies/add` with the
      full result list still rendered, and that one card's button now reads `Ir`.
- [x] **AC-3**: Clicking that `Ir` navigates to that film's page at `/movies/<id>`.
- [x] **AC-4**: Running the same search again shows `Ir` on that card on the first render, without
      the card ever having shown an add button.
- [x] **AC-5**: User B searches a film only user A has registered and is offered the add button, not
      `Ir`. After B registers it,
      `bin/mysql -e 'select count(*) from movies where tmdbId = <n>'` returns **1** and
      `bin/mysql -e 'select count(*) from user_movies where movieId = <id>'` returns **2**.
- [x] **AC-6**: With A's copy mid-download, B's `/movies` lists the film with the same status A sees,
      and the qBittorrent WebUI shows no second torrent for it.
- [x] **AC-7 (failure path)**: `bin/cli redis redis-cli del tmdb:movie:<n>`, then registering film
      `<n>` from a still-open search result succeeds and creates the row — no
      `no está en cache` error reaches the screen.
- [x] **AC-8 (failure path)**: On a database that already had movies before this feature, after
      `bin/cli api npx prisma migrate deploy`, `select count(*) from user_movies` equals
      `select count(*) from movies`, every one of those rows points at the oldest enabled admin, and
      that admin's `/movies` shows exactly what it showed before the upgrade.
- [x] **AC-9 (failure path)**: A non-admin user who has registered nothing sees an empty `/movies`
      on that same upgraded database — the pre-existing films are the admin's, not everyone's.
- [x] **AC-10 (failure path)**: Querying `movies` directly against `api` with user B's own token
      returns only B's films, proving REQ-4 holds below the UI and not merely inside it.
- [x] **AC-11 (failure path)**: `addMagnetToMovie` against a film user B has not registered is
      refused with `La película <id> no existe`, and the film's existing download source is
      unchanged afterwards.

## Out of Scope

- **Removing a film from a library.** There is no delete affordance anywhere in the movie UI today,
  and unlinking raises a question this feature does not need to answer — what happens to the shared
  row, its download and its files when the last owner drops it. Adding the link is enough to make
  the library mean something; taking it away is its own feature.
- **Showing who else has a film.** The join table records it and `Movie` could expose it, but
  nothing in the product asks for it, and it is the one part of this design that turns an
  implementation detail into other users' visible activity. Left out until something needs it.
- **Series.** `Show`, `Season` and `Episode` exist in the schema with no module and no GraphQL
  surface — the API is movies-only. The search box already accepts a media type that is threaded
  through the UI and ignored end to end; making it real is a separate feature, not a side effect of
  this one.
- **Paginating search results.** `TmdbClient.search` takes a page argument that nothing passes;
  every search is page one. Fine for finding a film by name, and widening it means designing a
  paging affordance the screen does not have.
- **Per-user download status or progress.** REQ-5 makes the shared state a feature, not a
  limitation. A user who wants a different encode of the same film is a different problem than the
  one this feature solves.
- **Deleting `SearchForm.tsx` and `ResultsForm.tsx`.** Both are dead — unreferenced, broken, and
  between them five of `web`'s twelve typecheck errors. They sit in the directory this feature
  touches, which makes removing them tempting and makes it exactly the kind of helpful expansion
  the process exists to stop. Same for `src/movies/movies.controller.ts`, an unregistered REST
  controller that would violate Constitution Article II if it were ever wired up.
- **The hardcoded `DATABASE_URL` in `prisma.service.ts`.** Known debt, unrelated, and touched by
  nothing here.

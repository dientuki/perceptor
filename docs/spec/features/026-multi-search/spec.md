---
title: Multi Search — One Query Across Films and Series
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-26
last_updated: 2026-08-26
status: Implemented
services: [api, web]
---

# SPEC: Multi Search — One Query Across Films and Series (`spec.md`)

> Builds directly on `006-media-search`, whose `searchMedia(query, type)` / `addMedia(tmdbId, type)`
> pair and per-type service dispatch (`services/api/src/media/`) this feature extends rather than
> replaces. Read § GraphQL Contract Delta and NFR-1 before anything else: the per-type cache
> invariant `006` froze is the thing most likely to be broken here, silently.

## Context & Goal

Searching the catalog today requires the user to have already decided what they are looking for.
`/movies/add` searches TMDB's film collection, `/shows/add` searches its television collection, and
both are the same screen (`services/web/src/components/search/SearchContainer.tsx`) parameterized by
a `type` prop. That is the right shape for the api — one service per media type, each owning its own
catalog endpoint, cache key and Prisma model — but it is the wrong shape for a person who typed
"spider-man" and does not care, at that moment, whether the thing they remember was a film or a
series. They have to guess the type first, and guess wrong half the time.

Meanwhile the header carries a search box that does nothing. `services/web/src/layout/AppHeader.tsx`
renders an input with a ⌘K affordance whose `onSubmit` calls `preventDefault()` and stops — it was
left inert by `025-header-redesign` with the note that wiring it to a real search is its own spec.
This is that spec. Pressing Enter in the header takes the user to a results screen that shows films
and series together, each poster carrying a badge naming which it is, and each card offering the
action that belongs to its own type.

TMDB already serves exactly this: `search/multi` returns films, series **and** people in one
response, each row tagged with a `media_type`. `services/api/src/clients/tmdb/client.ts` has a
generic `search<T>(thing, query)` that can already reach it — what does not exist is anything above
it that splits a mixed response by type, caches each half under the key its own service owns, and
attaches per-caller ownership from two different join tables in one pass. People, collections and
companies are discarded before the user ever sees them: this application has no notion of a person
and registering one is not a thing that can happen.

In the pipeline table of the root `CLAUDE.md`, the *Search catalog (TMDB)* row gains a third entry
point; *Register title in DB* is untouched, since registration still goes through `addMedia` exactly
as it does today. Nothing here finds a release, downloads a byte, or encodes anything.

## Requirements

### Functional Requirements

- [x] **REQ-1 (One search across both types)**: Searching must be possible without naming a media
      type. A single query must return films and series interleaved in one result list, ordered as
      the catalog ranks them — not films first and then series, and not two separate lists.

- [x] **REQ-2 (Unsupported catalog types are discarded, not errors)**: The catalog's mixed search
      returns kinds this application does not model — people above all, and possibly collections or
      companies. Every result that is not a film or a series must be dropped silently before the
      response is built. It is not an error, it does not shorten the search, and it must never reach
      the user in any form.

- [x] **REQ-3 (Every kept result is cached under its own type's key)**: Each film in the response
      must be cached exactly as a film-only search would cache it, and each series exactly as a
      series-only search would. A multi search followed by a registration must behave identically to
      a per-type search followed by the same registration, including when the catalog is unreachable
      by then.

- [x] **REQ-4 (The cached object still contains catalog data only)**: What is written to the cache
      by this search must contain nothing that depends on who asked — the same standing obligation
      `006-media-search` REQ-7 placed on every per-type service. The key is global; a per-caller
      field written into it is served to every other user until it expires.

- [x] **REQ-5 (Each result says whether it is mine, per type)**: Every kept result must carry the
      registered row's id if anyone has registered it, and separately whether the **calling** user
      has it. Those two facts come from a different table for a film than for a series, and both must
      be resolved for a mixed page.

- [x] **REQ-6 (Blank searches never reach the catalog)**: A blank or whitespace-only query must
      return an empty list without contacting the catalog.

- [x] **REQ-7 (The header search is the entry point)**: Submitting the header's search box must take
      the user to a results screen for that query. The query must be part of the address, so the
      screen can be reloaded and the link shared.

- [x] **REQ-8 (The result card keeps its current design plus a type badge)**: The poster, title,
      overview and year keep the layout they have today. A badge is added over the poster naming
      whether the entry is a film or a series, legible against an arbitrary poster image.

- [x] **REQ-9 (Each card acts according to its own type)**: A card's add action must register that
      entry as the type the card itself declares, never as a type chosen by the screen. On one page
      some cards register films and others register series.

- [x] **REQ-10 (An owned entry offers to open it, for both types)**: A result already in the calling
      user's library must offer to go to that title's screen — `/movies/<id>` for a film,
      `/shows/<id>` for a series — instead of offering to add it again. This replaces the
      non-interactive "Agregada" badge series currently get, on **every** search screen, not only the
      new one: `/shows/add` gains the same link.

- [x] **REQ-11 (Adding stays on the results screen)**: Registering from a result must not navigate
      away. That card changes, the rest of the page stays as it is, and a second entry can be
      registered without searching again.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (The cache-ordering invariant is the silent failure here)**: Writing the cache after
      ownership is attached produces a perfectly successful response and poisons a global key for 24
      hours, for every other user, with no error anywhere. `006-media-search` NFR-3 already requires
      each per-type service to assert this in its own suite; this feature adds a **third** path that
      writes those same keys, so it owes the same assertion — over a mixed result set, since that is
      the one place where getting it right for films and wrong for series is possible.

- [x] **NFR-2 (A library leak between users is silent)**: Reporting that this caller owns something
      they do not, or returning another user's rows, is a successful response with wrong contents.
      Caller-scoping must be asserted over a mixed result set, with films and series owned by
      different users.

- [x] **NFR-3 (One search costs one catalog request)**: A mixed search must issue exactly one HTTP
      request to the catalog, not one per type. Ownership enrichment must likewise be bounded — a
      constant number of database queries per page, never one per result.

- [x] **NFR-4 (A malformed or unknown catalog row must not fail the page)**: The catalog's mixed
      response is less uniform than a per-type one — fields differ between a film row and a series
      row, and a future `media_type` value is possible at any time. An unrecognised or incomplete row
      must be dropped like any other unsupported type, never surface as a broken card and never fail
      the whole search.

- [x] **NFR-5 (Not reachable by the service token)**: This is a user operation, like the two it sits
      beside. It must not carry the exemption that lets the worker's or qBittorrent's credential
      through, and must resolve a real user principal.

- [x] **NFR-6 (Badge text is catalog-driven, like every other user-facing string)**: The badge reads
      through `services/web/messages/{en,es}.json`, not a hardcoded literal — `018-ui-i18n` applies
      here with no exception. `en` renders `MOVIE` / `SERIES` as in the attached design; `es` renders
      `PELÍCULA` / `SERIE`.

- [x] **NFR-7 (No breaking change to the existing contract)**: `searchMedia`, `addMedia`,
      `MediaSearchResult` and `MediaRef` keep their names, arguments, fields and semantics.
      `/movies/add` and `/shows/add` keep working unchanged apart from REQ-10's link. `web` has no
      tests, so this is verified by opening both screens, not by a suite.

## GraphQL Contract Delta

Frozen at `status: Approved` (Constitution, Article VIII). Written as it will appear in the
generated `services/api/src/schema.gql`:

```graphql
type Query {
  searchAllMedia(query: String!): [MediaSearchResult!]!
}
```

That is the entire delta. **No new type, no new field, no changed field.** `MediaSearchResult` is
reused exactly as `006-media-search` froze it — `type` already carries `"movie"` or `"show"` as a
plain string, `mediaId` already means "the registered row's id in whatever table `type` names", and
`inLibrary` already means "the caller has it". A mixed result list is a list of those, with more than
one distinct `type` value in it; nothing about the shape needed to change to allow that, which is why
this feature adds a query and not a type.

**A new query rather than making `type` nullable on `searchMedia`.** `searchMedia(query, type)`
resolves a type to one service and delegates the whole operation to it (`MediaDispatchService`,
`services/api/src/media/media-dispatch.service.ts`). A mixed search is the opposite operation: it
fans one catalog response out across every service. Making `type` optional would put a branch inside
the dispatch that AC-16 of `006-media-search` exists to keep out, and would give one field two
meanings on the wire. Two queries, one dispatching and one fanning out, is the smaller change.

**`searchAllMedia` returns films and series only, and this is a contract term, not an
implementation detail.** A consumer may assume `type` is one of the two values it already knows, and
must not be expected to render an unknown one. Adding a third media type later widens this response
by construction — that is intended, and is why the query is not named `searchMoviesAndShows`.

Two rules survive from `006-media-search` and are restated because this feature adds a third code
path that can break them independently:

- **`mediaId !== null` is never an ownership test.** Only `inLibrary` means "mine".
- **The cache write happens before ownership is attached, always** — the object handed to the cache
  is catalog-only.

### Errors

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `query` is blank or whitespace only | none — `[]` returned, catalog not contacted | (no message; the empty state renders) |
| The catalog returns a `media_type` that is not a film or a series | none — that row is dropped | (no message; the row simply is not there) |
| A row is missing fields the result shape requires | none — that row is dropped (NFR-4) | (no message) |
| `movie_db_api_key` unset, or TMDB unreachable / non-2xx | generic `Error` raised by `TmdbClient` | the catalog's own text, as `searchMedia` surfaces it today |
| Every kept result is filtered out, or the catalog matched nothing | none — `[]` returned | `No se encontraron resultados` (the existing `search.container.resultsEmptySearched`) |

**No new `ERROR_KEYS` entry is added.** Registration errors are unchanged — a card's add action calls
the existing `addMedia`, so `error.media.unsupported_type`, `error.movie.not_in_catalog` and
`error.show.not_in_catalog` reach the user exactly as they do from `/movies/add` today, translated
through `translateGraphQLError`.

What `web` does with each: a failed `searchAllMedia` leaves the results list untouched and renders an
inline error (`search.container.errorSearch`); a failed add re-enables that card's button and renders
an inline error whose noun follows **that card's** type, not the screen's. Errors render inline,
never through `alert()`.

## Data Model Changes

**None.** No Prisma model, field, enum or migration. Registration still goes through `addMedia`,
which writes `movies`/`user_movies` and `shows`/`user_shows` exactly as it does today.

Redis is untouched as a contract too: this search writes the existing `tmdb:movie:<id>` and
`tmdb:show:<id>` keys with the existing 24-hour TTL and the existing catalog-only object shape. It
introduces no third key namespace — a `tmdb:multi:<query>` cache is explicitly out of scope below.

## Acceptance Criteria

- [x] **AC-1**: Given a signed-in user anywhere in the dashboard, when they type `spider-man` into
      the header search box and press Enter, then they land on a results screen whose address
      contains that query, showing both films and series in one grid.

- [x] **AC-2**: Reloading that address, or opening it in a new tab, renders the same results without
      retyping the query.

- [x] **AC-3**: In those results, every card shows a badge over its poster reading `PELÍCULA` or
      `SERIE` under the `es` locale and `MOVIE` or `SERIES` under `en`, matching the card's own type.

- [x] **AC-4** *(failure path — the discard rule)*: Given a query whose catalog response contains
      people (`spider-man` returns actors), when the results render, then **no** card corresponds to
      a person: every card is a film or a series, and the response carries no `type` value other than
      `movie` and `show`.

- [x] **AC-5**: Given a film result that is not yet registered, when the user clicks add, then
      `bin/mysql -e 'select count(*) from movies where tmdbId = <n>'` returns **1** and
      `user_movies` grows by exactly 1. Given a series result on the **same page**, the same click
      grows `shows` and `user_shows` instead — the film's tables are untouched.

- [x] **AC-6**: After the click in AC-5, the page has not navigated, that card no longer offers to
      add, and a second result on the same page can still be added.

- [x] **AC-7**: `bin/cli redis redis-cli get tmdb:movie:<tmdbId>` and
      `bin/cli redis redis-cli get tmdb:show:<tmdbId>` both return a JSON object after a mixed
      search, and **neither** contains `inLibrary` **nor** `mediaId`.

- [x] **AC-8**: Given a film and a series the calling user already has, when they appear in a mixed
      search, then both render `Ir`, linking to `/movies/<id>` and `/shows/<id>` respectively, and
      both links resolve to that title's detail page.

- [x] **AC-9** *(the change reaches the old screen too)*: Given the same owned series on
      `/shows/add`, then it renders `Ir` linking to `/shows/<id>` rather than a non-interactive
      `Agregada` badge.

- [x] **AC-10** *(caller scoping)*: Given user A has registered a film and a series, when user B runs
      the same mixed search, then both entries offer `Agregar` to B and neither reports as owned —
      while `movies`/`shows` still hold exactly one row each.

- [x] **AC-11** *(failure path)*: Given `movie_db_api_key` is cleared in Settings, when a mixed
      search is submitted, then the results list is left untouched, an inline error renders, and the
      page stays usable — no unhandled error screen, no `alert()`.

- [x] **AC-12** *(failure path)*: Submitting the header search with an empty or whitespace-only query
      contacts the catalog zero times — verifiable in `docker compose logs api` — and renders the
      empty state rather than an error.

- [x] **AC-13**: `bin/npm api test` passes, with the cache-before-enrich ordering (NFR-1) and the
      caller-scoping (NFR-2) asserted over a **mixed** result set, in a suite whose header comment
      names the silent failure it defends against (Constitution, Article IX).

- [x] **AC-14**: `bin/cli api npx --no tsc --noEmit` and `bin/cli web npx --no tsc --noEmit` report
      the same error counts as before the feature, and `bin/npm web run build` exits 0.

- [x] **AC-15** *(no contract regression)*: `grep -n "searchMedia\|addMedia" services/api/src/schema.gql`
      still shows both with their existing arguments, and `/movies/add` behaves exactly as before —
      search, add, `Ir` link, a film another user registered still offering `Agregar`.

## Out of Scope

- **Removing `/movies/add` and `/shows/add`.** Both stay, unchanged apart from AC-9's link. They are
  the per-type entry points and remain reachable; deciding whether the multi search eventually
  replaces them is a later decision made with usage in hand, not now.

- **A third media type.** `searchAllMedia` returns films and series because those are the two types
  that exist. Nothing here may be shaped around a hypothetical third one — no provider abstraction,
  no widened result fields, no configuration of which types the mixed search includes.

- **Caching the query itself.** Only individual entries are cached, under the keys that already
  exist. A `tmdb:multi:<query>` cache would need an invalidation story and buys nothing measured.

- **Pagination and infinite scroll.** `TmdbClient.search` already accepts a `page` argument nothing
  passes; still true after this feature. The mixed search returns the catalog's first page.

- **Typeahead, suggestions, and the ⌘K palette.** The header box submits on Enter and nothing else.
  The `⌘K` hint it already renders focuses the input — turning it into a command palette with
  as-you-type results is a different feature with a different cost.

- **Filtering or sorting the results.** No "only films" toggle, no sort control. The catalog's own
  ranking is the order, which is the point of REQ-1.

- **Searching the user's own library.** This searches the catalog, exactly like the two screens it
  joins. A search over already-registered titles reads from the database, has different rules about
  who can see what, and is its own spec.

- **Acquiring anything from a result.** No torrent search, no magnet paste, no upload from the
  results screen — an entry is registered, and acquisition happens on the title's own screen as it
  does today.

## Decided During Specification (plan-level, not requirements)

Nothing below is a requirement, and none of it constrains what the feature must *do*. It is recorded
because it was settled while writing this document and re-deriving it in `/plan-feature` risks
landing somewhere else for no reason. If any of it turns out to be wrong, say so rather than quietly
substituting a different shape.

**The mixed search must reuse the per-type services, not reimplement them.** The two things that go
wrong silently — the cache-before-enrich ordering and the caller-scoped ownership lookup — already
exist, correct and tested, inside `MoviesService` and `ShowsService`. A `searchAllMedia` that maps,
caches and enriches the TMDB rows itself would be a third independent copy of both invariants, which
is exactly the failure mode `006-media-search` NFR-3 describes. The catalog call is what is shared
(one request to `search/multi`); splitting its rows by `media_type` and handing each subset to the
service that owns that type is what keeps the invariants in one place per type.

**That implies one addition to `MediaTypeService`** (`services/api/src/media/media-type.interface.ts`),
since the interface today only exposes `search(query, userId)` — a whole-operation method that owns
its own catalog call. The new method takes already-fetched catalog rows and performs the same
cache-then-enrich the service does internally. Keep it to one method; the interface is the boundary
`006` deliberately kept at two, and this makes it three, not seven.

**`web`: the results screen is a new route under `(dashboard)`, reading its query from the address.**
It reuses `MediaList`/`MediaCard` rather than forking them, and its per-card action reads
`item.type` — which is precisely the seam `SearchContainer`'s existing
`addAction: (id, type) => Promise<string>` prop was built for. Whether the new screen reuses
`SearchContainer` with a nullable `type` or is a sibling component is a plan-level call; what must
not happen is a second copy of `MediaCard`.

**The badge lives in `MediaCard`, driven by the card's own type, and renders only when asked for.**
`/movies` and `/shows` pass rows through the same component and must not grow a badge that says the
same thing on every card of a single-type grid.

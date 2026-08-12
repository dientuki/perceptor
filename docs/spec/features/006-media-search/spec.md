---
title: Media Search and Registration, Parameterized by Media Type
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-12
last_updated: 2026-08-12
status: Implemented
services: [api, web]
---

# SPEC: Media Search and Registration, Parameterized by Media Type (`spec.md`)

> Depends on `003-auth-user-management` (there is a `User` to own anything at all) and on
> `005-movie-search`, whose search-cache-enrich pipeline this feature **generalizes and replaces**.
> `searchMovies` and `addMovie` cease to exist. Read § GraphQL Contract Delta and NFR-1 before
> anything else.

## Context & Goal

Perceptor's MVP was built movies-first, and that decision leaked into the names of operations that
were never really about films. The system's subject is *media*: a movie, a series, and — some day —
whatever else a catalog can describe. Almost every layer already knows this. `MediaSearchResult`
carries a `type` field, deliberately a plain string so `web` can compare it by value.
`services/api/src/clients/tmdb/client.ts` maps `MEDIA_TYPE` to a TMDB path segment through a
`Record`, dispatches `details()` through a `mappers` object keyed by the same constant, and its
`SHOW` mapper is written and complete. `services/web/src/components/search/SearchContainer.tsx`
declares `addAction: (id: number, type: MediaType) => Promise<string>`, and
`services/web/src/actions/movies.ts`'s `addMovie` **already accepts that `type` argument and
ignores it entirely**. `MediaList`, `MediaCard` and `SearchInput` all already branch on media type
for their copy and their links.

What is missing is not parameterization *inside* the film code. `MoviesService` hard-coding
`this.tmdb.search<TmdbMovie>('movie', query)` is correct and stays: it is the film service, and its
catalog endpoint is a fact about films, not a variable. What is missing is a layer above it that
turns a media type into a choice of service, and a sibling next to it that hard-codes `'tv'` the
same way and knows the things only series know. The word "movie" leaked upward out of that service
into names that were never about films — `searchMovies`, `addMovie`,
`MediaSearchResult.movieId` — and adding series by writing a parallel `searchShows`/`addShow` pair
would push it up a second time instead of pulling it back down, guaranteeing a third copy the day a
third media type arrives.

So this feature does two things at once, because doing them separately means deliberately writing
the shape we already know is wrong. It replaces `searchMovies`/`addMovie` with a single pair of
operations that take the media type as an argument and dispatch it to the service that owns that
type, where the pair `(type, mediaId)` is what identifies a registered item — `type` says which
service and therefore which table, `mediaId` says which row. And it lands `show` as the second type:
searching TMDB's television catalog, registering a series into a per-user library, and filling in
its seasons and episodes from the catalog afterwards.

The point of one service per media type is that each one absorbs its own peculiarities instead of
pushing them into shared code. Registering a series fetches seasons and episodes; registering a
film does not. Series live in `shows`/`seasons`/`episodes`; films live in `movies`. Those are not
branches of one algorithm to be selected by a flag — they are two implementations of the same short
contract, and keeping them apart is what stops the api from accumulating conditionals as types are
added.

One scoping note, stated so nobody designs against it later: what is genuinely shared across the two
types today is **their catalog provider**. `posterUrl`, `originalLanguage`, `releaseDate` and
`overview` line up across movie and tv because both come from TMDB. Music would arrive from a
different provider with a different shape; it would be a third service implementing the same
contract, and it would be free to fetch from somewhere else entirely — but nothing here is designed
for it, because there are no music requirements to design against.

In the pipeline table of the root `CLAUDE.md`, the *Search catalog (TMDB)* and *Register title in
DB* rows grow from films to films **and** series. No other row changes status: nothing here finds a
release, downloads a byte, or encodes anything.

## Requirements

### Functional Requirements

- [x] **REQ-1 (One search operation, parameterized by media type)**: Searching the catalog must be a
      single operation that takes the media type as an argument, not one operation per type. A media
      type the system does not support must be refused with an explicit error, never silently
      treated as a default.

- [x] **REQ-2 (One registration operation, parameterized the same way)**: Registering a catalog
      entry into the caller's library must likewise be a single operation taking the media type. It
      must report back enough to identify what it created: which row, and of which type.

- [x] **REQ-3 (`type` plus `mediaId` identify a registered item)**: A search result must carry both.
      `type` says which kind of media it is and therefore where the row lives; `mediaId` says which
      row, or is null when nothing is registered. Neither is meaningful without the other.

- [x] **REQ-4 (Series are searchable and registrable)**: `show` must be a supported media type end
      to end — searched against the catalog's **television** collection, and registered into the
      caller's library. `movie` must keep behaving exactly as it does today, through the new
      operations.

- [x] **REQ-5 (Blank searches never reach the catalog)**: A blank or whitespace-only query must
      return an empty list without contacting the catalog, for every media type.

- [x] **REQ-6 (Every result is cached)**: Each entry returned by a search must be stored in the
      shared cache under a key derived from its media type and catalog id, with a time-to-live.
      Caching must never delay the response and must never be able to fail the request: a cache that
      is down produces a slower next registration, not a failed search.

- [x] **REQ-7 (The cached object contains catalog data only)**: What is written to the cache must
      contain nothing that depends on who asked. The key is global and is read by every user who
      later searches the same entry; a per-caller field written into it is served to everybody else
      until it expires.

- [x] **REQ-8 (One catalog entry, one row)**: A given catalog id must be representable exactly once
      per media type. Registering something another user already registered must not create a
      second row and must not re-fetch anything — it must only record that this user has it too.

- [x] **REQ-9 (The user link lives on the top-level item)**: Ownership must be recorded as a link
      between a user and the top-level media item — a film, a **series**. Seasons and episodes must
      have no notion of a user. This is what makes a download visible to every owner: because there
      is one shared season and episode row rather than one per user, a status change made on behalf
      of one user is, by construction, the status the others read.

- [x] **REQ-10 (Registering is idempotent)**: The same user registering the same entry twice — a
      double-clicked button, a retried request — must succeed both times and leave exactly one link.

- [x] **REQ-11 (A result says whether it is mine)**: Each search result must report whether the
      **calling** user already has it, separately from whether anyone has registered it. Those are
      two different facts: something registered by somebody else is still addable by this caller,
      and adding it only links them.

- [x] **REQ-12 (Registering a series fetches its seasons and episodes)**: Registering a series must
      result in every season the catalog lists being stored, and for each of those seasons every
      episode with its number, title, overview and air date. A season numbered `0` (specials, OVAs)
      is stored like any other; it is not filtered out. Registering a film fetches nothing extra —
      the per-type difference is part of the design, not an exception to it.

- [x] **REQ-13 (Fetching them does not block the user)**: Registration must report success without
      waiting for the seasons and episodes. While they are being fetched the user must be able to
      keep searching and to register something else.

- [x] **REQ-14 (An incomplete fetch is recoverable)**: A series whose seasons and episodes did not
      finish loading must be distinguishable, in the database, from one that did. Registering that
      same series again must retry the fetch rather than assume it is done.

- [x] **REQ-15 (One search screen, not one per type)**: The search screen must be the existing one,
      parameterized by media type. A second, duplicated search UI is a defect, not an
      implementation choice. Its user-facing copy — placeholder, empty state, error text — must
      follow the type rather than say "película" on a series screen.

- [x] **REQ-16 (After registering, the action stops offering to add)**: Once an entry has been
      registered from a search result, that result's action must no longer invite the user to add it
      again. For a film it keeps linking to that film's screen; for a series it links nowhere,
      because this feature ships no screen for a single series.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Two breaking changes, one loud and one silent — only the silent one is dangerous)**:
      There is no codegen across the `api`/`web` seam (Constitution, Article VIII), so this feature's
      two contract breaks fail in opposite ways. **Removing `searchMovies`/`addMovie` fails loudly**:
      a consumer still asking for them gets `Cannot query field "searchMovies"` on the very first
      call, impossible to miss. **Renaming `MediaSearchResult.movieId` to `mediaId` fails silently**:
      both sides compile, the field arrives `undefined`, and every already-owned film quietly loses
      its "Ir" link with no error anywhere. Both must land in this feature; the verification effort
      belongs on the rename, which is where nothing will tell you.

- [x] **NFR-1b (`movieId` is three unrelated things sharing a name)**: The identifier appears 21
      times in `services/web/src` and only three of those are the search-result field. The other two
      meanings must **not** be renamed: `movieId` as a **mutation argument** (`addTorrentToMovie`,
      `addMagnetToMovie`, `createUploadTicket`) and as the **tus upload metadata key**; and
      `MediaSource.movieId`, which is a different GraphQL type read by `worker` in
      `services/worker/src/jobs/source-ready.job.ts` — renaming it breaks the download pipeline
      silently, for a feature that touches no download. The Prisma columns (`user_movies.movieId`,
      `source_files.movieId`, `process_jobs.movieId`) are likewise untouched. A rename applied by
      matching the string rather than the meaning is the expected failure mode here.

- [x] **NFR-2 (Films must keep working, and nothing will remind you to check)**: Every film-side
      behaviour `005-movie-search` shipped — per-user scoping, the `Ir` link, idempotent linking,
      the cold-cache fallback — must survive the move to the generalized operations. `web` has no
      tests (`services/web/CLAUDE.md`), so the film path is verified by opening `/movies/add`, not
      by a suite.

- [x] **NFR-3 (A library leak between users is silent)**: Returning another user's items, or
      reporting `inLibrary` for something this caller does not have, produces a perfectly successful
      response with the wrong contents — no exception, no log, nothing to notice. Constitution
      Article IX therefore requires tests over the caller-scoping and over the ordering in REQ-7,
      built the way `services/api/src/movies/movies.service.spec.ts` is built, and asserted
      **separately in each media type's own suite**. This is the one real cost of one service per
      type: the cache-before-enrich ordering is an invariant every implementation must satisfy
      independently, so it is exactly the kind of thing that stays correct in the film service and
      is written backwards in the series service, with nothing failing. It is not enough to have
      tested it once in `005-movie-search`.

- [x] **NFR-4 (Background work fails where nobody is looking)**: The season/episode fetch of REQ-13
      runs detached from the request that triggered it, so its failure reaches no caller and no HTTP
      status. It must log its failure and must leave the persistent mark REQ-14 depends on. A design
      in which a failed fetch is indistinguishable from a series that genuinely has no seasons is
      rejected.

- [x] **NFR-5 (Two users registering the same series at once must not fetch it twice)**: Concurrent
      registrations of the same catalog id must result in one fetch, not one per caller. The
      atomic-claim pattern already exists in `services/api/src/uploads/upload-tickets.service.ts`.
      Writes must in any case be idempotent, so that a lost race corrupts nothing.

- [x] **NFR-6 (One series costs 1 + N catalog requests)**: A twenty-season series is twenty-one HTTP
      requests to TMDB. They must be issued sequentially rather than concurrently: TMDB rate-limits,
      and a burst that trips the limit turns a slow registration into a failed one.

- [x] **NFR-7 (Neither new operation is reachable by the service token)**: `searchMedia` and
      `addMedia` are user operations. Neither carries the exemption that lets the worker's or
      qBittorrent's credential through; both must resolve a real user principal.

- [x] **NFR-8 (The migration runs against an empty table)**: `shows` has no rows in any
      installation — the models were never reachable. The new join therefore needs no backfill,
      unlike the one `005-movie-search` added to `movies`. The migration must still be generated
      through `bin/npm api run prisma:migrate` (Constitution, Article III), never hand-written SQL.

## GraphQL Contract Delta

Frozen at `status: Approved` (Constitution, Article VIII). Written as it will appear in the
generated `services/api/src/schema.gql`:

```graphql
type MediaRef {
  id: Int!
  type: String!
}

type MediaSearchResult {
  id: Int!
  title: String!
  releaseDate: String
  posterUrl: String
  originalLanguage: String!
  overview: String
  type: String!
  status: String
  mediaId: Int          # renamed from movieId — the registered row's id, in the table `type` names
  inLibrary: Boolean!
}

type Query {
  searchMedia(query: String!, type: String!): [MediaSearchResult!]!
  # searchMovies(query: String!): [MediaSearchResult!]!   REMOVED
}

type Mutation {
  addMedia(tmdbId: Int!, type: String!): MediaRef!
  # addMovie(tmdbId: Int!): Movie!                        REMOVED
}
```

Everything else in the schema is untouched. `movies`, `movie(id)`, `addTorrentToMovie` and
`addMagnetToMovie` keep their names, arguments and semantics — only the two catalog operations move.

**`type` is a `String!`, not a GraphQL enum**, on the argument as it already is on the field. The
schema contains no enum and no union today, and an enum would put `MOVIE` on the wire while
`MEDIA_TYPE` holds `"movie"` in both services — a mapping layer bought for nothing. The cost is that
validation is the resolver's job: an unsupported type must produce the explicit error below, never a
silent fallback to films.

**`tmdbId` keeps its provider-specific name**, even though a non-TMDB media type would make it
wrong. Renaming a field across this seam has a measured cost of about eight lines; paying it now,
speculatively, buys less than naming the argument accurately for the only provider that exists.

**`addMedia` returns `MediaRef`, not the created row.** A polymorphic return would need a GraphQL
union and hand-written inline fragments in `web`, with no codegen to check them. `web` only ever
used the `id` from `addMovie`'s response, so `{ id, type }` is what the caller actually needs — and
`type` is there so the caller can route without re-deriving it.

Two rules survive from `005-movie-search` and must be restated rather than assumed:

- **`mediaId !== null` is never an ownership test.** Only `inLibrary` means "mine". Something
  somebody else registered has a non-null `mediaId` and is still addable by this caller — that add
  only links them, it never re-fetches or re-downloads anything.
- **The cache write happens before ownership is attached, always.** `searchMedia` must hand the
  cache a catalog-only object and only then compute `mediaId`/`inLibrary` for the caller. This is a
  standing contract obligation on **every** per-type service, present and future — each one
  implements it separately, so each one can break it separately (NFR-3).

### Errors

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `query` is blank or whitespace only | none — `[]` returned, catalog not contacted | (no message; the empty state renders) |
| `type` is not a supported media type | `BadRequestException` | `Tipo de medio no soportado: <type>` |
| `movie_db_api_key` unset, or TMDB unreachable / non-2xx | generic `Error` raised by `TmdbClient` | the catalog's own text, as `searchMovies` surfaces it today |
| `addMedia` for a `tmdbId` the catalog does not know, with nothing in cache | `NotFoundException` | `No encontramos la película en el catálogo` / `No encontramos la serie en el catálogo`, per `type` |
| The season/episode fetch fails after a series was registered | none — the mutation already returned | (no message; the series is registered, its seasons are not — see REQ-14) |

The catalog-miss message stays per-type rather than becoming a generic "medio": it is the string the
user reads, and `005-movie-search` already ships the film wording. Each per-type service therefore
owns its own copy of that string, next to its own catalog endpoint — there is no shared table of
messages to keep in sync. Only `Tipo de medio no soportado` belongs above the services, because it
is raised when no service was found at all.

What `web` does with each: a failed `searchMedia` leaves the results list untouched and renders an
inline error; a failed `addMedia` re-enables that card's button and renders an inline error. Both
strings must be media-type aware — `SearchContainer.tsx` today hard-codes
`No se pudo agregar la película.` and the empty state `Buscá una película para empezar`, which are
wrong on a series screen (REQ-15). Errors render inline, never through `alert()`.

## Data Model Changes

Owned by `api` (Constitution, Article III).

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `UserShow` | **New.** Join of `userId` / `showId`, composite `@@id([userId, showId])`, `@@index([showId])`, both relations `onDelete: Cascade`, `@@map("user_shows")` | — | No — `shows` is empty everywhere |
| `User` | New relation field `shows UserShow[]` | — | No |
| `Show` | New relation field `users UserShow[]` | — | No |
| `Show` | New field `seasonsSyncedAt DateTime?` | nullable, `null` | No |

`Show.tmdbId` keeps its existing global `@unique`, matching `Movie.tmdbId`. That constraint is what
makes REQ-8 an impossibility rather than a convention: "the same series twice" cannot be written
down, so no code path has to remember not to.

`UserShow` mirrors `UserMovie` field for field on purpose — one join table per media type, rather
than one polymorphic `UserMedia(userId, type, mediaId)`. A polymorphic join would drop the foreign
key, which is the only thing that guarantees a link points at a row that exists; the parameterization
this feature is about belongs in the service layer, not in the schema. The alternative of hanging
ownership off `Season` so a user could own "seasons 1–3" is rejected outright by REQ-9, and is what
would break the shared-status property the whole design rests on.

`seasonsSyncedAt` is the persistent mark NFR-4 demands and the condition REQ-14 tests. It is set
only when every season and every episode of a series has been written; it stays `null` if any part
of the fetch failed, which is also its value for a series that has never been fetched. Those two
cases are deliberately not distinguished — both mean "not known to be complete", and both are
answered by retrying.

`Show.status` stays the catalog's own string (`"Returning Series"`, `"Ended"`), which is what it
already is in the schema. It is **not** converted to `MediaStatus`, and no consolidated download
status is derived for a series here — see § Out of Scope.

## Acceptance Criteria

- [x] **AC-1**: Given a signed-in user on `/shows/add`, when they search `breaking bad`, then the
      results are television series — the search box reads `Buscar serie...`, the empty state and any
      error text say "serie", and the results are not films.

- [x] **AC-2** *(films still work)*: Given the same user on `/movies/add`, when they search and add a
      film, then the behaviour is identical to before this feature: the card switches to `Ir`
      linking to `/movies/<id>`, a film already in their library shows `Ir` on the first render, and
      a film only another user registered still shows `Agregar`.

- [x] **AC-3**: After a series search, `bin/cli redis redis-cli get tmdb:show:<tmdbId>` returns a
      JSON object that contains **neither** `inLibrary` **nor** `mediaId`. The same holds for
      `tmdb:movie:<tmdbId>` after a film search.

- [x] **AC-4**: Given a series search, when the user clicks `Agregar` on a result, then
      `bin/mysql -e 'select count(*) from shows where tmdbId = <n>'` returns **1** and
      `bin/mysql -e 'select count(*) from user_shows'` grows by exactly **1**.

- [x] **AC-5**: Given user A already added that series, when user B adds the same one, then
      `select count(*) from shows where tmdbId = <n>` still returns **1** and
      `select count(*) from user_shows where showId = <id>` returns **2**. In A's search the result
      shows as already owned; in a third user C's search it still offers `Agregar`.

- [x] **AC-6**: Within seconds of AC-4, `select count(*) from seasons where showId = <id>` and
      `select count(*) from episodes e join seasons s on e.seasonId = s.id where s.showId = <id>`
      match the season and episode counts TMDB reports for that series, and
      `select seasonsSyncedAt from shows where id = <id>` is no longer `NULL`.

- [x] **AC-7**: Given a series whose catalog entry includes specials, when it is registered, then
      `select count(*) from seasons where showId = <id> and seasonNumber = 0` returns **1**.

- [x] **AC-8**: Given the series search results, when the user clicks `Agregar`, then that button is
      disabled while the mutation is in flight and afterwards no longer offers to add and is not a
      link; the page stays usable and a second series can be added without reloading.

- [x] **AC-9** *(failure path)*: `addMedia(tmdbId: <any>, type: "music")` returns exactly
      `Tipo de medio no soportado: music` and writes nothing. The same holds for `searchMedia`.

- [x] **AC-10** *(failure path)*: Given `bin/cli redis redis-cli del tmdb:show:<n>` has removed the
      cached entry, when the user adds that series, then it registers correctly anyway — the catalog
      is re-queried for that one entry. Same for a film with `tmdb:movie:<n>`.

- [x] **AC-11** *(failure path)*: When `addMedia` is called with a `tmdbId` the catalog does not
      know, then the GraphQL error message is exactly `No encontramos la serie en el catálogo` for
      `type: "show"` and `No encontramos la película en el catálogo` for `type: "movie"`, and no row
      is written.

- [x] **AC-12** *(failure path)*: Given `movie_db_api_key` is cleared in Settings after a search
      populated the cache, when the user adds a series from those cached results, then the row
      appears in `shows` with `seasonsSyncedAt` still `NULL`, `docker compose logs api` shows the
      fetch failure, and a second `addMedia` for that same series triggers the fetch again instead
      of treating it as done.

- [x] **AC-13** *(rename regression)*: `grep -n "movieId" services/web/src/types/search.ts
      services/web/src/components/search/SearchContainer.tsx` returns nothing, while
      `grep -rn "movieId" services/web/src` still returns the mutation arguments and the upload
      metadata key untouched (NFR-1b). `grep -n "movieId" services/api/src/schema.gql` no longer
      shows it inside `type MediaSearchResult` and **still** shows it inside `type MediaSource` and
      on the three mutations.

- [x] **AC-14** *(removal regression)*: `grep -rn "searchMovies\|addMovie" services/web/src
      services/worker/src` returns nothing, and `grep -n "searchMovies\|addMovie"
      services/api/src/schema.gql` returns nothing — while `addTorrentToMovie`, `addMagnetToMovie`
      and `movies`/`movie` are all still present.

- [x] **AC-15**: `bin/npm api test` passes, with the cache-ordering and caller-scoping cases
      asserted in **each** per-type service's own suite — the existing film one plus a new series
      one whose header comment names the silent failure it defends against (Constitution, Article
      IX). `bin/cli api npx --no tsc --noEmit` reports the same error count as before the feature.

- [x] **AC-16** *(the dispatch stays thin)*: Grepping the file that turns `type` into a service for
      `season`, `episode`, `tmdb`, `'tv'` or `prisma` returns nothing — the only media-type-specific
      thing in it is the lookup table itself. Adding a third type is a new service plus one entry in
      that table, with no edit to the dispatching logic.

## Out of Scope

- **A library list at `/shows` and a detail screen at `/shows/[id]`.** No `shows` or `show(id)`
  query exists in the delta above, and `MediaRef` deliberately does not carry enough to render one.
  This feature ends at "the series and its episodes are in the database"; showing them back is the
  obvious next feature and needs its own contract.

- **The four copied files that are not the search screen** — `app/(dashboard)/shows/page.tsx`,
  `app/(dashboard)/shows/[id]/page.tsx`, `components/Shows/Shows.tsx` and
  `components/Shows/Movie.tsx`. They are untracked copies of their Movies counterparts and this
  feature does not touch, fix, delete or commit them, by explicit decision. The consequence is
  recorded rather than hidden: `shows/page.tsx` imports `@/components/movies/Shows`, which does not
  exist, so `bin/npm web run build` keeps failing on that file until a later feature deals with
  them. Only `app/(dashboard)/shows/add/page.tsx` is in scope.

- **Any third media type.** Adding one must cost a new service and a new entry in the dispatch, and
  this feature must leave it that cheap — but it adds none, and no code, field or setting may be
  shaped around a music provider that has no requirements yet. In particular,
  `MediaSearchResult`'s fields stay as they are — they fit what TMDB serves, and widening them for a
  hypothetical provider is how a shared type becomes nobody's type.

- **Merging the two services into one.** `MoviesService` keeps its hard-coded `'movie'`, its own
  cache key, its own Prisma model and its own error strings; the series service is a sibling, not a
  branch. Factoring their common lines into a base class or a generic engine is explicitly not the
  goal — it is the outcome this design exists to avoid, and it is how the api accumulates the
  conditionals that a per-type service was supposed to keep out.

- **Generalising the other `movieId`s.** Only `MediaSearchResult.movieId` is renamed. The mutation
  arguments, the upload metadata key, `MediaSource.movieId` and every Prisma column keep their
  names, even though the new operations make them look inconsistent. Renaming `MediaSource.movieId`
  in particular would break `worker` for zero benefit here — see NFR-1b.

- **Downloading a series, a season or an episode.** `MediaSource.seasonId` / `episodeId`,
  `SourceFile.episodeId` and `ProcessJob.episodeId` already exist and stay unused;
  `components/search/SearchTorrent.tsx` keeps returning early for anything that is not a film, and
  `components/import/ImportMagnetSeasonModal.tsx` stays dead. This feature adds nothing to the
  download, transcode or media-server stages.

- **A consolidated download status for a series.** `Episode.status` is a `MediaStatus`,
  `Show.status` is the catalog's string, and nothing here derives one from the other. Deciding what
  "this series is downloading" means when three of forty episodes are in flight is a real design
  question and deserves its own spec.

- **Removing something from a user's library.** As with films in `005-movie-search`, there is no
  `removeMedia`. Adding is one-way for now.

- **Paginating search results.** `TmdbClient.search` already accepts a `page` argument that nothing
  passes, for series exactly as for films. Still true after this feature.

- **Refreshing an entry that is already stored.** A running series that airs a new season will not
  pick it up: `seasonsSyncedAt` marks completeness, not freshness, and nothing re-checks it. That
  needs a scheduled job this feature does not create.

- **The `movies_enabled` / `shows_enabled` settings.** Both keys are already seeded in
  `services/api/prisma/seeds/settings.ts`. Neither operation reads them and neither screen is gated
  on them — wiring the `*_enabled` flags into navigation and route gating is a settings feature, and
  doing half of it here would leave the flags looking functional when they are not.

## Decided During Specification (plan-level, not requirements)

Nothing below is a requirement, and none of it constrains what the feature must *do* — the template
keeps structure out of `spec.md` for good reason. It is recorded here because it was settled while
writing this document, and re-deriving it in `/plan-feature` would risk landing somewhere else for
no reason. Treat it as given, not as something to relitigate; if any of it turns out to be wrong,
say so rather than quietly substituting a different shape.

**The contract between the dispatch and a per-type service is two methods.** Everything else —
catalog endpoint, cache key, wire-shape mapping, Prisma model, error strings, season hydration — is
private to each implementation, which is the whole point (§ Context & Goal):

```ts
search(query: string, userId: string): Promise<MediaSearchResult[]>;
register(tmdbId: number, userId: string): Promise<MediaRef>;
```

**`api` layout.** A new `src/media/` owns the boundary and nothing else: the module, the resolver
carrying `searchMedia`/`addMedia`, the dispatch itself, and the interface above. It imports the
per-type modules and holds the lookup from media type to service — that lookup is the file AC-16
greps. `MediaSearchResult` moves out of `src/movies/entities/` into `src/media/entities/`, since it
stopped being a film type; `MediaRef` is new and lives beside it. `MoviesService` stays where it is
and keeps its hard-coded `'movie'`, losing only the two methods that move behind the interface. The
series service is its sibling in a new `src/shows/`, owning `Show`/`Season`/`Episode` and the
hydration.

**`web` splits `actions/movies.ts`.** `getMovies` and `getMovieById` stay — they back `/movies` and
`/movies/[id]`, which are film screens and stay film screens. The catalog pair moves to a new
`src/actions/media.ts` as `searchMedia(query, type)` and `addMedia(tmdbId, type)`, which is what
both `/movies/add` and `/shows/add` call. `SearchContainer`'s existing
`addAction: (id, type) => Promise<string>` prop already matches that signature — this is the seam
the MVP left open and never used.

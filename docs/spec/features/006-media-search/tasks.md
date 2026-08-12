---
title: Media Search and Registration, Parameterized by Media Type — Tasks
last_updated: 2026-08-12
status: Done
---

# TASKS: Media Search and Registration, Parameterized by Media Type (`tasks.md`)

Derived from `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`, all `status: Approved`.
Executed by `/implement 006`, which dispatches each task to the subagent named by its tag.

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. This feature touches neither `worker` nor `infra`. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks, which are in a different service and past the contract they share. |
| `→ Tnnn` | Blocked by that task. |

**Baseline to beat**, from `services/api/CLAUDE.md` and `services/web/CLAUDE.md` — re-measure
rather than trusting these, and report the number before and after each task:

- `api` — **0** typecheck errors, **80** tests across **9** suites. This feature adds a suite, so
  both test counts must go up and the error count must not.
- `web` — **12** errors across the same 5 pre-existing pre-GraphQL files (`importFolderModal.tsx`,
  `ImportMagnetSeasonModal.tsx`, `SearchTorrentModal.tsx`, `SearchForm.tsx`, `ResultsForm.tsx`).
  Any other number means a task added an error or edited a file it was not scoped to.

`bin/npm web run build` is **not** a gate anywhere in this file: `app/(dashboard)/shows/page.tsx`
is an untracked copy importing a module that does not exist, explicitly Out of Scope, and it fails
the build before and after this feature.

## Tasks

### Group 1 — schema and migration (`api`)

Nothing else can start: every later task reads through the join table this creates.

- [x] **T001** `[api]` Add `UserShow` to `prisma/schema.prisma`, mirroring `UserMovie` field for
      field (`userId String`, `showId Int`, `createdAt`, `@@id([userId, showId])`,
      `@@index([showId])`, `@@map("user_shows")`, both relations `onDelete: Cascade`), plus the
      `shows UserShow[]` back-relation on `User`, the `users UserShow[]` back-relation on `Show`,
      and `seasonsSyncedAt DateTime?` on `Show`. `Show.tmdbId` keeps its existing `@unique` — it is
      what makes "the same series twice" unrepresentable (REQ-8), not an incidental constraint.
      Generate through `bin/npm api run prisma:migrate`; **no backfill and no hand-appended SQL**,
      unlike `005-movie-search`'s migration. Before generating, run
      `bin/mysql -e 'select count(*) from shows'` — if it is not `0` the plan's premise is wrong,
      so **stop and report** rather than migrating (`plan.md` § Migrations).
      *Done when:* `bin/cli api npx prisma migrate status` reports nothing pending;
      `git status services/api/prisma/` shows both a modified `schema.prisma` and a new migration
      directory (Constitution, Article III); and `bin/mysql -e 'describe user_shows; describe shows'`
      shows the composite key and a nullable `seasonsSyncedAt`.

### Group 2 — the seam, with films as its only implementation (`api`)

Strictly sequential — T002–T005 edit an overlapping set of files, and running them concurrently is
two agents writing the same file, not parallelism. At the end of this group the feature is live for
films and the two old operations are gone; series arrive in Group 3 as one new service plus one
line in the lookup, which is the claim AC-16 exists to keep true.

- [x] **T002** `[api]` Move the search-result entity: create
      `src/media/entities/media-search-result.entity.ts` as a move of
      `src/movies/entities/media-search-result.entity.ts` with the field renamed `movieId` →
      `mediaId` and its doc comment reworded to "the id of the registered row, in whatever table
      `type` names". **Delete the original** — two copies of this entity is a divergence waiting to
      happen. Add `src/media/entities/media-ref.entity.ts`: an `@ObjectType()` with
      `@Field(() => Int) id: number` and `@Field() type: string`. Update the import in
      `movies.service.ts`. There is **no circular dependency** here despite appearances:
      `MoviesModule` never imports `MediaModule`, only a plain entity class file that imports
      nothing from `movies/` — do not "solve" it by keeping a second copy. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` is at **0** errors and
      `grep -rn "movies/entities/media-search-result" services/api/src` returns nothing.
- [x] **T003** `[api]` Write `src/media/media-type.interface.ts` — exactly the two methods frozen in
      `spec.md` § Decided During Specification, and nothing else on it: no cache key, no endpoint,
      no `type` getter. Every implementation detail stays private to each implementation, which is
      the entire point of the shape. → T002
      *Done when:* the file declares `search(query: string, userId: string):
      Promise<MediaSearchResult[]>` and `register(tmdbId: number, userId: string):
      Promise<MediaRef>` and the typecheck is still at 0.
- [x] **T004** `[api]` Move `MoviesService` behind that interface. Rename `searchMovies` → `search`
      and `addMovie` → `register`; `register` keeps its whole existing body and returns
      `{ id: movie.id, type: MEDIA_TYPE.MOVIE }` instead of the Prisma row **in both branches** (the
      already-registered one and the freshly-created one). Rename `movieId` → `mediaId` in
      `enrichWithOwnership`'s returned object. Declare `implements MediaTypeService`. Strip the
      `searchMovies` query, the `addMovie` mutation and the now-unused `MediaSearchResult` import
      from `movies.resolver.ts`; add `exports: [MoviesService]` to `movies.module.ts` (it currently
      exports nothing). Update `movies.service.spec.ts` in the same task — a rename that leaves its
      own suite uncompilable is not finished. **Change nothing else in `movies.service.ts`**: not
      the hard-coded `'movie'` on line 162, not `cacheKey`, not the ordering comment at line 175,
      not `addTorrentToMovie`/`addMagnetToMovie`. → T003
      *Done when:* `bin/npm api test` is green at **80** tests across **9** suites with only the
      `addMovie` case changed (it now asserts `{ id: 5, type: 'movie' }`); the other three cases
      pass **unmodified** — if any of them needed editing, this task went beyond its scope, so stop
      and report. Typecheck still at 0.
- [x] **T005** `[api]` Build the boundary and wire films through it. `src/media/media-dispatch.service.ts`
      injects `MoviesService`, holds one `Record<MediaType, MediaTypeService>` with `movie` as its
      only entry so far, and exposes `resolve(type: string): MediaTypeService` throwing
      `BadRequestException(\`Tipo de medio no soportado: ${type}\`)` for anything else — the exact
      string, and the only user-facing message that lives above the per-type services.
      `src/media/media.resolver.ts` adds `searchMedia` (→ `[MediaSearchResult!]!`) and `addMedia`
      (→ `MediaRef!`), both taking `type: String!`, both reading the caller via `@CurrentUser()` and
      narrowing with `principal.type === 'user' ? principal.id : ''` as `movies.resolver.ts` does,
      and **neither carrying `@AllowService()`** (NFR-7 — that is the default, so this is a "do not
      add it", and it is worth a second look because copying a decorator block is exactly how it
      would arrive). `src/media/media.module.ts` imports `MoviesModule`; `app.module.ts` registers
      `MediaModule`. `resolve()` returns the service and the **resolver** calls `search`/`register`
      on it — do not add pass-through wrappers to the dispatch: a parameter named `tmdbId` there
      would put `tmdb` in the file and fail AC-16 for nothing. → T004
      *Done when:* `grep -niE "season|episode|tmdb|'tv'|prisma" services/api/src/media/media-dispatch.service.ts`
      returns **nothing** (AC-16); `grep -n "searchMovies\|addMovie" services/api/src/schema.gql`
      returns nothing while `addTorrentToMovie`, `addMagnetToMovie`, `movies`, `movie` and
      `MediaSource.movieId` are all still present (AC-14, NFR-1b); the regenerated `schema.gql` diff
      matches `spec.md` § GraphQL Contract Delta exactly; and live from the Apollo sandbox,
      `searchMedia(query: "dune", type: "movie")` returns results with `mediaId`/`inLibrary`,
      `addMedia(tmdbId: <n>, type: "movie")` returns `{ id, type }`, and either operation with
      `type: "music"` returns exactly `Tipo de medio no soportado: music` and writes nothing (AC-9).

### Group 3 — series (`api`)

The whole point of Group 2 is that this group is additive: a new service and one entry in the
lookup, with no edit to the dispatching logic.

- [x] **T006** `[api]` Write `ShowsService` and `ShowsModule` in a new `src/shows/`, implementing
      `MediaTypeService`, and add the `show` entry to the dispatch's lookup. Structurally the twin
      of `MoviesService` — copy its **structure**, and do **not** extract a base class, a generic
      helper or a shared mixin (`spec.md` § Out of Scope forbids it explicitly).
      `search`: blank query returns `[]` without touching the catalog (REQ-5);
      `this.tmdb.search<TmdbShow>('tv', query)` with `'tv'` **hard-coded here, deliberately**, the
      way `MoviesService` hard-codes `'movie'`; map `name` → `title` and `first_air_date` →
      `releaseDate` (a `""` becomes `null`), `type: MEDIA_TYPE.SHOW`; then
      **`void this.cacheShows(results)` before `await this.enrichWithOwnership(...)`** — read the
      comment at `movies.service.ts:175` before writing that line, it is the single most dangerous
      ordering in the feature (NFR-3). Cache key `tmdb:show:${tmdbId}` — the `MEDIA_TYPE.SHOW`
      value, not TMDB's `tv` — same 24h TTL, same best-effort pipeline that logs and swallows.
      `register`: `findUnique({ where: { tmdbId } })`; if found, link the caller with
      `prisma.userShow.upsert` (never `create` — a double-clicked button must not raise P2002); if
      not, read `tmdb:show:<id>` from Redis falling back to `tmdb.details(MEDIA_TYPE.SHOW, tmdbId)`,
      throwing `NotFoundException('No encontramos la serie en el catálogo')` only when the catalog
      itself does not know the id; create the `Show`, link the caller. Return
      `{ id, type: MEDIA_TYPE.SHOW }` in both branches. Guard every date with
      `value ? new Date(value) : undefined` — TMDB sends `""` and `new Date('')` is an Invalid Date.
      **No resolver in this module** — `shows`/`show(id)` are Out of Scope and would put a type in
      the schema the delta does not have. Seasons and episodes are T007; this task registers the
      series row and nothing below it. → T005
      *Done when:* the dispatch file is unchanged apart from one lookup entry (`git diff` on
      `media-dispatch.service.ts` is one line — this is AC-16 as a live measurement, not a review
      opinion); `searchMedia(query: "breaking bad", type: "show")` returns series;
      `bin/cli redis redis-cli get tmdb:show:<tmdbId>` contains **neither** `inLibrary` **nor**
      `mediaId` (AC-3); after `addMedia`, `bin/mysql -e 'select count(*) from shows where tmdbId =
      <n>'` returns 1 and `user_shows` grew by 1 (AC-4); a second user adding the same series leaves
      `shows` at 1 and `user_shows` at 2 for that show (AC-5); `bin/cli redis redis-cli del
      tmdb:show:<n>` followed by an add still registers it (AC-10); and `addMedia` with an unknown
      `tmdbId` returns exactly `No encontramos la serie en el catálogo` for `type: "show"` and
      `No encontramos la película en el catálogo` for `type: "movie"`, writing no row (AC-11).
- [x] **T007** `[api]` Add the background hydration to `ShowsService`. `register` kicks it with
      `void this.hydrate(...)` — **never awaited** (REQ-13) — and also kicks it on the
      already-registered branch **when `seasonsSyncedAt` is `null`** (REQ-14; this is the retry path
      and it is easy to miss, because the happy path never reaches it). The whole body of `hydrate`
      is `try`/`catch`/`finally` so it cannot reject into an unhandled promise. First, claim:
      `redis.set('show:hydrate:' + tmdbId, '1', 'EX', <ttl>, 'NX')` — not `'OK'` means another
      registration is already fetching, so return immediately (NFR-5); the pattern and the reason a
      GET-then-SET races are documented in `src/uploads/upload-tickets.service.ts:verifyAndSpend`.
      `tmdb.details(MEDIA_TYPE.SHOW, tmdbId)` returns `ShowDetail.seasons` in one request, so the
      cost is 1 + N. Then, for each season, **sequentially — a `for … of` with `await` inside, not
      `Promise.all`** (NFR-6: a burst trips TMDB's rate limit and yields a half-populated series with
      no error): `upsert` the `Season` on `@@unique([showId, seasonNumber])`, call
      `tmdb.seasonDetails(tmdbId, seasonNumber)`, `upsert` each `Episode` on
      `@@unique([seasonId, episodeNumber])`. Upserts throughout, so a lost race or a retry overwrites
      rather than duplicating. Season `0` is stored like any other — no filter (REQ-12). Only after
      every season and every episode is written, set `seasonsSyncedAt` — any earlier and REQ-14 is
      broken. `catch` logs with `console.error` including the tmdbId (NFR-4 — that log and the
      `null` column are the only traces a failure leaves). `finally` deletes the claim key, so a
      failure does not wedge every future retry until the TTL. `TmdbClient.seasonDetails` has never
      been called by anything; this is its first caller. → T006
      *Done when:* within seconds of an `addMedia` for a series, `select count(*) from seasons where
      showId = <id>` and the joined episode count match what TMDB reports, and `select seasonsSyncedAt
      from shows where id = <id>` is no longer NULL (AC-6); for a series with specials,
      `select count(*) from seasons where showId = <id> and seasonNumber = 0` returns 1 (AC-7); and
      with `movie_db_api_key` cleared in Settings after a search, adding a cached series writes the
      `shows` row with `seasonsSyncedAt` still NULL, `docker compose logs api` shows the failure, and
      a second `addMedia` for that same series triggers the fetch again instead of treating it as
      done (AC-12).

### Group 4 — the series test suite (`api`)

- [x] **T008** `[api] [P]` Write `src/shows/shows.service.spec.ts`, opening with a comment naming the
      class of bug it defends against, in English, in the shape of `movies.service.spec.ts:9-26`
      (Constitution, Article IX). Four cases, each a failure that produces no error anywhere:
      (a) **cache before enrich** — assert on the object handed to the Redis pipeline, with
      `tmdb:show:<id>` as the key and the parsed JSON having neither `mediaId` nor `inLibrary`;
      asserting the return value cannot catch this, because the returned value is correct in both
      orderings, which is exactly why the bug survives review. This case is required **even though
      `005-movie-search` already has it for films** — the invariant is implemented separately per
      service, so it breaks separately (NFR-3). (b) **caller scoping** — assert the `where` clause of
      `prisma.show.findMany` filters `users: { some: { userId } }`; a mocked Prisma returns whatever
      it was told regardless of the query, so the call arguments are the only observable.
      (c) **`register` on an already-registered series** — no second `Show`, the link upserted,
      tolerant of being called twice. (d) **`seasonsSyncedAt` only on complete success** — make
      `seasonDetails` reject on the second season, assert `prisma.show.update` was never called with
      `seasonsSyncedAt`, and assert the claim key was deleted; a partial fetch that marks itself
      complete is permanently invisible, and a claim left behind silently disables every retry.
      → T007
      *Done when:* `bin/npm api test` is green with **more than 80** tests across **10** suites, and
      the typecheck is still at **0** (AC-15). Verify case (a) actually bites by temporarily moving
      the enrichment above `cacheShows` and confirming it fails — a test that passes against the
      broken ordering is the silent failure it was written to prevent.

### Group 5 — consumer (`web`)

Everything here depends on the contract existing and being **produced**, not merely frozen: in a
repo with no codegen, "it compiles" is not evidence any of it works. These three are sequential
among themselves (each edits what the previous one established) but may overlap with T008, which is
a different service and past the contract they share.

- [x] **T009** `[web] [P]` Rename the field and add the new actions. In `src/types/search.ts`,
      `movieId: number | null` → `mediaId: number | null` with the comment reworded to "the id of the
      registered row in whatever table `type` names"; leave `inLibrary`'s comment as the ownership
      test — the two answer different questions and neither replaces the other. Add
      `src/actions/media.ts` (new) with `searchMedia(query, type)` and `addMedia(tmdbId, type)`,
      copying the shape of `src/actions/media-server.ts` exactly (`'use server'` on line 1, a
      module-level SCREAMING_SNAKE document const, the response shape as `fetchGraphQL<T>`'s type
      parameter, `errors[0]?.message` with a Spanish fallback) and using the **awaited**
      `redirectIfUnauthenticated` — both are called from a Client Component event handler, a Server
      Action context where cookie mutation is legal; `redirectToClearSession` is for read functions a
      Server Component awaits during render and the two are **not** interchangeable.
      `searchMedia` keeps the client-side `if (!query.trim()) return []` short-circuit and selects
      exactly `id title releaseDate posterUrl originalLanguage overview type mediaId inLibrary`.
      `addMedia` selects `{ id type }` and returns `String(data.addMedia.id)` — ids are `string` in
      this service even where the GraphQL argument is `Int!`. Fallback strings stay generic
      (`Error al buscar` / `Error al agregar`): these two functions serve both media types, and the
      per-type wording comes either from `api` or from T010. → T007
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports the baseline **12 errors in the same
      5 files**, none of them in `types/search.ts` or `actions/media.ts`, and Biome reports nothing
      new on either file.
- [x] **T010** `[web]` Rework `src/components/search/SearchContainer.tsx`. **Widen `searchAction` to
      `(query: string, type: MediaType) => Promise<MediaSearchResult[]>`**, matching the `addAction`
      prop that has taken a `type` since the MVP, and pass `type` from `handleSearch`. This is not
      cosmetic symmetry: the add pages are Server Components, and a Server Component cannot pass an
      inline arrow like `(q) => searchMedia(q, MEDIA_TYPE.MOVIE)` to a Client Component — only a real
      Server Action is serializable across that boundary, and wrapping it fails at runtime with
      "Functions cannot be passed directly to Client Components". Read `item.mediaId` where it read
      `item.movieId` (line 89) and rename `addedMovieIds` → `addedMediaIds`. Make the two hard-coded
      strings follow the type: the add error (line 60) and the pre-search empty state (line 82) must
      not say "película" on a series screen (REQ-15); inline, never `alert()`. **Split the owned
      branch by type** (REQ-16): films keep exactly today's `Ir` `<Link>` to `/movies/<mediaId>` with
      the same classes; series render a non-interactive `Agregada` badge with **no `href`**, because
      this feature ships no `/shows/[id]` — keep its visual weight comparable so the card does not
      look broken. The ownership test does not change and must not be "simplified":
      `item.inLibrary || addedMediaIds[item.id] !== undefined`, **never** `mediaId !== null` — a
      series another user registered is still addable by this caller. `SearchInput.tsx`,
      `MediaList.tsx` and `MediaCard.tsx` already branch on media type correctly; check before
      editing, not after. → T009
      *Done when:* the typecheck is still at the baseline 12/5 and Biome is clean on this file.
      Behaviour is verified in T011, when the pages feed it.
- [x] **T011** `[web]` Wire the two pages and delete the old actions. `/movies/add` and `/shows/add`
      both import `{ searchMedia, addMedia }` from `@/actions/media` and pass them **by reference**
      (see T010); `/shows/add` switches to `type={MEDIA_TYPE.SHOW}` and its breadcrumb from
      `Movies Add` to `Shows Add`. The TailAdmin boilerplate `metadata` on both is template noise,
      out of scope, unchanged. Then delete `searchMovies`, `addMovie`, `SEARCH_MOVIES_QUERY` and
      `ADD_MOVIE_MUTATION` from `src/actions/movies.ts` plus the imports they orphan; `getMovies`,
      `getMovieById`, `GET_MOVIE_QUERY` and the `Movie` interface stay — they back `/movies` and
      `/movies/[id]`, which are film screens and stay film screens. **Rename by meaning, one site at
      a time**: `movieId` appears 21 times under `services/web/src` and only three are this
      feature's; every other hit is a mutation argument, the tus upload metadata key, or a local
      variable, and a project-wide find-and-replace breaks the download pipeline with no error at all
      (NFR-1b). Do not touch `services/worker/`. → T010
      *Done when:* `/shows/add` searches series with the box reading `Buscar serie...` and
      series-worded empty state and errors, `Agregar` disables while in flight then becomes a
      non-link `Agregada`, and a second series can be added without reloading (AC-1, AC-8);
      `/movies/add` behaves exactly as before — add a film and the card becomes `Ir` → `/movies/<id>`,
      and **re-searching that same title shows `Ir` on the first render**, from `inLibrary` alone,
      which is the one check that catches a missed `mediaId` rename (AC-2, NFR-1);
      `grep -rn "searchMovies\|addMovie" services/web/src` returns nothing (AC-14); and
      `grep -rn "movieId" services/web/src` still returns the mutation arguments in `actions/imports.ts`,
      `actions/indexer.ts` and `actions/uploads.ts`, the metadata key in `importFileModal.tsx` and the
      locals in `SearchTorrent.tsx`, while returning nothing from `types/search.ts` or
      `SearchContainer.tsx` (AC-13). Typecheck at the baseline 12/5.

### Group 6 — verification and docs

- [x] **T012** `[docs]` Record what no typechecker can see, and correct what this feature made stale.
      In `docs/spec/graphql-contract.md`, a new `###` section under § Contracts & Interfaces: the two
      catalog operations are now `searchMedia`/`addMedia` taking a `type`, `searchMovies`/`addMovie`
      are gone, `MediaSearchResult.movieId` is now `mediaId` — and, critically, that `movieId`
      survives on `MediaSource` and on the three mutations and means something else there, so a
      future feature does not "finish the rename" and break `worker`. Restate the cache-before-enrich
      ordering as an obligation on **every** per-type service, not a note about `searchMovies`. In
      the root `CLAUDE.md`, grow the *Search catalog (TMDB)* and *Register title in DB* pipeline rows
      from films to films **and** series, and note the per-user `UserShow` join beside the existing
      `UserMovie` paragraph. In `services/api/CLAUDE.md`, add `media/` and `shows/` to the module
      map, correct the `movies/` bullet (it still describes `searchMovies`/`addMovie` as living
      there), and fix the "There are 10 models" / "`Show`/`Season`/`Episode` have no module and no
      GraphQL surface — the API is movies-only today" claims, both of which this feature falsifies.
      In `services/web/CLAUDE.md`, update the `005-movie-search` section for the `mediaId` rename and
      the per-type copy, and correct the typecheck count if it moved. → T008, T011
- [x] **T013** `[docs]` Walk every acceptance criterion in `spec.md` (AC-1…AC-16) live, tick each
      box, and set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`.
      AC-5 must be walked with a **real second user in a separate browser session**, not signed off
      by reading code — a library leak is a perfectly successful response with the wrong contents.
      AC-12 needs `movie_db_api_key` actually cleared in Settings between the search and the add, and
      then restored to confirm the retry. AC-2 is the `mediaId`-rename gate and must be walked on a
      film that was already in the library **before** the session started. → T012

## Blocked

Nothing currently blocked.

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice. The two premises
most likely to send a task here are T001's (`shows` is empty in every installation) and T004's
(the three unchanged cases in `movies.service.spec.ts` still pass untouched).

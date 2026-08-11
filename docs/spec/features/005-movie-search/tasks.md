---
title: Movie Search and Per-User Libraries — Tasks
last_updated: 2026-08-11
status: Done
---

# TASKS: Movie Search and Per-User Libraries (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. This feature touches neither `worker` nor `infra`. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**Baseline to beat**, measured 2026-08-11 against the running stack: `api` **0** typecheck errors /
**76** tests passing across **8** suites (this feature adds a suite, so both counts must go up);
`web` **12** errors across the same 5 pre-existing pre-GraphQL files listed in
`services/web/CLAUDE.md` (`importFolderModal.tsx`, `ImportMagnetSeasonModal.tsx`,
`SearchTorrentModal.tsx`, `SearchForm.tsx`, `ResultsForm.tsx`). Every agent reports the number
before and after to prove it added nothing.

## Tasks

### Group 1 — schema and migration (`api`)

Strictly sequential, and nothing else in `api` can start until it lands: every later task reads
through the join table this group creates.

- [x] **T001** `[api]` Add the `UserMovie` model to `prisma/schema.prisma` (`userId String`,
      `movieId Int`, `createdAt`, `@@id([userId, movieId])`, `@@index([movieId])`,
      `@@map("user_movies")`, both relations `onDelete: Cascade`) plus the `movies UserMovie[]` /
      `users UserMovie[]` back-relations on `User` and `Movie`. `Movie.tmdbId` keeps its `@unique` —
      it is what makes a duplicate download unrepresentable (REQ-3), not an incidental constraint.
      Generate the migration through `bin/npm api run prisma:migrate`, then **hand-append** the
      backfill `INSERT ... SELECT` from `plan.md` § Migrations to the generated `migration.sql`, with
      a comment naming NFR-1. Keep the `EXISTS` guard: without it an installation with no enabled
      admin inserts `NULL` into a non-null foreign key and the migration dies halfway. Read
      `prisma/migrations/20260810224010_add_user_is_admin/migration.sql` first — same pattern, same
      reason, and it documents the MariaDB read/write-one-table quirk (which does not bite here,
      since this statement reads `users`/`movies` and writes `user_movies`).
      *Done when:* `bin/cli api npx prisma migrate status` reports nothing pending, and on a database
      that already had movies, `bin/mysql -e 'select count(*) from movies; select count(*) from
      user_movies'` returns two equal numbers, every link pointing at the oldest enabled admin
      (AC-8). On a database with no enabled admin the migration still completes, leaving the table
      empty.
- [x] **T002** `[api]` Link the seeded film to the seeded admin in `prisma/seeds/movie.ts`, which
      currently creates *Inception* with no owner. `prisma/seeds/index.ts` already runs `seedUsers`
      before `seedMovies`, so the user exists. Without this a brand-new database gives the admin an
      empty `/movies`, which looks exactly like the backfill having failed. → T001
      *Done when:* on a fresh database, `bin/mysql -e 'select u.username, m.title from user_movies um
      join users u on u.id = um.userId join movies m on m.id = um.movieId'` shows the seeded admin
      against *Inception*.

### Group 2 — behaviour and contract (`api`)

No `[P]` in this group on purpose: T003–T007 all edit `movies.service.ts` and `movies.resolver.ts`.
Running them concurrently is not parallelism, it is two agents writing the same two files. Order
matters beyond the file conflict — enrichment (T006) written before scoping (T003) yields a search
screen that accurately reports ownership of a library that is still global, which looks finished and
is not.

- [x] **T003** `[api]` Scope the library to the caller: `findAll()` in
      `src/movies/movies.service.ts` takes a `userId` and filters through the join;
      `movies` in `src/movies/movies.resolver.ts` reads it via `@CurrentUser() principal:
      AuthPrincipal`, narrowed on `principal.type === 'user'` exactly as `updateUser`/`removeUser`
      already do in `src/users/users.resolver.ts`. The GraphQL signature does **not** change — no
      `userId` argument, ever (`plan.md` § Contract Freeze). Leave `findOneFromDb()` unscoped:
      `movie(id)` stays readable by any authenticated user per `spec.md`. The
      `include: { mediaSource, processJobs }` stays. → T001
      *Done when:* `git diff src/schema.gql` is **empty** for `movies` — the change is invisible to
      the schema, which is the point — and querying `movies` against `api` with a second user's token
      returns only that user's films (AC-10), while that user's `/movies` is empty on the upgraded
      database (AC-9).
- [x] **T004** `[api]` Make `addMovie` link the caller. Keep the existing "already registered →
      return the existing row untouched" behaviour and, in **both** branches, ensure the caller's
      link exists. Creating it must be idempotent — a second `addMovie` from the same user must not
      surface a raw Prisma `P2002` on the happy path of a button the UI is about to stop showing.
      `@CurrentUser()` on the resolver, same narrowing idiom, no new argument. → T001
      *Done when:* user B registering a film only user A had produces **one** `movies` row and
      **two** `user_movies` rows (AC-5), qBittorrent shows no second torrent, and B's `/movies`
      reports the same status A sees (AC-6). Calling `addMovie` twice as the same user returns the
      same film both times with no error.
- [x] **T005** `[api]` Replace the `fetchMovieFromTMDB` stub with a real call to
      `TmdbClient.details(MEDIA_TYPE.MOVIE, tmdbId)` mapped to `MediaSearchResult`. Extract the
      poster-URL construction — today inlined in `searchMovies` as
      `https://image.tmdb.org/t/p/w300${poster_path}` — into one exported helper in
      `src/clients/tmdb/client.ts` and use it from **both** paths, so a warm cache and a cold cache
      cannot produce different image sizes for the same film. A film the catalog does not know
      becomes `NotFoundException('No encontramos la película en el catálogo')`; delete
      `La película <id> no está en cache. Volvé a buscarla.` → T004
      *Done when:* `bin/cli redis redis-cli del tmdb:movie:<n>` followed by registering film `<n>`
      succeeds and writes the row, with no `no está en cache` reaching the screen (AC-7), and the
      stored `posterUrl` is byte-identical to what the cache-warm path writes for the same film.
- [x] **T006** `[api]` Produce the contract `web` waits on, in one task so there is no intermediate
      state where `inLibrary: Boolean!` exists in the schema and resolves to `undefined` (Apollo
      fails the whole query on a non-null field returning null). Add `@Field(() => Int, { nullable:
      true }) movieId` and `@Field() inLibrary: boolean` to
      `src/movies/entities/media-search-result.entity.ts`, and populate them in `searchMovies`
      **after** `void this.cacheMovies(results)`, from a single
      `prisma.movie.findMany({ where: { tmdbId: { in: [...] } } })` with the caller's link selected —
      one query per page, not one per result. `@CurrentUser()` on the resolver.
      **The ordering is the requirement.** `cacheMovies` serialises whatever object it is handed into
      a shared, global Redis key; enriching first caches one user's ownership and serves it to
      everyone who searches that film for the next 24 hours, with no error anywhere. For the same
      reason the two fields go on the GraphQL entity only — `src/clients/types.ts`'s
      `MediaSearchResult` is the cached shape and must stay catalog-only, so it is **not** edited.
      → T001
      *Done when:* `git diff src/schema.gql` shows exactly `+ movieId: Int` and `+ inLibrary:
      Boolean!` on `MediaSearchResult` and nothing else; live, a search returns `inLibrary: true`
      only for the caller's own films and `movieId` non-null for films any user registered.
- [x] **T007** `[api]` Require ownership on the two download mutations. `attachTorrentSource` already
      resolves the movie and throws `La película <id> no existe` when it is missing — extend that
      same lookup to require the caller's link, so an unowned film takes the identical path and the
      identical message. One check, one string; do not add a second branch with new copy (`spec.md`
      § Errors explains why "no es tuya" is deliberately not a distinct message). `@CurrentUser()` on
      both `addTorrentToMovie` and `addMagnetToMovie`. → T003
      *Done when:* `addMagnetToMovie` against a film the caller has not registered is refused with
      exactly `La película <id> no existe`, and `bin/mysql` confirms that film's `mediaSourceId` is
      unchanged afterwards (AC-11). The owner's own attach still works.
- [x] **T008** `[api]` Write `src/movies/movies.service.spec.ts`, opening with a comment naming the
      class of bug it defends against (Article IX). Follow `src/users/users.service.spec.ts` for
      structure — plain jest mocks over Prisma — not `users.resolver.spec.ts`, which is `nest g`
      scaffolding. Four cases, each a failure that produces no error anywhere: (a) the Redis pipeline
      receives catalog-only objects, asserted on **what is handed to Redis**, not on what
      `searchMovies` returns — the return value looks correct in both orderings, which is exactly why
      this needs a test; (b) `movies` returns only the caller's films; (c) `addMovie` on an
      already-registered film creates the link, no second `Movie` row, and does not raise on a repeat
      from the same user; (d) the TMDB fallback maps `MovieDetail.posterPath` to an absolute
      `posterUrl` at the same size the search path uses. The migration backfill is deliberately not
      unit-tested — jest here runs against mocked Prisma, so it would assert the mock rather than the
      SQL; AC-8 covers it against a real database. → T003, T004, T005, T006, T007
      *Done when:* `bin/npm api test` is green with **more than 76** tests across **more than 8**
      suites, and `bin/cli api npx --no tsc --noEmit` is still at **0** errors. Verify case (a)
      actually bites by temporarily moving the enrichment above `cacheMovies` and confirming it
      fails — a test that passes against the broken ordering is the silent failure it was written to
      prevent.

### Group 3 — consumer (`web`)

T009 depends on nothing at all and **may start immediately**, in parallel with Group 1. T010 and
T011 cannot: they consume fields that do not exist until T006 ships, and in a repo with no codegen
"it compiles" is not evidence they work.

- [x] **T009** `[web] [P]` Fix the invisible submit button in
      `src/components/search/SearchInput.tsx`. Its hand-rolled `<button className="… bg-primary …">`
      is the only reference to a `primary` colour in the whole service, and `web`'s Tailwind 4
      `@theme` (`src/app/globals.css`) defines only `--color-brand-*` — the class compiles to
      nothing, so the button is transparent with white text. Render it with the shared `Button`
      (`src/components/ui/button/Button.tsx`, `type="submit"`, `disabled={loading}`), keeping the
      `Buscar` / `Buscando...` copy, and replace the input's equally dead `focus:border-primary`.
      **Do not add a `--color-primary` token** — inventing a second colour scale to rescue one orphan
      class is the duplication this plan exists to prevent. No dependency.
      *Done when:* on `/movies/add` the button is visible and clickable in both light and dark themes
      (AC-1) — toggle the theme without reloading — and `bin/cli web npx --no tsc --noEmit` still
      reports 12 errors in the same 5 files.
- [x] **T010** `[web]` Add `movieId` and `inLibrary` to `SEARCH_MOVIES_QUERY` in
      `src/actions/movies.ts` **and** to `MediaSearchResult` in `src/types/search.ts`
      (`movieId: number | null`, `inLibrary: boolean`). Both together — there is no codegen, and a
      field left out of the document arrives `undefined` with no type error. Leave `addMovie`'s
      unused `type` parameter alone (`plan.md` § Decided here). → T006
      *Done when:* the typecheck reports the same 12 errors in the same 5 files, none in
      `actions/movies.ts` or `types/search.ts`, and a live search returns both fields populated.
- [x] **T011** `[web]` Rewrite the add flow in `src/components/search/SearchContainer.tsx`. Remove
      `router.push(...)` from `handleAdd` and the now-unused `useRouter`; on success record that
      result as in-library, keyed by its TMDB id and holding the `Movie` id `addMovie` returned, and
      **clear `addingId`** — it is currently never cleared on success because the page was navigating
      away, so without this the card stays disabled forever. In `renderAction`, render an `Ir` link
      (`next/link` → `/movies/<id>`, using `item.movieId` for films already owned) when
      `item.inLibrary` is true **or** it was added this session; otherwise the add button, relabelled
      `Agregar` — it currently reads `Add`, the only English string on the screen. Never use
      `movieId !== null` as the ownership test: it is non-null for other users' films too, which must
      still offer to be added (REQ-8). An add failure keeps the existing inline error and must return
      only that card to its add state, leaving the rest of the results usable. → T010
      *Done when:* registering a film leaves the URL on `/movies/add` with the results still rendered
      and that card reading `Ir` (AC-2); `Ir` navigates to `/movies/<id>` (AC-3); repeating the
      search shows `Ir` on first render, never `Agregar` (AC-4); as a second user, a film only the
      admin has registered shows `Agregar`, not `Ir` (AC-5, first half). Typecheck unchanged from
      baseline.

### Group 4 — verification and docs

- [x] **T012** `[docs]` Record the cross-cutting rule and correct what is now stale. In
      `docs/spec/graphql-contract.md`, a new `###` section under § Contracts & Interfaces: `movies`
      is scoped to the caller and `addMovie` links them, both with unchanged signatures — the change
      no typechecker can see (NFR-2), so a future feature will silently undo it if it is not written
      down; plus the two additive `MediaSearchResult` fields and the new error string. In the root
      `CLAUDE.md`, flip the `Search catalog (TMDB)` pipeline row from *"in progress, does not
      compile"* to working and fix its file references — it points at `src/clients/TMDBClient.ts` and
      `src/movies/movies.search.ts`, **neither of which exists**; the code lives in
      `src/movies/movies.service.ts` and `src/clients/tmdb/{client,types}.ts`. Also correct the root
      `CLAUDE.md`'s Known debt claim that the TMDB bearer token is hardcoded — it comes from the
      `movie_db_api_key` setting — and add the per-user library to the paragraph describing the
      seeded administrator. In `services/api/CLAUDE.md`, the `movies/` bullet (same dead
      `movies.search.ts` reference, plus the join table and the scoping) and the same false
      hardcoded-token entry under Known debt. In `services/web/CLAUDE.md`, the search-screen
      behaviour and the corrected typecheck count if it moved. → T008, T011
- [x] **T013** `[docs]` Walk every acceptance criterion in `spec.md` (AC-1…AC-11) live, tick each
      box, and set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`.
      AC-5, AC-6, AC-9 and AC-10 must be walked with a **real second user in a separate browser
      session**, not signed off by reading code — the per-user library is what this feature exists
      for, and its failure mode is a perfectly successful response with the wrong contents. AC-8
      needs a database that predates T001: check out the previous commit, `bin/dev`, add a couple of
      films, then return and run `bin/cli api npx prisma migrate deploy`. → T012

## Blocked

Nothing currently blocked.

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.

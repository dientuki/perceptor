---
title: Movie Search and Per-User Libraries — api slice
service: api
last_updated: 2026-08-11
status: Implemented
---

# PLAN: Movie Search and Per-User Libraries — `api` (`api/plan.md`)

## Scope

This slice owns the join between `User` and `Movie`: the Prisma model, the migration and its
backfill, the seed, the scoping of `movies`, the linking side effect on `addMovie`, the ownership
check on the two torrent mutations, the two enriched fields on `MediaSearchResult`, and the TMDB
fallback that makes an expired cache harmless. It is everything in `spec.md` except what the user
sees.

It does **not** touch the search screen, the add button, or the `Ir` affordance — `web` owns those,
and it consumes this slice through the frozen contract in `../spec.md`. It also does not touch the
download pipeline itself: `MediaSource`, `SourceFile`, `ProcessJob`, `torrentCompleted` and the
encode flow are all unchanged, because the film stays one shared row. If something here seems to
require changing them, that is a sign the design was misread — stop and report.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/prisma/schema.prisma` | Modified | `UserMovie` model; back-relations on `User` and `Movie` |
| `services/api/prisma/migrations/<ts>_add_user_movies/migration.sql` | New | Generated `CREATE TABLE` + hand-appended backfill |
| `services/api/prisma/seeds/movie.ts` | Modified | Link the seeded film to the seeded admin |
| `services/api/src/movies/movies.service.ts` | Modified | Scoping, linking, ownership check, enrichment, TMDB fallback |
| `services/api/src/movies/movies.resolver.ts` | Modified | `@CurrentUser()` on `movies`, `addMovie`, `searchMovies`, `addTorrentToMovie`, `addMagnetToMovie` |
| `services/api/src/movies/entities/media-search-result.entity.ts` | Modified | `movieId: Int` (nullable), `inLibrary: Boolean!` |
| `services/api/src/clients/tmdb/client.ts` | Modified | Export the one poster-URL helper |
| `services/api/src/movies/movies.service.spec.ts` | New | See § Tests |

`services/api/src/clients/types.ts` is deliberately **not** on this list. See § Steps, step 5.

## Existing code to reuse

- `src/auth/decorators/current-user.decorator.ts` + `src/auth/auth.types.ts` — `@CurrentUser()` and
  the `AuthPrincipal` union. A service principal has no `id` **structurally**, so every use narrows
  on `principal.type === 'user'` before reading `principal.id`. Do not add an `id?: string` to the
  service branch to make the narrowing go away; that field's absence is the security property
  (NFR-3).
- `src/users/users.resolver.ts` (`updateUser`, `removeUser`) — the exact idiom for reading the
  caller from the principal and passing an id down to the service. Copy its shape, including the
  comment explaining why the narrowing is repeated.
- `src/movies/movies.service.ts` — `cacheKey()`, `cacheMovies()`, `getCachedMovie()` and
  `attachTorrentSource()` all already exist and stay. This slice extends them; it does not replace
  them. `cacheKey()` is already the single definition shared by the write and the read side — keep
  it that way.
- `src/clients/tmdb/client.ts` — `details(MEDIA_TYPE.MOVIE, id)` already fetches and maps a film to
  `MovieDetail`. The fallback calls it; it does not add a second fetch path.
- `prisma/migrations/20260810224010_add_user_is_admin/migration.sql` — the precedent for appending a
  backfill to a generated migration, with a comment saying which requirement it serves. Read it
  before writing this one.
- `src/users/users.service.spec.ts` — the test structure to follow (Prisma mocked as plain jest
  mocks, a header comment naming the silent failure). Not `users.resolver.spec.ts`, which is `nest g`
  scaffolding.

## Steps

Order matters. Enrichment written before scoping yields a search screen that accurately reports
ownership of a library that is still global — it looks finished and is not.

1. **Schema.** Add `UserMovie`: `userId String`, `movieId Int`, `createdAt DateTime @default(now())`,
   `@@id([userId, movieId])`, `@@index([movieId])`, `@@map("user_movies")`, both relations
   `onDelete: Cascade`. Add `movies UserMovie[]` to `User` and `users UserMovie[]` to `Movie`.
   `Movie.tmdbId` keeps its `@unique` — it is load-bearing for REQ-3, not incidental.
2. **Migration.** `bin/npm api run prisma:migrate`, then append the backfill `INSERT ... SELECT`
   from `../plan.md` § Migrations to the generated `migration.sql`, with a comment naming NFR-1.
   Keep the `EXISTS` guard: without it an installation with no enabled admin fails halfway through
   the migration instead of coming up with an empty table.
3. **Seed.** `prisma/seeds/movie.ts` currently creates *Inception* with no owner; link it to the
   seeded admin in the same call. `prisma/seeds/index.ts` runs `seedUsers` before `seedMovies`, so
   the row exists. Without this, a fresh database gives the admin an empty `/movies` — which is
   indistinguishable from the backfill having failed.
4. **Scope `movies`.** `findAll()` takes a `userId` and filters through the join. `findOneFromDb()`
   is **not** scoped — `movie(id)` stays readable by any authenticated user, per `../spec.md`. The
   `include: { mediaSource, processJobs }` on both stays as it is.
5. **Enrich `searchMovies`.** After building the catalog results and **after** `void this.cacheMovies(results)`,
   resolve ownership in a single query — `prisma.movie.findMany({ where: { tmdbId: { in: [...] } } })`
   with the caller's link selected — and attach `movieId`/`inLibrary` to the returned objects. One
   query for the whole page, not one per result.

   The ordering is the requirement, not a style preference: `cacheMovies` serialises whatever object
   it is handed into a **shared, global** Redis key. Enriching first caches one user's ownership and
   serves it to everyone for 24 hours, with no error anywhere. For the same reason the two fields go
   on the GraphQL entity in `movies/entities/` and **not** on `clients/types.ts`'s
   `MediaSearchResult`, which is the cached shape and must stay catalog-only.
6. **Link on `addMovie`.** Keep the existing "already registered → return the existing row"
   behaviour, and in both branches ensure the caller's link exists. Creating the link must be
   idempotent — a second `addMovie` from the same user must not surface a primary-key violation.
7. **TMDB fallback.** Replace the `fetchMovieFromTMDB` stub with a real call to
   `TmdbClient.details(MEDIA_TYPE.MOVIE, tmdbId)`, mapped to `MediaSearchResult`. Export the
   poster-URL helper from `clients/tmdb/client.ts` and use it in **both** `searchMovies` and this
   fallback, so the two paths cannot drift to different image sizes. A film the catalog does not
   know about becomes `NotFoundException('No encontramos la película en el catálogo')`; the old
   `La película <id> no está en cache. Volvé a buscarla.` is deleted.
8. **Ownership on the torrent mutations.** `attachTorrentSource` already resolves the movie and
   throws `La película <id> no existe` when it is missing. Extend that same lookup to require the
   caller's link, so an unowned film takes the identical path and the identical message — one check,
   one string, not a second branch with new copy.
9. **Resolver wiring.** `@CurrentUser() principal: AuthPrincipal` on `movies`, `searchMovies`,
   `addMovie`, `addTorrentToMovie`, `addMagnetToMovie`. None of them gets `@AllowService()` (NFR-3) —
   the global `JwtAuthGuard` then refuses a service credential with `No autenticado`, which is the
   behaviour `../spec.md` § Errors records. Signatures and argument lists are unchanged; the caller
   is never a GraphQL argument.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, which is read-only:

```graphql
type MediaSearchResult {
  movieId: Int
  inLibrary: Boolean!
}
```

`movieId` is the `Movie.id` of a registered film **regardless of owner**, null when no user has
registered it. `inLibrary` is true only for the calling user. They are two fields for a reason —
`../plan.md` § Contract Freeze.

`movies: [Movie!]!` and `addMovie(tmdbId: Int!): Movie!` keep byte-identical signatures and change
meaning. Adding an argument to either is a contract change, not an implementation choice.

Three error conditions this slice must produce exactly:

| Condition | Exception | Message |
| :-- | :-- | :-- |
| `addMovie` with a `tmdbId` the catalog does not know | `NotFoundException` | `No encontramos la película en el catálogo` |
| Torrent/magnet attach on a film the caller does not have | `NotFoundException` | `La película <id> no existe` |
| Service credential on any of these | `UnauthorizedException` | `No autenticado` (produced by the existing guard — do not re-throw it locally) |

Confirm the regenerated `src/schema.gql` diff contains the two new fields and **nothing else**
(Article IV: it regenerates from decorators, it is never hand-edited). Anything extra in that diff
is an unreported contract change.

## Tests

`services/api/src/movies/movies.service.spec.ts` — new. Opens with a comment naming the class of bug
it defends against, per Article IX. Four things are owed a test because each fails with no error
anywhere:

- **The cache is written before enrichment.** If the order is ever swapped, `inLibrary` for one user
  is serialised into a global Redis key and returned to every other user for 24 hours. Assert on
  what is handed to the Redis pipeline, not just on what `searchMovies` returns — the return value
  looks correct in both orderings, which is exactly why this needs a test.
- **`movies` is scoped to the caller.** A second user's films must not appear. The failure is a
  successful response with the wrong contents.
- **`addMovie` on an already-registered film** creates the link and no second `Movie` row, and does
  not raise on a repeat from the same user. A regression here either duplicates a download (REQ-3)
  or breaks a button on its happy path.
- **The TMDB fallback maps a `MovieDetail` correctly**, in particular that `posterPath` becomes an
  absolute `posterUrl` at the same size the search path uses. A wrong mapping here yields a film
  registered with a broken or mismatched poster and no error.

Not owed a test, and why:

- **The migration backfill.** Jest here runs against mocked Prisma, so a test would assert the mock,
  not the SQL. It is verified by AC-8 against a real pre-migration database, which is the only place
  the assertion means anything.
- **The resolver wiring.** `@CurrentUser()` and guard behaviour are already covered by `auth/`'s own
  suite; a resolver spec here would be the `expect(service).toBeDefined()` scaffolding Article IX
  explicitly says not to imitate.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
```

Typecheck reports **0** errors, same as before this slice — report the count before and after. The
new suite passes along with the existing ones. `migrate status` reports no pending migrations.

```bash
bin/mysql -e 'select count(*) as movies from movies; select count(*) as links from user_movies'
```

On a database that predates this feature, the two counts match (AC-8).

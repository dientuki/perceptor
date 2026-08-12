---
title: Media Search and Registration, Parameterized by Media Type — api slice
service: api
last_updated: 2026-08-12
status: Implemented
---

# PLAN: Media Search and Registration, Parameterized by Media Type — `api` (`api/plan.md`)

Read `../spec.md` and `../plan.md` first. The GraphQL delta in `../spec.md` is **read-only**.

## Scope

`api` owns everything on the server side of this feature: the migration that adds `user_shows` and
`shows.seasonsSyncedAt`, the new `src/media/` boundary that exposes `searchMedia`/`addMedia` and
dispatches on media type, the new `src/shows/` service that implements that dispatch's contract for
series (including the background season/episode hydration), and the two edits to `src/movies/` that
move `MoviesService` behind the same contract. It also removes `searchMovies` and `addMovie` from
the schema.

`api` does **not** touch any screen, any server action, or any hand-written GraphQL document — the
consumer side is `web`'s slice and lands after this one. In particular, do not go looking for
callers of `searchMovies` in `services/web/` and fix them; `web` is expected to be broken between
the two steps, and that is the plan.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report (see
`.claude/agents/api.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/prisma/schema.prisma` | Modified | `UserShow` model; `User.shows`; `Show.users`; `Show.seasonsSyncedAt DateTime?` |
| `services/api/prisma/migrations/<ts>_add_user_shows_and_seasons_synced_at/` | New | Generated, never hand-written |
| `services/api/src/media/media.module.ts` | New | Imports `MoviesModule` + `ShowsModule`; provides the resolver and the dispatch |
| `services/api/src/media/media.resolver.ts` | New | `searchMedia` query + `addMedia` mutation |
| `services/api/src/media/media-dispatch.service.ts` | New | The lookup from media type to service. **The file AC-16 greps** |
| `services/api/src/media/media-type.interface.ts` | New | The two-method contract |
| `services/api/src/media/entities/media-search-result.entity.ts` | New (moved) | From `src/movies/entities/`, with `movieId` → `mediaId` |
| `services/api/src/media/entities/media-ref.entity.ts` | New | `{ id: Int!, type: String! }` |
| `services/api/src/movies/entities/media-search-result.entity.ts` | **Deleted** | Moved, not copied — two copies is a divergence waiting to happen |
| `services/api/src/movies/movies.service.ts` | Modified | `searchMovies` → `search`, `addMovie` → `register` (returns `MediaRef`), `movieId` → `mediaId`, entity import path. Nothing else |
| `services/api/src/movies/movies.resolver.ts` | Modified | Drops the `searchMovies` query and the `addMovie` mutation, and the now-unused `MediaSearchResult` import |
| `services/api/src/movies/movies.module.ts` | Modified | `exports: [MoviesService]` |
| `services/api/src/movies/movies.service.spec.ts` | Modified | Renamed methods; `addMovie`'s case now asserts a `MediaRef` |
| `services/api/src/shows/shows.module.ts` | New | Mirrors `movies.module.ts` |
| `services/api/src/shows/shows.service.ts` | New | `search` / `register` / hydration, hard-coded to `'tv'` |
| `services/api/src/shows/shows.service.spec.ts` | New | Article IX suite — see § Tests |
| `services/api/src/app.module.ts` | Modified | Registers `MediaModule` |
| `services/api/src/schema.gql` | Regenerated | Never hand-edited (Constitution, Article IV) |

A new module not on this list means the plan missed something — report it rather than adding it
quietly.

## Existing code to reuse

- **`src/clients/tmdb/client.ts`** — already series-ready and currently half-unused. `search<T>(thing,
  query)` takes the TMDB path segment directly (pass `'tv'`); `details(MEDIA_TYPE.SHOW, id)` returns
  a fully mapped `ShowDetail` **including `seasons: SeasonSummary[]`**, so the season list costs no
  extra request; `seasonDetails(id, seasonNumber)` returns `EpisodeDetail[]` and has **never been
  called by anything** — this feature is its first caller. `posterUrl(posterPath)` is exported for
  exactly this reason: use it on both the search path and the cold-cache path so the same series can
  never end up with two different poster sizes.
- **`src/clients/tmdb/types.ts`** — `TmdbShow` (note: `name` and `first_air_date`, not `title` /
  `release_date`), `TmdbShowDetails`, `TmdbSeasonDetails`, `TmdbEpisode` are all already declared.
  Do not add new wire types.
- **`src/clients/types.ts`** — `MediaSearchResult` is the **Redis-cached** shape and deliberately has
  no `mediaId`/`inLibrary`. Cache exactly this type; that is what makes REQ-7 structural rather than
  a convention.
- **`src/movies/movies.service.ts`** — the structural reference for the whole `ShowsService`.
  `cacheMovies` (best-effort pipeline, errors logged and swallowed), `getCachedMovie` /
  `fetchMovieFromTMDB` (Redis as source, catalog as fallback, `NotFoundException` only when the
  catalog itself does not know the id), `linkUserToMovie` (`upsert`, not `create`, so a
  double-clicked button cannot raise P2002), and `enrichWithOwnership` (one `findMany` per page, not
  one per result). Copy the **structure** into `ShowsService`; do not extract a base class, a
  generic helper or a shared mixin — `../spec.md` § Out of Scope forbids it explicitly.
- **`src/uploads/upload-tickets.service.ts`** — `verifyAndSpend`'s `redis.set(key, '1', 'EX', ttl,
  'NX')` is the atomic single-winner claim NFR-5 needs. Its comment explains why a GET-then-SET
  passes a single-request test and still races.
- **`src/settings/settings.module.ts`** — already exports `TmdbClient`. `ShowsModule` imports
  `SettingsModule` for it and `RedisModule` for the cache, exactly as `MoviesModule` does. Do not
  re-provide `TmdbClient` anywhere.
- **`src/auth/decorators/current-user.decorator.ts`** + `auth.types.ts` — `@CurrentUser() principal:
  AuthPrincipal`, narrowed with `principal.type === 'user' ? principal.id : ''`, is the established
  pattern in `movies.resolver.ts`. Follow it verbatim.

## Steps

Ordered. Each is small enough to be one task.

1. **Schema + migration.** Add `UserShow` (mirroring `UserMovie` field for field: `userId`/`showId`,
   `@@id([userId, showId])`, `@@index([showId])`, both relations `onDelete: Cascade`,
   `@@map("user_shows")`), the `shows UserShow[]` field on `User`, the `users UserShow[]` field on
   `Show`, and `seasonsSyncedAt DateTime?` on `Show`. Generate with
   `bin/npm api run prisma:migrate`. Confirm `bin/mysql -e 'select count(*) from shows'` returns 0
   first — if not, stop and report (see `../plan.md` § Migrations).

2. **Move the search-result entity.** Create `src/media/entities/media-search-result.entity.ts` as a
   move of the movies one, renaming the field `movieId` → `mediaId` and updating its doc comment to
   say "the id of the registered row, in whatever table `type` names". Delete the original. Update
   the import in `movies.service.ts`. Add `src/media/entities/media-ref.entity.ts` — an
   `@ObjectType()` with `@Field(() => Int) id: number` and `@Field() type: string`.

   *No circular dependency here, despite appearances:* `MoviesModule` never imports `MediaModule`;
   it imports a plain entity class file that itself imports nothing from `movies/`. Do not solve a
   cycle that does not exist by keeping a second copy of the entity.

3. **The contract.** `src/media/media-type.interface.ts`, exactly the two methods frozen in
   `../spec.md` § Decided During Specification:

   ```ts
   search(query: string, userId: string): Promise<MediaSearchResult[]>;
   register(tmdbId: number, userId: string): Promise<MediaRef>;
   ```

   Nothing else goes on this interface — not a cache key, not an endpoint, not a "type" getter.
   Every implementation detail is private to the implementation.

4. **Move `MoviesService` behind it.** Rename `searchMovies` → `search` and `addMovie` → `register`;
   `register` keeps its whole existing body and returns `{ id: movie.id, type: MEDIA_TYPE.MOVIE }`
   instead of the Prisma row (both branches — the already-registered one and the freshly-created
   one). Rename `movieId` → `mediaId` in `enrichWithOwnership`'s returned object. Declare
   `implements MediaTypeService`. **Change nothing else in this file** — not the hard-coded
   `'movie'` on line 162, not `cacheKey`, not the ordering comment at line 175, not
   `addTorrentToMovie`/`addMagnetToMovie`. Then strip `searchMovies`/`addMovie` from
   `movies.resolver.ts` and add `exports: [MoviesService]` to `movies.module.ts`.

5. **`ShowsService`.** Its structural twin, in a new `src/shows/`:
   - `search(query, userId)` — blank query returns `[]` without touching the catalog (REQ-5);
     `this.tmdb.search<TmdbShow>('tv', query)` with `'tv'` **hard-coded here, deliberately**, the
     same way `MoviesService` hard-codes `'movie'`; map `name` → `title` and `first_air_date` →
     `releaseDate` (a `""` becomes `null`), `type: MEDIA_TYPE.SHOW`; then **`void this.cacheShows(results)`
     before `await this.enrichWithOwnership(...)`** — read the comment at `movies.service.ts:175`
     before writing this line, it is the single most dangerous ordering in the feature (NFR-3).
   - Cache key `tmdb:show:${tmdbId}` — the `MEDIA_TYPE.SHOW` value, not TMDB's `tv` (AC-3 greps for
     `tmdb:show:`). Same 24h TTL, same best-effort pipeline that logs and swallows.
   - `register(tmdbId, userId)` — `findUnique({ where: { tmdbId } })`; if found, link the caller
     (`prisma.userShow.upsert`, not `create`) and, **if `seasonsSyncedAt` is `null`, kick the
     hydration again** (REQ-14 — this is the retry path, and it is easy to miss because the happy
     path never reaches it). If not found, read `tmdb:show:<id>` from Redis, falling back to
     `tmdb.details(MEDIA_TYPE.SHOW, tmdbId)` and throwing
     `NotFoundException('No encontramos la serie en el catálogo')` when the catalog itself does not
     know it; create the `Show`, link the caller, kick the hydration. Return `{ id, type: MEDIA_TYPE.SHOW }`
     in both branches. Guard every date: `value ? new Date(value) : undefined` — TMDB sends `""`,
     and `new Date('')` is an Invalid Date that Prisma writes or rejects unpredictably.
   - `hydrate(showId, tmdbId)` — detached (`void this.hydrate(...)`, never awaited by `register`,
     REQ-13) and **it must not be able to reject into an unhandled promise**: the whole body is a
     `try`/`catch`/`finally`.
     - First, claim: `redis.set('show:hydrate:' + tmdbId, '1', 'EX', <ttl>, 'NX')`. Not `'OK'` means
       another registration is already fetching this series — return immediately (NFR-5).
     - `tmdb.details(MEDIA_TYPE.SHOW, tmdbId)` gives `ShowDetail.seasons` in one request. Then, for
       each season, **sequentially** — a `for … of` with `await` inside, **not** `Promise.all`
       (NFR-6): `upsert` the `Season` on `@@unique([showId, seasonNumber])`, call
       `tmdb.seasonDetails(tmdbId, seasonNumber)`, and `upsert` each `Episode` on
       `@@unique([seasonId, episodeNumber])`. Upserts everywhere, so a lost race or a retry
       overwrites rather than duplicating. Season `0` is stored like any other — no filter (REQ-12).
     - Only after every season and every episode is written:
       `prisma.show.update({ where: { id: showId }, data: { seasonsSyncedAt: new Date() } })`.
       Any earlier and REQ-14 is broken.
     - `catch` logs with `console.error` including the tmdbId (NFR-4 — this is the only trace a
       failure leaves besides the `null` column). `finally` deletes the claim key, so a failure does
       not wedge every future retry until the TTL.
   - `src/shows/shows.module.ts` mirrors `movies.module.ts`: `imports: [RedisModule, SettingsModule]`,
     `providers: [ShowsService]`, `exports: [ShowsService]`. **No resolver** — `shows`/`show(id)` are
     Out of Scope and adding one would put a type in the schema the delta does not have.

6. **The dispatch.** `src/media/media-dispatch.service.ts` — inject `MoviesService` and
   `ShowsService`, build one `Record<MediaType, MediaTypeService>`, and expose a single
   `resolve(type: string): MediaTypeService` that throws
   `BadRequestException(\`Tipo de medio no soportado: ${type}\`)` for anything not in it (AC-9;
   the message is exact, and it is the *only* user-facing string that lives above the per-type
   services).

   **This file is what AC-16 greps.** It must not mention `season`, `episode`, `tmdb`, `'tv'` or
   `prisma` — which also means `resolve()` returns the service and the *resolver* calls `search` /
   `register` on it. Do not add pass-through `search(query, type, userId)` wrappers here: `tmdbId`
   as a parameter name would put `tmdb` in the file and fail the criterion, and the wrapper buys
   nothing.

7. **The resolver.** `src/media/media.resolver.ts` — `@Query(() => [MediaSearchResult], { name:
   'searchMedia' })` and `@Mutation(() => MediaRef, { name: 'addMedia' })`, both taking
   `@Args('type') type: string` alongside their existing argument, both reading the caller via
   `@CurrentUser()` and narrowing to a user id the way `movies.resolver.ts` does. **Neither carries
   `@AllowService()`** (NFR-7) — that is the default, so this is a "do not add it", and it is worth
   a second look during review because copying a decorator block is how it would arrive. Register
   `MediaModule` in `app.module.ts`.

8. **Regenerate and check the schema.** Boot the stack; `src/schema.gql` regenerates itself. Confirm
   the diff matches `../spec.md` § GraphQL Contract Delta exactly — `MediaRef` and `searchMedia`/
   `addMedia` present, `searchMovies`/`addMovie` gone, `MediaSearchResult.mediaId` replacing
   `movieId`, and `type MediaSource`'s own `movieId` **untouched** (NFR-1b).

## Contract obligations

`api` is the producer, so it owes the exact shape in `../spec.md` § GraphQL Contract Delta and
nothing more:

- `searchMedia(query: String!, type: String!): [MediaSearchResult!]!`
- `addMedia(tmdbId: Int!, type: String!): MediaRef!`
- `MediaSearchResult` with `mediaId: Int` (nullable) and `inLibrary: Boolean!`
- `MediaRef { id: Int!, type: String! }`
- `searchMovies` and `addMovie` removed; `movies`, `movie(id)`, `addTorrentToMovie`,
  `addMagnetToMovie` and `MediaSource.movieId` all unchanged

And it owes the error table, which is as much of the contract as the SDL is — `web` has no codegen
and no way to discover a condition that is not written down:

| Condition | Exception | Message |
| :-- | :-- | :-- |
| blank / whitespace `query` | none | `[]`, catalog not contacted |
| unsupported `type` | `BadRequestException` | `Tipo de medio no soportado: <type>` |
| TMDB unreachable / no API key | whatever `TmdbClient` throws | the catalog's own text |
| `addMedia`, unknown `tmdbId`, cold cache | `NotFoundException` | `No encontramos la serie en el catálogo` (show) / `No encontramos la película en el catálogo` (movie) |
| hydration fails after registering | none | mutation already returned; `seasonsSyncedAt` stays `NULL` |

The delta is read-only. If it is wrong, stop and report — do not adapt it locally (Constitution,
Article VIII).

## Tests

`bin/npm api test`. Article IX: tests are owed where failure is silent, and this slice has three
such places, all in `ShowsService`.

- **`src/shows/shows.service.spec.ts`** — new. Opens with a header comment naming the failures it
  defends against, in the shape of `src/movies/movies.service.spec.ts:9-26`, in English. Four cases:
  - *Cache before enrich.* Asserts on the object handed to the Redis pipeline — `tmdb:show:<id>` as
    the key, and the parsed JSON having **neither** `mediaId` **nor** `inLibrary`. Asserting on the
    return value cannot catch this: the returned value is correct either way, which is exactly why
    the bug survives review. `movies.service.spec.ts:82` is the template. **This case is required
    even though `005-movie-search` already has it for films** — the invariant is implemented
    separately per service, so it can break separately (NFR-3).
  - *Caller scoping.* Asserts the `where` clause of `prisma.show.findMany` inside
    `enrichWithOwnership` filters `users: { some: { userId } }`. A mocked Prisma returns whatever it
    was told regardless of the query, so the call arguments are the only observable.
  - *`register` on an already-registered series.* Creates no second `Show`, upserts the link, and
    tolerates being called twice — the double-clicked-button case.
  - *`seasonsSyncedAt` is set only on complete success.* Make `seasonDetails` reject on the second
    season and assert `prisma.show.update` was never called with `seasonsSyncedAt`, and that the
    claim key was deleted. This is NFR-4 and the claim half of NFR-5 in one case; a partial fetch
    that marks itself complete is permanently invisible.
- **`src/movies/movies.service.spec.ts`** — modified, not rewritten. Its four existing cases stay
  and must still pass; only the method names change and the `addMovie` case now asserts
  `{ id: 5, type: 'movie' }` instead of the Prisma row. If any of the other three needs changing,
  something in step 4 went beyond its scope — stop and report.

Not owed a test, with reasons: `MediaDispatchService` — its failure is `BadRequestException` on
every call, loud and immediate, and AC-9 exercises it live; `MediaResolver` — a thin argument-passing
layer whose breakage is a GraphQL error on the first call (and `users.resolver.spec.ts` is the
scaffolding Article IX names as the thing not to imitate); `MediaRef` / `MediaSearchResult` entities —
decorators with no logic, verified by the `schema.gql` diff.

## Done when

```bash
bin/npm api run prisma:migrate
```

```bash
bin/cli api npx --no tsc --noEmit
```

```bash
bin/npm api test
```

```bash
grep -n "searchMedia\|addMedia\|MediaRef\|mediaId\|movieId" services/api/src/schema.gql
```

```bash
grep -niE "season|episode|tmdb|'tv'|prisma" services/api/src/media/media-dispatch.service.ts
```

Expected: the migration applies and `git status services/api/prisma/` shows both a modified
`schema.prisma` and a new migration directory (Constitution, Article III). Typecheck **0 errors** —
the same count as before this feature, so report the before and after numbers. All suites green
(80 tests / 9 suites beforehand, plus `shows.service.spec.ts`). The first grep shows `searchMedia`,
`addMedia`, `MediaRef`, `MediaSearchResult.mediaId` and — still — `MediaSource.movieId` and the
three mutation arguments, and shows no `searchMovies`/`addMovie`. The second grep returns **nothing**
(AC-16).

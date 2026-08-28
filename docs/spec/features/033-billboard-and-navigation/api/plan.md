---
title: Billboard and Navigation — api slice
service: api
last_updated: 2026-08-28
status: Implemented
---

# PLAN: Billboard and Navigation — `api` (`api/plan.md`)

## Scope

This slice adds one query, `popularMedia(type: String!)`: TMDB's popular list for a media type,
cached in Redis for a day, enriched per caller with the ownership fields `MediaSearchResult` already
carries. It also adds one key to the frozen error vocabulary, `error.media.catalog_unavailable`, and
its English template.

Not this slice: every route, label and pixel. `web` owns the sidebar, the move of the billboard to
`/`, the landing at `/perceptor`, the carousel and the two empty routes — none of which this service
can see. There is **no schema change and no migration** here; a `prisma/` diff on this feature is a
signal that something went wrong.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/clients/tmdb/popular.ts` | New | Pure mappers from TMDB's popular rows to catalog-only `MediaSearchResult`, one per media type. Sibling of `multi.ts`. |
| `src/clients/tmdb/client.ts` | Modified | New `popular(type, language)`; `fetchPage` generalised over a private `fetchResults(endpoint, params)` so a `query`-less endpoint is expressible. |
| `src/media/popular-media.service.ts` | New | The list cache, the locale resolution, the TMDB call, and the hand-off to `cacheAndEnrich`. |
| `src/media/popular-media.service.spec.ts` | New | The three silent failures below. |
| `src/media/media.resolver.ts` | Modified | The `popularMedia` query. |
| `src/media/media.module.ts` | Modified | Registers `PopularMediaService`. |
| `src/i18n/error-keys.ts` | Modified | `MEDIA_CATALOG_UNAVAILABLE`. |
| `src/i18n/messages.en.ts` | Modified | Its English template. |
| `src/schema.gql` | Regenerated | Boot artifact — never hand-edited (Constitution, Article IV). |

## Existing code to reuse

- `src/media/media-search.service.ts` — the structural model for the whole slice: a service in
  `media/` that fetches once, maps, then hands each type's rows to
  `mediaDispatch.resolve(type).cacheAndEnrich(rows, userId)`. Follow it; do not invent a different
  arrangement.
- `src/media/media-dispatch.service.ts` — `resolve(type)` already throws
  `MEDIA_UNSUPPORTED_TYPE`. Call it **first**, before any Redis read or TMDB call, so an unsupported
  type costs nothing (spec REQ-15).
- `src/media/media-type.interface.ts`'s `cacheAndEnrich` — the cache-then-enrich ordering, already
  written twice and tested twice. This slice adds no third copy and adds no method to this interface.
- `src/clients/tmdb/multi.ts` — the mapper file to copy in structure: pure functions, a doc link to
  the TMDB reference, `posterUrl()` from `client.ts` for every poster so image sizes can never
  disagree between two code paths.
- `src/clients/tmdb/types.ts`'s `TmdbMovie`/`TmdbShow` and `TmdbSearchResponse<T>` — the popular
  endpoints return the same row shapes and the same `{ results }` envelope as search. Do not declare
  new row interfaces.
- `src/movies/movies.service.ts`'s `cacheMovies` — the best-effort Redis write: a pipeline, `EX` with
  the 24h TTL, failures logged and swallowed. The list cache follows it. `TMDB_CACHE_TTL_SECONDS`
  lives there as a private constant; this slice declares its own rather than exporting that one
  across module boundaries.
- `src/redis/redis.service.ts` — the ioredis client, injected as-is.
- `src/settings/settings.service.ts`'s `getMap()` — how `ui_locale` is read. `MediaModule` already
  imports `SettingsModule`.
- `src/i18n/locales.ts`'s `SUPPORTED_LOCALES`/`isSupportedLocale` — the clamp. Never hardcode
  `'en'`/`'es'` beside it.
- `src/i18n/i18n-error.ts`'s `i18nError.serviceUnavailable(key)` — the keyed throw.

## Steps

1. **`popular.ts`** — `mapPopularMovies(rows: TmdbMovie[])` and `mapPopularShows(rows: TmdbShow[])`,
   returning `MediaSearchResult[]` from `@/clients/types` (the catalog-only shape, no `mediaId`, no
   `inLibrary`). Same field mapping the two services' `search()` methods already use: a film's
   `title`/`release_date`, a series' `name`/`first_air_date`, `posterUrl(poster_path)`, `overview`,
   `original_language`, and the `MEDIA_TYPE` literal. Carry the TMDB reference URLs as the file's
   one permitted comment (Constitution, Article XI, exception 1).
2. **`TmdbClient`** — extract the URL build + fetch + `res.ok` check + `TmdbSearchResponse` unwrap of
   `fetchPage` into a private `fetchResults<T>(endpoint, params: Record<string, string>)`, and have
   `fetchPage` call it with `{ query, page }`. `fetchPage`'s signature and behaviour do not change —
   `search`, `searchMulti` and every caller are untouched. Then add
   `popular(type: MediaType, language: string): Promise<MediaSearchResult[]>`: `movie/popular` or
   `tv/popular` via the existing `TMDB_ENDPOINT` map, `{ language, page: '1' }` and **no `region`**,
   the matching mapper from step 1.
3. **`PopularMediaService.list(type, userId)`** — in this order, and only this order:
   1. `this.mediaDispatch.resolve(type)` — throws for an unsupported type before anything else runs.
   2. `resolveCatalogLocale(userId)` (step 4).
   3. Read `tmdb:popular:<type>:<locale>`. A hit is parsed as `MediaSearchResult[]`; a parse failure
      or a Redis error is logged and treated as a miss.
   4. On a miss, `this.tmdb.popular(type, locale)` inside a `try`/`catch` that rethrows anything as
      `i18nError.serviceUnavailable(ERROR_KEYS.MEDIA_CATALOG_UNAVAILABLE)`. The `catch` wraps the
      TMDB call **only** — a Redis failure must never surface as a catalog error.
   5. Write the fetched rows to the list key with `EX` 86400, best-effort: errors logged, never
      thrown, never awaited into the response path.
   6. `return service.cacheAndEnrich(rows, userId)` — the per-title cache write and the caller's
      ownership, unchanged.
   Step 5 must operate on the rows as they came from the mapper. `cacheAndEnrich` builds new objects
   rather than mutating, but the ordering is the invariant, not the immutability: write, then enrich.
4. **`resolveCatalogLocale(userId)`** — private. `prisma.user.findUnique({ where: { id: userId },
   select: { uiLocale: true } })` when `userId` is non-empty, else the settings map's `ui_locale`,
   else `en`; every candidate passes `isSupportedLocale` before it is accepted, and the fallback
   chain continues past an unsupported value rather than using it.
5. **`media.resolver.ts`** — `@Query(() => [MediaSearchResult], { name: 'popularMedia' })`, one
   `@Args('type')`, `@CurrentUser() principal`, and the same
   `principal.type === 'user' ? principal.id : ''` narrowing its two neighbours use. **No
   `@AllowService()`** (spec NFR-2) and no `@Public()`.
6. **`media.module.ts`** — add `PopularMediaService` to `providers`.
7. **Error key** — `MEDIA_CATALOG_UNAVAILABLE: 'error.media.catalog_unavailable'` in the "movies,
   shows, seasons, episodes" block beside `MEDIA_UNSUPPORTED_TYPE`, and its template in
   `messages.en.ts`: `Could not reach the catalog. Check the TMDB API key.` (`messages.en.spec.ts`
   already fails if a key has no template.)

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

```graphql
type Query {
  popularMedia(type: String!): [MediaSearchResult!]!
}
```

- 20 items, page 1, in TMDB's own order — no re-sorting, no filtering, no de-duplication against the
  user's library.
- `MediaSearchResult` is unchanged. Every field it declares is populated, including the ones the
  billboard does not render.
- `type` outside `movie`/`show` → `BadRequestException` / `error.media.unsupported_type`.
- A TMDB failure → `ServiceUnavailableException` / `error.media.catalog_unavailable`.
- A Redis failure is **not** a contract condition: it is invisible to the caller.

## Tests

Three failures in this slice produce no error anywhere, and all three are `popular-media.service.spec.ts`
(header paragraph naming them, per Article IX). Use the house fault-injection technique: each case
must be verified to fail when the rule it covers is removed.

- **Ownership in the shared list cache.** Assert the string handed to Redis parses to rows carrying
  neither `mediaId` nor `inLibrary`, while the returned value carries both. Injection: move the write
  after `cacheAndEnrich` and watch it fail. Without this, one user's library is served to every other
  user for 24 hours with no error.
- **The locale clamp.** A user whose `uiLocale` is `de` (or any unsupported value) must produce the
  `:en` key, and an unset `uiLocale` with `ui_locale = es` must produce `:es`. Injection: drop the
  `isSupportedLocale` guard. Without this, the key space and the TMDB call budget grow silently.
- **Unsupported type costs nothing.** `popularMedia(type: 'person')` throws and neither the Redis
  client nor the `TmdbClient` was called. Injection: move `resolve(type)` below the cache read.

Not owed a test: `popular.ts`'s mappers (a wrong field shows up as a wrong poster on screen
immediately) and the resolver wiring (the query either exists in `schema.gql` or it does not).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
```

`tsc` reports 0 errors, the suite is green with the new spec file counted, and
`git status services/api/prisma/` is clean. `src/schema.gql` shows `popularMedia` as a regeneration
artifact, matching the delta above exactly.

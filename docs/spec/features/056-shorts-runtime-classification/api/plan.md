---
title: Shorts classified by runtime — api slice
service: api
last_updated: 2026-09-14
status: Implemented
---

# PLAN: Shorts classified by runtime — `api` (`api/plan.md`)

## Scope

Two pieces of work in one slice, in this order: remove `addMedia(asShort:)` and everything that only
existed to guard it, then replace the value it carried with a derivation inside
`MoviesService.register()` — a film TMDB reports under 40 minutes registers as a short.

This slice goes **second**, after `web` has stopped sending `asShort` (`../plan.md` § Order of Work).
Confirm that before starting: `grep -rn asShort services/web/src` must return nothing.

There is **no Prisma migration and no schema change**. `Movie.isShort` already exists with the right
type and default. `git status --short services/api/prisma` must still be empty when this slice
finishes.

`setMovieShort` and `MoviesResolver` are untouched — the manual toggle keeps its behaviour, its guard
order and its error keys (`../spec.md` REQ-9). `worker` and `web` are not this slice's business.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/media/media.resolver.ts` | Modified | `addMedia` loses the `asShort` argument and both guards that read it; the `MEDIA_TYPE`, `i18nError` and `ERROR_KEYS` imports go with them |
| `src/media/media-type.interface.ts` | Modified | `register(tmdbId, userId)` — the `options?: { asShort?: boolean }` parameter and its comment block are removed |
| `src/clients/types.ts` | Modified | `MediaSearchResult` gains `runtime?: number \| null` — the internal cache shape only |
| `src/movies/movies.service.ts` | Modified | The threshold constant and predicate, the `MediaCapabilitiesService` dependency, the derivation in `register()`, and the runtime top-up in `getCachedMovie()` / `fetchMovieFromTMDB()` |
| `src/i18n/error-keys.ts` | Modified | `MEDIA_SHORTS_NOT_A_MOVIE` removed |
| `src/i18n/messages.en.ts` | Modified | Its English rendering removed |
| `src/media/media.resolver.spec.ts` | Modified | The `addMedia(asShort:) guards` suite is deleted; two surviving assertions drop their `{ asShort: undefined }` third argument |
| `src/movies/movies.service.spec.ts` | Modified | A `MediaCapabilitiesService` mock is added to the `TestingModule`; new cases cover the derivation |

`src/schema.gql` regenerates on boot — never hand-edit it.

`src/shows/shows.service.ts` needs **no** change: it already has the narrow two-parameter `register`.

## Existing code to reuse

- **`MediaCapabilitiesService.isShortsEnabled()`** (`src/media/media-capabilities.service.ts`) — the
  effective `movies_enabled && shorts_enabled`, already computed in one place. Call this, never
  re-derive the `&&`, and never read the `shorts_enabled` Settings row directly.
- **`MediaCapabilitiesModule`** — already in `MoviesModule`'s `imports` (it is there for
  `MoviesResolver`), so injecting the service into `MoviesService` needs no module edit and creates
  no circular dependency.
- **`MoviesService.cacheKey(tmdbId)`** — the one definition of `tmdb:movie:<id>`, already shared by
  the search write and the register read. Do not introduce a second key for runtimes.
- **`MoviesService.cacheMovies(results)`** — the best-effort pipeline write at `TMDB_CACHE_TTL_SECONDS`
  that already swallows and logs its own errors. Reuse it for the write-back; do not call
  `redis.set` directly.
- **`TmdbClient.details(MEDIA_TYPE.MOVIE, id)`** — already returns `MovieDetail.runtime`. This is the
  only TMDB call this feature adds, and `fetchMovieFromTMDB()` already makes it on the cold path.
- **`sanitizeTag` / `movieTags`** at the top of `movies.service.ts` — the precedent for a module-level
  constant plus a small pure predicate beside it. Put `SHORT_MAX_RUNTIME_MINUTES` and the predicate
  there, in the same style.

## Steps

**Part 1 — the contract removal.** Do this first; Part 2's tests are written against the signature
it leaves behind.

1. `src/media/media.resolver.ts`: delete the `@Args('asShort', …)` parameter, the
   `if (asShort && type !== MEDIA_TYPE.MOVIE)` throw, the `if (asShort) assertShortsEnabled()` call,
   and the `048-shorts-category REQ-14` comment above them. The dispatch call becomes
   `.register(tmdbId, userId)`. Remove the now-unused `MEDIA_TYPE`, `i18nError` and `ERROR_KEYS`
   imports — nothing else in this file uses them; the typecheck will confirm.
2. `src/media/media-type.interface.ts`: `register(tmdbId: number, userId: string): Promise<MediaRef>`,
   with the `options.asShort` comment block deleted.
3. `src/i18n/error-keys.ts` and `src/i18n/messages.en.ts`: remove `MEDIA_SHORTS_NOT_A_MOVIE` and its
   message. Leave `MEDIA_SHORTS_DISABLED` alone — `setMovieShort` still raises it.
4. `src/media/media.resolver.spec.ts`: delete the whole
   `describe('MediaResolver addMedia(asShort:) guards', …)` block including its header comment, and
   change the two surviving `expect(register).toHaveBeenCalledWith(1399, 'u1', { asShort: undefined })`
   assertions to `toHaveBeenCalledWith(1399, 'u1')`.

**Part 2 — the derivation.**

5. `src/clients/types.ts`: add `runtime?: number | null;` to the `MediaSearchResult` interface (the
   one in this file, with the comment warning it is not the `@ObjectType` of the same name). Add
   nothing to `src/media/entities/media-search-result.entity.ts` — see § Contract obligations.
6. `src/movies/movies.service.ts`, module scope, beside `sanitizeTag`/`movieTags`:
   `const SHORT_MAX_RUNTIME_MINUTES = 40;` and a predicate over `number | null | undefined` that
   returns true only for a real number greater than 0 and strictly less than the constant. `0`,
   `null` and `undefined` all mean "TMDB has no duration for this title" and must return false
   (`../spec.md` REQ-5). Strict `<`: exactly 40 is a feature film.
7. Same file: inject `MediaCapabilitiesService` into the constructor, after
   `mediaServerReconcile`.
8. `fetchMovieFromTMDB()`: include `runtime: detail.runtime ?? null` in the object it returns. Its
   `catch` → `error.movie.not_in_catalog` is unchanged.
9. `getCachedMovie()`: on the Redis-miss branch, pass the freshly fetched object through
   `void this.cacheMovies([fetched])` before returning it, so a cold registration leaves the cache
   populated with the runtime included (`../spec.md` REQ-6). The warm branch returns the parsed
   object as before.
10. Same file, a new private `deriveIsShort(cached: MediaSearchResult): Promise<boolean>`, in this
    exact order:
    a. `if (!(await this.mediaCapabilities.isShortsEnabled())) return false;` — **first**, before any
       HTTP. With shorts off there is no consumer for the value, so there must be no TMDB call
       (`../spec.md` REQ-8, NFR-1).
    b. If `cached.runtime` is already a number, classify from it and return — no call.
    c. Otherwise call `TmdbClient.details()` for `cached.id` inside a `try`. On success, classify
       from `detail.runtime ?? null` and write `{ ...cached, runtime }` back through
       `void this.cacheMovies([...])`. On failure, return `false` and **write nothing** — a
       `runtime: null` produced by an outage must not be pinned for 24 hours (`../spec.md` NFR-2).
11. `register()`: after `const cached = await this.getCachedMovie(tmdbId);`, replace
    `isShort: options?.asShort === true` in the `create` call with the awaited `deriveIsShort(cached)`.
    Drop the `options` parameter from the signature. The early-return branch for an already-registered
    film is **unchanged** — it must not call `deriveIsShort` at all (`../spec.md` REQ-7); keep its
    `048-shorts-category REQ-6` comment, which is still exactly right.
12. `src/movies/movies.service.spec.ts`: add a `mediaCapabilities` mock
    (`{ isShortsEnabled: jest.fn().mockResolvedValue(true) }`) to the `let` block, the `beforeEach`
    and the `providers` array, following the `mediaServerReconcile` entry directly above it. Then the
    cases in § Tests.
13. Run the § Done when commands.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta — read-only. One argument leaves; nothing is added:

```graphql
type Mutation {
  addMedia(tmdbId: Int!, type: String!): MediaRef!
}
```

`git diff services/api/src/schema.gql` after a boot must show **exactly one hunk**: `addMedia` losing
`asShort: Boolean`. Anything else is an unreported contract change (Constitution, Article VIII).

**`runtime` must not reach the schema.** It goes on `MediaSearchResult` in `src/clients/types.ts` and
nowhere else. The `@ObjectType` in `src/media/entities/media-search-result.entity.ts` is a different
type that happens to share the name; giving it a `@Field()` would publish a field no consumer asked
for and would break the hunk count above. A duration per search result is exactly the cost NFR-1
exists to avoid.

Errors after this slice, all pre-existing:

| Condition | Error |
| :-- | :-- |
| `addMedia` for a disabled type | `error.media.type_disabled` (403) |
| `addMedia` for an unknown `tmdbId` | `error.movie.not_in_catalog` (404) |
| `setMovieShort` with shorts not effectively enabled | `error.media.shorts_disabled` (403) |
| `setMovieShort` for an unowned or missing film | `error.movie.not_found` (404) |

A runtime that cannot be resolved raises **nothing**. Registration succeeds as a feature film.

## Tests

`services/api/CLAUDE.md` § Tests is the convention: `media-roots.service.spec.ts` /
`magnet.spec.ts` structure, English `it(...)` strings in the indicative, and fault injection — each
new case must be verified to fail when the rule it covers is removed. The existing
`movies.service.spec.ts` header comment gains a bullet naming the new class of failure rather than a
second header.

Owed, all in `src/movies/movies.service.spec.ts`, under a `describe('register (short classification)')`:

- **A runtime under 40 registers `isShort: true`, one of 40 or more registers `false`.** Assert on
  `prisma.movie.create.mock.calls[0][0].data.isShort`. Include the boundary at exactly `40` — an
  off-by-one here files a feature film under `path_shorts`, and 048 guarantees nothing ever moves it
  back. Nothing fails; the file is simply in the wrong folder forever.
- **`runtime: 0`, `null` and absent all register `false`.** TMDB returns `0` for titles it has no
  duration for, and a truthiness check would classify them as shorts. Silent in exactly the same way.
- **Shorts disabled means `isShort: false` and no TMDB call.** Assert both:
  `create.mock.calls[0][0].data.isShort === false` *and* `tmdb.details` not called. The second half
  is the one that catches a capability check placed after the fetch — a cost with no symptom.
- **A warm cache entry without a runtime triggers exactly one `tmdb.details` call, and the result is
  written back through the pipeline.** Assert the object handed to `redis.pipeline().set` carries the
  runtime, following the existing `search` suite's technique for inspecting the pipeline.
- **A cached runtime triggers no `tmdb.details` call.** This is REQ-6/NFR-1's whole point, and its
  failure is invisible: registration works fine, it just costs a TMDB request every time.
- **`tmdb.details` rejecting during the top-up still registers the film, as `isShort: false`, and
  writes nothing to Redis.** NFR-2 plus the cache-poisoning guard. A registration that throws here
  would be a user-visible failure over a decoration; a write-back here would pin the wrong answer
  for 24 hours.
- **An already-registered film never reaches `deriveIsShort`.** Extend the existing
  `describe('register')` case: with `prisma.movie.findUnique` returning a row, assert
  `mediaCapabilities.isShortsEnabled` and `tmdb.details` were never called and `prisma.movie.update`
  never ran. REQ-7 — a derivation that overrode a user's manual reclassification would be silent and
  would recur on every other user's add.

Must stay green, unmodified — do **not** adjust either to fit:

- `movies.service.spec.ts`'s existing `expect(cached).not.toHaveProperty('isShort')` — 048's rule
  that the per-installation flag never enters the shared Redis shape. `runtime` may be on that
  object; `isShort` may not.
- The `TMDB fallback (cold Redis cache)` suite — the cold path still maps `posterUrl` identically;
  it now also carries a runtime and writes back through `cacheMovies`, so its `redis.pipeline` mock
  may need a return value, but its assertions do not change.

Not owed: the removals in Part 1. Deleting an argument cannot fail silently — the typecheck and the
`schema.gql` diff both catch it.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
git status --short services/api/prisma
git diff services/api/src/schema.gql
grep -rn 'asShort\|shorts_not_a_movie' services/api/src
```

Expected: 0 typecheck errors; `bin/npm api test` green with the suite count at or above
`services/api/CLAUDE.md` § Current state (477 tests / 44 suites as of `055-environment-panel` —
re-run rather than trusting it); `git status` on `prisma` **empty**; the `schema.gql` diff exactly
one hunk; the `grep` returning **nothing**.

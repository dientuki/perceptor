---
title: Media Search and Registration, Parameterized by Media Type — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-12
status: Implemented
---

# PLAN: Media Search and Registration, Parameterized by Media Type (`plan.md`)

Cross-service plan. Per-service detail is in `api/plan.md` and `web/plan.md`; the frozen contract
and the requirements are in `spec.md`, which both agents read first.

## Approach

The feature is one seam plus one new implementation behind it.

**The seam.** A new `api` module `src/media/` holds `searchMedia`/`addMedia` and a dispatch that
turns the `type` argument into a service. `spec.md` § Decided During Specification fixes the
contract at two methods — `search(query, userId)` and `register(tmdbId, userId)` — and this plan
does not reopen it. The dispatch is a Nest provider that constructor-injects the per-type services
and holds one `Record<MediaType, MediaTypeService>`; it is the file AC-16 greps, and it must stay
free of anything that knows what a season, an episode or a Prisma model is.

**The implementations.** `MoviesService` (`services/api/src/movies/movies.service.ts`) is the first
one and is *reused as it stands* — this feature renames two of its methods, changes one return
shape, and touches nothing else in it. Its hard-coded `'movie'` at line 162, its `tmdb:movie:<id>`
cache key, its `cacheMovies` best-effort pipeline, its `enrichWithOwnership` single-query
enrichment, and its `fetchMovieFromTMDB` cold-cache fallback all stay exactly where they are.
`ShowsService` is the second, written as its structural twin against `Show`/`Season`/`Episode`.

The alternative that was actually on the table and rejected is recorded in `spec.md` (§ Context &
Goal, § Out of Scope): one generic service parameterized by a config object per type. It was
rejected because the per-type differences are not parameters — registering a series fetches
seasons and episodes and registering a film does not — and folding them into one algorithm is how
the conditionals this design exists to prevent get in.

**What is reused rather than rebuilt**, with paths, because a second way to do any of these is a
bug in this plan:

| Need | Existing code | Where |
| :-- | :-- | :-- |
| TMDB search, details, season details | `TmdbClient` — `search`, `details`, `seasonDetails` (already written, never called) | `services/api/src/clients/tmdb/client.ts` |
| `show` → `tv` path segment | `TMDB_ENDPOINT` + the `MEDIA_TYPE.SHOW` mapper in `mappers` | same file, already complete |
| Absolute poster URL | `posterUrl()` | same file, exported for exactly this |
| TMDB wire shapes for tv | `TmdbShow`, `TmdbShowDetails`, `TmdbSeasonDetails`, `TmdbEpisode` | `services/api/src/clients/tmdb/types.ts`, already declared |
| Best-effort cache write, cold-cache fallback, ownership enrichment | `cacheMovies` / `getCachedMovie` / `enrichWithOwnership` | `services/api/src/movies/movies.service.ts` — copied in structure, not extracted into a base class |
| Atomic single-winner claim (NFR-5) | Redis `SET … 'NX'` | `services/api/src/uploads/upload-tickets.service.ts:verifyAndSpend` |
| Fire-and-forget background work (REQ-13) | `void this.cacheMovies(results)` | `services/api/src/movies/movies.service.ts:182` |
| The search screen itself (REQ-15) | `SearchContainer` + `SearchInput` + `MediaList` + `MediaCard` | `services/web/src/components/search/`, `services/web/src/components/media/` |
| The unused `type` seam | `addAction: (id, type) => Promise<string>` | `services/web/src/components/search/SearchContainer.tsx:14` |

**Background hydration is a detached promise, not a queue.** REQ-13 requires that registration
returns without waiting; NFR-4 requires that failure is logged and leaves a persistent mark; NFR-5
requires that two concurrent registrations fetch once. That is `void this.hydrate(...)` after the
write, guarded by a Redis `SET … NX` claim, with `seasonsSyncedAt` as the mark — the same two
patterns the repo already uses, at `movies.service.ts:182` and `upload-tickets.service.ts`
respectively. BullMQ was considered and rejected: `bull:process` is the encode queue with a worker
on the other end, and adding a second queue with a second consumer would make the worker a third
service in this feature for work that is three HTTP calls and a handful of upserts.

## Order of Work

`api` first, entirely. `web` cannot query a field the schema does not have, and unlike an additive
change there is no version of `web`'s slice that works against both the old and the new contract:
`searchMovies` and `addMovie` cease to exist, so the moment `api` lands, `/movies/add` is broken
until `web` lands too.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration (`UserShow`, `seasonsSyncedAt`), owns the schema, and owns the contract both operations expose. Nothing in `web` can be written against it before it exists. |
| 2 | `web` | Consumes `searchMedia`/`addMedia` and the renamed `mediaId`. Its own slice is internally ordered: the shared pieces (`types/search.ts`, `actions/media.ts`, `SearchContainer`) before either page. |

**Nothing runs in parallel.** Two services can overlap once the contract is frozen, and it is —
but this feature's `web` slice is small enough that the coordination costs more than it saves, and
`/movies/add` is broken for the whole window between the two, which is a reason to keep the window
short rather than to run both at once and find out where the seam disagrees.

Between the two steps the stack is knowingly in a broken state. That is expected and is not a
defect to work around: do not add a compatibility shim, a deprecated `searchMovies` alias, or a
feature flag. `spec.md` NFR-1 requires both breaks to land.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. It is read-only to
both implementers. Four things in it will look wrong from inside one slice and are right for the
feature; none of them may be adjusted locally:

- **`type: String!` and not a GraphQL enum.** From inside `api` this looks like validation thrown
  away — an enum would make an unsupported type a schema error for free. It stays a string because
  the schema has no enum today and `MEDIA_TYPE` holds `"movie"`/`"show"` as literals in both
  services; an enum puts `MOVIE` on the wire and buys a mapping layer. The price is that `api`
  must validate explicitly and produce `Tipo de medio no soportado: <type>` (AC-9).

- **`addMedia` returns `MediaRef`, not the created row.** From inside `web` this looks like a
  regression — the old `addMovie` returned a `Movie`. `web` only ever read `.id` from it
  (`services/web/src/actions/movies.ts`, `ADD_MOVIE_MUTATION` selects `{ id }` and nothing else),
  and a polymorphic row would need a GraphQL union with hand-written inline fragments and no
  codegen to check them.

- **`tmdbId` keeps its provider-specific name** on `addMedia`, even though the operation is now
  provider-agnostic in every other respect.

- **`mediaId` is nullable and is not an ownership test.** From inside `web`'s `renderAction` it is
  tempting to treat `mediaId !== null` as "mine" and drop `inLibrary`. That collapses "registered
  by someone else" into "registered by me" and makes a film another user owns unaddable. Only
  `inLibrary` means mine.

If the contract turns out to be wrong mid-flight: stop, amend `spec.md`, re-approve, re-brief both
services. Never patch it from inside one slice (Constitution, Article VIII).

## Migrations

One migration, owned by `api`, generated through `bin/npm api run prisma:migrate` — never
hand-written SQL (Constitution, Article III).

1. `add_user_shows_and_seasons_synced_at` — creates `user_shows` (`userId` / `showId`, composite
   primary key, `@@index([showId])`, both foreign keys `onDelete: Cascade`), adds the `shows []`
   relation field to `User`, the `users []` relation field to `Show`, and the nullable column
   `shows.seasonsSyncedAt DATETIME NULL`.
2. **Backfill: none.** `shows` has no rows in any installation — the model has existed since the
   original schema but has never had a module, a resolver or a write path, so nothing can have
   created one. This is the one thing that makes this migration cheap where `005-movie-search`'s
   `UserMovie` needed a backfill onto the oldest enabled admin. Verify before migrating rather than
   trusting this paragraph:

   ```bash
   bin/mysql -e 'select count(*) from shows'
   ```

   If that is not `0`, stop and report — the plan's premise is wrong and `seasonsSyncedAt NULL` on
   a pre-existing series would silently mean "never synced", which is the correct answer but not
   one this plan verified.

Reversibility: dropping `user_shows` and the column loses every user↔series link and every
"hydration finished" mark. Since both are created by this feature and nothing else reads them, a
rollback is a return to the pre-feature state with no orphaned data — `shows`/`seasons`/`episodes`
rows written by this feature would survive the rollback, unowned and unreachable.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **`mediaId` rename** (NFR-1) | Both sides compile. The field arrives `undefined`. `String(undefined)` yields the string `"undefined"`, so every already-owned film renders `Ir` linking to `/movies/undefined`. No error anywhere. | AC-13's two-sided grep (the three renamed sites gone, the other `movieId` meanings still present) plus the manual pass below — a film in the library must show `Ir` on the *first* render, before anything is added this session. |
| **`movieId` renamed by string match, not by meaning** (NFR-1b) | `MediaSource.movieId` is a different GraphQL type read by `worker` (`services/worker/src/jobs/source-ready.job.ts`). Renaming it breaks the download pipeline an hour later, when a torrent finishes, in a feature that touches no download. | The `web` brief lists the three files that change and states that every other `movieId` hit is correct as-is. AC-13 asserts the survivors positively, not just the removals. `worker` is not in `services:` and no task may touch it. |
| **Cache-before-enrich written backwards in `ShowsService`** (NFR-3) | `tmdb:show:<id>` is global. One caller's `inLibrary` is served to every other user for 24h. The response is correct for the caller who caused it, so nothing looks wrong. | A test in `shows.service.spec.ts` that asserts on what is handed to the Redis pipeline, not on the return value — `movies.service.spec.ts:82` is the exact shape to copy. Required *per service*, not once. |
| **Hydration failure indistinguishable from a series with no seasons** (NFR-4) | The mutation already returned 200. The user sees a registered series. `seasons` is empty and nothing ever retries. | `seasonsSyncedAt` is set only after every season and every episode is written. `null` covers both "never tried" and "failed", and `register` retries whenever it is `null`. AC-12 exercises this by clearing `movie_db_api_key` between search and add. |
| **The claim is taken and never released on failure** (NFR-5) | A hydration that throws leaves the Redis claim key in place. Every retry for that series short-circuits until the TTL expires — REQ-14 silently stops working. | The claim is released in a `finally`, and it carries a TTL as a second line of defence so a crashed process cannot wedge a series permanently. |
| **N season requests issued concurrently** (NFR-6) | `Promise.all` over twenty seasons trips TMDB's rate limit. Some seasons come back 429, the rest succeed. Partial data, `seasonsSyncedAt` correctly left `null`, but the user sees a half-populated series with no error. | Sequential `for … of` with `await` inside. Explicitly called out in the `api` brief because `Promise.all` is the reflex. |
| **The dispatch grows type knowledge** | Nothing fails. It just stops being true that a third type costs a service and one line, which is the entire justification for this shape. | AC-16 is a grep, and it is a `[verify]` task, not a review opinion. |
| **`MoviesService` regressions** (NFR-2) | `web` has no tests. Every film-side behaviour `005-movie-search` shipped is verified by opening a page. | The `api` brief confines the change to `MoviesService` to two renames and one return shape; `movies.service.spec.ts` is updated, not rewritten, and its four existing cases must still pass. The manual pass below re-walks the film path. |

## Verification

Automated, all through `bin/` (Constitution, Article I):

```bash
bin/cli api npx --no tsc --noEmit
```

```bash
bin/npm api test
```

```bash
bin/cli web npx --no tsc --noEmit
```

Expected: `api` **0 errors** and **all suites green** (80 tests / 9 suites before this feature, plus
whatever `shows.service.spec.ts` adds); `web` **12 errors across 5 files**, unchanged — that count is
the pre-existing debt listed in `services/web/CLAUDE.md`, and any number other than 12 means this
feature added an error or silently fixed a file it was not scoped to touch. `bin/npm web run build`
is **not** a gate: `app/(dashboard)/shows/page.tsx` is an untracked copy that imports a
non-existent module and is explicitly Out of Scope, so the build fails on it before and after.

The contract check (Constitution, Article VIII):

```bash
grep -n "searchMedia\|addMedia\|MediaRef\|mediaId" services/api/src/schema.gql
```

Then the regression greps that back AC-13 and AC-14:

```bash
grep -rn "searchMovies\|addMovie" services/web/src services/worker/src services/api/src/schema.gql
```

```bash
grep -rn "movieId" services/web/src services/api/src/schema.gql
```

The first must return nothing. The second must still show `MediaSource.movieId`, the three mutation
arguments, and the tus metadata key — and must no longer show it inside `type MediaSearchResult`,
`services/web/src/types/search.ts` or `SearchContainer.tsx`.

### Manual pass

With the stack up (`bin/dev`) and a real `movie_db_api_key` set in Settings:

1. **Series, happy path.** `/shows/add` → search `breaking bad`. The box reads `Buscar serie...`;
   the results are series. Click `Agregar`: it disables while in flight, then shows `Agregada` and
   is not a link. Add a second series without reloading (AC-1, AC-8).
2. **The data landed.** `bin/mysql -e 'select id, tmdbId, seasonsSyncedAt from shows'` — one row,
   `seasonsSyncedAt` not null within seconds. Then the season and episode counts, and the specials
   row (AC-4, AC-6, AC-7).
3. **The cache is caller-free.** `bin/cli redis redis-cli get tmdb:show:<tmdbId>` — no `inLibrary`,
   no `mediaId`. Same for `tmdb:movie:<tmdbId>` after a film search (AC-3).
4. **Films still work.** `/movies/add` → search, add, the card becomes `Ir` → `/movies/<id>`.
   Re-search the same title: it shows `Ir` on the **first** render, from `inLibrary` alone. This is
   the step that catches the `mediaId` rename (AC-2, NFR-1).
5. **Two users.** Sign in as a second user, search the series user A added: it still offers
   `Agregar`. Add it. `select count(*) from shows where tmdbId = <n>` is still 1;
   `select count(*) from user_shows where showId = <id>` is 2 (AC-5).
6. **Cold cache.** `bin/cli redis redis-cli del tmdb:show:<n>`, then add that series from the
   still-rendered results — it registers anyway (AC-10).
7. **Unsupported type.** From the Apollo sandbox, `searchMedia(query: "x", type: "music")` →
   exactly `Tipo de medio no soportado: music`. Same for `addMedia` (AC-9).
8. **Unknown id.** `addMedia(tmdbId: 999999999, type: "show")` → `No encontramos la serie en el
   catálogo`; the same call with `type: "movie"` → `No encontramos la película en el catálogo`. No
   row written (AC-11).
9. **Hydration failure is recoverable.** Search a series, clear `movie_db_api_key` in Settings, add
   it. The row appears with `seasonsSyncedAt` NULL; `docker compose logs api` shows the failure.
   Restore the key and add the same series again — the fetch runs this time (AC-12, NFR-4).

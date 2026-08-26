---
title: Multi Search — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-26
status: Implemented
---

# PLAN: Multi Search (`plan.md`)

## Approach

The feature adds one query, `searchAllMedia(query)`, and every design decision below exists to stop
it from becoming a third independent implementation of the two things `006-media-search` made
per-type obligations: the cache-before-enrich ordering and the caller-scoped ownership lookup.

Today each per-type service owns a whole `search(query, userId)`: it calls TMDB, maps the raw rows,
fires the Redis write on the catalog-only objects, then enriches for the caller
(`services/api/src/movies/movies.service.ts` steps 1–5, and its twin in
`services/api/src/shows/shows.service.ts`). A mixed search inverts the top of that: one catalog call
serves both types, so the TMDB half must be lifted out while the cache-and-enrich half stays exactly
where it is, per type, tested where it already is tested.

So the second half of `search()` becomes a method in its own right — `cacheAndEnrich(results,
userId)` — and it is the **one new method** on `MediaTypeService`
(`services/api/src/media/media-type.interface.ts`, going from two methods to three). Each service's
existing `search()` keeps its TMDB call and then calls its own `cacheAndEnrich`; the ordering-critical
code is moved, not copied, so both entry points run the same lines and
`movies.service.spec.ts`/`shows.service.spec.ts` keep covering it unchanged.

Above that sits a new `MediaSearchService` in `services/api/src/media/`: blank-check the query, one
call to the catalog, group the rows by type, hand each group to
`MediaDispatchService.resolve(type).cacheAndEnrich(...)`, then restore the catalog's original
ranking. It reuses the existing dispatch rather than building a second lookup — the dispatch stays
the only file that maps a type to a service (`006-media-search` AC-16 still holds, and this plan adds
nothing type-specific to `media-dispatch.service.ts`).

The TMDB half lands in the client, next to the mapping that is already there. `search/multi` returns
rows whose shape depends on `media_type` — `title`/`release_date` for a film, `name`/`first_air_date`
for a series — and `services/api/src/clients/tmdb/client.ts` already owns exactly this kind of
per-type mapping in its `mappers` record for `details()`. The row filter and mapper go into a pure
exported function in a new `clients/tmdb/multi.ts`, mirroring `clients/torrent/magnet.ts`: a pure
function in its own file with its own spec, callable without mocking `fetch`. `TmdbClient` gets one
thin `searchMulti()` that reuses its existing `fetchPage` and the existing `posterUrl()` helper, so a
poster from a mixed search and a poster from a per-type search can never disagree on image size.

**The alternative considered and rejected** was making `type` nullable on `searchMedia`. It would put
a branch inside `MediaDispatchService` — the one file `006` froze as branch-free — and give one wire
field two meanings. Two queries, one that dispatches and one that fans out, is smaller.

On `web`, the results screen is a Server Component at `/search` that awaits the new action and hands
its rows to a client component for the per-card actions. What must **not** be duplicated is the
action itself: `SearchContainer.tsx`'s `renderAction` (add / adding / `Ir`) is extracted into a
shared client component that both the existing per-type screens and the new one render. That
extraction is also how REQ-10 reaches `/shows/add` for free — the owned-series branch becomes an `Ir`
link to `/shows/<id>` in one place, not two.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the schema. `web` cannot query a field that does not exist, and there is no codegen to tell it so. |
| 2 | `web` | Consumes `searchAllMedia`; needs `api` running with the new query to verify anything at all. |

The contract is frozen as of this document, so `web` **may** start writing against it in parallel
with step 1 — its action, its component extraction and its badge do not depend on `api`'s internals.
What cannot happen in parallel is verification: every `web` acceptance criterion needs `api` serving
the query. Treat step 2's code as parallelizable and step 2's sign-off as sequential.

Inside `api`, the order matters more than usual because one step is a refactor of tested code:

1. `clients/tmdb/multi.ts` + its spec — pure, no dependencies on anything else here.
2. `TmdbClient.searchMulti()` — three lines over `fetchPage`.
3. `cacheAndEnrich` extracted in `MoviesService` and `ShowsService`, `search()` rewired to call it,
   `MediaTypeService` widened. **Run `bin/npm api test` here, before anything new consumes it** — if
   the extraction broke the ordering, the existing suites say so at this exact point and nowhere
   later.
4. `MediaSearchService` + resolver + module wiring, then its spec.

## Contract Freeze

The `## GraphQL Contract Delta` in `../spec.md` is frozen as of `status: Approved`. It is one query
and nothing else. Things an implementer will be tempted to change and must not:

- **`searchAllMedia` returns `[MediaSearchResult!]!`, the existing type, unwidened.** No `badge`
  field, no `mediaTypeLabel`, no enum. The badge is a `web` rendering decision driven by the `type`
  string that is already on the wire; adding a field for it would put presentation in the schema and
  give `worker` and every future consumer a field they must ignore.
- **`type` stays a plain `String!` carrying `"movie"` / `"show"`.** The temptation here is real —
  a mixed list is exactly where a GraphQL enum feels overdue — but the schema has no enum for this,
  `MEDIA_TYPE` holds the same literals on both sides, and introducing one for this query alone would
  put `MOVIE` on the wire for `searchAllMedia` and `"movie"` for `searchMedia`.
- **No new `ERROR_KEYS` entry.** Unsupported catalog rows are dropped, not refused; registration
  still goes through `addMedia` and reuses its existing keys. An implementer who finds themselves
  adding `error.media.*` has misread the spec's error table.
- **`searchMedia` and `addMedia` keep their exact signatures and behaviour.** The refactor in step 3
  moves private code inside two services; it must not change what either public operation returns.

If the contract turns out to be wrong: stop, amend `../spec.md`, re-approve, re-brief both services.
Never patch it from inside one slice (Constitution, Article VIII).

## Migrations

**None.** No Prisma model, field, enum or migration; `git status services/api/prisma/` must stay
clean through this feature. Redis gains no new key namespace either — the new path writes the
existing `tmdb:movie:<id>` / `tmdb:show:<id>` keys with the existing 24-hour TTL, because it writes
them through the very same per-type code the per-type searches use.

Reversibility: total. Reverting the diff removes a query nothing else depends on.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The `cacheAndEnrich` extraction reorders cache and enrich in one of the two services | Nothing fails. The response is identical. A global 24h Redis key is served to every other user carrying this caller's `inLibrary`/`mediaId` | The two existing suites already assert on what is handed to the Redis pipeline; step 3 of the api order runs them **before** anything new is built on top |
| The regrouping in `MediaSearchService` loses the catalog's ranking | Results render in an order that looks plausible (all films, then all series) and is not what the catalog returned — REQ-1 quietly unimplemented | Enrich per group, then rebuild the response by walking the **original** ordered list; asserted in `media-search.service.spec.ts` |
| A tmdbId collides across types — film 42 and series 42 | The wrong card gets the other one's `mediaId`/`inLibrary`: a series shows `Ir` to a film's page, or a card the user does not own claims they do | The lookup key is `${type}:${id}`, never the bare id; asserted with a deliberate cross-type id collision |
| TMDB's discriminator is `"tv"`, our internal one is `"show"` | Every series is silently dropped from every mixed search — an empty half of the feature with no error | Pure mapper in `clients/tmdb/multi.ts` with a spec case per discriminator, including one unknown value |
| A future/unknown `media_type` (or a row missing `title`/`name`) reaches the mapper | A broken card, or a `type` value `web` cannot render | The mapper is a filter first: anything that is not `movie`/`tv`, or lacks the fields the result shape needs, is dropped (NFR-4) |
| The badge is added to `MediaCard` unconditionally | `/movies` and `/shows` grow a badge saying the same word on every card | The badge is opt-in per render, threaded through `MediaList`; only the new screen passes it |
| `SearchContainer`'s action is copied instead of extracted | AC-9's `Ir` for series lands on one screen and not the other, and the next change to the action has two homes | The shared action component is a listed file in `web/plan.md`, and AC-9 is verified on `/shows/add`, not on `/search` |
| Message catalogs drift between `en` and `es` | A missing key renders as the raw key string to one locale's users | `bin/cli web node scripts/check-messages.mjs` in Verification |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/npm web run build
```

`api` typecheck must report the same error count as before the feature (0 as of `023-ffprobe-log`);
`bin/npm api test` must be green with the new suites added to the count, not replacing anything.
`web` typecheck must stay at 0 and the build must exit 0. `bin/npm web run lint` is **not** a gate
(see `services/web/CLAUDE.md`) — run Biome on the touched files only.

Then the manual pass, signed in as a normal user:

1. Type `spider-man` in the header box, press Enter. The address carries the query; the grid shows
   films and series together, each with a badge (AC-1, AC-3). Reload it (AC-2).
2. Confirm no person appears among the cards, and check the raw response has only `movie`/`show` in
   `type` (AC-4).
3. Add one film and one series from the same page. Confirm no navigation, both cards change, and:
   ```bash
   bin/mysql -e 'select count(*) from movies where tmdbId = <n>'
   bin/mysql -e 'select count(*) from shows where tmdbId = <m>'
   ```
   grow by exactly one each, with `user_movies`/`user_shows` doing the same (AC-5, AC-6).
4. Cache contents, which is where the silent failure lives:
   ```bash
   bin/cli redis redis-cli get tmdb:movie:<n>
   bin/cli redis redis-cli get tmdb:show:<m>
   ```
   Neither may contain `inLibrary` or `mediaId` (AC-7).
5. Search again: both now render `Ir`, to `/movies/<id>` and `/shows/<id>`, and both links resolve
   (AC-8). Open `/shows/add`, search the same series: `Ir`, not a badge (AC-9).
6. Sign in as a second user, repeat the search: both offer `Agregar`, and the row counts above are
   unchanged (AC-10).
7. Clear `movie_db_api_key` in Settings, search again: an inline error, the page still usable, no
   error screen and no `alert()` (AC-11). Restore the key.
8. Submit the header box empty and confirm `docker compose logs api` shows no TMDB call for it
   (AC-12).
9. Open `/movies/add`: search, add, `Ir`, and a film another user registered still offering
   `Agregar` — unchanged (AC-15).

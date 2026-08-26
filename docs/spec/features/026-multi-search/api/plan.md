---
title: Multi Search — api slice
service: api
last_updated: 2026-08-26
status: Implemented
---

# PLAN: Multi Search — `api` (`api/plan.md`)

## Scope

This slice adds one GraphQL query, `searchAllMedia(query: String!): [MediaSearchResult!]!`, which
searches TMDB's mixed collection once, drops everything that is not a film or a series, and returns
the survivors in the catalog's own order with each one cached and ownership-enriched **by the service
that owns its type**. To make that possible without a third copy of the ordering-critical code, it
also performs one internal refactor: the half of `MoviesService.search`/`ShowsService.search` that
runs after the TMDB call becomes a method on `MediaTypeService`.

It is **not** doing: any Prisma schema change or migration (there is none — `git status
services/api/prisma/` stays clean); any change to `searchMedia`, `addMedia`, `MediaSearchResult`,
`MediaRef` or `MediaDispatchService.resolve`; any new error key; any UI concern — the badge, the
results screen and the header wiring belong to `web` and are described in `../web/plan.md` only so
this slice knows what its consumer expects.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report
(`.claude/agents/api.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/clients/tmdb/types.ts` | Modified | Add the raw shape of a `search/multi` row — a `media_type` discriminator over the union of the film and series row fields |
| `services/api/src/clients/tmdb/multi.ts` | New | Pure function: raw multi rows → `MediaSearchResult[]` (the shared `clients/types.ts` shape), dropping every row that is not a usable film or series |
| `services/api/src/clients/tmdb/multi.spec.ts` | New | Spec for the above (see § Tests) |
| `services/api/src/clients/tmdb/client.ts` | Modified | Add `searchMulti(query, page?)` over the existing `fetchPage`, returning the mapped results |
| `services/api/src/media/media-type.interface.ts` | Modified | Third method: `cacheAndEnrich(results, userId)` |
| `services/api/src/movies/movies.service.ts` | Modified | Extract steps 3–4 of `search()` into `cacheAndEnrich()`; `search()` calls it |
| `services/api/src/shows/shows.service.ts` | Modified | The same extraction, in its twin |
| `services/api/src/media/media-search.service.ts` | New | The fan-out: one catalog call, group by type, delegate per type, restore catalog order |
| `services/api/src/media/media-search.service.spec.ts` | New | Spec for the above (see § Tests) |
| `services/api/src/media/media.resolver.ts` | Modified | Add the `searchAllMedia` query |
| `services/api/src/media/media.module.ts` | Modified | Import `SettingsModule` (it is what exports `TmdbClient`), provide `MediaSearchService` |
| `services/api/src/schema.gql` | Regenerated | Artifact of the decorator change — never hand-edited (Constitution, Article IV) |

## Existing code to reuse

- `services/api/src/clients/tmdb/client.ts` — `fetchPage()` already builds the URL from settings,
  sets `query`/`page`, sends the bearer token and unwraps `results`. `searchMulti` is that call with
  `search/multi` and the mapper applied; do not write a second fetch path. `posterUrl()` is exported
  from this file and **must** be the only way a poster URL is built, so a mixed search and a per-type
  search never disagree on image size. The `mappers` record above `TmdbClient` is the shape to copy
  for the new mapper — a lookup keyed by the discriminator, not an `if`/`else` chain.
- `services/api/src/clients/torrent/magnet.ts` + `magnet.spec.ts` — the precedent for "pure function
  in its own file, with its own spec, no network". `multi.ts` is built the same way and for the same
  reason: the parsing rules are what fail silently, and they must be testable without a fetch mock.
- `services/api/src/movies/movies.service.ts` — `cacheMovies()` (best-effort pipeline write, errors
  logged and swallowed, 24h TTL, `cacheKey()` as the single key definition) and
  `enrichWithOwnership()` (one `findMany` per page, never one per result) are the code being
  extracted. **Move them behind the new method; do not rewrite them, do not "improve" them, and do
  not merge the two services while you are in there** — the twin structure is a decision
  (`006-media-search` § Out of Scope), not an oversight.
- `services/api/src/shows/shows.service.ts` — same, `cacheShows()` / `enrichWithOwnership()`.
- `services/api/src/media/media-dispatch.service.ts` — `resolve(type)` is how `MediaSearchService`
  gets from a type to a service. Reuse it as-is. It must gain **no** new branch, no TMDB import and
  no knowledge of this feature (`006-media-search` AC-16).
- `services/api/src/media/media.resolver.ts` — the auth shape to copy exactly: no `@AllowService()`,
  principal narrowed to `'user'` (NFR-5).
- `services/api/src/settings/settings.module.ts` — exports `TmdbClient`. This is why `MediaModule`
  imports `SettingsModule` rather than providing the client a second time.
- `services/api/src/types/media.ts` — `MEDIA_TYPE`. The internal discriminator is `"show"`; TMDB's
  is `"tv"`. The translation belongs in `multi.ts` and nowhere else.

## Steps

1. **`clients/tmdb/types.ts`** — add the raw multi-row interface. It carries `media_type` plus the
   fields both row kinds may have (`title`/`name`, `release_date`/`first_air_date`, `poster_path`,
   `original_language`, `overview`, `id`). Model the optionality honestly: a field TMDB only sends
   for one kind is optional on this type.

2. **`clients/tmdb/multi.ts`** — export one pure function taking the raw rows and returning
   `MediaSearchResult[]` (the `clients/types.ts` interface — the catalog-only shape, **without**
   `mediaId`/`inLibrary`; those do not exist at this layer and must not be added here). Keyed by
   `media_type`: `movie` → `MEDIA_TYPE.MOVIE` reading `title`/`release_date`, `tv` →
   `MEDIA_TYPE.SHOW` reading `name`/`first_air_date`. Anything else — `person`, `collection`, a value
   that does not exist yet — is dropped. A row whose title field is missing or empty is dropped too
   (NFR-4). `releaseDate` follows the existing convention: `... || null`. Poster through
   `posterUrl()`. Article XI applies: the only comment owed here is the TMDB reference URL.

3. **`clients/tmdb/multi.spec.ts`** — see § Tests.

4. **`clients/tmdb/client.ts`** — `async searchMulti(query: string, page = 1)`: `fetchPage` against
   `search/multi`, result handed to the mapper from step 2. Keep the TMDB endpoint URL as the one
   comment (Article XI, exception 1). Do not touch `search()`, `details()` or `seasonDetails()`.

5. **`media/media-type.interface.ts`** — add the third method:

   ```ts
   cacheAndEnrich(results: MediaSearchResult[], userId: string): Promise<MediaSearchResultEntity[]>;
   ```

   Note the two different `MediaSearchResult`s already in play in these files: the input is the
   catalog-only interface from `@/clients/types`, the output is the GraphQL entity from
   `@/media/entities/media-search-result.entity`. Both services already import both under an alias;
   follow that.

6. **`movies/movies.service.ts`** — extract. `cacheAndEnrich(results, userId)` becomes public and
   contains exactly what steps 3 and 4 of `search()` do today, in that order and with the existing
   comment explaining why the order is load-bearing. `search()` becomes: blank check, TMDB call,
   map to `MediaSearchResult[]`, `return this.cacheAndEnrich(results, userId)`. Nothing else in the
   file changes.

7. **`shows/shows.service.ts`** — the same extraction in the twin. Do not factor the two into a
   shared base while doing it.

8. **Run `bin/npm api test` now.** Both existing suites assert the ordering through `search()`; this
   is the checkpoint where a botched extraction is still cheap to find.

9. **`media/media-search.service.ts`** — the new service. Injects `TmdbClient` and
   `MediaDispatchService`. One public method, `searchAll(query: string, userId: string)`:
   blank/whitespace query returns `[]` **before** touching the catalog (REQ-6/AC-12); one
   `tmdb.searchMulti(query)`; group the mapped rows by their `type`; for each group present, one
   `dispatch.resolve(type).cacheAndEnrich(group, userId)`; then rebuild the response by walking the
   **original** ordered rows and looking each one up by the composite key `${type}:${id}` — never by
   the bare id, which collides across types. An unknown type cannot appear here (step 2 dropped it),
   but a row that fails to come back from enrichment is dropped rather than emitted half-built.

10. **`media/media.resolver.ts`** — add the query, mirroring `searchMedia`'s shape and auth exactly.
    No `@AllowService()`.

11. **`media/media.module.ts`** — import `SettingsModule`, add `MediaSearchService` to `providers`.

12. **`media/media-search.service.spec.ts`** — see § Tests.

13. Boot the api and confirm `src/schema.gql` regenerated with `searchAllMedia` and **nothing else
    changed** in it (Constitution, Article IV: it is an artifact, never an edit).

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

```graphql
type Query {
  searchAllMedia(query: String!): [MediaSearchResult!]!
}
```

- The element type is the **existing** `MediaSearchResult`, unchanged — no new field, and in
  particular no badge/label field. `web` derives the badge from `type`.
- Every element's `type` is `"movie"` or `"show"`. A third value reaching the wire is a contract
  break, which is why step 2 filters rather than passes through.
- `mediaId` is the registered row's id in the table `type` names, or `null`. `inLibrary` is true only
  for the calling user. Neither may ever be written into Redis (REQ-4 / NFR-1).
- Blank query → `[]`, catalog not contacted. Catalog unreachable or `movie_db_api_key` unset → the
  generic `Error` `TmdbClient` already raises, unwrapped and unkeyed, exactly as `searchMedia`
  surfaces it today. Unsupported or malformed row → dropped, never an error.
- **No new `ERROR_KEYS` entry, and no change to `src/i18n/`.** If this slice finds itself editing
  `error-keys.ts`, it has left its scope — stop and report.

## Tests

Two suites are owed; both cover failures that produce a successful response and no log line
(Constitution, Article IX). Each opens with a header comment naming the class of bug it defends
against, and each case is written the house way — verified to fail when the rule it covers is
removed (fault injection, `services/api/CLAUDE.md` § Tests).

- **`services/api/src/clients/tmdb/multi.spec.ts`** — defends against the mixed-row mapping failing
  quietly. A `media_type` check written against `"show"` instead of `"tv"` drops every series from
  every mixed search; a `tv` row mapped through the film mapper produces a card with an empty title
  and no year; a `person` row that slips through reaches the user as an unregistrable card. Cases:
  a film row maps with `title`/`release_date` and the `w300` poster URL; a series row maps with
  `name`/`first_air_date` and `type === "show"`; a `person` row is dropped; an unknown future
  `media_type` is dropped; a row with no title is dropped; catalog order is preserved across the
  survivors; a null `poster_path` yields `posterUrl === null`, not a broken URL.

- **`services/api/src/media/media-search.service.spec.ts`** — defends against the three silent
  failures of the fan-out. Cases: (1) **cache-before-enrich over a mixed set** — with `TmdbClient`
  mocked to return one film and one series, assert on what each service was handed to cache, and
  that neither cached object carries `inLibrary` or `mediaId`; this is the NFR-1 case and the reason
  the suite exists. (2) **catalog order survives regrouping** — a film, a series, a film in that
  order comes back in that order, not grouped. (3) **cross-type id collision** — film `42` and series
  `42` in one response, only one of them registered by the caller, and the ownership lands on the
  right card. (4) **caller scoping over a mixed set** — a film and a series owned by another user
  report `inLibrary: false` with a non-null `mediaId`. (5) a blank query returns `[]` and the TMDB
  mock is never called.

Not owed: the resolver (a two-line delegation whose auth shape is identical to the neighbour's — a
mistake there fails loudly on the first call), `TmdbClient.searchMulti` itself (all its logic is the
pure mapper, already covered, and the rest is `fetchPage`, exercised by every other client method),
and the `cacheAndEnrich` extraction (deliberately covered by the two **existing** suites, which is
the whole reason the code was moved rather than copied — do not duplicate those cases into a new
file).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
```

Typecheck reports the same error count as before the slice (0 as of `023-ffprobe-log`), and the test
run is green with the two new suites **added** to the previous count — no existing suite removed,
skipped or rewritten. `git status services/api/prisma/` is clean, and the only change to
`src/schema.gql` is the added `searchAllMedia` line.

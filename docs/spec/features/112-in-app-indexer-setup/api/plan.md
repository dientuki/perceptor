---
title: In-app indexer setup — api slice
service: api
last_updated: 2026-10-30
status: Implemented
---

# PLAN: In-app indexer setup — `api` (`api/plan.md`)

## Scope

`api` exposes the four admin-only operations of `../spec.md` § GraphQL Contract Delta
(`indexerCatalog`, `configuredIndexers`, `addIndexer`, `removeIndexer`) and does every Prowlarr call
behind them: read the schema, list/create/delete indexers, read tags and app profiles. It owns the
catalog filter (REQ-1, NFR-2), the payload it builds for Prowlarr (REQ-5, REQ-6), idempotence
(REQ-8), the Redis cache of the projection (NFR-3) and the four new error keys. It does **not**
create the `flaresolverr` tag or proxy (`services/indexer/custom-services.d/20-prowlarr-flaresolverr`
owns both), touch the Prisma schema (NFR-7), or render anything.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/clients/indexer/client.ts` | Modified | `request()` takes a method and optional JSON body; new `getIndexerSchema()`, `listIndexers()`, `createIndexer(body)`, `deleteIndexer(id)`, `listTags()`, `listAppProfiles()` |
| `services/api/src/clients/indexer/types.ts` | Modified | Raw Prowlarr shapes this feature reads (schema entry, configured indexer, tag, app profile); `IndexerClient` gains the new members |
| `services/api/src/indexer/indexer-catalog.ts` | New | Pure `toCatalogEntry()` and `buildIndexerPayload()` (see `../plan.md` § Approach) |
| `services/api/src/indexer/indexer.service.ts` | Modified | `catalog(search)`, `configured()`, `add(definitionName)`, `remove(id)`; Redis read-through for the projection |
| `services/api/src/indexer/indexer.resolver.ts` | Modified | Four operations, each `@UseGuards(AdminGuard)` |
| `services/api/src/indexer/entities/indexer-definition.entity.ts` | New | `IndexerDefinition` object type + `IndexerMediaCategory` enum registration |
| `services/api/src/indexer/entities/configured-indexer.entity.ts` | New | `ConfiguredIndexer` object type |
| `services/api/src/i18n/error-keys.ts` | Modified | `INDEXER_DEFINITION_NOT_ALLOWED`, `INDEXER_TEST_FAILED`, `INDEXER_FLARESOLVERR_MISSING`, `INDEXER_NOT_FOUND` |
| `services/api/src/i18n/messages.en.ts` | Modified | English text for the four keys, from the spec's error table |
| `services/api/src/indexer/indexer-catalog.spec.ts` | New | Filter and payload tests (see Tests) |
| `services/api/src/indexer/indexer.service.spec.ts` | Modified | Add/remove/idempotence/error-mapping cases |
| `services/api/src/clients/indexer/client.spec.ts` | Modified | New calls never parse a failed response as success |

## Existing code to reuse

- `src/clients/indexer/client.ts` — `ProwlarrClient.request()`: base URL from `tracker_host`/`tracker_port`, `X-Api-Key` from `tracker_api_key`, `INDEXER_UNAVAILABLE` on network failure or non-2xx. Widen it; do not write a second fetch helper. `countIndexers()`'s `Array.isArray` guard is the pattern for every list response.
- `src/indexer/indexer.service.ts` — `readCache`/`writeCache` try/catch posture around `RedisService` (`040`): a Redis failure is logged and ignored. Reuse the shape for `indexer:catalog` with a 6-hour TTL.
- `src/auth/guards/admin.guard.ts` — the same guard `indexerStatus` uses; it already refuses the service token.
- `src/i18n/i18n-error.ts` — `i18nError.badRequest/notFound/serviceUnavailable(key)`; never a raw Nest exception.
- `src/types/http.ts` — `HTTP_METHOD` constants for the widened `request()`.
- `services/indexer/custom-services.d/20-prowlarr-flaresolverr` — read-only reference: the tag's label is exactly `flaresolverr`; look it up by label via `GET /api/v1/tag`.

## Steps

1. **Verify Prowlarr's create semantics** against the dev stack's Prowlarr (port 9696, dev
   `INDEXER_API_KEY`) before writing the add path: confirm that `POST /api/v1/indexer` without
   `forceSave` tests the indexer and answers `400` with a validation-failure array on failure, and
   that `DELETE /api/v1/indexer/{id}` answers `404` for an unknown id (measured: it answers `200 {}`; see Step 8). Record the result in your
   report. If create does not test, call `POST /api/v1/indexer/test` first and map its failure the
   same way.
2. Widen `ProwlarrClient.request()` to `(path, { method, query, body })`, keeping GET as the
   default so `search()`/`countIndexers()` callers are unchanged. On a non-2xx it must keep
   throwing before any `res.json()`; expose the status to the service so a create `400` and a
   delete `404` can be told apart from an outage (e.g. a typed error carrying `status`). A `DELETE`
   with an empty body must not attempt `res.json()`.
3. Add the raw calls listed under Files. Every list response passes `Array.isArray` or throws
   `INDEXER_UNAVAILABLE`.
4. `indexer-catalog.ts`:
   - `toCatalogEntry(def)` → `null` unless `privacy === 'public'`, `protocol === 'torrent'`, and a
     category or subcategory id falls in 2000–2999 or 5000–5999; also `null` when `definitionName`,
     `name`, `indexerUrls[0]`, `capabilities.categories` or `fields` is missing or the wrong type
     (NFR-9). Categories: `MOVIES` if any id in 2000–2999, `TV` if any in 5000–5999, `ANIME` if 5070
     present. `needsFlareSolverr` = some field named `info_flaresolverr`. `language` = Prowlarr's
     value or `null`.
   - `buildIndexerPayload(def, { appProfileId, flareSolverrTagId })` per `../plan.md`.
5. `IndexerService.catalog(search?)`: projection from Redis or `getIndexerSchema()` →
   `toCatalogEntry` → drop `null`s → cache; then live `listIndexers()` to set `configured` by
   `definitionName`; filter by case-insensitive substring of `name`; sort by
   `name.localeCompare(…, undefined, { sensitivity: 'base' })` (REQ-3, REQ-4).
6. `IndexerService.configured()`: `listIndexers()` + `listTags()`; map to `ConfiguredIndexer`
   (`usesFlareSolverr` = the `flaresolverr` tag id is in the indexer's `tags`). Nothing else from
   the raw object crosses (NFR-4). Order alphabetically like the catalog.
7. `IndexerService.add(definitionName)`:
   1. live `getIndexerSchema()`, find by `definitionName`; missing or `toCatalogEntry` → `null` →
      `INDEXER_DEFINITION_NOT_ALLOWED`;
   2. live `listIndexers()`; an existing one with that `definitionName` → return it mapped, no write
      (REQ-8);
   3. if `needsFlareSolverr`, find the tag by label; absent → `INDEXER_FLARESOLVERR_MISSING`;
   4. `listAppProfiles()`, take the first id; none → `INDEXER_UNAVAILABLE`;
   5. `createIndexer(buildIndexerPayload(...))`; a `400` → `INDEXER_TEST_FAILED` (log Prowlarr's
      failure messages truncated to ~300 chars, never the request body — NFR-4); other non-2xx →
      `INDEXER_UNAVAILABLE`; success → map the returned indexer to `ConfiguredIndexer`.
8. `IndexerService.remove(id)`: `listIndexers()` first; an id not in the list → `INDEXER_NOT_FOUND`
   without calling delete (T001 measured that Prowlarr answers `DELETE` of an unknown id with `200 {}`,
   not `404`); then `deleteIndexer(id)`, still mapping a `404` to `INDEXER_NOT_FOUND` for other
   Prowlarr versions; success → `true`. Never touches tags or proxies.
9. Resolver: the four operations with descriptions, `@UseGuards(AdminGuard)` on each; `Int` for
   `id`, nullable `String` for `search`.
10. Error keys and English messages (step 7/8 keys), matching the spec's English column.
11. Boot the dev stack and confirm the regenerated `src/schema.gql` diff equals the spec's SDL
    (Article VIII check).

## Contract obligations

Expose exactly the SDL in `../spec.md` § GraphQL Contract Delta, with the error mapping in its
table: `error.auth.admin_required` (guard), `error.indexer.unavailable` for any unreachable /
unexpected-status Prowlarr on all four operations (no catch-and-resolve, unlike `status()`),
`error.indexer.definition_not_allowed`, `error.indexer.test_failed`,
`error.indexer.flaresolverr_missing`, `error.indexer.not_found`. An already-held definition on
`addIndexer` is not an error. The delta is read-only; if it is wrong, stop and report.

## Tests

Each new case is fault-injected: confirm it fails with the rule it covers removed. Headers name
the silent failure, in English (Article IX). Fixtures use invented definitions only
(`example-public`, `example-private`, …) — never a real tracker name or domain (NFR-1).

- `src/indexer/indexer-catalog.spec.ts` — defends against a private / semi-private / usenet /
  non-film-TV definition reaching the catalog or being addable with no error anywhere (NFR-2): one
  case per rule, including a film category present only as a subcategory, a definition missing
  `indexerUrls`, and a FlareSolverr-marked definition whose payload must carry the tag id (an
  untagged Cloudflare indexer is saved but every search through it silently returns nothing).
- `src/indexer/indexer.service.spec.ts` (extend) — `add` of an already-held definition makes no
  create call (duplicates double every search result silently); a create `400` rejects with
  `test_failed` and never resolves as an added indexer; a marked definition with no tag rejects
  with `flaresolverr_missing` and makes no create call; `remove` of an id absent from the list rejects with `not_found` and makes no delete call;
  `catalog` with Redis throwing still answers from Prowlarr.
- `src/clients/indexer/client.spec.ts` (extend) — a non-2xx from each new call throws with its
  status before any body is parsed as data (the existing class of bug this file guards).

Not owed: the resolver (thin delegation, guard is shared and already covered) and the entity
classes.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/comments api
```

All pass, the regenerated `services/api/src/schema.gql` matches the spec's SDL, and step 1's
Prowlarr check is recorded in the report.

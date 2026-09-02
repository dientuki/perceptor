---
title: Indexer search cache — api slice
service: api
last_updated: 2026-09-02
status: Implemented
---

# PLAN: Indexer search cache — `api` (`api/plan.md`)

## Scope

`api` owns the whole feature: a Redis read-through in `IndexerService` around the existing
`ProwlarrClient.search` call, plus the module wiring that gives `IndexerService` a Redis handle,
plus the test suite. Nothing else in the system changes.

Explicitly **not** in this slice: `ProwlarrClient` keeps its current responsibilities — the HTTP
call, the API-key header, the `INDEXER_UNAVAILABLE` throw and `filterData`'s grouping — and gains
no knowledge of Redis (see `../plan.md` § Approach). `services/web/` and `services/worker/` are
untouched; `web` calls `searchTorrents` exactly as it does today. `services/api/prisma/` is
untouched. Writes are confined to `services/api/` and this directory; anything else is a
stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/indexer/indexer.service.ts` | Modified | Injects `RedisService`; adds the TTL constant, `normalizeQuery`, `cacheKeyFor`, `readCache`, `writeCache`; `search()` becomes read-through with a deferred write. |
| `services/api/src/indexer/indexer.module.ts` | Modified | Adds `RedisModule` to `imports`. |
| `services/api/src/indexer/indexer.service.spec.ts` | New | The suite described under § Tests. |

`indexer.resolver.ts`, `entities/torrent-result.entity.ts` and `clients/indexer/client.ts` are **not**
in this table and must not appear in the diff.

## Existing code to reuse

- `services/api/src/media/popular-media.service.ts` — the reference implementation of this exact
  pattern. Its `readCache` (`get` → `JSON.parse`, `undefined` on any throw, `console.error` with the
  key) and `writeCache` (`set(key, JSON.stringify(v), 'EX', ttl)` inside a `try`/`catch` that only
  logs) are the shape to follow, method for method. Its module-level TTL constant with a comment
  naming why that number — the one comment Article XI tolerates here is none at all, so the
  rationale goes in the commit message and the spec, not above the constant.
- `services/api/src/redis/redis.module.ts` / `redis.service.ts` — `RedisService` **extends**
  `ioredis`, so it is the client: call `this.redis.get(...)` / `this.redis.set(...)` directly. Do not
  construct a second connection and do not add a `CacheModule`.
- `services/api/src/clients/indexer/types.ts` — `TorrentResult` is a plain serializable shape
  (strings, numbers, nulls, arrays of objects). It round-trips through `JSON.stringify`/`parse`
  without loss, which is what makes NFR-2 hold; no revival step is needed or wanted.
- `services/api/src/media/popular-media.service.spec.ts` — the model for the test file, including
  the Article IX header paragraph and the `{ get: jest.Mock; set: jest.Mock }` Redis double
  supplied through Nest's `Test.createTestingModule` with `.overrideProvider`/`useValue`.

## Steps

1. `indexer.module.ts`: add `RedisModule` to `imports` alongside `SettingsModule`. Leave
   `providers` and `exports` as they are.
2. `indexer.service.ts`: add a module-level `INDEXER_SEARCH_TTL_SECONDS = 60 * 10`.
3. Add a module-level `normalizeQuery(query: string): string` — `trim`, collapse internal
   whitespace runs to a single space, lowercase (REQ-4) — and derive the key as
   `indexer:search:${normalizeQuery(query)}` (NFR-3). Do not import or export `deriveGroupKey` from
   `client.ts`; the coincidence is not a shared concept (`../plan.md` § Approach).
4. Inject `RedisService` into the constructor beside `ProwlarrClient`.
5. Rewrite `search()` in this exact order, because the order is the feature:
   1. the existing `if (!query.trim()) return []` stays **first**, before any Redis or Prowlarr
      contact (REQ-8);
   2. `readCache(key)` — a defined result is returned immediately, with no client call (REQ-1);
   3. on miss, `await this.prowlarr.search(query)`. This call is **not** wrapped in a `try` — an
      `INDEXER_UNAVAILABLE` from `ProwlarrClient` must propagate untouched, and wrapping it is the
      most likely way to end up caching a failure (REQ-7, `../plan.md` § Risks row 1);
   4. dispatch the write **without awaiting** — `void this.writeCache(key, results)` — and then
      `return results` (REQ-2, REQ-2b). Because `writeCache` catches internally the dispatched
      promise cannot reject, which is what keeps `void` safe here.
6. Add the private `readCache`/`writeCache` pair modelled on `PopularMediaService`. `readCache`
   returns `TorrentResult[] | undefined` and treats a JSON parse failure the same as a miss;
   `writeCache` returns `Promise<void>` and never rethrows. Note that an empty array is a **hit**,
   not a miss (REQ-6) — the miss test is `raw === null`, never falsiness of the parsed value.
7. Write `indexer.service.spec.ts`.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **"None"**, and that is the obligation: the generated
`services/api/src/schema.gql` must be byte-identical for `searchTorrents` after this change. No new
field on `TorrentResult`, no new argument, no new key in `src/i18n/error-keys.ts`. If `schema.gql`
appears in the diff at all it is a regeneration artifact and its `searchTorrents`/`TorrentResult`
sections must be unchanged (Constitution, Article IV).

The delta is read-only. If it is wrong, stop and report.

## Tests

`services/api/src/indexer/indexer.service.spec.ts` — **owed**, and it is the only unit here that
is. Every failure mode in this slice produces a perfectly well-formed response, which is precisely
Article IX's trigger:

- **A cached failure.** If the Prowlarr throw were ever swallowed into an empty list and written,
  the title shows "no releases" for ten minutes with nothing in any log. Assert that after
  `prowlarr.search` rejects, `search()` rejects with the same error **and** `redis.set` was never
  called.
- **A cache that never populates.** The write is deferred by a microtask (REQ-2b), so a naive
  assertion right after `await search()` sees nothing and looks like a bug in the code rather than
  in the test. The suite must flush the microtask queue before asserting `redis.set` — and the
  header must say so, or the next person deletes the assertion and the cache silently stops
  working while every response stays correct.
- **A hit that still calls Prowlarr.** The returned list is identical either way; only
  `expect(prowlarr.search).not.toHaveBeenCalled()` can tell the difference. Include the
  empty-array-is-a-hit case (REQ-6) here, since a truthiness check on the parsed value is the
  natural bug and produces no visible symptom either.
- **Key normalization.** `"  MaTrix  "` and `"matrix"` must produce one key; assert on the string
  passed to `redis.get`/`redis.set`, not on the return value, which is the same either way (REQ-4).
- **Redis down.** `redis.get` rejecting and `redis.set` rejecting must both leave `search()`
  resolving with live results (NFR-1, and the crash risk in `../plan.md` § Risks row 4).

The header paragraph required by Article IX must name these; the module change in step 1 is wiring
and is owed nothing.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
```

Typecheck reports 0 errors, and the api suite passes with the new file included — a count above the
308/33 recorded in the root `CLAUDE.md`, with no previously-passing suite newly failing.

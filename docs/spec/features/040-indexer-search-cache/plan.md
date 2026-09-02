---
title: Indexer search cache — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-02
status: Implemented
---

# PLAN: Indexer search cache (`plan.md`)

## Approach

The cache goes in `IndexerService` (`services/api/src/indexer/indexer.service.ts`), **not** in
`ProwlarrClient`. This repository already draws that line: `TmdbClient` is a pure adapter that
speaks HTTP and nothing else, and the Redis read-through around it lives one layer up, in
`PopularMediaService` (`033-billboard-and-navigation`). `ProwlarrClient` is the same kind of
object — it owns the Prowlarr URL, the API key header, the `INDEXER_UNAVAILABLE` throw and the
grouping in `filterData` (`037-indexer-result-loss`), and it stays that way. Putting a Redis
dependency inside it would make the one class that models "what Prowlarr is" also model "what we
remember about Prowlarr", and would leave `filterData` re-running on every hit for no reason.

So `IndexerService` grows the read-through and `IndexerModule` imports `RedisModule`
(`services/api/src/redis/redis.module.ts`), which already exports the shared `ioredis` instance
every other consumer uses. The `readCache`/`writeCache` private-method pair from
`PopularMediaService` is copied in shape — `get` → `JSON.parse` → `undefined` on any throw;
`set` with `'EX'` → swallow on any throw — because that pair is the established answer to NFR-1
and reinventing it is exactly what Article X forbids.

The one deliberate divergence from `PopularMediaService` is REQ-2b: there the write is `await`ed
before returning, here the value is returned first and the write is dispatched behind it. Because
`writeCache` catches internally it never rejects, so `void this.writeCache(...)` satisfies "with a
handler attached" without a bare `.catch()` bolted on at the call site. The alternative — awaiting,
as `PopularMediaService` does — was rejected by the spec author on the grounds that the response
owes the cache nothing; the cost is that the write is no longer observable at the moment the caller
gets its answer, which the tests and AC-2 account for explicitly.

Query normalization (`trim`, collapse internal whitespace, lowercase) is a new local helper in
`indexer.service.ts`. `client.ts` already normalizes a *title* the same three ways inside
`deriveGroupKey`, and that function is deliberately **not** exported or shared: it keys a release
group by title+size, this keys a cache entry by user query. They coincide today by accident, and
coupling them would mean a future change to release grouping silently repartitions the cache.

## Order of Work

Single service. There is no sequencing problem and nothing to run in parallel.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | The only service in `services:`. `web` consumes `searchTorrents` unchanged and is not touched. |

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. It is empty by
design, and that emptiness is the contract: **`searchTorrents(query: String!): [TorrentResult!]!`
does not change** — not its name, not its argument, not its return type, and not its error set.

Two things an implementer will be tempted to add and must not:

- **A `cached: Boolean` field, or any other hit/miss signal on the response.** `web` has no use for
  it, `TorrentResult` is retyped by hand in `services/web/src`, and adding a field to prove the
  cache works is proving it in the wrong place — that is what AC-1 and AC-2 are for.
- **A new error key for a Redis failure.** NFR-1 is explicit that a broken Redis is invisible to the
  caller. `error-keys.ts` gains nothing; `INDEXER_UNAVAILABLE` stays the only error this query can
  produce.

If the contract turns out to be wrong, stop, amend `spec.md`, re-approve (Constitution, Article
VIII).

## Migrations

None. No Prisma model, field or enum is touched, and `services/api/prisma/` must not appear in the
diff.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A failed Prowlarr call is cached | `INDEXER_UNAVAILABLE` throws from inside the `try` that also wraps the write, or an empty array is substituted for the error — the title then appears to have zero releases for ten minutes, with no error in any log and nothing for the user to retry into. This is the silent failure this feature is most likely to introduce. | The write is only reachable on the success path (REQ-7); `indexer.service.spec.ts` asserts `redis.set` was never called after the client throws; AC-4 verifies it live with the container stopped. |
| The deferred write is dropped under test, then assumed absent in production | A test that checks `redis.set` synchronously after `search()` resolves sees nothing (the write is one microtask later), the assertion is "fixed" by deleting it, and the cache silently never populates — every response still looks perfect. | The suite flushes the microtask queue before asserting the write, and the test header names this. AC-2 checks the real key exists after the call returns. |
| Cache poisoned with a caller-shaped value | If anything user-scoped were ever added to `searchTorrents`, the shared key (REQ-5) would hand one user another's view. It is safe today only because the resolver takes `query` and nothing else. | `indexer.resolver.ts` is untouched — no `@CurrentUser`, no principal read. Stated here so a future change to that resolver knows it invalidates REQ-5. |
| A rejected write crashes the process | An unobserved rejected promise from the deferred write terminates Node on `unhandledRejection`, taking the whole API down long after the request that caused it. | `writeCache` catches internally, so the dispatched promise cannot reject; a test forces `redis.set` to reject and asserts `search()` still resolves. AC-4b checks `api` is still running. |
| Stale results confuse a user chasing a just-published release | Ten minutes of staleness with no way to force a refresh (out of scope). | Accepted, and bounded by the TTL. Recorded here so it is a known trade, not a bug report later. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
```

Then the manual pass, which is `spec.md`'s acceptance criteria in order:

1. `bin/dev -d`, then run `searchTorrents(query: "matrix")` twice from the GraphQL playground.
   Both return the same list; `docker compose logs indexer` shows one `/api/v1/search` (AC-1).
2. `bin/cli redis redis-cli --scan --pattern 'indexer:*'` → one key;
   `bin/cli redis redis-cli ttl <key>` → a value in `(0, 600]` (AC-2).
3. `searchTorrents(query: "  MaTrix  ")` → still one key (AC-3).
4. `docker compose stop indexer`; search a fresh query → `INDEXER_UNAVAILABLE`, and the scan shows
   no key for it. `docker compose start indexer`; repeat → succeeds and is cached (AC-4).
5. `docker compose stop redis`; search → releases still returned, no error;
   `docker compose ps api` still running and `docker compose logs api` has no `unhandledRejection`
   (AC-4b, AC-5). `docker compose start redis` to restore.

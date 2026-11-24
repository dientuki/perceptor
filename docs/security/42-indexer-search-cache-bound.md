---
title: Bound the indexer search cache so it cannot fill the shared Redis
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api, infra]
source_finding: api/indexer/search-cache-unique-queries-fill-noeviction-redis
audit_verdict: needs_validation
priority: 42
---

# SPEC (draft): Bound the indexer search cache so it cannot fill the shared Redis

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> `needs_validation`: whether one user can push ~256 MB into Redis within the 600 s TTL depends on
> Prowlarr result sizes and latency and on Redis' baseline usage, none observable from source.
> Line numbers refer to commit `2a3976a`.
> Related to spec 12 (no throttle on the anonymous `login`) and spec 26 (Redis shared as the
> worker's control plane); neither closes this one.

## Context & Goal

`searchTorrents` (`indexer/indexer.resolver.ts:22-46`) takes an arbitrary `query` from any
authenticated user, with no throttle, and calls `IndexerService.search` (`indexer.service.ts:182`).
The cache key is `indexer:search:<normalized query>` (`:39-41`), so every distinct query is a new
entry. On a miss it calls `prowlarr.search` (`:190`) with no in-flight coalescing and fires
`writeCache` without awaiting it (`:192`), which stores the **whole** result list as JSON for
`INDEXER_SEARCH_TTL_SECONDS` = 600 s (`:33`, `:214`). There is no cap on entry count, entry size or
total bytes; a write error is only logged (`:215-217`).

The same Redis is started with `--maxmemory 256mb --maxmemory-policy noeviction`
(`docker-compose.yaml:421-422`) and also holds login sessions (`auth/session.service.ts:16`, a
`set` plus `sadd`/`expire`) and the BullMQ queues. Under `noeviction` a full Redis rejects writes
instead of evicting, so if the cache reached the limit, logins and job enqueues would fail until
entries expired. The hunter measured ~45 KB per 100-result query
(`agents/h-indexer-search/artifacts/evidence/cache-harness.log`), i.e. roughly 6,000 unique broad
queries inside 600 s (~10 real multi-indexer Prowlarr searches per second) to get there.

The goal is that the search cache can never be the thing that exhausts the memory sessions and
queues depend on.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Entry size cap)**: `writeCache` skips (and logs) a result list whose serialized size
      exceeds a fixed cap; the caller still receives the results.
- [ ] **REQ-2 (Per-user rate limit)**: `searchTorrents` limits how many cache-missing searches one
      user may start per window, answering with a keyed error when over. [NEEDS CLARIFICATION:
      window and count. The `073`/`076` sweeps call `search` internally and must stay exempt.]
- [ ] **REQ-3 (Isolation)**: [NEEDS CLARIFICATION: pick one, or both. (a) a total-bytes or
      entry-count budget for `indexer:search:*` the api enforces itself; (b) a separate Redis
      database/instance or an eviction policy for cache keys, so the sessions/queues instance keeps
      `noeviction`. (b) is an infra change and affects the compose files `install.sh` ships.]
- [ ] **REQ-4 (Single flight)**: Concurrent identical misses share one Prowlarr call (optional;
      reduces load, does not bound cardinality).

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (040 unchanged)**: A repeat search inside 10 minutes is still served from cache
      (spec 040 REQ-1/REQ-3); the TTL stays a constant.
- [ ] **NFR-2 (Fail open)**: A Redis write failure never fails the search, as today.

## GraphQL Contract Delta

No shape change. If REQ-2 is adopted:

| Condition | GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Too many searches in the window | new `error.indexer.search_rate_limited` | a "too many searches, wait a moment" line in both catalogs |

## Data Model Changes

None (Redis only).

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: Start a real Redis with the compose flags (`--maxmemory 256mb
      --maxmemory-policy noeviction`) and a mock Prowlarr returning the measured per-query payload;
      issue unique queries concurrently as one user until a cache `SET` returns `OOM`, then show a
      session-style `SET` also fails. After the fix the cache stops growing before the limit and the
      session `SET` succeeds. Dummy data only.
- [ ] **AC-2**: A result list above the REQ-1 cap is returned to the caller and not stored.
- [ ] **AC-3**: Over the REQ-2 limit, a user's next new query fails with the keyed error while a
      cached query still answers; the acquisition sweeps are unaffected.
- [ ] **AC-4**: A repeated query within 600 s makes no Prowlarr call (040 regression).

## Out of Scope

- **Login throttling** — spec 12. **Redis authentication and exposure** — specs 21 and 26.
- **Prowlarr's own rate limits per tracker** — Prowlarr's concern.

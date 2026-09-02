---
title: Indexer search cache
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-02
last_updated: 2026-09-02
status: Implemented
services: [api]
---

# SPEC: Indexer search cache (`spec.md`)

## Context & Goal

Every `searchTorrents` query reaches Prowlarr live. `IndexerService.search`
(`services/api/src/indexer/indexer.service.ts`) forwards straight to
`ProwlarrClient.search` (`services/api/src/clients/indexer/client.ts`), which issues one
`GET /api/v1/search` per call. Prowlarr in turn fans that query out to every configured indexer,
some of them behind FlareSolverr, so a single search is the slowest and most fragile call in the
whole product — seconds of latency, and the only place where a third party can rate-limit or
Cloudflare-block us. The "Find release" row of the pipeline table in the root `CLAUDE.md` is the
stage this touches; no stage changes status.

Nothing about that work is worth repeating minute to minute. A tracker's set of releases for a
given title does not meaningfully change inside ten minutes, yet today the cost is paid again on
every retry, every reopen of the torrent modal in the movie detail page, and every second user
searching the same title. The "Best candidates" toggle (`037`, `036`) already re-ranks the fetched
list client-side precisely because refetching is expensive — this feature makes the fetch itself
cheap to repeat.

Once this ships, an identical query inside a ten-minute window is served from Redis with no
outbound HTTP at all, and Prowlarr sees one request instead of N. Redis is already a first-class
dependency of `api` (`services/api/src/redis/redis.service.ts`), and the same read-through pattern
is already in production for TMDB in `PopularMediaService` (`033`) — this feature is that pattern
applied to a second upstream, not a new mechanism.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Read-through)**: A `searchTorrents` query whose normalized query string was
      searched successfully less than the TTL ago must be answered from cache, with **no** outbound
      request to Prowlarr.
- [x] **REQ-2 (Write on miss)**: A cache miss must call Prowlarr as it does today, and store the
      resulting release list.
- [x] **REQ-2b (Response never waits on the write)**: The release list must be returned to the
      caller **before** the cache write is awaited. Serving the user is the only thing on the
      critical path; storing the entry is a side effect that happens after, and a slow or hanging
      Redis must not add a millisecond to the response. The write's rejection must be swallowed at
      the point it is dispatched — an unobserved rejected promise crashes the Node process, so
      "fire and forget" here means dispatched *with* a handler attached, never without one.
- [x] **REQ-3 (TTL)**: A cached entry must expire ten minutes after it was written. There is no
      refresh-on-read: an entry's lifetime is fixed from its write.
- [x] **REQ-4 (Normalized key)**: Two queries that differ only in surrounding whitespace, internal
      whitespace runs, or letter case must hit the same cache entry. Any other difference must not.
- [x] **REQ-5 (Shared, not per-user)**: The cached entry is shared by every caller. `searchTorrents`
      takes only a query string and its result carries no user-owned data, so one user's search
      warms the cache for the next.
- [x] **REQ-6 (Empty results are cached)**: A search that legitimately returns zero releases is a
      valid answer and must be cached like any other, so a title with no seeded release does not
      re-hit Prowlarr on every attempt.
- [x] **REQ-7 (Failures are never cached)**: A Prowlarr call that fails — unreachable, or a non-2xx
      response — must leave the cache untouched and still surface `INDEXER_UNAVAILABLE` to the
      caller. The next attempt must retry Prowlarr rather than serve a cached error.
- [x] **REQ-8 (Empty query unchanged)**: A blank or whitespace-only query keeps today's behaviour —
      an immediate empty list, with neither a Redis read nor a Prowlarr call.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Redis is best-effort)**: A Redis outage — read error, write error, or unparseable
      stored value — must degrade to today's live-Prowlarr behaviour, never to an error shown to the
      user. This mirrors `PopularMediaService.readCache`/`writeCache`, except for the write's
      position relative to the response (REQ-2b): there the write is awaited before returning, here
      it is not.
- [x] **NFR-2 (Shape fidelity)**: A cache hit must return releases indistinguishable from a live
      call — same `TorrentResult` fields, same grouping, same ordering. Grouping and sorting happen
      before the value is stored, so a hit never re-derives them.
- [x] **NFR-3 (Namespaced keys)**: Cache keys live under an `indexer:` prefix, disjoint from the
      `tmdb:` keys already in the same Redis instance and from BullMQ's `bull:` keyspace, so
      `bin/dbreset`'s `FLUSHALL` and any future targeted purge stay unambiguous.
- [x] **NFR-4 (No new configuration)**: The TTL is a constant in `api`, not a Setting and not an
      environment variable. `.env`, `.env.example` and the Settings screen are untouched.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.**

`searchTorrents(query: String!): [TorrentResult!]!` keeps its exact signature, return type and
error behaviour. The cache is invisible to `web`: a hit and a miss are indistinguishable from the
outside apart from latency, and `INDEXER_UNAVAILABLE` still reaches the client on the failure path
described in REQ-7. No error condition is added or removed.

## Data Model Changes

None.

## Acceptance Criteria

- [x] **AC-1**: With `bin/dev` up, run `searchTorrents(query: "matrix")` twice within ten minutes.
      Both return the same list; `docker compose logs indexer` shows exactly one
      `/api/v1/search` for the second-through-Nth call's window.
- [x] **AC-2**: Once the first search of AC-1 has returned,
      `bin/cli redis redis-cli --scan --pattern 'indexer:*'` lists one key, and
      `bin/cli redis redis-cli ttl <that key>` returns a value in `(0, 600]`. The key is written
      after the response, so this is checked following the call, not concurrently with it (REQ-2b).
- [x] **AC-3**: `searchTorrents(query: "  MaTrix  ")` after AC-1 returns from cache — the key count
      from AC-2 stays at one (REQ-4).
- [x] **AC-4 (failure path)**: Stop the `indexer` container, then run `searchTorrents` for a query
      never searched before. The call fails with the `INDEXER_UNAVAILABLE` error, and
      `bin/cli redis redis-cli --scan --pattern 'indexer:*'` shows **no** key for that query.
      Restart `indexer` and repeat the query: it now succeeds and is cached (REQ-7).
- [x] **AC-4b (failure path)**: With `redis` stopped, a cache-missing `searchTorrents` returns its
      releases normally and `api` stays up — `docker compose ps api` still reports it running and
      `docker compose logs api` shows no `unhandledRejection` from the deferred write (REQ-2b).
- [x] **AC-5 (failure path)**: Stop the `redis` container and run `searchTorrents`. The query still
      returns releases from Prowlarr, with no error surfaced to the caller (NFR-1).
- [x] **AC-6**: `bin/npm api run test` passes, including a new spec covering: hit serves without
      calling the client, miss calls once and writes, a thrown client error writes nothing, and a
      Redis read/write rejection falls through to a live call.

## Out of Scope

- **Manual invalidation.** No "refresh results" button, no mutation, no Settings action to purge
  the cache. Ten minutes is short enough that waiting is the invalidation; adding a purge path
  before anyone has wanted one is the "might be useful later" Article X forbids.
- **A configurable TTL.** Making it a Setting means a schema seed, a Settings tab field and a
  translation key for a number nobody has asked to change (NFR-4).
- **Caching anything else in the acquisition path.** `resolveInfoHash`
  (`src/clients/indexer/resolve-info-hash.ts`) fetches per release actually added, not per search;
  it is rare, already lazy, and its result is persisted in the database anyway.
- **Warming or prefetching.** Nothing populates the cache ahead of a real user search — no
  background job, no warm-on-registration.
- **Sharing the cache with `worker`.** `worker` never searches the indexer; only `api` reads and
  writes these keys.

---
title: Indexer search cache — Tasks
last_updated: 2026-09-02
status: Done
---

# TASKS: Indexer search cache (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

This feature is single-service (`services: [api]`), so there is no contract handshake to sequence
and no cross-service parallelism. The groups below are ordered by dependency inside `api`: wiring,
then the cache primitives, then the read-through that uses them, then the suite that defends it.

## Tasks

### Group 1 — wiring

- [x] **T001** `[api]` Add `RedisModule` (`services/api/src/redis/redis.module.ts`) to the `imports`
      of `services/api/src/indexer/indexer.module.ts`, beside the existing `SettingsModule`. Leave
      `providers` and `exports` untouched.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `bin/dev -d` brings `api`
      up healthy — a missing provider surfaces as a Nest dependency-resolution failure at boot, not
      at typecheck, so the container must actually start.

### Group 2 — cache primitives

Nothing here changes observable behaviour yet; `search()` still forwards straight to Prowlarr after
this group. That is deliberate — it keeps the read-through in T005 a small, reviewable diff.

- [x] **T002** `[api]` In `services/api/src/indexer/indexer.service.ts`, inject `RedisService` into
      the constructor beside `ProwlarrClient`, and add the module-level constant
      `INDEXER_SEARCH_TTL_SECONDS = 60 * 10`. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, `api` boots, and
      `searchTorrents` still returns releases unchanged.
- [x] **T003** `[api]` Add the module-level `normalizeQuery(query: string): string` (trim, collapse
      internal whitespace runs to one space, lowercase) and the key derivation
      `indexer:search:${normalizeQuery(query)}`. Do **not** import, export or reuse `deriveGroupKey`
      from `services/api/src/clients/indexer/client.ts` — see `api/plan.md` § Existing code to
      reuse for why the coincidence is not a shared concept. → T002
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, and `client.ts` does not
      appear in `git diff --name-only`.
- [x] **T004** `[api]` Add the private `readCache(key): Promise<TorrentResult[] | undefined>` and
      `writeCache(key, results): Promise<void>` pair, modelled method-for-method on
      `services/api/src/media/popular-media.service.ts`. `readCache` treats a JSON parse failure as
      a miss and tests for a miss with `raw === null` — never falsiness of the parsed value, since
      an empty array is a hit (REQ-6). `writeCache` uses `set(key, JSON.stringify(v), 'EX',
      INDEXER_SEARCH_TTL_SECONDS)` inside a `try`/`catch` that only logs and never rethrows. → T003
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and neither method has a
      code path that can reject.

### Group 3 — the read-through

- [x] **T005** `[api]` Rewrite `IndexerService.search()` in `indexer.service.ts` to the exact order
      in `api/plan.md` § Steps 5: (1) the existing `if (!query.trim()) return []` stays first,
      before any Redis or Prowlarr contact (REQ-8); (2) `readCache` hit returns immediately with no
      client call (REQ-1); (3) on miss, `await this.prowlarr.search(query)` **outside any `try`**,
      so `INDEXER_UNAVAILABLE` propagates untouched and a failure is never cached (REQ-7);
      (4) dispatch `void this.writeCache(key, results)` **without awaiting**, then `return results`
      (REQ-2, REQ-2b). → T004
      *Done when:* with the stack up, `searchTorrents(query: "matrix")` run twice inside ten minutes
      returns the same list while `docker compose logs indexer` shows a single `/api/v1/search`, and
      `bin/cli redis redis-cli --scan --pattern 'indexer:*'` lists exactly one key whose
      `ttl` falls in `(0, 600]`.

### Group 4 — tests

- [x] **T006** `[api]` Write `services/api/src/indexer/indexer.service.spec.ts` covering the five
      cases in `api/plan.md` § Tests: a client rejection leaves `redis.set` uncalled and rethrows;
      the deferred write is asserted **after flushing the microtask queue**; a hit (including a
      cached empty array) never calls `prowlarr.search`; `"  MaTrix  "` and `"matrix"` produce one
      key, asserted on the string passed to `redis.get`/`redis.set`; and a rejecting `redis.get` or
      `redis.set` still resolves with live results. Open with the Article IX header paragraph naming
      these failures — in particular that the microtask flush is load-bearing, so nobody deletes the
      write assertion when it looks spuriously empty. → T005
      *Done when:* `bin/npm api run test` passes with the new suite included, the api totals rise
      above the 308 tests / 33 suites recorded in the root `CLAUDE.md`, and no previously-passing
      suite newly fails.

### Group 5 — verification and docs

- [x] **T007** `[docs]` Update the root `CLAUDE.md` "Find release" pipeline row to note that an
      identical query inside ten minutes is served from Redis rather than re-queried, referencing
      `040`; and update the `indexer/` bullet in `services/api/CLAUDE.md`'s module map (line ~336)
      to say the read-through lives in `IndexerService`, not `ProwlarrClient`, and why. → T006
      *Done when:* both files name `040-indexer-search-cache` and neither still describes
      `searchTorrents` as an unconditional live Prowlarr call.
- [x] **T008** `[docs]` Walk the acceptance criteria in `spec.md` in order — AC-1 through AC-6,
      including the three failure paths (AC-4 with `indexer` stopped, AC-4b and AC-5 with `redis`
      stopped, checking `docker compose logs api` for `unhandledRejection`) — tick each box, refresh
      the test counts in the root `CLAUDE.md` "Current state" paragraph, and set
      `status: Implemented` on `spec.md`, `plan.md` and `api/plan.md`. → T007
      *Done when:* every AC checkbox in `spec.md` is ticked and the three files read
      `status: Implemented`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

---
title: Login and the Authentication Boundary — worker slice
service: worker
last_updated: 2026-08-10
status: Implemented
---

# PLAN: Login and the Authentication Boundary — `worker` (`worker/plan.md`)

## Scope

The worker is the other machine caller of the API (the qBittorrent hook is orchestrator-owned, not
worker-owned, since `services/torrent/` has no agent). This slice's entire job is: send
`Authorization: Bearer $SERVICE_TOKEN` on every GraphQL call, and fail loudly — never silently — if
that credential is missing or rejected. No call sites change; there is exactly one client function.

Writes confined to `services/worker/`.

## Files

| File | New/Mod | What changes |
| :-- | :-- | :-- |
| `src/api/graphql-client.ts` | Mod | Require `process.env.SERVICE_TOKEN` at call time with the same fail-fast shape as the existing `INTERNAL_GRAPHQL_URL` check (throw immediately, don't send an anonymous request); add `Authorization: Bearer ${token}` header; add a `res.ok` check as an independent second net alongside the existing `json.errors` throw; guard against a non-JSON error body. **Do not touch the `json.errors` throw itself** — it is already correct and is exactly what makes an auth failure fail a job loudly instead of leaving a movie stuck with nothing written |
| `src/api/graphql-client.spec.ts` | New | See Tests |

## Existing code to reuse

- `src/api/graphql-client.ts`'s existing shape and error-throwing convention —
  `services/worker/CLAUDE.md` calls this "errors must not be swallowed", load-bearing. Extend it,
  don't replace it.

All 8 operations (`mediaSource`, `processJob` queries; `sourceScanned`, `encodeStarted`,
`encodeProgress`, `encodeCompleted`, `encodeFailed`, `downloadRemove` mutations, across
`src/jobs/source-ready.job.ts` and `src/jobs/encode.job.ts`) already funnel through this one
function — no other file needs to change.

## Steps

1. Add the `SERVICE_TOKEN` env read + fail-fast check to `graphql-client.ts`.
2. Add the `Authorization` header to the fetch call.
3. Add the `res.ok` check (independent of, not replacing, the existing `json.errors` check).
4. Add the non-JSON response guard.
5. Write `graphql-client.spec.ts`.

## Contract obligations

Consumes the nine `@AllowService()`-gated operations from the api slice (the six `process-jobs`
operations, `mediaSource` + `sourceScanned`, and — note — `torrentCompleted` is NOT called by the
worker, it's called by the qBittorrent hook, orchestrator-owned). Must handle the case where `api`
rejects the service token (`No autenticado`) — this must surface as a thrown error that fails the
BullMQ job, per `services/worker/CLAUDE.md`'s central failure mode (a job silently marked complete
with nothing written is the worst outcome).

The delta is read-only. If it is wrong, stop and report — do not adapt it locally.

## Tests

| File | Defends against |
| :-- | :-- |
| `src/api/graphql-client.spec.ts` | The exact shape of NFR-2 in one file: a 401 response body containing `errors` must throw (not swallow); a missing `SERVICE_TOKEN` must throw synchronously at call time rather than silently sending an unauthenticated request; a non-2xx response with a non-JSON body must throw a clear error rather than an opaque `SyntaxError` out of `res.json()` |

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
```

Expected: worker was clean before this slice (0 errors) and must remain clean.

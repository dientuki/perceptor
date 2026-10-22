---
title: Stop and resume a running encode — worker slice
service: worker
last_updated: 2026-10-17
status: Implemented
---

# PLAN: Stop and resume a running encode — `worker` (`worker/plan.md`)

## Scope

One condition. `095` added an arm in `encode.job.ts`'s catch that abandons a job when
`encodeStarted` refuses with `error.encode.discarded`: it logs, reports nothing, and rethrows as
`UnrecoverableError`. This feature widens that same arm to `error.encode.stopped`. Everything else
about stopping already works here — `047`'s `encode:cancel` subscriber, `cancellation.ts`'s
`AbortSignal`, `runner.ts`'s kill and `.part.mkv` cleanup.

The worker does not read `ProcessJob.status` to decide anything (`encodeStarted` is the gate), does
not change the cancel channel, and does not resume anything — resume is `api` re-enqueueing.

Writes are confined to `services/worker/`.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/i18n/error-keys.ts` | Modified | `ERROR_ENCODE_STOPPED = 'error.encode.stopped'` beside `ERROR_ENCODE_DISCARDED`, listed with the other `api`-owned keys in the header |
| `src/jobs/encode.job.ts` | Modified | the refusal test accepts both keys |
| `src/jobs/encode.job.spec.ts` | Modified | one case |

## Existing code to reuse

- `src/jobs/encode.job.ts` lines ≈229–231 — `const discarded = error instanceof KeyedError &&
  error.key === ERROR_ENCODE_DISCARDED`. Widen it to a set of refusal keys; keep one arm and one
  rethrow. The log line names which refusal it was (`discarded` / `stopped` / `cancelled`) — AC-10
  reads it.
- `src/api/graphql-client.ts` — already rethrows a keyed `api` error as `KeyedError`.

## Steps

1. Add `ERROR_ENCODE_STOPPED` to `src/i18n/error-keys.ts` and its header list. If
   `messages.en.spec.ts` requires every key to render, add the English line to `messages.en.ts`.
2. Widen the refusal condition in `encode.job.ts` to both keys; log
   `[encode] <id>: stopped, reporting nothing` for the new one.

## Contract obligations

Consumes `encodeStarted(processJobId: Int!): String!`. New error: `error.encode.stopped` → abandon as
above (no `encodeFailed`, no BullMQ retry). Every other `encodeStarted` failure keeps today's
handling.

## Tests

- `src/jobs/encode.job.spec.ts` — one case beside `095`'s discarded one: `encodeStarted` rejects with
  `KeyedError('error.encode.stopped')` → no `encodeFailed`, no driver call, rejects with
  `UnrecoverableError`. Defends against a stopped job being reported as a failure (flipping it to
  `ERROR` if `api`'s guard regresses) or retried by BullMQ.

## Done when

```bash
bin/npm worker test
bin/cli worker npx tsc --noEmit
bin/comments worker
```

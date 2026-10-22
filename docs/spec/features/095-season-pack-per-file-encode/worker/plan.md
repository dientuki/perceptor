---
title: Per-file breakdown of multi-file sources — worker slice
service: worker
last_updated: 2026-10-17
status: Implemented
---

# PLAN: Per-file breakdown of multi-file sources — `worker` (`worker/plan.md`)

## Scope

One branch. When `encodeStarted` is refused with `error.encode.discarded`, the worker treats it as a
cancellation. It logs, reports nothing (no `encodeFailed`), and rethrows as `UnrecoverableError` so
BullMQ does not retry. A discard of the running encode already works through `047`: the
`encode:cancel` subscriber, `cancellation.ts`'s `AbortSignal`, `runner.ts`'s kill and `.part.mkv`
cleanup, and `encode.job.ts`'s "cancelled, reporting nothing" arm.

The worker does **not**:
- read `ProcessJob.status` to decide anything (`encodeStarted` is the gate);
- run the cleanup a discard triggers (`api` does, per `../plan.md`);
- change the shape of the cleanup instructions it executes after `encodeCompleted`.

Writes are confined to `services/worker/`.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/i18n/error-keys.ts` | Modified | transcribe `ERROR_ENCODE_DISCARDED = 'error.encode.discarded'` under the `api`-owned keys, byte-identical (same pattern as `ERROR_PROCESS_JOB_NOT_FOUND`) |
| `src/i18n/messages.en.ts` | Modified, only if `messages.en.spec.ts` requires every transcribed key to render | English line |
| `src/jobs/encode.job.ts` | Modified | the catch's cancellation arm also matches that `KeyedError` |
| `src/jobs/encode.job.spec.ts` | Modified | one case |

## Existing code to reuse

- `src/api/graphql-client.ts`: already rethrows an `api` error carrying `extensions.i18n.key` as a
  `KeyedError`. Nothing to add there.
- `src/jobs/encode.job.ts`'s `if (error instanceof EncodeCancelledError)` arm: widen its condition.
  Do not add a second arm with its own throw. `097` will widen the same condition again for
  `error.encode.stopped`.
- `src/i18n/error-keys.ts`: the hand-synced key list.

## Steps

1. Add `ERROR_ENCODE_DISCARDED` to `src/i18n/error-keys.ts` under the `api`-owned block. If
   `messages.en.spec.ts` demands it, add the English line `Encode was discarded by the user`.
2. In `encode.job.ts`'s catch, widen the cancellation test to
   `error instanceof EncodeCancelledError || (error instanceof KeyedError && error.key === ERROR_ENCODE_DISCARDED)`.
   The log line distinguishes the two (`discarded, reporting nothing` vs today's
   `cancelled, reporting nothing`), so AC-11 can be read off the log. Rethrow `UnrecoverableError`.
3. Confirm that nothing before `encodeStarted` in `handleEncode` touches the input file.
   `fetchEncodeJobDetails`, `fetchTrackTitles` and `buildOutputPath` run first; none of them reads
   the file. This is expected to need no change. If one of them probes the file (which `api` may
   already have deleted), stop and report, since it would surface as a failure before the refusal is
   seen.

## Contract obligations

Consumes `encodeStarted(processJobId: Int!): String!`. The new error condition is
`error.encode.discarded` in `extensions.i18n.key`: abandon silently, as above. Every other
`encodeStarted` failure keeps today's handling (it reaches the existing catch and is reported through
`encodeFailed`). `EncodeCompletedResult`'s three booleans keep their meaning and shape.

## Tests

- `src/jobs/encode.job.spec.ts`: one case. `encodeStarted` rejects with
  `KeyedError('error.encode.discarded')`. Expect no `encodeFailed` call, no encode driver call, and a
  rejection with `UnrecoverableError`. It defends against the silent failure where a file the user
  discarded is reported as a failed encode, or retried by BullMQ against an input `api` already
  deleted.
- Nothing else in this slice is new behaviour.

## Done when

```bash
bin/npm worker test
bin/cli worker npx tsc --noEmit
bin/comments worker
```

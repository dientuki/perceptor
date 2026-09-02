---
title: Encode Report Durability — worker slice
service: worker
last_updated: 2026-09-01
status: Approved
---

# PLAN: Encode Report Durability — `worker` (`worker/plan.md`)

## Scope

This slice makes the worker stop conflating "the encode failed" with "I could not tell anyone the
encode succeeded" (REQ-1), and hold a finished job's outcome until `api` acknowledges it (REQ-2,
REQ-3, REQ-4, NFR-1, NFR-2).

It does **not** change what an encode produces, which files it selects, or any FFmpeg argument —
`src/ffmpeg/` and the `ffmpeg/` case corpus belong to the `ffmpeg` agent and are untouched here. It
does **not** make `api` repeat-safe; that is `api`'s slice, and it lands first. It does **not**
introduce BullMQ `attempts` on either queue (`../spec.md` § Out of Scope) — the job is not re-run,
only its already-known outcome is re-delivered.

Writes are confined to `services/worker/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/api/graphql-client.ts` | Modified | Export `ApiUnreachableError`; throw it where `fetch` itself rejects |
| `services/worker/src/api/deliver-report.ts` | New | Retry-until-acknowledged wrapper for the two outcome reports |
| `services/worker/src/jobs/encode.job.ts` | Modified | Move the `encodeCompleted` call out of the `try`; route both reports through the wrapper |
| `services/worker/src/api/graphql-client.spec.ts` | Modified | Pin which failures are and are not `ApiUnreachableError` |
| `services/worker/src/api/deliver-report.spec.ts` | New | Retry, backoff, terminal-rejection cases |
| `services/worker/src/jobs/encode.job.spec.ts` | Modified | A lost `encodeCompleted` never reports `encodeFailed` |

## Existing code to reuse

- `services/worker/src/api/graphql-client.ts` — the single fetch path. `ApiUnreachableError` is
  added **inside it**, at the one place that knows no response arrived. Do not wrap `fetchGraphQL`
  from outside and guess at error shapes by string-matching `'fetch failed'`.
- `services/worker/src/i18n/keyed-error.ts` — `KeyedError` already marks an `api`-produced keyed
  error. It stays exactly what it is; `ApiUnreachableError` is its sibling for the opposite case,
  not a replacement.
- `services/worker/src/jobs/cleanup-source.ts` — unchanged, and still called after the encode's
  `try/catch` has closed. Its "never throw, only log" contract is why it can stay where it is.
- `handleEncode`'s existing `onProgress` / `onProbe` swallow-and-continue pattern — **do not** route
  either through the new wrapper. A lost progress tick and a lost ffprobe record are both designed
  to be droppable (`services/worker/CLAUDE.md` § Errors must not be swallowed); retrying them would
  block an encode on a diagnostic write.

## Steps

1. **Name the unreachable case.** In `graphql-client.ts`, export
   `class ApiUnreachableError extends Error`. Wrap only the `await fetch(...)` call: when it
   rejects, throw `ApiUnreachableError` carrying the original as `cause`. Everything below it is
   untouched and stays terminal — the non-2xx `Error`, the invalid-JSON `Error`, the unkeyed
   `GraphQL error: …` and the `KeyedError`. The two boot-time env `Error`s stay plain.

2. **Write the wrapper.** `src/api/deliver-report.ts` exporting
   `deliverReport<T>(label: string, send: () => Promise<T>): Promise<T>`. It calls `send()`; on
   `ApiUnreachableError` it logs one line naming `label` and the delay, waits, and retries —
   unbounded (NFR-2: never gives up). On any other error it rethrows immediately (REQ-3). Backoff
   grows and caps (NFR-2: never spins) — start around 5s, double, cap around 60s. Keep the delay a
   module constant so the spec can drive it fast.

3. **Move the boundary (REQ-1).** In `handleEncode`, take the `encodeCompleted` `fetchGraphQL` call
   *out* of the `try` block. The `try` ends once `encode(...)` / `passthrough(...)` has returned and
   `ffmpegCommand`/`finalOutputPath` are set; the `catch` keeps its existing job of reporting a real
   encode failure. This is the change that makes REQ-1 structural rather than conditional — after
   this move there is no code path from a successful encode to `encodeFailed`.

4. **Route both reports through the wrapper (REQ-2).** The relocated `encodeCompleted` call becomes
   `encodeCompleted = (await deliverReport(...)).encodeCompleted`. In the `catch`, the `encodeFailed`
   call is wrapped the same way — and its trailing `.catch((err) => console.error(...))` is
   **removed**: swallowing the failure is precisely the bug that lost the incident's report. A
   terminal rejection from `deliverReport` there should still not mask the original encode error, so
   keep the `throw error` that follows.

5. **Confirm the queue blocks (REQ-4).** Nothing to implement — `concurrency: 1` on the encode
   `Worker` in `src/index.ts` already means an awaited retry holds the queue. Do not add a timeout,
   a bail-out or a second worker to "avoid" this; the blocking is the decision (`../spec.md` REQ-4).

6. **Keep `cleanupSource` where it is.** It runs after the whole `try/catch`, on the verdict that
   finally arrived. It must execute that verdict even when it arrived on a retry — see
   `../plan.md` § Contract Freeze for why suppressing it would leak a torrent silently.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta — **read-only**. No SDL changes; this slice consumes:

- `encodeCompleted(processJobId: Int!, outputFilePath: String!, ffmpegCommand: String!): EncodeCompletedResult!`
  — unchanged selection (`message removeTorrent deleteInputFile deleteDownloadPath`). All four fields
  must stay in the query: `encode.job.ts`'s existing missing-field guard treats an absent instruction
  as "skip cleanup entirely", and there is no codegen to catch a dropped field.
- `encodeFailed(processJobId: Int!, errorKey: String!, errorParams: String, errorMessage: String!): Boolean!`
  — unchanged.
- The worker may now send either of these **more than once** for the same job. `api` guarantees that
  is safe (REQ-5) as of step 1 of `../plan.md` § Order of Work. Do not add worker-side de-duplication
  to compensate — the guarantee lives on the `api` side, deliberately.
- Error conditions this slice must handle: `ApiUnreachableError` → retry forever; **everything
  else**, including an `api` rejection with or without an `i18n` key → stop, log once, let it
  propagate.

## Tests

Owed under Article IX — the incident this feature exists for produced no error anywhere:

- `services/worker/src/api/graphql-client.spec.ts` — assert a rejecting `fetch` produces
  `ApiUnreachableError`, and that an HTTP 500, an unkeyed GraphQL error and a keyed one produce
  errors that are **not** that class. If this drifts, `deliverReport` either retries a poison job
  forever (queue silently dead) or gives up on a real outage (the original bug back).
- `services/worker/src/api/deliver-report.spec.ts` — new. Assert: retries while
  `ApiUnreachableError` is thrown and returns the eventual value; rethrows any other error on the
  first attempt without retrying; waits between attempts rather than spinning.
- `services/worker/src/jobs/encode.job.spec.ts` — the incident case, stated directly: given an
  encode that succeeds and an `encodeCompleted` that first throws `ApiUnreachableError` and then
  succeeds, assert `encodeFailed` is **never** called and cleanup still runs on the verdict that
  eventually arrived. Fault-inject it: move the `encodeCompleted` call back inside the `try` and this
  case must go red.

Not owed: `src/index.ts` (no change), `cleanup-source.ts` (no change, already covered).

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
```

0 typecheck errors and a green suite. Report before/after counts rather than citing the numbers in
`services/worker/CLAUDE.md`, which are stale by design.

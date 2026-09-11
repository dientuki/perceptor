---
title: Interrupted Encode Recovery — worker slice
service: worker
last_updated: 2026-09-11
status: Implemented
---

# PLAN: Interrupted Encode Recovery — `worker` (`worker/plan.md`)

## Scope

`worker` owns three things here: the boot announcement that triggers the whole feature
(`encodeWorkerStarted`, called once before either `Worker` is constructed), the scratch-file cleanup
that makes a recovered encode safe to restart, and the classification of which failures BullMQ may
retry — cancellation and diagnosed failures must not be.

It does **not** decide what happens to an orphaned job. The worker's entire contribution to REQ-1 is
the fact of its own start; which jobs get requeued, which get failed and which get skipped is
`api`'s decision, made against rows the worker cannot see (Article III — this service has no Prisma
and no database). The worker logs the count `api` returns and never branches on it.

This slice also carries the one filesystem deletion in the feature (NFR-5, Article XII): `api` must
remove nothing, and the `.part.mkv` under the destinations root may only be removed from
`src/ffmpeg/runner.ts`, which is where the constitution's single exception lives.

Writes are confined to `services/worker/` and this directory. **`src/ffmpeg/` belongs to the
`ffmpeg` agent** (`.claude/agents/ffmpeg.md`), not to this one — the `runner.ts` change in step 2 is
plumbing inside an existing function, not a change to any selection or argument rule, but if it
turns into one, stop and report rather than editing a rule.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/index.ts` | Modified | The boot announcement in `main()`; the encode worker's `failed` listener reports exhaustion |
| `services/worker/src/api/encode-worker-started.ts` | New | The one GraphQL call, following `src/api/track-titles.ts`'s shape |
| `services/worker/src/ffmpeg/runner.ts` | Modified | `cleanupTemps()` also runs before the encode, not only on exit |
| `services/worker/src/jobs/encode.job.ts` | Modified | Cancellation and `KeyedError` rethrown as non-retryable |
| `services/worker/src/jobs/encode.job.spec.ts` | Modified | The non-retryable classification cases |

## Existing code to reuse

- **`src/api/deliver-report.ts` → `deliverReport(label, send)`** — exactly the semantics NFR-9 asks
  for and already built for this class of call: it retries **only** `ApiUnreachableError`, forever,
  with growing capped backoff, and rethrows anything `api` actually answered on the first attempt.
  Wrap the boot announcement in it. Do not write a second retry loop.
- **`src/api/track-titles.ts`** — the shape for a small, single-purpose GraphQL call in this service
  (a module owning its own query string and returning a plain value). Follow it rather than inlining
  the mutation in `index.ts`.
- **`src/api/graphql-client.ts` → `fetchGraphQL`** — throws on `json.errors` by design, and already
  forwards `Authorization: Bearer $SERVICE_TOKEN`, which is the credential `encodeWorkerStarted`
  requires. No auth work is needed in this slice.
- **`src/ffmpeg/runner.ts` → `cleanupTemps()`** — already removes both `<input>.working.mkv` and
  `<final>.part.mkv`, already holds the Article XII exception, already has both paths in scope. REQ-6
  is calling it one more time, at the start. **Wrinkle to plan for**: it is a closure inside
  `runFfmpeg`'s `new Promise(...)` executor, and that executor is synchronous — sequence the
  pre-encode cleanup before the spawn without turning the executor `async`, since a rejection thrown
  from an async executor is swallowed rather than rejecting the promise.
- **`src/encode/cancellation.ts` → `EncodeCancelledError`** — the classification REQ-8 needs already
  exists. It is deliberately **not** a `KeyedError` precisely so cancellation is recognisable; that
  is the check to branch on, not a string match on a message.
- **`src/i18n/keyed-error.ts` → `KeyedError`** — a failure carrying one of these has already been
  diagnosed and will recur identically, which is REQ-9's definition of non-retryable.
- **`src/jobs/encode.job.ts:230-235`** — the existing cancellation branch that rethrows before any
  GraphQL call. REQ-8 changes what is thrown, never whether it reports: a cancelled encode must
  still report nothing (`047-source-deletion`).

## Steps

1. **REQ-6, independent of everything else** — in `src/ffmpeg/runner.ts`, run `cleanupTemps()` before
   spawning FFmpeg as well as on the existing exit paths. Unconditional: a stale scratch file is dead
   weight and a collision risk however it got there, not only after a recovery.
2. **REQ-1 / NFR-9** — add `src/api/encode-worker-started.ts` with the mutation, and call it from
   `main()` in `src/index.ts` **before** either `Worker` is constructed, wrapped in `deliverReport`.
   Log the returned count. An unreachable `api` retries (that is `deliverReport`'s job); any other
   rejection propagates out of `main()` into the existing `.catch(...)` that `process.exit(1)`s, so
   the container restarts rather than consuming jobs having reconciled nothing.
   **Write the single-worker invariant as a comment at the call site**: this call is only correct
   because exactly one `worker` container runs, so "I just booted" and "nothing is encoding" coincide
   (`../spec.md` NFR-4). This is one of Article XI's permitted cases only if it stays a statement of
   the invariant — if it grows into prose, move it to the spec and cut it.
3. **REQ-8 / REQ-9, before step 4** — in `src/jobs/encode.job.ts`, rethrow both non-retryable classes
   as BullMQ's `UnrecoverableError` (exported from `bullmq` 6.0.9, verified): an
   `EncodeCancelledError` and a `KeyedError`. Preserve the original error's message and, for
   cancellation, preserve the existing "report nothing" behaviour exactly — the conversion happens
   after the decision not to report, never before it.
4. **REQ-10, last** — in `src/index.ts`, make the encode worker's `failed` listener report
   `encodeFailed` instead of only `console.error`-ing. Two guards: never report a cancelled job
   (REQ-8), and only report a job BullMQ is actually done with, not one with attempts remaining. A
   double report is tolerable — `api`'s `encodeFailed` is built to be received more than once
   (`038-encode-report-durability`) — but a report for a job that will be retried is not, because it
   turns a title red while its encode is still coming.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

```graphql
type Mutation {
  encodeWorkerStarted: Int!
}
```

- No arguments. Do not send a worker id, hostname or timestamp — the credential is the proof and the
  boot is the fact (`../plan.md` § Contract Freeze).
- Returns a non-null `Int`, the number of rows `api` reconciled. **Log it, never branch on it.** A
  worker that changed behaviour based on the count would be making a decision that belongs to `api`.
- Called with `SERVICE_TOKEN`, which `fetchGraphQL` already sends. There is no user-session path into
  this call and none may be added.
- The error this can return is `error.auth.unauthenticated` — reachable here only if
  `SERVICE_TOKEN` is missing, stale, or minted from a rotated `JWT_SECRET`. It is **not** an
  `ApiUnreachableError`, so `deliverReport` rethrows it on the first attempt and the bootstrap fails
  loudly, which is the correct outcome: a worker with a bad credential must not sit in a retry loop
  looking healthy.
- `encodeStarted`, `encodeProgress`, `encodeCompleted`, `encodeFailed`: signatures unchanged. REQ-10
  calls the existing `encodeFailed` with its existing arguments — `errorKey` is required, so the
  exhaustion report needs one of this service's own `error.encode.*` keys, not a new `api` key.

## Tests

In `services/worker/src/jobs/encode.job.spec.ts`, which already covers this file's report paths and
its cancellation behaviour. Under Article IX:

- **A cancelled encode is non-retryable and still reports nothing.** Both halves in one case: the
  error leaving the handler is BullMQ-non-retryable, and no `encodeCompleted`/`encodeFailed` call was
  made. If this regresses, deleting a source restarts the encode it was meant to stop — the exact
  `047-source-deletion` regression `../plan.md` § Risks names, and it fails by *doing work*, with no
  error in any log.
- **A `KeyedError` is non-retryable and still reports `encodeFailed` with its own key** (REQ-9). The
  silent failure here is the inverse: hours of CPU spent re-reaching an identical diagnosis.
- **An unclassified throw stays retryable** — the case that proves steps 3 and 4 did not simply make
  everything non-retryable, which would leave REQ-7 inert while looking implemented.

Not owed a test:

- The boot announcement in `index.ts`. `src/index.ts` has no spec today and testing it means
  standing up two BullMQ `Worker`s; its failure mode is loud by construction (NFR-9 — the bootstrap
  exits non-zero), which is the opposite of the silent failure Article IX asks about. It is covered
  manually by `../plan.md` § Verification steps 2-3.
- `src/api/encode-worker-started.ts` on its own — it is a query string and a `fetchGraphQL` call with
  no branching. `graphql-client.spec.ts` already covers the transport's error behaviour.
- The `runner.ts` pre-encode cleanup. `runner.ts` has no spec (recorded in
  `services/worker/CLAUDE.md` § Known debt) and the change reuses a function whose deletion paths are
  already exercised on every exit; AC-5 proves it end to end.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/npm worker run build
```

Typecheck reporting only the 2 pre-existing errors in `src/metadata/container-tags.spec.ts`
(recorded in the root `CLAUDE.md` under `052`); the suite green apart from the 2 pre-existing
`src/ffmpeg/` failures recorded there, unchanged in number and identity; `build` exiting 0.

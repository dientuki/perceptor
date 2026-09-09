---
title: Source deletion — worker slice
service: worker
last_updated: 2026-09-08
status: Implemented
---

# PLAN: Source deletion — `worker` (`worker/plan.md`)

## Scope

This service gains one capability: abandoning an encode it is currently running, because the
source that produced it was deleted. It subscribes to the `encode:cancel` Redis channel, kills
whichever child process the encode has running (FFmpeg, or `mkvmerge` if it already moved on to
the remux), lets the existing rejection path remove both temporaries, and ends the job **without
reporting any outcome to `api`**.

Explicitly **not** this slice: deciding *when* to cancel (the `api` publishes; this service only
reacts), removing the torrent from the client, deleting the download folder or the uploaded file
(`api` does all of that now — `cleanup-source.ts` is untouched by this feature and still owns the
post-*success* path), and the panel UI. There is no GraphQL change on this side: this slice
*removes* two calls in one case and adds none.

Writes are confined to `services/worker/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/queue/types.ts` | Modified | Transcribes `ENCODE_CANCEL_CHANNEL` and `EncodeCancelMessage` from `services/api/src/queue/types.ts`. |
| `services/worker/src/encode/cancellation.ts` | New | The `processJobId -> AbortController` registry, plus `EncodeCancelledError`. |
| `services/worker/src/index.ts` | Modified | Opens one ioredis subscriber on `encode:cancel`; closes it on `SIGTERM` beside the two Workers. |
| `services/worker/src/encode/types.ts` | Modified | `EncodeFn` takes a required `signal: AbortSignal`. |
| `services/worker/src/encode/encode.ffmpeg.ts` | Modified | Forwards the signal to `runFfmpeg`. |
| `services/worker/src/encode/encode.mock.ts` | Modified | Honours the signal between its steps. |
| `services/worker/src/encode/passthrough.ts` | Modified | Honours the signal around the move. |
| `services/worker/src/ffmpeg/runner.ts` | Modified | Aborts by killing `activeChild`; rejects with `EncodeCancelledError`. |
| `services/worker/src/jobs/encode.job.ts` | Modified | Registers/releases the controller; rethrows a cancellation without reporting. |
| `services/worker/src/encode/cancellation.spec.ts` | New | Registry behaviour. |
| `services/worker/src/jobs/encode.job.spec.ts` | Modified | A cancelled encode reports neither outcome. |

## Existing code to reuse

- **`src/ffmpeg/runner.ts` — `activeChild`, `killHandler`, `cleanupTemps()`, `settleReject()`.**
  All four already exist and do exactly what cancellation needs. `activeChild` deliberately points
  at whichever of FFmpeg/mkvmerge is running *right now* (the comment there explains the old bug
  where only FFmpeg was killable), and `cleanupTemps()` already `rm`s both `workingPath` and
  `partPath` on every rejection. **REQ-5 is satisfied by this existing code** — do not add a second
  temp-file cleanup. Abort wiring is one listener plus one rejection, nothing more.
- **`src/encode/types.ts` — the `EncodeFn` seam, and how `onProbe` was added by
  `023-ffprobe-log`.** The signal is added the same way and for the same stated reason: a
  **required** parameter, so a driver that forgets it fails to compile rather than silently never
  cancelling. Three implementations exist — `encode.mock.ts`, `encode.ffmpeg.ts` and
  `passthrough.ts` (which is not in `DRIVERS` and is called directly by `encode.job.ts` when
  `compressionEnabled === false`) — and all three must take it.
- **`src/queue/types.ts` and its opening comment.** The deliberate hand-copy of
  `services/api/src/queue/types.ts`. The channel constants go here the same way. Do not invent a
  shared package (`services/worker/CLAUDE.md` § "`src/queue/types.ts` is a deliberate copy").
- **`src/index.ts`'s connection object and `SIGTERM` handler.** The subscriber uses the same
  `REDIS_HOST`/`REDIS_PORT` reading and is closed in the same handler as the two Workers. `ioredis`
  is already a direct dependency of this service.
- **`src/i18n/keyed-error.ts`.** For contrast, not for reuse: `EncodeCancelledError` is
  deliberately **not** a `KeyedError`. It never reaches a user, never becomes an `errorMessage`,
  and must never acquire a translation key — its whole purpose is to be recognised and rethrown
  before any reporting happens.

## Steps

1. **`src/queue/types.ts`** — transcribe `ENCODE_CANCEL_CHANNEL = 'encode:cancel'` and
   `type EncodeCancelMessage = { processJobId: number }`, byte-identical to the api's. Extend the
   file's existing comment to say the channel is part of the same hand-synced contract.
2. **`src/encode/cancellation.ts`** (new) — a module-level `Map<number, AbortController>` and four
   exports: `registerEncode(processJobId): AbortSignal`, `cancelEncode(processJobId): boolean`
   (aborts and returns whether anything was registered), `releaseEncode(processJobId): void`, and
   `class EncodeCancelledError extends Error`. `cancelEncode` for an unregistered id is a no-op
   returning `false`, and calling it twice for the same id is the same no-op (NFR-1). Registering
   an id that is already registered replaces nothing and must not lose the existing controller —
   log and keep the first.
3. **`src/index.ts`** — open one ioredis client, `subscribe(ENCODE_CANCEL_CHANNEL)`, and on
   `message` parse the payload, read `processJobId`, and call `cancelEncode`. A malformed message
   is logged and dropped — it must never throw out of the handler and kill the subscriber. Log both
   outcomes (cancelled / not running here) with the id: on a stack where the message arrives at a
   worker that is not running that job, "not running here" is the correct and expected line. Close
   the subscriber in the existing `SIGTERM` handler.
4. **`src/encode/types.ts`** — add `signal: AbortSignal` as a required parameter of `EncodeFn`,
   after `onProbe`.
5. **`src/ffmpeg/runner.ts`** — `runFfmpeg` takes the signal. If `signal.aborted` on entry, reject
   immediately with `EncodeCancelledError` (which runs `cleanupTemps()` through the existing
   `settleReject`). Otherwise register an `abort` listener that kills `activeChild` with `SIGTERM`
   and, after a 10s grace, `SIGKILL` if it is still alive; when the child then closes, reject with
   `EncodeCancelledError` rather than the usual "ffmpeg failed" `KeyedError`. Remove the listener
   in the same place `cleanupListeners()` already removes the `SIGINT`/`SIGTERM` ones — the
   existing process-level handlers stay exactly as they are, they are a different concern
   (container shutdown).
6. **`src/encode/encode.ffmpeg.ts`** — accept the signal and pass it to `runFfmpeg`.
7. **`src/encode/encode.mock.ts`** and **`src/encode/passthrough.ts`** — accept the signal and
   check it at their step boundaries, throwing `EncodeCancelledError` when aborted. `passthrough`'s
   copy-then-rename `EXDEV` fallback is the one place here that can run long enough to matter;
   check before the move and after the copy, and remove a partial copy on abort.
8. **`src/jobs/encode.job.ts`** — call `registerEncode(processJobId)` before the encode begins and
   `releaseEncode(processJobId)` in a `finally` that covers every exit path. Pass the signal into
   both the `passthrough(...)` and `encode(...)` call sites — **both**, since `compressionEnabled`
   decides between them at runtime and only wiring one leaves an uncancellable path with no
   compile error. In the `catch`, test `error instanceof EncodeCancelledError` **first**, before
   the `KeyedError` branch: log one line and `throw error` — no `encodeFailed`, no `deliverReport`,
   no `cleanupSource`. Everything after the `catch` (the `encodeCompleted` report,
   `cleanupSource`) is already unreachable once the `catch` rethrows, which is what makes REQ-6
   hold for both reports.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

- **Subscribed, not published**: channel `encode:cancel`, message `{"processJobId": <Int>}`, JSON,
  one job per message. This service sends nothing back on it and must not open a reply channel —
  the api does not wait for one (NFR-1).
- The channel name and the field name are frozen. They are declared in
  `services/api/src/queue/types.ts` and hand-copied here with no compiler between the two files. A
  rename on this side produces a subscriber that is listening to a channel nobody publishes to:
  FFmpeg runs to completion and nothing errors anywhere.
- **GraphQL**: no mutation or query changes. The obligation is a *negative* one — REQ-6: a job
  abandoned through this path calls neither `encodeCompleted` nor `encodeFailed`. If a report does
  escape, `api` answers `error.processJob.not_found` for the row that is already gone;
  `deliverReport` correctly does not retry a real rejection (only `ApiUnreachableError`), so this
  fails loudly rather than looping — but it is still a bug in this slice, not an acceptable
  fallback.

## Tests

- **`src/encode/cancellation.spec.ts`** (new) — defends against a registry that silently cancels
  nothing: cancelling an id that was never registered returns `false` and throws nothing;
  cancelling a registered id aborts its signal exactly once; a second cancel is a no-op;
  `releaseEncode` removes the entry so a later message for the same id cannot abort a *different*
  job that reused the number.
- **`src/jobs/encode.job.spec.ts`** (extended) — defends against the silent failure this feature
  exists to prevent on this side: a cancelled encode must call neither `encodeCompleted` nor
  `encodeFailed`, and must not call `cleanupSource`. Assert on the mocked `fetchGraphQL` that no
  outcome mutation was sent, over both the compressing and the `compressionEnabled === false`
  paths — the two call sites are separate code and only one being wired is exactly the failure
  mode step 8 warns about.

**Not owed a test: `src/ffmpeg/runner.ts`.** It spawns real processes and has no spec today
(`services/worker/CLAUDE.md` § Known debt records this as a standing gap, not something this
feature closes). Its abort wiring is proven by AC-5 in the manual pass — no `ffmpeg`/`mkvmerge`
process and no `*.working.mkv`/`*.part.mkv` left within 15 seconds. Do not introduce a test
harness that spawns FFmpeg as a side effect of this feature.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/npm worker run build
```

Typecheck at 0 errors and the suite green. One **pre-existing, unrelated** failure is expected in
`src/ffmpeg/cases.spec.ts` — a stale expected track-title string in the `ffmpeg/2.json` corpus
fixture, first recorded under `039-per-title-language-split` and still out of scope here. Confirm
it is the same single failure at `HEAD` before this slice started; anything else is this slice's.

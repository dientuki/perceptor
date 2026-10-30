---
title: Automatic Offset for Subtitle Embed — worker slice
service: worker
last_updated: 2026-10-30
status: Implemented
---

# PLAN: Automatic Offset for Subtitle Embed — `worker` (`worker/plan.md`)

## Scope

The worker consumes the new `subtitle-embed-sync` job on the existing `subtitle-sync` queue. It
measures a library sidecar against its `.mkv` with the exact `ffsubsync` run `103` uses, and reports
the raw measurement or `error.subtitleEmbed.sync_failed` through the three new service-only
operations.

It does **not** judge the measurement, which is `api`'s `accept()`. It does not change the
`subtitle-embed` remux job, and it never writes beside the library file or the sidecar: the output
`.srt` goes to its own temporary directory, as `103` does. It never sees `SYNCING`.

Writes are confined to `services/worker/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/subtitles/measure-sync.ts` | New | `measureSync(filePath, candidatePath, signal)`, the body lifted out of `subtitle-sync.job.ts` |
| `src/jobs/subtitle-sync.job.ts` (+ spec) | Modified | Calls `measureSync`; behaviour unchanged |
| `src/jobs/subtitle-embed-sync.job.ts` (+ spec) | New | `handleSubtitleEmbedSync(job)` |
| `src/api/subtitle-embed-sync-reports.ts` | New | `subtitleEmbedSyncDetails`/`Completed`/`Failed`, hand-typed from `../spec.md` |
| `src/queue/types.ts` | Modified | `SUBTITLE_EMBED_SYNC_JOB`, `SubtitleEmbedSyncJob`, copied from `api`'s `src/queue/types.ts` |
| `src/index.ts` | Modified | The `subtitle-sync` `Worker` dispatches on `job.name` to either handler |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` (+ spec) | Modified | `ERROR_SUBTITLE_EMBED_SYNC_FAILED` and its message |
| `services/worker/CLAUDE.md` | Modified | The queue table's `subtitle-sync` row names the second job |

## Existing code to reuse

- **`src/jobs/subtitle-sync.job.ts`.** Its measurement body becomes `measureSync`:
  - `getMetadata`;
  - `pickSyncReference`;
  - the duration check;
  - `probeChapters`/`lastChapterStartMs`;
  - `mkdtemp`;
  - the `ffsubsync` args, including `--max-offset-seconds 600` and `--vad webrtc` for audio;
  - `runFfmpegCapture` with `binary: 'ffsubsync'`;
  - `parseFfsubsyncOutput`;
  - the `rm` in `finally`.
  It returns `{ offsetMs, framerateRatio, reference, score, mediaDurationMs, lastChapterStartMs }`
  or throws. The timeout (`SYNC_TIMEOUT_MS`) and the `AbortController` stay in the callers, or move
  into `measureSync`; either works, as long as there is one copy.
- **`src/api/deliver-report.ts`.** Every outcome report goes through `deliverReport`, which retries
  until `api` acknowledges.
- **`src/api/subtitle-sync-reports.ts`.** The shape the new reports file copies: `fetchGraphQL`
  with the query text and explicit variable types.
- **`KeyedError`.** A `subtitleEmbedSyncDetails` refused with `error.subtitleEmbed.sync_not_found`
  means "log and report nothing", exactly like `103`'s `sync_not_found` branch.

## Steps

1. Extract `measureSync` into `src/subtitles/measure-sync.ts`. Rewire `handleSubtitleSync` to call
   it. Existing `subtitle-sync.job.spec.ts` cases must pass unchanged, which proves the refactor.
2. Copy the queue constants and the payload type from `api`'s `src/queue/types.ts`, keeping the
   hand-sync note.
3. Write `src/api/subtitle-embed-sync-reports.ts` with the three operations and the exact argument
   names and types from `../spec.md`.
4. Write `handleSubtitleEmbedSync(job)`:
   1. Call `details`. On `sync_not_found`, log and return.
   2. Call `measureSync(details.filePath, details.candidatePath, signal)`.
   3. On success, report `subtitleEmbedSyncCompleted(...)` through `deliverReport`.
   4. On any error, log and report `subtitleEmbedSyncFailed(id, fileName,
      'error.subtitleEmbed.sync_failed')` through `deliverReport`.
   There is no "started" call; the contract has none.
5. In `src/index.ts`, change the `subtitle-sync` `Worker`'s processor to switch on `job.name`:
   - `SUBTITLE_SYNC_JOB` → `handleSubtitleSync`;
   - `SUBTITLE_EMBED_SYNC_JOB` → `handleSubtitleEmbedSync`;
   - anything else → the existing "unknown job, ignoring" log.
   Concurrency stays 1.
6. Add the key and message. Update the `CLAUDE.md` queue row.

## Contract obligations

The worker consumes the following, from `../spec.md`:

- **Job:** `subtitle-embed-sync` on queue `subtitle-sync`, payload `{ subtitleEmbedId: number,
  fileName: string }`.
- **`subtitleEmbedSyncDetails(subtitleEmbedId: Int!, fileName: String!)`.** Returns
  `{ subtitleEmbedId, fileName, filePath, candidatePath }`, both paths absolute container paths. It
  is refused with `error.subtitleEmbed.sync_not_found` when the embed is no longer measuring: drop
  the job silently. Any other error is a failed job; BullMQ `attempts: 1` means no retry, and
  `api`'s worker-boot reconcile covers the row.
- **`subtitleEmbedSyncCompleted(...)`.** Returns `Boolean!`, where `false` means unknown embed.
  Log it and do not retry.
- **`subtitleEmbedSyncFailed(subtitleEmbedId, fileName, errorKey)`.** The worker sends only
  `error.subtitleEmbed.sync_failed`. It never sends a verdict key (`sync_low_score`, …).

The delta is read-only. If it is wrong, stop and report.

## Tests

- **`subtitle-embed-sync.job.spec.ts`.**
  - Defends against a measurement that ends with no report, which leaves the embed `SYNCING` until
    the next worker boot:
    - a success reports `Completed` with the parsed values;
    - a `measureSync` throw reports `Failed` with `sync_failed`;
    - `sync_not_found` from `details` reports nothing.
  - The temporary directory is removed in all three paths, and nothing is written in the sidecar's
    directory. Assert on the `mkdtemp`/`rm` mocks and on the absence of writes beside
    `candidatePath`.
- **`subtitle-sync.job.spec.ts`.** Unchanged. It passing after the extraction is the test for the
  refactor.
- **`messages.en.spec.ts`.** Extend the `error.subtitleEmbed.*` enumeration with `sync_failed`, if
  it lists them explicitly.
- **Not tested.** The `index.ts` dispatch switch. It is a three-arm `if` with no logic, and a wrong
  arm surfaces in the live pass (AC-2) as an embed stuck in `SYNCING`.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/npm worker run lint
bin/comments worker
```

Typecheck and lint are clean, every test passes, and no new file is written outside the worker's
temporary directory during a measurement.

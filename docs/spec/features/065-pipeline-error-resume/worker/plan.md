---
title: Pipeline Error Visibility and Resume — worker slice
service: worker
last_updated: 2026-09-19
status: Implemented
---

# PLAN: Pipeline Error Visibility and Resume — `worker` (`worker/plan.md`)

## Scope

The scan handler (`src/jobs/source-ready.job.ts`) stops failing silently: any failure before or at
`sourceScanned` is reported to `api` through the new `sourceScanFailed` mutation, keyed, and
delivered through `deliverReport`. That is the whole slice.

Not this slice: the encode path (already reports through `encodeFailed`), the `src/ffmpeg/` rules,
resuming anything (`api` re-enqueues; the worker just runs the job it receives, unchanged), any
translation (`web`).

Writes are confined to `services/worker/`.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/jobs/source-ready.job.ts` | Modified | wrap the body; report failures |
| `src/jobs/source-ready.job.spec.ts` | New | see Tests |
| `src/i18n/error-keys.ts` | Modified | `ERROR_SOURCE_SCAN_FAILED = 'error.source.scan_failed'` (api-owned, byte-identical, like the three already transcribed) |
| `src/i18n/messages.en.ts` | Modified | its English message, same text as `api`'s |

## Existing code to reuse

- `src/api/deliver-report.ts`'s `deliverReport` — the only way this report is sent. It retries
  `ApiUnreachableError` forever and rethrows anything else; do not wrap it in another retry.
- `src/i18n/keyed-error.ts`'s `KeyedError` and `renderMessage` — the same key/params/message split
  `encode.job.ts` builds for `encodeFailed`. Copy that block's shape (keyed → its key/params;
  anything else → catch-all key with `{ detail }`), do not invent a second one.
- `src/api/graphql-client.ts` — already turns an `api` keyed GraphQL error (e.g. `sourceScanned`
  answering `error.source.match_not_reported`) into a `KeyedError`, so those round-trip with their
  own key for free.
- `src/jobs/encode.job.ts`'s catch block — the reference for "report, then rethrow as
  `UnrecoverableError`".

## Steps

1. Add the key and its message (`messages.en.spec.ts` already enforces the two lists agree).
2. In `handleSourceReady`, wrap everything from the `mediaSource` query through the `sourceScanned`
   call in one `try`. In the `catch`: build `errorKey`/`errorParams`/`errorMessage` —
   `KeyedError` → its own key/params (`ERROR_SOURCE_NO_DOWNLOAD_PATH`, `ERROR_SOURCE_NO_TARGET`,
   an `api` key from `sourceScanned`); anything else, including `ApiUnreachableError` from the
   first query and a filesystem error from `scanFolder` → `ERROR_SOURCE_SCAN_FAILED` with
   `{ detail: <message> }`. Then `await deliverReport('sourceScanFailed(<id>)', …)` with
   `errorParams` JSON-encoded as `encode.job.ts` does. Then rethrow as `UnrecoverableError` so
   BullMQ marks it failed without a retry and the existing `scanWorker.on('failed')` log still
   fires.
3. If `deliverReport` itself rethrows (a real rejection from `api` — e.g. an `api` that predates
   this feature), let that propagate: the job fails loudly in the log, the same outcome as today.
   Never swallow it.

## Contract obligations

Consumes `sourceScanFailed(mediaSourceId: Int!, errorKey: String!, errorParams: String,
errorMessage: String!): Boolean!` from `../spec.md`. `errorParams` is a JSON-encoded string or
omitted; `errorKey` is always set. `api` answers `true` for a missing or no-longer-`READY` source —
that is success, not something to retry or log as a failure. Its only error is
`error.auth.unauthenticated`, unreachable with `SERVICE_TOKEN`; if it happens it propagates.

## Tests

- `src/jobs/source-ready.job.spec.ts` (new, opens with the Article IX header: a scan that throws
  without reporting leaves the source `READY` and the row reading "downloaded" forever, with nothing
  in `api`). Cases, with `fetchGraphQL` mocked: a `scanFolder` throw reports
  `error.source.scan_failed` with the message as `detail`; a missing `downloadPath` reports
  `error.source.no_download_path`; an `api` keyed error from `sourceScanned` reports that key; a
  successful scan calls `sourceScanFailed` zero times; the handler throws `UnrecoverableError`
  after reporting. Fault-inject: remove the report and the first case must fail.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker run build
bin/npm worker test
git diff --stat services/worker/src/ffmpeg services/worker/src/encode
```

0 type errors; build exits 0; tests pass apart from the pre-existing `src/ffmpeg/` failures recorded
in the root `CLAUDE.md`; the last diff empty.

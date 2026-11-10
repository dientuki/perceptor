---
title: Season scan write conflict — api slice
service: api
last_updated: 2026-11-07
status: Approved            # Draft | Approved | Implemented
---

# PLAN: Season scan write conflict — `api` (`api/plan.md`)

## Scope

`api` owns the whole fix: the order in which two paths notify `TitleStatusService` and enqueue the
scan, and a bounded retry of `sourceScanned`'s transaction on MariaDB's snapshot-isolation
conflict (1020). No GraphQL surface changes, no schema change, no new error key. The worker, its
`process` queue options and `web` are untouched.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/prisma/write-conflict.ts` | New | pure classifier `isSnapshotWriteConflict(error): boolean` |
| `services/api/src/prisma/write-conflict.spec.ts` | New | classifier cases |
| `services/api/src/media-sources/media-sources.service.ts` | Modified | `sourceScanned`: bounded retry, per-attempt state |
| `services/api/src/media-sources/media-sources.service.spec.ts` | Modified | tests (c), (d), (e) |
| `services/api/src/seasons/seasons.service.ts` | Modified | `finishSeasonUpload`: `recomputeSeason` before `addSourceReady` |
| `services/api/src/seasons/seasons.service.spec.ts` | Modified | test (a) |
| `services/api/src/downloads/downloads.service.ts` | Modified | `downloadStart`/`resumeScanStage`: the target's recompute before the rescan is enqueued, and not again after |
| `services/api/src/downloads/downloads.service.spec.ts` | Modified | test (b) |

## Existing code to reuse

- `src/downloads/downloads.service.ts` `handleTorrentCompleted` and `src/uploads/uploads.service.ts`
  `handleUploadFinish` — already recompute before `addSourceReady`. That is the order to copy, with
  the same `// Spec 089, REQ-…` locator style plus a `// Spec 116, REQ-1` locator.
- `DownloadsService.recomputeStatus(source)` (private, `downloads.service.ts`) — already dispatches
  movie/episode/season to `TitleStatusService`. Reuse it inside the scan-resume path rather than
  calling `titleStatus.recomputeSeason` directly.
- `@prisma/client`'s `Prisma.PrismaClientKnownRequestError` — the class the classifier checks, the
  same import the `P2034` handlers in `subtitle-search/subtitle-search-request.service.ts` and
  `subtitle-embed/subtitle-embed.service.ts` use.
- The existing test harnesses: `media-sources.service.spec.ts`'s `sourceScanned fan-out` suite
  (`prisma.$transaction` mocked as `cb => cb(tx)`, make it reject on the first call for the retry
  cases); `seasons.service.spec.ts`'s `finishSeasonUpload` block; `downloads.service.spec.ts`'s
  `downloadStart on an ERROR source — resume` block, which already records an `order` array across
  `removeSourceReady`/`addSourceReady`. Extend those, don't build new harnesses.

## Steps

1. **Failing tests first (REQ-6).** Add, without touching production code:
   - (a) `seasons.service.spec.ts`: `finishSeasonUpload` calls `titleStatus.recomputeSeason`
     before `queue.addSourceReady` (record order through both mocks).
   - (b) `downloads.service.spec.ts`: `downloadStart` on a **season** source in `ERROR` whose last
     error stage is `SCAN` completes `recomputeSeason` before `addSourceReady`, and calls no
     recompute after it.
   - (c) `media-sources.service.spec.ts`: the first `$transaction` call rejects with a 1020
     `PrismaClientKnownRequestError` (`code: 'P2039'`, `meta.driverAdapterError.cause.originalCode:
     '1020'`), the second runs the callback. Expect two transaction calls, the source `SCANNED`,
     and `encodeQueue.addEncode` called exactly once per committed `ProcessJob` id, with no id from
     the rejected attempt.
   - (d) same file: every call rejects with the 1020 error. Expect exactly 3 calls, the 1020 error
     rethrown, `addEncode` and `titleStatus.recompute*` never called.
   - (e) same file: the transaction rejects with a non-conflict error (e.g. the
     `error.source.match_not_reported` path, or a `P2039` with another `originalCode`). Expect
     exactly 1 call.
   - `src/prisma/write-conflict.spec.ts`: the classifier is `true` for the shape above, `false` for
     `P2034`, for `P2039` with another `originalCode`, for a plain `Error` and for `null`. (The file
     does not exist yet; the import failing is its failing state.)
   Run `bin/npm api test -- src/seasons src/downloads src/media-sources src/prisma` and paste the
   failing output into the task report.
2. **`finishSeasonUpload`.** Move `this.titleStatus.recomputeSeason(seasonId)` between the guarded
   `PENDING → READY` `updateMany` and `this.queue.addSourceReady(...)`. Nothing else moves.
3. **Scan resume.** In the `SCAN` branch of `downloadStart`, recompute the source's target after
   `resumeScanStage` flips `ERROR → READY` and before it enqueues, and skip the trailing
   `recomputeStatus(source)` for that branch only. The encode and download branches keep their
   trailing recompute exactly as today. If `resumeScanStage` returns without enqueueing (no flip, or
   the race is not `WON`), the trailing recompute must still run once so the status stays fresh.
4. **Classifier.** `src/prisma/write-conflict.ts` exports `isSnapshotWriteConflict(error: unknown):
   boolean`: `PrismaClientKnownRequestError`, `code === 'P2039'`, and
   `String(meta?.driverAdapterError?.cause?.originalCode) === '1020'`. Pure, no Nest provider.
5. **Retry in `sourceScanned`.** Wrap the existing `$transaction` in a loop of at most 3 attempts
   (a module-level constant). Everything the transaction decides (the `ProcessJob` ids to queue, the
   episode ids to recompute, the scan-failed target) becomes the transaction callback's return
   value instead of variables mutated from outside it, so a rolled-back attempt leaves nothing
   behind. On `isSnapshotWriteConflict(error)` with attempts left, log one line
   (`[sourceScanned] mediaSource <id>: write conflict, attempt <n>/3`) and run it again; on any other
   error, or on the last attempt, rethrow unchanged. The post-commit block (recomputes, `addEncode`,
   `QUEUED` `updateMany`, `findOneFlat`) runs once, from the committed attempt's result. No delay
   between attempts is required.
6. Run the Done-when commands.

## Contract obligations

None at the GraphQL boundary (`../spec.md` § GraphQL Contract Delta is "None"). Behavioural
obligations the worker relies on, unchanged by this slice:

- `sourceScanned` still throws on failure, so the worker's `handleSourceReady` still reports
  `sourceScanFailed` with `error.source.scan_failed` (REQ-5). A conflict that exhausts its retries
  must reach the worker as an error, never as a resolved mutation.
- `sourceScanned`'s existing refusals keep their keys and fail on the first attempt:
  `error.source.not_found`, `error.source.no_target`, `error.source.match_not_reported`.

## Tests

- `src/prisma/write-conflict.spec.ts` — defends against the classifier matching nothing (every 1020
  keeps failing in production with no sign the retry exists) or matching too much (real errors
  retried and logged as conflicts).
- `src/media-sources/media-sources.service.spec.ts` (c)/(d)/(e) — defends against per-attempt state
  leaking across a retry (a rolled-back `ProcessJob` id enqueued, or an id enqueued twice), an
  unbounded or wrongly bounded loop, and retrying the wrong errors.
- `src/seasons/seasons.service.spec.ts` (a) and `src/downloads/downloads.service.spec.ts` (b) —
  defend against the recompute landing after the enqueue again, which fails only under real
  timing, never in a mocked run without an order assertion.

Each new test follows `services/api/CLAUDE.md` § Tests: indicative `it(...)` strings in English, a
header comment naming the silent failure, and fault injection (verify each fails when its rule is
removed: put the recompute back after the enqueue, drop the per-attempt reset, widen the classifier).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/comments api
```

Typecheck reports 0 errors, the full suite is green including the new tests, and the comment gate
passes. The step-1 failing output is in the task report.

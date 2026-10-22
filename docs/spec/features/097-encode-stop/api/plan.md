---
title: Stop and resume a running encode — api slice
service: api
last_updated: 2026-10-17
status: Implemented
---

# PLAN: Stop and resume a running encode — `api` (`api/plan.md`)

## Scope

`api` owns the `STOPPED` enum value and its migration, the two new keys
(`error.encode.stopped`, `error.processJob.not_running`), the new `encodeJobStop` mutation, the
encode branch of `downloadStop`/`downloadStart`, `encodeJobStart`'s widening, the report guards,
the race change (REQ-15), and every "is this still in flight" answer. It does **not** touch the
worker's refusal handling (`worker/plan.md`) or any button (`web/plan.md`).

Writes are confined to `services/api/`.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` | Modified | `STOPPED` in `EncodeStatus` |
| `prisma/migrations/<ts>_encode_status_stopped/` | New | generated |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | `ENCODE_STOPPED`, `PROCESS_JOB_NOT_RUNNING` + English copy |
| `src/pipeline-status/pipeline-status.ts` | Modified | `IN_FLIGHT_ENCODE_STATUSES`; `deriveSourceStatus`, `deriveTitleStatus`, `isRaceWinner`, `isDeliveredSource`, `cleanupDecision`, `projectJobStatus`, `countedProgress` |
| `src/downloads/downloads.service.ts` | Modified | `downloadStop`/`downloadStart` encode branches, `stopJobs` helper, `encodeJobStop`, `encodeJobStart`, `resumeEncodeStage`, `encodeJobDiscard` status list, demotion literal |
| `src/downloads/downloads.resolver.ts` | Modified | `encodeJobStop` mutation beside `encodeJobDiscard` |
| `src/queue/encode-queue.service.ts` | Modified | `removeEncode` reports whether the entry is gone |
| `src/process-jobs/process-jobs.service.ts` | Modified | `encodeStarted`, `encodeFailed` guards |
| `src/uploads/uploads.service.ts` | Modified | demotion literal → in-flight constant |
| `src/media-server/media-server-reconcile.service.ts` | Modified | `IN_FLIGHT_GUARD` literal → in-flight constant |

## Existing code to reuse

- `src/pipeline-status/pipeline-status.ts` — all status reasoning. Nothing outside this file decides
  what `STOPPED` means.
- `DownloadsService.loadOwnedJob` — ownership, retirement and race refusals for a single job
  (`095`). `encodeJobStop` starts with it; do not re-derive ownership.
- `DownloadsService.encodeJobDiscard`'s cancel/withdraw block — the best-effort
  `publishCancel`/`removeEncode` with a logged catch. Extract it into a private helper shared by
  discard and stop rather than copying it.
- `DownloadsService.resumeEncodeStage` — the whole re-enqueue/verify/rollback sequence, including
  `isEncodePending` (`095` REQ-11).
- `DownloadsService.recomputeStatus`, `reloadDownload`, `toDownload` — the return shape every
  mutation in this file uses.
- `ProcessJobsService.encodeStarted`/`encodeFailed` — `095`'s `DISCARDED` guards, widened.
- `downloads.resolver.ts`'s `encodeJobDiscard` resolver — copy its decorators and guard for
  `encodeJobStop`.

## Steps

1. **Schema + keys.** `STOPPED` in `EncodeStatus`; `bin/npm api run prisma:migrate --name
   encode_status_stopped`. `ERROR_KEYS.ENCODE_STOPPED = 'error.encode.stopped'` (beside
   `ENCODE_DISCARDED`) and `PROCESS_JOB_NOT_RUNNING = 'error.processJob.not_running'`, with English
   lines (`Encode was stopped by the user`, `This file is not being encoded`).
2. **`pipeline-status.ts`.**
   - Export `IN_FLIGHT_ENCODE_STATUSES` = `ACTIVE_ENCODE_STATUSES` + `STOPPED`.
   - `deriveSourceStatus`: new rule after 3b (`ERROR`) and before 3c (`COMPLETED`) — some counted
     job `STOPPED` → `PAUSED`, `downloadProgress: 100`, `encodeProgress: countedProgress(counted)`,
     `encodeSpeed: null`. Rule 3 (active → `ENCODING`) and 3b (`ERROR`) stay ahead of it (spec REQ-4).
   - `countedProgress`: a `STOPPED` job counts 0 (spec REQ-13), like `ERROR`.
   - `deriveTitleStatus`: a `STOPPED` job contributes `maxStatus(best, 'PAUSED')`.
   - `isRaceWinner` (REQ-15): for a `SCANNED` source, after the all-`DISCARDED` check, return false
     when no job is active and some job is `STOPPED`. The existing failed-and-nothing-active rule
     stays.
   - `isDeliveredSource`, `cleanupDecision.removeTorrent`: read `IN_FLIGHT_ENCODE_STATUSES`.
     `cleanupDecision.deleteDownloadPath` already requires every job `COMPLETED`/`DISCARDED`; no change.
   - `projectJobStatus`: `STOPPED` → `PAUSED`; widen its return type.
3. **Literal sweep.** `downloads.service.ts` `demoteDeliveredSources` (≈ line 394),
   `uploads.service.ts` (≈ line 323) and `media-server-reconcile.service.ts` `IN_FLIGHT_GUARD` read
   `IN_FLIGHT_ENCODE_STATUSES`. `encodeJobDiscard`'s write list (≈ line 895) gains `STOPPED` (spec
   REQ-13: discard accepts a stopped job). `054`'s `reconcileOrphanedEncodes` selects `'ENCODING'`
   only — leave it, never widen it.
4. **Shared stop helper** (`private stopJobs(jobIds, runningId?)`). One guarded `updateMany` of the
   given ids `where status in ACTIVE` → `STOPPED`, `progress: 0`, `encodeSpeed: null`. Then, best-effort
   with a logged catch: `removeEncode` for every non-running id **first**, `publishCancel` +
   `removeEncode` for the running one **last** (so the worker freed by the cancel finds nothing of
   this source to dequeue). Never call the torrent client. `encodeJobDiscard` reuses the
   cancel/withdraw part of this helper instead of its own block.
5. **`downloadStop`** (REQ-1/2/3/9). After `findOwnedSource`, load the source's jobs. If any is
   active: `stopJobs` on all active ones, `recomputeStatus`, return the row. Otherwise today's
   torrent path, unchanged (AC-11) — an upload with nothing active still raises `not_a_torrent`.
6. **`resumeEncodeStage`** (REQ-5/12, NFR-5).
   - Select `status in ['ERROR', 'STOPPED']`; the guarded write to `WAITING` matches the job's own
     status; rollback restores each job to the status it came from (a stopped job to `STOPPED` with
     null error fields, an errored one to `ERROR` with its old fields).
   - Make `removeEncode` return whether the entry is gone afterwards. If it is not (the cancelled
     entry is still `active` inside the worker's 10 s kill grace), treat it as an enqueue failure
     **before** calling `addEncode` — `isEncodePending` alone cannot catch this, since it accepts
     `active`. This closes the stuck-`QUEUED` hole for both callers.
7. **`downloadStart`** (REQ-5/16). Keep the order: retired check → `ERROR` branch → `hasRaceWinner`
   refusal → **new**: if any job is `STOPPED`, `resumeEncodeStage(jobs)`, `recomputeStatus`, return
   (no `requireTorrent`, no torrent call) → torrent path. A mixed pack (`ERROR` + `STOPPED`) derives
   `ERROR` and goes through `resumeErroredSource`, whose `ENCODE` stage calls the widened
   `resumeEncodeStage` — one Play resumes both kinds.
8. **`encodeJobStop`** (REQ-11). `loadOwnedJob` (ownership, retired, race loser). If the job is not
   `WAITING`/`QUEUED`/`ENCODING` → `i18nError.conflict(PROCESS_JOB_NOT_RUNNING)`. Otherwise
   `stopJobs([job.id], running ? job.id : undefined)`, `recomputeStatus`, `reloadDownload`. Resolver
   in `downloads.resolver.ts` mirrors `encodeJobDiscard`'s.
9. **`encodeJobStart`** (REQ-12). Accept `job.status === 'STOPPED'` as well as a retryable `ERROR`;
   anything else stays `PROCESS_JOB_NOT_RESUMABLE`. `loadOwnedJob` already refuses when a sibling holds
   the race (REQ-16).
10. **Report guards** (REQ-7/8).
    - `encodeStarted`: `where: { id, status: { notIn: ['DISCARDED', 'STOPPED'] } }`; on 0 rows throw
      `ENCODE_DISCARDED` or `ENCODE_STOPPED` according to the row's status.
    - `encodeFailed`: return `true` early for `STOPPED` as for `DISCARDED`.
    - `encodeProgress`: already writes only while `ENCODING` — no change.
    - `encodeCompleted`: unchanged; a completion on `STOPPED` is honoured. Pin it with a test.

## Contract obligations

Exposes exactly the delta in `../spec.md`: one new mutation `encodeJobStop(processJobId: Int!):
Download!`; `DownloadJob.status` and `Download.status` carry `PAUSED` for stopped work; every error
in the table, through `extensions.i18n.key`. `schema.gql`'s diff is `encodeJobStop` and nothing else.

## Tests

- `src/pipeline-status/pipeline-status.spec.ts` — extend. The silent ones: stopped title reading
  `MISSING` (sweep re-acquires); stopped source still a race winner (REQ-15 absent, nothing errors);
  stopped pack counted as delivered (REQ-17's sweep skips it); `removeTorrent` true while a job is
  stopped. Cases: `deriveSourceStatus` `STOPPED` → `PAUSED`, active + `STOPPED` → `ENCODING`,
  `ERROR` + `STOPPED` → `ERROR`; `countedProgress` counts `STOPPED` as 0; `deriveTitleStatus` →
  `PAUSED`; `isRaceWinner` false for `SCANNED` + `STOPPED`, true for `SCANNED` + `STOPPED` + active;
  `isDeliveredSource` false for `COMPLETED` + `STOPPED`; `cleanupDecision`; `projectJobStatus`.
- `src/downloads/downloads.service.spec.ts` — extend. Stop withdraws before it cancels and never
  calls the torrent client; Stop with Redis throwing still writes `STOPPED`; Play on stopped
  re-enqueues with no torrent call; Play while a sibling is the race winner refuses
  `retry_superseded` and writes nothing (the two-encodes-for-one-title bug); Play whose stale entry
  is still active rolls back to `STOPPED` and raises `retry_enqueue_failed`; `encodeJobStop` on a
  `COMPLETED` job raises `not_running`; discard accepts a `STOPPED` job; the torrent path is unchanged
  when nothing encodes.
- `src/process-jobs/process-jobs.service.spec.ts` — extend. `encodeStarted` on `STOPPED` throws
  `error.encode.stopped` and leaves the row; `encodeFailed` on `STOPPED` writes nothing;
  `encodeCompleted` on `STOPPED` lands `COMPLETED`.
- Migration, key catalog and resolver wiring are not owed tests (failure is loud: boot, typecheck,
  or the first call).

## Done when

```bash
bin/npm api run test
bin/cli api npx tsc --noEmit
bin/comments api
git status --short services/api/prisma
grep -rn "'WAITING', 'QUEUED', 'ENCODING'" services/api/src --include=*.ts | grep -v -e spec.ts -e pipeline-status.ts   # empty
```

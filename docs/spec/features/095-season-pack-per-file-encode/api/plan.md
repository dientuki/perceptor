---
title: Per-file breakdown of multi-file sources — api slice
service: api
last_updated: 2026-10-17
status: Implemented
---

# PLAN: Per-file breakdown of multi-file sources — `api` (`api/plan.md`)

## Scope

`api` owns:
- the `DISCARDED` enum value and its migration;
- the `DownloadJob` type and `Download.jobs`;
- the new derivation rules (REQ-7/8/9, NFR-1);
- `encodeJobStart` (retry one `ERROR` job) and `encodeJobDiscard`;
- the guards on the worker's report mutations for a `DISCARDED` job;
- the cleanup rule shared by `encodeCompleted` and discard, and running that cleanup when a discard
  finishes the source;
- stopping the torrent on completion;
- three new error keys.

It does **not** touch the worker's handling of the `encodeStarted` refusal (`worker/plan.md`) or any
UI (`web/plan.md`). It does **not** build any pause/resume: no `STOPPED`, no `encodeJobStop`. That is
`097`.

Writes are confined to `services/api/`.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` | Modified | `DISCARDED` added to `EncodeStatus` |
| `prisma/migrations/<ts>_encode_status_discarded/` | New | generated |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | `PROCESS_JOB_NOT_RESUMABLE`, `PROCESS_JOB_NOT_DISCARDABLE`, `ENCODE_DISCARDED` + English copy; header's exception list mentions `error.encode.discarded` as `api`-owned |
| `src/pipeline-status/pipeline-status.ts` | Modified | `deriveSourceStatus` rule order and `DISCARDED`; `isRaceWinner`; extracted `jobLastError`; new pure `cleanupDecision`; `DownloadJob` status projection |
| `src/downloads/entities/download-job.entity.ts` | New | `@ObjectType() DownloadJob` |
| `src/downloads/entities/download.entity.ts` | Modified | `jobs: DownloadJob[]` |
| `src/downloads/downloads.service.ts` | Modified | `jobsBySourceId` selects the label fields; `toDownload` builds `jobs`; `encodeJobStart`, `encodeJobDiscard`; discard cleanup; torrent stop in `handleTorrentCompleted` |
| `src/downloads/downloads.resolver.ts` | Modified | the two mutations |
| `src/process-jobs/process-jobs.service.ts` | Modified | `encodeStarted`/`encodeProgress`/`encodeFailed` guards; `encodeCompleted` reads `cleanupDecision` |
| `src/schema.gql` | Regenerated | must match `../spec.md`'s delta exactly |

## Existing code to reuse

- `DownloadsService.jobsBySourceId`: already the one query that loads a source's jobs for every
  listing and every mutation return. Widen its `select` with
  `sourceFile.episode { episodeNumber, title, season { seasonNumber } }` and `sourceFile.movie { title }`
  (or the denormalized `ProcessJob.episodeId`/`movieId` relations). Add no second query.
- `DownloadsService.toDownload`: the single place a `Download` is built. `jobs` is built here and
  nowhere else.
- `pipeline-status.ts`'s `deriveResume` internals (`stageOf`, the null-key fallback to
  `error.encode.unexpected`, the `MESSAGES_EN` fallback). Extract the per-candidate half into
  `jobLastError(job)` and call it from both `deriveResume` and the `DownloadJob` projection, so the
  two error lines can never disagree.
- `DownloadsService.resumeEncodeStage`: retry one job by passing a one-element list. Its rollback and
  `retry_enqueue_failed` already satisfy NFR-6.
- `DownloadsService.findOwnedSource`, `siblingsOf`, `hasRaceWinner`, the `retiredAt` check in
  `downloadStart`: the ownership/retired/race-loser gates. Both new mutations run the same three
  checks in the same order as `downloadStart`.
- `EncodeQueueService.publishCancel` / `removeEncode`: cancel and withdraw, in the order
  `unwindSource` uses.
- `MediaRootsService.isInsideRoot('downloads', path)`: the guard before deleting the input file, as
  `deleteResidue` uses it.
- `DownloadsService.deleteResidue`: deletes the download folder when a discard finishes the source.
  It is already kind-aware (`LOCAL_FILE` vs folder).
- The torrent removal half of `ProcessJobsService.downloadRemove`: `qbittorrent.remove(hash, false)`
  then `this.unwindLosingSiblings(source)`. Both calls are already reachable from `DownloadsService`.
  Do not inject `ProcessJobsService` into `DownloadsService`, because the dependency already runs the
  other way.
- `DownloadsService.recomputeStatus` / `TitleStatusService`: `089`'s single writer. Call it after
  every per-job write, exactly as `downloadDelete` does.
- `DownloadsService.callTorrentClient`: wraps qBittorrent calls in the existing error mapping.

## Steps

1. **Schema.** Add `DISCARDED` to `EncodeStatus`, then
   `bin/npm api run prisma:migrate --name encode_status_discarded`.
2. **Keys.** Add `PROCESS_JOB_NOT_RESUMABLE: 'error.processJob.not_resumable'`,
   `PROCESS_JOB_NOT_DISCARDABLE: 'error.processJob.not_discardable'` and
   `ENCODE_DISCARDED: 'error.encode.discarded'` to `ERROR_KEYS`, with English lines in `MESSAGES_EN`:
   - `This file cannot be retried`
   - `This file can no longer be discarded`
   - `Encode was discarded by the user`
3. **`pipeline-status.ts`.**
   - `deriveSourceStatus`: let `counted = jobs.filter(j => j.status !== 'DISCARDED')`. New order:
     1. source `ERROR` → `ERROR` (unchanged);
     2. `jobs.length > 0 && counted.length === 0` → `DISCARDED`, both progresses `null`;
     3. any counted job in `ACTIVE_ENCODE_STATUSES` → `ENCODING` (moved above the job-`ERROR` rule:
        REQ-8);
     4. any counted job `ERROR` → `ERROR`;
     5. every counted job `COMPLETED` → `COMPLETED`;
     6. the existing no-jobs rules.

     `encodeProgress` for rules 3–5 becomes REQ-7's formula over `counted` (`COMPLETED` = 100,
     `ERROR` = 0, others their stored progress), replacing `meanProgress(jobs)`. The return type
     widens to `PipelineStatus | 'DISCARDED'` **at this function only**. `RANK`/`maxStatus`/
     `deriveTitleStatus` stay untouched (`../plan.md` § Contract Freeze).
   - `isRaceWinner`: a `SCANNED` source whose jobs are all `DISCARDED` is not a winner (NFR-1).
   - `isDeliveredSource`: unchanged. An all-discarded source has no `COMPLETED` job, and a
     `COMPLETED` + `DISCARDED` one is correctly delivered. Pin both with tests.
   - Extract `jobLastError(job)` from `deriveResume`. Add `jobRetryable(job, source, siblings)`: true
     iff the job is `ERROR`, its stage is not `REPLACED`, the source is not retired, and
     `!hasRaceWinner(siblings)`.
   - Add `projectJobStatus(status)`: `WAITING`/`QUEUED` → `QUEUED`; the rest map to themselves.
   - Add `cleanupDecision(jobs, hasUnmatchedFiles)`, returning `{ removeTorrent, deleteDownloadPath }`:
     - `removeTorrent` = no job in `ACTIVE_ENCODE_STATUSES`;
     - `deleteDownloadPath` = every job `COMPLETED` or `DISCARDED` and `hasUnmatchedFiles === false`.

     `deleteInputFile` stays computed in `encodeCompleted` (`siblings.length > 1`), because it is about
     the completing job's own input, not the source. `097` adds `STOPPED` to the in-flight side of
     this one function.
4. **`encodeCompleted`** reads `cleanupDecision` instead of its inline sets. The return shape is
   unchanged, so the worker sees no difference.
5. **`DownloadJob` and `Download.jobs`.** Create `download-job.entity.ts` with exactly the spec's
   fields. In `jobsBySourceId`, select the label fields and order the jobs by
   `(seasonNumber, episodeNumber)` for episode jobs, falling back to `id`. In `toDownload`, map each
   job to `{ processJobId, label, episodeId, seasonNumber, episodeNumber, status:
   projectJobStatus(..), progress, encodeSpeed: status === 'ENCODING' ? encodeSpeed : null,
   lastError: jobLastError(..), retryable: jobRetryable(..) }`. Labels:
   - an episode job: `S${pad2(season)}E${pad2(episode)} · ${title}`, where `title` is the empty
     string when the episode row has none;
   - a film job: the film title.
6. **Report guards** (REQ-13/14):
   - `encodeStarted`: `updateMany where { id, status: { not: 'DISCARDED' } }` → `ENCODING`. If 0 rows
     match and the row exists as `DISCARDED`, throw `i18nError.conflict(ERROR_KEYS.ENCODE_DISCARDED)`.
   - `encodeProgress`: `updateMany where { id, status: 'ENCODING' }`. Drop anything else silently.
   - `encodeFailed`: on a `DISCARDED` row, return without writing or recomputing.
   - `encodeCompleted`: unchanged. It lands `COMPLETED` on a `DISCARDED` row (REQ-14). Pin it with a
     test.
   - Do **not** touch `reconcileOrphanedEncodes` (`054`). It selects `ENCODING` only (NFR-3).
7. **`encodeJobStart(processJobId, userId)`** (REQ-11):
   - Load the job with its `sourceFile.mediaSourceId`. If it is missing, or `findOwnedSource` fails,
     throw `PROCESS_JOB_NOT_FOUND`. Map `findOwnedSource`'s `SOURCE_NOT_FOUND` to it; never leak the
     source key.
   - Retired → `DOWNLOAD_RETRY_REPLACED`. `hasRaceWinner(siblings)` → `DOWNLOAD_RETRY_SUPERSEDED`.
   - Not `ERROR`, or `!jobRetryable` → `PROCESS_JOB_NOT_RESUMABLE`.
   - `resumeEncodeStage([job])`, then `recomputeStatus(source)`, then return `toDownload(...)` for the
     parent.
   - **Enqueue verification**: `addEncode` with a `job-<id>` that still exists in BullMQ returns the
     existing job and enqueues nothing. After `addEncode`, check that the entry is actually waiting.
     If it is not, treat it as an enqueue failure, so `resumeEncodeStage`'s existing rollback runs
     and `retry_enqueue_failed` is raised. Fix it inside `resumeEncodeStage`/`EncodeQueueService`, not
     only for this caller: `065`'s Play shares the hole.
8. **`encodeJobDiscard(processJobId, userId)`** (REQ-12/16/18, NFR-5):
   - Run the same three gates as step 7. `COMPLETED` or `DISCARDED` → `PROCESS_JOB_NOT_DISCARDABLE`.
   - `updateMany where { id, status: { in: ['WAITING','QUEUED','ENCODING','ERROR'] } }` →
     `DISCARDED`, `encodeSpeed: null`. If 0 rows match, re-read the row and raise
     `not_discardable` (a concurrent completion won).
   - `publishCancel(id)` then `removeEncode(id)`. On a Redis error, log and continue: the
     `encodeStarted` guard is the backstop.
   - Delete the job's `SourceFile.filePath`: guarded by `isInsideRoot('downloads', ..)`,
     `rm(path, { force: true })`, log on failure, never throw.
   - Load all of the source's jobs and its `hasUnmatchedFiles`, then call `cleanupDecision`.
     - If `removeTorrent` and the source has an `infoHash`: `callTorrentClient(() =>
       qbittorrent.remove(hash, false))` then `unwindLosingSiblings(source)`. Log on failure.
     - If `deleteDownloadPath`: `deleteResidue(source)`.

     Both run only when the discard is what made the source fully terminal. An earlier
     `encodeCompleted` already ran them for any other case, so running them twice is avoided by the
     condition itself.
   - `recomputeStatus(source)`, which recomputes the season for a pack. Return the parent `Download`.
9. **Torrent stop on completion** (REQ-1/3). In `handleTorrentCompleted`, after `addSourceReady`
   succeeds, `try { await this.qbittorrent.stop(infoHash) } catch { log }`. Do it after
   `addSourceReady`, never before writing `READY` (`../plan.md` § Risks).
10. **Resolver.** Add the `encodeJobStart`/`encodeJobDiscard` `@Mutation(() => Download)` with
    `processJobId: Int` and `@CurrentUser()`, the same shape as `downloadStart`.
11. **`schema.gql`.** Regenerate it, then diff it against `../spec.md`: `DownloadJob`,
    `Download.jobs`, and the two mutations. Nothing else may change.

## Contract obligations

Expose exactly `../spec.md` § GraphQL Contract Delta:
- `DownloadJob` with its ten fields and their nullability;
- `Download.jobs: [DownloadJob!]!`, never null, `[]` before the scan;
- `Download.status` may now be `"DISCARDED"`;
- `encodeJobStart`/`encodeJobDiscard(processJobId: Int!): Download!`.

Every error in the spec's table is raised as `extensions.i18n.key` through `i18nError`, with the key
spelled as listed. `error.encode.discarded` only ever comes from `encodeStarted`.

## Tests

- `src/pipeline-status/pipeline-status.spec.ts`: extend. It defends against the silent ones:
  - the parent reading `ERROR` while encodes still run;
  - an all-discarded source winning its race and turning siblings into losers;
  - cleanup never running or never deleting after a discard.

  Cases:
  - active + `ERROR` → `ENCODING`; `ERROR` + `COMPLETED` (none active) → `ERROR`;
  - all `DISCARDED` → `DISCARDED`; `COMPLETED` + `DISCARDED` → `COMPLETED`;
  - progress excludes `DISCARDED` and counts `ERROR` as 0;
  - `isRaceWinner` false for all-discarded; `isDeliveredSource` true for `COMPLETED` + `DISCARDED`;
  - `cleanupDecision` for `COMPLETED` + `DISCARDED` (both true) and for `ACTIVE` + `DISCARDED` (both
    false);
  - `projectJobStatus(WAITING)` → `QUEUED`.
- `src/downloads/downloads.service.spec.ts`: extend.
  - `encodeJobStart` retries only the named job and leaves sibling `ERROR` jobs `ERROR`.
  - A retry whose enqueue does not land rolls back to `ERROR` with the original error fields.
  - `encodeJobDiscard`:
    - cancels, withdraws and deletes the input file;
    - refuses a path outside the downloads root without deleting it;
    - refuses `COMPLETED`;
    - on the last pending job, removes the torrent (`deleteFiles: false`) and calls
      `deleteResidue`;
    - on a non-last job, does neither.
  - Each of the three ownership/retired/race-loser gates returns its key.
  - `handleTorrentCompleted` calls `stop` after enqueueing, and still enqueues when `stop` throws.
  - `Download.jobs` is ordered by season/episode and labelled `S01E02 · <title>`.
- `src/process-jobs/process-jobs.service.spec.ts`: extend.
  - `encodeStarted` on `DISCARDED` throws `error.encode.discarded` and leaves the row.
  - `encodeFailed`/`encodeProgress` on `DISCARDED` write nothing.
  - `encodeCompleted` on `DISCARDED` lands `COMPLETED`.
  - `encodeCompleted` returns `deleteDownloadPath: true` when the siblings are `COMPLETED` +
    `DISCARDED`.
- The migration, the entity and the key catalog are not owed tests: failure is loud (boot, schema
  generation or typecheck).

## Done when

```bash
bin/npm api run test
bin/cli api npx tsc --noEmit
bin/comments api
git status --short services/api/prisma
git diff services/api/src/schema.gql
```

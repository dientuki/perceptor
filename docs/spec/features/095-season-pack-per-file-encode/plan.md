---
title: Per-file breakdown of multi-file sources — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-10-17
status: Implemented
---

# PLAN: Per-file breakdown of multi-file sources (`plan.md`)

## Approach

Almost everything this feature shows already exists in `api`, unshown. `DownloadsService.jobsBySourceId`
(`services/api/src/downloads/downloads.service.ts`) already loads every `ProcessJob` of every listed
source, with status, progress, speed and error fields. Today `toDownload` folds them into one mean.
`Download.jobs` is that same list, projected per job instead of folded, plus a label that needs one
extra relation in the same query (the episode's number, title and season number). No new query, no
second round trip.

Per-job retry is `065`'s `DownloadsService.resumeEncodeStage` called with one job instead of all of a
source's `ERROR` jobs. It already does the guarded `updateMany`, `removeEncode` + `addEncode`, rollback,
and `error.download.retry_enqueue_failed`. Per-job `lastError`/`retryable` reuse the per-candidate
logic inside `pipeline-status.ts`'s `deriveResume` (`stageOf`, the key/params/message fallback), which
is extracted into a helper rather than copied.

Discard composes three things that already exist:
- `047`'s cancel and withdrawal (`EncodeQueueService.publishCancel`/`removeEncode`, as `unwindSource`
  uses them);
- the downloads-root guard (`MediaRootsService.isInsideRoot`, as `deleteResidue` uses it) around one
  `rm` of the job's `SourceFile.filePath`;
- the cleanup decision `encodeCompleted` already computes (`removeTorrent`/`deleteDownloadPath`).

That decision moves into a pure function in `pipeline-status.ts`, so `encodeCompleted` and discard
read one rule. Today it is inline in `process-jobs.service.ts`. When a discard is the transition that
finishes the source (REQ-18), `api` executes the cleanup itself:
- it removes the torrent the way `ProcessJobsService.downloadRemove` does (`qbittorrent.remove(hash,
  false)` + `unwindLosingSiblings`);
- it deletes the download folder the way `deleteResidue` does.

The worker does neither for a discard, because no worker job is running for it. Both building blocks
already live in `DownloadsService`, so no new dependency direction is introduced. `ProcessJobsService`
already depends on `DownloadsService`, not the other way round.

Status derivation changes in one place, `deriveSourceStatus`. `DISCARDED` jobs are filtered out
first. Then "something still active" is checked before "something failed" (REQ-8), and an all-discarded
source returns the new `DISCARDED` value. Title derivation needs **no** change. `deriveTitleStatus`
already ignores any job that is not `WAITING`/`QUEUED`/`ENCODING`, so a discarded episode with no
other source reads `MISSING` on its own (REQ-15). `isRaceWinner` does need one change: today a
`SCANNED` source whose jobs are all `DISCARDED` reads as a winner (no failure, no activity), which
would make every sibling a race loser (NFR-1).

Stopping the torrent on completion (REQ-1) is one `qbittorrent.stop` in `handleTorrentCompleted`,
after the scan is enqueued, inside a `try` that only logs. A stopped, completed torrent keeps
`completion_on !== -1`, so `mapTorrentState` still reads `READY` (`clients/torrent/client.ts`). The
write-back in `writeBackLiveStates` never touches a `READY`/`SCANNED` source anyway
(`writeStatusIfNonTerminal`), so NFR-2 holds without code. It is still pinned by a test.

The worker change is one branch: `encode.job.ts`'s `EncodeCancelledError` arm also accepts a
`KeyedError` carrying `error.encode.discarded`. `097` later widens the same arm for
`error.encode.stopped`.

Alternative considered for the cleanup a discard triggers: have the worker run it by enqueueing a
synthetic cleanup job. Rejected. It needs a new queue payload and a new worker handler, and the two
operations it would run are already `api` code (`deleteResidue`, the `downloadRemove` path).

Alternative considered for `Download.jobs`: a separate `downloadJobs(mediaSourceId)` query fetched
when the chevron opens. Rejected. Every listing already loads the jobs, so a second query would cost
a round trip and a loading state to save nothing.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration, `DownloadJob`, both mutations, the `encodeStarted` refusal and the new error keys; both consumers read through it |
| 2a | `worker` | Only observable once `encodeStarted` can refuse a `DISCARDED` job |
| 2b | `web` | Cannot render `Download.jobs` or call the mutations before the schema has them |

`worker` and `web` are independent of each other and run in parallel once `api` lands. This feature
precedes `097-encode-stop`, whose plans are stale and must be regenerated after this one ships
(`/plan-feature 097`).

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will be tempted to change and must not:

- **`DownloadJob.status` is a `String`, not an enum, and never carries `WAITING`.** `api` folds
  `WAITING` into `QUEUED` (REQ-6). `web` will want the raw `EncodeStatus`. It must not get it: `097`
  adds `STOPPED`, exposed as `PAUSED`, and a raw enum would leak a storage name onto the screen.
- **No `encodeJobStop` here, and no paused case in `encodeJobStart`.** Both belong to `097`. An `api`
  implementer who already knows `097` is coming must not pre-build them.
- **No `canRetry`/`canDiscard` booleans on `DownloadJob`.** `web` decides from `status`,
  `retryable`, `Download.owned`, `retiredAt` and `lostRace`, all already on the wire. The one rule
  `api` owns, whether a failed job can be retried, is `retryable`.
- **`Download.status` gains exactly one value, `DISCARDED`.** It is a source-altitude value only.
  `Movie.status`/`Episode.status`/`Show.status` never carry it, so it must not be added to
  `PipelineStatus`'s title ranking (`maxStatus`/`RANK`).
- **`error.encode.discarded` is never shown to a user.** It is api → worker only, with no entry in
  `web/messages/*.json`.
- **Both mutations return the parent `Download`, not the `DownloadJob`.** The row re-renders as a
  whole, because the parent's progress, `N de M` and status move with every child action.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief `api`, `web`
and `worker` (Constitution, Article VIII).

## Migrations

1. `encode_status_discarded`: adds `DISCARDED` to the `EncodeStatus` enum of `ProcessJob.status`.
   Generated through `bin/npm api run prisma:migrate`.
2. Backfill: none (spec NFR-7). No existing row is or becomes `DISCARDED`.

Reversibility: dropping the enum value while a row holds it fails the migration on MariaDB. A
rollback must first `update ProcessJob set status = 'ERROR' where status = 'DISCARDED'` (inspect
with `bin/mysql`). This is noted, not automated, as with `097`.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `isRaceWinner` reads an all-discarded source as a winner | Every other source of that episode/season becomes a race loser: no Play, swept by `091`. No error anywhere | `pipeline-status.spec.ts` case; AC-7 |
| Discard is the last terminal transition, and nothing runs cleanup | Torrent and folder stay forever; the disk fills with no error | shared cleanup rule + `api`-side execution; `downloads.service.spec.ts` case; AC-6 |
| `deleteDownloadPath` still requires every job `COMPLETED` | A pack with one discard never deletes its folder; silent disk leak | the extracted rule counts `DISCARDED`; `pipeline-status.spec.ts` case |
| `removeTorrent` counts `DISCARDED` as in flight | The torrent is never removed after a discard | same extracted rule; case where the remaining jobs are `COMPLETED` + `DISCARDED` |
| `encodeStarted` unconditional update | The worker dequeues a discarded job, flips it to `ENCODING`, and FFmpeg fails on a missing input; the job ends `ERROR` and the user sees a failure for a file they discarded | guarded `updateMany` + refusal; worker branch; AC-11 |
| `encodeFailed` on a discarded job | A late failure report overwrites `DISCARDED` with `ERROR`; the parent flips to `ERROR` | ignore on `DISCARDED`; `process-jobs.service.spec.ts` case |
| Torrent stopped before `READY` is written | A concurrent live read between stop and write could write `READY` first, and `handleTorrentCompleted`'s "already processed" check would then skip the scan | stop **after** `addSourceReady`; noted in `api/plan.md` |
| `deriveSourceStatus` checks failure before activity | A pack with one failed episode reads `ERROR` while seven still encode: today's behaviour, the thing REQ-8 removes | rule order pinned by `pipeline-status.spec.ts` |
| Retry of one job retries all | `resumeEncodeStage` called with the source's full list instead of the one job | per-job mutation passes a one-element list; `downloads.service.spec.ts` asserts the siblings stay `ERROR` |
| Retry's enqueue silently lands nothing | `addEncode` with a `job-<id>` that still exists in BullMQ is a no-op; the row sits `QUEUED` forever | the same hole `097`'s plan names; this plan checks the entry is actually waiting after `addEncode` and otherwise rolls back (`api/plan.md` step 7) |
| Discard deletes outside the downloads root | A `SourceFile.filePath` pointing elsewhere would delete a library file (Article XII) | `MediaRootsService.isInsideRoot` before `rm`; test with a path outside the root |

## Verification

```bash
bin/npm api run prisma:migrate
bin/npm api run test
bin/cli api npx tsc --noEmit
bin/npm worker test
bin/cli worker npx tsc --noEmit
bin/cli web npx tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments api
bin/comments web
bin/comments worker
git status --short services/api/prisma        # schema.prisma + one new migration
git diff services/api/src/schema.gql          # exactly the spec's delta, nothing else
```

Manual pass (needs a real season pack with compression on, so encodes take minutes):

1. AC-1: add a pack. When it completes, qBittorrent shows it stopped. The row reads `ENCODING`. After
   the last episode, the torrent is gone.
2. AC-2: no chevron while downloading. After the scan there is one, collapsed. Expanding shows
   ordered children with TMDB titles, and the same appears on the series detail page.
3. AC-3: read `N de M` and the percentage mid-pack against `bin/mysql -e "select status, progress from
   ProcessJob where sourceFileId in (select id from SourceFile where mediaSourceId = <id>)"`.
4. AC-4: discard a queued episode. `bin/cli worker ls` on the download folder shows its file gone,
   the child is struck through, `N de 7` appears, and the series page shows it missing.
5. AC-5: discard the encoding episode. `bin/cli worker ps` shows no `ffmpeg` within seconds, the
   next episode starts, and
   `bin/cli worker find /downloads /destinations -name '*.part.mkv'` returns nothing.
6. AC-6: discard the last pending episode of a pack. The torrent and the folder are gone at once.
7. AC-7: single-episode source: discard it. The row reads `DISCARDED` with only Delete. Attach
   another torrent to that episode: no replacement warning.
8. AC-8: force an episode failure (a file with no video stream). The other episodes keep encoding,
   the parent reads `ERROR` at the end, and Retry on that child runs only it.
9. AC-9: `encodeJobDiscard` on a `COMPLETED` job from the GraphQL playground returns
   `not_discardable`, and the library file is untouched.
10. AC-10: `docker compose stop redis`, then Retry shows `retry_enqueue_failed`, and the job is still
    `ERROR` with its original line. `docker compose start redis`, then Retry works.
11. AC-11: set a `QUEUED` job to `DISCARDED` by hand with `bin/mysql` while it is next in the queue.
    The worker log shows `discarded, reporting nothing` and no `ffmpeg` starts.
12. AC-12: a film, a single episode and an upload show no chevron.
13. AC-13: as a second user who does not own the title, children are visible without buttons, and a
    direct `encodeJobDiscard` returns `error.processJob.not_found`.

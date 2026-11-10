---
title: Season scan write conflict
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-11-07
last_updated: 2026-11-07
status: Approved            # Draft | Approved | Implemented | Superseded
services: [api]
---

# SPEC: Season scan write conflict (`spec.md`)

## Context & Goal

Uploading a whole season (`068-season-multi-file-upload`) stopped working in production. Every season
upload session since 2026-10-06 ends with the scan failing and the source in `ERROR`, and the user
sees `Scan: The download could not be read: GraphQL error: Invalid prisma.sourceFile.upsert()
invocation: Database error. Code: 1020. Message: Record has changed since last read in table
'source_files'; try restarting transaction`. The files stay in the session folder, no `ProcessJob`
is ever created, and pressing Play on the row fails the same way every time. The production
`ptor` stack shows sources 418 (three attempts), 420 and 422 failing like this. Sources 261, 266,
267 and 268, all season uploads from 2026-10-01, scanned fine.

The database did not change: `docker-compose.yaml` has pinned `mariadb:12.3.2` since July, and that
version runs `innodb_snapshot_isolation=ON` under `REPEATABLE-READ`, which rejects a transaction that
reads or locks a row changed by someone else after the transaction's snapshot was taken. What
changed is `089-status-materialization` (commit `9825d71`, 2026-10-06). It added a
`TitleStatusService.recomputeSeason` notification to `SeasonsService.finishSeasonUpload`
(`services/api/src/seasons/seasons.service.ts`) **after** `addSourceReady` enqueues the scan, and
`DownloadsService.downloadStart` (`services/api/src/downloads/downloads.service.ts`) already
recomputes **after** `resumeScanStage` enqueues the rescan. For an uploaded season the worker scans in
milliseconds, because it makes no torrent-client call for a source with no `infoHash`. So
`MediaSourcesService.sourceScanned` (`services/api/src/media-sources/media-sources.service.ts`) opens
its transaction, reads the season's episodes and starts inserting `source_files` rows while
`recomputeSeason` is still rewriting every episode of the season one by one. The foreign-key check on
`source_files.episodeId` finds an episode row newer than the snapshot, and MariaDB aborts with 1020.
Torrent season packs escape only by timing (`torrentCompleted` reaches the scan after a torrent-client
round trip), and the two other upload paths (film, single episode) already recompute **before**
enqueueing. They were written in that order under `089` REQ-13.

This feature restores the pipeline stage **Detect completion, enqueue** for season uploads and Play on
a failed scan, without undoing anything `089` requires. The recompute stays (REQ-1/REQ-13 of `089`:
every season-scoped transition still notifies `TitleStatusService` by identity, and the season-pack
lift still appears). It just finishes before the scan is enqueued. Because any other concurrent writer
to the same episodes (another source of the same season, `ShowStatusSweepService`'s hourly sweep, a
Refresh) can still collide with the scan's transaction, `sourceScanned` must also survive a write
conflict by retrying its transaction a bounded number of times. The fix is test-first: the failing
tests are written and observed failing before any production code changes.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Recompute finishes before the scan is enqueued)**: On every path that hands a source to
      the scan (`bull:process`), the status recompute that the same action triggers under `089` must
      have completed before the scan job is enqueued. Today `torrentCompleted` and the two non-season
      upload paths already behave this way. Closing a season upload session and resuming a source
      whose failed stage was the scan (Play on an `ERROR` row) must behave the same way.

- [ ] **REQ-2 (The recompute still happens)**: Neither path in REQ-1 may drop its recompute or narrow
      its scope. Closing a season upload session must still recompute every episode of the season and
      the series (`089` REQ-13), and Play must still recompute the source's target (`089` REQ-1). The
      statuses a user reads after either action must be the same as today's successful runs.

- [ ] **REQ-3 (A write conflict is retried, not reported)**: When `sourceScanned`'s transaction is
      rejected because a row it read or locked changed under it (MariaDB error 1020,
      `ER_CHECKREAD`), `api` must run the whole transaction again from its first read. The total
      number of attempts is capped at **3**, the first one included. Only this conflict class is
      retried. Any other error (unknown source, a match not among the reported files, a source with
      no target) fails on the first attempt, as today.

- [ ] **REQ-4 (A retry leaves exactly one outcome)**: Whatever number of attempts a scan took, the
      committed result must be the one a single clean attempt would have produced: one `source_files`
      row per resolved file, one `ProcessJob` per resolved file, each `ProcessJob` enqueued on the
      encode queue exactly once, each affected episode recomputed once, and the source `SCANNED`. Work
      prepared by a rolled-back attempt must never be enqueued or recomputed.

- [ ] **REQ-5 (Exhaustion fails the way it does today)**: If every attempt is rejected by a write
      conflict, `sourceScanned` must raise the last error unchanged. The worker then reports it
      through `sourceScanFailed` with `error.source.scan_failed`, exactly as it does today. No new
      error key is introduced.

- [ ] **REQ-6 (Test-first)**: Before any production code changes, the implementation must add unit
      tests in `api` (Jest, mocked Prisma and queues, following `services/api/CLAUDE.md` § Tests) that
      **fail against the current code** and pass after the fix:
      (a) closing a season upload session completes `recomputeSeason` before enqueueing the scan;
      (b) Play on a source whose failed stage is the scan completes the target's recompute before
      enqueueing the rescan;
      (c) a `sourceScanned` whose first transaction attempt throws the 1020 conflict commits on the
      second attempt, and its `ProcessJob`s are enqueued once each;
      (d) a `sourceScanned` that hits the conflict on every attempt makes exactly 3 attempts and
      rethrows;
      (e) a `sourceScanned` that fails with a non-conflict error makes exactly 1 attempt.
      The task that adds them must record the failing run's output, as evidence they failed before
      the fix.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No conflict with `089`)**: No call site may write a status literal to
      `Movie`/`Episode`/`Show` (`089` REQ-1). The recompute stays a notification by identity through
      `TitleStatusService`. `089`'s guarded `updateMany` writes (NFR-2) are not touched.

- [ ] **NFR-2 (No isolation or server change)**: The fix must not lower the transaction isolation
      level, must not turn `innodb_snapshot_isolation` off, and must not change `docker-compose.yaml`
      or the MariaDB image. It must work on the database as deployed.

- [ ] **NFR-3 (Retry is quiet but visible)**: Each retried attempt logs one line naming the
      `mediaSourceId` and the attempt number. An attempt that succeeds after a retry adds nothing to
      the user-facing state: no `errorKey`, no `ERROR` row.

- [ ] **NFR-4 (Stuck sources recover with no data fix)**: A season source already left in `ERROR` by
      this bug (production source 422) must scan and enqueue its episodes when the user presses Play
      after the fix ships, with no manual database change.

## GraphQL Contract Delta

None — this feature does not cross the service boundary. `sourceScanned`, `sourceScanFailed`,
`finishSeasonUpload` and `downloadStart` keep their signatures, return types and error keys. A
conflict that exhausts its retries surfaces through the existing worker path as
`error.source.scan_failed`, which `web` already renders.

## Data Model Changes

None.

## Acceptance Criteria

- [x] **AC-1**: The tests in REQ-6 (a)–(e), added before the fix, fail on the current code. The task
      report shows `bin/npm api test -- <their files>` failing on them.
- [ ] **AC-2**: After the fix, `bin/npm api test` is green, including the REQ-6 tests, and
      `bin/cli api npx --no tsc --noEmit` reports 0 errors.
- [ ] **AC-3**: Given a series with an aired season, when a user uploads two or more episode files
      through the season header's import button, then the source reaches `SCANNED`, one `ProcessJob`
      per file appears on `/downloads`, and the worker log shows `completed media-source-<id>` with no
      `1020`.
- [ ] **AC-4**: Given production source 422 in `ERROR` with `error.source.scan_failed`, when the user
      presses Play on its row after the fix is deployed, then it reaches `SCANNED` and its two episodes
      (S02E02, S02E03) are queued for encoding.
- [x] **AC-5 (failure path)**: Given a `sourceScanned` whose transaction keeps hitting the conflict
      (forced in a unit test), then `api` makes exactly 3 attempts, writes no `source_files` or
      `ProcessJob` row, enqueues nothing, and the error reaches the worker, which leaves the source in
      `ERROR` with `error.source.scan_failed`.
- [x] **AC-6 (failure path)**: Given a `sourceScanned` whose match is not among the reported files,
      then `api` refuses it on the first attempt with `error.source.match_not_reported`, unchanged,
      with no retry.
- [ ] **AC-7**: While a season upload's scan runs, the season's episodes still read `QUEUED` (the
      `059`/`089` REQ-13 lift) until the scan commits, and then follow their `ProcessJob`s, as before
      `089`.

## Out of Scope

- **Retrying other interactive transactions in `api`.** Every interactive transaction in `api` runs
  under the same `innodb_snapshot_isolation=ON`, and some may have the same exposure. Only
  `sourceScanned` is shown to fail in production. An audit of the rest is its own work.
- **Changing the database server or isolation level.** Turning `innodb_snapshot_isolation` off would
  hide the bug rather than fix it, and is excluded by NFR-2.
- **A database-backed integration test.** `api` has no test harness against a real MariaDB. The tests
  here are unit tests with mocks, chosen on 2026-11-07, and they do not reproduce the 1020 itself.
- **Recomputing the season in `torrentCompleted`.** A season torrent's completion does not notify a
  season recompute today, and the pack lift already holds while the source is `READY`. Changing that
  is not needed to fix this bug.
- **Worker-side retries of the scan job.** The `process` queue stays without `attempts`. The retry
  lives in `api`, where the transaction is.

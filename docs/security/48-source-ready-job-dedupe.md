---
title: Never let a finished scan job swallow a later scan of the same source
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/queue/source-ready-jobid-retained-after-completion-swallows-rescan
audit_verdict: needs_validation
priority: 48
---

# SPEC (draft): Never let a finished scan job swallow a later scan of the same source

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> `needs_validation`: every step is source-confirmed, but BullMQ's dedupe of a retained completed job
> was modelled from its Lua script (no Redis in the sandbox) and a torrent client re-completion was not
> observed. Line numbers refer to commit `2a3976a`.

## Context & Goal

`ProcessQueueService.addSourceReady` (`queue/process-queue.service.ts:12`) enqueues the scan with a
fixed `jobId: media-source-<id>` and no `removeOnComplete`/`removeOnFail`; the worker's `scanWorker`
sets only `connection` and `concurrency` (`worker/src/index.ts:117-131`). A finished or failed scan job
therefore stays in Redis, and BullMQ (6.7.6, `addStandardJob` Lua) ignores a later `add` with the same
id. The comparable library-probe queue sets both removal options
(`queue/library-probe-queue.service.ts:29-30`).

`resumeScanStage` removes the old entry before re-adding (`downloads/downloads.service.ts:835-838`), but
`handleTorrentCompleted` (`:1350`) does not: it sets the source `READY` and calls `addSourceReady`
directly (`:1416`). That path is reached again for the **same** `MediaSource` id when
`AttachSourceService` reactivates a retired or `ERROR` source of the same target (`090`, `060`):
it resets the row to `QUEUED` and either calls `handleTorrentCompleted` itself when the torrent is
still held and finished (`acquisition/attach-source.service.ts:118-149`), or re-adds the torrent, whose
completion hook later lands in the same method. `QUEUED` passes the `READY`/`SCANNED` guard (`:1361`),
`resolveRace` returns `WON`, the row becomes `READY`, the add is dropped, and no scan ever runs. The
source sits in `READY` with no error, and the title shows work in flight. `demoteDeliveredSources`
(`:376`) does not withdraw the old entry either.

Any owner of the title can trigger it by re-adding a release they replaced earlier. Impact is a stuck
source (availability/integrity of one title), recoverable by delete and re-add. The goal is that every
enqueue of a scan actually produces a waiting job, or fails visibly.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Remove before add)**: Every producer of the scan job withdraws any existing
      `media-source-<id>` entry before adding, as `resumeScanStage` does; implemented once inside
      `addSourceReady` so `handleTorrentCompleted`, the upload paths (`uploads.service.ts:236,282`) and
      the season close (`seasons.service.ts:194`) all get it.
- [ ] **REQ-2 (Retention)**: Finished and failed scan jobs are removed from Redis
      (`removeOnComplete`/`removeOnFail`), matching the library-probe queue. [NEEDS CLARIFICATION: is a
      retained failed scan job read anywhere (Bull Board, diagnostics), or can it go?]
- [ ] **REQ-3 (Active job)**: If the existing entry is active (BullMQ refuses to remove it), the add is
      not silently dropped. [NEEDS CLARIFICATION: wait, defer, or fail the source with a key? Can a
      reactivation even overlap a running scan of the same id, given `scanWorker` concurrency 1?]
- [ ] **REQ-4 (Detectable)**: A source left `READY` with no waiting or active scan job is logged.
      [NEEDS CLARIFICATION: is a boot or periodic check wanted, or is REQ-1 enough?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Idempotence kept)**: A genuinely duplicated completion for a source already `READY`/
      `SCANNED` still returns "already processed" without enqueueing (`:1361`).
- [ ] **NFR-2 (No new race)**: Removing a waiting entry and re-adding it never enqueues two scans of one
      source at once.

## GraphQL Contract Delta

None.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: Against a throwaway Redis, add `media-source-1` through
      `ProcessQueueService`, let a BullMQ worker complete it, call `addSourceReady` again and read
      `getJobCounts`: today no new waiting job appears. After the fix one waiting job exists.
- [ ] **AC-2**: With a fake Prisma, reactivating a retired `SCANNED` source whose torrent is held and
      finished ends with the source `READY` **and** a waiting scan job.
- [ ] **AC-3**: Play on a failed scan (`resumeScanStage`), a tus upload and a closed season upload still
      enqueue exactly one scan.
- [ ] **AC-4**: Owner check on a test title: deliver a release, replace it with another using `force`,
      re-add the original, and see the title reach `ENCODING`.

## Out of Scope

- **`sourceScanned` accepting a report for a superseded or retired source** — spec 45.
- **Live-read writeback promoting `READY`** — spec 28. **Verifying a reported completion** — spec 29.

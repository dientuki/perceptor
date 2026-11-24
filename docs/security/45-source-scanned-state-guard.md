---
title: Refuse sourceScanned for a source that is not waiting to be scanned
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/media-sources/sourceScanned-no-status-or-retired-guard-reopens-superseded-source
audit_verdict: needs_validation
priority: 45
---

# SPEC (draft): Refuse sourceScanned for a source that is not waiting to be scanned

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> `needs_validation`: the hunter's harness used an in-memory Prisma fake, and the end-to-end
> overwrite of a delivered file needs a real two-source race plus a duplicate/late worker report (or
> a user call through spec 01). Line numbers refer to commit `2a3976a`.
> Reachable by a user session through spec 01 (`sourceScanned` lacks a service assertion); this spec
> is the state guard that holds even for the worker. Spec 03 confines the paths the same call carries.

## Context & Goal

`sourceScanFailed` ignores any source that is not `READY` (`media-sources/media-sources.service.ts:82`).
`sourceScanned` (`media-sources.resolver.ts:28-38`, `@AllowService` and no principal assertion) has
no such guard. `scanTransaction` (`media-sources.service.ts:100`) loads the source (`:110`), only
logs when it is already `SCANNED` (`:124-126`, spec 013 NFR-7 re-scan), and never reads `retiredAt`.
For every reported match it upserts a `SourceFile` and creates a `WAITING` `ProcessJob` when none
exists for that file, or re-queues an existing `WAITING` one (`:203-242`; a job in any other status
is left alone). It then sets the source to `SCANNED` and clears `errorKey`/`errorMessage`/`errorParams`
(`:252-261`), and `sourceScanned` calls `addEncode` for every collected job and marks them `QUEUED`
(`:293-301`).

So a source the race arbiter wrote to `ERROR`/`error.source.superseded` (spec 087), a source that
failed, or one `force` retired (`retiredAt`, spec 090) can be reopened as `SCANNED` with its error
erased and, for files with no job yet, new encodes queued, bypassing `resolveRace`. Once such an
encode finishes, `encodeCompleted` only skips the title write when the source reads `ERROR`
(`process-jobs/process-jobs.service.ts:385`, `:393-398`); the reopened source now reads `SCANNED`, so
it may overwrite `Movie.filePath` of an already delivered title. The hunter's harness
(`agents/h-process-callbacks-paths/artifacts/evidence/callbacks-harness-output.txt`, not re-run)
reported ERROR superseded → `SCANNED` with one job queued, and a retired source keeping `retiredAt`
while an encode was queued. Impact is bounded: a stale source re-encoding a delivered title.

The goal is that only a source waiting for its scan can be scanned.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (State guard)**: `scanTransaction` refuses (no write, no enqueue) a source whose status
      is not `READY`, or whose `retiredAt` is set, or which has lost the race to a sibling (the derivation
      behind `Download.lostRace`, `downloads/downloads.service.ts:466`).
      [NEEDS CLARIFICATION: must a re-scan of a `SCANNED` source (spec 013 NFR-7) still be accepted?
      If yes, allow `SCANNED` only when not retired and still the race winner.]
- [ ] **REQ-2 (Refusal shape)**: A refused report returns without throwing, logging the reason, the
      way `sourceScanFailed` ignores a non-`READY` source, so a late or duplicate worker report never
      turns into a worker retry loop. [NEEDS CLARIFICATION: or a keyed error the worker abandons
      silently, like `error.encode.discarded`?]
- [ ] **REQ-3 (Completion check)**: `encodeCompleted`'s `sourceDemoted` test also treats a retired
      source as demoted, so a job from a retired source never writes the title's `filePath`.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Legitimate paths unchanged)**: Play on a failed scan (spec 065) and Play/resume paths
      that set the source back to `READY` before enqueueing the scan keep working; a closed season
      upload session (068) is unaffected.
- [ ] **NFR-2 (116 retry)**: The snapshot-conflict retry around `scanTransaction` is unchanged.

## GraphQL Contract Delta

No shape change. Behavioural change only: `sourceScanned` on a non-scannable source returns the
source unchanged (or the keyed error chosen in REQ-2). `web` never calls it.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: In the dev stack, create two sources for one film and let one
      deliver; call `sourceScanned` on the loser (`ERROR`, `error.source.superseded`) and on a retired
      source. Today the loser reads `SCANNED` with `errorKey` null, a new `ProcessJob` exists and an
      encode is queued; the retired source keeps `retiredAt` with an encode queued. After the fix
      both sources, their jobs and the queue are unchanged, and `Movie.filePath` and the library file
      are those of the winner.
- [ ] **AC-2**: `sourceScanned` on a `READY` source behaves exactly as today (regression).
- [ ] **AC-3**: `encodeCompleted` for a job whose source has `retiredAt` set leaves `Movie.filePath`
      unchanged (REQ-3).
- [ ] **AC-4**: Play on an `ERROR` source with a failed scan (065) re-scans and encodes normally.

## Out of Scope

- **Refusing user principals on worker callbacks** — spec 01.
- **Confining reported file paths** — spec 03.

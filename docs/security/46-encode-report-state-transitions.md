---
title: Make the encode report mutations compare-and-set on the expected job state
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/process-jobs/encode-report-mutations-lack-state-transition-guards
audit_verdict: needs_validation
priority: 46
---

# SPEC (draft): Make the encode report mutations compare-and-set on the expected job state

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> `needs_validation`: the regression was shown in a hunter harness and in source, but the triggers (a
> user principal per spec 01, or a duplicated/reordered worker report) were not observed live. Line
> numbers refer to commit `2a3976a`.
> Reachability by an ordinary user shares its root cause with spec 01; this spec is the state-machine
> half and still applies once only the worker can call these operations. Same pattern as spec 45
> (`sourceScanned`).

## Context & Goal

The worker reports an encode's life through `encodeStarted`, `encodeProgress`, `encodeCompleted` and
`encodeFailed` (`process-jobs/process-jobs.resolver.ts:31,40,53,66`), all `@AllowService()` with no
principal assertion. Only `encodeProgress` writes conditionally on the job's current state
(`process-jobs.service.ts:362`, `status: 'ENCODING'`). The other three do not:

- `encodeStarted` (`:325`) runs `updateMany` with `status: { notIn: ['DISCARDED', 'STOPPED'] }`
  (`:328`), so a `COMPLETED` or `ERROR` job goes back to `ENCODING` and the title is recomputed.
- `encodeFailed` (`:464`) returns early only for `DISCARDED`/`STOPPED` (`:481`) and otherwise writes
  `ERROR` over any state, including `COMPLETED` (`:489`).
- `encodeCompleted` (`:369`) updates by id with no status predicate (`:389`): an `ERROR` job becomes
  `COMPLETED`, `Movie/Episode.filePath` is rewritten (`:397,403`) and the media server is notified
  (`:411`) unless the stored `outputFilePath` matches (`:382`).

The hunter's in-memory harness reports `encodeStarted` and `encodeFailed` on a `COMPLETED` job leaving
it `ENCODING` and `ERROR`. A job wrongly left in `ENCODING` is also picked up by
`reconcileOrphanedEncodes` at the next worker boot (`:538`) and requeued. Impact is integrity and
availability of one title's job rows and status; no cross-user or file effect beyond what spec 01 and
spec 47 cover.

The goal is that each report moves a job only from the states that can legitimately precede it, and
that any other report is a no-op the worker can tell apart from success.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Started)**: `encodeStarted` moves a job to `ENCODING` only from its legitimate
      predecessors, in one conditional write. [NEEDS CLARIFICATION: the predecessor set — `WAITING`,
      `QUEUED`, and `ENCODING` itself for BullMQ's stall retry (`attempts: 2`)? Does any retry path
      today rely on `ERROR` → `ENCODING` without first resetting to `QUEUED`?]
- [ ] **REQ-2 (Failed)**: `encodeFailed` writes `ERROR` only over `ENCODING` (conditional write); on
      `COMPLETED` it leaves the row, the title and its file untouched and returns as it does today
      for `DISCARDED`/`STOPPED`.
- [ ] **REQ-3 (Completed)**: `encodeCompleted` writes `COMPLETED` only over `ENCODING`. A replay on a
      job already `COMPLETED` with the same `outputFilePath` keeps today's idempotent answer (`038`).
      [NEEDS CLARIFICATION: is a late `encodeCompleted` on an `ERROR` job ever legitimate (for example
      after a lost report that the api timed out on)? `095` keeps "a late `encodeCompleted` is still
      honoured" for `DISCARDED`; decide whether `ERROR` gets the same rule.]
- [ ] **REQ-4 (Visible refusal)**: A report refused by REQ-1..3 is logged with the job id, the current
      state and the report name, and never recomputes the title or notifies the media server.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Atomic)**: Each check and write is one `updateMany` with the predecessor in `where`,
      matching `encodeProgress`; no read-then-write window.
- [ ] **NFR-2 (Worker unchanged)**: The worker's `deliverReport` retry and its silent abandon on
      `error.encode.stopped`/`error.encode.discarded` keep working; the refusals of REQ-1 reuse those
      keys or a new one the worker treats the same way.

## GraphQL Contract Delta

No shape change. [NEEDS CLARIFICATION: whether a refused `encodeStarted` on `COMPLETED`/`ERROR`
raises a new keyed conflict (worker abandons silently) or reuses `error.encode.discarded`.]

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: With the hunter's in-memory Prisma harness, a `COMPLETED` job
      receiving `encodeStarted` currently reads `ENCODING`, and receiving `encodeFailed` reads `ERROR`.
      After the fix both leave it `COMPLETED` (`updateMany` count 0) and the title status is unchanged.
- [ ] **AC-2**: An `ERROR` job receiving `encodeCompleted` keeps `ERROR` and the title's `filePath`
      (or follows the REQ-3 clarification), and `notifyCreated` is not called.
- [ ] **AC-3**: The normal sequence `QUEUED → encodeStarted → encodeProgress → encodeCompleted` and a
      duplicated `encodeCompleted` with the same path behave as today; a BullMQ stall retry still
      restarts the encode.
- [ ] **AC-4**: `054`'s boot reconciliation, `095`'s discard and `097`'s stop/resume tests pass.

## Out of Scope

- **Refusing user principals on these operations** — spec 01.
- **Validating `outputFilePath`** — spec 47.
- **The deployment check** (replaying reports against a live title to see whether BullMQ leaves the
  job stuck) — the audit's validation plan, run by the owner.

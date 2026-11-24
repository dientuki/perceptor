---
title: Claim a subtitle attempt before rewriting its staged file
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/subtitle-search/completed-duplicate-delivery-double-rescales-staged-srt
audit_verdict: needs_validation
priority: 50
---

# SPEC (draft): Claim a subtitle attempt before rewriting its staged file

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> `needs_validation`: the double rescale is source-verified but was not reproduced (the hunter's
> harness output was not on disk), and whether a worker retry can overlap an unfinished first call
> depends on the deployed topology. Line numbers refer to commit `2a3976a`.

## Context & Goal

`subtitleSyncCompleted` (`subtitle-search/subtitle-search.resolver.ts:154`) is service-only
(`assertService`, `:173`) and documented as "safe to receive more than once". The worker sends it
through `deliverReport` (`worker/src/jobs/subtitle-sync.job.ts:54`), which retries on
`ApiUnreachableError` — a network-level failure, which can occur after the api already received the
first call.

`SubtitleSearchService.completed` (`subtitle-search/subtitle-search.service.ts:120`) reads the attempt
and returns early only when it is no longer `RUNNING` (`:130`). For an accepted film-rate measurement it
then rewrites the staged `.srt` in place — `rescaleStaged` reads, `rescaleSrt`s by the ratio and writes
the file (`:154`, body `:175-188`) — and only afterwards claims the row with
`updateMany({ id, status: 'RUNNING' })` (`:157`). A sequential duplicate is safe: it sees the row no
longer `RUNNING`. Two **overlapping** deliveries both pass `:130`, both rewrite the file, and only one
claims the row; the loser's file mutation is not undone. The accepted subtitle then carries timings
scaled by ratio squared and is embedded desynchronised (spec `121` REQ-18).

Impact is one mistimed subtitle of a file its owner asked to search; no cross-user or privilege
effect. The goal is that a staged file is rewritten at most once per attempt, by whoever wins the claim.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Claim first)**: The transition out of `RUNNING` is claimed atomically before the staged
      file is touched; a delivery that loses the claim returns `true` and does not read or write the
      file. [NEEDS CLARIFICATION: claim into an intermediate state (for example a short-lived
      `FINALIZING`) and then write `ACCEPTED`/`REJECTED`, or claim straight into the final state and
      revert to `REJECTED` with `SUBTITLE_SEARCH_INCOMPLETE` if the rewrite fails? The first needs an
      enum value and boot recovery; the second briefly exposes `ACCEPTED` before the file is scaled.]
- [ ] **REQ-2 (Idempotent rewrite)**: The rescale is applied to a pristine copy, never to the
      already-staged output, so even a repeated rewrite yields ratio-once timings.
      [NEEDS CLARIFICATION: is REQ-1 alone enough, or is a pristine copy also wanted as defence in
      depth?]
- [ ] **REQ-3 (Wake once)**: `wake(searchId)` still runs only for the delivery that claimed the row.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Contract posture)**: `subtitleSyncCompleted` stays safe to receive more than once,
      sequentially or concurrently (`038`'s posture), with no change on the worker side.
- [ ] **NFR-2 (Atomic write)**: The staged file is replaced by write-to-temp and rename inside the
      downloads root, so an embed never reads a half-written file.

## GraphQL Contract Delta

None.

## Data Model Changes

None, unless REQ-1's clarification picks an intermediate `SubtitleSearchAttempt` status.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: Fake-Prisma `tsx` harness: one `RUNNING` attempt with a staged
      `.srt` and a report whose `framerateRatio` maps to a film-rate ratio; call `completed()` twice
      concurrently. Today a cue's start time equals the original times ratio squared. After the fix it
      equals ratio once, exactly one call claims the row, and `wake` runs once.
- [ ] **AC-2**: A sequential duplicate still returns `true` and leaves the file unchanged.
- [ ] **AC-3**: A rejected measurement (wrong variant, low score) never touches the staged file.
- [ ] **AC-4**: Deployment check: dropping the worker–api connection mid `subtitleSyncCompleted`
      produces a `[deliver-report]` retry line and an embedded track with ratio-once timing.

## Out of Scope

- **The acceptance thresholds themselves** (spec `103` amendments 0.4.0) and the variant check (`118`).
- **Other worker callbacks' idempotence** — spec 46 (encode reports), spec 45 (`sourceScanned`).

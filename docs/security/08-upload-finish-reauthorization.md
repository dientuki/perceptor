---
title: Re-authorize a film/episode upload when it finishes
spec_version: 0.1.0
author: security-audit run-1 (draft)
created_at: 2026-11-20
last_updated: 2026-11-20
status: Draft
services: [api]
source_finding: api/uploads/finish-without-owner-recheck
audit_verdict: needs_validation
priority: 8
---

# SPEC (draft): Re-authorize a film/episode upload when it finishes

> Draft written from a static security audit (`security-audit` skill, run-1, profile `quick`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `98f8779`.

## Context & Goal

A film or episode tus upload is authorized once, in `onUploadCreate`, by spending a 60 s ticket.
For these targets the ticket's `userId` is dropped (`uploads.service.ts:139`); only the `force`
decision survives, as a Redis marker keyed by upload id with a 7-day TTL
(`upload-tickets.service.ts:20,147`). `FileStore` has no expiration (`uploads.service.ts:79`), and a
tus `PATCH` needs only the upload id. `handleUploadFinish` then loads the title by id with no user
scope (`:248`, episode `:201`), checks only `isReplaceAuthorised(upload.id)` (`:253`, `:207`), demotes
or retires the title's sources (`:260`) and creates and enqueues a `READY` `MediaSource`
(`:262`, `:282`).

The season-session branch (`068`) binds an owner at create (`:120`) and re-checks it at finish
(`:182`). The film/episode branch does not, so a user who was disabled, or who removed a title that
another user still owns, can still finish an upload started earlier and replace the remaining
owner's file, for up to 7 days.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Owner bound)**: Every upload must record the user who created it.
- [ ] **REQ-2 (Re-check at finish)**: When an upload finishes, its creator must still exist, be enabled
      and still own the target; otherwise the upload is refused, its staged file deleted and no
      source changed.
- [ ] **REQ-3 (Intent)**: [NEEDS CLARIFICATION: is a disabled user, or one who removed a shared title,
      meant to be able to finish an upload already started? The audit assumes not.]
- [ ] **REQ-4 (Staged lifetime)**: Staged uploads that never finish must expire.
      [NEEDS CLARIFICATION: lifetime — align with the 7-day marker TTL?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (One rule)**: Film, episode and season-session uploads use the same owner check.
- [ ] **NFR-2 (Article XII)**: Deleting a refused staged file stays confined to the uploads area of the
      downloads root.

## GraphQL Contract Delta

None — tus is the one REST route. A refused finish answers the tus `PATCH` with `403` (or `409`,
matching the losing-race path) [NEEDS CLARIFICATION: which status]; `web`'s import modal shows its
existing upload-failed message.

## Data Model Changes

None if the owner lives in the tus upload metadata or a Redis key next to the replace marker.
[NEEDS CLARIFICATION: Redis key vs tus metadata.]

## Acceptance Criteria

- [ ] **AC-1**: Movie M owned by A and B with a delivered source; A starts upload U with `force`; A's
      `UserMovie` row is removed; finishing U is refused, M's sources are unchanged and the staged file
      is gone.
- [ ] **AC-2**: Same with A disabled instead of de-owned.
- [ ] **AC-3**: A normal film, episode and season upload by a current owner still completes.
- [ ] **AC-4**: A staged upload older than the lifetime is cleaned up.

## Out of Scope

- **tus size limits.** Deferred by the audit; worth its own review.

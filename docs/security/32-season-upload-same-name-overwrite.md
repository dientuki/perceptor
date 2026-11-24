---
title: Claim a season upload's file name atomically so a concurrent same-name upload is never overwritten
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/uploads/moveIntoSession-access-then-rename-overwrites-concurrent-same-name-upload
audit_verdict: confirmed
severity: low
priority: 32
---

# SPEC (draft): Claim a season upload's file name atomically so a concurrent same-name upload is never overwritten

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding
> is **confirmed** with overall severity low: a fresh verifier reproduced it in a sandboxed local
> harness (real service code, in-memory fakes for Prisma/Redis/fetch). Line numbers refer to commit
> `2a3976a`.
> Evidence: `run-3/agents/v-api-uploads-moveintosession-access-then-rename-overwrites/artifacts/evidence/race-output.txt`.
> Touches the same season upload session as spec 31 (replacement guard at finish); the two fixes are
> independent.

## Context & Goal

Spec 068 lets several loose files upload into one season upload session. Each tus upload that
completes calls `handleUploadFinish` from the `onUploadFinish` hook (`uploads/uploads.service.ts:85-87`);
different uploads share no lock. The session branch (`:182-190`) resolves the open session through
`SessionService.findOpenSeasonSession` (`uploads/session.service.ts:8-18`, scoped by show ownership,
so the creator and any co-owner can write into it) and then calls `moveIntoSession`.

`moveIntoSession` (`uploads.service.ts:342-361`) is documented (`:339-341`) as keeping both files when
a name is already taken, the later one carrying its tus upload id, and never overwriting. It
implements that as check-then-act: `access(destPath)` (`:349`) decides whether the name is taken,
then `rename(rawPath, destPath)` (`:358`) moves the staged file. `rename(2)` replaces an existing
destination. When two uploads with the same sanitized filename finish together, both can evaluate
`access()` before either `rename()` runs; both take the "not taken" path and the later rename
replaces the earlier file. Both uploads report success, the session folder holds one file, and the
season scan that `finishSeasonUpload` enqueues processes only the later one.

The verifier called the real `moveIntoSession` twice with `Promise.all` and the same name: both
returned `.../race.mkv`, the folder listed only `race.mkv`, and its content was the second upload's.

Impact is one lost episode file inside the actor's (or a co-owner's) own session, recoverable by
re-upload. The goal is that the documented guarantee actually holds under concurrency.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Atomic claim)**: `moveIntoSession` claims the destination name with an operation that
      fails if the name exists, instead of `access()` followed by `rename()`. Candidate:
      `link(rawPath, destPath)`; on `EEXIST` retry with `<name>.<uploadId><ext>`; then `unlink`
      the staged file. [NEEDS CLARIFICATION: `link()` is unsupported on some network/FUSE mounts the
      downloads root may sit on. Alternative: `open(destPath, 'wx')` to create a placeholder, then
      `rename()` over the placeholder this upload owns. Which one is acceptable for the supported
      storage setups?]
- [ ] **REQ-2 (Fallback name)**: The `<name>.<uploadId><ext>` fallback is also claimed exclusively;
      if it too exists (should be impossible, upload ids are unique) the finish fails with the
      existing `UPLOAD_SESSION_CLOSED`-style error rather than overwriting.
- [ ] **REQ-3 (Return value)**: The path returned and logged (`:190-191`) is the name actually
      claimed, so two concurrent finishes never report the same path.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Article XII)**: The move stays inside the session's `downloadPath`, already checked
      with `isInsideRoot('downloads', ...)` (`:186`); nothing new is written or removed elsewhere.
- [ ] **NFR-2 (No partial residue)**: If the claim succeeds but moving the bytes fails, the claimed
      name is removed so a later retry or the season scan does not see an empty placeholder.
- [ ] **NFR-3 (Film/episode path unchanged)**: `moveUploadedFile` (`:368`) uses a per-upload folder
      (`imports/<uploadId>/`) and is not affected; it is left as is.

## GraphQL Contract Delta

None. The tus REST route's responses are unchanged.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: As in the verifier harness, instantiate `UploadsService`, stage two
      files with distinct content, and call `moveIntoSession` for both upload ids concurrently with
      the same filename into one session folder. Today both calls return the same path and the
      folder holds one file with the second content. After the fix the folder holds two files
      (`race.mkv` and `race.<uploadId>.mkv`) with both contents, and the two returned paths differ.
- [ ] **AC-2**: A single upload into an empty session lands at `<filename>` unchanged.
- [ ] **AC-3**: A sequential second upload with a taken name lands at `<name>.<uploadId><ext>` as
      today.
- [ ] **AC-4**: Closing the session after AC-1 enqueues a season scan that sees both files.

## Out of Scope

- **Replacement guard at `finishSeasonUpload`** — spec 31.
- **Upload size cap and expiry** — spec 19. **Owner re-check at finish for film/episode uploads** —
  spec 08.
- Concurrency between a finishing upload and `finishSeasonUpload` closing the session.

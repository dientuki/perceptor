---
title: Re-check the replacement guard when a season upload session closes
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/seasons/finishSeasonUpload-skips-replacement-guard-checked-only-at-start
audit_verdict: confirmed
severity: low
priority: 31
---

# SPEC (draft): Re-check the replacement guard when a season upload session closes

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> **confirmed** with overall severity low: a fresh verifier reproduced it in a sandboxed local harness
> (real service code, in-memory fakes for Prisma/Redis/fetch). Line numbers refer to commit `2a3976a`.
> Evidence: `agents/v-api-seasons-finishseasonupload-skips-replacement-guard-che/artifacts/evidence/finish-no-reguard.log`
> in the run-3 audit directory.
> The mirror image of spec 08: there the film/episode branch lacks the owner re-check the season
> branch has; here the season branch lacks the replacement re-check the film/episode branch has.

## Context & Goal

`startSeasonUpload` (`seasons/seasons.service.ts:123`) applies `087`'s replacement guard once: without
`force` it refuses with `SEASON_ALREADY_COMPLETED` when an episode of the season holds a file or the
season has a delivered source (`:131-137`). It then creates a `PENDING` `LOCAL_FOLDER` session
(`:149-151`) that stores neither `force` nor the guard's outcome. The record notes the session has no
expiry.

`finishSeasonUpload` (`:163`) checks only that the session is open and non-empty (`:164-173`), then
unconditionally calls `uploads.demoteSupersededSources({ seasonId })` (`:175`), which retires the
season's delivered sources and moves `READY`/`SCANNED` ones to `ERROR`, closing their in-flight jobs
(`uploads/uploads.service.ts:288-300`), and `resolveRace` (`:178`), which pauses in-flight siblings.
The session is then flipped `READY` (`:185-188`) and its scan enqueued (`:194`).

So an owner who opened a session while the season was empty can close it after another owner's
release, or the `073` sweep's, was delivered or started encoding, and replace it without the
confirmation `087` requires. The film and episode tus branches re-evaluate the guard at finish
(`uploads/uploads.service.ts:205-209`, `:252-255`); the season branch does not. The verifier's harness
calls `finishSeasonUpload` with a `hasDeliveredSource` spy returning true: the spy is never called and
the output is `demoteSupersededSources`, `recomputeSeason`, `addSourceReady`. Library files are not
deleted (Article XII); a co-owner's season source is retired or paused.

The goal is that the guard is evaluated when the replacement happens, not only when the session opens.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Persist the confirmation)**: A season upload session records whether it was opened with
      `force`. [NEEDS CLARIFICATION: a new `MediaSource` column, or a Redis marker keyed by the session
      id as the film/episode tickets do (`isReplaceAuthorised`)?]
- [ ] **REQ-2 (Re-check at finish)**: `finishSeasonUpload` re-runs the `:131-137` guard before
      `demoteSupersededSources` when the session was not opened with `force`, and refuses with
      `SEASON_ALREADY_COMPLETED` if the season now holds a file or a delivered source. The session
      stays open so the user can confirm.
- [ ] **REQ-3 (How the user confirms late)**: [NEEDS CLARIFICATION: after a REQ-2 refusal, does `web`
      re-open the session with `force` (new contract argument on `finishSeasonUpload`), or must the user
      discard and start a new forced session?]
- [ ] **REQ-4 (Optional expiry)**: [NEEDS CLARIFICATION: should an abandoned `PENDING` session expire
      and its `imports/<uuid>` folder be removed (inside the downloads root only)? Compare spec 19 for
      tus uploads.]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Forced sessions unchanged)**: A session opened with `force` closes exactly as today;
      `startSeasonUpload` already demoted the delivered sources (`:145-147`).
- [ ] **NFR-2 (Article XII)**: Nothing in the fix writes or deletes inside the library.

## GraphQL Contract Delta

No shape change for REQ-1/REQ-2. `finishSeasonUpload` may now fail with the existing
`SEASON_ALREADY_COMPLETED` key, which `web` already translates for `startSeasonUpload`. REQ-3 may add a
`force` argument to `finishSeasonUpload`; to be frozen at `/specify`.

## Data Model Changes

Possibly a nullable boolean on `MediaSource` for REQ-1 (one migration); none if a Redis marker is
chosen.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: Replay the verifier's harness: an open non-forced session 9 for
      season 1 with one file, `hasDeliveredSource` returning true. Today `finishSeasonUpload(9, 'u1')`
      demotes the season's sources and enqueues the scan. After the fix it refuses with
      `SEASON_ALREADY_COMPLETED`, demotes nothing, enqueues nothing, and session 9 stays `PENDING`.
- [ ] **AC-2**: Same as AC-1 with an episode of the season holding a file: refused the same way.
- [ ] **AC-3**: A non-forced session on a season that is still empty at finish closes as today.
- [ ] **AC-4**: A session opened with `force` closes as today even when the season gained a delivered
      source meanwhile.

## Out of Scope

- **Owner re-check on film/episode uploads** — spec 08.
- **tus size caps and staged-upload expiry** — spec 19.

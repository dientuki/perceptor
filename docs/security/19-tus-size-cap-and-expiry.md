---
title: Cap tus upload size and expire abandoned staged uploads
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-22
status: Draft
services: [api]
source_finding: api/uploads/tus-no-size-cap-or-expiry-staging-disk-exhaustion
audit_verdict: needs_validation
priority: 19
---

# SPEC (draft): Cap tus upload size and expire abandoned staged uploads

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `7365e13`
> (source unchanged since `98f8779`). Complements spec 08 REQ-4 (staged lifetime), which this spec
> makes concrete.

## Context & Goal

`UploadsService.onModuleInit` builds the tus `Server` with only `path`, a `FileStore`,
`respectForwardedHeaders`, `allowedHeaders` and two hooks (`uploads.service.ts:77-95`):
no `maxSize`, and the `FileStore` (`:79`) is created with `directory` only, so no
`expirationPeriodInMilliseconds`. `onUploadCreate` (`:98`) only verifies and spends the ticket for its
target; it never reads `Upload-Length` nor handles deferred length. `createUploadTicket`
(`uploads.resolver.ts:29`) mints tickets for any owned title with no count or rate limit.

Any authenticated user can therefore create many uploads and `PATCH` unbounded bytes into
`<downloads>/uploads/<id>`. A partial that is abandoned, or whose finish hook throws (the `409`
`UPLOAD_SUPERSEDED` paths at `:230` and `:276`, or any `500`), stays on disk. That volume is shared with
qBittorrent and the worker's scratch, so one low-trust user can fill it and stall everyone's pipeline.
`@tus/server` 2.4.7 supports `maxSize` (`types.d.ts:14`) and `@tus/file-store` an
`expirationPeriodInMilliseconds` option; the unlimited default was assumed, not run.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Max size)**: The tus server sets `maxSize`; a create declaring a larger `Upload-Length`
      is refused with `413`. [NEEDS CLARIFICATION: the limit — a UHD remux can be 80 GB; a fixed
      figure, a Setting, or a fraction of free space on the downloads volume?]
- [ ] **REQ-2 (Deferred length)**: An upload created with `Upload-Defer-Length` is either refused or
      bounded by the same `maxSize` as bytes arrive. [NEEDS CLARIFICATION: does `web`'s tus client
      ever send deferred length? If not, refuse it.]
- [ ] **REQ-3 (Expiry)**: Staged uploads expire: set the `FileStore` expiration period and run a
      periodic cleanup of expired partials. [NEEDS CLARIFICATION: lifetime — align with the 7-day
      replace-marker TTL and spec 08 REQ-4; does `@tus/server` 2.4.7 sweep expired uploads itself or
      must a scheduler task call `deleteExpired()`?]
- [ ] **REQ-4 (Failed finish cleans up)**: When `handleUploadFinish` throws, its staged file is deleted
      (or kept only for a retry window), so a `409`/`500` does not leave an orphan.
- [ ] **REQ-5 (Per-user concurrency)**: A user may hold at most K unfinished uploads.
      [NEEDS CLARIFICATION: K, and whether it is worth it once REQ-1 and REQ-3 exist.]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Article XII)**: All deletion stays confined to `<downloads>/uploads`, the existing
      uploads directory, and never touches the library.
- [ ] **NFR-2 (Resumable uploads)**: A paused upload within its lifetime still resumes; a legitimate
      multi-GB upload still completes.

## GraphQL Contract Delta

None; tus is the one REST route. New refusals: `413` for size (key
[NEEDS CLARIFICATION: `error.upload.too_large`?]) in both i18n catalogs; `web`'s import modal shows
its existing upload-failed message unless a dedicated string is added.

## Data Model Changes

None expected. REQ-5 would need to know the creator of each upload, which spec 08 REQ-1 already adds
(the owner marker); share it rather than duplicate.

## Acceptance Criteria

- [ ] **AC-1 (reproduces the bug)**: In a throwaway instance with a small test volume, a normal user
      mints a ticket, `POST /uploads` with `Upload-Length` larger than free space succeeds today and no
      `Upload-Expires` header is returned; it must answer `413`.
- [ ] **AC-2**: A second `POST` with `Upload-Defer-Length: 1` is refused (or stops at `maxSize` while
      `PATCH`ing).
- [ ] **AC-3**: A partial left untouched past the lifetime is removed by the cleanup and a later
      `PATCH` to it answers `404`/`410`.
- [ ] **AC-4**: A finish aborted with `409 UPLOAD_SUPERSEDED` leaves no file in `<downloads>/uploads`.
- [ ] **AC-5**: A normal film, an episode and a season-session upload still complete and enqueue.

## Out of Scope

- **Reverse-proxy limits** (Traefik body size) and filesystem quotas on the downloads volume;
  deployment-specific.
- **Ticket mint rate limiting** at `createUploadTicket`; REQ-1 and REQ-3 bound the damage first.
- **Re-authorization at finish** — spec 08.

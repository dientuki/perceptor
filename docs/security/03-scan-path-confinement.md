---
title: Confine scanned file paths to the source's download folder
spec_version: 0.1.0
author: security-audit run-1 (draft)
created_at: 2026-11-20
last_updated: 2026-11-20
status: Draft
services: [api]
source_finding: api/media-sources/sourceScanned-filePath-unbound-to-source-downloadPath
audit_verdict: needs_validation
priority: 3
---

# SPEC (draft): Confine scanned file paths to the source's download folder

> Draft written from a static security audit (`security-audit` skill, run-1, profile `quick`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `98f8779`.
> Depends on spec 01 for the user-reachable path; this spec is the defence in depth.

## Context & Goal

`sourceScanned` stores each `files[].filePath` verbatim as `SourceFile.filePath`
(`media-sources.service.ts:203`); the only check is that each match also appears in `files`
(`:133`), and the DTO only requires `@IsNotEmpty` (`dto/source-file.input.ts:7`). That path then
becomes the worker's encode input (`process-jobs.service.ts:92`) and the target of
`encodeJobDiscard`'s `rm` (`downloads.service.ts:976`), whose only guard is
`isInsideRoot('downloads', path)` (`:975`) — the whole downloads root every title and user shares.

Combined with spec 01, a user who owns any source could register another user's download as a file
of their own source and discard it, deleting it. Even with spec 01 fixed, a scan result pointing
outside its own folder is a bug that should never reach `rm`, an encode or the library.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Scan confinement)**: `sourceScanned` must refuse any reported file whose resolved real
      path is not inside that source's own `downloadPath` (the season-upload and Blu-ray `.mpls`
      cases included).
- [ ] **REQ-2 (Delete confinement)**: `encodeJobDiscard` and any other api-side delete of a source
      file must check containment in the job's own source folder, not only the downloads root.
- [ ] **REQ-3 (Failure is recorded)**: A refused scan is reported as a scan failure on that source
      (an `ERROR` with a key), never silently dropped.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Symlinks)**: Containment is checked on the real path, so a symlink inside the folder
      that points out of it is refused.
- [ ] **NFR-2 (Article XII)**: No change widens what the api may delete.

## GraphQL Contract Delta

No shape change. New refusal on `sourceScanned` (service-only after spec 01):

| Condition | GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Reported path outside `downloadPath` | `BadRequestException`, key [NEEDS CLARIFICATION: `error.source.scan_path_outside_source`?] | the source row shows the scan error |

The worker must treat this refusal as a scan failure (report through `sourceScanFailed`), not retry.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: With a temp downloads root holding `A/` and `B/victim.mkv` and a source whose
      `downloadPath` is `A/`, `sourceScanned` reporting `B/victim.mkv` fails and creates no
      `ProcessJob`.
- [ ] **AC-2**: A `SourceFile` row whose path lies outside its source folder (seeded directly) makes
      `encodeJobDiscard` refuse and leave the file on disk.
- [ ] **AC-3**: A symlink `A/link.mkv → ../B/victim.mkv` is refused.
- [ ] **AC-4**: A normal torrent, a season pack, an upload and a Blu-ray disc still scan and encode.

## Out of Scope

- **Worker-side confinement** (`services/worker`). The audit left the worker out of scope; a matching
  check there is worth its own review.

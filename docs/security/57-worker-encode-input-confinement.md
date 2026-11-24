---
title: Confine the encode input to the downloads root on the compression-on path
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [worker]
source_finding: worker/encode/input-path-not-confined-to-downloads-root-compression-on
audit_verdict: needs_validation
priority: 57
---

# SPEC (draft): Confine the encode input to the downloads root on the compression-on path

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding
> is `needs_validation`: the api and worker halves were each verified separately, but the end-to-end
> chain was not run against a real `api`, and worker egress and mounts are deployment facts. Line
> numbers refer to commit `2a3976a`.
> The worker-side twin of spec 03 (api confines `SourceFile.filePath`) and spec 01 (`sourceScanned`
> reachable by user sessions). Fixing 01 and 03 removes the known producer of a bad path; this spec
> is the defence in depth in the consumer. Spec 25 pins ffmpeg protocols, which overlaps REQ-2.

## Context & Goal

`handleEncode` takes `details.inputFilePath` from `api`'s `processJob` query, which returns
`processJob.sourceFile.filePath` verbatim (`api/src/process-jobs/process-jobs.service.ts:92`).
That value is whatever `sourceScanned` upserted (`api/src/media-sources/media-sources.service.ts:203`);
`sourceScanned` is `@AllowService` (`media-sources.resolver.ts:28-38`) and `JwtAuthGuard` only
rejects a *service* principal on non-annotated operations (`jwt-auth.guard.ts:51`), so a user
session also reaches it (spec 01).

In the worker, the only root check is inside the `compressionEnabled === false` branch:
`isInsideRoot(details.downloadsRoot, encodeInput)` (`worker/src/jobs/encode.job.ts:197`). The
default compression-on branch calls `encode(encodeInput, outputPath, …)` (`:238`) with no check.
`encodeFfmpeg` derives `<name>.working.mkv` next to the input (`encode/encode.ffmpeg.ts:12-15,22`),
runs `getMetadata(input)` (ffprobe, `:25`) and then ffmpeg on it, and the pre-encode analyses
(grain, dub-trim, audio variant, stream-end, subtitle prune) open it too.

The hunter's harness (`agents/h-worker-ffmpeg/artifacts/evidence/confine.log`, not re-run by the
verifier) reports that with compression on an out-of-root input was encoded into the library, the
same input was refused with compression off, and an `http://` value was fetched by ffprobe/ffmpeg.
Reach therefore depends on spec 01/03 being open and on the worker's mounts and egress: reading
another title's file into a user's library, or requests from inside `perceptor-net`.

The goal is that both branches enforce the same rule before any process opens the input.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (One check, both branches)**: `handleEncode` applies
      `isInsideRoot(details.downloadsRoot, encodeInput)` before the compression branch, so it runs
      before `getMetadata`, any analysis, `.working.mkv` derivation, or `passthrough`. The `.mpls`
      input is checked before `assemblePlaylist` too (`:186-189`).
- [ ] **REQ-2 (Plain paths only)**: An input that is not an absolute filesystem path (a value with
      a URL scheme such as `http:`, `file:`, `concat:`) is refused by the same check.
- [ ] **REQ-3 (Same failure)**: A refused input fails the job with the existing keyed error the
      compression-off branch already raises. [NEEDS CLARIFICATION: keep
      `ERROR_ENCODE_MOVE_FAILED` on both branches, or add a dedicated key such as
      `error.encode.input_outside_downloads`? A new key is a contract change in `api`'s catalog.]
- [ ] **REQ-4 (Symlinks)**: [NEEDS CLARIFICATION: should the check resolve symlinks (`realpath`)
      inside the downloads root? A torrent can carry a symlink only if qBittorrent writes one; not
      established.]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Non-retryable)**: The refusal is a diagnosed failure, rethrown as non-retryable like
      the other diagnosed failures (spec 054), so BullMQ does not retry it.
- [ ] **NFR-2 (Uploads and discs)**: Uploads (`imports/` under the downloads root) and Blu-ray
      playlists, which already live inside the root, behave exactly as today.

## GraphQL Contract Delta

None unless REQ-3 picks a new i18n key.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: With a fake `api` client returning `inputFilePath` outside
      `downloadsRoot` and `compressionEnabled: true`, `handleEncode` currently calls `getMetadata`
      and `encode` on it; after the fix it fails before any spawn and no file appears under the
      library root. Repeat with `http://127.0.0.1:<port>/x.mkv` against a loopback server: no request
      reaches it.
- [ ] **AC-2**: The same inputs with `compressionEnabled: false` are refused as today.
- [ ] **AC-3**: A normal torrent file, an upload under `imports/` and a `.mpls` inside the root
      still encode with compression on and move with compression off.
- [ ] **AC-4 (deployment)**: The owner records whether the worker container has egress beyond
      `perceptor-net` and whether the library volume is mounted read-write in it.

## Out of Scope

- **Authorizing `sourceScanned`** — spec 01. **Confining `SourceFile.filePath` in `api`** — spec 03.
- **ffmpeg protocol and demuxer whitelisting** for content-sniffed playlists — spec 25.

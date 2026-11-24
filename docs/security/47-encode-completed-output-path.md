---
title: Confine encodeCompleted's output path to the library root before storing or using it
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/process-jobs/encodeCompleted-outputFilePath-unvalidated-feeds-library-probe-and-notify
audit_verdict: needs_validation
priority: 47
---

# SPEC (draft): Confine encodeCompleted's output path to the library root before storing or using it

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> `needs_validation`: the user-token path rests on spec 01's carried lead and the effect on real
> internal services and on Jellyfin/Plex was not observable without a running stack. Line numbers
> refer to commit `2a3976a`.
> Shares its entry point with spec 01 (user principals on worker callbacks); spec 01 closes the user
> path, this spec closes the unchecked path itself, including against a compromised worker.

## Context & Goal

`encodeCompleted(processJobId, outputFilePath, ffmpegCommand)` (`process-jobs/process-jobs.resolver.ts:53`)
takes `outputFilePath` as a plain string. `ProcessJobsService.encodeCompleted` (`process-jobs.service.ts:369`)
stores it verbatim on the job (`:389`) and as `Movie.filePath`/`Episode.filePath` (`:397,403`), with no
absolute-path, library-root or extension check, and then:

- `MediaServerService.notifyCreated(outputFilePath)` (`:411`) calls
  `MediaRootsService.containerToHostPath('library', …)` (`media-server/media-server.service.ts:70`).
  That method tests only `startsWith(root.containerPath + sep)` and then returns
  `join(root.hostPath, relative(root.containerPath, path))` (`media-roots/media-roots.service.ts:27-41`),
  so `<library>/../../etc/x` passes the prefix test and normalises to a host path outside the library.
  Its sibling `hostToContainerPath` rejects a `..` result (`:60`); this one does not.
- the library probe is requested (`:417,419`); `LibraryProbeService.details` returns the stored
  `filePath` to the worker with no containment check (`library-probe/library-probe.service.ts:91`), and
  the worker runs `getMetadata(filePath)` (ffprobe) on it (`worker/src/jobs/library-probe.job.ts:46`).
  A URL-shaped string becomes a fetch from the worker host; the hunter's harness saw a loopback server
  receive `GET /internal/secret.mkv`.

By contrast `SubtitleEmbedService.assertUsableMkv` checks `.mkv` and `isInsideRoot('library', …)` before
using the same column (`subtitle-embed/subtitle-embed.service.ts:658-663`). The resolver is
`@AllowService()`, which `JwtAuthGuard` treats as additive (`auth/guards/jwt-auth.guard.ts:46`), so an
ordinary user token reaches it (spec 01). The goal is that no string outside the library root is ever
stored as a title's file or handed to the media server or ffprobe.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Write-side check)**: `encodeCompleted` refuses an `outputFilePath` that is not an
      absolute path, contains `\0`, or does not resolve inside the `library` root through
      `isInsideRoot` (realpath of the deepest existing ancestor), before any write. The job and the
      title are left unchanged.
- [ ] **REQ-2 (Translation)**: `containerToHostPath` returns `null` when the relative path is `..` or
      starts with `..` + separator, mirroring `hostToContainerPath`, so `notifyCreated` logs and skips.
- [ ] **REQ-3 (Read-side check)**: `LibraryProbeService.details` returns a stored `filePath` only if it
      passes the same check as REQ-1; otherwise it answers not-found and the worker reports nothing.
      [NEEDS CLARIFICATION: also require a known video extension here, or only `.mkv` as embed does?
      Compression off (`032`) moves the source container unchanged, so `.mkv` alone would be wrong.]
- [ ] **REQ-4 (Existing rows)**: Rows already holding a path outside the library are not trusted by
      REQ-3. [NEEDS CLARIFICATION: also clear or flag them at boot, as `108`'s one-time pass does?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Article XII)**: Nothing here writes or deletes in the library; checks only narrow.
- [ ] **NFR-2 (Layouts)**: The check accepts every destination the worker builds today for both
      `jellyfin` and `plex` layouts, films, shorts and episodes.

## GraphQL Contract Delta

No shape change. REQ-1 adds a keyed refusal on `encodeCompleted`.
[NEEDS CLARIFICATION: new key (`error.encode.output_outside_library`) and how the worker treats it —
it is not retryable, so `deliverReport` must not loop on it.]

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: In the hunter's harness (fake Prisma, real `MediaRootsService`),
      `encodeCompleted` with `<library>/../../etc/cron.d/x` currently stores it and notifies a host
      path outside the library, and `http://127.0.0.1:<port>/internal/secret.mkv` is stored and
      fetched by the worker's ffprobe. After the fix both calls are refused, `filePath` is unchanged,
      no notify is sent and no request reaches the loopback server.
- [ ] **AC-2**: `containerToHostPath('library', '<library>/../x')` returns `null`.
- [ ] **AC-3**: A real encode, a compression-off move and a short (`path_shorts`) all complete and
      notify as today.
- [ ] **AC-4**: `libraryProbeDetails` for a title whose stored path is outside the library answers
      not-found.

## Out of Scope

- **Refusing user principals on `encodeCompleted`** — spec 01. **State transitions** — spec 46.
- **ffprobe protocol whitelisting** in the worker — spec 25 (would also blunt the URL case).
- **How Jellyfin/Plex handle an out-of-library `Library/Media/Updated` path** — the audit's
  deployment check.

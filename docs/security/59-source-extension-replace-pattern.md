---
title: Treat the source file extension as literal text when renaming the library output
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [worker]
source_finding: worker/paths/with-source-extension-replace-string-dollar-patterns
audit_verdict: needs_validation
priority: 59
---

# SPEC (draft): Treat the source file extension as literal text when renaming the library output

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding
> is `needs_validation`: the splice reproduces locally, but whether a torrent file name ending in
> ``.m$` `` survives qBittorrent, the scan and `api` before reaching the worker is not established.
> Line numbers refer to commit `2a3976a`.

## Context & Goal

With compression off, `handleEncode` sets
`finalOutputPath = withSourceExtension(outputPath, encodeInput)` (`worker/src/jobs/encode.job.ts:204`),
where `encodeInput` is the scanned torrent file. `withSourceExtension` takes `extname(inputPath)`
verbatim (`paths/with-source-extension.ts:16`) and returns
`outputPath.replace(/(\.[^./]+)$/, sourceExt)` (`:21`). A string replacement argument expands
`$&`, `` $` ``, `$'` and `$1`, so an extension containing them is not inserted literally.
`passthrough` then runs `mkdir(dirname(output), { recursive: true })` and `rename(input, output)`
(`encode/passthrough.ts:34,37`).

The verifier's harness
(`agents/v-worker-paths-with-source-extension-replace-string-dollar-p-r2/artifacts/evidence/h2.log`)
showed a source named ``x.m$` `` turning `<lib>/T (2000) [tmdbid=1]/T (2000).mkv` into
`<lib>/T (2000) [tmdbid=1]/T (2000).m<lib>/T (2000) [tmdbid=1]/T (2000)`, and `mkdir` + `rename`
created that nested tree with an extension-less file. The spliced text always starts with the
library path itself, so the result stays inside the library root.

The ordinary scan narrows reach: a file is a video candidate only when its extension is in
`VIDEO_EXTENSIONS` (`scan/scan-folder.ts:4,34-36`, `scan/select-matches.ts:14`), none of which
contains `$`. A `$`-bearing extension therefore reaches `withSourceExtension` only through a
`SourceFile.filePath` the scan did not produce, which is the forged `sourceScanned` path of specs 01
and 03. This spec is defence in depth for that path.

Impact is a stray directory tree and a mislabelled file inside the library that the media server
will not recognise; there is no escape and no overwrite of another title shown. The goal is that the
output path never contains anything but the source's literal extension, and only a sane one.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Literal replacement)**: `withSourceExtension` inserts the extension literally (a
      function replacer, or slicing the string), never as a replacement pattern.
- [ ] **REQ-2 (Sane extension)**: An extension that is not a short alphanumeric token (for example
      not matching `^\.[A-Za-z0-9]{1,5}$`) leaves the output's own extension in place, as an input
      with no extension already does (`:17-19`). [NEEDS CLARIFICATION: is that pattern enough for
      every container the passthrough is expected to move (`.mkv`, `.mp4`, `.m2ts`, `.webm`,
      `.avi`, `.ts`…), or should it be an explicit allowlist?]
- [ ] **REQ-3 (Same shape elsewhere)**: The other `.replace(/(\.[^./]+)$/, …)` call sites
      (`passthrough.ts:21`, `encode.ffmpeg.ts:18`) use constant replacement strings and are left as
      they are; this is recorded so a later change does not feed them untrusted text.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Article XII)**: The library write stays the one the worker already makes; no new
      directory under the title folder is ever created by this path.
- [ ] **NFR-2 (Titles with dots)**: A title containing a dot ("The Super Mario Bros. Movie") still
      only has its last extension replaced.

## GraphQL Contract Delta

None.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: `withSourceExtension('<lib>/T (2000) [tmdbid=1]/T (2000).mkv',
      '/dl/x.m$`')` currently returns a path containing `<lib>` twice; after the fix it returns a
      path whose directory is unchanged and whose file name ends in `.mkv` (REQ-2) or the literal
      extension.
- [ ] **AC-2**: Sources ending in `.mp4`, `.MKV`, `.m2ts` and no extension produce the same output
      as today.
- [ ] **AC-3**: A passthrough with the AC-1 source creates no directory beyond the title folder.
- [ ] **AC-4 (deployment, optional)**: On a test install with compression off, a torrent with a file
      named ``a.m$` `` is added; record whether it is ever reported as a match (the scan's extension
      list suggests it is not).

## Out of Scope

- **Confining the input path itself** — spec 57 (worker).
- **Who may report scan results** — spec 01. **Confining reported paths in `api`** — spec 03.
- **Content-sniffed inputs behind an allowed extension** — spec 25.

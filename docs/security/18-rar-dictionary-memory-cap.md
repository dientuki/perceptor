---
title: Bound RAR extraction memory and the Subdivx download size
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-22
status: Draft
services: [api]
source_finding: api/subtitle-search/rar-dictionary-memory-amplification
audit_verdict: needs_validation
priority: 18
---

# SPEC (draft): Bound RAR extraction memory and the Subdivx download size

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`, and it depends on `node-unrar-js` 2.0.2
> behaviour that was not observed. Line numbers refer to commit `7365e13` (source unchanged since
> `98f8779`). Shares the download cap and the poison-candidate handling with spec 04.

## Context & Goal

Spec 04 covers the zip side (forged zip64 entry count). This one covers the rar side of the same
path. `SubdivxClient.download` buffers the whole response with no cap
(`clients/subdivx/client.ts:105`). For a rar, `extractRar` (`subtitle-search/archive.ts:62`) builds an
extractor over the whole buffer (`:67`), sums each header's declared `unpSize` in `pick()` (`:91`)
against `MAX_ARCHIVE_BYTES` (20 MB) and only then calls `extractor.extract` (`:79`); the length check
on the result (`:82`) runs after the bytes already exist.

Everything checked beforehand is **declared by the archive author**: a header can understate
`unpSize`; a solid archive decodes the preceding files to reach the wanted one; and the RAR
dictionary (up to hundreds of MB in RAR5) is allocated by the WASM decoder regardless of the entry
size. A Subdivx uploader can therefore make a small file cost far more memory than the limit
suggests. Zip has the same declared-size pattern (`:46`, `originalSize`). Impact is availability of
the api process only.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Download cap)**: The Subdivx download is aborted while streaming once it passes a fixed
      byte limit. Same limit and same change as spec 04 REQ-3; implement once.
      [NEEDS CLARIFICATION: limit — 10 MB, as in spec 04?]
- [ ] **REQ-2 (Declared-size gate)**: Before extraction, a rar is refused when its dictionary size
      (read from the RAR5 compression info of the chosen file, or the RAR4 equivalent) exceeds a cap
      [NEEDS CLARIFICATION: cap — subtitles need a few MB; 64 MB?], and when the chosen entry is in a
      solid block that would decode more than `MAX_ARCHIVE_BYTES` of preceding data.
- [ ] **REQ-3 (Real-output bound)**: The decoded output must be bounded by what was actually produced,
      not by the header. [NEEDS CLARIFICATION: does `node-unrar-js` 2.0.2 expose a streaming or
      size-limited extract? If not, run the rar path in a `worker_threads` Worker with
      `resourceLimits.maxOldGenerationSizeMb`, or drop rar support.]
- [ ] **REQ-4 (Zip parity)**: The zip path trusts neither `originalSize`: extraction aborts once the
      produced bytes pass `MAX_ARCHIVE_BYTES` (shares the early-stop work of spec 04 REQ-1 and REQ-4).
- [ ] **REQ-5 (Outcome)**: A refused archive is a rejected candidate with the same i18n key as spec 04
      REQ-6, consuming one provider attempt.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Failure contained)**: An allocation failure in the rar decoder must not take the api
      process down. [NEEDS CLARIFICATION: is a worker thread with `resourceLimits` acceptable inside
      the api, or is "drop rar" the simpler call given how rare a rar subtitle is?]

## GraphQL Contract Delta

None. Reuses the rejection reason and key proposed in spec 04.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces the bug)**: In a sandbox with `--max-old-space-size=256`, feed `extractSrt` a
      small crafted RAR5 with a large declared dictionary and an understated `unpSize`; today peak RSS
      exceeds the limit or the process dies; it must return a rejection instead.
- [ ] **AC-2**: A solid rar whose wanted `.srt` follows 200 MB of preceding entries is rejected.
- [ ] **AC-3**: A 50 MB Subdivx response is aborted while streaming (shared with spec 04 AC-3).
- [ ] **AC-4**: A normal rar, zip and plain srt from Subdivx still resolve.

## Out of Scope

- **Zip64 entry-count handling** — spec 04.
- **OpenSubtitles downloads** — plain srt; see spec 04's out-of-scope note.

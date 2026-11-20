---
title: Bound Subdivx archive extraction before enumeration
spec_version: 0.1.0
author: security-audit run-1 (draft)
created_at: 2026-11-20
last_updated: 2026-11-20
status: Draft
services: [api]
source_finding: api/subtitle-search/archive-zip-entry-count-checked-after-enumeration
audit_verdict: needs_validation
priority: 4
---

# SPEC (draft): Bound Subdivx archive extraction before enumeration

> Draft written from a static security audit (`security-audit` skill, run-1, profile `quick`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `98f8779`.

## Context & Goal

Spec `121` lets a Subdivx download be a zip or rar opened in memory
(`services/api/src/subtitle-search/archive.ts`). `extractZip` (`:46`) runs fflate's synchronous
`unzipSync`, pushing every central-directory entry into an array from the filter callback (`:48`),
and only afterwards checks `MAX_ARCHIVE_ENTRIES` in `pick()` (`:89`). fflate 0.8.3 trusts the zip64
EOCD entry count (up to 2^32-1), never checks central-header signatures and reads zeros past the end
of the buffer, so a tiny forged zip can make the api event loop iterate billions of times while the
array grows until V8 runs out of heap — not catchable by `try/catch`.

The download itself is buffered with no size cap (`clients/subdivx/client.ts:105`). The attempt stays
`QUEUED`, and `SubtitleSearchDriver.recover()` (`subtitle-search.driver.ts:191`) re-wakes every
non-terminal search at boot, while the api runs `restart: unless-stopped`: the api could crash-loop,
taking GraphQL, uploads and queues down for every user. The attacker is a Subdivx uploader or the
SubX proxy operator.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Early cap)**: Extraction must stop as soon as the entry count passes the limit, during
      enumeration, not after.
- [ ] **REQ-2 (Plausibility)**: An archive whose declared entry count cannot fit in its byte length
      (each central header is at least 46 bytes) must be refused before enumeration.
- [ ] **REQ-3 (Download cap)**: A provider download larger than a fixed limit must be aborted while
      streaming. [NEEDS CLARIFICATION: the limit — a subtitle archive is rarely over a few MB; 10 MB?]
- [ ] **REQ-4 (Decompressed cap)**: The total decompressed size taken from an archive must be bounded
      (zip and rar alike).
- [ ] **REQ-5 (No replay of a poison candidate)**: A candidate whose extraction was in progress when
      the process died must not be retried indefinitely at boot; it is marked failed and the next
      candidate is tried.
- [ ] **REQ-6 (Outcome)**: A refused archive counts as a rejected candidate with an i18n key, using up
      one of the provider's attempts like any other rejection.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Same for rar)**: The rar path (`node-unrar-js`) gets the same entry and size bounds.

## GraphQL Contract Delta

None — `SubtitleSearchLanguage` already carries a rejection reason. New key
[NEEDS CLARIFICATION: `error.subtitleSearch.archive_rejected`?] in both catalogs.

## Data Model Changes

None expected. REQ-5 may need a per-attempt "extracting" marker
[NEEDS CLARIFICATION: is the existing attempt status enough to record "started, never finished"?].

## Acceptance Criteria

- [ ] **AC-1**: `extractSrt` on a hand-built zip with zip64 EOCD count `0xFFFFFFFF` returns a
      rejection in under 1 s with `--max-old-space-size=256`.
- [ ] **AC-2**: A zip with `MAX_ARCHIVE_ENTRIES + 1` real entries is rejected without allocating more
      than the cap.
- [ ] **AC-3**: A 50 MB Subdivx response is aborted while streaming.
- [ ] **AC-4**: Killing the api mid-extraction, then restarting it, does not re-run the same
      candidate; the search moves to the next one or fails.
- [ ] **AC-5**: A normal zip, rar and plain srt from Subdivx still resolve.

## Out of Scope

- **OpenSubtitles downloads.** They are plain srt; a size cap there is worth adding but not required
  by this finding.

---
title: Bound the inflate work of a Subdivx zip, not only its declared size
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/subtitle-search/archive-zip-lying-originalsize-inflate-cpu-bomb
audit_verdict: needs_validation
priority: 49
---

# SPEC (draft): Bound the inflate work of a Subdivx zip, not only its declared size

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> `needs_validation`: the event-loop stall was reproduced in a sandbox harness, but whether Subdivx can
> serve such a zip as a ranked candidate, and how the deployment recovers, are not observable from
> source. Line numbers refer to commit `2a3976a`.
> Same file and download as spec 04 (zip entry count) and spec 18 (rar memory, zip parity in its
> REQ-4); the download cap (spec 04 REQ-3, spec 18 REQ-1) is shared and implemented once.

## Context & Goal

`SubdivxClient.download` buffers the provider response whole with no size cap
(`clients/subdivx/client.ts:105`), and `SubtitleSearchDriver.startNext` passes it to `extractSrt` on the
api's main thread (`subtitle-search/subtitle-search.driver.ts:771`). For a zip, `extractZip`
(`subtitle-search/archive.ts:44`) lists entries with the declared `originalSize` (`:48`), `pick()`
checks the declared sum against `MAX_ARCHIVE_BYTES` (20 MiB, `:91-92`), and a second synchronous
`unzipSync` extracts the chosen entry (`:54`); the output length is checked only afterwards (`:58`).
`MAX_ARCHIVE_BYTES` applies to the input only on the plain-text branch (`:33`).

fflate decodes the entry's entire deflate stream and drops output past the declared size, so an entry
declaring 10 bytes over a 128 MiB stream of zeros passes every check and costs a full inflate. The
verifier measured a 130 KB zip blocking the event loop for about 2.1 s (lag probe 2091 ms) and
returning a 10-byte srt; 32 MiB took 0.68 s; the hunter measured 19.5 s for a 262 KB zip. Cost grows
with compressed size, which nothing caps. Memory stays bounded. While the loop is blocked the api
serves no GraphQL, health check or worker callback. The goal is that extracting one subtitle costs
bounded CPU whatever the archive declares.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Real-work bound)**: The chosen zip entry is inflated with a limit on produced bytes that
      aborts as soon as output passes `MAX_ARCHIVE_BYTES` or the entry's declared size, whichever is
      smaller (for example zlib `inflateRawSync` with `maxOutputLength`, or a streaming inflate that
      stops at the cap).
- [ ] **REQ-2 (Size mismatch)**: An entry whose produced length differs from its declared
      `originalSize`, or whose compressed size is implausible for the declared size, is rejected.
      [NEEDS CLARIFICATION: a compression-ratio ceiling too (for example 1:100), or is REQ-1 plus
      REQ-3 enough for text files?]
- [ ] **REQ-3 (Download cap)**: The Subdivx download is aborted while streaming past a fixed byte
      limit — the same change as spec 04 REQ-3 / spec 18 REQ-1.
- [ ] **REQ-4 (Outcome)**: A refused archive is a rejected candidate with the same i18n key as spec 04
      REQ-6, consuming one provider attempt; the search moves to the next candidate.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Loop latency)**: With REQ-1 and REQ-3, the worst-case single `extractSrt` call stays
      under a fixed bound. [NEEDS CLARIFICATION: target — 100 ms? If the synchronous path cannot meet
      it, move extraction to a `worker_threads` Worker, which also serves spec 18 NFR-1.]
- [ ] **NFR-2 (No behaviour change for real subtitles)**: Every ordinary srt, zip and rar Subdivx
      returns today still extracts identically.

## GraphQL Contract Delta

None beyond the rejected-candidate key shared with spec 04.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: The verifier harness (`lying-size-v.ts`: a zip of 128 MiB of zeros
      declaring `originalSize` 10, with an event-loop lag probe) today shows about 2 s of lag and a
      10-byte srt. After the fix `extractSrt` returns rejected and the lag stays under NFR-1's bound.
- [ ] **AC-2**: A larger variant (up to the 100 MB file limit) is rejected without a comparable stall.
- [ ] **AC-3**: A download past the REQ-3 cap is aborted before being fully buffered.
- [ ] **AC-4**: A normal single-srt zip and a season zip with one matching episode still extract.

## Out of Scope

- **Zip entry count** — spec 04. **RAR dictionary memory** — spec 18.
- **Whether Subdivx accepts and ranks a hostile upload** — the audit's deployment check, with a stub
  provider serving the crafted zip.

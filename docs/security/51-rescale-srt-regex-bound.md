---
title: Make the film-rate SRT rescale linear in the length of a cue timing line
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/subtitle-search/rescale-srt-quadratic-trailing-whitespace-regex
audit_verdict: needs_validation
priority: 51
---

# SPEC (draft): Make the film-rate SRT rescale linear in the length of a cue timing line

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding
> is `needs_validation`: the quadratic cost is reproduced on the real `rescaleSrt`, but reaching it
> needs a hostile `.srt` that a provider serves and that the real ffsubsync check accepts at a
> film-rate ratio. Line numbers refer to commit `2a3976a`.
> The api-side sibling of spec 24 (the same class of regex on subtitle text, in the worker).

## Context & Goal

Spec 121 REQ-18 rescales an accepted candidate whose measured framerate ratio is a film-rate ratio
(`24/23.976` or its inverse). `SubtitleSearchService.completed`
(`subtitle-search/subtitle-search.service.ts:120`) runs `accept(...)` with `filmRate: true`
(`:150`), then `filmRateRatio` (`:152`), and calls `rescaleStaged` (`:154`). `rescaleStaged`
(`:175`) reads the whole staged provider file with `readFile(stagedPath, 'utf8')` and passes it to
`rescaleSrt` synchronously (`:181`).

`rescaleSrt` (`subtitle-search/film-rate.ts:37`) splits every line containing `-->` into its two
sides and, **before** `scaleTime` validates either side (`:48`), runs `/^\s*/` (`:46`) and
`/\s*$/` (`:47`) on it. `/\s*$/` on a side holding a long whitespace run followed by a non-space
character retries from every start position in the run: O(n^2). A line such as `1` + N spaces +
`x-->00:00:01,000` therefore costs quadratic time on the api's single event loop, which also serves
every GraphQL request. The verifier measured 145 ms at N = 10k, 570 ms at 20k and 2.3 s at 40k (4x
per doubling); the hunter measured 14.3 s for an 80 KB line.

No per-line bound exists. The Subdivx path is bounded at 20 MiB by `archive.ts`
(`MAX_ARCHIVE_BYTES`, `:5`); `rescaleStaged` itself checks no size, and the OpenSubtitles path
stages `downloaded.bytes` with no cap visible in `subtitle-search.driver.ts:789-796`.

Unverified: whether such a file can pass the real ffsubsync measurement at ~1.001 with enough score
and last-cue coverage, whether it can rank in the top three candidates, and whether either provider
serves a 100 KB+ single line. The goal is that the rescale is linear whatever the file holds.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Validate before trimming)**: `rescaleSrt` validates each side against `TIME` on the
      trimmed value first and returns `null` (the existing "incomplete" outcome) before any
      leading/trailing-whitespace capture runs on a side that is not a timestamp.
- [ ] **REQ-2 (Linear whitespace capture)**: The leading/trailing whitespace is captured without a
      backtracking pattern (index scan, or `side.length - side.trimEnd().length`), so a valid line's
      output is byte-identical to today's.
- [ ] **REQ-3 (Timing-line bound)**: A line containing `-->` longer than a named maximum (proposed
      200 characters, far above any real SRT timing line) makes `rescaleSrt` return `null` without
      running any regex on it.
- [ ] **REQ-4 (File bound)**: `rescaleStaged` refuses a staged file above a named size before
      reading it (proposed the same 20 MiB as `MAX_ARCHIVE_BYTES`, or smaller).
      [NEEDS CLARIFICATION: should the cap move upstream to the staging write so the OpenSubtitles
      path is bounded for every reader (`readLastCueEnd`, `:216`, too)? Overlaps spec 18.]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Same outcome)**: A refused or invalid file keeps today's outcome
      (`ERROR_KEYS.SUBTITLE_SEARCH_INCOMPLETE`, the next candidate is tried); no new error key.
- [ ] **NFR-2 (Event loop)**: `rescaleSrt` over a 20 MiB input of any shape finishes in time linear
      in its length (well under a second on the dev image).

## GraphQL Contract Delta

None.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduce first)**: In the api dev image, time the real `rescaleSrt` on a valid cue
      followed by a line `1` + N spaces + `x-->00:00:01,000` for N = 10k, 20k, 40k; today the time
      grows about 4x per doubling (seconds at 40k). If ffsubsync is available, also craft a valid
      subtitle scaled by 24/23.976 with a 100 KB whitespace line, run the sync job and the api
      `completed()` path, and measure event-loop delay.
- [ ] **AC-2**: After REQ-1..REQ-3 the same inputs return `null` in milliseconds.
- [ ] **AC-3**: The existing `film-rate` unit cases (both ratios, `,` and `.` separators, CRLF,
      surrounding whitespace) produce byte-identical output.
- [ ] **AC-4**: A staged file above the REQ-4 cap is rejected without being read whole.

## Out of Scope

- **Provider policy** (whether OpenSubtitles or Subdivx serve such a file) — the deployment
  validation step in the audit covers it.
- **Subdivx archive and RAR memory bounds** — spec 18. **Worker-side subtitle regexes** — spec 24.
- **Manual search quota** — spec 17.

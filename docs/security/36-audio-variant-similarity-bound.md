---
title: Bound the word count the variant duplicate test compares
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [worker]
source_finding: worker/encode/audio-variant-score-similarity-superlinear-on-track-text
audit_verdict: confirmed
severity: low
priority: 36
---

# SPEC (draft): Bound the word count the variant duplicate test compares

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding
> is **confirmed** with overall severity low: a fresh verifier reproduced it in a sandboxed local
> harness (real service code, in-memory fakes for Prisma/Redis/fetch). Line numbers refer to commit
> `2a3976a`.
> Evidence: `run-3/agents/v-worker-encode-audio-variant-score-similarity-superlinear-o/artifacts/evidence/sim-verify.log`
> (the real `similarity()` was timed in isolation; a full BullMQ lock lapse was not exercised).
> Same untrusted subtitle sample as spec 24 (per-cue regex bound), whose per-cue cap does not limit
> the number of words; specs 37 and 38 bound other regexes on the same text.

## Context & Goal

Spec 118 decides the Spanish variant of subtitle tracks for a user who opted into variant detection
(`110`). When exactly two same-language text tracks remain unresolved, `resolveSubtitlePruning` joins
each track's cues into one string (`sampleText`, `encode/subtitle-prune.ts:127-129`; called at
`:254`) and calls `decide` (`:257`). The cues come from the embedded subtitle streams of the
downloaded release, captured over up to 900 s (`ffmpeg/subtitle-content.ts:2`) with stdout capped at
32 MiB (`ffmpeg/capture.ts:23`).

`decide` (`encode/audio-variant-score.ts:65-83`) calls `similarity(first.text, second.text)` (`:72`)
before any other check. `similarity` (`:57-63`) splits both texts into words after only whole-line
dedupe (`words`, `:17-19`) and runs a Ratcliff-Obershelp matcher: `matchingTotal` (`:43-55`) loops
over recursive blocks, and each `longestMatch` (`:21-41`) is a nested O(n*m) loop allocating a `Map`
per row. There is no cap on word count. It runs synchronously on the worker's single event loop,
which also serves encodes, BullMQ lock renewal and progress reports.

The verifier timed the real function on two tracks of unique lines drawn from a 3-letter vocabulary:
1,000 words 201 ms, 2,000 1,100 ms, 4,000 3,336 ms, 8,000 8,286 ms. Growth is superlinear; sizes near
the 32 MiB cap were not run. A torrent publisher whose release a user with the opt-in downloads
controls the text. Impact is availability only: a stall of the single worker that clears when the
pair finishes. Realistic tracks cost seconds. The verdict is cached in Redis (`111`), so the same
file is not re-scored after it completes.

The same `decide` serves audio (`encode/audio-variant.ts:94`) on whisper transcripts of three 120 s
windows, which are already small.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Word budget)**: `similarity` (or its subtitle caller) compares at most a named number
      of words per side (proposed 3,000). [NEEDS CLARIFICATION: truncate both sides to the first N
      words, or skip the duplicate test entirely (treat as not duplicate) when either side exceeds
      N? Truncation keeps the duplicate verdict for long real tracks; skipping is simpler but keeps
      both tracks, which matches "err on keeping".]
- [ ] **REQ-2 (Cue budget)**: `sampleText` uses at most a named number of cues per track, so the
      marker `score()` that follows also runs on bounded input.
- [ ] **REQ-3 (Same verdicts for real input)**: For tracks under the budget the verdict
      (`duplicate`/`decided`/`undecided`) is unchanged.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Event loop)**: One `decide` call on the bounded input finishes in well under a second
      on the worker's CPU, measured as in AC-1.
- [ ] **NFR-2 (Err on keeping)**: Any truncation or skip resolves to `undecided` or "not duplicate",
      never to dropping a track (memory: track selection errs on keeping).
- [ ] **NFR-3 (Cache keys)**: [NEEDS CLARIFICATION: `111`'s `subtitle-variant` verdicts computed on
      full text stay valid, or does the budget change the verdict function enough to bump the cache
      kind?]

## GraphQL Contract Delta

None.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: Run the verifier's `sim-verify.ts` with the worker's `tsx`,
      importing `similarity()` from `encode/audio-variant-score.ts`, on two tracks of 1,000, 2,000,
      4,000 and 8,000 unique-line words. Today the times grow superlinearly (about 0.2 s to 8.3 s).
      After the fix the 8,000-word pair finishes within the bound of NFR-1, and a 32,000-word pair
      costs no more than the budget-sized one.
- [ ] **AC-2**: `resolveSubtitlePruning` on an mkv with two unresolved `spa` text tracks of that size
      returns without delaying lock renewal.
- [ ] **AC-3**: The spec 118 corpus (Latino/Spain pairs, identical dubs) yields the same verdicts
      before and after.
- [ ] **AC-4**: The audio path (`110`) yields the same verdicts on its existing fixtures.

## Out of Scope

- **Per-cue regex cost** — spec 24. **Marker regexes** (`imperative-id`) — spec 37.
  **Tag strip in provider subtitle variant checks** — spec 38.
- Moving the analysis to a worker thread.
- The 32 MiB capture cap itself.

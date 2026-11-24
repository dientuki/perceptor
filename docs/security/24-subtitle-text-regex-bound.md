---
title: Bound subtitle cue text before the worker runs regexes on it
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-23
status: Draft
services: [worker]
source_finding: worker/encode/subtitle-content-unbounded-quadratic-regex-on-track-text
audit_verdict: confirmed
severity: low
priority: 24
---

# SPEC (draft): Bound subtitle cue text before the worker runs regexes on it

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `7365e13`
> (source unchanged since `98f8779`).
>
> **Run-3 update (2026-11-23):** now **confirmed**, overall severity low (likelihood low, impact medium). A fresh verifier reproduced it in a sandboxed local harness (real service code, in-memory fakes); evidence in `~/security-audit-skill/perceptor/run-3/agents/v-worker-encode-subtitle-content-unbounded-quadratic-regex-o/artifacts/evidence/`. The final record is `worker/encode/subtitle-content-unbounded-quadratic-regex-on-track-text` in run-3's `findings.json`.

## Context & Goal

Spec 102's subtitle pruning extracts up to 900 s of each text track of a torrent's file as SRT
(`ffmpeg/capture.ts:25`, stdout capped only at 32 MiB, `:23`), parses it with `parseSrt`
(`ffmpeg/subtitle-content.ts:40`, no per-cue limit) and runs three unanchored regexes on every cue
(`subtitle-content.ts:30-32`, via `isAnnotated` at `:63`):

- `MARKUP = /<[^>]*>|\{[^}]*\}/g` and `BRACKETED = /\[[^\]]*\]|\([^)]*\)/`: a cue of many `<`, `{`,
  `[` or `(` with no closer restarts a full scan at each opener, O(n^2).
- `SPEAKER_LABEL = /(^|\n)\s*-?\s*\p{Lu}.../u`: two adjacent `\s*` around an optional dash, O(n^2)
  on a long whitespace run after a newline.

The same `<[^>]*>` strip runs on provider `.srt` text in `subtitles/subtitle-variant.ts:17`, read
whole with `readFile` (`:26`) and no size check. It all runs synchronously on the worker's single
event loop, which also serves every encode, BullMQ lock renewal and progress report. It triggers
whenever a language has two or more text tracks, which the torrent publisher controls. Unmeasured:
whether ffmpeg's SRT encoder preserves such cue text, and real timings.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Per-cue cap)**: `parseSrt` truncates each cue's text to a named maximum (proposed
      2,000 characters, far above any real cue); truncation is silent and keeps the cue so timing-
      based rules (C3 containment) are unaffected.
- [ ] **REQ-2 (Same cap on provider text)**: `subtitle-variant.ts` bounds the file it reads (reject
      or truncate above a named size, proposed 5 MiB, in line with spec 04's stance) and applies
      REQ-1's per-cue limit before the markup strip.
- [ ] **REQ-3 (Linear regexes)**: Where a bound alone is not enough, make the patterns linear: collapse
      `\s*-?\s*` to `[^\S\n]*-?[^\S\n]*` or an anchored form, and keep the negated classes length-
      limited (`[^>]{0,200}`). Verdicts for real subtitles must not change.
      [NEEDS CLARIFICATION: is REQ-1 alone sufficient, making REQ-3 optional?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Err on keeping)**: Any failure or truncation keeps the track, never drops it (memory:
      track selection errs on keeping).
- [ ] **NFR-2 (Event loop)**: No single cue costs more than a few milliseconds on the main thread.

## GraphQL Contract Delta

None.

## Data Model Changes

None. The `111` verdict cache keys are unaffected (the verdict function is unchanged for real input).

## Acceptance Criteria

- [ ] **AC-1 (reproduce first)**: In the worker dev image, `stripMarkup` and `isAnnotated` on a cue of
      1 MiB of `<`, then 1 MiB of `{`, then `"\n" + " ".repeat(1 << 20)`, are timed; today the
      time grows quadratically (seconds or worse) and blocks the loop.
- [ ] **AC-2**: With REQ-1/REQ-3 the same inputs finish in milliseconds and `resolveSubtitlePruning`
      over an mkv with two eng tracks holding such cues returns without stalling lock renewal.
- [ ] **AC-3**: The spec 102 corpus (SDH, same-translation, contained/forced) yields identical
      verdicts, and `annotationShare` on real SRTs is unchanged.
- [ ] **AC-4**: An oversize provider `.srt` is refused or truncated without reading it whole.

## Out of Scope

- Running the analysis in a worker thread (a larger change; revisit if bounds prove insufficient).
- The 32 MiB capture cap itself (`ffmpeg/capture.ts:23`).
- Playlist size bound (spec 23) and subtitle archive entry cap (spec 04, api).

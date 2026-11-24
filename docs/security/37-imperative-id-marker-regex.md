---
title: Keep the Spanish "Id" marker regex on one line and bound the scored sample
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [worker]
source_finding: worker/encode/variant-detectors-imperative-id-cross-line-quadratic
audit_verdict: confirmed
severity: low
priority: 37
---

# SPEC (draft): Keep the Spanish "Id" marker regex on one line and bound the scored sample

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> **confirmed** with overall severity low: a fresh verifier reproduced it in a sandboxed local harness
> (real service code, in-memory fakes for Prisma/Redis/fetch). Line numbers refer to commit `2a3976a`.
> Evidence: `security-audit-skill/perceptor/run-3/agents/v-worker-encode-variant-detectors-imperative-id-cross-line-q/artifacts/evidence/` (`regex-harness.ts`, `regex-growth.log`).
> Sibling of spec 24 (cue-text regex bounds in spec 102's pruning) and spec 36 (another superlinear
> step of the same variant scoring); a shared sample cap serves all three.

## Context & Goal

Spec 118's subtitle variant check (`resolveSubtitlePruning`, `encode/subtitle-prune.ts:140`, only when
`subtitleVariantDetection` is on) extracts up to 900 s of each unresolved text track with one ffmpeg
pass (`:210`), bounded only by the 32 MiB stdout cap (`ffmpeg/capture.ts:23`). `sampleText` joins
`normalizeCueText` of every cue with `"\n"` (`subtitle-prune.ts:127-128`); `normalizeCueText`
(`ffmpeg/subtitle-content.ts:75`) keeps punctuation-only cues. The texts go to `decide` (pair,
`:257`) or `decideAbsolute` (lone track, `:269`), both of which call `score()`
(`encode/variant-score.ts:49`). `score` builds `dedupeLinesCased` (`:29`), which drops only
case-insensitive duplicate lines, and `count` (`:43`) runs every `casedStrongA` pattern over the
whole text.

The Spanish detector's only `casedStrongA` pattern is `IMPERATIVE_ID`
(`encode/variant-detectors.ts:10-13`, registered at `:87`):
`(?:^[-–—\s¿¡"]*Id|<START>id)<END>` with flags `gmu`. Under `m`, `^` matches at
every line start, and `\s` also matches `\n`, so from each line start the class run continues
through every following line made only of `-`, dashes, quotes, `¿`, `¡` and whitespace, then fails
and restarts at the next line: O(n²) in the number of such lines.

The verifier ran the real `normalizeCueText` and `score()` on distinct punctuation-only cues:
2,000 cues 433 ms, 4,000 1,960 ms, 8,000 7,455 ms, 16,000 (about 340 KB) 31.6 s, about 4x per
doubling. It runs synchronously on the worker's single event loop, which also serves every encode,
BullMQ lock renewal and progress report. The attacker is whoever controls subtitle text in a
release a user downloads; the user must have the Spanish variant preference on and the file must
hold a Spanish text track needing a verdict.

Goal: the marker matches only within one line, and the text any marker regex sees is bounded.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Line-local class)**: The leading class of `IMPERATIVE_ID` excludes newline, for example
      `[-–—¿¡"]` plus `[^\S\n]` instead of `\s`, so a match attempt never crosses a
      line boundary. The `\b`-like `START`/`END` guards and the `Id` / `id` alternatives are unchanged.
- [ ] **REQ-2 (Sample cap)**: The text passed to `score`/`scoreRate`/`decide`/`decideAbsolute` from
      `sampleText` is truncated to a named maximum (proposed 256 KiB, or a cue count). [NEEDS
      CLARIFICATION: cap in `sampleText` only, or inside `score()` so the audio (whisper) path of spec
      110 shares it? Spec 36 needs the same decision.]
- [ ] **REQ-3 (Same verdicts)**: For real subtitles the score and the stored `subtitle-variant`
      verdict (spec 111) are unchanged; truncation only ever reduces evidence, which leads to
      "undecided", never a forced tag.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Err on keeping)**: A truncated or failed analysis keeps both tracks as plain `Español`,
      as today's "undecided" does.
- [ ] **NFR-2 (Event loop)**: Scoring a capped sample takes no more than a few hundred milliseconds
      on the worker's main thread, whatever its content.

## GraphQL Contract Delta

None.

## Data Model Changes

None. The spec 111 verdict cache keys are unchanged; a cached verdict stays valid.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: Run the verifier's `regex-harness.ts` (or an equivalent vitest case)
      in the worker dev image: `score(sampleOf(n distinct punctuation-only cues), spanish.markers)` for
      n = 2,000/4,000/8,000/16,000 grows about 4x per doubling (16,000 cues over 30 s today).
- [ ] **AC-2**: After REQ-1 the same inputs grow linearly and 16,000 cues finish in well under one
      second; `count(text, [IMPERATIVE_ID])` still matches `"- Id"`, `"¿Id a casa?"`, `"¡Id!"` and
      still ignores `"Ida"` and mid-line `"Id"`.
- [ ] **AC-3**: The existing `audio-variant-score.spec.ts` cases (including the `¿Queréis? ¡Vale!`
      and duplicate-line ones) pass unchanged.
- [ ] **AC-4**: With REQ-2, a 32 MiB punctuation-only sample is truncated before scoring and the
      track ends undecided.

## Out of Scope

- Cue-text regexes of spec 102 pruning (`MARKUP`, `BRACKETED`, `SPEAKER_LABEL`) — spec 24.
- The superlinear similarity step of the audio variant score — spec 36.
- The provider-download variant check (`subtitles/subtitle-variant.ts`) — spec 38.
- Moving the analysis to a worker thread.

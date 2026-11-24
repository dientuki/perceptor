---
title: Bound the provider subtitle text and its tag-stripping regexes in the variant check
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [worker]
source_finding: worker/subtitles/subtitle-variant-cuetext-quadratic-tag-regex
audit_verdict: confirmed
severity: low
priority: 38
---

# SPEC (draft): Bound the provider subtitle text and its tag-stripping regexes in the variant check

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> **confirmed** with overall severity low: a fresh verifier reproduced it in a sandboxed local harness
> (real service code, in-memory fakes for Prisma/Redis/fetch). Line numbers refer to commit `2a3976a`.
> Evidence: `security-audit-skill/perceptor/run-3/agents/v-worker-subtitles-subtitle-variant-cuetext-quadratic-tag-re/artifacts/evidence/` (`repro.ts`, `repro.log`).
> Confirms and narrows spec 24 REQ-2 (same line, then `needs_validation`); implementing either closes
> both. The scoring that follows the strip shares spec 37's regex.

## Context & Goal

Spec 118's subtitle search checks the variant of each downloaded candidate before measuring sync:
`handleSubtitleSync` calls `detectDownloadedVariant(details.candidatePath, …)` whenever
`variantDetectionIso3` is set (`jobs/subtitle-sync.job.ts:44-46`). The candidate is a file a
provider (OpenSubtitles or Subdivx) supplied, staged by `api`; the only upstream bound is the
20 MB archive limit (`api` `subtitle-search/archive.ts:5`).

`detectDownloadedVariant` reads the whole file with `readFile` (`subtitles/subtitle-variant.ts:26`),
decodes it and passes it to `cueText` (`:31`). `cueText` (`:10-19`) drops timing and index lines,
rejoins the rest and runs `.replace(/<[^>]*>/g, '')` (`:17`) and `.replace(/\{\\[^}]*\}/g, '')`
(`:18`) over the whole text. On one long line of `<` with no `>`, each `<` starts a scan to the end
of the text that fails: O(n²). The line filter does not split a single long line and there is no
size or per-line cap. The result then goes to `scoreRate`/`decideAbsolute` (`:32-33`).

The verifier wrote a valid SRT cue header followed by one line of N `<` and called the real
`detectDownloadedVariant(path, 'spa')`: N = 20,000 took 1,129 ms, 40,000 4,142 ms, 80,000 15,452 ms
(about 4x per doubling), verdict `null`. A file near the 20 MB bound would block the worker's single
event loop (every encode, BullMQ lock renewal and progress report) far longer. The attacker needs
only a provider account; a user must have the Spanish variant preference on and the candidate must
rank in the top three. The job's `SYNC_TIMEOUT_MS` abort (`subtitle-sync.job.ts:39-40`) cannot fire
while the regex runs synchronously.

Goal: the variant check reads a bounded amount of text and strips markup in linear time.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Read cap)**: `detectDownloadedVariant` analyses at most a named number of bytes of the
      candidate (proposed 256 KiB, enough for a feature-length SRT's dialogue sample), truncating or
      returning undecided above it. [NEEDS CLARIFICATION: truncate and score, or skip the check and
      treat the candidate as undecided? Spec 24 REQ-2 proposed 5 MiB with "reject or truncate".]
- [ ] **REQ-2 (Linear strip)**: The two strip patterns cannot cross a newline or run unbounded, for
      example `/<[^>\n]{0,200}>/g` and `/\{\\[^}\n]{0,200}\}/g`. Real `<i>`, `<font …>` and `{\an8}`
      tags are still removed.
- [ ] **REQ-3 (Same verdicts)**: For real provider subtitles `scoreRate` and the decided tag are
      unchanged.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Silent failure kept)**: An oversize or unreadable candidate keeps today's behaviour for
      a failed check: no variant reported, sync measured as before, no new error key.
- [ ] **NFR-2 (Event loop)**: The variant check never holds the worker's main thread for more than a
      few hundred milliseconds, whatever the candidate's content.

## GraphQL Contract Delta

None. `subtitleSyncCompleted`'s `variantTag` stays nullable with the same meaning.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: Run the verifier's `repro.ts` (or an equivalent vitest case) in the
      worker dev image: an SRT with one cue line of 20,000/40,000/80,000 `<` and no `>` grows about 4x
      per doubling (80,000 over 15 s today).
- [ ] **AC-2**: After the fix the same inputs, and a 20 MB file of `<`, finish in under one second
      and return `null`.
- [ ] **AC-3**: A file of repeated `{\` with no `}` is likewise linear.
- [ ] **AC-4**: The spec 118 corpus of real Spain and Latin American subtitles yields the same rate
      and verdict as before.

## Out of Scope

- The `IMPERATIVE_ID` marker run inside `scoreRate` on the same text — spec 37 (REQ-1 here bounds
  its input too).
- Cue regexes of spec 102 pruning over embedded tracks — spec 24.
- The archive size limit in `api` — spec 04 and spec 18.

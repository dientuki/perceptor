---
title: Worker Language Variant Selection — Tasks
last_updated: 2026-08-28
status: Done
---

# TASKS: Worker Language Variant Selection (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[ffmpeg]` | The fifth agent (`.claude/agents/ffmpeg.md`). It owns `services/worker/src/ffmpeg/` and `services/worker/ffmpeg/` — the track-selection rules and the case corpus — which the `worker` agent is explicitly forbidden to write in. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**Why `[ffmpeg]` exists as a tag here.** This feature touches one service and two agents. Dispatching
the rule tasks as `[worker]` would send them to an agent whose brief says, of exactly these two
directories, "do not edit them — stop and report". The tag is the dispatch address, so it has to be
the real owner. No `[api]`, `[web]` or `[infra]` task exists in this feature, and that is load-bearing
rather than an oversight: NFR-1 requires `services/api/` and `services/web/` to come out unchanged,
and T010 verifies it.

**Nothing in this feature is parallel except the two documentation tasks.** Every rule task edits
`params.ts`, and the payload seam has to land before any of them.

## Tasks

### Group 1 — the baseline

- [x] **T001** `[ffmpeg]` Run `bin/npm worker test` and `bin/cli worker npx --no tsc --noEmit`
      against the working tree untouched. Record the real suite/test counts, how many corpus cases
      ran, and **exactly** how `services/worker/ffmpeg/1.json` fails. Edit nothing.
      *Done when:* the report names the counts and quotes the argument the corpus case disagrees on
      (expected `title=English Surround 5.1 (Opus)`, produced `title=Surround 5.1 (Opus)`). A red
      corpus here is the intended starting state, not a breakage — see `worker/plan.md` § Steps 4.

### Group 2 — the payload seam

- [x] **T002** `[worker]` The four edits that carry `allowedLanguageTags` from the wire to the driver,
      as **one** task (`worker/plan.md` § Steps 1–3, and the top row of `plan.md` § Risks — three of
      the four done without the fourth is the feature silently doing nothing):
      `src/encode/types.ts` gains `allowedLanguageTags: string[]`, non-optional;
      `src/jobs/encode.job.ts` gains it in the `processJob` selection set, in the `EncodeJobDetails`
      type, in the existing `[encode] <id>:` log line, and in the `EncodeInput` literal as
      `details.allowedLanguageTags ?? []`. Add the two cases to `src/jobs/encode.job.spec.ts`: the
      field reaches the `encode()` call, and a `processJob` that comes back without it still encodes
      with the driver receiving `[]`. → T001
      *Done when:* `bin/npm worker test -- src/jobs/encode.job.spec.ts` is green **(AC-7, payload
      half)**. `tsc --noEmit` is expected to be **red** on `src/ffmpeg/`'s fixtures until T004 —
      report it as such and do not make the field optional to silence it.

### Group 3 — the rules

Everything here is `[ffmpeg]` and everything here is sequential: T004 through T007 all edit
`src/ffmpeg/params.ts`.

- [x] **T003** `[ffmpeg]` Create `src/ffmpeg/variants.ts` and `src/ffmpeg/variants.spec.ts`
      (`worker/plan.md` § Steps 5). **Move** `LATIN_AMERICAN_MARKERS` and `isLatinAmericanSpanish`
      out of `params.ts` — no second copy stays behind — add the Castilian vocabulary already
      recorded in `.claude/agents/ffmpeg.md` § L1 (`españa`, `spain`, `castellano`, `EU`, `es-ES`),
      and expose the three named functions: which requested variants belong to an `iso3`, which
      variant a stream is (unconditional, by title, through `titleMarks`), and the narrowing step
      built on `preferring`. Nothing consumes the new functions yet. → T002
      *Done when:* `bin/npm worker test` fails **identically to the T001 baseline** — the extraction
      changed no behaviour — and `variants.spec.ts` covers a Castilian marker not matching inside an
      unrelated word (mirroring the existing `la` case) and an unresolvable requested tag logging a
      warning and degrading to "no variant requested" rather than throwing (`plan.md` § Risks, row 2).

- [x] **T004** `[ffmpeg]` Thread the field through the seam: `src/ffmpeg/buildCommand.ts` passes
      `details.allowedLanguageTags` into `getAudioParams` and `getSubtitleParams`;
      `src/ffmpeg/cases.spec.ts`'s `CaseInput` and `validate()` accept `allowedLanguageTags` —
      optional, rejected when present and not an array of strings — and pass it through; the
      `EncodeInput` fixtures in `buildCommand.spec.ts` gain the field, and its existing forwarding
      test grows a tags assertion. No rule changes in this task. → T003
      *Done when:* `bin/cli worker npx --no tsc --noEmit` is **clean** — this is the task that closes
      the red window T002 opened — and the suite still fails only on the T001 corpus disagreement.

- [x] **T005** `[ffmpeg]` The audio selection rules in `getAudioParams` (REQ-4, REQ-5, REQ-6, REQ-9,
      REQ-10, REQ-11), with the `params.spec.ts` cases that prove each — a rule change with no case
      behind it is not done (`.claude/agents/ffmpeg.md`). Narrowing runs **after** the existing
      commentary/SDH blacklist and the per-language grouping; the mandatory-original check keeps its
      current position and its key. The existing case *"picks the Latino-titled Spanish track over
      another Spanish track"* asserts what REQ-6 removes: rewrite it into two, one with `es-419`
      requested and one with no tags. Do not delete it. → T004
      *Done when:* `bin/npm worker test -- src/ffmpeg/params.spec.ts` is green and covers
      **AC-1, AC-2, AC-4, AC-5, AC-6, AC-8**, the mapping half of **AC-3** (both variants requested
      and present → two `-map`s), and the rules half of **AC-7** (an empty tag list behaves as "no
      variant requested").

- [x] **T006** `[ffmpeg]` The subtitle selection rules in `getSubtitleParams` (REQ-4, REQ-5, REQ-15,
      REQ-17), with their `params.spec.ts` cases. The SDH `preferring` call stays exactly where it is
      and runs **before** narrowing; narrowing replaces today's unconditional
      `preferring(langStreams, not latin american)`; everything that survives is emitted, never
      reduced to one. → T005
      *Done when:* `bin/npm worker test -- src/ffmpeg/params.spec.ts` is green and covers
      **AC-10, AC-11, AC-12, AC-13**, and the selection half of **AC-9** (the `Castellano` SRT kept,
      the `Latino` one dropped).

- [x] **T007** `[ffmpeg]` One track-title resolver, two callers (REQ-12, REQ-18 —
      `worker/plan.md` § Steps 8). Promote `subtitleTitle` and its `languageTitles` table to a named
      shared function, give it the Castilian row `Español (España)`, and prefix the audio layout with
      what it returns. Keep the `?? lang` fallback exactly as it is: **do not extend the table by
      guessing** — an uncovered language is a question for the user
      (`.claude/agents/ffmpeg.md` § L2). → T006
      *Done when:* `bin/npm worker test -- src/ffmpeg/cases.spec.ts` is green, reports **one** case
      run and names it **(AC-0)** — this is the task that turns `1.json` from red to green — and
      `params.spec.ts` covers **AC-3b** and the title halves of **AC-3** and **AC-9**. If `1.json`
      still fails once the rules look right, that is a rule conflict: **stop and report it with the
      case named**. Do not edit the case (NFR-6).

### Group 4 — verification and docs

- [x] **T008** `[docs] [P]` Update `.claude/agents/ffmpeg.md` § Rules from the `[ffmpeg]` reports —
      **A3** (one track per language becomes one per matched variant), **A4** and **S5** (the Latin
      American preference becomes request-driven, with the keep-everything fallback), **L1** (the
      vocabulary is what selection reads, no longer a hard-coded default), **L2** (the table gains
      `Español (España)`, and audio titles now resolve through it too). This is the rule document:
      left stale, the next agent reads it and "restores" the behaviour REQ-6 removed. → T007

- [x] **T009** `[docs] [P]` Update `services/worker/CLAUDE.md` § "Audio/subtitle/quality rules read a
      resolved list, never guess" (the third payload field, the two-agent split of `src/ffmpeg/`,
      and the refreshed test counts from T007), and the one sentence in
      `docs/spec/graphql-contract.md` that still says the worker does not read `allowedLanguageTags`
      and that teaching it to is left to a follow-up spec. The **root** `CLAUDE.md` needs no change:
      no pipeline stage changed status. → T007

- [x] **T010** `[docs]` Walk the acceptance criteria in `spec.md`, tick each box against the real
      command output, and set `status: Implemented` on `spec.md`, `plan.md` and `worker/plan.md`.
      Confirm **AC-14** here: `bin/npm worker test` green with the real counts against the T001
      baseline, `bin/cli worker npx --no tsc --noEmit` clean, and
      `git status --short services/api services/web` printing nothing (NFR-1). → T008, T009

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems land here (Constitution, Article VIII). So does a corpus conflict: `1.json` is
authored by the user and is the requirement, so an agent that believes the case is wrong stops and
reports rather than editing it (NFR-6).

---
title: Worker Language Variant Selection — worker slice
service: worker
last_updated: 2026-08-28
status: Implemented
---

# PLAN: Worker Language Variant Selection — `worker` (`worker/plan.md`)

## Scope

This feature is entirely inside `services/worker/`. `api` and `web` are untouched — the payload field
this slice starts reading has been shipping since `030-language-regional-variants` and needs nothing
new from either.

**Read this before picking up any task: the service has two owners and this plan spans both.**

| Owner | Writes in | Steps |
| :-- | :-- | :-- |
| `worker` agent (`.claude/agents/worker.md`) | everything under `services/worker/` **except** the two directories below | 1–3 |
| `ffmpeg` agent (`.claude/agents/ffmpeg.md`) | `services/worker/src/ffmpeg/` and `services/worker/ffmpeg/` | 4–10 |
| orchestrator | `.claude/agents/ffmpeg.md`, `services/worker/CLAUDE.md`, `docs/spec/graphql-contract.md` | 11 |

The `worker` agent reads `src/ffmpeg/` — it must, to know what `buildFfmpegCommand` expects — and
does not write there. The `ffmpeg` agent reads `src/encode/types.ts` and does not write there. An
agent that finds itself needing to edit the other's file **stops and reports**; that is a missing
task in `tasks.md`, not something to fix in passing.

Neither agent touches `src/queue/types.ts`. The job payload is unchanged: everything this feature
needs is already on the `processJob` GraphQL query.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/jobs/encode.job.ts` | Modified | `allowedLanguageTags` added to the `processJob` selection set, to the `EncodeJobDetails` type, to the log line, and to the `EncodeInput` literal with the `?? []` normalization |
| `services/worker/src/encode/types.ts` | Modified | `allowedLanguageTags: string[]` added to `EncodeInput`, non-optional |
| `services/worker/src/jobs/encode.job.spec.ts` | Modified | fixture gains the field; a case asserts it reaches `encode()`, and a case asserts a payload without it still encodes |
| `services/worker/src/ffmpeg/variants.ts` | **New** | the tag vocabulary and the three named functions the rules call |
| `services/worker/src/ffmpeg/variants.spec.ts` | **New** | the vocabulary and the detection predicate, in isolation |
| `services/worker/src/ffmpeg/params.ts` | Modified | `getAudioParams`/`getSubtitleParams` take the tag list; `LATIN_AMERICAN_MARKERS` and `isLatinAmericanSpanish` move out to `variants.ts`; `subtitleTitle` becomes the shared track-title resolver both call; REQ-4/5/6/9/12/18 |
| `services/worker/src/ffmpeg/buildCommand.ts` | Modified | passes `details.allowedLanguageTags` into both rule functions |
| `services/worker/src/ffmpeg/params.spec.ts` | Modified | the synthetic cases for AC-1 … AC-8, AC-10 … AC-13; the existing unconditional-Latino case is rewritten, not deleted |
| `services/worker/src/ffmpeg/buildCommand.spec.ts` | Modified | fixtures gain the field; the existing forwarding test grows a tags assertion |
| `services/worker/src/ffmpeg/cases.spec.ts` | Modified | `CaseInput` gains `allowedLanguageTags`, optional and validated like the sibling list, and passed through to `buildFfmpegCommand` |
| `services/worker/ffmpeg/1.json` | **Read-only** | the corpus's only case, authored by the user and already carrying `allowedLanguageTags: ["en", "es-419"]` and the expected audio title. **Not edited by anyone in this feature** (NFR-6) — it is red today and the rules are what must move |

A new module beyond `variants.ts` means the plan missed something — report it rather than adding one.

## Existing code to reuse

- `services/worker/src/ffmpeg/iso639.ts` — `normalizeIso3` is the only language comparison in this
  service, applied to **both** sides. `variants.ts` calls it; it does not grow a second normalizer.
- `services/worker/src/ffmpeg/params.ts`'s `titleWords(stream)` and `titleMarks(stream, markers)` —
  the word-boundary title matcher. Both variant vocabularies go through it. Never
  `title.includes(marker)` on the raw string: that is how the `LA` spelling was missed for a year,
  and `params.spec.ts` has a case pinning it.
- `services/worker/src/ffmpeg/params.ts`'s `preferring(streams, isWorse)` — "drop the worse ones,
  keep everything if that would empty the set". This is REQ-5's exact shape as well as the SDH rule's,
  and the narrowing function should be built on it rather than beside it.
- `services/worker/src/ffmpeg/params.ts`'s existing audio sort (codec priority → channels → bitrate)
  and its `selectedStreams.some(s => s.index === best.index)` dedupe guard — both survive verbatim;
  the sort now runs per matched variant instead of per language.
- `services/worker/src/ffmpeg/cases.spec.ts` — the corpus runner, its `validate()` gate and its
  `ENCODE_SAMPLE_SECONDS` clearing. It is extended for the new optional input field and for nothing
  else; the runner's existing guarantees (a malformed case fails collection by name, an empty
  directory is an error rather than a vacuous pass) are what make a one-case corpus safe.
- `services/worker/src/ffmpeg/params.spec.ts`'s `audioStream()` / `subtitleStream()` factories — every
  synthetic case uses them.
- `services/worker/src/ffmpeg/params.ts`'s `subtitleTitle` and its `languageTitles` table — promoted
  to the shared resolver of REQ-12/REQ-18, including its `?? lang` fallback. The audio side calls it
  rather than growing a second table (Article X); this is the L2 table of `.claude/agents/ffmpeg.md`
  and there must be exactly one of it.
- `services/worker/src/jobs/encode.job.ts`'s existing `console.log` of `allowedLanguagesIso3` — the
  tags go on that line, not on a new one.

## Steps

### `worker` agent — the payload seam

1. `src/encode/types.ts`: add `allowedLanguageTags: string[]` to `EncodeInput`. **Non-optional on
   purpose** — the same reasoning that makes `onProbe` a required parameter (`services/worker/CLAUDE.md`
   § The encode driver seam): an optional field a call site forgets compiles clean and silently
   disables the feature forever.
2. `src/jobs/encode.job.ts`: add `allowedLanguageTags` to the `processJob` selection set **and** to
   the `EncodeJobDetails` type — one without the other is the top row of `../plan.md` § Risks. Then
   add it to the `EncodeInput` literal passed to `encode(...)` as
   `details.allowedLanguageTags ?? []`, and extend the existing `[encode] <id>:` log line to print it.
   This `?? []` is the **only** defensive normalization in the feature (NFR-2); the rule functions
   below receive a real array and do not re-guard.
3. `src/jobs/encode.job.spec.ts`: extend the fixture, assert the field arrives at the `encode()` call,
   and add one case where `processJob` comes back without it — the encode must still complete, with
   the driver receiving `[]`.

At this point `bin/cli worker npx --no tsc --noEmit` is **red**, and not for the reason it looks like:
`buildFfmpegCommand` takes `EncodeInput` and an added field is additive to it, so the production path
compiles fine. What breaks is every fixture that *constructs* an `EncodeInput` — `buildCommand.spec.ts`
and `cases.spec.ts` — and both live in `src/ffmpeg/`, which this agent must not edit. The window
closes in step 6, in the other agent's hands. Report the typecheck as red with that reason; do not
"fix" it by making the field optional, which is the one change that would silently disable the
feature forever.

### `ffmpeg` agent — the rules

4. **Baseline first.** Run `bin/npm worker test` and record the real suite/test counts, the number of
   corpus cases that ran, and — precisely — how `1.json` fails. Nothing is edited in this step.
   **The corpus is red at baseline and that is the intended starting state**, which inverts the usual
   reading of `.claude/agents/ffmpeg.md`'s "corpus green → refactor → corpus still green → then the
   rule": here the case was written first, by the user, and the rule is what must move to meet it. The
   sequencing rule still binds inside step 5 — the `variants.ts` extraction is a pure move and must
   not change *how* `1.json` fails.
5. Create `src/ffmpeg/variants.ts`. Move `LATIN_AMERICAN_MARKERS` and `isLatinAmericanSpanish` here
   from `params.ts` (move, not copy — `params.ts` keeps no second copy) and add the Castilian
   vocabulary already recorded in `.claude/agents/ffmpeg.md` § L1: `españa`, `spain`, `castellano`,
   `EU`, `es-ES`. The module exposes, with names:
   - the tag table — `es-419` and `es-ES`, each with its `iso3` (`spa`) and its markers;
   - "which requested variants belong to this `iso3`", given the tag list — normalizing through
     `normalizeIso3`, and `console.warn`ing once for a requested tag carrying a region subtag the
     table cannot resolve (`../plan.md` § Risks, row 2);
   - "which variant is this stream", by title, through `titleMarks` — **unconditional**, it does not
     take the request into account (REQ-3), because the output title depends on it;
   - the narrowing step: given a language's surviving streams and the requested variants, return
     either the streams matching a requested variant, grouped by tag, or — when none match — every
     stream, ungrouped (REQ-5). Build it on `preferring`'s "keep everything rather than empty the
     set" logic rather than reimplementing that decision.
   Run the corpus. It must still be green: nothing has changed behaviour yet.
6. `src/ffmpeg/buildCommand.ts`: pass `details.allowedLanguageTags` into `getAudioParams` and
   `getSubtitleParams`. Typecheck now passes end to end.
7. `getAudioParams` (REQ-4, REQ-6, REQ-9, REQ-10, REQ-11, REQ-12): after the existing blacklist filter
   and per-language grouping, narrow. With requested variants and at least one match, rank and take
   **one per matched tag**; with requested variants and no match, keep every candidate of that
   language; with no requested variants, today's single best. The mandatory-original check
   (REQ-7/`ERROR_ENCODE_NO_ORIGINAL_AUDIO`) keeps its current position and its key.
8. The track title becomes **one resolver with two callers** (REQ-12, REQ-18). Today `subtitleTitle`
   owns the `languageTitles` table and the Latino/Español branch while the audio side writes a
   language-less `Surround 5.1 (Opus)`; promote that resolver to a named function both rule functions
   call, give it the Castilian row `Español (España)`, and prefix the audio layout with what it
   returns — `English Surround 5.1 (Opus)`, `Latino Surround 5.1 (Opus)`,
   `Español (España) Stereo (Opus)`. The existing `languageTitles[lang] ?? lang` fallback is kept
   as-is for a language the table does not cover; **do not extend the table by guessing** — that is a
   question for the user (`.claude/agents/ffmpeg.md` § L2). This is the half of `1.json` that is red
   today. In `getSubtitleParams` (REQ-4, REQ-5, REQ-15, REQ-17): the SDH `preferring` call stays
   exactly where it is and runs **before** narrowing; narrowing replaces today's unconditional
   `preferring(langStreams, not latin american)`; everything that survives is emitted, subtitles are
   never reduced to one.
9. `src/ffmpeg/params.spec.ts` and `variants.spec.ts`: the synthetic cases for AC-1, AC-2, AC-3, AC-4,
   AC-5, AC-6, AC-7, AC-8, AC-10, AC-11, AC-12, AC-13, plus the unknown-tag degradation from
   `../plan.md` § Risks and a word-boundary case for the Castilian markers mirroring the existing
   `la`-inside-a-word one. The existing case *"picks the Latino-titled Spanish track over another
   Spanish track"* asserts the behaviour REQ-6 removes: rewrite it into two — one with `es-419`
   requested (still picks Latino, now for the right reason) and one with no tags (picks the
   quality-ranked track). Do not delete it.
10. The corpus: `cases.spec.ts`'s `CaseInput` and `validate()` accept `allowedLanguageTags` — optional,
    rejected when present and not an array of strings, exactly like `allowedLanguagesIso3` — and the
    case is passed through to `buildFfmpegCommand`. That is the **only** edit this feature makes on
    the corpus side. `1.json` is the user's file and the requirement: it already carries its tags and
    its expected argument array, it is red today on the audio title, and it goes green when steps 7
    and 8 are right. **Do not edit it, do not add a case, do not manufacture an `ffprobe` payload**
    (NFR-3, NFR-6). The corpus grows when the user brings a real file that came out wrong; anything a
    real file does not demonstrate stays in `params.spec.ts`. If `1.json` still fails once the rules
    look right, that is a rule conflict — **stop and report it with the case named**, never adjust
    the case.

### Orchestrator

11. Documentation, from the agents' reports:
    - `.claude/agents/ffmpeg.md` § Rules — **A3** (one track per language becomes one per matched
      variant), **A4** and **S5** (the Latin American preference becomes request-driven, with the
      keep-everything fallback), **L1** (the vocabulary is now what selection reads, not a hard-coded
      default), **L2** (the title table gains `Español (España)`, and the audio titles gain the variant
      name). This file is the rule document; leaving it stale is how REQ-6 gets "restored" by the next
      agent.
    - `services/worker/CLAUDE.md` § "Audio/subtitle/quality rules read a resolved list, never guess" —
      the third payload field and what reading it changed.
    - `docs/spec/graphql-contract.md` — one sentence, currently reading that the worker does not read
      `allowedLanguageTags` yet and that teaching it to is left to a follow-up spec. That follow-up is
      this feature.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **empty and frozen**: this feature adds no type, field,
argument or error, and it must not. What this service owes is on the consuming side, and it is the
part with no compiler behind it:

- `EncodeJobDetails.allowedLanguageTags: [String!]!` — non-null list of BCP-47 tags, produced by the
  same merge as `allowedLanguagesIso3` (original first, deduplicated). It is hand-retyped in
  `src/jobs/encode.job.ts` and hand-selected in the query string; miss either and it arrives
  `undefined`.
- `EncodeJobDetails.allowedLanguagesIso3: [String!]!` — unchanged, still the only list compared
  against `ffprobe`'s `tags.language`. **Never narrowed, never replaced by the tags.**
- `EncodeJobDetails.originalLanguageIso3: String!` — unchanged, still the mandatory audio language,
  still read as its own field rather than inferred from the allow-list's first element.
- The error side: `ERROR_ENCODE_NO_ORIGINAL_AUDIO` keeps its key, its `iso3` param and its trigger.
  A requested variant that matches nothing, a requested language with no track, and a file with no
  surviving subtitle are **not** errors — they log and continue, exactly as today.

If a rule turns out to need the tag→`iso3` association from the server rather than from
`variants.ts`, that is a contract change: **stop and report**. Do not add a field, do not query
anything else, do not read an env var (Constitution, Articles II, III and VIII).

## Tests

Everything this feature changes fails silently — FFmpeg exits 0, the `ProcessJob` reports
`COMPLETED`, and the file lands in the library with the wrong Spanish track. Article IX applies to all
of it, and the two mechanisms already exist:

- `src/ffmpeg/params.spec.ts` — the synthetic cases. Defends against a rule applied in the wrong
  order (an SDH or commentary track winning a variant match), a variant preference silently lost when
  no tag was requested, and a requested variant that matches nothing throwing away every Spanish track
  instead of keeping them.
- `src/ffmpeg/variants.spec.ts` — defends against the vocabulary itself: a marker matched as a
  substring of an unrelated word, and a requested tag the table cannot resolve being read as "no
  preference" without a word in any log.
- `services/worker/ffmpeg/1.json` — the one real file, and the only thing that catches a stream shape
  no factory would have thought to build. Not written by this feature; satisfied by it.
- `src/jobs/encode.job.spec.ts` — defends the payload seam: the field reaching the driver, and a
  payload without it still producing a completed encode rather than a throw.
- `src/ffmpeg/buildCommand.spec.ts` — defends the wiring between them, which is one argument in one
  call and is exactly the kind of thing that gets dropped in a refactor with no test noticing.

Nothing here is owed a test that is not listed. `variants.ts`'s table is data, not logic, and is
covered through the predicates that read it.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/npm worker test -- src/ffmpeg/cases.spec.ts
git status --short services/api services/web
```

Typecheck clean. The full suite green, with the **real** counts reported against the step-4 baseline
— more tests than before, no suite lost. The corpus naming every case it ran; "zero cases ran" means
something broke, never a pass. `git status` on `api` and `web` prints nothing.

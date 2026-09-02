---
title: Per-Title Audio/Subtitle Language Split — worker slice
service: worker
last_updated: 2026-09-02
status: Implemented
---

# PLAN: Per-Title Audio/Subtitle Language Split — `worker` (`worker/plan.md`)

## Scope

The worker stops carrying one allow-list and starts carrying two: it selects four fields from
`processJob` instead of two, retypes them in both places that hand-retype the payload, and hands the
audio pair to `getAudioParams` and the subtitle pair to `getSubtitleParams`.

It does **not** change any selection rule. `getAudioParams`/`getSubtitleParams` keep their
signatures, their filtering, their variant handling and their REQ numbering from `011-av1-transcode`
and `031-worker-language-variants` (REQ-6). The mandatory-original-audio failure is untouched
(REQ-7): `originalLanguageIso3` is still its own field and still unrelated to which allow-list
arrives. Nothing here decides *what* goes in either list — that is `api`'s merge.

**The `0.2.0` *Audio mandatory* flag does not exist as far as this service is concerned** (REQ-11).
It is not on `EncodeJobDetails`, not in the `processJob` selection set, and not in `EncodeInput`. If a
report or a review suggests adding it, that is a contract change — stop and report. AC-14 verifies it
by `grep -rn "audioMandatory" services/worker/` returning nothing.

**Two agents share this slice.** `services/worker/src/ffmpeg/` and `services/worker/ffmpeg/` belong
to the `ffmpeg` agent (`.claude/agents/ffmpeg.md`); the `worker` agent must not edit them. Steps 1–3
below are `worker` work; steps 4–6 are `ffmpeg` work and are tagged as such in `tasks.md`. `worker`
goes first — `EncodeInput` is what `buildCommand.ts` reads.

Writes are confined to `services/worker/` (minus the two directories above, for the `worker` agent)
and this directory.

## Files

| File | New / Modified | Owner | What changes |
| :-- | :-- | :-- | :-- |
| `services/worker/src/jobs/encode.job.ts` | Modified | `worker` | The GraphQL selection set, the `EncodeJobDetails` type, the `[encode]` log line, and the two driver call sites |
| `services/worker/src/encode/types.ts` | Modified | `worker` | `EncodeInput`'s two list fields become four |
| `services/worker/src/jobs/encode.job.spec.ts` | Modified | `worker` | The payload-seam suite covers all four names |
| `services/worker/src/ffmpeg/buildCommand.ts` | Modified | `ffmpeg` | Audio pair → `getAudioParams`, subtitle pair → `getSubtitleParams` |
| `services/worker/src/ffmpeg/buildCommand.spec.ts` | Modified | `ffmpeg` | Disjoint-list case proving each pair reaches only its own arguments |
| `services/worker/src/ffmpeg/cases.spec.ts` | Modified | `ffmpeg` | `CaseInput` and `validate()` take the four field names |
| `services/worker/ffmpeg/1.json`, `2.json` | Modified | `ffmpeg` | `input`'s two list keys renamed to four |
| `services/worker/CLAUDE.md` | Modified | `worker` | § "Audio/subtitle/quality rules read a resolved list, never guess" |

`services/worker/src/ffmpeg/params.ts` is **not** in this table. If a step seems to need it changed,
the plan is wrong — stop and report.

## Existing code to reuse

- `services/worker/src/ffmpeg/params.ts` — read it, do not edit it. `getAudioParams(streams,
  allowedIso3, originalIso3, allowedTags)` and `getSubtitleParams(streams, allowedIso3, allowedTags)`
  already take their allow-list as parameters; this feature is only a change of argument.
- `services/worker/src/ffmpeg/iso639.ts` and `variants.ts` — unchanged. Both lists still normalize
  through `normalizeIso3` inside `params.ts`, and the tag lists are still consumed by
  `requestedVariants`. Nothing about the /B-vs-/T problem or the regional-variant vocabulary changes.
- `services/worker/src/jobs/encode.job.ts`'s existing `details.allowedLanguageTags ?? []` — the one
  defensive normalization in this path, per `services/worker/CLAUDE.md`. Keep exactly that pattern
  for both new tag lists, and keep both iso3 lists undefended, so a missing field fails loudly there
  rather than quietly encoding the wrong tracks.
- `services/worker/src/jobs/encode.job.spec.ts`'s "allowedLanguageTags payload seam" suite
  (`031-worker-language-variants`) — the existing shape for proving a hand-retyped field survives the
  GraphQL seam. Extend it rather than writing a parallel suite.
- `services/worker/ffmpeg/*.json` + `cases.spec.ts` — the corpus is the only place a real file's
  `ffprobe` output lives. Adding or changing a case is editing JSON, never transcribing a stream into
  a spec by hand.

## Steps

1. `src/encode/types.ts`: replace `allowedLanguagesIso3`/`allowedLanguageTags` on `EncodeInput` with
   `allowedAudioLanguagesIso3`, `allowedAudioLanguageTags`, `allowedSubtitleLanguagesIso3`,
   `allowedSubtitleLanguageTags` — same names as the GraphQL fields, character for character.
2. `src/jobs/encode.job.ts`: same four names on the local `EncodeJobDetails` type **and** in the
   `processJob { … }` selection set (two separate retypings of the same names — miss either and the
   field arrives `undefined`). Update the `[encode] <id>:` log line to print all four lists; it is how
   a live encode shows whether the seam carries them. Update both driver call sites (`passthrough`
   and `encode`) to pass the four fields, `?? []` on the two tag lists only.
3. `services/worker/CLAUDE.md`: update § "Audio/subtitle/quality rules read a resolved list, never
   guess" — the sentence about one merged list feeding both rule functions is what changes.
4. *(`ffmpeg` agent)* `src/ffmpeg/buildCommand.ts`: pass `details.allowedAudioLanguagesIso3` and
   `details.allowedAudioLanguageTags` to `getAudioParams`, and `details.allowedSubtitleLanguagesIso3`
   / `details.allowedSubtitleLanguageTags` to `getSubtitleParams`. `originalLanguageIso3` keeps its
   position in the audio call. Nothing else in the function changes.
5. *(`ffmpeg` agent)* `src/ffmpeg/cases.spec.ts`: `CaseInput` and `validate()` take the four field
   names — the two iso3 lists required, the two tag lists optional and defaulted to `[]`, mirroring
   how `allowedLanguageTags` is handled today. Rename the keys in `ffmpeg/1.json` and `ffmpeg/2.json`
   to match (`allowedLanguagesIso3` → both `…Audio…` and `…Subtitle…` with the same value, since
   both cases were written when one list served both). No compatibility fallback to the old key
   names: two files is a rename, not a migration.
6. *(`ffmpeg` agent)* `src/ffmpeg/buildCommand.spec.ts`: update the existing fixtures to the four
   fields and add the disjoint-list case described in § Tests.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, read-only. `EncodeJobDetails` now carries:

- `allowedAudioLanguagesIso3: [String!]!` and `allowedSubtitleLanguagesIso3: [String!]!` —
  ISO-639-2/B codes, the only lists compared against `ffprobe`'s `tags.language`. Never empty:
  each contains at least the title's original language.
- `allowedAudioLanguageTags: [String!]!` and `allowedSubtitleLanguageTags: [String!]!` — the same two
  merges expressed in BCP-47, which is the only thing that says *which* regional variant was asked
  for. Not a superset of the iso3 lists and not a replacement for them.
- `originalLanguageIso3: String!` — unchanged, still the one mandatory language for audio.
- `allowedLanguagesIso3` and `allowedLanguageTags` **no longer exist**. Selecting either returns a
  GraphQL validation error at runtime, with nothing to catch it at compile time.

The audio pair and the subtitle pair genuinely differ when a title's owners asked for different
languages per kind. They are equal for every title with no per-title preference — do not let a local
test fixture where they happen to match stand in for the general case.

## Tests

- `services/worker/src/ffmpeg/buildCommand.spec.ts` — **owed**, and the most important test in this
  feature. Both pairs are `string[]`, so passing the audio pair to `getSubtitleParams` compiles,
  FFmpeg exits 0, the `ProcessJob` reports `COMPLETED`, and the file lands in the library with the
  wrong subtitle tracks. Add a case with **disjoint** lists (e.g. audio `['jpn','eng']` / subtitle
  `['spa']`) asserting each list reaches only its own arguments; a fixture where both lists match —
  which is what the existing cases are — passes under the swap and proves nothing. Open the addition
  with the failure it defends against, per Article IX.
- `services/worker/src/jobs/encode.job.spec.ts` — **owed**, extending the existing payload-seam
  suite. The two tag lists are normalized with `?? []`, so a name missed in either retyping arrives
  `undefined`, reads as "no regional preference asked for", and silently drops every variant choice
  from every encode. Assert all four names survive the seam, and keep the existing
  "degrades a missing tag list to `[]` rather than throwing" case for both tag fields.
- `services/worker/src/ffmpeg/params.spec.ts` and the corpus cases — **not owed anything new**. No
  rule changes, so no new case proves a rule. The corpus files change only because their input keys
  are renamed; their expected `ffmpeg` argument arrays must come out **identical**, which is itself
  the regression check that this feature is a no-op for a title with no per-kind split.
- `src/encode/types.ts` — not owed a test: it is a type, and its failure surfaces through the two
  suites above.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
```

0 typecheck errors and no failures — with the corpus cases' expected commands unchanged from before
the feature, and the suite count grown by the two additions above. Plus
`grep -rn "audioMandatory" services/worker/` returning nothing (**AC-14**).

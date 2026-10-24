---
title: Subtitle Content Pruning — worker slice
service: worker
last_updated: 2026-10-24
status: Approved
---

# PLAN: Subtitle Content Pruning — `worker` (`worker/plan.md`)

## Scope

The worker owns the whole feature. On the compression path only, before the encode's FFmpeg starts,
it learns the S1–S5 subtitle candidates of the source, reads a 900 s text sample of every language
that still has more than one text track in **one** FFmpeg pass, decides C1–C3 with pure functions,
and hands the dropped stream indices to `buildFfmpegCommand`. C0 (commentary) is a widening of the
existing candidate filter in `getSubtitleParams`. Nothing is reported to `api`; the passthrough
path (`compression_enabled` off) never reaches any of this.

Ownership inside the service: `src/ffmpeg/` and `services/worker/ffmpeg/` (the case corpus) are the
`ffmpeg` agent's, along with the rule document `.claude/agents/ffmpeg.md`; `src/encode/` is the
`worker` agent's. Writes are confined to `services/worker/`, `.claude/agents/ffmpeg.md` and this
directory.

## Files

| File | New / Modified | Owner | What changes |
| :-- | :-- | :-- | :-- |
| `services/worker/src/ffmpeg/params.ts` | Modified | ffmpeg | S1–S5 extracted into exported `selectSubtitleStreams`; C0 added to its candidate filter; `getSubtitleParams` takes a required `contentDrops: ReadonlySet<number>` and logs C0 drops; `isImageSubtitle` exported |
| `services/worker/src/ffmpeg/subtitle-content.ts` | New | ffmpeg | constants and the pure C1–C3 functions |
| `services/worker/src/ffmpeg/subtitle-content.spec.ts` | New | ffmpeg | Article IX tests below |
| `services/worker/src/ffmpeg/capture.ts` | Modified | ffmpeg | `CaptureOptions.extraOutputs?: number`; `RunResult.outputs?: string[]` |
| `services/worker/src/ffmpeg/buildCommand.ts` | Modified | ffmpeg | `buildFfmpegCommand(..., trimAt, subtitleDrops: ReadonlySet<number>)` passed through to `getSubtitleParams` |
| `services/worker/src/ffmpeg/params.spec.ts`, `buildCommand.spec.ts`, `cases.spec.ts` | Modified | ffmpeg | existing calls gain an empty `new Set()`; new C0 and seam cases |
| `services/worker/ffmpeg/<n>.json` | New | ffmpeg | The Running Man (2025) source `ffprobe` (`ffprobe_logs` row 94) as a C0 case |
| `.claude/agents/ffmpeg.md` | Modified | ffmpeg | C0 recorded beside S1–S3, C1–C3 after S5, under the existing subtitle principle |
| `services/worker/src/encode/subtitle-prune.ts` | New | worker | the extraction and `resolveSubtitlePruning` |
| `services/worker/src/encode/subtitle-prune.spec.ts` | New | worker | Article IX tests below |
| `services/worker/src/encode/encode.ffmpeg.ts` | Modified | worker | awaits `resolveSubtitlePruning` after `resolveStreamEndTrim`, passes the set to `buildFfmpegCommand` |

`src/encode/types.ts` and `src/jobs/encode.job.ts` are **not** modified: `EncodeInput` already
carries `allowedSubtitleFormats`, `allowedSubtitleLanguagesIso3` and `allowedSubtitleLanguageTags`,
and `encode.ffmpeg.ts` is only reached when compressing (spec REQ-12).

## Existing code to reuse

- `getSubtitleParams` (`src/ffmpeg/params.ts`, `070`/`031`/`011`): S1 format, S2 language, S3
  `hasCuePayload`, S4 `isHearingImpaired` via `preferring`, S4b `preferring(…, isImageSubtitle)`, S5
  `requestedVariants`/`narrowToVariants`. Extract it move-only into
  `selectSubtitleStreams(subtitleStreams, allowedFormats, allowedLanguagesIso3, allowedLanguageTags)`
  returning `{ selected, commentary }` — the selected streams in today's order, and the streams C0
  removed. The two `console.log`s ("subtitles disabled", "no subtitle … survived") and the new
  `drop (commentary)` line stay in `getSubtitleParams`, so a second caller does not repeat them
  (the `099` treatment of `selectAudioStreams`'s warning).
- `titleMarks(stream, ['commentary'])` (`src/ffmpeg/variants.ts`) — the word-boundary title matcher;
  C0 is `stream.disposition?.comment === 1 || titleMarks(stream, ['commentary'])`.
- `normalizeIso3` (`src/ffmpeg/iso639.ts`) — group candidates by language on both sides, as every
  rule in `params.ts` already does.
- `stream.tags?.NUMBER_OF_FRAMES` — the exact key `hasCuePayload` reads; the whole-track cue count
  for C2/C3 comes from the same place (absent or non-finite → `undefined`).
- `runFfmpegCapture` (`src/ffmpeg/capture.ts`) — extend; do not write a second spawn helper. Its
  four current callers (`grain-probe.ts`, `dub-trim.ts`, `stream-end-trim.ts`, `src/disc/`) pass no
  `extraOutputs` and must behave exactly as today.
- `src/encode/dub-trim.ts` — the resolver shape to copy: exported constants with `// Spec` locators,
  a module-level verdict `Map` keyed by input path that never caches a failure, a `catch` that
  rethrows only `EncodeCancelledError`.

## Steps

1. **Extract** `selectSubtitleStreams` from `getSubtitleParams` (move-only; `commentary` always
   empty for now). `bin/npm worker test`: `params.spec.ts`, `buildCommand.spec.ts`, `cases.spec.ts`,
   `variants.spec.ts` green and unchanged.
2. **C0**: add the commentary predicate to the candidate filter (dropped before S3 counts anything,
   whatever the number of tracks — spec REQ-2); `getSubtitleParams` logs
   `[subs] <index> drop (commentary)` per dropped stream. Corpus case for The Running Man's source,
   added **with the user** per `.claude/agents/ffmpeg.md` § Adding a case.
3. **Seam**: `getSubtitleParams(..., trackTitles, contentDrops)` filters `selected` by
   `!contentDrops.has(s.index)` before mapping; `buildFfmpegCommand(..., trimAt, subtitleDrops)`
   forwards it. Both parameters **required** (a forgotten argument must fail to compile, not mean
   "no drops"). Existing tests and the corpus runner pass `new Set()`.
4. **`src/ffmpeg/subtitle-content.ts`**, pure, each export with its locator:
   - constants: `SUBTITLE_SAMPLE_SECONDS = 900`, `SDH_SHARE_THRESHOLD = 0.1`,
     `SAME_TRANSLATION_START_TOLERANCE_SECONDS = 0.25`, `SAME_TRANSLATION_TEXT_SHARE = 0.95`,
     `CONTAINED_MIN_SAMPLED_CUES = 3`, `CONTAINED_MAX_SIZE_RATIO = 0.5`.
   - `parseSrt(text): Cue[]` — `{ start, end, text }` in seconds; tolerant of CRLF and a missing
     trailing blank line; a block with no timing line is skipped.
   - `annotationShare(cues): number | null` — spec REQ-5; markup (`<…>`, `{…}`) removed first; `♪`/`♫`
     not counted; `null` for no cues.
   - `normalizeCueText(text)` — spec REQ-7's normalisation (case kept); C3 lower-cases its result.
   - `isSameTranslation(a, b)`, `isContainedIn(x, y)` over
     `TrackSample = { index, cues, wholeCueCount: number | undefined, isDefault: boolean }` — REQ-7
     and REQ-9 exactly as written, time overlap for C3 meaning `y.start < x.end && y.end > x.start`.
   - `pruneLanguage(tracks: TrackSample[]): Map<number, Verdict>` with
     `Verdict = { keep: true } | { drop: 'sdh' } | { drop: 'same'; as: number } |
     { drop: 'contained'; in: number }` — C1, then C2 (best by italic cues, then `isDefault`, then
     lower index — REQ-8), then C3, re-checking "more than one track left" before each (REQ-3).
5. **`capture.ts`**: `extraOutputs: n` opens fds 3…3+n−1 as pipes, drains each concurrently into its
   own buffer under `CAPTURE_STDOUT_CAP_BYTES`; past the cap on any of them, kill and reject;
   `RunResult.outputs` holds the n strings. Default (`undefined`) unchanged.
6. **`src/encode/subtitle-prune.ts`**:
   - `buildSubtitleSampleArgs(input, indices): string[]` —
     `-v error -nostdin -i <input>` then per track `k`:
     `-map 0:<index> -t 900 -c:s srt -f srt pipe:<3+k>`. The limit is an **output** option (spec
     REQ-4); exported so the test pins it.
   - `resolveSubtitlePruning(details, input, metadata, signal): Promise<ReadonlySet<number>>`:
     `selectSubtitleStreams` over the subtitle streams with `details`' subtitle fields; group by
     `normalizeIso3(tags.language)`; keep groups of more than one non-image stream; none → return an
     empty set with no spawn and no log (REQ-3, AC-8). Otherwise one `runFfmpegCapture` with
     `extraOutputs`; non-zero exit → throw; `parseSrt` each output; `pruneLanguage` per group; log
     one `[subs] <lang> <index>:<cues>:<share>%=<outcome> …` line per group (REQ-13); return the
     union of dropped indices. Cache by input path on success only (NFR-3). `catch`: rethrow
     `EncodeCancelledError`; otherwise one `[subs] read failed: <message>` line and an empty set
     (NFR-1).
7. **Wire** `encode.ffmpeg.ts`: `const subtitleDrops = await resolveSubtitlePruning(...)` after the
   stream-end trim (`// Spec 102, REQ-1`), passed to `buildFfmpegCommand`. Nothing else changes.
8. **Rule document**: `.claude/agents/ffmpeg.md` § Subtitles gains C0 (with S1–S3) and C1–C3 (after
   S5), stating the thresholds and the keep-on-doubt asymmetry; S6's "emitted, all of it" sentence
   is narrowed to "whatever survives S1–S5 and C1–C3".
9. Tests (below), then the checks.

## Contract obligations

None — spec § GraphQL Contract Delta is "None". The worker consumes no new field and reports nothing
new. If implementing this seems to need an `api` change, stop and report.

## Tests

The calibration shapes are read from `services/worker/fixtures/subtitle-content/`: the real 900 s
samples of the five films with every word replaced by random letters (same length and case, one
mapping per film, markup, timings, brackets, `♪` and non-ASCII letters kept), plus `manifest.json`
with each track's `isDefault`, `numberOfFrames` and expected verdict. The films' subtitle text is
never committed: the repository is public and that text is copyrighted. Boundary cases no real file
reproduces (exactly 10 %, a 300 ms offset, 2 sampled cues, a missing `NUMBER_OF_FRAMES`) are small
synthesised SRT strings, or a fixture with one field changed. Each new spec file opens with the
Article IX paragraph naming the silent failure.

- `src/ffmpeg/subtitle-content.spec.ts` — owed: a wrong verdict silently loses a good track or keeps
  clutter. Cases: Dragon shape (3, 4, 5, 6 → 3 kept, 5/6 `sdh`, 4 `same as 3`); Wake Up Dead Man
  English (SDH dropped) and Spanish (both kept); The Help without its marking (17.5 % dropped
  against 0 %); The Running Man's song-heavy plain track at 10.4 % with `♪` → not SDH; all-SDH
  language (all kept); same text but different `wholeCueCount` (both kept); `wholeCueCount`
  undefined (C2 never collapses); a start offset of 300 ms (both kept); Atomic Blonde shape (forced
  `contained in` full); a small track with one uncontained cue (kept); a small track with 2 sampled
  cues all contained (kept); a small track over half the large one's size (kept); the share exactly
  at 10 % (dropped) and just under (kept); `parseSrt` on CRLF and on a malformed block.
- `src/encode/subtitle-prune.spec.ts` — owed, `../ffmpeg/capture` mocked: no qualifying language →
  capture never called, no log; `buildSubtitleSampleArgs` puts `-t 900` after each `-map`, never
  before `-i`; non-zero exit / rejection → empty set plus one failure line; `EncodeCancelledError`
  propagates; a success logs one line per group and is cached (second call does not spawn); a
  failure is not cached; the candidate indices it reads equal those `getSubtitleParams` maps for a
  multi-language, multi-variant input (the single-selection risk in `../plan.md`).
- `src/ffmpeg/params.spec.ts` — C0: `disposition.comment = 1` dropped; title
  `Commentary with Director …` dropped; the only English track being a commentary → no English
  subtitle; a title containing `commentary` only as part of another word is kept; `contentDrops`
  removes exactly those indices and renumbers `-c:s:N`/`-metadata:s:s:N`.
- Corpus — The Running Man case asserts the whole command (C0 drops `BTM Commentary`, S4 drops
  `BTM SDH`, one English track mapped).
- `capture.ts` — no unit test: a real-spawn test needs `ffmpeg` in the test image, which the CI node
  image lacks; the fd plumbing is exercised live by AC-1/AC-3 and the four existing callers' suites
  guard the default path.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments worker
```

all pass, the suites named in step 1 are green and unchanged after the extraction, and on a live
stack a How to Train Your Dragon (2025)-shaped source encodes with one English subtitle track and a
`[subs] eng` line showing two `sdh` drops and one `same as` drop.

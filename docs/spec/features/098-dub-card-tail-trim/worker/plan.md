---
title: Dub-Card Tail Trim — worker slice
service: worker
last_updated: 2026-10-19
status: Implemented
---

# PLAN: Dub-Card Tail Trim — `worker` (`worker/plan.md`)

## Scope

The worker owns the whole detector and the cut. It reads `EncodeJobDetails.dubTrimEnabled`, and,
only when compressing and the switch is on, measures the last 300 s of the source's video stream
before the encode, classifies the tail (spec REQ-5…REQ-8) and limits the FFmpeg output to the cut
point. It never reports anything about the detection to `api` (spec NFR-1). It does not store the
switch, render it or validate it — those are `api`'s and `web`'s.

Writes are confined to `services/worker/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/ffmpeg/capture.ts` | New | `runFfmpegCapture(args, signal)` — `grain-probe.ts`'s private `runProbeFfmpeg`, **moved** here unchanged and exported |
| `services/worker/src/encode/grain-probe.ts` | Modified | imports `runFfmpegCapture` instead of defining `runProbeFfmpeg`; no behaviour change |
| `services/worker/src/encode/dub-trim.ts` | New | constants, the pure rule functions, the detection, the resolver and its cache |
| `services/worker/src/encode/dub-trim.spec.ts` | New | Article IX tests below |
| `services/worker/fixtures/dub-trim/*.freezes.txt` | New | copied verbatim from `../fixtures/` |
| `services/worker/.dockerignore` | Modified | `fixtures/` — test data, never runtime, same as the `ffmpeg/` corpus line |
| `services/worker/src/encode/types.ts` | Modified | `EncodeInput.dubTrimEnabled: boolean` |
| `services/worker/src/jobs/encode.job.ts` | Modified | query + `EncodeJobDetails` type gain `dubTrimEnabled`; resolve it; pass it on both `EncodeInput` literals; include it in the `[encode]` log line |
| `services/worker/src/encode/encode.ffmpeg.ts` | Modified | calls `resolveDubTrim`, passes the cut to `buildFfmpegCommand` and the trimmed duration to `runFfmpeg` |
| `services/worker/src/ffmpeg/buildCommand.ts` | Modified | new `trimAt: number \| null` parameter folded into the existing `-t` |
| `services/worker/src/ffmpeg/buildCommand.spec.ts` | Modified | `-t` cases below |

## Existing code to reuse

- `src/encode/grain-probe.ts` `runProbeFfmpeg` — the AbortSignal-aware spawn (SIGTERM, then SIGKILL
  after `ABORT_KILL_GRACE_MS`, rejects `EncodeCancelledError` when aborted, caps captured stderr).
  Move it to `src/ffmpeg/capture.ts` instead of writing a second one (Article X). It is not mocked
  by name in any spec today, so the move is safe; `grain-probe.spec.ts` and `grain-mode.spec.ts`
  must pass untouched.
- `src/encode/grain-mode.ts` `resolveFilmGrain` — the resolver shape to copy: early return when off,
  in-process `Map` cache with an exported `reset…Cache()` for tests, one log line per decision,
  `catch` that rethrows only `EncodeCancelledError`.
- `encode.job.ts`'s `compressing` flag — gate the switch exactly as `grainMode` is gated
  (`compressing ? … : 'OFF'`), so passthrough never sees `true` (REQ-4).
- `buildFfmpegCommand`'s existing `ENCODE_SAMPLE_SECONDS` → `-t` branch — extend it to the minimum
  of the two limits; do not add a second `-t`.
- `getMetadata()` output already in hand in `encode.ffmpeg.ts` — `videoEndSeconds` reads it; no extra
  `ffprobe`.

## Steps

1. **Move** `runProbeFfmpeg` (+ its `RunResult` type) to `src/ffmpeg/capture.ts` as
   `runFfmpegCapture`; update `grain-probe.ts`'s two call sites. Run `bin/npm worker test`: green
   before anything else changes.
2. **Fixtures**: copy `docs/spec/features/098-dub-card-tail-trim/fixtures/*.freezes.txt` to
   `services/worker/fixtures/dub-trim/`; add `fixtures/` to `.dockerignore`. The fixture README's
   table is the expected-results source for step 4.
3. **`src/encode/dub-trim.ts`**, pure part (each with its `// Spec 098, REQ-n` locator):
   - constants: window `300`, max gap `0.2`, EOF tolerance `0.5`, card unit `2.002`, unit tolerance
     `0.06`, min cards `5`, min ratio `0.8`, and the filter string
     `scale=320:-2,freezedetect=n=0.003:d=1`.
   - `videoEndSeconds(metadata)`: first video stream's `duration` if finite; else its Matroska
     `tags.DURATION` (`HH:MM:SS.fffffffff`); else `format.duration`; else `NaN`.
   - `parseFreezes(stderr, windowLength)`: `freeze_start`/`freeze_end` pairs; an unmatched trailing
     start ends at `windowLength`.
   - `classifyTail(freezes, windowLength)`: returns `{ runStart, cards, multiples }` for the run that
     reaches the end (REQ-6), or `{ runStart: null, cards: 0, multiples: 0 }`; plus a predicate
     `isDubTail(result)` (REQ-7). Window-relative only — no absolute times in the pure layer.
4. **Detection + resolver** in the same file:
   - `detectDubTail(input, metadata, signal)`: compute `end = videoEndSeconds`, throw if not finite;
     `windowStart = max(0, end - 300)`; run `runFfmpegCapture` with
     `-hide_banner -nostdin -nostats -ss <windowStart> -t <end-windowStart> -i <input> -map 0:v:0
     -an -sn -vf <filter> -f null -` — **no `-v error`/`-loglevel error`**: `freezedetect` reports at
     info level and would print nothing. Non-zero exit → throw. Returns the classification plus the
     **absolute** cut `windowStart + runStart` when `isDubTail`, else `null`.
   - `resolveDubTrim(details, input, metadata, signal): Promise<number | null>`: `false` →
     return `null` immediately, no spawn, no log (REQ-3). Cache keyed by **input path** (REQ-11),
     exported `resetDubTrimCache()`. On success log exactly one line
     `[dubtrim] input=<path> cards=<n> multiples=<m> -> cut=<seconds.3>` or `-> keep` (REQ-12). Any
     error: rethrow `EncodeCancelledError`, otherwise return `null` **with no log** (NFR-1) and do
     not cache the failure. A cut at or below `0` is treated as `keep` (see decisions below).
5. **Payload**: add `dubTrimEnabled` to the GraphQL selection and the `EncodeJobDetails` type in
   `encode.job.ts`; `const dubTrimEnabled = compressing && details.dubTrimEnabled === true;`
   (NFR-2, silent — no normalize-and-warn helper); add it to `EncodeInput` and both literals.
6. **Driver**: in `encode.ffmpeg.ts`, after `resolveFilmGrain`, `const trimAt = await
   resolveDubTrim(details, input, metadata, signal);`; pass `trimAt` to `buildFfmpegCommand`; set
   the duration handed to `runFfmpeg` to the minimum of the source duration, `ENCODE_SAMPLE_SECONDS`
   and `trimAt` (REQ-10).
7. **Command**: `buildFfmpegCommand(…, filmGrain, trimAt)`; emit one `-t` with the minimum of
   `trimAt` and `ENCODE_SAMPLE_SECONDS` when either is set, formatted with three decimals, in the
   existing position (an output option, so every mapped stream is cut — REQ-8).
8. **Docs**: the `services/worker/CLAUDE.md` section is written by the orchestrator (`tasks.md`
   T008), not by this slice.
9. Run the checks.

## Contract obligations

Consumes `EncodeJobDetails.dubTrimEnabled: Boolean!` (`../spec.md` § GraphQL Contract Delta).
`undefined`/`null`/non-boolean (an `api` that has not shipped the field) reads as `false`, silently
(NFR-2). There is no error condition to handle: the field cannot fail on its own, and detection
failures never leave the worker (NFR-1) — no `KeyedError`, no `encodeFailed`, no new i18n key. The
delta is read-only — if it is wrong, stop and report.

## Tests

- `src/encode/dub-trim.spec.ts` — owed (Article IX): a misclassification removes real content or
  keeps garbage with no error anywhere. Header names that. Cases, from `fixtures/dub-trim/`:
  - `neagley-s01e01`, `voltron-s03e01`, `war-machine`, `wrecking-crew` → dub tail, `runStart` equal
    to the README table (the last three prove REQ-8: the run opens with a non-2 s segment and the
    cut is still the run start, not the first card).
  - `chernobyl-s01e01` → run of 56, rejected by the ratio; `reacher-s01e01` → rejected by count;
    `foundation-s01e01` → no run.
  - `videoEndSeconds`: stream `duration` wins; `duration: 'N/A'` + `DURATION` tag uses the tag
    (Neagley's `00:57:22.356000000` → 3442.356); a tag shorter than `format.duration` is still the
    answer (Voltron S01E01: tag ≈4101.1 vs format 4121.768); neither → `format.duration`.
  - `resolveDubTrim` with `runFfmpegCapture` mocked: switch off → no spawn; success → absolute cut
    `windowStart + runStart`; two different inputs → two spawns, two cuts (per-path cache); same
    input twice → one spawn; non-zero exit → `null`, nothing logged, not cached;
    `EncodeCancelledError` → rethrown.
- `src/ffmpeg/buildCommand.spec.ts` — owed: a missing or wrong `-t` silently keeps or cuts the tail.
  `trimAt` alone → `-t <trimAt>`; `trimAt` with a smaller `ENCODE_SAMPLE_SECONDS` → one `-t` with the
  smaller value; neither → no `-t` (AC-5).
- `src/ffmpeg/capture.ts` — no new test: moved code already exercised through the grain probe; its
  cancellation behaviour is AC-7's manual check.
- `encode.job.ts` gating — not owed a unit test: `compressing && === true` is one expression whose
  failure (trim during passthrough) is impossible structurally, since passthrough never calls the
  driver.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments worker
```

all pass, with `grain-probe.spec.ts` and `grain-mode.spec.ts` unchanged and green.

## Decisions taken here that the spec did not spell out

- A cut at or below `0` (the whole analysed video is one dub-card run, e.g. a source under five
  minutes that is entirely static cards) is treated as **keep** — producing an empty file is never
  the right answer to a luxury feature.
- A failed detection is not cached, so a retry gets another chance; a successful `keep` is.
- The `[encode]` line already logged per job gains `dubTrimEnabled=<bool>`, so AC-5's "no `[dubtrim]`
  line" can be told apart from "switch never reached the worker".

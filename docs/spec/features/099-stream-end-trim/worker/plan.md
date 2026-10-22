---
title: Stream-End Trim — worker slice
service: worker
last_updated: 2026-10-19
status: Approved
---

# PLAN: Stream-End Trim — `worker` (`worker/plan.md`)

## Scope

The worker owns the whole analysis and the cut. It reads `EncodeJobDetails.streamEndTrimEnabled`
and, only when compressing and the switch is on, reads where the first video track and every kept
audio track really end — from packet timestamps in the last 300 s of the file, decoding nothing —
before the encode's FFmpeg starts, then limits the output per spec REQ-8/REQ-9/REQ-10. It never
reports anything about the analysis to `api` (spec NFR-1). It does not store, render or validate
the switch.

Writes are confined to `services/worker/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/ffmpeg/capture.ts` | Modified | `runFfmpegCapture` gains an optional third argument `{ binary?: 'ffmpeg' \| 'ffprobe'; keepStdout?: boolean }` and `RunResult` a `stdout: string` (empty unless kept). Default behaviour unchanged |
| `services/worker/src/ffmpeg/params.ts` | Modified | the audio selection inside `getAudioParams` is **extracted** into exported `selectAudioStreams(...)`; `getAudioParams` calls it and keeps building the same arguments and logging the same warning |
| `services/worker/src/encode/stream-end-trim.ts` | New | constants, pure parse/decide functions, the probe, the resolver |
| `services/worker/src/encode/stream-end-trim.spec.ts` | New | Article IX tests below |
| `services/worker/src/encode/types.ts` | Modified | `EncodeInput.streamEndTrimEnabled: boolean` |
| `services/worker/src/jobs/encode.job.ts` | Modified | query + `EncodeJobDetails` type gain `streamEndTrimEnabled`; gate it on `compressing`; pass it on both `EncodeInput` literals; include it in the `[encode]` log line |
| `services/worker/src/encode/encode.ffmpeg.ts` | Modified | calls `resolveStreamEndTrim` beside `resolveDubTrim`; passes the earlier of the two non-null cuts as `trimAt` |

`buildCommand.ts` is **not** modified: its `trimAt` parameter and single `-t` already carry any cut,
and `encode.ffmpeg.ts` already feeds `trimAt` into the progress denominator (spec REQ-12).

## Existing code to reuse

- `src/ffmpeg/capture.ts` `runFfmpegCapture` — the AbortSignal-aware spawn (SIGTERM, SIGKILL after
  `ABORT_KILL_GRACE_MS`, `EncodeCancelledError` on abort). Extend it; do not write a second spawn
  helper (Article X). Its two current callers (`grain-probe.ts`, `dub-trim.ts`) pass no options and
  must behave exactly as today — `grain-probe.ts` pipes an encode to stdout and only counts bytes,
  so stdout must stay uncollected by default. `dub-trim.spec.ts` mocks the module by name; keep the
  export name.
- `getAudioParams`'s selection (`src/ffmpeg/params.ts`, spec `011` REQ-6/REQ-7, `031` REQ-5/6/9):
  the allow-list, blacklist words, codec priority, variant narrowing. Extract it as
  `selectAudioStreams(audioStreams, allowedLanguagesIso3, originalLanguageIso3, allowedLanguageTags)`
  returning `{ streams, missingLanguages }` — the original-audio `KeyedError` stays inside it, the
  `console.warn` per missing language moves to `getAudioParams` so analysing does not log it twice.
- `src/encode/dub-trim.ts` — the shape to copy: exported constants with locators, pure functions the
  spec tests drive directly, `resolve…(details, input, metadata, signal)` with an early `return null`
  when off, one log line per completed analysis, a `catch` that rethrows only `EncodeCancelledError`.
  **No verdict cache** (spec NFR-3).
- `encode.job.ts`'s `compressing` flag — gate exactly as `dubTrimEnabled` is gated
  (`compressing && details.streamEndTrimEnabled === true`), so passthrough never sees `true`
  (REQ-4) and anything non-boolean reads as off (NFR-2).
- The `getMetadata()` result already in hand in `encode.ffmpeg.ts` — gives the stream list (for the
  first video stream and the audio selection) and `format.duration` (for the window start). No extra
  `ffprobe -show_streams`.

## Steps

1. **Extract** `selectAudioStreams` from `getAudioParams` (move-only). Run `bin/npm worker test`:
   `params.spec.ts`, `buildCommand.spec.ts`, `cases.spec.ts`, `variants.spec.ts` green and unchanged
   before anything else.
2. **Extend** `runFfmpegCapture` with the options argument and `RunResult.stdout`. When
   `keepStdout`, collect stdout up to a 32 MB cap; past the cap, reject (the resolver turns that into
   keep, NFR-1). Run the suite again: `grain-probe.spec.ts`, `dub-trim.spec.ts` green unchanged.
3. **`src/encode/stream-end-trim.ts`**, pure part (each with its `// Spec 099, REQ-n` locator):
   - constants: window `300`, threshold `2`.
   - `parsePacketEnds(stdout): Map<number, number>` — reads ffprobe `compact` lines
     (`packet|stream_index=1|pts_time=…|duration_time=…`) by **key**, not position; end =
     `pts_time + duration_time` (`N/A` duration → `0`); skips lines with a non-numeric `pts_time`;
     keeps the max per stream index.
   - `decideStreamEndCut(videoEnd: number | undefined, audioEnds: (number | undefined)[]):
     { video, audio, cut: number | null, outOfWindow: boolean }` — any `undefined` (no packet in
     window) → `outOfWindow`, `cut: null` (REQ-9); else `A = max(audioEnds)`, cut `min(V, A)` when
     `|V − A| > 2`, else `null` (REQ-8). Absolute seconds in and out.
4. **Probe + resolver** in the same file:
   - `readTrackEnds(input, metadata, streamIndices, signal)`: `from = max(0, format.duration − 300)`
     (throw if `format.duration` is not finite); run `runFfmpegCapture` with
     `{ binary: 'ffprobe', keepStdout: true }` and
     `-v error -read_intervals <from>% -show_entries packet=stream_index,pts_time,duration_time
     -of compact <input>`; non-zero exit → throw; return the parsed ends for the requested indices.
   - `resolveStreamEndTrim(details, input, metadata, signal): Promise<number | null>`: `false` →
     `null` immediately, no spawn, no log (REQ-3). Otherwise: first `codec_type === 'video'` stream
     (the same one `buildFfmpegCommand` maps) and `selectAudioStreams(...)` over the audio streams
     with `details`' language fields; no video or no selected audio → throw. Probe, decide, log one
     line `[streamtrim] input=<input> video=<V|n/a> audio=<A|n/a> -> cut=<x.xxx> | keep |
     keep (out of window)` (REQ-13), return the cut. A cut `<= 0` is treated as keep. `catch`:
     rethrow `EncodeCancelledError`, otherwise return `null` with **no** log (NFR-1).
5. **Wire**: `types.ts` field; `encode.job.ts` query/type/gate/log/both literals;
   `encode.ffmpeg.ts` — `const dubCut = await resolveDubTrim(…)`,
   `const endCut = await resolveStreamEndTrim(…)`, `trimAt` = the minimum of the non-null ones, or
   `null` (REQ-10, `// Spec 098, REQ-3; Spec 099, REQ-10`). Nothing else in that file changes.
6. Tests (below), then the checks.

## Contract obligations

Consumes `EncodeJobDetails.streamEndTrimEnabled: Boolean!` from `../spec.md` § GraphQL Contract
Delta, added to `encode.job.ts`'s existing `encodeJobDetails` selection. An `api` that has not
shipped it answers with a GraphQL validation error for the whole query — the same deploy-order
dependency every `EncodeJobDetails` field has had; `api` ships first (`../plan.md`). A present but
non-boolean value reads as off (NFR-2). Analysis outcomes are never reported to `api`. The delta is
read-only — if it is wrong, stop and report.

## Tests

- `src/encode/stream-end-trim.spec.ts` — owed (Article IX): a wrong cut silently deletes content or
  silently keeps the defect. Opens with the header paragraph naming that. Cases, with the measured
  numbers from the spec:
  - `decideStreamEndCut`: Voltron S01E01 (V 4101.138, A 4121.76 → cut 4101.138); Lost in Space
    S01E01 (V 3816.188, A 3765.455 → cut A); Star Wars (V 7330.198, A [7268.158, 7267.432] → cut
    7268.158, the max audio); They Will Kill You (V 5673.71, A [5673.718, 5734.568] → cut V); The
    Help (V 8774.975, A 8779.815 → cut V); a normal file at 0.3 s → `null`; exactly 2.0 s → `null`;
    Darkest Hour shape (A `undefined`) → `outOfWindow`, `null`.
  - `parsePacketEnds`: keyed parsing independent of field order; `N/A` duration; non-numeric pts
    skipped; max per stream when packets arrive out of order (B-frames).
  - `resolveStreamEndTrim` with `../ffmpeg/capture` mocked: off → capture never called, no log;
    a dropped audio track that is the longest is **not** in the requested indices and does not move
    the cut (NFR-5, REQ-7); capture exits non-zero / rejects / no audio selected → `null`, no
    `[streamtrim]` log, no warning; `EncodeCancelledError` propagates; a successful decision logs
    exactly one `[streamtrim]` line.
- `params.spec.ts` — not extended for the extraction itself (move-only, the existing suite is the
  guard); add **one** case asserting `selectAudioStreams` returns the indices `getAudioParams` maps
  for a multi-language input, since that equality is what REQ-7 depends on.
- `capture.ts` — no new spec: the option is exercised through `stream-end-trim.spec.ts`'s mocked
  boundary and live by AC-1/AC-7; the existing behaviour is guarded by the two existing suites.
- `encode.ffmpeg.ts` composition — covered by AC-9 in the manual pass; the `min`-of-non-nulls line
  is trivial enough that a unit test would re-state it.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments worker
```

all pass, the four pre-existing suites named in steps 1–2 are unchanged and green, and on the live
stack the Voltron NTb S01E01 source encodes to ≈ 4101.1 s with one `[streamtrim]` cut line.

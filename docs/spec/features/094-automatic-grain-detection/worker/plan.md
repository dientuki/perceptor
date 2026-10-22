---
title: Automatic Grain Detection — worker slice
service: worker
last_updated: 2026-10-17
status: Approved
---

# PLAN: Automatic Grain Detection — `worker` (`worker/plan.md`)

## Scope

The worker turns `EffectiveGrainMode` `AUTO` into a real boolean: a metadata gate, then — only if it
passes and the film is not a short — an encode probe, with one verdict per source (`../spec.md`
REQ-1 … REQ-12, NFR-1 … NFR-6). `ON`/`OFF` keep resolving exactly as `092` left them.

The worker does **not** decide whether a film is a short (it reads `isShort` off the payload, `api`
owns it), does not touch the destination path, and does not report anything about grain to `api` —
the verdict lives in the log only.

Writes are confined to `services/worker/` and this directory. `src/ffmpeg/` and the
`services/worker/ffmpeg/` case corpus are also governed by `.claude/agents/ffmpeg.md`; the edits there
are mechanical (one parameter, two exports) and must not change a single produced argument.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/encode/grain-mode.ts` | Modified | `resolveFilmGrain` becomes async and orchestrates gate → short check → cache → probe; `normalizeIsShort` added |
| `services/worker/src/encode/grain-gate.ts` | New | Pure, synchronous gate scoring and its named constants |
| `services/worker/src/encode/grain-probe.ts` | New | Crop detection, window placement, the twin encodes, the saved-bitrate arithmetic and its threshold |
| `services/worker/src/encode/encode.ffmpeg.ts` | Modified | Calls `resolveFilmGrain` after `getMetadata`, passes the boolean to `buildFfmpegCommand` |
| `services/worker/src/encode/types.ts` | Modified | `EncodeInput` gains `year`, `isShort`, `mediaSourceId` |
| `services/worker/src/jobs/encode.job.ts` | Modified | Selects `isShort`, retypes it, normalizes it, fills the three new `EncodeInput` fields in both `encode` and `passthrough` calls |
| `services/worker/src/ffmpeg/buildCommand.ts` | Modified | New `filmGrain: boolean` parameter; the `resolveFilmGrain` import and call go away |
| `services/worker/src/ffmpeg/params.ts` | Modified | Export the function that builds the `-svtav1-params` string (unchanged in output), plus `RESOLUTION_BOXES` and `exceedsBox` |
| `services/worker/src/ffmpeg/remux-detection.ts` | Modified | Export `parseFrameRate`, `computeBitsPerPixelPerFrame`, `isLosslessAudioStream`; logic unchanged |
| `services/worker/src/ffmpeg/runner.ts` | Modified | Export `ABORT_KILL_GRACE_MS` so the probe uses the same grace period |
| `services/worker/src/ffmpeg/cases.spec.ts`, `buildCommand.spec.ts` | Modified | Pass `filmGrain` explicitly |
| `services/worker/src/encode/grain-gate.spec.ts`, `grain-probe.spec.ts` | New | See Tests |
| `services/worker/src/encode/grain-mode.spec.ts` | Modified | `resolveFilmGrain` cases rewritten for the async orchestration; `normalizeIsShort` cases |

## Existing code to reuse

- `src/encode/encode.ffmpeg.ts` — already async, already holds `metadata` from `getMetadata(input)`
  and the `signal`. The resolution goes between `onProbe` and `buildFfmpegCommand`. **No second
  `ffprobe`** (REQ-3).
- `src/ffmpeg/remux-detection.ts` — `parseFrameRate` (rational `avg_frame_rate`, the documented
  `NaN` trap), `resolveVideoBitRate`'s stream → `BPS` tag → size/duration fallback inside
  `computeBitsPerPixelPerFrame`, and `isLosslessAudioStream`. Export them; the gate composes
  `isLosslessAudioStream(s) || codec is flac/alac` rather than editing the original, because
  widening it would change `isRemux` and move FLAC remuxes to CRF 22.
- `REMUX_BITS_PER_PIXEL_PER_FRAME_THRESHOLD` in the same file — the shape every new threshold
  constant copies (NFR-6): `SCREAMING_SNAKE`, module-level, a `// Spec 094, REQ-n` locator, no prose.
- `src/ffmpeg/params.ts` — `svtav1KindParams(contentKind, filmGrain)` and the base terms
  (`keyint=10s:scd=1:enable-overlays=1:tune=0:input-depth=10`) inside `buildAv1EncodeArgs`. Lift the
  string assembly into one exported function (e.g. `buildSvtav1Params(contentKind, filmGrain)`) that
  both `buildAv1EncodeArgs` and the probe call. `params.spec.ts` and the case corpus prove the real
  encode's output is byte-identical afterwards.
- `RESOLUTION_BOXES['1080p']` and `exceedsBox` in `params.ts` — the probe's fixed box and the same
  "larger than the box" test the real encode applies (its `BOX_TOLERANCE`). Export and use both, not
  a second `1920`/`1080` literal pair or a second tolerance.
- `src/ffmpeg/runner.ts` — the SIGTERM → `ABORT_KILL_GRACE_MS` → SIGKILL pattern and
  `EncodeCancelledError` from `src/encode/cancellation.ts`. The probe's spawn helper follows the same
  sequence; it does not reuse `runFfmpeg` itself, which is bound to the working/part/mkvmerge
  lifecycle of a real encode.
- `normalizeGrainMode` / `normalizeContentKind` — the posture `normalizeIsShort` copies: accept the
  valid value, otherwise warn once and return the safe default (`false`), never throw.
- `services/worker/tmp/etapa1-metadata.sh` and `etapa3-encode-probe.sh` — the reference
  implementations. Every weight, tier, window position and filter string below is ported from them.
  They are not shipped and nothing imports them; `etapa2-pixels.sh` is the retired detector and
  nothing is ported from it.

## Steps

1. **Exports, no behaviour change.** Export the three helpers from `remux-detection.ts`,
   `ABORT_KILL_GRACE_MS` from `runner.ts`, `RESOLUTION_BOXES` and `exceedsBox` from `params.ts`, and
   lift `buildSvtav1Params` out of `buildAv1EncodeArgs` there. `bin/npm worker test` must be green with no test edited.
2. **Move the seam.** `buildFfmpegCommand(input, output, metadata, details, filmGrain)`; drop its
   `resolveFilmGrain` import and call; keep the `// Spec 092, REQ-9` locator on the line that now
   passes the parameter through, adding `Spec 094, NFR-5`. Update `cases.spec.ts` and
   `buildCommand.spec.ts` to pass `false` (and `true` where a test asserts grain terms). The corpus
   must stay green with **no JSON case edited**.
3. **`EncodeInput` and the payload.** Add `year: number | null`, `isShort: boolean`,
   `mediaSourceId: number` to `EncodeInput`. In `encode.job.ts`: add `isShort` to the query string
   and to the local `EncodeJobDetails` type (both in the same edit — the usual no-codegen rule),
   normalize it with `normalizeIsShort`, append `isShort=` to the existing `[encode]` log line, and
   fill the three fields in **both** the `encode(...)` and `passthrough(...)` `EncodeInput` literals
   (passthrough ignores them; the type requires them).
4. **The gate** (`grain-gate.ts`). A pure function
   `scoreGrainGate(metadata, inputPath, year) → { score, passed, reasons: string[] }`. Signals and
   weights, ported from `etapa1-metadata.sh`:
   - `tune=grain` in any stream or format tag, case-insensitive: **+3**.
   - `film-grain=N` with N > 0 in any tag (largest N found): **+3**.
   - Codec-normalized bpppf — `computeBitsPerPixelPerFrame` × efficiency factor (`h264`/`avc`/
     `mpeg2video`/`mpeg4`/`vc1` 1.0, `hevc`/`h265`/`vp9` 1.8, `av1` 2.4, anything else 1.0):
     ≥ 0.20 **+2**, else ≥ 0.13 **+1**, else < 0.07 **−2** (if/else chain: 0.07–0.13 scores 0). An
     uncomputable bpppf scores 0.
   - Lossless audio (`isLosslessAudioStream` or `flac`/`alac`): **+1**.
   - Disc marker in the provenance string (`remux|bluray|blu-ray|bdrip|bd25|bd50|uhdbd`): **+1**.
   - Streaming marker (`web-?dl|web-?rip|amzn|nf\.|dsnp|hmax|atvp|webdl`): **−1**.
   - `year` from `EncodeInput` (never parsed from the path, REQ-5) < 2002: **+1**. `null` scores 0.
   - Passes at score ≥ **2**.
   The provenance string is `basename(dirname(inputPath)) + ' ' + basename(inputPath)`, lowercased —
   **not** `sourceTag` (see `../plan.md` § Approach). Tags are read from `metadata.streams[].tags`
   and `metadata.format.tags` only; the script's `mediainfo` pass has no equivalent (REQ-3), so an
   x264 settings string that only lives in the SEI is not seen. Each weight, tier and the pass score
   is a named constant.
5. **The probe** (`grain-probe.ts`). `probeGrainSaving(input, metadata, contentKind, signal) →
   { mbpsGrain0, savingPct, savedMbps, passed }`, throwing on failure, throwing
   `EncodeCancelledError` on abort. Ported from `etapa3-encode-probe.sh`:
   - Duration from `metadata.format.duration`; under **30 s** or unparseable → throw (NFR-1 turns it
     into "no grain").
   - **Crop**: 5 runs of `ffmpeg -nostdin -ss <t> -t 5 -i <input> -an -sn -vf
     cropdetect=limit=24:round=2:reset=0 -f null -` at `t = d × (0.10 + 0.70 × i/4)`; take the last
     `crop=W:H:X:Y` each run prints on stderr; the most frequent wins; none → no crop.
   - **Box**: scale into `RESOLUTION_BOXES['1080p']` with
     `force_original_aspect_ratio=decrease:force_divisible_by=2` when `exceedsBox(croppedW, croppedH,
     box)` — the production `BOX_TOLERANCE` (1.02, the same 2% the script hard-codes); never upscale;
     **never read `compressionResolution`** (REQ-8).
   - **Windows**: 9 at `t = d × 0.05 + d × 0.90 × (i + 0.5)/9`, each `-t 6`, encoded twice:
     `-an -sn -map 0:v:0 [-vf crop,scale] -c:v libsvtav1 -crf 22 -preset 8 -pix_fmt yuv420p10le
     -svtav1-params <buildSvtav1Params(contentKind, false|true)> -f matroska pipe:1`. Count stdout
     bytes; nothing is written to disk (NFR-2). Run the encodes **sequentially** — SVT-AV1 already
     uses every core.
   - A window counts only if both encodes produced > 1000 bytes; zero counted windows → throw.
   - `savingPct = (1 − ΣbytesGrain / Σbytes0) × 100`;
     `mbpsGrain0 = Σbytes0 × 8 / (windows × 6) / 1e6`; `savedMbps = mbpsGrain0 × savingPct / 100`;
     `passed = savedMbps ≥ GRAIN_PROBE_SAVED_MBPS_THRESHOLD` (**0.886**, REQ-7).
   - Keep the arithmetic in a separately exported pure function so it is testable without spawning.
   - `ENCODE_SAMPLE_SECONDS` is ignored; the probe always uses the real duration.
6. **Orchestration** (`grain-mode.ts`).
   `resolveFilmGrain(details: EncodeInput, input, metadata, signal): Promise<boolean>`:
   1. `ON` → `true`, `OFF` → `false`, nothing else runs (REQ-2).
   2. `AUTO` with a cached verdict for `details.mediaSourceId` → that verdict, logged as reused
      (REQ-9).
   3. Gate fails → `false`. Gate passes and `details.isShort` → `false`, logged as resolved on the
      gate alone (REQ-11). Otherwise log that the probe is starting, then probe.
   4. Cache the **definite** verdict (gate refusal, short refusal, probe verdict) by
      `mediaSourceId` in a module-level `Map`. Never cache a failure or a cancellation.
   5. Wrap steps 3–4 so `EncodeCancelledError` is rethrown untouched, and every other throw becomes
      `false` plus exactly one `console.warn` naming the failure (NFR-1).
   6. One `[grain]` result line per resolution (REQ-10): `mediaSourceId`, mode, which stage decided
      (`gate`/`short`/`probe`/`cache`/`failure`), the gate score and reasons, and — when the probe
      ran — `mbpsGrain0`, `savingPct`, `savedMbps` and the threshold.
7. **Wire the driver.** In `encode.ffmpeg.ts`, after `onProbe`:
   `const filmGrain = await resolveFilmGrain(details, input, metadata, signal);` then
   `buildFfmpegCommand(input, workingPath, metadata, details, filmGrain)`. Nothing else in the driver
   changes.

## Contract obligations

Consumes, from `../spec.md` § GraphQL Contract Delta:

```graphql
type EncodeJobDetails {
  isShort: Boolean!
}
```

- Absent, `null` or non-boolean → `false` with one warning (REQ-12). An older `api` makes every film
  probe; it must never fail the job.
- `isShort` alone decides REQ-11. Do not read `kind`, and do not derive "short" from duration — that
  rule was removed from the spec on purpose (`../plan.md` § Contract Freeze).
- `grainMode` is consumed exactly as `092` defined it; `normalizeGrainMode` is unchanged.
- No new error condition crosses the wire: every grain failure resolves to `false` locally.

The delta is read-only. If it is wrong, stop and report — do not adapt it locally.

## Tests

Each new file opens with the Article IX header naming the silent failure.

- `src/encode/grain-gate.spec.ts` — a wrong weight or a mis-parsed field produces a plausible score
  and a wrong verdict, with no error. Cases: `avg_frame_rate` `"24000/1001"` still yields a bpppf
  tier; the HEVC factor applied (a raw value under 0.13 that normalizes over 0.20); the dead zone
  0.07–0.13 scores 0; `flac` counts as lossless here while `isRemux` is unaffected; a disc marker
  present only in the parent directory name counts; `year` 1998 with `inputPath` `mipeli.mkv` scores
  the same year signal as a path containing `1998` (AC-9); a year in the path with `year: null` scores
  no year signal; the pass threshold at exactly 2.
- `src/encode/grain-probe.spec.ts` — the arithmetic is where a unit slip makes every title pass or
  fail. Cases: the Lionheart corpus row (Σbytes0 76 198 923, 9 windows × 6 s, 24.55% → 11.289 Mbps
  and 2.771 saved) reproduced within rounding; a window under 1000 bytes excluded from both sums;
  zero counted windows throws; crop mode picks the majority over one outlier; the scale filter is the
  same for a `4k` and a `1080p` job and absent for a source already inside the box (AC-16); window
  and crop timestamps for a known duration.
- `src/encode/grain-mode.spec.ts` (rewritten `resolveFilmGrain` block, probe and gate mocked) — the
  orchestration's failures are all silent. Cases: `ON`/`OFF` never call gate or probe; gate refusal
  never calls the probe; `isShort: true` with a passing gate never calls the probe; two calls with
  the same `mediaSourceId` probe once; a probe that throws yields `false`, warns once, and is
  **not** cached (the next call probes again); `EncodeCancelledError` from the probe propagates.
  Plus `normalizeIsShort`: `true`/`false` pass through silently; `undefined`, `null`, `"true"` →
  `false` with one warning.
- `src/ffmpeg/cases.spec.ts`, `buildCommand.spec.ts`, `params.spec.ts` — not new tests; they are the
  proof that step 1 and step 2 changed no argument (NFR-5, AC-10).

The spawn helper itself (signal → SIGTERM → SIGKILL) gets no unit test: it follows `runner.ts`'s
already-tested sequence, and AC-5's manual pass exercises it against a real FFmpeg.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments worker
```

Typecheck clean, every test green including the unedited `services/worker/ffmpeg/` corpus, and
`bin/comments worker` clean — every threshold carries a `// Spec 094, …` locator and no prose.

---
title: Audio Variant Detection — worker slice
service: worker
last_updated: 2026-10-29
status: Approved
---

# PLAN: Audio Variant Detection — `worker` (`worker/plan.md`)

## Scope

The worker decides, before an encode, which of two unresolved Spanish audio streams is `es-ES` and
which is `es-419`. It persists the result in `111`'s encode-verdict store, and hands the decided map
to track selection and titling. `111` must be implemented first.

This slice is split between **two agents**, because `src/ffmpeg/` belongs to the `ffmpeg` agent
(`.claude/agents/ffmpeg.md` § Scope):

- **`worker` agent.** The Dockerfile stage (engine and model), `src/encode/audio-variant*.ts` (the
  resolver, the window extraction, the transcription call, the scorer and the detector registry),
  the audio-variant verdict kind in `111`'s store, `encode.ffmpeg.ts` wiring, `jobs/encode.job.ts`
  (the query field), and `CLAUDE.md`.
- **`ffmpeg` agent.** The required `audioVariants: AudioVariantResolution` parameter
  (`../plan.md` § Contract Freeze) on `buildFfmpegCommand` → `getAudioParams` →
  `selectAudioStreams`; the `duplicates` set removed from the candidates before any selection rule;
  a `detect` composed from `tags` and `detectVariant` in `variants.ts`, used by both
  `narrowToVariants` and `trackLanguageTitle` for audio; `'whisper-cli'` added to `capture.ts`'s `binary` union; one corpus case; and `ffmpeg.md`
  § L1's amendment.

The persistent cache is `111`'s Redis store, with no in-memory map beside it (`111` NFR-6). It never
touches subtitles
(Out of Scope). It never runs with compression off: `passthrough.ts` never enters the driver
(REQ-5, AC-10).

## Files

| File | New / Modified | Agent | What changes |
| :-- | :-- | :-- | :-- |
| `Dockerfile` | Modified | worker | A `whisper` build stage (whisper.cpp at a pinned tag, CMake, default CPU flags) plus the model fetched with a SHA-256 check; `base` copies `whisper-cli` and the model to `/opt/whisper/` |
| `src/encode/audio-variant-detectors.ts` | New | worker | The registry (REQ-11): `{ iso3, whisperLanguage, tags: [aTag, bTag], markers }`; one Spanish entry |
| `src/encode/audio-variant-score.ts` | New | worker | Pure: dedupe lines, the duplicate check, weighted marker counts and the per-stream score; `decide` → tags, duplicate or undecided |
| `src/encode/audio-variant.ts` | New | worker | `resolveAudioVariants(details, input, metadata, signal)`: gating, store read, window extraction, `whisper-cli`, scoring, store write, map |
| `111`'s verdict store module | Modified | worker | One more verdict kind, `audio-variant`, with the identity in `../spec.md` REQ-8 |
| `src/encode/types.ts` | Modified | worker | `EncodeInput.audioVariantDetection` |
| `src/encode/encode.ffmpeg.ts` | Modified | worker | Call the resolver after `resolveSubtitlePruning` and pass the map to `buildFfmpegCommand` |
| `src/jobs/encode.job.ts` | Modified | worker | Query `audioVariantDetection`, normalize a missing one to `false` with a log |
| `src/ffmpeg/buildCommand.ts`, `src/ffmpeg/params.ts`, `src/ffmpeg/variants.ts` | Modified | ffmpeg | The map parameter and the composed `detect` |
| `src/ffmpeg/capture.ts` | Modified | ffmpeg | `'whisper-cli'` in `CaptureOptions.binary` |
| `ffmpeg/<case>.json` | New | ffmpeg | It Chapter Two's verbatim ffprobe with a verdict map → expected command keeps only stream 3, titled `Latino …` |
| `fixtures/audio-variant/` | New | worker | Scrambled-but-marker-preserving transcripts of the three films' tracks plus `manifest.json` (expected verdict). The film text is never committed verbatim, the same as `fixtures/subtitle-content/` |
| `CLAUDE.md` | Modified | worker | A new section: "Audio variant detection is resolved in the encode driver (`110`)" |
| `.claude/agents/ffmpeg.md` § L1 | Modified | ffmpeg | Metadata labelling stays unconditional; audio-derived labelling is gated by the opt-in |

## Existing code to reuse

- `src/encode/subtitle-prune.ts` (`102`) — the template for a pre-encode resolver. It has the same
  signature shape `(details, input, metadata, signal)`, returns a pure value for
  `buildFfmpegCommand`, swallows every failure except `EncodeCancelledError`, and prints one log line
  per decision. Mirror its structure. Its in-memory `verdictCache` is gone after `111`; read and
  write through `111`'s store the same way it does after that change.
- `src/ffmpeg/capture.ts` `runFfmpegCapture` — run both the window extraction (`binary: 'ffmpeg'`)
  and the transcription (`binary: 'whisper-cli'`, `keepStdout: true`) through it. It already kills
  the child on abort with `ABORT_KILL_GRACE_MS` and rejects with `EncodeCancelledError`. Never
  `spawn` directly.
- `src/ffmpeg/variants.ts` `detectVariant` — the "metadata resolves it" test of REQ-5. A stream for
  which it returns a tag is never a candidate.
- `src/ffmpeg/iso639.ts` `normalizeIso3` — on both sides of the language comparison against
  `details.allowedAudioLanguagesIso3` and the registry's `iso3`.
- `src/encode/cancellation.ts` `EncodeCancelledError`.
- `111`'s verdict store — its file identity (path, size, mtime), its key namespace, its TTL and its
  "Redis failure is no verdict" posture. Never open a Redis connection of its own.

## Steps

1. **Engine and model (Dockerfile).** Add a `whisper` stage `FROM node:26.10.0-alpine` with
   `build-base cmake git`. Clone whisper.cpp at a pinned release tag and build `whisper-cli` with
   `-DGGML_NATIVE=OFF`, so the binary is portable across hosts of one arch (`083`). Fetch the
   quantized multilingual model (start with `ggml-small-q5_1.bin`, about 190 MB) from a pinned
   Hugging Face revision and `sha256sum -c` it. `base` copies the binary plus its shared libraries
   and the model to `/opt/whisper/`. Record the tag, the revision, the SHA-256 and the image size
   before and after here (NFR-3).
2. **Registry and scorer (pure).**
   - `audio-variant-detectors.ts` holds the Spanish entry: `iso3: 'spa'`, `whisperLanguage: 'es'`,
     `tags: ['es-ES', 'es-419']`, and the REQ-6 marker lists as word-boundary regexes.
   - `audio-variant-score.ts`:
     - `dedupeLines(text)` lowercases and keeps the first occurrence of each line.
     - `similarity(a, b)` compares the two deduplicated word sequences (longest-matching-blocks
       ratio, as Python's `difflib.SequenceMatcher` with autojunk off computes it: the prototype
       measured 0.45 It Chapter Two, 0.40 Interstellar, 0.89 Jurassic Park III). At or above the
       duplicate threshold, start at 0.75, the verdict is duplicate and scoring is skipped.
     - `score(text, markers)` weighs strong A markers ×3, weak A markers and the present perfect ×1,
       and B markers ×−2. These are the prototype's weights.
     - `decide([a, b], margin)` returns `{ [aIndex]: tags[0], [bIndex]: tags[1] }` for the higher
       score, or `null` when `|a − b| < margin`. Start from the prototype's margin, 6.
3. **Resolver.** `resolveAudioVariants` does the following, in order:
   1. Return an empty map unless `details.audioVariantDetection` is true.
   2. For each registry entry whose `iso3` is in the allowed audio list, take the audio streams of
      that language for which `detectVariant` returns nothing. Continue only with **exactly two**.
   3. If `111`'s store holds a verdict for this file, `iso3` and stream pair, use it, log
      `(reused)` and skip the rest. A stored undecided verdict counts as found.
   4. Otherwise extract `W` windows of `L` seconds at proportional positions of
      `format.duration`. Take the centre channel (`pan=mono|c0=FC` when the layout has `FC`, else
      `-ac 1`) at 16 kHz into one WAV per stream in an `mkdtemp` directory, removed in `finally`.
   5. Run `whisper-cli -m /opt/whisper/<model> -l es -t <availableParallelism()> -nt -np -f <wav>`
      once per stream, then check for a duplicate, else score and decide. On a duplicate, the stream
      to drop is the one with fewer channels, or on a tie the higher index.
   6. Write the verdict (decided or undecided) to `111`'s store, swallowing and logging a store
      failure (REQ-9).
   7. Return the decided map, or empty when undecided.
   Any error other than `EncodeCancelledError` logs `[variant] detection failed: …`, stores
   nothing and returns an empty map. Starting values: `W = 3`, `L = 120`. Raise them toward the
   prototype's 5 windows only if AC-2/AC-3 do not decide, and lower them if AC-11 misses 10
   minutes. Record the final values here.
4. **Seam.** Add `EncodeInput.audioVariantDetection`, query it in `encode.job.ts` with the
   normalization, and call the resolver from `encode.ffmpeg.ts`.
5. **`ffmpeg` agent, in parallel with 2–4 once the map shape is fixed.** Corpus green → add the
   required parameter and the composed `detect` → corpus still green (an empty map everywhere) →
   add the It Chapter Two case with a map → green. Amend § L1.
6. **Live tuning on the three films** (AC-1 to AC-3, AC-11). Record each track's score, the margin
   and the wall time here. Freeze `W`, `L`, the weights and the margin, and update `CLAUDE.md`.

Prototype reference for step 6 (openai-whisper `small`, 5 × 120 s, the weights above), It Chapter
Two: stream 2 scored **49**, stream 3 scored **0**, margin 49. Interstellar (same windows as
proportions of the duration): stream 2 scored **31** (`vale` ×5, `a por`, twelve present-perfect
forms), stream 3 scored **0**, margin 31. Jurassic Park III: stream 2 scored **2**, stream 3 scored
**1**, margin 1 — the two tracks carry the same dub, line for line, which REQ-6b now decides as
duplicate (similarity 0.89). The scorer's lone
`-éis` hit on Interstellar is a mis-transcription (`Quéis`); the margin holds without it.

## Contract obligations

The worker consumes the following from `../spec.md`:

- `EncodeJobDetails.audioVariantDetection: Boolean!` — a missing field reads as `false` (log once).

Nothing else crosses the boundary: the verdict lives in `111`'s store.

## Tests

Owed under Article IX, `worker` agent:

- `src/encode/audio-variant-score.spec.ts`:
  - On the fixture transcripts, each film decides the manifest's verdict.
  - A transcript with 40 repeated `¡Ah!` lines scores the same as without them.
  - Two equal transcripts are undecided.
  - `os` inside a word (`osos`) does not count. Word boundaries are what a silent mis-score hides
    behind.
- `src/encode/audio-variant.spec.ts`, with `runFfmpegCapture` mocked:
  - The opt-in is off → no capture calls.
  - One or three unresolved streams → no capture calls.
  - Streams resolved by their titles are excluded.
  - A stored verdict (including undecided) → no capture calls, and the map comes from the store.
  - A stored verdict for another file (different size or mtime) → detection runs.
  - `whisper-cli` fails → an empty map, nothing stored.
  - Abort → `EncodeCancelledError` propagates, nothing stored.
  - The store read or write fails → detection runs and the map is still returned.
  - Both decided and undecided verdicts are written to the store.
- `src/jobs/encode.job.spec.ts`: a missing `audioVariantDetection` normalizes to `false`.

Owed, `ffmpeg` agent:

- The new corpus case.
- `variants.spec.ts`: a map entry overrides `detectVariant` for that index only, and a stream
  absent from the map still reads its title markers.

Not owed: the Dockerfile stage. `bin/build prod worker` plus `whisper-cli --help` in the built
image verify it, and a broken build fails loudly.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments worker
bin/build prod worker
docker run --rm perceptor-worker:local-prod /opt/whisper/whisper-cli --help
```

All are clean, AC-1 to AC-3 decide correctly on the dev stack, and AC-11's wall time is recorded
here, at 10 minutes or less.

## T005 build record (infra)

- whisper.cpp tag: `v1.9.5` (latest stable release on 2026-10-29), built with `-DGGML_NATIVE=OFF` (no `-march=native`, so the same stage builds on amd64 and arm64), target `whisper-cli` only, RPATH `$ORIGIN`.
- Model: `ggml-small-q5_1.bin`, Hugging Face `ggerganov/whisper.cpp` revision `5359861c739e955e79d9a303bcbc70fb988958b1`, 190085487 bytes, SHA-256 `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb` (checked with `sha256sum -c` in the `whisper` stage).
- Installed at `/opt/whisper/` (`whisper-cli`, `libwhisper.so*`, `libggml*.so*`, the model); `base` also adds `libstdc++` and `libgomp`.
- Image size (`docker image ls`, uncompressed): published `perceptor-worker:latest` 744MB, `local-prod` after T005 1.13GB. The model and binaries account for about 195MB of that; the rest of the delta is not from this stage and the baseline is a different build, so re-measure against a same-commit prod build if exactness matters.
- arm64 was not built here (host is amd64); the stage uses no amd64-specific flags.

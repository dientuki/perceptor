---
title: Audio Language Detection — worker slice
service: worker
last_updated: 2026-11-19
status: Implemented
---

# PLAN: Audio Language Detection — `worker` (`worker/plan.md`)

## Scope

The worker identifies the spoken language of untagged or `und` audio candidates when the
original-language rule would otherwise fail, re-labels the probe metadata with what it decided, and
raises `error.encode.original_audio_undetermined` when a candidate stays undecided. It also adds the
VAD binary and model to its image. It does **not** touch `api` (the key travels through
`encodeFailed` as an opaque string) or `web`'s catalogs (the `web` slice adds the two entries in
parallel).

Writes are confined to `services/worker/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/Dockerfile` | Modified | The `whisper` stage also builds `whisper-vad-speech-segments` and downloads the Silero VAD model, pinned by revision and SHA-256 |
| `services/worker/src/encode/audio-language.ts` | New | The resolver: gate, store read, two attempts, store write, re-labelled metadata, REQ-6's undetermined throw |
| `services/worker/src/encode/audio-language-score.ts` | New | Pure parts: window starts, the `--detect-language` and VAD output parsers, the vote rule, speech-window selection |
| `services/worker/src/encode/encode.ffmpeg.ts` | Modified | Calls the resolver first, after `onProbe`, and passes only the re-labelled metadata onward |
| `services/worker/src/encode/verdict-store.ts` | Modified | `audio-language` joins `VERDICT_KINDS` |
| `services/worker/src/ffmpeg/params.ts` | Modified | The candidate filter and `hasOriginal` test move into an exported helper; `selectAudioStreams` uses it with no behaviour change |
| `services/worker/src/ffmpeg/iso639.ts` | Modified | ISO 639-1 → 639-2/B table for every whisper language, plus a lookup function |
| `services/worker/src/i18n/error-keys.ts`, `messages.en.ts` | Modified | `ERROR_ENCODE_ORIGINAL_AUDIO_UNDETERMINED` and its English text, verbatim from `spec.md` |
| `services/worker/src/encode/__fixtures__/` (or the folder the existing whisper tests use) | New | Captured real stderr/stdout of `whisper-cli --detect-language` and `whisper-vad-speech-segments` |
| `docs/spec/features/122-audio-language-detection/worker/calibration.md` | New | The measured probabilities, times and image sizes, and the constants chosen from them |

## Existing code to reuse

- `src/encode/audio-variant.ts` (`110`) — the template for the whole resolver: `WHISPER_MODEL` and
  `WHISPER_BINARY_DIR`, the `mkdtemp` + `finally rm` temp folder, the per-window extraction with
  `-ss`/`-t` and the centre-channel `pan=mono|c0=FC` downmix (`hasCentreChannel`,
  `buildWindowExtractArgs`), the store read/write, the log-and-fall-back catch. Reuse
  `hasCentreChannel` by exporting it rather than copying it. The window geometry differs (30 s, one
  WAV per window), so the extraction builder is new but follows the same argument shape.
- `src/ffmpeg/capture.ts` — `runFfmpegCapture(args, signal, { binary: 'whisper-cli' })` already
  spawns whisper with cancellation and keeps stderr. Add `'whisper-vad-speech-segments'` to
  `CaptureOptions.binary`'s union.
- `src/encode/verdict-store.ts` (`111`) — `fileIdentity`, `readVerdict`, `writeVerdict`. No Redis
  code of its own.
- `src/encode/cancellation.ts` — `EncodeCancelledError` is the only error that escapes the resolver.
- `src/i18n/keyed-error.ts` + `messages.en.ts`'s `renderMessage` — how the undetermined error is
  thrown, the same as `selectAudioStreams`'s `no_original_audio` throw.
- `src/ffmpeg/iso639.ts`'s `normalizeIso3` — every comparison still goes through it, and the new
  table maps to the /B form it canonicalises to.

## Steps

1. **Image.** In the Dockerfile's `whisper` stage, build the `whisper-vad-speech-segments` target
   beside `whisper-cli` and copy it to `/out`. Download the Silero model whisper.cpp documents for
   VAD (`ggml-silero-v5.1.2.bin` from `ggml-org/whisper-vad` on Hugging Face) pinned to a commit
   revision with a `sha256sum -c` check, as the existing model is. Build the image
   (`bin/build prod worker`) and record its size before and after. Then run both binaries inside it
   on a short WAV and save their real output as fixtures. **If the target does not exist at
   `v1.9.5`, or the model is not where whisper.cpp documents it, stop and report.** Do not
   substitute another VAD.
2. **Shared definition of "original present".** Extract from `selectAudioStreams` an exported
   helper that returns the audio candidates and whether one is in the original language, using the
   same normalisation and title blacklist. `selectAudioStreams` calls it. The existing params tests
   must pass unchanged.
3. **Language table.** Add the ISO 639-1 → 639-2/B lookup for every language in whisper.cpp's
   language list. Whisper's non-ISO codes (`jw` for Javanese, `haw`, `yue`, …) map to their 639-2
   codes where one exists, and are left unmapped otherwise.
4. **Pure scoring module** (`audio-language-score.ts`):
   - window starts: three 30 s windows centred at 25/50/75 % of the duration, clamped to
     `[0, duration − 30]`;
   - a parser for `--detect-language`'s line (`auto-detected language: xx (p = 0.nnn)`), taken from
     the captured fixture. Output with no such line is a parse failure, not a no-vote;
   - the vote rule from REQ-3, with `VOTE_THRESHOLD` and `MIN_VOTES` as exported constants (start at
     0.8 and 2, then set from the calibration);
   - the VAD output parser and the speech-window picker: sum speech seconds inside each candidate
     30 s window on a 1 s grid, and greedily take the three best non-overlapping windows. If total
     speech is under 30 s, the attempt is not valid.
5. **Resolver** (`audio-language.ts`), exported `resolveAudioLanguages(details, input, metadata,
   signal)` returning `{ metadata, undetermined: number[] }`:
   - **Gate.** Leave the input untouched (return it as is) unless compression is on, the step 2
     helper says no original is present, and candidates exist: audio streams with a missing or
     `und` tag whose title does not hit the blacklist and whose `disposition.comment` is not 1.
   - **Per candidate, in stream order:** read the `audio-language` verdict, keyed by `{ ...file,
     stream: index, rev: DETECTOR_REVISION }`. If none is stored, run attempt 1 and, only if it is not
     valid, attempt 2. Store `{ iso3 }` or `{ undecided: true }`. A thrown error other than
     cancellation means "not run" for that candidate: log it, store nothing, and leave it neither
     decided nor undetermined.
   - **Re-label.** Return a deep copy of the metadata with each decided candidate's
     `tags.language` set to its code, and the list of undecided indices.
   - **REQ-6.** After re-labelling, re-run the step 2 helper. If there is still no original and the
     undecided list is non-empty, throw
     `KeyedError(ERROR_ENCODE_ORIGINAL_AUDIO_UNDETERMINED, …, { iso3: details.originalLanguageIso3 })`.
     Otherwise return, and `buildFfmpegCommand` raises `no_original_audio` as today when nothing
     was rescued.
   - **REQ-10.** Log one line per candidate: the attempt, each window's code and probability, and the
     verdict, or `(reused)`.
6. **Driver.** In `encode.ffmpeg.ts`, call the resolver right after `onProbe`. Rebind the metadata
   used by every later call (grain, dub trim, audio variants, stream-end trim, subtitle pruning,
   `buildFfmpegCommand`, the duration) to the returned copy. Progress stays at 0, since nothing
   reports progress before FFmpeg (REQ-10).
7. **Key.** Add `ERROR_ENCODE_ORIGINAL_AUDIO_UNDETERMINED = 'error.encode.original_audio_undetermined'`
   and its English text to `messages.en.ts`, and its params to `messages.en.spec.ts`'s
   `KNOWN_PARAMS` (`{ iso3: 'eng' }`).
8. **Calibration.** Follow `../plan.md` § Verification step 1. Write `calibration.md`, set
   `VOTE_THRESHOLD`/`MIN_VOTES`, and bump `DETECTOR_REVISION` whenever a constant changes.

## Contract obligations

The worker produces, and nothing else consumes beyond `api` relaying it:

- `encodeFailed` with `errorKey: 'error.encode.original_audio_undetermined'` and `errorParams:
  { iso3 }`, where `iso3` is `originalLanguageIso3` exactly as received. It is thrown only under
  REQ-6's condition: no original-language stream after re-labelling, and at least one undecided
  candidate.
- `error.encode.no_original_audio` keeps its exact key, params and throw site. The undetermined key
  never replaces it when every candidate was decided, or when detection failed to run.
- No new field is read from `EncodeJobDetails`.

## Tests

Owed under Article IX, because each defends a failure that produces no error anywhere:

- `src/encode/audio-language-score.spec.ts`
  - the `--detect-language` parser against the captured fixture: a real line parses, a missing line
    is a parse failure and not a no-vote;
  - the vote rule: below the threshold no vote; two agreeing votes decide; a disagreement or too few
    votes is undecided; an unmapped code is undecided;
  - the VAD parser against its fixture, and the window picker: non-overlapping windows, the best
    three, under 30 s of speech is not valid.
- `src/encode/audio-language.spec.ts`, with the capture runner and the store mocked as
  `audio-variant.spec.ts` does:
  - the gate does not run when an original stream is present, when a stream is tagged other than
    `und` (NFR-4), when compression is off, or for a commentary title or `disposition.comment`;
  - attempt 2 runs only when attempt 1 is not valid;
  - a decided candidate comes back re-labelled and the input object is not mutated;
  - REQ-6: undecided plus no original throws the new key; all decided with none original does not
    throw (the later selection does); a detection error stores nothing and does not throw the new
    key;
  - a stored verdict is reused with no spawn; `rev` is part of the identity;
  - cancellation propagates and nothing is stored.
- `src/encode/encode.ffmpeg.spec.ts` (or the driver's existing spec) — a decided candidate reaches
  `buildFfmpegCommand` tagged, so the output gets `language=<iso3>` (the silent "decided but still
  dropped" risk).
- `src/ffmpeg/iso639.spec.ts` — every mapped value is three lowercase letters and goes through
  `normalizeIso3` unchanged.
- `src/i18n/messages.en.spec.ts` — covered by its existing every-key checks once step 7 adds the
  params.
- `src/ffmpeg/params.spec.ts` (existing) — must still pass unchanged after step 2. That is the
  regression guard for `011`.

Not owed: the Dockerfile change. It fails loudly at build time (`sha256sum -c`, a missing target),
and AC-3 exercises the binary live.

## Done when

```bash
docker run --rm --user 1000:1000 -v "$PWD/services/worker":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c 'npx --no tsc --noEmit && npx vitest run'
```

```bash
bin/comments worker
```

```bash
bin/build prod worker
```

Typecheck is clean and the whole suite passes, including the new specs. `bin/comments` is clean, so
new code carries only `// Spec 122, REQ-n` locators. The prod image builds, and `calibration.md`
records the measured numbers and the constants chosen.

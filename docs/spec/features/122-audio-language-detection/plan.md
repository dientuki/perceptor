---
title: Audio Language Detection — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-11-19
status: Implemented
---

# PLAN: Audio Language Detection (`plan.md`)

## Approach

The feature is one more pre-encode resolver in the worker's encode driver
(`services/worker/src/encode/encode.ffmpeg.ts`), next to `094`'s grain, `098`'s dub trim, `099`'s
stream-end trim, `102`'s subtitle pruning and `110`'s audio variants. It follows `110`'s shape
(`encode/audio-variant.ts`): a gate, a read from `111`'s verdict store, detection through
`runFfmpegCapture` (which already honours the `AbortSignal` and can spawn `whisper-cli`), a write
back to the store, and a catch that only lets `EncodeCancelledError` through.

The seam is **re-labelling the probe metadata**. The resolver returns a copy of the `ffprobe`
metadata in which every decided candidate's `tags.language` is the detected ISO 639-2/B code. Every
later step then reads that copy instead of the raw one: `110`'s candidate pairing,
`099`'s `selectAudioStreams` call, `buildFfmpegCommand`'s selection, track title
(`trackLanguageTitle`) and `language=` tag (`audioTagArgs`). That is how REQ-5's "exactly as if its
tag were the detected code" holds without touching any of those rules. The alternative, threading
a `Map<index, iso3>` through every audio rule the way `AudioVariantResolution` is threaded, would
change five signatures to say what one re-labelled object already says.

The resolver runs **first**, right after `onProbe`, before grain and dub trim. If REQ-6 ends in
`error.encode.original_audio_undetermined`, the job fails before spending minutes on a grain probe
for an encode that cannot happen. The raw metadata still goes to `onProbe` (`023`'s `FfprobeLog`
records the file as it is, `und` included).

REQ-6's split between the two errors needs to know whether an original-language stream exists. The
candidate filter and the `hasOriginal` test currently live inline in `selectAudioStreams`
(`ffmpeg/params.ts`). They are extracted into an exported helper that `selectAudioStreams` keeps
using unchanged, so the resolver and `011` share one definition of "the original audio is present"
and cannot drift.

Language identification uses the `whisper-cli` binary and `ggml-small-q5_1` model that `110` already
ships. `--detect-language` only reads the first 30 s of its input, so each window is extracted to
its own WAV and identified separately. The second attempt adds whisper.cpp's own VAD example
binary (`whisper-vad-speech-segments`) and the Silero model to the same Dockerfile stage `110`
created. Whisper answers ISO 639-1 codes, so a worker-local 639-1 → 639-2/B table joins
`ffmpeg/iso639.ts`, the file that already owns code normalisation.

Nothing changes in `api`. `encodeFailed` stores `errorKey`/`errorParams` as received, and `web`
translates the key through its catalogs like every other `error.encode.*`.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `worker` | Owns the key, the detection and the image change; the key's English text in `messages.en.ts` is the source the catalogs copy |
| 1 | `web` | Two catalog entries. Can run **in parallel** with `worker`: the key name, params and copy are frozen in `spec.md` |
| 2 | `docs` (orchestrator) | `docs/spec/graphql-contract.md` § "UI internationalization" (worker — encode pipeline row) gains the key; root `CLAUDE.md` Transcode row gains a `122` sentence and ref |
| 3 | verify | Calibration on job 653's file with the built image, then the AC pass |

## Contract Freeze

The spec's contract delta is frozen: one new key, `error.encode.original_audio_undetermined`, with
exactly one param, `iso3` (the title's original language, as `originalLanguageIso3` arrives, the
same value `no_original_audio` passes). Things an implementer will want to change and must not:

- **Reusing `error.encode.no_original_audio` for the undetermined case.** From inside the worker it
  looks like the same failure. It is not, for the user: one means "get another release", the other
  "this release might be fine; remux it by hand". REQ-6 is the whole user-visible point.
- **Adding the detected language to `errorParams`.** The undetermined case has no language to name,
  and the `no_original_audio` case keeps its existing param shape. Detected languages go to the log.
- **A setting or `EncodeJobDetails` field to turn detection off.** Out of scope by the spec. No new
  field reaches the worker.

## Migrations

None.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A downstream rule still reads the raw metadata instead of the re-labelled copy | The candidate is decided and logged, but selection still drops it: the job fails with `no_original_audio` and the log says "decided eng". Or it encodes but the output tag reads `und`. No error explains the mismatch | The driver binds one `metadata` name to the re-labelled copy and passes only that onward. A driver-level test asserts that a decided candidate reaches `buildFfmpegCommand` tagged, and AC-1 checks the output's `language=eng` |
| whisper-cli's `--detect-language` output format differs from what the parser expects | Every window parses as "no vote", every candidate is undecided, every untagged file fails with the new key. Looks like a calibration problem, not a bug | Parser tests are written against output captured from the real v1.9.5 binary (worker step 1), not a hand-written string. Unparseable output is a detection failure (REQ-8: logged, nothing stored), not an undecided vote |
| An undecided verdict is cached with provisional thresholds | After the thresholds are tuned, files already judged "undecided" stay undecided for 30 days | The verdict identity carries a detector revision constant. Changing a threshold bumps it, and old verdicts stop matching |
| A cached verdict outlives a changed file | A re-downloaded file at the same path reuses a stale language | `111`'s identity already includes size and mtime |
| The VAD example binary is not built at v1.9.5, or prints a different format | The second attempt always errors, so it is treated as "detection failed" and falls back to `no_original_audio` for files the first attempt could not decide. Silent unless someone reads the log | Worker step 1 builds the target and captures its real output before any parser is written. If the target does not exist at v1.9.5, the implementer stops and reports rather than substituting another VAD |
| Whole-track VAD extraction fills the container's temp dir | A 3 h film is about 350 MB of 16 kHz mono WAV in `os.tmpdir()`. A full disk fails extraction | A failure is REQ-8's silent fallback, and the WAV is removed in `finally` like `110`'s windows. The size is recorded in the calibration notes |
| The ISO 639-1 → 639-2/B table misses a code whisper returns | That language is reported as undecided rather than decided | The table covers every language whisper.cpp's `whisper_lang_id` list contains, and a test checks that all mapped values are three letters. An unmapped code is undecided by REQ-3, which errs toward not guessing |
| A file with several `und` tracks multiplies the cost | Each candidate costs one attempt, two for hard ones | Accepted. NFR-2 is per candidate; the calibration notes record the total for job 653 (two `und` tracks, one excluded as commentary) |

## Verification

The `ptor` stack on this host is a production install from published images, not this checkout
(see the `measuring-without-dev-stack` note). Tests and typecheck run from a throwaway container
over the bind-mounted service, as uid 1000:

```bash
docker run --rm --user 1000:1000 -v "$PWD/services/worker":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c 'npx --no tsc --noEmit && npx vitest run'
```

```bash
docker run --rm --user 1000:1000 -v "$PWD/services/web":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c 'node scripts/check-messages.mjs'
```

```bash
bin/comments worker
```

```bash
bin/build prod worker
```

Then the manual pass:

1. **Calibration (before tuning constants).** Run the built `perceptor-worker:local-prod` image with
   job 653's download folder mounted read-only and run the first attempt's commands by hand on
   stream 1 and stream 2. Record each window's language and probability, the wall time, and the
   image size before and after, in `worker/calibration.md`. Do the same for the AC-3/AC-4/AC-5
   fixtures. Fixtures are built with `ffmpeg` in the scratchpad and never committed:
   - **AC-3:** job 653's main track, with no language tag, and `volume=0` on the three 30 s windows
     at 25/50/75 %;
   - **AC-4:** a music-only track (any score-only stretch of a library film, or `anoisesrc`), with no
     tag;
   - **AC-5:** a French-tagged dub from the library with its tag removed.
   Set the vote threshold and the minimum vote count from those numbers.
2. **After a release that carries the change**, on `ptor`: press Play on job 653's row in
   `/downloads` (AC-1), retry again (AC-2, plus `redis-cli --scan --pattern
   'perceptor:encode:audio-language:*'`), and check AC-6 on any tagged film that encodes normally.
3. **AC-7 to AC-9** run in a throwaway worker container against the fixtures: an unreadable model
   path (AC-7), `compression_enabled` off (AC-8), and a delete while the log shows detection running
   (AC-9, then `ps` shows no `whisper-cli`).

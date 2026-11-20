---
title: Audio Language Detection — Tasks
last_updated: 2026-11-19
status: In Progress
---

# TASKS: Audio Language Detection (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation, live passes and measurement. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Inside `[worker]` there are two territories, as in `110`:

- **(ffmpeg)** tasks touch `src/ffmpeg/` or the case corpus `services/worker/ffmpeg/`, and are
  dispatched to the `ffmpeg` agent.
- **(encode)** tasks touch `src/encode/`, `src/i18n/` or `fixtures/`, and go to the `worker` agent.

The Dockerfile is `[infra]`. `worker/plan.md` step 1 lists it in the worker slice; it is split out
here because `services/*/Dockerfile` belongs to `infra`.

Tests and typecheck run from a throwaway container, because the stack on this host (`ptor`) is a
production install, not this checkout:

```bash
docker run --rm --user 1000:1000 -v "$PWD/services/worker":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c '<command>'
```

Below, `‹worker›` means that command.

## Tasks

### Group 1 — image, shared helpers and the error key

None of these read anything another task produces. The contract (one error key) is frozen in
`spec.md`.

- [x] **T001** `[infra] [P]` Per `worker/plan.md` step 1: in `services/worker/Dockerfile`'s `whisper`
      stage, also build the `whisper-vad-speech-segments` target and copy it to `/out`. Download the
      Silero VAD model (`ggml-silero-v5.1.2.bin`, `ggml-org/whisper-vad` on Hugging Face), pinned by
      commit revision with a `sha256sum -c` check, the same way as `ggml-small-q5_1.bin`. Record the
      revision, the SHA-256 and the image size before and after in
      `docs/spec/features/122-audio-language-detection/worker/calibration.md`. **If the target does not
      exist at `v1.9.5`, or the model is not published there, stop and report.** Do not substitute
      another VAD.
      *Done when:* `bin/build prod worker` succeeds, and
      `docker run --rm perceptor-worker:local-prod whisper-vad-speech-segments --help` prints usage, and
      `ls /opt/whisper` in the image lists the Silero model.
- [x] **T002** `[worker] [P]` **(ffmpeg)** Per step 2: extract from `selectAudioStreams`
      (`src/ffmpeg/params.ts`) an exported helper that returns the audio candidates and whether one
      is in the original language, with the same normalisation and title blacklist.
      `selectAudioStreams` uses it. No behaviour change.
      *Done when:* `‹worker› npx vitest run src/ffmpeg ffmpeg` passes with no expectation edited (the
      `params.spec.ts` suite and the case corpus).
- [x] **T003** `[worker] [P]` **(ffmpeg)** Per step 3: add to `src/ffmpeg/iso639.ts` the ISO 639-1 →
      639-2/B lookup for every language in whisper.cpp's language list (unmapped codes return
      `undefined`), and `iso639.spec.ts` cases: every value is three lowercase letters and is unchanged
      by `normalizeIso3`; `en`→`eng`, `fr`→`fre`, `es`→`spa`; an unknown code is `undefined`.
      *Done when:* `‹worker› npx vitest run iso639` passes.
- [x] **T004** `[worker] [P]` **(encode)** Per step 7: add
      `ERROR_ENCODE_ORIGINAL_AUDIO_UNDETERMINED = 'error.encode.original_audio_undetermined'` to
      `src/i18n/error-keys.ts`, its English text (verbatim from `spec.md`) to `messages.en.ts`, and
      `{ iso3: 'eng' }` to `messages.en.spec.ts`'s `KNOWN_PARAMS`.
      *Done when:* `‹worker› npx vitest run messages.en` passes.
- [x] **T005** `[web] [P]` Per `web/plan.md` steps 1–2: add `errors.encode.original_audio_undetermined`
      to `messages/en.json` and `messages/es.json`, with the copy verbatim from `spec.md`.
      *Done when:* `docker run --rm --user 1000:1000 -v "$PWD/services/web":/app -w /app -e HOME=/tmp
      node:24.18.0-alpine node scripts/check-messages.mjs` exits 0.

### Group 2 — detection

- [x] **T006** `[worker]` **(encode)** Per step 1's second half: with the image from T001, run
      `whisper-cli -m /opt/whisper/ggml-small-q5_1.bin -l auto --detect-language -f <wav>` and
      `whisper-vad-speech-segments` on a short speech WAV and on a silent one. Save their real stdout
      and stderr under `services/worker/fixtures/audio-language/`. Use a few seconds of public-domain
      speech or a generated sample, never a clip from a library film. → T001
      *Done when:* the fixture files exist and show a detected-language line and a list of speech
      segments.
- [x] **T007** `[worker]` **(encode)** Per step 4: add `src/encode/audio-language-score.ts`:
      - window starts (three 30 s windows at 25/50/75 %, clamped);
      - the `--detect-language` parser, where a missing line is a parse failure, not a no-vote;
      - the vote rule, with exported `VOTE_THRESHOLD = 0.8`, `MIN_VOTES = 2` and
        `DETECTOR_REVISION = 1`;
      - the VAD output parser and the three-best non-overlapping 30 s window picker (1 s grid, under
        30 s of speech is not valid).
      Write `audio-language-score.spec.ts` with the cases in `worker/plan.md` § Tests, the parsers
      tested against T006's fixtures. → T003, T006
      *Done when:* `‹worker› npx vitest run audio-language-score` passes.
- [x] **T008** `[worker]` **(encode)** Per step 5:
      - add `audio-language` to `VERDICT_KINDS` and `'whisper-vad-speech-segments'` to `capture.ts`'s
        `binary` union;
      - export `hasCentreChannel` from `audio-variant.ts`;
      - write `src/encode/audio-language.ts`'s `resolveAudioLanguages(details, input, metadata,
        signal)` → `{ metadata, undetermined }`: the gate, the per-candidate store read and write
        (identity `{ ...file, stream, rev }`), attempt 1, then attempt 2 only if attempt 1 is not
        valid, the re-labelled deep copy, REQ-6's undetermined throw, REQ-8's not-run posture and
        REQ-9's cancellation.
      Write `audio-language.spec.ts` with the cases in `worker/plan.md` § Tests.
      → T002, T004, T007
      *Done when:* `‹worker› npx vitest run audio-language` passes.
- [x] **T009** `[worker]` **(encode)** Per step 6: in `encode.ffmpeg.ts`, call `resolveAudioLanguages`
      right after `onProbe`, and rebind the metadata every later call reads (grain, dub trim, audio
      variants, stream-end trim, subtitle pruning, `buildFfmpegCommand`, duration) to the returned
      copy. Add the driver test: a decided candidate reaches `buildFfmpegCommand` tagged, and the
      args carry `language=<iso3>` for it. → T008
      *Done when:* `‹worker› sh -c 'npx --no tsc --noEmit && npx vitest run'` passes in full, and
      `bin/comments worker` is green.

### Group 3 — calibration

- [x] **T010** `[docs]` Per `plan.md` § Verification step 1:
      1. Build `perceptor-worker:local-prod` with T009 in it.
      2. Build the fixtures in the scratchpad: AC-3 (job 653's main track, untagged, silenced at
         25/50/75 %), AC-4 (music only, untagged) and AC-5 (a French dub, its tag removed).
      3. Run attempt 1 by hand on job 653's streams 1 and 2 (the download folder read-only) and on
         each fixture, and attempt 2 on the AC-3 and AC-4 fixtures.
      4. Write each window's code and probability, the wall times and the WAV sizes into
         `worker/calibration.md`, and propose `VOTE_THRESHOLD`/`MIN_VOTES` from those numbers.
      → T009
      *Done when:* `calibration.md` holds the measured table and a proposed pair of constants that
      decides 653 and AC-3 as `eng`, AC-5 as `fre`, and leaves AC-4 undecided. If no pair does, the
      task goes to § Blocked with the numbers rather than forcing a threshold.
- [x] **T011** `[worker]` **(encode)** Set `VOTE_THRESHOLD`/`MIN_VOTES` to `calibration.md`'s values,
      and bump `DETECTOR_REVISION` if either changed. → T010
      *Done when:* `‹worker› npx vitest run audio-language` passes, with any expectation that pinned the
      old constants updated to the new ones.

### Group 4 — verification and docs

- [x] **T012** `[docs]` Driver-level pass in a throwaway container of the image rebuilt with T011,
      running `encodeFfmpeg` from a small `tsx` script with stub details (`originalLanguageIso3: 'eng'`,
      `allowedAudioLanguagesIso3: ['eng', 'spa']`, compression on) and `ENCODE_SAMPLE_SECONDS=60`:
      - **AC-3:** the fixture logs attempt 1 not valid, then VAD, then `eng`, and the output's
        `ffprobe` shows `language=eng`;
      - **AC-4:** throws `error.encode.original_audio_undetermined`;
      - **AC-5:** throws `error.encode.no_original_audio`;
      - **AC-6:** a file tagged `eng` logs no detection, and one tagged `fre` throws `no_original_audio`
        with no detection;
      - **AC-7:** the model path unreadable → `no_original_audio`, a logged failure, no
        `audio-language` key in a throwaway Redis;
      - **AC-8:** compression off moves the file with no detection logged;
      - **AC-9:** abort during detection → no `whisper-cli` left in `ps`, no key written.
      → T011
      *Done when:* each AC above has its observed result written next to it in `spec.md`.
- [x] **T013** `[docs] [P]` Add `error.encode.original_audio_undetermined` (`{iso3}`, `122`) to
      `docs/spec/graphql-contract.md` § "UI internationalization", worker — encode pipeline row.
      *Done when:* the row lists the key beside `no_original_audio`.
- [x] **T014** `[docs]` Update `services/worker/CLAUDE.md` (a section on the language resolver, the
      re-labelled metadata seam and its place first in the driver, plus its § Layout rows). Add a
      `122` sentence and ref to the root `CLAUDE.md` Transcode row. → T011
      *Done when:* `bin/comments` is green, and the root table cites `122` on the Transcode row.
- [ ] **T015** `[docs]` **Live pass, after a release that ships T011**, on `ptor`:
      - **AC-1:** Play on job 653's row in `/downloads`; it completes, and `ffprobe` of the library
        file shows `language=eng` and no commentary;
      - **AC-2:** Retry again; the log shows `(reused)`, and `redis-cli --scan --pattern
        'perceptor:encode:audio-language:*'` lists the key;
      - **AC-4 copy:** `/downloads` shows the Spanish message for a job that fails with the new key.
      → T012, a release
      *Done when:* AC-1, AC-2 and AC-4's UI line are observed, or this task lands in § Blocked naming
      the release.
- [x] **T016** `[docs]` Walk the acceptance criteria in `spec.md`, tick each one observed, and set
      `status: Implemented` on `spec.md`, `plan.md`, `worker/plan.md` and `web/plan.md`. Run
      `/pending-acs`. → T012, T013, T014, T015
      *Done when:* every AC is ticked or carries a named blocker in `docs/spec/pending-acs.md`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T015 | docs | The live pass runs on `ptor`, a published-image install that does not contain this checkout; it was also stopped on this host | A release (`v0.7.0-rc2` or later) carrying T011, `ptor` updated and running |

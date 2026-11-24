---
title: Audio Language Detection
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-11-19
last_updated: 2026-11-19
status: Implemented
services: [worker, web]
---

# SPEC: Audio Language Detection (`spec.md`)

## Context & Goal

Spec `011` REQ-6 fails an encode when no audio track is in the title's original language
(`error.encode.no_original_audio`). The check trusts the track's `language` tag: in
`worker/src/ffmpeg/params.ts`, `selectAudioStreams` keeps only streams whose tag is in the allowed
languages, so a stream with no tag, or tagged `und`, is never a candidate and can never satisfy the
rule. Production job 653 shows the cost. *Fantastic Four* (2005), a 1080p BluRay remux, carries a
DTS-HD MA 5.1 main track and an AC3 2.0 cast commentary, and neither track has a language tag. The
main track is in English, the film's original language, but the job failed with
`error.encode.no_original_audio {"iso3":"eng"}`, and retrying it (`065`) fails the same way. Today
the only way out is to remux the file by hand with a language set and import it again.

The language is in the audio itself. whisper.cpp, which `110` already bakes into the worker image
with the multilingual `ggml-small-q5_1` model, can identify the spoken language of a 30 s sample
without transcribing it. This feature adds that identification as a pre-encode step in the worker's
encode driver, beside `110`'s variant detection. It runs only when the original-language rule would
fail and the file has untagged, non-commentary tracks. It takes three 30 s samples spread through
the film. If those do not agree, a second attempt uses voice activity detection (VAD) to find the
three 30 s stretches with the most speech and samples those instead. This second attempt covers
films with long stretches of silence or music. A track whose language is decided is treated as if it
carried that tag, for selection and for the `language` tag written to the output. If neither attempt
decides, the encode still fails, but with its own key, so the user can tell "no track in that
language" from "a track whose language could not be identified".

This changes the Transcode stage of the root `CLAUDE.md` pipeline table. `web` gains one error key in
its message catalogs. No GraphQL type, Prisma model or `api` code changes: `api` relays the
worker's `errorKey` as it already does.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (When detection runs)**: The worker runs detection on a job only when all of these
      hold:
      - compression is on (`032`). With compression off no audio selection happens, so there is
        nothing to rescue;
      - no audio stream that `011`'s selection already accepts is in the original language. That is
        exactly the condition under which `error.encode.no_original_audio` fires today;
      - the input has at least one **unlabelled** audio stream, meaning a stream with no `language`
        tag or one tagged `und` (any case);
      - that stream is not a commentary or description track by `011`'s existing title rule
        (`commentary`, `description`, `visual`, `sdh`) or by `disposition.comment`.
      Those unlabelled, non-commentary streams are the **candidates**. A stream with any other
      language tag is never a candidate, even when the tag looks wrong (see Out of Scope).
- [ ] **REQ-2 (First attempt: fixed windows)**: For each candidate, the worker takes three 30 s
      windows of that stream, centred at 25 %, 50 % and 75 % of the input's duration (clamped inside
      the file). It asks whisper.cpp to identify each window's language, with no language forced,
      using the model already in the image (`110`). Each window yields a language and a probability.
- [ ] **REQ-3 (Validity rule)**: A window **votes** only when its probability is at least the vote
      threshold. A window below it (silence, music, noise) does not vote, in either direction. An
      attempt **decides** a candidate when at least the minimum number of windows vote, all voting
      windows agree on one language, and that language maps to an ISO 639-2 code. Otherwise the
      attempt is **not valid** for that candidate. The vote threshold and the minimum number of voting
      windows are provisional: `plan.md` measures them on job 653's file and on the AC-3/AC-4
      fixtures and records the values, starting from a vote threshold of 0.8 and a minimum of 2.
- [ ] **REQ-4 (Second attempt: speech windows)**: Only for a candidate the first attempt did not
      decide, the worker runs one VAD pass over that stream's whole length. It picks the three
      non-overlapping 30 s windows that hold the most detected speech and repeats REQ-2's
      identification on them, judged by REQ-3's rule. The VAD model is the one whisper.cpp ships for
      that purpose (Silero), baked into the image. If VAD finds less than one window's worth of
      speech in the whole stream, the attempt is not valid and no identification runs. There is no
      third attempt.
- [ ] **REQ-5 (A decided candidate)**: A candidate decided by either attempt is treated, for the rest
      of the job, exactly as if its `language` tag were the detected ISO 639-2 code:
      - it takes part in `011`'s selection, including the original-language check;
      - it takes part in every later rule that reads the audio language: `031`'s variant handling,
        `110`'s variant detection, and `099`'s stream-end trim;
      - its track title is the detected language's `Language.trackTitle` (`051`);
      - the output writes the detected code as the track's `language` tag, never `und`.
      A decided candidate in a language that is not allowed for the job is dropped like any tagged
      stream in that language.
- [ ] **REQ-6 (Outcome when nothing is rescued)**: After detection, `011` REQ-6 runs again on the
      result:
      - if an original-language stream now exists, the encode proceeds;
      - if every candidate was decided and none is in the original language, the encode fails with
        `error.encode.no_original_audio`, as today;
      - if at least one candidate stayed undecided after both attempts, the encode fails with the new
        `error.encode.original_audio_undetermined` (`{iso3}`), because that undecided track could be
        the original.
- [ ] **REQ-7 (Persistent verdict, through `111`)**: Each candidate's verdict (decided with a
      language, or undecided) is stored in `111`'s encode-verdict store as a new verdict kind,
      `audio-language`, under `111`'s rules (Redis, `perceptor:encode:` namespace, 30-day TTL, a
      Redis failure reads as "no verdict"). Its identity is the input file (path, size, modification
      time) and the stream index. A stored verdict is used as is and detection is not run again for
      that stream: on a worker restart (`054`), a stopped and resumed encode (`097`), a retried job
      (`065`, `095`) or a BullMQ retry. An undecided verdict is stored too, the same as `110`.
- [ ] **REQ-8 (Failure is silent)**: If detection itself breaks (whisper.cpp or the VAD errors, a
      window cannot be extracted, the output cannot be parsed), that candidate is treated as if
      detection had never run: the job falls back to today's behaviour and fails with
      `error.encode.no_original_audio`, unless another candidate rescues it. The failure is logged
      and nothing is stored for that candidate, so a later run tries again. Failing to store a verdict
      is logged and never fails the encode (`111` NFR-3).
- [ ] **REQ-9 (Cancellation)**: Detection honours the encode's `AbortSignal`. A delete (`047`), stop
      (`097`) or discard (`095`) while it runs terminates whisper.cpp at once. Nothing is stored and
      only `EncodeCancelledError` propagates, the same as `102` and `110`.
- [ ] **REQ-10 (Progress and logs)**: While detection runs, the job reads `ENCODING` with progress 0,
      the same as `100` and `110`. The worker logs, per candidate, which attempt ran, each window's
      language and probability, and the verdict.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (CPU only, offline)**: Detection runs on CPU on every host (spec `024`) and makes no
      network call. The VAD model is baked into the worker image at build time, pinned to a fixed
      revision like the whisper model, and never downloaded at runtime.
- [ ] **NFR-2 (Time budget)**: On the reference host, the first attempt takes at most about 1 minute
      per candidate, and the second attempt (VAD pass included) at most about 3 minutes per
      candidate. Both figures are provisional: `plan.md` measures them on job 653's file and records
      them.
- [ ] **NFR-3 (Image size)**: `plan.md` records the worker image size before and after. The only
      expected addition is the VAD model, a few megabytes.
- [ ] **NFR-4 (Never second-guess a tag)**: A stream that carries a language other than `und` is
      never sampled, never re-labelled and never part of this feature. With an original-language
      stream present, nothing in this feature runs at all.
- [ ] **NFR-5 (Err on not guessing)**: Every ambiguity resolves to "undecided": two windows that
      disagree, too few votes, or an unmapped language. An undecided track is never assumed to be the
      original.
- [ ] **NFR-6 (No backfill)**: Files already in the library are never re-examined. A job that already
      failed with `error.encode.no_original_audio` gets detection when the user retries it after
      this ships.

## GraphQL Contract Delta

None — this feature does not change any GraphQL type, field or operation. `encodeFailed` already
carries a free-form `errorKey` and `errorParams`, and `api` stores and relays them unchanged. The
only addition is one new key in the vocabulary of `docs/spec/graphql-contract.md` § "UI
internationalization" (worker — encode pipeline row):

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| No stream is tagged in the original language and an untagged candidate could not be identified after both attempts (REQ-6) | reported through `encodeFailed`, `errorKey: error.encode.original_audio_undetermined`, `errorParams: {iso3}` | en: `No audio track is tagged with the original language ({iso3}) and the language of the untagged tracks could not be detected` · es: `Ninguna pista de audio está marcada en el idioma original ({iso3}) y no se pudo detectar el idioma de las pistas sin marcar` |
| Every candidate was identified and none is the original language (REQ-6) | existing `error.encode.no_original_audio` (`{iso3}`) | existing copy, unchanged |

What each consumer does with these:

- **`web`**: shows the new key's translated message on the download row's error, the same way it
  shows `error.encode.no_original_audio` today (`065`'s `lastError`). Play still retries the job.
- **`api`**: no change. It stores the key and params as received.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (The production case)**: After this ships, retrying job 653 (*Fantastic Four*, 2005)
      completes. `ffprobe` of the output shows one Opus audio track with `language=eng` and the
      English track title, and no commentary track. The worker log shows the first attempt deciding
      stream 1 as English.
- [ ] **AC-2 (Verdict reused)**: Retrying the same job again (or restarting the worker during its
      encode) logs a stored `audio-language` verdict for stream 1 and no whisper.cpp run. `redis-cli
      --scan --pattern 'perceptor:encode:audio-language:*'` lists the key.
      *Observed 2026-11-20 on a throwaway worker image run (fixture, not job 653): the first run logged `attempt 1 ... not valid`, `attempt 2 ... eng`; an identical second run (same path, size, mtime) logged `stream 1 -> eng (reused)` and spawned nothing; `redis-cli --scan` listed `perceptor:encode:audio-language:ce04e7cc...` with a TTL of 2591989 s. Still to observe on job 653 itself (T015).*
- [x] **AC-3 (Second attempt)**: A fixture with one untagged audio track, with speech only outside
      the 25/50/75 % windows (music or silence inside them), logs the first attempt as not valid,
      then a VAD pass, then a decision. The encode completes with the detected `language` tag.
      *Observed 2026-11-20, driver-level pass (`encodeFfmpeg`, `ENCODE_SAMPLE_SECONDS=60`, fixture from job 653's main track, windows silenced): `attempt 1 en:0.36 en:0.36 en:0.36 -> not valid`, `attempt 2 en:1.00 en:0.99 en:1.00 -> eng`, encode completed, output `ffprobe`: `language=eng`, title `English Stereo (Opus)`.*
- [ ] **AC-4 (Failure: undetermined)**: A fixture whose only audio track is untagged and holds no
      speech (music only) fails with `error.encode.original_audio_undetermined`. `/downloads` shows
      "Ninguna pista de audio está marcada en el idioma original (eng) y no se pudo detectar el idioma
      de las pistas sin marcar" for a Spanish UI.
      *Observed 2026-11-20 at the driver: `attempt 1 en:0.26 en:0.36 en:0.29 -> not valid`, `attempt 2 no speech found -> undecided`, then `KeyedError error.encode.original_audio_undetermined`. The `/downloads` Spanish line is still to observe on `ptor` (T015).*
- [x] **AC-5 (Failure: identified, wrong language)**: A fixture whose only audio track is untagged
      French speech, for a title whose original language is English, fails with
      `error.encode.no_original_audio`, not the new key.
      *Observed 2026-11-20 at the driver (French speech from a library film, tag removed): `attempt 1 fr:0.97 fr:0.80 fr:0.96 -> fre`, then `KeyedError error.encode.no_original_audio`.*
- [ ] **AC-6 (Tags are trusted)**: A file whose audio is tagged `eng` (any real library file) logs no
      detection at all. A file tagged `fre` for an English-original title still fails with
      `error.encode.no_original_audio` and logs no detection.
      *Observed 2026-11-20 on fixtures (not a real library file): a file tagged `eng` logged no detection and encoded with `language=eng`; one tagged `fre` threw `error.encode.no_original_audio` with no detection logged and no Redis key. A real library file is still to observe (T015).*
- [x] **AC-7 (Detection broken)**: With whisper.cpp made to fail (for example, the model path
      unreadable in a throwaway worker container), job 653's file fails with
      `error.encode.no_original_audio` as today, the log names the detection failure, and no
      `audio-language` key is written.
      *Observed 2026-11-20 with the model file moved away in a throwaway container: `[language] stream 1 detection failed: whisper-cli exited with 3`, then `error.encode.no_original_audio`, and zero `audio-language` keys in Redis. Run on a fixture, not job 653's file.*
- [ ] **AC-8 (Compression off)**: With `compression_enabled` off, job 653's file is moved to the
      library as is, with no detection logged.
      *Not observed end to end. At the driver, `compressionEnabled: false` logged no detection (the resolver's gate, also covered by `audio-language.spec.ts`), but the move-as-is path belongs to the job handler and was not exercised. Still to observe (T015).*
- [x] **AC-9 (Cancellation)**: Deleting the source while detection runs stops whisper.cpp (no
      `whisper-cli` process left in the worker container), writes no verdict and reports no outcome.
      *Observed 2026-11-20: aborting 6 s into detection threw `EncodeCancelledError`, left 0 `whisper`/`ffmpeg` processes in the container, and wrote 0 `audio-language` keys.*

## Out of Scope

- **Wrongly tagged tracks.** A track tagged `fre` that is really English (the `115` DVD case) is not
  re-checked. Doing it for every tagged track would cost a detection on every encode to fix a rare
  release error, and it would mean distrusting metadata that is right almost always.
- **Untagged tracks when the original is present.** If the file already has an original-language
  track, an untagged dub alongside it is dropped as today rather than identified. Rescuing it would
  run detection on many more files for a track the user did not need to get the film.
- **Untagged subtitle tracks.** Subtitles have their own selection (`070`, `102`, `118`). Identifying
  their language from text is a separate feature.
- **A third attempt or a full transcription.** Two attempts bound the cost. A file that defeats both
  is rare enough that the hand remux remains its answer.
- **A setting or per-title switch.** Detection only runs where the encode would otherwise fail, so
  there is nothing for an administrator to trade off. It is always on with compression, like `102`.
- **Writing the language back to the source file or the database.** The verdict lives in `111`'s
  store and in the output file's tags only. `108`'s library probe will read the corrected tag from
  the output like any other.

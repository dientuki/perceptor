---
title: Audio Variant Detection — Tasks
last_updated: 2026-10-29
status: In Progress
---

# TASKS: Audio Variant Detection (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation, live passes and measurement. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Inside `[worker]` there are two territories (`worker/plan.md` § Scope):

- **(ffmpeg)** tasks touch `src/ffmpeg/`, the case corpus `services/worker/ffmpeg/` or
  `.claude/agents/ffmpeg.md`, and are dispatched to the `ffmpeg` agent.
- **(encode)** tasks touch `src/encode/`, `src/jobs/`, `fixtures/` or the worker `CLAUDE.md`, and go
  to the `worker` agent.

The Dockerfile stage is `[infra]`.

## Tasks

### Group 1 — contract and schema (`api`)

Prerequisite: spec `111` (encode verdict persistence) is implemented. T009 writes into its store.

- [x] **T001** `[api]` Per `api/plan.md` step 1: add `User.audioVariantDetection` (default
      `false`) and the `<ts>_audio_variant_detection` migration.
      *Done when:* `bin/cli api npx prisma migrate status` reports the schema up to date, and
      `bin/mysql -e 'describe users'` shows the column.
- [x] **T002** `[api]` Per step 2: add `Language.hasRegionalVariants`, set by both `Language`
      builders in `src/languages/languages.service.ts` from `regionalVariantIso3s()`, with its spec
      cases. → T001
      *Done when:* `bin/npm api test -- languages` passes with `es`/`es-419`/`es-ES` reading true and
      `en` reading false.
- [x] **T003** `[api]` Per step 3: add `UserPreferences.audioVariantDetection`,
      `UsersService`/`PreferencesService.setAudioVariantDetection` and the
      `setAudioVariantDetection` mutation, with the round-trip spec. → T001
      *Done when:* `bin/npm api test -- preferences` passes, and `schema.gql` shows the field and the
      mutation exactly as in `spec.md`.
- [x] **T004** `[api]` Per step 4: add `EncodeJobDetails.audioVariantDetection` (effective
      opt-in from the existing owners select) and the `process-jobs.service.spec.ts` cases listed in
      `api/plan.md` § Tests.
      → T002
      *Done when:* `bin/npm api test` and `bin/cli api npx --no tsc --noEmit` pass, `bin/comments api`
      is green, and `git diff services/api/src/schema.gql` is exactly `spec.md` § GraphQL Contract
      Delta.

### Group 2 — consumers and engine

Everything that reads GraphQL depends on Group 1. T005, T006 and T007 do not, so they start as soon
as the contract is frozen (it is: `spec.md` is Approved).

- [x] **T005** `[infra] [P]` Per `worker/plan.md` step 1: add a `whisper` stage to
      `services/worker/Dockerfile`:
      - whisper.cpp at a pinned release tag, built with `-DGGML_NATIVE=OFF`;
      - `ggml-small-q5_1.bin` from a pinned Hugging Face revision, checked with `sha256sum -c`;
      - `base` copies `whisper-cli`, its shared libraries and the model into `/opt/whisper/`.
      Record the tag, the revision, the SHA-256 and the image size before and after in
      `worker/plan.md`.
      *Done when:* `bin/build prod worker` succeeds, and
      `docker run --rm perceptor-worker:local-prod /opt/whisper/whisper-cli --help` prints usage.
- [x] **T006** `[worker] [P]` **(encode)** Per step 2: add `src/encode/audio-variant-detectors.ts`
      (the registry, one Spanish entry) and the pure `src/encode/audio-variant-score.ts`
      (`dedupeLines`, `similarity`, `score`, `decide`). Build `fixtures/audio-variant/` from the prototype
      transcripts, word-scrambled with the markers preserved, plus a `manifest.json`. Write
      `audio-variant-score.spec.ts`. The transcripts are
      `/tmp/claude-1000/-home-dientuki-www-perceptor/bf586075-6252-4a3d-aba8-fcc32334830a/scratchpad/out/track2.txt`
      and `/tmp/claude-1000/-home-dientuki-www-perceptor/bf586075-6252-4a3d-aba8-fcc32334830a/scratchpad/out/track3.txt`
      for It Chapter Two, plus `/tmp/claude-1000/-home-dientuki-www-perceptor/bf586075-6252-4a3d-aba8-fcc32334830a/scratchpad/out2/`
      for the other two films once they exist.
      *Done when:* `bin/npm worker test -- audio-variant-score` passes, with It Chapter Two deciding
      stream 2 = `es-ES`, Interstellar deciding stream 2 = `es-ES`, Jurassic Park III deciding
      duplicate, It Chapter Two and Interstellar never duplicate, repeated-line inflation neutral, and
      `osos` not counted as `os`.
- [x] **T007** `[worker] [P]` **(ffmpeg)** Per step 5:
      1. Confirm the corpus is green.
      2. Add a required `audioVariants: AudioVariantResolution` to `buildFfmpegCommand` →
         `getAudioParams` → `selectAudioStreams`: drop the `duplicates` streams from the candidates,
         and compose `tags` with `detectVariant` in `variants.ts` as the `detect` used by
         `narrowToVariants` and audio `trackLanguageTitle`. Pass an empty resolution at every
         existing call site, and confirm the corpus is still green.
      3. Add `'whisper-cli'` to `capture.ts`'s `binary` union.
      4. Add the `variants.spec.ts` cases.
      *Done when:* `bin/npm worker test -- cases variants` passes with no expectation edited.
      *Note (T010):* `src/encode/stream-end-trim.ts` (099) is a second caller of `selectAudioStreams`; it
      currently passes the empty resolution. T010 decides whether it gets the resolved map.
- [x] **T008** `[worker]` **(ffmpeg)** Add the It Chapter Two corpus case: its verbatim ffprobe, a
      `{2: 'es-ES', 3: 'es-419'}` map and `es-419` requested, expecting a command that keeps only
      stream 3, titled `Latino Surround 5.1 (Opus)`. Do it **with the user**, per `ffmpeg.md`
      § Adding a case. Add the Jurassic Park III case the same way: its ffprobe and
      `duplicates: {3}`, expecting only stream 2, titled `Español Surround 5.1 (Opus)`. Amend
      `ffmpeg.md` § L1: metadata labelling stays unconditional, and
      audio-derived labelling is gated by the opt-in. → T007
      *Done when:* `bin/npm worker test -- cases` passes, including the new case.
- [ ] **T009** `[worker]` **(encode)** Per step 3: add the `audio-variant` verdict kind to `111`'s
      store and `src/encode/audio-variant.ts` `resolveAudioVariants`. It covers the gating, the
      store read (undecided counts as found), window extraction to an `mkdtemp` directory via
      `runFfmpegCapture`, `whisper-cli` via `runFfmpegCapture`, scoring, the store write, and the
      failure and abort postures. Write `audio-variant.spec.ts` with the cases listed in
      `worker/plan.md` § Tests. → T006, T007, spec `111`
      *Done when:* `bin/npm worker test -- audio-variant` passes.
- [ ] **T010** `[worker]` **(encode)** Per step 4:
      - add `EncodeInput.audioVariantDetection`;
      - in `encode.ffmpeg.ts`, call the resolver after `resolveSubtitlePruning` and pass the map to
        `buildFfmpegCommand`;
      - in `jobs/encode.job.ts`, query the field and normalize a missing one to `false` with a log;
      - add the `encode.job.spec.ts` cases. → T004, T009
      *Done when:* `bin/cli worker npx --no tsc --noEmit` and `bin/npm worker test` pass, and
      `bin/comments worker` is green.
- [x] **T011** `[web]` Per `web/plan.md` steps 1–5:
      - add the types and the `hasRegionalVariants`/`audioVariantDetection` selections;
      - add `setAudioVariantDetectionAction`;
      - add the `PreferencesForm` checkbox, enabled from the live `audioTags`, showing its stored
        state while disabled, saved in the batch and reverted on error;
      - add the `es`/`en` copy. → T003
      *Done when:* `bin/cli web npx --no tsc --noEmit`, `bin/cli web node scripts/check-messages.mjs`
      and `bin/comments web` are clean.

### Group 3 — live verification, tuning and docs

- [ ] **T012** `[docs]` Manual pass per `plan.md` § Verification steps 1–9, on a dev stack rebuilt
      with `bin/build dev worker` (AC-1 to AC-12, AC-4b). Tune `W`/`L`, the weights and the margin
      against the three films, then record each track's score, the margin and the wall time in
      `worker/plan.md` (AC-11). → T005, T008, T010, T011
      *Done when:* every AC in `spec.md` has an observed result written next to it in this file, or a
      named blocker.
- [ ] **T013** `[docs]` Update `services/worker/CLAUDE.md` with a new section, "Audio variant
      detection is resolved in the encode driver (`110`)", and its rows in § Layout. Update
      `services/api/CLAUDE.md` for the preference and the effective opt-in, and `services/web/CLAUDE.md`
      for the preference. Update the root `CLAUDE.md` Transcode row (and the spec refs on the Browse
      row for `/preferences`). → T012
      *Done when:* `bin/comments` is green, and the root table cites `110` on the Transcode row.
- [ ] **T014** `[docs]` Walk the acceptance criteria in `spec.md`, tick each one that was observed,
      and set `status: Implemented` on `spec.md`, `plan.md` and every `<svc>/plan.md`. Append the
      `docs/spec/history.md` entry. → T012, T013
      *Done when:* `bin/pending-acs --check` reports no staleness, and the feature's files read
      `Implemented`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T009, T010 | worker | Spec `111` (encode verdict persistence) is only a Draft spec; its store does not exist yet | Spec `111` implemented first (user's order: 110, then review and implement 111) |

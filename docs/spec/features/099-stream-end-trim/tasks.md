---
title: Stream-End Trim — Tasks
last_updated: 2026-10-19
status: In Progress
---

# TASKS: Stream-End Trim (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation and measurement only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer (testing). |

No `[infra]` task: no variable, container or wrapper changes — the probe runs inside the existing
`worker` image's `ffprobe`, and the synthetic AC files are built in that same container by hand.

## Tasks

### Group 1 — contract (`api`) and worker groundwork, in parallel

The `## GraphQL Contract Delta` in `spec.md` is frozen (Article VIII): an agent that finds it wrong
stops and files a row under **Blocked**. T002–T004 touch no contract and may start alongside T001.

- [x] **T001** `[api] [P]` Per `api/plan.md`: add `stream_end_trim_enabled: { kind: 'boolean' }` to
      `src/settings/settings.catalog.ts` right after `dub_trim_enabled` (`// Spec 099, REQ-1`); add
      the create-only seed row `{ key: 'stream_end_trim_enabled', value: 'false' }` to
      `prisma/seeds/settings.ts` (`// Spec 099, REQ-2`); add `@Field() streamEndTrimEnabled: boolean`
      to `src/process-jobs/entities/encode-job-details.entity.ts` after `dubTrimEnabled`; in
      `getEncodeJobDetails()` set
      `streamEndTrimEnabled: settingsMap['stream_end_trim_enabled'] === 'true'` on `base` (**not**
      ANDed with `compressionEnabled` or `dubTrimEnabled`); add a
      `getEncodeJobDetails — streamEndTrimEnabled` block to `process-jobs.service.spec.ts` with its
      Article IX header (`'true'` → `true`; `'false'` → `false`; absent row → `false`;
      `'TRUE'`/`'1'` → `false`; episode job reads the same value as a film job; each switch on alone
      leaves the other `false`).
      *Done when:* `bin/cli api npx --no tsc --noEmit`, `bin/npm api test` and `bin/comments api` are
      green; `git status --short services/api/prisma` shows only `seeds/settings.ts` (no migration);
      after a boot `git diff services/api/src/schema.gql` is exactly one added
      `streamEndTrimEnabled: Boolean!` on `EncodeJobDetails`.
- [x] **T002** `[worker] [P]` Per `worker/plan.md` step 1: extract the audio selection inside
      `getAudioParams` (`src/ffmpeg/params.ts`) into an exported
      `selectAudioStreams(audioStreams, allowedLanguagesIso3, originalLanguageIso3,
      allowedLanguageTags)` returning `{ streams, missingLanguages }`; the original-audio
      `KeyedError` stays inside it, the per-language `console.warn` moves to `getAudioParams`, which
      calls it and builds the same arguments. Add the one `params.spec.ts` case asserting the indices
      `selectAudioStreams` returns equal the `0:<index>` maps `getAudioParams` emits for a
      multi-language input. Move-only otherwise.
      *Done when:* `bin/cli worker npx --no tsc --noEmit` and `bin/npm worker test` are green with
      `buildCommand.spec.ts`, `cases.spec.ts` and `variants.spec.ts` unmodified and every existing
      `params.spec.ts` case unchanged.
- [x] **T003** `[worker] [P]` Per `worker/plan.md` step 2: give `runFfmpegCapture`
      (`src/ffmpeg/capture.ts`) an optional third argument
      `{ binary?: 'ffmpeg' | 'ffprobe'; keepStdout?: boolean }` and `RunResult` a `stdout: string`
      (empty unless kept); when kept, collect stdout up to 32 MB and reject past it. Defaults keep the
      current behaviour exactly; export name unchanged.
      *Done when:* `bin/cli worker npx --no tsc --noEmit` and `bin/npm worker test` are green with
      `grain-probe.spec.ts`, `grain-mode.spec.ts` and `dub-trim.spec.ts` unmodified; neither
      `grain-probe.ts` nor `dub-trim.ts` changed.
- [x] **T004** `[worker]` Per `worker/plan.md` steps 3–4: create `src/encode/stream-end-trim.ts`
      (constants window `300` and threshold `2`; `parsePacketEnds` reading ffprobe `compact` lines by
      key; `decideStreamEndCut` with REQ-8's `min(V, max(A))` above 2 s and REQ-9's out-of-window
      keep; `readTrackEnds` via `runFfmpegCapture` with `{ binary: 'ffprobe', keepStdout: true }` and
      `-v error -read_intervals <max(0, format.duration − 300)>% -show_entries
      packet=stream_index,pts_time,duration_time -of compact`; `resolveStreamEndTrim` using the first
      video stream and `selectAudioStreams`, one `[streamtrim]` line per completed analysis, silent
      `null` on any failure except `EncodeCancelledError`, a cut ≤ 0 treated as keep, **no** cache);
      create `src/encode/stream-end-trim.spec.ts` with its Article IX header and every case listed in
      `worker/plan.md` § Tests. → T002, T003
      *Done when:* `bin/npm worker test` is green and `stream-end-trim.spec.ts` asserts the cuts for
      Voltron S01E01 (4101.138), Lost in Space S01E01 (3765.455), Star Wars (7268.158), They Will
      Kill You (5673.71) and The Help (8774.975), `null` at 0.3 s and at exactly 2.0 s,
      out-of-window for the Darkest Hour shape, and an unchanged cut when a dropped audio track is
      the longest; `bin/cli worker npx --no tsc --noEmit` and `bin/comments worker` are green.

### Group 2 — consumers

Both depend on T001: the Setting must be editable and the field must exist before either side uses
it.

- [x] **T005** `[web] [P]` Per `web/plan.md`: add `settings.compression.streamEndTrimLabel` to
      `messages/en.json` ("Trim the end when tracks don't end together") and `messages/es.json`
      ("Recortar el final cuando las pistas no terminan juntas") right after `dubTrimLabel`; add a
      `streamEndTrimEnabled` prop, state, `Switch` (`disabled={!enabled}`) and hidden
      `stream_end_trim_enabled` input to `CompressionPanel.tsx`, right after the dub-trim switch;
      pass `getSettingValue("stream_end_trim_enabled") === "true"` from `SettingsForm.tsx`; add
      `"stream_end_trim_enabled"` to `BOOLEAN_KEYS` in `src/actions/settings.ts`. → T001
      *Done when:* `bin/cli web npx --no tsc --noEmit`, `bin/cli web node scripts/check-messages.mjs`
      and `bin/comments web` are green; on the live stack the switch renders off, persists across a
      save, and is disabled at its stored value with compression off.
- [x] **T006** `[worker] [P]` Per `worker/plan.md` step 5: add `streamEndTrimEnabled` to the GraphQL
      selection and the `EncodeJobDetails` type in `src/jobs/encode.job.ts`; resolve
      `const streamEndTrimEnabled = compressing && details.streamEndTrimEnabled === true` (silent);
      add `streamEndTrimEnabled: boolean` to `EncodeInput` (`src/encode/types.ts`) and to both
      literals; add `streamEndTrimEnabled=<bool>` to the `[encode]` log line; in
      `src/encode/encode.ffmpeg.ts` call `resolveStreamEndTrim` after `resolveDubTrim` and pass the
      minimum of the two non-null cuts (or `null`) as `trimAt` — `buildCommand.ts` and the progress
      denominator code stay as they are. → T001, T004
      *Done when:* `bin/cli worker npx --no tsc --noEmit`, `bin/npm worker test` and
      `bin/comments worker` are green; `grep -n streamEndTrimEnabled
      services/worker/src/jobs/encode.job.ts` shows the query field, the type field, the gate and
      both literals; `git diff --stat services/worker/src/ffmpeg/buildCommand.ts` is empty.

### Group 3 — docs, verification and close

- [~] **T007** `[docs] [P]` Add `streamEndTrimEnabled: Boolean!` to the `EncodeJobDetails` block of
      `docs/spec/graphql-contract.md`, with one sentence: the raw `stream_end_trim_enabled` setting,
      gated on compression by the worker, never consumed by `web`, independent of `dubTrimEnabled`.
      → T001
      *Done when:* the block matches the regenerated `schema.gql`.
- [x] **T008** `[docs]` Update `CLAUDE.md`s: the root pipeline table's **Transcode** row gains a
      "Since `099`" sentence (installation switch, default off, per-track ends from the last 300 s of
      packets before the encode, cut at `min(video, longest kept audio)` above 2 s, out-of-window
      keep, combined with `098` by `min`, silent on failure, compression-off untouched) and `099` in
      its spec list; `services/worker/CLAUDE.md` gains a short section beside the dub-trim one naming
      `src/encode/stream-end-trim.ts`, the `selectAudioStreams` extraction and `runFfmpegCapture`'s
      ffprobe option; `services/api/CLAUDE.md` only if it lists `EncodeJobDetails` fields or seeded
      settings. → T005, T006
      *Done when:* each file names `099` and nothing in them contradicts `spec.md`.
- [ ] **T009** `[docs]` Manual pass on the live stack (`ENCODE_DRIVER=ffmpeg`), following
      `plan.md` § Verification steps 1–9, which cover AC-1 through AC-12. Record each AC's observed
      cut point / log line in the AC's line in `spec.md`. → T005, T006
      *Done when:* every AC-1…AC-12 is ticked or carries the reason it could not be run.
- [ ] **T010** `[docs]` Run the full AC-13 command set (`bin/npm api test`, `bin/npm worker test`,
      the three typechecks, `check-messages.mjs`, `bin/comments`); tick AC-13; append a
      `docs/spec/history.md` entry; set `status: Implemented` on `spec.md`, `plan.md` and every
      `<svc>/plan.md` (`status: Done` here); run `/pending-acs` for whatever T009 left unticked.
      → T007, T008, T009
      *Done when:* all commands are green and the four status lines read `Implemented`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

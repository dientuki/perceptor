---
title: Dub-Card Tail Trim — Tasks
last_updated: 2026-10-19
status: Done
---

# TASKS: Dub-Card Tail Trim (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation and measurement only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer (testing). |

No `[infra]` task: no variable, container or wrapper changes — detection runs inside the existing
`worker` image's FFmpeg, and the only Docker-adjacent edit (`services/worker/.dockerignore`) is the
worker's own file.

## Tasks

### Group 1 — contract (`api`) and worker groundwork, in parallel

The `## GraphQL Contract Delta` in `spec.md` is frozen (Article VIII): an agent that finds it wrong
stops and files a row under **Blocked**. T002–T004 touch no contract and may start alongside T001.

- [x] **T001** `[api] [P]` Per `api/plan.md`: add `dub_trim_enabled: { kind: 'boolean' }` to
      `src/settings/settings.catalog.ts` (`// Spec 098, REQ-1`); add the create-only seed row
      `{ key: 'dub_trim_enabled', value: 'false' }` to `prisma/seeds/settings.ts`
      (`// Spec 098, REQ-2`); add `@Field() dubTrimEnabled: boolean` to
      `src/process-jobs/entities/encode-job-details.entity.ts`; in `getEncodeJobDetails()` set
      `dubTrimEnabled: settingsMap['dub_trim_enabled'] === 'true'` on `base` (**not** ANDed with
      `compressionEnabled`); add a `getEncodeJobDetails — dubTrimEnabled` block to
      `process-jobs.service.spec.ts` with its Article IX header (`'true'` → `true`; `'false'` →
      `false`; absent row → `false`; `'TRUE'`/`'1'` → `false`; episode job reads the same value as a
      film job).
      *Done when:* `bin/cli api npx --no tsc --noEmit`, `bin/npm api test` and `bin/comments api` are
      green; `git status --short services/api/prisma` shows only `seeds/settings.ts` (no migration);
      after a boot `git diff services/api/src/schema.gql` is exactly one added
      `dubTrimEnabled: Boolean!` on `EncodeJobDetails`.
- [x] **T002** `[worker] [P]` Move `runProbeFfmpeg` and its `RunResult` type out of
      `src/encode/grain-probe.ts` into a new `src/ffmpeg/capture.ts`, exported as `runFfmpegCapture`,
      body unchanged; `grain-probe.ts` imports it. Pure move — no behaviour change.
      *Done when:* `bin/cli worker npx --no tsc --noEmit` and `bin/npm worker test` are green with
      `grain-probe.spec.ts` and `grain-mode.spec.ts` unmodified; `grep -n "function runProbeFfmpeg"
      services/worker/src` returns nothing.
- [x] **T003** `[worker]` Per `worker/plan.md` steps 2–4: copy
      `docs/spec/features/098-dub-card-tail-trim/fixtures/*.freezes.txt` to
      `services/worker/fixtures/dub-trim/` and add `fixtures/` to `services/worker/.dockerignore`;
      create `src/encode/dub-trim.ts` (constants, `videoEndSeconds`, `parseFreezes`, `classifyTail`,
      `isDubTail`, `detectDubTail` via `runFfmpegCapture` with **no** `-v error`, `resolveDubTrim`
      with a per-input-path cache, `resetDubTrimCache`, one `[dubtrim]` line on success, silent
      `null` on any failure except `EncodeCancelledError`, a cut ≤ 0 treated as keep); create
      `src/encode/dub-trim.spec.ts` with its Article IX header and every case listed in
      `worker/plan.md` § Tests. → T002
      *Done when:* `bin/npm worker test` is green and `dub-trim.spec.ts` asserts cuts at 173.822
      (`neagley-s01e01`), 273.862 (`voltron-s03e01`), 140.905 (`war-machine`), 168.909
      (`wrecking-crew`) and keep for `chernobyl-s01e01`, `reacher-s01e01`, `foundation-s01e01`;
      `bin/cli worker npx --no tsc --noEmit` and `bin/comments worker` are green.
- [x] **T004** `[worker] [P]` Add a `trimAt: number | null` parameter to `buildFfmpegCommand`
      (`src/ffmpeg/buildCommand.ts`) folded into the existing `ENCODE_SAMPLE_SECONDS` branch: one
      `-t` carrying the smaller of the two limits, three decimals, same position; update every
      existing caller/spec call with `null`; add the three `-t` cases from `worker/plan.md` § Tests
      to `buildCommand.spec.ts`.
      *Done when:* `bin/npm worker test` is green including `buildCommand.spec.ts` and
      `cases.spec.ts`, and the new cases show `-t 1234.567` for `trimAt` alone, the smaller value
      when both are set, and no `-t` when neither is.

### Group 2 — consumers

Both depend on T001: the Setting must be editable and the field must exist before either side uses
it.

- [~] **T005** `[web] [P]` Per `web/plan.md`: add `settings.compression.dubTrimLabel` to
      `messages/en.json` ("Trim dubbing credit cards at the end") and `messages/es.json` ("Recortar
      placas de doblaje al final"); add a `dubTrimEnabled` prop, state, `Switch`
      (`disabled={!enabled}`) and hidden `dub_trim_enabled` input to `CompressionPanel.tsx`, right
      after the grain switch; pass `getSettingValue("dub_trim_enabled") === "true"` from
      `SettingsForm.tsx`; add `"dub_trim_enabled"` to `BOOLEAN_KEYS` in `src/actions/settings.ts`.
      → T001
      *Done when:* `bin/cli web npx --no tsc --noEmit`, `bin/cli web node scripts/check-messages.mjs`
      and `bin/comments web` are green; on the live stack the switch renders off, persists across a
      save, and is disabled at its stored value with compression off.
- [x] **T006** `[worker] [P]` Per `worker/plan.md` steps 5–6: add `dubTrimEnabled` to the GraphQL
      selection and the `EncodeJobDetails` type in `src/jobs/encode.job.ts`; resolve
      `const dubTrimEnabled = compressing && details.dubTrimEnabled === true` (silent); add
      `dubTrimEnabled: boolean` to `EncodeInput` (`src/encode/types.ts`) and to both literals; add
      `dubTrimEnabled=<bool>` to the `[encode]` log line; in `src/encode/encode.ffmpeg.ts` call
      `resolveDubTrim` after `resolveFilmGrain`, pass `trimAt` to `buildFfmpegCommand`, and hand
      `runFfmpeg` the minimum of the source duration, `ENCODE_SAMPLE_SECONDS` and `trimAt`.
      → T001, T003, T004
      *Done when:* `bin/cli worker npx --no tsc --noEmit`, `bin/npm worker test` and
      `bin/comments worker` are green; `grep -n dubTrimEnabled services/worker/src/jobs/encode.job.ts`
      shows the query field, the type field, the gate and both literals.

### Group 3 — docs, verification and close

- [x] **T007** `[docs] [P]` Add `dubTrimEnabled: Boolean!` to the `EncodeJobDetails` block of
      `docs/spec/graphql-contract.md`, with one sentence: the raw `dub_trim_enabled` setting, gated
      on compression by the worker, never consumed by `web`. → T001
      *Done when:* the block matches the regenerated `schema.gql`.
- [x] **T008** `[docs]` Update `CLAUDE.md`s: the root pipeline table's **Transcode** row gains a
      "Since `098`" sentence (installation switch, last-300 s video-stream window, 2.002 s-card rule,
      cut by `-t`, silent on failure, compression-off untouched) and `098` in its spec list;
      `services/worker/CLAUDE.md` gains a section beside the grain one ("Dub-card tail trim is
      resolved in the encode driver (098)") naming `src/encode/dub-trim.ts`,
      `src/ffmpeg/capture.ts`, the fixtures directory and the per-path cache; `services/api/CLAUDE.md`
      only if it lists `EncodeJobDetails` fields or seeded settings. → T005, T006
      *Done when:* each file names `098` and nothing in them contradicts `spec.md`.
- [~] **T009** `[docs]` Manual pass on the live stack (`ENCODE_DRIVER=ffmpeg`), following
      `plan.md` § Verification steps 1–9, which cover AC-1 through AC-10. Record each AC's
      observed cut point / log line in the AC's line in `spec.md`. → T005, T006
      *Done when:* every AC-1…AC-10 is ticked or carries the reason it could not be run.
- [x] **T010** `[docs]` Run the full AC-11 command set (`bin/npm api test`, `bin/npm worker test`,
      the three typechecks, `check-messages.mjs`, `bin/comments`); tick AC-11; append a
      `docs/spec/history.md` entry; set `status: Implemented` on `spec.md`, `plan.md` and every
      `<svc>/plan.md` (`status: Done` here); run `/pending-acs` for whatever T009 left unticked.
      → T007, T008, T009
      *Done when:* all commands are green and the four status lines read `Implemented`.

### Group 4 — rule correction after the first library pass

- [x] **T011** `[worker]` Replace the REQ-7 ratio rule in `src/encode/dub-trim.ts` with the trailing-card
      rule in `spec.md` REQ-7 (set aside a non-multiple last segment; count consecutive multiples of
      2.002 s ±0.06 s from the end, k ≥ 1; cut only when at least 5 and at least 3 with k = 1; cut point
      still the start of the whole run). `TailClassification.multiples` becomes the trailing count and
      gains an `exact` count; the `[dubtrim]` line keeps its shape. Copy
      `docs/spec/features/098-dub-card-tail-trim/fixtures/{rtte-s01e01,diabolical-s01e01,haven-s01e01,arrival,dawn-of-the-dragon-racers}.freezes.txt`
      to `services/worker/fixtures/dub-trim/` and extend `dub-trim.spec.ts`: every existing fixture keeps
      its verdict and cut point, `rtte-s01e01` and `diabolical-s01e01` cut at their run start,
      `haven-s01e01`, `arrival` and `dawn-of-the-dragon-racers` keep.
      *Done when:* `bin/npm worker test`, the worker typecheck and `bin/comments worker` are green.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

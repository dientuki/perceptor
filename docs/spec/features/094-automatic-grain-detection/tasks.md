---
title: Automatic Grain Detection — Tasks
last_updated: 2026-10-17
status: In Progress
---

# TASKS: Automatic Grain Detection (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation and measurement only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer (testing). |

No `[web]` task: nothing about grain is shown or edited in the UI beyond what `092` built. No
`[infra]` task: no variable, container or wrapper changes — the probe runs inside the existing
`worker` image, whose FFmpeg already carries `libsvtav1`.

## Tasks

### Group 1 — contract (`api`) and worker groundwork, in parallel

The `## GraphQL Contract Delta` in `spec.md` is frozen (Article VIII): an agent that finds it wrong
stops and files a row under **Blocked**. T002 and T003 touch no contract and may start alongside
T001.

- [x] **T001** `[api] [P]` Add `isShort: boolean` (`@Field()`, non-null, `// Spec 094, REQ-12`) to
      `src/process-jobs/entities/encode-job-details.entity.ts`; in `process-jobs.service.ts`'s
      `getEncodeJobDetails` set `isShort: movie.isShort` (the **raw** column — not the
      `isShortsEnabled()` expression `outputRoot` uses) in the film arm and `isShort: false` in the
      episode arm; add the `getEncodeJobDetails — isShort` block to `process-jobs.service.spec.ts`
      (short + shorts enabled → `true`; short + shorts **disabled** → still `true`; episode →
      `false`), with its Article IX header.
      *Done when:* `bin/cli api npx --no tsc --noEmit` and `bin/npm api test` are green;
      `git status --short services/api/prisma` is empty; after a boot `git diff
      services/api/src/schema.gql` is exactly one added `isShort: Boolean!` on `EncodeJobDetails`
      (**AC-14**, unit half).
- [x] **T002** `[worker] [P]` Exports with no behaviour change: `parseFrameRate`,
      `computeBitsPerPixelPerFrame`, `isLosslessAudioStream` from `src/ffmpeg/remux-detection.ts`;
      `ABORT_KILL_GRACE_MS` from `src/ffmpeg/runner.ts`; `RESOLUTION_BOXES` and `exceedsBox` from
      `src/ffmpeg/params.ts`; and lift the `-svtav1-params` string assembly out of
      `buildAv1EncodeArgs` into an exported `buildSvtav1Params(contentKind, filmGrain)` that
      `buildAv1EncodeArgs` now calls.
      *Done when:* `bin/cli worker npx --no tsc --noEmit` and `bin/npm worker test` are green with
      **no test file and no `services/worker/ffmpeg/*.json` case edited**.
- [x] **T003** `[worker]` Move the seam: `buildFfmpegCommand(input, output, metadata, details,
      filmGrain: boolean)` stops importing and calling `resolveFilmGrain`; `src/encode/encode.ffmpeg.ts`
      calls today's synchronous `resolveFilmGrain(details.grainMode, metadata)` after `onProbe` and
      passes the result in. Update `cases.spec.ts` and `buildCommand.spec.ts` to pass the boolean
      explicitly. Behaviour is identical to `092` at this point. → T002
      *Done when:* `bin/npm worker test` is green, every `services/worker/ffmpeg/` case passes with no
      JSON case edited, and `grep -n resolveFilmGrain services/worker/src/ffmpeg/` returns nothing
      (**NFR-5**).

### Group 2 — the detector (`worker`)

- [x] **T004** `[worker]` Consume the contract: add `isShort` to `src/jobs/encode.job.ts`'s
      `processJob` query string and local `EncodeJobDetails` type in the same edit; add
      `normalizeIsShort` to `src/encode/grain-mode.ts` (boolean passes through silently; anything
      else → `false` plus one warning, never throws) with its cases in `grain-mode.spec.ts`; add
      `year`, `isShort`, `mediaSourceId` to `EncodeInput` in `src/encode/types.ts` and fill them in
      **both** the `encode(...)` and `passthrough(...)` literals; append `isShort=` to the existing
      `[encode]` log line. → T001 T003
      *Done when:* typecheck and `bin/npm worker test` green; against the dev stack an encode's
      `[encode]` line shows `isShort=true` for a film flagged short and `isShort=false` for an
      episode (**AC-14**, live half).
- [x] **T005** `[worker] [P]` Create `src/encode/grain-gate.ts`: pure
      `scoreGrainGate(metadata, inputPath, year) → { score, passed, reasons }` with the signals,
      weights, tiers, codec factors and pass score listed in `worker/plan.md` step 4, each a named
      constant with a `// Spec 094, REQ-4` (or `REQ-5`) locator; provenance from the parent directory
      name plus basename of `inputPath`, never `sourceTag`; year from the argument only. Add
      `grain-gate.spec.ts` with the cases in `worker/plan.md` § Tests and its Article IX header.
      → T002
      *Done when:* `bin/npm worker test` green, including `"24000/1001"`, the HEVC factor, the
      0.07–0.13 dead zone, `flac` counted here while `isRemux` is unchanged, a disc marker found
      only in the directory name, and `mipeli.mkv` + `year: 1998` scoring the same year signal as a
      path containing `1998` (**AC-9**, unit half).
- [x] **T006** `[worker] [P]` Create `src/encode/grain-probe.ts`:
      `probeGrainSaving(input, metadata, contentKind, signal)` per `worker/plan.md` step 5 — 30 s
      minimum, five `cropdetect` samples with majority crop, a fixed `RESOLUTION_BOXES['1080p']` box
      via `exceedsBox` (never `compressionResolution`), nine 6 s windows encoded twice at CRF 22 /
      preset 8 through `buildSvtav1Params`, output `-f matroska pipe:1` with stdout bytes counted and
      nothing written to disk, encodes run sequentially, abort → SIGTERM → `ABORT_KILL_GRACE_MS` →
      SIGKILL → `EncodeCancelledError`; the arithmetic in an exported pure function;
      `GRAIN_PROBE_SAVED_MBPS_THRESHOLD = 0.886` with a `// Spec 094, REQ-7` locator. Add
      `grain-probe.spec.ts` with the cases in `worker/plan.md` § Tests. → T002
      *Done when:* `bin/npm worker test` green, including the Lionheart row reproduced (11.289 Mbps,
      24.55%, 2.771 saved), the under-1000-byte window excluded, zero windows throwing, and an
      identical scale filter for a `4k` and a `1080p` job (**AC-16**, unit half).
- [x] **T007** `[worker]` Make `resolveFilmGrain(details, input, metadata, signal)` async in
      `src/encode/grain-mode.ts` per `worker/plan.md` step 6 — `ON`/`OFF` short-circuit, cache by
      `mediaSourceId` (definite verdicts only), gate, `isShort` refusal, probe, `EncodeCancelledError`
      rethrown, every other failure → `false` with exactly one warning, one `[grain]` result line plus
      a probe-start line — and switch `encode.ffmpeg.ts` to `await` it. Rewrite the
      `resolveFilmGrain` block of `grain-mode.spec.ts` with gate and probe mocked. → T004 T005 T006
      *Done when:* `bin/cli worker npx --no tsc --noEmit`, `bin/npm worker test` and
      `bin/comments worker` are all green — the new cases cover ON/OFF never probing, gate refusal,
      short refusal, one probe for two calls on one source, a failed probe not cached, and
      cancellation propagating (**AC-10**, **AC-11**).

### Group 3 — calibration, verification and docs

- [~] **T008** *(testing — maintainer runs this on the real files)* `[docs]` Re-measure the calibration corpus at the probe's real parameters: run
      `CRF=22 PRESET=8 COMPRESSION_RESOLUTION=1080p services/worker/tmp/etapa3-encode-probe.sh -v`
      **twice** on each of the eight measurable files from `spec.md` § Calibration Corpus, then encode
      one of them (Lionheart) through the dev stack with `ENCODE_DRIVER=ffmpeg` and compare its
      `[grain]` line against the script's output. Rewrite the corpus table at CRF 22 with both runs,
      record the run-to-run spread, refit the threshold as the geometric mean of the new gap, and
      drop "provisional" from REQ-7 and the corpus section — or, if the classes no longer separate,
      stop and file it under **Blocked**. → T007
      *Done when:* the table in `spec.md` shows CRF 22 figures for every measurable row with two runs
      each, REQ-7 names the refitted number, and the worker's Lionheart figures fall inside the
      script's two-run spread.
- [ ] **T009** `[worker]` Set `GRAIN_PROBE_SAVED_MBPS_THRESHOLD` to the value T008 refitted. → T008
      *Done when:* the constant equals REQ-7's number and `bin/npm worker test` is green (the
      Lionheart arithmetic case is threshold-independent; any case asserting `passed` is updated to
      the new value in the same edit).
- [x] **T010** `[docs] [P]` Add a `094-automatic-grain-detection` section to
      `docs/spec/graphql-contract.md` beside `092`'s: the `isShort: Boolean!` SDL, raw-not-effective,
      `false` for episodes, no error, and the note that a worker must not select it against an older
      `api`. → T001
      *Done when:* the section exists and its SDL matches `spec.md` § GraphQL Contract Delta and the
      regenerated `schema.gql` field verbatim.
- [x] **T011** `[docs] [P]` Update the affected `CLAUDE.md` files and history: rewrite
      `services/worker/CLAUDE.md`'s "Film grain is a boolean…" section (resolution now in the
      driver, the gate, the probe, the cache, `isShort`); in the root `CLAUDE.md` Transcode row,
      replace "today the setting's 'on' path is a stub that still yields no grain" with the two-stage
      detector and add `094` to the row's spec list; append a `docs/spec/history.md` entry with the
      re-measured counts. → T007 T009
      *Done when:* `grep -n "stub" CLAUDE.md` no longer matches the grain sentence, the worker
      `CLAUDE.md` names `grain-gate.ts` and `grain-probe.ts`, and `history.md`'s newest entry is
      `094`.
- [ ] **T012** `[docs]` Walk the manual pass in `plan.md` § Verification against `bin/dev` with
      `ENCODE_DRIVER=ffmpeg` and `grain_auto_enabled` on — AC-1 through AC-16 — ticking each box in
      `spec.md` that it proves and leaving any that cannot be reached unticked with its blocker named;
      run `bin/pending-acs`; set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and
      `worker/plan.md`, and `status: Done` here. → T009 T010 T011
      *Done when:* every AC in `spec.md` is ticked or carries a named blocker, `bin/pending-acs
      --check` exits 0, and the five files carry their closing status.

## Acceptance criteria coverage

| AC | Reached by |
| :-- | :-- |
| AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-12, AC-13, AC-15 | T012 (manual pass) |
| AC-9 | T005 (unit), T012 (live) |
| AC-10 | T003, T007 |
| AC-11 | T007 |
| AC-14 | T001 (unit), T004 (live), T012 |
| AC-16 | T006 (unit), T012 (live) |

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T008 | docs | Needs the maintainer's eight corpus files and 2–4 h of CPU; deferred to a manual run | Maintainer runs the script twice per file at CRF 22 and reports the output |
| T009 | worker | Waits on T008's refit; the constant stays at the provisional 0.886 | T008 |
| T012 | docs | Live acceptance criteria need real encodes with `ENCODE_DRIVER=ffmpeg`; the spec cannot flip to Implemented until T008/T009 | T009 |

---
title: Compression resolution — Tasks
last_updated: 2026-09-16
status: Done
---

# TASKS: Compression resolution (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation and the cross-service verification sweep. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**Two tasks carry a dispatch override.** `T008` and `T009` are tagged `[worker]` because they live
in `services/worker/`, but `services/worker/src/ffmpeg/` belongs to the **`ffmpeg` agent** (`.claude/agents/ffmpeg.md`), not the `worker` agent — the `worker`
agent is instructed to stop and report rather than edit them. Dispatch those two to `ffmpeg`. The tag
vocabulary has no way to say this; the task text does.

**The FFmpeg case corpus is out of this feature.** `services/worker/ffmpeg/1.json` and `2.json` are
stale: no task reads their expectations, runs them as a guard, or edits them, and
`src/ffmpeg/cases.spec.ts` results are never a done signal. Real-file validation happens later.

**Group 5 was added in spec 0.5.0** (REQ-17, NFR-5, AC-15), after Groups 1–4 shipped: real encodes of
uploaded files wrote an empty `PERCEPTOR_SOURCE`. Groups 1–4 stay ticked; only Group 5 is open.

## Tasks

### Group 1 — the contract (`api`) and the fifth option (`web`)

`api` produces the field every worker task consumes and the catalog value `web` saves. `web`'s change
is an array entry and two labels with no GraphQL shape change, so it runs beside `api` rather than
after it.

- [x] **T001** `[api] [P]` In `src/settings/settings.catalog.ts`, insert `'480p'` into
      `COMPRESSION_RESOLUTIONS` between `'720p'` and `'360p'` and export
      `DEFAULT_COMPRESSION_RESOLUTION = '1080p'` beside it. In `prisma/seeds/settings.ts`, delete the
      comment above the `compression_resolution` row (it says "one of the four values"); the seeded
      value stays `'1080p'`.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and
      `git status --short services/api/prisma` lists only `prisma/seeds/settings.ts`.
- [x] **T002** `[api]` Add `@Field() compressionResolution: string;` after `compressionEnabled` in
      `src/process-jobs/entities/encode-job-details.entity.ts` (no comment, no description). In
      `ProcessJobsService.getEncodeJobDetails`, add `compressionResolution` to `base`, read from the
      same `settingsMap` as `compressionEnabled`: the raw value when it is one of
      `COMPRESSION_RESOLUTIONS`, otherwise `DEFAULT_COMPRESSION_RESOLUTION`. No second `getMap()` call.
      → T001
      *Done when:* after the dev server regenerates it, `git diff services/api/src/schema.gql` shows
      exactly one added line, `compressionResolution: String!`, inside `type EncodeJobDetails`.
- [x] **T003** `[api]` Extend `src/process-jobs/process-jobs.service.spec.ts` with a `describe` for
      `compressionResolution` beside the existing `compressionEnabled` one (same mocked
      `settings.getMap` pattern): each of the five values passes through verbatim; a missing row, `'garbage'`
      and `'4K'` resolve to `'1080p'`; an episode job carries the value too. Update
      `services/api/CLAUDE.md`'s `compressionEnabled` bullet to mention `compressionResolution` and its
      `1080p` fallback. → T002
      *Done when:* `bin/npm api run test` passes with the new cases counted in the total.
- [x] **T004** `[web] [P]` In `src/components/settings/CompressionPanel.tsx`, insert `"480p"` into
      `RESOLUTIONS` between `"720p"` and `"360p"`. Add `"480p": "480p"` under
      `settings.compression.resolutions` in `messages/en.json` and `messages/es.json`, in the same
      position. Nothing else in the file changes.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors, `bin/npm web run build` exits
      0, and `bin/cli web node scripts/check-messages.mjs` reports no drift at 423 keys.

### Group 2 — the worker carries the value (`worker` agent)

Consumes the field T002 produces. Can start once T002 is merged; the worker's typecheck is expected
to show errors in `src/ffmpeg/*.spec.ts` after T005 (a new required `EncodeInput` field) until T008
lands — that is Group 3's work, not this group's.

- [x] **T005** `[worker]` Create `src/encode/compression-resolution.ts` modelled on
      `src/encode/content-kind.ts`: `CompressionResolution` union
      (`'4k' | '1080p' | '720p' | '480p' | '360p'`), `COMPRESSION_RESOLUTION_VALUES`, and
      `normalizeCompressionResolution(raw)` returning a valid value verbatim or `'1080p'` with one
      `console.warn`, never throwing; no comments (Article XI). Add its spec
      `src/encode/compression-resolution.spec.ts` (test header per Article IX): each valid value
      verbatim; `undefined`, `null`, `''`, `'4K'`, `'garbage'` → `'1080p'`. Add required
      `compressionResolution: CompressionResolution` to `EncodeInput` in `src/encode/types.ts`. → T002
      *Done when:* `bin/npm worker test -- src/encode/compression-resolution.spec.ts` passes.
- [x] **T006** `[worker]` In `src/jobs/encode.job.ts`: add `compressionResolution: string` to the local
      `EncodeJobDetails`; add `compressionResolution` to the `processJob` selection set; normalize it
      once beside `normalizeContentKind`; append `compressionResolution=<value>` to the existing
      `[encode] <id>:` log line; set it in **both** `EncodeInput` literals (encode and passthrough).
      Extend `src/jobs/encode.job.spec.ts`: the query text selects `compressionResolution`; a payload of
      `'480p'` reaches the `EncodeInput` handed to the driver; an absent value reaches it as `'1080p'`.
      Do not edit anything under `src/ffmpeg/`. → T005
      *Done when:* `bin/npm worker test -- src/jobs/encode.job.spec.ts` passes, and
      `bin/cli worker npx --no tsc --noEmit` reports no error outside `src/ffmpeg/` beyond the 2
      pre-existing `src/metadata/container-tags.spec.ts` ones.
- [x] **T007** `[worker]` Update `services/worker/CLAUDE.md`: a short section beside the `contentKind`
      one describing `compressionResolution` — selected on `processJob`, normalized once in
      `handleEncode` by `normalizeCompressionResolution`, `1080p` on absence or skew, ignored by
      `passthrough.ts`. → T006
      *Done when:* `grep -n "normalizeCompressionResolution" services/worker/CLAUDE.md` matches.

### Group 3 — the video rule (`ffmpeg` agent)

**Dispatch both tasks in this group to the `ffmpeg` agent.** Strictly sequential: refactor with
`params.spec.ts` unchanged in output, then the rule.

- [x] **T008** `[worker]` **Dispatch to the `ffmpeg` agent.** Refactor only, no rule change: collapse
      `getVideoParams`' return sites in `src/ffmpeg/params.ts` into one AV1 argument builder
      parametrized by scale filter, colour tags and title, keeping every current output identical
      (dropping the doubled `:tune=0` on the VC-1 path is allowed — say so). Make
      `src/ffmpeg/buildCommand.spec.ts`, `src/ffmpeg/params.spec.ts` and `src/ffmpeg/cases.spec.ts`
      compile against the new required `compressionResolution` field (`'1080p'`); the `cases.spec.ts`
      change is compile-only, and no file under `services/worker/ffmpeg/` is edited. → T006
      *Done when:* `bin/cli worker npx --no tsc --noEmit` shows only the 2 pre-existing
      `container-tags.spec.ts` errors, and `bin/npm worker test -- src/ffmpeg/params.spec.ts` passes
      with its video expectations unchanged except the VC-1 `tune=0` duplicate.
- [x] **T009** `[worker]` **Dispatch to the `ffmpeg` agent.** Implement the rule in
      `src/ffmpeg/params.ts` per `worker/plan.md` Part B steps 2–4, and pass
      `details.compressionResolution` from `src/ffmpeg/buildCommand.ts`:
      `getVideoParams(videoStream, contentKind, compressionResolution, quality)`; unrecognized codec
      (outside `h264`/`hevc`/`h265`/`vc1`/`av1`) → copy, warning when it exceeds the box; exceeds-box
      predicate (boxes 1920×1080 / 1280×720 / 854×480 / 640×360, `4k` none, `> box × 1.02` per
      dimension on coded width/height); `av1` fitting → copy; otherwise AV1, with
      `scale=<W>:<H>:force_original_aspect_ratio=decrease:force_divisible_by=2` when exceeding; colour
      tags by HDR form (DoVi/HDR10 → bt2020 + `smpte2084`, HLG → bt2020 + `arib-std-b67`, SDR → bt709)
      on every AV1 encode; titles `AV1 (Converted from <CODEC> <HDR>)` and
      `AV1 (Downscaled from <SOURCE> <CODEC> <HDR>)` — always plain `AV1`, never a target tier.
      `is4K` and `HDR_DOWNSCALE_VF` are removed. Extend `src/ffmpeg/params.spec.ts` with the full
      matrix in `worker/plan.md` § Tests: every tier × below / exact / +2% / +2%+1px on width and on
      height; `4k` with 4096×2160 and 7680×4320; 1920×800 and 2560×1440 under `1080p`; 720×480 under
      `480p`; `h264`/`hevc`/`vc1` fitting encoded, `av1` fitting copied, `av1` exceeding scaled,
      `mpeg2video` exceeding copied with a warning; DoVi, HDR10, HLG, SDR tag sets including an `av1`
      HDR source exceeding the box; both title forms, asserting neither contains a tier after `AV1`.
      Expectations come from `spec.md`/`plan.md`, not from running the code. Report every rule changed
      (V2–V6) for T011. → T008
      *Done when:* `bin/npm worker test -- src/ffmpeg/params.spec.ts` passes with the new cases counted;
      `grep -n "is4K\|HDR_DOWNSCALE_VF" services/worker/src/ffmpeg/params.ts` matches nothing;
      `bin/npm worker test` fails only in the pre-existing `buildCommand.spec.ts` CRF mismatch and in
      `cases.spec.ts` (ignored); `bin/npm worker run build` exits 0.

### Group 4 — verification and docs

- [x] **T010** `[docs]` Update `docs/spec/graphql-contract.md` with a `058-compression-resolution`
      section beside `032`'s `compressionEnabled` one: the field, the five values, query-time
      resolution, the `1080p` fallback on both sides, `String!` rather than an enum and why, and the
      consumer obligations from `spec.md`. → T002
      *Done when:* `grep -n "compressionResolution" docs/spec/graphql-contract.md` matches inside the
      new section.
- [x] **T011** `[docs]` Update the root `CLAUDE.md`: the Transcode row describes the new rule (every
      recognized codec to AV1, downscaled to the administrator's ceiling, never upscaled, copy only for
      AV1 that fits or an unrecognized codec, HDR/HLG tags preserved, HEVC below 4K now re-encoded) and
      adds `058` to its spec list; the Current state section records the re-measured counts. Rewrite
      `.claude/agents/ffmpeg.md` § Rules V2–V6 from T009's report, naming `params.spec.ts` as what
      proves them (not the corpus). → T003, T004, T007,
      T009
      *Done when:* `grep -n "058" CLAUDE.md` matches in the Transcode row, and
      `grep -n "V6\|is4K\|Non-HEVC 4K is \*\*not\*\*" .claude/agents/ffmpeg.md` no longer describes
      the retired rule.
- [x] **T012** `[docs]` Run the verification sweep from `plan.md` § Verification (all `bin/` commands)
      and the manual pass, walking AC-1 through AC-14 in `spec.md` and ticking each box that is
      observed. Any AC that cannot be reached goes to § Blocked below rather than ticked. Set
      `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md`, `web/plan.md`, `worker/plan.md`,
      and `status: Done` here. → T010, T011
      *Done when:* every AC box in `spec.md` is ticked or has a row in § Blocked, and
      `grep -n "^status" docs/spec/features/058-compression-resolution/**/*.md docs/spec/features/058-compression-resolution/*.md`
      shows `Implemented`/`Done` throughout.

### Group 5 — empty `PERCEPTOR_SOURCE` on uploaded files (added in 0.5.0)

Independent of Groups 1–4: no contract, no `src/ffmpeg/`, no `api`. Dispatch T013 to the **`worker`**
agent — `src/metadata/` is its directory, not the `ffmpeg` agent's.

- [x] **T013** `[worker]` Fix `buildSourceTag` in `src/metadata/container-tags.ts` per
      `worker/plan.md` Part C: when `downloadPath` resolves to the same path as `inputFilePath` (an
      uploaded file under `imports/<uploadId>/`), return `basename(inputFilePath)` before the
      folder-relative branch; every other branch keeps its output. Tests first: bring
      `src/metadata/container-tags.spec.ts` to the three-argument signature and add the cases in
      `worker/plan.md` § Tests (loose file, non-normalized equal path, folder, null `downloadPath`,
      `downloadPath` not containing the input, outside `downloadsRoot`). Do not edit
      `src/paths/is-inside-root.ts`, `jobs/encode.job.ts` or anything under `src/ffmpeg/`.
      *Done when:* `bin/npm worker test -- src/metadata/container-tags.spec.ts` passes with the new
      cases counted; `bin/cli worker npx --no tsc --noEmit` reports **0 errors**;
      `git diff --stat services/worker/src/paths services/worker/src/ffmpeg` is empty.
- [x] **T014** `[docs]` Update `services/worker/CLAUDE.md`'s `046` `sourceTag` paragraph with the three
      branches (loose file → base name; folder → relative to `downloadPath`; else `downloadsRoot`-relative
      or base name). In the root `CLAUDE.md` Current state, record the `058` re-measure with the worker
      typecheck at 0 errors and the `container-tags.spec.ts` `TS2554` pair noted as resolved by
      `058` (REQ-17). → T013
      *Done when:* `grep -n "base name" services/worker/CLAUDE.md` matches in the `sourceTag` paragraph,
      and the root `CLAUDE.md`'s latest `058` entry reports 0 worker typecheck errors.
- [x] **T015** `[docs]` Re-run `plan.md` § Verification, walk AC-15 (manual pass step 6 — an uploaded
      file's logged command carries a non-empty `PERCEPTOR_SOURCE=<file name>`), tick it or add a
      § Blocked row, and set `status: Implemented` again on `spec.md`, `plan.md`, `worker/plan.md` and
      `status: Done` here. → T014
      *Done when:* AC-15 is ticked or in § Blocked, and every feature file's `status` reads
      `Implemented`/`Done`.

## Acceptance criteria coverage

| AC | Reached by |
| :-- | :-- |
| AC-1 (save `480p`) | T001, T004, T012 manual |
| AC-2 (`processJob` returns value) | T002, T003, T006, T012 manual |
| AC-3 … AC-9 (per-codec/tier outputs) | T009 unit matrix, T012 manual encodes |
| AC-10 (garbage row → `1080p`) | T002/T003 (api), T005 (worker), T012 manual |
| AC-11 (`540p` rejected) | T001, T012 manual |
| AC-12 (compression off ignores it) | T006 (passthrough literal carries it, unused), T012 manual |
| AC-13 (changed before pickup) | T002 (query-time read), T012 manual |
| AC-14 (test suites, message parity) | T003, T004, T005, T006, T009, T012 |
| AC-15 (source tag on uploaded files, typecheck 0 errors) | T013, T015 manual |

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T012 (AC-2, AC-10) | `orch` | No `ProcessJob` row exists in this dev database (never been through the full download pipeline), so `processJob(id)` cannot be queried live. AC-1 and AC-11 (settings save/reject) were verified live against the running stack; these two need a real job row instead of a settings row. | An administrator to run the manual pass in `plan.md` § Verification step 2 against a real (or fixture-seeded) `ProcessJob`. Indirectly covered now: the `schema.gql` diff (T002) proves the field's shape, and `process-jobs.service.spec.ts`'s `compressionResolution` describe block (T003) exercises `getEncodeJobDetails` directly with a mocked settings map, including the `'garbage'` → `'1080p'` fallback AC-10 describes. |
| T012 (AC-3…AC-9, AC-12, AC-13) | `orch` | These require an actual FFmpeg encode against a real (or synthetic-but-real-file) media source — no torrent/upload pipeline was run in this session. | The manual pass in `plan.md` § Verification steps 3–5, with real files at each tier/codec/HDR combination. Indirectly covered now: `src/ffmpeg/params.spec.ts`'s full synthetic-stream matrix (T009, 71 tests) asserts the exact FFmpeg arguments spec.md describes for every one of these scenarios; AC-12's passthrough behaviour is untouched by this feature and unit-tested in `encode.job.spec.ts`. |
| T015 (AC-15 end-to-end) | `orch` | AC-15's live half needs a file uploaded through the import flow and actually encoded, with the worker log inspected for the literal `-metadata PERCEPTOR_SOURCE=<name>.mkv` value — no upload/encode pipeline was run in this session. | The manual pass in `plan.md` § Verification step 6, with a real uploaded file. Indirectly covered now: `container-tags.spec.ts`'s 9 cases (T013) directly test `buildSourceTag` against the exact loose-file/folder/null/outside-root inputs AC-15 describes, and `bin/cli worker npx --no tsc --noEmit` confirms 0 errors live. |

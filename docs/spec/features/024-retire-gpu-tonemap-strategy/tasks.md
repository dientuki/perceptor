---
title: Retire the GPU Tonemap Strategy — Tasks
last_updated: 2026-08-25
status: Done
---

# TASKS: Retire the GPU Tonemap Strategy (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task. |
| `[ffmpeg]` | The `ffmpeg` agent (`.claude/agents/ffmpeg.md`), which owns `services/worker/src/ffmpeg/` and `services/worker/ffmpeg/`. **Not in the standard vocabulary** — see the note below; using `[worker]` for these would dispatch them to an agent whose brief forbids those two directories. |
| `[verify]` | A gate the orchestrator runs itself, sourced from `plan.md` § Verification. Owns no files. |
| `[docs]` | Documentation only. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

> **On the `[ffmpeg]` tag.** `.claude/commands/tasks.md` lists `[api] [web] [worker] [infra] [docs]`
> and does not know about the `ffmpeg` agent, but `.claude/agents/worker.md` § Scope explicitly
> excludes `services/worker/src/ffmpeg/` and `services/worker/ffmpeg/` from the `worker` agent and
> instructs it to stop and report rather than edit them. Seven of this feature's tasks live in
> exactly those directories. Tagging them `[worker]` would produce seven stop-and-reports.
> `/implement` must dispatch `[ffmpeg]` to the `ffmpeg` agent.

## Tasks

### Group 0 — capture the evidence, before anything moves

- [x] **T001** `[verify]` Dump the argument array `buildFfmpegCommand` produces for all **eight**
      probes in `services/worker/ffmpeg/`, on current `HEAD`, using the command in `plan.md`
      § Verification. Write it outside the repo (the session scratchpad).
      *Done when:* the dump exists and holds eight entries, and `git status --short` shows no repo
      file added. **Nothing else may start until this exists** — once the signature changes the
      before-state is unrecoverable and NFR-1 becomes unprovable.

### Group 1 — the encode path

One landing unit. `bin/cli worker npx --no tsc --noEmit` is **expected to be red** from T002 until
T008 lands: removing a parameter from a signature and removing it from its call sites cannot be
simultaneous (`plan.md` § Order of Work). Do not report that as a failure.

- [x] **T002** `[ffmpeg]` `src/ffmpeg/params.ts`: delete `SOFTWARE_TONEMAP_VF`, `GPU_TONEMAP_VF` and
      the comment block above them; remove the `vulkanAvailable` parameter from `getVideoParams`;
      delete the orphaned `// REQ-6` / `// REQ-7` comments inside the HDR branch. Leave every
      returned array character-for-character as it is — `HDR_DOWNSCALE_VF` and all colour tags stay.
      *Done when:* `grep -nE 'libplacebo|zscale|tonemap|vulkan' services/worker/src/ffmpeg/params.ts`
      returns nothing. → T001
- [x] **T003** `[ffmpeg]` `src/ffmpeg/buildCommand.ts`: remove the `vulkanAvailable` parameter and
      stop forwarding it to `getVideoParams`. Do not give it a default value — a defaulted parameter
      would let T008 be skipped silently.
      *Done when:* `buildFfmpegCommand` takes four parameters and the file mentions no GPU flag. → T002
- [x] **T004** `[ffmpeg] [P]` Delete `src/ffmpeg/vulkan.ts` and `src/ffmpeg/vulkan.spec.ts`.
      *Done when:* neither file exists. → T001
- [x] **T005** `[ffmpeg]` `src/ffmpeg/cases.spec.ts` **and all eight corpus JSONs in one change**:
      drop `vulkanAvailable` from the `CaseInput` type, the destructuring, the validator check and
      the `buildFfmpegCommand` call, and remove `"vulkanAvailable"` from every file in
      `services/worker/ffmpeg/` — `8.json` included, which is untracked and will not appear in a
      diff. Split across two tasks this fails at collection, not at an assertion.
      *Done when:* `grep -rl vulkanAvailable services/worker` returns nothing and the suite still
      collects eight cases. → T003
- [x] **T006** `[ffmpeg]` Correct the stale `ffmpeg` expectation in `1.json`, `3.json` and `4.json` —
      they still carry the tonemap `-vf` and the `Tonemapped from 4K …` title from before `8d9572d`.
      Take each corrected array from the T001 dump, not by retyping. This is throwaway work on files
      T014 deletes, and it is not optional: a green suite over all eight is the proof the cleanup
      changed no encode.
      *Done when:* `bin/npm worker test` reports `ffmpeg cases` fully green, eight cases. → T005, T001
- [x] **T007** `[ffmpeg] [P]` Delete the `getVideoParams — 4K HDR tonemap branches` describe block in
      `src/ffmpeg/params.spec.ts` and the `threads the vulkanAvailable argument…` test in
      `src/ffmpeg/buildCommand.spec.ts`; drop the extra argument from the surviving
      `buildFfmpegCommand(...)` calls. Keep the `videoStream`/`audioStream` factories and the
      `fre`/`fra` coverage.
      *Done when:* neither spec mentions `libplacebo`, `zscale` or `vulkan`. → T003
- [x] **T008** `[worker]` Remove the two call sites: the `isVulkanAvailable` import, the memo comment
      block and the fifth argument in `src/encode/encode.ffmpeg.ts`; the `probeVulkan` import, the
      `await probeVulkan()` call and the `tonemap path:` log line in `src/index.ts`. Keep the
      `async function main()` bootstrap, the umask and both `Worker` constructions.
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports 0 errors — this is the task that
      closes the red window. → T003, T004

### Group 2 — infra

Genuinely parallel with Group 1: no shared file, nothing here is typechecked or imported by the
TypeScript gates, and no change alters an FFmpeg argument.

- [x] **T009** `[infra] [P]` Delete `docker-compose.gpu.yaml` and remove the
      `[ -d /dev/dri ] && [ "${USE_GPU}" != "false" ]` block from `bin/dev`, `bin/prod` and
      `bin/build`, collapsing `COMPOSE_FILES` to a plain assignment in each. Strip the GPU sentences
      from the three header comments; leave the surrounding Spanish alone.
      *Done when:* `bin/dev` brings the stack up and `docker compose config` resolves with no
      overlay, on this host, which **has** a render node.
- [x] **T010** `[infra] [P]` Remove `- USE_GPU=${USE_GPU}` from the `worker` service in
      `docker-compose.yaml`; delete the `USE_GPU` block from `.env.example`; reword
      `docker-compose.dev.yaml`'s header comment so it no longer points at the deleted overlay.
      *Done when:* `grep -rn USE_GPU docker-compose.yaml docker-compose.dev.yaml .env.example`
      returns nothing.
- [x] **T011** `[infra] [P]` Drop `vulkan-loader`, `mesa-vulkan-intel` and `mesa-vulkan-ati` from the
      `base` stage `apk add` in `services/worker/Dockerfile`, and delete the comment block above it.
      Keep `ffmpeg`, `mkvtoolnix`, `libc6-compat` and the four-stage shape.
      *Done when:* `bin/build worker` succeeds and
      `bin/cli worker apk info -e vulkan-loader mesa-vulkan-intel mesa-vulkan-ati` lists nothing.

### Group 3 — the regression guard

- [x] **T012** `[verify]` Run both gates.
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports 0 errors and `bin/npm worker test`
      reports 0 failures with eight `ffmpeg cases` (AC-1, AC-2). → T006, T007, T008
- [x] **T013** `[verify]` Re-dump all eight argument arrays with the new four-argument signature and
      `diff` against T001.
      *Done when:* the diff is **empty** (AC-4). A non-empty diff means the cleanup changed an
      encode — stop, do not proceed to T014, and report which case moved. → T012

### Group 4 — retire the corpus

- [x] **T014** `[ffmpeg]` `git rm services/worker/ffmpeg/{1,2,3,4,5,6,7}.json` and
      `git add services/worker/ffmpeg/8.json` (REQ-8). Do not weaken `loadCases()`, the module-scope
      load or the empty-directory guard to suit a one-case corpus. **Report explicitly** what
      coverage this drops: 4K DoVi remux audio selection, English SDH exclusion, the HEVC-1080p copy
      rule (V5) and the `throws` case now have no assertion anywhere.
      *Done when:* `services/worker/ffmpeg/` holds `8.json` alone, tracked; `bin/npm worker test` is
      green with exactly one `ffmpeg cases` test; and moving `8.json` aside makes the suite **error**
      rather than pass vacuously (AC-5). → T013

### Group 5 — the stack

- [x] **T015** `[verify]` `bin/build worker && bin/dev`, then read the logs and the container. The
      rebuild must come first — verifying against a cached image is the one way this reports a false
      pass.
      *Done when:* `worker` reaches running; `docker compose logs worker | grep -c 'tonemap path:'`
      is `0`; no `VK_ERROR_INCOMPATIBLE_DRIVER`; and `bin/cli worker ls /dev/dri` shows the device
      **absent inside the container** even though this host has one (AC-6). → T009, T010, T011
- [x] **T016** `[verify]` Add `USE_GPU=false` back into `.env` by hand and confirm `bin/dev`'s
      `docker compose` invocation and the worker's FFmpeg arguments are identical to with the line
      absent; then run `bin/install` against a scratch checkout.
      *Done when:* both invocations match byte for byte (AC-7), and the fresh install asks nothing
      about a GPU with `grep -c USE_GPU .env` returning `0` (AC-8). → T015

### Group 6 — documentation

All after T014, so the counts written down are the counts actually observed.

- [x] **T017** `[docs]` `.claude/agents/ffmpeg.md` — **the highest-value task in this feature.**
      Rewrite rule **V3** to the shipped behaviour (4K HEVC downscales to 1080p; DoVi/HDR10 keep
      their HDR and are tagged `bt2020`/`smpte2084`; 4K SDR is a plain downscale) and strip every
      citation of a retired case from § Rules and from the case-shape example, including
      `"vulkanAvailable": false`, the `Tonemapped from 4K DoVi` title example and the `6.json` note.
      With the corpus down to one case, § Rules is the only surviving record of what the retired
      cases proved. Left stale, the next `ffmpeg` dispatch reads V3 as authority and reintroduces
      tonemapping as a bug fix.
      *Done when:* the file cites no case file that does not exist, and V3 describes HDR preserved.
      → T014
- [x] **T018** `[docs] [P]` `services/worker/CLAUDE.md` — the last *Known debt* bullet (Vulkan
      packages in the `base` stage), the `bin/npm worker test` counts in *Dev loop*, and the corpus
      paragraph's `6.json` example and case-count claim.
      *Done when:* the stated suite counts match T014's observed output. → T014
- [x] **T019** `[docs] [P]` Root `CLAUDE.md` — the transcode row of the pipeline table (1080p with
      HDR preserved, no GPU), the `USE_GPU` bullet under *Environment*, the `bin/dev`/`bin/prod`/
      `bin/build` descriptions, and the `017` reference.
      *Done when:* the file mentions no GPU, no tonemap and no `USE_GPU`. → T014
- [x] **T020** `[docs] [P]` `README.md` — the transcode feature bullet (`:48`), the GPU-acceleration
      bullet (`:58-59`), the `bin/dev` description (`:138-139`) and the CPU-bound-encode note
      (`:206-207`).
      *Done when:* the GPU-acceleration bullet is gone and the transcode bullet says HDR is
      preserved. → T014
- [x] **T021** `[verify]` Run the AC-3 sweep, last, because it covers the prose the four tasks above
      just corrected:
      `grep -rniE 'vulkan|libplacebo|tonemap|USE_GPU|dev/dri' services/worker bin docker-compose.yaml docker-compose.dev.yaml .env.example README.md CLAUDE.md`.
      *Done when:* no hit. `docs/spec/features/` is deliberately outside the sweep — `017` and the
      shipped specs keep their text (AC-3). → T015, T016, T017, T018, T019, T020
- [x] **T022** `[docs]` Walk the acceptance criteria in `spec.md`, tick each box against the evidence
      from T012–T021, and set `status: Implemented` on `spec.md`, `plan.md`, `ffmpeg/plan.md`,
      `worker/plan.md` and `infra/plan.md`. Confirm `017`'s `status: Superseded` and its pointer are
      in place (AC-9).
      *Done when:* all nine AC boxes are ticked with an observed result, not an assumption.
      → T016, T017, T018, T019, T020, T021

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

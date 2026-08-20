---
title: Worker GPU Strategy — Tasks
last_updated: 2026-08-20
status: Done
---

# TASKS: Worker GPU Strategy (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[infra]` | Repo-root and third-party-container territory — `bin/`, `docker-compose.yaml`, `.env.example`, `services/*/Dockerfile`. The difference from `[docs]` is executable config versus prose, so these carry a real *Done when*. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

`api` and `web` do not appear in this feature. Its `services:` list is `[infra, worker]`, and
`spec.md` § GraphQL Contract Delta is **None** — an agent that finds itself editing
`services/api/` or `services/web/` has left its lane and must stop and report.

Note for `[docs]`: `infra/plan.md`'s file table lists `README.md` and the two `CLAUDE.md` files
under the infra slice. This file overrides that — prose is `[docs]` (T015), executable config is
`[infra]`. The infra agent should not touch them.

## Tasks

### Group 1 — unblock the parallel work

Both of these come first because each one, left undone, silently degrades a later task rather than
failing it.

- [x] **T001** `[infra]` Add `- USE_GPU=${USE_GPU}` to the `worker` service's `environment:` block
      in `docker-compose.yaml`, in the same `- NAME=${NAME}` form as the five entries already there.
      *Done when:* `docker compose config` shows `USE_GPU` under the `worker` service, and
      `bin/cli worker printenv USE_GPU` prints the value set in `.env`. Without this the worker's
      opt-out branch reads `undefined`, probes anyway, and AC-2 cannot pass — with no error.
- [x] **T002** `[docs] [P]` Correct `.claude/agents/worker.md`, which still states this service has
      no tests and no `vitest.config.ts`. It has 9 suites, 75 tests, and the config exists.
      *Done when:* the brief's § Tests no longer instructs an agent to create `vitest.config.ts`,
      and names the real baseline. Must land before T003–T008 dispatch, or the worker agent will
      act on a false premise and re-add the config.

### Group 2 — worker slice

Runs in parallel with Group 3 in full. The two slices share no file and neither imports the other;
they meet only at the `USE_GPU` name, whose meaning is frozen in `plan.md` § Contract Freeze.

- [x] **T003** `[worker] [P]` Create `src/ffmpeg/vulkan.ts`: async `probeVulkan()` returning both a
      boolean and a reason (`forced-off` / `no-device` / `available`), plus a sync memoized
      `isVulkanAvailable()`. Follow `src/ffmpeg/metadata.ts`'s `promisify(execFile)` pattern, not
      `runner.ts`'s `spawn` machinery. Exactly the string `false` opts out without spawning; an
      explicit `timeout`; non-zero exit, throw or timeout all resolve to `no-device`, never a
      rejection; reject a device named `llvmpipe`/`lavapipe`/`SwiftShader`. → T002
      *Done when:* `bin/cli worker npx --no tsc --noEmit` is clean, and a one-off invocation inside
      the container resolves `available` on this host (which reports `Intel(R) UHD Graphics
      (TGL GT1)`), and `forced-off` with `USE_GPU=false` set.
- [x] **T004** `[worker]` Write `src/ffmpeg/vulkan.spec.ts`, opening with a header comment naming
      the bug class it prevents. Cover: exactly `false` opts out without spawning; `true`, unset,
      `False`, `0`, `no` all fall through to probing; a probe failure resolves unusable rather than
      throwing; `isVulkanAvailable()` before any probe returns `false`. → T003
      *Done when:* `bin/npm worker test` green with the new suite counted; report the new totals.
- [x] **T005** `[worker] [P]` Add `vulkanAvailable: boolean` to `getVideoParams` in
      `src/ffmpeg/params.ts` and give the Dolby Vision (`:85-96`) and HDR10 (`:113-124`) branches a
      software alternative to `libplacebo`, landing on the same 1920x1080 geometry and `bt709`
      output primaries/transfer/matrix. Scale before tonemapping. Leave the `-metadata:s:v:0` title
      strings byte-identical across both paths, and the `h264`/`vc1`/4K-SDR/copy branches untouched.
      *Done when:* the emitted chain is verified against the real binary, not just asserted — build
      the fixture once with
      `bin/cli worker ffmpeg -y -f lavfi -i testsrc=size=3840x2160:duration=2:rate=24 -c:v libx265 -pix_fmt yuv420p10le -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc /tmp/hdr4k.mkv`,
      run the emitted `-vf` over it, and confirm `bin/cli worker ffprobe` reports `1920x1080` with
      `bt709` on all three colour fields. Paste the real output; record the chain that actually
      worked, which may differ from the one drafted in `worker/plan.md`.
- [x] **T006** `[worker]` Extend `src/ffmpeg/params.spec.ts` with the first-ever `getVideoParams`
      coverage: four cases (HDR10 × DoVi, `vulkanAvailable` true × false), asserting the exact `-vf`
      string, plus an assertion that the metadata title is identical across each true/false pair.
      Add a `videoStream(overrides)` factory matching the existing `audioStream`/`subtitleStream`
      style. → T005
      *Done when:* `bin/npm worker test` green; the four cases fail if the chain is reordered.
- [x] **T007** `[worker]` Add the boolean as a fifth parameter of `buildFfmpegCommand`
      (`src/ffmpeg/buildCommand.ts`) and pass it to `getVideoParams`. Do not read
      `isVulkanAvailable()` in this file — it stays an argument so the spec can drive both paths.
      Update `src/ffmpeg/buildCommand.spec.ts` for the new signature plus one assertion that the
      boolean reaches the video params. → T005
      *Done when:* typecheck clean and `bin/npm worker test` green.
- [x] **T008** `[worker]` Wire it up: `src/encode/encode.ffmpeg.ts` calls `isVulkanAvailable()` and
      passes the result to `buildFfmpegCommand`; `src/index.ts` runs the probe before the two
      `Worker`s are constructed and logs the one line naming the chosen path and reason. This
      service is `"type": "commonjs"` — use an async bootstrap, do not convert the package to ESM.
      → T003, T007
      *Done when:* `docker compose logs worker` shows exactly one startup line naming the path and
      reason, and typecheck is clean.

### Group 3 — infra slice

Fully parallel with Group 2. T009–T012 are also parallel with each other — four different files.

- [x] **T009** `[infra] [P]` Replace the `USE_GPU` block in `bin/dev:21`, `bin/prod:22` and
      `bin/build:34` with `[ -d /dev/dri ]` detection plus opt-out: attach
      `-f docker-compose.gpu.yaml` when a render node exists **and** `USE_GPU` is not exactly
      `false`. Keep the three scripts identical to each other, and update each one's header comment
      — all three currently describe `USE_GPU` as the flag that turns the GPU on.
      *Done when:* on this host (which has `/dev/dri`) `bin/dev` attaches the overlay — confirmed
      via `docker compose config` showing the device on `worker`; with `USE_GPU=false` it does not,
      and `worker` still reaches running. `bin/prod` and `bin/build worker` take the same branch
      under both settings. Paste real output.
- [x] **T010** `[infra] [P]` Delete the GPU question and its explanatory `echo` block from
      `bin/install:60-72`. Do not replace it with a different question. Either omit `USE_GPU` from
      the generated `.env` or write it commented — unset means auto either way; say which you chose.
      *Done when:* a run of `bin/install` against a scratch `.env` completes without asking about
      the GPU, and the resulting stack still boots with `bin/dev`.
- [x] **T011** `[infra] [P]` In `services/worker/Dockerfile`, add the Mesa AMD Vulkan driver to the
      `base` stage's `apk add` line, and rewrite the comment at `:6-9`, which wrongly implies the
      apk packages are what enable `libplacebo` — it is compiled into Alpine's ffmpeg
      (`--enable-libplacebo`); the packages supply only loader and driver. **Do not add
      `mesa-vulkan-swrast`.** The package name `mesa-vulkan-ati` is unverified — confirm it against
      the pinned `node:24.18.0-alpine`; if it does not exist there, drop REQ-8 and report rather
      than substituting something similar.
      *Done when:* `bin/build worker` exits 0 with the new package list, or the task is reported
      blocked with the actual `apk` error.
- [x] **T012** `[infra] [P]` Rewrite the `USE_GPU` comment block in `.env.example:20-27` for the new
      tri-state meaning: unset/`true` = auto-detect, exactly `false` = force the CPU path, and no
      value means "force GPU". Keep the existing note that AV1 encoding is always CPU-bound.
      *Done when:* the block no longer describes `USE_GPU` as opt-in, and `grep -n USE_GPU
      .env.example` shows the variable still present and defaulted.

### Group 4 — integration verification

Needs both slices complete. These are the acceptance criteria that cannot be reached from inside one
lane. Neither task writes any file.

- [x] **T013** `[worker]` Walk **AC-1 and AC-2** against the `/tmp/hdr4k.mkv` fixture from T005: with
      the overlay active, confirm `1920x1080` + `bt709` on all three colour fields and a startup log
      naming Vulkan; then with `USE_GPU=false` in `.env`, confirm the same geometry and colorimetry
      and a startup log naming the forced-off reason. Run both over the **same** source file — the
      point is that the two paths agree, not that each is internally consistent.
      → T008, T001, T009
      *Done when:* both `ffprobe` outputs pasted side by side and matching on geometry and all three
      colour fields. A mismatch is a `Blocked` row, not a rounding error.
- [x] **T014** `[infra]` Walk **AC-3 and AC-4**: bring the stack up without the overlay so the
      container has no `/dev/dri`, confirm the worker starts, logs "no Vulkan device", completes an
      encode, and that `docker compose logs worker` contains no `VK_ERROR_INCOMPATIBLE_DRIVER`; then
      verify `bin/dev` omits the overlay when no render node is present. → T009, T008
      *Done when:* AC-3 fully evidenced. **AC-4 cannot be fully closed on this host** — it has a
      render node, so the Docker Desktop/Windows case is unreachable here. Evidence the branch logic
      by testing against a path that does not exist, and report the Windows confirmation as
      outstanding rather than ticking AC-4 as passed.

### Group 5 — docs and close

- [x] **T015** `[docs]` Update the prose surfaces: `README.md:58` (the "optional GPU acceleration
      (`USE_GPU=true`)" bullet), `README.md:137` (`bin/dev` reads `USE_TRAEFIK` and `USE_GPU`),
      `README.md:206` (the CPU-bound-encode note), the root `CLAUDE.md` § Environment entry for
      `USE_GPU`, and `services/worker/CLAUDE.md`'s "Known debt" bullet about the `base` stage
      packages plus its test-count line if T004/T006 changed it. The root pipeline table's
      **Transcode** row keeps its "working" status — this feature changes where one filter runs, not
      whether the stage works — but should gain a clause noting the runtime GPU/CPU tonemap split.
      → T013, T014
      *Done when:* no surface still describes `USE_GPU` as an opt-in flag, and the worker test
      counts in `services/worker/CLAUDE.md` match `bin/npm worker test`.
- [x] **T016** `[docs]` Walk the acceptance criteria in `spec.md`, tick each box that is genuinely
      evidenced, and set `status: Implemented` on `spec.md`, `plan.md`, `worker/plan.md` and
      `infra/plan.md`. → T015
      *Done when:* every AC box is ticked or explicitly annotated with why it is not (AC-4 is
      expected to be the annotated one), and all four files read `status: Implemented`.

## Acceptance criteria coverage

Every criterion in `spec.md` is reachable:

| AC | Reached by |
| :-- | :-- |
| AC-1 | T013 |
| AC-2 | T013 (needs T001 for the opt-out to reach the container at all) |
| AC-3 | T014 |
| AC-4 | T014 — **partial by nature**; see the task's *Done when* |
| AC-5 | T004 and T006 |
| AC-6 | Every `[worker]` task's *Done when*, confirmed once more in T013 |

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

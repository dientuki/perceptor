---
title: Retire the GPU Tonemap Strategy
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-25
last_updated: 2026-08-25
status: Implemented
services: [ffmpeg, worker, infra]
---

# SPEC: Retire the GPU Tonemap Strategy (`spec.md`)

## Context & Goal

`017-worker-gpu-strategy` exists to answer one question: **where does the tonemap pass run**. Its own
goal line says so — the feature decides where a filter executes, never what quality it targets. Every
moving part it introduced hangs off that question: the runtime Vulkan probe in
`services/worker/src/ffmpeg/vulkan.ts`, the `vulkanAvailable` boolean threaded from
`src/encode/encode.ffmpeg.ts` through `src/ffmpeg/buildCommand.ts` into `getVideoParams`, the two
filter chains `GPU_TONEMAP_VF` and `SOFTWARE_TONEMAP_VF` in `src/ffmpeg/params.ts`, the
`vulkan-loader`/`mesa-vulkan-intel`/`mesa-vulkan-ati` packages in the `base` stage of
`services/worker/Dockerfile`, the `docker-compose.gpu.yaml` overlay, the `USE_GPU` variable, and the
`[ -d /dev/dri ] && [ "${USE_GPU}" != "false" ]` branch repeated in `bin/dev`, `bin/prod` and
`bin/build`.

Commit `8d9572d` removed the tonemap. The 4K HEVC branch of `getVideoParams` now downscales to
1080p and **preserves** the source's HDR (`-colorspace bt2020nc`, `-color_primaries bt2020`,
`-color_trc smpte2084`) instead of flattening it to bt709 SDR, and the emitted track title reads
`Downscaled from 4K …` rather than `Tonemapped from 4K …`. That is the shipped, productive
behaviour and this feature does not revisit it. But with no tonemap there is no filter that needs
Vulkan, which leaves the whole of `017` as machinery wired to a decision nobody makes any more:
`vulkanAvailable` is accepted by two functions and read by none, `GPU_TONEMAP_VF` and
`SOFTWARE_TONEMAP_VF` have no references, and the worker still logs `tonemap path: …` at every boot
about a pass that no longer exists.

It is not inert dead weight, either. `bin/npm worker test` is **red today — 11 failed of 117, across
`src/ffmpeg/params.spec.ts`, `src/ffmpeg/buildCommand.spec.ts` and `src/ffmpeg/cases.spec.ts`** —
because six `getVideoParams` cases still assert the libplacebo and zscale chains, `buildCommand`
still asserts the flag is threaded through, and four corpus cases still carry stale expectations.
A red suite is the expensive part: it is the gate the `ffmpeg` agent works against when a track is
selected wrong, and while it stays red nobody can tell a real regression from the known noise.
The corpus is in worse shape than the failure count suggests. All seven versioned cases were written
before `8d9572d` and every one of them carries the `vulkanAvailable` flag; `6.json` is not even a
distinct case, existing **only** to pair `1.json`'s probe with the opposite value. Rather than
retrofit seven stale files to a policy they were never written for, they are retired and `8.json` —
authored against the shipped behaviour and still untracked in the working tree — is committed as the
corpus's single case and its worked example. That is a real loss of coverage and it is taken
knowingly; REQ-8 says what it costs and where the rules it proved continue to live.

The goal is that the worker, its image and the host scripts carry nothing about GPUs, Vulkan or
tonemapping, and that `bin/npm worker test` is green and honest again. This is a demolition: the
diff removes and nothing replaces it. No pipeline stage in the root `CLAUDE.md` changes status —
transcode stays *working*, on every host, with one image and one code path.

## Requirements

### Functional Requirements

- [x] **REQ-1 (No Vulkan probe)**: The worker must not probe for, detect, memoize or log the
      availability of a Vulkan device at any point in its lifetime. The startup banner must no
      longer name a tonemap path or a reason for it.
- [x] **REQ-2 (No GPU flag in the encode path)**: No function that builds FFmpeg arguments may
      accept, thread, store or read a GPU/Vulkan flag. This includes the case corpus under
      `services/worker/ffmpeg/`, whose `input` objects must no longer carry one.
- [x] **REQ-3 (No tonemap chains)**: The `libplacebo` filter chain and the `zscale`/`tonemap`
      software chain must not appear anywhere in `services/worker/src/`. The worker emits no
      tonemapping filter for any source.
- [x] **REQ-4 (The image carries no Vulkan stack)**: The `worker` image must not *explicitly*
      install a Vulkan loader or any Mesa Vulkan driver — both Mesa driver packages
      (`mesa-vulkan-intel`, `mesa-vulkan-ati`) are removed. **Known limitation, accepted at
      implementation time:** `vulkan-loader` itself cannot be fully removed from the image while it
      still runs Alpine's `ffmpeg` package — `ffmpeg-libavfilter` hard-depends on `libplacebo`,
      which hard-depends on `so:libvulkan.so.1`, so `apk` reinstalls the loader transitively even
      with no explicit `apk add` line naming it. Removing it entirely would mean compiling `ffmpeg`
      from source with `--disable-libplacebo` — a new build stage, a longer build, and a
      hand-maintained `ffmpeg` version instead of `apk`'s — which is out of proportion to a
      demolition feature and is explicitly **not** undertaken here. This carries no functional risk:
      no Mesa driver is present, no `/dev/dri` is mapped (REQ-5), and the code path that could ever
      invoke the filter is deleted (REQ-3) — the loader library sits on disk, linked by nothing.
      Compiling a libplacebo-free `ffmpeg` is real future work if this ever needs to be exact, not
      this feature's.
- [x] **REQ-5 (No device mapping, no branch)**: The GPU compose overlay must be gone, and
      `bin/dev`, `bin/prod` and `bin/build` must each produce the **same** `docker compose`
      invocation regardless of whether the host exposes a render node. No `/dev/dri` is mapped into
      any container.
- [x] **REQ-6 (`USE_GPU` retired)**: `USE_GPU` must be removed from `.env.example` and read by no
      script and no service. It is also no longer passed into the `worker` container
      (`docker-compose.yaml:201`). A fresh `bin/install` must therefore produce an `.env` that does
      not contain the name at all — `017` already removed the *question* `bin/install` used to ask,
      but the variable still arrives in every generated `.env` because the script copies
      `.env.example` wholesale. A stale `USE_GPU` line left behind in a developer's **existing**
      `.env` must be **inert** — it may not change the behaviour of anything, in either direction.
- [x] **REQ-7 (The suite is green and honest)**: `bin/npm worker test` must pass with no failures.
      Every assertion that tested the removed decision is deleted rather than adapted, and every
      assertion that pins the **current** command is kept and corrected.
- [x] **REQ-8 (The corpus is reset to one current case)**: The seven versioned cases
      `services/worker/ffmpeg/{1..7}.json` predate commit `8d9572d` and are retired wholesale;
      `8.json`, written against the shipped behaviour, is committed and becomes the corpus's single
      case and its worked example. The runner's guarantees are unchanged — a malformed case must
      still fail collection and an empty directory must still be an error, not a vacuous pass.
      **This is a deliberate, owner-approved loss of regression coverage**, not a cleanup that
      happens to shed tests: the retired cases carry the only assertions in the repository over
      several audio, subtitle and video rules. The rules those cases proved are recorded in
      `.claude/agents/ffmpeg.md` and must survive there with their citations corrected (REQ-9);
      re-earning the coverage with fresh probes of real files is follow-up work, not this feature's.
- [x] **REQ-9 (Documentation stops promising SDR)**: Every live documentation surface that today
      describes the worker as tonemapping 4K HDR/DoVi to 1080p SDR, or as auto-detecting a GPU for
      that pass, must instead describe the shipped behaviour: a downscale to 1080p that preserves
      the source's HDR, on CPU, with no GPU involvement anywhere. `.claude/agents/ffmpeg.md` carries
      this in two ways and both are required: rule **V3** must describe a plain downscale with HDR
      preserved, and every rule that cites a retired case (`1.json`, `3.json`, `4.json`, `5.json`,
      `6.json`) must lose the citation rather than keep pointing at a file that no longer exists.
- [x] **REQ-10 (`017` is superseded, not erased)**: `docs/spec/features/017-worker-gpu-strategy/`
      stays on disk with `status: Superseded` and a pointer to this feature. It is the record of a
      decision that was correct while the tonemap existed; deleting it would erase why the Vulkan
      packages were ever in the image.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Not one encode changes)**: This is removal only. For every source the corpus covers,
      the FFmpeg argument array the worker produces must be **byte-identical** before and after this
      feature. Codec, CRF, preset, `-svtav1-params`, `-pix_fmt`, the colour tags and the track title
      are all untouched, as are the audio and subtitle selection rules. A cleanup that silently
      alters an encode is the failure mode this feature has to defend against: the job still reports
      `COMPLETED` and the wrong file lands in the library with no error in any log (Constitution,
      Article IX).
- [x] **NFR-2 (Starts everywhere, unconditionally)**: The `worker` container must start and complete
      an encode on a host with no `/dev/dri` at all — every Docker Desktop on Windows — with no
      overlay, no opt-out and nothing for a human to answer. What `017` achieved through detection,
      this feature achieves by having nothing to detect.
- [x] **NFR-3 (Nothing kept for later)**: No replacement flag, no `HW_ACCEL` variable, no commented
      block, no disabled code path preserved "for when hardware AV1 arrives" (Constitution, Article
      X). The later feature can add it with the use case in hand.
- [x] **NFR-4 (The diff removes)**: The net change must delete substantially more than it adds. An
      addition anywhere in this feature has to name the constraint that made it unavoidable.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.**

`infra` has no GraphQL surface. The `worker`'s change is confined to `src/ffmpeg/`, `src/encode/`,
its startup path and its test corpus: no field on `EncodeJobDetails` or `EncodeInput`, no argument
on any `api` mutation, no change to the `processJob`/`encode` payloads in `src/queue/types.ts`.
`api` and `web` are untouched and need no coordination — consistent with `017`, which never routed
the GPU decision through `api` in the first place, so there is nothing on the contract to unwind.

## Data Model Changes

**None.** No Prisma model, field, enum or migration.

## Acceptance Criteria

- [x] **AC-1**: `bin/npm worker test` reports **0 failed**. Today it reports `Test Files 3 failed |
      10 passed (13)` and `Tests 11 failed | 106 passed (117)`; that exact output is the before-state
      this criterion closes.
- [x] **AC-2**: `bin/cli worker npx --no tsc --noEmit` reports 0 errors.
- [x] **AC-3**: `grep -rniE 'vulkan|libplacebo|tonemap|USE_GPU|dev/dri' services/worker bin
      docker-compose.yaml docker-compose.dev.yaml .env.example README.md CLAUDE.md` returns no hit.
      `docs/spec/features/` is deliberately excluded — `017` and `011` keep their text (REQ-9).
- [x] **AC-4 (regression guard, NFR-1)**: For all **eight** probes present in
      `services/worker/ffmpeg/` today, the argument array produced at `HEAD` before this feature and
      the array produced after are identical. Captured mechanically — dump both and `diff` them —
      not by reading the corpus expectations, since four of those expectations are stale and would
      agree with a wrong answer. The retired cases are deleted **after** this diff runs, not before:
      their `ffprobe` blocks are the only real-file evidence available to prove the cleanup changed
      no encode, and discarding them first would leave NFR-1 resting on a single case (REQ-8).
- [x] **AC-5 (corpus reset)**: `services/worker/ffmpeg/` contains exactly one file, `8.json`, and it
      is tracked in git. `bin/npm worker test` reports one `ffmpeg cases` test. Pointing the runner
      at an empty directory still fails rather than passing vacuously — verified by temporarily
      moving `8.json` aside and observing the suite error.
- [x] **AC-6 (failure path)**: On a host with **no** `/dev/dri`, `bin/dev` brings the `worker` to a
      running state and an encode of a 4K HDR source completes. `docker compose logs worker`
      contains no `VK_ERROR_INCOMPATIBLE_DRIVER` and no `tonemap path:` line. This is `017`'s AC-3
      and AC-4 restated as a permanent property rather than one a probe has to earn each boot.
- [x] **AC-7 (failure path)**: With a stale `USE_GPU=false` still present in `.env`, `bin/dev`
      produces the identical `docker compose` invocation and the worker produces the identical
      FFmpeg arguments as with the line absent. Verified by comparing both invocations directly —
      the variable is inert, not merely defaulted.
- [x] **AC-8**: `bin/install` run against a fresh checkout asks nothing about a GPU and produces an
      `.env` in which `grep -c USE_GPU .env` returns `0`.
- [x] **AC-9**: `docs/spec/features/017-worker-gpu-strategy/spec.md` reads `status: Superseded` and
      names this feature; the root `CLAUDE.md` transcode row and the `README.md` feature bullet both
      describe a 1080p downscale that preserves HDR, and neither mentions a GPU.

## Out of Scope

- **The HDR policy itself.** Whether the worker should tonemap or preserve HDR was settled in
  `8d9572d` and is the premise of this feature, not its subject. This spec removes the machinery the
  old policy needed; it does not re-open the choice.
- **The FFmpeg selection rules.** Audio, subtitle, track-title, CRF and remux detection are the
  `ffmpeg` agent's territory (`.claude/agents/ffmpeg.md`) and are productive and working. Nothing
  here may change what an encode keeps or drops — only what surrounds the decision (NFR-1).
- **The HLG colour tag.** `getVideoParams`'s HDR branch also fires on `color_transfer=arib-std-b67`
  (HLG) while tagging the output `-color_trc smpte2084` (PQ). Recorded here so it is not lost, and
  deliberately **not** touched: the rules are in production and correcting a colour tag is a change
  to what an encode produces, which is the opposite of what this feature is for. It belongs to the
  `ffmpeg` agent, with a corpus case, on its own.
- **Hardware acceleration of any kind, in any future form.** No current consumer GPU encodes AV1 in
  hardware, and there is no filter left that would use a GPU. If that changes, the feature that needs
  it reintroduces the mapping with its use case in hand (NFR-3).
- **Stripping `libplacebo` from the FFmpeg binary.** It is compiled into Alpine's `ffmpeg` package
  (`--enable-libplacebo`); this feature removes the loader and drivers, which is everything under
  our control. The filter remains present and unselectable, which costs nothing.
- **Rewriting shipped specs.** `011-av1-transcode` and `013-season-pack-processing` describe what
  they shipped, when they shipped it, and stay as historical records. Only `017`, whose entire
  subject this feature removes, changes status (REQ-9). Current truth lives in `CLAUDE.md` and
  `README.md` (REQ-8).
- **Any change to `api` or `web`.** Neither service participates — see the GraphQL section.

## Documentation to update

Not requirements in themselves; the surfaces REQ-8 and REQ-9 make wrong, listed so none is missed:

- `.env.example` — the `USE_GPU` tri-state block, removed entirely. This is also what stops the name
  reaching a freshly generated `.env`; `bin/install` needs no edit of its own, since `017` already
  removed the question it used to ask and the variable only survives as a copied line.
- Root `CLAUDE.md` — the transcode row of the pipeline table, the `USE_GPU` bullet under
  *Environment*, the `bin/dev`/`bin/prod`/`bin/build` descriptions and the `017` spec reference.
- `services/worker/CLAUDE.md` — the last *Known debt* bullet (Vulkan packages in the `base` stage),
  the `bin/npm worker test` counts in *Dev loop*, and the corpus paragraph's `6.json` example.
- `.claude/agents/ffmpeg.md` — the tonemap rule paragraph, the `vulkanAvailable` line in the case
  shape, the `Tonemapped from 4K DoVi` title example and the `6.json` note.
- `README.md` — the transcode feature bullet, the GPU-acceleration bullet, the `bin/dev` description
  and the CPU-bound-encode note.
- `docker-compose.gpu.yaml` — deleted (REQ-5).
- `docs/spec/features/017-worker-gpu-strategy/spec.md` — `status: Superseded`, pointing here.

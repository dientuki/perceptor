---
title: Worker GPU Strategy
spec_version: 0.2.0
author: Juan Farias
created_at: 2026-08-18
last_updated: 2026-08-19
status: Approved
services: [infra, worker]
---

# SPEC: Worker GPU Strategy (`spec.md`)

## Context & Goal

The `worker` image is tied to the hardware of one particular machine. Its `base` stage installs
`vulkan-loader` and `mesa-vulkan-intel` (`services/worker/Dockerfile:10`) because the encode
pipeline uses the **`libplacebo`** filter to tonemap 4K HDR10 and Dolby Vision sources down to
1080p SDR (`services/worker/src/ffmpeg/params.ts:88` and `:116`). `libplacebo` is a Vulkan filter:
without a usable Vulkan driver it fails with `VK_ERROR_INCOMPATIBLE_DRIVER`, and
`mesa-vulkan-intel` is the **Intel** driver. Around that one decision sits an overlay
(`docker-compose.gpu.yaml`, which maps `/dev/dri`), the `USE_GPU` variable (`.env.example:27`), a
question in `bin/install` and a branch in each of `bin/dev:21`, `bin/prod:22` and `bin/build:34`.

A distinction the current code comments blur, and which decides the shape of this feature:
**`libplacebo` is compiled into Alpine's ffmpeg binary itself** (`ffmpeg 8.1.2`, configured
`--enable-libplacebo --enable-vulkan --enable-libzimg`). The two apk packages supply only the
*loader* and the *driver*. Removing them does not remove the filter — it leaves a filter that is
present, selectable, and guaranteed to fail. Equally, the software fallback needs no new package:
`zscale` (from `libzimg`) and `tonemap` are already in the shipped image today.

None of this is portable. On Windows (Docker Desktop) **there is no `/dev/dri`**: `USE_GPU=true`
does not merely lose acceleration, it stops the container from starting at all. On a Linux host
with an AMD or NVIDIA GPU, the installed driver is Intel's, so mapping `/dev/dri` enables nothing.
And even with `USE_GPU=false` the image still carries the loader and the Mesa driver. The AV1
encode itself **always runs on CPU** — no current consumer GPU encodes AV1 in hardware, as
`docker-compose.gpu.yaml` already documents — so the only thing at stake here is the tonemap pass
on 4K HDR/DoVi sources.

The goal is that **one image runs on Windows and on Linux, with or without a GPU, and uses the GPU
wherever one is actually usable**. The chosen strategy is runtime detection: keep `libplacebo`, have
the worker determine at startup whether a usable Vulkan device exists, and fall back to a software
tonemap chain when it does not.

Strategy B carries a consequence the problem statement above understates. Runtime detection cannot
see a GPU that compose never mapped in, so `/dev/dri` still has to reach the container and
`docker-compose.gpu.yaml` is still what does it. Deleting the overlay — which a CPU-only strategy
could have done — is not available here. The portability bug therefore has to be fixed on the host
side too, by deciding the mapping from what the host actually has rather than from an answer a
human gave once at install time.

No pipeline stage in the root `CLAUDE.md` changes status. Transcode stays *working*; this feature
changes where one filter runs and on which machines the image will boot.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Vulkan probe)**: The worker must determine, once per process at startup, whether a
      usable Vulkan device is available, by exercising ffmpeg's own Vulkan initialization rather
      than by inspecting `/dev/dri`, the host OS, or any environment variable. A render node that
      exists but has no matching driver — an AMD card with only the Intel driver installed — must
      resolve to **unusable**.
- [ ] **REQ-2 (Software fallback chain)**: When Vulkan is unusable, both `libplacebo` branches in
      `getVideoParams` must emit an equivalent software chain. The output must carry the same
      geometry (1920x1080) and the same output colorimetry (`bt709` primaries, transfer and
      matrix) as the GPU path produces.
- [ ] **REQ-3 (One image)**: The decision is runtime-only. No build-time GPU variant, no second
      image tag, no separate Dockerfile stage. A single `runner` image must serve every host.
- [ ] **REQ-4 (Starts without a render node)**: The `worker` container must start and complete an
      encode on a host that has no `/dev/dri` at all, which is every Docker Desktop on Windows.
- [ ] **REQ-5 (The host mapping is detected, not declared)**: `bin/dev`, `bin/prod` and `bin/build`
      must include the GPU overlay based on whether the host actually exposes a render node.
      `USE_GPU` is retained **only as an explicit opt-out** — set to `false` it forces the CPU path
      even on a capable host, which is what makes REQ-2 testable on a developer machine that has a
      GPU. The `bin/install` question is removed; there is no longer a correct answer for a human
      to give.
- [ ] **REQ-6 (The decision is observable)**: The selected path and the reason for it must be
      logged exactly once at worker startup, distinguishing "no Vulkan device", "forced off by
      `USE_GPU=false`" and "Vulkan in use". The FFmpeg output metadata title is **unchanged** on
      both paths — it describes the source (`Tonemapped from 4K HDR10`), not the engine, and
      changing it per path would make two library files disagree about the same source material.
- [ ] **REQ-7 (Dolby Vision on the fallback)**: On the software path a Dolby Vision source is
      tonemapped as its HDR10 base layer; the RPU is not applied. This is a documented quality
      regression on the fallback path, never an error, and must not fail the job.
- [ ] **REQ-8 (AMD driver)**: The image must also carry the Mesa AMD Vulkan driver, so an AMD host
      reaches the GPU path instead of silently falling back. `mesa-vulkan-ati` is the expected
      package name but is **unverified** — the image is built `--no-cache`, so no package index is
      present in a running container to confirm it against. `/plan-feature` resolves the exact name;
      if no such package exists in the pinned Alpine release, AMD support drops out of this feature
      and REQ-1's fallback covers those hosts correctly anyway.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Probe cost)**: The probe result is memoized for the life of the process. It must not
      run per job — an encode queue at `concurrency: 1` may process hundreds of jobs.
- [ ] **NFR-2 (The probe never fails an encode)**: A probe that errors, times out, or crashes must
      degrade to the CPU path. An inconclusive probe is treated as "no Vulkan", never as a reason
      to fail the job. This is the article-IX case for this feature: the opposite choice yields a
      worker that fails every 4K HDR encode on hardware where the CPU path would have worked.
- [ ] **NFR-3 (Quality policy untouched)**: No change to codec, CRF, preset or `-svtav1-params`.
      This feature decides *where* the tonemap runs, not what quality it targets.
- [ ] **NFR-4 (No new environment variable)**: The runtime decision introduces no new `.env` key.
      `USE_GPU` changes meaning (opt-out rather than opt-in) and that change is documented in
      `.env.example`, the root `CLAUDE.md` and `README.md`.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.**

`infra` has no GraphQL surface at all. The `worker`'s change is confined to its own
`src/ffmpeg/` and its startup path: no new field on `EncodeJobDetails` or `EncodeInput`, no new
argument on any `api` mutation, no change to the `processJob`/`encode` payloads in
`src/queue/types.ts`. `api` and `web` are untouched by this feature and need no coordination.

Deliberately so: routing the GPU decision through `api` would put a fact about the *worker's own
host* into a payload `api` cannot know the answer to. The machine running FFmpeg is the only one
that can tell whether its Vulkan device works.

## Data Model Changes

**None.** No Prisma model, field, enum or migration.

## Acceptance Criteria

The 4K HDR sample is **generated**, not supplied — every criterion below runs on a fresh checkout
with no media on hand. The synthetic clip is a short `bt2020`/`smpte2084` source produced with
`ffmpeg -f lavfi` inside the worker container, and the result is asserted with `ffprobe`.

- [ ] **AC-1**: Given a host with a working Vulkan device, when the synthetic HDR clip is pushed
      through the encode chain, then `ffprobe` on the output reports `width=1920`, `height=1080`,
      `color_primaries=bt709`, `color_transfer=bt709`, and the startup log line reads that Vulkan
      is in use.
- [ ] **AC-2**: Given the same host with `USE_GPU=false` in `.env`, when the same clip is encoded,
      then `ffprobe` reports the same geometry and the same colorimetry as AC-1, and the startup log
      names the forced-off reason.
- [ ] **AC-3 (failure path)**: Given the GPU overlay is excluded so the container has no `/dev/dri`,
      when the worker starts and encodes the synthetic clip, then the job completes, the startup log
      names "no Vulkan device" as the reason, and `docker compose logs worker` contains no
      `VK_ERROR_INCOMPATIBLE_DRIVER`.
- [ ] **AC-4 (failure path)**: Given a host with no render node, when `bin/dev` runs, then the GPU
      overlay is not added to the compose invocation and the `worker` container reaches a running
      state. Today, with `USE_GPU=true` in `.env`, the same host fails to start the container at
      all — that regression is the one this criterion pins.
- [ ] **AC-5**: `bin/npm worker test` stays green and covers `getVideoParams` under both a usable
      and an unusable Vulkan device, for the HDR10 branch and the Dolby Vision branch — four cases.
- [ ] **AC-6**: `bin/cli worker npx --no tsc --noEmit` reports 0 errors, unchanged from before the
      feature.

## Out of Scope

- **Hardware AV1 encoding.** No current consumer GPU encodes AV1 in hardware. It is not an
  alternative to anything decided here, and the encode stays on CPU on every path.
- **NVIDIA GPUs.** Their Vulkan driver does not come from `apk` — it requires
  `nvidia-container-toolkit` on the host plus a different device-mapping mechanism than
  `/dev/dri`. That is its own feature. REQ-1 still handles those hosts correctly: they detect as
  unusable and take the CPU path rather than failing.
- **Changing codec, CRF, preset or `-svtav1-params`.** This feature decides where the tonemap runs,
  not the quality policy (NFR-3).
- **Reproducibility of the `worker` build** (the `builder` stage, `.dockerignore`) — that is
  `015-reproducible-image-builds`, which has already landed. Its `builder` stage is in
  `services/worker/Dockerfile` today, so this feature edits the `base` stage packages of an image
  whose build is already reproducible. The sequencing concern the earlier draft of this spec raised
  is resolved; the two changes are disjoint.
- **Any change to `api` or `web`.** See the GraphQL section — neither service participates.

## Documentation to update

Not requirements, but the surfaces that describe `USE_GPU` today and will be wrong once REQ-5 lands:

- `.env.example:20-27` — the `USE_GPU` comment block, which currently describes it as opt-in.
- `bin/install` — the GPU question is removed (REQ-5).
- Root `CLAUDE.md` — the `BUILD_TARGET`/overlay paragraph and the environment variable list.
- `services/worker/CLAUDE.md` — the "Known debt" bullet about FFmpeg packages in the `base` stage.
- `README.md:58`, `:137` and `:206` — the feature bullet, the `bin/dev` description and the
  CPU-bound-encode note.

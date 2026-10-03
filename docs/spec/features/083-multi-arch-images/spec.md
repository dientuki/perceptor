---
title: Multi-architecture published images
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-10-02
last_updated: 2026-10-02
status: Approved
services: [infra]
---

# SPEC: Multi-architecture published images (`spec.md`)

## Context & Goal

Perceptor publishes five images to GHCR (`perceptor-web`, `-api`, `-worker`, `-torrent`,
`-indexer`) and `install.sh` writes a `docker-compose.yaml` that pulls them. Every one of those
images is built for `linux/amd64` and nothing else — `.github/workflows/release.yml` says
`platforms: linux/amd64` in a single `docker/build-push-action` step, and the header comment of
that file states it as a fact rather than a limitation. On a host that asks for any other
architecture the install does not degrade, it stops: Docker resolves the manifest list, finds no
entry, and answers `no matching manifest for linux/arm64/v8 in the manifest list entries`. All
nine services in the stack fail to pull at once, before a single container starts. The three
third-party images in the same compose file (`mariadb`, `redis:7-alpine`, `traefik:v3.7`) are
already multi-arch, so the failure is entirely ours.

The hosts this locks out are not exotic. Docker Desktop on Apple Silicon requests
`linux/arm64/v8` by default, which is every Mac sold since 2020. Windows on ARM requests the same
image. So do Raspberry Pi 5, Orange Pi, and the ARM instance types at Oracle, Hetzner and AWS
Graviton — which for self-hosted media is a mainstream deployment target, not a curiosity. Windows
on x86 is **not** affected and needs nothing: Docker Desktop there runs containers inside WSL2,
which is `linux/amd64`, the one platform already published. There is no separate "Mac image" and no
"Windows image"; there is one missing architecture, `linux/arm64`, and adding it covers every host
above.

Nothing in this repository is architecture-specific, which is why this is a publication change and
not a port — and that was checked rather than assumed while writing this spec, because every one of
these facts is a way the feature could fail late. `docker manifest inspect` confirms all three base
images publish `arm64` beside `amd64` at the exact tags the Dockerfiles pin
(`node:24.18.0-alpine`, `lscr.io/linuxserver/qbittorrent:5.2.3`,
`lscr.io/linuxserver/prowlarr:2.5.2`). FFmpeg and mkvtoolnix come from `apk` rather than a
downloaded amd64 binary, and the Alpine v3.24 package index (the release `node:24.18.0-alpine`
carries) lists `svt-av1` at `4.1.0-r0` and `ffmpeg-libavcodec` at `8.1.2-r0` for `aarch64` with a
`libSvtAv1Enc` dependency — identical package and version to `x86_64`. That last one is the fact
the whole feature rests on: the worker's only encoder is SVT-AV1 on CPU, so an arm64 image that
pulls and starts but has no `libsvtav1` would satisfy every other requirement here and still be
useless. `services/api/prisma/schema.prisma` pins no `binaryTargets`, so the Prisma engine is
generated for whatever platform the image is built on. The repository is public, which is what
makes GitHub's arm64 runners available to it at no cost and REQ-4 affordable. The
one thing that genuinely changes is the cost of a release: an arm64 build emulated on an x86 runner
multiplies `npm ci`, `next build` and `nest build` by roughly an order of magnitude, which is why
each architecture is built on a runner of its own kind and the two results are joined into one
manifest list.

This feature lands on top of `082-docker-engine-preflight`, which is already implemented and
owns the ground REQ-5 stands on. That feature gave `install.sh` an inline preflight block — the
`docker` command, the Compose plugin, and a reachable engine via `docker info` — placed before the
installer asks its first question or writes its first file, and gave `bin/` a shared
`require_docker` in `bin/_docker.sh` with the same three checks. The architecture check belongs
inside that existing installer block and nowhere else: it is a fourth check in the same place, with
the same shape, the same exit code and the same "write nothing" guarantee, not a new preflight
beside it. Two of `082`'s rules constrain it directly — `install.sh` keeps its checks inline rather
than sourcing the shared helper (it ships alone, by `curl`, with no `bin/` beside it), and no check
may spend a second `docker info` round trip to learn something the first one already knows. A third
rule is the one an implementer is most likely to get wrong by being helpful: the architecture check
must **not** go into `require_docker`, because `bin/` builds from source natively, and an arm64
developer whose host builds arm64 images perfectly well would be locked out of their own stack by a
guard meant for people pulling published ones.

No pipeline stage in the root `CLAUDE.md` changes status. No service under `services/` changes
behaviour. The territory is `.github/workflows/release.yml`, `install.sh`, and the install-side
documentation in `README.md` and the root `CLAUDE.md`.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Two architectures)**: Each of the five published images must resolve for both
      `linux/amd64` and `linux/arm64` under the tag an installation pulls — the version tag and
      `latest` alike. A client on either platform must complete `docker compose pull` with no
      `--platform` override and no emulation.
- [ ] **REQ-2 (One tag, one manifest list)**: The two architectures must be reachable through a
      single image reference, not through separate `-amd64`/`-arm64` tags. `.env`'s
      `PERCEPTOR_TAG` stays one value for the whole stack, and `docker-compose.yaml` keeps its
      current `image:` lines unchanged.
- [ ] **REQ-3 (All or nothing per image)**: A tag must not be published for one architecture
      alone. If either architecture's build fails, that image's version tag and `latest` must be
      left pointing wherever they pointed before the run — an installation must never pull a tag
      that exists for one platform and 404s for the other.
- [ ] **REQ-4 (Native build per architecture)**: Each architecture must be built on a runner of
      that architecture rather than emulated, so that adding arm64 does not make a release take an
      order of magnitude longer than it does today.
- [ ] **REQ-5 (Installer architecture check)**: `install.sh` must determine the architecture
      the Docker **engine** reports — not the host CPU, since the engine may be remote — and, when
      that architecture is not one Perceptor publishes, stop with a message naming the detected
      architecture and the supported ones, instead of letting Docker report `no matching manifest`
      nine times with no explanation of what the user should do. The check extends the preflight
      block `082` put at the top of `install.sh`: it runs before the first question and before any
      file is written, exits `1`, and leaves the directory untouched (`082` NFR-6). Note that the
      engine names architectures the way the kernel does, not the way a manifest does — it answers
      `x86_64` and `aarch64`, never `amd64` and `arm64` — so the accepted set is those two values,
      and a check written against the manifest spelling would reject every host.
- [ ] **REQ-6 (The arm64 worker can actually encode)**: The arm64 `perceptor-worker` image must
      ship a working SVT-AV1 encoder, not merely build and start. An image that pulls natively and
      then fails every job at `ffmpeg` is a worse outcome than today's honest `no matching
      manifest`, because the failure surfaces per title, in the pipeline, long after the install
      looked successful.
- [ ] **REQ-7 (A failed pre-083 install repairs itself)**: An installation directory left behind by
      a pre-083 run on arm64 — one where `install.sh` already wrote `.env` and
      `docker-compose.yaml` and then died at `docker compose pull` — must complete on a re-run of
      the same one-line command, with no manual cleanup and no change to the values already
      written. This is `049` REQ-8's reentrancy, but it has never been exercised after a *pull*
      failure, and it is the exact state every alpha tester on a Mac is in right now.
- [ ] **REQ-8 (Documented support)**: The published architectures must be stated where a
      prospective user looks before installing (`README.md`) and where an agent looks before
      changing the release workflow (root `CLAUDE.md`, and the header comment of `release.yml`
      which currently asserts amd64-only as if deliberate).

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No source change)**: No file under `services/*/src`, no Dockerfile stage, and no
      Prisma schema may change. If a service turns out to need an architecture-conditional branch
      to build on arm64, this feature stops and reports rather than introducing one.
- [ ] **NFR-2 (Existing installs untouched)**: An amd64 installation that pulls a tag published
      after this feature must get a byte-for-byte equivalent image to what it gets today — same
      base, same stage, same entrypoint. Adding an architecture is additive; it may not alter what
      amd64 resolves to beyond the rebuild itself.
- [ ] **NFR-3 (CI unchanged in scope)**: `ci.yml` keeps running typecheck and tests on amd64 only.
      Running the test suites on both architectures is not part of this feature — the thing being
      extended is what we publish, not what we verify.
- [ ] **NFR-4 (Dev and local builds unchanged)**: `bin/dev`, `bin/prod` and `bin/build` keep
      building for the host's native architecture with no `platforms:` argument anywhere. A
      developer on arm64 gets arm64 local images by building natively, which already works.
- [ ] **NFR-5 (Release still atomic across the five)**: The existing operational rule from
      `049-published-images-install` NFR-6 — the five images move together or the release is not
      done — is unchanged by this feature. REQ-3 tightens it per image; it does not replace it.
- [ ] **NFR-6 (Installer preflight stays one round trip)**: REQ-5 must learn the engine's
      architecture from the `docker info` call the preflight already makes, not from a second one
      (`082` NFR-4), and must stay POSIX-ish shell plus the `docker` CLI — no `jq`, no Python, no
      Node on the host (`082` NFR-1, Constitution Article I).
- [ ] **NFR-7 (The check is the installer's alone)**: The architecture check must live inline in
      `install.sh` and must not be added to `require_docker` in `bin/_docker.sh`. `install.sh`
      cannot source the helper (`082` NFR-2), and the `bin/` wrappers must keep working on any
      architecture that can build the images from source, which is the developer's case and has
      nothing to do with what GHCR publishes (NFR-4).
- [ ] **NFR-8 (Transcode performance is per host)**: Perceptor makes no claim about encode speed on
      arm64. The worker runs SVT-AV1 on CPU on every host (root `CLAUDE.md`, Transcode stage); an
      arm64 image that runs natively is the deliverable, a performance target is not.

## GraphQL Contract Delta

None — this feature does not cross the service boundary. It changes which platforms the published
container images are built for and what `install.sh` checks before pulling them. No resolver, no
type, no field, no error key, and no file under `services/` is touched (NFR-1).

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: After a release run, for each of `web`, `api`, `worker`, `torrent`, `indexer`,
      `docker manifest inspect ghcr.io/dientuki/perceptor-<svc>:<tag>` lists two entries whose
      `platform` fields are `linux/amd64` and `linux/arm64`.
- [ ] **AC-2**: On an Apple Silicon Mac with Docker Desktop and no `--platform` flag anywhere,
      `curl -fsSL <install url> | bash` in an empty directory completes, and
      `docker compose ps` afterwards shows every service running.
- [ ] **AC-3**: On that same Mac, `docker compose exec worker uname -m` prints `aarch64` and
      `docker compose exec worker ffmpeg -hide_banner -encoders | grep libsvtav1` returns the
      encoder — the image is native, not emulated, and it carries the one encoder the worker calls
      (REQ-6).
- [ ] **AC-3b**: On that same Mac, one short film goes end to end — registered, a source attached,
      scanned, encoded and filed — and the resulting file's video stream reads AV1 under
      `ffprobe`. This is the only criterion that proves the arm64 image works rather than merely
      starts (REQ-6).
- [ ] **AC-4**: On an x86 host, pulling the same tag still yields an amd64 image:
      `docker compose exec api uname -m` prints `x86_64`, and the stack reaches a healthy `api`
      with no change to `.env` (NFR-2).
- [ ] **AC-5 (failure path)**: With the arm64 build of one image forced to fail (for example by
      pushing a tag from a branch with a deliberate compile error in that service), the release run
      finishes red and `docker manifest inspect ghcr.io/dientuki/perceptor-<svc>:<that tag>` fails
      with a not-found rather than returning a single-platform manifest (REQ-3).
- [ ] **AC-6 (failure path)**: Running `install.sh` in an empty directory on a host whose engine
      reports an architecture Perceptor does not publish — simulated by overriding the detected
      value — exits `1` with a message naming the detected architecture and the supported list,
      asks no question, pulls nothing, and leaves the directory empty: no `.env`, no
      `docker-compose.yaml` (REQ-5, `082` NFR-6).
- [ ] **AC-6b (regression against `082`)**: With the engine unreachable
      (`DOCKER_HOST=unix:///nonexistent.sock bash install.sh`), the installer still prints
      `082`'s engine message and not an architecture one — the architecture check never runs
      against an engine that answered nothing. `grep -n 'Architecture\|uname' bin/_docker.sh`
      returns nothing, and `bin/dev` on an arm64 development host still starts the stack (NFR-7).
- [ ] **AC-6c**: In a directory holding the `.env` and `docker-compose.yaml` of a failed pre-083
      arm64 install, re-running `curl -fsSL <install url> | bash` completes and starts the stack,
      and `git diff`-style comparison of the `.env` before and after shows no changed value —
      `PERCEPTOR_TAG`, the generated secrets and the admin user are all left as they were
      (REQ-7).
- [ ] **AC-7**: `README.md` states which architectures are published, and the header comment of
      `release.yml` no longer asserts `linux/amd64` only (REQ-8).
- [ ] **AC-8**: `git diff --stat services/` for this feature is empty (NFR-1).

## Out of Scope

- **`linux/arm/v7` (32-bit Raspberry Pi 3/4).** It would add a third build leg to every release for
  hosts that cannot realistically run an AV1 encode, and Node 24 on armv7 is not a platform this
  project wants to support. A 64-bit OS on a Pi 4 or 5 is covered by arm64.
- **Running the test suites on arm64.** `ci.yml` stays amd64-only (NFR-3). The code is
  architecture-neutral TypeScript; what arm64 changes is the native dependency tree, and a build
  that succeeds is the signal this feature cares about.
- **Encode performance on arm64, and any hardware-accelerated path.** The worker's single
  CPU-only code path on every host is a settled decision (`017`, `024`). Nothing here reopens it.
- **A `platform:` key in `docker-compose.yaml`.** Pinning a platform in compose is the workaround
  this feature exists to make unnecessary; adding one would silently re-emulate on arm64 hosts.
- **Mac- or Windows-specific packaging.** There is no native Mac app, no `.dmg`, no Windows
  installer. Both platforms run Perceptor through Docker, and this feature gives Docker the image
  it asks for — Windows on x86 already works today and needs nothing.
- **An architecture check in the `bin/` wrappers.** `082`'s `require_docker` stays at three
  checks (NFR-7). A developer builds images from source for whatever architecture they are on;
  what GHCR publishes is irrelevant there, and a guard copied into the shared helper would stop an
  arm64 developer from running their own stack.
- **Changing how `latest` is resolved during the closed alpha.** `release.yml`'s note about every
  tag moving `latest` stays exactly as it is.

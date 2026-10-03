---
title: Multi-architecture published images
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-02
last_updated: 2026-10-02
status: Draft
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
not a port. All five Dockerfiles start from bases that already publish arm64 (`node:24.18.0-alpine`,
`lscr.io/linuxserver/qbittorrent`, `lscr.io/linuxserver/prowlarr`); FFmpeg and mkvtoolnix come from
`apk` rather than a downloaded amd64 binary; `services/api/prisma/schema.prisma` pins no
`binaryTargets`, so the Prisma engine is generated for whatever platform the image is built on. The
one thing that genuinely changes is the cost of a release: an arm64 build emulated on an x86 runner
multiplies `npm ci`, `next build` and `nest build` by roughly an order of magnitude, which is why
each architecture is built on a runner of its own kind and the two results are joined into one
manifest list.

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
- [ ] **REQ-5 (Installer architecture check)**: `install.sh` must determine the host's
      architecture before it pulls anything and, when that architecture is not one Perceptor
      publishes, stop with a message naming the detected architecture and the supported ones —
      instead of letting Docker report `no matching manifest` nine times with no explanation of
      what the user should do.
- [ ] **REQ-6 (Documented support)**: The published architectures must be stated where a
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
- [ ] **NFR-6 (Transcode performance is per host)**: Perceptor makes no claim about encode speed on
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
      `docker compose exec worker ffmpeg -version` exits 0 — the image is native, not emulated,
      and the transcoder it ships actually runs.
- [ ] **AC-4**: On an x86 host, pulling the same tag still yields an amd64 image:
      `docker compose exec api uname -m` prints `x86_64`, and the stack reaches a healthy `api`
      with no change to `.env` (NFR-2).
- [ ] **AC-5 (failure path)**: With the arm64 build of one image forced to fail (for example by
      pushing a tag from a branch with a deliberate compile error in that service), the release run
      finishes red and `docker manifest inspect ghcr.io/dientuki/perceptor-<svc>:<that tag>` fails
      with a not-found rather than returning a single-platform manifest (REQ-3).
- [ ] **AC-6 (failure path)**: Running `install.sh` on a host whose architecture Perceptor does not
      publish — simulated by overriding the detected architecture — exits non-zero with a message
      naming the detected architecture and the supported list, and pulls nothing (REQ-5).
- [ ] **AC-7**: `README.md` states which architectures are published, and the header comment of
      `release.yml` no longer asserts `linux/amd64` only (REQ-6).
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
- **Changing how `latest` is resolved during the closed alpha.** `release.yml`'s note about every
  tag moving `latest` stays exactly as it is.

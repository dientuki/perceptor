---
title: Multi-architecture published images — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-10-02
status: Implemented
---

# PLAN: Multi-architecture published images (`plan.md`)

## Approach

The whole feature is two edits in two files plus prose, and the shape of the first one is what the
rest of this plan is about.

`.github/workflows/release.yml` today has one job that builds and pushes in a single step: a matrix
over the five services, each leg running `docker/build-push-action` with `platforms: linux/amd64`
and `tags:` already set to the version tag and `latest`. The obvious edit — writing
`platforms: linux/amd64,linux/arm64` on that same step — is rejected, and not only because it would
emulate arm64 on an x86 runner (REQ-4). It also keeps tagging inside the build: buildx would push
the manifest list from whichever leg ran, and a half-built list is reachable the moment the first
architecture lands. The plan instead splits the job in two, which is the standard buildx pattern for
exactly this and is what makes REQ-3 structural rather than a rule someone has to remember:

- **`build`** — a matrix over `service × platform` (ten legs), each on a runner of its own
  architecture (`ubuntu-latest` for amd64, `ubuntu-24.04-arm` for arm64; free for this repository
  because it is public). Each leg pushes **by digest only** — `push-by-digest=true`,
  `name-canonical=true`, no `tags:` at all — and uploads its digest as a workflow artifact. Nothing
  reachable by tag exists at this point.
- **`merge`** — a matrix over the five services, each leg downloading that service's two digests and
  calling `docker buildx imagetools create` to assemble one manifest list and apply both tags. This
  is the first and only moment a tag moves.

`merge` declares `needs: build`, and GitHub skips a job whose `needs` matrix had any failure. So a
single broken leg — one service, one architecture — means **no** service gets a tag, not just the
broken one. That is stronger than REQ-3, which only asked for per-image atomicity, and it is
deliberate: `PERCEPTOR_TAG` is one value for all five images (`049` REQ-2, NFR-5 here), so four
services publishing without the fifth is the mixed set `049` NFR-6 forbids. The alternative — one
`merge` leg per service depending only on that service's two build legs — was considered and
rejected for exactly that reason. The operational note at the foot of `release.yml` that says
nothing in this repository can prevent a half-published tag stops being true for the common case and
must be rewritten, not left as a stale warning.

The second edit is `install.sh`, and it reuses rather than extends. `082` already put a preflight
block at the top of the file (`install.sh:20-38`): the `docker` command, the Compose plugin, and a
reachable engine via `docker info`, all before the first question and before any file is written.
The architecture check is a fourth `if` in that same block. The engine call there currently throws
its output away (`docker info >/dev/null 2>&1`); it becomes a capture of
`docker info --format '{{.Architecture}}'`, whose emptiness *is* the engine check. One round trip
answers both questions (NFR-6), and the architecture branch structurally cannot run against an
engine that answered nothing (AC-6b). The message follows `082` REQ-3's shape — name the fix, not
the raw error — and `bin/_docker.sh` is not touched at all (NFR-7).

## Order of Work

One service, so this is a sequence rather than a dependency graph. It is still worth stating: the
workflow comes first because nothing else in the feature can be verified until an arm64 image
actually exists in GHCR.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `infra` | `release.yml` split into `build` + `merge`. Every acceptance criterion from AC-1 to AC-5 needs a published arm64 manifest to exist first. |
| 2 | `infra` | `install.sh` architecture check. Independent of step 1 as code, but AC-2/AC-3 can only be run once step 1 has shipped a tag. |
| 3 | `infra` | `README.md`, root `CLAUDE.md`, and the header comment of `release.yml`. Written last so they describe what shipped. |

Nothing runs in parallel. There is one agent and one territory.

## Contract Freeze

`spec.md` § GraphQL Contract Delta says **None**, and that is the freeze: this feature adds no
resolver, no field, no error key and nothing under `services/`. An implementer who finds themselves
editing a `.ts` file has left the feature.

Three things will look wrong from inside the work and are right for the feature as a whole:

- **`docker-compose.yaml` keeps its `image:` lines exactly as they are** (REQ-2). A `platform:` key
  would re-emulate on arm64 — it is the workaround this feature exists to delete, not a belt to add
  beside it.
- **`bin/_docker.sh` gains nothing** (NFR-7). The architecture check guards people *pulling*
  published images; a developer *builds* them natively, so the same guard in `require_docker` would
  lock an arm64 developer out of their own stack for no reason.
- **`ci.yml` stays amd64-only** (NFR-3). Adding arm64 test legs doubles every push on `dev` to
  prove something about TypeScript that does not depend on the architecture.

## Migrations

None. No Prisma model, field, enum or migration is involved, and
`git status --short services/api/prisma` must be empty when this feature closes.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Digest artifacts collide across matrix legs | The ten `build` legs upload artifacts; if the name does not carry **both** the service and the platform, `merge` assembles a manifest from another service's digest. `perceptor-web:latest` then pulls, starts, and is actually `api` — no error anywhere, a container that boots the wrong program. This is the one genuinely silent failure in the feature. | Artifact name includes service and sanitized platform. AC-1 (`docker manifest inspect` per service) and AC-2 (every container healthy on a real Mac) are what catch it; neither is optional. |
| arm64 worker builds but cannot encode | `apk add ffmpeg` succeeds, the image pulls natively, the stack comes up healthy, and then every job dies at FFmpeg — per title, inside the pipeline, long after the install looked fine. | Verified ahead of time against the Alpine v3.24 index (`ffmpeg-libavcodec 8.1.2-r0` depends on `libSvtAv1Enc` for `aarch64`, same as `x86_64`), and verified again on the built image by AC-3 and end to end by AC-3b. |
| Architecture compared against the manifest spelling | `docker info` answers `x86_64`/`aarch64`; a check written against `amd64`/`arm64` rejects every host, including the supported ones. Loud, but it fires on the exact path nobody runs after the first install. | Spelled out in REQ-5. AC-6's failure path and the ordinary happy-path install (AC-2, AC-4) together cover both sides of the comparison. |
| `merge` publishes while a `build` leg is still red | A tag exists for one architecture; the other 404s — today's bug, now intermittent and therefore worse. | Structural: `merge` has `needs: build`, no tag is applied anywhere in `build`, and AC-5 forces a leg to fail on purpose and asserts the tag does not resolve. |
| Prisma engine built for the wrong platform | `@prisma/client` silently carries an amd64 engine into an arm64 image and `api` dies at its first query. | Already defended: `services/api/Dockerfile` runs `node -e "require('@prisma/client')"` as a build-time smoke test, and under this plan that line runs on the native arm64 runner, so a wrong engine fails the release rather than the user's install. |
| Untagged digests accumulate in GHCR | A failed release leaves the digests its successful legs pushed, visible as untagged versions. | Accepted, not mitigated. They are unreachable by tag and harmless; a retention policy is a separate concern. |

## Verification

`infra` has no typecheck and no test suite — the gate is running what was written
(`.claude/agents/infra.md`). What can be checked locally:

```bash
bash -n install.sh
docker compose config -q
```

Then the release itself, which is the only real proof of steps 1 and 3. Push a release-candidate
tag from `stage` and watch the run to completion:

```bash
docker manifest inspect ghcr.io/dientuki/perceptor-web:<rc tag>
docker manifest inspect ghcr.io/dientuki/perceptor-worker:<rc tag>
```

Both must list `linux/amd64` and `linux/arm64`, and the same must hold for `api`, `torrent` and
`indexer` (AC-1).

The manual pass needs two machines, and the Apple Silicon half cannot be faked from this host —
this development machine has no `binfmt`/QEMU registered, so `docker run --platform linux/arm64`
answers `exec format error` rather than emulating.

On the Mac, in an empty directory:

```bash
curl -fsSL https://raw.githubusercontent.com/dientuki/perceptor/master/install.sh | bash
docker compose ps
docker compose exec worker uname -m
docker compose exec worker ffmpeg -hide_banner -encoders | grep libsvtav1
```

`aarch64` and a `libsvtav1` line (AC-2, AC-3). Then register one short film, attach a source, and
let it run to the end; `ffprobe` the file it filed and confirm the video stream reads AV1 (AC-3b).
Separately, in the directory of the install that already failed before this feature — `.env` and
`docker-compose.yaml` present, no containers — re-run the same one-line command and confirm it
completes and that no value in `.env` changed (AC-6c).

On an x86 host, pulling the same tag must still give an amd64 image and a healthy stack
(AC-4). AC-5 is a deliberate red release: push a tag from a branch carrying a compile error in one
service and assert `docker manifest inspect` on that tag fails with a not-found. AC-6 is run against
a local copy of `install.sh` with the detected architecture substituted by hand — no override
variable ships, following `082` AC-7's precedent of testing a dry-run copy.

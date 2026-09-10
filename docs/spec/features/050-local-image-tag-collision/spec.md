---
title: Local Image Tag Collision Between Build Targets
spec_version: 0.2.0
author: Juan Farias
created_at: 2026-09-10
last_updated: 2026-09-10
status: Implemented
services: [infra]
---

# SPEC: Local Image Tag Collision Between Build Targets (`spec.md`)

## Context & Goal

`docker-compose.build.yaml` gives each of the three Node services exactly one local image name —
`perceptor-web:local`, `perceptor-api:local`, `perceptor-worker:local` — while the stage those
images are built from varies with `BUILD_TARGET`. `bin/dev` and `bin/install` set
`BUILD_TARGET=dev`; `bin/build` and `bin/prod` set `BUILD_TARGET=runner`. One tag therefore names
two materially different images, and Docker keeps only whichever was built last. The two are not
interchangeable, and not by a matter of degree: the `dev` stage ships an **empty** `/app` and a
`CMD` that installs dependencies and runs `npm run start:dev` against a bind-mounted working copy,
while the production stage bakes `dist/`, a pruned `node_modules/` and `prisma/` into the image
(`COPY --from=builder`) and its `CMD` is `node dist/src/main.js` against exactly those. Each stage
assumes the opposite thing about who owns `/app`.

`docker compose up` does not rebuild a service whose image tag already resolves locally — and it
cannot know which stage produced that tag, because the tag does not record it. So `bin/build api`
followed by `bin/dev` starts the **production** image, and `docker-compose.dev.yaml` then
bind-mounts `./services/api` over `/app`, shadowing the `dist/` and `node_modules/` that image was
built around. The production `CMD` runs against the host working copy's build artifacts instead —
artifacts `bin/dev` neither produces nor guarantees. This is what happened on 2026-09-10 while
verifying `049-published-images-install`: `bin/build api` had been run to inspect the production
image, and the next `bin/dev -d` left `api` in a crash loop with
`Cannot find module '@/i18n/i18n-error'`, an unresolved TypeScript path alias several layers
removed from the real cause. Because `web` and `worker` gate on `api` being healthy, neither
started either. The specific missing module is a symptom, not the defect — and it is no longer
reproducible from that working copy, since the dev watcher has regenerated `dist/` since. The
defect is that a wrapper served an image built for a different target and nothing anywhere said so.

Commit `989d8c4` added `--build` to `bin/dev` as a stopgap. It does prevent the crash, but it makes
every dev start pay a build pass, and it makes `bin/dev` *destroy* whatever `bin/build` had just
produced — the same collision, now resolved in the other direction and no longer silent only
because the rebuild is unconditional. Once this ships, each target owns its own tag, and the word
naming that target is the same one in the Dockerfile, the wrapper and the tag: **`dev` and `prod`**.
The production stage is renamed `runner` → `prod`, which is both what closes the
`BUILD_TARGET=runner`-behind-`bin/prod` mismatch and what disambiguates a word this repository
already overloads — `services/worker/src/ffmpeg/runner.ts` is cited twice in the constitution
(Articles XI–XII) and has nothing to do with Docker stages. `bin/build` stops hardcoding one target
and takes it as an argument, which is what gives a developer a supported way to rebuild either
image after a `Dockerfile` or dependency change once `bin/dev`'s forced `--build` is gone. The
result: `bin/dev` starts without rebuilding, `bin/build`'s artifact survives a later `bin/dev`, and
no wrapper can serve an image built for a target it did not ask for.

No pipeline stage in the root `CLAUDE.md` changes status. No service **source** changes — nothing
under `services/*/src/`, `services/*/prisma/` or `services/*/package.json` is touched, and the
bytes of every built image are identical before and after, since renaming a stage changes its label
and not its instructions.

Territory: `docker-compose.build.yaml`, `bin/dev`, `bin/build`, `bin/prod`, `bin/install`,
`services/{web,api,worker}/Dockerfile` and `.github/workflows/release.yml` — plus the comments and
documentation that name the old stage: `docker-compose.dev.yaml`'s header, `docker-compose.yaml`'s
`api` healthcheck comment, the `# 4. RUNNER:` banner in all three Dockerfiles, `README.md`'s wrapper
table, root `CLAUDE.md` (the `bin/` wrapper table and § *Environment*'s `BUILD_TARGET` entry),
`services/api/CLAUDE.md` and `services/worker/CLAUDE.md`.
`services/{torrent,indexer}/Dockerfile` are read and left alone. `docker-compose.yaml` is edited
**for a comment only** — no key it defines changes, which is what keeps NFR-2 and AC-8 true.

**Territory note for `/tasks`.** Parts of that list sit outside the `infra` agent's declared
writable set in `.claude/agents/infra.md` (`bin/`, `docker-compose.yaml`, `.env.example`,
`services/*/Dockerfile`, the third-party init scripts): `docker-compose.build.yaml` and
`docker-compose.dev.yaml` — almost certainly an omission in the brief, since both are repo-root
compose wiring no service owns; `.github/workflows/release.yml`, which genuinely is not infra's and
belongs to whoever owns the release path (`049-published-images-install`); and
`services/{api,worker}/CLAUDE.md`, which belong to those service agents. Resolve this when writing
`tasks.md` rather than letting an agent discover it mid-task — see `plan.md` § *Order of Work* for
the split this plan assumes.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Tag per target)**: A locally built image of a service whose Dockerfile has more than
      one runnable stage must carry a name that identifies the stage it was built from, so that
      building for one target neither overwrites nor shadows the image built for another.
- [x] **REQ-2 (No cross-target serving)**: A wrapper that asks for a target must never start a
      container from an image built for a different target — including when that other image is
      present, newer, and would satisfy the old shared name.
- [x] **REQ-3 (Dev starts without rebuilding)**: Once a service's dev image exists, `bin/dev` must
      start it without a build pass. The `--build` added in `989d8c4` is removed, not kept as a
      belt-and-braces measure — an unconditional rebuild is what REQ-1 makes unnecessary.
- [x] **REQ-4 (`bin/build`'s artifact survives)**: After `bin/build` produces an image for one
      target, a subsequent `bin/dev` must leave that image present and unmodified, so the image
      being inspected is still the image that was inspected.
- [x] **REQ-5 (Single-stage services keep one name)**: `torrent` and `indexer` build from
      single-stage Dockerfiles with no `target:` in the overlay, so their content does not vary with
      `BUILD_TARGET`. They must keep a single unqualified local name — giving them a per-target name
      would assert a difference that does not exist and would build the same bytes twice.
- [x] **REQ-6 (One word per target, everywhere)**: The two targets must be named `dev` and `prod`,
      and that same word must appear in the Dockerfile stage, the `BUILD_TARGET` value a wrapper
      sets, and the local tag it produces. The production stage of `web`, `api` and `worker` is
      renamed `runner` → `prod`; `base` and `builder` keep their names, being stages no tag ever
      points at. After this, no reader has to map one vocabulary onto another to answer "which image
      is this".
- [x] **REQ-7 (`bin/build` takes its target)**: `bin/build` must accept the target as an argument
      (`dev` or `prod`) alongside the optional service, rather than hardcoding one. This is the
      supported way to rebuild either image after a `Dockerfile`, `package.json` or dependency
      change, which REQ-3 otherwise leaves without one. An unrecognised target must fail with a
      usage message and build nothing — never fall back to a default, which would rebuild the image
      the caller did not name.
- [x] **REQ-8 (`bin/install` leaves a warm dev stack)**: A fresh `git clone` followed by
      `bin/install` must leave the dev images built under their dev names, such that the next
      `bin/dev` starts them with no build pass (REQ-3) and no pull. Installing and then starting is
      the first thing a new contributor does; it must not pay for the same build twice.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Local names stay unpublishable)**: Every local image name must remain one that exists
      in no registry, so a missing local build fails as a missing image rather than silently
      resolving to something pulled from elsewhere. A bare `perceptor-api:dev` satisfies this
      literally but reads like a published development image; the name must keep saying it is local.
- [x] **NFR-2 (Runtime path untouched)**: `docker-compose.yaml` on its own must keep resolving the
      five `ghcr.io/dientuki/perceptor-<svc>:${PERCEPTOR_TAG:-latest}` images. An end-user
      installation never downloads `docker-compose.build.yaml`, and nothing in this feature may
      change what `install.sh` produces or what `docker compose pull` fetches.
- [x] **NFR-3 (No silent fallback)**: If the image a wrapper asks for is absent, the outcome must be
      a build of that target, never a start from a different local image and never a registry pull
      of a `perceptor-*` name.
- [x] **NFR-4 (The published images are bit-identical in substance)**: The stage rename must not
      change what `release.yml` publishes — same Dockerfile instructions, same resulting image
      content, same two GHCR tags per service. The workflow hardcodes `target: runner` in its
      matrix; leaving that unedited would break the release build outright, and editing it to
      anything but the new stage name would publish the wrong stage. An installation that pulls
      `${PERCEPTOR_TAG}` before and after this feature must get the same thing.
- [x] **NFR-5 (No service source, no schema, no contract)**: Nothing under `services/*/src/`,
      `services/*/prisma/` or any `package.json` changes. The diff is compose overlays, `bin/`
      wrappers, three `FROM … AS` lines, one CI matrix and the docs that name the old stage.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.**

It changes no service code, no resolver, no type and no error. The whole diff is how two compose
overlays name locally built images, what four `bin/` wrappers ask Docker for, and what three
Dockerfile stages are called. `web` and `worker` are unaffected at the source level; they are
affected only in that the images they run in development stop being ambiguous.

## Data Model Changes

**None.** No Prisma model, field, enum or migration is involved.

## Acceptance Criteria

These read image-level facts, so several use `docker image ls` / `docker image inspect` rather than
`docker compose`. Both are Docker CLI reads, not a host toolchain — consistent with Article I's
intent, though its **Check** line names only `git` and `docker compose` explicitly.

`docker compose` invocations below must carry the same `-f` set the wrapper under test uses
(`-f docker-compose.yaml -f docker-compose.build.yaml [-f docker-compose.dev.yaml]`), or they
resolve against the base file alone and report the GHCR name instead of the local one. AC-8 is the
deliberate exception: resolving against the bare base file *is* what it asserts.

- [x] **AC-1 (the original bug, gone)**: Given `bin/build prod api` has just run, when `bin/dev -d`
      runs, then `docker compose ps` shows `api` healthy and `web` and `worker` started, and
      `docker compose logs api` contains no `Cannot find module` line.
- [x] **AC-2 (dev runs the dev image)**: After AC-1, `docker compose images api` names the dev
      image, and `docker image inspect --format '{{.Config.Cmd}}'` on it does **not** print
      `[node dist/src/main.js]`.
- [x] **AC-3 (`bin/build`'s artifact survives)**: `bin/build prod api`, note the image ID from
      `docker image ls`; then `bin/dev -d`; the prod image is still listed with that same ID.
- [x] **AC-4 (no rebuild on a warm start)**: With the dev images already built, `bin/dev -d` output
      contains no `Building` or `Built` line for `web`, `api` or `worker`.
- [x] **AC-5 (`bin/build` builds the target it was told)**: `bin/build dev api` produces an image
      whose `{{.Config.Cmd}}` is the dev stage's, `bin/build prod api` one whose `Cmd` is
      `[node dist/src/main.js]`, and after running both, `docker image ls` lists both under their two
      distinct names.
- [x] **AC-6 (install then start, one build)**: From a fresh clone (or after
      `docker image rm` of the three dev images), `bin/install` followed by `bin/dev -d` brings the
      stack up, and the `bin/dev` output contains no `Building`, `Built` or `Pulling` line for
      `web`, `api` or `worker`.
- [x] **AC-7 (single-stage services unchanged)**: After `bin/dev -d`, `docker compose images` shows
      `torrent` and `indexer` still on their single unqualified local name, with one image each.
- [x] **AC-8 (runtime untouched)**: `docker compose -f docker-compose.yaml config` still resolves
      all five own services to `ghcr.io/dientuki/perceptor-<svc>:…` and contains no local image
      name and no `build:` key.
- [x] **AC-9 (the release build still resolves its stage)**: `grep -c 'target: prod'
      .github/workflows/release.yml` returns 3, `grep -c 'runner' .github/workflows/release.yml`
      returns 0, and `docker build --target prod services/api` (the stage the workflow names,
      built the way the workflow builds it — no compose) exits 0 for each of `web`, `api`, `worker`.
- [x] **AC-10 (no stale vocabulary)**: over the **live** files only — excluding
      `docs/spec/features/0*/` and `.claude/` — `grep -rn 'BUILD_TARGET=runner\|AS runner\|target:
      runner'` returns nothing, and every surviving occurrence of the word `runner` refers to
      `services/worker/src/ffmpeg/runner.ts` or to a test runner, never to a Docker stage. Known
      occurrences to resolve: `docker-compose.yaml:124` ("en el runner publicado"),
      `docker-compose.dev.yaml:4`, the `# 4. RUNNER:` banner in all three Dockerfiles, `README.md:201`,
      root `CLAUDE.md:84,85,107,109,151,152`, `services/api/CLAUDE.md:27,82` and
      `services/worker/CLAUDE.md:320,341` → all must change. Must **not** change:
      `docker-compose.yaml:228`, `docs/constitution.md:199,208`, `services/worker/Dockerfile:6`,
      `services/worker/CLAUDE.md:26,42,76,192,310,333`, `services/web/CLAUDE.md:84,595`,
      `.claude/agents/{worker,web}.md` — every one of those is `runner.ts` or a test runner.
- [x] **AC-11 (history is not rewritten)**: `docs/spec/features/` directories `001`–`049` are
      byte-identical before and after (`git status --short docs/spec/features` lists nothing under
      them). Specs `014` and `015` record `BUILD_TARGET=runner` as what was true when they shipped;
      a spec is a record of a decision, not a description of the present, and editing one to match
      today destroys the only account of why the old shape existed.
- [x] **AC-12 (failure path — a poisoned prod image cannot reach dev)**: Given the prod tag of `api`
      is deliberately replaced by an image that cannot run the service
      (`docker tag alpine <the api prod name>`), when `bin/dev -d` runs, then `api` still comes up
      healthy — the dev path never resolves that name at all.
- [x] **AC-13 (failure path — a missing dev image builds, never pulls)**: Given the `api` dev image
      has been removed (`docker image rm`), when `bin/dev -d` runs, then it builds that image and
      its output contains no `Pulling` line for `api`, and `api` comes up healthy. **Verified in
      substance, not literally**: Docker Compose's default `pull_policy: missing` always attempts a
      registry resolve before falling back to build, so the real output does show a `Pulling` line
      followed by `pull access denied`, then `Building`. No pull ever succeeds and nothing is ever
      served from a registry — the requirement this AC exists to protect (NFR-3: never a silent
      fallback to a pulled `perceptor-*` image) holds. The "no `Pulling` line" clause describes
      Compose behaviour this feature does not control and was not accurate for this Compose version
      at the time this AC was written. Confirmed with the user during `/implement` rather than
      silently closing over it.
- [x] **AC-14 (failure path — an unknown target builds nothing)**: `bin/build staging api` exits
      non-zero with a usage message, and `docker image ls` shows no image created or retagged by that
      call (REQ-7's no-fallback clause).

## Out of Scope

- **Detecting Dockerfile or `package.json` changes in `bin/dev`.** Removing the forced `--build`
  restores the pre-`989d8c4` behaviour that a dependency or Dockerfile change needs an explicit
  rebuild before `bin/dev` picks it up. REQ-7 makes that rebuild a first-class command
  (`bin/build dev <svc>`) rather than a flag a developer has to remember, but it is still manual.
  Automatic change detection is its own story with its own failure modes, and folding it in here
  would mean `bin/dev` never gets its fast start back — the entire point of REQ-3.
- **`bin/prod`'s `--build`.** It stays. `bin/prod` rebuilds deliberately so that it runs exactly what
  it just built rather than something older sitting under the same name; per-target tags make that
  guarantee cheaper, not unnecessary. What changes is that its rebuild can no longer destroy the dev
  image as collateral.
- **Renaming the `builder` stage, or `services/worker/src/ffmpeg/runner.ts`.** `builder` is an
  intermediate stage no tag ever names, so it carries none of the ambiguity REQ-6 is removing.
  `runner.ts` is worker source code, out of this feature's territory (NFR-5) and cited by name in the
  constitution; REQ-6 resolves the overload by vacating the Docker half of the word, not by touching
  the FFmpeg half.
- **The dead `version` step in `release.yml`.** Its "Extract version from tag" step computes
  `version=${GITHUB_REF_NAME#v}` and nothing in the workflow reads
  `steps.version.outputs.version` — the published tags use `${{ github.ref_name }}`, so they carry
  the `v`. Harmless today (the tag published and the `PERCEPTOR_TAG` that `install.sh` resolves
  agree), but either the step is dead code or the intent was to publish without the `v`. That is a
  `049-published-images-install` question; this feature touches the matrix's `target:` lines and
  nothing else in that file.
- **The published GHCR tags and `PERCEPTOR_TAG`.** Untouched (NFR-2, NFR-4). Apart from the three
  `target:` lines the rename forces, this feature is invisible to anyone who installed with
  `install.sh`.
- **Pruning superseded local images.** Two tags per Node service instead of one means more disk used
  by local builds. Reclaiming it is `docker image prune` on the developer's own schedule, not
  something a `bin/` wrapper should decide to delete.
- **The provenance of the stale `dist/` that produced the observed error message.** Which command
  left an unresolved `@/` alias in `services/api/dist/` is not known and is not worth reconstructing:
  under REQ-1 no wrapper runs `node dist/src/main.js` against a bind-mounted working copy at all, so
  the class of failure disappears regardless of which artifact was sitting there.

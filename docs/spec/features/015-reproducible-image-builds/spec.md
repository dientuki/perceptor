---
title: Reproducible Image Builds
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-18
last_updated: 2026-08-19
status: Implemented
services: [infra, api, web, worker]
---

# SPEC: Reproducible Image Builds (`spec.md`)

## Context & Goal

Perceptor builds five images of its own (`web`, `api`, `worker`, `torrent`, `indexer`) and consumes
four third-party ones (`db`, `redis`, `traefik`, `flaresolverr`). The stack works on the developer's
machine, but it works *because of* it: the three Node services come up in their `dev` stage, which
copies no code — the code arrives through a bind mount (`./services/<svc>:/app`) and the
dependencies are installed on first boot (`if [ ! -d node_modules ]; then npm install; fi`). The
image built today for those three is, literally, `node:24.18.0-alpine` + `apk add` + a `CMD`.

The `runner` stages, which do copy code, are never exercised from scratch: `bin/prod` starts them
with the same bind mounts on top, covering whatever the image brought, and with no `.dockerignore`
in any context their `COPY . .` drags in the host's `node_modules`, `dist` and `.next` (1.1 GB in
`services/web/.next` alone), plus `services/api/.env`. In the `worker` the dependency is total: its
`runner` stage runs `npm start` → `node dist/index.js` but **never runs `npm run build`**, and `tsc`
is a devDependency — the `dist/` it serves is the host's.

This feature leaves `bin/prod` building the five own images from a clean checkout, with no prior
artifacts and no secrets inside, and bringing up the same working stack as today — without touching
the development flow (`bin/dev`: bind mount + hot reload). It is the step before CI/CD: it publishes
no images, configures neither GHCR nor GitHub Actions, and does not version images. No pipeline
stage in `CLAUDE.md` changes status; what changes is that the pipeline becomes buildable on a
machine that is not the author's.

## Current state

What follows are findings verified against the repository, not assumptions.

### 1. Organisation and build contexts

| Service | Context | Dockerfile | `target` in compose | Base image |
| :-- | :-- | :-- | :-- | :-- |
| `web` | `./services/web` | `services/web/Dockerfile` (default) | `${BUILD_TARGET:-dev}` | `node:24.18.0-alpine` |
| `api` | `./services/api` | `services/api/Dockerfile` (default) | `${BUILD_TARGET:-dev}` | `node:24.18.0-alpine` |
| `worker` | `./services/worker` | `services/worker/Dockerfile` (default) | `${BUILD_TARGET:-dev}` | `node:24.18.0-alpine` + `ffmpeg mkvtoolnix vulkan-loader mesa-vulkan-intel libc6-compat` |
| `torrent` | `./services/torrent` | default | — (no `target`) | `lscr.io/linuxserver/qbittorrent:5.2.3` |
| `indexer` | `./services/indexer` | default | — (no `target`) | `lscr.io/linuxserver/prowlarr:2.5.2` + `apk add jq` |

Every `build:` uses a per-service context, with no `args:` and no declared `image:` — the
`perceptor-*` names visible in `docker ps` are `container_name`, not image tags. The commented-out
`#dockerfile: docker/web.Dockerfile` lines in the three Node services point at a `docker/` directory
that does not exist in the repo.

Stages per Dockerfile:

- `api`: `base` → `dev` / `builder` → `runner`, plus ~15 lines of an old Dockerfile commented out at
  the top.
- `web`: `base` → `dev` / `builder` → `runner`. Same commented block.
- `worker`: `base` → `dev` / `runner`. **There is no `builder`.**
- `torrent` / `indexer`: single-stage on top of the LinuxServer image; only `RUN sed`/`apk add` and
  a `COPY --chmod=755` of the init scripts. **They are already reproducible and are not touched.**

### 2. Dependencies between builds

No image depends on another's build: there is no shared base image across services and no stage
copying from another context. The dependencies are startup ones (`depends_on` + healthchecks), not
build ones. All five can be built in parallel.

### 3. Implicit host dependencies

- **No `.dockerignore` exists anywhere** (`find . -name .dockerignore` returns nothing). Every
  context travels to the daemon in full: `services/web` with `node_modules` (467 MB) and `.next`
  (1.1 GB); `services/api` with `node_modules` (687 MB), `dist` (2.2 MB) and **`services/api/.env`**,
  which holds a `DATABASE_URL` with a user and a password; `services/worker` with `node_modules`
  (76 MB) and `dist`.
- `api` (`builder`): `npm ci` + `npx prisma generate` and **then** `COPY . .`, which overwrites the
  freshly installed `node_modules` — and with it the generated Prisma client — with the host's.
- `web` (`builder`): same pattern; it additionally copies the host's `.next/` inside before running
  `npm run build`.
- `worker` (`runner`): `npm ci --omit=dev` and then `COPY . .`, which brings in the host's full
  `node_modules` **and its `dist/`**. `CMD ["npm", "start"]` is `node dist/index.js` and `tsc` is a
  devDependency: without that `dist/` the image does not start. It is the most direct
  prior-artifact dependency in the repo.
- `web`/`api` (`dev`): they copy nothing; the `CMD` runs `npm install` on first boot against the bind
  mount — hence the 60s/90s `start_period` in their healthchecks.
- `web` (`runner`): copies `/app/public`, `/app/.next/standalone` and `/app/.next/static`;
  `next.config.ts` does declare `output: 'standalone'`, so the stage is coherent. But
  `bin/npm web run build` **fails today** with 11 TypeScript errors across 4 pre-GraphQL files, with
  no `ignoreBuildErrors` → the `web` image build fails, with or without host artifacts. Resolved in
  spec `016-web-build-errors`.

### 4. Bind mounts vs. image

`web`, `api` and `worker` mount `./services/<svc>:/app` **unconditionally**, regardless of `target`.
With `BUILD_TARGET=runner` (`bin/prod`) that mount covers whatever the stage copied: for `web`,
`/app/server.js` is hidden behind the host's source tree; for `api` and `worker`, what runs is the
host's `dist/`. **Production mode today does not run the image it built.**

### 5. Variables and secrets

- No variable is used as a build `ARG` today; there is no `build.args` in compose. Everything
  arrives through `environment:` at runtime.
- **One real exception**: `NEXT_PUBLIC_UPLOAD_URL`
  (`services/web/src/components/import/importFileModal.tsx:95`, its only reader). Next inlines
  `NEXT_PUBLIC_*` **at build time**; today it is only passed as a runtime env var. In `dev` that
  works; in a `runner` image it would be `undefined` and the upload modal would point nowhere.
- `next.config.ts` reads `DOMAIN` for `allowedDevOrigins` — that only affects `next dev`, not the
  bundle.
- `services/api/.env` is the only secret that ends up inside an image today. The repo-root `.env` is
  in no build context, but there is also a `.env copy` at the root that must never get in either.
- `torrent`/`indexer` receive no secrets at build time: `QBITTORRENT_PASSWORD`, `INDEXER_PASSWORD`
  and `INDEXER_API_KEY` are read by their init scripts at runtime (`custom-cont-init.d/`,
  `custom-services.d/`). That design is already correct.

### 6. Permissions and users

`api` and `worker` run with `user: "${PUID}:${PGID}"` + `group_add: ${MEDIA_GID}` in compose, but
their `runner` stages declare `USER nestjs` / `USER workerjs` (uid/gid 1001) and `--chown` to that
user. Compose wins at runtime, so the image tree ends up owned by a uid the process is not. With a
bind mount it goes unnoticed; without one — which is the goal — it has to be verified.
`torrent`/`indexer` already settle the execute bit with `COPY --chmod=755`, without depending on
host permissions.

## Decisions taken

| # | Decision |
| :-- | :-- |
| **D1 — targets and mounts** | `target: ${BUILD_TARGET:-dev}` stays. The code bind mounts and the development-only variables move out of `docker-compose.yaml` into a **`docker-compose.dev.yaml`** overlay, the same mechanism as the existing `docker-compose.gpu.yaml`. `bin/dev` adds the overlay with `-f`; `bin/prod` does not. That way `bin/prod` runs the images it built and `bin/dev` does not change behaviour. |
| **D2 — `web`'s TypeScript errors** | Out of this spec: fixed in `016-web-build-errors`, a prerequisite of REQ-9. |
| **D3 — `NEXT_PUBLIC_UPLOAD_URL`** | Out of the bundle. The URL is resolved on the server and reaches the modal at runtime; the `web` image stays agnostic of the deployment. |
| **D4 — `.dockerignore`** | One per service, in `services/web/`, `services/api/` and `services/worker/`. The context is not moved to the repo root. Precedent in the repo: `services/web/.gitignore` exists for an analogous reason (Biome). |

## Requirements

### Functional Requirements

- [x] **REQ-1 (Defined build)**: All five own services must have a `build:` resolving to a versioned
      Dockerfile, with an explicit context, and no commented-out `dockerfile:` lines pointing at
      paths that do not exist.
- [x] **REQ-2 (Clean build)**: `bin/prod` must build the five images from a checkout with no
      `node_modules`, no `dist`, no `.next` and no per-service `.env`, with no manual intervention.
- [x] **REQ-3 (No host artifacts)**: No image may contain or depend on files generated on the host.
      In particular, the `worker`'s runtime stage must compile its own `dist/` inside the build (a
      new `builder` stage), not receive it through `COPY`.
- [x] **REQ-4 (Bounded context)**: Each Node service must carry its own `.dockerignore` excluding
      `node_modules`, build outputs (`dist`, `.next`, `*.tsbuildinfo`), `coverage` and every `.env*`
      except `.env.example` (D4).
- [x] **REQ-5 (No secrets)**: No built image may contain a `.env` file or embedded credentials.
- [x] **REQ-6 (Development overlay)**: The `./services/<svc>:/app` bind mounts and the variables that
      only apply to development (`WATCHPACK_POLLING`) must live in `docker-compose.dev.yaml`, which
      only `bin/dev` includes (D1). `docker-compose.yaml` describes the runtime.
- [x] **REQ-7 (`bin/build`)**: There must be a wrapper that builds without bringing the stack up,
      with the same pre-configuration as `bin/prod` (reads `.env`, sets `BUILD_TARGET=runner`,
      honours the flags in `.env`), accepting an optional service to build a single image —
      `bin/build` / `bin/build web`. It is what covers NFR-1 without asking the user for a
      hand-written `docker compose`.
- [ ] **REQ-8 (Working stack)**: After building, `bin/prod` must give the same functional behaviour
      as today: login, TMDB search, release registration, download, processing and library. The
      stack is up under `bin/build`'s images and 8/9 services reach `healthy` (T015); the manual
      functional walk itself is the user's to run and confirm.
- [x] **REQ-9 (Green `web` build)**: The `web` image build must complete. Depends on
      `016-web-build-errors`, which must be implemented first (D2).
- [x] **REQ-10 (Upload URL at runtime)**: `web` must not require any `NEXT_PUBLIC_*` variable at
      build time. The upload endpoint URL is resolved on the server (the server action in
      `services/web/src/actions/uploads.ts`, which already exists) and consumed by
      `importFileModal.tsx`, its only reader today. Inside the container the variable is renamed to
      `PUBLIC_UPLOAD_URL` — the name `.env.example` already uses on the host (D3).
- [x] **REQ-11 (Third parties untouched)**: `db`, `redis`, `traefik` and `flaresolverr` keep using
      their original images, with no `build:`.
- [x] **REQ-12 (Development untouched)**: `bin/dev` must keep giving a `./services/<svc>` bind mount,
      hot reload (`next dev`, `nest start --watch`, `tsx watch`) and `node_modules` written into the
      host working copy, exactly as today.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Per-image verification)**: Each image must be buildable on its own via
      `bin/build <service>`, documented in `CLAUDE.md`.
- [x] **NFR-2 (No architectural change)**: No change of technology, topology, GraphQL contract, or
      the design of the `torrent`/`indexer` init scripts. Only what is needed to make the builds
      reproducible.
- [x] **NFR-3 (Coherent permissions)**: Without a bind mount, `api` and `worker` running as
      `${PUID}:${PGID}` must be able to read their own code and write into
      `${CONTAINER_DOWNLOADS_DIR}` / `${CONTAINER_DESTINATIONS_DIR}`.
- [x] **NFR-4 (Documentation)**: The root `CLAUDE.md` must reflect the new overlay, `bin/build` (in
      the `bin/` table) and what each target builds. This spec and its plans are the durable record
      of the build contract — the same shape `014-dev-stack-flaresolverr` used for the development
      stack. **`docs/spec/docker/` is not recreated**: its single file,
      `traefik.md` (added by `27e2614`, superseded by `014-dev-stack-flaresolverr` and already
      deleted in the working tree), is stale, and what that directory was meant to hold now lives in
      the feature specs. The stale references to it in `CLAUDE.md` go with this feature's docs
      task.
- [x] **NFR-5 (Hygiene)**: The commented-out Dockerfile blocks and the
      `#dockerfile: docker/*.Dockerfile` lines in compose are removed — they describe an
      organisation that does not exist.

## GraphQL Contract Delta

**None — this feature does not cross the boundary between services.** REQ-10 moves an environment
variable read from the browser bundle to `web`'s server; it touches neither `api`'s schema nor any
consumer.

## Data Model Changes

**None.**

## Acceptance Criteria

- [x] **AC-1**: On a clean clone (`git clone` + `bin/install`), with no `node_modules`, `dist` or
      `.next` in any service, `bin/build` exits 0 and `docker images` lists the five own images.
- [x] **AC-2**: `bin/build web` exits 0 (fails today: TypeScript errors, spec 016).
- [x] **AC-3**: With `services/worker/dist` deleted from the host, `bin/build worker` still produces
      an image that starts — the `dist/index.js` was compiled by the build.
- [x] **AC-4 (failure path)**: Introducing a TypeScript error in `services/api/src` makes
      `bin/build api` **fail**, instead of producing an image that starts and blows up at runtime.
- [x] **AC-5**: `bin/bash api` against the production container finds no `.env` under `/app`; same
      for `web` and `worker`.
- [x] **AC-6**: The context sent to the daemon for each Node service drops from hundreds of MB to a
      few MB (visible as `transferring context` during `bin/build`).
- [ ] **AC-7**: `bin/prod` brings up the nine services, all reach `healthy`, and login + TMDB search
      + adding a magnet + processing finish the same as today. 8/9 services reached `healthy` under
      `bin/prod` (T015) — `traefik` stayed `unhealthy` for a reason unrelated to this feature (its
      `/ping` healthcheck endpoint isn't enabled in this stack's Traefik config, pre-existing). The
      functional pipeline walk (login, search, magnet, download, processing, library) has not been
      run — pending the user's manual pass.
- [ ] **AC-8**: With the stack up from `bin/prod`, the file upload modal resolves its endpoint
      correctly (REQ-10) — the image was not built with that URL inside. Code path verified by
      inspection (T003) and the running stack is ready for it (T015); the actual upload click-through
      has not been run — pending the user's manual pass.
- [x] **AC-9**: `bin/dev` still gives hot reload: editing `services/web/src/app/page.tsx` is
      reflected without rebuilding the image, and `services/*/node_modules` still exists on the host.
- [x] **AC-10**: No third-party service (`db`, `redis`, `traefik`, `flaresolverr`) has a `build:`;
      `bin/build` does not try to build them.

## Out of Scope

- **Publishing images / GHCR / GitHub Actions.** That is the next step; this feature only guarantees
  there is something publishable.
- **Image versioning and tags** (`image:` in compose, semver, `latest`). Requires deciding on a
  registry first.
- **Optimising image size** beyond what reproducibility demands. The `worker` gains a `builder`
  stage because it compiles nothing today, not for elegance; no `distroless`/`slim` is pursued.
- **Changing third-party services** or the `torrent`/`indexer` init scripts, already reproducible.
- **`web`'s 11 TypeScript errors** — spec `016-web-build-errors`.
- **The `worker`'s GPU strategy** (`vulkan-loader`/`mesa-vulkan-intel`, `USE_GPU`,
  `docker-compose.gpu.yaml`) — spec `017-worker-gpu-strategy`.
- **The known debt** of the hardcoded DSN in `prisma.service.ts` and the `datasource db` with no
  `url`: it does not affect the build.
- **Unifying `movieId`/`mediaId`** (debt recorded separately).
- **Prisma migrations/seed on `runner` startup.** The stage runs `node dist/main.js` with no
  `prisma migrate deploy`; who applies migrations in production is a deployment question, not a
  build one.

---
title: Reproducible Image Builds — Tasks
last_updated: 2026-08-19
status: Done
---

# TASKS: Reproducible Image Builds (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[infra]` | Repo-root and third-party-container territory — `bin/`, `docker-compose.yaml`, `.env.example`, `services/*/Dockerfile`, and the container config under `services/torrent/` and `services/indexer/`. The difference from `[docs]` is executable config versus prose, so these carry a real *Done when*. (`docs/spec/docker/` no longer exists and is not recreated — `../015-…/infra/plan.md` step 10.) |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

This feature has **no GraphQL delta**, so the usual "contract first" ordering does not apply. What
comes first instead is each service's own build blocker: `infra` cannot write a `builder` stage
around an `npm run build` that still emits test files, and cannot rename an environment variable
`web` does not read yet.

## Tasks

### Group 1 — service-side build blockers

Three different agents, three different services, no shared file and no contract between them.
Genuinely parallel.

- [x] **T001** `[worker] [P]` Add `services/worker/tsconfig.build.json` extending `./tsconfig.json`
      with `"exclude": ["node_modules", "dist", "**/*.spec.ts"]` (mirroring
      `services/api/tsconfig.build.json`), and point `package.json`'s `build` script at it:
      `tsc -p tsconfig.build.json`. Leave `tsconfig.json` covering the spec files.
      *Done when:* `rm -rf services/worker/dist && bin/npm worker run build` exits 0,
      `services/worker/dist/index.js` exists, `find services/worker/dist -name "*.spec.js"` prints
      **nothing**, and `bin/npm worker test` still reports 75 tests across 9 suites.
- [x] **T002** `[api] [P]` In `services/api/src/app.module.ts`, make `autoSchemaFile` conditional:
      `true` (in-memory) when `process.env.NODE_ENV === 'production'`, the current
      `join(process.cwd(), 'src/schema.gql')` otherwise, with an English comment naming the reason
      (the `runner` image has no `/app/src`).
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, `bin/npm api test` reports
      156 tests across 16 suites, and `git status services/api/src/schema.gql` shows the file
      **unmodified**.
- [x] **T003** `[web] [P]` In `services/web/src/actions/uploads.ts`, add `endpoint: string` to
      `UploadTicket`, read `process.env.PUBLIC_UPLOAD_URL` inside `createUploadTicketAction`, throw a
      Spanish `Error` naming the variable when it is unset or empty, and return it alongside the
      ticket. In `services/web/src/components/import/importFileModal.tsx:95`, replace
      `endpoint: process.env.NEXT_PUBLIC_UPLOAD_URL` with `endpoint: ticket.endpoint`. Do not touch
      `CREATE_UPLOAD_TICKET_MUTATION`.
      *Done when:* `grep -rn "NEXT_PUBLIC" services/web/src` prints **nothing**,
      `bin/cli web npx --no tsc --noEmit` reports 0 errors, `bin/npm web run build` exits 0, and
      `bin/npm web run lint` is clean.

### Group 2 — build contexts and images

- [x] **T004** `[infra]` Create `services/web/.dockerignore`, `services/api/.dockerignore` and
      `services/worker/.dockerignore` as deny lists (never allow lists): `node_modules/`, `.git/`,
      `.gitignore`, `Dockerfile`, `.dockerignore`, `coverage/`, `*.tsbuildinfo`, `npm-debug.log*`,
      `.env*` with `!.env.example`; plus `.next/` and `next-env.d.ts` for `web`, `dist/` for `api`
      and `worker`.
      *Done when:* `BUILD_TARGET=runner docker compose build api` prints a `transferring context`
      line in the **single-digit MB** (it is hundreds of MB today), and
      `docker run --rm perceptor-api ls -a /app` lists no `.env`.
- [x] **T005** `[infra]` Rewrite `services/worker/Dockerfile`: insert a `builder` stage between
      `dev` and `runner` (`COPY package*.json ./`, `npm ci`, `COPY . .`, `RUN npm run build`); make
      `runner` copy `package*.json`, run `npm ci --omit=dev`, then
      `COPY --from=builder /app/dist ./dist` and **nothing else from the context**; replace
      `CMD ["npm", "start"]` with `CMD ["node", "dist/index.js"]`. → T001, T004
      *Done when:* with `services/worker/dist` deleted from the host,
      `BUILD_TARGET=runner docker compose build worker` exits 0 and
      `docker run --rm perceptor-worker ls dist/index.js` finds the file — it was compiled by the
      build, not inherited (AC-3).
- [x] **T006** `[infra] [P]` In `services/api/Dockerfile`, delete the ~15 commented lines at the top
      (NFR-5) and add `RUN node -e "require('@prisma/client')"` immediately after
      `RUN npm prune --omit=dev`. Leave the stage order alone. → T004
      *Done when:* `BUILD_TARGET=runner docker compose build api` exits 0 and its log shows the
      smoke line running after the prune without error.
- [x] **T007** `[infra] [P]` In `services/web/Dockerfile`, delete the 13 commented lines at the top
      (NFR-5). No stage changes. → T004
      *Done when:* `BUILD_TARGET=runner docker compose build web` exits 0 and the file's first line
      is `FROM node:24.18.0-alpine AS base`.

### Group 3 — compose split and wrappers

This group is strictly sequential: the overlay cannot be written before the base file is stripped,
and the wrappers cannot select an overlay that does not exist.

- [x] **T008** `[infra]` In `docker-compose.yaml`, for `web`/`api`/`worker`: remove the
      `./services/<svc>:/app` volume (**keep** every `${HOST_*_DIR}:${CONTAINER_*_DIR}` mount),
      remove `NODE_ENV=${NODE_ENV}` and `WATCHPACK_POLLING`, remove the three
      `#dockerfile: docker/*.Dockerfile` lines, and rename `web`'s
      `NEXT_PUBLIC_UPLOAD_URL=${PUBLIC_UPLOAD_URL}` to `PUBLIC_UPLOAD_URL=${PUBLIC_UPLOAD_URL}`,
      updating the comment above it (a server action reads it now, not the browser). → T003
      *Done when:* `docker compose -f docker-compose.yaml config` exits 0 and
      `docker compose -f docker-compose.yaml config | grep -c "services/\(web\|api\|worker\):/app"`
      returns `0`, while the four media mounts are still present.
- [x] **T009** `[infra]` Create `docker-compose.dev.yaml` with a header comment in the style of
      `docker-compose.gpu.yaml`: for `web`/`api`/`worker` the `./services/<svc>:/app` mount and
      `NODE_ENV=${NODE_ENV}`, plus `WATCHPACK_POLLING=true` on `web` only. → T008
      *Done when:*
      `docker compose -f docker-compose.yaml -f docker-compose.dev.yaml config` exits 0 and shows,
      for each of the three services, both the code mount **and** the media mounts (compose appends
      overlay volumes rather than replacing them).
- [x] **T010** `[infra]` In `bin/dev`, initialise `COMPOSE_FILES` with
      `-f docker-compose.yaml -f docker-compose.dev.yaml` before the `USE_GPU` append. In `bin/prod`,
      change only the header comment so it stops implying bind mounts — **no `-f` for the dev
      overlay there**. → T009
      *Done when:* `bash -n bin/dev bin/prod` is silent, `grep -c "docker-compose.dev.yaml" bin/dev`
      returns `1` and the same grep on `bin/prod` returns `0`.
- [x] **T011** `[infra]` Create `bin/build` from `bin/prod`: same shebang, `set -e`, `cd`, `.env`
      guard and message, `set -a; . ./.env; set +a`, and `USE_GPU` overlay handling. Accept an
      optional first argument validated against `web api worker torrent indexer`, exiting with a
      usage message on anything else (including `db`, `redis`, `traefik`, `flaresolverr`). With no
      argument, build all five. End in
      `BUILD_TARGET=runner docker compose $COMPOSE_FILES build $TARGETS`. `chmod +x`. → T010
      *Done when:* `bin/build redis` exits non-zero with a usage message, `bin/build web` exits 0
      having built exactly one image, and `bin/build` with no argument builds five (AC-10).
- [x] **T012** `[infra]` In `.env.example`, comment-only edits: note beside `NODE_ENV` that it now
      reaches the containers through `docker-compose.dev.yaml` only, and beside `BUILD_TARGET` that
      `bin/build` sets it the way `bin/prod` does. Add no variable. → T011
      *Done when:* `diff <(grep -v "^#" .env.example) <(git show HEAD:.env.example | grep -v "^#")`
      prints nothing — only comments changed.

### Group 4 — verification against a clean tree

- [x] **T013** `[infra]` Delete the host's generated artifacts (`services/worker/dist`,
      `services/api/dist`, `services/web/.next` — all gitignored build output, nothing authored) and
      run a full build. → T005, T006, T007, T011
      *Done when:* `bin/build` exits 0, `docker compose images` lists the five own images, each Node
      service's `transferring context` is single-digit MB (AC-6), and `bin/build web` on its own
      exits 0 (AC-2).
- [x] **T014** `[api]` Prove the failure path: introduce a deliberate type error in
      `services/api/src` (e.g. assign a `string` to a `number` field), run `bin/build api`, then
      revert the change and rebuild. → T013
      *Done when:* `bin/build api` exits **non-zero** with the TypeScript error in its output, and
      after reverting, `bin/build api` exits 0 and `git status services/api/src` is clean (AC-4).
- [x] **T015** `[infra]` Bring the stack up with `bin/prod` and inspect the running production
      containers. → T013
      *Done when:* `docker compose ps` shows nine services and all reach `healthy`; and in each of
      `bin/bash api`, `bin/bash web`, `bin/bash worker`, `ls -a /app` shows **no `.env`** and no
      `.git` (AC-5). Paste the real output of all four commands. The functional pass over the
      pipeline (AC-7) and the upload modal (AC-8) is the user's — report the stack is ready for it
      rather than claiming it passed.
- [x] **T016** `[infra]` Regression-check development: `bin/dev`, then edit
      `services/web/src/app/page.tsx` (add and remove a comment) and watch the container log. → T010
      *Done when:* the edit hot-reloads with no rebuild, `bin/cli api npx --no tsc --noEmit` still
      runs inside the dev container, and `ls -d services/{web,api,worker}/node_modules` finds all
      three on the host (AC-9, REQ-12).

### Group 5 — docs

- [x] **T017** `[docs]` Root `CLAUDE.md`: add `bin/build` to the `bin/` wrapper table, describe the
      `docker-compose.dev.yaml` overlay in § *Docker-first workflow* (and that `bin/prod` now runs
      the image it built), and delete the two stale references to `docs/spec/docker/traefik.md`
      (lines 25 and 60) — superseded by `014-dev-stack-flaresolverr` and already deleted from the
      working tree. → T015, T016
- [x] **T018** `[docs]` Service `CLAUDE.md` files: `services/api/CLAUDE.md` lines 14–19 quote
      `autoSchemaFile: join(process.cwd(), 'src/schema.gql')` verbatim and must record the
      production branch; `services/worker/CLAUDE.md` § *Dev loop* gains the `tsconfig.build.json`
      split; `services/web/CLAUDE.md` § *The server-action pattern* gains the upload endpoint now
      arriving from the server rather than from a `NEXT_PUBLIC_*` inline. → T015, T016
- [ ] **T019** `[docs]` Walk the ten acceptance criteria in `spec.md`, tick each box against real
      evidence from T013–T016 (AC-7 and AC-8 only once the user confirms the functional pass), set
      `status: Implemented` on `spec.md`, `plan.md` and all four `<svc>/plan.md`, and refresh
      `last_updated`. → T017, T018

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

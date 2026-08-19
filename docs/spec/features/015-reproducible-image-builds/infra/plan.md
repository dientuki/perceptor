---
title: Reproducible Image Builds — infra slice
service: infra
last_updated: 2026-08-19
status: Implemented
---

# PLAN: Reproducible Image Builds — `infra` (`infra/plan.md`)

## Scope

The whole build and wiring surface: the three Node `Dockerfile`s, a `.dockerignore` beside each of
them, `docker-compose.yaml`, a new `docker-compose.dev.yaml`, `bin/dev`, `bin/prod`, a new
`bin/build` and `.env.example`.

**Not this slice, and a diff on any of them means the plan was ignored:**

- `services/*/src/**`, `services/*/package.json`, `services/*/tsconfig*.json`. The `builder` stage
  you write for `worker` calls `npm run build`, and `worker`'s own slice (`../worker/plan.md`) makes
  that script emit a `dist/` without spec files. If `npm run build` is missing or wrong when you get
  there, **stop and report** — do not add a script.
- `services/torrent/` and `services/indexer/`, including their Dockerfiles and init scripts. They
  are already reproducible (REQ-11, NFR-2). No `.dockerignore` there either: their contexts are a
  handful of shell scripts.
- Root `CLAUDE.md` — that is the orchestrator's `[docs]` task.
- `docs/spec/docker/` — do **not** create it. See step 10.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/.dockerignore` | New | Excludes `node_modules`, `.next`, `.env*` (keeping `.env.example`), `coverage`, `*.tsbuildinfo`, `.git`. |
| `services/api/.dockerignore` | New | Same shape, `dist` instead of `.next`. **`services/api/.env` exists and holds a real `DATABASE_URL` — this file is the only thing keeping it out of the image (REQ-5).** |
| `services/worker/.dockerignore` | New | Same shape, `dist` + `coverage`. |
| `services/web/Dockerfile` | Modified | Delete the 13 commented lines at the top (NFR-5). Stages themselves stay as they are. |
| `services/api/Dockerfile` | Modified | Delete the commented block; add a Prisma-client smoke line right after `npm prune --omit=dev`. |
| `services/worker/Dockerfile` | Modified | New `builder` stage; `runner` stops copying source and takes `dist/` from `builder`; `CMD` becomes `node dist/index.js`. |
| `docker-compose.yaml` | Modified | Remove the three `./services/<svc>:/app` mounts, `NODE_ENV`, `WATCHPACK_POLLING` and the three `#dockerfile:` lines; rename `NEXT_PUBLIC_UPLOAD_URL` → `PUBLIC_UPLOAD_URL`. |
| `docker-compose.dev.yaml` | New | The overlay: the three code mounts, `NODE_ENV`, `WATCHPACK_POLLING`. |
| `bin/dev` | Modified | Always append `-f docker-compose.dev.yaml`. |
| `bin/prod` | Modified | Nothing but the comment, which must stop implying bind mounts. |
| `bin/build` | New | Build without starting anything; optional service argument. |
| `.env.example` | Modified | Comments only: `NODE_ENV` is dev-overlay-only, `BUILD_TARGET` mentions `bin/build`. |

## Existing code to reuse

- **`docker-compose.gpu.yaml` + the `COMPOSE_FILES` block in `bin/dev`/`bin/prod`** — the overlay
  mechanism already exists and is already read from `.env`. `docker-compose.dev.yaml` is a second
  overlay in that same style; the `-f` accumulation code is copied, not redesigned.
- **`bin/prod`** — `bin/build` is that file with the last line changed. Same shebang, same
  `set -e`, same `cd "$(dirname "$0")/.."`, same `.env` guard and message, same
  `set -a; . ./.env; set +a`, same `USE_GPU` handling. Do not introduce a different way to read
  `.env`.
- **`services/api/Dockerfile`'s `builder` → `runner` split** — the shape `worker` is missing.
  `worker`'s new stages should read as the same file with different package names, not as a second
  idiom.
- **`services/web/.gitignore`** — the precedent for a per-service ignore file (D4), and a ready-made
  list of what a web build considers generated. The `.dockerignore` files mirror it.
- **`services/indexer/Dockerfile`'s `COPY --chmod=755`** — the existing answer to "do not depend on
  host file modes". Nothing new needed here, just do not undo it.

## Steps

1. **Three `.dockerignore` files.** Deny lists of generated artifacts, never allow lists — an allow
   list silently drops `next.config.ts`, `nest-cli.json` or `public/` and the failure only shows in
   the running container. Each contains at minimum: `node_modules/`, `.git/`, `.gitignore`,
   `Dockerfile`, `.dockerignore`, `coverage/`, `*.tsbuildinfo`, `npm-debug.log*`, `.env*` with
   `!.env.example`; plus `.next/` and `next-env.d.ts` for `web`, and `dist/` for `api` and `worker`.
   Verify with `docker compose build` output: `transferring context` must be single-digit MB.
2. **`services/worker/Dockerfile`.** Insert a `builder` stage between `dev` and `runner`:
   `FROM base AS builder`, `COPY package*.json ./`, `npm ci`, `COPY . .`, `RUN npm run build`.
   Rewrite `runner` to copy `package*.json`, run `npm ci --omit=dev`, then
   `COPY --from=builder /app/dist ./dist` — and **nothing else from the context**. Replace
   `CMD ["npm", "start"]` with `CMD ["node", "dist/index.js"]` (§ Risks in `../plan.md`: compose
   overrides the image user and npm needs a writable `HOME`).
3. **`services/api/Dockerfile`.** Delete the commented block. After `RUN npm prune --omit=dev`, add
   `RUN node -e "require('@prisma/client')"` so a prune that eats the generated client fails the
   build instead of the login screen. Leave the stage order alone — `prisma generate` before
   `COPY . .` is already correct once the context stops carrying `node_modules`.
4. **`services/web/Dockerfile`.** Delete the commented block. Nothing else: `output: 'standalone'`
   is already declared in `next.config.ts` and the `runner` stage already matches it.
5. **`docker-compose.yaml`.** For `web`, `api` and `worker`: drop the `./services/<svc>:/app` volume
   (**keep** every `${HOST_*_DIR}:${CONTAINER_*_DIR}` mount — those are media, not code), drop
   `NODE_ENV=${NODE_ENV}` and `WATCHPACK_POLLING`, drop the `#dockerfile: docker/*.Dockerfile`
   lines. On `web`, rename the variable to `PUBLIC_UPLOAD_URL=${PUBLIC_UPLOAD_URL}` and update the
   Spanish comment above it: it is read by a server action now, not by the browser bundle
   (`../web/plan.md`). Everything else — `user:`, `group_add:`, healthchecks, labels, `depends_on` —
   stays byte-for-byte.
6. **`docker-compose.dev.yaml`.** Header comment in the style of `docker-compose.gpu.yaml`, saying
   what it adds and who includes it. Under `web`/`api`/`worker`: the code mount and
   `NODE_ENV=${NODE_ENV}`; `WATCHPACK_POLLING=true` on `web` only. Compose appends overlay
   `volumes:` to the base list, so the media mounts survive — confirm with
   `docker compose -f docker-compose.yaml -f docker-compose.dev.yaml config`.
7. **`bin/dev`.** `COMPOSE_FILES="-f docker-compose.yaml -f docker-compose.dev.yaml"`,
   unconditionally, before the `USE_GPU` append. **`bin/prod` gets no such line** — that omission is
   the entire feature.
8. **`bin/build`.** Copy `bin/prod`, keep everything up to and including the `USE_GPU` block, then:
   accept an optional first argument, validate it against the five own services
   (`web api worker torrent indexer`) and exit with a usage message on anything else — including on
   `db`, `redis`, `traefik` or `flaresolverr`, which have no `build:` (AC-10). With no argument,
   build all five. Last line: `BUILD_TARGET=runner docker compose $COMPOSE_FILES build $TARGETS`.
   `chmod +x`.
9. **`.env.example`.** Comment-only edits: note beside `NODE_ENV` that it now reaches the containers
   through `docker-compose.dev.yaml` only, and beside `BUILD_TARGET` that `bin/build` sets it like
   `bin/prod` does. Do not add a variable; this feature adds none.
10. **No `docs/spec/docker/`.** Its only file, `traefik.md`, is stale — the stack contract now
    lives in `014-dev-stack-flaresolverr` — and it is already deleted in the working tree, which is
    the state this feature keeps. Do not recreate the directory to satisfy NFR-4, and do not restore
    the file even though `CLAUDE.md` and `.claude/agents/infra.md` still point at it. The build contract's
    durable record is `../spec.md` plus these plans — the shape `014-dev-stack-flaresolverr` used
    for the development stack — and the operational half lands in the root `CLAUDE.md`, which is the
    orchestrator's `[docs]` task, not yours. Write the reasoning for anything non-obvious you decide
    (an exclusion pattern, the smoke line after the prune) as a comment in the file itself.

## Contract obligations

None — `../spec.md` § *GraphQL Contract Delta* is **None**. This slice does not touch a resolver, a
query or a type.

The two names this slice does owe another service:

- **`PUBLIC_UPLOAD_URL`** must be the exact variable name reaching the `web` container.
  `services/web/src/actions/uploads.ts` reads `process.env.PUBLIC_UPLOAD_URL` (`../web/plan.md`).
  A typo here is an upload modal that throws on every file, in production only.
- **`npm run build` in `services/worker`** must exist and emit `dist/index.js`. It is `../worker/plan.md`'s
  to define. Do not work around a missing one by calling `npx tsc` from the Dockerfile.

## Tests

**None owed, and the reason is that this slice has no unit to test** — there is no function here,
only declarative build and compose configuration. Article IX's question ("can this fail silently?")
is answered by the acceptance criteria rather than by a spec file, and deliberately so:

- AC-4 (a type error must fail `bin/build api`) is this slice's real test of the `builder` stages.
- AC-5 (no `.env` inside a running production container) is the test of the `.dockerignore` files.
- AC-9 (hot reload still works) is the test of the overlay.

If any of the three cannot be demonstrated by hand at the end, the slice is not done.

## Done when

```bash
docker compose -f docker-compose.yaml config >/dev/null
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml config >/dev/null
bin/build
bin/build worker
```

Both `config` calls exit 0 and show no `./services/*:/app` mount in the first; `bin/build` exits 0
having built five images, with a per-service context in the single-digit MB. Then `bin/prod` brings
nine services to `healthy` and `bin/dev` still hot-reloads.

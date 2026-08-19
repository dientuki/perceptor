---
title: Reproducible Image Builds — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-19
status: Implemented
---

# PLAN: Reproducible Image Builds (`plan.md`)

## Approach

The spec's finding is that the `runner` stages are dead code: `bin/prod` builds them and then hides
them behind the same bind mounts `bin/dev` uses. Everything else — the missing `.dockerignore`, the
`worker` that never compiles, `services/api/.env` travelling into a build context — is downstream of
that one fact, because a stage nobody runs is a stage nobody notices is broken.

So the shape of the change is: **make the `runner` stages actually run, then fix what breaks.**

- **The overlay (D1).** `docker-compose.yaml` stops describing development. The three
  `./services/<svc>:/app` mounts and the dev-only environment move to a new
  `docker-compose.dev.yaml`, which only `bin/dev` adds with `-f`. This is not a new mechanism:
  `docker-compose.gpu.yaml` already exists and `bin/dev`/`bin/prod` already build a `COMPOSE_FILES`
  string out of a flag in `.env` (`USE_GPU`). The overlay is appended to that same string —
  unconditionally in `bin/dev`, never in `bin/prod`/`bin/build`.
- **`bin/build` (REQ-7).** A sibling of `bin/prod`, same preamble verbatim (`.env` check, `set -a; . ./.env`,
  `USE_GPU` overlay), ending in `docker compose … build` instead of `up -d --build`, with an
  optional service argument. It does not reimplement any of that logic differently — if the two
  files diverge in how they read `.env`, one of them is wrong.
- **Each service fixes its own build blocker.** Three of them exist and none belong to `infra`:
  `worker` has no `tsconfig.build.json`, so `tsc` compiles its nine `*.spec.ts` files into `dist/`
  (verified: `services/worker/dist/scan/parse-episode.spec.js` exists today); `api` writes
  `src/schema.gql` at boot into a directory the `runner` image does not contain; `web` reads
  `NEXT_PUBLIC_UPLOAD_URL`, which Next inlines at build time (REQ-10/D3). Each is a small, local
  change in the service that owns the file, reusing something that already exists in that service —
  `services/api/tsconfig.build.json` is the pattern `worker` copies, and
  `services/web/src/actions/uploads.ts` is the server action `web` extends rather than adding a
  second one.

Alternative considered and rejected for the overlay: a `docker-compose.prod.yaml` that *adds*
production settings on top of a dev-shaped base. It keeps `bin/dev` a one-file invocation, but it
means the default `docker compose up` (no wrappers) is the development stack — the same trap that
made `bin/prod` silently run the host's `dist/`. The base file describes the runtime; development is
the overlay.

## Order of Work

The usual `api`-first ordering does not apply: there is no GraphQL delta, so no service is waiting
on another's contract. What everything waits on is the build fix inside each service, because
`infra`'s Dockerfiles invoke scripts (`npm run build`) and env vars those slices define.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1a | `worker` | `tsconfig.build.json` + `build` script must exist before the new `builder` stage can call `npm run build` and get a `dist/` without specs in it. |
| 1b | `api` | `autoSchemaFile` must stop writing into `src/` before an `api:runner` container can reach a healthy state at all. |
| 1c | `web` | The upload endpoint must be resolved server-side before an image built without `NEXT_PUBLIC_UPLOAD_URL` is functional (REQ-10, AC-8). |
| 2 | `infra` | Dockerfiles, `.dockerignore`s, `docker-compose.yaml` + the new `docker-compose.dev.yaml`, `bin/build`, `.env.example`. Depends on 1a and 1c by name (`npm run build`, `PUBLIC_UPLOAD_URL`). |
| 3 | `[docs]` | Root `CLAUDE.md`: the `bin/` table gains `bin/build`, the workflow section gains the overlay, and the two stale references to `docs/spec/docker/traefik.md` (lines 25 and 60) go — that file is superseded by `014-dev-stack-flaresolverr` and already deleted in the working tree (NFR-4). |

**1a, 1b and 1c are genuinely parallel** — three different services, no shared file, no contract
between them. Step 2 is not: `infra` writing a `builder` stage that calls a script `worker` has not
yet changed produces an image full of compiled spec files, and nothing fails.

Step 3 is the orchestrator's, and it comes last because it documents what actually shipped.

## Contract Freeze

`spec.md` § *GraphQL Contract Delta* says **None**, and that is frozen as of `status: Approved`.
This feature must not add, remove or rename a single GraphQL field. `web`'s REQ-10 change looks
adjacent to the contract and is not: `createUploadTicketAction`
(`services/web/src/actions/uploads.ts`) keeps sending exactly today's `CreateUploadTicket` mutation
with exactly today's variables, and only enriches the object it returns **to its own component**
with a value read from `process.env` on the server. If an implementer finds themselves editing
`CREATE_UPLOAD_TICKET_MUTATION`, they have left the feature.

Also frozen, and tempting to "improve" from inside a slice:

- **`target: ${BUILD_TARGET:-dev}` stays** (D1). Neither the default nor the mechanism changes.
- **`torrent` and `indexer` are not touched** (REQ-11, NFR-2). They are already reproducible; a
  `.dockerignore` or a stage split there is out of scope.
- **The known debt stays.** The hardcoded DSN in `services/api/src/prisma/prisma.service.ts` and the
  `datasource db` with no `url` are listed in `spec.md` § *Out of Scope*. They make the production
  image no worse than the dev container, and fixing them here hides a build change inside a
  connectivity change.
- **No `image:` tags, no registry, no `prisma migrate deploy` on boot.** Out of scope, all three.

## Migrations

**None.** No Prisma schema change, no data model change, no new `.env` variable that carries state.

The one rename — `NEXT_PUBLIC_UPLOAD_URL` → `PUBLIC_UPLOAD_URL` **inside the container** — is not a
migration for the user: `.env.example` and every existing `.env` already spell the host-side
variable `PUBLIC_UPLOAD_URL` (`.env.example:56`). Only the compose `environment:` line changes name.
Nobody has to edit their `.env`.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **`api:runner` cannot write `src/schema.gql`** | `app.module.ts:31` passes `autoSchemaFile: join(process.cwd(), 'src/schema.gql')`, but the `runner` image copies only `dist`, `prisma`, `node_modules` and `package*.json` — there is no `/app/src`. Nest fails at boot, or (worse, if the directory ever exists) writes a generated artifact into a production image. | `api` slice: in-memory schema when `NODE_ENV=production`. Verified by AC-7 — the container reaches `healthy`, which only happens if `/graphql` answers. |
| **`npm prune --omit=dev` takes the generated Prisma client with it** | `services/api/Dockerfile:52` prunes *after* `prisma generate`. If the pruned tree loses `node_modules/.prisma`, the image builds green and every query throws at runtime — the first symptom is a login that 500s, not a build error. | `infra` slice: a `RUN node -e "require('@prisma/client')"` smoke line in `builder` immediately after the prune, so a missing client fails the build instead of the stack. |
| **`worker:runner` ships its own test suite** | `tsconfig.json` has `include: ["src"]` and no `exclude`; every `*.spec.ts` compiles. The image works, so nobody looks — but it carries test code that `require`s `vitest`, a devDependency the runner does not install. A stray import path away from a runtime crash. | `worker` slice: `tsconfig.build.json` mirroring `services/api/tsconfig.build.json`, and AC-3 checks the image starts from a host with no `dist/`. |
| **`npm start` as `${PUID}:${PGID}` in a root-owned `/app`** | `worker`'s `runner` CMD is `["npm", "start"]`; compose overrides the image's `USER` with `user: "${PUID}:${PGID}"`. npm wants a writable `HOME` for its cache/logs and the uid it runs as owns nothing. The failure is an EACCES at container start, or a container that starts and logs npm warnings forever. | `infra` slice: `CMD ["node", "dist/index.js"]`, dropping npm from the runtime entirely — the same shape `api`'s runner already uses (`node dist/main.js`). |
| **`NODE_ENV=development` leaks into a production container** | Compose passes `NODE_ENV=${NODE_ENV}` to all three Node services and `.env` ships `development`. It overrides the `ENV NODE_ENV=production` each `runner` stage sets. This is exactly the bug `016-web-build-errors` chased for a whole spec — React resolving a null dispatcher — and it produces no error naming `NODE_ENV`. | `infra` slice: `NODE_ENV` moves to `docker-compose.dev.yaml` with the mounts; the base file never sets it, so each image's own `ENV` wins. |
| **The upload endpoint silently becomes `undefined`** | `tus.Upload({ endpoint: undefined })` does not throw at construction. The user picks a file, the modal shows a progress bar, and nothing arrives. | `web` slice: the server action throws a Spanish error when `PUBLIC_UPLOAD_URL` is unset, before the modal ever constructs the upload. AC-8. |
| **The overlay is forgotten in one wrapper** | `bin/dev` without `-f docker-compose.dev.yaml` starts the `dev` stage against an `/app` with no source — a container that boots, installs nothing and serves nothing. Conversely `bin/prod` *with* the overlay silently reintroduces exactly the bug this feature removes. | AC-9 (hot reload still works) and AC-5 (no `.env` inside the prod containers) are on opposite sides of this; both are in § Verification. |
| **A `.dockerignore` excludes something the build needs** | `services/web` needs `public/` and `next.config.ts`; `services/api` needs `prisma/` and `nest-cli.json`. An over-broad pattern produces a smaller image that 404s on every static asset. | Exclusion list is enumerated per service in `infra/plan.md` — a deny list of generated artifacts, never an allow list. AC-1 and AC-7 together catch it. |

## Verification

Typechecks and suites first — nothing here should move a number:

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
```

Expected: `api` 0 errors / 156 tests in 16 suites, `worker` 0 errors / 75 tests in 9 suites, `web` 0
errors and a build that exits 0 (the baseline `016-web-build-errors` left).

Then the build itself, from a host stripped of every artifact the images used to inherit:

```bash
rm -rf services/worker/dist services/api/dist services/web/.next
bin/build
bin/build worker
docker images
```

Expected: exit 0 on both; `transferring context` in the low single-digit MB per Node service (AC-6);
five own images listed (AC-1); `bin/build` never mentions `db`, `redis`, `traefik` or `flaresolverr`
(AC-10).

The failure path, which is the whole point of AC-4 — introduce a type error in
`services/api/src`, then:

```bash
bin/build api
```

Expected: **non-zero exit**. An image that builds green here is the feature failing, not passing.
Revert the error afterwards.

Then the stack, and the manual pass:

```bash
bin/prod
bin/bash web
```

- All nine services reach `healthy` (AC-7).
- In `bin/bash api`, `bin/bash web` and `bin/bash worker`: `ls -a /app` shows **no `.env`**, no
  `.git`, and for `api`/`worker` a `dist/` whose timestamps are the build's, not the host's (AC-5).
- Log in, search a title on TMDB, add a magnet, watch it download, process and land in the library
  (AC-7).
- Open the file-upload modal on a film and start a real upload — it must reach the api, proving the
  endpoint was resolved at runtime and not baked in (AC-8).

Finally, development must be untouched:

```bash
bin/dev
```

- Edit `services/web/src/app/page.tsx` and see it hot-reload without a rebuild (AC-9).
- `services/web/node_modules`, `services/api/node_modules`, `services/worker/node_modules` still
  exist on the host (AC-9, REQ-12).

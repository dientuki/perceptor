# Perceptor

Self-hosted media automation. A user searches a title, Perceptor registers it, finds a release,
downloads it, transcodes it with FFmpeg and files the result in a library.

Every pipeline stage below is working today, for both films and series. The spec refs point at
`docs/spec/features/<NNN-slug>/` for the design detail; the service `CLAUDE.md` files have the
implementation detail.

| Stage | Where | Specs |
| :-- | :-- | :-- |
| Search catalog (TMDB) | `api` — `src/media/`, `src/movies/`, `src/shows/`, `src/clients/tmdb/` | `005`, `006` |
| Register title in DB | `api` — `media`/`movies`/`shows` + Prisma; a new series fetches its seasons/episodes in the background | `006` |
| Find release | Prowlarr (`indexer`) + `flaresolverr`, `api` — `src/clients/indexer/client.ts`; manual fallback is pasting a magnet (`src/clients/torrent/magnet.ts`) | `010`, `014` |
| Download | qBittorrent (`torrent`), `api` — `src/clients/torrent/client.ts`, per-torrent save path | `010` |
| Detect completion, enqueue | `api` — `src/downloads/` (`torrentCompleted` mutation, BullMQ producer) | — |
| Scan files, inventory | `worker` — enumerates every file, resolves episodes by parsing `SxxEyy`; episode names come from the api, never the filename | `013` |
| Transcode | `worker` (FFmpeg) — H264/VC-1 to AV1, HEVC 4K tonemapped to 1080p SDR, Opus audio; decided from `ffprobe`, not the filename. The 4K tonemap runs on GPU (`libplacebo`/Vulkan) when the host has one, or a software chain otherwise — detected at worker startup, not configured. A season pack fans out into one `ProcessJob` per episode | `011`, `013`, `017` |
| Notify media server | `api` — `src/media-server/`, `src/clients/media-server/` (Jellyfin, opt-in, default `none`) | — |
| Browse library | `api` — the three resolvers; `web` — `/movies`, `/shows` and their detail pages, all per-user | `007`, `008`, `009`, `010` |

Two gaps worth knowing: acquiring a **season pack** is api-only (`addMagnetToSeason`), with no web
UI; and every listing/detail route is scoped to the calling user — a title another user owns answers
`Recurso no disponible para este usuario` rather than rendering.

## Layout

```
bin/                     host wrapper scripts (see below)
docs/constitution.md     the non-negotiable rules — outranks every CLAUDE.md
docs/spec/graphql-contract.md   the web/worker <-> api boundary
docs/spec/features/      one directory per feature spec (see below)
.claude/agents/          one implementer subagent per service
.claude/commands/        the /specify -> /plan-feature -> /tasks -> /implement flow
docker-compose.yaml      the whole stack
.env                     single source of configuration (not committed)
services/api/            NestJS 11 + Apollo + Prisma 7  -> services/api/CLAUDE.md
services/web/            Next 16 + React 19 + Tailwind 4 -> services/web/CLAUDE.md
services/worker/         BullMQ + FFmpeg consumer        -> services/worker/CLAUDE.md
```

## Topology

```
                       :80 / :443
                           |
                       traefik (v3.7, docker provider, opt-in via labels)
                  /        |         \                    \
    Host(${DOMAIN})  Host(api.${DOMAIN})  Host(torrent.${DOMAIN})  Host(indexer.${DOMAIN})
        |                  |                     |                      |
   web  :3000  --GraphQL-->  api  :${API_PORT}   torrent (qBittorrent)  indexer (Prowlarr)
                              |        \                 ^                |
                        db (MariaDB) redis (queue)       | AutoRun hook   | proxy for Cloudflare-
                                       |                    on completion | fronted trackers
                       worker (no ingress, Redis queue                   v
                        only, calls back into api over    flaresolverr (no ingress, perceptor-net only)
                        GraphQL)
```

- Everything shares the `perceptor-net` bridge network.
- `web` waits for `api` healthy; `api` waits for `db` and `redis` healthy; `worker` waits for
  `redis` and `api` healthy.
- `web` and `worker` never touch the database directly — both go through `api`'s GraphQL endpoint
  (`INTERNAL_GRAPHQL_URL=http://api:${API_PORT}/graphql`).
- Only containers with `traefik.enable=true` are routed — the label contract is read off the routed
  services already in `docker-compose.yaml`; also inlined in `.claude/agents/infra.md`.

## Docker-first workflow

**Nothing runs on the host.** There are no `node_modules` for the host toolchain and no local
MariaDB/Redis. Do not run `npm`, `npx`, `nest`, `prisma`, or `next` directly — always go through the
wrappers in `bin/`, which shell into the running containers.

| Script | What it does | Example |
| :-- | :-- | :-- |
| `bin/install` | generates `.env` from `.env.example`, asking Traefik y/n + domain | run once, first checkout |
| `bin/dev` | `docker compose up -d` in dev mode, reads `USE_TRAEFIK` from `.env`, always adds the `docker-compose.dev.yaml` overlay | `bin/dev` |
| `bin/prod` | same, `BUILD_TARGET=runner`, rebuilds and runs the image it built — no dev overlay | `bin/prod` |
| `bin/build [service]` | builds the `runner` images without starting containers; no argument builds all five own services | `bin/build web` |
| `bin/cli <service> <cmd…>` | `docker compose exec -it <service> <cmd…>` | `bin/cli api npx prisma migrate status` |
| `bin/npm [service] <args…>` | npm inside a service; **defaults to `web`** when the first arg is not `web`/`api`/`worker` | `bin/npm api run test` |
| `bin/bash <service>` | interactive `sh` in a container | `bin/bash api` |
| `bin/mysql [args…]` | `mariadb` client against `db` using `.env` credentials | `bin/mysql -e 'show tables'` |
| `bin/dbinit` | grants global privileges to `${DB_USER}` so Prisma can create its shadow database | once after a fresh `db` volume |
| `bin/reset-password <username>` | resets a user's password interactively | the recovery path when no admin can sign in |

Without Traefik, each service is still reachable directly on its published port (`WEB_PORT`,
`API_PORT`, …) — Traefik only adds domain-based routing.

Source is bind-mounted (`./services/<svc>:/app`), so edits hot-reload. The dev stages install
`node_modules` on first boot if missing, which means `node_modules` lands in your host working copy —
intentional, and it is what your editor's TypeScript server reads.

The bind mount and dev-only variables live in `docker-compose.dev.yaml`, an overlay in the same style
as `docker-compose.gpu.yaml` — `bin/dev` always adds it with `-f`, `bin/prod`/`bin/build` never do.
`docker-compose.yaml` on its own describes the runtime, so `bin/prod` runs exactly the `runner` image
it built rather than hiding it behind the host's working copy. Each Node service carries its own
`.dockerignore` (`015-reproducible-image-builds`).

## Environment

All configuration lives in `.env` at the repo root (see `.env.example` for the full list of names);
compose interpolates it and passes a subset into each container. Values are secret — never copy them
into docs or code.

Rules that are not obvious from the variable names:

- **`JWT_SECRET`** signs every JWT; `api` refuses to boot without it (no default, ever —
  `src/auth/auth.constants.ts`). **`SERVICE_TOKEN`** is the machine credential for the worker and the
  qBittorrent AutoRun hook — a JWT with no expiry, minted from `JWT_SECRET`. `bin/install` generates
  both, and fills them into an existing `.env` without touching anything else. Rotating `JWT_SECRET`
  invalidates `SERVICE_TOKEN` — re-mint with `bin/npm api run token:service --silent`. Design:
  `docs/spec/features/002-auth-login/spec.md`.
- **Paths.** `HOST_*_DIR`/`CONTAINER_*_DIR` also go into `api`, whose `src/media-roots/` module reads
  them as the two roots the Settings UI is confined to. The `path_downloads`/`path_movies`/`path_shows`
  settings are **segments relative to those roots**, never absolute container paths. The UI only shows
  the host-side path; the container path never crosses the GraphQL boundary.
- **`ADMIN_USER`/`ADMIN_PASSWORD` are canonical** — `QBITTORRENT_*` and `INDEXER_*` credentials
  reference them via `.env` interpolation, and the api seed reads them directly, so app, qBittorrent
  and Prowlarr share one login. The seeded admin is also the first app administrator; there is no
  public registration, so an admin creates every other user from `/users`, and can disable rather than
  delete one (`isEnabled: false` revokes live sessions immediately, not just the next login).
- **The TMDB bearer token is not in `.env`** — it comes from the `movie_db_api_key` Settings key,
  editable from the Settings screen. A fresh install ships it empty, so TMDB calls fail with
  `401 Unauthorized` until an admin sets a real key.
- **`INDEXER_API_KEY` needs no human paste** — `bin/install` generates or adopts it, the `indexer`
  container writes it into `config.xml` before Prowlarr starts, and the api settings seed fills
  `tracker_api_key` from it. A second init script registers a FlareSolverr proxy against Prowlarr's
  API, but does **not** attach its tag to any indexer — choosing which indexers sit behind Cloudflare
  stays manual in Prowlarr's UI (`014-dev-stack-flaresolverr`).
- **`BUILD_TARGET`** picks the Dockerfile stage (`dev` by default, `runner` for production); every
  Dockerfile has `base` / `dev` / `builder` / `runner`.
- **`USE_GPU` is an opt-out, not an opt-in.** `bin/dev`/`bin/prod`/`bin/build` attach
  `docker-compose.gpu.yaml` (mapping `/dev/dri` into `worker`) whenever the host has a render node,
  and the worker probes at startup whether `libplacebo` can actually initialize Vulkan there,
  falling back to a software tonemap chain when it can't. Only the literal string `false` forces the
  CPU path on both sides; there is no value that forces GPU use. `017-worker-gpu-strategy`.
- **The media server is not in `docker-compose.yaml`** — Jellyfin is assumed to run outside the stack.
  That is why `MediaServerService.notifyCreated` translates the container output path to the host path
  via `MediaRootsService.containerToHostPath()` before sending it.

## Conventions

- **Commits**: `[scope] lowercase message` — scopes seen so far are `[api]`, `[web]`, `[traefix]`.
- **Language**: everything committed is English — comments, identifiers, docs, commit messages, test
  descriptions (`docs/constitution.md` → Article VI is the authority). The **exception is user-facing
  copy**, and since `018-ui-i18n` that copy is no longer hardcoded Spanish — it is catalog-driven.
  `api`/`worker` produce English text plus an `extensions.i18n` key; `web` resolves the active
  locale server-side (`User.uiLocale` → `Accept-Language` → `en`) and translates through
  `services/web/messages/{en,es}.json`. `es` keeps the existing Rioplatense register verbatim.
  See `docs/spec/graphql-contract.md` § "UI internationalization" for the full key vocabulary and
  the error envelope shape. Existing Spanish comments in code are legacy, not a pattern to copy.
- **Path alias**: `@/*` → `./src/*` in both `api` and `web`.
- **API contract**: GraphQL only. `web` never touches the database; it calls the API through
  `fetchGraphQL` in `services/web/src/lib/graphql-client.ts`.
  **One deliberate exception**: `POST/PATCH/HEAD /uploads` on `api` (`services/api/src/uploads/`) is
  the project's only REST route — a resumable multi-GB browser upload ([tus](https://tus.io)) fits
  neither a GraphQL mutation nor a Next Server Action (1MB body limit). `onUploadFinish` closes the
  loop in the same request (creates the `MediaSource`, updates the `Movie`, enqueues `bull:process`),
  so no file is ever uploaded but unregistered.

## Spec Driven Development

`docs/constitution.md` holds the eleven rules that outrank every other document here. When it and a
`CLAUDE.md` disagree, the constitution wins and the `CLAUDE.md` is the bug.

A change starts as a feature spec when it touches more than one service, the Prisma schema, the
GraphQL contract, or a pipeline stage (Article VII). Everything smaller — a bug fix, a rename, a doc
correction — does not. The flow:

| Step | Produces |
| :-- | :-- |
| `/specify <description>` | `docs/spec/features/NNN-slug/spec.md` — requirements, GraphQL contract delta, acceptance criteria. Open questions left as `[NEEDS CLARIFICATION]` |
| `/plan-feature NNN` | `plan.md` (cross-service: order, migrations, risk) and one `<svc>/plan.md` per service touched. Refuses to run while any clarification is open |
| `/tasks NNN` | `tasks.md` — atomic tasks tagged `[api]`/`[web]`/`[worker]` for a service agent, or `[docs]`/`[orch]` for the orchestrator, with dependencies |
| `/implement NNN` | Dispatches each task to that service's subagent (`.claude/agents/`) and verifies the reports |

`/constitution` reviews or amends the rules themselves.

Two things make this work rather than just add ceremony:

- **The GraphQL contract is frozen before anyone implements** (Article VIII). There is no codegen
  between `api` and its consumers — `web` and `worker` retype the schema by hand — so an unannounced
  contract change fails at runtime, not at compile time. See `docs/spec/graphql-contract.md`.
- **Each subagent writes only inside its own service.** A task that needs two services is two tasks.
  An agent that hits another service's code stops and reports instead of helpfully fixing it. There
  is no `db` agent: the database belongs to `api` (Article III).

**Dispatching note.** The Claude Code CLI resolves `subagent_type: "worker"` from `.claude/agents/`
directly; the desktop app does not. There, dispatch `general-purpose` and tell it to read
`.claude/agents/<service>.md` first and follow it — `/implement` does this automatically. The
fallback loses the frontmatter's `tools:` restriction, so the scope boundary rests entirely on the
brief, which is why `/implement` verifies the diff after every batch.

`docs/spec/features/_templates/` holds the four templates; `docs/spec/features/001-magnet-import/` is
a worked example, written after the fact against a feature that shipped.

## Current state

All three services typecheck clean (0 errors) and `bin/npm web run build` exits 0, measured
2026-08-20 after `023-ffprobe-log`. Test counts then: `api` 190/21 suites, `worker` 116/13.
**Re-run the checks rather than trusting these numbers** — they exist so an agent can prove a change
added nothing, not as a fact to cite.

## Known debt

- The database DSN is hardcoded in `services/api/src/prisma/prisma.service.ts` even though
  `DATABASE_URL` already exists in `.env`; `schema.prisma` declares `datasource db` with no `url` —
  the connection comes solely from the driver adapter.
- **`movieId` means two different things depending on where it appears.** `006-media-search` renamed
  `MediaSearchResult.movieId` → `mediaId` where it came to mean "film or series", but three
  occurrences still mean "a film, specifically": the argument on `addTorrentToMovie`/`addMagnetToMovie`/
  `createUploadTicket`, the **tus upload metadata key** (`web`'s `components/import/importFileModal.tsx`,
  `api`'s `uploads/uploads.service.ts`), and `MediaSource.movieId`, read by
  `worker/src/jobs/source-ready.job.ts`. `010-episode-acquisition` added `episodeId` *beside* it rather
  than generalising: the rename crosses all three services with no codegen between them, so a partial
  rename breaks the pipeline at runtime with no compile error anywhere. `docs/spec/graphql-contract.md`
  has to move first. **Planned for the week of 2026-08-17.**

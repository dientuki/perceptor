# Perceptor

Self-hosted media automation. A user searches a title, Perceptor registers it, finds a release,
downloads it, transcodes it with FFmpeg and files the result in a library.

Pipeline stage status today:

| Stage | Where | Status |
| :-- | :-- | :-- |
| Search catalog (TMDB) | `api` — `src/clients/TMDBClient.ts`, `src/movies/movies.search.ts` | in progress, does not compile |
| Register title in DB | `api` — `movies` module + Prisma | working (read + CRUD service) |
| Find release (indexer) | Prowlarr — `indexer` service in `docker-compose.yaml`, `api` — `src/clients/indexer/client.ts` | working; alternativa manual: pegar un magnet (`addMagnetToMovie`, `src/clients/torrent/magnet.ts`) — mismo `MediaSource`/AutoRun de ahí en más |
| Download | qBittorrent — `torrent` service, `api` — `src/clients/torrent/client.ts` | working, per-torrent save path |
| Detect completion, update DB, enqueue job | `api` — `src/downloads/` (`torrentCompleted` mutation, BullMQ producer) | working |
| Scan downloaded files, inventory | `worker` — BullMQ consumer, talks to `api` over GraphQL | working |
| Transcode | `worker` (FFmpeg) | not started — `ProcessJob` rows sit in `WAITING` |
| Notify media server | `api` — `src/media-server/`, `src/clients/media-server/` | working (Jellyfin, opt-in from Settings, default `none`) |
| Browse library | `web` | working for the movie list |

## Layout

```
bin/                     host wrapper scripts (see below)
docs/constitution.md     the non-negotiable rules — outranks every CLAUDE.md
docs/spec/               component specs, e.g. docs/spec/docker/traefik.md
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
                              |        \                 ^
                        db (MariaDB) redis (queue)       | AutoRun hook on completion
                                       |
                       worker (no ingress, Redis queue only, calls back into api over GraphQL)
```

- Everything shares the `perceptor-net` bridge network.
- `web` waits for `api` healthy; `api` waits for `db` and `redis` healthy; `worker` waits for
  `redis` and `api` healthy.
- `web` and `worker` never touch the database directly — both go through `api`'s GraphQL endpoint
  (`INTERNAL_GRAPHQL_URL=http://api:${API_PORT}/graphql`).
- Only containers with `traefik.enable=true` are routed — see `docs/spec/docker/traefik.md`
  for the label contract.

## Docker-first workflow

**Nothing runs on the host.** There are no `node_modules` installed for the host toolchain and no
local MariaDB/Redis. Do not run `npm`, `npx`, `nest`, `prisma`, or `next` directly — always go
through the wrappers in `bin/`, which shell into the running containers.

| Script | What it does | Example |
| :-- | :-- | :-- |
| `bin/install` | generates `.env` from `.env.example`, asking Traefik y/n + domain | run once, first checkout |
| `bin/dev` | `docker compose up -d` in dev mode, reads `USE_TRAEFIK` from `.env` to include/exclude `traefik` | `bin/dev` |
| `bin/prod` | same, `BUILD_TARGET=runner`, rebuilds images | `bin/prod` |
| `bin/cli <service> <cmd…>` | `docker compose exec -it <service> <cmd…>` | `bin/cli api npx prisma migrate status` |
| `bin/npm [service] <args…>` | npm inside a service; **defaults to `web`** when the first arg is not `web`/`api`/`worker` | `bin/npm api run test`, `bin/npm run dev` (= web) |
| `bin/bash <service>` | interactive `sh` in a container | `bin/bash api` |
| `bin/mysql [args…]` | `mariadb` client against `db` using `.env` credentials | `bin/mysql -e 'show tables'` |
| `bin/dbinit` | grants global privileges to `${DB_USER}` so Prisma can create its shadow database | run once after a fresh `db` volume, before `prisma migrate dev` |

Bring the stack up from the repo root:

```bash
bin/dev
```

`bin/dev`/`bin/prod` decide whether to include the `traefik` service based on `USE_TRAEFIK` in
`.env` (set by `bin/install`). Without Traefik, each service is still reachable directly on its
published port (`WEB_PORT`, `API_PORT`, etc.) — Traefik only adds domain-based routing.

Source is bind-mounted (`./services/<svc>:/app`), so edits hot-reload. The dev stages install
`node_modules` on first boot if the directory is missing, which means `node_modules` lands in your
host working copy — that is intentional, and it is what your editor's TypeScript server reads.

## Environment

All configuration lives in `.env` at the repo root (see `.env.example` for the full list of names);
compose interpolates it and passes a subset into each container. Variable names (values are
secret, never copy them into docs or code):

`NODE_ENV`, `TZ`, `PUID`, `PGID`, `USE_TRAEFIK`, `DOMAIN`,
`ADMIN_USER`, `ADMIN_PASSWORD`,
`WEB_PORT`, `API_PORT`, `DB_PORT`, `REDIS_PORT`, `INDEXER_PORT`,
`QBITTORRENT_WEBUI_PORT`, `QBITTORRENT_TORRENTING_PORT`, `QBITTORRENT_USER`, `QBITTORRENT_PASSWORD`,
`INDEXER_USER`, `INDEXER_PASSWORD`,
`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `DATABASE_URL`,
`REDIS_HOST`, `HOST_DOWNLOADS_DIR`, `HOST_DESTINATIONS_DIR`,
`CONTAINER_DOWNLOADS_DIR`, `CONTAINER_DESTINATIONS_DIR`.

`HOST_DOWNLOADS_DIR`/`HOST_DESTINATIONS_DIR` and `CONTAINER_DOWNLOADS_DIR`/`CONTAINER_DESTINATIONS_DIR`
are also passed into `api` (not just `worker`/`torrent`) — `api`'s `src/media-roots/` module reads
them to know the two roots the Settings UI is confined to. The `path_downloads`/`path_movies`/
`path_shows` settings (editable from the web UI) are **segments relative to those roots**, never
absolute container paths — e.g. `path_movies=Movies` means
`<HOST_DESTINATIONS_DIR>/Movies` on the host. The UI only ever shows/edits the host-side path; the
container path never crosses the GraphQL boundary. See `services/api/CLAUDE.md`.

`ADMIN_USER`/`ADMIN_PASSWORD` are the canonical credentials — `QBITTORRENT_USER`/`QBITTORRENT_PASSWORD`
and `INDEXER_USER`/`INDEXER_PASSWORD` reference them via `.env` interpolation (`${ADMIN_USER}`), and
the api seed reads them directly, so the app login, qBittorrent's WebUI and Prowlarr's WebUI all
share one login. Each service's own UI can still change its own credentials afterward.

`BUILD_TARGET` is an optional override for which Dockerfile stage to run (`dev` by default,
`runner` for production) — every Dockerfile has `base` / `dev` / `builder` / `runner` stages, and
compose falls back to `dev` when it's unset.

The media server (Jellyfin today, see `media_server_client` in Settings) is **not** a service in
`docker-compose.yaml` — it's assumed to run outside the stack, on the user's own host or LAN. That's
why the post-encode notification (`api`'s `MediaServerService.notifyCreated`, called from
`ProcessJobsService.encodeCompleted`) translates the container's output path to the host path via
`MediaRootsService.containerToHostPath()` before sending it: a Jellyfin outside the stack has no
idea what `/media/library/...` means, but it can see the same host folder the user configured in
`HOST_DESTINATIONS_DIR`.

Note: `TMDB_API_KEY` is **not** currently in `.env` — the TMDB bearer token is hardcoded in
`TMDBClient.ts` instead (see Known debt below). Add it to `.env` if you fix that.

## Conventions

- **Commits**: `[scope] lowercase message` — scopes seen so far are `[api]`, `[web]`, `[traefix]`.
- **Language**: everything committed is English — code comments, identifiers, documentation,
  commit messages, test descriptions. See `docs/constitution.md` → Article VI, which is the
  authority. The **exception is user-facing copy**: error messages and UI text the app shows are
  Spanish, because the app is Spanish. Much of the existing code still carries Spanish comments
  from before this rule; that is legacy, not a pattern to copy.
- **Path alias**: `@/*` → `./src/*` in both `api` (tsconfig `paths`) and `web`.
- **API contract**: GraphQL only. `web` never touches the database; it calls the API through
  `fetchGraphQL` in `services/web/src/lib/graphql-client.ts`.
  **One deliberate exception**: `POST/PATCH/HEAD /uploads` on `api` (`services/api/src/uploads/`)
  is the project's only REST route. A file upload from the browser (up to tens of GB, resumable via
  the [tus](https://tus.io) protocol) doesn't fit a GraphQL mutation or a Next Server Action (1MB
  body limit by default) — so the browser talks to `api` directly for that one endpoint, bypassing
  `web` entirely. `onUploadFinish` closes the loop itself (creates the `MediaSource`, updates the
  `Movie`, enqueues `bull:process`) in the same request that received the last chunk, so there's no
  window where a file is uploaded but unregistered. `web` still never touches the database and has
  no other path to `api` besides `fetchGraphQL`.

## Spec Driven Development

`docs/constitution.md` holds the nine rules that outrank every other document here. When it and a
`CLAUDE.md` disagree, the constitution wins and the `CLAUDE.md` is the bug.

A change starts as a feature spec when it touches more than one service, the Prisma schema, the
GraphQL contract, or a pipeline stage (Article VII). Everything smaller — a bug fix, a rename, a
doc correction — does not. The flow:

| Step | Produces |
| :-- | :-- |
| `/specify <description>` | `docs/spec/features/NNN-slug/spec.md` — requirements, the GraphQL contract delta, acceptance criteria. Open questions are left as `[NEEDS CLARIFICATION]` |
| `/plan-feature NNN` | `plan.md` (cross-service: order, migrations, risk) and one `<svc>/plan.md` per service the feature touches. Refuses to run while any clarification is open |
| `/tasks NNN` | `tasks.md` — atomic tasks, each tagged `[api]`/`[web]`/`[worker]`, with dependencies |
| `/implement NNN` | Dispatches each task to that service's subagent (`.claude/agents/`) and verifies the reports |

`/constitution` reviews or amends the rules themselves.

Two things make this work rather than just add ceremony:

- **The GraphQL contract is frozen before anyone implements** (Article VIII). There is no codegen
  between `api` and its consumers — `web` and `worker` retype the schema by hand — so an
  unannounced contract change fails at runtime, not at compile time. See
  `docs/spec/graphql-contract.md`.
- **Each subagent writes only inside its own service.** A task that needs two services is two
  tasks. An agent that hits another service's code stops and reports instead of helpfully fixing
  it. There is no `db` agent: the database belongs to `api` (Article III).

**Dispatching note.** The Claude Code CLI discovers `.claude/agents/` and resolves
`subagent_type: "worker"` directly. The desktop app does **not** — it only offers its built-in
agent set. There the flow still works: dispatch `general-purpose` and tell it to read
`.claude/agents/<service>.md` first and follow it as its instructions. `/implement` does this
automatically. The fallback loses the frontmatter's `tools:` restriction, so the scope boundary
rests entirely on the brief — which is why `/implement` verifies the diff after every batch.

`docs/spec/features/_templates/` holds the four templates; `docs/spec/features/001-magnet-import/`
is a worked example, written after the fact against a feature that shipped.

## Current state — do not treat these files as reference code

Measured 2026-08-09. Re-run the typechecks rather than trusting the counts — the numbers are what
an agent reports before and after a change to prove it added nothing.

**`api` — 3 errors, all in one test file.** `bin/cli api npx --no tsc --noEmit`:
`src/auth/test/auth.service.spec.ts` has two `'user' is possibly 'null'` and one wrong arity. The TMDB search slice that used to be listed here now compiles; `TMDBClient.ts` is gone,
replaced by `src/clients/tmdb/{client,types}.ts`.

**`web` — 13 errors across 5 files**, all pre-GraphQL leftovers on paths the running UI does not
use: `components/import/importFolderModal.tsx` and `ImportMagnetSeasonModal.tsx` (both import a
non-existent `@/actions/jobs`, both pass `value` to a component that only takes `defaultValue`),
`components/search/SearchTorrentModal.tsx` (imports `@prisma/client` — a Constitution Article II
violation), `SearchForm.tsx` and `ResultsForm.tsx` (missing `@/icons`, implicit `any`).
`services/web/CLAUDE.md` has the table.

**`worker` — clean.**

## Known debt

- TMDB bearer token is hardcoded in `services/api/src/clients/TMDBClient.ts`; there's no
  `TMDB_API_KEY` in `.env` yet to replace it with.
- The database DSN is hardcoded in `services/api/src/prisma/prisma.service.ts` even though
  `DATABASE_URL` already exists in `.env`.
- `services/api/prisma/schema.prisma` declares `datasource db` with no `url` — the connection
  comes solely from the driver adapter.

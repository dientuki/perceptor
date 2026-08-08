# Perceptor

Self-hosted media automation. A user searches a title, Perceptor registers it, finds a release,
downloads it, transcodes it with FFmpeg and files the result in a library.

Pipeline stage status today:

| Stage | Where | Status |
| :-- | :-- | :-- |
| Search catalog (TMDB) | `api` — `src/clients/TMDBClient.ts`, `src/movies/movies.search.ts` | in progress, does not compile |
| Register title in DB | `api` — `movies` module + Prisma | working (read + CRUD service) |
| Find release (indexer) | Prowlarr — `indexer` service in `docker-compose.yaml`, `api` — `src/clients/indexer/client.ts` | working |
| Download | qBittorrent — `torrent` service, `api` — `src/clients/torrent/client.ts` | working, per-torrent save path |
| Detect completion, update DB, enqueue job | `api` — `src/downloads/` (`torrentCompleted` mutation, BullMQ producer) | working |
| Scan downloaded files, inventory | `worker` — BullMQ consumer, talks to `api` over GraphQL | working |
| Transcode | `worker` (FFmpeg) | not started — `ProcessJob` rows sit in `WAITING` |
| Browse library | `web` | working for the movie list |

## Layout

```
bin/                     host wrapper scripts (see below)
docs/spec/               service specs, e.g. docs/spec/docker/traefik.md
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

`ADMIN_USER`/`ADMIN_PASSWORD` are the canonical credentials — `QBITTORRENT_USER`/`QBITTORRENT_PASSWORD`
and `INDEXER_USER`/`INDEXER_PASSWORD` reference them via `.env` interpolation (`${ADMIN_USER}`), and
the api seed reads them directly, so the app login, qBittorrent's WebUI and Prowlarr's WebUI all
share one login. Each service's own UI can still change its own credentials afterward.

`BUILD_TARGET` is an optional override for which Dockerfile stage to run (`dev` by default,
`runner` for production) — every Dockerfile has `base` / `dev` / `builder` / `runner` stages, and
compose falls back to `dev` when it's unset.

Note: `TMDB_API_KEY` is **not** currently in `.env` — the TMDB bearer token is hardcoded in
`TMDBClient.ts` instead (see Known debt below). Add it to `.env` if you fix that.

## Conventions

- **Commits**: `[scope] lowercase message` — scopes seen so far are `[api]`, `[web]`, `[traefix]`.
- **Language**: code comments are Spanish; commit messages, documentation and identifiers are
  English. Keep it that way.
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

## Current state — do not treat these files as reference code

A TMDB search slice is mid-refactor and **does not compile**. Files carried over from a
pre-GraphQL version of the app still import modules that no longer exist. If you touch this area,
expect to fix the wiring rather than follow it:

- `services/api/src/movies/movies.search.ts` — imports `@/clients/MovieDB/types` and `../types`;
  neither path exists. The real client types are in `src/clients/types.ts`.
- `services/api/src/movies/movies.resolver.ts` — references an undefined `MovieType` and
  `moviesService.searchMovies()`, which is commented out in `movies.service.ts`.
- `services/api/src/clients/types.ts` and `TMDBClient.ts` — import `@/types/media` (does not exist
  in `api`, only in `web`) and `MEDIA_TYPE` from `@prisma/client` (no such enum, see
  `services/api/CLAUDE.md`). `types.ts` also uses `MEDIA_TYPE.TV` while `web` defines
  `MOVIE`/`SHOW`.
- `services/web/src/actions/movies.ts` — `searchMovies` and `addMovie` return `true` against
  non-boolean signatures.
- `services/web/src/components/search/SearchTorrent.tsx`, `SearchTorrentModal.tsx`, `SearchForm.tsx`
  and `src/app/(dashboard)/movies/[id]/page.tsx` — import `@prisma/client`, `@/models/movies.model`,
  `@/clients/indexer/types`, `@/lib/logger`, `@/actions/indexer`, `@/components/ui/modal` and
  `@/icons`; none exist in `services/web`.

## Known debt

- TMDB bearer token is hardcoded in `services/api/src/clients/TMDBClient.ts`; there's no
  `TMDB_API_KEY` in `.env` yet to replace it with.
- The database DSN is hardcoded in `services/api/src/prisma/prisma.service.ts` even though
  `DATABASE_URL` already exists in `.env`.
- `services/api/prisma/schema.prisma` declares `datasource db` with no `url` — the connection
  comes solely from the driver adapter.

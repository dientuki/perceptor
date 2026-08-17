# 👁️ Perceptor

**One Docker stack. One workflow. No complicated setup.**

**Perceptor** is a self-hosted platform that automates the entire digital content workflow — from discovery and downloading to processing and organization. The project combines a modern web interface with a backend API and background workers, integrating external services to manage the entire content workflow from a single place.

## Features
🎬 Digital content management
🔎 Automatic content discovery through external sources
⬇️ Download management
⚙️ Background processing with dedicated workers
🎞️ Video conversion and optimization
🗂️ Automatic content organization
👤 User preferences and configuration
🔐 Session management
🚦 Job queue for asynchronous tasks
🐳 Fully containerized development environment
📦 Modular architecture designed to support additional integrations

## Pipeline status

| Stage | Where | Status |
| :-- | :-- | :-- |
| Search catalog (TMDB) | `api` | in progress, does not compile yet |
| Register title in DB | `api` (GraphQL + Prisma) | working |
| Find release | Prowlarr (`indexer` service) | working |
| Download | qBittorrent (`torrent` service) | working — per-torrent save path |
| Detect completion → update DB → enqueue job | `api` (`torrentCompleted` mutation, BullMQ) | working |
| Scan files & inventory | `worker` (BullMQ consumer + GraphQL) | working |
| Transcode (FFmpeg) | `worker` | not started |
| Browse library | `web` | working for the movie list |

## Architecture

```
                       :80 / :443
                           |
                       traefik (reverse proxy, opt-in per service via labels)
                        /        \
        Host(${DOMAIN})           Host(api.${DOMAIN})
              |                           |
        web  :3000  --GraphQL-->   api  :${API_PORT}
                                     |  \        \
                                   db   redis   torrent / indexer
                                  (MariaDB) (queue) (qBittorrent / Prowlarr)
                                              |
                                           worker (BullMQ consumer, no ingress)
```

- `web`, `api`, `worker`, `db`, `redis`, `torrent` (qBittorrent) and `indexer` (Prowlarr) all share
  one Docker bridge network.
- `web` and `worker` never touch the database directly — everything goes through the API's GraphQL
  endpoint.
- The `worker` has no HTTP ingress; it only listens on the Redis queue and calls back into the API.

### Services

| Service | Stack | Role |
| :-- | :-- | :-- |
| `web` | Next.js 16, React 19, Tailwind 4 | UI, talks to `api` over GraphQL only |
| `api` | NestJS 11, Apollo (code-first GraphQL), Prisma 7 | Source of truth: DB, business logic, GraphQL API |
| `worker` | BullMQ, FFmpeg | Consumes queue jobs, scans downloads, will run transcodes |
| `db` | MariaDB 12 | Persistence |
| `redis` | Redis 7 | Job queue between `api` (producer) and `worker` (consumer) |
| `torrent` | qBittorrent | Download client |
| `indexer` | Prowlarr | Torrent indexer |
| `traefik` | Traefik v3 | Reverse proxy / routing |

## Getting started

Everything runs in Docker — there's no local Node install, no host `node_modules`, no local
MariaDB/Redis. You only need Docker and Docker Compose.

1. **Clone the repo**
   ```bash
   git clone https://github.com/dientuki/perceptor.git
   cd perceptor
   ```

2. **Generate `.env`**
   ```bash
   bin/install
   ```
   Copies `.env.example` to `.env` and asks whether to route through Traefik. Say no unless you
   want to set up domain-based routing — it needs a resolvable hostname (e.g. an `/etc/hosts`
   entry) for `web`/`api`/`torrent`/`indexer`. Then fill in the rest of the values in `.env`
   (ports, DB credentials, download paths) — `bin/install` only handles Traefik and `DOMAIN`.

3. **Bring the stack up**
   ```bash
   bin/dev
   ```
   Reads `USE_TRAEFIK` from `.env` and starts the stack with or without the `traefik` service
   accordingly. Without Traefik, reach each service directly: `http://localhost:${WEB_PORT}`,
   `http://localhost:${API_PORT}/graphql`, etc. First boot installs each service's `node_modules`
   into your host working copy — that's expected, and it's what your editor's TypeScript server
   reads.

4. **Grant Prisma the privileges it needs** (once, on a fresh `db` volume — Prisma's shadow database
   needs broader grants than the app user has by default):
   ```bash
   bin/dbinit
   ```

5. **Apply the database schema**:
   ```bash
   bin/cli api npx prisma migrate deploy
   ```

6. Open the web UI and GraphQL playground — `http://${DOMAIN}` / `http://api.${DOMAIN}/graphql`
   with Traefik, or `http://localhost:${WEB_PORT}` / `http://localhost:${API_PORT}/graphql`
   without it.

Source is bind-mounted, so edits hot-reload in every service without a rebuild.

## Day-to-day commands

Nothing runs on the host — always go through the wrappers in `bin/`:

| Command | What it does |
| :-- | :-- |
| `bin/install` | Generate `.env` from `.env.example`, asking about Traefik + domain |
| `bin/dev` | Bring the stack up in dev mode (reads `USE_TRAEFIK` from `.env`) |
| `bin/prod` | Bring the stack up in prod mode (`runner` Dockerfile stage, rebuilds images) |
| `bin/cli <service> <cmd…>` | Run any command inside a running container |
| `bin/npm [service] <args…>` | npm inside a service (defaults to `web`) |
| `bin/bash <service>` | Interactive shell in a container |
| `bin/mysql [args…]` | MariaDB client against `db` using `.env` credentials |
| `bin/dbinit` | Grant Prisma the privileges it needs (run once, after a fresh `db` volume) |

Common Prisma tasks, run through `bin/cli api`:

```bash
bin/cli api npx prisma migrate status      # check pending migrations
bin/cli api npx prisma migrate dev --name your_migration_name   # create + apply a migration
bin/cli api npx prisma studio              # browse the DB in a GUI
```

## Known limitations

- TMDB search (`api`) doesn't compile yet — a WIP slice with broken imports.
- FFmpeg transcoding hasn't been implemented — `ProcessJob` rows are created and sit in `WAITING`.
- TV series aren't wired up end-to-end yet; the data model supports them, the flows don't yet.

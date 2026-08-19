# 👁️ Perceptor

**Search a title. Get it filed in your library, already transcoded, in the language you actually
watch it in.**

Perceptor is a self-hosted media automation stack. You type a movie or a series name, it finds the
title on TMDB, finds a release through your indexers, downloads it, transcodes it to AV1 with the
audio and subtitle tracks *you* care about, files the result in your library and tells your media
server to pick it up. One `docker compose` stack, one login, no glue scripts.

## The problem

The usual self-hosted setup is four or five separate apps stitched together: one to track what you
want, one to search indexers, one to download, one to rename, and a manual FFmpeg pass — or none at
all — when the file turns out to be a 60 GB 4K HDR remux with eleven audio tracks you can't play.
Every one of them has its own login, its own paths, its own idea of what your library looks like,
and the pieces between them are yours to maintain.

Perceptor is the whole path as a single product:

- **One login.** The app, qBittorrent's UI and Prowlarr's UI all share the same admin credentials,
  seeded from your `.env`. Additional users are created by an admin — there's no public signup.
- **One library per user.** Each user has their own films and series. A title someone else owns
  simply isn't there for you.
- **One place to configure paths.** Your download and library roots are set once; every path in the
  UI is relative to them, and container paths never leak into the interface.
- **Files that play.** The transcode isn't an afterthought bolted onto a downloader — it's the point.

## What it does today

### Find and add
- 🔎 **Search TMDB for films and series** from one dialog and add them to your library.
- 📺 **Series come with their seasons and episodes**, fetched in the background when you add them.
- 🧲 **Or paste a magnet** — for a film, a single episode, or a whole season pack — and skip the
  search entirely.
- 📤 **Or upload a file you already have**, resumable, up to tens of gigabytes, straight from the
  browser.

### Acquire
- 🌐 **Indexer search through Prowlarr**, for a full film or one specific episode, with a
  **FlareSolverr** proxy pre-registered for Cloudflare-fronted trackers.
- ⬇️ **Downloads through qBittorrent**, each with its own save path, and completion detected
  automatically — no polling, no cron.
- 🔑 **No API-key copy-paste on a fresh checkout.** The installer generates Prowlarr's key and the
  container adopts it before boot.

### Process
- 🎞️ **H264 / VC-1 → AV1** via `libsvtav1`; **4K HDR10 and Dolby Vision tonemapped to 1080p SDR**;
  audio to Opus.
- 🗣️ **Language preferences you choose** — globally, plus extra languages per title. The encode
  keeps the original language plus the union of what every owner of that title asked for. Nobody
  ends up with a file they can't understand.
- 🧠 **Decisions made from the container, not the filename.** Remux vs. web-grade quality comes from
  `ffprobe` metadata, so a badly named release still gets the right treatment.
- 📦 **Season packs fan out correctly**: every file is enumerated, matched to its episode by
  `SxxEyy`, and each becomes its own job — cleanup waits for the whole pack, not the first episode
  to finish.
- ⚡ **Optional GPU acceleration** for the tonemap/scale pass (`USE_GPU=true`).

### Enjoy
- 🗂️ **Automatic filing** into your library layout.
- 🔔 **Media server notification** — Jellyfin today, opt-in from Settings — with the path translated
  to what your media server actually sees.
- 🖥️ **Library browsing** for films and series, with a per-series season accordion and per-episode
  actions (search, import a file, add a torrent).
- ⚙️ **Settings in the UI**: paths, TMDB key, indexer key, media server, which media types are
  enabled.
- 👥 **User management**: create users, disable them (which revokes their live sessions immediately,
  not just their next login), and `bin/reset-password` as the recovery path when nobody can sign in.

## Technical summary

| Service | Stack | Role |
| :-- | :-- | :-- |
| `web` | Next.js 16, React 19, Tailwind 4 | UI. Talks to `api` over GraphQL only |
| `api` | NestJS 11, Apollo (code-first), Prisma 7 | Source of truth: DB, business logic, GraphQL API |
| `worker` | BullMQ, FFmpeg, mkvmerge | Scans downloads, transcodes, files the output |
| `db` | MariaDB 12 | Persistence |
| `redis` | Redis 7 | Job queue between `api` (producer) and `worker` (consumer) |
| `torrent` | qBittorrent | Download client |
| `indexer` | Prowlarr | Release search across your trackers |
| `flaresolverr` | FlareSolverr | Cloudflare challenge solver for `indexer` |
| `traefik` | Traefik v3.7 | Optional domain-based routing |

```
                       :80 / :443
                           |
                       traefik (opt-in per service via labels)
                  /        |         \                    \
    Host(${DOMAIN})  Host(api.${DOMAIN})  Host(torrent.${DOMAIN})  Host(indexer.${DOMAIN})
        |                  |                     |                      |
   web  :3000  --GraphQL-->  api  :${API_PORT}   torrent (qBittorrent)  indexer (Prowlarr)
                              |        \                 ^                |
                        db (MariaDB) redis (queue)       | AutoRun hook   v
                                       |                 |          flaresolverr
                                    worker (no ingress; Redis queue in,
                                     GraphQL back into api)
```

Design rules the codebase actually holds itself to:

- **GraphQL is the only contract.** `web` and `worker` never touch the database — everything goes
  through `api`. The one deliberate exception is the resumable [tus](https://tus.io) upload
  endpoint, because a 40 GB file doesn't fit in a GraphQL mutation.
- **The worker has no ingress.** It listens on Redis and calls back into `api`.
- **JWT auth with a machine credential.** The worker and qBittorrent's completion hook authenticate
  with a non-expiring service token minted from `JWT_SECRET`; `api` refuses to boot without one.
- **Docker-first.** Nothing runs on the host — no host Node, no local MariaDB or Redis. Source is
  bind-mounted, so every service hot-reloads.
- **Spec-driven.** Features start as a spec in `docs/spec/features/`, get a plan, then tasks, then
  implementation — with the GraphQL contract frozen before anyone writes code, since there's no
  codegen between services. `docs/constitution.md` holds the rules that outrank everything else.

## Getting started

You only need Docker and Docker Compose.

1. **Clone**
   ```bash
   git clone https://github.com/dientuki/perceptor.git
   cd perceptor
   ```

2. **Generate `.env`**
   ```bash
   bin/install
   ```
   Creates `.env` from `.env.example`, asks whether to route through Traefik, and generates the
   secrets that matter (`JWT_SECRET`, `SERVICE_TOKEN`, `INDEXER_API_KEY`). Say no to Traefik unless
   you want domain-based routing — it needs a resolvable hostname for `web`/`api`/`torrent`/
   `indexer`. Then fill in the rest: ports, DB credentials, admin user, download and library paths.

3. **Bring the stack up**
   ```bash
   bin/dev
   ```
   Reads `USE_TRAEFIK` and `USE_GPU` from `.env` to decide which compose files to include. Without
   Traefik, reach each service directly: `http://localhost:${WEB_PORT}`,
   `http://localhost:${API_PORT}/graphql`. First boot installs each service's `node_modules` into
   your working copy — that's intentional, and it's what your editor's TypeScript server reads.

4. **Grant Prisma its privileges** (once, on a fresh `db` volume — the shadow database needs broader
   grants than the app user has):
   ```bash
   bin/dbinit
   ```

5. **Apply the schema**
   ```bash
   bin/cli api npx prisma migrate deploy
   ```

6. **Sign in** as `ADMIN_USER` / `ADMIN_PASSWORD` and open **Settings** to paste your TMDB API key —
   a fresh install ships it empty, so search returns `401` until you do.

> **Upgrading an existing checkout?** Run `bin/install` again and answer *no* to regenerating `.env`.
> It fills in any missing secrets without touching what you already configured. `api` will not boot
> with `JWT_SECRET` unset — that's by design.

## Day-to-day commands

Nothing runs on the host — always go through the wrappers in `bin/`:

| Command | What it does |
| :-- | :-- |
| `bin/install` | Generate `.env`, configure Traefik/domain, mint secrets |
| `bin/dev` | Bring the stack up in dev mode |
| `bin/prod` | Bring the stack up in prod mode (`runner` stage, rebuilds images) |
| `bin/cli <service> <cmd…>` | Run any command inside a running container |
| `bin/npm [service] <args…>` | npm inside a service (defaults to `web`) |
| `bin/bash <service>` | Interactive shell in a container |
| `bin/mysql [args…]` | MariaDB client against `db` |
| `bin/dbinit` | Grant Prisma its privileges (once, per fresh `db` volume) |
| `bin/reset-password <user>` | Reset a user's password — the recovery path when no admin can log in |

Common Prisma tasks:

```bash
bin/cli api npx prisma migrate status
```

```bash
bin/cli api npx prisma migrate dev --name your_migration_name
```

```bash
bin/cli api npx prisma studio
```

## Status and known limitations

The pipeline runs end to end for both films and series — search, register, find a release,
download, scan, transcode, file, notify, browse. Fourteen feature specs (`001` through `014`) are
implemented; `docs/spec/features/` has each one, and the root `CLAUDE.md` has a stage-by-stage table.

Rough edges, stated plainly:

- **`bin/npm web run build` fails.** 11 TypeScript errors across 4 pre-GraphQL files, none of them
  reachable from the running UI. Dev mode is unaffected. Tracked as spec `016-web-build-errors`.
- **Production images aren't reproducible yet.** The three Node services run their `dev` stage and
  install dependencies at first boot. Tracked as spec `015-reproducible-image-builds`.
- **The worker image is tied to Intel/Mesa Vulkan** for the `libplacebo` tonemap filter. Tracked as
  spec `017-worker-gpu-strategy`.
- **Season packs are api-only.** `addMagnetToSeason` works; there's no web UI for it yet.
- **AV1 encoding is CPU-bound by design** — neither Intel iGPUs nor most dGPUs can encode AV1 in
  hardware. `USE_GPU` accelerates the tonemap/scale pass only.
- **Which indexers sit behind Cloudflare is a manual call.** The FlareSolverr proxy is registered
  automatically, but tagging the indexers that need it stays a step in Prowlarr's UI.
- **Jellyfin is the only media server client** implemented so far, and it's expected to run outside
  this stack.

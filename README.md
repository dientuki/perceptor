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
- 🔎 **One search box for everything.** Type a title in the header — from any screen, on any
  viewport — and get films and series back in a single ranked list, without deciding first which
  one you meant.
- 📺 **Series come with their seasons and episodes**, fetched in the background when you add them.
  A scheduled sweep later fills in the titles, overviews and air dates of episodes that had none
  when you registered the series.
- 🧲 **Or paste a magnet** — for a film, a single episode, or a whole season pack — and skip the
  search entirely.
- 📤 **Or upload a file you already have**, resumable, up to tens of gigabytes, straight from the
  browser.
- 🪞 **A title you already own isn't re-downloaded.** Registering something reconciles it against
  your media server first: if Jellyfin already has the film — or some of the episodes — they come
  in as complete, not missing.

### Acquire
- 🌐 **Indexer search through Prowlarr**, for a full film or one specific episode, with a
  **FlareSolverr** proxy pre-registered for Cloudflare-fronted trackers. Every row Prowlarr returns
  survives the trip: nothing is dropped for missing metadata.
- 🏆 **"Best candidates"** re-ranks the results the way an automatic picker would, so you can see
  the shortlist instead of reading release names one by one.
- ⚡ **Repeat searches are cached** for ten minutes, so re-opening the modal doesn't hammer your
  trackers.
- ⬇️ **Downloads through qBittorrent**, each with its own save path, with live progress and speed in
  the UI and start/stop/delete from Perceptor itself. A title can race several sources at once —
  the first one to finish wins, the losers are demoted.
- ♻️ **A finished title can be replaced.** A bad cut, a broken encode or the wrong language isn't a
  dead end: point a new torrent or a new upload at it and it supersedes what's there.
- 🔑 **No API-key copy-paste on a fresh checkout.** The installer generates Prowlarr's key and the
  container adopts it before boot.

### Process
- 🎞️ **H264 / VC-1 → AV1** via `libsvtav1`; **4K HDR10 and Dolby Vision downscaled to 1080p with
  their HDR preserved**, never flattened to SDR; audio to Opus.
- 🗣️ **Language preferences you choose**, at three levels that merge rather than override: the
  installation default, your own account preferences, and extra languages on one specific title.
  **Audio and subtitles are chosen separately** — original audio plus Spanish subtitles is a thing
  you can actually ask for.
- 🌎 **Regional variants are first-class.** `es-419` and `es-ES` are different preferences, and the
  encode picks the right one instead of guessing from the track title.
- 🧠 **Decisions made from the container, not the filename.** Remux vs. web-grade quality comes from
  `ffprobe` metadata, so a badly named release still gets the right treatment.
- 📦 **Season packs fan out correctly**: every file is enumerated, matched to its episode by
  `SxxEyy`, and each becomes its own job — cleanup waits for the whole pack, not the first episode
  to finish.
- 🔕 **Compression is optional.** Turn it off from Settings and the pipeline still renames, moves
  and files the release — it just never invokes FFmpeg.
- 🏷️ **Every transcoded file records where it came from.** A `title` tag for players, and a
  `PERCEPTOR_SOURCE` tag naming the exact release path — so "which rip is this?" is answerable
  months after the download was cleaned up.
- 📮 **A finished encode is never lost.** If the api is restarting when the worker reports back, the
  worker keeps retrying until it's acknowledged; both outcome mutations are safe to receive twice.

### Enjoy
- 🗂️ **Automatic filing** into your library layout.
- 🔔 **Media server notification** — Jellyfin today, opt-in from Settings — with the path translated
  to what your media server actually sees, plus a local index you can re-sync on demand.
- 🖥️ **Library browsing** for films and series, with a billboard home, a per-series season accordion
  and per-episode actions (search, import a file, add a torrent).
- 📊 **One status vocabulary.** Queued, downloading, encoding, done — the same words everywhere, so
  two screens never disagree about the same title.
- ⏰ **Scheduled tasks** an admin can enable and pace from Settings, for the work that has to happen
  after registration rather than during it.
- ⚙️ **Settings in the UI**, split into tabs: paths, TMDB key, indexer key, media server,
  compression, scheduling, and which media types are enabled. **Disabling films or series actually
  disables them** — sidebar, billboard, search and routes all follow, while anything already in the
  pipeline is allowed to finish.
- 🙋 **Per-user preferences** at `/preferences`: interface language, audio and subtitle languages,
  and the torrent groups you care about.
- 👥 **User management**: create, edit and disable users (disabling revokes live sessions
  immediately, not just the next login), with `bin/reset-password` as the recovery path when nobody
  can sign in.

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
   Reads `USE_TRAEFIK` from `.env` to decide whether to include Traefik. Without
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
| `bin/prod` | Bring the stack up in prod mode (`prod` stage, rebuilds images) |
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

The pipeline runs end to end for both films and series — search, register, find a release, download,
scan, transcode, file, notify, browse. Forty-six feature specs (`001` through `046`) are implemented;
`docs/spec/features/` has each one, and the root `CLAUDE.md` has a stage-by-stage table plus the
current test and build numbers.

Rough edges, stated plainly:

- **Season packs are api-only.** `addMagnetToSeason` works; there's no web UI for it yet.
- **Releases are never picked automatically.** "Best candidates" shows the shortlist an automatic
  picker would produce, but a human still clicks. Nothing in the stack acquires a title unattended.
- **The scheduler does one real job.** `035` built the scheduling machinery and registered four task
  ids; only `refresh_episodes` has a body. The other three are still stubs.
- **AV1 encoding is CPU-bound by design** — no current consumer GPU encodes AV1 in hardware, and
  the pipeline has no GPU-accelerated stage of any kind.
- **Which indexers sit behind Cloudflare is a manual call.** The FlareSolverr proxy is registered
  automatically, but tagging the indexers that need it stays a step in Prowlarr's UI.
- **Jellyfin is the only media server client** implemented so far, and it's expected to run outside
  this stack.
- **Libraries don't overlap.** Each user sees only their own titles; a title someone else registered
  answers "not available for this user" rather than rendering. There is no shared or household
  library.
- **No quality profiles, no upgrade loop.** Perceptor normalizes what it gets rather than chasing a
  better release later — a deliberate omission, not a backlog item.

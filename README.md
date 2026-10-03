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

## Status

**Perceptor is in closed alpha: the feature set is frozen.** The pipeline runs end to end for both
films and series — search, register, find a release, download, scan, transcode, file, notify and
browse — and from here the work is stabilising what exists, not adding to it. New feature requests
are not being taken; bug reports are. It has no production deployment and no users besides its
author.

The published images are release candidates (`v0.1.0-rc1` through `v0.4.0-rc2`); there is no stable
release yet, so `latest` resolves to the newest release candidate rather than to a final version.

Eighty feature specs (`001` through `080`) live in `docs/spec/features/`. The root `CLAUDE.md` has a
stage-by-stage table, and [Known limitations](#known-limitations) lists the rough edges.

## Stack

- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS 4, next-intl (English/Spanish),
  tus-js-client, Biome
- **API:** NestJS 11, Apollo Server 5 with code-first GraphQL, Prisma 7, `@tus/server`, JWT auth,
  Jest
- **Worker:** Node.js 24, BullMQ, FFmpeg (SVT-AV1, Opus), MKVToolNix, Vitest
- **Data:** MariaDB 12, Redis 7 (BullMQ queues, pub/sub, search cache)
- **Infrastructure:** Docker Compose (runtime, build and dev overlays), multi-stage Dockerfiles,
  Traefik v3.7 (optional), GitHub Actions release workflow publishing to GHCR
- **Integrations:** qBittorrent (download client), Prowlarr (indexer aggregation), FlareSolverr
  (Cloudflare challenge proxy for Prowlarr), TMDB API v3 (catalog), Jellyfin or Plex (media
  server, runs outside the stack)

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
- 📤 **Or upload what you already have**, resumable, up to tens of gigabytes, straight from the
  browser: one file for a film or an episode, or a whole season's episodes at once from the season
  header, matched to their episodes by `SxxEyy` like any season pack.
- 🪞 **A title you already own isn't re-downloaded.** Registering something reconciles it against
  your media server first: if your media server already has the film — or some of the episodes — they come
  in as complete, not missing.
- 🎬 **Shorts are sorted for you.** A film under 40 minutes on TMDB is registered as a short and
  filed in its own library folder; you can reclassify it from its detail page.
- 🎨 **Live action, anime or CGI** is worked out from TMDB genres and keywords when a title is
  registered, and you can correct it per title. The encoder tunes itself to it.
- 🗝️ **No TMDB key yet? The home page walks you through getting one.** A fresh install shows a
  short, privacy-first tutorial instead of an empty screen, and a key TMDB rejects brings the same
  guide back with a notice.
- 🚦 **A first-step page for a fresh install.** `/first-step`, admin only, puts both setup jobs in
  one place: getting a TMDB key, and getting Prowlarr usable — sign in, add an indexer, and add a
  second one tagged `flaresolverr` for a Cloudflare-fronted tracker. It reports how many indexers
  are configured and whether Prowlarr answers at all, without ever treating "not reachable yet" as
  an error.

### Acquire
- 🌐 **Indexer search through Prowlarr**, for a film, one specific episode or a whole season, with a
  **FlareSolverr** proxy pre-registered for Cloudflare-fronted trackers. Every row Prowlarr returns
  survives the trip: nothing is dropped for missing metadata.
- 🏆 **"Best candidates"** re-ranks the results the way an automatic picker would, so you can see
  the shortlist instead of reading release names one by one.
- 🤖 **Optional automatic acquisition.** Two daily sweeps an admin can enable pick the top-ranked
  release and attach it for you. For series, newly aired episodes are picked up on their own. For
  films, each user marks which windows they care about in `/preferences`: theatrical (2 days after
  release, any quality), digital (1 day, WEB-DL or better) and physical (5 days, UHD or remux). A
  quality floor vetoes releases below it before the best tier is chosen.
- ⚡ **Repeat searches are cached** for ten minutes, so re-opening the modal doesn't hammer your
  trackers.
- ⬇️ **Downloads through qBittorrent**, each with its own save path, with live progress and speed in
  the UI and start/stop/delete from Perceptor itself. A title can race several sources at once —
  the first one to finish wins, the losers are demoted.
- 🗑️ **Deleting a source deletes it everywhere.** A running encode is cancelled, its queue entries
  are withdrawn and the download is cleaned up. The finished library is never touched.
- 🔁 **Adding the same torrent twice is harmless.** Re-adding a release already attached to the
  same title is a no-op, not a second download over the first one's folder.
- 🩺 **A failed source says why, and resumes where it broke.** An errored download shows its last
  error, and Play picks it back up from the stage that failed — the file is never downloaded again.
- ♻️ **A finished title can be replaced.** A bad cut, a broken encode or the wrong language isn't a
  dead end: point a new torrent or a new upload at it and it supersedes what's there.
- 🔑 **No API-key copy-paste on a fresh checkout.** The installer generates Prowlarr's key and the
  container adopts it before boot.

### Process
- 🎞️ **Everything to AV1** via `libsvtav1` — H.264, HEVC, VC-1 and oversized AV1 alike — audio to
  Opus. The administrator picks a **resolution ceiling** (4K, 1080p, 720p, 480p or 360p): anything
  above it is downscaled to fit, nothing is ever upscaled, and only AV1 that already fits is copied
  untouched.
- 🌈 **HDR survives.** HDR10, Dolby Vision and HLG keep their colour tags through the encode, scaled
  or not — never flattened to SDR.
- 🗣️ **Language preferences you choose**, at three levels that merge rather than override: the
  installation default, your own account preferences, and extra languages on one specific title.
  **Audio and subtitles are chosen separately** — original audio plus Spanish subtitles is a thing
  you can actually ask for. Each title's page states which languages will *actually* be used and
  marks the ones it inherited from your account, so the answer isn't buried in three settings
  screens.
- 🌎 **Regional variants are first-class.** `es-419` and `es-ES` are different preferences, and the
  encode picks the right one instead of guessing from the track title.
- 🧠 **Decisions made from the container, not the filename.** Remux vs. web-grade quality comes from
  `ffprobe` metadata, so a badly named release still gets the right treatment.
- 📦 **Season packs fan out correctly**: every file is enumerated, matched to its episode by
  `SxxEyy`, and each becomes its own job — cleanup waits for the whole pack, not the first episode
  to finish.
- ☑️ **Files you deselected in qBittorrent are ignored.** A skipped file still takes its full size on
  disk, but it is never mistaken for the release.
- 💬 **You choose which subtitle formats survive.** Settings → Compression lists text formats (SRT,
  ASS, WebVTT, mov_text) and image formats (PGS, VobSub, DVB) separately. Per language, text wins
  over image; text tracks are written as SRT, image tracks are copied as-is — or keep none at all.
- 🔤 **Track titles in their own script.** Audio and subtitle tracks are labelled `English`,
  `日本語`, `한국어` and so on, so any player shows a readable name.
- 🔕 **Compression is optional.** Turn it off from Settings and the pipeline still renames, moves
  and files the release — it just never invokes FFmpeg.
- 🏷️ **Every transcoded file records where it came from.** A `title` tag for players, and a
  `PERCEPTOR_SOURCE` tag naming the exact release path — so "which rip is this?" is answerable
  months after the download was cleaned up.
- 📮 **A finished encode is never lost.** If the api is restarting when the worker reports back, the
  worker keeps retrying until it's acknowledged; both outcome mutations are safe to receive twice.
- 🩹 **A crashed encode picks itself back up.** If the worker container dies mid-encode, the job is
  requeued from scratch when the worker boots again. A second crash on the same job marks it as
  failed instead of looping forever.

### Enjoy
- 🗂️ **Automatic filing** into your library layout.
- 🔔 **Media server notification** — Jellyfin or Plex, opt-in from Settings, with the library
  layout (Jellyfin or Plex naming) following your choice — with the path translated
  to what your media server actually sees, plus a local index you can re-sync on demand.
- 🖥️ **Library browsing** for films and series, with a billboard home, a per-series season accordion
  and actions per episode and per season (search, import, add a torrent or a magnet).
- 🪟 **A title page laid out by intent.** Poster, then what you can add to it and what it's about,
  then how it's managed — refresh, remove, how it's classified and which languages apply. The
  language form opens in a modal when you want it instead of taking up the page when you don't.
- 📱 **It reads on a phone.** Every screen was gone over at 375px in both themes: no page-level
  horizontal scrolling, no text below 14px, no form field small enough to make iOS Safari zoom, and
  touch targets sized to be hit with a thumb.
- 🗓️ **Catalog data stays current on its own.** Opt-in sweeps re-sync a series' whole catalog
  (monthly while it continues, every six months once ended, so a revived series' new season
  appears) and re-read films not yet complete, tracking their theatrical, digital and physical
  release dates. They refresh only; they never download anything.
- 🔄 **Refresh a title from its detail page.** It re-reads the catalog from TMDB — for a series,
  every season and episode, adding what's new without deleting anything — and re-checks the media
  server, marking as complete what it holds and as missing what it no longer does. What changed is
  shown inline.
- 📅 **A release calendar** at `/calendar`: a month grid of films, shorts and episodes, grouped per
  series and season with a `completed/total` count and coloured by status.
- 📥 **A global downloads queue** at `/downloads`: every source of every title, filterable, grouped
  by title and paginated, with a sidebar badge counting what is actively in flight. Titles you don't
  hold are visible read-only.
- 🧹 **Removing a title** from its detail page drops it from your library. If someone else still
  holds it, it stays for them; if you were the last owner, everything in flight is unwound first.
  The file already in your library is never deleted.
- 📊 **One status vocabulary.** Queued, downloading, encoding, done — the same words everywhere, so
  two screens never disagree about the same title. The downloads panel shows live progress and
  speed for every torrent, plus how fast FFmpeg is encoding, filterable by completed, working or
  error.
- ⏰ **Scheduled tasks** an admin can enable and pace from Settings, for the work that has to happen
  after registration rather than during it.
- ⚙️ **Settings in the UI**, split into tabs: paths, TMDB key, indexer key, media server,
  compression (resolution ceiling and subtitle formats), scheduling, and which media types are enabled. A read-only **Environment** tab
  shows how the installation is reachable and flags an upload URL that doesn't match your domain.
  **Disabling films or series actually
  disables them** — sidebar, billboard, search and routes all follow, while anything already in the
  pipeline is allowed to finish.
- 🙋 **Per-user preferences** at `/preferences`: interface language, audio and subtitle languages,
  and the torrent groups you care about.
- 👥 **User management**: create, edit and disable users (disabling revokes live sessions
  immediately, not just the next login), with `bin/reset-password` (or, from an install directory,
  `docker compose exec api node dist/scripts/reset-password.js <user>`) as the recovery path when nobody
  can sign in. For the admin it also resets the qBittorrent and Prowlarr logins.

## Install

You need Docker with the Compose plugin, **running** — on macOS and Windows that means Docker
Desktop open and reporting `Engine running`, on Linux `systemctl start docker`. Nothing else — no
Node, no git checkout, no clone. The published images are built for **`linux/amd64` and
`linux/arm64`** natively — this covers Apple Silicon Macs, Windows on ARM, Raspberry Pi 5 and
ARM VPS instances alike, with no emulation. The installer checks the Docker engine's own
architecture before asking anything and stops with a clear message on anything else.

Make an empty directory and run:

```bash
curl -fsSL https://raw.githubusercontent.com/dientuki/perceptor/master/install.sh | bash
```

It downloads `docker-compose.yaml` and `.env`, asks five questions — download folder, library
folder, admin user, admin password, Traefik yes/no (plus the domain and whether to serve HTTPS if
yes) and optionally your TMDB key — and derives everything else itself: `PUID`/`PGID`, the group that owns your library, your
timezone, free host ports, and the secrets (`JWT_SECRET`, `SERVICE_TOKEN`, `INDEXER_API_KEY`, the
database password). Then it pulls the published images from GHCR and starts the stack.

When it finishes, the directory holds `docker-compose.yaml`, `.env` and — once the stack has run
once — `./backups`. No source, no `bin/`, no `services/`. Sign in with the admin credentials you
chose; if you skipped the TMDB key, the home page shows how to get one — paste it in **Settings**
before searching.

Two things it does for you on every start, not just the first:

- **`api` applies its own pending migrations and production seed before it starts listening.** `web`
  and `worker` wait on its health check, so neither ever observes a half-migrated database. Set
  `PERCEPTOR_AUTO_MIGRATE=false` in `.env` to opt out and run them yourself.
- **The database is dumped first.** A one-shot `backup` service writes to `./backups` and keeps the
  five most recent; `api` will not start if the dump fails.

### HTTPS

With Traefik and a domain, the installer can also serve HTTPS from a **local certificate
authority**. A one-shot `certs` service creates the CA in `./certs` once — it is never regenerated —
and issues the certificate Traefik serves; plain HTTP keeps working alongside, with no redirect.
Trust `certs/ca.crt` on every device that opens Perceptor over HTTPS; it is also served without
login at `/ca.crt` and linked from **Settings → Environment**, so a phone can fetch it over plain
HTTP. The CA is pinned to your domain: changing `DOMAIN` means deleting `./certs` and trusting the
new `ca.crt`.

Re-running the installer over a live installation repairs rather than replaces: it fills in what's
missing and leaves every title, setting, user and password alone.

### Updating

Versions are pinned in `.env` as `PERCEPTOR_TAG`, which applies to all five images at once — there
is no per-service tag, and a mixed set fails at runtime. Name the version you want, then:

```bash
docker compose pull && docker compose up -d
```

Migrations and the backup run on the way up, as above. Rolling back is naming the previous tag and
repeating the same two commands.  

## Working method

Perceptor follows **spec-driven development**. `docs/spec/features/` holds one directory per
feature, each with a `spec.md`: requirements, the GraphQL contract delta and acceptance criteria.
Most also have a cross-service `plan.md`, one plan per service and a `tasks.md`. A spec is required
whenever a change touches more than one service, the Prisma schema, the GraphQL contract or a
pipeline stage. Several specs open with the real incident that motivated them.

- **The GraphQL contract is frozen before implementation.** There is no codegen between `api` and
  its consumers: `web` and `worker` retype the schema by hand, so an unannounced change fails at
  runtime, not at compile time. Each spec's contract delta is approved first and stays read-only
  while services implement it ([`docs/spec/graphql-contract.md`](docs/spec/graphql-contract.md)).
  On the `api` side, the schema is generated code-first from decorators and never edited by hand.
- **A versioned constitution.** [`docs/constitution.md`](docs/constitution.md) holds twelve articles
  that outrank every other document, such as "GraphQL is the only contract", "no spec, no code" and
  "the library is never deleted". Each article ends with a **Check** line saying how to verify it.
  The document is versioned with semver and keeps a changelog.
- **Development with Claude Code, scoped per service.** The root [`CLAUDE.md`](CLAUDE.md) and one
  `CLAUDE.md` per service (`api`, `web`, `worker`) document the codebase. [`.claude/commands/`](.claude/commands/)
  implements the `/specify` → `/plan-feature` → `/tasks` → `/implement` flow, and
  [`.claude/agents/`](.claude/agents/) defines one implementer per service that writes only inside
  its own service. `/implement` dispatches the tasks and verifies the diff after each batch.
- **Docker-first.** Nothing runs on the host — no host Node, no local MariaDB or Redis. Every
  command goes through a wrapper in `bin/`, and source is bind-mounted so every service hot-reloads.

## Design decisions

```
                       :80 / :443
                           |
                       traefik (opt-in per service via labels)
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

A one-shot `backup` service dumps the database before `api` starts, and, with HTTPS on, a one-shot
`certs` service issues Traefik's certificate before it starts.

- **`api` is the only source of truth.** `web` and `worker` never touch the database — everything
  goes through `api`'s GraphQL endpoint, so Prisma, business rules and authorization live in one
  place. The one deliberate exception is the resumable [tus](https://tus.io) upload endpoint,
  because a 40 GB file doesn't fit in a GraphQL mutation.
- **The worker has no ingress.** It publishes no ports and consumes two BullMQ queues, `process`
  (scan) and `encode`, each with its own `Worker`, so an encode that runs for hours never holds up a
  scan. Results go back to `api` as GraphQL mutations; cancellation arrives on a Redis pub/sub
  channel.
- **JWT auth with a machine credential.** The worker and qBittorrent's completion hook authenticate
  with a non-expiring service token minted from `JWT_SECRET`; `api` refuses to boot without one.
- **Download completion is an event, not polling.** qBittorrent's AutoRun hook runs
  `services/torrent/commands/on-torrent-completed.sh`, which calls the `torrentCompleted`
  mutation. Apollo answers an auth failure with HTTP 200 and an `errors` array, so the script checks
  both the status code and the body.
- **Reports survive an `api` restart.** The worker retries an outcome report with backoff (5 s, up to
  60 s) only while `api` is unreachable; a rejection `api` actually answered is final. Both outcome
  mutations are safe to receive twice.
- **Media servers are a registry, not a conditional.** Adding one is a module exporting a factory
  plus one line in `services/api/src/clients/media-server/registry.ts`. The Settings options,
  server-side validation and UI selector all derive from that map.
- **Reproducible images.** Each Node service has a multi-stage Dockerfile (`base` / `dev` /
  `builder` / `prod`) and a deny-list `.dockerignore` that keeps `.env*` and host build artifacts out
  of the build context, so images build from a clean checkout with no secrets inside.
- **Compose overlays separate runtime from development.** `docker-compose.yaml` is the runtime and
  only pulls published images. `docker-compose.build.yaml` adds build contexts and stage-qualified
  local tags, and `docker-compose.dev.yaml` adds the source bind mounts.
- **No `NEXT_PUBLIC_*` in the browser bundle.** The upload endpoint is read by a Server Action at
  request time instead of being inlined at build time, so the same `web` image works in any
  deployment.

## Pipeline

1. **Search.** `web` asks `api`, which searches TMDB for films and series in a single list.
2. **Decision: choose the title.** A user registers it. `api` fetches a series' seasons and
   episodes, classifies the title (short, live action / anime / CGI) and checks the media server,
   so anything already there comes in as complete.
3. **Release search.** `api` queries Prowlarr (through FlareSolverr for Cloudflare-fronted
   trackers), groups rows by info hash and caches repeat queries in Redis for ten minutes.
4. **Decision: choose the release.** The user picks a result — or pastes a magnet, or uploads a file.
5. **Download.** `api` adds the torrent to qBittorrent with a per-title save path. A title can race
   several sources; the first to finish wins.
6. **Completion.** The AutoRun hook calls `torrentCompleted`; `api` settles the race and enqueues a
   `process` job.
7. **Scan.** The worker enumerates the files, keeps only what was actually downloaded, matches
   episodes by `SxxEyy` and reports back; `api` enqueues one `encode` job per file.
8. **Transcode.** Driven by `ffprobe`, not the filename: every recognized codec to AV1, downscaled
   to the configured resolution ceiling with HDR preserved, tuned for live action, anime or CGI,
   audio to Opus, tracks selected by language preference. With compression
   off, the file is only renamed and moved.
9. **File and notify.** The output lands in the library, the worker reports `encodeCompleted`, and
   `api` notifies your media server with the host-side path.

The two decisions stay with a person on purpose:

- **The title**, because libraries are per user and nothing downstream runs — indexer queries, disk,
  hours of encoding — until someone decides the title belongs in theirs.
- **The release**, because automatic selection is the goal but not yet trusted to act unattended, apart from the opt-in daily sweeps.
  "Best candidates" shows the set the picker would choose from, so its behaviour can be checked
  against real result lists first. Since the output is re-encoded anyway, the question is which
  release is the best input to the transcoder, not the best file to watch.

## Running from source

For working on Perceptor rather than using it. This path builds every image locally and bind-mounts
your working copy, so edits hot-reload.

1. **Clone**
   ```bash
   git clone https://github.com/dientuki/perceptor.git
   cd perceptor
   ```

2. **Generate `.env`**
   ```bash
   bin/install
   ```
   Creates `.env` from `.env.example`, asks whether to route through Traefik, generates the secrets
   that matter (`JWT_SECRET`, `SERVICE_TOKEN`, `INDEXER_API_KEY`) and grants Prisma the privileges
   its shadow database needs. Say no to Traefik unless you want domain-based routing — it needs a
   resolvable hostname for `web`/`api`/`torrent`/`indexer`. Then fill in the rest: ports, DB
   credentials, admin user, download and library paths.

3. **Build the dev images**
   ```bash
   bin/build dev
   ```

4. **Bring the stack up**
   ```bash
   bin/dev
   ```
   Reads `USE_TRAEFIK` from `.env` to decide whether to include Traefik. Without
   Traefik, reach each service directly: `http://localhost:${WEB_PORT}`,
   `http://localhost:${API_PORT}/graphql`. First boot installs each service's `node_modules` into
   your working copy — that's intentional, and it's what your editor's TypeScript server reads.

   `bin/dev` starts the images that already exist and does **not** build. Re-run `bin/build dev`
   whenever a `Dockerfile` or a dependency changes; source edits alone don't need it.

5. **Sign in** as `ADMIN_USER` with the password you typed during install (it is never stored in `.env`) and open **Settings** to paste your TMDB API key —
   a fresh checkout ships it empty, and the home page shows a tutorial for getting one until you do.

The schema is applied for you: `api` runs its pending migrations at boot here too. `bin/dbinit` is
the one thing you may still need by hand, on a fresh `db` volume, before `prisma migrate dev` can
create its shadow database.

Local builds are tagged `perceptor-<svc>:local-dev` and `perceptor-<svc>:local-prod` — a name that
exists in no registry and records the stage it came from, so a `dev` and a `prod` build of the same
service can never shadow each other. `torrent` and `indexer` are single-stage and keep a plain
`perceptor-<svc>:local`.

> **Upgrading an existing checkout?** Run `bin/install` again and answer *no* to regenerating `.env`.
> It fills in any missing secrets without touching what you already configured. `api` will not boot
> with `JWT_SECRET` unset — that's by design.

## Day-to-day commands

These are for a source checkout — an installation made with `install.sh` has no `bin/` and uses
`docker compose` directly. Nothing runs on the host, so always go through the wrappers — each one
checks for a reachable Docker engine first (`bin/_docker.sh`), so a stopped daemon says so instead
of failing halfway through:

| Command | What it does |
| :-- | :-- |
| `bin/install` | Generate `.env`, configure Traefik/domain, mint secrets, grant Prisma its privileges |
| `bin/build <dev\|prod> [service]` | Build images without starting anything; no service builds all five |
| `bin/dev [args…]` | Bring the stack up in dev mode from the existing `local-dev` images; extra arguments go to `docker compose up` (pass `-d` yourself to detach) |
| `bin/prod` | Bring the stack up in prod mode (`prod` stage, rebuilds first) |
| `bin/stop [-y]` | Stop this directory's stack, then offer to stop any Perceptor container still running outside it (another checkout, an end-user install directory). Stop only — nothing is removed, no volume touched |
| `bin/cli <service> <cmd…>` | Run any command inside a running container |
| `bin/npm [service] <args…>` | npm inside a service (defaults to `web`) |
| `bin/bash <service>` | Interactive shell in a container |
| `bin/mysql [args…]` | MariaDB client against `db` |
| `bin/dbinit` | Grant Prisma its privileges (once, per fresh `db` volume) |
| `bin/dbreset` | Reset the schema, reseed, and flush Redis — dev state only |
| `bin/reset-password <user>` | Reset a user's password — the recovery path when no admin can log in; for `ADMIN_USER` it also resets qBittorrent and Prowlarr |

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

## Troubleshooting

### `Cannot connect to the Docker daemon` — Docker is installed but not running

The installer stops before asking anything:

```
Docker is installed but its engine is not running.
```

Having the `docker` command is not the same as having the engine behind it: both the CLI and the
Compose plugin answer perfectly well with the daemon stopped, which is why the installer checks for
the engine itself rather than trusting `docker compose version`. Start it and run the installer
again:

- **Docker Desktop (macOS, Windows):** open the app and wait until the status reads
  `Engine running`. Installing Docker Desktop does not start it, and it does not start at login
  unless you turn that on in **Settings → General**.
- **Linux:** `sudo systemctl start docker`, plus `sudo systemctl enable docker` so it comes back
  after a reboot.

`docker run hello-world` is the one-line confirmation that the engine is reachable before you try
again. An older installer (before this check existed) would ask all five questions first and only
then fail on `Cannot connect to the Docker daemon at unix:///var/run/docker.sock` — the cause is the
same, and re-running the installer after starting Docker picks up where it left off without losing
the answers already written to `.env`.

### `no matching manifest for linux/arm64/v8 in the manifest list entries` — unsupported engine architecture

This came from a pre-`083` installer pulling images that only existed for `linux/amd64`. The
current installer checks the Docker engine's own reported architecture (not the host CPU, since
the engine may be remote) before asking anything, and stops with:

```
Docker's engine reports an architecture Perceptor does not publish images for: <detected>.
Supported architectures: x86_64, aarch64.
```

The published images cover `linux/amd64` and `linux/arm64`, which is every Mac, Windows machine
and ARM host in ordinary use — Windows on x86 runs containers through WSL2 (`linux/amd64`, already
published) and does not need the arm64 image at all. If you still see the raw `no matching
manifest` error on a current installer, re-run `curl -fsSL
https://raw.githubusercontent.com/dientuki/perceptor/master/install.sh | bash` in the same
directory — it is reentrant and will not overwrite anything already written to `.env`.

### `EACCES: permission denied, mkdir '/media/library/...'` — the library is a separate disk

An encode finishes and then fails at the very last step, when it creates the destination folder:

```
[worker] encode falló job-300: Error: EACCES: permission denied, mkdir '/media/library/Movies'
```

This is a risk on any host where `HOST_DESTINATIONS_DIR` is not on the same filesystem as the rest
of the installation — a second internal disk, an external or USB drive, an NFS/SMB share. An
external drive is the likeliest case of all: it mounts later than an internal one, and it may not
be plugged in when the machine boots at all. Check what the container actually sees:

```bash
docker compose exec worker ls -lan /media/library
```

An empty, `root:root` directory means the containers are not looking at that disk at all. Docker
bind-mounts a path, not a filesystem: if the stack starts before the disk is mounted, it binds the
empty mountpoint stub underneath, and the container stays pinned to it for its whole life — the
disk mounted a minute later is invisible inside it. On a reboot this is a race between
`docker.service` and the mount unit, and an `fstab` entry marked `nofail` is not ordered before
Docker, so it can lose. `journalctl -b` shows it:

```
01:26:34  dockerd  starting container   <- binds /mnt/perceptor
01:27:43  systemd  Mounted /mnt/perceptor.
```

Restarting the containers with the disk already mounted fixes it — the mounts are rebuilt on every
start, not only when the container is created:

```bash
docker compose restart
```

To stop it happening on the next boot, order Docker after the mount (`sudo systemctl edit
docker.service`, substituting your own path):

```ini
[Unit]
RequiresMountsFor=/mnt/perceptor
```

The `api` mounts the same path read-only, so while this is broken it also reports an empty library
when reconciling against the media server.

## Known limitations

Rough edges, stated plainly:

- **Automatic acquisition is opt-in and basic.** The daily sweeps take the top-ranked release
  ("best candidate") for newly aired episodes and for films inside a window you marked; there is
  no manual review step and no upgrade later. Everything else is still picked by a human.
- **AV1 encoding is CPU-bound by design** — no current consumer GPU encodes AV1 in hardware, and
  the pipeline has no GPU-accelerated stage of any kind.
- **Which indexers sit behind Cloudflare is a manual call.** The FlareSolverr proxy is registered
  automatically, but tagging the indexers that need it stays a step in Prowlarr's UI.
- **Jellyfin and Plex are the only media server clients**, and both are expected to run outside
  this stack. Plex is index-backed and falls back to a full refresh when a path-scoped scan can't
  be done.
- **Libraries don't overlap.** Each user sees only their own titles; a title someone else registered
  answers "not available for this user" rather than rendering. There is no shared or household
  library. The one exception is the `/downloads` queue, which shows every title's sources to any
  signed-in user, read-only for the ones they don't hold.
- **No quality profiles, no upgrade loop.** Perceptor normalizes what it gets rather than chasing a
  better release later — a deliberate omission, not a backlog item.
- **The installer only knows how to repair a *finished* installation.** Re-running `install.sh`
  treats "there is a `.env`" as "the previous run completed", so an install interrupted partway
  leaves a `.env` it will skip rather than finish. Delete the directory and start over.

## Responsible use

Perceptor is intended for managing media you have the rights to download, store and transcode.

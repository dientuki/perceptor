# Perceptor

Self-hosted media automation. A user searches a title, Perceptor registers it, finds a release,
downloads it, transcodes it with FFmpeg and files the result in a library.

Pipeline stage status today:

| Stage | Where | Status |
| :-- | :-- | :-- |
| Search catalog (TMDB) | `api` — `src/media/` (dispatch + `searchMedia`/`addMedia`), `src/movies/movies.service.ts`, `src/shows/shows.service.ts`, `src/clients/tmdb/{client,types}.ts` | working for films and series, per-user library, parameterized by media type (`006-media-search`) |
| Register title in DB | `api` — `media`/`movies`/`shows` modules + Prisma | working (read + CRUD service); a registered series also fetches its seasons/episodes in the background |
| Find release (indexer) | Prowlarr — `indexer` service in `docker-compose.yaml`, `flaresolverr` service for Cloudflare-fronted trackers, `api` — `src/clients/indexer/client.ts` | working for both a film and a single episode; a fresh checkout needs no manual API-key paste or Prowlarr UI step — `bin/install` declares `INDEXER_API_KEY` and the `indexer` container adopts it before boot, pre-registering a FlareSolverr proxy the same way (`014-dev-stack-flaresolverr`); a failed indexer call now surfaces as an error in the search dialog instead of an empty result list; alternativa manual: pegar un magnet (`addMagnetToMovie`/`addMagnetToEpisode`, `src/clients/torrent/magnet.ts`) — mismo `MediaSource`/AutoRun de ahí en más |
| Download | qBittorrent — `torrent` service, `api` — `src/clients/torrent/client.ts` | working, per-torrent save path, for both a film and a single episode (`010-episode-acquisition`) |
| Detect completion, update DB, enqueue job | `api` — `src/downloads/` (`torrentCompleted` mutation, BullMQ producer) | working |
| Scan downloaded files, inventory | `worker` — BullMQ consumer, talks to `api` over GraphQL | working for both a single file and a season pack — the worker enumerates every file, flags each `isVideo`, and resolves it to an episode by parsing `SxxEyy` from the file name (a single-file/single-episode source still resolves to the one largest video, as before); the episode name itself comes from the api, never the filename (`013-season-pack-processing`) |
| Transcode | `worker` (FFmpeg) | working — H264/VC-1 to AV1 via `libsvtav1`, HEVC 4K tonemapped to 1080p SDR, audio to Opus keeping one track per allowed language, text subtitles only; remux/quality decided from `ffprobe` metadata, not the filename (`011-av1-transcode`); a season pack fans out into one `ProcessJob` per resolved episode sharing one `MediaSource`, with per-episode-file and whole-folder cleanup timed off the pack's own completion, not the first episode to finish (`013-season-pack-processing`) — acquiring a season pack itself is api-only today (`addMagnetToSeason`), with no web UI yet |
| Notify media server | `api` — `src/media-server/`, `src/clients/media-server/` | working (Jellyfin, opt-in from Settings, default `none`) |
| Browse library | `api` — `src/movies/movies.resolver.ts`, `src/shows/shows.resolver.ts`, `src/episodes/episodes.resolver.ts`; `web` — `/movies`, `/shows` | working for both films and series, each a per-user listing behind its own query (`007-library-listing`); both detail pages (`/movies/<id>`, `/shows/<id>`) are per-user — a title another user owns answers `Recurso no disponible para este usuario` instead of rendering (`008-movie-detail`, `009-show-detail`); the show detail page also renders a season accordion (last season expanded by default) with three per-episode action buttons (buscar, importar archivo, añadir torrent), each wired to a real per-episode acquisition flow (`010-episode-acquisition`) |

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
| `bin/reset-password <username>` | resets a user's password interactively (masked prompt in a TTY session, plain prompt otherwise) | `bin/reset-password admin` — the recovery path when no admin can sign in |

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
`INDEXER_USER`, `INDEXER_PASSWORD`, `INDEXER_API_KEY`,
`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `DATABASE_URL`,
`REDIS_HOST`, `HOST_DOWNLOADS_DIR`, `HOST_DESTINATIONS_DIR`,
`CONTAINER_DOWNLOADS_DIR`, `CONTAINER_DESTINATIONS_DIR`,
`JWT_SECRET`, `SERVICE_TOKEN`.

`JWT_SECRET` signs every JWT the app issues; `api` refuses to boot without it (no default, ever —
`services/api/src/auth/auth.constants.ts`). `SERVICE_TOKEN` is the machine credential the worker
and the qBittorrent AutoRun hook authenticate with — a JWT with no expiry, minted from
`JWT_SECRET`. `bin/install` generates both on a fresh checkout; on an existing `.env` missing
either, `bin/install` fills them in without touching anything else. See
`docs/spec/features/002-auth-login/spec.md` for the full design.

**Upgrading an existing checkout**: pulling this feature without regenerating `.env` means `api`
will not boot (`JWT_SECRET` unset, by design — AC-8). Run `bin/install` again, answering "no" to
regenerating `.env` from `.env.example`, and it fills in `JWT_SECRET`/`SERVICE_TOKEN` alongside
whatever you already had configured. Rotating `JWT_SECRET` afterward invalidates `SERVICE_TOKEN` —
re-mint it with `bin/npm api run token:service --silent` and update `.env`.

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
share one login. Each service's own UI can still change its own credentials afterward. The seeded
`ADMIN_USER` is also the app's first administrator (`isAdmin: true` — see
`003-auth-user-management`): there is no public registration, so every other user is created by an
admin from the `/users` screen. An admin can also disable a user instead of deleting them
(`isEnabled: false` — `004-user-disable`): a disabled user is refused at login and, unlike a plain
flag flip, has every session they currently hold revoked immediately, not just their next login
attempt. If nobody can sign in as an admin, `bin/reset-password` is the recovery path. Every movie
is also linked to whoever has it in their library (`UserMovie`, `005-movie-search`); the migration
that introduced that join backfills every pre-existing film onto the oldest enabled admin, which on
a fresh install is this same seeded account. A series is linked the same way through `UserShow`
(`006-media-search`) — no backfill there, since `shows` was unreachable code before that feature.

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

Note: the TMDB bearer token is **not** an `.env` variable and is not hardcoded in source — it comes
from the `movie_db_api_key` Settings key (`api`'s `src/clients/tmdb/client.ts` reads it from
`SettingsService` on every call), editable from the Settings screen. A fresh install ships it empty,
so `searchMovies`/the TMDB fallback fail with `401 Unauthorized` until an admin sets a real key.

`INDEXER_API_KEY` is Prowlarr's own API key, but unlike the TMDB token it is **not** left for a human
to paste in: `bin/install` generates it (or adopts one already present in the `indexer` volume, so an
upgrade never invalidates a live install), the `indexer` container's
`custom-cont-init.d/10-prowlarr-apikey` writes it into `/config/config.xml` before Prowlarr starts,
and the `api`'s settings seed fills the `tracker_api_key` row from the same variable
(`014-dev-stack-flaresolverr`). A second init script,
`custom-services.d/20-prowlarr-flaresolverr`, then registers a FlareSolverr indexer proxy against
Prowlarr's API pointed at the in-stack `flaresolverr` service — idempotent across reruns and volume
resets — but does **not** attach that proxy's tag to any indexer; deciding which indexers actually
sit behind Cloudflare stays a manual step in Prowlarr's UI.

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
| `/tasks NNN` | `tasks.md` — atomic tasks, each tagged `[api]`/`[web]`/`[worker]` for a service agent, or `[docs]`/`[orch]` for the two the orchestrator does itself, with dependencies |
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

Measured 2026-08-18, after `014-dev-stack-flaresolverr` landed. Re-run the typechecks rather than
trusting the counts — the numbers are what an agent reports before and after a change to prove it
added nothing.

**`api` — clean, 0 errors.** `bin/cli api npx --no tsc --noEmit`. `014-dev-stack-flaresolverr` added
a sixteenth suite, `src/clients/indexer/client.spec.ts` (the `ServiceUnavailableException` REQ-15
guards `getData` gained against a non-success indexer response). Tests are now **156** across **16**
suites (`bin/npm api test`, run 2026-08-18). `services/api/CLAUDE.md` has the module-by-module
detail.

**`web` — 11 errors across 4 pre-GraphQL files**, none on a path the running UI uses:
`components/import/importFolderModal.tsx` and `ImportMagnetSeasonModal.tsx` (both import a
non-existent `@/actions/jobs`, both pass `value` to a component that only takes `defaultValue`),
`SearchForm.tsx` and `ResultsForm.tsx` (missing `@/icons`, implicit `any`).
`services/web/CLAUDE.md` has the table. `010-episode-acquisition` closed
`SearchTorrentModal.tsx`'s `@prisma/client` import (a Constitution Article II violation), taking
the count from 12/5 files to 11/4; every feature since has verified it stayed there —
`013-season-pack-processing` has no `[web]` tasks by design and did not touch this count.
`bin/npm web run build` still fails on the 4 remaining files (`next.config.ts` sets no
`ignoreBuildErrors`), independently of anything any of these features touched.

**`worker` — clean, 0 errors.** `013-season-pack-processing` split
`scan-folder.ts`'s old two-jobs-in-one (enumerate + pick a winner) into enumeration-only plus two
new pure modules, `scan/parse-episode.ts` and `scan/select-matches.ts`, each with its own spec, and
extended `cleanup-source.spec.ts` for the three newly-gated cleanup flags. Tests are now **75**
across **9** suites (`bin/npm worker test`, run 2026-08-18) — up from the 57/7 `011-av1-transcode`
left behind. See `services/worker/CLAUDE.md`.

## Known debt

- The database DSN is hardcoded in `services/api/src/prisma/prisma.service.ts` even though
  `DATABASE_URL` already exists in `.env`.
- `services/api/prisma/schema.prisma` declares `datasource db` with no `url` — the connection
  comes solely from the driver adapter.
- **The string `movieId` means two different things depending on where it appears.**
  `006-media-search` already renamed `MediaSearchResult.movieId` → `mediaId` where the field came to
  mean "film or series", but three occurrences were deliberately left alone because there it still
  means "a film, specifically": the argument on `addTorrentToMovie`/`addMagnetToMovie`/
  `createUploadTicket`, the **tus upload metadata key** (`web` writes it in
  `services/web/src/components/import/importFileModal.tsx`, `api` reads it in
  `services/api/src/uploads/uploads.service.ts`), and `MediaSource.movieId`, which the worker reads
  in `services/worker/src/jobs/source-ready.job.ts`. `010-episode-acquisition` adds `episodeId`
  *beside* `movieId` rather than generalising, precisely because the rename crosses all three
  services with no codegen between them — a partial rename breaks the download pipeline at runtime,
  with no compile error anywhere. Unifying them is worth doing; `docs/spec/graphql-contract.md`
  is the document that has to move first. **Planned for the week of 2026-08-17.**

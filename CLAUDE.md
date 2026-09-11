# Perceptor

Self-hosted media automation. A user searches a title, Perceptor registers it, finds a release,
downloads it, transcodes it with FFmpeg and files the result in a library.

Every pipeline stage below is working today, for both films and series. The spec refs point at
`docs/spec/features/<NNN-slug>/` for the design detail; the service `CLAUDE.md` files have the
implementation detail.

| Stage | Where | Specs |
| :-- | :-- | :-- |
| Search catalog (TMDB) | `api` — `src/media/`, `src/movies/`, `src/shows/`, `src/clients/tmdb/`; `web` — the header search box and `/search`. Since `045`, the installation-wide `movies_enabled`/`shows_enabled` Settings are no longer write-only: `api`'s `mediaCapabilities` query exposes them to every user and refuses a disabled type at `searchMedia`/`popularMedia`/`addMedia`; `web` reads the pair to filter the sidebar, the billboard, the search placeholder/results and the `/preferences` tabs, and to 404 `/movies(/add)`/`/shows(/add)` — system-wide, identical for every user, and never refused for work already in flight. Since `048`, `mediaCapabilities` carries a third, subordinate `shortsEnabled` (`movies_enabled && shorts_enabled`); a film already registered as a short is badged in search results (never inferred — TMDB's search endpoints carry no `runtime`), and a search result can be registered directly into the new "Cortos" category via `addMedia(asShort:)` | `005`, `006`, `026`, `045`, `048` |
| Register title in DB | `api` — `media`/`movies`/`shows` + Prisma; a new series fetches its seasons/episodes in the background; a registration also reconciles the title against the configured media server, promoting `MISSING` to `COMPLETED` (per episode for a series) when that server already holds it; a scheduled sweep (`scheduler/`'s `refresh_episodes` task, opt-in) also writes back title/overview/air-date for episodes still in flight, days after registration. Since `048`, a film carries an `isShort` boolean (`Movie.isShort`, default `false`) — set at registration via `addMedia(asShort:)` or later from the film's own detail page via `setMovieShort`, never inferred and never a per-user classification | `006`, `034`, `041`, `048` |
| Find release | Prowlarr (`indexer`) + `flaresolverr`, `api` — `src/clients/indexer/client.ts`; every Prowlarr row survives the search, grouped by `infoHash` (or a derived key when the indexer supplied none) rather than dropped for missing metadata — `infoHash` is resolved lazily, only for the release the user actually adds (`src/clients/indexer/resolve-info-hash.ts`); a repeat search for the same (normalized) query inside 10 minutes is served from Redis instead of re-querying Prowlarr, read-through in `src/indexer/indexer.service.ts` (`040`); manual fallback is pasting a magnet (`src/clients/torrent/magnet.ts`); `web` — a "Best candidates" toggle in the movie detail page's torrent modal re-ranks the already-fetched list client-side (`src/lib/torrent-ranking.ts`), hiding everything below the best resolution tier — a harness for eventually picking automatically, not a fetch of new results. Since `053`, the indexer client writes `infoHash` lowercase (it used to uppercase Prowlarr's own hash), matching the other two write paths — qBittorrent reports and accepts lowercase only, so the mismatch was silently losing live status for indexer-sourced rows | `010`, `014`, `036`, `037`, `040`, `053` |
| Download | qBittorrent (`torrent`), `api` — `src/clients/torrent/client.ts`, per-torrent save path; no longer fire-and-forget — `api` reads live progress/speed back and starts, stops and deletes torrents on the user's behalf, and a title may race several sources at once. Since `047`, one delete means one delete for the whole pipeline, not just the torrent: `downloadDelete` accepts an uploaded file too (no longer torrent-only), cancels a running encode over a dedicated Redis channel (`encode:cancel`), withdraws every queue entry, and removes the source's downloads-side residue — confined to the downloads root, never the library (constitution Article XII) | `010`, `022`, `047` |
| Detect completion, enqueue | `api` — `src/downloads/` (`torrentCompleted` mutation, BullMQ producer); a shared race arbiter also runs from the tus upload path, since an uploaded file competes in the same race as any torrent of its target — an upload always demotes a `READY`/`SCANNED` sibling of its own target rather than deferring to it, and a losing upload gets a `409` instead of being silently ignored; both outcome mutations the worker reports back through (`encodeCompleted`/`encodeFailed`) are safe to receive more than once, which is what lets the worker retry a lost report until `api` acknowledges it. Since `052`, `sourceScanned`'s empty-match branch distinguishes two causes with two distinct keys: `error.source.scan_no_video` (no video found or resolved, unchanged) versus `error.source.scan_no_downloaded_video` (video was found but none of it has content — every candidate was deselected in the torrent client) | `022`, `038`, `052` |
| Scan files, inventory | `worker` — enumerates every file, resolves episodes by parsing `SxxEyy`; episode names come from the api, never the filename. Since `052`, a torrent-sourced scan also takes the list of files the torrent client actually downloaded (`api`'s `MediaSource.downloadedFiles`, `null` for a non-torrent source) as an extra input, narrowing the candidate set to files with real content before either selection rule runs — a file deselected in qBittorrent keeps its full announced size on disk with none of its bytes, and would otherwise win the "largest file" race | `013`, `052` |
| Transcode | `worker` (FFmpeg) — H264/VC-1 to AV1, HEVC 4K downscaled to 1080p preserving HDR (Dolby Vision/HDR10 keep their colour tags rather than flattening to SDR), Opus audio; decided from `ffprobe`, not the filename. One code path, on CPU, on every host. A season pack fans out into one `ProcessJob` per episode. Optional per installation — an administrator can turn compression off from Settings, in which case the file is still renamed and moved to its destination, just never touched by FFmpeg. Since `046`, every transcoded output also carries two container-level tags — `-metadata title=<film title or "Series SNN-ENN Episode title">` (verbatim from TMDB, decorative) and `-metadata PERCEPTOR_SOURCE=<release path relative to the downloads root>` (a provenance record of the exact source release); neither is written when compression is off. Since `047`, an encode can be abandoned mid-flight — a required `AbortSignal` on the `EncodeFn` driver seam, triggered by the api's `encode:cancel` publish when the source that requested it is deleted; the worker terminates whichever process it has running and reports no outcome. The destination
itself is unconditionally an `api` decision the worker consumes blindly: since `048`, a film flagged
`isShort` files under the `path_shorts` folder instead of `path_movies` (resolved once, at the moment
the worker asks for the job's details — reclassifying a film never moves a file already written).
Since `051`, the native-script track title burned into each audio/subtitle track (`English`, `日本語`,
`한국어`, …) is read from `api`'s `Language.trackTitle` column once per job rather than hard-coded in
the worker — an unreachable `api` or an unseeded language degrades to the bare ISO code, never fails
the encode; only the regional-Spanish variant titles (`Latino`, `Español (España)`) stay worker-local.
Since `053`, the worker also reports FFmpeg's own realtime multiplier (`speed=1.23x` off the same
`-progress pipe:1` stream) alongside the progress it already reports, on the same throttled
cadence — decoration, never load-bearing: a missing or unparseable speed never fails or slows an
encode, and `api` derives it as non-null only while a job is actually `ENCODING`, never from a
completed/failed/cancelled one's last stored value. Since `054`, an encode interrupted by a hard
crash — the worker container dying mid-FFmpeg with no time to write anything — recovers rather than
sitting on "encoding" forever: `worker` announces its own boot to `api` (`encodeWorkerStarted`,
before either BullMQ `Worker` is constructed, sound only because exactly one `worker` container
runs) and `api` reconciles every `ProcessJob` still reading `ENCODING` at that moment, since a
process that has just started is encoding nothing. A job is requeued from scratch (its
`.working.mkv`/`.part.mkv` scratch cleared unconditionally before every encode, not only a
recovered one) once automatically; a second orphaning of the same job fails it outright rather than
looping forever on a host the encode itself keeps crashing. `docker compose restart api` alone
never touches a live encode — the signal is the worker's boot, never the api's. A small BullMQ
retry budget (`attempts: 2`, a 5-minute backoff) separately covers the narrower case of a stall
BullMQ's own heartbeat detects while the worker's container survives; it never retries a
cancellation or a diagnosed failure, both rethrown as non-retryable so `047`'s delete-mid-encode
guarantee is unaffected |
`011`, `013`, `024`, `031`, `032`, `042`, `046`, `047`, `048`, `051`, `053`, `054` |
| Notify media server | `api` — `src/media-server/`, `src/clients/media-server/` (Jellyfin, opt-in, default `none`); no longer write-only — a local index (`src/media-server-index/`) lets a client with no native provider-id lookup answer "does this title exist" too, rebuilt on demand from Settings or a "Re-sincronizar" button in `web` | `034` |
| Browse library | `api` — the three resolvers; `web` — `/`, the billboard, plus `/movies`, `/shows` and their detail pages, all per-user | `007`, `008`, `009`, `010`, `033` |

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
docker-compose.yaml      the runtime — pulls the five published images, no build: section
docker-compose.build.yaml  the build: sections + local image tags, loaded by bin/dev/prod/build/install
install.sh               end-user installer — curl this into an empty directory with just Docker
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
| `bin/install` | generates `.env` from `.env.example`, asking Traefik y/n + domain — the **developer** installer, builds from source | run once, first checkout |
| `bin/dev [args…]` | `docker compose up` in dev mode, reads `USE_TRAEFIK` from `.env`, always adds `docker-compose.build.yaml` then `docker-compose.dev.yaml`; starts the existing `local-dev` images with no build pass — run `bin/build dev` first if a `Dockerfile` or dependency changed; any arguments are forwarded to `docker compose up` before the service list — pass `-d` yourself for detached, omit it to stream logs in the foreground | `bin/dev -d` |
| `bin/prod` | same, `BUILD_TARGET=prod`, rebuilds and runs the image it built (via `docker-compose.build.yaml`) — no dev overlay | `bin/prod` |
| `bin/build <dev\|prod> [service]` | builds the `dev` or `prod` images without starting containers, under their own `local-dev`/`local-prod` tags; no service argument builds all five own services | `bin/build prod web` |
| `bin/cli <service> <cmd…>` | `docker compose exec -it <service> <cmd…>` | `bin/cli api npx prisma migrate status` |
| `bin/npm [service] <args…>` | npm inside a service; **defaults to `web`** when the first arg is not `web`/`api`/`worker` | `bin/npm api run test` |
| `bin/bash <service>` | interactive `sh` in a container | `bin/bash api` |
| `bin/mysql [args…]` | `mariadb` client against `db` using `.env` credentials | `bin/mysql -e 'show tables'` |
| `bin/dbinit` | grants global privileges to `${DB_USER}` so Prisma can create its shadow database | once after a fresh `db` volume |
| `bin/dbreset` | `prisma migrate reset --force` + seed + Redis `FLUSHALL` — resets dev state without rerunning `bin/install` | `bin/dbreset` |
| `bin/reset-password <username>` | resets a user's password interactively | the recovery path when no admin can sign in |

Without Traefik, each service is still reachable directly on its published port (`WEB_PORT`,
`API_PORT`, …) — Traefik only adds domain-based routing.

Source is bind-mounted (`./services/<svc>:/app`), so edits hot-reload. The dev stages install
`node_modules` on first boot if missing, which means `node_modules` lands in your host working copy —
intentional, and it is what your editor's TypeScript server reads.

The bind mount and dev-only variables live in `docker-compose.dev.yaml`, a compose overlay —
`bin/dev` always adds it with `-f`, `bin/prod`/`bin/build` never do.
`docker-compose.yaml` on its own describes the runtime: each of the five own services is
`image: ghcr.io/dientuki/perceptor-<svc>:${PERCEPTOR_TAG:-latest}`, no `build:`, no path inside
this repository — this is the file `install.sh` downloads for someone who has never cloned this
repository (`049-published-images-install`). `docker-compose.build.yaml` carries the `build:`
sections and overrides `image:` to `perceptor-<svc>:local-${BUILD_TARGET:-dev}` for `web`/`api`/
`worker` (`torrent`/`indexer` keep a single unqualified `perceptor-<svc>:local`, since they have no
`target:` and no stages) — a tag that exists in no registry and records the stage it was built
from, so a `dev` and a `prod` build of the same service never share a name and neither can shadow
the other (`050-local-image-tag-collision`). `bin/dev`/`bin/prod`/`bin/build`/`bin/install` all
load it with `-f`, which is what lets `bin/prod` run exactly the `prod` image it just built rather
than pulling a published one or hiding a stale local build behind the host's working copy. Each
Node service carries its own `.dockerignore` (`015-reproducible-image-builds`).

An end user with only Docker never sees any of this — `curl -fsSL <install url> | bash` (`install.sh`)
writes `docker-compose.yaml` and `.env` into an empty directory, asks five questions, derives the
rest, and starts the stack from the published images. Updating is naming a new `PERCEPTOR_TAG` in
`.env` and `docker compose pull && docker compose up -d`; `api` applies its own pending migrations
and production seed before it starts listening (see `services/api/CLAUDE.md`), gated behind a
`backup` service that dumps the database to `./backups` first.

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
- **`BUILD_TARGET`** picks the Dockerfile stage (`dev` by default, `prod` for production); every
  Dockerfile has `base` / `dev` / `builder` / `prod`.
- **The transcode path is unconditional at install time.** `bin/dev`/`bin/prod`/`bin/build` produce
  the identical `docker compose` invocation on every host, with nothing detected, opted out of, or
  asked about at install time — see spec `024` (`docs/spec/features/`) for what this replaced and
  why. Whether a given job actually runs FFmpeg is a separate, runtime decision: an administrator
  can flip the `compression_enabled` setting off, in which case the worker moves the file to its
  destination without transcoding it (`032`). Host invariance still holds — no container, image or
  compose invocation changes — only the per-job branch inside the worker does.
- **The media server is not in `docker-compose.yaml`** — Jellyfin is assumed to run outside the stack.
  That is why `MediaServerService.notifyCreated` translates the container output path to the host path
  via `MediaRootsService.containerToHostPath()` before sending it.
- **`PERCEPTOR_TAG`** is the one version that applies to all five published images
  (`ghcr.io/dientuki/perceptor-<svc>:${PERCEPTOR_TAG:-latest}`); a checkout building from source
  never reads it, since `docker-compose.build.yaml` overrides `image:` to a local tag instead.
  There is no per-service tag — `web`/`worker` retype the GraphQL schema by hand with no codegen
  (Article VIII), so a mixed set fails at runtime with no compile error anywhere.
- **`TMDB_API_KEY`** backfills the `movie_db_api_key` Setting on `api`'s first boot when that row is
  still empty, the same way `INDEXER_API_KEY` backfills `tracker_api_key`. It is not a Settings write
  path beyond that — leaving it unset just leaves the key editable later from the Settings screen.
- **`PERCEPTOR_AUTO_MIGRATE`** is opt-out only, default on: unless set to `false`, `api` applies every
  pending Prisma migration and runs its production seed before it starts listening (REQ-10 of
  `049-published-images-install`), and the health check does not go green until both finish — `web`
  and `worker`, gated on `service_healthy`, never observe a half-migrated database.
- **`COMPOSE_PROFILES`** stays empty by default, which is why a fresh installation binds neither port
  80 nor 443 and mounts no Docker socket: `traefik` sits behind `profiles: [traefik]`, and
  `install.sh` sets `COMPOSE_PROFILES=traefik` only when the user opts into domain-based routing.

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
2026-08-27 after `028-users-screen-refactor`. Test counts then: `api` 217/23 suites, `worker`
93/12 — remeasured 2026-08-28 after `032-optional-compression`: `api` 249/26 suites, `worker`
140/15 suites — and again 2026-08-28 after `033-billboard-and-navigation`: `api` 256/28 suites
(`worker` untouched by that feature) — and again 2026-08-31 after
`034-jellyfin-library-reconciliation`: `api` 285/31 suites (`worker` untouched; `web` has no test
suite — see `services/web/CLAUDE.md`) — and again 2026-09-01 after `037-indexer-result-loss`:
`api` 294/32 suites (`worker` untouched by that feature) — and again 2026-09-01 after
`038-encode-report-durability`: `api` 301/32 suites (`worker` untouched by that feature) — and again
2026-09-02 after `021-user-preferences`: `api` 308/33 suites, `web` typechecks at 0 errors and
`bin/npm web run build` exits 0 (`worker` untouched by that feature) — and again 2026-09-02 after
`039-per-title-language-split`: `api` 313/33 suites, `worker` 151/152 tests across 16 suites (one
pre-existing, unrelated failure in `src/ffmpeg/cases.spec.ts` — a stale expected track-title string
in the `2.json` corpus fixture, confirmed present at `HEAD` before this feature touched anything;
not fixed here since `params.ts` was explicitly out of scope), `web` typechecks at 0 errors and
`bin/npm web run build` exits 0 — and again 2026-09-02 after `040-indexer-search-cache`: `api`
321/34 suites (`worker`/`web` untouched by that feature) — and again 2026-09-03 after
`035-scheduled-tasks`: `api` 331/35 suites, `web` typechecks at 0 errors and `bin/npm web run build`
exits 0 (`worker` untouched by that feature) — and again 2026-09-03 after
`041-episode-info-refresh`: `api` 336/36 suites (`worker`/`web` untouched by that feature) — and
again 2026-09-03 after `042-encode-global-language-preferences`: `api` 342/36 suites (`worker`/`web`
untouched by that feature) — and again 2026-09-03 after `043-pipeline-status-normalization`: `api`
361/37 suites, `web` typechecks at 0 errors and `bin/npm web run build` exits 0 (`worker` untouched
by that feature, deliberately — no pipeline stage changed status, the reporting layer above them
did) — and again 2026-09-04 after `044-settings-screen-polish`: `api` 363/37 suites, `web`
typechecks at 0 errors and `bin/npm web run build` exits 0 (`worker` untouched by that feature,
deliberately — no pipeline stage changed, only the admin Settings screen and the `/preferences`
torrent-group catalog it feeds) — and again 2026-09-04 after `045-media-type-availability`: `api`
390/39 suites, `web` typechecks at 0 errors and `bin/npm web run build` exits 0 (`worker` untouched
by that feature, deliberately — NFR-5 makes an untouched worker the mechanism by which a title
already in flight finishes even after its type is disabled mid-pipeline) — and again 2026-09-04
after `046-encode-metadata-tags`: `worker` typechecks at 0 errors, `bin/npm worker run build` exits
0, and `bin/npm worker test` runs 157 tests across 17 suites, 156 passing (`api`/`web` untouched by
that feature; the one failure is the pre-existing, unrelated stale track-title string in
`ffmpeg/2.json` first recorded under `039-per-title-language-split` above, still present and still
out of scope here) — and again 2026-09-08 after `047-source-deletion`: `api` 414/39 suites, `web`
typechecks at 0 errors and `bin/npm web run build` exits 0, `worker` typechecks at 0 errors,
`bin/npm worker run build` exits 0, and `bin/npm worker test` runs 164 tests across 18 suites, 162
passing (the 2 failures are pre-existing and unrelated — the stale `ffmpeg/2.json` track-title
string above, plus a CRF mismatch in `src/ffmpeg/buildCommand.spec.ts`, both confirmed present at
`HEAD` before this feature touched anything, in `src/ffmpeg/` territory this feature does not own) —
and again 2026-09-09 after `048-shorts-category`: `api` 436/40 suites, `web` typechecks at 0 errors
and `bin/npm web run build` exits 0 (`worker` untouched by that feature, deliberately — NFR-2 makes
an untouched worker the mechanism by which `outputRoot` stays a resolved string the worker cannot
tell a short from a feature film by) — and again 2026-09-10 after `051-language-track-titles`: `api`
447/42 suites, `worker` typechecks at 0 errors, `bin/npm worker run build` exits 0, and
`bin/npm worker test` runs 168 tests across 19 suites, 166 passing (the 2 failures are the same
pre-existing, unrelated ones recorded above under `047-source-deletion` — the stale `ffmpeg/2.json`
track-title string and the `buildCommand.spec.ts` CRF mismatch — confirmed still exactly those two
and no others) — and again 2026-09-11 after `052-deselected-torrent-files`: `api` 454/42 suites, 0
typecheck errors, no Prisma migration (`git status --short services/api/prisma` empty). `worker`
`bin/npm worker run build` exits 0 and `bin/npm worker test` runs 175 tests across 20 suites, 173
passing — same 2 pre-existing `src/ffmpeg/` failures as above, confirmed unchanged. `worker`
typecheck (`bin/cli worker npx --no tsc --noEmit`) reports 2 errors in
`src/metadata/container-tags.spec.ts` (`TS2554: Expected 3 arguments, but got 2`) — confirmed via
`git stash` to already exist on `master` at the tip of `051-language-track-titles`, before this
feature touched anything; likely a spec left stale when `051` changed `buildContainerTitle`/
`buildSourceTag`'s signature. Not fixed here — `src/metadata/` is untouched by `052`, and the error
does not affect `bin/npm worker run build` (which excludes `*.spec.ts`). Worth a follow-up.
— and again 2026-09-11 after `053-downloads-panel-repair`: `api` 460/42 suites, 0 typecheck errors,
one migration (`ProcessJob.encodeSpeed Float?` plus the `infoHash` lowercase data backfill —
`git status --short services/api/prisma` shows a modified `schema.prisma` and one new migration
directory). `web` typechecks at 0 errors and `bin/npm web run build` exits 0. `worker`
`bin/npm worker run build` exits 0 and `bin/npm worker test` runs 178 tests across 20 suites, 176
passing — same 2 pre-existing `src/ffmpeg/` failures as above, confirmed unchanged; `worker`
typecheck reports the same 2 pre-existing `src/metadata/container-tags.spec.ts` errors noted under
`052` above and no others.
— and again 2026-09-11 after `054-interrupted-encode-recovery`: `api` 471/43 suites, 0 typecheck
errors, one migration (`ProcessJob.recoveryCount Int @default(0)` — `git status --short
services/api/prisma` shows a modified `schema.prisma` and one new migration directory). `worker`
`bin/npm worker run build` exits 0 and `bin/npm worker test` runs 181 tests across 20 suites, 179
passing — same 2 pre-existing `src/ffmpeg/` failures as above, confirmed unchanged; `worker`
typecheck reports the same 2 pre-existing `src/metadata/container-tags.spec.ts` errors noted under
`052` above and no others (`web` untouched by this feature).
**Re-run the checks rather than trusting these numbers** — they exist so an agent can prove a change
added nothing, not as a fact to cite.

## Known debt

- **`movieId` means two different things depending on where it appears.** `006-media-search` renamed
  `MediaSearchResult.movieId` → `mediaId` where it came to mean "film or series", but three
  occurrences still mean "a film, specifically": the argument on `addTorrentToMovie`/`addMagnetToMovie`/
  `createUploadTicket`, the **tus upload metadata key** (`web`'s `components/import/importFileModal.tsx`,
  `api`'s `uploads/uploads.service.ts`), and `MediaSource.movieId`, read by
  `worker/src/jobs/source-ready.job.ts`. `010-episode-acquisition` added `episodeId` *beside* it rather
  than generalising: the rename crosses all three services with no codegen between them, so a partial
  rename breaks the pipeline at runtime with no compile error anywhere. `docs/spec/graphql-contract.md`
  has to move first. **Narrowed, not resolved, by `022-download-status-tags`**: `MediaSource.movieId`
  is now a real column (the old `Movie.mediaSourceId @unique` 1:1 is gone, which is what let a title
  hold more than one active source), but it kept its exact GraphQL name and type, so this debt item is
  unchanged in substance — the cross-service rename is still its own future work.

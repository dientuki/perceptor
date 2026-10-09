# Perceptor

Self-hosted media automation. A user searches a title, Perceptor registers it, finds a release,
downloads it, transcodes it with FFmpeg and files the result in a library.

Every pipeline stage below is working today, for both films and series. The spec refs point at
`docs/spec/features/<NNN-slug>/` for the design detail; the service `CLAUDE.md` files have the
implementation detail.

| Stage | Where | Specs |
| :-- | :-- | :-- |
| Search catalog (TMDB) | `api` — `src/media/`, `src/movies/`, `src/shows/`, `src/clients/tmdb/`; `web` — the header search box and `/search`. Since `045`, the installation-wide `movies_enabled`/`shows_enabled` Settings are no longer write-only: `api`'s `mediaCapabilities` query exposes them to every user and refuses a disabled type at `searchMedia`/`popularMedia`/`addMedia`; `web` reads the pair to filter the sidebar, the billboard, the search placeholder/results and the `/preferences` tabs, and to 404 `/movies(/add)`/`/shows(/add)` — system-wide, identical for every user, and never refused for work already in flight. Since `048`, `mediaCapabilities` carries a third, subordinate `shortsEnabled` (`movies_enabled && shorts_enabled`); a film already registered as a short is badged in search results — the badge itself is still never inferred. Since `056`, registering a film from search is a single action with no per-title choice; whether it lands as a short is decided at registration time, not here. Since `071`, `mediaCapabilities` also carries `catalogKeyConfigured` (the TMDB key is non-empty, never the key itself): with no key, `web`'s home shows a privacy-first tutorial for getting one (`TmdbKeyOnboarding`) instead of calling `popularMedia`, and a key TMDB rejects (401) surfaces as `error.media.catalog_unauthorized` from `popularMedia` only and shows the same tutorial with a notice; `searchMedia` is unchanged and any other failure stays `catalog_unavailable` | `005`, `006`, `026`, `045`, `048`, `056`, `071` |
| Register title in DB | `api` — `media`/`movies`/`shows` + Prisma; a new series fetches its seasons/episodes in the background; a registration also reconciles the title against the configured media server, promoting `MISSING` to `COMPLETED` (per episode for a series) when that server already holds it; a scheduled sweep (`scheduler/`'s `refresh_episodes` task, opt-in) also writes back title/overview/air-date for episodes still in flight, days after registration. Since `074`, the `refresh_shows` task (opt-in) re-syncs a series' whole catalog — seasons and episodes, so a revived series' new season appears — monthly for a continuing one and every six months for an ended/cancelled one, off the new `Show.tmdbStatus` column. Since `075`, the `refresh_movies` task (opt-in) re-reads the catalog data of every film not yet `COMPLETED` through the same path as `069`'s Refresh, and a film now carries its three typed release dates (theatrical, digital, physical), TMDB's production status and a `catalogClosedAt` marker that stops the sweep re-checking a canceled film or one whose newest date is over a year old — it refreshes only, never acquires — `076` is what reads those dates. Since `048`, a film carries an `isShort` boolean (`Movie.isShort`, default `false`), never a per-user classification. Since `056`, its initial value at registration is derived, not chosen: `MoviesService.register()` reads the film's TMDB runtime (fetched once and cached, skipped entirely when shorts are disabled) and classifies anything under 40 minutes as a short; `setMovieShort` from the film's own detail page remains the only way to reclassify one already in the library. Since `057`, a film or series also carries a `contentKind` enum (`LIVE_ACTION` / `ANIME` / `CGI`, replacing a write-only `isLiveAction` boolean nothing had ever set) derived the same way — from the title's TMDB genres, and for an animated title its keywords, sharing the same cached catalog entry — with `setMovieContentKind`/`setShowContentKind` as the only way to correct one already registered. Since `069`, a title's detail page has a Refresh button (`refreshMovie`/`refreshShow`): it re-reads the title's catalog data from TMDB (a series: every season and episode too, season 0 included, creating what is new and never deleting or blanking what exists) and never re-derives `isShort`/`contentKind` | `006`, `034`, `041`, `048`, `056`, `057`, `069` |
| Find release | Prowlarr (`indexer`) + `flaresolverr`, `api` — `src/clients/indexer/client.ts`; every Prowlarr row survives the search, grouped by `infoHash` (or a derived key when the indexer supplied none) rather than dropped for missing metadata — `infoHash` is resolved lazily, only for the release the user actually adds (`src/clients/indexer/resolve-info-hash.ts`); a repeat search for the same (normalized) query inside 10 minutes is served from Redis instead of re-querying Prowlarr, read-through in `src/indexer/indexer.service.ts` (`040`); manual fallback is pasting a magnet (`src/clients/torrent/magnet.ts`); `web` — a "Best candidates" toggle in the movie detail page's torrent modal shows only the rows `api` marks `candidate` (best resolution tier), ordered by `candidateRank` — the ranking is computed server-side in `searchTorrents` (`073`), not client-side; for a film the ranking also honours the caller's `allowCinemaReleases` preference (`036`), an unconditional veto when it is off — a release naming a cinema capture (`CAM`, `TS`/`TELESYNC`, `TC`/`TELECINE`, `HDCAM`, `HDTS`/`HDTC`, boundary-matched so it never fragments a longer token) is dropped before the best resolution tier is chosen, never merely demoted; since `073` a daily `acquire_episodes` sweep also picks the `candidateRank === 1` release for newly aired episodes and attaches it automatically (opt-in, an entry point into the existing Download stage) — a harness for eventually picking automatically, not a fetch of new results. Since `076`, a daily `acquire_movies` sweep does the same for films (opt-in, replacing the `acquire_pending` stub): each user marks any of three windows in `/preferences` — theatrical (2 days after the release, any quality), digital (1 day, WEB-DL or better), physical (5 days, UHD or remux) — a film with no date for the marked window falls back (physical to digital, never to cinema), the windows of every owner are unioned, and the quality floor is a veto inside the ranking, applied before the best resolution tier is chosen. Since `053`, the indexer client writes `infoHash` lowercase (it used to uppercase Prowlarr's own hash), matching the other two write paths — qBittorrent reports and accepts lowercase only, so the mismatch was silently losing live status for indexer-sourced rows. Since `059`, a whole season is a search target too — `web`'s season accordion header carries its own search button, prefilled `<Show> S0N`, ranked the same way an episode's search is (the series' audio preference, `showTorrentGroups`). Since `078`, an admin-only `/first-step` page (`web`) walks a fresh install through both catalog setup and indexer setup in one place: it repeats the home page's TMDB key onboarding block and adds Prowlarr instructions (sign in, add an indexer, add a second one tagged `flaresolverr` for a Cloudflare-fronted tracker), fed by a new admin-only, read-only `indexerStatus` query (`api`) that resolves `{ configuredIndexers: 0, reachable: false }` rather than throwing when Prowlarr is unreachable — an outcome, not an error, matching `069`'s media-server posture | `010`, `014`, `036`, `037`, `040`, `053`, `059`, `076`, `078` |
| Download | qBittorrent (`torrent`), `api` — `src/clients/torrent/client.ts`, per-torrent save path; no longer fire-and-forget — `api` reads live progress/speed back and starts, stops and deletes torrents on the user's behalf, and a title may race several sources at once. Since `047`, one delete means one delete for the whole pipeline, not just the torrent: `downloadDelete` accepts an uploaded file too (no longer torrent-only), cancels a running encode over a dedicated Redis channel (`encode:cancel`), withdraws every queue entry, and removes the source's downloads-side residue — confined to the downloads root, never the library (constitution Article XII). Since `059`, a season pack is reachable from `web` too: the season header's search and magnet buttons call `addTorrentToSeason`/`addMagnetToSeason` (`SeasonsService`) — the same conflict/`force`/demotion rules and qBittorrent tagging an episode gets, just season-scoped. Since `088`, there is no twin to speak of: `MoviesService`/`EpisodesService`/`SeasonsService` all delegate the attach body itself to one shared `AttachSourceService`, parameterized per target by a four-member `AttachTarget` descriptor — see `services/api/CLAUDE.md`'s `episodes/`/`seasons/` sections. Since `060`, re-adding an `infoHash` already attached to the same target is a no-op (an `ERROR` one is reactivated in place, keeping its `downloadPath`) instead of re-calling `add()` and overwriting the path with an empty folder. Since `065`, an `ERROR` row shows its last error (`Download.lastError`, `retryable`) and Play resumes it from the stage that failed — the file is never downloaded again. Since `068`, the season header's import button works: several loose files upload at once into one upload session (`startSeasonUpload`), which is itself a season-scoped `MediaSource` (`LOCAL_FOLDER`, `PENDING`) that closes into the ordinary season scan. Since `087`, `force` means exactly one thing everywhere it appears — the user was shown the replacement warning and accepted it — and nothing else: the guard it unlocks on every acquisition entry point (films, episodes, seasons, uploads) now refuses without it when the target's status is `COMPLETED` **or** it already holds a *delivered source* (a `SCANNED` `MediaSource` with no job still encoding and at least one `COMPLETED` job), and the demotion `force` authorises is one shared call (`DownloadsService.demoteDeliveredSources`) instead of three divergent ones — closing a stall where a film replaced via torrent/magnet never demoted its old delivered source and sat in `DOWNLOADING` forever with no error anywhere. `force` has exactly one producer: the user's confirmation in `web`; the `073`/`076` sweeps hardcode `force: false` and the worker never sees the flag at all. Since `089`, qBittorrent's `queuedDL` state maps to `QUEUED` rather than being folded into the coarse `DOWNLOADING` bucket, and every live torrent read (not only the row a caller explicitly asked about) writes back every row it already fetched — no new client call — so a source that transitions in the background is never missed by a reader acting on a different row of the same title. Since `090`, replacing a source that already delivered a file no longer writes it to `ERROR` — `force`'s demotion (`DownloadsService.demoteDeliveredSources`) now stamps `MediaSource.retiredAt` instead, leaving `status`/`lastError` exactly as they already derive (typically still reading `COMPLETED` via the title's own possession). A retired source is never a race winner and never counts as delivered again, offers no Play/Stop (only Delete), and re-adding the same release reactivates it, clearing `retiredAt` in the same write that returns it to `QUEUED`. Only a source that never delivered — still mid-encode or never scanned — keeps the old `ERROR`/`error.source.replaced` path. Since `091`, a race's losers are actually swept for any winner, not only a torrent one: the sweep moved from `process-jobs/` into `DownloadsService.unwindLosingSiblings`, which runs through the same per-source unwind `067` already used and skips a loser that is delivered or already retired; `Download.lostRace` marks a losing row (no Play, Stop still works) and `downloadStart` refuses one with `error.download.retry_superseded` | `010`, `022`, `047`, `059`, `060`, `065`, `068`, `087`, `088`, `089`, `090`, `091` |
| Detect completion, enqueue | `api` — `src/downloads/` (`torrentCompleted` mutation, BullMQ producer); a shared race arbiter also runs from the tus upload path, since an uploaded file competes in the same race as any torrent of its target — an upload always demotes a `READY`/`SCANNED` sibling of its own target rather than deferring to it, and a losing upload gets a `409` instead of being silently ignored; both outcome mutations the worker reports back through (`encodeCompleted`/`encodeFailed`) are safe to receive more than once, which is what lets the worker retry a lost report until `api` acknowledges it. Since `065`, a scan that throws is reported (`sourceScanFailed`) instead of leaving the source `READY` forever, and a `SCANNED` source whose encode failed no longer counts as the race winner. Since `052`, `sourceScanned`'s empty-match branch distinguishes two causes with two distinct keys: `error.source.scan_no_video` (no video found or resolved, unchanged) versus `error.source.scan_no_downloaded_video` (video was found but none of it has content — every candidate was deselected in the torrent client). Since `068`, closing a season upload session (`finishSeasonUpload`) runs the same race arbiter and enqueues one season scan; an upload session's files never create a `MediaSource` of their own. Since `087`, the arbiter (`resolveRace`) returns a typed outcome (`WON`/`SUPERSEDED`/`IGNORED`) instead of a message string alone, and a source that loses the race to a sibling that already finished is recorded rather than swallowed — written to `ERROR`/`error.source.superseded` with its torrent stopped — instead of the title silently sitting in `DOWNLOADING` with the winning encode already done. Since `089`, no call site in this module (or anywhere else in `api`) writes a `Movie`/`Episode`/`Show` status literal any more — every transition notifies `api`'s internal `TitleStatusService` by id, which re-reads the target's own rows and derives the answer itself, closing the bug where a title fed its own stored status back into its derivation could only ratchet upward and got stuck reading `DOWNLOADING` forever | `022`, `038`, `052`, `065`, `068`, `087`, `089` |
| Scan files, inventory | `worker` — enumerates every file, resolves episodes by parsing `SxxEyy`; episode names come from the api, never the filename. Since `052`, a torrent-sourced scan also takes the list of files the torrent client actually downloaded (`api`'s `MediaSource.downloadedFiles`, `null` for a non-torrent source) as an extra input, narrowing the candidate set to files with real content before either selection rule runs — a file deselected in qBittorrent keeps its full announced size on disk with none of its bytes, and would otherwise win the "largest file" race | `013`, `052`, `065` |
| Transcode | `worker` (FFmpeg) — every recognized video codec (`h264`, `hevc`/`h265`, `vc1`, `av1`) to AV1, downscaled to the administrator's chosen ceiling and never upscaled, stream copy only for AV1 that already fits the ceiling or a codec the worker does not recognize; HDR colour tags (Dolby Vision/HDR10, HLG) are preserved rather than flattened to SDR on every AV1 output, scaled or not; Opus audio; decided from `ffprobe`, not the filename. One code path, on CPU, on every host. A season pack fans out into one `ProcessJob` per episode. Optional per installation — an administrator can turn compression off from Settings, in which case the file is still renamed and moved to its destination, just never touched by FFmpeg. Since `046`, every transcoded output also carries two container-level tags — `-metadata title=<film title or "Series SNN-ENN Episode title">` (verbatim from TMDB, decorative) and `-metadata PERCEPTOR_SOURCE=<release path relative to the downloads root>` (a provenance record of the exact source release); neither is written when compression is off. Since `047`, an encode can be abandoned mid-flight — a required `AbortSignal` on the `EncodeFn` driver seam, triggered by the api's `encode:cancel` publish when the source that requested it is deleted; the worker terminates whichever process it has running and reports no outcome. The destination
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
runs — enforced since the `054` NFR-4 follow-up by a Redis lease the worker takes before it
announces, so a second instance exits 1 instead of resetting the first one's live encode) and `api`
reconciles every `ProcessJob` still reading `ENCODING` at that moment, since a
process that has just started is encoding nothing. A job is requeued from scratch (its
`.working.mkv`/`.part.mkv` scratch cleared unconditionally before every encode, not only a
recovered one) once automatically; a second orphaning of the same job fails it outright rather than
looping forever on a host the encode itself keeps crashing. `docker compose restart api` alone
never touches a live encode — the signal is the worker's boot, never the api's. A small BullMQ
retry budget (`attempts: 2`, a 5-minute backoff) separately covers the narrower case of a stall
BullMQ's own heartbeat detects while the worker's container survives; it never retries a
cancellation or a diagnosed failure, both rethrown as non-retryable so `047`'s delete-mid-encode
guarantee is unaffected. Since `057`, the SVT-AV1 parameters themselves branch on the title's
`contentKind` (`LIVE_ACTION` / `ANIME` / `CGI`, resolved per job and never snapshotted onto the
`ProcessJob`) instead of a boolean nobody had ever set — `ANIME` and `CGI` tune identically today but
stay two independently editable branches, not one shared arm, since they are expected to diverge; the
worker trusts nothing about the value it reads off the payload, defaulting an absent or unrecognised
kind to `LIVE_ACTION` and logging rather than failing the encode. Since `058`, the video rule itself
changed: the installation-wide `compression_resolution` Setting (already stored since `044`, now
resolved at query time onto `EncodeJobDetails.compressionResolution` beside `compressionEnabled`) is
a ceiling a source is downscaled to fit — a fifth tier, `480p`, joins `4k`/`1080p`/`720p`/`360p` —
never a target every source is forced to. HEVC below 4K, previously copied, is now re-encoded; H264
and VC-1 above the ceiling, previously encoded at native size, are now downscaled; an AV1 source
above the ceiling, previously always copied, is now re-encoded; every AV1 encode now writes explicit
colour tags (bt709 for SDR, not only HDR); the AV1 video track title always starts with plain `AV1`,
never a target resolution. The worker defaults an absent or unrecognised `compressionResolution` to
`1080p` and logs, the same posture as `contentKind`; `compressionEnabled` false still skips FFmpeg
entirely regardless of the resolution setting (`032`). Since `070`, which subtitles survive is an installation-wide Settings → Compression choice, no longer hardcoded to SRT: `api` resolves five settings into one already-effective `EncodeJobDetails.allowedSubtitleFormats` (`srt`/`ass`/`webvtt`/`mov_text` text, `pgs`/`vobsub`/`dvb` image; `[]` means no subtitles). Per language, text wins over image; a text track is always written as SRT (ASS styling is flattened), an image track is stream-copied; the worker defaults an absent list to the text formats and logs |
`011`, `013`, `024`, `031`, `032`, `042`, `046`, `047`, `048`, `051`, `053`, `054`, `057`, `058`, `065`, `070`, `072` (the destination is layout-aware: `api` resolves `EncodeJobDetails.libraryLayout` (`jellyfin`/`plex`) at query time and the worker knows naming conventions, never clients; an unrecognised value logs and falls back to `jellyfin`) |
| Notify media server | `api` — `src/media-server/`, `src/clients/media-server/` (Jellyfin or Plex since `072`, opt-in, default `none`; Plex is index-backed, notifies with a path-scoped section scan and falls back to a full refresh with a log line); no longer write-only — a local index (`src/media-server-index/`) lets a client with no native provider-id lookup answer "does this title exist" too, rebuilt on demand from Settings or a "Re-sincronizar" button in `web`. Since `069`, the media server is the source of truth for `COMPLETED`/`MISSING` in both directions: a title's Refresh rebuilds the index, waits for it, then promotes what the server holds and demotes (clearing `filePath`) what it no longer holds — only for a title with no live source or job, one guarded `updateMany` per write, and a failed rebuild or listing writes nothing (an outcome, not an error). A finished pipeline run no longer lifts a title's derived status; the stored column decides | `034`, `069`, `072` |
| Browse library | `api` — the three resolvers; `web` — `/`, the billboard, plus `/movies`, `/shows` and their detail pages, all per-user. Since `059`, an episode can read `QUEUED` with no source or job of its own: while its season has a non-`ERROR`, not-yet-scanned pack in flight, every aired episode (`releaseDate` non-null and not after now) is lifted to at least `QUEUED`. Since `089`, `Movie.status`/`Episode.status`/`Show.status` are read straight off their columns rather than derived at read time — `api`'s internal `title-status/` module is the one writer that keeps them fresh, notified by id whenever a source, job or media-server reconciliation changes, so the `059` lift above is un-written by a season-scoped recompute rather than a read-time projection. `Show.status` moves off `MISSING` for the first time: `COMPLETED` once every aired episode is `COMPLETED`, never held back by an unaired next episode and never kept at `COMPLETED` by older episodes alone once a new one airs with nothing acquired. The two daily acquisition sweeps (`073`/`076`) are the deliberate exception — they still derive fresh from live rows rather than trust the column, since a momentarily stale `MISSING` would make a sweep double-acquire with no error anywhere. Since `062`, `/calendar` is a month grid of releases (films, shorts, episodes grouped per series, season and day with a `completed/total` count), fed by `api`'s read-only `calendar(from, to)` query and coloured by status; month changes are fetched in place and the URL never changes. Since `064`, `/downloads` is the global queue: `api`'s `downloads` query returns every source unpaginated, `web` filters, groups by title (a header only for 2+ visible rows) and paginates over it, and the sidebar's Downloads entry carries a badge from `activeDownloadCount` (distinct titles with a `QUEUED`/`DOWNLOADING`/`DOWNLOADED`/`ENCODING` source, `PAUSED` excluded), refreshed on load and `router.refresh()`, never polled. Since `067`, a film's or series' detail page carries a Remove button (`removeMovie`/`removeShow`, whole series only): another user still holding the title drops only the caller's `UserMovie`/`UserShow` row; the last owner deletes the title from Perceptor after unwinding everything in flight through `047`'s unwind (`DownloadsService.unwindSourcesForTitle`, one batched torrent-client call, abort with nothing removed if it fails). `FfprobeLog` survives, and the library file under the destinations root is never touched (Article XII). The dialog states which outcome will happen via the advisory `Movie.otherOwners`/`Show.otherOwners`. Since `069`, the same page carries a Refresh button beside Remove, showing what changed inline (`web`'s `RefreshTitleButton`) Since `077`, that page's header is three columns — poster; heading, a film's file/magnet and the synopsis; Refresh/Remove, the short switch, content kind and a read-only audio/subtitle panel whose Change button opens a modal — `web` only, no contract or pipeline change. | `007`, `008`, `009`, `010`, `033`, `059`, `062`, `064`, `067`, `069`, `089` |

One gap worth knowing: every listing/detail route is scoped to the calling user — a title another
user owns answers `Recurso no disponible para este usuario` rather than rendering. The one exception
is the `/downloads` queue (`064`): it lists every source of every title to any authenticated user,
read-only for a title the caller does not hold (`Download.owned`), and the sidebar badge counts
active titles over that same installation-wide list.

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
                       :80 / :443 (:443 routed only when USE_HTTPS=true; `certs` one-shot writes its CA + leaf)
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

Every wrapper that talks to Docker sources `bin/_docker.sh` and calls `require_docker` first: the
`docker` command, the Compose plugin, **and** a reachable engine. The third check is the one that
matters — the CLI and the plugin both answer with the daemon stopped, so without it a wrapper dies
later on `Cannot connect to the Docker daemon` (and `install.sh`, which ships with no `bin/` beside
it, used to ask all five questions before getting there). `bin/_docker.sh` is sourced, not run, and
also holds `compose_project_name`.

| Script | What it does | Example |
| :-- | :-- | :-- |
| `bin/install` | generates `.env` from `.env.example`, asking Traefik y/n + domain — the **developer** installer, builds from source | run once, first checkout |
| `bin/dev [args…]` | `docker compose up` in dev mode, reads `USE_TRAEFIK` from `.env`, always adds `docker-compose.build.yaml` then `docker-compose.dev.yaml`; starts the existing `local-dev` images with no build pass — run `bin/build dev` first if a `Dockerfile` or dependency changed; any arguments are forwarded to `docker compose up` before the service list — pass `-d` yourself for detached, omit it to stream logs in the foreground | `bin/dev -d` |
| `bin/prod` | same, `BUILD_TARGET=prod`, rebuilds and runs the image it built (via `docker-compose.build.yaml`) — no dev overlay | `bin/prod` |
| `bin/build <dev\|prod> [service]` | builds the `dev` or `prod` images without starting containers, under their own `local-dev`/`local-prod` tags; no service argument builds all five own services | `bin/build prod web` |
| `bin/stop [-y]` | `docker compose stop` for this directory's project, then lists any Perceptor container still running under **another** Compose project — an unrelated checkout or an end-user install directory holding the host ports, detected by the shared `perceptor-net` network so another install's `db`/`traefik` count too — and stops those as well; interactively it asks, `-y` skips the prompt. Stop only, never `down`: nothing removed, no volume touched | `bin/stop -y` |
| `bin/cli <service> <cmd…>` | `docker compose exec -it <service> <cmd…>` | `bin/cli api npx prisma migrate status` |
| `bin/npm [service] <args…>` | npm inside a service; **defaults to `web`** when the first arg is not `web`/`api`/`worker` | `bin/npm api run test` |
| `bin/bash <service>` | interactive `sh` in a container | `bin/bash api` |
| `bin/mysql [args…]` | `mariadb` client against `db` using `.env` credentials | `bin/mysql -e 'show tables'` |
| `bin/dbinit` | grants global privileges to `${DB_USER}` so Prisma can create its shadow database | once after a fresh `db` volume |
| `bin/dbreset` | `prisma migrate reset --force` + seed + Redis `FLUSHALL` — resets dev state without rerunning `bin/install` | `bin/dbreset` |
| `bin/reset-password <username>` | resets a user's password interactively; for `ADMIN_USER` also qBittorrent and Prowlarr (end users: `docker compose exec api node dist/scripts/reset-password.js <username>`) | the recovery path when no admin can sign in |
| `bin/site [--serve]` | regenerates the public landing page (`site/index.html`, `site/es/index.html`) from `tools/site/template.html` plus one flat string catalog per locale, running `node tools/site/build.mjs` inside the `web` image with the repo root bind-mounted (`084-landing-page-i18n`); `--serve` adds a static server over `site/` so the English/Spanish pass can be browsed at `http://localhost:8089/` | `bin/site --serve` |
| `bin/audit [service]` | runs the production npm advisory gate (`tools/audit/check.mjs`) against `api`/`web`/`worker` — or just the one named — inside the `web` image with the repo root bind-mounted; reconciles `npm audit --json --omit=dev` per service against `tools/audit/allowlist.json` and exits non-zero on any unallowlisted `high`/`critical` finding, a stale entry, or an entry with no reachability argument (`085-dependency-update-cadence`) | `bin/audit api` |
| `bin/comments [service]` | runs the comment locator convention gate (`tools/comments/check.mjs`) against `api`/`web`/`worker` — or just the one named — inside the `web` image with the repo root bind-mounted; fails on a Spanish comment, a malformed or dangling `// Spec NNN, <ref>` locator, or a Spanish test description (`086-comment-locator-convention`) | `bin/comments api` |
| `bin/pending-acs [--check]` | regenerates the mechanical half of `docs/spec/pending-acs.md` — the counts, the per-spec table and the per-blocker rollup — from every `docs/spec/features/*/spec.md`, by running `tools/pending-acs/build.mjs` inside the `web` image with the repo root bind-mounted; the hand-written `obs` column is carried over verbatim and never invented, and `--check` reports staleness and exits non-zero instead of writing | `bin/pending-acs` |

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
`backup` service that dumps the database to `./backups` first. Since `083`, the five published
images are built for both `linux/amd64` and `linux/arm64`, each architecture built natively on a
runner of its own kind (`.github/workflows/release.yml`'s `build` + `merge` split) rather than
emulated — this covers Apple Silicon Macs, Windows on ARM, Raspberry Pi 5 and ARM VPS hosts; `install.sh`
checks the Docker engine's own reported architecture (`x86_64`/`aarch64`, the kernel spelling, not
the manifest one) before asking anything and refuses an unsupported one with a clear message rather
than letting Docker fail nine times with `no matching manifest`.

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
- **`ADMIN_USER` is canonical; the password is never in `.env`** (`061`) — `QBITTORRENT_USER` and
  `INDEXER_USER` reference it via `.env` interpolation. The password is set by
  `scripts/reset-password.ts` (piped by both installers, or run by hand), which writes the app,
  qBittorrent and Prowlarr logins together, so the three share one login. An install that predates
  `061` may still carry `ADMIN_PASSWORD`/`QBITTORRENT_PASSWORD`/`INDEXER_PASSWORD`; they are optional
  and honoured if present. The api seed with no `ADMIN_PASSWORD` stores an unusable hash. The seeded admin is also the first app administrator; there is no
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
  (`ghcr.io/dientuki/perceptor-<svc>:${PERCEPTOR_TAG:-latest}`), each a multi-arch manifest list
  covering `linux/amd64` and `linux/arm64` under that single tag (`083`); a checkout building from
  source never reads it, since `docker-compose.build.yaml` overrides `image:` to a local tag
  instead. There is no per-service tag — `web`/`worker` retype the GraphQL schema by hand with no
  codegen (Article VIII), so a mixed set fails at runtime with no compile error anywhere.
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
- **`USE_HTTPS`** (`066`), default `false`, in effect only with `USE_TRAEFIK=true` and a `DOMAIN`: a one-shot
  `certs` service (`profiles: [https]`, so `install.sh` sets `COMPOSE_PROFILES=traefik,https`; `bin/dev`/`bin/prod`
  run it themselves before `up`) creates a local CA in `./certs` (`ca.crt`, `ca.key`, git-ignored) once and never
  regenerates it, issues the leaf into the `traefik_tls` volume and writes Traefik's file-provider config. HTTP
  keeps working alongside, with no redirect. The CA is trusted **per device** by installing `certs/ca.crt`, and its
  name constraint pins it to `DOMAIN`: changing `DOMAIN` makes `certs` fail loudly until `./certs` is deleted and
  the new `ca.crt` re-trusted. `traefik`'s `depends_on: certs` is `required: false`, which compose treats as "skip"
  when `certs` fails, so `bin/dev`/`bin/prod` gate on `certs` themselves.
  `certs` also copies the public `ca.crt` into the `ca_public` volume, which `web` mounts read-only and serves without login at `/ca.crt` (linked from Settings → Environment), so a device can fetch it over plain HTTP; `web` never sees `ca.key` or the leaf key.

## Conventions

- **Commits**: `[scope] lowercase message` — scopes seen so far are `[api]`, `[web]`, `[traefix]`.
- **Language**: everything committed is English — comments, identifiers, docs, commit messages, test
  descriptions (`docs/constitution.md` → Article VI is the authority). The **exception is user-facing
  copy**, and since `018-ui-i18n` that copy is no longer hardcoded Spanish — it is catalog-driven.
  `api`/`worker` produce English text plus an `extensions.i18n` key; `web` resolves the active
  locale server-side (`User.uiLocale` → `Accept-Language` → `en`) and translates through
  `services/web/messages/{en,es}.json`. `es` keeps the existing Rioplatense register verbatim.
  See `docs/spec/graphql-contract.md` § "UI internationalization" for the full key vocabulary and
  the error envelope shape.
- **Comments**: Article XI bars them except for an external URL, an Article IX test header, a
  security-guard doc comment, or a `// Spec NNN, <ref>[ <ref>…]` locator pointing at the spec,
  task or acceptance criterion that justifies the surrounding code (the fourth exception,
  `086-comment-locator-convention`) — never prose on its own. `bin/comments` enforces this tree-wide.
- **Path alias**: `@/*` → `./src/*` in both `api` and `web`.
- **API contract**: GraphQL only. `web` never touches the database; it calls the API through
  `fetchGraphQL` in `services/web/src/lib/graphql-client.ts`.
  **One deliberate exception**: `POST/PATCH/HEAD /uploads` on `api` (`services/api/src/uploads/`) is
  the project's only REST route — a resumable multi-GB browser upload ([tus](https://tus.io)) fits
  neither a GraphQL mutation nor a Next Server Action (1MB body limit). `onUploadFinish` closes the
  loop in the same request (creates the `MediaSource`, updates the `Movie`, enqueues `bull:process`),
  so no file is ever uploaded but unregistered.

## Spec Driven Development

`docs/constitution.md` holds the rules that outrank every other document here. When it and a
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

`/constitution` reviews or amends the rules themselves. `/implement`'s last step invokes
`/pending-acs`, which refreshes `docs/spec/pending-acs.md` — the standing list of every acceptance
criterion the project has not verified yet, one row per spec, with the blocker named rather than
left as a bare `[ ]`. It is still its own command, since it is worth running after a verification
pass that ticked boxes without implementing anything.

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

The latest measurement after each feature — typecheck/test counts, migrations, GraphQL contract
diffs, live manual pass coverage — lives in `docs/spec/history.md`, newest first, not here.
`086-comment-locator-convention` REQ-10 moved it out once it reached 213 lines of changelog.
Re-measure with the commands at the top of that file; append a new entry there, never here
(REQ-11).

What the project has **not** verified lives in `docs/spec/pending-acs.md`, regenerated by
`bin/pending-acs` and refreshed by `/pending-acs`: 303 of 1084 acceptance criteria are still
unticked as of 2026-10-09, and the document names the blocker for each of the 42 specs that carry
one.

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

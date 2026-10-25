---
title: qBittorrent Authenticated by API Key, Not by Subnet
spec_version: 0.3.0
author: Juan "Dientuki" Farias
created_at: 2026-10-24
last_updated: 2026-10-25
status: Approved
services: [infra, api, web]
---

# SPEC: qBittorrent Authenticated by API Key, Not by Subnet (`spec.md`)

## Context & Goal

`api` talks to qBittorrent's WebUI API with no credential at all. Every call in
`services/api/src/clients/torrent/client.ts` (`add`, `info`, `files`, `start`, `stop`, `delete`) and
`setQbittorrentLogin` in `services/api/src/shared-login/shared-login.ts` (what
`scripts/reset-password.ts` uses to push the administrator's password) sends a bare `fetch`. They
work only because `services/torrent/Dockerfile` seeds `WebUI\AuthSubnetWhitelistEnabled=true` and
`WebUI\AuthSubnetWhitelist=172.16.0.0/12` into qBittorrent's default configuration, so any client
whose address falls in Docker's bridge range skips the login. The `torrent_api_key` setting has been
seeded empty since the settings seed was written, and nothing reads it.

That whitelist is also a hole, verified live on 2026-10-24 against an installation running
`v0.5.0-rc4` with Traefik enabled. A browser opening `torrent.<DOMAIN>` reaches qBittorrent through
Traefik, qBittorrent sees Traefik's container address (`172.19.0.4`, inside the whitelist) as the
client, and the WebUI opens with no login. An unauthenticated request from that container to
`/api/v2/app/version` answers `200`. Anyone who can resolve that host name gets full control of the
torrent client: adding and deleting torrents, changing save paths, and editing the `[AutoRun]`
program, which is command execution inside the `torrent` container. The same applies to a request
from the Docker host itself to the published `QBITTORRENT_WEBUI_PORT`, which arrives from the bridge
gateway. The whitelist is also what stops Perceptor from running anywhere the containers are not on
a `172.16.0.0/12` network. On Kubernetes, for example, the pod range is a different block, and
widening the whitelist to cover it reopens the same hole through the ingress pod.

qBittorrent 5.2 (the image ships 5.2.4) accepts an API key as `Authorization: Bearer <key>`. This was
verified in a throwaway container of the published image:
- A key declared before start as `WebUI\APIKey=<key>` in `qBittorrent.conf` is honoured: `200` on a
  read, and `setPreferences` applied its change.
- A wrong key and a missing credential both answer `403`.
- The key has a fixed shape (`qbt_` followed by 28 alphanumeric characters, the shape
  `/api/v2/app/rotateAPIKey` itself produces). A declared key of another shape (`qbt_` plus 32 hex
  characters) is silently rejected with `403`.

This feature makes the API key the only way `api` authenticates against qBittorrent. It follows the
pattern `014-dev-stack-flaresolverr` set for Prowlarr's `INDEXER_API_KEY`: the key is declared in
`.env` rather than discovered, written into the client's configuration before the client starts, and
the boot fails loudly when it is missing. The subnet whitelist is turned off in new and existing
installations alike. No pipeline stage changes status. The **Download** row of the root `CLAUDE.md`
keeps working, now through a credential.

"Fails loudly" needs a fix of its own, and it also covers Prowlarr. A script in a LinuxServer
image's `custom-cont-init.d` that exits non-zero does not stop the container: the image's
`init-custom-files` runner logs `exited 1` and starts the daemon anyway. This was verified against
the published `torrent` image's own run script. `014`'s
`services/indexer/custom-cont-init.d/10-prowlarr-apikey` has therefore never actually aborted
anything, even though its log says it does. With `INDEXER_API_KEY` empty, Prowlarr starts, generates
a random key of its own, and every search from `api` is rejected. The only trace is a line in the
boot log. This feature makes both containers' "refuse to start" real.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Declared key)**: A new `TORRENT_API_KEY` value in `.env` is the one qBittorrent API
      key of an installation. Both installers (`install.sh` and `bin/install`) must generate it when
      it is absent or empty, in qBittorrent's accepted shape (`qbt_` + 28 characters from
      `[A-Za-z0-9]`). They must fill it into an existing `.env` without touching any other value,
      the same way they treat `INDEXER_API_KEY` today.
- [ ] **REQ-2 (Key applied before start)**: On every boot, before qBittorrent starts, the `torrent`
      container must make its configuration carry exactly `TORRENT_API_KEY` as the WebUI API key. A
      different stored key is replaced, so `.env` is the source of truth and a rotation is "change
      `.env`, restart".
- [ ] **REQ-3 (Whitelist off)**: On every boot, before qBittorrent starts, the `torrent` container
      must leave the subnet whitelist disabled, both on a fresh `/config` and on an existing
      `qBittorrent.conf` written by an earlier version. The image must no longer seed the whitelist.
      Afterwards, no request reaches the WebUI or its API without either the API key or a WebUI
      login session. That holds whatever the request's source address: Traefik, the Docker host,
      another container or the LAN.
- [ ] **REQ-4 (Fail loudly without a key)**: If `TORRENT_API_KEY` is absent, empty or not in the
      accepted shape, the `torrent` container must stop with a non-zero exit code and a log line
      naming `TORRENT_API_KEY` and what is wrong with it. It never falls back to the whitelist: the
      whitelist is turned off (REQ-3) before the key is checked, so even the moment between the
      check and the container's shutdown serves nothing unauthenticated. Under the compose restart
      policy, the container then keeps restarting and failing the same way. This is the expected outcome for an installation upgraded by pulling new images
      under an old `docker-compose.yaml`. The documented upgrade path for this version is to re-run
      `install.sh`, which refreshes `docker-compose.yaml` and generates the key.
- [ ] **REQ-5 (`api` authenticates every call)**: Every request `api` sends to qBittorrent must carry
      the key. That covers every torrent operation and the shared-login password push used by
      `reset-password`. The key `api` sends must be the same `TORRENT_API_KEY` the `torrent`
      container applied, read without a manual step, so a rotation (REQ-2) followed by a restart of
      both containers leaves them in agreement. `api` must not rely on any subnet-based bypass.
- [ ] **REQ-6 (Distinct rejection)**: When qBittorrent rejects `api`'s credential (`401` or `403`),
      every user-facing operation that calls the torrent client must surface the new
      `error.download.torrent_client_unauthorized`. That means the download controls that already
      surface `error.download.torrent_client_rejected` and the six acquisition mutations
      (`addTorrentToMovie`, `addTorrentToEpisode`, `addTorrentToSeason`, `addMagnetToMovie`,
      `addMagnetToEpisode`, `addMagnetToSeason`). Any other qBittorrent failure on those paths
      surfaces `error.download.torrent_client_rejected`.
      - Today the acquisition mutations let the client's error escape with no key at all, contrary
        to what `docs/spec/graphql-contract.md`'s `059` section already states. This requirement
        makes that statement true.
      - The live-status reads that today degrade silently (the `torrents/info` reads behind
        `downloads`, `movieDownloads`, `showDownloads`, and `MediaSource.downloadedFiles`) keep
        degrading, but their log line must state that the credential was rejected.
      - `reset-password` must report the qBittorrent target as failed with a reason that names the
        rejected credential, not a bare `HTTP 403`.
- [ ] **REQ-7 (Web copy)**: `web` must render `error.download.torrent_client_unauthorized` from both
      catalogs, `en` and `es`, wherever it renders `error.download.torrent_client_rejected` today.
- [ ] **REQ-8 (Completion hook untouched)**: The `[AutoRun]` completion hook
      (`on-torrent-completed.sh`) calls `api`, not qBittorrent, and must keep working unchanged.
- [ ] **REQ-9 (Prowlarr fails loudly too)**: When `10-prowlarr-apikey` refuses to proceed, the
      `indexer` container must stop with a non-zero exit code instead of starting Prowlarr anyway.
      That covers its two existing refusals: `INDEXER_API_KEY` empty, and a `config.xml` with no
      `<ApiKey>` element to rewrite. Its log line must keep naming the cause, and Prowlarr must never
      run with a key it generated itself. Under the compose restart policy the container then keeps
      restarting and failing the same way, just like `torrent` (REQ-4). Behaviour with a valid key is
      unchanged: same `config.xml` handling, same login, same FlareSolverr proxy registration.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Secret stays secret)**: `TORRENT_API_KEY` must never appear in any log line of
      `torrent` or `api`, in any GraphQL response (`settings`, `environmentInfo` or any other), or in
      the Settings screen. It is a credential, like `JWT_SECRET`.
- [ ] **NFR-2 (Existing torrents survive)**: Upgrading an existing installation must not lose
      qBittorrent's torrents, resume data, categories, tags, save paths or the WebUI login. REQ-2 and
      REQ-3 change only the API key and the whitelist entries of `qBittorrent.conf`.
- [ ] **NFR-3 (No new exposure)**: The WebUI login (username/password set by `reset-password`) must
      keep working for a human in a browser. Turning the whitelist off must not replace it with
      another bypass: qBittorrent's localhost bypass stays at its secure default, so even the
      container's own healthcheck must not depend on an authenticated endpoint.
- [ ] **NFR-4 (Tests where failure is silent)**: The rejection mapping of REQ-6 is owed a test.
      A `401`/`403` laundered into the generic key, or a live read that drops the reason from its
      log, would leave an operator with a key mismatch and no way to tell it from qBittorrent being
      down (Article IX).

## GraphQL Contract Delta

No type, field, argument or operation changes. The delta is one new error key, plus the
acquisition mutations gaining the existing `error.download.torrent_client_rejected` they were
already documented as raising. Both apply to:
- the download controls that already raise `error.download.torrent_client_rejected`
  (`downloadStart`, `downloadStop`, `downloadDelete` and the per-job controls that reach the torrent
  client);
- `addTorrentToMovie`, `addTorrentToEpisode`, `addTorrentToSeason`, `addMagnetToMovie`,
  `addMagnetToEpisode` and `addMagnetToSeason`.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| qBittorrent answered `401`/`403` to `api`'s credential | `ServiceUnavailableException`, `extensions.i18n.key = error.download.torrent_client_unauthorized` | en: `The torrent client rejected Perceptor's credential: an administrator needs to check TORRENT_API_KEY` · es: `El cliente de torrents rechazó la credencial de Perceptor: un administrador tiene que revisar TORRENT_API_KEY` |
| qBittorrent answered any other non-2xx, or was unreachable | `ServiceUnavailableException`, `extensions.i18n.key = error.download.torrent_client_rejected` (`{ status }`, `0` when unreachable). Unchanged on the download controls, new on the six acquisition mutations | unchanged: `El cliente de torrents rechazó la solicitud ({status})` |

What `web` does with it: it renders the message exactly where it renders
`error.download.torrent_client_rejected` today. No new UI, no retry. The condition does not clear
until an administrator fixes the configuration, so retrying would not help.

`worker` is unaffected: it never talks to qBittorrent.

## Data Model Changes

None. The `torrent_api_key` row in `prisma/seeds/settings.ts` already exists, is empty and is read by
nothing. Whether `api` reads the key through that row (backfilled from the environment, as
`tracker_api_key` is from `INDEXER_API_KEY`) or straight from the environment is a plan decision,
bounded by REQ-5: a rotation in `.env` must reach `api` with no manual step. A create-only backfill
of the row would not satisfy that on its own.

## Acceptance Criteria

- [ ] **AC-1**: Given a fresh `install.sh` run with Traefik enabled, when `torrent.<DOMAIN>` is opened
      in a browser, then qBittorrent's login page is shown, and
      `curl -s -o /dev/null -w '%{http_code}' http://torrent.<DOMAIN>/api/v2/app/version` prints
      `403`.
- [ ] **AC-2**: On the same installation, from the Docker host,
      `curl -s -o /dev/null -w '%{http_code}' http://localhost:${QBITTORRENT_WEBUI_PORT}/api/v2/app/version`
      prints `403`.
- [ ] **AC-3**: On the same installation, a film is searched, a release is added from the torrent
      modal, and the download progresses, completes and encodes, with its row in `/downloads`
      showing live progress throughout. `api` authenticated every call.
- [ ] **AC-4**: `docker compose exec api node dist/scripts/reset-password.js <ADMIN_USER>` with a new
      password reports qBittorrent as updated, and logging in at `torrent.<DOMAIN>` with the new
      password works.
- [ ] **AC-5**: Given an installation created before this feature, with at least one torrent in
      qBittorrent and `AuthSubnetWhitelistEnabled=true` in its `qBittorrent.conf`, when `install.sh`
      is re-run, then:
      - `.env` gains a `TORRENT_API_KEY` of the accepted shape;
      - `docker compose exec torrent grep AuthSubnetWhitelistEnabled /config/qBittorrent/qBittorrent.conf`
        prints `...=false`;
      - the existing torrent still appears in `/downloads` with live status;
      - the WebUI login still accepts the old password.
- [ ] **AC-6 (failure)**: Given that same pre-feature installation, when only the images are updated
      (new `PERCEPTOR_TAG`, `docker compose pull && docker compose up -d`, old `docker-compose.yaml`
      kept), then `docker compose ps torrent` shows it restarting (each attempt exits non-zero),
      `docker compose logs torrent` names
      `TORRENT_API_KEY`, and `torrent.<DOMAIN>` does not serve an unauthenticated qBittorrent.
- [ ] **AC-7 (failure)**: Given `TORRENT_API_KEY` set to a value of the wrong shape (for example
      `qbt_` plus 32 hex characters), when `torrent` starts, then it exits non-zero with a log line
      naming `TORRENT_API_KEY` and its expected shape.
- [ ] **AC-8 (failure)**: Given a working installation, when `api` alone is restarted with a
      different `TORRENT_API_KEY` than `torrent` (for example
      `TORRENT_API_KEY=<other valid key> docker compose up -d --no-deps api`), then:
      - pressing Stop on a downloading row in `/downloads` shows *El cliente de torrents rechazó la
        credencial de Perceptor: un administrador tiene que revisar TORRENT_API_KEY*;
      - adding a release from a film's torrent modal shows the same message, and no `MediaSource`
        row is created for it;
      - `docker compose logs api` contains a line stating the torrent client rejected the
        credential;
      - neither the message nor the log contains either key.
- [ ] **AC-9**: Given a working installation, `docker compose logs torrent api` contains no
      occurrence of the `TORRENT_API_KEY` value, and neither the Settings screen nor the `settings`
      and `environmentInfo` queries return it.
- [ ] **AC-10 (failure)**: Given a working installation, when `indexer` is recreated with an empty
      `INDEXER_API_KEY` (`INDEXER_API_KEY= docker compose up -d --no-deps --force-recreate indexer`),
      then:
      - `docker compose ps indexer` shows it restarting (each attempt exits non-zero);
      - `docker compose logs indexer` names `INDEXER_API_KEY`;
      - the `<ApiKey>` in its `config.xml` is still the previously declared one, not a value Prowlarr
        generated.

      Recreating it again with the real `.env` brings search back with no other step.

## Out of Scope

- **The Kubernetes deployment.** This feature is what makes it possible, by removing the dependency
  on Docker's address range, but the manifests are their own spec.
- **Unpublishing `QBITTORRENT_WEBUI_PORT` from the host.** With the whitelist gone, that port
  requires a login like any other path in (REQ-3). Whether it should be published at all is a
  separate decision.
- **The rest of Prowlarr.** It already authenticates `api` by its own API key (`014`). Only its
  boot refusal changes (REQ-9). Its WebUI login and the `custom-services.d` scripts
  (`10-prowlarr-credentials`, `20-prowlarr-flaresolverr`) are untouched: they run as services after
  start, not as boot gates.
- **Rotating the key from the Settings screen.** `.env` is the source of truth (REQ-2). A UI rotation
  would need `api` to write back into `torrent`'s configuration, which crosses a boundary this
  feature does not open.
- **HTTPS between `api` and qBittorrent.** The key travels on the internal Docker network, the same
  as `INDEXER_API_KEY` and `SERVICE_TOKEN` already do.

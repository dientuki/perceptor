---
title: Development Stack Contract and FlareSolverr
spec_version: 0.2.0
author: Juan Farias
created_at: 2026-08-17
last_updated: 2026-08-17
status: Implemented
services: [api, web, infra]
---

# SPEC: Development Stack Contract and FlareSolverr (`spec.md`)

## Context & Goal

The stack in `docker-compose.yaml` is eight services deep — `traefik`, `web`, `api`, `db`, `worker`,
`redis`, `torrent`, `indexer` — and none of it is written down anywhere a reader can find it.
`docs/spec/docker/` holds exactly one file, `traefik.md`, written when the router landed and never
extended. Every other container carries development decisions that are not obvious and not
reconstructible from the value alone: `api`'s `start_period: 90s` is generous because the dev `CMD`
runs `npm install` and `prisma generate` before the process listens, `worker`'s
`stop_grace_period: 60s` exists because SVT-AV1 needs roughly nine seconds to unwind on `SIGTERM`
and `runner.ts` still has temporary files to remove on two disks afterwards, `api` mounts the
library root `:ro` because it only resolves and validates paths while `worker` is the one that
writes, and `MEDIA_GID` arrives through `group_add` rather than `PGID` because the folders that
Jellyfin reads have a different owning group than the one `torrent` and `indexer` run under. Today
those facts live as YAML comments, in Spanish, which Article VI no longer allows for anything
committed and which no spec references.

One container is also missing outright. FlareSolverr — the headless-browser proxy Prowlarr uses to
get past Cloudflare on the indexers that need it — runs **outside** the stack today, started by hand
with `docker run -d ghcr.io/flaresolverr/flaresolverr:latest` on Docker's default bridge with no
published port. Prowlarr reaches it through the machine's LAN address: the live instance has one
indexer proxy registered at `http://192.168.0.31:8191/` with `requestTimeout: 60`, carrying a tag
named `miresolver`, and two of its thirteen indexers (`1337x` and `kickasstorrents.ws`) wear that
tag while the other eleven go direct. That address is true on one machine and false on every other,
and the whole configuration — proxy, tag, and the tag assignments — disappears the moment the
`indexer_config` volume is recreated, because nothing in the repo reproduces it. `bin/dev` cannot
bring up a working search on a fresh checkout without a human opening Prowlarr's UI.

A third loose end resolves with the same piece. Prowlarr generates its own `ApiKey` on first boot
into `/config/config.xml`, and `services/indexer/custom-services.d/10-prowlarr-credentials` already
parses that key out in order to configure forms authentication — but nothing carries it to the
`api`, which reads it from the `tracker_api_key` setting in
`services/api/src/clients/indexer/client.ts`. Today a human copies it from Prowlarr's UI into the
Settings screen. This feature inverts the direction: the key becomes a deterministic value in
`.env`, Prowlarr is made to adopt it before it boots, and the `api` seed reads it from the
environment. Once this ships, the root `CLAUDE.md`'s **Find release (indexer)** row stops depending
on a manual configuration step and starts working from `bin/install` alone. No other pipeline row
changes status — this feature adds no stage and moves no data.

Scope is **development only**. Everything the repository already carries for production — the
`runner` stage in all three Dockerfiles, `BUILD_TARGET`, `bin/prod`, Traefik's `websecure` entrypoint
on `:443` — stays in the code untouched and unspecified here; see Out of Scope.

## Requirements

### Functional Requirements

The first block records what the development stack already does. Each is marked `[x]` because it is
true today; they are written down so that a later change that breaks one is visibly a change and not
an accident. The second block is the new behaviour.

#### The stack as it stands

- [x] **REQ-1 (Service selection)**: `bin/dev` must bring up `db redis api web worker torrent
      indexer`, prepending `traefik` only when `USE_TRAEFIK=true`, and must layer
      `docker-compose.gpu.yaml` (which maps `/dev/dri` into `worker` for libplacebo tonemapping) only
      when `USE_GPU=true`. It must refuse to start when `.env` is absent rather than let compose
      interpolate empty values. Traefik's own contract is `docs/spec/docker/traefik.md` and is not
      restated here.
- [x] **REQ-2 (`web` in development)**: Must bind-mount `./services/web:/app` so edits hot-reload and
      `node_modules` lands in the host working copy for the editor's TypeScript server; must set
      `WATCHPACK_POLLING=true`, without which Next's watcher misses host file events through Docker
      on Linux; must expose `NEXT_PUBLIC_UPLOAD_URL` separately from `INTERNAL_GRAPHQL_URL`, because
      the upload modal runs in the browser and cannot resolve a Docker service name; and must allow
      `start_period: 60s` before healthchecks count, because a clean checkout installs dependencies
      inside the dev `CMD` first.
- [x] **REQ-3 (`api` in development)**: Must run as `${PUID}:${PGID}` with `MEDIA_GID` added through
      `group_add`, because `/uploads` writes into the downloads disk and the resulting file must be
      readable by `worker`; must mount the downloads root read-write and the library root **read-only**,
      because path resolution is its job and writing is not; must allow `start_period: 90s` for the
      same reason as `web`; must receive `JWT_SECRET` with no default, so that
      `auth.constants.ts`'s `assertAuthEnv()` fails the boot loudly instead of running unauthenticated;
      and must map `host.docker.internal` to `host-gateway`, because the media server runs outside the
      stack on the user's own machine.
- [x] **REQ-4 (`worker` in development)**: Must bind-mount its source for hot reload, must mount both
      media roots read-write, must carry `SERVICE_TOKEN` as its identity against the `api`'s GraphQL
      guard, and must be given `stop_grace_period: 60s` so an in-flight encode can unwind and clean
      up before Docker escalates to `SIGKILL`. It must have no published port, no healthcheck and no
      Traefik labels: it is reachable only through the Redis queue.
- [x] **REQ-5 (`db` and `redis` in development)**: Must publish their ports to the host for
      inspection from an external client, which is a development affordance and not part of any
      service contract — no service reaches either one across the host boundary. Redis must run with
      `--maxmemory-policy noeviction`, because evicting a key would silently drop a queued job.
- [x] **REQ-6 (`torrent` in development)**: Must set a stable WebUI password from
      `QBITTORRENT_USER`/`QBITTORRENT_PASSWORD` through `custom-cont-init.d`, so the UI does not rotate
      a temporary password on every boot; must whitelist `172.16.0.0/12` so calls from inside
      `perceptor-net` skip authentication; must share the downloads root with `api` and `worker`; and
      must mount `./services/torrent/commands:/commands:ro` as the AutoRun hook that reports
      completion back to the `api`.
- [x] **REQ-7 (`indexer` in development)**: Must configure Prowlarr through `custom-services.d` rather
      than `custom-cont-init.d` for anything that has to talk to Prowlarr's API, because
      `config.xml` is written by Prowlarr itself on first boot and a `cont-init.d` script that waits
      for it deadlocks the very process it is waiting for; and must use a `with-contenv` shebang,
      because an s6 service otherwise starts with an empty environment and never sees
      `INDEXER_USER`/`INDEXER_PASSWORD`.

#### What this feature adds

- [x] **REQ-8 (FlareSolverr is a stack service)**: The stack must include a `flaresolverr` service on
      `perceptor-net`, brought up by `bin/dev` alongside the rest. It must pin an explicit image
      version rather than `latest` — every other image in the stack is pinned, and a proxy that
      silently changes browser behaviour between two `bin/dev` runs is a debugging trap. It must
      publish no host port and declare no Traefik labels: its only consumer is Prowlarr, on the same
      Docker network. Its healthcheck must use the interpreter already present in the image rather
      than assuming a shell utility that is not — the image ships neither `curl` nor `wget`.
- [x] **REQ-9 (Prowlarr is pre-configured against it)**: On a stack brought up with an empty
      `indexer_config` volume, Prowlarr must end up with a FlareSolverr indexer proxy pointing at the
      **service name**, not at any host or LAN address, and with a tag attached to that proxy, with no
      human opening Prowlarr's UI. Reaching that state must be idempotent: bringing the stack up again
      must not create a second proxy or a second tag, and must not overwrite a proxy that already
      points where it should.
- [x] **REQ-10 (Which indexers use the proxy stays the user's decision)**: The stack must **not**
      attach the proxy's tag to any indexer. Only the indexers that actually sit behind Cloudflare
      benefit from it — two of thirteen on the live instance — and routing the rest through a headless
      browser makes every search slower for no gain. This is a deliberate stopping point, not an
      unfinished one.
- [x] **REQ-11 (The indexer API key is declared, not discovered)**: `INDEXER_API_KEY` must exist in
      `.env` as the single source of truth for Prowlarr's API key, and `bin/install` must populate it
      the same way it already populates `JWT_SECRET` and `SERVICE_TOKEN` — filling it only when empty,
      leaving an existing value alone. On a checkout whose `indexer_config` volume already holds a
      Prowlarr-generated key, `bin/install` must **adopt** that key rather than invent a new one, so
      that upgrading does not invalidate a working configuration.
- [x] **REQ-12 (Prowlarr adopts the declared key before it boots)**: The `indexer` container must
      apply `INDEXER_API_KEY` to Prowlarr's configuration **before** Prowlarr starts, on both a fresh
      volume and an existing one. Applying it afterwards through Prowlarr's API is not acceptable:
      changing the key at runtime makes Prowlarr restart itself, which turns every `bin/dev` into a
      restart loop for as long as the two values disagree. Writing a configuration file is not
      waiting on anything, so this is the one piece of Prowlarr setup that belongs before the app
      starts rather than beside it (contrast REQ-7).
- [x] **REQ-13 (Empty key fails loudly)**: If `INDEXER_API_KEY` is empty the `indexer` container must
      fail with an explicit message and must not fall back to letting Prowlarr generate a random key.
      A random key boots a perfectly healthy Prowlarr that the `api` cannot authenticate against, and
      the resulting failure surfaces as an empty search result, not as an error — the same reasoning
      that already makes `10-prowlarr-credentials` abort on an empty `INDEXER_PASSWORD`.
- [x] **REQ-14 (The `api` reads the key from the environment)**: The `api` must receive
      `INDEXER_API_KEY` and its settings seed must use it as the value of `tracker_api_key`. Because
      the seed is deliberately create-if-not-exists — so that a re-run never overwrites a real
      configured value — it must additionally fill the row when it exists but is **empty**, which is
      the state every current installation is in before a human pastes the key. A row holding a
      non-empty value must be left untouched.
- [x] **REQ-15 (A failed indexer search says so)**: A search that the indexer does not answer
      successfully must reach the user as an error, not as an empty result list. Today
      `ProwlarrClient.getData` (`services/api/src/clients/indexer/client.ts`) parses the response body
      without ever checking the status, so a `401` — the exact failure a wrong `tracker_api_key`
      produces — is fed to the release filter as if it were a list of releases, and the user is told
      there is nothing to download. The `api` must reject a non-success response, and `web` must
      render the resulting message in the search dialog instead of writing it to the browser console.
      This requirement exists because it is the failure that would hide every other failure in this
      feature: without it, a mismatched key is indistinguishable from a title nobody has released.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Idempotent across reruns and across volume resets)**: Every configuration step this
      feature adds must converge to the same state whether it runs against a fresh volume, an already
      configured one, or a partially configured one interrupted halfway. The existing
      `10-prowlarr-credentials` is the model: read current state, compare, act only on a difference.
- [x] **NFR-2 (Upgrade path for existing checkouts)**: A developer pulling this feature must reach a
      working stack by re-running `bin/install` and answering "no" to regenerating `.env`, exactly as
      documented for `002-auth-login`. Their existing Prowlarr configuration — indexers, credentials,
      and the proxy they configured by hand — must survive, and their already-populated
      `tracker_api_key` must keep working.
- [x] **NFR-3 (No new host dependency)**: The stack must remain startable with `bin/dev` and nothing
      else. FlareSolverr moving inside the stack must remove the manual `docker run`, not add a
      second thing to remember. Article I: nothing runs on the host.
- [x] **NFR-4 (Language)**: Every file this feature creates or rewrites must be in English, including
      the shell comments inside the new container scripts. The Spanish comments in
      `docker-compose.yaml` and in the existing `services/indexer/` and `services/torrent/` scripts
      predate Article VI; this feature translates only the blocks it is already editing and leaves the
      rest, so the diff stays reviewable.
- [x] **NFR-5 (Secrets stay out of the repository)**: `INDEXER_API_KEY` is a generated secret. It
      belongs in `.env` and in `.env.example` as an empty key with a comment, never with a value, and
      it must not appear in any document, including this one (Article V's sibling rule for paths, same
      spirit).

## GraphQL Contract Delta

**No schema change.** No type, field or argument is added, removed or altered.
`services/api/src/schema.gql` must be byte-identical before and after this feature — a diff on that
file is a bug, not a side effect. `tracker_api_key` is an existing row in the `settings` table,
already exposed through the existing `settings` query and `updateSettings` mutation and already
rendered by `SettingsForm.tsx`; this feature changes where its initial value comes from, not the
shape of anything `web` or `worker` reads.

**One new error condition on an existing query.** REQ-15 makes `searchTorrents` fail where it used to
return an empty list, and that is a contract change even though the schema cannot express it — which
is precisely why `docs/spec/graphql-contract.md` exists.

```graphql
type Query {
  # unchanged signature — the delta is which conditions raise instead of returning []
  searchTorrents(query: String!): [TorrentResult!]!
}
```

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| The indexer answers with a non-success status (`401` from a wrong API key, `404`, `5xx`) | `ServiceUnavailableException` | `No se pudo consultar el indexer (HTTP <status>)` |
| The indexer is unreachable (DNS failure, connection refused) | `ServiceUnavailableException` | `No se pudo consultar el indexer` |
| The indexer answers successfully with no matching releases | *not an error* | — the empty list keeps meaning "nothing found", which is the distinction this requirement restores |

**Consumer obligations — `web`.** `searchTorrentsAction`
(`services/web/src/actions/indexer.ts`) already rethrows the first GraphQL error and needs no change.
`SearchTorrent.tsx` does: its `handleSearch` currently catches the error and only calls
`console.error`, so the dialog falls back to an empty result table and the user is told nothing. It
must render the message, reusing the error surface the component already has for the add-torrent path
rather than introducing a second one.

**Consumer obligations — `worker`.** None. The worker does not call `searchTorrents`.

## Data Model Changes

**None.** No Prisma model, field or enum changes; no migration. The only database write is a seed
value for a `Setting` row whose key already exists.

## Acceptance Criteria

- [x] **AC-1**: `bin/dev` brings up nine services, and `docker compose ps` reports `perceptor-flaresolverr`
      as `healthy`.
- [x] **AC-2 (the "pre-configured" criterion)**: Given a stack stopped and its indexer volume removed
      with `docker compose down && docker volume rm perceptor_indexer_config`, when `bin/dev` runs to
      completion, then Prowlarr's `GET /api/v1/indexerproxy` returns exactly one proxy, with
      `implementation: "FlareSolverr"`, its `host` field set to the `flaresolverr` service URL, and a
      non-empty `tags` array — with no human having opened Prowlarr's UI.
- [x] **AC-3 (idempotence)**: Running `bin/dev` a second time against the volume left by AC-2 leaves
      `GET /api/v1/indexerproxy` and `GET /api/v1/tag` each returning the same single entry, with the
      same `id`.
- [x] **AC-4 (the key agrees in all three places)**: After AC-2, the `tracker_api_key` row returned by
      ``bin/mysql -e 'select `key`, value from settings'`` holds the same value as `INDEXER_API_KEY` in
      `.env`, and the same value as the `<ApiKey>` element of `/config/config.xml` inside the `indexer`
      container.
- [x] **AC-5 (the proxy actually resolves)**: With the tag from AC-2 attached by hand to an indexer
      that sits behind Cloudflare, a search from `/movies` returns results, and
      `docker compose logs flaresolverr` shows the corresponding request.
- [x] **AC-6 (failure path, empty key)**: With `INDEXER_API_KEY=` in `.env`, `bin/dev` leaves the
      `indexer` container reporting an explicit error in `docker compose logs indexer`, and Prowlarr
      does not come up holding a randomly generated key.
- [x] **AC-7 (failure path, FlareSolverr down)**: With the `flaresolverr` service stopped, a search
      against a tagged indexer fails visibly in Prowlarr's own logs rather than returning an empty
      result set that looks like "no releases found".
- [x] **AC-8 (upgrade path)**: On a checkout whose stack has been running before this feature, running
      `bin/install` and answering "no" to regenerating `.env` writes `INDEXER_API_KEY` with the key
      already present in the `indexer` volume, and the subsequent `bin/dev` leaves Prowlarr's existing
      indexers and credentials intact.
- [x] **AC-9 (failure path, a wrong key is visible)**: With `tracker_api_key` set to a wrong value
      from the Settings screen, a search from `/movies` shows `No se pudo consultar el indexer (HTTP
      401)` in the search dialog. It must not show an empty result table, which is what happens today
      and is indistinguishable from "nothing was released" (REQ-15).
- [x] **AC-10 (nothing regressed)**: `bin/cli api npx --no tsc --noEmit` reports 0 errors,
      `bin/npm api test` reports 122 pre-existing tests still passing plus the new indexer-client
      suite, `bin/npm web run build` fails on the same 4 pre-existing files and no others, and
      `git diff` shows `services/api/src/schema.gql` unchanged.

## Out of Scope

- **Production, in every form.** The `runner` stage of all three Dockerfiles, `BUILD_TARGET=runner`,
  `bin/prod`, Traefik's `websecure` entrypoint and TLS, and the restart policies as they apply to an
  unattended host all stay in the code exactly as they are and are neither described nor changed
  here. This spec is the development contract; production is its own spec.
- **Distribution as a Docker image.** The stated end state — Perceptor shipped as an image against a
  database the image does not carry — changes where seeding happens: the `api` would have to reconcile
  its settings on boot rather than rely on `bin/install` having run. That is a real requirement and it
  is not this one. REQ-14 deliberately stays inside the existing seed.
- **Automatically tagging indexers.** REQ-10 states the reason. Deciding which indexers need a
  headless browser is a judgement about specific trackers, and the stack has no way to make it.
- **Propagating Prowlarr's other settings to the `api`.** Only `tracker_api_key` moves. `tracker_host`
  and `tracker_port` are already correct service-name defaults in the seed and need no mechanism.
- **The commented-out `depends_on` block in the `api` service.** It refers to a service named
  `prowlarr`, which does not exist — the service is called `indexer` — so it could not have worked as
  written. Removing it is a one-line cleanup with a wrong-looking blast radius while `api`'s
  dependency ordering is otherwise untouched here; it belongs to whatever spec next revisits startup
  ordering.
- **Traefik's dashboard.** It stays commented out. A development affordance nobody has asked for.
- **Retiring `docs/spec/docker/`.** `traefik.md` remains the one document there and stays accurate;
  REQ-1 references it instead of restating it. Whether the directory grows or folds into feature
  specs is a documentation decision, not this feature's.

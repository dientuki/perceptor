---
title: Development Stack Contract and FlareSolverr — Tasks
last_updated: 2026-08-17
status: Done
---

# TASKS: Development Stack Contract and FlareSolverr (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[infra]` | Repo-root and third-party-container territory — `bin/`, `docker-compose.yaml`, `.env.example`, `services/*/Dockerfile`, the container config under `services/torrent/` and `services/indexer/`, and `docs/spec/docker/`. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[worker]` tasks: the worker does not call `searchTorrents`, does not read `INDEXER_API_KEY`, and
is untouched by this feature.

## Tasks

### Group 1 — the declared key

`INDEXER_API_KEY` is the head of the chain. Until it exists as a name in `.env`, nothing downstream
can be tested against a real value.

- [x] **T001** `[infra]` Add `INDEXER_API_KEY=` (empty) to `.env.example`, immediately after
      `INDEXER_PASSWORD`, with an English comment stating it is Prowlarr's API key, that
      `bin/install` fills it, and that the `api` reads the same value as `tracker_api_key`. No value
      committed, ever.
      *Done when:* `grep -n INDEXER_API_KEY .env.example` prints the key with an empty value and the
      comment above it.

- [x] **T002** `[infra]` In `bin/install`, add the adopt-or-generate block after the `JWT_SECRET`
      block and before `docker compose up`: when `INDEXER_API_KEY` is empty, read any existing
      `<ApiKey>` out of the `indexer` volume with
      `docker compose run --rm --no-deps --entrypoint /bin/sh indexer` and adopt it; otherwise
      generate `openssl rand -hex 16`. Reuse `ensure_env_var`. Print which branch ran, and a note
      that a host-side FlareSolverr started with `docker run` is now redundant. → T001
      *Done when:* on a checkout whose `indexer` volume already holds a key, `bin/install` (answering
      "no" to regenerating `.env`) writes that exact key into `.env`, and on a machine with no volume
      it writes a fresh 32-hex value. Both branches confirmed by running the script and reading
      `.env` (AC-8).

- [x] **T003** `[infra]` Create `services/indexer/custom-cont-init.d/10-prowlarr-apikey` and add
      `COPY --chmod=755 custom-cont-init.d/ /custom-cont-init.d/` to `services/indexer/Dockerfile`.
      One task because the build fails with either half missing. The script aborts loudly on an empty
      `INDEXER_API_KEY`, rewrites the `<ApiKey>` element in place when `/config/config.xml` exists,
      writes a minimal `<Config>` when it does not, and `lsiown abc:abc` afterwards. → T001
      *Done when:* `bin/dev` brings `indexer` up healthy and
      `bin/cli indexer sed -n 's:.*<ApiKey>\(.*\)</ApiKey>.*:\1:p' /config/config.xml` prints the
      value of `INDEXER_API_KEY`; with `INDEXER_API_KEY=` emptied, `docker compose logs indexer`
      shows an explicit error and Prowlarr does not come up with a random key (AC-6).
      *Report:* whether Prowlarr accepted the minimal `config.xml` on a fresh volume — this is the
      one step in the feature not confirmed against a live instance. If it did not, apply the
      fallback in `infra/plan.md` step 10 and say so.
      *Verified:* Prowlarr accepted the minimal `<Config><ApiKey>…</ApiKey></Config>` on a fresh
      volume with no fallback needed — confirmed against `docker volume rm perceptor_indexer_config`.

### Group 2 — the container

- [x] **T004** `[infra]` In `docker-compose.yaml`: add the `flaresolverr` service
      (`ghcr.io/flaresolverr/flaresolverr:v3.5.0`, `container_name: perceptor-flaresolverr`,
      `restart: unless-stopped`, `TZ`/`LOG_LEVEL`, the same `dns:` pair as `indexer`, on
      `perceptor-net`, **no `ports:`, no `labels:`**, healthcheck via the image's own `python`); give
      `indexer` a `depends_on: flaresolverr: condition: service_healthy` and
      `INDEXER_API_KEY=${INDEXER_API_KEY}`; give `api` `INDEXER_API_KEY=${INDEXER_API_KEY}`. → T001
      *Done when:* `docker compose config` resolves without error and `docker compose ps` reports
      `perceptor-flaresolverr` as `healthy` with `perceptor-indexer` healthy after it.

- [x] **T005** `[infra]` Add `flaresolverr` to the `SERVICES` string in `bin/dev` and `bin/prod`. → T004
      *Done when:* `bin/dev` brings up nine services and `docker compose ps` lists all nine (AC-1).

- [x] **T006** `[infra]` Create `services/indexer/custom-services.d/20-prowlarr-flaresolverr`:
      `with-contenv` shebang, poll `/api/v1/system/status` with `$INDEXER_API_KEY` until it answers,
      ensure the `flaresolverr` tag, then ensure the FlareSolverr indexer proxy built from
      `GET /api/v1/indexerproxy/schema` with `host = http://flaresolverr:8191/` and
      `requestTimeout: 60` — creating it when absent, repointing it when its `host` differs, doing
      nothing when it already matches. Ends with `exec sleep infinity`. It must **not** attach the tag
      to any indexer (REQ-10). → T003, T004
      *Done when:* after `docker compose down && docker volume rm perceptor_indexer_config && bin/dev`,
      `bin/cli indexer curl -s -H "X-Api-Key: $INDEXER_API_KEY" http://localhost:9696/api/v1/indexerproxy`
      returns exactly one proxy with `implementation: "FlareSolverr"`, that `host`, and a non-empty
      `tags`, with no human having opened Prowlarr's UI (AC-2); and running `bin/dev` again leaves the
      `id` of both that proxy and the tag unchanged (AC-3).

### Group 3 — the application slices

Both depend only on things frozen at approval, so they run alongside Groups 1–2 rather than after
them. `T010` is the one real ordering constraint inside this group: it renders an error that only
exists once `T008` raises it.

- [x] **T007** `[api] [P]` In `services/api/prisma/seeds/settings.ts`, seed `tracker_api_key` from
      `process.env.INDEXER_API_KEY` (defaulting to `''`), and extend the existing create-only loop so
      it also fills a row that exists with an **empty** value. A row with any non-empty value stays
      untouched. Rewrite that block's Spanish comment in English. → T001
      *Done when:* after `bin/cli api npx --no ts-node prisma/seeds/index.ts`, the `tracker_api_key`
      row from ``bin/mysql -e 'select `key`, value from settings'`` equals `INDEXER_API_KEY` in `.env`
      and equals the `<ApiKey>` in the `indexer` container (AC-4); re-running the seed leaves it
      unchanged, and a row hand-edited to a different non-empty value survives a re-run.

- [x] **T008** `[api] [P]` In `services/api/src/clients/indexer/client.ts`, make `getData` check the
      response before parsing it: raise `ServiceUnavailableException` with
      `No se pudo consultar el indexer (HTTP <status>)` on a non-success status, and
      `No se pudo consultar el indexer` when the `fetch` itself fails. Both strings are frozen copy —
      copy them from `spec.md`, do not reword. A successful response carrying an empty list still
      returns `[]` and must not raise. Leave `filterData`, `resolveInfoHash`, `filterIAData` and
      `score.ts` alone.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and
      `git diff --stat services/api/src/schema.gql` prints nothing.

- [x] **T009** `[api]` Create `services/api/src/clients/indexer/client.spec.ts`, opening with a
      comment naming the failure it prevents (a `401` parsed as a release list, surfacing as "no
      releases found"), following `services/api/src/clients/torrent/magnet.spec.ts`. Cover: `401`
      raises with the status in the message; `500` raises; a rejected `fetch` raises the no-status
      message; a `200` with an empty array returns `[]` and does **not** raise. → T008
      *Done when:* `bin/npm api test` passes with the 122 pre-existing tests plus this suite.
      *Verified:* baseline was actually 152/15, not 122/13 (docs were stale) — confirmed
      156 passing / 16 suites after this task (152 + 4 new).

- [x] **T010** `[web]` In `services/web/src/components/search/SearchTorrent.tsx`, stop swallowing the
      search error: store the thrown message in state, clear it and `results` at the start of each
      search, clear `results` on failure, and render the message reusing the existing `addError`
      presentation. Do **not** edit `services/web/src/actions/indexer.ts` — it already rethrows
      correctly. → T008
      *Done when:* `bin/npm web run build` fails on the same 4 pre-existing files and no others, with
      `SearchTorrent.tsx` absent from the output; and with `tracker_api_key` set to a wrong value, a
      search from `/movies` shows `No se pudo consultar el indexer (HTTP 401)` in the dialog instead
      of an empty table (AC-9).

### Group 4 — verification and docs

- [x] **T011** `[docs]` Update the root `CLAUDE.md`: the **Find release (indexer)** pipeline row (no
      longer needs a manual API-key paste; FlareSolverr is in-stack), the topology diagram and the
      service list in § *Docker-first workflow*, the `.env` variable list in § *Environment* with
      `INDEXER_API_KEY`, and the § *Current state* counts if `bin/npm api test` moved. → T006, T007,
      T009, T010

- [x] **T012** `[docs]` Walk every acceptance criterion in `spec.md` and tick it. AC-5 and AC-7 are
      manual and have no other owner: attach the `flaresolverr` tag to one Cloudflare-fronted indexer
      in Prowlarr's UI, search from `/movies`, confirm results appear and
      `docker compose logs flaresolverr` shows the request (AC-5); then stop `flaresolverr` and repeat,
      confirming the failure is visible in Prowlarr's logs rather than silently empty (AC-7). Re-run
      the four regression gates as a set rather than trusting the individual slices — `bin/cli api npx
      --no tsc --noEmit`, `bin/npm api test`, `bin/npm web run build`, `git diff --stat
      services/api/src/schema.gql` (AC-10). Then set `status: Implemented` on `spec.md`, `plan.md`,
      `api/plan.md`, `web/plan.md` and `infra/plan.md`. → T011

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty
entry is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

---
title: Development Stack Contract and FlareSolverr — infra slice
service: infra
last_updated: 2026-08-17
status: Implemented
---

# PLAN: Development Stack Contract and FlareSolverr — `infra` (`infra/plan.md`)

## Scope

Everything outside `services/api/src` and `services/web/src` that this feature touches: a
`flaresolverr` service in `docker-compose.yaml`, `INDEXER_API_KEY` in `.env.example` and
`bin/install`, the `bin/` entry points that decide which services come up, the `indexer` image, and
the two init scripts inside it that configure Prowlarr.

**A note on the task tag.** Every task from this plan carries **`[infra]`**, including the two
scripts inside the `indexer` container: third-party container configuration is this slice's, not any
application service's. The older `[orch]` catch-all was retired by `003-auth-user-management`, whose
plan records the handover — "a fourth agent, `infra`, now owns `bin/`/`docker-compose.yaml`/`.env.example`
instead of the orchestrator doing it by hand". `.claude/commands/tasks.md` has said `[infra]` since;
`docs/spec/features/_templates/tasks.md` had not caught up and was corrected while this plan was
written, along with the scope line in `.claude/agents/infra.md`, which enumerated the Dockerfiles but
not the init scripts beside them.

It is explicitly **not** touching `services/api/` or `services/web/`. The seed that consumes
`INDEXER_API_KEY` is `../api/plan.md`; making a failed indexer search visible is `../api/plan.md`
and `../web/plan.md`. It also does not modify `services/indexer/custom-services.d/10-prowlarr-credentials`
— that script keeps working unchanged, and a diff on it means this plan missed something.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `docker-compose.yaml` | Modified | New `flaresolverr` service; `indexer` gains `depends_on: flaresolverr` and `INDEXER_API_KEY`; `api` gains `INDEXER_API_KEY`. |
| `.env.example` | Modified | New `INDEXER_API_KEY=` (empty, with a comment) beside `INDEXER_USER`/`INDEXER_PASSWORD`. |
| `bin/install` | Modified | Adopt-or-generate `INDEXER_API_KEY` before the stack comes up. |
| `bin/dev` | Modified | `flaresolverr` joins the `SERVICES` list. |
| `bin/prod` | Modified | Same one-line change, for consistency of the list only. |
| `services/indexer/Dockerfile` | Modified | `COPY --chmod=755 custom-cont-init.d/ /custom-cont-init.d/`. |
| `services/indexer/custom-cont-init.d/10-prowlarr-apikey` | New | Applies `INDEXER_API_KEY` to `/config/config.xml` before Prowlarr starts. |
| `services/indexer/custom-services.d/20-prowlarr-flaresolverr` | New | Ensures the `flaresolverr` tag and the FlareSolverr indexer proxy through Prowlarr's API. |

## Existing code to reuse

- `bin/install`'s `ensure_env_var` (line 18) — writes a variable, appending the line when the key is
  absent. This is what makes the upgrade path work for a `.env` that predates the variable, exactly
  as it already does for `JWT_SECRET` and `SERVICE_TOKEN`. Use it; do not write a third helper.
- `bin/install`'s `JWT_SECRET` block (lines 93–97) — the shape to copy literally: read the current
  value with `grep '^KEY=' .env | cut -d= -f2-`, act only when empty, never overwrite.
- `bin/dev` lines 15–18 — the `SERVICES` string and the `USE_TRAEFIK` prepend. `flaresolverr` is
  unconditional: no toggle, no `USE_*` variable (see `../plan.md` § Contract Freeze on why no
  `FLARESOLVERR_PORT` either).
- The `indexer` service block in `docker-compose.yaml` — the nearest model for the new service:
  `restart: unless-stopped`, explicit `dns:` entries, `perceptor-net`, a healthcheck with a
  `start_period`. Match its shape rather than inventing a different one.
- `services/indexer/custom-services.d/10-prowlarr-credentials` — the template for the proxy script,
  to be read line by line before writing anything. Reuse: the `#!/usr/bin/with-contenv bash` shebang
  and the reason for it (an s6 service otherwise starts with an empty environment and never sees the
  variable), `set -euo pipefail`, the abort-on-empty-secret guard, the
  `until curl -sf …; do sleep 2; done` poll, read-current-state-then-compare instead of a blind
  write, the `[20-prowlarr-flaresolverr]` log-prefix convention, and `exec sleep infinity` at the end
  so s6 does not restart a finished service in a loop.
- `services/torrent/custom-cont-init.d/10-qbittorrent-password` — the template for the API-key
  script: a `cont-init.d` script that rewrites a third-party config file before its application
  starts, aborts loudly on an empty secret rather than letting the app generate its own, and edits in
  place with line-oriented tools instead of a parser.
- `jq` — already installed by `services/indexer/Dockerfile`. The proxy script uses it; no new package.
- `sed` with a captured group — the existing script's own comment records why (`BusyBox grep has no
  -P`). Same constraint applies.
- `docs/spec/docker/traefik.md` — the label contract, consulted only to confirm it does **not**
  apply: `flaresolverr` gets no Traefik labels because it has no ingress.

## Steps

### Stack wiring

1. **`.env.example`** — add `INDEXER_API_KEY=`, empty, immediately after `INDEXER_PASSWORD`, with an
   English comment saying it is Prowlarr's API key, that `bin/install` fills it, and that the `api`
   reads the same value as its `tracker_api_key` setting. No value, ever (`spec.md` NFR-5).
2. **`docker-compose.yaml` — the new service.** `image: ghcr.io/flaresolverr/flaresolverr:v3.5.0`
   (verified as the version currently running on the host; pin it, never `latest`),
   `container_name: perceptor-flaresolverr`, `restart: unless-stopped`, `TZ` and `LOG_LEVEL`, the
   same `dns:` pair as `indexer` and `torrent` since it resolves tracker domains itself, on
   `perceptor-net`. **No `ports:`, no `labels:`, no build context.** Healthcheck must call the
   image's own interpreter — verified working against the running container:

   ```yaml
   test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8191/health')"]
   ```

   Give it a `start_period` generous enough for the headless browser to come up (30s is the starting
   point; raise it if `docker compose ps` shows it flapping, do not lower it).
3. **`docker-compose.yaml` — the wiring.** `indexer` gains `depends_on: flaresolverr: condition:
   service_healthy` and `INDEXER_API_KEY=${INDEXER_API_KEY}` in its `environment:`; `api` gains
   `INDEXER_API_KEY=${INDEXER_API_KEY}` in its `environment:`. Add an English comment on each
   pointing at what reads it, in the style of the existing `SERVICE_TOKEN` and `JWT_SECRET` comments.
4. **`bin/install`** — after the `JWT_SECRET` block and before `docker compose up`, add the
   adopt-or-generate block. When `INDEXER_API_KEY` is empty, first try to read an existing key out of
   the `indexer` volume, and only generate when that comes back empty:

   ```bash
   existing_key=$(docker compose run --rm --no-deps --entrypoint /bin/sh indexer \
     -c 'sed -n "s:.*<ApiKey>\(.*\)</ApiKey>.*:\1:p" /config/config.xml 2>/dev/null' | tr -d '\r\n')
   ```

   `--entrypoint /bin/sh` bypasses the LinuxServer `/init` chain so nothing boots; `--no-deps` keeps
   it from dragging `flaresolverr` up. If that yields a key, `ensure_env_var INDEXER_API_KEY` with it
   and print that the existing key was adopted; otherwise generate `openssl rand -hex 16` (32 hex
   characters, Prowlarr's own format) and print that a new one was created. `openssl` on the host is
   already the precedent set by `JWT_SECRET`, so this adds no host dependency.
5. **`bin/install`** — print a one-line note that a host-side FlareSolverr started with `docker run`
   is now redundant and can be stopped. Interactive operator output stays Spanish, matching every
   other message in the script (Article VI carve-out, restated in `.claude/agents/infra.md`).
6. **`bin/dev` and `bin/prod`** — add `flaresolverr` to the `SERVICES` string in both.
7. **`services/indexer/Dockerfile`** — add `COPY --chmod=755 custom-cont-init.d/ /custom-cont-init.d/`
   beside the existing `custom-services.d` line. The build fails until step 8 has created that
   directory, so do the two together.

### `custom-cont-init.d/10-prowlarr-apikey`

8. `with-contenv` shebang and `set -euo pipefail`. Abort with an explicit message when
   `INDEXER_API_KEY` is empty (`spec.md` REQ-13). Do **not** fall through to letting Prowlarr
   generate one: that produces a healthy container the `api` cannot authenticate against.
9. If `/config/config.xml` exists with an `<ApiKey>` equal to `INDEXER_API_KEY`, log and do nothing —
   the steady state on every boot after the first. If it exists with a different key, replace just
   that element in place with `sed`, leaving every other element untouched.
10. If it does not exist, write a minimal `<Config><ApiKey>…</ApiKey></Config>`. Prowlarr fills in
    every element it does not find when it first saves its configuration.
    **Verify this rather than assume it** — it is the one step in the feature resting on Servarr
    behaviour that was not confirmed against the live instance. AC-2 is the check. If Prowlarr
    rejects the minimal file, the fallback is to let it generate its own and move the key change into
    the proxy script via `PUT /api/v1/config/host` (whose payload does include `apiKey` — confirmed),
    accepting the one-time self-restart that follows. That is a change of mechanism, not of contract,
    so it needs no spec amendment — but say so in the report.
11. `lsiown abc:abc /config/config.xml` after writing. The script runs as root and Prowlarr runs as
    `abc`; a file it cannot rewrite breaks it later, not now. If `lsiown` is absent from this base
    image, `chown abc:abc` is the equivalent — check before assuming.

### `custom-services.d/20-prowlarr-flaresolverr`

12. Same preamble as `10-prowlarr-credentials`. Define the target URL as a constant:
    `http://flaresolverr:8191/`. That string is frozen (`../plan.md` § Contract Freeze) — it is the
    compose **service** name, not `perceptor-flaresolverr` and not an IP.
13. Poll `GET /api/v1/system/status` with `X-Api-Key: $INDEXER_API_KEY` until it succeeds. This single
    loop covers both waits at once: Prowlarr being up, and step 8's key having taken effect. There is
    no need to parse `config.xml` here — the key is declared, not discovered.
14. Ensure the tag: `GET /api/v1/tag`, look for `label == "flaresolverr"`, `POST {"label":"flaresolverr"}`
    only when absent. Keep its `id`.
15. Ensure the proxy: `GET /api/v1/indexerproxy`, look for an entry with
    `implementation == "FlareSolverr"`.
    - **Absent** — build the body from `GET /api/v1/indexerproxy/schema`, taking the entry whose
      `implementation` is `FlareSolverr` (it arrives with its `fields` array already shaped, so a
      Prowlarr upgrade that adds a field does not break this). Set `host` and `requestTimeout: 60`,
      set `name` and `tags: [<tagId>]`, then `POST /api/v1/indexerproxy`.
    - **Present with the right `host` and the tag attached** — do nothing.
    - **Present otherwise** — set `host` and ensure the tag is in `tags`, then
      `PUT /api/v1/indexerproxy/{id}`.

    The script owns this proxy: it is the only FlareSolverr proxy the stack expects, and reconciling
    it to the declared state is the point. A proxy configured by hand against a host-side FlareSolverr
    gets repointed at the in-stack service, which is the intended migration, not a collision.
16. `exec sleep infinity`, same reasoning as the existing script.

## Contract obligations

`../spec.md` § GraphQL Contract Delta carries one error condition, and none of it is this slice's to
implement — it belongs to `api` and `web`. This slice has no GraphQL surface.

The obligations that do apply are the three literals frozen in `../plan.md` § Contract Freeze, and
this slice is where all three are *defined* rather than merely consumed:

- The compose **service** name must be exactly `flaresolverr`. `container_name` may be
  `perceptor-flaresolverr` to match the rest of the stack — that name is cosmetic — but the service
  name is what Docker's DNS answers for and it is hardcoded in the proxy script.
- The port is **8191**, not published to the host, with no `.env` variable.
- The variable is named exactly `INDEXER_API_KEY`, and the `api` container must receive it or
  `../api/plan.md`'s seed silently seeds an empty string.

One deliberate non-obligation, from `spec.md` REQ-10: **neither script attaches the tag to any
indexer.** Which indexers need a headless browser is a judgement about specific trackers, and
routing the rest through it makes every search slower for nothing. An implementer who "finishes"
this by tagging everything has changed the feature.

## Tests

**No test files — there is no test harness for this territory, by design.** `.claude/agents/infra.md`
says it plainly: there is no typecheck and no linter for `bin/`, and the gate is running the script
against the live stack and reading its real output. The same is true of shell scripts inside a
third-party image, where the units under test are `curl` calls against a running Prowlarr.

Article IX is satisfied here by executable acceptance criteria rather than by spec files. Every
silent failure this slice can produce has one:

- Proxy or tag not created on a fresh volume → **AC-2**, which removes the volume and asserts
  Prowlarr's own API response.
- Duplicate proxy or tag on a second boot → **AC-3**, asserting the `id` values are unchanged.
- Key mismatch between `.env`, `config.xml` and the database → **AC-4**.
- A healthcheck that never passes, which surfaces as `indexer` never starting rather than as a
  FlareSolverr error → **AC-1**. Step 2's healthcheck was verified by hand against the running image
  before being written into this plan; re-verify with `docker compose ps`, not by inspection.
- Empty key silently accepted → **AC-6**.

If any of those cannot be executed as written, say so rather than declaring the slice done.

## Done when

```bash
bin/dev
docker compose ps
docker compose logs indexer | grep -E '10-prowlarr-apikey|20-prowlarr-flaresolverr'
```

Nine services, `perceptor-flaresolverr` reported `healthy`, `perceptor-indexer` `healthy` after it,
and both scripts logging their decision without an error. Then, with `$INDEXER_API_KEY` from `.env`:

```bash
bin/cli indexer curl -s -H "X-Api-Key: $INDEXER_API_KEY" http://localhost:9696/api/v1/indexerproxy
bin/cli indexer curl -s -H "X-Api-Key: $INDEXER_API_KEY" http://localhost:9696/api/v1/tag
bin/cli indexer sed -n 's:.*<ApiKey>\(.*\)</ApiKey>.*:\1:p' /config/config.xml
```

Expected: one proxy with `host` = `http://flaresolverr:8191/` and a non-empty `tags`; one tag; a key
equal to `INDEXER_API_KEY`. Run `bin/dev` again and confirm every `id` is unchanged.

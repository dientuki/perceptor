---
title: Development Stack Contract and FlareSolverr — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-08-17
status: Implemented
---

# PLAN: Development Stack Contract and FlareSolverr (`plan.md`)

## Approach

The feature is three small mechanisms that happen to share one secret, plus one document. Nothing
here is a new abstraction: every piece extends something the repository already does.

**The API key stops being discovered and starts being declared.** Today Prowlarr generates its
`ApiKey` and `services/indexer/custom-services.d/10-prowlarr-credentials` parses it out of
`/config/config.xml` in order to configure forms authentication. That direction only works for a
consumer *inside* the container. Inverting it — `.env` declares the value, Prowlarr adopts it —
makes the same key reachable from `api` with no runtime handshake between two containers that have
no reason to talk. `bin/install` already owns exactly this pattern for `JWT_SECRET` (generate when
empty, never touch an existing value) and `SERVICE_TOKEN`; `INDEXER_API_KEY` is a third instance of
it and must reuse the existing `ensure_env_var` / `set_env_var` helpers rather than growing a
fourth way to write a line into `.env`.

**Prowlarr adopts the key before it boots, not after.** Prowlarr does expose the key as a writable
field on `PUT /api/v1/config/host` — verified against the live instance, `apiKey` is in that payload
— but changing it there makes Prowlarr restart itself, so a container whose `.env` and volume
disagree would restart on every boot forever. Writing `/config/config.xml` from
`custom-cont-init.d` instead sidesteps that entirely, and it is allowed there for the reason
`spec.md` REQ-12 gives: writing a file waits on nothing, so the deadlock that forced
`10-prowlarr-credentials` into `custom-services.d` does not apply. `services/torrent/custom-cont-init.d/10-qbittorrent-password`
is the working precedent for "rewrite a third-party config file before its app starts" and the new
script should read like its sibling.

**The FlareSolverr proxy is registered through Prowlarr's own API, from a second s6 service.** A new
`custom-services.d/20-prowlarr-flaresolverr` follows `10-prowlarr-credentials` line for line: the
`with-contenv` shebang, the poll-until-the-API-answers loop, read-compare-act instead of blind
writes, and `exec sleep infinity` at the end so s6 does not churn. It does not need to parse
`config.xml` for the key any more — the key is `$INDEXER_API_KEY` — and waiting for
`/api/v1/system/status` to accept that key *is* the signal that the `cont-init.d` script's value
took effect. The proxy body comes from `GET /api/v1/indexerproxy/schema`, which returns the
`FlareSolverr` entry with its `fields` array already shaped, so the script fills `host` and
`requestTimeout` into a template Prowlarr itself produced rather than hardcoding a payload that a
Prowlarr upgrade can invalidate.

**A failed search stops looking like an empty one.** `ProwlarrClient.getData` calls `res.json()` with
no status check and hands whatever comes back to `filterData`, so a `401` — the exact symptom of a
wrong key, which is the thing this feature is moving around — arrives at the UI as "no releases
found". That turns every misconfiguration in this feature into a silent one, so REQ-15 closes it:
`api` raises on a non-success response, `web` renders the message. On the `web` side this is
deliberately not a new pattern — `SearchTorrent.tsx` already holds an `addError` state and renders it
for the add-torrent path; the search path reuses that surface rather than growing a second one.

The `api` slice is four lines in an existing seed plus a status check. FlareSolverr itself is a stock
image with no build context — the only service in the stack besides `db`, `redis` and `traefik` that
needs none.

## Order of Work

`api` does **not** go first here, which is the exception rather than the rule: it owns no schema
change and no contract in this feature. What everything else depends on is the name and value of
`INDEXER_API_KEY`, so `.env.example` and `bin/install` are the head of the chain.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `infra` | `.env.example` + `bin/install` define `INDEXER_API_KEY`. Every later step reads it; until it exists, nothing downstream can be tested against a real value. |
| 2 | `infra` | `services/indexer/custom-cont-init.d/10-prowlarr-apikey` and the `COPY` in `services/indexer/Dockerfile` that carries it into the image. One indivisible change: the build fails with either half missing. |
| 3 | `infra` | `docker-compose.yaml`: the `flaresolverr` service, `indexer`'s `depends_on`, `INDEXER_API_KEY` into `api`. The proxy script cannot be verified against a service that does not exist yet. |
| 4 | `infra` | `services/indexer/custom-services.d/20-prowlarr-flaresolverr` — registers tag and proxy. Needs steps 2 and 3 live. |
| 5 | `docs` | Root `CLAUDE.md`: the pipeline row, the `.env` variable list, the topology diagram. |

The whole chain above is one agent's, `infra` — including the two scripts inside the `indexer`
container. The `[orch]` tag that used to cover third-party container config was retired by
`003-auth-user-management`; see `infra/plan.md` § Scope for the two stale files corrected while this
plan was written.

**Parallel:** both application slices depend only on things frozen before any of them starts, so they
run alongside the chain rather than after it.

- `api` needs the *name* `INDEXER_API_KEY` (frozen at step 1) and the error contract (frozen at
  approval). It only needs step 3 to be verifiable end to end.
- `web` needs the error message strings from `spec.md` § GraphQL Contract Delta, and nothing else.
  It can start immediately and in parallel with `api` — but it cannot be *verified* until `api`'s
  status check exists, since until then no search produces the error it renders.

Nothing else overlaps: 3 needs 1, 4 needs 2 and 3.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. It carries **no
schema change** — `services/api/src/schema.gql` must be byte-identical before and after this feature,
and a diff on that file is a bug, not a side effect — but it does carry one new error condition on
`searchTorrents`, and that half is just as frozen. The two Spanish strings in its error table are
user-facing copy: `api` raises them and `web` renders them verbatim. An implementer who improves the
wording on one side only leaves the other rendering something else.

The feature also has a seam of its own, and it is the more dangerous kind because no schema
describes it at all. Three literals cross container boundaries with nothing checking that both ends
agree, exactly the failure mode `docs/spec/graphql-contract.md` was written about. They are frozen
here:

- **`INDEXER_API_KEY`** — the variable name. Written by `bin/install`, consumed by the `indexer`
  container's two scripts and by the `api`'s seed, in three different languages. Renaming it in one
  place produces a stack that boots clean and cannot search.
- **`flaresolverr`** — the compose service name, which is also the DNS name in the proxy's `host`
  field (`http://flaresolverr:8191/`). An implementer who renames the service to `solver` or
  `perceptor-flaresolverr` for tidiness breaks a string embedded in a shell script in a different
  directory. `container_name` may differ from the service name — every other service in the stack
  sets `perceptor-*` — but the **service** name is what Docker's DNS resolves and is frozen.
- **`8191`** — FlareSolverr's port. Not configurable through `.env` in this feature and deliberately
  not published to the host; do not add a `FLARESOLVERR_PORT` variable "for symmetry" with
  `INDEXER_PORT`. Nothing outside `perceptor-net` connects to it, so a variable would be a knob with
  no consumer.

If any of the three has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief.

## Migrations

**None.** No Prisma model, field or enum changes. The only database write is
`prisma/seeds/settings.ts` filling the `value` of an existing `Setting` row whose `key` is
`tracker_api_key` — a data change through the existing seed, not a schema change, and reversible by
editing the value in the Settings UI.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **A 401 from Prowlarr looks like an empty result set** | `ProwlarrClient.getData` (`services/api/src/clients/indexer/client.ts`) calls `res.json()` with **no status check**, then hands the result to `filterData`. On a 401 that is an error object, not an array — the user is told there are no releases, not that authentication failed. This is the risk that would hide every other risk in the table: any key mismatch, any misconfigured proxy, any Prowlarr outage all surface as the same empty list. | REQ-15 fixes it rather than recording it: `api` raises `ServiceUnavailableException` on a non-success response and `web` renders the message. AC-9 exercises it with a deliberately wrong key, and `client.spec.ts` (`api/plan.md` § Tests) is the one new test this feature owes. |
| **`.env` key and volume key disagree after an upgrade** | If `bin/install` generates a fresh `INDEXER_API_KEY` on a machine whose `indexer_config` volume already holds a different one, Prowlarr adopts the new value while the `api`'s `tracker_api_key` row keeps the old one — the seed is create-if-not-exists and will not overwrite a non-empty row. Every search then 401s. | REQ-11: `bin/install` reads the existing `<ApiKey>` out of the volume and adopts it instead of generating. AC-4 asserts all three copies agree; AC-8 walks the upgrade. With REQ-15 in place this one also stops being silent. |
| **The host-side FlareSolverr keeps running** | The manual `docker run` container stays up after Prowlarr is repointed at the in-stack service. Nothing breaks, which is the problem: it never gets noticed and it is still there consuming memory and confusing the next person to debug a search. | `bin/install` prints a note when it detects the change; the root `CLAUDE.md` update says the `docker run` is retired. Cosmetic failure only, hence no AC. |
| **`config.xml` written with the wrong owner** | The `cont-init.d` script runs as root; a file it creates that Prowlarr (running as `abc`) cannot rewrite makes Prowlarr fail to persist its own settings later — on a fresh volume, possibly on first boot. | `lsiown abc:abc` after writing (the LinuxServer helper the base image provides), and AC-2 proves a fresh volume reaches a working state rather than merely starting. |
| **`flaresolverr` healthcheck assumes a shell utility that is absent** | The image is `python:slim`-based: no `curl`, no `wget`. A `CMD-SHELL curl -f …` healthcheck fails permanently, `indexer` never starts because of its `depends_on: service_healthy`, and the whole stack looks like a FlareSolverr outage. | The healthcheck calls the interpreter that is provably present. Verified against the running container: `python -c "import urllib.request; urllib.request.urlopen('http://localhost:8191/health')"` returns `{"status": "ok"}`. |

## Verification

```bash
# Slice-local gates
bin/cli api npx --no tsc --noEmit          # expect 0 errors
bin/npm api test                            # expect the 122 pre-existing + the new client suite
bin/npm web run build                       # expect the same 4 pre-existing failures, no new ones
git diff --stat services/api/src/schema.gql # expect no output (contract frozen)

# Stack gates
bin/dev                                     # expect 9 services; flaresolverr healthy
docker compose ps
docker compose logs indexer | grep -E 'prowlarr-(apikey|flaresolverr)'
```

The fresh-volume pass, which is the criterion the feature exists for (AC-2):

```bash
docker compose down
docker volume rm perceptor_indexer_config
bin/install                                 # answer "no" to regenerating .env
bin/dev
```

Then, from inside the `indexer` container, with `$INDEXER_API_KEY` from `.env`:

```bash
bin/cli indexer curl -s -H "X-Api-Key: $INDEXER_API_KEY" http://localhost:9696/api/v1/indexerproxy
bin/cli indexer curl -s -H "X-Api-Key: $INDEXER_API_KEY" http://localhost:9696/api/v1/tag
```

Expected: exactly one proxy, `implementation: "FlareSolverr"`, `host` = `http://flaresolverr:8191/`,
non-empty `tags`; exactly one tag. Running `bin/dev` again must leave both `id` values unchanged
(AC-3).

The manual pass: attach the tag to one Cloudflare-fronted indexer in Prowlarr's UI, search a title
from `/movies`, confirm results appear and that `docker compose logs flaresolverr` shows the
request (AC-5). Then stop `flaresolverr` and repeat, confirming the failure is visible in
`docker compose logs indexer` rather than silently empty (AC-7). Set `INDEXER_API_KEY=` in `.env`,
run `bin/dev`, and confirm the `indexer` container reports an explicit error (AC-6). Finally, set
`tracker_api_key` to a wrong value from the Settings screen and search again: the dialog must show
`No se pudo consultar el indexer (HTTP 401)`, not an empty table (AC-9). Restore it afterwards.

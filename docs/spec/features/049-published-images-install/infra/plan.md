---
title: End-User Installation with Published Images — infra slice
service: infra
last_updated: 2026-09-09
status: Implemented
---

# PLAN: End-User Installation with Published Images — `infra` (`infra/plan.md`)

## Scope

This slice turns the repository's compose file into something a person without the repository can
run. It splits the `build:` sections out of `docker-compose.yaml` into a new overlay, points the
five own services at published GHCR images, ships the qBittorrent AutoRun hook inside the `torrent`
image instead of bind-mounting it, adds the one-shot database backup that runs before `api`
migrates, publishes the images from CI, and writes the `install.sh` that produces a working
installation from an empty directory.

It is **not** touching anything under `services/*/src` or `services/api/prisma`. The boot-time
migration, the production seed, the `DATABASE_URL` handling and the operator commands are the `api`
slice, already done by the time this one starts; this slice consumes them by name (see § Contract
obligations) and must not reimplement any of them. In particular: no `bin/` script and no line of
`install.sh` may run `prisma migrate`, a seed, or `bin/dbreset` against an end user's installation.

**Territory note.** `.claude/agents/infra.md` scopes this agent to `bin/`, `docker-compose.yaml`,
`.env.example`, `services/*/Dockerfile` and the third-party init scripts. This feature deliberately
extends that to two more places, and only these two: `install.sh` at the repository root, and
`.github/workflows/`. Everything else outside the declared territory is still a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `docker-compose.yaml` | Modified | Becomes the runtime: `image:` for the five own services, no `build:`, no path inside this repo, `restart:` on all of them, `traefik` behind a profile, no host ports for `db`/`redis`, plus the `backup` service |
| `docker-compose.build.yaml` | New | The `build:` sections, an `image:` override to `perceptor-<svc>:local`, and the `db`/`redis` host ports used for development |
| `bin/dev` | Modified | Loads the build overlay before the dev overlay |
| `bin/prod` | Modified | Loads the build overlay |
| `bin/build` | Modified | Loads the build overlay |
| `bin/install` | Modified | Loads the build overlay; otherwise unchanged — it stays the development installer |
| `install.sh` | New | The end-user installer: fetched by `curl` into an empty directory, writes `docker-compose.yml` and `.env`, pulls, starts |
| `.env.example` | Modified | Adds `PERCEPTOR_TAG`, `TMDB_API_KEY`, `PERCEPTOR_AUTO_MIGRATE`, `COMPOSE_PROFILES`; documents that `DB_USER` is `perceptor` on a fresh installation |
| `services/torrent/Dockerfile` | Modified | `COPY --chmod=755 commands/ /commands/`, replacing the bind mount |
| `.github/workflows/release.yml` | New | On a `v*` tag, builds the five `runner` images for `linux/amd64` and pushes them to GHCR as `vX.Y.Z` and `latest` |

## Existing code to reuse

- `bin/install` — the whole secret-generation section is already written and already correct:
  `set_env_var`/`ensure_env_var` (portable `sed`, `|` delimiter), the "only generate if empty" guard
  on `JWT_SECRET`, and the `INDEXER_API_KEY` branch that **adopts an existing key out of the indexer
  volume** rather than invalidating a configured Prowlarr. `install.sh` needs the same behaviours;
  lift the shape, do not invent a second one.
- `bin/install`'s Traefik prompt and its `/etc/hosts` hint — the same question, the same wording.
- `docker-compose.dev.yaml`'s header comment — it already states the intended philosophy ("without
  this overlay, `docker-compose.yaml` describes the production runtime"). After this slice that is
  finally true; the file itself needs no change.
- The Traefik label contract already on `web`, `api`, `torrent` and `indexer` — unchanged. Routers
  keep binding only the `web` entrypoint; this feature adds no TLS (`../spec.md` § Out of Scope).
- `services/torrent/Dockerfile`'s existing `COPY --chmod=755 custom-cont-init.d/` — the line for
  `commands/` is its neighbour and follows it exactly.
- `mariadb:12.3.2`, already pulled for `db` — the `backup` service reuses that image for its
  `mariadb-dump`, adding nothing new to the stack.

## Steps

1. Create `docker-compose.build.yaml` with the five `build:` sections lifted verbatim, an `image:`
   override to `perceptor-<svc>:local` for each, and the `ports` for `db` and `redis`.
2. Strip those from `docker-compose.yaml` and add `image:
   ghcr.io/dientuki/perceptor-<svc>:${PERCEPTOR_TAG:-latest}` to the five.
3. Add `restart: unless-stopped` to `web`, `api` and `worker`.
4. Put `traefik` behind `profiles: [traefik]`. Verify `bin/dev` still starts it when `USE_TRAEFIK`
   is true — naming a service explicitly on the command line activates it despite the profile — and
   that an end user enables it with `COMPOSE_PROFILES=traefik` in `.env`, downloading nothing extra.
5. Add the `backup` service: `mariadb:12.3.2`, `restart: "no"`, `depends_on: db: service_healthy`,
   a `./backups:/backups` bind mount, and a `command` that dumps and keeps the five most recent
   files. Add `depends_on: backup: condition: service_completed_successfully` to `api`.
6. Raise `api`'s health check `start_period` so a migration measured in minutes on a populated
   library is not reported as a failure (NFR-5).
7. Remove the `./services/torrent/commands:/commands:ro` mount and add the `COPY` to
   `services/torrent/Dockerfile` — **in the same change**, so the bind mount cannot mask a `COPY`
   that did not work.
8. Pass `TMDB_API_KEY` and `PERCEPTOR_AUTO_MIGRATE` through to `api` in the compose environment.
9. Update the four `bin/` scripts to load the build overlay.
10. Write `.github/workflows/release.yml`.
11. Write `install.sh`.
12. Update `.env.example` last, so it documents what the other eleven steps actually produced.

## Contract obligations

There is no GraphQL surface in this slice — `../spec.md` § GraphQL Contract Delta is empty. What
this slice consumes instead are the names frozen in `../plan.md` § Contract Freeze, produced by the
`api` slice. Use them exactly:

- `DATABASE_URL` — the only place the connection string is expressed. `install.sh` generates the
  `perceptor` password and composes this variable; nothing else carries credentials.
- `TMDB_API_KEY` — passed into `api`'s environment. The installer collects it and writes it to
  `.env`; the settings seed backfills it. `install.sh` must never write to the database itself.
- `PERCEPTOR_AUTO_MIGRATE` — opt-out only, default on. Do not add a mode, a value beyond
  `true`/`false`, or a per-service equivalent.
- `node dist/scripts/mint-service-token.js` and `node dist/scripts/reset-password.js` — the exact
  strings `install.sh` runs and prints. `SERVICE_TOKEN` is minted through the first of these, from
  inside the running `api` container, exactly as `bin/install` does today.
- `PERCEPTOR_TAG` — one variable, all five images. Never a per-service tag, not even as a
  convenience: `web` and `worker` retype the schema by hand and a mixed set fails at runtime with no
  error at build time.

If any of these is missing from the `api` slice when this one runs, **stop and report** — do not add
it here.

## Tests

**None, and deliberately.** This slice writes shell scripts, compose files and a CI workflow; there
is no test framework at this layer in this repository, and Article IX asks for tests where a bug is
silent rather than for coverage. The two genuinely silent failures this slice can produce are both
covered from outside, by acceptance criteria that exercise the real thing:

- The AutoRun hook not reaching the `torrent` image — a completed download that reports nothing, with
  no error in any log — is AC-5, a real download driven to `COMPLETED`.
- `bin/dev` pulling a published image instead of building the working copy — a developer debugging
  code that is not theirs — is AC-13, plus the `docker compose images` check in `../plan.md`
  § Verification.

A workflow that publishes a broken image is not silent: the next `docker compose pull` fails loudly.

## Done when

```bash
bin/build
bin/dev -d
bin/prod
```

`bin/dev -d` and `bin/prod` must both build from source and start a working stack, with
`docker compose images` showing `perceptor-<svc>:local` rather than a `ghcr.io` tag. `bin/install`
on a fresh checkout must still produce a working development environment.

Then the part no `bin/` command can prove: tag a release, let the workflow publish, and on a machine
with Docker and no checkout run `install.sh` in an empty directory and walk AC-1 through AC-12 from
`../spec.md`.

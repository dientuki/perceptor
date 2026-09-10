---
title: End-User Installation with Published Images — Tasks
last_updated: 2026-09-09
status: Draft
---

# TASKS: End-User Installation with Published Images (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[infra]` | Repo-root and third-party-container territory — `bin/`, `docker-compose.yaml`, `.env.example`, `services/*/Dockerfile`, the container config under `services/torrent/` and `services/indexer/`. Extended for this feature only, and only to these two more places: `install.sh` at the repository root and `.github/workflows/` (`infra/plan.md` § Scope). |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

There is no `[web]` or `[worker]` task in this feature. Both are rebuilt and republished; neither
has a line changed (`spec.md` § Out of Scope).

## Tasks

### Group 1 — `api` installs itself

The env-var and command names this group produces are frozen in `plan.md` § Contract Freeze.
Group 2 is written against those exact strings and may start in parallel; Group 3 may not, because
it runs them.

- [ ] **T001** `[api]` Move `prisma` from `devDependencies` to `dependencies` in
      `services/api/package.json`.
      *Done when:* `bin/build api` succeeds and, in the resulting `runner` image,
      `node node_modules/prisma/build/index.js --version` prints a version instead of failing —
      proof it survived `npm prune --omit=dev`.
- [ ] **T002** `[api]` Add `url = env("DATABASE_URL")` to the `datasource db` block in
      `services/api/prisma/schema.prisma` and rebuild the `PrismaMariaDb` adapter in
      `services/api/src/prisma/prisma.service.ts` from `process.env.DATABASE_URL`, failing loudly
      when it is absent rather than falling back to a default.
      *Done when:* `bin/cli api npx --no prisma migrate status` reports the schema up to date, the
      app still serves `/graphql`, `grep -rn devpassword services/api/src` returns nothing, and
      `git status services/api/prisma/` shows a modified `schema.prisma` and **no** new migration
      directory.
- [ ] **T003** `[api]` Create `services/api/src/database/seed/production-seed.ts` calling
      `seedLanguages`, `seedUsers`, `seedSettings` in that order with relative imports only, and
      reduce `services/api/prisma/seeds/index.ts` to the development seed: the production seed, then
      `seedMovies` and `seedMediaSource`.
      *Done when:* `bin/dbreset` still ends with the *Inception* fixture and the seeded
      `MediaSource` present, and `production-seed.ts` imports neither of those two files.
- [ ] **T004** `[api]` Backfill `movie_db_api_key` from `TMDB_API_KEY` in
      `services/api/prisma/seeds/settings.ts`, following the existing `INDEXER_API_KEY` /
      `tracker_api_key` branch. → T003
      *Done when:* with `TMDB_API_KEY` set, `bin/dbreset` leaves `movie_db_api_key` holding that
      value; re-running the seed with a different `TMDB_API_KEY` leaves the first value untouched.
- [ ] **T005** `[api]` Create `services/api/src/bootstrap/run-migrations.ts`: spawn the Prisma CLI
      with `migrate deploy`, take the spawn as an injectable seam, and reject with a message naming
      the exact `docker compose exec` command an operator must run. → T001
      *Done when:* called against the running database it resolves and reports the migrations
      applied; called against a deliberately unreachable `DATABASE_URL` it rejects and the message
      contains the operator command verbatim.
- [ ] **T006** `[api]` Wire T005 and the production seed into `services/api/src/main.ts`, after
      `assertAuthEnv()` and before `NestFactory.create`, skipped when `PERCEPTOR_AUTO_MIGRATE` is
      `false`. A rejection logs and exits non-zero. → T003, T005
      *Done when:* `bin/dev` boots an api that logs the migration and seed before it listens; with a
      broken migration the process exits non-zero, never reaches `app.listen()`, and `docker compose
      ps` shows `web` and `worker` never started; with `PERCEPTOR_AUTO_MIGRATE=false` it boots
      without running either.
- [ ] **T007** `[api] [P]` Write `services/api/src/database/seed/production-seed.spec.ts` covering
      all three branches of the settings loop: an absent key is created, an existing key holding a
      user's value is left alone, an existing key that is still empty is backfilled. → T004
      *Done when:* `bin/npm api test` passes and the suite fails if the loop is changed to a bare
      `upsert`.
- [ ] **T008** `[api] [P]` Write `services/api/src/bootstrap/run-migrations.spec.ts` driving the
      injected spawn seam with a non-zero exit (rejects) and a zero exit (resolves). → T005
      *Done when:* `bin/npm api test` passes and the suite fails if the rejection branch is removed.

### Group 2 — the stack stops needing the repository

May run in parallel with Group 1: every name it consumes is frozen in `plan.md` § Contract Freeze.

- [ ] **T009** `[infra]` Split the compose files. Create `docker-compose.build.yaml` holding the
      five `build:` sections verbatim, an `image: perceptor-<svc>:local` override for each, and the
      `db`/`redis` host ports; strip all of those from `docker-compose.yaml` and add `image:
      ghcr.io/dientuki/perceptor-<svc>:${PERCEPTOR_TAG:-latest}` to the five. Update `bin/dev`,
      `bin/prod`, `bin/build` and `bin/install` to load the new overlay.
      *Done when:* `docker compose -f docker-compose.yaml config` validates and contains no `build:`
      key and no path inside this repository; `bin/build`, `bin/dev -d` and `bin/prod` all still
      build from source, with `docker compose images` showing `perceptor-<svc>:local` and no
      `ghcr.io` tag; `docker compose port db 3306` returns nothing with the base file alone and a
      port with the overlay.
- [ ] **T010** `[infra]` Add `restart: unless-stopped` to `web`, `api` and `worker`, and put
      `traefik` behind `profiles: [traefik]`. → T009
      *Done when:* `docker inspect` reports the restart policy on all three; `docker compose up -d`
      with no `COMPOSE_PROFILES` starts no `traefik` and leaves ports 80 and 443 unbound;
      `COMPOSE_PROFILES=traefik docker compose up -d` starts it; and `bin/dev` with `USE_TRAEFIK=true`
      still starts it.
- [ ] **T011** `[infra]` Ship the AutoRun hook inside the image: add `COPY --chmod=755 commands/
      /commands/` to `services/torrent/Dockerfile` and remove the
      `./services/torrent/commands:/commands:ro` mount from `docker-compose.yaml`, in the same
      change. → T009
      *Done when:* `docker compose exec torrent cat /commands/on-torrent-completed.sh` prints the
      script while no bind mount for it exists in either compose file.
- [ ] **T012** `[infra]` Add the one-shot `backup` service (`mariadb:12.3.2`, `restart: "no"`,
      `depends_on: db: service_healthy`, `./backups:/backups`, dump plus rotation to the five most
      recent), add `depends_on: backup: condition: service_completed_successfully` to `api`, and
      raise `api`'s health check `start_period` to tolerate a migration measured in minutes. → T009
      *Done when:* after `docker compose up -d`, `./backups` holds a dump that restores; a sixth
      start leaves exactly five files; and a dump forced to fail leaves `api` never started.
- [ ] **T013** `[infra]` Pass `TMDB_API_KEY` and `PERCEPTOR_AUTO_MIGRATE` through to `api` in
      `docker-compose.yaml`. → T009
      *Done when:* `docker compose exec api printenv TMDB_API_KEY PERCEPTOR_AUTO_MIGRATE` prints
      both values.
- [ ] **T014** `[infra]` Write `.github/workflows/release.yml`: on a `v*` tag, build the five
      `runner` images for `linux/amd64` and push them to GHCR as `vX.Y.Z` and `latest`, publicly
      readable. → T009
      *Done when:* pushing a throwaway `v0.0.0-rc` tag publishes five packages and `docker pull
      ghcr.io/dientuki/perceptor-api:v0.0.0-rc` succeeds from a logged-out Docker.

### Group 3 — the installer

Depends on both groups: it runs `api`'s operator commands against the images Group 2 publishes.

- [ ] **T015** `[infra]` Write `install.sh` at the repository root — fetched by `curl` into an empty
      directory, it downloads `docker-compose.yml` and `.env`, asks the five questions, derives
      `PUID`/`PGID`/`MEDIA_GID`/`TZ`/free ports, generates `JWT_SECRET`, `INDEXER_API_KEY` and the
      `perceptor` database password, pins `PERCEPTOR_TAG` to the version it installed, pulls, starts,
      mints `SERVICE_TOKEN` through `node dist/scripts/mint-service-token.js`, and prints the URL and
      username. Re-running it repairs rather than replaces, and it detects an existing `db` volume
      rather than writing credentials MariaDB will never accept. → T006, T013, T014
      *Done when:* on a machine with Docker and no checkout, in an empty directory, the `curl | bash`
      invocation plus five answers ends with the stack running and those credentials signing in;
      `ls` shows no `services/`, `bin/` or source; two separate installations hold different
      database passwords; and re-running it over a live installation with registered titles leaves
      every title, setting and user intact and the administrator password unchanged.
- [ ] **T016** `[infra]` Update `.env.example` with `PERCEPTOR_TAG`, `TMDB_API_KEY`,
      `PERCEPTOR_AUTO_MIGRATE` and `COMPOSE_PROFILES`, and document that a fresh installation's
      `DB_USER` is `perceptor`. → T015
      *Done when:* every variable `install.sh` writes appears in `.env.example` with a name and no
      value, and `bin/install` on a fresh checkout still produces a working development stack.

### Group 4 — verification and docs

- [ ] **T017** `[docs]` Update the root `CLAUDE.md` — the `bin/` wrapper table and § Layout for
      `docker-compose.build.yaml` and `install.sh`, § Environment for the four new variables and for
      migrations now running at `api`'s boot, and § Known debt to strike the hardcoded-DSN item — and
      `services/api/CLAUDE.md` § "Prisma 7 via driver adapter", whose "don't expect `DATABASE_URL`
      alone to configure the client" is exactly what this feature reverses. → T016
      *Done when:* neither file describes a `docker-compose.yaml` that builds from source, and
      `grep -rn "devuser:devpassword" CLAUDE.md services/api/CLAUDE.md` returns nothing.
- [ ] **T018** `[docs]` Walk AC-1 through AC-13 in `spec.md`, tick each box, and set
      `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and `infra/plan.md`. → T017
      *Done when:* every box is ticked with the observed result, and the four files read
      `Implemented`. AC-7 needs a deliberately broken migration published under a throwaway tag —
      the one criterion that cannot be reached from a real release.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

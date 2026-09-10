---
title: End-User Installation with Published Images
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-09-09
last_updated: 2026-09-09
status: Approved
services: [infra, api]
---

# SPEC: End-User Installation with Published Images (`spec.md`)

## Context & Goal

Perceptor cannot be installed by anyone who is not a developer of Perceptor. Every one of the five
own services in `docker-compose.yaml` is declared with a `build:` context pointing at
`./services/<svc>`, so the stack can only be brought up from a checkout of this repository, and
`bin/prod` compiles all five `runner` images on the user's machine before it can start anything.
`bin/install` compounds this: it boots the `dev` target with the `docker-compose.dev.yaml` overlay,
runs `npm install` inside the containers, and finishes with `bin/dbreset` — a
`prisma migrate reset --force` that is correct for a development loop and catastrophic for someone
who runs it a second time to fix a problem. There is no path today that ends with a person who has
Docker and nothing else running Perceptor.

This feature creates that path. The five images are built once by CI and published to GHCR; the
repository's `docker-compose.yaml` stops describing how to build them and starts describing how to
run them, with the `build:` sections moving into an overlay that only `bin/dev`, `bin/prod` and
`bin/build` load. What an end user needs is then exactly two files — that same `docker-compose.yml`
and a `.env` — in an otherwise empty directory. An `install.sh` fetched with `curl` writes both,
asking five questions and detecting the rest, then pulls and starts the stack. Updating is
`docker compose pull && docker compose up -d`, and the schema catches up on its own because `api`
applies its pending migrations and its production seed before it begins serving.

The pipeline stages in the root `CLAUDE.md` do not change; what changes is who can run them. Three
pieces of today's wiring assume the repository is present on disk and have to stop assuming it:
`services/torrent`'s AutoRun hook is bind-mounted from `./services/torrent/commands`, so without a
checkout qBittorrent silently never reports a completed download and the pipeline stalls with no
error anywhere; `services/api`'s `runner` stage runs `npm prune --omit=dev`, which strips the
`prisma` CLI and `ts-node` and therefore every operational command the install needs (migrate, seed,
mint `SERVICE_TOKEN`, reset a password); and `services/api/prisma/schema.prisma` declares its
`datasource` with no `url`, keeping the connection string in `prisma.config.ts` — a TypeScript file
that never reaches the published image. The last of these also closes the `movieId`-adjacent debt
item recorded in the root `CLAUDE.md`: `prisma.service.ts` hardcodes `devuser:devpassword`, which in
a world of published images would mean every installation on earth shares one database credential.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Published images)**: Each of the five services this repository builds — `web`, `api`,
      `worker`, `torrent`, `indexer` — must be published as an image to GHCR under the
      `dientuki/perceptor` namespace, built from its `runner` stage, readable without
      authentication.
- [ ] **REQ-2 (Tag scheme)**: A git tag `vX.Y.Z` must publish all five images at that version and
      move `latest` to it. The version consumed at runtime must be a single variable applying to all
      five, so that no installation can run a mixed set.
- [ ] **REQ-3 (Runtime compose)**: `docker-compose.yaml` must describe only images to pull — no
      `build:` section, no bind mount of any path inside this repository. A person holding only that
      file and a `.env` must be able to run the whole stack. The `build:` sections move to a new
      overlay that `bin/dev`, `bin/prod` and `bin/build` load and that an end user never downloads.
- [ ] **REQ-4 (Self-contained torrent image)**: The qBittorrent AutoRun hook
      (`services/torrent/commands/on-torrent-completed.sh`) must ship inside the `torrent` image
      rather than being bind-mounted from the repository, so that a repository-less installation
      still reports completed downloads.
- [ ] **REQ-5 (Installer)**: A single `install.sh`, fetched over `curl` into an empty directory,
      must produce a running installation. It asks for exactly five things — downloads folder,
      library folder, administrator username and password, how the user reaches the app, and the
      TMDB API key (skippable) — and derives everything else without asking: `PUID`/`PGID`, the
      group owning the library folder, the timezone, and any port whose default is already taken.
- [ ] **REQ-6 (Generated secrets)**: `JWT_SECRET`, `SERVICE_TOKEN`, `INDEXER_API_KEY` and the
      database password must be generated per installation by the installer, never shipped as
      defaults and never present in a versioned file.
- [ ] **REQ-7 (Dedicated database user)**: A fresh installation must use a database user named
      `perceptor` with a password generated at install time. `api` must read its connection string
      from `DATABASE_URL` rather than the literal currently in
      `services/api/src/prisma/prisma.service.ts`, and `schema.prisma`'s `datasource` must resolve
      its `url` from the same variable so migrations can run inside the published image.
- [ ] **REQ-8 (Idempotent installer)**: Re-running `install.sh` in a directory that already holds an
      installation must repair rather than replace — it fills in only what is missing and must never
      drop a database, reset a schema, or overwrite a value the user has already set.
- [ ] **REQ-9 (No installer required)**: Every value `install.sh` writes must also be settable by
      hand in `.env`. No installation step may exist only inside the script; the script is a
      convenience over the compose file, not a prerequisite for it.
- [ ] **REQ-10 (Self-migrating api)**: On boot, before it accepts its first request, `api` must
      apply every pending Prisma migration and then run the production seed. Its health check must
      not report healthy until both have completed.
- [ ] **REQ-11 (Production seed)**: The seed that runs on boot must cover languages, the
      administrator user and settings, and must never insert the development fixtures currently in
      `prisma/seeds/movie.ts` and `prisma/seeds/media-source.ts`. It must be safe to run on every
      boot: it may add a settings key introduced by a newer version, and must not overwrite a value
      the user has configured.
- [ ] **REQ-12 (Backup before migrating)**: Before applying pending migrations, the database must be
      dumped into a `backups/` directory beside the compose file, keeping the five most recent dumps
      and discarding older ones. The location is deliberately visible from the host: a user must be
      able to find, copy and measure their backups without knowing any Docker command.
- [ ] **REQ-13 (Operator commands without the repository)**: The published `api` image must expose
      the operations an installation cannot be recovered without: minting a `SERVICE_TOKEN`,
      resetting a user's password, and resolving a migration that failed. Each must be runnable
      through `docker compose exec` alone.
- [ ] **REQ-14 (Update path)**: An installation pins the version it installed, so it never moves on
      its own. Updating must be naming the new version in `.env` and then `docker compose pull &&
      docker compose up -d` — no migration step, no seed step, no other manual intervention — and
      returning to the previous version must be the same two commands with the previous number.
- [ ] **REQ-15 (Survives a reboot)**: Every service in the runtime compose must come back on its own
      after the host restarts.
- [ ] **REQ-16 (Optional ingress)**: The runtime compose carries `traefik`, but it must stay off
      unless the user opts in, so that a default installation neither binds ports 80 and 443 nor
      mounts the Docker socket. Opting in must not require downloading a second file.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (amd64 only)**: Images are published for `linux/amd64`. ARM and the NAS scenario are a
      separate spec; nothing here may be shaped around them.
- [ ] **NFR-2 (A failed migration must not serve)**: If a migration fails, `api` must exit non-zero
      with an operator-readable log naming the exact command to run, and must not listen. Because
      `web` and `worker` already gate on `api: condition: service_healthy`, neither may ever observe
      a half-migrated database.
- [ ] **NFR-3 (Nothing destructive reaches a user)**: No path in the published images or in
      `install.sh` may run `prisma migrate reset`, drop a database, or remove anything under the
      destinations root (Constitution, Article XII).
- [ ] **NFR-4 (The database user applies to fresh volumes only)**: MariaDB creates `MARIADB_USER`
      only when its volume is empty. An existing installation keeps the user it already has; the
      installer must detect this rather than produce a `.env` that no longer matches the database.
- [ ] **NFR-5 (Long migrations)**: The `api` health check's `start_period` must tolerate a migration
      measured in minutes on a populated library, so that a slow but succeeding upgrade is not
      reported as a failure.
- [ ] **NFR-6 (Version coherence)**: There is no codegen between `api` and its consumers
      (Constitution, Article VIII); `web` and `worker` retype the schema by hand. The five images
      must therefore always move together, and it must not be possible to pull one at a different
      version through ordinary use.
- [ ] **NFR-7 (The development flow is unchanged)**: `bin/dev`, `bin/prod`, `bin/build` and the
      existing `bin/install` must keep working from a checkout exactly as they do today, building
      from source rather than pulling.
- [ ] **NFR-8 (Reduced host surface)**: The runtime compose must not publish the database or Redis
      ports to the host. Both remain reachable on `perceptor-net`, and the repository overlay may
      still publish them for development.
- [ ] **NFR-9 (Language)**: Prompts and output of `install.sh` are user-facing copy and follow the
      Spanish register of the existing `bin/` scripts. Everything else — code, comments, log lines
      emitted by `api` at boot, the workflow, this spec — is English (Constitution, Article VI).
      `api`'s boot-time migration output is operator-facing and does not enter the `018` i18n
      catalog.




## GraphQL Contract Delta

**None — this feature does not cross the service boundary.**

Nothing here adds, removes or changes a type, field, mutation, argument or error condition. `web`
and `worker` are untouched: they consume `api` over the same schema before and after, and the only
reason `api` appears in `services:` at all is that the database, its migrations and its seeds belong
to it (Constitution, Article III). The one thing this feature does change about the boundary is
*when* it becomes available — `api` now serves its first request strictly after migrations and seed
have completed — and that is enforced by the health check the compose file already gates on, not by
the schema.

## Data Model Changes

**None.**

No model, field, enum or index changes, and no migration is generated by this feature. Two
adjacent edits are deliberately not data model changes: `schema.prisma`'s `datasource` block gains a
`url` resolved from `DATABASE_URL`, which alters how the connection is located and not what is
stored; and the development fixtures move out of the boot seed, which changes what a fresh
installation is seeded with, not what can be stored. A database created by a previous
`bin/install` keeps every row it has.

## Acceptance Criteria

- [ ] **AC-1**: On a machine with Docker and no checkout of this repository, in an empty directory,
      `curl -fsSL <install url> | bash` followed by the five answers ends with the stack running and
      prints the URL and the administrator username. Opening that URL shows the login screen and
      those credentials sign in.
- [ ] **AC-2**: After AC-1, `ls` in that directory lists exactly the files the installation needs —
      no `services/`, no `bin/`, no source.
- [ ] **AC-3**: `docker compose ps` after AC-1 shows all services running, and `docker inspect` on
      each reports a restart policy that survives a host reboot. Rebooting the host and waiting
      brings the stack back with no command run.
- [ ] **AC-4**: `docker compose port db 3306` and `docker compose port redis 6379` return nothing —
      neither is published to the host — while `api` still reaches both.
- [ ] **AC-5**: Registering a title and adding a torrent through the UI reaches `COMPLETED`, proving
      the AutoRun hook shipped inside the image reported the completed download.
- [ ] **AC-6**: `grep devpassword` over the installed directory returns nothing, and the `.env`
      holds a database password that differs between two separate installations.
- [ ] **AC-7 (failure path)**: With a deliberately broken migration in the image, `docker compose up
      -d` leaves `api` exiting non-zero and never healthy; `docker compose ps` shows `web` and
      `worker` never started; and `docker compose logs api` names the exact command to run to
      resolve it. Running that command and restarting recovers the installation.
- [ ] **AC-8 (failure path)**: Re-running `install.sh` in a directory that already holds a working
      installation with registered titles leaves every title, setting and user intact, and does not
      change the administrator password.
- [ ] **AC-9**: Starting from an installation on the previous published version, `docker compose
      pull && docker compose up -d` with the version unchanged in `.env` leaves that installation on
      the version it already had. Naming the new version and repeating the two commands ends with
      the new version running, the schema migrated, a new settings key introduced by that version
      present at its default, and a value the user had changed still holding the user's value.
- [ ] **AC-10**: After AC-9, a database dump taken before the migration exists and can be listed
      without the repository.
- [ ] **AC-11**: `docker compose exec` alone can mint a `SERVICE_TOKEN` and reset a user's password
      on the installed stack, with no `bin/` wrapper and no Node installed on the host.
- [ ] **AC-12**: After AC-1, nothing is listening on ports 80 or 443 and no container has the Docker
      socket mounted. Opting into Traefik with the file already on disk, and nothing else
      downloaded, routes the app by domain.
- [ ] **AC-13**: In a checkout of this repository, `bin/dev` still builds from source and starts the
      stack, and `bin/build` still produces the `runner` images locally — neither pulls a published
      image.

## Out of Scope

- **NAS and ARM.** Synology, QNAP, Unraid and any `arm64` host get their own spec. They consume the
  same published compose file, which is why REQ-9 exists, but their constraints — GUI-only
  installation, DSM occupying ports 80 and 443, `PUID` schemes that are not 1000, and CPUs on which
  AV1 encoding is not viable — shape nothing here.
- **HTTPS and certificates.** The Traefik routers in `docker-compose.yaml` bind only the `web`
  entrypoint and declare no certificate resolver; TLS does not exist in this stack today and this
  feature does not add it. A user who wants HTTPS puts their own reverse proxy in front.
- **An uninstall path.** Removing an installation is `docker compose down -v` plus deleting the
  directory, which is Docker's own vocabulary and needs nothing from us. Deliberately: an uninstall
  script that removes volumes is one flag away from removing a library (Article XII).
- **Automatic updates.** Nothing in the installation checks for, downloads or applies a new version
  on its own. REQ-14 makes updating two commands; deciding when to run them stays with the user.
- **A settings-migration mechanism beyond the seed.** REQ-11 relies on the existing create-only
  behaviour of the settings seed to introduce new keys on upgrade. A richer mechanism — renaming a
  key, changing a default for existing installations, removing a key — is not designed here.
- **`web` and `worker` source changes.** Both are rebuilt and republished, and neither has a line
  changed. If either turns out to need one, that is a contract change and comes back here first
  (Article VIII).
- **Publishing anywhere but GHCR.** No Docker Hub, no mirror, no self-hosted registry.

---
title: Docker Engine Preflight and a Stop Wrapper
spec_version: 1.0.0
author: Juan "Dientuki" Farias
created_at: 2026-10-02
last_updated: 2026-10-02
status: Implemented
services: [infra]
---

# SPEC: Docker Engine Preflight and a Stop Wrapper (`spec.md`)

> Written after the fact, like `001-magnet-import`. The code landed first, as a direct fix to a
> field report; this spec records the decisions behind it so the next reader does not have to
> reconstruct them from the diff. Every box below is ticked against the implementation that
> exists, not against an intention.

## Context & Goal

An alpha tester tried to install Perceptor on 2026-10-02 and could not. They had Docker installed;
they did not have it *running* — Docker Desktop was closed. What they saw was not a message about
that. `install.sh` checked two things before doing anything, `command -v docker` and
`docker compose version`, and **both of those pass with the daemon stopped**: the CLI and the
Compose plugin are client-side binaries that answer perfectly well with nothing behind them. So the
installer carried on, asked all five questions, wrote `.env`, and only then died at its first real
call to the engine — `docker compose pull` — with `Cannot connect to the Docker daemon at
unix:///var/run/docker.sock`. For someone installing their first self-hosted application that is
not a diagnosis, it is noise at the end of a form they just filled in. The one thing they praised
in the same conversation was that installing was supposed to be a single line.

The developer side was worse, just less visible: `bin/install`, `bin/dev`, `bin/prod`, `bin/build`,
`bin/cli` and friends had **no Docker check at all** — not even for the command. A stopped daemon
surfaced as whatever raw error `docker compose` happened to print, in the middle of a wrapper whose
whole job (Constitution, Article I) is to be the only way anyone talks to the stack.

The second half of this feature comes out of the same session on the same machine. There was no
`bin/stop`. Stopping "Perceptor" meant `docker compose stop`, which only knows the containers
labelled with *this* Compose project — the directory name, or `COMPOSE_PROJECT_NAME`. The machine
this was written on had nine containers running from an end-user install directory under project
`ptor` and one stray `db` under project `perceptor`, and no single command that stopped both. A
stack left running from another checkout holds the host ports and the library bind mount, so the
next `bin/dev` fails in a way that looks like anything except a leftover container.

This feature touches no service and no pipeline stage in the root `CLAUDE.md`. It is `bin/`,
`install.sh` and prose: the territory the `infra` agent owns.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Engine Check in the Installer)**: `install.sh` must verify a **reachable engine**,
      not only the presence of the `docker` command and the Compose plugin, and must do so before
      it asks the user anything or writes any file.
- [x] **REQ-2 (One Shared Preflight)**: Every `bin/` wrapper that talks to Docker must perform the
      same three checks — command, Compose plugin, reachable engine — from a single shared
      definition, so a wrapper added later inherits it instead of re-deriving it.
- [x] **REQ-3 (A Message That Names the Fix)**: The engine failure must name both ways out —
      opening Docker Desktop and waiting for `Engine running` on macOS/Windows,
      `systemctl start docker` (and `enable`) on Linux — and offer `docker run hello-world` as the
      confirmation that the engine is reachable before trying again. It must not restate the raw
      socket error.
- [x] **REQ-4 (Stop This Project)**: A new `bin/stop` must stop the stack of the directory it is
      run from.
- [x] **REQ-5 (Find What Is Left Outside It)**: `bin/stop` must then find Perceptor containers
      still running under a **different** Compose project — another checkout, an end-user install
      directory, this directory before it was renamed — and must identify them by the shared
      `perceptor-net` network rather than by container name, so another project's `db`, `redis` and
      `traefik` are found too. Finding one container of another project means stopping **every**
      running container of that project, not only the one that matched.
- [x] **REQ-6 (Ask Before Touching Another Install)**: Stopping containers outside this project is
      a confirmed action: `bin/stop` asks when it has a terminal (default yes — stopping Perceptor
      is why the command was run), skips the prompt with `-y`/`--yes`, and with neither a terminal
      nor `-y` lists what it found and stops nothing.
- [x] **REQ-7 (Stop, Never Down)**: `bin/stop` must never remove a container, a network or a
      volume. `bin/dev` after `bin/stop` must bring the stack back where it was.
- [x] **REQ-8 (Correct Project Name)**: The Compose project name must be derived the way Compose
      derives it. The existing derivation in `install.sh` appended a spurious `-`
      (`perceptor-` for a directory named `perceptor`), because `tr -c 'a-z0-9' '-'` rewrites
      `basename`'s own trailing newline as well. Both the shared helper and `install.sh` must
      produce `perceptor`.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (No New Host Dependency)**: The preflight and `bin/stop` must be POSIX-ish shell plus
      the `docker` CLI — no `jq`, no Python, no Node on the host (Constitution, Article I).
- [x] **NFR-2 (The Installer Keeps Its Own Copy)**: `install.sh` must carry the three checks inline
      rather than sourcing the shared helper. It is fetched by `curl` into an empty directory and
      there is no `bin/` beside it; a `source` would be the first thing to fail.
- [x] **NFR-3 (Diff Confined to Infra)**: Nothing under `services/*/src/`, `services/*/prisma/` or
      any `package.json` changes. No Prisma migration, no `schema.gql` delta.
- [x] **NFR-4 (Bounded Preflight Cost)**: The engine check is one `docker info` round trip —
      measured at ~150 ms on the development host. `bin/cli` is the hot path (every `bin/npm`,
      `bin/bash`, `bin/mysql`, `bin/reset-password` and `bin/dbreset` call goes through it), and
      that cost is accepted there as negligible beside the container exec that follows. No wrapper
      may add a second round trip to get the same answer.
- [x] **NFR-5 (The Helper Is Sourced, Not Run)**: The shared definition is a library — not
      executable, with no side effect at source time beyond defining its functions, so a wrapper
      can source it before its own `cd`.
- [x] **NFR-6 (A Failed Check Writes Nothing)**: A refused preflight must leave the working
      directory exactly as it was. For `install.sh` in particular, nothing — not `.env`, not
      `docker-compose.yaml` — may exist afterwards that did not exist before.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.** It adds no resolver, no field and no
error key. `web` and `worker` are untouched; neither one can observe this change, because
everything it adds happens on the host before a container exists, or to containers after they have
stopped serving.

## Data Model Changes

**None.** No Prisma model, field, enum or migration is involved.

## Acceptance Criteria

- [x] **AC-1** (failure path): With the engine unreachable
      (`DOCKER_HOST=unix:///nonexistent.sock bash install.sh`), the installer prints
      `Docker is installed but its engine is not running.` followed by the Docker Desktop and Linux
      lines, exits `1`, asks **no** question, and leaves the directory empty — no `.env`, no
      `docker-compose.yaml`.
- [x] **AC-2** (failure path): The same `DOCKER_HOST` override against `bin/install`, `bin/dev`,
      `bin/prod`, `bin/build`, `bin/cli`, `bin/log` and `bin/stop` prints the same message and
      stops before the wrapper's own work. (Run; `bin/export` and `bin/dbinit` carry the same call
      and were verified by reading the diff, not by invocation.)
- [x] **AC-3**: With the engine running, `bin/log db` streams the container's log and
      `bin/cli db sh -c 'echo inside-container-ok'` prints `inside-container-ok` — the preflight is
      invisible on the happy path.
- [x] **AC-4** (failure path): `bin/stop --nope` prints `Usage: bin/stop [-y|--yes]` and exits `1`,
      and does so **before** the Docker preflight — an unparseable argument is not diagnosed as a
      Docker problem.
- [x] **AC-5**: On a host running nine containers under project `ptor` and one under this
      directory's own project `perceptor`, `bin/stop` lists exactly the nine `ptor-*` containers as
      leftovers — including `ptor-db-1`, `ptor-redis-1` and `ptor-traefik-1`, whose images say
      nothing about Perceptor — and does not list `perceptor-db-1`, which its own
      `docker compose stop` already covered.
- [x] **AC-6** (failure path): With no terminal and no `-y`, `bin/stop` prints the leftovers, then
      `Not stopping them: no terminal to ask on. Re-run as 'bin/stop -y' to stop them too.`, exits
      `0`, and stops none of them.
- [x] **AC-7**: `bin/stop -y` issues a single `docker stop` naming every leftover. Answering `n`
      interactively prints `Left running.` and stops none; answering with an empty line takes the
      default and stops them. (Verified against a dry-run copy of the script with the two
      mutating commands echoed, so the tester's own running install was not stopped.)
- [x] **AC-8** (regression): `. bin/_docker.sh && compose_project_name` prints `perceptor`, not
      `perceptor-`, in a directory named `perceptor`. The real volume on the host is
      `perceptor_mariadb_data`, which is why the old value could never match.
- [x] **AC-9**: `bin/stop` followed by `bin/dev` brings the stack back with every container, volume
      and network intact. Run live 2026-10-09 with the tester's consent: state captured before
      `bin/stop -y` and diffed after `bin/dev -d` is identical on all three axes — the same ten
      containers under the same names, the same seven volumes
      (`perceptor_mariadb_data` still carrying its original `CreatedAt` of 2026-09-10, so it was
      never recreated), the same single network `perceptor_perceptor-net`. Row counts across
      `movies`/`media_sources`/`users`/`settings` are unchanged (3/1/1/50) and `.env` has the same
      md5. `bin/stop` also reported `No Perceptor containers left running outside this project.`
- [x] **AC-10**: The `bin/` table in both `README.md` and the root `CLAUDE.md` lists `bin/stop`, and
      each file states that the wrappers check for a reachable engine first.

## Out of Scope

- **Starting Docker for the user.** The preflight diagnoses and exits; it never runs
  `systemctl start docker`, `open -a Docker` or anything equivalent. Starting a system daemon is a
  privileged, host-wide side effect of a command the user ran to install an application, and a
  failed `sudo` prompt inside `curl | bash` is worse than the message it would replace.
- **`bin/make_sample`.** The only `bin/` script with no preflight, deliberately: it shells out to
  `ffmpeg` on the host and never touches Docker. It has its own `command -v ffmpeg` guard already.
- **A `bin/down`.** Removing containers and volumes is a different, destructive intent and deserves
  its own confirmation design. REQ-7 draws the line at `stop` on purpose; `bin/dbreset` remains the
  only wrapper that destroys state.
- **Replacing the project-name derivation with Compose's own answer.** `docker compose config`
  could report the real project name instead of re-deriving it, but parsing its output needs `jq`
  or a fragile `sed`, against NFR-1. The derivation now matches Compose for every name this
  project can produce; a directory name that normalizes differently (leading digits, for instance)
  would need the real thing.
- **Detecting a leftover stack that has lost `perceptor-net`.** A container reattached to a
  different network by hand is only found if its image name still contains `perceptor`. Fully
  general detection would mean inspecting every container on the host; the two signals together
  cover every state Compose itself can produce.

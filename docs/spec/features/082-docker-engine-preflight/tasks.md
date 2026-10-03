---
title: Docker Engine Preflight and a Stop Wrapper — Tasks
last_updated: 2026-10-02
status: Done
---

# TASKS: Docker Engine Preflight and a Stop Wrapper (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[infra]` | Repo-root and third-party-container territory — `bin/`, `docker-compose*.yaml`, `.env.example`, `install.sh`, `services/*/Dockerfile`, `.github/workflows/release.yml`, and the container config under `services/torrent/` and `services/indexer/`. `install.sh` is listed here because T001 adds it to `.claude/agents/infra.md` permanently; before this feature it was granted per-feature by `049`, `061` and `066`. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**No `[api]`, `[web]` or `[worker]` task exists in this feature.** NFR-3 confines the diff to
host-side tooling and prose; nothing under `services/*/src/`, `services/*/prisma/` or any
`package.json` is touched, and there is no Prisma migration and no `schema.gql` delta. An agent that
finds itself editing service source has misread the brief and should stop and report.

## Tasks

### Group 1 — territory

- [x] **T001** `[docs]` In `.claude/agents/infra.md`, add `install.sh` to both scope statements —
      the `description:` frontmatter and the § *Scope* paragraph — noting it is the standalone
      end-user installer that writes the same `docker-compose.yaml` and `.env` infra already owns.
      This replaces the per-feature grant `049`, `061` and `066` each made in their own legend.
      *Done when:* `grep -c 'install.sh' .claude/agents/infra.md` returns at least `2`.

### Group 2 — the shared definition

Nothing else can be verified until this exists: eight of the nine wrappers and `bin/stop` all
source it, and `bin/stop`'s self-exclusion is wrong until `compose_project_name` is right.

- [x] **T002** `[infra]` Write `bin/_docker.sh` with `require_docker()` — `command -v docker`, then
      `docker compose version`, then `docker info` — each failure printing to `stderr` and
      `exit 1`. The engine message must name Docker Desktop and `systemctl start docker` and offer
      `docker run hello-world` (REQ-3). Header comment must state why the first two checks are not
      enough and that `install.sh` keeps its own copy (NFR-2). `chmod 644` — it is sourced, not run
      (NFR-5). → T001
      *Done when:* `bash -n bin/_docker.sh` exits 0; `. bin/_docker.sh && type require_docker`
      reports a function; `test -x bin/_docker.sh` is false.
- [x] **T003** `[infra]` Add `compose_project_name()` to `bin/_docker.sh`: `COMPOSE_PROJECT_NAME`
      when set, otherwise `printf '%s' "$(basename "$PWD")" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '-'`.
      The `printf` is the fix, not a style choice — `echo` feeds `tr -c` a trailing newline, which
      becomes a trailing `-` (REQ-8). Comment it with that consequence. → T002
      *Done when:* `. bin/_docker.sh && compose_project_name` prints `perceptor` in this checkout
      (AC-8), and `docker volume ls | grep mariadb` confirms the real volume is
      `perceptor_mariadb_data`, not `perceptor-_mariadb_data`.

### Group 3 — the installer and the wrappers

T004 and T005 are independent of T006; all three depend on Group 2.

- [x] **T004** `[infra] [P]` Add the engine check to `install.sh` inline (NFR-2), immediately after
      the existing Compose-plugin check and before the first prompt or write, so a refused check
      leaves the directory untouched (NFR-6). → T002
      *Done when:* `DOCKER_HOST=unix:///nonexistent.sock bash install.sh` run in an empty scratch
      directory prints the engine message, exits `1`, and leaves that directory empty (AC-1).
- [x] **T005** `[infra] [P]` Fix the project-name derivation in `install.sh` with the same
      `printf '%s'`, commented with what it broke: the `docker volume inspect
      "${project}_mariadb_data"` guard below it had never matched, so the warning against
      installing fresh over an existing database volume has never fired (REQ-8, `../plan.md`
      § *Risks*). → T003
      *Done when:* `bash -n install.sh` exits 0 and the derivation in `install.sh` and
      `compose_project_name` produce the same string for the same directory.
- [x] **T006** `[infra] [P]` Add `. "$(dirname "$0")/_docker.sh"` and `require_docker` to
      `bin/install`, `bin/dev`, `bin/prod`, `bin/build`, `bin/cli`, `bin/log`, `bin/export` and
      `bin/dbinit`. `bin/cli` covers `bin/bash`, `bin/npm`, `bin/mysql`, `bin/reset-password` and
      `bin/dbreset`, which all route through it, so those five get no prologue of their own.
      `bin/make_sample` is out of scope — it is ffmpeg on the host and touches no Docker. → T002
      *Done when:* `grep -lc require_docker bin/*` lists exactly those eight plus `bin/_docker.sh`
      and (after T007) `bin/stop`; `DOCKER_HOST=unix:///nonexistent.sock` against `bin/dev`,
      `bin/prod`, `bin/cli`, `bin/log` and `bin/install` prints the engine message and stops before
      the wrapper's own work (AC-2); with the engine up, `bin/log db` and
      `bin/cli db sh -c 'echo inside-container-ok'` behave exactly as before (AC-3).

### Group 4 — the stop wrapper

- [x] **T007** `[infra]` Write `bin/stop [-y|--yes]`, `chmod 755`: argument parsing **before**
      `require_docker` (AC-4), the `.env` guard copied from `bin/dev`, `docker compose stop` for
      this project, then seed detection over
      `docker ps --format '{{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Networks}}\t{{.Image}}'`
      matching `perceptor-net` or an image containing `perceptor` and excluding
      `compose_project_name` (REQ-5), expansion of each seed's project to its full running set, the
      printed list, then the three branches of REQ-6 — `-y`, interactive `[Y/n]` defaulting to yes,
      and no-tty refusing — and one `xargs -r docker stop`. Never `down`, never a volume (REQ-7).
      → T003
      *Done when:* `bash -n bin/stop` exits 0; `bash bin/stop --nope` prints
      `Usage: bin/stop [-y|--yes]` and exits 1 (AC-4); on a host with a second live Perceptor
      project, a dry-run copy (both mutating lines replaced with `echo`) lists that project's
      containers whole and none of this project's (AC-5), refuses with no tty and no `-y` (AC-6),
      prints `Left running.` on `n` and the full `docker stop` on `-y` or an empty answer (AC-7).

### Group 5 — verification and docs

- [x] **T008** `[docs]` `README.md`: add `bin/stop` to the wrapper table; note in the table's
      preamble that each wrapper checks for a reachable engine first; add a Troubleshooting entry
      for `Cannot connect to the Docker daemon` as the section's first (it bites at install time,
      before any other entry can apply); change the Install prerequisite from "Docker with the
      Compose plugin" to "Docker with the Compose plugin, **running**". → T007
      *Done when:* `grep -c 'bin/stop' README.md` is at least 1 and the Troubleshooting section's
      first `###` is the daemon entry.
- [x] **T009** `[docs]` Root `CLAUDE.md`: add `bin/stop` to the `bin/` table with `bin/stop -y` as
      its example, and a paragraph in § *Docker-first workflow* on `bin/_docker.sh` — the three
      checks, why the third is the one that matters, that it is sourced rather than run, and that
      it also holds `compose_project_name`. → T007
      *Done when:* `grep -c '_docker.sh' CLAUDE.md` is at least 1.
- [x] **T010** `[docs]` Walk the acceptance criteria in `spec.md`, tick each box, and set
      `status: Implemented` on `spec.md`, `plan.md` and `infra/plan.md`.
      *Done when:* every AC is ticked or explicitly marked not run with the reason — AC-9 is the
      one left open, since running it would have stopped the tester's live install.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Empty. Two things were decided inside the work rather than escalated, both recorded in
`../plan.md`: the `install.sh` territory grant became permanent (T001) instead of a fourth
per-feature exception, and the project-name bug found in T003 was fixed in `install.sh` as well
(T005) rather than left as a separate report, since it is one character, the same root cause, and
it had silently disabled an existing guard against data loss.

## Decisions taken here

- **`install.sh` duplicates `require_docker` on purpose** (NFR-2). It is fetched by `curl` into an
  empty directory; a `source` of `bin/_docker.sh` would be the first line to fail. Both files
  carry a comment pointing at the other.
- **`bin/stop` identifies foreign stacks by network, not by name.** The development host's own
  install directory is named `ptor`, so its containers are `ptor-api-1` and friends and a
  `--filter name=perceptor` finds nothing. `perceptor-net` is the signal that works regardless of
  directory name, and it is the only one that also finds another project's `db`, `redis` and
  `traefik`, whose images say nothing about Perceptor.
- **`bin/cli` keeps the full check** despite being the hot path for every `bin/npm` call
  (NFR-4, ~150 ms). Dropping it there would leave the most-used wrapper as the one that still
  fails obscurely.

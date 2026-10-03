---
title: Docker Engine Preflight and a Stop Wrapper — infra slice
service: infra
last_updated: 2026-10-02
status: Implemented
---

# PLAN: Docker Engine Preflight and a Stop Wrapper — `infra` (`infra/plan.md`)

## Scope

This feature is entirely `infra`: the host-side tooling in `bin/`, the standalone `install.sh`, and
the two documents that describe them. There is no `api`, `web` or `worker` slice, and there is
nothing for one to do — the whole feature happens either before any container exists or after the
containers have stopped serving.

Writes are confined to `bin/`, `install.sh`, `README.md`, the root `CLAUDE.md` and this directory.
**`install.sh` is not in the `infra` agent's declared writable set** (`.claude/agents/infra.md`
names `bin/`, `docker-compose*.yaml`, `.env.example`, `services/*/Dockerfile`,
`.github/workflows/release.yml` and the `torrent`/`indexer` init scripts). `049-published-images-install`
widened the territory "for this feature only" in its `tasks.md` legend to create the file;
`061-admin-password-off-env` and `066-https-local-ca` both edited it again the same way. Three
features in, the per-feature exception is the rule, so T001 adds it to the agent definition
permanently instead of granting it a fourth time. Anything outside the list above is a
stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `bin/_docker.sh` | New | `require_docker` (command, Compose plugin, reachable engine) and `compose_project_name`. Sourced, not executable — mode `644` |
| `install.sh` | Modified | A third check after the existing two, inline per NFR-2; the project-name derivation fixed (REQ-8) |
| `bin/install` | Modified | Two-line prologue after its `cd` |
| `bin/dev` | Modified | Same |
| `bin/prod` | Modified | Same |
| `bin/build` | Modified | Same |
| `bin/cli` | Modified | Same, before `CONTAINER=$1`. Covers `bin/bash`, `bin/npm`, `bin/mysql`, `bin/reset-password` and `bin/dbreset`, which all route through it |
| `bin/log` | Modified | Same |
| `bin/export` | Modified | Same — calls `docker compose exec` directly, not through `bin/cli` |
| `bin/dbinit` | Modified | Same, same reason |
| `bin/stop` | New | Stop this project, then find and offer to stop Perceptor containers outside it. Mode `755` |
| `.claude/agents/infra.md` | Modified | `install.sh` added to both scope statements (T001) |
| `README.md` | Modified | `bin/stop` in the wrapper table; the wrapper preamble notes the engine check; a Troubleshooting entry for the stopped daemon; the Install prerequisite says "running" |
| `CLAUDE.md` (root) | Modified | `bin/stop` in the `bin/` table; a paragraph in § *Docker-first workflow* on `bin/_docker.sh` |

`bin/make_sample` is deliberately **not** in this list (spec § Out of Scope).

## Existing code to reuse

- `install.sh` lines 20–27 — the two checks that already existed. The new one goes beside them in
  the same shape and the same register (a sentence of diagnosis, then what to do), rather than
  replacing them: all three are real and they fail for different reasons.
- `install.sh`'s `project="$(basename "$PWD" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '-')"` — the
  derivation `compose_project_name` is, bug fixed. Do not write a second derivation beside it.
- `bin/dev`'s `.env` guard and `set -a; . ./.env; set +a` — `bin/stop` copies both verbatim so the
  three stack wrappers behave identically when `.env` is missing, including the Spanish message
  (`\.env no existe. Corré bin/install primero.`), which is legacy copy and matched on purpose.
- `bin/dev`'s comment register — the inline comments explain *why*, in English, at the length the
  file already uses. New comments are English (Article VI); the Spanish ones already in these files
  are legacy and are not extended.

## Steps

1. Write `bin/_docker.sh`: `require_docker` with the three checks, every message to `stderr`, each
   failure `exit 1`; `compose_project_name` honouring `COMPOSE_PROJECT_NAME` and otherwise deriving
   from `basename "$PWD"` with `printf '%s'` so `tr -c` has no trailing newline to rewrite. Header
   comment states that `install.sh` keeps its own copy and why. `chmod 644`.
2. Add the third check to `install.sh`, inline, after the Compose-plugin check and before anything
   that writes or prompts. Comment it with the reason the two existing checks do not catch this.
3. Fix the project-name derivation in `install.sh` (`printf '%s'`), with a comment naming the
   consequence: the volume guard below it was looking for `perceptor-_mariadb_data`.
4. Add `. "$(dirname "$0")/_docker.sh"` + `require_docker` to the nine wrappers. In the four that
   `cd` to the repository root, place it after the `cd`; the path is `$0`-relative, so either side
   works, and after the `cd` keeps the prologue visually together with the `.env` guard.
5. Write `bin/stop`: argument parsing **before** the preflight (so a typo is not reported as a
   Docker problem), `.env` guard, `docker compose -f docker-compose.yaml stop` for this project,
   then seed detection by `perceptor-net`/image excluding `compose_project_name`, expansion of each
   seed's project to its full running set, the printed list, the `-y`/tty/no-tty branches, and one
   `xargs -r docker stop`. `chmod 755`.
6. Documentation (T008–T009), last.

## Contract obligations

None. `spec.md` § *GraphQL Contract Delta* reads "None — this feature does not cross the service
boundary", and this slice adds no GraphQL surface, no error key and no `extensions.i18n` key. The
messages this feature prints are host-side shell output, not `web` copy: they are **English**
(Article VI), not catalog-driven, because they are read in a terminal by someone who may not have
a Perceptor account yet and there is no locale to resolve against. `services/web/messages/*.json`
is untouched, so `check-messages` has nothing to drift.

## Tests

There is no test harness for `bin/` — no suite, no runner, and introducing one for nine two-line
prologues would be out of proportion to the change. Article IX is answered here by the acceptance
criteria being *runnable commands* rather than by unit tests, and specifically by the three that
exercise failure: AC-1, AC-2 and AC-4 are each a one-line reproduction with an expected exit code.
`DOCKER_HOST=unix:///nonexistent.sock` is the mechanism — it makes "the engine is unreachable"
reproducible on a host whose engine is running, with no privileged operation and nothing to
restore.

Two silent failures are specifically defended, both recorded in `../plan.md` § *Risks*:

- The project-name bug (REQ-8) produced no error anywhere and had disabled `install.sh`'s
  existing database-volume guard entirely. AC-8 pins the derived name, and it is checked against
  the real volume name on the host (`perceptor_mariadb_data`) rather than against the derivation's
  own output.
- `bin/stop` mis-classifying its own containers as foreign. AC-5 names the exact expected list on
  a host with two live projects.

`bash -n` over every script in `bin/` plus `install.sh` is the closest thing to a lint pass and is
part of *Done when* below.

## Done when

```bash
for f in bin/*; do [ -f "$f" ] && bash -n "$f" || echo "FAIL $f"; done
bash -n install.sh
DOCKER_HOST=unix:///nonexistent.sock bash install.sh                  # engine message, exit 1
DOCKER_HOST=unix:///nonexistent.sock bash bin/cli api echo hi         # same
bash bin/stop --nope                                                   # usage message, exit 1
bin/cli db sh -c 'echo inside-container-ok'                            # happy path unaffected
. bin/_docker.sh && compose_project_name                               # no trailing dash
```

Every command above exits as described, `git diff --stat services/` is empty, and
`git status --short services/api/prisma` is empty.

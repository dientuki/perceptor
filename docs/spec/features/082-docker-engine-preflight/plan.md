---
title: Docker Engine Preflight and a Stop Wrapper — Implementation Plan
spec_version: 1.0.0
last_updated: 2026-10-02
status: Implemented
---

# PLAN: Docker Engine Preflight and a Stop Wrapper (`plan.md`)

## Approach

Two decisions carry this feature.

**The preflight is a sourced library, not a copied block.** `bin/_docker.sh` defines
`require_docker` and `compose_project_name` and nothing else — no `set -e`, no `cd`, no output at
source time — so a wrapper can source it on its second line, before its own `cd "$(dirname "$0")/.."`,
and `exit 1` from inside the function terminates the caller. Nine wrappers now begin with the same
two lines. The alternative, a check pasted into each one, is how the two checks that already existed
in `install.sh` came to be subtly wrong in a way nobody noticed: there was one copy, it looked
complete, and `docker info` was simply missing from it.

`install.sh` is the deliberate exception (spec NFR-2). It is fetched by `curl` into an empty
directory with no `bin/` beside it, so it keeps the three checks inline. That duplication is stated
in a comment in both files, each pointing at the other, because a silent second copy is exactly the
kind of thing that drifts.

**`bin/stop` identifies other stacks by network, not by name.** The obvious implementation —
`docker ps --filter name=perceptor` — fails on the first real case: the install directory on the
development host is named `ptor`, so its containers are `ptor-api-1`, `ptor-db-1` and so on, and a
name filter finds none of them. Every service of every Perceptor stack joins the `perceptor-net`
bridge declared in `docker-compose.yaml`, which Compose names `<project>_perceptor-net`, and
`docker ps --format '{{.Networks}}'` reports it. That one signal finds a whole stack regardless of
the directory it was started from, and finds the containers whose images say nothing about
Perceptor — `mariadb`, `redis`, `traefik`, `flaresolverr` — which a name or image filter cannot.
The image match (`{{.Image}}` containing `perceptor`) is kept beside it as a second signal, for a
container that has somehow lost the network.

Both of those matches are only *seeds*. A seed proves its project is still up, so the script then
asks Docker for every running container with that project's label and stops the set — otherwise
stopping "the leftovers" would stop a stack's `web` and leave its `db` holding port 3306.

Reused rather than reinvented: the project-name derivation already existed in `install.sh`
(`basename | tr | tr`), and `compose_project_name` is that same logic with its newline bug fixed —
not a second, differently-shaped derivation beside it. `bin/stop`'s `.env` guard and
`set -a; . ./.env; set +a` are copied verbatim from `bin/dev`, so the three stack wrappers behave
the same way on a missing `.env`.

## Order of Work

One service, so the order is about risk, not about contracts: the shared helper has to exist and be
correct before nine wrappers depend on it, and `bin/stop` cannot be written until
`compose_project_name` returns a name that actually matches a container label.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `infra` | `bin/_docker.sh` — the definition every later step sources. Nothing else can be verified until `require_docker` and `compose_project_name` behave |
| 2 | `infra` | `install.sh` — the field report's actual path, and the one place that must *not* source the helper (NFR-2). Independent of step 3 |
| 3 | `infra` | The nine wrappers — mechanical once step 1 exists, two lines each |
| 4 | `infra` | `bin/stop` — depends on step 1 for `compose_project_name`; its self-exclusion is wrong until REQ-8 is fixed |
| 5 | `docs` | `README.md` and root `CLAUDE.md` — last, so the tables describe what exists |

Steps 2 and 3 can genuinely run in parallel once step 1 lands. Step 4 cannot overlap step 1.

## Contract Freeze

`spec.md` § *GraphQL Contract Delta* says **None**, and that is the frozen part: this feature adds
no GraphQL surface, so there is nothing for an implementer to be tempted to adjust. Two things that
look wrong from inside the slice and are right for the feature as a whole, recorded here so they
survive review:

- **`install.sh` duplicates `require_docker` instead of sourcing it.** Inside the diff this reads
  as copy-paste to be cleaned up. It is NFR-2: the file ships alone.
- **`bin/cli` pays a `docker info` on every call**, including the ones an agent makes in a loop to
  run tests. That is NFR-4, accepted deliberately at ~150 ms against the container exec that
  follows. The fix for a wrapper that feels slow is not to drop the check from it.

## Migrations

**None.** No schema change, no Prisma migration, no data touched. Reversibility is `git revert`:
deleting `bin/_docker.sh` and `bin/stop` and dropping the two-line prologue from nine wrappers
returns the repository to a stack that behaves exactly as it did before, since nothing persists any
state this feature introduced.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `bin/stop` stops another user's or another project's unrelated containers | A container matched by the image signal alone — any image with `perceptor` in its name — is stopped with no warning | Containers outside this project are never stopped without confirmation (REQ-6), and the full list is printed before the prompt. `-y` is opt-in, and with no tty the default is to stop nothing |
| The self-exclusion misses, so `bin/stop` reports its own containers as foreign | Harmless-looking, wrong output; worse, with `-y` it `docker stop`s what `docker compose stop` just stopped, hiding a real leftover in the noise | This is REQ-8 and it happened: `perceptor-db-1` appeared in the leftover list during the first dry run. Fixed at the source (`printf` instead of `echo`) and re-verified. AC-5 and AC-8 both pin it |
| The silent one: the project-name bug in `install.sh` | `docker volume inspect "${project}_mariadb_data"` looked for `perceptor-_mariadb_data`, a name that cannot exist, so the guard against installing fresh over an existing database volume **never fired once** — no error anywhere, and the symptom only ever appears as MariaDB rejecting credentials nobody can reproduce (Constitution, Article IX) | Same one-character fix, in both copies. AC-8 verifies the derived name against the real volume name on the host |
| A wrapper added later forgets the preflight | Back to a raw `Cannot connect to the Docker daemon` in one place, with no pattern violated loudly enough to notice | The helper is the documented entry point in both `CLAUDE.md` and `README.md`, and the two-line prologue is now the visible convention in nine files |
| `docker info` is slow or hangs on a degraded host | Every wrapper inherits the delay, including an agent's test loop | Accepted (NFR-4). A hanging `docker info` means a hanging `docker compose` immediately after it, so the check adds no failure mode of its own |

## Verification

Everything here is host tooling, so the commands are the scripts themselves rather than anything
through `bin/cli`. Syntax, for every script in the repository:

```bash
for f in bin/*; do [ -f "$f" ] && bash -n "$f" || echo "FAIL $f"; done
bash -n install.sh
```

The failure path, which is the point of the feature — against a socket that cannot exist, so no
engine is touched:

```bash
DOCKER_HOST=unix:///nonexistent.sock bash install.sh
DOCKER_HOST=unix:///nonexistent.sock bash bin/dev
DOCKER_HOST=unix:///nonexistent.sock bash bin/cli api echo hi
```

Each must print the engine message and exit non-zero. For `install.sh`, run it in an empty
directory and confirm it is still empty afterwards (NFR-6).

The happy path, proving the preflight is invisible:

```bash
bin/log db
bin/cli db sh -c 'echo inside-container-ok'
. bin/_docker.sh && compose_project_name   # must print the directory name with no trailing dash
```

Then `bin/stop`'s detection, which is worth running **dry** first on any host with a live stack —
copy the script, replace its `docker compose … stop` and `xargs … docker stop` lines with `echo`,
and compare the list it prints against `docker ps --format '{{.Names}} {{.Networks}}'` by hand.
Confirm that containers of the current project are absent and that a foreign project appears
whole, not partially. Only then run it for real, and follow it with `bin/dev` to confirm REQ-7.

---
title: Multi-architecture published images — Tasks
last_updated: 2026-10-02
status: Done
---

# TASKS: Multi-architecture published images (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[infra]` | Repo-root and third-party-container territory. Here: `.github/workflows/release.yml` and `install.sh`. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[api]`, `[web]` or `[worker]` task exists in this feature, and that is the point: NFR-1 says
nothing under `services/*/src`, no Dockerfile stage and no Prisma schema changes. An agent that
finds itself opening a `.ts` file has left the feature and must stop and report.

**What no agent can close.** AC-1 to AC-5 need a real release-candidate tag pushed to GitHub, and
AC-2, AC-3, AC-3b and AC-6c need an Apple Silicon machine. Pushing a release tag is an
outward-facing, irreversible act and is the user's, not an agent's; this development host has no
`binfmt`/QEMU registered, so it cannot stand in for the Mac either. T006 records which criteria
were actually run and which were not, the way `069` and `076` did — it does not tick a box nobody
watched.

## Tasks

### Group 1 — the release pipeline

- [x] **T001** `[infra]` Split `build-and-push` in `.github/workflows/release.yml` into two jobs.
      `build`: matrix over `service × platform` (`linux/amd64` on `ubuntu-latest`, `linux/arm64` on
      `ubuntu-24.04-arm`), keeping `needs: verify`, `fail-fast: false` and the existing `include:`
      that gives `web`/`api`/`worker` their `target: prod`; the build step loses `tags:` entirely
      and pushes by digest (`type=image,push-by-digest=true,name-canonical=true,push=true`), then
      uploads its digest as an artifact. `merge`: matrix over the five services, `needs: build`,
      downloading that service's digests and assembling one manifest list with
      `docker buildx imagetools create`, carrying the moved `Resolve image tags` and
      `Make package public` steps.
      *Done when:* parsing the file lists exactly the jobs `verify`, `build`, `merge`; the `build`
      matrix expands to ten legs across the two runner labels; `grep -n 'tags:' ` shows no `tags:`
      key anywhere inside `build`; `merge` declares `needs: build`; **and** the digest artifact name
      contains both `matrix.service` and the platform. That last clause is not a detail — a name
      that collides across services tags `perceptor-web` with `api`'s digest, and the result pulls,
      starts and runs the wrong program with no error anywhere (`plan.md` § Risks).
- [x] **T002** `[infra]` Rewrite the two prose blocks in `.github/workflows/release.yml`: the header
      comment that states `All five build for linux/amd64 only` as a decision, and the operational
      note at the foot claiming nothing in this repository can prevent a half-published tag — under
      T001 the common case is prevented structurally, so it must say what is now guaranteed rather
      than stand as a stale warning. → T001
      *Done when:* `grep -n 'linux/amd64 only' .github/workflows/release.yml` returns nothing, and
      the header describes the build/merge split and both architectures.

### Group 2 — the installer

Independent of Group 1 as code: a different file, no shared symbol. It is marked `[P]` for that
reason, not because the two can be verified together — AC-2 cannot run until Group 1 has shipped a
tag.

- [x] **T003** `[infra] [P]` Add the architecture check to the preflight block at `install.sh:20-38`.
      Replace `docker info >/dev/null 2>&1` with a capture of
      `docker info --format '{{.Architecture}}'` — an empty result is the engine-not-running branch
      and must print the existing message **verbatim** (`082` AC-1 asserts that string and README
      quotes it) — then add a fourth branch accepting `x86_64` and `aarch64`, the values the engine
      actually answers, never `amd64`/`arm64`. Anything else prints the detected value and the
      supported list and exits `1`. Do not touch `bin/_docker.sh` (NFR-7), do not ship an override
      variable, and extend the existing comment at `install.sh:29-30` rather than writing a new one
      beside it.
      *Done when:* `bash -n install.sh` passes; in an empty directory
      `DOCKER_HOST=unix:///nonexistent.sock bash install.sh` still prints `082`'s engine message and
      **not** an architecture one, exits `1` and leaves the directory empty; and a local copy with
      the detected architecture substituted by hand prints the detected value and the supported
      list, exits `1`, and likewise leaves the directory empty — no `.env`, no
      `docker-compose.yaml`. Paste the real output of both runs.

### Group 3 — documentation

Both describe what shipped, so both wait on the two changes above.

- [x] **T004** `[docs] [P]` `README.md`: state the published architectures in § *Install*, and add a
      § *Troubleshooting* entry for `no matching manifest` beside the existing daemon one — that is
      where someone who already hit the error will look. → T001, T003
- [x] **T005** `[docs] [P]` Root `CLAUDE.md`: name the published architectures in § *Docker-first
      workflow* and on the `PERCEPTOR_TAG` bullet of § *Environment*, and append this feature to
      § *Current state* in the existing form — what was measured, and what was not run. → T001, T003

### Group 4 — close

- [x] **T006** `[docs]` Walk the acceptance criteria in `spec.md`, ticking only what was actually
      observed and naming what was not, then set `status: Implemented` on `spec.md`, `plan.md` and
      `infra/plan.md`. → T001, T002, T003, T004, T005

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

---
title: Local Image Tag Collision Between Build Targets — Tasks
last_updated: 2026-09-10
status: Done
---

# TASKS: Local Image Tag Collision Between Build Targets (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[infra]` | Repo-root and third-party-container territory — `bin/`, `docker-compose.yaml`, `.env.example`, `services/*/Dockerfile`, the container config under `services/torrent/` and `services/indexer/`, and `docs/spec/docker/`. Owned by the `infra` agent since `003-auth-user-management`, which retired the earlier `[orch]` catch-all. The difference from `[docs]` is executable config versus prose, so these carry a real *Done when*. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**No `[api]`, `[web]` or `[worker]` task exists in this feature.** NFR-5 confines the diff to
repo-root tooling, container wiring and prose; nothing under `services/*/src/`, `services/*/prisma/`
or any `package.json` is touched. An agent that finds itself editing service source has misread the
brief and should stop and report.

**`plan.md` § *Order of Work* names `[orch]` for `.github/workflows/release.yml`.** That tag does not
exist — `[infra]` retired it. T001 resolves this by widening the `infra` agent's territory to name
the file, which makes T005 a legitimate `[infra]` task. See § *Decisions taken here* at the bottom.

## Tasks

### Group 1 — territory

This group exists because two files this feature must change sit outside every agent's declared
writable set. Widening the brief **before** dispatching is what stops an agent from either refusing
mid-task or editing outside its boundary.

- [x] **T001** `[docs]` In `.claude/agents/infra.md`, widen both scope statements (the
      `description:` frontmatter and the § *Scope* paragraph) from `docker-compose.yaml` to
      `docker-compose*.yaml`, and add `.github/workflows/release.yml` to the writable set, noting it
      builds the same `services/*/Dockerfile` stages infra already owns.
      *Done when:* `grep -n 'docker-compose\*\.yaml\|release\.yml' .claude/agents/infra.md` returns
      at least three lines, across both the frontmatter and the § *Scope* paragraph.

### Group 2 — the stage rename

One rename across three Dockerfiles and three consumers. Each task below has its own verifiable
*Done when*, but **all five land in one commit**: between T002 and T005 the release workflow asks
for a stage that no longer exists, and nothing in the local stack notices (`plan.md` § *The
`release.yml` window*).

- [x] **T002** `[infra]` In `services/{api,web,worker}/Dockerfile`, rename the final stage
      `FROM base AS runner` → `FROM base AS prod` and its `# 4. RUNNER:` banner comment to `PROD`.
      Change nothing else — not the `COPY --from=builder` lines (they name `builder`), not `CMD`,
      not the users. Leave `services/worker/Dockerfile:6`'s `(ver src/ffmpeg/runner.ts)` alone.
      *Done when:* `docker build --target prod services/api`, `… services/web` and `… services/worker`
      each exit 0, and `docker build --target runner services/api` fails with an unknown-stage error.
      → T001
- [x] **T003** `[infra]` In `bin/prod`, change `BUILD_TARGET=runner` to `BUILD_TARGET=prod` and its
      header comment's "stage runner de cada Dockerfile" to name `prod`. Keep `-d --build` exactly
      as it is (`plan.md` § *Contract Freeze*).
      *Done when:* `grep -c 'BUILD_TARGET=prod' bin/prod` returns 1, `grep -c runner bin/prod`
      returns 0, and `grep -c -- '--build' bin/prod` still returns 1. → T002
- [x] **T004** `[infra]` Rewrite `bin/build` to take the target as `$1` (`dev`|`prod`, **required,
      no default**) and the optional service as `$2`, reusing the existing
      `case " $BUILDABLE " in *" $1 "*)` membership idiom for a new `TARGETS_ALLOWED="dev prod"`
      check. Usage becomes `Uso: bin/build <dev|prod> [web|api|worker|torrent|indexer]`; the final
      line becomes `BUILD_TARGET="$1" docker compose $COMPOSE_FILES build $TARGETS`. The header
      comment's "stage runner" claim is false either way — rewrite it in English (Article VI) or
      delete it if the usage line already says it.
      *Done when:* `bin/build prod api` and `bin/build dev api` each exit 0; `bin/build staging api`
      and bare `bin/build` each exit non-zero printing the usage line and creating no image
      (`docker image ls` unchanged); `bin/build web` — the old, now-invalid form — exits non-zero.
      → T002
- [x] **T005** `[infra]` In `.github/workflows/release.yml`, change the three matrix `target: runner`
      entries to `target: prod` and the header comment's "`runner` stage" to `prod`. Touch nothing
      else in that file — not the tags, not the dead `version` step (spec § *Out of Scope*).
      *Done when:* `grep -c 'target: prod' .github/workflows/release.yml` returns 3 and
      `grep -c runner .github/workflows/release.yml` returns 0. → T001, T002

### Group 3 — the tag fix

Depends on Group 2 only so that the suffix reads `local-prod` rather than `local-runner`. T007 must
not land before T006: a `bin/dev` with no `--build` against a still-shared `:local` tag is the
original bug with its one mitigation removed.

- [x] **T006** `[infra]` In `docker-compose.build.yaml`, change `image:` for `web`, `api` and
      `worker` to `perceptor-<svc>:local-${BUILD_TARGET:-dev}`. **Keep the `:-dev` default** — six
      `bin/` wrappers run bare `docker compose` with no `BUILD_TARGET` and rely on it
      (`plan.md` § *Contract Freeze*). `torrent` and `indexer` keep `perceptor-<svc>:local` verbatim
      (REQ-5). Correct the header comment, which asserts the tag is `perceptor-<svc>:local`.
      *Done when:* `bin/build dev api` then `bin/build prod api` leaves **both**
      `perceptor-api:local-dev` and `perceptor-api:local-prod` in `docker image ls` with different
      IDs, and `docker image inspect --format '{{.Config.Cmd}}' perceptor-api:local-prod` prints
      `[node dist/src/main.js]` while the same on `local-dev` does not. → T002
- [x] **T007** `[infra]` In `bin/dev`, remove `--build` from the final `docker compose … up` line and
      delete the header paragraph (lines 7–12) explaining why it was mandatory — it documents a bug
      that no longer exists. Anything kept or added there is English (Article VI, Article XI).
      *Done when:* `grep -c -- '--build' bin/dev` returns 0; with the dev images already built,
      `bin/dev -d` output contains no `Building` and no `Built` line for `web`, `api` or `worker`,
      and `docker compose -f docker-compose.yaml -f docker-compose.build.yaml -f
      docker-compose.dev.yaml ps` shows `api` healthy with `web` and `worker` started. → T006
- [x] **T008** `[infra]` Comment-only pass over the two compose files infra owns: `docker-compose.yaml`
      line 124 ("en el runner publicado") and `docker-compose.dev.yaml` line 4 ("target `runner`").
      **Leave `docker-compose.yaml` line 228 alone** — it names `runner.ts`, not a stage. Change no
      key in `docker-compose.yaml`.
      *Done when:* `docker compose -f docker-compose.yaml config` still resolves all five own
      services to `ghcr.io/dientuki/perceptor-<svc>:…` with no `build:` key and no local image name
      (AC-8), and neither file contains a `runner` that means a Docker stage. → T002

### Group 4 — documentation

All three are prose and can run in parallel with each other and with Group 3 — no comment affects
what Docker does. Each must also fix the now-invalid `bin/build web` example where it appears.

- [x] **T009** `[docs] [P]` Root `CLAUDE.md`: the `bin/prod` and `bin/build` rows of the Docker-first
      table (lines 84–85 — `bin/build`'s example becomes `bin/build prod web`), the
      `docker-compose.build.yaml` paragraph's `perceptor-<svc>:local` claim and "`runner` image"
      phrase (lines 107–109), and § *Environment*'s `BUILD_TARGET` entry (lines 151–152: the stage
      list becomes `base`/`dev`/`builder`/`prod`). Add the new `bin/dev`-does-not-rebuild behaviour
      and the two local tags to the wrapper table's prose. → T004, T006, T007
- [x] **T010** `[docs] [P]` `README.md` line 201's `bin/prod` row (`runner` stage → `prod`) and its
      `bin/build` row if present, including the invocation form. → T004
- [x] **T011** `[docs] [P]` `services/api/CLAUDE.md` lines 27 and 82 ("the `runner` image", "runner's
      `npm prune`") and `services/worker/CLAUDE.md` lines 320 and 341 ("the `runner` image's
      `builder` stage", "by `dev` and `runner`") — stage references only. **Leave every other
      `runner` in both files**: `services/worker/CLAUDE.md` lines 26, 42, 76, 192, 310 and 333 name
      `ffmpeg/runner.ts`, and `services/web/CLAUDE.md` lines 84 and 595 mean a test runner. → T002

### Group 5 — verification and close

- [x] **T012** `[infra]` Run the full acceptance pass in `plan.md` § *Verification*, including the
      three failure paths and the two reads that catch the silent regressions: `bin/cli api node -v`
      plus `bin/mysql -e 'select 1'` (proves the `:-dev` default survived — these run bare
      `docker compose` with no `BUILD_TARGET`), and `docker image inspect --format
      '{{.Config.Cmd}}'` on both tags of all three services (proves each image came from the stage
      its name claims; a passing `docker build` proves only that a stage exists). Includes the
      destructive AC-6 pass — `bin/install` offers to regenerate `.env` (answer `N`) and runs
      `bin/dbreset`, so expect to reseed.
      *Done when:* every command in that section behaves as its expected-result paragraph says; in
      particular AC-12 (`docker tag alpine perceptor-api:local-prod`, then `bin/dev -d`, `api` still
      healthy), AC-13 (`docker image rm perceptor-api:local-dev`, then `bin/dev -d` builds with no
      `Pulling` line for `api`) and AC-14 (`bin/build staging api` creates nothing) all hold.
      Finish by removing the three orphaned pre-feature images
      (`docker image rm perceptor-{web,api,worker}:local`) and reporting that you did.
      → T003, T004, T005, T007, T008
- [x] **T013** `[docs]` Vocabulary and history audit. Over the live files only — excluding
      `docs/spec/features/0*/` and `.claude/settings.local.json` —
      `grep -rn 'BUILD_TARGET=runner\|AS runner\|target: runner'` returns nothing, and every
      surviving `runner` names `ffmpeg/runner.ts` or a test runner (AC-10's must-change and
      must-not-change lists are exhaustive; check both halves). Then confirm no historical spec was
      rewritten (AC-11).
      *Done when:* that grep is empty, and `git status --short docs/spec/features` lists nothing
      under `001`–`049`. → T009, T010, T011
- [x] **T014** `[docs]` Walk the fourteen acceptance criteria in `spec.md`, tick each box, and set
      `status: Implemented` on `spec.md`, `plan.md`, `infra/plan.md` and this file. Record the two
      stale `BUILD_TARGET=runner` allowlist entries left in `.claude/settings.local.json` as a known
      non-issue (they stop matching, so those commands prompt again — machine-local developer
      config, deliberately untouched). → T012, T013

## Acceptance criteria coverage

| AC | Covered by |
| :-- | :-- |
| AC-1 (the original bug, gone) | T012 |
| AC-2 (dev runs the dev image) | T006, T012 |
| AC-3 (`bin/build`'s artifact survives) | T012 |
| AC-4 (no rebuild on a warm start) | T007, T012 |
| AC-5 (`bin/build` builds the target it was told) | T004, T006 |
| AC-6 (install then start, one build) | T012 |
| AC-7 (single-stage services unchanged) | T006, T012 |
| AC-8 (runtime untouched) | T008, T012 |
| AC-9 (the release build still resolves its stage) | T002, T005 |
| AC-10 (no stale vocabulary) | T013 |
| AC-11 (history is not rewritten) | T013 |
| AC-12 (poisoned prod image cannot reach dev) | T012 |
| AC-13 (missing dev image builds, never pulls) | T012 |
| AC-14 (unknown target builds nothing) | T004, T012 |

## Decisions taken here

Two things `plan.md` left for this file, recorded so `/implement` does not rediscover them:

- **`[orch]` does not exist**, so `.github/workflows/release.yml` could not be tagged as the plan
  assumed. Rather than mis-tagging it `[docs]` (it is executable config, not prose — the legend's own
  distinction), T001 widens the `infra` agent's territory to name the file, and T005 is a normal
  `[infra]` task. The alternative, if that widening is unwanted, is for the user to make that
  three-line edit by hand and drop T001 and T005 — say so before `/implement`, since every other
  task assumes T001 landed.
- **`docker-compose.build.yaml` and `docker-compose.dev.yaml`** were likewise outside the `infra`
  brief, which names only `docker-compose.yaml`. Same resolution in T001 — treated as an omission,
  since `049-published-images-install` already had the `infra` agent create
  `docker-compose.build.yaml`.

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty
entry is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

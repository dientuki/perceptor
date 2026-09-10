---
title: Local Image Tag Collision Between Build Targets — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-09-10
status: Implemented
---

# PLAN: Local Image Tag Collision Between Build Targets (`plan.md`)

## Approach

The defect is one missing dimension in a name. `docker-compose.build.yaml` already parameterises the
*stage* it builds (`target: ${BUILD_TARGET:-dev}`) and already overrides the *name* it builds under
(`image: perceptor-<svc>:local`) — it just never taught the second to follow the first. The fix is to
reuse the variable that is already there:

```yaml
image: perceptor-api:local-${BUILD_TARGET:-dev}
```

That is the whole of REQ-1 and REQ-2. No new variable, no new file, no logic in any wrapper. The
`${BUILD_TARGET:-dev}` default is load-bearing and must be kept in both places: `bin/cli`,
`bin/npm`, `bin/bash`, `bin/mysql`, `bin/dbinit` and `bin/dbreset` all run bare `docker compose`
with no `BUILD_TARGET` in their environment, and the default is what makes them resolve the dev name
a developer is actually running. `docker compose exec` finds its container by project and service
label rather than by image, so none of those six needs an edit — but a `${BUILD_TARGET}` with no
default would make every one of them interpolate an empty tag.

The local tag is `local-dev` / `local-prod`, not `dev` / `prod`. Both satisfy NFR-1 literally, since
`docker.io/library/perceptor-api` does not exist either way, but `perceptor-api:dev` reads like a
published development image in a `docker image ls`. Keeping the `local-` prefix preserves exactly
the signal the current `:local` gives correctly, at no cost. `torrent` and `indexer` keep the bare
`:local` (REQ-5) — they have no `target:` and no stages, so a suffix would claim a distinction that
does not exist.

The stage rename `runner` → `prod` (REQ-6) is a label change: `FROM base AS prod` on the same
instructions, so every built image is byte-identical in substance and NFR-4 holds by construction.
It is in this feature rather than a cleanup of its own because the vocabulary mismatch
(`bin/prod` setting `BUILD_TARGET=runner`) is the same defect one level up — a reader who has to map
two words onto one target is one step from a developer who maps two stages onto one tag. It also
vacates a word this repository overloads: `services/worker/src/ffmpeg/runner.ts` is cited by name in
constitution Articles XI and XII and is **not** renamed (spec § Out of Scope).

`bin/build` takes the target as its first positional argument (REQ-7), which is what replaces the
`--build` being removed from `bin/dev`. The existing argument-validation idiom in that file — the
`case " $BUILDABLE " in *" $1 "*)` membership test — is reused verbatim for the target list rather
than reinvented; it already fails closed with a usage message and a non-zero exit, which is exactly
what REQ-7's no-fallback clause asks for.

**The alternative that was considered and rejected**: keeping `bin/build` as it is and documenting
`bin/dev --build` as the rebuild path (the args already forward). It needs no code at all, but it
leaves "how do I rebuild" as a flag on the wrapper whose entire purpose in this feature is *not*
building, and it leaves `bin/build`'s own header comment ("stage runner de cada Dockerfile") as the
only statement of which target it builds. A wrapper named `build` should take the thing it builds.

## Order of Work

There is one service in `services:` (`infra`), so this is not a cross-service sequencing problem —
it is an ordering problem *within* one slice, plus a doc sweep the `infra` agent does not own. The
order below exists because two steps can leave the stack unstartable if they land apart.

| Step | Owner | Why it must come here |
| :-- | :-- | :-- |
| 1 | `infra` | Rename the stage in all three Dockerfiles **and** point `bin/build`/`bin/prod` at `prod` in the same step. A renamed stage with a wrapper still asking for `runner` fails every prod build; the reverse fails the same way |
| 2 | `infra` | Parameterise `image:` in `docker-compose.build.yaml`; remove `--build` from `bin/dev`. Depends on step 1 only for the tag to read `local-prod` rather than `local-runner` |
| 3 | `orch` | `.github/workflows/release.yml`'s three `target:` lines. Different owner than step 1 (see the territory split below) but the **same commit** — see the window note below |
| 4 | `docs` | Every comment and document naming the old stage: the three Dockerfile banners, `docker-compose.{yaml,dev.yaml}` comments, `README.md`, root `CLAUDE.md`, `services/{api,worker}/CLAUDE.md` |
| 5 | `verify` | The full acceptance pass (§ Verification). Cannot start before 1–3 are all in |

Steps 1 and 2 **must not run in parallel** — they are two halves of one rename, and the window
between them is a stack that cannot build. Step 4 can run in parallel with either, since no comment
affects what Docker does. Step 5 is strictly last.

**The `release.yml` window.** Step 3 is a different owner but not a later commit: from the moment
step 1 lands, the release workflow asks for a stage that no longer exists, and the next `v*.*.*` tag
push fails all three Node builds. Nothing in the local stack notices, which is exactly why it needs
saying — steps 1–3 must land together, and `/tasks` should order step 3 as a dependency of closing
the feature, not as a trailing cleanup.

**Territory split this plan assumes** (the spec's § *Territory note* defers the decision here):

- `infra` writes `bin/*`, `services/*/Dockerfile`, `docker-compose.build.yaml` and
  `docker-compose.dev.yaml`. The latter two are outside the letter of `.claude/agents/infra.md`,
  which names only `docker-compose.yaml`; this plan treats that as an omission in the brief — both
  are repo-root compose wiring no service owns, and `049-published-images-install` already had the
  `infra` agent create `docker-compose.build.yaml` in the first place. **Widen the brief's scope
  sentence to `docker-compose*.yaml` as part of this feature**, so the next spec does not relitigate
  it.
- `.github/workflows/release.yml` is `[orch]`. It is not in any agent's writable set, it belongs to
  the release path, and getting it wrong is the one edit in this feature that can publish the wrong
  stage to GHCR (NFR-4). It is three identical lines plus a header comment — cheaper and safer
  done directly than delegated.
- `README.md`, root `CLAUDE.md`, `services/api/CLAUDE.md` and `services/worker/CLAUDE.md` are
  `[docs]`. Dispatching the `api` and `worker` agents to change one word each in their own
  `CLAUDE.md` buys ownership correctness at the price of two cold agent starts; these are
  documentation edits that touch no code those agents own.

## Contract Freeze

`spec.md`'s § GraphQL Contract Delta is **None**, and it is frozen at `status: Approved` like any
other. There is no schema, no resolver, no type and no error in this feature — if an implementer
finds themselves editing anything under `services/*/src/`, that is the signal to stop and report,
not a sign the contract was incomplete (NFR-5).

What an implementer will be tempted to change and must not:

- **The `--build` in `bin/prod`.** It looks redundant next to per-target tags and it is not.
  `bin/prod` rebuilds so that it runs exactly what it just built; the tags stop that rebuild from
  destroying the dev image as collateral, which is a different guarantee (spec § Out of Scope).
- **The `${BUILD_TARGET:-dev}` default, in either `target:` or `image:`.** Dropping the `:-dev` half
  to "make the target explicit" silently breaks every bare `docker compose` invocation in `bin/`
  (see § Approach). Nothing errors; the tag just interpolates empty.
- **`torrent` and `indexer`'s bare `:local`.** Uniformity is the wrong instinct here: REQ-5 is a
  requirement, not an oversight, and a `local-dev` on a single-stage Dockerfile would build the same
  bytes under two names.
- **`services/worker/src/ffmpeg/runner.ts` and the `builder` stage.** Both explicitly out of scope.
  `runner.ts` is named in the constitution; `builder` is intermediate and no tag points at it.
- **`docs/spec/features/001`–`049`.** Specs `014` and `015` record `BUILD_TARGET=runner` as what was
  true when they shipped. They are a record of a decision, not a description of the present (AC-11).
- **`docker-compose.yaml`'s keys.** One comment changes in that file and nothing else. AC-8 asserts
  the bare base file still resolves five GHCR images with no `build:` key and no local name.

## Migrations

**None.** No Prisma model, field, enum or migration is involved; `services/api/prisma/` is not in
territory. Reversibility is a `git revert` — the only persistent artifacts this feature creates are
local Docker images, and the worst case of a revert is orphaned `local-prod`/`local-dev` tags that
`docker image prune` reclaims.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `release.yml` left asking for `target: runner` | Loudly — the next `v*.*.*` tag fails the build for all three Node services. Not silent, but it fails **at release time**, when it is most expensive to discover | AC-9 greps the file for `target: prod` × 3 and `runner` × 0, and builds each stage the way the workflow builds it (`docker build --target prod`, no compose) |
| `release.yml` edited to a stage name that exists but is wrong (`builder`, `base`) | **Silently** — the build succeeds and GHCR receives an image with no `dist/` and no `CMD` that runs the service. An installation pulls it and crash-loops, with the defect three steps upstream of the symptom (the exact failure shape this whole feature exists to remove) | AC-9's `docker build --target prod` must exit 0 *and* NFR-4 requires the published content be unchanged; the verification pass inspects `{{.Config.Cmd}}` rather than trusting the build's exit code |
| `${BUILD_TARGET:-dev}`'s default dropped from `image:` | **Silently** — `bin/cli`, `bin/npm`, `bin/bash`, `bin/mysql`, `bin/dbinit`, `bin/dbreset` interpolate an empty tag. Compose may resolve `perceptor-api:local-` or fall back to `:latest`; `exec` keeps working (it matches on labels) so the breakage surfaces later, somewhere else | Contract Freeze names it; verification runs `bin/cli api node -v` and `bin/mysql -e 'select 1'` with no `BUILD_TARGET` set, which is the only way this shows up |
| A stale `perceptor-<svc>:local` from before this change | Harmless but confusing: it sits in `docker image ls` forever, referenced by nothing, and a reader cannot tell whether it is live | Not automated (spec § Out of Scope forbids a wrapper deleting images). The verification pass ends by naming it so the developer can `docker image rm perceptor-{web,api,worker}:local` once, knowingly |
| `bin/build web` (the old, now-invalid invocation) | Loudly — exits non-zero with a usage message, because `web` is not a target. But it is a **breaking change to a documented example**: root `CLAUDE.md:85` and `README.md` both show `bin/build web` | Both docs are in territory (step 4) and must show `bin/build prod web`. AC-14 covers the failure path; the doc update is what stops the failure from being a surprise |
| `.claude/settings.local.json`'s six `BUILD_TARGET=runner …` allowlist entries | Silently inert — they stop matching, so those commands start prompting again. Machine-local developer config, not a correctness issue | Deliberately untouched. Noted here so the prompt is recognised as expected rather than a bug |
| The doc sweep leaves a `runner` that means a stage | Silently — the next reader learns the wrong vocabulary from a stale doc, which is how this defect was seeded | AC-10 enumerates every live occurrence and splits it into must-change and must-not-change, naming file and line for both halves |

## Verification

```bash
# 1. Stage rename resolves, built the way release.yml builds it (no compose) — AC-9
docker build --target prod services/api
docker build --target prod services/web
docker build --target prod services/worker

# 2. bin/build honours its argument, and refuses anything else — AC-5, AC-14
bin/build prod api
bin/build dev api
bin/build staging api           # must exit non-zero, build nothing
bin/build                       # must exit non-zero with usage

# 3. The original bug — AC-1, AC-2, AC-3, AC-4
bin/build prod api
docker image ls | grep perceptor-api     # note the local-prod image ID
bin/dev -d
docker compose -f docker-compose.yaml -f docker-compose.build.yaml -f docker-compose.dev.yaml ps
docker compose -f docker-compose.yaml -f docker-compose.build.yaml -f docker-compose.dev.yaml logs api
docker image ls | grep perceptor-api     # local-prod still present, same ID

# 4. The bare-compose wrappers still resolve the dev name — the silent risk above
bin/cli api node -v
bin/mysql -e 'select 1'

# 5. Runtime path untouched — AC-8
docker compose -f docker-compose.yaml config

# 6. Vocabulary and history — AC-10, AC-11
grep -rn 'BUILD_TARGET=runner\|AS runner\|target: runner' . | grep -v node_modules
git status --short docs/spec/features
```

Then the manual pass:

1. **AC-2 / AC-5**: `docker image inspect --format '{{.Config.Cmd}}' perceptor-api:local-dev` prints
   the `sh -c … start:dev` form; the same on `perceptor-api:local-prod` prints
   `[node dist/src/main.js]`. Repeat for `web` (`[node server.js]`) and `worker`
   (`[node dist/index.js]`).
2. **AC-4**: read `bin/dev -d`'s own output on a warm start — no `Building` and no `Built` line for
   `web`, `api` or `worker`.
3. **AC-6**: `docker image rm perceptor-{web,api,worker}:local-dev`, then `bin/install`, then
   `bin/dev -d`. The `bin/install` run builds; the `bin/dev` run prints no `Building`, `Built` or
   `Pulling` line for the three. **Destructive** — `bin/install` offers to regenerate `.env` and
   `bin/dbreset` resets the database; answer `N` to the `.env` prompt on a working checkout, and
   expect to reseed.
4. **AC-12**: `docker tag alpine perceptor-api:local-prod`, then `bin/dev -d` — `api` comes up
   healthy, because the dev path never names that tag. Rebuild with `bin/build prod api` afterwards.
5. **AC-13**: `docker image rm perceptor-api:local-dev`, then `bin/dev -d` — it builds, prints no
   `Pulling` line for `api`, and `api` comes up healthy.
6. **AC-7**: `docker compose … images` lists `torrent` and `indexer` on bare `:local`, one image each.
7. Finally, `docker image ls | grep ':local$'` will still show the three orphaned pre-feature
   `perceptor-{web,api,worker}:local` images. Remove them by hand once; nothing in this feature does
   it for you, by design.

`docker build` and `docker image {ls,inspect,rm,tag}` are Docker CLI reads and tags, not a host
toolchain — consistent with Article I's intent, though its **Check** line names only `git` and
`docker compose` explicitly (spec § Acceptance Criteria makes the same note). No `npm`, `npx`,
`tsc`, `next`, `nest` or `prisma` is invoked anywhere in this feature, on the host or otherwise:
no service source changes, so there is nothing to typecheck or test (NFR-5).

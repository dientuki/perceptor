---
title: Local Image Tag Collision Between Build Targets — infra slice
service: infra
last_updated: 2026-09-10
status: Implemented
---

# PLAN: Local Image Tag Collision Between Build Targets — `infra` (`infra/plan.md`)

## Scope

This slice owns the whole mechanical change: the three Dockerfile stage renames, the `image:`
parameterisation in `docker-compose.build.yaml`, and the four `bin/` wrappers that set or consume
`BUILD_TARGET`. Read `../spec.md` and `../plan.md` first — `../plan.md` § *Contract Freeze* lists
five things that look wrong from inside this slice and must not be changed.

**Not yours in this feature**, even though you will see them in a grep:

- `.github/workflows/release.yml` — three `target: runner` lines that must become `prod`. It is
  `[orch]`'s, not because the edit is hard but because it is the one line in this feature that can
  publish a broken image to GHCR. If you find it still saying `runner` when your work is done, that
  is a **stop and report**, not a fix.
- `README.md`, root `CLAUDE.md`, `services/api/CLAUDE.md`, `services/worker/CLAUDE.md` — `[docs]`.
- `services/worker/src/ffmpeg/runner.ts`, the `builder` stage, anything under `services/*/src/`,
  `services/*/prisma/` or any `package.json`. NFR-5: no service source changes in this feature.
- `docs/spec/features/001`–`049`. Specs `014` and `015` contain `BUILD_TARGET=runner` and stay
  exactly as they are (AC-11).

Writes are confined to `bin/`, `services/{web,api,worker}/Dockerfile`, `docker-compose.build.yaml`,
`docker-compose.dev.yaml` and `docker-compose.yaml`. Note that `.claude/agents/infra.md`'s scope
sentence names only `docker-compose.yaml`; `../plan.md` § *Order of Work* treats that as an omission
in the brief and authorises the two overlays explicitly for this feature. `docker-compose.yaml`
itself is **one comment** (line 124, "en el runner publicado") — if you find yourself changing a key
in that file, stop: AC-8 asserts the bare base file still resolves five `ghcr.io` images with no
`build:` key and no local name.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/Dockerfile` | Modified | `FROM base AS runner` → `AS prod` (line 53) and the `# 4. RUNNER:` banner above it |
| `services/web/Dockerfile` | Modified | Same, line 33 |
| `services/worker/Dockerfile` | Modified | Same, line 32. **Line 6's `(ver src/ffmpeg/runner.ts)` is not a stage reference — leave it** |
| `docker-compose.build.yaml` | Modified | `image:` for `web`/`api`/`worker` becomes `perceptor-<svc>:local-${BUILD_TARGET:-dev}`; `torrent`/`indexer` keep bare `:local`; the header comment's `perceptor-<svc>:local` claim is corrected |
| `bin/dev` | Modified | Drop `--build`; delete the now-false header paragraph explaining why `--build` was mandatory |
| `bin/build` | Modified | First positional argument is the target (`dev`\|`prod`), service becomes the second; `BUILD_TARGET` is taken from it instead of hardcoded `runner` |
| `bin/prod` | Modified | `BUILD_TARGET=runner` → `prod`; header comment's "stage runner" → "stage prod" |
| `bin/install` | Modified | **Comment only.** Its two `BUILD_TARGET=dev` invocations (lines 119, 134) are already correct and must stay `dev` (REQ-8) |
| `docker-compose.dev.yaml` | Modified | Header comment line 4, "target `runner`" → `prod` |
| `docker-compose.yaml` | Modified | Comment line 124 only, "en el runner publicado" → "prod". **Line 228's `runner.ts` is not a stage — leave it** |

## Existing code to reuse

- **`docker-compose.build.yaml`'s own `${BUILD_TARGET:-dev}`** (the `target:` key of `web`/`api`/
  `worker`). The `image:` key interpolates the *same* variable with the *same* default. Do not
  introduce a second variable (`IMAGE_TAG`, `TAG_SUFFIX`) to carry the suffix — the variable that
  already decides the stage is the variable that must decide the name, and a second one can drift
  from the first, which is this feature's defect in a new costume.
- **`bin/build`'s argument-validation idiom** (lines 22–35): a `BUILDABLE` string and a
  `case " $BUILDABLE " in *" $1 "*)` membership test, falling through to a usage `echo` and
  `exit 1`. Reuse its exact shape for the new target check — a `TARGETS_ALLOWED="dev prod"` string
  and the same `case`. It already fails closed, which is REQ-7's no-fallback clause.
- **`bin/prod`'s and `bin/dev`'s shared preamble** (`set -e`, `cd "$(dirname "$0")/.."`, the `.env`
  existence check, `set -a; . ./.env; set +a`, the `USE_TRAEFIK`/`SERVICES` block, a
  `COMPOSE_FILES` string). Unchanged in all four wrappers. Do not refactor it into a shared
  sourced file: that is a real improvement and it is not this feature (Article X asks for less code,
  not for a new layer mid-bugfix).

## Steps

Steps 1–3 are one atomic unit: between them the stack cannot build. Do not stop or report progress
in the middle.

1. **Rename the stage in all three Dockerfiles.** `services/{api,web,worker}/Dockerfile`:
   `FROM base AS runner` → `FROM base AS prod`, and the `# 4. RUNNER: …` banner comment above it →
   `PROD`. Nothing else in any of the three changes — not the `COPY --from=builder` lines (they
   reference `builder`, not `runner`), not the `CMD`, not the users. In `services/worker/Dockerfile`
   leave line 6 alone.
2. **`bin/prod`**: `BUILD_TARGET=runner` → `BUILD_TARGET=prod` (line 22). Its header comment says
   "stage runner de cada Dockerfile" → "stage prod". Keep the `-d --build`.
3. **`bin/build`**: take the target as `$1` and the optional service as `$2`. Target is **required
   and has no default** — `bin/build` with no arguments exits non-zero with usage, rather than
   guessing which of two images the caller wanted. Shape:
   - `TARGETS_ALLOWED="dev prod"`, validated with the same `case` idiom as `BUILDABLE`.
   - `$2` validated against `BUILDABLE` exactly as `$1` is today; absent, all five services build.
   - Usage line becomes `Uso: bin/build <dev|prod> [web|api|worker|torrent|indexer]`.
   - Final line: `BUILD_TARGET="$1" docker compose $COMPOSE_FILES build $TARGETS`.
   - The header comment's "stage runner de cada Dockerfile" is now false either way — rewrite it in
     **English** (Article VI: an edited comment stops being legacy) or delete it if the usage line
     says it.
4. **`docker-compose.build.yaml`**: `image: perceptor-web:local-${BUILD_TARGET:-dev}` and the same
   for `api` and `worker`. `torrent` and `indexer` keep `perceptor-<svc>:local` verbatim (REQ-5).
   Correct the header comment, which currently asserts the tag is `perceptor-<svc>:local` — it now
   names two tags for the Node services and one for the other two, and the reason the suffix exists
   (a tag that does not record its stage is a tag two images fight over) is the one thing worth
   stating there.
5. **`bin/dev`**: remove `--build` from the final `docker compose … up` line. Delete the header
   paragraph (lines 7–12) that explains why `--build` was mandatory — it documents a bug that no
   longer exists, and under Article XI a comment you are already editing for another reason is not
   legacy you have to preserve. Anything you keep or add there is English.
6. **`bin/install`**: do not touch either `BUILD_TARGET=dev` (lines 119, 134) — they are already the
   correct target and REQ-8 depends on them. Line 119 deliberately has **no** `--build`, which is
   what lets Compose build the missing dev images once; leave that too. The only change here is the
   comment at lines 111–114 if it names a stage. (It does not today — verify rather than assume.)
7. **`docker-compose.dev.yaml`** line 4 and **`docker-compose.yaml`** line 124: `runner` → `prod` in
   the comment prose. `docker-compose.yaml` line 228 mentions `runner.ts` — leave it.

## Contract obligations

`../spec.md` § *GraphQL Contract Delta* is **None**: this feature crosses no service boundary, adds
no type, field, mutation or error, and `web`/`worker` retype nothing new. The delta is still frozen
(Article VIII) in the sense that matters here — if this slice finds itself needing a schema, a
resolver or a GraphQL change to finish, the plan is wrong and that is a stop-and-report.

What this slice owes the rest of the repository is not a schema but two invariants:

- **NFR-2/AC-8** — `docker compose -f docker-compose.yaml config` must still resolve all five own
  services to `ghcr.io/dientuki/perceptor-<svc>:${PERCEPTOR_TAG:-latest}`, with no `build:` key and
  no local image name anywhere in the output. An end-user installation downloads only that file.
- **NFR-4** — the production stage's *content* is unchanged. You are renaming a label, not editing
  instructions. If a `COPY`, `RUN`, `USER` or `CMD` line in any `prod` stage differs after your
  change, you have done more than the rename.

## Tests

**Nothing in this slice is owed a test under Article IX**, and the reason is worth stating rather
than assuming: there is no unit to test. The diff is four shell wrappers, two compose overlays and
three `FROM` lines — no function, no module, no branch in any service's source. The three services'
existing suites are untouched and prove nothing about this change either way, so do not run them as
evidence.

The failure modes here are not silent-in-code, they are silent-in-tooling, and the thing that
catches them is the acceptance pass in `../plan.md` § *Verification* — specifically the
`docker image inspect --format '{{.Config.Cmd}}'` reads, which are the only way to prove an image
came from the stage its name claims. A passing `docker build` proves a stage exists, not that it is
the right one; that distinction is the whole feature.

One case deserves naming because it is the exact shape of the original bug and produces no error
anywhere: a `bin/dev` that starts the prod image. It is covered by AC-1 (stack healthy, no
`Cannot find module` in the log) **and** AC-2 (`{{.Config.Cmd}}` is not `[node dist/src/main.js]`) —
both, deliberately. AC-1 alone can pass for the wrong reason, because a working copy with a fresh
`dist/` lets the prod `CMD` start successfully against the bind mount.

## Done when

```bash
docker build --target prod services/api
docker build --target prod services/web
docker build --target prod services/worker

bin/build prod api
bin/build dev api
bin/build staging api            # must exit non-zero with usage, and build nothing
bin/build                        # must exit non-zero with usage

bin/dev -d
docker compose -f docker-compose.yaml -f docker-compose.build.yaml -f docker-compose.dev.yaml ps
docker image inspect --format '{{.Config.Cmd}}' perceptor-api:local-dev
docker image inspect --format '{{.Config.Cmd}}' perceptor-api:local-prod

docker compose -f docker-compose.yaml config
bin/cli api node -v
```

Expected: all three `docker build` exit 0. `bin/build prod api` and `bin/build dev api` each produce
their own image, both listed by `docker image ls`. `bin/build staging api` and bare `bin/build` exit
non-zero and create nothing. After `bin/dev -d`, `ps` shows `api` healthy with `web` and `worker`
started, and **the output of `bin/dev` itself contains no `Building` or `Built` line** for the three
Node services. `{{.Config.Cmd}}` on `local-dev` is the `sh -c … start:dev` form; on `local-prod` it
is `[node dist/src/main.js]`. `docker compose -f docker-compose.yaml config` shows five `ghcr.io`
images and no `build:`. `bin/cli api node -v` prints a version — it runs bare `docker compose` with
no `BUILD_TARGET`, so it is the check that the `:-dev` default survived.

No `bin/npm`, typecheck or test run is part of this slice's done-when: no service source changes
(NFR-5), so there is nothing for them to measure.

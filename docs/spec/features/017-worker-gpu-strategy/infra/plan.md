---
title: Worker GPU Strategy — infra slice
service: infra
last_updated: 2026-08-19
status: Approved
---

# PLAN: Worker GPU Strategy — `infra` (`infra/plan.md`)

## Scope

You own everything outside the worker's source tree: which Vulkan drivers the image carries, whether
the `/dev/dri` overlay gets attached, and making `USE_GPU` visible to the container so the worker can
honour the opt-out. You also own the documentation surfaces that currently describe `USE_GPU` as an
opt-in flag.

You are **not** doing: the probe, the fallback filter chain, or anything under
`services/worker/src/`. That is the `worker` slice, running in parallel with you. You do not need to
wait for it — the two halves meet only at the variable name `USE_GPU`, whose meaning is already
frozen in `../plan.md` § Contract Freeze.

Writes are confined to `bin/`, `docker-compose.yaml`, `.env.example`,
`services/worker/Dockerfile`, the two `CLAUDE.md` files, `README.md` and this directory. Anything
under `services/*/src/` is a stop-and-report (see `.claude/agents/infra.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `docker-compose.yaml` | Modified | `USE_GPU=${USE_GPU}` added to the `worker` service's `environment:` block |
| `services/worker/Dockerfile` | Modified | `base` stage adds the Mesa AMD Vulkan driver (REQ-8); the stale comment at `:6-9` rewritten |
| `bin/dev` | Modified | The `USE_GPU` block at `:21` becomes render-node detection with an opt-out |
| `bin/prod` | Modified | Same change at `:22` |
| `bin/build` | Modified | Same change at `:34` |
| `bin/install` | Modified | The GPU question (`:60-72`) is deleted |
| `.env.example` | Modified | The `USE_GPU` comment block at `:20-27` rewritten for the new tri-state meaning |
| `docker-compose.gpu.yaml` | **Unchanged** | Listed here so nobody deletes it — see below |
| `CLAUDE.md`, `services/worker/CLAUDE.md`, `README.md` | Modified | Documentation, per `../spec.md` § Documentation to update |

## Existing code to reuse

- **The three `bin/` scripts already share one idiom** — `set -a; . ./.env; set +a`, then a
  `COMPOSE_FILES` string appended to conditionally. `bin/dev:20-23`, `bin/prod:21-24` and
  `bin/build:33-36` are the same three lines. Keep them the same three lines as each other after
  your change too; do not let one drift into a different style or a helper function that the other
  two don't use.
- **`bin/dev`'s existing `USE_TRAEFIK` block** (`:15-18`) is the in-repo precedent for a flag read
  from `.env` gating what goes into the compose invocation. Your change is the same shape with a
  filesystem test added — not a new mechanism.
- **`docker-compose.yaml`'s `worker` `environment:` block** already passes five variables
  (`ENCODE_DRIVER`, `ENCODE_SAMPLE_SECONDS`, …) in `- NAME=${NAME}` form. Add `USE_GPU` in exactly
  that form and position.

## Steps

1. **`docker-compose.yaml`** — add `- USE_GPU=${USE_GPU}` to the `worker` service's `environment:`
   list. This is the single highest-priority line in your slice: without it the worker's opt-out
   branch reads `undefined`, silently probes anyway, and AC-2 cannot pass. Do it first so the
   `worker` slice can integrate against it.
2. **`bin/dev`, `bin/prod`, `bin/build`** — replace each `USE_GPU` block with detection plus opt-out.
   The semantics, frozen in `../plan.md`:
   - Attach `-f docker-compose.gpu.yaml` when the host has a render node **and** `USE_GPU` is not
     exactly the string `false`.
   - Exactly `false` — matching the worker's parse. Not case-insensitive, not `0`, not `no`.
   - Unset means auto, so a `.env` predating this feature behaves sensibly without being edited.

   Use a plain `[ -d /dev/dri ]` test. On Docker Desktop for Windows the directory does not exist,
   which is precisely the host REQ-4 is about. Keep the existing comment convention at the top of
   each script and update those comments — all three currently describe `USE_GPU` as the flag that
   turns the GPU on.
3. **`bin/install`** — delete the GPU question at `:60-72` and its explanatory `echo` block. Do not
   replace it with a different question; the whole point of REQ-5 is that there is no longer an
   answer a human is better placed to give than the machine. Leave `USE_GPU` out of the generated
   `.env` entirely, or write it commented — either is fine, since unset means auto — but say in your
   report which you chose.
4. **`services/worker/Dockerfile`** — add the Mesa AMD Vulkan driver to the `base` stage's single
   `apk add` line. **The package name is unverified** (`mesa-vulkan-ati` is the expectation): the
   image is built `--no-cache`, so a running container has no package index to confirm against.
   Verify it against the pinned `node:24.18.0-alpine` base before committing to it. If no such
   package exists in that Alpine release, **do not substitute something that looks close** — drop
   REQ-8, report it, and note that AMD hosts will correctly take the CPU fallback.
   **Do not add `mesa-vulkan-swrast`.** A software rasterizer would pass the worker's probe and run
   `libplacebo` on the CPU at a fraction of the speed of the fallback it displaced, with no error
   anywhere (`../plan.md` § Risks, first row).
   While you are in the file, rewrite the comment at `:6-9`: it implies the apk packages are what
   enable `libplacebo`. They are not — `libplacebo` is compiled into Alpine's ffmpeg binary
   (`--enable-libplacebo`); the packages supply only the loader and the driver.
5. **`.env.example`** — rewrite the `USE_GPU` comment block. It currently reads as opt-in ("true
   mounts /dev/dri…"). It must now describe: unset/`true` = auto-detect, `false` = force the CPU
   path, and that there is no value meaning "force GPU". Keep the existing note that AV1 encoding is
   always CPU regardless — that remains true and is the most common misunderstanding.
6. **Documentation** — `README.md:58` (the feature bullet calls GPU acceleration optional via
   `USE_GPU=true`), `README.md:137` (`bin/dev` "reads `USE_TRAEFIK` and `USE_GPU`"),
   `README.md:206` (the CPU-bound-encode note), the root `CLAUDE.md` environment section, and
   `services/worker/CLAUDE.md`'s last "Known debt" bullet about the `base` stage packages.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **None** — your slice has no GraphQL surface at all.

Your contract is the environment one, and both bullets are frozen:

- **`USE_GPU` parses as exactly `false` for opt-out, everything else is auto.** The worker parses it
  the same way in `src/ffmpeg/vulkan.ts`. If you make the shell side accept `0`/`no`/`FALSE`, you
  create a state where the overlay is detached but the worker still probes and finds nothing — or
  the reverse. Neither produces an error.
- **`docker-compose.gpu.yaml` is not deleted and its contents do not change.** Folding the device
  mapping into `docker-compose.yaml` now that inclusion is automatic looks like a simplification and
  breaks every host without `/dev/dri`, which is REQ-4.

If you need a script or npm target on the worker side that does not exist, stop and report — that is
a `worker` task.

## Tests

There is no typecheck, linter or test harness for `bin/` or compose files. Per
`.claude/agents/infra.md`, **the gate is running the thing for real against the live stack** and
pasting the actual output.

Nothing in this slice can fail silently in the Article IX sense with one exception, and it is not
testable from here: if step 1 is skipped, the worker's opt-out silently never engages. That is
covered by AC-2 in the joint verification rather than by anything you can assert locally — which is
why step 1 is first and called out as the priority.

## Done when

Each script actually runs and produces the right compose invocation, confirmed by running it, not by
reading it:

```bash
bin/dev
docker compose ps
```

- `bin/dev` on this host (which **does** have `/dev/dri`) attaches the overlay; confirm with
  `docker compose config` that the `worker` service has the `/dev/dri` device and a `USE_GPU`
  environment entry.
- `bin/dev` with `USE_GPU=false` in `.env` does **not** attach the overlay, and the `worker`
  container still reaches running.
- `bin/build worker` and `bin/prod` take the same branch as `bin/dev` under both settings.
- The image rebuilds cleanly with the new package list: `bin/build worker` exits 0.

Report the real output of each. The no-render-node branch (AC-4) cannot be fully exercised on this
host — say so explicitly rather than reporting it as passed; simulating it by testing a path that
does not exist is acceptable evidence for the branch logic, but not for Docker Desktop on Windows.

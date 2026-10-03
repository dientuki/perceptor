---
title: Multi-architecture published images — infra slice
service: infra
last_updated: 2026-10-02
status: Implemented
---

# PLAN: Multi-architecture published images — `infra` (`infra/plan.md`)

## Scope

This feature is entirely yours. You make the release workflow publish `linux/arm64` beside
`linux/amd64` for all five images under one tag, you add a fourth check to the preflight block
`082` put at the top of `install.sh`, and you update the three places that state what Perceptor
publishes.

What you are **not** doing: nothing under `services/*/src`, no Dockerfile stage, no Prisma schema,
no `ci.yml`, no `docker-compose*.yaml`, and nothing in `bin/`. If a service turns out to need an
architecture-conditional branch to build on arm64, **stop and report** — NFR-1 says this feature
ends rather than introduces one. Read `../spec.md` and `../plan.md` before you start.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `.github/workflows/release.yml` | Modified | The single `build-and-push` job splits into `build` (matrix over service × platform, pushing by digest only) and `merge` (matrix over service, assembling the manifest list and applying the tags). The header comment's amd64-only claim and the operational note at the foot both get rewritten. |
| `install.sh` | Modified | The engine check at lines 20–38 captures `docker info --format '{{.Architecture}}'` instead of discarding its output, and a fourth branch refuses an unsupported architecture. |
| `README.md` | Modified | The *Install* section states the published architectures; *Troubleshooting* gains a `no matching manifest` entry beside the existing daemon one. |
| `CLAUDE.md` (root) | Modified | § *Docker-first workflow* and § *Environment* (`PERCEPTOR_TAG`) state that the published images are amd64 and arm64. |

No new file. A new file in this slice means the plan missed something — report it.

## Existing code to reuse

- `install.sh:20-38` — the preflight block `082` wrote: three `if` statements, each printing a
  message that names the fix and exiting `1`, all before `fresh_install` is computed and before
  anything is written. Your check is the fourth `if` **in this block**, same shape, same exit code.
  Do not open a second block further down and do not move the existing three.
- `install.sh:29-30`'s comment explains why a client-side check is not an engine check. The same
  reasoning applies one level further: a reachable engine is not a *compatible* engine. Extend that
  comment rather than writing a new paragraph beside it.
- `bin/_docker.sh`'s `require_docker()` — **read it to match its message style, then leave it
  alone.** NFR-7. The three checks there stay three.
- `.github/workflows/release.yml`'s `Resolve image tags` step — the SemVer prerelease detection and
  the two-tag list are correct and stay correct. They move to the `merge` job, because that is where
  tags are now applied; the logic itself does not change.
- `.github/workflows/release.yml`'s `Make package public` step — moves to `merge`, after the
  manifest exists, keeping `continue-on-error: true` and its comment.
- `.github/workflows/ci.yml` — reused unchanged through `needs: verify`. Do not add a matrix to it.

## Steps

1. **Split `build-and-push` into `build`.** Matrix over `service` and `platform`
   (`linux/amd64` → `ubuntu-latest`, `linux/arm64` → `ubuntu-24.04-arm`), keeping the existing
   `include:` that gives `web`/`api`/`worker` their `target: prod`. Keep `needs: verify` and
   `fail-fast: false` — the existing comment explaining why one failed service must not hide the
   others still holds. Remove `tags:` from the build step entirely and push by digest
   (`outputs: type=image,push-by-digest=true,name-canonical=true,push=true`).
2. **Upload each leg's digest as an artifact.** The name must carry **both** the service and the
   platform. This is the one silent failure in the feature (`../plan.md` § Risks): a name that
   collides across services tags `perceptor-web` with `api`'s digest, and the result pulls, starts
   and runs the wrong program with no error anywhere.
3. **Add the `merge` job.** Matrix over the five services, `needs: build`, downloading that
   service's digests and calling `docker buildx imagetools create` with the two tags resolved by the
   moved `Resolve image tags` step. Then the moved `Make package public` step.
4. **Rewrite the two prose blocks in `release.yml`.** The header comment currently states
   `All five build for linux/amd64 only` as a decision; it now describes two architectures and the
   build/merge split. The operational note at the foot says nothing in this repository can prevent a
   half-published tag — under this plan the common case *is* prevented, structurally, so say what is
   actually guaranteed instead of leaving a stale warning.
5. **Capture the architecture in `install.sh`.** Replace `docker info >/dev/null 2>&1` with a
   capture of `docker info --format '{{.Architecture}}'`. An empty result is the engine-not-running
   branch, printing the **existing message verbatim** — `082`'s AC-1 asserts that string and
   README's troubleshooting section quotes it.
6. **Add the unsupported-architecture branch.** Accept `x86_64` and `aarch64` — what the engine
   actually answers, never `amd64`/`arm64` (REQ-5). Anything else prints the detected value and the
   supported list, exits `1`, and writes nothing. Message in English, like the other three.
7. **Document it.** README's *Install* section (which architectures), a Troubleshooting entry for
   `no matching manifest` beside the daemon one, and the two spots in the root `CLAUDE.md`.

## Contract obligations

None. `../spec.md` § GraphQL Contract Delta is **None — this feature does not cross the service
boundary**. You expose no GraphQL surface and consume none. `web` and `worker` cannot observe this
change: everything it does happens on the host before a container exists, or in CI before an image
does.

The one contract-like obligation is the tag. `PERCEPTOR_TAG` is a single value for all five images
(`049` REQ-2), so the five manifest lists must gain arm64 in the same release or none of them do.

## Tests

**No unit tests are owed, and the reason is not "it is only shell".** Article IX asks for tests
where failure is silent, and this slice has exactly one silent failure — a digest artifact
assembled into the wrong service's manifest (step 2) — which no test in this repository can reach:
it happens inside GitHub Actions, between two jobs, against a registry. There is no harness for it
and inventing one would be a larger, worse feature than this one.

It is covered instead by two acceptance criteria that must actually be run, not reasoned about:
AC-1 (`docker manifest inspect` naming both platforms, per service) and AC-2 (every container of a
real arm64 install reaching healthy — an image carrying the wrong program cannot).

Everything else in the slice fails loudly: a broken workflow turns the run red, and a broken
preflight refuses an install on the first line.

## Done when

`install.sh` parses and the compose file it writes still validates:

```bash
bash -n install.sh
docker compose config -q
```

Then prove the preflight by running it, which is this territory's real gate — a local copy of
`install.sh`, in an empty directory, with the detected architecture substituted by hand (no
override variable ships; `082` AC-7 set the precedent of testing a dry-run copy):

```bash
DOCKER_HOST=unix:///nonexistent.sock bash install.sh
```

must still print `082`'s engine message and **not** an architecture one, exit `1`, and leave the
directory empty. The unsupported-architecture copy must print the detected value and the supported
list, exit `1`, and likewise leave the directory empty.

Paste the real output of each run in your report. The workflow itself cannot be verified from this
host — report it as written and not yet run, and say so plainly; AC-1 to AC-5 are discharged by the
release-candidate push described in `../plan.md` § Verification, not by you.

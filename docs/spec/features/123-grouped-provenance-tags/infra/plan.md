---
title: Grouped Provenance Tags — infra slice
service: infra
last_updated: 2026-11-20
status: Implemented
---

# PLAN: Grouped Provenance Tags — `infra` (`infra/plan.md`)

## Scope

`infra` makes the worker image know which Perceptor release it is (REQ-4 `VERSION`, NFR-5):

- a `PERCEPTOR_VERSION` build argument on `services/worker/Dockerfile`, exported as an environment
  variable in the runtime stages;
- `release.yml` passes the release tag into it;
- a source build leaves it at `dev`.

`infra` does **not** add a Setting or an `.env` variable for it (NFR-5 says it is not
user-editable). It does not touch the other four images, and it does not add `mkvpropedit` or
`mkvextract`: both ship in the `mkvtoolnix` package the worker image already installs
(`services/worker/Dockerfile`, "mkvtoolnix: mkvmerge for the final remux"). Verify that rather
than assume it (step 3).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/Dockerfile` | Modified | `ARG PERCEPTOR_VERSION=dev` and `ENV PERCEPTOR_VERSION=${PERCEPTOR_VERSION}`, declared where both the `dev` and `prod` stages inherit it (the `base` stage) |
| `.github/workflows/release.yml` | Modified | the build step passes `build-args: PERCEPTOR_VERSION=${{ github.ref_name }}` on the worker leg only |

## Existing code to reuse

- `release.yml`'s existing per-service conditional (`matrix.service == 'api' && … || ''`, used for
  the `107` secret): the same expression shape scopes the build arg to the worker leg. It is a
  build-arg, not a secret, because the version is public and belongs in the image history.
- `docker-compose.build.yaml` needs no change: without a build arg, the Dockerfile default `dev` is
  what a source build should carry (AC-3).

## Steps

1. Add `ARG PERCEPTOR_VERSION=dev` plus `ENV PERCEPTOR_VERSION=$PERCEPTOR_VERSION` in the worker
   Dockerfile's `base` stage, after the existing package install, so changing it does not bust
   the apk/whisper layer cache.
2. In `release.yml`, pass `PERCEPTOR_VERSION=${{ github.ref_name }}` for the worker leg of the
   build step. The workflow triggers on a tag, so `ref_name` is the tag (`v0.7.0-rc2`).
3. Verify the tools: run `bin/build dev worker`, then `docker run --rm --entrypoint sh
   perceptor-worker:local-dev -c 'command -v mkvpropedit mkvextract mkvmerge; echo $PERCEPTOR_VERSION'`.
   It must print three paths and `dev`. If either tool is missing, stop and report: the package
   list is what has to change, and that is a new decision.

## Contract obligations

None across GraphQL. The one cross-service promise is the environment variable's name and
semantics, which the worker reads (`src/version.ts`): `PERCEPTOR_VERSION`, the release tag
verbatim, `dev` on a source build.

## Tests

Nothing in this slice can fail silently in a way a unit test would catch. A wrong or missing value
shows up as `VERSION: dev` on a published image. That is caught by AC-3 on the first RC built from
this change, and by the step 3 check locally.

## Done when

```bash
bin/build dev worker
bin/build prod worker
docker run --rm --entrypoint sh perceptor-worker:local-prod -c 'command -v mkvpropedit mkvextract; echo $PERCEPTOR_VERSION'
```

Both builds succeed. The last command prints two paths and `dev`.

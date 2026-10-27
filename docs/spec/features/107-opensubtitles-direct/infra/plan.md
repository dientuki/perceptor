---
title: OpenSubtitles Direct — infra slice
service: infra
last_updated: 2026-10-26
status: Approved
---

# PLAN: OpenSubtitles Direct — `infra` (`infra/plan.md`)

## Scope

`infra` gets Perceptor's OpenSubtitles application key (spec REQ-13, NFR-6) to where `api` reads it:

- **Development:** `OPENSUBTITLES_API_KEY` from the checkout's `.env`, passed to `api` by the dev
  overlay.
- **Release:** the repository's `OPENSUBTITLES_API_KEY` GitHub Actions secret, written into the
  published `api` image as a file through a BuildKit secret mount, and nowhere else.
- **Local `prod` build:** the same build secret, fed from `.env` when the key is there. A build
  without it still succeeds.

`infra` does **not** read the key at runtime, decide availability or touch anything under
`services/api/src/`. That is `api`'s (`../api/plan.md`). It does not change `install.sh`: an end
user gets the key inside the image and is never asked for one. It does not encrypt or obfuscate the
key (spec Out of Scope).

Writes are confined to `services/api/Dockerfile`, `.github/workflows/release.yml`,
`docker-compose.dev.yaml`, `docker-compose.build.yaml`, `.env.example` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/Dockerfile` | Modified | `prod` stage: one `RUN --mount=type=secret` writing `/app/secrets/opensubtitles_api_key` (`0444`) when the secret is present |
| `.github/workflows/release.yml` | Modified | the `api` leg of `build` passes the secret to BuildKit and fails when it is empty |
| `docker-compose.dev.yaml` | Modified | `api.environment` gains `OPENSUBTITLES_API_KEY=${OPENSUBTITLES_API_KEY:-}` |
| `docker-compose.build.yaml` | Modified | `api.build.secrets` + a top-level `secrets:` entry sourced from the `OPENSUBTITLES_API_KEY` environment variable |
| `.env.example` | Modified | `OPENSUBTITLES_API_KEY=` with a comment |

`docker-compose.yaml` is deliberately **not** in this list (`../plan.md` § Contract Freeze).

## Existing code to reuse

- `.github/workflows/release.yml`'s `build` job: the `docker/build-push-action@v7` step is where
  the input goes. The matrix already distinguishes `matrix.service`, so the secret is scoped to
  `api` with an expression, not with a second step or job.
- The `083` `build` → `merge` split: `merge` needs `build`, so a failing `api` leg already stops
  every tag from moving. NFR-6's "fail instead of publishing without the key" needs no new gating,
  only a failing step.
- `TORRENT_API_KEY` (`104`) in `.env.example` and `docker-compose.yaml`: the comment style for a
  credential variable. It is not the wiring to copy, since that one is passed in the base compose
  file and this one deliberately is not.
- `docker-compose.dev.yaml`'s `api.environment` block (`NODE_ENV`): where a dev-only variable goes.

## Steps

1. **Dockerfile** (`services/api/Dockerfile`, `prod` stage, after the `COPY --from=builder` lines
   and **before** `USER nestjs`):

   ```dockerfile
   RUN --mount=type=secret,id=opensubtitles_api_key \
       mkdir -p /app/secrets && \
       if [ -s /run/secrets/opensubtitles_api_key ]; then \
         cp /run/secrets/opensubtitles_api_key /app/secrets/opensubtitles_api_key && \
         chmod 0444 /app/secrets/opensubtitles_api_key; \
       fi
   ```

   - Without `required=true`, a missing secret leaves nothing at `/run/secrets/…` and the build
     succeeds (a fork, a local build with no key).
   - The mode is `0444`, not `0400`: `docker-compose.yaml` runs `api` as `${PUID}:${PGID}`, never
     as `nestjs` (Contract Freeze).
   - No `ARG`, no `ENV`, no `echo` of the value.
   - Do not touch the `dev` stage. It bind-mounts `./services/api` over `/app` and reads the
     environment variable instead.
   - If the build rejects `--mount`, add `# syntax=docker/dockerfile:1` as the first line. BuildKit
     is already what `build-push-action` and `docker compose build` use.
2. **release.yml**, in the `build` job:
   - A step before "Build and push by digest" that runs only on the `api` leg and only in this
     repository:

     ```yaml
     - name: Require the OpenSubtitles key
       if: matrix.service == 'api' && github.repository == 'dientuki/perceptor'
       env:
         OPENSUBTITLES_API_KEY: ${{ secrets.OPENSUBTITLES_API_KEY }}
       run: |
         if [ -z "$OPENSUBTITLES_API_KEY" ]; then
           echo "::error::OPENSUBTITLES_API_KEY secret is empty; refusing to publish an api image without it"
           exit 1
         fi
     ```

   - On the build step:

     ```yaml
     secrets: ${{ matrix.service == 'api' && format('opensubtitles_api_key={0}', secrets.OPENSUBTITLES_API_KEY) || '' }}
     ```

     The other four legs get an empty input. Never echo the value, and never write it to
     `$GITHUB_ENV`, `$GITHUB_OUTPUT` or an artifact.
3. **docker-compose.dev.yaml.** Under `api.environment`, beside `NODE_ENV`:
   `- OPENSUBTITLES_API_KEY=${OPENSUBTITLES_API_KEY:-}`. The comment says dev only, and why the base
   file does not carry it.
4. **docker-compose.build.yaml.** Under `api.build`, add `secrets: [opensubtitles_api_key]`, plus a
   top-level

   ```yaml
   secrets:
     opensubtitles_api_key:
       environment: OPENSUBTITLES_API_KEY
   ```

   - **Verify** that `bin/build prod api` actually picks the value up from `.env`. Compose resolves
     an `environment:` secret from its own environment, and whether a `.env` entry counts depends
     on the Compose version.
   - If it does not, `bin/build` (and `bin/prod`, which rebuilds) exports `OPENSUBTITLES_API_KEY`
     from `.env` before calling compose. Read only that one line, never `source` the whole file.
   - With the variable absent, the build must still succeed. Confirm Compose does not refuse an
     empty environment secret. If it does, fall back to the export path and pass the secret only
     when set.
5. **.env.example.** After the other API keys:

   ```
   # OpenSubtitles application key (107). Development checkouts only: published images carry
   # Perceptor's own key, baked in at release from the repository's GitHub Actions secret, and an
   # installation never sets this. Leave empty unless the maintainer gave you the key; subtitle
   # search is simply unavailable without it.
   OPENSUBTITLES_API_KEY=
   ```

   It carries no value, ever.

## Contract obligations

Frozen in `../plan.md` § Contract Freeze, owed to `api`:

- the file path is `/app/secrets/opensubtitles_api_key`, holding the key only, mode `0444`, present
  in every image built from this repository's release workflow;
- the environment variable is `OPENSUBTITLES_API_KEY`, passed to `api` by `docker-compose.dev.yaml`
  only;
- the BuildKit secret id is `opensubtitles_api_key`, and the GitHub Actions secret name is
  `OPENSUBTITLES_API_KEY` (it already exists on `dientuki/perceptor`).

There is no GraphQL surface in this slice.

## Tests

There is no test runner for this territory. What can fail silently is checked by running it:

- **The key reaches the published image** (AC-16): after the first release candidate carrying 107,
  `docker run --rm --entrypoint sh ghcr.io/dientuki/perceptor-api:<tag> -c 'test -s
  /app/secrets/opensubtitles_api_key && stat -c %a /app/secrets/opensubtitles_api_key'` prints
  `444`.
- **It does not leak into metadata:** `docker history --no-trunc` and `docker inspect` of a local
  `bin/build prod api` with the key set do not contain it. Check with
  `grep -c "$OPENSUBTITLES_API_KEY"` read from `.env`, never with the key typed into the command.
- **A build without it succeeds** (AC-17): `.env` without the line, `bin/build prod api` exits 0,
  and the image has no `/app/secrets/opensubtitles_api_key`.
- **Only the `api` leg gets the secret:** read the workflow once more for any other `secrets:`
  input.
- **The release guard fires:** not exercised by deleting the real secret. Review the step's
  condition and leave it to AC-17's second half, if the maintainer chooses to run it.

## Done when

```bash
docker compose -f docker-compose.yaml -f docker-compose.build.yaml config >/dev/null
docker compose -f docker-compose.yaml -f docker-compose.build.yaml -f docker-compose.dev.yaml config | grep -c OPENSUBTITLES_API_KEY   # ≥ 1, value never printed elsewhere
bin/build prod api      # with the key in .env: succeeds, file present, mode 444
bin/build prod api      # without it: succeeds, no file
bin/dev -d && bin/cli api sh -c 'test -n "$OPENSUBTITLES_API_KEY"'   # dev overlay passes it
```

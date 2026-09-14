---
title: Environment Panel — infra slice
service: infra
last_updated: 2026-09-14
status: Implemented
---

# PLAN: Environment Panel — `infra` (`infra/plan.md`)

## Scope

Give the `api` container the three environment variables it needs to answer `environmentInfo` and
does not currently receive. That is the whole slice: no new service, no new port, no label change, no
`.env.example` edit.

Explicitly **not** this slice: the GraphQL query (`api`), the Settings tab (`web`), and anything about
`PUBLIC_UPLOAD_URL` — that variable already reaches `web` (`docker-compose.yaml`, the `web` service's
`environment:` block) and must **not** be added to `api`. See `../plan.md` § Contract Freeze for why a
second copy in `api` would defeat the feature.

Writes are confined to `docker-compose.yaml` and this directory. Anything under `services/` is a
stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `docker-compose.yaml` | Modified | Three entries added to the `api` service's `environment:` block |

`.env.example` is **unchanged**: `USE_TRAEFIK` (line 19), `INDEXER_PORT` (line 83) and
`QBITTORRENT_WEBUI_PORT` (line 91) are all already declared there. `docker-compose.build.yaml` and
`docker-compose.dev.yaml` are untouched — neither overrides the `api` environment block, and this
variable set must be identical in dev and prod.

## Existing code to reuse

- `docker-compose.yaml`, the `api` service's `environment:` block — already carries `DOMAIN`,
  `WEB_PORT` and `PORT=${API_PORT}` in exactly the `- NAME=${NAME}` form the three new lines follow.
  Add them beside the existing `DOMAIN`/`WEB_PORT` pair, which are there for the same reason (the CORS
  allowlist in `services/api/src/main.ts` is built from them).
- The `web` service's `environment:` block — the precedent for a variable that exists so a container
  can *report* something rather than act on it (`PUBLIC_UPLOAD_URL`, with a comment explaining who
  reads it and why the internal Docker URL will not do). Match that commenting habit: one short note
  saying these three are read by the Environment panel's query, not by any behaviour.

## Steps

1. In `docker-compose.yaml`, in the `api` service's `environment:` block, add:
   - `- USE_TRAEFIK=${USE_TRAEFIK}`
   - `- QBITTORRENT_WEBUI_PORT=${QBITTORRENT_WEBUI_PORT}`
   - `- INDEXER_PORT=${INDEXER_PORT}`
2. Add one brief note above them naming what reads them (`environmentInfo`, the Settings screen's
   Environment tab) and that they drive no behaviour — so a future reader does not go looking for the
   logic that acts on `USE_TRAEFIK` inside `api`. Nothing in `api` routes anything; Traefik does.
3. Do **not** add `API_PORT`. `PORT=${API_PORT}` is already in that block and the published mapping is
   `${API_PORT}:${API_PORT}`, so `api` reads its own published port from `PORT`. A second variable
   would be a second source for one number, and they could then disagree.

## Contract obligations

This slice owes `api` exactly three variable names, spelled as above, present in the `api` container's
environment. `api`'s slice reads them and nothing else from the environment beyond what it already
had (`DOMAIN`, `PORT`, `WEB_PORT`).

It owes `web` nothing new — `PUBLIC_UPLOAD_URL` and `DOMAIN` already reach that container.

The `## GraphQL Contract Delta` in `../spec.md` is read-only here; this slice adds no GraphQL surface.

## Tests

None owed, and the reason is worth stating rather than leaving implied: there is no test runner for
compose files, and a missing passthrough does not fail silently in a way a test could catch earlier
than the check below. It fails *visibly and immediately* — `useTraefik` reads `false` on a host whose
`.env` says `true`, which is AC-3/AC-4's manual pass. The verification is the `docker compose config`
render in § Done when: it resolves interpolation the same way a real `up` does, so a typo in a
variable name shows up as an empty value there rather than at runtime.

## Done when

```bash
docker compose config | grep -A 30 '^  api:' | grep -E 'USE_TRAEFIK|QBITTORRENT_WEBUI_PORT|INDEXER_PORT'
```

Three lines, each with the value from the local `.env` interpolated (not an empty string, not the
literal `${...}`). Then confirm nothing else moved:

```bash
git status --short
docker compose config >/dev/null
```

`git status --short` shows `docker-compose.yaml` modified and nothing under `services/`; the second
command exits 0, proving the file still parses.

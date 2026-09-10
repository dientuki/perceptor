---
title: End-User Installation with Published Images — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-09
status: Approved
---

# PLAN: End-User Installation with Published Images (`plan.md`)

## Approach

The compose files invert their current roles. Today `docker-compose.yaml` is a build recipe and
`docker-compose.dev.yaml` layers development on top of it; after this feature `docker-compose.yaml`
is the runtime — five `image:` references to GHCR and nothing that names a path inside this
repository — and a new `docker-compose.build.yaml` carries the `build:` sections that `bin/dev`,
`bin/prod`, `bin/build` and `bin/install` load. That overlay also **overrides `image:` to a local
tag** (`perceptor-<svc>:local`): without that, a developer running `bin/dev` on a checkout would see
Compose pull a published image instead of building the working copy, which is exactly the silent
divergence the dev overlay exists to prevent. `docker-compose.dev.yaml` is untouched and stacks on
top of the build overlay as it always has.

Three things that assume a checkout on disk stop assuming it. `services/torrent/Dockerfile` gains a
`COPY` of `commands/`, replacing the `./services/torrent/commands:/commands:ro` bind mount. `prisma`
moves from `devDependencies` to `dependencies` in `services/api/package.json`, so the `runner`
stage's `npm prune --omit=dev` stops stripping the migration CLI. And `schema.prisma`'s `datasource`
gains `url = env("DATABASE_URL")` while `src/prisma/prisma.service.ts` stops hardcoding
`devuser:devpassword` — the connection string comes from one variable for both the CLI and the
adapter, which is what lets an installation own a generated password (spec REQ-7) and closes the
`prisma.service.ts` item in the root `CLAUDE.md`'s Known debt.

Most of what the published `api` image needs already exists and is being **reused rather than
rebuilt**. `nest build` compiles the whole project, not just `src/` — `dist/scripts/` and
`dist/prisma/seeds/` are already produced and already copied into the `runner` stage by
`COPY --from=builder /app/dist ./dist`, so `scripts/mint-service-token.ts` and
`scripts/reset-password.ts` become operator commands (spec REQ-13) by being invoked as
`node dist/scripts/*.js` rather than by being rewritten. The seed split reuses the create-only
semantics already written into `prisma/seeds/settings.ts` and the find-then-create in
`prisma/seeds/languages.ts`: both were built to survive a re-run, which is precisely the property
REQ-11 needs from a seed that now runs on every boot. Only `prisma/seeds/movie.ts` and
`prisma/seeds/media-source.ts` — a hardcoded *Inception* row and a fake `DOWNLOADING` source — are
development fixtures, and only they move out of the boot path.

The backup of REQ-12 is a one-shot compose service rather than logic inside `api`, for a plain
reason: the `api` image has no MariaDB client, while the `mariadb` image the stack already pulls
does. A `backup` service runs `mariadb-dump` into a `./backups` bind mount, rotates to five, and
exits; `api` declares `depends_on: backup: condition: service_completed_successfully`. That
ordering is the whole mechanism — a failed dump blocks the migration instead of letting it proceed
unprotected, and it costs no new image, no new script file the user must download, and no step the
user must remember.

## Order of Work

`api` goes first. Every one of its changes is observable from a checkout with the existing `bin/`
wrappers, and the infra slice has to reference behaviour that must already be true — the boot-time
migration, the operator command paths, and the `TMDB_API_KEY` the settings seed backfills. Infra
writing a compose file against an `api` that still resets its schema would be planning against a
service that does not exist yet.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns `DATABASE_URL`, the boot-time migration and seed, and the operator entry points the compose file and installer both depend on |
| 2 | `infra` | Compose split, torrent image, release workflow and `install.sh` — all of them encode what step 1 made true |

**Parallel work is possible only after step 1's env-var surface is frozen** (see Contract Freeze).
Once `DATABASE_URL`, `TMDB_API_KEY`, `PERCEPTOR_AUTO_MIGRATE` and the two `node dist/...` command
paths are fixed, infra's compose and workflow can be written while `api` is still being tested.
The release workflow cannot be *verified* until both slices are done, because it publishes what
step 1 builds.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`, and it is empty:
this feature adds no type, field, mutation, argument or error condition. An implementer who finds
themselves editing a resolver, an entity or a DTO has left the feature.

There is a second contract here that no schema expresses, and it is the one that will actually
break if someone improvises. **These names and paths are frozen exactly as written:**

- **`DATABASE_URL`** — the single source of the connection string, read by both `schema.prisma`'s
  datasource and `prisma.service.ts`. It looks redundant from inside `api`, whose adapter has worked
  fine with a literal for a year; it is not. The CLI and the client must resolve the same database
  or a migration will be applied somewhere the app never reads.
- **`TMDB_API_KEY`** — the env var the settings seed backfills `movie_db_api_key` from when that row
  is empty, mirroring exactly what `settings.ts` already does with `INDEXER_API_KEY` and
  `tracker_api_key`. It must not become a new Settings write path, a mutation, or an installer step
  that talks to the database directly.
- **`PERCEPTOR_AUTO_MIGRATE`** — opt-out only, default on. It exists so an operator can take manual
  control, not so a caller can pick a mode.
- **`node dist/scripts/mint-service-token.js`** and **`node dist/scripts/reset-password.js`** — the
  operator commands, invoked through `docker compose exec`. The installer and the failure log both
  print these strings verbatim; renaming a script file breaks a recovery path that has no other
  entry point.
- **`PERCEPTOR_TAG`** — one variable for all five images. Per-service tags must not exist even as a
  convenience: `web` and `worker` retype the schema by hand with no codegen (Article VIII), so a
  mixed set fails at runtime with no compile error anywhere.

## Migrations

**None.** No model, field, enum or index changes, and this feature generates no migration
directory. `git status services/api/prisma/` must show a modified `schema.prisma` (the `datasource`
gaining its `url`) and **no** new migration — the one case where Article III's check is satisfied by
its absence, because the datasource block describes where the database is, not what it holds.

What this feature does change is *when* migrations run: `prisma migrate deploy` moves from a human
typing `bin/dbreset` to `api`'s own boot. Existing rows are untouched — `deploy` applies only
pending migrations and never resets. Reversibility: rolling back to a previous `PERCEPTOR_TAG` runs
older code against a newer schema, which Prisma does not undo; the `./backups` dump taken
immediately before the migration is the only path back, which is why REQ-12 is in this feature and
not a later one.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The AutoRun hook does not reach the image | qBittorrent finishes a download and calls nothing. No error in any log, in any service — the title sits in `DOWNLOADING` forever | `COPY commands/` in the torrent Dockerfile, the bind mount removed in the same change so the old path cannot mask it; AC-5 exercises a real download end to end |
| Mixed image versions | `web` or `worker` sends a field `api` does not have. No compile error — there is no codegen — just a runtime failure on one screen | One `PERCEPTOR_TAG` for all five (Contract Freeze); the release workflow publishes the five together or not at all |
| `bin/dev` pulls instead of building | A developer edits source, sees no change, and debugs published code believing it is their working copy | `docker-compose.build.yaml` overrides `image:` to `perceptor-<svc>:local`, a tag that exists in no registry |
| The seed overwrites a configured value | An update silently wipes the user's TMDB key or their `path_movies`, and the app starts failing with `401` for no visible reason | The create-only loop in `settings.ts` already defends this; a test pins it (see `api/plan.md`), and AC-9 checks it from outside |
| `MEDIA_GID` guessed wrong | The encode succeeds, the file lands in the library, and the media server cannot read it. Every log says success | The installer derives the gid from the library folder itself with `stat` rather than defaulting to 1000 |
| A dump that silently does not happen | An update migrates unprotected; nobody finds out until a migration fails months later | `service_completed_successfully` makes a failed backup block the boot rather than warn |
| An existing volume's database user | `.env` says `perceptor`, MariaDB still only knows `devuser` (NFR-4). Loud, but the message points at credentials, not at the volume | The installer detects an existing `db` volume and keeps the credentials already in use |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/build
bin/dev -d
```

`bin/dev -d` must build from source, not pull — check with `docker compose images` that the five
tags read `perceptor-<svc>:local`. Then, on a checkout, the regression pass: `bin/dbreset` still
works, `bin/install` still produces a working development stack, and `bin/npm api run token:service
--silent` still prints a token.

The manual pass is the feature. On a second machine with Docker and **no checkout**, in an empty
directory, run the installer, answer the five prompts, and walk AC-1 through AC-13 in order —
signing in, registering a title, watching a torrent reach `COMPLETED`, rebooting the host,
re-running the installer over the live installation, then bumping `PERCEPTOR_TAG` and confirming
the migration ran, the dump exists under `./backups`, and a setting the user had changed still
holds their value. AC-7 needs a deliberately broken migration baked into a throwaway tag; it is the
only criterion that cannot be reached from a released image.

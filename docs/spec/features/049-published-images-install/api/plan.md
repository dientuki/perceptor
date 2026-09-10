---
title: End-User Installation with Published Images — api slice
service: api
last_updated: 2026-09-09
status: Implemented
---

# PLAN: End-User Installation with Published Images — `api` (`api/plan.md`)

## Scope

This slice makes `api` able to install and upgrade itself. It takes its connection string from
`DATABASE_URL` instead of the literal in `prisma.service.ts`, applies pending migrations and a
production seed before it accepts a request, and splits the development fixtures out of the seed
path so a real installation never receives them. It also makes the `prisma` CLI survive the
`runner` stage's prune, so those migrations can run inside a published image.

It is **not** writing the compose files, the release workflow or the installer, and it is not
building the backup step — the dump happens in a one-shot compose service before `api` starts,
which infra owns. `api` may assume the database is reachable and already dumped by the time its
process exists. No resolver, entity, DTO or GraphQL surface is touched: the contract delta for this
feature is empty (`../spec.md`).

Writes are confined to `services/api/` and this directory. `services/api/Dockerfile` belongs to
infra — this slice needs no change to it, because moving `prisma` into `dependencies` is enough for
`npm prune --omit=dev` to leave it in place. If that turns out to be wrong, stop and report rather
than editing the Dockerfile.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/package.json` | Modified | `prisma` moves from `devDependencies` to `dependencies` so the CLI survives `npm prune --omit=dev` |
| `services/api/prisma/schema.prisma` | Modified | `datasource db` gains `url = env("DATABASE_URL")`; no model change, no migration |
| `services/api/src/prisma/prisma.service.ts` | Modified | The `PrismaMariaDb` adapter is built from `DATABASE_URL` instead of the hardcoded `devuser:devpassword` DSN |
| `services/api/src/database/seed/production-seed.ts` | New | The seed a real installation gets: languages, administrator, settings. Callable from boot and from the development seed |
| `services/api/src/database/seed/production-seed.spec.ts` | New | Pins the create-only behaviour an upgrade depends on |
| `services/api/src/bootstrap/run-migrations.ts` | New | Runs `prisma migrate deploy` as a child process; resolves on success, rejects with the operator command on failure |
| `services/api/src/bootstrap/run-migrations.spec.ts` | New | Pins that a non-zero exit rejects rather than resolving |
| `services/api/src/main.ts` | Modified | After `assertAuthEnv()` and before `NestFactory.create`, run migrations then the production seed |
| `services/api/prisma/seeds/settings.ts` | Modified | `movie_db_api_key` backfills from `TMDB_API_KEY` the way `tracker_api_key` already backfills from `INDEXER_API_KEY` |
| `services/api/prisma/seeds/index.ts` | Modified | Becomes the development seed: calls the production seed, then `seedMovies` and `seedMediaSource` |

`prisma/seeds/languages.ts`, `users.ts`, `movie.ts` and `media-source.ts` keep their contents. The
first two are called from the production seed, the last two only from the development one.

## Existing code to reuse

- `services/api/prisma/seeds/settings.ts` — already create-only, with an explicit backfill of a row
  that exists but is still empty. That is exactly the semantics REQ-11 needs from a seed that now
  runs on every boot; do not rewrite it into an `upsert`, and follow its `INDEXER_API_KEY` branch
  when adding `TMDB_API_KEY`.
- `services/api/prisma/seeds/languages.ts` — find-then-create against the unique `tag`. Already safe
  to re-run; reuse as is.
- `services/api/prisma/seeds/users.ts` — `upsert` that only ever writes `isAdmin`, so re-running
  never resets a password the user changed. Reuse as is.
- `services/api/src/auth/auth.constants.ts` — `assertAuthEnv()` is the precedent for failing boot
  loudly on missing configuration. The migration failure path must behave the same way: exit
  non-zero, never listen.
- `services/api/scripts/mint-service-token.ts` and `scripts/reset-password.ts` — **already compiled
  into `dist/scripts/` and already copied into the `runner` image**. They become the operator
  commands of REQ-13 unchanged; do not write new ones. Note that `reset-password.ts` documents that
  it needs a real TTY (`docker compose exec -it`, never `-i`).
- The relative-import convention in `prisma/seeds/*.ts` and `scripts/*.ts` — these run under bare
  `ts-node` with no `tsconfig-paths` register step, so the `@/*` alias is unavailable to them.
  `src/database/seed/production-seed.ts` is imported by that development seed, so **it and anything
  it imports must use relative imports, not `@/`**.

## Steps

1. Move `prisma` to `dependencies` in `package.json`.
2. Add `url = env("DATABASE_URL")` to the `datasource` block in `schema.prisma`. Confirm with
   `git status services/api/prisma/` that no migration directory appears.
3. Rewrite `PrismaService`'s constructor to build the adapter from `process.env.DATABASE_URL`,
   failing loudly when it is absent rather than falling back to a default.
4. Create `src/database/seed/production-seed.ts` calling `seedLanguages`, `seedUsers`,
   `seedSettings` in that order, relative imports only.
5. Reduce `prisma/seeds/index.ts` to the development seed: the production seed, then `seedMovies`
   and `seedMediaSource`.
6. Add the `TMDB_API_KEY` backfill to `seedSettings`'s `movie_db_api_key` entry.
7. Create `src/bootstrap/run-migrations.ts`: spawn the Prisma CLI with `migrate deploy`, take the
   child-process spawn as an injectable seam so the failure path is testable, and reject with a
   message naming the exact `docker compose exec` command an operator must run.
8. Wire both into `main.ts`, after `assertAuthEnv()` and before `NestFactory.create`, skipped when
   `PERCEPTOR_AUTO_MIGRATE` is `false`. A rejection logs and exits non-zero — the process must never
   reach `app.listen()`.
9. Write the two spec files.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **empty and read-only**: this slice adds no type, field,
mutation, argument or error condition, and `web` and `worker` consume `api` across exactly the same
schema before and after. If implementing this appears to require a schema change, stop and report —
that is a contract change and goes back to `spec.md` first (Article VIII).

The obligations that are real here are the env-var and command names frozen in `../plan.md`
§ Contract Freeze: `DATABASE_URL`, `TMDB_API_KEY`, `PERCEPTOR_AUTO_MIGRATE`, and the two
`node dist/scripts/*.js` paths. Infra's compose file and installer are written against those exact
strings, with no codegen and no compile-time link between the two slices.

## Tests

- `src/database/seed/production-seed.spec.ts` — defends against the seed overwriting a value the
  user configured. This is the silent one: the seed now runs on **every** boot, so a regression from
  create-only to `upsert` would wipe the user's TMDB key and their `path_movies` on every update,
  leaving an app that fails with `401` and a settings screen that looks untouched by anyone. The
  test must cover all three cases the existing loop distinguishes: an absent key is created, an
  existing key with a user's value is left alone, and an existing key that is still empty is
  backfilled.
- `src/bootstrap/run-migrations.spec.ts` — defends against `api` serving on a database whose
  migration failed. A resolve-on-any-exit bug produces no error anywhere: the health check goes
  green, `web` and `worker` start, and the failure surfaces later as unrelated query errors. The
  test drives the injected spawn seam with a non-zero exit and asserts the rejection, and with a
  zero exit and asserts it resolves.

Not tested, with reason: `PrismaService`'s constructor (a wrong `DATABASE_URL` fails loudly at
`$connect`, and Article IX asks for tests where failure is silent), `schema.prisma`'s datasource
block (declarative, and the migration either resolves the database or errors), and the `package.json`
dependency move (proven by `bin/build` producing an image that can run `migrate deploy`, which is a
verification step, not a unit).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/dbreset
```

`bin/dbreset` must still produce a development database with the *Inception* fixture present —
proof that step 5 moved the fixtures rather than losing them. Then `bin/npm api run token:service
--silent` still prints a token, and, on the image built by `bin/build api`,
`node dist/scripts/mint-service-token.js` prints one too.

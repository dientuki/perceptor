---
title: Dependency Update Cadence — api slice
service: api
last_updated: 2026-10-03
status: Approved
---

# PLAN: Dependency Update Cadence — `api` (`api/plan.md`)

## Scope

One lockfile. This slice refreshes `services/api/package-lock.json` so that `api`'s production
advisory count drops from 15 to exactly the 6 Prisma-family survivors, **without changing a single
declared version range in `services/api/package.json`** (`REQ-4`). That is the whole slice.

It is explicitly **not** doing: the allowlist that records the 6 survivors, the gate script, the
`bin/` wrapper, `.github/dependabot.yml` or anything under `.github/` — all `infra`. It is not
adding an `overrides` block (`NFR-2`, and see `../plan.md` § Contract Freeze, which names this as
the concentrated temptation of the feature). It is not touching `prisma/`, `src/`, or
`src/schema.gql`. There is no Prisma migration and no GraphQL delta.

Writes are confined to `services/api/`. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/package-lock.json` | Modified | Transitive resolutions move; `fast-uri`, `multer`, `ws` and `qs` leave their advisory ranges |
| `services/api/package.json` | **Unchanged** | Listed here because `git diff` on it must come back empty — `AC-5` |

No other file in this service is expected in the diff. A new module here means the plan missed
something: report it.

## Existing code to reuse

Nothing in `src/` is touched, so there is no pattern to follow inside the service. What matters is
the two facts about how this service is built, both of which constrain *how* the refresh is run:

- `services/api/Dockerfile:33` — `RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi`
  in the `builder` stage. The published image is built from the lockfile, so the lockfile is the
  artifact that ships. It must be regenerated inside the `node:24.18.0-alpine` base the image uses,
  not on the host (Article I).
- `services/api/src/bootstrap/run-migrations.ts` — `api` shells out to the `prisma` CLI
  (`prisma migrate deploy --config …`) before `NestFactory.create`, which is why `prisma` sits in
  `dependencies` rather than `devDependencies` and why `mysql2` and `deepmerge-ts` are in the
  production tree at all. This is the reachability fact the allowlist rests on
  (`../spec.md` § NFR-3); do not "clean up" `prisma` into `devDependencies` to make the audit
  quieter — the published image needs it and `049-published-images-install` REQ-10 depends on it.

## Steps

1. Refresh the lockfile from inside a container built on the service's own base image —
   `npm audit fix` (not `--package-lock-only`, so `node_modules` and the lockfile move together and
   the suite in step 3 runs against what the lockfile actually describes).
2. Confirm `git diff services/api/package.json` is empty. If npm widened or moved a declared range,
   revert that line by hand and re-resolve; a changed range is a `REQ-4` violation, not a detail.
3. Read the lockfile diff. The expected movement is confined to the dependency paths of the nine
   cleared advisories: `fast-uri` (under `ajv`), `multer` (under `@nestjs/platform-express`), `ws`
   (under `graphql-ws` and the legacy `subscriptions-transport-ws`), `qs` (under `express`,
   `body-parser`, `superagent`) and the parents npm counts beside them. Anything that moved under
   `@prisma/*`, `mariadb`, `ioredis`, `bullmq` or `@nestjs/core` is outside the brief — report it
   rather than committing it quietly.
4. Verify the production audit now reports exactly 6, and that they are the 6 named in
   `../spec.md` § AC-4: `deepmerge-ts`, `@prisma/config`, `prisma`, `mariadb`,
   `@prisma/adapter-mariadb`, `mysql2`. A seventh, or a different sixth, means the registry moved
   since this plan was written — stop and report, because `infra`'s allowlist is built from that
   exact list.
5. Typecheck and run the full suite.
6. Bring the stack up and confirm `api` reaches healthy, then answer one real GraphQL query. This
   step is not optional and not redundant with step 5 — see Tests below.

## Contract obligations

`../spec.md` § GraphQL Contract Delta reads **"None — this feature does not cross the service
boundary."** This slice therefore owes the other services exactly one thing: that
`services/api/src/schema.gql` does **not** appear in the diff. Nothing here changes a decorator, so
if a boot rewrites that file, something moved that this plan did not intend — stop and report
instead of committing it (`../plan.md` § Contract Freeze).

No error condition is added, so no `src/i18n/error-keys.ts` entry and no English message. `web` and
`worker` have nothing new to retype.

The delta is read-only. If it is wrong, stop and report — do not adapt it locally.

## Tests

**No new test file is owed by this slice, and the reason matters.** Article IX asks for tests where
failure is silent. This slice adds no code, so there is no new unit whose failure could be silent;
what it changes is the resolved version of four transitive packages, and the failure mode of *that*
is not a wrong result from a function — it is the existing 903 tests going red, or the service not
booting. Writing a test that asserts a lockfile version would be asserting the diff, which
`AC-4`/`AC-5` already do from outside the code.

What *is* owed is the live boot check, because it covers the one gap jest leaves:

- Most of the 903 tests mock Prisma. A transitive moving under `@prisma/*`, `mariadb` or `ioredis`
  can leave every suite green and still fail on the first real connection. Because `api` runs
  `prisma migrate deploy` and the production seed **before** `app.listen()`, that failure presents
  as a container that never turns healthy — not as a line anyone reads in a test report
  (`../plan.md` § Risks, row 5). Step 6 is the test for it, and it is a live step by necessity:
  there is no unit test for "the real adapter can reach real MariaDB".

## Done when

```bash
bin/cli api npx --no tsc --noEmit                 # 0 errors
bin/npm api test                                  # >= 903 tests / 62 suites green
bin/audit api                                     # 6 vulnerabilities, all 6 in the allowlist
git diff services/api/package.json                # empty
git status --short services/api/prisma            # empty
bin/dev -d && docker compose ps                   # api reports healthy
```

`bin/audit` is `infra`'s deliverable and may not exist when this slice runs. Until it does, the
equivalent is a production audit of `services/api` from inside a container on the service's own base
image — the count must be 6 and the packages must be the six named in step 4.

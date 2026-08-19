---
title: Reproducible Image Builds — worker slice
service: worker
last_updated: 2026-08-19
status: Implemented
---

# PLAN: Reproducible Image Builds — `worker` (`worker/plan.md`)

## Scope

Make `npm run build` produce a `dist/` fit to ship: runtime code only, no test files.

Today `services/worker/tsconfig.json` has `include: ["src"]` and no `exclude`, so `tsc` compiles the
nine `*.spec.ts` files along with everything else — verified on the current host tree, where
`services/worker/dist/scan/parse-episode.spec.js` exists. That was invisible while the `runner`
stage never compiled anything, but `../infra/plan.md` is about to add a `builder` stage that calls
this script and copies its output into the production image. Compiled tests in a runtime image
`require('vitest')`, a devDependency the runner does not install.

Explicitly **not** this slice: `services/worker/Dockerfile` (the new `builder`/`runner` stages are
`../infra/plan.md`'s, and so is the `CMD` change from `npm start` to `node dist/index.js`),
`.dockerignore`, `docker-compose*.yaml`, and anything under `services/worker/src/` — no job handler,
no ffmpeg logic and no path builder changes in this feature.

Writes are confined to `services/worker/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/tsconfig.build.json` | New | Extends `tsconfig.json`, excludes `node_modules`, `dist` and `**/*.spec.ts`. |
| `services/worker/package.json` | Modified | `"build": "tsc -p tsconfig.build.json"`. |

## Existing code to reuse

- **`services/api/tsconfig.build.json`** — the repo already solves exactly this, in exactly this
  shape: `{ "extends": "./tsconfig.json", "exclude": ["node_modules", "test", "dist", "**/*spec.ts"] }`.
  Mirror it, adjusting only for the fact that `worker` has no `test/` directory. Do not invent a
  different mechanism (no `files:` list, no second `include`, no `--exclude` flag on the command
  line).
- **`services/worker/tsconfig.json`** — stays as it is, and must keep covering the spec files.
  It is what `bin/cli worker npx --no tsc --noEmit` and the editor's TypeScript server read; moving
  the exclusion into it would quietly stop typechecking nine test files, trading one silent gap for
  another.

## Steps

1. Add `services/worker/tsconfig.build.json` extending `./tsconfig.json` with
   `"exclude": ["node_modules", "dist", "**/*.spec.ts"]`.
2. Point the `build` script at it in `package.json`. Leave `dev`, `start`, `test` and `test:watch`
   untouched — `start` is already `node dist/index.js`, which is what the production image will run
   directly.
3. Prove it: delete `services/worker/dist`, run the build through `bin/`, and confirm `dist/` has
   `index.js` and **no** `*.spec.js` anywhere.
4. Run the suite. 75 tests across 9 suites, unchanged — if the count drops, the exclusion leaked
   into `tsconfig.json` or into vitest's view of the project.

## Contract obligations

None. `../spec.md` § *GraphQL Contract Delta* is **None**; this slice does not touch
`src/api/graphql-client.ts`, the job payloads or anything else crossing to `api`.

One obligation runs the other way, and it is a build contract rather than a GraphQL one:
`../infra/plan.md`'s `builder` stage will call **`npm run build`** and copy **`/app/dist`**. Those
two names are fixed. Renaming the script or the output directory breaks a Dockerfile this slice
does not own and cannot see.

## Tests

**None owed.** This slice changes which files the compiler emits, not what any of them does. There
is no unit here whose bug produces a wrong result — the failure mode is "test code ends up in a
production image", which is caught by looking at `dist/` (step 3) and by AC-3.

The existing 9 suites are the regression net, and they must all still run: they are excluded from
the *build*, never from the *test run*. `vitest` picks them up from `src/` directly, independent of
`tsconfig.build.json`.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
rm -rf services/worker/dist && bin/npm worker run build
find services/worker/dist -name "*.spec.js"
```

0 errors; 75 tests in 9 suites; `dist/index.js` present; the `find` prints **nothing**.

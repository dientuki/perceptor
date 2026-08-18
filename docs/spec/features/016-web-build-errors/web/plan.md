---
title: Web Build Errors — web slice
service: web
last_updated: 2026-08-18
status: Approved
---

# PLAN: Web Build Errors — `web` (`web/plan.md`)

## Scope

This is the only service in the feature. It owns both slices: deleting four unreferenced pre-GraphQL
components (Slice A), and making `next build` reach and pass its "Generating static pages" stage
(Slice B).

Writes are confined to `services/web/` and this directory. There is no `api`, `worker` or `infra`
slice — and that boundary matters more than usual here, because Slice B's root cause may well turn
out to live in `docker-compose.yaml`, the Dockerfile or a `bin/` wrapper. If it does, **stop and
report**: the spec needs `infra` added to `services:` and its own plan. Do not fix it from here.

Two files are out of bounds for any reason: `services/web/src/app/layout.tsx` and
`services/web/src/app/favicon.ico`. They carry uncommitted work the user is restoring by hand.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/import/importFolderModal.tsx` | Deleted | No consumer; imports a `@/actions/jobs` that has never existed |
| `services/web/src/components/import/ImportMagnetSeasonModal.tsx` | Deleted | Same, for season-level import — the UI for it is out of scope per `../spec.md` |
| `services/web/src/components/search/SearchForm.tsx` | Deleted | No consumer; imports a nonexistent `../../icons`; superseded by `SearchInput.tsx` |
| `services/web/src/components/search/ResultsForm.tsx` | Deleted | No consumer; 5 implicit `any`; superseded by `SearchContainer.tsx` |
| `services/web/package.json` | Modified *(rung 1 only)* | `"build": "NODE_ENV=production next build"` — only if rung 1 is confirmed |
| `services/web/next.config.ts` | Modified *(rung 2 only)* | `reactCompiler: false` — only if rung 1 fails and rung 2 is confirmed |

The last two are conditional: exactly one of them should change, and only after the corresponding
rung is *measured* green. If both look necessary, something else is going on — report it.

## Existing code to reuse

Slice A is four deletions, so the relevant point is what already exists and must be **left alone**,
since it is what makes the deletions safe:

- `services/web/src/components/search/SearchContainer.tsx` + `SearchInput.tsx` — the live search UI
  that supersedes `SearchForm.tsx`/`ResultsForm.tsx`. Backs both `/movies/add` and `/shows/add`.
- `services/web/src/components/import/importFileModal.tsx` and `importMagnetModal.tsx` — the two
  import modals that **are** wired up (via `AcquisitionTarget`, see `services/web/CLAUDE.md`). They
  stay. Only the two unreferenced siblings go.
- `services/web/src/components/form/input/InputField.tsx` — the shared input whose `InputProps`
  accepts `defaultValue` and not `value`. Do **not** widen it to make the deleted files compile;
  that is the trap this slice exists to avoid, and `services/web/CLAUDE.md` documents the raw-
  `<input>` convention for controlled inputs.

## Steps

1. Delete the four files listed above. Nothing else — do not tidy neighbouring files while you are
   in there.
2. Run `bin/cli web npx --no tsc --noEmit`. Expect **0 errors**, down from 11 across 4 files. Report
   both numbers. If it is not 0, stop: something references a deleted file after all, which
   contradicts the plan's premise and needs reporting, not patching.
3. Run `bin/npm web run build`. Expect it to now fail at prerender —
   `Error occurred prerendering page "/movies/add"`, `TypeError: Cannot read properties of null
   (reading 'useState')`. Confirming this failure is the point of the step: it is Slice B's baseline.
4. **Rung 1 — `NODE_ENV`.** Test the hypothesis without changing anything yet:

   ```bash
   bin/cli web sh -c 'NODE_ENV=production npx next build'
   ```

   Rationale: `docker-compose.yaml` passes `NODE_ENV=${NODE_ENV}` (= `development`) into `web` and
   the Dockerfile's `dev` stage fixes it there too, so `next build` runs under a non-standard
   `NODE_ENV` and prints a warning saying so. Under `development`, React's development export
   conditions get resolved, which is a known route to a mismatched React instance and a null
   dispatcher — and it explains why the failure reaches Next's own `/_global-error`, which contains
   no project code. Note the Dockerfile's `builder` stage does **not** set `NODE_ENV`, so the
   production image build already gets `production` for free; only the dev container is affected.

   If green: set `"build": "NODE_ENV=production next build"` in `services/web/package.json`. That
   keeps AC-1's exact command (`bin/npm web run build`) working inside the dev container and leaves
   the `builder` stage's behaviour unchanged. Then go to step 6.
5. **Rung 2 — React Compiler.** Only if rung 1 is still red. Test `reactCompiler: false` in
   `services/web/next.config.ts` (the stack is Next 16.2.12 + Turbopack +
   `babel-plugin-react-compiler` 1.0.0). React Compiler is purely an optimization, so disabling it
   changes no behaviour — but it is a real capability loss, so if this is the rung that works, record
   it as debt in `services/web/CLAUDE.md` with the reason, rather than landing it silently.

   If neither rung works: **stop and report.** Do not reach for a suppression — REQ-7 and REQ-8 put
   every available shortcut (`force-dynamic`, `ignoreBuildErrors`, disabling prerender, deleting a
   page) out of bounds, and the ones that look most tempting are exactly the ones already tested and
   rejected during planning.
6. Re-run the full verification below and report the measured typecheck count.

## Contract obligations

**None.** `../spec.md`'s `## GraphQL Contract Delta` is *None*, and NFR-1 requires it stay that way:
do not touch `fetchGraphQL` (`src/lib/graphql-client.ts`) or any query or mutation document. Slice
B's symptom is a null React dispatcher during prerender — it is not a data-fetching problem, and a
change to a query is a sign of misdiagnosis.

## Tests

**No tests are owed in this slice**, and the reason is not "web has no runner" alone:

- `services/web` genuinely has no test file, no runner and no `test` script, and
  `services/web/CLAUDE.md` is explicit that introducing a test toolchain here is its own decision
  deserving its own spec. Do not add Vitest or Playwright as a side effect of this feature.
- More to the point under Article IX: neither slice is the silent-failure case. Slice A deletes code
  nothing imports — if that were wrong, the typecheck fails loudly at step 2. Slice B is verified by
  the build itself: it either reaches "Generating static pages" and passes, or it prints
  `Error occurred prerendering page` and exits non-zero. There is no state here that can be quietly
  wrong while looking correct.

The gate for this slice is the typecheck, the build, and AC-6's manual pass.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
```

```bash
bin/npm web run build
```

Typecheck reports **0 errors** (from 11 across 4 files). The build exits 0 and its output contains
no `Error occurred prerendering page` line.

```bash
grep -rn "ignoreBuildErrors\|@ts-ignore\|@ts-expect-error" services/web
```

```bash
grep -rn "@/actions/jobs\|@/icons" services/web/src
```

```bash
grep -rn "force-dynamic" services/web/src/app
```

```bash
grep -rn "@prisma/client" services/web/src
```

All four return nothing.

Then AC-5 (introduce a deliberate type error in `src/app/page.tsx`, confirm the build fails, revert)
and AC-6 (`bin/dev`, then `/movies`, `/movies/<id>`, `/shows`, `/shows/<id>` render as before,
including the three per-episode buttons). `bin/npm web run lint` is **not** a gate — Biome reports
~1598 pre-existing errors across the template with or without any given change.

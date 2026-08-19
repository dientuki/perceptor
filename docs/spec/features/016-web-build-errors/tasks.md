---
title: Web Build Errors — Tasks
last_updated: 2026-08-18
status: Done
---

# TASKS: Web Build Errors (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

This feature has a single service (`web`) and no GraphQL delta, so the usual "contract first,
consumers second" shape does not apply. The ordering constraint here is different and stricter:
**the second blocker cannot be observed until the first is gone**, because the typecheck fails
before `next build` ever reaches its prerender stage.

## Tasks

### Group 1 — dead code removal

- [x] **T001** `[web]` Delete the four unreferenced pre-GraphQL components:
      `src/components/import/importFolderModal.tsx`,
      `src/components/import/ImportMagnetSeasonModal.tsx`,
      `src/components/search/SearchForm.tsx`, `src/components/search/ResultsForm.tsx`.
      Deletions only — do not tidy neighbouring files, and do not widen
      `src/components/form/input/InputField.tsx` to accept `value`.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports **0 errors** (down from 11 across 4
      files — report both numbers), and `grep -rn "@/actions/jobs\|@/icons" services/web/src`
      returns nothing. If the typecheck is not 0, **stop and report**: something referenced a
      deleted file, which contradicts the plan's premise.

### Group 2 — the prerender blocker

Blocked by Group 1 in the strong sense: until T001 lands, `next build` stops at the typecheck and
the failure this group fixes is not reachable.

- [x] **T002** `[web]` Make `next build` reach and pass "Generating static pages". First capture the
      baseline (`bin/npm web run build` should now fail with
      `Error occurred prerendering page "/movies/add"`), then walk the diagnosis ladder in
      `web/plan.md` and stop at the first rung that goes green: **rung 1** `NODE_ENV`
      (verify with `bin/cli web sh -c 'NODE_ENV=production npx next build'`; if green, set
      `"build": "NODE_ENV=production next build"` in `services/web/package.json`), **rung 2**
      `reactCompiler: false` in `next.config.ts` only if rung 1 fails. `force-dynamic`,
      `ignoreBuildErrors`, disabling prerender and deleting a page are all out of bounds (REQ-7,
      REQ-8) — the tempting ones were already tested and rejected during planning. If neither rung
      works, **stop and report** to the Blocked table; do not improvise. If the cause turns out to
      live outside `services/web` (`docker-compose.yaml`, a Dockerfile, a `bin/` wrapper), that is
      also a stop-and-report: the spec needs `infra` added to `services:`. → T001
      *Done when:* `bin/npm web run build` exits 0 and its output contains no
      `Error occurred prerendering page` line (AC-1, AC-7), and
      `grep -rn "force-dynamic" services/web/src/app` returns nothing (AC-8).

- [x] **T003** `[web]` Prove the build is not silently passing: introduce a deliberate type error in
      `src/app/page.tsx`, run `bin/npm web run build`, then revert the file. → T002
      *Done when:* the build **fails** with that error present and exits 0 again after the revert,
      and `git status services/web/src/app/page.tsx` is clean (AC-5).

### Group 3 — verification and docs

- [x] **T004** `[docs] [P]` Manual acceptance pass. `bin/dev`, then sign in and open `/movies`,
      `/movies/<id>`, `/shows` and `/shows/<id>`. This is the **only** gate that catches a UI
      regression — `web` has no test suite, and a green build proves prerender works, not that the
      screens render. Not optional. → T002
      *Done when:* all four screens render as before, including the season accordion on the show
      detail page and its three per-episode buttons (buscar / importar archivo / añadir torrent)
      (AC-6).

- [x] **T005** `[docs] [P]` Update the error counts to **0 errors / 0 files** in the "Current state"
      block of the root `CLAUDE.md` and in the error table plus "Current state" section of
      `services/web/CLAUDE.md`, writing the *measured* typecheck number from T001, never the
      expected one. Record that the prerender blocker existed and how it was fixed — and, **if T002
      landed on rung 2**, record the loss of React Compiler in `services/web/CLAUDE.md` as debt with
      its reason. Note in the root `CLAUDE.md` that the Dockerfile's `builder` stage does not set
      `NODE_ENV`, which is why the image build was never affected. → T002
      *Done when:* neither `CLAUDE.md` still claims 11 errors across 4 files, and both name the four
      deleted files as gone rather than pending (NFR-3).

- [x] **T006** `[docs]` Walk the acceptance criteria in `spec.md`, tick each box, and set
      `status: Implemented` on `spec.md`, `plan.md` and `web/plan.md`. Re-run the three closing
      greps as part of the walk:
      `grep -rn "ignoreBuildErrors\|@ts-ignore\|@ts-expect-error" services/web` (AC-3),
      `grep -rn "@/actions/jobs\|@/icons" services/web/src` (AC-4), and
      `grep -rn "@prisma/client" services/web/src` (NFR-2, Constitution Article II).
      → T003, T004, T005
      *Done when:* AC-1 through AC-8 are all ticked with the evidence that ticked them, the three
      greps return nothing, and the three files read `status: Implemented`.

## Do not touch

`services/web/src/app/layout.tsx` and `services/web/src/app/favicon.ico` are out of bounds for every
task in this feature. They carry work that was already lost once and restored by hand.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Empty is the normal state. T002 is the task most likely to land here — either because the diagnosis
ladder runs out (rung 3) or because the root cause turns out to live outside `services/web`, which
needs a spec amendment adding `infra` to `services:`, not a cross-boundary fix.

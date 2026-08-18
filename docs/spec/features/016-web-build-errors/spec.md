---
title: Web Build Errors
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-18
last_updated: 2026-08-18
status: Approved
services: [web]
---

# SPEC: Web Build Errors (`spec.md`)

## Context & Goal

`bin/npm web run build` fails today with **11 TypeScript errors across 4 files**, all of them
predating the GraphQL migration and none reachable from the running UI:

| File | Errors |
| :-- | :-- |
| `services/web/src/components/import/importFolderModal.tsx` | imports `@/actions/jobs`, which does not exist; passes `value` to a component that only accepts `defaultValue` |
| `services/web/src/components/import/ImportMagnetSeasonModal.tsx` | same two |
| `services/web/src/components/search/SearchForm.tsx` | imports `../../icons`, which does not exist; implicit `any` props |
| `services/web/src/components/search/ResultsForm.tsx` | untyped destructured props (5 implicit `any`) |

`next.config.ts` does not set `typescript.ignoreBuildErrors`, so the build stops there. While that
holds there is no production image of `web` to be had, and therefore no CI either: spec
`015-reproducible-image-builds` depends on this one (its REQ-9). The count is recorded in the
"Current state" block of the root `CLAUDE.md` and in the table in `services/web/CLAUDE.md`; it has
been coming down feature by feature (12 errors across 5 files before `010-episode-acquisition`)
without ever reaching zero.

The goal is a green `bin/npm web run build` **without** lowering the compiler bar: no
`ignoreBuildErrors`, no `any` to paper over a type, no `@ts-expect-error`.

### Amendment (planning, 2026-08-18): there are two blockers, not one

The premise above — that the 11 errors are what stops the build — turned out to be **false**, and the
only way to find that out was to run the build. Deleting the 4 files takes the typecheck to **0
errors** and the build **still fails**, at a later stage the TypeScript error was hiding:

```
✓ Compiled successfully
  Finished TypeScript in 9.1s          ← 0 errors (REQ-2 / AC-2 satisfied)
  Generating static pages ...
Error occurred prerendering page "/movies/add"
TypeError: Cannot read properties of null (reading 'useState')
```

With `force-dynamic` on the two `add` pages, the build advances and fails on **`/_global-error`** — a
page Next generates, containing no project code — with `Cannot read properties of null (reading
'useContext')`. So this is not a problem with those two screens: **no client component can be
prerendered in this build**; React's dispatcher arrives `null` in the prerender worker.

Ruled out: this is not a duplicated or mismatched React (`react` and `react-dom` both 19.2.4, `next`
16.2.12, a single `react` in `node_modules`). The leading hypothesis is `NODE_ENV`: the build prints
`⚠ You are using a non-standard "NODE_ENV" value`, because `docker-compose.yaml` passes
`NODE_ENV=${NODE_ENV}` (= `development`) into `web` and the Dockerfile's `dev` stage fixes it the
same way. The `builder` stage does **not** set `NODE_ENV`, so `next build` sets `production` itself
there — the image build most likely never hits this, only `bin/npm web run build`, which runs in the
dev container.

The two blockers are independent. This spec covers both (REQ-6 through REQ-8, AC-7 and AC-8) rather
than splitting them, so that REQ-1 stays achievable and `015` is not left waiting on a spec that does
not exist.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Green build)**: `bin/npm web run build` must exit 0.
- [ ] **REQ-2 (Clean typecheck)**: `web`'s typecheck must report **0 errors** (today 11 across 4
      files).
- [ ] **REQ-3 (No suppression)**: No `typescript.ignoreBuildErrors` added to `next.config.ts`, no
      `@ts-ignore`/`@ts-expect-error`, and no explicit `any` used to silence the compiler.
- [ ] **REQ-4 (No functional regression)**: No screen that works today may change behaviour. The 4
      files are unreachable from the current UI; if any is kept, it must end up compiling and
      functionally equivalent.
- [ ] **REQ-5 (Per-file decision)**: For each of the 4 files, the implementation must explicitly
      choose between **deleting it** (if it has no consumer at all) and **fixing it** (if its
      functionality is meant to be picked up again), and record the reason. The default criterion is
      to delete what has no consumer: all four are pre-GraphQL leftovers.
- [ ] **REQ-6 (Prerender)**: `next build` must complete the "Generating static pages" stage without a
      prerender error. Today it fails on `/movies/add` and, once that one is bypassed, on Next's own
      `/_global-error` — a null React dispatcher affecting every client component, not a defect in
      one particular screen.
- [ ] **REQ-7 (Root cause, not symptom)**: The fix must address **why** the dispatcher arrives
      `null`. Adding `export const dynamic = "force-dynamic"` page by page to skip prerender is
      **not** an acceptable fix: it was tested during planning and only moves the failure to the next
      page.
- [ ] **REQ-8 (No suppression, extended)**: REQ-3's ban extends here — the prerender stage is not
      disabled, `ignoreBuildErrors` is not added, and no page is deleted to make the build pass.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Contract untouched)**: `fetchGraphQL` and every existing query/mutation stay as they
      are; this is dead-code cleanup plus a build fix, not a contract change.
- [ ] **NFR-2 (Article II)**: `grep -rn "@prisma/client" services/web/src` keeps returning nothing.
- [ ] **NFR-3 (Documentation)**: The error table in `services/web/CLAUDE.md` and the "Current state"
      block in the root `CLAUDE.md` must both move to **0 errors / 0 files**.

## GraphQL Contract Delta

**None — this feature does not cross the boundary between services.**

## Data Model Changes

**None.**

## Acceptance Criteria

- [ ] **AC-1**: `bin/npm web run build` exits 0.
- [ ] **AC-2**: `bin/cli web npx --no tsc --noEmit` reports 0 errors.
- [ ] **AC-3**: `grep -rn "ignoreBuildErrors\|@ts-ignore\|@ts-expect-error" services/web` returns
      nothing.
- [ ] **AC-4**: `grep -rn "@/actions/jobs\|@/icons" services/web/src` returns nothing.
- [ ] **AC-5 (failure path)**: Introducing a deliberate type error in
      `services/web/src/app/page.tsx` makes `bin/npm web run build` **fail** — proof the build is not
      passing because something silenced it.
- [ ] **AC-6**: `bin/dev` brings `web` up and `/movies`, `/movies/<id>`, `/shows` and `/shows/<id>`
      render as before, including the three per-episode buttons.
- [ ] **AC-7**: `bin/npm web run build` reaches "Generating static pages" and passes it: its output
      contains no `Error occurred prerendering page` line.
- [ ] **AC-8**: `grep -rn "force-dynamic" services/web/src/app` returns nothing — no page was excused
      from prerender to reach a green build.

## Out of Scope

- **Reimplementing folder import and season magnet import** with the UI they lack.
  `addMagnetToSeason` exists in `api` but has no UI (recorded in `CLAUDE.md`); building it is its own
  feature, not this cleanup.
- **Any styling change, refactor or component migration** not required to reach 0 errors.
- **Image builds** — spec `015-reproducible-image-builds`.

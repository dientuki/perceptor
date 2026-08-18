---
title: Web Build Errors — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-18
status: Approved
---

# PLAN: Web Build Errors (`plan.md`)

## Approach

Two independent blockers stand between `bin/npm web run build` and exit 0, and the second was
invisible until the first was removed. The plan treats them as two slices in one service, in that
order, because that is the only order in which the second can even be observed.

**Slice A — delete the four dead files.** A repo-wide grep for the four components returns only
their own declarations: nothing imports them. That makes REQ-5's default criterion (delete what has
no consumer) apply to all four, with no judgement call left over. Deleting beats fixing here on the
merits, not just on effort: `importFolderModal.tsx` and `ImportMagnetSeasonModal.tsx` call
`createJobFromFolderAction` / `createJobFromSeasonMagnetAction` from a `@/actions/jobs` that has
never existed in any revision, so "fixing" them means writing the server actions and the
season-import UI the spec puts out of scope; both also use `alert()`, which `services/web/CLAUDE.md`
bans outright. `SearchForm.tsx` / `ResultsForm.tsx` are the pre-GraphQL ancestors of the live
`SearchContainer.tsx` + `SearchInput.tsx` pair — keeping them would leave two ways to search, which
is precisely what a plan is supposed to prevent.

There is nothing to reuse in this slice: it is four deletions, and the code that replaced these
files already exists and is untouched.

**Slice B — make the build reach and pass prerender.** The root cause is not proven yet, so the
plan does not pretend it is. `web/plan.md` carries an ordered diagnosis ladder, and the implementer
stops at the first rung that goes green. The leading hypothesis is `NODE_ENV=development` leaking
into `next build` inside the dev container; the fallback is `reactCompiler`. What the plan *does*
settle is the shape of an acceptable fix: REQ-7 rules out `force-dynamic`, which was tested during
planning and merely moved the failure from `/movies/add` to Next's own `/_global-error`.

The alternative considered and rejected was splitting Slice B into its own spec. It would have left
016 carrying a REQ-1 it cannot satisfy, and `015-reproducible-image-builds` blocked on a spec that
does not exist.

## Order of Work

Single service, strictly sequential — there is nothing to parallelize.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `web` | Slice A. The typecheck fails before `next build` reaches prerender, so Slice B cannot be observed, let alone verified, until the four files are gone. |
| 2 | `web` | Slice B. Only now does the build get far enough to show the prerender failure and to prove it fixed. |
| 3 | `[docs]` | `CLAUDE.md` counts (NFR-3), written from the *measured* post-change typecheck, never from the expected one. |

## Contract Freeze

`spec.md`'s `## GraphQL Contract Delta` is **None**, and NFR-1 keeps it that way: this feature is
dead-code removal plus a build fix, not a contract change. Frozen as of `status: Approved`.

What an implementer will be tempted to touch and must not:

- **`fetchGraphQL` and every existing query/mutation** — Slice B's symptom is a React dispatcher
  arriving `null` during prerender. It has nothing to do with data fetching, and a "fix" that edits
  a query is a misdiagnosis, not a fix.
- **`services/web/src/app/layout.tsx` and `services/web/src/app/favicon.ico`** — out of bounds for
  this feature entirely. Both carry uncommitted work the user is restoring by hand; an agent that
  writes to either destroys it a second time.
- **The four files' behaviour** — they are deleted, not ported. Nothing in this feature reimplements
  folder import or season magnet import.

## Migrations

**None.** No Prisma schema change, no data model change, no `api` involvement.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Slice B's root cause is outside `services/web` | The ladder points at `docker-compose.yaml`, the Dockerfile or a `bin/` wrapper. The `web` agent cannot write there, and a helpful agent that does anyway breaks the per-service boundary silently | The brief makes this an explicit **stop and report**: the spec needs a second amendment adding `infra` to `services:` plus an `infra/plan.md`. Do not improvise across the boundary |
| A green build that still hides a broken screen | `next build` passing proves prerender works, not that the UI renders. No test suite exists in `web` to catch it, and nothing errors | AC-6's manual pass is the only gate here and is **not optional** — open all four screens, including the three per-episode buttons |
| Rung 2 taken silently | Turning off React Compiler makes the build green by dropping an optimization the project deliberately enabled. Nothing fails; the project just quietly gets slower | Rung 2 is only reachable if rung 1 fails, and taking it obliges a recorded entry in `services/web/CLAUDE.md` as debt |
| The documented error count is trusted instead of measured | The count has come down feature by feature (12/5 → 11/4) without ever reaching 0, so a stale number in a `CLAUDE.md` looks plausible | Re-run the typecheck and report the number before and after. The number is the proof, not the prose |
| `force-dynamic` sneaks in as a local fix | The build goes green on one page and fails on the next — or worse, goes green while every page silently opts out of prerender | REQ-7 forbids it and AC-8 greps for it |

## Verification

From the repo root, after both slices:

```bash
bin/cli web npx --no tsc --noEmit
```

```bash
bin/npm web run build
```

Expected: typecheck **0 errors** (from 11 across 4 files) — AC-2. Build exit 0 with no
`Error occurred prerendering page` line anywhere in its output — AC-1, AC-7.

Then the greps:

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

All four must return nothing — AC-3, AC-4, AC-8, and NFR-2 (Constitution, Article II).

**AC-5, the failure path.** Introduce a deliberate type error in `services/web/src/app/page.tsx`,
confirm `bin/npm web run build` **fails**, then revert it. This is what proves the build is passing
because it compiles, not because something silenced it.

**AC-6, the manual pass.** `bin/dev`, then open `/movies`, `/movies/<id>`, `/shows` and
`/shows/<id>`, and confirm each renders as before — including the season accordion and the three
per-episode buttons (buscar / importar archivo / añadir torrent) on the show detail page.

**Tests owed under Article IX: none**, and the reason is in `web/plan.md` rather than implied.

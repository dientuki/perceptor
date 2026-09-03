---
title: Global language preferences reach the encode merge — Tasks
last_updated: 2026-09-03
status: Done
---

# TASKS: Global language preferences reach the encode merge (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

This feature touches one service. There is no contract to freeze between agents and nothing to
parallelise across services — the only `[P]` pair is in the documentation group, where two prose
files are genuinely independent.

## Tasks

### Group 1 — the merge

- [x] **T001** `[api]` In `services/api/src/process-jobs/process-jobs.service.ts`, add
      `user: { select: { userPreferences: { select: { kind: true, language: { select: { tag: true, iso3: true } } } } } }`
      to the existing `select` in **both** `mergeMovieAllowedLanguages` (`userMovie.findMany`) and
      `mergeShowAllowedLanguages` (`userShow.findMany`), widen `collectAllowedLanguages`' `owners`
      parameter type accordingly, and fold each owner's `user.userPreferences` into the four `Set`s
      **inside the existing owner loop**, reusing the existing `kind` branch. No second loop, no new
      helper, no post-merge pass, no new query. The relation is `User.userPreferences` — `User.languages`
      is a different relation that type-checks and returns the wrong rows.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, `collectAllowedLanguages`
      still contains exactly one loop over `owners` and one `return` building all four arrays, and
      `git diff --stat services/api/src/schema.gql` is empty.

- [x] **T002** `[api]` Correct the two stale block comments in the same file — above the merge
      methods (≈ lines 156–168) and above `collectAllowedLanguages` (≈ lines 232–236) — both of which
      state the composition as `{original} ∪ default_languages ∪ per-title`. Correct them in place;
      do not expand them and do not add comments anywhere else (Constitution, Article XI). → T001
      *Done when:* `grep -n "per-title preference" services/api/src/process-jobs/process-jobs.service.ts`
      shows no surviving sentence that omits the owner's global preference from the union.

### Group 2 — tests

Depends on Group 1: the behaviour must exist before it is pinned. Both blocks live in the same spec
file, so this is one task rather than two racing edits.

- [x] **T003** `[api]` Extend `services/api/src/process-jobs/process-jobs.service.spec.ts`. Grow the
      existing `owner(...)` fixture builder (≈ line 123) with the global list rather than adding a
      parallel builder — every existing call site must keep working unchanged. Add cases covering:
      **AC-1** a global-only language reaching both the iso3 and the tag list of its kind, using a
      language distinct from the fixture's original (`ja`) and from every per-title value, so reading
      `User.languages` instead of `User.userPreferences` also fails it; **AC-2** a global `AUDIO`-only
      preference appearing in neither subtitle list; **AC-3** a non-owner contributing nothing;
      **AC-4** two owners plus a per-title override duplicating a global entry, each language present
      exactly once; **REQ-5** at least one case on the episode branch, since `mergeShowAllowedLanguages`
      is an independent copy of the same `select`; and **NFR-2** that `userMovie.findMany` /
      `userShow.findMany` are still called exactly once (the suite already asserts this at ≈ line 282).
      Each case must be verified to fail when the rule it covers is removed — the house
      fault-injection technique (Constitution, Article IX). → T001
      *Done when:* `bin/npm api test` reports no failures and a test count above the 336-test /
      36-suite baseline by exactly the cases added.

### Group 3 — verification

- [x] **T004** `[api]` Re-run the full checks and record the real numbers.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `bin/npm api test` reports
      no failures; the new test and suite totals are captured for T005. `git status services/api/prisma/`
      shows nothing — no schema change and no migration. → T002, T003

### Group 4 — documentation

- [x] **T005** `[docs] [P]` Update `services/api/CLAUDE.md`: § `process-jobs/` states the old merge
      formula, § `languages/` states that the per-user global level has no encode-time consumer, and
      § Current state carries stale counts. Also add `042` to the **Transcode** row's spec refs in the
      root `CLAUDE.md` pipeline table — the stage does not change status, only which languages survive
      into it. → T004
      *Done when:* neither file describes the allow-list as `{original} ∪ default_languages ∪ per-title`,
      and § Current state carries the counts measured in T004.

- [x] **T006** `[docs] [P]` Update `docs/spec/graphql-contract.md`, which restates the old composition
      twice (≈ lines 492–530), and annotate `docs/spec/features/039-per-title-language-split/spec.md`
      § Out of Scope — the entry beginning "Splitting `021-user-preferences`'s general per-user…" — as
      superseded by `042`. Append the annotation; do not rewrite `039`'s history. → T004
      *Done when:* a reader arriving at either document is told the current rule, and `039`'s entry
      points at this feature.

- [x] **T007** `[docs]` Walk the acceptance criteria in `spec.md`, tick each box, and set
      `status: Implemented` on `spec.md`, `plan.md` and `api/plan.md`. AC-1's end-to-end half and AC-7
      require a running stack and a real source file (`plan.md` § Verification, steps 1–6) — they are
      the user's manual pass, not an agent's: report them as pending confirmation rather than ticking
      them from the unit tests alone. → T005, T006
      *Done when:* every AC box is either ticked with the evidence that satisfied it, or explicitly
      listed as awaiting the manual pass.

## Acceptance criteria coverage

| AC | Covered by |
| :-- | :-- |
| AC-1 | T001 (behaviour) + T003 (unit) + T007 (manual end-to-end confirmation) |
| AC-2 | T003 |
| AC-3 | T003 |
| AC-4 | T003 |
| AC-5 | T003, T004 |
| AC-6 | T001, T004 |
| AC-7 | T007 (manual — no code changes, the criterion is that nothing changed) |

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

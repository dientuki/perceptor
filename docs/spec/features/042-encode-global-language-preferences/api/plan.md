---
title: Global language preferences reach the encode merge — api slice
service: api
last_updated: 2026-09-03
status: Implemented
---

# PLAN: Global language preferences reach the encode merge — `api` (`api/plan.md`)

## Scope

This is the whole feature. `api` extends the encode-time language merge so that every owner of a
title contributes their global `UserLanguagePreference` rows, of the matching `LanguageTrackKind`,
in addition to the per-title rows it already folds in. Nothing else changes: no Prisma model, no
migration, no GraphQL decorator, no resolver signature, no module import.

Explicitly **not** doing: any change under `services/worker/` or `services/web/`. `worker` consumes
the same four `allowed*` fields it already consumes and needs no edit — its `EncodeJobDetails` and
`EncodeInput` retypings stay byte-identical. If this slice appears to need a worker change, that is a
stop-and-report, not a fix (`.claude/agents/api.md`).

Writes are confined to `services/api/` and to this feature directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/process-jobs/process-jobs.service.ts` | Modified | `mergeMovieAllowedLanguages` / `mergeShowAllowedLanguages` selects grow the owner's global preferences; `collectAllowedLanguages` folds them in the same walk. |
| `services/api/src/process-jobs/process-jobs.service.spec.ts` | Modified | New cases for AC-1 … AC-4 in the existing language-merge blocks. |
| `services/api/CLAUDE.md` | Modified | § `process-jobs/` and § `languages/` state the old composition and that the global level has no encode-time reader. |
| `docs/spec/graphql-contract.md` | Modified | The merge formula around lines 486–535 states the same old composition, twice. |
| `docs/spec/features/039-per-title-language-split/spec.md` | Modified | Its § Out of Scope entry is annotated as superseded by `042`. |

No new file, no new module. A new file appearing in this slice means the plan missed something —
report it rather than adding one.

## Existing code to reuse

- `services/api/src/process-jobs/process-jobs.service.ts` — `collectAllowedLanguages` is the single
  walk that builds all four `Set`s (`039` REQ-5, NFR-1 here). Extend its loop body and its parameter
  type; do **not** add a second loop, a second helper, or a post-merge pass. The existing `kind`
  branch (`LanguageTrackKind.AUDIO` → audio pair, else subtitle pair) is reused verbatim for the
  global rows — one branch serving both levels, not two branches that can disagree.
- The same file's `mergeMovieAllowedLanguages` / `mergeShowAllowedLanguages` — each already issues
  exactly one `findMany`. Grow the existing `select`; do not add a query.
- `prisma/schema.prisma` — the relation to read is **`User.userPreferences`** (`UserLanguagePreference`
  back-relation). `User.languages` is a different relation and reading it type-checks. `UserMovie` and
  `UserShow` both expose `user`, so the nested select is available from the ownership row already
  being fetched.
- `services/api/src/languages/languages.service.ts` — `findPreferredTrackLanguagesFor` is the
  existing reader of this table and defines the `{ userId, kind }` narrowing this slice mirrors in
  shape. It is deliberately **not** called here (see `../plan.md` § Approach: it is per-user,
  per-kind, so it would multiply queries and drag a module import in). Do not import
  `LanguagesModule`.
- `services/api/src/process-jobs/process-jobs.service.spec.ts` — the `owner(...)` fixture builder
  (line ~123) and `languageRow(...)` (line ~65) are the established shapes for this suite. Extend
  `owner(...)` with the global list rather than writing a parallel builder; every existing call site
  must keep working unchanged, which is what proves the addition is additive.

## Steps

1. In `mergeMovieAllowedLanguages`, add to the `userMovie.findMany` `select`, beside the existing
   `languages` branch: `user: { select: { userPreferences: { select: { kind: true, language: { select: { tag: true, iso3: true } } } } } }`.
2. Do the same in `mergeShowAllowedLanguages` for `userShow.findMany`. The two stay structural twins
   — the deliberate duplication `006-media-search` established, not a candidate for extraction.
3. Widen `collectAllowedLanguages`' `owners` parameter type to carry the new branch, and fold each
   owner's `user.userPreferences` into the four `Set`s inside the **existing** owner loop, before or
   after the per-title rows (order is irrelevant to a `Set`; the union is what REQ-2 requires), using
   the same `kind` branch.
4. Update the block comments at the two merge methods (≈ lines 156–168) and above
   `collectAllowedLanguages` (≈ lines 232–236): both state the composition as
   `{original} ∪ default_languages ∪ per-title`, which this change makes false. These are legacy
   comments that Article XI leaves in place while the surrounding code is being edited — since this
   slice edits exactly that code, correcting them is in scope; do not expand them, and do not add new
   comments elsewhere.
5. Add the test cases below.
6. Correct `services/api/CLAUDE.md` (§ `process-jobs/` — the merge formula; § `languages/` — remove
   the claim that the global level has no encode-time consumer) and `docs/spec/graphql-contract.md`
   (the two passages restating the formula, ≈ lines 492–530). Re-record the test/suite counts in
   § Current state from an actual run.
7. Annotate `docs/spec/features/039-per-title-language-split/spec.md` § Out of Scope, the entry
   beginning "Splitting `021-user-preferences`'s general per-user…", as superseded by `042`. Do not
   rewrite `039`'s history — append the annotation.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **"None — this feature does not cross the service
boundary."** `EncodeJobDetails` keeps its exact shape: the four `allowed*` fields keep their names,
types (`[String!]!`), nullability and cardinality, and no argument or error condition is added.

The obligation is therefore negative and absolute: **`services/api/src/schema.gql` must not change.**
If it appears in the diff as anything other than an unchanged file, a decorator was touched that
should not have been, and this slice stops and reports (Constitution, Articles IV and VIII).

## Tests

`services/api/src/process-jobs/process-jobs.service.spec.ts` — this suite's header already states
the failure class it defends: a wrong `where`, a wrong join or a wrong code column here drops a
language the user asked for, the encode completes, `ffprobe` reports valid output, and nothing logs
an error. Every case below is owed under Article IX and must be verified to fail when the rule it
covers is removed (the house fault-injection technique):

- **AC-1** — an owner whose global list is the only source of a language: it must reach both the
  iso3 and the tag list of its kind. Removing the fold in `collectAllowedLanguages` must fail it.
  Use a language distinct from the fixture's original (`ja`) and from every per-title value, so
  reading `User.languages` instead of `User.userPreferences` fails it too.
- **AC-2** *(failure path)* — a global `AUDIO`-only preference must appear in neither subtitle list.
  Dropping the `kind` branch for the global rows must fail it.
- **AC-3** *(failure path)* — a user who owns nothing contributes nothing. Assert on the merge's
  output given an owners array that does not include them; the guarantee now rests on the join
  rather than on a filter, which is why it is tested rather than assumed.
- **AC-4** — two owners with different global lists, plus one per-title override duplicating a
  global entry: the result contains each language exactly once, and the per-title level neither
  replaces nor duplicates the global one.
- The episode branch gets at least one case, since `mergeShowAllowedLanguages` is an independent
  copy of the same `select` — a correct movie branch proves nothing about it (REQ-5).

Also assert the query count is unchanged: `userMovie.findMany` / `userShow.findMany` still called
exactly once (the suite already does this at line ~282 for the show branch), which is NFR-2 and the
thing a "just call `findPreferredTrackLanguagesFor` per owner" refactor would quietly break.

Not owed a test: the documentation edits (steps 6–7), and the two `select` literals in isolation —
they are covered through the merge's observable output, which is the only thing the worker sees.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
```

`tsc` reports 0 errors; the suite reports no failures and a test count higher than the 336/36-suite
baseline recorded on 2026-09-03 by exactly the cases added above. `git status services/api/prisma/`
shows nothing — no schema change, no migration (Constitution, Article III's check read in reverse).
`git diff --stat services/api/src/schema.gql` is empty.

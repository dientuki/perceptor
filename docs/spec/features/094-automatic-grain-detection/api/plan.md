---
title: Automatic Grain Detection — api slice
service: api
last_updated: 2026-10-17
status: Approved
---

# PLAN: Automatic Grain Detection — `api` (`api/plan.md`)

## Scope

`api` exposes one new field, `EncodeJobDetails.isShort: Boolean!`, so the worker can skip the
encode probe for a short film (`../spec.md` REQ-11, REQ-12). That is the whole slice.

`api` does **not** decide anything about grain here. It keeps resolving `grainMode` exactly as `092`
left it (`src/settings/grain-mode.ts`'s `resolveEffectiveGrainMode`), and it does not touch the
destination-folder rule `048` built — `outputRoot` keeps its own `movie.isShort &&
isShortsEnabled()` read. No schema change, no migration, no Setting, no mutation.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/process-jobs/entities/encode-job-details.entity.ts` | Modified | One `@Field() isShort: boolean`, with a `// Spec 094, REQ-12` locator |
| `services/api/src/process-jobs/process-jobs.service.ts` | Modified | `getEncodeJobDetails`: `isShort: movie.isShort` in the film arm, `isShort: false` in the episode arm |
| `services/api/src/process-jobs/process-jobs.service.spec.ts` | Modified | One new `describe` block, three cases |
| `services/api/src/schema.gql` | Regenerated | On boot — never hand-edited (Article IV) |

## Existing code to reuse

- `process-jobs.service.ts`'s film arm already reads `movie.isShort` to choose
  `path_shorts`/`path_movies` (the `// Spec 048, REQ-12; Spec 048, REQ-13` line). The new field reads
  the **same** `movie` object the query already loaded — no extra Prisma `select`, no second query.
  Confirm the `include`/`select` on `processJob.findUnique` already returns `isShort` (it must, since
  `outputRoot` depends on it).
- The film arm already sets literals for episode-only fields (`seasonNumber: null`,
  `episodeNumber: null`, `episodeTitle: null`). `isShort: false` in the episode arm is the mirror
  image of that, not a new pattern.
- `process-jobs.service.spec.ts`'s `movieProcessJob()` / `episodeProcessJob()` factories and the
  `mediaCapabilities.isShortsEnabled` mock (line 66) — the new cases build on these, matching the
  `getEncodeJobDetails — grainMode` block's layout.

## Steps

1. Add `isShort` to `EncodeJobDetails` as a non-null `Boolean` (`@Field()` infers it from the
   `boolean` type; no `nullable`), with a `// Spec 094, REQ-12` locator line above it.
2. In `getEncodeJobDetails`'s film arm, add `isShort: movie.isShort` — the **raw** column. Do not
   reuse the `movie.isShort && (await this.mediaCapabilities.isShortsEnabled())` expression that
   picks `outputSettingKey`; that one stays exactly where it is, for the destination only.
3. In the episode arm, add `isShort: false`.
4. Add the test block below.
5. Boot the dev stack so `schema.gql` regenerates; confirm its diff is exactly `isShort: Boolean!`
   on `EncodeJobDetails`.

## Contract obligations

Exactly `../spec.md` § GraphQL Contract Delta:

```graphql
type EncodeJobDetails {
  isShort: Boolean!
}
```

- Film job → `Movie.isShort` as stored, **regardless of `shorts_enabled`**.
- Episode job → `false`, always.
- No new error. A job with no film and no episode already throws before either arm returns.

The delta is read-only. If it looks wrong from here — in particular if "effective" looks more
correct than "raw" — stop and report rather than adapting it (`../plan.md` § Contract Freeze).

## Tests

- `services/api/src/process-jobs/process-jobs.service.spec.ts`, new block
  `getEncodeJobDetails — isShort`, with a header comment in the style of the `grainMode` block naming
  the silent failure: sending the effective destination value instead of the raw flag makes a short
  in a shorts-disabled installation spend minutes probing, with no error anywhere. Cases:
  1. a film with `isShort: true` and `isShortsEnabled` resolving `true` → `details.isShort === true`;
  2. a film with `isShort: true` and `isShortsEnabled` resolving **`false`** → still `true` (the case
     that defends the contract; `outputRoot` in the same response still resolves `path_movies`);
  3. an episode job → `false`.

A missing field would fail loudly (GraphQL non-null violation), so no test is owed for absence.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/comments api
git status --short services/api/prisma
git diff services/api/src/schema.gql
```

Typecheck and tests green, `bin/comments api` clean, nothing under `services/api/prisma`, and the
`schema.gql` diff is the single added field.

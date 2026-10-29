---
title: Audio Variant Detection — api slice
service: api
last_updated: 2026-10-29
status: Approved
---

# PLAN: Audio Variant Detection — `api` (`api/plan.md`)

## Scope

`api` owns two things:

- **The opt-in.** The `User.audioVariantDetection` column, its read on `UserPreferences` and its
  write through `setAudioVariantDetection`.
- **The data-driven "has variants" flag.** `Language.hasRegionalVariants`, on every `Language` the
  schema returns, and the per-job effective opt-in on `EncodeJobDetails`.

The verdict cache is **not** `api`'s: it lives in `111`'s worker-only Redis store (spec REQ-8).

`api` never transcribes, never decides a variant and never touches the encode command; that is
`worker`. The checkbox, its enablement and its copy belong to `web`. Writes are confined to
`services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` | Modified | `User.audioVariantDetection` |
| `prisma/migrations/<ts>_audio_variant_detection/` | New | The migration in `../plan.md` § Migrations |
| `src/users/users.service.ts` | Modified | `setAudioVariantDetection(userId, enabled)`, beside `setSubtitleSearch` |
| `src/preferences/entities/user-preferences.entity.ts` | Modified | `audioVariantDetection: Boolean!` with the spec's description |
| `src/preferences/preferences.service.ts` | Modified | `findForUser` reads the column; `setAudioVariantDetection` writes, then returns `findForUser` |
| `src/preferences/preferences.resolver.ts` | Modified | `setAudioVariantDetection(enabled)` mutation, same guard and principal check as `setSubtitleSearch` |
| `src/languages/entities/language.entity.ts` | Modified | `hasRegionalVariants: Boolean!` |
| `src/languages/languages.service.ts` | Modified | Both `Language` builders (the catalog map and `toLanguage`) set the flag from one set of qualifying `iso3`s |
| `src/process-jobs/entities/encode-job-details.entity.ts` | Modified | `audioVariantDetection` |
| `src/process-jobs/process-jobs.service.ts` | Modified | Effective opt-in in the two merge paths |

## Existing code to reuse

- `src/users/users.service.ts` `setSubtitleSearch` — the write shape for a user boolean. Copy it;
  do not write the column from `PreferencesService` directly.
- `src/preferences/preferences.resolver.ts` `setSubtitleSearch` — guard, `principal.type !== 'user'`
  check and `i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED)`. The new mutation has **no**
  capability gate: unlike `103`, nothing installation-wide has to be configured.
- `src/process-jobs/process-jobs.service.ts` `mergeMovieAllowedLanguages`/`mergeShowAllowedLanguages`
  — they already select every owner's `languages` and `user.languages`. Add
  `user: { select: { audioVariantDetection: true, languages: … } }` to the **same** select and decide
  REQ-4 from those rows. Do not issue a second owners query.
- `collectAllowedLanguages` — leave its return shape alone. The effective opt-in is computed beside
  it, from the same owners array, by a small private function that takes the owners and the
  qualifying `iso3` set and returns a boolean.
- `src/languages/languages.service.ts` `toLanguage` and the catalog map at the top — the two places a
  `Language` is built. A private `regionalVariantIso3s()` reads `language.findMany({ select: { tag,
  iso3 } })` and returns the set of `iso3`s with two or more rows whose `tag` contains `-`. The
  `languages` table is seed-only and small, so one read per call is fine and no cache is needed.

## Steps

1. Schema and migration: `User.audioVariantDetection Boolean @default(false)`. Generate with
   `bin/cli api npx prisma migrate dev --name audio_variant_detection`.
2. `LanguagesService.regionalVariantIso3s()`, applied to both builders. `Language.hasRegionalVariants`
   on the entity.
3. Preference read and write: the entity field, `UsersService.setAudioVariantDetection`,
   `PreferencesService.setAudioVariantDetection` and `findForUser`, and the resolver mutation.
4. `EncodeJobDetails.audioVariantDetection`: in both merge paths, an owner qualifies when
   `user.audioVariantDetection` is true **and** any of that owner's AUDIO rows (`owner.languages` ∪
   `owner.user.languages`, kind `AUDIO`) has an `iso3` in `regionalVariantIso3s()`. The job's value is
   "any owner qualifies". A title with no owners is `false`.
5. `bin/cli api npx --no tsc --noEmit`, `bin/npm api test`, and `git diff src/schema.gql` against
   `../spec.md`.

## Contract obligations

Expose exactly `../spec.md` § GraphQL Contract Delta:

- `Language.hasRegionalVariants`, `UserPreferences.audioVariantDetection`,
  `EncodeJobDetails.audioVariantDetection` and `setAudioVariantDetection`.
- The error table row by row. One row is a deliberate **non**-error:
  `setAudioVariantDetection(true)` with no variant language is accepted.

## Tests

Owed under Article IX:

- `src/process-jobs/process-jobs.service.spec.ts`:
  - **Effective opt-in.** One owner opted in with `es-419` gives `true`. Opted in with only `en`
    gives `false`. Opted out with `es-419` gives `false`. A second owner opted in with `es` makes it
    `true`. A per-title (`owner.languages`) AUDIO `es-ES` qualifies too. A SUBTITLE `es-419` does
    **not**. All of these fail silently: a wrong `true` costs 10 minutes per encode, and a wrong
    `false` leaves the feature dead with no error.
- `src/languages/languages.service.spec.ts`: `es`, `es-419` and `es-ES` all read
  `hasRegionalVariants: true`, and `en` reads `false`. If a builder misses the flag, `web` silently
  disables the checkbox for everyone.
- `src/preferences/preferences.service.spec.ts`: `findForUser` returns the stored value, and
  `setAudioVariantDetection` round-trips.

Not owed: the resolver decorators (they repeat the existing guarded mutations, and a wrong guard
fails loudly with an auth error) and the migration (`migrate status` verifies it).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
bin/comments api
git diff services/api/src/schema.gql
```

`tsc` reports nothing, every test passes, `migrate status` reports no pending migration,
`bin/comments api` is green, and the `schema.gql` diff is exactly the contract delta.

---
title: Settings Screen Tabs — api slice
service: api
last_updated: 2026-08-27
status: Implemented
---

# PLAN: Settings Screen Tabs — `api` (`api/plan.md`)

## Scope

This slice owns everything behind the boundary: the two new catalog entries and their validation,
the public `defaultUiLocale` query, the `AdminGuard` on the two settings operations, the migration
that drops `user_languages`, the removal of the per-user global language preference from the
service/resolver layer, and the change to the encode-time language merge.

It does **not** build any UI, does not touch the tab layout, and does not decide what the Compresión
tab controls — Compresión persists nothing in this feature, so `api` gains no key for it. Writes are
confined to `services/api/` and this directory; anything else is a stop-and-report
(`.claude/agents/api.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/settings/settings.catalog.ts` | Modified | Adds `ui_locale` (`kind: 'enum'`, options from `SUPPORTED_LOCALES`) and `default_languages` (new `kind: 'languages'`). Adds `'languages'` to `SettingKind`. |
| `services/api/src/settings/settings.service.ts` | Modified | Validates the `languages` kind through `LanguagesService`; normalizes and stores the list; rejects an empty value for `path`/`enum`/`int`. |
| `services/api/src/settings/settings.resolver.ts` | Modified | `@UseGuards(AdminGuard)` on `settings` and `updateSettings`, per method. New `@Public()` `defaultUiLocale` query. |
| `services/api/src/settings/settings.module.ts` | Modified | Imports `LanguagesModule`. |
| `services/api/src/settings/settings.service.spec.ts` | New | The `languages` kind's parsing and validation (Article IX — see Tests). |
| `services/api/src/settings/settings.resolver.spec.ts` | New | Asserts the guard metadata Nest resolves per method. |
| `services/api/src/settings/dto/setting.input.ts` | Modified | `@IsNotEmpty()` → `@IsString()` on `value`. |
| `services/api/src/languages/languages.service.ts` | Modified | `resolveLanguageIds` promoted to a public validator; `setPreferredLanguagesFor`/`findPreferredLanguagesFor` removed. |
| `services/api/src/languages/languages.resolver.ts` | Modified | `setPreferredLanguages` mutation removed. |
| `services/api/src/languages/languages.service.spec.ts` | Modified | Drops the cases for the two removed methods; keeps the per-title ones. |
| `services/api/src/auth/auth.resolver.ts` | Modified | `preferredLanguages` `@ResolveField` removed; `LanguagesService` injection dropped if it becomes unused. |
| `services/api/src/auth/auth.module.ts` | Modified | `LanguagesModule` import dropped if it becomes unused. |
| `services/api/src/process-jobs/process-jobs.service.ts` | Modified | `collectAllowedLanguages` unions the `default_languages` setting instead of each owner's global rows; the two `mergeXAllowedLanguages` queries drop their `user.languages` select. |
| `services/api/src/process-jobs/process-jobs.service.spec.ts` | Modified | New case for the setting-driven merge. |
| `services/api/prisma/schema.prisma` | Modified | `UserLanguage` model and `User.languages` removed. |
| `services/api/prisma/migrations/<ts>_drop_user_languages/` | New | Generated, not hand-written. |
| `services/api/prisma/seeds/settings.ts` | Modified | Two new create-only rows, both `''`. |

## Existing code to reuse

- `services/api/src/settings/settings.catalog.ts` — `media_server_client` is the worked example for
  an `enum` entry whose `options` come from a module's own constant list rather than a literal array.
  `ui_locale` is the same shape with `SUPPORTED_LOCALES` from `src/i18n/locales.ts`. **Do not add a
  locale-specific kind or a new error key.**
- `services/api/src/settings/settings.service.ts` — `updateMany` already validates every entry before
  writing any, and already stores a *normalized* value rather than the raw input (the `path` branch).
  The `languages` branch follows both rules: validate, then push the normalized comma-joined list.
- `services/api/src/languages/languages.service.ts` — `resolveLanguageIds` already rejects an unknown
  code (`error.language.unavailable`) and a duplicate (`error.language.duplicate`) before any write,
  and it is the only place that check may live. Promote it to public; do not write a second validator
  inside `settings/`.
- `services/api/src/ffprobe-logs/ffprobe-logs.resolver.ts` — the precedent for applying `AdminGuard`
  per method instead of at class level, and its `.spec.ts` for asserting that split off Nest's
  resolved metadata.
- `services/api/src/auth/decorators/public.decorator.ts` — `@Public()`, read by `JwtAuthGuard` only.
- `services/api/src/i18n/i18n-error.ts` + `error-keys.ts` — every throw goes through the factory. This
  slice introduces **no new key**: it reuses `error.setting.expected_enum`, `error.language.duplicate`,
  `error.language.unavailable`, `error.validation.setting_value_required` and
  `error.auth.admin_required`.
- `services/api/prisma/seeds/settings.ts` — the create-only loop; append, don't restructure.

## Steps

1. `SettingInput.value`: `@IsNotEmpty()` → `@IsString()`, keeping the `ERROR_KEYS`-as-message idiom.
2. `settings.catalog.ts`: add `'languages'` to `SettingKind`; add the `ui_locale` and
   `default_languages` entries.
3. `languages.service.ts`: make `resolveLanguageIds` public (name it for what callers need — it
   validates and resolves).
4. `settings.module.ts`: import `LanguagesModule`. Inject `LanguagesService` into `SettingsService`.
5. `settings.service.ts`: in `updateMany`, add the `languages` branch (split on `,`, trim, drop empty
   segments, reject unknown/duplicate via the validator, store the normalized join) and the
   empty-value rejection for `path`/`enum`/`int`.
6. `settings.resolver.ts`: `@UseGuards(AdminGuard)` on `settings` and on `updateSettings`,
   **per method**. Add `defaultUiLocale`, `@Public()`, returning the stored `ui_locale` when it is a
   supported locale and `null` otherwise (unset, empty, or a value that is no longer supported).
7. `prisma/schema.prisma`: remove the `UserLanguage` model and `User.languages`. Generate the
   migration with `bin/npm api run prisma:migrate`.
8. `prisma/seeds/settings.ts`: append the two rows.
9. `languages.service.ts` / `languages.resolver.ts`: remove `setPreferredLanguagesFor`,
   `findPreferredLanguagesFor` and the `setPreferredLanguages` mutation.
10. `auth.resolver.ts`: remove the `preferredLanguages` field resolver; clean up the now-unused
    injection and module import if nothing else in that file uses them.
11. `process-jobs.service.ts`: read `default_languages` through the injected `SettingsService`,
    resolve its `iso2` codes to `iso3`, and union that in `collectAllowedLanguages` in place of
    `owner.user.languages`. Drop `user: { select: { languages: … } }` from both owner queries.
12. Update the specs listed in the Files table.

## Contract obligations

Read `../spec.md` § GraphQL Contract Delta. It is read-only. In summary, this slice must produce
exactly:

- `Query.defaultUiLocale: String` — nullable, `@Public()`.
- `Query.settings` and `Mutation.updateSettings` — unchanged shapes, both admin-only.
- `Mutation.setPreferredLanguages` and `User.preferredLanguages` — **gone** from `schema.gql`.
- `Movie.preferredLanguages`, `Show.preferredLanguages`, `setMoviePreferredLanguages` and
  `setShowPreferredLanguages` — untouched. These are the per-title level and removing them by
  matching the name rather than the meaning breaks the film and series detail pages.

Confirm the regenerated `src/schema.gql` diff matches that and nothing else (Article IV: the file is
regenerated, never authored).

## Tests

- `settings.service.spec.ts` (**new**) — defends against a `default_languages` value that parses to
  something the encode merge later reads as a language that does not exist. A trailing comma, a
  double comma or a stray space produces an empty code; storing it means a track is dropped at encode
  time with no error in any log. Covers: whitespace trimmed, empty segments dropped, unknown code
  rejected before any write, duplicate rejected before any write, `""` accepted as the empty list,
  and the stored value normalized rather than echoed.
- `settings.resolver.spec.ts` (**new**) — defends against `AdminGuard` reaching `defaultUiLocale`.
  Nothing at runtime surfaces a guard applied at the wrong level until an anonymous request hits it,
  and anonymous requests come from users who are not signed in and cannot report a stack trace.
  Asserts, off the metadata Nest resolves: `AdminGuard` on `settings` and `updateSettings`, **not**
  on `defaultUiLocale`, and `@Public()` on `defaultUiLocale` only.
- `process-jobs.service.spec.ts` (**modified**) — the file already mocks `SettingsService`. New case:
  with `default_languages` set and an owner holding a per-title preference, `allowedLanguagesIso3`
  contains the original language first, then both, deduplicated. This is the plan's headline silent
  failure — a forgotten read narrows every future encode with no error.
- `languages.service.spec.ts` (**modified**) — remove the cases for the two deleted methods. The
  per-title cases stay; they cover a level this feature does not touch.
- **Not owed a test**: the catalog entries themselves (a `Record` literal — a mistake there fails the
  next `updateSettings` call loudly), the seed rows (create-only, and `bin/mysql` proves them in
  AC-3), and the migration (Prisma generates it; `show tables` proves it in AC-7).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
bin/npm api run prisma:migrate
bin/mysql -e 'show tables like "user_languages"'
```

`tsc` clean, the suite green with the new cases, the migration applied, and the `show tables` query
returning nothing.

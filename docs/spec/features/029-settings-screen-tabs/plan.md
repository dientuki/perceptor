---
title: Settings Screen Tabs — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-27
status: Approved
---

# PLAN: Settings Screen Tabs (`plan.md`)

## Approach

This feature is mostly a re-cut of code that already exists, plus two rows in `Setting` and one
deletion. Almost nothing here is new machinery, and the plan's main job is to say which existing
seam each piece hangs off.

**On `api`**, both new keys go through the machinery `settings.catalog.ts` already has.
`ui_locale` is an ordinary `kind: 'enum'` entry whose `options` come from
`src/i18n/locales.ts`'s `SUPPORTED_LOCALES` — exactly the pattern `media_server_client` already uses
with `MEDIA_SERVER_IDS`, so validation, the error key (`error.setting.expected_enum`) and the message
are all inherited rather than written. `default_languages` is the one genuinely new `SettingKind`,
`'languages'`, because nothing in the catalog validates a list against a database table; it delegates
to `LanguagesService`, which already owns that check (`resolveLanguageIds` — today private, promoted
to a public validator) and already owns the two error keys it throws. `SettingsModule` gains an
import of `LanguagesModule`; `LanguagesModule` imports nothing, so there is no cycle.

The deletion is the `user_languages` level. `ProcessJobsService.collectAllowedLanguages` stops
unioning `owner.user.languages` and unions the `default_languages` setting instead — it already
injects `SettingsService` for `resolveOutputRoot`, so this adds a read, not a dependency. With that
gone, `LanguagesService.setPreferredLanguagesFor`/`findPreferredLanguagesFor`, the
`setPreferredLanguages` mutation and `AuthResolver`'s `preferredLanguages` field resolver have no
callers and go with it.

**`AdminGuard` is applied per method, never at class level.** `UsersResolver` lifts it to the class,
and copying that here would be a live bug: `defaultUiLocale` must answer an unauthenticated request
(it is read while rendering `/login`), and a class-level `AdminGuard` runs even on a method carrying
`@Public()` — `@Public()` is read by `JwtAuthGuard` only. It would reach for `req.user` on a request
that has none. `services/api/src/ffprobe-logs/ffprobe-logs.resolver.ts` is the precedent for the
split-by-method form and for testing it off Nest's resolved metadata.

**On `web`**, the tab strip is a new presentational component and everything inside it is existing
components moved. The one structural rule is that **all six panels stay mounted**, hidden with
`className="hidden"` rather than conditionally rendered — that is what makes REQ-3's "including tabs
the user never opened" true with no state plumbing at all, since `FormData` reads the DOM. The
alternative, lifting every field's value into a controller component, was rejected: it would rewrite
`PathPicker` and `MediaServerFields` for no behavioural gain and would silently change
`MediaServerFields`'s deliberate "unmounted fields keep their stored value" behaviour.

`Checkbox`, `Radio` and `MultiSelect` are all controlled components that render no `name`d input a
form can read. Each therefore needs the **hidden-input idiom `PathPicker` already uses** — local
`useState` for the visible control, one `<input type="hidden" name={key} value={…}>` beside it. That
is the reuse this slice must not reinvent; a second convention for getting a controlled value into
`FormData` is the kind of thing this plan exists to prevent.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration, the two catalog entries and the removal of `setPreferredLanguages`. `web` cannot save a key the catalog rejects, and cannot stop calling a mutation that still exists in its own action file without the schema agreeing. |
| 2 | `web` | Consumes the frozen shape: reads `defaultUiLocale`, posts the two new keys, deletes the card that called the removed mutation. |
| 3 | `docs` | `docs/spec/graphql-contract.md` records the removal and the new public query. Orchestrator task, after both slices land. |

**Nothing runs in parallel across services here.** The `web` slice deletes a call to a mutation the
`api` slice deletes; running them at once means one of the two is briefly the only definition of the
truth. Within `api`, the migration and the catalog work are sequential (the migration drops the table
whose service methods the same slice removes); within `web`, the tab component and the panel contents
can genuinely be built in either order once `api` is done.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Three things an
implementer will be tempted to change and must not:

- **`defaultUiLocale` is nullable and `@Public()`.** From inside `api` it looks like it should be
  non-null with an `en` default, and like it should sit behind the same guard as the rest of the
  module. It cannot: `web` calls it while rendering `/login`, before it knows who is asking, and
  `null` is how "no installation default configured" is distinguished from "configured as `en`".
  Making it non-null moves the fallback decision into `api`, which by
  `services/api/CLAUDE.md` never resolves a locale.
- **`ui_locale` is validated as an `enum`, not with a new locale-specific kind or error key.** The
  message the user sees is the existing `error.setting.expected_enum` copy. `error.user.unsupported_locale`
  exists and is **not** the right one — it belongs to `setUiLocale`, a different operation with a
  different subject.
- **`updateSettings` keeps its exact signature.** It is tempting to give the screen its own mutation
  now that it saves six tabs at once. It does not need one: every value on the screen is an
  installation-wide setting, so one `entries: [SettingInput!]!` call already covers it, and
  `updateMany`'s validate-everything-before-writing-anything loop is what NFR-2 depends on.

`SettingInput.value`'s `@IsNotEmpty()` → `@IsString()` relaxation is **part of the frozen delta**
(it is written into `spec.md`), not an implementer's judgement call. The emptiness rule moves into
the catalog per kind; it does not disappear.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief both slices.
Never patch it from inside one of them (Constitution, Article VIII).

## Migrations

1. `drop_user_languages` — drops the `user_languages` table and removes the `languages
   UserLanguage[]` relation from `User` in `schema.prisma`. Generated through
   `bin/npm api run prisma:migrate`, never hand-written SQL against a running database
   (Constitution, Article III).
2. Backfill: **none**, by decision (`spec.md` NFR-1). The project is in development and the database
   is disposable; whatever any user had as a global download-language preference is discarded with
   the table. Nothing reads those rows before they go.
3. The two `Setting` rows are **seed data, not a migration** — `prisma/seeds/settings.ts` gains
   `{ key: 'ui_locale', value: '' }` and `{ key: 'default_languages', value: '' }`. That file's loop
   is deliberately create-only (it backfills a row that exists but is empty and never overwrites a
   configured one), so adding two entries is safe to re-run and safe on an existing database.

Reversibility: the migration is not reversible in the useful sense — rolling it back recreates an
empty table, not the preferences it held. Given NFR-1 that is acceptable and is the reason the
decision was taken explicitly rather than assumed. `bin/dbreset` is the recovery path in development.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `AdminGuard` lifted to class level on `SettingsResolver` | `defaultUiLocale` throws on every anonymous request — `/login` stops rendering for logged-out users, which is exactly the population that cannot report it. Worse, it looks fine to anyone already signed in. | Per-method guards, and a resolver spec asserting the metadata Nest actually resolves for each of the three methods (the `ffprobe-logs.resolver.spec.ts` pattern, which exists for this same reason). |
| A tab panel conditionally rendered instead of hidden | Every setting on a tab the user never opened is absent from `FormData`. `updateSettingsAction` filters absent keys, so the save **succeeds** and silently persists only the tabs that were visited. No error anywhere; the user sees "Settings saved." | REQ-3 states it; AC-2 exercises it by changing values on two different tabs in one save. The panels are hidden with a class, never unmounted. |
| `default_languages` parsed loosely | `"es, en"` or a trailing comma yields an empty-string code. `resolveLanguageIds` throws `error.language.unavailable` for `""` — noisy, so that one surfaces. The silent variant is the reverse: accepting and storing a value the encode merge later reads as a language that does not exist, so a track is dropped with no error. | One parse helper on the `api` side, tested for the empty/whitespace/trailing-comma cases; the value is stored normalized, the same way `updateMany` already stores a normalized path rather than the raw input. |
| The encode merge silently narrows | `collectAllowedLanguages` stops reading `owner.user.languages`. If the `default_languages` read is forgotten or misspelled, the merge falls back to "original language only" — the encode succeeds, the file is smaller, and nobody sees an error until someone looks for a missing audio track weeks later. This is the archetypal Article IX failure in this feature. | `process-jobs.service.spec.ts` already exists and mocks `SettingsService`; it gains a case asserting the setting's codes appear in `allowedLanguagesIso3` (AC-8). |
| `web` keeps a stale hand-written type | `getCurrentUser` still selects `preferredLanguages` after `api` removed the field. Every `me` call then fails GraphQL validation — the whole dashboard 500s, so this one is loud, not silent. | `grep -rn "preferredLanguages" services/web/src` is a step in the `web` slice; only the `User`-level occurrences go, the `Movie`/`Show` ones stay. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
bin/npm api run prisma:migrate
bin/npm web run lint
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
bin/mysql -e 'show tables like "user_languages"'
bin/mysql -e "select \`key\`, value from settings where \`key\` in ('ui_locale','default_languages')"
```

Then the manual pass, signed in as the seeded admin:

1. Open `/settings`. Six tabs with underline + icon, **General** active. Click through all six.
2. Change the app language on General, the movies folder on Media Manager, and the languages on
   Descarga. Move a radio on Compresión. Press Save once — one success message.
3. Reload. The language, the folder and the languages persisted; the Compresión radio is back at its
   default (REQ-9).
4. Set the movies folder to `../etc`, press Save. The media-roots error appears, the tab does not
   change, and the `bin/mysql` query above still shows the **previous** `default_languages` (AC-4).
5. Log out. `/login` renders in the language set on General, regardless of the browser's
   `Accept-Language` (AC-6).
6. Sign in as a non-admin (create one from `/users` first): `/settings` is absent from the sidebar
   and navigating to it directly gives a 404 (AC-9).

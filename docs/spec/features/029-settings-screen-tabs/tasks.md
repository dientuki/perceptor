---
title: Settings Screen Tabs — Tasks
last_updated: 2026-08-27
status: Done
---

# TASKS: Settings Screen Tabs (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[worker]` or `[infra]` tasks: the language merge lives entirely in `api`, and nothing about the
stack's boot or wiring changes.

## Tasks

### Group 1 — the two new settings and their validation

Additive only. Nothing in this group removes anything, so `tsc` stays clean at every step.

- [x] **T001** `[api]` Relax `SettingInput.value` in
      `services/api/src/settings/dto/setting.input.ts` from `@IsNotEmpty()` to `@IsString()`,
      keeping the `ERROR_KEYS`-as-`message` idiom. The empty string must reach `updateMany`.
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean and an `updateSettings` call with
      `value: ""` reaches the service instead of being refused by the pipe.
- [x] **T002** `[api] [P]` Add `'languages'` to `SettingKind` and the two entries to
      `SETTINGS_CATALOG` in `services/api/src/settings/settings.catalog.ts`: `ui_locale` as
      `{ kind: 'enum', options: SUPPORTED_LOCALES }` (imported from `@/i18n/locales`, never a
      literal array — the `media_server_client`/`MEDIA_SERVER_IDS` pattern) and `default_languages`
      as `{ kind: 'languages' }`.
      *Done when:* `getSettingCatalogEntry('ui_locale')` and `getSettingCatalogEntry('default_languages')`
      both return an entry, and `tsc` is clean.
- [x] **T003** `[api] [P]` Promote `LanguagesService.resolveLanguageIds` in
      `services/api/src/languages/languages.service.ts` to a public validator, named for what
      callers need of it (it validates a list of iso2 codes and resolves them). Behaviour unchanged:
      it still rejects a duplicate and an unknown code before any write.
      *Done when:* the method is callable from outside the class and
      `bin/npm api run test` still passes `languages.service.spec.ts`.
- [x] **T004** `[api]` Import `LanguagesModule` in `services/api/src/settings/settings.module.ts`
      and inject `LanguagesService` into `SettingsService`. → T003
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean and the api container boots without
      a Nest dependency-resolution error (`bin/dev` logs show `SettingsModule dependencies
      initialized`).
- [x] **T005** `[api]` In `SettingsService.updateMany`
      (`services/api/src/settings/settings.service.ts`), add the `languages` branch — split on `,`,
      trim, drop empty segments, validate through T003's method, and push the **normalized** joined
      list, never the raw input (the `path` branch is the precedent) — and reject an empty value for
      the `path`, `enum` and `int` kinds with `ERROR_KEYS.VALIDATION_SETTING_VALUE_REQUIRED`.
      No new error key. → T001, T002, T004
      *Done when:* `updateSettings` accepts `{ key: "default_languages", value: "" }`, accepts
      `"es,en"`, and rejects `"es,zz"` with `error.language.unavailable` **without** having written
      any other entry in the same call.
- [x] **T006** `[api]` Write `services/api/src/settings/settings.service.spec.ts`, opening with the
      Article IX header naming the failure it defends against (a `default_languages` value that
      parses to a code the encode merge later silently drops). Cover: whitespace trimmed, empty
      segments from a trailing/double comma dropped, unknown code rejected before any write,
      duplicate rejected before any write, `""` accepted as the empty list, and the stored value
      normalized rather than echoed. → T005
      *Done when:* `bin/npm api run test` is green with the new suite listed.
- [x] **T007** `[api]` In `services/api/src/settings/settings.resolver.ts`, apply
      `@UseGuards(AdminGuard)` to `settings` and `updateSettings` **per method, never at class
      level** (`ffprobe-logs.resolver.ts` is the precedent and the reason), and add the
      `@Public()` `defaultUiLocale: String` query returning the stored `ui_locale` when
      `isSupportedLocale` accepts it and `null` otherwise. → T002
      *Done when:* the regenerated `src/schema.gql` contains `defaultUiLocale: String`; an
      unauthenticated `defaultUiLocale` query answers; and `settings` with a non-admin token is
      refused with `error.auth.admin_required`.
- [x] **T008** `[api]` Write `services/api/src/settings/settings.resolver.spec.ts` with the
      Article IX header (a guard applied at the wrong level surfaces only on an anonymous request,
      from users who cannot report it). Assert off the metadata Nest resolves: `AdminGuard` present
      on `settings` and `updateSettings`, **absent** on `defaultUiLocale`, and `IS_PUBLIC_KEY` set
      on `defaultUiLocale` only. → T007
      *Done when:* `bin/npm api run test` is green, and the suite fails if `AdminGuard` is moved to
      the class.
- [x] **T009** `[api] [P]` Append `{ key: 'ui_locale', value: '' }` and
      `{ key: 'default_languages', value: '' }` to the array in
      `services/api/prisma/seeds/settings.ts`. Do not restructure the create-only loop.
      *Done when:* after `bin/dbreset`,
      `bin/mysql -e "select \`key\` from settings where \`key\` in ('ui_locale','default_languages')"`
      returns both rows.

### Group 2 — retiring the per-user global language level

Ordered so `tsc` is clean after every task: the readers go first, the schema last. Dropping the
model before its callers are gone leaves the service uncompilable mid-group.

- [x] **T010** `[api]` In `services/api/src/process-jobs/process-jobs.service.ts`, make
      `collectAllowedLanguages` union the `default_languages` setting (read through the already
      injected `SettingsService`, resolved from iso2 to iso3) instead of `owner.user.languages`, and
      drop `user: { select: { languages: … } }` from both `mergeMovieAllowedLanguages` and
      `mergeShowAllowedLanguages`. The original language stays first and the result stays
      deduplicated. → T005, T009
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean and no `user.languages` select
      remains in the file.
- [x] **T011** `[api]` Add the merge case to
      `services/api/src/process-jobs/process-jobs.service.spec.ts` (the file already mocks
      `SettingsService`): with `default_languages` set and an owner holding a per-title preference,
      `allowedLanguagesIso3` contains the original language first, then both, with no duplicates.
      → T010
      *Done when:* `bin/npm api run test` is green and the case fails if the `default_languages`
      read is removed.
- [x] **T012** `[api]` Remove `setPreferredLanguagesFor` and `findPreferredLanguagesFor` from
      `services/api/src/languages/languages.service.ts`, the `setPreferredLanguages` mutation from
      `languages.resolver.ts`, and their cases from `languages.service.spec.ts`. The three per-title
      methods and both per-title mutations stay — they are a different level and this feature does
      not touch them. → T010
      *Done when:* `setPreferredLanguages` is absent from the regenerated `src/schema.gql`,
      `setMoviePreferredLanguages`/`setShowPreferredLanguages` are still present, and
      `bin/npm api run test` is green.
- [x] **T013** `[api]` Remove the `preferredLanguages` `@ResolveField` from
      `services/api/src/auth/auth.resolver.ts`, plus the `LanguagesService` injection and the
      `LanguagesModule` import in `auth.module.ts` **only if** nothing else in those files still
      uses them. → T012
      *Done when:* `User.preferredLanguages` is absent from `src/schema.gql`,
      `Movie.preferredLanguages` and `Show.preferredLanguages` are still present, and `tsc` is clean.
- [x] **T014** `[api]` Remove the `UserLanguage` model and the `User.languages` relation from
      `services/api/prisma/schema.prisma` and generate the migration through
      `bin/npm api run prisma:migrate` — never hand-written SQL (Article III). No backfill: the rows
      are discarded by decision (`spec.md` NFR-1). → T013
      *Done when:* `git status services/api/prisma/` shows both a modified `schema.prisma` and a new
      migration directory, and `bin/mysql -e 'show tables like "user_languages"'` returns nothing.

### Group 3 — the screen

Everything here depends on Group 1's contract existing and Group 2's removals having landed —
`web` deletes calls to a mutation `api` deletes, and reads a query `api` adds.

- [x] **T015** `[web] [P]` Create `services/web/src/components/ui/tabs/TabNav.tsx`: a presentational
      underline-and-icon tab strip taking `items` (`{ key, label, icon }`), `active` and `onChange`.
      Icons from `lucide-react`; repeating an icon across tabs is acceptable for now. No settings
      knowledge in the component.
      *Done when:* `bin/npm web run lint` is clean and the component renders six tabs with the
      active one underlined.
- [x] **T016** `[web]` In `services/web/src/actions/settings.ts`: add `getDefaultUiLocale()`
      (queries `defaultUiLocale`, uses `redirectToClearSession` — it is awaited during a Server
      Component render — and returns `string | null`), add `ui_locale` to `EDITABLE_KEYS`, and give
      `default_languages` the `BOOLEAN_KEYS` treatment: **always pushed explicitly, never passed
      through the blank filter**, because `""` is a valid value meaning "no default languages".
      → T007
      *Done when:* saving with every language deselected clears the row rather than leaving the
      previous value, verified with
      `bin/mysql -e "select value from settings where \`key\`='default_languages'"`.
- [x] **T017** `[web]` In `services/web/src/i18n/request.ts`, insert the installation default
      between the user's `uiLocale` and `Accept-Language`, guarded by `isSupportedLocale`. It runs
      for anonymous requests, so it must not assume a session. → T016
      *Done when:* with `ui_locale` = `es` and a browser sending `Accept-Language: en-US`, a
      logged-out `/login` renders in Spanish (AC-6).
- [x] **T018** `[web]` Restructure `services/web/src/components/settings/SettingsForm.tsx` into one
      `<form>` holding the tab state and **six mounted panels**, inactive ones hidden with a class —
      never conditionally rendered, or the settings on unvisited tabs vanish from `FormData` and the
      save silently persists a subset. Move the existing controls into Media Manager (folders + the
      two toggles, now `components/form/input/Checkbox.tsx` plus the `PathPicker` hidden-input
      idiom, replacing the hand-rolled `<input type="checkbox">`), Media Server
      (`MediaServerFields`, behaviour unchanged) and Torrent Manager (downloads folder + indexer API
      key). One error slot and one success message for the whole screen. → T015
      *Done when:* AC-1 — six underlined tabs with icons, General active on load — and changing a
      value on two different tabs and saving once persists both.
- [x] **T019** `[web]` Add `GeneralPanel.tsx` (the app-language select, `name="ui_locale"`) and
      `DownloadPanel.tsx` (`components/form/MultiSelect.tsx` plus its
      `<input type="hidden" name="default_languages">`, options built through `Intl.DisplayNames`
      and `localeCompare` the way `LanguagePicker.tsx` does). → T016, T018
      *Done when:* AC-3 — after a save,
      `bin/mysql -e "select \`key\`, value from settings where \`key\` in ('ui_locale','default_languages')"`
      returns both rows with the chosen values, the languages in the order they were chosen.
- [x] **T020** `[web]` Add `CompressionPanel.tsx`: one `components/form/input/Checkbox.tsx` and a
      group of `components/form/input/Radio.tsx`, local state only — **no `name`, no hidden input,
      nothing reaching `FormData`**. → T018
      *Done when:* AC-2's second half — moving the radios and saving succeeds, and reloading shows
      them back at their default because nothing was persisted.
- [x] **T021** `[web]` In `services/web/src/app/(dashboard)/settings/page.tsx`, check
      `getCurrentUser().isAdmin` and `notFound()` **before** calling `getSettings()`,
      **sequentially, never via `Promise.all`** (racing turns `api`'s refusal into a 500 instead of
      a clean 404 — the `users/page.tsx` precedent). Delete `PreferredLanguagesCard.tsx` and its
      import. → T018
      *Done when:* AC-9's first half — a non-admin navigating to `/settings` gets a 404, not a 500.
- [x] **T022** `[web]` Move the `/settings` entry into the `isAdmin`-only branch in
      `services/web/src/layout/AppSidebar.tsx`. → T021
      *Done when:* the sidebar shows `/settings` for the seeded admin and not for a non-admin.
- [x] **T023** `[web]` Delete `setPreferredLanguagesAction` from
      `services/web/src/actions/languages.ts` and remove `preferredLanguages` from the `me` document
      and the `CurrentUser` type in `services/web/src/actions/auth.ts`. Then run
      `grep -rn "preferredLanguages" services/web/src` and confirm **only** the `Movie`/`Show`
      occurrences remain (`actions/movies.ts`, `actions/shows.ts`, `components/movies/Movie.tsx`,
      `components/shows/Show.tsx`) — those are the per-title level and stay. → T013, T021
      *Done when:* that grep returns exactly those four files and `bin/npm web run build` exits 0.
- [x] **T024** `[web]` Add the new copy to `services/web/messages/en.json` and `messages/es.json` —
      the six tab labels, the app-language and default-languages field labels, and the Compresión
      panel's strings. `es` keeps the Rioplatense register. → T019, T020
      *Done when:* `bin/cli web node scripts/check-messages.mjs` reports no drift.

### Group 4 — verification

- [x] **T025** `[api]` Run the api verification pass and fix anything it surfaces within `api`.
      → T014
      *Done when:* `bin/cli api npx --no tsc --noEmit` clean, `bin/npm api run test` green,
      `bin/mysql -e "select \`key\`, value from settings where \`key\` in ('ui_locale','default_languages')"`
      returns both rows, and an `updateSettings` call mixing a valid `default_languages` with a
      `path_movies` of `../etc` leaves **both** rows untouched (AC-3, AC-4's api half, AC-5, AC-7,
      AC-8, AC-10's api half).
- [x] **T026** `[web]` Run the web verification pass and fix anything it surfaces within `web`.
      → T024
      *Done when:* `bin/npm web run lint` clean, `bin/npm web run build` exits 0, and
      `bin/cli web node scripts/check-messages.mjs` reports no drift (AC-10's web half).

### Group 5 — docs

- [x] **T027** `[docs]` Update `docs/spec/graphql-contract.md`: record the removal of
      `Mutation.setPreferredLanguages` and `User.preferredLanguages` in the `011-av1-transcode`
      language-preferences section (the SDL block and the `User.preferredLanguages` "sharp edge"
      paragraph both name them), the new `@Public()` `Query.defaultUiLocale` and the locale
      resolution order in the `018-ui-i18n` section, and settings becoming admin-only. Bump
      `spec_version` and `last_updated`. → T025, T026
      *Done when:* `grep -n "setPreferredLanguages" docs/spec/graphql-contract.md` returns only the
      two per-title mutations.
- [x] **T028** `[docs]` Update `services/api/CLAUDE.md` (the `settings/` and `languages/` module-map
      bullets; the `auth/` bullet's `AdminGuard` line, which today says the guard is applied at class
      level on `UsersResolver` and now has a second, per-method application worth naming) and
      `services/web/CLAUDE.md` (the settings screen, the admin-gated page list, and the i18n
      resolution order). The root `CLAUDE.md` pipeline table does **not** change — no stage changes
      status. → T027
      *Done when:* both files describe the shipped behaviour and neither still refers to a per-user
      global language preference.
- [x] **T029** `[docs]` Walk the ten acceptance criteria in `spec.md`, including the manual pass in
      `plan.md` § Verification, tick each box, and set `status: Implemented` on `spec.md`,
      `plan.md`, `api/plan.md` and `web/plan.md`. → T028
      *Done when:* every AC box is ticked and all four files read `status: Implemented`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

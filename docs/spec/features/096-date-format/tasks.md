---
title: Date Format Preference — Tasks
last_updated: 2026-10-17
status: Done
---

# TASKS: Date Format Preference (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[worker]` or `[infra]` task: the worker never displays a date, and nothing about how the stack
boots changes.

## Tasks

### Group 1 — schema and contract (`api`)

- [x] **T001** `[api]` Schema and stored state:
      - Add `User.dateMonthFirst Boolean?` to `services/api/prisma/schema.prisma`, no default,
        locator `// Spec 096, REQ-3 NFR-1`.
      - Generate the migration with
        `bin/npm api run prisma:migrate -- --name add_user_date_month_first`.
      - Add `date_month_first: { kind: 'boolean' }` to `src/settings/settings.catalog.ts`.
      - Add the `{ key: 'date_month_first', value: '' }` seed row to `prisma/seeds/settings.ts`.
      - Place the catalog key and the seed row next to `ui_locale` (`api/plan.md` steps 1–2).

      *Done when:*
      - `git status --short services/api/prisma` shows `schema.prisma` modified and exactly one
        new migration directory.
      - After an `api` restart, `bin/mysql -e "select value from settings where \`key\`='date_month_first'"`
        returns one empty row.
      - `bin/mysql -e "select count(*) from users where dateMonthFirst is not null"` returns `0`.
- [x] **T002** `[api]` Produce the frozen contract (`api/plan.md` steps 3–6):
      - `dateMonthFirst` field on `src/users/entities/user.entity.ts`.
      - `UsersService.setDateMonthFirst`.
      - `AuthResolver.setDateMonthFirst` in `src/auth/auth.resolver.ts`, shaped like `setUiLocale`.
      - `SettingsResolver.defaultDateMonthFirst`: authenticated, **not** `@Public()`, no
        `AdminGuard`. It maps only `"true"`/`"false"`; anything else returns `null`.
      - Descriptions exactly as in `../spec.md` § GraphQL Contract Delta. → T001

      *Done when:*
      - `bin/cli api npx tsc --noEmit` reports 0 errors.
      - After boot, `git diff services/api/src/schema.gql` shows exactly `User.dateMonthFirst`,
        `Query.defaultDateMonthFirst` and `Mutation.setDateMonthFirst`, and nothing else.
      - As admin, `updateSettings` with `date_month_first` = `"yes"` returns
        `error.setting.expected_boolean` (spec AC-7).
      - `defaultDateMonthFirst` with no cookie is refused (spec AC-8).
- [x] **T003** `[api]` Tests in `src/settings/settings.resolver.spec.ts`:
      - Guard-wiring suite: `defaultDateMonthFirst` is neither `@Public()` nor behind `AdminGuard`.
      - A new `describe`, with its own Article IX header, for the value mapping: `"true"` → `true`,
        `"false"` → `false`, `""` → `null`, missing key → `null`, `"yes"` → `null`.
      - Per `api/plan.md` § Tests. → T002

      *Done when:* `bin/npm api run test` is fully green, the new cases are listed in its output,
      and `bin/comments api` passes.

### Group 2 — consumers (`web`)

These tasks depend on T002 having produced the contract. Each web task depends on the one before
it: T006 reads the context and locale map from T004, and T005 and T006 would otherwise both edit
`MediaServerFields.tsx`/`SettingsForm.tsx` and the message catalogs.

- [x] **T004** `[web]` Resolution plumbing (`web/plan.md` steps 1–7):
      - `formatDate`/`formatDateTime` in `src/lib/format.ts`.
      - `MONTH_FIRST_BY_LOCALE` in `src/i18n/locales.ts`.
      - `dateMonthFirst` on `ME_QUERY`/`CurrentUser` in `src/actions/auth.ts`.
      - `getDefaultDateMonthFirst()` in `src/actions/settings.ts`, which returns `null` on any
        error and never redirects.
      - New `src/context/DateFormatContext.tsx`.
      - `src/app/(dashboard)/layout.tsx` resolves user → installation (read only when the user's
        value is `null`) → locale, and `AdminShell.tsx` wraps its tree in the provider. → T002

      *Done when:*
      - `bin/cli web npx tsc --noEmit` reports 0 errors and `bin/comments web` passes.
      - Signed in on the dev stack, the dashboard renders, and the `me` response in the network
        panel carries `dateMonthFirst`.
- [x] **T005** `[web]` Date sites (`web/plan.md` step 8):
      - `MovieReleaseDates.tsx` and `SeasonAccordion.tsx` use `formatDate`.
      - `SchedulingPanel.tsx` (last and next run) and `MediaServerFields.tsx` (last sync) use
        `formatDateTime`, still behind `mounted`.
      - The two prose comments that name `toLocaleString()` become `// Spec 096, REQ-7a NFR-2`
        locators. → T004

      *Done when:*
      - `grep -rn "toLocaleDateString\|toLocaleString" services/web/src` prints nothing.
      - Typecheck and `bin/comments web` pass.
      - An `en` user with nothing set sees a film's digital release of 2026-09-07 as `09/07/2026`
        (spec AC-1).
      - Settings → Scheduling shows `MM/DD/YYYY HH:mm:ss` with no `AM`/`PM` (spec AC-11).
- [x] **T006** `[web]` Pickers and writes (`web/plan.md` steps 4, 5, 9–11):
      - `"date_month_first"` in `BOOLEAN_KEYS`.
      - `setDateMonthFirstAction` in `src/actions/locale.ts`.
      - Date format `Select` in `GeneralPanel.tsx`, fed by `SettingsForm.tsx`. When the setting is
        `""`, the initial value is the admin's language order.
      - Date format select in `PreferencesForm.tsx`, fed from `preferences/page.tsx`
        `user.dateMonthFirst`. It saves in the existing `Promise.all`, resets on error, and calls
        `router.refresh()` when the value changed.
      - `dateFormatLabel` in `settings.general` and `preferences.form` of both message catalogs.
        → T005

      *Done when:*
      - `bin/cli web node scripts/check-messages.mjs` passes, and typecheck and
        `bin/comments web` pass.
      - Saving Settings → General with `MM/DD/YYYY` makes an `es` user with nothing set see
        `09/07/2026` (spec AC-3).
      - Saving `/preferences` with `DD/MM/YYYY` turns that user's view into `07/09/2026` without a
        manual reload (spec AC-4).

### Group 3 — docs and verification

- [x] **T007** `[docs] [P]` Add a `096-date-format` section to `docs/spec/graphql-contract.md`:
      - `User.dateMonthFirst`, `defaultDateMonthFirst` (authenticated, `null` = unset) and
        `setDateMonthFirst`.
      - The `date_month_first` catalog key, seeded `""`.
      - The resolution order `User.dateMonthFirst` → `defaultDateMonthFirst` → UI language.
      - No new error keys. → T002

      *Done when:* the section exists, and its SDL matches the `schema.gql` diff from T002 line
      for line.
- [x] **T008** `[docs] [P]` Update the affected `CLAUDE.md` files. → T003, T006
      - `services/api/CLAUDE.md` `settings/` paragraph: the `date_month_first` key and
        `defaultDateMonthFirst`, authenticated rather than `@Public()`, and why.
      - `services/web/CLAUDE.md`: `DateFormatContext`, the formatters in `lib/format.ts`, and that
        no component formats a date with `toLocale*`.
      - Root `CLAUDE.md` "Browse library" row: one "Since `096`" sentence (two orders, user →
        installation → language, always zero-padded, 24-hour times in Settings), with `096` in
        its spec list.

      *Done when:* each of the three files names `096`, and nothing in them still says dates
      follow `toLocaleDateString`.
- [x] **T009** `[docs]` Verification and close. → T003, T006, T007, T008
      - Run every command in `plan.md` § Verification and the manual pass (spec AC-1 … AC-12).
      - AC-9 is verified by reading `getDefaultDateMonthFirst`'s error branches, per the plan.
      - Tick each box in `spec.md`, append a `docs/spec/history.md` entry, and set
        `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`, and
        `status: Done` here.

      *Done when:*
      - Every AC in `spec.md` is ticked, or named in `docs/spec/pending-acs.md` with its blocker.
      - `bin/pending-acs --check` exits 0.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

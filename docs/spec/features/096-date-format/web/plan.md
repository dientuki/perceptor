---
title: Date Format Preference — web slice
service: web
last_updated: 2026-10-17
status: Implemented
---

# PLAN: Date Format Preference — `web` (`web/plan.md`)

## Scope

`web` resolves the effective date order once per request, formats every displayed date with it,
and adds the two pickers (Settings → General, `/preferences` → General). It does **not** store or
validate anything: the column, the setting row, the boolean validation and both new operations are
`api`'s (`../api/plan.md`). Code against the SDL in `../spec.md`; it is frozen.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/lib/format.ts` | Modified | `formatDate`, `formatDateTime` |
| `services/web/src/i18n/locales.ts` | Modified | Per-locale month-first default |
| `services/web/src/context/DateFormatContext.tsx` | New | Provider + `useDateMonthFirst()` |
| `services/web/src/actions/auth.ts` | Modified | `me` selects `dateMonthFirst`; `CurrentUser` type gains it |
| `services/web/src/actions/settings.ts` | Modified | `getDefaultDateMonthFirst()`; `date_month_first` in `BOOLEAN_KEYS` |
| `services/web/src/actions/locale.ts` | Modified | `setDateMonthFirstAction(monthFirst)` |
| `services/web/src/app/(dashboard)/layout.tsx` | Modified | Resolve the effective order, pass it down |
| `services/web/src/layout/AdminShell.tsx` | Modified | Wrap children in the provider |
| `services/web/src/components/movies/MovieReleaseDates.tsx` | Modified | Use `formatDate` |
| `services/web/src/components/shows/SeasonAccordion.tsx` | Modified | Use `formatDate` |
| `services/web/src/components/settings/SchedulingPanel.tsx` | Modified | Use `formatDateTime` (last/next run) |
| `services/web/src/components/settings/MediaServerFields.tsx` | Modified | Use `formatDateTime` (last sync) |
| `services/web/src/components/settings/GeneralPanel.tsx` | Modified | Date format select |
| `services/web/src/components/settings/SettingsForm.tsx` | Modified | Pass `date_month_first` into `GeneralPanel` |
| `services/web/src/components/preferences/PreferencesForm.tsx` | Modified | Date format select, save, error reset, refresh |
| `services/web/src/app/(dashboard)/preferences/page.tsx` | Modified | Pass `user.dateMonthFirst` |
| `services/web/messages/en.json`, `es.json` | Modified | `settings.general.dateFormatLabel`, `preferences.form.dateFormatLabel` |

## Existing code to reuse

- `src/lib/format.ts` — the existing home for display formatters (`formatSpeed`,
  `formatProgress`); the two new functions go here, not in a new file.
- `src/context/SidebarContext.tsx` — the context/provider/hook shape to copy for
  `DateFormatContext.tsx`.
- `src/app/(dashboard)/layout.tsx` — already awaits `getCurrentUser()` (the `cache()`-wrapped `me`
  in `src/actions/auth.ts`, so the extra field costs no round trip) and already fans out with
  `Promise.all`; the installation read joins only when `user.dateMonthFirst === null`.
- `src/actions/settings.ts` `getDefaultUiLocale` — the query/action shape for
  `getDefaultDateMonthFirst`, **except** its error handling: this one returns `null` on any error
  or thrown fetch, never `redirectToClearSession`/throw (spec AC-9). The session itself is already
  enforced by `getCurrentUser()` in the same layout.
- `src/actions/settings.ts` `BOOLEAN_KEYS` — adding `"date_month_first"` makes the Settings save
  always send `"true"`/`"false"` from the form's `date_month_first` input, which is exactly
  REQ-6's "saving untouched writes the shown value". No new branch.
- `src/actions/preferences.ts` `setAllowCinemaReleasesAction` — the boolean-argument action shape
  for `setDateMonthFirstAction` (placed in `src/actions/locale.ts` beside `setUiLocaleAction`,
  since both write `User` fields).
- `src/components/preferences/PreferencesForm.tsx` — the locale picker's pattern: initial state,
  inclusion in the `Promise.all` save, reset-on-error, and `router.refresh()` when it changed.
- The `mounted` guard already in `SchedulingPanel.tsx` / `MediaServerFields.tsx` — keep it; the
  date-time stamps stay client-only because they render in the browser's time zone.
- `src/components/form/Select.tsx`, `Label.tsx` — the pickers.
- `scripts/check-messages.mjs` — verifies the two catalogs stay in sync.

## Steps

1. `src/lib/format.ts`:
   - `formatDate(iso: string, monthFirst: boolean): string` builds `DD/MM/YYYY` or `MM/DD/YYYY`
     from the date's **UTC** day, month and year, with day and month zero-padded to 2 digits. The
     current call sites all pass `timeZone: "UTC"`, and these values are calendar days.
   - `formatDateTime(iso: string, monthFirst: boolean): string` builds the same date from the
     **local** parts, then a space, then `HH:mm:ss` in 24-hour local time, zero-padded.
   - Both use plain `Date` getters. No `Intl` and no `toLocale*`.
   - Locator: `// Spec 096, REQ-1 REQ-7a`.
2. `src/i18n/locales.ts`: export
   `MONTH_FIRST_BY_LOCALE: Record<SupportedLocale, boolean> = { en: true, es: false }`. A typed
   record means a future locale fails to compile until someone decides its order.
3. `src/actions/auth.ts`: add `dateMonthFirst` to `ME_QUERY` and
   `CurrentUser.dateMonthFirst: boolean | null`.
4. `src/actions/settings.ts`:
   - Add `getDefaultDateMonthFirst(): Promise<boolean | null>`, which returns `null` on any error.
   - Add `"date_month_first"` to `BOOLEAN_KEYS`.
5. `src/actions/locale.ts`: add `setDateMonthFirstAction(monthFirst: boolean)`, which runs the
   `setDateMonthFirst` mutation, selecting `id dateMonthFirst`.
   - On an error it calls `redirectIfUnauthenticated`, then returns
     `{ error: translateGraphQLError(...) }`.
   - On a thrown fetch it returns `network.connectionFailed`, the same as `setUiLocaleAction`.
6. `src/context/DateFormatContext.tsx` (`"use client"`): add a `DateFormatProvider` with a
   `monthFirst: boolean` value and a `useDateMonthFirst()` hook. The hook defaults to `false` only
   if it is used outside the provider, which never happens under `(dashboard)`.
7. `src/app/(dashboard)/layout.tsx`: compute
   `monthFirst = user.dateMonthFirst ?? (await getDefaultDateMonthFirst()) ?? MONTH_FIRST_BY_LOCALE[locale]`.
   - `locale` comes from `next-intl/server`'s `getLocale()`, the locale `src/i18n/request.ts`
     already resolved.
   - Run the installation read inside the existing `Promise.all`, and only when the user's value
     is `null`.
   - Pass `monthFirst` to `AdminShell`, which wraps its tree in `DateFormatProvider`.
   - Locator: `// Spec 096, REQ-4 NFR-3`.
8. Date sites, replacing each call while keeping the surrounding markup:
   - `MovieReleaseDates.tsx` and `SeasonAccordion.tsx`: replace `toLocaleDateString(...)` with
     `formatDate(value, useDateMonthFirst())`.
   - `SchedulingPanel.tsx` (last run and next run) and `MediaServerFields.tsx` (last sync):
     replace `toLocaleString(...)` with `formatDateTime(...)`, still behind `mounted`. Each file
     has a prose comment above its `mounted` guard that names `toLocaleString()`. Replace it with
     a `// Spec 096, REQ-7a NFR-2` locator (Article XI), or the "Done when" grep will not come
     back empty.
   - Drop any `useLocale` import left unused.
9. `GeneralPanel.tsx`: add a `dateMonthFirst: string` prop (the raw setting value) and a
   `Select` named `date_month_first`.
   - Options: `{ value: "false", label: "DD/MM/YYYY" }` and `{ value: "true", label: "MM/DD/YYYY" }`.
     The labels are literal patterns and are not translated.
   - `defaultValue`: the stored `"true"`/`"false"`. When the setting is `""`, use
     `String(MONTH_FIRST_BY_LOCALE[useLocale()])` (REQ-6, the admin's active language).
   - Label: `t("dateFormatLabel")`.
   - `SettingsForm.tsx` passes `getSettingValue("date_month_first")`.
10. `PreferencesForm.tsx`: add a `currentDateMonthFirst: boolean | null` prop (from
    `preferences/page.tsx`, `user.dateMonthFirst`) and a select beside the language picker with
    the same two options.
    - Initial state: `currentDateMonthFirst ?? useDateMonthFirst()`.
    - Save: add `setDateMonthFirstAction(monthFirst)` to the `Promise.all` unconditionally, the
      same as the locale.
    - On an error, push it and reset the picker to its initial value.
    - Call `router.refresh()` when the value changed and the write succeeded.
11. `messages/en.json` / `es.json`: add `settings.general.dateFormatLabel` and
    `preferences.form.dateFormatLabel`.
    - English: "Date format".
    - Spanish: "Formato de fecha".

## Contract obligations

Consumes, exactly as in `../spec.md`:

- **`me { dateMonthFirst }`**: `null` means the user has not chosen.
- **`defaultDateMonthFirst`**: authenticated; `null` means unset.
  - Any error, or a thrown fetch, falls through to the language order. It never surfaces and never
    redirects (AC-9).
- **`setDateMonthFirst(monthFirst: Boolean!): User!`**:
  - An authentication error goes through `redirectIfUnauthenticated`.
  - Any other error is translated and shown in `PreferencesForm`'s error list, and the picker is
    reset.
  - A schema validation error cannot happen from a two-option select. It is still shown through
    the generic translation if it happens.
- **`updateSettings` with `date_month_first`**: `error.setting.expected_boolean` and
  `error.auth.admin_required` are already rendered by the Settings form's existing error path. No
  new handling is needed, but confirm the select can only ever submit `"true"`/`"false"`.

Do not adapt the contract locally. If it looks wrong, stop and report.

## Tests

`web` has no test runner, and adding one is outside this feature (Article X).

- `formatDate`/`formatDateTime` are the units where a bug is silent: a swapped day/month, a missing
  pad, or a local-vs-UTC slip that moves a release by a day. They are covered by the manual pass
  (spec AC-1, AC-2, AC-11) and by the checks in "Done when" below.
- Nothing else in this slice has a silent failure mode a manual pass would miss.

## Done when

```bash
bin/cli web npx tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments web
grep -rn "toLocaleDateString\|toLocaleString" services/web/src
```

- Typecheck is clean.
- The messages check passes.
- `bin/comments web` passes.
- The final `grep` prints nothing.
- Do **not** run `bin/npm web run build` while the dev stack is up.

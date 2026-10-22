---
title: Date Format Preference
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-17
last_updated: 2026-10-17
status: Implemented
services: [api, web]
---

# SPEC: Date Format Preference (`spec.md`)

## Context & Goal

Every calendar date `web` prints today is formatted by the browser's `toLocaleDateString` for the
active UI locale: `en` renders `9/7/2026` (month first) and `es` renders `7/9/2026` (day first),
neither zero-padded. The order is therefore an accident of the language choice, and a user who
reads the UI in English but thinks in day-first dates (or the reverse) has no way to change it.
The date sites are `services/web/src/components/movies/MovieReleaseDates.tsx` (the typed release
dates from `093`), `services/web/src/components/shows/SeasonAccordion.tsx` (an episode's air date),
and the date part of the two date-time stamps in Settings —
`services/web/src/components/settings/SchedulingPanel.tsx` (a task's last and next run) and
`services/web/src/components/settings/MediaServerFields.tsx` (the media-server index's last sync).

This feature adds a date order with exactly two values — `DD/MM/YYYY` or `MM/DD/YYYY` — resolved
the same way the UI language already is (`018-ui-i18n`, `029-settings-screen-tabs`): an
installation-wide value under Settings → General next to the app language, which an administrator
sets, and a per-user override under `/preferences` next to that user's own language picker. The
per-user value wins; with neither set, the order keeps following the active language, exactly as
today, except that day and month are now always two digits (`09/07/2026`, never `9/7/2026`).
Because there are only two orders, both levels store a boolean — "month first" — and `null`/unset
means "defer to the next level", the same shape `User.uiLocale` and the `ui_locale` setting have.

No pipeline stage changes. This touches only the "Browse library" stage's presentation and the
Settings and Preferences screens.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Two Orders Only)**: A date order is one of exactly two values: day first
      (`DD/MM/YYYY`) or month first (`MM/DD/YYYY`). Both use `/` as the separator, a two-digit
      zero-padded day and month, and a four-digit year.
- [ ] **REQ-2 (Installation Setting)**: An administrator must be able to choose the
      installation-wide date order from Settings → General, beside the existing app language
      picker. A fresh installation and an existing one after upgrading start with the setting
      unset.
- [ ] **REQ-3 (Per-User Override)**: Any signed-in user must be able to choose their own date order
      from `/preferences`, beside their own language picker, saved by the same Save action that
      saves the rest of that form. It applies only to that user.
- [ ] **REQ-4 (Resolution Order)**: The date order in effect for a request is resolved as: the
      user's own value if set → the installation value if set → the order of the active UI
      language (`en` → month first, `es` → day first). A user who has not chosen still sees an
      administrator's change on their next page load.
- [ ] **REQ-5 (Unset Default Follows Language)**: With neither level set, the order must match what
      each language renders today, zero-padded: an `en` user sees `09/07/2026` for 7 September
      2026, an `es` user sees `07/09/2026`.
- [ ] **REQ-6 (Initial Selection)**: Each picker must open showing the order currently in effect at
      that level — the `/preferences` picker shows the user's value, or else what REQ-4 resolves
      without it; the Settings picker shows the installation value, or else the order of the
      administrator's active language. Saving the form without touching the picker must still
      write that value, the same way the language picker behaves today.
- [ ] **REQ-7 (Every Date Site)**: Every calendar date `web` displays must use the effective order:
      a film's typed release dates on its detail page, an episode's air date in the season
      accordion, and the date part of the scheduler's last/next run and the media-server index's
      last sync in Settings.
- [ ] **REQ-7a (Date-Time Stamps)**: The scheduler's last/next run and the media-server index's
      last sync render as the date in the effective order (REQ-1) followed by the time in 24-hour
      `HH:mm:ss`, zero-padded, regardless of the UI language — e.g. `07/09/2026 14:32:05` or
      `09/07/2026 14:32:05`, never `2:32:05 PM`. These stamps keep being shown in the browser's
      local time zone, as they are today.
- [ ] **REQ-8 (Out Of Scope Formats Unchanged)**: Year-only displays (a title's year on cards and
      detail headers) and the calendar's month heading (`October 2026`) are unchanged — they carry
      no day/month order.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No Backfill)**: The migration adds a nullable column and the seed adds an unset
      setting; no existing user or installation is assigned a value, so nothing a user sees changes
      on upgrade except the zero-padding of REQ-5.
- [ ] **NFR-2 (No Hydration Mismatch)**: A date must render identically on the server and in the
      browser — the order is resolved from data, never from the browser's or the container's locale
      or timezone (the Settings date-time stamps of REQ-7a keep their existing client-only render,
      which already avoids the mismatch). Dates that are calendar days (`releaseDate`, typed release dates) keep being read
      in UTC as they are today.
- [ ] **NFR-3 (No Extra Round Trip Per Date)**: The effective order is resolved once per request,
      not once per rendered date.
- [ ] **NFR-4 (Self-Service Only)**: A user can write only their own value; no argument names
      another user, the same posture `setUiLocale` has.

## GraphQL Contract Delta

```graphql
type User {
  """
  Date order chosen by this user: true = MM/DD/YYYY, false = DD/MM/YYYY.
  Null means unset — fall through to defaultDateMonthFirst, then the UI language.
  """
  dateMonthFirst: Boolean
}

type Query {
  """
  Installation-wide date order: true = MM/DD/YYYY, false = DD/MM/YYYY.
  Null when the date_month_first setting is unset — fall through to the UI language.
  Any authenticated user; not public.
  """
  defaultDateMonthFirst: Boolean
}

type Mutation {
  """Sets the caller's own date order. Never another user's."""
  setDateMonthFirst(monthFirst: Boolean!): User!
}
```

`Query.me` returns the new `User.dateMonthFirst` field; `web`'s `me` query must select it.

The settings catalog gains one key, `date_month_first`, kind `boolean`, written through the
existing admin-only `updateSettings` and read through the existing admin-only `settings`. The seed
stores it as `""` (unset), the same convention `ui_locale` already uses; a write must be `"true"`
or `"false"` — once set it cannot be returned to unset from the UI, exactly like `ui_locale`.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `updateSettings` with `date_month_first` not `"true"`/`"false"` (including `""`) | `BadRequestException`, existing `error.setting.expected_boolean` | the existing catalog entry for that key |
| `updateSettings` by a non-admin | existing `error.auth.admin_required` | existing |
| `setDateMonthFirst` / `defaultDateMonthFirst` with no valid session | existing authentication refusal | existing — `web` redirects to login |
| `setDateMonthFirst` with a non-boolean `monthFirst` | GraphQL validation error (schema-level) | never reachable from `web`'s picker; `web` shows the generic error |

What `web` does with each: the Settings form shows the `updateSettings` error inline, as it does
for every other key; the `/preferences` form adds a failed `setDateMonthFirst` to its error list
and resets the picker to the value it opened with, the same handling its locale write has. A
failed or unreachable `defaultDateMonthFirst` read falls through to the language order (REQ-4) —
dates still render, never an error page.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `User` | add `dateMonthFirst Boolean?` | nullable, no default (`null` = unset) | No — unset is the intended starting state (NFR-1) |
| `Setting` (seed) | add row `date_month_first` = `""` | — | Seed adds it to existing installations as unset |

## Acceptance Criteria

- [ ] **AC-1**: Given a fresh installation with no date order set anywhere and a user whose UI
      language is `en`, when they open a film whose digital release is 2026-09-07, then the detail
      page shows `09/07/2026`; switching their language to `es` shows `07/09/2026`.
- [ ] **AC-2**: Given an episode airing 2026-03-05, when an `es` user with nothing set opens the
      season accordion, then the air date reads `05/03/2026` (zero-padded, not `5/3/2026`).
- [ ] **AC-3**: Given an administrator sets Settings → General → date format to `MM/DD/YYYY` and
      saves, when an `es` user who never chose a date order loads the film from AC-1, then it shows
      `09/07/2026`.
- [ ] **AC-4**: Given AC-3's installation value, when that user picks `DD/MM/YYYY` in
      `/preferences` and saves, then they see `07/09/2026` while a second user with nothing set
      still sees `09/07/2026`.
- [ ] **AC-5**: `bin/mysql -e "select username, dateMonthFirst from users"` after AC-4 shows `0`
      for the first user and `NULL` for the second.
- [ ] **AC-6**: Given a user who has never chosen, when they open `/preferences`, then the date
      picker shows the order currently in effect for them; saving without touching it stores that
      value.
- [ ] **AC-7 (failure)**: `updateSettings(entries: [{ key: "date_month_first", value: "yes" }])` as
      an administrator is refused with `extensions.i18n` key `error.setting.expected_boolean`, and
      `bin/mysql -e "select value from settings where \`key\`='date_month_first'"` shows the value
      unchanged.
- [x] **AC-8 (failure)**: `defaultDateMonthFirst` sent with no auth cookie is refused with the
      authentication error, not answered.
- [x] **AC-9 (failure)**: Given a user with nothing set and `api` answering
      `defaultDateMonthFirst` with an error, when they load a film detail page, then the page
      renders with the language order instead of failing.
- [ ] **AC-10**: Loading the film detail page and the season accordion with the browser's devtools
      console open logs no hydration mismatch warning.
- [ ] **AC-11**: Given an `en` user with nothing set, when they open Settings → Scheduling for a
      task that last ran at 14:32:05 on 7 September 2026 local time, then it reads
      `09/07/2026 14:32:05` — no `AM`/`PM`; with the installation set to `DD/MM/YYYY` it reads
      `07/09/2026 14:32:05`. The media-server last-sync stamp follows the same rule.
- [ ] **AC-12**: The year under a film's title and the calendar month heading are unchanged by
      either setting.

## Out of Scope

- **More than two orders (`YYYY-MM-DD`, dotted or dashed separators, month names).** The request is
  exactly the two slash formats; a third order would make the boolean column wrong and is a
  separate spec.
- **A 12-hour time option.** Times are always 24-hour (REQ-7a); offering a choice would be its
  own setting and is not requested.
- **Returning the installation or user value to "unset" from the UI.** Mirrors `ui_locale` and
  `User.uiLocale`, which cannot be cleared from the UI either.
- **Dates inside API- or worker-produced text** (error messages, logs, container metadata). The
  setting is a `web` presentation choice; nothing outside `web` formats a date for a user.
- **The calendar grid itself** (`/calendar`), which shows day numbers inside a month, not
  formatted dates.

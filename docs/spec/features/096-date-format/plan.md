---
title: Date Format Preference — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-17
status: Implemented
---

# PLAN: Date Format Preference (`plan.md`)

## Approach

The feature is a copy of the shape `018-ui-i18n`/`029-settings-screen-tabs` already gave the UI
language, at both levels, with a boolean instead of a locale tag:

- **Per user** — `User.dateMonthFirst Boolean?` beside `User.uiLocale`, read through the existing
  `me` query and written by a new `setDateMonthFirst` mutation that sits next to `setUiLocale` in
  `services/api/src/auth/auth.resolver.ts` and delegates to `UsersService`, exactly as
  `setUiLocale` does.
- **Per installation** — a `date_month_first` row in the existing settings catalog
  (`services/api/src/settings/settings.catalog.ts`, `kind: 'boolean'`), seeded `""` the way
  `ui_locale` is, so the existing `updateSettings` validation (`"true"`/`"false"` only) and the
  existing `BOOLEAN_KEYS` path in `services/web/src/actions/settings.ts` carry it with no new code.
  Non-admins cannot read `settings`, so a new `defaultDateMonthFirst` query mirrors
  `defaultUiLocale` — but authenticated, not `@Public()`: no anonymous page shows a date.

`web` resolves the effective order **once per request** in the dashboard layout
(`services/web/src/app/(dashboard)/layout.tsx`, which already awaits the cached `me`): user value →
installation value → the active locale's order. The resolved boolean is handed to the client tree
through a context, the same pattern as `services/web/src/context/SidebarContext.tsx`, and every date
site formats through two pure functions added to the existing `services/web/src/lib/format.ts`
instead of `toLocaleDateString`/`toLocaleString`.

**Alternative rejected: Intl locale tricks** (formatting with `en-GB` vs `en-US` to get the order).
It makes the output depend on the ICU data the runtime ships, which differs between the Node
container and the browser — exactly the hydration mismatch NFR-2 forbids — and cannot express
"`es` text, month-first dates" without inventing a locale. The formatter builds the string from
date parts; there is nothing to localise in `DD/MM/YYYY HH:mm:ss`.

**Alternative rejected: resolving the effective order in `api`** (one resolved field on `User`).
It would hide the user's own stored value, which the `/preferences` picker needs to show (REQ-6),
and the language fallback is a `web` fact (the active locale is resolved in
`services/web/src/i18n/request.ts`, partly from `Accept-Language`, which `api` never sees).

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration, the catalog key, the seed row and both new operations; `web` cannot select a field the schema does not have. |
| 2 | `web` | Consumes `User.dateMonthFirst`, `defaultDateMonthFirst`, `setDateMonthFirst` and the `date_month_first` setting. |
| 3 | `docs` (orchestrator) | `docs/spec/graphql-contract.md` gains a `096` section; `services/api/CLAUDE.md`'s `settings/` paragraph and `services/web/CLAUDE.md` name the new key and the date context. |

With the contract frozen, `web` **may run in parallel with `api`**: it codes against the SDL in
`spec.md`, and only its live verification waits for `api`. Step 3 runs after both reports.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will be tempted to change and must not:

- **`defaultDateMonthFirst` is authenticated, not `@Public()`.** It looks like `defaultUiLocale`'s
  twin and an implementer may copy the decorator too; nothing anonymous renders a date, and
  widening the anonymous surface needs a reason this feature does not have.
- **`defaultDateMonthFirst` returns `null` for `""`, never `false`.** From inside `api` a boolean
  query returning `false` for an unset row looks tidier. It would silently force day-first on every
  `en` user who never chose (REQ-5 broken, no error anywhere).
- **`setDateMonthFirst(monthFirst: Boolean!)` returns `User!`, not `UserPreferences!`.** The
  `allowCinemaReleases`/`audioMandatory` setters return `UserPreferences`; this value lives on
  `User` beside `uiLocale`, so it follows `setUiLocale`.
- **No "unset" write.** Neither the mutation nor `updateSettings` accepts a value that clears the
  choice; `""` stays rejected by the existing boolean validation (spec AC-7).
- **The boolean means "month first".** `true` = `MM/DD/YYYY`. Do not invert it to "day first" in
  either service.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, and re-brief both
services. Never patch it from inside one slice (Constitution, Article VIII).

## Migrations

1. `add_user_date_month_first` — adds nullable `users.dateMonthFirst` (`TINYINT(1) NULL`), no
   default. Generated through `bin/npm api run prisma:migrate -- --name add_user_date_month_first`.
2. Backfill: none (spec NFR-1). Every existing row reads `NULL`. The settings row is created by the
   production seed (`prisma/seeds/settings.ts`, create-only) as `""` on the next `api` boot — no
   migration touches `settings`.

Reversibility: dropping the column loses only users' choices; nothing else reads it. Removing the
seed row is harmless — `defaultDateMonthFirst` already answers `null` for a missing key.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Unset setting read as `false` | Every user without a choice sees day-first regardless of language; no error | `defaultDateMonthFirst` maps only the literal strings `"true"`/`"false"`; `settings.resolver.spec.ts` covers `""`, missing key and garbage → `null` |
| `defaultDateMonthFirst` given `@Public()` or `AdminGuard` by copy-paste | Public: anonymous surface widened silently. Admin: every non-admin's read fails, `web` swallows it (AC-9) and falls back to language — the installation setting silently does nothing for them | The existing guard-wiring suite in `settings.resolver.spec.ts` gains an assertion: neither public nor admin |
| Server/client render a different string | Hydration warning, dates flicker; for UTC dates on a host in another timezone, an off-by-one day | Calendar dates format from UTC parts; date-time stamps keep the `mounted` client-only render `SchedulingPanel.tsx`/`MediaServerFields.tsx` already use; spec AC-10 |
| A date site missed | That one place keeps `9/7/2026`; nothing errors | `web` plan lists the four sites from a grep; verification re-runs the grep and expects no `toLocaleDateString`/`toLocaleString` left in `services/web/src` |
| Preference saved but the page keeps the old order | The layout resolved the order before the write; user thinks Save failed | `/preferences` calls `router.refresh()` when the date order changed, the same as it does for the locale |
| Settings form writes `date_month_first` on every save | An admin who saves any Settings tab pins the installation order to whatever the picker showed | Intended — spec REQ-6 says saving untouched writes the shown value, same as `ui_locale` |

## Verification

```bash
bin/npm api run test
bin/cli api npx tsc --noEmit
bin/comments api
git status --short services/api/prisma
bin/cli web npx tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments web
grep -rn "toLocaleDateString\|toLocaleString" services/web/src
```

The `git status` shows a modified `schema.prisma` and one new migration directory. The final `grep`
prints nothing. The `schema.gql` diff shows only `User.dateMonthFirst`,
`Query.defaultDateMonthFirst` and `Mutation.setDateMonthFirst`.

Manual pass (spec AC-1 … AC-12), signed in on the dev stack:

1. As an `en` user with nothing set, open a film with a digital release on 2026-09-07 →
   `09/07/2026`; switch the language to `es` → `07/09/2026` (AC-1). Open a season with an
   episode airing 2026-03-05 → `05/03/2026` (AC-2).
2. As admin, Settings → General → date format `MM/DD/YYYY`, save. As an `es` user with nothing
   set, reload the film → `09/07/2026` (AC-3).
3. That user, `/preferences` → `DD/MM/YYYY`, save → `07/09/2026`; a second user still sees
   `09/07/2026` (AC-4). `bin/mysql -e "select username, dateMonthFirst from users"` → `0` and
   `NULL` (AC-5).
4. A user who never chose opens `/preferences` → the picker shows their current effective order;
   save → the column is set (AC-6).
5. From the GraphQL playground as admin, `updateSettings` with `date_month_first` = `"yes"` →
   `error.setting.expected_boolean`; the stored value is unchanged (AC-7). `defaultDateMonthFirst`
   with no cookie → authentication refusal (AC-8).
6. AC-9 cannot be provoked live without breaking `api` for the whole request. Verify it by reading
   `web`'s `getDefaultDateMonthFirst`: every error branch returns `null`, never throws or
   redirects. Optionally, misspell the field in a scratch edit of the query and confirm the film
   page still renders with the language order, then revert.
7. Devtools console on the film and the season pages: no hydration warning (AC-10).
8. Settings → Scheduling and the media-server card: last/next run and last sync read
   `MM/DD/YYYY HH:mm:ss` / `DD/MM/YYYY HH:mm:ss`, 24-hour, no `AM`/`PM` (AC-11).
9. The year under the film title and the calendar month heading are unchanged (AC-12).

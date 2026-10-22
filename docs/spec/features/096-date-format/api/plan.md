---
title: Date Format Preference — api slice
service: api
last_updated: 2026-10-17
status: Implemented
---

# PLAN: Date Format Preference — `api` (`api/plan.md`)

## Scope

`api` stores the two levels of the date order and exposes them: the nullable `User.dateMonthFirst`
column with its self-service setter, and the installation-wide `date_month_first` setting with an
authenticated read. It does **not** format any date, resolve the effective order, or know about
the UI language fallback — that is all `web` (`../web/plan.md`).

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/prisma/schema.prisma` | Modified | `User.dateMonthFirst Boolean?` after `uiLocale` |
| `services/api/prisma/migrations/<ts>_add_user_date_month_first/` | New | Generated migration |
| `services/api/prisma/seeds/settings.ts` | Modified | `{ key: 'date_month_first', value: '' }` beside `ui_locale` |
| `services/api/src/settings/settings.catalog.ts` | Modified | `date_month_first: { kind: 'boolean' }` beside `ui_locale` |
| `services/api/src/settings/settings.resolver.ts` | Modified | `defaultDateMonthFirst` query |
| `services/api/src/settings/settings.resolver.spec.ts` | Modified | Guard wiring + value mapping cases |
| `services/api/src/users/entities/user.entity.ts` | Modified | `dateMonthFirst` field |
| `services/api/src/users/users.service.ts` | Modified | `setDateMonthFirst(userId, monthFirst)` |
| `services/api/src/auth/auth.resolver.ts` | Modified | `setDateMonthFirst` mutation |
| `services/api/src/schema.gql` | Regenerated | Never hand-edited (Article IV) |

## Existing code to reuse

- `services/api/src/auth/auth.resolver.ts` `setUiLocale` — the exact shape of the new mutation:
  `@UseGuards(JwtAuthGuard)`, `@CurrentUser()`, the `principal.type !== 'user'` refusal with
  `ERROR_KEYS.AUTH_UNAUTHENTICATED`, delegation to `UsersService`. `AuthModule` already provides
  `UsersService` for this reason.
- `services/api/src/users/users.service.ts` `setAllowCinemaReleases` — the single-field
  `prisma.user.update` with no pre-validation; `setDateMonthFirst` is the same body on
  `dateMonthFirst`.
- `AuthService.getProfile` (`src/auth/auth.service.ts`) reads the whole row minus `password`, so
  `me` returns the new column with no change there.
- `services/api/src/settings/settings.resolver.ts` `defaultUiLocale` — reads
  `settingsService.getMap()` and narrows the raw string. Copy the body, **not** its `@Public()`.
  Guards in this resolver are per method; the global `APP_GUARD` (`JwtAuthGuard`) already makes
  an undecorated method authenticated for any user, which is what this query needs.
- `SettingsService.updateMany` already rejects any `kind: 'boolean'` value that is not `"true"` /
  `"false"` with `error.setting.expected_boolean` — AC-7 needs no new validation.
- `prisma/seeds/settings.ts` is create-only, so an existing installation gains the row as `""` on
  next boot and an existing value is never overwritten.

## Steps

1. Add `dateMonthFirst Boolean?` to `User` in `schema.prisma`, no default, with a
   `// Spec 096, REQ-3 NFR-1` locator rather than prose. Run `bin/npm api run prisma:migrate -- --name add_user_date_month_first`.
2. Add `date_month_first: { kind: 'boolean' }` to `SETTINGS_CATALOG` and the `""` seed row, both
   next to `ui_locale`.
3. `User` entity: `@Field(() => Boolean, { nullable: true, description: … }) dateMonthFirst?:
   boolean | null`, description as in the spec SDL.
4. `UsersService.setDateMonthFirst(userId: string, monthFirst: boolean): Promise<User>` with a
   `// Spec 096, REQ-3` locator.
5. `AuthResolver.setDateMonthFirst(@Args('monthFirst') monthFirst: boolean)` returning `User`,
   description `Sets the caller's own date order. Never another user's.`, locator
   `// Spec 096, REQ-3 NFR-4`.
6. `SettingsResolver.defaultDateMonthFirst(): Promise<boolean | null>` —
   `@Query(() => Boolean, { name: 'defaultDateMonthFirst', nullable: true, description: … })`,
   returning `true` for `"true"`, `false` for `"false"`, `null` for anything else (including `""`
   and a missing key). Locator `// Spec 096, REQ-2 REQ-4`.
7. Tests (below), then regenerate `schema.gql` by booting `api` and confirm its diff is exactly the
   three SDL additions in `../spec.md`.

## Contract obligations

Expose exactly the SDL in `../spec.md` § GraphQL Contract Delta: `User.dateMonthFirst: Boolean`,
`Query.defaultDateMonthFirst: Boolean`, `Mutation.setDateMonthFirst(monthFirst: Boolean!): User!`.
Error conditions are all existing ones — `error.setting.expected_boolean`,
`error.auth.admin_required` (via `updateSettings`), and the authentication refusal. Add no new
error key. The delta is read-only; if it looks wrong, stop and report.

## Tests

- `src/settings/settings.resolver.spec.ts`, guard-wiring suite — add: `defaultDateMonthFirst` is
  neither `@Public()` nor behind `AdminGuard`. Defends against a copy-pasted `@Public()` (silently
  widened anonymous surface) or a class/method `AdminGuard` (every non-admin's read fails, `web`
  swallows it and the installation setting silently does nothing for them).
- `src/settings/settings.resolver.spec.ts`, a new `describe` for the value mapping — `"true"` →
  `true`, `"false"` → `false`, `""` → `null`, missing key → `null`, `"yes"` → `null`. Defends
  against an unset row read as `false`, which forces day-first on every `en` user with no error
  anywhere (spec REQ-5). The new `describe` opens with its own Article IX header.
- `UsersService.setDateMonthFirst` and `AuthResolver.setDateMonthFirst` — **not owed**: a
  single-field update with no branch; a bug there fails loudly in the AC-4/AC-5 manual pass.

## Done when

```bash
bin/npm api run test
bin/cli api npx tsc --noEmit
bin/comments api
git status --short services/api/prisma
```

Tests and typecheck pass; `bin/comments api` passes; `git status` shows `schema.prisma` modified
and exactly one new migration directory; the regenerated `schema.gql` diff is the three additions
and nothing else.

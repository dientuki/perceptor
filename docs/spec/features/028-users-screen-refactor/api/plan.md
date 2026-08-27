---
title: Users screen refactor — api slice
service: api
last_updated: 2026-08-26
status: Approved
---

# PLAN: Users screen refactor — `api` (`api/plan.md`)

## Scope

This slice is one behavioural fix and its tests: `UsersService.update()` must refuse a username that
another user already holds, with the same conflict `create()` raises, instead of letting the write
hit Prisma's unique constraint and be reported as `error.user.not_found` (REQ-9).

Nothing else moves. No SDL change, no new error key, no resolver change, no guard change, **no Prisma
migration** — `git status services/api/prisma/` must be clean when this slice is done. The screen,
the modal, the icons and the message catalogs are entirely `web`'s (see `../web/plan.md`); this slice
neither knows nor cares that the caller is a modal.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/users/users.service.ts` | Modified | `update()` gains the duplicate-username check before the write. |
| `services/api/src/users/users.service.spec.ts` | Modified | Two cases added to the existing `update` describe block. |

## Existing code to reuse

- `services/api/src/users/users.service.ts` → `updateProfile()` — already performs exactly this
  check, in the shape this slice needs: `prisma.user.findUnique({ where: { username } })`, then
  `if (existingUser && existingUser.id !== userId) throw i18nError.conflict(...)`. The comment above
  it explains why the own-id allowance exists (a name-only edit keeping the current username must
  succeed). Copy that logic; do not invent a `count()`-based variant, and do not extract a shared
  helper — the two call sites differ in which id they compare against, and Article X asks for less
  code, not for a premature abstraction over two four-line blocks.
- `services/api/src/users/users.service.ts` → `create()` — the other precedent for the same
  conflict, and the reason `ERROR_KEYS.USER_USERNAME_TAKEN` already exists in
  `src/i18n/error-keys.ts` and `src/i18n/messages.en.ts`. Do not add a key.
- `services/api/src/i18n/i18n-error.ts` → `i18nError.conflict(key)` — the only way a user-facing
  exception is constructed in this service (`services/api/CLAUDE.md`).
- `services/api/src/users/users.service.spec.ts` — a real suite, not `nest g` scaffolding, and one of
  the two Article IX standards named in `docs/constitution.md`. Its `update` describe block already
  mocks `prisma.user.findUnique`/`update`/`count`; extend it, keep its header paragraph accurate.

## Steps

1. In `update()`, before the `isDisabling` safeguards run, add the duplicate-username check —
   **only when `dataToUpdate.username` is defined**. `setUserEnabledAction` sends `{ id, isEnabled }`
   with no username, and an unguarded `findUnique({ where: { username: undefined } })` would turn
   every enable/disable into a lookup that matches an arbitrary row.
2. Raise `i18nError.conflict(ERROR_KEYS.USER_USERNAME_TAKEN)` when the found row exists and its `id`
   is not the `id` being updated. A row whose id **is** the target's is that user keeping their own
   username — it must pass.
3. Leave the ordering of the existing self-disable and last-enabled-admin checks untouched relative
   to each other; they carry their own ordering requirement from `004-user-disable`. Placing the
   username check before them is fine (a rename request carries no `isEnabled`, and vice versa), but
   do not reorder the two that already exist.
4. Leave the blanket `try`/`catch` around `prisma.user.update` as it is. It still legitimately maps a
   missing row to `error.user.not_found`; this slice removes the one condition that was reaching it
   wrongly, it does not rewrite the catch.
5. Add the two test cases in step 6 below.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta — read-only. What this service owes:

- `updateUser` with a `username` another user holds → `ConflictException` carrying
  `extensions.i18n.key = "error.user.username_taken"` and the English message
  `That username is already registered`. This is the row marked **new** in the delta; today the same
  input produces `error.user.not_found`, which is the bug.
- Every other row of that table is existing behaviour and must still hold afterwards:
  `error.user.not_found` for a genuinely missing id, `error.user.cannot_disable_self`,
  `error.user.cannot_disable_last_admin`, `error.user.cannot_delete_self`,
  `error.user.cannot_delete_last_admin`, and the `error.validation.*` keys from `UpdateUserInput`.
- `UpdateUserInput` keeps `password` and `isEnabled`. `web` simply stops sending `password`; that is
  not this service's business and is **not** a reason to remove the field (`../plan.md` §
  Contract Freeze).

## Tests

`services/api/src/users/users.service.spec.ts` — owed under Article IX, and the failure is silent in
one direction. Getting the id comparison backwards lets two users end up sharing a username: no
exception, no log line, and the damage surfaces later at login, in a different module, as something
that looks like an auth bug.

Two cases in the existing `update` describe block:

- renaming a user to a username another user already holds throws `ConflictException` and never calls
  `prisma.user.update`;
- an update whose `username` equals the target's own current username (the `findUnique` mock
  returning a row with the same `id`) reaches `prisma.user.update` and succeeds.

Do not add a third case for `username: undefined` alone — the existing enable/disable cases already
exercise that path, and step 1's guard is what keeps them green. If they go red, the guard is
missing.

`users.resolver.ts` is untouched and is owed nothing; `users.resolver.spec.ts` is the 18-line
scaffolding Article IX names explicitly — do not extend it.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
git status --short services/api/prisma/
```

`tsc` prints nothing, the suite is green with the `UsersService` block grown by exactly two cases and
none lost, and `git status` on `prisma/` prints nothing at all.

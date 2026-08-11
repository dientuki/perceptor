---
title: Disable Users
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-11
last_updated: 2026-08-11
status: Draft
services: [api, web]
---

# SPEC: Disable Users (`spec.md`)

> Depends on `003-auth-user-management` being implemented — this feature adds one more state to
> the `User` row `003` introduced, and rides the same `/users` screen, the same `AdminGuard`, and
> the same `updateUser` mutation. It also touches session revocation, which `002-auth-login`
> defined and deliberately scoped down (see § GraphQL Contract Delta below).

## Context & Goal

`003-auth-user-management` gave the administrator create/list/delete over `User` rows, but no way
to temporarily take a user's access away without destroying the row. Today the only lever is
`removeUser`, which is permanent and loses the account's history. An administrator who wants to
suspend someone — an employee who left, a shared household account being paused — has no option
short of deleting them outright.

This feature adds a second boolean to `User`, `isEnabled`, alongside the `isAdmin` that `003`
added. A disabled user cannot start a new session (the `login` mutation refuses them), and — this
is the part that is new work, not just a flag — an *already open* session is killed immediately:
disabling a user revokes every session they currently hold, not just the next one they try to
open. Re-enabling them lifts the restriction with no other side effect; nothing about their row,
their sessions before the disable, or their admin status changes.

The toggle lives on the same `/users` screen `003` built (`services/web/src/app/(dashboard)/users/`
+ `src/components/users/UsersManager.tsx`), next to the existing delete button, and rides the
`updateUser` mutation that already exists rather than adding a new one.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (The state is a property of the row)**: A user must be markable as disabled in a way
      that survives everything else about that row — renaming, promoting/demoting admin status,
      restoring a backup. Every existing user, on the migration that introduces the column, must
      come out enabled — nobody gets locked out by upgrading.
- [ ] **REQ-2 (Disabled means no new session)**: The `login` mutation must refuse a disabled user's
      credentials, even if the username and password are correct, with a distinct message (see
      § GraphQL Contract Delta § Errors) — not the generic wrong-credentials message.
- [ ] **REQ-3 (Disabled kills the session, not just the next login)**: The moment an administrator
      disables a user, every session that user currently holds — however many browsers or devices
      they're signed in on — must stop working on its very next request. A user who is mid-session
      when disabled must not get to keep using the app until their token happens to expire.
- [ ] **REQ-4 (Only the admin toggles it)**: Enabling or disabling a user is an admin-only action,
      through the same `AdminGuard` that already gates every `users` operation. No new guard.
- [ ] **REQ-5 (Nobody can lock the app via disable)**: An administrator must not be able to disable
      themselves, and must not be able to disable the last *enabled* administrator. Both attempts
      must fail with an explanation rather than succeeding. This is `003`'s REQ-5 for delete,
      extended to disable — including the same ordering lesson `003` documented: the last-admin
      check must count only enabled admins, or a lone remaining admin can be locked out by
      disabling every admin but themselves one at a time.
- [ ] **REQ-6 (The screen shows and controls it)**: The `/users` table must show whether each user
      is enabled or disabled, and let the administrator toggle it per row, from inside the same
      screen `003` built. Toggling the current administrator's own row must be disabled in the UI,
      matching how the delete button already handles the caller's own row.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No backfill needed)**: Unlike `003`'s `isAdmin` column, the new column's default
      (`true`) is already the correct value for every existing row — the migration needs no
      backfill `UPDATE`, only the `ALTER TABLE`.
- [ ] **NFR-2 (Language)**: UI copy and API exception messages in Spanish; code, comments,
      identifiers and test descriptions in English (Constitution, Article VI).
- [ ] **NFR-3 (Silent failure is not acceptable here)**: A disable that doesn't actually revoke a
      live session is exactly the failure Constitution Article IX exists for — nothing errors
      anywhere, the administrator believes the user is locked out, and they aren't. This must be
      covered by a test, not just a manual check.

## GraphQL Contract Delta

Frozen once `status: Approved` (Constitution, Article VIII). No new operations — the toggle rides
the `updateUser` mutation `003` already shipped.

```graphql
type User {
  isEnabled: Boolean!
}

input UpdateUserInput {
  isEnabled: Boolean
}
```

That is the entire schema delta. Two notes on what this deliberately does **not** do, matching how
`003` scoped `isAdmin`:

- **`isEnabled` is not on `CreateUserInput`.** A user is always created enabled; disabling is a
  separate, later action. `UpdateUserInput` gets the field directly (not via
  `PartialType(CreateUserInput)`, which is how `UpdateUserInput` is defined today) specifically so
  it can exist on update without also becoming createable — same reasoning `003` used to keep
  `isAdmin` off `CreateUserInput`.
- **No dedicated `setUserEnabled` mutation.** `updateUser` already accepts a partial input and
  already requires `AdminGuard`; a second mutation for one boolean would be a second thing to keep
  in sync with the first.

### Errors

| Condition | GraphQL / HTTP error | Message the user sees |
| :-- | :-- | :-- |
| Correct credentials, account disabled | `UnauthorizedException` | `Tu cuenta está deshabilitada` |
| Admin attempts to disable their own account | `BadRequestException` | `No podés deshabilitar tu propio usuario` |
| Admin attempts to disable the last enabled administrator | `BadRequestException` | `No podés deshabilitar al único administrador` |

**This amends `002-auth-login`'s frozen error table**, not `003`'s. `002`'s § Errors (its `spec.md`,
"Errors" subsection under its own GraphQL Contract Delta) lists exactly five user-facing strings
from the login/session boundary and both `jwt-auth.guard.ts` and `auth.resolver.ts` carry comments
referencing that freeze as a count of five. `Tu cuenta está deshabilitada` is a sixth. `002` itself
is not edited — Constitution Article VIII freezes a shipped, `Implemented` spec, and reopening it
to add a requirement it never had would erase what its own `status: Implemented` and ticked AC
boxes currently attest to. Its own file gets, at most, a one-line dated pointer forward to this
feature, the same convention `003` used for its own dependency on `002` (see this spec's header
blockquote). The two `No podés deshabilitar…` messages are new strings on the `users` boundary,
which is `003`'s territory, not `002`'s — no amendment needed there, they're simply new since that
boundary wasn't frozen shut, only its existing five operations' *shape* was.

**Deliberately not a new message**: there is no distinct string for "no encontramos ese usuario"
vs. "cuenta deshabilitada" at login time. Wrong username, wrong password, and a disabled account
all reach different code paths internally, but only the disabled case gets a distinct message here
— username/password enumeration protection (why wrong-username and wrong-password already share
one message) does not extend to "is this account disabled," since telling a legitimate user their
own account is disabled is far more useful than it is a leak, and this app is self-hosted for a
small, known set of users, not a public multi-tenant service.

What `web` does with each: the `login` server action already renders `state.error` inline on the
sign-in form (`LoginForm.tsx`) — the new message needs no new UI, only a passthrough, same as every
other login error today. The two disable-refusal messages render through the same inline-error
path `UsersManager.tsx` already uses for delete failures.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `User` | `+ isEnabled Boolean` | `NOT NULL DEFAULT true` | No — the default is already correct for every existing row (NFR-1) |

Also touches Redis, not Prisma: `SessionService` currently stores only a forward mapping
(`session:<jti> -> userId`), enough for `logout` to revoke one session by its own `jti`. This
feature needs the reverse — "every session this user currently holds" — to make REQ-3 possible.
That is a new Redis key shape (a per-user set of live `jti`s), not a new service; `002`'s own
`spec.md` explicitly scoped "no listing of active sessions, no per-device revocation" as **out of
scope for that feature**, not as forbidden forever — see this spec's header blockquote and the
§ Errors note above for why extending it here doesn't reopen `002`.

## Acceptance Criteria

- [ ] **AC-1**: On a fresh database, `bin/mysql -e 'select username, isEnabled from users'` shows
      every seeded user with `isEnabled = 1`.
- [ ] **AC-2**: On a database that already had users before the migration, the same query shows
      every existing row with `isEnabled = 1` after `bin/cli api npx prisma migrate deploy` — no
      row silently becomes disabled by upgrading.
- [ ] **AC-3**: Signed in as the administrator, toggling a user to disabled in `/users` updates
      that row's status in the table with no page error, and toggling it back to enabled does the
      same.
- [ ] **AC-4 (failure path)**: That disabled user attempting to sign in with their correct
      password is refused with `Tu cuenta está deshabilitada`, not `Credenciales inválidas`.
- [ ] **AC-5 (failure path)**: A user who is already signed in, in a *different* browser session,
      at the moment an administrator disables them: their very next request in that session fails
      and they are redirected to `/login` — not merely their next login attempt, an already-open
      session actively in use.
- [ ] **AC-6 (failure path)**: The administrator attempting to disable their own account is refused
      with `No podés deshabilitar tu propio usuario`, and their account remains enabled afterwards.
- [ ] **AC-7 (failure path)**: With exactly one *enabled* administrator in the database (a second,
      already-disabled administrator may also exist), attempting to disable that one remaining
      enabled administrator is refused with `No podés deshabilitar al único administrador`.
- [ ] **AC-8**: Re-enabling a previously disabled user lets them sign in again with their existing
      password — disabling and re-enabling does not touch the password hash or any other field.

## Out of Scope

- **Deleting a disabled user.** `removeUser`'s existing self-delete/last-admin safeguards are
  untouched by this feature; a disabled user can still be deleted like any other, subject to those
  same rules. This feature adds no new interaction between "disabled" and "delete."
- **An audit trail of who disabled whom, or when.** Same boundary `003` already drew for deletion;
  extending it to disable is a different feature.
- **Automatic disabling** (inactivity timeout, failed-login lockout, expiry date). This feature is
  the manual admin-operated toggle only.
- **Listing a user's active sessions, or revoking one specific session while leaving others.** The
  per-user Redis set this feature adds is enough to revoke *all* of a user's sessions at once; it
  is deliberately not a general session-management feature. Per-device visibility/revocation stays
  out of scope, exactly as `002` originally scoped it.
- **A "disabled" filter or search on the `/users` table.** The table lists everyone regardless of
  state; sorting/filtering the list is a UI nicety this feature doesn't need to ship.

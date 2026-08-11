---
title: Disable Users — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-11
status: Implemented
---

# PLAN: Disable Users (`plan.md`)

## Approach

Four seams, none of which invents anything at the architecture level — every one of them extends
something `002-auth-login` or `003-auth-user-management` already built.

1. **`api` — the column.** `isEnabled Boolean @default(true)` on `User`, one `ALTER TABLE` with no
   backfill (NFR-1: the default is already the right value for every existing row). The field is
   declared **directly** on `UpdateUserInput` rather than inherited through
   `PartialType(CreateUserInput)`, which is how that DTO is built today — that is the whole
   mechanism by which `isEnabled` becomes updateable without also becoming createable. Same
   reasoning `003` used to keep `isAdmin` off `CreateUserInput`.
2. **`api` — the revocation.** `src/auth/session.service.ts` stores only a forward mapping today
   (`session:<jti> -> userId`), which answers "is this one session live?" and nothing else. REQ-3
   needs the reverse — "every session this user holds" — so the service gains a per-user Redis SET
   (`user-sessions:<userId>`) of live `jti`s and a `revokeAllForUser(userId)`. **No new service and
   no new module**: this is three methods on the class that already owns session state.
   Revocation happens at the moment the administrator saves the change, not on every request — the
   alternative (re-reading `isEnabled` from the database inside `JwtStrategy`) would satisfy REQ-3
   too, but at the cost of one database query per GraphQL operation in the entire system, to defend
   against an action that happens a handful of times in the app's life.
3. **`api` — the safeguards.** `update()` gains the two REQ-5 checks in the same order `remove()`
   already uses (self first, last-admin second), so a lone administrator disabling themself sees the
   "your own account" message rather than the "last admin" one. The last-admin `count` filters on
   `{ isAdmin: true, isEnabled: true }` — counting disabled admins would let someone disable every
   admin but themself one at a time and lock the app (REQ-5 spells this out).
4. **`web` — one action and one cell.** `setUserEnabledAction` in `src/actions/users.ts`, shaped
   exactly like the `deleteUserAction` sitting next to it, and a status column with a per-row toggle
   in `src/components/users/UsersManager.tsx`, disabled on the caller's own row the same way the
   delete button already is.

**Reused, not reinvented** — each of these already exists and must not grow a sibling:
`SessionService` (`services/api/src/auth/session.service.ts`), `AdminGuard`
(`services/api/src/auth/guards/admin.guard.ts`), the `updateUser` mutation itself,
`@CurrentUser()` (`services/api/src/auth/decorators/current-user.decorator.ts`) as `removeUser`
already consumes it, `RedisService` (`services/api/src/redis/redis.service.ts` — it extends
`ioredis`, so `sadd`/`smembers`/`srem`/`expire` are already available with no wrapper), the server
action shape of `services/web/src/actions/settings.ts`, and `ERROR_CLASS` in `UsersManager.tsx` for
the inline error.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the column, the migration, the frozen field, and the revocation the whole feature exists for |
| 2 | `web` | Cannot render `isEnabled` or send it through `updateUser` before the schema has it |

**Nothing runs in parallel across services here.** Within `api`, the `SessionService` work (seam 2)
is independent of the DTO work (seam 1) and could overlap, but both land in the same slice and the
same agent, so the sequencing in `tasks.md` is by dependency, not by concurrency.

## Contract Freeze

`## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`: `isEnabled: Boolean!`
on `User`, `isEnabled: Boolean` on `UpdateUserInput`. Nothing else. Four things an implementer will
be tempted to change and must not:

- **`isEnabled` does not go on `CreateUserInput`.** A user is always created enabled. The moment it
  becomes createable, the `/users` create form grows a field the feature never asked for, and the
  "always created enabled" invariant stops being an invariant.
- **There is no `setUserEnabled` mutation.** `updateUser` already takes a partial input and already
  sits behind `AdminGuard`. A second mutation for one boolean is a second thing to keep in sync
  with the first, forever.
- **`updateUser` gains no GraphQL argument for "who is asking".** The resolver reads the caller
  from `@CurrentUser()`, exactly as `removeUser` does today. The SDL of `updateUser` changes only
  by the new optional input field.
- **`Tu cuenta está deshabilitada` is a deliberate sixth user-facing string** on the login boundary,
  not an oversight — see `spec.md` § Errors for why enumeration-protection does not extend to it.
  Do not fold it into `Credenciales inválidas`.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief both services
(Constitution, Article VIII). Never patch it from inside one slice.

## Migrations

Owned by `api`.

1. `<timestamp>_add_user_is_enabled` — `ALTER TABLE users ADD COLUMN isEnabled BOOLEAN NOT NULL
   DEFAULT true`, generated through `bin/npm api run prisma:migrate` (Article III: schema change and
   migration directory land together, never one without the other).
2. Backfill: **none**. The column default is already correct for every existing row (NFR-1). This is
   the one place this feature is simpler than `003`, which needed an `UPDATE` to mark an admin.
   Verified by AC-2, not assumed: run the migration against a database that already had users and
   confirm every row reads `isEnabled = 1`.

The seed (`prisma/seeds/users.ts`) needs no change — it does not set `isEnabled`, so the column
default applies and AC-1 holds on a fresh database for free. Confirm rather than assume.

Reversibility: the column can be dropped; nothing references it by foreign key. But a rollback of
the migration must ship with a rollback of the `login` check and the `update()` safeguards — left
in place against a dropped column they would read `undefined`, and `!user.isEnabled` would then
refuse *every* login. Rolling back half of this feature locks everyone out.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Disabling does not actually revoke the live session | **Silent** — nothing errors anywhere, the administrator sees the row flip to "Deshabilitado" and believes the user is locked out while that user keeps browsing. This is exactly NFR-3 / Constitution Article IX | `session.service.spec.ts` covers `revokeAllForUser` against the real Redis (the key must actually be gone, which is how the existing suite in that file is already written), plus AC-5 walked manually in a second browser |
| The last-admin check counts disabled administrators | **Silent** — each individual disable succeeds, and the app ends up with zero enabled admins and no way back in short of `bin/reset-password` | The `count` filters `{ isAdmin: true, isEnabled: true }`. REQ-5 states this explicitly; `users.service.spec.ts` covers the AC-7 shape (one enabled admin, one already-disabled admin) |
| The per-user Redis SET accumulates `jti`s whose sessions already expired | Not a correctness failure — the `session:<jti>` keys are gone, so `revokeAllForUser` deletes nothing that matters — but the set grows without bound for a long-lived account | `revoke(jti)` does the matching `SREM`, and the set carries its own TTL refreshed on every `create`. An expired member is inert, never a resurrected session |
| The greyed-out toggle on the admin's own row is mistaken for the control | A caller bypassing the UI would disable themself | The real control is server-side; AC-6 asserts the exact server message, not the disabled button. Same split `003` drew for delete |
| `UsersModule` reaching `SessionService` introduces a module cycle | Boot-time failure, loud, not silent | `AuthModule` does not import `UsersModule` (`AdminGuard` talks to `PrismaService` directly), so exporting `SessionService` from `AuthModule` and importing it in `UsersModule` is acyclic. Verified by the app booting, which the typecheck alone will not prove |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
```

Baseline to match, measured 2026-08-10: `api` **0** typecheck errors and **64** tests across 8
suites (this feature adds tests, so the count must go *up*, never down); `web` **12** errors across
the same 5 pre-existing pre-GraphQL files listed in `services/web/CLAUDE.md`.

Then the manual pass, walking `spec.md`'s acceptance criteria in order:

- **AC-1** — fresh database: `bin/mysql -e 'select username, isEnabled from users'` → every seeded
  user at `1`.
- **AC-2** — database that already had users: `bin/cli api npx prisma migrate deploy`, then the same
  query → every pre-existing row at `1`.
- **AC-3** — signed in as admin, toggle a user off and back on in `/users`; the row's status changes
  both ways with no page error.
- **AC-4** — that disabled user signs in with their correct password → `Tu cuenta está
  deshabilitada`, not `Credenciales inválidas`.
- **AC-5** — sign that user in first (second browser or private window), confirm they can load a
  page, then disable them from the admin's session; their **very next** request in the open session
  redirects to `/login`. This is the one that cannot be signed off by reading code.
- **AC-6** — admin toggles their own row through the API directly (the UI button is disabled) →
  `No podés deshabilitar tu propio usuario`, and `bin/mysql -e 'select username, isEnabled from
  users'` shows their row still at `1`.
- **AC-7** — with exactly one enabled admin plus a second, already-disabled admin, disabling the
  enabled one → `No podés deshabilitar al único administrador`.
- **AC-8** — re-enable the AC-4 user; they sign in with the same password they always had.

If any acceptance criterion cannot be reached from this section, this plan is incomplete.

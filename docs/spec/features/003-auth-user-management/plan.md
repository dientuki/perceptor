---
title: Admin User Management — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-10
status: Approved
---

# PLAN: Admin User Management (`plan.md`)

## Approach

Three independent seams, all off the existing `users` module and the existing `auth/` guard
infrastructure — nothing new is invented at the architecture level:

1. **`api` — authorization.** `users.resolver.ts`'s five operations already require *a* session
   (`JwtAuthGuard` as `APP_GUARD`, from `002`). This feature adds a second, narrower guard —
   `AdminGuard` — that checks `isAdmin` fresh from the database on every call, applied once at
   class level. It deliberately does **not** put `isAdmin` in the JWT: a demoted admin's
   still-valid session would otherwise keep working until the token expires. The boolean itself is
   a plain column, not a role table — see `spec.md`'s Data Model Changes for why.
2. **`api` — irreversible actions get a rule.** `remove()` gains two checks ahead of the delete
   (self-delete, last-admin), and `update()` gets the hash fix that `create()` already had. Same
   service method, no new module.
3. **`web` — a screen.** Reuses the exact `services/web/src/actions/settings.ts` server-action
   shape (documented in `docs/spec/graphql-contract.md` § *The web server-action pattern*) for
   `users.ts`, and the `(dashboard)/settings/page.tsx` card-with-`PageBreadcrumb` shape for the new
   `/users` route. No new UI primitives.
4. **`infra` — the recovery path.** `bin/reset-password` is a one-line wrapper over `bin/cli`, the
   same shape as every other script in `bin/`. This is also the change that retires the
   `[orch]`-catch-all gap noted in `002`'s own process note and `003`'s original draft: a fourth
   agent, `infra`, now owns `bin/`/`docker-compose.yaml`/`.env.example` instead of the orchestrator
   doing it by hand.

**Reused, not reinvented:** `AuthPrincipal`/`toPrincipal()` (`services/api/src/auth/auth.types.ts`),
`CurrentUser` decorator, the `JwtAuthGuard` short-circuit pattern it copies structurally
(`services/api/src/auth/guards/jwt-auth.guard.ts`), `fetchGraphQL` + `redirectIfUnauthenticated`
(`services/web/src/lib/graphql-client.ts`, `src/lib/auth-session.ts`), and the inline-error render
style already in `LoginForm.tsx`/`SettingsForm.tsx`.

## Order of Work

| Step | Service | Why it must come here | Status |
| :-- | :-- | :-- | :-- |
| 1 | `api` | Owns the schema (`isAdmin` column), the migration, and the guard everything else depends on | **Done** — see `api/plan.md` |
| 2 | `web` | Cannot render `isAdmin` or call an admin-gated mutation before the column and guard exist | `isAdmin` plumbing done; screen still open — see `web/plan.md` |
| 3 | `infra` | `bin/reset-password` wraps `scripts/reset-password.ts`, which must exist first | Blocked on the `isTTY` fix below |

Steps 2 and 3's remaining work can run in parallel — the contract is frozen (`isAdmin: Boolean!`,
no new operations) and neither depends on the other's files.

## Contract Freeze

`## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`: one additive field,
`isAdmin: Boolean!` on `User`. No new operations — `users`, `user`, `createUser`, `updateUser`,
`removeUser` keep their exact SDL and change only in who can reach them.

- **`removeUser`'s signature does not change.** The temptation is to add a second argument for "who
  is asking" — don't. The resolver already has the caller via `@CurrentUser()`; `id` stays the only
  GraphQL argument (see `users.resolver.ts`, already implemented this way).
- **No `isAdmin` argument on `createUser`.** The screen can only ever create ordinary users; making
  someone else an administrator is not a UI this feature builds (see spec's Out of Scope). If a
  future feature needs it, that is `updateUser`, which already accepts a `PartialType` and needs no
  contract change.

## Migrations

**Already applied and verified** (see `api/plan.md` for the full report):

1. `20260810224010_add_user_is_admin` — `ALTER TABLE users ADD COLUMN isAdmin BOOLEAN NOT NULL
   DEFAULT false`, plus a backfill `UPDATE` marking the oldest user (by `createdAt`) as admin.
2. Backfill verified live: `bin/mysql -e 'select username, isAdmin from users'` showed `admin` /
   `isAdmin = 1` after `prisma migrate deploy`. The seed (`prisma/seeds/users.ts`) also now forces
   `isAdmin: true` on both `create` and `update`, so re-running it repairs any install that somehow
   ends up with zero admins.

Reversibility: the column can be dropped with a down-migration; nothing else in the schema
references it (no foreign key). Rolling it back re-opens `users`/`user`/`createUser`/`updateUser`/
`removeUser` to any authenticated caller, since `AdminGuard` would then read `isAdmin: undefined`
from every row and refuse everyone — a rollback of the migration must ship with a rollback of the
guard, not just the column.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A future feature reads `isAdmin` off the JWT instead of the database | Silent — a demoted admin keeps full access until the token expires (up to 30 days with "keep me logged in") | `AdminGuard` deliberately never puts `isAdmin` in the payload; documented in the guard's own header comment. Any future shortcut here is a regression to catch in review, not something the type system flags. |
| `reset-password.ts`'s `promptHidden` hangs on non-tty stdin | No error — the process sits forever after printing both prompts; nothing is written, so at least it fails closed rather than corrupting the password | Fix before this feature closes (see `api/plan.md` § Remaining work): fall back to plain `rl.question` when `!process.stdin.isTTY`. AC-10/AC-11 cannot be signed off until this is verified live through `bin/reset-password`, not just `ts-node` directly. |
| `/users` page is reachable by a non-admin who guesses the URL | `AdminGuard` refuses the underlying queries (AC-5 is the real control), but if the page component forgets its own `notFound()` check, a non-admin sees a broken/empty screen instead of a clean 404 | `web/plan.md` requires `getCurrentUser().isAdmin` checked server-side in `page.tsx` before rendering `UsersManager`, in addition to (not instead of) the guard |
| Sidebar hides `/users` from non-admins, but that's cosmetic | None — this is explicitly REQ-2 doing the real work, REQ-4 doing usability | AC-5 tests the API path directly, not the hidden link, precisely so this isn't mistaken for the control |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
```

Then the manual pass, walking `spec.md`'s acceptance criteria in order:

- **AC-1/AC-2** — `bin/mysql -e 'select username, isAdmin from users'` (done, see `api/plan.md`).
- **AC-3/AC-4/AC-6** — sign in as admin, `/users` lists and creates; sign in as the new user, no
  entry point, direct nav to `/users` 404s.
- **AC-5** — `curl`/GraphQL playground with the non-admin's token against `createUser` →
  `No tenés permisos para administrar usuarios`.
- **AC-7/AC-8** — attempt self-delete, then attempt deleting the sole remaining admin.
- **AC-9** — `/signup` 404s, no "Sign Up"/"Forgot password?" link on `/login` (done).
- **AC-10/AC-11** — `bin/reset-password admin`, then sign in with the new password;
  `bin/reset-password doesnotexist` prints an error and changes nothing.

If any acceptance criterion cannot be reached from this section, this plan is incomplete.

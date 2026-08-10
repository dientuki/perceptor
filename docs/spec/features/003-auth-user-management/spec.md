---
title: Admin User Management
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-09
last_updated: 2026-08-09
status: Draft
services: [api, web]
---

# SPEC: Admin User Management (`spec.md`)

> Depends on `002-auth-login` being implemented. Without a guard that distinguishes an authenticated
> caller, "only the admin can do this" has nothing to stand on.

## Context & Goal

The sign-up screen at `services/web/src/app/(auth)/signup/` is the TailAdmin template, untouched.
Its `<form>` has no `action`, its password input has no `name`, it collects `fname`/`lname` when
`CreateUserInput` wants `name`/`username`/`password`, and it offers "Sign up with Google" and "Sign
up with X" buttons wired to nothing. It cannot create a user and never could. Meanwhile
`services/web/src/proxy.ts` does not list `/signup` in `AUTH_ROUTES`, so it is treated as a
protected route — you have to be signed in to reach the registration page.

On the API side the opposite is true: `createUser` works perfectly and is completely open, as are
`users`, `user`, `updateUser` and `removeUser` (`services/api/src/users/users.resolver.ts`). Once
`002` puts a guard in front of them they become authenticated-only, which is a large improvement and
still not what this app wants. Perceptor is self-hosted and seeds a single administrator from
`ADMIN_USER`/`ADMIN_PASSWORD`; account creation belongs to that person, not to anyone holding a
session.

This feature deletes public registration outright and replaces it with an administrator screen
inside the dashboard. It marks the administrator with a single `isAdmin` boolean on `User` — not a
role enum, not a permission matrix, because the app has exactly one privileged operation set and a
column that survives a username change is all that is needed to anchor it. It also adds
`bin/reset-password`, which is the only password recovery this app will have: there is no SMTP in
the stack, and an admin who is locked out currently has no path back short of re-seeding the
database. No pipeline stage in the root `CLAUDE.md` changes status.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (The admin is a property of the row)**: A user must be markable as administrator in a
      way that survives renaming that user, restoring a backup, and the existence of other users.
      The seeded `ADMIN_USER` is the administrator on a fresh install.
- [ ] **REQ-2 (Only the admin manages users)**: Listing, creating, updating and deleting users must
      require being the administrator. An ordinary authenticated session must be refused.
- [ ] **REQ-3 (No public registration)**: The public sign-up route, its form component and the link
      to it from the sign-in screen must be gone. There must be no reachable path for an
      unauthenticated visitor to create an account.
- [ ] **REQ-4 (A screen to do it)**: The administrator must be able to see the list of users, create
      one and delete one, from inside the authenticated dashboard. Non-administrators must not see
      the entry point at all — hiding it is a usability requirement; REQ-2 is what enforces it.
- [ ] **REQ-5 (Nobody can lock the app)**: A user must not be able to delete themselves, and the
      last administrator must not be deletable. Both attempts must fail with an explanation rather
      than succeeding. Without this the only recovery is re-seeding the database.
- [ ] **REQ-6 (Duplicate usernames are explained)**: Creating a user with a username that already
      exists must show the user why it failed. The API already produces the right message
      (`services/api/src/users/users.service.ts`); this requirement is that it reaches the screen
      instead of surfacing as a generic failure.
- [ ] **REQ-7 (Password recovery from the host)**: An administrator locked out of the app must be
      able to set a new password from the host, without editing the database by hand and without a
      running web session. The new password must be stored the same way the application stores it.
- [ ] **REQ-8 (No dead links)**: The `/reset-password` link on the sign-in form must go, since no
      such route exists or will exist.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Existing installs keep their admin)**: The migration must leave the already-seeded
      administrator as administrator. An install that upgrades and finds nobody privileged is
      locked out of its own user management.
- [ ] **NFR-2 (Language)**: UI copy and API exception messages in Spanish; code, comments,
      identifiers and test descriptions in English (Constitution, Article VI).
- [ ] **NFR-3 (Docker-first)**: The new script goes through the container like every other `bin/`
      wrapper. It must not require Node, Prisma or bcrypt on the host (Constitution, Article I).

## GraphQL Contract Delta

Frozen once `status: Approved` (Constitution, Article VIII).

```graphql
type User {
  id: ID!
  name: String!
  username: String!
  isAdmin: Boolean!
}
```

**That is the entire delta.** One additive, non-null field on an existing type.

No new operations: `users`, `user`, `createUser`, `updateUser` and `removeUser` already exist with
exactly the shape this feature needs, and `CreateUserInput` already validates (`MinLength(3)` on
username, `MinLength(6)` on password). Writing "the contract does not change" down is the point of
the freeze — it is what stops the `web` implementer from inventing a `createAdmin` mutation or an
extra field, and stops the `api` implementer from adding one to be helpful.

`isAdmin` reaches `web` through `me` (defined in `002`), which is how the UI decides whether to
render the entry point.

### The part the schema cannot express

As in `002`, the significant change is accessibility, not shape. These five operations keep their
exact SDL and start refusing authenticated non-administrators:

| Operation | Before this feature | After |
| :-- | :-- | :-- |
| `users`, `user` | Any authenticated caller (after `002`) | Administrator only |
| `createUser`, `updateUser`, `removeUser` | Any authenticated caller (after `002`) | Administrator only |

### Errors

| Condition | GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Authenticated, not an administrator | `ForbiddenException` | `No tenés permisos para administrar usuarios` |
| Username already taken | `ConflictException` | `El nombre de usuario ya está registrado` (already the string in `users.service.ts`) |
| Username shorter than 3 / password shorter than 6 | `BadRequestException` from the existing `ValidationPipe` | `El nombre de usuario debe tener al menos 3 caracteres` / `La contraseña debe tener al menos 6 caracteres` (already the strings in `create-user.input.ts`) |
| Deleting yourself | `BadRequestException` | `No podés eliminar tu propio usuario` |
| Deleting the last administrator | `BadRequestException` | `No podés eliminar al único administrador` |
| User id not found | `NotFoundException` | `Usuario con ID "…" no encontrado` (already the string in `users.service.ts`) |

`web` renders every one of these inline in the form or beside the list, in the style
`SignInForm` already uses for `state.error`. None of them is an `alert()` and none is a redirect.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `User` | Add `isAdmin Boolean` | Non-null, `@default(false)` | **Yes** — see NFR-1 |

The default of `false` means an existing install migrates to a state where **no user is an
administrator**, which locks user management for everyone. The backfill is therefore a requirement
and not an implementation detail: the migration, or the seed running alongside it, must mark the
existing `ADMIN_USER` as administrator. On a fresh database the seed
(`services/api/prisma/seeds/users.ts`) handles it in the same `upsert` that creates the user.

Deliberately **not** added: a `Role` enum, a permissions table, or an `isActive`/`lastLoginAt`
column. One boolean is the whole model this app needs; anything more is a different feature.

## Acceptance Criteria

- [ ] **AC-1**: On a fresh database, `bin/mysql -e 'select username, isAdmin from users'` shows the
      seeded `ADMIN_USER` with `isAdmin = 1`.
- [ ] **AC-2**: On a database that already had users before the migration, the same query shows the
      `ADMIN_USER` row with `isAdmin = 1` after `bin/cli api npx prisma migrate deploy`.
- [ ] **AC-3**: Signed in as the administrator, the user management screen lists the existing users,
      and creating one adds it to the list without a page error.
- [ ] **AC-4**: The newly created (non-administrator) user can sign in and use the app, and does not
      see the user management entry point.
- [ ] **AC-5 (failure path)**: That non-administrator user issuing `createUser` directly against
      `/graphql` with their own valid token is refused with `No tenés permisos para administrar
      usuarios`. Hiding the UI is not the control; this is the test that proves it.
- [ ] **AC-6 (failure path)**: Creating a user with an existing username shows `El nombre de usuario
      ya está registrado` inline. Creating one with a 2-character username or a 5-character password
      shows the corresponding validation message.
- [ ] **AC-7 (failure path)**: The administrator attempting to delete their own account is refused
      with `No podés eliminar tu propio usuario`, and the account still exists afterwards.
- [ ] **AC-8 (failure path)**: With exactly one administrator in the database, deleting that
      administrator is refused with `No podés eliminar al único administrador`.
- [ ] **AC-9**: `/signup` returns a 404, `SignUpForm.tsx` no longer exists in the repo, and the
      sign-in screen shows neither a "Sign Up" link nor a "Forgot password?" link.
- [ ] **AC-10**: `bin/reset-password <username>` sets a new password, and that password then works
      at `/signin`. The stored value is a bcrypt hash, not plaintext — verifiable with
      `bin/mysql -e 'select password from users'`.
- [ ] **AC-11 (failure path)**: `bin/reset-password` with a username that does not exist prints an
      explicit error and changes nothing.

## Out of Scope

- **Roles and permissions beyond the boolean.** An enum, a permission matrix or multiple
  administrator tiers. The app has one privileged operation set; when it has two, that is the
  feature that introduces roles.
- **Web-based or email-based password recovery.** There is no SMTP service in
  `docker-compose.yaml` and adding one is a stack change, not a screen. `bin/reset-password` (REQ-7)
  is the deliberate substitute.
- **OAuth.** The Google and X buttons in `SignUpForm` are template decoration and are deleted, not
  implemented.
- **A user profile screen.** `services/web/src/components/header/UserDropdown.tsx` links to
  `/profile`, which does not exist. Letting a user edit their own name or change their own password
  is a reasonable next feature and is not this one; the dead link is noted as debt here rather than
  fixed, because removing it and adding the screen are opposite decisions and the choice belongs in
  its own spec.
- **Auditing.** No record of who created or deleted whom.

## Process note: `bin/` has no owner

REQ-7 creates `bin/reset-password`, and **no subagent can be assigned to it**. All three agent
definitions in `.claude/agents/` scope writes to `services/<svc>/`; `bin/` is outside every one of
them. The task must be tagged so `/implement` does not try to route it — the orchestrator does it
directly, the same way it handles `[docs]` tasks.

This is the first task in the project that exposes the gap. Worth resolving in the flow itself
afterwards: either a fourth tag for repo-root tooling, or an explicit statement in
`.claude/commands/implement.md` that `bin/`, `docker-compose.yaml` and `.env.example` are
orchestrator territory. Not resolved by this spec.

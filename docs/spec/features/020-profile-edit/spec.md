---
title: Profile Edit
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-19
last_updated: 2026-08-19
status: Approved
services: [api, web]
---

# SPEC: Profile Edit (`spec.md`)

## Context & Goal

A signed-in user cannot change anything about their own account. Every write to a `User` row goes
through `updateUser` in `services/api/src/users/users.resolver.ts`, and that whole resolver class
carries `@UseGuards(AdminGuard)` — so a non-admin has no way to fix a typo in their own name, and an
admin can only edit themselves by going to `/users`, the screen built for administering *other*
people (`003-auth-user-management`). The only self-facing operation in the schema today is the `me`
query, which reads and never writes. `019-user-menu` adds an *Editar perfil* entry to the header
menu; this feature is what that entry opens.

The screen is three fields — `name`, `username`, and a password the user may or may not be
changing — which is too little to justify a route of its own. It is a modal, the same shape the site
already uses for adding a user (`services/web/src/components/users/UsersManager.tsx`, on
`src/components/ui/modal/index.tsx`) and for the import dialogs. `019-user-menu` originally linked
*Editar perfil* at a `/profile` route that has never existed, with the resulting 404 written into
that spec as its expected end state; that decision is reversed here, and `019`'s `spec.md`, `plan.md`
and `tasks.md` are amended in the same change so no `/profile` route is ever built. There is no
`/profile` page in this feature either — the modal is the whole surface.

On the `api` side this adds one mutation, `updateProfile`, which is the caller acting on themselves:
it reads its target from `@CurrentUser()` and takes no id argument, so it cannot be pointed at
another row. It deliberately does not reuse `UpdateUserInput`, whose `isAdmin`-adjacent siblings
(`isEnabled`) and required `id` belong to the admin surface — a self-service mutation that accepted
those fields would be a privilege-escalation hole shaped like a convenience. `updateUser` and the
`/users` screen are untouched. No pipeline stage in the root `CLAUDE.md` changes status: this feature
adds no stage and moves none forward.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Modal, not a route)**: *Editar perfil* in the header user menu must open a modal over
      the current screen. No `/profile` route (or any other new route) may be added, and the URL must
      not change when the modal opens or closes.
- [ ] **REQ-2 (Fields)**: The modal must show exactly four inputs — `name`, `username`, a new
      password and a password confirmation — plus a submit and a cancel/close control. `name` and
      `username` must arrive pre-filled with the current user's values.
- [ ] **REQ-3 (Required fields)**: `name` and `username` are required. A submit with either one empty
      must not reach the server.
- [ ] **REQ-4 (Password is all-or-nothing)**: Both password fields empty means "do not change the
      password", and the request must carry no password at all. Both filled and matching means
      "change it". Exactly one of the two filled, or two filled that differ, must be refused before
      the request is sent, without clearing the rest of the form.
- [ ] **REQ-5 (Front-end validation uses the browser)**: The client-side layer must be the browser's
      own constraint validation (`required`, `minlength`, and native validity reporting) — no
      validation library, no hand-rolled per-field error state. The pair rules in REQ-4 are the only
      client-side checks the browser cannot express on its own.
- [ ] **REQ-6 (Server-side validation is authoritative)**: The API must re-validate everything
      regardless of what the client did — `name` non-empty, `username` at least 3 characters and not
      already taken by another user, and, when present, a password of at least 6 characters stored
      hashed, never in plaintext.
- [ ] **REQ-7 (Self only)**: `updateProfile` must act on the authenticated caller and on nobody else.
      It must accept no user id, and must be unable to change `isAdmin`, `isEnabled`, or any field
      other than `name`, `username` and `password`.
- [ ] **REQ-8 (Error presentation)**: On any error returned by the server, the modal must stay open,
      show the message in a red banner above the form, and move focus to the first field. No field
      values are lost.
- [ ] **REQ-9 (Success)**: On success the modal must close, and the name shown in the header user
      menu must be the new one without the user reloading the page. If the name did not change, the
      header simply keeps showing the same value.
- [ ] **REQ-10 (Session survives)**: A successful change — including a change of `username` or of the
      password — must leave the caller signed in, in this browser and in any other session they hold.
      No session is revoked and no redirect to `/login` happens.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Admin surface untouched)**: `updateUser`, `UpdateUserInput` and the `/users` screen
      must behave exactly as they do today. The self-service path is additive.
- [ ] **NFR-2 (No current-password check)**: Changing the password does not require re-entering the
      current one. This is a deliberate, recorded decision for a LAN-only application, not an
      oversight — see § Out of Scope.
- [ ] **NFR-3 (Spanish copy, literal)**: Every visible label and message is a Spanish string literal,
      matching the app as it stands. This feature must not introduce or consume a translation
      catalog — `018-ui-i18n` owns that migration and will pick this component up with the rest.
- [ ] **NFR-4 (No typecheck or build regression)**: `bin/cli api npx --no tsc --noEmit` and
      `bin/cli web npx --no tsc --noEmit` must both report 0 errors, and `bin/npm web run build` must
      exit 0, reported before and after the change.

## GraphQL Contract Delta

```graphql
input UpdateProfileInput {
  name: String!
  username: String!
  password: String
}

type Mutation {
  updateProfile(updateProfileInput: UpdateProfileInput!): User!
}
```

Notes the SDL cannot carry:

- **There is no `id` argument, by design** (REQ-7). The target is `@CurrentUser()`. A caller
  authenticated as a service principal (`SERVICE_TOKEN`) has no profile and must be refused, the same
  way `me` refuses one.
- **`password` omitted vs. empty are not the same.** `web` must omit the field entirely when the user
  is not changing the password. An empty string is a validation error (below), not a no-op — that
  asymmetry is what stops a blank input from silently hashing `""` into the row.
- **`passwordConfirmation` never crosses the boundary.** The match is a form-level rule checked in
  `web` (REQ-4), exactly as `createUserAction` already does for the admin create form.
- **The return type is the existing `User`.** `preferredLanguages` on it stays behind the same
  identity guard `AuthResolver` already applies; this mutation neither reads nor writes it.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `username` already belongs to another user | `ConflictException` | `El nombre de usuario ya está registrado` |
| `name` empty | `BadRequestException` (class-validator) | `El nombre es requerido` |
| `username` shorter than 3 characters | `BadRequestException` (class-validator) | `El nombre de usuario debe tener al menos 3 caracteres` |
| `password` present and shorter than 6 characters (empty string included) | `BadRequestException` (class-validator) | `La contraseña debe tener al menos 6 caracteres` |
| No credential, expired session, or a service principal | `UnauthorizedException` | `No autenticado` |

Every one of those strings already exists in `api` today (`users.service.ts`, `create-user.input.ts`,
`auth.resolver.ts`); this feature adds no new user-facing string on the boundary.

**What `web` does with each.** The server action passes `errors[0].message` through unmodified — the
same passthrough `src/actions/users.ts` documents — and the modal renders it in the red banner and
focuses the first field (REQ-8). The one exception is `No autenticado`, which
`redirectIfUnauthenticated` intercepts before the modal sees it, clearing the cookie and sending the
browser to `/login`, exactly as every other action in `src/actions/` does.

Two messages are produced by `web` alone and never come from the API, because they describe form
state the API is never told about:

| Condition | Where | Message the user sees |
| :-- | :-- | :-- |
| The two password fields differ | `web` server action, before the request | `Las contraseñas no coinciden` |
| Exactly one of the two password fields is filled | `web`, before the request | `Completá ambos campos de contraseña o dejá los dos vacíos` |

## Data Model Changes

**None.**

`User` already has `name`, `username` and `password`. This feature adds no column, no enum and no
migration — it only opens an authenticated, self-scoped write path to three columns that the admin
surface could already write.

## Acceptance Criteria

- [ ] **AC-1**: Signed in, clicking *Editar perfil* in the header menu opens a modal pre-filled with
      the current `name` and `username`, with both password fields empty, and the browser's address
      bar unchanged.
- [ ] **AC-2**: Changing `name` to a new value and submitting closes the modal, and the header user
      menu shows the new name with no page reload. Reopening the modal shows the new value, and
      `bin/mysql -e 'select name from User where username = "<username>"'` prints it.
- [ ] **AC-3**: Changing `username` to a free value and submitting closes the modal; the user stays
      signed in (navigating to another screen does not bounce to `/login`), and signing out and back
      in with the new username succeeds.
- [ ] **AC-4**: Filling both password fields with the same value of 6+ characters and submitting
      closes the modal, the session stays alive, and signing out and back in with the new password
      succeeds while the old password is refused.
- [ ] **AC-5** *(failure path)*: Submitting a `username` that another user already has leaves the
      modal open with `El nombre de usuario ya está registrado` in a red banner above the form, focus
      on the first field, every entered value still in place, and the row unchanged in the database.
- [ ] **AC-6** *(failure path)*: Clearing `name` and pressing submit is blocked by the browser itself
      — no request leaves the page (nothing in the network log, no change in the database).
- [ ] **AC-7** *(failure path)*: Filling only one of the two password fields, or two that differ,
      leaves the modal open with the corresponding `web` message in the red banner and no request
      sent to the API.
- [ ] **AC-8** *(failure path)*: Calling `updateProfile` with a 3-character password (bypassing the
      browser, e.g. from the GraphQL playground with a user cookie) returns
      `La contraseña debe tener al menos 6 caracteres` and leaves the row unchanged.
- [ ] **AC-9** *(failure path)*: Calling `updateProfile` with the `SERVICE_TOKEN` as bearer returns
      `No autenticado`.
- [ ] **AC-10**: `grep -rn "\"/profile\"\|'/profile'" services/web/src` returns nothing, and no
      `profile` directory exists under `services/web/src/app`.
- [ ] **AC-11**: `bin/cli api npx --no tsc --noEmit` and `bin/cli web npx --no tsc --noEmit` both
      report 0 errors; `bin/npm api test` reports no failures.

## Out of Scope

- **A `/profile` page.** Explicitly reversed from `019-user-menu`: the modal is the whole surface,
  and that spec is amended in this change so nothing points at a route that will not exist.
- **Requiring the current password.** Decided against (NFR-2): Perceptor runs on the user's own LAN
  with no public exposure, and an attacker with a live session can already do everything the account
  can. Adding it later is a field on `UpdateProfileInput` plus one bcrypt compare, with no schema
  change.
- **Revoking other sessions on a password change.** Decided against (REQ-10). `SessionService` can
  already do it (`revokeAllForUser`, used by `004-user-disable`), so this is a decision, not a
  limitation.
- **Editing `preferredLanguages`, the media-server settings, or anything else on Settings.**
  *Ajustes* is a separate menu entry with a separate screen.
- **Avatar.** There is no avatar field on `User` and `019-user-menu` fixes the image for every user.
- **Admins editing other users' profiles.** That is `updateUser` and the `/users` screen, untouched
  here (NFR-1).
- **Deleting or disabling your own account.** Both are refused by design in `users.service.ts` and
  stay admin-only operations.

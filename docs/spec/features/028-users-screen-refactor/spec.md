---
title: Users screen refactor
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-08-26
last_updated: 2026-08-26
status: Implemented
services: [api, web]
---

# SPEC: Users screen refactor (`spec.md`)

## Context & Goal

`/users` is the only administration screen in the app and it is the one that looks least like the
rest of it. `services/web/src/components/users/UsersManager.tsx` stacks two unrelated things in one
column: a permanently expanded four-field "New user" form, and below it the table of existing users.
The form is always on screen even when nobody is creating anybody, it pushes the table — the thing an
admin actually came to read — below the fold, and it carries a hand-rolled `defaultValue` mirroring
workaround (documented at length in that file) purely to survive React 19's native form reset. The
table itself is fine: the columns are the right ones and the row actions already carry their
self-action safeguards. What it lacks is any way to **edit** a user at all, and its three actions are
plain text buttons in the generic `outline` variant, so "Delete" and "Disable" are visually identical
and neither reads as destructive.

This feature separates the two concerns. Creation moves behind an **"Add user"** action at the top of
the table, and creation and editing share one modal — the same `Modal` primitive
(`services/web/src/components/ui/modal/index.tsx`) that `027-replace-completed-media` already uses for
its warning dialog. Every row action becomes an icon with a deliberate colour: `user-plus` to add,
`user-pen` to edit, `user-x`/`user-check` to disable and enable, `trash-2` in red to delete, with
Delete gated behind its own small confirmation modal. `lucide-react` is already a dependency of `web`.
No new column, no new data on screen — the table's contents are unchanged.

The edit path also exposes a real gap on the `api` side. `updateUser` already accepts `name`,
`username` and `password` through `UpdateUserInput`, but `UsersService.update()` — unlike `create()`
and `updateProfile()` — never checks whether the target username is already taken. The write hits
Prisma's unique constraint, lands in that method's blanket `catch`, and is reported as
`error.user.not_found`: an admin who renames a user onto an existing username is told the user does
not exist. Editing is unusable while that is true, so the check moves into `update()` as part of this
feature. Separately, `errors.user.*` has **no entries at all** in
`services/web/messages/{en,es}.json`, so every user-management error — including the existing
self-delete and last-admin ones from `003`/`004` — reaches the browser as `api`'s English fallback
even in `es`. This feature fills that namespace.

No pipeline stage in the root `CLAUDE.md` changes status. This is the library-adjacent
administration surface only.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Add-user entry point)**: The always-visible create form must be gone. The users screen
      must offer a single **"Add user"** action, placed with the table's heading and carrying the
      `user-plus` icon, which opens the user modal in create mode.
- [x] **REQ-2 (Create modal)**: In create mode the modal must present four fields — name, username,
      password, password confirmation — and must create the user only when the two password fields
      match. On success it must close and the table must show the new user without a manual reload.
- [x] **REQ-3 (Edit action)**: Every row must carry an edit action with the `user-pen` icon that opens
      the same modal in edit mode, pre-filled with that user's current name and username.
- [x] **REQ-4 (Edit modal has no password)**: In edit mode the modal must present **only** name and
      username. An administrator must not be able to set another user's password from this screen;
      an edit must never alter the target's password, and must never alter their `isAdmin` or
      `isEnabled` state.
- [x] **REQ-5 (Modal buttons)**: The modal's Save action must be blue (the app's primary/brand
      variant) and its Cancel action must be red, matching the destructive colour used by Delete.
      Cancel must discard the edit and leave the user unchanged.
- [x] **REQ-6 (Icon actions)**: The row actions must be icons rather than text labels — `user-x` to
      disable an enabled user, `user-check` to enable a disabled one, `trash-2` in red for delete,
      `user-pen` for edit. Each must expose its meaning to a mouse-over and to assistive technology
      rather than relying on the glyph alone.
- [x] **REQ-7 (Delete confirmation)**: Delete must not act on the first click. It must open a
      confirmation modal naming the user about to be deleted, with a red confirm action and a cancel
      that leaves the user in place.
- [x] **REQ-8 (No self-service from the table)**: The row belonging to the signed-in administrator
      must offer **no** edit, disable or delete action — edit joins the two that are already blocked.
      An admin edits their own name, username and password through the profile screen reachable from
      the user menu (`020-profile-edit`), exactly like any other user.
- [x] **REQ-9 (Rename onto a taken username)**: Updating a user to a username another user already
      holds must be refused with the "username already registered" conflict, not with a
      "user not found" error. Keeping a user's own current username in an edit must succeed.
- [x] **REQ-10 (User errors are translated)**: Every `error.user.*` key `api` can emit must resolve
      through `web`'s `en` and `es` catalogs, so a Spanish-locale admin never sees `api`'s English
      fallback for a user-management failure.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (No new authorisation surface)**: The screen remains administrator-only. `api`'s
      class-level `AdminGuard` on `UsersResolver` and the existing self-action safeguards in
      `UsersService.update`/`remove` are the controls; nothing in this feature may relax or duplicate
      them, and the `web` action layer must keep sending only the fields the user actually edited.
- [x] **NFR-2 (Failures stay on screen)**: A rejected create, edit, toggle or delete must leave the
      modal open with the translated message visible and the typed values intact, never close
      silently or leave the table showing a change that did not happen.
- [x] **NFR-3 (No schema change)**: This feature adds no Prisma model, field or migration.

## GraphQL Contract Delta

No SDL changes. `createUser`, `updateUser`, `removeUser` and the `users` query already exist with the
shape this feature needs, and `UpdateUserInput` already carries optional `name`, `username` and
`password`:

```graphql
input UpdateUserInput {
  name: String
  username: String
  password: String
  id: ID!
  isEnabled: Boolean
}
```

What changes is the **error contract of `updateUser`** — one condition that today produces the wrong
error, plus the existing conditions restated because `web` must now handle all of them from a modal
rather than from an inline table row.

| Condition | HTTP / GraphQL error | Key | Message the user sees (`es`) |
| :-- | :-- | :-- | :-- |
| `updateUser` sets `username` to one another user already holds | `ConflictException` (409) — **new; today this surfaces as `error.user.not_found`** | `error.user.username_taken` | `Ese nombre de usuario ya está registrado` |
| `createUser` with an existing username | `ConflictException` (409) | `error.user.username_taken` | `Ese nombre de usuario ya está registrado` |
| `updateUser`/`removeUser` targeting an id that does not exist | `NotFoundException` (404) | `error.user.not_found` | `No se encontró el usuario` |
| Admin disables their own account | `BadRequestException` (400) | `error.user.cannot_disable_self` | `No podés deshabilitar tu propio usuario` |
| Disabling the last enabled admin | `BadRequestException` (400) | `error.user.cannot_disable_last_admin` | `No podés deshabilitar al último administrador` |
| Admin deletes their own account | `BadRequestException` (400) | `error.user.cannot_delete_self` | `No podés eliminar tu propio usuario` |
| Deleting the last admin | `BadRequestException` (400) | `error.user.cannot_delete_last_admin` | `No podés eliminar al último administrador` |
| `name` empty / `username` under 3 chars / `password` under 6 chars | `BadRequestException` (400) | `error.validation.*` (existing) | the existing validation copy |

Consumer contract for `web`: every one of the rows above must be rendered by
`translateGraphQLError` into the modal that raised it (create/edit modal, or delete confirmation
modal) and the modal must stay open — see NFR-2. The password-mismatch check on create is a `web`
check with no `api` counterpart and uses the existing `errors.validation.passwordMismatch`.

`error.user.*` keys currently have **no entry in `services/web/messages/{en,es}.json`** — the
`errors` namespace has `auth`, `movie`, `episode`, `season`, `upload`, `network`, `validation` and no
`user`. REQ-10 adds that namespace with all six keys above, in both locales, in the Rioplatense
register the `es` catalog already uses.

## Data Model Changes

None. `User` already has every field this screen reads or writes.

## Acceptance Criteria

- [x] **AC-1**: Loading `/users` as an administrator shows the table with no create form above it,
      and one "Add user" control carrying the `user-plus` icon.
- [x] **AC-2**: Clicking "Add user", filling name/username/password/confirmation with matching
      passwords and saving closes the modal; the new user appears in the table and can sign in with
      the password entered.
- [x] **AC-3**: Clicking the `user-pen` icon on another user's row opens the modal pre-filled with
      that user's name and username, with no password field present. Changing the name and saving
      updates the row; that user can still sign in with their previous password.
- [x] **AC-4 (failure)**: Editing user B's username to user A's existing username and saving leaves
      the modal open showing `Ese nombre de usuario ya está registrado` (in `es`) — **not**
      `No se encontró el usuario` — and user B's username is unchanged in the table after a reload.
- [x] **AC-5 (failure)**: In the create modal, entering two different passwords and saving leaves the
      modal open with the mismatch message and creates no user.
- [x] **AC-6**: Clicking `trash-2` on another user's row opens a confirmation modal naming that user;
      Cancel closes it and the user is still in the table, Confirm removes the row.
- [x] **AC-7 (failure)**: With exactly one administrator in the database, confirming the delete of
      that administrator from a second admin session leaves the user in place and shows
      `No podés eliminar al último administrador` in `es` — proving REQ-10, since that string is not
      what `api` sends.
- [x] **AC-8**: The signed-in administrator's own row shows none of the edit, disable or delete
      actions, while `/profile` still lets them change their own name, username and password.
- [x] **AC-9**: `user-x` on an enabled user disables them and the icon becomes `user-check`; the
      status badge follows, and that user's live session is revoked (existing `004` behaviour, not
      regressed).
- [x] **AC-10**: `bin/npm api run test` and `bin/npm web run build` both exit 0.

## Out of Scope

- **Setting another user's password.** REQ-4 deliberately removes it from this screen; the recovery
  path for a user who cannot sign in stays `bin/reset-password <username>`. Adding it back would
  mean an admin-initiated password write with no confirmation from the account owner, which is a
  separate decision from this refactor.
- **Granting or revoking `isAdmin`.** No role control appears in the modal. The seeded admin is
  still the only administrator unless the database says otherwise; a role editor needs its own
  safeguards (last-admin on demotion, session revocation) and its own spec.
- **Pagination, sorting or search over the user list.** The table renders every user, as today. A
  self-hosted install has a handful of users.
- **`UpdateUserInput` shape changes.** Splitting the admin write from the profile write, or removing
  `password` from `UpdateUserInput` now that no screen sends it, is a contract change with no user
  benefit here; `web` simply never sends the field (NFR-1).
- **Redesigning any other administration screen.** `/settings` keeps its current look.

## Post-Implementation Amendments (2026-08-26)

Four small refinements landed after the initial implementation closed, driven directly by user
feedback in the same session rather than a new `/specify` round (Article VII — single service, no
schema or GraphQL delta). Recorded here so the spec stays truthful about what `/users` actually
does.

- **Header actions slot replaces the breadcrumb.** `components/common/PageBreadCrumb.tsx`'s
  `<nav>` (a "Home" breadcrumb link) is gone; the component now takes an optional `children` slot
  next to the page title, for page-specific action buttons. `/users` is the first consumer: it
  renders `AddUserButton` there instead of stacking the "Add user" button above the table. Every
  other page using `PageBreadcrumb` (`movies`, `shows`, `settings`, `search`, the two detail pages,
  the two add pages) loses the breadcrumb link and renders an empty slot until it opts into its own
  actions — e.g. a future sort control on `/movies`, which is what prompted this change.
- **Shared dialog state.** Because the "Add user" trigger now lives in the header (outside
  `UsersManager`) while `UserModal` still opens from inside the table, a new
  `components/users/UsersDialogsContext.tsx` (`UsersDialogsProvider` + `useUsersDialogs`) holds
  `modalTarget`/`deletingUser` so both sides read and write the same state. `page.tsx` wraps the
  header and the card in the provider.
- **REQ-6 amendment — row actions are visible buttons, not bare icons.** The edit/disable-enable/
  delete controls now render with real button chrome (background, `ring-1` border, hover state —
  matching the shared `Button` component's `outline` look, red-tinted for delete) instead of a
  color-only icon with no visible boundary, and each carries its translated label as visible text
  next to the icon, not only as `title`/`aria-label`.
- **Table layout fix.** The actions `<th>`/`<td>` gained `w-px whitespace-nowrap` so the table's
  auto column-sizing stops handing that column unclaimed width — before this, a wide gap opened up
  between the Status column and the action buttons.

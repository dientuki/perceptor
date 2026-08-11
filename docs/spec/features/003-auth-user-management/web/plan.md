---
title: Admin User Management — web slice
service: web
last_updated: 2026-08-10
status: Approved
---

# PLAN: Admin User Management — `web` (`web/plan.md`)

## Scope

This slice builds the administrator screen at `/users` (list, create, delete — REQ-4), makes the
duplicate-username and deletion-safeguard errors from `api` render inline (REQ-6), hides the
sidebar entry point from non-admins (REQ-4's usability half), and removes the two dead links
(REQ-8). It does not touch `services/api` — `isAdmin`, `AdminGuard` and the deletion rules are
`api`'s (`../api/plan.md`), already implemented.

**Status note**: the dead-link removal and `isAdmin` plumbing into `CurrentUser`/`me`/`login` are
already done and verified (typecheck unchanged at 12 errors in the 5 known pre-GraphQL files). The
screen itself — the bulk of this slice — is not started.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/components/auth/LoginForm.tsx` | Modified (done) | Removed dead "Forgot password?" link |
| `src/proxy.ts` | Modified (done) | `AUTH_ROUTES` narrowed to `['/login']` |
| `src/actions/auth.ts` | Modified (done) | `isAdmin` added to `CurrentUser`, `ME_QUERY`, `LOGIN_MUTATION` |
| `src/actions/users.ts` | New | `getUsers`, `createUserAction`, `deleteUserAction` |
| `src/app/(dashboard)/users/page.tsx` | New | Server component: `getCurrentUser()` + `getUsers()`, `notFound()` for non-admins |
| `src/components/users/UsersManager.tsx` | New | Client component: table + create form |
| `src/layout/AdminShell.tsx` | Modified | Pass `isAdmin={user.isAdmin}` to `AppSidebar` |
| `src/layout/AppSidebar.tsx` | Modified | Accept `isAdmin` prop; conditionally append the "Users" nav item |

## Existing code to reuse

- `src/actions/settings.ts` — the server-action shape to copy exactly for `users.ts`: `'use server'`
  first line, SCREAMING_SNAKE query/mutation constants, `fetchGraphQL<T>` with the response shape as
  the type parameter, `redirectIfUnauthenticated(errors)` called **outside** any `try` (see
  `src/lib/auth-session.ts`'s own doc comment on why), form actions returning
  `{ error?: string } | { success: true }` for `useActionState`.
- `src/app/(dashboard)/settings/page.tsx` — the page shape to copy: `PageBreadcrumb` + a
  `rounded-2xl border … bg-white dark:bg-white/[0.03]` card wrapping the client component.
- `src/components/auth/LoginForm.tsx` — the inline-error style: `text-sm text-error-500
  bg-error-50 dark:bg-error-500/10 p-3 rounded-lg`. Reuse the class, not a new one.
- `src/components/form/input/InputField.tsx`, `src/components/form/Label.tsx`,
  `src/components/ui/button/Button.tsx` — same form primitives `LoginForm` and `SettingsForm`
  already use for the create-user form's `name`/`username`/`password` fields.
- `src/actions/auth.ts`'s `getCurrentUser()` — already returns `isAdmin` (done); `page.tsx` calls it
  the same way `(dashboard)/layout.tsx` already does.

## Steps

Already done (1–2); remaining steps are 3–6.

1. Remove the dead "Forgot password?" link from `LoginForm.tsx`; narrow `proxy.ts`'s `AUTH_ROUTES`.
2. Add `isAdmin` to `CurrentUser`, `ME_QUERY`, `LOGIN_MUTATION` in `actions/auth.ts`.
3. Write `src/actions/users.ts`:
   - `getUsers(): Promise<AdminUser[]>` — `query Users { users { id name username isAdmin } }`,
     throws on error (read-function convention).
   - `createUserAction(prevState, formData)` — `mutation CreateUser($createUserInput:
     CreateUserInput!)`; on success, `revalidatePath('/users')` and return `{ success: true }`; on
     GraphQL error, return `{ error: errors[0].message }` verbatim — this is what makes REQ-6's
     duplicate-username message and the `MinLength` validation messages reach the screen unchanged.
   - `deleteUserAction(prevState, formData)` — `mutation RemoveUser($id: ID!)`; same error
     pass-through, which is what surfaces REQ-5's two messages (AC-7, AC-8).
4. Write `src/app/(dashboard)/users/page.tsx`: `Promise.all([getCurrentUser(), getUsers()])`; if
   `!user.isAdmin`, call Next's `notFound()` before rendering anything (defense in depth — the real
   control is `AdminGuard`, this is what keeps a non-admin from seeing even a broken screen if they
   navigate here directly).
5. Write `src/components/users/UsersManager.tsx` (client component):
   - A table (`name`, `username`, an `isAdmin` badge, a delete button per row).
   - The delete button is disabled on the row matching the signed-in user's own id, passed down as
     a prop from `page.tsx` — a client-side courtesy; `api`'s self-delete check is the real
     enforcement, same relationship as the hidden sidebar link vs. `AdminGuard`.
   - A create form (`name`, `username`, `password`) via `useActionState(createUserAction, null)`.
   - Both actions' errors render inline with the class named above. No `alert()`, no redirect.
6. Update `AdminShell.tsx` to pass `isAdmin={user.isAdmin}` to `AppSidebar`; update `AppSidebar.tsx`
   to accept it and append one `NavItem` (`{ icon: <Users />, name: 'Users', path: '/users' }`,
   `Users` from `lucide-react`, already this file's icon library) only when `isAdmin` is true.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta — `isAdmin: Boolean!` on `User`, and the five
`users` operations now admin-only. Every error condition this slice must handle, per the spec's
error table (`docs/spec/graphql-contract.md`'s warning about happy-path-only consumers applies
directly here):

| Condition | Message this slice must render |
| :-- | :-- |
| Non-admin calls a users operation | `No tenés permisos para administrar usuarios` |
| Duplicate username | `El nombre de usuario ya está registrado` |
| Username < 3 chars | `El nombre de usuario debe tener al menos 3 caracteres` |
| Password < 6 chars | `La contraseña debe tener al menos 6 caracteres` |
| Self-delete | `No podés eliminar tu propio usuario` |
| Delete last admin | `No podés eliminar al único administrador` |
| User id not found | `Usuario con ID "…" no encontrado` |

Since `createUserAction`/`deleteUserAction` pass `errors[0].message` straight through unmodified,
all seven are covered by the same code path — no per-message branching needed, which is also why
getting the pass-through right (not swallowing it into a generic string) is the one thing to get
right here.

The delta is read-only. If `users`/`createUser`/`removeUser` ever return something this table
doesn't cover, stop and report — do not invent a client-side message for it.

## Tests

`services/web` has no test runner (`services/web/CLAUDE.md` § *Tests: there are none* — introducing
one is its own decision, not a side effect of this feature). The quality gate is the typecheck plus
opening `/users` in a browser and exercising create/delete, including the failure paths in the
contract-obligations table above.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
```

reports the same 12 errors in the same 5 pre-existing files, and none of the files this slice
touches. Then, manually:

- Signed in as admin: `/users` lists existing users; creating one adds it without a page error
  (AC-3); creating a duplicate username, a 2-char username, and a 5-char password each show their
  message inline (AC-6); the admin's own row has a disabled delete button, and clicking delete on
  it anyway (e.g. via a stale/detached button state) is still refused server-side with the
  self-delete message (AC-7); deleting the sole admin is refused (AC-8).
- Signed in as a freshly created non-admin user: the app works, `/users` does not appear in the
  sidebar, and navigating to `/users` directly 404s (AC-4).

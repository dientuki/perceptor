---
title: Disable Users — web slice
service: web
last_updated: 2026-08-11
status: Implemented
---

# PLAN: Disable Users — `web` (`web/plan.md`)

Read `../spec.md` and `../plan.md` first. The GraphQL delta in `../spec.md` is read-only: if it is
wrong, stop and report — do not adapt it locally (Constitution, Article VIII).

## Scope

This slice renders and controls the state: the `/users` table gains a status column and a per-row
toggle, and `src/actions/users.ts` gains the server action that sends it. That is all. It does
**not** enforce anything — the self-disable and last-admin refusals, the login refusal and the
session revocation are all `api`'s, and this slice's job is to display their messages verbatim, not
to pre-empt them. Disabling the toggle on the caller's own row is a usability affordance, exactly
like the already-disabled delete button next to it; the real control is server-side (AC-6).

Nothing on the login screen changes. `Tu cuenta está deshabilitada` reaches the user through the
`state.error` path `LoginForm.tsx` already renders for every other login error — verify it, do not
build for it.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/users.ts` | Modified | `isEnabled: boolean` on `AdminUser` |
| `src/actions/users.ts` | Modified | `isEnabled` in `USERS_QUERY`'s selection set; new `UPDATE_USER_MUTATION` + `setUserEnabledAction` |
| `src/components/users/UsersManager.tsx` | Modified | Status column, per-row toggle, inline error |

Explicitly **not** touched: `src/actions/auth.ts` (`CurrentUser` does not need `isEnabled` — the
`me` query of a disabled user never resolves, because their session is already revoked),
`src/app/(dashboard)/users/page.tsx` (it passes `users` and `currentUserId` through and needs no
new prop), `src/components/auth/LoginForm.tsx`, and `src/proxy.ts`.

## Existing code to reuse

- `src/actions/users.ts` → `deleteUserAction` — the exact template for `setUserEnabledAction`:
  `(prevState, formData)`, `try/catch` around `fetchGraphQL` returning the connection-error string,
  `redirectIfUnauthenticated(errors)` then `return { error: errors[0].message }` **unmodified**,
  `revalidatePath('/users')` on success. Copy it; do not invent a variant (see
  `services/web/CLAUDE.md` § *The server-action pattern*).
- `src/components/users/UsersManager.tsx` → `UserRow` — already a `useActionState` form per row,
  already renders its error in a full-width `<tr>` below itself via `ERROR_CLASS`, already disables
  its button on `isSelf`. The toggle is a second form in the same row, following it exactly.
  Reuse the existing `ERROR_CLASS` constant; do not add a second error style.
- `src/components/ui/button/Button` — the delete button's `variant="outline"` / `size="sm"` shape.
- The role `<span>` pill already in `UserRow` (`bg-brand-50` / `bg-success-50`) — the status cell is
  the same pill with different words, not a new component.

## Steps

1. `AdminUser` in `src/types/users.ts` gains `isEnabled: boolean`. The file's own header comment
   says it mirrors `api`'s `User`; keep that true.
2. In `src/actions/users.ts`, add `isEnabled` to `USERS_QUERY`'s selection set. Leave
   `CREATE_USER_MUTATION` alone — `isEnabled` is deliberately not on `CreateUserInput`
   (`../plan.md` § Contract Freeze), so requesting it back on create is fine but sending it is not.
3. Add `UPDATE_USER_MUTATION` (`mutation UpdateUser($updateUserInput: UpdateUserInput!) { updateUser
   (updateUserInput: $updateUserInput) { id isEnabled } }`) and `setUserEnabledAction`, reading `id`
   and the target state from `formData` and sending `{ id, isEnabled }`. Send **only** those two
   fields: `UpdateUserInput` is partial, and including `name`/`username` would make a status toggle
   silently rewrite fields nobody edited. `formData` values are strings, so the boolean must be
   parsed explicitly (`formData.get('isEnabled') === 'true'`), never passed through as a truthy
   string — `"false"` is truthy and would turn every disable into an enable with no error anywhere.
4. In `UsersManager.tsx`: add an "Estado" column header, a cell rendering `Habilitado` /
   `Deshabilitado` as the same pill style the role cell uses, and a second `useActionState` form in
   the actions cell whose hidden inputs carry `id` and the *target* state (`!user.isEnabled`). The
   button reads `Deshabilitar` when the user is enabled and `Habilitar` when disabled, is disabled
   on `isSelf` with the same `title` treatment the delete button uses, and shows a pending label
   while submitting. Both actions' errors render through the existing error `<tr>`; widen its
   `colSpan` to match the new column count. Errors render inline — never `alert()` or
   `window.confirm()` (`services/web/CLAUDE.md`).

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta — `isEnabled: Boolean!` on `User`,
`isEnabled: Boolean` on `UpdateUserInput`. There is **no codegen**: a wrong field name or a missed
error path compiles cleanly here and fails at runtime (`docs/spec/graphql-contract.md`).

Every error condition this slice must handle, all of them arriving as `errors[0].message`:

| Message | Where it surfaces | Handling |
| :-- | :-- | :-- |
| `No podés deshabilitar tu propio usuario` | `setUserEnabledAction` | Passed through unmodified, rendered inline in the row |
| `No podés deshabilitar al único administrador` | `setUserEnabledAction` | Same |
| `Usuario con ID "…" no encontrado` | `setUserEnabledAction` | Same — the row is stale; the message says so |
| `No tenés permisos para administrar usuarios` | `setUserEnabledAction` | Same — `AdminGuard`, unchanged from `003` |
| `No autenticado` / session expired | `setUserEnabledAction` | `redirectIfUnauthenticated(errors)` **before** returning the error, as every action in this file already does |
| `Tu cuenta está deshabilitada` | `LoginForm.tsx` | No code change — it rides the existing `state.error` render. Verify live (AC-4) |

## Tests

**None, deliberately.** `services/web` has no test file, no runner and no `test` script, and its
`CLAUDE.md` explicitly forbids introducing Vitest or Playwright as a side effect of a feature task —
that is its own decision and deserves its own spec. The quality gate for this slice is the
typecheck, Biome, and opening `/users` and `/login` in a browser and walking AC-3 through AC-8.

The one thing in this slice that could fail silently — the `"false"`-is-truthy parse in step 3 —
is caught by AC-3, which requires toggling **both** directions, not just off.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
```

Typecheck reporting the **same 12 errors in the same 5 pre-existing files** as the 2026-08-10
baseline in `services/web/CLAUDE.md` — none of them in `actions/users.ts`, `types/users.ts` or
`components/users/`. Report the before/after counts.

Then live, signed in as the administrator: AC-3 (toggle off and back on, both directions, no page
error), AC-6 (own row's toggle greyed out), and — signed in as the toggled user in a second
browser — AC-4, AC-5 and AC-8.

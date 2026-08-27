---
title: Users screen refactor — web slice
service: web
last_updated: 2026-08-26
status: Approved
---

# PLAN: Users screen refactor — `web` (`web/plan.md`)

## Scope

Everything the administrator sees: the `/users` screen loses its always-open create form, gains an
"Add user" entry point, an edit action, icon-and-colour row actions, a shared create/edit modal and a
delete confirmation modal. This slice also fills the missing `errors.user` namespace in both message
catalogs (REQ-10) and makes two small additive changes to shared UI primitives that the new dialogs
need.

Not this slice: the duplicate-username conflict on `updateUser` (REQ-9) is `api`'s, in
`../api/plan.md`. `web` writes against the contract as if it were already fixed — it is a plain
`error.user.username_taken` conflict like the one `createUser` already raises — and AC-4 stays red
until that lands. Do not work around it in `web`, and do not add a client-side uniqueness check.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/users/UserModal.tsx` | New | The shared create/edit dialog. Four fields in create mode, two in edit mode. |
| `services/web/src/components/users/DeleteUserDialog.tsx` | New | Delete confirmation naming the target user. |
| `services/web/src/components/users/UsersManager.tsx` | Modified | Create form deleted; table keeps its columns, gains the "Add user" control and icon row actions; owns which dialog is open and for whom. |
| `services/web/src/actions/users.ts` | Modified | Four actions move from `(prevState, formData)` to direct arguments; `updateUserAction` added. |
| `services/web/src/components/ui/button/Button.tsx` | Modified | `danger` variant; `aria-label` pass-through. |
| `services/web/src/components/form/input/InputField.tsx` | Modified | Optional `value` prop so the component can be used controlled. |
| `services/web/messages/en.json` | Modified | `users.*` reworked; `errors.user.*` added. |
| `services/web/messages/es.json` | Modified | Same keys, Rioplatense register. |
| `services/web/CLAUDE.md` | Modified | § "Admin user management" rewritten to describe what is actually there afterwards. |

`src/app/(dashboard)/users/page.tsx` and `src/types/users.ts` need no change — the page's
`isAdmin` → `notFound()` → `getUsers()` sequence and its comment about *not* using `Promise.all`
stay exactly as they are, and `AdminUser` already carries every field the table renders.

## Existing code to reuse

- `src/components/profile/ProfileModal.tsx` — **the template for `UserModal.tsx`**. Controlled
  `useState` per field; a `useEffect` keyed on `isOpen` that re-seeds from props and clears the error
  so a cancel-then-reopen never shows stale values; `handleSubmit` that `preventDefault`s, calls the
  action, and on `"error" in result` sets the message and **returns before `onClose()`**; a
  `router.refresh()` after a successful close. Follow its structure; the only differences are the
  create/edit mode switch and the button colours.
- `src/hooks/useModal.ts` — `useModal()` for open/close state, the way `UserDropdown.tsx` drives
  `ProfileModal`. Do not hand-roll a second `isOpen` boolean.
- `src/components/ui/modal/index.tsx` — `Modal`. Already handles Escape, the backdrop click and the
  body scroll lock. `services/web/CLAUDE.md` § Small conventions: never `window.confirm()`, which is
  why REQ-7's confirmation is a `Modal` and not a browser dialog.
- `src/actions/profile.ts` → `updateProfileAction` — the shape the four user actions move to: a
  plain async server action taking a typed object, returning
  `{ error?: string } | { success: true }`, error text from `translateGraphQLError`.
- `src/lib/graphql-error.ts` → `translateGraphQLError` — already used by all four actions. Keep it.
  `toActionError`/`errorKey` is **not** needed here: nothing in this screen branches on *which*
  error came back, it only displays it.
- `src/lib/auth-session.ts` → `redirectIfUnauthenticated` — already called by all four actions and
  correct for them (they are form/server actions, not render-pass reads). Keep it.
- `lucide-react` — already a dependency and used across the app (`UserPen` in `ProfileModal.tsx`,
  `Plus` in `MediaResultAction.tsx`). Import `UserPlus`, `UserPen`, `UserX`, `UserCheck`, `Trash2`.
- The error block class string `"text-sm text-error-500 bg-error-50 dark:bg-error-500/10 p-3
  rounded-lg"` — the same one `ProfileModal`, `SettingsForm` and today's `UsersManager` use.

## Steps

1. `Button.tsx`: add `danger` to the `variant` union with a red treatment mirroring how `primary`
   is built (`bg-error-500 text-white hover:bg-error-600 disabled:bg-error-300`), and add an optional
   `ariaLabel` prop forwarded to the element's `aria-label`. Both additive — every existing call site
   keeps compiling and rendering identically.
2. `InputField.tsx`: add an optional `value?: string` forwarded to the `<input>`. Leave
   `defaultValue` in place; every existing call site is uncontrolled and must stay that way.
3. Catalogs, `en` then `es`: rework the `users` namespace — `users.add` (the button label and its
   tooltip), `users.modal` (create title, edit title, the four field labels, the password hint, save,
   saving, cancel), `users.delete` (confirmation title, the sentence naming the user, confirm,
   cancel, deleting) and `users.table` (keep the column headers and badges; replace the four text
   action labels with `*Title`/`*Label` strings used as tooltip and accessible name for the four
   icons). Then add the `errors.user` namespace with all seven keys `api` emits:
   `username_taken`, `not_found`, `cannot_disable_self`, `cannot_disable_last_admin`,
   `cannot_delete_self`, `cannot_delete_last_admin`, `unsupported_locale` — the last one belongs to
   `021-user-preferences` and is included because the namespace should not go back to being
   half-present. Keys must be identical in both files; `es` copy in the Rioplatense register the
   catalog already uses, and `../spec.md`'s error table has the exact `es` sentences.
4. `src/actions/users.ts`: convert the four actions.
   - `createUserAction({ name, username, password, passwordConfirmation })` — keeps the mismatch
     check and `errors.validation.passwordMismatch`, keeps `CREATE_USER_MUTATION`.
   - `updateUserAction({ id, name, username })` — **new**; sends
     `updateUserInput: { id, name, username }` and nothing else. Do not spread an object, do not send
     `password`, `isEnabled` or `isAdmin` (`../plan.md` § Contract Freeze — an empty-string password
     would be hashed and lock the user out with no error anywhere). Reuse `UPDATE_USER_MUTATION` and
     add `name`/`username` to its selection set.
   - `setUserEnabledAction(id: string, isEnabled: boolean)` — same mutation, same `{ id, isEnabled }`
     payload; the `=== "true"` string parse disappears with `FormData`.
   - `deleteUserAction(id: string)` — unchanged but for the signature.
   All four keep `revalidatePath("/users")` on success, keep `redirectIfUnauthenticated(errors)`, and
   keep returning the translated `errors[0]` on failure.
5. `UserModal.tsx`: props `{ isOpen, onClose, user }` where `user?: AdminUser` — absent means create
   mode. Title and icon from the mode (`UserPlus` / `UserPen`). Create renders name, username,
   password, password confirmation; **edit renders name and username only** (REQ-4) — no hidden
   password field, no empty-string password in the payload. Footer: Cancel (`variant="danger"`,
   `type="button"`, calls `onClose`) then Save (default `primary`, blue, `type="submit"`, disabled
   while pending). On error: set the message, keep the modal open, keep the typed values (NFR-2). On
   success: `onClose()` then `router.refresh()`.
6. `DeleteUserDialog.tsx`: props `{ isOpen, onClose, user }`. Renders the target's name in the
   sentence, a `danger` confirm and an outline cancel, calls `deleteUserAction(user.id)`, and on
   failure keeps the dialog open with the translated message — AC-7's last-admin refusal is shown
   here, not swallowed.
7. `UsersManager.tsx`: delete `CreateUserForm` entirely, including the `defaultValue`-mirroring block
   and its comments — the controlled modal has no native form reset to survive, so the workaround has
   nothing left to work around. Keep `UsersTable`/`UserRow` and their five columns. Add the "Add
   user" `Button` with the `UserPlus` icon beside the table heading. Lift dialog state to
   `UsersManager` (which user is being edited, which is being deleted) rather than mounting a modal
   per row. In `UserRow`, replace the two `<form>` elements with icon buttons: `UserPen` (edit),
   `UserX`/`UserCheck` (disable/enable, chosen from `user.isEnabled`), `Trash2` in red (opens the
   delete dialog). When `isSelf`, render **none** of the three (REQ-8) — not disabled buttons; the
   existing `disableSelfTitle`/`deleteSelfTitle` tooltips have nothing left to explain and their keys
   go away with them. Each icon button carries `title` and `ariaLabel` from the catalog.
8. Update `services/web/CLAUDE.md` § "Admin user management": the component list, the new actions'
   signatures, the fact that the row actions are icons and that the self row renders none of them,
   and drop the now-false bullet about `formData.get("isEnabled") === "true"`. Keep the
   `page.tsx` sequential-not-`Promise.all` bullet — that behaviour is unchanged and the reason still
   holds.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta — read-only, and there is no codegen, so an
unhandled condition compiles fine and fails in the browser.

- `createUser(createUserInput: CreateUserInput!): User!` — `name`, `username`, `password`. No
  `isEnabled`, no `isAdmin`: a user is always created enabled and non-admin.
- `updateUser(updateUserInput: UpdateUserInput!): User!` — this screen sends **only**
  `{ id, name, username }` from the edit modal and **only** `{ id, isEnabled }` from the toggle.
- `removeUser(id: ID!): User!`.
- Every error row must reach the dialog that raised it, translated, with the dialog still open:
  `error.user.username_taken` (create **and** edit), `error.user.not_found`,
  `error.user.cannot_disable_self`, `error.user.cannot_disable_last_admin`,
  `error.user.cannot_delete_self`, `error.user.cannot_delete_last_admin`, and the
  `error.validation.*` keys from input validation. The password-mismatch check on create has no
  `api` counterpart and stays local, using the existing `errors.validation.passwordMismatch`.
- `error.user.username_taken` on `updateUser` is the row marked new in the delta. `web` handles it
  identically to the create case; it is `api` that has to start raising it.

## Tests

None owed, and the reason is structural: `services/web` has no test runner and adding one is out of
scope for this feature (`018-ui-i18n` NFR-6 established this and nothing here changes it). The two
failure classes that *are* silent in this slice are covered by non-test checks instead:

- catalog drift between `en` and `es` — `bin/cli web node scripts/check-messages.mjs`, the plain
  script from `018-ui-i18n`, exits non-zero on any key present in one file and not the other;
- the payload hazards (an unintended `password`, `isEnabled` or `isAdmin` in `updateUser`) — these
  live in four literal object expressions in `src/actions/users.ts` and are reviewed there; `api`'s
  `users.service.spec.ts` covers the server side of the same failure.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/cli web node scripts/check-messages.mjs
bin/npm web run build
```

`tsc` prints nothing, `biome check` is clean with no new suppression and no React Compiler
suppression, `check-messages.mjs` exits 0, and `next build` exits 0.

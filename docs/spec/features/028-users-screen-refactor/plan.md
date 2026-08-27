---
title: Users screen refactor — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-26
status: Implemented
---

# PLAN: Users screen refactor (`plan.md`)

## Approach

Almost everything this feature needs already exists somewhere in the repo; the plan is mostly about
pointing the users screen at it instead of at its own one-off code.

On `web`, the create/edit dialog is **`ProfileModal.tsx` with a different action behind it**.
`services/web/src/components/profile/ProfileModal.tsx` (from `020-profile-edit`) is already a
`Modal` + controlled form + "re-seed state every time `isOpen` flips" + call the action directly and
keep the modal open on error. `UserModal.tsx` copies that shape, and copying it deliberately kills
the workaround that makes `UsersManager.tsx` hard to read today: the `defaultValue`-mirroring dance
around React 19's native form reset exists only because the create form is an uncontrolled
`<form action={formAction}>`. A controlled modal has no reset to survive, so the whole block
disappears (Article X). The dialogs are opened through the existing `useModal()` hook
(`src/hooks/useModal.ts`), the same way `UserDropdown.tsx` opens `ProfileModal`.

That drives the one shape change in `src/actions/users.ts`: the four actions stop being
`useActionState` reducers taking `(prevState, formData)` and become plain async functions taking
their arguments directly, exactly like `updateProfileAction` in `src/actions/profile.ts`. The row
actions are now icon buttons, not one-input `<form>` elements, so `FormData` had become a wrapper
around nothing — and the string-typed `formData.get("isEnabled") === "true"` hazard that
`services/web/CLAUDE.md` warns about goes away with it, since the boolean stays a boolean end to
end. The return contract stays `{ error?: string } | { success: true }`, still built through
`translateGraphQLError`.

Two shared `web` primitives get a small additive change rather than a sibling: `Button.tsx` gains a
`danger` variant (red, for Delete and for the modal's Cancel per REQ-5) and an `aria-label`
pass-through so an icon-only button is nameable (REQ-6); `InputField.tsx` gains an optional `value`
prop so it can be used controlled — today it only takes `defaultValue`, which is why `ProfileModal`
went around it with a raw `<input>` and a local `INPUT_CLASS`. Adding `value` means `UserModal` uses
the real `Input` component instead of becoming the third copy of that class string. `ProfileModal`
itself is left alone; converting it is unrelated churn.

On `api` the change is four lines of real behaviour: `UsersService.update()` gains the same
duplicate-username check `updateProfile()` already performs a few methods below it — `findUnique` by
username, allow the row when its id is the target's own id — so REQ-9's conflict is raised
explicitly instead of falling through Prisma's unique constraint into that method's blanket
`catch` and out as `error.user.not_found`. Same key, same exception helper (`i18nError.conflict`,
`ERROR_KEYS.USER_USERNAME_TAKEN`), no new error vocabulary. Nothing about the resolver, the guard or
the schema moves.

The remaining work is catalog: `errors.user` does not exist in `services/web/messages/{en,es}.json`
at all, so all seven `error.user.*` keys `api` can emit get entries in both locales.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns REQ-9. Until `update()` raises the conflict, AC-4 cannot be reached from `web` no matter what the modal does — the browser would show "user not found" and the reviewer would chase it into the wrong service. |
| 2 | `web` | The screen rewrite, the two shared-primitive tweaks, and the catalog. |

**These two steps may genuinely run in parallel.** There is no SDL delta: `updateUser`,
`createUser`, `removeUser` and `users` already have the exact shape `web` needs, and
`error.user.username_taken` is a key `api` already emits from `create()`. `web` is therefore writing
against a contract that is true today. Only the *verification* is ordered — AC-4 is red until step 1
lands, and must be re-run after it does rather than being written off as a UI bug.

Within `web`, `Button.tsx`/`InputField.tsx` and the catalog entries come before `UserModal.tsx` and
the `UsersManager.tsx` rewrite, which consume them.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. It adds no SDL; the
frozen part is the **error table**, and it is the part an implementer will be tempted to move.

- **`error.user.username_taken` is the key for the rename conflict, not a new key.** `api` will be
  tempted to mint something like `error.user.username_taken_on_update` because the call site is
  different. It is the same condition and the same sentence; a second key means a second catalog
  entry in two locales that nobody adds, and `web` renders `api`'s English fallback.
- **`web` must not send `password` in `updateUser`.** `UpdateUserInput` still has the field and
  `UsersService.update()` still hashes it if present — REQ-4 is enforced by the *caller* omitting
  it. Sending `password: ""` because the modal has no password field and the payload builder is
  written generically would bcrypt an empty string and lock the target out with no error anywhere.
  Build the payload field by field.
- **`isAdmin` and `isEnabled` are not part of the edit payload either.** The edit modal writes
  `{ id, name, username }` and nothing else, for the same reason `setUserEnabledAction` was already
  restricted to `{ id, isEnabled }`.
- **The self-row rule is a usability affordance, not the control.** REQ-8 hides three buttons; it
  does not — and must not — replace `AdminGuard` or the self-disable/self-delete/last-admin
  safeguards in `UsersService`. Do not "simplify" by moving any of those checks into `web`.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief both services.
Never patch it from inside one slice (Article VIII).

## Migrations

None. No Prisma model, field, enum or migration is touched (NFR-3). `git status services/api/prisma/`
must be clean at the end of this feature — anything there is a defect in the `api` slice.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The edit payload is built by spreading form state | `password: ""` reaches `updateUser`, `update()` hashes it (`if (dataToUpdate.password)` is false for `""` — but `null`/whitespace is not), and the target's password is silently rewritten. Nobody sees an error; the user simply cannot log in tomorrow. | Contract freeze above; the `web` plan names the literal payload; the `api` suite keeps its existing "update hashes the password" test so a regression on that path is visible. |
| The duplicate-username check omits the "own row" allowance | A pure name edit — username untouched — collides with the user's own row and every edit fails with "username already registered". Loud, but it makes the feature useless; the inverse bug (comparing the wrong id) is silent and lets two users share a username, which then breaks login. | `users.service.spec.ts` covers both directions explicitly: rename onto another user's username throws `ConflictException`, and an edit keeping the user's own username succeeds. |
| `errors.user.*` added to `en` only | The `es` admin keeps seeing `api`'s English sentence and nothing errors — `translateGraphQLError` falls back by design. This is exactly the drift that made `027`'s replace affordance unreachable in `es`. | `bin/cli web node scripts/check-messages.mjs` exits non-zero on catalog drift; it is in Verification and in the `web` plan's "Done when". |
| The action rewrite drops `revalidatePath("/users")` | The mutation succeeds server-side and the modal closes, but the table still shows the old row. The admin retries, and the second attempt fails with "username already registered" for a rename they already made. | Every one of the four actions keeps `revalidatePath("/users")`; the modal additionally calls `router.refresh()` on success, the way `ProfileModal` does. |
| A rejected mutation closes the modal | The typed values are gone and the reason with them; the admin sees a table that did not change and no explanation. | NFR-2. The `web` plan's step order puts the error branch before `onClose()`, mirroring `ProfileModal.handleSubmit`. |
| Icon-only buttons ship with no accessible name | Nothing errors, ever. The screen is simply unusable without sight, and the four actions are indistinguishable in a screenshot-based review. | REQ-6; `Button` gains `aria-label`, and every row action passes both `title` and `aria-label` from the catalog. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/cli web node scripts/check-messages.mjs
bin/npm web run build
```

`bin/npm api run test` must show the `UsersService` suite grown by the two REQ-9 cases and no
existing case lost. `git status services/api/prisma/` must be clean.

Then the manual pass, signed in as an administrator with at least two users in the database, once in
`en` and once with `User.uiLocale = es`:

1. `/users` — no create form above the table; one "Add user" control with the `user-plus` icon
   (AC-1).
2. Add a user with matching passwords → modal closes, row appears, sign out and sign in as that user
   (AC-2). Repeat with mismatched passwords → modal stays open, message shown, no row added (AC-5).
3. `user-pen` on another user → modal pre-filled, **no password field** → change the name, save, then
   confirm that user can still sign in with their old password (AC-3, REQ-4).
4. Edit user B's username to user A's → modal stays open with `Ese nombre de usuario ya está
   registrado` in `es`; reload and confirm B's username is unchanged (AC-4). This is the criterion
   that proves step 1 of the order of work actually landed.
5. `trash-2` on another user → confirmation modal naming them; Cancel leaves the row, Confirm removes
   it (AC-6). With a second admin session, confirm deleting the only administrator → refused with
   `No podés eliminar al último administrador` in `es` (AC-7 — the Spanish string proves REQ-10,
   since it is not what `api` sends).
6. Own row shows no edit, disable or delete icon; the profile modal from the user menu still edits
   name, username and password (AC-8).
7. `user-x` on an enabled user → status badge flips, icon becomes `user-check`, and that user's open
   session is bounced to `/login` on their next request (AC-9).

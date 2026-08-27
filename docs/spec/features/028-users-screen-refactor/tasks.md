---
title: Users screen refactor — Tasks
last_updated: 2026-08-26
status: In Progress
---

# TASKS: Users screen refactor (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

## Tasks

### Group 1 — the error contract (`api`)

There is no SDL delta in this feature, so this group is not a gate on Group 2 the way it usually is
(see `plan.md` § Order of Work). It is listed first because it is the one behavioural change the
whole edit path rests on: until it lands, a rename onto a taken username reports "user not found"
and AC-4 is red no matter what `web` does.

- [ ] **T001** `[api]` In `services/api/src/users/users.service.ts`, add the duplicate-username check
      to `update()`, copying the shape `updateProfile()` already uses: run it **only when
      `updateUserInput.username` is defined**, and throw
      `i18nError.conflict(ERROR_KEYS.USER_USERNAME_TAKEN)` when a row with that username exists whose
      `id` is not the id being updated. Do not add an error key, do not touch the resolver, do not
      reorder the existing self-disable / last-enabled-admin checks relative to each other, and leave
      the `try`/`catch` around `prisma.user.update` alone.
      *Done when:* `bin/cli api npx --no tsc --noEmit` prints nothing, `bin/npm api run test` is
      still green, and `git status --short services/api/prisma/` prints nothing.
- [ ] **T002** `[api]` Extend the `update` describe block in
      `services/api/src/users/users.service.spec.ts` with exactly two cases: renaming a user onto
      another user's username throws `ConflictException` and never calls `prisma.user.update`; an
      update whose `username` equals the target's own current username reaches `prisma.user.update`
      and succeeds. Keep the file's header paragraph accurate. Do not add a case for
      `username: undefined` — the existing enable/disable cases already cover that path, and they go
      red if T001's guard is missing. → T001
      *Done when:* `bin/npm api run test` is green with the `UsersService` suite grown by exactly two
      cases and none lost.

### Group 2 — `web` foundations

Independent of Group 1: no SDL changed, so these are written against a contract that is already
true. This group may run alongside Group 1 in full.

- [ ] **T003** `[web] [P]` In `services/web/src/components/ui/button/Button.tsx`, add a `danger`
      variant to the `variant` union (red, built the way `primary` is:
      `bg-error-500 text-white hover:bg-error-600 disabled:bg-error-300`) and an optional
      `ariaLabel` prop forwarded to the element's `aria-label`. Both additive — no existing call site
      changes.
      *Done when:* `bin/cli web npx --no tsc --noEmit` prints nothing and `bin/npm web run lint` is
      clean; no file outside `Button.tsx` is modified.
- [ ] **T004** `[web] [P]` In `services/web/src/components/form/input/InputField.tsx`, add an
      optional `value?: string` forwarded to the `<input>`, leaving `defaultValue` in place so every
      existing (uncontrolled) call site keeps working.
      *Done when:* `bin/cli web npx --no tsc --noEmit` prints nothing; no file outside
      `InputField.tsx` is modified.
- [ ] **T005** `[web] [P]` Rework the `users` namespace and add the `errors.user` namespace in
      `services/web/messages/en.json` and `services/web/messages/es.json`, per `web/plan.md` step 3:
      `users.add`, `users.modal`, `users.delete`, `users.table` (column headers and badges kept; the
      four text action labels replaced by tooltip/accessible-name strings; `disableSelfTitle` and
      `deleteSelfTitle` removed), and all seven `errors.user.*` keys — `username_taken`, `not_found`,
      `cannot_disable_self`, `cannot_disable_last_admin`, `cannot_delete_self`,
      `cannot_delete_last_admin`, `unsupported_locale`. `es` copy in the Rioplatense register, using
      the exact sentences in `spec.md`'s error table.
      *Done when:* `bin/cli web node scripts/check-messages.mjs` exits 0.
- [ ] **T006** `[web] [P]` Convert the four actions in `services/web/src/actions/users.ts` from
      `(prevState, formData)` to direct arguments, per `web/plan.md` step 4:
      `createUserAction({ name, username, password, passwordConfirmation })` (keeps the mismatch
      check), **new** `updateUserAction({ id, name, username })` sending
      `updateUserInput: { id, name, username }` and nothing else — no `password`, no `isEnabled`, no
      `isAdmin`, built field by field rather than spread — `setUserEnabledAction(id, isEnabled)` with
      the boolean staying a boolean, and `deleteUserAction(id)`. All four keep
      `revalidatePath("/users")`, `redirectIfUnauthenticated(errors)` and the
      `translateGraphQLError` return contract. Add `name`/`username` to `UPDATE_USER_MUTATION`'s
      selection set.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports errors only in
      `UsersManager.tsx` (the not-yet-rewritten caller) and nowhere else, and
      `grep -n "password" services/web/src/actions/users.ts` shows no occurrence inside
      `updateUserAction`.

### Group 3 — the screen (`web`)

- [ ] **T007** `[web]` Create `services/web/src/components/users/UserModal.tsx`, modelled on
      `ProfileModal.tsx`: props `{ isOpen, onClose, user? }` where an absent `user` means create
      mode; controlled fields re-seeded by a `useEffect` keyed on `isOpen`; four fields in create
      mode and **name + username only** in edit mode (no hidden password field); `UserPlus` /
      `UserPen` in the heading; Cancel `variant="danger"` before a blue primary Save; on error set
      the message and return **before** `onClose()`; on success `onClose()` then `router.refresh()`.
      → T003, T004, T005, T006
      *Done when:* opening the modal from a temporary trigger shows four fields for create and two
      for edit, and a rejected save leaves the modal open with the typed values intact.
- [ ] **T008** `[web]` Create `services/web/src/components/users/DeleteUserDialog.tsx`: a `Modal`
      (never `window.confirm()`) naming the target user, a `danger` confirm and an outline cancel,
      calling `deleteUserAction(user.id)`; on failure the dialog stays open showing the translated
      message. → T003, T005, T006
      *Done when:* `bin/cli web npx --no tsc --noEmit` prints nothing for this file and the dialog
      renders the target's name in its sentence.
- [ ] **T009** `[web]` Rewrite `services/web/src/components/users/UsersManager.tsx` per
      `web/plan.md` step 7: delete `CreateUserForm` entirely, including the `defaultValue`-mirroring
      block and its comments; keep the table and its five columns; add the "Add user" `Button` with
      the `UserPlus` icon beside the table heading; lift the edit/delete dialog state to
      `UsersManager` rather than mounting a modal per row; replace the two per-row `<form>` elements
      with icon buttons — `UserPen`, `UserX`/`UserCheck` chosen from `user.isEnabled`, `Trash2` in
      red — each carrying `title` and `ariaLabel` from the catalog; and render **none** of the three
      on the caller's own row (not disabled ones). `src/app/(dashboard)/users/page.tsx` and
      `src/types/users.ts` stay untouched. → T007, T008
      *Done when:* `/users` shows no create form, one "Add user" control, four icon actions per other
      user's row and zero on the caller's own row.

### Group 4 — verification and docs

- [ ] **T010** `[web]` Run the full `web` check set and fix anything it surfaces inside this
      feature's files. → T009
      *Done when:* `bin/cli web npx --no tsc --noEmit` prints nothing, `bin/npm web run lint` is
      clean with no new suppression, `bin/cli web node scripts/check-messages.mjs` exits 0, and
      `bin/npm web run build` exits 0.
- [ ] **T011** `[docs]` Update `services/web/CLAUDE.md` § "Admin user management": the component list
      (`UserModal.tsx`, `DeleteUserDialog.tsx`), the four actions' new signatures, the fact that row
      actions are icons and the caller's own row renders none of them, and **remove** the now-false
      bullet about `formData.get("isEnabled") === "true"`. Keep the `page.tsx`
      sequential-not-`Promise.all` bullet — unchanged and still true. Re-measure and update the root
      `CLAUDE.md` § "Current state" counts. The root pipeline table needs no change: no stage changed
      status. → T002, T010
      *Done when:* every statement in that section is true of the code on disk, and the root
      `CLAUDE.md` test counts match a fresh `bin/npm api run test`.
- [ ] **T012** `[docs]` Walk the acceptance criteria in `spec.md` — AC-1 through AC-9 by hand in the
      browser as an administrator, once in `en` and once with `User.uiLocale = es`, following
      `plan.md` § Verification's manual pass; AC-10 from the command output of T002 and T010. Tick
      each box, then set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and
      `web/plan.md`, and `status: Done` here. → T011
      *Done when:* every AC box in `spec.md` is ticked and all four files read `status: Implemented`.

**Acceptance-criteria coverage.** AC-1 → T009. AC-2, AC-3, AC-5 → T006+T007+T009. AC-4 → T001+T002
(the api half) and T007 (the display half). AC-6, AC-7 → T008. AC-8 → T009. AC-9 → T006+T009. AC-10
→ T002, T010. Every criterion is reachable; none is left to a task that does not exist.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

---
title: Profile Edit — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-19
status: Approved
---

# PLAN: Profile Edit (`plan.md`)

## Approach

`api` gains one mutation and no schema change. The write itself is a third method on the existing
`UsersService` (`services/api/src/users/users.service.ts`) — it is already the only class that knows
how a `User` row is written: it hashes with `bcrypt` at 10 rounds in both `create()` and `update()`,
and it already owns the duplicate-username check and its exact message. `updateProfile()` reuses all
of that rather than growing a second write path next to it.

What it cannot reuse is `UsersResolver`, because `@UseGuards(AdminGuard)` sits on the **class**
(`users.resolver.ts:14`), deliberately, so that an operation added later cannot forget the guard.
Adding a self-service mutation there would mean either weakening that class-level guard or
per-method overriding it — both turn the admin surface into a mixed-authorisation class, which is
the property that made it safe. So the mutation gets its own resolver, `ProfileResolver`, in the same
`users/` module, guarded like `me` is: authenticated caller, target read from `@CurrentUser()`, no id
argument. The module's `AuthModule` import already supplies everything that needs (the decorator and
`JwtAuthGuard` come from there).

`UpdateProfileInput` is a new `@InputType()` and not a reshaping of `UpdateUserInput`. The admin
input carries `id` and `isEnabled`; a self-service mutation that accepted either is a
privilege-escalation hole shaped like reuse. Three fields, three validators, no inheritance — and
`main.ts`'s `whitelist: true` then strips anything a caller sends beyond them, which is the mechanism
that makes REQ-7 true rather than merely intended (a field with no validator is invisible to the
whitelist and silently dropped — the bug `003-auth-user-management` left in `UpdateUserInput` and
`004-user-disable` had to fix; every field here carries a decorator for that reason).

On `web` the modal is a new client component rendered from `UserDropdown`, which is already a client
component holding the open/closed state of the panel and already receives the resolved `CurrentUser`
as a prop from `AppHeader.tsx:192`. It needs no new query: the values that pre-fill the form are the
ones the header already has.

The form itself follows `ImportMagnetModal` (`src/components/import/importMagnetModal.tsx`) —
controlled `useState` values, an `onSubmit` handler, `router.refresh()` on success — and **not**
`CreateUserForm`'s `useActionState` + `<form action={fn}>` shape. This is the one place the plan
picks the less common of two in-repo patterns, and the reason is REQ-8: React 19 natively calls
`HTMLFormElement.reset()` the instant a `<form action={fn}>` is submitted, before the action runs and
regardless of the outcome, so an error response leaves the user staring at a blanked form.
`CreateUserForm` works around that by mirroring every value into `defaultValue` via `onChange`
(`UsersManager.tsx:38-67`) — which is controlled state wearing a costume. Controlled inputs with an
`onSubmit` handler get REQ-8 for free, keep native constraint validation intact (an invalid field
blocks the `submit` event before the handler runs, which is exactly REQ-5), and are what every modal
in this repo already does.

The one thing this slice does **not** copy from `ImportMagnetModal` is how it learns about failure.
That component `throw`s from its server action and reads `err.message` in the browser — which works
in dev and is redacted to a generic string by Next in a production build. This feature's action
returns `{ error } | { success: true }`, the shape `services/web/CLAUDE.md` documents for form
actions and `src/actions/users.ts` uses throughout. See § Decisions below.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 0 | — | `019-user-menu` should land first. It rewrites the same component this feature edits, and its *Editar perfil* entry is the trigger. See the dependency note below. |
| 1 | `api` | Owns the contract. `web` cannot call a mutation the schema does not have, and there is no codegen to tell it so — it would compile fine and fail at runtime. |
| 2 | `web` | Consumes `updateProfile`, including every error string in the table. |

**No steps run in parallel.** There are two, they are sequential, and the feature is small enough
that overlapping them buys nothing but a runtime mismatch. `web` may be written against the frozen
delta before `api` merges, but it cannot be *verified* until step 1 is up in the dev stack.

**Dependency on `019-user-menu`.** That feature is Approved and not yet implemented, and its amended
REQ-7 leaves *Editar perfil* as a destination-less `DropdownItem` — precisely so this feature can
hang a modal on it. If `019` has landed, the `web` slice adds `onItemClick` state and the modal. If it
has **not**, the `web` slice wires the modal onto the existing *Edit profile* entry, deletes its
`href="/profile"`, and does nothing else from `019`'s rewrite — no icon swap, no trigger change, no
entry deletions. Do not implement `019` from inside this feature, and stop and report if the file
looks like neither shape.

## Contract Freeze

`spec.md` § GraphQL Contract Delta is frozen as of `status: Approved`. Things an implementer will be
tempted to change and must not:

- **`updateProfile` takes no `id`.** From inside `api` it looks inconsistent with every other
  mutation in the `users` module. That is the point: an id argument is a thing an attacker can
  change, and `@CurrentUser()` is not. It also means `web` never needs the caller's id in the
  request, only in the pre-filled form.
- **`password: String` is nullable in the SDL and omitted-not-empty on the wire.** `web` will be
  tempted to always send the field (simpler `variables` object) with `""` when unchanged. Sending
  `""` is a validation error by design — it is what keeps a blank input from ever being interpreted
  as "hash the empty string" if the validator is later loosened.
- **`passwordConfirmation` does not exist on the input.** It is a form rule, not a contract field.
  Do not add it to `UpdateProfileInput` "so the backend can check too" — the backend has nothing to
  compare, it receives one password.
- **The five error messages are the ones `api` already throws.** Do not reword them here, and do not
  add a sixth. `018-ui-i18n` is the feature that will turn all of them into keys; a new literal added
  now is one more string for that migration to find.
- **`UpdateUserInput`, `updateUser` and `/users` are untouched** (NFR-1). A "while I'm here"
  refactor that makes the admin input reuse the profile input breaks the admin screen's `isEnabled`
  toggle at runtime, not at compile time.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief both services
(Constitution, Article VIII).

## Migrations

**None.** `User` already has `name`, `username` (`@unique`) and `password`. No Prisma schema change,
no migration directory, no backfill. `git status services/api/prisma/` must stay empty for this
feature — if it is not, something was misunderstood.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `updateProfile` writes whatever the input object carries (`data: { ...input }`) | **Silent privilege escalation.** The day someone adds a field to `UpdateProfileInput`, or the whitelist is relaxed, a user can send `isAdmin: true` and get it. Nothing errors; the response looks like a normal success. | The service builds its `data` object field by field, never spreading the input. `users.service.spec.ts` gets a case asserting the object passed to `prisma.user.update` has exactly the expected keys — it fails the moment someone spreads. |
| The uniqueness check does not exclude the caller | Not silent, but maddening: saving the form without touching `username` returns "El nombre de usuario ya está registrado", because the user collides with themselves. | The check compares the found row's `id` against the caller's; covered by a spec case that submits the caller's own current username and expects success. |
| The password is stored unhashed | **Silent in the direction that matters**: the write succeeds, the row looks populated, and the account is simply unlogin-able afterwards while the plaintext sits in the database. This exact bug already existed in `update()` before `003-auth-user-management` fixed it. | `updateProfile` calls the same `bcrypt.hash(…, 10)`; `users.service.spec.ts` asserts the stored value is not the submitted string and that `bcrypt.compare` matches it. |
| An omitted password overwrites the existing hash | Silent until the next login. If the service passes `password: undefined` into a hash call the request errors loudly, but if it passes an *empty* or hashed-empty value the row is quietly destroyed. | The `password` key is only added to the `data` object when the input actually carries a non-empty string; spec case: an input with no password leaves `password` absent from the update payload entirely. |
| `web` submits with `<form action={formAction}>` | **Silent, and only on the error path**: React 19 resets the form on submit, so a rejected save comes back with the banner showing and every field blank — REQ-8 violated, no error anywhere. | Controlled state + `onSubmit`, per § Approach. Named again in `web/plan.md` § Existing code to reuse. |
| The header keeps the old name after a successful save | Silent. The write landed, the modal closed, the menu still says the old thing — and the user reasonably concludes the save failed and does it again. | `router.refresh()` after `onClose()`, the same pairing `ImportMagnetModal` uses; AC-2 checks the header without a reload. |
| `018-ui-i18n` lands first and this slice adds Spanish literals | Silent regression: new hardcoded strings appear after the migration moved everything to keys, showing up only as an untranslated modal for an `en` user. | NFR-3 scopes this feature to literals *as the app stands today*. Before implementing `web`, check whether `018` has already migrated `src/components/header/`; if it has, take the labels from the catalog and report that NFR-3 is stale rather than reverting someone else's migration. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
grep -rn "/profile" services/web/src
```

The two typechecks must report **0 errors** and the build must exit **0** — the counts recorded in
the root `CLAUDE.md` § Current state — reported before and after so the slice proves it added nothing
(NFR-4). `bin/npm api test` must show the suite count up by the new `updateProfile` cases with no
failures. The `grep` must return nothing (AC-10). `bin/npm web run lint` is not a gate: `biome check`
reports ~1598 pre-existing errors across the TailAdmin template either way — judge the new files by
running Biome on those paths.

Then the manual pass, stack up (`bin/dev`), signed in as a non-admin user (to prove the path does not
depend on `AdminGuard`):

1. Open the user menu, click *Editar perfil* — the modal opens pre-filled with the current name and
   username, both password fields empty, URL unchanged (AC-1).
2. Change the name, save — modal closes, the header shows the new name without a reload; reopen to
   confirm it stuck, and check the row:
   `bin/mysql -e 'select name, username from users where username = "<username>"'` (AC-2).
3. Change the username to a free value, save, then navigate to another screen — no bounce to
   `/login`. Sign out and back in with the new username (AC-3).
4. Set both password fields to the same new value, save, sign out, sign in with the new password;
   confirm the old one is refused (AC-4).
5. Set the username to one another user already has, save — modal stays open, red banner reads
   `El nombre de usuario ya está registrado`, focus is on the first field, every typed value is still
   there, and the row is unchanged in the database (AC-5).
6. Clear the name, press save — the browser blocks it; nothing in the network tab (AC-6).
7. Fill one password field only, then two that differ — banner, no request either time (AC-7).
8. From the GraphQL playground with a browser cookie, call `updateProfile` with a 3-character
   password (AC-8), then with `Authorization: Bearer $SERVICE_TOKEN` (AC-9).

## Decisions this plan makes that `spec.md` did not cover

- **The mutation lives in `users/`, in its own `ProfileResolver`**, not on `AuthResolver` next to
  `me`. `auth/` owns sessions and credentials; `users/` owns writes to the `User` row, and the write
  logic being reused is `UsersService`'s.
- **`updateProfileAction` returns `{ error?: string } | { success: true }` instead of throwing.**
  Both shapes exist in this repo. The returning shape is the one `services/web/CLAUDE.md` documents
  for form actions, and thrown server-action errors are redacted to a generic message by Next in a
  production build — which would turn every message in the contract's error table into "an error
  occurred" the moment the app runs under `bin/prod`.
- **The two `web`-local password messages are new Spanish literals**, and they are the only new
  user-facing strings in the feature. They live in `src/actions/profile.ts` next to the action that
  produces them, not in the component.
- **`revalidatePath` is not called.** The header's data comes from the dashboard layout's
  `getCurrentUser()`, which reads the auth cookie and is therefore dynamic on every request;
  `router.refresh()` re-renders it. Adding `revalidatePath('/', 'layout')` would invalidate every
  cached route for a change to one row that no cached route contains.
- **`ProfileResolver` carries an explicit `@UseGuards(JwtAuthGuard)`** even though the guard is
  already global via `APP_GUARD` (`app.module.ts:60`), mirroring `AuthResolver.me`. It is redundant
  and it is the local idiom for a self-scoped operation; the global guard is what actually delivers
  AC-9, since a service principal is rejected wherever `@AllowService()` is absent.

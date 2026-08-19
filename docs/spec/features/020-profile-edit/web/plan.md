---
title: Profile Edit — web slice
service: web
last_updated: 2026-08-19
status: Approved
---

# PLAN: Profile Edit — `web` (`web/plan.md`)

## Scope

This slice builds the profile modal and the server action behind it: a form over `name`, `username`
and a new-password pair, opened from *Editar perfil* in the header user menu, submitting to `api`'s
`updateProfile`, closing on success and refreshing the header so the name updates in place.

It is **not** adding a route. No `/profile` page, no directory under `src/app`, no `href` anywhere
pointing at one — `../spec.md` AC-10 greps for exactly that. It is not changing `ME_QUERY`,
`CurrentUser`, `getCurrentUser`, the dashboard layout, `src/actions/users.ts` or the `/users` screen.
It does not implement `019-user-menu` (see the dependency note in `../plan.md` § Order of Work) and
it does not validate anything the API is authoritative about beyond what the browser does natively.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report (see
`.claude/agents/web.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/actions/profile.ts` | New | `'use server'`, `UPDATE_PROFILE_MUTATION`, `updateProfileAction`. |
| `services/web/src/components/profile/ProfileModal.tsx` | New | The client modal: four controlled inputs, red banner, focus handling. |
| `services/web/src/components/header/UserDropdown.tsx` | Modified | Holds the modal's open state; *Editar perfil* opens it instead of navigating. |

## Existing code to reuse

- `src/components/import/importMagnetModal.tsx` — **the pattern for this whole component**:
  `"use client"`, `Modal` from `@/components/ui/modal`, controlled `useState` values, a
  `useEffect` that resets state when `isOpen` flips, an `async handleSubmit(e)` with
  `e.preventDefault()`, an `isPending` flag disabling the submit button, `onClose()` then
  `router.refresh()` on success. Copy its structure and its markup skeleton (the
  `max-w-[700px] m-4` modal shell, the heading block, the footer button row).
- `src/components/ui/modal/index.tsx` — `Modal` already handles Escape, the backdrop click and
  body-scroll locking. Do not add any of that; do not modify the component.
- `src/components/form/input/InputField.tsx` (`Input`) and `src/components/form/Label.tsx` —
  the field pair used everywhere. `Input` accepts `required`, `minLength`, `autoComplete`, `hint`,
  `error` and `defaultValue`/`onChange`. **It does not forward a `ref`** — focusing a field (REQ-8)
  goes through the `<form>` ref and `form.elements.namedItem("name")`, the way `CreateUserForm`
  already reaches its inputs (`UsersManager.tsx:55-66`). Do not add ref forwarding to the shared
  component.
- `src/components/ui/button/Button.tsx` — the submit/cancel buttons.
- `src/components/users/UsersManager.tsx` — take **only** two things from it: the red banner class
  (`ERROR_CLASS = "text-sm text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg"`) and the
  `form.elements.namedItem` idiom. Do **not** copy its `useActionState` + `<form action={fn}>`
  submission shape — see § Steps step 3.
- `src/actions/users.ts` — the server-action shape this action follows: module-level
  `SCREAMING_SNAKE` document, `fetchGraphQL` in a `try/catch` returning
  `"Error de conexión con el servidor GraphQL."`, `redirectIfUnauthenticated(errors)` before
  anything else, then `errors[0].message` passed through **unmodified**.
- `src/lib/auth-session.ts` — `redirectIfUnauthenticated` is what turns the contract's
  `No autenticado` into a cookie-clearing redirect to `/login`. Legal here because this is a Server
  Action, not a Server Component render (that distinction is why `getCurrentUser` uses
  `redirectToClearSession` instead — do not swap them).

## Steps

1. **`src/actions/profile.ts`** — `'use server'`; `const UPDATE_PROFILE_MUTATION` for
   `updateProfile(updateProfileInput: $updateProfileInput) { id name username }`;
   `export async function updateProfileAction(input: { name: string; username: string; password?:
   string; passwordConfirmation?: string }): Promise<{ error?: string } | { success: true }>`.
   Order inside it:
   1. The two pair rules, **before any network call** (REQ-4): exactly one of
      `password`/`passwordConfirmation` non-empty → `{ error: "Completá ambos campos de contraseña o
      dejá los dos vacíos" }`; both non-empty and different → `{ error: "Las contraseñas no
      coinciden" }`. These two strings are `web`-local and appear nowhere in `api`.
   2. Build `variables`: `{ updateProfileInput: { name, username, ...(password ? { password } : {})
      } }`. **The key is omitted, never sent as `""`** — `../plan.md` § Contract Freeze.
   3. `fetchGraphQL` in a `try/catch`; on a thrown error return
      `{ error: "Error de conexión con el servidor GraphQL." }`.
   4. `if (errors?.length) { await redirectIfUnauthenticated(errors); return { error:
      errors[0].message }; }` — passthrough, unmodified, so all five contract messages reach the
      banner verbatim.
   5. `return { success: true }`. No `revalidatePath` (`../plan.md` § Decisions explains why).
2. **`ProfileModal.tsx`** — `"use client"`, props `{ isOpen, onClose, user }` where `user` is the
   `CurrentUser` the header already holds. Four `useState` values (`name`, `username`, `password`,
   `passwordConfirmation`) plus `error` and `isPending`; a `useEffect` on `isOpen` that re-seeds
   `name`/`username` from `user`, blanks both password fields and clears `error`, so reopening after
   a cancel never shows stale text.
3. **The form** — `<form ref={formRef} onSubmit={handleSubmit}>` with **controlled** `value` +
   `onChange` inputs. Not `useActionState`, not `<form action={fn}>`: React 19 resets an
   action-form's fields on submit before the action runs, which blanks the form on every error and
   breaks REQ-8 silently. Native constraint validation stays on (no `noValidate`): `name` and
   `username` get `required`, `username` `minLength={3}`, both password fields `minLength={6}`
   (they are **not** `required`) and `autoComplete="new-password"`. An invalid field blocks the
   `submit` event before `handleSubmit` runs — that is REQ-5, delivered by the browser, and it is
   why AC-6 expects no request at all.
4. **`handleSubmit`** — `e.preventDefault()`, `setIsPending(true)`, `setError(null)`, `await
   updateProfileAction({...})`. On `"error" in result`: `setError(result.error)`, then focus the
   first field — `(formRef.current?.elements.namedItem("name") as HTMLInputElement | null)?.focus()`
   — and return without touching any value (REQ-8). On success: `onClose()` then `router.refresh()`
   (REQ-9), and blank both password fields. `finally { setIsPending(false) }`.
5. **The banner** — rendered **above** the first field, not at the bottom of the form (REQ-8),
   using `ERROR_CLASS`. Optionally pass `error` to the first `Input` for its error styling; the
   banner is the requirement, the red border is not.
6. **`UserDropdown.tsx`** — add `const [isProfileOpen, setIsProfileOpen] = useState(false)`; the
   *Editar perfil* `DropdownItem` gets `onItemClick={() => { closeDropdown();
   setIsProfileOpen(true); }}` and **no `href`** (a `DropdownItem` with `tag="button"`, its default);
   render `<ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} user={user} />`
   as a sibling of the `Dropdown`. If `019-user-menu` has not landed yet, this means deleting that
   entry's `href="/profile"` and nothing else from `019`'s rewrite — read `../plan.md` § Order of
   Work before touching the file.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta (read-only — if it is wrong, stop and report):

```graphql
updateProfile(updateProfileInput: UpdateProfileInput!): User!
# UpdateProfileInput { name: String!  username: String!  password: String }
```

The argument key is `updateProfileInput`; `password` is **omitted** when unchanged, never `""`;
`passwordConfirmation` never leaves this service. Every error condition and what this slice does
with it:

| Message from `api` | What `web` does |
| :-- | :-- |
| `El nombre de usuario ya está registrado` | Banner + focus first field, modal stays open, values intact (AC-5). |
| `El nombre es requerido` | Same. Normally unreachable — the browser blocks it first (AC-6) — but must render if it ever arrives. |
| `El nombre de usuario debe tener al menos 3 caracteres` | Same. |
| `La contraseña debe tener al menos 6 caracteres` | Same. Reachable when the browser's `minlength` is bypassed. |
| `No autenticado` | **Never reaches the banner**: `redirectIfUnauthenticated` clears the cookie and redirects to `/login` first. |

Handling only the happy path compiles fine here and fails at runtime — there is no codegen (see
`docs/spec/graphql-contract.md`).

## Tests

**None owed, and here is why.** `services/web` has no test runner configured (no jest/vitest setup,
no `test` script — `bin/npm web run …` offers `dev`, `build`, `lint`, `format`), so a test here would
mean standing up a framework, which is a separate change. More to the point, nothing in this slice
fails silently: the pair rules and the banner are visible on screen (AC-5, AC-7), a missing
`router.refresh()` shows as a stale name in the header (AC-2), and every authoritative check lives in
`api`, where `users.service.spec.ts` covers it. The failure this slice could hide — an error response
rendered as success — is exactly what AC-5 exercises by hand.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
grep -rn "/profile" services/web/src
```

`tsc` reports **0 errors** and the build exits **0** (report both counts before and after — NFR-4).
The `grep` returns nothing (AC-10). `bin/npm web run lint` is not a gate — Biome reports ~1598
pre-existing errors across the template either way; run it against the two new files only.

---
title: User Menu — web slice
service: web
last_updated: 2026-08-19
status: Approved
---

# PLAN: User Menu — `web` (`web/plan.md`)

## Scope

This slice rewrites the header's user menu: the trigger becomes avatar-only, and the panel becomes
name / *Editar perfil* / *Ajustes* / separator / *Cerrar sesión*, with `lucide-react` icons replacing
five inline SVGs. It is the whole feature — there is no `api` or `worker` slice, no GraphQL delta and
no migration.

It is explicitly **not** building the profile editor. *Editar perfil* gets no `href` and no
destination: it closes the panel and does nothing else. That is the specified end state (REQ-7, AC-5,
amended 2026-08-19), not a loose end to tie off — `020-profile-edit` wires it to a modal, and no
`/profile` route is ever created.
It is also not touching `ME_QUERY` or the `CurrentUser` interface in `src/actions/auth.ts`, not
touching `logoutAction`, and not modifying `Dropdown`/`DropdownItem` — see `../plan.md` § Contract
Freeze.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report (see
`.claude/agents/web.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/header/UserDropdown.tsx` | Modified | The entire component: trigger, panel contents, icons. Expect it to shrink from ~178 lines to well under half that — the bulk of the current file is inline SVG path data. |

No new module. If this slice needs a second file, the plan missed something — report it rather than
creating one.

## Existing code to reuse

- `src/components/ui/dropdown/Dropdown.tsx` — the panel. Reused unchanged, same
  `isOpen`/`onClose`/`className` props the component already passes.
  **`Dropdown.tsx:25` special-cases `.dropdown-toggle` in its outside-click handler.** The trigger
  button must keep that class. Drop it while tidying the trigger's `className` and `mousedown` closes
  the panel before the button's `onClick` reopens it — the menu appears never to open, with no error
  anywhere.
- `src/components/ui/dropdown/DropdownItem.tsx` — each navigating entry. Use `tag="a"` with `href`
  and `onItemClick={closeDropdown}`, exactly as the three current entries already do. Do not
  hand-roll `<Link>` elements; `onItemClick` is what closes the panel.
- `src/actions/auth.ts` — `logoutAction`, kept inside its `<form action={logoutAction}>` with a
  `type="submit"` button, unchanged. `CurrentUser` (the `user` prop's type) is imported from here and
  keeps `username` even though this component stops rendering it.
- `lucide-react` — already a dependency (`^1.28.0`) and already the site's icon source
  (`AppHeader.tsx:9`, `AppSidebar.tsx:15`, `Movie.tsx:2`). Import `User`, `Settings`, `LogOut`.
  Render at `size={18}`, matching in-button usage at `Movie.tsx:74`.
- `next/image` — the avatar stays `<Image src="/images/avatar.png" width={44} height={44} />`, the
  same static asset for every user (REQ-2). No upload affordance.
- The separator — the current file already draws one as `border-b border-gray-200
  dark:border-gray-800` on the entries `<ul>`, with the sign-out form below it. Keep that mechanism;
  do not add an `<hr>` or a new divider component (NFR-2).

## Steps

1. **Trigger** — remove the `<span>` holding `{user.name}` and the inline chevron `<svg>` from the
   button, leaving only the avatar span. Drop the avatar's now-pointless `mr-3`. Keep
   `dropdown-toggle` in the `className`, keep `onClick={toggleDropdown}`. Add
   `aria-label="Menú de usuario"` — with the text gone the button has no accessible name.
2. **`isOpen` is still needed** for the panel, but nothing rotates any more; make sure removing the
   chevron does not leave an unused expression behind.
3. **Panel header** — replace the two-line name/username block with the user's `name` alone as
   non-interactive text (REQ-3). It is the first element in the panel; it is not a `DropdownItem` and
   is not clickable.
4. **Entries** — reduce the `<ul>` to two `<li>`s:
   - *Editar perfil* → icon `User`, **no `href`** (a `DropdownItem` that only runs `onItemClick`).
   - *Ajustes* → `href="/settings"`, icon `Settings`.
   Delete the *Account settings* and *Support* entries outright. Note that *Ajustes* is **not** the
   old *Account settings* relabelled — that one pointed at `/profile` like the other two; this one
   points at the real `/settings` route. No entry may reference `/profile`: that route is never
   built, since `020-profile-edit` opens a modal from this entry instead.
5. **Sign out** — keep the `<form action={logoutAction}>` and its submit button; relabel to
   *Cerrar sesión* and swap the inline SVG for `LogOut`.
6. **Icon styling** — the inline SVGs used `fill-gray-500 group-hover:fill-gray-700 …`, which does
   nothing for lucide icons (they are stroke-based and inherit `currentColor`). Use text colour
   utilities on the icon or let it inherit from the entry's existing `text-gray-700 …
   dark:text-gray-400` classes. Do not port the `fill-*` classes across.
7. **Verify no `<svg>` remains** in the file (AC-6).

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **None — this feature does not cross the service
boundary**, so there is no shape to consume and no error condition to handle. The component receives
the already-resolved `CurrentUser` as a prop from `AppHeader.tsx:192`; it issues no query of its own
and gains no server action.

What that obligates this slice to *not* do: `ME_QUERY` and `CurrentUser` keep `username` even though
nothing in this menu renders it any more (`../plan.md` § Contract Freeze). The delta is read-only —
if it looks wrong, stop and report.

## Tests

**None owed, and the reason is not "web has no test runner"** — though it does not
(`services/web/CLAUDE.md`: no test file, no runner, no `test` script, and adding one is its own
spec, not a byproduct of this task).

The reason is Article IX: nothing in this slice can fail silently. Every requirement is something a
person looking at the header either sees or does not — a chevron that is still there, a menu entry
that does not close the panel, an icon that did not render. The one genuinely quiet failure mode in
the change is the `.dropdown-toggle` class (see § Existing code to reuse), and it is caught by AC-2
the first time anyone clicks the avatar. There is no state, no persistence and no computed result
here that could be wrong while looking right.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
grep -n "<svg" services/web/src/components/header/UserDropdown.tsx
```

Typecheck: **0 errors**. Build: exits **0**. `grep`: no output. Report the typecheck count both
before and after the change — the number is the proof this added nothing (NFR-3).

`bin/npm web run lint` is not a gate: `biome check` reports ~1598 pre-existing errors repo-wide.
Judge this file by running Biome on this file alone.

Then walk `../plan.md` § Verification's five-step manual pass with the stack up.

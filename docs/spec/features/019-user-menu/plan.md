---
title: User Menu — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-19
status: Approved
---

# PLAN: User Menu (`plan.md`)

## Approach

This is a single-file rewrite of `services/web/src/components/header/UserDropdown.tsx`, and the plan
is deliberately shaped to keep it that way. Everything the new menu needs already exists in the
service: the panel is `Dropdown` and the entries are `DropdownItem`
(`src/components/ui/dropdown/`), both reused unchanged per NFR-2; the icons come from
`lucide-react`, already a dependency and already the site's icon source (`AppHeader.tsx`,
`AppSidebar.tsx`, `Movie.tsx`); the sign-out entry keeps its existing `<form action={logoutAction}>`
shape against the server action in `src/actions/auth.ts`; the avatar stays the same `next/image`
against `/images/avatar.png`. Nothing new is introduced — no menu library, no shared component, no
helper. The change is subtractive in every direction except the icon imports.

The one real alternative was to build the entries out of raw `<Link>`/`<button>` elements instead of
`DropdownItem`, since `DropdownItem`'s `baseClassName` default is overridden at every call site here
anyway. Rejected: `DropdownItem` is what closes the panel on click (`onItemClick`), and hand-rolling
that would fork the close behaviour between the two entries that navigate and the one that submits a
form. The existing seam is fine; it is only the contents that are wrong.

Two entries in the current file are not being renamed but **deleted** — *Account settings* and
*Support* are TailAdmin scaffolding that were never wired to anything, and all three current entries
point at the same `/profile`. The new *Ajustes* entry is not the old *Account settings* with a new
label: it points at `/settings`, a route that actually exists. `/profile` disappears entirely:
*Editar perfil* keeps no `href` at all, because `020-profile-edit` opens a modal there instead of
routing (amended 2026-08-19).

## Order of Work

One service, so ordering is internal rather than cross-service. There is no `api` step because there
is no contract delta and no migration.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `web` | The only service in `services:`. Trigger, panel contents and icons are one file; splitting them into stages would leave the header in a half-rewritten state between them. |

**Nothing runs in parallel.** A second agent on this feature would be a second agent on the same
file.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. It says **None**,
and that is the part most likely to be "improved" from inside the slice:

- **The `me` query keeps selecting `username`.** This feature stops *displaying* it (REQ-3), and an
  implementer tidying up will be tempted to drop it from `ME_QUERY` and from the `CurrentUser`
  interface in `src/actions/auth.ts`. Do not. `CurrentUser` is the shared session shape consumed by
  the dashboard layout and by `AppHeader`, not a prop type private to this component; trimming a
  query to match one consumer's new rendering is exactly the kind of unannounced change Article VIII
  exists to stop. `UserDropdown` simply stops reading a field it still receives.
- **`logoutAction` is called as-is.** Its best-effort try/catch around the logout mutation, and the
  cookie deletion that follows it, are load-bearing (`src/actions/auth.ts:83`). The entry changes its
  label and gains an icon; the action does not change.

If any of this turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief. Never patch the
contract from inside the slice.

## Migrations

**None.** No Prisma schema change, no backfill, nothing to roll back.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The `dropdown-toggle` class is dropped while cleaning up the trigger's `className` | Silent. `Dropdown`'s outside-click handler (`Dropdown.tsx:25`) special-cases `.dropdown-toggle` so that clicking the trigger does not immediately close what the trigger just opened. Without it, `mousedown` closes the panel before the button's `onClick` toggles it back — the menu looks like it never opens, and nothing errors. | Named in `web/plan.md` § Existing code to reuse as a class that must survive the rewrite; AC-2 catches it by requiring the panel to actually open. |
| The trigger loses its accessible name | Silent to a sighted reviewer. Removing the visible name (REQ-1) leaves a button whose only child is an `<Image>`, so screen readers announce the alt text or nothing at all. | An explicit `aria-label` on the trigger button — see § Decisions below. |
| An implementer gives *Editar perfil* a destination | The feature quietly grows a profile screen or a `/profile` route nobody specified, in the same PR. | REQ-7 and AC-5 (amended 2026-08-19) make the destination-less entry the expected result; `spec.md` § Out of Scope hands the editor to `020-profile-edit`, which builds it as a modal and never adds a route. |
| `018-ui-i18n` lands first and this slice re-hardcodes Spanish | Silent regression: the file goes back to literals after the i18n migration moved it to keys, and only shows up as one untranslated menu for an `en` user. | NFR-1 scopes this feature to literals *as the file stands today*. Before implementing, check whether `018` has already touched `UserDropdown.tsx`; if it has, the labels come from the catalog and this plan's NFR-1 is stale — stop and report rather than reverting someone else's migration. |

## Verification

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
grep -n "<svg" services/web/src/components/header/UserDropdown.tsx
```

The typecheck must report **0 errors** and the build must exit **0** — both are the counts recorded
in `services/web/CLAUDE.md` after `016-web-build-errors`, so report them before and after to prove
this added nothing (NFR-3). The `grep` must return nothing (AC-6). `bin/npm web run lint` is not a
gate here — `biome check` reports ~1598 pre-existing errors across the template with or without this
change; judge the one file by running Biome on that file.

Then the manual pass, with the stack up (`bin/dev`), signed in:

1. Look at the headbar — avatar only, no name, no chevron, at desktop and mobile widths (AC-1).
2. Click the avatar — the panel opens and reads: name, *Editar perfil*, *Ajustes*, separator,
   *Cerrar sesión*, and nothing else. The username appears nowhere (AC-2).
3. Click *Ajustes* — lands on `/settings`, panel closed (AC-3).
4. Reopen, click *Editar perfil* — the panel closes and nothing else happens: same URL, no 404, no
   navigation. This is the failure-path criterion and the dead entry is expected (AC-5).
5. Reopen, click *Cerrar sesión* — session ends, browser sits on `/login` (AC-4).

## Decisions this plan makes that `spec.md` did not cover

- **The trigger gets `aria-label="Menú de usuario"`.** REQ-1 removes the only text in the button;
  Spanish, because it is user-facing copy.
- **The name is not interactive.** REQ-3 calls it "the first element", REQ-6 lists exactly three
  clickable entries and the name is not one of them. It renders as plain text, not a `DropdownItem`.
- **Icons render at `size={18}`**, matching in-button lucide usage in `Movie.tsx:74`, rather than the
  24px the inline SVGs use today.

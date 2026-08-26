---
title: Header redesign and 16px type base — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-25
status: Approved
---

# PLAN: Header redesign and 16px type base (`plan.md`)

## Approach

Everything happens inside `services/web`. There is no schema, no GraphQL, no server action and no
new module: this is a rewrite of one layout component, one addition to an existing dropdown, three
file deletions and a mechanical sweep over two Tailwind classes.

`src/layout/AppHeader.tsx` collapses from a two-row, breakpoint-branching structure into a single
flex row that is identical at every width — sidebar toggle, search form, avatar — so REQ-5 (search
visible on mobile) falls out of the structure rather than needing a second mobile-only markup path.
The `isApplicationMenuOpen` state and the row it revealed disappear with the icons it was built to
hide; the `⌘K` `useRef`/`useEffect` pair stays exactly as it is, only moving with the form.

The theme toggle is not *moved* — `ThemeToggleButton` is a 44px round button with two inline SVGs
and no markup that fits a dropdown row. It is **re-expressed** as a fourth `DropdownItem` inside
`src/components/header/UserDropdown.tsx`, reusing what that file already established in `019-user-menu`:
`lucide-react` icons (`Sun`/`Moon`, alongside its existing `User`/`Settings`/`LogOut`), the
`DropdownItem` component, and its `onClick` + `onItemClick` pair — `onClick={toggleTheme}`,
`onItemClick={closeDropdown}` — so no new handler shape is invented. The state source is unchanged:
`useTheme()` from `src/context/ThemeContext.tsx`, the same hook the deleted button called. With its
last reference gone, `src/components/common/ThemeToggleButton.tsx` is deleted; `ThemeTogglerTwo.tsx`
is **not** — `src/app/(auth)/layout.tsx` still renders it on the login screen.

The two inline SVGs the header keeps (hamburger/close, magnifier) are replaced with `lucide-react`
`Menu`, `X` and `Search`. This is not scope creep: the feature already deletes every other inline
SVG in the file, `lucide-react` is a direct dependency used by `AppSidebar.tsx` and `UserDropdown.tsx`,
and leaving two hand-copied path blobs behind in a file whose whole point was removing them would be
the odd outcome. No icon library is added.

The 16px base is two edits in `src/app/globals.css` — `text-base` onto the `body` `@apply`, and the
removal of `text-theme-sm` from the `menu-item` / `menu-dropdown-item` `@utility` blocks — plus a
find-and-delete of `text-sm` / `text-theme-sm` across 33 files. The `@theme` tokens themselves
(`--text-theme-sm`, its line-height) are **kept**: they are the TailAdmin scale, `text-theme-xs`
(12 uses) and `text-theme-xl` (3 uses) still resolve against neighbours in that block, and deleting
one rung of a scale to satisfy a class sweep is a different change than the one being asked for.

## Order of Work

One service, so this is sequence rather than coordination. The order matters only in that deletions
come after the code that referenced them is gone — a deletion made first turns the typecheck red and
hides whatever the next step breaks.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `web` | `UserDropdown.tsx` gains the theme item + both catalogs gain its keys — the header cannot drop the theme button until its replacement exists (REQ-4) |
| 2 | `web` | `AppHeader.tsx` rewritten to the three-element single row (REQ-1/2/5/7/8) |
| 3 | `web` | Delete `NotificationDropdown.tsx`, `ThemeToggleButton.tsx`, and the `notifications` catalog namespace — now unreferenced (REQ-3) |
| 4 | `web` | `globals.css` base size + the `text-sm`/`text-theme-sm` sweep across `src/` (REQ-9) |
| 5 | `web` | Verification pass (see below) |

**Nothing runs in parallel.** Steps 1–3 touch overlapping files and step 4 rewrites lines in files
steps 1–2 just rewrote; splitting them across concurrent agents produces conflicts, not speed.

## Contract Freeze

`spec.md` § GraphQL Contract Delta says **"None — this feature does not cross the service boundary."**
That is the frozen statement, and it is a real constraint, not a formality. Two things an implementer
will be tempted to do and must not:

- **Wiring the header search to anything.** REQ-6 and AC-4 make the input's *inertness* a
  requirement. It looks like an unfinished feature; it is a deliberate deferral (`spec.md` § Out of
  Scope). Adding a submit handler that navigates, a server action, or a `searchMedia` call is a
  contract change smuggled in as a bugfix.
- **Restoring an entry point to `/movies/add` / `/shows/add`.** Those routes become unreachable from
  the UI by design. Do not add a sidebar item, a floating button, or a redirect as a consolation.

Persisting the theme to `User` is likewise out — `ThemeContext`'s `localStorage` is the storage, and
adding a preference field is `api` work belonging to `021-user-preferences`.

## Migrations

**None.** No Prisma schema change, no data, nothing to roll back. Reverting this feature is
`git revert`.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `.dropdown-toggle` dropped from the avatar button during the header rewrite | `Dropdown.tsx:25`'s outside-click handler stops special-casing the trigger, so the click that opens the panel immediately closes it. The menu simply never opens — **no error anywhere**, in any console | Called out in `web/plan.md` § Existing code to reuse; AC-5 opens the dropdown by hand |
| The `<form>` keeps its default submit | Enter in the search input submits a form with no action → full page GET reload. Reads as "the search does something", violating AC-4, and no error is logged | Step 2 adds `onSubmit={(e) => e.preventDefault()}`; the `⌘K` badge becomes a non-interactive `<span>` instead of an implicit `type="submit"` button |
| The `⌘K` `useEffect`/`inputRef` is dropped or rewired while moving the form | The shortcut silently stops focusing. Nothing throws; the badge still renders, so the UI claims a shortcut that no longer exists | REQ-7 + AC-3 test it at both widths; the effect is moved verbatim, not rewritten |
| A catalog key removed from `en.json` but not `es.json` (or vice versa) | next-intl renders the raw key path (`notifications.title`) to the user instead of throwing | `node scripts/check-messages.mjs` in the verification pass; NFR-2 |
| The `text-sm` sweep hits a `text-sm` inside a longer identifier or a string literal | A blind `sed` corrupts a class name or a message; nothing fails until that screen renders | Sweep file-by-file with the typecheck and `next build` after, not a repo-wide substitution. The 33 files are listed in `web/plan.md` |
| Over-correcting the type-size drift | An implementer sees a page grow and starts adding `text-[14px]` or reintroducing `text-sm` locally, restoring exactly what REQ-9 removed | NFR-4 declares the drift accepted; AC-7 greps for zero matches |

Two things that look risky and are not: the `text-sm` occurrences in `globals.css` lines 535–625 sit
in **FullCalendar** and **flatpickr** overrides, and lines 377/381 in flatpickr — the `/calendar`
route does not exist in `src/app/(dashboard)/`, so that CSS styles nothing today. And the theme label
derives from client state, but the dropdown only renders after a click, i.e. post-hydration, so
`ThemeContext`'s `useState("light")` → `localStorage` effect cannot produce an SSR mismatch here.

## Verification

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
grep -rn 'text-sm\|text-theme-sm' services/web/src
grep -rn 'NotificationDropdown\|ThemeToggleButton' services/web/src
```

Expected: 0 typecheck errors, `build` exits 0, `check-messages` exits 0, and **both greps return
nothing**. Report the typecheck error count and the build exit code before and after the change —
this service has no test suite, so those two numbers plus the manual pass are the entire gate
(`services/web/CLAUDE.md` § Tests). Do not run `bin/npm web run lint` as a gate; run Biome on the
touched files only.

Manual pass, signed in, on `/movies`:

1. Desktop width — the header shows the sidebar toggle, the search input with its `⌘K` badge, and
   the avatar, and nothing else (AC-1).
2. Resize to 375px and reload — same three elements on one row, badge gone, toggle still opens and
   closes the mobile sidebar (AC-2).
3. Press `⌘K` / `Ctrl+K` at both widths — focus lands in the input (AC-3).
4. Type into the input and press Enter — nothing happens: no navigation, no reload, no console
   error (AC-4).
5. Click the avatar — the panel opens; the theme entry flips the app light↔dark; reopening shows the
   entry reflecting the current theme; *Configuración* still navigates and *Cerrar sesión* still
   logs out (AC-5).
6. DevTools — computed `font-size` is `16px` on `body` and on the header input (AC-6).

---
title: Header redesign and 16px type base — web slice
service: web
last_updated: 2026-08-26
status: Implemented
---

# PLAN: Header redesign and 16px type base — `web` (`web/plan.md`)

Read `../spec.md` and `../plan.md` first. Both are read-only to you.

## Scope

`web` is the only service in this feature. You own all of it: the header rewrite, the theme entry in
the avatar dropdown, three deletions, and the 16px type base.

What you are explicitly **not** doing: nothing crosses into `api` or `worker`, no server action is
added or changed, no GraphQL document is written or edited, and the header search input stays inert
(`../spec.md` REQ-6 / AC-4 — treat "the search doesn't search" as the specification, not a bug).
Do not restore an entry point to `/movies/add` or `/shows/add`, and do not persist the theme to the
user record.

Writes are confined to `services/web/` and this spec directory. Anything else is a stop-and-report
(`.claude/agents/web.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/header/UserDropdown.tsx` | Modified | Fourth `DropdownItem`: theme toggle, `Sun`/`Moon` from `lucide-react`, wired to `useTheme()` |
| `services/web/src/layout/AppHeader.tsx` | Modified | Rewritten: one flex row — sidebar toggle, search form, `UserDropdown` — at every breakpoint |
| `services/web/messages/en.json` | Modified | `+userMenu.themeLight`, `+userMenu.themeDark`; drop the whole `notifications` namespace |
| `services/web/messages/es.json` | Modified | Same two keys in Rioplatense register; same namespace dropped |
| `services/web/src/components/header/NotificationDropdown.tsx` | **Deleted** | Template demo data, last reference removed by the header rewrite |
| `services/web/src/components/common/ThemeToggleButton.tsx` | **Deleted** | Replaced by the dropdown entry; last reference removed |
| `services/web/src/app/globals.css` | Modified | `text-base` on `body`; `text-theme-sm` out of the two `@utility` blocks; `text-sm`/`!text-sm` out of the flatpickr/FullCalendar overrides |
| 27 further files under `src/` | Modified | `text-sm` / `text-theme-sm` removed (full list under Steps, step 8) |

`src/components/common/ThemeTogglerTwo.tsx` is **not** deleted — `src/app/(auth)/layout.tsx:17`
still renders it on the login screen. No new module is created by this slice; if you find yourself
adding one, the plan missed something — stop and report.

## Existing code to reuse

- `src/context/ThemeContext.tsx` — `useTheme()` returns `{ theme, toggleTheme }`. This is the same
  hook the deleted `ThemeToggleButton` called. Do not add a second theme source, do not read
  `localStorage` yourself, do not touch `document.documentElement` — the provider's effect already
  does both.
- `src/components/ui/dropdown/DropdownItem.tsx` — `tag="button"` (the default) plus `onClick` and
  `onItemClick`. Use `onClick={toggleTheme}` and `onItemClick={closeDropdown}`; both fire, in that
  order, from its one `handleClick`. Copy the `className` of the sibling *Editar perfil* item so the
  four rows match — but with `text-theme-sm` dropped per REQ-9.
- `src/components/ui/dropdown/Dropdown.tsx:25` — its outside-click handler special-cases
  `.dropdown-toggle`. **The avatar trigger button must keep that class.** Losing it makes the panel
  close on the same click that opened it, so the menu appears never to open, with no error anywhere
  (`services/web/CLAUDE.md`). You are not editing `Dropdown.tsx`; you are not allowed to break its
  contract either.
- `lucide-react` — already a direct dependency, already used by `AppSidebar.tsx` and
  `UserDropdown.tsx`. Take `Menu`, `X`, `Search`, `Sun`, `Moon` from it. Do **not** hand-copy SVG
  path data into these files; that is the exact pattern `019-user-menu` removed.
- `useSidebar()` from `src/context/SidebarContext.tsx` and the existing `handleToggle` — the
  `window.innerWidth >= 1024 ? toggleSidebar() : toggleMobileSidebar()` branch is existing behaviour
  and survives the rewrite unchanged.
- `next-intl`'s `useTranslations("header")` / `("userMenu")` / `("common")` — every new string is a
  catalog key in both locales. `common.altLogo` stays in the catalogs: `AppSidebar.tsx` uses it three
  times even after the header's mobile logo goes.

## Steps

1. **`UserDropdown.tsx`** — import `useTheme` from `@/context/ThemeContext` and `Moon`/`Sun` from
   `lucide-react`. Add a fourth `<li>` to the existing `<ul>`, after *Configuración*: a
   `DropdownItem` with `onClick={toggleTheme}`, `onItemClick={closeDropdown}`, rendering `Moon`
   + `t("themeDark")` when `theme === "light"` and `Sun` + `t("themeLight")` when it is dark — the
   label names the mode the click switches *to*.
2. **Catalogs** — add `userMenu.themeLight` / `userMenu.themeDark` to both `messages/en.json` and
   `messages/es.json` (`"Light mode"`/`"Dark mode"`; `"Modo claro"`/`"Modo oscuro"`). Both files in
   the same step — a key added to one only renders the raw key path to the user.
3. **`AppHeader.tsx`, structure** — replace the whole `<header>` body with a single flex row that is
   the same at every breakpoint: sidebar toggle, then the search form as the flex-grow child, then
   `<UserDropdown user={user} />`. Delete the outer two-container/`lg:flex-row` scaffolding, the
   `isApplicationMenuOpen` state and its `useState` import, `toggleApplicationMenu`, the collapsed
   icon row, the mobile `<Link>` logo with both `<Image>` elements (and the now-unused `Image`/`Link`
   imports), the two `/movies/add` and `/shows/add` links with their `Film`/`TvMinimal` imports,
   `<ThemeToggleButton />`, `<NotificationDropdown />`, and the three-dot button.
4. **`AppHeader.tsx`, toggle** — keep `handleToggle` and the `isMobileOpen` branch, rendering
   lucide `X` when the mobile sidebar is open and `Menu` otherwise, in place of the two inline SVGs.
   Keep `aria-label={t("toggleSidebar")}`.
5. **`AppHeader.tsx`, search form** — the form renders at every width (drop the `hidden lg:block`
   wrapper). Add `onSubmit={(e) => e.preventDefault()}` on the `<form>`: with no action, the default
   submit reloads the page on Enter, which AC-4 forbids. Keep the `inputRef` and the `⌘K`
   `useEffect` **verbatim** — moving it is fine, rewriting it is how the shortcut dies silently.
   The magnifier becomes lucide `Search`.
6. **`AppHeader.tsx`, input + badge** — give the input `text-base` explicitly (REQ-8/AC-6: an
   explicit 16px, not an assumption about what preflight does to form controls) and drop its
   `text-sm`. Turn the `⌘K` badge into a non-interactive `<span>` — as a `<button>` with no `type`
   it is an implicit submit — and hide it below `sm` (`hidden sm:inline-flex`) per REQ-7. The
   shortcut itself keeps working at every width; only the badge is responsive.
7. **Deletions** — remove `src/components/header/NotificationDropdown.tsx` and
   `src/components/common/ThemeToggleButton.tsx`, and delete the entire `notifications` namespace
   (`title`, `requestPermission`, `projectLabel`, `minutesAgo`, `hoursAgo`, `viewAll`) from **both**
   catalogs. Do this after steps 3–5, not before: deleting first turns the typecheck red and masks
   whatever else the rewrite broke.
8. **16px base** — in `src/app/globals.css`, add `text-base` to the `body` `@apply` (line ~190).
   Then remove every `text-sm` / `!text-sm` / `text-theme-sm` occurrence, leaving the surrounding
   classes intact, from `globals.css` itself (the `menu-item` and `menu-dropdown-item` `@utility`
   blocks, and the flatpickr/FullCalendar override blocks) and from these files:

   ```
   src/app/(dashboard)/movies/[id]/not-found.tsx   src/app/(dashboard)/shows/[id]/not-found.tsx
   src/app/page.tsx                                src/components/auth/LoginForm.tsx
   src/components/common/PageBreadCrumb.tsx        src/components/form/input/Checkbox.tsx
   src/components/form/input/InputField.tsx        src/components/form/Label.tsx
   src/components/form/Select.tsx                  src/components/header/UserDropdown.tsx
   src/components/import/importFileModal.tsx       src/components/import/importMagnetModal.tsx
   src/components/media/LanguagePicker.tsx         src/components/media/MediaCard.tsx
   src/components/movies/Movie.tsx                 src/components/search/SearchContainer.tsx
   src/components/search/SearchTorrentModal.tsx    src/components/search/SearchTorrent.tsx
   src/components/settings/PathPicker.tsx          src/components/settings/PreferredLanguagesCard.tsx
   src/components/settings/SettingsForm.tsx        src/components/shows/SeasonAccordion.tsx
   src/components/shows/Show.tsx                   src/components/ui/button/Button.tsx
   src/components/ui/dropdown/DropdownItem.tsx     src/components/users/UsersManager.tsx
   src/layout/AppHeader.tsx                        src/layout/SidebarWidget.tsx
   ```

   Go file by file, not with a repo-wide `sed`. **Keep** the `--text-theme-sm` /
   `--text-theme-sm--line-height` declarations in the `@theme` block (lines 31–32) — the token stays,
   only its use goes. Do not compensate for a page that now looks larger by adding `text-[14px]` or
   any other one-off size; NFR-4 declares that drift accepted, and later specs fix each page.
9. **Verify** — the commands under `../plan.md` § Verification, then the six-step manual pass.

## Contract obligations

`../spec.md` § GraphQL Contract Delta reads **"None — this feature does not cross the service
boundary."** You consume no query, no mutation, no error condition; you add none. If you conclude
this slice needs data from `api`, that is a contract change: stop and report rather than adding a
server action.

## Tests

**None, and here is the reason.** `services/web` has no test file, no runner and no `test` script,
and `services/web/CLAUDE.md` is explicit that introducing one is its own decision needing its own
spec — do not add Vitest or Playwright as a side effect of this feature.

Under Article IX the question is whether anything here can fail *silently*. The three candidates are
all covered without a test runner:

- The `.dropdown-toggle` class and the `⌘K` listener would fail silently — both are caught by the
  manual pass (AC-3, AC-5), which is the honest gate for behaviour this service cannot assert on.
- A one-sided catalog edit would render a raw key path to the user with nothing thrown — caught by
  `node scripts/check-messages.mjs`, which already exists for exactly this and is a plain script,
  not a test framework.
- Everything else in this slice is visual: a wrong class produces a wrong-looking page, which is
  loud by construction.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
grep -rn 'text-sm\|text-theme-sm' services/web/src
grep -rn 'NotificationDropdown\|ThemeToggleButton' services/web/src
```

0 typecheck errors, `build` exits 0, `check-messages` exits 0, and both greps return **no matches**
(AC-7, AC-8). Report the typecheck error count and build exit code from *before* your change too —
proving you added nothing is the point. Run Biome on the files you touched
(`bin/cli web npx --no biome check <paths>`), never on the repo: `bin/npm web run lint` reports
~1598 pre-existing errors with or without your diff and is not a usable gate.

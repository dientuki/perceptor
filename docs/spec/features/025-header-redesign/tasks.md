---
title: Header redesign and 16px type base — Tasks
last_updated: 2026-08-25
status: Draft
---

# TASKS: Header redesign and 16px type base (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[web]` | The `web` subagent owns the task. Exactly one tag per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

`api`, `worker` and `infra` appear nowhere in this feature: `services:` is `[web]`, the GraphQL
delta is **None**, and nothing about the stack's boot or wiring changes.

**No task carries `[P]`.** This is a single-service feature whose steps rewrite overlapping files —
T003 deletes what T001/T002 stop referencing, and T004/T005 rewrite lines inside files T002 just
touched. One agent, in order. "Parallel" here would only mean "conflicting".

## Tasks

### Group 1 — the replacement, before the removal

The header cannot drop the theme button until somewhere else can toggle the theme (REQ-4).

- [ ] **T001** `[web]` Add the theme entry to
      `services/web/src/components/header/UserDropdown.tsx`: a fourth `<li>` after *Configuración*,
      a `DropdownItem` with `onClick={toggleTheme}` (from `useTheme()`,
      `@/context/ThemeContext`) and `onItemClick={closeDropdown}`, rendering lucide `Moon` +
      `t("themeDark")` while `theme === "light"` and `Sun` + `t("themeLight")` while it is dark —
      the label names the mode the click switches *to*. Add `userMenu.themeLight` /
      `userMenu.themeDark` to **both** `services/web/messages/en.json` (`"Light mode"` /
      `"Dark mode"`) and `messages/es.json` (`"Modo claro"` / `"Modo oscuro"`) in this same task.
      Reuse the sibling item's `className`, minus `text-theme-sm`. Do not read `localStorage` or
      touch `document.documentElement` — the provider's effect already does both.
      *Done when:* `bin/cli web node scripts/check-messages.mjs` exits 0,
      `bin/cli web npx --no tsc --noEmit` reports 0 errors, and opening the avatar menu in the
      running app shows four rows, the theme row flipping the page light↔dark and showing the
      opposite label when reopened.

### Group 2 — the header itself

- [ ] **T002** `[web]` Rewrite `services/web/src/layout/AppHeader.tsx` as one flex row, identical at
      every breakpoint: sidebar toggle, search form (flex-grow), `<UserDropdown user={user} />`.
      **Remove**: the two-container `lg:flex-row` scaffolding, `isApplicationMenuOpen` +
      `toggleApplicationMenu` + the `useState` import, the collapsed icon row, the three-dot button,
      the mobile `<Link>` logo and both `<Image>` elements (with the now-unused `Image`/`Link`
      imports), the `/movies/add` and `/shows/add` links with their `Film`/`TvMinimal` imports,
      `<ThemeToggleButton />` and `<NotificationDropdown />`. **Keep**: `handleToggle` and its
      `isMobileOpen` branch (lucide `X` when open, `Menu` otherwise, `aria-label={t("toggleSidebar")}`),
      and the `inputRef` + `⌘K` `useEffect` **verbatim** — move it, do not rewrite it. The form
      drops its `hidden lg:block` wrapper and gains `onSubmit={(e) => e.preventDefault()}`; the
      magnifier becomes lucide `Search`; the input gets an explicit `text-base` and loses `text-sm`;
      the `⌘K` badge becomes a non-interactive `<span>` with `hidden sm:inline-flex`. → T001
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and, in the running app on
      `/movies`: the header shows only toggle + input + avatar at desktop width (AC-1); at 375px the
      same three sit on one row with the badge hidden and the toggle still opening/closing the
      mobile sidebar (AC-2); `⌘K` focuses the input at both widths (AC-3); typing and pressing Enter
      causes no navigation, no reload and no console error (AC-4).

### Group 3 — the removals

- [ ] **T003** `[web]` Delete `services/web/src/components/header/NotificationDropdown.tsx` and
      `services/web/src/components/common/ThemeToggleButton.tsx`, and delete the entire
      `notifications` namespace (`title`, `requestPermission`, `projectLabel`, `minutesAgo`,
      `hoursAgo`, `viewAll`) from **both** message catalogs. Do **not** delete
      `src/components/common/ThemeTogglerTwo.tsx` — `src/app/(auth)/layout.tsx:17` still renders it
      — and do **not** delete `common.altLogo`, which `AppSidebar.tsx` uses three times.
      → T001, T002
      *Done when:* `grep -rn 'NotificationDropdown\|ThemeToggleButton' services/web/src` returns
      nothing (AC-8), both files are gone, `bin/cli web node scripts/check-messages.mjs` exits 0,
      and `bin/cli web npx --no tsc --noEmit` reports 0 errors.

### Group 4 — the 16px base

- [ ] **T004** `[web]` In `services/web/src/app/globals.css`: add `text-base` to the `body` `@apply`
      (line ~190), and remove every `text-theme-sm` / `text-sm` / `!text-sm` occurrence — the
      `menu-item` and `menu-dropdown-item` `@utility` blocks, and the flatpickr / FullCalendar
      override blocks — leaving each surrounding class list otherwise intact. **Keep** the
      `--text-theme-sm` and `--text-theme-sm--line-height` declarations in the `@theme` block
      (lines 31–32): the token stays, only its use goes. → T003
      *Done when:* `grep -n 'text-sm\|text-theme-sm' services/web/src/app/globals.css` matches only
      the two `@theme` declarations, and DevTools reports computed `font-size: 16px` on `body`
      (AC-6).
- [ ] **T005** `[web]` Remove every remaining `text-sm` / `text-theme-sm` from the 28 files listed
      in `web/plan.md` § Steps, step 8. Go file by file — **no repo-wide `sed`**, which would also
      hit the substring inside a longer class or a string literal. Do not compensate for a page that
      now reads larger by adding `text-[14px]` or any other one-off size: NFR-4 declares that drift
      accepted and later specs re-tune each screen. → T004
      *Done when:* `grep -rn 'text-sm\|text-theme-sm' services/web/src` returns **no matches at all**
      (AC-7) and `bin/cli web npx --no tsc --noEmit` still reports 0 errors.

### Group 5 — verification and docs

- [ ] **T006** `[web]` Run the full gate and report the numbers from before and after the change —
      this service has no test suite, so these plus the manual pass are the entire gate.
      → T005
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports **0 errors**,
      `bin/npm web run build` **exits 0**, `bin/cli web node scripts/check-messages.mjs` **exits 0**
      (AC-9), both greps from T003 and T005 return nothing, and
      `bin/cli web npx --no biome check <the touched files>` is clean on those files. Do **not** run
      `bin/npm web run lint` as a gate — it reports ~1598 pre-existing errors with or without this
      diff.
- [ ] **T007** `[docs]` Update `services/web/CLAUDE.md`: in § "UI origin: TailAdmin template", record
      that the header is now three elements and that the theme toggle lives in `UserDropdown`
      (`ThemeToggleButton` deleted, `ThemeTogglerTwo` still used by the auth layout); add a
      convention line that `text-sm` and `text-theme-sm` are banned in favour of the 16px `body`
      base, with the pointer to this spec. The **root** `CLAUDE.md` is not edited: no pipeline stage
      changes status and no contract moves. → T006
      *Done when:* `services/web/CLAUDE.md` states all three facts and names
      `docs/spec/features/025-header-redesign/`.
- [ ] **T008** `[docs]` Walk the nine acceptance criteria in `spec.md` against the running app —
      AC-1 through AC-6 are visual and must be confirmed by a human in a browser at both desktop and
      375px width, since `web` has no test runner to assert them. Tick each box, then set
      `status: Implemented` on `spec.md`, `plan.md` and `web/plan.md`, and `status: Done` here.
      → T007
      *Done when:* every AC checkbox in `spec.md` is `[x]` and all four files carry their final
      status.

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty
entry is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

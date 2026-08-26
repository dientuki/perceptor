---
title: Header redesign and 16px type base
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-08-25
last_updated: 2026-08-26
status: Implemented
services: [web]
---

# SPEC: Header redesign and 16px type base (`spec.md`)

## Context & Goal

The application header is still the TailAdmin template's header, essentially untouched since the
project was bootstrapped. `services/web/src/layout/AppHeader.tsx` carries four inline SVG icons and
two icon links that accumulated for different reasons and no longer describe what Perceptor does:
two round quick-add links (`/movies/add`, `/shows/add`), a theme toggle
(`src/components/common/ThemeToggleButton.tsx`), a notification bell backed by
`src/components/header/NotificationDropdown.tsx` — 387 lines of template demo data that talks to
nothing — a mobile "application menu" three-dot button whose only job is to reveal that same icon
row, and a mobile-only logo link that duplicates the sidebar's. Below `lg` the search field is
hidden outright (`hidden lg:block`), so on a phone the header is a hamburger, a logo and a dots
button, and there is no way to search at all.

This spec is the first step of a broader visual pass over the UI, and it is deliberately narrow: the
header becomes three elements — sidebar toggle, search form, avatar — at every breakpoint, matching
the reference screenshots the user supplied (a Jellyseerr-style bar: full-width rounded search input,
avatar at the right; on narrow viewports the hamburger sits to the left of the same input). The
avatar keeps its dropdown and gains the theme toggle that the icon row is losing, so no capability
disappears with the chrome.

It also fixes the type scale the template left behind. `body` declares no font size and nearly every
component overrides to `text-sm`/`text-theme-sm` (14px), so the site reads one notch smaller than its
own base everywhere. This spec makes 16px the explicit, inherited base and strips those two 14px
overrides site-wide; individual screens will be re-tuned as the visual pass reaches them, which is
expected to leave some pages temporarily larger than their final design.

No pipeline stage in the root `CLAUDE.md` changes status. `web` is the only service touched: no
GraphQL, no Prisma, no `api`/`worker` code.

**Note on Article VII.** This change is confined to one service and crosses neither the schema nor
the GraphQL contract, so the constitution does not *require* a spec. It is written anyway because it
removes user-facing capability (three header entry points), changes typography on every screen in
the app, and opens a series of UI specs that later work will reference.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Header contents)**: The header must contain exactly three interactive regions at
      every viewport width: the sidebar open/close toggle, the search form, and the avatar button.
      Nothing else renders in the header.
- [x] **REQ-2 (Removed chrome)**: The quick-add links to `/movies/add` and `/shows/add`, the theme
      toggle button, the notification bell and its dropdown, the mobile three-dot "application menu"
      button (and the collapsed row it toggled), and the mobile logo link must all be gone from the
      header.
- [x] **REQ-3 (Dead code removal)**: Any component, state, handler, icon import or message-catalog
      key left with no remaining reference by REQ-2 must be deleted, in both `messages/en.json` and
      `messages/es.json`. Components under `src/layout/`, `src/components/common|form|ui` and
      `src/context/` are TailAdmin scaffolding and are **not** in scope for this rule — only code
      whose *last* reference this spec removes is deleted, and `ThemeTogglerTwo` (used by the auth
      layout) stays untouched.
- [x] **REQ-4 (Theme toggle relocation)**: Switching between light and dark must remain available to
      a signed-in user, as an entry inside the avatar dropdown alongside *Editar perfil* /
      *Configuración* / *Cerrar sesión*. It must toggle the same `ThemeContext` state the header
      button toggled, and its label must come from the message catalogs in both locales.
- [x] **REQ-5 (Search always visible)**: The search form must render at every breakpoint, not from
      `lg` up. On narrow viewports it sits between the sidebar toggle and the avatar, on one row, as
      in the mobile reference screenshot.
- [x] **REQ-6 (Search behaviour unchanged)**: The input stays non-submitting. It must not gain a
      submit handler, a form action, or navigation — this spec changes only its appearance, size and
      availability. Wiring it to a real search is deferred (see Out of Scope).
- [x] **REQ-7 (⌘K)**: The `⌘K` / `Ctrl+K` shortcut must keep focusing the search input at every
      viewport width. Its badge inside the input must render on desktop and be hidden on mobile.
- [x] **REQ-8 (Input type size)**: The header search input's text and placeholder must render at
      16px.
- [x] **REQ-9 (16px base)**: `body` must declare an explicit 16px font size, and the classes
      `text-sm` and `text-theme-sm` must no longer appear anywhere under `services/web/src`,
      including inside `globals.css` `@utility`/`@apply` blocks. Elements that carried them inherit
      the base instead.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (No regression in the gates)**: `bin/cli web npx --no tsc --noEmit` must still report
      0 errors and `bin/npm web run build` must still exit 0. Report both before and after.
- [x] **NFR-2 (Catalog parity)**: `node scripts/check-messages.mjs` must exit 0 — every key added or
      removed by REQ-3/REQ-4 happens in `en.json` and `es.json` together, `es` keeping its
      Rioplatense register.
- [x] **NFR-3 (Single-service boundary)**: The diff touches only `services/web/` and this spec
      directory. No `api`, no `worker`, no `docker-compose`.
- [x] **NFR-4 (Accepted visual drift)**: Removing the 14px overrides will make some screens read
      larger than their final design until the visual pass reaches them. That is accepted, not a
      defect to compensate for with new one-off size classes.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.** It is presentation-only inside `web`:
no query, mutation, argument or error condition changes, and no server action is added or altered.
The avatar dropdown's new theme entry is client-side `ThemeContext` state, which is not persisted to
`api` (see Out of Scope).

## Data Model Changes

**None.**

## Acceptance Criteria

- [x] **AC-1**: On a desktop viewport, `/movies` renders a header containing only the sidebar
      toggle, the search input with its `⌘K` badge, and the avatar. No bell, no theme button, no
      film/TV icons, no dots button.
- [x] **AC-2**: At a 375px-wide viewport, the same header renders the sidebar toggle, the search
      input and the avatar on one row; the `⌘K` badge is not visible; tapping the toggle still opens
      and closes the mobile sidebar.
- [x] **AC-3**: Pressing `⌘K` (or `Ctrl+K`) at both viewport widths moves focus into the header
      search input.
- [x] **AC-4**: Typing text into the header search input and pressing Enter changes nothing — no
      navigation, no request, no error in the console (REQ-6: this is the intended behaviour, and
      the criterion exists so an implementer does not "fix" it).
- [x] **AC-5**: Clicking the avatar opens the dropdown; the theme entry toggles the app between
      light and dark; reopening the dropdown shows the entry reflecting the now-current theme; the
      existing *Configuración* and *Cerrar sesión* entries still work.
- [x] **AC-6**: Computed style of `body` is `font-size: 16px`, and the header input's computed
      `font-size` is `16px`.
- [x] **AC-7**: `grep -rn 'text-sm\|text-theme-sm' services/web/src` returns no matches, except the
      two intentional `--text-theme-sm` / `--text-theme-sm--line-height` token declarations in
      `globals.css`'s `@theme` block (REQ-9 only bans the classes' *use*, not the token itself —
      `text-theme-xs`/`text-theme-xl` still resolve against it).
- [x] **AC-8**: `grep -rn 'NotificationDropdown' services/web/src` returns no matches and the file
      no longer exists.
- [x] **AC-9** (failure path): `bin/npm web run build` exits 0 and `bin/cli web npx --no tsc
      --noEmit` reports 0 errors — a leftover import of a deleted component or a message key removed
      from only one catalog fails here, and `node scripts/check-messages.mjs` exits non-zero on the
      catalog half of that.

## Out of Scope

- **Making the header search actually search.** The input has never submitted anything; the user
  chose to keep it decorative for now. Wiring it — to TMDB registration, to the library, or to a
  combined result list — needs its own spec because it has to decide films-vs-series, the result
  surface, and whether it replaces `/movies/add` + `/shows/add`.
- **Restoring an entry point to `/movies/add` and `/shows/add`.** Removing the two header icons
  leaves those routes reachable only by typing the URL; the user accepted that deliberately, to be
  resolved by whichever later spec redesigns the add flow. Do not add a sidebar entry as a
  consolation.
- **Notifications as a feature.** `NotificationDropdown` is deleted as template demo data, not
  replaced. A real notification system would need `api` surface and is a separate feature.
- **Persisting the theme choice to the user record.** The toggle keeps whatever storage
  `ThemeContext` already uses; adding a `User` preference field is `api` work and belongs with
  `021-user-preferences`, not here.
- **Re-tuning every screen's typography.** REQ-9 removes the 14px overrides; it does not redesign
  the pages that relied on them. Each page gets its sizes right as the visual pass reaches it.
- **The sidebar, and the rest of the visual pass.** This spec stops at the header, the avatar
  dropdown and the type base. The sidebar in the reference screenshots differs from Perceptor's and
  is explicitly a later step.

---
title: User Menu
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-19
last_updated: 2026-08-19
status: Approved
services: [web]
---

# SPEC: User Menu (`spec.md`)

## Context & Goal

The user menu in the headbar is the one piece of chrome every authenticated screen renders, and it
is still the TailAdmin template's version rather than this application's. `services/web/src/components/header/UserDropdown.tsx`
(rendered from `src/layout/AppHeader.tsx:192`, which receives the `CurrentUser` the dashboard layout
already resolved through the `me` query) puts three things in its trigger — the avatar, the user's
name, and a rotating chevron — and then repeats the name inside the panel it opens. The panel itself
carries a name/username block and three items, *Edit profile*, *Account settings* and *Support*, all
three of which link to the same `/profile` route, followed by a sign-out form. Two of those items
are template scaffolding that was never wired to anything, and `/profile` has never existed in this
service — nor will it: `020-profile-edit` makes profile editing a modal, so this feature leaves
*Editar perfil* as a destination-less control rather than a link (REQ-7, amended 2026-08-19).

Two smaller things are wrong with the same file. Its labels are English, which is backwards for this
project: everything committed is English *except* user-facing copy, which is Spanish because the app
is Spanish. And it draws five icons as inline `<svg>` blocks with hand-copied path data, while the
rest of the site takes its iconography from `lucide-react` (already a dependency at `^1.28.0`, used
in `AppHeader.tsx`, `AppSidebar.tsx`, `Movie.tsx` and the import modals).

After this ships the trigger is the avatar and nothing else. The panel opens onto the user's name,
then *Editar perfil*, then *Ajustes*, then a separator, then *Cerrar sesión* — each one a real
clickable control with a `lucide-react` icon beside it, and no inline SVG left in the file. The
avatar stays a single static image shared by every user; there is no avatar upload and no avatar
field anywhere in the data model. Because each menu entry leads somewhere with its own weight, this
spec deliberately stops at the UI: the entries are wired to their destinations so that building
each destination later is an isolated change. No pipeline stage in the root `CLAUDE.md` changes
status — this feature adds no stage and moves none forward.

Note on scope discipline (Constitution, Article VII): this change touches one service, no Prisma
schema and no GraphQL contract, so it is below the threshold that *requires* a feature spec. It has
one anyway because it was asked for; it should not be read as a precedent for spec'ing single-file
`web` changes.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Minimal trigger)**: The control that opens the menu must show the avatar and nothing
      else — no user name beside it, no chevron, at any viewport width. It must remain a real
      button, not a clickable `div`.
- [ ] **REQ-2 (Fixed avatar)**: The avatar must be one static image identical for every user. The
      menu must offer no upload affordance, and no avatar field is introduced anywhere.
- [ ] **REQ-3 (Name is the first item)**: The first element inside the open panel must be the
      user's `name`. The `username` must no longer be displayed anywhere in this menu.
- [ ] **REQ-4 (Menu contents)**: The panel must contain, in this order and nothing else — the
      name, *Editar perfil*, *Ajustes*, a separator line, *Cerrar sesión*. *Account settings* and
      *Support* are removed.
- [ ] **REQ-5 (Lucide iconography)**: Each action item must carry its icon from `lucide-react` —
      *Editar perfil* → `User`, *Ajustes* → `Settings`, *Cerrar sesión* → `LogOut`. No inline
      `<svg>` element may remain in this component after the change.
- [ ] **REQ-6 (Every item clickable)**: All three items must respond to a click and close the
      panel. *Ajustes* navigates to `/settings`; *Cerrar sesión* runs the existing logout server
      action (`logoutAction`, `src/actions/auth.ts`); *Editar perfil* is the entry point of
      `020-profile-edit` — see REQ-7.
- [ ] **REQ-7 (*Editar perfil* has no destination yet)**: *Editar perfil* must be a control that
      closes the panel and navigates nowhere — no `href`, no route, no URL change. There is no
      `/profile` route and none is created: `020-profile-edit` turns this entry into the trigger of a
      profile modal rendered over the current screen. Until that feature lands, clicking it is a
      no-op beyond closing the panel.

      *(Amended 2026-08-19. This requirement previously linked the entry to a `/profile` route whose
      404 was the specified end state; `020-profile-edit` replaced that page with a modal, so the
      route is never built and the link is gone with it.)*

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Spanish copy, literal)**: The visible labels must be Spanish string literals, matching
      the rest of the app as it stands today. This feature must not introduce a translation catalog
      or consume one — `018-ui-i18n` migrates this file along with the other ~40, and pre-empting it
      here would create a second, private mechanism.
- [ ] **NFR-2 (Reuse, do not add components)**: The existing `Dropdown` and `DropdownItem`
      (`src/components/ui/dropdown/`) must be reused unchanged, and the separator must be a border
      in the same style the current `<ul>` already uses. No menu library and no new shared component.
- [ ] **NFR-3 (No typecheck or build regression)**: `bin/cli web npx --no tsc --noEmit` must still
      report 0 errors and `bin/npm web run build` must still exit 0, both counts reported before and
      after the change.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.**

The component already receives the whole `CurrentUser` (`id`, `name`, `username`, `isAdmin`,
`preferredLanguages`) as a prop from `AppHeader`, resolved once by the dashboard layout's `me`
query. This feature displays fewer of those fields than before, not more, so no query, type or
error condition changes. `logoutAction` is called exactly as it is today.

## Data Model Changes

**None.**

## Acceptance Criteria

- [ ] **AC-1**: Signed in on any dashboard screen, the headbar shows a round avatar alone — the
      user's name and the chevron are absent at every viewport width.
- [ ] **AC-2**: Clicking the avatar opens the panel, which reads top to bottom: the user's name,
      *Editar perfil*, *Ajustes*, a separator line, *Cerrar sesión* — and nothing else. The username
      appears nowhere in it.
- [ ] **AC-3**: Clicking *Ajustes* lands on `/settings` with the panel closed.
- [ ] **AC-4**: Clicking *Cerrar sesión* ends the session and leaves the browser on `/login`.
- [ ] **AC-5** *(failure path)*: Clicking *Editar perfil* closes the panel and does nothing else —
      the address bar is unchanged, no 404 appears, and no navigation happens. The dead entry is this
      feature's expected result, not a defect; `020-profile-edit` gives it the modal.
      `grep -rn "/profile" services/web/src` returns nothing.
- [ ] **AC-6**: `grep -n "<svg" services/web/src/components/header/UserDropdown.tsx` returns
      nothing.
- [ ] **AC-7**: `bin/cli web npx --no tsc --noEmit` reports 0 errors.

## Out of Scope

- **The profile editor.** Editing `name`, `username` and password is `020-profile-edit`, with its own
  GraphQL surface (`updateProfile`) and a modal rather than a page. This spec delivers only the menu
  entry that will open it. There is no `/profile` route in either feature.
- **Avatar upload.** There is no avatar field on `User` and no image endpoint; adding one would
  cross into `api` and Prisma and belongs in a separate spec.
- **Translating the labels.** Covered by `018-ui-i18n`, which is Approved and owns the migration of
  every user-facing string in this service. See NFR-1.
- **The inline SVGs elsewhere in the project.** `AppHeader`, `AppSidebar` and the rest of the
  TailAdmin components keep their inline icons; REQ-5 is scoped to this one component.
- **Changing `Dropdown`/`DropdownItem`.** They are reused as-is. Refactoring the shared pair would
  reach consumers this feature never looked at.

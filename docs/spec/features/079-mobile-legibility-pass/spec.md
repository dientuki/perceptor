---
title: Mobile Legibility Pass
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-09-28
last_updated: 2026-09-28
status: Approved
services: [web]
---

# SPEC: Mobile Legibility Pass (`spec.md`)

## Context & Goal

On a phone the whole application reads small. The cause is not the base rule — `services/web/src/app/globals.css`
already sets `body { @apply … text-base }` inside its `@layer base`, which is 16px — but what the
components do on top of it. A grep over `services/web/src` finds 38 occurrences of `text-xs` (12px)
and 22 of `text-sm` (14px) across roughly thirty files, and they are not confined to decoration:
they carry table cells in `components/users/UsersManager.tsx`, episode rows in
`components/shows/SeasonAccordion.tsx`, queue rows in `components/downloads/DownloadsPanel.tsx` and
`components/downloads/DownloadRow.tsx`, release rows in `components/search/SearchTorrent.tsx`, card
metadata in `components/media/MediaCard.tsx`, and the help text under form fields in
`components/form/input/InputField.tsx`. The custom `--text-theme-sm` / `--text-theme-xs` tokens
declared in `@theme` are barely used (2 and 6 occurrences), so there is no single scale to edit —
the sizes are literals scattered through the tree. The layout was built desktop-first: `text-xs` on
a 27-inch monitor reads as a deliberate hierarchy, and on a 375px viewport it reads as fine print.

Font size is the loudest symptom of a broader problem, and this feature treats the problem rather
than the symptom. Two more things break on a phone. **Touch targets**: several actions are bare
icons at `size-4`/`size-5` with little or no padding — the row actions in `UsersManager`, the search
and magnet buttons in the season header, the delete and play controls on a download row — which is
below the 44×44 CSS-pixel minimum a finger can reliably hit. **Horizontal overflow**: the same wide,
column-dense panels (`UsersManager`, `SearchTorrent`, `SeasonAccordion`, `DownloadsPanel`) either
force a horizontal scroll of the whole page or compress their columns to unreadable widths at 375px,
because they were laid out as tables with no mobile presentation of their own.

Once this ships, every piece of text a user is meant to *read* on a phone is at least 16px, with one
documented 14px step reserved for accessory metadata; every interactive control has a real touch
target; and no screen scrolls sideways at 375px. This is a `services/web` presentation change only.
It touches no pipeline stage in the root `CLAUDE.md`, no Prisma model and no GraphQL field — nothing
about search, acquisition, ranking, encoding or the media server changes. The user expects further
mobile findings while reviewing screens against this rule; those are amendments to this spec
(`spec_version` bump), not a new feature.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Reading floor)**: Text a user is meant to read must render at no less than 16px on
      every viewport. This covers paragraphs and synopses, table and list cell contents, form labels,
      the text typed into and displayed by an input or textarea, select options, menu and navigation
      items, button labels, modal body copy, and error and empty-state messages.
- [ ] **REQ-2 (Secondary step)**: Exactly one smaller step is permitted, 14px, and only for accessory
      metadata that is not the content of the screen: status badges, timestamps and relative dates,
      counters, unit suffixes, the helper text under a form field, a table's `<th>` column labels
      (the uppercase, letter-spaced headers in `UsersManager`, `SeasonAccordion`, `DownloadsPanel`
      and `SearchTorrent` — a structural label, not the row's content), and the dev-only
      `RankingDebugPanel`. No text in the application renders below 14px.
- [ ] **REQ-3 (One scale, enforced)**: The permitted sizes must be expressed once, as the complete
      text scale in `globals.css`'s `@theme`, and referenced by the components. A size below the
      floor must not merely be unused — it must not exist as a utility, so that reintroducing it
      cannot work. A class naming a size outside the scale must produce no rule at all, leaving the
      element at the inherited floor.
- [ ] **REQ-4 (Line height)**: Each token must carry a line height that keeps multi-line body copy
      readable — no tighter than 1.4× its font size for the 16px step.
- [ ] **REQ-5 (No input zoom)**: Every `<input>`, `<textarea>` and `<select>` must render its own
      text at 16px or more, so that focusing a field on iOS Safari does not zoom the viewport.
- [ ] **REQ-6 (Touch targets)**: Every interactive control — button, icon button, link acting as a
      button, checkbox, radio, switch, tab, and each row of a listbox or dropdown — must present a
      hit area of at least 44×44 CSS pixels at viewports below 768px. The icon inside it may stay its
      current size; the padding grows.
- [ ] **REQ-7 (Spacing between targets)**: Two adjacent interactive controls must not have touching
      hit areas; a visible gap must separate them, so that an enlarged target does not make the
      neighbouring action easier to hit by accident.
- [ ] **REQ-8 (No horizontal overflow)**: No screen of the application may scroll horizontally at a
      375px viewport width. Where a panel is genuinely wider than the viewport — the torrent result
      rows, the users table, the global downloads queue, the season accordion — the panel itself may
      scroll horizontally inside its own bounds, or present a stacked mobile layout; the page body
      may not.
- [ ] **REQ-9 (No truncation of identity)**: Where a mobile layout stacks or scrolls, the field that
      identifies the row — a user's name, a release name, an episode title, a title's name — must
      remain reachable. It may wrap or be scrolled to; it may not be clipped with no way to read it.
- [ ] **REQ-10 (Hierarchy preserved)**: Raising the floor must not flatten the page. Where a heading
      and its body copy are now the same size, the heading must keep its distinction through weight
      or colour rather than being left indistinguishable.
- [ ] **REQ-11 (Every screen)**: The pass must cover every route the application serves: the
      dashboard home and billboard, `/search`, `/movies` and `/shows` and their detail pages,
      `/calendar`, `/downloads`, `/preferences`, `/settings` and all its tabs, `/users`, the login
      screen, and every modal reachable from them.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Presentation only)**: No component may change what it fetches, what it submits or
      which action it calls. The diff is confined to `services/web/src`, and within it to styling,
      markup structure and `globals.css`.
- [ ] **NFR-2 (No copy change)**: No user-facing string is added, removed or reworded.
      `bin/cli web node scripts/check-messages.mjs` must report the same key count as before the
      feature, with no `en`/`es` drift.
- [ ] **NFR-3 (Desktop unregressed)**: A viewport of 1280px and above must keep its current
      information density. Where the 16px floor would cost a desktop layout a column or force a
      wrap that did not exist, the layout adapts; the floor does not become a desktop-only
      exception. The floor applies at every width.
- [ ] **NFR-4 (Both themes)**: Every screen touched must be checked in light and dark mode, since
      `globals.css` carries the theme tokens this feature edits alongside the text ones.
- [ ] **NFR-5 (Amendable)**: Further mobile findings on screens not yet enumerated here are recorded
      by amending this spec and bumping `spec_version`, not by opening a second feature. The
      requirements above are rules, not a file list, and a screen found later is covered by REQ-11
      already.

## GraphQL Contract Delta

None — this feature does not cross the service boundary. It is confined to how `services/web`
presents data it already receives; no query, mutation, argument, field or error condition changes,
and no `services/api/src/schema.gql` diff is expected.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: With a phone viewport of 375×812, every screen listed in REQ-11 renders with no
      horizontal page scroll — `document.documentElement.scrollWidth` equals
      `document.documentElement.clientWidth` on each.
- [ ] **AC-2**: On `/users` at 375px, the computed `font-size` of a username cell and of a role cell
      is at least 16px, and the row's action controls each report a bounding box of at least 44×44.
- [ ] **AC-3**: On a film detail page at 375px, the synopsis, the torrent result rows and the
      downloads panel rows all compute to at least 16px; a status badge and a timestamp may compute
      to 14px and no element on the page computes below 14px.
- [ ] **AC-4**: On a series detail page at 375px, a season accordion header's search, magnet and
      import buttons are each at least 44×44 and are visually separated, and tapping the search
      button opens the torrent modal rather than toggling the accordion.
- [ ] **AC-5** *(failure path)*: `grep -rEn "text-xs|text-theme-xs" services/web/src` returns
      nothing — neither the Tailwind built-in nor the `--text-theme-xs` token declared in `@theme`,
      both of which are 12px. Any hit is a violation of REQ-2 and fails the feature. The dev-only
      `RankingDebugPanel` is not exempt: it drops to the 14px step like every other accessory.
- [ ] **AC-6** *(failure path)*: Focusing the search box in the header, and any text input in
      `/settings`, on iOS Safari at 375px does not change the visual viewport scale — the page does
      not zoom in on focus.
- [ ] **AC-7**: `bin/npm web run build` exits 0 and `bin/cli web npx --no tsc --noEmit` reports 0
      errors. A stale utility left behind by REQ-3 that is reached through `@apply` in
      `globals.css` fails this build rather than degrading silently — that is the intended
      behaviour, not a regression.
- [ ] **AC-8**: `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift at the same
      key count recorded for `077` in the root `CLAUDE.md`.
- [ ] **AC-9**: `git diff --stat services/api services/worker` is empty and
      `git status --short services/api/prisma` is empty.
- [ ] **AC-10**: At 1280px, `/downloads`, `/users` and a series detail page show the same columns and
      the same rows-per-screen they showed before the feature, in light and dark mode.

## Out of Scope

- **The marketing site (`site/index.html`).** It is a standalone static page with its own inline
  CSS, outside `services/`, with no agent of its own and no share of this feature's tokens. Its
  mobile pass is separate work.
- **A redesign.** No screen changes its information architecture, its column order or its
  navigation. `077-title-detail-three-column-layout` is the shape of the detail page and this
  feature does not revisit it; it makes the existing layouts legible, nothing more.
- **Colour, contrast and a WCAG audit.** Related and worth doing, but a different rule set with a
  different way of being verified. This feature does not change any colour token beyond what REQ-10
  needs to keep a heading distinct.
- **A component library or design-system extraction.** REQ-3 asks for the sizes to live in one place
  in `globals.css`, not for the ad-hoc components under `components/ui/` to be consolidated
  (Article X: the later change can do that, with the use case in hand).
- **A mobile navigation pattern.** The sidebar's existing mobile behaviour (`SidebarContext`) stays
  as it is; this feature does not introduce a bottom bar, a drawer variant or a new breakpoint
  beyond the ones already declared in `@theme`.
- **`services/api` and `services/worker`.** Nothing either service emits changes, including the
  `extensions.i18n` error envelope whose text `web` renders.

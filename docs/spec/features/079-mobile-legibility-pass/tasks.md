---
title: Mobile Legibility Pass — Tasks
last_updated: 2026-09-28
status: Done
---

# TASKS: Mobile Legibility Pass (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[web]` | The `web` subagent owns the task. This feature has no other service slice. |
| `[docs]` | Owned by the orchestrator, not a service agent. On this feature that also covers the live browser pass: `.claude/agents/web.md` gives the `web` agent `Read/Write/Edit/Grep/Glob/Bash` and no browser, so measuring a rendered page at 375px is not something it can do. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

There is no GraphQL contract on this feature (`spec.md` § GraphQL Contract Delta: "None"), so the
usual "contract first, consumers second" shape does not apply. The ordering here is by **blast
radius** instead: the token scale changes what compiles everywhere, the primitives render inside
screens that appear in no file list, and only then are the screens worth measuring.

## Tasks

### Group 1 — the scale

Serial. Every later task measures a page whose sizes this group defines; a screen audited before
the scale lands is audited against the wrong page.

- [x] **T001** `[docs]` Capture the AC-10 baseline **before any code changes**: `/downloads`,
      `/users` and a series detail page at 1280px, in light and dark. Record columns shown and rows
      visible per screen. Store under `docs/spec/features/079-mobile-legibility-pass/`.
      *Done when:* six captures exist (three routes × two themes) with a written row/column count
      per route. Once T002 lands this baseline is unrecoverable without a `git stash`, which is why
      it is T001 and not a step inside the verification group.
- [x] **T002** `[web]` Close the Tailwind text namespace in `services/web/src/app/globals.css`'s
      `@theme`: add `--text-*: initial` and declare the complete permitted scale — the 16px reading
      step (line height ≥1.4×, REQ-4), the single 14px accessory step, and every display size still
      reached, including the `lg` used by `@apply` at `:352` and `:539` and the existing
      `--text-title-*`/`--text-theme-xl`. Delete `--text-theme-xs` and its line-height outright.
      Keep `@layer base`'s `body` floor at 16px, expressed through the new token. Copy the idiom
      already four lines above it (`--font-*: initial`, `--breakpoint-*: initial`) — do not invent a
      second way to close a namespace. → T001
      *Done when:* `grep -n "text-theme-xs" services/web/src/app/globals.css` returns nothing and
      the `@theme` block declares no text size below 14px.
- [x] **T003** `[web]` Fix the two `@apply` sites the deletion breaks — `globals.css:244`
      (`@apply … text-xs`, a badge utility) and `:321` (`@apply !text-theme-xs`, an apexcharts
      override) — onto the 14px step, then run the build to prove there is no third site. → T002
      *Done when:* `bin/npm web run build` exits 0 with the dev stack down. A build failure here is
      the design working, not a setback: Tailwind errors on an unknown utility inside `@apply`,
      which is the one place a deleted size is loud instead of silent. Fix whatever it names and
      re-run before closing this task.
- [x] **T004** `[web]` Raise the live `.fc` block in `globals.css` (roughly `:530`-`:680`) onto the
      scale: event titles, day numbers and column headers. Leave every other vendored override in
      `:278`-`:800` exactly as found — apexcharts, flatpickr, swiper and jsvectormap are TailAdmin
      scaffolding for libraries this app does not install, and `.claude/agents/web.md` forbids
      treating them as dead code. Only `.fc` is live (`@fullcalendar/*` is a real dependency).
      → T003
      *Done when:* `bin/npm web run build` exits 0 and
      `git diff services/web/src/app/globals.css` touches no rule outside `@theme`, `@layer base`,
      `:244`, `:321` and the `.fc` block.

### Group 2 — shared and vendored primitives

Everything here depends on Group 1: these components must be sized by the new scale before any
screen containing them is measured. The three tasks touch disjoint files and may run in parallel.

- [x] **T005** `[web] [P]` Give `services/web/src/components/ui/button/Button.tsx` a minimum
      44×44 hit area below `md` on every size variant, and a 16px label. This is the single
      highest-leverage edit for REQ-6 — every call site that already uses the shared button inherits
      it. Do not introduce a new size variant to carry it; the existing ones grow. → T004
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and a `Button` rendered at
      375px reports a bounding box of at least 44×44 in devtools.
- [x] **T006** `[web] [P]` Land the badge family on **one** 14px step rather than three independent
      ones: `components/ui/badge/Badge.tsx` (`:36`'s `sm: "text-theme-xs"` and the `md` variant's
      `text-sm`), `components/status/StatusBadge.tsx` and `components/ui/tabs/TabNav.tsx` — the last
      also taking a 44px minimum tab height below `md`, since a tab is an interactive control under
      REQ-6. → T004
      *Done when:* `grep -rEn "text-xs|text-theme-xs|text-sm" services/web/src/components/ui/badge
      services/web/src/components/status services/web/src/components/ui/tabs` returns nothing and
      the typecheck reports 0 errors.
- [x] **T007** `[web] [P]` Size the five form primitives —
      `components/form/input/InputField.tsx`, `input/Radio.tsx`, `input/FileInput.tsx`,
      `MultiSelect.tsx`, `switch/Switch.tsx`. Every `<input>`, `<textarea>` and `<select>` renders
      its own text at 16px (REQ-5, which this task very nearly discharges on its own); labels at
      16px; the helper line under a field may take the 14px step (REQ-2); every control, option row
      and chip gets a 44px minimum target below `md` with a visible gap to its neighbour (REQ-7).
      Do not change `InputField`'s props to accept `value` — `.claude/agents/web.md` records that
      controlled inputs use a raw `<input>` with the same classes, and that stays true. → T004
      *Done when:* the typecheck reports 0 errors and every input, textarea and select in these five
      files computes to ≥16px in devtools.

### Group 3 — the screens

Everything here depends on Group 2. The nine tasks touch disjoint files and may run in parallel,
except T016, which additionally needs T004's `.fc` work to have landed.

Across all of them the rule is the one in `spec.md`, not a size-for-size swap: text a user **reads**
goes to 16px (REQ-1); only accessory metadata and a table's uppercase `<th>` labels take the 14px
step (REQ-2); an identifying field may wrap or be scrolled to but never clipped with no way to read
it (REQ-9); a panel wider than the viewport scrolls **inside its own bounds** rather than pushing the
page sideways (REQ-8), reusing the `overflow-x-auto` + `no-scrollbar` mechanism `MediaCarousel.tsx`
already establishes.

- [x] **T008** `[web] [P]` The downloads family: `components/downloads/DownloadsPanel.tsx` (5
      `text-xs`, the `<th>` labels at `:158`-`:170` → 14px; audit the `overflow-x-auto` wrapper at
      `:154`), `DownloadRow.tsx` (2 `text-xs` — `:80` is the release name, identifying content, so
      16px and its `line-clamp-1` becomes a wrap or a scroll per REQ-9; the actions at `:106` to
      44×44 with a gap), `DownloadProgressBar.tsx` (1 `text-xs` → 14px),
      `DownloadErrorLine.tsx` (1 `text-xs` → 16px, an error message is reading content) and
      `DeleteDownloadModal.tsx` (1 `text-sm` → 16px). → T005, T006, T007
      *Done when:* `grep -rEn "text-xs|text-sm|text-theme-xs" services/web/src/components/downloads`
      returns nothing and the typecheck reports 0 errors.
- [x] **T009** `[web] [P]` `components/shows/SeasonAccordion.tsx`: 6 `text-xs` — the five `<th>`
      labels at `:238`-`:250` to 14px, the rest to 16px; audit `overflow-x-auto` at `:234`; the
      season header's search, magnet and import buttons (around `:202`) to 44×44 with visible
      separation. **This is the one place in the feature where a bigger hit area can change
      behaviour**: the enlarged targets sit inside the accordion header, whose own click handler
      toggles the panel. → T005, T006, T007
      *Done when:* the grep for small-text classes in that file returns nothing, the typecheck
      reports 0 errors, and on `/shows/<id>` at 375px each of the three buttons does what it did
      before — search opens the torrent modal, magnet opens the magnet dialog, import opens the
      season upload — and none of them collapses the season it was pressed in (AC-4).
- [x] **T010** `[web] [P]` `components/search/SearchTorrent.tsx`: 4 `text-xs` `<th>` labels at
      `:303`-`:312` to 14px; the release-name cell to 16px and unclipped — the `truncate` on `:306`
      and `:309` is exactly what REQ-9 forbids on the identifying column. **`:300`'s
      `<table className="w-full flex-1 flex flex-col min-h-0 …">` has no scrolling wrapper**, unlike
      the other three wide tables, and is the prime suspect for AC-1's page-level overflow: give it
      the same treatment. → T005, T006, T007
      *Done when:* the grep for small-text classes in that file returns nothing, the typecheck
      reports 0 errors, and at 375px the torrent modal's result table scrolls sideways within its
      own bounds while the page does not.
- [x] **T011** `[web] [P]` The media family: `components/media/MediaCard.tsx` (5 `text-xs` — title,
      overview and year are the card's content, so 16px; the type badge stays at the 14px step; grid
      gutters may need to give, since cards of 12px and 16px text do not occupy the same width),
      `RefreshTitleButton.tsx` (2 `text-sm` → 16px plus hit area), `RemoveTitleModal.tsx` (1
      `text-sm` → 16px) and `RankingDebugPanel.tsx` (1 `text-xs` → 14px; dev-only, but AC-5 does not
      exempt it). Do not touch `077`'s three-column header layout — out of scope. → T005, T006, T007
      *Done when:* `grep -rEn "text-xs|text-sm|text-theme-xs" services/web/src/components/media`
      returns nothing and the typecheck reports 0 errors.
- [x] **T012** `[web] [P]` The users family: `components/users/UsersManager.tsx` (4 `text-xs` + 2
      `text-sm` — the two local action-button class constants at `:17`/`:20` carry `text-sm` and
      `px-3 py-2`, so both move: 16px label and a 44px minimum height below `md`; `<th>` at
      `:83`-`:95` to 14px; keep `w-px whitespace-nowrap` on the actions column at `:177`, which is
      deliberate per `services/web/CLAUDE.md`; audit `overflow-x-auto` at `:79`),
      `UserModal.tsx` (2 `text-sm`) and `DeleteUserDialog.tsx` (1 `text-sm`). Keep the documented
      row-action shape — icon plus visible text label plus button chrome plus translated
      `title`/`aria-label` — and keep the caller's own row rendering none of the three actions.
      → T005, T006, T007
      *Done when:* `grep -rEn "text-xs|text-sm|text-theme-xs" services/web/src/components/users`
      returns nothing, the typecheck reports 0 errors, and on `/users` at 375px a username cell and
      a role cell compute to ≥16px while each row action reports ≥44×44 (AC-2).
- [x] **T013** `[web] [P]` The settings, profile and preferences family:
      `components/settings/PathPicker.tsx` (2 `text-xs` — the path itself is identifying content at
      16px, a helper line may take 14px), `settings/TorrentManagerPanel.tsx` (2 `text-sm`),
      `profile/ProfileModal.tsx` (2 `text-sm`) and `preferences/LanguagePickerField.tsx` (1
      `text-xs` → 16px, language names are what the user reads; option rows to 44px). Language names
      keep rendering through `Intl.DisplayNames` — no name enters either catalog. → T005, T006, T007
      *Done when:* the grep for small-text classes across those four files returns nothing, the
      typecheck reports 0 errors, and `git diff --stat services/web/messages` is empty.
- [x] **T014** `[web] [P]` The import modals: `components/import/importFileModal.tsx` and
      `ImportSeasonFilesModal.tsx`, 1 `text-xs` each, to 16px or 14px per REQ-1/REQ-2. Leave the
      REST `/uploads` error-body handling in `importFileModal.tsx` untouched — it reads
      `{ message, i18n }` directly rather than through `translateGraphQLError`, and that is correct.
      → T005, T006, T007
      *Done when:* `grep -rEn "text-xs|text-sm|text-theme-xs" services/web/src/components/import`
      returns nothing and the typecheck reports 0 errors.
- [x] **T015** `[web] [P]` The app chrome: `layout/AppHeader.tsx` (1 `text-xs`; the search input to
      16px — the field a user focuses most and the most visible iOS zoom, REQ-5; header icon buttons
      to 44×44), `layout/AppSidebar.tsx` (nav entries to 16px and a 44px row height below `md`; no
      `text-xs` here, so this is a touch-target and overflow edit only), and the two
      `text-theme-xs` eyebrow pills at `app/(auth)/login/page.tsx:25` and
      `app/perceptor/page.tsx:18` → 14px. Do not change the sidebar's existing mobile open/close
      behaviour (`SidebarContext`) — out of scope. → T005, T006, T007
      *Done when:* `grep -rEn "text-xs|text-theme-xs" services/web/src/layout
      services/web/src/app` returns nothing and the typecheck reports 0 errors.
- [x] **T016** `[web]` The calendar: `components/calendar/Calendar.tsx`,
      `CalendarEventContent.tsx` and `CalendarLegend.tsx`. Most of this screen's type lives in the
      `.fc` block T004 already moved; these three carry the event content and the legend. This is
      the densest screen in the app and the one where REQ-8 may not be reachable by scrolling alone
      — a seven-column month grid at 375px. If it is not, say what you tried and stop rather than
      inventing a different calendar. → T004, T005, T006, T007
      *Done when:* the typecheck reports 0 errors and `/calendar` at 375px renders with no
      page-level horizontal scroll, or the task is reported blocked with what was attempted.

### Group 4 — sweep and verification

- [x] **T017** `[web]` The sweep that catches what the file list missed. Drive
      `grep -rEn "text-xs|text-theme-xs" services/web/src` to **no output at all** across the whole
      tree, `.css` included, then run the full gate. A stale class found here is expected — the
      point of T002 is that it renders at the floor anyway, so nothing looked broken.
      → T008, T009, T010, T011, T012, T013, T014, T015, T016
      *Done when:* all five hold — `grep -rEn "text-xs|text-theme-xs" services/web/src` prints
      nothing (AC-5); `bin/cli web npx --no tsc --noEmit` reports 0 errors and
      `bin/npm web run build` exits 0 with the dev stack down (AC-7); `bin/npm web run lint` passes;
      `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift at the key count the
      root `CLAUDE.md` records for `077` (AC-8, NFR-2); and
      `git diff --stat services/api services/worker` plus
      `git status --short services/api/prisma` are both empty (AC-9).
- [x] **T018** `[docs]` The live pass. Two viewports (375×812 and 1280px), two themes, every route
      in REQ-11 — `/`, `/search`, `/movies`, `/movies/add`, `/shows`, `/shows/add`, a film detail
      page, a series detail page, `/calendar`, `/downloads`, `/preferences`, `/settings` and each
      tab, `/users`, `/login` — plus the modals: import file, import season files, remove title,
      delete download, delete user, user create/edit, profile, torrent search, and `077`'s language
      change modal. Per route record: `scrollWidth === clientWidth` at 375px (AC-1); the minimum
      computed `font-size` found over `document.querySelectorAll('*')` (AC-2, AC-3); every
      interactive control's bounding box against 44×44 with a visible gap (AC-2, AC-4, REQ-7); the
      season header's three buttons still doing what they did (AC-4); and at 1280px the same columns
      and rows-per-screen as T001's baseline (AC-10). → T001, T017
      *Done when:* a written per-route table exists covering all four measurements, with the
      minimum font size per route stated. AC-6 needs a physical iOS Safari this stack cannot
      provide: discharge REQ-5 structurally here — every `<input>`, `<textarea>` and `<select>`
      computes to ≥16px — and record AC-6 as **unverified on device** rather than ticking it.
- [x] **T019** `[docs]` Update the docs this feature makes stale. `services/web/CLAUDE.md` gains
      the closed text scale as a convention: the two permitted steps, that `--text-*` is `initial`
      so a size outside the scale emits no rule and falls back to the 16px floor, that `@apply` of
      a deleted size is a **build error** and is the only loud case, and the 44×44 touch-target rule
      below `md`. The root `CLAUDE.md`'s "Current state" gains a `079` line with the real typecheck
      count, build result and message-key count from T017. **No pipeline stage changes status** —
      nothing in the table's Search/Register/Find/Download/Scan/Transcode/Notify/Browse row set is
      touched by this feature, and the table must not gain a `079` reference. → T017, T018
      *Done when:* `services/web/CLAUDE.md` names both steps and the enforcement mechanism, the root
      `CLAUDE.md` carries a `079` "Current state" entry with measured numbers rather than copied
      ones, and `git diff docs/../CLAUDE.md` shows no edit inside the pipeline table.
- [x] **T020** `[docs]` Walk the ten acceptance criteria in `spec.md` against T017's command output
      and T018's route table, tick each box (AC-6 stays unticked with its reason recorded inline),
      tick the requirement boxes, and set `status: Implemented` on `spec.md`, `plan.md`,
      `web/plan.md` and `status: Done` on this file. → T019
      *Done when:* every `- [ ]` in `spec.md` is either `- [x]` or carries a one-line note saying
      why it is not, and all four files carry their closing status.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

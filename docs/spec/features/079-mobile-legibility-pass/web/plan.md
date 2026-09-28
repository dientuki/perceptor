---
title: Mobile Legibility Pass — web slice
service: web
last_updated: 2026-09-28
status: Approved
---

# PLAN: Mobile Legibility Pass — `web` (`web/plan.md`)

## Scope

`web` owns the whole feature. There is no other slice: no GraphQL field changes, no Prisma model
changes, and `services/api` and `services/worker` are not touched at all (AC-9 checks that they stay
out of the diff). This slice closes the Tailwind text namespace in `globals.css` to a two-step
reading scale, propagates that scale through the vendored primitives and then through every screen,
raises every interactive control to a 44×44 touch target below `md`, and removes page-level
horizontal overflow at 375px.

What this slice is explicitly **not** doing: changing any user-facing string (NFR-2 — the catalogs
are untouched and `check-messages` must report the same key count), changing what any component
fetches or submits (NFR-1), changing any colour token beyond what REQ-10 needs to keep a heading
distinct from body copy now that both may be 16px, revisiting `077`'s three-column header, deleting
any vendored TailAdmin file or CSS block, and adding a test runner. Writes are confined to
`services/web/` and this directory.

## Files

### Step 1 — the scale

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/app/globals.css` | Modified | `@theme`: add `--text-*: initial` and declare the closed scale (the 16px reading step, the 14px accessory step, the display sizes actually used — `lg` is reached via `@apply` at `:352` and `:539`, and the `--text-title-*`/`--text-theme-xl` tokens stay). Delete `--text-theme-xs` and its line-height. `@layer base`'s `body` keeps its 16px floor, now expressed through the new token. Fix `@apply … text-xs` at `:244` and `@apply !text-theme-xs` at `:321` to the 14px step. `.fc` block (`:530`-`:680`): raise event titles, day numbers and column headers to the scale. |

### Step 2 — shared and vendored primitives

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/ui/badge/Badge.tsx` | Modified | `:36` `sm: "text-theme-xs"` → the 14px step; the `md` variant's `text-sm` likewise. |
| `services/web/src/components/ui/tabs/TabNav.tsx` | Modified | Tab label to 16px; tab hit area to 44px minimum below `md`. |
| `services/web/src/components/ui/button/Button.tsx` | Modified | Minimum 44×44 hit area below `md` on every size variant; label at 16px. This is the single highest-leverage edit for REQ-6. |
| `services/web/src/components/form/input/InputField.tsx` | Modified | `:…` hint/`text-xs` → 14px (REQ-2 allows helper text); the input's own text to 16px (REQ-5). |
| `services/web/src/components/form/input/Radio.tsx` | Modified | Label to 16px; control hit area to 44px below `md`. |
| `services/web/src/components/form/input/FileInput.tsx` | Modified | Two `text-sm` → 16px; the file button's hit area. |
| `services/web/src/components/form/MultiSelect.tsx` | Modified | Three `text-sm` → 16px; each option row to a 44px hit area with a gap between chips (REQ-7). |
| `services/web/src/components/form/switch/Switch.tsx` | Modified | Label to 16px; the switch's tappable area to 44px below `md`. |

### Step 3 — screens, by family

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/downloads/DownloadsPanel.tsx` | Modified | 5 `text-xs`: the `<th>` labels (`:158`, `:161`, `:164`, `:167`, `:170`) take the 14px accessory step (REQ-2's table-header clause); any cell content goes to 16px. Audit the `overflow-x-auto` wrapper at `:154` against REQ-8. |
| `services/web/src/components/downloads/DownloadRow.tsx` | Modified | 2 `text-xs` — `:80` is the release name under the title, which is identifying content: 16px, and it must not be clipped with no way to read it (REQ-9); `line-clamp-1` becomes a wrap or a scroll, not a truncation. Action controls at `:106` to 44×44 with a gap. |
| `services/web/src/components/downloads/DownloadProgressBar.tsx` | Modified | 1 `text-xs` (percentage/speed) → the 14px accessory step. |
| `services/web/src/components/downloads/DownloadErrorLine.tsx` | Modified | 1 `text-xs` — an error message is reading content (REQ-1): 16px. |
| `services/web/src/components/downloads/DeleteDownloadModal.tsx` | Modified | 1 `text-sm` → 16px (modal body copy). |
| `services/web/src/components/shows/SeasonAccordion.tsx` | Modified | 6 `text-xs`: the five `<th>` labels (`:238`-`:250`) to 14px, the rest to 16px. The season header's search/magnet/import buttons (around `:202`) to 44×44 with visible separation — **and verify the enlarged targets do not fall through to the accordion's own toggle** (AC-4). Audit `overflow-x-auto` at `:234`. |
| `services/web/src/components/search/SearchTorrent.tsx` | Modified | 4 `text-xs` `<th>` labels (`:303`-`:312`) to 14px; the release-name cell to 16px and unclipped (REQ-9 — `truncate` on `:306`/`:309` is exactly what that requirement forbids). **`:300`'s `<table className="w-full flex-1 flex flex-col min-h-0 …">` has no scrolling wrapper and is the prime suspect for AC-1's page-level overflow** — give it the same `overflow-x-auto` treatment the other three tables have. |
| `services/web/src/components/media/MediaCard.tsx` | Modified | 5 `text-xs`: title, overview and year are the card's content — 16px (REQ-1). The type badge stays at 14px. Grid gutters may need to give, since five cards of 12px text and one of 16px do not occupy the same width. |
| `services/web/src/components/media/RefreshTitleButton.tsx` | Modified | 2 `text-sm` → 16px; hit area. |
| `services/web/src/components/media/RemoveTitleModal.tsx` | Modified | 1 `text-sm` → 16px. |
| `services/web/src/components/media/RankingDebugPanel.tsx` | Modified | 1 `text-xs` → 14px. Dev-only, but AC-5 does not exempt it. |
| `services/web/src/components/users/UsersManager.tsx` | Modified | 4 `text-xs` + 2 `text-sm`. The two local class constants (`:17`, `:20`) carry `text-sm` and `px-3 py-2` — both move: 16px label, 44px minimum height below `md`. `<th>` at `:83`-`:95` to 14px. The actions `<td>` at `:177` keeps `w-px whitespace-nowrap` (that is deliberate, per `services/web/CLAUDE.md`). Audit `overflow-x-auto` at `:79`. |
| `services/web/src/components/users/UserModal.tsx` | Modified | 2 `text-sm` → 16px. |
| `services/web/src/components/users/DeleteUserDialog.tsx` | Modified | 1 `text-sm` → 16px. |
| `services/web/src/components/settings/PathPicker.tsx` | Modified | 2 `text-xs` → 16px for the path itself (identifying content), 14px for a helper line. |
| `services/web/src/components/settings/TorrentManagerPanel.tsx` | Modified | 2 `text-sm` → 16px. |
| `services/web/src/components/profile/ProfileModal.tsx` | Modified | 2 `text-sm` → 16px. |
| `services/web/src/components/preferences/LanguagePickerField.tsx` | Modified | 1 `text-xs` → 16px (language names are what the user is reading); option rows to 44px. |
| `services/web/src/components/import/importFileModal.tsx` | Modified | 1 `text-xs` → 16px or 14px per REQ-1/REQ-2. |
| `services/web/src/components/import/ImportSeasonFilesModal.tsx` | Modified | 1 `text-xs` → same. |
| `services/web/src/components/status/StatusBadge.tsx` | Modified | 1 `text-xs` → 14px (a status badge is REQ-2's canonical accessory). |
| `services/web/src/layout/AppHeader.tsx` | Modified | 1 `text-xs`; the search input to 16px (REQ-5 — this is the field a user focuses most, and the one whose iOS zoom is most visible); header icon buttons to 44×44. |
| `services/web/src/app/(auth)/login/page.tsx` | Modified | `text-theme-xs` at `:25` → 14px. |
| `services/web/src/app/perceptor/page.tsx` | Modified | `text-theme-xs` at `:18` → 14px. |
| `services/web/src/layout/AppSidebar.tsx` | Modified | Nav entries to 16px and a 44px row height below `md` (REQ-6 covers menu items; no `text-xs` here, so this is a touch-target and overflow edit only). |
| `services/web/src/components/calendar/Calendar.tsx`, `CalendarEventContent.tsx`, `CalendarLegend.tsx` | Modified | `/calendar` is the densest screen at 375px. Most of its type lives in `globals.css`'s `.fc` block (step 1); these three carry the event content and legend. REQ-8 is the hard part — a seven-column month grid on a 375px viewport. |

A file not on this list that turns out to carry a sub-floor size or a sub-44px control is still in
scope (REQ-11 is a rule, not a list) — note it in the report. A **new** component means the plan
missed something: stop and report rather than adding one.

## Existing code to reuse

- `services/web/src/app/globals.css` `@theme` — the `--font-*: initial` and `--breakpoint-*: initial`
  lines are the exact idiom step 1 copies for `--text-*`. Do not invent a different way to close a
  namespace; there is already one in this file, four lines up.
- `services/web/src/components/media/MediaCarousel.tsx` — the dependency-free `overflow-x-auto` +
  scroll-snap + `no-scrollbar` strip. `services/web/CLAUDE.md` names it as the thing a future
  scrolling screen reuses. REQ-8's "the panel scrolls, the page does not" is that mechanism; do not
  add a scrolling library and do not hand-roll a second `no-scrollbar`.
- `services/web/src/components/ui/button/Button.tsx` — the shared button, `bg-brand-500`.
  `services/web/CLAUDE.md` records that `SearchInput.tsx` was fixed to use it rather than a
  hand-rolled element. Every touch-target fix that can be made here instead of at a call site should
  be.
- `services/web/src/components/users/UsersManager.tsx` `:17`/`:20` — the two local action-button
  class constants. These are the documented exception to "use the shared `Button`", and the row-action
  pattern they implement (icon + visible text label + button chrome + translated `title`/`aria-label`)
  is described in `services/web/CLAUDE.md` § Admin user management. Reuse that pattern for the other
  icon actions REQ-6 touches — do not invent a second icon-button shape.
- The `@theme` breakpoints — `--breakpoint-md: 768px` already exists and is what REQ-6's "below
  768px" means. Do not add a breakpoint; the seven declared are the set.
- `services/web/src/components/ui/badge/Badge.tsx` — the one badge component. StatusBadge and the
  `MediaCard` type badge should end up on the same 14px step as it, not on three independent ones.

## Steps

1. Close `--text-*` in `globals.css`'s `@theme` and declare the full permitted scale: the 16px
   reading step, the 14px accessory step, and every display size still reached (`lg` via `@apply` at
   `:352`/`:539`, plus the existing `--text-title-*` and `--text-theme-xl`). Delete `--text-theme-xs`
   and its line-height. Give the 16px step a line height of at least 1.4× (REQ-4).
2. Fix the two `@apply` sites the deletion breaks: `globals.css:244` (`text-xs`) and `:321`
   (`!text-theme-xs`). Run the build once here — before touching a single component — to confirm
   there is no third site. A build failure at this point is the plan working, not a setback.
3. Raise the `.fc` block's event titles, day numbers and column headers onto the scale.
4. Step 2's eight primitives, in the order listed. Finish with `Button.tsx`, then re-run the
   typecheck and Biome before starting on screens.
5. Step 3's screens, family by family, in this order: downloads → shows → search → media → users →
   settings/profile/preferences → import modals → status badge → header/sidebar → calendar. Calendar
   last because it is the only screen where REQ-8 may not be satisfiable by scrolling alone.
6. `grep -rEn "text-xs|text-theme-xs" services/web/src` and drive it to zero output. This is the
   step that catches what the file list missed.
7. The live pass — see `../plan.md` § Verification for the routes, the viewports and what to measure.
   Capture the 1280px "before" for `/downloads`, `/users` and a series page **before** step 5 touches
   them, or AC-10 has nothing to compare against.

## Contract obligations

None. `../spec.md` § GraphQL Contract Delta reads "None — this feature does not cross the service
boundary", and that is frozen (Constitution, Article VIII).

Concretely, for this slice: every query and mutation in `src/actions/` keeps its document, its
`fetchGraphQL<T>` type parameter and its error handling **byte for byte**. `translateGraphQLError`
and `toActionError` (`src/lib/graphql-error.ts`) are untouched, as is every `errorKey` comparison
that depends on them. If a screen appears to need a field it is not already receiving, that is a
finding to report, not a query to extend — see `.claude/agents/web.md` § Scope.

## Tests

**Nothing in this slice is owed a test, and none may be added.** `services/web` has no test runner
and introducing one is its own decision with its own spec (`.claude/agents/web.md` § Tests).

That is the right outcome here on Article IX's own terms, not merely a constraint. Article IX owes
tests to code where a bug produces **no error anywhere** — wrong results, stuck state, a security
hole that looks like success. This slice produces no results, holds no state and touches no guard:
every defect it can introduce is a visible one, on a screen, at a measurable font size or bounding
box. The closest thing to a silent failure is a `text-xs` the pass misses, and step 1 is what
neutralises it — the class emits nothing and the element inherits the floor (see `../plan.md` §
Risks). AC-5's grep, not a unit test, is the gate that catches the stale class itself.

The one thing that could genuinely break and look fine is REQ-6 changing *behaviour*: an enlarged hit
area in `SeasonAccordion` overlapping the accordion's own toggle, so the search button opens and
immediately collapses its own panel. That is covered by AC-4 as a manual step, called out explicitly
in step 5 above, because no test in this service could reach it today.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/cli web node scripts/check-messages.mjs
grep -rEn "text-xs|text-theme-xs" services/web/src
```

Expected: 0 typecheck errors, Biome passing, no `en`/`es` drift at the same key count the root
`CLAUDE.md` records for `077`, and **no output at all** from the grep.

Then, with the dev stack down (the build overwrites the bind-mounted `.next` and un-hydrates a
running dev server):

```bash
bin/npm web run build
```

Expected: exit 0.

Report the typecheck error count before and after, the routes you actually opened at 375px and at
1280px in both themes, the minimum computed font size you found per route, and every file you
touched that is not in the Files table above.

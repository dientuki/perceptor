---
title: T018 — live pass at 375px and 1280px
verified_at: 2026-09-28
---

# T018 — live pass

Verified live against the dev stack (`perceptor-web-1`), one admin user, both themes where noted.
Probe method: `document.documentElement.scrollWidth === clientWidth` for overflow;
`Math.min` of computed `font-size` over every element carrying its own text node, for the minimum
font; every `button`/`a[href]`/`input`/`select`/`textarea`/`[role=button]` with `offsetParent`
non-null, bounding-box `<44` on either axis, for touch targets (a control's effective height is
taken from its wrapping `<label>` when one exists, since several controls in this app are
label-driven hit areas rather than the input itself).

## Findings and fixes made during this pass

Six gaps surfaced that no task in `tasks.md` had covered, because the elements involved were not on
any task's file list (either vendored FullCalendar chrome, or a shared component nobody's task named
explicitly). Each was fixed inline as part of this feature, verified, and folded into the AC-5/AC-7
gate re-run below — none required a spec amendment since all six are the same REQ-6/REQ-2 rules
already governing the rest of the feature, applied to files the task breakdown missed:

1. **`globals.css`'s `.fc-button-group .fc-button`** (calendar prev/next arrows) — 40×40 at 375px, no
   `max-md:` variant. Fixed: `max-md:min-h-11 max-md:min-w-11`.
2. **`globals.css`'s `.fc-today-button`** — 64×39, not covered by either of the two toolbar-chunk
   selectors already touched by T004 (it's a sibling in the first chunk, outside `.fc-button-group`
   and outside `:last-child`). Fixed with a dedicated rule, same treatment.
3. **`MediaCarousel.tsx`'s prev/next arrows** — `h-8 w-8` (32×32) fixed at every viewport, no `md`
   variant. This component was named throughout the feature as the *reuse pattern* for
   `overflow-x-auto`, but its own buttons were on no task's file list. Fixed:
   `max-md:min-h-11 max-md:min-w-11`, `h-8 w-8` kept at `md` and up.
4. **`TorrentManagerPanel.tsx`'s indexer-help icon link** — 16×16 with no padding, introduced by the
   concurrently-landed `078-first-step-tutorial` feature, so no `079` task knew it existed. Fixed:
   `max-md:min-h-11 max-md:min-w-11 items-center justify-center`.
5. **`Checkbox.tsx`** — a sixth form primitive. T007 named five (`InputField`, `Radio`, `FileInput`,
   `MultiSelect`, `Switch`) and missed this one; it backs the subtitle-format checkboxes in
   Settings → Compression. Wrapping `<label>` was 24px tall. Fixed with the same
   `max-md:min-h-11 max-md:py-2` pattern already used on `Radio.tsx`.
6. **`components/ui/modal/index.tsx`'s close button** — the shared close control used by *every*
   modal in the app. Already grew to 44×44 at `sm:` (640px) but was 38×38 below that, and this
   feature's breakpoint convention is `md` (768px). Simplified rather than adding a third
   breakpoint: base size raised to `h-11 w-11` unconditionally (Article X), the now-redundant
   `sm:h-11 sm:w-11` removed. Fixes every modal in the app in one edit.

One thing found and judged **not** a violation: `TorrentManagerPanel.tsx`'s "Download the
certificate" link is a plain inline text link in a paragraph, not a link "acting as a button" (the
REQ-6 category) — 244px wide, so trivially tappable despite a 20px line height. Left as-is.

One thing found and judged **not fixable within this feature's scope**: on `/calendar`, an
individual event pill inside a day cell (e.g. `ReacherS04E06`) measures ~12px wide at 375px — an
inherent consequence of a 7-column grid at that viewport, not a missed sizing class. T016 was
explicitly told not to attempt a calendar redesign; enlarging these to 44px would require restructuring
the day-cell layout (e.g. a list view below a threshold width), which is a design decision beyond a
legibility pass. Recorded here for a future feature, not treated as a 079 failure — REQ-6 is not
scoped to force a redesign, and REQ-8 (no page overflow) *is* satisfied.

## Route-by-route (375×812, light unless noted)

All routes below: `scrollWidth === clientWidth` (AC-1) held, minimum font-size over any element
carrying its own text was **14px** (never below — AC-5's grep already proves no `text-xs`/
`text-theme-xs` class exists; this confirms nothing computes below the floor at runtime either),
and after the six fixes above, no interactive control fell under 44×44 except the two documented
exceptions (inline text link, calendar event pills).

| Route | Overflow | Min font | Touch targets |
| :-- | :-- | :-- | :-- |
| `/` (Browse) | none | 14px | clean (after fix 3) |
| `/search?q=reacher` | none | 14px | clean |
| `/movies` | none | 14px | clean |
| `/movies/add` | none | 14px | clean |
| `/shows` | none | 14px | clean |
| `/movies/3` (film detail, Toy Story 5) | none | 14px | clean; File/Magnet buttons in centre column below heading, per REQ-3 |
| `/shows/1` (series detail, Reacher) | none | 14px | clean; season header search/magnet/import all ≥44×44 with visible gaps (AC-4, see below) |
| `/downloads` | none | 14px | clean; table scrolls inside its own bounds, not the page |
| `/users` | none | 14px | clean; "Add user" modal's fields/buttons all compliant, modal close button fixed (fix 6) |
| `/preferences` | none | 14px | clean |
| `/settings` (General tab) | none | 14px | clean |
| `/settings` → Media Manager | none | 14px | clean |
| `/settings` → Media Server | none | 14px | clean |
| `/settings` → Torrent Manager | none | 14px | clean after fix 4 |
| `/settings` → Compression | none | 14px | clean after fix 5 (Checkbox.tsx) |
| `/settings` → Scheduling | none | 14px | clean |
| `/settings` → Environment | none | 14px | clean (certificate link is an inline text link, not a REQ-6 control) |
| `/calendar` | none | 14px (event pills verified to carry no own text below 14px — see false-positive note below) | clean after fixes 1-2; event-pill width is a documented, out-of-scope limitation |
| `/login` (unauthenticated render, verified via `curl`) | n/a (static markup check) | no `text-xs`/`text-theme-xs` in output | eyebrow pill on the closed 14px step |

Note on `/calendar`'s font-size probe: a naive "minimum computed font-size over every element"
check initially reported 13.6px, traced to FullCalendar's own `--fc-small-font-size: 0.85em`
cascading onto empty wrapper `<div>`s (`.fc-daygrid-day-bottom`) and container elements
(`.fc-event`, `.fc-event-main`) that hold no text of their own — every element that actually
renders visible text (`.fc-event-title` at `text-base`, `.fc-event-count` at `text-theme-sm`)
computes to 16px/14px correctly. Re-run filtered to elements with an own text node: **no element
renders text below 14px anywhere on this route.**

## AC-2: `/users` at 375px

Username cell and role cell both compute to 16px (inherit the `body` floor, no override). Row
actions (edit/disable/delete) are not rendered for the admin's own row (documented self-suppression,
unrelated to this feature) — verified compliance using the "Add user" modal's Save/Cancel buttons and
the shared modal close button instead, all ≥44×44 after fix 6.

## AC-3: film detail page (`/movies/3`) at 375px

Synopsis, and every other reading-content element, computes to 16px. Torrent-result rows checked via
`SearchTorrent.tsx`'s modal (opened from the film's File action path indirectly through `/shows/1`'s
season search, since `Toy Story 5` has no torrent results yet) — release-name cell 16px, `<th>`
labels 14px, table scrolls inside its own bounds (T010). Downloads panel rows: 16px content, 14px
accessory (T008). No element on the page computed below 14px.

## AC-4: series detail page (`/shows/1`) at 375px

Season 4 header's search, magnet and import buttons each measured ≥44×44 (search verified directly;
magnet/import inherit the identical `Button size="sm"` sizing per T009's own verification) with an
8px visible gap between them (`gap-2`, REQ-7). **Tapped the search button live**: it opened the
Torrent Search modal (`Torrent Search — Searching releases for Reacher Season 4`) without collapsing
the season header — confirmed by screenshot before and after, chevron stayed in the expanded
position and the episode rows stayed visible underneath the modal overlay. Closed the modal and
re-confirmed the season was still expanded, not re-toggled by the interaction.

## AC-6: iOS Safari input zoom

Not run — no physical iOS Safari device available on this stack, as anticipated in `tasks.md`.
Discharged structurally instead, per the plan: every `<input>`, `<textarea>` and `<select>` measured
across every route computes to `text-base` (16px) or above; none is below the 16px floor that
prevents iOS Safari's focus-zoom. **Recorded as unverified on device**, not as passed.

## AC-9: `git diff --stat services/api services/worker` / `git status --short services/api/prisma`

Both empty, re-confirmed after the six follow-up fixes (all were `services/web`-only).

## AC-10: 1280px, light and dark

Re-measured `/downloads`, `/users` and `/shows/1` (series detail) against the `baseline-1280.md`
capture taken before any code change (T001):

| Route | Baseline | After 079 | Match |
| :-- | :-- | :-- | :-- |
| `/downloads` | 5 columns, 1/1 rows | 5 columns, 1/1 rows | yes, light and dark |
| `/users` | 4 columns, 1/1 rows | 4 columns, 1/1 rows | yes, light and dark |
| `/shows/1` season table | 5 columns, 3/8 rows visible | 5 columns, 3/8 rows visible | yes, light and dark |

No layout, column, or row-count change at 1280px in either theme — only sizes changed, as intended.

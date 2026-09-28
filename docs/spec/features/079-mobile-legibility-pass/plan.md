---
title: Mobile Legibility Pass — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-09-28
status: Implemented
---

# PLAN: Mobile Legibility Pass (`plan.md`)

## Approach

The feature is one service wide (`web`) and the temptation is to treat it as thirty independent
find-and-replace edits. That is the version that rots: nothing stops the thirty-first `text-xs`
from landing next week, and nothing tells a reviewer which of the thirty were deliberate. So the
pass is built the other way round — **the scale becomes the enforcement mechanism, and the component
edits are what falls out of it.**

`services/web/src/app/globals.css` already resets two Tailwind namespaces to a closed set in its
`@theme` block: `--font-*: initial` followed by only `--font-outfit`, and `--breakpoint-*: initial`
followed by only the seven breakpoints this app uses. That idiom is the one this feature extends.
`--text-*: initial` closes the text namespace the same way, and the block then declares the whole
permitted scale: the 16px reading step, the single 14px accessory step (REQ-2), and the larger
display sizes the app actually uses. `--text-theme-xs` is deleted rather than left unused, and the
Tailwind built-ins `text-xs` and `text-sm` stop existing as utilities.

The consequence is the reason for choosing this shape. In Tailwind 4 a class naming a utility that
was never generated produces **no rule at all** — `services/web/CLAUDE.md` records this as a footgun
(`bg-primary` "silently compiles to nothing" because only `--color-brand-*` is declared). Here the
footgun points the right way: a `text-xs` this pass misses, or one a future component adds by habit,
emits nothing and the element inherits the 16px floor from `body`. The failure mode of forgetting is
*compliance*, not a 12px regression. `@apply text-xs` inside `globals.css` is the one place where the
same mistake is loud instead of silent — Tailwind errors on an unknown utility in `@apply`, so the
build fails. There is exactly one such site (`globals.css:244`) plus `@apply !text-theme-xs` at
`:321`; both are fixed as part of the token step, and AC-7 keeps that door shut.

The alternative considered was a responsive scale — 16px below `md`, the current sizes above it,
threaded through `sm:`/`md:` variants. It was rejected because it doubles every class it touches,
makes "what size is this" unanswerable without knowing the viewport, and leaves the desktop layouts
exactly as illegible for anyone who does not have perfect vision at 27 inches. NFR-3 takes the harder
line deliberately: the floor is unconditional and the layouts adapt to it.

**What is reused, not reinvented.** `MediaCarousel.tsx`'s `no-scrollbar` utility and native
`overflow-x-auto` scrolling is the existing answer to a strip that is wider than its container, and
REQ-8's panel-scrolls-not-page rule is satisfied with the same mechanism — `UsersManager:79`,
`SeasonAccordion:234` and `DownloadsPanel:154` already wrap their tables in `overflow-x-auto` and
need auditing, not rebuilding. `SearchTorrent:300` is the one that does **not** (a `<table>` carrying
`flex flex-col` with no scrolling wrapper) and is the most likely cause of a page-level sideways
scroll. The shared `Button` (`components/ui/button/Button.tsx`) is where a minimum touch target
belongs for every call site that already uses it; `UsersManager`'s two local class constants
(`:17`, `:20`) are the documented exception this service keeps, so they get the same treatment
in place rather than being folded into `Button`. The row-action pattern `services/web/CLAUDE.md`
describes for `UsersManager` — icon plus visible label plus button chrome plus translated
`title`/`aria-label` — is the reference for every other icon action REQ-6 touches.

## Order of Work

One service, so the ordering is by blast radius rather than by contract: the token step changes what
compiles everywhere, the vendored primitives propagate into screens that are not in anyone's file
list, and only then are the screens themselves worth looking at.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `web` | The `@theme` scale and the two `@apply` sites in `globals.css`. Until `--text-*` is closed, every later edit is a convention nothing enforces, and the build cannot tell a fixed file from an unfixed one. |
| 2 | `web` | The shared and vendored primitives — `ui/badge/Badge.tsx`, `ui/tabs/TabNav.tsx`, `form/input/InputField.tsx`, `form/input/Radio.tsx`, `form/input/FileInput.tsx`, `form/MultiSelect.tsx`, `form/switch/Switch.tsx`, `ui/button/Button.tsx`. These render inside screens nobody will re-open, so fixing them last means fixing some screens twice. REQ-5 (no iOS focus zoom) is almost entirely discharged here. |
| 3 | `web` | The screens, grouped by the panel they share rather than by route: the downloads family, the series family, the search family, the media/card family, the settings and profile family, the users table, the header and sidebar, the calendar's `.fc` block. |
| 4 | `web` | The live pass — every route in REQ-11 at 375px and at 1280px, in both themes, against the acceptance criteria. |

**Nothing here runs in parallel.** Steps 2 and 3 look independent and are not: step 2 changes the
rendered size of components step 3 is measuring, so a step-3 screen audited before its primitives
settle is audited against the wrong page. Within step 3 the families are independent of each other
and may be split across tasks freely.

## Contract Freeze

`spec.md` § GraphQL Contract Delta reads **"None — this feature does not cross the service
boundary."** That is frozen as of `status: Approved`, and on this feature the freeze means something
unusual: it is a *ceiling*, not a handshake. There is no field to add and no error to handle.

What an implementer will be tempted to change, and must not:

- **A component that looks like it needs one more field to lay out well on a phone** — a shortened
  release name, a pre-formatted size string, a precomputed relative date. It does not get one. Every
  value on the screen is already in `web`'s hands; formatting it differently is `web`'s job. Asking
  `api` for a mobile-shaped payload is a contract change, and it is the wrong one — the same data
  would then have two shapes.
- **`extensions.i18n` and the error envelope.** REQ-1 covers error messages' *size*. Their text,
  their keys and `translateGraphQLError`'s fallback chain (`services/web/CLAUDE.md` § UI
  internationalization) are untouched. NFR-2 makes this checkable: the key count does not move.
- **The three-column header of `077`.** Out of Scope names it explicitly. Making it legible at 375px
  is this feature; changing which column holds what is not.

If a genuine need for an `api` field appears, the `web` agent stops and reports (`.claude/agents/web.md`
§ Scope). It does not add a second request to work around it.

## Migrations

None. No Prisma model, field or enum changes; `git status --short services/api/prisma` stays empty
(AC-9). Reversibility is `git revert` — this feature writes no state anywhere, so nothing outlives a
rollback.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A missed `text-xs` after `--text-*` is closed | **Silent, and benign by construction** — the utility emits nothing, the element inherits 16px from `body`. The text is compliant but the class is a lie, and the next reader trusts it. | AC-5's grep is the real gate, not the rendered page. It must return nothing across all of `services/web/src`, `.css` included. |
| A missed `text-sm` where the pass *intended* 14px | Silent and **not** benign in the other direction: the class emits nothing, the element jumps to 16px, and a badge or timestamp quietly gains two pixels nobody chose. | The 14px step keeps a name of its own in the scale rather than reusing `sm`. A deliberate accessory reads as the named token; an undeleted `text-sm` reads as an oversight. |
| `@apply` of a deleted utility in `globals.css` | **Loud** — the Tailwind build errors. Two known sites: `:244` (`@apply … text-xs`) and `:321` (`@apply !text-theme-xs`). | Step 1 fixes both. AC-7 runs the build; a third site nobody found surfaces there rather than in production. |
| Dead vendored CSS swept along | `globals.css:278-800` is TailAdmin override CSS for apexcharts, flatpickr, swiper and jsvectormap — libraries this app does not install. Deleting them is tempting under Article X and is **out of bounds**: `.claude/agents/web.md` says vendored scaffolding is not dead code. Only the `.fc` block is live (`@fullcalendar/*` is a real dependency, backing `/calendar`). | The plan touches `:321` and `:352` only because a deleted token forces it. Everything else in that range is left exactly as found. Any other edit there is a scope violation to report. |
| A table made legible, then illegible | Raising four columns to 16px inside a fixed-width `<table>` makes the columns wrap mid-word instead of overflowing, which reads worse than the sideways scroll it replaced. | REQ-8 permits the *panel* to scroll. The panel scrolling is the intended outcome for the four wide tables, not a fallback — do not fight it with `truncate`, which REQ-9 forbids on the identifying column. |
| Desktop density lost | NFR-3 is the requirement most likely to be quietly traded away, because the phone is what is being looked at. A reviewer at 1280px sees fewer rows and no error anywhere. | AC-10 is a side-by-side at 1280px on `/downloads`, `/users` and a series page, in both themes, against the pre-feature screen. Capture the "before" *first*. |
| `bin/npm web run build` run against a live dev stack | The build writes `.next/` in the bind-mounted working copy and un-hydrates every page of the running dev server. No error; the app just stops working until the dev server is restarted. | Bring the stack down (or accept a `bin/dev` restart afterwards) before AC-7. This is a standing property of this repo's bind mount, not something this feature introduced. |

## Verification

Article I: everything through `bin/`. There is no test runner in `services/web` and this feature does
not add one (`.claude/agents/web.md` § Tests) — the gate is the typecheck, Biome, the catalog check,
the build, and a real pass in a browser.

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/cli web node scripts/check-messages.mjs
grep -rEn "text-xs|text-theme-xs" services/web/src
git diff --stat services/api services/worker
git status --short services/api/prisma
```

The first must report 0 errors (AC-7), the second must pass, the third must report no `en`/`es`
drift at the same key count recorded for `077` in the root `CLAUDE.md` (AC-8, NFR-2), the fourth must
print **nothing** (AC-5), and the last two must be empty (AC-9).

Then, with the dev stack down:

```bash
bin/npm web run build
```

Expected: exit 0 (AC-7). Bring the stack back up with `bin/dev -d` afterwards — the build overwrote
`.next`.

**The manual pass.** Two viewports, two themes. At 375×812 and at 1280px, in light and dark, open
every route in REQ-11: `/`, `/search`, `/movies`, `/movies/add`, `/shows`, `/shows/add`, a film
detail page, a series detail page, `/calendar`, `/downloads`, `/preferences`, `/settings` and each of
its tabs, `/users`, `/login`, plus the modals — import file, import season files, remove title,
delete download, delete user, user create/edit, profile, the torrent search modal, and the language
change modal from `077`.

On each, with devtools open:

- `document.documentElement.scrollWidth === document.documentElement.clientWidth` at 375px (AC-1).
- Nothing on the page computes below 14px, and nothing a user reads computes below 16px. The quick
  version is a one-liner in the console over `document.querySelectorAll('*')` reading
  `getComputedStyle(el).fontSize` — record the minimum found per route (AC-2, AC-3).
- Every button, icon button, switch, radio, checkbox, tab and dropdown row reports a bounding box of
  at least 44×44, with a visible gap to its neighbour (AC-2, AC-4, REQ-7).
- The season header's three buttons still do what they did — search opens the torrent modal, magnet
  opens the magnet dialog, import opens the season upload — and none of them toggles the accordion
  (AC-4). This is the one place where growing a hit area can change behaviour, because the enlarged
  target now overlaps the accordion's own click handler.
- At 1280px, `/downloads`, `/users` and a series page show the same columns and the same rows per
  screen as before (AC-10).

AC-6 needs a real iOS Safari, which this stack cannot provide. Discharge REQ-5 structurally instead
— verify in devtools that every `<input>`, `<textarea>` and `<select>` computes to ≥16px — and record
AC-6 as unverified on a physical device rather than claiming it.

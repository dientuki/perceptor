---
title: Title Detail Three-Column Layout — Tasks
last_updated: 2026-09-26
status: In Progress
---

# TASKS: Title Detail Three-Column Layout (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

This feature is `services: [web]` — there is no contract group, because `spec.md` § GraphQL
Contract Delta is **None**. The usual "schema first, consumers second" shape is replaced by
"shared pieces first, the two detail components second": `Movie.tsx` and `Show.tsx` both consume
the helper and the panel, so those must exist before either is rewritten, or each grows its own
copy.

**`api` and `worker` have no tasks here and must not be touched.** An agent that believes it needs
a GraphQL field stops and reports (see `plan.md` § Contract Freeze — the tempting
`effectiveAudioLanguages` field is out of bounds).

## Tasks

### Group 1 — shared pieces

- [x] **T001** `[web] [P]` Add `services/web/src/lib/effective-languages.ts`: the per-category
      merge extracted verbatim in behaviour from the inline `const`s at the top of
      `src/components/movies/Movie.tsx`. Audio languages and the `audioMandatory` flag fall back
      together on the title's audio being empty; subtitles fall back independently on their own
      emptiness. Returns the resolved values plus a separate inherited flag per category. A `null`
      preferences argument yields the title's own values with both flags `false`.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors, and the file exports two
      independent inherited flags — not one shared flag (see `plan.md` § Risks: collapsing them is
      wrong only for a title with its own audio and no subtitles, which no typecheck can catch).
- [x] **T002** `[web] [P]` Give `src/components/media/TitleLanguagesForm.tsx` an `onSaved`
      callback, fired only in the branch where all three actions resolved with no error. Keep the
      per-action revert-to-props on a refusal and keep rendering refusal messages in place. Remove
      the form's own `saved` success line, now redundant with the modal closing.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and the submit handler has
      exactly one call site for `onSaved`, inside the no-errors branch.
- [x] **T003** `[web]` Add `src/components/media/TitleLanguagesModal.tsx`: the existing
      `Modal`/`useModal` pair hosting `TitleLanguagesForm`, modelled on
      `src/components/media/RemoveTitleModal.tsx`. Closes on the form's `onSaved`; does nothing on
      a refusal so the message stays visible. Do not lift the form's selection state into the
      modal — `Modal` returning `null` when closed is what discards a dismissed selection. → T002
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and the file declares
      exactly one renderable export (`services/web/CLAUDE.md` § One renderable component per file).
- [x] **T004** `[web]` Add `src/components/media/TitleLanguagesPanel.tsx`: read-only audio
      languages, mandatory flag and subtitle languages, each category marked when inherited and
      each showing an explicit empty-state string when neither the title nor `/preferences`
      supplies one. Owns `useModal`, mounts `TitleLanguagesModal`, and calls `router.refresh()` on
      a reported save. Language names render through `Intl.DisplayNames`, never from the catalog.
      → T001, T003
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and
      `grep -rn "DisplayNames" src/components/media/TitleLanguagesPanel.tsx` matches — no language
      name was added to `messages/*.json`.

### Group 2 — the two detail components

Everything here depends on Group 1: the helper and the panel must exist before either detail
component is rewritten.

- [x] **T005** `[web]` Thread preferences into both detail pages and both components. In
      `src/app/(dashboard)/movies/[id]/page.tsx` and `src/app/(dashboard)/shows/[id]/page.tsx`,
      add `getPreferences()` to the **existing** `Promise.all` (not a second sequential `await`),
      wrapped so a rejection yields `null` — the catch's **first statement** is
      `unstable_rethrow(error)` from `next/navigation`. Accept it as a prop on `Movie.tsx` and
      `Show.tsx`; delete `Movie.tsx`'s `useEffect`/`useState` preferences fetch; replace its inline
      merge with the T001 helper and feed `RankingDebugPanel` from the helper's result with its
      props and its production gate unchanged. → T001
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors,
      `grep -n "useEffect" src/components/movies/Movie.tsx` no longer matches the preferences
      fetch, and reading the diff confirms `unstable_rethrow` is the first statement in each catch
      — a bare `.catch(() => null)` strands an expired session on a permanently unmarked panel with
      no error anywhere, and no command in this list detects it.
- [x] **T006** `[web]` Replace the standing `TitleLanguagesForm` in both `Movie.tsx` and
      `Show.tsx` with `TitleLanguagesPanel`, passing the helper's result and the existing
      audio/subtitle/mandatory actions each component already binds. → T004, T005
      *Done when:* `grep -rn "TitleLanguagesForm" src/components/movies src/components/shows`
      returns nothing, `bin/npm web run build` exits 0, and `/movies/<id>` shows the read-only
      panel with a button in place of the two pickers.
- [x] **T007** `[web]` Relay out both headers onto the three-column grid, in one pass over both
      files so they cannot drift. Left: poster only. Centre: the title heading with year, original
      language and `StatusBadge`; then on a film the file and magnet buttons; then the synopsis —
      on a series the centre column has no acquisition buttons. Right: `RefreshTitleButton` and
      `RemoveTitleButton`; then on a film with shorts enabled the short `Switch` (keeping its
      `shortSwitchKey` remount-on-refusal); then `ContentKindSelect`; then `TitleLanguagesPanel`.
      Below the breakpoint the three stack in that source order with no horizontal scroll. Every
      full-width row below the header — `DownloadsPanel`, `SearchTorrent`, `SeasonAccordion` —
      keeps its current position and content. → T006
      *Done when:* `bin/npm web run build` exits 0, and at desktop width `/movies/<id>` renders
      three columns and `/shows/<id>` renders the same three with an empty acquisition row and no
      short switch.
- [x] **T008** `[web]` Add the panel and modal copy to `messages/en.json` and `messages/es.json`
      under the existing `media.*` namespace, `es` in the Rioplatense register. No language names,
      no new error keys — this feature introduces neither. → T004, T007
      *Done when:* `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift and no
      raw key path (`media.…`) is visible anywhere on either detail page in either locale.

### Group 3 — verification and docs

- [x] **T009** `[web]` Run the full battery from `web/plan.md` § Done when and report each result
      verbatim. → T008
      *Done when:* `bin/cli web npx --no tsc --noEmit` 0 errors, `bin/npm web run lint` clean,
      `bin/npm web run build` exits 0, `bin/cli web node scripts/check-messages.mjs` no drift, and
      `git diff --stat services/api services/worker` prints nothing (AC-11, AC-12).
- [x] **T010** `[docs]` Update `services/web/CLAUDE.md` § "Detail pages are scoped, with a
      route-segment 404" for the three-column header, the new `TitleLanguagesPanel`/
      `TitleLanguagesModal` pair and the page-level `getPreferences()` fetch; note in
      `src/lib/`'s territory that `effective-languages.ts` is the one authority for the merge in
      `web`. Update the root `CLAUDE.md`'s "Browse library" row and remeasure its "Current state"
      paragraph. No pipeline stage changed status — do not imply one did. → T009
      *Done when:* both files describe the three-column layout, and a reader looking for where the
      audio/subtitle preference of a title is edited is sent to the modal, not to a standing form.
- [ ] **T011** `[docs]` Walk the twelve acceptance criteria in `spec.md` against a running stack
      (`bin/dev`), following `plan.md` § Verification's nine-step manual pass. AC-5 and AC-6 must
      be run against **one** title that has its own audio and no subtitles of its own — two
      different titles will not catch a collapsed inherited flag. AC-7 is the failure path
      (`docker compose stop api`, save in the modal, confirm the message appears in the still-open
      modal and nothing was stored). Tick each box, record which criteria were not run live and
      why, then set `status: Implemented` on `spec.md`, `plan.md` and `web/plan.md`. → T010
      *Done when:* every AC box in `spec.md` is either ticked or annotated with why it was not
      run, and all three files read `status: Implemented`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

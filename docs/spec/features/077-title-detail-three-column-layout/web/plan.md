---
title: Title Detail Three-Column Layout — web slice
service: web
last_updated: 2026-09-26
status: Approved
---

# PLAN: Title Detail Three-Column Layout — `web` (`web/plan.md`)

## Scope

`web` owns the whole feature. Read `../spec.md` and `../plan.md` first.

This slice relays out the film/short and series detail headers into three columns, extracts the
effective-language merge into a shared helper, and replaces the standing `TitleLanguagesForm` with
a read-only panel plus a modal that hosts the existing form.

It is explicitly **not** doing anything on `api` or `worker`. There is no GraphQL change, no new
query, no new field, no new error key: every value the panel renders is already returned by
`getMovieById`, `getShowById` and `getPreferences`, and the two mutations behind the modal are the
ones the inline form already calls. `git diff --stat services/api services/worker` must be empty
when this slice is done — if it looks like `api` needs a change, stop and report rather than
adding one (`../plan.md` § Contract Freeze explains why the tempting `effectiveAudioLanguages`
field is out of bounds).

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/lib/effective-languages.ts` | New | Pure helper: merges a title's own audio/subtitle languages with the caller's `/preferences`, per category, and reports which of the two each came from |
| `services/web/src/components/media/TitleLanguagesPanel.tsx` | New | Read-only summary of the effective audio/subtitle languages and the mandatory flag, with the button that opens the modal; owns the modal's open state |
| `services/web/src/components/media/TitleLanguagesModal.tsx` | New | `Modal` shell hosting `TitleLanguagesForm`; closes on a reported success, stays open on a refusal |
| `services/web/src/components/media/TitleLanguagesForm.tsx` | Modified | Gains an `onSaved` callback fired only when all three actions resolve without an error; loses its own standing-form framing. Submit logic, revert-on-refusal and the three-action `Promise.all` are unchanged |
| `services/web/src/components/movies/Movie.tsx` | Modified | Three-column grid; the `useEffect` preferences fetch is deleted in favour of a prop; the inline merge is replaced by the helper; `TitleLanguagesForm` is replaced by `TitleLanguagesPanel` |
| `services/web/src/components/shows/Show.tsx` | Modified | The same three-column grid, with no acquisition buttons and no short switch; takes the same preferences prop and mounts the same panel |
| `services/web/src/app/(dashboard)/movies/[id]/page.tsx` | Modified | Joins `getPreferences()` into the existing `Promise.all` and passes it down |
| `services/web/src/app/(dashboard)/shows/[id]/page.tsx` | Modified | Same |
| `services/web/messages/en.json` | Modified | Panel and modal copy |
| `services/web/messages/es.json` | Modified | Same, Rioplatense register |

## Existing code to reuse

- `src/components/ui/modal/index.tsx` + `src/hooks/useModal.ts` — the project's only modal pair.
  `RemoveTitleModal.tsx` is the closest model for the new modal: `Modal` with a
  `max-w-[…] m-4` class, a rounded inner panel, an error paragraph above the body, and a
  cancel/confirm footer. Do not hand-roll a dialog.
  **`Modal` returns `null` when closed** — this is what satisfies REQ-12 for free: the form
  unmounts and its state initialisers re-read the props on reopen. Do not lift the form's
  selection state up into the panel to avoid the remount.
- `src/components/media/TitleLanguagesForm.tsx` — the form is kept, not rewritten. Its
  revert-to-props on a per-action refusal and its `Promise.all` over the three actions are the
  behaviour REQ-11 depends on.
- `src/components/preferences/LanguagePickerField.tsx` — already inside the form; untouched.
  Language *names* are rendered through `Intl.DisplayNames`, never from the message catalog
  (`services/web/CLAUDE.md` § UI internationalization). **The read-only panel must render its
  language names the same way** — do not add language names to `en.json`/`es.json`.
- `src/components/media/RankingDebugPanel.tsx` — keeps its exact props and its
  `process.env.NODE_ENV === "production"` gate. It is now fed from the helper rather than from
  inline locals in `Movie.tsx`; nothing it renders changes.
- `src/actions/preferences.ts`'s `getPreferences()` — already ends in `redirectToClearSession`,
  so it is legal from a Server Component render pass. `src/app/(dashboard)/preferences/page.tsx`
  already calls it exactly that way; copy that, not `Movie.tsx`'s `useEffect`.
- `unstable_rethrow` from `next/navigation` — the pattern is in `src/app/(dashboard)/page.tsx`
  (the billboard's `Promise.allSettled`). Same reason applies here.
- `src/components/status/StatusBadge.tsx`, `src/components/media/RefreshTitleButton.tsx`,
  `RemoveTitleButton.tsx`, `ContentKindSelect.tsx`, `src/components/form/switch/Switch.tsx`,
  `src/components/import/importFileModal.tsx`, `importMagnetModal.tsx` — all moved, none changed.
  In particular the short `Switch` keeps its `shortSwitchKey` remount-on-refusal trick and
  `ContentKindSelect` keeps not having one; the reasons are in `services/web/CLAUDE.md`.
- `src/components/ui/button/Button.tsx` — the change button is this, not a hand-rolled element.
  There is no `primary` Tailwind token in this service.

## Steps

1. **Add `src/lib/effective-languages.ts`.** Move the merge out of `Movie.tsx` verbatim in
   behaviour: a title with no audio languages of its own falls back to the caller's preferences
   for both its audio languages *and* its `audioMandatory` flag; subtitles fall back independently
   on their own emptiness. Return the resolved audio languages, the resolved mandatory flag, the
   resolved subtitle languages, and a separate inherited flag per category. A `null` preferences
   argument must yield the title's own values with both flags false — never a crash and never a
   false "inherited".
2. **Give `TitleLanguagesForm` an `onSaved` callback.** Fire it only in the branch where all three
   actions resolved with no error. Keep the per-action revert on refusal and keep rendering the
   refusal messages in place. The form's internal `saved` success line is now redundant with the
   modal closing — remove it rather than leaving both.
3. **Add `TitleLanguagesModal.tsx`.** `Modal` + the form + a dismiss control, modelled on
   `RemoveTitleModal.tsx`. Close on the form's `onSaved`; do nothing on a refusal so the message
   stays visible (REQ-11).
4. **Add `TitleLanguagesPanel.tsx`.** Takes the helper's result plus the three actions. Renders
   the audio languages, the mandatory flag and the subtitle languages read-only, each category
   marked when inherited (REQ-7) and each falling back to an explicit empty-state string when
   neither source supplies one (REQ-8). Owns `useModal` and mounts the modal. On `onSaved`, call
   `router.refresh()` so the panel re-reads from the server (REQ-10) — the same refresh shape
   `RefreshTitleButton` uses.
5. **Thread preferences through both pages.** In `movies/[id]/page.tsx` and `shows/[id]/page.tsx`,
   add `getPreferences()` to the existing `Promise.all`, wrapped so a rejection yields `null`:
   the catch calls `unstable_rethrow(error)` **first**, before returning `null`. Pass the result
   to `Movie`/`Show`. Do not add a second sequential `await`.
6. **Relay out `Movie.tsx`.** Three columns at the wide breakpoint: poster; heading + file/magnet
   + synopsis; Refresh/Remove + short switch + `ContentKindSelect` + `TitleLanguagesPanel`. Delete
   the `useEffect`/`useState` preferences fetch and read the new prop. Replace the inline merge
   with the helper and feed `RankingDebugPanel` from it. Below the breakpoint the three stack in
   source order (NFR-3).
7. **Relay out `Show.tsx`.** The same grid, same column contents minus the acquisition buttons
   (REQ-4) and minus the short switch (a series has none). It stays a Server Component; the panel
   and modal are the client boundary, as `ContentKindSelect` already is.
8. **Catalogs.** Add the panel and modal keys to both `messages/en.json` and `messages/es.json`
   under the existing `media.*` namespace the other shared media components use. No language
   names, no error keys — this feature introduces neither.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **None — this feature does not cross the service
boundary**, and it is read-only.

The error conditions this slice must still handle are the ones it already handles, unchanged, now
surfaced inside the modal instead of inline: a refusal from
`setMoviePreferredTrackLanguages`/`setShowPreferredTrackLanguages` or from
`setMovieAudioMandatory`/`setShowAudioMandatory` arrives as `{ error }` from the server action,
already translated through `translateGraphQLError`. Render it; never render a raw key and never
match on message text. A failure of any one of the three reverts that one control to its stored
value and leaves the modal open.

`getPreferences()` rejecting is not one of those: it is handled at the page, yields `null`, and
degrades the panel to the title's own values with nothing marked inherited.

If any of this turns out to require an `api` change, stop and report.

## Tests

`services/web` has no test runner — no Jest, no Vitest, by standing decision
(`services/web/CLAUDE.md`). Nothing in this slice is owed a unit test, and none can be added
without introducing a runner, which is out of scope.

That said, two things in this slice *can* fail silently, and both are covered by an acceptance
criterion instead, which is where the proof has to live:

- The `unstable_rethrow` in step 5's catch. A missing one turns an expired session into a
  permanently unmarked panel with no error anywhere. Not reachable from the AC list directly —
  **verify it by reading the diff**: the catch's first statement must be `unstable_rethrow(error)`.
- The per-category inherited flags. Collapsing them into one flag produces a panel that is wrong
  only for a title that has audio of its own but no subtitles — AC-5 and AC-6 together are what
  catch it, and they must be run against a title in exactly that state, not two different titles.

`src/lib/effective-languages.ts` is the one pure, testable unit here. It is not owed a test under
Article IX today only because this service cannot run one; if a runner ever lands, it is the first
file in `web` that should get one.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
git diff --stat services/api services/worker
```

Typecheck 0 errors, lint clean, build exits 0, `check-messages` reports no `en`/`es` drift, and the
last command prints nothing.

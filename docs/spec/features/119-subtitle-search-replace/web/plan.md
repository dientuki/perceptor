---
title: Subtitle Search and Replace — web slice
service: web
last_updated: 2026-11-15
status: Implemented
---

# PLAN: Subtitle Search and Replace — `web` (`web/plan.md`)

## Scope

`web` turns the manual search dialog into "Buscar y reemplazar subtítulos" with one unticked
checkbox per wanted language already in the file, sends the ticked ones, renders the new `REPLACED`
outcome and translates the two new error keys. It decides nothing about which tracks go: `api` and
the worker do.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/components/media/SearchSubtitlesButton.tsx` | Modified | New prop `replaceableLanguages: string[]`; checkbox list, reset on each open; `onSearch(replaceLanguages)` |
| `src/components/movies/Movie.tsx` | Modified | Pass the replaceable languages |
| `src/app/(dashboard)/shows/[id]/page.tsx` | Modified | Compute `effectiveLanguages(show, preferences).subtitleLanguages` (both already loaded on the page) and pass it to every `SeasonAccordion` |
| `src/components/shows/SeasonAccordion.tsx` | Modified | New prop `subtitleLanguages: Language[]` (it receives only `audioLanguages` today); derive each episode's replaceable languages from it |
| `src/actions/movies.ts`, `src/actions/shows.ts` | Modified | Optional `replaceLanguages` variable on both mutations |
| `src/types/media.ts` | Modified | `REPLACED` in `SubtitleSearchLanguageOutcome` |
| `messages/es.json`, `messages/en.json` | Modified | Dialog title, section label and hint, outcome `REPLACED`, two error keys |

## Existing code to reuse

- `SearchSubtitlesButton`'s modal, error rendering and `translateErrorKey` — extend, do not add a
  second dialog.
- The checkbox component already used in `PreferencesForm.tsx` (`@/components/form/input/Checkbox`), not a
  raw `<input>`.
- The language label helper used by the audio/subtitle chips (`108`) to name each checkbox.

## Steps

1. Replaceable languages = the title's `fileSubtitleLanguages` that are also in the caller's
   effective subtitle languages, lower-cased, in the order of the effective list. The effective
   list is `Language[]`: map to `iso3` and dedupe (`es-419` and `es-ES` are both `spa`). On the
   film page it is `effective.subtitleLanguages` (`Movie.tsx` already computes it). On an episode
   the accordion has no subtitle list today: the show page computes
   `effectiveLanguages(show, preferences).subtitleLanguages` and passes it down as a new prop.
   This is the same rule `api`'s `effectiveLanguages` applies (per-title list, else the global
   one), so an offered box is always wanted. `null` file languages → none.
2. Dialog: title `media.searchSubtitles.title` gets the new copy; when the list is non-empty, a
   section with the label, the hint and one checkbox per language, all unticked on every open.
3. The bound actions take `(id, replaceLanguages: string[])`; send the variable only when non-empty.
4. `REPLACED` → `Reemplazado` wherever outcomes are rendered.
5. Errors: both keys through the existing translator.

## Contract obligations

Sends `replaceLanguages: [String!]` as lower-case ISO 3. Handles, beyond the existing `106` errors,
`error.subtitleSearch.replace_language_not_wanted` and
`error.subtitleSearch.replace_language_not_present` as an inline dialog error (they can only come
from a stale page). Renders `REPLACED`. The delta is read-only; if it is wrong, stop and report.

## Tests

`web` has no test runner; Article IX's silent failure here would be a ticked box that is not sent,
which the manual pass (AC-3) catches. The derivation of replaceable languages is a few lines in the
component and is not owed a unit test.

## Done when

```bash
bin/cli web npx --no tsc --noEmit        # 0 errors
bin/npm web run lint                      # clean
bin/comments web                          # PASS
```

and the dialog renders as AC-1/AC-2 describe in the dev stack.

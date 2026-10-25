---
title: Subtitle Search — web slice
service: web
last_updated: 2026-10-25
status: Approved
---

# PLAN: Subtitle Search — `web` (`web/plan.md`)

## Scope

`web` adds:

- the `/preferences` checkbox, disabled with a hint when `subtitleSearchAvailable` is false;
- the per-title "¿Buscar subtítulos en internet?" checkbox under the subtitle picker of
  `TitleLanguagesForm`, shown only when both the capability and the user's preference are on;
- the last search's outcome: in the film's audio/subtitle panel, and per episode on the series page.

It does **not** decide whether a search runs, read Jellyfin, or show candidates. There is no "search
now" button (see the spec's Out of Scope).

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/media.ts` | Modified | `MediaCapabilities.subtitleSearchAvailable`; `SubtitleSearch`, `SubtitleSearchLanguage` and the two enums, typed by hand from `../spec.md` |
| `src/actions/media.ts` | Modified | Select `subtitleSearchAvailable` in `getMediaCapabilities` |
| `src/actions/preferences.ts` | Modified | Select `subtitleSearch`; `setSubtitleSearchAction(enabled)` |
| `src/actions/languages.ts` | Modified | `setMovieSubtitleSearchAction` and `setShowSubtitleSearchAction`, twins of the `*AudioMandatoryAction` pair |
| `src/actions/movies.ts`, `src/actions/shows.ts` | Modified | Select `subtitleSearch` and `latestSubtitleSearch` (film), and `subtitleSearch` plus each episode's `latestSubtitleSearch` (series) |
| `src/components/preferences/PreferencesForm.tsx` | Modified | Checkbox under the subtitle picker in the download-languages tab, saved with the rest |
| `src/components/media/TitleLanguagesForm.tsx` | Modified | Optional checkbox under the subtitle picker, saved with the rest |
| `src/components/media/TitleLanguagesPanel.tsx` | Modified | Show the flag and the last search's outcome |
| `src/components/media/SubtitleSearchStatus.tsx` | New | Renders one `SubtitleSearch` (status plus one line per language), used by the panel and the episode row |
| `src/components/movies/Movie.tsx`, `src/components/shows/Show.tsx` | Modified | Bind and pass the new action and visibility |
| `src/components/shows/SeasonAccordion.tsx` | Modified | `SubtitleSearchStatus` on an episode row that has a search |
| `src/app/(dashboard)/shows/[id]/page.tsx` | Modified | Also fetch `getMediaCapabilities()` (the film page already does) |
| `messages/en.json`, `messages/es.json` | Modified | Labels, hint, statuses, outcomes and every `error.subtitleSearch.*` key |

## Existing code to reuse

- `TitleLanguagesForm`'s audio-mandatory checkbox: the same `Checkbox` component, the same
  `Promise.all` save with per-action error collection, and the same revert on error. The new
  checkbox is a fourth action in that `Promise.all`, never a second Save button.
- `PreferencesForm`'s `setAudioMandatoryAction` line in the save `Promise.all`, and its
  `Checkbox` under the audio picker. Mirror both under the subtitle picker.
- `actions/languages.ts` `setMovieAudioMandatoryAction`/`setShowAudioMandatoryAction`: the action
  shape and the `fetchGraphQL` error translation. Copy for the subtitle-search pair.
- `components/media/EmbedSubtitlesButton.tsx`: how `101` shows an embed's status and its i18n key.
  `SubtitleSearchStatus` uses the same tone and status-pill components (`lib/status-tone.ts`), and
  does not invent a new badge.
- `lib/format.ts`: the `096` date formatting for `finishedAt`.
- `getMediaCapabilities` (already called on `/preferences` and the film page).

## Steps

1. Types and actions, matching `../spec.md` exactly.
2. `/preferences`: the checkbox, disabled with the hint
   (`preferences.subtitleSearchRequiresJellyfin`) when `!capabilities.subtitleSearchAvailable`, and
   saved by the existing button.
3. `TitleLanguagesForm`: new optional props `subtitleSearch?: boolean` and
   `setSubtitleSearchAction?`. Render the checkbox only when both are given. `Movie.tsx`/`Show.tsx`
   pass them only when `capabilities.subtitleSearchAvailable && preferences.subtitleSearch`.
4. `SubtitleSearchStatus`, plus its use in `TitleLanguagesPanel` (film) and in `SeasonAccordion`'s
   episode rows. Show nothing when `latestSubtitleSearch` is null.
5. Messages, in both locales. `es` uses the existing Rioplatense register.

## Contract obligations

The slice consumes `../spec.md` § GraphQL Contract Delta (v0.2.0). Error handling:

- **`error.subtitleSearch.unsupported_media_server`** on any of the three setters: show the
  translated message in the form's existing error list and revert that checkbox, as the form already
  does for its other actions.
- **The existing not-found keys** on the title setters: same treatment.
- **Outcome keys** (`errorKey`, `reasonKey`, including the reused `error.subtitleEmbed.busy`): each
  is rendered through the catalog. An unknown key falls back to the generic error message, never to
  the raw key.

`Movie.subtitleSearch`/`Show.subtitleSearch` are the caller's own flags. Never show another owner's.

## Tests

Nothing in this slice fails silently in a way a unit test would catch better than the manual pass.
The rule that matters, "the checkbox is hidden unless both gates are on", is one conditional in
`Movie.tsx`/`Show.tsx`, verified by AC-1/AC-1b. Failed saves are already surfaced by the form's
existing error list. No new test file; lint and typecheck are the gate.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/comments web
```

Typecheck and lint are clean. Every new key exists in both `en.json` and `es.json`. Never run
`bin/npm web run build` while the dev stack is up (memory: web-build-clobbers-dev-next).

## Amendment 0.4.0 (2026-10-25)

See `../spec.md` § Amendments (2026-10-25, `spec_version` 0.4.0) and `../tasks.md` Group 5.

- One new outcome key, `error.subtitleSearch.incomplete`, in both catalogs. Nothing else changes.

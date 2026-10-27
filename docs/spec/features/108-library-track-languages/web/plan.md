---
title: Library Track Languages — web slice
service: web
last_updated: 2026-10-27
status: Approved
---

# PLAN: Library Track Languages — `web` (`web/plan.md`)

## Scope

`web` shows a library file's languages: two informational boxes under a film's poster, and a new
column in a season's episode table holding the same two lines plus `106`'s "Buscar subtítulos"
button, moved there. It reads the two new nullable fields and nothing else. It does **not** trigger a
read, show a read's failure, or change `106`'s button behaviour or visibility.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/actions/movies.ts` | Modified | `GET_MOVIE_QUERY` selects `fileAudioLanguages`, `fileSubtitleLanguages`; the type gains them |
| `src/actions/shows.ts` | Modified | the episode selection gains the same two fields; the `Episode` type too |
| `src/components/media/FileTrackLanguages.tsx` | New | the two lines, in a `boxes` (film) and a `compact` (episode) variant |
| `src/components/movies/Movie.tsx` | Modified | the boxes under the poster |
| `src/components/shows/SeasonAccordion.tsx` | Modified | the new column; `SearchSubtitlesButton` moves into it |
| `messages/es.json`, `messages/en.json` | Modified | the column header and the two accessible labels |

## Existing code to reuse

- `src/layout/AppHeader.tsx`'s search input: the border, radius, height and background classes the
  boxes copy (spec REQ-6: "the same shape and border as the header search box"). Copy the class
  string; do not extract a shared component from the header for this.
- `lucide-react` (already a dependency): `Music2` (a single eighth note) for audio and `Captions` for
  subtitles. If the installed version lacks either name, use the closest one it has and say which in
  the report.
- The existing chip style used for languages in `src/components/media/TitleLanguagesPanel.tsx`, so a
  chip here looks like a language chip elsewhere on the same page.
- `SearchSubtitlesButton` (`106`) as it is, with the props it already receives in
  `SeasonAccordion.tsx`; only its position changes.

## Steps

1. **Queries and types.** Add the two fields to the film query and to the episode selection in the
   show query; type them `string[] | null`.
2. **`FileTrackLanguages`.** Props: `audio: string[] | null`, `subtitles: string[] | null`,
   `variant: 'boxes' | 'compact'`. Renders nothing when both are `null`. Each line is the icon
   followed by one chip per code, upper-cased (`SPA`); an empty list renders a single muted `—`.
   The icons carry `aria-label`s from the catalog (`Audio`, `Subtítulos`). `boxes` renders each line
   inside a box styled as above; `compact` renders the lines smaller, without the box.
3. **Film page.** In `Movie.tsx`'s first grid column, under the poster (or its placeholder), render
   `variant="boxes"` with the film's two fields.
4. **Episode column.** In `SeasonAccordion.tsx`, add one `<th>` (catalog header, e.g. `Pistas`) and one
   `<td>` per episode holding three rows: `compact` audio, `compact` subtitles, and the
   `SearchSubtitlesButton` with exactly the condition it has today. Remove the button from its current
   cell. An episode never read shows only the button row; a cell with nothing to show is empty.
5. **Copy.** `es`/`en`: the column header and the two labels. `check-messages` must stay green.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta:

- `Movie.fileAudioLanguages`, `Movie.fileSubtitleLanguages`, `Episode.fileAudioLanguages`,
  `Episode.fileSubtitleLanguages`: `[String!]`, nullable. `null` hides the line (and both `null`
  hides the whole block); `[]` shows `—`. Do not confuse them with `Movie.audioLanguages` /
  `subtitleLanguages`, which are the caller's language preferences (`039`) and stay untouched.
- No new error: both fields are plain reads on queries `web` already makes and already handles
  failing.

## Tests

`web` has no test runner. Nothing here fails silently: a wrong field name fails the page query
visibly, and a `null`/`[]` mix-up is visible on the first film (AC-1, AC-7). Verification is the
typecheck, `check-messages` and the manual pass in `../plan.md`.

## Done when

```bash
bin/cli web npx --no tsc --noEmit        # no new errors (Calendar.tsx's 7 are pre-existing)
bin/cli web node scripts/check-messages.mjs
bin/comments web
```

Then, live: a delivered film shows both boxes; a season shows the new column with the button moved
into it (AC-1, AC-6).

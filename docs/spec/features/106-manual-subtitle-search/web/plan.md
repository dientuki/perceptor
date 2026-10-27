---
title: Manual Subtitle Search — web slice
service: web
last_updated: 2026-10-26
status: Implemented
---

# PLAN: Manual Subtitle Search — `web` (`web/plan.md`)

## Scope

`web` adds the "Buscar subtítulos" button (spec REQ-9) to:
- a film's audio/subtitle panel;
- each episode row of the series page.

The button carries a confirmation dialog that mentions the provider's daily quota, and calls the two
new mutations through server actions. On success the panel shows the new search; on a refusal the
dialog shows the translated error.

It does not decide eligibility beyond hiding the button where it cannot work: `api` enforces every
refusal. No `/preferences` change.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/media/SearchSubtitlesButton.tsx` | New | button, confirmation modal, error display, refresh |
| `services/web/src/actions/movies.ts` | Modified | `searchMovieSubtitlesAction(movieId)` |
| `services/web/src/actions/shows.ts` | Modified | `searchEpisodeSubtitlesAction(episodeId)` |
| `services/web/src/components/media/TitleLanguagesPanel.tsx` | Modified | renders the button for a film beside `SubtitleSearchStatus` |
| `services/web/src/components/movies/Movie.tsx` | Modified | passes the capability, status and action down |
| `services/web/src/components/shows/SeasonAccordion.tsx` | Modified | the button on each episode row |
| `services/web/src/app/(dashboard)/shows/[id]/page.tsx` | Modified, if needed | fetch `getMediaCapabilities()` for the series page, as the film page already does |
| `services/web/src/types/media.ts` | Modified, if needed | the action's result type |
| `services/web/messages/en.json`, `services/web/messages/es.json` | Modified | `media.searchSubtitles.*` copy; `errors.subtitleSearch.in_progress` and `no_languages` |

## Existing code to reuse

- `components/media/EmbedSubtitlesButton.tsx` (`101`): the pattern to follow almost line for line:
  - `useModal`, the `Button` and `Modal` components;
  - `translateErrorKey` with the `errors` translator;
  - `router.refresh()` after success;
  - an in-flight state that disables the button;
  - `compact`/`fullWidth` props so it fits both the panel and an episode row.
- `embedMovieSubtitlesAction` / `embedEpisodeSubtitlesAction` in `actions/movies.ts` /
  `actions/shows.ts`: the server-action shape, through `fetchGraphQL`, returning a typed result
  carrying `errorKey` instead of throwing.
- `components/media/SubtitleSearchStatus.tsx`: already renders `latestSubtitleSearch`. The button sits
  next to it and does not replace it.
- `getMediaCapabilities()` (`actions/media.ts`): already returns `subtitleSearchAvailable`, and the
  film page already fetches it.

## Steps

1. **Catalog.**
   - `errors.subtitleSearch.in_progress`: `Ya hay una búsqueda de subtítulos en curso para este
     título.` / English equivalent.
   - `errors.subtitleSearch.no_languages`: `No hay idiomas de subtítulos elegidos para este
     título.` / English equivalent.
   - A `media.searchSubtitles` group: the button label `Buscar subtítulos`, the dialog title and body
     (it states that the search uses the subtitle provider's daily download quota), confirm and
     cancel, and the disabled hint `Ya hay una búsqueda en curso`.

   The reused `error.subtitleEmbed.*` and `error.subtitleSearch.unsupported_media_server` keys
   already exist.
2. **Server actions.** `searchMovieSubtitlesAction(movieId)` and
   `searchEpisodeSubtitlesAction(episodeId)` run the mutations, selecting the same `SubtitleSearch`
   fields `latestSubtitleSearch` selects today. Each returns `{ search }` or `{ errorKey }`, as the
   embed actions do.
3. **`SearchSubtitlesButton`.** It receives `search` (the latest, may be null), `onSearch` (a bound
   action), `compact` and `fullWidth`.
   - It is disabled with the hint while `search.status` is `WAITING`, `SEARCHING`, `VALIDATING` or
     `EMBEDDING`.
   - A click opens the confirmation. Confirm calls `onSearch`:
     - on `{ search }`, close and `router.refresh()`;
     - on `{ errorKey }`, keep the dialog open with the translated message;
     - on `error.subtitleSearch.in_progress`, also `router.refresh()`, since the panel was stale.
4. **Film.** In `Movie.tsx`/`TitleLanguagesPanel.tsx`, render the button when
   `subtitleSearchAvailable && movie.status === 'COMPLETED'`, bound with
   `searchMovieSubtitlesAction.bind(null, movie.id)`.
5. **Episode.** In `SeasonAccordion.tsx`, render it per row (`compact`) under the same rule on
   `episode.status`, bound to the episode id. If the series page does not yet have the capability,
   fetch it in `shows/[id]/page.tsx` and pass it down as the film page does.

The visibility rule `status === 'COMPLETED'` stands in for spec REQ-9's "holds a file": `web` has no
possession field for an episode. A title that holds a file but reads `DOWNLOADING`/`ENCODING` is
exactly one `api` would refuse as `busy`. A `mediaServerPresentAt`-only title reads `COMPLETED` and
is included, as REQ-7 wants.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta:

- `searchMovieSubtitles(movieId: Int!): SubtitleSearch!` and
  `searchEpisodeSubtitles(episodeId: Int!): SubtitleSearch!`.
- Every refusal, shown in the dialog through the catalog, never as a raw string:

| Key | Copy |
| :-- | :-- |
| `error.subtitleSearch.unsupported_media_server` | `La búsqueda de subtítulos requiere Jellyfin como servidor de medios.` |
| `error.movie.not_found`, `error.episode.not_found` | existing copy |
| `error.subtitleEmbed.no_file` | `Este título no tiene un archivo en la biblioteca.` |
| `error.subtitleEmbed.not_mkv` | `Solo se pueden incrustar subtítulos en archivos MKV.` |
| `error.subtitleEmbed.outside_library` | existing copy |
| `error.subtitleEmbed.busy` | `Este título tiene una descarga, codificación o incrustación en curso.` |
| `error.subtitleSearch.in_progress` | new; also refreshes the page |
| `error.subtitleSearch.no_languages` | new |

- A search's `errorKey` may now be `error.subtitleEmbed.not_mkv` or `outside_library`.
  `SubtitleSearchStatus` already renders any key through `translateErrorKey`; confirm both resolve.

The delta is read-only. If it is wrong, stop and report.

## Tests

`web` has no test runner (`services/web/CLAUDE.md` § Tests). Nothing here is owed an automated test;
the gate is the typecheck, Biome and the manual pass in `../plan.md`. The one silent failure, a
refusal shown as the generic connection message, is covered by checking every key in the table
above in both catalogs during the manual pass.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/comments web
```

All three pass, and the manual pass in `../plan.md` shows the button, the dialog and each refusal
message in Spanish and English.

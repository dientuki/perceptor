---
title: Subtitle Upload — web slice
service: web
last_updated: 2026-11-24
status: Approved
---

# PLAN: Subtitle Upload — `web` (`web/plan.md`)

## Scope

`web` adds the icon-only upload button beside "Buscar subtítulos" on a film and on each episode,
the upload dialog (file picking, file-name language preset, per-row choices), two server actions
calling `uploadMovieSubtitles`/`uploadEpisodeSubtitles`, the catalog strings, and a server-action
body limit large enough for the request. It also moves the display of the latest embed's outcome
(in flight, failure, warning) out of the admin-only `EmbedSubtitlesButton`, so every owner sees it
(spec REQ-15).

What `web` does **not** do: charset handling, SRT validation beyond the extension/size/count
pre-checks, staging, or anything about the remux. `api` owns all of that. `web` sends the file's raw
bytes, base64-encoded, and never decodes them as text.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/components/media/UploadSubtitlesButton.tsx` | New | Icon-only button (`lucide-react` `Upload`), tooltip/`aria-label` "Subir subtítulos", disabled while busy (REQ-3), opens the modal. |
| `src/components/media/UploadSubtitlesModal.tsx` | New | File input (`accept=".srt"`, `multiple`), "add more", one row per file, confirm. |
| `src/components/media/SubtitleEmbedOutcome.tsx` | New | The in-flight label / failure / warning lines currently inside `EmbedSubtitlesButton`, extracted. |
| `src/components/media/subtitle-offset.ts` | New | `OFFSET_LIMIT` and `parseOffset`, moved out of `EmbedSubtitlesModal.tsx` so both modals share them. |
| `src/lib/subtitle-file-name.ts` | New | Pure `presetFromFileName(fileName, languages)` → `{ languageTag: string \| null, isForced: boolean }` (REQ-5). |
| `src/components/media/EmbedSubtitlesButton.tsx` | Modified | Drops its failure/warning lines (now `SubtitleEmbedOutcome`); keeps its own disabled in-flight state and stale message. |
| `src/components/media/EmbedSubtitlesModal.tsx` | Modified | Imports `parseOffset`/`OFFSET_LIMIT` from `subtitle-offset.ts`. |
| `src/components/movies/Movie.tsx` | Modified | Footer: a row of `SearchSubtitlesButton` (flex-1) + `UploadSubtitlesButton`, then `SubtitleEmbedOutcome`, then `EmbedSubtitlesButton`. |
| `src/components/shows/SeasonAccordion.tsx` | Modified | "Pistas" cell: the episode's `SearchSubtitlesButton` (compact) + `UploadSubtitlesButton`, then `SubtitleEmbedOutcome`. |
| `src/actions/movies.ts`, `src/actions/shows.ts` | Modified | `uploadMovieSubtitlesAction`/`uploadEpisodeSubtitlesAction`, mirroring `embedMovieSubtitlesAction`. |
| `src/types/media.ts` | Modified | `SubtitleUploadInput` exactly as the spec's SDL. |
| `messages/es.json`, `messages/en.json` | Modified | `media.uploadSubtitles.*` copy plus the five new `errors.subtitleEmbed.*` keys. |
| `next.config.ts` | Modified | Server-action body limit 24 MB. |
| `services/web/CLAUDE.md` | Modified | One line for the upload dialog. |

## Existing code to reuse

- `src/components/media/EmbedSubtitlesModal.tsx`:
  - the modal shell (`@/components/ui/modal`);
  - the row layout;
  - `ERROR_CLASS`/`INPUT_CLASS`;
  - the "Automático" checkbox that disables the offset input (`113`);
  - the at-most-one-default behaviour;
  - inline refusal display that keeps the dialog open.

  Copy the look, and share `parseOffset` through `subtitle-offset.ts`. Do not fork a third offset
  parser.
- `src/components/media/EmbedSubtitlesButton.tsx`: the in-flight rule (`status` not
  `COMPLETED`/`FAILED`, `113` REQ-7), the `translateErrorKey` usage, and the
  `router.refresh()` after success.
- `src/components/media/SearchSubtitlesButton.tsx`: `IN_FLIGHT_STATUSES` for the search half of
  REQ-3's disabled state, and the `compact`/`fullWidth` props convention.
- `src/actions/languages.ts` `getLanguages()`: the catalog the language select and the preset read.
  Unlike `EmbedSubtitlesModal`'s `baseLanguages`, the upload lists **every** row, so variants can be
  chosen.
- `src/lib/replaceable-subtitle-languages.ts` / the title's `fileSubtitleLanguages`: which rows may
  tick "replace" (REQ-9).
- `src/actions/movies.ts` `embedMovieSubtitlesAction`: the `fetchGraphQL` + `redirectIfUnauthenticated`
  + `toActionError` pattern, copied for the two new actions.
- `src/lib/graphql-error.ts` `translateErrorKey`: rendering every refusal key.

## Steps

1. **Types and actions.** Add `SubtitleUploadInput` to `types/media.ts`. Add the two server actions,
   which send `{ movieId | episodeId, subtitles }` and return `{ embed } | { error, key }` like the
   embed action.
2. **Body limit.** Set the server-action body size limit to `24mb` in `next.config.ts`. Use the
   key Next 16 reads: check it in `node_modules/next/dist/docs/` (`experimental.serverActions` vs a
   top-level `serverActions`) rather than assuming, because a wrong key is silently ignored and
   leaves the 1 MB default.
3. **`presetFromFileName`.**
   - Strip a trailing `.srt` (case-insensitive) and split on `.`.
   - Walk the segments from last to first:
     - a segment equal to `forced` (case-insensitive) sets `isForced`;
     - the first segment matching a language wins.
   - A segment matches a language by its `tag`, `iso2`, `iso3` or English `name`, or by its
     `Intl.DisplayNames` name in `es` or `en` for the row's tag (`Español`, `Spanish`).
   - `Latino` matches `es-419`.
   - Comparison ignores case. Segments that match nothing are skipped (`sdh`, `hi`, `cc`, numbers,
     release words).
   - No match gives `languageTag: null`.
4. **`subtitle-offset.ts`.** Move `OFFSET_LIMIT`/`parseOffset` out of `EmbedSubtitlesModal.tsx`,
   with no behaviour change there.
5. **`UploadSubtitlesModal`.**
   - Rows are keyed by file name. A second file with the same name replaces the row and shows a
     notice, because `duplicate_subtitle` would refuse it anyway.
   - On add:
     - an extension other than `.srt` gives an inline `upload_not_srt` on that row, and the row is
       not sendable;
     - over 2 MiB gives an inline `upload_too_large`;
     - a ninth file gives an inline `upload_too_many` and is not added;
     - otherwise the row starts with the preset language/forced, `isDefault: false`,
       `replace: false`, `autoOffset: true`, offset `0`.
   - Each row has:
     - a language select over all languages (required);
     - a forced checkbox;
     - a default checkbox (checking one unchecks the others);
     - a replace checkbox, enabled only when the selected language's `iso3` is in
       `fileSubtitleLanguages` and the row is not forced, with a hint that replacing works per
       language and drops both Spanish variants (REQ-9);
     - offset and "Automático";
     - remove.
   - Confirm is disabled while any row lacks a language, has an invalid manual offset or carries a
     pre-check error.
   - On confirm, read each `File` with `arrayBuffer()` and base64-encode the **bytes**. Never use
     `file.text()`, because that decodes to UTF-8 and breaks a cp1252 file before `api` sees it.
     Then call the action.
6. **`UploadSubtitlesButton`.**
   - Props: `embed`, `search`, `fileSubtitleLanguages`, `onUpload`, `compact`.
   - Disabled, with a tooltip saying why, while the embed or the search is in flight.
   - On success: close, then `router.refresh()`.
   - On `error.subtitleEmbed.busy` or `error.subtitleSearch.in_progress`: close, `router.refresh()`,
     and show the message under the button, like `EmbedSubtitlesButton`'s stale message.
   - Any other refusal stays inline in the open modal with its rows kept.
7. **`SubtitleEmbedOutcome`.** Extract the failure/warning lines (and, for compact layouts, the
   in-flight label) from `EmbedSubtitlesButton`. Render it once per title, next to the upload button,
   for every owner. `EmbedSubtitlesButton` no longer renders those lines, so an admin does not see
   them twice.
8. **Placement.**
   - In `Movie.tsx`: `{movie.status === "COMPLETED" && <div className="flex gap-2">{subtitleSearchAvailable && <SearchSubtitlesButton … />}<UploadSubtitlesButton … /></div>}`.
     The search button keeps `fullWidth` inside a `flex-1` wrapper, and the upload button stands
     alone when search is unavailable.
   - In `SeasonAccordion.tsx`, the same pair in the "Pistas" cell, `compact`.
   - No season-level button.
9. **Catalog.**
   - `media.uploadSubtitles`, in `es` (Rioplatense, matching `media.embedSubtitles`) and `en`:
     `button` ("Subir subtítulos" / "Upload subtitles"), `busyEmbed`, `busySearch`, `title`,
     `addFiles`, `language`, `forced`, `default`, `replace`, `replaceHint`, `offset`, `auto`,
     `remove`, `confirm`, `cancel`, `noLanguage`.
   - Five `errors.subtitleEmbed.*` keys with the spec's Spanish copy and an English equivalent.
10. **Docs.** Add one line to `services/web/CLAUDE.md` under the media components.

## Contract obligations

Consume `../spec.md` § GraphQL Contract Delta exactly:

```graphql
uploadMovieSubtitles(movieId: Int!, subtitles: [SubtitleUploadInput!]!): SubtitleEmbed!
uploadEpisodeSubtitles(episodeId: Int!, subtitles: [SubtitleUploadInput!]!): SubtitleEmbed!
input SubtitleUploadInput { fileName contentBase64 languageTag isForced isDefault replace offsetMs autoOffset }
```

`offsetMs` is always sent (`0` when automatic). `languageTag` is a `Language.tag`, never an ISO 3
code. Handle every refusal in the spec's table:
- `busy`/`in_progress` close the dialog and refresh;
- `not_found` shows inline (the page is stale) and refreshes;
- every other key shows inline in the open dialog with the rows kept, through `translateErrorKey`,
  falling back to `network.connectionFailed`.

Treat any `SubtitleEmbed.status` other than `COMPLETED`/`FAILED` as in flight, unknown ones
included. The delta is read-only. If it is wrong, stop and report.

## Tests

`web` has no test runner (see `119`'s web plan). Two places could fail silently:
- the preset could pick the wrong language;
- the file could be read as text, mangling a cp1252 file.

The preset is a pure function in `src/lib/subtitle-file-name.ts` and would be owed a unit test
(spec NFR-4's web item). With no runner, it is covered by the manual pass instead: AC-3's three file
names plus `Movie.2019.1080p.spa.forced.srt`. Introducing a runner for one function is out of scope
for this feature. The bytes-not-text rule is covered by AC-7 in the manual pass.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/comments web
```

All pass. Do **not** run `bin/npm web run build` while the dev stack is up: it clobbers the dev
`.next` and un-hydrates every page.

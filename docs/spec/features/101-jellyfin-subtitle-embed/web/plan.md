---
title: Jellyfin Subtitle Embed — web slice
service: web
last_updated: 2026-10-23
status: Implemented
---

# PLAN: Jellyfin Subtitle Embed — `web` (`web/plan.md`)

## Scope

`web` shows the "Embed in MKV" action on a film's detail page and on each episode row of a series'
detail page, opens a modal to choose subtitles, sends the embed mutation, and shows the latest
embed's state (embedding…, failure, warning). It translates every refusal and every state key
through the existing catalog.

It does **not** decide who may embed. `api` returns an empty list to a non-administrator, so the
button simply never renders. It does not call Jellyfin, does not poll, and does not touch
`/downloads`.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/media.ts` | Modified | `ExternalSubtitle`, `SubtitleEmbed`, `SubtitleEmbedStatus`, `SubtitleEmbedInput`, retyped by hand from the spec |
| `src/actions/movies.ts` | Modified | `externalSubtitles` + `subtitleEmbed` added to `getMovieById`'s query; `embedMovieSubtitlesAction` |
| `src/actions/shows.ts` | Modified | The same two fields on each episode in `GetShow`; `embedEpisodeSubtitlesAction` |
| `src/components/media/EmbedSubtitlesButton.tsx` | New | Button + status line (embedding / failed / warning), opens the modal |
| `src/components/media/EmbedSubtitlesModal.tsx` | New | One row per subtitle: include checkbox, language select, default checkbox (radio-like, at most one), offset input (ms) |
| `src/components/movies/Movie.tsx` | Modified | Renders the button beside `RefreshTitleButton`/`RemoveTitleButton` |
| `src/components/shows/SeasonAccordion.tsx` | Modified | Renders a compact button in the episode row's action cell, beside search/import/magnet |
| `messages/en.json`, `messages/es.json` | Modified | `media.embedSubtitles.*` UI copy and every `errors.subtitleEmbed.*` key from the spec's two tables (Spanish copy exactly as written there) |

## Existing code to reuse

- `src/components/media/RefreshTitleButton.tsx`: the action-button shape (`useTransition`, inline
  error, `router.refresh()` on success). The new button follows it.
- `src/components/ui/modal` and `src/hooks/useModal.ts`: the modal, as every import/search modal on
  both pages already uses.
- `src/actions/movies.ts`'s `setMovieGrainModeAction` / `refreshMovieAction`: the server-action
  pattern (try/catch around `fetchGraphQL`, `{ success } | { error }` return).
- `src/lib/graphql-error.ts`'s `translateErrorKey` / the `extensions.i18n.key` reader for every
  refusal, and `translateErrorKey` again for `SubtitleEmbed.errorKey`/`warningKey`, which are bare
  keys, not GraphQL errors.
- `src/actions/languages.ts`'s `getLanguages()` for the language select. Offer base languages only
  (no `es-419`/`es-ES`: REQ-5 never writes a variant), and send `iso3`.
- `src/components/form/` inputs and `Switch`, as used in `Movie.tsx`.

## Steps

1. **Types.** Retype the four shapes from `../spec.md`.
2. **Actions.**
   - Add the fields to both detail queries. `externalSubtitles { fileName languageIso3 isForced title }`
     and `subtitleEmbed { id status errorKey warningKey createdAt finishedAt }`.
   - Add the two mutation actions. Both send `subtitles: SubtitleEmbedInput[]`, with `fileName`
     copied from the listed entry. It is the sidecar's identity; never rebuild it, never send a
     position.
3. **Modal.**
   - One row per subtitle, labelled by `fileName` (with `title` as secondary text). Preselect its
     language from `languageIso3`. A `null` one forces a choice before the confirm button enables.
   - The default checkboxes are mutually exclusive: checking one unchecks the others.
   - Offset is an integer field, `0` by default, client-limited to ±600000. The server re-validates.
   - The confirm button is disabled with no row included.
4. **Button.**
   - Render nothing when `externalSubtitles` is empty.
   - While `subtitleEmbed.status` is `QUEUED`/`RUNNING`, show a disabled "Incrustando…" state
     instead of the action.
   - When the latest is `FAILED`, show its translated `errorKey` beside the action. When it is
     `COMPLETED` with a `warningKey`, show the warning.
   - No polling: the administrator reloads or acts, as with `064`'s badge.
5. **Wire it in.** In `Movie.tsx` place the button beside Refresh/Remove. In `SeasonAccordion.tsx`
   put it in the episode row's action cell, so its modal opens per episode, the way
   `activeTarget` already scopes the other episode modals.
6. **Catalog.** Add every key to both locales.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta. Every condition:

| Error key | What `web` does |
| :-- | :-- |
| the admin error, the not-found keys | Translated inline in the modal; modal stays open |
| `unsupported_media_server`, `media_server_unavailable`, `no_file`, `not_mkv`, `outside_library`, `busy` | Translated inline in the modal; modal stays open |
| `empty_selection`, `multiple_defaults`, `duplicate_subtitle`, `unknown_language`, `offset_out_of_range` | Prevented client-side, but still rendered inline if the server returns them |
| `stale_listing` | Close the modal, `router.refresh()`, show the translated message where the button sits |
| `SubtitleEmbed.errorKey` (`subtitle_unreadable`, `charset_undetected`, `remux_failed`, `verify_failed`, `not_writable`, `interrupted`) | Status line under the button |
| `SubtitleEmbed.warningKey` (`sidecar_delete_failed`, `jellyfin_refresh_failed`) | Warning line under the button |

An unknown key falls back to the existing generic-error rendering in `graphql-error.ts`. Never show a
raw key.

## Tests

`web` carries no unit-test runner for components today (see `services/web/CLAUDE.md`). The silent
failures in this slice, and how each is caught instead:

- **Sending a rebuilt or wrong `fileName`**: the wrong sidecar is embedded and then deleted, or the
  request is refused. `api` refuses any name it does not list (`stale_listing`), so a typo cannot
  delete an unlisted file. Defended in the action by copying the entry object's `fileName`, and
  checked in the manual pass (AC-2 embeds only `.spa.srt`; `.eng.srt` must survive).
- **A key missing from one locale**: the raw key shows. Covered by the existing catalog-parity
  check, if `bin/npm web run lint` runs it; otherwise checked by grepping both files for every key
  in the spec's tables.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/comments web
```

Typecheck is 0 errors and lint is clean. Never run `bin/npm web run build` while a dev stack is up
(memory: it clobbers `.next`).

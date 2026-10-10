---
title: Title Detail Three-Column Layout
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-26
last_updated: 2026-09-26
status: Approved
services: [web]
---

# SPEC: Title Detail Three-Column Layout (`spec.md`)

## Context & Goal

The detail page of a film, a short and a series is today a two-column stack: poster on the left,
and one undifferentiated right column holding the title heading, the action buttons, the short
switch, the content kind selector, the synopsis, the dev-only ranking inspector and the full
audio/subtitle language form. `services/web/src/components/movies/Movie.tsx` and
`services/web/src/components/shows/Show.tsx` each render their own copy of that stack. The result
is one very long right column where reading the synopsis means scrolling past a form, and where
the two destructive-ish actions (Refresh, Remove) sit shoulder to shoulder with the two
acquisition actions (file, magnet) as if they were the same kind of thing.

The language form is the worst of it. `TitleLanguagesForm` is two `LanguagePickerField` panes and
a Guardar button, always expanded, always taking vertical space, even though a user changes a
title's audio/subtitle preference approximately once. Worse, it shows only what the **title** has
stored — a title with no languages of its own renders two empty pickers, while the values that
will actually be used for ranking and encoding come from the user's `/preferences`. Today the only
place that resolution is visible is `RankingDebugPanel`, which is explicitly not rendered in
production.

This feature reorganises that page into three columns — poster; acquisition actions plus synopsis;
title management plus a read-only languages panel with a "change" button that opens the form in a
modal — and makes the languages panel state what is *effective*, marking when a value is inherited
from `/preferences` rather than set on the title. Nothing about acquisition, ranking, encoding or
the pipeline changes; no pipeline stage in the root `CLAUDE.md` changes status. The rows below the
three columns — the downloads panel, the torrent search and its results on a film, the season
accordion on a series — keep their full width and their current order.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Three columns)**: The detail page of a film, a short and a series must present its
      header as three columns on a wide viewport: poster (left), acquisition actions and synopsis
      (centre), title management and language information (right).
- [ ] **REQ-2 (Left column)**: The left column must hold the poster and nothing else, keeping the
      current 2:3 aspect placeholder when the title has no poster.
- [ ] **REQ-3 (Centre column, film)**: On a film or a short, the centre column must hold the file
      and magnet buttons below the heading (REQ-14) and the synopsis below them.
- [ ] **REQ-4 (Centre column, series)**: On a series, the centre column must hold only the
      synopsis. No file or magnet button is added to the series header — acquisition on a series
      stays season-scoped, in the season accordion.
- [ ] **REQ-5 (Right column order)**: The right column must hold, top to bottom: the Refresh and
      Remove buttons; then, on a film with shorts enabled, the "registered as short" switch; then
      the content kind selector; then the language information panel.
- [ ] **REQ-6 (Language panel is read-only)**: The language panel must display the effective audio
      languages, whether audio is mandatory, and the effective subtitle languages, as text or
      badges — not as editable controls.
- [ ] **REQ-7 (Effective, marked as inherited)**: When the title has no audio languages of its
      own, the panel must show the caller's `/preferences` audio languages and audio-mandatory
      flag, visibly marked as inherited. The same rule applies independently to subtitles. When
      the title has its own values, those are shown unmarked. This mirrors the merge
      `SearchTorrent` and `RankingDebugPanel` already perform.
- [ ] **REQ-8 (Empty state)**: When neither the title nor `/preferences` supplies a language for a
      category, the panel must say so explicitly rather than render an empty area.
- [ ] **REQ-9 (Change button opens a modal)**: The panel must carry a button that opens a modal
      containing the existing audio/subtitle editing form, with its current values preselected.
- [ ] **REQ-10 (Modal save)**: Saving in the modal must persist through the same actions used
      today, close the modal on success, and leave the panel showing the newly saved values
      without a manual page reload.
- [ ] **REQ-11 (Modal failure)**: When a save is refused, the modal must stay open, show the
      refusal message, and leave the panel showing the values that are actually stored — a refused
      save must never leave the panel displaying a value the server rejected.
- [ ] **REQ-12 (Modal dismissal)**: Closing the modal without saving must discard the pending
      selection; reopening it must show the stored values again, not the discarded ones.
- [ ] **REQ-13 (Rows below unchanged)**: Below the three-column header, in order and at full
      width: the downloads panel; on a film, the torrent search and its results; on a series, the
      season accordion. Their content and behaviour are unchanged.
- [ ] **REQ-14 (Heading and status)**: The title, year, original language and status badge must
      head the centre column, above the acquisition actions on a film and above the synopsis on a
      series — the position they occupy today, now scoped to the centre column rather than to the
      whole right-hand side.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No contract change)**: Must add no GraphQL field, argument, mutation or error. Every
      value the new panel shows is already returned by `getMovieById`, `getShowById` and
      `getPreferences`.
- [ ] **NFR-2 (`api` and `worker` untouched)**: `git diff --stat services/api services/worker` must
      be empty. Ranking, encoding and acquisition read the same stored values they read today; this
      feature changes only how those values are displayed and edited.
- [ ] **NFR-3 (Narrow viewport)**: Below the three-column breakpoint the columns must stack in the
      order poster, centre, right, with no horizontal scroll.
- [ ] **NFR-4 (i18n)**: Every new string must exist in both `messages/en.json` and
      `messages/es.json`; `bin/cli web node scripts/check-messages.mjs` must report no drift.
- [ ] **NFR-5 (Dev inspector)**: `RankingDebugPanel` must remain dev-only. The new panel is a
      user-facing summary, not a replacement for it, and must not leak the inspector's
      ranking-internals vocabulary into production.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.**

Every value the redesign needs is already on the wire. `Movie`/`Show` already carry `posterUrl`,
`title`, `releaseDate`, `originalLanguage`, `status`, `overview`, `isShort`, `contentKind`,
`otherOwners`, `audioLanguages`, `subtitleLanguages` and `audioMandatory`; `UserPreferences`
already carries `audioLanguages`, `subtitleLanguages` and `audioMandatory`. The mutations behind
the modal (`setMoviePreferredTrackLanguages` / `setShowPreferredTrackLanguages`,
`setMovieAudioMandatory` / `setShowAudioMandatory`) are the ones the inline form calls today, with
their existing error conditions and existing `web` handling. A refusal surfaced by REQ-11 is the
same refusal the inline form surfaces today, in a modal instead of in place.

## Data Model Changes

None.

## Acceptance Criteria

- [x] **AC-1**: On a wide viewport, `/movies/<id>` for a registered film renders three columns:
      the poster; the title heading with its status badge above the file and magnet buttons above
      the synopsis; Refresh and Remove above the short switch, the content kind selector and the
      language panel.
      **Confirmed 2026-10-09** in a browser with an admin session at `http://localhost:3000`, emulating a 1600x1000 viewport. The grid resolves to
      `grid-template-columns: 256px 798px 320px`, its three children share `top: 173` at
      `left: 74 / 362 / 1192`. In DOM order the centre column is the `Inception` heading, the
      `2010 - EN - Downloading` line carrying the status badge, the File and Magnet buttons, then
      the synopsis; the right column is Refresh, Remove, the "Registered as a short" switch, the
      content-kind combobox and the Languages panel. (The `RankingDebugPanel` that also renders in
      the centre column is gated on `process.env.NODE_ENV !== "production"`, so it is absent from
      the shipped page.)
- [x] **AC-2**: On the same page, the downloads panel, the torrent search and the search results
      appear in that order below the three columns, each at the page's full width.
      **Confirmed 2026-10-09** in a browser with an admin session at `http://localhost:3000`. Below the grid, and siblings of it, the downloads panel sits at
      `top: 705` and the torrent search - its form and its results table, one block - at `top: 929`,
      both `width: 1438`, the full inner width of the page card, against the grid's own 1438.
- [x] **AC-3**: `/shows/<id>` renders the same three columns with no file or magnet button in the
      centre column and no short switch in the right column; the season accordion is still below
      the downloads panel at full width.
      **Confirmed 2026-10-09** in a browser with an admin session at `http://localhost:3000` on `/shows/1` (Reacher). Same three columns
      (`256px 597px 320px`, all at `top: 173`); the centre column reads
      `Reacher | 2022 - EN - MISSING | SYNOPSIS | ...` with **no** File or Magnet button, and the
      right column reads `Refresh | Remove | Content kind | ... | Languages | ...` with **no** short
      switch. The season accordion is a separate block below the card - the card bottom is at 750,
      the accordion starts at 799 - at `width: 1287`, the full page width, newest season first
      (`Season 4`).
- [x] **AC-4**: `/movies/<id>` for a film registered as a short renders the short switch checked;
      toggling it off and reloading shows it off.
      **Confirmed 2026-10-09** in a browser with an admin session at `http://localhost:3000`, round-tripped in both directions on `/movies/1`. The switch
      read off (`bg-gray-200`); toggling it on and **reloading the page** rendered it checked
      (`bg-brand-500`), with `movies.isShort = 1` in the database; toggling it off and reloading
      rendered it off again, with `isShort = 0`. The film was left in its original state.
- [x] **AC-5**: Given a film with no audio languages of its own and a user whose `/preferences`
      sets audio to `es`, the language panel shows `es` marked as inherited. Setting the film's own
      audio to `ja` through the modal makes the panel show `ja` unmarked, with no page reload.
      **Confirmed 2026-10-09** in a browser with an admin session at `http://localhost:3000`, substituting `es-ES` for the criterion's bare `es` because the
      seeded language catalog offers no plain Spanish - only `es-ES` ("European Spanish") and
      `es-419` ("Latin American Spanish"). With `/preferences` audio set to European Spanish and
      `/movies/2` (Spider-Man: Brand New Day) holding no audio language of its own, the panel read
      `Audio (from your preferences) European Spanish`. Setting the film's own audio to Japanese
      through the modal made it read `Audio | Japanese` with **no** inheritance marker, while the
      subtitle line kept its `(from your preferences)` marker. No page reload: a sentinel assigned
      to `window` before the save was still readable afterwards.
- [x] **AC-6**: Given a user whose `/preferences` sets no subtitle language and a title with none
      of its own, the subtitle line of the panel reads the explicit empty-state text, not a blank
      area.
      **Confirmed 2026-10-09** in a browser with an admin session at `http://localhost:3000`, on both page kinds. With the user holding no subtitle
      preference and neither title holding one of its own, the panel's subtitle line reads
      `Subtitles (from your preferences) / None set` - the explicit empty-state string, not a blank
      area - on `/shows/1` and on `/movies/2`.
- [ ] **AC-7** *(failure path)*: With `api` stopped (`docker compose stop api`), opening the modal
      on `/movies/<id>` and saving shows the refusal message inside the still-open modal; closing
      it leaves the panel showing the values from before the attempt, and reloading after
      `docker compose start api` confirms nothing was stored.
      **Run 2026-10-09, and it does not hold.** With `/movies/2` already rendered and then
      `docker compose stop api`, opening the modal, adding Korean (the chips read
      `Quitar japonés, Quitar coreano`) and pressing Guardar **closes the modal and replaces the
      page with Next's server-error overlay** - `TypeError: fetch failed`, caused by
      `getaddrinfo ENOTFOUND api`. Measured immediately after the save: `modalOpen: false`,
      the form's error box empty, `nextjs-portal` present. Reproduced twice.

      The refusal path itself is written correctly - `setMoviePreferredTrackLanguagesAction`
      (`services/web/src/actions/languages.ts`) wraps `fetchGraphQL` in try/catch and returns
      `{ error: t("network.connectionFailed") }`, and `TitleLanguagesForm` only calls `onSaved()`
      when it collected no errors. It never gets the chance: a Next Server Action's response also
      carries a re-render of the current route, and that re-render runs `getMovie`/`getLanguages`
      against the same unreachable `api`, so the whole action response fails and the client never
      receives the value the action returned. **The criterion as written cannot hold while the
      route's own RSC data comes from the service being stopped** - this is a design question for
      the feature, not a measurement still to take.

      The criterion's last clause does hold: nothing was stored. After
      `docker compose start api`, `user_movie_languages` for movie 2 still reads `ja AUDIO` alone,
      with no Korean row.
- [x] **AC-8**: Opening the modal, changing the audio selection, closing it with its dismiss
      control and reopening it shows the stored selection, not the discarded one.
      **Confirmed 2026-10-09** in a browser with an admin session at `http://localhost:3000` on `/movies/1`, whose own audio is
      `es-419, cs`. Removing Czech inside the modal, dismissing it with its Close control, and
      reopening it showed both chips back (`Remove Latin American Spanish`, `Remove Czech`), and the
      panel behind it never stopped reading `Latin American Spanish, Czech`.
- [x] **AC-9**: At a phone width the three columns stack poster, centre, right with no horizontal
      page scroll.
      **Confirmed 2026-10-09** in a browser with an admin session at `http://localhost:3000`, at the 375x812 mobile preset. The grid collapses to a single
      `301px` column and the three children stack in order - poster `top: 153`, centre (`Inception`)
      `top: 635`, right (`Refresh`) `top: 1439` - all at `left: 37`, with
      `document.documentElement.scrollWidth === window.innerWidth === 375`, so no horizontal page
      scroll.
- [x] **AC-10**: `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift, and
      switching the UI locale to `es` shows every new label translated.
      **Confirmed 2026-10-09, both halves.** The parity check reports `OK: en.json and es.json
      match exactly (602 keys)`. Switching the interface language to Spanish in `/preferences` and
      reloading `/movies/2` renders every label this feature introduced in Spanish, not as a
      present-but-untranslated key: `Actualizar`, `Quitar`, `Registrado como corto`,
      `Tipo de contenido`, `CGI / Animación 3D`, `Idiomas`, `El audio no es obligatorio`,
      `Subtítulos (de tus preferencias)`, `Ninguno definido`, `Cambiar`, plus `SINOPSIS`, `Archivo`
      and the `FALTA` status badge, with `<html lang="es">`.
- [x] **AC-11**: `git diff --stat services/api services/worker` is empty and `services/api/src/schema.gql`
      does not appear in the diff. Confirmed 2026-10-09 against the feature's commit (`c219812`,
      "add & implement 077 spec, movie/short/serie detail"): its 23 files are this spec's own
      documents, `CLAUDE.md`, `README.md`, `site/index.html`, `services/web/CLAUDE.md`, the two
      message catalogs and fifteen files under `services/web/src/` — nothing under
      `services/api/` or `services/worker/`, so `schema.gql` never appears.
- [x] **AC-12**: `bin/npm web run build` exits 0 and `bin/cli web npx --no tsc --noEmit` reports 0 errors.
      Both run 2026-10-09. The build was run in a throwaway container from the `perceptor-web:local-dev`
      image (node 24.18.0) with `services/web` bind-mounted as uid 1000, because `bin/npm` shells into
      the running container and the root `CLAUDE.md` forbids a build against a live dev stack — the dev
      `.next` was parked before the run and restored after, so the stack was never un-hydrated. It
      exited 0 and emitted the full route table, including `/movies/[id]` and `/shows/[id]`, the two
      routes this feature rewrote. `tsc --noEmit` is clean.

## Out of Scope

- **Changing what the languages mean.** The merge rule (a title with no languages of its own falls
  back to the caller's `/preferences`, independently per category) is displayed here, not changed.
  Ranking and encoding resolve it exactly as they do today.
- **Per-season or per-episode language overrides.** The panel is title-scoped, like the form it
  replaces. A season inheriting differently is its own feature.
- **Retiring `RankingDebugPanel`.** It stays dev-only and stays where it is. The new panel answers
  "which languages apply", not "why did this release rank first".
- **The season accordion's internals.** Its header buttons, its episode rows and its own modals are
  untouched; only its position relative to the header changes, and only because the header above it
  changed shape.
- **Collapsing `Movie.tsx` and `Show.tsx` into one component.** The deliberate film/series
  duplication (`006-media-search` § Out of Scope) outranks Article X here; both get the same layout,
  they do not get a shared implementation.
- **The billboard, the listings and the search results.** Only the two detail screens change.

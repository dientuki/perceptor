---
title: Per-Title Audio/Subtitle Language Split
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-09-02
last_updated: 2026-09-02
status: Implemented
services: [api, web, worker]
---

# SPEC: Per-Title Audio/Subtitle Language Split (`spec.md`)

## Context & Goal

A user can already ask for extra languages on one specific film or series — `Movie.preferredLanguages`
/ `Show.preferredLanguages`, backed by `UserMovieLanguage`/`UserShowLanguage`
(`services/api/src/languages/languages.service.ts`), edited today from the movie/show detail page
(`services/web/src/components/movies/Movie.tsx`, `services/web/src/components/shows/Show.tsx`)
through a single `LanguagePicker` bound to `setMoviePreferredLanguagesAction`/
`setShowPreferredLanguagesAction`. That preference is not decorative: `ProcessJobsService` merges it
— per owner, deduplicated, original language first — with the installation's `default_languages`
setting into `EncodeJobDetails.allowedLanguagesIso3`/`allowedLanguageTags`
(`services/api/src/process-jobs/process-jobs.service.ts`), which `worker/src/ffmpeg/buildCommand.ts`
hands, **identically**, to both `getAudioParams` and `getSubtitleParams`. One list currently governs
both audio and subtitle track selection at encode time, for every source of that list — the
installation default, and every owner's per-title choice.

`021-user-preferences` split the *general*, non-title-scoped version of this same idea — a user's
default download languages — into `audioLanguages`/`subtitleLanguages` (`LanguageTrackKind` enum,
`UserLanguagePreference` table). It explicitly left the per-title mechanism, and the encode merge
that reads it, untouched: "one list serves both... splitting that contract is its own spec, with
`worker` in its `services:` list; this one stores the two lists and shows them." This is that
follow-up spec, but scoped only to the **per-title** level: a user picks a movie or series and, on
that title's own detail page, sets audio languages and subtitle languages separately. The
installation-wide `default_languages` setting and 021's general per-user preference stay exactly as
they are today — still one undifferentiated list, still contributing to both the audio and the
subtitle allow-list at encode time. This spec does not touch `/settings`, whose language picker
`029-settings-screen-tabs` already removed.

**Amended at `0.2.0`, before implementation started**: the audio side of every one of these pickers
also grows an *Audio mandatory* checkbox — a plain yes/no, stored per scope, saved by the same button
as the languages beside it. That pulls `/preferences` into this spec's surface after all, since the
general per-user audio pane is one of the three places the checkbox appears; `021-user-preferences`'s
stored **language lists** are still untouched (NFR-4). The flag is **inert this cycle**: nothing reads
it, least of all the worker (REQ-11). It is storage and UI, put in place ahead of the rule that will
eventually consult it, in the same spirit as `030-language-regional-variants` shipping
`allowedLanguageTags` a cycle before `031` taught the worker to read it.

The visual form for the two new panels — audio on one side, subtitles on the other, each a picker
with a "chosen" badge list beneath it — reuses the shape `021-user-preferences` built for
`/preferences`'s *Idiomas de descarga* tab: two `LanguagePickerField`-style controlled panes side by
side. This is a UI convention now, not a one-off: the per-title version follows it instead of
inventing a third layout.

No pipeline stage in the root `CLAUDE.md` changes status — Transcode is already "working today"; this
changes what feeds its language-selection rule, not whether the stage exists.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Two panes, one save)**: The movie and show detail pages replace their single
      language picker with two panes — *Audio languages* and *Subtitle languages* — laid out side
      by side exactly like `/preferences`'s *Idiomas de descarga* tab, under one *Guardar* button
      that saves both together. Changing one pane and pressing save must not require also touching
      the other; an untouched pane keeps its last-saved value.

- [ ] **REQ-2 (Persisted separately, per title, per kind)**: A user's audio-language choice and
      subtitle-language choice for one film (or one series) are stored as two independent sets, the
      same way `021-user-preferences` split the general preference — replacing one list with two,
      never adding a second list beside the first. Saving audio must never change the stored
      subtitle set for that title, and the reverse.

- [ ] **REQ-3 (GraphQL surface renamed to match, not added beside)**: `Movie.preferredLanguages` and
      `Show.preferredLanguages` are removed and replaced by `audioLanguages`/`subtitleLanguages` on
      each type — the same two-field shape `UserPreferences` already uses. `setMoviePreferredLanguages`
      and `setShowPreferredLanguages` are removed and replaced by `setMoviePreferredTrackLanguages`/
      `setShowPreferredTrackLanguages`, each taking a `kind: LanguageTrackKind!` argument alongside
      the existing `movieId`/`showId` and `tags`. No back-compat field or argument — this is a clean
      rename, not an addition (no codegen consumer depends on the old names beyond this repo's own
      `web`/`worker`, both updated in the same slice).

- [ ] **REQ-4 (Ownership refusal unchanged)**: Both new mutations keep the exact refusal the old
      ones already have for a title the caller does not own or that does not exist — `movie(id)`'s
      /`show(id)`'s null-means-unavailable rule, unchanged by this feature.

- [ ] **REQ-5 (The encode merge splits by kind)**: `ProcessJobsService`'s language merge — today one
      walk producing one `{iso3Codes, tags}` pair — produces two: an audio pair and a subtitle pair.
      Each pair is *{original language} ∪ default_languages (unsplit, contributes to both) ∪ every
      owner's per-title preference **of that kind*** — mirroring today's rule exactly, except the
      per-title contribution is now filtered by `kind` instead of taken whole. A title with no
      per-title preference of either kind falls through to exactly what it produces today for both
      lists (original + installation default) — no regression for the common case.

- [ ] **REQ-6 (Worker consumes two allow-lists, not one)**: `EncodeJobDetails.allowedLanguagesIso3`/
      `allowedLanguageTags` are removed and replaced by `allowedAudioLanguagesIso3`/
      `allowedAudioLanguageTags`/`allowedSubtitleLanguagesIso3`/`allowedSubtitleLanguageTags`.
      `buildFfmpegCommand` (`services/worker/src/ffmpeg/buildCommand.ts`) passes the audio pair to
      `getAudioParams` and the subtitle pair to `getSubtitleParams` — each function's own signature,
      selection logic and REQ numbering (011-av1-transcode) stay otherwise unchanged; only which list
      arrives changes.

- [ ] **REQ-7 (Original audio stays mandatory)**: `getAudioParams`'s existing rule — the original
      language must survive filtering or the encode fails outright (011-av1-transcode REQ-6) — is
      untouched by this split; `originalLanguageIso3` is still a field of its own, unrelated to which
      allow-list arrives.

- [ ] **REQ-8 (An *Audio mandatory* checkbox on every audio pane)**: The audio pane of all three
      language selectors — `/preferences`'s *Idiomas de descarga* tab, the movie detail page and the
      show detail page — carries a checkbox labelled *Audio mandatory*, rendered inside the audio
      pane rather than beside the pair, so it reads as a property of the audio choice and not of the
      title. It is saved by the same *Guardar* that saves the languages around it (REQ-1), in the
      same submit, and an unchanged checkbox keeps its stored value.

- [ ] **REQ-9 (Three independent booleans, default `false`)**: The flag is stored once per audio
      selection scope — one for the user's general preference, one per (user, film), one per
      (user, series) — as a plain non-null boolean defaulting to `false`. It is **not** a per-language
      flag and **not** a tri-state: a per-title value never inherits or falls back to the user's
      general value, because a yes/no checkbox has no way to render "unset". Turning it on for one
      film says nothing about any other film or about the user's general preference.

- [ ] **REQ-10 (Its own mutations, never folded into the language writes)**: The flag is written by
      three mutations of its own — `setAudioMandatory`, `setMovieAudioMandatory`,
      `setShowAudioMandatory` — not by adding an argument to
      `setMoviePreferredTrackLanguages`/`setShowPreferredTrackLanguages`/`setPreferredTrackLanguages`.
      Those three take a `kind`, and a flag that only means something for `AUDIO` would be a silent
      no-op on half their calls. The per-title pair keeps the same ownership refusal as every other
      per-title mutation (REQ-4).

- [ ] **REQ-11 (Inert: the worker never sees it)**: No field of `EncodeJobDetails` carries this flag,
      `ProcessJobsService`'s merge does not read it, and nothing in `services/worker/` changes because
      of it. A future spec decides what "mandatory" does to track selection; until then the only
      observable effect of the checkbox is that it comes back checked after a reload.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Migration)**: `UserMovieLanguage`/`UserShowLanguage` each gain a non-null
      `kind LanguageTrackKind` column, defaulting existing rows to `AUDIO`, and their composite
      primary key extends to include it. The same migration adds the three
      `audioMandatory Boolean @default(false)` columns of REQ-9 to `users`, `user_movies` and
      `user_shows` — one migration for the whole feature, not two against adjacent tables. This is a live migration decision, not a placeholder — the
      environment is dev-only for this feature and may be reset instead if that is simpler at
      implementation time, but the migration must still be correct for an installation that is not
      reset.

- [ ] **NFR-2 (No dual-write, no compat shim)**: There is no transition period where both the old
      and new GraphQL surface exist. `web` and `worker` are updated in the same slice as `api`, per
      this repo's own convention against backwards-compatibility shims (root `CLAUDE.md`).

- [ ] **NFR-3 (`deleteMany` narrowed to kind, fault-injection tested)**: `LanguagesService`'s writes
      to `UserMovieLanguage`/`UserShowLanguage` narrow their `deleteMany` to
      `{ userId, movieId, kind }` / `{ userId, showId, kind }` — never bare `{ userId, movieId }` —
      so replacing the audio set can never wipe the subtitle set for the same title, the same
      pattern `021-user-preferences` proved for the general preference. Each narrowing needs an
      Article-IX test: widen the `where` back to drop `kind`, watch the test fail, restore it.

- [ ] **NFR-4 (Installation default and 021's general language lists stay untouched)**:
      `default_languages` (the `Setting`) and `021`'s `UserLanguagePreference` table are not modified
      by this feature — neither their schema, their resolvers, nor their contribution to the merge
      (REQ-5: the default still feeds both the audio and the subtitle allow-list, unsplit). Splitting
      either of those is explicitly out of scope (see below). The `0.2.0` amendment does add a column
      to `users` and one field to `UserPreferences` (REQ-9), which is why this NFR is about the stored
      **language lists** rather than about the `preferences` module as a whole.

- [ ] **NFR-5 (Typecheck and tests)**: `bin/cli api npx --no tsc --noEmit`, `bin/cli web npx --no tsc
      --noEmit` and `bin/cli worker npx --no tsc --noEmit` report 0 errors; `bin/npm api test` and
      `bin/npm worker test` report no failures; `bin/npm web run build` exits 0.

## GraphQL Contract Delta

```graphql
type Movie {
  audioLanguages: [Language!]!
  subtitleLanguages: [Language!]!
}

type Show {
  audioLanguages: [Language!]!
  subtitleLanguages: [Language!]!
}

type Mutation {
  setMoviePreferredTrackLanguages(movieId: Int!, kind: LanguageTrackKind!, tags: [String!]!): [Language!]!
  setShowPreferredTrackLanguages(showId: Int!, kind: LanguageTrackKind!, tags: [String!]!): [Language!]!
}

type EncodeJobDetails {
  allowedAudioLanguagesIso3: [String!]!
  allowedAudioLanguageTags: [String!]!
  allowedSubtitleLanguagesIso3: [String!]!
  allowedSubtitleLanguageTags: [String!]!
}
```

Added at `0.2.0` (REQ-8 → REQ-11) — the *Audio mandatory* flag. Note what is **not** here:
`EncodeJobDetails` gains nothing, because nothing consumes the flag yet (REQ-11).

```graphql
type UserPreferences {
  audioMandatory: Boolean!
}

type Movie {
  audioMandatory: Boolean!
}

type Show {
  audioMandatory: Boolean!
}

type Mutation {
  setAudioMandatory(mandatory: Boolean!): UserPreferences!
  setMovieAudioMandatory(movieId: Int!, mandatory: Boolean!): Boolean!
  setShowAudioMandatory(showId: Int!, mandatory: Boolean!): Boolean!
}
```

`setAudioMandatory` returns the whole `UserPreferences`, mirroring `setAllowCinemaReleases`
(`021-user-preferences`) exactly — it is the same kind of write against the same row. The two
per-title mutations return the stored `Boolean!` instead of the title: `Movie`/`Show` are large types
whose fields are resolved lazily, and returning one would invite a client to re-select half the detail
page to read back one boolean. `Movie.audioMandatory`/`Show.audioMandatory` resolve to the **calling
user's own** flag for that title, read off the `user_movies`/`user_shows` ownership row — a title the
caller does not own is already unreachable, since `movie(id)`/`show(id)` return null for it.

**Removed** (no replacement field kept alongside the new ones — REQ-3/NFR-2):
`Movie.preferredLanguages`, `Show.preferredLanguages`, `Mutation.setMoviePreferredLanguages`,
`Mutation.setShowPreferredLanguages`, `EncodeJobDetails.allowedLanguagesIso3`,
`EncodeJobDetails.allowedLanguageTags`.

**Reused, not redefined**: `LanguageTrackKind` (`021-user-preferences` — `AUDIO`/`SUBTITLE`),
`Language`, `LANGUAGE_DUPLICATE`/`LANGUAGE_UNAVAILABLE` error keys
(`services/api/src/i18n/error-keys.ts`) and `LanguagesService.validateAndResolveLanguageIds` — the
same whole-list-validated-before-any-write shape every existing language mutation already uses.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `tags` contains a tag not in the `languages` table | `BadRequestException` (`ERROR_KEYS.LANGUAGE_UNAVAILABLE`) | `Language {tag} is not available` |
| `tags` contains the same tag twice | `BadRequestException` (`ERROR_KEYS.LANGUAGE_DUPLICATE`) | `Language {tag} is repeated` |
| `movieId`/`showId` does not exist or is not owned by the caller | `NotFoundException` (`ERROR_KEYS.MOVIE_NOT_FOUND` / `ERROR_KEYS.SHOW_NOT_AVAILABLE`) | unchanged — same message `008-movie-detail`/`009-show-detail` already froze |
| No credential, or a service credential (`SERVICE_TOKEN`) | `UnauthorizedException` (`ERROR_KEYS.AUTH_UNAUTHENTICATED`) | unchanged — neither mutation carries `@AllowService()` |
| `movieId`/`showId` unknown or unowned, on `setMovieAudioMandatory`/`setShowAudioMandatory` | `NotFoundException` (`ERROR_KEYS.MOVIE_NOT_FOUND` / `ERROR_KEYS.SHOW_NOT_AVAILABLE`) | unchanged — the same refusal, reused verbatim (REQ-10) |
| Any other input to the three `0.2.0` mutations | — | **none exists.** A `Boolean!` cannot be invalid, so these three have no failure of their own beyond auth and, for the per-title pair, ownership — the same reasoning `021-user-preferences` recorded for `setAllowCinemaReleases` |

**What `web` does with each.** Both mutations are called together from one submit (REQ-1), the same
"fire both, revert only the failed one, join the error messages" shape `PreferencesForm.tsx` already
established for `/preferences`'s single-button save — not a new pattern, its second use.
`error.auth.unauthenticated` never reaches that error area: `redirectIfUnauthenticated` intercepts it
inside the server action and sends the browser to `/login`, as every action under
`services/web/src/actions/` already does.

The `0.2.0` flag joins that same submit rather than saving on its own click: a movie's *Guardar*
fires three mutations, a series' three, and `/preferences`'s existing six becomes seven. On
`/preferences` this is literally one more entry in the `Promise.all` `PreferencesForm.tsx` already
runs — `setAllowCinemaReleases` is the row above it and behaves identically.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `UserMovieLanguage` | `+ kind LanguageTrackKind`; `@@id` extends from `[userId, movieId, languageId]` to `[userId, movieId, languageId, kind]` | non-null, default `AUDIO` | Existing rows become `AUDIO` (NFR-1) |
| `UserShowLanguage` | same shape as above, for `showId` | non-null, default `AUDIO` | Existing rows become `AUDIO` (NFR-1) |
| `User` | `+ audioMandatory Boolean` (REQ-9) | non-null, default `false` | Existing rows become `false` |
| `UserMovie` | `+ audioMandatory Boolean` — on the **ownership** row, not on `UserMovieLanguage`: the flag is one per (user, film), not one per chosen language | non-null, default `false` | Existing rows become `false` |
| `UserShow` | same, for (user, series) | non-null, default `false` | Existing rows become `false` |

No new tables and no change to `LanguageTrackKind` itself — it already has exactly the two values
this feature needs, seeded by `021-user-preferences`. The three `audioMandatory` columns live on the
row that already means "this user, this scope" — `users` for the general preference and the two
ownership joins for the per-title ones — so each one is deleted by the cascade that already removes
the scope it belongs to, and no fourth table is introduced for one boolean.

## Acceptance Criteria

- [x] **AC-1**: A movie's detail page shows two panes — *Audio languages*, *Subtitle languages* —
      and one *Guardar* button; `grep -rn "LanguagePicker" services/web/src/components/movies/Movie.tsx`
      returns nothing (the old single picker is gone, not left alongside the new panes).

- [ ] **AC-2**: Choosing two audio languages and one subtitle language for a movie and pressing
      *Guardar* once, then reloading, shows exactly that split; `movie { audioLanguages { tag }
      subtitleLanguages { tag } }` returns two and one tag respectively.

- [ ] **AC-3**: Saving a new audio selection for a movie that already has a saved subtitle selection
      leaves the subtitle selection unchanged — `bin/mysql -e 'select kind, count(*) from
      user_movie_languages where userId = "<id>" and movieId = <id> group by kind'` shows the
      `SUBTITLE` count unchanged before and after.

- [ ] **AC-4**: The same two behaviours (AC-2, AC-3) hold for a series through
      `setShowPreferredTrackLanguages` / `show { audioLanguages subtitleLanguages }`.

- [ ] **AC-5** *(failure path)*: `setMoviePreferredTrackLanguages(movieId: <id>, kind: AUDIO, tags:
      ["xx"])` (an unknown tag) is refused with `error.language.unavailable` and the stored audio set
      for that movie is unchanged.

- [ ] **AC-6** *(failure path)*: The same mutation called with a duplicated tag
      (`tags: ["es", "es"]`) is refused with `error.language.duplicate`, set unchanged.

- [ ] **AC-7** *(failure path)*: Either mutation called with `SERVICE_TOKEN` as bearer returns
      `error.auth.unauthenticated`.

- [x] **AC-8**: A movie with no per-title preference of either kind, encoded with the installation
      `default_languages` set to `es`, produces `allowedAudioLanguagesIso3` and
      `allowedSubtitleLanguagesIso3` that are identical to each other and to what today's single
      `allowedLanguagesIso3` would have produced for the same movie — the no-preference case is a
      no-op for this feature.

- [x] **AC-9**: A movie with an audio-only per-title preference (e.g. `fr`) produces
      `allowedAudioLanguagesIso3` containing `fre`/`fra` but `allowedSubtitleLanguagesIso3` **not**
      containing it (unless `fr` is also the installation default or the original language) —
      the split actually reaches the encode payload, not just storage.

- [ ] **AC-10**: Both typechecks (`api`, `web`, `worker`) report 0 errors; `bin/npm api test` and
      `bin/npm worker test` report no failures; `bin/npm web run build` exits 0.

- [ ] **AC-11** *(`0.2.0`)*: The audio pane on a movie detail page, a show detail page and
      `/preferences`'s *Idiomas de descarga* tab each show an *Audio mandatory* checkbox. Ticking it
      on a movie, pressing *Guardar* once and reloading shows it still ticked;
      `movie(id:) { audioMandatory }` returns `true`.

- [ ] **AC-12** *(`0.2.0`)*: The three scopes are independent. Ticking it for one film leaves
      `select audioMandatory from users where id = "<id>"` and every other row of `user_movies`
      `false` — verified with
      `bin/mysql -e 'select movieId, audioMandatory from user_movies where userId = "<id>"'`.

- [ ] **AC-13** *(`0.2.0`)*: Saving the flag and saving languages do not disturb each other. Ticking
      the checkbox **without** touching either pane and pressing *Guardar* leaves both stored language
      sets byte-identical (`select kind, count(*) from user_movie_languages …` unchanged); changing
      only the subtitle pane leaves `audioMandatory` unchanged.

- [x] **AC-14** *(`0.2.0`, inertness)*: `grep -rn "audioMandatory" services/worker/` returns nothing,
      and `processJob(id:)` exposes no field carrying the flag — the same encode payload as before the
      amendment (REQ-11).

## Out of Scope

- **Splitting `default_languages` (the installation setting) into audio/subtitle.** It stays one
  list, contributing to both allow-lists identically (NFR-4) — a decision confirmed with the user
  while scoping this spec, not an oversight. Splitting it is a separate, larger change: it would
  also need `/settings` to grow the control back that `029-settings-screen-tabs` removed, or a new
  home for it, which this spec does not decide.

- **Splitting `021-user-preferences`'s general per-user `audioLanguages`/`subtitleLanguages`
  contribution into the encode merge.** Those are stored, already split by kind, but nothing reads
  them at encode time today (021's own stated boundary) and this feature does not change that — only
  the per-title preference gains a live consumer.

  **Superseded by `042-encode-global-language-preferences`.** The boundary above held only until a
  real encode showed why it mattered — an English-original title with no per-title override and an
  empty `default_languages` setting collapsed to just the original language, silently dropping a
  user's global audio and subtitle preferences. `042` gives that global preference the same
  encode-time reader the per-title one already had, additively, in the same single-pass merge.

- **Any change to which tracks `getAudioParams`/`getSubtitleParams` pick once the allow-list is
  fixed** — SDH ordering, codec priority, variant-title detection. This feature only changes which
  list arrives, never the selection rule applied to it.

- **Any behaviour for the *Audio mandatory* flag** (`0.2.0`). It is stored and rendered, and read by
  nothing (REQ-11, AC-14). What "mandatory" should do — fail the encode when no audio track matches
  the chosen languages, the way `011-av1-transcode` REQ-6 already does for the *original* language,
  or something narrower — is a rule decision this spec does not make, and making it would mean
  reopening `getAudioParams`, which REQ-6 freezes. The day that spec is written, the storage and the
  UI are already here.

- **Reconciling the three flags with each other.** No inheritance, no "unset", no precedence order
  between the general and the per-title value (REQ-9). Whichever rule eventually reads them decides
  how they combine.

- **A UI for browsing what a title's owners collectively asked for.** Same as the pre-existing
  per-title preference: the merge is visible only in its effect on the encoded file, not surfaced
  anywhere in `web`.

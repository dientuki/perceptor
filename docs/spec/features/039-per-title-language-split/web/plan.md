---
title: Per-Title Audio/Subtitle Language Split — web slice
service: web
last_updated: 2026-09-02
status: Implemented
---

# PLAN: Per-Title Audio/Subtitle Language Split — `web` (`web/plan.md`)

## Scope

`web` replaces the single language picker on the movie and show detail pages with two panes and one
*Guardar*, and retypes the renamed GraphQL surface in its server actions and detail queries.

It also adds the `0.2.0` *Audio mandatory* checkbox to all three audio panes — the two per-title ones
and `/preferences`'s. That last one is the only reason this slice touches `PreferencesForm.tsx` at
all: its `downloadLanguages` tab is otherwise the *model* for this slice's layout, not a target of it,
and the two language pickers on it are untouched.

It does **not** touch `/settings`, and does not touch `021-user-preferences`'s stored language lists
or the installation `default_languages` setting (NFR-4). It does not decide anything about the encode merge — that is `api`'s, and its effect is
invisible in `web` by design (spec § Out of Scope).

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/preferences/PreferencesForm.tsx` | Modified | The audio pane gains the checkbox; its `Promise.all` gains a seventh action |
| `services/web/src/actions/preferences.ts` | Modified | `setAudioMandatoryAction`, twin of `setAllowCinemaReleasesAction`; `audioMandatory` in the `preferences` query |
| `services/web/src/types/preferences.ts` | Modified | `UserPreferences` gains `audioMandatory: boolean` |
| `services/web/src/components/media/TitleLanguagesForm.tsx` | New | Client component: two `LanguagePickerField` panes, one *Guardar*, one submit firing both mutations |
| `services/web/src/components/media/LanguagePicker.tsx` | Deleted | Zero call sites remain after this feature (see § Steps 5) |
| `services/web/src/actions/languages.ts` | Modified | The two mutations renamed, each taking a `kind`; bound per call site like `setPreferredTrackLanguagesAction` |
| `services/web/src/actions/movies.ts` | Modified | `Movie` type and detail query: `preferredLanguages` → `audioLanguages` + `subtitleLanguages` |
| `services/web/src/actions/shows.ts` | Modified | Same, for `Show` |
| `services/web/src/components/movies/Movie.tsx` | Modified | Renders `TitleLanguagesForm` instead of `LanguagePicker` |
| `services/web/src/components/shows/Show.tsx` | Modified | Same; stays a Server Component with the form as a client child |
| `services/web/messages/en.json`, `messages/es.json` | Modified | `media.languagePicker` gains `audioLabel`/`subtitleLabel` and `audioMandatoryLabel` |
| `services/web/CLAUDE.md` | Modified | § "Language pickers: four call sites, one component" no longer describes reality |

## Existing code to reuse

- `services/web/src/components/preferences/LanguagePickerField.tsx` — the controlled, form-less,
  button-less pane. `TitleLanguagesForm` composes two of them and owns the submit. Do not copy it
  into `media/`, and do not add a `kind` prop to it: it is already agnostic.
- `services/web/src/components/preferences/PreferencesForm.tsx` — the exact submit shape to follow:
  one `useTransition`, a `FormData` per action with `tags` joined by commas, `Promise.all`, then a
  per-result revert to that field's own seed and a joined error list. Copy the *shape*, not the file.
- `services/web/src/actions/preferences.ts`'s `setPreferredTrackLanguagesAction` — the
  `(kind, prevState, formData)` server-action signature bound per call site. The two per-title
  actions become `(id, kind, prevState, formData)`, bound to both the id and the kind at the call
  site, exactly as `Movie.tsx` already binds the id today.
- `redirectIfUnauthenticated` + `translateGraphQLError` in `services/web/src/lib/` — already wired
  into both per-title actions; keep them. `error.auth.unauthenticated` never reaches the form's error
  area because the redirect intercepts it inside the action.
- `services/web/src/components/form/input/Checkbox.tsx` — the exact control `PreferencesForm.tsx`
  already uses for `allowCinemaReleases` (`id`/`checked`/`onChange`/`label`). Use it for the new flag
  in all three panes; do not build a second checkbox.
- `services/web/src/actions/preferences.ts`'s `setAllowCinemaReleasesAction` — a plain server function
  taking a `boolean`, not a `useActionState` form action, because a boolean has no invalid value. All
  three new flag actions copy that signature; the per-title pair takes `(id, mandatory)`.
- `services/web/src/components/ui/button/Button.tsx` — the *Guardar* button, `type="submit"` inside
  the form or a plain click handler; `Button` defaults to `type="button"`.
- `media.languagePicker`'s existing `save`/`saving`/`saved`/`chosenLabel` keys — reuse them; only the
  two pane labels are new.

## Steps

1. `src/actions/languages.ts`: rename `SET_MOVIE_PREFERRED_LANGUAGES_MUTATION` /
   `SET_SHOW_PREFERRED_LANGUAGES_MUTATION` to the new operation names, add `$kind:
   LanguageTrackKind!` to each document and pass it through. Rename the two exported actions to
   `setMoviePreferredTrackLanguagesAction` / `setShowPreferredTrackLanguagesAction` and give each a
   `kind: "AUDIO" | "SUBTITLE"` parameter after the id. Everything else in both functions — the
   comma-split of `tags`, the network-failure catch, the redirect and the error translation — stays.
2. `src/actions/movies.ts` and `src/actions/shows.ts`: replace `preferredLanguages` in both the TS
   type and the detail query's selection set with `audioLanguages { … }` and
   `subtitleLanguages { … }`, same subfields. Leave the **listing** queries alone — they deliberately
   select neither (`services/web/CLAUDE.md`), and selecting two field resolvers there would double an
   N+1 rather than create one.
3. New `src/components/media/TitleLanguagesForm.tsx` (`"use client"`): props `options: Language[]`,
   `audioSelected: Language[]`, `subtitleSelected: Language[]`, `audioMandatory: boolean`, one
   `action` per kind and one for the flag (all already bound to the title's id by the caller). The
   checkbox renders **inside** the audio pane, under its badge list, so it reads as part of the audio
   choice (REQ-8); the submit fires all three actions in one `Promise.all` and reverts each control
   only from its own prop. Two `LanguagePickerField`s in
   `grid-cols-1 lg:grid-cols-2`, one *Guardar*, one submit that fires both actions with `Promise.all`
   and reverts only the pane whose result carried an error. An untouched pane still submits its
   last-saved value — that is REQ-1's "changing one pane must not require touching the other", and it
   is why both mutations fire every time rather than only the dirty one.
4. `src/components/movies/Movie.tsx` and `src/components/shows/Show.tsx`: render
   `TitleLanguagesForm` with the two bound actions and the two selections. `Show.tsx` stays an
   `async` Server Component; the form is its client child, as `LanguagePicker` was. `Movie.tsx` keeps
   its `movies.detail.languagesTitle` heading above the form; `Show.tsx` keeps having none.
5. Delete `src/components/media/LanguagePicker.tsx`. After step 4 nothing imports it —
   `029-settings-screen-tabs` removed the Settings call site and `021-user-preferences` moved
   `/preferences` onto `LanguagePickerField`. Confirm with
   `grep -rn "media/LanguagePicker" services/web/src` returning nothing **before** deleting. If it
   returns a call site this plan did not anticipate, stop and report rather than adapting.
6. `/preferences`: add `audioMandatory` to the `preferences` query and the `UserPreferences` type,
   write `setAudioMandatoryAction(mandatory: boolean)` beside `setAllowCinemaReleasesAction` in
   `src/actions/preferences.ts`, and in `PreferencesForm.tsx` add one `useState` seeded from
   `preferences.audioMandatory`, the `Checkbox` inside the `downloadLanguages` tab's **audio**
   column, a seventh entry in the existing `Promise.all`, and its own revert branch in the error
   handling. Nothing else on that screen changes.
7. `messages/en.json` and `messages/es.json`: add `audioLabel` / `subtitleLabel` /
   `audioMandatoryLabel` under `media.languagePicker` — the last one shared by all three panes, which
   is why it lives there and not under `preferences.form`. Reuse the existing copy verbatim from `preferences.form` — `"Audio
   languages"` / `"Subtitle languages"` and `"Idiomas de audio"` / `"Idiomas de subtítulos"` — so the
   two screens read identically. Both locale files must carry all three keys, English and the
   existing Rioplatense register for `es`.
8. `services/web/CLAUDE.md`: rewrite § "Language pickers: four call sites, one component". It is
   already stale (it describes `/preferences` as two `LanguagePicker` instances in a
   `DownloadLanguagesCard` that no longer exists); after this feature `LanguagePicker` itself is gone
   and `LanguagePickerField` is the only picker, used by `/preferences` and both detail pages.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, read-only:

- Query, on the two detail queries only: `audioLanguages { id tag iso2 iso3 name }` and
  `subtitleLanguages { … }` on `Movie` and `Show`. Both are non-null lists — no `?? []` guard is
  owed, and `Show`'s current optional `preferredLanguages?` becomes two required fields.
- Mutations: `setMoviePreferredTrackLanguages(movieId: Int!, kind: LanguageTrackKind!, tags:
  [String!]!)` and `setShowPreferredTrackLanguages(showId: Int!, kind: LanguageTrackKind!, tags:
  [String!]!)`. `kind` is the GraphQL enum — send the bare `AUDIO`/`SUBTITLE` string as a variable,
  never quoted into the document.
- Every error condition, all already handled by the existing action bodies and worth re-checking
  after the rename: `error.language.unavailable` and `error.language.duplicate` (a bad tag list),
  `error.movie.notFound` / `error.show.notAvailable` (an unowned or missing title), and
  `error.auth.unauthenticated`, which `redirectIfUnauthenticated` turns into a `/login` redirect
  before it can reach the form. There is no codegen: an action that only handles the happy path
  compiles fine and fails on screen.
- `UserPreferences.audioMandatory`, `Movie.audioMandatory`, `Show.audioMandatory` — all
  `Boolean!`, never null, so no `?? false` guard is owed.
- `setAudioMandatory(mandatory: Boolean!)` returns the whole `UserPreferences`;
  `setMovieAudioMandatory(movieId: Int!, mandatory: Boolean!)` and
  `setShowAudioMandatory(showId: Int!, mandatory: Boolean!)` return a bare `Boolean!`. Reading the
  wrong one off the response is a runtime `undefined`, not a compile error.
- The three flag mutations have **no input-validation failure** — a boolean cannot be invalid. Their
  only errors are the unauthenticated redirect and, for the per-title pair, the same ownership refusal
  the language mutations raise.
- The old names are gone. A stale `preferredLanguages` selection or `setMoviePreferredLanguages`
  document compiles in `web` and fails at runtime against the new schema.

## Tests

`web` has no test suite (`services/web/CLAUDE.md` § "Tests: there are none"), and this slice does not
create one. `bin/npm web run build` plus the manual pass in `../plan.md` § Verification is the whole
proof. The one failure mode that would be silent — reverting the wrong control after a partial failure —
is defended by following `PreferencesForm.tsx`'s per-result revert literally, each control seeded from
its own prop, and by steps 3 and 6 of the manual pass. The `0.2.0` checkbox adds no new class of
failure: it is a third control in a submit shape that already handles six.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
```

0 typecheck errors and a build that exits 0. Plus:

```bash
grep -rn "LanguagePicker\b" services/web/src/components/movies/Movie.tsx services/web/src/components/shows/Show.tsx
grep -rn "preferredLanguages" services/web/src
```

Both return nothing (AC-1, and the rename left nothing behind).

---
title: Automatic Movie Acquisition — web slice
service: web
last_updated: 2026-09-26
status: Implemented
---

# PLAN: Automatic Movie Acquisition — `web` (`web/plan.md`)

## Scope

Two small things. First, three checkboxes in the **Movies** tab of `/preferences` — mark the
theatrical, digital and physical acquisition windows — saved with the rest of that form through one
new server action calling `setAcquisitionWindows`. Second, the `acquire_pending` → `acquire_movies`
rename, which reaches `web` in three places because the Settings form enumerates its boolean keys by
hand and the Scheduling tab's labels are keyed by task id.

This slice decides **nothing** about behaviour: which window opens when, what quality each accepts,
the fallback chain and the union across a film's owners are all resolved in `api` and never travel to
the browser. `web` sends three booleans and renders three labels. It does not touch `services/api` or
`services/worker`. Writes are confined to `services/web/` and this directory.

`SchedulingPanel.tsx` needs **no change**: it already resolves a task's label through
`t.has(\`tasks.${id}.label\`)` with a fallback, so a renamed id degrades to its raw id rather than
crashing — which is exactly why the message rename must not be forgotten (it fails quietly).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/preferences.ts` | Modified | `UserPreferences` gains the three booleans |
| `src/actions/preferences.ts` | Modified | The three fields added to `PREFERENCES_QUERY`, to the `getPreferences` fallback object and to every mutation's selection set that returns `UserPreferences`; new `setAcquisitionWindowsAction` |
| `src/components/preferences/PreferencesForm.tsx` | Modified | Three `Checkbox`es in the Movies panel, three state hooks, one more entry in the save `Promise.all` and its error/rollback handling |
| `src/actions/settings.ts` | Modified | `BOOLEAN_KEYS`: `schedule_acquire_pending_enabled` → `schedule_acquire_movies_enabled` |
| `messages/en.json` | Modified | `settings.scheduling.tasks`: `acquire_pending` → `acquire_movies` (new copy); `preferences.form`: three labels |
| `messages/es.json` | Modified | The same two, in the existing Rioplatense register |

## Existing code to reuse

- `src/components/preferences/PreferencesForm.tsx` — everything about how this form saves is already
  there: one `startTransition`, one `Promise.all` of independent server actions, and a per-result
  error branch that pushes the translated message and **rolls that one control back** to
  `preferences.<field>`. Follow it exactly, including the rollback; a control that keeps a value the
  server rejected is the silent half of this screen.
- The `audio-mandatory` `Checkbox` in the Download-languages panel — the pattern for a plain boolean
  (controlled, `checked` + `onChange`). Use `Checkbox`, not the `Switch` that `allowCinemaReleases`
  uses: three related marks read as a checklist, and `Switch` needs the `key={...}` remount hack
  because it is `defaultChecked`.
- `setAllowCinemaReleasesAction` in `src/actions/preferences.ts` — the shape for the new action: one
  mutation, `redirectToClearSession` on an auth error, `translateGraphQLError` otherwise, returning
  `{error}` or the fresh `UserPreferences`.
- The Movies panel's existing `showMoviesTab` gate — the three checkboxes live inside it, and the new
  action is fired **conditionally on `showMoviesTab`** exactly as `setPreferredTorrentGroupsAction
  ("MOVIE", …)` already is. A film-only preference has no meaning on an installation with films
  disabled (`045`).

## Steps

1. Add the three booleans to `src/types/preferences.ts` and to every `UserPreferences` selection set in
   `src/actions/preferences.ts` — the query **and** each mutation that returns the type, so a save
   never hands the form back a partial object. Add them to `getPreferences`' `?? {}` fallback as
   `false`.
2. Add `setAcquisitionWindowsAction(theatrical, digital, physical)`, modelled on
   `setAllowCinemaReleasesAction`.
3. In `PreferencesForm.tsx`: three `useState`s seeded from `preferences`, three `Checkbox`es in the
   Movies panel under the cinema `Switch` and above the torrent-group picker, one entry in the
   `Promise.all` (gated on `showMoviesTab`, `Promise.resolve(null)` otherwise), and one error branch
   that rolls all three back together — they are saved by one mutation, so they fail as one.
4. Rename the key in `src/actions/settings.ts`'s `BOOLEAN_KEYS`. There is nothing else to change there:
   the cron field is not user-editable and `EDITABLE_KEYS` never carried a `schedule_*` key.
5. Rename `settings.scheduling.tasks.acquire_pending` to `acquire_movies` in both catalogs and rewrite
   its copy — it no longer means "titles that still have none" but specifically films whose release
   window has opened. Suggested `en`: label *"Acquire movies"*, description *"Searches for and
   downloads a release for films whose release window has opened."*; `es`: *"Bajar películas"* /
   *"Busca y descarga un release para las películas cuya ventana de estreno ya abrió."*
6. Add the three `preferences.form` labels to both catalogs. Each must name the day the window opens
   and the quality it accepts, and the theatrical one must say it does nothing while cinema releases
   are not allowed (REQ-16). Suggested `en`: *"Acquire from 2 days after the theatrical release (any
   quality — requires allowing cinema releases)"*, *"Acquire from 1 day after the digital release
   (WEB-DL or better)"*, *"Acquire from 5 days after the physical release (UHD or remux)"*. Keep the
   `es` wording in the existing register.
7. `bin/cli web node scripts/check-messages.mjs` — no `en`/`es` drift. A renamed key in one catalog and
   not the other is the classic silent failure here.

## Contract obligations

Consumed, from `../spec.md` § GraphQL Contract Delta and read-only:

```graphql
setAcquisitionWindows(theatrical: Boolean!, digital: Boolean!, physical: Boolean!): UserPreferences!
```

plus `acquireTheatrical`, `acquireDigital`, `acquirePhysical` on `UserPreferences`. All three
arguments are required — there is no partial update, and `web` must always send the full triple as the
form holds it.

Error conditions and what this slice does with each:

| Condition | Key | `web`'s behaviour |
| :-- | :-- | :-- |
| Non-user (service) principal | `error.auth.unauthenticated` | `redirectToClearSession`, as every other preferences action does |
| Any other keyed failure | whatever `api` sends | `translateGraphQLError` into the form's existing error list, and roll the three checkboxes back to `preferences.*` |

There is deliberately **no** error for marking theatrical while `allowCinemaReleases` is off (REQ-17):
it saves, and the label is what explains it. Do not add client-side validation that blocks it, and do
not auto-uncheck it when the cinema switch is turned off — a user who re-enables cinema releases must
find their mark still there.

## Tests

`web` has no test suite (`services/web/CLAUDE.md`), so none are added. Nothing in this slice can fail
silently in a way a test would catch: a missing field in a selection set surfaces as `undefined` in the
checkbox on first render, a wrong mutation name is a GraphQL error in the form's error list, and the
one genuinely quiet failure — a message key renamed in `en` and not `es` — is covered by
`scripts/check-messages.mjs`, which is in § Done when. The typecheck covers the rest.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
git diff --stat services/api services/worker
```

`tsc` reports 0 errors, the build exits 0, `check-messages` reports no drift, and the last command is
**empty** — this slice writes only inside `services/web/`.

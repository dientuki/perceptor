---
title: Per-Title Audio/Subtitle Language Split — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-09-02
status: Implemented
---

# PLAN: Per-Title Audio/Subtitle Language Split (`plan.md`)

## Approach

Three existing seams change shape; nothing new is invented at any of them.

**Storage.** `UserMovieLanguage`/`UserShowLanguage` gain a `kind` column and extend their composite
primary key, exactly the shape `UserLanguagePreference` already has since `021-user-preferences`
(`services/api/prisma/schema.prisma`). `LanguagesService`
(`services/api/src/languages/languages.service.ts`) already holds the proven per-kind write —
`setPreferredTrackLanguagesFor`, whose `deleteMany` is narrowed to `{ userId, kind }`. The two
per-title writers become that same method with a title id added; no fourth write shape appears in
this service.

**The encode merge.** `ProcessJobsService.collectAllowedLanguages`
(`services/api/src/process-jobs/process-jobs.service.ts`) stays **one walk**, now filling four Sets
instead of two. This is the point `030-language-regional-variants` already argued in that method's
own comment: two separate merges drift, and a drift between the iso3 list and the tag list mismatches
on the wire with no error anywhere. The same argument now covers the audio-vs-subtitle pair — the
original language and `default_languages` contribute to both, so computing them twice is two chances
to disagree. Only the owner loop branches, on `titlePref.kind`.

The rejected alternative was `mergeAllowedLanguages(kind)` called twice. It reads cleaner in
isolation and is wrong here: it re-resolves `default_languages` and the original language per call,
doubling both the setting read and the chance of divergence.

**The worker.** `EncodeInput` (`services/worker/src/encode/types.ts`) and `EncodeJobDetails`
(`services/worker/src/jobs/encode.job.ts`) carry four list fields instead of two, and
`buildFfmpegCommand` (`services/worker/src/ffmpeg/buildCommand.ts`) hands the audio pair to
`getAudioParams` and the subtitle pair to `getSubtitleParams`. **`params.ts` is not touched**: both
functions already take their allow-list as parameters, so the split is entirely a change of what the
caller passes. The rules, their signatures and their REQ numbering are untouched (REQ-6/REQ-7).

**The UI.** `web` gets one new client component, `src/components/media/TitleLanguagesForm.tsx`,
composing two existing `LanguagePickerField`s (`src/components/preferences/LanguagePickerField.tsx`)
under one *Guardar* — the same two-pane layout and the same "fire both, revert only the failed one,
join the error messages" submit `PreferencesForm.tsx` established for `/preferences`. It is a second
use of that shape, not a third variant of it.

**The flag (`0.2.0`).** *Audio mandatory* is one boolean per audio-selection scope, and each one goes
on the row that already means that scope: `users` (beside `allowCinemaReleases`, which
`021-user-preferences` put there for exactly this kind of value) and the two ownership joins
`user_movies`/`user_shows`. Not on `UserMovieLanguage`/`UserShowLanguage` — those are one row *per
chosen language*, so a flag there would be stored N times and could disagree with itself, silently,
the first time a write updated some rows and not others. Not in a new table either: one boolean does
not earn a join, and on the ownership row it inherits the cascade that already cleans up when a title
leaves a user's library.

Its three mutations are siblings of `setAllowCinemaReleases`
(`services/api/src/preferences/preferences.resolver.ts`), down to the "a boolean has no invalid
value" reasoning that makes them plain server functions in `web` rather than form actions. They are
deliberately **not** an extra argument on the three `setPreferredTrackLanguages*` mutations: those
carry a `kind`, and the flag means nothing for `SUBTITLE` — an argument that is a silent no-op on half
its calls is a contract that teaches the next reader the wrong thing.

Nothing reads the flag (REQ-11). That is the whole point and it is the thing most likely to be
"fixed" by a well-meaning implementer — see § Contract Freeze.

Consequence worth naming up front: once `Movie.tsx` and `Show.tsx` move to the new form,
`src/components/media/LanguagePicker.tsx` has **zero remaining call sites** — `/settings` lost its
language picker in `029-settings-screen-tabs` and `/preferences` uses `LanguagePickerField`. Article X
says delete it, and this plan does (see `web/plan.md`).

## Order of Work

`api` first and alone. It owns the migration, the schema and every name the other two retype by hand;
there is no codegen, so `web` and `worker` have nothing to typecheck against until the decorators
land.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the Prisma migration, the `LanguagesService` write shape and the four `EncodeJobDetails` fields both consumers retype |
| 2 | `web` | Cannot query `audioLanguages`/`subtitleLanguages` or call the renamed mutations before the schema has them |
| 2 | `worker` | Cannot select the four new `EncodeJobDetails` fields before the schema has them |

The `0.2.0` flag does not change this ordering: it is more `api` surface in step 1 and more `web` in
step 2, and **no `worker` work at all** (REQ-11).

Steps 2 run **in parallel** — `web` and `worker` share no file and no runtime path in this feature —
but only after step 1 is merged and `api` boots with the regenerated `src/schema.gql`. Before that,
"parallel" means each service guessing at a schema that does not exist yet.

Inside step 2, `worker` splits across **two agents**: `services/worker/src/ffmpeg/` and
`services/worker/ffmpeg/` belong to the `ffmpeg` agent (`.claude/agents/ffmpeg.md`), not the `worker`
agent, which is forbidden from editing them. `buildCommand.ts`, `buildCommand.spec.ts`,
`cases.spec.ts` and the two corpus JSONs are `ffmpeg` work; `jobs/encode.job.ts`, `encode/types.ts`
and `jobs/encode.job.spec.ts` are `worker` work. They must be sequenced ffmpeg-after-worker or land
together — `EncodeInput` is what `buildCommand.ts` reads.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Three things an
implementer will be tempted to change and must not:

- **The old fields and mutations are removed, not deprecated.** `Movie.preferredLanguages`,
  `Show.preferredLanguages`, `setMoviePreferredLanguages`, `setShowPreferredLanguages`,
  `EncodeJobDetails.allowedLanguagesIso3` and `allowedLanguageTags` disappear in the same slice
  (REQ-3, NFR-2). Keeping one "so the other service keeps compiling" is exactly the dual-write this
  repo refuses — and it would compile in both services while shipping a stale list to FFmpeg.
- **`default_languages` and `021`'s `UserLanguagePreference` are not part of this feature** (NFR-4).
  The installation default still feeds **both** allow-lists, unsplit. From inside `api` it will look
  like an obvious omission that the general per-user preference — already split by kind — contributes
  nothing to the merge. That is `021`'s stated boundary, deliberately kept (spec § Out of Scope).
- **The `audioMandatory` flag is inert, and that is not an oversight** (REQ-11, AC-14). It is stored,
  it is rendered, and it is read by nothing. From inside `api` it will look like an obvious miss that
  the merge ignores it; from inside `worker` it will look like a field someone forgot to add to
  `EncodeJobDetails`. Wiring it into either is out of scope and would reopen `getAudioParams`, which
  REQ-6 freezes. The rule that consults it is a future spec.

- **`getAudioParams`/`getSubtitleParams` keep their signatures and their rules** (REQ-6/REQ-7).
  `originalLanguageIso3` stays a field of its own and stays mandatory for audio. The split changes
  which list arrives, never what is done with it.

If the delta turns out wrong: stop, amend `spec.md`, re-approve, re-brief all three services. Never
patch it from inside one slice (Constitution, Article VIII).

## Migrations

Owned by `api`, generated through `bin/npm api run prisma:migrate` (never hand-written).

1. `add_title_language_kind` — on `user_movie_languages` and `user_show_languages`:
   `ADD COLUMN kind ENUM('AUDIO','SUBTITLE') NOT NULL DEFAULT 'AUDIO'`, then
   `DROP PRIMARY KEY, ADD PRIMARY KEY (userId, movieId, languageId, kind)` (resp. `showId`). The
   **same** migration adds `audioMandatory BOOLEAN NOT NULL DEFAULT false` to `users`, `user_movies`
   and `user_shows` (REQ-9) — one migration for the feature, generated in one
   `bin/npm api run prisma:migrate` run after both schema edits are in place, not two migrations
   against adjacent tables.
2. Backfill: **none needed as a separate statement** — the column default is the backfill. Every
   pre-existing row becomes `AUDIO`, which is NFR-1's decision. Verify with
   `bin/mysql -e "select kind, count(*) from user_movie_languages group by kind"` — every row `AUDIO`
   immediately after the migration.

The schema keeps `@default(AUDIO)` on the column even though `021`'s `UserLanguagePreference.kind`
has none: the default is what makes the `ALTER` safe on a non-empty table. Every write in
`LanguagesService` still passes `kind` explicitly — the default is a migration device, never a code
path.

The three boolean columns need no backfill statement either — `DEFAULT false` is the whole story, and
`false` is what every existing row should mean.

Reversibility: the migration is reversible in shape (drop the column, restore the three-column key)
but **lossy in content** — dropping `kind` collapses a user's audio and subtitle sets back into one
list, and a title with the same language on only one side silently gains it on both. Rolling back
means re-running `bin/dbreset` in dev, not un-applying.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `deleteMany` left at `{ userId, movieId }` | Saving audio wipes that title's subtitle set. No error; the mutation returns the audio list it was asked for and looks correct | NFR-3's fault-injection test in `languages.service.spec.ts`, extending the table that already covers the two per-title writers; AC-3's live `group by kind` count |
| `buildCommand.ts` passes the audio pair to `getSubtitleParams` | Both pairs are `string[]` — the swap compiles, FFmpeg exits 0, the file lands with the wrong subtitle tracks and nobody finds out until somebody watches it | `buildCommand.spec.ts` case with **disjoint** audio and subtitle lists, asserting each list reaches only its own arguments — an equal-list fixture would pass under the swap |
| A field name missed in one of `worker`'s three hand-retyped places (the query string in `encode.job.ts`, its `EncodeJobDetails` type, `encode/types.ts`'s `EncodeInput`) | The `…Iso3` lists crash loudly on `.map`, but the `…Tags` lists are normalized with `?? []` — a missed tag field silently drops every regional-variant preference from every encode | The `[encode] <id>:` log line prints all four lists; `encode.job.spec.ts`'s existing payload-seam suite extends to the four names |
| The merge filters the original language or `default_languages` by `kind` | The subtitle list loses the installation default for every title; no error, encodes just keep fewer subtitles than before | AC-8's regression assertion: with no per-title preference, both lists equal today's single list |
| Existing rows silently become `AUDIO` | A user who had asked for Spanish subtitles on one film now has Spanish audio and no Spanish subtitles there | Accepted and stated (NFR-1). Dev-only environment; `bin/dbreset` is the alternative |
| The flag gets wired into something | An implementer "completes" the feature by adding it to the merge or to `EncodeJobDetails`. Nothing fails — the encode just starts behaving in a way no spec describes | AC-14's `grep -rn "audioMandatory" services/worker/` returning nothing, and the Contract Freeze bullet above |
| The flag stored per language row instead of per scope | N rows carrying one logical value; a partial write leaves them disagreeing and whichever row is read first wins, with no error | Settled in the schema: the column lives on `users`/`user_movies`/`user_shows` (§ Approach). A plan that puts it on `UserMovieLanguage` is the bug |
| A third mutation in the same submit fails alone | The user sees "saved" for languages and a silently reverted checkbox, or the reverse | The flag is one more entry in the same `Promise.all` + per-result revert `PreferencesForm.tsx` already runs; AC-13 checks both directions |
| `web` reverts the wrong pane on a partial failure | The user sees an error and a pane that quietly reverted a selection they did not touch | Follow `PreferencesForm.tsx` exactly — each result reverts only its own `useState` from its own `preferences.*` seed |

## Verification

```bash
bin/npm api run prisma:migrate
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/mysql -e "select kind, count(*) from user_movie_languages group by kind"
```

Manual pass, in order:

1. Open a film's detail page. Two panes — *Audio languages*, *Subtitle languages* — side by side,
   one *Guardar* (AC-1).
2. Pick two audio languages and one subtitle language, press *Guardar* once, reload: the split
   survives (AC-2). Confirm through the api with
   `movie(id:) { audioLanguages { tag } subtitleLanguages { tag } }`.
3. Change only the audio pane, save, and re-run the `group by kind` query above: the `SUBTITLE`
   count is unchanged (AC-3).
4. Repeat 1–3 on a series (AC-4).
5. Call `setMoviePreferredTrackLanguages` with an unknown tag, then with a duplicated tag, then with
   `SERVICE_TOKEN` as bearer — `error.language.unavailable`, `error.language.duplicate`,
   `error.auth.unauthenticated`, and the stored set unchanged each time (AC-5, AC-6, AC-7).
6. Tick *Audio mandatory* on the film, save once, reload — still ticked (AC-11). Confirm the other two
   scopes are untouched with
   `bin/mysql -e 'select movieId, audioMandatory from user_movies where userId = "<id>"'` and the
   `users` row (AC-12). Then tick it **without** touching either language pane, save, and re-run the
   `group by kind` query — unchanged (AC-13).
7. `grep -rn "audioMandatory" services/worker/` returns nothing (AC-14).
8. Query `processJob(id:)` for a title with no per-title preference: the audio and subtitle lists are
   identical (AC-8). Add an audio-only `fr` preference, re-query: `fre` is in the audio list and not
   in the subtitle list (AC-9). Nothing on this payload mentions `audioMandatory` (AC-14).

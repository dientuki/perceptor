---
title: Per-Title Audio/Subtitle Language Split — Tasks
last_updated: 2026-09-02
status: Done
---

# TASKS: Per-Title Audio/Subtitle Language Split (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[ffmpeg]` | The fifth agent (`.claude/agents/ffmpeg.md`). It owns `services/worker/src/ffmpeg/` and `services/worker/ffmpeg/` — the track-selection rules and the case corpus — which the `worker` agent is explicitly forbidden to write in. Same reason `031-worker-language-variants` used this tag: the tag is the dispatch address, so it has to name the real owner. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**Amended for `spec.md` `0.2.0`** — the *Audio mandatory* checkbox. It widens T001's migration, adds
T004a (`api`) and T006a (`web`), and adds nothing to `worker` or `ffmpeg`: the flag is inert by
requirement (REQ-11), which T013 verifies rather than assumes.

**No `[infra]` task exists in this feature**, and that is deliberate rather than an omission: nothing
about how the stack boots changes. No container, image, `bin/` wrapper or `.env` name is touched.

**The `CLAUDE.md` steps written into the three service plans are executed here as `[docs]` tasks**
(T010, T011), not by the service agents. The plans list them so each agent knows the doc exists and
what in it goes stale; the orchestrator owns prose. A service agent that edits its own `CLAUDE.md`
anyway is not wrong, but T010 is what verifies it happened.

## Tasks

### Group 1 — schema, storage and contract

Everything downstream retypes names produced here by hand. There is no codegen between `api` and its
two consumers, so a name that differs by a character compiles everywhere and fails at runtime.

- [x] **T001** `[api]` Both schema edits, then **one** migration. (a) Add
      `kind LanguageTrackKind @default(AUDIO)` to `UserMovieLanguage` and `UserShowLanguage` in
      `services/api/prisma/schema.prisma`, extending each `@@id` to
      `[userId, movieId, languageId, kind]` / `[userId, showId, languageId, kind]`. (b) Add
      `audioMandatory Boolean @default(false)` to `User` (beside `allowCinemaReleases`), `UserMovie`
      and `UserShow` — on the ownership rows, **not** on `UserMovieLanguage`/`UserShowLanguage`,
      which are one row per chosen language (`plan.md` § Approach). Only then generate through
      `bin/npm api run prisma:migrate`, named `add_title_language_kind` — never hand-written SQL
      (Constitution, Article III). Read the generated SQL before moving on: it must add `kind` with
      `DEFAULT 'AUDIO'`, rewrite both primary keys, and add the three booleans with `DEFAULT false`.
      *Done when:* `git status services/api/prisma/` shows both a modified `schema.prisma` and a
      single new migration directory, and
      `bin/mysql -e "select kind, count(*) from user_movie_languages group by kind"` returns every
      pre-existing row as `AUDIO` (**NFR-1**) while
      `bin/mysql -e "select audioMandatory, count(*) from user_movies group by audioMandatory"`
      returns every row as `0` (**REQ-9**).

- [x] **T002** `[api]` Give the four per-title methods in
      `services/api/src/languages/languages.service.ts` a `kind: LanguageTrackKind` parameter and
      rename them to `set…PreferredTrackLanguagesFor`/`find…PreferredTrackLanguagesFor`, mirroring
      the existing `setPreferredTrackLanguagesFor` exactly: `deleteMany` narrowed to
      `{ userId, movieId, kind }` / `{ userId, showId, kind }`, `kind` on every `createMany` row and
      on both read `where` clauses, all still inside the one `$transaction`, all still behind
      `validateAndResolveLanguageIds`. Thread `kind` through the existing per-title `targets` table
      in `languages.service.spec.ts` and add one fault-injection case per table, in the shape of the
      `setPreferredTrackLanguagesFor` case already at line 148. → T001
      *Done when:* `bin/npm api test -- languages.service.spec.ts` is green, and widening either
      `deleteMany` `where` back to drop `kind` makes exactly the new cases fail — verify by actually
      doing it and restoring it, and say so in the `it` string (**NFR-3**).

- [x] **T003** `[api]` Replace `preferredLanguages` with `audioLanguages` + `subtitleLanguages` on
      `movies/entities/movies.entity.ts` and `shows/entities/show.entity.ts`; in
      `movies.resolver.ts` and `shows.resolver.ts` replace the single `@ResolveField` with two (one
      per kind) and rename the mutation to `setMoviePreferredTrackLanguages` /
      `setShowPreferredTrackLanguages`, taking `kind: LanguageTrackKind!` between the id and `tags`.
      Import the enum from `preferences/entities/language-track-kind.enum.ts` — **never**
      `registerEnumType` a second time. The ownership check and its existing
      `MOVIE_NOT_FOUND`/`SHOW_NOT_AVAILABLE` throw move over verbatim, and neither mutation gains
      `@AllowService()` (**REQ-4**). → T002
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean and the regenerated
      `services/api/src/schema.gql` matches `spec.md` § GraphQL Contract Delta exactly — the four new
      fields and two new mutations present, and
      `grep -n "preferredLanguages\|setMoviePreferredLanguages\|setShowPreferredLanguages" services/api/src/schema.gql`
      returning nothing (**REQ-3**, **NFR-2**).

- [x] **T004** `[api] [P]` Split the encode merge. `process-jobs/entities/encode-job-details.entity.ts`
      carries the four fields from the contract delta instead of two; `process-jobs.service.ts` adds
      `kind` to the `languages` select in both merge methods and turns `collectAllowedLanguages` into
      **one walk over four Sets** — original language and every `default_languages` entry seed both
      pairs, each owner preference seeds only its own kind (**REQ-5**, **NFR-4**). Both
      `getEncodeJobDetails` branches spread the four fields. Add `kind` to the `owner` fixture in
      `process-jobs.service.spec.ts`, move the existing merge assertions onto the audio pair, and add
      the two new cases named under § Tests in `api/plan.md`. → T001
      *Done when:* `bin/npm api test -- process-jobs.service.spec.ts` is green with a case proving
      **AC-8** (no per-title preference of either kind → both pairs identical, and identical to
      today's single list) and one proving **AC-9** (an audio-only `fr` → `fre` in the audio pair,
      absent from the subtitle pair). Do not write these two merges as two walks — see
      `plan.md` § Approach.

- [x] **T004a** `[api] [P]` The *Audio mandatory* flag, all three scopes, as one task — it is one
      column read and written three times and splitting it would scatter an obvious pattern.
      Per-user: `UsersService.setAudioMandatory` (twin of `setAllowCinemaReleases`, line 221),
      `audioMandatory` on the `UserPreferences` entity, read in `PreferencesService.findForUser`'s
      existing `Promise.all`, written by `PreferencesService.setAudioMandatory`, exposed as
      `setAudioMandatory(mandatory: Boolean!): UserPreferences!` with that resolver's usual non-user
      principal rejection. Per-title: an `audioMandatory` `@ResolveField(() => Boolean)` on each of
      the movie and show resolvers reading the caller's ownership row through a new
      `MoviesService`/`ShowsService` method, plus `setMovieAudioMandatory(movieId, mandatory)` /
      `setShowAudioMandatory(showId, mandatory)` returning `Boolean!`, each reusing the **same**
      `findOneFromDb` null-check and throw as the language mutation beside it (**REQ-10**). The write
      is an `update`, not an `upsert` — a row that passed the check exists. **Nothing about this flag
      goes near `process-jobs/`** (**REQ-11**). → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean, the regenerated `schema.gql` carries
      the three fields and three mutations exactly as `spec.md` § GraphQL Contract Delta writes them,
      and `grep -n "audioMandatory" services/api/src/process-jobs/` returns nothing. No new test is
      owed here — see `api/plan.md` § Tests for why, and do not add a `toBeDefined()` one.

### Group 2 — consumers

Everything here depends on Group 1: the schema must exist before anyone retypes it. `web` and
`worker` share no file in this feature and genuinely overlap.

- [x] **T005** `[web] [P]` Retype the renamed surface in `services/web/src/actions/`: rename both
      documents and both exported actions in `languages.ts` to `set…PreferredTrackLanguagesAction`,
      adding `$kind: LanguageTrackKind!` to each and a `kind` parameter after the id (the
      `(id, kind, prevState, formData)` shape `setPreferredTrackLanguagesAction` already
      established); swap `preferredLanguages` for `audioLanguages`/`subtitleLanguages` in the `Movie`
      and `Show` types and in the two **detail** queries in `movies.ts`/`shows.ts`, adding
      `audioMandatory` to both alongside them. Leave the listing queries selecting none of the three.
      Add `setMovieAudioMandatoryAction(movieId, mandatory)` and its show twin to `languages.ts` —
      plain server functions taking a boolean, reading `Boolean!` off the response, not
      `UserPreferences`. → T003, T004a
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports only the errors in
      `Movie.tsx`/`Show.tsx` that T006 closes, and `grep -rn "preferredLanguages" services/web/src/actions`
      returns nothing.

- [x] **T006** `[web]` The two-pane UI. New `src/components/media/TitleLanguagesForm.tsx` — two
      `LanguagePickerField`s side by side under one *Guardar*, submitting both mutations with
      `Promise.all` and reverting **only** the pane whose result carried an error, each seeded from
      its own prop (the `PreferencesForm.tsx` shape, copied as a shape, not as a file). `Movie.tsx`
      and `Show.tsx` render it with the two bound actions; `Show.tsx` stays a Server Component.
      The audio pane also carries the *Audio mandatory* `Checkbox`, under its badge list, saved by
      the same submit as a third action (**REQ-8**). Add `audioLabel`/`subtitleLabel`/
      `audioMandatoryLabel` under `media.languagePicker` in **both** `messages/en.json` and
      `messages/es.json` — the first two reused verbatim from `preferences.form`, and
      `audioMandatoryLabel` shared by all three panes, which is why it lives in that namespace. Then delete
      `src/components/media/LanguagePicker.tsx` — but run
      `grep -rn "media/LanguagePicker" services/web/src` first, and if it names a call site this
      feature did not anticipate, **stop and report** instead of adapting. → T005, T004a
      *Done when:* `bin/cli web npx --no tsc --noEmit` is clean, `bin/npm web run build` exits 0, and
      both `grep -rn "LanguagePicker\b" services/web/src/components/movies/Movie.tsx` and
      `grep -rn "preferredLanguages" services/web/src` return nothing (**AC-1**).

- [x] **T006a** `[web] [P]` The checkbox on `/preferences`. Add `audioMandatory` to the `preferences`
      query and to `UserPreferences` in `src/types/preferences.ts`; write `setAudioMandatoryAction`
      beside `setAllowCinemaReleasesAction` in `src/actions/preferences.ts` — same plain-server-function
      signature, since a boolean has no invalid value; in `PreferencesForm.tsx` add one `useState`
      seeded from `preferences.audioMandatory`, the existing `Checkbox` control inside the
      `downloadLanguages` tab's **audio** column, a seventh entry in the `Promise.all`, and its own
      revert branch. The two `LanguagePickerField`s on that tab are not touched. → T003
      *Done when:* `bin/npm web run build` exits 0 and, on `/preferences`, ticking *Audio mandatory*
      and pressing *Guardar* once survives a reload while `allowCinemaReleases` and both language
      lists are unchanged.

- [x] **T007** `[worker] [P]` The payload seam, as one task — the four new names in **three**
      hand-retyped places, and three of the three done without the fourth is the feature silently
      doing nothing (`plan.md` § Risks): `src/encode/types.ts`'s `EncodeInput`, and in
      `src/jobs/encode.job.ts` both the local `EncodeJobDetails` type and the `processJob { … }`
      selection set. Update the `[encode] <id>:` log line to print all four lists and both driver
      call sites to pass them, with `?? []` on the two **tag** lists only — the two iso3 lists stay
      undefended so a missing one fails loudly. Extend the existing "allowedLanguageTags payload
      seam" suite in `encode.job.spec.ts` to all four names, keeping its degrades-to-`[]` case for
      both tag fields. → T004
      *Done when:* `bin/npm worker test -- src/jobs/encode.job.spec.ts` is green. `tsc --noEmit` is
      expected to be **red** on `src/ffmpeg/`'s fixtures until T008 — report it as such, and do not
      make a field optional or keep an old name to silence it.

- [x] **T008** `[ffmpeg]` Route each pair to its own rule function: `src/ffmpeg/buildCommand.ts`
      passes the audio pair to `getAudioParams` (with `originalLanguageIso3` keeping its position)
      and the subtitle pair to `getSubtitleParams`. `cases.spec.ts`'s `CaseInput`/`validate()` take
      the four names — the two iso3 lists required, the two tag lists optional and defaulted to `[]`
      — and `ffmpeg/1.json` / `ffmpeg/2.json` have their input keys renamed to match, no
      compatibility fallback. Update `buildCommand.spec.ts`'s fixtures and add the **disjoint-list**
      case: audio `['jpn','eng']` / subtitle `['spa']`, asserting each list reaches only its own
      arguments. **`src/ffmpeg/params.ts` is not touched** — no rule changes in this feature
      (**REQ-6**, **REQ-7**); if a step seems to need it, stop and report. → T007
      *Done when:* `bin/cli worker npx --no tsc --noEmit` is clean — this is the task that closes the
      red window T007 opened — `bin/npm worker test` is green, and the two corpus cases produce
      **byte-identical** expected argument arrays to before the feature. The disjoint case must fail
      if the two `getAudioParams`/`getSubtitleParams` argument pairs are swapped; verify by swapping
      them and restoring.

### Group 3 — verification and docs

- [x] **T009** `[docs] [P]` Update `docs/spec/graphql-contract.md`: the `Movie`/`Show`/`Mutation`/
      `EncodeJobDetails` blocks around lines 400–420, the paragraph claiming
      `Movie.preferredLanguages`/`Show.preferredLanguages` resolve to one list per title, and the two
      long sections on `allowedLanguagesIso3`/`allowedLanguageTags` — both now exist per kind, and
      the sentence deferring the split to a follow-up spec is what this feature closed. Say plainly
      what did **not** change: `default_languages` still feeds both allow-lists unsplit, and `021`'s
      general per-user preference is still read by nothing at encode time. Document the three
      `audioMandatory` fields and three mutations in the same section, stating plainly that nothing
      reads the flag and that `EncodeJobDetails` deliberately does not carry it (**REQ-11**) — a
      boundary document that leaves that unsaid is how the next agent "completes" it. → T006, T006a, T008

- [x] **T010** `[docs] [P]` Update the four `CLAUDE.md` files: `services/api/CLAUDE.md`
      (`languages/`, `process-jobs/`), `services/web/CLAUDE.md` § "Language pickers: four call sites,
      one component" — already stale about `/preferences` before this feature, and now describing a
      component that no longer exists — `services/worker/CLAUDE.md` § "Audio/subtitle/quality rules
      read a resolved list, never guess", and the root `CLAUDE.md` § Current state with the counts
      T011 measures. **No pipeline stage changes status** in the root table; Transcode was already
      working and only what feeds its language rule changed. `services/web/CLAUDE.md` § "Two per-user
      settings screens" also gains the checkbox, and `services/api/CLAUDE.md` the flag's three
      scopes. → T006, T006a, T008

- [x] **T011** `[docs]` Walk the acceptance criteria in `spec.md`, tick each box against real output,
      and set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md`, `web/plan.md` and
      `worker/plan.md`. The unit-level criteria (**AC-8**, **AC-9**) are already proven by T004; the
      rest need the running stack, in `plan.md` § Verification's order: the two-pane page and one
      *Guardar* (**AC-1**), the split surviving a reload (**AC-2**), the `group by kind` count
      unchanged after an audio-only save (**AC-3**), both again for a series (**AC-4**), the three
      refusals — unknown tag, duplicated tag, `SERVICE_TOKEN` bearer — each leaving the stored set
      unchanged (**AC-5**, **AC-6**, **AC-7**), and the full command sweep (**AC-10**):
      `bin/cli api npx --no tsc --noEmit`, `bin/cli web npx --no tsc --noEmit`,
      `bin/cli worker npx --no tsc --noEmit`, `bin/npm api test`, `bin/npm worker test`,
      `bin/npm web run build`.

      Then the `0.2.0` criteria: the checkbox present on all three audio panes and surviving a reload
      on a film (**AC-11**); the three scopes independent, via
      `bin/mysql -e 'select movieId, audioMandatory from user_movies where userId = "<id>"'` and the
      `users` row (**AC-12**); ticking the box alone leaving both stored language sets byte-identical
      and changing only the subtitle pane leaving the flag alone (**AC-13**); and
      `grep -rn "audioMandatory" services/worker/` returning nothing (**AC-14**). → T009, T010

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems land here (Constitution, Article VIII): an agent that finds the GraphQL delta
wrong stops and reports rather than adapting it inside its own slice. So does a corpus conflict in
T008 — if a case's expected arguments change, the split is not the no-op this feature claims to be
for a title with no per-kind preference, and that is a finding, not a file to edit.

---
title: Language Regional Variants — Tasks
last_updated: 2026-08-28
status: Draft
---

# TASKS: Language Regional Variants (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[worker]` or `[infra]` task exists in this feature, and that is load-bearing rather than an
oversight: NFR-4 requires `services/worker/` to come out of this unchanged, and T018 verifies it.

## Tasks

### Group 1 — schema, seed and the frozen contract

Every task here is `[api]`. `web` cannot begin until this group is complete — see Group 2's note.

- [ ] **T001** `[api]` In `services/api/prisma/schema.prisma`, add `tag String @unique` to
      `Language` and remove `@unique` from `iso2`. Generate the migration **without applying it**:
      `bin/npm api run prisma:migrate -- --create-only`. Do not add a default to `tag` to make a
      plain apply succeed — see `plan.md` § Migrations.
      *Done when:* a new directory exists under `prisma/migrations/`, and its `migration.sql` both
      adds the `tag` column and drops the unique index on `iso2`.

- [ ] **T002** `[api]` Rewrite `services/api/prisma/seeds/languages.ts`: every existing row gains a
      `tag` equal to its `iso2`; add `{ tag: 'es-419', iso2: 'es', iso3: 'spa' }` and
      `{ tag: 'es-ES', iso2: 'es', iso3: 'spa' }`; keep the `es` row; make the loop idempotent
      (NFR-2), following the `findUnique`-before-`create` idiom in `prisma/seeds/settings.ts`. Then
      `bin/dbreset`. → T001
      *Done when:* `bin/mysql -e 'select tag, iso2, iso3 from languages where iso2 = "es" order by
      tag'` returns exactly three rows — `es`, `es-419`, `es-ES` — all with `iso3 = spa` **(AC-1)**,
      and re-running the seed does not fail on a duplicate key.

- [ ] **T003** `[api]` Add `@Field() tag: string` to
      `src/languages/entities/language.entity.ts`, and re-key `LANGUAGE_NAMES` in
      `src/languages/language-names.ts` by tag, adding English labels for `es-419` and `es-ES`.
      `languageNameFor` keeps falling back to the bare code rather than throwing. → T002
      *Done when:* the service boots, `src/schema.gql` shows `tag: String!` on `Language`, and the
      `languages` query returns a `tag` on every row.

- [ ] **T004** `[api]` In `LanguagesService.findAll()`
      (`src/languages/languages.service.ts`), omit a base row **only when another row shares its
      `iso2`**. Read `plan.md` § Risks first: the naive rule ("tag equals iso2") hides every
      ordinary language, since `en`'s tag *is* `en`. Add the case to
      `src/languages/languages.service.spec.ts` and verify it fails when the "another row shares
      it" half of the condition is removed. → T003
      *Done when:* the `languages` query omits `es` **and still returns every single-row language**
      (`en`, `ja`, `fr`, …) **(AC-2)**, and `bin/npm api test` is green.

- [ ] **T005** `[api]` Point `validateAndResolveLanguageIds` at `tag` — the parameter, the
      `findMany` `where`, the map key, and the `{ tag }` params on both thrown errors — and update
      the two renderings in `src/i18n/messages.en.ts` from `{iso2}` to `{tag}`. Reuse
      `LANGUAGE_DUPLICATE`/`LANGUAGE_UNAVAILABLE` unchanged; do not mint a new key. It validates
      against the **whole table, not the filtered catalog**: a directly-submitted `es` is accepted
      (see `api/plan.md` § Contract obligations). Extend
      `src/languages/languages.service.spec.ts`, including a case asserting `es-419` and `es-ES`
      resolve to two **different** ids despite their shared `iso2`. → T004
      *(Sequential after T004, not parallel: both edit `languages.service.ts`.)*
      *Done when:* an unknown tag throws `error.language.unavailable` and a repeated tag throws
      `error.language.duplicate`, both **before** any delete, leaving the stored preference intact
      **(AC-7, AC-8's api half)**; `bin/npm api test` green.

- [ ] **T006** `[api]` Rename `@Args('iso2')` to `@Args('tags')` on `setMoviePreferredLanguages`
      (`src/movies/movies.resolver.ts`) and `setShowPreferredLanguages`
      (`src/shows/shows.resolver.ts`), along with the parameter carrying it. Leave each ownership
      guard exactly as it is (NFR-6). → T005
      *Done when:* `src/schema.gql` shows `tags: [String!]!` on both mutations and matches
      `spec.md` § GraphQL Contract Delta verbatim (Article VIII's check).

- [ ] **T007** `[api] [P]` Update `src/settings/settings.service.spec.ts` to exercise the
      `kind: 'languages'` branch with a variant tag, proving `default_languages` accepts `es-419`.
      No production change is expected in `settings.service.ts` — its split/trim/drop-empty
      normalization and `settings.catalog.ts` both stay exactly as they are; if a change turns out
      to be needed, stop and report rather than widening the branch. → T005
      *Done when:* `bin/npm api test` is green with a case storing `es-419` through
      `updateMany`.

- [ ] **T008** `[api] [P]` Replace `ProcessJobsService.resolveIso3(iso2)` with
      `resolveOriginalLanguage(iso2)` returning `{ tag, iso3 }` from **one lookup keyed by `tag`**
      (`src/process-jobs/process-jobs.service.ts`). Keep the unseeded-language fallback as
      `{ tag: 'en', iso3: 'eng' }` rather than throwing. Do **not** reach for `findFirst` on `iso2`
      — `plan.md` § Risks explains what that silently does to every Spanish-language title. Add the
      case to `src/process-jobs/process-jobs.service.spec.ts`. → T003
      *(Parallel with T004/T005: different file, same dependency.)*
      *Done when:* a title whose `originalLanguage` is `"es"` enqueues a job with
      `originalLanguageIso3 = "spa"` resolved from the **base** row, not a variant **(AC-10)**.

- [ ] **T009** `[api]` Add `@Field(() => [String]) allowedLanguageTags: string[]` to
      `src/process-jobs/entities/encode-job-details.entity.ts`, and extend
      `collectAllowedLanguages` plus `resolveDefaultLanguagesIso3` to emit tags alongside iso3
      codes from the **same** walk — one merge, not two that can drift. `resolveDefaultLanguagesIso3`
      must query by `tag`; left on `iso2` it silently matches nothing and the installation default
      stops contributing to every encode. Emit the field on both the `MOVIE` and `EPISODE`
      branches, deduplicated, original first. Extend the merge suite in
      `src/process-jobs/process-jobs.service.spec.ts`. → T008
      *Done when:* a film with `es-419` chosen produces a payload whose `allowedLanguageTags`
      contains `es-419` and whose `allowedLanguagesIso3` contains `spa` **exactly once** even with
      both variants chosen **(AC-9)**; `bin/npm api test` green.

### Group 2 — the consumer

Everything here depends on Group 1 being complete. `web` has no test runner, so its only real gate
is opening the page against a running `api` — starting against the old schema produces work nobody
can verify (`web/plan.md` § Scope).

- [ ] **T010** `[web]` Add `tag: string` to `src/types/languages.ts`, then add `tag` to every
      `Language` selection set: the `languages` query in `src/actions/languages.ts` and the
      `preferredLanguages` blocks in `src/actions/movies.ts` and `src/actions/shows.ts`. → T006, T009
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and a film detail page's
      network response carries `tag` on each preferred language.

- [ ] **T011** `[web] [P]` In `src/actions/languages.ts`, rename `$iso2` → `$tags` in **both**
      `SET_MOVIE_PREFERRED_LANGUAGES_MUTATION` and `SET_SHOW_PREFERRED_LANGUAGES_MUTATION` and in
      their variables, and switch both actions from `formData.getAll("iso2")` to
      `formData.get("tags")` split on `,` with empty segments dropped — a cleared picker must send
      an empty list, never `[""]`. Both documents are in this one file; do the pair in one pass.
      → T010
      *Done when:* saving a language on a film **and** on a series both succeed, and clearing every
      language on a title leaves `user_movie_languages` with no rows for it rather than erroring.

- [ ] **T012** `[web] [P]` Rewrite `src/components/media/LanguagePicker.tsx` as the shared dual-pane
      picker: group `options` by shared `iso2` (a group of one renders as a plain entry, a group of
      more than one renders a non-selectable heading named from `Intl.DisplayNames.of(iso2)` with
      its rows beneath); sort by the **base** language's display name so a group stays contiguous;
      left pane toggles on click with chosen entries staying visible and marked; right pane shows
      the chosen set as `ui/badge/Badge.tsx` badges with a remove control; one state value backs
      both panes; emit one `<input type="hidden" name={name} value={selected.join(",")}>`; keep
      state internal so `Show.tsx` need not become a client component. Entries are real
      `<button type="button">` with `aria-pressed` and the badge's X is a real `<button>` with an
      `aria-label` — **not** `role="listbox"`, whose children must be `option`s
      (`web/plan.md` § Steps 5). → T010
      *Done when:* the picker renders on a film detail page with Spanish as a heading and its two
      variants as entries; clicking an entry adds a badge and clicking the badge's X unticks the
      entry **(AC-3's round trip)**; every entry and every remove control is reachable and
      activatable from the keyboard **(AC-12)**.

- [ ] **T013** `[web] [P]` In `src/components/settings/DownloadPanel.tsx`, replace `MultiSelect`
      with the picker, passing `name="default_languages"` and the current value split from the
      setting string. Leave `ALWAYS_SENT_STRING_KEYS` in `src/actions/settings.ts` alone — `""`
      still means "no default languages", not "leave the previous value". Do **not** delete
      `src/components/form/MultiSelect.tsx`; it stays unused on purpose (`spec.md` § Out of Scope).
      → T012
      *Done when:* on `/settings` → Descarga, choosing "Español latinoamericano" and saving stores
      it — ``bin/mysql -e 'select value from settings where `key` = "default_languages"'`` shows a
      value containing `es-419`, and reloading shows the badge still chosen **(AC-3, AC-5)**; with
      the UI locale set to `en` the two entries read "Latin American Spanish" and "European
      Spanish" and stay adjacent under a "Spanish" heading rather than filed under E and L
      **(AC-4)**.

- [ ] **T014** `[web] [P]` Pass `name="tags"` to the picker from
      `src/components/movies/Movie.tsx` and `src/components/shows/Show.tsx`. Neither changes
      structurally; `Show.tsx` **stays a Server Component** with the picker as its client child.
      → T011, T012
      *Done when:* on a film's detail page, choosing "Español de España", saving and reloading
      shows it persisted, and the film's `preferredLanguages` carries a `Language` whose `tag` is
      `es-ES` **(AC-6)**. Repeat on a **series** detail page — that is the second hand-retyped
      mutation and the only check that catches a half-done T011.

- [ ] **T015** `[web] [P]` Add `errors.language.unavailable` and `errors.language.duplicate` to
      `messages/en.json` and `messages/es.json`, interpolating `{tag}`, plus any new picker copy
      (pane labels, empty state). In `es`, word it so it cannot be misread as "the release does not
      have this language" — the key's name invites that reading and it is not what it means
      (`spec.md` § GraphQL Contract Delta, REQ-12). Keep the Rioplatense register. → T012
      *Done when:* `bin/cli web node scripts/check-messages.mjs` exits 0, and submitting a
      duplicated tag renders the translated Spanish message inline **while the user's selection
      stays on screen** rather than clearing **(AC-8's web half)**.

### Group 3 — verification and docs

- [ ] **T016** `[docs]` Update `docs/spec/graphql-contract.md` § "Language preferences drive the
      encode payload" (the block around the `Language` type, both mutations and
      `EncodeJobDetails`): `tag` as the identifier, `iso2` no longer unique and now the grouping
      key, `languages` returning the pickable catalog rather than every row, the `iso2` → `tags`
      argument rename, and `allowedLanguageTags` beside `allowedLanguagesIso3` with why both exist.
      → T009, T015
      *Done when:* the section describes the schema `src/schema.gql` actually generated, with no
      remaining reference to `iso2` as the wire identifier.

- [ ] **T017** `[docs]` Update `services/api/CLAUDE.md` (the `languages/` and `process-jobs/`
      entries in the module map, and the seed description) and `services/web/CLAUDE.md` (§ "Language
      pickers: three call sites, one component" — now one component across Settings and both detail
      pages, with `MultiSelect` left unused; and § "Language names are not a catalog entry", which
      still holds and now also covers variant tags). No stage in the root `CLAUDE.md` pipeline table
      changes status. → T009, T015
      *Done when:* both files describe the code as it now stands, and neither still says the
      pickers are two components or that preferences are keyed by `iso2`.

- [ ] **T018** `[docs]` Walk every acceptance criterion in `spec.md` against the running stack,
      tick each box, and confirm NFR-4 explicitly: `bin/npm worker run test` green and
      `git status services/worker/` clean **(AC-11)**. Then set `status: Implemented` on `spec.md`,
      `plan.md`, `api/plan.md` and `web/plan.md`, and `status: Done` on this file.
      → T016, T017
      *Done when:* all twelve AC boxes are ticked with the observed result, and the four status
      lines are flipped.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.

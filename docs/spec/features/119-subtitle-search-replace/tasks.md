---
title: Subtitle Search and Replace — Tasks
last_updated: 2026-11-15
status: Done
---

# TASKS: Subtitle Search and Replace (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation and the live pass. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[infra]` task: no image, container or wrapper changes. The worker work stays in
`src/subtitles/`, `src/jobs/` and `src/api/`, so it goes to the `worker` agent, not `ffmpeg`.

## Tasks

### Group 1 — schema and contract (`api`)

- [x] **T001** `[api]` Migration `<ts>_subtitle_search_replace`: `SubtitleSearch.replaceLanguages Json?`
      and `SubtitleEmbed.replaceLanguages Json?` in `prisma/schema.prisma`; error keys
      `SUBTITLE_SEARCH_REPLACE_LANGUAGE_NOT_WANTED` / `_NOT_PRESENT` and their English messages
      (`api/plan.md` steps 1–2).
      *Done when:* `bin/cli api npx prisma migrate status` reports the migration applied and both
      columns are `NULL` on every existing row (`bin/mysql -e 'select count(*) from subtitle_searches where replaceLanguages is not null'` → 0).
- [x] **T002** `[api]` Request path: optional `replaceLanguages: [String!]` on
      `searchMovieSubtitles`/`searchEpisodeSubtitles`; `requestForCaller` lower-cases and dedupes,
      refuses `not_wanted` then `not_present` before creating a row (the latter reads the
      target's `fileSubtitleLanguages` with its own select, only when the list is non-empty), and
      `createGuarded` stores it; the automatic `requestFor` never sets it (`api/plan.md` step 3). → T001
      *Done when:* `subtitle-search-request.service.spec.ts` covers both refusals with no row
      created, the stored list, and `NULL` on the automatic path; all pass; `schema.gql` shows the
      argument on both mutations.
- [x] **T003** `[api]` Driver and embed: `missingLanguages` subtracts the ticked set from the
      present one; `embedding` passes the ticked languages with an `ACCEPTED` attempt to
      `embedStaged`, which stores them on `SubtitleEmbed.replaceLanguages`;
      `SubtitleEmbedDetails.replaceLanguagesIso3: [String!]!` (`[]` for `NULL`) (`api/plan.md`
      steps 4–5). → T002
      *Done when:* `subtitle-search.driver.spec.ts` shows a ticked present language searched, the
      embed receiving only accepted ticked languages, and the unticked path unchanged;
      `subtitle-embed.service.spec.ts` covers storage and `[]` for `NULL`; all pass;
      `schema.gql` shows the new details field.
- [x] **T004** `[api]` Outcome: `REPLACED` in `SubtitleSearchLanguageOutcome`; `SearchRow` and
      every `deriveLanguages` caller carry `replaceLanguages`; `deriveLanguages` gives a ticked
      language `REPLACED` when accepted and `COMPLETED`, never `ALREADY_PRESENT`, and skips `114`'s
      file-language override for it (`api/plan.md` step 6). → T002
      *Done when:* `derive-languages.spec.ts` covers ticked+accepted → `REPLACED`, ticked+nothing
      found while the file holds the language → `NOT_FOUND`, ticked+accepted+search `FAILED` →
      `FAILED`, unticked present → `ALREADY_PRESENT`; all pass.
- [x] **T005** `[api]` Close the slice: regenerate `schema.gql`, compare with the spec's delta,
      typecheck, full suite, comments gate. → T003, T004
      *Done when:* `bin/cli api npx --no tsc --noEmit` → 0 errors, `bin/npm api test` → all pass,
      `bin/comments api` → PASS, and the `schema.gql` diff equals the spec's delta (argument ×2,
      `REPLACED`, `replaceLanguagesIso3`).

### Group 2 — consumers

Both depend on T005: the generated schema must exist before either retypes it.

- [x] **T006** `[worker] [P]` Track drop in the embed job: `src/subtitles/replace-tracks.ts`
      (`tracksToDrop`), `--subtitle-tracks !…` in `embed-args.ts`, dropped indexes in
      `verify-embed.ts`, wiring in `jobs/subtitle-embed.job.ts`, and `replaceLanguagesIso3` in
      `api/subtitle-embed-reports.ts` read as `[]` with a log when missing (`worker/plan.md`). → T005
      *Done when:* `replace-tracks.spec.ts`, `embed-args.spec.ts` and `verify-embed.spec.ts` cover
      the cases in `worker/plan.md` § Tests and pass; `bin/cli worker npx --no tsc --noEmit` → 0;
      `bin/npm worker test` → all pass; `bin/comments worker` → PASS.
- [x] **T007** `[web] [P]` Dialog and actions: `SearchSubtitlesButton` with the replaceable
      languages, unticked checkboxes reset on each open and the new copy; `Movie.tsx` passes the
      languages; the show page (`app/(dashboard)/shows/[id]/page.tsx`) computes the effective
      subtitle languages and passes them to `SeasonAccordion` as a new prop, which derives each
      episode's list (iso3, deduped); both actions send `replaceLanguages` when
      non-empty; `REPLACED` in `types/media.ts`; `messages/{es,en}.json` for title, label, hint,
      outcome and both error keys (`web/plan.md`). → T005
      *Done when:* `bin/cli web npx --no tsc --noEmit` → 0, `bin/npm web run lint` → clean,
      `bin/comments web` → PASS, and the film page in the dev stack shows the dialog titled
      "Buscar y reemplazar subtítulos" with one unticked box per present wanted language.
      *Note:* typecheck, `bin/comments web` and `biome check` on the touched files verified; the
      dialog itself was not observed in the browser (no login, no film with subtitles in the dev
      stack), so that part of *Done when* moves to T008 (AC-1, AC-2).

### Group 3 — verification and docs

- [ ] **T008** `[docs]` Live pass, `plan.md` § Verification steps 1–9, against the dev stack
      (`bin/dev -d`). Record per AC what was observed (tracks before/after via `ffprobe`, file
      size/mtime for the miss case, the row's `replaceLanguages`) in `plan.md` under a "Live pass"
      section. Costs provider downloads: confirm the title with the user first. → T006, T007
      *Done when:* each of AC-1…AC-12 has an observed result or a named blocker in `plan.md`
      (§ Verification steps 1–9).
- [x] **T009** `[docs]` Update `docs/spec/graphql-contract.md` with a `119` section (argument,
      `REPLACED`, `SubtitleEmbedDetails.replaceLanguagesIso3`, the two keys and what each consumer
      does). → T005
      *Done when:* the section exists and matches `schema.gql`.
- [x] **T010** `[docs]` Update the root `CLAUDE.md` "Notify media server" and "Browse library" rows
      (`119` in the spec lists and one sentence each) and `services/{api,web,worker}/CLAUDE.md`
      where the subtitle search, the dialog and the `subtitle-embed` job are described. → T008
      *Done when:* each of the four files mentions `119` next to the behaviour it changed.
- [x] **T011** `[docs]` Walk the acceptance criteria in `spec.md`, tick only what T008 observed
      holding, set `status: Implemented` on `spec.md`, `plan.md` and every `<svc>/plan.md`,
      `status: Done` here; append `docs/spec/history.md`; run `/pending-acs 119`. → T008, T009, T010
      *Done when:* statuses flipped, history entry at the top with measured counts, and
      `bin/pending-acs --check` passes.

## AC coverage

| AC | Task(s) |
| :-- | :-- |
| AC-1, AC-2 | T007, T008 |
| AC-3, AC-4 | T003, T006, T008 |
| AC-5 | T003, T004, T008 |
| AC-6 | T006, T008 |
| AC-7 | T003, T008 |
| AC-8 | T002, T008 |
| AC-9 | T006, T008 |
| AC-10 | T002, T008 |
| AC-11 | T002, T008 |
| AC-12 | T003, T004, T006, T008 |

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T008 | docs | The live pass spends OpenSubtitles downloads and rewrites a real library file; no title was chosen | A title the user names, a logged-in session and a file backup |

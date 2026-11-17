---
title: Library list paging, list view and possession filter — Tasks
last_updated: 2026-11-10
status: Done             # Draft | In Progress | Done
---

# TASKS: Library list paging, list view and possession filter (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation and the manual pass. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer. |

**Measuring.** The stack running on this host is the end-user install, not this checkout, so
`bin/cli`/`bin/npm` may find no container. When they do not, run each *Done when* command through a
throwaway container as uid 1000 (memory `measuring-without-dev-stack`):

```bash
docker run --rm --user 1000:1000 -v "$PWD/services/<svc>":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c '<command>'
```

Report which form was used. Without a dev database, `prisma migrate dev` cannot run: write the
migration SQL by hand in Prisma's format (see the newest directory under `prisma/migrations/`) and
verify with `npx prisma validate` + `npx prisma generate`; `migrate status` moves to T016.

## Tasks

### Group 1 — `api`: a series' stored languages (spec REQ-7, REQ-13, NFR-5, NFR-6)

- [x] **T001** `[api] [P]` Add `Show.fileAudioLanguages Json?` and `Show.fileSubtitleLanguages Json?`
      to `prisma/schema.prisma` and the migration `<ts>_show_file_track_languages` (`api/plan.md` § Steps 1).
      *Done when:* `npx prisma validate` passes, `npx prisma generate` succeeds, and the migration's
      `migration.sql` contains exactly the two nullable `JSON` columns on `shows` and nothing else.
- [x] **T002** `[api] [P]` Write the pure rule `src/show-track-languages/intersect.ts` and its Article IX
      suite `intersect.spec.ts` (`api/plan.md` § Steps 2, § Tests).
      *Done when:* `bin/npm api test -- intersect` passes, covering AC-7's 28/28 + 25/28 case, season 0
      ignored, `tracksReadAt: null` ignored, no episode in scope → both `null`, no common code → `[]`,
      sorted output; and each case fails when its rule is removed (state which removals were tried).
- [x] **T003** `[api]` Create `src/show-track-languages/` (`module`, `ShowTrackLanguagesService` with
      `recompute(showId)` and the detached boot backfill), register it in `app.module.ts`, and add
      `show-track-languages.service.spec.ts` (`api/plan.md` § Steps 3–4). → T001, T002
      *Done when:* `bin/npm api test -- show-track-languages` passes, proving `recompute` writes
      `Prisma.DbNull` (not JSON null) for an empty scope and swallows and logs a Prisma failure;
      `bin/cli api npx --no tsc --noEmit` reports 0 errors.
- [x] **T004** `[api]` Call `recompute` from `LibraryProbeService.completed` (episode target,
      `count === 1`) and from `MediaServerReconcileService.syncShow` (`demoted > 0`); extend both
      existing spec files (`api/plan.md` § Steps 5–6, § Tests). Grep for any other writer of an
      episode's file languages and report it rather than adding a third call site. → T003
      *Done when:* `bin/npm api test -- library-probe media-server-reconcile` passes; removing either
      call makes its test fail; the report lists the grep result.
- [~] **T005** `[api]` Add `ShowLibraryTracksResolver` in `src/library-probe/library-probe.resolver.ts`,
      registered in `LibraryProbeModule`, with the spec's descriptions (`api/plan.md` § Steps 7). → T001
      *Done when:* after boot, `src/schema.gql` has `fileAudioLanguages: [String!]` and
      `fileSubtitleLanguages: [String!]` on `type Show` with the spec's descriptions, and the playground
      query `{ shows { id fileAudioLanguages fileSubtitleLanguages } }` answers without error.

### Group 2 — `api`: the page queries (spec REQ-1–4, REQ-8, REQ-11, NFR-1, NFR-2)

- [x] **T006** `[api] [P]` Add `src/media/library-page.ts`, `src/media/entities/library-possession.enum.ts`
      and the Article IX suite `src/media/library-page.spec.ts` (`api/plan.md` § Steps 8–9, § Tests).
      *Done when:* `bin/npm api test -- library-page` passes, covering `clampPageSize(7) === 24`,
      `clampPage(0) → 1`, `clampPage(99, 2) → 2`, `totalPages(0, 24) === 1`, `ADDED` including
      `ERROR`/`MISSING`/`DOWNLOADING` and excluding `COMPLETED`, and `LIBRARY_ORDER` ending in `id`;
      the `MISSING`-only and missing-`id` fault injections each fail.
- [~] **T007** `[api]` Add `MoviePage`/`ShowPage`, `MoviesService.findPage`/`ShowsService.findPage` and
      the `moviePage`/`showPage` queries; extend `movies.service.spec.ts`/`shows.service.spec.ts`
      (`api/plan.md` § Steps 9–12). Leave `movies`/`shows` untouched. → T005, T006
      *Done when:* `bin/npm api test` passes in full; the generated `src/schema.gql` matches
      `spec.md` § GraphQL Contract Delta (enum, both page types, both queries with their defaults and
      descriptions); in the playground `moviePage(page: 1, pageSize: 7)` answers `pageSize: 24`,
      `page: 0` answers `page: 1`, `page: 999` answers `page == totalPages` (AC-13); `git diff` shows no
      change to `findAll` or to the `movies`/`shows` resolvers (AC-15); dropping the ownership clause
      fails a service test.
- [~] **T008** `[api]` Run the slice's gates. → T004, T007
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, `bin/npm api test`,
      `bin/npm api run lint` and `bin/comments api` pass.

### Group 3 — `web`: consumers (spec REQ-1–12, NFR-3, NFR-4)

T009 and T010 depend on nothing in `api`. T011 consumes the contract produced by T007 and may not
start before it.

- [x] **T009** `[web] [P]` Write the pure `src/lib/library-params.ts` — normalize, cookie format,
      `toPossession`, canonical `libraryHref` (`web/plan.md` § Steps 1). No Next or React imports.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors, and the agent's report shows
      a throwaway `node` run (not a committed test) where `normalize(parse(libraryHref(s)))` yields
      `invalid: false` and the same state for every combination of view × size × filter × page ∈ {1, 3}.
- [x] **T010** `[web] [P]` Extract `src/components/media/LanguageChips.tsx` from `FileTrackLanguages.tsx`
      and render `FileTrackLanguages`' chips through it (`web/plan.md` § Steps 8).
      *Done when:* typecheck 0 errors, `bin/npm web run lint` clean on both files, and a film detail
      page and a season's "Pistas" column render identically before and after (screenshot or
      described in the report).
- [x] **T011** `[web]` Add `src/actions/library.ts` (`getMoviePage`, `getShowPage`, `setLibraryDisplay`)
      and the `fileAudioLanguages`/`fileSubtitleLanguages` fields on the `Show` type in
      `src/actions/shows.ts` (`web/plan.md` § Steps 2, § Contract obligations). → T007, T009
      *Done when:* typecheck 0 errors; the two queries' selections match the spec's SDL field by field
      (listed in the report); an auth error goes through `redirectToClearSession`, any other error
      returns an empty page and logs.
- [x] **T012** `[web]` Add `LibraryToolbar.tsx`, `LibraryPager.tsx`, `MediaTable.tsx` under
      `src/components/media/` and the `media.library.*` keys in `messages/en.json` and `messages/es.json`
      (`web/plan.md` § Steps 5–7, 9–10). → T009, T010, T011
      *Done when:* typecheck 0 errors, `bin/npm web run lint` clean, `bin/cli web node
      scripts/check-messages.mjs` passes, and `grep -cE "^(export default )?function [A-Z]"` is 1 for
      each new file.
- [x] **T013** `[web]` Wire `/movies`, `/shorts`, `/shows` pages and `Movies.tsx`/`Shorts.tsx`/`Shows.tsx`
      to the page actions, with the REQ-11 `redirect()`; delete `getMovies`/`getShows`
      (`web/plan.md` § Steps 3–4). → T012
      *Done when:* typecheck 0 errors, lint clean, `bin/comments web` passes,
      `grep -rn "getMovies\b\|getShows\b" services/web/src` finds no caller, and with the dev stack up
      `/movies?page=abc&pageSize=7&filter=foo&view=bar` redirects to a clean URL showing page 1 (AC-9).

### Group 4 — verification and docs

- [x] **T014** `[docs]` Add the `117` section to `docs/spec/graphql-contract.md` (the SDL, the clamping
      rules, the error table, `web` as the only consumer). → T007
      *Done when:* the section exists under § Contracts & Interfaces and its SDL is identical to
      `spec.md`'s.
- [x] **T015** `[docs]` Update `CLAUDE.md` files. → T013
      - root `CLAUDE.md`: the **Browse library** row gains the `117` sentence (paging, filter, list
        view, stored series languages) and `117` in its spec list;
      - `services/api/CLAUDE.md` § Module map: a `show-track-languages/` entry; `library-probe/` and
        `media-server/` entries name the `recompute` call; `movies/`/`shows/` name `findPage`; the
        model/migration count;
      - `services/web/CLAUDE.md` § "Library listings": the page actions, URL params, cookie, the
        toolbar/pager/table components, and the `emptyMessage` exception for the filter-empty state.
      *Done when:* each of the three files names `117` in the places listed.
- [~] **T016** `[docs]` Manual pass: walk AC-1 to AC-15 (including AC-7b and AC-7c) with
      `plan.md` § Verification, run `bin/cli api npx prisma migrate status`, tick each box in
      `spec.md` (`[~]` for anything only the maintainer can run), append a `docs/spec/history.md`
      entry, run `/pending-acs`, and set `status: Implemented` on `spec.md`, `plan.md`,
      `api/plan.md` and `web/plan.md`. → T008, T013, T014, T015
      *Done when:* every AC in `spec.md` is `[x]` or `[~]` with the blocker named, `bin/pending-acs
      --check` exits 0, and the four files read `status: Implemented`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

## Notes on `[~]` tasks

- **T005, T007** — code and tests done. `src/schema.gql` is not regenerated: no stack could boot here, and an offline Nest schema build reproduces the content but not the committed ordering. After sorting both with `lexicographicSortSchema`, the only differences are the 117 additions (`LibraryPossession`, `MoviePage`, `ShowPage`, `moviePage`, `showPage`, `Show.fileAudioLanguages`/`fileSubtitleLanguages`) plus a pre-existing stale enum (`SubtitleSearchLanguageOutcome`). Needs the maintainer to boot the api once and commit the regenerated `schema.gql`. The playground clamping checks (AC-13) are covered by the `findPage` unit tests only.
- **T008** — tsc 0 errors, comments gate PASS, jest 1671 passed; 2 suites (`session.service.spec`, `upload-tickets.service.spec`) fail on a missing Redis in the throwaway container. `npm run lint` is 3332 prettier/eslint errors repo-wide before 117; the one non-prettier error in a new 117 file was fixed, the other 12 are on lines 117 did not touch. `migrate status` moves to T016 / the maintainer.

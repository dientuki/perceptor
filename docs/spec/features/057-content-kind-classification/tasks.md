---
title: Content kind classification (live action / anime / CGI) — Tasks
last_updated: 2026-09-14
status: Done
---

# TASKS: Content kind classification (live action / anime / CGI) (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation and the cross-service verification sweep. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**Two tasks carry a dispatch override.** `T015` and `T016` are tagged `[worker]` because they live
in `services/worker/`, but `services/worker/src/ffmpeg/` and `services/worker/ffmpeg/` belong to the
**`ffmpeg` agent** (`.claude/agents/ffmpeg.md`), not the `worker` agent — the `worker` agent is
instructed to stop and report rather than edit them. Dispatch those two to `ffmpeg`. The tag
vocabulary has no way to say this; the task text does.

## Tasks

### Group 1 — schema, the rule, and the contract (`api`)

Nothing outside `api` can compile against `contentKind` until this group is complete: `api` owns the
Prisma enum, the migration and the regenerated `schema.gql`.

- [x] **T001** `[api]` Add `enum ContentKind { LIVE_ACTION ANIME CGI }` to `prisma/schema.prisma`,
      drop `Movie.isLiveAction` and `Show.isLiveAction`, add
      `contentKind ContentKind @default(LIVE_ACTION)` to both models, and generate the migration with
      `bin/npm api run prisma:migrate`. No backfill — every existing row lands on the default.
      *Done when:* `git status --short services/api/prisma` shows a modified `schema.prisma` plus
      exactly one new migration directory, and
      `bin/mysql -e 'select contentKind, count(*) from movies group by contentKind'` and its `shows`
      twin both report every pre-existing row as `LIVE_ACTION`.
- [x] **T002** `[api] [P]` Create `src/media/entities/content-kind.enum.ts` — the TS enum plus
      `registerEnumType({ name: 'ContentKind' })`, mirroring
      `src/preferences/entities/language-track-kind.enum.ts`. → T001
      *Done when:* `git diff services/api/src/schema.gql` contains
      `enum ContentKind { LIVE_ACTION ANIME CGI }` after a boot.
- [x] **T003** `[api] [P]` Create `src/media/content-kind.ts` — `classifyContentKind({ genreIds,
      keywordIds })`, a plain exported function with no Nest module (the `src/pipeline-status/`
      precedent), with the animation genre id and the three keyword ids as named constants — plus
      `src/media/content-kind.spec.ts` covering: not animated (keywords irrelevant), `3d-animation`
      alone, `anime` alone, `cartoon` alone, **`anime` *and* `3d-animation` together → `CGI`**
      (REQ-4's precedence), animated with an empty list, animated with `undefined`.
      *Done when:* `bin/npm api test -- content-kind` is green and inverting the `3d-animation`
      check in the implementation makes a named case fail.
- [x] **T004** `[api]` Teach `TmdbClient` genres and keywords: map `genres` → `genreIds` on both
      detail mappers, add `keywords(type, id): Promise<number[]>` reading `keywords` for a film and
      `results` for a series (`[]` for a body with neither), widen `MovieDBClient`, add
      `genreIds?`/`keywordIds?` to `clients/types.ts`'s cached `MediaSearchResult`, and carry
      `genre_ids` through `popular.ts`, `multi.ts` and both `search()` mappers. Add
      `src/clients/tmdb/client.spec.ts` feeding `keywords()` both body shapes.
      *Done when:* `bin/npm api test -- tmdb` is green, and the client spec fails if the film branch
      is pointed at the `results` key.
- [x] **T005** `[api]` `MoviesService.register()`: resolve the catalog entry, top it up with **one**
      `TmdbClient.details()` call when either `runtime` or `genreIds` is missing, cache once, then
      derive `isShort` (unchanged) and `contentKind`; fetch keywords only when the genres say
      animated and `keywordIds` is not already cached, caching them back into the same entry. Every
      failure degrades per NFR-2, never rethrown. Extend `movies.service.spec.ts` with the three
      silent failures named in `api/plan.md` § Tests — the single-`details()`-call count, the
      degradation paths, and `contentKind` being absent from the object handed to `cacheMovies`.
      → T001, T002, T003, T004
      *Done when:* `bin/npm api test -- movies.service` is green, the call-count case fails if a
      second `details()` call is introduced, and the cache-shape case fails if `contentKind` is added
      to the cached object.
- [x] **T006** `[api]` `ShowsService.register()`: the same derivation on the series path (no runtime),
      caching the topped-up entry the way `cacheShows()` already offers — best-effort, never awaited
      into the caller. Extend `shows.service.spec.ts` with the series derivation and its degradation.
      → T001, T002, T003, T004
      *Done when:* `bin/npm api test -- shows.service` is green, including a case where
      `tmdb.keywords` rejects and the series still registers as `CGI`.
- [x] **T007** `[api]` Add `MoviesService.setContentKind` / `ShowsService.setContentKind` and expose
      `setMovieContentKind` / `setShowContentKind`, each following its **own** side's neighbour —
      films gate inside the service (`findOneFromDb`, `MOVIE_NOT_FOUND`), series gate in the resolver
      (`findOneFromDb`, `SHOW_NOT_AVAILABLE`), both with `assertEnabled` for the type first and **no**
      shorts-style capability check. Extend `movies.resolver.spec.ts` for the guard order.
      → T001, T002
      *Done when:* `bin/npm api test -- movies.resolver` is green, and `bin/mysql` shows the column
      changing after a `setMovieContentKind` call against a running stack.
- [x] **T008** `[api]` Replace `isLiveAction` with `contentKind` on
      `src/process-jobs/entities/encode-job-details.entity.ts` and in both arms of
      `ProcessJobsService.getEncodeJobDetails` (the episode arm reading its series' value), moving
      `process-jobs.service.spec.ts`'s existing fixtures to the enum. `outputRoot` resolution is
      untouched. → T001, T002
      *Done when:* `bin/npm api test -- process-jobs` is green and `processJob(id)` for an episode of
      an `ANIME` series returns `contentKind: ANIME`.
- [x] **T009** `[api]` Finish the rename across `src/movies/entities/movies.entity.ts`,
      `src/shows/entities/show.entity.ts`, `src/movies/dto/create-movie.dto.ts` and
      `prisma/seeds/movie.ts`, then confirm the regenerated `src/schema.gql` matches
      `spec.md` § GraphQL Contract Delta exactly — nothing extra, `isLiveAction` gone.
      → T001, T002, T005, T006, T007, T008
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, `bin/npm api test` is green,
      `grep -rn isLiveAction services/api/src services/api/prisma/schema.prisma` prints nothing, and
      the `schema.gql` diff is exactly the delta.

### Group 2 — consumers (`web`, `worker`)

Everything here depends on Group 1: the contract must exist before anyone consumes it. The two
services share no file, so `web` and `worker` overlap freely from here.

- [x] **T010** `[web] [P]` Rename the selected field in `src/actions/movies.ts` and
      `src/actions/shows.ts` (both the query text and both local types), and add the `ContentKind`
      union plus its ordered value list to `src/types/media.ts`. → T009
      *Done when:* `grep -rn isLiveAction services/web/src` prints nothing and
      `bin/cli web npx --no tsc --noEmit` reports 0 errors.
- [x] **T011** `[web]` Add the `contentKind` namespace (three labels) plus `contentKindLabel` under
      `movies.detail` and `shows.detail` to `messages/en.json` and `messages/es.json`, `es` in the
      existing Rioplatense register. → T010
      *Done when:* `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift.
- [x] **T012** `[web]` Create `src/components/media/ContentKindSelect.tsx` (one renderable export, on
      the existing `src/components/form/Select.tsx`, controlled `value` — **not** the `key`-remount
      trick the short `Switch` needs), add `setMovieContentKindAction`/`setShowContentKindAction`
      following `setMovieShortAction`'s shape, sending the argument as a `ContentKind!` variable and
      surfacing every refusal in `web/plan.md`'s table, then render the control in
      `src/components/movies/Movie.tsx` and `src/components/shows/Show.tsx`. → T010, T011
      *Done when:* `bin/npm web run build` exits 0; on a running stack, changing the control on a film
      and on a series detail page persists across a reload, and the same control on a title owned by
      another user shows `Recurso no disponible para este usuario` with the displayed value restored.
- [x] **T013** `[worker] [P]` Create `src/encode/content-kind.ts` — the worker-local
      `'LIVE_ACTION' | 'ANIME' | 'CGI'` union, its runtime value list, and
      `normalizeContentKind(raw)` returning `LIVE_ACTION` plus one `console.warn` for anything
      unrecognised, never throwing — plus `src/encode/content-kind.spec.ts` covering the three valid
      values unchanged and unknown/`undefined`/`null` all degrading with a log.
      *Done when:* `bin/npm worker test -- content-kind` is green, including a case asserting the
      fallback logs rather than throws.
- [x] **T014** `[worker]` Change `EncodeInput.isLiveAction` to `contentKind: ContentKind` (required)
      in `src/encode/types.ts`; in `src/jobs/encode.job.ts` swap the field in the `processJob` query
      and in `EncodeJobDetails` (as `string`, matching `kind`/`sourceKind`), call
      `normalizeContentKind` **once** before the compression branch, pass the result into both
      `EncodeInput` literals, add it to the existing `[encode] <id>:` log line, and move
      `encode.job.spec.ts`'s fixture off the boolean. → T009, T013
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports only the 2 known pre-existing
      `src/metadata/container-tags.spec.ts` errors, and a real encode's log line prints the resolved
      kind.
- [x] **T015** `[worker]` **Dispatch to the `ffmpeg` agent.** In `src/ffmpeg/params.ts`, take the
      content kind instead of the boolean in `getVideoParams`/`getQuality` and build the `svtav1`
      string from three cases — `LIVE_ACTION`: `scm=0`, `aq-mode=2`, no QM, `sharpness=0`,
      `film-grain=0`; `ANIME` and `CGI`: `scm=2`, `aq-mode=2`, `enable-qm=1`, `qm-min=4`,
      `sharpness=2`, `film-grain=0`. `ANIME` and `CGI` stay **two separately editable cases**
      producing equal output (REQ-11); the five call sites must not grow a third argument block
      (`.claude/agents/ffmpeg.md` § Governance); `getQuality` returns exactly today's values; the
      dead commented-out blocks go (Article XI). Pass `details.contentKind` through
      `src/ffmpeg/buildCommand.ts` and update `params.spec.ts`/`buildCommand.spec.ts`.
      → T013, T014
      *Done when:* `bin/npm worker test -- params` and `-- buildCommand` are green, with one case per
      kind, and the live-action case asserts `aq-mode=2:...:sharpness=0:film-grain=0` and the absence
      of `enable-qm`.
- [x] **T016** `[worker]` **Dispatch to the `ffmpeg` agent.** Make `src/ffmpeg/cases.spec.ts`
      validate `input.contentKind` against the three literals and fail the named file otherwise (a
      fixture still carrying `isLiveAction` must fail collection, never be defaulted — NFR-7), and
      move `ffmpeg/1.json` and `ffmpeg/2.json` to `contentKind` with their expected
      `-svtav1-params` strings updated for live action's new arguments. → T015
      *Done when:* `bin/npm worker test` runs with `grep -rn isLiveAction services/worker/ffmpeg`
      printing nothing, and the report accounts for every failure line-by-line against the 2
      pre-existing `src/ffmpeg/` failures (`ffmpeg/2.json`'s stale track title,
      `buildCommand.spec.ts`'s CRF mismatch) recorded before the slice started.

### Group 3 — verification and docs

- [x] **T017** `[docs]` Record the delta in `docs/spec/graphql-contract.md`: the `ContentKind` enum,
      `contentKind` on `Movie`/`Show`/`EncodeJobDetails`, the two mutations with their error table,
      the worker's `LIVE_ACTION` degradation, and the removal of `isLiveAction` from the three types
      it documents today. → T009, T012, T016
- [x] **T018** `[docs]` Update the root `CLAUDE.md` pipeline table (the **Register title in DB** and
      **Transcode** rows, plus the spec refs), `services/api/CLAUDE.md` (`movies/`, `shows/`,
      `process-jobs/`, the enum reality-check table — six enums becomes seven, and the model/migration
      counts), `services/web/CLAUDE.md` (the detail-pages section) and `services/worker/CLAUDE.md`
      (the quality-rules section and the test counts). → T017
- [x] **T019** `[docs]` Run the cross-service verification sweep in `plan.md` § Verification — every
      `bin/` command plus the repository-wide `isLiveAction` grep (AC-11, AC-12) — then the five-step
      manual pass in the same section, covering AC-1..AC-10 against a running `bin/dev`.
      → T012, T016
      *Done when:* every command's real output is recorded, the grep prints nothing, and each of
      AC-1..AC-12 is marked reached or blocked with the reason.
- [x] **T020** `[docs]` Tick each acceptance criterion in `spec.md`, tick the requirement boxes, and
      set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md`, `web/plan.md` and
      `worker/plan.md`. → T019

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

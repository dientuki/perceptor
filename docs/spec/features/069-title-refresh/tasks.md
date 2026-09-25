---
title: Title Refresh — Tasks
last_updated: 2026-09-25
status: Done
---

# TASKS: Title Refresh (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Every service task reads `spec.md`, `plan.md` and its own `<svc>/plan.md` first. The GraphQL
Contract Delta in `spec.md` is frozen — a task that finds it wrong stops and lands in **Blocked**.

There is **no `[worker]` task and no `[infra]` task** in this feature, and no Prisma migration
(NFR-4). A diff under `services/worker` or `services/api/prisma` is a scope violation, not progress.

## Tasks

### Group 1 — `api`: derivation, media-server sync, catalog refresh, the contract

- [x] **T001** `[api] [P]` REQ-17 in `src/pipeline-status/pipeline-status.ts`: in
      `deriveTitleStatus`, a `SCANNED` source contributes nothing (like `ERROR`) and a `COMPLETED`
      job contributes nothing — only `WAITING`/`QUEUED`/`ENCODING` jobs lift to `ENCODING`. Update the
      doc comment. `deriveSourceStatus`, `isRaceWinner`, `isLiftedBySeasonPack`, `toMediaStatus`
      untouched. In `pipeline-status.spec.ts`, rewrite the cases that asserted the old lift and add
      the REQ-17 cases listed in `api/plan.md` § Tests (`api/plan.md` § Steps 1).
      *Done when:* `bin/npm api run test -- pipeline-status` passes, including "column `MISSING` +
      `SCANNED` source + `COMPLETED` job → `MISSING`" and "`SCANNED` source + `ENCODING` job →
      `ENCODING`"; reverting the job-contribution change makes the first of them fail.
- [x] **T002** `[api] [P]` Add the rebuild-and-wait method to
      `src/media-server-index/media-server-index.service.ts` returning `ready`/`failed`/`native`:
      no `listLibrary` → `native`; otherwise `rebuild()`, and when another rebuild holds the claim,
      poll `readState()` until it leaves `syncing`, bounded by `REBUILD_CLAIM_TTL_SECONDS`
      (`api/plan.md` § Steps 2). Add the one spec case from `api/plan.md` § Tests.
      *Done when:* `bin/npm api run test -- media-server-index` passes, including "claim held
      elsewhere, state goes `syncing` → `failed` → result `failed`".
- [x] **T003** `[api] [P]` Add `src/media/entities/title-refresh.entity.ts` (`TitleRefresh`,
      `RefreshCatalogOutcome`, `RefreshMediaServerOutcome`, both enums registered) exactly as
      `spec.md` § GraphQL Contract Delta, and `MEDIA_REFRESH_IN_PROGRESS:
      'error.media.refresh_in_progress'` in `src/i18n/error-keys.ts` + its English text in
      `src/i18n/messages.en.ts` (`api/plan.md` § Steps 4–5).
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors.
- [x] **T004** `[api] [P]` Extract the season/episode loop of `ShowsService.hydrate()`
      (`src/shows/shows.service.ts`) into a private method `hydrate()` calls. Pure refactor —
      claim, `seasonsSyncedAt`-after-full-loop and the tail reconcile unchanged (`api/plan.md`
      § Steps 7, first half).
      *Done when:* `bin/npm api run test -- shows` passes unchanged and `git diff` shows no change in
      `hydrate()`'s observable order of writes.
- [x] **T005** `[api]` Add `syncMovie(movieId, tmdbId)` / `syncShow(showId, tmdbId)` to
      `src/media-server/media-server-reconcile.service.ts`: never throw; `SKIPPED` when `client()` is
      null; `FAILED` with zero writes when index freshness is `failed` or any lookup/listing throws;
      promote/demote as single guarded `updateMany`s with the in-flight relation filter in the `where`
      and `filePath: null` on demotion; counts from `count` (`api/plan.md` § Steps 3). Existing
      `reconcileMovie`/`reconcileShow` keep promote-only behaviour. Extend
      `media-server-reconcile.service.spec.ts` with the cases in `api/plan.md` § Tests.
      → T001, T002
      *Done when:* `bin/npm api run test -- media-server-reconcile` passes, including "listing throws →
      `FAILED`, no `updateMany` issued" and "demotion `data` contains `filePath: null`"; dropping the
      relation filter from the `where` makes a case fail.
- [x] **T006** `[api]` `MoviesService.refresh(id, userId)` in `src/movies/movies.service.ts`
      (ownership via `findOneFromDb` → `MOVIE_NOT_FOUND {id}`; claim `movie:refresh:<tmdbId>` or
      `MEDIA_REFRESH_IN_PROGRESS` conflict; catalog step writing only `title`, `overview`,
      `posterUrl`, `releaseDate`, `originalLanguage` and re-caching via `cacheMovies`, → `DONE`/
      `FAILED`; `syncMovie`; claim released in `finally`) and the `refreshMovie(id: Int!)` mutation in
      `src/movies/movies.resolver.ts`, `assertEnabled` first, shaped like `removeMovie`
      (`api/plan.md` § Steps 6, 8). → T003, T005
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and the regenerated
      `src/schema.gql` contains `refreshMovie(id: Int!): TitleRefresh!`.
- [x] **T007** `[api]` `ShowsService.refresh(id)` in `src/shows/shows.service.ts` (claim
      `hydrateClaimKey(tmdbId)` or conflict; catalog step: series row's five fields, every season via
      the T004 loop, `seasonsSyncedAt` on full success, `cacheShows`, a mid-loop throw → `FAILED`;
      `syncShow`; `finally` release) and `refreshShow(id: Int!)` in `src/shows/shows.resolver.ts`,
      `assertEnabled` then the resolver-side ownership gate (`SHOW_NOT_AVAILABLE`), as `removeShow`
      (`api/plan.md` § Steps 7–8). → T003, T004, T005
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `src/schema.gql` contains
      `refreshShow(id: Int!): TitleRefresh!`.
- [x] **T008** `[api]` Slice verification. → T006, T007
      *Done when:* `bin/cli api npx --no tsc --noEmit` → 0 errors; `bin/npm api test` → all suites
      pass, total above 678/51; `git status --short services/api/prisma` → empty;
      `git diff services/api/src/schema.gql` → exactly `refreshMovie`, `refreshShow`, `TitleRefresh`,
      `RefreshCatalogOutcome`, `RefreshMediaServerOutcome` and nothing else.

### Group 2 — `web`: the button

Depends on the contract being produced (T006, T007). The three tasks are sequential within `web`.

- [x] **T009** `[web]` Add `TitleRefreshResult` to `src/types/media.ts` and
      `refreshMovieAction`/`refreshShowAction` (with `REFRESH_MOVIE_MUTATION`/`REFRESH_SHOW_MUTATION`
      selecting `catalog mediaServer promoted demoted`) to `src/actions/movies.ts`/`src/actions/shows.ts`,
      following `removeMovieAction` exactly, `revalidatePath` on the listings (`web/plan.md` § Steps
      1–2). → T006, T007
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors.
- [x] **T010** `[web]` Build `src/components/media/RefreshTitleButton.tsx` (pending state, inline
      error via the action's translated message, `router.refresh()` + one result line on success,
      `SKIPPED` not shown as a warning, `FAILED` naming the step) and add
      `errors.media.refresh_in_progress` and `media.refreshTitle.*` to `messages/en.json` and
      `messages/es.json` (`web/plan.md` § Steps 3, 5). → T009
      *Done when:* `bin/cli web node scripts/check-messages.mjs` reports no drift and
      `bin/cli web npx --no biome check src/components/media/RefreshTitleButton.tsx` is clean.
- [x] **T011** `[web]` Mount `RefreshTitleButton` in `src/components/movies/Movie.tsx` and
      `src/components/shows/Show.tsx`, before `RemoveTitleButton` (`web/plan.md` § Steps 4). → T010
      *Done when:* `bin/cli web npx --no tsc --noEmit` → 0 errors, `bin/npm web run build` exits 0,
      and `/movies/<id>` and `/shows/<id>` render a Refresh button on the running dev stack.

### Group 3 — verification and docs

- [x] **T012** `[docs]` Update `docs/spec/graphql-contract.md` with a `069` section: the two
      mutations, `TitleRefresh`, outcomes-not-errors (REQ-11), `error.media.refresh_in_progress`, and
      REQ-17's change to what a title's `status` means (a finished run no longer lifts it; the media
      server corrects the stored column). → T008
- [x] **T013** `[docs]` Update `CLAUDE.md` files: root pipeline table ("Register title in DB",
      "Notify media server" and "Browse library" rows — refresh button, bidirectional sync, REQ-17)
      and the "Current state" entry with measured numbers; `services/api/CLAUDE.md` module map
      (`MediaServerReconcileService.sync*`, the index wait, the derivation rule in `pipeline-status`,
      the shared hydrate claim); `services/web/CLAUDE.md` (`RefreshTitleButton`). → T008, T011
- [x] **T014** `[docs]` Run the manual pass in `plan.md` § Verification against `bin/dev` with
      Jellyfin (AC-1 to AC-11), confirm AC-12 from T008/T010's outputs, tick each box in `spec.md`,
      record any AC not run live, and set `status: Implemented` on `spec.md`, `plan.md`,
      `api/plan.md`, `web/plan.md`, and `status: Done` here. → T012, T013

## Acceptance criteria coverage

| AC | Reached by |
| :-- | :-- |
| AC-1, AC-2, AC-3, AC-8 | T006/T007 (catalog step), T014 live |
| AC-4 | T002 + T005 (index wait, promote), T014 live |
| AC-5, AC-5b, AC-6, AC-7, AC-9 | T001 + T005 (derivation, guarded demote, `FAILED`/`SKIPPED`), T014 live |
| AC-5c | T001, T014 live |
| AC-10 | T006/T007 (claim), T010 (translated message), T014 live |
| AC-11 | T006 (ownership), T014 live |
| AC-12 | T008 (schema diff), T010 (messages parity) |

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

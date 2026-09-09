---
title: Shorts Category — Tasks
last_updated: 2026-09-07
status: Draft
---

# TASKS: Shorts Category (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

`services/worker/` is not touched by this feature (spec NFR-2) — there is no `[worker]` task, and a
diff under `services/worker/` is a violation, not an omission.

## Tasks

### Group 1 — schema, settings and the capability

- [ ] **T001** `[api] [P]` Add `isShort Boolean @default(false)` to `model Movie` in
      `services/api/prisma/schema.prisma` and generate the migration with
      `bin/npm api run prisma:migrate`. No backfill (`../plan.md` § Migrations).
      *Done when:* `bin/cli api npx prisma migrate status` reports the new migration applied with no
      drift, `bin/mysql -e 'describe movies'` lists `isShort` as `tinyint(1) NOT NULL DEFAULT 0`, and
      `git status services/api/prisma/` shows both a modified `schema.prisma` and a new migration
      directory.
- [ ] **T002** `[api] [P]` Register `shorts_enabled: { kind: 'boolean' }` and
      `path_shorts: { kind: 'path', rootId: 'library' }` in
      `services/api/src/settings/settings.catalog.ts`, and seed `shorts_enabled` = `'false'` and
      `path_shorts` = `'Shorts'` in `services/api/prisma/seeds/settings.ts`.
      *Done when:* after `bin/dbreset`,
      ``bin/mysql -e "select `key`, value from settings where `key` in ('shorts_enabled','path_shorts')"``
      returns `shorts_enabled|false` and `path_shorts|Shorts`, and an `updateSettings` call sending
      `shorts_enabled: "maybe"` is refused with `error.setting.expected_boolean`.
- [ ] **T003** `[api] [P]` Add `MEDIA_SHORTS_DISABLED: 'error.media.shorts_disabled'` and
      `MEDIA_SHORTS_NOT_A_MOVIE: 'error.media.shorts_not_a_movie'` to
      `services/api/src/i18n/error-keys.ts`, with English renderings in `src/i18n/messages.en.ts`.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and both keys resolve to a
      non-empty English string through the existing `renderMessage` path.
- [ ] **T004** `[api]` Extract `MediaCapabilitiesService` into a new
      `services/api/src/media/media-capabilities.module.ts` (imports `SettingsModule` only, exports
      the service; `MediaModule` imports it instead of declaring it — **no `forwardRef`**), add
      `shortsEnabled` to `read()` and to `entities/media-capabilities.entity.ts`, and add
      `isShortsEnabled()` / `assertShortsEnabled()`. `shortsEnabled` is
      `moviesEnabled && map['shorts_enabled'] === 'true'` — the `=== 'true'` is deliberate and
      inverted from the two twins above it (`api/plan.md` step 4). Extend
      `media-capabilities.service.spec.ts` with the absent-row default, the
      `movies off + shorts on → false` case, and `assertShortsEnabled`'s key. → T002, T003
      *Done when:* `bin/npm api test` passes with the new cases green, the app boots
      (`bin/dev` shows `api` healthy, no circular-dependency error), and `mediaCapabilities` returns
      `shortsEnabled: false` on a freshly reset database.

### Group 2 — the `api` surface

Everything here depends on Group 1: the column, the settings and the capability must exist first.

- [ ] **T005** `[api]` Add the optional `asShort` argument to `addMedia` in
      `services/api/src/media/media.resolver.ts`, guarded in this order — `assertEnabled(type)`,
      then `badRequest(MEDIA_SHORTS_NOT_A_MOVIE)` when `asShort` and `type !== 'movie'`, then
      `assertShortsEnabled()` — and thread `{ asShort }` through
      `MediaTypeService.register(tmdbId, userId, options?)` into `MoviesService.register`'s
      `create()`. `ShowsService.register` keeps its two-parameter signature. An already-registered
      film does not have its flag rewritten. Extend `media.resolver.spec.ts` with the guard order and
      with "no service method runs when a guard throws". → T001, T004
      *Done when:* `bin/npm api test` passes; `addMedia(tmdbId: 1399, type: "show", asShort: true)`
      returns `extensions.i18n.key = "error.media.shorts_not_a_movie"` and creates no `shows` row;
      `addMedia(type: "movie", asShort: true)` with shorts off returns
      `error.media.shorts_disabled`.
- [ ] **T006** `[api]` Add `MoviesService.setShort(id, userId, isShort)` (ownership through the
      existing `findOneFromDb`, then a single-column `movie.update`, returned through
      `withDerivedStatus`) and expose it as `setMovieShort(movieId: Int!, isShort: Boolean!): Movie!`
      on `movies.resolver.ts`, guarded by `assertEnabled('movie')` then `assertShortsEnabled()`.
      → T001, T004
      *Done when:* with shorts enabled, `setMovieShort` on an owned film flips
      `bin/mysql -e 'select isShort from movies where id = <id>'`; on another user's film it returns
      `error.movie.not_found`; with shorts off it returns `error.media.shorts_disabled` and the
      column is unchanged.
- [ ] **T007** `[api]` Add `isShort: Boolean!` to `movies/entities/movies.entity.ts`, add the
      optional `isShort` parameter to `MoviesService.findAll` (applied to the Prisma `where` only
      when given) and the nullable `isShort` argument to the `movies` query. Extend
      `movies.service.spec.ts` to assert the `where` carries the filter only when the argument is
      passed. → T001
      *Done when:* `bin/npm api test` passes; `movies` with no argument returns every film the caller
      owns, `movies(isShort: true)` returns only the flagged ones, and `movies(isShort: false)` only
      the rest.
- [ ] **T008** `[api]` Add `isShort: Boolean!` to
      `media/entities/media-search-result.entity.ts`, select and map it in
      `MoviesService.enrichWithOwnership` (`false` when no registered row exists), and set
      `isShort: false` on every row `ShowsService` enriches. **Do not add the field to
      `src/clients/types.ts`.** Extend `movies.service.spec.ts` to assert the object handed to
      `cacheMovies` carries no `isShort`, and `shows.service.spec.ts` to assert every enriched row
      carries `isShort: false`. → T001
      *Done when:* `bin/npm api test` passes; `searchMedia`, `searchAllMedia` and `popularMedia` all
      return `isShort` on every row; and `bin/cli api redis-cli --scan --pattern 'tmdb:movie:*'`
      followed by a `GET` of one key shows a cached payload with no `isShort` field.
- [ ] **T009** `[api]` In `ProcessJobsService.getEncodeJobDetails`'s film arm, resolve `outputRoot`
      from `path_shorts` when `movie.isShort && await capabilities.isShortsEnabled()`, else
      `path_movies`; widen `resolveOutputRoot`'s parameter union and import
      `MediaCapabilitiesModule` in `process-jobs.module.ts`. Add no lock and no flag snapshot. Extend
      `process-jobs.service.spec.ts` with all four `isShort` × shorts-enabled combinations plus
      `path_shorts` absent → `error.setting.missing`. → T001, T004
      *Done when:* `bin/npm api test` passes with the five new cases green, and `processJob(id)` for a
      flagged film returns an `outputRoot` ending in the `path_shorts` segment while an unflagged one
      still ends in `path_movies`.

### Group 3 — `web`

Everything here depends on Group 2: the contract must exist in `schema.gql` before `web` retypes it.

- [ ] **T010** `[web]` Add `shortsEnabled: boolean` to `MediaCapabilities` in `src/types/media.ts`
      and to `MEDIA_CAPABILITIES_QUERY` in `src/actions/media.ts`. No component re-derives the
      `&&`. → T004
      *Done when:* `bin/npm web run build` exits 0 and a dashboard render logs no GraphQL error for
      an unknown field.
- [ ] **T011** `[web] [P]` Add the **Shorts** entry to `AppSidebar.tsx`'s `baseNavItems`, between
      Movies and Series, gated on `capabilities.shortsEnabled`, with a `nav.shorts` key in both
      catalogs and its own `lucide-react` icon. → T010
      *Done when:* the entry is absent after `bin/dbreset`, appears once `shorts_enabled` is turned
      on, and disappears again when `movies_enabled` is turned off with shorts still stored as on.
- [ ] **T012** `[web] [P]` Add the optional `isShort` argument to `getMovies` in
      `src/actions/movies.ts`; create `src/app/(dashboard)/shorts/page.tsx` (the `/shows` page's
      `notFound()` gate, on `shortsEnabled`) and `src/components/movies/Shorts.tsx`; make
      `/movies` pass `isShort: false` while shorts are enabled and nothing while they are not. Cards
      keep `mediaType={MEDIA_TYPE.MOVIE}` so they link to `/movies/[id]` — no `/shorts/[id]`.
      → T010, T007
      *Done when:* `/shorts` renders the not-found page with shorts off; with shorts on it lists only
      flagged films while `/movies` lists only the rest; and with shorts off `/movies` lists both
      again.
- [ ] **T013** `[web] [P]` Add `isShort` to the search-result type in `src/types/search.ts` and to
      the two search queries in `src/actions/media.ts`, and render a shorts badge in `MediaCard.tsx`
      (beside the existing type badge on the mixed grid, alone on the `/movies/add` grid), threading
      whatever it needs through `MediaList.tsx`. Badge only while shorts are enabled. → T010, T008
      *Done when:* a film registered as a short shows the badge in `/search` and `/movies/add`, an
      unregistered result shows none, and the badge disappears entirely with shorts off.
- [ ] **T014** `[web]` Add the optional `asShort` to `addMedia` in `src/actions/media.ts` and an
      "add as short" affordance to `MediaResultAction.tsx`, rendered only when shorts are enabled,
      the row is a film and it is not owned; thread `shortsEnabled` from the pages into
      `MultiSearchResults.tsx` and `SearchContainer.tsx` rather than fetching it client-side. Handle
      `error.media.shorts_disabled` in the existing inline error slot — never silently retry as a
      plain add. → T013
      *Done when:* registering a search result as a short lands it in `/shorts` and not in `/movies`,
      `bin/mysql -e 'select isShort from movies order by id desc limit 1'` returns `1`, and flipping
      `shorts_enabled` off in another tab before submitting surfaces the translated refusal.
- [ ] **T015** `[web] [P]` Add `setMovieShortAction(movieId, isShort)` beside the other per-title
      actions (the `setMovieAudioMandatoryAction` shape), render a `Switch` for it in
      `components/movies/Movie.tsx` only while shorts are enabled, and read `getMediaCapabilities()`
      in the detail page alongside its existing `Promise.all`. On `{ error }` the switch reverts and
      shows the translated message. → T010, T006
      *Done when:* flipping the toggle on an existing film moves its card from `/movies` to
      `/shorts` after a reload and badges it in `/search`; the toggle is absent with shorts off; and
      a refusal leaves the switch in its previous position with the error visible.
- [ ] **T016** `[web] [P]` Add the shorts `Switch` + hidden input and the `path_shorts` `PathPicker`
      to `MediaManagerPanel.tsx` (switch `disabled={!moviesOn}`, picker
      `disabled={!moviesOn || !shortsOn}`), pass the two values from `SettingsForm.tsx`, and register
      `path_shorts` in `EDITABLE_KEYS` and `shorts_enabled` in `BOOLEAN_KEYS` in
      `src/actions/settings.ts`. → T010, T002
      *Done when:* the shorts row is greyed while Movies is off and live when it is on; saving the
      form persists both values (`bin/mysql -e "select value from settings where \`key\` =
      'shorts_enabled'"` reflects the switch); and turning Movies off leaves `shorts_enabled` stored
      unchanged.
- [ ] **T017** `[web]` Reconcile `messages/en.json` and `messages/es.json` for every string added in
      T011–T016, including `errors.media.shorts_disabled` and `errors.media.shorts_not_a_movie`. `es`
      keeps the Rioplatense register. → T011, T012, T013, T014, T015, T016
      *Done when:* `bin/cli web node scripts/check-messages.mjs` exits 0, `bin/npm web run lint` is
      clean and `bin/npm web run build` exits 0, with no visible English string while the UI renders
      in `es`.

### Group 4 — verification and docs

- [ ] **T018** `[docs]` Add a `048-shorts-category` section to `docs/spec/graphql-contract.md`
      covering `MediaCapabilities.shortsEnabled` (effective, never the raw row), `Movie.isShort`,
      `MediaSearchResult.isShort` (per-request, never in the shared Redis shape), the tri-state
      `movies(isShort:)`, `addMedia(asShort:)` and `setMovieShort`, with the five refusals. → T017
      *Done when:* the section exists and its SDL matches `services/api/src/schema.gql` verbatim.
      Note: that document has no `045` section either (`mediaCapabilities` was never written up).
      That gap is **not** this task's to fill — leave it and report it.
- [ ] **T019** `[docs]` Update the affected `CLAUDE.md` files: the root pipeline table (the
      Transcode row's destination, and the search/register rows' mention of the new category), and
      `services/api/CLAUDE.md`'s module map for `MediaCapabilitiesModule`. Re-measure and update the
      "Current state" counts rather than copying the previous numbers. → T017
      *Done when:* the numbers in "Current state" match a fresh `bin/npm api test` /
      `bin/npm web run build` run recorded in the same edit.
- [ ] **T020** `[docs]` Run the full verification block from `plan.md` § Verification, walk the
      eleven acceptance criteria in `spec.md` by hand, tick each box, and set `status: Implemented`
      on `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`. → T018, T019
      *Done when:* `bin/cli api npx --no tsc --noEmit`, `bin/npm api test`,
      `bin/cli api npx prisma migrate status`, `bin/npm web run lint`, `bin/npm web run build` and
      `bin/cli web node scripts/check-messages.mjs` all pass; `git status services/worker` is clean;
      and every AC box in `spec.md` is ticked with no `[ ]` remaining.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

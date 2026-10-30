---
title: TMDB List Import — Tasks
last_updated: 2026-10-28
status: Done
---

# TASKS: TMDB List Import (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation, the contract doc and the manual pass. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer. |

**Measuring.** The stack running on this host may be the end-user install, not this checkout, so
`bin/cli`/`bin/npm` may find no container. In that case, run each *Done when* command through the
throwaway container described in memory (`measuring-without-dev-stack`): `docker run --rm --user
1000:1000 -v "$PWD/services/<svc>":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c '<command>'`.
Report which form was used.

## Tasks

### Group 1 — `api`: independent pieces

- [x] **T001** `[api] [P]` Fix the create race in `MoviesService.register()`
      (`src/movies/movies.service.ts`) and `ShowsService.register()` (`src/shows/shows.service.ts`):
      a Prisma `P2002` on the title `create` re-reads the row by `tmdbId` and continues through the
      existing "already registered" branch. Extend both `*.service.spec.ts` with a forced `P2002`
      case (`api/plan.md` Step 1; spec NFR-4, AC-6b).
      *Done when:* `bin/npm api test -- movies.service shows.service` passes, including a new case
      asserting the caller ends linked and reconciled with no error, for each service.
- [x] **T002** `[api] [P]` Add `UserTmdbList` and `UserTmdbListItem` to `prisma/schema.prisma`
      (back-relation on `User`) with migration `tmdb_list_import`; seed
      `schedule_import_lists_enabled = false` and `schedule_import_lists_cron = 0 */6 * * *` in
      `prisma/seeds/settings.ts`; add both keys to `src/settings/settings.catalog.ts` as
      `boolean`/`cron` (`api/plan.md` Steps 2–3).
      *Done when:* `bin/cli api npx prisma migrate status` reports it applied,
      `bin/mysql -e 'show tables like "user_tmdb_list%"'` lists both tables, and
      `bin/mysql -e 'select value from settings where `key` like "schedule_import_lists%"'` returns
      `false` and `0 */6 * * *`.
- [x] **T003** `[api] [P]` Add `TmdbClient.list(listId, page)` in `src/clients/tmdb/client.ts` on
      top of `fetchOne()`, returning name, `totalPages` and items mapped `movie`→`movie`,
      `tv`→`show` (others dropped); carry TMDB's body `status_code` as an optional field on
      `TmdbHttpError` (`src/clients/tmdb/errors.ts`) (`api/plan.md` Step 4).
      *Done when:* `bin/cli api npx --no tsc --noEmit` exits 0 and a case in
      `src/clients/tmdb/client.spec.ts` shows a 401 body with `status_code: 7` surfaces as
      `TmdbHttpError { status: 401, statusCode: 7 }`.
- [x] **T004** `[api] [P]` Add `src/tmdb-lists/list-reference.ts` (`parseListReference`) and
      `list-reference.spec.ts` with its Article IX header (`api/plan.md` Step 5).
      *Done when:* `bin/npm api test -- list-reference` passes, covering a bare id, `/list/<id>`,
      `/list/<id>-slug`, a locale prefix, a query string and fragment, and `null` for `hello`, `0`,
      a negative number and a `/movie/<id>` URL.

### Group 2 — `api`: the module, contract and task

- [x] **T005** `[api]` Create `TmdbListsService` (`src/tmdb-lists/tmdb-lists.service.ts`) with
      `attach`, `detach`, `listFor` and `importAll` exactly as `api/plan.md` Step 6; export
      `MediaDispatchService` from `src/media/media.module.ts`; add the four `error.tmdbList.*` keys
      to `src/i18n/error-keys.ts` and `messages.en.ts`. Write `tmdb-lists.service.spec.ts` with the
      header and cases listed in `api/plan.md` § Tests → T002, T003, T004
      *Done when:* `bin/npm api test -- tmdb-lists.service` passes with cases for: seen item
      skipped after removal, disabled type skipped and left unseen, failed item left unseen, a
      failing list not stopping the next, two pages read, owned item marked seen without
      `register()`, empty key making no TMDB call, private list (404 and non-7 401) →
      `unreadable`, `status_code` 7 → `catalog_unauthorized`.
- [x] **T006** `[api]` Add `TmdbList` entity, `TmdbListsResolver` (`tmdbLists`, `addTmdbList`,
      `removeTmdbList`, user principal only) and `TmdbListsModule`; import it in `src/app.module.ts`
      (`api/plan.md` Step 7) → T005
      *Done when:* after `api` reboots, `services/api/src/schema.gql` contains `TmdbList`, the query
      and the two mutations exactly as `spec.md` § GraphQL Contract Delta, and nothing else
      changed in it apart from T008's field.
- [x] **T007** `[api] [P]` Add `ImportListsTask` (`src/scheduler/tasks/import-lists.task.ts`),
      register `import_lists` in `scheduler.registry.ts` (`0 */6 * * *`, no `mediaType`) and
      `scheduler.module.ts` (import `TmdbListsModule`) (`api/plan.md` Step 8) → T005
      *Done when:* the admin `scheduledTasks` query lists `import_lists` disabled, and
      `runScheduledTask(id: "import_lists")` with no lists attached completes with outcome `SUCCESS` and
      `itemsProcessed: 0`.
- [x] **T008** `[api] [P]` Add `listImportEnabled` to `MediaCapabilities`
      (`src/media/entities/media-capabilities.entity.ts`) and compute it in
      `MediaCapabilitiesService.read()` from `schedule_import_lists_enabled` by name, without
      importing `scheduler.registry.ts` (`api/plan.md` Step 9) → T002
      *Done when:* `mediaCapabilities { listImportEnabled }` returns `false` for a non-admin user,
      and `true` after the admin enables the task.
- [~] **T009** `[api]` Verify the whole slice → T001, T006, T007, T008
      *Done when:* `bin/cli api npx --no tsc --noEmit`, `bin/npm api test`, `bin/npm api run lint`
      and `bin/comments api` all pass, and the `schema.gql` diff against `master` is exactly the
      spec's SDL delta.

### Group 3 — `web`

Everything here consumes the contract Group 2 produced.

- [x] **T010** `[web]` Add the `TmdbList` type (`src/types/preferences.ts`), `listImportEnabled`
      in `src/types/media.ts` and the capabilities query in `src/actions/media.ts`, and
      `src/actions/tmdb-lists.ts` (`getTmdbLists`, `addTmdbListAction`, `removeTmdbListAction`)
      following `src/actions/preferences.ts` (`web/plan.md` Steps 1–2) → T009
      *Done when:* `bin/cli web npx --no tsc --noEmit` exits 0.
- [~] **T011** `[web]` Build `TmdbListsSection.tsx` and `RemoveTmdbListModal.tsx` in
      `src/components/preferences/`, render the section in its own card in
      `src/app/(dashboard)/preferences/page.tsx`, and add its `en`/`es` copy and the four
      `error.tmdbList.*` translations (`web/plan.md` Steps 3–4) → T010
      *Done when:* `/preferences` shows the section; attaching a public list adds a row with its
      name, "Todavía no se importó" and a TMDB link; `hello` shows `No es un ID ni un enlace de
      lista de TMDB.` inline with the input keeping its value; the disabled-task notice shows while
      the task is off; the section has no horizontal scroll at 375 px.
- [x] **T012** `[web] [P]` Add `schedule_import_lists_enabled` to the boolean keys in
      `src/actions/settings.ts` and the `tasks.import_lists.label/description` copy ("Importar
      listas") in `messages/en.json` and `messages/es.json` (`web/plan.md` Step 5) → T009
      *Done when:* Settings' scheduler section shows "Importar listas" with its description, and
      toggling it on persists across a reload.
- [x] **T013** `[web]` Verify the slice → T011, T012
      *Done when:* `bin/cli web npx --no tsc --noEmit`, `bin/npm web run lint` and
      `bin/comments web` pass.

### Group 4 — verification and docs

- [x] **T014** `[docs] [P]` Add a `109-tmdb-list-import` section to
      `docs/spec/graphql-contract.md`: `TmdbList`, the query, both mutations,
      `MediaCapabilities.listImportEnabled`, the error table and what `web` does with each → T009
      *Done when:* the section exists and matches `spec.md` § GraphQL Contract Delta word for word
      on SDL and error keys.
- [x] **T015** `[docs] [P]` Update the root `CLAUDE.md` "Register title in DB" row (the `import_lists`
      entry point, per-user public TMDB lists, seen-once, the `register()` race fix; add `109` to
      its specs), the `api` `CLAUDE.md` module map (`tmdb-lists/`, the new task) and the `web`
      `CLAUDE.md` `/preferences` notes; append a `docs/spec/history.md` entry measured with its
      commands → T013
      *Done when:* each of the four files mentions `109`, and `history.md`'s new entry carries
      measured typecheck/test counts and the new migration.
- [~] **T016** `[docs]` Run the manual pass in `plan.md` § Verification, walk AC-1 … AC-13 in
      `spec.md` (AC-6b from T001's test) ticking each box (`[~]` where only the maintainer can
      run it), set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md`, `web/plan.md`,
      and `status: Done` here; then run `/pending-acs` → T013, T014, T015
      *Done when:* every AC is `[x]` or `[~]` with its blocker named, and `bin/pending-acs --check`
      exits 0.

### Group 5 — amendment 0.2.0 (lists pages)

- [x] **T017** `[api]` Amendment steps 1–5 in `api/plan.md`: `itemCount` column and migration
      `tmdb_list_item_count`, `TmdbClient.list()` returns it, written on attach and on a successful
      read, `Query.tmdbList(id)` and the `TmdbList.movies`/`shows` field resolvers, with tests.
      *Done when:* `prisma migrate status` up to date; `npx tsc --noEmit` 0 errors;
      `npm test -- tmdb-lists` green with the new cases; `bin/comments api` PASS; after `api`
      reboots `schema.gql` shows exactly the 0.2.0 SDL delta.
- [x] **T018** `[web]` Amendment steps 1–5 in `web/plan.md` → T017
      *Done when:* `npx tsc --noEmit` shows only the known `Calendar.tsx` errors; Biome on the touched
      files clean; `check-messages` parity; `bin/comments web` PASS; `/lists` and `/lists/<id>`
      render on the dev stack and `/preferences` has no lists card.
- [x] **T019** `[docs]` Contract doc, the three `CLAUDE.md` mentions of `/preferences` for lists,
      `history.md`, the manual pass for AC-14 … AC-17, `/pending-acs` → T018

### Group 6 — amendment 0.3.0 (per-title "download automatically")

- [x] **T020** `[api]` `api/plan.md` § Amendment 0.3.0 steps 1–5: `UserMovie.autoAcquire` and
      `UserShow.autoAcquire` (default false) with migration `title_auto_acquire`, `Movie.autoAcquire`/
      `Show.autoAcquire` field resolvers, `setMovieAutoAcquire`/`setShowAutoAcquire`, the filter in
      both sweeps' selection query and owner lookup, and in `forMovieOwners`/`forShowOwners`, with the
      tests listed there. Restart `api` after the migration.
      *Done when:* `prisma migrate status` up to date; `npx tsc --noEmit` 0 errors;
      `npm test -- acquire-movies acquire-episodes ranking-context` green including a case with
      `MAX_MOVIES_PER_RUN` + 1 opted-out films ahead of a wanted one that still gets attached;
      `bin/comments api` PASS; `schema.gql` diff equals the 0.3.0 SDL (AC-19, AC-20, AC-21, AC-22).
- [x] **T021** `[web]` `web/plan.md` § Amendment 0.3.0 steps 1–4: `autoAcquire` in the two detail
      queries, the two actions, `components/media/AutoAcquireSwitch.tsx` under the poster on both
      detail pages only while `status !== "COMPLETED"`, `en`/`es` copy → T020
      *Done when:* tsc shows only the 7 known `Calendar.tsx` errors; Biome clean on new/changed
      files; `check-messages` parity; `bin/comments web` PASS; the switch seen on a `MISSING` film
      and series and absent on a `COMPLETED` film (AC-18).
- [x] **T022** `[docs]` Contract doc (0.3.0 SDL and the two refusals), root `CLAUDE.md` "Find
      release" row (the sweeps skip opted-out owners), `services/api/CLAUDE.md` scheduler/ranking
      notes, `services/web/CLAUDE.md` detail-page notes, `history.md`, the live pass for AC-18 …
      AC-22, ticking only what is observed, statuses back to Implemented/Done, `/pending-acs`
      → T021

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Notes (orchestrator): T009 — tsc 0 errors, comment gate PASS, 265/265 feature tests; full suite 91/93
suites (`session.service.spec`, `upload-tickets.service.spec` need a real Redis, untouched files);
`npm run lint` reports 3180 problems tree-wide in the throwaway container, so lint is unverified and
not attributable to this feature.

Live pass on a stack built from this checkout (2026-10-28, two throwaway users, since removed):
T002 — `prisma migrate status` up to date, both tables present, both settings seeded `false` /
`0 */6 * * *`. T007 — `scheduledTasks` lists `import_lists`; `runScheduledTask` ran `SUCCESS`
(11 titles, then 0 on every rerun). T011 — `/preferences` showed the section, the inline error for
`hello` with the input keeping its value, the row with its last import, and no horizontal scroll at
375 px; the first load threw a hydration error (server and browser formatted `lastImportedAt` in
different time zones), fixed with the `mounted` guard `SchedulingPanel` already uses. Still `[~]`: the
disabled-task notice was not seen on screen, and no private list was available.

Amendment 0.2.0 (2026-10-28): T017 — migration `20261028033541_tmdb_list_item_count` applied, tsc 0,
`tmdb-lists` 20/20 and `client.spec` 57/57 tests, comments PASS, `schema.gql` diff equals the SDL.
The running `api` kept the pre-migration Prisma client in memory (`Unknown argument itemCount`, the
first run `FAILED`) until `docker compose restart api`. T018 — tsc only the 7 known `Calendar.tsx`
errors, Biome clean on new files (3 pre-existing errors in `AppSidebar.tsx`), 762 keys in parity,
comments PASS. Live pass as a non-admin test user (since removed): the sidebar entry, the notice,
`11 titles`, `/lists/7` with 11 posters and the `MOVIE` badge, 10 after a removal, 404 for another
user's id, a missing id and `abc`, no horizontal scroll at 375 px, no lists card on `/preferences`.
Not seen: a series or short badge on a list page (no public list with series was found).

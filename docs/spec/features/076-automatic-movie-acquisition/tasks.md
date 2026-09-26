---
title: Automatic Movie Acquisition — Tasks
last_updated: 2026-09-26
status: Done
---

# TASKS: Automatic Movie Acquisition (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation and the cross-service verification sweep. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

`worker` is not in this feature (NFR-5). Its diff must stay empty — no task touches
`services/worker/`, and `git diff --stat services/worker` is checked in T013. There is no `[infra]`
task: nothing about how the stack boots changes.

**Article XI applies to every new file here.** `acquire-episodes.task.ts`, which T006 copies its
shape from, carries doc comments; the new handler carries none. Rationale lives in `../spec.md` by
REQ number. The only comment these tasks may add is the Article IX test header.

**Precondition, already satisfied** (`../plan.md` § Precondition): `075-movie-refresh-sweep` is
`Implemented` and migration `20260926204113_add_movie_release_windows` is applied, so
`Movie.theatricalReleaseDate`/`digitalReleaseDate`/`physicalReleaseDate` exist. T003 and T006 read
them and must **stop and report** if they ever do not, never add them.

## Tasks

### Group 1 — schema, contract and the window rule

T003 and T004 touch no file T001/T002 touch and depend on nothing, so all three `[P]` tasks here can
be taken in any order.

- [x] **T001** `[api]` Add `acquireTheatrical`, `acquireDigital` and `acquirePhysical` to `User` in
      `prisma/schema.prisma`, each `Boolean @default(false)`, and generate the migration with
      `bin/npm api run prisma:migrate` named `add_user_acquisition_windows`. No backfill — the
      default is the intended value for every existing row (NFR-6/NFR-7). See `api/plan.md` step 1.
      *Done when:* `bin/cli api npx prisma migrate status` reports no pending migration;
      `git status --short services/api/prisma` shows a modified `schema.prisma` and exactly one new
      migration directory; `bin/mysql -e 'select acquireTheatrical, acquireDigital, acquirePhysical
      from users'` returns `0,0,0` for every existing row.
- [x] **T002** `[api] [P]` Expose the preferences contract. Add the three `@Field()` booleans to
      `src/preferences/entities/user-preferences.entity.ts` with the descriptions from `../spec.md`;
      project the three columns in `PreferencesService.findForUser`; add
      `setAcquisitionWindows(userId, { theatrical, digital, physical })` returning the full
      `findForUser` projection, following `setAllowCinemaReleases`' shape; add the
      `setAcquisitionWindows` mutation to `src/preferences/preferences.resolver.ts` under
      `JwtAuthGuard`, refusing a non-user principal with `ERROR_KEYS.AUTH_UNAUTHENTICATED` exactly as
      its neighbours do. All three arguments are required — no partial update (`../plan.md`
      § Contract Freeze). See `api/plan.md` step 2. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors; `bin/npm api test` passes;
      `git diff services/api/src/schema.gql` shows exactly the three `Boolean!` fields on
      `UserPreferences` and `setAcquisitionWindows(theatrical: Boolean!, digital: Boolean!,
      physical: Boolean!): UserPreferences!` and nothing else.
- [x] **T003** `[api] [P]` Add the pure window module `src/scheduler/tasks/acquisition-window.ts`
      plus `acquisition-window.spec.ts`. Promote `startOfUtcDay` here out of
      `src/scheduler/tasks/acquire-episodes.task.ts` and import it back there — one copy, no
      behaviour change. Encode as data, not branches: the three windows with their offsets (2 / 1 / 5
      days) and floors (**none** / 4 / 6), and REQ-4's three fallback chains (theatrical → digital →
      physical; digital → physical; physical → digital). Export one function taking the marks of one
      or more owners, the film's three dates and `now` (a parameter, never read internally), and
      returning either "not open" or `{ openedAt, minSourceRank }` where `minSourceRank` is the
      **lowest** floor among the open resolved windows (REQ-6). Two traps to get right deliberately:
      a window with no floor is `null`, never `0` (REQ-2 — `>= 0` would admit an unclassifiable
      release everywhere); and theatrical is usable only when the owner's `allowCinemaReleases` is on,
      resolving onward through its chain otherwise (REQ-7). No chain may ever reach theatrical. See
      `api/plan.md` step 3 and § Tests.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `bin/npm api test` passes
      with cases for: each window's offset on the day before / of / after it opens, asserted in UTC
      with `now` either side of midnight; each of the three chains, including `physical → digital`
      (AC-6) and an assertion that no chain reaches theatrical (AC-7); theatrical suppressed and
      resolving onward when `allowCinemaReleases` is off (AC-8); the lowest-floor rule with two and
      three windows open; all three dates `NULL` → not open (AC-9); and a no-floor window returning
      `null` rather than `0`. Changing any offset by one day, or adding theatrical to another chain,
      each makes at least one case fail (fault injection, reverted).
- [x] **T004** `[api] [P]` Add the floor veto to `src/indexer/ranking.ts`: `RankingContext` gains
      `minSourceRank?: number | null`, and `rankTorrentResults` gains **one** clause in its existing
      `survivors` filter — beside `isVetoed`, `isDeadSwarm`, `isUpscaled` and the cinema-capture
      check — dropping a row whose `ranking.sourceRank` is below it. It must sit in that filter,
      **before** `maxTier` is computed (REQ-2b): a floor applied after candidacy cannot see past the
      resolution tier and would stall a film forever. Nothing else in the file changes — not
      `compareCandidates`, not `buildRanking`, not the tier derivation. Extend
      `src/indexer/ranking.spec.ts`. See `api/plan.md` step 4 and § Tests.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `bin/npm api test` passes
      with two new cases: an armed `minSourceRank: 6` over a set holding a 2160p WEB-DL and a 1080p
      BluRay remux returns the **remux** as `candidateRank: 1` (AC-5b), and an absent
      `minSourceRank` returns the identical candidate set and order as the pre-existing cases —
      the regression guard for the torrent modal, which has no suite of its own (NFR-8/AC-17). Moving
      the new clause below the `maxTier` computation makes the first case fail (fault injection,
      reverted).
- [x] **T005** `[api]` Add `forMovieOwners(movieId)` to `src/indexer/ranking-context.service.ts`,
      copying `forShowOwners` and changing exactly three things: read `UserMovie`
      (`orderBy: { createdAt: 'asc' }`), use `LanguagesService.findMoviePreferredTrackLanguagesFor`
      and `preferences.movieTorrentGroups`, and compute `allowCinemaReleases` as **every owner
      allows it** rather than the show twin's hardcoded `true` (REQ-10). Expose the owners' three
      marks alongside the context so T006 never re-queries `UserMovie`. Extend
      `ranking-context.service.spec.ts`. See `api/plan.md` step 5 and § Tests. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `bin/npm api test`
      passes with cases for the union of languages and groups across three owners (armed when one
      owner set `audioMandatory`) and for the AND over `allowCinemaReleases` — one owner with it off
      makes the whole film veto captures (AC-15). Flipping that `every` to `some` makes a case fail
      (fault injection, reverted).

### Group 2 — the sweep

Both tasks here need Group 1 complete: the handler reads T003's window rule, arms T004's veto and
calls T005's union, all over T001's columns.

- [x] **T006** `[api]` Add `src/scheduler/tasks/acquire-movies.task.ts` plus
      `acquire-movies.task.spec.ts`, modelled line for line on `acquire-episodes.task.ts` — do not
      invent a second handler shape. One Prisma query for films with at least one owner and at least
      one of the three dates non-null, including `mediaSources`, `processJobs` and the owners with
      their marks; then in memory: keep films where `deriveTitleStatus(...) === 'MISSING'`
      (`src/pipeline-status/pipeline-status.ts` — do not hand-roll a status check), resolve the
      window from the union of owners' marks via T003, keep the open ones, sort by `openedAt`
      ascending and `slice(0, MAX_MOVIES_PER_RUN)` with that constant at 20 (NFR-1). Per film: build
      the query with `buildMovieQuery(title, releaseDate)` — `buildEpisodeQuery`'s cleaning rule plus
      the release year, no year when `releaseDate` is null — call `IndexerService.searchRanked` with
      `minSourceRank` armed (NFR-2: one search per film, through that service so `040`'s cache
      applies), take `candidateRank === 1`, and attach with
      `MoviesService.addTorrentToMovie(..., { force: false })` as the oldest `UserMovie`. Count
      `attached`/`skipped`/`failed`, rethrow only when `failed > 0 && attached === 0 && skipped === 0`
      (REQ-14), return `itemsProcessed: attached`. Do not touch the registry — that is T007. Do not
      call TMDB (NFR-3). See `api/plan.md` step 6 and § Tests. → T003, T004, T005
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `bin/npm api test` passes
      with cases for: a film in flight and a `COMPLETED` film never selected (AC-10); the cap holding
      at 20 with the order oldest-window-first (AC-14); one film's failure leaving the rest attached
      with `itemsProcessed` correct (AC-12); an all-failed run rethrowing (AC-11) while an
      all-skipped run does not (AC-3/AC-5); and zero `searchRanked` calls when nothing is eligible
      (NFR-4). `IndexerService` and `MoviesService` are mocked — this suite is about selection and
      isolation, not Prowlarr.
- [x] **T007** `[api]` Retire `acquire_pending` and register `acquire_movies`. In
      `src/scheduler/scheduler.registry.ts` replace the `acquire_pending` entry with
      `{ id: 'acquire_movies', defaultCron: '0 2 * * *', handler: AcquireMoviesTask, mediaType:
      'movie' }`; delete `src/scheduler/tasks/acquire-pending.task.ts`; swap the provider in
      `src/scheduler/scheduler.module.ts` — that is the **only** change there, `MoviesModule` is
      already imported as of `074`/`075`, so this slice adds no module edge. Rename both keys in
      `prisma/seeds/settings.ts` (`false`, `0 2 * * *`) and in `src/settings/settings.catalog.ts`.
      Do **not** write a data migration to delete the old `settings` rows — they are inert
      (`../plan.md` § Migrations). Then the two stale test subjects: keep the defensive
      no-`mediaType` branch in `SchedulerService.isAvailable` (it is a property of the registry
      shape, not of one task) but rewrite `scheduler.service.spec.ts`'s *"a task with no mediaType
      (acquire_pending) stays available"* case against a synthetic definition, and fix the
      `acquire_pending` mention in that method's doc comment and the
      `schedule_acquire_pending_enabled` key in the settings fixture at line ~204. Add nothing to
      `SCHEDULE_SETTING_KEYS` in `src/settings/settings.resolver.ts` — it derives from
      `SCHEDULED_TASKS`. See `api/plan.md` steps 7–9. → T006
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors; `bin/npm api test` passes
      with `scheduler.service.spec.ts` green and `isAvailable`'s no-`mediaType` branch still present;
      `grep -rn acquire_pending services/api/src services/api/prisma` returns nothing;
      `git diff services/api/src/schema.gql` still shows only T002's four additions.

### Group 3 — consumers

Depends on Group 1 for the contract and on T007 for the renamed Settings key. T009 and T010 both
edit `messages/en.json` and `messages/es.json`, so they are deliberately **not** parallel — two
agents editing one JSON file is a merge conflict, not concurrency.

- [x] **T008** `[web]` Add the three booleans to `src/types/preferences.ts`; add them to
      `PREFERENCES_QUERY`, to `getPreferences`' `?? {}` fallback (as `false`) and to **every**
      mutation selection set in `src/actions/preferences.ts` that returns `UserPreferences`, so a
      save never hands the form back a partial object; add
      `setAcquisitionWindowsAction(theatrical, digital, physical)` modelled on
      `setAllowCinemaReleasesAction`, with `redirectToClearSession` on an auth error and
      `translateGraphQLError` otherwise. See `web/plan.md` steps 1–2. → T002
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and `bin/npm web run build`
      exits 0; `grep -c acquireTheatrical services/web/src/actions/preferences.ts` counts one
      occurrence per `UserPreferences` selection set in the file.
- [x] **T009** `[web]` In `src/components/preferences/PreferencesForm.tsx` add three `useState`s
      seeded from `preferences`, three controlled `Checkbox`es (not `Switch` — see `web/plan.md`
      § Existing code to reuse) in the **Movies** panel between the cinema `Switch` and the
      torrent-group picker, one entry in the save `Promise.all` gated on `showMoviesTab`
      (`Promise.resolve(null)` otherwise, exactly as `setPreferredTorrentGroupsAction("MOVIE", …)`
      is), and one error branch rolling all three back together — they are one mutation, so they fail
      as one. Add the three `preferences.form` labels to `messages/en.json` and `messages/es.json`,
      each naming the day the window opens and the quality it accepts, with the theatrical one
      stating it does nothing while cinema releases are not allowed (REQ-16); `es` stays in the
      existing Rioplatense register. Do not block or auto-uncheck theatrical when the cinema switch
      is off (REQ-17). See `web/plan.md` steps 3 and 6. → T008
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors, `bin/npm web run build`
      exits 0, and `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift; on a
      running stack, marking digital and physical on `/preferences` → Movies, saving and reloading
      shows both still marked, confirmed by `bin/mysql -e 'select acquireDigital, acquirePhysical
      from users'` (AC-2).
- [x] **T010** `[web]` Finish the rename on the `web` side: in `src/actions/settings.ts`'s
      `BOOLEAN_KEYS`, `schedule_acquire_pending_enabled` → `schedule_acquire_movies_enabled` (nothing
      else changes there — the cron field is not user-editable and `EDITABLE_KEYS` never carried a
      `schedule_*` key); in both message catalogs rename
      `settings.scheduling.tasks.acquire_pending` to `acquire_movies` and rewrite its copy, which no
      longer means "titles that still have none" but films whose release window has opened (suggested
      wording in `web/plan.md` step 5). `SchedulingPanel.tsx` needs no change — it resolves labels
      through `t.has(...)` with a fallback, which is exactly why a forgotten rename fails quietly.
      See `web/plan.md` steps 4–5. → T007, T009
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors, `bin/npm web run build`
      exits 0, `bin/cli web node scripts/check-messages.mjs` reports no drift,
      `grep -rn acquire_pending services/web` returns nothing, and Settings → Scheduling shows a
      translated `Acquire movies` / `Bajar películas` row with a working toggle and no
      `acquire_pending` row (AC-1).

### Group 4 — verification and docs

- [x] **T011** `[docs]` Update `docs/spec/graphql-contract.md`: the `UserPreferences` block
      (line ~416) gains the three fields and `setAcquisitionWindows` joins `setAudioMandatory`
      beside it, with a sentence on why all three arguments are always sent. Note that
      `RankingContext.minSourceRank` is deliberately **not** in the contract — it is `api`-internal
      and never reaches SDL. → T002, T007
      *Done when:* the file's `UserPreferences` SDL block matches `services/api/src/schema.gql`
      field for field.
- [x] **T012** `[docs]` Update the `CLAUDE.md` files: the root pipeline table's **Find release** and
      **Download** rows gain `076` (a daily `acquire_movies` sweep that picks a release for a film
      whose theatrical/digital/physical window has opened, per-user windows unioned across owners,
      with the quality floor applied as a ranking veto), the spec-ref column gains `076`, and the
      **Register title in DB** row's `075` sentence gains the note that the three dates now have a
      reader. Append a re-measured entry to § Current state and to `services/api/CLAUDE.md`'s own
      current-state paragraph, and record that `acquire_pending` no longer exists as a task id.
      → T010
      *Done when:* the numbers in both files come from a fresh `bin/npm api test`,
      `bin/cli api npx --no tsc --noEmit` and `bin/npm web run build` run in this task, not copied
      from a previous entry.
- [x] **T013** `[docs]` Run `../plan.md` § Verification end to end — the six `bin/` commands plus
      `git diff services/api/src/schema.gql` and `git diff --stat services/worker` (must be empty,
      NFR-5) — then the 13-step manual pass. Walk every acceptance criterion in `../spec.md`, tick
      the boxes that were actually observed and leave unticked the ones that were not, saying which
      and why. Then set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and
      `web/plan.md`, and `status: Done` on this file. → T011, T012
      *Done when:* every command above passes, the `schema.gql` diff is exactly T002's four
      additions, `git diff --stat services/worker` is empty, and every AC box in `../spec.md` is
      either ticked or accompanied by the reason it was not reachable on this stack.

## Coverage

Every acceptance criterion in `../spec.md` is reachable: AC-1 → T001/T007/T010; AC-2 → T008/T009;
AC-3, AC-4, AC-10, AC-11, AC-12, AC-14 → T006; AC-5, AC-5b, AC-17 → T004; AC-6, AC-7, AC-9 → T003;
AC-8 → T003/T005; AC-13 → T007 (`mediaType: 'movie'` restores the existing `045` refusal);
AC-15 → T005; AC-16 → T001/T009/T010; all of them re-checked live in T013.

## Live pass

Not run: AC-1's Scheduling-UI half, AC-2, AC-3 to AC-15 and AC-17 against a running stack — the dev
stack has no admin credentials available to the session, and steps 3 to 12 attach real torrents.
Observed: `users` acquisition columns all `0`, `schedule_acquire_movies_*` seeded `false`/`0 2 * * *`,
`prisma migrate status` up to date, AC-16. The rest rests on unit tests (T003, T004, T005, T006).

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice. The same applies
to the three `Movie` date columns — a missing column is a stop, never a new migration.

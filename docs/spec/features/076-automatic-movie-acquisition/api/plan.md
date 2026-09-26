---
title: Automatic Movie Acquisition — api slice
service: api
last_updated: 2026-09-26
status: Implemented
---

# PLAN: Automatic Movie Acquisition — `api` (`api/plan.md`)

## Scope

This slice owns everything except the three checkboxes: the migration for the three `User` columns,
the three `UserPreferences` fields and `setAcquisitionWindows`, the pure window-resolution module,
one optional veto in the existing ranking, the per-owner union for a film, and the `acquire_movies`
scheduled task that replaces the `acquire_pending` stub.

It does **not** touch `services/web` (the `/preferences` UI and the two renamed Settings/message keys
are `web`'s slice) and does **not** touch `services/worker` at all (NFR-5 — the worker must remain
unable to tell an automatically attached source from a manual one). Writes are confined to
`services/api/` and this directory.

**Stop-and-report condition, before anything else:**
`grep -n 'theatricalReleaseDate\|digitalReleaseDate\|physicalReleaseDate' services/api/prisma/schema.prisma`.
If those three columns are absent, `075-movie-refresh-sweep` has not shipped. Stop and report — do
**not** add them here (`../plan.md` § Precondition).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` | Modified | `User` gains `acquireTheatrical`/`acquireDigital`/`acquirePhysical`, `Boolean @default(false)` |
| `prisma/migrations/<ts>_add_user_acquisition_windows/` | New | The generated migration, via `bin/npm api run prisma:migrate` |
| `prisma/seeds/settings.ts` | Modified | `schedule_acquire_pending_{enabled,cron}` → `schedule_acquire_movies_{enabled,cron}`, value `false` / `0 2 * * *` |
| `src/settings/settings.catalog.ts` | Modified | Same two keys renamed (lines ~85–86) |
| `src/preferences/entities/user-preferences.entity.ts` | Modified | Three `@Field()` booleans with the descriptions from `../spec.md` |
| `src/preferences/preferences.service.ts` | Modified | `findForUser` projects the three columns; new `setAcquisitionWindows(userId, {theatrical, digital, physical})` |
| `src/preferences/preferences.resolver.ts` | Modified | `setAcquisitionWindows` mutation, `JwtAuthGuard`, non-user principal refused like its neighbours |
| `src/indexer/ranking.ts` | Modified | `RankingContext.minSourceRank?: number \| null`; one veto in `rankTorrentResults`' survivor filter |
| `src/indexer/ranking.spec.ts` | Modified | Cases for the veto armed and, crucially, absent |
| `src/indexer/ranking-context.service.ts` | Modified | New `forMovieOwners(movieId)` |
| `src/indexer/ranking-context.service.spec.ts` | Modified | Cases for the union and the AND over `allowCinemaReleases` |
| `src/scheduler/tasks/acquisition-window.ts` | New | Pure module: `startOfUtcDay`, the window table, the fallback chains, `resolveWindows()` |
| `src/scheduler/tasks/acquisition-window.spec.ts` | New | The Article IX suite for this slice |
| `src/scheduler/tasks/acquire-movies.task.ts` | New | The handler, modelled on `acquire-episodes.task.ts` |
| `src/scheduler/tasks/acquire-movies.task.spec.ts` | New | Selection, ordering, cap, per-film isolation, the all-failed rethrow |
| `src/scheduler/tasks/acquire-pending.task.ts` | **Deleted** | Replaced by the above (REQ-8) |
| `src/scheduler/tasks/acquire-episodes.task.ts` | Modified | Imports `startOfUtcDay` from `acquisition-window.ts` instead of declaring it |
| `src/scheduler/scheduler.registry.ts` | Modified | `acquire_pending` entry → `acquire_movies`, `mediaType: 'movie'`, `defaultCron: '0 2 * * *'` |
| `src/scheduler/scheduler.module.ts` | Modified | `AcquirePendingTask` → `AcquireMoviesTask` in `providers`. `MoviesModule` is **already** imported (`074`/`075` added it) — no import change is needed |
| `src/scheduler/scheduler.service.ts` | Modified | The `isAvailable` comment naming `acquire_pending` as its example |
| `src/scheduler/scheduler.service.spec.ts` | Modified | The "task with no mediaType" case — see § Steps 9 |

## Existing code to reuse

- `src/scheduler/tasks/acquire-episodes.task.ts` — the template for this whole handler: sequential
  walk, per-item `try/catch`, `attached`/`skipped`/`failed` counters, the all-failed rethrow, the
  per-title memoisation of the ranking context. Copy its shape; do not invent a second one. Its
  `startOfUtcDay` moves out (step 3) and its `buildEpisodeQuery` is the model for `buildMovieQuery`.
- `src/pipeline-status/pipeline-status.ts` — `deriveTitleStatus({status, sources, jobs})` is the
  definition of "nothing in flight" (REQ-9). Do not hand-roll a status check; the film twin needs no
  `deriveEpisodeStatus` equivalent because there is no season-pack lift for a film.
- `src/indexer/indexer.service.ts` — `searchRanked(query, context)` is the only way this slice talks
  to Prowlarr, which is what makes `040`'s 10-minute Redis cache apply (NFR-2).
- `src/indexer/ranking-context.service.ts` — `forShowOwners(showId)` is the exact shape
  `forMovieOwners(movieId)` must take, including its reuse of `PreferencesService.findForUser` and
  `LanguagesService.findMoviePreferredTrackLanguagesFor`, and its private `effectiveAudio` fallback.
  Note the two differences in step 5.
- `src/movies/movies.service.ts` — `addTorrentToMovie(movieId, {infoHash, urls, releaseTitle, force},
  userId)` resolves a missing `infoHash` itself (`037`) and runs the race arbiter. The sweep calls it
  and nothing below it.
- `src/preferences/preferences.service.ts` — `setAllowCinemaReleases`/`setAudioMandatory` are the
  pattern for the new setter: write, then return the full `findForUser` projection so the caller gets
  a whole `UserPreferences` back.
- `src/settings/settings.resolver.ts` — `SCHEDULE_SETTING_KEYS` is derived from `SCHEDULED_TASKS`, so
  the re-arm on a `schedule_*` change covers the new id with **no edit**. Do not add it by hand.

## Steps

1. **Schema + migration.** Add the three booleans to `User` in `prisma/schema.prisma`, then
   `bin/npm api run prisma:migrate` with the name `add_user_acquisition_windows`. No backfill.
2. **Preferences surface.** Entity fields, `findForUser` projection, `setAcquisitionWindows` in the
   service, the mutation in the resolver (`JwtAuthGuard`, refuse a non-user principal with
   `ERROR_KEYS.AUTH_UNAUTHENTICATED` exactly as its neighbours do). Shape is frozen in `../spec.md`.
3. **The pure window module** (`acquisition-window.ts`). Promote `startOfUtcDay` here from
   `acquire-episodes.task.ts` and import it back there. Then, as data rather than branches: the three
   windows with their offsets (2/1/5 days) and floors (none / 4 / 6), and the three fallback chains of
   REQ-4. Export one function that takes the marks of one or more owners plus the film's three dates
   and `now`, and returns either "not open" or `{ openedAt, minSourceRank }` where `minSourceRank` is
   the **lowest** floor among the open resolved windows (REQ-6) and `null` means no floor. Two traps
   to encode deliberately: a window with no floor is `null`, never `0` (REQ-2 — `>= 0` would admit an
   unclassifiable release everywhere); and theatrical is usable only when the owner's
   `allowCinemaReleases` is on, resolving through its chain otherwise (REQ-7).
4. **The ranking veto.** `RankingContext` gains `minSourceRank?: number | null`. In
   `rankTorrentResults`, add one clause to the existing `survivors` filter — beside `isVetoed`,
   `isDeadSwarm`, `isUpscaled` and the cinema-capture check — dropping a row whose
   `ranking.sourceRank` is below it. It must sit **in that filter**, before `maxTier` is computed
   (REQ-2b): that is the whole point. Nothing else in the file changes — not `compareCandidates`, not
   `buildRanking`, not the tier derivation.
5. **`forMovieOwners(movieId)`.** Copy `forShowOwners`, then change three things: read `UserMovie`
   (with `orderBy: {createdAt: 'asc'}`), use `findMoviePreferredTrackLanguagesFor` and
   `preferences.movieTorrentGroups`, and compute `allowCinemaReleases` as **`every` owner allows it**
   rather than the show twin's hardcoded `true` (REQ-10). Return the owners' marks alongside the
   context, or expose a second small method for them — the task needs both and must not re-query
   `UserMovie` itself.
6. **The handler** (`acquire-movies.task.ts`). One Prisma query for films that have at least one owner
   and at least one of the three dates non-null, including `mediaSources`, `processJobs` and
   `users: { include: { user: true } }`. Then in memory: `deriveTitleStatus(...) === 'MISSING'`,
   resolve the window from the union of owners' marks, keep the open ones, sort by `openedAt`
   ascending, `slice(0, MAX_MOVIES_PER_RUN)` with the constant at 20 (NFR-1). Per film: build the
   query (`buildMovieQuery(title, releaseDate)` — the `buildEpisodeQuery` cleaning rule plus the
   release year, no year when `releaseDate` is null), `searchRanked` with `minSourceRank` armed, take
   `candidateRank === 1`, `addTorrentToMovie(..., force: false)` as the oldest `UserMovie`. Count
   `attached`/`skipped`/`failed`; rethrow only when `failed > 0 && attached === 0 && skipped === 0`,
   the same condition `acquire-episodes.task.ts` uses (REQ-14). Return `itemsProcessed: attached`.
7. **Registry + module.** Replace the `acquire_pending` entry with
   `{ id: 'acquire_movies', defaultCron: '0 2 * * *', handler: AcquireMoviesTask, mediaType: 'movie' }`
   and delete `acquire-pending.task.ts`. In `scheduler.module.ts`, swap the provider — that is the
   only change there: `MoviesModule` is already in `imports` as of `074`/`075`, so this slice adds no
   module edge at all.
8. **Seed + catalog.** Rename both keys in `prisma/seeds/settings.ts` (value `false`, cron
   `0 2 * * *`) and in `src/settings/settings.catalog.ts`. Do not write a data migration to delete the
   old rows — they are inert (`../plan.md` § Migrations).
9. **The two stale test subjects.** `scheduler.service.spec.ts` has a case named *"a task with no
   mediaType (acquire_pending) stays available regardless of the media flags"*. After step 7 every
   registered task has a `mediaType`, so that case has no subject. **Keep the defensive branch in
   `isAvailable`** — it is a property of the registry shape, not of one task — and rewrite the case
   against a synthetic definition rather than a real id. Also fix the `acquire_pending` mention in the
   `isAvailable` doc comment and the `schedule_acquire_pending_enabled` key in the settings map
   fixture at line ~204.

## Contract obligations

This slice must expose exactly what `../spec.md` § GraphQL Contract Delta freezes: three
`Boolean!` fields on `UserPreferences` (`acquireTheatrical`, `acquireDigital`, `acquirePhysical`) and
`setAcquisitionWindows(theatrical: Boolean!, digital: Boolean!, physical: Boolean!): UserPreferences!`.
Nothing more — in particular no SDL for the task (the `035` machinery already carries any registry
id) and nothing for `RankingContext.minSourceRank`, which is internal and must never reach the schema.

`git diff services/api/src/schema.gql` at the end must show those four additions and nothing else. It
is generated, never edited (Article IV). One removal is expected **outside** the schema and must be
mentioned in the report: `runScheduledTask('acquire_pending')` now answers the existing
`error.schedule.task_unknown`, because the id leaves the registry.

## Tests

Owed under Article IX — each of these fails with no error anywhere:

- `src/scheduler/tasks/acquisition-window.spec.ts` — the core of the feature and the only fully silent
  part. Cases: each window's offset at the day before / the day of / the day after it opens; each of
  the three fallback chains, including `physical → digital` (the `The Wrecking Crew` case) and the
  assertion that **no** chain reaches theatrical; theatrical suppressed when `allowCinemaReleases` is
  off and resolving onward; the lowest-floor rule with two and three windows open; all dates `NULL`
  resolving to "not open"; and a no-floor window returning `null` rather than `0`. UTC boundaries
  asserted with `now` values either side of midnight, `now` passed as a parameter rather than read
  internally (the rule `041` set for the same reason).
- `src/indexer/ranking.spec.ts` (extended) — two cases. That an armed `minSourceRank` removes the
  low-source rows **before** the tier is chosen, so a 1080p remux beats a 2160p WEB-DL; and that an
  absent `minSourceRank` returns the identical candidate set and order to the existing cases. The
  second is the regression guard for the torrent modal (NFR-8), which has no test suite of its own.
- `src/scheduler/tasks/acquire-movies.task.spec.ts` — that a film in flight or `COMPLETED` is never
  selected; that the cap holds at 20 and the order is oldest window first; that one film's failure
  leaves the rest attached and `itemsProcessed` correct; that all-failed rethrows and
  all-skipped does not. Mock `IndexerService` and `MoviesService` — this suite is about selection and
  isolation, not about Prowlarr.
- `src/indexer/ranking-context.service.spec.ts` (extended) — the union across owners, and the AND over
  `allowCinemaReleases`: one owner with it off must veto captures for the whole film. Getting this
  backwards puts a CAM in a library silently.

**Not owed**: the `setAcquisitionWindows` resolver and service (a plain column write whose failure is
a visible GraphQL error), the entity fields, the migration, and the seed/catalog rename (a wrong key
makes `updateSettings` refuse loudly). `preferences.service.spec.ts` may gain a projection case if it
already covers `findForUser`; it is not required.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
git diff services/api/src/schema.gql
git status --short services/api/prisma
```

`tsc` reports 0 errors; the suite is green with the four new/extended files and no pre-existing suite
broken (baseline in `services/api/CLAUDE.md`; `scheduler.service.spec.ts` must still pass after step
9); `migrate status` reports no pending migration; the `schema.gql` diff is the four additions above;
`git status --short services/api/prisma` shows a modified `schema.prisma`, a modified
`seeds/settings.ts` and exactly one new migration directory (Article III).

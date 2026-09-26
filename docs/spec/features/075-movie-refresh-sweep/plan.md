---
title: Movie Refresh Sweep — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-26
status: Approved
---

# PLAN: Movie Refresh Sweep (`plan.md`)

## Approach

One service, one migration, three seams. Nothing here is a new subsystem — every piece extends
something that already exists.

**The release-dates seam.** `TmdbClient.earliestMovieReleaseDate()`
(`services/api/src/clients/tmdb/client.ts`) already fetches `GET /movie/{id}/release_dates` and
walks every country's entries, then throws the `type` discriminator away and returns one earliest
day. That method is **replaced**, not joined by a second one (Article X): the same single request and
the same loop now also keep the earliest theatrical, digital and physical day, and the method returns
all four. Its two callers are both in `MoviesService` (`register()`'s `topUpCatalogFacts` and `069`'s
`refreshCatalog`), so the replacement is confined to one file plus the client and its spec. Adding a
parallel `typedMovieReleaseDates()` next to the existing one would have been the smaller diff and the
worse design: two methods hitting the same endpoint is how the two disagree about what "earliest"
means six months from now.

**The write seam.** `MoviesService.refreshCatalog(id, tmdbId)` is already the one place that defines
what a film's catalog refresh writes — `069` built it for the manual button. It gains the three typed
dates, `tmdbStatus`, and the closure evaluation, and it becomes **public** so the sweep calls exactly
the same method the Refresh button calls. That is what makes REQ-5, REQ-7 and REQ-11 one
implementation instead of three, and it is why `RefreshMoviesTask` ends up thin: select, loop, count.
The alternative — the task doing its own `movie.update` the way `RefreshEpisodesTask` does its own
`episode.update` — was rejected here because `041` had no manual counterpart to stay in step with and
this feature does.

**The closure seam.** Whether a film is closed is a pure function of its four dates, its TMDB status
and the current time, so it is a pure function in its own file (`movies/release-window.ts`), following
`media/content-kind.ts` (`057`) rather than living inline the way `isShortRuntime` does. It is the
one unit in this feature whose bug is completely silent — a film wrongly closed simply stops being
refreshed, with no error, no log and no UI anywhere — so it is the unit that carries the test budget
(Article IX).

`register()` is the one path that does **not** route through `refreshCatalog`: it creates a row rather
than updating one, so it writes the new columns from the topped-up cache entry directly. It
deliberately never closes a film (see § Decisions the spec did not make).

Reused as-is, named so no implementer reinvents them: `MoviesService.refreshCatalog` /
`refresh` / `topUpCatalogFacts` / `cacheMovies` / `getCachedMovie`
(`services/api/src/movies/movies.service.ts`), `posterUrl()`
(`services/api/src/clients/tmdb/client.ts`), the `SCHEDULED_TASKS` registry entry for
`refresh_movies` and its `mediaType: 'movie'` gating (`services/api/src/scheduler/scheduler.registry.ts`),
`SchedulerService.runTask`'s throw-means-`FAILED` contract
(`services/api/src/scheduler/scheduler.service.ts`), and `RefreshEpisodesTask`'s handler shape —
sequential loop, per-item `try`/`catch`, throw at the end with counts
(`services/api/src/scheduler/tasks/refresh-episodes.task.ts`).

## Order of Work

Single service, so this is an ordering of steps rather than of agents. No step may run before the
migration exists, because every later step writes columns that do not yet exist.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | The Prisma migration — five nullable columns on `Movie`. Everything below writes or reads them; a slice written first would not typecheck against the generated client. |
| 2 | `api` | `TmdbClient` returns the four dates. The write seam cannot store what the client does not yet hand it. |
| 3 | `api` | `release-window.ts` — the pure closure rule and its spec. Independent of steps 2 and 4; can be written in parallel with step 2 by a second hand, since it imports nothing from the client. |
| 4 | `api` | `MoviesService` — `refreshCatalog` goes public and writes dates, status and closure; `register()` writes dates and status. Needs steps 1, 2 and 3. |
| 5 | `api` | `RefreshMoviesTask` — select, loop, count, throw with counts. Needs step 4. |
| 6 | `api` | Wire `MoviesModule` into `SchedulerModule` (see § Risks for the cycle). Can land with step 5. |
| 7 | `docs` | Update the root `CLAUDE.md` "Register title in DB" row and `services/api/CLAUDE.md`'s `scheduler/` and `movies/` notes. Last, so it describes what shipped. |

Steps 2 and 3 are the only genuinely parallel pair. Everything else is a chain.

## Contract Freeze

`spec.md`'s `## GraphQL Contract Delta` is **None**, and frozen as of `status: Approved`. That is the
part an implementer will be tempted to improve, so state it plainly:

- **No field is added to `Movie` in GraphQL.** The five columns are internal. An implementer who adds
  `@Field()` to them — because they are right there and it is one line — ships an unannounced
  contract change to two services that retype the schema by hand (Article VIII). `web` renders no
  date and no badge in this feature.
- **`TitleRefresh` and `RefreshCatalogOutcome` are unchanged.** A film that closed or reopened during
  a manual refresh still reports `DONE`. A new outcome value (`CLOSED`, say) would be a contract
  change and would also be wrong: closure is not an outcome of the refresh, it is a consequence of
  what the refresh read.
- **`MediaSearchResult.status` is not the field for TMDB's production status.** It already exists on
  both the cached shape (`clients/types.ts`) and the GraphQL entity
  (`media/entities/media-search-result.entity.ts`), where it carries the *pipeline* status
  (`MISSING`/`ENCODING`/…) that `web` renders on a search result. Writing `Released` into it would
  put a TMDB string where `web` expects a `MediaStatus`. The cached shape gets a separately named
  optional field instead (`api/plan.md` § Steps).
- **`Movie.releaseDate` keeps its meaning** (REQ-2): earliest day of any type in any country. It is
  tempting to "fix" it to the theatrical date now that a theatrical column exists. `062`'s calendar
  reads it.

If the delta has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief. Never patch it
from inside the slice.

## Migrations

One migration, owned by `api`, generated through `bin/npm api run prisma:migrate`.

1. `add_movie_release_windows` (name it for what it does; the timestamp prefix is Prisma's) — adds
   five nullable columns to `movies`: `theatricalReleaseDate`, `digitalReleaseDate`,
   `physicalReleaseDate` (all `DateTime?`), `tmdbStatus` (`String?`) and `catalogClosedAt`
   (`DateTime?`).
2. Backfill: **none** (NFR-5). Every existing row starts with five `NULL`s, which is exactly an
   *open* film with no known dates — REQ-6's eligible state. The first armed occurrence of
   `refresh_movies` fills the columns of every non-`COMPLETED` film and closes the ones whose dates
   turn out to have aged out. That first run is the largest this task will ever be (NFR-6) and must
   not be capped or split.

Reversibility: fully reversible. Dropping the five columns returns the system to today's behaviour —
the sweep stops working, the manual refresh writes what it wrote before, and nothing else reads them.
Nothing outside `api` has ever seen them (contract delta: None), so no consumer breaks.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **A wrong closure rule** | The single genuinely silent failure in this feature. An off-by-one on the 365-day window, or treating "no dates at all" as aged out, closes films that were still moving. Nothing errors, nothing logs, no UI shows it — the film simply never refreshes again, and `acquire_movies` later never sees the digital date that did arrive. | `release-window.ts` is a pure function with a spec covering both boundaries, the future-date case, the no-dates case and `Canceled` (Article IX). AC-4, AC-5, AC-7 verify it live. |
| **Closing on a TMDB outage** | A night with an expired or rate-limited TMDB key answers nothing for every film. If closure were evaluated from what the row *currently* holds rather than from a successful read, one bad night would close a large part of the library permanently — and the run would even report `FAILED` while the damage was already written. | REQ-9: closure is evaluated only inside the success branch of `refreshCatalog`, after the update, from the values just read. AC-11 is the live check: two eligible films, invalid key, neither closed. |
| **`MediaSearchResult.status` collision** | TMDB's `Released`/`Canceled` written into the cached entry's existing `status` field leaks into a search result's status badge in `web`, where it is compared against `MediaStatus` values. No type error (both are `string?`), no runtime error — just a film that renders with a status nobody recognises, for the cache TTL. | The cached shape gets a distinct field name; `status` is left alone. Called out in § Contract Freeze and in `api/plan.md`. |
| **A second TMDB request per registration** | REQ-5/REQ-3 forbid it, and it is easy to break invisibly: `register()` has a warm-cache path that today makes zero detail calls. Adding an unconditional `movieReleaseDates()` call to write the new dates would make every registration pay for one more request, visible only as a slower add and a busier key. | The typed dates ride the existing `topUpCatalogFacts` `needsRelease` branch and the cache entry. `movies.service.spec.ts` already asserts the call budget of a warm registration — extend it rather than replace it. |
| **`Movie.tmdbStatus` never filled on a warm registration** | Not a bug, but it looks like one to an implementer who then adds a detail call to "fix" it. | REQ-5 states it: a warm registration leaves it `NULL`, and `NULL` is eligible, so the first sweep fills it. Do not add the call. |
| **Nest circular dependency at boot** | `SchedulerModule` must reach `MoviesService`, and `MoviesModule → SettingsModule → forwardRef(SchedulerModule)` already closes a cycle. A plain import may resolve fine or may fail at boot with "Nest can't resolve dependencies" / an `undefined` provider — and an `undefined` `MoviesService` inside a task that only runs on a cron tick is a failure nobody sees until 4am. | Import it and check the boot log. If Nest complains, use `forwardRef(() => MoviesModule)` on the `SchedulerModule` side (the pattern already in `settings.module.ts`). Verification below boots the stack and triggers the task manually, which exercises the injection before any cron does. |
| **The first sweep on a large library** | Every non-`COMPLETED` film eligible at once, two sequential TMDB requests each. Slow, and on a big library it holds `runningTaskIds` for a long time — during which a cron tick records a `SKIPPED` row rather than doubling up. | Correct by design (NFR-1/NFR-6), not a failure. Worth knowing before someone reports "the first run took twenty minutes" as a bug. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/npm api run prisma:migrate
bin/cli api npx prisma migrate status
git status --short services/api/prisma
git diff --stat services/web services/worker
```

Expected: 0 typecheck errors; the api suite green with a strictly higher test count than before;
`migrate status` reporting no pending migration; `git status` on `prisma/` showing both a modified
`schema.prisma` and exactly one new migration directory (AC-13); the last command printing nothing
(AC-14).

`schema.gql` must **not** appear in the diff. It may only ever appear as a regeneration artifact
(Article IV) and this feature changes no decorator, so the cleanest outcome is that it does not
appear at all.

Then the manual pass, on a dev stack with at least three registered films — one upcoming, one
released within the last year, one released more than a year ago with no digital or physical date:

1. `bin/mysql -e "select id, title, releaseDate, theatricalReleaseDate, digitalReleaseDate, physicalReleaseDate, tmdbStatus, catalogClosedAt from movies"` — AC-1 on a film registered after this ships.
2. Settings → Scheduling → `refresh_movies` → "Ejecutar ahora". Re-run the query above and read the
   run row's outcome and `itemsProcessed` off the panel — AC-2, AC-4's first half, AC-5, AC-6, AC-7.
3. Trigger it a second time with nothing changed — AC-4's second half (the aged-out film is no longer
   selected) and AC-7 (the dateless film still is).
4. `bin/mysql -e "update movies set status='COMPLETED' where id=<id>"`, trigger again — AC-3.
5. Press Refresh on `/movies/<id>` of the closed film — AC-8.
6. Set `movie_db_api_key` in Settings to an invalid value, trigger — AC-11: `FAILED`, counts in the
   error, nothing closed, nothing blanked. Restore the key and trigger again.
7. Set `movies_enabled` to `false` in Settings, trigger — AC-12: the `error.schedule.task_unavailable`
   refusal, no new run row.
8. `setMovieContentKind`/`setMovieShort` on an eligible film, then trigger — AC-9. And with a
   `DOWNLOADING` source present — AC-10.

Every acceptance criterion in `spec.md` is reachable from this section.

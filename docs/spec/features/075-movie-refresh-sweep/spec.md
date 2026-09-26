---
title: Movie Refresh Sweep
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-26
last_updated: 2026-09-26
status: Implemented
services: [api]
---

# SPEC: Movie Refresh Sweep (`spec.md`)

## Context & Goal

`035-scheduled-tasks` shipped four scheduled-task handlers, three of them deliberate no-op stubs.
`041-episode-info-refresh` filled `refresh_episodes`; `074-show-refresh-sweep` fills `refresh_shows`
and names this feature in its § Out of Scope as the remaining one. `refresh_movies`
(`services/api/src/scheduler/tasks/refresh-movies.task.ts`) is still the original stub: it arms, it
runs, it reports zero items processed, and it does nothing. A film's row is written once by
`MoviesService.register()` and revisited only when a user presses the Refresh button of
`069-title-refresh`.

For a film that has not come out yet, that is the wrong shape. A film registered while it is still
in cinemas — or before it even opens — has exactly one interesting fact that changes over the
following months: **when it becomes obtainable**. TMDB knows this, and knows it in more detail than
Perceptor stores. `GET /movie/{id}/release_dates` returns a per-country list of typed entries
(premiere, limited theatrical, theatrical, digital, physical, TV), and `TmdbClient` already calls
that endpoint — but `earliestMovieReleaseDate()` collapses the whole response into a single
earliest-anywhere day and throws the types away. So Perceptor can tell you a film opened in March
and cannot tell you whether a digital release has been announced, which is the only date a download
can follow. `074`'s sibling problem was solved the same way: the answer was already on the wire and
nobody stored it.

There is a second half, and it is what keeps this from being a sweep that grows without bound. A
film released two years ago with no digital or physical date on TMDB almost certainly never got one
that TMDB records, and re-asking every night forever is waste with no upside — the same waste
`deployment-scale` asks us to avoid. So a film whose dates have all aged past a year, and a film
TMDB reports as `Canceled`, get **closed**: a recorded decision that Perceptor stops asking about
this title, visible in the database with the moment it was taken, and cleared by the manual refresh
of `069` when a human disagrees. Closure is what bounds the sweep, which is why this feature needs
no per-title cadence and no per-run cap: the set of open films *is* the budget.

This touches the "Register title in DB" stage of the root `CLAUDE.md` pipeline table. No stage
changes status, no GraphQL surface changes, and neither `web` nor `worker` is involved — the visible
artifacts are three new dates per film, a closure marker, and a `refresh_movies` run whose
`itemsProcessed` is no longer always zero. It is a spec rather than a one-file change because it
adds Prisma columns (Constitution, Articles III and VII). It is a **refresh** feature: it writes
catalog rows and never searches the indexer, never attaches a source, never enqueues a job. Acting
on the dates it stores is `acquire_movies`, a separate spec that `073-automatic-episode-acquisition`
§ Out of Scope already reserves the `acquire_pending` id for.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Store the three typed dates)**: `Movie` must carry the theatrical, digital and
      physical release dates separately, each nullable. Each is derived from
      `GET /movie/{id}/release_dates` as the **earliest matching day across every country** TMDB
      lists: theatrical is the earliest entry of TMDB's limited-theatrical or theatrical types,
      digital the earliest digital entry, physical the earliest physical entry. A type TMDB has no
      entry for anywhere stores `NULL`. Premiere and TV entries feed no typed column.
- [ ] **REQ-2 (`releaseDate` keeps its meaning)**: The existing `Movie.releaseDate` must continue to
      mean the earliest release day of any type in any country, exactly as
      `earliestMovieReleaseDate()` computes it today. `062-release-calendar` and every listing read
      it, and this feature changes nothing they see.
- [ ] **REQ-3 (One request for all four dates)**: Reading the typed dates must not cost a second
      TMDB request. The one call to `/movie/{id}/release_dates` that already happens yields
      `releaseDate` and all three typed dates together (Article X: collapse, do not add a parallel
      path to the same endpoint).
- [ ] **REQ-4 (Persist the TMDB status)**: `Movie` must carry TMDB's production status for the film
      verbatim off the wire (`Rumored`, `Planned`, `In Production`, `Post Production`, `Released`,
      `Canceled`, or any value TMDB adds later). `MovieDetail.status` is already mapped by
      `TmdbClient` and stored nowhere.
- [ ] **REQ-5 (Written wherever a detail response is already in hand)**: Every path that already
      reads a film's TMDB detail or release dates must write REQ-1's dates and REQ-4's status:
      registration (`MoviesService.register()`) and the manual refresh of `069`
      (`MoviesService.refreshCatalog()`), besides this feature's own sweep. **No path may gain a
      TMDB request it does not make today** — a registration served from a warm cache that needs no
      detail call must stay one call cheaper and leave the status `NULL`, which the first sweep then
      fills.
- [ ] **REQ-6 (Eligibility)**: A film is swept when **both** hold: its stored `status` is not
      `COMPLETED`, and it is not closed (REQ-8). Nothing else narrows the set — closure is the
      bound, so a film with no dates at all is swept, and a film whose file is already in the
      library never is.
- [ ] **REQ-7 (What a refresh writes)**: For each swept film the sweep must write exactly what the
      manual refresh's catalog step writes — `title`, `overview`, `posterUrl`, `releaseDate` and
      `originalLanguage` — plus REQ-1's three dates and REQ-4's status. A field TMDB answers as
      empty must never erase a value Perceptor already holds (same rule as `069` REQ-3).
- [ ] **REQ-8 (Closure)**: `Movie` must carry a nullable marker recording that Perceptor has stopped
      refreshing this film and when that was decided. Immediately after a film's refresh succeeds,
      the sweep must set it when **either** holds:
      - **aged out** — none of the three typed dates nor `releaseDate` is in the future, and the
        **newest** of them is more than **365 days** in the past;
      - **cancelled** — the stored TMDB status is `Canceled`.
      A film with no date of any kind and a status other than `Canceled` is never closed by age: it
      has nothing to age out of.
- [ ] **REQ-9 (Closure is only ever set by a successful refresh)**: A film whose refresh failed must
      not be closed, whatever its dates say. Closure records a conclusion drawn from a live TMDB
      answer, never from an outage.
- [ ] **REQ-10 (A closed film never costs a TMDB call)**: A closed film is excluded by REQ-6 before
      any external call is made. Re-reading it is exactly the waste this marker exists to stop.
- [ ] **REQ-11 (The manual refresh reopens)**: `refreshMovie` (`069`) must clear the closure marker
      on a successful catalog refresh and re-evaluate it under REQ-8's rules against the dates it
      just read. A human pressing Refresh on a closed film is the escape hatch: if TMDB has since
      published a digital date, the film reopens and the sweep picks it up again from the next tick.
- [ ] **REQ-12 (Catalog only)**: The sweep must not touch a film's `MISSING`/`COMPLETED` status, must
      not write `filePath`, must not rebuild the media-server index, and must not create, attach or
      delete any `MediaSource` or `ProcessJob`. Same call as `074` REQ-8: a nightly demotion of a
      title the user never asked about is a surprise, and the media-server reconciliation of `069`
      REQ-7/REQ-8 stays a manual, per-title action.
- [ ] **REQ-13 (Classification untouched)**: `Movie.isShort` and `Movie.contentKind` must not be
      re-derived or written. Same reason as `069` REQ-4/REQ-5 and `074` REQ-9 — either may be a
      manual correction (`setMovieShort`, `setMovieContentKind`) and nothing distinguishes a
      corrected value from a derived one.
- [ ] **REQ-14 (One film's failure is not the sweep's)**: A TMDB failure on one film must not stop
      the sweep; the remaining eligible films are still processed, and the failed film's row is left
      untouched. The run must then be recorded as `FAILED` with an error naming how many films failed
      out of how many were eligible and how many were refreshed successfully — the same shape `041`
      and `074` report.
- [ ] **REQ-15 (Items processed)**: The run's `itemsProcessed` must be the number of films
      successfully refreshed in that occurrence — zero on an installation where nothing is eligible,
      which is a success, not a skip.
- [ ] **REQ-16 (No new configuration)**: The task keeps its existing
      `schedule_refresh_movies_enabled` / `schedule_refresh_movies_cron` Settings (off by default,
      `0 4 * * *`) and its existing `movies_enabled` gating through the registry's
      `mediaType: 'movie'`. REQ-8's 365 days is a constant, not a Setting — same call `041` REQ-3 and
      `074` REQ-13 made. The cron decides how often Perceptor looks; the constant decides when a film
      stops being looked at.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Sequential TMDB)**: Films are refreshed one after another, never in parallel. Same
      rate-limit reasoning as `041` NFR-1 and `074` NFR-1: a burst against one shared TMDB key
      rate-limits and leaves the sweep half-done with no error anywhere.
- [ ] **NFR-2 (Idle installation costs nothing)**: A sweep that finds nothing eligible must make zero
      TMDB calls. Selecting what is eligible is a database question.
- [ ] **NFR-3 (Two requests per film, no cadence, no cap)**: Every eligible film is refreshed in the
      occurrence that found it eligible; there is no per-title cadence column and no per-run ceiling.
      A film costs at most the two requests the manual refresh already costs (`details` +
      `release_dates`). This is sound only because REQ-8 keeps the eligible set to films that are
      genuinely still moving; a sweep that grew without bound would need a budget, and closure is
      what replaces one.
- [ ] **NFR-4 (Partial writes survive)**: A film's own write is a single update, so a film is either
      refreshed or untouched. A sweep interrupted partway leaves the films it already refreshed
      refreshed; the next occurrence re-reads the rest, because REQ-6's eligibility is unchanged for
      them.
- [ ] **NFR-5 (Migration)**: Every new column is nullable with no default and needs no backfill. An
      unclosed film with three `NULL` dates and a `NULL` status is precisely REQ-6's eligible film,
      so the first sweep after this ships fills the columns of every film not already in the library,
      and closes the ones whose dates turn out to have aged out.
- [ ] **NFR-6 (One-time first sweep)**: The first occurrence on an existing library is the largest
      this task will ever be — every non-`COMPLETED` film is eligible at once. It must still finish
      as one run under NFR-1's sequential rule rather than being split or capped; the set shrinks to
      its steady state on that same pass through REQ-8.
- [ ] **NFR-7 (Single service)**: No GraphQL field, no `web` change, no `worker` change. `web`'s
      Settings → Scheduling panel already lists, arms, disarms and manually triggers this task and
      renders its run history unchanged.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.** The task id `refresh_movies`, its
`schedule_*` Settings, the `ScheduledTask` type and the `runScheduledTask` mutation all already exist
and are unchanged (`035-scheduled-tasks`); this feature only replaces the handler's body and extends
what two existing `api`-internal write paths store. The new `Movie` columns are internal — nothing
outside `api` reads a film's typed release dates, its TMDB production status or its closure marker
today, and surfacing any of them (a "Digital: 14 Nov" line on the film detail page, a calendar keyed
on the digital date) is out of scope below and needs its own contract delta.

`refreshMovie`'s existing return type `TitleRefresh` is unchanged: REQ-11's reopen/re-close is a
side effect of the catalog step, not a new outcome. A film that closed or reopened still reports
`RefreshCatalogOutcome.DONE`.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `Movie` | `theatricalReleaseDate DateTime?` — earliest limited-theatrical or theatrical day across every country (REQ-1) | nullable, no default | No — NFR-5 |
| `Movie` | `digitalReleaseDate DateTime?` — earliest digital day across every country | nullable, no default | No — NFR-5 |
| `Movie` | `physicalReleaseDate DateTime?` — earliest physical day across every country | nullable, no default | No — NFR-5 |
| `Movie` | `tmdbStatus String?` — TMDB's production status verbatim off the wire (REQ-4) | nullable, no default | No — `NULL` is an eligible film, filled by the first sweep |
| `Movie` | `catalogClosedAt DateTime?` — when Perceptor decided to stop refreshing this film (REQ-8); `NULL` means open | nullable, no default | No — every existing film starts open |

Naming notes, both deliberate:

- `tmdbStatus` rather than `status`: `Movie.status` is already `MediaStatus`
  (`MISSING`/`COMPLETED`/…) and means something entirely different. Same collision `074` resolved
  the same way on `Show`, and the same reason it is a raw `String?` rather than an enum — the only
  question the code asks of it is "`Canceled`, or not", and TMDB adding a seventh value must not
  require a migration to store (Article X).
- `catalogClosedAt` is a timestamp rather than a boolean so the row records *when* the decision was
  taken, which is what makes a surprising closure debuggable months later. It carries no reason
  column: the reason is reconstructible from the dates and the status sitting beside it.

No due/synced marker column is added. `Show.seasonsSyncedAt` exists because `074` sweeps the whole
series library on a cadence; this sweep's eligible set is narrow by construction (REQ-6) and needs no
per-title timestamp to bound it (NFR-3).

## Acceptance Criteria

- [ ] **AC-1**: Given a film registered from a cold cache, when
      `bin/mysql -e "select tmdbStatus, releaseDate, theatricalReleaseDate, digitalReleaseDate,
      physicalReleaseDate from movies"` is run, then the typed columns hold TMDB's values for that
      film (a film with a known digital release shows a `digitalReleaseDate`; one with none shows
      `NULL`), and `releaseDate` is unchanged from what it would have been before this feature.
- [ ] **AC-2**: Given a registered film whose `digitalReleaseDate`, `physicalReleaseDate`,
      `tmdbStatus` and `catalogClosedAt` are all set to `NULL` by hand and whose `status` is
      `MISSING`, when `refresh_movies` is triggered from Settings → Scheduling ("Ejecutar ahora"),
      then the run reads `SUCCESS` with `itemsProcessed: 1` and those columns are filled from TMDB.
- [ ] **AC-3**: Given the same film with `status` set to `COMPLETED` by hand, when the task is
      triggered, then the run reads `SUCCESS` with `itemsProcessed: 0` and the film's row is
      unchanged.
- [x] **AC-4 (closes on age)**: Given a film with no future date and whose newest date of the four is
      more than 365 days in the past, when the task is triggered, then it is refreshed once
      (`itemsProcessed: 1`) and `catalogClosedAt` is now; when the task is triggered a second time,
      the same film is not selected (`itemsProcessed: 0`) and `catalogClosedAt` is unchanged.
- [ ] **AC-5 (stays open)**: Given a film whose digital or theatrical date is in the future, or whose
      newest date is within the last 365 days, when the task is triggered, then it is refreshed and
      `catalogClosedAt` is still `NULL` afterwards.
- [ ] **AC-6 (closes on cancellation)**: Given a registered film TMDB reports as `Canceled`, when the
      task is triggered, then `tmdbStatus` reads `Canceled` and `catalogClosedAt` is now, regardless
      of its dates.
- [ ] **AC-7 (no dates never closes)**: Given a film with `releaseDate` and all three typed dates
      `NULL` and a status other than `Canceled`, when the task is triggered twice, then it is
      selected both times and `catalogClosedAt` stays `NULL`.
- [ ] **AC-8 (manual refresh reopens)**: Given a closed film, when its Refresh button is pressed on
      `/movies/<id>` and TMDB now answers a future or recent date, then the catalog outcome reads
      done, `catalogClosedAt` is `NULL` again, and the next trigger of `refresh_movies` selects that
      film.
- [ ] **AC-9**: Given a film manually set to `ANIME` (`setMovieContentKind`) and toggled to a short
      (`setMovieShort`) and eligible for the sweep, when the task runs, then `movies.contentKind` and
      `movies.isShort` are unchanged.
- [ ] **AC-10**: Given an eligible film with a `MediaSource` in `DOWNLOADING` and a `ProcessJob`, when
      the task runs, then no `movies.status`, `movies.filePath`, `media_sources` or `process_jobs` row
      changed — only catalog columns, the typed dates, `tmdbStatus` and possibly `catalogClosedAt`.
- [x] **AC-11 (failure)**: Given two eligible films and the TMDB key set to an invalid value in
      Settings, when the task is triggered, then the run reads `FAILED`, its error names 2 of 2 films
      failed, neither film's catalog columns nor `catalogClosedAt` changed (in particular, an
      aged-out film was **not** closed — REQ-9), and no column was blanked. Triggering it again with
      a valid key then refreshes both and reads `SUCCESS`.
- [x] **AC-12 (failure)**: Given `movies_enabled` set to `false`, when `refresh_movies` is triggered
      manually, then the existing `error.schedule.task_unavailable` refusal is shown and no run row is
      created — unchanged behaviour from `045`/`035`, verified not to have regressed.
- [x] **AC-13**: `git status --short services/api/prisma` shows both a modified `schema.prisma` and
      one new migration directory, and `bin/cli api npx prisma migrate status` reports no pending
      migration after `bin/npm api run prisma:migrate`.
- [x] **AC-14**: `git diff --stat services/web services/worker` is empty (NFR-7).

## Out of Scope

- **Acquiring anything.** This feature writes rows. It never searches the indexer, never attaches a
  source, never enqueues a job — `refresh`, not acquisition. Using a `digitalReleaseDate` that just
  landed to go find a release is `acquire_movies`, which keeps the `acquire_pending` stub and its id
  (`073` § Out of Scope). The dates this feature stores are exactly the input that spec has been
  waiting for.
- **Showing the dates, the status or the closure in the UI.** No GraphQL field is added, so there is
  no "Digital: 14 Nov" line on the film detail page, no "Cancelada" badge, and no indication that a
  film stopped being refreshed. Each would need a contract delta, `web` work and `en`/`es` catalog
  copy — a separate, cosmetic feature on top of the columns this one adds.
- **Re-keying the calendar on the digital date.** `062-release-calendar` keeps reading
  `Movie.releaseDate` (REQ-2). Whether a film should appear in the calendar on the day it becomes
  *obtainable* rather than the day it opened is a real question and a different feature.
- **A per-region release date.** REQ-1 takes the earliest day worldwide per type, following the
  precedent `earliestMovieReleaseDate()` already set. A configurable country would be a new Setting
  and a different question ("when can I watch it legally here") from the one this feature
  answers ("when could a release plausibly exist").
- **Media-server reconciliation in the sweep.** REQ-12. Promoting and demoting `COMPLETED`/`MISSING`
  from what the media server holds stays the manual per-title refresh of `069`.
- **Re-deriving `isShort` or `contentKind`.** REQ-13, same reasoning as `069` REQ-4/REQ-5. A film
  whose TMDB runtime changed from 39 to 41 minutes does not move out of the shorts folder, and
  `048` already guarantees a reclassification never moves a file already written.
- **Reopening a closed film automatically.** REQ-11 makes the manual Refresh button the only way
  back. A nightly "check whether anything closed has changed" pass is the cost this feature exists
  to remove, and re-opening on a schedule would restore it exactly.
- **Per-installation closure window.** REQ-16. 365 days is a constant; the cron is already
  configurable. A Settings row nobody has asked to change twice is configuration, not flexibility.
- **Notifying anyone that a film became available.** There is no notification system in Perceptor to
  hook into, and inventing one for this is a feature of its own. Same call `074` made.
- **A Redis lock for the sweep.** `035`'s in-process `runningTaskIds` guard still prevents a second
  occurrence, and it is still sound only because `api` runs as exactly one container. Nothing here
  changes that, or the day a replica count above one would break it.

### Verification record (2026-09-26)

Seen to hold on the dev stack (one film, Inception, `DOWNLOADING`, a real TMDB key; the handler run through a throwaway Nest context, and `SchedulerService.runTask` for the last two): AC-2 (`itemsProcessed: 1`; theatrical 2010-07-15, digital 2020-08-13, physical 2010-12-03, `tmdbStatus` `Released`), AC-4 (that film, all dates over a year old, got `catalogClosedAt`), AC-3 (set `COMPLETED` and open: `itemsProcessed: 0`, untouched), AC-11 (key set to an invalid value: TMDB 401, the run threw `1 of 1 film(s) failed; 0 refreshed successfully`, `releaseDate`/`tmdbStatus` kept, `catalogClosedAt` stayed `NULL`; key restored), AC-12 (`movies_enabled` false: `This task is not available: its content type is disabled`, no run row), AC-13 and AC-14. A manual `runTask` also wrote a `scheduled_task_runs` row, `SUCCESS`, 1 processed. Status, `filePath`, `isShort` and `contentKind` were unchanged after each refresh.

Not run live, unit tests only: AC-1 (cold-cache registration), AC-5 to AC-7 (no film with a future date, a cancelled one or without dates was available, and TMDB cannot be made to report one), AC-8 (the Refresh button needs a signed-in user), AC-9 and AC-10 in full (no film manually set to `ANIME`, and no `MediaSource`/`ProcessJob` on the film).

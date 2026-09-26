---
title: Automatic Movie Acquisition
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-09-26
last_updated: 2026-09-26
status: Approved
services: [api, web]
---

# SPEC: Automatic Movie Acquisition (`spec.md`)

## Context & Goal

`073-automatic-episode-acquisition` taught Perceptor to go and get an episode by itself, and closed
its § Out of Scope by saying why a film could not ride along: an episode has exactly one date that
matters — it aired — while a film has three, and only two of them describe a day on which a
downloadable release plausibly exists. It reserved the `acquire_pending` stub for the second task.
`075-movie-refresh-sweep` then filled in the missing input: `Movie` now carries
`theatricalReleaseDate`, `digitalReleaseDate` and `physicalReleaseDate`, each the earliest such day
across every country TMDB lists, kept current by the `refresh_movies` sweep, and its § Out of Scope
names this feature as the one that acts on them. This feature is that second task.

The shape of the problem is that the three dates are not three guesses at one event — they are
three different products. Two days after a theatrical opening the indexer holds nothing but CAM and
TS rips. A day after the digital release it holds a WEB-DL, and probably nothing better. Five days
after the physical release it holds a UHD BluRay or a remux, which is the only point at which the
best version of the film exists at all. So "when should Perceptor look for this film" is not a
question with one answer: it depends on which of those products the person actually wants, which is
why the choice belongs to the user (`/preferences`, beside `allowCinemaReleases`) rather than to the
installation. And the date is only half of each answer: a window that opens with a floor on release
quality is what makes daily retries meaningful. Marking *digital* and taking a WEBRip on the first
day would defeat the point of having marked digital at all — so a window that finds nothing good
enough takes nothing and looks again tomorrow.

The second half is that TMDB does not always have all three. `The Wrecking Crew` has a digital date
and no physical one; other films have the reverse; a film still in cinemas has only the theatrical
one. A window the user marked that the film does not have must resolve to something, or that film
is never acquired at all — so each marked window carries a fallback chain, walking toward the dates
the film actually has, and **never** toward the theatrical one: falling back to a CAM is not a
degradation the user asked for, falling back to a WEB-DL is.

This touches the "Find release" and "Download" stages of the root `CLAUDE.md` pipeline table, from
a new entry point. No stage is added and no stage changes: the sweep resolves a window, searches the
indexer through `IndexerService`, ranks with `073`'s server-side comparator
(`services/api/src/indexer/ranking.ts`), and attaches the winner through
`MoviesService.addTorrentToMovie` — an ordinary `MediaSource` racing in the existing arbiter,
indistinguishable downstream from one a person added by hand.

## Requirements

### Functional Requirements

#### The windows

- [ ] **REQ-1 (Three per-user windows)**: A user must be able to mark, independently, each of three
      acquisition windows — **theatrical**, **digital** and **physical**. All three are off for
      every existing and newly created user; a user who marks none is never acquired for.
- [ ] **REQ-2 (Window rules)**: Each window defines both the day it opens, relative to the film's
      corresponding stored date, and the floor on release quality it accepts:

      | Window | Opens | Accepts |
      | :-- | :-- | :-- |
      | theatrical | `theatricalReleaseDate` + 2 days | any release the ranking does not veto |
      | digital | `digitalReleaseDate` + 1 day | WEB-DL or better |
      | physical | `physicalReleaseDate` + 5 days | UHD or remux |

      "WEB-DL or better" and "UHD or remux" are floors on the existing `ReleaseRanking.sourceRank`
      ladder of `036`/`073` — `>= 4` and `>= 6` respectively — not exact matches: a release better
      than the floor always passes. A release the ranking could not classify (`sourceRank` 0) never
      passes a floor. The theatrical window has **no floor at all**, which is not the same as a floor
      of zero: an unclassifiable release passes there and nowhere else.
- [ ] **REQ-2b (A floor is a veto, applied before the resolution tier)**: A floor must remove the
      releases below it from consideration **before** the best resolution tier is chosen, exactly as
      the existing AV1, dead-swarm, upscale and cinema-capture vetoes do. A 2160p WEB-DL must not
      shadow a 1080p BluRay remux while the physical floor is armed: with that floor the 2160p row is
      not a candidate at all, so the best tier present among what survives is 1080p and the remux
      wins. A floor applied after candidacy would instead leave that film acquiring nothing, forever,
      on every run.
- [ ] **REQ-3 (A floor is a retry, not a failure)**: A window that is open but whose best candidate
      sits below its floor must attach **nothing** and leave the film untouched, so the next run
      looks again. No suppression of any kind is recorded — a film can be looked at every day for
      months until an acceptable release appears.
- [ ] **REQ-4 (Fallback chain)**: A marked window whose own date is `NULL` must resolve to the first
      window in its chain that has a date, and then behave **entirely** as that window — its
      opening offset and its floor both come from the window it resolved to, not from the one the
      user marked:

      | Marked | Chain |
      | :-- | :-- |
      | theatrical | theatrical → digital → physical |
      | digital | digital → physical |
      | physical | physical → digital |

      The theatrical window appears in no chain but its own: a user who did not mark it is never
      offered a cinema capture, however little else the film has (`The Wrecking Crew` marked
      *physical* resolves to digital; a film with only a theatrical date marked *physical* resolves
      to nothing).
- [ ] **REQ-5 (No date, no window)**: A marked window whose whole chain is `NULL` contributes
      nothing. A film with all three dates `NULL` is never acquired, whatever the user marked — it
      has no day to open on. `Movie.releaseDate` is deliberately not a fallback: it is the earliest
      release of *any* type including a premiere or a TV airing (`075` REQ-2), which describes no
      obtainable product.
- [ ] **REQ-6 (Several windows open at once)**: When more than one of a user's resolved windows is
      open for the same film, the film is eligible from the earliest of them, and the floor that
      applies is the **lowest** of the open windows' floors. A user who marked theatrical and
      physical accepts anything from `theatricalReleaseDate + 2` onward; the physical floor is not
      a gate they are made to wait for, because they said they wanted it in cinemas too.
- [ ] **REQ-7 (Cinema captures stay governed by the existing preference)**: The theatrical window
      does not lift the cinema-capture veto. A user whose `allowCinemaReleases` is off has no
      theatrical window at all: it resolves through REQ-4's chain to digital or physical, and CAM,
      TS, screener and workprint releases stay vetoed for them by the existing ranking rule. Marking
      theatrical is only effective together with `allowCinemaReleases`.

#### The sweep

- [ ] **REQ-8 (`acquire_movies` task)**: The scheduler registry must carry a task id
      `acquire_movies`, tied to the `movie` media type, disabled by default, with a **daily**
      default cadence, appearing in Settings → Scheduling like every other task with its toggle,
      cadence field, last-run outcome and manual trigger. It **replaces** the `acquire_pending`
      stub, which is removed along with its two seeded Settings rows: `073` and `075` reserved that
      id for this feature, and keeping a name that says "pending" for the movie twin of
      `acquire_episodes` is the kind of asymmetry Article X exists to remove. Rows left behind in
      an existing installation's `settings` table for `schedule_acquire_pending_*` are inert — the
      registry is the only thing that reads a `schedule_*` key.
- [ ] **REQ-9 (Eligibility)**: A film is a candidate for a run when **all** hold: it is registered
      by at least one user; at least one of its owners has an open resolved window for it
      (REQ-1 to REQ-7); and its derived status reads `MISSING` with nothing in flight — no
      non-`ERROR` `MediaSource` and no active `ProcessJob`, exactly as `deriveTitleStatus` computes
      it. `Movie.catalogClosedAt` (`075` REQ-8) is **not** a filter: closure means Perceptor stopped
      asking TMDB about the film, not that the film stopped being wanted.
- [ ] **REQ-10 (Union of owners' windows)**: For a film several users hold, the resolved windows of
      **every** owner are unioned: the film is eligible when any owner's window is open, and the
      applicable floor is the lowest floor among the open windows of all owners. The
      cinema-capture veto is the one input that is **not** unioned — it is lifted only when
      **every** owner has `allowCinemaReleases` on. A window opening early costs a strict owner
      nothing; a CAM landing in a library they share does, and there is only one file.
- [ ] **REQ-11 (Ranking inputs)**: Every other ranking input is the union across owners, mirroring
      `073` REQ-11: the mandatory-audio requirement is the union of each owner's effective
      languages (their per-film languages, or their global `/preferences` languages when the film
      carries none), armed when at least one of them set `audioMandatory`; the preferred groups are
      the union of those owners' **movie** torrent groups.
- [ ] **REQ-12 (Search and pick)**: For each eligible film the sweep searches the indexer once with
      the film's title and the year of its `releaseDate` (`<Title> <YYYY>`, punctuation stripped the
      same way `buildEpisodeQuery` strips it; no year when `releaseDate` is `NULL`), ranks the
      results with `073`'s comparator **armed with REQ-6's floor** (REQ-2b), and takes the top
      candidate. If the search returns nothing, or nothing survives the vetoes and the floor, the
      film is left alone (REQ-3).
- [ ] **REQ-13 (Attach as the oldest owner)**: The chosen release is attached through the same call
      path a manual add uses (`MoviesService.addTorrentToMovie`, `force: false`), attributed to the
      film's oldest `UserMovie`. The result is an ordinary `MediaSource` competing in the existing
      race arbiter; no scheduler-specific status, column or bypass is introduced.
- [ ] **REQ-14 (Per-film isolation)**: A failure on one film — an indexer error, an infoHash that
      will not resolve, a torrent client refusal, an attach conflict — must be logged and skipped,
      and must not abort the rest of the run. The run's `itemsProcessed` counts the sources actually
      attached; the run is `FAILED` only when every film attempted failed and none was skipped for
      a benign reason, the same shape `073` reports.
- [ ] **REQ-15 (Normalization on the first run)**: Turning the task on deliberately sweeps the whole
      backlog: every registered film that is still `MISSING` and whose window is already open is
      acquired, oldest window first, not only films whose window opens from that day forward. A
      registered film is an explicit request a person made, unlike an episode that arrived because
      a series was followed, so there is nothing to protect them from — the per-run ceiling (NFR-1)
      is the only bound, and successive runs work through the rest.

#### Preferences UI

- [ ] **REQ-16 (`/preferences` surface)**: The three windows are editable from the caller's own
      `/preferences` screen, beside `allowCinemaReleases`, saved with the rest of the form. Each
      carries copy naming the day it opens and the quality it accepts, in `en` and `es`. The
      theatrical option must state that it has no effect while cinema releases are not allowed
      (REQ-7).
- [ ] **REQ-17 (No refusal for a contradictory choice)**: Marking theatrical with
      `allowCinemaReleases` off is saved as given and never rejected — it degrades per REQ-4/REQ-7.
      A user who later allows cinema releases must find their theatrical window already marked.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Bounded per run)**: A single run must attempt at most a fixed number of films (20),
      earliest open window first, so REQ-15's first run on a large library cannot flood Prowlarr or
      qBittorrent. What does not fit is picked up by the next run.
- [ ] **NFR-2 (One indexer query per film)**: At most one indexer search per eligible film per run,
      issued through `IndexerService` so the existing 10-minute Redis read-through cache (`040`)
      applies.
- [ ] **NFR-3 (No TMDB call)**: The sweep reads dates from the database only. Keeping them current
      is `refresh_movies`' job (`075`), and this task must work — and cost nothing external beyond
      the indexer — on an installation where that task is off.
- [ ] **NFR-4 (Eligibility is a database question)**: A run on an installation where nothing is
      eligible must issue zero indexer searches.
- [ ] **NFR-5 (`worker` untouched)**: No job payload, encode rule or output path changes. The worker
      must be unable to tell an automatically attached source from a manually attached one.
- [ ] **NFR-6 (Disabled by default)**: A fresh install and an upgrade both have the task off and all
      three windows off for every user. Two deliberate acts — an administrator arming the task and
      a user marking a window — are required before anything is ever attached.
- [ ] **NFR-7 (Migration)**: The three new `User` columns are non-null booleans defaulting to
      `false`, so the migration needs no backfill.
- [ ] **NFR-8 (Ranking gains exactly one inert veto)**: `services/api/src/indexer/ranking.ts` gains
      one optional minimum-`sourceRank` veto and nothing else — no new criterion, no change to the
      comparator, to the existing four vetoes or to the candidate derivation. It is **absent** for
      every caller that exists today, so `searchTorrents` and the torrent modal behave identically to
      before this feature. Only the sweep arms it. The alternative — applying the floor to the ranked
      rows after the fact — was rejected by REQ-2b: it cannot see past the resolution tier and would
      silently stall a film forever.

## GraphQL Contract Delta

```graphql
type UserPreferences {
  allowCinemaReleases: Boolean!
  audioMandatory: Boolean!
  audioLanguages: [Language!]!
  subtitleLanguages: [Language!]!
  movieTorrentGroups: [TorrentGroup!]!
  showTorrentGroups: [TorrentGroup!]!

  """
  Acquire a film automatically from two days after its theatrical release, at any quality the
  ranking accepts. Inert while `allowCinemaReleases` is false (076 REQ-7).
  """
  acquireTheatrical: Boolean!

  """Acquire a film automatically from one day after its digital release, WEB-DL or better."""
  acquireDigital: Boolean!

  """Acquire a film automatically from five days after its physical release, UHD or remux."""
  acquirePhysical: Boolean!
}

type Mutation {
  """
  Replaces the caller's three acquisition windows in one write. All three are always given —
  there is no partial update, because the form saves them together.
  """
  setAcquisitionWindows(
    theatrical: Boolean!
    digital: Boolean!
    physical: Boolean!
  ): UserPreferences!
}
```

The `acquire_movies` task introduces **no SDL of its own**: `scheduledTasks`, `runScheduledTask` and
the `schedule_*` Settings keys already carry any task in the registry (`035` REQ-1/REQ-7/REQ-8),
which is why `web`'s Scheduling tab renders the new row — and drops the `acquire_pending` one — with
no change. `TorrentResult`, `ReleaseRanking` and `searchTorrents` are unchanged (NFR-8).

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `setAcquisitionWindows` called by a service principal | `UnauthorizedException` — `error.auth.unauthenticated` | existing copy, unchanged |
| `runScheduledTask('acquire_movies')` while `movies_enabled` is false | `BadRequestException` — `error.schedule.task_unavailable` | existing copy, unchanged (`045`/`035`) |
| `runScheduledTask('acquire_pending')` after this feature | `BadRequestException` — `error.schedule.task_unknown` | existing copy, unchanged — the id leaves the registry |

`web` consumes `setAcquisitionWindows` exactly as it consumes `setAllowCinemaReleases` today: the
`/preferences` form fires it alongside the other setters, and a keyed failure is rendered through
`translateGraphQLError` with the form's existing error surface, leaving the checkboxes as the user
left them. There is deliberately no error for a contradictory selection (REQ-17).

Inside `api`, the sweep calls the ranking and `MoviesService.addTorrentToMovie` directly. It issues
no GraphQL of its own, and `worker` sees nothing new (NFR-5).

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `User` | `acquireTheatrical Boolean` — the theatrical window is marked (REQ-1) | non-null, `@default(false)` | No — NFR-7 |
| `User` | `acquireDigital Boolean` — the digital window is marked | non-null, `@default(false)` | No — NFR-7 |
| `User` | `acquirePhysical Boolean` — the physical window is marked | non-null, `@default(false)` | No — NFR-7 |

Three booleans on `User` rather than a join table or a set column: the domain has exactly three
windows, each is one bit, and MySQL has no array type — a `user_acquisition_windows` table would be
three rows of ceremony around three bits (Article X). They sit beside `allowCinemaReleases` and
`audioMandatory`, which are the same shape for the same reason.

No column is added to `Movie`: every date this feature reads was added by `075`. No column records
that a film was attempted or skipped — REQ-3 is explicit that nothing is suppressed, and the
`MediaSource` a successful attach creates is what stops a film being eligible again (REQ-9).

Seeded Settings rows:

| Key | Seeded value | Editable from Settings? |
| :-- | :-- | :-- |
| `schedule_acquire_movies_enabled` | `false` | yes — Scheduling tab (`035`) |
| `schedule_acquire_movies_cron` | daily (`0 2 * * *`) | yes — Scheduling tab (`035`) |
| `schedule_acquire_pending_enabled` | *removed from the seed* | — |
| `schedule_acquire_pending_cron` | *removed from the seed* | — |

## Acceptance Criteria

- [ ] **AC-1**: `bin/mysql -e 'select acquireTheatrical, acquireDigital, acquirePhysical from users'`
      returns `0,0,0` for every user after the migration, and Settings → Scheduling lists
      `acquire_movies` (off, daily) and no longer lists `acquire_pending`.
- [ ] **AC-2**: Marking digital and physical on `/preferences`, saving, and reloading shows both
      still marked; `bin/mysql` confirms the two columns are `1` and `acquireTheatrical` `0`.
- [ ] **AC-3**: Given a film whose `digitalReleaseDate` is **today**, with digital marked, pressing
      "Ejecutar ahora" on `acquire_movies` completes `SUCCESS` with `itemsProcessed: 0` and the film
      still `MISSING` — the window opens tomorrow.
- [ ] **AC-4**: Given the same film dated **two days ago**, a manual run attaches one source: the
      film leaves `MISSING`, `/downloads` shows a row for it, and the release named there is a
      WEB-DL or better and is the same row the torrent modal shows first under "Best candidates"
      among those at that floor.
- [ ] **AC-5** *(floor holds)*: Given a film whose `physicalReleaseDate` was 10 days ago, with only
      physical marked, and whose indexer results contain nothing above `BluRay` (`sourceRank` 5), a
      run attaches nothing and reports `itemsProcessed: 0`; the film is still `MISSING` and is
      selected again on the next run.
- [ ] **AC-5b** *(the floor outranks the resolution tier)*: Given the same film whose results contain
      a 2160p WEB-DL and a 1080p BluRay remux, a run attaches the **1080p remux** — the WEB-DL is
      below the physical floor and so is not a candidate at all (REQ-2b). With digital marked instead
      of physical, the same search attaches the 2160p WEB-DL.
- [ ] **AC-6** *(the `The Wrecking Crew` case)*: Given a film with `digitalReleaseDate` set,
      `physicalReleaseDate` `NULL` and only **physical** marked, a run attaches a WEB-DL — the
      digital fallback of REQ-4 applied both the +1 day offset and the WEB-DL floor.
- [ ] **AC-7** *(no fallback to cinema)*: Given a film with only `theatricalReleaseDate` set, three
      weeks past, and only **physical** marked, no run ever attaches anything for it, however many
      times the task is triggered.
- [ ] **AC-8** *(theatrical needs the preference)*: Given a film in cinemas for a week whose only
      date is theatrical, with **theatrical** marked and `allowCinemaReleases` off, a run attaches
      nothing. Turning `allowCinemaReleases` on and triggering again attaches the best available
      release, CAM included.
- [ ] **AC-9**: Given a film with all three dates `NULL` and all three windows marked, a run
      attaches nothing and reports `SUCCESS`.
- [ ] **AC-10**: A film that already has a `DOWNLOADING` source, and a film whose status reads
      `COMPLETED`, are both skipped — no second source is created for either.
- [ ] **AC-11** *(failure path)*: With Prowlarr stopped (`docker compose stop indexer`), a manual
      run finishes with a recorded `FAILED` outcome whose error names how many films failed, leaves
      every film untouched, and the next run after Prowlarr is back attaches normally.
- [ ] **AC-12** *(failure path)*: Given two eligible films where the first one's chosen release has
      an infoHash qBittorrent refuses, the run still attaches the second one and reports
      `itemsProcessed: 1` rather than failing the whole occurrence.
- [ ] **AC-13** *(failure path)*: Given `movies_enabled` set to `false`, triggering `acquire_movies`
      manually shows the existing `error.schedule.task_unavailable` refusal and creates no run row.
- [ ] **AC-14**: With 30 eligible films, a single run attaches at most 20 and the next run picks up
      the rest (NFR-1).
- [ ] **AC-15**: Given a film two users hold, where one marked digital and the other nothing, the
      film is acquired on its digital window (REQ-10); given a film where one owner has
      `allowCinemaReleases` on and the other off, no cinema capture is ever attached for it.
- [ ] **AC-16**: `git status --short services/api/prisma` shows both a modified `schema.prisma` and
      one new migration directory; `git diff --stat services/worker` is empty (NFR-5); and
      `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift.
- [ ] **AC-17**: In the torrent modal for a film, the row list, the "Best candidates" toggle and the
      per-row ranking chips render exactly as they did before this feature (NFR-8).

## Out of Scope

- **Series and seasons.** `acquire_episodes` (`073`) already sweeps episodes on their air date and
  is untouched here. A series has no digital or physical window — its episodes air — so the two
  tasks share the ranking and the attach path and nothing else.
- **Surfacing the three dates in the UI.** `075` § Out of Scope already reserved this, and it is
  still reserved: there is no "Digital: 14 Nov" line on the film detail page and no indication of
  which window a film is waiting on. This feature adds the three checkboxes and nothing else
  visible.
- **Re-keying the calendar on the digital date.** `062-release-calendar` keeps reading
  `Movie.releaseDate`, unchanged (`075` REQ-2).
- **Quality upgrades.** A film acquired as a WEB-DL on its digital window is never re-acquired when
  the UHD remux appears after the physical release, even for a user who marked physical too. The
  windows decide *when to start looking*, never *when to replace something already in the library* —
  Perceptor does not do upgrades, by design.
- **Per-film windows.** The three marks are per user, installation-wide across their whole library.
  A film that deserves the remux and a film that only needs to be watched once would need a column
  on `UserMovie` and a control on every detail page; REQ-10's union is what makes the coarse version
  sound for a shared library.
- **Configurable offsets or floors.** REQ-2's 2/1/5 days and its two source floors are constants.
  The cron already decides how often Perceptor looks; a Setting per number is configuration nobody
  has asked to change twice (same call `073` REQ-6 and `075` REQ-16 made).
- **A theatrical floor.** The theatrical window accepts whatever the ranking does not veto,
  deliberately: a floor there would mean waiting, and waiting is what the digital window is for.
- **Making the task lift the cinema veto on its own.** REQ-7. `allowCinemaReleases` stays the single
  switch for CAM/TS, shared with the manual search, rather than gaining a second, sweep-only twin.
- **Reacting the moment a date lands.** The sweep is a daily cadence, not an event. A digital date
  that `refresh_movies` writes at 04:00 is acted on by the next `acquire_movies` tick, not within
  the same second.
- **Notifying anyone.** No email, push or in-app notice when the sweep attaches something. The
  `/downloads` queue and the run history are the record — same call `073` made.
- **A Redis lock for the sweep.** `035`'s in-process `runningTaskIds` guard still prevents a second
  occurrence, sound only because `api` runs as exactly one container. Nothing here changes that.

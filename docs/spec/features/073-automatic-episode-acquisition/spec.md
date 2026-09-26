---
title: Automatic Episode Acquisition
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-26
last_updated: 2026-09-26
status: Implemented
services: [api, web]
---

# SPEC: Automatic Episode Acquisition (`spec.md`)

## Context & Goal

A registered series keeps producing episodes after the day it was registered, and Perceptor does
nothing about it. `035-scheduled-tasks` built the machinery that wakes `api` up on a cadence —
the registry (`services/api/src/scheduler/scheduler.registry.ts`), the run record, the Settings →
Scheduling tab — and deliberately shipped `acquire_pending` as a no-op stub, stating up front that
when acquisition logic did land it would attach its release through the same path a person's
manual add takes. `059-season-pack-acquisition-ui` then made the season and the episode equal
first-class acquisition targets. `036-torrent-ranking-heuristic` wrote the release comparator that
decides which of thirty Prowlarr rows is actually the one to take, and its own header says it out
loud: reusable by design, `SearchTorrent.tsx` is the first caller, *an eventual automatic picker is
meant to be the second*. This feature is that second caller.

There are two moving parts. The first is that the comparator lives in the wrong service:
`services/web/src/lib/torrent-ranking.ts` runs in the browser, and a scheduled sweep runs in `api`.
Copying it would leave two lexicographic comparators with no codegen and no compile error between
them, which is exactly the drift Article X exists to prevent — so the algorithm **moves to `api`**,
`searchTorrents` starts returning each row's parsed ranking and its place among the candidates,
and `web` stops computing any of it. The torrent modal and the "Best candidates" toggle keep
behaving as they do today; they just read the answer instead of deriving it.

The second is the sweep itself: a new `acquire_episodes` scheduled task, daily by default, that
looks for every aired episode of a registered series that is still `MISSING` with nothing in
flight, searches the indexer for it, ranks the results, and attaches the top candidate through
`EpisodesService.addTorrentToEpisode` — an ordinary `MediaSource` that races in the existing
arbiter exactly like a user-added one. An episode becomes eligible **the day after it airs**: a
release that aired on the 25th is first attempted on the 26th, because the first hours after air
are when the indexer only has the worst encodes of it. No pipeline stage is added — this is a new
entry point into stages that already exist, the same way `035` framed it.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Ranking moves to `api`)**: The release comparator must live in `api` and be the only
      copy of it in the repository. `web` must no longer compute resolution tiers, source ranks,
      language matches or candidate ordering; `services/web/src/lib/torrent-ranking.ts` is deleted.
- [ ] **REQ-2 (Ranking on the wire)**: `searchTorrents` must return, for every row the indexer
      produced, its parsed ranking, whether it is a candidate (survived every veto and sits in the
      best resolution tier present), and its 1-based position among the candidates. Rows are
      returned in the indexer's own order, unchanged — the ordering the UI shows under "Best
      candidates" is derived from the candidate position, not from the response order.
- [ ] **REQ-3 (Ranking inputs come from the target)**: `searchTorrents` must accept an optional
      acquisition target (a film, a season or an episode) and resolve **every** ranking input
      itself, reproducing what `SearchTorrent.tsx` resolves today: the caller's mandatory-audio
      requirement for that title, falling back to the caller's global `/preferences` languages when
      the title carries none of its own; the caller's preferred torrent groups for the target's
      media type; and the cinema-capture veto, which applies only to a film target and only when
      the caller's own `allowCinemaReleases` preference is off. With no target the ranking runs
      unarmed — no language requirement, the installation's default group list, and no
      cinema-capture veto, exactly as a null target ranks today. At most one target may be given;
      two or more is an error.
- [ ] **REQ-4 (Ranking parity)**: For the same inputs, the ranking returned by `api` must produce
      the same candidate set and the same ordering the client-side comparator produces today,
      including every veto (AV1/VP9, dead swarm, upscale, cinema capture) and the mandatory-audio
      promotion and tiebreak.
- [ ] **REQ-5 (`acquire_episodes` task)**: The scheduler registry must gain a task id
      `acquire_episodes`, tied to the `show` media type, disabled by default, with a **daily**
      default cadence, appearing in Settings → Scheduling like every other task with its toggle,
      cadence field, last-run outcome and manual trigger.
- [ ] **REQ-6 (Air-date grace)**: An episode must not be attempted on the day it airs. It becomes
      eligible once at least one full day has passed since its `releaseDate`: an episode dated
      `2026-04-25` is first attempted by a run on `2026-04-26`.
- [ ] **REQ-7 (Eligibility)**: An episode is a candidate for the sweep when **all** hold: its series
      is registered by at least one user; it belongs to a season other than season 0; it has a
      non-null `releaseDate` that satisfies REQ-6; its status reads `MISSING` with nothing in
      flight — no non-`ERROR` `MediaSource` of its own, and no non-`ERROR`, not-yet-scanned pack on
      its season (the `059` lift); and its `releaseDate` is not before the backlog cutoff (REQ-8).
- [ ] **REQ-8 (No backlog)**: Turning the task on must not sweep a series' entire history. `api`
      records the moment the task's enabled flag transitions from off to on, and only episodes
      whose air date falls on or after **that calendar day** are ever eligible. Every later
      transition to on overwrites the cutoff; turning the task off leaves it untouched.
- [ ] **REQ-9 (Retry until found)**: An eligible episode for which the run found no acceptable
      candidate stays eligible and is attempted again on the next run, indefinitely, until it is
      acquired or stops satisfying REQ-7. Nothing is recorded per episode to suppress it.
- [ ] **REQ-10 (Search and pick)**: For each eligible episode the sweep searches the indexer with
      the same query the UI prefills (`<Series title> S<NN>E<NN>`), ranks the results by REQ-1's
      comparator, and takes the first candidate. If the search returns nothing, or every row is
      vetoed, the episode is left alone (REQ-9).
- [ ] **REQ-11 (Union of owners' preferences)**: The ranking for an episode must use, as its
      mandatory-audio requirement, the union of the languages required by **every** user who holds
      the series — each owner resolved through REQ-3's own fallback (their per-series languages, or
      their global `/preferences` when the series carries none), armed when at least one of them
      set `audioMandatory` — and as its preferred groups the union of those users' show torrent
      groups. When no owner required a language, the ranking runs unarmed. The cinema-capture veto
      does not apply to an episode target at all (REQ-3).
- [ ] **REQ-12 (Attach as the oldest owner)**: The chosen release is attached through the same call
      path a manual add uses (`EpisodesService.addTorrentToEpisode`, `force: false`), attributed to
      the series' oldest `UserShow`. The result is an ordinary `MediaSource` competing in the
      existing race arbiter; no scheduler-specific status, column or bypass is introduced.
- [ ] **REQ-13 (Per-episode isolation)**: A failure on one episode — an indexer error, an infoHash
      that will not resolve, a torrent client refusal, an attach conflict — must be logged and
      skipped, and must not abort the rest of the run. The run's `itemsProcessed` counts the
      sources actually attached; the run is `FAILED` only when the sweep itself could not run.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Bounded per run)**: A single run must attempt at most a fixed number of episodes
      (20), oldest air date first, so a first run after a long outage cannot flood Prowlarr or
      qBittorrent. What does not fit is picked up by the next run, unchanged by REQ-9.
- [ ] **NFR-2 (One indexer query per episode)**: The sweep must issue at most one indexer search per
      eligible episode per run, going through `IndexerService` so the existing 10-minute Redis
      read-through cache (`040`) applies.
- [ ] **NFR-3 (`worker` untouched)**: No job payload, encode rule or output path changes. The worker
      must be unable to tell an automatically attached source from a manually attached one.
- [ ] **NFR-4 (No schema change)**: The feature adds no Prisma model, column or migration. The
      backlog cutoff is a Settings row, and eligibility is derived from existing columns.
- [ ] **NFR-5 (Disabled by default)**: A fresh install and an upgrade of an existing install both
      have the task off, with no cutoff recorded and no episode ever attempted until an
      administrator turns it on.
- [ ] **NFR-6 (No behaviour change in the modal)**: Moving the comparator must leave the torrent
      modal's default list, its "Best candidates" toggle and its per-row ranking debug panel
      visually and behaviourally unchanged.

## GraphQL Contract Delta

```graphql
"""
The parsed interpretation behind a release's placement — the server-side result of the
comparator that used to run in the browser (036-torrent-ranking-heuristic REQ-14).
"""
type ReleaseRanking {
  resolutionTier: Int!
  resolutionLabel: String!
  preferredGroup: Boolean!
  groupLabel: String
  sourceRank: Int!
  sourceLabel: String!
  codecRank: Int!
  codecLabel: String!
  dynamicRangeRank: Int!
  dynamicRangeLabel: String!
  audioRank: Int!
  audioLabel: String!
  matchedLanguage: String
  sourcePromoted: Boolean!
}

type TorrentResult {
  id: String!
  infoHash: String
  title: String
  size: Float
  seeders: Int!
  leechers: Int!
  items: [TorrentLink!]!
  infoUrl: [TorrentLink!]!

  """Parsed ranking of this release. Present on every row, vetoed ones included."""
  ranking: ReleaseRanking!

  """
  True when this row survived every veto and sits in the best resolution tier present in
  this response — i.e. it is one of the rows "Best candidates" shows.
  """
  candidate: Boolean!

  """1-based position among the candidates, best first. Null when `candidate` is false."""
  candidateRank: Int
}

type Query {
  searchTorrents(
    query: String!
    movieId: Int
    seasonId: Int
    episodeId: Int
  ): [TorrentResult!]!
}
```

`Query.searchTorrents` keeps its name, its return type and the order of the rows it returns; the
three new arguments are all optional, so an unmigrated caller gets the pre-`073` list with the
ranking fields attached. There is deliberately no `allowCinemaReleases` argument: it is not a
caller's choice but a value derived from the target's kind and the caller's own preference
(REQ-3), and `api` already holds both. The `acquire_episodes` task introduces **no new SDL**: `scheduledTasks`,
`runScheduledTask` and the `schedule_*` Settings keys already carry any task in the registry
(`035` REQ-1/REQ-7/REQ-8), which is why `web`'s Scheduling tab renders the new row with no change.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| More than one of `movieId` / `seasonId` / `episodeId` given | `BadRequestException` — `error.search.target_ambiguous` | `Indicá un solo destino de búsqueda` |
| `movieId` given for a film the caller does not hold | `NotFoundException` — `error.movie.not_found` | existing copy, unchanged |
| `seasonId` given for a season the caller does not hold | `NotFoundException` — `error.season.not_found` | existing copy, unchanged |
| `episodeId` given for an episode the caller does not hold | `NotFoundException` — `error.episode.not_found` | existing copy, unchanged |
| Prowlarr unreachable | `ServiceUnavailableException` — `error.indexer.unavailable` | existing copy, unchanged |

`web` consumes these as it already does: `SearchTorrent.tsx` renders the keyed error through
`translateGraphQLError` and keeps the modal open. `error.search.target_ambiguous` is unreachable
from the current UI (the modal always has exactly one target) but is part of the contract because
the argument shape allows it. No consumer treats a missing `candidateRank` as an error — it is the
normal value for a vetoed or lower-tier row.

Inside `api`, the sweep calls the ranking and `EpisodesService.addTorrentToEpisode` directly. It
issues no GraphQL of its own, and `worker` sees nothing new (NFR-3).

## Data Model Changes

**None.** No Prisma model, field, enum or migration (NFR-4).

Two Settings rows are added, both seeded:

| Key | Kind | Seeded value | Editable from Settings? |
| :-- | :-- | :-- | :-- |
| `schedule_acquire_episodes_enabled` | `boolean` | `false` | yes — Scheduling tab (`035`) |
| `schedule_acquire_episodes_cron` | `cron` | daily (`0 3 * * *`) | yes — Scheduling tab (`035`) |
| `auto_acquire_episodes_since` | — (not in the catalog) | empty | no — written by `api` on REQ-8's transition |

`auto_acquire_episodes_since` is deliberately **absent from `SETTINGS_CATALOG`**, the same way
`torrent_port` is: it is machine-written state, not an administrator's field, and `updateSettings`
must refuse it like any other unknown key.

## Acceptance Criteria

- [x] **AC-1**: With the task off, a `bin/mysql` select of the `auto_acquire_episodes_since` row
      returns no value, and no `MediaSource` is ever created by the scheduler.
- [ ] **AC-2**: Turning `schedule_acquire_episodes_enabled` on in Settings → Scheduling writes
      today's timestamp into `auto_acquire_episodes_since`; saving the Scheduling tab again without
      changing the toggle leaves that value untouched.
- [ ] **AC-3**: Given a registered series with an episode dated **today** and no source, pressing
      "Ejecutar ahora" on `acquire_episodes` completes with outcome `SUCCESS`, `itemsProcessed` 0,
      and the episode still `MISSING` — the grace of REQ-6 has not elapsed.
- [ ] **AC-4**: Given the same episode dated **yesterday**, a manual run attaches one source: the
      episode's card moves out of `MISSING`, `/downloads` shows a row for it, and the release
      titled in that row is the same one the torrent modal shows first under "Best candidates".
- [ ] **AC-5**: Given an episode dated **before** the cutoff of AC-2, no run ever attaches anything
      for it, however many times the task is triggered.
- [ ] **AC-6** *(failure path)*: With Prowlarr stopped (`docker compose stop indexer`), a manual run
      finishes with a recorded outcome and leaves every episode untouched; the run's error is
      visible in Settings → Scheduling and the next run after Prowlarr is back attaches normally.
- [ ] **AC-7** *(failure path)*: Given two eligible episodes where the first one's chosen release
      has an infoHash qBittorrent refuses, the run still attaches the second one and reports
      `itemsProcessed` 1 rather than failing the whole occurrence.
- [ ] **AC-8**: An episode that already has a `DOWNLOADING` source, and an episode whose season has
      a pack in flight, are both skipped — no second source is created for either.
- [ ] **AC-9**: In the torrent modal for an episode, the row list, the "Best candidates" toggle and
      the per-row ranking chips render exactly as they did before this feature, and
      `grep -rn "resolutionTier" services/web/src` shows only reads of the server's field — no
      comparator.
- [ ] **AC-10**: `grep -rn "rankTorrentResults" services/web/src` returns nothing and
      `services/web/src/lib/torrent-ranking.ts` no longer exists.
- [ ] **AC-11**: With 30 eligible episodes, a single run attaches at most 20 and the next run picks
      up the rest (NFR-1).

## Out of Scope

- **Films.** A film's acquisition window is not its theatrical date — it is the digital/physical
  release, which TMDB exposes separately and which needs its own grace rule. That is a second task
  (`acquire_movies`) in its own spec; the existing `acquire_pending` stub stays a stub and keeps
  its id for it. This feature deliberately does not touch it.
- **Season packs.** The sweep acquires episodes one at a time. Deciding that six missing episodes
  of one season are better served by a single pack is a different (and harder) decision than
  "which release of this episode is best", and `059` already gives a human that button.
- **A configurable grace.** REQ-6's one day is a constant. Making it a Setting is one catalog line
  away if a real installation wants a different window, but shipping it now would be a knob nobody
  has asked to turn twice.
- **Per-series or per-user opt-in.** The switch is installation-wide, as decided during
  clarification: one toggle in Settings → Scheduling. A per-series "follow" flag would need a
  column on `UserShow`, a UI on every series page, and a rule for whose preferences win — all of
  which REQ-11's union sidesteps.
- **Quality upgrades.** An episode acquired at 720p because nothing better existed is never
  re-acquired when a 2160p release shows up the next week. Perceptor does not do upgrades, by
  design (that is the *arr behaviour it deliberately omits).
- **Notifying anyone.** No email, push or in-app notice when the sweep attaches something. The
  `/downloads` queue and the run history are the record.

> Verification note: AC-1 was confirmed against the running stack (the two schedule rows seeded off, the cutoff row empty). AC-2 to AC-11 have not been run live (no authenticated session, no registered series with an episode past its grace day); they rest on the unit suites (`ranking.spec.ts`, `ranking-context.service.spec.ts`, `acquire-episodes.task.spec.ts`, the transition-guard cases in `settings.resolver.spec.ts`). Fault injection was not performed.

---
title: Automatic Movie Acquisition — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-09-26
status: Approved
---

# PLAN: Automatic Movie Acquisition (`plan.md`)

## Precondition: `075` ships first

This feature reads `Movie.theatricalReleaseDate`, `Movie.digitalReleaseDate` and
`Movie.physicalReleaseDate`. **None of them exists yet** — `075-movie-refresh-sweep` is `Approved`
and unimplemented, and `grep -n theatricalReleaseDate services/api/prisma/schema.prisma` returns
nothing today. `076` cannot start until `075` is implemented and its migration applied. The `api`
slice's first step is that check, and its instruction is to **stop and report** if the columns are
absent rather than adding them here: they belong to `075`'s migration (Constitution, Article III —
one owner per column, and two migrations adding the same column is a conflict no test catches).

A useful consequence: `075` is also what keeps the dates *current*. `076` works without
`refresh_movies` armed (NFR-3), but on an installation where it is off, a digital date TMDB
publishes after registration never reaches the database and this sweep never fires for that film.
That is a documentation point for the root `CLAUDE.md`, not a code dependency.

## Approach

Three pieces, two of them small.

**The window rule is a pure module.** All of REQ-2 to REQ-7 — which windows a set of marks resolves
to, when each opens, what floor it carries, and which floor applies when several are open — is
arithmetic over a handful of dates and booleans. It goes into a new, dependency-free
`services/api/src/scheduler/tasks/acquisition-window.ts` (no Nest, no Prisma client), following the
precedent of `services/api/src/pipeline-status/pipeline-status.ts` and of the helpers
`acquire-episodes.task.ts` already exports. This is the one part of the feature where a mistake is
completely silent — a film acquired two days early, or a fallback that quietly lands on a CAM — so it
is the part that carries the tests (Article IX), and it is testable without a database precisely
because it is pure. `startOfUtcDay` is **promoted** into this module from
`acquire-episodes.task.ts`, which imports it back: one copy, not two, and UTC start-of-day arithmetic
is the same requirement here that it was in `073` (a local-time day boundary silently shifts every
offset by one on a host whose `TZ` is not UTC).

**The floor is a veto in the existing ranking, not a filter beside it.** `RankingContext` gains an
optional `minSourceRank`, applied in `rankTorrentResults` alongside the four vetoes it already
applies, *before* the best resolution tier is chosen. This is spec REQ-2b, and it is the one place
the spec changed during planning: the obvious implementation — rank normally, then discard candidates
below the floor — cannot see past the resolution tier, so a 2160p WEB-DL would shadow a 1080p remux
and a film with the physical window marked would acquire nothing, on every run, forever, with no
error anywhere. Arming the veto instead makes the remux the top candidate, which is what a person
picking by hand would do. The field is absent for `forCaller`, so `searchTorrents` and the torrent
modal are unchanged (NFR-8) — and `ranking.spec.ts` gets a case asserting exactly that absence.

**Everything else is an existing seam, used again.** The sweep is a `035-scheduled-tasks` registry
entry plus a handler that copies `AcquireEpisodesTask` almost line for line: select rows, walk them
sequentially, catch per film, count what attached. It reuses `IndexerService.searchRanked` (so the
`040` Redis cache applies), `deriveTitleStatus` from `pipeline-status` (so "nothing in flight" means
the same thing it means in the UI), and `MoviesService.addTorrentToMovie` (so the race arbiter,
`060`'s no-op re-add and `047`'s unwind all apply unchanged). The per-owner union gets a
`forMovieOwners(movieId)` beside `RankingContextService.forShowOwners(showId)` — the same shape, with
two deliberate differences: it reads `movieTorrentGroups` rather than `showTorrentGroups`, and it
computes `allowCinemaReleases` as an **AND** across owners instead of the hardcoded `true` the show
twin uses (REQ-10).

`web` gets three checkboxes in the Movies tab of `/preferences`, saved by the existing form's
`Promise.all` batch, and one rename.

### Two alternatives considered and rejected

- **An installation-wide setting instead of a per-user preference.** Simpler — no migration, no `web`
  work beyond the Settings tab. Rejected because the choice is a statement about what a person wants
  to watch and when, not about how the installation is wired, and `allowCinemaReleases` already
  established that this class of decision is per user. REQ-10's union is the price.
- **A new `acquire_movies` module of its own.** Rejected: the film twin of `AcquireEpisodesTask`
  belongs beside it in `src/scheduler/tasks/`, reading the same `RankingContextService` and the same
  `IndexerService`. A parallel module would be a second way to do one thing (Article X).

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 0 | — | `075` implemented and migrated. `076` reads three columns only `075` creates |
| 1 | `api` | Owns the migration, the three `UserPreferences` fields, the mutation, the registry entry and the sweep. `web` cannot query a field the schema does not have |
| 2 | `web` | Renders the three checkboxes, fires the new mutation, renames the `acquire_pending` key and its two message entries |
| 3 | `docs` | `docs/spec/graphql-contract.md` § `UserPreferences` (line ~416) gains the three fields and `setAcquisitionWindows`; the root `CLAUDE.md` pipeline table gains `076` on the "Find release" and "Download" rows |

Steps 1 and 2 **can overlap** once `spec.md` is `Approved`, which it is: the contract delta is three
`Boolean!` fields and one mutation, and `web`'s slice needs nothing from `api` beyond that shape. It
cannot be *verified* until `api` lands — `bin/npm web run build` type-checks against hand-written
types, not against a live schema (Article VIII), so a `web` slice that builds green proves nothing
about the field existing. Run the manual pass only after step 1.

Step 3 is the orchestrator's, not a service agent's.

## Contract Freeze

`spec.md` § GraphQL Contract Delta is frozen as of `status: Approved`. Two things an implementer will
want to change and must not:

- **`setAcquisitionWindows` takes all three booleans, always.** It looks wasteful next to
  `setAllowCinemaReleases(allowed:)`, and the temptation is three single-field mutations or an
  optional-argument partial update. No: the form saves the three together, a partial update has no
  caller, and three mutations would make three round trips and three chances to half-save a state the
  user sees as one choice.
- **The three fields are booleans on `UserPreferences`, not an enum list.** A
  `acquisitionWindows: [ReleaseWindow!]!` would read better and would need a join table or a
  serialized column underneath, for exactly three bits (Article X). The flat shape also matches
  `allowCinemaReleases`/`audioMandatory` sitting beside it.

What is **not** in the contract and is therefore free: `RankingContext.minSourceRank` is an
`api`-internal type. It never appears in SDL, `web` never sends it, and `searchTorrents` never
resolves one (NFR-8).

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief both services.

## Migrations

1. `add_user_acquisition_windows` — adds `acquireTheatrical`, `acquireDigital`, `acquirePhysical` to
   `users`, each `BOOLEAN NOT NULL DEFAULT false`.
2. Backfill: **none**. The default is the intended value for every existing row (NFR-6/NFR-7) — an
   upgrade must not start acquiring films for a user who has not asked.

Reversibility: dropping the three columns loses only the marks; nothing else references them, and the
sweep with no marks anywhere attaches nothing. The seed change (renaming the two
`schedule_acquire_pending_*` rows to `schedule_acquire_movies_*`) is not reversible by the migration
because it is a seed, not a migration — the old rows survive in an upgraded installation and are
inert, since the registry is the only thing that reads a `schedule_*` key. Do **not** add a data
migration to delete them: writing to `settings` from a migration is a schema tool changing seeded
state (Article III).

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The floor is applied after candidacy instead of as a veto | A film with the physical window marked and a 2160p WEB-DL in its results acquires **nothing, on every run, forever** — a green `SUCCESS` with `itemsProcessed: 0` every night and no error anywhere | The reason REQ-2b and NFR-8 were amended before the freeze. `minSourceRank` goes into `rankTorrentResults`' veto pass; `acquisition-window.spec.ts` and a `ranking.spec.ts` case pin the cross-tier outcome; AC-5b is the live check |
| `minSourceRank` leaks into the `searchTorrents` path | The torrent modal silently starts hiding rows a user could previously pick, with no UI change to explain it | The field is optional and `forCaller` never sets it; a `ranking.spec.ts` case asserts an absent `minSourceRank` returns the identical candidate set to today's |
| Window arithmetic in local time | Every offset silently shifts by a day on a host whose `TZ` is not UTC — a film acquired on digital+0, which is what the +1 exists to prevent | UTC start-of-day, `startOfUtcDay` promoted and shared with `073`; unit cases on both sides of each of the three boundaries |
| The fallback chain walks to theatrical | A user who marked *physical* silently gets a CAM — the exact outcome REQ-4 exists to forbid, and nothing in the UI says where the file came from | The chains are data in `acquisition-window.ts`, with theatrical absent from every chain but its own; a unit case per chain, and AC-7 as the live check |
| A film with all three dates `NULL` treated as "open now" | Turning the task on attaches a release for every unreleased film in the library at once | An absent date resolves to *no window*, never to `now`; `Movie.releaseDate` is deliberately not a fallback (REQ-5); AC-9 |
| Every film fails but the run reads `SUCCESS` | Prowlarr down for a week shows a green run history every morning and nobody looks | Same rule `073` uses: rethrow when at least one film was attempted and **every** attempt failed (AC-11), but not when one bad release failed among several (AC-12) |
| A second source attached for a film already in flight | Two torrents race for one film, both encode, the library file is written twice | Eligibility is `deriveTitleStatus(...) === 'MISSING'`, the derivation the UI already trusts; `060`'s no-op covers an identical infoHash re-add |
| The `acquire_pending` rename half-lands | `web` writes `schedule_acquire_movies_enabled` while `api`'s catalog still refuses the key — or the reverse, and the Scheduling toggle silently does nothing | The rename is enumerated file by file in both service plans (5 files in `api`, 3 in `web`); `updateSettings` refuses an unknown key, so a half-rename fails loudly on save rather than silently — AC-1 checks the panel |
| `scheduler.service.spec.ts`'s "no `mediaType`" case loses its subject | Removing `acquire_pending` leaves every registered task typed, so that case either gets deleted or, worse, the defensive branch in `isAvailable` gets deleted with it | Named explicitly in `api/plan.md`: rewrite the case against a synthetic definition, keep the branch |
| The sweep's query string diverges from what a person would search | "nothing good was found" is really "we searched the wrong string", invisibly | The cleaning rule is the one `buildEpisodeQuery` already uses, extended with the release year; pinned by a unit case, and AC-4 compares the attached release against the modal's first row |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
git diff services/api/src/schema.gql
git diff --stat services/worker
```

The `schema.gql` diff must be exactly the three `Boolean!` fields on `UserPreferences` and the
`setAcquisitionWindows` mutation — nothing else (Articles IV and VIII). `git diff --stat
services/worker` must be empty (NFR-5).

Manual pass, on a dev stack with `075` applied and at least two registered films:

1. `bin/mysql -e 'select username, acquireTheatrical, acquireDigital, acquirePhysical from users'`
   → all zero (AC-1). Settings → Scheduling lists `acquire_movies`, off, and no `acquire_pending`
   (AC-1).
2. `/preferences` → Movies tab: mark digital and physical, save, reload, both still marked; confirm
   in `bin/mysql` (AC-2).
3. Set one film's `digitalReleaseDate` to today (`bin/mysql`), turn `acquire_movies` on, "Ejecutar
   ahora" → `SUCCESS`, 0 items, film still `MISSING` (AC-3). Move it back two days, run again → one
   source, and `/downloads` names a WEB-DL or better (AC-4). Compare it against the first row the
   film's own torrent modal shows under "Best candidates".
4. `physicalReleaseDate` 10 days back, physical only, on a film whose results top out at BluRay →
   nothing attached, still selected next run (AC-5). Then on a film whose results hold a 2160p WEB-DL
   and a 1080p remux → the remux is attached (AC-5b); switch to digital only and confirm the WEB-DL
   is (AC-5b).
5. `digitalReleaseDate` set, `physicalReleaseDate` NULL, physical only → a WEB-DL is attached (AC-6,
   the `The Wrecking Crew` case). Then only `theatricalReleaseDate` set, physical only → nothing, on
   repeated runs (AC-7).
6. Theatrical marked with `allowCinemaReleases` off on a film in cinemas → nothing attached; turn the
   preference on, run again → the best available release, CAM included (AC-8).
7. All three dates NULL, all three marked → `SUCCESS`, nothing attached (AC-9). A film with a live
   source and a `COMPLETED` film → both skipped (AC-10).
8. `docker compose stop indexer`, run → `FAILED` with the count in its error, nothing touched; start
   it and confirm the next run attaches (AC-11).
9. Two eligible films, the first with an infoHash qBittorrent refuses → the second is attached,
   `itemsProcessed: 1` (AC-12).
10. `movies_enabled` false → the manual trigger is refused and no run row is created (AC-13).
11. 30 eligible films → at most 20 in one run, the rest next run (AC-14).
12. A film two users hold, one marking digital and the other nothing → acquired on the digital window;
    one owner allowing cinema releases and the other not → no capture ever attached (AC-15).
13. Re-open any film's torrent modal → list, toggle and chips unchanged (AC-17).

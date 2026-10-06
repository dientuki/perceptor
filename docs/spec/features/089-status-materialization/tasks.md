---
title: Status materialization — Tasks
last_updated: 2026-10-06
status: Draft
---

# TASKS: Status materialization (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Only `api` and `docs` appear. `services: [api]`, and the GraphQL surface does not change
(`spec.md` § GraphQL Contract Delta: **None**), so `web` and `worker` are owed nothing — `web`'s
`StatusBadge` already renders all eight values and `worker` reads no title status. **An agent that
finds itself needing to edit `services/web/` or `services/worker/` has hit a contract problem: stop
and record it under § Blocked** (Article VIII).

## Tasks

### Group 1 — schema

Both tasks edit `prisma/schema.prisma`, so they are sequential, not parallel. Generated through
`bin/npm api run prisma:migrate` — never hand-written SQL against a running database (Article III).

- [ ] **T001** `[api]` Widen the `MediaStatus` enum with `QUEUED`, `PAUSED` and `DOWNLOADED` so the
      column can hold all eight `PipelineStatus` values (`spec.md` REQ-5). Additive; no existing row
      changes meaning.
      *Done when:* `bin/npm api run prisma:migrate` creates a migration directory,
      `bin/cli api npx prisma migrate status` reports no pending migration, and
      `bin/mysql -e "show columns from movies like 'status'"` lists all eight values.

- [ ] **T002** `[api]` Add `mediaServerPresentAt DateTime?` to `Movie` and `Episode`, nullable with
      no default, and in the **same migration** backfill it:
      `update movies set media_server_present_at = now() where status = 'COMPLETED' and file_path is null;`
      and the same for `episodes` (REQ-4, NFR-3). The backfill is exact, not a guess: `filePath` is
      written in exactly one place (`process-jobs.service.ts:307`) and always together with
      `COMPLETED`, so that state is reachable only through reconciliation. Not exposed on any GraphQL
      type. → T001
      *Done when:* `bin/mysql -e "select count(*) from movies where media_server_present_at is not null"`
      returns the same count as
      `bin/mysql -e "select count(*) from movies where status='COMPLETED' and file_path is null"`,
      and the same holds for `episodes`.

### Group 2 — the pure derivation

`src/pipeline-status/pipeline-status.ts` stays a pure module with **no Prisma import and no Nest
module** (NFR-6, `services/api/CLAUDE.md`). Both tasks edit the same file and its spec, so they are
sequential. They land with their tests: this is the cheapest place to prove REQ-2, because the module
is pure.

- [ ] **T003** `[api]` Remove the stored-status input from `deriveTitleStatus` and replace it with
      possession: `TitleAltitudeInput` drops `status: MediaStatus` and gains
      `{ filePath: string | null; mediaServerPresentAt: Date | null }`, checked **before** the ladder
      (REQ-2, REQ-3, REQ-4). Delete `toMediaStatus` (REQ-5) — fix its two call sites in
      `downloads.service.ts` by deletion, not by widening it. `069` REQ-17's exclusions stay: a
      `SCANNED` source and a `COMPLETED` job still do not lift; with possession now explicit, they are
      what keep a demotion sticking. → T001
      *Done when:* `pipeline-status.spec.ts` asserts that a source moving `QUEUED → PAUSED` **lowers**
      the answer at the unit level (impossible to assert while the stored status is an input — this is the
      ratchet in `spec.md` § Context, and the unit half of AC-1), that possession beats the ladder, and that `grep -rn "toMediaStatus"
      services/api/src` returns nothing. `bin/npm api run test` passes.

- [ ] **T004** `[api]` Add `deriveShowStatus(episodes, now)` (REQ-11): `COMPLETED` when every **aired**
      episode is `COMPLETED`, where aired reuses the existing `isLiftedBySeasonPack` predicate
      (`releaseDate !== null && releaseDate <= now`) rather than re-expressing it; otherwise the max
      over the episodes by the existing ladder; `MISSING` when no episode has aired. A `Show` has no
      `filePath` and no possession column — it aggregates only. → T003
      *Done when:* `pipeline-status.spec.ts` covers a series whose unaired next episode does not hold
      it back (AC-12), and a series with no aired episode reading `MISSING`. `bin/npm api run test`
      passes.

### Group 3 — the owner

- [ ] **T005** `[api]` Create `src/title-status/` — `title-status.module.ts` importing **only**
      `PrismaModule`, and `TitleStatusService` exposing `recomputeMovie(id)`, `recomputeEpisode(id)`,
      `recomputeSeason(id)` and `recomputeShow(id)`, each taking **an id and nothing else** (REQ-1).
      Move `DownloadsService.recomputeMovieStatus` / `recomputeEpisodeStatus`
      (`downloads.service.ts:838`) into it — they already have this exact shape; move, do not
      reimplement. Blast radius belongs to this service, not its callers: `recomputeEpisode` cascades
      to its series, and `recomputeSeason` recomputes **every episode of the season** before the show
      (REQ-13). Each write is a guarded `updateMany` naming the status it expects to replace (NFR-2),
      following `media-server-reconcile.service.ts:128`. A missing target is a silent no-op.
      It injects nothing from any caller, so the Nest graph stays a tree — **if a dependency is needed
      in the other direction, stop and report**. → T004
      *Done when:* `title-status.service.spec.ts` covers: a season-scoped change recomputing its
      episodes so the `059` lift is un-written (AC-14); an episode recompute cascading to its series;
      a media-server-promoted target with no `filePath`, no source and no job **not** being demoted,
      for a film (AC-8) and for an episode (AC-9); and a null `mediaServerPresentAt` never demoting on
      its own (AC-11, NFR-5). `bin/npm api run test` and `bin/cli api npx tsc --noEmit` pass.

### Group 4 — convert the writers

Every task here deletes status literals and replaces them with a notification passing the id. **Delete
the literal; do not keep it "for clarity."** All six touch different files and may run in parallel.
`media-server-reconcile.service.ts` is deliberately **not** in this group — those writes are the media
server's verdict, which `069` REQ-17 makes authoritative (see T012).

- [ ] **T006** `[api] [P]` `movies/movies.service.ts` lines 732 and 780 — the two
      `movie.status = 'DOWNLOADING'` writes at attach. Import `TitleStatusModule` in
      `movies.module.ts`. → T005
      *Done when:* neither line writes a status literal; attaching a torrent to a film leaves the film
      reading `QUEUED`, not `DOWNLOADING` (AC-2).

- [ ] **T007** `[api] [P]` `episodes/episodes.service.ts` lines 142 and 188 — the two
      `episode.status = 'DOWNLOADING'` writes at attach. Import `TitleStatusModule` in
      `episodes.module.ts`. → T005
      *Done when:* neither line writes a status literal and `bin/npm api run test` passes.

- [ ] **T008** `[api] [P]` `media-sources/media-sources.service.ts` lines 63, 67 (`'ERROR'` on scan
      failure) and 233 (`'ENCODING'` when the scan enqueues). Import `TitleStatusModule` in
      `media-sources.module.ts`. → T005
      *Done when:* none of the three writes a status literal and `bin/npm api run test` passes.

- [ ] **T009** `[api] [P]` `uploads/uploads.service.ts` lines 232, 280 (`'ENCODING'` on upload close)
      and 306, 320 (`'ERROR'`). Import `TitleStatusModule` in `uploads.module.ts`. → T005
      *Done when:* none of the four writes a status literal and `bin/npm api run test` passes.

- [ ] **T010** `[api]` `downloads/downloads.service.ts` lines 272, 285 (`'ERROR'`) and 1046, 1053
      (`'ENCODING'` on `torrentCompleted`), plus the two `recompute*Status` bodies at 847–868 whose
      implementation moved in T005 — their call sites, including `047`'s `unwindSourcesForTitle`, now
      call `TitleStatusService`. Import `TitleStatusModule` in `downloads.module.ts`. Not `[P]`:
      T017 edits this same file. → T005
      *Done when:* no status literal is written to a `movie`/`episode` row in this file, deleting an
      errored source lowers the title off `ERROR` rather than leaving a dead value (AC-6), and
      `bin/npm api run test` passes.

- [ ] **T011** `[api] [P]` `process-jobs/process-jobs.service.ts` lines 307, 312
      (`'COMPLETED'` + `filePath` — **keep writing `filePath`**, drop only the status) and 393, 395
      (`'ERROR'` via `propagateJobError`). Import `TitleStatusModule` in `process-jobs.module.ts`.
      → T005
      *Done when:* `filePath` is still written on encode completion, no status literal is, and
      `bin/npm api run test` passes.

- [ ] **T012** `[api] [P]` `seasons/seasons.service.ts` — the season-scoped acquisition paths notify
      `recomputeSeason`, which is what un-writes the `059` lift (REQ-13). Import `TitleStatusModule`
      in `seasons.module.ts`. → T005
      *Done when:* attaching and then deleting a season pack leaves its aired episodes back at
      `MISSING` (AC-14).

### Group 5 — reconciliation records possession

- [ ] **T013** `[api]` `media-server/media-server-reconcile.service.ts` — every place that promotes to
      `COMPLETED` also sets `mediaServerPresentAt: new Date()`, and every place that demotes also
      clears it to `null` **in the same `updateMany`** as the existing `filePath: null`. All five
      sites: `:60`, `:101` (the per-episode promotion — the case `media_server_items` could never
      express), `:128`, `:132`, `:207`. A demotion that clears `filePath` but not the presence column
      only half-works: the next recompute reads possession and promotes the title straight back, with
      no error anywhere. → T002
      *Done when:* a spec covers that a demotion leaves **both** columns null and that a recompute
      immediately after does not promote the title back (AC-10). `bin/npm api run test` passes.

### Group 6 — switch the readers

Must not land before Group 4 is complete: between them, reads return the column while some writers
still set a literal, which is the only genuinely broken intermediate state in this feature.

**Both tasks carry the same trap.** `scheduler/tasks/acquire-movies.task.ts:46` and
`acquire-episodes.task.ts:67` select work by `deriveTitleStatus(...) === 'MISSING'` /
`deriveEpisodeStatus(...) === 'MISSING'`. **They must keep reading the live rows and must not be
switched to the column.** Their question is "is there work in flight", which the sources and jobs
answer directly; a momentarily stale `MISSING` would make the sweep attach a second release for a
title already downloading — spending bandwidth with no error anywhere, since `087`'s guard refuses a
`COMPLETED` target, not a `QUEUED` one. This is a deliberate asymmetry, not an oversight.

- [ ] **T014** `[api] [P]` `movies/movies.service.ts:153` — `withDerivedStatus` returns `movie.status`
      directly instead of calling `deriveTitleStatus` (REQ-6). Leave `acquire-movies.task.ts`
      untouched. → T006, T007, T008, T009, T010, T011, T012
      *Done when:* a film's `status` on the wire comes from the column, still as `String!`, and still
      carries the eight-value vocabulary; `acquire-movies.task.ts` still calls `deriveTitleStatus`.

- [ ] **T015** `[api] [P]` `shows/shows.service.ts:118` and `:139` — the two `deriveEpisodeStatus`
      calls return the stored episode status (REQ-6). `/calendar` inherits this through
      `findEpisodesReleasedBetween`, which is why the calendar and the detail page still cannot
      disagree. Leave `acquire-episodes.task.ts` untouched. → T006, T007, T008, T009, T010, T011, T012
      *Done when:* an episode's `status` comes from the column; `acquire-episodes.task.ts` still calls
      `deriveEpisodeStatus`.

### Group 7 — the torrent client

Independent of Groups 4–6 except where noted, so T016 can start as soon as Group 3 is done.

- [ ] **T016** `[api] [P]` `clients/torrent/client.ts` — move `queuedDL` out of `DOWNLOADING_STATES`
      so `mapTorrentState` returns `QUEUED` for it (REQ-9). Nothing else in the mapping changes:
      `stalledDL`, `metaDL`, `allocating`, `checkingDL`, `checkingResumeData`, `forcedDL` and the
      unrecognised-state fallback all stay `DOWNLOADING`. → T005
      *Done when:* a spec following `magnet.spec.ts`'s header convention covers `queuedDL → QUEUED`,
      the five coarse states → `DOWNLOADING`, an unrecognised state → `DOWNLOADING` with the loud log
      rather than `ERROR` (the regression `037` fixed), and a completed torrent → `READY`.

- [ ] **T017** `[api]` `downloads/downloads.service.ts` — after each existing live read, persist
      **every row the call returned**, not only the row the caller asked about, through
      `writeStatusIfNonTerminal` (REQ-7, REQ-8). The three sites: `liveInfoByHash` (serving
      `movieDownloads`, `showDownloads` and `downloads`) and `liveInfoForHash` (serving
      `downloadStart`/`downloadStop`/`downloadDelete`). An empty map from a failed read writes nothing
      (NFR-4). A write-back that actually changed a source's status notifies that source's target —
      do **not** recompute per row unconditionally, or a `/downloads` load touching fifty unchanged
      rows fires fifty recomputes. **Not one new call to the torrent client** (NFR-1): both helpers
      already return every row, and `liveInfoForHash` already calls `info()` untagged. → T010, T016
      *Done when:* `downloads.service.spec.ts` covers that a `SCANNED` source whose torrent is seeding
      is **not** demoted to `READY` (AC-4 — unguarded, `isRaceWinner` hands the race to a source whose
      encode already failed), that a failed or empty live read writes nothing (AC-5), and that the
      write-back persists every returned row rather than only the acted-on one (AC-7 — persisting only
      the acted-on row is the plausible wrong implementation and produces no error).

### Group 8 — time and backfill

- [ ] **T018** `[api]` `scheduler/tasks/refresh-episodes.task.ts` — recompute the series it already
      walks, so a series stops reading `COMPLETED` within 24 hours of its next episode airing
      (REQ-12). **It must not depend on a task the installation opted into** — a series' status is not
      a feature a user enables. If the chosen host is opt-in, put the recompute somewhere that runs
      unconditionally instead and say so in the report. → T005
      *Done when:* a spec covers that an episode crossing its air date drops its series off
      `COMPLETED` (AC-13), on an installation with no scheduled task enabled.

- [ ] **T019** `[api]` `src/scripts/recompute-statuses.ts` — recompute every `Movie`, `Episode` and
      `Show` through `TitleStatusService`, idempotent by construction since it derives only from rows.
      This is what un-sticks every title left at `DOWNLOADING` by the ratchet and the only thing that
      moves `Show.status` off `MISSING` on an existing install (NFR-3). **Wire its invocation so it
      runs unconditionally after migrations on boot** — `src/bootstrap/run-migrations.ts` is the
      existing seam (`049` REQ-10), and an end user upgrading with `PERCEPTOR_AUTO_MIGRATE` never runs
      a script by hand, so a manual-only script leaves every such installation stuck. Follow the
      conventions of `src/scripts/reset-password.ts`; add no CLI framework. → T005, T013, T014, T015
      *Done when:* on a database holding a title stuck at `DOWNLOADING` with no live source, running
      it leaves that title reading its true status, running it twice changes nothing the second time,
      and `bin/mysql -e "select status, count(*) from shows group by status"` shows rows outside
      `MISSING` (all `MISSING` today) — the backfill half of AC-16.

### Group 9 — verification and docs

- [ ] **T020** `[api]` Full verification pass. → T017, T018, T019
      *Done when:* `bin/npm api run test`, `bin/cli api npx tsc --noEmit` and `bin/comments api` are
      all clean (the suite half of AC-16); pausing a film's only source leaves the film reading
      `PAUSED` rather than `DOWNLOADING` end to end (**AC-1 — this fails today**);
      `bin/mysql -e "select status, count(*) from media_sources group by status"` shows a
      non-zero `DOWNLOADING` while a torrent transfers (zero today in every state of the system,
      AC-3); and
      `grep -rn "status: *'\(DOWNLOADING\|ENCODING\)'" services/api/src --include=*.ts | grep -v spec.ts`
      returns no `movie.update` / `episode.update` / `show.update` call site (AC-15). Also confirm
      `acquire-movies.task.ts` and `acquire-episodes.task.ts` still call the derive functions.

- [ ] **T021** `[docs]` `docs/spec/graphql-contract.md` — record that `Show.status` now moves off
      `MISSING`, beside the existing `Episode.status` note from `059`. Same field, same `String!`,
      same eight-value vocabulary `Movie`/`Episode` already use, so no consumer change is owed — but
      it is behaviourally visible on any screen rendering a series' badge. Note also that
      `mediaServerPresentAt` is deliberately **not** on the wire. → T020

- [ ] **T022** `[docs]` `CLAUDE.md` updates. → T020
      - Root: the **Download** and **Detect completion, enqueue** rows (how status is recorded) and
        **Browse library** (where a read gets its answer), plus the `089` spec ref.
      - `services/api/CLAUDE.md`: the module map gains `title-status/` as the single writer of the
        three status columns; the `pipeline-status/` entry loses `toMediaStatus` and its
        stored-status input and gains `deriveShowStatus`; the `downloads/` entry records the
        write-back.

- [ ] **T023** `[docs]` Walk the sixteen acceptance criteria in `spec.md`, tick each box, append the
      measurement entry to `docs/spec/history.md` (newest first — never to the root `CLAUDE.md`,
      `086` REQ-11), and set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and this
      file. → T021, T022

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

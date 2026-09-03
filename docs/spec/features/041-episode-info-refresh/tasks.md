---
title: Episode Info Refresh — Tasks
last_updated: 2026-09-03
status: Done
---

# TASKS: Episode Info Refresh (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**No task in this feature carries `[P]`, and that is not an oversight.** `services:` is `[api]`
alone, every task below feeds the next, and there is no second service to overlap with. `web` and
`worker` have no slice here — the sweep adds no GraphQL surface, so neither has anything to retype
(`../041-episode-info-refresh/spec.md` § GraphQL Contract Delta: *None*).

## Tasks

### Group 1 — the handler

- [x] **T001** `[api]` Replace the stub body of `RefreshEpisodesTask.run()` in
      `services/api/src/scheduler/tasks/refresh-episodes.task.ts` with the sweep described in
      `api/plan.md` § Steps: inject `PrismaService` and `TmdbClient`; select every `Episode` whose
      `releaseDate` is `NULL` or `>= cutoff` (UTC start-of-day minus a module-level two-day
      constant, computed from one `now` captured at the top of `run()`); return
      `{ itemsProcessed: 0 }` before any TMDB call when that selection is empty; group the rows by
      `` `${show.tmdbId}:${season.seasonNumber}` ``; walk the groups with a sequential `for…of`,
      one `seasonDetails` call each; index the response by `episodeNumber` and update **only** the
      selected rows, with exactly `{ title, overview, releaseDate }`; leave a selected row absent
      from the response untouched and uncounted; catch each group's failure individually and keep
      going; throw an `Error` naming the failed-group count and the successful write count if any
      group failed, otherwise return the count.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, and
      `git diff --stat services/api/src/schema.gql services/api/prisma` prints nothing — this task
      adds no decorator and no migration (`plan.md` § Contract Freeze, § Migrations).

- [x] **T002** `[api]` Add `services/api/src/scheduler/tasks/refresh-episodes.task.spec.ts` with a
      mocked `PrismaService` and `TmdbClient` (follow `shows.service.spec.ts` and
      `scheduler.service.spec.ts`), opening with the Article IX paragraph naming the failures it
      defends against. Four cases, per `api/plan.md` § Tests: the selection boundary (an episode
      three days out, one that aired yesterday, one that aired three days ago, one with a `NULL`
      `releaseDate` — the third is never passed to an `update`); one `seasonDetails` call per
      distinct `(tmdbId, seasonNumber)` across three seasons of two series; a season response that
      omits one selected `episodeNumber` (no `update` for that row, not in `itemsProcessed`); and a
      first-of-two group rejecting (the second group's rows still written, `run()` throws naming one
      failed season). → T001
      *Done when:* `bin/npm api run test` is green and its output lists the four new cases; AC-2,
      AC-3, AC-4, AC-6 and AC-7 are each satisfied by one of them.

### Group 2 — verification

Depends on the handler and its test both existing; nothing here can be judged before then.

- [x] **T003** `[api]` Run the full verification set from `plan.md` § Verification and report the
      numbers: `bin/cli api npx --no tsc --noEmit`, `bin/npm api run test`, and
      `git diff --stat services/api/src/schema.gql services/api/prisma`. → T002
      *Done when:* typecheck 0 errors, the whole `api` suite green with its new total reported
      (previous measurement: 331 tests / 35 suites), and the third command's output empty. This is
      AC-8.

- [x] **T004** `[docs]` Manual live pass against a running stack with a valid `movie_db_api_key`,
      following `plan.md` § Verification steps 1–5: register a currently-airing series and wait for
      `shows.seasonsSyncedAt`; blank the `title`/`overview` of an episode whose `releaseDate` is in
      the future and note the `title` of one that aired a month ago; trigger
      `runScheduledTask(id: "refresh_episodes")` as an admin; confirm the future episode recovered
      its TMDB title while the month-old row is byte-identical; then set `movie_db_api_key` to
      garbage, trigger again, and confirm the run records `FAILED` with the TMDB error, `api` stays
      healthy, and a trigger after restoring the key succeeds. → T003
      *Done when:* AC-1 and AC-5 are each observed with the actual row contents and the actual
      `lastRun` payload written down, and the Settings key is restored to its real value.

### Group 3 — docs

- [x] **T005** `[docs]` Update the `scheduler/` bullet in `services/api/CLAUDE.md` (around line
      380): it currently states all four handlers are stubs returning `{ itemsProcessed: 0 }`,
      which stops being true for `refresh_episodes` — say what the task now does, its selection
      window, its one-fetch-per-season budget, and that it throws on a partial failure so the run
      records `FAILED`. Update the test counts in the root `CLAUDE.md` § Current state with the
      numbers T003 measured. The root pipeline table gains no row: this is the existing
      **Register title in DB** stage acquiring a second, scheduled entry point, not a new stage —
      note that in the same sentence the table's `034`/`006` refs already use. → T004
      *Done when:* neither `CLAUDE.md` still describes `refresh_episodes` as a stub, and the test
      counts match T003's output.

- [x] **T006** `[docs]` Walk the eight acceptance criteria in `spec.md`, tick each box with an
      *Observed:* line saying where it was proven (T002's test name, T003's command output, or
      T004's live observation), and set `status: Implemented` on `spec.md`, `plan.md` and
      `api/plan.md`. → T005
      *Done when:* no unticked `- [ ] **AC-` remains in `spec.md` and all three files read
      `status: Implemented`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

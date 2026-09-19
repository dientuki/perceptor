---
title: Duplicate Torrent Add — Tasks
last_updated: 2026-09-18
status: Draft            # Draft | In Progress | Done
---

# TASKS: Duplicate Torrent Add (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task: a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

There is no contract group. `spec.md` § GraphQL Contract Delta is "None" and only `api` is touched.
Every service task follows `api/plan.md` § Steps for its own twin and adds that plan's § Tests
cases to its own spec file.

## Tasks

### Group 1: the pattern (movie twin)

The movie twin goes first. Its suite already has an `attachTorrentSource` describe block, and the
branch it lands on (no-op → reactivate → genuine add) is the shape the other two copy.

- [ ] **T001** `[api]` First, record the baseline: `bin/cli api npx --no tsc --noEmit` and
      `bin/npm api test` (tests/suites). Then, in `services/api/src/movies/movies.service.ts`, split
      `attachTorrentSource`'s same-target branch per `api/plan.md` § Steps 2–7:
      - move the different-target conflict checks above the `COMPLETED`/`force` check;
      - REQ-1/REQ-2 no-op returns a plain `movie.findUniqueOrThrow`, with no qBittorrent call and no
        write;
      - REQ-3 `ERROR` duplicate: an `info()` lookup that propagates errors, then `start()` only when
        the torrent has not finished, then a row update touching only `status` and the three error
        fields;
      - REQ-4: a finished torrent calls `DownloadsService.handleTorrentCompleted(hash)` after the
        row update, then the final read;
      - a torrent qBittorrent no longer holds falls through to today's `add()` path.

      Import `DownloadsModule` in `movies.module.ts` and inject `DownloadsService`. In
      `movies.service.spec.ts`:
      - add a `DownloadsService` mock provider;
      - add the six cases from `api/plan.md` § Tests: active no-op with a differing second URL,
        no-op under `COMPLETED` + `force`, `ERROR` held and not finished, `ERROR` held and
        finished, `ERROR` not held, client unreachable;
      - extend the header paragraph with this failure class.

      *Done when:* the typecheck reports 0 errors; `bin/npm api test` is green with the baseline +
      the new cases. The report pastes both baseline and final counts. It also confirms each new
      case was seen failing under fault injection — no-op moved below the `COMPLETED` check,
      `handleTorrentCompleted` moved before the row update, `info()` wrapped in a catch — and then
      restored. The existing `addMagnetToMovie (attachTorrentSource conflict key)` cases still pass
      unchanged (REQ-5).

### Group 2: the other two twins

Both copy T001's shape into their own file. They touch disjoint files, so they can run in
parallel. Neither may edit `movies/`.

- [ ] **T002** `[api] [P]` Same change in `services/api/src/episodes/episodes.service.ts`,
      `episodes.module.ts` and `episodes.service.spec.ts`. The existing demote-on-`force` block
      stays where it is: after the qBittorrent calls, before the row write, and never reached by
      the no-op. The no-op returns `episode.findUniqueOrThrow`. Tests are the same six cases.
      Additionally, the `COMPLETED` + `force` + `SCANNED` case asserts that the demote `updateMany`
      is **not** called (REQ-2). → T001
      *Done when:* the typecheck reports 0 errors; `bin/npm api test` is green with the new cases;
      the fault-injection confirmation is reported as in T001; `git diff --stat` touches only
      `services/api/src/episodes/`.

- [ ] **T003** `[api] [P]` Same change in `services/api/src/seasons/seasons.service.ts`,
      `seasons.module.ts` and `seasons.service.spec.ts`. The no-op's final read is the same
      `season.findUniqueOrThrow` **with `episodes` included** that the method already ends with; a
      bare row fails the mutation. The demote block is handled as in T002. Tests are the same six
      cases plus the same no-demote assertion, and the no-op case asserts that the returned season
      carries `episodes`. → T001
      *Done when:* the typecheck reports 0 errors; `bin/npm api test` is green with the new cases;
      the fault-injection confirmation is reported; `git diff --stat` touches only
      `services/api/src/seasons/`.

### Group 3: verification and docs

- [ ] **T004** `[api]` Run `plan.md` § Verification in full against the finished slice:
      - `bin/cli api npx --no tsc --noEmit`;
      - `bin/npm api test`;
      - `git status --short services/api/prisma` (expected empty);
      - `git diff --stat services/web services/worker` (expected empty);
      - confirm `services/api/src/schema.gql` does not appear in `git diff`.

      Then the manual pass, `plan.md` § Verification steps 1–6, against a running stack. The
      agent must not start the stack itself. If `api` is not already up, record the command results
      and list the manual steps as pending for the human. → T002, T003
      *Done when:* every command's output is pasted with the expected result. Each of AC-1 to AC-7
      is marked as either observed live (with the query output or UI observation) or pending
      manual. AC-8 is covered by the test run.

- [ ] **T005** `[docs]` Update the docs:
      - `services/api/CLAUDE.md` § Module map: the `episodes/` and `seasons/` entries (and the
        `attachTorrentSource` description they share with `movies/`) now say that a same-target
        duplicate is a no-op unless the source is `ERROR`, and that an `ERROR` one is reactivated in
        place (keeping `downloadPath`, started if unfinished, handed to
        `DownloadsService.handleTorrentCompleted` if finished). Also note that
        `movies`/`episodes`/`seasons` now import `DownloadsModule`. Update `## Current state` with
        T004's counts.
      - Root `CLAUDE.md`: add `060` to the **Download** row's spec column with one sentence on the
        behaviour. Append a `## Current state` entry dated from T004's run. → T004
      *Done when:* both files name `060`, the module-map text matches what T001–T003 shipped, and
      the counts match T004's report.

- [ ] **T006** `[docs]` Walk AC-1 to AC-8 in `spec.md` against T004's report. Tick each one with a
      trace to the report line that proves it. Leave any AC that was only "pending manual" unticked
      and move it to § Blocked with what it needs. Tick REQ-1 to REQ-6 and NFR-1 to NFR-4. Set
      `status: Implemented` on `spec.md`, `plan.md` and `api/plan.md`, and `status: Done` here. → T005
      *Done when:* no box in `spec.md` is unticked without a matching § Blocked row, and the four
      files carry the new statuses.

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty
entry is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.

---
title: Season scan write conflict — Tasks
last_updated: 2026-11-07
status: Done             # Draft | In Progress | Done
---

# TASKS: Season scan write conflict (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` | Owned by the `api` subagent. This feature touches no other service. |
| `[docs]` | Documentation and the manual pass. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer. |

**Measuring.** The stack running on this host is the end-user install (`ptor`), not this checkout,
so `bin/cli`/`bin/npm` may find no container. When they do not, run each *Done when* command through
the throwaway container described in memory (`measuring-without-dev-stack`):

```bash
docker run --rm --user 1000:1000 -v "$PWD/services/api":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c '<command>'
```

Report which form was used.

## Tasks

### Group 1 — `api`: the failing tests (spec REQ-6)

Nothing in production code changes in this group. The point is to see red.

- [x] **T001** `[api]` Add the six failing test groups listed in `api/plan.md` § Steps 1, and touch
      no file outside `*.spec.ts`:
      - (a) `src/seasons/seasons.service.spec.ts`: `finishSeasonUpload` completes
        `titleStatus.recomputeSeason` before `queue.addSourceReady`;
      - (b) `src/downloads/downloads.service.spec.ts`: `downloadStart` on a season source in `ERROR`
        at stage `SCAN` completes the recompute before `addSourceReady` and makes none after it;
      - (c), (d) and (e) in `src/media-sources/media-sources.service.spec.ts`:
        - (c) a 1020 on the first attempt commits on the second, with each committed `ProcessJob`
          enqueued once and nothing from the rejected attempt;
        - (d) a 1020 on every attempt means exactly 3 attempts, the error rethrown, and no
          `addEncode` and no recompute;
        - (e) a non-conflict error means exactly 1 attempt;
      - `src/prisma/write-conflict.spec.ts`: the classifier cases.
      Build the 1020 error with the shape Prisma 7 produces:
      `new Prisma.PrismaClientKnownRequestError(msg, { code: 'P2039', clientVersion: 'test', meta: { driverAdapterError: { cause: { originalCode: '1020' } } } })`.
      *Done when:* `bin/npm api test -- src/seasons src/downloads src/media-sources src/prisma`
      fails on exactly the new cases. `write-conflict.spec.ts` fails because its module does not exist
      yet, and every pre-existing case still passes. The failing output is pasted into the task report
      (spec AC-1).

### Group 2 — `api`: the fix

T002, T003 and T004 touch disjoint files and may run in parallel. T005 needs T004's classifier.

- [x] **T002** `[api] [P]` In `src/seasons/seasons.service.ts`, move `finishSeasonUpload`'s
      `titleStatus.recomputeSeason(seasonId)` between the guarded `PENDING → READY` `updateMany` and
      `queue.addSourceReady(...)`, with a `// Spec 116, REQ-1` locator. → T001
      *Done when:* test (a) passes and every other case in `seasons.service.spec.ts` still passes,
      including `status materialization (089, REQ-13)`.

- [x] **T003** `[api] [P]` In `src/downloads/downloads.service.ts`, make the `SCAN` branch of
      `downloadStart` recompute the source's target through the existing private `recomputeStatus`
      after `resumeScanStage` flips `ERROR → READY` and before it enqueues, and skip the trailing
      `recomputeStatus(source)` for that branch only. When `resumeScanStage` returns without
      enqueueing, the trailing recompute still runs once. The `ENCODE` and `DOWNLOAD` branches are
      unchanged. → T001
      *Done when:* test (b) passes and every case in the `downloadStart on an ERROR source — resume`
      block still passes.

- [x] **T004** `[api] [P]` Create `src/prisma/write-conflict.ts` exporting
      `isSnapshotWriteConflict(error: unknown): boolean`. It is true only for a
      `Prisma.PrismaClientKnownRequestError` with `code === 'P2039'` and
      `String(meta?.driverAdapterError?.cause?.originalCode) === '1020'`. It is pure and is not a Nest
      provider. → T001
      *Done when:* `bin/npm api test -- src/prisma/write-conflict.spec.ts` passes.

- [x] **T005** `[api]` In `src/media-sources/media-sources.service.ts`, wrap `sourceScanned`'s
      `$transaction` in at most 3 attempts (a module-level constant):
      - the callback returns the `ProcessJob` ids to queue, the episode ids to recompute and the
        scan-failed target, instead of mutating variables declared outside it;
      - on `isSnapshotWriteConflict` with attempts left, log
        `[sourceScanned] mediaSource <id>: write conflict, attempt <n>/3` and run it again;
      - otherwise rethrow the error unchanged;
      - the post-commit block (recomputes, `addEncode`, the `QUEUED` `updateMany`, `findOneFlat`) runs
        once, from the committed attempt's result. → T004
      *Done when:* tests (c), (d) and (e) pass, and every pre-existing case in
      `media-sources.service.spec.ts` still passes.

### Group 3 — verification and docs

- [x] **T006** `[api]` Full gate plus fault injection. Run the commands below, then revert each of
      these temporarily and confirm a named test goes red:
      - the recompute put back after the enqueue in `finishSeasonUpload` → (a);
      - the trailing recompute restored for `SCAN` → (b);
      - the per-attempt state hoisted back outside the transaction → (c);
      - the attempt cap set to 1 → (d);
      - the classifier widened to any `P2039` → `write-conflict.spec.ts`.
      → T002, T003, T005
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, `bin/npm api test` is green
      with the suite and test counts reported, and `bin/comments api` passes. Each fault-injection
      result is listed in the report (spec AC-2, AC-5, AC-6).

- [~] **T007** `[docs]` Manual pass on a stack running this checkout's `api`:
      - AC-3: upload two or more episode files of one season through the season header's import
        button. The source must reach `SCANNED`, `/downloads` must show one `ProcessJob` per file, and
        the worker log must show `completed media-source-<id>` with no `1020`;
      - AC-7: while that scan runs, the season's aired episodes read `QUEUED`;
      - AC-4: after deploying to production, press Play on source 422's row; it must reach `SCANNED`
        with S02E02/S02E03 queued. This is a maintainer step, so mark it `[~]` until it is done. → T006
      *Done when:* each criterion is recorded as passed (with the source id and the log line), or left
      `[~]` naming what is pending.

- [x] **T008** `[docs]` Update the docs. → T006
      - In the root `CLAUDE.md` pipeline table, add a `116` sentence to the **Detect completion,
        enqueue** row and `116` to its spec list: the status recompute an action triggers finishes
        before the scan is enqueued, and `sourceScanned` retries MariaDB's snapshot-isolation conflict
        (1020) up to 3 attempts.
      - In `services/api/CLAUDE.md`, describe in the `media-sources/` bullet the retry, its classifier
        (`src/prisma/write-conflict.ts`, `P2039` + `originalCode` 1020, why not `P2034`) and the
        per-attempt state rule, and add a note under `seasons/`/`downloads/` that the recompute
        precedes the enqueue.
      - Append a `116` entry to `docs/spec/history.md` with the counts from T006.
      *Done when:* `grep -n "116" CLAUDE.md services/api/CLAUDE.md docs/spec/history.md` shows each
      addition.

- [~] **T009** `[docs]` Walk `spec.md`'s acceptance criteria and tick each one T006/T007 proved. Set
      `status: Implemented` on `spec.md`, `plan.md` and `api/plan.md` (leave it at `Approved` while
      AC-4 is `[~]`, and say so), set this file's `status: Done`, and run `bin/pending-acs`. → T007, T008
      *Done when:* `bin/pending-acs --check` exits 0.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

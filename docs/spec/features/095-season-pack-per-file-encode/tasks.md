---
title: Per-file breakdown of multi-file sources — Tasks
last_updated: 2026-10-17
status: Done
---

# TASKS: Per-file breakdown of multi-file sources (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[infra]` task in this feature: nothing about how the stack boots changes and `.env` gains no
variable.

## Tasks

### Group 1 — schema, derivation and contract (`api`)

Nothing outside this group may start until the field or mutation it consumes exists. The
`## GraphQL Contract Delta` in `spec.md` is frozen (Article VIII): an agent that finds it wrong
stops and files a row under **Blocked**. Tasks that edit the same file are chained rather than
marked `[P]`: `pipeline-status.ts` (T003 → T004), `process-jobs.service.ts` (T005 → T006) and
`downloads.service.ts` (T007 → T008 → T009 → T010). No task here builds `STOPPED`, `encodeJobStop` or any
pause/resume — that is `097`.

- [x] **T001** `[api]` Add `DISCARDED` to `EncodeStatus` in `prisma/schema.prisma` and generate the
      migration with `bin/npm api run prisma:migrate --name encode_status_discarded`. No backfill.
      *Done when:* `git status --short services/api/prisma` shows a modified `schema.prisma` and
      exactly one new migration directory, and `bin/cli api npx --no prisma migrate status` reports
      up to date.
- [x] **T002** `[api] [P]` Add `PROCESS_JOB_NOT_RESUMABLE` (`error.processJob.not_resumable`),
      `PROCESS_JOB_NOT_DISCARDABLE` (`error.processJob.not_discardable`) and `ENCODE_DISCARDED`
      (`error.encode.discarded`) to `src/i18n/error-keys.ts`, with English lines in
      `src/i18n/messages.en.ts`; mention `error.encode.discarded` in the header's list of `api`-owned
      keys the worker reuses.
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean and any existing key/catalog parity
      test in `bin/npm api test` stays green.
- [x] **T003** `[api]` In `src/pipeline-status/pipeline-status.ts`, rewrite `deriveSourceStatus`
      per `api/plan.md` step 3: filter `DISCARDED` out, return `DISCARDED` when every job is
      discarded, check active before job-`ERROR` (REQ-8), compute REQ-7's progress over the
      non-discarded jobs (`COMPLETED` = 100, `ERROR` = 0); widen the return type to
      `PipelineStatus | 'DISCARDED'` at this function only. Make `isRaceWinner` false for an
      all-discarded `SCANNED` source (NFR-1). Extend `pipeline-status.spec.ts` with the cases listed
      in `api/plan.md` § Tests for these two functions. → T001
      *Done when:* `bin/npm api test` is green, and swapping rules 3 and 4 back makes the
      "active + `ERROR` → `ENCODING`" case fail.
- [x] **T004** `[api]` In the same file, extract `jobLastError(job)` out of `deriveResume` (which
      then calls it), and add `jobRetryable`, `projectJobStatus` and the pure
      `cleanupDecision(jobs, hasUnmatchedFiles)` → `{ removeTorrent, deleteDownloadPath }`, counting
      `DISCARDED` as finished. Extend `pipeline-status.spec.ts`: `cleanupDecision` for
      `COMPLETED`+`DISCARDED` (both true), `ACTIVE`+`DISCARDED` (both false), `COMPLETED`+`ERROR`
      (`removeTorrent` true, `deleteDownloadPath` false); `projectJobStatus('WAITING')` → `QUEUED`;
      `isDeliveredSource` true for `COMPLETED`+`DISCARDED`. → T003
      *Done when:* `bin/npm api test` is green and every pre-existing `deriveResume` case still passes
      unchanged.
- [x] **T005** `[api]` Make `ProcessJobsService.encodeCompleted` read `cleanupDecision` instead of
      its inline status sets (`deleteInputFile` stays computed there). Add a
      `process-jobs.service.spec.ts` case: siblings `COMPLETED` + `DISCARDED` with no unmatched files
      return `removeTorrent: true, deleteDownloadPath: true`. → T004
      *Done when:* `bin/npm api test` is green and `grep -n "nonTerminalStatuses"
      services/api/src/process-jobs/process-jobs.service.ts` returns nothing.
- [x] **T006** `[api]` Guard the worker's reports in `process-jobs.service.ts` (REQ-13/14):
      `encodeStarted` as a guarded `updateMany` refusing a `DISCARDED` row with
      `error.encode.discarded`; `encodeProgress` writes only where `status: 'ENCODING'`;
      `encodeFailed` returns without writing on a `DISCARDED` row; `encodeCompleted` unchanged. Do not
      touch `reconcileOrphanedEncodes`. Add the four cases from `api/plan.md` § Tests. → T002 T005
      *Done when:* `bin/npm api test` is green, including "`encodeCompleted` on `DISCARDED` lands
      `COMPLETED`".
- [x] **T007** `[api]` Create `src/downloads/entities/download-job.entity.ts` (`DownloadJob`, the
      ten fields of the contract delta) and add `jobs: [DownloadJob!]!` to `Download`. Widen
      `DownloadsService.jobsBySourceId`'s `select` with the label fields, order episode jobs by
      season/episode number, and build `jobs` in `toDownload` (label `S01E02 · <title>` / film title,
      `projectJobStatus`, `encodeSpeed` only while `ENCODING`, `jobLastError`, `jobRetryable`). Add
      the ordering/label case to `downloads.service.spec.ts`. → T004
      *Done when:* `bin/npm api test` is green and, after a boot, `grep -A12 "^type DownloadJob"
      services/api/src/schema.gql` prints exactly the contract's fields and `Download` carries
      `jobs: [DownloadJob!]!`.
- [x] **T008** `[api]` Add `DownloadsService.encodeJobStart(processJobId, userId)` and its
      `@Mutation` in `downloads.resolver.ts` (REQ-11): job lookup → `error.processJob.not_found`
      (never leak `source.not_found`), retired → `retry_replaced`, race loser → `retry_superseded`,
      not a retryable `ERROR` → `not_resumable`, then `resumeEncodeStage([job])` and
      `recomputeStatus`, returning the parent `Download`. Inside `resumeEncodeStage`/
      `EncodeQueueService`, verify the re-added BullMQ entry is actually waiting and otherwise take
      the existing rollback path (fixes `065`'s Play too). Add the cases from `api/plan.md` § Tests.
      → T002 T007
      *Done when:* `bin/npm api test` is green, including "retry leaves sibling `ERROR` jobs
      `ERROR`" and "an enqueue that does not land rolls back to `ERROR` with the original error
      fields".
- [x] **T009** `[api]` Add `DownloadsService.encodeJobDiscard(processJobId, userId)` and its
      `@Mutation` (REQ-12/16/18, NFR-5), per `api/plan.md` step 8: same three gates, `not_discardable`
      on `COMPLETED`/`DISCARDED`, guarded `updateMany` → `DISCARDED`, `publishCancel` +
      `removeEncode` (log on Redis error), guarded `rm` of the input file inside the downloads root,
      then `cleanupDecision` → `qbittorrent.remove(hash, false)` + `unwindLosingSiblings` and/or
      `deleteResidue`, then `recomputeStatus`. Add the cases from `api/plan.md` § Tests, including a
      path outside the downloads root. → T008
      *Done when:* `bin/npm api test` is green, and the outside-the-root case asserts `rm` was never
      called.
- [x] **T010** `[api]` In `DownloadsService.handleTorrentCompleted`, stop the torrent in the
      client after `addSourceReady` succeeds, inside a `try` that only logs (REQ-1/3). Add two
      `downloads.service.spec.ts` cases: `stop` is called after the enqueue, and a throwing `stop`
      still returns the enqueued outcome. Add one case pinning NFR-2: a live `stoppedUP` reading with
      `completion_on` set maps to `READY` and writes nothing back onto a `SCANNED` source. → T009
      *Done when:* `bin/npm api test` is green.
- [x] **T011** `[api]` Contract check: boot, regenerate `schema.gql`, and diff it against
      `spec.md` § GraphQL Contract Delta. Run `bin/comments api`. → T006 T007 T008 T009 T010
      *Done when:* `git diff services/api/src/schema.gql` shows only `DownloadJob`, `Download.jobs`,
      `encodeJobStart` and `encodeJobDiscard`; `bin/cli api npx --no tsc --noEmit` and
      `bin/comments api` are clean.

### Group 2 — consumers (`worker` ∥ `web`)

Everything here depends on the `api` task that produces what it consumes.

- [x] **T012** `[worker] [P]` Transcribe `ERROR_ENCODE_DISCARDED = 'error.encode.discarded'` into
      `src/i18n/error-keys.ts` (and `messages.en.ts` if `messages.en.spec.ts` requires it), widen
      `encode.job.ts`'s `EncodeCancelledError` arm to also match that `KeyedError` with a
      `discarded, reporting nothing` log line, and add the `encode.job.spec.ts` case. Confirm nothing
      before `encodeStarted` reads the input file; if something does, stop and report. → T006
      *Done when:* `bin/npm worker test` is green (the new case: no `encodeFailed`, no driver call,
      rejects with `UnrecoverableError`), and `bin/cli worker npx --no tsc --noEmit` and
      `bin/comments worker` are clean.
- [x] **T013** `[web] [P]` Add `DownloadJob` and `jobs` to `src/types/downloads.ts`; add `jobs { … }`
      to `DOWNLOAD_FIELDS` and the two mutations plus `startEncodeJobAction`/`discardEncodeJobAction`
      to `src/actions/downloads.ts`, copied from `startDownloadAction`. → T011
      *Done when:* `bin/cli web npx --no tsc --noEmit` is clean and `/downloads` still renders every
      existing row (a typo in `DOWNLOAD_FIELDS` breaks every downloads view at once).
- [x] **T014** `[web] [P]` Copy and badge: `status.discarded` and the `DISCARDED` case in
      `StatusBadge.tsx`; the `downloads.panel` keys (`expand`, `collapse`, `jobsProgress`,
      `retryJobTitle`, `discardJobTitle`, `retryErrorDefault`, `discardErrorDefault`), the
      `downloads.discardModal` namespace and `errors.processJob.not_resumable`/`not_discardable`, in
      both `messages/en.json` and `messages/es.json`. → T011
      *Done when:* `bin/cli web node scripts/check-messages.mjs` reports the two catalogs identical
      and `bin/cli web npx --no tsc --noEmit` is clean.
- [x] **T015** `[web]` Create `src/components/downloads/DownloadJobRow.tsx` (one child `<tr>`:
      label, `StatusBadge`, `DownloadProgressBar` except for `DISCARDED`, `formatEncodeSpeed` while
      `ENCODING`, Retry on a retryable `ERROR`, Discard on `QUEUED`/`ENCODING`/`ERROR`, all gated on
      one `canAct` prop; struck-through `DISCARDED` label; `DownloadErrorLine`; its own `rowError`)
      and `src/components/downloads/DiscardJobModal.tsx` (copied from `DeleteDownloadModal`, REQ-22's
      four points, inline error, `router.refresh()` on success). → T013 T014
      *Done when:* `bin/cli web npx --no tsc --noEmit` is clean and `npx biome check` on the two new
      files reports nothing.
- [x] **T016** `[web]` In `DownloadRow.tsx`, add the chevron (`aria-expanded`, translated label,
      44×44 below `md`) when `download.jobs.length >= 2`, collapsed by default; return a fragment with
      one `DownloadJobRow` per job when expanded; show `jobsProgress` (`COMPLETED` count over
      non-`DISCARDED` count) under the encode bar; verify a `DISCARDED` parent shows only Delete
      without a new branch. Run `bin/comments web`. → T015
      *Done when:* typecheck and `bin/comments web` are clean, and on `/downloads` a scanned
      multi-file source shows a collapsed chevron while a film row shows none.

### Group 3 — verification and docs

- [x] **T017** `[docs]` Add a `095-season-pack-per-file-encode` section to
      `docs/spec/graphql-contract.md`: `DownloadJob` and why its status is a projected `String`
      (`WAITING` folded, `097`'s `STOPPED` → `PAUSED` to come), `DISCARDED` as a source-altitude value
      only, both mutations returning the parent row, and `error.encode.discarded` as api → worker
      only. → T011
- [x] **T018** `[docs]` Update the `CLAUDE.md` files: the root pipeline table's **Download** row
      (a finished torrent is stopped, still removed when the last job finishes), **Detect
      completion** / **Transcode** rows (per-file retry and discard, `DISCARDED`, cleanup a discard
      triggers run by `api`) and **Browse library** row (the chevron and child rows on
      `/downloads` and both detail pages); `services/api/CLAUDE.md` (`downloads/`, `pipeline-status/`'s
      `cleanupDecision`, `process-jobs/` guards); `services/web/CLAUDE.md` (`DownloadJobRow`,
      `DiscardJobModal`, the chevron); `services/worker/CLAUDE.md` (the widened cancellation arm).
      → T012 T016 T017
- [x] **T019** `[docs]` Run the full verification from `plan.md` § Verification — typechecks, both
      test suites, `check-messages.mjs`, `bin/comments` on the three services, the `schema.gql` diff —
      then the thirteen-step live pass, which reaches AC-1 through AC-13. Tick each acceptance
      criterion that passes in `spec.md`, name the blocker for any that cannot be reached, set
      `status: Implemented` on `spec.md`, `plan.md` and the three `<svc>/plan.md`, set this file to
      `status: Done`, and append the measurement entry to `docs/spec/history.md`. Then regenerate
      `097-encode-stop`'s plans (`/plan-feature 097`), which this feature made stale. → T018

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

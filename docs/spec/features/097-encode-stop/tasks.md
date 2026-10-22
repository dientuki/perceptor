---
title: Stop and resume a running encode — Tasks
last_updated: 2026-10-17
status: Done
---

# TASKS: Stop and resume a running encode (`tasks.md`)

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

Nothing outside this group may start until the mutation or refusal it consumes exists. The
`## GraphQL Contract Delta` in `spec.md` is frozen (Article VIII): an agent that finds it wrong
stops and files a row under **Blocked**. Tasks that edit the same file are chained rather than
marked `[P]`: `pipeline-status.ts` (T003 → T004) and `downloads.service.ts`
(T008 → T009 → T010 → T011).

- [x] **T001** `[api]` Add `STOPPED` to `EncodeStatus` in `prisma/schema.prisma` and generate the
      migration with `bin/npm api run prisma:migrate --name encode_status_stopped`. No backfill.
      *Done when:* `git status --short services/api/prisma` shows a modified `schema.prisma` and
      exactly one new migration directory, and `bin/cli api npx --no prisma migrate status` reports
      up to date.
- [x] **T002** `[api] [P]` Add `ENCODE_STOPPED` (`error.encode.stopped`, beside `ENCODE_DISCARDED`
      and in the header's list of `api`-owned keys the worker reuses) and `PROCESS_JOB_NOT_RUNNING`
      (`error.processJob.not_running`) to `src/i18n/error-keys.ts`, with English lines in
      `src/i18n/messages.en.ts` (`Encode was stopped by the user`, `This file is not being encoded`).
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean and any key/catalog parity test in
      `bin/npm api test` stays green.
- [x] **T003** `[api]` In `src/pipeline-status/pipeline-status.ts`: export
      `IN_FLIGHT_ENCODE_STATUSES` (`ACTIVE_ENCODE_STATUSES` + `STOPPED`); add the `deriveSourceStatus`
      rule after 3b and before 3c (some counted job `STOPPED`, none active, none `ERROR` → `PAUSED`);
      make `countedProgress` count `STOPPED` as 0; make `deriveTitleStatus` contribute `PAUSED` for a
      `STOPPED` job; map `STOPPED` → `PAUSED` in `projectJobStatus` and widen its return type.
      Extend `pipeline-status.spec.ts` with these cases from `api/plan.md` § Tests. → T001
      *Done when:* `bin/npm api test` is green, including: `STOPPED` → `PAUSED`; active + `STOPPED`
      → `ENCODING`; `ERROR` + `STOPPED` → `ERROR`; `deriveTitleStatus` with a `SCANNED` source and a
      `STOPPED` job and no file → `PAUSED` (not `MISSING`).
- [x] **T004** `[api]` In the same file: `isRaceWinner` returns false for a `SCANNED` source with
      some `STOPPED` job and none active (REQ-15); `isDeliveredSource` and
      `cleanupDecision.removeTorrent` read `IN_FLIGHT_ENCODE_STATUSES`. Extend the spec. → T003
      *Done when:* `bin/npm api test` is green, including `isRaceWinner` false for `SCANNED` +
      `STOPPED` and true for `SCANNED` + `STOPPED` + `QUEUED`; `isDeliveredSource` false for
      `COMPLETED` + `STOPPED`; `cleanupDecision` with `COMPLETED` + `STOPPED` → both false.
- [x] **T005** `[api] [P]` Replace the `['WAITING', 'QUEUED', 'ENCODING']` literal with
      `IN_FLIGHT_ENCODE_STATUSES` in `src/uploads/uploads.service.ts` (the demotion's job close) and
      `src/media-server/media-server-reconcile.service.ts` (`IN_FLIGHT_GUARD`). Leave `054`'s
      `reconcileOrphanedEncodes` selecting `'ENCODING'` only. → T003
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean and `grep -n "'WAITING', 'QUEUED',
      'ENCODING'"` on both files returns nothing.
- [x] **T006** `[api] [P]` In `src/process-jobs/process-jobs.service.ts`: `encodeStarted`'s guarded
      `updateMany` excludes `DISCARDED` and `STOPPED`, and on 0 rows throws `ENCODE_DISCARDED` or
      `ENCODE_STOPPED` by the row's status; `encodeFailed` returns `true` early for `STOPPED` as for
      `DISCARDED`. Extend `process-jobs.service.spec.ts`: `encodeStarted` on `STOPPED` throws
      `error.encode.stopped` and leaves the row; `encodeFailed` on `STOPPED` writes nothing;
      `encodeCompleted` on `STOPPED` lands `COMPLETED`. → T001, T002
      *Done when:* `bin/npm api test` is green with those three cases.
- [x] **T007** `[api] [P]` In `src/queue/encode-queue.service.ts`, make `removeEncode` return whether
      the `job-<id>` entry is gone afterwards (false when it still exists, e.g. `active` and locked).
      Existing callers keep compiling. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean and `bin/npm api test` is green.
- [x] **T008** `[api]` In `src/downloads/downloads.service.ts`: extract the cancel/withdraw block of
      `encodeJobDiscard` into a private `stopJobs(jobIds, runningId?)` that writes `STOPPED`
      (`progress: 0`, `encodeSpeed: null`, guarded on `ACTIVE`), then — best-effort, logged —
      withdraws every non-running job first and cancels + withdraws the running one last.
      `encodeJobDiscard` reuses the cancel/withdraw part and its write list gains `STOPPED`.
      `demoteDeliveredSources`' job close reads `IN_FLIGHT_ENCODE_STATUSES`. → T004, T007
      *Done when:* `bin/npm api test` is green, existing discard cases unchanged, plus a case that
      discards a `STOPPED` job.
- [x] **T009** `[api]` Widen `resumeEncodeStage` to `ERROR` and `STOPPED` jobs: the guarded write
      matches each job's own status, rollback restores each to the status it came from, and a
      `removeEncode` that reports the entry still present is an enqueue failure raised before
      `addEncode` (rollback + `retry_enqueue_failed`). → T008
      *Done when:* `bin/npm api test` is green, including a case where `removeEncode` returns false
      for a stopped job: it ends `STOPPED`, `addEncode` is not called, and the call rejects with
      `error.download.retry_enqueue_failed`.
- [x] **T010** `[api]` `downloadStop`: when any job is active, `stopJobs` on them, `recomputeStatus`,
      return the row — no `requireTorrent`, no torrent call; otherwise today's path. `downloadStart`:
      keep retired → `ERROR` branch → `hasRaceWinner` refusal, then **new** stopped branch
      (`resumeEncodeStage`, `recomputeStatus`, return, no torrent call), then the torrent path.
      Extend `downloads.service.spec.ts` per `api/plan.md` § Tests. → T009
      *Done when:* `bin/npm api test` is green, including: Stop on an encoding source withdraws
      before it cancels and never calls the torrent client; Stop with Redis throwing still writes
      `STOPPED`; Play on a stopped upload resumes with no `not_a_torrent`; Play on a stopped source
      while a sibling is the race winner rejects `retry_superseded` and writes nothing; Stop/Play on a
      `DOWNLOADING` torrent unchanged.
- [x] **T011** `[api]` Add `encodeJobStop(processJobId: Int!): Download!`: service method
      (`loadOwnedJob`; not `WAITING`/`QUEUED`/`ENCODING` → `PROCESS_JOB_NOT_RUNNING`; else `stopJobs`,
      `recomputeStatus`, `reloadDownload`) and resolver in `src/downloads/downloads.resolver.ts`
      mirroring `encodeJobDiscard`'s. Widen `encodeJobStart` to accept a `STOPPED` job. → T010
      *Done when:* `bin/npm api test` is green (cases: stop a `COMPLETED` job → `not_running`; stop
      one job leaves its siblings untouched; resume a `STOPPED` job), and after a boot
      `git diff -- services/api/src/schema.gql` shows only the `encodeJobStop` mutation.
- [x] **T012** `[api]` Slice verification. → T005, T006, T011
      *Done when:* `bin/npm api test` and `bin/cli api npx --no tsc --noEmit` are clean,
      `bin/comments api` passes, and `grep -rn "'WAITING', 'QUEUED', 'ENCODING'" services/api/src
      --include=*.ts | grep -v -e spec.ts -e pipeline-status.ts` returns nothing.

### Group 2 — consumers (`worker`, `web`)

The worker's refusal exists once T006 lands; `web`'s mutation once T011 lands.

- [x] **T013** `[worker] [P]` Add `ERROR_ENCODE_STOPPED` to `src/i18n/error-keys.ts` (and
      `messages.en.ts` if its spec requires every key to render); widen `encode.job.ts`'s refusal
      condition to both `error.encode.discarded` and `error.encode.stopped`, logging
      `stopped, reporting nothing` for the new one. Add the `encode.job.spec.ts` case. → T006
      *Done when:* `bin/npm worker test`, `bin/cli worker npx --no tsc --noEmit` and
      `bin/comments worker` are clean, and the new case asserts no `encodeFailed`, no driver call and
      an `UnrecoverableError`.
- [x] **T014** `[web] [P]` `src/types/downloads.ts` lists `PAUSED` in `DownloadJob.status`;
      `src/actions/downloads.ts` adds `ENCODE_JOB_STOP_MUTATION` and `stopEncodeJobAction`; both
      catalogs gain `error.processJob.not_running` (`es`: `Este archivo no se está codificando`),
      the child-row pause/resume titles and `pauseErrorDefault`. → T011
      *Done when:* `bin/cli web npx --no tsc --noEmit` and
      `bin/cli web node scripts/check-messages.mjs` are clean.
- [x] **T015** `[web] [P]` `src/components/downloads/DownloadRow.tsx`: `canStop` (owned, not
      retired, not `DISCARDED`, and `ENCODING` or has `infoHash`) replaces `isControllable` for Stop;
      `canStart` also covers `PAUSED` without `infoHash` and is false while `ENCODING`. → T014
      *Done when:* `bin/cli web npx --no tsc --noEmit` and `bin/comments web` are clean; on
      `/downloads` an encoding upload shows Stop and no Play, and an encoding torrent shows Stop only.
- [x] **T016** `[web] [P]` `src/components/downloads/DownloadJobRow.tsx`: Pause on a `QUEUED`/
      `ENCODING` job (`stopEncodeJobAction`); Play on a `PAUSED` job through the existing retry
      handler with a Play icon and resume title; `DISCARDABLE` gains `PAUSED`; `REFRESH_ON_KEYS` gains
      `error.processJob.not_running`. → T014
      *Done when:* `bin/cli web npx --no tsc --noEmit` and `bin/comments web` are clean; an expanded
      pack on `/downloads` shows Pause on the encoding child and Play on a paused one.

### Group 3 — verification and docs

- [x] **T017** `[docs]` Update the root `CLAUDE.md` pipeline table (Transcode and Download rows:
      user Stop/Play of an encode, per source and per job, `STOPPED` read as `PAUSED`, a stopped
      source gives up the race; add `097` to both spec columns) and the `api`/`worker`/`web`
      `CLAUDE.md` sections that describe `095`'s `DISCARDED` seams, so each names `STOPPED` beside
      it. → T012, T013, T015, T016
      *Done when:* `grep -n "097" CLAUDE.md services/*/CLAUDE.md` hits the root table and each
      service file.
- [x] **T018** `[docs]` Manual pass over `spec.md`'s acceptance criteria with the steps in
      `plan.md` § Verification, ticking each box: AC-1/2 (film Stop/Play), AC-3 (upload), AC-4
      (pack Stop counts), AC-5 (queue order), AC-6 (restart), AC-7 (scratch files), AC-8 (Redis down
      and Play inside the kill grace), AC-9 (`acquire_movies` skips), AC-10 (forced dequeue of a
      stopped job), AC-11 (torrent path unchanged), AC-12/13 (per-job pause and resume), AC-14
      (`not_running`), AC-15 (upload replaces a stopped source), AC-16/17/18 (three-release race).
      Append a measurement to `docs/spec/history.md`; run `/pending-acs` for any box left unticked,
      naming the blocker. → T017
      *Done when:* every AC is ticked or listed in `docs/spec/pending-acs.md` with its blocker, and
      `history.md` has the new entry at the top.
- [x] **T019** `[docs]` Set `status: Implemented` on `spec.md`, `plan.md` and every
      `<svc>/plan.md`, and `status: Done` here. → T018
      *Done when:* `grep -n "^status" docs/spec/features/097-encode-stop/**/*.md` shows no `Approved`
      or `Draft`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

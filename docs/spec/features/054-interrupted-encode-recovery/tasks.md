---
title: Interrupted Encode Recovery — Tasks
last_updated: 2026-09-11
status: Done
---

# TASKS: Interrupted Encode Recovery (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[worker]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

The recovery counter is named `recoveryCount` throughout — `spec.md` § Data Model Changes describes
it without naming it, and every *Done when* below queries it by that name.

## Tasks

### Group 1 — foundations

Nothing here depends on anything else in this feature. T003 is a different service and shares no
contract with T001/T002, which is why all three are genuinely parallel (`plan.md` § Order of Work
steps 1 and 2).

- [x] **T001** `[api] [P]` Add `recoveryCount Int @default(0)` to `ProcessJob` in
      `services/api/prisma/schema.prisma` and generate the migration with
      `bin/npm api run prisma:migrate`.
      *Done when:* `git status --short services/api/prisma` shows **both** a modified
      `schema.prisma` and one new migration directory (Article III); `bin/cli api npx prisma migrate status`
      reports no pending migration; and `bin/mysql -e 'select count(*) from process_jobs where recoveryCount <> 0'`
      returns `0`.
- [x] **T002** `[api] [P]` Add `PROCESS_JOB_RECOVERY_EXHAUSTED: 'error.processJob.recovery_exhausted'`
      to `services/api/src/i18n/error-keys.ts` and its English template to
      `services/api/src/i18n/messages.en.ts`. The key belongs to `api`'s `error.processJob.*`
      namespace — do **not** put it under `error.encode.*`, which the worker owns.
      *Done when:* `bin/npm api test -- messages.en` passes both existing assertions (every key has a
      template, no orphaned template).
- [x] **T003** `[worker] [P]` In `services/worker/src/ffmpeg/runner.ts`, run the existing
      `cleanupTemps()` before spawning FFmpeg as well as on the current exit paths, unconditionally
      for every encode (REQ-6). Watch the wrinkle named in `worker/plan.md`: the closure lives inside
      a **synchronous** `new Promise(...)` executor, so sequence the cleanup before the spawn without
      making that executor `async`.
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports only the 2 pre-existing
      `src/metadata/container-tags.spec.ts` errors, `bin/npm worker run build` exits 0, and
      `bin/npm worker test` is unchanged in pass/fail count. (The behaviour itself is proven by AC-5
      in T013 — `runner.ts` has no spec, per `worker/plan.md` § Tests.)

### Group 2 — the reconciliation

`api` builds the whole decision here. Nothing in the worker may consume it before T006 exists.

- [x] **T004** `[api]` Import `QueueModule` in `services/api/src/process-jobs/process-jobs.module.ts`
      and inject `EncodeQueueService` into `ProcessJobsService`. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` is at 0 errors and `bin/npm api test` is green —
      i.e. the module resolves with no dependency cycle.
- [x] **T005** `[api]` Add the reconciliation method to
      `services/api/src/process-jobs/process-jobs.service.ts`, following `api/plan.md` § Steps 4a–4f:
      select the `ENCODING` rows, return `0` early when empty, partition into skip/fail/requeue, and
      for the requeue set increment `recoveryCount`, reset `progress`/`encodeSpeed`, commit, then
      **`removeEncode` before `addEncode`**, then flip to `QUEUED`. Write the test cases named in
      `api/plan.md` § Tests in `process-jobs.service.spec.ts` as part of this task. → T002, T004
      *Done when:* `bin/npm api test` is green and includes passing cases for: the
      `removeEncode`-then-`addEncode` **call order**; a throwing `addEncode` leaving the row
      `WAITING`; a job at the allowance being failed with the exhaustion key rather than requeued;
      REQ-5's three skip cases not consuming the allowance; and an empty orphan set writing nothing
      and returning `0`.
- [x] **T006** `[api]` Add `encodeWorkerStarted` to
      `services/api/src/process-jobs/process-jobs.resolver.ts`: `@AllowService()`,
      `@Mutation(() => Int)`, no arguments, delegating to T005's method — plus a
      `principal.type !== 'service'` rejection raising
      `i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED)`. `@AllowService()` alone is **not**
      the guard; it widens access to service principals, it does not exclude users. → T005
      *Done when:* `bin/cli api cat src/schema.gql | grep encodeWorkerStarted` shows
      `encodeWorkerStarted: Int!`, and `bin/npm api test` includes a passing case proving a `user`
      principal is refused.

### Group 3 — the worker consumes the contract

T007 needs the mutation from Group 2. T008 does not — it touches only this service's own error
classification — so the two are independent of each other.

- [x] **T007** `[worker] [P]` Add `services/worker/src/api/encode-worker-started.ts` (following
      `src/api/track-titles.ts`'s shape) and call it from `main()` in `services/worker/src/index.ts`
      **before either `Worker` is constructed**, wrapped in the existing `deliverReport`. Log the
      returned count. Record the single-worker invariant as a one-line comment at the call site
      (`spec.md` NFR-4). → T006
      *Done when:* `docker compose logs worker` after a `bin/dev` boot shows one line carrying the
      reconciliation count, logged before either "escuchando la cola" line; and stopping `api` then
      starting `worker` shows the retry line from `deliver-report` rather than a crash loop.
- [x] **T008** `[worker] [P]` In `services/worker/src/jobs/encode.job.ts`, rethrow both non-retryable
      classes as BullMQ's `UnrecoverableError` (exported from `bullmq` 6.0.9): an
      `EncodeCancelledError` (REQ-8) and a `KeyedError` (REQ-9). The cancellation conversion happens
      **after** the existing decision not to report — a cancelled encode must still report nothing.
      Add the three cases named in `worker/plan.md` § Tests as part of this task.
      *Done when:* `bin/npm worker test` is green apart from the 2 pre-existing `src/ffmpeg/`
      failures, and includes passing cases for: a cancelled encode being non-retryable **and**
      reporting nothing; a `KeyedError` being non-retryable and still reporting `encodeFailed` with
      its own key; and an unclassified throw staying retryable.

### Group 4 — the retry policy

Last, and only after T008. If this landed first, deleting a source mid-encode would restart the
encode it was meant to stop (`plan.md` § Risks).

- [x] **T009** `[api] [P]` Add `attempts` and a `backoff` to the job options in
      `EncodeQueueService.addEncode` (`services/api/src/queue/encode-queue.service.ts`). Leave
      `jobId` exactly as it is — the `job-<processJobId>` derivation is what lines up with
      `removeEncode` and T005's requeue. NFR-8: one attempt is hours of CPU, so a small count with a
      real backoff. → T008
      *Done when:* `bin/npm api test` is green and `bin/cli api npx --no tsc --noEmit` is at 0 errors.
- [x] **T010** `[worker] [P]` Make the encode worker's `failed` listener in
      `services/worker/src/index.ts` report `encodeFailed` instead of only `console.error`-ing, with
      two guards: never report a cancelled job, and only report a job BullMQ is finally done with
      (attempts exhausted), never one that will be retried. → T008
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports only the 2 pre-existing errors and
      `bin/npm worker run build` exits 0. (Proven end to end by AC-6 in T013 — `index.ts` has no
      spec, per `worker/plan.md` § Tests.)

### Group 5 — verification and docs

- [x] **T011** `[docs] [P]` Add a section to `docs/spec/graphql-contract.md` for
      `encodeWorkerStarted` (`054-interrupted-encode-recovery`): the SDL, the fact that it is the
      **first service-only operation** in the schema and why `@AllowService()` alone does not achieve
      that, and its single error condition. Extend § "The queue payload is a second, parallel
      contract" with the encode queue's new retry policy and the worker-side classification that
      honours it. Bump the document's `spec_version` and `last_updated`.
- [x] **T012** `[docs] [P]` Update the `CLAUDE.md` files: the root pipeline table's **Transcode**
      row (it gains a recovery path — a worker boot reconciles jobs a dead run left in `ENCODING`,
      bounded to one automatic retry) with `054` added to its spec refs; `services/api/CLAUDE.md`
      for the reconciliation and the new service-only mutation; `services/worker/CLAUDE.md` for the
      boot announcement, the pre-encode scratch cleanup, and the non-retryable classification.
- [x] **T013** `[docs]` Walk all nine acceptance criteria in `spec.md` using `plan.md` § Verification
      — **AC-3 before anything destructive**, since a failure there means the mechanism is wrong and
      nothing else is worth testing. Re-measure the suite counts and record them in the root
      `CLAUDE.md` § Current state, confirming the pre-existing failures are unchanged in number and
      identity (AC-9). Tick each AC box, then set `status: Implemented` on `spec.md`, `plan.md`,
      `api/plan.md` and `worker/plan.md`. → T003, T007, T009, T010, T011, T012

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

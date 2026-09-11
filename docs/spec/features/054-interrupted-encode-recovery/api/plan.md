---
title: Interrupted Encode Recovery — api slice
service: api
last_updated: 2026-09-11
status: Implemented
---

# PLAN: Interrupted Encode Recovery — `api` (`api/plan.md`)

## Scope

`api` owns the reconciliation itself and everything it writes: the `ProcessJob` recovery counter and
its migration, the `encodeWorkerStarted` mutation the worker calls at boot, the decision of which
orphaned jobs are requeued and which are failed, and (step 5) the retry policy on the encode queue's
job options.

It does **not** decide when to call the reconciliation — that is the worker's boot, and `api` must
never trigger the sweep from its own lifecycle. `SchedulerService.reconcileOrphanedRuns` is the
shape to copy, not the trigger: an `onModuleInit` sweep here would reset live encodes, which is the
failure `spec.md` § NFR-2 exists to prevent. `api` also removes no files (NFR-5, Article XII) — the
scratch-file cleanup is entirely the worker's.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/prisma/schema.prisma` | Modified | `ProcessJob` gains the recovery counter, `Int @default(0)` |
| `services/api/prisma/migrations/<generated>/` | New | The generated migration for the above |
| `services/api/src/process-jobs/process-jobs.service.ts` | Modified | The reconciliation method |
| `services/api/src/process-jobs/process-jobs.resolver.ts` | Modified | `encodeWorkerStarted`, service-credential-only |
| `services/api/src/process-jobs/process-jobs.module.ts` | Modified | Imports `QueueModule` — the service has no queue access today |
| `services/api/src/i18n/error-keys.ts` | Modified | One key: the exhaustion diagnosis |
| `services/api/src/i18n/messages.en.ts` | Modified | Its English template (enforced by `messages.en.spec.ts`) |
| `services/api/src/queue/encode-queue.service.ts` | Modified | Step 5 only: `attempts`/`backoff` on `addEncode` |
| `services/api/src/process-jobs/process-jobs.service.spec.ts` | Modified | Cases below |

## Existing code to reuse

- **`services/api/src/scheduler/scheduler.service.ts` → `reconcileOrphanedRuns`** — the shape:
  select the orphans, `return` early when the set is empty (NFR-6), write in one pass rather than
  per-row round trips. Copy the structure; do **not** copy the `onModuleInit` trigger.
- **`services/api/src/media-sources/media-sources.service.ts` → `sourceScanned`, the tail after the
  transaction** — the enqueue ordering this slice must reproduce exactly: write/commit the row
  first, then `addEncode`, then flip to `QUEUED` in a single `updateMany`. The comment there spells
  out why (a worker taking a job whose row does not yet exist), and why a failed `add()` must leave
  the row in `WAITING`. Note that this file already treats `WAITING` as "created but never enqueued,
  recoverable" — the reconciliation's intermediate state is the same state, deliberately.
- **`services/api/src/queue/encode-queue.service.ts` → `removeEncode` then `addEncode`** — both
  already exist and both derive `job-<processJobId>`. `removeEncode` never throws and logs when
  there was nothing to remove. **Call it before `addEncode`**: BullMQ will not create a second entry
  under an existing `jobId`, so re-adding without removing first silently does nothing (see
  `../plan.md` § Risks — this is the most likely bug in the feature).
- **`services/api/src/i18n/error-keys.ts` / `messages.en.ts`** — `api` already owns the
  `error.processJob.*` namespace (`PROCESS_JOB_NOT_FOUND`), which is where the exhaustion key
  belongs; `error.encode.*` is the worker's namespace and must not be extended from here. The
  English text is read out of `MESSAGES_EN` directly for `ProcessJob.errorMessage` — `renderMessage`
  in `i18n-error.ts` is private and the exhaustion message needs no interpolation, so do not export
  it or add a second renderer.
- **`services/api/src/process-jobs/process-jobs.resolver.ts`** — every method there is already
  `@AllowService()`; follow the file's existing shape. For the user-rejection, the narrowing idiom is
  `@CurrentUser() principal: AuthPrincipal` plus a `principal.type` check, as in
  `services/api/src/downloads/downloads.resolver.ts`; raise
  `i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED)`, the same key `JwtAuthGuard` raises for
  the mirror-image rejection. **No new error key for this.**
- **`services/api/src/process-jobs/process-jobs.service.ts` → `encodeFailed`** — already knows how to
  write `status: 'ERROR'` plus the error columns and propagate to `Movie`/`Episode`. The exhaustion
  branch must reach the same end state; reuse the propagation rather than writing a second one.

## Steps

1. Add the recovery counter to `ProcessJob` in `schema.prisma` (`Int @default(0)`, not null) and
   generate the migration with `bin/npm api run prisma:migrate`. Both the modified schema and the new
   migration directory must appear in `git status` (Article III).
2. Add `PROCESS_JOB_RECOVERY_EXHAUSTED: 'error.processJob.recovery_exhausted'` to `ERROR_KEYS` and
   its English template to `MESSAGES_EN`. `messages.en.spec.ts` already fails if either half is
   missing — let it.
3. Import `QueueModule` in `process-jobs.module.ts` and inject `EncodeQueueService` into
   `ProcessJobsService`. (`QueueModule` exports it and depends only on `RedisService`, so there is no
   cycle with the modules `ProcessJobsModule` already imports.)
4. Add the reconciliation method to `ProcessJobsService`. In order:
   a. Select every `ProcessJob` with `status: 'ENCODING'`, including enough of
      `sourceFile.mediaSource` to apply REQ-5. Return `0` immediately if the set is empty (NFR-6).
   b. Partition the set three ways: **skip** (REQ-5 — the source row is gone, the source is `ERROR`
      because it lost a race, or the target already holds a completed file from another source);
      **fail** (the recovery allowance is already spent); **requeue** (everything else).
   c. Skipped jobs leave `ENCODING` without being queued — decide their landing status against
      `encodeFailed`'s existing propagation rather than inventing a new one, and do not increment
      the counter for them.
   d. Failed jobs: `status: 'ERROR'`, the exhaustion key and its English message into
      `errorKey`/`errorMessage`, and the same `Movie`/`Episode` propagation `encodeFailed` performs.
      Do **not** increment the counter past the allowance.
   e. Requeued jobs: increment the counter, reset `progress` to `0` and `encodeSpeed` to `null`
      (REQ-3), set `status: 'WAITING'`, and commit. Then, per job, `removeEncode` followed by
      `addEncode`. Then flip the successfully-enqueued set to `QUEUED` in one `updateMany`. A job
      whose `addEncode` throws stays `WAITING` — that is the truth, and the next boot recovers it.
   f. Return the count of rows reconciled.
5. Add `encodeWorkerStarted` to `ProcessJobsResolver`: `@AllowService()`, `@Mutation(() => Int)`, no
   arguments, and a `principal.type !== 'service'` rejection before delegating (NFR-3). The service
   method holds the logic; the resolver only guards and delegates, as the rest of the file does.
6. **Step 5 of `../plan.md` § Order of Work, and only after the worker's REQ-8/REQ-9 have landed**:
   add `attempts` and a `backoff` to the options in `EncodeQueueService.addEncode`. Keep `jobId`
   exactly as it is — the derivation is what makes the requeue path and `removeEncode` line up.
   NFR-8: one attempt is hours of CPU, so a small count with a real backoff, not a generic policy.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

```graphql
type Mutation {
  encodeWorkerStarted: Int!
}
```

- No arguments. Do not add a worker id, hostname or timestamp, however much safer it looks — see
  `../plan.md` § Contract Freeze.
- Returns the number of rows reconciled, non-null. The worker logs it and never branches on it, so
  the value is diagnostic — but it must be the real count, not a constant.
- Reachable **only** with `SERVICE_TOKEN`. A user session must be refused with
  `error.auth.unauthenticated`. `@AllowService()` alone does not do this.
- The recovery counter and the exhaustion key are exposed on **no** GraphQL type. Do not add either
  to `Download` or to any `process-jobs/entities/` type.
- `encodeStarted`, `encodeProgress`, `encodeCompleted`, `encodeFailed`: signatures unchanged.

## Tests

In `services/api/src/process-jobs/process-jobs.service.spec.ts`, which already covers this service's
report paths. Under Article IX, every case below defends against a failure that produces **no error
anywhere**:

- **Requeue withdraws the old queue entry before adding.** The `removeEncode`-then-`addEncode`
  order, asserted on call order, not just on both having been called. Without it BullMQ's duplicate
  `jobId` makes the add a silent no-op and the job sits at `QUEUED` forever — the single most likely
  bug in this feature, and one that looks completely healthy in the database.
- **`QUEUED` is only reached after a successful enqueue.** A throwing `addEncode` must leave the row
  `WAITING`. The opposite — flipping first, enqueueing after — produces a row that claims to be
  queued against a queue that never received it.
- **The allowance is bounded.** A job at the allowance is failed with the exhaustion key rather than
  requeued, and its counter does not grow. An off-by-one here is a reboot loop on a host the encode
  itself is killing.
- **REQ-5's three skip cases** — missing source row, source demoted to `ERROR`, target already
  completed — are not requeued and do not consume the allowance. A resurrected loser overwrites a
  good file with an older release and nothing fails.
- **An empty orphan set writes nothing** (NFR-6) and returns `0`.
- **`encodeWorkerStarted` refuses a user principal.** The whole safety argument for a no-argument,
  trust-the-caller mutation rests on this one check; if it regresses, any signed-in user can reset a
  running encode and nothing logs an error.

`messages.en.spec.ts` already covers the new key/template pair — no new case needed there.

Not owed a test: the migration itself (Article III's `git status` check is the gate) and the
`attempts`/`backoff` option values, which are configuration, not logic — their effect is exercised
manually as AC-6.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
```

Typecheck at 0 errors; the suite green with the new cases; `migrate status` reporting no pending
migration. `git status --short services/api/prisma` must show both a modified `schema.prisma` and one
new migration directory.

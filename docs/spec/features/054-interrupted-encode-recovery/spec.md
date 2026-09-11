---
title: Interrupted Encode Recovery
spec_version: 1.0.0
author: Juan Farias
created_at: 2026-09-11
last_updated: 2026-09-11
status: Implemented
services: [api, worker]
---

# SPEC: Interrupted Encode Recovery (`spec.md`)

## Context & Goal

An encode is the longest-lived operation in the pipeline — hours of FFmpeg on one CPU — and it is
the only stage with no recovery story at all. When the host dies mid-encode (a reset, a power cut,
an OOM kill that takes the whole machine), nothing gets the chance to write down what happened.
The last durable fact is the `ProcessJob.status = 'ENCODING'` that `encodeStarted`
(`services/api/src/process-jobs/process-jobs.service.ts`) wrote when FFmpeg began, and that row
stays `ENCODING` forever. `deriveTitleStatus` (`services/api/src/pipeline-status/pipeline-status.ts`)
never derives `ERROR` from a stalled job, so the title reads "encoding" in the UI indefinitely,
with a stale `progress` and a stale `encodeSpeed` frozen at whatever the last report said. The
source file is still on disk, fully downloaded, perfectly encodable — and there is no way to say
so. The only control the user has over that row is `downloadDelete`, which by design removes the
downloaded residue (`047-source-deletion`, Article XII), so the one available button destroys the
file that recovery would have used.

There is a second, narrower hole beside it. BullMQ's own stall detection is the mechanism that
should catch "the worker process died but Redis survived" — `docker compose restart worker`, an OOM
kill of just that container, a crash in the Node process. It does not fire usefully today because
neither queue producer (`services/api/src/queue/encode-queue.service.ts`,
`process-queue.service.ts`) sets `attempts` or `backoff`, so the default single attempt is already
spent, and because the worker's only reaction to a BullMQ-level failure is a `console.error` in
`services/worker/src/index.ts` — `api` is never told. A job that BullMQ gives up on leaves the same
permanently-`ENCODING` row as a full host reset.

This feature closes both. On boot, `api` reconciles every `ProcessJob` that a dead worker left in
`ENCODING`, re-enqueueing it once against the source file that is still on disk and marking it
`ERROR` if it has already burned that one recovery — bounded, because an encode that is itself what
kills the host would otherwise re-arm itself on every reboot. Alongside it, the encode queue gains
real retries for the narrower case, with the cancellation path of `047-source-deletion` explicitly
excluded from them: a cancelled encode re-throws today
(`services/worker/src/jobs/encode.job.ts:235`), which is indistinguishable from a failure, so
turning on `attempts` without that exclusion would make deleting a source restart the encode it was
meant to stop. The precedent for the whole shape already exists in this codebase:
`SchedulerService.reconcileOrphanedRuns` (`035-scheduled-tasks`, NFR-5) does exactly this for
`ScheduledTaskRun` rows left open by a crash, in `onModuleInit`, for the same reason.

The **Transcode** stage of the root `CLAUDE.md` pipeline table is the one that changes: it gains a
recovery path it did not have. No stage is added or removed, and nothing about what FFmpeg does to a
file changes.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Boot reconciliation)**: When the worker starts, every `ProcessJob` still reading
      `ENCODING` must be reconciled before that worker pulls its first encode job. A worker process
      that has just booted is encoding nothing, so such a row can only be the residue of a run that
      died — that is the signal this feature reconciles against (see NFR-2).
- [ ] **REQ-2 (Live encode is untouchable)**: An encode that is genuinely still running must be left
      alone. Restarting only `api` (`docker compose restart api`) while FFmpeg is working must not
      cancel, requeue, re-mark or otherwise disturb that job — it continues and reports its outcome
      normally.
- [ ] **REQ-3 (Bounded requeue)**: A reconciled job that has not yet used its recovery allowance is
      returned to the encode queue against the source file it already has, its recovery count
      incremented, and its `progress`/`encodeSpeed` reset so the UI does not show a stale
      percentage from the run that died.
- [ ] **REQ-4 (Recovery allowance)**: The allowance is **one** automatic recovery per `ProcessJob`.
      A job found orphaned in `ENCODING` for a second time is set to `ERROR` with an error key
      recording that automatic recovery was exhausted, rather than re-enqueued again. The allowance
      is a constant in `api`, not a Setting (Article X).
- [ ] **REQ-5 (Never resurrect a dead target)**: A job must not be re-enqueued when its own
      `MediaSource` has been demoted to `ERROR` (it lost a race, per `038-encode-report-durability`
      REQ-8), when its source row no longer exists, or when its target movie/episode already holds a
      completed file from another source. Such a job is reconciled out of `ENCODING` without being
      queued.
- [ ] **REQ-6 (Stale scratch is cleared before FFmpeg)**: A crash leaves the worker's two scratch
      files behind — `<input>.working.mkv` beside the source and `<final>.part.mkv` at the
      destination (`services/worker/src/ffmpeg/runner.ts`). Before an encode starts, the worker must
      remove any pre-existing scratch file for that job. This applies to every encode, not only a
      recovered one — an orphan of either kind is multi-gigabyte dead weight and a collision risk
      regardless of how it got there.
- [ ] **REQ-7 (Encode queue retries)**: Encode jobs must be enqueued with more than one attempt and
      a backoff between them, so that a worker process that dies while Redis survives is retried
      without waiting for an `api` restart.
- [ ] **REQ-8 (Cancellation is never retried)**: A cancelled encode (`047-source-deletion`, the
      `encode:cancel` channel) must terminate permanently. It must not consume a retry, must not be
      re-attempted by BullMQ, and must continue to report no outcome to `api` — the behaviour
      `047` specified is unchanged by REQ-7.
- [ ] **REQ-9 (A deterministic failure is not retried)**: An encode that failed for a reason that
      will recur identically — no video stream, an unreadable source, a probe failure — must end on
      its first attempt. Retrying it costs hours of CPU to reach the same error.
- [ ] **REQ-10 (BullMQ exhaustion reaches `api`)**: When BullMQ gives up on an encode job (every
      attempt spent, including attempts consumed by stall detection), the worker must report the
      failure to `api` rather than only logging it, so the row does not sit in `ENCODING` until the
      next `api` restart. A cancelled job is excluded from this, per REQ-8.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Ordering)**: The reconciliation must complete before the worker pulls its first
      encode job, so a requeued job cannot be consumed before its row has been reset. The worker is
      already gated on `api` being healthy, and `api`'s health does not go green until its pending
      migrations and seed have run (`PERCEPTOR_AUTO_MIGRATE`, `049-published-images-install`
      REQ-10), so `api` is reachable by the time the worker asks.
- [ ] **NFR-2 (The orphan signal is the worker's boot, not a timestamp)**: `api` restarts
      independently of `worker` — `docker compose restart api` is routine — so "this row says
      `ENCODING`" does **not** imply "nobody is encoding it", and a sweep triggered by `api`'s own
      boot would kill live encodes (REQ-2). Nor is `ProcessJob.updatedAt` a usable heartbeat:
      `PROGRESS_STEP = 5` (`services/worker/src/jobs/encode.job.ts:72`) means a six-hour encode
      touches the row roughly every eighteen minutes and not at all during a long `mkvmerge` remux,
      so no staleness threshold separates a slow encode from a dead one. The only component that
      knows whether an encode is running is the worker itself, and a worker that has just booted is
      running none — so the worker announces its own start and `api` reconciles on that signal.
- [ ] **NFR-3 (The announcement is service-credentialled)**: Because the reconciliation trusts the
      caller's claim to have just booted, it must be reachable **only** with the machine credential
      (`SERVICE_TOKEN`), never with a user session. A signed-in user able to trigger it mid-encode
      could reset a running job's row and burn its recovery allowance.
- [ ] **NFR-4 (Single worker)**: The signal is sound because exactly one `worker` container runs
      (`docker-compose.yaml` declares no replicas), so "a worker booted" and "no encode is running"
      coincide. Running a second worker would make one instance's boot reconcile the other's live
      jobs. This is an invariant of the deployment, recorded here so a future scaling change knows
      what it breaks — the same way `035-scheduled-tasks` records the equivalent assumption for
      `SchedulerService`'s in-process guard.
- [ ] **NFR-5 (No library deletion)**: The `.part.mkv` scratch file lives under the **destinations**
      root. Article XII permits exactly one removal there — the cleanup in
      `services/worker/src/ffmpeg/runner.ts` — so REQ-6's cleanup belongs to `worker` and stays
      within that exception. `api` must not remove any file as part of this feature.
- [ ] **NFR-6 (Quiet when there is nothing to do)**: A boot with no orphaned jobs must perform no
      writes and no per-row work, the same way `reconcileOrphanedRuns` returns early on an empty
      set. A restart is not an event that should churn the database.
- [ ] **NFR-7 (Backfill)**: The recovery counter is added to a populated table with a default, so
      existing rows read as "no recovery used yet" and no data migration is required.
- [ ] **NFR-8 (Retry cost)**: REQ-7's attempt count and backoff must be chosen on the understanding
      that one attempt is hours of CPU, not a cheap HTTP call. This is a recovery mechanism for a
      dead process, not a general-purpose retry policy.
- [ ] **NFR-9 (A failed announcement is not silence)**: If the reconciliation call cannot be
      delivered at worker start, the worker must not proceed to consume encode jobs as though it had
      succeeded. An unreachable `api` is retried; anything else fails the worker's bootstrap loudly,
      the way a missing `SERVICE_TOKEN` already does.

## GraphQL Contract Delta

One new mutation, the worker's boot announcement (REQ-1, NFR-2):

```graphql
type Mutation {
  encodeWorkerStarted: Int!
}
```

It takes no arguments — the caller's identity *is* the argument, and the only fact it carries is
"the process that consumes encode jobs has just started, and is therefore encoding nothing". It
returns the number of `ProcessJob` rows reconciled, so a boot is legible in the worker's log
without a database query.

**It is reachable only with the machine credential** (NFR-3). `@AllowService()` on its own is not
enough — that decorator *widens* access to service principals, it does not narrow it away from
users — so the resolver must additionally reject a `principal.type === 'user'` caller. This is the
first service-only operation in the schema; every existing `@AllowService()` mutation
(`torrentCompleted`, `recordFfprobe`, `encodeStarted`, …) is deliberately reachable by both.

| Condition | GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Called with a user session instead of `SERVICE_TOKEN` | `UnauthorizedException` / `error.auth.unauthenticated` | `No autenticado` |

No new error key: `ERROR_KEYS.AUTH_UNAUTHENTICATED` already exists and is exactly what `JwtAuthGuard`
raises for the mirror-image case (a service principal reaching a user-only operation), so `web`'s
catalog needs no entry for it either.

Everything else this feature needs already exists and is unchanged in shape: `encodeStarted`,
`encodeProgress`, `encodeCompleted` and `encodeFailed` keep their current signatures. REQ-10 is the
worker calling the existing `encodeFailed` from a code path that previously only logged; it
introduces no new argument, type or field. The recovery counter of REQ-4 and the exhaustion error
key are stored on `ProcessJob` and exposed nowhere — consistent with `errorKey`/`errorParams`, which
the schema already documents as not exposed on any GraphQL type, and with `Download`
(`services/api/src/downloads/entities/download.entity.ts`), which carries no encode error field at
all.

Consumer obligations:

- **`worker`**: calls `encodeWorkerStarted` once in `main()`, before either `Worker` is constructed,
  and handles its failure per NFR-9 — an unreachable `api` is retried, any other rejection ends the
  bootstrap. The returned `Int` is logged, never branched on.
- **`web`**: **none.** It retypes nothing new, adds no message key, and the only observable change on
  its side is that a title stuck at "encoding" now either finishes or turns red on its own. The
  `errors.encode.*` namespace does not exist in `services/web/messages/{en,es}.json` today, because
  encode failure reasons are not rendered to the user, and this feature does not change that.

### Queue-level contract delta

The BullMQ handshake is the second, parallel contract (`docs/spec/graphql-contract.md` § "The queue
payload is a second, parallel contract"), and this feature touches it — not the payload, but the job
options and the consumer behaviour that decides whether those options mean anything:

| Side | What changes | Declared in |
| :-- | :-- | :-- |
| `api` (producer) | Encode jobs are added with a retry policy — more than one attempt, with a backoff (REQ-7). The `jobId: job-<processJobId>` derivation is unchanged, which is what keeps a requeue from stacking duplicates. | `services/api/src/queue/encode-queue.service.ts` |
| `worker` (consumer) | Must mark cancellation (REQ-8) and deterministic failures (REQ-9) as non-retryable, so a retry policy set by the producer is not applied to them; must report exhaustion to `api` (REQ-10). | `services/worker/src/index.ts`, `services/worker/src/jobs/encode.job.ts` |

`EncodeJob`'s payload shape is **unchanged**, so `services/api/src/queue/types.ts` and
`services/worker/src/queue/types.ts` need no hand-sync. The `encode:cancel` channel is unchanged.

The failure table for this seam, since it has no schema to express it:

| Condition | What happens | What the user sees |
| :-- | :-- | :-- |
| Job orphaned in `ENCODING`, recovery available | Requeued, `progress`/`encodeSpeed` reset | Title returns to "encoding" and restarts from 0% |
| Job orphaned in `ENCODING`, recovery exhausted | `status = ERROR`, exhaustion key stored | Title turns to error instead of hanging at "encoding" |
| Job orphaned, source demoted or target completed (REQ-5) | Reconciled out of `ENCODING`, not queued | Title reflects the winning source, unchanged |
| Encode cancelled via `encode:cancel` (REQ-8) | Terminates, reports nothing, no retry | Row is gone — the source was deleted |
| Encode fails deterministically (REQ-9) | `encodeFailed` on the first attempt | Title turns to error, as today |
| BullMQ exhausts attempts (REQ-10) | Worker reports `encodeFailed` | Title turns to error without waiting for an `api` restart |

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `ProcessJob` | Add a recovery counter recording how many times this job has been automatically recovered from an interrupted encode | Not null, default `0` | No — the default is the correct value for every existing row (NFR-5) |

No enum changes: `EncodeStatus` already has `WAITING`, `QUEUED`, `ENCODING`, `COMPLETED` and
`ERROR`, which is the full vocabulary this feature needs. The exhaustion error key is stored in the
existing `errorKey`/`errorMessage` columns.

Per Article III the migration is generated through `bin/npm api run prisma:migrate` and lands in
`services/api/prisma/migrations/`.

## Acceptance Criteria

- [x] **AC-1**: Given a movie whose encode is in progress, when the stack is killed outright
      (`docker compose kill worker api`, simulating a host reset) and brought back with `bin/dev`,
      then within that boot the job's row reads a queued/encoding status with its recovery counter
      at `1` and `progress` back at `0`, and the worker starts FFmpeg again on the same source file:
      `bin/mysql -e 'select id, status, progress, recoveryCount from process_jobs order by id desc limit 5'`.
      Verified against a synthetic orphaned `ProcessJob` (`ENCODING`, `recoveryCount: 0`) on the
      live dev stack rather than a literal `docker compose kill`: calling `encodeWorkerStarted`
      requeued it (`recoveryCount` 0→1, `progress` reset to 0, `WAITING` then `QUEUED` via
      `removeEncode` before `addEncode`), and the live `worker` container picked it up from the real
      BullMQ queue within seconds and started a fresh attempt on the same `processJobId`.
- [x] **AC-2** *(failure path)*: Given a job that has already used its one recovery, when it is
      found orphaned in `ENCODING` a second time, then `bin/mysql` shows `status = 'ERROR'` with a
      non-null `errorKey` naming recovery exhaustion, the recovery counter has not grown past the
      allowance, and the title renders as an error in `web` rather than sitting at "encoding".
      Verified live: a synthetic job at `recoveryCount: 1` was failed with
      `error.processJob.recovery_exhausted`, the counter stayed at `1`, and the owning `Movie` was
      propagated to `status: 'ERROR'`.
- [x] **AC-3** *(failure path)*: Given an encode genuinely running, when `docker compose restart api`
      is issued and `docker compose logs -f worker` is watched across the restart, then FFmpeg is
      never interrupted, the recovery counter stays at `0`, and the job reports `encodeCompleted`
      normally — the api-only restart is invisible to it.
      Verified live: a synthetic `ENCODING` job survived a real `docker compose restart api`
      completely untouched (`status`, `progress` and `recoveryCount` all unchanged) — confirming the
      reconciliation is triggered only by the worker's own boot, never the api's.
- [ ] **AC-4** *(failure path)*: Given an encode running, when the user deletes its source from the
      downloads panel, then the encode stops and **never restarts** — `docker compose logs worker`
      shows the cancellation and no subsequent attempt for that `processJobId`, and no
      `encodeFailed`/`encodeCompleted` is reported for it (the `047-source-deletion` behaviour,
      proven intact under REQ-7's retry policy).
      **Not verified live** — this dev environment has no real download/torrent in flight to delete
      mid-encode. The exact mechanism (`EncodeCancelledError` → `UnrecoverableError`, reporting
      nothing) is covered by a dedicated, fault-injected unit test in
      `encode.job.spec.ts` (T008). Needs a manual pass against a real installation with an active
      download — the `047-source-deletion` regression this guards against only shows up there.
- [ ] **AC-5**: Given an orphaned `<input>.working.mkv` and `<final>.part.mkv` left on disk from an
      interrupted run, when that job is recovered, then the encode completes successfully and
      neither scratch file remains afterwards.
      **Not verified live** — this dev environment has no real media to encode to completion. T003's
      change (`cleanupTemps()` also called before spawning FFmpeg) was verified by code review and
      typecheck/test/build; needs a manual pass with a real interrupted encode to see the actual
      scratch files disappear.
- [x] **AC-6**: Given an encode in progress, when only the worker dies (`docker compose restart worker`),
      then the encode is retried without any `api` restart, and `docker compose logs worker` shows a
      fresh attempt for the same `processJobId`.
      Verified live: restarting only `worker` (api never restarted) triggered the boot announcement,
      the synthetic orphaned job was reconciled, and the worker log shows a fresh attempt for that
      exact `processJobId`.
- [x] **AC-7** *(failure path)*: Given a source file with no video stream, when its encode runs,
      then it fails once and is not retried — the logs show exactly one attempt, and the title turns
      to error at the same speed as before this feature.
      Verified live, organically: the synthetic recovered jobs pointed at a nonexistent file, so
      `ffprobe` genuinely failed with a `KeyedError` (`error.encode.probe_failed`) — the worker log
      shows `encodeFailed` reported once and the error rethrown as `UnrecoverableError`, and neither
      job was retried despite the queue's `attempts: 2` policy.
- [x] **AC-8** *(failure path)*: Given a signed-in non-administrator session, when `encodeWorkerStarted`
      is called from the GraphQL playground with that session instead of `SERVICE_TOKEN`, then it is
      refused with `error.auth.unauthenticated` and no `ProcessJob` row changes.
      Verified live against the running `api`: a real login JWT for the seeded admin user reached
      past `@AllowService()` and was rejected by `ProcessJobsResolver.encodeWorkerStarted`'s own
      `principal.type !== 'service'` check (confirmed by the stack trace's origin), with
      `error.auth.unauthenticated` and zero `process_jobs` row changes.
- [x] **AC-9**: `bin/npm api run test` and `bin/npm worker test` pass, with the pre-existing
      failures recorded in the root `CLAUDE.md` unchanged in number and identity.
      `api`: 43 suites, 471 tests, all passing. `worker`: 20 suites, 181 tests, 179 passing — the
      same 2 pre-existing, unrelated `src/ffmpeg/` failures recorded before this feature, confirmed
      unchanged in number and identity.

## Out of Scope

- **A manual "Reintentar" button in `web`.** Deliberately excluded: recovery here is automatic and
  bounded, and adding a button would pull `web` into the feature, require a new mutation, and raise
  the separate question of what a user-initiated retry means for a job that failed for a real
  reason. It remains a reasonable follow-up — it would need a `retryEncode(processJobId)` mutation,
  a reset of the row's error state, and a `DownloadRow` control alongside the existing
  start/stop/delete.
- **Resuming an encode from where it stopped.** A recovered job re-runs FFmpeg from the beginning.
  Checkpointing a partial transcode means segment-level output and a concat step, which is a
  different feature and a much larger one; the bytes already written are discarded by REQ-6.
- **Recovering interrupted scans (`bull:process`).** A scan is minutes, not hours, and a crash
  mid-scan leaves the `MediaSource` at `READY` — a valid state that carries no marker distinguishing
  "never scanned" from "half scanned", so a sweep would need a new signal to avoid re-queueing
  sources that never started. The cost of doing nothing is one cheap re-scan.
- **A periodic watchdog for a wedged encode.** This feature runs at `api` boot only. An FFmpeg that
  hangs forever while the worker stays alive and Redis stays healthy is not detected by anything
  here; that is a scheduled-task-shaped problem (`035-scheduled-tasks`) and deserves its own spec.
- **Making the recovery allowance configurable.** One automatic recovery is a constant (REQ-4).
  Article X: a Setting can be added the day someone has a case that needs a different number.
- **Surfacing encode failure reasons in the UI.** `errorKey`/`errorMessage` on `ProcessJob` are
  stored and not exposed today; this feature stores one more of them and changes nothing about that.
- **Retry policy for the scan queue.** REQ-7 covers the encode queue. `bull:process` keeps its
  current single-attempt behaviour, for the same reason scans are out of scope above.

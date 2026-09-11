---
title: Interrupted Encode Recovery — Implementation Plan
spec_version: 1.0.0
last_updated: 2026-09-11
status: Implemented
---

# PLAN: Interrupted Encode Recovery (`plan.md`)

## Approach

The feature has one load-bearing decision, and `spec.md` § NFR-2 records how it was resolved: the
signal that an encode is orphaned is **the worker's own boot**, not a timestamp and not `api`'s boot.

The tempting design — `api` sweeps every `ENCODING` row in `onModuleInit`, the way
`SchedulerService.reconcileOrphanedRuns` (`services/api/src/scheduler/scheduler.service.ts`) closes
orphaned `ScheduledTaskRun`s — is wrong here, and wrong in the silent direction. `api` restarts
independently of `worker`; `docker compose restart api` during a six-hour encode is routine, and an
`api`-boot sweep would reset a job FFmpeg is actively working on. `ProcessJob.updatedAt` does not
rescue it either: `PROGRESS_STEP = 5` in `services/worker/src/jobs/encode.job.ts` means a long
encode touches the row about every eighteen minutes and not at all across a long `mkvmerge` remux,
so there is no threshold that separates "slow" from "dead". The worker, by contrast, knows the
answer exactly and for free: a process that has just started is encoding nothing. So the worker
announces its start through a new `encodeWorkerStarted` mutation and `api` reconciles on that.

`reconcileOrphanedRuns` remains the **shape** to copy even though its trigger is not: read the
orphans, return early if there are none (NFR-6), write them in one pass. The reconciliation itself
reuses what `sourceScanned` already established in
`services/api/src/media-sources/media-sources.service.ts` — enqueue **after** the row write is
committed, and flip to `QUEUED` only once `addEncode` has actually returned, so a failed enqueue
leaves the row in `WAITING`, which is the truth and which the next boot recovers. That ordering is
not incidental; it is the reason a lost enqueue is self-healing today, and the requeue path must not
invent a different one. The queue entry itself is withdrawn before it is re-added, through the
existing `EncodeQueueService.removeEncode`: `addEncode` derives `jobId: job-<processJobId>`, and
BullMQ will not create a second entry under an id that still exists, so re-adding without removing
first is a silent no-op — the row would read `QUEUED` and nothing would ever run it.

On the worker side the scratch-file cleanup of REQ-6 needs no new code either: `ffmpeg/runner.ts`
already owns `cleanupTemps()`, which removes both `<input>.working.mkv` and `<final>.part.mkv`, and
already holds the Article XII exception that lets it delete under the destinations root. The change
is to call it before the encode as well as after it, rather than to write a second deletion path —
and certainly not to give `api` one, which would violate Article XII outright (NFR-5).

For the retry cluster (REQ-7 to REQ-10), the classification already exists in the type system and
only has to be honoured: `EncodeCancelledError` (`services/worker/src/encode/cancellation.ts`) is
deliberately **not** a `KeyedError`, precisely so cancellation can be recognised and rethrown
unreported, and `KeyedError` marks a failure that already has a diagnosis. Cancellation is
non-retryable (REQ-8), a `KeyedError` is non-retryable (REQ-9, it will recur identically), and only
an unclassified throw is worth a second attempt.

**One tension this plan does not hide.** With the worker-boot reconciliation in place, REQ-7's
attempts cover a much narrower residue than they would have on their own: any death that takes the
worker process down also restarts the container, which runs the announcement, which recovers the
job. What REQ-7 still buys is the case where BullMQ's stall detection fires while the container
lives, and what its sibling requirements buy is larger — REQ-8 and REQ-9 are not enhancements but
**guards against a regression that REQ-7 itself introduces**, since a cancelled encode re-throws
today (`services/worker/src/jobs/encode.job.ts:235`) and is indistinguishable from a failure. That
is why the order of work below puts the retry policy last and behind its own guards: if REQ-7 landed
alone, deleting a source mid-encode would restart the encode it was meant to stop.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration (`ProcessJob` recovery counter) and the new `encodeWorkerStarted` mutation. The worker cannot call a mutation the schema does not have, and cannot be tested against one that does not exist. |
| 2 | `worker` — REQ-6 | The scratch-file cleanup is independent of everything else: it touches only `ffmpeg/runner.ts` and is correct with or without the rest. It can run **in parallel with step 1**. |
| 3 | `worker` — REQ-1/NFR-9 | The boot announcement. Requires step 1's mutation to exist. |
| 4 | `worker` — REQ-8/REQ-9 | Mark cancellation and diagnosed failures non-retryable. Must land **before** step 5, not after. |
| 5 | `worker` + `api` — REQ-7/REQ-10 | The retry policy itself (`api` sets the job options, `worker` reports exhaustion). Last, because step 4 is what keeps it from regressing `047-source-deletion`. |

Steps 1 and 2 are the only genuinely parallel pair. Steps 3, 4 and 5 are strictly ordered: 3 depends
on the contract from 1, and 5 depends on the classification from 4. Note that step 5 splits across
both services — `api` adds `attempts`/`backoff` in `EncodeQueueService.addEncode` while `worker`
adds the exhaustion report — and those two halves are individually safe in either order, because a
retry policy with nothing honouring it is inert and an exhaustion report that never fires is dead
code, but both are unsafe before step 4.

## Contract Freeze

`spec.md` § GraphQL Contract Delta is frozen as of `status: Approved`. It was amended once, during
this planning pass and before the freeze, when NFR-2's mechanism resolved to a worker-driven
announcement: the section previously read "None — this feature adds no GraphQL surface." That
amendment is the last one. Three things an implementer will be tempted to change and must not:

- **`encodeWorkerStarted` takes no arguments.** A worker id, a hostname, a timestamp or a list of
  "jobs I am not running" all look like they would make the mutation safer. They would make it
  *look* safer while adding a second thing to keep in sync across a boundary with no codegen. The
  fact the mutation carries is "the encode consumer just started"; the caller's credential is the
  proof, and NFR-4 records the single-worker invariant that makes it sufficient.
- **`@AllowService()` alone is not the guard.** It widens access to service principals; it does not
  exclude users. The resolver must also reject `principal.type === 'user'`. An implementer reading
  `torrentCompleted` or `recordFfprobe` will see `@AllowService()` used alone and copy it — those
  operations are deliberately reachable by both, this one is not (NFR-3).
- **The recovery counter is not exposed on any GraphQL type**, and neither is the exhaustion error
  key. `Download` (`services/api/src/downloads/entities/download.entity.ts`) carries no encode error
  field today; adding one to "make the UI better" is a different feature, listed under
  `spec.md` § Out of Scope.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, and re-brief both
services. Never patch it from inside one slice (Article VIII).

## Migrations

1. One migration adding the recovery counter to `ProcessJob`, generated through
   `bin/npm api run prisma:migrate` (Article III — a modified `schema.prisma` **and** a new
   directory under `services/api/prisma/migrations/`, never one without the other).
2. Backfill: **none required.** The column is `Int @default(0)` and not null; every existing row
   takes `0`, which is the correct value — no job in a pre-feature database has ever been
   automatically recovered (NFR-7). Verified by `bin/mysql -e 'select count(*) from process_jobs
   where recoveryCount <> 0'` returning `0` immediately after the migration.

Reversibility: dropping the column is safe in isolation — no other table references it — but a
rollback that keeps the worker's `encodeWorkerStarted` call in place would leave the worker's
bootstrap failing against an `api` whose schema no longer has the mutation, per NFR-9. Roll both
services back together or neither.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A second `worker` replica is ever run | One instance's boot reconciles the other's **live** encodes: rows reset to `QUEUED`, recovery allowance burned, and the surviving FFmpeg's eventual `encodeCompleted` racing a second encode of the same job. No error anywhere. | The invariant is written into `spec.md` NFR-4 and into `worker`'s slice plan, next to the call site. It is the same class of assumption `035-scheduled-tasks` records for `SchedulerService`'s in-process guard. |
| `addEncode` without `removeEncode` first | BullMQ refuses a duplicate `jobId: job-<id>`, the add is a silent no-op, the row is flipped to `QUEUED` anyway — and that job never runs again, looking queued forever. **This is the most likely bug in the feature.** | The requeue path must call `removeEncode` before `addEncode`; named explicitly in `api/plan.md` § Steps and owed a test under Article IX. |
| Enqueue before the row write commits | The worker picks up the job and queries a row that still says `ENCODING` with a stale `progress`, re-reporting against a state the sweep was in the middle of changing. | Reuse `sourceScanned`'s established ordering: commit the row write, then `addEncode`, then flip to `QUEUED`. A failed enqueue leaves `WAITING`, which the next boot recovers. |
| REQ-7 landing before REQ-8 | Deleting a source mid-encode restarts the encode instead of stopping it — `047-source-deletion` silently regresses, and the user sees a download they deleted still burning CPU. | Order of Work makes step 4 a hard predecessor of step 5. AC-4 exercises it. |
| Recovery allowance consumed by a cancellation or a diagnosed failure | A job that was cancelled or failed cleanly comes back later and finds its one recovery already spent, so a genuine crash gets no recovery. | The counter is incremented **only** on the reconciliation path (REQ-3), never in `encodeFailed` and never on the cancellation path. Stated in `api/plan.md`. |
| The announcement silently failing at worker boot | The worker starts consuming encode jobs having reconciled nothing; orphans stay `ENCODING` forever and the feature looks implemented while doing nothing. | NFR-9: retry an unreachable `api` through the existing `deliverReport`, fail the bootstrap on anything else. The returned count is logged, which is what makes a working boot visible. |
| `cleanupTemps()` called before the encode deleting a *live* file | If the scratch path for job A ever collided with a real input or output, an unconditional pre-encode delete would remove something that matters. | The paths are derived from the job's own input and output (`<input>.working.mkv`, `<final>.part.mkv`) and are the same two the runner already deletes on every exit path; no new path is computed. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/npm worker run build
```

Then the manual pass, which is where the acceptance criteria actually live — the failure modes here
are timing-shaped and no unit test reaches them:

1. Start an encode on a film (Tenet is the incident's own case). Confirm `docker compose logs -f worker`
   shows FFmpeg running and `bin/mysql -e 'select id,status,progress,recoveryCount from process_jobs order by id desc limit 3'`
   shows `ENCODING` with a climbing `progress`.
2. **AC-3 first, before anything destructive**: `docker compose restart api`. The encode must keep
   running and `recoveryCount` must stay `0`. If this fails, the mechanism is wrong and nothing else
   is worth testing.
3. **AC-1**: `docker compose kill worker api`, then `bin/dev -d`. Watch the worker log for the
   reconciliation count, then for a fresh FFmpeg on the same job; the row must read `recoveryCount`
   `1` and `progress` `0`.
4. **AC-2**: repeat the kill. The row must go to `ERROR` with a non-null `errorKey`, and the film must
   render red in `web` rather than sitting at "encoding".
5. **AC-4**: start a fresh encode, delete its source from the downloads panel, and watch the worker
   log across the next minute — the cancellation, and **no** subsequent attempt for that
   `processJobId`.
6. **AC-5**: before a recovered encode starts, confirm the orphaned `.working.mkv` / `.part.mkv` from
   the killed run are on disk; after it completes, confirm both are gone.
7. **AC-6**: `docker compose restart worker` mid-encode, with `api` left alone — a fresh attempt on
   the same job, with no `api` restart.
8. **AC-8**: call `encodeWorkerStarted` from the playground with a normal user session; expect
   `error.auth.unauthenticated` and no row change.

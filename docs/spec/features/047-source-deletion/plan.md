---
title: Source deletion — torrent, uploaded file and queued work — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-05
status: Approved
---

# PLAN: Source deletion — torrent, uploaded file and queued work (`plan.md`)

## Approach

`downloadDelete` stays exactly where it is — `DownloadsService` in `services/api/src/downloads/` —
and grows from a two-step operation (tell qBittorrent, delete the row) into the orchestrator of the
whole unwind. Nothing new is created to hold it: the mutation, the resolver, the ownership lookup
(`findOwnedSource`) and the torrent-client wrapper (`callTorrentClient`, which already turns any
rejection into `TORRENT_CLIENT_REJECTED` before a write happens) are all reused unchanged. The only
thing removed from that path is the `requireTorrent` call, which is what refuses an upload today;
it stays on `downloadStart`/`downloadStop`.

Three capabilities the api does not have yet get added to modules that already own the concern
rather than to new ones. **Withdrawing queued work** goes onto the two existing queue wrappers —
`ProcessQueueService.removeSourceReady` and `EncodeQueueService.removeEncode`, each the mirror of
the `add*` method beside it, using the same derived job ids (`media-source-<id>`, `job-<id>`) so
the two halves cannot drift. **Cancelling a running encode** is published from `EncodeQueueService`
too (`publishCancel`), through the existing `RedisService` (`src/redis/redis.service.ts`, ioredis)
rather than BullMQ's own connection — BullMQ's connection is deliberately plain-options and
blocking, and the comment in `src/queue/connection.ts` says why. A separate publisher class was
considered and rejected: it would be one provider and one file to express one `PUBLISH`, next to
the service that already owns everything else about the encode queue. **Containment** goes onto
`MediaRootsService`, whose own header comment already claims to be the single owner of "is this
path inside a declared root?" — it gains `isInsideRoot(rootId, absolutePath)`, built on the same
`realpath`-of-the-deepest-existing-ancestor check `resolveFromRoot` uses, because the `..` string
guard alone does not stop a symlinked segment. `containerToHostPath` looks like it would answer
this question and must not be used for it: it also returns `null` whenever `hostPath` is relative,
which is the `.env.example` default, so every dev install would silently refuse to delete anything.

On the worker side the cancellation lands as an `AbortSignal` threaded through the existing driver
seam, not as a new side channel into `ffmpeg/runner.ts`. `src/index.ts` opens one ioredis
subscriber on `encode:cancel`; a new `src/encode/cancellation.ts` holds the
`processJobId -> AbortController` registry; `handleEncode` registers on entry and releases in a
`finally`; and the signal is passed to `EncodeFn` as a **required** parameter, exactly the way
`onProbe` was added by `023-ffprobe-log` and for the same stated reason — an optional parameter a
call site forgets compiles clean and cancels nothing, forever, with no error anywhere. `runner.ts`
already keeps `activeChild` pointing at whichever of FFmpeg/mkvmerge is running and already has
`cleanupTemps()` removing both `<input>.working.mkv` and `<final>.part.mkv` on every rejection, so
abort wiring reduces to one listener that kills `activeChild` and one rejection with a new
`EncodeCancelledError`. REQ-5 is then satisfied by code that already exists, which is the reason
for choosing this seam over killing the process from outside.

The one genuinely new decision is **who deletes from disk**. The worker owns every filesystem
deletion today (`jobs/cleanup-source.ts`, `013-season-pack-processing`), but that path only exists
because a *successful encode* hands it a `CleanupInput` derived from a row that still exists. A
deleted source has no row for the worker to resolve and no job to carry the instruction, so
enqueuing a cleanup job would mean inventing a payload that carries absolute container paths purely
to route work back to a service that would then have to be told everything. The api does the
deletion itself: it already writes to the downloads root (`UploadsService.moveUploadedFile` does
`mkdir`/`rename` there), it owns `MediaRootsService`, and it is the only service that knows the
deletion happened. The cost is accepted duplication — `rm -rf` for a torrent folder, `rm` +
`rmdir(dirname)` for an upload's `imports/<uploadId>` — mirroring `cleanup-source.ts` across a
service boundary that has no shared package, the same accepted duplication as
`services/*/src/queue/types.ts`.

Title status (REQ-12) reuses `deriveTitleStatus` from `src/pipeline-status/pipeline-status.ts`
rather than growing a second ladder: the recompute calls it with `status: 'MISSING'` as the floor
instead of the stored column, which turns a function that can only ever climb into a genuine
recompute, then collapses the eight-value result back to the five-value `MediaStatus` through one
new pure function beside it.

## Order of Work

The GraphQL SDL does not change, so nothing here is blocked waiting for a schema. What *is* frozen
before anyone starts is the `encode:cancel` channel in `../spec.md`, and that is what lets `api`
and `worker` run genuinely in parallel instead of diverging.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the publisher, the queue withdrawal, the deletion on disk and the status write. Declares the channel constants in `src/queue/types.ts`, the source of truth the worker's copy transcribes. |
| 1 (parallel) | `worker` | Only consumes the channel, whose name and payload are frozen in `../spec.md`. It needs nothing new from `api` at compile time, so it does not wait for step 1 to land. |
| 2 (parallel) | `web` | No schema change to wait for — `downloadDelete` keeps its signature. It can start with the other two; it is listed second because AC-1/AC-7 can only be *verified* once `api` is done. |
| 3 | `docs` | `docs/spec/graphql-contract.md` (the error-set change and the cancellation channel), the root `CLAUDE.md` pipeline table, `services/api/CLAUDE.md` and `services/worker/CLAUDE.md`. After all three slices land, so the docs describe what shipped. |

The three service slices are parallel-safe. The end-to-end verification is not: AC-5, AC-8 and
AC-11 exercise `api` and `worker` together and can only run once both are in.

## Contract Freeze

The `## GraphQL Contract Delta` in `../spec.md` is frozen as of `status: Approved`. It covers two
contracts, not one: the GraphQL surface *and* the `encode:cancel` Redis channel, which is declared
there for exactly the reason the BullMQ payload is (`docs/spec/graphql-contract.md` § "The queue
payload is a second, parallel contract") — nothing across it compiles.

Things an implementer will want to change and must not:

- **The channel name and payload — `encode:cancel`, `{"processJobId": <Int>}`.** Both
  `services/api/src/queue/types.ts` and `services/worker/src/queue/types.ts` declare them, by hand,
  with no compiler between. A "tidier" name on one side, or folding `mediaSourceId` into the
  message because the api happens to have it, produces a cancellation that is published and never
  received — FFmpeg keeps running and nothing anywhere reports a problem.
- **There is no ack channel.** The worker sends nothing back and the api does not wait (NFR-1). An
  implementer on the `api` side will be tempted to wait for confirmation before deleting the
  folder; do not. On Linux, removing a file an FFmpeg process still holds open unlinks the inode
  and the process keeps writing to it until it dies, which the cancellation guarantees moments
  later. Waiting would add a timeout, a failure mode and a second error path to buy nothing.
- **`downloadDelete` keeps `Boolean!`.** It does not become a result object reporting what it
  removed, and it does not gain a `deleteFiles` argument. `downloadRemove` — the `@AllowService()`
  sibling in `process-jobs.resolver.ts` — keeps its own separate defaults; the two are still never
  implemented in terms of each other (`022-download-status-tags`).
- **`error.download.not_a_torrent` is not deleted from the catalog.** It stops being raised by
  `downloadDelete` and stays on `downloadStart`/`downloadStop`, which remain torrent-only.
- **No `CANCELLED` enum member** anywhere (NFR-3). A cancelled job is a deleted job.

If any of this turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief all three
services. Never patch it from inside one slice (Constitution, Article VIII).

## Migrations

**None.** No model, field or enum changes. Every row the feature removes goes through relations
that already cascade: `SourceFile.mediaSourceId` and `ProcessJob.sourceFileId` are both
`onDelete: Cascade`, so the single `mediaSource.delete` removes the source's `SourceFile` rows and
their `ProcessJob` rows with it.

Reversibility: nothing to roll back. The feature is behaviour on an existing surface.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The channel constant drifts between `api`'s and `worker`'s `queue/types.ts` | A cancellation is published to a channel nobody subscribes to. FFmpeg runs to completion on a deleted source, reports `encodeCompleted`, gets rejected for a missing `ProcessJob`, and the only trace is one worker log line. No error reaches the user. | Frozen literally in `../spec.md` § the cancellation channel; both slices are briefed with the same text; AC-5 is the only proof it works and is not optional. |
| Rows deleted before their queue entries are withdrawn | The worker pulls a job whose row is gone, `processJob` answers null, the job fails with a message nobody reads. Harmless but invisible, and it hides a real ordering bug if one is introduced later. | The order is fixed in `api/plan.md` step 5: torrent client → cancel → withdraw → disk → row → status. |
| `Queue.remove()` returns `0` for the entry that is currently **active** | An implementer reads `0` as "withdrawal failed" and either throws (failing a delete that actually worked) or retries. | Documented as expected: an active entry is handled by the cancellation, not the withdrawal. The return value is logged, never treated as failure. |
| `isInsideRoot` says `true` for a path that escapes the root through a symlinked segment | The api recursively deletes a directory outside the downloads root. Destructive, and only visible after the fact. | `isInsideRoot` reuses `resolveFromRoot`'s `realpath`-of-deepest-existing-ancestor check, and is tested against a real `mkdtemp` with real symlinks, matching the standard `media-roots.service.spec.ts` already sets (Constitution, Article IX). |
| `isInsideRoot` says `false` for everything (root unmounted, empty path, relative `hostPath`) | The opposite silent failure: every delete leaves its folder on disk forever and the downloads root fills up, with one log line per delete and no user-visible symptom. | Same spec file covers the refusal cases explicitly; AC-1 asserts the folder is actually gone, which is what catches a blanket refusal. |
| A cancelled encode reports `encodeFailed` on its way out | A source the user deliberately deleted leaves an `ERROR` behind — on a `ProcessJob` row that is usually already gone, so `deliverReport` gets a real rejection and the *encode job* fails noisily for the wrong reason. Worse, if the delete raced and the row still exists, the title reads `ERROR` and the user cannot tell why. | `EncodeCancelledError` is checked first in `handleEncode`'s `catch` and rethrown without any report (REQ-6), pinned by a test in `encode.job.spec.ts`. |
| The status recompute walks a finished title back to `MISSING` | A movie whose file is already in the library reads as never requested, and the user re-downloads something they already have. Nothing errors. | The recompute short-circuits on `filePath != null` → `COMPLETED`, never derived downward. Covered in `pipeline-status.spec.ts` and by AC-12. |
| The eight-value `PipelineStatus` is written into a five-value `MediaStatus` column | `QUEUED`/`PAUSED`/`DOWNLOADED` are not valid `MediaStatus` members; Prisma rejects the write, or a cast hides it and the column holds a value no consumer understands. | One pure `toMediaStatus` collapse beside `deriveTitleStatus`, unit-tested over every member of `PIPELINE_STATUSES`. |
| Cancelling by the wrong `processJobId` | Someone else's encode dies. No error anywhere — the killed job just reports a cancellation nobody asked for. | The ids come only from the deleted source's own `sourceFiles -> processJob` join, never from a tag, a title or a hash; asserted in `downloads.service.spec.ts`. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/npm web run build
```

Then the manual pass, on a running stack (`bin/dev -d`). Each line below reaches the matching
acceptance criterion in `../spec.md`:

1. **AC-1/AC-2** — add a release to a film, let it start downloading, delete it from the panel.
   Check qBittorrent's list, then
   `bin/cli api ls "$CONTAINER_DOWNLOADS_DIR/<path_downloads>"` for the hash folder, then
   `bin/mysql -e 'select id from media_sources where id = <id>'` and
   `bin/mysql -e 'select status from movies where id = <id>'` → `MISSING`.
2. **AC-3** — `docker compose stop worker`, let a torrent finish, delete it, then
   `bin/cli redis redis-cli EXISTS bull:process:media-source-<id>` → `0`. Restart the worker and
   watch `docker compose logs -f worker` do nothing.
3. **AC-4** — stop a torrent from the panel first, then delete it. Same checks as AC-1.
4. **AC-5/AC-6** — with an encode running, delete its source; within 15s
   `bin/cli worker ps ax` shows no `ffmpeg`/`mkvmerge`,
   `bin/cli api find "$CONTAINER_DOWNLOADS_DIR" -name '*.working.mkv'` and
   `bin/cli api find "$CONTAINER_DESTINATIONS_DIR" -name '*.part.mkv'` are both empty, and
   `docker compose logs worker` shows the cancellation with no `encodeCompleted`/`encodeFailed`
   for that job.
5. **AC-7/AC-8** — upload a file to a film, delete it while queued, then repeat while encoding.
   `bin/cli api ls "$CONTAINER_DOWNLOADS_DIR/<path_downloads>/imports"` no longer lists the
   upload id.
6. **AC-9** *(failure path)* — `docker compose stop torrent`, delete a torrent source, read the
   error in the panel, confirm the row and the folder are both still there, `docker compose start
   torrent`, delete again and watch it succeed.
7. **AC-10** *(failure path)* — `bin/mysql -e "update media_sources set download_path = '/etc'
   where id = <id>"`, delete, confirm `/etc` is untouched (`bin/cli api ls /etc | wc -l`), the
   refusal is in `docker compose logs api` naming the path and the root, and the row is gone.
8. **AC-11** — a season pack mid-fan-out: `bin/cli redis redis-cli KEYS 'bull:encode:job-*'`
   before and after.
9. **AC-12** — delete a source whose file is already filed; confirm the library file's size and
   mtime are unchanged (`bin/cli api ls -l "<outputFilePath>"`).

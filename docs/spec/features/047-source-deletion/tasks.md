---
title: Source deletion — torrent, uploaded file and queued work — Tasks
last_updated: 2026-09-05
status: Draft
---

# TASKS: Source deletion — torrent, uploaded file and queued work (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

There is **no migration and no SDL change** in this feature. Two files are a hand-synced contract
with no compiler across them — `services/api/src/queue/types.ts` (T001) and
`services/worker/src/queue/types.ts` (T009) — and both transcribe the channel exactly as
`spec.md` § "The cancellation channel" freezes it. An agent that finds that text wrong stops and
reports; it does not adjust it (Constitution, Article VIII).

## Tasks

### Group 1 — the api's seams

These four are the capabilities the orchestration in Group 2 is built from. T003 and T004 touch
files nothing else in this group touches.

- [ ] **T001** `[api]` Add `ENCODE_CANCEL_CHANNEL = 'encode:cancel'` and
      `type EncodeCancelMessage = { processJobId: number }` to
      `services/api/src/queue/types.ts`, extending the file's existing "source of truth,
      hand-copied into the worker" comment to cover the channel.
      *Done when:* `bin/cli api npx --no tsc --noEmit` is 0 errors and
      `grep -n "encode:cancel" services/api/src/queue/types.ts` prints the constant.
- [ ] **T002** `[api]` Add `removeSourceReady(mediaSourceId)` to `process-queue.service.ts` and
      `removeEncode(processJobId)` + `publishCancel(processJobId)` to `encode-queue.service.ts`,
      each deriving its job id exactly as the `add*` method beside it; inject `RedisService` and
      add `RedisModule` to `queue.module.ts`'s imports. A `0` return from `Queue.remove` is logged,
      never thrown. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` is 0 errors, and with the stack up,
      `bin/cli redis redis-cli SUBSCRIBE encode:cancel` in one terminal prints a message when a
      delete is performed in another (proved end to end by T020; here it is enough that the api
      boots — `docker compose logs api` shows no injection error).
- [ ] **T003** `[api] [P]` Add `isInsideRoot(rootId, absolutePath): Promise<boolean>` to
      `media-roots.service.ts`, reusing the same `realpath`-of-deepest-existing-ancestor check
      `resolveFromRoot` ends with. It returns `false` — never throws — for an unknown root, an
      unmounted root, a non-string or NUL-bearing path, a relative path, and a path that escapes
      through a symlinked segment. Extend `media-roots.service.spec.ts` with cases against a real
      `mkdtemp` and a real symlink, matching that file's existing standard.
      *Done when:* `bin/npm api test -- media-roots` passes, including a case where a symlinked
      segment inside the root points outside it and the answer is `false`.
- [ ] **T004** `[api] [P]` Add `toMediaStatus(status: PipelineStatus): MediaStatus` to
      `pipeline-status.ts` — `QUEUED`/`PAUSED`/`DOWNLOADING`/`DOWNLOADED` → `DOWNLOADING`, the rest
      to themselves — as an exhaustive `switch` with no `default`. Extend `pipeline-status.spec.ts`
      to cover every member of `PIPELINE_STATUSES`.
      *Done when:* `bin/npm api test -- pipeline-status` passes, and deleting a member from the
      `switch` fails `bin/cli api npx --no tsc --noEmit`.

### Group 2 — the api's deletion path

Sequential: all three edit `downloadDelete` and its private helpers in the same file, in the order
`api/plan.md` § Steps fixes. That order is the contract — `plan.md` § Risks says what each swap
breaks.

- [ ] **T005** `[api]` Rewrite `downloadDelete` in `downloads.service.ts` as the orchestrator:
      drop the `requireTorrent` call (keeping the method for start/stop), read the source's
      `ProcessJob` ids before deleting anything, call the torrent client first inside
      `callTorrentClient`, then `publishCancel` + `removeEncode` per job and `removeSourceReady`
      once, then delete the row. Add `MediaRootsModule` to `downloads.module.ts`. → T002
      *Done when:* deleting an upload no longer answers `error.download.not_a_torrent`; deleting a
      torrent whose encode is queued leaves `bin/cli redis redis-cli EXISTS bull:encode:job-<id>`
      at `0` (AC-3, AC-11); with `docker compose stop torrent`, the mutation fails with
      `error.download.torrent_client_rejected` and `bin/mysql -e 'select id from media_sources
      where id = <id>'` still returns the row (AC-9).
- [ ] **T006** `[api]` Add the on-disk deletion helper called from step 5 of `downloadDelete`:
      resolve the downloads root the way `UploadsService.moveUploadedFile` does, gate on
      `isInsideRoot('downloads', downloadPath)`, and branch on `source.kind` — `LOCAL_FILE` → `rm`
      the file then a non-recursive `rmdir` of its directory; every other kind → recursive `rm`.
      Every failure is caught and logged, never thrown; a path outside the root is logged with both
      the path and the root and skipped, and the rest of the deletion proceeds. → T003, T005
      *Done when:* the hash folder under the downloads root is gone after deleting a torrent
      (AC-1), `imports/<uploadId>` is gone after deleting an upload (AC-7), and with
      `download_path` set to `/etc` by hand the directory is untouched, the refusal is in
      `docker compose logs api`, and the row is still deleted (AC-10).
- [ ] **T007** `[api]` Add the status recompute called from step 7 of `downloadDelete`: resolve the
      targets (`movieId`; `episodeId`; or every episode of `seasonId`), short-circuit to
      `COMPLETED` when the row's `filePath` is set, otherwise call `deriveTitleStatus` with
      `status: 'MISSING'` as the floor over the rows that remain and write `toMediaStatus`'s
      collapse. → T004, T005
      *Done when:* `bin/mysql -e 'select status from movies where id = <id>'` returns `MISSING`
      after deleting a film's only source (AC-2), and returns `COMPLETED` — with the library file
      still on disk — for a film whose encode already finished (AC-12).
- [ ] **T008** `[api]` Extend `downloads.service.spec.ts` for the deletion orchestration: an upload
      is accepted rather than refused; the torrent client is called before any Prisma delete and
      any `rm`, and its rejection leaves row, queue entries and disk untouched; every `ProcessJob`
      of the source gets exactly one `publishCancel` and one `removeEncode` (three jobs → three of
      each) and no id belonging to another source is ever cancelled; `removeSourceReady` is called
      once; an out-of-root `downloadPath` deletes nothing on disk and still deletes the row.
      → T005, T006, T007
      *Done when:* `bin/npm api test` is green and the new cases fail if the step order in
      `downloadDelete` is swapped.

### Group 3 — the worker's cancellation

Independent of Groups 1–2: the channel is frozen in `spec.md`, so this needs nothing from the api
at compile time and can run alongside it. T009, T010 and T012 touch disjoint files.

- [ ] **T009** `[worker] [P]` Transcribe `ENCODE_CANCEL_CHANNEL` and `EncodeCancelMessage` into
      `services/worker/src/queue/types.ts`, byte-identical to the api's, extending the file's
      existing hand-sync comment to cover the channel.
      *Done when:* `diff <(grep -A2 "encode:cancel" services/api/src/queue/types.ts) <(grep -A2
      "encode:cancel" services/worker/src/queue/types.ts)` shows no difference in the constant or
      the field name.
- [ ] **T010** `[worker] [P]` Add `src/encode/cancellation.ts` — the
      `Map<number, AbortController>` registry with `registerEncode`, `cancelEncode`,
      `releaseEncode` and `class EncodeCancelledError extends Error` (deliberately **not** a
      `KeyedError`) — plus `cancellation.spec.ts`: cancelling an unregistered id returns `false`
      and throws nothing, a registered id aborts exactly once, a second cancel is a no-op,
      `releaseEncode` removes the entry so a later message cannot abort a different job that reused
      the number.
      *Done when:* `bin/npm worker test -- cancellation` passes.
- [ ] **T011** `[worker]` Open one ioredis subscriber on `ENCODE_CANCEL_CHANNEL` in `src/index.ts`,
      reading `REDIS_HOST`/`REDIS_PORT` the same way the Workers do; on message, parse and call
      `cancelEncode`, logging both outcomes with the id. A malformed message is logged and dropped,
      never thrown out of the handler. Close the subscriber in the existing `SIGTERM` handler.
      → T009, T010
      *Done when:* `docker compose logs worker` shows the subscription at boot, and
      `bin/cli redis redis-cli PUBLISH encode:cancel '{"processJobId":999}'` logs "not running
      here" for 999 without killing the worker; a malformed `PUBLISH encode:cancel 'nope'` logs and
      the worker stays up.
- [ ] **T012** `[worker] [P]` Add `signal: AbortSignal` as a **required** parameter of `EncodeFn`
      in `src/encode/types.ts` and wire it through all three implementations —
      `encode.ffmpeg.ts` (forwards to `runFfmpeg`), `encode.mock.ts` (checks between steps) and
      `passthrough.ts` (checks before the move and after the `EXDEV` copy, removing a partial copy
      on abort). → T010
      *Done when:* `bin/cli worker npx --no tsc --noEmit` is 0 errors, and removing the argument
      from any one call site fails that typecheck.
- [ ] **T013** `[worker]` Wire abort into `src/ffmpeg/runner.ts`: reject immediately with
      `EncodeCancelledError` if the signal is already aborted; otherwise add an `abort` listener
      that kills `activeChild` with `SIGTERM` and, after a 10s grace, `SIGKILL`, and reject with
      `EncodeCancelledError` when the child then closes. Remove the listener where
      `cleanupListeners()` already removes the process-level ones, which stay untouched. Reuse
      `cleanupTemps()` — do not add a second temp cleanup. → T012
      *Done when:* with an encode running, `bin/cli redis redis-cli PUBLISH encode:cancel
      '{"processJobId":<live id>}'` leaves no `ffmpeg`/`mkvmerge` in `bin/cli worker ps ax` within
      15s, and no `*.working.mkv` under the downloads root nor `*.part.mkv` under the destinations
      root (AC-5).
- [ ] **T014** `[worker]` In `src/jobs/encode.job.ts`, call `registerEncode(processJobId)` before
      the encode and `releaseEncode` in a `finally` covering every exit; pass the signal into
      **both** the `passthrough(...)` and `encode(...)` call sites; and in the `catch`, test
      `error instanceof EncodeCancelledError` **first**, logging one line and rethrowing with no
      `encodeFailed` and no `deliverReport`. Extend `encode.job.spec.ts` to assert a cancelled
      encode sends neither `encodeCompleted` nor `encodeFailed` and does not call `cleanupSource`,
      over both the compressing and the `compressionEnabled === false` paths. → T012, T013
      *Done when:* `bin/npm worker test` is green (bar the pre-existing `ffmpeg/2.json` failure
      recorded in `worker/plan.md` § Done when), and `docker compose logs worker` after a real
      cancellation shows the abandonment with no outcome mutation for that job (AC-6).

### Group 4 — the panel

Independent of the other groups: `downloadDelete` keeps its signature, so nothing here waits on the
api. T016 and T017 touch different files.

- [ ] **T015** `[web]` In `messages/en.json` and `messages/es.json`, replace
      `downloads.deleteModal.message` with `messageTorrent` and `messageUpload`, and add
      `encodingWarning`. Spanish keeps the existing register — `messageTorrent` is today's
      `message` verbatim; `messageUpload` speaks of the uploaded file; `encodingWarning` is
      `La compresión en curso se va a detener.` Remove the old `message` key from **both** files.
      *Done when:* `bin/cli web node scripts/check-messages.mjs` exits 0 and
      `grep -c '"message"' services/web/messages/*.json` finds none under `deleteModal`.
- [ ] **T016** `[web] [P]` In `DownloadsPanel.tsx`, split the `isControllable` gate: Play and
      Square stay behind it, Trash renders unconditionally. Keep the existing comment's rule —
      the test is `download.infoHash != null`, never `kind` — and do not duplicate the button
      markup into two branches.
      *Done when:* `bin/npm web run build` exits 0 and an uploaded-file row in a film's downloads
      panel shows the trash button with no play/stop buttons (AC-7).
- [ ] **T017** `[web] [P]` In `DeleteDownloadModal.tsx`, pick `messageTorrent` vs `messageUpload`
      from `download.infoHash != null`, keeping `t.rich` and its `target`/`b` arguments identical
      for both, and render `encodingWarning` as an extra line when
      `download.status === "ENCODING"`. → T015
      *Done when:* `bin/npm web run build` exits 0; the dialog for an upload talks about a file,
      the dialog for a torrent is unchanged from today, and a row mid-encode shows the warning.

### Group 5 — verification and docs

- [ ] **T018** `[docs]` Add a `047-source-deletion` section to `docs/spec/graphql-contract.md`:
      `downloadDelete`'s unchanged signature with its changed error set (and that
      `error.download.not_a_torrent` is no longer reachable from it but stays for start/stop), and
      the `encode:cancel` channel recorded beside the BullMQ payload under § "The queue payload is
      a second, parallel contract" as the second api→worker contract with no compiler across it.
      → T008, T014
- [ ] **T019** `[docs]` Update the `CLAUDE.md` files: the root pipeline table's **Download** and
      **Transcode** rows (a delete now unwinds queued and running work, and an upload is
      deletable), `services/api/CLAUDE.md` (the downloads module's control surface and the new
      `MediaRootsService.isInsideRoot`), and `services/worker/CLAUDE.md` (the cancellation channel,
      the `EncodeFn` signal parameter, and that `cleanup-source.ts` remains the post-*success* path
      only). Add Article XII to the constitution's reading in any place that lists what a delete
      may touch. → T018
- [ ] **T020** `[docs]` Run the full verification pass — `bin/cli api npx --no tsc --noEmit`,
      `bin/npm api test`, `bin/cli worker npx --no tsc --noEmit`, `bin/npm worker test`,
      `bin/npm web run build`, plus `git status services/api/src/schema.gql` and
      `services/api/prisma/` both clean — then walk `plan.md` § Verification's nine manual steps,
      tick every acceptance criterion in `spec.md`, and set `status: Implemented` on `spec.md`,
      `plan.md` and all three `<svc>/plan.md`. Record the new test counts. → T019
      *Done when:* every AC box in `spec.md` is ticked or listed in Blocked with a reason.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

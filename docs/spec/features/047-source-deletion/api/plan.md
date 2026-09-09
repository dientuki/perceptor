---
title: Source deletion — api slice
service: api
last_updated: 2026-09-08
status: Implemented
---

# PLAN: Source deletion — `api` (`api/plan.md`)

## Scope

This service owns the whole unwind. `downloadDelete` becomes the orchestrator: it accepts uploads
as well as torrents, removes the torrent from the client, publishes the cancellation for every
running encode, withdraws every queued entry, deletes the source's residue under the downloads
root, deletes the row, and rewrites the target's status.

Explicitly **not** this slice: killing the FFmpeg process (the `worker` reacts to the message this
service publishes — it does not confirm and this service does not wait), removing the
`<final>.part.mkv` at the destination (the worker's own temp, cleaned by its rejection path), and
anything in the downloads panel UI (`web`). There is **no Prisma migration** and **no schema
change** — `downloadDelete` keeps its exact signature.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/queue/types.ts` | Modified | Adds `ENCODE_CANCEL_CHANNEL = 'encode:cancel'` and `type EncodeCancelMessage = { processJobId: number }`. This file is the source of truth the worker's copy transcribes. |
| `services/api/src/queue/encode-queue.service.ts` | Modified | Adds `removeEncode(processJobId)` (BullMQ `Queue.remove`, same derived `job-<id>` id as `addEncode`) and `publishCancel(processJobId)` (`RedisService.publish`). |
| `services/api/src/queue/process-queue.service.ts` | Modified | Adds `removeSourceReady(mediaSourceId)`, mirroring `addSourceReady`'s `media-source-<id>` id. |
| `services/api/src/queue/queue.module.ts` | Modified | Imports `RedisModule` so `EncodeQueueService` can inject `RedisService`. |
| `services/api/src/media-roots/media-roots.service.ts` | Modified | Adds `isInsideRoot(rootId, absolutePath): Promise<boolean>`. |
| `services/api/src/pipeline-status/pipeline-status.ts` | Modified | Adds `toMediaStatus(status: PipelineStatus): MediaStatus`. |
| `services/api/src/downloads/downloads.service.ts` | Modified | `downloadDelete` rewritten; private helpers for the cancel+withdraw step, the on-disk step and the status recompute. |
| `services/api/src/downloads/downloads.module.ts` | Modified | Imports `MediaRootsModule`. |
| `services/api/src/downloads/downloads.service.spec.ts` | Modified | New cases for the deletion orchestration (see Tests). |
| `services/api/src/media-roots/media-roots.service.spec.ts` | Modified | New cases for `isInsideRoot`. |
| `services/api/src/pipeline-status/pipeline-status.spec.ts` | Modified | New cases for `toMediaStatus` and the recompute floor. |

## Existing code to reuse

- **`src/downloads/downloads.service.ts` — `findOwnedSource(mediaSourceId, userId)`.** The
  ownership lookup across all three targets, already answering an unowned source exactly as a
  missing one (NFR-5). Reuse verbatim; do not write a second lookup.
- **`src/downloads/downloads.service.ts` — `callTorrentClient(action)`.** Every torrent-client call
  goes through it; it converts any rejection or unreachable client into
  `TORRENT_CLIENT_REJECTED` (`022-download-status-tags` NFR-6). This is what satisfies NFR-2 — keep
  the client call first, inside this wrapper, before any other step.
- **`src/downloads/downloads.service.ts` — `requireTorrent(source)`.** Stays, but is **no longer
  called by `downloadDelete`** (REQ-1). It remains on `downloadStart`/`downloadStop`.
- **`src/clients/torrent/client.ts` — `remove(hashes, deleteFiles)`.** Called as today with
  `deleteFiles: true`. It already throws `TorrentClientError` on a non-OK response.
- **`src/redis/redis.service.ts`.** `RedisService extends Redis` (ioredis) — inject it and call
  `publish`. Do **not** publish through `src/queue/connection.ts`'s options object: that exists
  because BullMQ needs its own blocking connection with different retry settings, and the comment
  at the top of that file says so.
- **`src/media-roots/media-roots.service.ts` — `resolveFromRoot(rootId, relPath)` and
  `realpathOfDeepestExisting`.** `isInsideRoot` is built on the same `realpath` comparison
  `resolveFromRoot` ends with. **Do not** use `containerToHostPath` as a containment test: it also
  returns `null` when `hostPath` is relative (`./data/downloads`, the `.env.example` default), so
  it would refuse every path on a default install.
- **`src/settings/settings.service.ts` — `getMap()`, and `UploadsService.moveUploadedFile`'s
  pattern** (`resolveFromRoot('downloads', config.path_downloads ?? '.')`). That is how the
  downloads base is resolved everywhere; resolve it the same way here.
- **`src/pipeline-status/pipeline-status.ts` — `deriveTitleStatus`.** The status ladder. Call it
  with `status: 'MISSING'` as the floor rather than reimplementing the comparison; see
  `movies.service.ts:116` and `shows.service.ts:87` for the shape of the `sources`/`jobs` arguments
  and the relation includes that produce them.
- **Prisma cascades.** `SourceFile.mediaSourceId` and `ProcessJob.sourceFileId` are both
  `onDelete: Cascade`. One `mediaSource.delete` removes the source's files and jobs. Do not delete
  them by hand.

## Steps

1. **`src/queue/types.ts`** — add the channel constant and the message type, with the same
   "source of truth, hand-copied into the worker" note the file already carries for the queue
   payload.
2. **`src/queue/process-queue.service.ts`** — add `removeSourceReady(mediaSourceId)`:
   `this.queue.remove(\`media-source-${mediaSourceId}\`)`. Derive the id the same way
   `addSourceReady` does. A `0` return (no such entry, or the entry is active) is normal — log it,
   never throw.
3. **`src/queue/encode-queue.service.ts`** — add `removeEncode(processJobId)` the same way against
   `job-<id>`, and `publishCancel(processJobId)`, which publishes
   `JSON.stringify({ processJobId })` to `ENCODE_CANCEL_CHANNEL`. Inject `RedisService`; add
   `RedisModule` to `src/queue/queue.module.ts`'s imports.
4. **`src/media-roots/media-roots.service.ts`** — add
   `isInsideRoot(rootId: string, absolutePath: string): Promise<boolean>`. It returns `false`,
   never throws, for: an unknown root, an unmounted root, a non-string or NUL-bearing path, a
   relative path, and a path whose deepest existing ancestor `realpath`s outside the root's own
   `realpath`. Equality with the root itself counts as inside; the caller is responsible for never
   passing the bare root (step 6 does).
5. **`src/pipeline-status/pipeline-status.ts`** — add
   `toMediaStatus(status: PipelineStatus): MediaStatus`, collapsing
   `QUEUED`/`PAUSED`/`DOWNLOADING`/`DOWNLOADED` → `DOWNLOADING`, and mapping `MISSING`, `ENCODING`,
   `COMPLETED`, `ERROR` to themselves. Exhaustive `switch`, no `default` — a future
   `PipelineStatus` member must fail to compile here, not fall through.
6. **`src/downloads/downloads.service.ts`** — rewrite `downloadDelete` in this exact order. The
   order is the contract; `../plan.md` § Risks explains what each swap breaks.
   1. `findOwnedSource` (unchanged). **No `requireTorrent`.**
   2. Read the source's `ProcessJob` ids —
      `processJob.findMany({ where: { sourceFile: { mediaSourceId } }, select: { id: true } })`,
      the same join shape `jobsBySourceId` already uses. Read them *before* the row is deleted.
   3. If `source.infoHash`, `callTorrentClient(() => this.qbittorrent.remove(infoHash, true))`.
      This is the only step that can fail the mutation, and it runs before anything is removed
      from disk or from the database (NFR-2).
   4. For each `ProcessJob` id: `publishCancel(id)`, then `removeEncode(id)`. Then
      `removeSourceReady(mediaSourceId)`. Cancel before withdraw so a job that is mid-transition
      is caught by one or the other.
   5. Delete the residue on disk (step 7).
   6. `prisma.mediaSource.delete({ where: { id } })` — cascades.
   7. Recompute the target's status (step 8).
   8. `return true`.
7. **On-disk deletion** (private helper in the same service). With no `downloadPath`, log and
   return. Otherwise resolve the downloads root the way `UploadsService.moveUploadedFile` does and
   call `isInsideRoot('downloads', downloadPath)`; on `false`, `console.error` naming both the path
   and the root and **return without deleting** — the rest of the deletion still proceeds (REQ-10,
   AC-10). On `true`, branch on `source.kind`, mirroring `worker/src/jobs/cleanup-source.ts`:
   `LOCAL_FILE` → `rm(downloadPath, { force: true })` then a non-recursive
   `rmdir(dirname(downloadPath))` whose failure is caught and logged (an `ENOTEMPTY` must leave
   whatever else is in there alone); every other kind → `rm(downloadPath, { recursive: true,
   force: true })`. Every failure in this helper is caught and logged, never thrown: the torrent is
   already gone from the client by now, so throwing here would leave the user unable to retry.
8. **Status recompute** (private helper). Targets: `movieId` → that movie; `episodeId` → that
   episode; `seasonId` → every episode of that season (a season has no status column; an episode
   inside a pack has no `MediaSource` of its own but does have `ProcessJob`s — see the comment
   above `ShowsService.findOneFromDb`). For each target row: if `filePath != null`, write
   `COMPLETED` and stop — a title whose file is already in the library never walks backwards
   (REQ-13, AC-12). Otherwise call `deriveTitleStatus({ status: 'MISSING', sources, jobs })` with
   the rows that remain *after* the delete, collapse it with `toMediaStatus`, and write it.
9. **`src/downloads/downloads.module.ts`** — add `MediaRootsModule` to `imports`. `QueueModule` and
   `SettingsModule` are already there.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

- `downloadDelete(mediaSourceId: Int!): Boolean!` — **unchanged SDL**. No new argument, no result
  object. `src/schema.gql` must come out of this feature byte-identical; if it does not, something
  was changed that should not have been.
- Exactly two errors may leave this mutation: `error.source.not_found` (`NotFoundException`, via
  `i18nError.notFound`) for a missing or unowned id, and `error.download.torrent_client_rejected`
  (`ServiceUnavailableException`, via `callTorrentClient`) for a client that rejects or is
  unreachable. **`error.download.not_a_torrent` must no longer be reachable from this mutation** —
  and must not be deleted from `src/i18n/error-keys.ts` or `messages.en.ts`, since
  `downloadStart`/`downloadStop` still raise it.
- No new error key is added. If a step needs one, that is a contract change: stop and report.
- Published to `worker`, outside GraphQL: channel `encode:cancel`, message
  `{"processJobId": <Int>}`, one message per job, no reply expected and none read.

## Tests

- **`src/downloads/downloads.service.spec.ts`** (extended) — defends against the deletion that
  reports `true` while leaving work running. Cases: an upload (no `infoHash`) is accepted rather
  than refused; the torrent client is called before any Prisma delete and before any `rm`, and a
  rejection from it leaves the row, the queue entries and the disk untouched (AC-9); every
  `ProcessJob` of the source gets exactly one `publishCancel` and one `removeEncode`, and a source
  with three jobs gets three of each (AC-11); no id belonging to another source is ever cancelled;
  `removeSourceReady` is called once; a `downloadPath` outside the root deletes nothing on disk and
  still deletes the row (AC-10).
- **`src/media-roots/media-roots.service.spec.ts`** (extended) — defends against a containment
  answer that is wrong in either direction, which is either a delete outside the root or a delete
  that never happens. Follows the file's existing standard: a real `mkdtemp`, real directories and
  a real symlink pointing outside the root, not mocks.
- **`src/pipeline-status/pipeline-status.spec.ts`** (extended) — defends against a title stranded
  in a status nothing will ever clear. Cases: `toMediaStatus` over every member of
  `PIPELINE_STATUSES`; the `MISSING` floor genuinely walks a status back where
  `deriveTitleStatus`'s normal call site cannot; a row with `filePath` set is never derived below
  `COMPLETED`.

Not owed a test: the queue wrappers' `remove`/`publish` one-liners (a failure there is caught by
the orchestration cases above, which assert the calls), and `downloads.module.ts`'s import.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
```

Typecheck at 0 errors, the full suite green, and `git status services/api/src/schema.gql` clean —
this feature changes no decorator, so the generated schema must not move (Constitution,
Article IV). `git status services/api/prisma/` must also be clean: there is no migration here.

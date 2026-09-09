---
title: Source deletion — torrent, uploaded file and queued work
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-05
last_updated: 2026-09-08
status: Implemented
services: [api, web, worker]
---

# SPEC: Source deletion — torrent, uploaded file and queued work (`spec.md`)

## Context & Goal

Deleting a download today only undoes the first stage of the pipeline. `downloadDelete`
(`services/api/src/downloads/downloads.service.ts`) removes the torrent from qBittorrent with its
files and deletes the `MediaSource` row — and that is the whole of it. Everything the rest of the
pipeline has already produced from that source survives the deletion: the `source-ready` entry
still sits in the `process` queue, every `encode` entry still sits in the `encode` queue, and an
FFmpeg process that is already running keeps running to completion, writing a `.working.mkv` next
to an input whose row no longer exists. The per-torrent isolation folder that
`QbittorrentClient.add` creates under the downloads root (a sha256 prefix of the release URL) is
left behind empty, because qBittorrent deletes the torrent's *content*, not the save path it was
given. And an uploaded file cannot be deleted at all: `requireTorrent` refuses any source with no
`infoHash`, and `DownloadsPanel` hides the button for exactly the same reason.

The result is that a user who changes their mind mid-pipeline has no way to actually stop the
work. The row disappears from the panel while the machine keeps transcoding a file for a title
that no longer requests it, the title itself stays stuck in `DOWNLOADING`/`ENCODING` forever
because nothing recomputes it, and the downloads root slowly fills with orphan folders. Every one
of those states — downloading, waiting for its turn in the worker, stopped, being transcoded — is
reachable for a torrent, and the last two are reachable for an upload.

This feature makes one delete mean one delete, for both kinds of source. It touches the pipeline's
**Download**, **Detect completion / enqueue** and **Transcode** stages: the api gains the ability
to withdraw queued work and to ask the worker to abandon an encode already in flight, the worker
gains a cancellation channel it does not have today (`services/worker/src/ffmpeg/runner.ts` only
listens for `SIGINT`/`SIGTERM` on the whole process, which is a shutdown, not a per-job cancel),
and `web` offers the button on every row instead of torrents only. Nothing about how a source is
*acquired* changes.

## Requirements

### Functional Requirements

- [x] **REQ-1 (One delete for every source)**: `downloadDelete` must accept any `MediaSource` the
      caller owns, whether it came from a torrent or from a tus upload. `DOWNLOAD_NOT_A_TORRENT`
      must no longer be raised by this mutation; it stays on `downloadStart`/`downloadStop`, which
      remain torrent-only.
- [x] **REQ-2 (Torrent removed whatever its state)**: when the source carries an `infoHash`, the
      torrent must be removed from the torrent client with its files — downloading, queued,
      paused/stopped, seeding after completion, or already unknown to the client. A hash the
      client no longer knows must not abort the rest of the deletion.
- [x] **REQ-3 (Queued work withdrawn)**: every queue entry that belongs to the source must be
      removed before its row is deleted — the `process` queue's `media-source-<mediaSourceId>`
      entry and the `encode` queue's `job-<processJobId>` entry for each of the source's
      `ProcessJob` rows — in whatever state the entry is (waiting, delayed, prioritized, failed).
      A source with several `ProcessJob`s (a season pack fan-out) must have all of them withdrawn,
      not just the first.
- [x] **REQ-4 (Running encode cancelled)**: if any `ProcessJob` of the source is being transcoded
      when the delete arrives, the api must ask the worker to abandon it, and the worker must
      terminate the process it currently has running — FFmpeg, or `mkvmerge` if the encode already
      moved on to the remux — rather than letting it run to completion.
- [x] **REQ-5 (Both temporaries removed)**: after a cancelled encode, neither temporary survives:
      the `<input>.working.mkv` beside the source file, nor the `<final>.part.mkv` at the
      destination. The `.part.mkv` is the worker's own scratch file, not a library file, and is the
      single thing this feature removes from under the destinations root (see REQ-13).
- [x] **REQ-6 (A cancelled encode reports nothing)**: a job abandoned because its source was
      deleted must not report `encodeCompleted` or `encodeFailed`. Deletion is the outcome — there
      is no row left to record a result on, and an `ERROR` the user did not cause must not appear
      anywhere.
- [x] **REQ-7 (A late report is inert)**: if an outcome report still reaches the api for a
      `ProcessJob` that no longer exists, the api must reject it plainly, the worker must not
      retry it, and nothing must be created, resurrected or notified as a result.
- [x] **REQ-8 (Torrent isolation folder removed)**: the per-torrent folder recorded in
      `MediaSource.downloadPath` must be gone from disk after the delete, together with anything
      left inside it — the client's own residue, a partially written `.working.mkv`, an
      `incomplete` subdirectory.
- [x] **REQ-9 (Uploaded file and its folder removed)**: for a `LOCAL_FILE` source, both the
      uploaded file and the `imports/<uploadId>` directory it was staged into must be gone.
- [x] **REQ-10 (Deletion is confined to the downloads root)**: no path outside the downloads root
      may ever be deleted. A `downloadPath` that does not resolve inside it must be left untouched
      and logged; the rest of the deletion still proceeds.
- [x] **REQ-11 (Row and its dependents removed)**: the `MediaSource` row and everything that
      cascades from it — `SourceFile`, `ProcessJob` — must be gone once the mutation answers.
- [x] **REQ-12 (Title status recomputed)**: after the deletion the target's status must reflect
      the sources that remain. With no source left, the movie/episode returns to `MISSING` and can
      be requested again; with sources left, it reads as the most advanced of them.
- [x] **REQ-13 (The library is never touched)**: a transcoded file already delivered under the
      destinations root is never deleted by this feature, whatever the state of the source that
      produced it. Deleting a source that already finished removes its row and its downloads-side
      residue and nothing else.
- [x] **REQ-14 (Delete offered on every row)**: `web`'s downloads panel must offer the delete
      button for an uploaded file as well as a torrent; start and stop stay torrent-only. The
      confirmation copy must say what will actually be removed for that kind of source — a torrent
      and its files, or the uploaded file — and must say when an encode in progress will be
      stopped.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Cancellation is one-way and idempotent)**: the api does not wait for the worker to
      acknowledge a cancellation, and correctness does not depend on the two happening in a
      particular order. A cancellation for a job that is not running — already finished, never
      started, running on a worker that has since restarted — is a no-op, and a repeated
      cancellation for the same job is the same no-op.
- [x] **NFR-2 (A torrent-client failure fails the whole delete)**: if the torrent client rejects
      or is unreachable, the mutation must fail with `TORRENT_CLIENT_REJECTED` before anything is
      removed from disk or from the database, so a retry finds the same state it started from.
      This is the existing `callTorrentClient` contract (`022-download-status-tags` NFR-6) and it
      is preserved.
- [x] **NFR-3 (No new status vocabulary)**: cancellation introduces no `CANCELLED` value in
      `SourceStatus`, `EncodeStatus` or `MediaStatus`, and no new pipeline status. A cancelled job
      is a deleted job; consumers that retyped the eight-value vocabulary of
      `043-pipeline-status-normalization` are unaffected.
- [x] **NFR-4 (A delete racing a scan enqueues nothing)**: a deletion that lands while the worker
      is mid-scan of that source must not leave enqueued encode work behind. The scan's
      `sourceScanned` report finds no source, fails, and enqueues nothing.
- [x] **NFR-5 (Ownership unchanged)**: the mutation resolves through the same ownership clause it
      uses today. A source belonging to a title the caller does not own answers exactly as a
      source that does not exist.

## GraphQL Contract Delta

The SDL is **unchanged** — `downloadDelete` keeps its name, its argument and its return type:

```graphql
type Mutation {
  downloadDelete(mediaSourceId: Int!): Boolean!
}
```

What changes is which sources it accepts and which errors it can raise. `web` retypes this by
hand, so the delta is the error set, not the signature:

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `mediaSourceId` does not exist, or belongs to a title the caller does not own | `NotFoundException` — `error.source.not_found` | `El medio {id} no existe` |
| The torrent client rejects the delete, or is unreachable | `ServiceUnavailableException` — `error.download.torrent_client_rejected` | `El cliente de torrents rechazó la solicitud ({status})` |
| ~~The source has no `infoHash`~~ | ~~`error.download.not_a_torrent`~~ | **No longer raised by `downloadDelete`** (REQ-1). The key stays in the catalog for `downloadStart`/`downloadStop`. |

No new error key is added. `web`'s `deleteDownloadAction` already resolves both remaining keys
through `toActionError`; the change on that side is that it must now be called for rows with no
`infoHash` too, and that its confirmation modal must render kind-dependent copy (REQ-14), which
means new entries under `downloads.deleteModal` in `messages/{en,es}.json`.

### The cancellation channel (`api` → `worker`, outside GraphQL)

Like the BullMQ payload (`docs/spec/graphql-contract.md` § "The queue payload is a second,
parallel contract"), this is a contract the GraphQL schema cannot express, so it is declared here.
It is a Redis pub/sub channel, not a queue: a cancellation is only meaningful to a worker that is
running the job *right now*, and must never be persisted for a worker to pick up later.

```
channel: encode:cancel
message: {"processJobId": <Int>}   // JSON, one job per message
```

- **Publisher**: `api`, from the deletion path, once per `ProcessJob` of the source being deleted.
- **Subscriber**: `worker`, for the lifetime of the process.
- Declared in **both** `services/api/src/queue/types.ts` and `services/worker/src/queue/types.ts`,
  which must change together — nothing enforces it.
- A message for a `processJobId` the worker is not currently encoding is ignored (NFR-1).
- The worker sends nothing back. There is no ack channel and no reply.

## Data Model Changes

**None.** No model, field or enum changes, and no migration. Every row this feature removes is
removed through relations that already cascade (`SourceFile.mediaSourceId`,
`ProcessJob.sourceFileId`), and the deliberate absence of a `CANCELLED` enum member is NFR-3.

## Acceptance Criteria

- [x] **AC-1**: Given a torrent in `DOWNLOADING`, when the user deletes it from the movie detail
      panel, then the torrent is gone from qBittorrent's list, `bin/cli torrent ls
      <downloads>/<folder>` reports no such directory, and `bin/mysql -e 'select id from
      media_sources where id = <id>'` returns no rows.
- [x] **AC-2**: Given that same movie had no other source, when the delete finishes, then
      `bin/mysql -e 'select status from movies where id = <id>'` returns `MISSING` and the movie
      page offers the search-a-release action again.
- [x] **AC-3**: Given a torrent that finished downloading while the worker container is stopped
      (`docker compose stop worker`), when the user deletes it, then `bin/cli redis redis-cli
      EXISTS bull:process:media-source-<id>` returns `0`, and restarting the worker processes
      nothing for that source.
- [x] **AC-4**: Given a stopped/paused torrent, when the user deletes it, then the outcome is
      identical to AC-1 — no residue on disk, no row, no queue entry.
- [x] **AC-5**: Given an encode in progress, when the user deletes its source, then within 15
      seconds `bin/cli worker ps ax` lists no `ffmpeg` or `mkvmerge` process for that input, no
      `*.working.mkv` remains anywhere under the downloads root, and no `*.part.mkv` remains under
      the destinations root.
- [x] **AC-6**: Given the encode cancelled in AC-5, when the worker logs are read
      (`docker compose logs worker`), then no `encodeCompleted` and no `encodeFailed` was sent for
      that job, and no `ProcessJob` row was left in `ERROR` — there is no row at all.
- [x] **AC-7**: Given an uploaded file waiting for its turn in the worker, when the user deletes it
      from the panel, then the `imports/<uploadId>` directory is gone in full and the row is gone.
      (Today the panel offers no button for this row at all — its presence is part of the
      criterion.)
- [x] **AC-8**: Given an uploaded file being transcoded, when the user deletes it, then AC-5 and
      AC-7 both hold for it.
- [x] **AC-9** *(failure path)*: Given the torrent client stopped (`docker compose stop torrent`),
      when the user deletes a torrent source, then the panel shows `El cliente de torrents rechazó
      la solicitud (0)`, the row still exists in `media_sources`, the download folder is still on
      disk, and the same delete succeeds once the client is back.
- [x] **AC-10** *(failure path)*: Given a `MediaSource` whose `downloadPath` is pointed outside the
      downloads root by hand (`bin/mysql -e "update media_sources set download_path = '/etc' where
      id = <id>"`), when the user deletes it, then `/etc` is untouched, the api logs the refusal
      naming the path and the root, and the row is still deleted.
- [x] **AC-11**: Given a season pack that fanned out into three `ProcessJob`s — one `ENCODING`, two
      `WAITING` — when the user deletes the source, then `bin/cli redis redis-cli KEYS
      'bull:encode:job-*'` lists none of the three and the running FFmpeg is gone (AC-5).
- [x] **AC-12**: Given a source whose encode already completed and whose file is in the library,
      when the user deletes the source, then the file under the destinations root still exists,
      byte-identical, and only the row and any downloads-side residue are gone.
- [x] **AC-13**: `bin/npm api test` and `bin/npm worker test` pass, and `bin/npm web run build`
      exits 0.

## Out of Scope

- **Deleting anything from the library.** Removing a transcoded file, or a title, from under the
  destinations root is not part of this feature and is not part of any feature — see REQ-13, and
  the constitution article ratified alongside this spec. The one exception, and it is not a
  library file, is the worker's own `<final>.part.mkv` scratch file (REQ-5).
- **Cancelling a tus upload that is still uploading.** No `MediaSource` exists until
  `onUploadFinish` runs, so there is nothing for `downloadDelete` to address. Aborting an in-flight
  upload is a `web` + tus concern and its own feature.
- **Bulk deletion.** Deleting every source of a title in one action, or a "clear finished" sweep,
  stays out — this feature is one row, one delete, exactly as the panel already presents it.
- **A `CANCELLED` status.** Adding one would ripple through the eight-value vocabulary of
  `043-pipeline-status-normalization` and through both consumers that retyped it, to describe a
  row that no longer exists (NFR-3).
- **Cancelling a scan in flight.** A `source-ready` scan is seconds of directory IO, not hours of
  FFmpeg; withdrawing its queue entry (REQ-3) and letting an already-running scan fail harmlessly
  (NFR-4) is the whole of the treatment it gets.
- **Deleting one episode of a season pack while keeping the others.** The source is the unit of
  deletion; a pack is one source.
- **Re-queuing or retrying after a delete.** The user requests the title again through the normal
  acquisition path; nothing remembers what was deleted.

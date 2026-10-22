---
title: Stop and resume a running encode
spec_version: 0.3.0
author: Juan "Dientuki" Farias
created_at: 2026-10-16
last_updated: 2026-10-17
status: Implemented
services: [api, web, worker]
---

# SPEC: Stop and resume a running encode (`spec.md`)

## Context & Goal

A download row's Stop and Play buttons only ever reach the torrent client. `downloadStop`
(`services/api/src/downloads/downloads.service.ts`) calls `requireTorrent`, stops the torrent in
qBittorrent and writes `PAUSED` only while the `MediaSource` is still non-terminal (`PENDING`,
`QUEUED`, `DOWNLOADING`, `PAUSED`). Once the source is `SCANNED` and its `ProcessJob` is `ENCODING`,
pressing Stop pauses the torrent's seeding, writes nothing, and FFmpeg keeps running to the end.
There is no way to halt the Transcode stage short of `downloadDelete` (`047`), which destroys the
source. For an uploaded file (`infoHash: null`) it is worse: `web`'s `DownloadRow` hides Stop
entirely (`isControllable` requires an `infoHash`), so a running upload encode can only be deleted.

The machinery to interrupt FFmpeg already exists. `047` built the `encode:cancel` Redis channel, the
worker's per-job `AbortSignal` (`worker/src/encode/cancellation.ts`), the runner's SIGTERM/SIGKILL
and `.part.mkv` cleanup, and the rule that a cancelled encode reports nothing. What is missing is a
state for "the user stopped this encode and may want it back": today a cancelled job is only ever
followed by the row being deleted.

Once this ships, while a source is encoding its row's Stop and Play act on the encode, not on the
torrent — the torrent is left exactly as it is. Stop cancels the running encode and withdraws every
not-yet-finished encode of that source; the row and its title read `PAUSED`, never `ERROR`. Play
puts the stopped encodes back at the end of the encode queue, which still runs one encode at a time
(`worker/src/index.ts`, `concurrency: 1`), and each stopped file is encoded again from the start.
The same pause and resume is available for one file of a multi-file source, from the child rows
`095-season-pack-per-file-encode` adds to `/downloads`. This changes the **Transcode** stage (it
gains a user-initiated pause) and the **Download** stage's row controls; no stage is added or
removed.

A stopped source also gives up its target's race. With three releases racing, the first to finish
wins, the others are paused (`022`), and when the winner's encode finishes every loser is swept
(`091`). If the user stops the winner's encode, the race is open again: pressing Play on a paused
sibling lets it finish downloading, win, and encode, and when that encode finishes the stopped
source is swept with the other losers. Stopping a bad release and picking another one, from the
paused siblings or from a new search, works without deleting anything first.

This spec builds on `095`, which is implemented first: `Download.jobs`, the child rows,
`encodeJobStart` (retry of an `ERROR` job) and the `DISCARDED` state all come from there.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Stop targets the encode while encoding)**: When the caller presses Stop on a source
      the caller owns whose derived status is `ENCODING` (at least one of its `ProcessJob`s is
      `WAITING`, `QUEUED` or `ENCODING`), `downloadStop` must stop the encode and must not call the
      torrent client. A source that is not encoding keeps today's torrent-only behaviour unchanged.
- [ ] **REQ-2 (What Stop stops)**: Stopping a source's encode must move every one of its
      `ProcessJob`s that is `WAITING`, `QUEUED` or `ENCODING` to a new `STOPPED` state, cancel the one
      the worker is running (through `047`'s `encode:cancel`), and withdraw the others from the encode
      queue. `COMPLETED` jobs are untouched — in a season pack, episodes already encoded stay
      encoded and filed.
- [ ] **REQ-3 (Uploads too)**: REQ-1 and REQ-5 apply to an uploaded source (`infoHash: null`)
      exactly as to a torrent one. `error.download.not_a_torrent` stays reachable only when the
      upload is not encoding and has no stopped encode — the torrent-only path it guards.
- [ ] **REQ-4 (Stopped reads as paused)**: A source with at least one `STOPPED` job, none
      `WAITING`/`QUEUED`/`ENCODING` and none `ERROR` must derive `Download.status = PAUSED`, never
      `ERROR`, with no `lastError`. While any job is still running or queued, the source reads
      `ENCODING`, as `095`'s REQ-8 already states. Its title
      (film, episode, or the episodes of a season pack) must read `PAUSED` through `089`'s
      `TitleStatusService`, and a series follows its episodes as it already does.
- [ ] **REQ-5 (Play resumes the encode)**: `downloadStart` on a source with `STOPPED` jobs must put
      every `STOPPED` job back into the encode queue, behind whatever is already queued, and must not
      call the torrent client. Each resumed job starts from progress 0 and re-encodes its file from
      the beginning; no partial output is reused.
- [ ] **REQ-6 (One encode at a time)**: Stop and Play must never cause two encodes to run at once.
      A resumed job waits its turn in the single encode queue; it never pre-empts the job the worker
      is running.
- [ ] **REQ-7 (A stopped job is never revived by the worker)**: If the worker picks a job up after
      it was stopped (a race between Stop and the queue handing the job out), the job must not run.
      `encodeStarted` for a `STOPPED` job refuses with `error.encode.stopped`; the worker treats that
      refusal as a cancellation — it reports nothing, does not retry, and the job stays `STOPPED`.
- [ ] **REQ-8 (Late reports from a stopped job)**: A report that arrives after Stop, from an encode
      that was already past the point of cancellation:
      - `encodeProgress` for a `STOPPED` job is ignored.
      - `encodeFailed` for a `STOPPED` job is ignored; the job stays `STOPPED`.
      - `encodeCompleted` for a `STOPPED` job is honoured as an ordinary completion — the file has
        already been written to the library (Article XII), so it is the truth.
- [ ] **REQ-9 (Stop does not touch the torrent)**: Stopping or resuming an encode must neither stop
      nor start the source's torrent; the torrent stays in whatever state it was in (seeding today,
      already stopped once `095` stops a torrent on completion) and is not removed.
- [ ] **REQ-10 (web controls)**: `web`'s download row must offer Stop whenever the row reads
      `ENCODING`, and Play whenever it reads `PAUSED`, for a source the caller owns that is not
      retired — torrent or upload. Both buttons call the existing `downloadStart`/`downloadStop`;
      `api` decides whether the encode or the torrent is the target.
- [ ] **REQ-11 (Pause one job)**: The owner can pause one job of a source that is `QUEUED` or
      `ENCODING`. The job becomes `STOPPED`, and if it is the one running its encode is cancelled
      through `047`'s `encode:cancel`. Every other job of the source is untouched, and the next queued
      job, of this source or any other, starts. REQ-6 through REQ-9 apply to it exactly as to a job
      stopped from the parent row.
- [ ] **REQ-12 (Resume one job)**: The owner can resume one `STOPPED` job. It goes to the tail of the
      encode queue and re-encodes from 0, as REQ-5 does for the whole source.
- [ ] **REQ-13 (Stopped in the job list)**: A `STOPPED` job is exposed in `095`'s `DownloadJob.status`
      as `PAUSED`, and counts 0 in `095`'s overall progress (REQ-7 there). `095`'s discard also
      accepts a `STOPPED` job.
- [ ] **REQ-14 (Child-row controls)**: Each child row in `/downloads` offers Pause on a `QUEUED` or
      `ENCODING` job and Play on a `PAUSED` one, under the same ownership, retirement and race-loser
      rules `095` applies to its own child actions.
- [ ] **REQ-15 (A stopped source gives up the race)**: A source with at least one `STOPPED` job and
      none `WAITING`/`QUEUED`/`ENCODING` is not its target's race winner (`087`/`091`). Its paused
      siblings lose their `lostRace` mark and can be resumed with Play, and the next sibling to finish
      downloading — one already attached or one attached afterwards — wins the race and is encoded.
- [ ] **REQ-16 (Resuming a source that lost the race)**: While another source of the same target
      holds the race, Play on a stopped source (`downloadStart`) and resuming one of its stopped jobs
      (`encodeJobStart`) are refused with `error.download.retry_superseded` and change nothing. While
      no source holds it, resuming makes the stopped source the race winner again.
- [ ] **REQ-17 (The new winner sweeps the stopped source)**: When the new winner delivers, the
      stopped source is swept by `091`'s loser sweep exactly like any other loser: its torrent is
      removed with its files, its queue entries are withdrawn, its download folder is deleted and its
      row is removed. Files it had already delivered to the library stay (Article XII). In a season
      pack, an episode the stopped source had already delivered is encoded again by the new winner
      and its library file replaced, as a forced replacement would (`087`); pressing Play on the
      sibling is the user's acceptance.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Stopped is in flight)**: A `STOPPED` job counts as work still in flight everywhere the
      codebase asks that question: the source is not a *delivered source* (`087`/`090`) even if some
      of its jobs are `COMPLETED`, and a replacement that demotes it (an upload, `038`/`090`) closes its
      `STOPPED` jobs as `error.source.replaced` exactly as it closes running ones — never leaving a
      `STOPPED` job open on a demoted or retired source; it is never its target's race winner
      (REQ-15); and the `073`/`076` acquisition sweeps do not acquire a title whose source is stopped. For
      cleanup, a `STOPPED` job is not finished: while one exists the torrent is not removed, the
      download folder is not deleted, and that job's input file is never deleted.
- [ ] **NFR-2 (Boot reconciliation untouched)**: `054`'s worker-boot reconciliation only resets
      `ENCODING` jobs; a `STOPPED` job is never requeued by a worker restart, and is never counted
      toward `recoveryCount`.
- [ ] **NFR-3 (Delete still works)**: `downloadDelete` and `067`'s title removal must unwind a source
      with `STOPPED` jobs exactly as any other — no new refusal.
- [ ] **NFR-4 (Scratch files)**: Stopping must leave no `.part.mkv`/`.working.mkv` behind; the
      cleanup `047`/`054` already perform on cancellation and before every encode is sufficient and
      must be verified, not assumed. Nothing under the destinations root is removed (Article XII).
- [ ] **NFR-5 (Resume failure is reversible)**: If re-enqueueing on Play fails (Redis unreachable),
      the jobs must return to `STOPPED` and the user sees `error.download.retry_enqueue_failed` —
      the same posture `065` already has for resuming a failed encode.
- [ ] **NFR-6 (Migration)**: Adding `STOPPED` to `EncodeStatus` requires no backfill; no existing row
      is or becomes `STOPPED`.

## GraphQL Contract Delta

No new type, field or enum: `EncodeStatus` is not exposed through GraphQL, and `Download.status`
already carries `PAUSED`. `095`'s `DownloadJob.status` (a `String`) gains one value, `PAUSED`
(REQ-13) — `095` REQ-6 lists only `QUEUED`/`ENCODING`/`COMPLETED`/`ERROR`/`DISCARDED`, so every
consumer that switches on it must learn the new value. The rest of the delta is one new mutation,
`encodeJobStop`, behaviour on four existing ones, and two new error keys.

```graphql
type DownloadJob {
  status: String!   # gains PAUSED: QUEUED | ENCODING | PAUSED | COMPLETED | ERROR | DISCARDED (REQ-13)
}

type Mutation {
  downloadStart(mediaSourceId: Int!): Download!   # resumes STOPPED encodes when present (REQ-5)
  downloadStop(mediaSourceId: Int!): Download!    # stops the encode when ENCODING (REQ-1)
  encodeJobStop(processJobId: Int!): Download!    # new: REQ-11; returns the parent row
  encodeJobStart(processJobId: Int!): Download!   # from 095; now also resumes a STOPPED job (REQ-12)
  encodeStarted(processJobId: Int!): String!      # refuses a STOPPED job (REQ-7)
}
```

| Condition | Error | Message the user sees |
| :-- | :-- | :-- |
| `downloadStop`/`downloadStart`: source missing or not owned | `error.source.not_found` (unchanged) | `El medio {id} no existe` |
| `downloadStop` on an upload that is not encoding; `downloadStart` on an upload with no stopped encode and not `ERROR` | `error.download.not_a_torrent` (unchanged, now narrower) | `Esta descarga no tiene un torrent asociado` |
| `downloadStart` on stopped encodes, re-enqueue fails | `error.download.retry_enqueue_failed` (existing key, new trigger) | existing copy |
| `downloadStart` on a retired source / race loser | `error.download.retry_replaced` / `error.download.retry_superseded` (unchanged) | existing copy |
| `downloadStart`/`encodeJobStart` on a stopped source while another source of the target holds the race (REQ-16) | `error.download.retry_superseded` (existing key, new trigger) | existing copy |
| `encodeJobStop`: job missing or not owned / retired / race loser | `error.processJob.not_found` / `error.download.retry_replaced` / `error.download.retry_superseded` (as `095`) | existing copy |
| `encodeJobStop` on a job that is not `QUEUED`/`ENCODING` | `error.processJob.not_running` (new) | `Este archivo no se está codificando` |
| `encodeJobStart` on a job that is neither `STOPPED` nor a retryable `ERROR` | `error.processJob.not_resumable` (from `095`, trigger widened) | `095`'s copy |
| `encodeJobStart` on a stopped job, re-enqueue fails | `error.download.retry_enqueue_failed`; the job returns to `STOPPED` | existing copy |
| `encodeStarted` on a `STOPPED` job | `error.encode.stopped` (new, worker-only, never shown to a user) | — |

Consumers:

- **`web`** — REQ-10 changes when the parent buttons appear. REQ-14 adds Pause/Play to the child
  rows, calling `encodeJobStop`/`encodeJobStart`, and renders `error.processJob.not_running` as the
  row error line. Its `DownloadJob` type and the child row's status badge must accept `PAUSED`.
  REQ-15/16 need no new handling: `Download.lostRace` already drives which rows offer Play, and it
  now flips when a source is stopped or resumed. Every other error is rendered as today.
- **`worker`** — must recognise `error.encode.stopped` from `encodeStarted` and treat it as a
  cancellation (REQ-7): no `encodeFailed`, no BullMQ retry. It widens the arm `095` adds for
  `error.encode.discarded`; it does not add a second one. Any other `encodeStarted` failure keeps
  today's handling.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `EncodeStatus` (enum) | add `STOPPED` | — | No (NFR-6) |

## Acceptance Criteria

- [ ] **AC-1**: Given a film whose torrent source is `ENCODING` at 30%, when the user presses Stop
      on its row in `/downloads`, then within a few seconds no `ffmpeg` process is running in the
      `worker` container, the row and the film read `PAUSED` with no error line, and qBittorrent
      still lists the torrent in the same state it had before Stop (seeding, or stopped once `095`
      ships).
- [ ] **AC-2**: Continuing AC-1, when the user presses Play, then the row reads `ENCODING` again and
      its encode progress restarts from 0%; once finished the film reads `COMPLETED` and the file is
      in the library.
- [ ] **AC-3**: Given an uploaded file whose encode is running, the row shows a Stop button; Stop
      leaves it `PAUSED` with a Play button, and Play resumes it as in AC-2.
- [ ] **AC-4**: Given a season pack with episodes 1–2 `COMPLETED`, episode 3 `ENCODING` and 4–8
      queued, when the user presses Stop, then episodes 1–2 stay `COMPLETED` and their files stay in
      the library, episodes 3–8 read `PAUSED`, and `bin/mysql -e "select status, count(*) from
      ProcessJob where sourceFileId in (…) group by status"` shows 2 `COMPLETED` and 6 `STOPPED`.
- [ ] **AC-5**: Given film A encoding and film B queued behind it, when the user stops A and then
      presses Play on A, then B starts encoding first and A only after B finishes — never both at once.
- [ ] **AC-6**: Given a stopped encode, when `bin/stop` then `bin/dev -d` restarts the stack, then the
      job is still `STOPPED` and the title still `PAUSED` — the worker's boot does not requeue it.
- [ ] **AC-7**: Given a stopped encode, `docker compose exec worker ls` on the output folder and the
      download folder shows no `.part.mkv`/`.working.mkv` left behind.
- [ ] **AC-8 (failure path)**: Given a stopped encode and `redis` stopped, when the user presses
      Play, then the row shows the `retry_enqueue_failed` message, the job is still `STOPPED`, and
      once `redis` is back a second Play resumes it.
- [ ] **AC-9 (failure path)**: Given a film with no file and a stopped encode, inside an open
      `076` acquisition window, when the `acquire_movies` task runs from Settings, then it skips the
      film — no new `MediaSource` row appears and the film still reads `PAUSED`.
- [ ] **AC-15**: Given a film with a stopped encode, when the user uploads a replacement file, then
      the stopped source reads `ERROR` with `error.source.replaced`, `bin/mysql` shows none of its
      `ProcessJob`s still `STOPPED`, and the film follows the upload's encode.
- [ ] **AC-10 (race)**: Given a job stopped while it was still queued, if the worker dequeues it
      anyway, the worker log shows it abandoned on `error.encode.stopped`, no `ffmpeg` process starts,
      and the job stays `STOPPED`.
- [ ] **AC-11**: Given a torrent source still `DOWNLOADING`, Stop and Play behave exactly as before
      this feature (the torrent pauses and resumes in qBittorrent).
- [ ] **AC-12**: Given a season pack with episode 4 encoding and 5–8 queued, pausing episode 4 from
      its child row stops `ffmpeg` within a few seconds and episode 5 starts. Episode 4 reads `PAUSED`
      in its child row and on the series page, and the parent keeps reading `ENCODING`.
- [ ] **AC-13**: Continuing AC-12, after episodes 5–8 finish the torrent is still in qBittorrent and
      episode 4's input file is still on disk. The parent reads `PAUSED`. Resuming episode 4 encodes
      it from 0, and when it finishes the torrent is removed and the download folder deleted.
- [ ] **AC-14 (failure path)**: Calling `encodeJobStop` on a `COMPLETED` job through the GraphQL
      endpoint returns `error.processJob.not_running` and changes nothing.
- [ ] **AC-16 (race, unchanged)**: Given a film with three torrent sources A, B and C, when B finishes
      downloading first, then A and C read `PAUSED` with the race-loser mark and B encodes. When B's
      encode finishes, A and C are gone from `/downloads`, from qBittorrent and from the downloads
      folder; B's torrent and download folder are gone too; B's row reads `COMPLETED` and the file is
      in the library.
- [ ] **AC-17 (race, stopped winner)**: Same start as AC-16. While B encodes, the user stops it. A
      and C lose the race-loser mark and show Play. The user presses Play on C; C finishes downloading
      and encodes, and B stays `PAUSED`. When C's encode finishes, A and B are gone from `/downloads`,
      from qBittorrent and from the downloads folder, C's torrent and download folder are gone, C's
      row reads `COMPLETED` and the film reads `COMPLETED`.
- [ ] **AC-18 (failure path)**: Continuing AC-17 while C is encoding, pressing Play on B shows the
      `retry_superseded` message, and B's jobs stay `STOPPED`.

## Out of Scope

- **Resuming an encode where it stopped.** FFmpeg cannot continue a single-file AV1 encode midway;
  doing so would mean segmenting the encode and concatenating, a change to the encoder itself.
  A resumed job re-encodes from the start (decided).
- **A global pause of the whole encode queue.** An admin switch that freezes every encode was
  considered and not requested; Stop is per source or per job.
- **Stopping a scan.** A source in `READY` (the worker inventorying files) has no Stop; scans are
  short and `065` already recovers a scan that throws.
- **Controlling the torrent while encoding.** During `ENCODING` the row's buttons belong to the
  encode; the torrent is not controllable from the row at that moment (`095` stops it on completion
  anyway).

---
title: Per-file breakdown of multi-file sources
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-10-17
last_updated: 2026-10-17
status: Implemented
services: [api, web, worker]
---

# SPEC: Per-file breakdown of multi-file sources (`spec.md`)

## Context & Goal

A season pack already fans out into one `ProcessJob` per episode once the worker scans it (`013`),
and the encode queue runs them one at a time. None of that is visible. `/downloads` lists one
`Download` row per `MediaSource`, so an eight-episode pack is a single row whose `encodeProgress`
is the mean of its jobs (`services/api/src/pipeline-status/pipeline-status.ts`,
`deriveSourceStatus`). The user cannot see which episode is encoding, which ones are done, or which
one failed. One bad file in a pack turns the whole row `ERROR` the moment it fails, even while the
other seven are still encoding. The only way to deal with that one file is Play on the whole row
(`065`) or Delete on the whole source (`047`).

Separately, a torrent keeps seeding after it finishes downloading, until the last job's
`encodeCompleted` tells the worker to remove it (`removeTorrent`,
`services/api/src/process-jobs/process-jobs.service.ts`). Meanwhile the worker deletes each
episode's input file as it is consumed (`deleteInputFile`), so the torrent seeds a folder that
shrinks underneath it. Nothing in Perceptor needs that seeding.

Once this ships, a finished torrent is stopped in qBittorrent, not removed, and it is still removed
when the last job finishes, exactly as today. A source with more than one job shows a chevron in
`/downloads` once it has been scanned. Expanding it lists one child row per file, each with its own
status, progress and speed, plus two actions: retry a failed file and discard a file. The parent row
keeps an overall progress. A single-file source (a film, a single episode, a single upload) looks
exactly as it does today. This changes the **Download** stage (completion stops the torrent), the
**Transcode** stage (a new discarded outcome per file) and **Browse library**'s `/downloads` view.
No stage is added or removed.

Pausing and resuming an encode, whether for the whole source or for one file, is
`097-encode-stop`'s subject, not this spec's. This spec is implemented first, and `097` adds its
buttons to the child rows this spec creates.

## Requirements

### Functional Requirements

#### Torrent on completion

- [ ] **REQ-1 (Stop on completion)**: When a torrent source finishes downloading and wins its race
      (`torrentCompleted`, outcome `WON`), `api` must stop it in the torrent client. It is not
      removed, and its files stay on disk. A source that loses the race keeps today's handling.
- [ ] **REQ-2 (Removal unchanged)**: The torrent must still be removed when the source has no job
      left in flight, through the same cleanup that removes it today. This spec changes only *when*
      seeding ends, not when the torrent disappears.
- [ ] **REQ-3 (Stop failure is not fatal)**: If stopping the torrent fails, the source must still
      proceed to the scan. The failure is logged and nothing is written to `ERROR`.

#### Job list

- [ ] **REQ-4 (Jobs on the row)**: Every `Download` must carry the list of its `ProcessJob`s, ordered
      by season then episode number for an episode target. The list is empty before the scan
      (`PENDING`/`QUEUED`/`DOWNLOADING`/`PAUSED`/`READY`). Each job exposes its id, a label, its
      status, its progress, its encode speed, its last error and whether it can be retried.
- [ ] **REQ-5 (Job label)**: An episode job's label is `S<NN>E<NN> · <episode title>`, with the title
      read from `api`'s episode row, never the filename (`013`). A film job's label is the film title.
- [ ] **REQ-6 (Job status vocabulary)**: A job's status as exposed is one of `QUEUED` (stored
      `WAITING` or `QUEUED`), `ENCODING`, `COMPLETED`, `ERROR` or `DISCARDED`. `encodeSpeed` is
      non-null only while the job is `ENCODING` (`053`).

#### Parent row derivation

- [ ] **REQ-7 (Overall progress)**: A scanned source's `encodeProgress` must be the sum of its jobs'
      progress divided by the number of jobs that are not `DISCARDED`. A `COMPLETED` job counts 100,
      and an `ERROR` job counts 0. `DISCARDED` jobs are excluded from both sides.
- [ ] **REQ-8 (One failure does not stop the parent)**: While at least one job is `QUEUED` or
      `ENCODING`, the source must derive `ENCODING`, even if another job is `ERROR`. Otherwise, if
      any job is `ERROR`, it derives `ERROR` with that job's error as `lastError`, as today (decided:
      a finished pack with a failure reads `ERROR`, so the failure stays visible). A source whose
      jobs are all `COMPLETED` or `DISCARDED`, with at least one `COMPLETED`, derives `COMPLETED`.
- [ ] **REQ-9 (All discarded)**: A source whose jobs are all `DISCARDED` must derive a new
      `Download.status` value, `DISCARDED`. Such a row offers only Delete (decided: discarding the
      last remaining job is allowed rather than refused).
- [ ] **REQ-10 (Parent Play on a failed pack)**: The parent row's Play on an `ERROR` source keeps
      `065`'s behaviour and retries every `ERROR` job of the source at once. Discarding the whole
      source remains Delete (`047`); the parent has no discard.

#### Per-job actions

- [ ] **REQ-11 (Retry a job)**: The owner can retry one `ERROR` job whose `retryable` is true. It goes
      to the tail of the encode queue from the stage that failed, as `065` resumes a failed encode,
      without touching the source's other jobs or the torrent.
- [ ] **REQ-12 (Discard a job)**: The owner can discard one job that is `QUEUED`, `ENCODING` or
      `ERROR`, after confirming in a dialog. Discarding:
      - cancels the encode if the job is the one running, through `047`'s `encode:cancel`;
      - withdraws the job from the encode queue;
      - deletes that job's input file, which lies under the downloads root (Article XII; a path
        outside it is never removed);
      - leaves the job `DISCARDED`. It is never retried again, and re-adding the same release does
        not revive it.
- [ ] **REQ-13 (A discarded job is never run)**: If the worker dequeues a job after it was discarded
      (a race between the discard and the queue handing the job out), the job must not run.
      `encodeStarted` for a `DISCARDED` job refuses with `error.encode.discarded`. The worker treats
      that refusal as a cancellation: it reports nothing, does not retry, and the job stays
      `DISCARDED`.
- [ ] **REQ-14 (Late reports from a discarded job)**: A report that arrives after the discard, from an
      encode that was already past the point of cancellation:
      - `encodeProgress` for a `DISCARDED` job is ignored.
      - `encodeFailed` for a `DISCARDED` job is ignored; the job stays `DISCARDED`.
      - `encodeCompleted` for a `DISCARDED` job is honoured as an ordinary completion. The file is
        already in the library (Article XII), so it is the truth.
- [ ] **REQ-15 (Discarded episode reads as never brought)**: A `DISCARDED` job's episode or film must
      derive its status as if this source had never brought it, through `089`'s `TitleStatusService`.
      Typically that is `MISSING`, unless another source or the media server says otherwise. Attaching
      a source to that episode afterwards behaves as for an episode this source never covered. The
      `073`/`076` sweeps may acquire it like any other missing title (decided: discard means "not
      this file", not "never this episode").
- [ ] **REQ-16 (Completed jobs are final)**: A `COMPLETED` or `DISCARDED` job offers no action, and
      every per-job mutation on one is refused. A completed file lives in the library and is never
      removed (Article XII).

#### Cleanup

- [ ] **REQ-17 (Discarded is terminal)**: A `DISCARDED` job counts as finished for cleanup. The torrent
      is removed once no job is `QUEUED` or `ENCODING`. The download folder is deleted once every job
      is `COMPLETED` or `DISCARDED` and the source has no unmatched files. Today that rule requires
      every job to be `COMPLETED`.
- [ ] **REQ-18 (Cleanup triggered by any terminal transition)**: When the transition that leaves the
      source with no job in flight is a discard, not an `encodeCompleted`, the same cleanup must
      still run. A pack whose last pending episode is discarded removes its torrent, and its folder
      if REQ-17 allows.

#### web

- [ ] **REQ-19 (Chevron)**: Every view that lists `Download` rows (`/downloads` and the download panel
      on a film's or series' detail page) must show a chevron on a row whose job list has two or more
      entries, collapsed by default. A row with zero or one job shows no chevron and keeps today's
      layout.
- [ ] **REQ-20 (Child rows)**: Expanding the row lists one child per job, with its label, status
      badge, progress bar (none for `DISCARDED`), speed and the actions REQ-11 and REQ-12 allow for
      that status. Actions are shown only when the caller owns the source and it is neither retired
      (`090`) nor a race loser (`091`). A `DISCARDED` child is shown struck through. An `ERROR`
      child shows its error line.
- [ ] **REQ-21 (Parent progress label)**: The parent row's encode progress shows REQ-7's percentage
      and an `N de M` label, where N is the number of `COMPLETED` jobs and M the number of
      non-`DISCARDED` jobs.
- [ ] **REQ-22 (Discard dialog)**: Discard opens a confirmation dialog naming the file's label and
      stating that its downloaded file is deleted, that it will not be encoded, that the episode
      goes back to missing, and that the rest of the source is unaffected.
- [ ] **REQ-23 (Copy)**: Every new string comes from `messages/{en,es}.json`. Every new error is
      rendered through its `extensions.i18n` key.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Race and delivery)**: A source whose jobs are all `DISCARDED` is neither its target's
      race winner (`087`/`091`) nor a delivered source (`087`/`090`).
- [ ] **NFR-2 (Live torrent reads)**: A torrent stopped after completion must keep deriving as
      completed in every live read (`089`, REQ-9). Its state is never read as a user pause of the
      download, and never written back as `PAUSED` on the source.
- [ ] **NFR-3 (Boot reconciliation)**: `054`'s worker-boot reconciliation never requeues a `DISCARDED`
      job and never counts one toward `recoveryCount`.
- [ ] **NFR-4 (Delete still works)**: `downloadDelete` and `067`'s title removal unwind a source with
      `DISCARDED` jobs exactly as any other source.
- [ ] **NFR-5 (Discard file failure)**: If deleting the input file fails, the job is still `DISCARDED`
      and the failure is logged. A missing file is not an error.
- [ ] **NFR-6 (Retry failure is reversible)**: If re-enqueueing a retried job fails (Redis
      unreachable), the job must return to `ERROR` with its previous error, and the user sees
      `error.download.retry_enqueue_failed`. That is `065`'s posture.
- [ ] **NFR-7 (Migration)**: Adding `DISCARDED` to `EncodeStatus` needs no backfill. No existing row is
      or becomes `DISCARDED`.
- [ ] **NFR-8 (No polling added)**: The child rows refresh exactly when the parent row does today.
      This spec adds no polling.

## GraphQL Contract Delta

```graphql
type DownloadJob {
  processJobId: Int!
  label: String!
  episodeId: Int
  seasonNumber: Int
  episodeNumber: Int
  status: String!          # QUEUED | ENCODING | COMPLETED | ERROR | DISCARDED (REQ-6)
  progress: Float!         # 0..100
  encodeSpeed: Float       # non-null only while ENCODING
  lastError: DownloadError
  retryable: Boolean!
}

type Download {
  # ...every existing field unchanged...
  status: String!          # gains the value DISCARDED (REQ-9)
  jobs: [DownloadJob!]!    # empty before the scan (REQ-4)
}

type Mutation {
  encodeJobStart(processJobId: Int!): Download!    # REQ-11: retries an ERROR job; returns the parent row
  encodeJobDiscard(processJobId: Int!): Download!  # REQ-12
  encodeStarted(processJobId: Int!): String!       # unchanged signature; refuses a DISCARDED job (REQ-13)
}
```

`encodeJobStart` is named after `downloadStart`, which today also retries an `ERROR` source.
`097` widens it to resume a paused job and adds `encodeJobStop`; neither belongs to this spec.
`torrentCompleted` keeps its signature, and its behaviour gains REQ-1.

| Condition | Error | Message the user sees |
| :-- | :-- | :-- |
| `encodeJobStart`/`encodeJobDiscard`: job missing, or its source not owned by the caller | `error.processJob.not_found` (existing key, new trigger) | existing copy |
| `encodeJobStart`/`encodeJobDiscard`: the source is retired (`090`) | `error.download.retry_replaced` (existing) | existing copy |
| `encodeJobStart`/`encodeJobDiscard`: the source lost its race (`091`) | `error.download.retry_superseded` (existing) | existing copy |
| `encodeJobStart` on a job that is not a retryable `ERROR` | `error.processJob.not_resumable` (new) | `Este archivo no se puede reintentar` |
| `encodeJobDiscard` on a `COMPLETED` or `DISCARDED` job | `error.processJob.not_discardable` (new) | `Este archivo ya no se puede descartar` |
| `encodeJobStart`: re-enqueue fails (Redis unreachable) | `error.download.retry_enqueue_failed` (existing key, new trigger) | existing copy |
| `encodeStarted` on a `DISCARDED` job | `error.encode.discarded` (new, worker-only, never shown to a user) | — |

Consumers:

- **`web`**: retypes `DownloadJob`, `Download.jobs` and the new `DISCARDED` status, which gets a
  `StatusBadge` entry and copy. It calls the two mutations and renders the two new user-facing keys
  and the reused ones as the row error line it already shows.
- **`worker`**: must recognise `error.encode.discarded` from `encodeStarted` and treat it as a
  cancellation (REQ-13): no `encodeFailed`, no BullMQ retry. Any other `encodeStarted` failure keeps
  today's handling. Cleanup instructions keep their shape, and the worker still executes whatever
  `api` returns. The cleanup a discard triggers (REQ-18) is run by `api` itself, because no worker
  job is running for it.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `EncodeStatus` (enum) | add `DISCARDED` | — | No (NFR-7) |

## Acceptance Criteria

- [ ] **AC-1**: Given a season-pack torrent that finishes downloading, qBittorrent shows it stopped
      (not seeding, not removed) while its episodes encode, and the `/downloads` row reads
      `ENCODING`, not `PAUSED`. Once the last episode finishes, the torrent is gone from qBittorrent.
- [ ] **AC-2**: Given that same pack, while still downloading its row has no chevron. After the scan
      it has one, collapsed. Expanding shows eight children labelled `S01E01 · <title>` …
      `S01E08 · <title>` in order, with titles matching TMDB's rather than the filenames. The same
      chevron appears in the series detail page's download panel.
- [ ] **AC-3**: With episodes 1–3 `COMPLETED` and episode 4 at 50%, the parent reads `3 de 8` and 44%.
- [ ] **AC-4**: Discarding episode 6 while queued, after the confirmation dialog: its input file is
      gone from the downloads folder, its child row reads `DISCARDED` struck through, the parent
      label becomes `N de 7`, and the series page shows episode 6 as missing.
- [ ] **AC-5**: Discarding episode 4 while it is encoding stops `ffmpeg` within a few seconds, the
      next queued episode starts, and no `.part.mkv` is left behind.
- [ ] **AC-6**: Given a pack whose only non-completed episode is discarded, the torrent is removed and
      the download folder deleted at that moment, with no further encode needed (REQ-18).
- [ ] **AC-7**: Given a single-episode source with one job, discarding it leaves the row `DISCARDED`
      with only Delete. The episode reads missing, and a new torrent can be attached to it without
      the replacement warning.
- [ ] **AC-8 (failure path)**: Given episode 3 failing with `error.encode.no_video_stream` while
      episodes 4–8 are queued, the parent keeps reading `ENCODING` and episodes 4–8 keep encoding.
      Episode 3's child shows its error and a Retry. Once 4–8 finish, the parent reads `ERROR`.
      Retrying episode 3 runs only episode 3.
- [ ] **AC-9 (failure path)**: Calling `encodeJobDiscard` on a `COMPLETED` job through the GraphQL
      endpoint returns `error.processJob.not_discardable`, and the library file is untouched.
- [ ] **AC-10 (failure path)**: With `redis` stopped, retrying an `ERROR` job shows the
      `retry_enqueue_failed` message and the job is still `ERROR` with its original error line. Once
      `redis` is back, a second retry works.
- [ ] **AC-11 (race)**: Given a job discarded while still queued, if the worker dequeues it anyway,
      the worker log shows it abandoned on `error.encode.discarded`, no `ffmpeg` process starts, and
      the job stays `DISCARDED`.
- [ ] **AC-12**: A film source, a single-episode source and a single upload show no chevron, and
      their row looks and behaves as before, except that the torrent is already stopped rather than
      seeding (REQ-1).
- [ ] **AC-13**: A user who does not own the title sees the children but no action buttons, and a
      direct `encodeJobDiscard` call returns `error.processJob.not_found`.

## Out of Scope

- **Pausing and resuming an encode**, for the whole source or for one file. That is `097`'s subject.
  `097` adds `STOPPED`, `encodeJobStop`, and the paused case of `encodeJobStart`.
- **Reordering the encode queue.** A retried job goes to the tail. There is no "encode this one next".
- **Undoing a discard.** The input file is gone, so the only way back is re-acquiring the episode.
- **Seeding as an option.** Stopping a finished torrent is unconditional. A setting to keep seeding
  (private-tracker ratio) was considered and not requested.
- **Choosing files before the download.** Deselecting episodes in qBittorrent before or during the
  download stays as `052` handles it today. Discard acts only after the scan.
- **A chevron before the scan.** The row has no file list until the worker inventories the source.

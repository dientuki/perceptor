---
title: Pipeline Error Visibility and Resume
spec_version: 0.3.0
author: Juan "Dientuki" Farias
created_at: 2026-09-19
last_updated: 2026-09-19
status: Approved
services: [api, web, worker]
---

# SPEC: Pipeline Error Visibility and Resume (`spec.md`)

## Context & Goal

When something goes wrong between "torrent added" and "file in the library", the pipeline stops and
nothing brings it back. The failure is usually transient and outside Perceptor's control — the disk
filled up while qBittorrent was writing, or while FFmpeg was writing the output, or the downloads
volume was briefly unmounted when the worker tried to scan it — and once the operator fixes the
cause, the only way forward today is to delete the source and acquire the title again from scratch:
re-search, re-download gigabytes that are already on disk, re-scan. The downloads panel
(`services/web/src/components/downloads/DownloadRow.tsx`) shows a red `ERROR` badge and nothing
else; it never says *what* failed, and its Play button (`downloadStart`,
`services/api/src/downloads/downloads.service.ts`) only resumes the torrent in qBittorrent — on a
source whose encode failed that is a no-op, and on an uploaded file (`infoHash: null`) the button is
not even rendered.

The information is mostly already there. `MediaSource.errorKey`/`errorParams`/`errorMessage` are
written by `sourceScanned`'s empty-match branch (`052`), by `handleTorrentCompleted`'s
missing-path branch and by the `027` force demotion; `ProcessJob.errorKey`/`errorParams`/
`errorMessage` are written by `encodeFailed` (`018`, `038`) and by `054`'s recovery exhaustion. None
of it crosses the GraphQL boundary — `Download` has no error field, and `ProcessJob`'s key is
documented as "not exposed on any GraphQL type". Two failures are not recorded anywhere at all: a
torrent qBittorrent itself put in its `error`/`missingFiles` state (disk full during download) is
only visible as a raw `torrentState` string, and a scan the worker could not complete — the
downloads folder unreadable, no `downloadPath`, any throw in `services/worker/src/jobs/
source-ready.job.ts` before it reaches `sourceScanned` — is logged in the worker and never reported
to `api`, so the source sits at `READY` and the row reads `DOWNLOADED` forever with no error at all.

This feature closes the loop in three moves. Every download row carries its **last error** — which
stage failed (download, scan or encode) and the translated reason. **Play on a row in `ERROR`
resumes from the stage that failed**, reusing everything already on disk: a failed encode is
re-queued from the file the scan already found, a failed scan is re-scanned from the folder the
torrent already filled, a torrent the client stopped on an I/O error is resumed in the client — the
example that motivated this: the file downloaded, the encode died for lack of space, the operator
frees space, presses Play, and the encode starts over without anything being downloaded again. And
two holes that end the cycle *silently* are fixed: the worker reports a failed scan to `api`, and a
source whose encode failed stops counting as its target's race winner, so a second source added for
the same title is processed instead of ignored (`022`'s arbiter, `resolveRace`). The "Download",
"Detect completion, enqueue", "Scan files" and "Transcode" rows of the root `CLAUDE.md` pipeline
table each gain a resume path; no stage is added or removed.

## Requirements

### Functional Requirements

#### Showing the last error

- [ ] **REQ-1 (Last error on the row)**: Every `Download` whose derived `status` is `ERROR` must carry
      its last error: the stage that failed (`DOWNLOAD`, `SCAN`, `ENCODE`, or `REPLACED` — REQ-2), a translation key, its
      interpolation params, and the English rendered message. A row whose status is not `ERROR`
      carries no error, even if an earlier, since-resumed failure left one stored.
- [ ] **REQ-2 (Which error is "last")**: When a source has more than one stored error (its own plus
      one or more of its `ProcessJob`s — a season pack whose several episodes failed), the row
      reports the most recently written one. A job error is stage `ENCODE`; a source error is stage
      `SCAN`, except `error.source.no_download_path` (stage `DOWNLOAD`) and `error.source.replaced`
      (stage `REPLACED`). `REPLACED` is not a pipeline stage that failed — it records that the user
      discarded this source in favour of another (`027`'s force, or an upload's demotion) — and is
      its own value so `web` can say "replaced" rather than naming a stage that never failed. A job
      carrying `error.source.replaced` (an upload's demotion closes the jobs with that key too) is
      stage `REPLACED` as well, not `ENCODE`.
- [ ] **REQ-3 (Torrent client errors)**: A torrent source with no stored error whose live
      qBittorrent state is `error` or `missingFiles` must report stage `DOWNLOAD` with a new key,
      `error.download.torrent_client_error`, whose params carry the raw state. qBittorrent exposes no
      error text through `torrents/info`, so the message says the client stopped the torrent and
      names the usual causes (disk full, permissions, missing files) rather than the exact one.
- [ ] **REQ-4 (Retryable flag)**: Every `Download` must carry whether Play will resume it
      (`retryable`), computed by `api` with the same rule `downloadStart` applies (REQ-6..REQ-10), so
      `web` never re-implements it.
- [ ] **REQ-5 (Error shown in the panel)**: `web` must render the last error on the row — the stage
      and the translated message — in both the per-title panels (`/movies/[id]`, `/shows/[id]`) and
      any other page that renders `DownloadRow` (`064`'s global page, if it has landed). An unknown
      key (a newer `worker` than `web`'s catalog) falls back to the English `message`, never to a
      raw key or an empty cell.

#### Resuming with Play

- [ ] **REQ-6 (Play resumes an ERROR row)**: `downloadStart` on a source whose derived status is
      `ERROR` and that is `retryable` must resume the pipeline from the stage that failed, and only
      that stage — never re-download what is on disk, never re-scan what was already scanned. On a
      row that is not in `ERROR` its behaviour is unchanged (resume the torrent in qBittorrent).
- [ ] **REQ-7 (Resume from ENCODE)**: For a last error at stage `ENCODE`, every `ProcessJob` of the
      source currently in `ERROR` is reset (progress, speed and stored error cleared, `054`'s
      `recoveryCount` reset to `0`, since a manual retry is a fresh attempt, not an automatic one)
      and re-queued for encoding from its existing `SourceFile`. `COMPLETED` jobs of the same source
      (the episodes of a season pack that did succeed) are not touched.
- [ ] **REQ-8 (Resume from SCAN)**: For a last error at stage `SCAN`, the source's stored error is
      cleared and it is re-queued for scanning from its existing `downloadPath`, exactly as if its
      completion had just been detected — including the `052` downloaded-files narrowing, so a user
      who fixed the file selection in qBittorrent after `error.source.scan_no_downloaded_video` gets
      a correct scan.
- [ ] **REQ-9 (Resume from DOWNLOAD)**: For a torrent client error (REQ-3), the torrent is resumed
      in qBittorrent (today's `downloadStart`); when it later completes, the existing completion
      notice carries it forward as for any torrent. `error.source.no_download_path` is **not**
      resumable: `downloadPath` is the per-torrent save path fixed when the torrent is added, never
      read back from the client, so the error only exists on rows that predate per-torrent save
      paths and there is nothing a resume could recover it from (REQ-10).
- [ ] **REQ-10 (Not retryable)**: `downloadStart` on an `ERROR` source must refuse, and `retryable`
      must be `false`, when: the source was replaced (`error.source.replaced`, `027`'s force
      demotion or an upload's demotion — resuming it would resurrect a loser the user explicitly
      discarded); another source of the same target has since won the race — reached
      `READY`/`SCANNED` after this one failed (REQ-13) — so two sources would write the same title; or the stage that failed needs something the
      source no longer has (`error.source.no_download_path`, resume-from-scan with no
      `downloadPath`, resume-from-download on an upload).
- [ ] **REQ-11 (Uploads resume too)**: An uploaded source (`infoHash: null`) in `ERROR` at stage
      `SCAN` or `ENCODE` is resumable through the same `downloadStart`. `web` must render Play on
      such a row; Stop stays torrent-only. An upload that is not in `ERROR` still has nothing to
      start, and `downloadStart` on it still raises `error.download.not_a_torrent`.
- [ ] **REQ-12 (Title status follows)**: A successful resume must lift the target's stored status
      (`Movie.status`, `Episode.status`; the episodes of a season pack) out of `ERROR` to what the
      source now is — `ENCODING` for REQ-7, `DOWNLOADING` for REQ-8/REQ-9 — so the library, the
      billboard, the calendar (`062`) and the title's own badge stop reading `ERROR` the moment Play
      is pressed, not only after the encode finishes. It must never walk a title that is already
      `COMPLETED` backwards (`047`'s recompute rule).

#### Closing the silent ends

- [ ] **REQ-13 (A failed encode is not a race winner)**: The race arbiter must not treat a sibling as
      its target's winner when that sibling is `SCANNED`, at least one of its `ProcessJob`s is in
      `ERROR`, and none is still `WAITING`/`QUEUED`/`ENCODING`. A second source added for a title
      whose first source failed to encode is then processed normally when it completes, instead of
      being ignored with no error anywhere. This holds for a **partially failed season pack** too:
      a pack where some episodes encoded and others failed stops being its season's winner, and a
      new pack for the same season, once complete, wins and is processed in full — every episode it
      resolves is re-encoded, including the ones the old pack already put in the library, whose
      files the new encode overwrites (the same overwrite `027-replace-completed-media` already
      performs; nothing is deleted, Article XII). The old source stays in `ERROR` (visible,
      deletable) and, once the new source has won, is non-retryable (REQ-10). A sibling that still
      has an encode in flight keeps winning — two sources never encode the same target at once.
- [ ] **REQ-14 (Worker reports a failed scan)**: When the worker's scan of a source fails for any
      reason before it can report matches — no `downloadPath`, no target, the folder unreadable, an
      unexpected throw — it must report the failure to `api` with a translation key, params and an
      English message, the same way `encodeFailed` reports a failed encode. `api` marks the source
      `ERROR` with that error and the target `ERROR`, exactly as `sourceScanned`'s empty-match branch
      already does. An unclassified throw uses a catch-all key carrying the raw message as a param.
- [ ] **REQ-15 (Scan report durability)**: The scan-failure report must survive a transiently
      unreachable `api` the same way `encodeFailed` does (`038`, `deliverReport`): retried until
      acknowledged, idempotent on `api`'s side, and a report for a source that no longer exists
      (deleted mid-scan, `047`) is acknowledged and ignored rather than retried forever.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No re-download, ever)**: No resume path may remove a torrent from the client, delete
      anything under the downloads root, or re-add a torrent. Resuming only re-queues work on what is
      already there.
- [ ] **NFR-2 (Idempotent Play)**: Pressing Play twice, or from two browser tabs, must not queue the
      same encode or scan twice. The second call finds the source no longer in `ERROR` and behaves as
      Play on a non-error row does.
- [ ] **NFR-3 (Enqueue before status)**: A resume whose re-queue fails (Redis unreachable) must leave
      the source, its jobs and its title exactly as they were — still `ERROR`, still showing the
      error — and raise, never flip a row to `QUEUED`/`ENCODING` ahead of a confirmed enqueue
      (`054`'s ordering, and its warning that BullMQ silently refuses a second entry under an id that
      still exists).
- [ ] **NFR-4 (Stored errors are kept until resumed)**: The stored error on a source or job is only
      cleared by the resume that re-queues it, never by a read. Deleting a source (`047`) still
      removes it with the row.
- [ ] **NFR-5 (Library never deleted)**: Resuming an encode (REQ-7) only re-encodes jobs that never
      produced a library file, so it writes nothing that already exists there beyond the worker's own
      `.part.mkv`/`.working.mkv` scratch (cleared before every encode since `054`). The one case that
      overwrites a library file is REQ-13's new season pack re-encoding an episode the old pack
      already completed — an overwrite through the existing atomic rename, never a delete
      (Article XII).
- [ ] **NFR-6 (No migration)**: Every column this feature reads already exists
      (`MediaSource.errorKey`/`errorParams`/`errorMessage`/`updatedAt`, the same on `ProcessJob`).
      No Prisma migration.
- [ ] **NFR-7 (Ownership unchanged)**: `downloadStart` keeps its ownership scope — resuming a source
      is refused exactly where starting it is refused today, including on `064`'s global page for a
      title outside the caller's library.

## GraphQL Contract Delta

```graphql
type DownloadError {
  stage: String!      # "DOWNLOAD" | "SCAN" | "ENCODE" | "REPLACED" — plain String!, like Download.status
  key: String!        # i18n key, e.g. "error.encode.unexpected"
  params: String      # JSON-encoded object, or null when the key takes none
  message: String!    # English, already rendered — the fallback for an unknown key
}

type Download {
  # ...unchanged fields...
  lastError: DownloadError   # non-null if and only if status == "ERROR"
  retryable: Boolean!        # whether downloadStart will resume this row; always false when
                             # status != "ERROR" (Play there keeps today's meaning)
}

type Mutation {
  # Signature unchanged. Behaviour widened: on a retryable ERROR row it resumes the stage that
  # failed (REQ-6..REQ-9), and it now accepts an upload in ERROR (REQ-11).
  downloadStart(mediaSourceId: Int!): Download!

  # New, @AllowService() — called by the worker only (REQ-14). Returns true once recorded or
  # ignored (source gone); never errors on a repeat report.
  sourceScanFailed(mediaSourceId: Int!, errorKey: String!, errorParams: String, errorMessage: String!): Boolean!
}
```

What the schema cannot say:

- **`lastError.params` is a JSON-encoded string, not an object.** It is stored that way
  (`errorParams @db.Text`) and there is no JSON scalar in this schema. This is the opposite of the
  error envelope's `extensions.i18n.params`, which *is* an object — the exact confusion `059` found
  and fixed in `web`'s `translateGraphQLError`. `web` must `JSON.parse` this field, guard the parse,
  and render the key without params (or the English `message`) if it fails.
- **`retryable` is the rule, not a hint.** `web` shows Play on an `ERROR` row if and only if
  `retryable` is true, and on a non-`ERROR` row by today's `infoHash != null` test. It never derives
  retryability from `lastError.key` or `stage`.
- **`lastError.key` can be a `worker`-owned key** (`error.encode.*`, `error.ffprobe.*`, …) as well
  as an `api`-owned one. Every key that can reach this field must exist in both
  `services/web/messages/{en,es}.json`.
- **`sourceScanFailed` is service-only in practice**: a signed-in user calling it could mark any
  source `ERROR`. Like `encodeWorkerStarted` (`054`), the resolver must reject a non-service
  principal explicitly, not rely on `@AllowService()` alone.

Errors from `downloadStart` (existing rows unchanged, new rows marked):

| Condition | Error | Message the user sees |
| :-- | :-- | :-- |
| `mediaSourceId` missing, or not owned by the caller | `error.source.not_found` | `El medio {id} no existe` |
| Upload not in `ERROR` — nothing to start | `error.download.not_a_torrent` | (unchanged) |
| Torrent client rejects or is unreachable | `error.download.torrent_client_rejected` | `El cliente de torrents rechazó la solicitud ({status})` |
| **new** — source was replaced (`error.source.replaced`) | `error.download.retry_replaced` | `Este medio fue reemplazado por otro y no se puede retomar` |
| **new** — another source of the same title is now its winner | `error.download.retry_superseded` | `Otra fuente de este título ya se está procesando` |
| **new** — the failed stage needs data the source does not have (`no_download_path`, no `downloadPath`) | `error.download.retry_unavailable` | `No se puede retomar: falta la descarga en disco` |
| **new** — the queue rejected the re-enqueue (NFR-3) | `error.download.retry_enqueue_failed` | `No se pudo volver a encolar el trabajo, probá de nuevo` |

New keys that appear on `lastError`, not as thrown errors:

| Key | Stage | Message (`es`) |
| :-- | :-- | :-- |
| `error.download.torrent_client_error` (`{state}`) | `DOWNLOAD` | `El cliente de torrents detuvo la descarga ({state}): revisá espacio en disco y permisos` |
| `error.source.scan_failed` (`{detail}`) | `SCAN` | `No se pudo leer la descarga: {detail}` |

Consumer obligations:

- **`web`**: retypes `DownloadError`, `lastError` and `retryable` in `src/types/downloads.ts` and
  adds them to `DOWNLOAD_FIELDS` (`src/actions/downloads.ts`); renders `lastError` on the row
  (REQ-5); shows Play on an `ERROR` row by `retryable` alone, including upload rows (REQ-11); maps
  every new error key above to row-level copy through the existing `startDownloadAction` error path;
  adds every key reachable on `lastError` to both catalogs (verified with
  `scripts/check-messages.mjs`).
- **`worker`**: calls `sourceScanFailed` from the scan handler on every failure before
  `sourceScanned` is reached, through `deliverReport`; uses its existing `ERROR_SOURCE_NO_TARGET`/
  `ERROR_SOURCE_NO_DOWNLOAD_PATH` keys where they apply and `error.source.scan_failed` otherwise.
  Selects no new field on any query.

## Data Model Changes

None. Every column read or cleared already exists (NFR-6).

## Acceptance Criteria

- [ ] **AC-1 (Encode resumes, failure path)**: Given a film whose torrent completed and whose encode
      failed (e.g. the destinations volume was full), the row in `/movies/<id>` reads `ERROR` with
      stage "encode" and the FFmpeg failure message, and Play is shown. After freeing space and
      pressing Play, the row reads `ENCODING`, the title badge reads `ENCODING`, qBittorrent's
      download count for that torrent did not change, and the file lands in the library.
- [ ] **AC-2 (Download resumes)**: Given a torrent qBittorrent stopped with state `error` because
      the downloads disk filled, the row reads `ERROR`, stage "download", with the disk/permissions
      message. After freeing space and pressing Play, the torrent continues from its current
      progress (not from 0%) and the row reads `DOWNLOADING`.
- [ ] **AC-3 (Silent scan becomes visible)**: Given a completed torrent whose download folder is made
      unreadable before the worker scans it, the row reads `ERROR` with stage "scan" within one scan
      attempt — never `DOWNLOADED` indefinitely. After restoring permissions and pressing Play, the
      scan runs and the encode is queued.
- [ ] **AC-4 (Deselected files)**: Given `error.source.scan_no_downloaded_video`, re-selecting the
      files in qBittorrent, letting them download, and pressing Play produces a successful scan.
- [ ] **AC-5 (Season pack, partial)**: Given a season pack where episodes 1–3 encoded and 4–5 failed,
      pressing Play re-queues exactly episodes 4 and 5; episodes 1–3 keep their library files and
      `COMPLETED` status.
- [ ] **AC-6 (Upload)**: Given an uploaded file whose encode failed, the row shows Play but no Stop;
      pressing Play resumes the encode.
- [ ] **AC-7 (Replaced source refused)**: Given a source demoted by a forced replace, the row shows
      stage "replaced" and its message, and no Play; calling `downloadStart` on it directly through GraphQL
      returns `error.download.retry_replaced` and changes nothing.
- [ ] **AC-8 (Race no longer wedged)**: Given a film whose only source failed to encode, adding a
      second torrent for it and letting it complete queues a scan and an encode for the new one. The
      first row stays `ERROR`; once the second has completed, the first shows no Play and
      `downloadStart` on it returns `error.download.retry_superseded` — until the second's own
      post-encode cleanup sweeps the losing sibling away (`022`'s `downloadRemove` sweep, unchanged),
      at which point the first row disappears.
- [ ] **AC-8b (Partial pack replaced)**: Given a season pack where episodes 1–3 encoded and 4–5
      failed, adding a new pack for the same season and letting it complete encodes all five
      episodes from the new pack; episodes 1–3's library files are replaced (new modification time),
      and the old pack's row reads `ERROR` with no Play until the new pack's cleanup sweeps it.
- [ ] **AC-9 (Redis down)**: With `redis` stopped, pressing Play on a failed encode shows
      `error.download.retry_enqueue_failed` on the row; after restarting `redis`, the row still reads
      `ERROR` with its original error, and Play then works.
- [ ] **AC-10 (Double Play)**: Pressing Play twice quickly on a failed encode results in one encode
      of that file (`bin/cli worker` logs one `ENCODING` start per job), not two.
- [ ] **AC-11 (User cannot fake a scan failure)**: Calling `sourceScanFailed` with a user JWT returns
      `error.auth.unauthenticated` and leaves the source untouched.
- [ ] **AC-12 (Localized)**: With UI locale `es`, every error above renders in Spanish;
      `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift.

## Out of Scope

- **Automatic retry.** Perceptor does not resume anything on its own when space frees up; Play is
  a human decision. `054`'s single automatic recovery of a crashed encode is unchanged.
- **Free-space checks.** No pre-flight "is there room?" before a download, scan or encode. The
  failure is reported when it happens; predicting it needs size estimates Perceptor does not have.
- **An error history.** Only the last error per row is shown. Earlier errors are overwritten or
  cleared on resume, as they are today.
- **Resuming from an earlier stage than the one that failed.** Play resumes the failed stage only.
  "Re-download this torrent" or "re-scan a source that encoded fine" is delete-and-re-add (`047`).
- **The exact qBittorrent error text.** `torrents/info` does not expose it; reading qBittorrent's
  log to extract it is not attempted (REQ-3).
- **A separate Retry button or mutation.** Deliberately folded into Play/`downloadStart`: one
  button means "keep going from where it stopped", regardless of stage.
- **Title-level retry** (a Play on the title card rather than the source row). The row is the unit
  that failed; a title with several failed sources resumes each one.

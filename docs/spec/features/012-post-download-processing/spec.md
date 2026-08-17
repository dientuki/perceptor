---
title: Post-Download Processing
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-08-17
last_updated: 2026-08-17
status: Approved         # Draft | Approved | Implemented | Superseded
services: [api, worker]
---

# SPEC: Post-Download Processing (`spec.md`)

## Context & Goal

The stretch of the pipeline that runs from *the file is on disk* to *the file is in the library and
the media server has been told* is the only stage with no spec of its own. `010-episode-acquisition`
covers how a release is acquired; `011-av1-transcode` covers what FFmpeg decides *inside* an encode.
Nobody wrote down the flow that joins them, and it is the flow with the most moving parts:
qBittorrent's AutoRun hook calls `torrentCompleted`
(`services/api/src/downloads/downloads.service.ts`), which flips the `MediaSource` to `READY` and
puts a `{ mediaSourceId }` job on the `process` queue; the worker scans the finished download
(`services/worker/src/scan/scan-folder.ts`) and reports its inventory through `sourceScanned`
(`services/api/src/media-sources/media-sources.service.ts`), which is where the `ProcessJob` row is
born and where a `{ processJobId }` job lands on the `encode` queue; the worker encodes
(`services/worker/src/ffmpeg/runner.ts`), writing through a working path and a `.part.mkv` before an
atomic rename into the library; then `encodeCompleted`
(`services/api/src/process-jobs/process-jobs.service.ts`) marks everything `COMPLETED` and notifies
Jellyfin (`services/api/src/media-server/media-server.service.ts`). A tus upload enters the same
pipeline one step later, from `UploadsService.handleUploadFinish`, with a `MediaSource` that starts
at `READY` because the bytes are already on disk.

Almost all of that works. What does not is the last block of
`services/worker/src/jobs/encode.job.ts`, and it is wrong in three ways, each of which produces no
error anywhere. First, the source is deleted only for torrents: the whole block sits inside
`if (details.infoHash)`, and a `LOCAL_FILE` source — every tus upload — has a null `infoHash` by
definition, so the uploaded file stays under `<downloads>/imports/<uploadId>/` forever and the disk
simply fills. Second, that cleanup runs *inside* the encode's `try`, after `encodeCompleted` has
already written `COMPLETED` and the file is already in the library; if qBittorrent is unreachable or
the `rm` throws `EACCES`, the `catch` fires `encodeFailed` and both the `ProcessJob` and the `Movie`
flip back to `ERROR` — permanently, because neither queue configures `attempts`, so a film ends up
marked broken while its file sits perfectly fine in the library. Third, the deletion is an
unchecked `rm(downloadPath, { recursive: true, force: true })` on a value read straight from the
database; the worker cannot verify that path lies inside the downloads root, because per
Constitution Article V it reads no path environment variables and today only `outputRoot` arrives
resolved in the payload.

This feature writes the contract for the stage and closes those three gaps. When it ships, an
uploaded file is cleaned up like a torrent is, a cleanup failure can no longer demote a finished
encode, and nothing outside the downloads root can be deleted. No row in the root `CLAUDE.md`
changes status — every stage named here already reads *working*; what changes is that the stage
finally has a document, and the three corrections become criteria somebody can check.

## Requirements

> **Explicit assumption, flagged here so it is visible at approval time**: the worker is the sole
> owner of the filesystem under the downloads root. `api` holds the state and the settings but has
> neither volume mounted, so it cannot delete a downloaded file even though it is the service that
> knows the file is finished with. That split is why cleanup lives in a worker job and why the
> downloads root has to cross the GraphQL boundary for REQ-10 to be implementable at all.

> **Scope**: films. The same handlers serve `kind: 'EPISODE'` and the corrections below land in
> shared code, so episodes get the fixed behaviour as a consequence. What is out of scope is
> stating and verifying it for series — see *Out of Scope*.

### Functional Requirements

- [ ] **REQ-1 (Completion is asserted, never polled)**: A finished download must reach the system as
      an explicit notice — qBittorrent's AutoRun calling `torrentCompleted(infoHash)` for a torrent,
      or the tus upload hook for a local file. Nothing may poll the torrent client for progress. An
      `infoHash` that matches no `MediaSource` must be ignored without error, because the client
      holds torrents Perceptor did not add.
- [ ] **REQ-2 (The completion notice is idempotent)**: A repeated notice for the same source must
      not re-enqueue work. A `MediaSource` already in `READY` or `SCANNED` is reported as already
      processed; one in `ERROR` — demoted because a `force` replacement superseded it — is ignored,
      so a late notice can never resurrect a source the user replaced.
- [ ] **REQ-3 (The scan inventories, it does not parse)**: The worker must enumerate every file
      under the download path and report the full inventory — path, name and size — plus its choice
      of the main video file. That choice must be the largest file carrying a known video extension.
      Names must not be parsed for season, episode, quality or anything else. When the download path
      is a single file rather than a folder, the inventory is that one file.
- [ ] **REQ-4 (A scan with no video is an error, not an empty success)**: If the scan reports no
      main video file, the `MediaSource` and the film must both end in `ERROR` with a message saying
      the folder was empty or had no video, and no `SourceFile` and no `ProcessJob` may be created.
- [ ] **REQ-5 (One encode job per file, and a re-scan never rolls one back)**: Reporting a scan must
      create at most one `ProcessJob` for the chosen file. A second scan of the same source must
      converge on the same rows rather than duplicate them, and must re-enqueue the encode only when
      the existing job has not started yet. A job that is queued, running, completed or failed must
      be left exactly as it is.
- [ ] **REQ-6 (The encode is enqueued only after its row is committed)**: The encode job must not be
      visible on the queue before the `ProcessJob` it names is readable, so the worker can never
      fetch a job that does not exist yet. If enqueueing fails, the row must stay in its
      not-yet-queued state so a later re-scan recovers it.
- [ ] **REQ-7 (Nothing half-written ever appears in the library)**: The encode must not write into
      its final library path. It must produce its output elsewhere and move it into place in one
      atomic step, and it must leave no temporary file behind on any exit path, including a killed
      container or a failed encode.
- [ ] **REQ-8 (Where the file lands)**: A completed film must be filed at
      `<outputRoot>/<Title> (<year>) [tmdbid=<id>]/<Title> (<year>).mkv`, where `outputRoot` is
      resolved by `api` from the `path_movies` setting. A title with no known release date uses
      `0000` as its year. The film's `filePath` must record where it was actually written.
- [ ] **REQ-9 (Telling the media server can never fail the job)**: The notification to the
      configured media server must not be able to mark a job failed. A lost notice is recoverable
      with a manual scan from the media server; a completed encode marked `ERROR` is not. When no
      media server is configured, the encode must complete with no notification attempted.
- [ ] **REQ-10 (The source is cleaned up whatever kind it is)**: After a successful encode the
      source must be removed regardless of how it arrived. A torrent must additionally be removed
      from the torrent client. A local file must have its file deleted, and its staging directory
      too when that directory is left empty. Today this happens only for torrents, which is why an
      uploaded file is never cleaned up.
- [ ] **REQ-11 (Cleanup can never demote a finished encode)**: A failure while cleaning up — the
      torrent client being unreachable, a permission error, a busy file — must leave the
      `ProcessJob` and the film `COMPLETED` and must be recorded in the worker's log. The encode
      produced a usable file; that outcome must not be reversed by a step that runs after it.
- [ ] **REQ-12 (Nothing outside the downloads root is ever deleted)**: Before deleting anything the
      worker must verify the path it was given lies inside the downloads root. A path that does not
      must cause no deletion at all and must be recorded. The worker must obtain that root from the
      job payload, never from its own environment.
- [ ] **REQ-13 (A failed encode deletes nothing)**: When an encode ends in `ERROR`, the download and
      the torrent must both be left intact so the user can inspect the source and retry.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Scans are never blocked behind an encode)**: Scanning and encoding must be consumed
      independently, so an encode that runs for hours cannot delay the scan of a download that just
      finished, and two encodes never run at once.
- [ ] **NFR-2 (Queue payloads are pointers, not copies)**: A queued job must carry only the id of
      the row it refers to. Everything else must be re-read through GraphQL when the job runs, so a
      job that sat in Redis across a restart or a settings change cannot act on a stale path.
- [ ] **NFR-3 (Hand-retyped contract)**: The new payload field crosses into `worker` with no codegen
      between the services. It must be retyped by hand in `EncodeJobDetails`
      (`services/worker/src/jobs/encode.job.ts`) and recorded in `docs/spec/graphql-contract.md`,
      because nothing fails to compile if one side drifts (Constitution, Article VIII). The queue
      job names and payload shapes are a second contract of the same kind, duplicated deliberately
      between `services/api/src/queue/types.ts` and `services/worker/src/queue/types.ts`.
- [ ] **NFR-4 (The worker reads no path environment variables)**: The downloads root must arrive
      resolved in the payload exactly as `outputRoot` does. Reading `CONTAINER_DOWNLOADS_DIR` in the
      worker to satisfy REQ-12 is the violation this requirement exists to forbid (Constitution,
      Article V).
- [ ] **NFR-5 (The worker never queries the database)**: Every fact the cleanup needs — source kind,
      infohash, download path, downloads root — must come through GraphQL (Constitution,
      Article III).
- [ ] **NFR-6 (Tests where the failure is silent)**: `services/worker/src/jobs/encode.job.ts` and
      `services/worker/src/scan/scan-folder.ts` have no tests at all today, and all three
      corrections live in the first of them. The cleanup branch — every source kind, the
      containment check, the error isolation — and the scan's file-selection rule must be covered by
      Vitest specs (Constitution, Article IX). Each new spec opens with a comment naming the failure
      it prevents.
- [ ] **NFR-7 (No behaviour change for existing sources)**: A torrent that completes today must
      behave identically after this ships, apart from the containment check. This feature adds a
      branch for local files and moves an existing block out of a `try`; it does not redesign the
      torrent path.

## GraphQL Contract Delta

One new field. REQ-12 needs the worker to know the downloads root, and Article V says the worker may
not derive it — so `api` resolves it and hands it over, exactly as it already does for `outputRoot`.

```graphql
type EncodeJobDetails {
  # …every existing field, unchanged…
  downloadsRoot: String!
}
```

Notes the SDL cannot carry:

- `downloadsRoot` is the **root itself**, resolved with `resolveFromRoot('downloads', '.')` in
  `services/api/src/process-jobs/process-jobs.service.ts` — not the `path_downloads` setting.
  Torrents are saved under `path_downloads/<hash>` while uploads are staged under
  `imports/<uploadId>`, and the containment check has to cover both. Resolving the narrower path
  would make every uploaded file fail REQ-12 and never be cleaned up, which is the bug this feature
  is fixing.
- It is an absolute **container** path, like `outputRoot`. It reaches `worker` and stops there; no
  container path crosses into `web` (Constitution, Article V).
- It is non-null. If the downloads root is not mounted, `resolveFromRoot` throws and the whole
  `processJob(id)` query fails — the worker cannot sensibly encode into a stack whose volumes are
  wrong, so failing the job loudly is the intended outcome.
- `processJob(id)` keeps `@AllowService()`. No new operation is added and no existing signature
  changes.
- `downloadRemove(mediaSourceId)` is unchanged, including its return string
  `omitido: mediaSource <id> no es un torrent` for a source with no infohash. What changes is on the
  worker side: that string no longer means "there is nothing to delete". The worker calls
  `downloadRemove` only for a torrent, and deletes files for every kind.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `processJob(id)` for an id that does not exist | `NotFoundException` | `El processJob <id> no existe` |
| `path_movies` unset when the job is fetched | `NotFoundException` | `Falta la setting "path_movies" — configurala en Settings antes de encodear.` |
| The downloads or library root is not mounted in `api` | `BadRequestException` | `La raíz "<label>" no está montada en este container — revisá HOST_DOWNLOADS_DIR en el .env y volvé a levantar el stack.` |
| The scan finds no video file | — (job outcome, surfaced on the film) | `Escaneo sin archivo de video principal: carpeta vacía o sin video` |
| The reported `matchedFilePath` is not in the reported inventory | `BadRequestException` | `matchedFilePath <path> no está en la lista de files reportada` |

Every string above already exists in the codebase and is reused verbatim; this feature invents no
new user-facing copy.

Consumer obligations:

- `worker` — add `downloadsRoot` to the `processJob(id)` query and to the `EncodeJobDetails` type in
  `src/jobs/encode.job.ts`. A missing edit on either side makes the field arrive `undefined`, which
  a naive containment check would read as "nothing is contained" and would silently stop cleaning up
  anything, forever, with no error in any log.
- `web` — **no obligation.** No query, mutation or screen changes.

## Data Model Changes

**None.**

Two things about the existing shape are worth writing down, because both are easy to get wrong when
reading this code for the first time.

The link between a source and its media points in opposite directions for the two media types.
`Movie.mediaSourceId` is a unique column on `movies`, so a film points at its source; `episodeId` is
a column on `media_sources`, so a source points at its episode. That is why
`MediaSourcesService.findOneFlat` flattens `movieId` out of an included relation while `episodeId`
comes straight off the row, and why "does this title already have an active download" is a different
query per type. Nothing here changes it.

The comment above `SourceFile.filePath` in `services/api/prisma/schema.prisma` states that the
original is not deleted after processing, "so the user can decide what to do with it". REQ-10
contradicts that: the original *is* deleted after a successful encode, and has been for torrents
since before this spec. The comment must be corrected as part of this feature so the schema stops
documenting a policy the code does not follow.

## Acceptance Criteria

- [ ] **AC-1**: Given a torrent added from the indexer, when it finishes downloading, then
      `bin/mysql -e 'select id, status from media_sources order by id desc limit 1'` reports
      `SCANNED`, `source_files` holds exactly one row for that source pointing at the largest video
      file in the folder, and `process_jobs` holds one row for it in `QUEUED`.
- [ ] **AC-2**: Given that job, when the encode completes, then the file exists at
      `<library>/<Title> (<year>) [tmdbid=<id>]/<Title> (<year>).mkv`, and
      `bin/mysql -e 'select status, filePath from movies where id = <id>'` reports `COMPLETED` and
      that same path.
- [ ] **AC-3**: When the encode has finished, then no `.working.mkv` remains beside the source and
      no `.part.mkv` remains in the destination folder.
- [ ] **AC-4**: Given a film imported by uploading a file from `/movies/<id>`, when its encode
      completes, then `<downloads>/imports/<uploadId>/` no longer exists. **Fails today** — the
      uploaded file is never deleted.
- [ ] **AC-5**: Given a film acquired as a torrent, when its encode completes, then the torrent is
      gone from qBittorrent's list and its save path no longer exists on disk.
- [ ] **AC-6 (failure path)**: Given the `torrent` container stopped, when an encode completes, then
      `bin/mysql -e 'select status, errorMessage from process_jobs order by id desc limit 1'` reports
      `COMPLETED` with no error message, the encoded file is in the library, and
      `docker compose logs worker` records the cleanup failure. **Fails today** — the job is marked
      `ERROR` and the film with it.
- [ ] **AC-7 (failure path)**: Given a `MediaSource` whose `downloadPath` is edited to a path outside
      the downloads root, when its encode completes, then that path still exists on disk and
      `docker compose logs worker` records that the deletion was refused. **Fails today** — the path
      is deleted unchecked.
- [ ] **AC-8 (failure path)**: Given a completed download whose folder contains no video file, when
      it is scanned, then `media_sources.status` is `ERROR` with
      `errorMessage = 'Escaneo sin archivo de video principal: carpeta vacía o sin video'`,
      `movies.status` is `ERROR`, and `bin/mysql -e 'select count(*) from process_jobs where ...'`
      returns 0.
- [ ] **AC-9 (failure path)**: Given a source file with no audio track in the film's original
      language, when it is encoded, then the job ends `ERROR`, the download is still on disk and the
      torrent is still in qBittorrent.
- [ ] **AC-10 (failure path)**: Given a download folder holding two video files, when it is scanned,
      then the `source_files` row names the larger of the two, regardless of which one the release
      name resembles.
- [ ] **AC-11**: Given `media_server_client = none` in Settings, when an encode completes, then the
      job reports `COMPLETED` and `docker compose logs api` shows no media-server request attempted.
- [ ] **AC-12**: Given a source already in `SCANNED`, when `torrentCompleted` fires again for its
      infohash, then it returns `ya procesado: mediaSource <id> en estado SCANNED` and no new job
      appears on the `process` queue.
- [ ] **AC-13**: `bin/npm worker test` passes, including new specs covering the cleanup branch for
      each source kind, the containment refusal, the cleanup-error isolation, and the scan's
      largest-video rule.
- [ ] **AC-14**: `bin/npm api test` passes with no fewer suites than before.
- [ ] **AC-15**: `bin/cli api npx --no tsc --noEmit` and `bin/cli worker npx --no tsc --noEmit` each
      report 0 errors; `bin/cli web npx --no tsc --noEmit` still reports exactly the 11 known
      pre-GraphQL errors across the same 4 files (`services/web/CLAUDE.md` § Current state) and not
      one more.

## Out of Scope

- **Series.** The same handlers serve `kind: 'EPISODE'`, and the cleanup corrections land in shared
  code, so episodes inherit the fixed behaviour. Stating requirements and acceptance criteria for
  them is deliberately deferred: an honest series spec also has to answer what `Show.status` should
  be when some episodes are complete and others are not, which nothing updates today and which is a
  design question of its own.
- **Retries and backoff.** Neither queue configures `attempts`, so a failed scan or encode is never
  retried. That is a real gap and it is what makes REQ-11 matter so much, but choosing a retry
  policy — how many, how far apart, which errors are worth retrying at all when one attempt costs
  hours of CPU — is an operational decision that deserves its own spec rather than a default picked
  in passing here.
- **Seeding time and ratio.** The torrent is removed the instant the encode completes, with no seed
  check. Changing that means a policy setting, a scheduled re-check and a state for "encoded but
  still seeding".
- **Everything FFmpeg decides.** Codecs, CRF, track selection, tonemapping and subtitle rules are
  frozen by `011-av1-transcode`. This feature is about the flow around the encode, not the encode.
- **The `movieId`/`episodeId` naming debt** recorded in the root `CLAUDE.md`. It crosses all three
  services with no codegen and is scheduled separately; a partial rename would break the download
  pipeline at runtime with no compile error anywhere.
- **Worker health checks and crash handling.** The worker exposes no HTTP surface and registers no
  `unhandledRejection`/`uncaughtException` handler. Worth having, but it is a container-supervision
  concern rather than a pipeline stage.
- **`ENCODE_DRIVER=mock` and its commented-out final `rename`.** It is a manual testing aid with its
  reason written above it, not a defect for this feature to fix. It must keep working, since it is
  what lets this whole flow be exercised without waiting hours for FFmpeg.
- **Deleting a library file when a title is removed from a user's library.** This feature deletes
  sources after a successful encode; the inverse — reclaiming space when a film is dropped — has
  never existed and would need its own rules about titles owned by more than one user.

---
title: Deselected torrent files must never be encoded
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-10
last_updated: 2026-09-10
status: Approved
services: [api, worker]
---

# SPEC: Deselected torrent files must never be encoded (`spec.md`)

## Context & Goal

A release can ship the same episode twice — two `.mkv` files of the same announced size, one of them
a duplicate, a mislabelled copy or a differently-hashed rename. qBittorrent lets a user say "download
`A.mkv`, skip `B.mkv`" by setting the unwanted file's priority to *Do not download*. It does **not**
remove that file from the listing: libtorrent still creates it, and the entry keeps its full announced
size on disk while holding no content at all. Both files exist, and both "weigh" the same.

Perceptor's scan stage cannot see the difference. `services/worker/src/scan/scan-folder.ts` enumerates
every file with the size the filesystem reports, and
`services/worker/src/scan/select-matches.ts` picks the **largest video file** in `single` mode (and the
largest per resolved episode in `season` mode). With two files reporting the same size, the winner is
whichever `reduce` happened to keep — in the reported incident that was the skipped one. The pipeline
then enqueued an encode over a file with no bytes in it, and the failure surfaced hundreds of lines
downstream, at `services/worker/src/ffmpeg/metadata.ts`, as
`error.encode.probe_failed` with `EBML header parsing failed` — a message that names neither the real
cause nor the fact that the right file was sitting next to the wrong one the whole time.

The information needed to get this right exists, and it is not on disk: qBittorrent knows exactly which
files of a torrent it was told to download and which of those it finished. This feature makes `api` ask
it — the worker never talks to the torrent client (Constitution, Article II) — and hands the worker the
answer along with the source it already queries, so the scan stage narrows its candidates to files that
actually have content before any selection rule runs. The **Scan files, inventory** row of the root
`CLAUDE.md` pipeline table gains an input; no stage is added or removed.

The user's decision, recorded during specification: this is scoped to **torrents only**. An upload or a
local folder has no torrent client to ask, and behaves exactly as it does today. When the narrowing
leaves no video at all, the source must fail with its own message rather than fall back to today's rule
and reproduce the bug.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Downloaded file list)**: `api` must be able to report, for a `MediaSource`, the list of
      files the torrent client actually wrote — every file of the torrent whose priority is not *do not
      download* **and** whose per-file progress is complete. Each entry is a path **relative to that
      source's `downloadPath`**, using the same separator the client reports, so the worker can rebuild
      the absolute path by joining it to the `downloadPath` it already has.
- [ ] **REQ-2 (Unknowable is not empty)**: That list must be **null** — never `[]` — whenever the answer
      cannot be established: the source has no `infoHash` (a tus upload, a local folder), the client does
      not know the hash (already removed), or the client is unreachable or rejects the request. `[]` means
      "the client answered, and nothing was downloaded"; `null` means "nobody knows".
- [ ] **REQ-3 (Candidate narrowing)**: When the list is non-null, only enumerated files whose path appears
      in it may be selected as a match, in **both** scan modes (`single` and `season`). The existing
      selection rules — largest video wins; largest video per parsed `SxxEyy` wins — then run over the
      narrowed set, unchanged.
- [ ] **REQ-4 (Null means today's behaviour)**: When the list is null, every enumerated video file is a
      candidate and selection is byte-for-byte what it is today. A source that is not a torrent never
      changes behaviour because of this feature.
- [ ] **REQ-5 (Inventory stays whole)**: The scan must keep reporting **every** file it found on disk,
      including the ones narrowing excluded, each carrying a flag saying whether it was downloaded. The
      inventory is what a human reads afterwards to understand what the release contained; narrowing must
      not amputate it.
- [ ] **REQ-6 (Unmatched files ignore what was never downloaded)**: `MediaSource.hasUnmatchedFiles` must
      count only video files that were actually downloaded. A deselected `B.mkv` sitting next to a matched
      `A.mkv` must not set it — otherwise the cleanup verdict withholds `deleteDownloadPath` forever and
      the download folder is never removed.
- [ ] **REQ-7 (Distinct, honest failure)**: When the scan resolves no match **and** at least one reported
      video file was not downloaded, the source must go to `ERROR` with its own translation key stating
      that none of the download's video files has content — not the generic "no video found" key, and
      never a downstream `ffprobe` failure.
- [ ] **REQ-8 (A client outage never fails a scan)**: A torrent client that is unreachable, slow or
      rejecting must degrade to REQ-2's null and log one line naming the degradation. It must not fail the
      `source-ready` job, must not move the source to `ERROR`, and must not fail any other query or
      mutation that happens to read a `MediaSource`.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (One call, only when asked)**: Resolving the list costs at most **one** request to the
      torrent client per `source-ready` job. It must not be resolved for readers that do not ask for it —
      in particular the `movieDownloads`/`showDownloads` listings, which already issue their own
      `torrents/info?tag=` read per title and must not gain a second per-source call.
- [ ] **NFR-2 (No schema change)**: This feature adds no Prisma model, column or enum. The flag the worker
      reports travels on the existing `sourceScanned` input and is consumed in the same transaction; it is
      not persisted.
- [ ] **NFR-3 (Hand-retyped contract, both ends)**: The new `SourceFileInput` field is required and
      non-null, so a `worker` image older than this feature stops passing `sourceScanned` validation. That
      is acceptable and intended — `PERCEPTOR_TAG` is one version for all five images (root `CLAUDE.md`) —
      but it must be stated in the feature's release notes, because nothing in either service fails at
      compile time.
- [ ] **NFR-4 (No path leakage widening)**: The list crosses the boundary as paths **relative** to
      `downloadPath`, not absolute container paths (Constitution, Article V). `downloadPath` itself already
      crosses to the worker and is unchanged by this feature.

## GraphQL Contract Delta

```graphql
type MediaSource {
  # …existing…
  downloadedFiles: [String!]
}

input SourceFileInput {
  # …existing…
  isDownloaded: Boolean!
}
```

**`MediaSource.downloadedFiles`** is resolved on demand against the source's torrent client, never
stored. Semantics are REQ-1/REQ-2: a list of paths relative to `MediaSource.downloadPath`, one per file
the client reports as both selected and complete; `null` when the answer cannot be established. It is a
`worker`-facing field — `web` has no obligation and must not add it to any query, since asking for it
costs a torrent-client round trip per source (NFR-1).

**`SourceFileInput.isDownloaded`** is the worker's per-file verdict, reported for every enumerated file
(REQ-5): `true` when `downloadedFiles` was null (nothing to narrow by — REQ-4) or when the file's path
appears in it, `false` otherwise. It follows the `isVideo` precedent exactly: `api` trusts the flag
rather than re-deriving it, so the rule lives in one place. `api` reads it for REQ-6 and REQ-7 only.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Scan resolved no match and at least one reported video file has `isDownloaded: false` (REQ-7) | stored on the row: `MediaSource.status = ERROR`, `errorKey = error.source.scan_no_downloaded_video`, plus `Movie`/`Episode` moved to `ERROR` as the existing branch already does | `Ninguno de los archivos de video de esta descarga tiene contenido — revisá qué archivos seleccionaste en el cliente de torrents.` |
| Scan resolved no match and every reported video file has `isDownloaded: true` | unchanged — `error.source.scan_no_video` | unchanged |
| Torrent client unreachable or rejecting while resolving `downloadedFiles` (REQ-8) | **no error** — the field resolves to `null` and one line is logged | none |

Both error keys land in `MediaSource.errorKey`/`errorMessage` on the row, the same way
`error.source.scan_no_video` does today. Neither is rendered by `web` yet: `services/web/messages/*.json`
carries no `errors.source.*` entries at all, and no `web` screen reads `MediaSource.errorMessage`. The
Spanish string above is therefore the copy this key **will** take when a screen does render it, recorded
here so the vocabulary is fixed (`docs/spec/graphql-contract.md` § "UI internationalization"); adding it
to the catalog is out of scope (see below).

Consumer obligations — `worker`: add `downloadedFiles` to the existing `mediaSource(id)` query in
`src/jobs/source-ready.job.ts` **and** to its local `MediaSourceQueryResult` type, in the same edit; add
`isDownloaded` to the per-file objects it sends to `sourceScanned`. A field added to the query but not the
local type (or the reverse) arrives `undefined` and reads as "no narrowing" with no error anywhere.
`web`: none.

## Data Model Changes

**None.** No model, column, enum or migration. The one new `api`-side constant is a translation key in
`src/i18n/error-keys.ts` and its English rendering in `src/i18n/messages.en.ts`, which are code, not
schema.

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| — | none | — | no |

## Acceptance Criteria

- [ ] **AC-1 (the reported bug)**: Given a torrent holding `A.mkv` and `B.mkv` of the same announced size,
      with `B.mkv` set to *Do not download* in qBittorrent, when the download completes, then the encode
      that gets enqueued has `A.mkv` as its input — verifiable in the worker log's
      `[source-ready] <id>: N archivo(s), 1 match(es)` line and in
      `bin/mysql -e 'select file_path from source_files order by id desc limit 1'`.
- [ ] **AC-2 (inventory intact)**: In the same scenario, the worker's `sourceScanned` call still reports
      both `.mkv` files, `B.mkv` with `isDownloaded: false`, and
      `bin/mysql -e 'select has_unmatched_files from media_sources where id = <id>'` returns `0` (REQ-5,
      REQ-6).
- [ ] **AC-3 (cleanup still fires)**: When that encode finishes, `encodeCompleted` returns
      `deleteDownloadPath: true` and the download folder — the deselected placeholder included — is gone
      from the downloads root.
- [ ] **AC-4 (failure path — nothing was downloaded)**: Given a torrent whose every video file is set to
      *Do not download*, when the download completes, then the source ends `status = ERROR` with
      `error_key = 'error.source.scan_no_downloaded_video'`, the target film/episode ends `ERROR`, **no**
      `ProcessJob` row is created, and no `ffprobe` runs — confirmed by the absence of any
      `error.encode.probe_failed` line in `docker compose logs worker`.
- [ ] **AC-5 (failure path — client outage)**: Given the same two-file torrent, with the `torrent`
      container stopped before the scan runs, when `source-ready` executes, then the job completes, the
      source reaches `SCANNED`, selection falls back to today's largest-video rule, and the worker or api
      log carries one line stating the downloaded-file list could not be resolved (REQ-8).
- [ ] **AC-6 (uploads unchanged)**: Given a film acquired through the tus upload path, when its scan runs,
      then `downloadedFiles` resolves to `null`, every reported file carries `isDownloaded: true`, and the
      resulting `ProcessJob` is identical to one produced before this feature (REQ-4).
- [x] **AC-7 (the rule, in a unit test)**: `bin/npm worker test` covers a case where the narrowing list
      names only the smaller of two video files and asserts the smaller one is selected — the same case
      asserted to fail when the narrowing is removed (`services/api/CLAUDE.md` § Tests, fault injection).
      Verified: `select-matches.spec.ts` carries the case in both `single` and `season` modes; the
      orchestrator confirmed with the agent that removing `isDownloaded` from the filter fails both.
- [x] **AC-8 (nothing else regressed)**: `bin/npm api test` and `bin/npm worker test` are green at or above
      their counts in the root `CLAUDE.md` § Current state, and `bin/cli api npx --no tsc --noEmit` /
      `bin/cli worker npx --no tsc --noEmit` both report 0 errors.
      Verified directly by the orchestrator (not just the implementer's report): `api` 454 tests, 42
      suites, all green (up from 447/42), 0 typecheck errors, `git status --short services/api/prisma`
      empty. `worker` 175 tests, 20 suites, 173 passing — the 2 failures are the two pre-existing,
      unrelated ones already recorded in the root `CLAUDE.md` § Current state (`ffmpeg/2.json`'s stale
      track-title string and `buildCommand.spec.ts`'s CRF mismatch); typecheck reports the two other
      pre-existing, unrelated errors in `src/metadata/container-tags.spec.ts` (confirmed present on
      `master` via `git stash` before this feature touched anything); `bin/npm worker run build` exits 0.

## Out of Scope

- **Sparse/allocated-byte detection on disk.** Considered and rejected during specification: it would
  cover uploads and local folders too, but a filesystem with no sparse support cannot distinguish the two
  files at all, and a compressing filesystem can make a real file look empty. The user chose the
  authoritative signal instead, accepting that it is torrent-only.
- **Partially downloaded selected files.** A file whose priority is set but whose progress is incomplete
  is treated as not downloaded by REQ-1's "selected **and** complete" rule. Reporting partial progress to
  the user, or waiting for it, is not this feature.
- **Rendering `MediaSource.errorKey` in `web`.** No screen reads it today for any source error, so adding
  `errors.source.*` to `services/web/messages/{en,es}.json` for this one key would ship a catalog entry
  nothing looks up. The Spanish copy is fixed in the error table above so that work, when it happens, does
  not reinvent it.
- **Choosing files for the user.** Perceptor still adds a torrent whole and lets the user deselect in
  qBittorrent. Setting per-file priorities from Perceptor, or picking a preferred copy among duplicates,
  is a different feature.
- **The `error.encode.probe_failed` message itself.** It stays exactly as it is — after this feature it
  should stop firing for this cause, and it is still the right message for a genuinely corrupt file.

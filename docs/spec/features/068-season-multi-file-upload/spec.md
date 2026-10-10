---
title: Season Multi-File Upload
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-20
last_updated: 2026-09-20
status: Approved
services: [api, web]
---

# SPEC: Season Multi-File Upload (`spec.md`)

## Context & Goal

`059-season-pack-acquisition-ui` put three acquisition buttons on every season accordion header of
`/shows/<id>` — search, import file, magnet — and wired two of them. The middle one ships rendered
and permanently `disabled` (`services/web/src/components/shows/SeasonAcquisitionButtons.tsx`,
REQ-2), with its own § Out of Scope note deferring it to a later spec: "a tus upload is a single
file; a season import is a folder or several files, which is a different upload shape". This is that
spec. A user who already has a season's episodes on disk — ripped, transcoded elsewhere, or pulled
by hand — can put a magnet in for it, but cannot hand Perceptor the files, and has to fall back to
uploading them one episode at a time through the per-episode button.

The pipeline already knows how to swallow a season as one unit, and nothing about that has to
change. A season-scoped `MediaSource` (`MediaSource.seasonId`, `022-download-status-tags`) whose
`downloadPath` is a folder is exactly what a completed season torrent produces: `worker`'s
`src/jobs/source-ready.job.ts` reads `seasonId` off the source, picks `{ kind: 'season' }` as its
scan mode, resolves each file to an episode by parsing `SxxEyy`, and fans out into one `ProcessJob`
per episode it recognized. Files for episodes that are not in the folder simply produce no job, and
those episodes stay `MISSING` — a three-file upload into an eight-episode season behaves exactly
like a three-file season torrent. So the whole feature is: give the browser a way to fill such a
folder over tus, and a way to say "that's all of them".

The shape that follows is an **upload session that is itself a `MediaSource`**. `api` creates the
season-scoped row (`kind: LOCAL_FOLDER`, `status: PENDING`) up front, with an empty folder under the
downloads root; each selected file is a separate tus upload into that folder, authorised by its own
single-use ticket scoped to the session rather than to a film or an episode; when the last one
lands, `web` closes the session and `api` promotes it to `READY`, runs the same race arbitration
every other source goes through (`DownloadsService.resolveRace`) and enqueues the same
`bull:process` scan. Two things fall out of that choice for free: while the session is open,
`059`'s REQ-7 read-time rule already lifts every aired episode of the season to `QUEUED`, and an
abandoned session is a plain source row on `/downloads` that `047-source-deletion`'s existing delete
button removes along with its folder — no new sweeper, no orphan state nobody owns.

Once this ships the **Detect completion, enqueue** row of the root `CLAUDE.md` gains a third entry
point beside the torrent hook and the single-file tus upload, the **Download** row's upload half
covers a season, and `059`'s REQ-2 (import-file rendered disabled) is superseded. `worker` is not
touched at all.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (The season import button works)**: The import-file button on a season accordion
      header must be enabled and must open a season-scoped file import modal. `059`'s REQ-2 —
      the button rendered permanently disabled — is superseded by this requirement.

- [ ] **REQ-2 (Several files at once)**: The modal's file picker must accept **multiple** video
      files in one selection. Selecting a folder is not offered (§ Out of Scope). The per-film and
      per-episode import modals are unchanged and still take exactly one file.

- [ ] **REQ-3 (An upload session is a season source)**: Opening the upload must create one
      season-scoped `MediaSource` for the whole selection — `kind: LOCAL_FOLDER`, `status: PENDING`,
      `downloadPath` pointing at a fresh, empty, per-session folder under the downloads root — before
      any byte is uploaded. Every selected file is uploaded into that one folder. No second source
      row, and no per-file row, is ever created.

- [ ] **REQ-4 (Per-file authorisation, scoped to the session)**: Each file's tus upload must be
      authorised by its own single-use ticket minted for the **session**, not for a film or an
      episode. A ticket minted for one session presented against another must be refused without
      being spent, the same guarantee `upload-tickets.service.ts` already gives across films and
      episodes.

- [ ] **REQ-5 (Concurrent upload, one pause control)**: The selected files must upload concurrently
      — up to 4 at a time, the rest queued behind them — since the expected deployment is a LAN. The
      modal must expose a **single** pause/resume control that pauses and resumes the whole batch,
      never a per-file one, plus an overall progress reading and a per-file progress row.

- [ ] **REQ-6 (Closing the session)**: When every selected file has reached a terminal state
      (uploaded, failed or cancelled) and **at least one** was uploaded, `web` must close the
      session, and `api` must then promote the source to `READY`, demote any `READY`/`SCANNED`
      sibling source of that season, run the same race arbitration a completed torrent runs, and
      enqueue the same `bull:process` scan. If **zero** files were uploaded, `web` must delete the
      session instead of closing it.

- [ ] **REQ-7 (A partial season is a partial season, not an error)**: Closing a session holding
      fewer files than the season has episodes must succeed and must behave exactly as a season
      torrent that only contained those files does: `worker` opens one `ProcessJob` per episode it
      resolved, every other episode of the season stays `MISSING`, and a video file that resolves to
      no episode is reported by the existing scan path, not by this feature.

- [ ] **REQ-8 (Episode statuses are never written by the close)**: Closing a session must not write
      any episode's status. While the session is open, aired episodes read at least `QUEUED` through
      `059`'s existing read-time rule; after the scan, the existing `sourceScanned` path writes them.

- [ ] **REQ-9 (Replacing a season that already has delivered episodes)**: When any episode of the
      season is already `COMPLETED`, the modal must show the replace warning up front and start the
      session with `force`, exactly as the season magnet and search modals already do. Without
      `force`, `api` must refuse to open the session with `error.season.already_completed`. The
      decision must travel in the session and its tickets, never in browser-supplied tus metadata.

- [ ] **REQ-10 (Cancelling)**: The modal's cancel action, and confirming its close button while a
      batch is in flight, must abort every in-flight upload and delete the session — its row and its
      folder — through the existing download-delete path. A session abandoned some other way (tab
      closed, browser crash) must remain visible on `/downloads` as a season row the user can delete
      there with the button `047-source-deletion` already ships; no new cleanup mechanism is added.

- [ ] **REQ-11 (Refusals are legible)**: Every refusal below must reach the modal as translated
      user-facing copy, resolved through the existing catalogs — the GraphQL envelope for the
      mutations, the REST `{ message, i18n: { key, params? } }` envelope (`018-ui-i18n`) for a tus
      failure. A bare key or an untranslated English string is a failure of this requirement.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (`worker` is untouched)**: `git diff --stat services/worker` must be empty. A season
      upload is indistinguishable from a season torrent at the worker's input: a `MediaSource` with
      a `seasonId` and a `downloadPath` folder. This is the mechanism by which REQ-7 is already true
      rather than newly implemented.

- [x] **NFR-2 (No migration)**: No Prisma model, column or enum value is added.
      `git status --short services/api/prisma` must be empty. `SourceKind.LOCAL_FOLDER` and
      `MediaSource.seasonId` both already exist.

- [ ] **NFR-3 (Paths stay inside the downloads root)**: The session folder must be resolved through
      `MediaRootsService` against the downloads root, and every file write must be verified to land
      inside it before it happens (Constitution, Article V). No absolute container path crosses the
      GraphQL boundary in either direction. Deleting a session removes only what is under the
      downloads root (Constitution, Article XII).

- [ ] **NFR-4 (The replace decision is never browser-authored)**: `force` must be signed into the
      session at creation and into each ticket at mint time, and read from there. tus metadata is
      browser-authored and must not be trusted for it (`027-replace-completed-media`, REQ-7).

- [ ] **NFR-5 (The `movieId` debt is not touched)**: The `movieId`/`episodeId` tus metadata keys keep
      their exact names and meanings. `mediaSourceId` sits beside them as a third key rather than
      generalising them (root `CLAUDE.md` § Known debt).

- [ ] **NFR-6 (Existing upload paths unchanged)**: `createUploadTicket`'s signature, the single-file
      modal, and `onUploadFinish`'s film and episode branches keep their current behaviour. The
      session branch is added beside them.

## GraphQL Contract Delta

```graphql
type SeasonUploadSession {
  mediaSourceId: Int!
  seasonId: Int!
}

type Mutation {
  """Abre una sesión de subida para una temporada entera y devuelve su MediaSource"""
  startSeasonUpload(seasonId: Int!, force: Boolean = false): SeasonUploadSession!

  """Emite un ticket de un solo uso para subir un archivo a una sesión abierta"""
  createSeasonUploadTicket(mediaSourceId: Int!): UploadTicket!

  """Cierra la sesión: la pasa a READY, arbitra la carrera y encola el escaneo"""
  finishSeasonUpload(mediaSourceId: Int!): Season!
}
```

No new type is needed for the ticket: `createSeasonUploadTicket` returns the existing
`UploadTicket { token, expiresAt }`, and `web` fills `endpoint` from `PUBLIC_UPLOAD_URL` in its
server action exactly as `createUploadTicketAction` already does.

Deleting a session adds **no** mutation: `downloadDelete(mediaSourceId: Int!)`
(`047-source-deletion`) already removes an owned source row, its residue under the downloads root
and its queue entries, and is already reachable from `web` through
`services/web/src/actions/downloads.ts` (Constitution, Article X).

**tus metadata.** A session upload carries `mediaSourceId` and `filename`, and carries neither
`movieId` nor `episodeId`. `onUploadCreate`/`onUploadFinish` branch on the presence of
`mediaSourceId` first; metadata carrying it *and* a `movieId`/`episodeId` is rejected as incomplete
rather than resolved by precedence.

### Error table — GraphQL

| Condition | GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `startSeasonUpload`: season does not exist, or is not the caller's | `NotFoundException` / `error.season.not_found` | `La temporada {id} no existe` (existing key) |
| `startSeasonUpload`: an episode of the season is `COMPLETED` and `force` is false | `ConflictException` / `error.season.already_completed` | existing key — the modal shows the replace warning and retries with `force` |
| `createSeasonUploadTicket`: source does not exist, is not the caller's, or is not an open session (`LOCAL_FOLDER` + `PENDING` + season-scoped) | `NotFoundException` / `error.upload.session_not_found` | `La sesión de subida {id} no existe o ya se cerró` |
| `finishSeasonUpload`: source is not an open session | `ConflictException` / `error.upload.session_not_open` | `La sesión de subida ya se cerró` |
| `finishSeasonUpload`: the session folder holds no file | `ConflictException` / `error.upload.session_empty` | `No se subió ningún archivo a esta sesión` |
| `finishSeasonUpload`: another source won the season's race while this one was uploading | `ConflictException` / `error.upload.superseded` | existing key |

### Error table — uploads (REST)

| Condition | HTTP | Key | Message the user sees |
| :-- | :-- | :-- | :-- |
| tus `POST`: no `Authorization`, or ticket expired/replayed | `401` | `error.upload.ticket_expired` | existing key |
| tus `POST`: ticket minted for a different session | `403` | `error.upload.ticket_wrong_source` | `El ticket de subida no corresponde a esta sesión` |
| tus `POST`/finish: `mediaSourceId` present together with `movieId`/`episodeId`, or unparseable | `400` | `error.upload.metadata_incomplete` | existing key |
| tus finish: the session was deleted or closed while this file was uploading | `409` | `error.upload.session_closed` | `La sesión de subida ya no está abierta` |

**What `web` does with each.** `error.season.already_completed` → render the replace warning and
offer confirm-and-replace (the path REQ-9 describes), never a dead end. `error.upload.ticket_*` and
`error.upload.session_closed`/`session_not_found`/`session_not_open` → mark that file failed, stop
the batch, show the message, and offer cancel (which deletes the session) rather than a retry that
cannot succeed. `error.upload.session_empty` → shown as the batch's error with the session left
open so the user can add files or cancel. `error.upload.superseded` → show the message and refresh
the page; the season now belongs to another source.

## Data Model Changes

**None.** `SourceKind.LOCAL_FOLDER`, `SourceStatus.PENDING` and `MediaSource.seasonId` already exist
(`services/api/prisma/schema.prisma`); a session is a row made of columns that are already there.

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| — | none | — | no |

## Acceptance Criteria

**Verification status — 2026-10-09** (pass over 002–071 on `fix/tech-debt`, no code change)

All seven open criteria are one blocker: an **admin session in a browser, plus local video files to
upload**. Every one of them starts at the season header's import button on `/shows/<id>` (AC-1–AC-5,
AC-8) or at a row on `/downloads` (AC-6), and the tus upload path is the project's only REST route —
there is no CLI or GraphQL equivalent to drive it with, so no part of this feature is reachable
without a browser. Chrome is not connected to this session and the admin password is not known here,
so none of it was run.

What is established without a session: `api/src/uploads/uploads.service.ts` and
`api/src/seasons/seasons.service.ts` are unit-covered (`uploads.service.spec.ts`,
`upload-tickets.service.spec.ts`, `seasons.service.spec.ts`), all green in the 1000 api tests this
pass measured, and the shared attach body AC-8's `COMPLETED`-episode refusal goes through is
`acquisition/attach-source.service.spec.ts` (`088`'s consolidation). The season-scoped
`MediaSource` of kind `LOCAL_FOLDER` that AC-3 reads back is schema-present.

Also relevant to anyone picking this up: `media_sources` holds **one** row on this installation and
`process_jobs` is **empty**, so AC-3's "the source reads `SCANNED`, three episodes…" starts from a
clean slate — and AC-8 needs a `COMPLETED` episode to exist first, which on this data means running a
full pipeline pass before the criterion can even be set up.

- [x] **AC-1**: On `/shows/<id>`, the import-file button on a season header is enabled, and clicking
      it opens the season import modal titled with `<Show> Temporada N` without expanding or
      collapsing the accordion.
      **Confirmed 2026-10-09** with an admin session on `/shows/1`. The import button on the
      Season 4 header is enabled (`disabled === false`), and clicking it opens a modal headed
      `Import Season Files` whose body names the target - *"Choose the video files for **Reacher
      Season 4**. They upload over the network - you can pause and resume the whole batch if it
      drops."* - with a file input and a Close control. The accordion did not move: the page still
      rendered exactly one episode table and the same four headers (`Season 4`, `Season 3`,
      `Season 2`, `Season 1`) with Season 4 still the open one. The criterion's `<Show> Temporada N`
      is the Spanish rendering of that same string; this pass ran in the `en` locale.

- [ ] **AC-2**: Given a season with 8 episodes and 3 local files named `...S02E01...`, `...S02E02...`
      and `...S02E05...`, when all three are selected and uploaded, then a single row appears in
      `bin/mysql -e 'select id, kind, status, seasonId, downloadPath from media_sources order by id
      desc limit 1'` with `kind=LOCAL_FOLDER` and the session's `seasonId`, and that folder on disk
      holds exactly the three files.
      **Not run 2026-10-09, and the session is no longer the blocker.** What it needs is **local
      video files** and a real upload: the tus route writes them into the installation's downloads
      root and the session closes into a season scan that enqueues encodes. This pass holds no
      video files to upload, and fabricating some would put junk under the owner's downloads root
      and start FFmpeg jobs over it. It needs their files and their go-ahead.

- [ ] **AC-3**: Continuing AC-2, after the batch finishes the source reads `SCANNED`, three
      `ProcessJob` rows exist (one per resolved episode), and on `/shows/<id>` episodes 1, 2 and 5
      advance through `ENCODING` to `COMPLETED` while episodes 3, 4, 6, 7 and 8 stay `MISSING`.
      **Not run 2026-10-09, and the session is no longer the blocker.** What it needs is **local
      video files** and a real upload: the tus route writes them into the installation's downloads
      root and the session closes into a season scan that enqueues encodes. This pass holds no
      video files to upload, and fabricating some would put junk under the owner's downloads root
      and start FFmpeg jobs over it. It needs their files and their go-ahead.

- [ ] **AC-4**: While the batch is uploading, the modal shows one progress row per file and an
      overall reading; pressing pause once stops **every** in-flight file, and pressing resume
      restarts them all from the offsets the server already holds.
      **Not run 2026-10-09, and the session is no longer the blocker.** What it needs is **local
      video files** and a real upload: the tus route writes them into the installation's downloads
      root and the session closes into a season scan that enqueues encodes. This pass holds no
      video files to upload, and fabricating some would put junk under the owner's downloads root
      and start FFmpeg jobs over it. It needs their files and their go-ahead.

- [ ] **AC-5**: While the batch is uploading, `/shows/<id>` reloaded in another tab shows every aired
      episode of that season at `QUEUED`, and `/downloads` lists the season as one active row.
      **Not run 2026-10-09, and the session is no longer the blocker.** What it needs is **local
      video files** and a real upload: the tus route writes them into the installation's downloads
      root and the session closes into a season scan that enqueues encodes. This pass holds no
      video files to upload, and fabricating some would put junk under the owner's downloads root
      and start FFmpeg jobs over it. It needs their files and their go-ahead.

- [ ] **AC-6** *(failure)*: Given an open session, when `downloadDelete` removes it (from
      `/downloads`, or by the modal's cancel action) while a file is still uploading, then that
      file's next tus request answers `409` with `error.upload.session_closed`, the modal shows the
      translated message in the active locale rather than a key or English text, the session folder
      is gone from disk, and the season's aired episodes fall back to `MISSING`.
      **Not run 2026-10-09, and the session is no longer the blocker.** What it needs is **local
      video files** and a real upload: the tus route writes them into the installation's downloads
      root and the session closes into a season scan that enqueues encodes. This pass holds no
      video files to upload, and fabricating some would put junk under the owner's downloads root
      and start FFmpeg jobs over it. It needs their files and their go-ahead.

- [x] **AC-7** *(failure)*: Given a ticket minted by `createSeasonUploadTicket` for session A,
      when it is presented at the tus `POST` of a file whose metadata names session B, then the
      request answers `403` with `error.upload.ticket_wrong_source` **and** the ticket is not spent —
      replaying it against session A still succeeds.
- [ ] **AC-8** *(failure)*: Given a season with at least one `COMPLETED` episode, when the modal is
      opened, then the replace warning is shown before any file picker; calling `startSeasonUpload`
      for that season with `force: false` answers `error.season.already_completed`, and confirming
      the replacement starts the session and demotes the season's previous `READY`/`SCANNED` source
      to `ERROR` with `error.source.replaced`.
      **Not run 2026-10-09, and the session is no longer the blocker.** What it needs is **local
      video files** and a real upload: the tus route writes them into the installation's downloads
      root and the session closes into a season scan that enqueues encodes. This pass holds no
      video files to upload, and fabricating some would put junk under the owner's downloads root
      and start FFmpeg jobs over it. It needs their files and their go-ahead.

- [x] **AC-9** *(failure)*: Given an open session with no file uploaded, `finishSeasonUpload` answers
      `error.upload.session_empty` and the session row is still `PENDING`.
- [x] **AC-10**: `git diff --stat services/worker` is empty and `git status --short
      services/api/prisma` is empty (NFR-1, NFR-2).
- [x] **AC-11**: `bin/npm api run test` passes, `bin/cli web npx --no tsc --noEmit` reports 0 errors,
      `bin/npm web run build` exits 0, and `bin/cli web node scripts/check-messages.mjs` reports no
      `en`/`es` drift.
- [x] **AC-12**: The `schema.gql` diff is exactly `SeasonUploadSession`, `startSeasonUpload`,
      `createSeasonUploadTicket` and `finishSeasonUpload` — nothing else (Constitution, Article VIII).

## Out of Scope

- **Selecting a folder instead of files.** `webkitdirectory` would bring recursive traversal and
  junk filtering (samples, `.nfo`, subtitle sidecars) with it, and the user asked for several files.
  The session folder is a folder either way, so adding it later changes only the picker.
- **Resuming an abandoned session from the UI.** Once the modal is gone the `tus.Upload` objects are
  gone with it; the session survives on `/downloads` only to be deleted there (REQ-10). Real
  resumption would need the upload URLs persisted somewhere `web` can find them again.
- **Multi-file upload for a film or an episode.** A single target takes a single file; nothing about
  `createUploadTicket` or the existing modal changes (NFR-6).
- **A sweeper for abandoned sessions.** Deliberately none: the session is visible and deletable
  through the path `047-source-deletion` already built, which is the whole reason the session is a
  `MediaSource` rather than a private Redis record.
- **Validating episode numbering in the browser.** `web` does not parse `SxxEyy` before uploading, nor
  warn about a file that names no episode. Episode resolution is the worker's, from filenames, and a
  file that resolves to nothing is reported by the existing scan path (REQ-7).
- **Changing what a season scan does.** Selection rules, `downloadedFiles` narrowing
  (`052-deselected-torrent-files`) and the per-episode fan-out are untouched.

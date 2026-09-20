---
title: Season Multi-File Upload — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-20
status: Approved
---

# PLAN: Season Multi-File Upload (`plan.md`)

## Approach

The feature adds **one new idea and nothing else**: an *upload session*, which is a season-scoped
`MediaSource` row (`kind: LOCAL_FOLDER`, `status: PENDING`) whose `downloadPath` is an empty folder
under the downloads root. Everything hanging off that idea is existing machinery, reused verbatim:

- **The tus server** (`services/api/src/uploads/uploads.service.ts`) gets a third branch in
  `onUploadCreate`/`handleUploadFinish`, beside the film and episode branches it already has. The
  session branch is the *shortest* of the three — it verifies the ticket, moves the file into the
  session folder, and stops. It creates no `MediaSource`, resolves no race, enqueues nothing, and
  writes no title status, because the session row already exists and the close mutation does the
  rest exactly once.
- **The ticket** is `UploadTicketsService.mint`/`verifyAndSpend` with a third member on
  `UploadTicketTarget` (`{ mediaSourceId }`). The target-check-before-Redis-spend ordering that
  `upload-tickets.service.spec.ts` already pins is what REQ-4/AC-7 ask for; it is inherited, not
  rebuilt.
- **Opening a session** is `SeasonsService`'s existing pre-flight vocabulary: `findOneFromDb`
  for ownership, the `episode.count({ status: 'COMPLETED' })` guard behind `force`, and
  `demoteActiveSources(seasonId)` on force — the same three checks `attachTorrentSource` runs,
  in the same order, minus everything torrent-shaped (no `parseMagnet`, no `infoHash` uniqueness,
  no `qbittorrent.add`).
- **Closing a session** is `handleTorrentCompleted`'s season path with the torrent removed:
  `UploadsService.demoteSupersededSources` (already shared by both existing upload branches),
  then `DownloadsService.resolveRace`, then `status: 'READY'`, then
  `ProcessQueueService.addSourceReady`. It writes **no** episode status, exactly as the season
  branch of `handleTorrentCompleted` writes none.
- **Deleting a session** is `downloadDelete` unchanged. This is the load-bearing reason the session
  is a `MediaSource` and not a private Redis record: `047-source-deletion` already deletes an owned
  source's row, its residue confined to the downloads root, and its queue entries, and `web` already
  calls it from `/downloads` and from `DeleteDownloadModal`. A Redis-record design would have needed
  its own delete mutation, its own residue cleanup and its own sweeper for abandoned batches, and
  would have been invisible on `/downloads` while it ran.
- **Episodes reading `QUEUED` during the upload** is `059-season-pack-acquisition-ui`'s REQ-7
  read-time rule in `ShowsService` (a non-`ERROR`, not-yet-scanned season source lifts every aired
  episode). A `PENDING` session satisfies its condition already; nothing is added for AC-5.
- **The scan** is `worker`'s `selectMode` picking `{ kind: 'season' }` off `seasonId`. Untouched
  (NFR-1) — and untouched is what makes REQ-7's "three files into an eight-episode season" true
  without anyone implementing it.

The alternative considered and rejected was **one `MediaSource` per uploaded file, episode-resolved
in the browser or in `api`**. It would need `SxxEyy` parsing outside `worker` (the only place that
owns it today, `services/worker/src/scan/`), it would multiply a single user action into N racing
sources against N episodes, and it would put a second, divergent episode-resolution rule into the
codebase. The folder design puts zero new knowledge anywhere.

The one genuinely new seam is the pair `startSeasonUpload`/`finishSeasonUpload` bracketing a batch
whose per-file progress only the browser can see. That asymmetry is deliberate and bounded: `api`
never trusts the browser's word about *what* is in the folder — `finishSeasonUpload` counts the
files on disk itself and refuses an empty session — it only trusts it about *when* to stop waiting.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the three mutations, the `SeasonUploadSession` type, the tus session branch and the four new error keys. `web` cannot call a mutation the schema does not have, and cannot translate a key `api` has not defined. |
| 2 | `web` | Consumes the frozen contract: the season modal, the server actions, the catalog entries, and the `FileAcquisitionTarget` widening that supersedes `059`'s REQ-2. |

**No step runs in parallel.** The two slices are small and the `web` slice is almost entirely a
consumer of step 1; starting it before `api` has booted once (and regenerated `schema.gql`) buys
nothing and risks `web` retyping a shape that does not exist. Within step 1, the `seasons/` work
(open/close) and the `uploads/` work (ticket target, tus branch) are independent of each other and
may be done in either order, but both land before `web` starts.

## Contract Freeze

The `## GraphQL Contract Delta` in `../spec.md` is frozen as of `status: Approved`. Things an
implementer will be tempted to change, and must not:

- **Three mutations, not one.** `startSeasonUpload`/`createSeasonUploadTicket`/`finishSeasonUpload`
  will look like they could collapse — "mint the first ticket inside `startSeasonUpload`", or
  "close the session from the last `onUploadFinish`". Neither works: a ticket is single-use and
  there are N files, and `onUploadFinish` has no idea how many files the user selected. The three
  calls are the batch's three moments and stay three.
- **`createSeasonUploadTicket` is a separate mutation, not a fourth argument on
  `createUploadTicket`.** `createUploadTicket`'s exactly-one-of `movieId`/`episodeId` runtime check
  is documented as deliberate in `services/api/src/uploads/uploads.resolver.ts` ("do not 'fix' this
  with a second mutation"); adding a third mutually-exclusive argument makes that check a
  three-way and widens a mutation `web` already calls on two paths. NFR-6 keeps its signature
  exactly as it is.
- **No `cancelSeasonUpload`.** Cancelling is `downloadDelete` (Constitution, Article X). An
  implementer who finds `downloadDelete`'s ownership check or its residue deletion almost-but-not-
  quite right must stop and report rather than adding a parallel delete.
- **`finishSeasonUpload` returns `Season!`, not the session.** It matches `addTorrentToSeason`/
  `addMagnetToSeason`, and `web`'s `AcquisitionResult` success branch carries no payload anyway —
  every caller refreshes the page.
- **`SeasonUploadSession` carries `mediaSourceId` and `seasonId` and nothing else.** No
  `downloadPath`: an absolute container path must never cross the GraphQL boundary (Constitution,
  Article V, NFR-3). `web` never needs to know where the folder is.
- **`error.upload.session_closed` is a `409`, not a `404`.** A session deleted mid-upload is a
  conflict the user caused, and `web` branches on it to stop the batch rather than retry.

If the contract turns out wrong: stop, amend `../spec.md`, re-approve, re-brief both services.
Never patch it from inside one slice (Constitution, Article VIII).

## Migrations

**None.** `SourceKind.LOCAL_FOLDER`, `SourceStatus.PENDING` and `MediaSource.seasonId` all already
exist in `services/api/prisma/schema.prisma`. A session is a row assembled from columns that are
already there, which is what NFR-2 asserts and AC-10 checks
(`git status --short services/api/prisma` empty).

Reversibility: nothing to roll back. Rows created by this feature are ordinary `MediaSource` rows
that every existing reader — `/downloads`, `deriveSourceStatus`, `downloadDelete`, the scan —
already understands.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **A session that is never closed** | The user closes the tab mid-batch. The row sits `PENDING` forever; `059`'s read-time rule keeps every aired episode of that season showing `QUEUED` indefinitely, with no error anywhere and no obvious cause on the show page. | The session is a `MediaSource`, so it is visible on `/downloads` as an active row of that season and deletable there with the button `047` already ships (REQ-10). AC-5 checks the row is listed; AC-6 checks deleting it releases the episodes back to `MISSING`. |
| **A file written outside the session folder** | A forged or stale `mediaSourceId` in tus metadata points at another user's source, or at a source whose `downloadPath` sits outside the downloads root. The file lands somewhere it should not, silently, with a `200` to the browser. | The ticket is bound to the session and verified before the spend (REQ-4/AC-7), and `handleUploadFinish` re-resolves the session row and re-checks `MediaRootsService.isInsideRoot('downloads', downloadPath)` before the `rename` — never trusting the path stored on the row alone (NFR-3). Both are owed tests. |
| **Double-close** | `finishSeasonUpload` called twice (a double click, a retry after a timeout) enqueues two `bull:process` jobs for the same source, and the season is scanned and encoded twice into the same destinations. | The close is guarded on the session's current state (`LOCAL_FOLDER` + `PENDING` + season-scoped); the second call sees `READY` and answers `error.upload.session_not_open`. Same idempotency shape as `handleTorrentCompleted`'s `READY`/`SCANNED` early return. Owed a test. |
| **Filename collision inside the session folder** | Two selected files share a basename after sanitisation (`E01.mkv` from two different folders). The second `rename` silently overwrites the first, and one episode never gets an encode, with no error anywhere. | `handleUploadFinish`'s session branch must not overwrite: on collision it disambiguates with the tus upload id rather than clobbering. Owed a test — this is the archetypal silent failure of Article IX. |
| **A losing session wins anyway** | The season's race is resolved at close time, minutes or hours after the session opened; a torrent may have reached `READY`/`SCANNED` for the same season meanwhile. Without arbitration both would encode into the same destination paths. | `finishSeasonUpload` runs `demoteSupersededSources` then `DownloadsService.resolveRace` — the exact pair both existing upload branches run — and answers `error.upload.superseded` when it is not the winner, rather than returning a success the user reads as "it worked". |
| **The pause control desynchronises** | With N concurrent uploads, a pause that only reaches the currently-visible ones leaves files uploading behind the user's back; the batch's "all terminal" condition then fires early and closes a half-filled folder. | `web` holds every `tus.Upload` instance in one ref and the batch's terminal condition is computed over the full selection, not over the running subset (REQ-5/REQ-6). AC-4 exercises it. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
git diff --stat services/worker          # must be empty (NFR-1 / AC-10)
git status --short services/api/prisma   # must be empty (NFR-2 / AC-10)
git diff services/api/src/schema.gql     # exactly the four additions (AC-12)
```

Then the manual pass, on a running stack with a registered series:

1. Open `/shows/<id>`, confirm the import-file button on a season header is enabled and opens the
   season modal titled `<Show> Temporada N` without toggling the accordion (AC-1).
2. Select three video files named for episodes 1, 2 and 5 of an eight-episode season. Watch three
   progress rows and one overall reading; press pause once and confirm **all three** stop, resume
   and confirm all three continue (AC-4).
3. Mid-batch, in a second tab: `/shows/<id>` shows every aired episode at `QUEUED`, and
   `/downloads` lists the season as one active row (AC-5).
4. After the batch finishes:
   `bin/mysql -e 'select id, kind, status, seasonId, downloadPath from media_sources order by id desc limit 1'`
   shows one `LOCAL_FOLDER` row for the season (AC-2); `bin/bash api` and `ls` that folder shows
   exactly the three files (AC-2); shortly after, the row reads `SCANNED`,
   `bin/mysql -e 'select count(*) from process_jobs where ...'` shows three jobs, and episodes 1, 2
   and 5 advance to `COMPLETED` while 3, 4, 6, 7, 8 stay `MISSING` (AC-3, AC-7 of the spec).
5. Failure pass: start a new batch, and while a file is uploading delete the session from
   `/downloads`. The modal must show the translated `error.upload.session_closed` copy in the
   active locale, the folder must be gone, and the episodes must fall back to `MISSING` (AC-6).
   Switch the UI to `es` and repeat once to confirm the copy is translated, not English (REQ-11).
6. Failure pass: on a season with a `COMPLETED` episode, confirm the replace warning appears before
   the file picker, and that confirming demotes the previous `READY`/`SCANNED` source to `ERROR`
   with `error.source.replaced` (AC-8).

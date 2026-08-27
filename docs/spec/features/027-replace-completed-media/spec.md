---
title: Replace a completed media
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-08-26
last_updated: 2026-08-26
status: Implemented
services: [api, web]
---

# SPEC: Replace a completed media (`spec.md`)

## Context & Goal

A film or an episode that reaches `MediaStatus.COMPLETED` is, today, the end of the road. The file
is in the library and the pipeline considers the request served — but the user is the one who
watches it, and the encode that "succeeded" can still be the wrong cut, the wrong language, out of
sync, or visibly broken. The only way out is to go into the database or the filesystem by hand,
which is not a feature, it is an escape hatch.

The api already has half of what is needed. `MoviesService.attachTorrentSource`,
`EpisodesService.attachTorrentSource` and `SeasonsService.attachTorrentSource` all take a `force`
flag that skips the "already has a source" conflict and, on the episode/season side, demotes the
superseded `MediaSource` to `ERROR` with `error.source.replaced`. What is missing is twofold.
**First**, the file upload path has no `force` at all: `UploadsService.handleUploadFinish` throws a
flat `409` when `Movie.mediaSourceId` is set or a non-`ERROR` `MediaSource` exists for the episode,
and it throws it *after* the whole multi-gigabyte tus upload has landed on disk — the user waits out
the upload to be told no. **Second**, `web` has no way to ask
the user for consent: the only confirmation that exists is the retry-with-`force` in
`SearchTorrent.tsx` and `importMagnetModal.tsx`, and it is triggered by `message.includes()` against
a translated marker string — `errors.movie.*` and `errors.episode.*` are not in
`services/web/messages/{en,es}.json` at all, so the api's English message is what reaches the
browser and the Spanish marker `"ya tiene una descarga en curso"` never matches. In `es`, the
"Reemplazar" button is unreachable today.

Once this ships, a `COMPLETED` film, episode or season can be re-acquired through any of the three
entry points — indexer search, pasted magnet, uploaded file — and each one first shows an explicit
warning naming the file that is about to be replaced.

**Nothing new is needed to destroy the old file, and this feature deliberately builds nothing for
it.** `buildOutputPath` (`services/worker/src/paths/build-output-path.ts`) is a pure function of the
media row and the configured root, so a replacement of the same film or episode resolves to exactly
the path the first encode wrote. `ffmpeg/runner.ts` then muxes into `<final>.part.mkv` beside the
destination and finishes with `rename(partPath, output)` — a POSIX rename between siblings on one
filesystem, which replaces an existing destination atomically. The old file is overwritten in place,
in one instant, with no window in which the library holds nothing. A replacement that never gets
that far leaves the media in `ERROR` with its original `filePath` still valid and the original file
untouched — never `COMPLETED` pointing at nothing, never a deleted file with no replacement.

No pipeline stage in the root `CLAUDE.md` changes status, no stage gains an output, and `worker` is
not touched at all: the transcode path already does the right thing and only `api` and `web` have
work here.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Replace a completed film)**: A film whose `status` is `COMPLETED` must accept a new
      acquisition through indexer search, pasted magnet, or file upload, when the caller confirms
      the replacement. Without confirmation the attempt must be refused.
- [ ] **REQ-2 (Replace a completed episode)**: Same for an episode whose `status` is `COMPLETED`,
      through the same three entry points.
- [ ] **REQ-3 (Replace a season pack)**: Same for `addMagnetToSeason` against a season that already
      has a non-`ERROR` `MediaSource`. A season has no status of its own, so "completed" for a
      season means *at least one of its episodes is `COMPLETED`*; the replacement covers every
      episode the new pack resolves to, and each such episode is treated exactly as REQ-2 treats a
      single one.
- [ ] **REQ-4 (Warning before replacing)**: Before any of the three actions runs against a
      `COMPLETED` target, `web` must show the user an explicit confirmation stating that the file
      currently in the library will be replaced and the old one deleted. The action must not run
      until the user confirms. For a season the confirmation must name how many episodes of that
      season are `COMPLETED`.
- [ ] **REQ-5 (A completed target is a distinct error)**: A non-confirmed acquisition against a
      `COMPLETED` target must fail with an error key distinct from the existing
      `error.*.download_in_progress`, so the consumer can tell "a download is already running" from
      "a finished file is about to be destroyed" and show different copy for each.
- [ ] **REQ-6 (The upload conflict is reported before the upload)**: For the file entry point, the
      conflict — whether `COMPLETED` or merely in progress — must be reported by
      `createUploadTicket`, before the browser sends a single byte. No user may be made to complete
      a multi-gigabyte upload only to receive the conflict at `onUploadFinish`.
- [ ] **REQ-7 (The decision travels in the ticket)**: The confirmation given at
      `createUploadTicket` time must be what `onUploadFinish` acts on. `onUploadFinish` must not
      re-derive the decision from request metadata, and a ticket minted without confirmation must
      not be able to replace anything.
- [ ] **REQ-8 (Nothing is deleted at confirmation time)**: Confirming a replacement must not delete,
      truncate or move the file currently recorded in `filePath`. It stays on disk and `filePath`
      keeps pointing at it for the whole duration of the replacement.
- [ ] **REQ-9 (The old file is replaced in place, not deleted separately)**: The replacement's encode
      must land on the same path the previous one wrote and overwrite it, which is what the existing
      deterministic `buildOutputPath` plus the atomic `rename` at the end of the encode already do.
      This feature must add no deletion of anything under the library root — not in `api`, which
      mounts that volume read-only, and not in `worker`, which is not part of this feature.
- [ ] **REQ-10 (A failed replacement keeps the old file)**: If the replacement fails at any stage —
      the magnet is rejected, the download errors, the scan finds no video, the encode fails — the
      media must end in `ERROR` with `filePath` still pointing at the original, still-existing file.
      A media must never end `COMPLETED` with a `filePath` that no longer exists, and must never end
      with the old file deleted and no replacement in its place.
- [ ] **REQ-11 (Consumers branch on the key, not the message)**: `web` must decide whether to offer
      the replacement confirmation from the error's `extensions.i18n.key` (or the REST envelope's
      `i18n.key`), never by substring-matching the rendered message. The catalogs must carry Spanish
      and English copy for every key this feature relies on, including the pre-existing
      `error.movie.download_in_progress` / `error.episode.download_in_progress` /
      `error.season.download_in_progress` that are missing from them today.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No schema change)**: This feature adds no Prisma model, field, enum value or
      migration.
- [ ] **NFR-2 (Backwards compatible defaults)**: Every new argument defaults to "do not replace".
      A consumer that never sends it keeps exactly today's behaviour.
- [ ] **NFR-3 (No new file deletion anywhere)**: No code added by this feature may unlink, truncate
      or move a file under the library root. The only write to that root stays the encode's own
      atomic `rename`. A diff from this feature containing an `rm`/`unlink` against a library path
      is a defect, not an optimisation.

## GraphQL Contract Delta

```graphql
type Mutation {
  createUploadTicket(movieId: Int, episodeId: Int, force: Boolean = false): UploadTicket!
}
```

That single argument is the whole schema delta. `EncodeCompletedResult` and every other type are
untouched, and `worker` is not a consumer of this feature.

`addTorrentToMovie`, `addMagnetToMovie`, `addTorrentToEpisode`, `addMagnetToEpisode` and
`addMagnetToSeason` keep their existing signatures — all five already carry
`force: Boolean = false`. The only thing that changes for them is the **error** they answer with
when the target is `COMPLETED` rather than merely busy (see the table below). `force: true` keeps
meaning exactly what it means today.

**`createUploadTicket.force`** is the file entry point's twin of the five above. It is the mutation
that performs the conflict check (REQ-6), and the flag is minted **into the ticket payload**, not
read from tus metadata (REQ-7): a ticket minted with `force: false` cannot replace anything, whatever
the browser later sends. `UploadsService.onUploadFinish` reads the decision off the verified ticket.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `addTorrentToMovie`/`addMagnetToMovie`/`createUploadTicket(movieId:)` against a `COMPLETED` film, `force: false` | `ConflictException` — `error.movie.already_completed` | `Esta película ya está descargada. Confirmá para reemplazar el archivo actual.` |
| `addTorrentToEpisode`/`addMagnetToEpisode`/`createUploadTicket(episodeId:)` against a `COMPLETED` episode, `force: false` | `ConflictException` — `error.episode.already_completed` | `Este episodio ya está descargado. Confirmá para reemplazar el archivo actual.` |
| `addMagnetToSeason` against a season with at least one `COMPLETED` episode, `force: false` | `ConflictException` — `error.season.already_completed` | `Esta temporada ya tiene episodios descargados. Confirmá para reemplazar los archivos actuales.` |
| Any of the above against a target that is busy but **not** `COMPLETED`, `force: false` | `ConflictException` — `error.movie.download_in_progress` / `error.episode.download_in_progress` / `error.season.download_in_progress` (existing keys, now actually translated — REQ-11) | `Esta película ya tiene una descarga en curso. Confirmá para reemplazarla.` (and the episode/season twins) |
| `createUploadTicket` for a film/episode the caller does not own | `NotFoundException` — `error.movie.not_found` / `error.episode.not_found` (existing) | unchanged |
| `createUploadTicket` with neither or both of `movieId`/`episodeId` | `BadRequestException` — `error.upload.target_ambiguous` (existing) | unchanged |
| tus `onUploadFinish` with a ticket minted `force: false` while the target became busy mid-upload | `409` REST envelope — `error.movie.download_in_progress` / `error.episode.download_in_progress` (existing) | unchanged |

**What each consumer does with each error.**

`web` — on `error.movie.already_completed` / `error.episode.already_completed` /
`error.season.already_completed`, render the replacement warning (REQ-4) with a confirm control that
re-issues the same call with `force: true`; the copy names the file being destroyed, which is a
different sentence from the busy-target one. On the `*.download_in_progress` keys, keep today's
retry-with-`force` affordance, now selected by key rather than by substring (REQ-11). On the
`not_found` / `target_ambiguous` keys, surface the message and offer no retry. For the file entry
point the check happens at `createUploadTicketAction`, so the warning is shown **before** the file
picker's upload begins.

`worker` — nothing. It is not a consumer of this feature and its slice is empty by design: the
encode already overwrites the previous output atomically (§ Context & Goal), so there is no cleanup
instruction to add and no `EncodeCompletedResult` change to consume.

## Data Model Changes

None.

## Acceptance Criteria

- [x] **AC-1**: Given a film in `COMPLETED`, when a magnet is submitted from the film detail
      screen, then a warning appears naming the file that will be replaced, and no `MediaSource`
      row is created until the user confirms.
- [x] **AC-2**: Given the same film, when the user confirms, then `movies.status` becomes
      `DOWNLOADING`, `movies.file_path` still holds the original path, and the file at that path is
      still on disk — verifiable with `bin/mysql -e 'select status, file_path from movies where id=N'`
      plus `bin/cli worker ls -l <that path>`.
- [x] **AC-3 (failure path)**: Given a replacement in progress for that film, when the download is
      cancelled or the scan finds no video, then `movies.status` is `ERROR`, `movies.file_path` is
      unchanged, and the original file is **still on disk**. Playing it from the media server still
      works.
- [x] **AC-4**: Given the replacement's encode completes, then the title's library folder holds
      **exactly one** file, at the same path as before, whose size or mtime differs from the one
      recorded before the replacement started — the old file was overwritten in place, not
      duplicated. `movies.file_path` is unchanged because the path itself never moved.
- [x] **AC-5**: Given the same replacement, no file under `${HOST_DESTINATIONS_DIR}` other than that
      one is created, modified or removed for the duration — verifiable by comparing
      `bin/cli worker find <library root> -newermt <start time>` before and after against the single
      expected path.
- [x] **AC-6 (failure path)**: `createUploadTicket(movieId: <a COMPLETED film>)` with no `force`
      returns a GraphQL error carrying `extensions.i18n.key = "error.movie.already_completed"`, and
      no ticket is minted. The browser never starts the upload.
- [x] **AC-7**: `createUploadTicket(movieId: <the same film>, force: true)` mints a ticket; uploading
      a file with it succeeds through `onUploadFinish`, creating a `LOCAL_FILE` `MediaSource` and
      setting the film to `ENCODING`.
- [x] **AC-8 (failure path)**: A ticket minted with `force: false` for a film that is *not* busy, used
      for an upload that finishes after that film acquired a source, is refused at `onUploadFinish`
      with a `409` and the uploaded file is not adopted — the ticket's own decision governs, and no
      tus metadata key can turn a non-forcing ticket into a forcing one (REQ-7).
- [x] **AC-9**: With the UI locale set to `es`, the conflict and replacement messages render in
      Spanish (no English text leaks through), and the confirm control appears — the case that is
      broken today because `errors.movie.*` is absent from `services/web/messages/es.json`.
- [x] **AC-10**: `addMagnetToSeason(seasonId: <season with COMPLETED episodes>, magnet: …)` without
      `force` fails with `error.season.already_completed`; with `force: true` it proceeds, and each
      episode the new pack resolves to follows AC-2 through AC-5 individually.
- [x] **AC-11**: `bin/npm api test` passes and `bin/npm web run build` exits 0.
- [x] **AC-12**: `git diff` for this feature contains no `rm`, `unlink` or `rename` against a
      library path, and `services/worker/` is untouched (NFR-3).

## Out of Scope

- **Automatic quality upgrades.** Nothing here watches for a better release or re-downloads on its
  own. Replacement is always a deliberate, confirmed user action — see
  `005-movie-search` and the project's positioning against the \*arr stack.
- **Deleting a title from the library.** Removing a film/episode and its file altogether is a
  different action with a different confirmation; `downloadRemove` covers the download side only and
  is untouched here.
- **Re-acquiring an `ERROR` media.** That already works today through the existing `force` path and
  needs no warning — there is no good file to destroy.
- **Keeping the old file as a backup.** The old output is overwritten, not renamed aside. Versioned
  library files would need a retention policy, a way to browse them, and disk-space accounting; none
  of that is asked for.
- **Cleaning up an orphan when the output path genuinely moved.** Three things can make a
  replacement land on a *different* path than the first encode: `path_movies`/`path_shows` edited in
  Settings between the two encodes; `episode.title` rewritten by a re-hydrate, which only happens
  when the show's first hydration failed partway (`ShowsService.hydrate` runs only while
  `seasonsSyncedAt` is null); and rows whose `filePath` predates a change in `buildOutputPath`'s
  naming rules. In those cases the old file stays behind and the media server shows a duplicate.
  A cleanup mechanism was specified and then removed: it required a new GraphQL field, a path
  computation in `api`, a guarded deletion in `worker`, and it carried the worst failure mode in the
  feature — a mis-anchored relative path deleting a different, healthy title with nothing failing
  anywhere. For the most plausible trigger of the three (the edited setting) it would have refused to
  act regardless, since the old path no longer resolves under the new root. The orphan is a nuisance,
  not data loss; the deletion can be added later, by whoever has a real occurrence in hand
  (Constitution, Article X).
- **A web UI for season packs.** REQ-3 gives `addMagnetToSeason` the same semantics, but the
  api-only nature of that mutation (root `CLAUDE.md` § Current state) is unchanged — REQ-4's
  season-shaped confirmation copy is specified so that the eventual UI has a contract to build
  against, not because this feature ships that screen.

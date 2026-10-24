---
title: Jellyfin Subtitle Embed — api slice
service: api
last_updated: 2026-10-23
status: Implemented
---

# PLAN: Jellyfin Subtitle Embed — `api` (`api/plan.md`)

## Scope

`api` owns:

- the `SubtitleEmbed` model and migration;
- the Jellyfin sidecar listing and the post-embed refresh;
- the listing fields on `Movie`/`Episode`;
- the two admin mutations, with every refusal in the spec's error table;
- the `subtitle-embed` BullMQ producer;
- the three service-only worker reports and `subtitleEmbedDetails`;
- the reverse busy guard on acquisition;
- the crash reconcile.

It does **not** run mkvmerge, decode charsets, apply offsets, copy subtitle bytes, or write or delete
anything on disk. The destinations root stays mounted read-only here and `api` only `stat`s in it.
It never calls Jellyfin's `DeleteSubtitle` and never uses a Jellyfin stream index.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` + `prisma/migrations/<ts>_add_subtitle_embed/` | Modified / New | `SubtitleEmbedStatus` enum, `SubtitleEmbed` model, back-relations on `Movie`/`Episode` |
| `src/clients/media-server/types.ts` | Modified | Optional members `listItemSubtitles(itemId)`, `listSeriesEpisodeSubtitles(seriesId)`, `modifiedMedia(hostPath)`; types `ExternalSubtitleStream` (`hostPath`, `languageIso3`, `isForced`, `displayTitle`) and `ItemSubtitles` (`itemId`, `mediaHostPath`, `subtitles`) |
| `src/clients/media-server/jellyfin.ts` | Modified | `Items/{id}?fields=MediaStreams,Path`, `Shows/{id}/Episodes?isMissing=false&fields=MediaStreams,Path`, `Library/Media/Updated` with `UpdateType: 'Modified'`; a pure `toExternalSubtitles(mediaPath, streams)` |
| `src/clients/media-server/jellyfin.spec.ts` | Modified | Filter and episode-match cases |
| `src/media-roots/media-roots.service.ts` (+ spec) | Modified | `hostToContainerPath(rootId, hostAbsolutePath)`, the twin of `containerToHostPath` |
| `src/media-server/media-server.service.ts` | Modified | Extract the client construction `notifyCreated` does into one method the new module calls |
| `src/subtitle-embed/` (module, resolver, service, entities, dto, specs) | New | Everything below |
| `src/queue/types.ts`, `src/queue/subtitle-embed-queue.service.ts`, `src/queue/queue.module.ts` | Modified / New | `SUBTITLE_EMBED_QUEUE`, `SUBTITLE_EMBED_JOB`, `SubtitleEmbedJob = { subtitleEmbedId: number }`, producer |
| `src/acquisition/attach-source.service.ts` | Modified | Reverse busy guard (REQ-16) |
| `src/uploads/uploads.resolver.ts`, `src/seasons/seasons.service.ts` | Modified | Same guard on `createUploadTicket` and `startSeasonUpload` |
| `src/process-jobs/process-jobs.service.ts` | Modified | `reconcileOrphanedEncodes` also fails `RUNNING` embeds (NFR-3) |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | Every `error.subtitleEmbed.*` key in the spec's two tables, with English messages |

## Existing code to reuse

- `src/clients/media-server/jellyfin.ts`: the `authHeader` scheme (Jellyfin 12 accepts nothing
  else), `READ_TIMEOUT_MS`, the `!response.ok` throw shape, `createdMedia`'s
  `Library/Media/Updated` body (same endpoint, `UpdateType: 'Modified'`), and `toPresentEpisodes`'s
  season/episode matching and `Virtual` exclusion.
- `src/media-server/media-server.service.ts`: building a client from Settings
  (`createMediaServerClient` + the index port). Extract it; do not copy it. `notifyCreated`'s
  `containerToHostPath('library', …)` translation is the model for the refresh call.
- `findByTmdbId` (index-backed for Jellyfin): resolves the film or series item id.
- `src/media-roots/media-roots.service.ts`: `containerToHostPath` for the shape of the reverse
  method; `isInsideRoot('library', …)` for containment.
- `src/ffprobe-logs/ffprobe-logs.resolver.ts`: per-method `@UseGuards(AdminGuard)` beside
  `@AllowService()` methods in one resolver.
- `src/process-jobs/process-jobs.resolver.ts`: `encodeWorkerStarted`'s `@AllowService()` plus the
  explicit `principal.type !== 'service'` rejection.
- `MoviesService.findOneFromDb(id, userId)` and `EpisodesService.findOneFromDb(id, userId)`.
- `src/pipeline-status/pipeline-status.ts`: `IN_FLIGHT_ENCODE_STATUSES`, `hasPossession` /
  `POSSESSION_WHERE`, and the season-pack lift predicate. Do not write a new definition.
- `src/queue/encode-queue.service.ts`: the producer shape. Use `jobId: embed-<id>` and
  `attempts: 1`.
- `src/languages/`: the base row by `iso3` (the row whose `tag` equals its `iso2`, the test
  `findAll()` uses) for `trackTitle`.
- `src/i18n/i18n-error.ts` for every refusal.

## Steps

1. **Migration.** Model and enum per `../plan.md` § Migrations. `bin/npm api run prisma:migrate`,
   then confirm `git status services/api/prisma/` shows both files (Article III).
2. **Jellyfin client.** Add the optional members to `types.ts` and implement them in `jellyfin.ts`.
   The pure `toExternalSubtitles(mediaPath, streams)` keeps a stream only if all of these hold:
   - `Type === 'Subtitle'`, `IsExternal`, `Codec === 'subrip'`;
   - `Path` ends in `.srt` (case-insensitive);
   - `dirname(Path) === dirname(mediaPath)`.

   It maps `DisplayTitle` to `displayTitle` and normalizes a missing `Language` to `null`. The
   stream `Index` is not read. `listSeriesEpisodeSubtitles` returns a `Map` keyed `S:E` of
   `ItemSubtitles` over the one `Shows/{id}/Episodes` call. `modifiedMedia` is `createdMedia` with
   the other update type; share the request body builder rather than duplicating it.
3. **Path translation.** `MediaRootsService.hostToContainerPath`, answering `null` for a relative
   `hostPath` or a path outside the root.
4. **Listing fields.** `@ResolveField externalSubtitles` and `subtitleEmbed` on `Movie` and on
   `Episode`, delegating to `SubtitleEmbedService`.
   - `externalSubtitles` maps each stream to `{ fileName: basename(hostPath), languageIso3,
     isForced, title: displayTitle }`.
   - It returns `[]` with no Jellyfin call for a non-administrator. Re-read `isAdmin` from the DB,
     as `AdminGuard` does; do not apply the guard itself, which would throw.
   - Every failure is caught, logged and returns `[]`.
   - For episodes, memoize the series listing on the GraphQL request context, keyed by series id
     (NFR-2).
5. **Embed mutation** (`embedMovieSubtitles` / `embedEpisodeSubtitles`, one service method
   parameterized by target, Article X). Order of checks:
   1. admin;
   2. visible;
   3. the client has the optional members, else `unsupported_media_server`;
   4. input validation: `empty_selection`, `duplicate_subtitle`, `multiple_defaults`,
      `offset_out_of_range`, `unknown_language`. A `fileName` containing `/`, `\` or `..` is
      `stale_listing`;
   5. possession, else `no_file`;
   6. resolve the `.mkv` per REQ-13: `filePath` first, else Jellyfin's item path via
      `hostToContainerPath`. It must exist (`stat` on the read-only mount), end in `.mkv`, and be
      `isInsideRoot('library')`;
   7. busy (REQ-16);
   8. re-read Jellyfin (an unreachable one here is `media_server_unavailable`) and require every
      requested `fileName` to be listed. Build each `sourcePath = join(dirname(mkv), fileName)` and
      `stat` it; any miss is `stale_listing`;
   9. create the row `QUEUED` (`filePath`, `tracks` with `fileName`, `languageIso3`, resolved
      `trackTitle`, `isDefault`, `isForced` from Jellyfin, `offsetMs`);
   10. enqueue. Return the row.

   Do the busy check and the insert in one `$transaction` that re-checks "no `QUEUED`/`RUNNING`
   embed for this target" before the insert.
6. **Worker reports.**
   - `subtitleEmbedStarted`: guarded `updateMany` `QUEUED → RUNNING`, answers whether it changed.
   - `subtitleEmbedFailed`: `QUEUED|RUNNING → FAILED` with the key and `finishedAt`. A repeat answers
     `true` and writes nothing.
   - `subtitleEmbedCompleted(id, warningKey)`: `RUNNING → COMPLETED` with `finishedAt` and the
     worker's `warningKey`, which must be `null` or `sidecar_delete_failed`; anything else is logged
     and stored as `sidecar_delete_failed`. Only when this call made the transition, notify Jellyfin
     with `modifiedMedia(containerToHostPath('library', filePath))`. On failure (no client, an
     untranslatable path, an HTTP error), log it, and if `warningKey` is still `null` set it to
     `jellyfin_refresh_failed`. The worker's warning takes precedence. Never fail the mutation. A
     repeat answers `true` and does nothing.
   - `subtitleEmbedDetails`: answers for any status. `filePath` comes from the row; each
     `sourcePath` is `join(dirname(filePath), fileName)`.
7. **Reverse guard.** `hasActiveEmbed(target)` is exported from a leaf provider that
   `AcquisitionModule`, `UploadsModule` and `SeasonsModule` can import without a cycle (the
   `MediaCapabilitiesModule` precedent; no `forwardRef`). `AttachSourceService.attach()` calls it
   right before `targetDef.refuse(...)`. A season target checks every episode of the season.
   `createUploadTicket` and `startSeasonUpload` call it before minting or opening. It throws
   `error.subtitleEmbed.busy`.
8. **Crash reconcile.** In `reconcileOrphanedEncodes`, also `updateMany` every `RUNNING` embed to
   `FAILED` / `interrupted` with `finishedAt`. The returned count stays the encode count.

## Contract obligations

Expose exactly `../spec.md` § GraphQL Contract Delta (v0.2.0):

- `ExternalSubtitle.fileName` is a base name.
- `title` is Jellyfin's `DisplayTitle`.
- `SubtitleEmbedTrack.sourcePath` is a container path in the `.mkv`'s directory.
- `trackTitle` comes from the base `Language` row.
- `subtitleEmbed` is the latest row by `createdAt`.
- Both tables' keys exist in `error-keys.ts` and `messages.en.ts`.
- An `errorKey` from the worker that is not one of `subtitle_unreadable`, `charset_undetected`,
  `remux_failed`, `verify_failed`, `not_writable` is stored as `remux_failed` and logged.
- `queue/types.ts` is the source of truth the worker copies by hand.

## Tests

Owed under Article IX (each verified to fail when its rule is removed):

- `src/clients/media-server/jellyfin.spec.ts`: `toExternalSubtitles` drops embedded streams, non-
  `subrip` codecs, path-less entries, a `.srt` in another directory (Jellyfin's metadata folder) and
  a non-`.srt` name, and keeps `null` language as `null`. The episode map matches by season/episode
  and excludes `Virtual`. `modifiedMedia` sends `UpdateType: 'Modified'`.
- `src/media-roots/media-roots.service.spec.ts`: `hostToContainerPath` refuses outside-root and
  relative-host cases.
- `src/subtitle-embed/subtitle-embed.service.spec.ts`:
  - a non-administrator gets `[]` and no client call;
  - an unreachable Jellyfin gets `[]`, not a throw;
  - each validation refusal;
  - a `fileName` with `../` is `stale_listing`;
  - a name no longer listed, or listed but missing on disk, is `stale_listing`;
  - `busy` with a `DOWNLOADING` source, a `STOPPED` job, and a season pack in flight;
  - a second concurrent embed is refused;
  - `trackTitle` is the base row, never `es-419`'s;
  - `subtitleEmbedDetails` builds `sourcePath` in `filePath`'s directory;
  - `subtitleEmbedCompleted` notifies once, sets `jellyfin_refresh_failed` on a refresh error,
    keeps the worker's `sidecar_delete_failed` over it, and does nothing on a repeat;
  - an unknown worker key is stored as `remux_failed`.
- `src/acquisition/attach-source.service.spec.ts`: attach refused while an embed is `RUNNING`, for a
  film, an episode, and a season whose episode has one.
- `src/process-jobs/process-jobs.service.spec.ts`: a `RUNNING` embed becomes `FAILED`/`interrupted`
  on `encodeWorkerStarted`; `QUEUED` and `COMPLETED` are untouched.

Not owed: resolver wiring beyond the admin and service-only checks; the queue producer.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/npm api run lint
bin/comments api
bin/cli api npx prisma migrate status
git diff services/api/src/schema.gql
grep -rn "unlink\|rmSync\|rm(" services/api/src/subtitle-embed
```

Typecheck is 0 errors. Tests are green, with the counts reported. `migrate status` is up to date.
The `schema.gql` diff equals the spec's delta and nothing else. The last grep is empty.

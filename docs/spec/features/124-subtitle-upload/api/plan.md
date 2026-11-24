---
title: Subtitle Upload — api slice
service: api
last_updated: 2026-11-24
status: Approved
---

# PLAN: Subtitle Upload — `api` (`api/plan.md`)

## Scope

`api` exposes `uploadMovieSubtitles`/`uploadEpisodeSubtitles`. Both validate the request in the
spec's refusal order, decode and normalize each file, stage it under the downloads root, and turn the
upload into an ordinary staged `SubtitleEmbed` through `SubtitleEmbedService.embedStaged`. `api` also
makes `113`'s automatic-offset measurement read a staged track's path, removes an upload's staging
when its embed ends, sweeps leftovers at boot, and raises the request-body limit for `/graphql`.

What `api` does **not** do: no worker change (the worker already embeds staged, non-sidecar tracks
and measures any `candidatePath`), no schema migration, and no change to `101`'s
`embedMovieSubtitles`/`embedEpisodeSubtitles` or to the subtitle search.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/subtitle-upload/subtitle-upload.module.ts` | New | Imports `SubtitleEmbedModule`, `LibraryLocationModule`, Prisma. |
| `src/subtitle-upload/subtitle-upload.resolver.ts` | New | The two mutations, user-authenticated, never `@AllowService`. |
| `src/subtitle-upload/subtitle-upload.service.ts` | New | Validation, decoding, normalization, path resolution, the `embedStaged` call. |
| `src/subtitle-upload/dto/subtitle-upload.input.ts` | New | `SubtitleUploadInput` exactly as the spec's SDL. |
| `src/subtitle-upload/decode-upload.ts` | New | Pure: base64 → bytes → UTF-8 text or a refusal key (size, undecodable, charset, no cue). |
| `src/media-roots/staging-directory.ts` | New | Generic `write`/`removeDir`/`sweep` over one `.perceptor/<segment>` directory in the downloads root, extracted from `subtitle-search/staging.ts`. |
| `src/subtitle-search/staging.ts` | Modified | `SubtitleSearchStaging` delegates to `StagingDirectory('subtitle-search')`; public API unchanged. |
| `src/subtitle-embed/upload-staging.ts` | New | `SubtitleUploadStaging` (`StagingDirectory('subtitle-upload')`): `write(embedId, index, bytes)`, `removeEmbed(embedId)`, boot sweep keeping active embeds. |
| `src/subtitle-embed/subtitle-embed.service.ts` | Modified | `StagedTrackInput` gains optional `fileName`, `isDefault`, `isForced`, `autoOffset`; `embedStaged` gains an optional `stage` callback; `completed`/`failed` remove upload staging. |
| `src/subtitle-embed/subtitle-embed-sync.service.ts` | Modified | `candidatePath` and the last-cue read use `stagedPath` when present; terminal `FAILED` paths remove upload staging. |
| `src/subtitle-embed/subtitle-embed.module.ts` | Modified | Provides and exports `SubtitleUploadStaging`. |
| `src/subtitle-search/entities/subtitle-search.entity.ts` (or the existing constants file) | Modified | Export one `NON_TERMINAL_SUBTITLE_SEARCH_STATUSES`; the two private copies in `subtitle-search.driver.ts` and `subtitle-search-request.service.ts` import it. |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | `upload_too_many`, `upload_not_srt`, `upload_too_large`, `replace_forced`, `upload_staging_failed`. |
| `src/main.ts` | Modified | `/graphql` gets its own `json({ limit: '32mb' })` before the global 2 MB parser. |
| `src/app.module.ts` | Modified | Imports `SubtitleUploadModule`. |
| `services/api/CLAUDE.md` | Modified | One `subtitle-upload/` entry, and the Article XII v1.9.0 note. |

## Existing code to reuse

- `src/subtitle-embed/subtitle-embed.service.ts` — `embedStaged` (the only path the constitution
  allows), `assertManualSearchPreflight` (ownership by `userId`, `no_file`, `.mkv`/inside-library for
  a `filePath`, busy), `assertUsableMkv`, `lookupBaseTitles` and `VARIANT_TRACK_TITLES` (already
  used by `embedStaged` for `variantTag`, so passing the chosen tag as `variantTag` yields `Latino` /
  `Español (España)` and the base title otherwise), `queueEmbed`'s delete-row-on-enqueue-failure.
- `src/subtitle-embed/subtitle-embed-sync.service.ts` — `113`'s whole SYNCING lifecycle, unchanged
  apart from the path.
- `src/subtitle-search/to-utf8.ts` — charset normalization (BOM, UTF-8, cp1252 fallback).
- `src/subtitle-search/last-cue.ts` — `lastCueEndMs(text) !== null` is "at least one cue".
- `src/library-location/library-location.service.ts` — `locate()` for a title with no `filePath`.
- `src/subtitle-search/staging.ts` — the body `StagingDirectory` is extracted from.
- `src/i18n/i18n-error.ts` — `i18nError.badRequest/conflict/notFound/serviceUnavailable`.
- `src/subtitle-embed/subtitle-embed.resolver.ts` — resolver shape and `userIdOf(principal)`.

## Steps

1. **Error keys.** Add the five new `error.subtitleEmbed.*` keys and their English messages.
2. **`StagingDirectory`.** Extract it from `subtitle-search/staging.ts` (`write`, `removeDir`,
   `sweep(keep)`), every removal resolved inside the downloads root first (Article V/XII). Re-point
   `SubtitleSearchStaging` at it with no behaviour change. Its existing tests must still pass
   untouched.
3. **`SubtitleUploadStaging`** in `subtitle-embed/`: `write(embedId, index, bytes)` →
   `.perceptor/subtitle-upload/<embedId>/<index>.srt`; `removeEmbed(embedId)` logs on failure and
   never throws; `onApplicationBootstrap` sweeps every directory whose embed is missing or not in
   `ACTIVE_EMBED_STATUSES`.
4. **`embedStaged` extension**:
   - `StagedTrackInput` gains `fileName?` (stored as the track's `fileName` instead of
     `basename(stagedPath)`), `isDefault?`, `isForced?` and `autoOffset?`. With `autoOffset`, the
     offset range check is skipped and `offsetMs: 0, autoOffset: true` are stored, so `queueEmbed`
     already picks `SYNCING`.
   - A new optional last parameter `stage?: (embedId: number) => Promise<string[]>` returns the
     staged paths in track order. When it is given, `stagedPath` may be absent on input. `queueEmbed`
     calls it right after `createGuarded`, checks each returned path is inside the downloads root,
     writes them into the row's `tracks`, then enqueues. On any throw it deletes the row, removes the
     upload staging and rethrows.
   - `103`'s existing calls pass neither, so behaviour is identical.
5. **Sync path.** In `SubtitleEmbedSyncService.details` and `completed`, use
   `track.stagedPath ?? join(dirname(row.filePath), fileName)`. Add `stagedPath?` to its `SyncTrack`
   type.
6. **Terminal cleanup.** `SubtitleEmbedService.completed` (after the claim) and `failed`, and
   `SubtitleEmbedSyncService`'s three `FAILED` writes (rejection, `failed`, `enqueueRemux`'s catch),
   call `uploadStaging.removeEmbed(id)`. It is a no-op for a non-upload embed (the directory does not
   exist). Do **not** reach into `process-jobs/`'s `interrupted` reconcile; the boot sweep covers it
   (AC-13).
7. **`decode-upload.ts`** (pure). In order:
   - strict base64 (`/^[A-Za-z0-9+/]*={0,2}$/` with length % 4 === 0) → `upload_not_srt`;
   - decoded length > 2 MiB → `upload_too_large`;
   - `toUtf8`, then a text containing `U+0000` or `U+FFFD` → `charset_undetected`;
   - `lastCueEndMs(text) === null` → `upload_not_srt`;
   - otherwise return the UTF-8 bytes.
8. **`SubtitleUploadService.upload(ref, inputs, userId)`**, refusals in the spec's table order:
   1. ownership (`findFirst` with the owner filter, the existing `movie`/`episode` not-found keys);
   2. empty → `empty_selection`; more than 8 → `upload_too_many`;
   3. each `fileName` a bare name ending in `.srt` (case-insensitive) → `upload_not_srt`;
   4. duplicate names → `duplicate_subtitle`; more than one default → `multiple_defaults`;
   5. each `languageTag` resolved to a `Language` row → `unknown_language` with `{ language }`;
   6. manual offsets in range → `offset_out_of_range`;
   7. `replace && isForced` → `replace_forced`;
   8. `replace` language (the row's `iso3`) not in the title's lower-cased `fileSubtitleLanguages`,
      or that column `null` → `error.subtitleSearch.replace_language_not_present`;
   9. `decode-upload` for every file;
   10. `embed.assertManualSearchPreflight(ref, userId)` for `no_file`, `.mkv`/library and busy;
   11. for no `filePath`, `LibraryLocationService.locate`: `unavailable` → `serviceUnavailable`
       `error.subtitleEmbed.media_server_unavailable`; `outside_library` → `outside_library`; any
       other miss → `no_file`; a found path → `assertUsableMkv`;
   12. a non-terminal `SubtitleSearch` of the target → `error.subtitleSearch.in_progress`.

   Then call `embedStaged(ref, tracks, mkvPath, replaceIso3s, stage)` with:
   - `languageIso3` from the row;
   - `variantTag` the chosen tag;
   - `provenance` the original file name (`123`'s `SOURCE`) and `provider: 'user'`;
   - the forced/default/auto flags;
   - `stage` writing each normalized buffer through `SubtitleUploadStaging.write`.

   A staging write error becomes `InternalServerError` `upload_staging_failed`. `embedStaged`'s own
   busy re-check inside the transaction stays the authority.
9. **Resolver.** Add `uploadMovieSubtitles`/`uploadEpisodeSubtitles` with the global auth guard and
   no `AdminGuard`. Both return `SubtitleEmbed`.
10. **Body limit.** In `main.ts`, register `app.use('/graphql', json({ limit: '32mb' }))` ahead of the
    global `skipUploads(json({ limit: '2mb' }))` (which must then skip a body already parsed).
    Check that a 25 MB GraphQL request reaches the resolver and a 33 MB one gets 413.
11. **`NON_TERMINAL` export.** Use the one shared constant for step 8.12 and the two existing private
    copies.
12. **Docs.** Add a `services/api/CLAUDE.md` `subtitle-upload/` entry naming the `embedStaged` caller
    rule (constitution v1.9.0).

## Contract obligations

Expose exactly `../spec.md` § GraphQL Contract Delta: `SubtitleUploadInput` (fields, types and
non-null as written, with the descriptions), the two mutations returning `SubtitleEmbed!`, and every
refusal in the table with its exception class and key. `SubtitleEmbedDetails`,
`SubtitleEmbedTrack`, `SubtitleEmbedSyncDetails` and the two queue payloads must not gain or lose a
field. For an upload, `details()` must serve:
- `isSidecar: false`;
- `sourcePath` the staged path;
- `provenance` the uploaded base name;
- `provider: 'user'`;
- `replaceLanguagesIso3` the ticked rows' ISO 3 codes.

`subtitleEmbedSyncDetails` must serve `candidatePath` = the staged path. The read-only delta is in
`../spec.md`. If it is wrong, stop and report.

## Tests

Owed under Article IX (each fails when the rule is removed):

- `src/subtitle-upload/decode-upload.spec.ts`:
  - a cp1252 `¿Señor?` comes out as UTF-8 intact;
  - a UTF-8 BOM is accepted;
  - bytes with NUL → `charset_undetected`;
  - text with no cue → `upload_not_srt`;
  - invalid base64 → `upload_not_srt`;
  - 2 MiB + 1 byte → `upload_too_large`.
- `src/subtitle-upload/subtitle-upload.service.spec.ts`:
  - a non-owner → `movie.not_found`;
  - 9 entries → `upload_too_many`;
  - `x.txt` and `../a.srt` → `upload_not_srt`;
  - `replace` on a forced row → `replace_forced`;
  - `replace` for a language not in `fileSubtitleLanguages` and for a `null` column →
    `replace_language_not_present`;
  - a busy title → `busy` and nothing staged;
  - a running search → `in_progress`;
  - an `es-419` row stored with `trackTitle: 'Latino'`, `provider: 'user'`, `provenance` = the file
    name;
  - `isDefault`/`isForced` reach the stored track;
  - an automatic row → `SYNCING`;
  - the media-server `unavailable` → `serviceUnavailable` with the `subtitleEmbed` key.
- `src/subtitle-embed/subtitle-embed.service.spec.ts`:
  - `embedStaged` with `stage` writes paths after the row exists, and deletes the row and the
    directory when `stage` throws;
  - `details()` of an upload track returns `isSidecar: false` and `sourcePath === stagedPath`;
  - `completed`/`failed` call `removeEmbed`.
- `src/subtitle-embed/subtitle-embed-sync.service.spec.ts`:
  - `details` for a staged track returns `candidatePath === stagedPath`;
  - `completed` reads the last cue from `stagedPath`;
  - a rejection removes the staging.
- `src/subtitle-embed/upload-staging.spec.ts`: the boot sweep keeps an active embed's directory and
  removes a terminal or unknown one, and never touches a path outside the downloads root.
- `src/subtitle-search/staging.spec.ts` (existing): must pass unchanged after the extraction.

Not owed: the resolver (thin delegation, covered by the service specs) and the `main.ts` body limit,
which is proven by the AC-12 manual pass because it is Express wiring with no logic to unit-test.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/npm api run lint
bin/comments api
```

All pass, and `grep -rn "embedStaged" services/api/src --include=*.ts | grep -v spec.ts` shows
callers only in `subtitle-search/` and `subtitle-upload/` (constitution v1.9.0 Check).

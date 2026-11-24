---
title: Subtitle Upload — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-11-24
status: Approved
---

# PLAN: Subtitle Upload (`plan.md`)

## Approach

An upload is a `103`-style **staged embed** whose subtitles come from the browser instead of a
provider. Almost everything already exists:

- `SubtitleEmbedService.embedStaged` (`services/api/src/subtitle-embed/subtitle-embed.service.ts`)
  already creates a `SubtitleEmbed` with staged, non-sidecar tracks, checks busy inside a
  serializable transaction (`createGuarded`), routes to `SYNCING` or `QUEUED` (`queueEmbed`), and
  carries `replaceLanguages` (`119`). Constitution v1.9.0's Check requires that the upload reach the
  remux **through `embedStaged`**, so the plan extends that method instead of adding a sibling.
- `SubtitleEmbedSyncService` (`113`) measures automatic tracks. Today it builds `candidatePath`
  and reads the last cue from `join(dirname(filePath), fileName)`, which is sidecar-only. Both sites
  switch to `track.stagedPath ?? join(...)`. The worker contract stays the same, because
  `candidatePath` is already a container path the worker reads blindly.
- Charset normalization is `subtitle-search/to-utf8.ts` (`121`). Cue detection is
  `subtitle-search/last-cue.ts`'s `lastCueEndMs` (non-null means at least one cue).
- Locating a file held only through the media server is `LibraryLocationService.locate`
  (`library-location/`), which `106`/`107` already use. The upload maps its outcomes to the spec's
  keys itself. It does not call the search's private `resolveLibraryPath`, whose keys are
  `subtitleSearch.*`.
- The downloads-root staging is `subtitle-search/staging.ts`'s `SubtitleSearchStaging`. Its
  write/remove/sweep body is generalized into a small `StagingDirectory` parameterized by its
  segment, so `.perceptor/subtitle-search` and `.perceptor/subtitle-upload` share one
  implementation.
- On completion, the media-server notification, `108`'s library re-probe and `123`'s tags are
  already done by `SubtitleEmbedService.completed` and the worker for every embed.

The new surface is a `subtitle-upload/` module in `api`: a resolver for the two mutations and a
service that validates, decodes, normalizes and stages the files, then calls `embedStaged`.
`embedStaged` gains an optional **stage callback**, run between the row's creation and the enqueue,
so files land in `.perceptor/subtitle-upload/<embedId>/` (REQ-12) before the worker can be asked to
read them. If staging fails, the row is deleted, as `queueEmbed` already does when the enqueue
fails.

In `web`, the request travels as base64 strings through one server action, read in the browser
with the File API. One alternative was a second tus route, but Article II reserves REST for multi-GB
media, and a subtitle fits one GraphQL request. The other was multipart GraphQL, which has no
precedent in `api` (no `graphql-upload`) and would add a dependency to move at most 16 MiB.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the two mutations, the staging, the body-size limit and the `embedStaged`/sync changes `web` calls through. |
| 2 | `web` | Calls `uploadMovieSubtitles`/`uploadEpisodeSubtitles` and renders their refusals. |

The contract is frozen in `spec.md`, so the two slices can run **in parallel**. `web` can build the
dialog, the file-name preset and the server action against the frozen SDL. Only the manual pass
needs both.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will want to change and must not:

- **`contentBase64: String!`, not `content: String!` (text).** Text would force `web` to decode the
  bytes as UTF-8 and destroy a cp1252 file's `ñ` before `api` sees it, so REQ-8 would silently fail.
  `api` must receive the raw bytes.
- **`languageTag`, not `languageIso3` as in `101`'s input.** The tag is what lets a user pick
  Latino vs Español (España). Do not "align" it with `SubtitleEmbedInput`.
- **`replace` is per row, but the embed stores one `replaceLanguages` list** (`119`'s column and
  `SubtitleEmbedDetails.replaceLanguagesIso3`). Two rows of the same language with different
  `replace` values both contribute to the list if either is ticked. That is correct, because the
  worker only ever drops the file's **existing** tracks, never the new ones.
- **`media_server_unavailable` is `error.subtitleEmbed.*` (ServiceUnavailable)**, not the search's
  `error.subtitleSearch.media_server_unavailable` (BadRequest) that `LibraryLocationService` callers
  use today. Do not reuse the search's mapping.
- **The worker contract does not move.** No new field on `SubtitleEmbedDetails`,
  `SubtitleEmbedTrack` or `SubtitleEmbedSyncDetails`. If a slice believes the worker needs to know
  "this is an upload", stop and report.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, and re-brief both
slices (Article VIII).

## Migrations

None. The upload is an ordinary `SubtitleEmbed` row. `tracks` (JSON) already holds `stagedPath`,
`provenance`, `provider`, `autoOffset` and the per-track flags, and `replaceLanguages` is `119`'s
column.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `web` reads the file as text | The cp1252 `ñ` becomes `�` before `api` normalizes; the track embeds "fine" with broken characters; no error anywhere | `web` reads the file as bytes (`arrayBuffer`) and base64-encodes it. AC-7 in the manual pass with a real cp1252 file. |
| Body limits | `api`'s global `json({ limit: '2mb' })` (`main.ts`) or Next's 1 MB server-action default cuts a legitimate 8×2 MiB request; the user sees a generic network error, not a key | `api` raises the limit for `/graphql` only (32 MB); `web` raises `serverActions.bodySizeLimit` (24 MB); AC-12 sends the maximum through the dialog. |
| Sync reads the wrong path | `113`'s `candidatePath`/last-cue read still joins `fileName` onto the library folder; the worker measures a missing file and every automatic upload fails `sync_failed`, or the coverage check reads `null` | Both sites use `stagedPath` when present; `api` test asserts `candidatePath === stagedPath` for a staged track. |
| Staging outlives the embed | A failed or interrupted upload leaves `.srt` copies under the downloads root forever, with no error | Removal on `COMPLETED`/`FAILED` in `api`'s transition points plus a boot sweep keyed on active embeds; tests for both. Interrupted embeds (worker boot) are swept at `api`'s next boot (AC-13). |
| Staging before the row | Files written, then `createGuarded` refuses busy, leaving an orphan dir under an id that never existed | The stage callback runs **after** the row exists; a failure deletes the row and the dir. |
| Search starts between the check and the embed | Upload's "no search in progress" check and search creation are not in one transaction; a search could probe a file about to be remuxed | Accepted: a search refuses on `busy` once the embed row exists (`106`), so the window is the few ms before `createGuarded`. ~5 users (deployment scale). Recorded, not mitigated further. |
| `toUtf8` never fails | It falls back to windows-1252, which decodes every byte, so `charset_undetected` would be unreachable and binary garbage would pass to the "no cue" check, or worse, embed | `api` treats a normalized text containing `U+0000` or `U+FFFD` as `charset_undetected`; garbage with neither still fails `upload_not_srt` (no cue). Tests for both. |
| Default flag ignored | `embedStaged` hardcodes `isDefault: false`, `isForced: false` today; an upload's choices would silently vanish | `StagedTrackInput` gains optional `isDefault`/`isForced`; test asserts they reach `details()`. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/npm api run lint
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/comments api
bin/comments web
```

Manual pass (dev stack, one COMPLETED film with an English subtitle, one series with three
COMPLETED episodes, a non-admin owner and a non-owner):

1. **AC-1/AC-2**: As the non-admin owner, open the film: the upload icon is beside "Buscar
   subtítulos". Remove every subtitle provider in Settings → Subtítulos and reload: the upload icon
   is still there. Expand the series' season: each COMPLETED episode has it in "Pistas".
2. **AC-3**: Pick `Green Book (2018).es-419.srt`, `Green Book.eng.forced.srt` and `subs.srt`, and
   check the presets and that confirm is disabled until `subs.srt` has a language.
3. **AC-4/AC-5/AC-6**: Upload Latino with "Automático", wait, `router.refresh()`, then
   `docker compose exec worker ffprobe -show_streams <file>` and `mkvinfo <file>`. Repeat with a
   manual `+1500` and with "replace".
4. **AC-7**: Upload a cp1252 `¿Señor?` file, then `mkvextract tracks <file> N:/tmp/x.srt` and check
   the text.
5. **AC-8**: Upload random bytes named `x.srt`; check `bin/mysql -e 'select count(*) from subtitle_embeds'`
   and `ls <downloads>/.perceptor/subtitle-upload/`.
6. **AC-9**: Upload a subtitle from a different cut with "Automático"; check `FAILED`/`sync_*`,
   `sha256sum` and the staging directory.
7. **AC-10/AC-11/AC-12**: Exercise each refusal from the dialog and, for the direct ones, from a
   GraphQL client with the user's cookie.
8. **AC-13**: `docker compose kill worker` mid-remux, start it, restart `api`, then check the embed
   and the staging directory.
9. **AC-14**: `touch /tmp/marker` before the pass, then `find <library> -newer /tmp/marker` at the
   end.

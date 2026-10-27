---
title: Jellyfin Subtitle Embed
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-10-23
last_updated: 2026-10-23
status: Implemented
services: [api, worker, web]
---

# SPEC: Jellyfin Subtitle Embed (`spec.md`)

## Context & Goal

A transcoded film or episode sometimes ends up without a subtitle language its viewers want. There
are two causes. Sometimes the release never carried that language. Other times it carried it only as
an image format (PGS/VobSub) that the installation's `070-subtitle-format-selection` settings
discard. The administrator fills the gap from Jellyfin: they search the subtitle with the official
OpenSubtitles plugin (Jellyfin stable repository), Jellyfin saves it as an external file beside the
media (`<base>.<lang3>[.forced][.N].srt` when the library's "save subtitles into media folders"
option is on), and they check its sync in Jellyfin's player using the player's subtitle offset. What
is left is a loose `.srt` next to the `.mkv`. Today they fold it in with a hand-run `mkvmerge` bash
script. The script works, but it replaces the original non-atomically, treats mkvmerge's
"success with warnings" exit code as a failure, assumes UTF-8, and leaves the `.srt` behind, so
Jellyfin lists the subtitle twice.

This feature moves that step into Perceptor. On a film's detail page, and on each episode row of a
series' detail page, `api` asks the configured Jellyfin server which external subtitles the item has.
Jellyfin is used only as the source of *which* sidecar files exist and what language and forced flag
each one has. When there is at least one, an administrator gets an "Embed in MKV" action. A modal
lists each subtitle with its language, a default checkbox and an offset in milliseconds. On confirm,
the worker:

1. remuxes the library file with `mkvmerge` (already in the worker image since
   `100-bluray-disc-remux`) into a scratch file next to it, appending the new subtitle tracks after
   the existing ones;
2. verifies the result;
3. atomically renames the result over the original;
4. deletes the `.srt` files it embedded.

Then `api` asks Jellyfin to refresh the item, so Jellyfin sees one `.mkv` carrying the subtitles and
no external file.

Jellyfin's own stream index is never used. A sidecar is identified by its file name, both in the
modal and in the request.

Pipeline stages touched:

- **Notify media server:** the `api`'s Jellyfin client gains a read of an item's external subtitle
  streams, the same for a whole series' episodes, and a "modified file" notification, in
  `services/api/src/clients/media-server/jellyfin.ts`.
- **Browse library:** the two detail pages in `web`.

It adds a post-pipeline operation on an already-delivered library file. It is not a new stage of the
acquisition pipeline, and it never moves a title's `status`. The worker gains a second kind of job
beside `encode`, on its own queue.

Constitution Article XII must be amended. Today it allows writing to the destinations root and no
removal other than the encode's own `.part.mkv`. This feature adds two narrow exceptions, ratified
alongside this spec:

- replacing a library file with its verified remux;
- deleting exactly the sidecar subtitle files that remux just embedded.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (External subtitles are listed from Jellyfin)**: For a film, and for each episode of a
      series, `api` must expose the external subtitle files that Jellyfin reports for the matching
      item. Each entry carries the sidecar's **file name** (its base name, e.g.
      `Green Book (2018).spa.srt`, never a directory, never Jellyfin's stream index), its language
      (ISO 639-2, or `null` when Jellyfin reports none), whether it is forced, and a display title.
      The item is the one `findByTmdbId` already resolves (`034`). For an episode it is the episode
      item of that series matched by season and episode number.

      A stream is listable when all of these hold:
      - Jellyfin reports `Type: Subtitle`, `IsExternal: true`, `Codec: subrip` and a non-empty `Path`;
      - that path's directory is the directory of the item's own media file;
      - its name ends in `.srt`.

      A sidecar elsewhere, such as Jellyfin's metadata folder, is never listed: the worker could not
      reach it, and Perceptor must not delete outside the title's folder. The display title is
      Jellyfin's `DisplayTitle` (its `Title` is `null` for a plugin download).

      *Resolved by a read-only probe on 2026-10-23 against Jellyfin 12.2.0 (Green Book, two plugin
      downloads, `.eng.srt` and `.spa.srt`): `Items?…&fields=MediaStreams,Path` reports both with
      `IsExternal: true`, `Codec: subrip`, `Language` `eng`/`spa`, `IsForced: false`, and `Path` the
      host-side sidecar path in the same folder as the `.mkv`.
      `Shows/{id}/Episodes?isMissing=false&fields=MediaStreams,Path` returns every episode's
      `MediaStreams` in one response (40 episodes, one call), so NFR-2's one read per series holds.*
- [ ] **REQ-2 (Silent when unavailable)**: The listing must be empty, never an error, when the
      caller is not an administrator, when the configured media server is not Jellyfin (`none` or
      Plex), when Jellyfin is unreachable or rejects the call, when the title has no matching item,
      or when the item has no listable external subtitle. This is an outcome, the same posture as
      `069`'s media-server reads. A failed read is logged.
- [ ] **REQ-3 (Administrator only)**: Listing and embedding are restricted to administrators, and
      the title must also be visible to the caller by the existing ownership rule (`movie(id)`,
      `show(id)`). A non-administrator sees no action and is refused by the mutations.
- [ ] **REQ-4 (Per-subtitle choices)**: For each subtitle to embed, the request names:
      - its sidecar file name, as listed;
      - the language to write (ISO 639-2, editable, required even when Jellyfin reported none);
      - whether it is the default track;
      - an offset in milliseconds (an integer, positive delays and negative advances, within
        ±600 000).

      At least one subtitle must be selected, and at most one may be marked default. A sidecar
      Jellyfin lists but the request omits is neither embedded nor deleted.
- [ ] **REQ-5 (Track metadata)**: Each embedded track must carry the language code chosen in REQ-4
      and, as its track title, that language's `Language.trackTitle` for the base language row (the
      row whose `iso3` matches and that carries no regional variant, e.g. `spa` → `Español`). A
      regional variant (`Latino`, `Español (España)`) is never inferred or written. The forced flag
      must be set when Jellyfin reports the subtitle as forced, and cleared otherwise.
- [ ] **REQ-6 (Default flag)**: When one subtitle in the request is marked default, the resulting
      file must carry the default flag on that track only: every other subtitle track, including
      ones already in the file before the embed, loses it. When none is marked default, the default
      flag of every track already in the file is left exactly as it was, and the new tracks are not
      default. Audio and video track flags are never changed.
- [ ] **REQ-7 (Offset)**: Every timestamp of an embedded subtitle must be shifted by its offset. A
      subtitle cue that the shift moves entirely before zero is dropped, never kept at a negative
      time.
- [ ] **REQ-8 (Non-UTF-8 subtitles)**: A subtitle file that is not UTF-8 (cp1252/ISO-8859-1 are
      common for Spanish) must be embedded with its characters intact (`ñ`, `á`, `¿` read correctly
      in the resulting track). When the encoding cannot be determined, the embed must fail with
      `error.subtitleEmbed.charset_undetected` and change nothing.
- [ ] **REQ-9 (Appended, everything else survives)**: Every track already in the file (video, audio,
      subtitles, attachments), its chapters and its container-level tags (`046`'s `title` and
      `PERCEPTOR_SOURCE`) must be present in the result, unchanged and in their original order. The
      new subtitle tracks are appended after them, in request order (e.g. `video · audio ·
      sub eng` becomes `video · audio · sub eng · sub spa`). Nothing is re-encoded.
- [ ] **REQ-10 (Verified, atomic replacement)**: The remux must write to a scratch file
      (`<final>.part.mkv`) next to the library file. mkvmerge's "completed with warnings" outcome
      counts as success, and its "error" outcome as failure. Before replacing anything, the result
      must be probed and accepted only if it contains every original track plus exactly the
      requested new ones, and its duration matches the original's within 1 s. The replacement must
      be a single rename over the original. There is no moment at which the library path does not
      exist.
- [ ] **REQ-11 (Failure leaves the library as it was)**: On any failure before the rename (unreadable
      subtitle, undetected charset, mkvmerge error, failed verification, worker crash), the scratch
      file must be removed, the original `.mkv` must be byte-identical to before, and every sidecar
      must still exist. The embed records the failure's key, and the administrator can try again.
- [ ] **REQ-12 (Sidecars deleted by the worker, then Jellyfin refreshed)**: After the rename, the
      worker deletes each embedded sidecar. A path is deleted only if all of these hold:
      - it is the exact path named in the embed's details;
      - it resolves inside the destinations root;
      - it sits in the same directory as the replaced `.mkv`;
      - it ends in `.srt`;
      - it is a regular file.

      A sidecar that is already gone is not a failure. Then the worker reports completion, and `api`
      asks Jellyfin to refresh the item through the path-scoped `Library/Media/Updated` notification
      `createdMedia` already sends, with the update type for a modified file. The embed still counts
      as completed when either step fails, with a warning:
      - `error.subtitleEmbed.sidecar_delete_failed` when a sidecar could not be deleted (the subtitle
        then shows twice in Jellyfin until removed by hand). It takes precedence when both fail.
      - `error.subtitleEmbed.jellyfin_refresh_failed` when Jellyfin could not be notified (the new
        tracks then appear on Jellyfin's next scan of its own).
- [ ] **REQ-13 (The file to remux, confined to the library)**: The file to remux is the title's own
      `filePath` when set, which is already a container path the worker wrote. Otherwise (a title
      held only through `mediaServerPresentAt`, `089`) it is the path Jellyfin reports for the item,
      translated from host to container path through `MediaRootsService` (Article V). Jellyfin's
      mount point is its own and need not equal `HOST_DESTINATIONS_DIR`; an untranslatable path is
      `error.subtitleEmbed.outside_library`. Either way the file must exist, resolve inside the
      destinations root, and end in `.mkv`, or the request is refused before anything is queued. A
      title that holds no file (no `filePath` and no `mediaServerPresentAt`) is refused with
      `error.subtitleEmbed.no_file`.
- [ ] **REQ-14 (Subtitle content read where it lies)**: Each sidecar's container path is its listed
      file name joined to the replaced `.mkv`'s directory. The worker reads it there; nothing is
      copied or staged beforehand, and Jellyfin is never asked for subtitle content. At confirmation,
      `api` checks that each requested sidecar exists at that path (the destinations root is
      read-only in `api`, which is enough to `stat`).
- [ ] **REQ-15 (Stale listing)**: At confirmation, `api` must re-read the item's external subtitles
      and refuse with `error.subtitleEmbed.stale_listing` if any requested file name is no longer
      listed by Jellyfin or no longer exists on disk. Nothing is queued.
- [ ] **REQ-16 (One thing at a time)**: An embed must be refused with `error.subtitleEmbed.busy`
      while the target film or episode has work in flight (a source or job that is not terminal or
      retired, `pipeline-status/`'s in-flight definition, including a season pack in flight for an
      episode's season), or while another embed of the same target is queued or running.
      Conversely, while an embed of a target is queued or running, every acquisition entry point
      for that target (`087`'s guarded attach paths and uploads) must refuse with the same key, so a
      replacement encode never races a remux of the same file.
- [ ] **REQ-17 (Visible progress, no title status change)**: The latest embed of a film or episode,
      with its status (`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`), its failure key and its warning
      key, must be readable on the title so the panel can show "embedding…", the failure or the
      warning after a reload. An embed never writes `Movie.status`, `Episode.status` or
      `Show.status`, and never appears in `/downloads` or in `activeDownloadCount`.
- [ ] **REQ-18 (Films and episodes, one at a time)**: The action exists for a film on its detail
      page and for an episode on its row of the series' detail page. There is no season-wide or
      series-wide bulk embed.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Constitution amendment)**: Article XII must gain two narrow exceptions, ratified
      through `/constitution` alongside this spec (the `047` precedent), before any service begins
      implementation. Both apply only at an administrator's explicit request:
      1. a library file may be replaced, by a single atomic rename, with its verified remux
         (REQ-10) that adds subtitle tracks, and the worker's scratch file is removed on every
         outcome;
      2. after that rename, the worker deletes exactly the sidecar `.srt` files the remux embedded,
         under REQ-12's guards.

      The article's **Check** line must name both new sites.
- [ ] **NFR-2 (Jellyfin load)**: Rendering a film's detail page costs at most one Jellyfin read for
      the listing, and rendering a series' detail page at most one per series, never one per
      episode. The confirm path adds one re-read (REQ-15), and completion one notification (REQ-12).
      A Jellyfin read in a page render uses the client's existing short read timeout, so an
      unreachable Jellyfin never stalls the page beyond it.
- [ ] **NFR-3 (Crash recovery)**: An embed still `RUNNING` when the worker announces its boot
      (`054`'s `encodeWorkerStarted`) must be moved to `FAILED` with
      `error.subtitleEmbed.interrupted`, and its scratch file removed. It is never automatically
      retried. Before the rename the original file and sidecars are intact by REQ-10/REQ-11.
- [ ] **NFR-4 (Ownership of files)**: The replaced file must keep the original's owner, group and
      permission bits, so the media server can still read it.
- [ ] **NFR-5 (Tests where failure is silent, Article IX)**: Covered by tests that fail when the rule
      is removed:
      - mkvmerge exit code 1 treated as success;
      - a verification that rejects a result missing an original track;
      - the scratch file removed on each failure branch;
      - sidecars deleted only after the rename, and never on a failure;
      - each of REQ-12's deletion guards (another directory, a non-`.srt` name, a path outside the
        root, a path not in the details);
      - the default flag cleared on pre-existing subtitle tracks only when one new track is default;
      - the base-language track title never a variant;
      - the stale-listing refusal;
      - the busy refusal in both directions;
      - the non-administrator refusal;
      - a cp1252 subtitle arriving intact.

## GraphQL Contract Delta

```graphql
enum SubtitleEmbedStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
}

type ExternalSubtitle {
  """The sidecar's base name (e.g. "Green Book (2018).spa.srt"); its identity, sent back unchanged in SubtitleEmbedInput.fileName."""
  fileName: String!
  """ISO 639-2 code as Jellyfin reports it, null when it reports none."""
  languageIso3: String
  isForced: Boolean!
  """Jellyfin's DisplayTitle for the stream (e.g. "Spanish - SUBRIP - External"), for the modal only."""
  title: String!
}

type SubtitleEmbed {
  id: Int!
  status: SubtitleEmbedStatus!
  """i18n key of the failure when status is FAILED, else null."""
  errorKey: String
  """i18n key of a non-fatal problem when status is COMPLETED (REQ-12), else null."""
  warningKey: String
  createdAt: DateTime!
  finishedAt: DateTime
}

input SubtitleEmbedInput {
  fileName: String!
  languageIso3: String!
  isDefault: Boolean!
  offsetMs: Int!
}

extend type Movie {
  """Empty unless the caller is an administrator and Jellyfin answers (REQ-2)."""
  externalSubtitles: [ExternalSubtitle!]!
  """The film's most recent embed, null if it never had one."""
  subtitleEmbed: SubtitleEmbed
}

extend type Episode {
  externalSubtitles: [ExternalSubtitle!]!
  subtitleEmbed: SubtitleEmbed
}

type Mutation {
  embedMovieSubtitles(movieId: Int!, subtitles: [SubtitleEmbedInput!]!): SubtitleEmbed!
  embedEpisodeSubtitles(episodeId: Int!, subtitles: [SubtitleEmbedInput!]!): SubtitleEmbed!

  """Service-only (worker). Moves a QUEUED embed to RUNNING; false if it is no longer QUEUED."""
  subtitleEmbedStarted(id: Int!): Boolean!
  """Service-only (worker). Safe to receive more than once (038's posture). warningKey is null or error.subtitleEmbed.sidecar_delete_failed."""
  subtitleEmbedCompleted(id: Int!, warningKey: String): Boolean!
  """Service-only (worker). Safe to receive more than once."""
  subtitleEmbedFailed(id: Int!, errorKey: String!): Boolean!
}

type Query {
  """Service-only (worker). Container paths, same standing as EncodeJobDetails' outputRoot. Answers for any status."""
  subtitleEmbedDetails(id: Int!): SubtitleEmbedDetails!
}

type SubtitleEmbedDetails {
  id: Int!
  """Absolute container path of the library .mkv to replace."""
  filePath: String!
  tracks: [SubtitleEmbedTrack!]!
}

type SubtitleEmbedTrack {
  """Absolute container path of the sidecar, in filePath's directory (REQ-14); read, then deleted after the rename (REQ-12)."""
  sourcePath: String!
  languageIso3: String!
  trackTitle: String!
  isDefault: Boolean!
  isForced: Boolean!
  offsetMs: Int!
}
```

`Episode` here is the existing type `shows/entities/episode.entity.ts` declares, reached through
`show(id)`. `externalSubtitles` on `Episode` is resolved from one read per series (NFR-2), not per
field. `fileName` is a base name, not a path, so no container path reaches `web` (Article V).

The queue payload (a second, parallel contract, see `docs/spec/graphql-contract.md`) gains one queue
and one job: `subtitle-embed` / `subtitle-embed`, payload `{ subtitleEmbedId: number }`. The worker
reads everything else through `subtitleEmbedDetails`. Cancelling a queued or running embed is out of
scope (see Out of Scope), so there is no cancel channel.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Caller is not an administrator | `ForbiddenException`, the existing `AdminGuard` key | the existing admin-only message |
| Film/episode missing or not visible to the caller | `NotFoundException`, the existing `movie`/`episode` not-found keys | `La película <id> no existe` / the existing episode message |
| Configured media server is not Jellyfin | `BadRequestException` `error.subtitleEmbed.unsupported_media_server` | `Incrustar subtítulos requiere Jellyfin como servidor de medios.` |
| Jellyfin unreachable or rejects the call at confirmation | `ServiceUnavailableException` `error.subtitleEmbed.media_server_unavailable` | `No se pudo contactar a Jellyfin. Probá de nuevo en un rato.` |
| Title holds no file, or Jellyfin has no item for it | `BadRequestException` `error.subtitleEmbed.no_file` | `Este título no tiene un archivo en la biblioteca.` |
| File is not `.mkv` | `BadRequestException` `error.subtitleEmbed.not_mkv` | `Solo se pueden incrustar subtítulos en archivos MKV.` |
| File path does not resolve inside the destinations root | `BadRequestException` `error.subtitleEmbed.outside_library` | `El archivo no está dentro de la biblioteca de Perceptor.` |
| `subtitles` empty | `BadRequestException` `error.subtitleEmbed.empty_selection` | `Elegí al menos un subtítulo.` |
| More than one `isDefault: true` | `BadRequestException` `error.subtitleEmbed.multiple_defaults` | `Solo un subtítulo puede ser el predeterminado.` |
| Same `fileName` twice | `BadRequestException` `error.subtitleEmbed.duplicate_subtitle` | `Elegiste el mismo subtítulo dos veces.` |
| `languageIso3` not in the `Language` table | `BadRequestException` `error.subtitleEmbed.unknown_language` | `Idioma desconocido: {language}.` |
| `offsetMs` outside ±600 000 | `BadRequestException` `error.subtitleEmbed.offset_out_of_range` | `El desfase tiene que estar entre -600000 y 600000 ms.` |
| A requested file name is no longer listed or no longer on disk (REQ-15) | `ConflictException` `error.subtitleEmbed.stale_listing` | `La lista de subtítulos de Jellyfin cambió. Volvé a abrir el diálogo.` |
| Work in flight on the target, or another embed queued/running (REQ-16) | `ConflictException` `error.subtitleEmbed.busy` | `Este título tiene una descarga, codificación o incrustación en curso.` |
| An acquisition entry point hit while an embed is queued/running (REQ-16) | `ConflictException` `error.subtitleEmbed.busy` | same as above |

Failure and warning keys carried on `SubtitleEmbed.errorKey`/`warningKey` (written by the worker
through `subtitleEmbedFailed`/`subtitleEmbedCompleted`, or by `api`). `web` translates them like any
other key:

| Key | When | Message the user sees |
| :-- | :-- | :-- |
| `error.subtitleEmbed.subtitle_unreadable` | The worker could not read a sidecar | `No se pudo leer uno de los subtítulos. El archivo original no se tocó.` |
| `error.subtitleEmbed.charset_undetected` | REQ-8 | `No se pudo detectar la codificación del subtítulo.` |
| `error.subtitleEmbed.remux_failed` | mkvmerge reported an error | `mkvmerge falló al incrustar los subtítulos. El archivo original no se tocó.` |
| `error.subtitleEmbed.verify_failed` | REQ-10 verification rejected the result | `El archivo generado no pasó la verificación. El original no se tocó.` |
| `error.subtitleEmbed.not_writable` | The library folder is not writable by the worker, or the original's owner/group cannot be kept (NFR-4), checked before mkvmerge runs | `El worker no puede reemplazar este archivo (permisos de la carpeta o del dueño).` |
| `error.subtitleEmbed.interrupted` | NFR-3 | `La incrustación se interrumpió por un reinicio del worker. Probá de nuevo.` |
| `error.subtitleEmbed.sidecar_delete_failed` (warning) | REQ-12 | `Subtítulos incrustados, pero no se pudo borrar el .srt externo. Borralo a mano o desde Jellyfin.` |
| `error.subtitleEmbed.jellyfin_refresh_failed` (warning) | REQ-12 | `Subtítulos incrustados, pero no se pudo avisar a Jellyfin. Aparecerán en su próximo escaneo.` |

Consumers:

- **`web`** renders the action only when `externalSubtitles` is non-empty and no embed is
  `QUEUED`/`RUNNING`. It shows each refusal from the first table inline in the modal, keeping the
  modal open. It closes the modal and re-fetches the title on `stale_listing`. It shows
  `errorKey`/`warningKey` of the latest embed in the panel. Refresh is manual (`router.refresh()`),
  never polled, the same posture as `064`'s badge.
- **`worker`** treats `false` from `subtitleEmbedStarted` as "abandon silently" (the embed is no
  longer queued). It reports every failure through `subtitleEmbedFailed` with one of the keys above.
  It reports a sidecar it could not delete through `subtitleEmbedCompleted`'s `warningKey`. It
  retries a report it could not deliver, as it does for `encodeCompleted`/`encodeFailed` (`038`).

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `SubtitleEmbed` (new) | `id`; `movieId` / `episodeId` (exactly one set, cascade on the title's deletion); `status SubtitleEmbedStatus @default(QUEUED)`; `filePath` (container path resolved at confirmation); `tracks` (the requested tracks with `fileName`, language, title, flags and offset, JSON); `errorKey`; `warningKey`; `createdAt`; `finishedAt` | `errorKey`, `warningKey`, `finishedAt` nullable | No, new table |
| enum `SubtitleEmbedStatus` (new) | `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED` | n/a | No |

No existing model changes. History is kept (one row per attempt). The GraphQL fields expose only the
latest.

## Acceptance Criteria

- [x] **AC-1**: Given a COMPLETED film whose Jellyfin item has a `Pelicula.spa.srt` downloaded by the
      OpenSubtitles plugin, when an administrator who owns it opens its detail page, then an
      "Embed in MKV" action is shown, and its modal lists one row for `Pelicula.spa.srt` with
      language `spa`, the default box unchecked and offset `0`.
- [ ] **AC-2**: Given AC-1, when the administrator confirms with offset `+1200`, then after the embed
      finishes:
      - `ffprobe` on the library file shows the original streams unchanged and in order, followed by
        one new subtitle stream tagged `language=spa`, `title=Español`, not default;
      - its first cue starts 1.2 s later than in the `.srt`;
      - `Pelicula.spa.srt` no longer exists;
      - Jellyfin's subtitle menu for the item lists the embedded Spanish track once, with no
        external entry.
- [ ] **AC-3**: Given a file that already has an English subtitle flagged default, when the
      administrator embeds a Spanish subtitle with "default" checked, then the resulting file has
      the default flag on the Spanish track only. Embedding instead with "default" unchecked leaves
      the English track default.
- [ ] **AC-4**: Given a `.srt` saved in cp1252 containing `¿Señor?`, when it is embedded, then
      extracting the new track (`mkvextract`) yields `¿Señor?` in UTF-8.
- [ ] **AC-5**: Given an episode row of a series whose Jellyfin episode has an external `eng`
      subtitle, when the administrator embeds it from that row, then only that episode's file and
      sidecar change, and the series page made one Jellyfin listing read (visible in `api`'s log or
      Jellyfin's activity log), not one per episode.
- [ ] **AC-6** (failure): Given a `.srt` whose bytes are not valid in any detectable encoding, when it
      is embedded, then the embed reads `FAILED` with `error.subtitleEmbed.charset_undetected`. The
      library file's checksum (`sha256sum`) is unchanged, no `.part.mkv` remains in its folder, and
      the `.srt` still exists.
- [ ] **AC-7** (failure): Given the worker container is killed (`docker compose kill worker`) while
      mkvmerge is running for an embed, when it starts again, then the embed reads `FAILED` with
      `error.subtitleEmbed.interrupted`, no `.part.mkv` remains, the library file's checksum is
      unchanged, and the `.srt` still exists.
- [ ] **AC-8** (failure): Given a non-administrator who owns the film, when they open its detail page,
      then no action is shown, and calling `embedMovieSubtitles` directly is refused with the admin
      error.
- [ ] **AC-9** (failure): Given a film with a torrent `DOWNLOADING` as a replacement, when the
      administrator calls `embedMovieSubtitles`, then it is refused with `error.subtitleEmbed.busy`
      and nothing is queued. Given an embed `RUNNING` on a film, adding a torrent to it with
      `force: true` is refused with the same key.
- [ ] **AC-10** (failure): Given the modal open and the `.srt` then deleted on disk, when the
      administrator confirms, then the request is refused with `error.subtitleEmbed.stale_listing`
      and the modal closes.
- [ ] **AC-11**: Given the media server set to `none`, or Jellyfin stopped, when an administrator
      opens a film's detail page, then the page renders normally with no action and no error, and
      `api` logs the failed read in the Jellyfin-stopped case.
- [ ] **AC-12**: Given Jellyfin stopped right after the worker reports completion, when the embed
      finishes, then it reads `COMPLETED` with `error.subtitleEmbed.jellyfin_refresh_failed`, the
      library file carries the new track, and the `.srt` is gone.
- [ ] **AC-13**: After any embed, `ls -l` on the library file shows the same owner, group and
      permission bits as before.
- [x] **AC-14**: `grep -rn "unlink\|rmSync\|rm(" services/worker/src services/api/src` finds no new
      removal under the destinations root other than the scratch-file cleanup and the guarded
      sidecar deletion the amended Article XII names, and none at all in `services/api/src`.
- [ ] **AC-15**: Throughout every case above, `Movie.status`/`Episode.status` read the same before
      and after, and `/downloads` never lists the embed.

## Out of Scope

- **Plex.** Plex's built-in subtitle search stores what it downloads in its own data folder (GUID
  directories under `Plex Media Server/Media/localhost`), not beside the media, so there is no file
  Perceptor can reach. Plex users with Bazarr get sidecars, but listing them would need Plex's API to
  report external streams with a path. A later extension if it does.
- **Discovering sidecars on disk without Jellyfin.** Scanning the library folder and parsing
  `<base>.<lang>.srt` names is deliberately not done. Jellyfin already knows which files are
  subtitles of which item, their language and their forced flag, and parsing names from every
  possible source (Jellyfin, Bazarr, by hand: two- and three-letter codes, `.forced`, `.hi`,
  numbering) is the fragile part this feature avoids.
- **Sidecars Jellyfin stores outside the media folder** (the library option "save subtitles into
  media folders" off). They are never listed (REQ-1).
- **Jellyfin's stream index and its `DeleteSubtitle` endpoint.** Not used. Jellyfin numbers external
  streams ahead of the file's own and may renumber them. The sidecar's file name is a stable
  identity, and deleting the file then refreshing is what Jellyfin's own delete amounts to.
- **Uploading a `.srt` from the browser.** Useful for installations with no media server, not needed
  for the workflow this serves (search and review in Jellyfin). A separate feature.
- **Perceptor searching subtitles itself**, whether through OpenSubtitles directly or by triggering
  Jellyfin's remote subtitle search. Noted as a future idea. The best moment for it would be before
  the encode, matching by release name or hash.
- **OCR of image subtitles (PGS/VobSub) to SRT.** Heavy dependencies and error-prone. The image case
  is covered by this feature: discard the image track, fetch a text one in Jellyfin, embed it.
- **Formats other than SRT** (ASS, WebVTT external files). The encode already flattens text
  subtitles to SRT (`070`). v1 keeps the same single format.
- **Re-timing a subtitle already embedded**, or removing one. Only external subtitles are listed. A
  wrong offset is corrected today by extracting, fixing and re-adding by hand.
- **Cancelling a queued or running embed.** A remux takes seconds to a few minutes. Failure recovery
  (NFR-3) covers the crash case.
- **Season-wide or series-wide bulk embed.** Offsets rarely match across episodes, and embedding
  without reviewing each one is what this workflow avoids.
- **Non-`.mkv` library files** (e.g. an `.mp4` moved as-is with compression off, `032`). Remuxing to
  MKV would change the file name. Refused with `error.subtitleEmbed.not_mkv`.

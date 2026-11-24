---
title: Subtitle Upload
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-11-24
last_updated: 2026-11-24
status: Approved
services: [api, web]
---

# SPEC: Subtitle Upload (`spec.md`)

## Context & Goal

A film or episode in the library can get a subtitle in three ways today. The encode keeps the ones
the release carried (`070`, `102`). An owner can press "Buscar subtítulos" and let Perceptor fetch,
check and embed one from a provider (`103`, `106`, `107`, `121`). An administrator can embed a
`.srt` sidecar that Jellyfin already lists next to the file (`101`, `113`). What is missing is the
plainest case: the user already has the `.srt` on their own computer, because they downloaded it by
hand, a friend sent it or they fixed one themselves. Today the only way in is to copy it into the
library folder beside the `.mkv` with the exact naming Jellyfin expects, wait for Jellyfin to see it,
and ask an administrator to embed it. That only works with Jellyfin, needs shell access to the host,
and fails for every non-administrator.

This feature adds an upload button. On a film's detail page, it is an icon-only button (an upload
icon, no text, with a tooltip and an accessible name) right beside the "Buscar subtítulos" button in
the audio/subtitle panel's footer (`services/web/src/components/movies/Movie.tsx`). On a series'
detail page, it is the same icon-only button beside each episode's "Buscar subtítulos" button in the
"Pistas" column (`services/web/src/components/shows/SeasonAccordion.tsx`). It opens a dialog close
to `101`'s embed dialog (`EmbedSubtitlesModal.tsx`). The user picks one or more `.srt` files, and for
each one the dialog shows a row with the language (preset from the file name when it can be read
from it), a forced checkbox, a "make default" checkbox, a replace checkbox, the offset in
milliseconds and `113`'s "Automático" checkbox. On confirm, `api` stages the files under the
downloads root and creates an ordinary `SubtitleEmbed`. From there the existing machinery runs
unchanged: `113`'s measurement for automatic rows, `101`'s verified atomic remux, `119`'s drop of
the replaced language's tracks, `123`'s provenance tags, then the media-server notification and
`108`'s track re-read.

Pipeline stage touched: **Notify media server** (the subtitle work that runs after delivery) and
**Browse library** (the two detail pages). No acquisition stage changes, and no title `status` ever
moves. The worker is not touched: an uploaded track is a staged, non-sidecar track, which the
worker already handles for `103`'s embeds (`SubtitleEmbedTrack.isSidecar: false`). Constitution
Article XII must be amended, because its first exception names who may cause a library `.mkv` to
be replaced, and an owner's upload is not one of those cases yet.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Button placement)**: The upload button is an icon-only button, with no visible text.
      Its tooltip and accessible name are the catalog string "Subir subtítulos". On a film, it sits
      on the same row as "Buscar subtítulos", immediately beside it. On an episode, it sits beside
      that episode's "Buscar subtítulos" button in the "Pistas" column. It is shown under the same
      condition as "Buscar subtítulos", which is that the title reads `COMPLETED`, but it does **not**
      depend on `subtitleSearchAvailable`. With no subtitle provider configured, the search button
      is absent and the upload button stands alone in the same place. There is no season-level or
      series-level upload.
- [ ] **REQ-2 (Who may upload)**: Any authenticated user who owns the title by the existing
      ownership rule (`movie(id)`, `show(id)`) may upload. Administrator rights are not required.
      This matches `106`'s posture: pressing the button is the consent for that one film or episode.
- [ ] **REQ-3 (Disabled while busy)**: The button is disabled, with its tooltip saying why, while
      the target's latest embed is in flight (any status other than `COMPLETED`/`FAILED`, `113`'s
      rule) or its latest subtitle search is not terminal. `api` enforces the same rule itself
      (REQ-11), so a stale page cannot get past it.
- [ ] **REQ-4 (Files)**: The dialog accepts one or more files in a single pick. It also accepts more
      files added before confirming, and a row can be removed. Only `.srt` files are accepted (the
      extension, case-insensitive). The dialog refuses other files inline without sending them.
      Each file is at most 2 MiB, and one request carries at most 8 files. `api` enforces both
      limits again. A file whose bytes are not SRT (no cue can be parsed from it after charset
      normalization, REQ-8) is refused.
- [ ] **REQ-5 (Language preset from the file name)**: When a file is added, the dialog presets the
      row's language from the file's name, and the user can always change it. The name, without
      `.srt`, is split on `.`. Segments are checked from the last one backwards, and the first that
      matches a row of the `languages` catalog wins. A segment matches by the row's `tag` (`es-419`,
      `es-ES`, `pt-BR`), its ISO 639-1 or ISO 639-2 code (`es`, `spa`), or its display name in either
      UI language (`Spanish`, `Español`, `Latino`). Matching ignores case. A segment equal to `forced`
      checks the row's forced box. Segments such as `sdh`, `hi`, `cc` or a number are skipped. When
      nothing matches, the language is left empty and the row cannot be confirmed until the user
      picks one. Examples: `Green Book (2018).es-419.srt` gives Latino,
      `Movie.2019.1080p.spa.forced.srt` gives Español with forced checked, `subs.srt` gives no preset.
- [ ] **REQ-6 (Per-row choices)**: Each row names:
      - its file name (the picked file's base name, the row's identity in the request);
      - the language, as a `Language.tag` from the catalog, so a regional variant (Latino,
        Español (España)) can be chosen explicitly;
      - whether the track is forced;
      - whether it is the default track (at most one row);
      - whether it replaces the file's existing subtitles of that language (REQ-9);
      - its offset: either automatic (`113`, checked by default, offset input disabled), or a manual
        offset in milliseconds within ±600 000 (`101` REQ-4's convention and range).
- [ ] **REQ-7 (Track metadata)**: Each uploaded track is written with its language's ISO 639-2 code
      and, as its title, the chosen `Language` row's track title. For a regional variant this is the
      variant's title (`Latino`, `Español (España)`), since the user declared it. Unlike `101` REQ-5,
      it is never reduced to the base language. The forced and default flags follow REQ-6, and
      default handling is `101` REQ-6's unchanged: when one row is default, every other subtitle
      track loses its default flag, and when none is, existing flags are left as they were. `118`'s
      variant check never runs on an uploaded file, because the user's declaration is the authority.
- [ ] **REQ-8 (Charset)**: An uploaded file that is not UTF-8 (cp1252/ISO-8859-1 are common for
      Spanish) is staged as UTF-8 with its characters intact, using the normalization `121` already
      applies to Subdivx downloads. A UTF-8 BOM is accepted. A file whose encoding cannot be
      determined is refused with `error.subtitleEmbed.charset_undetected` before anything is staged
      or queued.
- [ ] **REQ-9 (Replace)**: A row's replace checkbox is enabled only when the title's stored
      `fileSubtitleLanguages` (`108`) contains that row's ISO 639-2 language and the row is not
      forced. Otherwise it is disabled and unchecked. When at least one row has replace checked, the
      remux drops every existing non-forced text subtitle track of those languages in the same
      single `mkvmerge` pass, exactly as `119` REQ-5 defines through
      `SubtitleEmbedDetails.replaceLanguagesIso3`. Forced, image and other-language tracks are never
      touched, and nothing is dropped if the embed fails. Replacement works at ISO 639-2 level:
      replacing with a Latino upload also drops an existing `Español (España)` track. The dialog
      says so in the checkbox's hint.
- [ ] **REQ-10 (Target file)**: The file to remux is resolved exactly as `106`'s manual search
      resolves it: the title's `filePath`, or, for a title held only through the media server, the
      path the configured media server (Jellyfin or Plex) reports, translated to a container path
      (Article V). It must exist, resolve inside the destinations root and end in `.mkv`. The refusals
      are `106`'s keys, in `106`'s order: `no_file`, `not_mkv`, `outside_library`. No media server is
      required for a title that has a `filePath`.
- [ ] **REQ-11 (One thing at a time)**: An upload is refused with `error.subtitleEmbed.busy` under
      `101` REQ-16's rule (work in flight on the target, or another embed of it in flight, `SYNCING`
      included). It is also refused with `error.subtitleSearch.in_progress` while a subtitle search
      of the target is not terminal, so a search that later embeds never works from a probe of the
      file taken before the upload changed it. Conversely, every acquisition entry point and both
      manual searches already refuse while an embed is in flight (`101` REQ-16, `106`), and an
      upload's embed counts.
- [ ] **REQ-12 (Staging)**: On acceptance, `api` writes each normalized file under the downloads
      root, in a directory of the new embed's own, beside `103`'s staging
      (`.perceptor/subtitle-upload/<embedId>/`). It never writes into the destinations root, and the
      original file name is never used as a path. Only the embed's row keeps the base name. When the
      embed reaches `COMPLETED` or `FAILED`, `api` removes that directory. On boot, `api` removes any
      upload staging directory whose embed is terminal or no longer exists. A failed removal is
      logged and is never an error to the user.
- [ ] **REQ-13 (Reuses the embed lifecycle)**: The upload creates a `SubtitleEmbed` like `101`'s.
      It is `SYNCING` when any row is automatic, `QUEUED` otherwise. It moves through `113`'s
      measurement and `101`'s remux with no new status. An automatic row's rejected measurement
      fails the whole embed with `113`'s `sync_*` key, and nothing is written to the library. The
      worker's crash recovery (`101` NFR-3, `113`) applies unchanged. The new track carries `123`'s
      provenance: `PROVIDER` `user`, `SOURCE` the uploaded file's base name, and `OFFSET` the applied
      offset. No sidecar is ever deleted, because an uploaded track is never a sidecar.
- [ ] **REQ-14 (After completion)**: When the embed completes, `api` notifies the configured media
      server as it does after a search's embed (`107`): none, Jellyfin or Plex. A failed notification
      is the existing `jellyfin_refresh_failed`-style warning, never a failure. It then has the
      file's tracks re-read (`108`), so the "Pistas" boxes and the replace checkboxes reflect the new
      track.
- [ ] **REQ-15 (Visible outcome)**: The film's panel and the episode's row show the latest embed's
      status, failure key and warning key, whatever started it, to any owner, so "incrustando…", a
      `sync_*` rejection or a warning survives a reload. Refresh is manual (`router.refresh()`), never
      polled, the same posture as `101`.
- [ ] **REQ-16 (No status change)**: An upload never writes `Movie.status`, `Episode.status` or
      `Show.status`, never appears in `/downloads` or in `activeDownloadCount`, and never touches a
      `SubtitleSearch` row or its per-language outcome. `114`'s derivation then shows an uploaded
      language as `RESOLVED` through `fileSubtitleLanguages`, without this feature doing anything
      to make that happen.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Constitution amendment)**: Article XII's first exception, the verified remux
      replacement, gains a third case: an owner's explicit upload of subtitle files for that one film
      or episode (`124-subtitle-upload`), through the same `<final>.part.mkv` scratch file and atomic
      rename. The second exception (sidecar deletion) does not apply, and the article says so. The
      upload reads its subtitles from the downloads root and removes nothing under the destinations
      root. It must be ratified through `/constitution` before any service starts implementing.
      *Ratified as constitution v1.9.0 on 2026-11-24. Its caller Check also requires `embedStaged`
      to be reached only from `subtitle-search/` and the service behind this spec's two mutations.*
- [ ] **NFR-2 (Request size)**: A request at the limits of REQ-4 (8 files of 2 MiB) must go through
      end to end. That means through `web`'s server action as well as `api`'s GraphQL endpoint, so
      neither body limit can silently cut it off. A body over the limits is refused with the keys in
      the error table, never with a framework's generic 413 or a dropped connection.
- [ ] **NFR-3 (No path crosses to `web`)**: Neither the staged path nor any container path appears in
      any field `web` can read (Article V). The request carries a base name and file content only.
- [ ] **NFR-4 (Tests where failure is silent, Article IX)**: Covered by tests that fail when the rule
      is removed:
      - a cp1252 upload staged as UTF-8 with `ñ`, `¿` intact;
      - the undetected-charset refusal staging nothing;
      - a non-SRT body refused;
      - the size and count limits;
      - an uploaded track never flagged `isSidecar`;
      - the variant's track title written for a variant tag;
      - replace refused for a language the file does not hold and for a forced row;
      - the busy and search-in-progress refusals;
      - a non-owner refused;
      - the staging directory removed on `COMPLETED` and on `FAILED`;
      - in `web`, the file-name preset for each REQ-5 example.

## GraphQL Contract Delta

```graphql
input SubtitleUploadInput {
  """The picked file's base name, ending in .srt (case-insensitive); the row's identity within the request, never used as a path."""
  fileName: String!
  """The file's bytes, base64-encoded, as uploaded (any charset; api normalizes to UTF-8, REQ-8). At most 2 MiB decoded."""
  contentBase64: String!
  """A Language.tag from the languages catalog (e.g. "es-419", "en"), so a regional variant can be chosen."""
  languageTag: String!
  isForced: Boolean!
  isDefault: Boolean!
  """Drop the file's existing non-forced text subtitle tracks of this language in the same remux (REQ-9)."""
  replace: Boolean!
  """Manual offset in ms (101's convention). Ignored when autoOffset is true."""
  offsetMs: Int!
  """True: api measures the offset (113) and ignores offsetMs."""
  autoOffset: Boolean!
}

type Mutation {
  """Owner of the film. Returns the new embed, SYNCING or QUEUED."""
  uploadMovieSubtitles(movieId: Int!, subtitles: [SubtitleUploadInput!]!): SubtitleEmbed!
  """Owner of the episode's series. Returns the new embed, SYNCING or QUEUED."""
  uploadEpisodeSubtitles(episodeId: Int!, subtitles: [SubtitleUploadInput!]!): SubtitleEmbed!
}
```

Both mutations are user-authenticated and never `@AllowService`. `SubtitleEmbed`, its statuses and
its keys are `101`/`113`'s unchanged. The worker-facing surface (`subtitleEmbedDetails`,
`subtitleEmbedSyncDetails` and their reports, the `subtitle-embed` and `subtitle-sync` queues) is
unchanged. An uploaded track reaches the worker as `isSidecar: false`, `provenance: "user"`, with
`sourcePath` the staged path and `replaceLanguagesIso3` the ticked rows' languages. That is a shape
the worker already consumes for `103`'s and `119`'s embeds. `113`'s `fileName` in
`subtitleEmbedSyncDetails`/its reports is the row's `fileName`, unique within the embed by the
`duplicate_subtitle` refusal.

Refusals, in this order. Nothing is staged or queued on any of them:

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Not authenticated | the existing auth error | the existing message |
| Film/episode missing or not owned by the caller | `NotFoundException`, the existing `error.movie.not_found` / `error.episode.not_found` | the existing messages |
| `subtitles` empty | `BadRequestException` `error.subtitleEmbed.empty_selection` | `Elegí al menos un subtítulo.` |
| More than 8 entries | `BadRequestException` `error.subtitleEmbed.upload_too_many` | `Podés subir hasta 8 subtítulos a la vez.` |
| `fileName` does not end in `.srt`, or carries a separator or `..` | `BadRequestException` `error.subtitleEmbed.upload_not_srt` | `Solo se pueden subir archivos .srt.` |
| Same `fileName` twice | `BadRequestException` `error.subtitleEmbed.duplicate_subtitle` | `Elegiste el mismo subtítulo dos veces.` |
| More than one `isDefault: true` | `BadRequestException` `error.subtitleEmbed.multiple_defaults` | `Solo un subtítulo puede ser el predeterminado.` |
| `languageTag` not in the `Language` table | `BadRequestException` `error.subtitleEmbed.unknown_language` | `Idioma desconocido: {language}.` |
| Manual `offsetMs` outside ±600 000 | `BadRequestException` `error.subtitleEmbed.offset_out_of_range` | `El desfase tiene que estar entre -600000 y 600000 ms.` |
| `replace` on a forced row | `BadRequestException` `error.subtitleEmbed.replace_forced` | `Un subtítulo forzado no puede reemplazar a los demás.` |
| `replace` for a language the file's `fileSubtitleLanguages` does not hold (or never read) | `BadRequestException` `error.subtitleSearch.replace_language_not_present` | `El archivo no tiene subtítulos en ese idioma para reemplazar.` |
| `contentBase64` not decodable, or decoded over 2 MiB | `BadRequestException` `error.subtitleEmbed.upload_too_large` (over size) / `error.subtitleEmbed.upload_not_srt` (undecodable) | `Cada subtítulo puede pesar hasta 2 MB.` / as above |
| Charset cannot be determined (REQ-8) | `BadRequestException` `error.subtitleEmbed.charset_undetected` | `No se pudo detectar la codificación del subtítulo.` |
| No SRT cue parses after normalization | `BadRequestException` `error.subtitleEmbed.upload_not_srt` | as above |
| Title holds no file | `BadRequestException` `error.subtitleEmbed.no_file` | `Este título no tiene un archivo en la biblioteca.` |
| Title held only through the media server, which cannot be reached | `ServiceUnavailableException` `error.subtitleEmbed.media_server_unavailable` | `No se pudo contactar al servidor de medios. Probá de nuevo en un rato.` |
| File is not `.mkv` | `BadRequestException` `error.subtitleEmbed.not_mkv` | `Solo se pueden incrustar subtítulos en archivos MKV.` |
| File outside the destinations root | `BadRequestException` `error.subtitleEmbed.outside_library` | `El archivo no está dentro de la biblioteca de Perceptor.` |
| Work or another embed in flight (REQ-11) | `ConflictException` `error.subtitleEmbed.busy` | `Este título tiene una descarga, codificación o incrustación en curso.` |
| A subtitle search of the target not terminal (REQ-11) | `ConflictException` `error.subtitleSearch.in_progress` | the existing message |
| Staging write failed | `InternalServerErrorException` `error.subtitleEmbed.upload_staging_failed` | `No se pudo guardar el subtítulo subido. Probá de nuevo.` |

New catalog keys: `upload_too_many`, `upload_not_srt`, `upload_too_large`, `replace_forced` and
`upload_staging_failed`, all under `error.subtitleEmbed`, in `api` `messages.en.ts` and `web`
`messages/{en,es}.json`. `media_server_unavailable`'s Spanish copy currently names Jellyfin; `web`
may keep that copy, because the key is unchanged. Every other key already exists. Outcome keys on
`SubtitleEmbed.errorKey`/`warningKey` are `101`/`113`'s unchanged.

Consumers:

- **`web`** checks REQ-4's extension, size and count before sending, and shows those refusals
  inline per row. It shows every refusal above inline in the dialog, keeping the dialog and its rows
  open. On `busy`/`in_progress` it closes the dialog and refreshes the page, so the button reads
  disabled. After a successful mutation it closes the dialog and calls `router.refresh()`. It reads
  any `SubtitleEmbed.status` other than `COMPLETED`/`FAILED` as in flight (`113`).
- **`worker`**: no change. It must keep treating `isSidecar: false` as "never delete" and an absent
  `replaceLanguagesIso3` as `[]` (`103`, `119`).

## Data Model Changes

None. The upload is stored as an ordinary `SubtitleEmbed` row. Its `tracks` JSON already carries a
staged path, a provenance and the per-track flags for `103`'s embeds, and its `replaceLanguages` is
`119`'s column. The staging directory is derived from the embed's id.

## Acceptance Criteria

- [ ] **AC-1**: Given a COMPLETED film the caller owns, when they open its detail page, then an
      icon-only upload button with tooltip "Subir subtítulos" sits beside "Buscar subtítulos". With
      no subtitle provider configured, the upload button is still there and the search button is not.
- [ ] **AC-2**: Given a series' season with three COMPLETED episodes, when it is expanded, then each
      episode's "Pistas" cell shows the upload button beside its "Buscar subtítulos" button, and an
      episode not yet COMPLETED shows neither.
- [ ] **AC-3**: When the user picks `Green Book (2018).es-419.srt` and `Green Book.eng.forced.srt`,
      then the dialog shows two rows: the first preset to Latino, not forced; the second preset to
      English with forced checked. Both have "Automático" checked. Picking `subs.srt` gives a row
      with no language, and the confirm button stays disabled until one is chosen.
- [ ] **AC-4**: Given a film whose file has one English subtitle track, when a non-administrator
      owner uploads a Latino `.srt` with "Automático" checked and confirms, then the embed reads
      `SYNCING`, then `QUEUED`/`RUNNING`, then `COMPLETED`. Then `ffprobe` on the library file shows
      every original stream unchanged and in order, followed by one subtitle stream with
      `language=spa` and `title=Latino`, and `mkvinfo` shows its `PERCEPTOR` group with
      `PROVIDER=user` and `SOURCE=Green Book (2018).es-419.srt`. The film's "Subtítulos" box then
      lists `ENG` and `SPA`.
- [ ] **AC-5**: Given a manual offset of `+1500` instead, when the embed completes, then the new
      track's first cue starts 1.5 s later than in the uploaded file.
- [ ] **AC-6**: Given a file with two non-forced Spanish text tracks and one forced Spanish track,
      when the user uploads a Spanish `.srt` with "replace" checked, then the result has the forced
      Spanish track, the new Spanish track and no other Spanish track. Every non-Spanish track is
      unchanged.
- [ ] **AC-7**: Given a `.srt` saved in cp1252 containing `¿Señor?`, when it is uploaded and
      embedded, then extracting the new track with `mkvextract` yields `¿Señor?` in UTF-8.
- [ ] **AC-8** (failure): Given a file of random bytes renamed to `x.srt`, when it is uploaded, then
      the dialog shows `upload_not_srt` (or `charset_undetected`) inline, no `SubtitleEmbed` row is
      created (`bin/mysql -e 'select count(*) from subtitle_embeds'` is unchanged), and nothing new
      appears under `<downloads>/.perceptor/subtitle-upload/`.
- [ ] **AC-9** (failure): Given an automatic row whose subtitle belongs to a different cut (its
      measurement is rejected), when the embed runs, then it reads `FAILED` with a
      `error.subtitleEmbed.sync_*` key. The library file's `sha256sum` is unchanged, and its upload
      staging directory no longer exists.
- [ ] **AC-10** (failure): Given a film with a replacement torrent `DOWNLOADING`, when an owner calls
      `uploadMovieSubtitles`, then it is refused with `error.subtitleEmbed.busy` and nothing is staged.
      Given a manual subtitle search of the film in `SEARCHING`, the same call is refused with
      `error.subtitleSearch.in_progress`.
- [ ] **AC-11** (failure): Given a user who does not own the film, when they call
      `uploadMovieSubtitles` directly, then it is refused with `error.movie.not_found`.
- [ ] **AC-12** (failure): Selecting a 3 MiB `.srt`, or a ninth file, is refused inline in the
      dialog without a request. Sending either directly to `api` is refused with
      `upload_too_large` / `upload_too_many`, never a 413 or a dropped connection. A request of 8
      files at 2 MiB each from the dialog is accepted.
- [ ] **AC-13**: Given the worker killed (`docker compose kill worker`) during the remux, when it
      starts again, then the embed reads `FAILED` with `error.subtitleEmbed.interrupted`. The library
      file's checksum is unchanged, and after `api`'s next boot no upload staging directory of that
      embed remains.
- [ ] **AC-14**: Throughout every case above, `Movie.status`/`Episode.status` read the same before and
      after, `/downloads` never lists the upload, and no file other than the target `.mkv` changes
      under the destinations root (`find <library> -newer <marker>` lists only it).

## Out of Scope

- **Formats other than SRT** (`.ass`, `.vtt`, `.sub`) and **archives** (`.zip`, `.rar`). They are a
  deliberate v1 choice: a single format, like `101`/`103`. Archive opening exists for Subdivx
  (`121`) and could be offered later.
- **Season-wide or series-wide upload**, including matching a batch of `SxxEyy`-named files to
  episodes. Each episode is uploaded on its own row, as `101` and `106` already decided for bulk
  actions.
- **Checking the declared language against the text**, whether with `118`'s variant detection or
  any language identification. The user's declaration is the authority for a file they supplied,
  the same as `118` already says for sidecars.
- **Keeping the uploaded file as a sidecar** next to the `.mkv`, or in a library of uploaded
  subtitles to reuse. The file is embedded and its staged copy deleted.
- **Re-timing, editing or removing a subtitle already embedded**, other than `119`-style
  replacement of a language at upload time.
- **Framerate conversion chosen by hand.** An automatic row gets whatever `113`'s accepted
  measurement applies. A manual row applies a constant offset only.
- **Non-`.mkv` library files.** Refused with `not_mkv`, as `101` decided.
- **Uploading through the tus REST route.** A subtitle is small enough for one GraphQL request (REQ-4
  limits), and Article II keeps the REST route reserved for multi-GB media uploads.

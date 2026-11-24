---
title: Grouped Provenance Tags
spec_version: 0.4.0
author: Juan "Dientuki" Farias
created_at: 2026-11-20
last_updated: 2026-11-20
status: Implemented
services: [api, web, worker, infra]
---

# SPEC: Grouped Provenance Tags (`spec.md`)

## Context & Goal

Perceptor writes its own Matroska tags into two places today, each one a flat tag with a
`PERCEPTOR_` prefix. `046-encode-metadata-tags` writes a global `PERCEPTOR_SOURCE` into every
transcoded file (the release path relative to the downloads root, `services/worker/src/ffmpeg/buildCommand.ts`).
`107-opensubtitles-direct` REQ-14 writes `PERCEPTOR_SOURCE` and `PERCEPTOR_OFFSET` onto every
subtitle track the subtitle embed appends (`services/worker/src/subtitles/embed-tags.ts`). Nothing in
Perceptor reads these tags back: they are provenance for a human opening the file in MediaInfo or
`mkvinfo` months later. Each new fact means one more flat name, and the file records only the
release. The decisions the encode made are not recorded: the CRF and preset, the content kind, the
resolution ceiling, whether grain was synthesized and why, and where a dub-credit or stream-end
trim cut the file. The subtitle track does not record which provider supplied it (OpenSubtitles or
Subdivx since `121`, with more expected), nor how well its sync measured.

This feature replaces the flat tags with **one nested Matroska `SimpleTag` named `PERCEPTOR`** per
target. Its children carry the facts. On the file it is global, and it holds the source, the
Perceptor version, the encode time, the encode parameters and the analysis verdicts. On each
subtitle track Perceptor embeds, it holds the source, offset, provider and sync metrics. Matroska
nests `SimpleTag`s natively, and MediaInfo and `mkvinfo` show them as a tree, so the group reads as
one block rather than a growing list of prefixed names.

Files already in the library carry the old flat tags, and the user wants them converted too. An
administrator gets a button in Settings → Environment that walks the library and rewrites each
file's Perceptor tags into the grouped form. It keeps what the file already says and fills in what
the database still knows about how the file was produced. Rewriting a library file's tags is a write
to the library that Article XII does not allow today, so this feature depends on a constitution
amendment (see NFR-1).

Stages touched: **Transcode** (what the encode writes) and **Notify media server** (the subtitle
embed's track tags), both in the root `CLAUDE.md` table, plus a new admin-only maintenance action.
`infra` is involved only because no running container knows which Perceptor version it is today
(REQ-4).

## Requirements

### Functional Requirements

#### Tag shape

- [ ] **REQ-1 (One group per target)**: Every Perceptor-written tag must live as a child of a single
      `SimpleTag` named `PERCEPTOR`. A target carries at most one `PERCEPTOR` group. No Perceptor
      fact may be written as a top-level `SimpleTag` any more. The flat names `PERCEPTOR_SOURCE` and
      `PERCEPTOR_OFFSET` are no longer written by any path. The global `title` tag from `046` REQ-1/2
      is not a Perceptor fact (players read it) and stays a plain top-level `title`.
- [ ] **REQ-2 (Absent, never empty)**: A child whose value is unknown or does not apply is omitted.
      It is never written empty, `null`, `unknown` or `0` as a placeholder. A migrated file with only
      its source known carries `PERCEPTOR` → `SOURCE` and nothing else.
- [ ] **REQ-3 (Value hygiene)**: Every child value goes through the same sanitizing `107` REQ-14
      applies today: control characters stripped, trimmed, at most 500 characters. Numbers are
      written in plain decimal with `.` as the separator, never localized. Timestamps are ISO 8601
      UTC with a `Z` suffix and whole seconds.

#### Groups on a transcoded file

Amended in 0.4.0: everything is at most two levels deep (`PERCEPTOR` → child). A stock viewer such as
MediaInfo shows one level of nesting and drops anything deeper, so the 0.3 layout (an `ENCODE` and a
`GRAIN` sub-group under the global group) hid the encode parameters from the people it was written for.

- [ ] **REQ-4 (Global children)**: Every encode with compression on must write a global `PERCEPTOR`
      group with exactly these children:

      | Child | Value | Example |
      | :-- | :-- | :-- |
      | `SOURCE` | exactly what `046` REQ-4/NFR-3 define today (relative to the downloads root, never absolute) | `Some.Release-GRP/Some.Release-GRP.mkv` |
      | `VERSION` | the Perceptor release the encoding worker image was built as (`PERCEPTOR_TAG` at build time); a source build writes `dev` | `v0.7.0-rc2` |
      | `ENCODED_AT` | the moment the encode finished, UTC | `2026-11-20T18:04:11Z` |

- [ ] **REQ-5 (Video group)**: Every encode with compression on must also write a `PERCEPTOR` group
      targeted at the **video track**, with these flat children, each omitted when unknown (REQ-2):
      - `VIDEO_CODEC`: `av1` when the video was encoded, `copy` when it was stream-copied (`058`'s
        fits-the-ceiling AV1 or an unrecognized codec);
      - `CRF` and `PRESET`: the SVT-AV1 values used, omitted for `copy`;
      - `CONTENT_KIND`: `LIVE_ACTION` / `ANIME` / `CGI`, as resolved for this job (`057`, after the
        worker's own defaulting);
      - `RESOLUTION_CEILING`: the effective `compression_resolution` tier (`4k`/`1080p`/`720p`/`480p`/`360p`);
      - `SOURCE_RESOLUTION` and `OUTPUT_RESOLUTION`: `<width>x<height>` of the input video and of the
        written video;
      - `DEINTERLACED`: `yes` when `115`'s `bwdif` ran, otherwise omitted;
      - `GRAIN_APPLIED` and `GRAIN_DECIDED_BY`: REQ-6;
      - `DUB_TRIM`: seconds from the start where `098` cut the output; omitted when nothing was cut or
        the detection did not run (`5843.120`);
      - `STREAM_END_TRIM`: seconds where `099` cut the output; omitted likewise (`6011.500`).
- [ ] **REQ-6 (Grain verdict)**: `GRAIN_APPLIED` is `yes` or `no`, omitted for `copy`.
      `GRAIN_DECIDED_BY`, when known, is:
      - `title`: the film or series has an explicit `grainMode` `ON` (`092`);
      - `gate`: `094`'s metadata gate said no;
      - `probe`: the encode probe decided;
      - `short`: a short, which never runs the probe.

      An effective `OFF` omits `GRAIN_DECIDED_BY`. It can come from the title's own `OFF` or from
      `INHERIT` with `grain_auto_enabled` off, and the encode payload does not say which (REQ-2). A
      detection that failed (`094`'s silent fallback to off) also omits it.
- [ ] **REQ-7 (Compression off unchanged)**: With `compression_enabled` off, the moved file gets no
      `PERCEPTOR` group, exactly as `046` decided for the passthrough branch.
- [ ] **REQ-8 (Blu-ray input)**: For a `100` disc playlist, `SOURCE` is the `.mpls` path relative to
      the downloads root (what `046` writes today), not the intermediate assembled MKV.

#### Track group on an embedded subtitle

- [ ] **REQ-9 (Track children)**: Every subtitle track a `101`/`103`/`106`/`119` embed appends must
      carry a track-targeted `PERCEPTOR` group with these children:

      | Child | Value |
      | :-- | :-- |
      | `SOURCE` | the provider's file name exactly as the provider named it, with no provider prefix (the provider is `PROVIDER`; 0.4.0 drops the `subdivx:` prefix `121` used to add), or `user` for a hand-embedded sidecar |
      | `OFFSET` | what `107` writes today in `PERCEPTOR_OFFSET`: whole milliseconds, `0` when none was applied |
      | `PROVIDER` | lower-case provider id: `opensubtitles`, `subdivx`, a future provider's id as `api` names it, or `user` for a hand embed |
      | `SYNC_SCORE` | `103`'s ffsubsync score for the accepted measurement; omitted when no measurement ran (a hand embed with a manual offset) |
      | `FRAMERATE_RATIO` | the measured ratio, same rule |
      | `EMBEDDED_AT` | when this embed replaced the file, UTC |

- [ ] **REQ-10 (Provider is open-ended)**: The worker writes `PROVIDER` verbatim from what `api`
      sends and validates nothing about it. A provider added after this spec needs no worker change.
- [ ] **REQ-11 (Existing tracks untouched by an embed)**: An embed must leave the tags of tracks it
      did not add, and the file's global `PERCEPTOR` group, exactly as they were. It does not convert
      an old flat global tag as a side effect. That is the migration's job (REQ-12).

#### Library migration

- [ ] **REQ-12 (Admin button)**: Settings → Environment must show administrators a "Migrar
      etiquetas de la biblioteca" action. A short explanation says the action rewrites Perceptor's
      own tags inside every library file Perceptor knows about, touching nothing else in the file.
      Starting it asks for confirmation. Non-administrators never see it.
- [ ] **REQ-13 (Scope of the walk)**: The migration covers every film and episode whose library file
      `api` knows: the `filePath` it delivered, or the media server's `libraryPath` (`107`). A title
      with no known path is not counted. Files under the destinations root that no title points at are
      never touched.
- [ ] **REQ-14 (What a migrated file ends up with)**: For each file:
      - an existing flat `PERCEPTOR_SOURCE` global tag becomes `PERCEPTOR` → `SOURCE`, with the value
        kept verbatim;
      - each track's flat `PERCEPTOR_SOURCE`/`PERCEPTOR_OFFSET` becomes that track's `PERCEPTOR` →
        `SOURCE`/`OFFSET`;
      - every other child is filled from what the database still holds about how this file was
        produced and left out when it holds nothing (REQ-2): `ENCODED_AT` goes in the global group,
        the encode facts in a `PERCEPTOR` group on the video track (REQ-5). `VERSION` is never
        invented for a file encoded before this feature;
      - the flat tags are removed;
      - nothing else changes: no stream, no track header, no other tag, no `title`.
- [ ] **REQ-15 (The stored FFmpeg command is the source of truth)**: For the video group's
      encode facts, the only database source is the stored `ffmpegCommand` of the `ProcessJob` that
      delivered this file. It is parsed. The title's present-day columns (`contentKind`,
      `grainMode`, the installation settings) are never consulted, because they may have changed
      after the encode. Where the file and the command disagree on a child both can answer, the file
      wins. From the command:
      - `VIDEO_CODEC`: `av1` when it encodes with SVT-AV1, `copy` when the video is stream-copied;
      - `CRF` and `PRESET`: from the SVT-AV1 arguments;
      - `CONTENT_KIND`: only when the SVT-AV1 parameters match exactly one content-kind branch.
        `ANIME` and `CGI` tune identically today (`057`), so such a command leaves `CONTENT_KIND`
        out;
      - `RESOLUTION_CEILING`: from the scale filter when there is one; otherwise left out (without a
        scale filter, the command does not record the ceiling). `OUTPUT_RESOLUTION`: read from the
        file's own video track;
      - `DEINTERLACED`: `yes` when the command carries `bwdif`;
      - `GRAIN_APPLIED`: from the `film-grain` value. `GRAIN_DECIDED_BY` is always left out for a
        migrated file, because the command does not record why;
      - `DUB_TRIM` / `STREAM_END_TRIM`: both are left out. A `-t` in the command is the minimum of
        the two cuts plus any sample limit, so it cannot be attributed to either one.

      Facts the command cannot hold come from the rows themselves:
      - `ENCODED_AT`: the delivering `ProcessJob.updatedAt`;
      - each track's `PROVIDER` / `SYNC_SCORE` / `FRAMERATE_RATIO`: the `ACCEPTED`
        `SubtitleSearchAttempt` whose `providerFileName` equals the track's existing `SOURCE`, or
        `PROVIDER: user` when that `SOURCE` is `user`;
      - each track's `EMBEDDED_AT`: the `finishedAt` of the `COMPLETED` `SubtitleEmbed` that carried
        it.

      `SOURCE_RESOLUTION` and `VERSION` are never written for a migrated file. A file with no
      delivering `ProcessJob` (Jellyfin-held, or its job rows gone) gets only what its own flat tags
      say.
- [ ] **REQ-16 (Idempotent)**: Running the migration again over a migrated file changes nothing. A
      file that already has its `PERCEPTOR` groups in the current layout (REQ-20) and no flat tags is
      reported `UNCHANGED`. A file with
      neither, such as a title the media server held but Perceptor never delivered, gets a group only
      if the database knows something about it, and is otherwise `UNCHANGED`.
- [ ] **REQ-17 (Busy titles are skipped)**: A file whose title has an encode in flight, a subtitle
      embed `QUEUED`/`RUNNING`/`SYNCING`, or a subtitle search past `WAITING` is skipped as `BUSY` and
      left untouched. A later run picks it up. While a migration is writing a given file, every
      acquisition entry point and embed for that title is refused with `error.libraryTags.busy`, the
      same way `101` makes an embed and an acquisition exclude each other.
- [ ] **REQ-18 (Progress and result)**: While a migration runs, the Environment tab shows it as
      running, with `processed / total` and live counts per outcome. When it finishes, the tab shows
      the totals: `MIGRATED`, `UNCHANGED`, `BUSY`, `MISSING` (path not found on disk), `FAILED`.
      Failed files are listed with their path and reason. The last result stays visible until the
      next run starts. Updates are fetched on page load and `router.refresh()` only, never polled,
      the same as the `064` sidebar badge. The panel offers a refresh control while the run is
      `RUNNING`.
- [ ] **REQ-20 (Earlier layouts are converted)**: Added in 0.4.0. The migration also converts files
      written by the 0.3 layout of this feature. This covers files from the development builds
      only; no published release carried it. It is an in-place rewrite of the same tags element, under
      the same rules as REQ-14 and REQ-16:
      - a global `PERCEPTOR` group with an `ENCODE` or `GRAIN` sub-group, `DUB_TRIM` or
        `STREAM_END_TRIM` loses them, and their values move, flattened per REQ-5 and REQ-6
        (`GRAIN` → `APPLIED` becomes `GRAIN_APPLIED`, `DECIDED_BY` becomes `GRAIN_DECIDED_BY`), into the
        video track's group; the global group keeps `SOURCE`, `VERSION` and `ENCODED_AT`;
      - a `VERSION` written by a migration (not by an encode) cannot be told apart from an encode's and
        is left as it is;
      - a track group whose `SOURCE` starts with `<PROVIDER>:` (for example `subdivx:`) has that prefix
        removed from `SOURCE`. This is the only case where the migration changes a `SOURCE` value; every
        other `SOURCE` and `OFFSET` stays verbatim (REQ-14).
- [ ] **REQ-19 (One at a time)**: Only one migration runs per installation. Pressing the button
      while one is running is refused with `error.libraryTags.migration_running`.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Constitution first)**: Article XII must be amended before `/plan-feature`, through
      `/constitution`, with a third library-write exception (done: constitution 1.8.0, Article XII exception 3). It allows an **in-place edit of only the
      Matroska `Tags` element** of a library `.mkv` (`mkvpropedit`), at an administrator's explicit
      request through this migration. No copy, no `.part` file and no `rename` are involved. Every
      stream, every track header and every other element must stay byte-for-byte as it was, and
      nothing is ever deleted. The amendment must state the risk this accepts: unlike exception 1,
      the edit is not atomic, and a crash in the middle of the tag write can damage that file's
      header. To keep that risk small, the worker checks that the file is readable and writable, and
      that it can probe it, before it writes anything.
- [ ] **NFR-2 (Readable by stock tools)**: The grouped tags must show as a `PERCEPTOR` tree, with
      every child and value from REQ-4–REQ-9, in `mkvinfo` and in MediaInfo's text output for a file
      the current worker produced. Nothing sits deeper than `PERCEPTOR` → child, because MediaInfo
      drops a third level.
- [ ] **NFR-3 (Tagging never fails an encode or an embed)**: If a child's value cannot be computed,
      for example an unreadable resolution or a missing version, only that child is left out. The
      encode or embed itself never fails because of a tag.
- [ ] **NFR-4 (Migration failure is per file)**: One file that fails (unreadable, permission
      denied, probe failure, edit refused, post-edit verification mismatch) is recorded as `FAILED`
      with its reason, and the walk continues. A file that fails any check before the edit is left
      byte-identical. After the edit, the worker re-probes the file and compares its streams, codecs,
      durations and track languages/titles with the pre-edit probe. A mismatch is `verify_failed`
      and is logged with the path, so the administrator can inspect the file. It cannot be undone
      automatically, because there is no copy. A worker restart mid-migration resumes the walk
      rather than starting over or leaving it reading "running" forever, the same posture as `054`.
      The file being edited at the moment of the restart is re-checked and re-edited, which is safe
      because the edit is idempotent (REQ-16).
- [ ] **NFR-5 (Version is baked, not configured)**: The worker reads its version from its own
      image. Published images carry the release tag they were built as. A source build carries
      `dev`. It is not a Setting and not an `.env` variable a user edits.
- [ ] **NFR-6 (Media server is told)**: After each file is `MIGRATED`, `api` notifies the
      configured media server that the file was modified. This is the same notification `101` sends
      after an embed: Jellyfin's `Library/Media/Updated` with `Modified`, or Plex's path-scoped
      section scan (`072`). With media server `none`, nothing is sent. A failed notification is
      logged and does not change the file's outcome. Files that end `UNCHANGED`, `BUSY`, `MISSING`
      or `FAILED` before the edit trigger no notification.

## GraphQL Contract Delta

```graphql
# Spec 123, REQ-9
type SubtitleEmbedTrack {
  # existing fields unchanged; `provenance` keeps its value and now feeds PERCEPTOR → SOURCE
  """Lower-case provider id written verbatim as PERCEPTOR → PROVIDER: opensubtitles, subdivx, …, or `user` for a hand embed (123 REQ-9/10)."""
  provider: String!
  """ffsubsync score of the accepted measurement; null when none ran (manual offset)."""
  syncScore: Float
  """Measured framerate ratio of the accepted measurement; null when none ran."""
  framerateRatio: Float
}

# Spec 123, REQ-12/18
enum LibraryTagMigrationStatus { RUNNING COMPLETED }
enum LibraryTagOutcome { MIGRATED UNCHANGED BUSY MISSING FAILED }

type LibraryTagMigrationFailure {
  path: String!          # host-side path, never the container path (env rule on paths)
  reasonKey: String!     # i18n key
}

type LibraryTagMigration {
  id: Int!
  status: LibraryTagMigrationStatus!
  total: Int!
  processed: Int!
  migrated: Int!
  unchanged: Int!
  busy: Int!
  missing: Int!
  failed: Int!
  failures: [LibraryTagMigrationFailure!]!
  startedAt: DateTime!
  finishedAt: DateTime
}

# Spec 123, worker <-> api, one library file
type LibraryTagMigrationItemDetails {
  id: Int!
  filePath: String!            # absolute container path of the library .mkv
  """Database-derived children for the global group (REQ-14/15); every field nullable, null = omit."""
  encodedAt: DateTime
  videoCodec: String
  crf: Int
  preset: Int
  contentKind: String
  resolutionCeiling: String
  outputResolution: String
  grainApplied: Boolean        # REQ-15: film-grain > 0 in the stored command; null for a copy or no flag
  deinterlaced: Boolean        # REQ-15: bwdif in the stored filter chain; null when the command did not parse
  dubTrimSeconds: Float
  streamEndTrimSeconds: Float
  """Track children keyed by the track's existing PERCEPTOR_SOURCE value."""
  tracks: [LibraryTagMigrationTrack!]!
}

type LibraryTagMigrationTrack {
  source: String!
  provider: String
  syncScore: Float
  framerateRatio: Float
  embeddedAt: DateTime
}

type Query {
  """Latest migration, running or finished; null if none ever ran. Admin only."""
  libraryTagMigration: LibraryTagMigration
  """Worker only (service token). Claims the item: from this call until its outcome is reported, the title reads busy (REQ-17)."""
  libraryTagMigrationItem(id: Int!): LibraryTagMigrationItemDetails!
}

type Mutation {
  """Admin only. Starts a walk over every known library file (REQ-12/13)."""
  startLibraryTagMigration: LibraryTagMigration!
  """Worker only. Idempotent: a repeated report for the same item is acknowledged and ignored."""
  libraryTagMigrationItemFinished(id: Int!, outcome: LibraryTagOutcome!, reasonKey: String): Boolean!
}
```

| Condition | Error | Message the user sees |
| :-- | :-- | :-- |
| `startLibraryTagMigration` / `libraryTagMigration` by a non-admin | `ForbiddenException` `error.auth.admin_required` (existing) | existing copy |
| A migration is already `RUNNING` | `ConflictException` `error.libraryTags.migration_running` | `Ya hay una migración de etiquetas en curso.` |
| An acquisition entry point or embed on a title whose file is being migrated | `ConflictException` `error.libraryTags.busy` | `Se están reescribiendo las etiquetas de este archivo; probá de nuevo en un momento.` |
| `libraryTagMigrationItem` for an unknown id | `NotFoundException` `error.libraryTags.item_not_found` | never user-facing; the worker drops the job |
| `libraryTagMigrationItem` for an item `api` settled itself: already reported, its title busy (`BUSY`), or no library path resolvable (`MISSING`) | `ConflictException` `error.libraryTags.item_settled` | never user-facing; `api` has already recorded the outcome, the worker drops the job and reports nothing |
| Media server notification after a migrated file fails | — (logged, not surfaced) | none; the file stays `MIGRATED` (NFR-6) |
| Per-file `reasonKey`s shown in the failures list | — | `error.libraryTags.file_missing` `No se encontró el archivo.`, `error.libraryTags.write_failed` `No se pudo escribir el archivo.`, `error.libraryTags.verify_failed` `El archivo reescrito no coincide con el original; se dejó sin cambios.` |

Consumers: `web` shows `migration_running` inline on the button and refreshes the panel. It shows
`libraryTags.busy` wherever it already shows `error.subtitleEmbed.busy`. The worker treats
`item_not_found` and `item_settled` as "drop silently, report nothing", the same way it treats a refused `encodeStarted`.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `LibraryTagMigration` (new) | one row per run: status, counts, `startedAt`, `finishedAt` | counts default 0 | No |
| `LibraryTagMigrationItem` (new) | one row per file: migration id, `movieId`/`episodeId`, path, outcome, `reasonKey` | outcome nullable until reported | No |

The subtitle embed's `SubtitleEmbed.tracks` JSON gains `provider`, `syncScore`, `framerateRatio` per
track. Rows written before this feature lack them, and a re-run of such an embed treats them as
absent (REQ-2). No backfill is needed.

## Acceptance Criteria

- [ ] **AC-1**: Given compression on, when a film finishes encoding, then `mkvinfo` on the library
      file shows a global `PERCEPTOR` tag with exactly `SOURCE`, `VERSION` and `ENCODED_AT`, a
      `PERCEPTOR` tag on the video track with `VIDEO_CODEC`, `CRF`, `PRESET`, `CONTENT_KIND`,
      `RESOLUTION_CEILING`, `SOURCE_RESOLUTION`, `OUTPUT_RESOLUTION`, `GRAIN_APPLIED` and
      `GRAIN_DECIDED_BY`, no tag deeper than `PERCEPTOR` → child, and no top-level `PERCEPTOR_SOURCE`.
      MediaInfo's text output lists the same children.
- [ ] **AC-2**: Given `dub_trim_enabled` on and a file `098` cuts, then `DUB_TRIM` equals the cut
      point in seconds. Given a file it does not cut, `DUB_TRIM` is absent rather than `0`.
- [ ] **AC-3**: Given a published image `vX.Y.Z`, `VERSION` reads `vX.Y.Z`. Given a `bin/dev` build,
      it reads `dev`.
- [ ] **AC-4**: Given compression off, the moved file carries no `PERCEPTOR` tag at all (REQ-7).
- [ ] **AC-5**: Given a subtitle search accepts a Subdivx candidate, the embedded track's
      `PERCEPTOR` group shows `PROVIDER: subdivx`, `SOURCE` equal to the downloaded file name with no
      `subdivx:` prefix,
      `OFFSET`, `SYNC_SCORE`, `FRAMERATE_RATIO` and `EMBEDDED_AT`. Given an admin hand-embeds a
      sidecar with a manual offset, the track shows `PROVIDER: user`, `SOURCE: user`, `OFFSET` and
      `EMBEDDED_AT`, with no sync children. The tracks that were already in the file show identical
      tags before and after.
- [ ] **AC-6**: As a non-admin, Settings → Environment shows no migration button, and calling
      `startLibraryTagMigration` directly returns `error.auth.admin_required`.
- [ ] **AC-7**: Given a library file carrying the old flat `PERCEPTOR_SOURCE` plus an embedded track
      with flat `PERCEPTOR_SOURCE`/`PERCEPTOR_OFFSET`, after a migration `mkvinfo` shows those values
      verbatim under `PERCEPTOR` → `SOURCE`/`OFFSET`, no flat tags remain, and `ffprobe` reports the
      same streams, codecs, durations and track languages/titles as before.
- [ ] **AC-7b**: Given a file delivered by a job whose stored `ffmpegCommand` encodes with
      SVT-AV1 at CRF 22 with `film-grain=8`, after a migration the video track's `PERCEPTOR` →
      `CRF` reads `22` and `GRAIN_APPLIED` reads `yes`, and none of `GRAIN_DECIDED_BY`, `VERSION`,
      `DUB_TRIM` or `STREAM_END_TRIM` is present. Changing the title's `contentKind` or `grainMode` before
      migrating changes nothing in the result.
- [ ] **AC-7c**: With Jellyfin configured, after a file is migrated, the api log shows the
      `Library/Media/Updated` notification for that file's host path, and the item still opens and
      plays in Jellyfin as the same item.
- [ ] **AC-7d**: Given a file written by the 0.3 layout (a global group with `ENCODE`/`GRAIN`
      sub-groups, and a track `SOURCE` of `subdivx:<name>`), after a migration the global group holds
      only `SOURCE`, `VERSION` and `ENCODED_AT`, the video track's group holds the flattened encode
      children, the track's `SOURCE` is `<name>`, and a second run reports `UNCHANGED`.
- [ ] **AC-8**: Running the migration twice in a row: the second run reports every file as
      `UNCHANGED` and no file's mtime changes.
- [ ] **AC-9 (failure)**: Given one library file made unreadable (`chmod 000`) and one deleted, a
      migration finishes `COMPLETED` with that file `FAILED` (`write_failed`), the deleted one
      `MISSING`, every other file migrated, and the unreadable file byte-identical once permissions
      are restored.
- [ ] **AC-10 (failure)**: Pressing the button a second time while a migration runs shows
      "Ya hay una migración de etiquetas en curso." and starts nothing.
- [ ] **AC-11 (failure)**: Given a title with a subtitle embed `RUNNING` when the walk reaches it,
      that file is reported `BUSY` and left untouched, and a later run migrates it.
- [ ] **AC-12 (failure)**: Restarting the `worker` container mid-migration does not leave the panel
      reading "running" forever. The walk resumes, and the final totals add up to `total`.

## Out of Scope

- **Per-audio-track decisions** (`122`'s detected language, `110`'s variant verdict). These were
  discussed and left out. They can join the track group later without reshaping it.
- **Tags on passthrough files** (compression off). `046` decided against them, and nothing here
  revisits that.
- **Reading the tags back.** Perceptor still never reads its own tags. They are for humans and
  external tools. No feature may start depending on them without its own spec.
- **Files nobody points at.** Orphans under the destinations root, and files from before Perceptor
  existed with no title row, are not walked (REQ-13).
- **Rewriting `title`.** The player-facing `title` tag keeps `046`'s rules and is never touched by
  the migration.
- **Non-Matroska outputs.** Every Perceptor output is `.mkv`. A non-`.mkv` library file the media
  server points at is reported `UNCHANGED` and left alone.

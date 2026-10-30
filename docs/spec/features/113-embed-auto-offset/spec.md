---
title: Automatic Offset for Subtitle Embed
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-30
last_updated: 2026-10-30
status: Implemented
services: [api, worker, web]
---

# SPEC: Automatic Offset for Subtitle Embed (`spec.md`)

## Context & Goal

`101-jellyfin-subtitle-embed` lets an administrator embed a title's external `.srt` sidecars into its
library `.mkv` from a dialog (`services/web/src/components/media/EmbedSubtitlesModal.tsx`). Each
sidecar row has an include checkbox, a language, a "make default" checkbox and an offset in
milliseconds. The offset is typed by hand and defaults to `0`. To find the right value, the
administrator plays the file somewhere else, measures the drift and comes back to type a number.
Often they skip that and embed a sidecar that is out of sync.

`103-subtitle-search` already solves the measurement for subtitles it downloads. The worker's
`subtitle-sync` job runs `ffsubsync` against a reference from the library file and reports offset,
framerate ratio, reference, score, duration and last-chapter start. `api` applies a measured
acceptance rule (`103` REQ-10), and the accepted offset is what `101`'s remux applies. None of that
is available from the manual dialog: `subtitleSyncDetails` and its reports are keyed by a
`SubtitleSearchAttempt` and read a candidate staged under the downloads root.

This feature adds an "Automático" checkbox beside each row's offset input. It is checked by default,
and while it is checked the input is disabled. For every row embedded with it checked, the worker
measures the sidecar against the library file, `api` applies `103`'s acceptance rule unchanged, and
the embed applies the measured offset. A rejected measurement fails the whole embed before anything
is written, so the `.mkv` and every sidecar stay as they were. The stage this touches is "Notify
media server" (the `101`/`103` subtitle work), plus the `worker`'s `subtitle-sync` job, which gains
a second job that has no search behind it.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Checkbox)**: Every sidecar row in the embed dialog has an "Automático" checkbox
      beside the offset input. It is checked when the dialog opens. While it is checked, the offset
      input is disabled and its value plays no part in whether the dialog can be confirmed. While it
      is unchecked, the row behaves exactly as `101` REQ-4 describes. When the row is not included,
      the checkbox is disabled like the row's other controls.
- [ ] **REQ-2 (Request)**: Each selected sidecar in `embedMovieSubtitles`/`embedEpisodeSubtitles`
      carries whether its offset is automatic. For an automatic sidecar, `offsetMs` is ignored: it is
      not range-checked and is never applied. For a manual sidecar, nothing about `101` changes.
      Every other `101` check runs before anything is queued and is unchanged: admin, media server,
      selection, possession, `.mkv`, listing, busy.
- [ ] **REQ-3 (Measurement)**: An embed with at least one automatic sidecar is first created as
      `SYNCING` rather than `QUEUED`. The worker measures each automatic sidecar against the library
      `.mkv`. The reference, the reported values and the 600 s search window are exactly `103`
      REQ-10's: the first non-forced text subtitle track, otherwise the default (or first) audio
      track. An embed with no automatic sidecar is created `QUEUED` as today and never reads
      `SYNCING`.
- [ ] **REQ-4 (Acceptance)**: `api` judges each measurement with `103` REQ-10's acceptance rule,
      thresholds and order unchanged: framerate ratio, offset range, coverage of the sidecar's last
      cue, then score per reference. The rule is shared code, never a copy. The last cue is read
      from the sidecar itself.
- [ ] **REQ-5 (All or nothing)**: The embed moves from `SYNCING` to `QUEUED` only once every
      automatic sidecar is accepted. Each accepted sidecar's measured offset becomes the offset
      `101`'s remux applies to that track. From `QUEUED` on, the embed is `101`'s unchanged: remux,
      verification, atomic rename, sidecar deletion, media-server refresh. On the first rejection or
      measurement failure, the embed ends `FAILED` with that sidecar's reason (see the error table).
      No further measurement is used, nothing is queued for the remux, and the `.mkv` and every
      sidecar are left untouched.
- [ ] **REQ-6 (Busy)**: A `SYNCING` embed is an embed in flight for every purpose `101` REQ-16 gives
      that phrase. It refuses another embed and every acquisition entry point with
      `error.subtitleEmbed.busy`, and acquisition work in flight refuses it. `106`'s manual search
      preflight and `103`'s staged embed see it as busy too.
- [ ] **REQ-7 (Dialog feedback)**: While the title's latest embed is `SYNCING`, the embed button
      shows an in-flight state labelled "Sincronizando subtítulos…", distinct from the existing
      `QUEUED`/`RUNNING` label, and cannot be pressed. A `FAILED` embed shows its reason through the
      existing failure line.
- [ ] **REQ-8 (Stored offset)**: Once accepted, the measured offset is the stored track offset that
      `subtitleEmbedDetails` returns. The worker's `subtitle-embed` job cannot tell a measured
      offset from a typed one and does not change.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Library untouched by measuring)**: Measuring reads the library `.mkv` and the
      sidecar and writes only to the worker's own temporary directory, never beside either file
      (Constitution, Article XII). The sidecar is not modified, renamed or deleted by a measurement,
      accepted or not.
- [ ] **NFR-2 (Interruption)**: A `SYNCING` embed must never wait forever. When the worker announces
      its boot (`encodeWorkerStarted`), every embed still `SYNCING` ends `FAILED` with the existing
      `error.subtitleEmbed.interrupted`, the same as a `RUNNING` one today. A measurement report
      that arrives for an embed no longer `SYNCING` is acknowledged and ignored, so a retried report
      is safe to receive more than once (`038`'s posture).
- [ ] **NFR-3 (Bounded wait)**: Each measurement runs under `103`'s existing worker timeout. A
      timeout is reported as a measurement failure, not left running.
- [ ] **NFR-4 (No quota cost)**: Measuring a sidecar makes no external call. No OpenSubtitles, TMDB
      or Jellyfin request is added beyond the listing `101` already reads.
- [ ] **NFR-5 (Search unaffected)**: `103`/`106` searches keep their own sync job, payload,
      operations and outcomes unchanged. A staged embed (`embedStaged`) never carries an automatic
      track and never reads `SYNCING`.

## GraphQL Contract Delta

```graphql
enum SubtitleEmbedStatus {
  SYNCING
  QUEUED
  RUNNING
  COMPLETED
  FAILED
}

input SubtitleEmbedInput {
  fileName: String!
  languageIso3: String!
  isDefault: Boolean!
  offsetMs: Int!

  """True: api measures the offset (113 REQ-3) and ignores offsetMs. Defaults to false (101's behaviour)."""
  autoOffset: Boolean! = false
}

type SubtitleEmbedSyncDetails {
  subtitleEmbedId: Int!
  fileName: String!

  """Absolute container path of the library .mkv used as the reference."""
  filePath: String!

  """Absolute container path of the sidecar, in filePath's directory."""
  candidatePath: String!
}

type Query {
  """Service-only (worker). Refused with error.subtitleEmbed.sync_not_found unless the embed is SYNCING and fileName is one of its automatic tracks."""
  subtitleEmbedSyncDetails(subtitleEmbedId: Int!, fileName: String!): SubtitleEmbedSyncDetails!
}

type Mutation {
  """Service-only (worker). Same arguments as subtitleSyncCompleted. Safe to receive more than once; false when the embed is no longer SYNCING."""
  subtitleEmbedSyncCompleted(
    subtitleEmbedId: Int!
    fileName: String!
    offsetMs: Int!
    framerateRatio: Float!
    reference: SubtitleSyncReference!
    score: Float!
    mediaDurationMs: Int!
    lastChapterStartMs: Int
  ): Boolean!

  """Service-only (worker). Safe to receive more than once; false when the embed is no longer SYNCING."""
  subtitleEmbedSyncFailed(subtitleEmbedId: Int!, fileName: String!, errorKey: String!): Boolean!
}
```

**Queue contract.** On the existing queue `subtitle-sync`, a new job name `subtitle-embed-sync`
with payload `{ subtitleEmbedId: number, fileName: string }`. It is declared in
`services/api/src/queue/types.ts` and copied by hand into `services/worker/src/queue/types.ts`.
`103`'s `subtitle-sync` job and payload are unchanged. The worker reports measurements, never a
verdict, as in `103`.

`web` must add `SYNCING` everywhere it switches on `SubtitleEmbedStatus`. `EmbedSubtitlesButton`'s
in-flight test is the known site. An unknown status must not render as idle, so it reads as in
flight. The worker never sees `SYNCING`: `subtitleEmbedStarted` already refuses anything not
`QUEUED`.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Embed refused because a `SYNCING` embed is in flight (REQ-6) | `ConflictException`, `error.subtitleEmbed.busy` (existing) | `Este título tiene una descarga, codificación o incrustación en curso.` |
| Manual sidecar's offset out of range (unchanged; never raised for an automatic one) | `BadRequestException`, `error.subtitleEmbed.offset_out_of_range` (existing) | `El desfase tiene que estar entre -600000 y 600000 ms.` |
| Measurement could not run: no reference stream, ffsubsync failure, timeout, unreadable sidecar (stored as `SubtitleEmbed.errorKey`) | `error.subtitleEmbed.sync_failed` | `No se pudo calcular el desfase automático de un subtítulo. El archivo no se tocó.` |
| Framerate ratio outside 1 ± 0.0005 (stored) | `error.subtitleEmbed.sync_framerate_mismatch` | `Un subtítulo es de una versión con otro framerate. El archivo no se tocó.` |
| Offset over 600 s (stored) | `error.subtitleEmbed.sync_offset_too_large` | `Un subtítulo está demasiado desfasado para corregirlo automáticamente. El archivo no se tocó.` |
| Last cue does not cover the file (stored) | `error.subtitleEmbed.sync_incomplete` | `Un subtítulo solo cubre parte del archivo. El archivo no se tocó.` |
| Score under the reference's threshold (stored) | `error.subtitleEmbed.sync_low_score` | `Un subtítulo no coincide con este archivo. Probá con el desfase manual. El archivo no se tocó.` |
| Worker restarted while `SYNCING` (NFR-2, stored) | `error.subtitleEmbed.interrupted` (existing) | `La incrustación se interrumpió por un reinicio del worker. Probá de nuevo.` |
| `subtitleEmbedSyncDetails` for an embed not `SYNCING` or a non-automatic file (service-only) | `NotFoundException`, `error.subtitleEmbed.sync_not_found` | — (worker reports nothing and drops the job) |

The stored keys are new in `api` `messages.en.ts`, `worker` `messages.en.ts` (for `sync_failed`,
which the worker reports) and `web` `messages/{en,es}.json`. `web` renders them through the existing
`FAILED` line. No new action error path is needed, because the mutation itself returns as soon as
the row is created.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `SubtitleEmbedStatus` (enum) | add `SYNCING` | — | No |
| `SubtitleEmbed.tracks` (JSON) | each stored track may carry `autoOffset` and, once measured, the reported measurement | absent ⇒ manual, as every existing row | No |

No new table. A measurement is identified by `(subtitleEmbedId, fileName)`, which `101` REQ-4
already makes unique within an embed.

## Acceptance Criteria

All nine are implemented and covered by unit tests, but not yet observed live (left unticked on purpose). Blocker: the manual pass needs a dev stack of this checkout with a Jellyfin library, `ffsubsync` and a real sidecar, and the host's running stack is the end-user install (`plan.md` § Verification).

- [ ] **AC-1**: Given a film with one Jellyfin sidecar, when an admin opens "Incrustar en archivo",
      then the row shows "Automático" checked and the offset input disabled. Unchecking it enables
      the input with `0`. Typing `abc` while unchecked disables the confirm button. Checking it again
      re-enables confirm.
- [ ] **AC-2**: Given a sidecar known to be 2 s late against the film, when it is embedded with
      "Automático" checked, then the embed reads `SYNCING`, then `QUEUED`/`RUNNING`, then `COMPLETED`.
      Its stored track offset is within ±100 ms of `-2000`. Playing the film shows the subtitle in
      sync, and the `.srt` is gone from the folder.
- [ ] **AC-3**: Given the same film, when the sidecar is embedded with "Automático" unchecked and
      offset `1500`, then the embed is never `SYNCING` and the stored offset is exactly `1500`
      (`101` unchanged).
- [ ] **AC-4 (failure)**: Given a sidecar from a different cut of the film (e.g. a 25 fps PAL
      subtitle on a 23.976 fps file), when it is embedded with "Automático" checked, then the embed
      ends `FAILED` with `error.subtitleEmbed.sync_framerate_mismatch`. The dialog's button shows the
      Spanish reason. The `.mkv`'s mtime and size are unchanged, and the `.srt` is still in the
      folder.
- [ ] **AC-5 (failure, all or nothing)**: Given two sidecars, one in sync and one that does not
      match the file, when both are embedded with "Automático" checked, then the embed ends
      `FAILED` with `error.subtitleEmbed.sync_low_score` (or another `sync_*` key). Neither track is
      embedded, both `.srt` files remain, and no `bull:subtitle-embed` job was added.
- [ ] **AC-6 (failure, interruption)**: Given an embed in `SYNCING`, when `docker compose restart
      worker` runs, then the embed ends `FAILED` with `error.subtitleEmbed.interrupted` and the
      embed button is pressable again.
- [ ] **AC-7**: Given an embed in `SYNCING` for a film, when the user adds a torrent to that film,
      then it is refused with `error.subtitleEmbed.busy`. A second embed attempt is refused the same
      way.
- [ ] **AC-8**: Given a `106` manual search that embeds what it validated, its embed row never reads
      `SYNCING`, and `103`'s `subtitle-sync` job still runs for its candidates.
- [ ] **AC-9**: After an automatic embed, nothing new exists in the title's library folder besides
      the replaced `.mkv`: no `.srt` copy and no temporary file from the measurement.

## Out of Scope

- **Showing the measured offset before embedding.** There is no "detect" button that fills the
  input for review. Checking "Automático" means "measure and apply". A preview would need a
  measurement with no embed behind it and a second round trip, and it is what the manual mode is
  for.
- **Naming the failing sidecar in the error.** `SubtitleEmbed.errorKey` has no parameters. The
  reason says that one subtitle failed, not which one. Most titles have a single sidecar, and the
  admin can retry with fewer rows checked.
- **Partial embed or a fallback offset of 0.** A rejected automatic sidecar never lets the others
  through and never embeds unsynced (REQ-5). This was decided in favour of a file that is never
  touched on doubt.
- **Correcting framerate drift.** Only a constant offset is applied, as in `101`/`103`. A sidecar
  with the wrong framerate is rejected, not stretched.
- **Different acceptance thresholds for a hand-picked sidecar.** `103`'s rule is reused unchanged
  (REQ-4). Relaxing it for sidecars the admin chose is a later amendment if real files show it is
  too strict.
- **Remembering the checkbox.** The checkbox opens checked every time. Nothing is persisted per
  user or per title.

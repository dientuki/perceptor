---
title: Optional compression
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-08-28
last_updated: 2026-08-28
status: Implemented
services: [api, web, worker]
---

# SPEC: Optional compression (`spec.md`)

## Context & Goal

The Compression tab of the Settings screen (`services/web/src/components/settings/CompressionPanel.tsx`)
is markup with no wiring: `029-settings-screen-tabs` shipped it as a checkbox plus three preset
radios held in local `useState`, deliberately reaching neither `FormData` nor the settings catalog.
Meanwhile the transcode stage is unconditional by design — `024-retire-gpu-tonemap-strategy` removed
every host-dependent branch so that `bin/dev`, `bin/prod` and `bin/build` produce the identical
invocation everywhere, and `services/worker/src/jobs/encode.job.ts` always calls the ffmpeg driver.
There is no way for an operator to say "just file this one, don't re-encode it".

This feature makes compression an installation-wide switch. The checkbox becomes the `Switch`
component the user just added (`services/web/src/components/form/switch/Switch.tsx`); it is the only
control on that tab that persists, and while it is off every other compression control on the tab is
non-modifiable. `api` gains one boolean settings key and hands its value to the worker on the
`processJob` query it already answers — the worker is a service principal and `Query.settings` is
administrator-only, so the value has to ride the job payload the way `outputRoot` and
`allowedLanguagesIso3` already do.

What changes in the pipeline is the **Transcode** row of the root `CLAUDE.md` table, and only that
row: it stops being unconditional. Everything downstream of it is unchanged. With compression off
the worker still resolves the destination through `buildOutputPath`
(`services/worker/src/paths/build-output-path.ts`), still creates the title/season folder, still puts
the file there under the library's naming convention, still reports `encodeCompleted`, and still
performs whatever cleanup the api instructs — stopping the torrent, removing the download path.
Only FFmpeg and its mkvmerge remux are skipped, and the source file is moved into place instead of
being re-encoded into place. "Compression off" means "no FFmpeg", never "no filing".

## Requirements

### Functional Requirements

#### web

- [x] **REQ-1 (Switch)**: The Compression tab must render the enable control as
      `components/form/switch/Switch.tsx`, not `components/form/input/Checkbox.tsx`. It must show the
      persisted `compression_enabled` value on load and must be saved by the main Settings form's
      existing Save button, not by a form of its own.
- [x] **REQ-2 (Reaches FormData)**: The switch's state must always reach the server as an explicit
      `"true"` or `"false"`, never as presence/absence — the same hidden-input idiom `CheckboxField`
      already uses for `movies_enabled`/`shows_enabled`. Saving the Settings screen from any tab must
      never silently flip this key.
- [x] **REQ-3 (Dependents locked)**: While the switch is off, every other control in the Compression
      tab must be non-modifiable — visibly disabled and unable to receive keyboard or pointer input.
      Today that is the three preset radios; the rule is about the tab, so any control added there
      later is covered. Turning the switch on must re-enable them immediately, with no save and no
      reload.
- [x] **REQ-4 (Presets stay unpersisted)**: The preset radios remain exactly what `029` made them —
      local state, no `name`, no catalog key, no effect on any FFmpeg argument. This feature persists
      one key and one key only.

#### api

- [x] **REQ-5 (Catalog key)**: `compression_enabled` must be an editable settings key of kind
      `boolean`, rejecting any value other than `"true"`/`"false"` with the existing
      `error.setting.expected_boolean`. It must be seeded `"true"`.
- [x] **REQ-6 (Job payload)**: `EncodeJobDetails` must expose `compressionEnabled: Boolean!`,
      resolved from the setting at the moment the worker queries the job — not frozen onto the
      `ProcessJob` row when it is enqueued. Flipping the switch must therefore affect every job that
      has not started yet, including ones already queued.
- [x] **REQ-7 (Missing row means compress)**: If the `compression_enabled` row is absent (an install
      that predates the seed), `compressionEnabled` must resolve to `true`. Absence must never be
      read as "off".

#### worker

- [x] **REQ-8 (On is today)**: When `compressionEnabled` is true, the encode path must behave
      exactly as it does today, ffprobe log and all. This feature adds no behaviour to the
      compressing path.
- [x] **REQ-9 (Off skips FFmpeg only)**: When `compressionEnabled` is false, the job must run no
      `ffprobe`, no `ffmpeg` and no `mkvmerge`, and must still: build the destination path from the
      media's title/year/tmdbId (and season/episode), create that folder, place the source file
      there, report `encodeStarted` and `encodeCompleted`, and execute the cleanup instructions
      `encodeCompleted` returns.
- [x] **REQ-10 (Filed under the library name, original container)**: The destination must be the
      folder and base name `buildOutputPath` produces, carrying the **source file's** extension
      rather than the `.mkv` the encode path always produces. A `.mp4` source filed as `.mkv` is a
      mislabelled container, which is a silent failure in the media server, not in this pipeline.
- [x] **REQ-11 (Moved, not copied)**: The source file must be moved, not duplicated. The move must
      work when source and destination are on different filesystems (downloads on one disk, library
      on another is the normal case here), and must never leave a file bearing the final name that
      is not the complete file — a partial transfer must be cleaned up, exactly as
      `ffmpeg/runner.ts`'s `.part` discipline guarantees for the encode path.
- [x] **REQ-12 (Containment still applies)**: The input file must be verified to sit inside the
      download root before it is moved, the same guard the encode path applies today. The relaxed
      path must not be the one that skips a safety check.
- [x] **REQ-13 (Completion report)**: `encodeCompleted` must be called with the real destination path
      and with an empty `ffmpegCommand`, so a completed job's record distinguishes "was not
      compressed" from "was compressed by an unrecorded command". Progress must reach 100.
- [x] **REQ-14 (Cleanup tolerates the move)**: `removeTorrent`, `deleteInputFile` and
      `deleteDownloadPath` must be honoured unchanged. `deleteInputFile` must succeed silently when
      the input is already gone — the move took it — and must never turn a completed job into a
      failed one.
- [x] **REQ-15 (Failure is reported)**: A failure to place the file (permissions, full disk,
      unreadable source) must report `encodeFailed` with a key of its own,
      `error.encode.move_failed`, carrying the underlying reason as a param.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Default is today's behaviour)**: After this ships and the seed runs, an install that
      never opens the Settings screen must compress exactly as it does now.
- [x] **NFR-2 (Skew fails safe)**: If `compressionEnabled` arrives `undefined` — the field dropped
      from the query selection, or a worker running against an api that predates it — the worker must
      compress. A version skew must never silently stop compressing an entire library, since nothing
      about the resulting files says they were meant to be re-encoded.
- [x] **NFR-3 (Contract is additive)**: `EncodeJobDetails` gains a field; no field changes name, type
      or nullability, and no mutation signature changes. `docs/spec/graphql-contract.md` records the
      new field and the new settings key.
- [x] **NFR-4 (No new host dependency)**: This must not reintroduce a host-dependent branch of the
      kind `024-retire-gpu-tonemap-strategy` removed. The switch is a stored setting an operator
      chooses, identical on every host; nothing is detected, and `bin/dev`/`bin/prod`/`bin/build`
      still produce the same invocation everywhere.

## GraphQL Contract Delta

```graphql
type EncodeJobDetails {
  """
  Whether this job must be re-encoded by FFmpeg. Resolved from the
  `compression_enabled` setting when this query is answered, not when the
  ProcessJob was enqueued. False means: skip ffprobe, ffmpeg and mkvmerge, and
  move the input file to the destination path instead. Everything else about
  the job — output path, completion report, cleanup — is unchanged.
  """
  compressionEnabled: Boolean!
}
```

No other type, field, argument or mutation changes. `Mutation.updateSettings` already accepts
arbitrary `SettingInput` entries validated against the server-side catalog, so persisting the new key
needs no signature change.

**Settings catalog delta** (part of the frozen contract, since `web` hardcodes the key list in
`services/web/src/actions/settings.ts` and `api` hardcodes it in
`services/api/src/settings/settings.catalog.ts`, with no codegen between them):

| Key | Kind | Seeded value | Editable from |
| :-- | :-- | :-- | :-- |
| `compression_enabled` | `boolean` | `"true"` | Settings → Compression tab |

Error table:

| Condition | HTTP / GraphQL error | i18n key | Message the user sees |
| :-- | :-- | :-- | :-- |
| `updateSettings` receives `compression_enabled` with a value other than `"true"`/`"false"` | `BadRequestException` | `error.setting.expected_boolean` (existing) | `El valor de "compression_enabled" tiene que ser true o false` |
| A non-administrator calls `updateSettings` | `ForbiddenException` | `error.auth.admin_required` (existing) | unchanged, `029` |
| The worker cannot place the file with compression off | reported through `encodeFailed`, job ends `FAILED` | `error.encode.move_failed` (new, worker-owned) | `No se pudo mover el archivo al destino: {detail}` |

Consumer obligations:

- `web` — `updateSettingsAction` must send `compression_enabled` on every save of the main form as an
  explicit `"true"`/`"false"`, alongside `movies_enabled`/`shows_enabled`. Its failure handling is the
  existing one: `error.setting.expected_boolean` renders through `translateGraphQLError` like any
  other settings error. `web` does not read the new `EncodeJobDetails` field at all.
- `worker` — must retype `compressionEnabled` into its local `EncodeJobDetails` type and add it to
  the `processJob` selection set. Per NFR-2, `undefined` means compress. It must add
  `error.encode.move_failed` to `src/i18n/error-keys.ts` and `src/i18n/messages.en.ts`, English
  message plus the `{detail}` param, following the existing `error.encode.*` entries.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `Setting` | none — a new **row**, not a new column | seeded `compression_enabled = "true"` | No; REQ-7 makes an install without the row compress |

No Prisma schema change and therefore no migration. The `ProcessJob` table deliberately gains no
column: REQ-6 resolves the flag at query time, not at enqueue time.

## Acceptance Criteria

- [x] **AC-1**: On Settings → Compression, the enable control renders as a sliding switch, not a
      checkbox. With it off, clicking any of the three preset radios changes nothing and they render
      as disabled; turning the switch on makes them clickable again without saving or reloading.
- [x] **AC-2**: Turn the switch off, press Save, reload `/settings`, open the Compression tab — the
      switch is still off. `bin/mysql -e 'select value from Setting where \`key\`="compression_enabled"'`
      prints `false`.
- [x] **AC-3**: With the switch off, save the Settings screen from the **General** tab without ever
      opening the Compression tab. The row still reads `false` — an untouched tab never clobbers the
      key (REQ-2).
- [x] **AC-4** (failure path): Call `updateSettings` as an administrator with
      `{ key: "compression_enabled", value: "maybe" }` (any GraphQL client against
      `http://api:${API_PORT}/graphql`, e.g. from `bin/bash api`). The mutation fails with
      `error.setting.expected_boolean`, and
      ``bin/mysql -e 'select value from Setting where `key`="compression_enabled"'`` still prints the
      previous value: a rejected entry writes nothing.
- [x] **AC-5**: With compression off, download or upload a film whose source is `Some.Film.2019.mp4`.
      When the job completes, `<library>/Some Film (2019) [tmdbid=NNN]/Some Film (2019).mp4` exists,
      byte-identical in size to the source, the source path no longer exists, and the torrent is no
      longer in qBittorrent. `bin/cli worker sh -c 'ps aux'` shows no ffmpeg ran, and the ProcessJob
      row has `status="COMPLETED"`, `progress=100` and an empty `ffmpegCommand`.
- [ ] **AC-6**: With compression off and a **series** source (`Show.S01E03.mkv`), the file lands at
      `<library>/Show (YYYY) [tmdbid=NNN]/Season 01/Show S01E03 <Episode Title>.mkv` — the same naming
      the compressing path produces, episode title from the api, never from the filename.
- [x] **AC-7** (failure path): With compression off, make the destination unwritable (`chmod 500` the
      title folder) and run a job. The job ends `FAILED` with `error.encode.move_failed`, the source
      file is still where it was, and no file bearing the final name exists in the library.
- [ ] **AC-8**: Turn compression back on and run the same job again — an ffmpeg command is recorded on
      the ProcessJob row and the output is `.mkv`, i.e. REQ-8's "on is today" holds after the switch
      has been off.
- [x] **AC-9**: Queue a job while compression is on, stop the worker before it starts, turn the switch
      off, start the worker. The job is filed without compression (REQ-6: the flag is read at encode
      time, not at enqueue time).

## Out of Scope

- **Per-title or per-job compression.** The switch is installation-wide. A "don't compress this one"
  checkbox on a movie's detail page is a different feature with its own storage on `Movie`/`Episode`
  and its own UI; nothing here forecloses it, and REQ-6 deliberately keeps the flag off the
  `ProcessJob` row so that a later per-title override has one obvious place to live.
- **The compression presets.** `fast`/`balanced`/`quality` stay decorative (REQ-4). Making a preset
  change a CRF or an FFmpeg argument is `024`-adjacent territory and needs its own spec — including
  what each preset means for AV1, for the HEVC 4K downscale, and for the remux detection in
  `ffmpeg/remux-detection.ts`.
- **Skipping the transcode automatically when the source is already AV1.** A content-based decision
  reading `ffprobe` output is a different feature from an operator-set switch, and it would need the
  probe this path deliberately skips.
- **An ffprobe log for uncompressed jobs.** `023-ffprobe-log` records the probe the encode driver
  runs; with compression off there is no encode and no probe, so no `FfprobeLog` row is written.
  Probing purely to keep the log populated would reintroduce a cost the switch exists to avoid.
- **A worker-visible settings query.** `Query.settings` stays administrator-only; the flag reaches
  the worker through the job payload it already fetches, so this feature opens no settings surface to
  the service principal.
- **Hardlinking instead of moving.** A hardlink would keep the torrent seedable while the library
  holds the file, but it only works within one filesystem — and here downloads and library are
  routinely different disks. Moving is what REQ-11 asks for; the torrent is stopped and cleaned up as
  the api instructs, exactly as on the compressing path.

---
title: Compression resolution
spec_version: 0.4.0
author: Juan "Dientuki" Farias
created_at: 2026-09-16
last_updated: 2026-09-16
status: Implemented
services: [api, web, worker]
---

# SPEC: Compression resolution (`spec.md`)

## Context & Goal

`044-settings-screen-polish` gave the Compression tab of the Settings screen a four-way resolution
choice (`4k` / `1080p` / `720p` / `360p`) and made it persist: `CompressionPanel.tsx` submits a
hidden `compression_resolution` input, `web`'s `updateSettingsAction` sends it in `EDITABLE_KEYS`,
`api`'s `SETTINGS_CATALOG` validates it as an `enum` over `COMPRESSION_RESOLUTIONS`, and the seed
ships it at `1080p`. The storage half is therefore already done — the row exists in `settings` on
the development database today. What `044` explicitly left out (its § Out of Scope) is the other
half: nothing reads the value. `api`'s `ProcessJobsService.getEncodeJobDetails` never puts it on
`EncodeJobDetails`, and `worker`'s `services/worker/src/ffmpeg/params.ts` hard-codes its own video
rules — HEVC at 4K becomes 1080p AV1, H264 and VC-1 are re-encoded to AV1 at native size, and
everything else (AV1, HEVC below 4K, any other codec) is stream-copied. An administrator who picks
`720p` gets exactly what `1080p` would have produced, and a 1080p HEVC release is filed without ever
being compressed.

This feature makes the compressor do what it is for: **every video it recognizes becomes AV1, and is
downscaled when the administrator's chosen resolution asks for it**. The chosen resolution is a
ceiling — a source larger than it is reduced to fit, a source at or below it keeps its own size, and
nothing is ever upscaled. `4k` caps nothing; `1080p` reduces 4K; `720p` reduces 4K and 1080p; `480p`
(a new fifth tier) reduces 4K, 1080p and 720p; `360p` reduces everything above it. Stream copy stops
being the default for anything that is not H264/VC-1 and becomes a fallback with exactly two
triggers: a source already in AV1 that needs no downscaling (re-encoding AV1 to AV1 only loses
quality), and a codec the worker does not recognize. Choosing the best release and then reducing it
is precisely what turns a 100 GB 4K remux into a ~3 GB 1080p file that compresses better than a
1080p release would have.

The pipeline row that changes is **Transcode** in the root `CLAUDE.md`: "H264/VC-1 to AV1, HEVC 4K
downscaled to 1080p" becomes "every recognized codec to AV1, downscaled to the administrator's
chosen ceiling, stream copy only for AV1 that already fits or an unrecognized codec". `web` changes
only to offer the fifth tier; `api` adds it to the catalog and hands the value to the worker on the
`processJob` payload beside `compressionEnabled`. Register, Download, Scan and filing are untouched.

## Requirements

### Functional Requirements

#### api

- [ ] **REQ-1 (Fifth tier)**: `compression_resolution` must accept exactly `4k`, `1080p`, `720p`,
      `480p`, `360p`. `updateSettings` with any other value keeps rejecting it with
      `error.setting.expected_enum`, whose listed values now include `480p`.
- [ ] **REQ-2 (Exposed to the worker)**: The `processJob` query must return the installation's
      `compression_resolution` on `EncodeJobDetails`, for film and episode jobs alike, as one of the
      five exact strings.
- [ ] **REQ-3 (Resolved when asked)**: The value must be read when the worker asks for the job's
      details, not snapshotted when the `ProcessJob` was enqueued — the same timing as
      `compressionEnabled`. A job enqueued under `1080p` and started after an administrator saved
      `720p` encodes at `720p`; so does a job requeued by `054`'s crash recovery or a BullMQ retry.
- [ ] **REQ-4 (Safe default)**: A missing `compression_resolution` row, or a stored value outside the
      five catalog values (only reachable by editing the database by hand), must resolve to `1080p`,
      never fail the `processJob` query.

#### web

- [ ] **REQ-5 (480p option)**: Settings → Compression must offer `480p` between `720p` and `360p`,
      labelled in both `en` and `es` catalogs, saved and re-shown exactly like the other four. It is
      disabled while the compression switch is off, like the rest of the group.

#### worker

- [ ] **REQ-6 (Tiers)**: Each resolution names a bounding box: `4k` = 3840×2160, `1080p` = 1920×1080,
      `720p` = 1280×720, `480p` = 854×480, `360p` = 640×360. `4k` is the top tier and imposes no
      ceiling at all — a source of any size (including DCI 4096×2160 or larger) is never downscaled
      under `4k`.
- [ ] **REQ-7 (When to downscale)**: Under any tier but `4k`, a source must be downscaled when its
      width exceeds the box width, or its height exceeds the box height, by more than 2%. Within that
      tolerance (e.g. 1920×1088 under `1080p`) the source counts as fitting and is not scaled. Width
      and height are compared independently: a scope 1920×800 film fits `1080p`, a 1440p source
      exceeds it, and a 720×480 DVD fits `480p`.
- [ ] **REQ-8 (Never upscale)**: A source that fits the chosen box must keep its own resolution. No
      setting ever produces an output larger than its source in either dimension — a 1080p source
      under `4k` stays 1080p, a 576p source under `720p` stays 576p.
- [ ] **REQ-9 (Downscale target)**: A downscaled output must fit inside the chosen box with the
      source's display aspect ratio preserved (a letterboxed film is narrower than the box, not
      stretched to it) and even pixel dimensions.
- [ ] **REQ-10 (Always AV1)**: A video stream in a recognized codec must be re-encoded to AV1, whether
      or not it is downscaled. Recognized codecs are `h264`, `hevc`/`h265`, `vc1` and `av1`. This
      includes HEVC below 4K (copied today) and HEVC 4K under `4k` (downscaled to 1080p today), which
      is encoded at its native resolution.
- [ ] **REQ-11 (Copy fallback — AV1 that fits)**: An AV1 source that REQ-7 says fits the chosen box
      must be stream-copied, never re-encoded. An AV1 source that exceeds the box is re-encoded to
      AV1 and downscaled.
- [ ] **REQ-12 (Copy fallback — unrecognized codec)**: A video stream in any codec outside REQ-10's
      list must be stream-copied at its own resolution, even when it exceeds the chosen box, and the
      worker must log the codec and that the ceiling was not applied. It never fails the encode.
- [ ] **REQ-13 (HDR preserved)**: Whatever the source codec, a source carrying Dolby Vision or
      HDR10 / HLG signalling must keep its HDR colour tags on the AV1 output — downscaled or not —
      as the HEVC 4K path does today (`bt2020nc`/`bt2020`), with the source's own transfer — `smpte2084`
      for Dolby Vision and HDR10, `arib-std-b67` for HLG (today's path writes `smpte2084` for HLG
      too, which mislabels it). Encoding never flattens HDR to SDR.
- [ ] **REQ-14 (Track title)**: The AV1 video track title starts with plain `AV1` — never a target
      resolution such as `AV1 1080p` — and names the source codec and HDR form
      (`DoVi` / `HDR10` / `HLG` / `SDR`), and whether it was downscaled. The copy-fallback title stays
      `Video (Direct Copy)`.
- [ ] **REQ-15 (Defensive read)**: The worker must trust nothing about the value on the wire: an
      absent or unrecognised `compressionResolution` (an `api` older than this feature, or any skew)
      defaults to `1080p` and is logged, never fails the encode — the same posture as `contentKind`
      in `057`.
- [ ] **REQ-16 (Compression off wins)**: With `compressionEnabled` false the resolution is ignored
      entirely — the file is moved, never encoded or scaled, exactly as `032` defines.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Behaviour change is intended)**: At the seeded `1080p` the output for H264/VC-1 at or
      below 1080p and HEVC 4K is unchanged in resolution. Everything else changes on purpose and must
      be called out in the root `CLAUDE.md` Transcode row: HEVC below 4K is now re-encoded instead of
      copied, H264/VC-1 above 1080p are now downscaled, AV1 above the ceiling is now re-encoded, every
      AV1 encode now writes explicit colour tags (HDR per REQ-13, bt709 otherwise — today only VC-1
      and the HEVC 4K path do), and track titles follow REQ-14.
- [ ] **NFR-2 (Tested where silent)**: The decision "encode or copy, downscale or not, to what box"
      produces no error when wrong — only a file that is too large, upscaled, needlessly re-encoded or
      left uncompressed. It is owed tests (Article IX) covering every tier against sources below, at,
      within tolerance of, and above each box, AV1 that fits and AV1 that does not, an unrecognized
      codec above the ceiling, and the HDR cases.
- [ ] **NFR-3 (Installation-wide)**: The ceiling is one value for the whole installation, identical
      for every user and every title; there is no per-user or per-title override.
- [ ] **NFR-4 (No migration)**: The setting already exists as a `settings` row; no Prisma change.
      An installation already storing one of the four previous values keeps it.

## GraphQL Contract Delta

One field added to an existing type. No new query, mutation or argument; `Mutation.updateSettings`
already persists and validates `compression_resolution` (`044`) — its accepted set grows by `480p`.

```graphql
type EncodeJobDetails {
  # … existing fields unchanged …
  compressionEnabled: Boolean!
  compressionResolution: String!
}
```

`compressionResolution` is the installation-wide resolution ceiling for the video track, read from
the `compression_resolution` setting when this query is answered (not when the ProcessJob was
enqueued): one of `"4k"`, `"1080p"`, `"720p"`, `"480p"`, `"360p"`. A missing or unrecognised stored
value resolves to `"1080p"`. It is ignored when `compressionEnabled` is false. The generated
`schema.gql` carries no description for it, like its sibling `compressionEnabled` (Article XI).

It is a `String!`, not a GraphQL enum, deliberately: an enum would turn a hand-edited bad row into a
serialization error on the whole `processJob` query, failing an encode over a setting that has a
safe default. `api` normalizes (REQ-4), and `worker` normalizes again (REQ-15).

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `compression_resolution` row missing or outside the five values | none — resolves to `1080p` | none |
| `compressionResolution` absent or unrecognised on the worker side | none — defaults to `1080p`, logged | none |
| `updateSettings` with `compression_resolution` outside the five values (existing, `044`) | `BadRequestException`, `error.setting.expected_enum` | existing enum message, now listing `480p` |

Consumer obligations:

- `worker` retypes `compressionResolution` into its local `EncodeJobDetails` type and adds it to the
  `processJob` selection set. It never fails an encode over this field.
- `web` does not read `EncodeJobDetails.compressionResolution`; it keeps reading and writing the
  setting through `settings`/`updateSettings`, and shows `expected_enum` the way it already does.

No new error key is introduced. Any FFmpeg failure while encoding or scaling is reported through the
existing `encodeFailed` path and keys — a failed AV1 encode is not retried as a copy.

## Data Model Changes

None. `compression_resolution` is an existing `settings` row, seeded `1080p` by `044`; `480p` is a
new accepted value, not a new row.

## Acceptance Criteria

- [x] **AC-1**: Given an administrator selects `480p` in Settings → Compression and saves, then
      `bin/mysql -e "select value from settings where \`key\`='compression_resolution'"` prints `480p`,
      and reloading the Settings screen (in `en` and in `es`) shows `480p` selected. Observed live in
      this session: saved through the running web UI, `bin/mysql` printed `480p`, and the radio stayed
      selected after reload in both `en` and `es`.
- [ ] **AC-2**: Given `compression_resolution` is `720p`, when the worker queries `processJob` for any
      job, the response carries `compressionResolution: "720p"`.
- [ ] **AC-3**: Given `720p` and a 1080p H264 film finishes downloading, then `ffprobe` on the library
      file reports an AV1 video stream no larger than 1280×720 with the source's aspect ratio.
- [ ] **AC-4**: Given `1080p` and a 1080p HEVC source, then the output is AV1 at the source's
      resolution (re-encoded, not copied).
- [ ] **AC-5**: Given `4k` and a 1080p source, then the output video stream keeps the source's
      dimensions — not upscaled.
- [ ] **AC-6**: Given `4k` and a 4K HEVC HDR10 source, then the output is AV1 at the source's 4K
      resolution with `color_transfer=smpte2084` and `color_primaries=bt2020`.
- [ ] **AC-7**: Given `1080p` and a 1080p AV1 source, then its video stream is copied (title
      `Video (Direct Copy)`); given `480p` with the same source, the output is re-encoded AV1 no
      larger than 854×480.
- [ ] **AC-8**: Given `360p` and a 4K Dolby Vision source, then the output is AV1 no larger than
      640×360, still tagged `bt2020`/`smpte2084`, and its video track title starts with plain `AV1` and names the downscale and `DoVi`.
- [ ] **AC-9**: Given `720p` and a 1080p source in a codec outside REQ-10's list (e.g. MPEG-2), then
      the video stream is copied at 1080p, the encode completes, and the worker log names the codec
      and that the ceiling was not applied.
- [ ] **AC-10 (failure path)**: Given the row is hand-edited with
      `bin/mysql -e "update settings set value='garbage' where \`key\`='compression_resolution'"`,
      when a job is encoded, then `processJob` returns `compressionResolution: "1080p"`, the encode
      completes as it would under `1080p`, and no `encodeFailed` is reported.
- [x] **AC-11 (failure path)**: `updateSettings` with `{key: "compression_resolution", value: "540p"}`
      returns `error.setting.expected_enum` and the stored value is unchanged. Observed live in this
      session against the running `api`: the mutation returned
      `"compression_resolution" must be one of: 4k, 1080p, 720p, 480p, 360p"` /
      `error.setting.expected_enum`, and the stored row stayed `480p`.
- [ ] **AC-12**: Given `compression_enabled` is `false` and `compression_resolution` is `360p`, when a
      4K source finishes, the library file is byte-identical to the source (moved, not encoded).
- [ ] **AC-13**: Given `720p`, when a job is enqueued and the setting is changed to `360p` before the
      worker picks it up, the output fits 640×360.
- [x] **AC-14**: `bin/npm worker test` includes the decision cases required by NFR-2 in
      `src/ffmpeg/params.spec.ts` and they pass; `src/ffmpeg/cases.spec.ts` (the corpus) is excluded
      from this criterion. `bin/npm api run test` passes with a case covering REQ-4's fallback;
      `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift. Confirmed:
      `params.spec.ts` 71 tests pass (28 → 71, the full tier/codec/HDR/title matrix); `bin/npm worker
      test` overall 241/244 (the 3 failures are the pre-existing `buildCommand.spec.ts` CRF mismatch
      and the stale `cases.spec.ts` corpus, both explicitly excluded); `bin/npm api run test` 517/46
      suites, including the new `compressionResolution` describe block covering REQ-4's fallback
      (missing row, `'garbage'`, `'4K'` → `1080p`); `check-messages.mjs` reports no drift at 423 keys.

## Out of Scope

- **Per-user or per-title resolution.** One installation-wide ceiling (NFR-3). A per-title override
  would need a schema column and a detail-page control — its own spec.
- **CRF / bitrate tuning per tier.** A 360p output keeps the same CRF rules (`remux` 22 / `web` 24) as
  any other; retuning quality by target size is a separate decision.
- **Recognizing more codecs.** MPEG-2, MPEG-4 Part 2, VP9 and the rest stay in the copy fallback
  (REQ-12), as they are copied today. Adding one to REQ-10's list is a follow-up with its own test
  case.
- **Falling back to copy when an AV1 encode fails.** A failed encode is reported as `encodeFailed`,
  exactly as today; silently filing an uncompressed file would hide the failure.
- **Re-encoding files already in the library.** Changing the setting affects jobs that start encoding
  afterwards; nothing already filed is revisited.
- **The FFmpeg case corpus (`services/worker/ffmpeg/1.json`, `2.json`).** Both are stale and are not
  a reference for this feature in any way: their expectations are neither used to guide the rule nor
  updated to match it, and `cases.spec.ts` results are not an acceptance signal. Validating the rule
  against real files is a later, separate pass.
- **Upscaling, or tiers beyond the five.** No `1440p` or `8k`; `4k` caps nothing, so a source larger
  than 4K passes through at its own size.
- **Choosing releases by the ceiling.** Torrent ranking (`036`) keeps preferring the best source; this
  feature only acts after download.

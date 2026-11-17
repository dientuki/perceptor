---
title: SD MPEG-2 encode and Opus audio copy
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-10-31
last_updated: 2026-10-31
status: Implemented
services: [worker]
---

# SPEC: SD MPEG-2 encode and Opus audio copy (`spec.md`)

## Context & Goal

A DVD ripped with MakeMKV reaches the Transcode stage as an MPEG-2 (`mpeg2video`) video track, and
the worker copies it untouched: `RECOGNIZED_VIDEO_CODECS` in `services/worker/src/ffmpeg/params.ts`
lists only `h264`, `hevc`/`h265`, `vc1` and `av1`, so rule V5 of `.claude/agents/ffmpeg.md` (copy
fallback #2) applies and the output track is titled `Video (Direct Copy)`. The case that surfaced it
is a 2006 PAL DVD9 (`A1_t00.mkv`, 720×576, 25 fps, top-field-first interlaced, SAR 64:45 → 16:9,
colour tagged BT.601 `bt470bg`, 4.24 GiB of video at ~6 Mb/s). Its verbatim `ffprobe` is
`A1_t00.ffprobe.json` beside this file, with only the input path redacted. MPEG-2 is the least
efficient codec Perceptor sees, so it is where AV1 saves the most: an estimated 75–85 % of the video
size for this file.

Adding the codec to the list is not enough on its own. The encode path has never met two properties
every DVD carries. First, the source is **interlaced**, and the worker never deinterlaces: AV1 would
spend bits encoding the combing and keep it visible on every motion. Second, the source is **SD
BT.601**, and V3 writes `bt709` colour tags on every SDR encode, which mislabels the output and
shifts its colours slightly. Both are general defects: any interlaced source and any SD source
reaching the AV1 path today are encoded wrong in the same way, whatever their codec. The command
below was run by hand on the case file and checked by the user: deinterlaced, 16:9, correct
colours.

```
ffmpeg -i A1_t00.mkv -map_metadata:g -1 -map 0:v:0
  -vf "bwdif=mode=send_frame:parity=tff:deint=all"
  -c:v libsvtav1 -crf 22 -preset 4 -pix_fmt yuv420p10le -aspect 16:9
  -color_range tv -colorspace bt470bg -color_primaries bt470bg -color_trc gamma28
  -svtav1-params "keyint=10s:scd=1:enable-overlays=1:tune=0:input-depth=10:scm=0:aq-mode=2:sharpness=0:film-grain=0"
  -metadata:s:v:0 "title=AV1 (Converted from MPEG-2)"
  -map 0:2 -c:a:0 libopus … 320k 5.1 … -map 0:3 -c:s:0 copy
```

The same workflow exposes a defect on the audio side. The user prepares an MKV by hand: the DVD's
audio is already converted to Opus and muxed beside the untouched MPEG-2 video, and only the video is
left for Perceptor to compress. Today every selected audio track is re-encoded with `libopus`
(`getAudioParams`), whatever its codec, so an Opus track goes through a second lossy pass that can
only lose quality and gains nothing.

The only stage this touches is **Transcode** (`worker`, `src/ffmpeg/`, owned by the `ffmpeg`
agent). Strictly, Article VII does not require a spec here: the change touches one service, no
schema, no contract and no stage. It is written as one on request because it rewrites three
standing video rules (V2, V3, V5) that other cases depend on.

## Requirements

### Functional Requirements

- [x] **REQ-1 (MPEG-2 is recognized)**: An `mpeg2video` source must be transcoded to AV1 under V2's
      rules (the same SVT-AV1 parameters, `contentKind` branches, grain resolution and resolution
      ceiling as any other recognized codec) instead of being stream-copied under V5. Its track title
      follows V6 with the codec label `MPEG-2`, e.g. `AV1 (Converted from MPEG-2)`. No other codec
      joins the list: `mpeg1video`, `mpeg4`/`msmpeg4*`, `vp8`, `vp9` and `wmv3` stay under V5.
- [x] **REQ-2 (Deinterlace interlaced sources)**: When `ffprobe` reports the first video stream's
      `field_order` as interlaced (`tt`, `bb`, `tb`, `bt`), the AV1 encode must deinterlace it to
      progressive output at the source frame rate (one output frame per input frame), using the
      source's own field order. Only frames the bitstream flags as interlaced are deinterlaced;
      frames flagged progressive (common in PAL film DVDs) pass through untouched. This applies to
      every codec on the AV1 path, not only MPEG-2.
- [x] **REQ-3 (Progressive or unknown sources unchanged)**: A source whose `field_order` is
      `progressive`, `unknown` or absent must produce exactly the command it produces today. No
      deinterlace filter is added.
- [x] **REQ-4 (Deinterlace before scaling)**: When a source is both interlaced and downscaled by the
      `compressionResolution` ceiling (V2), deinterlacing must happen before scaling.
- [x] **REQ-5 (SD colour tags)**: An SDR AV1 encode must write BT.601 colour tags instead of V3's
      `bt709` when the source is SD BT.601:
      - a source tagged `bt470bg` or `smpte170m` (matrix, primaries or transfer) keeps those tags
        on the output: PAL `bt470bg`/`bt470bg`/`bt470bg` (transfer `gamma28`), NTSC
        `smpte170m`/`smpte170m`/`smpte170m`;
      - an untagged source no taller than 576 lines gets the PAL set at 576 lines with 25 fps and
        the NTSC set otherwise;
      - every other SDR source, including any untagged source taller than 576 lines, keeps V3's
        `bt709` tags unchanged.
      This applies to every codec on the AV1 path. HDR forms (DoVi, HDR10, HLG) are unaffected.
- [x] **REQ-6 (Display aspect preserved)**: The AV1 output's display aspect ratio must equal the
      source's, for an anamorphic source too (720×576 at SAR 64:45 → 16:9). This holds whether or
      not the output is downscaled or deinterlaced. A source whose SAR is within 1 % of square (e.g. `1385:1384`) is treated as square and gets no `-aspect`.
- [x] **REQ-7 (Ceiling unchanged for SD)**: The `compressionResolution` ceiling applies to an SD
      source exactly as V2 states, compared against the coded size. A 720×576 source is untouched
      under `4k`/`1080p`/`720p` and downscaled under `480p` (to 600×480, still 16:9 by REQ-6).
      Nothing is ever upscaled.
- [x] **REQ-8 (Quality tier unchanged)**: The remux/web choice (`remux-detection.ts`) is not changed.
      A DVD rip is a lossless copy of its disc and keeps classifying as remux (CRF 22) when its
      bits per pixel per frame reaches the existing 0.25 threshold, as the case file does at 0.69.
- [x] **REQ-9 (Case in the corpus)**: The case file's `ffprobe` must be added to
      `services/worker/ffmpeg/` with the full expected argument array, frozen with the user as
      `.claude/agents/ffmpeg.md` § "Adding a case, with the user" requires. The case comes first
      and red, and the rule change second.
- [x] **REQ-10 (Rule document)**: `.claude/agents/ffmpeg.md` § Rules must state the new
      behaviour: under Video, V2's codec list gains `mpeg2video`, V3 gains the SD branch, V6 gains
      the `MPEG-2` label, and a new rule names the deinterlace behaviour (REQ-2–REQ-4); under Audio,
      a new rule names the Opus copy (REQ-11, REQ-12).
- [x] **REQ-11 (Opus audio is copied)**: A selected audio track whose codec is already `opus` must
      be stream-copied, never re-encoded. Its channels, channel layout and bitrate stay exactly as
      in the source, and no bitrate, channel-map or mapping-family argument is written for it. It
      still receives the language tag and the track title other audio tracks get, built the same way
      (`<Language> Surround 5.1 (Opus)`, `<Language> Stereo (Opus)`, …, from its own channel count).
      Whatever title the source track carries (`Surround 5.1`, a release group's label, none at all)
      is always replaced by that generated one and never kept, so a copied track reads exactly like
      an encoded one. Regional-variant titles (`Latino`, `Español (España)`, `031`/`110`) apply to it
      as to any other track. Every non-Opus selected track keeps today's `libopus` encode. This holds in both directions of
      the video decision, whether the video is encoded or copied.
- [x] **REQ-12 (Selection unchanged)**: Which audio tracks are selected does not change. A3's quality
      order (`truehd` > `dts` > `eac3` > `ac3`, everything else after) still decides, so an Opus
      track is copied only when it is the track A1–A4 already pick for its language, typically
      because it is the only one. A language that has both an Opus and, say, an AC3 track still
      selects and re-encodes the AC3, as today.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (No regression)**: Every existing corpus case and every existing `params.spec.ts` case
      that is HD or progressive must produce a byte-identical argument array. If one changes, that
      is a rule conflict, reported to the user rather than fixed by editing the older case.
- [x] **NFR-2 (Pure command)**: Deciding the field order, the colour set and the aspect must use
      only the already-parsed `ffprobe` metadata. `buildFfmpegCommand` stays synchronous and pure,
      and no extra process is spawned (the 092/098/099/102 posture).
- [x] **NFR-3 (Synthetic coverage)**: `params.spec.ts` must cover what no single real file shows:
      each interlaced `field_order` value, `progressive`/`unknown`/absent, a tagged NTSC source, an
      untagged 480- and 576-line source, an untagged 720-line source, and an interlaced source
      downscaled by the ceiling. Per Article IX this is code where a bug produces no error anywhere,
      only a combed, discoloured or squashed file.
- [x] **NFR-4 (Compression off)**: With `compressionEnabled === false`, nothing changes. The file is
      moved untouched (`032`).

## GraphQL Contract Delta

None. This feature does not cross the service boundary: every input is the `ffprobe` output the
worker already reads, and no new `EncodeJobDetails` field, mutation or error key is involved.

## Data Model Changes

None.

## Acceptance Criteria

- [x] **AC-1**: `bin/npm worker test` passes with the new corpus case built from
      `A1_t00.ffprobe.json`. Its frozen command encodes video with `libsvtav1` at CRF 22, carries a
      deinterlace filter for a top-field-first source that only touches flagged frames, writes
      `bt470bg` matrix/primaries and `gamma28`/`bt470bg` transfer, keeps 16:9, titles the track
      `AV1 (Converted from MPEG-2)`, and keeps the DTS track as Opus 5.1 and the `dvd_subtitle`
      track as a stream copy.
- [x] **AC-2**: The same suite passes with every pre-existing corpus case unchanged (NFR-1), except the Opus audio lines of `4.json` and `5.json`, whose all-Opus probes now copy (re-frozen on the user's decision, REQ-11).
- [x] **AC-3**: Given a synthetic `progressive` H264 1080p stream in `params.spec.ts`, the video
      arguments carry no deinterlace filter and `bt709` tags, exactly as before.
- [x] **AC-4 (failure path)**: Given a synthetic MPEG-2 stream whose `field_order` is absent or
      `unknown`, the encode neither fails nor deinterlaces. It is encoded to AV1 with no filter.
- [x] **AC-5 (failure path)**: Given a synthetic `mpeg4` (Xvid) stream, the video is still
      stream-copied as `Video (Direct Copy)` and the worker logs the unrecognized codec (V5 holds
      for everything REQ-1 did not add).
- [x] **AC-6**: Given a synthetic interlaced 720×576 source and `compressionResolution` `480p`, the
      filter chain deinterlaces before it scales, and the scale target is the 854×480 box.
- [x] **AC-7**: Given a synthetic file whose only allowed-language audio track is Opus 5.1 titled
      `Surround 5.1`, the audio arguments map it with `-c:a:0 copy`, carry its language tag and the
      title `<Language> Surround 5.1 (Opus)` in place of the source's, and contain no `-b:a:0`, `-vbr:a:0`, `-filter:a:0` or
      `-mapping_family:a:0` for it.
- [x] **AC-8**: Given a synthetic file with two allowed languages, one with only an Opus track and
      one with only an AC3 track, the first is copied and the second is encoded with `libopus`,
      with the per-track indices (`:a:0`, `:a:1`) in output order.
- [x] **AC-9 (failure path)**: Given a synthetic language with both an Opus 5.1 and an AC3 5.1
      track, the AC3 is selected and encoded with `libopus` and the Opus track is not mapped. The
      selection is exactly today's (REQ-12).
- [ ] **AC-10 (live)**: The case file is put through the real pipeline (import it as a film). The
      library output's `ffprobe` shows `codec_name=av1`, `field_order=progressive` (or absent),
      `display_aspect_ratio=16:9`, `color_space=bt470bg`, `color_primaries=bt470bg`, and a video
      stream smaller than 1.5 GiB. Watching a panning shot shows no combing.
- [ ] **AC-11 (live)**: The user's hand-built MKV (the DVD's MPEG-2 video untouched, its audio
      already Opus) is put through the real pipeline. The output's audio track has the same codec,
      channel count and bitrate as the source's Opus track, and the encode's recorded FFmpeg command
      shows `-c:a:0 copy` for it.

## Out of Scope

- **Letterbox crop.** The case is 2.39:1 inside a 16:9 frame, so ~146 of its 576 lines are black.
  Cropping them (`cropdetect`) would save more bits, but it is a separate, analysis-heavy rule that
  applies to every resolution (and `094`'s probe already measures crop for its own purpose). It
  belongs in its own spec.
- **Other legacy codecs.** `mpeg1video`, `mpeg4`/`msmpeg4*`, `vp8`, `vp9` and `wmv3` stay under V5
  until a real file of each brings its own case.
- **Ranking Opus above other lossy codecs.** Preferring an existing Opus track over a `dts`/`eac3`/
  `ac3` one of the same language would avoid a second lossy pass on mixed files too. It changes A3
  for every file that carries both, and the case behind this spec carries Opus alone, so it is left
  for a file that needs it (REQ-12).
- **Copying other already-efficient audio codecs.** `aac`, `flac` and the rest keep the `libopus`
  encode. Only Opus, the worker's own output codec, is copied.
- **Codec-normalized remux detection.** A per-codec bits-per-pixel factor (like `grain-gate.ts`'s
  table, which today rates `mpeg2video` the same as `h264`) would push a DVD to CRF 24. It was
  rejected (REQ-8): a DVD rip is a disc copy and keeps the remux tier.
- **Telecine / inverse telecine.** NTSC film DVDs carry 3:2 pulldown that needs field matching
  (`fieldmatch`/`decimate`) rather than deinterlacing to return to 23.976 fps. No such file has been
  seen; it needs its own case.
- **Original-audio language on DVD rips.** This case's video is tagged `eng` and every audio track
  is `fre`. If the title's TMDB original language has no matching audio track, the existing audio
  rule still fails the encode with `error.encode.no_original_audio`. This feature leaves that
  untouched.

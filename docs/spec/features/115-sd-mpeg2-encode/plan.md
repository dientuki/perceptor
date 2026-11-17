---
title: SD MPEG-2 encode and Opus audio copy — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-10-31
status: Implemented
---

# PLAN: SD MPEG-2 encode and Opus audio copy (`plan.md`)

## Approach

The whole feature is a change to the pure argument builders in
`services/worker/src/ffmpeg/params.ts`, the territory of the `ffmpeg` agent
(`.claude/agents/ffmpeg.md`). Every decision is read off the `ffprobe` stream objects
`buildFfmpegCommand` already passes in (`field_order`, `sample_aspect_ratio`,
`display_aspect_ratio`, `color_space`/`color_primaries`/`color_transfer`, `height`,
`avg_frame_rate`, the audio `codec_name`). Nothing is spawned, `buildFfmpegCommand` keeps its
signature, and the encode driver (`src/encode/encode.ffmpeg.ts`), the job handler and the contract
are not touched (NFR-2).

**Video.** `getVideoParams` already decides only the *differences* (`vf`, `colorTags`, `title`) and
delegates the shared SVT-AV1 block to `buildAv1EncodeArgs`. This feature adds three more differences
through that same seam rather than adding a branch beside it:

- the filter chain becomes an ordered list: a deinterlace step (only for an interlaced
  `field_order`) **then** the existing scale step (REQ-4), joined by `,`. With neither, no `-vf`,
  exactly as today (REQ-3).
- `colorTagsFor` gains an SD BT.601 outcome selected by a named predicate on the stream, ahead of
  the existing `bt709` SDR default. HDR forms keep precedence and are unchanged.
- an `-aspect` is emitted only for an anamorphic source (REQ-6).

`mpeg2video` joins `RECOGNIZED_VIDEO_CODECS` and `codecLabel` (REQ-1).

**Audio.** In `getAudioParams`'s per-track loop the title and language arguments are separated from
the encode arguments, so a selected `opus` track gets `-c:a:N copy` plus the same title and language
lines and no encode arguments (REQ-11). `selectAudioStreams` and its A3 ranking are not touched
(REQ-12).

Alternatives considered and rejected:

- **`bwdif` `parity=auto`** (read the field order from each decoded frame) instead of an explicit
  parity from `field_order`. It is arguably more robust, but it makes the frozen corpus command say
  nothing about which order the worker believed, and the user's validated command was explicit.
  The plan maps `field_order` by **display** order: `tt` and `bt` → `tff`, `bb` and `tb` → `bff`
  (ffprobe's `tb` is "top coded first, bottom displayed first").
- **Always writing `-aspect`** from `display_aspect_ratio`. That would add an argument to every
  existing command and break NFR-1. ffmpeg's `scale` filter already preserves the display aspect
  when it resizes, so `-aspect` is a belt-and-braces line written only where a mistake would show:
  an anamorphic source (`sample_aspect_ratio` present and more than 1 % away from square, so `1:1`, `0:1` and roundings such as `1385:1384` write nothing), with the source's own
  `display_aspect_ratio` as the value.
- **Mirroring each colour tag field by field.** REQ-5 is implemented as a classification into one of
  two complete sets (PAL or NTSC), so a half-tagged source never produces a mixed output. Primaries
  decide first, then the matrix, then the transfer. `bt470bg` means PAL and `smpte170m` means NTSC.
  The PAL transfer is written `gamma28` (ffprobe prints the same value as `bt470bg`), as in the
  validated command.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `worker` | The only service touched. Inside it: corpus case first (red), then the video rules, then the audio rule, then the rule document. |

There is no parallel work. The `ffmpeg` agent's own rule applies: a refactor and a rule change are
never one step. Run the corpus green, refactor `getAudioParams`'s loop, confirm it is still green,
and only then change a rule.

## Contract Freeze

`spec.md`'s GraphQL Contract Delta is **None**, and it stays that way as of `status: Approved`. An
implementer will be tempted by:

- **Adding a `deinterlace`/`colorMatrix` field to `EncodeJobDetails`.** No. Everything is derived
  from `ffprobe`; there is no setting and no per-title override in this feature.
- **"Fixing" `remux-detection.ts` so a DVD reads as `web`.** No. REQ-8 deliberately keeps CRF 22.
- **Moving Opus up the A3 ranking.** No. REQ-12 keeps the selection as it is (see Out of Scope).
- **Editing an older corpus case so the suite goes green.** Never. A changed older case is a rule
  conflict, reported to the user (NFR-1).

## Migrations

None.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Wrong field parity | No error anywhere. The output judders back and forth on motion. | Explicit mapping covered by one `params.spec.ts` case per `field_order` value, plus the live panning-shot check (AC-10). |
| A progressive source deinterlaced | Slight softening of every frame, no error. | Only `tt`/`bb`/`tb`/`bt` trigger it, `deint=interlaced` touches only flagged frames, and AC-3/AC-4 pin `progressive`/`unknown`/absent to today's command. |
| Anamorphic output squashed to 5:4 | No error. A 720×576 film plays stretched vertically. | `-aspect` from the source DAR, checked live with `display_aspect_ratio=16:9` (AC-10). |
| An HD source picking up BT.601 tags | Slightly wrong colours on every HD encode, no error. | The SD branch requires BT.601 tags or an untagged source of ≤ 576 lines; NFR-1 keeps every existing case byte-identical. |
| Opus copy breaks the per-track index | An `-metadata:s:a:N` landing on the wrong track gives a wrong title or language, no error. | AC-8 mixes a copied and an encoded track and asserts the indices. |
| `094`'s grain probe on interlaced MPEG-2 | The probe encodes windows without deinterlacing, so combing may inflate the measured grain saving and switch synthesis on. Unwanted grain, no error. | Accepted for now: only reached under `AUTO`. Recorded as a follow-up in `worker/plan.md`, not fixed here. |
| The existing test that uses `mpeg2video` as its "unrecognized" example | It goes red the moment REQ-1 lands. | Expected: rewrite it with `mpeg4`, which AC-5 needs anyway. This is the one existing test this feature is entitled to edit. |

## Verification

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments worker
```

`bin/npm worker test` must show the new corpus case passing and every older case unchanged
(AC-1, AC-2), plus the new synthetic cases in `params.spec.ts` (AC-3 to AC-9). If the host's
running stack is another install, run the suite from a throwaway node container as uid 1000
instead.

Manual pass (AC-10, AC-11):

1. Import `A1_t00.mkv` as a film. Once it is `COMPLETED`, run
   `ffprobe -v error -show_streams -of compact <library file>` and check for `codec_name=av1`, no
   interlaced `field_order`, `display_aspect_ratio=16:9`, `color_space=bt470bg` and
   `color_primaries=bt470bg`. The video stream should be under 1.5 GiB. Watch a panning shot.
2. Import the hand-built MKV (MPEG-2 video, Opus audio). The recorded FFmpeg command
   (`bin/mysql -e 'select ffmpegCommand from process_jobs order by id desc limit 1'`, adjusting the
   table name to the schema's mapping) shows `-c:a:0 copy`. `ffprobe` on the output shows the
   same Opus codec, channels and bitrate as the source, under the generated title.

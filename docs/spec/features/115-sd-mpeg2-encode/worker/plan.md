---
title: SD MPEG-2 encode and Opus audio copy — worker slice
service: worker
last_updated: 2026-10-31
status: Implemented
---

# PLAN: SD MPEG-2 encode and Opus audio copy — `worker` (`worker/plan.md`)

## Scope

This slice changes which FFmpeg arguments the worker builds for a source's video and audio. On the
video side, MPEG-2 is encoded to AV1, an interlaced source is deinterlaced, an SD BT.601 source
keeps BT.601 colour tags, and an anamorphic source keeps its display aspect. On the audio side, a
selected Opus track is copied rather than re-encoded. All of it lives in `src/ffmpeg/`, owned by the
**`ffmpeg` agent** (`.claude/agents/ffmpeg.md`). Read that file first: its Governance and "Adding a
case, with the user" sections bind this slice.

What this slice does **not** do: touch `api`, `web`, `EncodeJobDetails`, `EncodeInput`, the encode
driver (`src/encode/`), `remux-detection.ts` (REQ-8), `selectAudioStreams`'s ranking (REQ-12) or
the grain gate and probe. Writes are confined to `services/worker/` and this directory, plus the
rule document `.claude/agents/ffmpeg.md` (REQ-10), which the `ffmpeg` agent owns.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/ffmpeg/6.json` | New | The real case from `../A1_t00.ffprobe.json`, with the expected argv frozen with the user |
| `services/worker/src/ffmpeg/params.ts` | Modified | Codec list and label, deinterlace step, SD colour set, anamorphic `-aspect`, Opus copy |
| `services/worker/src/ffmpeg/params.spec.ts` | Modified | Synthetic cases for AC-3–AC-9; the existing "unrecognized codec" case moves from `mpeg2video` to `mpeg4` |
| `.claude/agents/ffmpeg.md` | Modified | V2, V3, V5 and V6 amended; a new video rule for deinterlacing and the aspect; a new audio rule for the Opus copy |

## Existing code to reuse

- `src/ffmpeg/params.ts` → `buildAv1EncodeArgs(contentKind, quality, { vf, colorTags, title }, filmGrain)`
  is the single place the SVT-AV1 block is written. Feed it the composed `vf` and the chosen colour
  tags. Do **not** add a second encode block.
- `getVideoParams`'s `exceeds`/`box` scale string stays the scale step. The deinterlace step is
  prepended to it, never written in a separate `-vf` (two `-vf` flags: the last one wins silently).
- `hdrFormOf` / `colorTagsFor` stay the HDR decision. The SD BT.601 choice sits inside the `SDR`
  outcome, as a named predicate (`bt601ColorSet(videoStream)` returning `'PAL' | 'NTSC' | null` or
  similar). A `null` keeps `SDR_BT709_COLOR_TAGS`.
- `src/ffmpeg/remux-detection.ts` → `parseFrameRate` for the 25 fps test in the untagged-SD
  branch. ffprobe gives `avg_frame_rate` as a rational string, and that module explains why a
  `Number()` parse is wrong.
- `getAudioParams`'s channel branches (≥ 8 → 7.1, ≥ 6 → 5.1, else stereo) already produce the title
  suffix. Split each branch into "title" (shared) and "encode args" (`libopus` only), so the Opus
  copy reuses the exact titles.
- `trackLanguageTitle(s, trackTitles, detect)` is already the title source for variants
  (`Latino`, `Español (España)`), and the copied track goes through it unchanged.
- `src/ffmpeg/cases.spec.ts` needs no edit. Adding `6.json` is the whole change to the runner. Its
  input defaults `allowedSubtitleFormats` to text only, so the case must declare the formats it
  needs (below).

## Steps

1. **Case first, red.** Build `services/worker/ffmpeg/6.json` from `../A1_t00.ffprobe.json`
   (verbatim, path already redacted). Proposed input, **to confirm with the user before freezing**:
   `allowedAudioLanguagesIso3: ["fre"]`, `allowedSubtitleLanguagesIso3: ["fre"]`,
   `originalLanguageIso3: "fre"`, `contentKind: "LIVE_ACTION"`, `compressionResolution: "1080p"`,
   `allowedSubtitleFormats` including `vobsub` (otherwise S-rules drop the `dvd_subtitle`, and AC-1
   expects it copied). Expected video arguments, in this order:
   `-map 0:v:0 -vf bwdif=mode=send_frame:parity=tff:deint=interlaced -c:v libsvtav1 -crf 22 -preset 4 -pix_fmt yuv420p10le -aspect 16:9 -color_range tv -colorspace bt470bg -color_primaries bt470bg -color_trc gamma28 -svtav1-params keyint=10s:scd=1:enable-overlays=1:tune=0:input-depth=10:scm=0:aq-mode=2:sharpness=0:film-grain=0 -metadata:s:v:0 title=AV1 (Converted from MPEG-2)`.
   The exact position of `-aspect` within the block is the implementer's call; freeze whatever
   position the code produces, after showing the user. Audio: stream 2 (DTS 5.1) → Opus 5.1 at
   320k, `title=Français Surround 5.1 (Opus)`. Subtitle: stream 3 copied. Run the suite and confirm
   the case is red for the expected reason (video copied).
2. **Video: recognition.** Add `mpeg2video` to `RECOGNIZED_VIDEO_CODECS` and `'MPEG-2'` to
   `codecLabel`. Move the existing "copies an unrecognized codec…" test to `mpeg4`.
3. **Video: deinterlace.** A named predicate maps `field_order` to a parity: `tt`, `bt` → `tff`;
   `bb`, `tb` → `bff`; anything else (`progressive`, `unknown`, absent) → none. The filter is
   `bwdif=mode=send_frame:parity=<p>:deint=interlaced`. Compose `vf` as
   `[deinterlace, scale].filter(Boolean).join(',')`. The deinterlace step must come first (REQ-4).
4. **Video: SD colour.** Inside the `SDR` outcome: primaries, then matrix, then transfer, decide
   PAL (`bt470bg`) or NTSC (`smpte170m`) when tagged. When all three are absent or `unknown`/
   `unspecified` and `height ≤ 576`: PAL if `height === 576` and the frame rate is 25, else NTSC.
   Otherwise `null`, so `bt709` is kept. Tag sets:
   PAL `-color_range tv -colorspace bt470bg -color_primaries bt470bg -color_trc gamma28`;
   NTSC `-color_range tv -colorspace smpte170m -color_primaries smpte170m -color_trc smpte170m`.
   A source explicitly tagged `bt709` stays `bt709` at any height.
5. **Video: aspect.** When `sample_aspect_ratio` is present and is not square (not `0:1`, and |SAR − 1| ≥ 1 %: `1:1` and roundings like `1385:1384` count as square), and
   `display_aspect_ratio` is present, add `-aspect <display_aspect_ratio>` to the encode block.
   Never add it on the copy path, and never for a square-pixel source (NFR-1).
6. Run the suite. `6.json` should be green and every older case unchanged. If an older case
   changed, **stop and report** the rule conflict.
7. **Audio: refactor, no behaviour change.** Split `getAudioParams`'s per-track body into title and
   language arguments plus encode arguments. Run the suite: it must still be green, untouched.
8. **Audio: Opus copy.** For a selected stream whose `codec_name` is `opus`, emit
   `-map 0:<index>`, `-c:a:<n> copy`, the title and the language, and no `-vbr`, `-b`, `-filter`
   or `-mapping_family` for it.
9. **Synthetic tests** in `params.spec.ts` (see Tests).
10. **Rule document.** Amend `.claude/agents/ffmpeg.md`:
    - V2: add `mpeg2video` to the codec list.
    - V3: add the SD BT.601 branch.
    - V5: the copy-fallback example is no longer MPEG-2.
    - V6: add the `MPEG-2` codec label.
    - New V7: deinterlacing (parity mapping, flagged frames only, before scaling) and the anamorphic
      `-aspect`.
    - New A7: Opus copy, with its title regenerated.
    - Name `6.json` as the case that forced these.

## Contract obligations

None. `../spec.md` § GraphQL Contract Delta is "None", and this slice consumes no new field.
Every input is already on the stream objects `buildFfmpegCommand` receives.

## Tests

Article IX applies to all of it: every rule here fails silently, with FFmpeg exiting 0 and a
combed, squashed, discoloured or double-compressed file in the library.

- `services/worker/ffmpeg/6.json` (via `cases.spec.ts`) defends the whole ordered command for a
  real DVD rip (AC-1). Every older case running unchanged is AC-2.
- `src/ffmpeg/params.spec.ts`, `getVideoParams` block:
  - one case per `field_order` (`tt`, `bb`, `tb`, `bt`) asserting the parity.
  - `progressive`, `unknown` and absent produce no `-vf` (AC-3, AC-4).
  - an interlaced 720×576 source under `480p` gives `bwdif…,scale=854:480:…` in that order (AC-6).
  - colour: tagged NTSC 480, untagged 576 at 25 fps (PAL), untagged 480 at 29.97 (NTSC), untagged
    720 (`bt709`), tagged-`bt709` 576 (`bt709`), and an HDR form unaffected.
  - `-aspect` present for SAR 64:45 and absent for SAR 1:1, 1385:1384 and for no SAR.
  - `mpeg4` is still copied with the warning (AC-5).
- `src/ffmpeg/params.spec.ts`, `getAudioParams` block:
  - Opus 5.1 titled `Surround 5.1` is copied, retitled, and carries no encode arguments (AC-7).
  - Opus plus AC3 in two languages keep the right per-track indices (AC-8).
  - Opus plus AC3 in one language select the AC3 (AC-9).
  - Opus 7.1 and stereo get their titles.

Not owed: the encode driver and job handler. They are unchanged, and the new arguments are a pure
function of metadata that already reaches them.

**Follow-up, not in this slice:** `094`'s grain probe encodes sample windows without deinterlacing,
so an interlaced source under `AUTO` grain mode may measure combing as grain. Report it in the
implementation summary as a candidate for its own change.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit    # no errors
bin/npm worker test                     # all suites green, including ffmpeg/6.json; no older case edited
bin/comments worker                     # no violations (Article XI: no prose comments added)
```

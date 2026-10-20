---
title: Stream-End Trim
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-19
last_updated: 2026-10-19
status: Approved
services: [api, web, worker]
---

# SPEC: Stream-End Trim (`spec.md`)

## Context & Goal

Some releases arrive with tracks that do not end together. The container's duration is that of its
longest track, so a player shows the full length and then plays a stretch where one of the tracks
has nothing left: an image with no sound, or a dark screen with sound. A sweep of this
installation's library on 2026-10-19 (953 files) found 26 of them: eleven Voltron Legendary
Defender S01 episodes (NTb WEBRip) whose audio runs 11.7–20.6 s past the last video frame, ten Lost
in Space S01 episodes whose video runs ~50 s past the audio (mute dubbing cards), Star Wars (1977)
with 61 s of video past both audio tracks, They Will Kill You (2026) with a Spanish track running
61 s past the video, The End of Oak Street (2026) and The Help (2011) with 19.4 s and 4.8 s of
trailing silent audio. Every one was already that way in its source — Perceptor's encode copies
the mismatch faithfully — and every one was fixed by hand with a stream-copy remux cut at the right
point. Normal files differ by 0.02–0.3 s.

This feature adds an installation-wide **Settings → Compression** switch that, when on, makes the
worker read where each track of the source really ends **before the encode starts** — demuxing the
last packets, never decoding — and, when the tracks it keeps disagree by more than two seconds, stop
the output at the end of whichever comes first: the video, or the longest of the kept audio tracks.
That one rule reproduces every hand cut above. A file where a kept track ends far too early (The
Darkest Hour (2011): audio stops at 44 min of 89) is a broken source, not a tail, and is left whole.

It sits beside `098-dub-card-tail-trim` and shares its shape: `api` stores the switch and hands the
worker one boolean on `EncodeJobDetails` (`services/api/src/process-jobs/`), `web` renders it on
`CompressionPanel`, and the worker (`services/worker/src/encode/`) decides the cut and limits the
FFmpeg output duration (`services/worker/src/ffmpeg/buildCommand.ts` already takes one). The two
are independent: different causes, different detectors, different switches. Pipeline stage
touched: **Transcode**. No stage changes status, no schema changes, and nothing already in the
library is touched (Article XII).

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Installation switch)**: Settings → Compression must carry a boolean control
      ("Recortar el final cuando las pistas no terminan juntas" / "Trim the end when tracks don't end
      together"), persisted as the `stream_end_trim_enabled` Setting and saved through the same
      `updateSettings` call as every other field on that tab. There is no per-title override and no
      per-user preference.
- [ ] **REQ-2 (Default off)**: An installation that predates this feature, or whose row is absent,
      must read as **off** — the `=== 'true'` idiom, never `!== 'false'`.
- [ ] **REQ-3 (Off means no analysis)**: With the switch off the worker must read nothing extra — no
      additional ffprobe invocation, no `[streamtrim]` log line — and the encode is the command it
      produces today.
- [ ] **REQ-4 (Compression off means nothing)**: With `compression_enabled` off nothing in this
      feature runs: the file is moved untouched (`032`). The Settings control is locked the way
      `grain_auto_enabled` and `dub_trim_enabled` already are — disabled, state preserved, never
      cleared.
- [ ] **REQ-5 (Before the encode, without decoding)**: The track ends must be established before the
      encode's FFmpeg process starts, from demuxed packet timestamps only. No frame or sample is
      decoded for this feature.
- [ ] **REQ-6 (Where a track ends)**: A track's end is the end of its last packet (timestamp plus
      duration), read from the last 300 seconds of the file. Container duration, a stream's
      `duration` field and its `DURATION` tag must not be used in its place — Voltron's NTb source
      carries no per-track tag at all, and a tag-based reader (MediaInfo) reports its video as
      1:08:41 when the last frame is at 1:08:21.
- [ ] **REQ-7 (Which tracks count)**: Only the first video track and the audio tracks the encode
      keeps (after the installation's language selection) take part. Dropped audio tracks and every
      subtitle track are ignored when deciding the cut.
- [ ] **REQ-8 (Cut rule)**: Let *V* be the video's end and *A* the latest end among the kept audio
      tracks. When |*V* − *A*| exceeds **2 seconds**, the output stops at min(*V*, *A*); otherwise the
      file is encoded whole. Every output stream — video, audio, subtitles — ends at that point. On
      the 2026-10-19 cases: Voltron S01E01 → *V* (1:08:21), Lost in Space S01E01 → *A* (1:02:45),
      Star Wars → *A* (2:01:08, the English track; the Spanish one ends 0.7 s earlier and is not cut
      by it), They Will Kill You → *V* (1:34:33, where the English track also ends; the Spanish track
      loses its last 61 s).
- [ ] **REQ-9 (Broken-source guard)**: When the video or any kept audio track has no packet inside
      the 300-second window, the file is encoded whole. A gap that large is a damaged source (The
      Darkest Hour), and cutting there would delete most of the title.
- [ ] **REQ-10 (Composition with `098`)**: When both switches are on and both produce a cut, the
      output stops at the earlier of the two. Either one alone behaves as its own spec says.
- [ ] **REQ-11 (Applies to every encoded title)**: Films, shorts and episodes alike, including each
      file of a season pack (`095`), which is read and cut on its own.
- [ ] **REQ-12 (Progress follows the trim)**: The progress the worker reports, and the `100%` it
      reaches, must be measured against the trimmed duration — the same posture as `098` REQ-10.
- [ ] **REQ-13 (Log line)**: Every file whose analysis completes must log one line `[streamtrim]`
      naming the input, *V*, *A* and the outcome — the cut point in seconds, `keep`, or
      `keep (out of window)` for REQ-9. A failed analysis logs nothing (NFR-1).

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Failure is silent and harmless)**: Any analysis failure — ffprobe exits non-zero,
      unparseable output, no video or no kept audio track — must encode the whole file, silently: no
      warning, no log line, no error reported anywhere. Only cancellation (`047`/`097`'s
      `AbortSignal`) propagates, and it must stop the analysis process the same way it stops the
      encode.
- [ ] **NFR-2 (The worker trusts nothing)**: An absent, null or non-boolean `streamEndTrimEnabled` on
      the payload must read as **off**, silently.
- [ ] **NFR-3 (Bounded cost)**: The analysis demuxes at most the last 300 seconds of the file and
      decodes nothing; on this installation's `/mnt/perceptor` it took about five seconds per file.
      No verdict cache is owed for that cost (Article X); a retry simply reads again.
- [ ] **NFR-4 (No snapshot)**: The switch is resolved when the worker asks for the job's details,
      never stored on `ProcessJob`. Flipping it while an encode runs leaves that encode as it was.
- [ ] **NFR-5 (Tests where failure is silent)**: A wrong cut silently deletes real content, or
      silently keeps the defect, with no error anywhere. The cut rule must be covered by tests built
      from the recorded track ends of this spec's cases (at least Voltron S01E01, Lost in Space
      S01E01, Star Wars, They Will Kill You, The Help, a normal file at 0.3 s and The Darkest Hour's
      out-of-window shape), including one where a dropped audio track is the longest (Article IX).

## GraphQL Contract Delta

```graphql
type EncodeJobDetails {
  """Spec 099 — the installation's stream_end_trim_enabled switch, already resolved to a boolean."""
  streamEndTrimEnabled: Boolean!
}
```

No new `Setting` type or argument: `stream_end_trim_enabled` is an ordinary `kind: 'boolean'`
catalog entry, read and written through the existing `settings` / `updateSettings` pair.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `updateSettings` with `stream_end_trim_enabled` set to anything but `"true"`/`"false"` | `BadRequestException`, key `error.setting.expected_boolean` | `"stream_end_trim_enabled" debe ser "true" o "false"` |

The key already exists; this feature introduces none. Consumers:

- **`web`** — adds `stream_end_trim_enabled` to the Compression tab's submitted fields; a refusal
  surfaces through the tab's existing error rendering. `web` never selects
  `EncodeJobDetails.streamEndTrimEnabled`.
- **`worker`** — adds `streamEndTrimEnabled` to `encode.job.ts`'s `EncodeJobDetails` query and
  normalizes it per NFR-2. Analysis failures are worker-local (NFR-1) and never reported to `api`.

## Data Model Changes

None. `stream_end_trim_enabled` is a `Setting` row, not a column: the production seed creates it as
`"false"`, create-only like every other seeded key, and REQ-2 makes an install that never receives it
behave identically.

## Acceptance Criteria

- [ ] **AC-1**: With `stream_end_trim_enabled` on, encoding the Voltron NTb source
      `Voltron.Legendary.Defender.S01E01.The.Rise.Of.Voltron.1080p.NF.WEBRip.DD5.1.x264-NTb.mkv`
      produces an output whose container duration is within 0.1 s of 4101.1 s, whose last audio
      packet is within 0.1 s of its last video packet, and the worker logs a `[streamtrim]` cut.
- [ ] **AC-2**: With the switch on, encoding a test file built with `bin/cli worker ffmpeg` from a
      120 s video track and a 60 s audio track (the Lost in Space / Star Wars shape) produces a 60 s
      output; one built from a 60 s video and a 120 s audio (the Voltron / The Help shape) also
      produces a 60 s output.
- [ ] **AC-3**: With the switch on, a file whose video and kept English audio end at 60 s and whose
      kept Spanish audio ends at 120 s (the They Will Kill You shape) produces a 60 s output with both
      audio tracks present; the same file with Spanish not among the allowed audio languages produces
      a 60 s output and the log shows *A* = 60 (REQ-7).
- [ ] **AC-4**: With the switch on, encoding any of the Voltron S02 NTb sources (tracks within 0.3 s)
      produces a full-length output, logs `[streamtrim] … keep`, and the logged FFmpeg command carries
      no `-t` unless `098` cut it.
- [ ] **AC-5** *(broken-source path)*: With the switch on, a file whose audio ends 600 s before its
      video (The Darkest Hour shape) is encoded at full length and logs
      `[streamtrim] … keep (out of window)` (REQ-9).
- [ ] **AC-6** *(failure path)*: With the switch on and the analysis forced to fail (the ffprobe
      binary made to exit non-zero, or a file with no audio track), the encode completes at full
      length and the worker log carries no `[streamtrim]` line and no warning for it (NFR-1).
- [ ] **AC-7** *(failure path)*: Deleting a source (`047`) or stopping its encode (`097`) while its
      analysis is running leaves no ffprobe process alive and reports no encode outcome.
- [ ] **AC-8**: With the switch off, encoding the AC-1 source produces an output as long as the
      source (4121.8 s), the log carries no `[streamtrim]` line, and the FFmpeg command carries no
      `-t` (REQ-3).
- [ ] **AC-9**: With both `stream_end_trim_enabled` and `dub_trim_enabled` on, a file that both
      detectors would cut is cut at the earlier point, and each logs its own line (REQ-10).
- [ ] **AC-10**: With `compression_enabled` off, the Compression tab renders the switch disabled at
      its stored value, saving the tab leaves `stream_end_trim_enabled` unchanged in the database, and
      moving a file logs no `[streamtrim]` line (REQ-4).
- [ ] **AC-11**: `bin/mysql -e "select value from settings where \`key\` = 'stream_end_trim_enabled'"`
      on a database upgraded from before this feature returns no row or `false`, and the Compression
      tab renders the switch off (REQ-2).
- [ ] **AC-12**: While an AC-1 encode runs, the progress on `/downloads` reaches 100% when the encode
      finishes, never stalling below it (REQ-12).
- [ ] **AC-13**: `bin/npm api test`, `bin/npm worker test`, `bin/cli api npx --no tsc --noEmit`,
      `bin/cli web npx --no tsc --noEmit`, `bin/cli worker npx --no tsc --noEmit`,
      `bin/cli web node scripts/check-messages.mjs` and `bin/comments` all pass, and the worker suite
      contains the NFR-5 cases.

## Out of Scope

- **Fixing files already in the library.** Article XII; the 25 files found on 2026-10-19 were
  remuxed by hand outside Perceptor.
- **Surfacing broken sources.** REQ-9 encodes a Darkest-Hour-shaped file whole and logs it; showing
  it on `/downloads` or refusing it is a separate feature with its own UI.
- **The compression-off path.** `032` moves the file untouched; trimming there would mean adding a
  remux to a path whose point is to run no FFmpeg at all.
- **Checking what the surplus contains.** The surplus is cut whether it is silence, black, cards or
  credits — a stretch missing one of its tracks is not worth keeping either way.
- **Mismatches at the start** (a track starting late). Not observed in this library.
- **Padding the shorter track** (silence or a frozen frame to the longer one's end). It keeps the
  defect's length, which is the opposite of the goal.
- **Subtitle tracks ending late.** REQ-7 ignores them; they are cut with everything else.

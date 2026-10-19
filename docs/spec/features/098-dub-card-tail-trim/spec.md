---
title: Dub-Card Tail Trim
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-19
last_updated: 2026-10-19
status: Implemented
services: [api, web, worker]
---

# SPEC: Dub-Card Tail Trim (`spec.md`)

## Context & Goal

Many streaming releases end with something nobody watches: a run of static, localized dubbing-credit
cards appended after the real ending — the German, Arabic, Czech, Japanese or Latin-American crews of
every dub the platform carries. Voltron Legendary Defender spends 22–26 seconds of every episode on
them after the Netflix logo; Neagley and Reacher season 3 (Amazon) spend about two minutes; War
Machine (Netflix) two and a half. Perceptor transcodes every one of those seconds into the library
today, which across a few hundred episodes adds up to gigabytes of black frames with text on them.
Container chapters cannot be relied on to mark the tail — most releases carry none, and an end-credits
marker, when present, covers far more than the dubbing cards.

This feature adds an installation-wide **Settings → Compression** switch that, when on, makes the
worker look at the end of each source before encoding it and, when it finds a dubbing-card tail, stops
the output where that tail starts. The detector is the one validated by hand against 38 real files of
this library before this spec was written (13 tails cut at the right place, 0 false positives, see
AC-1/AC-2): it looks only at the last five minutes of the **video stream**, finds the contiguous run of
frozen frames that runs all the way to the end, and accepts it only when it has at least five cards
and at least 80% of them last a whole multiple of 2.002 seconds — the fixed card cadence the platforms'
dubbing templates use, which is exactly what separates them from an original production's own
card-style credits (Chernobyl's HBO credits are a run of 56 static cards, but only 5% of them last a
2-second multiple, and they are kept).

The decision is the worker's, like `094`'s grain verdict: `api` stores the switch and hands the worker
one boolean on `EncodeJobDetails` (`services/api/src/process-jobs/`), `web` renders the switch on
`CompressionPanel`, and the worker (`services/worker/src/encode/`) runs the detection and limits the
FFmpeg output duration. Pipeline stage touched: **Transcode**. No stage changes status, no schema
changes, and nothing already in the library is touched (Article XII).

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Installation switch)**: Settings → Compression must carry a boolean control
      ("Recortar placas de doblaje al final" / "Trim dubbing credit cards at the end"), persisted as the
      `dub_trim_enabled` Setting and saved through the same `updateSettings` call as every other field
      on that tab. There is no per-title override and no per-user preference.
- [ ] **REQ-2 (Default off)**: An installation that predates this feature, or whose row is absent, must
      read as **off** — the `=== 'true'` idiom, never `!== 'false'`. A heuristic that shortens files
      must never switch itself on at upgrade.
- [ ] **REQ-3 (Off means no analysis)**: With the switch off the worker must run no detection at all —
      no extra FFmpeg invocation, no `[dubtrim]` log line — and the encode is byte-for-byte the command
      it produces today.
- [ ] **REQ-4 (Compression off means nothing)**: With `compression_enabled` off nothing in this feature
      runs: the file is moved untouched (`032`), never trimmed, never analysed. The Settings control is
      locked the way `grain_auto_enabled` already is — disabled, state preserved, never cleared.
- [ ] **REQ-5 (Analysis window)**: The detection must examine only the last 300 seconds of the source's
      **video stream** (the whole stream when it is shorter), measured against the video stream's own
      end — its `duration`, else its `DURATION` tag — and only falling back to the container duration
      when the stream reports neither. A container whose duration runs past the video (Voltron S01E01:
      ~20 s) must not hide a tail that ends where the video ends.
- [ ] **REQ-6 (Card run)**: Within that window, frozen segments are those FFmpeg's `freezedetect`
      reports at noise `0.003` and a minimum of 1 second, on frames downscaled to 320 px wide. The
      candidate tail is the run of consecutive frozen segments, each starting at most 0.2 s after the
      previous one ends, whose last segment reaches the end of the window within 0.5 s. No run reaching
      the end means no candidate.
- [ ] **REQ-7 (Classification)**: The candidate is a dubbing tail only when it has at least **5**
      segments and at least **80%** of them last a whole multiple (≥ 1) of **2.002 s**, within
      ±0.06 s. Otherwise the file is encoded whole.
- [ ] **REQ-8 (Cut point)**: A dubbing tail is cut at the start of the **whole** run, not at the first
      2-second card — a run may open with a fade or black frame of another length (Voltron), or with
      a card of another length (War Machine, The Wrecking Crew), and those belong to the tail. Every
      output stream — video, audio, subtitles — ends at that point.
- [ ] **REQ-9 (Applies to every encoded title)**: Films, shorts and episodes alike, including each file
      of a season pack (`095`), which is analysed and cut on its own.
- [ ] **REQ-10 (Progress follows the trim)**: The progress the worker reports, and the `100%` it reaches,
      must be measured against the trimmed duration, not the source's.
- [ ] **REQ-11 (Verdict reuse)**: The verdict for an input file must be reused within the worker process
      when the same file is encoded again (a BullMQ retry, an `054` requeue, a `097` stop/resume), the
      same in-process posture as `094`'s grain verdict cache — keyed per **input file**, never per
      `mediaSourceId`, since a season-pack source holds many files with different cut points.
- [ ] **REQ-12 (Log line)**: Every file whose analysis completes must log one line `[dubtrim]` naming
      the input, the number of segments in the run, the share of 2-second multiples and the outcome —
      the cut point in seconds, or `keep`. A failed analysis logs nothing (NFR-1).

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Failure is silent and harmless)**: The trim is a nicety, never a requirement of the
      encode. Any detection failure — FFmpeg exits non-zero, no readable duration, unparseable output
      — must encode the whole file, silently: no warning, no log line, no error reported anywhere.
      Only cancellation (`047`/`097`'s `AbortSignal`) propagates, and it must stop the detection
      process the same way it stops the encode.
- [ ] **NFR-2 (The worker trusts nothing)**: An absent, null or non-boolean `dubTrimEnabled` on the
      payload must read as **off**, silently — an `api` that has not shipped this field yields today's
      behaviour exactly.
- [ ] **NFR-3 (Bounded cost)**: The detection decodes at most 300 seconds of the source, once per file
      (REQ-11), and adds no encode pass of its own.
- [ ] **NFR-4 (No snapshot)**: The switch is resolved when the worker asks for the job's details, never
      stored on `ProcessJob`. Flipping it while an encode is running leaves that encode as it was.
- [ ] **NFR-5 (Tests where failure is silent)**: A misclassification silently deletes real content or
      silently keeps garbage, with no error anywhere. The run-and-classification rule must be covered
      by tests built from the recorded freeze sequences of this spec's sample files (at least
      Neagley S01E01, Voltron S03E01, War Machine and Chernobyl S01E01), and the video-end rule by a
      case whose container duration exceeds its video stream's (Article IX).

## GraphQL Contract Delta

```graphql
type EncodeJobDetails {
  """Spec 098 — the installation's dub_trim_enabled switch, already resolved to a boolean."""
  dubTrimEnabled: Boolean!
}
```

No new `Setting` type or argument: `dub_trim_enabled` is an ordinary `kind: 'boolean'` catalog entry,
read and written through the existing `settings` / `updateSettings` pair.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `updateSettings` with `dub_trim_enabled` set to anything but `"true"`/`"false"` | `BadRequestException`, key `error.setting.expected_boolean` | `"dub_trim_enabled" debe ser "true" o "false"` |

The key already exists; this feature introduces none. Consumers:

- **`web`** — adds `dub_trim_enabled` to the Compression tab's submitted fields; a refusal surfaces
  through the tab's existing error rendering. `web` never selects `EncodeJobDetails.dubTrimEnabled`.
- **`worker`** — adds `dubTrimEnabled` to `encode.job.ts`'s `EncodeJobDetails` query and normalizes it
  per NFR-2. Detection failures are worker-local (NFR-1) and never reported to `api` as an error.

## Data Model Changes

None. `dub_trim_enabled` is a `Setting` row, not a column: the production seed creates it as `"false"`,
create-only like every other seeded key, and REQ-2 makes an install that never receives it behave
identically.

## Acceptance Criteria

- [ ] **AC-1**: With `dub_trim_enabled` on, encoding each of these sources produces an output whose
      video ends within one second of the given cut point, and the worker logs a `[dubtrim]` cut:
      Neagley S01E01 → 55:16.2, Neagley S01E08 → 50:49.2, Reacher S03E01 → 51:30.6,
      Reacher S03E08 → 49:58.6, The Wrecking Crew (2026) → 2:02:05.3, War Machine (2026) → 1:46:40.6,
      Voltron Legendary Defender S03E01 → 23:13.9.
- [ ] **AC-2** *(false-positive path)*: With `dub_trim_enabled` on, encoding Chernobyl S01E01,
      Reacher S01E01, Foundation S01E01, Voltron Legendary Defender S01E01 and Alita: Battle Angel
      produces outputs as long as their sources and logs `[dubtrim] … keep` for each.
- [ ] **AC-3**: For an AC-1 output, `ffprobe` shows the audio and subtitle streams ending at the same
      point as the video (REQ-8), and the last seconds of the output are the frames immediately before
      the dubbing cards (a studio logo or the end of the original credits), not a card.
- [ ] **AC-4**: While an AC-1 source encodes, the progress shown on `/downloads` reaches 100% when the
      encode finishes, never stalling below it (REQ-10).
- [ ] **AC-5**: With `dub_trim_enabled` off, encoding Neagley S01E01 produces a full-length output, the
      worker log carries no `[dubtrim]` line, and the logged FFmpeg command carries no `-t` (REQ-3).
- [ ] **AC-6** *(failure path)*: With `dub_trim_enabled` on and the detection forced to fail (e.g. an
      input whose video stream FFmpeg cannot decode past the start of the window, or the detection
      binary made to exit non-zero), the encode still completes at full length and the worker log
      carries no `[dubtrim]` line and no warning for it (NFR-1).
- [ ] **AC-7** *(failure path)*: Deleting a source (`047`) or stopping its encode (`097`) while its
      detection is running leaves no detection process alive and reports no encode outcome.
- [ ] **AC-8**: With `compression_enabled` off, the Compression tab renders the switch disabled at its
      stored value, saving the tab leaves `dub_trim_enabled` unchanged in the database, and moving a
      Neagley episode logs no `[dubtrim]` line (REQ-4).
- [ ] **AC-9**: `bin/mysql -e "select value from settings where \`key\` = 'dub_trim_enabled'"` on a
      database upgraded from before this feature returns no row or `false`, and the Compression tab
      renders the switch off (REQ-2).
- [ ] **AC-10**: A season pack with dubbing tails yields one `[dubtrim]` line per file, each with its own
      cut point (REQ-9, REQ-11).
- [ ] **AC-11**: `bin/npm api test`, `bin/npm worker test`, `bin/cli api npx --no tsc --noEmit`,
      `bin/cli web npx --no tsc --noEmit`, `bin/cli worker npx --no tsc --noEmit`,
      `bin/cli web node scripts/check-messages.mjs` and `bin/comments` all pass, and the worker suite
      contains the NFR-5 cases.

## Out of Scope

- **Trimming files already in the library.** Article XII: nothing under the destinations root is ever
  rewritten. Recovering space from existing files would be its own feature and its own amendment.
- **A per-title override.** The user asked for one installation-wide on/off; if a specific title is
  ever cut wrongly, a `grainMode`-style override is the later change, with that title in hand.
- **Original end credits.** Scrolling or card-style production credits are kept on purpose; REQ-7 is
  tuned to reject them.
- **Dubbing cards anywhere but the end** (an opening card, a mid-file card). Not observed in this
  library.
- **Chapter-based detection.** Most releases carry no chapters, and an end-credits chapter spans far
  more than the dubbing tail.
- **Non-destructive marking** (a media-server "outro" segment instead of a cut). It keeps the bytes,
  which is the opposite of this feature's goal.
- **Excluding the tail from `094`'s grain probe windows.** The probe samples the middle 90% of the
  source; whether a tail skews it is a question for that detector, not this one.

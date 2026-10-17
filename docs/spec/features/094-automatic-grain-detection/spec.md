---
title: Automatic Grain Detection
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-16
last_updated: 2026-10-17
status: Approved
services: [api, worker]
---

# SPEC: Automatic Grain Detection (`spec.md`)

## Context & Goal

`092-film-grain-optimization` built the whole scaffolding for film grain synthesis and then
deliberately stopped one function short of using it. An installation-wide **Automatic Grain
Optimization** switch and a per-title inherit/on/off control both exist and both work; `api`
resolves them into one already-effective `EncodeJobDetails.grainMode`; the worker turns `ON` into
`film-grain=8:film-grain-denoise=1` and `OFF` into `film-grain=0`. The third state, `AUTO`, reaches
`resolveFilmGrain(mode, metadata)` in `services/worker/src/encode/grain-mode.ts` — which answers
"no grain" for every input it has ever been given. Its `metadata` parameter is unused, and 092's
REQ-9 says so in as many words: it is a seam, not a decision.

This feature replaces that body. `AUTO` becomes a real answer, derived from the source file in two
stages whose names describe what they read rather than when they run. The **metadata gate** costs
nothing: it scores the title's own year (already on the job payload, so a file named `mipeli.mkv`
still knows it is from 1998), the release path's provenance markers, the audio codecs, and
bits-per-pixel-per-frame normalized for codec efficiency — all from the `ffprobe` output
`encode.ffmpeg.ts` has already read. A score below the threshold ends it: no grain, nothing decoded.
A score at or above it runs the **encode probe**, a fixed measurement procedure of its own — not a
copy of the job's encode — that encodes a handful of short windows of the source at a 1080p box,
twice — once with `film-grain=0` and once with `film-grain=8:film-grain-denoise=1` — and divides the
output sizes. The absolute bitrate that synthesis recovers is the verdict. Both stages run in the
encode driver, before the FFmpeg command is built; `buildFfmpegCommand` receives the resulting
boolean and stays the synchronous, pure function the case corpus pins.

Measuring the saving rather than the grain is the load-bearing choice here, and it was arrived at by
measurement rather than design. A pixel-statistics detector was built first and retired: on a
nine-file corpus its classes were not linearly separable — Star Wars 1977, a 35mm scan whose full
encode recovers 1.14 Mbps, measured *below* two files that recover nothing. The percentage saved
fails the same way, because an AV1 denoiser removes something from every image: in the probe, a clean
2023 digital film saved 19.99% and Star Wars saved 19.71%, with opposite correct answers (Star Wars'
full encode saved 14.94%). The absolute figure
separated the same corpus with no errors and a 2.19× margin, because what a grainy source really has
is not a larger *fraction* of waste but a far larger bitrate for the same perceived quality. Pipeline
stage touched: **Transcode**, and only the branch that was already there. No stage changes status.
The one thing the worker cannot see is whether a film is a short; `api` adds `isShort` to
`EncodeJobDetails` so the probe can be skipped for one (REQ-11, REQ-12).

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Two stages, short-circuited)**: With an effective grain mode of `AUTO`, the worker
      must run the metadata gate first and, only if it passes, the encode probe. A gate that fails
      yields "no grain" without decoding or encoding anything. Grain is synthesized only when both
      stages pass.
- [ ] **REQ-2 (`ON` and `OFF` never reach the detector)**: An effective mode of `ON` or `OFF`
      resolves exactly as `092` left it, with neither stage running and no probe encode spawned.
      Only `AUTO` is detected.
- [ ] **REQ-3 (Gate inputs are already in hand)**: The metadata gate must read only the `ffprobe`
      output the encode already produced and fields already present on `EncodeJobDetails` — the
      title's `year`, the source path, the audio stream codecs, the video stream's bitrate,
      dimensions and frame rate. It must make no network call, no second `ffprobe`, and no
      filesystem read beyond what the encode performs anyway.
- [ ] **REQ-4 (Gate scoring)**: The gate accumulates a score and passes at or above a threshold.
      A nonzero `film-grain` parameter or `tune=grain` in the source's own encoder settings is
      decisive evidence and weighs more than any circumstantial signal. Bits-per-pixel-per-frame,
      normalized for codec efficiency, contributes positively above an upper tier, weakly above a
      middle tier, and negatively below a lower one. A lossless audio track, a disc-source marker in
      the release path, and a release year before the digital-capture era each contribute positively;
      a streaming-source marker contributes negatively.
- [ ] **REQ-5 (Year comes from the catalog, never the filename)**: The gate's year signal reads
      `EncodeJobDetails.year`, which `api` already sends and which comes from TMDB. A release named
      `mipeli.mkv` with no year anywhere in its path must score identically to the same file named
      with its year. For an episode the year is the series' first air year, not the episode's, so
      every episode of a long-running series inherits the bonus of its first season; this is
      accepted rather than corrected.
- [ ] **REQ-6 (Probe is a fixed measurement)**: The encode probe encodes nine evenly spaced
      six-second windows of the source twice — once with `film-grain=0`, once with
      `film-grain=8:film-grain-denoise=1` — and computes the output bitrate at `film-grain=0` and the
      fraction the grain variant saves. Its parameters are its own and never follow the job's:
      CRF 22 and preset 8 for every source regardless of the remux/web distinction `isRemux` makes,
      the crop most of five evenly spaced `cropdetect` samples agree on, and the job's own
      content-kind parameters, which interact with the denoiser. The question the probe answers is
      whether to synthesize grain, not what the final encode will weigh, so it needs a stable scale
      rather than the job's quality tier.
- [ ] **REQ-7 (Verdict is absolute, not proportional)**: The probe passes when
      `bitrate × saving` — the absolute bitrate synthesis recovers — reaches **0.886 Mbps**. The
      saved *percentage* alone must not decide, and must still be logged. That figure is the
      geometric mean of the gap this spec's corpus leaves between its highest clean file (0.599) and
      its lowest grain file (1.311), measured at CRF 24 and therefore provisional until the CRF 22
      re-measurement the Calibration Corpus calls for; it is a single named constant, expected to
      be retuned as more titles are measured, and nothing else in the detector may depend on its
      current value.
- [ ] **REQ-8 (Probe resolution is fixed, not the job's ceiling)**: The probe measures at
      `min(source, 1080p)` — downscaled into a 1920×1080 box when larger, never upscaled — whatever
      `compressionResolution` the job carries. The verdict is a property of the source, so one
      threshold serves every ceiling. Measured on this spec's corpus: at a 4K box the classification
      is unchanged, the margin between the highest clean file and the lowest grain file narrows
      from 1.82× to 1.46×, the probe costs 701–1110 s per file instead of 456–837 s, and no file's
      grain reappeared at 4K (Tenet's saving per output pixel is identical at both sizes). A
      Green-Mile-like source that would need grain only at a 4K ceiling resolves to "no grain",
      the error that costs bytes rather than quality.
- [ ] **REQ-9 (One verdict per source)**: A season pack fans out into one `ProcessJob` per episode,
      all sharing one `MediaSource`. The probe must run once for that source and every sibling job
      must reuse its verdict. Grain is a property of the scan, not of the episode. The verdict is
      held in the worker's memory for the life of the process: a worker restart mid-pack probes the
      source again for the jobs that remain, which costs one more probe and changes no verdict.
- [ ] **REQ-10 (The decision is legible in the log)**: Each resolution must log, on one line, which
      stage decided, the gate's score, and — when the probe ran — its measured bitrate, saved
      percentage and absolute saving. A reader of `docker compose logs worker` must be able to tell
      why a title got grain without re-running anything.

- [ ] **REQ-11 (Short films skip the probe)**: A film registered as a short resolves on the
      metadata gate alone, with no probe and no synthesis. The condition is the catalog's own
      `Movie.isShort` — the flag `056` derives at registration and the title's own detail page can
      correct — not a duration the worker re-derives from `ffprobe`, so a short wrongly longer than
      forty minutes and a feature wrongly shorter than it both behave the way the library says they
      are. `048` already resolves that flag into `outputRoot` on the `api` side and never sends it;
      REQ-12 puts it on the wire. An episode is never short-circuited this way however brief it is,
      because REQ-9 already amortizes one probe across a whole pack, and a series carries no
      equivalent flag.
- [ ] **REQ-12 (`isShort` crosses the wire)**: `api` must expose the film's `Movie.isShort` on
      `EncodeJobDetails`, resolved at query time beside `outputRoot` from the same row it already
      reads. It is the raw column, not the effective destination: a film flagged short in an
      installation whose shorts are disabled still reports `true`, because what the probe skips on
      is the runtime, not the folder. An episode's job reports `false`. The worker must treat an absent or non-boolean value
      as `false` and log, the posture `contentKind` and `compressionResolution` already take — an
      `api` that predates this field makes every title probe, never crash.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Never fails an encode)**: Any failure inside either stage — a probe encode that
      exits nonzero, a source too short to sample, an unparseable `ffprobe` field, an unexpected
      throw — must resolve to "no grain", log once, and let the encode proceed. This is the posture
      `normalizeGrainMode` and `normalizeContentKind` already take, for the same reason: a
      diagnostic must never demote a job that would have produced a good file.
- [ ] **NFR-2 (Cancellable)**: A probe in flight must abort when the job's existing `AbortSignal`
      fires, leaving no scratch file behind. `047-source-deletion`'s guarantee — deleting a source
      mid-pipeline kills whatever process it owns — must still hold while the probe is the running
      process.
- [ ] **NFR-3 (Bounded cost)**: The probe is the only expensive part and it runs only behind the
      gate. Its encoded duration is fixed by REQ-6 and REQ-8 at 9 × 6 s × 2 encodes at no more than
      1080p, independent of the source's length and of the job's ceiling, so a three-hour film and a
      forty-minute episode, a 4K and a 1080p ceiling, all cost the same. On this spec's corpus that
      measured 456–837 s per probe, dominated by decoding and seeking 4K sources.
- [ ] **NFR-4 (Compression off means nothing runs)**: With `compression_enabled` off the worker
      never resolves a grain mode at all (`092` REQ-10), so neither stage may run and no probe
      process may be spawned. This must stay structural — a consequence of where the resolution
      sits, not a check someone remembers to write.
- [ ] **NFR-5 (The `ffmpeg/` case corpus keeps working)**: `services/worker/ffmpeg/`'s cases assert
      a whole ordered FFmpeg argument array against a synchronous, pure `buildFfmpegCommand`. The
      detector must not make that function asynchronous or impure; a probe that spawns processes
      cannot run inside the thing the corpus pins. Grain is therefore resolved in the encode driver,
      which already holds the `ffprobe` output and the job's `AbortSignal`, and
      `buildFfmpegCommand` receives an already-resolved `filmGrain` boolean in place of the
      `grainMode` it resolves today — the `092` seam moves one call up rather than growing a body.
- [ ] **NFR-6 (Thresholds are named constants with a recorded provenance)**: Every threshold is a
      named constant in the worker, in the shape `remux-detection.ts`'s
      `REMUX_BITS_PER_PIXEL_PER_FRAME_THRESHOLD` already uses. The corpus each was fitted against is
      recorded in this spec, not in a comment (Article XI).

## GraphQL Contract Delta

**One added field, no removal and no behaviour change for an existing reader.**

```graphql
type EncodeJobDetails {
  # …every existing field, unchanged…
  isShort: Boolean!
}
```

Every other input the detector needs is already on the wire. `EncodeJobDetails` carries `year`,
`contentKind`, `compressionResolution`, `grainMode`, `inputFilePath`, `downloadPath`,
`mediaSourceId` and `sourceKind`; the `ffprobe` output is read by `encode.ffmpeg.ts` before
`buildFfmpegCommand` and already passed to `onProbe`. `092` resolved the three-way
`GrainMode` into the two-way-plus-`AUTO` `EffectiveGrainMode` precisely so that interpreting `AUTO`
would be one service's private business — `isShort` is the one thing it should not derive.

`isShort` is non-null and `false` for every episode job. It is a raw read of the existing
`Movie.isShort` column (`048`), never combined with `shorts_enabled`, resolved in `ProcessJobsService` beside `outputRoot`, which already
reads it for the destination folder; the destination resolution is unchanged and keeps its own read.
No new error condition: the field cannot fail independently of the query that carries it.

| Error | Condition |
| :-- | :-- |
| *(none)* | `isShort` adds no failure mode; a job whose title row is missing already fails the whole query |

No Prisma model, no Setting, no mutation and no new query. The installation-wide kill switch this
feature needs already exists: with `grain_auto_enabled` off, `api` never emits `AUTO`, so an operator
who does not want minutes of probing per encode turns off the switch `092` shipped.

## Data Model Changes

**None.** The verdict is derived per encode and never stored. `092`'s `Movie.grainMode` /
`Show.grainMode` remain the only persisted grain state, and a title left on `INHERIT` is exactly the
title this feature decides for.

## Calibration Corpus

The thresholds in REQ-4 and REQ-7 are fitted against nine real files, measured end to end. Four
labels are grounded in full encodes or the maintainer's own judgement of the delivered file; the
remaining five are inferred from provenance and are weaker evidence.

The probe column below was measured at **CRF 24, preset 8**, at a 1080p box. REQ-6 fixes the probe
at CRF 22, so these figures — and the 0.886 derived from them — are provisional until the corpus is
re-measured at CRF 22; the threshold is refitted from that run, not carried over.

| File | Source | Gate score | Probe, saved Mbps | Label | Basis |
| :-- | :-- | --: | --: | :-- | :-- |
| Lionheart (1990) | 35mm, 4K remux | 5 | 2.771 | grain | maintainer |
| Star Wars (1977) | 35mm 4K77 scan | 4 | 1.464 | grain | full encode, 1.140 Mbps recovered |
| Cherry 2000 (1987) | 35mm, 1080p remux | 3 | 1.311 | grain | full encode, 1.222 Mbps recovered |
| The Hurricane Heist (2018) | digital, 4K | 4 | 0.599 | clean | provenance |
| Ted S01E02 (2024) | WEB-DL, 4K | 0 | 0.485 | clean | provenance |
| The Pod Generation (2023) | digital, 1080p | 1 | 0.244 | clean | provenance |
| The Green Mile (1999) | 35mm, 4K remux | 5 | 0.227 | clean | maintainer, "2.1 GB for 3 h is fine" |
| Tenet (2020) | 65mm, 4K | 4 | 0.137 | clean | provenance |
| Hope (2026) | AMZN WEB-DL, 1080p | 1 | not measured | clean | provenance |

The probe separates the corpus with no errors: the highest clean file recovers 0.599 Mbps and the
lowest grain file recovers 1.311, a 2.19× margin whose geometric mean is 0.886. The gate alone gets
six of nine, and all three of its errors are false positives on disc rips — which the probe then
corrects, and which cost only probe time rather than a wrong encode.

Two files carry most of the evidence and both contradict the obvious heuristic. The Green Mile is
35mm from 1999 and needs no grain, because a 4K source downscaled to a 1080p ceiling loses most of
its grain to the scaler before SVT-AV1 sees it. Star Wars is 35mm from 1977 and does need it, at a
saved *percentage* of 14.94% — below three of the clean files.

## Acceptance Criteria

- [ ] **AC-1**: With `grain_auto_enabled` on and a film on `INHERIT` whose source is a 35mm-era disc
      remux, encoding it logs one line naming both stages, and the resulting `-svtav1-params`
      contains `film-grain=8:film-grain-denoise=1`.
- [ ] **AC-2**: With the same settings and a modern WEB-DL source, encoding it logs that the gate
      refused, `docker compose logs worker` shows no probe encode, and the command contains
      `film-grain=0` with no `film-grain-denoise` term.
- [ ] **AC-3**: A source that passes the gate but whose probe measures an absolute saving below the
      threshold encodes with `film-grain=0`, and the log line carries the measured bitrate, saved
      percentage and absolute saving that produced the refusal (REQ-7, REQ-10).
- [ ] **AC-4** *(failure path)*: With a probe deliberately broken — an unwritable scratch directory,
      an `ffmpeg` that exits nonzero, or a source truncated below the probe's sampling window — the
      encode still completes, writes its file, produces `film-grain=0`, and logs exactly one warning
      naming the failure. `bin/mysql -e "select status from process_jobs where id = <id>"` reads
      `COMPLETED` (NFR-1).
- [ ] **AC-5** *(failure path)*: Deleting a source through `downloadDelete` while its probe is the
      running process terminates that process, leaves no probe scratch file under the downloads
      root, and reports no outcome for the job — `047`'s existing guarantee, unchanged (NFR-2).
- [ ] **AC-6**: Encoding a season pack of N episodes spawns the probe once; the remaining N−1 jobs
      log that they reused the source's verdict, and all N produce the same grain parameters. A
      worker restart between two of those jobs probes once more and the verdict is unchanged
      (REQ-9).
- [ ] **AC-7**: A film whose own Grain Optimization is `on` encodes with the grain parameters and
      logs no gate score and no probe; the same film set to `off` encodes with `film-grain=0` and
      likewise runs neither stage (REQ-2).
- [ ] **AC-8** *(failure path)*: With `compression_enabled` off, encoding a film left on `INHERIT`
      in an installation whose `grain_auto_enabled` is on produces no FFmpeg invocation at all, no
      probe process, and no grain or gate line anywhere in the worker log (NFR-4).
- [ ] **AC-9**: Two copies of one source, one named with its year and provenance and one renamed to
      `mipeli.mkv` in a bare directory, both registered to the same title, produce the same gate
      score on the year signal (REQ-5).
- [ ] **AC-10**: `bin/cli worker npx --no tsc --noEmit` passes and `bin/npm worker test` shows the
      `services/worker/ffmpeg/` case corpus still running every case green, proving
      `buildFfmpegCommand` stayed synchronous and pure, with each case now passing `filmGrain: false`
      where it passed `grainMode: 'OFF'` (NFR-5).
- [ ] **AC-11**: `bin/comments worker` passes, confirming the thresholds carry spec locators rather
      than explanatory comments (NFR-6).
- [ ] **AC-12**: A film registered as a short whose gate passes encodes with `film-grain=0`, logs
      that it resolved on the gate alone, and spawns no probe process; an episode of the same
      duration, with the same gate score, does run the probe (REQ-11).
- [ ] **AC-13**: Raising the probe threshold constant above a known grain title's measured saving
      and re-encoding it produces `film-grain=0`, with the log line showing the same measured
      saving and the new threshold — the value is tunable without touching any other rule (REQ-7).
- [ ] **AC-14**: `encodeJobDetails` for a film flagged short returns `isShort: true`, the same query
      for an episode of a series returns `false`, and flipping the flag from the film's detail page
      (`setMovieShort`) changes the field on the next query (REQ-12).
- [ ] **AC-15** *(failure path)*: A worker given a payload with `isShort` absent — the field stripped
      from the response, as an `api` older than this feature would send — probes the film as if it
      were a feature, logs the fallback once, and completes the encode (REQ-12).
- [ ] **AC-16**: The same source encoded once with `compression_resolution` at `4k` and once at
      `1080p` logs the same probe measurement, taken at a 1080p box both times, and produces the
      same grain parameters (REQ-8).

## Out of Scope

- **Pixel-statistics grain measurement.** A temporal-difference detector was built, measured against
  this corpus and retired: its classes overlap, so no threshold separates them, and it misses half
  the verified positives. It is not a fallback, a cross-check or a cheap pre-filter — as a pre-filter
  it costs more probe time than it saves. It must not be reintroduced without a corpus showing
  separability.
- **Persisting or displaying the verdict.** The decision lives in the worker log and nowhere else.
  Surfacing "why did this title get grain" in `web`, or caching a verdict across worker restarts,
  would require `api`, a column and a contract — a different feature, justified by a user asking for
  it rather than by anticipation.
- **A per-title or per-content-kind grain strength.** `film-grain=8` stays the single constant `092`
  chose. This feature decides whether, never how much.
- **Re-deciding for a file already encoded.** Article XII: the library is never rewritten. A verdict
  applies to the encode that asked for it and to nothing already on disk.
- **Probing shorts.** REQ-11 refuses them on the catalog flag. The probe's cost is fixed while the bytes it
  recovers scale with runtime, so spending the same minutes on a ten-minute short as on a three-hour
  film buys a fraction of the saving. If shorts turn out to be worth it, the change is one condition.
- **A threshold per compression ceiling.** REQ-8 measures at a fixed 1080p box precisely so that
  one number serves every ceiling; a 4K-calibrated threshold separated the same corpus worse and
  cost more per probe.
- **Tuning `grain_auto_enabled`'s default.** It stays off (`092` REQ-2). An installation opts into
  minutes of probing per encode deliberately.

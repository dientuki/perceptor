# Calibration notes: 122-audio-language-detection (worker)

## Image change (T001)

| Item | Value |
| :-- | :-- |
| whisper.cpp tag | `v1.9.5` (`d2a764c648779feb36d44363f212a29b00aad1af`) |
| Extra build target | `whisper-vad-speech-segments` (`examples/vad-speech-segments`, present at v1.9.5) |
| VAD model | `ggml-silero-v5.1.2.bin` from `ggml-org/whisper-vad` |
| Model revision | `9ffd54a1e1ee413ddf265af9913beaf518d1639b` |
| Model SHA-256 | `29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf` |
| Install path | `/opt/whisper/ggml-silero-v5.1.2.bin` |
| Binary | `/opt/whisper/whisper-vad-speech-segments` (on `PATH`) |

`whisper-vad-speech-segments` reads flac, mp3, ogg or wav, and prints timestamps in
centiseconds.

## Image size (`perceptor-worker:local-prod`)

| Build | Bytes |
| :-- | :-- |
| Before | 1122716346 |
| After | 1125414397 |
| Delta | 2698051 (about 2.6 MiB) |

## Calibration (T010)

Run on `perceptor-worker:local-prod` built with T009, `whisper-cli ... -l auto --detect-language -t 4`
on this host's CPU. Windows are 30 s, centred at 25/50/75 % of the duration. Fixtures were built in
the scratchpad and are not committed.

### Attempt 1, job 653 (`Fantastic.Four.2005...mkv`, 6329.3 s)

| Stream | Window start (s) | Language | p |
| :-- | :-- | :-- | :-- |
| 1 (DTS-HD MA 5.1, centre channel) | 1567.3 | en | 0.978491 |
| 1 | 3149.7 | en | 0.994832 |
| 1 | 4732.0 | en | 0.763384 |
| 2 (AC3 2.0, commentary, excluded by the gate) | 1567.3 | en | 0.994556 |
| 2 | 3149.7 | en | 0.993962 |
| 2 | 4732.0 | en | 0.984868 |

Stream 1 decides `eng` at threshold 0.8 and a minimum of 2 votes (two votes, the third window is
below the threshold and does not vote).

### Fixtures

| Case | Construction | Attempt 1 (p per window) | Attempt 2 |
| :-- | :-- | :-- | :-- |
| AC-3 | stream 1 as mono 16 kHz, untagged, `volume=0` over the three windows (35 s each) | en 0.366482 on all three (no votes) | VAD finds 828 segments; picker chose starts 98, 3229, 4385; en 0.995200, 0.996984, 0.991872, so `eng` |
| AC-4 | 20 min of sine chords plus pink noise, no speech | en 0.259151, 0.360690, 0.288187 (no votes) | VAD finds 0 speech segments: not valid, so undecided |
| AC-5 | `Taxi (1998).mkv` (French original, 5390.4 s), first audio stream | fr 0.951957, 0.972066, 0.983654 | not run; `fr` maps to `fre`, not the original |

A window of half silence and half speech scored en 0.517548, and a fully silent window en 0.366482
(whisper answers `en` for silence), so the probability threshold is what rejects silence; the
language line is never an indication of speech.

### Cost

| Step | Time | Size |
| :-- | :-- | :-- |
| Window extraction (30 s, from the MKV) | 0 to 1 s | 960 KB WAV each |
| `whisper-cli --detect-language` per window | about 9 s | |
| Attempt 1 per candidate | about 30 s | |
| Whole-stream extraction to 16 kHz mono WAV (6329 s) | 148 s | 202.5 MB |
| `whisper-vad-speech-segments` on that WAV | 35 s | |
| Attempt 2 per candidate | about 3.5 min (148 + 35 + 3 x 9 s) | 202.5 MB temporary |

Job 653 has one candidate (stream 2 is excluded as a commentary): about 30 s with attempt 1
alone, about 4 min when attempt 2 also runs.

### Proposed constants

`VOTE_THRESHOLD = 0.8`, `MIN_VOTES = 2`, unchanged from the starting values. Every case resolves as
the spec requires: job 653 and AC-3 decide `eng`, AC-5 decides `fre`, AC-4 stays undecided. The
largest non-speech probability observed is 0.366482 (silence) and 0.360690 (music); the lowest
probability of a window with speech that still votes is 0.924003 (half speech) and 0.978491 on job
653. The one real-speech window below 0.8 (0.763384) loses its vote and the candidate is still
decided by the other two. No constant changed, so T011 is a no-op and `DETECTOR_REVISION` stays 1.

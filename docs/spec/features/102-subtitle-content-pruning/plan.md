---
title: Subtitle Content Pruning — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-10-24
status: Approved
---

# PLAN: Subtitle Content Pruning (`plan.md`)

## Approach

One service, `worker`, in the same shape as `098`/`099`: a resolver in the encode driver
(`src/encode/encode.ffmpeg.ts`) does the only I/O, a pure module decides, and the decision reaches
`buildFfmpegCommand` (`src/ffmpeg/buildCommand.ts`) as an extra, required argument — the way
`filmGrain` and `trimAt` already do — so the command builder and the `services/worker/ffmpeg/` case
corpus stay synchronous and spawn nothing.

What is reused rather than rebuilt:

- **The S1–S5 selection inside `getSubtitleParams`** (`src/ffmpeg/params.ts`) is *extracted* into an
  exported `selectSubtitleStreams(...)`, exactly as `099` extracted `selectAudioStreams` from
  `getAudioParams`. The resolver calls it to learn which tracks are candidates; `getSubtitleParams`
  calls it to build the arguments. One selection, two callers — the resolver can never read a
  different candidate set than the one the command maps.
- **C0 is not a new stage** (spec REQ-2, user decision): it widens the existing candidate filter in
  that same function, beside S1–S3, using the existing word-boundary matcher `titleMarks`
  (`src/ffmpeg/variants.ts`) and `disposition.comment`.
- **`runFfmpegCapture`** (`src/ffmpeg/capture.ts`) — the AbortSignal-aware spawn already shared by
  grain-probe, dub-trim, stream-end-trim and the disc remux — gains an option for additional output
  pipes, so every candidate track comes out of **one** FFmpeg pass (spec NFR-2), each SRT on its own
  file descriptor (`pipe:3`, `pipe:4`, …), with nothing written to disk (spec REQ-4). A second spawn
  helper is not written (Article X).
- **The verdict cache** follows `dub-trim.ts`'s module-level `Map` keyed by input path (spec NFR-3:
  a season pack has many files; a failure is never cached).

The alternative considered for extraction — one FFmpeg per track on `pipe:1` — is simpler to code
but makes the pass count grow with the number of tracks, which REQ-4/NFR-2 rule out; it was measured
at 0.2 s per pass, so the cost is not the reason, the spec's bound is. A single Matroska stream to
stdout was rejected because it would mean parsing Matroska in the worker.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `worker` (`src/ffmpeg/`, `ffmpeg/` corpus, rule doc — the `ffmpeg` agent's territory) | the extraction of `selectSubtitleStreams`, C0, the pure C1–C3 module and the new `getSubtitleParams`/`buildFfmpegCommand` argument; everything else consumes them |
| 2 | `worker` (`src/encode/`) | the resolver and its wiring in `encode.ffmpeg.ts` call the step-1 functions |

No other service is touched and nothing runs in parallel with anything outside `worker`. Inside
`worker`, step 1's move-only extraction must land and leave the existing suites green before any
rule changes, so a regression in S1–S5 is never confused with a C-rule.

`src/ffmpeg/` and `services/worker/ffmpeg/` belong to the `ffmpeg` agent (`.claude/agents/ffmpeg.md`),
the rest of `src/` to the `worker` agent; `tasks.md` should route step 1 to the former.

## Contract Freeze

The spec's GraphQL Contract Delta is **None**, frozen as such. Things an implementer will be tempted
to add and must not:

- **Reporting pruning outcomes to `api`** — a `[subs]` log line is the whole surface (spec REQ-13,
  NFR-1). No new `EncodeJobDetails` field, no new mutation, no error key.
- **A Settings switch** — explicitly out of scope; the rules are always on with compression.
- **Snapshotting anything on `ProcessJob`** — the verdict lives in worker memory only.

## Migrations

None.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The resolver and `getSubtitleParams` see different candidate sets | an index dropped by C1–C3 is not the one mapped, or a track the rules never saw is emitted; no error anywhere | both go through the one extracted `selectSubtitleStreams`; a test asserts the resolver's candidate indices equal the indices `getSubtitleParams` maps for a multi-language input |
| The `-t 900` limit placed as an input option | ffmpeg extracts every track whole (measured 2026-10-24) — no error, just the full-file cost on a 60 GB remux | the limit goes on each output; a test asserts the argument order (`-map 0:N -t 900 -c:s srt -f srt pipe:K` per track, after `-i`) |
| An extra pipe left unread, or a pipe's size cap tripped | ffmpeg blocks on a full pipe and the encode never starts | every extra fd is drained concurrently and capped like stdout; past the cap the call rejects and the resolver keeps everything (NFR-1) |
| A text rule fires on weak evidence | a good subtitle is silently gone from the library, discovered weeks later | every rule only drops when the evidence splits the group or proves containment; thresholds sit on the keep side (spec REQ-6/REQ-9); NFR-4 tests pin each "both kept" boundary |
| `NUMBER_OF_FRAMES` read under a different key | C2/C3's whole-track guards silently read "absent" and never collapse anything (the safe direction) or, worse, read a wrong count | read the exact key S3's `hasCuePayload` already reads; absent → C2 never collapses, C3 falls back to sample counts only, as the spec states |
| C0 logs twice | `selectSubtitleStreams` is called by both the resolver and `getSubtitleParams` | the `drop (commentary)` line is printed in `getSubtitleParams` only, not inside the extracted selection (the `099` treatment of the audio warning) |
| Subtitle text committed to a public repository | the films' subtitle text is copyrighted; the repository is AGPL and public | test fixtures are **synthesised** SRTs reproducing the measured shapes (cue counts, annotation shares, timing offsets, containment), never the extracted text; the extracted files stay in the session scratchpad |

## Verification

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments worker
```

This checkout's Compose stack is not the one running on the development host; when `bin/npm`
finds no container, measure from a throwaway container as uid 1000:

```bash
docker run --rm --user 1000:1000 -v "$PWD/services/worker":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c 'npx vitest run && npx --no tsc --noEmit'
```

Manual pass (spec AC-1 … AC-11), on a stack running the new worker image:

1. Build test sources from the calibration files with `mkvmerge` — a 20-minute video slice plus the
   subtitle tracks of How to Train Your Dragon (2025), Wake Up Dead Man (2025) and Atomic Blonde
   (2017) shapes, retitled as in their sources — import each through `/movies` → import, and check
   the output's subtitle tracks with `ffprobe` and the worker log's `[subs]` lines (AC-1, AC-3).
2. The Running Man (2025): its source `ffprobe` (`ffprobe_logs` row 94) as a corpus case covers
   AC-2 offline; live, any source carrying a `Commentary` subtitle track shows `drop (commentary)`.
3. AC-9: run step 1's Dragon source with the extraction made to fail (e.g. `chmod -x` a wrapper the
   test points `ffmpeg` at, or a corrupted subtitle stream) and see all four English tracks.
4. AC-10: delete the source from `/downloads` while the `[subs]` read runs on a large remux; no
   `ffmpeg` process left in `docker compose top worker`.
5. AC-11: with compression off in Settings → Compression, import step 1's Atomic Blonde source; the
   library file keeps every track and the log has no `[subs]` line.

---
title: Automatic Grain Detection — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-17
status: Approved
---

# PLAN: Automatic Grain Detection (`plan.md`)

## Approach

`092` left one seam: `resolveFilmGrain(mode, metadata)` in `services/worker/src/encode/grain-mode.ts`,
called synchronously from inside `buildFfmpegCommand` (`src/ffmpeg/buildCommand.ts:35`). This
feature does not grow that body in place — it cannot, because the probe spawns processes and
`buildFfmpegCommand` must stay synchronous and pure (NFR-5). Instead the seam **moves one call up**,
into the encode driver `src/encode/encode.ffmpeg.ts`, which is already async, already holds the
parsed `ffprobe` output (`getMetadata`, line 20) and the job's `AbortSignal`, and already runs only
on the compressing path. `resolveFilmGrain` becomes async there and returns the boolean;
`buildFfmpegCommand` gains a `filmGrain: boolean` parameter in place of reading `details.grainMode`.

That placement keeps NFR-4 structural for free: `passthrough` (compression off) never enters
`encode.ffmpeg.ts`, and the `mock` driver (`encode.mock.ts`) never resolves grain at all, so no
`if (compressing)` check is added anywhere.

The detector itself is two pieces with opposite properties, kept in two files:

- **The metadata gate** — a pure, synchronous scoring function over the parsed `ffprobe` output and
  three `EncodeInput` fields. It reuses what `src/ffmpeg/remux-detection.ts` already computes
  rather than recomputing it: the rational frame-rate parse, the three-step video bitrate fallback
  and bits-per-pixel-per-frame, all exported from there, plus `isLosslessAudioStream` widened *in
  the gate only* with `flac`/`alac` (widening it in `remux-detection.ts` itself would silently move
  boutique FLAC remuxes from CRF 24 to CRF 22 — a behaviour change this spec does not own). The
  provenance markers are read from the input path the driver already receives — its parent
  directory's name plus its own basename, exactly the string the calibration script reads. Not from
  `EncodeInput.sourceTag`: `046` builds that relative to `downloadPath`, so for a torrent whose
  `downloadPath` is the release folder itself it collapses to the bare filename and drops every
  marker the folder carries, the bug the script already hit once.
- **The encode probe** — a fixed measurement procedure (REQ-6, REQ-8) that spawns FFmpeg: five
  `cropdetect` samples, then nine six-second windows encoded twice at a `min(source, 1080p)` box,
  CRF 22, preset 8, with the job's content-kind parameters. The SVT-AV1 parameter string is built by
  the **same function** `params.ts` uses for the real encode (exported, not copied), so the probe's
  kind terms can never drift from production's. Output goes to `-f matroska pipe:1` and the probe
  counts bytes on stdout: there is no scratch file at all, which makes NFR-2's "no scratch left
  behind" structural rather than a cleanup path to get right.

`services/worker/tmp/etapa1-metadata.sh` and `etapa3-encode-probe.sh` are the reference
implementations every weight, tier and window position is ported from. `etapa2-pixels.sh` is the
retired detector (spec § Out of Scope) and nothing is ported from it.

`api`'s part is one field: `EncodeJobDetails.isShort`, a raw read of `Movie.isShort` beside the
`outputRoot` resolution that already reads it, and the literal `false` for an episode.

**Alternatives rejected.** Resolving grain in `encode.job.ts` instead of the driver would run it
for the `mock` driver too and put a probe before `encodeStarted`; it would also need the `ffprobe`
call duplicated, since only the driver holds it (REQ-3 forbids a second one). Writing probe windows
to files would match the calibration script byte for byte, but the difference between a seekable and
a piped Matroska header is a few hundred bytes on windows of megabytes, and it buys a cleanup path
plus a writable-directory dependency.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Exposes `EncodeJobDetails.isShort`. Small and independent |
| 1 | `worker` | **Parallel with step 1, except one task.** The refactors, the gate, the probe and the orchestration consume nothing new from `api`. The one task that adds `isShort` to the worker's `processJob` query waits for `api`: selecting a field the schema does not have is a GraphQL validation error that fails the whole query, not an absent field — REQ-12's fallback covers a response missing the field, never a query asking for an unknown one |
| 2 | `[docs]` | `graphql-contract.md`, `services/worker/CLAUDE.md`'s grain section, root `CLAUDE.md`'s Transcode row (which still calls the AUTO path a stub), `history.md` — after both slices, from what actually landed |
| 3 | `[orch]` | Re-measure the calibration corpus at CRF 22 and refit the provisional threshold (REQ-7) — needs step 1's worker slice, not only the shell script, to confirm the TypeScript port measures what the script measured |

## Contract Freeze

`spec.md` § GraphQL Contract Delta is frozen as of `status: Approved`. The things an implementer
will want to change and must not:

- **`isShort` is the raw column, not the effective destination.** From inside `api`,
  `movie.isShort && isShortsEnabled()` looks like the "correct" value because it is the one
  `outputRoot` already computes two lines above. It is wrong for this field: the probe is skipped on
  runtime, not on folder (REQ-12). A film flagged short in an installation with shorts disabled
  reports `true`.
- **`isShort` is non-null and `false` for episodes** — not nullable, not omitted. The worker must
  not infer "episode" from `isShort` and must not read `kind` for REQ-11; `isShort: false` alone is
  what makes an episode probe.
- **No `kind` or duration logic in the worker for shorts.** The earlier draft derived shorts from
  `kind === 'MOVIE'` plus a forty-minute duration. That rule is gone; reintroducing it as a
  "fallback" for an absent `isShort` contradicts REQ-12's fallback, which is `false`.
- **`grainMode` is unchanged on the wire.** The worker still receives `AUTO`/`ON`/`OFF`; only where it
  is resolved moves.

## Migrations

**None.** `Movie.isShort` exists since `048`. The verdict is never stored.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Unit slip between bytes, bits, seconds and Mbps in the saved-bitrate computation | **Silent.** Off by 8× or 10⁶×: every title passes or every title fails, with plausible-looking log lines | The arithmetic is a pure function with a unit test pinned to one real corpus row (Lionheart: 76 198 923 B over 9 × 6 s, 24.55% → 2.771 Mbps) |
| `avg_frame_rate` parsed with `Number()` | **Silent.** bpppf is `NaN`, every bpppf tier compares false, the gate loses its strongest signal on every file | Reuse `remux-detection.ts`'s parser, exported; gate test with `"24000/1001"` |
| The probe measures at the job's ceiling instead of 1080p | **Silent.** 0.886 means something different under each ceiling; a 4K installation synthesizes grain on nearly everything | The box is a constant, not derived from `compressionResolution`; probe test asserts the same `-vf` for a `4k` and a `1080p` job (AC-16) |
| NFR-1's catch-all swallows cancellation | A deleted source's job resolves "no grain" and goes on to start the real encode | `EncodeCancelledError` is rethrown before the fallback; `runner.ts` also refuses an already-aborted signal, so this is a second line, not the only one. Orchestration test |
| A failed probe is cached for the whole pack | **Silent.** One transient FFmpeg failure on episode 1 denies grain to every episode | Only definite verdicts enter the cache; failures and cancellations do not. Orchestration test |
| Probe kind parameters drift from `params.ts` | **Silent.** The probe measures a different encoder configuration from the one that ships | Both build the `-svtav1-params` string through one exported function |
| `isShort` sent as the effective value | **Silent.** A short in a shorts-disabled installation burns minutes of probing | `process-jobs.service.spec.ts` case with shorts disabled and `isShort: true` |
| Threshold is provisional (fitted at CRF 24, probe runs at CRF 22) | Wrong verdicts near the boundary until refitted | The feature ships behind `grain_auto_enabled`, default off (`092`). Step 3 refits it before anyone is told to turn the switch on |
| The job reads `ENCODING 0%` for the whole probe (456–837 s measured) | Looks hung; a user may delete a healthy job | One `[grain]` log line at probe start naming the expected work. Reporting probe progress is not in the spec and is not added here |
| Run-to-run variance of the probe | The maintainer's 1080p run at CRF 24 gave a 1.82× margin where the table predicts 2.44× for the same files | Step 3 runs each corpus file twice and records the spread beside the refit |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments api && bin/comments worker
git status --short services/api/prisma
git diff services/api/src/schema.gql
```

`git status --short services/api/prisma` must show nothing. The `schema.gql` diff must be exactly
one added `isShort: Boolean!` on `EncodeJobDetails` (Article VIII's Check).

The manual pass, against `bin/dev` with `ENCODE_DRIVER=ffmpeg` (the default `mock` driver never
resolves grain) and `grain_auto_enabled` on:

1. Encode a 35mm-era disc remux left on *inherit*: one `[grain]` line naming the gate score and the
   probe's bitrate, saving and saved Mbps; `-svtav1-params` carries
   `film-grain=8:film-grain-denoise=1` (**AC-1**).
2. Encode a modern WEB-DL: the gate refuses, no probe FFmpeg appears in `docker compose logs worker`,
   the command has `film-grain=0` and no denoise term (**AC-2**). Encode *The Green Mile* or
   *Tenet*: the gate passes, the probe refuses, the log carries all three figures (**AC-3**).
3. With `ENCODE_SAMPLE_SECONDS` unset, point a job at a source truncated to 20 s: encode completes,
   `film-grain=0`, exactly one warning, `bin/mysql -e "select status from process_jobs where id =
   <id>"` reads `COMPLETED` (**AC-4**).
4. Start an AUTO encode of a gate-passing source and `downloadDelete` it while the probe runs: the
   probe FFmpeg exits, nothing new under the downloads root, no outcome reported (**AC-5**).
5. Encode a season pack: one probe, N−1 "reused" lines, identical grain terms. `docker compose
   restart worker` between two episodes: one more probe, same verdict (**AC-6**).
6. Set a film to **on**, then **off**: neither stage runs either time (**AC-7**). Turn
   `compression_enabled` off and encode an *inherit* film: no FFmpeg, no `[grain]` line (**AC-8**).
7. Register the same release twice, once renamed `mipeli.mkv` in a bare folder: same year signal in
   the gate line (**AC-9**).
8. Flag a film as a short (`setMovieShort`) and query `processJob(id) { isShort }`: `true`; for an
   episode job, `false` (**AC-14**). Encode the short with a gate-passing source: "resolved on the
   gate alone", no probe (**AC-12**).
9. Hand-edit the worker's query to drop `isShort`: the short probes, one fallback warning, the encode
   completes (**AC-15**).
10. Encode one source with `compression_resolution` at `4k`, then at `1080p`: the same probe figures
    and the same `-vf` in both probe commands (**AC-16**).
11. Raise the probe threshold constant above Lionheart's measured saving, re-encode: `film-grain=0`,
    same measurement, new threshold in the log (**AC-13**).

AC-10 and AC-11 are the `bin/npm worker test` and `bin/comments worker` lines above.

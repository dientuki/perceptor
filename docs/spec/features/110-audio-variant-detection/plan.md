---
title: Audio Variant Detection — Implementation Plan
spec_version: 0.3.0
last_updated: 2026-10-29
status: Approved
---

# PLAN: Audio Variant Detection (`plan.md`)

## Approach

The feature has three layers. `api` stores a per-user switch. `web` shows the switch. `worker` gains
one more pre-encode resolver in the encode driver, whose verdict is persisted by `111`'s
encode-verdict store (Redis, worker-only). `111` ships first.

**api.** `User.audioVariantDetection` follows the shape of `subtitleSearch` (`103`):
`UsersService` writes it, `PreferencesService.findForUser` reads it, and `preferences.resolver.ts`
exposes `setAudioVariantDetection` next to `setSubtitleSearch`. `Language.hasRegionalVariants` is
computed by `LanguagesService`'s two `Language` builders (`toLanguage` and the catalog map) from one
read of the `languages` table, so every `Language` the schema returns carries it, wherever it
appears. The effective opt-in (REQ-4) extends the owners select that
`mergeMovieAllowedLanguages`/`mergeShowAllowedLanguages` in `process-jobs.service.ts` already make.
It adds `user.audioVariantDetection` and decides per owner from the same `languages` rows
`collectAllowedLanguages` walks. That keeps it one merge and one read, never a second query path.

**worker.** It follows the `094`/`098`/`099`/`102` pattern exactly. A resolver,
`resolveAudioVariants`, runs in `encode.ffmpeg.ts` after `resolveSubtitlePruning`, on the
compression path only. It returns an `AudioVariantResolution` (decided tags plus streams to drop as
duplicates), which reaches `buildFfmpegCommand` as a
new required argument, so the command stays pure. Inside `src/ffmpeg/`, the map overrides
`detectVariant` for those streams only. Narrowing (`narrowToVariants` already takes a `detect`
parameter) and titling (`trackLanguageTitle`) then read the decided variant as if the title had
carried the marker. The resolver reads and writes its verdict through `111`'s store, as one more
verdict kind keyed by the input file (path, size, mtime), the detector's `iso3` and the two candidate
stream indices. No `EncodeFn` callback and no GraphQL call is involved.

**The engine is whisper.cpp, not faster-whisper.** The worker image is `node:…-alpine` (musl).
CTranslate2, which faster-whisper depends on, ships no musllinux wheels, so it would mean compiling
CTranslate2 from source inside the image, a far heavier build than whisper.cpp's single CMake
target. whisper.cpp builds in a dedicated Dockerfile stage at a pinned release tag, and only its CLI
binary is copied into `base`. A quantized multilingual model is fetched at build time from a pinned
URL and checked against a pinned SHA-256 (NFR-1). openai-whisper is ruled out by the measurement in
`spec.md`.

**The lexical scorer is not a track-selection rule.** It is pure (text in, score out) and lives in
`src/encode/` as worker-agent code. Only the map it produces enters `src/ffmpeg/`, and that consuming
edge belongs to the `ffmpeg` agent (`.claude/agents/ffmpeg.md` § Scope). Per REQ-11, detectors are a
registry keyed by `iso3`, and Spanish is the one entry.

**Alternative rejected: an `api` table (`AudioVariantVerdict`) plus a service-token mutation.** It
was the 0.1.0 design. `111` gives every pre-encode verdict one persistent store in Redis, so a second
mechanism just for this verdict would break `111` NFR-6. Losing verdicts on `bin/dbreset`/`FLUSHALL`
only costs a re-detection.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 0 | `worker` (`111`) | The encode-verdict store this feature writes into. Implemented as its own feature first |
| 1 | `api` | Owns the migration, `EncodeJobDetails.audioVariantDetection` and `setAudioVariantDetection`. `web` and `worker` read through them |
| 2a | `web` | Needs `UserPreferences.audioVariantDetection`, `Language.hasRegionalVariants` and `setAudioVariantDetection` to exist |
| 2b | `worker` (engine + resolver) | The image stage and the scorer can start as soon as the contract is frozen. The resolver needs `111`'s store; only the end-to-end run needs step 1 live |
| 2c | `ffmpeg` agent (`src/ffmpeg/`) | Consumes the verdict map in selection and titling. Independent of 2b once the `AudioVariantResolution` parameter shape below is fixed |
| 3 | `worker` (wiring) | `encode.job.ts` reads the new `EncodeJobDetails` field; `encode.ffmpeg.ts` joins 2b and 2c |
| 4 | `[docs]`/`[verify]` | Corpus run on the three films, the time measurement (AC-11), and the `CLAUDE.md` and `ffmpeg.md` updates |

2a, 2b and 2c run in parallel once the spec is Approved: the contract is frozen, and the
2b ↔ 2c seam is the single map parameter named here.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will be tempted to change, and must not:

- **An undecided verdict is stored, not skipped** (REQ-8). Skipping it makes every crash or retry
  re-run 10 minutes of transcription on a file already known to be undecided.
- **The verdict's identity is the input file, never the `MediaSource`.** A season pack shares one
  `MediaSource` across episodes, so keying on it would hand one episode's verdict to the next.
- **`setAudioVariantDetection(true)` with no variant language is accepted.** `web` disables the
  checkbox, but `api` must not add a refusal. REQ-2 keeps the stored value inert, not rejected.
- **The worker reads a missing `audioVariantDetection` as `false`.** That is the mixed-version
  posture. It must never throw on it.
- **The resolution shape between `src/encode/` and `src/ffmpeg/`** is
  `AudioVariantResolution = { tags: ReadonlyMap<number, string>; duplicates: ReadonlySet<number> }`.
  `tags` maps an ffprobe stream index to its decided variant tag and holds decided streams only; an
  undecided stream is simply absent. `duplicates` holds the stream to drop when the verdict is
  duplicate (REQ-6b); the resolver, not `src/ffmpeg/`, picks which one. This is internal to the
  worker, not GraphQL, but two agents write either side of it.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, and re-brief `api`,
`web` and `worker` (Constitution, Article VIII).

## Migrations

1. `<timestamp>_audio_variant_detection`, one migration:
   `ALTER TABLE users ADD audioVariantDetection BOOLEAN NOT NULL DEFAULT false`.
2. Backfill: none (NFR-4). Every existing user reads `false`.

Reversibility: dropping the column loses only the opt-ins. Nothing else reads it.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A decided verdict is wrong, so the user gets the **other** dub, titled as the one they asked for | Silent: the file plays, labelled `Latino`, and it is Castilian. Worse than today's duplicate `Español`, which at least signals doubt | The margin threshold is tuned on the three-film corpus (AC-1 to AC-3) and set conservatively. Undecided is the default on any ambiguity (NFR-5). A human listening check is part of AC-2/AC-3 |
| A duplicate verdict drops a stream that was a different dub | Silent: the user loses a dub with no error anywhere | The similarity threshold sits well above the different-dub corpus (0.40/0.45) and below the identical pair (0.89); `audio-variant-score.spec.ts` asserts It Chapter Two and Interstellar are never duplicate |
| `buildFfmpegCommand` gains the map but a call site passes an empty one | Silent: detection runs and caches, and selection never sees it | The parameter is **required** (not optional), and `encode.ffmpeg.ts`'s spec asserts the resolver's map reaches the command builder |
| The verdict is never written to `111`'s store | Silent: the encode works, every retry re-transcribes | `audio-variant.spec.ts` asserts the store write for both decided and undecided verdicts |
| The verdict is read for the wrong file | A season-pack episode reads another episode's verdict | The key includes the input file's path, size and mtime (`111` REQ-3); the resolver spec asserts a different file misses |
| Whisper hallucinates repeated lines on music or screaming scenes | Inflates one track's score | Repeated identical lines are dropped before counting (REQ-6), as in the prototype. The scorer spec covers it with the It Chapter Two transcript shape |
| The model download at image build is unpinned or changes upstream | Detection drifts silently across releases | A pinned URL plus a pinned SHA-256 check in the Dockerfile stage. The build fails on a mismatch |
| The arm64 image build of whisper.cpp fails or is slow | The release breaks on one arch only (`083` builds each natively) | Build with CMake default CPU flags (no `-march=native`) and verify both arches in the release run |
| Detection ignores the stop/delete signal | A stopped encode keeps a 16-thread transcription running for minutes | The resolver kills the child on `abort` (SIGTERM, then SIGKILL), the same as `runner.ts`. AC-7 checks it live |
| The 10-minute budget is missed on slower hosts | The encode is delayed. Not an error, but the user sees ENCODING at 0 % for long | `plan.md` fixes the window count and the model after measuring on the reference host (AC-11). Progress stays at 0 by design (REQ-12), and the log names the stage |
| Rule L1 in `ffmpeg.md` says a title must not depend on who triggered the encode | Here the `Latino` title appears only when an owner opted in | Accepted by REQ-4/REQ-7. `ffmpeg.md` § L1 is amended to say that **metadata** labelling stays unconditional and audio-derived labelling is gated by the opt-in |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
bin/comments api
git diff services/api/src/schema.gql          # exactly spec.md § GraphQL Contract Delta
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments web
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments worker
bin/build prod worker
docker run --rm perceptor-worker:local-prod /opt/whisper/whisper-cli --help
```

Manual pass, on the dev stack with `bin/build dev worker` done first:

1. In `/preferences`, with only `en` in audio, the checkbox is disabled with the hint. Adding
   `es-419` enables it. Check it, save and reload: it reads checked (AC-8).
2. Copy It Chapter Two's library file into an import, import it for a film owned by that user, and
   let it encode. The worker log shows `[variant] spa 2:<score> 3:<score> → 2=es-ES 3=es-419`. The
   output has one Spanish track, titled `Latino Surround 5.1 (Opus)`, sourced from stream 3.
   `bin/cli redis redis-cli --scan --pattern 'perceptor:encode:*'` lists the verdict key (AC-1). Repeat for
   Interstellar (listen to a minute of each output track, AC-2) and Jurassic Park III (one Spanish
   track left, `Español`, AC-3).
3. Re-run step 2 and `docker compose kill worker` once the `[variant]` line is logged. After `054`
   recovery, the log shows `[variant] … (reused)` and no `whisper-cli` process. Repeat with Stop and
   Play (AC-5).
4. In a throwaway worker container with the model file removed, the encode completes with both
   tracks titled `Español`, `[variant] detection failed: …` is logged, and no verdict key is
   written (AC-6).
5. During `[variant]` detection, delete the source from `/downloads`. `docker compose exec worker ps`
   shows no `whisper-cli` within a few seconds, and no verdict key is written (AC-7).
6. With the preference off (AC-9) and with compression off (AC-10), there is no `[variant]` line and
   no verdict key.
7. A file whose tracks are titled `Latino`/`Castellano` produces no `[variant]` line (AC-4). A file
   decided undecided keeps two `Español` tracks (AC-4b).
8. `docker compose stop redis`, then encode AC-1's file. Detection runs, the verdict applies, the
   store error is logged and the encode delivers (AC-12).
9. Record the `[variant]` wall time from step 2 in `worker/plan.md` (AC-11).

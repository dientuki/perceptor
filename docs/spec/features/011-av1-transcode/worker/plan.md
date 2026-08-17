---
title: AV1 Transcode — worker slice
service: worker
last_updated: 2026-08-17
status: Implemented            # Draft | Approved | Implemented
---

# PLAN: AV1 Transcode — `worker` (`worker/plan.md`)

## Scope

This slice owns every decision about what ends up in the output file: which audio tracks survive and
in what format, which subtitles survive, and what CRF the video is encoded at. It consumes the
allowed-language list `api` has already merged and resolved — it never computes that list, never
queries the database, and never reads an environment variable to find one (Article III, Article V).

It does **not** touch `src/ffmpeg/runner.ts`, the working-path/part-path/rename sequence, the signal
handling or the progress parsing. None of that changes. It does not touch `src/encode/encode.mock.ts`
beyond whatever the shared `EncodeFn` type requires — the mock ignores the encode details by design
and must keep working (NFR-5).

Writes are confined to `services/worker/` and this directory. Anything else is a stop-and-report
(see `.claude/agents/worker.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/jobs/encode.job.ts` | Modified | `EncodeJobDetails` gains `allowedLanguagesIso3`; the `processJob` query selects it; it is forwarded into `encode()` |
| `services/worker/src/encode/types.ts` | Modified | `EncodeInput` gains `allowedLanguagesIso3: string[]` |
| `services/worker/src/ffmpeg/params.ts` | Modified | `getAudioParams`/`getSubtitleParams` take the resolved list; `getQuality`'s animation branch restored; the missing-original failure |
| `services/worker/src/ffmpeg/buildCommand.ts` | Modified | `quality` decided from the probe result, not the filename; forwards the language list |
| `services/worker/src/ffmpeg/remux-detection.ts` | New | `isRemux(metadata)` — the REQ-10 rules, extracted so it is testable on its own |
| `services/worker/src/ffmpeg/iso639.ts` | New | ISO-639-2/B ↔ /T normalization (see step 4) |
| `services/worker/src/ffmpeg/params.spec.ts` | New | See § Tests |
| `services/worker/src/ffmpeg/buildCommand.spec.ts` | New | See § Tests |
| `services/worker/src/ffmpeg/remux-detection.spec.ts` | New | See § Tests |

## Existing code to reuse

- **`src/encode/types.ts`'s `EncodeInput`** — already the deliberate *subset* of `EncodeJobDetails`
  that the driver needs, retyped locally rather than imported. Add the new field there in the same
  spirit; do not import the job's type into the ffmpeg layer.
- **`src/ffmpeg/metadata.ts`'s `getMetadata`** — the `ffprobe` call, already using `execFile` (no
  shell) and already propagating the real cause. Remux detection reads its output; do not add a
  second probe call, the metadata is already in hand by the time `buildFfmpegCommand` runs.
- **`getSubtitleParams`'s `s.tags?.BPS` read** (`src/ffmpeg/params.ts`) — the precedent that
  per-stream bitrate in an MKV lives in `tags.BPS` when `stream.bit_rate` is absent. Remux detection
  uses the same fallback chain rather than inventing one.
- **`src/api/graphql-client.ts`** — throws on `json.errors`. Nothing here may catch-and-log around
  it; a swallowed error is this service's central failure mode (`services/worker/CLAUDE.md`).
- **`handleEncode`'s existing `try`/`catch` → `encodeFailed`** (`src/jobs/encode.job.ts`) — the
  REQ-6 failure needs no new plumbing. Throw from the rule function, let it propagate, and the
  existing catch reports it with the message intact.
- **`vitest.config.ts` and `src/api/graphql-client.spec.ts`** — the test runner is already wired and
  there is already one real suite. `services/worker/CLAUDE.md`'s "no tests, and no vitest.config.ts"
  note is stale; correcting it is part of the `docs` work, not this slice.

## Steps

1. **Plumb the field.** Add `allowedLanguagesIso3: string[]` to `EncodeJobDetails` in
   `encode.job.ts`, add it to the `processJob(id)` GraphQL document, and pass it through the
   `encode(...)` call's details object alongside `originalLanguageIso3` and `isLiveAction`. Add it
   to `EncodeInput` in `encode/types.ts`. **Both files, or the field arrives `undefined` and the
   rule functions silently behave as "original only".**
2. **`getQuality`.** Restore the animation branch: `if (!isLiveAction) return "20"` first, then
   `remux → "22"`, then `"24"`. Delete the commented-out copy rather than leaving both.
3. **`remux-detection.ts`.** `isRemux(metadata): boolean` implementing REQ-10 — true when any audio
   stream is `truehd`, `mlp`, `pcm_*`, or `dts` with a profile containing `DTS-HD MA`; or when
   bits-per-pixel-per-frame ≥ 0.25. The bitrate comes from the video stream's `bit_rate`, then its
   `tags.BPS`, then `format.size / format.duration`. **The frame rate is `avg_frame_rate`, a
   rational string like `"24000/1001"` — parse the fraction, do not `Number()` it.** When no bitrate
   at all can be computed, fall back to the filename substring check that `buildCommand.ts` does
   today; that is the only place the filename may still be consulted.
4. **`iso639.ts`.** The `languages` table is seeded with ISO-639-2/**B** codes, and Matroska files
   commonly tag the same languages with /**T**: `fre`/`fra`, `ger`/`deu`, `chi`/`zho`, `dut`/`nld`,
   `cze`/`ces` among the 20 seeded. Export a `normalizeIso3(code): string` that maps both members of
   each pair to one canonical form, and apply it to **both sides** of every language comparison in
   `params.ts`. Without this a French track the user asked for is present, never matches, and is
   silently dropped. This table is worker-local and is *not* a contract change.
5. **`getAudioParams`.** Change the signature to take the allowed list plus the mandatory original,
   instead of deriving `[original, 'spa', 'eng']`. Keep, unchanged: the blacklist
   (`commentary`/`description`/`visual`/`sdh`), the `latin`/`latino` narrowing for Spanish, the
   codec → channels → bitrate ranking, and the Opus bitrate/`channelmap`/`mapping_family`/metadata
   emission. **Remove the copy-all fallback**: when no track in the original language survives
   filtering, throw an `Error` reading
   `El archivo no tiene ninguna pista de audio en el idioma original (<iso3>)`. An allowed language
   with no track is *not* an error — log it and continue (REQ-7).
6. **`getSubtitleParams`.** Same signature change. Keep the text-codec filter, the `BPS > 2` rule
   and the title-replacement rule. It already returns `[]` when nothing qualifies; that stays a
   normal outcome, never an error.
7. **`buildFfmpegCommand`.** Replace the filename-based `isRemux` with a call to
   `isRemux(metadata)`, and forward `details.allowedLanguagesIso3` into both rule functions. The
   argument order in the assembled array does not change.
8. **Tests.** Three new spec files, per § Tests below.

## Contract obligations

This slice consumes one new field from `../spec.md` § GraphQL Contract Delta:

- `EncodeJobDetails.allowedLanguagesIso3: [String!]!` — ISO-639-2, already deduplicated, the
  original language always first, **never empty**. `api` guarantees non-emptiness; do not code a
  "what if it's empty" branch that would quietly re-derive a default.

`originalLanguageIso3` stays on the payload and stays the source of truth for which language is
mandatory. Do not infer it from `allowedLanguagesIso3[0]`.

There is no codegen across this boundary. The field must be added by hand in **two** local types
(`encode.job.ts` and `encode/types.ts`) *and* selected in the GraphQL document — miss any one and
nothing fails to compile.

The REQ-6 failure travels back through the existing `encodeFailed(processJobId, errorMessage)`
mutation. No new GraphQL surface, no new mutation.

The delta is read-only. If it is wrong, stop and report (Article VIII).

## Tests

This is the slice Article IX exists for. A wrong argument in these three files produces a
`ProcessJob` marked `COMPLETED` and a file with the wrong audio, the wrong CRF, or missing
subtitles — with no error in any log, and the user only finding out while watching.

- **`src/ffmpeg/params.spec.ts`** — defends against silently dropping or keeping the wrong audio
  track. Cases: given three allowed languages and tracks for all three, exactly three `-map`
  arguments are emitted; an allowed language with no track is omitted without throwing; a track
  titled `Director's Commentary` is never selected; between a `truehd` 5.1 and an `eac3` 7.1 in the
  same language the `truehd` wins (codec outranks channels); between two Spanish tracks the
  `Latino`-titled one wins; a file with no track in the original language **throws**, and the
  message contains the `iso3`; a language given as `fra` matches an allowed `fre` and vice versa;
  PGS subtitles produce zero subtitle arguments; a subtitle with `BPS` of `1` is dropped; an
  ALL-CAPS subtitle title is replaced.
- **`src/ffmpeg/remux-detection.spec.ts`** — defends against every file classifying the same way.
  Cases: a `truehd` track alone makes it a remux; a 1080p stream at 30 Mbps with
  `avg_frame_rate: "24000/1001"` is a remux (**this is the case that fails if the rational string is
  `Number()`-ed** — it must be verified to fail against that mistake); an 8 Mbps 1080p web-DL is
  not; a UHD stream at 60 Mbps is; bitrate absent from `bit_rate` is read from `tags.BPS`; absent
  from both, from `format.size`/`duration`; absent from all three, the filename decides.
- **`src/ffmpeg/buildCommand.spec.ts`** — defends against the CRF landing on the wrong value.
  Cases: `isLiveAction: false` yields `-crf 20` even on a remux; a live-action remux yields
  `-crf 22`; a live-action web-DL yields `-crf 24`; `ENCODE_SAMPLE_SECONDS` still appends `-t`; the
  allowed-language list reaches the audio arguments.
- **Not owed**: `src/ffmpeg/runner.ts` (unchanged by this feature; its failure modes are loud —
  a non-zero exit code, a missing temp file), `src/ffmpeg/metadata.ts` (unchanged), and
  `src/encode/encode.mock.ts` (a test fixture itself).

Each new spec file opens with a comment naming the failure it prevents. English `it(...)` strings
(Article VI). No mocking of `ffprobe` — the fixtures are plain metadata objects, which is what these
functions actually take.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
```

Expected: 0 typecheck errors (it stood at 0 before — it must stay there), and the Vitest run green
with the three new suites. `bin/npm worker test` previously exited 1 with `No test files found`
before `graphql-client.spec.ts`; it must now pass, not merely stop complaining.

Then, with `ENCODE_SAMPLE_SECONDS` set in `.env` and the stack up, one real encode:
`docker compose logs -f worker` shows the assembled command, and `ffprobe` on the output confirms
the audio stream count, the language tags and the absence of image subtitles (AC-1, AC-2, AC-8).

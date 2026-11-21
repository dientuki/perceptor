---
title: Grouped Provenance Tags — worker slice
service: worker
last_updated: 2026-11-20
status: Implemented
---

# PLAN: Grouped Provenance Tags — `worker` (`worker/plan.md`)

## Scope

The worker writes every Perceptor tag, in three places:

- the global `PERCEPTOR` group of every compressed encode (REQ-4 to REQ-8);
- the per-track group of every subtitle embed (REQ-9 to REQ-11);
- the in-place rewrite of an existing library file for the migration (REQ-14, REQ-16, NFR-1,
  NFR-4), through a new `library-tags` queue and job.

The worker does **not** parse `ffmpegCommand`, decide `BUSY`, resolve a library path or notify the
media server: `api` does all four. It does not change passthrough (REQ-7): `passthrough.ts` stays
untouched.

**Ownership split inside this service.** `src/ffmpeg/` belongs to the `ffmpeg` agent
(`.claude/agents/ffmpeg.md`). Two edits here touch it:
- removing the flat `-metadata PERCEPTOR_SOURCE=` from `buildCommand.ts`, which also changes every
  case expectation in `services/worker/ffmpeg/`;
- adding `--global-tags` to `runner.ts`'s `mkvmerge` call.

Dispatch those two as `ffmpeg`-agent tasks. Everything else is the `worker` agent's.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/tags/perceptor-tags.ts` | New | pure: `PerceptorNode` tree type, `buildGlobalTagsXml(facts)`, `buildTrackGroupXml(facts)`, child-omission rule (REQ-2), value hygiene (REQ-3, reusing `sanitizeTagValue`) |
| `src/tags/merge-library-tags.ts` | New | pure: given the extracted tag XML, the track list and the api's facts → replacement XML or `unchanged` (REQ-14/16) |
| `src/subtitles/embed-tags.ts` | Modified | `buildTrackTagsXml` emits one nested `PERCEPTOR` (`SOURCE`, `OFFSET`, `PROVIDER`, `SYNC_SCORE`, `FRAMERATE_RATIO`, `EMBEDDED_AT`) via `perceptor-tags.ts`; `sanitizeTagValue` moves there or is re-exported |
| `src/jobs/subtitle-embed.job.ts` | Modified | reads `provider`, `syncScore`, `framerateRatio` off the details; `EMBEDDED_AT` = the moment before the `rename` |
| `src/encode/grain-mode.ts` | Modified | `resolveFilmGrain` returns `{ filmGrain, decidedBy }` (`title`/`setting`/`gate`/`probe`/`short`); a failure keeps `filmGrain: false` and omits `decidedBy`; the Redis verdict stores the stage too (an old boolean entry reads as `decidedBy` absent) |
| `src/encode/encode.ffmpeg.ts` | Modified | collects the facts, probes the working file for `OUTPUT_RESOLUTION` after FFmpeg, passes a global-tags XML to `runFfmpeg` |
| `src/version.ts` | New | `perceptorVersion()`: `PERCEPTOR_VERSION` env, else `dev` |
| `src/ffmpeg/buildCommand.ts` (ffmpeg agent) | Modified | drop `-metadata PERCEPTOR_SOURCE=…`; keep `title` |
| `src/ffmpeg/runner.ts` (ffmpeg agent) | Modified | optional `globalTags: () => Promise<string \| null>` called after FFmpeg exits and before `mkvmerge`; non-null writes a temp XML and adds `--global-tags <xml>`; the temp file is removed with the other temps |
| `services/worker/ffmpeg/*.json` (ffmpeg agent) | Modified | expectations lose the `PERCEPTOR_SOURCE` pair |
| `src/jobs/library-tags.job.ts` | New | the migration handler |
| `src/queue/types.ts` | Modified | hand copy of `api`'s `LIBRARY_TAGS_QUEUE`/`LIBRARY_TAGS_JOB`/`LibraryTagsJob` |
| `src/index.ts` | Modified | a seventh `Worker` on `library-tags`, `concurrency: 1`, constructed after `encodeWorkerStarted` like the others |
| `src/i18n/error-keys.ts`, `messages.en.ts` | Modified | `error.libraryTags.file_missing`, `write_failed`, `verify_failed`, `item_not_found`, `item_settled` |
| `src/metadata/container-tags.ts` | Unchanged | `buildSourceTag` keeps producing `SOURCE`'s value (`046` NFR-3) |
| `services/worker/CLAUDE.md` | Modified | queue table row; a section for the tag group and the migration |

## Existing code to reuse

- `src/subtitles/embed-tags.ts` `sanitizeTagValue`: the REQ-3 hygiene, already written for `107`.
  Every child value goes through it.
- `src/metadata/container-tags.ts` `buildSourceTag`: the `SOURCE` value. Unchanged.
- `src/ffmpeg/metadata.ts` `getMetadata`: the pre- and post-edit probe in the migration
  (NFR-4), and the `OUTPUT_RESOLUTION` read of the working file.
- `src/ffmpeg/capture.ts` `runFfmpegCapture` (the AbortSignal-aware spawn): to run `mkvextract`,
  `mkvmerge -J` and `mkvpropedit` without a second spawn helper.
- **Not** `src/jobs/subtitle-embed.job.ts`'s `.perceptor-probe` writability test. That empty
  file is a library write that Article XII names only for the subtitle remux. The migration checks
  writability with `fs.access(path, R_OK | W_OK)` and writes nothing beside the file except what
  `mkvpropedit` itself writes.
- `src/jobs/library-probe.job.ts`: the shape of a library-file job (details query → keyed error →
  report), including dropping a keyed details error silently.
- `src/api/deliver-report.ts` (`deliverReport`): retries an outcome report until `api`
  acknowledges it. `libraryTagMigrationItemFinished` goes through it.
- `src/encode/verdict-store.ts`: the grain verdict now stores the stage. Bump nothing; read an old
  boolean as `{ filmGrain, decidedBy: undefined }`.
- `RESOLUTION_BOXES` in `src/ffmpeg/params.ts`: `RESOLUTION_CEILING` is the effective
  `compressionResolution` after `normalizeCompressionResolution`, the same value the box was
  chosen from.

## Steps

1. **`src/version.ts`.** Read `PERCEPTOR_VERSION`; default `dev`. An empty string also reads `dev`.
2. **`src/tags/perceptor-tags.ts`.** This is the single builder of `<Simple><Name>PERCEPTOR</Name>…`
   trees: nested `Simple` elements, children omitted when null or undefined, numbers via
   `String(n)` (decimal, `.`), timestamps via `toISOString()` cut to seconds plus `Z`. A global
   group uses `<Targets/>`; a track group targets a track.
3. **Embed** (`embed-tags.ts`, `subtitle-embed.job.ts`). Switch to the group. If `provider` is
   absent on the details (older `api`), the job logs and omits `PROVIDER`; it does not fail.
4. **Grain stage.** `resolveFilmGrain` returns `{ filmGrain, decidedBy }`:
   - effective `ON` gives `title`; effective `OFF` gives no `decidedBy` (see the decision below);
   - `gate` / `short` / `probe` from the existing branches; a cache hit reuses the stored stage.
5. **Encode facts** (`encode.ffmpeg.ts`):
   - `SOURCE`: `details.sourceTag`.
   - `VERSION`: `perceptorVersion()`.
   - `ENCODE`:
     - `VIDEO_CODEC` from whether `getVideoParams` copied or encoded. Expose that as a returned
       flag; do not re-parse argv.
     - `CRF`/`PRESET` from the same place.
     - `CONTENT_KIND` = `details.contentKind`; `RESOLUTION_CEILING` = `details.compressionResolution`.
     - `SOURCE_RESOLUTION` from the input's first video stream.
     - `OUTPUT_RESOLUTION` from a probe of the working file after FFmpeg exits.
     - `DEINTERLACED` when `deinterlaceFilter` returned a filter.
   - `GRAIN`.
   - `DUB_TRIM` = `dubCut`, `STREAM_END_TRIM` = `endCut`, each only when non-null and > 0.
   - `ENCODED_AT`: the moment FFmpeg exited.

   Any fact that throws is omitted with one warning (NFR-3).
6. **Runner** (ffmpeg agent). Thread `globalTags` through `runFfmpeg` and add `--global-tags`.
   Also add `--no-global-tags` for the input file, so a stray tag in the working file can never
   duplicate the group. FFmpeg's own `ENCODER` global tag is dropped with it, which is acceptable:
   it is not a Perceptor fact and `046` already strips source globals. Update the case corpus.
7. **`merge-library-tags.ts`.** The input is the parsed tag XML, the track list (number → UID) and
   the api details:
   - **Global.** A flat `PERCEPTOR_SOURCE` becomes `SOURCE`. Facts the file already holds in an
     existing group are kept. The api facts fill only absent children. `OUTPUT_RESOLUTION` comes
     from the probe when a group is written at all.
   - **Tracks.** Each track tag with a flat `PERCEPTOR_SOURCE`/`PERCEPTOR_OFFSET` becomes a group.
     The api track facts are matched by the `SOURCE` value.
   - Every other `Tag` and `Simple` is kept verbatim, in order.
   - The result is `unchanged` when there is no flat tag and nothing new to add (REQ-16).
8. **`library-tags.job.ts`:**
   1. Call `libraryTagMigrationItem`. On `item_not_found`/`item_settled`, log and return without
      reporting.
   2. If the file does not exist → `MISSING` (`file_missing`).
   3. Check readable and writable, and probe (`getMetadata`). Any failure → `FAILED`
      (`write_failed`).
   4. Run `mkvextract tags` into a temp file under the OS temp directory (never beside the library
      file) and `mkvmerge -J`.
   5. Merge. If `unchanged` → `UNCHANGED`.
   6. Run `mkvpropedit <file> --tags all:<xml>`. A non-zero exit → `FAILED` (`write_failed`).
   7. Re-probe and compare streams, codecs, durations and track language/title with the first
      probe. A mismatch → `FAILED` (`verify_failed`), logged with the path. No further write.
   8. Otherwise → `MIGRATED`. Report through `deliverReport`. Remove the temp files in `finally`.
9. **Queue wiring** (`types.ts`, `index.ts`), and keys.
10. **`CLAUDE.md`.**

Decision taken in planning, which the spec did not cover: **`GRAIN` → `DECIDED_BY` for an
explicit mode.** `EncodeJobDetails.grainMode` arrives already effective (`AUTO`/`ON`/`OFF`, `092`):

- The installation setting can only produce `AUTO` (on) or `OFF` (off), so an effective `ON` can
  only come from the title's own override. It maps exactly to `title`.
- An effective `OFF` is either the title saying `OFF` or `INHERIT` with the setting off. Nothing
  on the payload tells the two apart. `DECIDED_BY` is **omitted** for it, never guessed (REQ-2).
  Telling them apart would need a new contract field, which is out of this freeze.

## Contract obligations

Consumed from `../spec.md` (v0.3.1):

- `SubtitleEmbedTrack.provider: String!` is written verbatim as `PROVIDER`, with no validation
  (REQ-10). `syncScore`/`framerateRatio` are nullable, and null omits the child.
- `libraryTagMigrationItem(id)`:
  - `error.libraryTags.item_not_found` and `item_settled` → log, report nothing, finish the job
    successfully (no BullMQ retry);
  - any other error → throw, so BullMQ's stall/attempt budget applies.
- `libraryTagMigrationItemFinished(id, outcome, reasonKey)` is sent through `deliverReport`.
  `reasonKey` is null for `MIGRATED`/`UNCHANGED`, and one of `file_missing`/`write_failed`/
  `verify_failed` otherwise. The worker never reports `BUSY`.
- `src/queue/types.ts` must match `api`'s copy character for character.

## Tests

- `src/tags/perceptor-tags.spec.ts`: one group per target, null children omitted (never empty or
  `0`), hygiene applied, number and timestamp formats. This defends against an empty or duplicated
  group that no tool would flag.
- `src/tags/merge-library-tags.spec.ts`: this is where silent damage would come from. Cover:
  - flat → group conversion, value kept verbatim;
  - non-Perceptor tags kept byte-for-byte and in order;
  - track tags matched by UID;
  - the file wins over api facts;
  - `unchanged` for an already-migrated file and for a file with nothing to add (REQ-16);
  - a second pass over its own output is `unchanged` (AC-8).
- `src/subtitles/embed-tags.spec.ts` (update): the nested shape, `PROVIDER` verbatim for an
  unknown provider, sync children absent when null.
- `src/encode/grain-mode.spec.ts` (update): every branch returns the right `decidedBy`, an effective
  `OFF` has none, a failure has none, and an old boolean cache entry reads with no stage.
- `src/jobs/library-tags.job.spec.ts`, with the tool spawns mocked:
  - `item_settled` reports nothing;
  - a missing file → `MISSING`;
  - an unwritable file → `FAILED` with no `mkvpropedit` call;
  - a non-zero `mkvpropedit` → `FAILED`;
  - a post-edit probe mismatch → `verify_failed`, with no second write;
  - temp files removed on every path.
- `src/ffmpeg/cases.spec.ts` (ffmpeg agent): the corpus without `PERCEPTOR_SOURCE`.
- `src/version.spec.ts` is not owed: a two-line env read with a default.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker run test
bin/comments worker
```

All pass, and an encode in the dev stack shows AC-1's tree in `mkvinfo`.

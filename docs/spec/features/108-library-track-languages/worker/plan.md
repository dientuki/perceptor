---
title: Library Track Languages — worker slice
service: worker
last_updated: 2026-10-27
status: Approved
---

# PLAN: Library Track Languages — `worker` (`worker/plan.md`)

## Scope

The worker consumes the `library-probe` queue: for one title it asks `api` where the file is, reads
its audio and subtitle languages with `ffprobe` and a directory listing, and reports them. It reads
and never writes (spec NFR-1, constitution Article XII). It does **not** resolve sidecar tags to
languages (`api` does, against its `Language` table), decide when a read happens, or retry one.

Writes are confined to `services/worker/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/queue/types.ts` | Modified | `LIBRARY_PROBE_QUEUE`, `LIBRARY_PROBE_JOB`, `LibraryProbeJob`, identical to `api`'s |
| `src/subtitles/audio-languages.ts` (+ spec) | New | audio languages from probed streams |
| `src/api/library-probe-reports.ts` | New | `libraryProbeDetails`, `libraryProbeCompleted`, typed by hand |
| `src/jobs/library-probe.job.ts` (+ spec) | New | the job |
| `src/index.ts` | Modified | a `Worker` on `library-probe` |

## Existing code to reuse

- `src/jobs/subtitle-probe.job.ts` (`107`): the job's skeleton, minus the start report, the hash and
  the failure report. Copy its `<base>` derivation (`basename` minus `extname`) and its
  `readdir(dirname(filePath))`.
- `src/ffmpeg/metadata.ts`'s `getMetadata`: the one `ffprobe` call, already bounded.
- `src/subtitles/embedded-languages.ts` and `src/subtitles/sidecars.ts`: called as they are. Forced
  tracks and forced/foreign sidecars are already excluded there (spec REQ-1).
- `src/ffmpeg/iso639.ts`'s `normalizeIso3`: the audio unit uses it exactly as
  `embedded-languages.ts` does.
- `src/api/subtitle-probe-reports.ts` and `src/api/deliver-report.ts`: the request shape and the
  retry-until-acknowledged delivery for the completion report.
- `src/index.ts`'s `subtitle-probe` worker block: registration order (after the lease and
  `encodeWorkerStarted`), unknown-job-name guard, `failed` logger, SIGTERM close, `listening on
  queue` line.

## Steps

1. **Queue types**, copied by name and shape from `services/api/src/queue/types.ts` once `api`'s
   step 4 exists (until then, from `../spec.md` § GraphQL Contract Delta, which is the same).
2. **`audio-languages.ts`**: `audioLanguages(streams)` keeps `codec_type === 'audio'`, reads
   `tags.language`, normalizes with `normalizeIso3`, drops empty, missing and `und`, de-duplicates in
   stream order.
3. **Reports**: `libraryProbeDetails(target)` and `libraryProbeCompleted(target, filePath, audio,
   embeddedSubs, sidecarTags)`, with the `LibraryProbeTarget` input as `{ movieId?, episodeId? }`.
4. **Job** `handleLibraryProbe(job)`:
   - build the target from the payload; a payload with neither or both ids logs and returns;
   - `libraryProbeDetails`: **any** `KeyedError` (`invalid_target`, `not_found`,
     `media_server_unavailable`) logs the title and the key and returns, reporting nothing; any other
     error is rethrown so BullMQ logs it (`attempts: 1`, no retry);
   - read: `getMetadata(filePath)`, `audioLanguages`, `embeddedLanguages`, `readdir` +
     `sidecarLanguageTags`;
   - any throw in the read logs the title and the path (spec NFR-3, AC-8) and returns, reporting
     nothing;
   - otherwise `deliverReport(libraryProbeCompleted(target, filePath, …))`, echoing the exact
     `filePath` string `libraryProbeDetails` returned. `false` (stale path) is logged, not an error.
5. **Registration** in `src/index.ts`: a `Worker` on `LIBRARY_PROBE_QUEUE`, concurrency 1,
   constructed after `encodeWorkerStarted`, beside the `subtitle-probe` worker.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, retyped by hand:

- `libraryProbeDetails(target: LibraryProbeTarget!): LibraryProbeDetails!` (`filePath`, an absolute
  container path). Errors `error.libraryProbe.invalid_target`, `error.libraryProbe.not_found`,
  `error.libraryProbe.media_server_unavailable`: log and abandon, report nothing. The service-guard
  key never happens with the service token; rethrow.
- `libraryProbeCompleted(target, filePath, audioLanguagesIso3: [String!]!,
  embeddedSubtitleLanguagesIso3: [String!]!, sidecarLanguageTags: [String!]!): Boolean!`. `false`
  means discarded as stale; not an error.
- Queue `library-probe` / `library-probe`, payload `{ movieId?: number; episodeId?: number }`,
  `attempts: 1` from `api`: a throw is never retried.

There is no start or failure mutation. Do not invent one to make a failure visible.

## Tests

Article IX, each verified to fail when its rule is removed:

- `src/subtitles/audio-languages.spec.ts`: `und`, empty and untagged audio dropped; `fra` → `fre`;
  subtitle and video streams ignored; duplicates merged in stream order.
- `src/jobs/library-probe.job.spec.ts` (real temp directory, `getMetadata` stubbed):
  - the happy path reports the echoed `filePath`, audio, embedded subtitles and sidecar tags; a
    forced embedded track and a `.forced.srt` sidecar are absent;
  - each of the three keyed `libraryProbeDetails` errors reports nothing;
  - a throwing `getMetadata` reports nothing and logs the path;
  - a missing directory reports nothing;
  - nothing is written to the temp directory (its listing is identical before and after: the
    read-only half of AC-11).

## Done when

```bash
bin/cli worker npx --no tsc --noEmit   # 0 errors
bin/npm worker test                    # green, new cases included
bin/comments worker
```

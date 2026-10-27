---
title: OpenSubtitles Direct — worker slice
service: worker
last_updated: 2026-10-27
status: Approved
---

# PLAN: OpenSubtitles Direct — `worker` (`worker/plan.md`)

## Scope

The worker gains one job, `subtitle-probe`, which reads a library file and reports:

- the languages of its non-forced embedded subtitle tracks;
- the raw language tags of its non-forced sidecars;
- its size and its OpenSubtitles hash.

It only reads. It never writes, renames or deletes anything under the destinations root (REQ-3,
AC-12), and it never calls OpenSubtitles. That is `api`'s.

The worker does **not** map a sidecar tag to a language. `es`, `es-419`, `spa` and `Spanish` are
reported exactly as written, and `api` resolves them against its `Language` table (spec Amendments
0.2.0). The worker does not decide what is missing, and it does not change `subtitle-sync`,
`subtitle-embed` or the encode.

Writes are confined to `services/worker/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/queue/types.ts` | Modified | `SUBTITLE_PROBE_QUEUE = 'subtitle-probe'`, `SUBTITLE_PROBE_JOB = 'subtitle-probe'`, `SubtitleProbeJob { subtitleSearchId: number }` |
| `src/api/subtitle-probe-reports.ts` | New | `subtitleProbeDetails`, `subtitleProbeStarted`, `subtitleProbeCompleted`, `subtitleProbeFailed` |
| `src/subtitles/opensubtitles-hash.ts` | New | the hash, from a read-only file handle |
| `src/subtitles/sidecars.ts` | New | pure: directory listing + media base name → non-forced sidecar tags |
| `src/subtitles/embedded-languages.ts` | New | pure: ffprobe streams → non-forced subtitle `iso3` (normalized `/B`) |
| `src/jobs/subtitle-probe.job.ts` | New | the handler |
| `src/index.ts` | Modified | a `Worker` on `subtitle-probe`, concurrency 1, with `failed` logging |
| `src/i18n/error-keys.ts` | Modified | `ERROR_SUBTITLE_SEARCH_PROBE_FAILED = 'error.subtitleSearch.probe_failed'` |
| specs for the three pure units and the job | New | see Tests |

## Existing code to reuse

- `src/jobs/subtitle-sync.job.ts`: the exact handler shape to copy:
  - details, where `*_not_found` (a `KeyedError`) means log and return;
  - `started`, where `false` means log and return;
  - the work;
  - `deliverReport(…Completed)`, and on any throw `deliverReport(…Failed, key)`.
- `src/api/subtitle-sync-reports.ts` + `src/api/graphql-client.ts`: how a service-only query or
  mutation is written and typed by hand (no codegen, Article VIII).
- `src/api/deliver-report.ts`: retries a report until `api` acknowledges it (`038`).
- `src/ffmpeg/metadata.ts`'s `getMetadata(filePath)`: the one `ffprobe` call. Do not add a second
  probe invocation.
- `src/ffmpeg/iso639.ts`'s `normalizeIso3`: `/T` → `/B` for embedded track tags (`fra` → `fre`).
  Sidecar tags do **not** go through it; they are reported raw.
- `src/i18n/keyed-error.ts`: `KeyedError` for the `probe_not_found` check.
- `src/index.ts`'s `subtitleSyncWorker` block: copy for the new `Worker`.

## Steps

1. **Queue type.** Add the constants and `SubtitleProbeJob` to `src/queue/types.ts`, identical to
   `api`'s copy.
2. **Reports.** `src/api/subtitle-probe-reports.ts`, mirroring `subtitle-sync-reports.ts`.
   `subtitleProbeCompleted(id, embeddedLanguagesIso3, sidecarLanguageTags, fileSizeBytes, movieHash)`
   sends `fileSizeBytes` as a JSON number (`Float!`).
3. **Hash** (`opensubtitles-hash.ts`):
   - `open(path, 'r')`;
   - `size` from `handle.stat()`;
   - read the first and the last 65 536 bytes (or what exists, for a file under 64 KiB);
   - sum `size` plus every little-endian unsigned 64-bit word of both chunks, modulo 2^64, as
     `BigInt`;
   - format as 16 lowercase hex digits, zero-padded;
   - close the handle in `finally`.

   This is OpenSubtitles' published algorithm (https://trac.opensubtitles.org/projects/opensubtitles/wiki/HashSourceCodes).
4. **Embedded languages** (`embedded-languages.ts`):
   - keep streams with `codec_type === 'subtitle'` and `disposition.forced !== 1`;
   - read `tags.language`, lowercased, through `normalizeIso3`;
   - drop `und`, empty and missing tags;
   - deduplicate. Any codec counts, image tracks included (REQ-3).
5. **Sidecars** (`sidecars.ts`), given the file names in the media's directory and the media's base
   name (file name minus its last extension):
   - keep names that start with `<base>.` exactly (case-sensitive, so `<base> - 4K.mkv`'s sidecars
     are not this file's) and end in a subtitle extension (`.srt`, `.ass`, `.ssa`, `.vtt`, `.sub`,
     `.sup`, `.idx`);
   - split the middle part (between `<base>.` and the extension) on `.`;
   - the first segment is the language tag, and every later segment is a flag;
   - a sidecar with a flag `forced` or `foreign` (case-insensitive) is dropped;
   - `sdh`, `cc`, `hi` and `default` are ignored;
   - a sidecar with no middle part (`<base>.srt`) has no tag and is dropped;
   - return the tags as written, deduplicated.
6. **Handler** (`subtitle-probe.job.ts`):
   - `subtitleProbeDetails(id)`. A `KeyedError` with `error.subtitleSearch.probe_not_found` means log
     and return. Any other error is rethrown.
   - `subtitleProbeStarted(id)`. `false` means log and return, with no report (the third-run rule
     lives in `api`).
   - `getMetadata(filePath)` → `embeddedLanguages`.
   - `readdir(dirname(filePath))` → `sidecars`.
   - `opensubtitlesHash(filePath)` → `{ size, hash }`.
   - `deliverReport(subtitleProbeCompleted(...))`.
   - Any throw in the work logs and calls `deliverReport(subtitleProbeFailed(id, PROBE_FAILED))`.
   - No timeout controller is needed: nothing here runs an external process except `ffprobe`, which
     `getMetadata` already bounds.
7. **Registration.** In `src/index.ts`, a `Worker` on `SUBTITLE_PROBE_QUEUE`:
   - concurrency 1;
   - ignore an unknown job name;
   - log `failed`;
   - add a `listening on queue` line.

   It must be constructed **after** `encodeWorkerStarted` and the lease, like the other `Worker`s, so
   `api`'s retry-once reconcile has already run when it starts consuming.
8. **Provenance tags (spec 0.4.0, REQ-14)**, in `101`'s embed path, not the probe:
   - `src/api/` `subtitleEmbedDetails` query selects the new `provenance` field; the hand-typed
     track type gains `provenance?: string` (optional: an older `api` may not send it).
   - New pure `src/subtitles/embed-tags.ts`: `sanitizeTagValue(value)` (drop every control
     character, including CR/LF/TAB, trim, cut to 500 characters) and
     `buildTrackTagsXml(source, offsetMs)` returning a Matroska tags XML with one `Tag`, empty
     `Targets`, and two `Simple` entries `PERCEPTOR_SOURCE` and `PERCEPTOR_OFFSET`, with `&`, `<`,
     `>`, `"`, `'` escaped.
   - `src/jobs/subtitle-embed.job.ts`: for each track with a non-empty `provenance`, write that XML
     beside the normalized `.srt` (same scratch directory, same cleanup) and pass its path on the
     track as `tagsPath`.
   - `src/subtitles/embed-args.ts`: a track with `tagsPath` gets `--tags 0:<tagsPath>` before its
     file name, alongside the existing `--language`/`--track-name` options. A track without it gets
     no `--tags` (an older `api`).
   - `offsetMs` is the track's existing field; nothing new is measured here.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, retyped by hand:

- `subtitleProbeDetails(id: Int!): SubtitleProbeDetails!`, where `filePath` is an absolute container
  path. Errors:
  - `error.subtitleSearch.probe_not_found`: log and abandon, no report;
  - the service-guard key: should never happen with the service token. Rethrow, and BullMQ logs it.
- `subtitleProbeStarted(id: Int!): Boolean!`: `false` means abandon silently.
- `subtitleProbeCompleted(id, embeddedLanguagesIso3: [String!]!, sidecarLanguageTags: [String!]!,
  fileSizeBytes: Float!, movieHash: String!): Boolean!`: send through `deliverReport`. `false` (the
  search moved on) is not an error.
- `subtitleProbeFailed(id, errorKey: String!): Boolean!`: the only key the worker sends is
  `error.subtitleSearch.probe_failed`.

Queue: `subtitle-probe` / `subtitle-probe`, payload `{ subtitleSearchId: number }`. `api` produces
it with `jobId: subtitle-probe-<id>` and `attempts: 1`, so a throw here is not retried by BullMQ;
retries are `api`'s decision (NFR-2).

## Tests

Article IX: each verified to fail when the rule is removed.

- `src/subtitles/opensubtitles-hash.spec.ts`:
  - a generated fixture whose hash is computed independently in the test (two known 64 KiB chunks)
    matches;
  - a file under 64 KiB does not throw;
  - the file is opened with flag `'r'` only (spy on `fs.promises.open`, the read-only half of AC-12).
- `src/subtitles/embedded-languages.spec.ts`:
  - a forced track's language is excluded;
  - a `hdmv_pgs_subtitle` track counts;
  - `fra` reports `fre`;
  - `und` is dropped.
- `src/subtitles/sidecars.spec.ts`:
  - `<base>.es.srt` → `es`;
  - `<base>.es-419.forced.srt` → nothing;
  - `<base>.Spanish.sdh.srt` → `Spanish`, reported raw;
  - `<base> - 4K.es.srt` beside `<base>.mkv` → nothing (prefix collision);
  - `<base>.srt` → nothing.
- `src/subtitles/embed-tags.spec.ts` (0.4.0):
  - a value with `\n`, `\r`, `\t` and another control character comes out without them;
  - a 600-character value is cut to 500;
  - `&`, `<`, `>`, quotes are escaped in the XML, and the two `Simple` names are exact;
  - a negative offset is written with its sign (`-2000`).
- `src/subtitles/embed-args.spec.ts` (extend): a track with `tagsPath` gets `--tags 0:<path>` before
  its file name; a track without it gets no `--tags`.
- `src/jobs/subtitle-probe.job.spec.ts`:
  - `probe_not_found` reports nothing;
  - `started === false` reports nothing;
  - a throwing `getMetadata` reports `probe_failed`;
  - the happy path reports the four values.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit   # 0 errors
bin/npm worker test                    # green, new cases included
bin/comments worker
```

---
title: Season Pack Post-Download Processing — worker slice
service: worker
last_updated: 2026-08-17
status: Implemented
---

# PLAN: Season Pack Post-Download Processing — `worker` (`worker/plan.md`)

## Scope

This slice owns the two decisions that happen on the worker's side of the pipeline: **which files in
a finished download are candidates and what `SxxEyy` each one carries**, and **whether to obey the
cleanup verdict `api` returns**. It reports; it does not resolve. The worker never turns a parsed
`(season, episode)` pair into a database row, never reads an episode title from a file name, and
never decides on its own that a source may be deleted.

Everything about output paths is out of scope and must not change:
`src/paths/build-output-path.ts` already produces the required series layout and this feature
verifies it rather than editing it. The encode pipeline (`src/ffmpeg/`, `src/encode/`) is untouched
— a season pack is N ordinary encodes through the same queue at the same `concurrency: 1`.

Writes are confined to `services/worker/` and this directory. The Prisma schema, the resolvers and
the `seasons/` module all belong to `api`; a change needed there is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/scan/scan-folder.ts` | Modified | enumeration only; each `ScannedFile` gains `isVideo`; `matchedFilePath` removed from the result |
| `src/scan/parse-episode.ts` | New | the `SxxEyy` base-name parser, pure |
| `src/scan/parse-episode.spec.ts` | New | see Tests |
| `src/scan/select-matches.ts` | New | the two selection rules, pure |
| `src/scan/select-matches.spec.ts` | New | see Tests |
| `src/scan/scan-folder.spec.ts` | Modified | drops the `matchedFilePath` assertions, keeps the enumeration ones, adds `isVideo` |
| `src/jobs/source-ready.job.ts` | Modified | queries `seasonId`, picks the mode, sends `matches` and `isVideo` |
| `src/jobs/encode.job.ts` | Modified | `encodeCompleted` returns three instructions; they are passed into `cleanupSource()` |
| `src/jobs/cleanup-source.ts` | Modified | each of its three existing actions goes behind its own flag; new `inputFilePath` target with its own containment check |
| `src/jobs/cleanup-source.spec.ts` | Modified | one case per flag combination |

## Existing code to reuse

- `src/scan/scan-folder.ts`'s `VIDEO_EXTENSIONS` and its `stat().isFile()` branch — the `LOCAL_FILE`
  case (a lone uploaded file, where `readdir` throws `ENOTDIR`) already works and its comment
  explains why. Keep both; `isVideo` is computed from the same extension list, in the same place.
- `src/paths/build-output-path.ts` and `src/paths/is-inside-root.ts` — the house pattern this slice
  follows for the two new modules: a small pure function with its input type declared locally rather
  than imported from the job handler, so the rule is testable without GraphQL or a filesystem.
- `src/jobs/cleanup-source.ts` — its three existing actions are exactly the three the contract now
  names, so **nothing new is written here, only gated**. Its `isInsideRoot` guard, its `LOCAL_FILE`
  vs recursive branch, its swallow-everything contract and the comment explaining why all stay. The
  one addition is the per-job input file, which gets its own `isInsideRoot(downloadsRoot,
  inputFilePath)` call — the guard on `downloadPath` does not cover it, they are different paths.
- `src/api/graphql-client.ts`'s `fetchGraphQL` — unchanged; it still throws on `json.errors`, which
  is what makes a rejected `sourceScanned` a failed job rather than a silent no-op.

## Steps

1. `src/scan/parse-episode.ts`: export `parseEpisode(fileName: string): { seasonNumber: number;
   episodeNumber: number } | null`. Match `/s(\d{1,2})e(\d{1,3})/gi` against the **base name only**
   (the caller passes `fileName`, never `filePath` — state it in a comment). Collect all matches: if
   there is not exactly one distinct `(season, episode)` pair, return `null`. Nothing else is read
   from the name.
2. `src/scan/scan-folder.ts`: `ScannedFile` gains `isVideo: boolean`; `ScanResult` becomes
   `{ files: ScannedFile[] }`. Delete the `matchedFilePath` selection and its sort — it moves to
   step 3. Keep the existing header comment's spirit ("enumerates, does not parse") and update it.
3. `src/scan/select-matches.ts`: export `selectMatches(files, mode)` returning
   `{ filePath, seasonNumber, episodeNumber }[]`, with `mode` being `{ kind: 'single' }` or
   `{ kind: 'season' }`. `single` → the largest video file, one entry, both numbers `null` (today's
   rule, moved verbatim). `season` → for every video file, `parseEpisode(fileName)`; drop the
   unparseable; group by `${season}x${episode}` and keep the largest of each group. Files dropped for
   any reason simply do not appear in the result — the caller logs them and `api` derives
   `hasUnmatchedFiles` from the difference.
4. `src/jobs/source-ready.job.ts`: add `seasonId` to the `mediaSource(id)` query **and** to
   `MediaSourceQueryResult` in the same edit. Choose the mode: `movieId` or `episodeId` set →
   `single`; otherwise `seasonId` set → `season`; none set → throw (the job fails loudly, `api`
   answers the same case with its own `BadRequestException`). Send
   `sourceScanned(mediaSourceId, files, matches)` with `files` carrying `isVideo` and `matches` from
   step 3. Log the count of matches and, by name, every video file that is not in them.
5. `src/jobs/encode.job.ts`: retype `encodeCompleted`'s result as
   `{ encodeCompleted: { message: string; removeTorrent: boolean; deleteInputFile: boolean;
   deleteDownloadPath: boolean } }` and select all four fields in the mutation — one edit, both
   halves. Keep logging `message`. Pass the three booleans, plus `details.inputFilePath`, into
   `cleanupSource(...)`; the call keeps its position after the encode's `try/catch` and its own
   logging-only `try`. If any of the three arrives `undefined` (the field was dropped from the query,
   or `api` is older than this feature), skip cleanup entirely and log a `console.error` naming the
   missing field — never treat a missing instruction as `false` silently, and never as `true`.
6. `src/jobs/cleanup-source.ts`: `CleanupInput` gains `inputFilePath: string` and the three flags.
   Body becomes, in this order: if `removeTorrent` and there is an `infoHash`, call
   `downloadRemove(mediaSourceId, deleteFiles: false)`; if `deleteInputFile`, `isInsideRoot(downloadsRoot, inputFilePath)` then `rm` that one
   file; if `deleteDownloadPath`, the existing `isInsideRoot(downloadsRoot, downloadPath)` then the
   existing `LOCAL_FILE`/recursive branch, untouched. Every failure is still caught and logged, never
   rethrown, and a refused containment check still logs and returns without deleting.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, read-only:

- `downloadRemove(mediaSourceId: Int!, deleteFiles: Boolean = true): String!` — this pipeline always
  passes `deleteFiles: false`. The worker owns every deletion; asking the client to delete would
  bypass `isInsideRoot`, and on a pack it would take the whole folder — including the inputs of
  episodes that have not encoded yet — in one call.
- `sourceScanned(mediaSourceId: Int!, files: [SourceFileInput!]!, matches: [ScannedMatchInput!]!):
  MediaSource!` — `matchedFilePath` is gone. `matches: []` is the legitimate "no video found" report,
  not an error to avoid sending; `api` turns it into the `ERROR` state and the mutation still
  succeeds. `SourceFileInput` now requires `isVideo` on **every** entry, sidecars included.
- `encodeCompleted(...): EncodeCompletedResult!` with `message`, `removeTorrent`, `deleteInputFile`
  and `deleteDownloadPath`. The three are independent and are executed in that order; the worker
  never recomputes or second-guesses one from another.
- Error conditions this slice must expect, all surfacing through `fetchGraphQL` throwing and failing
  the BullMQ job: `El mediaSource <id> no existe`, `matchedFilePath <path> no está en la lista de
  files reportada` (sending a match whose path is not in `files` — a bug in step 3/4, not a runtime
  condition), and `El mediaSource <id> no apunta a ninguna película, episodio ni temporada`. None of
  them is retried: neither queue configures `attempts`, and that is unchanged.
- A file that resolves to no episode is **not** an error and produces no GraphQL failure — `api`
  answers `200` and records the flag. Do not treat a smaller-than-expected match list as a failure.

## Tests

- `src/scan/parse-episode.spec.ts` (new) — defends against the silent mis-filing described in
  `../plan.md` § Risks: a wrong parse creates a `ProcessJob` against the wrong episode, encodes
  successfully and writes the wrong file into the library, with every status green. Cases:
  `S01E02`, `s1e2`, `Show.S01E02.1080p.x265-GRP.mkv` → `(1, 2)`; `S01E01E02`, `Show.1x02.mkv`,
  `episode 3.mkv` → `null`; and the path case — a *file name* is all it ever sees, asserted by
  passing `Show S02 COMPLETE/ep3.mkv` and expecting `null` rather than a season-2 hit.
- `src/scan/select-matches.spec.ts` (new) — defends against the duplicate-episode collision and
  against the `single` rule quietly changing. Cases: `single` picks the largest video and ignores
  `.nfo`/`.srt` and any `SxxEyy` in the names; `season` returns one entry per episode; two files for
  the same episode yield one entry, the larger; a pack with no parseable name yields `[]`.
- `src/scan/scan-folder.spec.ts` (modified) — keeps its existing enumeration and `LOCAL_FILE`
  coverage, drops what it asserted about `matchedFilePath`, adds that `isVideo` is `true` for `.mkv`
  and `false` for `.nfo`.
- `src/jobs/cleanup-source.spec.ts` (modified) — it already covers the containment refusal and the
  swallow-everything contract; it gains one case per flag: `removeTorrent` alone calls
  `downloadRemove` with `deleteFiles: false` and touches no file; `deleteInputFile` alone removes
  only that path and leaves the folder; `deleteDownloadPath` keeps today's recursive/`LOCAL_FILE`
  behaviour; an `inputFilePath` outside `downloadsRoot` is refused *without* suppressing the other
  two actions. A wrong branch here deletes an input that has not been encoded yet — no error, and the
  loss only surfaces when that episode's encode fails much later.
- Not owed: `source-ready.job.ts` and `encode.job.ts` themselves. Both are orchestration over
  `fetchGraphQL` with no rule of their own left in them once steps 3–5 are done — the same reason
  `handleEncode` has no spec today. The one rule that *is* in `encode.job.ts` (the `undefined`
  branch) is covered by making it loud rather than by a test.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
```

Typecheck reports 0 errors, and the suite is green: **9 suites** (the 7 that exist today plus
`parse-episode.spec.ts` and `select-matches.spec.ts`), with no fewer than today's 57 tests minus the
`matchedFilePath` assertions removed from `scan-folder.spec.ts` (5 of them) and plus the new cases.

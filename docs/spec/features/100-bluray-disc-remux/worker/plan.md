---
title: Blu-ray Disc Remux — worker slice
service: worker
last_updated: 2026-10-21
status: Implemented
---

# PLAN: Blu-ray Disc Remux — `worker` (`worker/plan.md`)

## Scope

`worker` recognises a Blu-ray disc in a film's download, picks its main playlist at scan time, and
assembles that playlist into one Matroska file at the start of the encode job, before the
compression branch. It reports through the existing `sourceScanned`, `sourceScanFailed` and
`encodeFailed` mutations and owns the two new error keys. It does **not** add any GraphQL field,
touch `api`'s status derivation, cleanup verdicts or race sweep, or render any message — `web`
owns the catalog strings.

Writes are confined to `services/worker/` and this directory. The `src/ffmpeg/` folder is owned by
the `ffmpeg` agent: the one change there (`capture.ts` accepting `'mkvmerge'`) is a binary-name
widening, not an argument rule, and stays in this slice; nothing in `params.ts`/`buildCommand.ts`
changes.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/disc/mpls.ts` | New | `parseMpls(buffer)`: play items (`clipName`, `inTicks`, `outTicks`, 45 kHz) and the count of entry marks (`mark_type` 1). Throws on a bad `MPLS` magic or truncated buffer |
| `services/worker/src/disc/find-disc.ts` | New | `findDiscRoots(files)`: from the scanned file list, every directory whose `BDMV/PLAYLIST` holds a `.mpls` and `BDMV/STREAM` holds a `.m2ts` (case-insensitive extensions; `BDMV/BACKUP` never qualifies) |
| `services/worker/src/disc/select-playlist.ts` | New | `selectPlaylist(candidates)`: pure, returns `{ kind: 'match', playlist }`, `{ kind: 'ambiguous', playlists }` or `{ kind: 'none' }` |
| `services/worker/src/disc/scan-disc.ts` | New | Glue: reads each `.mpls` from disk, resolves clips against `BDMV/STREAM` and the `isDownloaded` flags, calls `selectPlaylist`, and produces the `files`/`matches` to report (flag table below) or throws the ambiguous `KeyedError` |
| `services/worker/src/disc/assemble-playlist.ts` | New | `assemblePlaylist(playlistPath, signal)`: returns the assembled path; removes any leftover first, runs `mkvmerge`, removes the partial on failure or cancel |
| `services/worker/src/jobs/source-ready.job.ts` | Modified | For a film source with exactly one disc root, use `scan-disc.ts` instead of `selectMatches` |
| `services/worker/src/jobs/encode.job.ts` | Modified | `.mpls` input → `assemblePlaylist` after `encodeStarted`, before the compression branch; both branches get the assembled path; assembled file removed after a successful compression-on encode and on every failure |
| `services/worker/src/ffmpeg/capture.ts` | Modified | `CaptureOptions.binary` accepts `'mkvmerge'` |
| `services/worker/src/i18n/error-keys.ts` | Modified | `ERROR_SOURCE_DISC_PLAYLIST_AMBIGUOUS`, `ERROR_ENCODE_DISC_REMUX_FAILED` |
| `services/worker/src/i18n/messages.en.ts` | Modified | English renderings, matching the spec's `en` strings |
| `services/worker/fixtures/bdmv/` | New (later) | Real `.mpls` files from a disc, added during the manual pass |

## Existing code to reuse

- `src/ffmpeg/capture.ts` `runFfmpegCapture` — the AbortSignal-aware spawn with SIGTERM→SIGKILL
  grace and `EncodeCancelledError` on abort. Assembly runs through it; do not write a second
  spawn wrapper. Pass `keepStdout: true`: `mkvmerge` prints its errors on stdout.
- `src/paths/is-inside-root.ts` — guard every removal of the assembled file against
  `downloadsRoot` (Article XII); the assembled file sits inside the download folder by construction.
- `src/i18n/keyed-error.ts` + `renderMessage` — both new failures are `KeyedError`s, so
  `source-ready.job.ts`'s and `encode.job.ts`'s existing catch blocks report them with no new
  plumbing, and `encode.job.ts` already rethrows a `KeyedError` as `UnrecoverableError`.
- `src/scan/mark-downloaded.ts` — already computes `isDownloaded` per file; `scan-disc.ts` reads it,
  it does not re-query `downloadedFiles`.
- `src/encode/passthrough.ts` + `paths/with-source-extension.ts` — given the assembled `.mkv`, they
  already move it and pick `.mkv` (REQ-7). No change.
- `src/encode/encode.ffmpeg.ts` — given the assembled path, `onProbe` records the assembled file
  (AC-3) and grain/dub/stream-end analyses run on it unchanged (REQ-8). No change.
- `buildSourceTag(downloadsRoot, details.inputFilePath, downloadPath)` — keep passing the
  **original** `inputFilePath` (the playlist), never the assembled path.

## Steps

1. **Error keys.** Add both constants to `error-keys.ts` and their English messages to
   `messages.en.ts`:
   - `error.source.disc_playlist_ambiguous` `{ playlists }`
   - `error.encode.disc_remux_failed` `{ code, stderr }`
2. **`mpls.ts`.** Parse the header (`MPLS` + version), follow `PlayList_start_address` to the play
   items (5-char clip name, `IN_time`/`OUT_time` as 32-bit big-endian 45 kHz ticks; primary angle
   only) and `PlayListMark_start_address` to the marks (count `mark_type === 1`).
3. **`select-playlist.ts`.** Input per playlist: name, play items, entry-mark count, and whether every
   referenced clip is present **and** downloaded. Rules, in order:
   - drop unplayable playlists;
   - drop looped ones (REQ-15): `distinct < total / 2`, where `total = Σ(out − in)` over items and
     `distinct = Σ max(out − in)` per distinct clip name;
   - none left → `none`;
   - keep playlists within 1 s (45 000 ticks) of the longest;
   - one left → `match`;
   - otherwise prefer those with entry marks, then the most entry marks;
   - still more than one → `ambiguous` with their file names sorted.
4. **`find-disc.ts`.** Pure over the scanned paths.
5. **`scan-disc.ts`.** Read each `.mpls` (a parse failure makes that playlist unplayable, never the
   scan), build the candidates, and map the outcome to the flags below. On `ambiguous`, throw
   `KeyedError(ERROR_SOURCE_DISC_PLAYLIST_AMBIGUOUS, …, { playlists: names.join(', ') })`.

   | Outcome | `isVideo: true` | `isVideo: false` | `matches` |
   | :-- | :-- | :-- | :-- |
   | `match` | the winning `.mpls` only | every other file — clips, other playlists, `.clpi`, any ordinary video (REQ-4, REQ-12) | the winning `.mpls`, season/episode `null` |
   | `none` | every `.m2ts` under `BDMV/STREAM` (so `api` picks `scan_no_downloaded_video` when one is not downloaded, else `scan_no_video` — REQ-3) | everything else, including ordinary videos | `[]` |
   | `ambiguous` | — (thrown before `sourceScanned`) | — | — |

6. **`source-ready.job.ts`.**
   - Gate the disc path on `mediaSource.movieId !== null` and `findDiscRoots(...)` returning exactly
     one root.
   - Otherwise run the existing path untouched (episodes, seasons, multi-disc, no disc — AC-8).
   - Log one `[source-ready] <id>: disc <root>, <n> playlist(s), <outcome>` line.
7. **`capture.ts`.** Widen `binary` to `'ffmpeg' | 'ffprobe' | 'mkvmerge'`.
8. **`assemble-playlist.ts`.**
   - The assembled path is `<disc root>/<playlist basename>.perceptor.mkv`, where the disc root is
     the parent of `BDMV`. It stays inside the download folder, and the grain gate's
     parent-directory markers still read the release folder name.
   - Remove any leftover at that path.
   - Run `mkvmerge -o <path> <playlist>` through `runFfmpegCapture(..., { binary: 'mkvmerge',
     keepStdout: true })`.
   - Exit `0` or `1` with the file present → return the path.
   - Exit `≥ 2`, a missing file, or a spawn error → remove the partial and throw
     `KeyedError(ERROR_ENCODE_DISC_REMUX_FAILED, …, { code, stderr })`. `stderr` is the last ~2 000
     characters of stdout + stderr combined.
   - `EncodeCancelledError` → remove the partial and rethrow it untouched.
9. **`encode.job.ts`.**
   - After `encodeStarted` and inside the existing `try`, compute `encodeInput = isPlaylist ? await
     assemblePlaylist(details.inputFilePath, signal) : details.inputFilePath`.
   - Use `encodeInput` for `isInsideRoot`, `withSourceExtension`, `passthrough` and `encode`.
   - Keep `details.inputFilePath` for `buildSourceTag` and `cleanupSource`.
   - In a `finally` around the branch, remove `encodeInput` when it differs from
     `details.inputFilePath` and still exists (`isInsideRoot`-guarded). After the passthrough move it
     no longer exists; on success with compression on, on failure, and on cancel it is removed
     (REQ-9, REQ-10).
   - Progress is not reported during assembly (REQ-11).
10. Run the checks below.

## Contract obligations

Consumes and produces no new GraphQL shape (`../spec.md` § GraphQL Contract Delta).

- `sourceScanned(files, matches)`:
  - the match's `filePath` must be one of the reported `files` — `api` refuses otherwise with
    `error.source.match_not_reported`, which would be a bug here;
  - flags as in step 5's table.
- `sourceScanFailed`: carries `error.source.disc_playlist_ambiguous` with `errorParams =
  {"playlists":"00800.mpls, 00801.mpls"}`. `api` ignores a report for a source not `READY` (logged
  there), the existing behaviour.
- `encodeFailed`: carries `error.encode.disc_remux_failed` with `{"code":2,"stderr":"…"}`.
- Cancellation (`EncodeCancelledError`) and the `discarded`/`stopped` refusals of `encodeStarted`
  report nothing, exactly as today. A refusal arrives before assembly starts, so nothing is
  assembled.

The delta is read-only. If it is wrong, stop and report.

## Tests

Owed under Article IX (each failure here produces a wrong film or a stuck folder with no error):

- `src/disc/mpls.spec.ts` — the parser:
  - synthetic buffers built by a small test-local writer following the published layout:
    item order, tick values, repeated clips, mark counting by type;
  - bad magic and truncation throw;
  - real fixtures from `fixtures/bdmv/` are added once available.
- `src/disc/select-playlist.spec.ts` — the rules:
  - longest wins;
  - unplayable or not-downloaded dropped;
  - loop dropped even when it is the longest and has chapters (AC-15);
  - tie broken by having marks (AC-11), then by most marks;
  - a remaining tie is `ambiguous` with sorted names (AC-13);
  - everything dropped is `none`;
  - the 1 s window boundary.
- `src/disc/find-disc.spec.ts`:
  - nested root;
  - `BACKUP` ignored;
  - two roots;
  - loose `.m2ts` with no `BDMV` is not a disc (AC-8).
- `src/disc/scan-disc.spec.ts`:
  - the flag table for `match` with a sibling `sample.mkv` (AC-12, REQ-4);
  - `none` with an undownloaded clip (AC-7);
  - `ambiguous` throws the key with the `playlists` param.
- `src/disc/assemble-playlist.spec.ts` (capture mocked):
  - exit `1` is success;
  - exit `2` throws `disc_remux_failed` with a non-empty `stderr` taken from stdout and the partial
    removed;
  - abort rethrows `EncodeCancelledError` and removes the partial;
  - a leftover is removed before the run.
- `src/jobs/source-ready.job.spec.ts` (new, or extend if present):
  - an episode source with a `BDMV` tree takes the ordinary path;
  - a film with one disc reports through the disc path;
  - an ambiguous disc reaches `sourceScanFailed` with the key.
- `src/jobs/encode.job.spec.ts`:
  - `.mpls` input: assembly runs before the branch;
  - passthrough and encode receive the assembled path;
  - `buildSourceTag` still receives the playlist;
  - the assembled file is removed after a compression-on success and after a failure;
  - an assembly failure reports `disc_remux_failed`.

Not owed: the `capture.ts` type widening (the compiler covers it).

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments worker
```

The typecheck is clean, every new spec passes, and the pre-existing suites — including
`scan-folder.spec.ts`, `select-matches.spec.ts` and the `ffmpeg/` case corpus — pass unchanged
(NFR-4).

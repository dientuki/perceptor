---
title: Subtitle Search — worker slice
service: worker
last_updated: 2026-10-25
status: Approved
---

# PLAN: Subtitle Search — `worker` (`worker/plan.md`)

## Scope

The worker:

1. installs `ffsubsync` in its image for `linux/amd64` and `linux/arm64`;
2. consumes the new `subtitle-sync` queue;
3. picks the reference stream from the library file;
4. runs `ffsubsync`;
5. parses its measurements;
6. reports them;
7. stops passing staged tracks to `101`'s sidecar deletion.

It does **not** decide acceptance (`api` owns the thresholds), choose or fetch candidates, write
anything beside the library file, or delete the staged candidate (`api` cleans the downloads root).
`ffsubsync`'s output subtitle is written to a private temp directory and discarded: `101`'s embed
applies the offset.

Writes are confined to `services/worker/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `Dockerfile` | Modified | `ffsubsync` (pinned version) in the `base` stage, native build dependencies in a virtual `apk` package removed in the same layer |
| `src/queue/types.ts` | Modified | `SUBTITLE_SYNC_QUEUE`, `SUBTITLE_SYNC_JOB`, `SubtitleSyncJob = { subtitleSyncId: number }`, copied by hand from `api` |
| `src/api/subtitle-sync-reports.ts` | New | `subtitleSyncDetails`, `subtitleSyncStarted`, `subtitleSyncCompleted`, `subtitleSyncFailed` |
| `src/api/subtitle-embed-reports.ts` | Modified | `isSidecar` in the details query and type |
| `src/subtitles/sync-reference.ts` (+ spec) | New | Pure: ffprobe streams to `{ kind: 'SUBTITLE' \| 'AUDIO', streamSpec }` or `null` |
| `src/subtitles/ffsubsync-output.ts` (+ spec, + `fixtures/ffsubsync-*.log`) | New | Pure: `ffsubsync`'s log to `{ offsetMs, framerateRatio, score }` or `null` |
| `src/jobs/subtitle-sync.job.ts` (+ spec) | New | The handler |
| `src/jobs/subtitle-embed.job.ts` (+ spec) | Modified | Only `isSidecar` tracks reach `deleteSidecars` |
| `src/ffmpeg/capture.ts` | Modified | `binary` union gains `'ffsubsync'` |
| `src/index.ts` | Modified | A fourth `Worker` on `SUBTITLE_SYNC_QUEUE`, `concurrency: 1` |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | `error.subtitleSearch.sync_failed`, `error.subtitleSearch.interrupted` |

## Existing code to reuse

- `src/jobs/subtitle-embed.job.ts`: the job shape to copy. Read the details, report started and
  abandon silently on `false`, work in an `os.tmpdir()` directory removed in `finally`, and report
  through `deliverReport`.
- `src/api/subtitle-embed-reports.ts` and `src/api/graphql-client.ts`: the report-module shape and
  the service-token client.
- `src/api/deliver-report.ts`: retry until `api` acknowledges (`038`'s posture).
- `src/ffmpeg/capture.ts` `runFfmpegCapture`: spawn, capture stderr and the kill on abort. Use a
  local `AbortController` with a 20-minute `setTimeout` for the wall-clock kill; do not write a
  second spawn helper.
- `src/ffmpeg/metadata.ts` `getMetadata`: the library file's streams, with `disposition.forced`,
  `disposition.default`, `codec_type` and `codec_name`.
- `src/ffmpeg/params.ts`: the text and image subtitle codec sets (`070`). The reference must be a
  *text* codec. Import the set; do not restate it.
- `src/index.ts`: the `subtitleEmbedWorker` registration, copied for `subtitle-sync`.

## Steps

1. **Image (do first, NFR-3).**
   1. Add `python3` and `py3-numpy` (the Alpine package, so numpy is never compiled), plus a
      virtual `.ffsubsync-build` package (`build-base`, `python3-dev`).
   2. Install `ffsubsync==<pinned>` with `pip install --no-cache-dir --break-system-packages`.
   3. Remove the virtual package in the same `RUN`.
   4. Prove it on both architectures: `bin/build prod worker`, then `bin/cli worker ffsubsync
      --version` on amd64. For arm64, use the release workflow on an RC tag
      (`.github/workflows/release.yml`), never a hand-run `docker buildx` (Article I). Report the
      run's link.
   5. Record the image size before and after in the task report.

   If a dependency cannot build on musl, stop and report. Do not switch the base image inside this
   slice.
2. **Wire types.** `queue/types.ts` and `api/subtitle-sync-reports.ts`, matching `../spec.md`
   exactly; `isSidecar` in `subtitle-embed-reports.ts`.
3. **`sync-reference.ts`.** Pick the first stream with `codec_type === 'subtitle'`, a text codec and
   `disposition.forced !== 1`, as `SUBTITLE` with `s:<n>`, where `n` is its index among
   **subtitle** streams, not its absolute index. Otherwise take the audio stream with
   `disposition.default === 1`, else the first audio stream, as `AUDIO` with `a:<n>`. Return `null`
   when neither exists.
4. **`ffsubsync-output.ts`.** Parse the offset, the framerate scale factor and the score from the log
   lines `ffsubsync` prints at `INFO` level.
   1. **First, capture real logs** from the pinned version, for one subtitle-reference run and one
      audio-reference run, into `src/subtitles/fixtures/`. Write the patterns against those logs,
      not against memory.
   2. Return `null` when any of the three values is missing.
   3. Establish the sign: run `ffsubsync` on an `.srt` deliberately delayed by +2 s against its own
      reference. The parsed `offsetMs` must come out near `-2000` (the correction that undoes the
      delay, `101`'s convention). If `ffsubsync`'s number has the other sign, negate it in this
      function and nowhere else.
5. **`subtitle-sync.job.ts`.**
   1. Read `subtitleSyncDetails`, then report `subtitleSyncStarted`, abandoning on `false`.
   2. Run `getMetadata(filePath)` and pick the reference. `null` means `subtitleSyncFailed(id,
      sync_failed)`.
   3. Run `ffsubsync <filePath> -i <candidatePath> -o <tmp>/out.srt --reference-stream <spec>
      --max-offset-seconds 600` (add `--vad webrtc` for an `AUDIO` reference, so `ffsubsync` never
      falls back to a different subtitle stream on its own). Use the 20-minute kill.
   4. A non-zero exit, an unparseable log or the kill means `sync_failed`.
   5. Otherwise, report `subtitleSyncCompleted(id, offsetMs, framerateRatio, reference, score)`.
   6. Always remove the temp directory. Never touch `candidatePath`.
6. **`subtitle-embed.job.ts`.** Pass only the tracks with `isSidecar` to `deleteSidecars`. A staged
   track is read and embedded exactly as a sidecar is.
7. **`index.ts`.** Register the fourth `Worker`. It is constructed after the `054` lease and the
   `encodeWorkerStarted` announcement, like the other three, so `api`'s reconcile of `RUNNING`
   attempts happens before any new job starts.

## Contract obligations

The worker consumes `subtitleSyncDetails` and reports through the three mutations in `../spec.md`
exactly:

- `reference` is the enum name (`SUBTITLE`/`AUDIO`);
- `framerateRatio` is reported even when it is 1;
- `offsetMs` is an integer in `101`'s convention.

It handles every error:

- `subtitleSyncDetails` throwing `sync_not_found` (the search was deleted): log and abandon, with
  no report;
- `subtitleSyncStarted` answering `false`: abandon silently;
- report failures: `deliverReport` retries.

It reads `SubtitleEmbedTrack.isSidecar` and treats an absent value as `true`, for safety against an
older `api`.

## Tests

Owed under Article IX:

- `src/subtitles/ffsubsync-output.spec.ts`:
  - parses both captured fixtures;
  - returns `null` on a truncated log;
  - **the +2 s fixture yields a negative `offsetMs`**. A sign error doubles the desync of every
    embedded subtitle with no error anywhere.
- `src/subtitles/sync-reference.spec.ts`:
  - a forced English text track is skipped in favour of the next text track;
  - a PGS-only file falls back to audio;
  - the stream specifier counts within its type (`s:1`, not the absolute index);
  - default audio wins over first audio.
- `src/jobs/subtitle-sync.job.spec.ts`:
  - an `ffsubsync` exit 1 reports `sync_failed`;
  - the temp directory is removed on every branch;
  - `candidatePath` is never deleted;
  - `started → false` makes no report.
- `src/jobs/subtitle-embed.job.spec.ts`: a track with `isSidecar: false` is never passed to
  `deleteSidecars`, and a completed embed with only staged tracks carries no warning.

Not owed: the `index.ts` registration, the report modules' wire shape.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/npm worker run lint
bin/comments worker
bin/build prod worker
bin/cli worker ffsubsync --version
```

Typecheck is 0 errors. Tests are green, with the counts reported. `ffsubsync --version` prints the
pinned version. The arm64 build is reported with its evidence, along with the image size delta.

## Amendment 0.4.0 (2026-10-25)

See `../spec.md` § Amendments (2026-10-25, `spec_version` 0.4.0) and `../tasks.md` Group 5.

- `subtitle-sync.job.ts` adds `mediaDurationMs` (`Math.round(format.duration * 1000)`) to the
  completed report, from the `getMetadata` it already calls; `subtitle-sync-reports.ts` carries it.
- `lastChapterStartMs`: the last chapter's `start_time` in ms from the same probe (request
  chapters), `null` with fewer than 2 chapters. The worker reports it; `api` decides if it qualifies.
- A missing duration is `sync_failed`.

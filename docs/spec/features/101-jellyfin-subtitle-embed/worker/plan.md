---
title: Jellyfin Subtitle Embed — worker slice
service: worker
last_updated: 2026-10-23
status: Implemented
---

# PLAN: Jellyfin Subtitle Embed — `worker` (`worker/plan.md`)

## Scope

The worker consumes the new `subtitle-embed` queue and performs every write this feature makes to the
library:

1. a verified mkvmerge remux of one `.mkv` that appends the requested subtitles;
2. one atomic rename;
3. deleting exactly the sidecar `.srt` files it embedded.

It reads each sidecar where it lies, normalizes it (charset to UTF-8, offset applied, cues before
zero dropped) into a private temp directory, and reports the outcome back.

It does **not** talk to Jellyfin, decide which subtitles or which file (it reads that from
`subtitleEmbedDetails`), resolve track titles (they arrive resolved), or change anything about the
encode path.

Writes are confined to `services/worker/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/queue/types.ts` | Modified | Hand copy of `SUBTITLE_EMBED_QUEUE`, `SUBTITLE_EMBED_JOB`, `SubtitleEmbedJob` from `services/api/src/queue/types.ts` |
| `src/index.ts` | Modified | Third `Worker` on `SUBTITLE_EMBED_QUEUE`, `concurrency: 1`, constructed after `encodeWorkerStarted` like the other two, closed in the same shutdown path |
| `src/jobs/subtitle-embed.job.ts` (+ spec) | New | The handler |
| `src/subtitles/normalize-srt.ts` (+ spec, + fixtures) | New | Pure: bytes + offset → UTF-8 SRT text, or a charset error |
| `src/subtitles/embed-args.ts` (+ spec) | New | Pure: original ffprobe metadata + tracks → mkvmerge argv |
| `src/subtitles/verify-embed.ts` (+ spec) | New | Pure: original metadata + result metadata + requested tracks → accept/reject |
| `src/subtitles/sidecar-guard.ts` (+ spec) | New | Pure check: may this `sourcePath` be deleted, given `filePath` and the destinations root? |
| `src/api/subtitle-embed-reports.ts` | New | `subtitleEmbedDetails`, `subtitleEmbedStarted`, `subtitleEmbedCompleted`, `subtitleEmbedFailed` over `fetchGraphQL` |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | `subtitle_unreadable`, `charset_undetected`, `remux_failed`, `verify_failed`, `not_writable`, `sidecar_delete_failed` |

## Existing code to reuse

- `src/ffmpeg/capture.ts`'s `runFfmpegCapture(args, signal, { binary: 'mkvmerge', keepStdout: true })`,
  exactly how `src/disc/assemble-playlist.ts` runs mkvmerge.
- `src/disc/assemble-playlist.ts`: the exit-code rule (`0` or `1` is success, provided the output
  exists) and the stderr-tail `KeyedError` shape. Copy the rule, not the module.
- `src/ffmpeg/metadata.ts`'s `getMetadata(path)` for both ffprobe reads. Ignore `raw`.
- `src/api/deliver-report.ts`'s `deliverReport(label, send)` for `subtitleEmbedCompleted` and
  `subtitleEmbedFailed` (`038`).
- `src/paths/is-inside-root.ts` inside `sidecar-guard.ts`. The destinations root is not in the
  payload, so derive containment from `filePath`'s directory: the sidecar's `dirname` must equal it
  exactly after `resolve`, which is stricter than a root check.
- `src/i18n/keyed-error.ts` for every reportable failure.
- `src/ffmpeg/iso639.ts`'s `normalizeIso3` when comparing languages in verification.
- The `054` posture of `runner.ts`: the scratch `<final>.part.mkv` is cleared unconditionally before
  work starts.

## Steps

1. **Queue copy + index wiring.** Add the constants and type. Add the third `Worker` with the same
   unknown-job-name guard.
2. **`normalize-srt.ts`.** Decode in this order:
   1. a UTF-8 BOM, or valid UTF-8 (`TextDecoder('utf-8', { fatal: true })`);
   2. a UTF-16 LE/BE BOM;
   3. windows-1252, only if none of `0x81 0x8D 0x8F 0x90 0x9D` occur;
   4. otherwise `KeyedError(charset_undetected)`.

   Parse cues, tolerating CRLF, a missing trailing blank line, and both `,` and `.` millisecond
   separators. Add the offset to start and end. Drop a cue whose shifted end is ≤ 0, and clamp a
   shifted start below 0 to 0. Renumber from 1 and emit with `\n`, no BOM. Zero cues after the
   shift is `remux_failed` with a clear message, never an empty track.
3. **`embed-args.ts`.**
   - Base: `-o <part> <original>`.
   - When a requested track is default: `--default-track-flag <tid>:0` for **every** existing
     subtitle track (mkvmerge track ids for a Matroska input follow ffprobe's stream order; confirm
     with `mkvmerge -J` in the spec test if they diverge).
   - Then per new track, in request order: `--language 0:<iso3> --track-name 0:<title>
     --default-track-flag 0:<0|1> --forced-display-flag 0:<0|1> --sub-charset 0:UTF-8
     <normalized.srt>`.
   - No `--sync`. Audio/video flags are never mentioned.
4. **`verify-embed.ts`.** Accept only if all of these hold:
   - the result's first N streams match the original's N by `(codec_type, codec_name, normalized
     language)` in order;
   - the next M are subtitles matching the requested languages and forced flags in order;
   - nothing follows them;
   - `|Δduration| ≤ 1 s`;
   - when a default was requested, exactly one subtitle has `disposition.default` and it is that one.

   Otherwise `verify_failed`.
5. **`sidecar-guard.ts`.** True only if all of these hold:
   - `resolve(dirname(sourcePath)) === resolve(dirname(filePath))`;
   - `basename(sourcePath)` has no separator;
   - it ends in `.srt` (case-insensitive);
   - it differs from `filePath`.

   The handler additionally `lstat`s the path and requires a regular file (not a symlink) at
   deletion time.
6. **Handler `subtitle-embed.job.ts`**, in this order:
   1. `subtitleEmbedDetails(id)`;
   2. `rm <filePath>.part.mkv` (force);
   3. `subtitleEmbedStarted(id)`. On `false`, log `no longer queued, reporting nothing` and return;
   4. writability: `access(dirname, W_OK)`, plus owner preservable (the process owns the file, or a
      `chown` to the original uid/gid succeeds on a tiny probe file in the same folder, removed right
      after), else `not_writable`;
   5. `getMetadata(original)`;
   6. read each `sourcePath` (a read error is `subtitle_unreadable`) and normalize it into
      `mkdtemp(os.tmpdir())/<n>.srt`;
   7. mkvmerge;
   8. `getMetadata(part)` and verify;
   9. `chmod`/`chown` the part to the original;
   10. `rename(part, original)`;
   11. **only now**, for each track: guard, `lstat`, `unlink`. `ENOENT` is fine; any other failure or
       a guard refusal is logged and sets `warningKey = sidecar_delete_failed`, and the loop continues;
   12. remove the temp dir;
   13. `deliverReport(subtitleEmbedCompleted(id, warningKey))`.

   On any throw before step 10: remove the part file and the temp dir, then
   `deliverReport(subtitleEmbedFailed, key)`; a non-`KeyedError` maps to `remux_failed`. No sidecar
   is touched on that path. The original is never opened for writing.
7. **Reports module.** Four small functions, one GraphQL document each, typed by hand from the spec.

## Contract obligations

Consumed from `../spec.md` (v0.2.0):

- `subtitleEmbedDetails(id): SubtitleEmbedDetails!`, answered for any status. Each `sourcePath` is
  in `filePath`'s directory. Re-check it anyway with `sidecar-guard.ts`; never trust it blindly
  before an `unlink`.
- `subtitleEmbedStarted(id): Boolean!`. `false` means abandon silently.
- `subtitleEmbedCompleted(id, warningKey): Boolean!`. `warningKey` is `null` or
  `error.subtitleEmbed.sidecar_delete_failed`, nothing else. `jellyfin_refresh_failed` is `api`'s
  to write.
- `subtitleEmbedFailed(id, errorKey): Boolean!`. `errorKey` is one of `subtitle_unreadable`,
  `charset_undetected`, `remux_failed`, `verify_failed`, `not_writable` (full `error.subtitleEmbed.`
  prefix).
- Both outcome reports are safe to repeat and go through `deliverReport`.
- Queue `subtitle-embed`, job `subtitle-embed`, payload `{ subtitleEmbedId: number }`, copied by hand.

The contract is read-only. If it is wrong, stop and report.

## Tests

Owed under Article IX:

- `src/subtitles/normalize-srt.spec.ts`:
  - a cp1252 fixture with `¿Señor?` decodes intact;
  - a UTF-8 BOM is dropped;
  - `0x81` throws `charset_undetected`;
  - a negative offset drops a cue before zero and clamps a straddling one;
  - a positive offset shifts both ends;
  - CRLF parses.
- `src/subtitles/embed-args.spec.ts`:
  - with a default requested, every pre-existing subtitle gets `:0` and no audio/video track is
    named;
  - without one, no `--default-track-flag` on existing tracks;
  - the original comes first and the new tracks follow in request order;
  - no `--sync`.
- `src/subtitles/verify-embed.spec.ts`:
  - rejects a swapped or missing original track at equal counts;
  - rejects a 2 s drift;
  - rejects two defaults;
  - accepts `ger` vs `deu`.
- `src/subtitles/sidecar-guard.spec.ts`: refuses another directory, a `../` escape, a non-`.srt`
  name, and the `.mkv` itself; accepts a sibling `.spa.srt`.
- `src/jobs/subtitle-embed.job.spec.ts` (binaries and fs faked at the seam):
  - the scratch is removed **before** `subtitleEmbedStarted`;
  - `false` reports nothing;
  - mkvmerge exit `1` with output is success;
  - exit `2` reports `remux_failed`, removes the part, and leaves every sidecar;
  - a verify rejection never renames and leaves every sidecar;
  - success renames exactly once, after `chmod`/`chown`, and unlinks the sidecars only after the
    rename;
  - a failed unlink reports `COMPLETED` with `sidecar_delete_failed`;
  - an already-missing sidecar reports no warning;
  - the temp dir is removed on every branch.

Not owed: `src/api/subtitle-embed-reports.ts` (four GraphQL documents, no logic; a wrong field
fails loudly through `fetchGraphQL`).

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments worker
```

Typecheck is 0 errors. Tests are green, with the counts reported. Run the suite as uid 1000.

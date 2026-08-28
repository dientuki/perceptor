---
title: Optional compression — worker slice
service: worker
last_updated: 2026-08-28
status: Implemented
---

# PLAN: Optional compression — `worker` (`worker/plan.md`)

## Scope

`worker` reads `compressionEnabled` off the `processJob` payload and, when it is `false`, files the
source file into the library **without running ffprobe, ffmpeg or mkvmerge**. Everything else about
the job is unchanged and must stay unchanged: the destination folder still comes from
`buildOutputPath`, `encodeStarted`/`encodeCompleted`/`encodeFailed` are still reported, and the
cleanup instructions `encodeCompleted` returns are still executed — the torrent is still removed, the
download path is still deleted. "Compression off" means "no ffmpeg", never "no filing".

`worker` does **not** read the setting itself (`Query.settings` is administrator-only and this service
is a machine principal — the value arrives on the job), does not decide the policy, and does not touch
the Compression tab. It owns exactly one decision `api` does not make: the destination file's
extension (REQ-10).

Writes are confined to `services/worker/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/worker/src/encode/passthrough.ts` | New | A third `EncodeFn`: move the input to the destination, report 100, return `{ ffmpegCommand: '' }` |
| `services/worker/src/encode/passthrough.spec.ts` | New | Move semantics: same-filesystem, cross-device fallback, failure leaves no final-named file |
| `services/worker/src/paths/with-source-extension.ts` | New | Pure: swap the destination's extension for the source's |
| `services/worker/src/paths/with-source-extension.spec.ts` | New | The mislabelled-container failure |
| `services/worker/src/jobs/encode.job.ts` | Modified | `compressionEnabled` on the local type + query selection; the branch |
| `services/worker/src/jobs/encode.job.spec.ts` | Modified | New `describe`: the branch, and the NFR-2 skew guard |
| `services/worker/src/i18n/error-keys.ts` | Modified | `ERROR_ENCODE_MOVE_FAILED = 'error.encode.move_failed'` |
| `services/worker/src/i18n/messages.en.ts` | Modified | Its English rendering, with the `{detail}` param |

`src/encode/index.ts` is **not** modified: the passthrough is not an `ENCODE_DRIVER` and must not be
registered in `DRIVERS` (see `../plan.md` § Approach — an env var must never be able to override an
operator's stored switch).

## Existing code to reuse

- `src/encode/types.ts` — `EncodeFn`. The passthrough implements it unchanged:
  `(input, output, details, onProgress, onProbe)` → `{ ffmpegCommand }`. `services/worker/CLAUDE.md`
  § "The encode driver seam" is explicit that new encode behaviour goes behind this interface and
  never inline in a job handler. `onProbe` is ignored (`_onProbe`) — deliberately, there is no probe.
- `src/encode/encode.mock.ts` — the model for "put a real file at the destination safely": `mkdir`
  the destination folder, write to a temp sibling, `chmod 0o664`, `rename` into place. Its chmod
  comment explains why: `copyFile`/`rename` preserve the **source's** mode instead of respecting the
  process `umask(0o002)` set in `index.ts`, which is what lets a media server running as another uid
  in the same group write sidecars. The passthrough needs that same correction, for that same reason.
- `src/ffmpeg/runner.ts` — the `.part` discipline: never write under the final name, `rename` only a
  complete file, and delete the temp on any failure. The cross-device branch of the move must follow
  it exactly.
- `src/paths/is-inside-root.ts` — the containment predicate, already used by `cleanup-source.ts`.
  REQ-12: reuse it, do not write a second check. Note its own contract: an empty or non-absolute root
  returns `false`, so a drifted/missing `downloadsRoot` refuses rather than passing.
- `src/paths/build-output-path.ts` — unchanged. It keeps returning `.mkv`; the extension swap is a
  separate pure function applied by the caller, following this service's house pattern of small pure
  modules with narrow local input types (`OutputPathInput`, `CleanupInput`).
- `src/i18n/keyed-error.ts` + `messages.en.ts` — `KeyedError(key, renderMessage(key, params), params)`
  is how every throw site in this service carries its own key. `encodeFailed`'s `errorKey` is
  required; a new failure path needs a real key, not the `ERROR_ENCODE_UNEXPECTED` fallback.
- `src/jobs/cleanup-source.ts` — **read it, change nothing.** REQ-14 is a confirmation, not an edit:
  its `deleteInputFile` branch already calls `rm(inputFilePath, { force: true })`, a no-op on a path
  the move emptied, and the function never rethrows. Confirm both hold and move on.

## Steps

1. `src/i18n/error-keys.ts`: add `export const ERROR_ENCODE_MOVE_FAILED = 'error.encode.move_failed';`
   beside the other `ERROR_ENCODE_*` keys. `src/i18n/messages.en.ts`: import it and register
   `'Could not move the file to its destination: {detail}'`. Both files are hand-synced against the
   frozen contract — the key string must match `../spec.md` exactly.
2. `src/paths/with-source-extension.ts`: a pure `withSourceExtension(outputPath, inputPath): string`
   that returns `outputPath` with its extension replaced by `extname(inputPath)`. Rules: an input with
   no extension leaves the output's own extension alone rather than producing a bare name; the base
   name, the folder and every other part of the path are untouched (a title containing a dot —
   `The Super Mario Bros. Movie` — must not be mangled, which is why this replaces the **last**
   extension only, the same `/(\.[^./]+)$/` shape `runner.ts` and `encode.mock.ts` already use).
3. `src/encode/passthrough.ts`, implementing `EncodeFn`:
   - `mkdir(dirname(output), { recursive: true })` — right before the move, not earlier (the encode
     path deliberately does not leave an empty folder visible to the media server);
   - try `rename(input, output)`;
   - on `EXDEV` (source and library are routinely different disks — see `encode.ffmpeg.ts`'s own
     comment): `copyFile(input, partPath)` where `partPath` is the `.part` sibling of `output`, then
     `chmod(partPath, 0o664)`, then `rename(partPath, output)` (atomic — same filesystem), then
     `rm(input, { force: true })`. On any failure in this branch, `rm(partPath, { force: true })`
     before rethrowing, so no partial multi-GB file is left in the library;
   - on the same-filesystem `rename` path, `chmod(output, 0o664)` after the move, same reason;
   - `await onProgress(100)` once the file is at its final name — not before;
   - return `{ ffmpegCommand: '' }`;
   - every failure leaves the method as a `KeyedError(ERROR_ENCODE_MOVE_FAILED, …, { detail })`
     carrying the underlying message. Never swallow: this path reports failure or it reports success,
     and a swallowed error here would file nothing while the job reports `COMPLETED`.
4. `src/jobs/encode.job.ts`:
   - add `compressionEnabled: boolean;` to the local `EncodeJobDetails` type and
     `compressionEnabled` to the `processJob` query's selection set (both, or the field arrives
     `undefined` with no error — the drift this service's CLAUDE.md warns about twice);
   - inside the existing `try`, after `buildOutputPath`: branch on `details.compressionEnabled === false`,
     **never on falsiness** (NFR-2 — an `undefined` from a version skew must compress);
   - in the skip branch: verify `isInsideRoot(details.downloadsRoot, details.inputFilePath)` first and
     throw `KeyedError(ERROR_ENCODE_MOVE_FAILED, …)` naming the containment refusal in `detail` if it
     fails (REQ-12 — the relaxed path is not the one that skips a safety check); compute the
     destination as `withSourceExtension(outputPath, details.inputFilePath)`; call `passthrough(...)`
     with the same arguments `encode(...)` receives, and use its returned path for `encodeCompleted`;
   - leave everything else alone: `encodeStarted` still fires before the work, `encodeCompleted` still
     receives `{ out, cmd }` (with `cmd === ''` here), the `catch` still reports `encodeFailed`, and
     the cleanup block after the try/catch is untouched;
   - extend the existing `[encode] <id>:` log line, or add one beside it, stating whether the job is
     compressing. A live log that does not say which path a job took is how this feature becomes
     unfalsifiable in production.

## Contract obligations

`worker` consumes, on the `processJob` query it already makes:

```graphql
type EncodeJobDetails {
  compressionEnabled: Boolean!
}
```

- Non-null on the wire. The local type declares it `boolean`; the **runtime** guard is the `=== false`
  comparison, which is what makes a skewed or mis-selected field compress rather than skip (NFR-2).
  Do not "simplify" it to `if (!details.compressionEnabled)`.
- The field must be added to **both** the local type and the query string. Neither alone is enough,
  and neither failure produces an error.

`worker` owes back, unchanged in signature:

| Mutation | What this slice sends on the skip path |
| :-- | :-- |
| `encodeStarted(processJobId)` | as today, before the work starts |
| `encodeProgress(processJobId, progress)` | once, with `100` |
| `encodeCompleted(processJobId, outputFilePath, ffmpegCommand)` | the real destination path (with the source's extension) and `ffmpegCommand: ""` — the empty string is the contract, not a placeholder to improve on |
| `encodeFailed(processJobId, errorKey, errorParams, errorMessage)` | `errorKey: "error.encode.move_failed"`, `errorParams: {"detail": …}` |
| `recordFfprobe(file, ffprobe)` | **not sent** — there is no probe on this path (`../spec.md` § Out of Scope) |

The delta is read-only. If it looks wrong from here, stop and report — do not adapt it locally
(Constitution, Article VIII).

## Tests

Three units are owed one, and each defends a failure that produces no error anywhere. Every new spec
file opens with the paragraph naming that failure (Article IX).

- `src/paths/with-source-extension.spec.ts` — a `.mp4` source filed as `.mkv` is a mislabelled
  container. The move succeeds, the job completes, the folder looks right, and the media server is the
  only thing that ever complains. Cases: `.mp4`/`.avi`/`.mkv` sources; an extensionless input; a title
  containing a dot (`The Super Mario Bros. Movie (2023).mkv`) — only the last extension is replaced;
  the folder and base name are untouched.
- `src/encode/passthrough.spec.ts` — against a real `mkdtemp` with real files, the way
  `media-roots.service.spec.ts` does it, because the whole unit *is* filesystem behaviour and a mocked
  `fs` would prove nothing. Cases: the file lands at the destination with the right bytes and the
  source is gone; the destination folder is created; the file ends up mode `0664` even when the source
  is `0644`; a failure (unwritable destination) throws a `KeyedError` carrying
  `error.encode.move_failed`, leaves the source in place, and leaves **no** file bearing the final
  name and no `.part` sibling behind; `onProgress(100)` is called only after the file is at its final
  name; the return is `{ ffmpegCommand: '' }`. The `EXDEV` fallback cannot be produced in a single
  tmpdir — exercise it by forcing the `rename` to reject with an `EXDEV`-coded error and asserting the
  copy path runs, cleans up its `.part` on failure, and unlinks the source only after the destination
  rename succeeded.
- `src/jobs/encode.job.spec.ts` (extend; its `vi.mock` of `../encode`, `../paths/build-output-path`,
  `../api/graphql-client` and `./cleanup-source` is already in place) — the branch itself.
  `compressionEnabled: false` → `encode()` is never called, the passthrough is, `encodeCompleted`
  carries the swapped extension and `ffmpegCommand: ""`, and `cleanupSource` still runs with the same
  three instructions. `compressionEnabled: true` → today's path, untouched. **`compressionEnabled`
  absent → compresses** (NFR-2): this is the sharpest case in the slice, the same class of skew guard
  `allowedLanguageTags` already has a test for, and the one where a wrong answer silently stops
  transcoding an entire library.

Not owed: the two i18n files. A missing message throws loudly from `renderMessage`, and
`messages.en.spec.ts` already asserts every key in `error-keys.ts` has a rendering — add the key and
that existing suite covers it.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
```

`tsc` clean and the suite green, with the previous count plus the new files (re-measure rather than
citing the count in the root `CLAUDE.md`). Then live, with `api` running and the switch off: a job
completes with no `[ffmpeg] ejecutando:` line in the log, the file is at the destination with the
source's extension, the source is gone, and the `ProcessJob` row is `COMPLETED` with an empty
`ffmpegCommand` (AC-5, AC-6, AC-7).

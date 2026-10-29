# services/worker

Rules that outrank this file: `docs/constitution.md`. Agent brief: `.claude/agents/worker.md`.

BullMQ consumer, TypeScript on Node, `strict: true`. No HTTP ingress, no Prisma, no database — it
reaches `api` over GraphQL and Redis and nothing else. Run everything through `bin/npm worker …`
per the root Docker-first workflow.

## One queue per job kind, on purpose

`src/index.ts` opens separate BullMQ `Worker`s, all `concurrency: 1`:

| Queue | Job | Handler |
| :-- | :-- | :-- |
| `process` | `source-ready` | `src/jobs/source-ready.job.ts` — scans the finished download, inventories its files |
| `encode` | `encode` | `src/jobs/encode.job.ts` — transcodes and files the result |
| `subtitle-embed` | `subtitle-embed` | `src/jobs/subtitle-embed.job.ts` — remuxes one library `.mkv` with sidecar `.srt` tracks appended (`101`); since `107` amendment 0.4.0 each new track also gets `PERCEPTOR_SOURCE` (the api's `provenance`, sanitized by `src/subtitles/embed-tags.ts`) and `PERCEPTOR_OFFSET` (signed ms) through `mkvmerge --tags 0:<xml>`, nothing when `provenance` is absent; constructed after `encodeWorkerStarted` like the others |
| `subtitle-sync` | `subtitle-sync` | `src/jobs/subtitle-sync.job.ts` — runs `ffsubsync` on a staged `.srt` against the file's audio or a subtitle track (`src/subtitles/sync-reference.ts` picks it) and reports offset, framerate ratio, score, `mediaDurationMs` and `lastChapterStartMs` (`src/subtitles/chapters.ts`, a second `ffprobe -show_chapters`; `null` with fewer than 2 chapters); it never writes the library file, and a missing duration is `sync_failed` (`103`) |
| `subtitle-probe` | `subtitle-probe` | `src/jobs/subtitle-probe.job.ts` — reads a library file for the subtitle search (`107`): embedded non-forced subtitle `iso3` codes (`src/subtitles/embedded-languages.ts`), raw sidecar tags (`sidecars.ts`, exact `<base>.` prefix), file size and the OpenSubtitles hash (`opensubtitles-hash.ts`, read-only handle); `probe_not_found` and `started === false` report nothing, any throw reports `probe_failed`; concurrency 1, constructed after `encodeWorkerStarted` |
| `library-probe` | `library-probe` | `src/jobs/library-probe.job.ts` — reads a library file for the title's track languages (`108`): audio `iso3` codes (`src/subtitles/audio-languages.ts`, `und`/untagged dropped), embedded non-forced subtitle codes and raw sidecar tags (reusing `107`'s units); echoes the exact `filePath` `libraryProbeDetails` returned; any keyed details error or read failure logs and reports nothing (no failure report exists); read-only; concurrency 1, constructed after `encodeWorkerStarted` |

They are not job names on one queue. An encode can run for hours; sharing a queue at
`concurrency: 1` would either block every scan behind FFmpeg or risk N simultaneous FFmpegs. Each
`Worker` opens its own blocking connection, so the encode side can be busy for hours without
stalling the scan side.

`process.umask(0o002)` at the top of `index.ts` is load-bearing: the container runs as `PUID:PGID`,
and over the setgid library directories this yields `2775`/`664`, which is what lets a media server
running as a different uid in the same group write its own sidecar files into the folders the
worker creates. It is inherited by the FFmpeg/mkvmerge children, so `runner.ts` doesn't repeat it.

## Layout

Flat capability folders, not Nest-style modules. No path aliases — relative imports only.

```
src/index.ts             the three Workers, the umask, the signal handling
src/queue/types.ts       queue/job names and payload shapes
src/api/graphql-client.ts  fetchGraphQL — throws on json.errors, deliberately
src/i18n/                error-keys.ts · messages.en.ts · keyed-error.ts (see below)
src/jobs/                the two handlers, plus cleanup-source.ts (post-encode source deletion)
src/subtitles/          normalize-srt.ts (charset → UTF-8, offset applied) · embed-args.ts (mkvmerge argv) · verify-embed.ts (accept/reject the remux) · sidecar-guard.ts (may this .srt be deleted) — all pure (101); `103` adds sync-reference.ts · ffsubsync-output.ts (parses ffsubsync's report) · chapters.ts (the last chapter's start). `ffsubsync==0.5.1` is installed in the `base` image stage (python3/py3-numpy from apk, build deps removed in the same `RUN`)
src/scan/scan-folder.ts  enumerates a download's files, flags each isVideo — no longer selects a winner
src/scan/parse-episode.ts    SxxEyy over a base file name, null unless exactly one pair
src/scan/mark-downloaded.ts  flags each enumerated file isDownloaded against api's torrent-client answer (052)
src/scan/select-matches.ts   picks which files matter: single-winner or one-per-episode, over InventoriedFile[] (052) — isDownloaded: false is excluded before either rule runs
src/disc/                Blu-ray disc recognition, playlist choice and MKV assembly (see below, `100`)
src/encode/              the driver seam (see below) · subtitle-prune (the content-pruning resolver, `102`) · verdict-store (the Redis store every pre-encode verdict goes through, `111`)
src/ffmpeg/              buildCommand · params · variants · metadata · runner · remux-detection · iso639 · subtitle-content (pure C1–C3 rules, `102`)
src/paths/build-output-path.ts   composes the final library path, one branch per `libraryLayout` (`072`)
src/paths/library-layout.ts      `normalizeLibraryLayout`: unknown value warns, defaults to `jellyfin`
src/paths/is-inside-root.ts      pure containment check, used before any delete
src/metadata/container-tags.ts   buildContainerTitle · buildSourceTag — the two container-level tags
```

## The encode driver seam

`src/encode/types.ts` declares `EncodeFn`; `encode.mock.ts` and `encode.ffmpeg.ts` implement it;
`src/encode/index.ts` picks one from `ENCODE_DRIVER` (defaults to `mock`, and throws on an unknown
name). New encode behaviour goes behind that interface, never inline in a job handler — the mock
is what makes the surrounding workflow testable without FFmpeg.

`EncodeFn` takes two callbacks, and both exist for the same reason: the driver reports outward
rather than reaching for the network itself. `onProgress(progress, speed)` is the long-standing
one; `023-ffprobe-log` added `onProbe(file, ffprobe)`, invoked by `encode.ffmpeg.ts` right after
`getMetadata` returns and **before** `buildFfmpegCommand`, carrying the raw `ffprobe` stdout
(which is why `ffmpeg/metadata.ts` returns `{ metadata, raw }` instead of only the parsed object).
`jobs/encode.job.ts` owns the `recordFfprobe` GraphQL call behind it. Putting that call inside the
driver would have been shorter and wrong twice over — it would break the no-GraphQL rule above, and
the mock could not exercise it, so no test could reach it without FFmpeg. It is a **required**
parameter on purpose: an optional callback a call site forgets to pass compiles clean and records
nothing forever, with no error anywhere.

Since `053-downloads-panel-repair`, `onProgress`'s second parameter, `speed: number | null`, is
**required** for the identical reason `onProbe` is. `ffmpeg/runner.ts` parses FFmpeg's own
`speed=1.23x` off the same `-progress pipe:1` stdout stream it already reads `out_time_us=` from,
keeping the last successfully parsed value beside `progressInFlight` and passing that at report
time rather than requiring both fields to land in the same stdout chunk (a `-progress` block can
split across chunk boundaries). `speed=N/A` (the encoder's startup buffering) and anything
unparseable resolve to `null`, never throwing — a missing speed must never fail or slow an encode.
`encode.mock.ts` and `passthrough.ts` both pass explicit `null`: neither runs FFmpeg, so neither
has a speed to report, and inventing one would be worse than reporting none. `jobs/encode.job.ts`
forwards the value as `speed` on the same throttled `encodeProgress` call it already makes — no new
network call, no new cadence — sending `null` explicitly rather than omitting the GraphQL variable,
so the two cases (nothing parsed vs. nothing sent) stay distinguishable in `api`'s log. `0` is a
real multiplier at the start of an encode and is forwarded as `0`, never laundered into "no speed"
by a falsy check.

Since `047-source-deletion`, `EncodeFn` also takes a required `signal: AbortSignal`, added for the
same stated reason and wired through all three implementations (`encode.ffmpeg.ts` forwards it to
`runFfmpeg`; `encode.mock.ts` checks it between its steps; `passthrough.ts` checks it before the
move and after the `EXDEV` copy fallback, removing a partial copy on abort). Each throws
`EncodeCancelledError` (`src/encode/cancellation.ts`) when aborted — deliberately **not** a
`KeyedError`, since it must never reach a user or acquire a translation key; its whole purpose is to
be recognised and rethrown, unreported, before any GraphQL call happens. `jobs/encode.job.ts` calls
`registerEncode(processJobId)` before the encode and `releaseEncode` in a `finally`; `src/index.ts`
opens one ioredis subscriber on the `encode:cancel` channel (declared in `src/queue/types.ts`,
hand-synced from `services/api/src/queue/types.ts` the same way the BullMQ payload is) for the
process's lifetime, calling `cancelEncode(processJobId)` on each message. `ffmpeg/runner.ts` reuses
its existing `activeChild` (already pointed at whichever of FFmpeg/mkvmerge is running) and
`cleanupTemps()` (already removing both `<input>.working.mkv` and `<final>.part.mkv`) — an `abort`
listener kills `activeChild` with `SIGTERM`, then `SIGKILL` after a 10s grace, and the rejection that
follows is `EncodeCancelledError` rather than the usual ffmpeg/mkvmerge `KeyedError`.

Since `097-encode-stop`, the same arm also covers `error.encode.stopped` (the user stopped that file before it started), logging `stopped, reporting nothing`. Since `095-season-pack-per-file-encode`, `encode.job.ts`'s cancellation arm also covers `encodeStarted` being refused with `error.encode.discarded` (the user discarded that file before it started): it logs `discarded, reporting nothing`, reports no `encodeFailed` and rethrows `UnrecoverableError`, so BullMQ does not retry against an input `api` already deleted.

`EncodeInput` in `encode/types.ts` is a deliberate *subset* of `EncodeJobDetails`
(`jobs/encode.job.ts`), retyped locally rather than imported, so the driver isn't coupled to the
full shape of the GraphQL query. `paths/build-output-path.ts` does the same with `OutputPathInput`.
That is the house pattern for small pure modules here, not an oversight.

Since `046-encode-metadata-tags`, `EncodeInput` also carries two required, container-level tags:
`containerTitle` and `sourceTag`, both composed by `src/metadata/container-tags.ts` (a third small
pure module following the same local-type pattern) and populated at both `EncodeInput` literals in
`jobs/encode.job.ts` — never inside a driver. `src/ffmpeg/buildCommand.ts` writes them as
`-metadata title=<containerTitle>` and `-metadata PERCEPTOR_SOURCE=<sourceTag>`, appended right
after the existing `-map_metadata:g -1` strip so they survive it. `passthrough.ts` still ignores
`details` entirely and writes neither tag, by design.

`buildSourceTag(downloadsRoot, inputFilePath, downloadPath)` picks `sourceTag` from three branches,
in order: **loose file** — `downloadPath` resolves (`node:path`'s `resolve`, so a non-normalized
path still matches) to the same path as `inputFilePath`, meaning the source is an uploaded file
under `imports/<uploadId>/` rather than a release folder — returns `basename(inputFilePath)`, never
the empty string a naive relative-path computation produced before `058-compression-resolution`'s
REQ-17 fix; **folder** — `downloadPath` is a folder containing the input (a torrent) — returns the
input's path relative to that folder, unchanged since `046`; otherwise the existing
`downloadsRoot`-relative or base-name fallback applies. The fix lives entirely in `buildSourceTag`,
not in `src/paths/is-inside-root.ts`, which stays exactly as `047-source-deletion` left it for its
other caller, `jobs/cleanup-source.ts`'s deletion guard.

**A third `EncodeFn` exists that is never reachable through `ENCODE_DRIVER`.**
`src/encode/passthrough.ts` (`032-optional-compression`) implements the same interface — `mkdir`,
then move the input to the output (a same-filesystem `rename`, falling back to a copy + atomic
rename on `EXDEV`), never touching ffprobe/ffmpeg/mkvmerge, returning `{ ffmpegCommand: '' }`. It is
deliberately **not** added to `src/encode/index.ts`'s `DRIVERS` map: `jobs/encode.job.ts` calls it
directly when `details.compressionEnabled === false`, a value resolved by the api from the
`compression_enabled` setting at query time, not by an environment variable. This is the point —
an operator's stored switch must always win, including over a developer's local
`ENCODE_DRIVER=mock`. `withSourceExtension` (`paths/with-source-extension.ts`) corrects the output
path's extension to the source's own before the move, since `buildOutputPath` always assumes the
`.mkv` a real encode would produce.

## `src/queue/types.ts` is a deliberate copy

It duplicates `services/api/src/queue/types.ts`, which is the source of truth. The worker's Docker
build context is `./services/worker`, so the image physically cannot see `../api` — a shared import
is impossible without restructuring into workspaces.

**Do not "fix" this by inventing a shared package.** Do keep the two files in sync by hand: this is
a contract with no compiler across it, exactly like the GraphQL one. See
`docs/spec/graphql-contract.md`.

## Paths come from the job, never from env

`outputRoot` arrives already resolved in the `processJob` payload — `api` computes it from the
`path_movies`/`path_shows` settings against the declared roots (`services/api/src/media-roots/`).
The worker only `join()`s and `mkdir()`s on top of it.

The worker does **not** read `DOWNLOADS_DIR`/`DESTINATIONS_DIR`; it never read the former and the
latter was removed. Reintroducing an env lookup for a destination path violates Constitution,
Article V.

## Audio/subtitle/quality rules read a resolved list, never guess (`011-av1-transcode`)

Since `070-subtitle-format-selection`, `EncodeInput.allowedSubtitleFormats` (normalized by `src/encode/subtitle-formats.ts`, absent/`null` → the text formats, `[]` → no subtitles) is handed to `getSubtitleParams` as its second argument beside the language pair; text tracks are written SRT, image tracks copied, and text beats image per language.

`src/ffmpeg/params.ts`'s `getAudioParams`/`getSubtitleParams` take the allow-list `api` already
merged and resolved — they no longer derive their own `[original, 'spa', 'eng']`. Since
`039-per-title-language-split`, that is no longer one list feeding both functions: `EncodeInput`
carries an **audio pair** (`allowedAudioLanguagesIso3`/`allowedAudioLanguageTags`) handed to
`getAudioParams` and a separate **subtitle pair**
(`allowedSubtitleLanguagesIso3`/`allowedSubtitleLanguageTags`) handed to `getSubtitleParams`, plus
the mandatory `originalLanguageIso3` on the audio side only. This service never queries the
database and never re-derives either list from an env var (Constitution, Article III); a missing
edit to either `EncodeJobDetails` (`src/jobs/encode.job.ts`) or `EncodeInput`
(`src/encode/types.ts`) means one of the four fields silently arrives `undefined`, which reads as
"no preference of that kind" with no error anywhere.

`031-worker-language-variants` added the tag lists down that same path — the same merge expressed
in BCP-47 (`en`, `es-419`, `es-ES`) rather than collapsed to ISO-639-2/B. The collapse is lossy on
purpose: both Spanish variants resolve to `spa`, so the tags are the only thing that says *which*
Spanish the user asked for. Within each pair the iso3 list and the tag list are not interchangeable
and neither replaces the other — the iso3 list is still the only one compared against `ffprobe`'s
`tags.language`, and narrowing or dropping it breaks every encode in every language; the audio pair
and the subtitle pair are likewise independent of each other, and passing one where the other
belongs compiles clean (both are `string[]`) while silently selecting the wrong tracks.
`details.allowedAudioLanguageTags ?? []`/`details.allowedSubtitleLanguageTags ?? []` in
`handleEncode` are the **only** defensive normalization in that path — the two iso3 lists stay
undefended, so a missing one fails loudly instead of degrading; both rule functions take their
parameters as required, so a call site that forgets one fails to compile rather than silently
reverting to no preference. The existing `[encode] <id>:` log line prints all four lists, which is
how a live encode shows whether the seam is actually carrying them.

What the tags changed, in one sentence: a regional variant is now selected **only when the user
asked for it**. The unconditional Latin American title heuristic is gone — with no requested variant,
quality alone decides; with one requested and matched, it outranks quality; with one requested and
nothing in the file marked, every track of that language is kept for the user to prune by hand. The
rules themselves live behind the `ffmpeg` agent's door — see below and `.claude/agents/ffmpeg.md`
§ Rules A4, S5, L1, L2.

Every language comparison in `params.ts` goes through `src/ffmpeg/iso639.ts`'s `normalizeIso3`
first, on both sides. The seeded `languages` table stores ISO-639-2/**B** (`fre`, `ger`, `chi`,
`dut`, `cze`), but Matroska files commonly tag the same languages ISO-639-2/**T** (`fra`, `deu`,
`zho`, `nld`, `ces`) — comparing the raw strings silently drops a track the user actually asked
for.

A missing track in the title's **original** language is a hard failure — `getAudioParams` throws a
`KeyedError(ERROR_ENCODE_NO_ORIGINAL_AUDIO, { iso3 })`, which propagates out of `handleEncode`'s
existing `try` and is reported through `encodeFailed`, no new plumbing. A missing track in any
other allowed language is not an error; it's logged and skipped.

`src/ffmpeg/remux-detection.ts`'s `isRemux(metadata, filename)` replaced a filename-substring guess
in `buildCommand.ts` with a decision from the `ffprobe` metadata itself: a lossless audio track
(`truehd`/`mlp`/`pcm_*`/`dts` with a `DTS-HD MA` profile), or bits-per-pixel-per-frame ≥ 0.25 — read
from the video stream's `bit_rate`, then its `BPS` tag, then `format.size/duration`. **`ffprobe`
reports `avg_frame_rate` as a rational string** (`"24000/1001"`), never a plain number — parsing it
with `Number(...)` silently misclassifies every file as non-remux, forever, with no error anywhere;
`remux-detection.spec.ts` proves this by asserting the naive implementation gets the case wrong. The
filename substring is the last resort only, reached when no bitrate at all can be computed.

## Video quality branches on `contentKind`, not a boolean (`057-content-kind-classification`)

`src/ffmpeg/params.ts`'s `getVideoParams`/`getQuality` take `contentKind: ContentKind`
(`'LIVE_ACTION' | 'ANIME' | 'CGI'`, `src/encode/content-kind.ts`) instead of the old `isLiveAction`
boolean, which nothing on the `api` side had ever actually set. The SVT-AV1 parameter string is built
from three `switch` cases — `LIVE_ACTION`: `scm=0`, `aq-mode=2`, no `enable-qm`/`qm-min`,
`sharpness=0`; `ANIME` and `CGI`: `scm=2`, `aq-mode=2`, `enable-qm=1`, `qm-min=4`, `sharpness=2`;
each case's trailing grain terms are conditional since `092-film-grain-optimization` (see below).
**`ANIME` and `CGI` are written as two independent case bodies, not a
shared fallthrough arm**, even though they produce identical output today — the two are meant to be
tuned against each other, and the spec explicitly forbids collapsing them just because they currently
agree (Article X does not apply here; REQ-11 overrides it). `getQuality` keeps returning exactly the
values it always has — retyping its parameter changed nothing about CRF, which stays out of scope.

`src/jobs/encode.job.ts` resolves the payload's `contentKind` through
`normalizeContentKind()` **once**, before the compression branch: an absent, `null` or unrecognised
value degrades to `LIVE_ACTION` and logs a warning, never throws — the one place in this service's
encode path where a missing contract field is deliberately defended rather than left to fail loudly,
because an older `api` must never turn a routine encode into a failed job. The resolved kind is
never re-derived or re-validated anywhere else in the pipeline; it rides through `EncodeInput`
unchanged and shows up in the existing `[encode] <id>:` log line alongside the language lists.

## Video downscaling is bounded by `compressionResolution` (`058-compression-resolution`)

`EncodeJobDetails.compressionResolution` (a `String!` on the wire, one of `'4k' | '1080p' | '720p'
| '480p' | '360p'`) is the installation-wide resolution ceiling — resolved by `api` from the
`compression_resolution` setting at query time, the same timing as `compressionEnabled`, never
snapshotted onto the `ProcessJob`. `src/jobs/encode.job.ts` resolves it through
`normalizeCompressionResolution()` (`src/encode/compression-resolution.ts`) **once**, right beside
`normalizeContentKind`: an absent, `null` or unrecognised value degrades to `'1080p'` and logs a
warning, never throws — the same defensive posture as `contentKind`, for the same reason (an older
`api`, or a hand-edited row, must never turn a routine encode into a failed job). The resolved value
rides through `EncodeInput` unchanged and shows up in the `[encode] <id>:` log line.

`passthrough.ts` never reads it: with `compressionEnabled === false` the file is moved untouched, so
the ceiling has nothing to apply to (REQ-16) — the field is still computed and logged in
`handleEncode`, but only the compression branch's `EncodeInput` literal makes any decision from it.
What that decision is — which box each tier names, when a source counts as exceeding it, which
codecs get re-encoded to AV1 versus copied — lives in `src/ffmpeg/params.ts`, owned by the `ffmpeg`
agent; see the section below.

## Film grain is a boolean the worker resolves in the encode driver (`092-film-grain-optimization`, `094-automatic-grain-detection`)

`EncodeJobDetails.grainMode: EffectiveGrainMode!` (`'AUTO' | 'ON' | 'OFF'`, never `'INHERIT'` — `api`
has already resolved a title's own override against the installation setting before this service
ever sees it) reaches `src/encode/grain-mode.ts`. `normalizeGrainMode()` degrades an absent, `null`
or unrecognised value — including the literal `'INHERIT'` — to `'OFF'` and warns once;
`normalizeIsShort()` does the same for `EncodeJobDetails.isShort` (`false` plus one warning, never a
throw). Both follow the `contentKind`/`compressionResolution` posture.

**Resolution lives in the driver, not in `buildFfmpegCommand`.** `src/encode/encode.ffmpeg.ts` awaits
`resolveFilmGrain(details, input, metadata, signal)` right after `getMetadata`/`onProbe` and passes the
boolean into `buildFfmpegCommand(..., filmGrain)`, which stays synchronous and pure — so the
`services/worker/ffmpeg/` case corpus never spawns anything (NFR-5). `passthrough` and the `mock`
driver never enter `encode.ffmpeg.ts`, so with compression off nothing about grain runs (REQ-10 of
`092`, NFR-4 of `094`); `src/jobs/encode.job.ts` still gates `normalizeGrainMode()` on `compressing`.

`'ON'` → `true` and `'OFF'` → `false` short-circuit: neither stage runs. `'AUTO'` runs two stages, the
second only if the first passes:

- **Gate** (`src/encode/grain-gate.ts`, pure): `scoreGrainGate(metadata, inputPath, year)` sums
  weighted signals from the already-parsed `ffprobe` output (grain tags, codec-normalized
  bits-per-pixel-per-frame, lossless audio, disc/streaming markers read from the input path's parent
  directory plus basename — never `sourceTag`, which collapses to the bare filename — and the catalog
  year). Passes at score ≥ 2. A short film (`isShort`) stops here.
- **Probe** (`src/encode/grain-probe.ts`): a fixed measurement — five `cropdetect` samples, then nine
  six-second windows each encoded twice (grain synthesis off/on) at CRF 22, preset 8, at a
  `min(source, 1080p)` box that never reads `compressionResolution`, with the job's content-kind
  parameters built by the same `buildSvtav1Params` the real encode uses. Output goes to
  `-f matroska pipe:1` and only stdout bytes are counted; no scratch file exists. Passes when the
  saved bitrate is ≥ `GRAIN_PROBE_SAVED_MBPS_THRESHOLD` (0.886 Mbps, **provisional**: measured at
  CRF 24, to be refitted at CRF 22).

Definite verdicts are stored in Redis (`src/encode/verdict-store.ts`, kind `grain`, by `mediaSourceId`, `111`) (a season pack probes once;
a worker restart reuses the verdict). A failure is never cached and never fails the job: every non-cancellation
throw becomes `false` with one warning; `EncodeCancelledError` is rethrown untouched. Each resolution
prints one `[grain]` line naming the stage that decided and the figures. `src/ffmpeg/params.ts`'s
three `svtav1KindParams` cases substitute `film-grain=8`/`film-grain-denoise=1` for `film-grain=0`
when the boolean is true.

## Dub-card tail trim is resolved in the encode driver (`098-dub-card-tail-trim`)

`EncodeJobDetails.dubTrimEnabled` (the raw `dub_trim_enabled` setting; `api` does not combine it with
`compressionEnabled`) is gated on `compressing` in `src/jobs/encode.job.ts` and carried on
`EncodeInput.dubTrimEnabled`. When true, `resolveDubTrim` (`src/encode/dub-trim.ts`, called in
`encode.ffmpeg.ts` after `resolveFilmGrain`) runs `freezedetect` over the last 300 s of the **video
stream** (`videoEndSeconds` reads the stream duration, then its Matroska `DURATION` tag, then the
container) through `runFfmpegCapture` (`src/ffmpeg/capture.ts`, the AbortSignal-aware spawn moved out
of `grain-probe.ts`). The filter logs at info level, so the call must not pass `-v error`. A tail is
cut when the contiguous freeze run reaching the window end *ends* in at least 5 consecutive segments that
last a whole multiple of 2.002 s (a non-multiple last segment, truncated by the end of the file, is set
aside first; merged 4.004 s cards count) and at least 3 of them last exactly 2.002 s; whatever precedes
those trailing cards (fades, a logo) is not scored; the cut is the start of the whole run, returned as an absolute
second that `buildFfmpegCommand`'s `trimAt` folds into the single `-t` (the minimum with
`ENCODE_SAMPLE_SECONDS`). Progress uses the trimmed duration. A cut at or below 0 means keep.

Verdicts are stored in Redis (kind `dubtrim`, `111`) keyed by the **input file** (path, size and mtime; not `mediaSourceId`, since a
season pack has many files); a failure is never stored. It is a luxury, so a failed detection is
completely silent (no warning, no log) and the whole file is encoded; only `EncodeCancelledError`
propagates. A success prints one `[dubtrim]` line. The twelve real-file freeze logs (cuts and keeps, including the false-positive guards Haven S01E01, Arrival and Dawn of the Dragon Racers) the rule was
validated on live in `fixtures/dub-trim/` (excluded from the image by `.dockerignore`).

## Stream-end trim is resolved in the encode driver (`099-stream-end-trim`)

`EncodeJobDetails.streamEndTrimEnabled` (the raw `stream_end_trim_enabled` setting; `api` combines it
with neither `compressionEnabled` nor `dubTrimEnabled`) is gated on `compressing` in
`src/jobs/encode.job.ts` and carried on `EncodeInput.streamEndTrimEnabled`. When true,
`resolveStreamEndTrim` (`src/encode/stream-end-trim.ts`, called in `encode.ffmpeg.ts` after
`resolveDubTrim`) reads the last 300 s of **packet** timestamps with `ffprobe` (`-show_entries
packet=stream_index,pts_time,duration_time -of compact`, decoding nothing) through `runFfmpegCapture`'s
`{ binary: 'ffprobe', keepStdout: true }` option (stdout capped at 32 MB) and never from tags. Only the
first video stream and the audio tracks `selectAudioStreams` (extracted from `getAudioParams` in
`src/ffmpeg/params.ts`) keeps count. It cuts at `min(video end, longest kept audio end)` when the two
differ by more than 2 s; a kept track with no packet in the window means keep. `encode.ffmpeg.ts`
passes the minimum of this cut and `098`'s as `trimAt`, so `buildCommand.ts` and the progress
denominator are unchanged. Since `111` the verdict is stored in Redis (kind `streamtrim`), keyed by the input file plus the video index and the kept audio indices (so a `110` resolution that changes the kept set misses); a failure is silent, stores nothing and encodes the whole file, only
`EncodeCancelledError` propagates. A completed analysis prints one `[streamtrim]` line, `(reused)` on a hit.

## Subtitle content pruning is resolved in the encode driver (`102-subtitle-content-pruning`)

Which subtitle tracks survive is decided from their text as well as their tags. **C0** lives in
`selectSubtitleStreams` (`src/ffmpeg/params.ts`, extracted from `getSubtitleParams` like
`selectAudioStreams`): a stream with `disposition.comment === 1` or `commentary` as a whole word in its
title is returned in `commentary` instead of the candidates, before any rule counts tracks, and
`getSubtitleParams` logs `[subs] <index> drop (commentary)`. `resolveSubtitlePruning`
(`src/encode/subtitle-prune.ts`, called in `encode.ffmpeg.ts` after `resolveStreamEndTrim`, no
setting, compression path only) runs `selectSubtitleStreams`, groups the surviving **text** streams by
`normalizeIso3(tags.language)` and, only for a language with more than one, reads the first 900 s of
every such track in **one** `runFfmpegCapture` call (`extraOutputs`: one extra pipe per track, `-t 900`
as an output option after each `-map`, `-c:s srt -f srt`; no video or audio decoded). The pure rules in
`src/ffmpeg/subtitle-content.ts` (`pruneLanguage`) then apply: **C1** drops a track whose annotation
share (`[…]`, `(…)`, Unicode-uppercase `NAME:` labels; `♪` excluded) is at least 10 % only when another
track of the language is below it; **C2** collapses tracks with equal `NUMBER_OF_FRAMES`, starts within
0.25 s and at least 95 % identical normalised text, keeping the one with most italic cues, then
`default`, then the lower index; **C3** drops a track of at least 3 sampled cues and at most half the
other's size whose every cue's text is inside the overlapping cues of the other. The dropped indices
reach `buildFfmpegCommand` as a required `subtitleDrops` set, so the command stays pure. The verdict is
stored in Redis on success only (kind `subs`, `111`), keyed by the input file plus the qualifying text stream indices, so a settings change that alters the selection recomputes; a failure logs `[subs] read failed: …` and keeps every track,
and only `EncodeCancelledError` propagates. One `[subs] <lang> <index>:<cues>:<share>%=<outcome>` line
per group. Fixtures: `fixtures/subtitle-content/` (real 900 s samples with every word scrambled, plus
`manifest.json`; the film text is never committed).

## Blu-ray disc releases are assembled before the encode (`100-bluray-disc-remux`)

A **film** source (`movieId !== null`) whose files hold exactly one disc root (`BDMV/PLAYLIST/*.mpls`
and `BDMV/STREAM/*.m2ts`; `BDMV/BACKUP` never counts) is scanned by `src/disc/scan-disc.ts` instead of
`selectMatches`. `src/disc/mpls.ts` parses every playlist (45 kHz ticks, entry marks);
`select-playlist.ts` drops unplayable playlists (parse failure, clip missing or not downloaded) and
menu loops (distinct clip duration under half the total), keeps those within 1 s of the longest, then
prefers chapter marks, then the most marks; a remaining tie throws `error.source.disc_playlist_ambiguous`
(`{playlists}`) through `sourceScanFailed`. Only the winning `.mpls` is reported `isVideo: true`, so
the clips are never unmatched video and `cleanupDecision` removes the folder; with no playable
playlist the `.m2ts` files are `isVideo: true` and `api` derives `scan_no_downloaded_video` /
`scan_no_video` as before. `.m2ts` is deliberately not in `VIDEO_EXTENSIONS`. Episodes, seasons and
multi-disc releases keep the ordinary path.

`encode.job.ts` recognises a `.mpls` input and, after `encodeStarted` and before the compression
branch, runs `assemblePlaylist` (`mkvmerge -o <disc root>/<playlist>.perceptor.mkv <playlist>` through
`runFfmpegCapture`'s `binary: 'mkvmerge'`). Exit 0 and 1 (warnings) are success; anything else, or no
output file, removes the partial and throws `error.encode.disc_remux_failed` (`{code, stderr}`, the
tail of stdout + stderr — `mkvmerge` writes its errors to stdout). Both branches receive the assembled
file; `buildSourceTag` and `cleanupSource` keep the playlist. Since `111` a completed assembly is kept and reused: its size and mtime are recorded in the verdict store (kind `assembly`, by the `.mpls`) and a matching file is reused with `[disc] reused`, otherwise it is removed and assembled again. The `finally` removes the assembled file only after a delivered compressed encode (the passthrough move aside); a stop, cancellation or failure keeps it, and `api`'s residue deletion removes it with the download folder. Progress
stays at 0 during assembly; the disc files are never deleted on failure.

## The rules in `src/ffmpeg/` have their own agent and their own corpus

`services/worker/ffmpeg/` — outside `src/`, one JSON per case — holds the **verbatim `ffprobe`
output of a real file** plus the exact FFmpeg argument array it must produce.
`src/ffmpeg/cases.spec.ts` enumerates the directory and asserts the whole ordered command, so
adding a case is adding a file: no spec is edited and no factory helper transcribes a stream by
hand, which is what used to lose the one field that mattered (`disposition`, `NUMBER_OF_FRAMES`,
`side_data_list`). A case that must fail carries `"throws": "error.encode.…"` instead of `ffmpeg`.

The runner is built so it cannot report green while running less than the directory holds: a
malformed case fails collection naming the file, an empty directory is an error rather than a
vacuous pass, and `ENCODE_SAMPLE_SECONDS` is cleared per test because `buildCommand.ts` reads it
from the environment and would append `-t N` to every expectation. `ffmpeg/` is in `.dockerignore`
— it is test data and never ships in the image.

`params.spec.ts` stays alongside it, for the cases no real file reproduces — the ISO-639-2 `fre`/
`fra` pairing above all.

**`src/ffmpeg/` and `ffmpeg/` are owned by the `ffmpeg` agent** (`.claude/agents/ffmpeg.md`), not by
the `worker` agent. That file is also the **rule document**: what is kept and dropped for video,
audio and subtitles, and the regional-Spanish vocabulary. A rule change goes there and arrives with
the case that proves it.

As of `051-language-track-titles`, the track title written to the output is no longer worker-owned
data: `src/api/track-titles.ts` fetches `Language.trackTitle` from `api` once per encode job (a
`trackTitles` query, folded into a `Record<string, string>` and threaded through `EncodeInput`), and
`src/ffmpeg/params.ts` reads it as a parameter rather than a module constant. Only the four
regional-Spanish variant titles (`Latino`, `Español (España)`) stay worker-local, in
`src/ffmpeg/variants.ts`. An unreachable `api` or an unseeded language degrades to the bare ISO code
rather than failing the encode — adding a language's title is now a seed row on `api`, not a
`params.ts` edit.

## Post-encode cleanup, and where deleting a source lives (`012-post-download-processing`)

`src/jobs/cleanup-source.ts` remains the **post-success** path only: it runs after a source's own
encode finished and `api`'s `encodeCompleted` verdict says what to remove. It has no role in a
user-initiated delete — since `047-source-deletion`, `downloadDelete` on the api unwinds a source
mid-pipeline itself (queue withdrawal, encode cancellation, on-disk residue, the row), duplicating
this file's `rm`/`rmdir` logic across a service boundary that has no shared package, the same
accepted duplication as `src/queue/types.ts`. The two paths never call into each other.

`src/jobs/cleanup-source.ts`'s `cleanupSource(input)` is called from `encode.job.ts` **after** the
encode's own `try/catch` has closed — not from inside it — wrapped in a second `try` whose `catch`
only logs. That placement is the fix for what used to be the worst failure mode here: a cleanup
error (qBittorrent unreachable, `EACCES` on the download folder) could flip an already-`COMPLETED`
`ProcessJob`, and the film with it, back to `ERROR` — permanently, since neither queue configures
`attempts`. `cleanupSource` branches on `sourceKind`, not `infoHash`: every source kind is deleted
now, including a `LOCAL_FILE` (a tus upload), which previously had a null `infoHash` and was never
cleaned up at all. Before deleting anything it calls `isInsideRoot(downloadsRoot, downloadPath)`
(`src/paths/is-inside-root.ts`) and refuses, logging, if the path is not contained — `downloadsRoot`
arrives resolved on `EncodeJobDetails`, the same way `outputRoot` does; a missing or empty root is
treated as **refuse**, never as "everything passes".

**Since `013-season-pack-processing`, each of the three actions is behind its own flag** —
`removeTorrent`, `deleteInputFile`, `deleteDownloadPath`, all on `CleanupInput`, all computed
server-side by `api`'s `encodeCompleted` (see `docs/spec/graphql-contract.md`'s `013` section for
the verdict table) because only `api` can see a season pack's sibling `ProcessJob`s. `removeTorrent`
now calls `downloadRemove(mediaSourceId, deleteFiles: false)` — the worker owns every filesystem
deletion itself; qBittorrent is only asked to forget the torrent, never to touch its files.
`deleteInputFile` deletes the one episode's resolved file (`CleanupInput.inputFilePath`) behind its
**own** `isInsideRoot(downloadsRoot, inputFilePath)` check — deliberately separate from the
`downloadPath` guard above it, since an input file's path is not the same string and must not be
assumed contained just because the download folder is. `deleteDownloadPath` gates today's
`LOCAL_FILE`/recursive branch, unchanged.
Until `091-race-loser-cleanup`, the `removeTorrent` branch's own `downloadRemove` call was the one
place this "branches on `sourceKind`, not `infoHash`" claim did not hold: it was gated
`if (removeTorrent && infoHash)`, so a race won by an uploaded file (`infoHash` null) never called
`downloadRemove` and `api`'s loser sweep (`DownloadsService.unwindLosingSiblings`, see
`services/api/CLAUDE.md`'s `downloads/` section) never ran for it — two still-downloading torrents
with no error anywhere. The condition is now just `if (removeTorrent)`; `infoHash` stays destructured
for the filesystem branches above, which never depended on it. `encode.job.ts` reads `EncodeCompletedResult`'s three
booleans from the mutation response and, if any single one arrives `undefined` (a hand-typed
GraphQL selection missing a field — nothing catches this at compile time, see
`docs/spec/graphql-contract.md`'s "no codegen" section), skips `cleanupSource` entirely and
`console.error`s the missing field's name: a missing instruction is never read as `false` (silently
never cleaning up) and never as `true` (silently deleting something live).

## Recovering from a hard crash mid-encode (`054-interrupted-encode-recovery`)

`main()` in `src/index.ts` calls `src/api/encode-worker-started.ts`'s `reportEncodeWorkerStarted()`
**before either `Worker` is constructed**, wrapped in the existing `deliverReport` (so an
unreachable `api` retries rather than failing the bootstrap). This is the whole trigger for the
feature: a `ProcessJob` a dead run left reading `ENCODING` has no other signal that tells `api` it
is safe to touch, since neither an `api` restart nor a stale `updatedAt` can distinguish "dead" from
"a six-hour encode mid-`mkvmerge`, still alive." The call is sound only because exactly one `worker`
container ever runs — "I just booted" and "nothing is encoding" coincide under that assumption
alone, and a second replica would reconcile the first one's live encodes out from under it. That
assumption is no longer taken on faith: `src/lease/worker-lease.ts` takes a Redis lease
(`perceptor:worker:lease`, `SET NX PX` 30s, renewed every 10s, released on `SIGTERM`) **before** the
announcement, since announcing is the destructive act — a second instance never gets that far, logs
why and exits 1, which `restart: unless-stopped` turns into a visible crash loop rather than a
silent reset of someone else's encode. The arbiter is Redis rather than Docker because the invariant
is "one consumer of this queue", not "one container": `deploy: replicas: 1` in
`docker-compose.yaml` declares the default but `--scale worker=2` overrides it, and nothing in
Docker sees a one-off `docker compose run worker` or a second stack pointed at the same
`REDIS_HOST`. The acquisition window (60s) deliberately outlasts the TTL (30s) so a worker killed
hard can retake its own unexpired lease when Docker restarts it seconds later; a renewal that fails
mid-encode is logged and never fatal, since a Redis blip is not worth abandoning a multi-hour encode
and an `api` unreachable through the same outage would not be reconciling anything either. The
returned count is logged, never branched on — which jobs get skipped, failed or requeued is
entirely `api`'s decision, made against rows this service cannot see (no Prisma, no database).

Two other pieces close the loop, both inside `src/jobs/encode.job.ts`:

- `runner.ts`'s `cleanupTemps()` (removing `<input>.working.mkv` and `<final>.part.mkv`) now runs
  **before** spawning FFmpeg as well as on every exit path, unconditionally — a scratch file left by
  a crashed run must not collide with the encode that recovers it.
- An `EncodeCancelledError` and a `KeyedError` are both rethrown as BullMQ's own
  `UnrecoverableError`, so BullMQ never retries either — cancellation must still report nothing
  (`047-source-deletion`'s existing rule, unchanged), and a `KeyedError` has already reported
  `encodeFailed` with its own diagnosis, which would just recur identically on a retry. This is what
  makes it safe for `EncodeQueueService.addEncode` (api-side) to carry a small `attempts`/`backoff`
  at all: an unclassified throw is the only kind BullMQ retries, and the encode worker's own
  `failed` listener in `src/index.ts` reports `encodeFailed` (`error.encode.unexpected`) only once
  BullMQ has actually exhausted that budget, never for a job it plans to retry.

See `docs/spec/graphql-contract.md`'s `encodeWorkerStarted` section and `services/api/CLAUDE.md`'s
`process-jobs/` bullet for the reconciliation this triggers.

## Failures carry a translation key, never a rendered sentence (`018-ui-i18n`)

Every failure `encodeFailed` reports travels as a key plus interpolation params, not English prose
folded into a sentence. `src/i18n/error-keys.ts` transcribes this service's own keys
(`error.encode.*`) plus three keys **owned by `api`** and reused byte-identical
(`error.processJob.not_found`, `error.source.no_target`, `error.source.no_download_path`) —
nothing checks the two lists agree (`src/queue/types.ts`'s hand-sync pattern, same reasoning).
`src/i18n/keyed-error.ts`'s `KeyedError extends Error` carries `key`/`params`, so an existing
`throw`/`catch` site keeps working; `stderr`, exit `code`, `filePath` and `iso3` are always
**params**, never interpolated into the message string itself. `src/i18n/messages.en.ts`'s
`renderMessage(key, params)` produces the English `errorMessage` that still lands in
`ProcessJob.errorMessage` for anyone reading `bin/mysql` with no catalog.

`jobs/encode.job.ts`'s catch block reads `key`/`params` off a `KeyedError`, or falls back to the
catch-all `error.encode.unexpected` (carrying the raw message as a `detail` param) for a throw that
isn't one — `encodeFailed`'s `errorKey` argument is required, so a failure never reports with no
key. This service never reads a locale and never translates into anything but English; rendering a
key into the active UI language is `web`'s job — see `docs/spec/graphql-contract.md` § "UI
internationalization" for the full envelope and vocabulary.

## Errors must not be swallowed

`src/api/graphql-client.ts` throws on `json.errors`: `web`
renders errors to a user, but a worker that swallowed one would mark the job completed without
having written anything. Preserve that. A caught-and-logged error that lets a job report success is
this service's central failure mode. Since `018-ui-i18n`, if the incoming error carries
`extensions.i18n.key`, it is re-thrown as a `KeyedError` so an `api` key round-trips as a key
instead of unreadable stringified JSON; the three boot-time infrastructure errors in this same file
(`INTERNAL_GRAPHQL_URL`/`SERVICE_TOKEN` unset, a non-2xx HTTP status) stay plain, unkeyed `Error`s
on purpose — no user ever sees them. A rejecting `fetch` itself — `api` unreachable, not `api`
answering — is its own class, `ApiUnreachableError` (`038-encode-report-durability`), thrown only at
that one site; every other failure below it stays terminal.

**`jobs/source-ready.job.ts` reports a failed scan** (`065-pipeline-error-resume`): any failure
before or at `sourceScanned` goes to `api` through `deliverReport` → `sourceScanFailed` (a
`KeyedError` keeps its key, anything else becomes `error.source.scan_failed` with `{ detail }`) and is
rethrown as `UnrecoverableError`. Before it, a throwing scan left the source `READY` and the row
reading "downloaded" forever.

**`jobs/encode.job.ts` no longer swallows a lost `encodeCompleted`/`encodeFailed`
report** (`038-encode-report-durability`, the incident this feature exists for: an encode that
succeeded got reported as failed, then that failure report itself was lost to
`.catch(console.error)`, because both mutation calls sat inside the encode's own `try/catch` and the
`encodeFailed` call swallowed its own transport error). The fix is structural, not a retry bolted on
top: the `encodeCompleted` call now sits **outside** the `try` that wraps the encode itself, so a
transport failure delivering the good news can never be read by the `catch` as an encode failure.
Both outcome calls go through `src/api/deliver-report.ts`'s `deliverReport()`, which retries
forever — with growing, capped backoff — only on `ApiUnreachableError`, and rethrows any other error
(a real rejection from `api`) immediately. The encode queue's `concurrency: 1` is what makes
blocking on that retry acceptable rather than a new failure mode: one wedged report holds its own
job, never anyone else's.

**Two further documented exceptions.** First, `cleanup-source.ts` catches and logs every error it can produce —
a throwing `fetchGraphQL` (torrent client unreachable) or a throwing `rm`/`rmdir` — instead of
letting it propagate. This is deliberate, not an oversight: cleanup runs after the encode has
already succeeded and the `ProcessJob` already reports `COMPLETED`; letting a cleanup failure
propagate would demote a job that produced a perfectly good file.

Second, `jobs/encode.job.ts`'s `onProbe` catches every error `recordFfprobe` can produce — `api`
unreachable, a stale `SERVICE_TOKEN`, the mutation rejecting the payload — logs one line and
continues the encode (`023-ffprobe-log` NFR-1). Same reasoning as `cleanup-source.ts`: the ffprobe
log is diagnostic, and a diagnostic write must never demote a job that produced a good file. The
`try/catch` wraps the `fetchGraphQL` call and **nothing else** — widening it to cover the probe
would turn a real `ffprobe` failure into a silent skip, and the encode would run on with no
metadata. `encode.job.spec.ts` has a case pinning exactly that.

Note what this exception costs: a recording failure is invisible outside the worker log, so a
miswiring on the `api` side (`AdminGuard` reaching `recordFfprobe`) leaves `ffprobe_logs` empty
forever with nothing failing anywhere. That is why the guard split is asserted by a test in `api`
rather than trusted.

Same reasoning applies to long-running work: `ffmpeg/runner.ts` handles signals for the whole
duration and writes through a working path before an atomic move, so a killed container never
leaves a half-written file at the destination.

## Dev loop

| Command | What |
| :-- | :-- |
| `bin/npm worker run dev` | `tsx watch src/index.ts` |
| `bin/cli worker npx --no tsc --noEmit` | typecheck — today the only real gate, against `tsconfig.json` (covers `src/**/*`, including `*.spec.ts`) |
| `bin/npm worker run build` | `tsc -p tsconfig.build.json` — the `prod` image's `builder` stage runs this; `tsconfig.build.json` extends `tsconfig.json` but excludes `**/*.spec.ts`, so `dist/` ships no test code (`015-reproducible-image-builds`) |
| `bin/npm worker test` | `vitest run` — as of `057-content-kind-classification` (2026-09-15, re-run rather than trusted): 21 suites, 192 tests, 190 passing — the 2 failures are the same pre-existing, unrelated ones (`src/ffmpeg/cases.spec.ts`'s stale `2.json` track-title fixture, `src/ffmpeg/buildCommand.spec.ts`'s CRF mismatch), confirmed unchanged. `057` added `src/encode/content-kind.spec.ts` (the `normalizeContentKind` degradation cases) and extended `src/ffmpeg/params.spec.ts`/`buildCommand.spec.ts`/`cases.spec.ts` for the three `contentKind` branches, moving both `ffmpeg/1.json` and `ffmpeg/2.json` off the retired `isLiveAction` boolean. Earlier history — as of `053-downloads-panel-repair` (2026-09-11): 20 suites, 178 tests, 176 passing — the 2 failures are pre-existing and unrelated (`src/ffmpeg/cases.spec.ts`'s stale `2.json` track-title fixture, `src/ffmpeg/buildCommand.spec.ts`'s CRF mismatch), both in `src/ffmpeg/` territory owned by a different agent. `053` added the `encodeProgress` seam cases to `src/jobs/encode.job.spec.ts` (a driver reporting a speed, one reporting `null`, and `0` forwarded as `0` rather than laundered by a falsy check). Earlier history: spec `031` added `src/ffmpeg/variants.spec.ts` and took `src/ffmpeg/params.spec.ts` from 15 cases to 28 for the regional-variant rules (spec `024` before it deleted a startup-probe module's spec outright and reset the case corpus to one file — `ffmpeg/cases.spec.ts` still runs 1 case, authored by the user and read as the requirement); `023-ffprobe-log` added three cases to `src/jobs/encode.job.spec.ts` for the probe-recording order and its swallowed failure (`018-ui-i18n` added `src/i18n/messages.en.spec.ts` and extended `src/jobs/encode.job.spec.ts`/`src/api/graphql-client.spec.ts` for the keyed-error path; `013-season-pack-processing` added `scan/parse-episode.spec.ts` and `scan/select-matches.spec.ts`, and extended `cleanup-source.spec.ts` for the three gated flags; `011-av1-transcode` added the first three real specs; `012-post-download-processing` added `is-inside-root.spec.ts`, `cleanup-source.spec.ts` and `scan-folder.spec.ts`) |
| `docker compose logs -f worker` | the job loop |

## Known debt

- **Test coverage is still partial** *(less so in `src/ffmpeg/`, which now has the case corpus above)*.
  `011-av1-transcode` added `vitest.config.ts` and the first
  real specs (`src/ffmpeg/remux-detection.spec.ts`, `src/ffmpeg/params.spec.ts`,
  `src/ffmpeg/buildCommand.spec.ts`, alongside the pre-existing `src/api/graphql-client.spec.ts`) —
  the rule-dense files that decide *what* an encode keeps are now covered. `012-post-download-processing`
  added the first specs for the flow around the encode (`src/paths/is-inside-root.spec.ts`,
  `src/jobs/cleanup-source.spec.ts`, `src/scan/scan-folder.spec.ts`). `paths/build-output-path.ts`,
  `ffmpeg/runner.ts` and `handleEncode`'s own orchestration in `jobs/encode.job.ts` still have none.
  A wrong FFmpeg argument or a wrong output path on an uncovered path still produces a job marked
  `completed` and a file nobody can find — no error in any log (Constitution, Article IX).
- **No linter or formatter.** No ESLint, no Prettier, no Biome — `api` has the first two, `web` has
  Biome, this service has nothing. Match the surrounding file by eye.
- **Dependency skew with `api`**: `@types/node` ^22 vs ^24 (`ioredis` is ^6 in both `package.json` files; a checkout whose `node_modules` predates that may still run 5.x, with the same option names `111` uses). Not
  currently causing trouble; worth knowing before debugging a Redis behaviour difference.
- FFmpeg and mkvtoolnix are installed in the `base` stage of `services/worker/Dockerfile`, shared
  by `dev` and `prod`. Since spec `024`, the worker's HDR handling is a plain downscale that
  preserves colour tags, on CPU, unconditionally — no filter chain choice, no device probe, no
  render-node mapping anywhere in the stack. One Alpine sub-package spec `024` set out to remove
  could not fully go: one of `ffmpeg`'s own components links a GPU-rendering library that Alpine's
  package manager reinstalls transitively even with no explicit line naming it. It sits on disk,
  linked by nothing — see spec `024`'s REQ-4 (`docs/spec/features/`) for why removing it outright
  would mean compiling `ffmpeg` from source, out of proportion to a demolition feature.

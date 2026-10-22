---
title: Blu-ray Disc Remux — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-21
status: Implemented
---

# PLAN: Blu-ray Disc Remux (`plan.md`)

## Approach

The feature is almost entirely `worker`, in two places that already exist.

**Scan** (`services/worker/src/jobs/source-ready.job.ts`). Before the ordinary
`selectMatches` runs, a film source (`movieId !== null`, never an episode or a season) is checked
for exactly one disc root: a directory holding `BDMV/PLAYLIST/*.mpls` and `BDMV/STREAM/*.m2ts`.
`BDMV/BACKUP/PLAYLIST` is not a disc root (it has no `STREAM`), so a disc's backup copies are never
counted as a second disc. When a disc is found, a new pure module set under `src/disc/` reads every
playlist, discards unplayable and looped ones (REQ-15), applies REQ-2's ordering and tie-breaks,
and returns one of three outcomes: a winning playlist, an ambiguous tie, or nothing playable. The
result goes to `api` through the **unchanged** `sourceScanned`/`sourceScanFailed` mutations; only
the `isVideo` flags the worker reports change for a disc release (see the worker plan's table).

The playlists are parsed by a small TypeScript MPLS reader rather than by `mkvmerge -J`. The real
alternative was asking `mkvmerge` to identify each playlist; it was rejected because (a) REQ-15
needs each play item's clip and in/out times, which `-J` does not expose, (b) a disc can carry
hundreds of decoy playlists and one subprocess per playlist would turn a sub-second scan into
minutes on the `process` queue, and (c) a pure parser over a `Buffer` is unit-testable without any
binary, which is what Article IX asks of a rule that fails silently by picking the wrong film.

**Encode** (`services/worker/src/jobs/encode.job.ts`). When `inputFilePath` ends in `.mpls`, the job
calls a new `src/disc/assemble-playlist.ts` **after** `encodeStarted` and **before** the
`compressionEnabled` branch: `mkvmerge -o <assembled> <playlist>`, spawned through the existing
AbortSignal-aware `runFfmpegCapture` (`src/ffmpeg/capture.ts`, widened to accept the `mkvmerge`
binary). Both branches then receive the assembled path in place of `inputFilePath` — the existing
`passthrough` moves it into the library with its `.mkv` extension (REQ-7), the existing
`encodeFfmpeg` probes and transcodes it (REQ-8). `buildSourceTag` keeps receiving the original
playlist path, so `PERCEPTOR_SOURCE` names the release, not the intermediate file. `mkvmerge` was
already installed for `runner.ts`'s final mux, so NFR-3 holds with no Dockerfile change, and it is
the tool that reads a playlist's clips in order and their languages from `CLIPINF`.

`api` is untouched: it stores the two new keys verbatim, as it does every worker key. Failure and
retry behaviour is the existing one — `sourceScanFailed`/`encodeFailed` delete nothing, Play
resumes from the failed stage (`065`), and the `091` race sweep retires a failed disc source once a
hand-imported upload of the same film delivers (the REQ-14 amendment made at plan time).

`web` adds two catalog entries and nothing else; `DownloadErrorLine` already renders any
`error.*` key through `translateErrorKey` with the source's `errorParams`.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `web` | Two catalog strings. Shipping them first means the first live failure already renders translated rather than falling back to the English `errorMessage`. |
| 1 | `worker` | Scan recognition, playlist selection, assembly. Independent of `web` once the keys are frozen. |
| 2 | `[docs]` | `docs/spec/graphql-contract.md` worker error rows, `services/worker/CLAUDE.md`, root `CLAUDE.md` pipeline table, `docs/spec/history.md`. |
| 3 | `[verify]` | Typecheck, tests, catalog parity, then the manual pass on a real BDMV. |

`web` and `worker` run **in parallel**: the contract is two key strings and their params, frozen
below. No `api` step exists.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will be tempted to change and must not:

- **No new GraphQL field for the disc.** It will look natural to add a `MediaSource.isDisc` or to
  send the disc root separately. Don't: the main playlist's path *is* the match's `filePath`, and
  `encode.job.ts` recognises it by its `.mpls` extension. `api` never needs to know.
- **`error.source.disc_playlist_ambiguous` is reported through `sourceScanFailed`, not through
  `sourceScanned` with zero matches.** Zero matches would make `api` pick `scan_no_video`, losing
  the specific message that tells the user to assemble the film by hand.
- **Param names are `playlists` (one comma-separated string) and `code`/`stderr`.** `web`'s
  interpolation reads exactly these names; an array or a renamed param renders as a literal
  `{playlists}` with no error anywhere.
- **The m2ts extension list stays unchanged** in `scan-folder.ts`. Adding `.m2ts` to
  `VIDEO_EXTENSIONS` looks like the obvious first step and breaks AC-8 (loose clips must still end
  in `scan_no_video`).

## Migrations

None.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| MPLS parsed wrong (offsets, 45 kHz ticks, big-endian) | Wrong playlist chosen; a scrambled or partial film is filed with no error anywhere | Pure parser with tests over synthetic buffers built from the format's documented layout, plus real `.mpls` fixtures under `services/worker/fixtures/bdmv/` as soon as a disc is available (manual pass step 1) |
| `mkvmerge` exits `1` (warnings) on a perfectly good assembly | Every disc encode fails with `disc_remux_failed` | Only exit `≥ 2` (or a missing output file) is a failure; a test pins exit `1` as success |
| `mkvmerge` writes its errors to **stdout**, not stderr | `{stderr}` param arrives empty and the user sees a useless message | The `stderr` param is the tail of stdout + stderr combined; a test pins it non-empty on a scripted failure |
| `mkvmerge` does not pick up `CLIPINF` languages on some disc | Tracks tagged `und` | Not silent: the original-audio rule fails with `error.encode.no_original_audio`. AC-3 checks a real disc |
| The assembled file outlives the job (success with compression on, failure, cancel, crash) | Tens of GB left in the downloads root, invisible | Removed on every exit path except the passthrough move, and removed before every assembly (crash recovery, `054`); it lives inside the download folder so `047`/`067`/`013` removals cover it too |
| Disc files flagged `isVideo: true` | `hasUnmatchedFiles` keeps the download folder forever after a successful encode | Flag table in the worker plan, asserted by test; AC-5 checks the folder is gone |
| An episode or season source with a `BDMV` tree gets the disc path | A series disc assembled as one "episode" | Recognition gated on `movieId !== null`; test covers an episode source with a disc |
| Ordinary releases change behaviour | Regression across every encode | NFR-4: existing scan specs and the `ffmpeg/` corpus stay unchanged and green |

## Verification

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/npm web run lint
bin/cli web node scripts/check-messages.mjs
bin/comments worker
```

Manual pass, on a real unencrypted BDMV film release (AC-1…AC-15):

1. Copy that disc's `BDMV/PLAYLIST/*.mpls` into `services/worker/fixtures/bdmv/<title>/` and add a
   test asserting the playlist the selector picks (the real-file counterpart to the synthetic
   tests).
2. Compression on: add the release, watch the source reach `SCANNED` with the main `.mpls` as its
   match (`bin/mysql -e 'select filePath from source_files where mediaSourceId=…'`), the job read
   `ENCODING` at 0 % during assembly, and the library hold one AV1 `.mkv` whose duration matches the
   playlist (AC-1, AC-4, REQ-11). `ffprobe` it: original audio carries its real ISO code (AC-3).
   The download folder is gone afterwards (AC-5).
3. Compression off: same release → one `.mkv` in the library that Jellyfin plays (AC-2).
4. Stop the encode during assembly, check `ps` in the worker shows no `mkvmerge` and no
   `*.perceptor.mkv` remains; Play completes (AC-9). Repeat with Delete.
5. Delete one referenced `.m2ts` after the scan, Play: `disc_remux_failed`, disc files intact
   (AC-6); restore it, Play completes without re-downloading (AC-10).
6. Deselect every `.m2ts` in qBittorrent: `scan_no_downloaded_video` (AC-7). A `.iso`, a folder of
   loose `.m2ts`, and a season pack disc: `scan_no_video` (AC-8).
7. Decoy, loop and sample cases (AC-11, AC-12, AC-13, AC-15) on real discs when one is at hand;
   otherwise they stay covered by the synthetic selector tests and are listed in
   `docs/spec/pending-acs.md` as blocked on a disc.
8. AC-14: on AC-13's failed source, import a hand-assembled `.mkv`; the film encodes from it and the
   disc source is swept.

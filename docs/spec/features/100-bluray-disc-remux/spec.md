---
title: Blu-ray Disc Remux
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-21
last_updated: 2026-10-21
status: Implemented
services: [worker, web]
---

# SPEC: Blu-ray Disc Remux (`spec.md`)

## Context & Goal

Some releases are not a video file but a copy of the disc itself: a `BDMV/` tree with the film split
across `BDMV/STREAM/*.m2ts` clips, stitched together by `BDMV/PLAYLIST/*.mpls` playlists whose
`BDMV/CLIPINF/*.clpi` companions carry the track languages. Perceptor does not understand that
shape today. `services/worker/src/scan/scan-folder.ts` does not count `.m2ts` as video at all, so
`source-ready.job.ts` resolves no match and `api`'s `sourceScanned` writes the source to `ERROR`
with `error.source.scan_no_video`. Even if `.m2ts` were added to the list, the "largest file wins"
rule of `select-matches.ts` would pick one clip — often only a segment of the film, sometimes an
extra — and the clip itself carries no language tags, so the encode's original-audio rule
(`error.encode.no_original_audio`) would fail or pick the wrong track.

This feature teaches the worker to recognise a Blu-ray disc structure for a **film**, pick its
main playlist, and assemble the feature into one Matroska file — with the disc's own track
languages — under the downloads root, before anything else in the encode job runs. Only then does
the job make its usual decision: with compression on, the assembled MKV is the input FFmpeg
transcodes; with compression off (`032-optional-compression`), the assembled MKV is what gets moved
into the library for the media server, instead of a playlist file nobody can play. Every downstream
behaviour — scan inventory, race arbitration, encode stop/cancel/recovery, cleanup — stays the
existing one.

Pipeline stages touched: **Scan files, inventory** (recognising the disc and its main playlist) and
**Transcode** (assembling the MKV before the compression branch, in `jobs/encode.job.ts`). No stage
is added or removed and `api` is untouched: the scan reports through the existing
`sourceScanned(files, matches)` and the encode through the existing `encodeCompleted`/
`encodeFailed`. `web` only gains the catalog strings of one new worker error key.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Disc recognised at scan)**: When a **film** source's download contains exactly one
      Blu-ray disc structure (a `BDMV` directory holding both a `PLAYLIST` directory with at least
      one `.mpls` and a `STREAM` directory with at least one `.m2ts`), at any depth below the
      download path, the scan must treat that disc as the source's video instead of looking for a
      loose video file inside it.
- [ ] **REQ-2 (Main playlist)**: The scan must pick the disc's main playlist: the playlist with the
      longest total duration among those whose every referenced clip is present and, for a torrent
      source, downloaded (`052`'s `downloadedFiles`), after discarding looped playlists (REQ-15).
      That playlist is the source's single match.
      When several playlists tie on duration (within 1 s) — the decoy-playlist scheme some studios
      ship — the one that carries chapter marks wins. If more than one tied playlist carries
      chapters, the one with the most chapter marks wins. If a tie still remains, the scan must not
      guess: the source fails as REQ-13 describes.
- [ ] **REQ-3 (No playable playlist ⇒ today's error)**: If the disc has no playlist whose clips are
      all present, the scan must resolve no match and the source must end exactly as it does today:
      `error.source.scan_no_downloaded_video` when some referenced clip exists but is not downloaded,
      `error.source.scan_no_video` otherwise. No new scan error key.
- [ ] **REQ-4 (Clips are not loose videos)**: The `.m2ts`/`.mpls`/`.clpi` files of a recognised
      disc must never be reported as unmatched video. A successfully encoded disc release therefore
      leaves no "something was discarded" residue (`013` REQ-11) and its download folder is cleaned
      up the same way a single-file film release's is.
- [ ] **REQ-5 (Assemble before the compression decision)**: When the encode job's input is a disc
      playlist, the worker must first assemble that playlist into one Matroska file and only then
      continue the job; both the compression-on and the compression-off branches consume that
      assembled file, never the playlist.
- [ ] **REQ-6 (Disc languages survive)**: Every audio and subtitle track of the assembled file must
      carry the language the disc declares for it, so the existing audio/subtitle selection rules
      (`011`, `031`, `039`, `070`) — including the hard failure for a missing original-language
      track — run against real language tags, not `und`.
- [ ] **REQ-7 (Compression off ⇒ an MKV in the library)**: With compression off, the file filed in
      the library must be the assembled `.mkv` (extension `.mkv`, never `.mpls` or `.m2ts`), at the
      same destination a single-file film release would get.
- [ ] **REQ-8 (Compression on ⇒ unchanged encode)**: With compression on, everything after assembly
      — `ffprobe`, the recorded `FfprobeLog`, grain resolution, dub-card and stream-end trims, the
      FFmpeg command, the output path — must behave as it does for an ordinary `.mkv` input. The
      `PERCEPTOR_SOURCE` tag (`046`) must still name the release's playlist path, not the
      intermediate file.
- [ ] **REQ-9 (Assembly failure is reported)**: If assembly fails (the assembler exits non-zero, a
      referenced clip disappeared, the downloads volume ran out of space), the job must fail through
      `encodeFailed` with the new key `error.encode.disc_remux_failed`, carrying the assembler's exit
      code and the tail of its error output as params, and leave no partial assembled file behind.
      The disc files themselves stay in the download folder untouched, so the user can assemble the
      film by hand (REQ-14).
- [ ] **REQ-10 (Stop, delete, crash)**: Assembly is part of the encode: stopping the encode (`097`)
      or deleting the source (`047`) while it assembles must terminate the assembler and remove the
      partial file without reporting an outcome, and a worker that died mid-assembly (`054`) must
      discard the partial file and assemble from scratch when the job is requeued.
- [ ] **REQ-11 (Progress while assembling)**: The job must read `ENCODING` while it assembles.
      Progress stays at 0 during assembly and only starts moving once FFmpeg runs (compression on);
      with compression off it stays at 0 until the move completes. No contract change.
- [ ] **REQ-12 (Disc next to an ordinary video)**: When a film release holds a recognised disc and
      also an ordinary video file (`.mkv`/`.mp4`, e.g. a bundled sample), the disc's main playlist
      is the match regardless of size; the ordinary file is not reported as unmatched video either,
      so it does not keep the download folder alive (REQ-4).

- [ ] **REQ-13 (Ambiguous playlist ⇒ fail, never guess)**: When REQ-2's tie-breaks leave more than
      one candidate, the scan must report the source as failed (`sourceScanFailed`) with the new key
      `error.source.disc_playlist_ambiguous`, carrying the tied playlist file names as a param, and
      must not pick one. A scrambled film filed with no error is worse than a source in `ERROR`.
- [ ] **REQ-14 (A failed disc is left for manual handling)**: Whenever a disc source ends in `ERROR`
      (REQ-3, REQ-9, REQ-13), nothing under its download folder may be deleted by Perceptor — no
      `.m2ts`, `.mpls`, `.clpi` — until the user deletes the source themselves, or another source of
      the same film delivers and the existing race sweep (`091`) retires the failed one. The user's way out is
      the existing one: assemble the MKV by hand outside Perceptor and attach it to the film with
      the existing file import (tus upload, `068`/`022`), which then races and demotes the failed
      disc source like any other upload. No new UI.

- [ ] **REQ-15 (Looped playlists are not the film)**: Before REQ-2 compares durations, the scan must
      discard every playlist whose distinct content is less than half its total duration — the
      duration counting each referenced clip once, against the duration counting every play item.
      This is what a menu or a trailer reel rolled out into a long loop looks like: the same one to
      three clips repeated until the playlist is as long as a film, often with chapters. The check
      reads only the playlist and clip information; it decodes nothing. If every otherwise playable
      playlist is discarded, the source ends as REQ-3 describes (`error.source.scan_no_video`).

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Downloads root only)**: The assembled file must be written inside the source's own
      download folder, so that every existing removal path — post-encode cleanup, `047`'s
      `downloadDelete` unwind, `067`'s title removal — already covers it, and nothing is ever
      written to or removed from the destinations root except through the existing final move
      (Constitution, Articles V and XII).
- [ ] **NFR-2 (Disk space is the operator's)**: Assembly needs free space on the downloads volume
      roughly equal to the main feature's size. Perceptor must not pre-check or reserve it; running
      out is the REQ-9 failure, reported with the underlying error, never a silent truncated file.
- [ ] **NFR-3 (No new tooling)**: Assembly must use tools already in the worker image (`ffmpeg`,
      `mkvtoolnix`); no new package, no privileged container, no mounted filesystem.
- [ ] **NFR-4 (Ordinary releases untouched)**: A release with no disc structure must scan, encode and
      be cleaned up exactly as today — same matches, same `files` inventory, same FFmpeg command.
      The existing scan tests and `services/worker/ffmpeg/` case corpus must pass unchanged.
- [ ] **NFR-5 (Retry resumes from assembly)**: A disc source in `ERROR` after REQ-9, resumed with
      Play (`065`), must re-assemble and continue; it must never re-download.

## GraphQL Contract Delta

**No SDL change.** The scan reports a disc through the existing `sourceScanned(mediaSourceId,
files, matches)`: the main playlist is the one match, and the clip files are listed with
`isVideo: false` (REQ-4). The encode reports through the existing `encodeFailed(errorKey, …)`.

One key is added to the worker's error vocabulary (`docs/spec/graphql-contract.md` § "UI
internationalization", `worker — encode pipeline` row):

| Condition | Key / params | Message the user sees (`es`) |
| :-- | :-- | :-- |
| Assembling the disc playlist into an MKV failed (non-zero exit, missing clip, out of space) | `error.encode.disc_remux_failed` — `{ code, stderr }` | `No se pudo armar el MKV a partir del Blu-ray (código {code}): {stderr}` |

English (`en`): `Could not assemble the MKV from the Blu-ray (code {code}): {stderr}`.

Consumers:
- `worker` — throws it as a `KeyedError` from the assembly step; `encode.job.ts`'s existing catch
  reports it and rethrows `UnrecoverableError` (no BullMQ retry, `054`).
- `web` — adds the key to `messages/en.json` and `messages/es.json` under `error.encode`; it renders
  through the existing `Download.lastError` path (`065`) with Play as the retry, no new UI.
- `api` — stores the key verbatim like every other `error.encode.*` key; no code change.

One key is added to the scan's error vocabulary (owned by `worker`, reported through the existing
`sourceScanFailed`, which stores any key verbatim):

| Condition | Key / params | Message the user sees (`es`) |
| :-- | :-- | :-- |
| Several playlists remain tied after REQ-2's tie-breaks | `error.source.disc_playlist_ambiguous` — `{ playlists }` (comma-separated file names) | `No se pudo determinar la playlist principal del Blu-ray ({playlists}). Armá el MKV a mano e importalo desde la película` |

English (`en`): `Could not determine the Blu-ray's main playlist ({playlists}). Assemble the MKV manually and import it from the film's page`.

`web` adds it under `error.source` in both catalogs; `api` needs no code change.

Cancellation and stop during assembly report nothing (REQ-10), the same as an FFmpeg run today.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: Given a film whose torrent is a full Blu-ray folder (`BDMV/PLAYLIST`,
      `BDMV/STREAM`, `BDMV/CLIPINF`) with compression **on**, when the download completes, then the
      source reaches `SCANNED` with one match pointing at the main `.mpls`, the encode runs, and the
      library holds one AV1 `.mkv` whose duration matches the disc's main feature (±2 s).
- [ ] **AC-2**: Given the same release with compression **off**, when the pipeline finishes, then
      the library holds one `.mkv` (not `.mpls`/`.m2ts`) containing the disc's video, audio and
      subtitle tracks, and Jellyfin plays it.
- [ ] **AC-3**: Given AC-1's output, `ffprobe` on the library file shows the original-language audio
      track tagged with its real ISO code (e.g. `eng`), not `und`, and the recorded `FfprobeLog`
      for the job is that of the assembled MKV.
- [ ] **AC-4**: Given a disc whose film is split across several `.m2ts` clips in one playlist, the
      output's duration is the playlist's total, not the largest clip's.
- [ ] **AC-5**: After AC-1 completes, the source's download folder is gone (no `.m2ts`, no
      assembled MKV, no residue), the same as for a single-file film release.
- [ ] **AC-6** *(failure path)*: Given a disc whose main playlist references a clip that is deleted
      after the scan, when the encode starts, then the download row shows `ERROR` with the
      translated `error.encode.disc_remux_failed` message, and no partial assembled file remains in
      the download folder.
- [ ] **AC-7** *(failure path)*: Given a disc where every `.m2ts` was deselected in qBittorrent, the
      source ends in `ERROR` with `error.source.scan_no_downloaded_video` — the existing key.
- [ ] **AC-8** *(failure path)*: Given a `.iso` image, a folder of loose `.m2ts` with no `BDMV`
      tree, or a season pack shipped as a disc, the source ends in `ERROR` with
      `error.source.scan_no_video`, exactly as before this feature.
- [ ] **AC-9**: Given a disc encode stopped (`097`) or deleted (`047`) during assembly, the
      assembler process is gone, no partial file remains, and no `encodeFailed` is recorded; Play
      after a stop assembles from scratch and completes.
- [ ] **AC-10**: Given AC-6's failed source, after restoring the clip, Play re-assembles and
      completes without re-downloading the torrent.
- [x] **AC-11**: Given a disc with decoy playlists of the same duration where only one carries
      chapter marks, the match is the playlist with chapters and the output's chapter list is
      non-empty.
- [x] **AC-12**: Given a disc release that also ships a small `sample.mkv`, the match is the disc's
      main playlist and the download folder is still removed after the encode.
- [x] **AC-13** *(failure path)*: Given a disc with two decoy playlists of equal duration, both with
      the same number of chapter marks, the source ends in `ERROR` with the translated
      `error.source.disc_playlist_ambiguous` naming both playlists, and every disc file is still in
      the download folder.
- [ ] **AC-14**: Given AC-13's failed source, when the user imports a hand-assembled `.mkv` into the
      film, the upload wins the race, the film is encoded from it, and the failed disc source no
      longer holds the film back.
- [x] **AC-15**: Given a disc whose longest playlist repeats one menu clip until it outlasts the
      film, and carries chapter marks, the match is the film's playlist, not the loop.
- [x] **AC-16**: `bin/npm worker test` passes, including the unchanged scan tests and the
      `services/worker/ffmpeg/` case corpus.

## Out of Scope

- **Series and season packs on disc.** A disc carries several episodes with no `SxxEyy` to match;
  mapping playlists to episodes is its own problem. Behaviour is unchanged: `scan_no_video`.
- **`.iso` images.** Reading UDF without mounting would need a new tool in the image. Behaviour is
  unchanged.
- **Loose `.m2ts` with no `BDMV` tree** (just `STREAM/`, or a single clip). No playlist and no
  languages to recover. Behaviour is unchanged — `.m2ts` does not become a video extension.
- **Multi-disc films** (two `BDMV` trees in one release). Only exactly one disc is recognised;
  with more, behaviour is unchanged.
- **3D (MVC) and UHD Dolby Vision enhancement layers.** Whatever the assembler preserves is kept;
  Perceptor makes no promise about either, and the existing "first video stream" rule still picks
  the base layer for the encode.
- **Extras, menus, alternate cuts.** Only the main playlist is assembled; everything else on the
  disc is discarded with the download folder.
- **Release ranking.** `searchTorrents` does not learn to prefer or avoid full-disc releases.
- **Encrypted discs.** A release that still needs AACS/BD+ decryption fails assembly (REQ-9);
  Perceptor does not decrypt.

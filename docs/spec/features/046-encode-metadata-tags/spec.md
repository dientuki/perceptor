---
title: Encode Metadata Tags
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-04
last_updated: 2026-09-04
status: Implemented
services: [worker]
---

# SPEC: Encode Metadata Tags (`spec.md`)

## Context & Goal

Every file the transcode stage produces today comes out of FFmpeg with `-map_metadata:g -1`
(`services/worker/src/ffmpeg/buildCommand.ts`), which strips the container's global metadata on
purpose: the source's release-group title, encoder credits and assorted tag soup have no business
surviving into the library. The side effect is that nothing is written back in its place. A player
opening `Alita Battle Angel (2019).mkv` shows the file name, and — more importantly — the file
itself carries no record of where it came from. Once the download is cleaned up
(`src/jobs/cleanup-source.ts`), the release that produced a given library file exists nowhere on
disk; answering "which rip is this?" months later means guessing from the video's characteristics.

This feature writes three global tags into the FFmpeg command. Two of them are cosmetic: a
`title` for players — the TMDB film title for a film, and `<Serie> SNN-ENN <Episode title>` for an
episode. The third, `PERCEPTOR_SOURCE`, is the one that matters: the source file's path relative to
the downloads root, so the produced `.mkv` permanently carries the name of the release and the file
inside it that it was made from. The stripping stays exactly as it is — this adds tags after the
strip, it does not stop discarding the source's own.

The affected stage is **Transcode** in the root `CLAUDE.md` table, and only it. Every value needed
is already in the `processJob` query the worker sends (`title`, `seasonNumber`, `episodeNumber`,
`episodeTitle`, `inputFilePath`, `downloadsRoot`) — the api computes and returns all of it today for
`buildOutputPath`. No GraphQL field, no Prisma column and no second service is involved, so this
spec exists for the decisions inside the worker (the exact string forms, and what the passthrough
branch does), not because the contract moves.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Film title tag)**: When the job's `kind` is `MOVIE`, the FFmpeg command must carry a
      global `title` metadata argument whose value is the media title as registered from TMDB,
      verbatim — no sanitization, no year, no tmdbId. `The Martian` produces
      `-metadata title=The Martian`.
- [x] **REQ-2 (Episode title tag)**: When the job's `kind` is `EPISODE`, the same global `title`
      must read `<Series title> S<NN>-E<NN> <Episode title>`, season and episode zero-padded to two
      digits, both titles verbatim from TMDB. `-metadata title=The Boys S05-E07 The Frenchman, the
      Female, and the Man Called Mother's Milk`. The `S05-E07` hyphen is deliberate and is **not**
      the `S05E07` form `buildOutputPath` uses for the file name; the two are independent.
- [x] **REQ-3 (Episode title absent)**: When an episode has no title known yet (the api returns
      `episodeTitle: null`, which happens for a series whose background fetch has not landed —
      see `041-episode-info-refresh`), the tag must still be written, as
      `<Series title> S<NN>-E<NN>` with no trailing separator or empty remainder. A missing episode
      title is never a reason to skip or fail the encode.
- [x] **REQ-4 (Source tag)**: Every encode must carry a global `PERCEPTOR_SOURCE` metadata argument
      whose value is the source file's path **relative to the job's `downloadsRoot`** — the release
      folder and the file inside it, e.g.
      `Transformers.Revenge.of.the.Fallen.2009.PROPER.2160p.BluRay.REMUX.HEVC.DTS-HD.MA.TrueHD.7.1.Atmos-FGT/Transformers.Revenge.of.the.Fallen.2009.PROPER.2160p.BluRay.REMUX.HEVC.DTS-HD.MA.TrueHD.7.1.Atmos-FGT.mkv`.
      For a season pack, each episode's job records the individual file it was made from, not the
      pack folder.
- [x] **REQ-5 (Tags survive the strip)**: The three tags must take effect in the produced file
      despite `-map_metadata:g -1`. Discarding the source's global metadata is unchanged behaviour
      and stays; the new tags are the file's own, written on top of an emptied set.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Passthrough writes nothing)**: When `compressionEnabled` is false the worker moves
      the file without transcoding it (`032-optional-compression`, `src/encode/passthrough.ts`).
      That branch must remain untouched: no tag is written, no `mkvpropedit` is introduced, and the
      moved file is still byte-identical to the source. These tags exist only on the branch that
      already rewrites the container.
- [x] **NFR-2 (No new query fields)**: The worker must build all three values from data the
      `processJob` query already returns. Adding a field to that selection set would be a contract
      change and is out of scope here (see § GraphQL Contract Delta).
- [x] **NFR-3 (Absolute paths never leak into the tag)**: `PERCEPTOR_SOURCE` is relative to
      `downloadsRoot` and must never contain the container-side downloads prefix
      (Constitution, Article V). If `inputFilePath` is not inside `downloadsRoot`, the tag falls
      back to the file's base name rather than emitting an absolute container path.
- [x] **NFR-4 (Values are arguments, not shell text)**: FFmpeg is spawned with an argument array
      (`src/ffmpeg/runner.ts`), so titles containing commas, apostrophes, spaces or `=` are passed
      through untouched. No escaping, quoting or sanitization is applied to any of the three values;
      any such transformation would be a bug, since the point of REQ-1/REQ-2 is showing the real
      TMDB string.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.** `title`, `seasonNumber`,
`episodeNumber`, `episodeTitle`, `inputFilePath` and `downloadsRoot` are already in the
`processJob(id)` selection set in `services/worker/src/jobs/encode.job.ts` and already typed in
`EncodeJobDetails`. Nothing is added to, removed from or renamed in the schema, and `api` and `web`
are untouched.

## Data Model Changes

None.

## Acceptance Criteria

- [x] **AC-1**: Given a film job for TMDB title `The Martian`, when the encode runs, then the FFmpeg
      command recorded on the `ProcessJob` (visible in the encode log and in the `ffmpegCommand`
      reported by `encodeCompleted`) contains `-metadata` followed by `title=The Martian`.
- [x] **AC-2**: Given an episode job for `The Boys`, season 5, episode 7, episode title
      `The Frenchman, the Female, and the Man Called Mother's Milk`, then the recorded command
      contains `title=The Boys S05-E07 The Frenchman, the Female, and the Man Called Mother's Milk`
      — one argument, commas and apostrophe intact.
- [x] **AC-3**: Given an episode job whose `episodeTitle` is `null`, then the encode completes and
      the recorded command contains `title=The Boys S05-E07` with nothing after the episode number.
      (Failure path: the previously plausible outcome here is a `null` rendered into the tag or a
      crash while composing it.)
- [x] **AC-4**: Given a job whose `downloadsRoot` is `/downloads` and whose `inputFilePath` is
      `/downloads/Some.Release-GRP/Some.Release-GRP.mkv`, then the recorded command contains
      `PERCEPTOR_SOURCE=Some.Release-GRP/Some.Release-GRP.mkv`, with no leading slash and no
      `/downloads` prefix anywhere in it.
- [x] **AC-5**: Given a job whose `inputFilePath` lies outside `downloadsRoot`, then the encode
      still runs and `PERCEPTOR_SOURCE` is the file's base name — never an absolute container path.
      (Failure path.)
- [x] **AC-6**: With `compression_enabled` off in Settings, `bin/npm worker run test` still passes
      and the passthrough-driver tests show no metadata argument and no new external process: the
      moved file is unchanged.
- [x] **AC-7**: `bin/npm worker run test` passes with the pre-existing suite count plus the new
      cases, and `bin/npm worker run build` exits 0.

## Out of Scope

- **Writing tags on the passthrough path.** Decided against in NFR-1: `032-optional-compression`'s
  promise is that the file is moved and never touched, and honouring it is worth more than tag
  coverage on a branch the operator opted into. Doing it later means introducing `mkvpropedit` and
  restricting it to `.mkv` sources.
- **Verifying that `mkvmerge` preserves the tags through the final remux.** Confirmed by hand with
  `ffprobe` against a produced file before this spec was written; the remux keeps global tags, so no
  requirement or acceptance criterion is spent proving it again.
- **Any other tag.** No encoder, comment, date, `PERCEPTOR_VERSION` or provenance beyond the source
  file name. `PERCEPTOR_SOURCE` was asked for because the release name disappears when the download
  is cleaned up; nothing else has that problem today.
- **Backfilling files already in the library.** Everything encoded before this ships stays untagged.
  A retroactive pass would need a job kind that rewrites container metadata in place, which nothing
  in the pipeline does.
- **Changing the file name.** `buildOutputPath` keeps its `S05E07` form and its sanitization; REQ-2's
  hyphenated, unsanitized string exists only inside the container.

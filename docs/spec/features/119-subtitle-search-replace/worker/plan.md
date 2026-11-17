---
title: Subtitle Search and Replace — worker slice
service: worker
last_updated: 2026-11-15
status: Implemented
---

# PLAN: Subtitle Search and Replace — `worker` (`worker/plan.md`)

## Scope

The `subtitle-embed` job drops, in the same remux, the existing text subtitle tracks of the
languages `api` lists in `SubtitleEmbedDetails.replaceLanguagesIso3`, and verification accepts the
result. Nothing else in the worker changes: no search logic, no variant scoring, no new job.

The worker never decides whether to replace; it only applies the list. An empty or missing list is
today's append-only embed.

Writes are confined to `services/worker/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/api/subtitle-embed-reports.ts` | Modified | Query `replaceLanguagesIso3`; a missing value is `[]` with a log line |
| `src/subtitles/replace-tracks.ts` | New | Pure `tracksToDrop(streams, languagesIso3)` → stream indexes |
| `src/subtitles/replace-tracks.spec.ts` | New | Case table |
| `src/subtitles/embed-args.ts` | Modified | `dropIndexes` input → `--subtitle-tracks !i,j` before the original path; default-flag loop skips dropped streams. `ProbedStream` stays `{ index, codec_type }`: `tracksToDrop` takes the full `ffprobe` streams, not this type |
| `src/subtitles/verify-embed.ts` | Modified | Takes the dropped indexes: expects `before − dropped + added` streams and compares only kept originals, in order |
| `src/jobs/subtitle-embed.job.ts` | Modified | Compute the drop list from the original metadata and pass it to both |

## Existing code to reuse

- `getMetadata(filePath)` — the `ffprobe` the job already runs on the original; the drop list
  comes from it, no second probe.
- `normalizeIso3` (`src/ffmpeg/iso639.ts`) — language comparison, as `verifyEmbed` does.
- `buildEmbedArgs` — already uses `ffprobe` stream indexes as `mkvmerge` track ids for
  `--default-track-flag`; the drop uses the same convention.
- The `ffprobe` codec-name → subtitle-format mapping in `src/ffmpeg/params.ts` (`subrip` → `srt`
  and so on) for what counts as a text track. `src/encode/subtitle-formats.ts` holds format names
  (`srt`, `ass`, …), not codec names, so do not test `codec_name` against it directly. Text codecs:
  `subrip`, `ass`, `ssa`, `webvtt`, `mov_text`, `text`; anything else (PGS, VobSub, DVB, unknown)
  is kept.
- `VerifyStream` (`src/subtitles/verify-embed.ts`) already carries `codec_name`,
  `tags.language` and `disposition.forced` — the shape `tracksToDrop` needs.

## Steps

1. `tracksToDrop`: a stream is dropped when `codec_type === 'subtitle'`, its codec is a text codec,
   its normalized language is in the list, and `disposition.forced` is not 1. Image tracks and
   other languages are never returned. An unknown language in the list drops nothing.
2. `buildEmbedArgs`: when `dropIndexes` is non-empty, `--subtitle-tracks !<comma list>` applies to
   the original file only.
3. `verifyEmbed`: remove the dropped indexes from `before`, then the existing checks. Every
   `before.length` offset (new-track position, the default-flag check) then reads the filtered
   length, so a replace that also asks for a default track still checks the right index.
4. Job wiring and the details query.

## Contract obligations

Consumes `SubtitleEmbedDetails.replaceLanguagesIso3: [String!]!` from `../spec.md`. Reads a missing
field as empty and logs. Error reporting is unchanged: a remux or verification failure reports the
existing `remux_failed`/`verify_failed` keys and leaves the original untouched (`101`). The delta is
read-only; if it is wrong, stop and report.

## Tests

- `replace-tracks.spec.ts` — drops only text, non-forced tracks of a listed language; keeps forced,
  image and other languages; empty list drops nothing; case-insensitive language.
- `embed-args.spec.ts` — no `--subtitle-tracks` without drops; the exclusion list when present.
- `verify-embed.spec.ts` — a replace (one dropped, one added) passes; a remux that kept the dropped
  track fails; an original stream that changed still fails.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit     # 0 errors
bin/npm worker test                       # all suites pass
bin/comments worker                       # PASS
```

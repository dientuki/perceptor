---
title: Subtitle Format Selection — worker slice
service: worker
last_updated: 2026-09-25
status: Approved
---

# PLAN: Subtitle Format Selection — `worker` (`worker/plan.md`)

## Scope

The worker reads `EncodeJobDetails.allowedSubtitleFormats`, normalizes it, and makes
`getSubtitleParams` select and write subtitle streams by format (REQ-8 … REQ-11). It does **not**
read settings, re-derive "no subtitles" or group toggles, or touch `passthrough.ts` (REQ-12).

Two agents, two steps:

- **2a — `worker` agent**: `src/encode/`, `src/jobs/encode.job.ts`. Never writes `src/ffmpeg/`.
- **2b — `ffmpeg` agent** (`.claude/agents/ffmpeg.md`): `src/ffmpeg/` only. Never edits the corpus
  JSON in `services/worker/ffmpeg/`.

Writes are confined to `services/worker/` and this directory. Read `../spec.md` (REQ-1, REQ-8 …
REQ-12, NFR-3, § GraphQL Contract Delta) and `../plan.md` § "Decisions this plan makes" first.

## Files

| File | New / Modified | Agent | What changes |
| :-- | :-- | :-- | :-- |
| `src/encode/subtitle-formats.ts` | New | worker | `SubtitleFormat` union, `SUBTITLE_FORMAT_VALUES`, `DEFAULT_SUBTITLE_FORMATS`, `normalizeSubtitleFormats()`. |
| `src/encode/subtitle-formats.spec.ts` | New | worker | Normalizer tests. |
| `src/encode/types.ts` | Modified | worker | `EncodeInput.allowedSubtitleFormats: SubtitleFormat[]`. |
| `src/jobs/encode.job.ts` | Modified | worker | Retype field, add to selection set, normalize once, add to the log line and both `EncodeInput` literals. |
| `src/ffmpeg/params.ts` | Modified | ffmpeg | `getSubtitleParams` rewrite. |
| `src/ffmpeg/buildCommand.ts` | Modified | ffmpeg | Pass `details.allowedSubtitleFormats`. |
| `src/ffmpeg/params.spec.ts` | Modified | ffmpeg | Existing subtitle cases get the new argument; new cases below. |
| `src/ffmpeg/buildCommand.spec.ts` | Modified | ffmpeg | `EncodeInput` literal gains the field. |
| `src/ffmpeg/cases.spec.ts` | Modified | ffmpeg | `input.allowedSubtitleFormats ?? ['srt','mov_text']`. |

## Existing code to reuse

- `src/encode/compression-resolution.ts` (+ spec) — the exact shape of the normalizer: const values,
  type guard, `console.warn` and default on anything unrecognised, never throws.
- `normalizeCompressionResolution` call site in `handleEncode` — normalize once there, next to it,
  and pass the result into both `EncodeInput` literals.
- `getSubtitleParams`'s existing pipeline: `normalizeIso3`, `hasCuePayload`, `isHearingImpaired` +
  `preferring` (S4), `requestedVariants`/`narrowToVariants` (S5), `trackLanguageTitle` — all kept.
- `preferring` from `src/ffmpeg/variants.ts` — REQ-9 is `preferring(langStreams, isImageGroup)` (its predicate names the *worse* streams):
  keeps the text subset when non-empty, else everything (the image streams). No new primitive.

## Steps

### 2a — worker agent

1. `src/encode/subtitle-formats.ts`: `SubtitleFormat = 'srt'|'ass'|'webvtt'|'mov_text'|'pgs'|'vobsub'|'dvb'`;
   `SUBTITLE_FORMAT_VALUES`; `DEFAULT_SUBTITLE_FORMATS = ['srt','ass','webvtt','mov_text']`;
   `normalizeSubtitleFormats(raw: unknown): SubtitleFormat[]` — non-array (`undefined`/`null`/other)
   → warn and return the default; array → keep known ids (dedupe), warn once listing any dropped
   unknown ids. An empty array is valid and returned as `[]` (it means "no subtitles", never the
   default).
2. `types.ts`: add `allowedSubtitleFormats: SubtitleFormat[]` to `EncodeInput`.
3. `encode.job.ts`: add `allowedSubtitleFormats: string[]` to the local `EncodeJobDetails`; add
   `allowedSubtitleFormats` to the `processJob` selection; normalize beside `compressionResolution`;
   append `allowedSubtitleFormats=${JSON.stringify(...)}` to the existing `[encode]` log line; set the
   field in both `EncodeInput` literals (passthrough gets it only because the type requires it — it
   never reads it).

### 2b — ffmpeg agent

4. `params.ts`: replace `TEXT_SUBTITLE_CODECS`/`isTextSubtitle` with one map
   `Record<SubtitleFormat, { group: 'text' | 'image'; codecs: string[] }>` holding REQ-1's table, and
   a lookup `subtitleFormatOf(stream): SubtitleFormat | null` from `codec_name` (lowercased).
5. `getSubtitleParams(subtitleStreams, allowedFormats, allowedLanguagesIso3, allowedLanguageTags,
   trackTitles)`:
   - `allowedFormats` empty → log `[ffmpeg] subtitles disabled by settings (allowedSubtitleFormats empty).`
     and return `[]`.
   - candidate filter: allowed language (S2) ∧ format of stream ∈ `allowedFormats` (new S1) ∧
     `hasCuePayload` (S3).
   - per language, unchanged S4, then REQ-9: `preferring(langStreams, isImageGroup)`, then S5.
   - empty selection → the existing log line, reworded to "no subtitle in an allowed language and
     format survived the rules."
   - arguments per selected stream: `-map 0:<index>`, `-c:s:<n>` `srt` for the text group / `copy`
     for the image group, `-metadata:s:s:<n> title=<trackLanguageTitle>`.
6. `buildCommand.ts`: pass `details.allowedSubtitleFormats`.
7. Specs: update every existing `getSubtitleParams` call to pass
   `['srt','mov_text']` so their expectations stay as they are; `buildCommand.spec.ts` literal gains
   the field; `cases.spec.ts` uses `input.allowedSubtitleFormats ?? ['srt','mov_text']`. Existing
   corpus results must not change.

## Contract obligations

Consumes `allowedSubtitleFormats: [String!]!` from `processJob`. Treats absent/`null` as the NFR-3
default (logged), unknown ids as ignored (logged), `[]` as "no subtitles" — never fails an encode
over this field. Never calls `updateSettings` or reads `settings`. The delta is read-only; if the
rule needs anything else from the payload, stop and report.

## Tests

- `src/encode/subtitle-formats.spec.ts` — owed: a normalizer that turns `[]` into the default
  silently re-enables subtitles an administrator disabled; one that throws fails every encode. Cases:
  `undefined`/`null`/non-array → default; `[]` → `[]`; unknown id dropped, known kept; duplicates
  collapsed.
- `src/ffmpeg/params.spec.ts` (new `describe` inside `getSubtitleParams`) — owed, the whole class of
  silent wrong-subtitle output the `ffmpeg` agent exists for. Cases, synthetic streams:
  - each REQ-1 codec (`subrip`, `ass`, `ssa`, `webvtt`, `mov_text`, `tx3g`, `hdmv_pgs_subtitle`,
    `dvd_subtitle`, `dvb_subtitle`) is selected when its id is allowed and dropped when not;
  - `eia_608` is never selected even with every id allowed;
  - text streams get `srt`, image streams get `copy`;
  - `[]` → no arguments;
  - AC-7: `spa` SRT + `spa` PGS + `eng` PGS, all ids, `['spa','eng']` → `spa` SRT and `eng` PGS only;
  - image-only allowed with a PGS-only language → the PGS kept with the `trackLanguageTitle` title;
  - S3/S4/S5 still apply to image streams (one case each is enough: small PGS dropped, SDH PGS loses
    to a plain PGS).
- `src/ffmpeg/cases.spec.ts` — no new case; unchanged expectations are the regression proof.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker run build
bin/npm worker test
git diff --stat services/worker/ffmpeg
```

0 typecheck errors; build exits 0; every suite green except the three pre-existing `src/ffmpeg/`
failures recorded in the root `CLAUDE.md` (same three, no new ones); the corpus diff is empty.

---
title: Subtitle Variant Detection — worker slice
service: worker
last_updated: 2026-11-15
status: Implemented
---

# PLAN: Subtitle Variant Detection — `worker` (`worker/plan.md`)

## Scope

The worker does all the scoring. It decides the variant of two unresolved Spanish text subtitle
tracks during the encode. It feeds that verdict to `031`'s selection and titling. It decides the
variant of a downloaded OpenSubtitles candidate inside the existing `subtitle-sync` job and
reports it as `variantTag`.

It does **not** decide whether a downloaded candidate is rejected or how it is titled once
embedded. `api` owns both, from the snapshot of wanted variants the worker never sees. It also does
not decide who opted in: it reads `subtitleVariantDetection` and `variantDetectionIso3` as given.

The slice has two owners inside `services/worker/`:

- The **worker agent** owns `src/encode/`, `src/jobs/`, `src/api/` and `src/subtitles/`.
- The **ffmpeg agent** (`.claude/agents/ffmpeg.md`) owns `src/ffmpeg/`. Its edge is the
  `subtitleVariants` map named in `../plan.md` § Contract Freeze.

Writes are confined to `services/worker/` and this directory.

## Files

| File | New / Modified | Owner | What changes |
| :-- | :-- | :-- | :-- |
| `src/encode/audio-variant-detectors.ts` → `src/encode/variant-detectors.ts` | Renamed | worker | Shared marker table. `AudioVariantMarkers` → `VariantMarkers`, `findAudioVariantDetector` → `findVariantDetector`. Markers unchanged |
| `src/encode/variant-score.ts` | New | worker | `score()`, its weights and `dedupeLines`, moved out of `audio-variant-score.ts`. Plus `scoreRate()` (score per 1,000 words), the subtitle encode margin and the two download rate thresholds |
| `src/encode/audio-variant-score.ts`, `audio-variant.ts` | Modified | worker | Import from the two modules above. No behaviour change |
| `src/encode/subtitle-prune.ts` | Modified | worker | `resolveSubtitlePruning` returns `{ drops, variants }`, reads and writes the `subtitle-variant` verdict, at most one sample read |
| `src/encode/verdict-store.ts` | Modified | worker | `'subtitle-variant'` added to `VERDICT_KINDS` |
| `src/encode/types.ts` | Modified | worker | `subtitleVariantDetection?: boolean` |
| `src/encode/encode.ffmpeg.ts` | Modified | worker | Destructures the resolver's result and passes `variants` to `buildFfmpegCommand` |
| `src/jobs/encode.job.ts` | Modified | worker | Queries `subtitleVariantDetection`, defaults a non-boolean to `false` with a log line, ANDs it with `compressing` |
| `src/subtitles/normalize-srt.ts` | Modified | worker | Exports its byte decoder (`decodeSubtitleBytes`) unchanged |
| `src/subtitles/subtitle-variant.ts` | New | worker | `detectDownloadedVariant(path, iso3)`: read, decode, parse, strip markup, score the rate, map it to a tag or `null` |
| `src/api/subtitle-sync-reports.ts` | Modified | worker | `variantDetectionIso3` in the details query. `variantTag` argument on `subtitleSyncCompleted` |
| `src/jobs/subtitle-sync.job.ts` | Modified | worker | Runs `detectDownloadedVariant` before `measureSync` when `variantDetectionIso3` is set, and reports its tag |
| `src/ffmpeg/buildCommand.ts` | Modified | ffmpeg | New required `subtitleVariants: ReadonlyMap<number, string>` argument, passed to `getSubtitleParams` |
| `src/ffmpeg/params.ts` | Modified | ffmpeg | `getSubtitleParams` and `selectSubtitleStreams` take a `detect` function, default `detectVariant`. `trackLanguageTitle` gets the same `detect` |

## Existing code to reuse

- `src/encode/audio-variant-detectors.ts` and `audio-variant-score.ts`'s `score`/`dedupeLines` —
  the markers and weights `110` calibrated. They are moved, not copied (spec REQ-4: one table).
- `src/encode/subtitle-prune.ts` — `qualifyingGroups`, `buildSubtitleSampleArgs`,
  `runFfmpegCapture` with `extraOutputs`, and the `EncodeCancelledError` rethrow. The variant step
  joins this resolver rather than becoming a sixth resolver with its own read (NFR-1).
- `src/encode/verdict-store.ts` — `fileIdentity`, `readVerdict`, `writeVerdict`. Never a key of
  this feature's own.
- `src/ffmpeg/variants.ts` — `detectVariant` (what "unresolved" means), `detectWithTags` (the
  override), `narrowToVariants` (already takes `detect`) and `variantTitle`.
- `src/ffmpeg/subtitle-content.ts` — `parseSrt` and `normalizeCueText` for cue text with markup
  stripped.
- `src/subtitles/normalize-srt.ts` — the UTF-8 / UTF-16 / Windows-1252 detection already proven on
  `subtitles/fixtures/cp1252.srt` and `utf8-bom.srt`.
- `src/encode/audio-variant.ts` — the log-line shape (`[variant] spa 2:<s> 3:<s> → …`). The
  subtitle lines use `[subvariant]` in the same shape.

## Steps

1. **Corpus (`[verify]`, before any threshold is committed).** Follow `../plan.md` § Verification
   step 0. Record a table here with: film/episode, source (encode pair, 900 s sample of one track,
   or whole downloaded file), human label, raw score, words and rate. Pick the encode margin, the
   two rate thresholds and the minimum word count so every labelled sample lands on its side with
   room to spare, and write them into `variant-score.ts`.
    **Corpus table (T001, 2026-11-15, current `110` markers, whole downloaded file).** The three `110`
    films hold one `spa` text track each in the library (index 5, `Español`) and no original
    release is left, so the corpus is OpenSubtitles files only, under
    `<downloads root>/corpus-118/` (outside the repository). The provider's `sp` (Spain) code
    returned no result for any of the three films and its plain `es` code mixes both variants, so
    each label below is read from the text itself and is **provisional until a human confirms it**.

    | File | Provider code | Label | Words | Raw | Rate /1000 | Evidence |
    | :-- | :-- | :-- | --: | --: | --: | :-- |
    | `ea-interstellar-11518280` (same text as `es-interstellar-1102037`) | `ea` / `es` | Latin | 12278 | 9 | 0.7 | `computadora`, `manejas`, `ustedes` |
    | `ea-interstellar-11083107` | `ea` | Latin | 11237 | 16 | 1.4 | `computadora`, `manejar` |
    | `ea-itchapter2-8461832` | `ea` | Latin | 9301 | -8 | -0.9 | `ustedes`, `carajo`, `manejes` |
    | `es-itchapter2-5045508` | `es` | Latin | 8534 | -15 | -1.8 | b = 22 |
    | `es-itchapter2-5046149` | `es` | Latin (ambiguous) | 8538 | 50 | 5.9 | 14 `joder` against many `ustedes` |
    | `es-jp3-4466048`, `-4476467`, `-343303`, `-4470822` | `es` | Latin | about 3850 | 4 | 1.0 | `ustedes`, `celular` |
    | `es-interstellar-1094617` | `es` | Spain | 10792 | 169 | 15.7 | `ordenador`, `más vale`, 160 present perfects |
    | `es-interstellar-1083938`, `-1087878` (same text) | `es` | Spain | 11552 | 161 | 13.9 | `ordenador`, 154 present perfects |

    **REQ-4b markers (T013, 2026-11-15).** Raw and rate per file after adding them (before in brackets):
    `ea-interstellar-11083107` 14 / 1.2 [16 / 1.4]; `ea-interstellar-11518280` and `es-interstellar-1102037`
    6 / 0.5 [9 / 0.7]; `ea-itchapter2-8461832` -10 / -1.1 [-8 / -0.9]; `es-itchapter2-5045508` -17 / -2.0
    [-15 / -1.8]; `es-itchapter2-5046149` 48 / 5.6 [50 / 5.9]; `es-jp3-*` 3 / 0.8 [4 / 1.0]; `es-interstellar-1094617`
    170 / 15.8 [169 / 15.7]; `es-interstellar-1083938`/`-1087878` 167 / 14.5 [161 / 13.9]. Every Latin-labelled
    file moves away from Spain; the Spain files gain 1 to 6 points from `venga` and `piso`. The corpus holds
    no hit for `id`, `curro`, `guay`, `chaval`, `gilipollas`, `hostia`, `mola`, `flipar`, `pasta` or the Latin
    `apúrate`, `chamaco`, `güey`, `chido`: those choices rest on the word's meaning, not on a sample.

    | Marker | List | Reason |
    | :-- | :-- | :-- |
    | `id` | strong A (3), case-sensitive | The plural imperative of `ir` is Castilian only; the `ID` identification reading is excluded by case, and it is scored on a case-preserving dedupe because `dedupeLines` lower-cases |
    | `curro`/`currar` forms | strong A | "Work" slang, no Latin use; 0 corpus hits |
    | `guay` | strong A | Castilian slang, no Latin use |
    | `chaval`/`chavales` | strong A | Castilian for "kid", no Latin use |
    | `gilipollas` | strong A | Castilian insult, Latin says `pendejo`/`idiota` |
    | `hostia(s)` | strong A | Castilian interjection; the Latin "host" sense is liturgical and rare |
    | `mola` | weak A (1) | Castilian "it rocks", but short and unsampled |
    | `flipar` forms | weak A | Castilian, but the verb forms are narrowed to avoid the English `Flipper` and `flip`; unsampled |
    | `venga` | weak A | Spain "come on", but Latin uses the subjunctive `que venga`: 2 hits in each Latin film, 5 in one Spain film |
    | `piso` | weak A | Spain "apartment", but Latin "floor": 1 hit in both Spain Interstellar texts |
    | `pasta` | weak A | Spain "money", but also the food in both variants |
    | `rentar`, `enojado`, `apúrate`, `chamaco`, `güey`, `chido` | B (-2) | Latin-only vocabulary; `enojado` hits 1 to 2 in six Latin-labelled files and 0 in all three Spain texts |
    | `departamento` | new weak B (-1) | Latin "apartment", but Spain also says it for a company department; 1 hit each in the `110` Interstellar and JP3 Latin texts. The table had no weak B list, so `weakB` (optional field, weight -1) is added; no existing weight changes |

    **Chosen values (T014, `variant-score.ts`).** Rates use the post-T013 numbers: Spain 14.5 to 15.8,
    Latin -2.0 to 1.2, ambiguous Latin (`es-itchapter2-5046149`) 5.6.

    | Constant | Value | Margin |
    | :-- | --: | :-- |
    | `DOWNLOAD_SPAIN_MIN_RATE` | 10 | 4.5 below the lowest Spain file (14.5), 4.4 above the ambiguous Latin file (5.6) |
    | `DOWNLOAD_LATIN_MAX_RATE` | 3 | 1.8 above the highest Latin file (1.2), 2.6 below the ambiguous one: it lands in the undecided gap (3 to 10), never Spain |
    | `MIN_WORDS_FOR_RATE` | 1000 | Smallest corpus file is about 3850 words; a forced track (hundreds of words) gives `null`. A 900 s sample of dialogue normally exceeds 1000, so a lone encode track is decided; one marker at 1000 words moves the rate by 1 to 3, hence the floor is not lower |
    | `SUBTITLE_DECISION_MARGIN` | 10 | Raw points over a 900 s sample (about 1/8 of a film). A Spain/Latin pair of one film differs by about 19 there (150 over a whole file); two translations of the same variant by at most about 1. The ambiguous Latin file against another Latin translation (65 whole-file, about 8 sampled) stays under it. Unmeasured on a real 900 s sample: the corpus holds whole files only |

    `words` is the whitespace-split count of the deduplicated text, so a repeated line cannot reach the
    minimum. Spain-side sample scores rest on two translations of one film.

    What this says before any threshold is chosen:

    - Spain and Latin separate cleanly by rate here (Spain 13.9 to 15.7, Latin -1.8 to 1.4), but the
      Spain side is one film and two translations, and almost all of its score is the
      present-perfect weight (154 to 160 hits against 12 to 35 in Latin files), not a Spain-only word.
    - `joder` is no Spain marker for absolute scoring: one Latin file scores 5.9 on it alone. REQ-4b
      has to decide its weight (strong, weak or none) from this table.
    - Three Spain files are not three translations. The thresholds therefore rest on two Spain
      texts, and the Spain-only markers of REQ-4b (`vosotros`, `id`, `curro`, `mola`, `guay`) have
      no sample here that exercises them.
    - The 900 s sample, the 20-minute episode subtitle and the short forced track are not in the
      corpus yet: 3 provider downloads are left today.

2. **Move the shared table and scorer.** Rename to `variant-detectors.ts`, create
   `variant-score.ts`, and update `audio-variant*.ts` and their specs' imports. Run
   `bin/npm worker test`: every `110` spec stays green with no expectation edited. Commit this
   step on its own, before step 2b, so the move and the marker change can be told apart.
2b. **New markers (REQ-4b).** Add the Spain markers (`id`, `curr(o|ar|as|a|amos)`, `mola`, `guay`,
   `chaval(es)?`, `gilipollas`, `hostias?`, `flip\p{L}*`, `venga`, `piso`, `pasta`) and the Latin
   American ones (`departamento`, `rentar`, `enojad[oa]s?`, `apúrate`, `chamac[oa]s?`, `güey`,
   `chid[oa]`) to the table. The step 1 corpus decides whether each is strong or weak.
   - `id` is matched case-sensitively: lower case anywhere, or `Id` as the first word of a line.
     Never `ID`. Its pattern is the one marker that drops the `i` flag.
   - Then re-run `110`'s audio scorer on the three films' stored transcripts
     (`audio-variant-score.spec.ts` fixtures). Every verdict must be unchanged (spec AC-4d). If one
     moves, weaken or drop the marker that moved it, and record that in the step 1 table.
3. **`scoreRate(text, markers)`** in `variant-score.ts`: `score(text, markers)` divided by the
   deduplicated word count, times 1,000. Below `MIN_WORDS_FOR_RATE` it gives `null`, which counts
   as undecided. **`decideAbsolute(text, detector)`** maps the rate to `tags[0]`, `tags[1]` or
   `null` with the two thresholds. The download check (step 7) and the lone-track encode rule
   (step 4) both call it.
4. **Encode resolver.** In `subtitle-prune.ts`:
   - Keep `qualifyingGroups` and the `subs` read. `qualifyingGroups` only covers languages with
     more than one text track, so it is **not** the candidate source for this feature.
   - Candidate rule (REQ-5): when `details.subtitleVariantDetection` is true, take
     `selectSubtitleStreams`' output (the same call `qualifyingGroups` makes). For each language
     with a detector, keep the text streams that are not in the drops and that `detectVariant`
     leaves unresolved. Exactly two form a **pair** (REQ-6). One, or three or more, are **lone**
     candidates, each on its own (REQ-6b).
   - Read a `subtitle-variant` verdict per unit. The identity is the file identity, the `iso3` and
     the sorted indices: two for a pair, one for a lone candidate.
   - Compute the streams the missing verdicts need: every group stream if the drops are missing
     (the variant candidates then follow from the fresh drops), plus every candidate stream whose
     verdict is missing. Make **one** `runFfmpegCapture` for that union (NFR-1). If nothing is
     missing, make none. A lone track of a single-track language joins the same pass even though
     `102` never reads it.
   - Order matters when the drops are missing: compute the drops from the read, derive the
     candidates from them, and decide only the candidates whose streams were read. A candidate
     that was not read stays undecided, with nothing stored. This cannot happen when the union
     above is built from every unresolved text stream of every language with a detector, so build
     it that way.
   - For each missing pair, join each track's cue text, take `score()` on each, and decide by
     `SUBTITLE_DECISION_MARGIN`. The higher score is `detector.tags[0]` (`es-ES`). Below the margin
     the pair is undecided. For each missing lone candidate, call `decideAbsolute()` on its joined
     text.
   - Write each verdict (`{ tags }` or `{ undecided: true }`) and log
     `[subvariant] spa i:<s> j:<s> → …` for a pair, `[subvariant] spa i:<rate>/kw → …` for a lone
     track, or `(reused)` on a hit.
   - On any non-cancel error, keep whatever was already known, store nothing new, and log
     `[subvariant] detection failed: …`.
   - Return `{ drops, variants }`, where `variants` is a `Map<index, tag>` of decided streams only.
5. **Wiring.** `encode.job.ts` adds the field to the query, the typeof check with its log line,
   and `compressing && … === true`. `types.ts` gets the field. `encode.ffmpeg.ts` passes `variants`
   into `buildFfmpegCommand`.
6. **ffmpeg agent: selection and titling.** In `params.ts`, add a `detect` parameter (default
   `detectVariant`) to `selectSubtitleStreams`, passed to `narrowToVariants`, and thread it through
   `getSubtitleParams` into `trackLanguageTitle`. In `buildCommand.ts`, add the required
   `subtitleVariants` argument and call `getSubtitleParams` with `detectWithTags(subtitleVariants)`.
   `102`'s `qualifyingGroups` keeps the default.
7. **Download check.** Create `subtitles/subtitle-variant.ts`:
   - `detectDownloadedVariant(path, iso3)` returns a tag or `null`, and never throws for a content
     problem.
   - No detector for the language → `null`, logged.
   - Otherwise: read the file, `decodeSubtitleBytes`, `parseSrt`, join `normalizeCueText` of
     every cue, then `decideAbsolute()` (step 3).
   - A read or parse failure, or an empty text, logs `[subvariant] download check failed: …` and
     returns `null`.
8. **Sync job.** In `subtitle-sync.job.ts`, after `subtitleSyncStarted` succeeds and before
   `measureSync`, run step 7 when `details.variantDetectionIso3` is a non-empty string, and pass
   its result as `variantTag` to `subtitleSyncCompleted`. Otherwise pass `null`. In
   `subtitle-sync-reports.ts`, add the field to the query and the argument to the mutation. A
   details response lacking the field reads as `null` with a log line. `subtitleSyncFailed` is
   unchanged, and a `measureSync` failure still reports it.

## Contract obligations

The worker consumes exactly `spec.md` § GraphQL Contract Delta:

- `EncodeJobDetails.subtitleVariantDetection: Boolean!` — missing or non-boolean → `false`,
  logged, never a throw.
- `SubtitleSyncDetails.variantDetectionIso3: String` — missing or `null` → no check.
- `subtitleSyncCompleted(…, variantTag: String)` — sends a registered variant tag only when
  decided, and `null` for undecided, failed or not run. It never invents a tag outside the
  detector's pair.
- The encode verdict never crosses the boundary. It lives in `111`'s store under
  `perceptor:encode:subtitle-variant:*`.

## Tests

- `src/encode/variant-score.spec.ts` (from the moved part of `audio-variant-score.spec.ts`) —
  defends against a marker or weight drifting when the table is shared. Every corpus sample from
  step 1 asserts its side for the encode margin and both rate thresholds. `ID` in upper case scores
  zero while `id`/`Id` at the start of a line counts (spec AC-4c).
- `src/encode/audio-variant-score.spec.ts` — unchanged expectations, re-run with the enlarged
  table: `110`'s three films keep their verdicts (spec AC-4d). This is the guard that a marker
  added for subtitles did not silently flip a dub.
- `src/encode/subtitle-prune.spec.ts` — defends against the variant silently never being decided,
  or decided from the wrong tracks. Cases:
  - two unresolved text tracks → one read, a decided map, compared as a pair;
  - one unresolved text track in a single-track language → one read of just that track, decided
    absolutely (`102` itself never reads it);
  - three unresolved text tracks → each decided on its own, no pairwise comparison;
  - a lone track below the minimum word count → undecided and stored;
  - `subs` hit and `subtitle-variant` miss → one read of just the candidates;
  - both hits → no read;
  - a titled pair or a PGS pair → no detection;
  - opt-in false → no detection and no `subtitle-variant` read;
  - a read error → drops still returned, no variant stored;
  - `EncodeCancelledError` propagates;
  - an undecided verdict is stored;
  - a different file misses.
- `src/encode/encode.ffmpeg.spec.ts` — asserts the resolver's `variants` reach
  `buildFfmpegCommand`. An unwired map is silent.
- `src/ffmpeg/buildCommand.spec.ts` / `params.spec.ts` (ffmpeg agent) — a decided `es-419` stream
  with `es-419` requested keeps only it, titled `Latino`. With plain `es`, both are kept and titled
  `Latino`/`Español (España)`. With an empty map, today's output is unchanged. `102`'s grouping
  still sees both streams.
- `src/subtitles/subtitle-variant.spec.ts` — defends against an encoding or parse issue flipping the
  verdict silently. Cases: a Windows-1252 file scores the same as its UTF-8 copy; a zero-byte file
  gives `null` and is logged; a file in the gap between thresholds gives `null`; no detector gives
  `null`.
- `src/jobs/subtitle-sync.job.spec.ts` — `variantTag` reaches the report when
  `variantDetectionIso3` is set, `null` otherwise; a check failure still reports the measurement;
  a missing details field reads as `null`.
- Not owed: the rename itself (covered by the unchanged `110` specs) and the `types.ts` field.

## Done when

```bash
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments worker
```

All pass, every `110` spec passes with no expectation changed, and the corpus table with the chosen
thresholds is filled in under step 1 of this file.

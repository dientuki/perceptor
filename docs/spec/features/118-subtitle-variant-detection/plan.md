---
title: Subtitle Variant Detection — Implementation Plan
spec_version: 0.5.0
last_updated: 2026-11-15
status: Implemented
---

# PLAN: Subtitle Variant Detection (`plan.md`)

## Approach

The feature reuses `110`'s pieces wherever they exist and adds two small seams: one in the encode
driver and one in the subtitle search's sync step.

**Shared scoring (worker).** `110`'s marker table (`services/worker/src/encode/audio-variant-detectors.ts`)
and its `score()` (`audio-variant-score.ts`) become the shared table and scorer, used by every
kind of track (spec REQ-4). The table moves to `encode/variant-detectors.ts`. `score()`, its
weights and `dedupeLines` move to `encode/variant-score.ts`. `audio-variant-score.ts` keeps only
what is audio-specific (`similarity`, `decide`, the duplicate threshold) and imports the rest. No
marker, weight or audio behaviour changes. AC-1 to AC-3 of `110` must still pass unchanged.

**Encode (worker + ffmpeg agent).** `resolveSubtitlePruning` (`encode/subtitle-prune.ts`, `102`)
already reads the sample this feature needs. It becomes the single subtitle-content resolver,
returning `{ drops, variants }`. It still stores `102`'s drops under the `subs` kind, and it stores
this feature's verdict under a new `subtitle-variant` kind in `111`'s store
(`encode/verdict-store.ts`). Both verdicts are read first, and at most one `ffmpeg` read is made
for whatever is missing (NFR-1). `102`'s stored value holds drops only, never samples, so a
`subs` hit with a `subtitle-variant` miss still needs one read, of just the candidates.

The order inside the file is **metadata first, then text** (spec REQ-5). Only a track that `031`'s
title rule leaves unresolved is read. Two unresolved tracks are compared against each other
(REQ-6). One, or three or more, are each decided on their own (REQ-6b), with the same absolute
rule as a downloaded file (`decideAbsolute`, below). A lone track in a language with a single text
track is something `102` never reads. It joins the same single pass (NFR-1), so the resolver
builds its read set from `selectSubtitleStreams`' output, not from `102`'s `qualifyingGroups`.

**One absolute rule, two callers.** `decideAbsolute(text, detector)` in `encode/variant-score.ts`
turns a text into a tag or `null`: a rate per 1,000 words, two thresholds and a minimum word count.
The download check and the lone-track encode rule both call it, so one calibration covers both.

**The marker table grows (REQ-4b).** `id`, `curro`, `mola`, `guay`, `chaval` and the rest join
the Spain side, and `departamento`, `rentar`, `chamaco`, `güey` and the rest join the Latin side.
The table is shared with `110`'s audio scoring, so the change lands as its own step, after the
pure move, and is gated on `110`'s three films keeping their verdicts.

The variant map reaches `buildFfmpegCommand` as a new **required** argument. Inside `src/ffmpeg/`,
`selectSubtitleStreams` and `getSubtitleParams`/`trackLanguageTitle` take a `detect` function built
with the existing `detectWithTags` (`ffmpeg/variants.ts`), exactly as audio already does. The
decided tags then flow through `031`'s `narrowToVariants` and `variantTitle` with no new rule.
`102`'s own grouping (`qualifyingGroups`) keeps calling `selectSubtitleStreams` without the map,
because the map does not exist yet when it runs.

**Download check (worker + api).** The check rides inside the existing `subtitle-sync` job
(`jobs/subtitle-sync.job.ts`). It adds no job, queue or report mutation of its own. When
`SubtitleSyncDetails.variantDetectionIso3` is set, the job reads the staged candidate, decodes it
with the decoder `normalize-srt.ts` already uses (UTF-8, UTF-16 or Windows-1252, exported for this),
parses it with `parseSrt` (`ffmpeg/subtitle-content.ts`) and scores the whole text. Then it runs
`measureSync` as today and reports `variantTag` beside the measurement. `api` decides acceptance in
`SubtitleSearchService.completed`, beside `accept()`. A valid `variantTag` against a wanted variant
rejects the candidate with `error.subtitleSearch.wrong_variant`. That check runs **before**
`accept()`'s sync reasons, so a wrong-variant candidate always shows the variant reason (spec
REQ-15, "however good its sync result").

**Opt-in and wanted variants (api).** `110` REQ-4's per-owner predicate in
`process-jobs.service.ts` (`collectAllowedLanguages`) is lifted into one pure function in
`src/languages/`. It is parameterised by track kind (`AUDIO`/`SUBTITLE`) and shared by the encode
(`EncodeJobDetails.subtitleVariantDetection`) and by the subtitle search request
(`subtitle-search-request.service.ts`). The search request resolves the opt-in and the wanted
variants once, when it creates the `SubtitleSearch` row, and stores them in the new
`SubtitleSearch.wantedVariants` column (spec 0.4.0). The search reads that snapshot, so a
preference changed mid-search cannot flip a candidate between "rejected" and "accepted".

**Provider query (api).** `providerLanguageCodes` (`subtitle-search/provider-languages.ts`) gains
the variant code: a constant map from a variant tag to the provider's code for it, filled for
`es-419` only after `api` T0 confirms the exact value from OpenSubtitles' `/infos/languages`. If
the provider turns out to have no separate code, the map stays empty and REQ-13b's "no code of its
own" path applies, with nothing else changing. `searchProvider` runs the variant query, and when it
yields fewer than `MAX_CANDIDATES_PER_LANGUAGE` it runs the plain query too. It dedupes by provider
subtitle id, keeps each group's `filterAndRank` order with the variant group first, and slices to
three.

**Titling a downloaded track (api).** `embedStaged` (`subtitle-embed/subtitle-embed.service.ts`)
titles from `Language.trackTitle` by `iso3`. A decided attempt passes its `variantTag`, and the
title comes from a small `api` constant (`es-419` → `Latino`, `es-ES` → `Español (España)`). The
alternative was seeding `trackTitle` on the `es-419`/`es-ES` rows, and it is rejected:
`trackTitles` is keyed by `iso3`, so a second `spa` title would race the plain `Español` into the
worker's per-job title map (`051`). The seed also never updates an existing row. The two strings
are duplicated between `api` and the worker's `031` table. That is the same posture `051` took
when it kept the variant titles worker-local, and a test on each side pins the strings.

**Absolute thresholds score a rate, not a raw count.** A downloaded file is a whole film, and its
raw score grows with its length: a 2 h Spain subtitle scores several times a 20 min episode's. The
download check therefore compares **marker score per 1,000 words** against the two thresholds. The
encode keeps comparing raw scores, since both candidates cover the same 900 s window.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 0 | `[verify]` corpus | Finds the corpus film(s), labels the tracks and the downloaded files, and measures the marker rates. Every threshold constant depends on it. It can run while 1 is in progress |
| 1 | `api` | Owns the migration, `EncodeJobDetails.subtitleVariantDetection`, `SubtitleSyncDetails.variantDetectionIso3`, the `variantTag` argument and the provider code (T0). Every consumer reads through these |
| 2a | `web` | Needs nothing new from `api` beyond copy and the enabling condition. It can start as soon as the spec is Approved |
| 2b | `worker` (scoring + encode resolver + sync job) | The shared-table move, the subtitle-variant resolver and the sync-job check. Start once the contract is frozen; the end-to-end run needs step 1 live |
| 2c | `ffmpeg` agent (`src/ffmpeg/`) | Consumes the variant map in subtitle selection and titling. Independent of 2b once the map shape below is fixed |
| 3 | `worker` (wiring) | `encode.job.ts` reads `subtitleVariantDetection`, and `encode.ffmpeg.ts` joins 2b and 2c. Thresholds are set from step 0 |
| 4 | `[docs]`/`[verify]` | Corpus run (AC-1 to AC-18), the time measurements, the `CLAUDE.md`, `graphql-contract.md` and `.claude/agents/ffmpeg.md` updates |

2a, 2b and 2c run in parallel once the spec is Approved.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will be tempted to change, and must not:

- **The worker never learns the wanted variant.** It reports what it decided and `api` decides the
  rejection. Passing the wanted variant down would let the worker skip `measureSync` on a
  wrong-variant candidate. That would save time, but it would spread the acceptance rule across two
  services. The sync cost on a rejected candidate is accepted.
- **`variantTag` is `null` for undecided, failed and not-run alike.** Do not add a status enum. To
  `api` the three are the same, since none of them rejects or titles.
- **`api` validates `variantTag` against the `Language` table**: a row whose tag has a region subtag
  and whose `iso3` is the attempt's language. Anything else is logged and treated as undecided,
  never as a rejection.
- **`setAudioVariantDetection` keeps its name and its acceptance of `true` with no variant
  language.** No refusal is added.
- **The worker reads a missing `subtitleVariantDetection` as `false` and a missing
  `variantDetectionIso3` as `null`.** It never throws on either.
- **The encode-side map shape between `src/encode/` and `src/ffmpeg/`** is
  `ReadonlyMap<number, string>` (ffprobe stream index → decided variant tag, decided streams only),
  passed as `subtitleVariants`. It is the same shape as `AudioVariantResolution.tags`. There is no
  `duplicates` set for subtitles (spec REQ-8).
- **`SubtitleSearch.wantedVariants`** is written once, at creation, and never updated. `null` means
  off. `{}` means on with nothing to reject.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, and re-brief `api`,
`web` and `worker` (Constitution, Article VIII).

## Migrations

1. `<timestamp>_subtitle_variant_check`, one migration:
   - `ALTER TABLE subtitle_searches ADD wantedVariants JSON NULL`
   - `ALTER TABLE subtitle_search_attempts ADD variantTag VARCHAR(10) NULL`
2. Backfill: none (NFR-5). Every existing search reads `null` (check off), and every existing
   attempt reads `null` (unchecked).

Reversibility: dropping both columns loses only the snapshots and verdicts of searches made since.
Nothing outside `subtitle-search/` and `subtitle-embed/` reads them.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A decided verdict is wrong, so a Castilian subtitle is titled `Latino` (encode) or a Latin one is rejected (download) | Silent: the file plays with the wrong dialect under the right title, or a good subtitle is thrown away and the quota spent | Thresholds come from step 0's labelled corpus and sit with margin on both sides. Undecided is the default on any ambiguity (NFR-3). The scorer specs assert every labelled corpus sample lands on its side |
| The staged file is Windows-1252 and is read as UTF-8 | Silent: `á`/`é` become `�`, `-áis`/`-éis`/`móvil` never match, and a Spain subtitle scores as Latin or undecided | The sync job reuses `normalize-srt.ts`'s decoder, which already handles this for embeds. A spec feeds a Windows-1252 fixture and asserts it scores the same as its UTF-8 copy |
| `buildFfmpegCommand` gets the map but a call site passes an empty one | Silent: detection runs and stores, and selection never sees it | The parameter is **required**, and `encode.ffmpeg.spec.ts` asserts the resolver's map reaches the command |
| A `subs` hit skips the read and with it the variant detection | Silent: after a restart the variant is never decided, and both tracks read `Español` | The resolver spec covers the "drops stored, variant missing" case and asserts one read of just the candidates |
| The read set comes from `102`'s groups | Silent: a lone Spanish track in a file with one Spanish subtitle is never read, so never decided | The candidate source is `selectSubtitleStreams`' output. The resolver spec has a single-track-language case |
| A new marker flips one of `110`'s audio verdicts | Silent: a dub that was correctly `Latino` becomes `Español (España)` on the next encode | Marker additions are their own step, and `audio-variant-score.spec.ts` re-runs `110`'s three films with unchanged expectations (AC-4d) |
| `id` matches `ID` (identification) | Silent: a Latin subtitle full of "tu ID" scores toward Spain | Case-sensitive pattern, with a spec case (AC-4c) |
| A lone decided track is the variant the user did not ask for | Looks like a bug ("I asked for Latino and got Spain"), but it is `031`'s rule: narrowing never empties a language | Spec NFR-3 says so explicitly. The title (`Español (España)`) shows the user what they got |
| The variant verdict is keyed on the wrong file | A season-pack episode reads another episode's verdict | The identity includes path, size and mtime (`111` REQ-3). The resolver spec asserts a different file misses |
| `api` titles a decided download from a stale or missing map entry | Silent: the track reads `spa` or plain `Español` | The title constant has a spec that pins both strings against the worker's `variantTitle` values |
| The provider's variant code is guessed | Silent: the variant query returns nothing and every search pays two queries for no gain | `api` T0 reads `/infos/languages` and records the result in `api/plan.md`'s step 1 before the constant is written |
| The two provider queries return the same subtitle | It is downloaded twice, and the quota is spent twice | Dedupe by provider subtitle id before slicing (spec AC-16b). The driver spec covers it |
| A rejection reason from the sync check hides the variant one | The user sees "does not match this file" for a subtitle that was simply the wrong dialect | `completed()` evaluates the variant rule first. The service spec covers a candidate that fails both |
| The absolute threshold scales with length | A long film clears the Spain threshold on weak markers alone | The score is a rate per 1,000 words (Approach). Step 0 measures it on films and episodes alike |
| Lifting the opt-in predicate changes `110`'s audio result | Silent: audio detection turns on or off for the wrong owners | `process-jobs.service.spec.ts`'s existing `110` cases stay green unchanged. The new function has its own table of cases for both kinds |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
bin/comments api
git diff services/api/src/schema.gql          # exactly spec.md § GraphQL Contract Delta
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments web
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments worker
```

Step 0, the corpus pass (before any threshold constant is committed):

1. For It Chapter Two, Interstellar and Jurassic Park III, list the source's subtitle streams
   (`ffprobe_logs`, or `bin/cli worker ffprobe` on the source if it is still in the downloads root)
   and record every film with two Spanish text tracks that `031` cannot resolve, with their
   indices. If none qualifies, stop and report: AC-1 and AC-2 need a different film, and the spec
   has to name it.
2. Extract the first 900 s of each candidate, have a human read about 20 cues of each, and record
   the variant.
3. Download at least three Spain and three Latin American Spanish subtitles for those films from
   OpenSubtitles (about six downloads of the daily quota), label each by hand, and add a 20-minute
   episode subtitle of each variant.
4. Run the scorer over all of them. Record the raw scores (encode pairs) and the rates (downloads)
   in a table in `worker/plan.md`, including 900 s samples of single tracks for the lone-track rule
   and short forced tracks for the minimum word count. Then set the encode margin, the two rate
   thresholds and the minimum with
   every labelled sample on its side and room to spare.

Manual pass, on the dev stack:

1. In `/preferences`, with audio `en` only and subtitles `es-419`, the checkbox is enabled. Clear
   `es-419` from the subtitle languages and it is disabled with the new hint, in `es` and `en`
   (AC-6, AC-7).
2. Import the corpus film for a user with subtitle `es-419` and the preference on, and let it
   encode. The log shows `[subvariant] spa <i>:<score> <j>:<score> → <i>=… <j>=…`, the output keeps
   only the Latin track titled `Latino`, and
   `bin/cli redis redis-cli --scan --pattern 'perceptor:encode:subtitle-variant:*'` lists the key
   (AC-1). Repeat with plain `es`: both tracks are kept and titled (AC-2).
2b. Encode a file whose only Spanish subtitle is one untitled text track. The log shows
   `[subvariant] spa <i>:<rate>/kw → …`, and the track is titled `Latino` or `Español (España)`
   by its verdict, kept either way (AC-4b).
3. `docker compose kill worker` after the `[subvariant]` line, and let `054` recover it. The log
   shows `(reused)` (AC-8). Repeat with Redis stopped: the verdict is applied and the store error is
   logged (AC-11).
4. On a delivered film with no Spanish subtitle, as an owner with subtitle `es-419` and the
   preference on, press "Buscar subtítulos". The `api` log shows the variant query, then `es` if
   it was short. Each attempt row (`bin/mysql -e 'select id, rank, status, reasonKey, variantTag
   from subtitle_search_attempts order by id desc limit 5'`) carries its `variantTag`. A Spain
   candidate reads `REJECTED`/`error.subtitleSearch.wrong_variant`, and the embedded track is
   titled `Latino` (AC-13, AC-16b).
5. Truncate a staged candidate to zero bytes while its sync job is queued. The worker logs the
   check failure, and the candidate follows `103`'s path (AC-17).

## Live encode pass (T022, 2026-11-15)

The three `110` films hold one Spanish subtitle track each, so the pass used test files built from the
OpenSubtitles corpus (`<downloads root>/corpus-118/live/`, outside the repository): a 1000 s synthetic
video with one English audio track and Spanish text tracks tagged `spa` with no title. They went
through the real `encodeFfmpeg` driver (real ffmpeg, mkvmerge and Redis verdict store) with
`ENCODE_SAMPLE_SECONDS=20`, from a throwaway script, not through the queue: the library, the
`api` and the user's preferences were not touched.

| Case | Opt-in | Requested | Log / result | AC |
| :-- | :-- | :-- | :-- | :-- |
| two untitled tracks (Spain + Latin) | on | `es-419` | `[subvariant] spa 2 3 → 2=es-ES 3=es-419`; output keeps one track, `Latino`; key `perceptor:encode:subtitle-variant:<sha1>` in Redis | AC-1 |
| same file | on | `es` | both kept: `Español (España)`, `Latino` | AC-2 |
| same file | off | `es-419` | no `[subvariant]` line; both kept, `Español`, `Español` | AC-5 |
| titles `Castellano` / `Latino` | on | `es-419` | no `[subvariant]` line; one track kept, `Latino` (031's metadata) | AC-3 |
| two Latin translations | on | `es-419` | `[subvariant] spa 2 3 → undecided`; both kept, `Español` | AC-4 |
| one Spain track | on | `es-419` | `[subvariant] spa 2 → 2=es-ES`; kept, `Español (España)` | AC-4b |
| one Latin track | on | `es-419` / `es-ES` | `2=es-419`; kept, `Latino` | AC-4b |
| two-track file, second process | on | `es-419` | `[subvariant] … (reused)`; no scoring; the verdict was stored by the previous process | AC-8 (reuse across processes; the container was not killed) |
| two-track file, Redis stopped | on | `es-419` | `[verdict] read/write subtitle-variant failed`; verdict applied (`Latino`); encode delivered | AC-11 |

Timing (AC-18, encode): `resolveSubtitlePruning` on the 1000 s two-track file took 146 ms with the
opt-in off and 234 ms with it on, including the ffmpeg read, so scoring adds about 90 ms.

Not observed live: AC-6 and AC-7 (UI), AC-9 (compression off, covered by `encode.job.spec.ts`),
AC-10 (PGS pair, covered by `subtitle-prune.spec.ts`) and AC-12 (missing field, covered by
`encode.job.spec.ts`).

## Live search pass (T023, 2026-11-15)

Run on Reacher S02E05 (`episodeId 13`, only English audio and subtitle), owner `admin` with `es-419`
in the subtitle languages, `audioVariantDetection` switched on for the pass, "Buscar subtítulos"
pressed from the UI (a backup of the file existed).

- Search 7 stored `wantedVariants = {"spa":"es-419"}`.
- `api` log: `Subtitle search 7 spa: variant query ea returned 0`, then `plain query es returned 2`.
  Two candidates, so the variant-first, plain-fill order of REQ-13b ran (AC-16b's one-candidate case
  was not met: the provider's Latin American code returned none for this episode).
- Attempts: rank 1 `REJECTED` / `error.subtitleSearch.wrong_variant` / `variantTag es-ES`
  (`…NTb_track12_[spa]`); rank 2 `ACCEPTED` / `variantTag es-419` (`…NTb_track11_[spa]`). Search 7
  ended `COMPLETED` (AC-13).
- The embedded file now has track 3, `spa`, titled `Latino` (`ffprobe`); the English track is intact.
- Timing (AC-18, one candidate): `detectDownloadedVariant` on corpus files of 50 to 150 KB took 12 to
  70 ms.

Not exercised: AC-14 (plain `es` owner), AC-15 (preference off), AC-16 (every candidate Spain),
AC-16c, AC-16d and AC-17 (truncated candidate). They stay covered by the unit specs only.

While running it, `redis` lost name resolution after `docker compose stop/start` in the AC-11 step
and the search sat in `WAITING` until `redis` was recreated and `api` and `worker` restarted. That
is the dev stack, not the feature.

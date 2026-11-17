---
title: Subtitle Variant Detection — Tasks
last_updated: 2026-11-15
status: Done
---

# TASKS: Subtitle Variant Detection (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation, live passes and the corpus measurement. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Inside `[worker]` there are two territories (`worker/plan.md` § Scope):

- **(ffmpeg)** tasks touch `src/ffmpeg/` or `.claude/agents/ffmpeg.md` and are dispatched to the
  `ffmpeg` agent.
- **(encode)** tasks touch `src/encode/`, `src/jobs/`, `src/api/` or `src/subtitles/` and go to
  the `worker` agent.

No `[infra]` task: the feature adds no image dependency, container or wrapper (spec NFR-1).

## Tasks

### Group 0 — external facts

Both tasks can start at once. Every threshold depends on T001, and the provider map on T002.

- [x] **T001** `[docs] [P]` Corpus pass, `plan.md` § Verification step 0 and `worker/plan.md`
      step 1.
      - List the subtitle streams of It Chapter Two, Interstellar and Jurassic Park III, and record
        every one with two unresolved Spanish text tracks, with their indices. If none qualifies,
        stop and move this task to **Blocked**: the spec has to name another film.
      - Extract 900 s samples, have a human read about 20 cues of each and label them.
      - Download at least three Spain and three Latin American subtitles from OpenSubtitles, plus
        one 20-minute episode subtitle of each variant and one short forced track.
      - Keep the files outside the repository, under the downloads root, and record their paths.
      - Fill the table in `worker/plan.md` step 1 with the label, raw score, words and rate, using
        the current markers.

      *Done when:* the table lists every sample with its human label, and the qualifying film and
      stream indices are written into `worker/plan.md`.
- [x] **T002** `[api] [P]` Per `api/plan.md` step 0: query OpenSubtitles' `/infos/languages` once
      and record the Latin American Spanish code, or that none exists, in `api/plan.md` step 0.
      *Done when:* `api/plan.md` step 0 names the code (or "none") with the response line it came
      from.

### Group 1 — contract and schema (`api`)

- [x] **T003** `[api]` Per step 1: add `SubtitleSearch.wantedVariants Json?` and
      `SubtitleSearchAttempt.variantTag String? @db.VarChar(10)`, and the
      `<ts>_subtitle_variant_check` migration.
      *Done when:* `bin/cli api npx prisma migrate status` reports the schema up to date, and
      `bin/mysql -e 'describe subtitle_searches; describe subtitle_search_attempts'` shows both
      nullable columns.
- [x] **T004** `[api] [P]` Per step 2: create `src/languages/variant-opt-in.ts`
      (`wantsVariantDetection`, `wantedVariants`, `VARIANT_TRACK_TITLES`) and its spec, with the
      cases in `api/plan.md` § Tests.
      *Done when:* `bin/npm api test -- variant-opt-in` passes.
- [x] **T005** `[api]` Per step 3: replace `collectAllowedLanguages`' inline `110` predicate with
      `wantsVariantDetection(…, AUDIO, …)`, and add `EncodeJobDetails.subtitleVariantDetection`
      with its `process-jobs.service.spec.ts` cases. → T004
      *Done when:* `bin/npm api test -- process-jobs` passes, and every pre-existing `110` case
      passes with no expectation edited (`git diff` on the spec file shows only additions).
- [x] **T006** `[api]` Per step 4: resolve and store `wantedVariants` in both create paths of
      `subtitle-search-request.service.ts`, over every owner of the title. → T003, T004
      *Done when:* `bin/npm api test -- subtitle-search-request` passes, with a case for `null`
      (nobody opted in), `{}` (opted in, plain `es`) and `{ spa: 'es-419' }`.
- [x] **T007** `[api]` Per steps 5, 7 and 9:
      - `SubtitleSyncDetails.variantDetectionIso3` in `details()`;
      - the `variantTag` argument on `subtitleSyncCompleted`, with validation;
      - the wrong-variant rule ahead of `accept()`, storing `variantTag`;
      - `SUBTITLE_SEARCH_WRONG_VARIANT` and its English message.

      → T006
      *Done when:* `bin/npm api test -- subtitle-search.service` passes, with every case in
      `api/plan.md` § Tests for that file.
- [x] **T008** `[api]` Per step 6: add `PROVIDER_VARIANT_CODES`/`providerVariantCode` with T002's
      code, plus the variant-first, plain-fill, deduped, three-capped query in `searchProvider`.
      → T002, T006
      *Done when:* `bin/npm api test -- subtitle-search.driver provider-languages` passes, with the
      3 / 1 / overlap / no-variant cases.
- [x] **T009** `[api]` Per step 8: carry `variantTag` from the accepted attempt through
      `embedding()` into `embedStaged`, and title from `VARIANT_TRACK_TITLES`. → T007
      *Done when:* `bin/npm api test -- subtitle-embed.service subtitle-search.driver` passes, with
      a decided `es-419` track titled `Latino` and an undecided one titled `Español`.
- [x] **T010** `[api]` Per step 10: run the full slice check. → T005, T007, T008, T009
      *Done when:* `bin/cli api npx --no tsc --noEmit`, `bin/npm api test` and `bin/comments api`
      pass, and `git diff services/api/src/schema.gql` is exactly `spec.md` § GraphQL Contract
      Delta.

### Group 2 — consumers and scoring

T011, T012 and T015 depend on nothing in Group 1. They read no new field, or they sit behind the
frozen map shape, so they start at once. Everything that reads a new GraphQL field waits for the
`api` task that produces it.

- [x] **T011** `[web] [P]` Per `web/plan.md` steps 1–3: make `variantDetectionAvailable` count the
      subtitle tags too, set the three new `preferences.form.audioVariantDetection*` values and
      add `error.subtitleSearch.wrong_variant` in `es`/`en`.
      *Done when:* `bin/cli web npx --no tsc --noEmit`, `bin/cli web node
      scripts/check-messages.mjs` and `bin/comments web` pass.
- [x] **T012** `[worker] [P]` (encode) Per `worker/plan.md` step 2: rename to
      `variant-detectors.ts`, move `score`/weights/`dedupeLines` to `variant-score.ts`, and update
      the imports. No marker or behaviour change.
      *Done when:* `bin/npm worker test` passes with no expectation in `audio-variant*.spec.ts`
      edited.
- [x] **T013** `[worker]` (encode) Per step 2b: add REQ-4b's markers, with `id` case-sensitive.
      Re-run `110`'s audio scorer with unchanged expectations, and add the `ID`/`id`/`Id` spec
      cases. → T012, T001
      *Done when:* `bin/npm worker test -- variant` passes, `audio-variant-score.spec.ts` is
      unchanged (spec AC-4d), and the strong/weak choice for each new marker is recorded in the
      `worker/plan.md` step 1 table.
- [x] **T014** `[worker]` (encode) Per step 3: add `scoreRate` and `decideAbsolute`, plus
      `SUBTITLE_DECISION_MARGIN`, `DOWNLOAD_SPAIN_MIN_RATE`, `DOWNLOAD_LATIN_MAX_RATE` and
      `MIN_WORDS_FOR_RATE` set from T001's table (re-scored with T013's markers), and
      `variant-score.spec.ts` asserting every corpus sample's side. → T013
      *Done when:* `bin/npm worker test -- variant-score` passes, and the chosen values with their
      margins are written under the `worker/plan.md` step 1 table.
- [x] **T015** `[worker] [P]` (ffmpeg) Per step 6: add a `detect` parameter to
      `selectSubtitleStreams`, `getSubtitleParams` and `trackLanguageTitle`, plus the required
      `subtitleVariants` argument on `buildFfmpegCommand` built with `detectWithTags`, and the
      `params.spec.ts`/`buildCommand.spec.ts` cases.
      *Done when:* `bin/npm worker test -- ffmpeg` passes. The whole-service typecheck, including
      the call site in `encode.ffmpeg.ts`, is T017's.
- [x] **T016** `[worker]` (encode) Per step 4: make `resolveSubtitlePruning` return
      `{ drops, variants }`. It covers pairs and lone tracks, takes its candidates from
      `selectSubtitleStreams`' output and makes one read for the union. Also add
      `'subtitle-variant'` to `VERDICT_KINDS` and every `subtitle-prune.spec.ts` case listed in
      `worker/plan.md` § Tests. → T014
      *Done when:* `bin/npm worker test -- subtitle-prune` passes.
- [x] **T017** `[worker]` (encode) Per step 5: add `subtitleVariantDetection` to `encode.job.ts`'s
      query, with its typeof/log default and the `compressing` AND, add it to `types.ts`, and pass
      `variants` to `buildFfmpegCommand` in `encode.ffmpeg.ts`, with the `encode.ffmpeg.spec.ts`
      assertion that the map arrives. → T005, T015, T016
      *Done when:* `bin/cli worker npx --no tsc --noEmit` and `bin/npm worker test` pass.
- [x] **T018** `[worker]` (encode) Per step 7: export `decodeSubtitleBytes` from
      `normalize-srt.ts`, and create `subtitles/subtitle-variant.ts` (`detectDownloadedVariant`)
      with its spec: Windows-1252 equals UTF-8, a zero-byte file gives `null`, an in-between rate
      gives `null`, no detector gives `null`. → T014
      *Done when:* `bin/npm worker test -- subtitles` passes.
- [x] **T019** `[worker]` (encode) Per step 8: add `variantDetectionIso3` to the details query and
      the `variantTag` argument to `subtitleSyncCompleted` in `subtitle-sync-reports.ts`, and run
      the check before `measureSync` in `subtitle-sync.job.ts`, with its spec cases. → T007, T018
      *Done when:* `bin/cli worker npx --no tsc --noEmit`, `bin/npm worker test` and
      `bin/comments worker` pass.

### Group 3 — verification and docs

- [x] **T020** `[docs]` Update `docs/spec/graphql-contract.md` with the delta:
      - the `subtitleVariantDetection` field;
      - the `variantDetectionIso3` field;
      - the `variantTag` argument;
      - the new description of `audioVariantDetection`;
      - the `error.subtitleSearch.wrong_variant` reason key.

      → T010
      *Done when:* each of the five items appears in the file, matching `spec.md` word for word.
- [x] **T021** `[docs]` Update the affected `CLAUDE.md` files and agent briefs:
      - root `CLAUDE.md`: the Transcode row (subtitle text check, metadata first, pairs and lone
        tracks, the shared marker table and its new markers) and the Notify media server row
        (variant query, wrong-variant rejection, `Latino`/`Español (España)` embed titles), with
        `118` added to both spec lists;
      - `services/api/CLAUDE.md`, `services/web/CLAUDE.md` and `services/worker/CLAUDE.md`;
      - `.claude/agents/ffmpeg.md` § L1, so it says that text-derived subtitle labels are gated
        like audio's.

      → T010, T011, T019
      *Done when:* `grep -n "118" CLAUDE.md services/*/CLAUDE.md .claude/agents/ffmpeg.md` shows an
      entry in each.
- [x] **T022** `[docs]` Live encode pass on the dev stack, per `plan.md` § Verification manual
      steps 1–3 and 2b. → T011, T017
      *Done when:* AC-1 to AC-12 and AC-4b are each observed, with the log line or `ffprobe` output
      recorded under each AC in `spec.md`. AC-4c and AC-4d are confirmed by the T013 specs, and
      AC-18's encode timing is recorded in `plan.md`.
- [x] **T023** `[docs]` Live search pass per `plan.md` § Verification manual steps 4–5, on a
      delivered film with no Spanish subtitle. It spends at most about six OpenSubtitles downloads.
      → T009, T019
      *Done when:* AC-13 to AC-17, AC-16b to AC-16d and AC-18's per-candidate timing are each
      observed, with the attempt rows (`variantTag`, `status`, `reasonKey`) recorded in `spec.md`.
- [x] **T024** `[docs]` Walk the acceptance criteria in `spec.md` and tick each box. Set
      `status: Implemented` on `spec.md`, `plan.md` and every `<svc>/plan.md`. Append the
      `docs/spec/history.md` entry, including that REQ-4b's markers also reach `110`'s audio
      scoring. → T020, T021, T022, T023
      *Done when:* `grep -c "\- \[ \]" docs/spec/features/118-*/spec.md` counts only criteria that
      are named under **Blocked** with a reason, and every file reads `Implemented`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

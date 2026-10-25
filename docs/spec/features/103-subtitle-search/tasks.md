---
title: Subtitle Search — Tasks
last_updated: 2026-10-25
status: In Progress
---

# TASKS: Subtitle Search (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation, the constitution amendment, the threshold measurement and the manual pass. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer. |

The worker plan's image step (`worker/plan.md` § Steps, 1) is an `[infra]` task here, because
`services/*/Dockerfile` is `infra` territory. The worker's code tasks consume the image it produces.

**Measuring.** The stack running on this host is the end-user install, not this checkout, so
`bin/cli`/`bin/npm` may find no container. Until a dev stack for this checkout is up without colliding
with that install's ports, run each *Done when* command through the throwaway container described in
memory (`measuring-without-dev-stack`): `docker run --rm --user 1000:1000 -v
"$PWD/services/<svc>":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c '<command>'`. Report which
form was used.

## Tasks

### Group 0 — the rule first

- [x] **T001** `[docs]` Amend Article XII through `/constitution`, per spec NFR-1: the first `101`
      exception also covers an embed started by `103` for an opted-in title, and the second stays
      administrator-only.
      *Done when:* `docs/constitution.md` reads `version: 1.6.0` with a Changelog row naming `103`.
      *Done 2026-10-24.*

### Group 1 — `api`: schema, contract and the driver

T003, T005, T006 and T007 do not depend on the migration or on each other and can start with T002.

- [x] **T002** `[api]` Add the migration `add_subtitle_search` per `plan.md` § Migrations:
      - the three `subtitleSearch` columns;
      - the three enums;
      - `subtitle_searches`, `subtitle_search_attempts`, with their indexes and cascade rules.

      *Done when:* `bin/cli api npx prisma migrate status` is up to date, and
      `git status services/api/prisma/` shows a modified `schema.prisma` and one new migration
      directory.
- [x] **T003** `[api] [P]` Extend the Jellyfin client (`clients/media-server/types.ts`,
      `jellyfin.ts`): `ItemSubtitles.presentLanguagesIso3`, the type `RemoteSubtitleCandidate`, and
      the optional members `searchRemoteSubtitles(itemId, iso3)` and
      `fetchRemoteSubtitle(subtitleId)`, each with a 30 s timeout.
      *Done when:* `jellyfin.spec.ts` covers forced streams being excluded, embedded and external
      streams being counted, and absent remote booleans read as `false`; `bin/npm api test` is green.
- [x] **T004** `[api]` Add the flags and the capability:
      - `MediaCapabilities.subtitleSearchAvailable` and `isSubtitleSearchAvailable()` in
        `media-capabilities.service.ts`;
      - `subtitleSearch` on `UserPreferences`, `Movie` and `Show`, following `audioMandatory`;
      - `setSubtitleSearch`, `setMovieSubtitleSearch` and `setShowSubtitleSearch`, refusing with
        `error.subtitleSearch.unsupported_media_server`;
      - every `error.subtitleSearch.*` key in `error-keys.ts` and `messages.en.ts`.

      → T002
      *Done when:* a test shows each setter refused with the media server set to `none`, and
      accepted with `jellyfin`; `bin/npm api test` is green.
- [x] **T005** `[api] [P]` Write the pure rules `subtitle-search/candidates.ts`
      (`filterAndRank`, release-name Jaccard) and `subtitle-search/acceptance.ts` (`accept`, with
      both thresholds at `Number.POSITIVE_INFINITY` and a `// Spec 103, REQ-10` locator).
      *Done when:* `candidates.spec.ts` and `acceptance.spec.ts` cover every case in
      `api/plan.md` § Tests and pass.
- [x] **T006** `[api] [P]` Make the `101` delta in `subtitle-embed.service.ts`:
      - extract `embed()`'s tail into `queueEmbed`;
      - add a public `embedStaged(ref, tracks)` that refuses a `stagedPath` outside the downloads
        root;
      - add `StoredTrack.stagedPath`;
      - `details()` sets `sourcePath`/`isSidecar`;
      - `SubtitleEmbedTrack.isSidecar: Boolean!`;
      - export `SubtitleEmbedService`.

      *Done when:* the existing `101` tests still pass, and new tests show `isSidecar: true` for a
      `101` row, `false` with `sourcePath = stagedPath` for a staged one, the outside-root refusal,
      and the `busy` refusal.
- [x] **T007** `[api] [P]` Add the queues:
      - the `subtitle-sync` producer, and `SUBTITLE_SYNC_QUEUE`/`SUBTITLE_SYNC_JOB`/`SubtitleSyncJob`
        in `queue/types.ts`;
      - `SubtitleSearchQueueService`, with the `api`-internal `subtitle-search` `Queue` and
        `Worker`, `concurrency: 1`, on `queue/connection.ts`, exposing `wake(searchId, delayMs)`
        and closing in `onModuleDestroy`.

      *Done when:* `api` boots (`bin/cli api npx --no tsc --noEmit` clean, `api` healthy) and a
      `wake` on a test search id calls the registered handler.
- [x] **T008** `[api]` Add the request path:
      - `subtitle-search-request.module.ts`/`.service.ts`, with `requestFor` covering the effective
        flag, the wanted languages, supersede, insert and the first wake;
      - the call in `ProcessJobsService.encodeCompleted`, after `notifyCreated`, only on a real
        delivery;
      - `reconcileOrphanedEncodes` also failing `RUNNING` attempts with `interrupted`.

      → T002, T004, T007
      *Done when:* the request-service and process-jobs tests in `api/plan.md` § Tests pass,
      including no row with the preference off, a superseded `WAITING` search, and a throw that never
      propagates.
- [x] **T009** `[api]` Write `SubtitleSearchDriver.advance` per `api/plan.md` § Steps 6:
      - the four steps;
      - staging writes and deletes under `.perceptor/subtitle-search/`;
      - the boot re-wake and the orphan sweep.

      → T003, T005, T006, T007, T008
      *Done when:* `subtitle-search.driver.spec.ts` covers every case in `api/plan.md` § Tests (the
      path match, the fifth miss, a forced-only language searched, a present language never
      searched, `busy` failing, E01 of a scanned pack embedding while E02 encodes, staging deletion
      on every path, the boot re-wake, a duplicate wake writing nothing, no second set of attempts
      after a crash) and passes.
- [x] **T010** `[api]` Add the worker-facing surface: `subtitleSyncDetails`, `subtitleSyncStarted`,
      `subtitleSyncCompleted` and `subtitleSyncFailed`. They are service-only, idempotent, apply
      `accept()`, store an unknown key as `sync_failed`, and only add a wake-up.
      → T002, T005, T007
      *Done when:* tests show a user principal refused, a repeat report writing nothing, and a
      rejected measurement stored with its reason key.
- [x] **T011** `[api]` Add the reads: `latestSubtitleSearch` on `Movie` and `Episode`, with
      `languages` derived per `api/plan.md` § Steps 10.
      → T002
      *Done when:* a test derives each of the six outcomes from rows.
- [x] **T012** `[api]` Close the contract: typecheck, test, lint and `bin/comments api`.
      → T004, T006, T009, T010, T011
      *Done when:* `git diff services/api/src/schema.gql` equals `spec.md`'s delta plus
      `SubtitleEmbedTrack.isSidecar`, and nothing else. Typecheck is 0 errors, tests are green (with
      counts), and lint and comments pass.

### Group 2 — the worker image and the worker

T013 and T014 depend on nothing and can start with Group 1. T016 onward waits for the contract
(T012).

- [~] **T013** `[infra] [P]` Install `ffsubsync` (pinned) in the `base` stage of
      `services/worker/Dockerfile`, per `worker/plan.md` § Steps 1:
      - `python3` and `py3-numpy` from `apk`;
      - build dependencies in a virtual `apk` package, removed in the same `RUN`.

      If a dependency cannot build on musl, stop and report.
      *Done when:* `bin/build prod worker` succeeds and `bin/cli worker ffsubsync --version` prints
      the pinned version; the image size before and after is reported; arm64 is proven by the
      release workflow on an RC tag, with the run linked (`[~]` until that run exists).
- [x] **T014** `[worker] [P]` Write `src/subtitles/sync-reference.ts`: pick the reference stream,
      first a text subtitle that is not forced, then the default audio, then the first audio, with
      the index counted within its type.
      *Done when:* `sync-reference.spec.ts` covers a forced track skipped, a PGS-only file falling
      back to audio, `s:<n>` counted within subtitles, and default audio over first audio, and
      passes.
- [x] **T015** `[worker]` Write `src/subtitles/ffsubsync-output.ts`:
      - capture real logs from the pinned `ffsubsync`, one subtitle-reference run and one
        audio-reference run, into `src/subtitles/fixtures/`;
      - write the parser against those logs;
      - establish the sign with a `.srt` delayed by +2 s.

      → T013
      *Done when:* `ffsubsync-output.spec.ts` parses both fixtures, returns `null` on a truncated
      log, and asserts that the +2 s fixture yields `offsetMs` near `-2000`.
- [x] **T016** `[worker]` Wire the types:
      - `SUBTITLE_SYNC_QUEUE`/`SUBTITLE_SYNC_JOB`/`SubtitleSyncJob` in `src/queue/types.ts`;
      - `src/api/subtitle-sync-reports.ts`;
      - `isSidecar` in `src/api/subtitle-embed-reports.ts`, with absent read as `true`.

      → T012
      *Done when:* each name and field matches `spec.md`'s delta and `api`'s `queue/types.ts`;
      `bin/cli worker npx --no tsc --noEmit` is clean.
- [x] **T017** `[worker]` Write `src/jobs/subtitle-sync.job.ts`, add `'ffsubsync'` to the
      `binary` union in `ffmpeg/capture.ts`, add the fourth `Worker` in `index.ts` after the lease
      and `encodeWorkerStarted`, and add `error.subtitleSearch.sync_failed`/`interrupted` to the i18n
      keys.
      → T014, T015, T016
      *Done when:* `subtitle-sync.job.spec.ts` shows exit 1 reported as `sync_failed`, the temp
      directory removed on every branch, `candidatePath` never deleted, and no report after
      `started → false`; `bin/npm worker test` is green.
- [x] **T018** `[worker]` Change `src/jobs/subtitle-embed.job.ts` so only `isSidecar` tracks reach
      `deleteSidecars`.
      → T016
      *Done when:* a test shows a staged track never passed to `deleteSidecars`, and an embed of
      staged tracks only completing with no warning.

### Group 3 — `web`

All of it waits for the contract (T012). T020, T021 and T022 run in parallel once T019 lands.

- [x] **T019** `[web]` Add the types and actions:
      - `MediaCapabilities.subtitleSearchAvailable` and the `SubtitleSearch` types in
        `types/media.ts`;
      - the selects in `getMediaCapabilities`, `getPreferences`, the film query and the series
        query (`latestSubtitleSearch` per episode);
      - `setSubtitleSearchAction`, `setMovieSubtitleSearchAction` and
        `setShowSubtitleSearchAction`.

      → T012
      *Done when:* `bin/cli web npx --no tsc --noEmit` is clean, and each selected field exists in
      `services/api/src/schema.gql`.
- [~] **T020** `[web] [P]` Add the checkbox to `/preferences` (`PreferencesForm.tsx`), under the
      subtitle picker, disabled with a hint when the capability is false and saved by the existing
      button. Include the messages in both locales.
      → T019
      *Done when:* typecheck and lint are clean, and AC-1's `/preferences` half is visible in the
      browser.
- [~] **T021** `[web] [P]` Add the per-title checkbox to `TitleLanguagesForm.tsx` and wire it in
      `Movie.tsx`/`Show.tsx`: shown only when the capability and the preference are both on, saved
      in the form's `Promise.all`, and reverted on error. Also fetch `getMediaCapabilities()` on the
      series page. Include the messages in both locales.
      → T019
      *Done when:* typecheck and lint are clean, and AC-1/AC-1b's title half behaves as written in
      the browser.
- [~] **T022** `[web] [P]` Add `components/media/SubtitleSearchStatus.tsx` and use it in
      `TitleLanguagesPanel.tsx` (film) and on `SeasonAccordion.tsx` episode rows. Every status,
      outcome and key goes through the catalog, with the generic fallback for an unknown key.
      → T019
      *Done when:* typecheck and lint are clean, every new key is in `en.json` and `es.json`, and a
      seeded search row renders on both pages.

### Group 4 — measurement, docs and verification

- [ ] **T023** `[docs]` Measure the thresholds (REQ-10), per `plan.md` § Verification: four
      `ffsubsync` runs with the built image (two references, each with a good and a bad pair).
      → T013
      *Done when:* the four scores are written into this task's report and into `history.md`'s
      `103` entry.
      *Measured 2026-10-25* on six films (spec § Amendments 0.4.0 holds the table): lowest good
      score 364 547 (subtitle) and 202 612 (audio); bad 28 446 and -1 051. The table is in
      `history.md`'s `103` entry (T026).
- [x] **T024** `[api]` Set `SUBTITLE_REFERENCE_MIN_SCORE` and `AUDIO_REFERENCE_MIN_SCORE` from
      T023's measurements.
      → T005, T023
      Proposed: `SUBTITLE_REFERENCE_MIN_SCORE = 100_000`, `AUDIO_REFERENCE_MIN_SCORE = 50_000`.
      → also T030 (the coverage and framerate checks run before the score, so the measured
      incomplete and PAL candidates are rejected by those, not by the score)
      *Done when:* `acceptance.spec.ts` asserts each measured good score accepted and each measured
      bad score rejected, and passes.
- [x] **T025** `[docs]` Add a `103` section to `docs/spec/graphql-contract.md`:
      - the new types and mutations;
      - the `subtitle-sync` queue payload;
      - `SubtitleEmbedTrack.isSidecar`;
      - a note that `subtitle-search` is `api`-internal.

      → T012
      *Done when:* the section names every type in `spec.md`'s delta.
- [x] **T026** `[docs]` Update the docs that describe the code:
      - root `CLAUDE.md`: the Notify media server, Transcode and Browse library rows, with `103` in
        each spec list;
      - `services/api/CLAUDE.md`: the `subtitle-search/` module and the first BullMQ consumer in
        `api`;
      - `services/worker/CLAUDE.md`: the `subtitle-sync` job and `ffsubsync` in the image;
      - `services/web/CLAUDE.md`: the components;
      - a new entry in `docs/spec/history.md` (counts, migration, contract diff, thresholds).

      → T017, T018, T022, T024
      *Done when:* every new module and queue is named in its service's `CLAUDE.md`, and
      `history.md` has the entry.
- [ ] **T027** `[docs]` Run the manual pass, AC-1 through AC-11 per `plan.md` § Verification.
      → T018, T020, T021, T022, T024
      *Done when:* each AC has an observed result recorded, or a named blocker.
- [ ] **T028** `[docs]` Walk `spec.md`'s acceptance criteria and tick each one verified, including
      AC-12 from T012 and T017. Set `status: Implemented` on `spec.md`, `plan.md` and every
      `<svc>/plan.md`, and `status: Done` here. Run `/pending-acs`.
      → T026, T027
      *Done when:* every AC is ticked or has its blocker in `docs/spec/pending-acs.md`.

### Group 5 — amendment 0.4.0 (coverage and framerate, REQ-10)

- [x] **T029** `[worker]` `subtitle-sync.job.ts` reports `mediaDurationMs` on
      `subtitleSyncCompleted`, from the `format.duration` of the `getMetadata` call it already
      makes, and `lastChapterStartMs` from the file's chapters (`null` with fewer than 2); a
      missing or unparseable duration reports `sync_failed`, never a guess.
      → T030 (the contract fields must exist first)
      *Done when:* `subtitle-sync.job.spec.ts` asserts the reported duration from a fixture's
      `format.duration`, the last chapter start from a fixture with chapters (`null` with one
      chapter), and that the missing-duration case reports `sync_failed`; tests green.
- [x] **T030** `[api]` Contract and rule:
      - `subtitleSyncCompleted` takes `mediaDurationMs: Int!` and `lastChapterStartMs: Int`;
      - `accept()` uses a framerate tolerance of 0.0005 (1.001 rejected) and, after the offset
        check, rejects with `error.subtitleSearch.incomplete` when the staged file's last cue end,
        shifted by `offsetMs`, is at most 85 % of `lastChapterStartMs` (when it is non-null and
        above 80 % of the duration), or else at most 60 % of `mediaDurationMs`;
      - the last cue is read from the staged `.srt` by a pure parser (an unparseable file is
        rejected as `incomplete`, not accepted);
      - the new key in `error-keys.ts` and `messages.en.ts`.
      → T005
      *Done when:* `acceptance.spec.ts` asserts ratio 1.001 rejected; without chapters coverage
      0.48 and 0.60 rejected and 0.61 accepted; 0.85 of a qualifying last chapter rejected and 0.86
      accepted; a last chapter at 70 % of the duration ignored (scores above threshold); and the
      parser reads the last cue of a fixture. The `schema.gql` diff is exactly the two new
      arguments; tsc 0 errors, tests green.
- [x] **T031** `[web]` `error.subtitleSearch.incomplete` in `messages/en.json` and
      `messages/es.json` (`El subtítulo está incompleto (solo cubre parte de la película).`), shown
      by `SubtitleSearchStatus` like the other outcome keys.
      → T030
      *Done when:* both catalogs carry the key and `bin/comments web` passes.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T023 | docs | ~~Needed four real pairs.~~ Unblocked 2026-10-25: measured on six films (spec § Amendments 0.4.0). The thresholds stay `+Infinity` until T024 lands. | — |

---
title: Subtitle Translation and Adaptation — Tasks
last_updated: 2026-10-30
status: Draft
---

# TASKS: Subtitle Translation and Adaptation (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` | Which subagent owns the task. Exactly one per task: a task that needs two services is two tasks. |
| `[docs]` | Documentation, the contract doc, the constitution patch and the manual pass. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer. |

**Measuring.** If `bin/cli`/`bin/npm` find no container, run each *Done when* command through the
throwaway container (`measuring-without-dev-stack`): `docker run --rm --user 1000:1000 --network
perceptor_perceptor-net -v "$PWD/services/<svc>":/app -w /app -e HOME=/tmp
node:24.18.0-alpine sh -c '<command>'` (`api` also needs `-e NODE_OPTIONS=--experimental-vm-modules`
and `DATABASE_URL`). Report which form was used. Never `git stash`/`checkout`/`reset` in the shared
tree: other agents write there in parallel.

**Briefs.** Each agent reads `spec.md` (frozen contract), `plan.md` and its own `<svc>/plan.md`
first; the step numbers below point into that `<svc>/plan.md`.

## Tasks

### Group 1 — `api`: schema, contract and lifecycle

- [ ] **T001** `[api]` Schema, migration and keys (`api/plan.md` Step 1, Step 21's keys):
      `LlmProvider`, `LlmModel`, `SubtitleTranslation`, the three enums, `fileSubtitleSources Json?` on
      `Movie` and `Episode`, in migration `<ts>_add_llm_providers_and_subtitle_translation` (no data
      step); every `error.llm.*` and `error.subtitleTranslation.*` key of the spec in `error-keys.ts`
      and `messages.en.ts` (+ `messages.en.spec.ts`).
      *Done when:* `bin/cli api npx prisma migrate status` reports the migration applied, `git status
      services/api/prisma/` shows both `schema.prisma` and the new migration directory (Article III),
      and `bin/npm api test -- messages.en` passes.
- [ ] **T002** `[api]` Contract skeleton (`api/plan.md` Step 2): every entity, input, enum, query,
      mutation and field resolver of `spec.md` § GraphQL Contract Delta — including
      `MediaCapabilities.subtitleTranslationAvailable`, `subtitleTranslation(id)`,
      `Movie/Episode.latestSubtitleTranslation`, the service-only details/transitions and
      `libraryProbeCompleted`'s optional `subtitleSources` — wired with stub bodies, guards already in
      place (`AdminGuard` on admin ops, `@AllowService()` + service-principal check on worker ops).
      *Done when:* `bin/cli api npx --no tsc --noEmit` exits 0 and `git diff
      services/api/src/schema.gql` matches the spec delta type-for-type, field-for-field (recorded in the
      task report). → T001
- [ ] **T003** `[api] [P]` Provider clients (`api/plan.md` Steps 3–5): `src/clients/llm/` — `errors.ts`,
      `openai-protocol.ts`, `gemini-protocol.ts`, `ollama-protocol.ts`, `llm.client.ts`, recorded
      response fixtures and the four spec files listed in `api/plan.md` § Tests.
      *Done when:* `bin/npm api test -- clients/llm` passes, covering every REQ-9 cause per protocol,
      "length / `MAX_TOKENS` is `provider_refused`", "only retryable causes retry", and "a provider body
      containing the key never reaches the thrown message". → T001
- [ ] **T004** `[api] [P]` SRT and batch units (`api/plan.md` Step 10): `srt-cues.ts`, `batches.ts`,
      `prompts.ts` (placeholders, REQ-12), `constants.ts`, and `translateBatch(…)` built on `LlmClient`;
      `srt-cues.spec.ts`, `batches.spec.ts`.
      *Done when:* `bin/npm api test -- subtitle-translation/(srt-cues|batches)` passes, including
      fewer/extra/renumbered/reordered/merged cues → `invalid_response` after `BATCH_RETRIES`, empty
      text kept, and altered timings ignored (output timings equal the source's). → T003
- [ ] **T005** `[api] [P]` `108` edits (`api/plan.md` Steps 18–20): `libraryProbeCompleted` stores
      the translatable `subtitleSources` in the same guarded `updateMany`, leaves the column untouched
      when the argument is absent; `backfill` predicate becomes `fileSubtitleSources: null` +
      `POSSESSION_WHERE`; `syncMovie`/`syncShow` clear `fileSubtitleSources` on demotion.
      *Done when:* `bin/npm api test -- library-probe` passes with new cases for "absent argument
      leaves the column", "stale report writes nothing" and "forced/image tracks are not stored", and
      `bin/npm api test -- media-server-reconcile` passes. → T002
- [ ] **T006** `[api]` Administration (`api/plan.md` Steps 6, 8, 9): `src/llm/` —
      `provider-fields.ts`, `llm.service.ts`, resolver bodies for the admin CRUD and `translationModels`;
      `MediaCapabilitiesService.subtitleTranslationAvailable`; specs per `api/plan.md` § Tests.
      *Done when:* `bin/npm api test -- (llm|media-capabilities)` passes, including the REQ-1 matrix
      for all five kinds, "update without `apiKey` keeps it, `""` clears it", "no returned entity carries
      the key", and "a disabled provider's models are not in `translationModels`". → T002, T003
- [ ] **T007** `[api]` `testLlmModel` (`api/plan.md` Step 7): the fixed two-cue SRT through
      `translateBatch`, timed, storing nothing.
      *Done when:* a unit case with a stubbed `LlmClient` returns `{ ok: true, elapsedMs ≥ 0 }` on a
      valid answer, `{ ok: false, errorKey: 'error.subtitleTranslation.invalid_response' }` on a
      one-cue answer, and the provider key on a provider error; nothing is written to the database
      (asserted on the Prisma mock). → T004, T006
- [ ] **T008** `[api]` Request, staging and queues (`api/plan.md` Step 11, staging, both queue
      services): `subtitle-translation-request.service.ts`, `staging.ts`,
      `src/queue/subtitle-translation-queue.service.ts` (+ `SUBTITLE_TRANSLATION_*` in `queue/types.ts`),
      `subtitle-translation-run-queue.service.ts`; reuse of `assertManualSearchPreflight`,
      `LibraryLocationService` and `assertUsableMkv` (extract only if private, keeping their specs green).
      *Done when:* `bin/npm api test -- subtitle-translation-request` passes covering each thrown key of
      the spec table in the plan's validation order, `busy` under the guarded create, mode derivation
      (`en→es` translate, `es-ES→es-419` adapt), a null-language source refused, and
      `bin/npm api test -- subtitle-search-request` still passes unmodified. → T005, T006
- [ ] **T009** `[api]` Driver and transitions (`api/plan.md` Steps 12–17): `dispatchNext`, the three
      guarded worker transitions, the `translate` handler (progress, model-disabled abort), `details`,
      reads and ownership, media-server notification via the shared method (extracted from
      `SubtitleEmbedService.notifyMediaServer` if private), follow-up `LibraryProbeQueueService.request`,
      boot recovery and `reconcileOrphanedEncodes`' `EXTRACTING`/`WRITING` arm.
      *Done when:* `bin/npm api test -- subtitle-translation` passes, including "never two active rows",
      "request order", "transition from the wrong status returns false and changes nothing", "double
      delivery is safe", "`written` completes with `notify_failed` when the notification throws", "boot
      fails `TRANSLATING`, keeps `QUEUED`", "worker boot fails `EXTRACTING`/`WRITING`"; `bin/npm api test
      -- subtitle-embed process-jobs` still passes. → T007, T008
- [ ] **T010** `[api]` Close the slice (`api/plan.md` Steps 21–22).
      *Done when:* `bin/cli api npx --no tsc --noEmit`, `bin/npm api run test`, `bin/comments api` and
      `bin/audit api` all exit 0, and the `schema.gql` diff still matches the spec delta. → T009

### Group 2 — consumers: `worker` and `web`

The worker tasks consume the contract produced in Group 1; the web tasks can start against T002's
schema and only need T009 for a live check.

- [ ] **T011** `[docs]` Naming check against real media servers (`worker/plan.md` Step 1, a
      maintainer action): beside a test `.mkv`, `x.spa.srt`, `x.Latino.spa.srt`, `x.spa.2.srt`; record
      what Jellyfin and Plex list for each.
      *Done when:* this task carries the observed language/title for each file on each server. If either
      server does not read all three as Spanish, it moves to **Blocked** and REQ-13 is re-decided in
      `spec.md` before T015.
- [ ] **T012** `[worker] [P]` Sidecar name rule (`worker/plan.md` Step 2): `subtitles/sidecars.ts`
      widened, `sidecars.spec.ts` extended with every case in `worker/plan.md` § Tests.
      *Done when:* `bin/npm worker test -- sidecars` passes, and `bin/npm worker test --
      subtitle-probe` passes unmodified.
- [ ] **T013** `[worker] [P]` Per-track library read (`worker/plan.md` Step 3):
      `subtitles/subtitle-sources.ts` (+ spec), `library-probe.job.ts` sends `subtitleSources`,
      `api/library-probe-reports.ts` sends the optional argument.
      *Done when:* `bin/npm worker test -- (subtitle-sources|library-probe)` passes, with ordinals that
      count image and forced tracks and `und`/untagged → `null`. → T005
- [ ] **T014** `[worker] [P]` Move `assertWritable` to `subtitles/library-write.ts` and import it in
      `jobs/subtitle-embed.job.ts`.
      *Done when:* `bin/npm worker test -- subtitle-embed` passes with its spec file unmodified (`git diff
      --stat` of that spec is empty).
- [ ] **T015** `[worker]` Translation jobs (`worker/plan.md` Steps 4–7): queue types, `index.ts`
      registration, `api/subtitle-translation-reports.ts`, `jobs/subtitle-translation.job.ts`
      (`stage-source`, `write-output`), `subtitles/subtitle-sources.ts`'s `resolveTextSource`,
      `subtitles/translation-output.ts`, the four worker keys in `i18n/`, and both spec files against a
      real `mkdtemp`.
      *Done when:* `bin/npm worker test -- (subtitle-translation|translation-output)` passes, covering
      free name, `.2`/`.3` when taken, pre-existing file byte-identical, no `.part.srt` survives any
      outcome, `file_gone` writes nothing, `source_mismatch` extracts nothing, `false` from `api` is
      swallowed. → T009, T011, T013, T014
- [ ] **T016** `[worker]` Close the slice.
      *Done when:* `bin/cli worker npx --no tsc --noEmit`, `bin/npm worker run test`, `bin/comments
      worker` and `bin/audit worker` all exit 0. → T012, T015
- [ ] **T017** `[web] [P]` Types, queries and actions (`web/plan.md` Steps 1–2): `types/media.ts`,
      `types/translation.ts`, `actions/translation.ts`, `latestSubtitleTranslation` and
      `subtitleTranslationAvailable` added to the existing film / series / capabilities queries.
      *Done when:* `bin/cli web npx --no tsc --noEmit` exits 0 and `grep -rn "apiKey"
      services/web/src/actions/translation.ts` shows it only in input variables, never in a result
      type. → T002
- [ ] **T018** `[web]` Settings → Traducción (`web/plan.md` Step 3): `TranslationPanel`,
      `LlmProviderForm`, `LlmModelRow`, the new tab in `SettingsForm`, `getLlmProviders()` in the
      settings page.
      *Done when:* typecheck and `bin/npm web run lint` exit 0; with T010 deployed, an admin can create an
      `OLLAMA` provider (no key field), a `GEMINI` one (key field, then "key is set" after reload), add a
      model and see "Probar" return a result inline. → T017
- [ ] **T019** `[web]` Button, modal and poll (`web/plan.md` Steps 4–5): `TranslateSubtitlesButton`,
      `TranslateSubtitlesModal`, `hooks/useTranslationPoll.ts`, placed in `Movie.tsx` beside
      `SearchSubtitlesButton` and in `SeasonAccordion.tsx`'s "Pistas" cell.
      *Done when:* typecheck and lint exit 0; with T010 deployed, `/movies/<id>` of a `COMPLETED` film shows
      the button only while an enabled model exists, the modal lists sources / "not read yet" / greyed
      null-language tracks, shows "Traducir"/"Adaptar", and the browser network tab shows the poll
      starting on a non-terminal row and stopping on the terminal status and on navigation. → T017
- [ ] **T020** `[web]` Catalogs and close (`web/plan.md` Steps 6–7): every key in `messages/en.json`
      and `messages/es.json` (spec's Spanish text verbatim in `es`).
      *Done when:* both catalogs have identical key sets (a `jq` key diff prints nothing), every spec
      key exists under `errors.llm.*` / `errors.subtitleTranslation.*`, and `bin/cli web npx --no tsc
      --noEmit`, `bin/npm web run lint` and `bin/comments web` exit 0. → T018, T019

### Group 3 — verification and docs

- [ ] **T021** `[docs]` Constitution patch (NFR-1): Article XII's Check line names
      `services/worker/src/jobs/subtitle-translation.job.ts`'s `<final>.part.srt` scratch; bump to
      v1.6.1 (PATCH) with a Changelog row.
      *Done when:* `docs/constitution.md` frontmatter reads `1.6.1` and the Check line lists the new site. → T015
- [ ] **T022** `[docs]` `docs/spec/graphql-contract.md`: the 105 delta (types, queries, mutations,
      the worker queue and its payload, the `libraryProbeCompleted` change) and every new error key in
      the i18n vocabulary.
      *Done when:* every type and key in `spec.md` § GraphQL Contract Delta appears in the contract doc. → T010
- [ ] **T023** `[docs]` `CLAUDE.md` files: root pipeline table (Notify media server, Transcode,
      Browse library rows gain the `105` sentence and spec ref); `services/api/CLAUDE.md` (`clients/llm/`,
      `llm/`, `subtitle-translation/`, the `library-probe/` change); `services/worker/CLAUDE.md` (the
      `subtitle-translation` queue row, the sidecar rule); `services/web/CLAUDE.md` (Settings tab, button,
      the first poll in `web`).
      *Done when:* each of the four files mentions `105` where its module map or pipeline row changed. → T010, T016, T020
- [ ] **T024** `[docs]` Manual pass (`plan.md` § Verification items 1–5) covering AC-1 … AC-12 and
      AC-14, and the provisional constants: run one feature-length subtitle through at least two
      providers, record batch size, retry counts, timeout and observed durations in a new
      `docs/spec/history.md` entry for `105` (REQ-8/REQ-9).
      *Done when:* each AC has an observed result written in this task, and `history.md` has the `105`
      entry with the measured constants. → T010, T016, T020, T021
- [ ] **T025** `[docs]` Walk the acceptance criteria in `spec.md` (AC-13 is ticked from T010/T016's
      test runs), tick each verified box, leave unverified ones with their blocker, set
      `status: Implemented` on `spec.md`, `plan.md` and every `<svc>/plan.md`, and run `/pending-acs`.
      *Done when:* `bin/pending-acs --check` exits 0. → T022, T023, T024

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

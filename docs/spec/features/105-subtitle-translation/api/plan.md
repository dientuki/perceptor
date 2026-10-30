---
title: Subtitle Translation and Adaptation — api slice
service: api
last_updated: 2026-10-29
status: Approved
---

# PLAN: Subtitle Translation and Adaptation — `api` (`api/plan.md`)

Read first: `../spec.md` (frozen contract), `../plan.md`, `services/api/CLAUDE.md`,
`.claude/agents/api.md`.

## Scope

`api` owns everything that is not FFmpeg or a filesystem write into the library:

- the three provider wire protocols and REQ-9's error mapping (`clients/llm/`);
- provider/model administration and the "Probar" test (`llm/`);
- the translation request, its state machine, the batching/validation of the model's output, the
  staging directory and the media-server notification (`subtitle-translation/`);
- the Prisma migration and every GraphQL type, query and mutation in the delta;
- the two `108` edits: `libraryProbeCompleted.subtitleSources` and the widened backfill predicate.

It does **not** extract the track or write the sidecar (`worker`), render anything (`web`), or touch
the destinations root: `api` mounts it read-only and `services/api/src` has no removal under it
(Article XII Check).

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` + new migration `add_llm_providers_and_subtitle_translation` | Modified / New | `LlmProvider`, `LlmModel`, `SubtitleTranslation`, 3 enums, `fileSubtitleSources Json?` on `Movie` and `Episode` (spec § Data Model). |
| `src/clients/llm/types.ts` | New | `LlmProviderKind` re-export, `LlmCompleteRequest`, `LlmClient` port. |
| `src/clients/llm/errors.ts` | New | `LlmError` (carries one REQ-9 key + `retryable`, never a body). |
| `src/clients/llm/openai-protocol.ts` | New | `/chat/completions` for `OPENAI` / `OPENROUTER` / `OPENAI_COMPATIBLE`; status → key mapping; `finish_reason: length` → `provider_refused`. |
| `src/clients/llm/gemini-protocol.ts` | New | `generateContent`, key in `x-goog-api-key`; `finishReason` `MAX_TOKENS`/`SAFETY`/`RECITATION` and `promptFeedback.blockReason` → `provider_refused`. |
| `src/clients/llm/ollama-protocol.ts` | New | `/api/chat`, `stream: false`; `done_reason: length` → `provider_refused`; 404 → `model_not_found`. |
| `src/clients/llm/llm.client.ts` | New | `@Injectable` facade: picks the protocol by kind, applies the per-call timeout and REQ-9's retry/backoff (constants), exposes `complete()`. |
| `src/clients/llm/*.spec.ts`, `src/clients/llm/fixtures/` | New | See Tests. |
| `src/llm/llm.module.ts`, `llm.service.ts`, `llm.resolver.ts` | New | Admin CRUD + `llmProviders` + `testLlmModel` + `translationModels` (every user). |
| `src/llm/entities/*.ts`, `src/llm/dto/*.ts` | New | `LlmProvider`, `LlmModel`, `TranslationModel`, `LlmModelTestResult`, `LlmProviderInput`, `LlmModelInput`, `LlmProviderKind` enum (`registerEnumType`). |
| `src/llm/provider-fields.ts` | New | Pure REQ-1 matrix: which of `baseUrl`/`apiKey` each kind requires/forbids; http(s) URL check. |
| `src/subtitle-translation/subtitle-translation.module.ts` | New | Wires the service, driver, resolver, queue service, staging. |
| `src/subtitle-translation/subtitle-translation-request.service.ts` | New | REQ-6/7 validation, creates the row, calls `driver.dispatchNext()`. |
| `src/subtitle-translation/subtitle-translation.driver.ts` | New | State machine (below). `OnApplicationBootstrap` recovery. |
| `src/subtitle-translation/subtitle-translation.service.ts` | New | Reads (`latestForMovie/Episode`, `byId`), the worker-facing guarded transitions, `details()`, `sources()`. |
| `src/subtitle-translation/subtitle-translation.resolver.ts` | New | Queries, `requestSubtitleTranslation`, the three service-only mutations, `ResolveField`s on `Movie`/`Episode`. |
| `src/subtitle-translation/srt-cues.ts` | New | `parseSrt`, `serializeSrt`, `stripFences`. The `api` has no SRT parser besides `subtitle-search/last-cue.ts` (timing regex only); do not import from `worker`. Reuse `last-cue.ts`'s TIMING regex shape. |
| `src/subtitle-translation/batches.ts` | New | `splitBatches(cues, size)`, `validateBatchAnswer(sent, answeredText)` → merged cues using the **source** numbers and timings. |
| `src/subtitle-translation/prompts.ts` | New | `TRANSLATE_PROMPT`, `ADAPT_PROMPT` placeholders (REQ-12) + `buildPrompt(mode, sourceLanguage, targetTag)`. One constant each. |
| `src/subtitle-translation/constants.ts` | New | `BATCH_CUES`, `BATCH_RETRIES`, `PROVIDER_TIMEOUT_MS`, `PROVIDER_RETRIES`, `PROVIDER_BACKOFF_MS` — all provisional (REQ-8/9), each single-valued. |
| `src/subtitle-translation/staging.ts` | New | `.perceptor/subtitle-translation/<id>/{source,output}.srt` under the downloads root; `removeTranslation`, `sweep`. |
| `src/subtitle-translation/entities/*.ts` | New | `SubtitleTranslation`, `SubtitleTranslationSource`, `SubtitleTranslationDetails`, enums. |
| `src/queue/types.ts` | Modified | Add `SUBTITLE_TRANSLATION_QUEUE = 'subtitle-translation'` (worker-consumed) with jobs `stage-source` / `write-output`, payload `{ subtitleTranslationId }`. |
| `src/queue/subtitle-translation-queue.service.ts` | New | Producer to the worker queue (`attempts: 1`, `removeOnComplete/Fail`). |
| `src/subtitle-translation/subtitle-translation-run-queue.service.ts` | New | `api`-internal queue `subtitle-translation-run`, concurrency 1, job `translate` (103's `SubtitleSearchQueueService` is the template; neither produced nor consumed by the worker). |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` (+ `messages.en.spec.ts`) | Modified | Every `error.llm.*` and `error.subtitleTranslation.*` key of the spec, with params if any. |
| `src/media/media-capabilities.service.ts` (+ entity + spec) | Modified | `subtitleTranslationAvailable` (REQ-6): any enabled model under an enabled provider. |
| `src/library-probe/library-probe.service.ts` (+ DTO/resolver + spec) | Modified | `subtitleSources` optional arg; store translatable ones; clear with the language lists; backfill predicate widened (below). |
| `src/media-server/media-server-reconcile.service.ts` | Modified | `syncMovie`/`syncShow` demotion also clears `fileSubtitleSources`. |
| `src/process-jobs/process-jobs.service.ts` | Modified | `reconcileOrphanedEncodes` also fails `EXTRACTING` and `WRITING` translations (`interrupted`) and deletes their staging. |
| `src/app.module.ts` | Modified | Import the two new modules. |
| `src/schema.gql` | Regenerated | Never hand-edited (Article IV). |

## Existing code to reuse

- `src/subtitle-search/subtitle-search.driver.ts`, `-queue.service.ts`, `-request.service.ts`,
  `staging.ts` — the exact shape (bootstrap recovery, wake, guarded transitions, staging sweep). Copy
  the **shape**, not the states; `SubtitleSearchStaging` is not parameterised by directory and its
  sweep is 15 lines, so this slice gets a small sibling class rather than editing `103`'s (decision, see plan notes).
- `SubtitleEmbedService.assertManualSearchPreflight` and `assertUsableMkv`, and
  `SubtitleSearchRequestService.resolveLibraryPath` (→ `LibraryLocationService.locate`) — ownership,
  "holds a file", `.mkv` inside the library, path from the media server when `filePath` is null
  (`107` REQ-4). If the path resolution is private to `SubtitleSearchRequestService`, extract it to
  `LibraryLocationService` (in-service, Article X) instead of copying it, and keep that service's tests green.
- `SubtitleEmbedService.notifyMediaServer` — same call sequence (`createClient` → `modifiedMedia(
  containerToHostPath('library', path))`, a failed or impossible notification returns `false`). Extract
  to a shared method if it is private; do not write a second copy.
- `MediaCapabilitiesService.read()` — add the field there; `web` reads one capabilities object.
- `LibraryProbeQueueService.request({ movieId | episodeId })` — the follow-up read.
- `resolveSidecarLanguages` / `LanguageRow` (`subtitle-search/sidecar-languages.ts`) — tag → language rows
  for `Language.tag`/`iso3` lookups; the `Language` table is the one place ISO codes are mapped.
- `AdminGuard` (`@UseGuards(AdminGuard)` per method, as `environment.resolver.ts`), `@AllowService()` +
  `principal.type !== 'service'` check, `@CurrentUser()` (as `subtitle-search.resolver.ts`).
- `i18nError.badRequest/notFound/conflict/serviceUnavailable` + `ERROR_KEYS`.
- `POSSESSION_WHERE` (`pipeline-status/pipeline-status`) in `LibraryProbeService.backfill`.
- `MediaRootsService.resolveFromRoot`, `isInsideRoot('downloads', …)`, `containerToHostPath`.

## Steps

### A. Schema and contract skeleton
1. `schema.prisma`: models/enums/columns per spec § Data Model. `SubtitleTranslation` stores
   `libraryPath` (container path), `sourceOrdinal`, `sourceLanguageIso3`, `sourceTitle`, `targetTag`,
   `modelId` (SetNull), `modelDisplayName`, `mode`, `status`, `cuesDone`, `cuesTotal`, `errorKey`,
   `warningKey`, `outputFileName`, `requestedById`, timestamps. Index `(status, createdAt)`.
   Run `bin/npm api run prisma:migrate` → `add_llm_providers_and_subtitle_translation`.
2. Entities/DTOs/enums and empty resolver skeletons so `schema.gql` regenerates and matches the
   delta **exactly** (Article VIII check). Diff the generated SDL against the spec before going on.

### B. Provider clients (`clients/llm/`)
3. `errors.ts` + one protocol file per wire protocol; each exports a pure
   `mapFailure(status, bodyJson)` → `LlmError` using only status codes and provider enum fields
   (never copies body text into the message — the key-leak risk). `LlmClient.complete` applies the
   timeout (`AbortSignal.timeout`) and the retry/backoff for `provider_rate_limited` and
   `provider_unavailable` only; `unauthorized`, `model_not_found`, `provider_refused` never retry.
4. Base URL handling: `OPENAI`/`OPENROUTER`/`GEMINI` use the fixed constants; `OPENAI_COMPATIBLE` and
   `OLLAMA` use the stored URL **as typed** (trailing slash trimmed). The admin types `…/v1` for an
   OpenAI-compatible server; `/chat/completions` is appended. `OLLAMA` appends `/api/chat`.
5. Headers: OpenAI-compatible `Authorization: Bearer` only when a key exists; OpenRouter adds the
   attribution headers it documents; Gemini `x-goog-api-key`; Ollama none.

### C. Administration (`llm/`)
6. `provider-fields.ts` + `llm.service.ts`: create/update/delete provider and model; the REQ-1
   matrix → `error.llm.invalid_provider_fields`, URL → `invalid_base_url`, unique name →
   `provider_name_taken`, unique (provider, model) → `model_taken`, empty → `model_empty`, unknown id
   → `provider_not_found`/`model_not_found`. Update with `apiKey` **undefined** keeps the stored key;
   `""` clears it (REQ-5). `hasApiKey` is computed, the column is never selected into an entity.
7. `testLlmModel`: build the fixed two-cue English SRT, run it through the **same**
   `translateBatch` function the driver uses (prompt, call, parse, validation), time it, return
   `{ ok, elapsedMs, errorKey }`. Writes nothing. Bounded by the per-call timeout, no retry loop
   beyond REQ-9's.
8. `translationModels`: enabled models under enabled providers, `displayName = label ?? model`.
9. `MediaCapabilitiesService`: `subtitleTranslationAvailable` = count of such models > 0.

### D. Translation lifecycle (`subtitle-translation/`)
10. `srt-cues.ts`, `batches.ts`, `prompts.ts`, `constants.ts` (pure, tested).
    `translateBatch(llmClient, provider, model, mode, sourceLanguage, targetTag, cues)`:
    send the batch **as SRT** (numbers + timings + text) so the model keeps context; strip
    code fences / one leading and trailing prose line; parse; require the **same count and the same
    numbers in order**; return the model's text paired with the **source's** numbers and timings
    (a model that altered a timing changes nothing). On mismatch retry up to `BATCH_RETRIES`, then
    `invalid_response`.
11. `request` (`requestSubtitleTranslation`): `assertUsable` flow in this order, each with its
    spec'd key — capability (`unavailable`) → ownership + file (`assertManualSearchPreflight`,
    existing not-found keys) → path (`libraryPath`: `filePath` else `locate`, with `no_library_path` /
    `media_server_unavailable`) → `assertUsableMkv` → source found among `fileSubtitleSources`
    (`source_not_found`; null language → `source_language_unknown`) → target exists in `Language`
    (`target_not_found`) → model enabled with enabled provider (`model_unavailable`) → mode =
    ISO 639-2 compare of the source and `Language.iso3` of the target → create the row **inside a
    transaction that refuses when one is non-terminal for the same film/episode** (`busy`, using the
    same guarded-create idiom as `createGuarded` in `103`'s request service) → `driver.dispatchNext()`.
    `sourceId` format is private to `api` (e.g. `track:<ordinal>`); re-resolve it against the
    stored sources, never trust its parts.
12. `driver.dispatchNext()` (the "one at a time installation-wide" invariant, REQ-10): in one
    transaction, if any row is `EXTRACTING`/`TRANSLATING`/`WRITING` do nothing; otherwise move the
    oldest `QUEUED` row to `EXTRACTING` and produce the worker `stage-source` job. Called after a
    request, after every terminal transition, and at boot.
13. Worker-facing transitions in `SubtitleTranslationService`, each a guarded `updateMany` on the
    expected status returning `boolean` (false → the worker abandons):
    - `sourceStaged(id)`: `EXTRACTING → TRANSLATING`; reads the staged file, `parseSrt`, stores
      `cuesTotal`; a staged file with zero cues → `FAILED source_unreadable`; produces the
      `translate` job on the internal queue.
    - `written(id, outputFileName)`: `WRITING → COMPLETED` with `outputFileName` and `finishedAt`,
      then notify (REQ-14, non-fatal → `warningKey = notify_failed`), `LibraryProbeQueueService.request`
      (non-fatal), delete staging, `dispatchNext()`.
    - `workerFailed(id, key)`: any non-terminal → `FAILED` with the worker's key (accept only keys
      from the worker set; anything else → `write_failed`), delete staging, `dispatchNext()`.
    All three safe to receive twice (038's posture): the second finds the status already moved and returns `true` without effect only for the exact terminal it caused, `false` otherwise.
14. `translate` handler (internal queue, concurrency 1): status must still be `TRANSLATING` (else
    return); read the staged source, run batches sequentially, after each batch `UPDATE cuesDone`
    (guarded on `TRANSLATING`); on a model error → `FAILED` with its key; between batches re-check
    that the row is still `TRANSLATING` and that its model/provider is still enabled
    (`model_unavailable`, REQ-3). On success serialize the merged cues, write `output.srt` to the
    staging directory, `TRANSLATING → WRITING`, produce the worker `write-output` job.
15. `details(id)` (worker-facing): container `filePath` = stored `libraryPath`-or-`filePath`,
    `sourceOrdinal`, `sourceLanguageIso3`, `stagedSourcePath`, `stagedOutputPath` (only for
    `WRITING`), `targetTag`, `targetIso3` (from `Language`); unknown id → `error.subtitleTranslation.not_found`.
16. Reads: `latestForMovie/Episode` (`createdAt desc`), `byId` with the ownership check
    (null for a title the caller does not own), `Movie.latestSubtitleTranslation` /
    `Episode.latestSubtitleTranslation` resolve for any owner of the title (the series for an
    episode); `movieTranslationSources`/`episodeTranslationSources` return `null` for
    `fileSubtitleSources` null.
17. Recovery (NFR-2): `onApplicationBootstrap` — rows `TRANSLATING` → `FAILED interrupted` + staging
    deleted (the api-side step died with the process); `QUEUED` stay; `EXTRACTING`/`WRITING` are left
    to the worker's boot signal. Then `staging.sweep(keep)` (anything not belonging to a non-terminal
    row), then `dispatchNext()`. `ProcessJobsService.reconcileOrphanedEncodes` fails
    `EXTRACTING`/`WRITING` rows (`interrupted`), deletes their staging and calls `dispatchNext()` (the
    driver is imported lazily if a cycle appears; do not move `reconcile` into the new module).

### E. `108` edits
18. `libraryProbeCompleted`: new optional `subtitleSources: [LibrarySubtitleSourceInput!]` (DTO +
    resolver). When present: keep text codecs `subrip`/`srt`/`ass`/`ssa`/`webvtt`/`mov_text`, drop
    `forced`, store `{ ordinal, codec, languageIso3, title }[]` (`[]` when none) in the same guarded
    `updateMany` as the language lists (a stale report writes nothing). When absent: do not touch the
    column. A track whose `languageIso3` is null is stored (so REQ-7 can list it as unpickable).
19. `LibraryProbeService.backfill`: predicate `fileSubtitleSources: null, ...POSSESSION_WHERE`
    (was `tracksReadAt: null, …`). `MediaServerReconcileService.syncMovie/syncShow`: clear
    `fileSubtitleSources` where they clear the language lists.
20. Update `library-probe.service.spec.ts` for the three behaviours above.

### F. Wiring and checks
21. `messages.en.ts` + its spec; `app.module.ts`; regenerate `schema.gql`; diff against the spec delta.
22. `bin/comments api`, typecheck, tests, `bin/audit api` (no new dependency expected — NFR-4).

## Contract obligations

Exactly `../spec.md` § GraphQL Contract Delta, including: admin-only on `llmProviders` and every
`Llm*` mutation; every-user `translationModels`; owner-only `*TranslationSources`,
`requestSubtitleTranslation`, `Movie/Episode.latestSubtitleTranslation` and `subtitleTranslation(id)`
(null for a title the caller does not own); `@AllowService()` + `principal.type === 'service'` for
`subtitleTranslationDetails`, `subtitleTranslationSourceStaged`, `subtitleTranslationWritten`,
`subtitleTranslationWorkerFailed` and the changed `libraryProbeCompleted`. Thrown keys are exactly
the spec table's; outcome keys are only ever **stored** (`errorKey`/`warningKey`), never thrown.
The key is never in an output type, a log line or a stored/thrown message.

## Tests

Article IX applies where a bug is silent. Each file opens with the header paragraph naming the failure.

- `clients/llm/openai-protocol.spec.ts`, `gemini-protocol.spec.ts`, `ollama-protocol.spec.ts` (with
  recorded response fixtures) — a wrong status→key mapping turns a bad key into "unavailable" and a
  retry storm, or a truncated answer into a "success". One case per cause in REQ-9 per protocol,
  plus "length/MAX_TOKENS is `provider_refused`, not a short success".
- `clients/llm/llm.client.spec.ts` — only the retryable causes retry; the retry budget is bounded; a
  provider error body containing the API key text never reaches the thrown key/message.
- `llm/provider-fields.spec.ts` — REQ-1 matrix for all five kinds (required/forbidden/optional).
- `llm/llm.service.spec.ts` — an update without `apiKey` keeps it, `""` clears it, and no entity
  returned carries it; `translationModels` excludes disabled models and models of disabled providers.
- `subtitle-translation/srt-cues.spec.ts` — BOM, CRLF, multi-line cues, blank-line edge cases,
  fenced/prose-wrapped answers, round trip.
- `subtitle-translation/batches.spec.ts` — the core silent-failure suite: fewer cues, extra cues,
  renumbered, reordered, merged pairs, empty answered text kept as an empty cue, altered timings
  ignored (output carries the source timings), retry then `invalid_response`.
- `subtitle-translation/subtitle-translation.service.spec.ts` — every worker transition returns
  `false` from the wrong status and never moves a terminal row; double delivery is safe; `written`
  completes even when the notification and the probe request throw (warning set, no failure).
- `subtitle-translation/subtitle-translation.driver.spec.ts` — `dispatchNext` never starts a second
  row while one is active; order is request order; `translate` aborts when the model is disabled
  mid-run; boot recovery fails `TRANSLATING` and keeps `QUEUED`; the staging sweep keeps only live rows.
- `subtitle-translation/subtitle-translation-request.service.spec.ts` — the validation order and each
  key; `busy` when one is in flight and the guarded create does not race; mode derivation (`en→es`
  translate, `es-ES→es-419` adapt, same tag → adapt); a source with null language is refused.
- `library-probe/library-probe.service.spec.ts` (extend) — the three `108` behaviours of step 18/19,
  including "absent argument leaves the column alone" and "stale report writes nothing".
- `media/media-capabilities.service.spec.ts` (extend) — the new boolean.
- `i18n/messages.en.spec.ts` — every new key has a message.

Not owed: the entities/DTOs, the thin resolvers' pass-through bodies, the queue producer services
(no logic), `prompts.ts` (a constant; its text is explicitly out of scope).

## Done when

```bash
bin/npm api run prisma:migrate
bin/cli api npx --no tsc --noEmit
bin/npm api run test
bin/comments api
bin/audit api
```

`tsc` and the test suite pass, `bin/comments api` and `bin/audit api` exit 0, and `git diff
services/api/src/schema.gql` matches `../spec.md` § GraphQL Contract Delta type-for-type.

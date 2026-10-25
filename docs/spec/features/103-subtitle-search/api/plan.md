---
title: Subtitle Search — api slice
service: api
last_updated: 2026-10-25
status: Approved
---

# PLAN: Subtitle Search — `api` (`api/plan.md`)

## Scope

`api` owns:

- the three flags and their mutations;
- `MediaCapabilities.subtitleSearchAvailable`;
- the `SubtitleSearch`/`SubtitleSearchAttempt` models and migration;
- the request hook on delivery;
- the driver that advances every search;
- the Jellyfin remote search and fetch;
- the candidate filter and ranking;
- staging and cleaning up candidates in the downloads root;
- the acceptance rule and its two provisional thresholds;
- the `subtitle-sync` producer and the worker-facing reports and details;
- the `101` delta (`embedStaged`, `stagedPath`, `isSidecar`);
- `latestSubtitleSearch` on `Movie`/`Episode`.

It does **not** run `ffsubsync`, touch the library file, or write anything under the destinations
root, which stays mounted read-only. It never asks Jellyfin to save a subtitle beside the media.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` + `prisma/migrations/<ts>_add_subtitle_search/` | Modified / New | Per `../plan.md` § Migrations |
| `src/clients/media-server/types.ts` | Modified | `ItemSubtitles.presentLanguagesIso3: string[]`; type `RemoteSubtitleCandidate` (`id`, `languageIso3`, `name`, `format`, `isForced`, `isHearingImpaired`, `isMachineTranslated`, `isAiTranslated`, `isHashMatch`, `downloadCount`); optional members `searchRemoteSubtitles(itemId, iso3)` and `fetchRemoteSubtitle(subtitleId): Promise<Buffer>` |
| `src/clients/media-server/jellyfin.ts` (+ spec) | Modified | `toItemSubtitles` also fills `presentLanguagesIso3`; `GET Items/{id}/RemoteSearch/Subtitles/{lang}` and `GET Providers/Subtitles/Subtitles/{id}`, each with a 30 s timeout, since the plugin calls OpenSubtitles synchronously |
| `src/subtitle-embed/subtitle-embed.service.ts` (+ spec) | Modified | Public `embedStaged(ref, tracks)` sharing `embed()`'s tail; `StoredTrack.stagedPath?`; `details()` sets `sourcePath`/`isSidecar` |
| `src/subtitle-embed/entities/subtitle-embed-details.entity.ts` | Modified | `isSidecar: Boolean!` on `SubtitleEmbedTrack` |
| `src/subtitle-embed/subtitle-embed.module.ts` | Modified | Export `SubtitleEmbedService` |
| `src/subtitle-search/subtitle-search-request.module.ts`, `subtitle-search-request.service.ts` | New | Leaf: `requestFor(target)` (effective flag, supersede, insert) |
| `src/subtitle-search/subtitle-search.module.ts`, `subtitle-search.driver.ts`, `subtitle-search-queue.service.ts`, `subtitle-search.service.ts`, `subtitle-search.resolver.ts`, `entities/`, `candidates.ts`, `acceptance.ts`, `staging.ts` (+ specs) | New | The driver, its `api`-internal BullMQ queue and consumer, the reads, the reports, the pure rules |
| `src/queue/types.ts`, `src/queue/subtitle-sync-queue.service.ts`, `src/queue/queue.module.ts` | Modified / New | `SUBTITLE_SYNC_QUEUE = 'subtitle-sync'`, `SUBTITLE_SYNC_JOB = 'subtitle-sync'`, `SubtitleSyncJob = { subtitleSyncId: number }`, producer |
| `src/process-jobs/process-jobs.service.ts`, `process-jobs.module.ts` (+ spec) | Modified | Call `requestFor` after `notifyCreated`; `reconcileOrphanedEncodes` also fails `RUNNING` attempts (`interrupted`) |
| `src/media/media-capabilities.service.ts`, `entities/media-capabilities.entity.ts` | Modified | `subtitleSearchAvailable` |
| `src/preferences/` (service, entity, resolver) | Modified | `subtitleSearch` field, `setSubtitleSearch` |
| `src/movies/` and `src/shows/` (service, resolver, entity) | Modified | `subtitleSearch` field and setter; `latestSubtitleSearch` resolve fields on `Movie`/`Episode` |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | Every `error.subtitleSearch.*` key in the spec |

## Existing code to reuse

- **`audioMandatory`, the closest twin**: `UserMovie.audioMandatory`/`UserShow.audioMandatory`,
  `MoviesService` around `setMovieAudioMandatory` (`movies.service.ts:220-240`), `ShowsService`'s
  twin, the `audioMandatory` `@ResolveField`s in `movies.resolver.ts`/`shows.resolver.ts`, and
  `PreferencesService.findForUser` plus `setAudioMandatory`. Copy the shape for `subtitleSearch`.
  Do not invent a different one.
- **`src/media/media-capabilities.service.ts` `read()`**: add the boolean from the same settings
  map (`media_server_client === 'jellyfin'`). Export a small `isSubtitleSearchAvailable()` for the
  setters, the request service and the driver, so the check exists once.
- **`src/indexer/ranking-context.service.ts`**: the per-owner loop over `userMovie`/`userShow` rows
  with `preferencesService.findForUser` and `languagesService.find*PreferredTrackLanguagesFor`. REQ-5
  is the same loop with `LanguageTrackKind.SUBTITLE` and the same fallback rule as `effectiveAudio`
  (a title list if non-empty, else the user's list). Write a `effectiveSubtitles` alongside it, or
  extract the fallback; do not write a third variant of the rule.
- **`src/media-server/media-server.service.ts` `createClient()`**: the one way to get a client from
  Settings (extracted by `101`).
- **`src/media-server-index/media-server-index.service.ts` `refreshAndWait`**: the `069` "rebuild,
  then look up" path, for a lookup miss (REQ-6).
- **`src/clients/media-server/jellyfin.ts`**: `authHeader`, the `!response.ok` throw shape, and
  `toEpisodeSubtitleMap`'s `S:E` key for finding an episode's item id. `listItemSubtitles` /
  `listSeriesEpisodeSubtitles` give the item path and the streams in one call.
- **`src/media-roots/media-roots.service.ts`**: `resolveFromRoot('downloads', …)` for the staging
  directory (the guard doc comment applies), `isInsideRoot('downloads', …)` before every `rm`
  (the `encodeJobDiscard` pattern in `downloads.service.ts`), and `containerToHostPath('library', …)`
  for REQ-6's path match.
- **`src/subtitle-embed/subtitle-embed.service.ts`**: `embed()`'s tail (mkv resolution,
  `assertUsableMkv`, `assertNotBusy`, `createGuarded`, enqueue) and `validateSelection`'s base-row
  `trackTitle` lookup. Extract them into private helpers both entry points call. Do not duplicate
  them.
- **`src/queue/connection.ts`** and **`src/queue/subtitle-embed-queue.service.ts`**: the Redis
  connection and the producer shape, for both the `subtitle-sync` producer and the `subtitle-search`
  queue. The `subtitle-search` `Worker` is the first BullMQ consumer in `api`. Build it on the same
  connection options, with no second Redis client configuration.
- **`src/scheduler/scheduler.service.ts`**: how `api` reconciles leftover state at boot (its
  `interrupted` sweep of runs). The driver's boot re-wake follows the same posture.
- **`src/queue/subtitle-embed-queue.service.ts`**: the producer shape. Use `jobId: subtitle-sync-<id>`
  and `attempts: 1`.
- **`src/process-jobs/process-jobs.resolver.ts`**: `@AllowService()` plus the explicit
  `principal.type !== 'service'` rejection, for the three reports and the details query.
- **`src/subtitle-embed/active-embed-guard.module.ts`**: the leaf-module precedent that lets
  `ProcessJobsModule` import the request service without a cycle.

## Steps

1. **Migration.** Per `../plan.md`. Run `bin/npm api run prisma:migrate` and confirm both files
   appear in `git status services/api/prisma/` (Article III).

2. **Flags.**
   - `subtitleSearch` on `UserPreferences`, `Movie` and `Show`, following `audioMandatory` exactly.
   - `setSubtitleSearch`, `setMovieSubtitleSearch` and `setShowSubtitleSearch` refuse with
     `unsupported_media_server` when `isSubtitleSearchAvailable()` is false.
   - The two title setters keep the existing ownership not-found keys.
   - `MediaCapabilities.subtitleSearchAvailable`.

3. **Jellyfin client.**
   - `presentLanguagesIso3` in `toItemSubtitles`: every `Type === 'Subtitle'` stream with
     `IsForced !== true` and a `Language`, lowercased and deduplicated, embedded and external alike.
   - `searchRemoteSubtitles` maps `RemoteSubtitleInfo` (`Id`, `ThreeLetterISOLanguageName`, `Name`,
     `Format`, `Forced`, `HearingImpaired`, `MachineTranslated`, `AiTranslated`, `IsHashMatch`,
     `DownloadCount`), treating absent booleans as `false`. Do not pass `isPerfectMatch`.
   - `fetchRemoteSubtitle` returns the body as a `Buffer`; `101`'s worker handles the charset.

4. **Pure rules** (`candidates.ts`, `acceptance.ts`).
   - `filterAndRank(candidates, releaseName)` implements REQ-8: keep `format` `srt` (case-
     insensitive), not forced, not machine-translated or AI-translated. Sort by hash match, then
     release similarity, then not hearing-impaired, then download count, and return the first 3.
   - Release similarity is the Jaccard index of the lowercase alphanumeric token sets of the two
     names, with `releaseName` taken as the basename of the delivering `MediaSource.downloadPath`
     (the value the worker's `buildSourceTag` starts from).
   - `accept({ offsetMs, framerateRatio, reference, score })` returns `null` or a reason key, in
     this order:
     1. `framerate_mismatch` when `|ratio - 1| > 0.001`;
     2. `offset_too_large` when `|offsetMs| > 600000`;
     3. `low_score` when `score` is below `SUBTITLE_REFERENCE_MIN_SCORE` /
        `AUDIO_REFERENCE_MIN_SCORE`.

     Both thresholds start as `Number.POSITIVE_INFINITY` (reject everything) until the measurement
     task sets them, and each carries a `// Spec 103, REQ-10` locator.

5. **Request** (`SubtitleSearchRequestService.requestFor({ kind, id })`).
   1. Return if not available.
   2. Collect the owners whose preference and per-title flag are both on: the film's `UserMovie`
      rows, or for an episode its series' `UserShow` rows. Return if there are none (AC-8: no row).
   3. Compute the wanted languages (REQ-5, base ISO 639-2, deduplicated).
   4. In one transaction:
      - set every non-terminal search of the target to `FAILED`/`superseded` with `finishedAt`;
      - insert `WAITING` with `wantedLanguages` and `checkCount 0`.

      After the commit, `wake(searchId, 5 min)`. A failed `wake` is logged; the boot re-wake recovers it.
   5. Wrap everything in `try`/`catch` and log. `ProcessJobsService.encodeCompleted` calls it inside
      the existing `if (!alreadyDeliveredSame)` branch, right after `notifyCreated`, and only when
      `!sourceDemoted`.

6. **Driver** (`SubtitleSearchDriver` plus `SubtitleSearchQueueService`). The queue service owns a
   BullMQ `Queue` and `Worker` on `SUBTITLE_SEARCH_QUEUE = 'subtitle-search'`, job `advance`,
   payload `{ searchId }`, `concurrency: 1`, over the existing `queue/connection.ts`. Every add uses
   `attempts: 1`, `removeOnComplete: true` and `removeOnFail: true`. It exposes
   `wake(searchId, delayMs = 0)`, and closes its `Worker` in `onModuleDestroy`. The `Worker`'s
   handler is `driver.advance(searchId)`, which:
   - re-reads the search;
   - if the row is missing, deletes `<staging>/<searchId>` and returns;
   - if it is terminal, returns;
   - otherwise runs **one** step for its status.

   An exception inside a step is caught, logged, and fails that search with the step's key (or
   `media_server_unavailable` for a client throw). It never escapes to BullMQ. Each state change is
   a conditional `updateMany` on the state it leaves, so a duplicate wake-up that slips through
   writes nothing. A step that changed the state ends with `wake(searchId)`, so the next step runs
   right away.

   - **WAITING.**
     1. If no longer available (the media server changed under the search), fail with
        `media_server_unavailable`.
     2. Resolve the item: `findByTmdbId` (on a miss, `refreshAndWait` once, then look up again);
        for an episode, the series' map entry `S:E`.
     3. Require `mediaHostPath === containerToHostPath('library', target.filePath)`.
     4. If any of this is not satisfied, increment `checkCount` and `wake` after the next delay of
        10, 20, 40 or 45 minutes. After the fifth miss, fail with `item_not_found`.
     5. If it is satisfied, store `itemId` and `presentLanguages`, and move to `SEARCHING`.

   - **SEARCHING.** Take the first wanted language that is missing (not in `presentLanguages`) and
     has no attempts yet.
     1. Call `searchRemoteSubtitles` and `filterAndRank`.
     2. With zero candidates, the language is `NOT_FOUND` (derived) and the step moves to the next
        language.
     3. Otherwise, insert attempt rows for the up to 3 candidates (`QUEUED`, `rank` 1..3, no
        `stagedPath`) and process the first one:
        - `fetchRemoteSubtitle`;
        - write the bytes to the staging path;
        - set `stagedPath`;
        - enqueue `subtitle-sync`;
        - `wake` after 6 h as the backstop;
        - move to `VALIDATING`.

        A fetch failure marks that attempt `FAILED`/`fetch_failed` and tries the next rank in the
        same step.
     4. When no missing language has work left, move to `EMBEDDING`, or to `COMPLETED` if no
        attempt is `ACCEPTED`.

   - **VALIDATING.** Find the language's attempt that has a `stagedPath` and is not finished.
     - If the worker has not reported yet and the attempt is younger than 6 h, return: the report's
       wake-up or the backstop comes back. At 6 h or later, fail the attempt with `sync_failed`.
     - If the worker reported (attempt status `ACCEPTED`/`REJECTED`/`FAILED`), delete that
       candidate's staged file if it is not `ACCEPTED`, then:
       - if accepted, mark the remaining ranks of that language `REJECTED` with no reason (never
         fetched) and go back to `SEARCHING`;
       - otherwise, fetch and enqueue the next rank (as in SEARCHING);
       - if no ranks are left, go back to `SEARCHING`.

   - **EMBEDDING.**
     - If no embed has started yet, call `subtitleEmbed.embedStaged(ref, tracks)` with one track per
       `ACCEPTED` attempt:
       - `languageIso3`;
       - `stagedPath`;
       - `offsetMs`;
       - `isDefault: false`, `isForced: false`.

       On success, store `subtitleEmbedId` and `wake` after 2 min. Any `101` refusal, `busy`
       included, fails the search with that key (REQ-12).
     - Once `subtitleEmbedId` is set, read the embed. When it is `COMPLETED`, the search is
       `COMPLETED`; when it is `FAILED`, the search is `FAILED` with the embed's `errorKey`.
       Otherwise, `wake` after 2 min.

   Every terminal transition deletes `<staging>/<searchId>` (guarded by `isInsideRoot('downloads')`)
   and sets `finishedAt`.

   **Boot** (`onApplicationBootstrap` of the driver's module):
   - `wake` every non-terminal search with no delay;
   - sweep `.perceptor/subtitle-search/`, removing directories whose search is terminal or missing.

7. **`101` delta.**
   - Split `embed()`'s tail into a private `queueEmbed(ref, target, mkvPath, tracks)`.
   - `embedStaged(ref, tracks)` loads the target without a user, requires possession, resolves the
     `.mkv` exactly like `embed()` (REQ-13), and calls `queueEmbed`.
   - Each stored track carries `stagedPath` and `fileName: basename(stagedPath)`.
   - `details()`: `sourcePath = track.stagedPath ?? join(dir, track.fileName)` and
     `isSidecar = track.stagedPath == null`.
   - `embedStaged` must refuse a `stagedPath` that is not `isInsideRoot('downloads')`.

8. **Worker-facing surface.**
   - `subtitleSyncDetails(id)`: the attempt's `stagedPath` and its target's `filePath`. It answers
     for any status. An unknown id is `sync_not_found`.
   - `subtitleSyncStarted`: guarded `updateMany` `QUEUED → RUNNING`.
   - `subtitleSyncCompleted(id, …)`: guarded `RUNNING → ACCEPTED|REJECTED` (from `accept(...)`,
     storing the measurements and `reasonKey`). A repeat answers `true` and writes nothing.
   - `subtitleSyncFailed(id, key)`: `QUEUED|RUNNING → FAILED`. An unknown key is stored as
     `sync_failed`.
   - None of the three advances the search: `subtitleSyncCompleted` and `subtitleSyncFailed`
     only add `wake(searchId)` after a write that changed the row, and the driver does the rest.

9. **Crash.** In `reconcileOrphanedEncodes`, also `updateMany` every `RUNNING` attempt to
   `FAILED`/`interrupted` with `finishedAt`. The returned count stays the encode count.

10. **Reads.**
    - `latestSubtitleSearch` on `Movie` (owner-visible, like the film) and on `Episode`.
    - `languages` is derived per wanted language:
      - in `presentLanguages`: `ALREADY_PRESENT`;
      - an `ACCEPTED` attempt and the search `COMPLETED`: `EMBEDDED`;
      - an `ACCEPTED` attempt and the search `FAILED`: `FAILED`, with the search's key;
      - no attempts and the search past `SEARCHING` for that language: `NOT_FOUND`;
      - every attempt `REJECTED`, or a mix of `REJECTED` and `FAILED`: `REJECTED`, with the first
        rank's `reasonKey`;
      - every attempt `FAILED`: `FAILED`;
      - otherwise: `PENDING`.

## Contract obligations

Expose exactly `../spec.md` § GraphQL Contract Delta (v0.3.0), plus `SubtitleEmbedTrack.isSidecar`.
Every key in both of the spec's tables exists in `error-keys.ts` and `messages.en.ts`. `queue/types.ts`
is the source of truth that the worker copies by hand. `Movie.subtitleSearch`/`Show.subtitleSearch` are
the caller's own row, and `false` when the caller has none.

## Tests

Owed under Article IX (each verified to fail when its rule is removed):

- `src/clients/media-server/jellyfin.spec.ts`:
  - `presentLanguagesIso3` excludes forced streams and includes embedded and external ones;
  - the remote-search mapping treats absent booleans as `false`.
- `src/subtitle-search/candidates.spec.ts`:
  - forced, machine-translated, AI-translated and non-SRT candidates are dropped;
  - the order (hash, similarity, not hearing-impaired, downloads);
  - the cap of 3.
- `src/subtitle-search/acceptance.spec.ts`:
  - ratio 1.0427 is rejected;
  - offset 600 001 is rejected;
  - a score under each threshold is rejected;
  - a score at the threshold is accepted.
- `src/subtitle-search/subtitle-search-request.service.spec.ts`:
  - no row when the media server is not Jellyfin;
  - no row when the preference is off but the title flag is on (AC-1b);
  - no row when no owner opted in;
  - wanted languages fall back to the user's list only when the title list is empty;
  - an earlier `WAITING` search is superseded;
  - a throw never propagates.
- `src/subtitle-search/subtitle-search.driver.spec.ts`:
  - an item whose path is not the delivered file is not used;
  - the fifth miss fails with `item_not_found`;
  - a forced-only language is searched;
  - a present language is never searched;
  - a `busy` refusal fails the search with `error.subtitleEmbed.busy` and deletes its staging;
  - E01 of a `SCANNED` pack whose E02 is still `ENCODING` gets its embed queued (not `busy`);
  - a wake-up for a missing search deletes its staging directory;
  - the boot re-wakes every non-terminal search;
  - a duplicate wake-up on a search that already left the state writes nothing;
  - staged files are deleted on rejection and at a terminal state;
  - the boot sweep of orphan directories;
  - a re-run after a crash between attempt insert and fetch does not insert a second set of
    attempts.
- `src/subtitle-embed/subtitle-embed.service.spec.ts`:
  - `details()` gives `isSidecar: true` for a `101` row and `false` with `sourcePath = stagedPath`
    for a staged one;
  - `embedStaged` refuses a path outside the downloads root;
  - `embedStaged` is refused `busy` like `embed`.
- `src/process-jobs/process-jobs.service.spec.ts`:
  - `requestFor` is called once on a real delivery, and not on a repeat or a demoted source;
  - a `RUNNING` attempt becomes `FAILED`/`interrupted` on `encodeWorkerStarted`.

Not owed: resolver wiring beyond the service-only checks; the queue producer.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/npm api run lint
bin/comments api
bin/cli api npx prisma migrate status
git diff services/api/src/schema.gql
```

Typecheck is 0 errors. Tests are green, with the counts reported. `migrate status` is up to date. The
`schema.gql` diff equals the spec's delta plus `SubtitleEmbedTrack.isSidecar`, and nothing else.

## Amendment 0.4.0 (2026-10-25)

See `../spec.md` § Amendments (2026-10-25, `spec_version` 0.4.0) and `../tasks.md` Group 5.

- `acceptance.ts`: `FRAMERATE_TOLERANCE` becomes `0.0005`; coverage constants beside the two score
  constants (`CHAPTER_COVERAGE = 0.85`, `DURATION_COVERAGE = 0.6`, `CHAPTER_GATE = 0.8`); the check
  order is framerate → offset → coverage → score.
- `SubtitleSearchService.completed()` reads the attempt's `stagedPath` (still on disk while the
  attempt is `RUNNING`) to find the last cue; a new pure `last-cue.ts` (+ spec) parses it.
- `subtitleSyncCompleted` gains `mediaDurationMs: Int!` and `lastChapterStartMs: Int`; no Prisma change.

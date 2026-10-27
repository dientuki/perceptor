---
title: Library Track Languages — api slice
service: api
last_updated: 2026-10-27
status: Approved
---

# PLAN: Library Track Languages — `api` (`api/plan.md`)

## Scope

`api` stores each library file's languages on `Movie`/`Episode`, exposes them as
`fileAudioLanguages`/`fileSubtitleLanguages`, produces the `library-probe` queue, answers the worker's
two service-only operations, and queues a read from every trigger in spec REQ-3. It owns the
migration and the one-time pass.

It does **not** read any file (the worker does), render anything (`web`), or change `107`'s
behaviour: the path-resolution extraction below must leave every `107` test passing unchanged.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` + migration `<ts>_108_library_track_languages` | Modified / New | three nullable columns on `Movie` and on `Episode` |
| `src/queue/types.ts` | Modified | `LIBRARY_PROBE_QUEUE`, `LIBRARY_PROBE_JOB`, `LibraryProbeJob` |
| `src/queue/library-probe-queue.service.ts` | New | `request(target)` |
| `src/library-location/library-location.service.ts` (+ module) | New | the media-server path chain, extracted from `SubtitleSearchRequestService` |
| `src/subtitle-search/subtitle-search-request.service.ts` | Modified | calls the extracted service, maps its outcome to its existing keys |
| `src/library-probe/` (module, service, resolver, `dto/library-probe-target.input.ts`, `entities/library-probe-details.entity.ts`) | New | the two service-only operations, the store, the one-time pass |
| `src/movies/entities/movie.entity.ts`, `src/shows/entities/episode.entity.ts` | Modified | the two nullable `[String!]` fields |
| `src/process-jobs/process-jobs.service.ts` | Modified | trigger on delivery |
| `src/subtitle-embed/subtitle-embed.service.ts` | Modified | trigger on embed completion |
| `src/media-server/media-server-reconcile.service.ts` | Modified | triggers on promotion/confirmation, clearing on demotion |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | three `error.libraryProbe.*` keys |

## Existing code to reuse

- `src/queue/subtitle-probe-queue.service.ts`: the producer shape (a `Queue` built from
  `redisConnection()`, `OnModuleDestroy` closing it). Take `removeOnComplete`/`removeOnFail` from
  `src/subtitle-search/subtitle-search-queue.service.ts`, **not** from the probe service, which
  omits them.
- `SubtitleSearchRequestService.resolveLibraryPath` (`107` REQ-4): the chain to extract. The new
  `LibraryLocationService.locate({ kind, tmdbId, seasonNumber?, episodeNumber? })` returns
  `{ path } | { reason: 'no_client' | 'not_held' | 'unavailable' | 'outside_library' }` and throws
  nothing. `SubtitleSearchRequestService` maps `no_client`/`not_held` → `no_library_path`,
  `unavailable` → `media_server_unavailable`, `outside_library` → `subtitleEmbed.outside_library`, and
  still runs `embed.assertUsableMkv` itself (the `.mkv` rule is the embed's, not the inventory's: a
  library `.mp4` can be read).
- `src/subtitle-search/sidecar-languages.ts`'s `resolveSidecarLanguages(tags, languages)` against the
  `Language` rows, as `SubtitleSearchService.probeCompleted` already calls it.
- `src/subtitle-search/subtitle-search.resolver.ts`'s probe operations: `@AllowService()` plus the
  explicit service-principal assertion, and the `i18nError` factory for the keyed throws.
- `pipeline-status/`'s `hasPossession` / `POSSESSION_WHERE`: the one spelling of "holds a file", for
  the one-time pass's `where` and for `libraryProbeDetails`.

## Steps

1. **Schema and migration.** `Movie` and `Episode` gain `fileAudioLanguages Json?`,
   `fileSubtitleLanguages Json?`, `tracksReadAt DateTime?`. One migration, no data step.
2. **Keys.** `error.libraryProbe.invalid_target`, `not_found`, `media_server_unavailable`, with
   English copy (none is user-facing; copy exists so the key never renders raw in a log).
3. **Extract `LibraryLocationService`** (own module importing `MediaServerModule` and
   `MediaRootsModule`). Move the chain; rewire `SubtitleSearchRequestService`. Run the existing
   `subtitle-search-request` specs unchanged before going on: they are the proof the extraction kept
   `107`'s behaviour.
4. **Queue.** `LIBRARY_PROBE_QUEUE = 'library-probe'`, `LIBRARY_PROBE_JOB = 'library-probe'`,
   `LibraryProbeJob = { movieId?: number; episodeId?: number }`. `LibraryProbeQueueService.request(target)`
   adds with `jobId` `library-probe-movie-<id>` / `library-probe-episode-<id>`, `attempts: 1`,
   `removeOnComplete: true`, `removeOnFail: true`. It never throws: an enqueue failure is logged and
   swallowed, since every caller is a side path of something that already succeeded.
5. **`LibraryProbeService`.**
   - `details(target)`: exactly one id, else `invalid_target`. Load the title (an episode with its
     season number, episode number and show's `tmdbId`). If it has a `filePath`, return it. Else if
     `mediaServerPresentAt` is set, `locate(...)`: `path` → return it; `unavailable` →
     `media_server_unavailable`; any other reason → `not_found`. Else `not_found`. A missing row is
     `not_found`.
   - `completed(target, filePath, audio, embeddedSubs, sidecarTags)`: resolve sidecar tags with
     `resolveSidecarLanguages` (load `Language` rows only when there are tags); subtitle list = the
     embedded codes, then the resolved sidecar codes, de-duplicated in that order; audio list
     de-duplicated as received. Write through one `updateMany` whose `where` is the id **and** either
     `filePath: <reported>` or `{ filePath: null, mediaServerPresentAt: { not: null } }` (the second
     arm only when the title currently has no `filePath`), setting both lists and
     `tracksReadAt: now`. Return `count === 1`. A missing title returns `false`.
   - `backfill()`: one `findMany` per type selecting ids where `tracksReadAt` is null and the title
     holds a file (`POSSESSION_WHERE`), then `request()` for each, sequentially. Called from an
     `onApplicationBootstrap` that does `void this.backfill().catch(log)`: boot never awaits it.
6. **Resolver.** `libraryProbeDetails(target: LibraryProbeTarget!)` and
   `libraryProbeCompleted(...)`, both `@AllowService()` + the service-principal assertion, exact SDL
   from `spec.md` (descriptions included).
7. **Fields.** `fileAudioLanguages`/`fileSubtitleLanguages: [String!]` nullable on the `Movie` and
   `Episode` entities, with the SDL descriptions, mapped straight from the Json columns (an absent or
   non-array value reads `null`). Make sure every read path that builds these entities selects the
   new columns (the film detail query and the show detail query's episodes).
8. **Triggers** (each a single `request()` call, never awaited into the caller's result):
   - `ProcessJobsService.encodeCompleted`: in the `!alreadyDeliveredSame` block, beside
     `notifyCreated`, for the movie or episode, only when the source was not demoted (the same guard
     `103`'s `requestFor` sits behind).
   - `SubtitleEmbedService.completed`: after the claim succeeds, for the embed's movie or episode.
   - `MediaServerReconcileService`: `reconcileMovie` and `reconcileShow` (each episode promoted);
     `syncMovie`/`syncShow` for every title or episode the media server holds after the sync,
     promoted or already `COMPLETED`.
9. **Clear on loss.** `syncMovie`/`syncShow`'s demotion `data` gains
   `fileAudioLanguages: Prisma.DbNull`, `fileSubtitleLanguages: Prisma.DbNull`, `tracksReadAt: null`
   beside `filePath: null, mediaServerPresentAt: null`. Removal by the last owner deletes the row; no
   step needed.

## Contract obligations

Produced, exactly as `../spec.md` § GraphQL Contract Delta:

- `Movie.fileAudioLanguages`, `Movie.fileSubtitleLanguages`, `Episode.fileAudioLanguages`,
  `Episode.fileSubtitleLanguages`: `[String!]`, nullable, `null` = never read, `[]` = read and empty.
- `input LibraryProbeTarget { movieId: Int, episodeId: Int }`.
- `libraryProbeDetails(target)`: `LibraryProbeDetails { filePath }`; errors `invalid_target`
  (`BadRequestException`), `not_found` (`NotFoundException`), `media_server_unavailable`
  (`ServiceUnavailableException`), the service-guard key for a user token.
- `libraryProbeCompleted(target, filePath, audioLanguagesIso3, embeddedSubtitleLanguagesIso3,
  sidecarLanguageTags)`: `Boolean!`, `false` for a stale path or a missing title, never an error for
  either.
- Queue `library-probe` / `library-probe`, payload `{ movieId?: number; episodeId?: number }`, job id
  per title, `attempts: 1`.

`git diff services/api/src/schema.gql` must show exactly that and nothing else.

## Tests

Article IX, each verified to fail when its rule is removed:

- `src/queue/library-probe-queue.service.spec.ts`: the job id per title (movie and episode), and
  `removeOnComplete`/`removeOnFail` set (remove them: the case fails). A throwing `add` is swallowed.
- `src/library-probe/library-probe.service.spec.ts`:
  - `details`: neither/both ids → `invalid_target`; `filePath` wins over the media server;
    media-server-only title → located path; `unavailable` → `media_server_unavailable`; no file at
    all → `not_found` with no media-server call;
  - `completed`: an embedded and a sidecar `spa` produce one `spa`; an unresolvable sidecar tag is
    dropped; a report whose `filePath` is not the title's current one writes nothing and returns
    `false` (drop the `filePath` arm of the `where`: the case fails); `[]` is stored as `[]`, not
    `null`;
  - `backfill`: a title with `tracksReadAt` set is not requested; a title with no file is not
    requested.
- `src/media-server/media-server-reconcile.service.spec.ts` (extend): a demotion clears the three
  columns (drop them from the `data`: the case fails); a promotion requests a read.
- `src/process-jobs/process-jobs.service.spec.ts` (extend): a delivery requests a read; a demoted
  source's late `encodeCompleted` does not.
- `src/subtitle-embed/subtitle-embed.service.spec.ts` (extend): completion requests a read for the
  embed's title.
- `src/subtitle-search/subtitle-search-request.service.spec.ts`: **unchanged and green** after step 3.
- The entity mapping (Json → nullable list) is not separately tested: a wrong mapping is visible on
  the first page load (AC-1), not silent.

## Done when

```bash
bin/cli api npx --no tsc --noEmit        # 0 errors
bin/npm api test                         # green, new cases included, 107's request specs unchanged
bin/cli api npx prisma migrate status    # up to date
bin/comments api
git diff services/api/src/schema.gql     # exactly the spec delta
grep -rn "hostToContainerPath('library'" services/api/src --include=*.ts | grep -v spec   # only in library-location/
```

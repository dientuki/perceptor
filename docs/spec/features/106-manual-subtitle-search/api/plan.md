---
title: Manual Subtitle Search — api slice
service: api
last_updated: 2026-10-26
status: Implemented
---

# PLAN: Manual Subtitle Search — `api` (`api/plan.md`)

## Scope

`api` exposes `searchMovieSubtitles`/`searchEpisodeSubtitles` and creates a `103` search on a press:
- with the caller's own languages, whatever their preference (spec REQ-4);
- with the first wake at no delay (REQ-5);
- with REQ-3's refusals thrown, in their order;
- refusing, never superseding, while a search is running (REQ-8).

It also teaches `103`'s driver to search a title that has no `filePath` (REQ-7), storing the resolved
path in the new `SubtitleSearch.libraryPath`.

It does **not** touch the worker (the `subtitle-sync` contract is unchanged: `subtitleSyncDetails`
still returns one `filePath`) or `web`. The delivery trigger (`process-jobs/`'s `requestFor` calls)
must behave exactly as before.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/prisma/schema.prisma` | Modified | `SubtitleSearch.libraryPath String? @db.VarChar(500)` |
| `services/api/prisma/migrations/<ts>_106_subtitle_search_library_path/` | New | the column |
| `services/api/src/subtitle-embed/subtitle-embed.service.ts` | Modified | new public preflight for a manual search; new public `.mkv`/library check usable on a resolved path |
| `services/api/src/subtitle-search/subtitle-search-request.service.ts` | Modified | the manual entry point; shared language union and creation |
| `services/api/src/subtitle-search/subtitle-search-request.module.ts` | Modified | imports `SubtitleEmbedModule` |
| `services/api/src/subtitle-search/subtitle-search.resolver.ts` | Modified | the two mutations (user-authenticated, not `@AllowService`) |
| `services/api/src/subtitle-search/subtitle-search.module.ts` | Modified | imports `SubtitleSearchRequestModule` for the resolver |
| `services/api/src/subtitle-search/subtitle-search.driver.ts` | Modified | `loadTarget` selects `mediaServerPresentAt`; `waiting` handles the no-`filePath` branch and writes `libraryPath` |
| `services/api/src/subtitle-search/subtitle-search.service.ts` | Modified | `details` reads `filePath ?? libraryPath` |
| `services/api/src/i18n/error-keys.ts`, `services/api/src/i18n/messages.en.ts` | Modified | `SUBTITLE_SEARCH_IN_PROGRESS`, `SUBTITLE_SEARCH_NO_LANGUAGES` |
| `services/api/src/schema.gql` | Generated | the two mutations (Article IV: never hand-edited) |
| `docs/spec/graphql-contract.md` | — | **not this agent's**: the orchestrator adds the `106` section (`[docs]` task) |

## Existing code to reuse

- `SubtitleEmbedService.resolveTarget(ref, userId)`: with a non-null `userId` it is the ownership
  check, and throws `MOVIE_NOT_FOUND`/`EPISODE_NOT_FOUND` exactly as the contract table requires. Do
  not write a second ownership query.
- `hasPossession` (`@/pipeline-status/pipeline-status`): REQ-3.3, "holds a file".
- `SubtitleEmbedService.assertUsableMkv`: extension, inside the library root, regular file, each
  with its `101` key. REQ-3.4 runs it at press time only when `filePath` is set. The driver runs it
  on the path it resolved for a REQ-7 title.
- `SubtitleEmbedService.assertNotBusy(ref, target)`: REQ-3.5, `101` REQ-16, including the season-pack
  lift for an episode. Reuse it; do not re-derive "in flight".
- `SubtitleEmbedService.createGuarded`: the serializable-transaction pattern (count, then create,
  with `P2034` mapped to the conflict key). The manual creation follows it, with
  `error.subtitleSearch.in_progress`.
- `MediaCapabilitiesService.assertSubtitleSearchAvailable()`: REQ-3.1, already throwing
  `unsupported_media_server`.
- `SubtitleSearchRequestService.optedInOwners`/`userLanguages`: the per-owner effective-language
  rule (`103` REQ-5). The caller's languages are computed with the same two helpers. Lift the
  per-user part into one helper rather than writing a third query shape.
- `SubtitleSearchQueueService.wake(id, delayMs)`: `0` for a press.
- `SubtitleSearchDriver.resolveItem`: already finds the item by TMDB id (and season/episode), with
  one index rebuild on a miss.
- `MediaRootsService.hostToContainerPath('library', …)`: as `SubtitleEmbedService.resolveMkvPath`
  uses it; `null` means `outside_library`.
- `SubtitleSearchService.latestForMovie`/`latestForEpisode`: the mutation's return value, read back
  after creation, so the entity mapping exists once.

## Steps

1. **Schema.** Add `libraryPath` to `SubtitleSearch` and generate the migration with
   `bin/cli api npx prisma migrate dev --name 106_subtitle_search_library_path`.
2. **Error keys.** `SUBTITLE_SEARCH_IN_PROGRESS: 'error.subtitleSearch.in_progress'` and
   `SUBTITLE_SEARCH_NO_LANGUAGES: 'error.subtitleSearch.no_languages'`, with English copy in
   `messages.en.ts`.
3. **Preflight on `SubtitleEmbedService`.** Add a public method taking `(ref, userId)` that runs, in
   spec REQ-3 order:
   - `resolveTarget(ref, userId)`;
   - `hasPossession`, else `SUBTITLE_EMBED_NO_FILE`;
   - `assertUsableMkv(filePath)`, only when `filePath` is set;
   - `assertNotBusy`.

   It returns the target facts. Also make the `.mkv`/library check callable from the driver on a
   resolved container path: either expose `assertUsableMkv` or add a small public wrapper. The
   capability check (3.1) runs before it, in the resolver, so an unavailable feature never reveals
   ownership.
4. **Manual entry point on `SubtitleSearchRequestService`.** A new public method `(target, userId)`
   that:
   - calls the preflight;
   - computes the wanted languages as the union of the caller's effective languages (preference
     ignored) and the opted-in owners' (unchanged);
   - throws `SUBTITLE_SEARCH_NO_LANGUAGES` on an empty union;
   - in one serializable transaction, refuses with `SUBTITLE_SEARCH_IN_PROGRESS` if a non-terminal
     search exists, else creates the `WAITING` row;
   - wakes it with delay 0 (a failed wake is logged, not thrown: `103` NFR-5's boot re-wake
     recovers it);
   - returns the row id.

   Name it so that it contains `requestFor` (for example `requestForCaller`): the constitution's
   Article XII Check greps `requestFor` to list every creator of a search. Leave `requestFor`'s
   behaviour (supersede, 5-minute wake, swallow and log) untouched. Extract only what the two
   share: the language union and the row's data.
5. **Resolver.** Add `searchMovieSubtitles(movieId: Int!)` and `searchEpisodeSubtitles(episodeId: Int!)`,
   both returning `SubtitleSearch`, with user auth (as `setSubtitleSearch`, never `@AllowService`).
   Each one:
   - calls `assertSubtitleSearchAvailable()`;
   - calls the step-4 method with the current user's id;
   - returns `latestForMovie`/`latestForEpisode`.

   Add the descriptions from the spec's SDL so `schema.gql` matches it.
6. **Driver, REQ-7.** `loadTarget` also selects `mediaServerPresentAt`. In `waiting`, when there is
   no `filePath` and `mediaServerPresentAt` is set:
   - call `resolveItem` and, when it finds an item, skip the path comparison;
   - translate `listing.mediaHostPath` with `hostToContainerPath('library', …)`: `null` fails the
     search with `SUBTITLE_EMBED_OUTSIDE_LIBRARY`;
   - run the step-3 `.mkv` check on it, failing the search with the key it throws;
   - otherwise transition to `SEARCHING` with `itemId`, `presentLanguages` and `libraryPath`.

   A miss counts toward `MAX_MISSES` as today. A title with a `filePath` follows exactly today's
   path, comparison included.
7. **`SubtitleSearchService.details`.** Select `libraryPath` on the search and use
   `movie.filePath ?? episode.filePath ?? search.libraryPath`.
8. **Regenerate `schema.gql`** by booting `api` (`bin/dev -d`, then check the file's diff holds only
   the two mutations).

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, exactly:

- `searchMovieSubtitles(movieId: Int!): SubtitleSearch!` and
  `searchEpisodeSubtitles(episodeId: Int!): SubtitleSearch!`, returning the new `WAITING` search;
- refusals, in REQ-3's order, with these keys and exception types:
  1. `error.subtitleSearch.unsupported_media_server` (BadRequest);
  2. `error.movie.not_found` / `error.episode.not_found` (NotFound);
  3. `error.subtitleEmbed.no_file` (BadRequest);
  4. `error.subtitleEmbed.not_mkv` or `outside_library` (BadRequest);
  5. `error.subtitleEmbed.busy` (Conflict);
  6. `error.subtitleSearch.in_progress` (Conflict);
  7. `error.subtitleSearch.no_languages` (BadRequest);
- a REQ-7 search's `errorKey` may be `error.subtitleEmbed.not_mkv` or
  `error.subtitleEmbed.outside_library`.

Nothing else in the GraphQL surface changes. If any of this looks wrong from inside `api`, stop and
report.

## Tests

Owed under Article IX, since every one of these fails silently. Extend the existing spec files.

- `src/subtitle-search/subtitle-search-request.service.spec.ts`:
  - each REQ-3 refusal reaches the caller as its key, creates no row and wakes nothing;
  - the caller's languages are wanted with their preference off, while another owner with it off
    contributes none;
  - a press with a non-terminal search throws `in_progress` and leaves that row untouched;
  - a press wakes with delay 0, and `requestFor` still wakes with 5 minutes and still supersedes;
  - an empty union throws `no_languages`.
- `src/subtitle-search/subtitle-search.driver.spec.ts`:
  - a no-`filePath` title is matched without a path comparison and its `libraryPath` written;
  - a non-`.mkv` or out-of-library item path fails the search with no remote search call;
  - a title with a `filePath` still rejects an item whose path differs.
- `src/subtitle-search/subtitle-search.service.spec.ts` (or the existing details test): `details`
  falls back to `libraryPath`.

The resolver itself is a thin pass-through and is not owed a test of its own.

## Done when

```bash
bin/cli api npx prisma migrate status
bin/cli api npx --no tsc --noEmit
bin/npm api run test
bin/comments api
git diff services/api/src/schema.gql
```

The migration is applied, typecheck and tests pass, the comment gate is clean, and the
`schema.gql` diff is exactly the two mutations.

---
title: Automatic Episode Acquisition — api slice
service: api
last_updated: 2026-09-26
status: Implemented
---

# PLAN: Automatic Episode Acquisition — `api` (`api/plan.md`)

## Scope

`api` owns everything in this feature except the browser. Three pieces: the release comparator
ported in from `web` (`src/indexer/ranking.ts`), the service that resolves what arms that
comparator (`src/indexer/ranking-context.service.ts`), and the scheduled sweep that uses both
(`src/scheduler/tasks/acquire-episodes.task.ts`). It also grows the three Settings rows and the
new fields on `TorrentResult`.

It is **not** deleting `services/web/src/lib/torrent-ranking.ts` — `web` owns that removal, in the
same feature. Write nothing outside `services/api/` and this directory; a change that looks
necessary in `web` is a stop-and-report.

**Article XI applies to every new file here.** The file being ported from `web` is heavily
commented; the port carries **no** comments. Its rationale is already recorded where it belongs —
`docs/spec/features/036-torrent-ranking-heuristic/spec.md`, which every one of those comments cites
by REQ number. Do not migrate the prose. The one comment this slice may add is the test header
Article IX requires.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/indexer/ranking.ts` | New | The ported comparator. Exports `rankTorrentResults(results, context)` and the `RankingContext` type. |
| `src/indexer/ranking.spec.ts` | New | Parity and ordering cases (Article IX — see § Tests). |
| `src/indexer/ranking-context.service.ts` | New | `forCaller(userId, target)` and `forShowOwners(showId)`, both returning `RankingContext`. |
| `src/indexer/ranking-context.service.spec.ts` | New | Fallback, union and ownership-refusal cases. |
| `src/indexer/entities/torrent-result.entity.ts` | Modified | `ReleaseRanking` object type; `ranking`, `candidate`, `candidateRank` on `TorrentResult`. |
| `src/indexer/indexer.resolver.ts` | Modified | The three optional target arguments; rejects more than one; ranks before returning. |
| `src/indexer/indexer.service.ts` | Modified | A ranked read path over the existing cached `search()`. The cache keeps storing raw rows. |
| `src/indexer/indexer.module.ts` | Modified | Imports the modules `RankingContextService` reads through; exports it alongside `IndexerService`. |
| `src/preferences/preferences.module.ts` | Modified | Add `exports: [PreferencesService]` — it exports nothing today. |
| `src/scheduler/scheduler.registry.ts` | Modified | The `acquire_episodes` entry (`mediaType: 'show'`, daily default) and the cutoff key constant. |
| `src/scheduler/tasks/acquire-episodes.task.ts` | New | The sweep. |
| `src/scheduler/tasks/acquire-episodes.task.spec.ts` | New | Eligibility, grace, cutoff and failure-accounting cases. |
| `src/scheduler/scheduler.module.ts` | Modified | Imports `IndexerModule` and `EpisodesModule`; provides the new task. |
| `src/scheduler/scheduler.service.ts` | Modified | One method that stamps the cutoff row. |
| `src/settings/settings.resolver.ts` | Modified | Detect the off→on transition and call it. |
| `src/settings/settings.catalog.ts` | Modified | The two `schedule_acquire_episodes_*` keys. |
| `prisma/seeds/settings.ts` | Modified | Seed the two schedule rows plus an empty `auto_acquire_episodes_since`. |
| `src/i18n/error-keys.ts` + the English message map | Modified | `error.search.target_ambiguous`. |

## Existing code to reuse

- `services/web/src/lib/torrent-ranking.ts` — **the source of the port**. Read it in full. Every
  regex, threshold, alias table and comparator line moves across unchanged; only the return shape
  changes (see § Steps 1). Do not "improve" a criterion while moving it.
- `src/pipeline-status/pipeline-status.ts` — `deriveEpisodeStatus(seasonSources, episode, now)` is
  the eligibility test. Do not write a new "is this episode free" query: it already encodes the
  `059` season-pack lift and the `069` column-decides rule, and a second definition of the same
  question is how the two drift.
- `src/scheduler/tasks/refresh-episodes.task.ts` — the shape this handler copies: one selection
  query, a **sequential** walk (never `Promise.all`), a per-item `try/catch`, counts, and a
  UTC start-of-day cutoff constant computed the same way this feature's grace must be.
- `src/indexer/indexer.service.ts` — `search(query)` already read-throughs Redis with a 10-minute
  TTL (`040`). Both the resolver and the sweep go through it; NFR-2 is satisfied by not adding a
  second path to Prowlarr.
- `src/episodes/episodes.service.ts` — `addTorrentToEpisode(episodeId, input, userId)` is the
  attach. It resolves a null `infoHash` itself and throws `error.indexer.no_infohash` when it
  cannot; the sweep catches that like any other per-item failure. `findOneFromDb(id, userId)` is
  the ownership lookup for the `episodeId` target.
- `src/seasons/seasons.service.ts` / `src/movies/movies.service.ts` — `findOneFromDb(id, userId)`
  for the other two targets, and `MoviesService.findAudioMandatoryFor` /
  `ShowsService.findAudioMandatoryFor` for the per-title flag.
- `src/preferences/preferences.service.ts` — `findForUser(userId)` returns `allowCinemaReleases`,
  `audioMandatory`, `audioLanguages` and both scoped torrent-group lists in one call. Use it rather
  than re-querying `user_torrent_groups`; the scope join is deliberately not trivial.
- `src/languages/languages.service.ts` — `findShowPreferredTrackLanguagesFor(userId, showId,
  'AUDIO')` and `findMoviePreferredTrackLanguagesFor(...)` for the per-title lists.
- `src/media-server-index/media-server-index.service.ts` — the precedent for a machine-written
  Setting row: `prisma.setting.update` directly, not `SettingsService.updateMany`.
- `src/settings/settings.resolver.ts` — the `mediaServerChanged` block is the idiom the cutoff
  stamp follows: compare the submission against the `before` map captured at the top, fire the side
  effect only on a genuine change.
- `src/i18n/i18n-error.ts` — every throw in this slice is `i18nError.badRequest`/`notFound` with a
  key from `ERROR_KEYS`. No bare `BadRequestException`.
- **Accepted duplication**: the release-query string. `SearchTorrent.tsx` builds the UI's prefill by
  stripping `[^a-zA-Z0-9 ]` from the series title, collapsing whitespace and appending `S01E02`.
  The sweep needs the same string and there is no contract field that carries it, so copy the rule
  into a small exported helper next to the task and pin it with a unit case. Named here so it is a
  decision, not an accident — if the two ever diverge, the sweep silently searches for something
  the user never sees.

## Steps

1. **Port the comparator** into `src/indexer/ranking.ts`. Keep every veto (`isVetoed`,
   `isDeadSwarm`, `isUpscaled`, `isCinemaCapture`), every criterion function, `LANGUAGE_ALIASES`,
   `DEFAULT_PREFERRED_GROUPS`, `familyCeiling`/`adjustSourceRank` and `compareCandidates` exactly as
   they are. Change only the entry point:
   - it takes `(results, context: RankingContext)` where `RankingContext` carries
     `{ languageRequirement, preferredGroups, allowCinemaReleases }`;
   - it returns **every** input row in input order, each as
     `{ ...result, ranking, candidate, candidateRank }`;
   - `candidate` is true when the row survives all four vetoes **and** its `resolutionTier` equals
     the highest tier among the survivors — the same two passes as today;
   - `candidateRank` is the 1-based position of that row in the candidate subset sorted by
     `compareCandidates` (stable sort, so full ties keep the indexer's order), and `null` for a
     non-candidate.
2. **Write `ranking.spec.ts`** (§ Tests) before wiring anything to it.
3. **`RankingContextService`**. `forCaller(userId, target)` where `target` is
   `{ movieId } | { seasonId } | { episodeId } | null`: run the matching `findOneFromDb`, throw the
   keyed `*_NOT_FOUND` when it returns null, resolve the per-title audio languages, fall back to
   `PreferencesService.findForUser`'s `audioLanguages`/`audioMandatory` when the title has none of
   its own, take the groups from the scope matching the target's kind, and set
   `allowCinemaReleases` from the caller's preference **only** for a film (true for season, episode
   and no target). A `null` target means an unarmed requirement, an empty group list (the
   comparator falls back to its own defaults) and no cinema veto.
   `forShowOwners(showId)` builds the same object from every `UserShow` of the series (REQ-11):
   `mandatory` is true when any owner's effective flag is; `languages` is the de-duplicated union of
   every owner's effective list, including owners who did not set the flag — widening the match is
   the safe direction, since the language only ever promotes a tie, never vetoes; `preferredGroups`
   is the union of their `showTorrentGroups` names; `allowCinemaReleases` is true.
4. **Entity + resolver.** Add `ReleaseRanking` and the three fields exactly as `../spec.md` spells
   them. The resolver rejects more than one of `movieId`/`seasonId`/`episodeId` with
   `error.search.target_ambiguous` **before** touching the indexer, resolves the context, calls the
   ranked read path and returns. Keep the existing empty-query short-circuit.
5. **Module wiring.** `IndexerModule` imports `MoviesModule`, `ShowsModule`, `SeasonsModule`,
   `EpisodesModule`, `PreferencesModule` and `LanguagesModule`, and exports `RankingContextService`
   as well as `IndexerService`. Nothing imports `IndexerModule` today except `AppModule`, so none of
   these can be circular — verify that stays true rather than reaching for `forwardRef`.
   `PreferencesModule` gains its missing `exports`.
6. **Registry + settings.** Add `acquire_episodes` (`defaultCron: '0 3 * * *'`,
   `mediaType: 'show'`) to `SCHEDULED_TASKS`; the two catalog keys; the three seed rows. Export the
   cutoff key name (`auto_acquire_episodes_since`) as a constant from the registry so the writer and
   the reader cannot disagree about its spelling. `SCHEDULE_SETTING_KEYS` in `settings.resolver.ts`
   derives from the registry and needs no edit.
7. **The cutoff stamp.** `SchedulerService` gains one method that upserts the cutoff row to the
   current instant. `SettingsResolver.updateSettings` calls it when the submission carries
   `schedule_acquire_episodes_enabled: 'true'` and `before[key] !== 'true'` — note that every save
   of any Settings tab re-submits every boolean key, so the `before` comparison is what keeps an
   unrelated save from moving the cutoff (AC-2).
8. **The task.** `AcquireEpisodesTask.run()`:
   - read the cutoff; if it is empty or unparseable, stamp it to now and use that value (the
     defensive branch — an armed task with no cutoff must never mean "no lower bound");
   - select candidate episodes: `releaseDate` non-null, `releaseDate <= now - 1 day` at UTC
     start-of-day granularity, `releaseDate >= ` the cutoff's calendar day, `season.seasonNumber`
     not 0, the series held by at least one user, ordered by `releaseDate` ascending, taking the
     season's non-`ERROR` sources and the episode's own sources/jobs in the same `include` shape
     `ShowsService.findOneFromDb` uses;
   - drop anything whose `deriveEpisodeStatus(...)` is not `MISSING`;
   - cap at 20 (module constant);
   - resolve one `RankingContext` per **series**, not per episode, and reuse it across that series'
     episodes in this run;
   - per episode, sequentially: build the query, `IndexerService.search`, `rankTorrentResults`, take
     the row with `candidateRank === 1`, and attach through `addTorrentToEpisode` as the oldest
     `UserShow`'s user with `force: false`. No candidate means skip, counted, not failed;
   - count `attached` / `skipped` / `failed`; return `{ itemsProcessed: attached }`; throw a message
     naming the counts **only** when at least one episode was attempted and every attempt failed —
     that is the "the sweep could not run" case of REQ-13 and it is what makes AC-6 record `FAILED`
     while AC-7 stays `SUCCESS`.
9. Register the task in `SchedulerModule`'s providers and add `IndexerModule`/`EpisodesModule` to
   its imports (neither imports `SchedulerModule`, so no `forwardRef`).

## Contract obligations

`api` exposes exactly what `../spec.md` § GraphQL Contract Delta spells out, and nothing else. In
particular: rows come back in the indexer's order, every row carries a non-null `ranking`,
`candidateRank` is 1-based and null for a non-candidate, there is no `allowCinemaReleases`
argument, and the task adds no SDL. The five error rows in that table are this slice's throw sites;
`error.search.target_ambiguous` is the only new key and it must be added to `ERROR_KEYS` and the
English message map (`web` owns its Spanish translation).

The delta is read-only. If it is wrong, stop and report.

## Tests

- `src/indexer/ranking.spec.ts` — **owed, and the most important file in this slice.** The failure
  is perfectly silent: a criterion that moves during the port produces a plausible ordering, the
  modal looks fine, and the nightly sweep downloads the wrong release forever. Header paragraph per
  Article IX. Cover, fault-injection style (each case verified to fail when the rule it pins is
  removed or reordered): each veto removes its row from the candidate set while leaving it in the
  response with `candidate: false`; a vetoed 2160p row does not set the tier for the survivors; the
  lexicographic order (resolution over group over source over the rest) holds; the disc-source skip
  of codec and audio; the mandatory-language promotion, its family ceiling, and the REQ-24 tiebreak
  surviving between two disc sources; `candidateRank === 1` is the row `compareCandidates` sorts
  first; response order equals input order; an all-vetoed response has no candidates and throws
  nothing. A case built from a real release-name list is worth more than a synthetic one.
- `src/indexer/ranking-context.service.spec.ts` — **owed.** A silent authorisation and correctness
  hole in one: a missing ownership check leaks another user's title through a search argument, and a
  wrong fallback silently unarms the language requirement so every ranking quietly ignores it.
  Cover: each target kind refusing a title the caller does not hold; the per-title → global
  languages fallback and the case where the title has its own; the cinema flag true for
  season/episode/null and the caller's own value only for a film; `forShowOwners` arming on one
  owner out of three, unioning languages across owners including non-mandatory ones, and returning
  an unarmed context when nobody required anything.
- `src/scheduler/tasks/acquire-episodes.task.spec.ts` — **owed.** Every failure here is silent by
  construction: an off-by-one in the grace downloads on air day, a timezone slip shifts it by a day,
  a missing cutoff floods the queue, and a wrongly-`SUCCESS` run hides a week of outage. Cover: an
  episode dated today is skipped and the same episode dated yesterday is attempted (both boundaries,
  in UTC); an episode before the cutoff is never attempted; an empty cutoff is stamped and nothing
  older is swept; season 0 excluded; an episode whose `deriveEpisodeStatus` is not `MISSING` skipped,
  including the season-pack-in-flight case; the cap at 20 with the oldest first; the attach using
  the oldest owner's id; a per-episode throw leaving the rest of the run intact with
  `itemsProcessed` counting only what attached; every attempt failing making the handler throw.
- `src/settings/settings.resolver.spec.ts` (if present) or a case in the scheduler suite — **owed**
  for the transition guard only: re-saving an unrelated tab must not move the cutoff. That is the
  AC-2 regression and it fails silently (the window quietly slides forward and yesterday's episodes
  stop being eligible).
- The entity and module wiring are **not** owed tests: a wrong field name fails the `schema.gql`
  diff check, and a broken module graph fails boot loudly.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
git status --short services/api/prisma
git diff services/api/src/schema.gql
```

0 typecheck errors; the suite green with the new cases; `git status --short services/api/prisma`
shows **only** a modified `prisma/seeds/settings.ts` and no migration directory (NFR-4); the
`schema.gql` diff matches `../spec.md` § GraphQL Contract Delta exactly.

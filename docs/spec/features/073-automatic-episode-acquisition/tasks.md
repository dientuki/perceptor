---
title: Automatic Episode Acquisition — Tasks
last_updated: 2026-09-26
status: In Progress
---

# TASKS: Automatic Episode Acquisition (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation and the cross-service verification sweep. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

`worker` is not in this feature (NFR-3): its diff must stay empty and no task touches
`services/worker/`. There is no migration (NFR-4): no task writes `prisma/schema.prisma` or
`prisma/migrations/`.

**Article XI applies to every new `api` file here.** The comparator being ported from `web` is
heavily commented; the port carries no comments. The rationale stays in
`docs/spec/features/036-torrent-ranking-heuristic/spec.md`, which those comments already cite by
REQ number. The only comment any of these tasks may add is the Article IX test header.

## Tasks

### Group 1 — the ranking moves into `api`

- [ ] **T001** `[api]` Port `services/web/src/lib/torrent-ranking.ts` to
      `src/indexer/ranking.ts`. Every veto (`isVetoed`, `isDeadSwarm`, `isUpscaled`,
      `isCinemaCapture`), every criterion function, `LANGUAGE_ALIASES`, `DEFAULT_PREFERRED_GROUPS`,
      `familyCeiling`/`adjustSourceRank` and `compareCandidates` move across **unchanged** — do not
      re-tune a threshold or a regex while moving it. Only the entry point changes: export
      `rankTorrentResults(results, context: RankingContext)` where `RankingContext` is
      `{ languageRequirement, preferredGroups, allowCinemaReleases }`, returning **every** input row
      in input order as `{ ...result, ranking, candidate, candidateRank }` — `candidate` true when
      the row survives all four vetoes and its `resolutionTier` equals the highest tier among the
      survivors, `candidateRank` its 1-based position in the candidate subset sorted by
      `compareCandidates` (stable sort), `null` otherwise. Write `src/indexer/ranking.spec.ts` with
      its Article IX header and the cases in `api/plan.md` § Tests. Do not delete the `web` file —
      that is T008. See `api/plan.md` steps 1–2.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors; `bin/npm api test` passes
      with the new suite counted; reverting any one veto to a no-op, or swapping two lines of
      `compareCandidates`, each makes at least one case fail (fault injection, reverted); a
      response whose rows are all vetoed returns every row with `candidate: false` and throws
      nothing.
- [ ] **T002** `[api]` Add `src/indexer/ranking-context.service.ts` with `forCaller(userId, target)`
      and `forShowOwners(showId)`, both returning T001's `RankingContext`, plus
      `ranking-context.service.spec.ts`. `forCaller` runs the matching
      `MoviesService`/`SeasonsService`/`EpisodesService.findOneFromDb` and throws the keyed
      `MOVIE_NOT_FOUND`/`SEASON_NOT_FOUND`/`EPISODE_NOT_FOUND` on null; resolves per-title audio
      languages through `LanguagesService.findMovie/ShowPreferredTrackLanguagesFor`, falling back to
      `PreferencesService.findForUser`'s `audioLanguages`/`audioMandatory` when the title has none;
      takes groups from the scope matching the target kind; sets `allowCinemaReleases` from the
      caller's preference **only** for a film (true for season, episode and a null target). A null
      target means unarmed, empty groups, no cinema veto. `forShowOwners` unions every `UserShow`:
      mandatory if any owner's effective flag is, languages the de-duplicated union of every
      owner's effective list **including non-mandatory owners**, groups the union of their
      `showTorrentGroups`, `allowCinemaReleases` true. Add the missing `exports:
      [PreferencesService]` to `src/preferences/preferences.module.ts`. See `api/plan.md` step 3. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `bin/npm api test`
      passes with cases covering each target kind refusing a title the caller does not hold, the
      per-title→global fallback both ways, the cinema flag per target kind, and a three-owner union
      that arms on one owner while taking all three's languages; dropping the ownership `where`
      from any `findOneFromDb` call makes a case fail (fault injection, reverted).
- [ ] **T003** `[api]` Expose the contract. In `src/indexer/entities/torrent-result.entity.ts` add
      the `ReleaseRanking` object type and `ranking`/`candidate`/`candidateRank` on `TorrentResult`
      exactly as `spec.md` § GraphQL Contract Delta spells them. In `src/indexer/indexer.service.ts`
      add a ranked read path over the existing cached `search()` (the Redis cache keeps storing raw
      rows). In `src/indexer/indexer.resolver.ts` add the optional `movieId`/`seasonId`/`episodeId`
      arguments, reject more than one with a new
      `ERROR_KEYS.SEARCH_TARGET_AMBIGUOUS = 'error.search.target_ambiguous'` **before** touching the
      indexer, resolve the context through T002 and return the ranked rows in the indexer's order.
      Add the key to `src/i18n/error-keys.ts` and the English message map. Wire
      `src/indexer/indexer.module.ts`: import `MoviesModule`, `ShowsModule`, `SeasonsModule`,
      `EpisodesModule`, `PreferencesModule`, `LanguagesModule`; export `RankingContextService`
      beside `IndexerService`. Nothing imports `IndexerModule` but `AppModule`, so no `forwardRef`
      is needed — if one seems necessary, stop and report. See `api/plan.md` steps 4–5. → T002
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors; `api` boots
      (`bin/cli api node -e 'process.exit(0)'` is not proof — check the container is healthy); after
      regeneration `git diff services/api/src/schema.gql` shows exactly `ReleaseRanking`, the three
      new `TorrentResult` fields and the three new `searchTorrents` arguments and nothing else;
      `bin/npm api test` passes.

### Group 2 — the scheduled sweep (`api`)

T004 depends on nothing in Group 1 and may start immediately, in parallel with T001; it is the
task T009 in Group 3 waits on. T005 and T006 follow it in order.

- [ ] **T004** `[api]` Register the task and its settings. Create
      `src/scheduler/tasks/acquire-episodes.task.ts` as a **stub** returning
      `{ itemsProcessed: 0 }` (the shape `acquire-pending.task.ts` still has) and provide it in
      `src/scheduler/scheduler.module.ts`, so the registry entry below has a handler to point at
      and T006 has a file to fill in. In
      `src/scheduler/scheduler.registry.ts` add `acquire_episodes` (`defaultCron: '0 3 * * *'`,
      `mediaType: 'show'`, handler `AcquireEpisodesTask`) and export the cutoff key name
      `auto_acquire_episodes_since` as a constant so the writer and the reader cannot disagree about
      its spelling. In `src/settings/settings.catalog.ts` add
      `schedule_acquire_episodes_enabled: { kind: 'boolean' }` and
      `schedule_acquire_episodes_cron: { kind: 'cron' }` — **not** the cutoff key, which must stay
      unknown to `updateSettings`. In `prisma/seeds/settings.ts` seed the two schedule rows
      (`'false'`, `'0 3 * * *'`) plus `auto_acquire_episodes_since` empty. `SCHEDULE_SETTING_KEYS`
      in `settings.resolver.ts` derives from the registry and needs no edit. See `api/plan.md`
      step 6.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors; after a restart
      `bin/mysql -e "select \`key\`, value from settings where \`key\` like '%acquire_episodes%'"`
      shows the three rows with those values; `git status --short services/api/prisma` lists only
      `prisma/seeds/settings.ts`; `updateSettings` with `auto_acquire_episodes_since` is refused
      with `error.setting.not_editable`; the `scheduledTasks` query lists `acquire_episodes` as
      disabled, available and never run.
- [ ] **T005** `[api]` Stamp the backlog cutoff on the off→on transition. Add one method to
      `src/scheduler/scheduler.service.ts` that upserts T004's cutoff row to the current instant
      (`prisma.setting.upsert` directly, following `media-server-index.service.ts`'s precedent for a
      machine-written Setting — never `SettingsService.updateMany`). Call it from
      `SettingsResolver.updateSettings`, in the idiom of the neighbouring `mediaServerChanged`
      block: fire only when the submission carries `schedule_acquire_episodes_enabled: 'true'` and
      the `before` map did not already hold `'true'`. Cover the guard with a case — every Settings
      tab re-submits every boolean key, so an unrelated save must not move the cutoff. See
      `api/plan.md` step 7. → T004
      *Done when:* `bin/npm api test` passes with a case proving a save that flips the switch on
      writes the row and a save that re-submits it already-on does not; dropping the
      `before[key] !== 'true'` half of the guard makes that second case fail (fault injection,
      reverted).
- [ ] **T006** `[api]` Fill in T004's stub `src/scheduler/tasks/acquire-episodes.task.ts` and write
      its spec, adding `IndexerModule` and `EpisodesModule` to `src/scheduler/scheduler.module.ts`'s
      imports (neither imports `SchedulerModule`, so no `forwardRef`). `run()`: read the
      cutoff and, when empty or unparseable, stamp it to now and use that value; select episodes
      with a non-null `releaseDate` at least one full day old (UTC start-of-day arithmetic,
      mirroring `RefreshEpisodesTask`'s cutoff constant), on or after the cutoff's calendar day,
      `season.seasonNumber` not 0, series held by at least one user, ordered `releaseDate` ascending,
      including the season's non-`ERROR` sources and the episode's own sources/jobs in the shape
      `ShowsService.findOneFromDb` uses; drop anything whose
      `deriveEpisodeStatus(...)` is not `MISSING` (reuse it — do not write a second "is this episode
      free" query); cap at 20 (module constant); resolve one `RankingContext` per **series** via
      `forShowOwners` and reuse it across that series' episodes; then per episode, **sequentially**
      (never `Promise.all`), build the query with a small exported helper that copies
      `SearchTorrent.tsx`'s prefill rule verbatim (strip `[^a-zA-Z0-9 ]`, collapse whitespace,
      append `S01E02`), call `IndexerService.search`, rank, take `candidateRank === 1`, and attach
      through `EpisodesService.addTorrentToEpisode` as the oldest `UserShow`'s user with
      `force: false`. No candidate is a counted skip, not a failure. Return
      `{ itemsProcessed: attached }`; throw a message naming the counts **only** when at least one
      episode was attempted and every attempt failed. See `api/plan.md` step 8 and its § Tests for
      the case list. → T001, T002, T004, T005
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors; `bin/npm api test` passes
      with cases for both grace boundaries in UTC, the cutoff exclusion, the empty-cutoff stamp,
      season 0, a non-`MISSING` derived status including the season-pack-in-flight case, the cap of
      20 oldest-first, the oldest-owner attribution, one episode throwing while the rest still run,
      and every attempt failing making the handler throw; `git diff --stat services/api/src/episodes
      services/api/src/downloads` is empty (the attach path is reused, not modified).

### Group 3 — `web` consumes the contract

Everything here depends on T003: `web` retypes the schema by hand, so the delta must exist first.

- [ ] **T007** `[web] [P]` Retype the contract. In `src/types/indexer.ts` add `ReleaseRanking` with
      its fourteen fields and `ranking: ReleaseRanking`, `candidate: boolean`,
      `candidateRank: number | null` on `TorrentResult`. In `src/actions/indexer.ts` give
      `searchTorrentsAction(query, target)` the optional
      `{ movieId } | { seasonId } | { episodeId } | null` target, send at most one id, and select
      the three new fields alongside the existing ones. Keep the empty-query short-circuit and the
      existing error handling. See `web/plan.md` steps 1–2. → T003
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and every field name in the
      query matches `spec.md` § GraphQL Contract Delta character for character.
- [ ] **T008** `[web]` Rewire `src/components/search/SearchTorrent.tsx` and **delete**
      `src/lib/torrent-ranking.ts`. Remove the `rankTorrentResults` import, the
      `titleAudio`/`languageRequirement`/`preferredGroups`/`allowCinemaReleases` assembly, the
      `getPreferences()` effect, its `preferences` state and the now-unused `UserPreferences`
      import (the ranking assembly is their only consumer). `showBest` true selects
      `results.filter(r => r.candidate)` sorted ascending by `candidateRank`; `showBest` false keeps
      `results` in the order the action returned them. The chips block loses its `"ranking" in res`
      guard but still renders only under `showBest`. Pass the component's existing target ids to
      T007's action. Handle the three `*_NOT_FOUND` errors the way `error.indexer.unavailable` is
      already handled — into `searchError`, modal open; never swallowed into an empty result list.
      See `web/plan.md` step 3. → T007
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors, `bin/npm web run build`
      exits 0, `grep -rn "rankTorrentResults" services/web/src` returns nothing, and
      `services/web/src/lib/torrent-ranking.ts` no longer exists.
- [ ] **T009** `[web] [P]` Make the new task savable and legible. Add
      `schedule_acquire_episodes_enabled` to `BOOLEAN_KEYS` in `src/actions/settings.ts`; add
      `settings.scheduling.tasks.acquire_episodes` label/description and the Spanish copy for
      `error.search.target_ambiguous` (`Indicá un solo destino de búsqueda`) to both
      `messages/en.json` and `messages/es.json`, keeping the surrounding Rioplatense register. No
      change to `SchedulingPanel.tsx` — it already renders any task the API lists. See `web/plan.md`
      steps 4–6. → T004
      *Done when:* `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift,
      `bin/npm web run build` exits 0, and Settings → Scheduling shows the task with its label and a
      switch that persists across a reload.

### Group 4 — verification and docs

- [x] **T010** `[docs]` Update the affected `CLAUDE.md` files. Root: the **Find release** row — the
      ranking is no longer a client-side re-rank of an already-fetched list, it is server-side on
      `searchTorrents` (`073`); and the **Detect completion, enqueue** / **Browse library** story
      gains the daily `acquire_episodes` sweep as a new *entry point* into existing stages (no new
      stage). `services/api/CLAUDE.md`: the `indexer/` bullet gains the ranking and
      `RankingContextService`; the `scheduler/` bullet goes from "four tasks, three stubs" to five
      with `acquire_episodes` real, naming the cutoff row and where it is stamped.
      `services/web/CLAUDE.md`: § "Torrent ranking heuristic (`036-…`)" no longer describes a
      `web`-owned module — rewrite it as "the ranking arrives on the wire" and point at `api`.
      *Done when:* no `CLAUDE.md` still tells a reader that `services/web/src/lib/torrent-ranking.ts`
      exists (`grep -rn "torrent-ranking" CLAUDE.md services/*/CLAUDE.md` returns nothing), and each
      updated claim names the feature number.
- [ ] **T011** `[docs]` Run the verification sweep in `plan.md` § Verification, walk every
      acceptance criterion in `spec.md`, tick the boxes that actually passed and say plainly which
      were not run and why. Record the measured test counts in the root `CLAUDE.md` § Current state
      and `services/api/CLAUDE.md` § Current state. Set `status: Implemented` on `spec.md`,
      `plan.md`, `api/plan.md` and `web/plan.md`, and `status: Done` here. → T006, T008, T009, T010
      *Done when:* `git diff services/api/src/schema.gql` matches `spec.md` § GraphQL Contract Delta
      exactly, `git status --short services/api/prisma` lists only `prisma/seeds/settings.ts`,
      `git diff --stat services/worker` is empty, and every AC in `spec.md` is either ticked or
      annotated with the reason it could not be reached.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

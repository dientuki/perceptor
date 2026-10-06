---
title: One acquisition path, one catalog search path — Tasks
last_updated: 2026-10-06
status: Done
---

# TASKS: One acquisition path, one catalog search path (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` | The only service agent this feature uses. `services:` is `[api]` alone. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[web]`, `[worker]` or `[infra]` task exists: the SDL does not change, both new error conditions
resolve through the envelope `web` already renders by key, both keys already exist in `en.json` and
`es.json`, and the stack boots identically. A `web` or `worker` change turning out to be necessary is
a **Blocked** entry, not a quiet edit.

## Tasks

### Group 1 — Measure before touching anything

- [x] **T001** `[api]` Run the two-target invariant query against the running database and record the
      number verbatim in this file under § Measurements. Change no code. The REQ-2 gap has been
      reachable since `059`, so a non-zero count is historical data, **not** something to repair
      (`plan.md` § Risks — repairing a row means choosing which target to drop, with a library file
      behind it).
      *Done when:* `bin/mysql -e 'select count(*) as two_target_rows from media_sources where (movieId is not null) + (seasonId is not null) + (episodeId is not null) <> 1'`
      has been run and its number is written into § Measurements below, with `git status` showing no
      change under `services/`.

### Group 2 — The drift defects

The only tasks in this feature a user can observe. They land **in the three existing copies**, before
any restructuring, so `git bisect` can tell a behaviour fix from a refactor and so Group 4's
regression net is written against the old structure (`plan.md` § Order of Work).

- [x] **T002** `[api] [P]` In `src/movies/movies.service.ts`'s `attachTorrentSource`, widen the
      colliding-source lookup to include `season: { include: { show: true } }` and add the refusal
      `i18nError.conflict(ERROR_KEYS.MAGNET_ALREADY_ATTACHED_SEASON, { show, number })` when the
      `infoHash` belongs to a season. Restructure nothing else. (REQ-2, REQ-3, AC-1) → T001
      *Done when:* submitting a magnet already attached to a season to a film is refused with
      `errorKey` `error.magnet.already_attached_season`, and
      `bin/mysql -e 'select movieId, seasonId, episodeId from media_sources where infoHash = "<hash>"'`
      still shows only `seasonId` set.
- [x] **T003** `[api] [P]` The same in `src/episodes/episodes.service.ts`, and additionally include
      `episode: { include: { season: { include: { show: true } } } }` so the holding episode is
      reachable — T004 needs it. (REQ-2, REQ-3, AC-2) → T001
      *Done when:* the same magnet submitted to an episode is refused with
      `error.magnet.already_attached_season`, and the row still shows only `seasonId` set.
- [x] **T004** `[api]` In the same method, interpolate the **holding** episode into the
      episode-to-episode collision instead of the target episode it passes today. The key stays
      `MAGNET_ALREADY_ATTACHED`; only the params change. (REQ-4, AC-3) → T003
      *Done when:* a magnet attached to S02E05 of a series, submitted to S03E01 of that series, is
      refused with a message naming **S02E05**.
- [x] **T005** `[api] [P]` In `src/movies/movies.service.ts`'s main update-or-create, clear
      `errorKey` and `errorParams` alongside `errorMessage`, matching its own reactivation branch and
      both other copies. (REQ-5, AC-5) → T001
      *Done when:* re-adding a film's release whose `MediaSource` was in `ERROR` leaves
      `bin/mysql -e 'select status, errorMessage, errorKey, errorParams from media_sources where id = <id>'`
      reading `QUEUED` with all three error columns `NULL`.
- [x] **T006** `[api]` Add the regression tests for T002–T005 to
      `src/movies/movies.service.spec.ts` and `src/episodes/episodes.service.spec.ts`, exercising the
      behaviour **through the public `addTorrentTo*`/`addMagnetTo*` methods** so they survive Group 4
      untouched. Each new `describe` opens with the paragraph Article IX requires, naming the silent
      failure: a `MediaSource` written with two target columns, which every consumer downstream reads
      as one target and mis-routes. (NFR-3) → T002, T003, T004, T005
      *Done when:* `bin/npm api test` passes, and reverting any one of T002–T005 makes a named test
      fail.

### Group 3 — Dead members and single definitions

No behaviour changes in this group. Each task must leave `bin/npm api test` passing with no test
edited.

- [x] **T007** `[api] [P]` Delete `EpisodesService.findActiveSource` (no caller anywhere in `api`)
      and `SeasonsService`'s `activeSource` lookup together with the two `activeSource &&` gates it
      feeds, which only guard a call that is already a no-op when nothing is delivered. (REQ-12)
      → T006
      *Done when:* `grep -rn "findActiveSource" services/api/src` returns nothing,
      `grep -n "activeSource" services/api/src/seasons/seasons.service.ts` returns nothing, and
      `bin/npm api test` passes with no test file modified.
- [x] **T008** `[api] [P]` Create `src/clients/torrent/tags.ts` exporting `sanitizeTag`; delete the
      four byte-identical copies in `movies`, `episodes`, `seasons` and `downloads` and import it.
      (REQ-11) → T006
      *Done when:* `grep -rn "function sanitizeTag" services/api/src` returns exactly **one** hit
      (four today) and `bin/npm api test` passes with no test file modified.
- [x] **T009** `[api]` Create `src/episodes/episode-title.ts` exporting `episodeDisplayTitle`; delete
      the three copies and import it. Add `src/episodes/episode-title.spec.ts` with the Article IX
      header naming the silent failure: the one definition drifting from the format `web`'s
      `SearchTorrent.tsx` prefill builds, so the conflict message and the search box name the same
      episode differently with nothing erroring. Pin the zero-padding on both numbers.
      (REQ-11, NFR-3) → T004, T006
      *Done when:* `grep -rn "episodeDisplayTitle" services/api/src --include=*.ts` shows one
      definition, `bin/npm api test` passes, and T004's message test still passes unmodified.

### Group 4 — The acquisition collapse

- [x] **T010** `[api]` Create `src/acquisition/attach-target.ts` with the `AttachTarget` descriptor —
      exactly the four members REQ-10 permits and no fifth; `src/acquisition/attach-source.service.ts`
      with the one attach body and no target branch inside it (resolve `infoHash`, the no-op for a
      hash already on this target, the `COMPLETED`/delivered refusal, the reactivation branch, `add()`
      before any write, `demoteDeliveredSources` on `force` **after** `add()` succeeded, then the
      update-or-create); and `src/acquisition/acquisition.module.ts` importing `SettingsModule` and
      `DownloadsModule`. Reuse `DownloadsService.demoteDeliveredSources`/`hasDeliveredSource` and
      `resolve-info-hash.ts` — reimplementing any of them is the bug this task exists to avoid.
      (REQ-1, REQ-8, REQ-9, REQ-10, AC-13) → T007, T008, T009
      *Done when:* `bin/cli api npx --no tsc --noEmit` exits 0, the service is reachable from the
      Nest graph with **no `forwardRef` anywhere** (`grep -rn "forwardRef" services/api/src` returns
      only the three existing explanatory comments), and `AttachTarget` has exactly four members.
- [x] **T011** `[api]` Add `src/acquisition/attach-source.service.spec.ts`, opening with the
      Article IX header naming both silent failures: a `MediaSource` written with two target columns
      set, and a cross-target collision accepted instead of refused. Cover all six holder/target
      combinations, including the holder-in-`ERROR` case REQ-9 pins as **still refused**. (NFR-3)
      → T010
      *Done when:* `bin/npm api test` passes and the six combinations each have a named test.
- [x] **T012** `[api] [P]` Move `MoviesService.addTorrentToMovie`/`addMagnetToMovie` onto
      `AttachSourceService`: keep both public method names (the `076` sweep calls
      `addTorrentToMovie` directly at `src/scheduler/tasks/acquire-movies.task.ts:108`), keep
      `parseMagnet` in the magnet entry point, build the descriptor, delegate, and keep reading the
      return shape afterwards. Delete the old body. Keep the `DOWNLOADING` write exactly as it is.
      (REQ-1, REQ-8, AC-6) → T010
      *Done when:* `bin/npm api test` passes with every **behavioural** assertion in
      `movies.service.spec.ts` and `acquire-movies.task.spec.ts` unmodified.
- [x] **T013** `[api] [P]` The same for `EpisodesService` (the `073` sweep calls
      `addTorrentToEpisode` at `acquire-episodes.task.ts:108`). (REQ-1, REQ-8, AC-6) → T010
      *Done when:* `bin/npm api test` passes with every behavioural assertion in
      `episodes.service.spec.ts` and `acquire-episodes.task.spec.ts` unmodified.
- [x] **T014** `[api] [P]` The same for `SeasonsService`, leaving its upload half
      (`startSeasonUpload`, `finishSeasonUpload`, `findSeasonWithEpisodes`) untouched and keeping
      `findSeasonWithEpisodes` as the return read. (REQ-1, REQ-8, AC-6) → T010
      *Done when:* `bin/npm api test` passes with every behavioural assertion in
      `seasons.service.spec.ts` unmodified, and `addTorrentToSeason` still returns a season carrying
      its episodes.

### Group 5 — The catalog collapse

Genuinely parallel with Group 4: the two share no file (`plan.md` § Order of Work). The order between
the two groups does not matter.

- [x] **T015** `[api] [P]` Create `src/media/catalog-descriptor.ts` and
      `src/media/catalog-search.service.ts` holding the single search + cache-write + ownership
      enrichment, plus `src/media/catalog-search.module.ts`. The module mirrors
      `media-capabilities.module.ts` and exists for the reason its comment records: `MediaModule`
      already imports `MoviesModule`, so a provider inside `MediaModule` that `MoviesModule` needs is
      a cycle. The cache write stays strictly **before** enrichment. (REQ-6) → T006
      *Done when:* `bin/cli api npx --no tsc --noEmit` exits 0, `MediaModule` is unmodified, and
      `src/media/media-type.interface.ts` and `media-dispatch.service.ts` are unmodified.
- [x] **T016** `[api]` Add `src/media/catalog-search.service.spec.ts` with the Article IX header
      naming the silent failure: the cache write losing its position before enrichment, writing one
      caller's `inLibrary`/`mediaId` into a shared Redis entry and leaking that user's library into
      every other user's cached results — the trap `026` extracted `cacheAndEnrich` to avoid. Assert
      the cached payload carries neither field, and assert the write happens before enrichment rather
      than inferring it. (NFR-3) → T015
      *Done when:* `bin/npm api test` passes and both assertions exist by name.
- [x] **T017** `[api]` Delete `search`, `cacheAndEnrich`, `enrichWithOwnership`, `cacheKey` and
      `cacheMovies`/`cacheShows` from `MoviesService` and `ShowsService` and delegate to
      `CatalogSearchService` with each one's own descriptor. Both must still satisfy
      `MediaTypeService` unchanged. Leave `register`, `refresh`, `refreshCatalog`/
      `syncCatalogFromTmdb`, `hydrate`, `getCached*`, `fetchFromTMDB`, `topUpCatalogFacts`,
      `deriveIsShort` and `deriveContentKind` alone. (REQ-6) → T015
      *Done when:* `bin/npm api test` passes, `src/media/media-search.service.ts` and
      `src/media/popular-media.service.ts` are **unmodified** and their specs pass untouched, and
      `bin/cli redis redis-cli get tmdb:movie:<tmdbId>` after a search returns a JSON object
      containing neither `inLibrary` nor `mediaId` (AC-8).
- [x] **T018** `[api]` In `ShowsService.getCachedShow`, write back what `fetchShowFromTMDB` returned,
      the way `getCachedMovie` already does. Leave `deriveContentKind` alone — its divergence is
      settled outside this feature (`spec.md` § Out of Scope). (REQ-7) → T017
      *Done when:* `bin/cli redis redis-cli del tmdb:show:<tmdbId>` for an unregistered series,
      followed by registering it, leaves `bin/cli redis redis-cli get tmdb:show:<tmdbId>` returning a
      populated entry (AC-9).

### Group 6 — Comment and language debt

- [x] **T019** `[api]` Remove every comment that existed only to cross-reference a twin — the
      "structural twin of …", "kept local rather than shared" and "symmetric with the check … now
      does" paragraphs, and the orphaned "Demote *before* creating the replacement" prose now sitting
      beside `087`'s locator in all three services — replacing with a `// Spec NNN, <ref>` locator
      where one is warranted. Re-point the parenthetical in `src/media/media-type.interface.ts`'s doc
      comment, which survives. Also drop the stray whitespace-only line in `movies.service.ts`.
      (NFR-4) → T012, T013, T014, T017
      *Done when:* `bin/comments api` exits 0 and `bin/npm api test` passes.
- [x] **T020** `[api] [P]` Translate the two Spanish Redis log strings in the catalog cache helpers
      to English (`Error guardando … de TMDB en Redis` and its twin in the film service's `catch`).
      `bin/comments` does not catch strings; Article VI governs them. (NFR-5) → T017
      *Done when:* `grep -rniE "guardando|resultados de TMDB" services/api/src` returns nothing.

### Group 7 — Verification

- [x] **T021** `[api]` Run the full gate and the duplication and invariant checks, and report each
      number. (AC-4, AC-10, AC-11, AC-14, and the Article IV check in `api/plan.md` § Contract
      obligations) → T011, T016, T018, T019, T020
      *Done when:* `bin/cli api npx --no tsc --noEmit`, `bin/npm api test` and `bin/comments api` all
      exit 0; `git diff --stat services/api/src/schema.gql` shows **no diff**;
      `grep -rn "function sanitizeTag" services/api/src` returns one hit;
      `grep -rn "findActiveSource" services/api/src` returns nothing;
      `git diff --stat` removes more lines than it adds; `wc -l services/api/src/movies/movies.service.ts services/api/src/shows/shows.service.ts`
      is below 812 and 641; and the invariant query from T001 returns the same number it did then.

### Group 8 — Documentation and close

- [x] **T022** `[docs] [P]` In `docs/spec/graphql-contract.md`, add this feature's error-condition
      delta and correct its seven references to `attachTorrentSource` — §1034 in particular asserts
      that each of the three keeps "their names, status or copy", which this feature makes false.
      (NFR-8, AC-15) → T021
      *Done when:* the file carries the delta and no passage describes three separate
      `attachTorrentSource` methods.
- [x] **T023** `[docs] [P]` Correct the root `CLAUDE.md` Download row, which calls `SeasonsService`
      "the third twin of `MoviesService`/`EpisodesService.attachTorrentSource`" — after this feature
      there is no third twin and no first one. And correct `services/api/CLAUDE.md`'s `media/`
      section, where "cache keys, endpoints, error strings and Prisma models stay private to each
      per-type implementation by design" becomes half-true: the cache *key shape* is now shared, the
      keys themselves stay per-type (`plan.md` § Decided Here). (NFR-9, AC-15) → T021
      *Done when:* neither file claims a twin that no longer exists, and the pipeline table's
      Download row cites `088`.
- [x] **T024** `[docs]` Amend Constitution Article X through `/constitution`: it currently names
      `movies`/`shows` and the three twins of `attachTorrentSource` as "deliberate duplication that
      outranks this article", which this feature makes false. Bump `version` and append to the
      Changelog. (NFR-1, AC-12) → T021
      *Done when:* Article X no longer names these two duplications as deliberate, and
      `docs/constitution.md`'s frontmatter `version` and Changelog record the amendment.
- [x] **T025** `[docs] [P]` Append this feature's entry to `docs/spec/history.md`, newest first,
      re-measuring with the commands at the top of that file and including T001's pre-existing
      two-target row count. Never the root `CLAUDE.md` (`086` REQ-10, REQ-11). (NFR-9, AC-15) → T021
      *Done when:* `history.md`'s newest entry is `088` and carries the measurement.
- [x] **T026** `[docs]` Walk every acceptance criterion AC-1 through AC-15 in `spec.md`, including
      the seven-step manual pass in `plan.md` § Verification with the stack up, tick each box, and set
      `status: Implemented` on `spec.md`, `plan.md` and `api/plan.md`. **AC-7 — re-running `087`'s own
      guarantees for REQ-3 and REQ-4 end to end — is reachable only from this task's manual pass**; no
      unit test stands in for it. → T022, T023, T024, T025
      *Done when:* all fifteen boxes are ticked from an observed result (not from a passing unit
      test), and the three files read `status: Implemented`.

## Measurements

Filled by T001 before any code changes.

| Measurement | Value | When |
| :-- | :-- | :-- |
| `media_sources` rows with ≠ 1 target set | 0 | before Group 2 |

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems land here (Article VIII): an agent that finds the GraphQL delta wrong stops and
reports rather than amending it from inside its slice. So does any task that turns out to need a
`services/web` or `services/worker` edit — `services:` is `[api]` alone, and that conclusion is a
decision for a human, not a scope expansion.

---
title: One acquisition path, one catalog search path — api slice
service: api
last_updated: 2026-10-06
status: Approved
---

# PLAN: One acquisition path, one catalog search path — `api` (`api/plan.md`)

## Scope

`api` owns the whole feature: it is the only entry in `services:`. Two disjoint collapses plus the
drift defects they expose, all inside `services/api/src`. No migration, no SDL change, no new
mutation, no new field.

Not doing, because nobody owns it in this feature: anything in `services/web` or `services/worker`.
The SDL does not move and the two error conditions this adds resolve through the envelope `web`
already renders by key, with both keys already present in `en.json` and `es.json` — verified. If a
`web` change turns out to be needed, that is a stop-and-report, not a quiet edit: writes are confined
to `services/api/` and this directory (`.claude/agents/api.md`).

Also not doing, by explicit decision in `../spec.md` § Out of Scope: splitting
`downloads/downloads.service.ts`, unifying `register`/`refresh`/`hydrate`/`getCached*`/
`fetchFromTMDB`/`deriveContentKind`, and anything about telling a queued torrent apart from a
downloading one. Each is named there with its reason. Touching any of them is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/acquisition/attach-target.ts` | New | The `AttachTarget` descriptor: exactly the four members REQ-10 permits, and nothing else. The type **is** the enforcement — a fifth member is a visible diff. |
| `src/acquisition/attach-source.service.ts` | New | The one attach body. Takes an `AttachTarget` and the release input; no `movie`/`episode`/`season` branch anywhere inside it. |
| `src/acquisition/acquisition.module.ts` | New | Provides and exports `AttachSourceService`. Imports `SettingsModule` (for `QbittorrentClient`) and `DownloadsModule`. |
| `src/acquisition/attach-source.service.spec.ts` | New | Article IX — see § Tests. |
| `src/clients/torrent/tags.ts` | New | `sanitizeTag`, one definition. Lives beside `TorrentCategory` in the module that owns the qBittorrent vocabulary. |
| `src/episodes/episode-title.ts` | New | `episodeDisplayTitle`, one definition, exported plainly (no provider — it is a pure function). |
| `src/episodes/episode-title.spec.ts` | New | Article IX — see § Tests. |
| `src/media/catalog-descriptor.ts` | New | The per-type descriptor for the catalog search: TMDB path, the row→`MediaSearchResult` mapping, the `MEDIA_TYPE` constant, the registered-row lookup, the `isShort` rule. |
| `src/media/catalog-search.service.ts` | New | The one implementation of search + cache write + ownership enrichment. |
| `src/media/catalog-search.module.ts` | New | Mirrors `media-capabilities.module.ts` exactly — see § Existing code to reuse for why it is a module of its own and not part of `MediaModule`. |
| `src/media/catalog-search.service.spec.ts` | New | Article IX — see § Tests. |
| `src/movies/movies.service.ts` | Modified | Drops its `attachTorrentSource` body, its `sanitizeTag`, its module-level `episodeDisplayTitle`, and its `search`/`cacheAndEnrich`/`enrichWithOwnership`/`cacheMovies`/`cacheKey`. Keeps `addTorrentToMovie`/`addMagnetToMovie` as public methods that build a descriptor and delegate. Keeps `register`, `refresh`, `refreshCatalog`, `getCachedMovie`, `fetchMovieFromTMDB`, `topUpCatalogFacts`, `deriveIsShort`, `deriveContentKind` untouched. |
| `src/episodes/episodes.service.ts` | Modified | Same for the attach half. Deletes `findActiveSource` (REQ-12) and its local `sanitizeTag`/`episodeDisplayTitle`. |
| `src/seasons/seasons.service.ts` | Modified | Same. Deletes the `activeSource` lookup (REQ-12) and its local `sanitizeTag`/`episodeDisplayTitle`. The upload half (`startSeasonUpload`, `finishSeasonUpload`, `findSeasonWithEpisodes`) is untouched. |
| `src/shows/shows.service.ts` | Modified | Drops `search`/`cacheAndEnrich`/`enrichWithOwnership`/`cacheShows`/`cacheKey`; delegates. `getCachedShow` gains the write-back of REQ-7. Everything else untouched. |
| `src/downloads/downloads.service.ts` | Modified | Imports `sanitizeTag` instead of defining a fourth copy. Nothing else. |
| `src/movies/movies.module.ts`, `src/episodes/episodes.module.ts`, `src/seasons/seasons.module.ts`, `src/shows/shows.module.ts` | Modified | Import the new module(s) they need. `MediaModule` is **not** touched. |
| `src/movies/movies.service.spec.ts`, `src/episodes/episodes.service.spec.ts`, `src/seasons/seasons.service.spec.ts`, `src/shows/shows.service.spec.ts` | Modified | Only where they assert *structure* (a private method name, a mock shape). Every assertion about *behaviour* must keep passing unmodified — that is the whole regression argument. |

A new module not on this list means the plan missed something: report it rather than adding it.

## Existing code to reuse

- **`src/downloads/downloads.service.ts`'s `demoteDeliveredSources` and `hasDeliveredSource`** —
  `087` already extracted these out of the three copies and all three call them identically today.
  The shared attach calls them the same way. Do not reimplement either, and do not inline them back.
- **`src/clients/indexer/resolve-info-hash.ts`** — the lazy `infoHash` resolution all three copies
  already call. It moves into the shared body unchanged.
- **`src/clients/torrent/magnet.ts`'s `parseMagnet`** — stays in the three public
  `addMagnetTo*` methods, before the shared call, exactly as now: parsing is per-entry-point, not
  per-target.
- **`src/clients/torrent/client.ts`'s `add()`, `info()`, `start()` and the `TorrentCategory` type** —
  unchanged. The category is one member of `AttachTarget`.
- **`src/i18n/i18n-error.ts` and `src/i18n/error-keys.ts`** — every refusal goes through
  `i18nError.conflict`/`i18nError.notFound` with an existing key. `MAGNET_ALREADY_ATTACHED` and
  `MAGNET_ALREADY_ATTACHED_SEASON` both already exist; no key is added.
- **`src/media/media-capabilities.module.ts`** — the pattern `catalog-search.module.ts` copies, and
  the reason it exists. Its comment records it: `MediaModule` already imports `MoviesModule`, so a
  provider inside `MediaModule` that `MoviesModule` needs would be a cycle. `048` solved this by
  splitting a second module out of `media/` with no `forwardRef`. Do exactly that. **There is no
  `forwardRef` anywhere in this codebase** and introducing one is a stop-and-report.
- **`src/media/media-type.interface.ts` and `src/media/media-dispatch.service.ts`** — read-only here.
  `MoviesService` and `ShowsService` keep satisfying `MediaTypeService` by delegating `search` and
  `cacheAndEnrich`; the interface does not change and the descriptor never crosses it.
- **`src/media/media-search.service.ts` and `src/media/popular-media.service.ts`** — the two existing
  callers of `cacheAndEnrich`. Neither may learn that anything moved; both must keep compiling and
  passing untouched. They are the proof the delegation preserved the boundary.
- **`src/settings/settings.module.ts`** — exports `SettingsService`, `TmdbClient`, `ProwlarrClient`
  and `QbittorrentClient`. Both new modules get their clients from here; no new provider.
- **`src/pipeline-status/pipeline-status.ts`** — untouched. `deriveTitleStatus`,
  `deriveSourceStatus`, `isRaceWinner` and `deriveResume` keep their current inputs.

## Steps

1. **Fix the conflict scope in place, in both copies** (REQ-2, REQ-3). Widen
   `MoviesService.attachTorrentSource`'s and `EpisodesService.attachTorrentSource`'s colliding-source
   lookup to include `season: { include: { show: true } }`, and add the refusal — the same shape
   `SeasonsService` already has, with `MAGNET_ALREADY_ATTACHED_SEASON` and `{ show, number }`. In
   `EpisodesService`, also include `episode: { include: { season: { include: { show: true } } } }`
   so the holder is reachable, which step 2 needs. Do not restructure anything yet.

2. **Fix the conflict message** (REQ-4). `EpisodesService` interpolates the holding episode, from the
   include added in step 1, not the target episode it passes today.

3. **Fix the error record** (REQ-5). `MoviesService`'s main update-or-create clears `errorKey` and
   `errorParams` alongside `errorMessage`, matching its own reactivation branch three lines above and
   both other copies.

4. **Write the tests for steps 1–3** before going further (NFR-3). They are the net the collapse is
   measured against; written after, they would only prove the new structure agrees with itself.

5. **Delete the dead members** (REQ-12). `EpisodesService.findActiveSource` — no caller anywhere in
   `api`. `SeasonsService`'s `activeSource` lookup and the two `activeSource &&` gates it feeds, which
   only guard a call that is already a no-op when nothing is delivered.

6. **One definition of each helper** (REQ-11). Create `src/clients/torrent/tags.ts` and
   `src/episodes/episode-title.ts`; delete the four and three copies respectively and import. Run
   `bin/npm api test` here — this step alone must change nothing.

7. **Define `AttachTarget`** (REQ-10). Exactly four members, one per permitted variation: resolve the
   target and authorize the caller (returning the row, or the `not_found` key to raise); the refusal
   set (the conflict scope and the delivered/`COMPLETED` guard, which for a season counts its
   `COMPLETED` episodes); the tag list and category; and which column the `MediaSource` carries. No
   fifth member.

8. **Write `AttachSourceService`** with one body and no target branch: resolve `infoHash`, the no-op
   for a hash already on this target, the `COMPLETED`/delivered refusal, the reactivation branch for
   a hash qBittorrent still holds, `add()` before any write, `demoteDeliveredSources` on `force`
   after `add()` succeeded, then the update-or-create. Preserve the ordering exactly: `add()` before
   the demotion before the write, so a rejected `add()` leaves the previous source untouched.

9. **Move the three services onto it.** Each keeps its two public methods and its `parseMagnet` call,
   builds its descriptor, and delegates. Each keeps reading its own return shape afterwards —
   `movie.findUniqueOrThrow`, `episode.findUniqueOrThrow`, `findSeasonWithEpisodes` — because the
   GraphQL return types differ and that read is the resolver's contract, not the attach's. Keep the
   `DOWNLOADING` write on the target exactly as it is (§ Contract Freeze in `../plan.md`).

10. **Wire the module** and delete the three `attachTorrentSource` bodies. `bin/npm api test` must
    pass with every behavioural assertion in the three existing spec files unmodified.

11. **The catalog collapse** (REQ-6). `catalog-descriptor.ts`, then `catalog-search.service.ts`
    holding the single search + cache-write + enrichment, then `catalog-search.module.ts`. Delete the
    five members from each of `MoviesService` and `ShowsService` and delegate. The cache write must
    stay strictly **before** enrichment — the ordering `026` extracted the method to protect.

12. **REQ-7**: `getCachedShow` writes back what `fetchShowFromTMDB` returned, the way
    `getCachedMovie` already does. Leave `deriveContentKind` alone; its divergence is settled
    elsewhere (`../spec.md` § Out of Scope).

13. **NFR-4 and NFR-5.** Remove every comment that only cross-referenced a twin — the "structural
    twin of …", "kept local rather than shared", "symmetric with the check … now does" paragraphs and
    the orphaned "Demote *before* creating the replacement" prose beside `087`'s locator in all three
    — replacing with a `// Spec NNN, <ref>` locator where a locator is warranted. Translate the two
    Spanish Redis log strings in the cache helpers to English. `bin/comments api` must exit 0.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is read-only. What `api` owes:

- **The SDL is unchanged.** All six mutations keep their exact signatures, including
  `force: Boolean = false` on every one of them, and their return types. `searchMedia` is unchanged.
  No `@Field`, `@ObjectType` or `@InputType` decorator changes, so `src/schema.gql` must come out of
  this feature **byte-identical**. If it regenerates differently, something changed that should not
  have (Article IV, Article VIII).
- **Two new refusals must be produced**, both with keys that already exist:
  `addTorrentToMovie`/`addMagnetToMovie`/`addTorrentToEpisode`/`addMagnetToEpisode` must throw
  `i18nError.conflict(ERROR_KEYS.MAGNET_ALREADY_ATTACHED_SEASON, { show, number })` when the
  `infoHash` belongs to a season.
- **One refusal changes its params, not its key**: the episode-to-episode collision keeps
  `MAGNET_ALREADY_ATTACHED` and must now interpolate the **holding** episode's
  `<Show> SxxEyy`.
- **Every other refusal stays exactly as it is**, by key and by params:
  `error.movie.not_found`, `error.episode.not_found`, `error.season.not_found`, the three
  `already_completed` keys, `error.magnet.invalid`, `error.indexer.no_infohash`,
  `error.download.torrent_client_rejected`.
- **The six public service method names survive**, because `src/scheduler/tasks/acquire-movies.task.ts`
  and `acquire-episodes.task.ts` call two of them directly, outside any resolver. A rename breaks two
  scheduled sweeps with no compile error in any resolver.

## Tests

Owed under Article IX — each file opens with the paragraph naming the failure it defends against:

- **`src/acquisition/attach-source.service.spec.ts`** — defends against the two failures that produce
  no error anywhere. First: a `MediaSource` written with two target columns set, which every consumer
  downstream reads as one target and silently mis-routes (`worker`'s `source-ready.job.ts` reads
  `movieId`, `resolveRace` takes the first non-null, `sourceScanned` resolves one). Second: a
  cross-target collision accepted instead of refused, which is how the first one happens. Cover all
  six holder/target combinations, including the holder-in-`ERROR` case REQ-9 pins as still refused.
- **`src/episodes/episode-title.spec.ts`** — defends against the one definition drifting from the
  format `web`'s `SearchTorrent.tsx` prefill builds. Nothing errors when they disagree; the user sees
  a conflict message naming an episode differently from the search box that produced it. Pin the
  zero-padding on both numbers.
- **`src/media/catalog-search.service.spec.ts`** — defends against the cache write losing its
  position before enrichment, which writes one caller's `inLibrary`/`mediaId` into a shared Redis
  entry and leaks that user's library into every other user's cached search results. This is the
  exact trap `026` extracted `cacheAndEnrich` to avoid. Assert the cached payload carries neither
  field, and assert the write happens before enrichment rather than inferring it.

Extended, not created: the three existing attach spec files keep every behavioural assertion. Where
one asserts a private method name or a mock shape that the collapse changes, update that assertion
and nothing else — a behavioural assertion rewritten to fit the new structure is the regression
escaping.

**Not owed, with reasons.** `sanitizeTag`'s relocation is a pure move of a byte-identical function
whose four call sites are already covered by their own services' specs; a test for it would assert
`String.replace`. The module wiring fails loudly at boot, not silently. The comment removals and the
two log-string translations are enforced by `bin/comments api` and by reading, not by tests. REQ-7's
write-back is a cache optimisation whose failure mode is an extra TMDB call, which is slow, not
wrong — AC-9 covers it from outside.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/comments api
```

All three exit 0, and:

```bash
git diff --stat services/api/src/schema.gql
grep -rn "function sanitizeTag" services/api/src
grep -rn "findActiveSource" services/api/src
```

`schema.gql` shows **no diff**, `sanitizeTag` returns exactly one hit, `findActiveSource` returns
nothing. Then `../plan.md` § Verification's invariant query and manual pass.

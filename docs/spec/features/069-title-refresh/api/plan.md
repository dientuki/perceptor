---
title: Title Refresh — api slice
service: api
last_updated: 2026-09-25
status: Implemented
---

# PLAN: Title Refresh — `api` (`api/plan.md`)

## Scope

`api` owns all of the feature's behaviour: the two mutations, the catalog re-read from TMDB, the
media-server index refresh and the bidirectional status sync, and REQ-17's change to how a title's
status is derived. It does **not** render anything or decide how outcomes are worded — `web` owns the
button and the copy. No Prisma migration.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/pipeline-status/pipeline-status.ts` | Modified | `deriveTitleStatus`: `SCANNED` sources and `COMPLETED` jobs contribute nothing (REQ-17); doc comment updated |
| `src/pipeline-status/pipeline-status.spec.ts` | Modified | Cases encoding the old rule rewritten; new REQ-17 cases |
| `src/media-server-index/media-server-index.service.ts` | Modified | New method that rebuilds and waits, or waits for an in-flight rebuild (REQ-6) |
| `src/media-server/media-server-reconcile.service.ts` | Modified | New `syncMovie`/`syncShow` (bidirectional, guarded, counted); shared private helpers with the existing `reconcile*` |
| `src/media-server/media-server-reconcile.service.spec.ts` | Modified | Cases for sync (see Tests) |
| `src/media/entities/title-refresh.entity.ts` | New | `TitleRefresh` object type + `RefreshCatalogOutcome`/`RefreshMediaServerOutcome` enums, registered with `registerEnumType` |
| `src/movies/movies.service.ts` | Modified | `refresh(id, userId)`; private catalog-refresh step |
| `src/movies/movies.resolver.ts` | Modified | `refreshMovie` mutation |
| `src/shows/shows.service.ts` | Modified | `refresh(id, userId)`; season/episode loop extracted out of `hydrate()` and shared |
| `src/shows/shows.resolver.ts` | Modified | `refreshShow` mutation |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | `MEDIA_REFRESH_IN_PROGRESS: 'error.media.refresh_in_progress'` + English text |
| `src/scheduler/tasks/refresh-movies.task.ts`, `refresh-shows.task.ts` | **Untouched** | Out of scope |

## Existing code to reuse

- `src/pipeline-status/pipeline-status.ts` — `deriveTitleStatus`/`deriveEpisodeStatus`/
  `isLiftedBySeasonPack`. The REQ-17 change goes here and nowhere else; do not add a second
  derivation for the refresh.
- `MoviesService.fetchMovieFromTMDB` + `TmdbClient.earliestMovieReleaseDate` — the exact fields
  `register()` writes. `releaseDate` = earliest release date, falling back to TMDB's `releaseDate`,
  same expression as `register()`.
- `ShowsService.fetchShowFromTMDB` — the series row. It throws `SHOW_NOT_IN_CATALOG` on a TMDB
  failure; the refresh catches that and reports `catalog: FAILED` rather than letting it escape.
- `ShowsService.hydrate()` — extract its `for (const season of detail.seasons)` loop into a private
  method both call. Behaviour of `hydrate()` must be unchanged (claim, `seasonsSyncedAt` only after
  the full loop, reconcile at the tail). The refresh sets `seasonsSyncedAt` too on a full success.
- `ShowsService.hydrateClaimKey()` + the `redis.set(..., 'EX', ttl, 'NX')` pattern in `hydrate()` —
  the refresh takes the **same** key for a series. For a film, a twin `movie:refresh:<tmdbId>` key
  with its own TTL constant (the `006` twins keep their own constants).
- `cacheMovies`/`cacheShows` — write the fresh entry back (REQ-4). For a film carry `runtime` and
  `genreIds` from the same `details()` response so the cache entry is not thinner than the top-up
  would leave it.
- `MediaServerReconcileService.client()` — the "no client / no host → nothing to reconcile" check is
  `SKIPPED`.
- `MediaServerIndexService.rebuild()` / `readState()` — rebuild is already fully awaited inside;
  when it cannot claim, it returns `readState()` immediately — that is the case the new method polls.
  A client with no `listLibrary` resolves natively: no rebuild, proceed.
- `MoviesService.findOneFromDb` / `ShowsService.findOneFromDb` — ownership gate. Follow `remove()`'s
  placement exactly: inside `MoviesService.refresh` for films, in `ShowsResolver.refreshShow` for
  series (the deliberate asymmetry noted there).
- `MediaCapabilitiesService.assertEnabled` — first line of each resolver, as `removeMovie`/`removeShow`.
- `i18nError.conflict(ERROR_KEYS.MEDIA_REFRESH_IN_PROGRESS)` for the lost claim.
- `src/media/entities/title-removal.entity.ts` — template for the new entity file.

## Steps

1. **REQ-17.** In `deriveTitleStatus`, skip sources whose status is `SCANNED` (alongside `ERROR`)
   and drop `COMPLETED` jobs from the job contribution: only `WAITING`/`QUEUED`/`ENCODING` jobs lift
   to `ENCODING`. Update the function's doc comment to say why (a finished run is history; the stored
   column is the delivered/missing truth). Do **not** touch `deriveSourceStatus`, `isRaceWinner`,
   `isLiftedBySeasonPack` or `toMediaStatus`. Rewrite the spec cases that asserted the old lift
   (e.g. column `MISSING` + `SCANNED` source + `COMPLETED` job → was `COMPLETED`, is now `MISSING`).
2. **Index freshness.** Add `MediaServerIndexService.refreshAndWait(clientId, config)` (name at the
   implementer's discretion) returning `'ready' | 'failed' | 'native'`: build the client; no
   `listLibrary` → `native`; otherwise call `rebuild()`; if the returned state is `syncing` (someone
   else holds the claim), poll `readState()` at a short interval until it is not `syncing`, bounded by
   `REBUILD_CLAIM_TTL_SECONDS`; final `ready` → `ready`, anything else → `failed`.
3. **Sync.** `MediaServerReconcileService.syncMovie(movieId, tmdbId)` and `syncShow(showId, tmdbId)`
   return `{ outcome, promoted, demoted }` and never throw (whole body try/catch → `FAILED`, counts 0).
   - `client()` null → `SKIPPED`.
   - Index freshness `failed` → `FAILED`, no writes.
   - Film: `findByTmdbId` → present → promote; absent → demote.
   - Series: `findByTmdbId` → absent → every episode is "not present"; present →
     `listPresentEpisodes` (a throw is `FAILED`, an empty list is a real answer); match by
     `(seasonNumber, episodeNumber)` as `reconcileShow` does.
   - **Promote** = `updateMany({ where: { id, status: 'MISSING', <in-flight guard> }, data: { status: 'COMPLETED' } })`.
   - **Demote** = `updateMany({ where: { id, status: 'COMPLETED', <in-flight guard> }, data: { status: 'MISSING', filePath: null } })`.
   - In-flight guard (both directions), as a Prisma relation filter in the same `where`:
     `mediaSources: { none: { status: { notIn: ['ERROR', 'SCANNED'] } } }` and
     `processJobs: { none: { status: { in: ['WAITING', 'QUEUED', 'ENCODING'] } } }`. For an episode that
     has aired (`releaseDate` ≤ now), also `season: { mediaSources: { none: { status: { notIn: ['ERROR', 'SCANNED'] } } } }`
     — the `059` lift expressed as a filter. Batch per series: one `updateMany` per direction over
     the list of candidate episode ids is fine as long as the guard stays in the `where`; for the
     aired/unaired split, two statements per direction.
   - Sum `count`s into `promoted`/`demoted`.
   Existing `reconcileMovie`/`reconcileShow` keep their promote-only behaviour and their callers.
4. **Entity.** `TitleRefresh { catalog, mediaServer, promoted, demoted }` and the two enums, exactly
   as `../spec.md` spells them (enum values `DONE`/`FAILED` and `DONE`/`SKIPPED`/`FAILED`).
5. **i18n key.** `MEDIA_REFRESH_IN_PROGRESS` in `error-keys.ts`, English message in `messages.en.ts`
   ("This title is already being refreshed, try again in a moment").
6. **Film refresh.** `MoviesService.refresh(id, userId)`: `findOneFromDb` → not found →
   `MOVIE_NOT_FOUND {id}`; claim `movie:refresh:<tmdbId>` or conflict; catalog step
   (`fetchMovieFromTMDB` + `earliestMovieReleaseDate`, `movie.update` of `title`, `overview`,
   `posterUrl`, `releaseDate`, `originalLanguage` only, `cacheMovies`) in try/catch → `DONE`/`FAILED`;
   `syncMovie`; `finally` delete claim.
7. **Series refresh.** Extract the season loop from `hydrate()`. `ShowsService.refresh(id)`: claim
   `hydrateClaimKey(tmdbId)` or conflict; catalog step (`fetchShowFromTMDB` → `show.update` of the
   same five fields; `tmdb.details` for the season list; shared loop; `seasonsSyncedAt`;
   `cacheShows`) in try/catch → `DONE`/`FAILED` (a throw mid-loop is `FAILED`, NFR-3); `syncShow`;
   `finally` delete claim. `ShowDetail` is fetched once and feeds both the row and the loop if its
   shape allows — at most 1 details call + 1 per season (NFR-1).
8. **Resolvers.** `refreshMovie(id: Int!)`/`refreshShow(id: Int!)` returning `TitleRefresh`, shaped
   like `removeMovie`/`removeShow` (capability check first, ownership as noted above). Boot the dev
   stack and confirm the regenerated `schema.gql` diff matches `../spec.md`.

## Contract obligations

Expose exactly `../spec.md` § GraphQL Contract Delta: `refreshMovie`, `refreshShow`, `TitleRefresh`,
`RefreshCatalogOutcome`, `RefreshMediaServerOutcome`. Error conditions, all through `i18nError`:
`error.movie.not_found {id}` (missing or foreign film), `error.show.not_available` (missing or foreign
series), `error.media.type_disabled` (via `assertEnabled`), `error.media.refresh_in_progress` (lost
claim, `ConflictException`). TMDB and media-server failures are **never** thrown — they are outcomes.
`promoted`/`demoted` are 0 unless `mediaServer` is `DONE`.

## Tests

Article IX — both units below fail with no error anywhere when wrong.

- `src/pipeline-status/pipeline-status.spec.ts` — defends against a finished pipeline run keeping a
  demoted title reading `COMPLETED`/`DOWNLOADED` (the refresh would look like a no-op) and, the other
  way, against an **active** job/source no longer lifting a title (a real download reading `MISSING`).
  Cases: column `MISSING` + `SCANNED` source + `COMPLETED` job → `MISSING`; column `COMPLETED` + same
  → `COMPLETED`; `SCANNED` source + `ENCODING` job → `ENCODING`; `READY` source, no jobs → `DOWNLOADED`;
  column `ERROR` still wins. Fault-inject by restoring the old job contribution.
- `src/media-server/media-server-reconcile.service.spec.ts` — defends against the silent mass
  demotion: `listPresentEpisodes` throwing, and index freshness `failed`, both produce `FAILED` with
  zero writes (assert no `updateMany` call); an empty present list demotes only `COMPLETED` episodes
  outside the guard; a demotion's `data` includes `filePath: null`; the `where` of every write carries
  the in-flight relation filter (fault-inject by dropping it); `SKIPPED` when no client. Mocked Prisma
  is acceptable here — the thing under test is which statements are issued with which `where`.
- `MediaServerIndexService` wait method — one case: claim held elsewhere, `readState` goes `syncing` →
  `failed` → result `failed`. A wait that returned `ready` on a failed rebuild would re-enable demotion
  against a stale index.
- **Not owed**: the catalog step (a TMDB failure there produces a visible `FAILED` and unchanged data;
  the upsert loop is `hydrate()`'s existing, unchanged code) and the resolvers (thin, same template as
  `067`'s, which are already covered for the ownership/capability order).

## Done when

```bash
bin/cli api npx --no tsc --noEmit        # 0 errors
bin/npm api test                         # all suites pass, count up from the last recorded 678/51
git status --short services/api/prisma   # empty
git diff services/api/src/schema.gql     # exactly the delta in ../spec.md
```

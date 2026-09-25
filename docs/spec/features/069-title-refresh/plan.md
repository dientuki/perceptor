---
title: Title Refresh — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-09-25
status: Implemented
---

# PLAN: Title Refresh (`plan.md`)

## Approach

Everything load-bearing lives in `api`; `web` adds one button and two server actions.

**Catalog step.** Registration already knows how to read a title from TMDB and write it — this
feature reuses those paths rather than writing a third. For a film, `MoviesService.fetchMovieFromTMDB`
plus `TmdbClient.earliestMovieReleaseDate` produce exactly the fields `register()` writes. For a
series, the season/episode loop inside `ShowsService.hydrate()` (sequential, season 0 included,
`releaseDate: undefined` when TMDB has none — which is already REQ-3's "never erase a known date") is
extracted into one private method both `hydrate()` and the refresh call. `fetchShowFromTMDB` gives
the series row. The refreshed entry is written back into the Redis catalog cache through the existing
`cacheMovies`/`cacheShows` (REQ-4).

**Concurrency (REQ-15).** A series refresh takes the **same** Redis claim `hydrate()` already uses
(`show:hydrate:<tmdbId>`, `SET NX EX`): one key means a refresh and a background hydration exclude
each other with no new mechanism, and a lost claim is the `error.media.refresh_in_progress` conflict.
A film refresh takes the twin key `movie:refresh:<tmdbId>`. Both are deleted in `finally`.

**Media-server step.** `MediaServerReconcileService` (`034`) already owns "ask the configured
server whether it holds this title". It gains two methods, `syncMovie`/`syncShow`, that return an
outcome (`DONE`/`SKIPPED`/`FAILED`) plus promoted/demoted counts, and write in both directions. The
existing `reconcileMovie`/`reconcileShow` stay as they are — registration must keep promoting only —
but share the private client resolution and lookup. Index freshness (REQ-6) is a new method on
`MediaServerIndexService` that either runs `rebuild()` itself (already awaitable; only its callers
detach it) or, when another rebuild holds the claim, polls `readState()` until it leaves `syncing`,
bounded by the claim's own TTL. `failed` or the bound elapsing → `FAILED`, and no status is written
(REQ-12).

**Guarded writes (REQ-9).** Promotion and demotion are each one `updateMany` whose `where` carries
the whole guard: the expected stored status, **and** a relation filter that no in-flight source or
job exists (`mediaSources: { none: { status: { notIn: ['ERROR', 'SCANNED'] } } }`, `processJobs:
{ none: { status: { in: ['WAITING', 'QUEUED', 'ENCODING'] } } }`; for an episode, also no unscanned,
non-`ERROR` season-pack source on its season when the episode has aired — `059`'s lift). Guard and
write are one statement, so a `torrentCompleted`/`encodeCompleted`/new source landing mid-refresh
turns the write into a no-op instead of being overwritten. `updateMany`'s `count` is what feeds
`promoted`/`demoted`. Demotion also sets `filePath: null` (REQ-10).

This is deliberately **stricter** than REQ-9's wording ("derived status is not in flight"): `043`'s
derivation takes the maximum, so a stored-`COMPLETED` title with a forced re-download in progress
derives `COMPLETED`, and a derived-status check alone would demote it mid-download. REQ-9 states a
necessary condition; skipping more is compliant.

**REQ-17, the derivation change.** `deriveTitleStatus` stops letting a finished run contribute: a
`SCANNED` source contributes nothing (its jobs carry its state — `sourceScanned` creates the jobs in
the same transaction that writes `SCANNED`, so a `SCANNED` source always has jobs or went `ERROR`),
and a `COMPLETED` job contributes nothing. Active jobs still lift to `ENCODING`; `QUEUED`/`PAUSED`/
`DOWNLOADING`/`READY` sources still lift as before. This is the only change to shared derivation, and
it lives in the one pure module every reader already goes through (`pipeline-status.ts`), so listings,
detail pages, the calendar and `recomputeMovieStatus`/`recomputeEpisodeStatus` all move together.
`deriveSourceStatus` (the per-row `/downloads` altitude) is **not** changed — a finished source row
still reads `COMPLETED` in the downloads panel; only the title's status stops inheriting it.

Alternative rejected: grouping jobs by source to decide "this run is finished". `043`'s plan
denormalized `processJobs` onto the title precisely to avoid that join, and the simpler rule is
equivalent given the scan transaction invariant above.

**Orchestration.** `MoviesService.refresh(id, userId)` / `ShowsService.refresh(id, userId)`: ownership
check (existing `findOneFromDb`), claim, catalog step in its own try/catch, media-server step (which
never throws — same stance as `034`'s NFR-1), release claim, return `TitleRefresh`. The resolvers
mirror `removeMovie`/`removeShow`: `assertEnabled` first, then the ownership gate in the place each
resolver already puts it. `TitleRefresh` and its two enums sit next to `TitleRemoval` in
`src/media/entities/`.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` — REQ-17 derivation change in `pipeline-status.ts` + its spec | Independent of everything else, and the riskiest behavioural change; landing it first lets the rest be tested against the new rule |
| 2 | `api` — index freshness + `syncMovie`/`syncShow` | Needs step 1's guard semantics |
| 3 | `api` — catalog refresh, `refresh()` orchestration, resolvers, entity, i18n key | Produces the `schema.gql` the contract freeze checks |
| 4 | `web` — actions, `RefreshTitleButton`, messages | Consumes the frozen contract |

Step 4 can run **in parallel** with steps 1–3: the contract below is frozen, and `web` retypes it by
hand anyway. It only needs a running `api` for the manual pass.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an implementer
will be tempted to change and must not:

- **Returning the refreshed `Movie`/`Show` from the mutation.** Looks convenient from `web`; the spec
  deliberately returns only `TitleRefresh` and has `web` reload the page (`router.refresh()`).
- **Throwing on a TMDB or media-server failure.** Both are `FAILED` outcomes on a successful response
  (REQ-11). An `api` implementer who "surfaces the error properly" breaks `web`'s ability to report
  the other step's result.
- **Collapsing `refreshMovie`/`refreshShow` into one `refreshMedia(type, id)`.** The per-type twins
  are the `006` rule, and `067` just followed it.
- **Adding an `episodesAdded` count** or similar. Not in the contract; `web` shows what the page shows.
- **Re-deriving `isShort`/`contentKind` "while we have the details anyway".** REQ-5.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief both services.

## Migrations

None. Every column written (`title`, `overview`, `posterUrl`, `releaseDate`, `originalLanguage`,
`status`, `filePath`, `seasonsSyncedAt`, `Season`/`Episode` rows) already exists (NFR-4). No backfill:
REQ-17 changes a read-time derivation, and every delivered title already stores `COMPLETED` because
`encodeCompleted` writes it.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Demotion on a stale or half-read media server | A server hiccup or a failed index rebuild reads as "holds nothing" and mass-demotes a whole series to `MISSING`, silently | REQ-12: `FAILED` outcome writes nothing. `syncShow` must distinguish `listPresentEpisodes` throwing from returning `[]`, and index state `failed`/timeout from `ready`. Test owed (api plan) |
| REQ-17 changes a title's status nobody refreshed | A title whose stored status is not `COMPLETED` but whose finished job was lifting it — e.g. a race loser's late `encodeCompleted` that skipped the title write (`sourceDemoted`) — now reads lower | By construction `encodeCompleted` stores `COMPLETED` on every real delivery; the loser case is exactly the one that should not read `COMPLETED` from the loser's job. AC-5c is the live check; api's existing `pipeline-status.spec.ts` cases that encode the old rule are rewritten, not deleted, so the change is visible in the diff |
| Guard checked, then write races | A source added between the check and the demote clears `filePath` of a title that is being re-acquired | Guard lives inside the `updateMany` `where` — one statement. Test owed: fault-inject by removing the relation filter |
| Demotion leaves `filePath` set | `recomputeMovieStatus` sees `filePath` and silently re-promotes on the next source event; the button looks like it worked, then undoes itself | REQ-10; test asserts `filePath` is null after demotion |
| Refresh and background hydrate overlap | Two writers upsert the same episodes; harmless data-wise, but two TMDB bursts | Shared claim key; conflict error on the loser |
| Index rebuild wait hangs the request | Another rebuild stuck in `syncing` (process died, claim not yet expired) keeps the mutation open | Bounded poll; bound elapsing is `FAILED`. `readState()` already derives `syncing` from the live claim, not the stored row |
| Cache overwritten with a thinner entry | `cacheMovies` writes the whole object; dropping `genreIds`/`keywordIds` costs one extra TMDB call at the next registration of the same film | Acceptable (idempotent top-up); api plan carries `runtime`/`genreIds` from the same details response so the common case loses nothing |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
git status --short services/api/prisma          # empty — no migration
git diff services/api/src/schema.gql            # exactly refreshMovie, refreshShow, TitleRefresh, RefreshCatalogOutcome, RefreshMediaServerOutcome
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs     # no en/es drift
```

Manual pass, against `bin/dev` with Jellyfin configured:

1. AC-1/AC-2: hand-edit a film's `overview` and delete/blank episode rows with `bin/mysql`, press
   Refresh on each detail page, confirm restored.
2. AC-3: reclassify a film as short + `ANIME`, refresh, `bin/mysql -e "select isShort, contentKind from movies where id=…"` unchanged.
3. AC-4: register a film, copy its file into the Jellyfin library, let Jellyfin scan, refresh →
   `COMPLETED`, Settings shows a new index sync time.
4. AC-5/AC-5b: remove an episode and a Perceptor-encoded film from Jellyfin, refresh → `MISSING`,
   `filePath` NULL, `processJobs.outputFilePath` intact, adding a new torrent to the film no longer asks
   for `force`.
5. AC-5c: a delivered, never-refreshed title still reads `COMPLETED` on `/movies`, `/shows/<id>`,
   `/calendar`.
6. AC-6: an episode with a live torrent, absent from Jellyfin, refresh → still `DOWNLOADING`.
7. AC-7: `docker stop` Jellyfin, refresh → warning, `mediaServer: FAILED`, nothing demoted.
8. AC-8: invalid TMDB key in Settings, refresh → catalog failed warning, fields unchanged.
9. AC-9: `media_server_client = none` → `SKIPPED`, no error shown.
10. AC-10: two tabs, refresh a series in both at once → one conflict message, in Spanish under `es`.
11. AC-11: `refreshMovie` from a second user via the GraphQL playground → `error.movie.not_found`.

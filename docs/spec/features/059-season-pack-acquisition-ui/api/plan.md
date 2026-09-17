---
title: Season Pack Acquisition UI — api slice
service: api
last_updated: 2026-09-17
status: Implemented
---

# PLAN: Season Pack Acquisition UI — `api` (`api/plan.md`)

## Scope

`api` adds one mutation, `addTorrentToSeason`, and makes `show(id)` derive every aired episode of a
season with an unscanned pack in flight as at least `QUEUED`. It does **not** touch the season pack
pipeline after download (`sourceScanned`, `handleTorrentCompleted`, cleanup), the downloads panel,
`Show.status`, the Prisma schema, or any stored `Episode.status` write. `web` owns the buttons,
modals and translations.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/seasons/seasons.service.ts` | Modified | `addTorrentToSeason` public method |
| `services/api/src/seasons/seasons.resolver.ts` | Modified | `addTorrentToSeason` mutation |
| `services/api/src/seasons/seasons.service.spec.ts` | Modified | cases for the new method |
| `services/api/src/pipeline-status/pipeline-status.ts` | Modified | season-pack lift predicate |
| `services/api/src/pipeline-status/pipeline-status.spec.ts` | Modified | cases for the predicate |
| `services/api/src/shows/shows.service.ts` | Modified | season `mediaSources` include; one private episode-status mapper used by `findOneFromDb` and `setContentKind` |
| `services/api/src/shows/shows.service.spec.ts` | Modified | lift cases through `findOneFromDb` |
| `services/api/src/schema.gql` | Regenerated | one added mutation — never hand-edited (Article IV) |

## Existing code to reuse

- `src/episodes/episodes.service.ts` `addTorrentToEpisode` — the exact shape to twin: `infoHash ??
  (await resolveInfoHash(urls))`, then `attachTorrentSource` with `kind: 'TORRENT_SEARCH'`.
- `src/episodes/episodes.resolver.ts` `addTorrentToEpisode` — the resolver argument list to twin
  (nullable `infoHash`/`releaseTitle`, `urls: [String]`, `force` default `false`,
  `principal.type === 'user' ? principal.id : ''`). Description string:
  `Envía un release elegido a qBittorrent y lo asocia a la temporada`.
- `src/seasons/seasons.service.ts` private `attachTorrentSource` — already does ownership, the
  `COMPLETED`-episode conflict, the infoHash collision checks, `qbittorrent.add` before any write,
  demote-then-create, tags, and returns the season with episodes. Call it; change nothing in it.
- `src/clients/indexer/resolve-info-hash.ts` — throws the keyed `error.indexer.no_infohash` itself;
  let it propagate.
- `src/pipeline-status/pipeline-status.ts` `deriveTitleStatus` — unchanged; the lift is fed to it
  as one extra `{ status: 'QUEUED' }` source.

## Steps

1. **`addTorrentToSeason`** in `SeasonsService`, twin of `EpisodesService.addTorrentToEpisode`.
   Must resolve the `infoHash` before `attachTorrentSource`, so an unresolvable release never
   reaches qBittorrent (AC-4).
2. **Resolver** in `SeasonsResolver`, twin of `EpisodesResolver.addTorrentToEpisode`, no
   `@AllowService()`. Boot once so `schema.gql` regenerates; confirm its diff is exactly the SDL in
   `../spec.md`.
3. **Lift predicate** in `pipeline-status.ts`: a pure exported function taking the season's sources
   (`{ status: SourceStatus }[]`), the episode's `releaseDate: Date | null` and `now: Date`, returning
   whether the episode is lifted. True iff some source status is neither `ERROR` nor `SCANNED`, and
   `releaseDate !== null && releaseDate <= now`. `now` is a parameter so the function stays pure and
   testable without fake timers.
4. **`ShowsService`**: add `mediaSources: { where: { status: { not: 'ERROR' } } }` to the season
   level of the include in both `findOneFromDb` and `setContentKind`. Replace the two identical
   `seasons.map(... deriveTitleStatus ...)` blocks with one private method that, per episode, calls
   `deriveTitleStatus` with the episode's own sources plus `{ status: 'QUEUED' }` when the predicate
   holds (one `new Date()` per call, not per episode). Do not write the lift anywhere.
5. Leave untouched, and confirm in the diff: `DownloadsService` (`recomputeEpisodeStatus`,
   `handleTorrentCompleted`), `MediaSourcesService.sourceScanned`, `prisma/`.

## Contract obligations

Expose exactly the delta in `../spec.md` § GraphQL Contract Delta:
`addTorrentToSeason(seasonId: Int!, infoHash: String, urls: [String!]!, releaseTitle: String, force: Boolean = false): Season!`,
with every refusal in its error table surfacing through the already-existing keyed errors
(`error.season.not_found`, `error.season.already_completed`, `error.magnet.already_attached`,
`error.download.torrent_client_rejected`, `error.indexer.no_infohash`). No new error key.
`Episode.status` on `show(id)` (and on `setShowContentKind`'s return) follows REQ-7.

The delta is read-only. If it is wrong, stop and report.

## Tests

- `src/pipeline-status/pipeline-status.spec.ts` — a new `describe` for the predicate. Defends
  against the silent failure where a pack in `READY`/`PAUSED` (or any unscanned state) stops lifting
  and episodes drop to `MISSING` mid-flight, or a `SCANNED`/`ERROR` pack keeps lifting forever so
  unmatched episodes never return to `MISSING` (AC-7/AC-8). Cases: each unscanned `SourceStatus`
  lifts; `SCANNED` and `ERROR` do not; no sources does not; future `releaseDate` does not; null
  `releaseDate` does not; `releaseDate === now` does.
- `src/shows/shows.service.spec.ts` — in the existing `findOneFromDb` block, following the "Daredevil"
  case's style: an aired `MISSING` episode under a `DOWNLOADING` season source reads `QUEUED`; a
  future one reads `MISSING`; a `COMPLETED` one stays `COMPLETED`; a stored `ERROR` one stays
  `ERROR`; a `SCANNED` season source lifts nothing. Plus one assertion that the season include
  carries `mediaSources` filtered to non-`ERROR`. Defends against the lift being dropped from the
  reader with no error (the page just shows `MISSING`).
- `src/seasons/seasons.service.spec.ts` — `addTorrentToSeason`: a null `infoHash` whose resolution
  throws must reject **without** calling `qbittorrent.add` or any `mediaSource` write (AC-4's
  silent-orphan failure); a supplied `infoHash` creates the source with `kind: 'TORRENT_SEARCH'` and
  `seasonId`. Mock `resolveInfoHash` the way `episodes.service.spec.ts` does, if it does; otherwise
  `jest.mock` the module. Verify each case fails when its rule is removed (fault injection).
- The resolver is not owed a test: it is a pass-through twin whose only failure (wrong argument
  wiring) is loud at the GraphQL layer.

## Done when

```bash
bin/cli api npx --no tsc --noEmit        # 0 errors
bin/npm api test                         # all pass, count above 517/46
git status --short services/api/prisma   # empty
git diff services/api/src/schema.gql     # exactly one added mutation, addTorrentToSeason
```

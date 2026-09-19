---
title: Global Downloads Page and Sidebar Badge — api slice
service: api
last_updated: 2026-09-19
status: Approved
---

# PLAN: Global Downloads Page and Sidebar Badge — `api` (`api/plan.md`)

## Scope

`api` exposes the installation-wide `downloads` query, the `activeDownloadCount` query, and the three
new `Download` fields (`showId`, `showTitle`, `owned`) on every query and mutation that returns a
`Download`. It does **not** group, filter or paginate — that is `web`'s, over the unpaginated list.
It does **not** change the ownership rules of `downloadStart`/`downloadStop`/`downloadDelete`
(NFR-5). No Prisma change (NFR-1).

Writes are confined to `services/api/` and this directory.

Precondition: `063-downloads-panel-filters` is implemented (its `byLastActivity`, `seasonNumber` and
language-neutral `seasonLabel` are in `downloads.service.ts`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/downloads/entities/download.entity.ts` | Modified | `showId: Int` (nullable), `showTitle: String` (nullable), `owned: Boolean!` |
| `services/api/src/downloads/downloads.service.ts` | Modified | Shared target projection; `downloads()`; `activeDownloadCount()`; fill the new fields everywhere |
| `services/api/src/downloads/downloads.resolver.ts` | Modified | Two `@Query`s, user-facing (no `@AllowService()`) |
| `services/api/src/downloads/downloads.service.spec.ts` | Modified | NFR-6 cases |
| `services/api/src/schema.gql` | Regenerated | Never hand-edited (Article IV) |

## Existing code to reuse

- `DownloadsService.jobsBySourceId(ids)` — one job query for all listed sources (NFR-3). Pass every
  source id of the global list.
- `DownloadsService.liveInfoByHash(tag)` — make the tag optional and call `qbittorrent.info()`
  untagged for the global list; keep its try/log/empty-map posture (NFR-4). Do not add a second
  "read all torrents" helper next to `liveInfoForHash`.
- `DownloadsService.liveFor(source, live)` — the only join between a source and the live map.
- `DownloadsService.toDownload(...)` — the only place status/progress/speeds are derived (REQ-4).
  Extend its inputs rather than building a `Download` anywhere else.
- `byLastActivity()` (from `063`) — the order for the global list, applied over all sources at once.
- `episodeLabel()` / `seasonLabel()` — the label strings, unchanged.
- `findOwnedSource()`'s include shape (`users: { where: { userId } }` on `movie`, `season.show`,
  `episode.season.show`) — the ownership test, now also used in the list `findMany`.
- `@CurrentUser()` + `principal.type === 'user' ? principal.id : ''` in the resolver — same as the
  existing queries.

## Steps

1. **Entity.** Add the three fields to `Download` (`showId` `Int` nullable, `showTitle` nullable,
   `owned` `Boolean`).
2. **Shared target projection.** Replace the inline label logic in `movieDownloads`/`showDownloads`
   and `labelFor()` with one private function that, given a source loaded with its movie / season →
   show / episode → season → show (each title with `users` filtered to the caller), returns
   `{ label, seasonNumber, showId, showTitle, owned }`. `owned` is "the film's (or the show's) filtered
   `users` is non-empty". `seasonNumber` stays non-null only for season-pack rows (`063` contract).
   `toDownload` takes that object instead of the separate `label`/`seasonNumber` args.
3. **Existing readers.** `movieDownloads`, `showDownloads`, `downloadStart`, `downloadStop` go through
   the projection; for them `owned` is `true` by construction (they already refused non-owned
   titles) — either load with the same include or pass `true`, but `showDownloads` **must** fill
   `showId`/`showTitle` (the show page stops passing its own title).
4. **`downloads(userId)`.** `mediaSource.findMany` with no `where`, including the projection's
   relations; then in parallel `liveInfoByHash()` (untagged), `jobsBySourceId(allIds)`,
   `compressionEnabled()`; then `byLastActivity` and map through the projection and `toDownload`.
   Exactly one qBittorrent call (NFR-2).
5. **`activeDownloadCount(userId)`.** Build the list with step 4's method and count distinct title
   keys — `movie:<movieId>` or `show:<showId>` — over rows whose `status` is `QUEUED`, `DOWNLOADING`,
   `DOWNLOADED` or `ENCODING`. Keep the active set a module-level constant next to the service, not
   an inline literal repeated.
6. **Resolver.** `@Query(() => [Download], { name: 'downloads' })` and
   `@Query(() => Int, { name: 'activeDownloadCount' })`, both with `@CurrentUser()`, no
   `@AllowService()`, no ownership refusal (REQ-2).
7. **Regenerate** `schema.gql` by booting the dev server (it regenerates on boot) and confirm the
   diff is exactly the spec's delta.
8. **Tests** (below).

## Contract obligations

Expose exactly `../spec.md` § GraphQL Contract Delta: `Download.showId: Int`, `Download.showTitle:
String`, `Download.owned: Boolean!`, `Query.downloads: [Download!]!`, `Query.activeDownloadCount:
Int!`. No arguments on either query. Errors: none new — qBittorrent unreachable is not an error on
either query (rows with null live fields; count computed with `live: null`), auth is the global
guard's, and the three mutations keep `error.source.not_found` for a foreign source unchanged. The
delta is read-only; if it is wrong, stop and report.

## Tests

`services/api/src/downloads/downloads.service.spec.ts` (existing suite, already opened with an
Article IX header — extend the header by one sentence naming the two new silent failures):

- `activeDownloadCount` — three films × two active sources → `3`; one show with an active season pack
  and two active episodes → `1`; a film whose only source is paused (live state paused) → not
  counted; a `COMPLETED`/`ERROR`-only title → not counted. Defends against a badge that silently
  disagrees with the page.
- `downloads` — the same source reads `owned: true` for a caller in the title's `users` and `false`
  for one who is not; a season-pack row carries `showId`/`showTitle`; exactly one `qbittorrent.info`
  call regardless of source count, called without a tag.
- `showDownloads` — season and episode rows carry `showTitle` (guards the show-page regression).

Not owed a test: the resolver wiring (two one-line delegations, covered by the manual pass) and the
entity decorators (covered by the `schema.gql` diff check).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
git status --short services/api/prisma
git diff services/api/src/schema.gql
```

0 typecheck errors; suite green including the new cases; `prisma` status empty; `schema.gql` diff is
exactly the five additions above.

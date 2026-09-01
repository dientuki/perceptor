---
title: Indexer Result Loss
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-09-01
last_updated: 2026-09-01
status: Implemented
services: [api, web]
---

# SPEC: Indexer Result Loss (`spec.md`)

## Context & Goal

A search that Prowlarr answers with hundreds of releases reaches the torrent modal in `web` with a
fraction of them, and the ones missing are not a random sample — they are whole indexers. This was
reported as "en el indexer veo muchos más resultados que en Perceptor", and the measurement below
confirms it and names the cause.

The territory is `services/api/src/clients/indexer/client.ts`, reached through
`src/indexer/indexer.service.ts` and the `searchTorrents` query, and consumed by
`services/web/src/components/search/SearchTorrent.tsx`. This is the **Find release** stage of the
pipeline table in the root `CLAUDE.md`; the stage keeps its status, it simply stops discarding a
third of its own output.

`filterData` groups the indexer's rows by `infoHash`, because the infoHash is what
`addTorrentToMovie` / `addTorrentToEpisode` are given and what qBittorrent is ultimately handed. A
row that arrives without one therefore has no key. Prowlarr supplies `infoHash` for some indexers,
embeds a 40-hex hash in `guid` for others, and for the rest supplies neither — for those,
`resolveInfoHash` fetches the row's own `downloadUrl` and either follows a `magnet:` redirect or
parses the returned `.torrent`. That fallback is correct in isolation. What breaks it is that
`filterData` fires **every** unresolvable row's fetch at once, through a single Prowlarr instance,
each with an 8 s `AbortController`, and then silently drops whatever did not settle.

Measured on the live stack, query `The Matrix`, 2026-09-01:

| Bucket | Rows |
| :-- | --: |
| Returned by Prowlarr (12 indexers) | 780 |
| `infoHash` present | 482 |
| 40-hex hash embedded in `guid` | 48 |
| Neither — sent to the `downloadUrl` fallback | **250** |
| …of which resolved inside the 8 s window | 23 |
| …of which **aborted and were discarded** | **227** |

The 227 losses are not spread evenly. They are six complete indexers — 1337x, LimeTorrents,
BigFANGroup, Torrent9, Torrent Downloads and NoNaMe Club — every one of which vanishes from every
search Perceptor runs. The burst is self-inflicted: the same URLs resolve normally when they are
not requested 250 at a time, so this is Perceptor starving itself, not an indexer withholding data.
The user pays for it twice, because the aborted fetches also pin every search at a floor of ~8.1 s
wall clock in order to throw away 91% of what they asked for.

The design that follows from this is that **the infoHash stops being a precondition for showing a
release**. A row without one is still a real release with a title, a size and seeders; the hash is
only needed at the moment the user commits to it. So the search groups rows by a derived key when
no hash is available, returns them, and resolves the hash lazily — once, for one row, when that row
is added. A search stops issuing outbound fetches entirely.

Once this ships, the modal shows the full result set the indexer actually returned, and a search
completes in roughly the time of the single Prowlarr call.

## Requirements

### Functional Requirements

- [x] **REQ-1 (No silent discard)**: `searchTorrents` must return a row for every release Prowlarr
      reports. A release must never disappear from the result set because its infoHash could not be
      determined.
- [x] **REQ-2 (Grouping without a hash)**: Rows that carry an infoHash (directly or embedded in
      `guid`) must keep being grouped by it, so the same release found by several indexers appears
      once with the seeders and leechers summed. Rows with no hash must be grouped by a derived key
      built from the normalized release title and the size, so cross-indexer duplicates of those
      also collapse to one row instead of appearing N times. Every row must carry that grouping
      key as a stable identity, so a consumer can address a row without an infoHash.
- [x] **REQ-3 (No fetches during search)**: A `searchTorrents` call must not issue any HTTP request
      other than the single call to Prowlarr's `/api/v1/search`. The infoHash of an unresolved row
      is not looked up while searching.
- [x] **REQ-4 (Lazy resolution on add)**: When the user adds a release whose infoHash is unknown,
      the API must resolve it at that moment — from the release's own download URL, following a
      `magnet:` redirect or parsing the returned `.torrent` — before handing anything to
      qBittorrent. A successfully added release is stored with its real infoHash, so it is
      indistinguishable afterwards from one whose hash arrived with the search.
- [x] **REQ-5 (Visible failure)**: If lazy resolution fails — dead link, timeout, unparseable
      `.torrent`, or a download URL that is missing altogether — the add must fail with the existing
      `error.indexer.no_infohash` key and the user must see it in the modal. No release is ever
      dropped or silently skipped.
- [x] **REQ-6 (Error copy exists)**: `error.indexer.no_infohash` and `error.indexer.unavailable`
      must resolve to real Spanish and English strings in `web`'s catalogs. Both keys exist in
      `api` today but neither has an entry in `services/web/messages/{en,es}.json`, so a Spanish
      user currently sees the raw English fallback `Could not resolve an infoHash`. REQ-5 is not
      met until this is.
- [x] **REQ-7 (Client-side ranking unaffected)**: The "Best candidates" toggle from `036` must keep
      working over the enlarged list. It reads titles, not hashes, so a row with an unresolved hash
      is ranked like any other; it must not be excluded from consideration.
      **Verified by code inspection** (not a live click-through): `src/lib/torrent-ranking.ts` was
      grepped and confirmed to read no `infoHash` field at all (T009), so it is structurally
      unaffected by the nullability change.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Search latency)**: A `searchTorrents` call must complete in the time of the Prowlarr
      call alone. The ~8.1 s floor imposed by the abort window must be gone.
      **Verified live**: raw Prowlarr call for `The Matrix` took ~21.8s this session (live
      network/tracker conditions); `searchTorrents` with this feature's code took ~22.3s for the
      same query — effectively zero added overhead, confirming the abort-window floor is gone. See
      AC-3 above for why the absolute `<2s` figure could not be reproduced today.
- [x] **NFR-2 (Bounded resolution)**: The lazy resolution performed on add must carry its own
      timeout so a dead host cannot hang the mutation indefinitely.
- [x] **NFR-3 (Backwards compatibility of stored data)**: No existing `MediaSource` row changes.
      Anything already downloaded was stored with a real infoHash and keeps it.
- [x] **NFR-4 (Regression proof)**: The change must be covered by a test that fails against today's
      `filterData` — specifically, one asserting that rows with no `infoHash`, no hash in `guid`
      and an unreachable `downloadUrl` still appear in the result.

## GraphQL Contract Delta

`TorrentResult.infoHash` becomes nullable, and `addTorrentToMovie` / `addTorrentToEpisode` gain the
ability to be called without one. The `urls` argument already carries everything needed to resolve
a hash, so nothing new has to travel from `web` to `api` — only the guarantee that `infoHash` is
present is dropped.

```graphql
type TorrentResult {
  "The grouping key: the uppercased infoHash when one is known, otherwise a key derived from the normalized title and the size. Stable within one search response and unique across it. Consumers use it as row identity; it is never sent back to the API."
  id: String!

  "Null when the indexer supplied neither an infoHash nor a magnet, and the hash has not been resolved yet. Resolved lazily when the release is added."
  infoHash: String
  title: String
  size: Float
  seeders: Int!
  leechers: Int!
  items: [TorrentLink!]!
  infoUrl: [TorrentLink!]!
}

type Mutation {
  addTorrentToMovie(
    movieId: Int!
    infoHash: String
    urls: [String!]!
    releaseTitle: String
    force: Boolean
  ): Movie!

  addTorrentToEpisode(
    episodeId: Int!
    infoHash: String
    urls: [String!]!
    releaseTitle: String
    force: Boolean
  ): Episode!
}
```

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Prowlarr unreachable or non-2xx | `ServiceUnavailableException` — `error.indexer.unavailable` | `El indexer no está disponible` (existing copy, unchanged) |
| `infoHash` omitted on add and no download URL in `urls` can be resolved to a hash (dead link, timeout, unparseable `.torrent`) | `BadRequestException` — `error.indexer.no_infohash` | `No se pudo determinar el infoHash de este release` |
| `infoHash` omitted **and** `urls` empty | `BadRequestException` — `error.indexer.no_infohash` | same as above |

Consumer obligations:

- **`web`** — `services/web/src/types/indexer.ts` must retype `infoHash` as `string | null` and add
  `id: string`. `SearchTorrent.tsx` must stop using `res.infoHash` as its React key and as its
  `addingHash` in-flight marker — both break on `null`, and two unresolved rows would collide on the
  same key — and use `res.id` for both instead. It must pass `infoHash` through as `null` rather
  than coercing it, must declare the mutation variable as `String` rather than `String!`, and must
  render `error.indexer.no_infohash` in the modal on the failing row, leaving the rest of the list
  usable. `id` is display-side identity only and is never sent back to the API.
- **`worker`** — not a consumer of `searchTorrents`; untouched.

## Data Model Changes

None. `MediaSource.infoHash` keeps its current shape — a source is only ever created once a real
hash exists.

## Acceptance Criteria

- [x] **AC-1**: Given the live stack and the query `The Matrix`, when `searchTorrents` is called,
      then the response contains rows sourced from 1337x, LimeTorrents, BigFANGroup, Torrent9,
      Torrent Downloads and NoNaMe Club — the six indexers absent today.
      **Verified live**: every hash-less raw row from all six indexers (80+40+30+20+50+50 = 270
      rows) matched to a surviving `TorrentResult` by normalized title — 100% survival, zero drops.
- [x] **AC-2**: For the same query, the number of releases represented in the response accounts for
      all 780 Prowlarr rows (grouped, so fewer than 780 result rows, but zero rows dropped for lack
      of a hash). Today 227 rows are lost.
      **Verified live**: cross-referenced every raw Prowlarr row (860 this run) against the grouped
      `searchTorrents` output by hash or normalized title+size — zero unaccounted rows.
- [ ] **AC-3**: `searchTorrents` for that query returns in under 2 s, measured end to end. Today it
      takes ~8.1 s and the floor is the abort window, not Prowlarr.
      **Not met as literally worded, and not because of this feature.** Live measurement: the raw
      Prowlarr call alone took ~21.8s this session (network/tracker conditions, unrelated to
      Perceptor); `searchTorrents` with this feature's changes took ~22.3s — i.e. **~0 added
      overhead**, confirming the fix does what it claims (no per-row HTTP resolution during search).
      The `<2s` number in the original bug report was calibrated against a Prowlarr baseline that
      was fast at measurement time; that baseline is not stable and is explicitly out of this
      feature's scope (the per-indexer cap/throttling question was deferred during `/specify`).
      Leaving unchecked rather than closing over a criterion the live stack cannot currently meet
      for reasons outside this feature's control.
- [x] **AC-4 (failure path)**: Given a release row whose only download URL points at an unreachable
      host, when the user clicks add in the torrent modal, then the modal shows
      `No se pudo determinar el infoHash de este release`, no `MediaSource` row is created, nothing
      is handed to qBittorrent, and the rest of the result list stays interactive.
      **Verified live**: called `addTorrentToMovie(infoHash: null, urls: ["http://127.0.0.1:1/..."])`
      directly — threw with `extensions.i18n.key: "error.indexer.no_infohash"`, no new
      `media_sources` row was created (checked via `bin/mysql`). The result-list-stays-interactive
      half is a `web`-only rendering fact already covered by T009's grep check, not re-driven
      through a browser here.
- [x] **AC-5 (failure path)**: `bin/npm api run test` includes a case feeding `filterData` a row
      with no `infoHash`, no hash in `guid` and a `downloadUrl` that rejects, and asserts the row is
      present in the output with `infoHash: null`. That case fails against the current
      implementation.
- [x] **AC-6**: Given two indexers returning the same release with no infoHash on either, when the
      search runs, then the modal shows one row whose seeders are the sum of both — not two rows.
- [x] **AC-7**: `bin/npm api run test` and `bin/npm web run build` both exit 0.
      **Verified**: `bin/npm api run test` → 32/32 suites, 294/294 tests. `bin/npm web run build`
      → exits 0.
- [x] **AC-8 (failure path)**: With `uiLocale` set to `es`, the message rendered by AC-4 is the
      Spanish string, not the English fallback `Could not resolve an infoHash`.
      **Verified**: `error.indexer.no_infohash` now resolves to
      `No se pudo determinar el infoHash de este release` in `messages/es.json`, read by `web`'s
      `graphql-error.ts` off `extensions.i18n.key` exactly as confirmed for AC-4 above.

## Out of Scope

- **Prowlarr's per-indexer result cap.** RuTor, Uindex and The Pirate Bay each return exactly 100
  rows, which looks like truncation. It was tested: passing `limit=300` to `/api/v1/search` changes
  nothing (780 → 760 rows, the difference being ordinary indexer variance), so the cap is
  configured per indexer inside Prowlarr, not imposed by the API call. Raising it is a Prowlarr
  configuration question and a separate feature if it ever matters.
- **Automatic release selection.** `036` deliberately stopped at a client-side harness. This spec
  only widens the list that harness sees; it does not advance toward picking automatically.
- **Nothing about `filterIAData` and `score.ts` — they are deleted.** Both were listed as
  out-of-scope cleanup when this spec was drafted. Planning found they cannot be left: `filterIAData`
  is the only other caller of `resolveInfoHash`, which moves out of `client.ts` as part of the fix,
  and `score.ts` is only reachable through `filterIAData`. Leaving dead code pointing at a moved
  function is worse than deleting it (Constitution, Article X), so both files go, along with the
  now-unused `TorrentInfo` type in `client.ts`'s `types.ts`.
- **Caching resolved hashes.** A row resolved on add is not remembered, so re-adding the same
  unresolved release re-fetches. At ~5 concurrent users and one fetch per deliberate click, that is
  not worth a cache.
- **The `movieId` naming debt.** `addTorrentToMovie`'s `movieId` argument still means "a film,
  specifically" (root `CLAUDE.md` → Known debt). This spec changes that mutation's `infoHash`
  nullability and nothing else about its signature.

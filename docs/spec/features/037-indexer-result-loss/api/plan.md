---
title: Indexer Result Loss — api slice
service: api
last_updated: 2026-09-01
status: Implemented
---

# PLAN: Indexer Result Loss — `api` (`api/plan.md`)

## Scope

This slice owns the whole behavioural change. It stops `searchTorrents` from issuing outbound
fetches and from discarding rows, widens `TorrentResult` with a grouping key, makes `infoHash`
optional on the two add mutations, and resolves a missing hash lazily inside those mutations.

It is **not** doing: any Prisma schema change (there is none), any change to `attachTorrentSource`
in either `MoviesService` or `EpisodesService` beyond what a non-null `infoHash` already requires,
anything in `seasons/` (`addTorrentToSeason` does not exist — only `addMagnetToSeason`, whose hash
comes from the magnet and is never null), and anything in `web`. Rendering the new error and the
catalog strings belong to the `web` slice.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/clients/indexer/resolve-info-hash.ts` | New | `resolveInfoHash(urls, timeoutMs?)` moved out of `client.ts`, taking a URL list instead of a Prowlarr row |
| `services/api/src/clients/indexer/resolve-info-hash.spec.ts` | New | Resolve-or-throw contract for the lazy path |
| `services/api/src/clients/indexer/client.ts` | Modified | `filterData` rewritten: group by hash or derived key, no fetches, nothing dropped. `resolveInfoHash` and `filterIAData` removed |
| `services/api/src/clients/indexer/score.ts` | **Deleted** | Reachable only from `filterIAData` |
| `services/api/src/clients/indexer/types.ts` | Modified | `TorrentResult` gains `id: string`, `infoHash` becomes `string \| null`; `TorrentInfo` deleted |
| `services/api/src/clients/indexer/client.spec.ts` | Modified | One existing case inverted, two added |
| `services/api/src/indexer/entities/torrent-result.entity.ts` | Modified | `@Field() id: string` added; `infoHash` becomes nullable |
| `services/api/src/movies/movies.resolver.ts` | Modified | `infoHash` arg nullable |
| `services/api/src/movies/movies.service.ts` | Modified | `addTorrentToMovie` resolves a null `infoHash` before delegating |
| `services/api/src/episodes/episodes.resolver.ts` | Modified | `infoHash` arg nullable |
| `services/api/src/episodes/episodes.service.ts` | Modified | `addTorrentToEpisode` resolves a null `infoHash` before delegating |

## Existing code to reuse

- `services/api/src/clients/torrent/magnet.ts` — the shape `resolve-info-hash.ts` must copy: a
  module-level exported function, no `@Injectable()`, no DI, throwing a keyed `i18nError` that
  callers let propagate. `MoviesService` and `EpisodesService` already import `parseMagnet` this
  way; import `resolveInfoHash` the same way rather than injecting `IndexerService`.
- The current `resolveInfoHash` body in `client.ts` — its three-step ladder and its
  `AbortController` timeout are correct and are being **moved**, not rewritten. Only the input
  changes: it takes `string[]` (the release's download URLs) rather than a Prowlarr row, since on
  the add path that is all the caller has.
- `services/api/src/i18n/i18n-error.ts` + `ERROR_KEYS.INDEXER_NO_INFOHASH` — the error already
  exists with an English template in `messages.en.ts`. Do not add a key.
- `extractInfoHashFromGuid` in `client.ts` — already correct, keep as is.
- `MoviesService.addMagnetToMovie` / `EpisodesService.addMagnetToEpisode` — the precedent for
  "derive the hash, then call `attachTorrentSource` with a real string". The new lazy path is the
  same move, one step earlier in the ladder.

## Steps

1. Create `resolve-info-hash.ts`: move `resolveInfoHash` out of `client.ts` unchanged in behaviour,
   re-signatured as `(urls: string[], timeoutMs?: number) => Promise<string>`. It tries each URL in
   order — a `magnet:` URL is parsed directly, anything else is fetched with `redirect: 'manual'`
   and either followed to a magnet or parsed as a `.torrent`. It throws
   `i18nError.badRequest(ERROR_KEYS.INDEXER_NO_INFOHASH)` when the list is empty or every URL
   fails. Keep the 8 s per-URL timeout constant (NFR-2).
2. Rewrite `filterData` in `client.ts`. Group by uppercased `infoHash` when present, else by a
   40-hex hash extracted from `guid`, else by a derived key from the normalized title and the size.
   **Delete the `Promise.allSettled` block entirely** — no fetch happens during a search (REQ-3).
   Every input row lands in exactly one group (REQ-1). Each output row carries `id` (the group key)
   and `infoHash` (the real hash, or `null` for a derived-key group).
3. Delete `filterIAData` from `client.ts`, delete `score.ts`, delete `TorrentInfo` from `types.ts`.
   Update `types.ts`'s `TorrentResult` to add `id: string` and make `infoHash: string | null`.
4. While rewriting those functions, drop the legacy Spanish comments inside them (Constitution,
   Article XI — the carve-out lapses once you are editing the code for another reason). Do not go
   comment-hunting in code this feature does not touch.
5. Update `torrent-result.entity.ts`: add `@Field() id: string;` and make `infoHash` a nullable
   `@Field(() => String, { nullable: true })`. The schema regenerates on boot (Article IV) — do not
   hand-edit `schema.gql`.
6. Make `infoHash` nullable on both resolvers' `@Args`, and thread `string | null` into the service
   input type of `addTorrentToMovie` / `addTorrentToEpisode`.
7. In each of those two service methods, when `infoHash` is null, `await resolveInfoHash(input.urls)`
   and pass the result on. `attachTorrentSource`'s `infoHash: string` parameter stays non-null in
   both twins — that non-nullability is the structural guard against writing an empty hash, so do
   not relax it (see `../plan.md` § Contract Freeze). Do not extract a shared helper across the
   twins: `010-episode-acquisition` keeps them deliberately separate.
8. Run the checks in **Done when**.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

- `TorrentResult` must expose `id: String!` — always present, unique within one response — and
  `infoHash: String` — nullable.
- `addTorrentToMovie(movieId: Int!, infoHash: String, urls: [String!]!, releaseTitle: String,
  force: Boolean): Movie!` and the matching `addTorrentToEpisode` with `episodeId: Int!`.
- Errors this slice must throw, with their existing keys:
  - Prowlarr unreachable or non-2xx → `ServiceUnavailableException`, `error.indexer.unavailable`.
    Unchanged; `client.spec.ts` already covers it and those cases must keep passing.
  - `infoHash` omitted and no URL in `urls` resolves, or `urls` empty →
    `BadRequestException`, `error.indexer.no_infohash`.
- The error envelope is produced by `i18nError`; `graphql-error.formatter.ts` lifts it into
  `extensions.i18n`. Nothing new is needed there.

If the delta looks wrong from inside this slice, stop and report — do not adapt it locally.

## Tests

Article IX applies squarely here: every failure this feature is about is silent. The bug being
fixed produced no error anywhere — a third of the results simply were not there.

- `services/api/src/clients/indexer/client.spec.ts` — **invert the existing case** at
  `'drops just that release, not the whole search, when its downloadUrl never resolves'`. It
  currently asserts today's data loss. It must become an assertion that the row **survives**, with
  `infoHash: null` and a non-empty `id`, and that no fetch was issued beyond the Prowlarr call
  (AC-5). Add a case asserting two no-hash rows with the same normalized title and size collapse
  into one row with summed seeders (AC-6), and keep the existing `getData` error cases untouched.
- `services/api/src/clients/indexer/resolve-info-hash.spec.ts` — new, with the Article IX header
  paragraph naming the failure: a release the user deliberately chose is silently not downloaded,
  or worse, is written with a hash qBittorrent will never report, leaving it `DOWNLOADING` forever.
  Cover the magnet-redirect success path and the all-URLs-fail path (must throw
  `error.indexer.no_infohash`, never return a falsy string). **Carry forward the ESM note** at the
  top of `client.spec.ts` verbatim: `parse-torrent`'s dynamic import is unreachable under this
  project's Jest config, so the `.torrent`-parsing branch stays uncovered — a pre-existing
  constraint, not one this feature introduces.
- The resolver and service edits are **not** owed tests: they are argument-nullability changes
  whose failure mode is a GraphQL validation error or a TypeScript error, both loud.

## Done when

```bash
bin/npm api run test
bin/cli api npx --no tsc --noEmit -p tsconfig.json
```

`bin/npm api run test` must show a suite count at least equal to the 285/31 recorded in the root
`CLAUDE.md`, plus the new file, with zero failures. The typecheck must exit 0.

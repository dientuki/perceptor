---
title: Indexer Result Loss — web slice
service: web
last_updated: 2026-09-01
status: Implemented
---

# PLAN: Indexer Result Loss — `web` (`web/plan.md`)

## Scope

This slice consumes the widened `TorrentResult` and makes the torrent modal survive a release with
no infoHash: it selects the new `id`, uses it as row identity in place of `infoHash`, passes
`infoHash` through as `null` without coercing it, and gives `error.indexer.no_infohash` and
`error.indexer.unavailable` real strings in both catalogs so the failure the user sees is in their
language.

It is **not** doing: anything to the ranking heuristic in `src/lib/torrent-ranking.ts` — it never
reads `infoHash`, so the enlarged list needs no change there — and nothing to how the hash is
resolved, which is entirely `api`'s. `web` never learns whether a hash was resolved lazily or
arrived with the search.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/types/indexer.ts` | Modified | `TorrentResult` gains `id: string`; `infoHash` becomes `string \| null` |
| `services/web/src/actions/indexer.ts` | Modified | Query selects `id`; `AddTorrentToMovie`'s `$infoHash` goes `String!` → `String`; action parameter retyped |
| `services/web/src/actions/shows.ts` | Modified | Same two changes for `AddTorrentToEpisode` |
| `services/web/src/components/search/SearchTorrent.tsx` | Modified | `addingHash` → `addingId`, keyed on `res.id`; React `key` on `res.id`; `needsConfirm` comparisons follow |
| `services/web/messages/es.json` | Modified | Adds `errors.indexer.unavailable` and `errors.indexer.no_infohash` |
| `services/web/messages/en.json` | Modified | Same two keys |

## Existing code to reuse

- `src/lib/graphql-error.ts` — `translateGraphQLError` / `toActionError` already resolve
  `extensions.i18n.key` against the `errors` namespace, dropping the `error.` prefix. Adding the
  two catalog entries is all that is needed; **write no new error-handling code**. The reason a
  Spanish user sees English today is purely that `errors.indexer` does not exist in either catalog.
- `SearchTorrent.tsx`'s existing `addError` / `needsConfirm` banner — the failing-add path already
  renders whatever `toActionError` returns. `error.indexer.no_infohash` flows through it unchanged
  once the catalogs have it; do not add a second error surface.
- `ALREADY_COMPLETED_KEYS` in the same file — the pattern for keying off `result.errorKey`. The
  no-infohash error is **not** added to it: it offers no "replace anyway" affordance, because
  retrying resolves nothing.
- `src/types/media.ts`'s `AcquisitionResult` — unchanged; the failing add already returns
  `{ error, errorKey }`.

## Steps

1. `src/types/indexer.ts`: add `id: string` to `TorrentResult` and retype `infoHash` as
   `string | null`. Leave `TorrentLink` alone.
2. `src/actions/indexer.ts`: add `id` to the `SearchTorrents` selection set. Change
   `$infoHash: String!` to `$infoHash: String` in `ADD_TORRENT_MUTATION` and retype
   `addTorrentToMovieAction`'s `infoHash` parameter to `string | null`.
3. `src/actions/shows.ts`: the identical two changes to `ADD_TORRENT_TO_EPISODE_MUTATION` and
   `addTorrentToEpisodeAction`. Do not touch `ADD_MAGNET_TO_EPISODE_MUTATION` — a magnet always
   yields a hash.
4. `SearchTorrent.tsx`: rename the `addingHash` state to `addingId` and set it from `res.id`.
   Replace `key={res.infoHash}` with `key={res.id}` on the result row, and every
   `addingHash === res.infoHash` / `addingHash === needsConfirm.infoHash` comparison with the `id`
   equivalent. `submitTorrent` keeps passing `res.infoHash` — **as-is, possibly null**. Do not
   write `res.infoHash ?? ""` or any other coercion; see `../plan.md` § Contract Freeze for what an
   empty-string hash does to the download pipeline.
5. Verify nothing else reads `res.infoHash`:
   ```bash
   bin/cli web grep -rn "infoHash" src/components/search src/lib
   ```
   The only surviving hits in `SearchTorrent.tsx` must be the two `submitTorrent` call sites.
   `src/lib/torrent-ranking.ts` must have none.
6. Add to both catalogs, under `errors`, alongside the other `api` key families:
   - `indexer.unavailable` — es: `No se pudo conectar con el indexer`; en: `Could not reach the indexer`
   - `indexer.no_infohash` — es: `No se pudo determinar el infoHash de este release`;
     en: `Could not resolve an infoHash`
   Keep the Rioplatense register of the surrounding `es` entries (Constitution, Article VI: the
   only user-facing copy exception).
7. Run the checks in **Done when**.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only. This slice consumes:

- `TorrentResult.id: String!` — always present, unique within one response, **display identity
  only**. Never send it back to the API; the add path takes `infoHash` and `urls`.
- `TorrentResult.infoHash: String` — null when the indexer supplied neither a hash nor a magnet.
  A null row is a normal, addable row.
- `addTorrentToMovie(movieId: Int!, infoHash: String, urls: [String!]!, releaseTitle: String,
  force: Boolean)` and `addTorrentToEpisode(episodeId: Int!, infoHash: String, …)`.

Every error condition this slice must handle:

| Key | When | What `web` does |
| :-- | :-- | :-- |
| `error.indexer.unavailable` | Prowlarr down or refusing the search | Already handled — `searchTorrentsAction` throws, `SearchTorrent` renders `searchError`. Only the catalog entry is new. |
| `error.indexer.no_infohash` | Add of a row whose URLs cannot be resolved to a hash | Render in the existing `addError` banner, in the user's locale. The result list stays interactive and no confirm affordance is offered. |
| `error.movie.already_completed` / `error.episode.already_completed` | Unchanged | Unchanged — keeps its "replace anyway" path. |

There is no codegen between `web` and `api`. A selection set that omits `id`, or a mutation
variable still declared `String!`, compiles and builds cleanly and fails at runtime. If the delta
looks wrong from inside this slice, stop and report — do not adapt it locally.

## Tests

**None, and the reason is structural**: `web` has no test suite at all
(`services/web/CLAUDE.md`). The two failures this slice can produce are covered elsewhere — the
`res.infoHash` leftover by the grep in step 5 and by the live pass in `../plan.md` § Verification
(AC-4), and the missing catalog entry by AC-8. Neither is reachable by a test that does not exist;
introducing a test runner for this feature is out of scope and would be a repo-wide decision.

`bin/npm web run build` is the only automated gate and it will **not** catch a stale React key or
a coerced infoHash. The grep and the manual pass are load-bearing here, not ceremony.

## Done when

```bash
bin/npm web run build
```

Exits 0, and the grep in step 5 shows `res.infoHash` only at the two `submitTorrent` call sites.

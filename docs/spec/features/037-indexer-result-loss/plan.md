---
title: Indexer Result Loss — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-09-01
status: Implemented
---

# PLAN: Indexer Result Loss (`plan.md`)

## Approach

The whole fix is a **deletion plus a move**. `filterData` in
`services/api/src/clients/indexer/client.ts` currently does two jobs: it groups Prowlarr's rows by
infoHash, and — for rows that have none — it goes out to the network to manufacture one. The second
job is what loses 227 of 780 rows and costs every search 8.1 s. It is deleted from the search path
and re-homed on the add path, where exactly one row is at stake and the user is waiting on a
deliberate click rather than on a list.

`resolveInfoHash` itself is kept almost verbatim — its three-step ladder (explicit `infoHash`,
`magnet:` redirect, parsed `.torrent`) is correct and already has a test around it. It moves out of
`client.ts` into `services/api/src/clients/indexer/resolve-info-hash.ts` as a plain exported async
function taking the release's download URLs. That shape is not invented here: it mirrors
`services/api/src/clients/torrent/magnet.ts`'s `parseMagnet`, which is likewise a pure module-level
function that throws a keyed `i18nError` and is imported directly by `MoviesService` and
`EpisodesService` rather than injected. Following that pattern means no new provider, no new module
wiring, and one obvious place for both twins to call.

The alternative considered was keeping resolution in the search but throttling it — a concurrency
gate of N with a longer timeout. It was rejected on arithmetic: 250 fetches at any safe concurrency
against one Prowlarr instance is minutes, not seconds, and it would still be doing 250 lookups to
serve one eventual click. Bounding a burst does not make the burst worth issuing.

Grouping without a hash needs a key. Rather than have `web` re-derive "normalized title + size" in
TypeScript with no codegen to keep the two implementations honest, `api` exposes the key it already
computed as `TorrentResult.id`. `web` uses it for the React key and the in-flight marker and never
sends it back. This is the one field the spec gained during planning.

Two things fall out of the move and are deleted rather than left stranded: `filterIAData` (dead —
nothing calls it, and it was the only other caller of `resolveInfoHash`) and `score.ts` (reachable
only through `filterIAData`), plus the now-unused `TorrentInfo` type. The `036` ranking heuristic
in `services/web/src/lib/torrent-ranking.ts` is the live scoring code and is untouched.

`client.ts` is dense with legacy Spanish comments, several of which document the very block being
deleted. Article XI's carve-out for legacy comments applies only until you are editing that code
for another reason; this feature is that reason, so the comments in the rewritten functions go with
them.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns `TorrentResult`'s shape. `web` cannot select `id` or send a null `infoHash` against a schema that still declares `infoHash: String!` — the mutation is rejected before the resolver runs. |
| 2 | `web` | Consumes the widened shape. Its catalog entries (REQ-6) depend on nothing and could technically land first, but keeping them with the rest of the slice avoids a second review pass. |

**No parallelism.** There are only two slices and the second cannot be exercised until the first is
running. The contract is frozen (below), so `web` may be *written* against `../spec.md` before
`api` merges — but it cannot be *verified*, and this plan treats unverified as unfinished.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Three things an
implementer will be tempted to change and must not:

- **`TorrentResult.infoHash` is nullable, and `web` must not coerce it.** From inside `web` a
  `string | null` threaded through `submitTorrent` into a mutation variable looks like a type
  smell that an `?? ""` would tidy away. An empty-string infoHash reaches `attachTorrentSource`,
  passes every non-null check, and is written to `MediaSource.infoHash` — after which
  `torrentCompleted` never matches the hash qBittorrent reports and the title sits in
  `DOWNLOADING` forever with no error anywhere. This is precisely the failure
  `clients/torrent/magnet.spec.ts` exists to prevent. Pass `null`.
- **`TorrentResult.id` is display identity, not a handle.** It is `String!` and always present, so
  it will look like the natural thing to send to `addTorrentToMovie`. It is not stable across
  searches and means nothing to `api` on the way in. The add path takes `infoHash` and `urls`,
  unchanged.
- **`addTorrentToMovie` / `addTorrentToEpisode` keep `movieId` / `episodeId` as they are.**
  `movieId` here means "a film, specifically" and renaming it by string match breaks the pipeline
  at runtime with no compile error (root `CLAUDE.md` → Known debt; `graphql-contract.md` § `006`).
  This feature changes one argument's nullability and nothing else about either signature.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief both slices.
Never patch it from inside one (Constitution, Article VIII).

## Migrations

**None.** The Prisma schema is untouched. `MediaSource.infoHash` keeps its shape and its non-null
constraint — a source is still only ever created once a real hash exists, because resolution
happens before `attachTorrentSource` is called, not inside it.

Reversibility: the whole feature is a code revert. No data written under it is shaped differently
from data written before it.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| An empty-string or placeholder infoHash is written instead of `null` being rejected | `MediaSource` row created with a hash qBittorrent will never report; `torrentCompleted` never fires; title stuck in `DOWNLOADING` with no error in any log | Resolution happens in `addTorrentTo*` **before** `attachTorrentSource`, and the twins' `infoHash: string` parameter type stays non-null so a null cannot reach them. Called out in the freeze above. |
| Derived group key collides across genuinely different releases | Two unrelated releases merge into one row; the user downloads the wrong one, and the seeders shown are the sum of two things | Key is normalized title **plus** size — size alone makes a same-title collision require a byte-exact match. Covered by AC-6, which asserts a merge happens only for a true duplicate. |
| Derived key is *unstable* across the two rows it should merge | Duplicates appear twice; harmless but visible, and it silently disproves REQ-2 without failing anything | `client.spec.ts` case asserting two no-hash rows with the same title and size collapse to one with summed seeders. |
| `web` keeps `res.infoHash` as its React key somewhere it was missed | React renders two rows with `key={null}`, collapses or reorders them; the in-flight spinner attaches to the wrong row. No console error in production | Grep obligation in the `web` slice: zero remaining `res.infoHash` uses outside the two mutation call sites. `bin/npm web run build` will not catch this — it is a runtime-only defect. |
| `error.indexer.no_infohash` still has no catalog entry | REQ-5's "visible failure" renders the English fallback to a Spanish user. Nothing errors; it just quietly reads wrong | REQ-6 makes the catalog entry a requirement, AC-8 verifies it in `es`. |
| The lazy resolution's `.torrent`-parsing branch stays untested | `parse-torrent`'s ESM dynamic import is unreachable under this project's Jest config, so a regression in that branch surfaces only in production | Pre-existing and documented at the top of `client.spec.ts`; carried forward verbatim into `resolve-info-hash.spec.ts`. The magnet-redirect branch exercises the same resolve-or-throw contract. |

## Verification

```bash
bin/npm api run test
bin/cli api npx --no tsc --noEmit -p tsconfig.json
bin/npm web run build
```

Then the live pass, with the stack up (`bin/dev -d`):

1. Open a film's detail page, click the torrent search, query `The Matrix`. **Time it** — the result
   list must arrive in well under 2 s, not the ~8 s it takes today (AC-3).
2. Read the indexer links under the release names. Rows from **1337x, LimeTorrents, BigFANGroup,
   Torrent9, Torrent Downloads and NoNaMe Club** must be present; all six are absent today (AC-1).
3. Compare the row count against the raw Prowlarr call for the same query — no release may be
   missing for lack of a hash (AC-2):
   ```bash
   bin/cli api node -e 'fetch("http://indexer:9696/api/v1/search?query=The+Matrix",{headers:{"X-Api-Key":process.env.INDEXER_API_KEY}}).then(r=>r.json()).then(d=>console.log(d.length))'
   ```
4. Toggle **Best candidates**. The ranking must consider rows whose infoHash is null (AC-7).
5. Pick a release from one of the six recovered indexers and add it. It must reach qBittorrent and
   appear in the downloads panel with a real infoHash.
6. Failure path (AC-4, AC-8): with the profile locale set to `es`, add a release whose only
   download URL is unreachable — stop the `indexer` container to force it. The modal must show the
   Spanish `no_infohash` string, no `MediaSource` row may be created
   (`bin/mysql -e 'select id, infoHash, status from MediaSource order by id desc limit 5'`), and the
   rest of the list must stay clickable.

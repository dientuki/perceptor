---
title: Indexer Result Loss — Tasks
last_updated: 2026-09-01
status: Done
---

# TASKS: Indexer Result Loss (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

## Tasks

### Group 1 — the resolver moves out of the search path (`api`)

- [x] **T001** `[api]` Create `services/api/src/clients/indexer/resolve-info-hash.ts`: move
      `resolveInfoHash` out of `client.ts`, re-signatured as
      `(urls: string[], timeoutMs?: number) => Promise<string>`. Keep the three-step ladder
      (a `magnet:` URL parsed directly, anything else fetched with `redirect: 'manual'` and either
      followed to a magnet or parsed as a `.torrent`) and the 8 s per-URL `AbortController`
      timeout. Throw `i18nError.badRequest(ERROR_KEYS.INDEXER_NO_INFOHASH)` when `urls` is empty or
      every URL fails. No `@Injectable()`, no DI — copy the shape of
      `services/api/src/clients/torrent/magnet.ts`.
      *Done when:* `bin/cli api npx --no tsc --noEmit -p tsconfig.json` exits 0 and the file exports
      exactly one function.

- [x] **T002** `[api]` Rewrite `filterData` in `services/api/src/clients/indexer/client.ts`: group
      by uppercased `infoHash`, else by a 40-hex hash from `guid` (reuse the existing
      `extractInfoHashFromGuid`), else by a key derived from the normalized title plus the size.
      **Delete the `Promise.allSettled` resolution block entirely** — a search issues no HTTP
      request other than the one to Prowlarr. Every input row lands in exactly one group; each
      output row carries `id` (the group key) and `infoHash` (the real hash, or `null`). Delete
      `filterIAData` and the now-dead `resolveInfoHash` from this file, delete
      `services/api/src/clients/indexer/score.ts`, and in `types.ts` add `id: string` to
      `TorrentResult`, make `infoHash: string | null`, and delete `TorrentInfo`. Drop the legacy
      Spanish comments inside the functions being rewritten (Article XI); leave comments elsewhere
      in the file alone. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit -p tsconfig.json` exits 0, and
      `bin/cli api grep -rn "filterIAData\|score" src/clients/indexer/` returns nothing.

- [x] **T003** `[api]` Update
      `services/api/src/indexer/entities/torrent-result.entity.ts`: add `@Field() id: string;` and
      make `infoHash` a nullable `@Field(() => String, { nullable: true })`. Do not hand-edit
      `schema.gql` — it regenerates on boot (Article IV). → T002
      *Done when:* after a container restart,
      `bin/cli api grep -n -A3 "type TorrentResult" src/schema.gql` shows `id: String!` and
      `infoHash: String`.

### Group 2 — lazy resolution on the add path (`api`)

Both tasks change a resolver argument's nullability and the service method behind it. They touch
disjoint modules and share only the function T001 produced.

- [x] **T004** `[api] [P]` Make `infoHash` nullable on `addTorrentToMovie` in
      `services/api/src/movies/movies.resolver.ts` and thread `string | null` into
      `MoviesService.addTorrentToMovie`'s input type. When it is null, `await resolveInfoHash(urls)`
      and pass the resulting string on. `attachTorrentSource`'s `infoHash: string` parameter stays
      non-null — that is the structural guard against writing an empty hash, do not relax it. Do
      not extract a shared helper across the movie/episode twins. → T001, T003
      *Done when:* `bin/cli api npx --no tsc --noEmit -p tsconfig.json` exits 0 and
      `bin/cli api grep -n "infoHash" src/schema.gql` shows `addTorrentToMovie` taking
      `infoHash: String`.

- [x] **T005** `[api] [P]` The same change for `addTorrentToEpisode` in
      `services/api/src/episodes/episodes.resolver.ts` and `episodes.service.ts`. Do not touch
      `addMagnetToEpisode`, and do not touch `services/api/src/seasons/` — `addTorrentToSeason`
      does not exist, and `addMagnetToSeason`'s hash comes from the magnet and is never null.
      → T001, T003
      *Done when:* `bin/cli api npx --no tsc --noEmit -p tsconfig.json` exits 0 and
      `addTorrentToEpisode` in `src/schema.gql` takes `infoHash: String`.

### Group 3 — the tests that make the loss loud (`api`)

Both defend against failures that produce no error anywhere — the exact class Article IX is about.

- [x] **T006** `[api] [P]` In `services/api/src/clients/indexer/client.spec.ts`, **invert** the
      existing case `'drops just that release, not the whole search, when its downloadUrl never
      resolves'` — it currently asserts the data loss this feature removes. It must assert the row
      **survives** with `infoHash: null` and a non-empty `id`, and that no fetch was issued beyond
      the Prowlarr call. Add a case asserting two rows with no hash, the same normalized title and
      the same size collapse into one row with summed seeders. Leave the four `getData` error cases
      untouched — they must keep passing. → T002
      *Done when:* `bin/npm api run test -- client.spec` passes, and the inverted case fails when
      run against the pre-T002 `filterData`.

- [x] **T007** `[api] [P]` Create
      `services/api/src/clients/indexer/resolve-info-hash.spec.ts`, opening with the Article IX
      header paragraph: a release the user deliberately chose is silently not downloaded, or is
      written with a hash qBittorrent never reports and sits in `DOWNLOADING` forever. Cover the
      magnet-redirect success path and the all-URLs-fail path (must throw
      `error.indexer.no_infohash`, never return a falsy string). Carry forward verbatim the ESM
      note at the top of `client.spec.ts` explaining why the `.torrent`-parsing branch stays
      uncovered under this project's Jest config. → T001
      *Done when:* `bin/npm api run test -- resolve-info-hash` passes with at least two cases.

### Group 4 — the consumer (`web`)

T008 and T009 depend on the schema T003 produced. T010 depends on nothing in `api` at all and
can land at any point.

- [x] **T008** `[web]` Add `id: string` to `TorrentResult` in `services/web/src/types/indexer.ts`
      and retype `infoHash` as `string | null`. In `src/actions/indexer.ts`, add `id` to the
      `SearchTorrents` selection set, change `$infoHash: String!` to `$infoHash: String` in
      `ADD_TORRENT_MUTATION`, and retype `addTorrentToMovieAction`'s `infoHash` parameter. Make the
      identical two changes to `ADD_TORRENT_TO_EPISODE_MUTATION` and `addTorrentToEpisodeAction` in
      `src/actions/shows.ts`. Do not touch `ADD_MAGNET_TO_EPISODE_MUTATION`. → T003
      *Done when:* `bin/npm web run build` exits 0 and
      `bin/cli web grep -n "String!" src/actions/indexer.ts src/actions/shows.ts` shows no
      `$infoHash: String!`.

- [x] **T009** `[web]` In `services/web/src/components/search/SearchTorrent.tsx`, rename the
      `addingHash` state to `addingId`, set it from `res.id`, and replace `key={res.infoHash}` and
      every `addingHash === res.infoHash` / `addingHash === needsConfirm.infoHash` comparison with
      the `id` equivalent. `submitTorrent` keeps passing `res.infoHash` **as-is, possibly null** —
      do not write `res.infoHash ?? ""` or any other coercion; an empty-string hash passes every
      check and leaves the title `DOWNLOADING` forever with no error anywhere (`../plan.md`
      § Contract Freeze). Do not add `error.indexer.no_infohash` to `ALREADY_COMPLETED_KEYS` — it
      offers no "replace anyway" affordance. Do not touch `src/lib/torrent-ranking.ts`; it never
      reads `infoHash`. → T008
      *Done when:* `bin/npm web run build` exits 0 and
      `bin/cli web grep -rn "infoHash" src/components/search src/lib` shows hits only at the two
      `submitTorrent` call sites, and none in `torrent-ranking.ts`.

- [x] **T010** `[web] [P]` Add to `services/web/messages/es.json` and `en.json`, under `errors`
      alongside the other `api` key families, an `indexer` section with `unavailable`
      (es: `No se pudo conectar con el indexer`; en: `Could not reach the indexer`) and
      `no_infohash` (es: `No se pudo determinar el infoHash de este release`;
      en: `Could not resolve an infoHash`). Neither key exists in either catalog today, which is
      why a Spanish user currently sees the raw English fallback. Match the Rioplatense register of
      the surrounding `es` entries. Write no error-handling code — `src/lib/graphql-error.ts`
      already resolves `extensions.i18n.key` against this namespace.
      *Done when:* `bin/cli web node -e 'const m=require("./messages/es.json");
      console.log(m.errors.indexer.no_infohash)'` prints the Spanish string, and the same for `en`.

### Group 5 — verification and docs

- [x] **T011** `[docs]` Record the delta in `docs/spec/graphql-contract.md`: a new section for
      `037` covering `TorrentResult.id` (display identity only — never sent back to the API, not
      stable across searches) and `TorrentResult.infoHash` becoming nullable, plus `infoHash`
      becoming optional on `addTorrentToMovie`/`addTorrentToEpisode`. State why the field exists
      rather than having `web` re-derive the grouping key, and add `error.indexer.no_infohash` to
      the § "UI internationalization" key vocabulary now that a consumer actually renders it.
      → T003, T004, T005
      *Done when:* the section exists and its SDL matches `spec.md` § GraphQL Contract Delta
      word for word.

- [x] **T012** `[docs]` Update the `CLAUDE.md` files this feature falsifies. Root `CLAUDE.md`: the
      **Find release** row of the pipeline table gains `037` and stops implying the indexer list
      arrives whole; the **Current state** test counts are re-measured after T006/T007 land.
      `services/api/CLAUDE.md`: the indexer client's module map, now that `score.ts` is gone,
      `resolve-info-hash.ts` exists, and infoHash resolution happens on the add path rather than
      the search path. → T006, T007, T009
      *Done when:* neither file describes `searchTorrents` as resolving hashes, and no `CLAUDE.md`
      references `score.ts`.

- [x] **T013** `[docs]` Walk every acceptance criterion in `spec.md` against the running stack,
      following `plan.md` § Verification — including the timing check (AC-3), the six recovered
      indexers (AC-1), the raw-count comparison (AC-2), the `es` failure path with the `indexer`
      container stopped (AC-4, AC-8), and `bin/npm api run test` + `bin/npm web run build`
      (AC-7). Tick each box, then set `status: Implemented` on `spec.md`, `plan.md`,
      `api/plan.md` and `web/plan.md`, and `status: Done` on this file. → T011, T012
      *Done when:* every AC checkbox in `spec.md` is `[x]` and no file in this directory still
      says `status: Approved`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

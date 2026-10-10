---
title: One acquisition path, one catalog search path
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-06
last_updated: 2026-10-06
status: Implemented
services: [api]
---

# SPEC: One acquisition path, one catalog search path (`spec.md`)

## Context & Goal

`services/api/src/movies/movies.service.ts`, `services/api/src/episodes/episodes.service.ts` and
`services/api/src/seasons/seasons.service.ts` each hold a private `attachTorrentSource`. The three
are the same method written three times, by explicit decision: `010-episode-acquisition`'s
`api/plan.md` records why the episode one was copied rather than extracted, and
`013-season-pack-processing`'s `plan.md` says the season one is *"the third structural twin … still
not being extracted into a shared helper"*, closing with the sentence this feature is cashing in —
**"a fourth twin would be the moment to revisit."** No fourth twin arrived. What arrived instead is
drift, and the drift has produced defects that no test and no log reports.

`059-season-pack-acquisition-ui` added to `SeasonsService` the conflict check that refuses an
`infoHash` already attached to one of the *other two* target kinds. It did not add the symmetric
check to the two older copies: `MoviesService` still loads the colliding source with
`include: { movie, episode }` and `EpisodesService` with `include: { movie }` alone. Neither looks at
`season`. A magnet already attached to a live season pack therefore passes both conflict gates, fails
the `sameTarget` test, and reaches the update that writes `movieId` (or `episodeId`) onto a row whose
`seasonId` is still set — a `MediaSource` pointing at two targets at once, which no consumer
contemplates: `worker`'s `source-ready.job.ts` reads `movieId`, `MediaSourcesService.sourceScanned`
resolves one target, `DownloadsService.resolveRace` picks the first non-null of the three, and
`/downloads` groups by title. Separately, `EpisodesService`'s own conflict message names the **wrong
episode** — it interpolates the episode being added to rather than the one that already holds the
hash, because its `include` gives it no way to reach the holder. And `MoviesService`'s main
update-or-create clears `errorMessage` but not `errorKey`/`errorParams`, while the reactivation
branch *in the same method* clears all three.

`087-force-replacement-arbitration` already lifted the most divergent piece out of these three
copies — the `force` demotion is now `DownloadsService.demoteDeliveredSources`, called identically
from all of them — which both proves the seam works and makes what is left cheaper to collapse. The
pipeline stages involved are **Find release** and **Download**; neither changes status, because this
feature changes no stage's behaviour beyond the refusals named below.

The shape to collapse them into is not "three branches behind one signature". Adding a release is a
request to the **torrent client**, and the torrent client does not care what the bytes are for: the
decision of what to do with them is already taken later, by whoever receives "finished" —
`DownloadsService.handleTorrentCompleted` arbitrates the race, `MediaSourcesService.sourceScanned`
resolves which episode or film each file belongs to, and `worker` is told a destination it consumes
blindly. That division already exists and works. What the three copies do is re-litigate the target
*before* the download, where almost none of it belongs. Four things genuinely need the target at
attach time — authorizing the caller against it, refusing the acquisition, labelling the torrent in
the client, and recording which row the `MediaSource` points at — and REQ-10 closes that list, so the
unified path is target-blind everywhere else by construction rather than by discipline.

The same argument applies, with a narrower and better-measured scope, to the fourth duplication
family nobody has written down: `MoviesService` and `ShowsService` each carry `cacheKey`, `search`,
`cacheAndEnrich`, `enrichWithOwnership` and a `cacheMovies`/`cacheShows` twin. A diff of those
regions is **nine substantive lines** — the TMDB path (`movie` / `tv`), the `title`/`name` and
`release_date`/`first_air_date` field names, the `MEDIA_TYPE` constant, the Prisma delegate, and
whether `isShort` is read from the row or fixed at `false`. Everything else in those two services —
`register`, `refresh`, `refreshCatalog` / `syncCatalogFromTmdb`, `hydrate`, `getCached*`,
`fetchFromTMDB`, `deriveContentKind` — is **not** a twin and is deliberately left alone; collapsing
only what is genuinely identical is the point, and § Out of Scope names what stays.

Two documents assert the opposite of this feature and must be reconciled rather than ignored.
`006-media-search` § Out of Scope says factoring the common lines of `MoviesService`/`ShowsService`
*"is explicitly not the goal — it is the outcome this design exists to avoid"*. Constitution Article X
names both duplications — `movies`/`shows` and the three twins of `attachTorrentSource` — as
*"deliberate duplication that outranks this article"*, adding that *"collapsing those is a spec-level
decision, not a cleanup"*. This is that spec-level decision, and NFR-1 and NFR-2 are how it is
recorded. The case is not tidiness: it is that hand-synchronised copies have now diverged four times
in a way that produces a wrong refusal message, a permanently burnt `infoHash`, a stale error record
and a row that violates an invariant the whole pipeline assumes.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (One attach path, target-blind by default)**: The six acquisition mutations —
      `addTorrentToMovie`, `addMagnetToMovie`, `addTorrentToEpisode`, `addMagnetToEpisode`,
      `addTorrentToSeason`, `addMagnetToSeason` — must resolve through a single implementation whose
      default posture is that it does not know or care what the release is for. It hands the release
      to the torrent client and records one `MediaSource`; what happens to the downloaded bytes stays
      the decision of the completion path that already makes it. No observable behaviour of one
      target kind may be expressible only by editing a copy the other two do not share.

- [ ] **REQ-2 (The conflict scope is complete and symmetric)**: For every one of the three target
      kinds, an acquisition whose `infoHash` is already attached to a film, to an episode, or to a
      season **other than the target itself** must be refused. The three target kinds must refuse
      the same set of collisions; today only a season target does.

- [ ] **REQ-3 (A `MediaSource` never carries more than one target)**: No acquisition may leave a
      `media_sources` row with more than one of `movieId`, `seasonId`, `episodeId` set. This is the
      invariant REQ-2's gap currently violates, and it must hold as a property of the write, not
      only as a consequence of the refusal.

- [ ] **REQ-4 (A conflict names the holder, not the target)**: When an acquisition is refused
      because the `infoHash` belongs to another title, the message must identify **the title that
      already holds it**. An episode target currently names the episode the user was adding to,
      which tells the user nothing and actively misleads them.

- [ ] **REQ-5 (Reusing an errored source clears its whole error record)**: When an acquisition
      reuses an existing `MediaSource` that was in `ERROR`, it must clear `errorMessage`, `errorKey`
      **and** `errorParams`. A film's main path currently leaves the last two set on a row it has
      just moved to `QUEUED`.

- [ ] **REQ-6 (One catalog search path)**: The per-media-type catalog search, its Redis caching and
      its ownership enrichment must be a single implementation parameterised by media type, serving
      both films and series. Observable behaviour must be unchanged: the same result shape, the same
      cache keys (`tmdb:movie:<tmdbId>`, `tmdb:show:<tmdbId>`), the same ordering, and the same rule
      that neither `inLibrary` nor `mediaId` is ever written into the cached entry
      (`006-media-search` AC-3).

- [ ] **REQ-7 (The cache-miss fallback writes back, for both media types)**: The fallback that
      re-fetches a single title from the catalog when its Redis entry is missing must write what it
      fetched back to the cache for **both** media types. A series does not today, which is why a
      cold series re-asks TMDB for the same facts on every registration inside the TTL — the series
      path carries a comment saying so and works around it downstream.

- [ ] **REQ-8 (Nothing else changes)**: Beyond REQ-2 through REQ-5 and REQ-7, every observable
      behaviour of the acquisition and search paths must be identical after this feature: the
      qBittorrent tag sets and category per target kind, the `add()`-before-any-write ordering, the
      `COMPLETED`/delivered-source refusal of `087` REQ-2, the `force` demotion of `087` REQ-3 and
      its "never cancels a download in flight" rule of `087` REQ-4, the upload precedence of `038`,
      the reactivation branch for an `infoHash` qBittorrent still holds, the per-target status
      writes, and each mutation's return type and eager relations.

- [ ] **REQ-9 (A collision is refused regardless of the holder's status)**: The conflict check must
      refuse a colliding `infoHash` without consulting the status of the source that holds it,
      including a source abandoned in `ERROR`. This keeps the behaviour all three copies have today
      and must not be "improved" while unifying them: it means an `infoHash` held by a failed source
      stays unusable for any **other** target until that source is deleted, which is a deliberate
      cost — a magnet is still reusable for the **same** target, which is the reactivation path
      REQ-8 preserves. An implementer who notices the asymmetry does not relax it here.

- [ ] **REQ-10 (The target-aware surface is enumerated and closed)**: Exactly four things in the
      unified attach path may depend on the target kind, and nothing else may:
      **(a)** resolving the target and authorizing the caller against it, including which
      `not_found` key a miss raises; **(b)** the refusal set — REQ-2's conflict scope and `087`
      REQ-2's delivered/`COMPLETED` guard, which for a season is a count of its `COMPLETED` episodes
      because a season has no status of its own; **(c)** the tag list and category handed to the
      torrent client; **(d)** which of `movieId` / `seasonId` / `episodeId` the `MediaSource` carries.
      Everything else — resolving the `infoHash`, the no-op on an `infoHash` already attached to this
      same target, the reactivation branch for a hash the client still holds, `add()` before any
      write, the `force` demotion, and the update-or-create itself — must have exactly one
      implementation with no target branch in it. A fifth kind of target-awareness appearing in this
      path is a defect, not an extension.

- [ ] **REQ-11 (The helpers the copies dragged along are one each)**: The small functions that were
      copied alongside `attachTorrentSource` must have exactly one definition. `sanitizeTag` — the
      qBittorrent tag sanitiser — exists **four** times, byte for byte identical, in the film,
      episode, season and downloads services. `episodeDisplayTitle` — the zero-padded
      `<Show> SxxEyy` rendering that REQ-4's corrected message depends on — exists **three** times,
      as a module function in one service and a private method in the other two, each carrying a
      comment explaining that it is deliberately not shared. A single definition of each is required,
      and `episodeDisplayTitle` must keep rendering exactly the format `web`'s search prefill builds
      (`SearchTorrent.tsx`), since the two must not disagree.

- [ ] **REQ-12 (The dead members go with the duplication)**: Code that only the copies justified must
      be removed, not carried over. `EpisodesService.findActiveSource` is public, `async`, and has no
      caller anywhere in `api` — `087` was the last thing that needed it. `SeasonsService`'s
      `activeSource` lookup (`status: { not: 'ERROR' }`) is a leftover of the predicate `087` replaced
      with `hasDeliveredSource`/`demoteDeliveredSources`, and now only gates a call that is already a
      no-op when there is nothing delivered. Neither may survive into the unified path.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Article X is amended before this feature closes)**: Constitution Article X names
      `movies`/`shows` and the three twins of `attachTorrentSource` as deliberate duplication that
      outranks the article. Collapsing both makes that text false. The article must be amended
      through `/constitution` — not by this spec, and not by an implementer — and the amendment must
      land before this feature is marked `Implemented`.

- [ ] **NFR-2 (`006-media-search` § Out of Scope is superseded, in writing)**: `006`'s refusal to
      factor the common lines of `MoviesService`/`ShowsService` must be recorded as superseded by
      this feature, naming the evidence rather than asserting a preference. REQ-6's scope is
      deliberately narrower than what `006` refused: the two services are **not** merged, and
      § Out of Scope lists what stays per-type.

- [ ] **NFR-3 (Tests are owed where the failure is silent)**: REQ-2, REQ-3 and REQ-4 describe bugs
      that produce no error in any log and no failure in any existing test — a two-target row, a
      permanently refused magnet, a wrong title in a user-facing message. Each must be covered by a
      test that opens with the paragraph Article IX requires.

- [ ] **NFR-4 (The comment debt goes with the duplication)**: Every comment that exists only to
      cross-reference a twin — the "structural twin of …", "kept local rather than shared", and
      "symmetric with the check … now does" paragraphs, plus the orphaned "Demote *before* creating
      the replacement" prose now sitting beside `087`'s locator in all three copies — must be
      removed or replaced by a `// Spec NNN, <ref>` locator. `bin/comments api` must pass
      (Article XI, `086-comment-locator-convention`).

- [ ] **NFR-5 (The remaining Spanish runtime strings in these paths become English)**: The catalog
      cache helpers still log in Spanish (`Error guardando … de TMDB en Redis`, and its twin in the
      film service's `catch`). Article VI governs them and `bin/comments` does not catch strings.
      They are inside the code this feature rewrites, so they are fixed here rather than left.

- [ ] **NFR-6 (No GraphQL surface is added or renamed)**: The SDL is unchanged. The delta below is
      error conditions only, and both keys it introduces to new mutations already exist in `api`'s
      key vocabulary and in both `web` locale catalogs, which is why `services:` is `[api]` alone.

- [ ] **NFR-7 (The diff removes more than it adds)**: Article X's own check. `movies.service.ts`
      (812 lines) and `shows.service.ts` (641) must both shrink; `episodes.service.ts` (205) and
      `seasons.service.ts` (310) lose their copies. This is the measurement that distinguishes a
      consolidation from a new abstraction layer.

- [ ] **NFR-8 (`docs/spec/graphql-contract.md` records the delta and stops naming the twins)**:
      Article VIII makes that file the record of the `web`/`worker` ↔ `api` boundary. It must gain
      this feature's error-condition delta, and its seven existing references to
      `attachTorrentSource` must stop describing three separate methods — §1034 in particular asserts
      that each of `attachTorrentSource` (movies/episodes/seasons) keeps "their names, status or
      copy", which this feature makes false.

- [ ] **NFR-9 (The two living documents are corrected in the same change)**: The root `CLAUDE.md`
      Download row calls `SeasonsService` *"the third twin of
      `MoviesService`/`EpisodesService.attachTorrentSource`"*; after this feature there is no third
      twin and no first one. And `docs/spec/history.md` takes this feature's measurement entry,
      newest first, per `086` REQ-10 and REQ-11 — never the root `CLAUDE.md`.

## GraphQL Contract Delta

The SDL is **unchanged**. No type, field, mutation or argument is added, removed or renamed; every
mutation keeps its current signature and return type:

```graphql
type Mutation {
  addTorrentToMovie(movieId: Int!, infoHash: String, urls: [String!]!, releaseTitle: String, force: Boolean = false): Movie!
  addMagnetToMovie(movieId: Int!, magnet: String!, force: Boolean = false): Movie!
  addTorrentToEpisode(episodeId: Int!, infoHash: String, urls: [String!]!, releaseTitle: String, force: Boolean = false): Episode!
  addMagnetToEpisode(episodeId: Int!, magnet: String!, force: Boolean = false): Episode!
  addTorrentToSeason(seasonId: Int!, infoHash: String, urls: [String!]!, releaseTitle: String, force: Boolean = false): Season!
  addMagnetToSeason(seasonId: Int!, magnet: String!, force: Boolean = false): Season!
  searchMedia(query: String!, type: String!): [MediaSearchResult!]!
}
```

What changes is the set of refusals each mutation can produce. `web` and `worker` retype this by
hand, so the two additions are listed even though no field moves:

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `addTorrentToMovie` / `addMagnetToMovie` whose `infoHash` is already attached to a **season** (REQ-2 — today this is silently accepted and corrupts the row) | `ConflictException` — `error.magnet.already_attached_season`, params `{show, number}` | `Ese magnet ya está asociado a «{show} Temporada {number}»` |
| `addTorrentToEpisode` / `addMagnetToEpisode` whose `infoHash` is already attached to a **season** (REQ-2 — same) | `ConflictException` — `error.magnet.already_attached_season`, params `{show, number}` | `Ese magnet ya está asociado a «{show} Temporada {number}»` |
| `addTorrentToEpisode` / `addMagnetToEpisode` whose `infoHash` is already attached to a **different episode** (REQ-4 — the condition already refuses; the params change from the target episode to the holding one) | `ConflictException` — `error.magnet.already_attached`, params `{title}` | `Ese magnet ya está asociado a «{title}»` — where `{title}` is now the episode that holds it, e.g. `Breaking Bad S02E05` |

Both keys already exist: `ERROR_KEYS.MAGNET_ALREADY_ATTACHED` and
`ERROR_KEYS.MAGNET_ALREADY_ATTACHED_SEASON` in `api`, and `magnet.already_attached` /
`magnet.already_attached_season` in both `services/web/messages/en.json` and `es.json`.

**Consumer obligation — `web`: none.** `web`'s two acquisition surfaces
(`components/search/SearchTorrent.tsx`, `components/import/importMagnetModal.tsx`) render the
resolved message from the error envelope and branch on `errorKey` only to decide whether to offer the
replacement confirmation (`ALREADY_COMPLETED_KEYS`). A conflict key that is not in that list already
displays correctly and offers no confirm control, which is the intended behaviour for a collision.
No `web` change is required and none is in scope; this is verified by AC-1 and AC-3.

**Consumer obligation — `worker`: none.** The worker reads `MediaSource` through
`EncodeJobDetails`/`source-ready`, and REQ-3 only ever *narrows* what it can receive: a row with one
target instead of possibly two. No payload field changes.

Every other refusal these mutations already produce is unchanged and not re-listed:
`error.movie.not_found`, `error.episode.not_found`, `error.season.not_found`,
`error.movie.already_completed`, `error.episode.already_completed`,
`error.season.already_completed`, `error.magnet.invalid`, `error.indexer.no_infohash`,
`error.download.torrent_client_rejected`.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |

**None.** No model, field, enum or index changes, and no migration is generated. REQ-3 is an
invariant of the write path. Whether the database should also enforce it is settled outside this
feature and before it: this spec assumes no schema change, and if a constraint lands first, REQ-3 and
AC-4 are unaffected — they describe the behaviour, not where it is guarded.

## Acceptance Criteria

- [x] **AC-1 (failure path)**: Given a magnet attached to a season via `addMagnetToSeason`, when the
      same magnet is submitted to a film from the film detail page, then the mutation is refused with
      `errorKey` `error.magnet.already_attached_season`, the rendered message names that show and
      season number, `web` offers no confirmation control, and
      `bin/mysql -e 'select movieId, seasonId, episodeId from media_sources where infoHash = "<hash>"'`
      still shows **only** `seasonId` set. Before this feature the same steps succeed and that query
      returns both `movieId` and `seasonId`.

- [x] **AC-2 (failure path)**: The same against an episode, via the episode row's search modal:
      refused with `error.magnet.already_attached_season`, and the row keeps only its `seasonId`.

- [x] **AC-3 (failure path)**: Given a magnet attached to episode S02E05 of a series, when the same
      magnet is submitted to S03E01 of that same series, then the message names **S02E05**. Before
      this feature it names S03E01.

- [x] **AC-4**: `bin/mysql -e 'select count(*) from media_sources where (movieId is not null) + (seasonId is not null) + (episodeId is not null) <> 1'`
      returns **0** after exercising AC-1, AC-2, AC-3 and AC-6.

- [x] **AC-5**: Given a film whose `MediaSource` is in `ERROR` with a non-null `errorKey`, when the
      same release is added again and qBittorrent no longer holds the hash, then
      `bin/mysql -e 'select status, errorMessage, errorKey, errorParams from media_sources where id = <id>'`
      returns `QUEUED` with all three error columns `NULL`.

- [x] **AC-6**: All six mutations still work end to end for a target with no collision: a film, an
      episode and a season each accept a search result and a pasted magnet, the torrent appears in
      qBittorrent with the tags and category that target kind had before this feature (film:
      `<title>` + category `movie`/`short`; episode: `<show>`, `Season N`, `Episode M` + category
      `show`; season: `<show>`, `Season N` + category `show`), `downloadPath` is non-empty, and the
      target's status becomes `DOWNLOADING`.

- [x] **AC-7**: `087`'s guarantees still hold verbatim: a `COMPLETED` film refuses without `force`
      and accepts with it, a confirmed replacement demotes the delivered sources and leaves a
      sibling that is still downloading untouched (`087` AC for REQ-3 and REQ-4 re-run), and
      replacing a film reaches `SCANNED` end to end.

- [x] **AC-8**: `searchMedia(query: "breaking bad", type: "show")` and
      `searchMedia(query: "dune", type: "movie")` return the same fields, in the same order, as
      before this feature; `bin/cli redis redis-cli get tmdb:show:<tmdbId>` and
      `... get tmdb:movie:<tmdbId>` both return a JSON object containing neither `inLibrary` nor
      `mediaId` (`006` AC-3 still holds); and a result already in the caller's library reports
      `inLibrary: true` while one only another user registered reports `false` with a non-null
      `mediaId`.

- [x] **AC-9**: Given `bin/cli redis redis-cli del tmdb:show:<tmdbId>` for a series not yet
      registered, when that series is registered, then `bin/cli redis redis-cli get tmdb:show:<tmdbId>`
      returns a populated entry afterwards (REQ-7). The same already holds for a film and must keep
      holding.

- [x] **AC-10**: `bin/npm api test` passes, `bin/cli api npx --no tsc --noEmit` exits 0 (there is
      no `typecheck` script in `services/api/package.json`), and `bin/comments api` exits 0 (NFR-4).

- [x] **AC-11**: `git diff --stat` for this feature shows more lines removed than added across
      `services/api/src`, and `wc -l` on `movies/movies.service.ts` and `shows/shows.service.ts`
      is lower than 812 and 641 respectively (NFR-7).

- [x] **AC-12**: `docs/constitution.md` Article X no longer names these two duplications as
      deliberate, and its version and Changelog record the amendment (NFR-1). Verified by reading
      the article, not by a command.

- [x] **AC-13**: Reading the unified attach path, the target kind is consulted in exactly the four
      places REQ-10 lists and nowhere else: no per-target branch appears in the `infoHash`
      resolution, the already-attached-to-this-target no-op, the reactivation branch, the
      `add()`-before-write ordering, the `force` demotion, or the update-or-create. A reviewer who
      can point at a fifth has found a defect, and this criterion fails.

- [x] **AC-14**: `grep -rn "function sanitizeTag" services/api/src` returns **one** hit (it returns
      four today), and `grep -rn "episodeDisplayTitle" services/api/src --include=*.ts` shows one
      definition (three today). `grep -rn "findActiveSource" services/api/src` returns nothing.

- [x] **AC-15**: `docs/spec/graphql-contract.md` carries this feature's error-condition delta, the
      root `CLAUDE.md` Download row no longer refers to a third twin, and `docs/spec/history.md` has
      a new newest-first entry for this feature. Verified by reading the three files.

## Out of Scope

- **Splitting `downloads.service.ts`.** It is the largest service in the api and grew to 1063 lines
  when `087` landed `demoteDeliveredSources` in it, and it does have four clean seams — the read and
  projection half behind the four listing resolvers, the start/stop/delete control half, the unwind
  and residue half, and the arbitration half (`resolveRace`, `handleTorrentCompleted`, the
  `recompute*` family) that `SeasonsService`, `EpisodesService`, `MoviesService` and `UploadsService`
  all reach into. Splitting it is worth doing and is not this feature: it touches a different set of
  callers, it carries none of the drift evidence that justifies the collapse above, and bundling a
  second large no-behaviour-change refactor into one diff is how a silent regression hides. Its own
  spec, after this one.

- **Unifying `register`, `refresh`, `refreshCatalog`/`syncCatalogFromTmdb`, `hydrate`, `getCached*`,
  `fetchFromTMDB` or `deriveContentKind` between films and series.** These look like twins and are
  not. A film's registration derives `isShort`, tops up three typed release dates, a TMDB production
  status and `catalogClosedAt`, and reconciles synchronously; a series' registration hydrates seasons
  and episodes in the background under a Redis claim and branches on `seasonsSyncedAt`. Their refresh
  paths differ for the same reasons (`069`, `074`, `075`). REQ-6 covers only the five genuinely
  identical members of that family, and REQ-7 fixes the one asymmetry inside the rest that has a
  measurable cost.

- **`deriveContentKind`'s two different keyword-failure fallbacks.** Settled outside this feature
  and before it. REQ-7 removes the reason the series version diverged; which fallback is correct is a
  classification decision, not a refactor, and this spec neither asks it nor depends on the answer.

- **Merging `MoviesService` and `ShowsService`, or introducing a base class or a generic media
  engine.** This is what `006` § Out of Scope refused and the refusal still stands for everything
  except the five members REQ-6 names. The two services keep their own Prisma model, their own error
  keys, their own registration and their own refresh. Nothing in this feature may be shaped around a
  hypothetical third media type.

- **The `movieId` naming debt** (root `CLAUDE.md` § Known debt). The argument on
  `addTorrentToMovie`/`addMagnetToMovie`/`createUploadTicket`, the tus metadata key and
  `MediaSource.movieId` keep their current names and meanings. Renaming them crosses three services
  with no codegen between them and needs `docs/spec/graphql-contract.md` to move first; a
  unification that quietly renamed them would break the pipeline at runtime with no compile error
  anywhere.

- **Any change to what a release search returns or how it is ranked.** `073`'s server-side
  `candidateRank`, `036`'s cinema-release veto and `040`'s Redis read-through are untouched. This
  feature begins at the moment a release has been chosen.

- **Telling "queued in the torrent client" apart from "actually downloading".** The attach path
  writes the `MediaSource` as `QUEUED` and, in the same breath, the title as `DOWNLOADING`; since
  `deriveTitleStatus` (`043`) takes the maximum of the two, a title reads `DOWNLOADING` from the
  moment it is attached. With a client queue limit — 50 releases attached and three slots — the
  other 47 are not downloading, and nothing in the system says so. This is not merely a stale stored
  column: **no code path ever persists `SourceStatus.DOWNLOADING`** (the complete set of writes is
  `PENDING`, `QUEUED`, `PAUSED`, `READY`, `SCANNED`, `ERROR`), and the live reading does not
  distinguish them either, because `mapTorrentState` puts qBittorrent's `queuedDL` inside
  `DOWNLOADING_STATES` and has no branch returning `QUEUED` at all
  (`src/clients/torrent/client.ts`). Making the distinction real needs that mapping to change and
  `deriveTitleStatus` to take live torrent state as an input, which it does not today — a feature
  with its own observable behaviour, its own `web` copy and its own failure modes. REQ-8 therefore
  keeps the current writes exactly as they are, including the `DOWNLOADING` one, and this is its own
  spec.

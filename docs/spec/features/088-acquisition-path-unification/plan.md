---
title: One acquisition path, one catalog search path — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-06
status: Implemented
---

# PLAN: One acquisition path, one catalog search path (`plan.md`)

## Approach

Two independent collapses land in one feature because they share one argument — hand-synchronised
copies drifted and produced defects — and nothing else. They touch disjoint code and can be built
and verified separately. `api` is the only service in `services:`, so this cross-service plan is
short by construction: its real job is the contract freeze, the risk register and the order, because
the per-file detail belongs in `api/plan.md`.

**The acquisition collapse reuses a seam that already exists rather than inventing one.** `087`
already pulled the most divergent piece — the `force` demotion — out of the three copies into
`DownloadsService.demoteDeliveredSources`, and the delivered-source predicate into
`DownloadsService.hasDeliveredSource`. Both are called identically from all three services today.
That proves the direction and sets the pattern: the shared attach lives beside those, takes the same
collaborators (`PrismaService`, `QbittorrentClient`, `DownloadsService`), and the three domain
services keep their public methods and call into it. The new seam is a **target descriptor**: the
four things REQ-10 permits to vary, supplied by the caller as data. Everything else — resolving the
`infoHash`, the no-op for a hash already on this target, the reactivation branch, `add()` before any
write, the demotion call, the update-or-create — has one body with no target branch in it.

The alternative was a base class the three services extend. Rejected: inheritance would put the
shared body *inside* the per-target services, which is where the drift happened, and it makes
REQ-10's "exactly four, and a fifth is a defect" unenforceable — a subclass can override anything.
A descriptor passed to a collaborator makes the permitted variation a visible, countable argument
list.

**The catalog collapse plugs into `media/`'s existing dispatch, and does not touch it.**
`src/media/media-type.interface.ts` already declares the whole boundary (`search`, `register`,
`cacheAndEnrich`) and `src/media/media-dispatch.service.ts` already resolves a type to a service.
`026-multi-search` already extracted `cacheAndEnrich` out of both `search()` implementations for
exactly this reason — "so a fan-out search never becomes a third copy of the cache-before-enrich
ordering". REQ-6 finishes that job one level down: a shared catalog-search collaborator holds the
one implementation of the TMDB search, the cache write and the ownership enrichment, and
`MoviesService`/`ShowsService` keep implementing `MediaTypeService` by delegating to it with their
own descriptor. **`MediaTypeService` does not change, `MediaDispatchService` does not change, and
`MediaSearchService`/`PopularMediaService` keep calling `cacheAndEnrich` exactly as they do now** —
they must not learn that anything moved.

`register`, `refresh`, `refreshCatalog`/`syncCatalogFromTmdb`, `hydrate`, `getCached*`,
`fetchFromTMDB` and `deriveContentKind` stay per-type (spec § Out of Scope). REQ-7 is the single
exception inside that set and is a two-line change, not a restructure: the series' cache-miss
fallback writes back the way the film's already does.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | The two drift defects (REQ-2/3/4) are fixed **in the three existing copies**, before any restructuring, each with the test NFR-3 owes it. This is the only step whose behaviour a user can observe, and isolating it means `git bisect` can tell a behaviour fix from a refactor. |
| 2 | `api` | REQ-5 and REQ-12's dead members, still in place — small, independent, no new file. |
| 3 | `api` | The acquisition collapse (REQ-1, REQ-8, REQ-9, REQ-10) plus REQ-11's helpers. The step-1 tests are now the regression net that proves the collapse changed nothing. |
| 4 | `api` | The catalog collapse (REQ-6) and REQ-7. Disjoint from steps 1–3; could run in parallel with 3 by a second agent, and the order between them does not matter. |
| 5 | `api` | NFR-4 (comments), NFR-5 (the Spanish log strings). Last, because steps 3 and 4 delete most of the comments in question. |
| 6 | `docs` | NFR-8 (`graphql-contract.md`), NFR-9 (root `CLAUDE.md`, `history.md`), NFR-1's amendment via `/constitution`, and the `api`/`CLAUDE.md` correction recorded under § Decided Here. Last, so it records what landed and not what was intended. |

**Steps 3 and 4 are the only genuinely parallel pair.** They share no file. Steps 1 and 2 must
precede 3, because fixing a defect inside a structure you have just replaced loses the evidence that
the replacement preserved behaviour. Step 6 must be last.

`web` and `worker` are not in `services:` and get no step: the SDL does not change, both new error
conditions resolve through the envelope `web` already renders by key, and the keys already exist in
both locale catalogs.

## Contract Freeze

`spec.md`'s `## GraphQL Contract Delta` is frozen as of `status: Approved`. The SDL is unchanged;
the delta is two error conditions plus one parameter change. Things an implementer will want to
change and must not:

- **The six public method names on the three services.** `MoviesService.addTorrentToMovie` and
  `EpisodesService.addTorrentToEpisode` have callers outside their resolvers — the `076` and `073`
  sweeps (`src/scheduler/tasks/acquire-movies.task.ts:108`,
  `acquire-episodes.task.ts:108`) call them directly with `force: false`. The collapse is behind
  these methods, never instead of them. Renaming them to something the shared path prefers breaks
  two scheduled sweeps with no compile error in any resolver.

- **`MediaTypeService` (`src/media/media-type.interface.ts`).** Its three members and their
  signatures do not change. Its doc comment asserts that no cache key or catalog endpoint crosses
  the boundary; that stays true — the descriptor is passed *into* a collaborator by each service, it
  does not travel out through the interface. Widening the interface to carry the descriptor would
  move per-type knowledge into the dispatch, which is the thing `006` was right to refuse.

- **`force` semantics, in any direction.** `087` REQ-1 fixed `force` to mean exactly one thing —
  the user was shown the replacement warning and accepted it. REQ-8 keeps every bit of `087`'s
  behaviour. An implementer who notices that the season copy gates the demotion behind an extra
  `activeSource` lookup must delete the gate (REQ-12), not generalise it.

- **The `DOWNLOADING` write on the target at attach time.** It is wrong — the torrent is `QUEUED`
  and a client queue limit means most attached releases are not downloading — and it is deliberately
  kept (spec § Out of Scope). Changing it here would make every acceptance criterion about "nothing
  else changed" unverifiable.

- **REQ-9's refusal.** A colliding `infoHash` is refused without consulting the holder's status,
  including a holder in `ERROR`. This is the current behaviour of all three copies and relaxing it
  while unifying them is explicitly out of bounds.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve. Never patch it from
inside a slice (Article VIII).

## Migrations

**None.** No model, field, enum or index changes. REQ-3 is enforced by the write path.

Whether the database should also constrain it is settled outside this feature (spec § Data Model
Changes). If such a migration lands first, nothing here changes: REQ-3 and AC-4 describe the
behaviour, not where it is guarded.

Reversibility: the whole feature is revertible as a plain code revert, with one caveat recorded
under § Risks — rows already corrupted by the REQ-2 gap are not repaired by this feature and are not
re-corrupted by a revert.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **Rows already carrying two targets exist in this installation.** The REQ-2 gap has been reachable since `059`. | Silent today and silent after the fix: AC-4's invariant query fails on historical rows and an implementer "fixes" it by writing a cleanup, deleting a target column someone's library depends on. | AC-4 is run **before** step 1 as well as after. A pre-existing non-zero count is reported, not repaired: this feature closes the hole, it does not migrate data, and repairing a row means choosing which target to drop — a decision with a file on disk behind it. Record the count in `history.md`. |
| **The collapse changes behaviour nobody notices**, because the three copies' differences were never all enumerated. | A season acquisition silently stops tagging, or a film stops reaching `DOWNLOADING`, and only a user with that exact target kind sees it, weeks later. | Step 1 before step 3 is the structural defence. On top of it: AC-6 exercises all six mutations against all three target kinds including tags and category, and AC-7 re-runs `087`'s own criteria. The three existing `*.service.spec.ts` files are the net and must keep passing **unmodified** wherever they assert behaviour. |
| **`episodeDisplayTitle` drifts from `web`'s prefill format** once there is one copy and REQ-4 starts using it in a message. | The conflict message and the search box disagree on how an episode is named; nothing errors. | REQ-11 names the constraint and `web`'s `SearchTorrent.tsx` is the reference. The one definition gets the unit test; AC-3 reads the rendered message. |
| **A cycle in the Nest module graph.** The shared attach needs `DownloadsService`; three domain modules need the shared attach. | Nest fails at boot, loudly — not silent, but it will tempt an implementer into `forwardRef`. | `DownloadsService`'s constructor takes `PrismaService`, the two queues, `QbittorrentClient` and `SettingsService` — it does not depend on movies, episodes or seasons, so the graph is acyclic. This repo has **no** `forwardRef` anywhere and three comments explaining why not; introducing one is a stop-and-report. |
| **`cacheAndEnrich`'s cache-before-enrich ordering is lost** in the catalog collapse. | The Redis entry gets written with `inLibrary`/`mediaId` in it, so one user's ownership leaks into every other user's search results from cache. | This is the specific trap `026` extracted the method to avoid, and both services carry a comment about it. AC-8 asserts the cached JSON contains neither field — the same check `006` AC-3 made. Owed a test under Article IX. |
| **The sweeps break silently.** `073`/`076` call two of the six methods directly. | A scheduled sweep throws into a logged-and-swallowed task; no user-facing error, episodes quietly stop being acquired. | Named in § Contract Freeze. `acquire-movies.task.spec.ts` and `acquire-episodes.task.spec.ts` already mock those methods by name and must keep passing unmodified. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/comments api
```

Invariant and duplication checks, which are acceptance criteria in their own right:

```bash
bin/mysql -e 'select count(*) as two_target_rows from media_sources where (movieId is not null) + (seasonId is not null) + (episodeId is not null) <> 1'
grep -rn "function sanitizeTag" services/api/src
grep -rn "episodeDisplayTitle" services/api/src --include=*.ts
grep -rn "findActiveSource" services/api/src
git diff --stat
wc -l services/api/src/movies/movies.service.ts services/api/src/shows/shows.service.ts
```

Run the invariant query **once before step 1** and keep the number.

Manual pass, with the stack up (`bin/dev -d`):

1. Attach a magnet to a season from the season accordion header. Then paste the same magnet on a
   film's detail page → refused, naming that show and season, no confirm control (AC-1). Then the
   same magnet on an episode of any series → same refusal (AC-2). Query the row: only `seasonId`.
2. Attach a magnet to S02E05 of a series, then submit it to S03E01 → the message names **S02E05**
   (AC-3).
3. For each of a film, an episode and a season: add a release from the search modal and a pasted
   magnet. Check qBittorrent for the tag set and category, and the target for `DOWNLOADING` (AC-6).
4. Take a film to `COMPLETED`, replace it without `force` (refused), then confirm (accepted), and
   follow it to `SCANNED`; while it downloads, confirm a still-downloading sibling is untouched
   (AC-7).
5. Force a film's source to `ERROR`, re-add the same release, and read the row: `QUEUED` with all
   three error columns `NULL` (AC-5).
6. Search a film and a series from the header box; read both Redis entries (AC-8). Delete a series'
   entry and register that series; read the entry again (AC-9).
7. Read `docs/spec/graphql-contract.md`, the root `CLAUDE.md` Download row, `docs/spec/history.md`
   and Article X (AC-12, AC-15).

## Decided Here

What the spec did not cover and this plan settles:

- **`services/api/CLAUDE.md` is a third document NFR-2 must correct.** Its `media/` section states
  that "cache keys, endpoints, error strings and Prisma models stay private to each per-type
  implementation by design" and that the interface carries "no cache key, no catalog endpoint, no
  `type` getter". The second half stays true after REQ-6 and the first half becomes half-true — the
  cache *key shape* becomes shared, the keys themselves stay per-type. It is corrected in step 6
  alongside the root `CLAUDE.md`. The same applies to the doc comment at the top of
  `media-type.interface.ts`, which survives but needs its parenthetical re-pointed.

- **The acquisition collapse gets its own module rather than living in `downloads/`.** Putting it in
  `DownloadsService` would grow the service this feature's § Out of Scope already names as the next
  thing to split, from 1063 lines upward. `api/plan.md` names the location.

- **Step 1 before step 3 is a requirement of this plan, not a preference.** The spec states the
  defects and the collapse as peers; sequencing them is what makes AC-6 and AC-7 meaningful, because
  a passing test written against the old structure is the only evidence the new one is equivalent.

- **The pre-existing two-target row count is reported, never repaired.** See § Risks. The spec's
  AC-4 reads as a post-condition; this plan makes it a pre-condition measurement too.

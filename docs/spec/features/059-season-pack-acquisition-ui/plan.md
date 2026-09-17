---
title: Season Pack Acquisition UI — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-09-17
status: Implemented
---

# PLAN: Season Pack Acquisition UI (`plan.md`)

## Approach

Two independent halves meet at one new mutation.

**`api` — a fourth entry point on an existing twin, plus a read-time lift.**
`addTorrentToSeason` is added to `SeasonsService`/`SeasonsResolver` (`services/api/src/seasons/`)
as the season twin of `EpisodesService.addTorrentToEpisode`: resolve a null `infoHash` with
`resolveInfoHash` (`src/clients/indexer/resolve-info-hash.ts`) and then call the **existing**
private `SeasonsService.attachTorrentSource` with `kind: 'TORRENT_SEARCH'`. No new conflict,
tagging, demotion or collision logic — `attachTorrentSource` already implements every rule REQ-5
lists, and `addMagnetToSeason` already proves it.

REQ-7 is a **read-time projection, never a write**. The alternative — writing
`Episode.status = DOWNLOADING` on every aired episode when a pack is attached, the way
`EpisodesService.attachTorrentSource` does for its one episode — was rejected: `MediaStatus` has
no `QUEUED`, and every exit from "pack in flight" (scan with unmatched episodes, `force` demotion,
`047` deletion, a scan `ERROR`) would then need its own un-write, several of them in
`MediaSourcesService.sourceScanned` and `DownloadsService`, which this feature otherwise does not
touch. Deriving it instead makes REQ-8 hold by construction: the stored column never carries the
lift, so `DownloadsService.recomputeEpisodeStatus` (which recomputes from the episode's own rows
only) keeps writing exactly what it writes today.

The projection lives in `src/pipeline-status/pipeline-status.ts`, the module that already owns
every status a user reads, as one pure predicate: "does this season have a pack in flight that
lifts this episode" — true when some season source is neither `ERROR` nor `SCANNED` **and** the
episode's `releaseDate` is non-null and not after now. When it is true, the episode's derivation
receives one extra synthetic `{ status: 'QUEUED' }` source, so the existing `deriveTitleStatus`
max-ladder does the rest unchanged: `ERROR` still wins only from the column, `DOWNLOADING`/
`ENCODING`/`COMPLETED` are never lowered. `deriveTitleStatus` itself is not modified.

`ShowsService` (`src/shows/shows.service.ts`) is the only reader: `findOneFromDb` and
`setContentKind` both build the `show → seasons → episodes` include and both map
`deriveTitleStatus` over episodes with identical code. Both gain the season's non-`ERROR`
`mediaSources` in the include; the duplicated mapping is collapsed into one private method that
applies the lift, so the two readers cannot drift (Article X). One `include` level, no per-episode
query (NFR-3).

**`web` — a third `AcquisitionTarget` branch.** `src/types/media.ts`'s union gains
`{ kind: "season"; season; showTitle; audioMandatory; audioLanguages }`, and the three consumers
that must accept it (`SearchTorrent.tsx`, `SearchTorrentModal.tsx`, `importMagnetModal.tsx`) grow a
season branch. `importFileModal.tsx` and `createUploadTicketAction` are narrowed to a union
**without** the season branch, so the disabled button (REQ-2) is also a type-level guarantee — no
season target can reach an upload by accident. The three copies of the "target label" ternary
(`SearchTorrent`, `SearchTorrentModal`, `importMagnetModal`, plus `importFileModal`) and the three
copies of "is this target completed" are consolidated into one helper under `src/lib/` rather than
growing a third arm in four places. The header buttons are a new, single-component file under
`src/components/shows/`; `SeasonAccordion.tsx` already violates "one renderable component per file"
and must not gain a second extra component.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Exposes `addTorrentToSeason` and the lifted `Episode.status`. The contract is already frozen in `spec.md`, so `web` does not need to wait for it to *write* code — only to *verify* end to end. |
| 1 | `web` | Parallel with `api`: the delta is frozen and `addMagnetToSeason` already exists, so the magnet path is testable immediately; the search path is testable once step 1 `api` lands. |
| 2 | `[docs]` orchestrator | `docs/spec/graphql-contract.md` gains a `059` section (the new mutation, `Episode.status` now able to read `QUEUED` with no own source/job); root `CLAUDE.md` drops the "season pack is api-only" gap and updates the Find release / Download rows and the Current state measurement; `services/api/CLAUDE.md` `seasons/` and `pipeline-status/` entries; `services/web/CLAUDE.md` `AcquisitionTarget` section. After both services, since it records what they actually did. |
| 3 | verify | Manual pass below, needs both. |

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things that will
look wrong from inside one slice and are not:

- **`addTorrentToSeason` returns `Season!`, and `web` selects only `id`.** `Season` has no status;
  do not add one to make the action's return look like the episode twin's. `web` refreshes the page.
- **No `episodeId`/`seasonId` rename or generalisation.** Do not fold the season mutation into
  `addTorrentToEpisode` with an optional argument — the three twins are deliberate (NFR-2,
  Article X's named exception).
- **The lift is `QUEUED`, not the pack's torrent state.** An implementer will be tempted to pass the
  season source's real status (`DOWNLOADING`, `PAUSED`) through. The spec (REQ-7) says `QUEUED`:
  progress belongs to the downloads panel.
- **A null `releaseDate` is not aired.** Do not default it to "aired" to be generous.
- **A stored `ERROR` episode stays `ERROR` under a pack in flight.** That is `043`'s rule
  (`ERROR` only from the column) and the lift does not override it.
- **No `@AllowService()`** on the new mutation, same as every acquisition mutation.

If any of this has to change: stop, amend `spec.md`, re-approve, re-brief both services.

## Migrations

None. `MediaSource.seasonId`, `Season.mediaSources`, `Episode.releaseDate` and every status enum
already exist (NFR-1).

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Lift keyed on the wrong "not yet scanned" set (e.g. only `DOWNLOADING`) | A `READY` pack (downloaded, waiting for the worker) or a `PAUSED` one drops the episodes back to `MISSING` mid-flight; no error anywhere | The predicate is "not `ERROR` and not `SCANNED`" over `SourceStatus`; `pipeline-status.spec.ts` covers `PENDING`/`QUEUED`/`PAUSED`/`DOWNLOADING`/`READY` lifting and `SCANNED`/`ERROR` not |
| Lift written to the column instead of derived | After deletion or a partial scan, episodes stay `DOWNLOADING` forever — exactly AC-7/AC-8 failing silently | Plan forbids writes; api plan names `recomputeEpisodeStatus` and `sourceScanned` as untouched; AC-7/AC-8 in the manual pass |
| `setContentKind` keeps its own copy of the mapping | Changing a show's content kind returns episodes without the lift, so the page flickers to `MISSING` after that action with no error | Both readers go through one private method; `shows.service.spec.ts` asserts the lift through `findOneFromDb`, and `setContentKind` calls the same method |
| Season `mediaSources` include not filtered / not added to `setContentKind` | Missing include → `undefined.some` crash (loud); unfiltered include is harmless but heavier | Include filtered `status: { not: 'ERROR' }`; typecheck catches a missing include through the Prisma payload type |
| Timezone on `releaseDate` | An episode airing "today" in the user's zone but stored at UTC midnight tomorrow reads `MISSING` for a few hours | Accepted: comparison is `releaseDate <= now` server-side; worst case is one episode lifting a few hours late |
| `web` narrowing `AcquisitionTarget` wrongly | A season target reaching `importFileModal` would send `episodeId: undefined, movieId: undefined` to `createUploadTicket` | `importFileModal`/`createUploadTicketAction` take a type that excludes `"season"`; the typecheck enforces it |
| New error keys only in `es` | Spanish renders, English falls back to raw `api` text or vice versa; no crash | `bin/cli web node scripts/check-messages.mjs` |
| Nested interactive elements in the accordion header | Buttons inside the toggle `<button>` are invalid HTML; click bubbling toggles the accordion (AC-1) | Header restructured so the toggle button and the action buttons are siblings, not nested |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
git status --short services/api/prisma
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/cli web node scripts/check-messages.mjs
bin/npm web run build
git diff --stat services/worker
```

Expected: both typechecks 0 errors; `api` tests all pass with a higher count than 517/46; `prisma`
status empty; `check-messages` no drift; build exits 0; `worker` diff empty (NFR-4).
`services/api/src/schema.gql` diff shows exactly one added mutation, `addTorrentToSeason`, matching
`spec.md`.

Manual pass on `/shows/<id>` for a series with one fully aired season and one season with future
episodes:

1. AC-1 — three buttons on each season header; import-file disabled; search/magnet do not toggle.
2. AC-2 — magnet on the aired season: modal closes, downloads panel row "<Show> Temporada N",
   aired episodes `QUEUED`, future/undated `MISSING`;
   `bin/mysql -e 'select seasonId, episodeId, kind from media_sources order by id desc limit 1'`.
3. AC-3 — search modal prefilled `<Show> S0N`; add a result; same query shows `TORRENT_SEARCH`.
4. AC-4 — pick a result with no `infoHash` and an unresolvable URL; error shown, no new row.
5. AC-5 — on a season with one `COMPLETED` episode: warning shown up front; submit; that episode
   stays `COMPLETED`.
6. AC-6 — submit a magnet already attached to a film; "already attached" message naming it.
7. AC-7 — let a pack finish; after scan, matched episodes follow their jobs, unmatched ones `MISSING`.
8. AC-8 — delete an in-flight pack from the downloads panel; episodes back to prior status.
9. AC-9 — switch UI locale to `es` and repeat 4 and 6.

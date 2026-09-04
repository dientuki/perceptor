---
title: Pipeline Status Normalization — api slice
service: api
last_updated: 2026-09-03
status: Implemented
---

# PLAN: Pipeline Status Normalization — `api` (`api/plan.md`)

## Scope

This service owns the entire derivation. It adds one leaf module holding a pure function, routes
every published status through it, widens the `Download` type with the two fields the compression
bar needs, and records the two control-mutation writes REQ-7 asks for.

It is **not** doing: any Prisma schema change or migration (NFR-1 — `services/api/prisma/` must stay
clean, AC-13 checks it); anything to `Show.status`; anything to `MediaSource.status`, which stays the
raw `SourceStatus` column because the worker reads it (REQ-8); and no rendering decision — `web`
owns every string a user sees, including the translation of the eight values.

Read `../spec.md` and `../plan.md` first. The GraphQL delta in `../spec.md` is read-only.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/pipeline-status/pipeline-status.ts` | New | The pure derivation: the normalized value list, the REQ-3 six rules, the REQ-4 ranking and maximum. No Nest, no Prisma, no injection |
| `src/pipeline-status/pipeline-status.spec.ts` | New | The suite. See § Tests |
| `src/downloads/entities/download.entity.ts` | Modified | `progress` → `downloadProgress`; add `encodeProgress: Float`, `compressionEnabled: Boolean!` |
| `src/downloads/downloads.service.ts` | Modified | `toDownload` derives instead of copying; load each source's jobs; read `compression_enabled`; REQ-7 writes on start/stop |
| `src/movies/movies.service.ts` | Modified | Map the derived status onto the rows `findAll`/`findOneFromDb` already return |
| `src/shows/shows.service.ts` | Modified | `findOneFromDb` includes each episode's `mediaSources`/`processJobs`; map the derived status onto each episode |
| `src/downloads/downloads.service.spec.ts` | New or Modified | The REQ-7 guard and the per-source job grouping. See § Tests |

No new module registration is expected: `pipeline-status.ts` is a plain exported function, imported
directly. **Do not create a `PipelineStatusModule` or an `@Injectable()` service around it** — it
has no dependencies to inject, and a Nest provider would be a layer Article X asks you not to add.
If you find yourself needing one, that is a finding to report, not to act on.

## Existing code to reuse

- **`src/clients/torrent/client.ts` → `mapTorrentState`** — already maps qBittorrent's raw state to
  a `SourceStatus`, already handles the 5.0 `stopped*` spellings and already logs-and-falls-back on
  an unknown state. Its result rides on `TorrentClientInfo.state`
  (`src/clients/torrent/types.ts`) into `DownloadsService` and is **discarded there today**.
  REQ-3 rule 5 is mostly a matter of reading it. Do not write a second state table, and do not
  touch `mapTorrentState` itself.
- **`src/downloads/downloads.service.ts` → `liveInfoByHash(tag)`** — one `torrents/info?tag=` read
  per request, already returning an empty `Map` when qBittorrent is unreachable. NFR-4 and AC-6 are
  already satisfied by it; keep the shape.
- **`ProcessJobsService.encodeCompleted`'s sibling lookup** —
  `prisma.processJob.findMany({ where: { sourceFile: { mediaSourceId } }, select: { … } })` is the
  established traversal from a source to its jobs. `MediaSource` has **no** direct `processJobs`
  relation; the path is `sourceFiles → processJob`. For a list, widen the same `where` with
  `mediaSourceId: { in: ids }` and group in memory — one query for the whole page, never one per
  row (NFR-6).
- **`ProcessJobsService.getEncodeJobDetails`** — `settingsMap['compression_enabled'] !== 'false'`,
  read off `SettingsService.getMap()`. Copy the predicate exactly. `DownloadsModule` already imports
  `SettingsModule`, which exports `SettingsService`; injecting it needs no module change.
- **`MoviesService.findAll` / `findOneFromDb`** — both **already** carry
  `include: { mediaSources: true, processJobs: true }`. Confirm before changing anything: the films
  half of the title altitude needs no new query.
- **`MediaServerReconcileService`'s guarded `updateMany`** — `status: 'MISSING'` in the `where`
  rather than a read-then-write, so the promotion is atomic. REQ-7's two writes use that exact
  shape, guarded on the non-terminal statuses instead.
- **`SourceStatus` / `EncodeStatus` / `MediaStatus` from `@prisma/client`** — the derivation's
  inputs. Import the enums; do not retype their literals as string unions.

## Steps

1. **`src/pipeline-status/pipeline-status.ts` — the vocabulary and the ranking.** Export the eight
   normalized values and the REQ-4 rank order (`MISSING` < `QUEUED` < `PAUSED` < `DOWNLOADING` <
   `DOWNLOADED` < `ENCODING` < `COMPLETED`, with `ERROR` outside the ladder). Export the two
   translations the vocabulary needs: `SourceStatus` (`PENDING`/`QUEUED` → `QUEUED`,
   `READY`/`SCANNED` → `DOWNLOADED`, `DOWNLOADING`/`PAUSED`/`ERROR` unchanged) and the identity for
   `MediaStatus`, which is already a subset of the eight.

2. **`pipeline-status.ts` — the source-altitude function.** REQ-3's six rules as **ordered early
   returns**, in the order the spec writes them. Inputs are plain rows: the source's `status`, its
   jobs (`status` + `progress`), and an optional live reading (`state` + `progress`, the latter
   still 0..1). Outputs `{ status, downloadProgress, encodeProgress }` with both progresses 0..100
   or `null`. **The 0..1 → 0..100 conversion happens here and nowhere else** — the adapter boundary
   keeps 0..1 (`graphql-contract.md` warns about the double multiply).

3. **`pipeline-status.ts` — the title-altitude function.** `../plan.md` § Approach decision 1 is the
   rule and it is not optional: `ERROR` **if and only if** the stored column is `ERROR`; otherwise
   the maximum over the ranking of (a) the column, (b) each non-`ERROR` source's translated status,
   (c) the job set with `ERROR` jobs ignored — `ENCODING` if any remaining job is
   `WAITING`/`QUEUED`/`ENCODING`, `COMPLETED` if there is at least one job and every remaining one
   is `COMPLETED`. Takes no live reading (REQ-5). Do not group the jobs by source here; the title's
   `processJobs` are denormalized precisely so this join is unnecessary.

4. **`src/downloads/entities/download.entity.ts`** — rename `progress` to `downloadProgress`, add
   `encodeProgress` (`Float`, nullable) and `compressionEnabled` (`Boolean`, non-null). The SDL in
   `../spec.md` is the target; `schema.gql` regenerates itself on boot (Article IV) — never hand-edit
   it.

5. **`src/downloads/downloads.service.ts` — jobs and the compression flag.** In `movieDownloads` and
   `showDownloads`, after the sources are loaded, fetch every source's jobs in **one** query
   (`where: { sourceFile: { mediaSourceId: { in: ids } } }`, selecting `status`, `progress` and
   `sourceFile.mediaSourceId`) and group by `mediaSourceId`. Read `compression_enabled` once per
   request from `SettingsService.getMap()`. Both alongside the existing `liveInfoByHash` call — no
   extra external call (NFR-5).

6. **`downloads.service.ts` — `toDownload` derives.** Replace the raw `status: source.status` copy
   and the `progress` computation with one call to the source-altitude function, passing the
   source, its grouped jobs and its live reading. Keep `torrentState`, `downloadSpeed`, `readAt`,
   `infoHash`, `kind`, `label` exactly as they are. `infoHash != null` remains the controllability
   test. Note the three control mutations call `toDownload` too, for a single source — they need
   the same two new inputs.

7. **`downloads.service.ts` — REQ-7's writes.** In `downloadStop`, after the torrent client accepts
   the stop, `updateMany` the row to `PAUSED`; in `downloadStart`, to `QUEUED`. **Both guarded in
   the `where` on non-terminal statuses** (`PENDING`, `QUEUED`, `DOWNLOADING`, `PAUSED`) — see
   `../plan.md` § Approach decision 2 for why an unguarded write breaks NFR-3 on a seeding torrent.
   The write goes after the client call, never before: a rejected stop must not leave the row
   claiming `PAUSED` (the existing `callTorrentClient` throws before any DB write, and that ordering
   is deliberate).

8. **`src/movies/movies.service.ts`** — map the derived title status onto each row returned by
   `findAll` and `findOneFromDb`, using the `mediaSources` and `processJobs` those queries already
   include. No query change. Do this in the service, not as a `@ResolveField` on the resolver: the
   Prisma result is where the relations are typed, and the entity type does not declare them.

9. **`src/shows/shows.service.ts`** — add `mediaSources: true, processJobs: true` to the `episodes`
   include inside `findOneFromDb`, and map the derived status onto each episode. **`findAll` is not
   touched**: it deliberately carries no include, and `Show.status` is out of scope. An episode
   inside a season pack has an empty `mediaSources` and a populated `processJobs` — that is the case
   the include exists for.

10. **Leave the mutation returns alone.** `addTorrentToMovie`, `addMagnetToEpisode` and the rest
    return the Prisma row with its raw `MediaStatus`. That is already a valid normalized value —
    `MediaStatus` is a subset of the eight — so no change is owed and none should be made.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, which is read-only:

- `Download.status` is the normalized value, no longer the `SourceStatus` column.
- `Download.downloadProgress: Float` — renamed from `progress`, 0..100, `null` when unknown. The
  old name does **not** survive as an alias.
- `Download.encodeProgress: Float` — new, 0..100, `null` when the source has no `ProcessJob`.
- `Download.compressionEnabled: Boolean!` — new, the installation's `compression_enabled` setting.
- `Movie.status` and `Episode.status` are the normalized value.
- `MediaSource.status` is unchanged raw `SourceStatus` (REQ-8). `Show.status` is unchanged.
- Every mutation signature in the system is unchanged.

**No new error condition.** The derivation is total: REQ-3's rule 6 has no escape branch, and an
unrecognised live state is already absorbed inside `mapTorrentState`. Do not add an error key, and
do not throw from the derivation — a status that cannot be computed is a bug in the rule order, not
a runtime condition to report. The existing keys on this surface
(`DOWNLOAD_NOT_A_TORRENT`, `TORRENT_CLIENT_REJECTED`, `SOURCE_NOT_FOUND`) keep their conditions,
keys and messages.

## Tests

Article IX applies squarely here: every failure in this slice is silent. A wrong status renders as a
confident, plausible word; a wrong percentage renders as a plausible number. Nothing throws, nothing
logs, and the pipeline itself keeps working — which is exactly how the two reported bugs survived
this long.

- **`src/pipeline-status/pipeline-status.spec.ts`** — the main suite, and the one that must be
  written **fault-injection style**: each case has to be verified to fail when the single rule it
  covers is removed. Follow `src/media-roots/media-roots.service.spec.ts` for structure — a header
  paragraph naming the class of bug, `describe` per function, indicative English `it(...)` strings.
  Owed cases, at minimum:
  - `SCANNED` source with a `COMPLETED` job resolves to `COMPLETED`, not `DOWNLOADED` — the
    reported Daredevil bug; must fail if rule 2 is removed or reordered after rule 4.
  - `QUEUED` source with a live downloading reading resolves to `DOWNLOADING` with a percentage —
    the reported film; must fail if rule 5 stops reading `live.state`.
  - No live reading resolves from the column with `null` progress, never an exception (AC-6).
  - Three jobs at 100/50/0 with one `ENCODING` give `ENCODING` and `encodeProgress: 50` (AC-5).
  - Live `progress` of `0.42` becomes `42`, not `0.42` and not `4200` — the double-multiply guard.
  - Title altitude: column `COMPLETED` + one `ERROR` source + one `SCANNED` source with a
    `COMPLETED` job gives `COMPLETED` (AC-8). **This is the case that fails if `ERROR` is read off
    the raw job set** — the highest-value test in the suite.
  - Title altitude: column `ERROR` gives `ERROR` even with a `COMPLETED` job present (AC-7).
  - Title altitude: no sources and no jobs returns the column verbatim, preserving the `COMPLETED`
    that Jellyfin reconciliation writes with no `filePath` (AC-9).
  - Title altitude: an episode with empty `mediaSources` and an `ENCODING` `processJob` — the
    season-pack member — resolves to `ENCODING`, not `MISSING`.
  - Title altitude: the maximum never regresses — a `COMPLETED` column with a `QUEUED` source stays
    `COMPLETED` (NFR-3).

- **`src/downloads/downloads.service.spec.ts`** — two things the pure suite cannot reach:
  - `downloadStart` on a `READY` source leaves it `READY`. Without the `where` guard this test
    passes a naive implementation right up until a user clicks resume on a seeding torrent and the
    title silently walks backwards (`../plan.md` § Approach decision 2).
  - Jobs are grouped by their own `sourceFile.mediaSourceId` — two sources on one title do not
    pool their jobs into each other's row.

- **Not owed**: the entity field renames (`download.entity.ts`) — a mistake there is a schema
  mismatch `web`'s runtime surfaces immediately and AC-2 catches by hand. The `movies`/`shows`
  mapping is covered transitively by the pure suite plus the manual pass; a Prisma-mocking test of
  the `include` shape would assert the mock, not the behaviour.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
```

0 errors, and green with the new suite. Baseline to re-measure first, not to cite: 342 tests across
36 suites as of `042-encode-global-language-preferences`.

```bash
git status --short services/api/prisma/
```

Must print nothing (NFR-1/AC-13).

---
title: Downloads panel repair
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-11
last_updated: 2026-09-11
status: Implemented
services: [api, web, worker]
---

# SPEC: Downloads panel repair (`spec.md`)

## Context & Goal

`services/web/src/components/downloads/DownloadsPanel.tsx` is about to carry a lot more weight than
it does today — it is the one surface where a user watches the whole pipeline move, and the next
features will lean on it. Before that happens it has to stop being wrong, and it is wrong in three
independent ways plus one gap.

The one that actually loses information is a casing mismatch on `infoHash`. Three code paths write
that column: `clients/indexer/client.ts` uppercases the hash Prowlarr supplied
(`item.infoHash?.toUpperCase()`), while `clients/torrent/magnet.ts` and
`clients/indexer/resolve-info-hash.ts` both produce lowercase. qBittorrent reports and accepts
lowercase only. `DownloadsService.liveInfoByHash` keys its map on qBittorrent's hash and looks it up
with the raw column value, so an indexer-sourced row misses the join entirely and renders with
`downloadProgress: null`, `downloadSpeed: null` and its last *written* status (`QUEUED`) instead of
the live one — while a magnet-sourced row beside it, in the same panel, renders correctly.
Deterministic, so refreshing changes nothing. MariaDB's case-insensitive collation is what hid this
for so long: every SQL match on the column kept working, and only the in-memory joins broke. The
same bug was already patched once at a single call site — `media-sources.service.ts` lowercases
before calling `torrentClient.files()`, with the cause written in a comment — but the cause itself
was never fixed, so it resurfaced here. The same mismatch also makes `downloadStart`/`downloadStop`/
`downloadDelete` silent no-ops against qBittorrent for those rows: an unknown hash is a `200 OK`
that touches nothing, not an error.

The second and third are `web`-local. `DownloadsPanel.tsx` declares two renderable components in one
file (`DownloadRow` and the default export), which is not a style preference here — it is how a
component nobody can find gets reimplemented by the next screen. Nothing in this repository writes
that rule down, and `src/components/{common,form,ui,header}` is vendored TailAdmin scaffolding that
*does* stack components per file, so "follow the neighbours" reproduces the defect. And the progress
column is a `<td>` whose width is decided by its own content, so the download bar and the encode bar
under it come out different widths, and two rows of the table disagree with each other.

The gap is the encode. The bar advances every `PROGRESS_STEP` (5%) and that cadence is fine, but
there is no speed reading beside it the way a torrent has one — the panel's Speed column simply goes
blank the moment the pipeline crosses from downloading to encoding. FFmpeg already emits
`speed=1.23x` on the same `-progress pipe:1` stream `runner.ts` is parsing `out_time_us=` out of; it
is discarded today.

Two pipeline stages in the root `CLAUDE.md` are touched, neither in what it does: **Find release**
(the indexer client stops uppercasing) and **Transcode** (the worker reports a speed alongside the
progress it already reports). Nothing about what gets downloaded, selected, encoded or written
changes.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Hash written lowercase)**: `MediaSource.infoHash` must be written lowercase by every
      path that writes it, including the one that takes the hash Prowlarr supplied verbatim.
- [x] **REQ-2 (Hash compared case-insensitively)**: Every comparison between a stored `infoHash` and
      a hash reported by or sent to the torrent client must hold regardless of the stored casing —
      the panel's live join, the single-hash re-read after a control mutation, and the start/stop/
      delete calls themselves.
- [x] **REQ-3 (Legacy rows normalized)**: Rows already stored uppercase must be rewritten lowercase,
      so the database is consistent with REQ-1 rather than only tolerated by REQ-2.
- [x] **REQ-4 (Live values render)**: A torrent the client is actively downloading must render its
      live percentage, its live speed and its live-derived status in the downloads panel and on the
      title's own detail page, whichever of the three write paths produced its hash.
- [x] **REQ-5 (One renderable component per file)**: A `.tsx` file under `services/web/src` must
      export exactly one thing that renders. `DownloadsPanel.tsx`'s second component moves to its own
      file; the shared formatting helpers move out of the `.tsx` entirely.
- [x] **REQ-6 (The rule is written down)**: The rule in REQ-5 must be recorded, with its cause (the
      vendored TailAdmin directories are the counter-example, not the pattern), in both
      `services/web/CLAUDE.md` and `.claude/agents/web.md`, and must name the files that still
      violate it so a later touch has a list to work from.
- [x] **REQ-7 (Bars share a width)**: Within a row, the download bar and the encode bar must be
      exactly the same width; across rows, the progress column must be the same width regardless of
      each row's content.
- [x] **REQ-8 (Encode speed reported)**: While an encode is running, the worker must report the
      speed FFmpeg itself reports — its realtime multiplier — alongside the progress it already
      reports, on the same throttled cadence.
- [x] **REQ-9 (Encode speed rendered)**: While a source's derived status is `ENCODING`, the panel's
      Speed column must show that multiplier (e.g. `1.23x`). While it is downloading, that column
      keeps showing the torrent's bytes-per-second, unchanged.
- [x] **REQ-10 (No stale speed)**: A speed reading must never outlive the encode that produced it —
      a completed, failed, cancelled or not-yet-started job reports no speed, rather than the last
      value it happened to write.
- [x] **REQ-11 (Compression off is not an encode)**: With `compression_enabled` off, the passthrough
      driver runs no FFmpeg and must report no speed; the panel's Speed column stays empty for that
      row rather than showing a fabricated value.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (No new queries per row)**: The encode speed must ride the query that already loads
      each source's `ProcessJob` rows. No per-row query, no second round trip (the standing REQ-3 of
      `022-download-status-tags`).
- [x] **NFR-2 (No new report cadence)**: The worker must not add a network call for speed. It rides
      the existing `encodeProgress` mutation, at the existing `PROGRESS_STEP` throttle — a per-frame
      speed report would flood `api` and re-open the MariaDB 1020 contention `encode.job.ts`'s
      `await`-per-report comment exists to prevent.
- [x] **NFR-3 (Speed is never load-bearing)**: A missing, unparseable or absent speed must never fail
      or slow an encode. It is decoration on top of a report that already works.
- [x] **NFR-4 (Migration is data-only)**: REQ-3's migration rewrites values in an existing column. It
      adds no column and changes no type, and must not fail on a row already lowercase.
- [x] **NFR-5 (Visual parity)**: The panel's split (REQ-5) must be a move, not a redesign — the
      rendered output is identical except for REQ-7's column geometry.

## GraphQL Contract Delta

```graphql
type Download {
  mediaSourceId: Int!
  infoHash: String
  kind: String!
  label: String!
  releaseTitle: String
  movieId: Int
  seasonId: Int
  episodeId: Int
  status: String!
  torrentState: String
  downloadProgress: Float
  encodeProgress: Float
  compressionEnabled: Boolean!
  downloadSpeed: Float
  encodeSpeed: Float          # NEW — FFmpeg's realtime multiplier (1.23 means 1.23x).
                              # null unless an encode is running right now.
  readAt: DateTime!
}

type Mutation {
  encodeProgress(processJobId: Int!, progress: Int!, speed: Float): String!
}
```

`encodeProgress` gains one **optional** argument. Optional is the contract, not a convenience: a
worker that predates this feature keeps calling the two-argument form and must keep working, and a
`speed` the worker could not parse is sent as `null` rather than as a guessed number.

`encodeSpeed` is a multiplier, not a rate — `1.0` means the encode is keeping pace with realtime.
It is deliberately a different unit from `downloadSpeed` (bytes per second) on the same type, which
is why the two are separate fields and not one polymorphic one: a consumer that formatted them
through the same function would render `1.23 B/s`.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `encodeProgress` called with an unknown `processJobId` | unchanged — whatever the existing mutation already does | unchanged |
| `speed` omitted or `null` | none — accepted, stored as `null` | nothing; the Speed column renders `—` |
| `speed` negative or non-finite | none — accepted and coerced to `null`, never rejected | nothing (NFR-3: a bad speed never fails a report) |

Consumer obligations:

- **`web`**: retypes `Download` by hand in `src/types/downloads.ts` and re-selects it in
  `src/actions/downloads.ts` — an unselected field arrives `undefined`, with no compile error
  anywhere. Treats `encodeSpeed: null` as a normal renderable state, exactly as it already treats
  `downloadSpeed`/`torrentState`. Formats it through its own helper, never through the bytes-per-
  second one.
- **`worker`**: passes `speed` on every `encodeProgress` call it already makes. Sends `null` rather
  than omitting the argument when FFmpeg reported no parseable speed, so the two cases stay
  distinguishable in the log.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `ProcessJob` | add `encodeSpeed Float?` | nullable, no default | No — `null` is the correct value for every existing row (none is encoding) |
| `MediaSource` | no schema change; a data migration lowercases `info_hash` | — | **Yes** — REQ-3, part of the same migration directory |

The `info_hash` rewrite is a data-only step in a Prisma migration (Article III: through
`bin/npm api run prisma:migrate`, never hand-run SQL). It must tolerate rows already lowercase.
`MediaSource.infoHash` is `@unique`, and MariaDB's collation is case-insensitive, so two rows cannot
already differ only by case — the rewrite cannot collide.

## Acceptance Criteria

- [x] **AC-1**: Given a film registered from an indexer search result (not a pasted magnet) that
      qBittorrent is actively downloading, when its detail page is opened, then the panel row shows a
      non-null percentage, a non-null speed and status `DOWNLOADING` — the same as a magnet-sourced
      row beside it. This is the reported bug; it fails at `HEAD`.
      **Verified live**, end to end: the dev seed's `MediaSource` (id 1, `infoHash` stored uppercase
      — the exact indexer-sourced shape) had no matching torrent in qBittorrent. A torrent was added
      with the same hash lowercase and tagged `Inception` (the tag `movieDownloads` filters on), and
      `movieDownloads(movieId: 1)` was queried over GraphQL directly: before the tag matched,
      `downloadProgress`/`downloadSpeed`/`torrentState` were `null`; once qBittorrent reported the
      torrent under that tag, the same query returned `downloadProgress: 100`, `downloadSpeed: 16`,
      `torrentState: "stalledUP"` — non-null, live, through the case-insensitive join, with no code
      change needed on qBittorrent's side. The UI panel rendered the same non-null values. Test
      torrent removed afterward.
- [x] **AC-2**: `bin/mysql -e "select count(*) from media_sources where cast(infoHash as binary) <> cast(lower(infoHash) as binary) and id <> 1"` returns `0` after the migration (the `id <> 1` excludes the dev seed fixture, which a real installation never receives — see root `CLAUDE.md`) — the `cast` is load-bearing, since the column's own collation is case-insensitive and a plain `<>` would report `0` whether or not the migration ran. (The Prisma column has no `@map`, so its real SQL name is the camelCase `infoHash`, not `info_hash` — corrected during T004.)
      **Verified live**: ran against the real dev database, returned `0`.
- [x] **AC-3**: Given a source whose `infoHash` was stored uppercase before this feature, when the
      user clicks Stop on its row, then qBittorrent actually pauses that torrent and the row moves to
      `PAUSED`. **Failure path**: at `HEAD` the call returns success and pauses nothing.
      **Verified by fault-injected unit test**, not an additional live click: `downloads.service.spec.ts`
      (T003) covers `liveInfoForHash`'s case-insensitive comparison directly, and reverting its
      `.toLowerCase()` was confirmed to fail both new cases. The mechanism is identical to what AC-1
      proved live for the read path — `normalizeHashes` (T002) applies the same lowercasing to the
      `start`/`stop`/`remove` request body itself, confirmed by `bin/cli api npx --no tsc --noEmit`
      and the deleted redundant lowercase at the old call site.
- [x] **AC-4**: `grep -cE "^(export default )?function [A-Z]" services/web/src/components/downloads/DownloadsPanel.tsx` returns `1`, the extracted row component exists as its own file under the same directory, and the two formatting helpers live outside any `.tsx`.
      **Verified live**: `grep` returns `1`; `DownloadRow.tsx` and `DownloadProgressBar.tsx` exist
      under `src/components/downloads/`; `formatSpeed`/`formatProgress`/`formatEncodeSpeed` live in
      `src/lib/format.ts`.
- [x] **AC-5**: With a row whose target label is one short word and another whose label wraps to two
      lines, both rows' progress bars measure the same width, and within each row the download bar
      and the encode bar measure the same width.
      **Verified by direct code read** (a browser rendering glitch in this environment prevented a
      pixel screenshot of the live table, so this is structural, not visual, confirmation):
      `DownloadsPanel.tsx`'s progress `<th>` carries `w-[14rem]`, fixed regardless of row content;
      every progress bar in every row is the same `DownloadProgressBar` component
      (`grid-cols-[1fr_auto]`) constrained by that one column width, so the track always gets
      "remaining width after the label" and every instance — across rows and within a row — measures
      identically by construction, not by coincidence.
- [x] **AC-6**: Given an encode in progress with compression on, when the panel is refreshed, then
      the Speed column shows a multiplier (e.g. `1.42x`), and it changes between refreshes.
      **Verified structurally, not against a live encode** (standing up a real FFmpeg encode against
      a real video file was out of proportion to this pass): `DownloadRow.tsx` branches on
      `download.status === "ENCODING"` → `formatEncodeSpeed(download.encodeSpeed)`; `encodeSpeed` is
      selected in `DOWNLOAD_FIELDS` (T009) and confirmed live on the `Download` type via
      `schema.gql` (T007); `pipeline-status.spec.ts` (T005) pins that an `ENCODING` job's speed
      surfaces non-null.
- [x] **AC-7**: **Failure path** — given that same job after it reports `encodeCompleted`, when the
      panel is refreshed, then the Speed column is empty, not the last multiplier it reported.
      **Verified by fault-injected unit test**: `pipeline-status.spec.ts` (T005) pins that the same
      job, `COMPLETED` with the same stored `encodeSpeed`, surfaces `null` — REQ-10 holds by
      construction, since only Rule 3 ever returns non-null and Rule 3 requires `status ===
      'ENCODING'`.
- [x] **AC-8**: **Failure path** — given `compression_enabled` set to `false`, when a source is
      processed by the passthrough driver, then no speed is ever shown for it and the file is still
      renamed and moved to its destination.
      **Verified structurally**: `passthrough.ts` passes explicit `null` on its single
      `onProgress(100)` call (T011) — `onProgress`'s speed parameter is required, so this is a
      compile error to omit, not a discipline. The passthrough driver's move/rename logic is
      untouched by this feature.
- [x] **AC-9**: `bin/npm api test` and `bin/npm worker test` are green (modulo the pre-existing
      `src/ffmpeg/` and `src/metadata/` failures recorded in the root `CLAUDE.md`), and
      `bin/cli web npx --no tsc --noEmit` plus `bin/npm web run build` both exit 0.
      **Verified live**: `api` 460/42 suites, 0 typecheck errors, one migration applied cleanly.
      `worker` 176/178 tests across 20 suites passing (2 pre-existing, unrelated `src/ffmpeg/`
      failures, confirmed unchanged), typecheck reports only the 2 pre-existing
      `src/metadata/container-tags.spec.ts` errors. `web` typecheck 0 errors, `bin/npm web run build`
      exits 0.

## Out of Scope

- **Polling or live updates.** The panel still refreshes only when the user asks it to
  (`router.refresh()`). The reported "refresh doesn't update it" is the casing bug, not a missing
  subscription — a polling or websocket panel is its own feature with its own cost, and fixing the
  join makes the existing refresh correct.
- **Splitting the other files that violate REQ-5.** `users/UsersManager.tsx` (3 components),
  `shows/SeasonAccordion.tsx`, `settings/SchedulingPanel.tsx`, `settings/MediaServerFields.tsx` and
  `app/perceptor/page.tsx` all predate the rule. REQ-6 records them; this feature does not touch
  them, since each is a behaviour-carrying screen and a blind split risks a regression nothing here
  would catch (`web` has no test suite).
- **Redesigning the panel.** The grid is a geometry fix (REQ-7), not a visual pass. Colors,
  typography, the status pill and the button chrome stay exactly as they are.
- **ETA / time remaining.** Derivable from progress and speed, but it is the noisiest of the four
  readings FFmpeg makes available and needs its own thinking about how to present a number that
  jumps. Not blocked by anything here — `encodeSpeed` is what it would be built on.
- **Encode fps.** The same `-progress` stream carries `fps=`; it says nothing useful without the
  source's own framerate beside it. The multiplier was chosen deliberately over it.
- **The `movieId` naming debt.** `MediaSource.movieId` and the tus metadata key are untouched — see
  the root `CLAUDE.md` § Known debt. This feature lowercases a different column and adds a field
  beside it; it is not the cross-service rename.

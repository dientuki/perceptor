---
title: Pipeline Status Normalization
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-03
last_updated: 2026-09-03
status: Implemented
services: [api, web]
---

# SPEC: Pipeline Status Normalization (`spec.md`)

## Context & Goal

A title moves through one lifecycle — queued, downloading, downloaded, encoding, done — and this
codebase currently tells that story in four incompatible vocabularies. `MediaSource.status` is a
`SourceStatus` (`PENDING, QUEUED, DOWNLOADING, PAUSED, READY, SCANNED, ERROR`), `ProcessJob.status`
is an `EncodeStatus` (`WAITING, QUEUED, ENCODING, COMPLETED, ERROR`), `Movie`/`Show`/`Episode.status`
is a `MediaStatus` (`MISSING, DOWNLOADING, ENCODING, COMPLETED, ERROR`), and `Download.torrentState`
carries qBittorrent's own raw strings. The literals collide without agreeing: `QUEUED` means
"handed to the torrent client" in one enum and "sitting in `bull:encode`" in the other; `COMPLETED`
exists in two enums as two different facts; `SourceStatus.DOWNLOADING` is declared and never
persisted. Nothing reconciles them, so two screens looking at the same title disagree, and a user
cannot tell which one is lying.

Two failures reported from a live installation make it concrete. A film that is actively downloading
renders `QUEUED` in `services/web/src/components/downloads/DownloadsPanel.tsx` and `DOWNLOADING` in
`services/web/src/components/movies/Movie.tsx`: `MediaSource.status` is written exactly twice, at
attach (`movies.service.ts`) and at completion (`downloads.service.ts`'s `torrentCompleted`), never
in between — and although `DownloadsService` does read qBittorrent on every query, `toDownload`
discards the live `SourceStatus` that `clients/torrent/client.ts`'s `mapTorrentState` already
computed, keeping only `rawState`, `progress` and `dlspeed`. Separately, an episode that finished
encoding renders `COMPLETED` in `SeasonAccordion.tsx` and `SCANNED` in the panel: `encodeCompleted`
(`process-jobs.service.ts`) moves `Episode.status` to `COMPLETED` and leaves the `MediaSource` row
sitting in `SCANNED` forever, because no transition exists to move it. Both are reporting bugs, not
pipeline bugs — the download and the encode both worked.

The immediate motivation is the `/downloads` screen, today a stub returning `null`
(`services/web/src/app/(dashboard)/downloads/page.tsx`, left deliberately empty by
`033-billboard-and-navigation`). That screen wants two progress bars per row — one for the download,
one for the compression — and neither is buildable on the current surface: the compression
percentage already exists as `ProcessJob.progress` (0-100, written by the worker's `encodeProgress`
every five points) but crosses no GraphQL field at all, and the status beside it would be a fifth
inconsistent reading. This feature normalizes the reporting layer so that screen can be built on a
surface that tells one story. It changes **no pipeline stage** in the root `CLAUDE.md` table — every
transition, every mutation and every write stays exactly where it is. What changes is that the
status a consumer *reads* is derived, in one place, at read time, from the rows the pipeline already
maintains.

## Requirements

### Functional Requirements

- [x] **REQ-1 (One vocabulary)**: Every status a user reads must be one of exactly eight values —
      `MISSING`, `QUEUED`, `DOWNLOADING`, `PAUSED`, `DOWNLOADED`, `ENCODING`, `COMPLETED`, `ERROR` —
      with one meaning each, whatever screen it appears on. `DOWNLOADED` is the state the system can
      reach today but cannot name: the file is on disk and the encode has not started.

- [x] **REQ-2 (One derivation)**: The eight values must be produced by a single derivation in `api`,
      reached by every field that publishes a status. Two code paths that each decide a status
      independently is the defect this feature exists to remove; a second copy is a violation of this
      requirement even if it agrees today.

- [x] **REQ-3 (Source-level derivation)**: Given one `MediaSource`, its `ProcessJob` rows, and
      optionally the live torrent reading for its `infoHash`, the derived status must be decided by
      these rules, **in this order** — the order is the specification, not an implementation note:

  | # | Condition | Status | `downloadProgress` | `encodeProgress` |
  | :-- | :-- | :-- | :-- | :-- |
  | 1 | source is `ERROR`, or any job is `ERROR` | `ERROR` | live if present, else `null` | mean if jobs, else `null` |
  | 2 | jobs exist and every one is `COMPLETED` | `COMPLETED` | `100` | `100` |
  | 3 | jobs exist, some `WAITING`/`QUEUED`/`ENCODING` | `ENCODING` | `100` | mean of `job.progress` |
  | 4 | no jobs, source is `READY` or `SCANNED` | `DOWNLOADED` | `100` | `null` |
  | 5 | no jobs, a live torrent reading exists | the live reading, translated | live `progress` × 100 | `null` |
  | 6 | otherwise | the source column, translated | `null` | `null` |

  Rule 2 is what makes the reported episode read `COMPLETED` on both screens. Rule 5 is what makes
  the reported film read `DOWNLOADING` on both. Rule 3's mean is over the job set of one source: a
  season pack is N jobs against one `MediaSource`, and the row represents the pack.

- [x] **REQ-4 (Title-level derivation)**: A `Movie`'s or `Episode`'s status must be the **most
      advanced** of (a) its own stored `MediaStatus` and (b) the derived status of each of its
      non-`ERROR` `MediaSource` rows, ranked `MISSING` < `QUEUED` < `PAUSED` < `DOWNLOADING` <
      `DOWNLOADED` < `ENCODING` < `COMPLETED`. A stored `ERROR` surfaces as `ERROR` regardless; a
      source that is `ERROR` is ignored, because a demoted source (`SOURCE_REPLACED`) is a superseded
      attempt, not a failed title. Taking the maximum rather than the source's own reading is what
      keeps a `COMPLETED` title completed when a stale losing sibling row is still lying around, and
      what preserves the `COMPLETED` that Jellyfin reconciliation writes with no `filePath` and no
      source at all (`034`).

- [x] **REQ-5 (No live torrent read at title level)**: The title-level derivation must read only the
      database. `movies` and `shows` are listings; a torrent-client call per title would be N
      external calls per screen.

- [x] **REQ-6 (Both progress numbers reach the client)**: A `Download` row must publish the download
      percentage and the compression percentage as two separate 0..100 values, each `null` when
      unknown, plus whether compression is enabled for this installation — enough for a consumer to
      decide whether to draw one bar or two, with no second query.

- [x] **REQ-7 (Manual pause is visible without the torrent client)**: `downloadStop` must record
      `PAUSED` and `downloadStart` must record `QUEUED` on the `MediaSource` row. Today neither
      writes anything, so a manually paused download is indistinguishable from a queued one to any
      reader that has no live torrent data — which, by REQ-5, is every title-level reader.

- [x] **REQ-8 (`MediaSource.status` stays raw)**: The `status` field on the `MediaSource` GraphQL
      type must keep publishing the `SourceStatus` column verbatim. It is the machine-facing field —
      the worker selects it in `source-ready.job.ts` — and normalizing it would change a contract the
      worker reads for no user-visible gain.

- [x] **REQ-9 (Status text is translated)**: Each of the eight values must render as translated text
      in the active locale, everywhere a status appears. Today all four call sites print the raw
      uppercase English literal, in both locales.

- [x] **REQ-10 (One status badge)**: The status pill must have exactly one implementation in `web`.
      It is currently duplicated verbatim in `DownloadsPanel.tsx` and `SeasonAccordion.tsx`, and the
      panel's copy branches on `COMPLETED`/`MISSING` — values `SourceStatus` never produces — so
      every real status falls through to the pulsing blue default, including finished ones.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (No schema change)**: No migration, no new column, no new enum in `schema.prisma`. The
      columns remain the durable record; the published value is computed. Persisting a normalized
      status would multiply the ~30 existing write sites and reintroduce the same class of drift.

- [x] **NFR-2 (No worker change)**: `services/worker` is untouched. It already reports everything the
      derivation needs — `encodeStarted`, `encodeProgress`, `encodeCompleted`/`encodeFailed` with
      delivery retry (`038`). If a change to `services/worker` appears necessary during
      implementation, that is a contract error, to be reported rather than made — the same rule
      `022` set.

- [x] **NFR-3 (Monotonic)**: For a title, the derived status must never move backwards through the
      REQ-4 ranking while its pipeline is advancing. A status that oscillates is worse than one that
      is merely stale.

- [x] **NFR-4 (Unreachable torrent client is not an error)**: With qBittorrent down, every
      `Download` row must still render: status falls to the column-based rules, and the live fields
      come back `null`. This preserves `022`'s REQ-9/REQ-10 — `null` progress is a renderable state,
      not a loading state.

- [x] **NFR-5 (No extra external calls)**: The feature must add no call to any external system.
      `movieDownloads`/`showDownloads` keep making exactly one `torrents/info?tag=` read per request;
      `compression_enabled` is read from settings, which are already loaded per request.

- [x] **NFR-6 (Listings stay flat)**: Loading a title's sources and their jobs for the title-level
      derivation must not become a per-row query. The listing resolvers include the relation in the
      query they already run.

- [x] **NFR-7 (The rename is a coordinated edit)**: `Download.progress` becomes
      `Download.downloadProgress`. There is no codegen between `api` and `web`, so the two edits land
      together or the panel silently renders `—` with no error anywhere. `web` is the only consumer
      of this type.

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
  status: String!             # normalized: one of the eight values, no longer the SourceStatus column
  torrentState: String        # unchanged — raw qBittorrent state, null when not in the client
  downloadProgress: Float     # RENAMED from `progress`. 0..100, null when unknown
  encodeProgress: Float       # NEW. 0..100, null when the source has no ProcessJob
  compressionEnabled: Boolean! # NEW. the installation's compression_enabled setting
  downloadSpeed: Float
  readAt: DateTime!
}

type Movie {
  status: String!             # normalized: one of the eight values, no longer the MediaStatus column
}

type Episode {
  status: String!             # normalized: one of the eight values, no longer the MediaStatus column
}
```

Unchanged and deliberately so: `MediaSource.status` (REQ-8, raw `SourceStatus`, read by the worker),
`Show.status` (see Out of Scope), `EncodeJobDetails.status`, and every mutation signature in the
system — `downloadStart`/`downloadStop` return the same `Download!` they always did, now with a
side effect on the row (REQ-7).

**The eight values, and what each one means to a consumer:**

| Value | Means | Reached from |
| :-- | :-- | :-- |
| `MISSING` | registered, nothing requested | stored `MediaStatus`, no source |
| `QUEUED` | handed to the torrent client, nothing moving yet | source column, or `downloadStart` |
| `DOWNLOADING` | bytes arriving | live torrent reading |
| `PAUSED` | stopped, resumable | live reading, race arbiter, or `downloadStop` |
| `DOWNLOADED` | file on disk, encode not started | source `READY`/`SCANNED` with no job |
| `ENCODING` | a `ProcessJob` is in flight (including the passthrough path when compression is off) | job `WAITING`/`QUEUED`/`ENCODING` |
| `COMPLETED` | in the library — by encode, or because the media server already had it | every job `COMPLETED`, or stored `MediaStatus` |
| `ERROR` | this attempt failed | source or job `ERROR`, or stored `MediaStatus` |

**`MediaStatus` is a subset of the eight**, so the REQ-4 fallback needs no translation table: a
stored `MISSING`/`DOWNLOADING`/`ENCODING`/`COMPLETED`/`ERROR` is already a valid normalized value.
That is a property of the chosen vocabulary, not a coincidence to rely on silently — the two
vocabularies that *do* need translating are `SourceStatus` (`PENDING`→`QUEUED`, `READY`/`SCANNED`→
`DOWNLOADED`) and the live reading `mapTorrentState` returns.

**The status still crosses as `String!`, not as a GraphQL enum.** `graphql-contract.md` already
fixed that position for `Movie.status`/`Show.status`: if the enum crosses it crosses for both, as
its own change. This feature changes the *value set*, not the transport type.

**`Download.status` is the only status with live data behind it.** A film's `Movie.status` and its
own row in the same page's panel can therefore differ in refresh age — the panel's is as fresh as
the last `torrents/info` read, the title's as fresh as the last write. By REQ-4 they cannot
*contradict* (the title takes the maximum), but a title reading `DOWNLOADING` beside a panel row
reading `PAUSED` after a manual stop is expected until REQ-7's write lands. There is still no
polling and no websocket; a value on screen is as fresh as the last load or the last click (`022`
REQ-10).

### Errors

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| — | — | — |

**No new error condition.** The derivation is total: every combination of column, job set and live
reading resolves to one of the eight values by REQ-3's rule 6, which has no escape branch. An
unrecognised live torrent state is already handled inside `mapTorrentState`, which logs and falls
back rather than throwing. The existing errors on this surface — `DOWNLOAD_NOT_A_TORRENT`,
`TORRENT_CLIENT_REJECTED`, `SOURCE_NOT_FOUND` — are unchanged in condition, key and message.

### Consumer obligations

- **`web`**: retypes `Download` by hand in `src/types/downloads.ts` and `src/actions/downloads.ts` —
  the rename plus the two new fields (NFR-7). Renders every status through one shared badge (REQ-10)
  and one shared translation lookup (REQ-9). Keeps `infoHash != null` as the controllability test,
  never `kind`. Keeps treating `null` live fields as renderable (NFR-4). Draws the compression bar
  only when `compressionEnabled` is true.
- **`worker`**: none (NFR-2). `mediaSource(id) { status }` keeps returning the raw `SourceStatus` it
  returns today (REQ-8).

### Status keys (`web`-owned)

`web` owns these strings; `api` never sends them. They are display text, not error keys, so they
live in a new `status` namespace in `messages/{en,es}.json` rather than under `errors` — the same
treatment `018-ui-i18n` gave ordinary UI copy.

| Key | `en` | `es` |
| :-- | :-- | :-- |
| `status.missing` | Missing | Falta |
| `status.queued` | Queued | En cola |
| `status.downloading` | Downloading | Descargando |
| `status.paused` | Paused | Pausado |
| `status.downloaded` | Downloaded | Descargado |
| `status.encoding` | Encoding | Comprimiendo |
| `status.completed` | Completed | Completado |
| `status.error` | Error | Error |

`status.encoding` reads *Comprimiendo* even on the passthrough path where compression is off and the
file is only moved (`032`). Naming that state separately would mean publishing a ninth value for a
distinction the user has already made in Settings.

## Data Model Changes

**None.** No model, field, enum or migration changes (NFR-1). `SourceStatus`, `EncodeStatus` and
`MediaStatus` stay exactly as they are in `schema.prisma`; they remain the durable record of what
each row is, and the normalized vocabulary is a read-time projection over them.

REQ-7 adds two writes to the existing `MediaSource.status` column (`PAUSED` on `downloadStop`,
`QUEUED` on `downloadStart`), both using values the enum already declares.

## Acceptance Criteria

- [x] **AC-1** (the reported episode): Given an episode whose `MediaSource` is `SCANNED` and whose
      `ProcessJob` is `COMPLETED`, when its show's detail page is loaded, then the episode row in the
      season accordion **and** its row in the downloads panel both read *Completado* — where the
      panel reads `SCANNED` today.

- [x] **AC-2** (the reported film): Given a film whose `MediaSource` is `QUEUED` and whose torrent is
      actively downloading in qBittorrent, when its detail page is loaded, then the title status
      **and** the panel row both read *Descargando*, and the row shows a moving download percentage —
      where the panel reads `QUEUED` today.

- [x] **AC-3** (compression bar): Given a title with a `ProcessJob` at `ENCODING` and `progress: 40`,
      `movieDownloads` returns that row with `status: "ENCODING"`, `encodeProgress: 40`,
      `downloadProgress: 100` and `compressionEnabled: true`, and the panel renders two bars.

- [x] **AC-4** (compression off): Given `compression_enabled` set to `false` in Settings, every
      `Download` row returns `compressionEnabled: false` and the panel renders only the download bar.

- [x] **AC-5** (season pack mean): Given one `MediaSource` with three `ProcessJob` rows at
      `progress` 100, 50 and 0, one of them `ENCODING`, the row returns `status: "ENCODING"` and
      `encodeProgress: 50`.

- [x] **AC-6** (**failure path** — torrent client down): With the `torrent` container stopped,
      `movieDownloads` for a downloading film returns HTTP 200 with the row present,
      `torrentState: null`, `downloadProgress: null`, `downloadSpeed: null`, and a status derived
      from the column — never an error, never an empty list.

- [x] **AC-7** (**failure path** — failed encode): Given a `ProcessJob` moved to `ERROR` by
      `encodeFailed`, both the title status and its panel row read *Error*, and the row does not
      report a `COMPLETED` sibling job as the title's status.

- [x] **AC-8** (**failure path** — superseded source): Given a title with one `MediaSource` demoted
      to `ERROR` by `SOURCE_REPLACED` and one `SCANNED` with a `COMPLETED` job, the title reads
      *Completado* — the demoted attempt does not make the title an error.

- [x] **AC-9** (reconciled title keeps its status): Given a film promoted to `COMPLETED` by Jellyfin
      reconciliation, with no `MediaSource` row and no `filePath`, its status still reads
      *Completado*.

- [x] **AC-10** (manual pause): Given a downloading torrent, when *Detener* is clicked in the panel,
      then the row reads *Pausado*, and reloading the page with qBittorrent stopped **still** reads
      *Pausado* — proving the column was written (REQ-7), not just the live reading.

- [x] **AC-11**: `bin/npm api test` passes with the new derivation suite green, and
      `bin/cli api npx --no tsc --noEmit` reports 0 errors.

- [x] **AC-12**: `bin/cli web npx --no tsc --noEmit` reports 0 errors, `bin/npm web run build`
      exits 0, and `bin/cli web node scripts/check-messages.mjs` exits 0 with the eight new keys
      present in both catalogs.

- [x] **AC-13**: `git diff --stat` for the whole feature touches no file under `services/worker`
      (NFR-2), and no file under `services/api/prisma/` (NFR-1).

## Out of Scope

- **The `/downloads` screen itself.** This feature builds the surface it needs and stops. That
  screen is its own spec, and it inherits the contract question `033-billboard-and-navigation`
  deliberately left open: which downloads a user who does not own the title may see. Answering that
  while normalizing statuses would conflate a data-shape fix with an authorization decision.

- **`Show.status`.** No code path writes it — the only `show.update` in the service touches
  `seasonsSyncedAt` — so it sits at `MISSING` for the life of the row and will continue to, now
  visibly inconsistent with its own episodes. Excluded by explicit request. Fixing it means deciding
  what a series' status *is* (every episode completed? any? the current season?), which is a product
  question, not a reporting one.

- **Persisting the normalized status.** Considered and rejected: a column would need writing at
  every one of the existing transition sites, which is the same failure mode this feature removes.
  If a future need arises for querying by normalized status (a `/downloads` filter, say), that is
  when the column earns its place — with the use case in hand.

- **Turning the status into a GraphQL enum.** The contract already fixed `String!` for both `Movie`
  and `Show`, and moving one without the other is exactly what that note forbids. It is a separate,
  mechanical change once the value set is stable.

- **Polling or live updates.** The panel still refreshes on a click (`022` REQ-10). Two moving
  progress bars make a websocket tempting; it is not part of this.

- **The `movieId` rename** (root `CLAUDE.md` § Known debt). Untouched, as always.

- **Reconciling `MediaSource.status` with reality by writing to it** — e.g. moving `SCANNED` to a
  terminal state when its jobs complete. That is the persist-it approach in miniature, and the
  derivation makes it unnecessary.

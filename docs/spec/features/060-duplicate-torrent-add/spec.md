---
title: Duplicate Torrent Add
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-18
last_updated: 2026-09-18
status: Approved         # Draft | Approved | Implemented | Superseded
services: [api]
---

# SPEC: Duplicate Torrent Add (`spec.md`)

## Context & Goal

A torrent search can show the same release twice. Prowlarr returns one row per indexer, and
`037-indexer-result-loss` groups them by `infoHash` — or, when an indexer supplied none, by a
derived key. Two rows for what is really one torrent therefore look like two candidates, each with
its own download URL. The `infoHash` of a hash-less row is only resolved when the user adds it
(`services/api/src/clients/indexer/resolve-info-hash.ts`). Adding both rows attaches the same
`infoHash` to the same target twice.

qBittorrent handles this correctly: it recognises the second add as a torrent it already has, merges
it into the first, and keeps downloading into the first torrent's folder. `api` does not. The three
twins of `attachTorrentSource` (`services/api/src/movies/movies.service.ts`,
`episodes/episodes.service.ts`, `seasons/seasons.service.ts`) find the existing `MediaSource` by its
unique `infoHash` and treat the second add as a retry. They call `QbittorrentClient.add()`
(`services/api/src/clients/torrent/client.ts`) again. `add()` derives a folder from a hash of the
first URL, so a different URL produces a **different, empty** folder, and the existing row's
`downloadPath` is overwritten with it. The row is also reset to `QUEUED`. Nothing errors. When the
torrent finishes, `torrentCompleted` hands the worker the empty folder, the scan finds no video, and
the source fails with `error.source.scan_no_video` (`052`). Deleting the source (`047`) removes the
empty folder and leaves the real files orphaned under the downloads root.

The same reuse path has two more silent failures. A row reset to `QUEUED` for a torrent qBittorrent
has already finished never receives another completion notice, so it stays `QUEUED` forever. And a
torrent the race arbiter stopped as a loser (`022`) stays stopped after a re-add, while its row
claims `QUEUED`.

Once this ships, each torrent keeps the `downloadPath` of its first add. A second add of an
`infoHash` already attached to the same target is recognised as the unification qBittorrent already
performed and leaves the existing source as it is. The only exception is a source that had failed
or been replaced: it is reactivated in place, with its own folder. This touches the **Download**
stage of the root `CLAUDE.md` pipeline table. Its status does not change, but a behaviour it
depends on does.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Active duplicate is a no-op)**: Adding a torrent or magnet whose `infoHash` is
      already attached to the **same** target (film, episode or season), when that source is in any
      status other than `ERROR` (`PENDING`, `QUEUED`, `DOWNLOADING`, `PAUSED`, `READY`, `SCANNED`),
      must change nothing: no call that adds a torrent to qBittorrent, no write to the
      `MediaSource` row (its `status`, `downloadPath`, `downloadUrl`, `releaseTitle` and `kind` stay
      as they were), and no change to the target's own status. The mutation succeeds and returns the
      target exactly as a fresh read would. The user sees no error and no notice.
- [ ] **REQ-2 (`force` does not bypass REQ-1)**: REQ-1 holds even when the mutation carries
      `force: true`. Re-requesting a release that is already the target's own active source is not
      a replacement, so it must never demote that source or any sibling to `ERROR`
      (`error.source.replaced`).
- [ ] **REQ-3 (Failed duplicate is reactivated in place)**: Adding a torrent or magnet whose
      `infoHash` is attached to the same target through a source in `ERROR` must reactivate that
      row rather than create a second one. If qBittorrent still holds the torrent, the row keeps its
      existing `downloadPath`, and the torrent is running in qBittorrent when the mutation returns.
      A torrent that the race arbiter or a user had stopped is started again, not merely
      re-requested. If qBittorrent no longer holds the torrent, it is a genuine new add, and the
      folder that add produces becomes the row's `downloadPath`.
- [ ] **REQ-4 (Reactivated torrent that already finished)**: When REQ-3 reactivates an `ERROR`
      source whose torrent qBittorrent reports as already fully downloaded, no new completion notice
      will ever arrive from qBittorrent. `api` must therefore treat the reactivation exactly as if
      `torrentCompleted` had just arrived for that `infoHash`, running the same race resolution
      (`022`) and enqueue path a real completion notice runs. It gets no separate shortcut to
      `READY`. If that path decides the source is a late loser because a sibling already won, the
      outcome is whatever a late `torrentCompleted` produces today.
- [ ] **REQ-5 (Conflicts unchanged)**: An `infoHash` already attached to a **different** target
      keeps refusing exactly as it does today, with `error.magnet.already_attached` naming the other
      title. This spec changes only the same-target case.
- [ ] **REQ-6 (One behaviour, three twins)**: REQ-1 to REQ-4 hold identically for films, episodes
      and seasons, across all six mutations (`addTorrentTo*`, `addMagnetTo*`). The three
      `attachTorrentSource` twins stay separate (Constitution, Article X; `006-media-search`
      § Out of Scope). This spec asks them to agree, not to merge.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (qBittorrent unreachable fails before any write)**: If `api` cannot learn from
      qBittorrent whether it holds the torrent (REQ-3), or the add itself is rejected, the mutation
      fails with the same error an unreachable or rejecting torrent client produces today. No
      `MediaSource` row is created, updated or demoted, and the target's status is untouched.
      REQ-1's no-op needs no call to qBittorrent, so it must not fail when qBittorrent is down.
- [ ] **NFR-2 (Existing rows are left alone)**: Sources whose `downloadPath` was already overwritten
      before this ships are not detected, corrected or migrated. No backfill, no boot-time
      reconciliation, and no correction at `torrentCompleted`. The user recovers one by deleting it
      and adding it again (see § Out of Scope for what that delete leaves behind).
- [ ] **NFR-3 (Tested where silent)**: The whole failure class here produces no error anywhere: a
      row pointing at an empty folder, a row stuck in `QUEUED`, a stopped torrent under a `QUEUED`
      row. Each of REQ-1, REQ-2 and REQ-3 is owed a test (Constitution, Article IX), for each of the
      three twins, including a second add whose first URL differs from the first add's.
- [ ] **NFR-4 (No schema change)**: `MediaSource.infoHash` is already `@unique` and
      `downloadPath` already exists. No Prisma migration.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.** All six mutations keep their exact
signatures and return types. No error key is added or removed. REQ-1 answers with the same payload
shape a successful attach already returns, and NFR-1 reuses the errors the torrent-client path
already raises. `web` needs no change: the modals already treat a successful mutation as "done" and
refresh.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Same `infoHash`, same target, source not in `ERROR` (REQ-1/REQ-2) | none — success | none (the modal closes as on any successful add) |
| Same `infoHash`, **different** target (REQ-5, unchanged) | `ConflictException`, `error.magnet.already_attached` | `Ese magnet ya está asociado a «{title}»` (existing copy, unchanged) |
| qBittorrent unreachable or rejects the add (NFR-1, unchanged) | existing torrent-client error | existing copy, unchanged |

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: Given a film with a `DOWNLOADING` source for hash `H` at `downloadPath` `P`, when the
      user adds a second search row that resolves to `H` but has a different download URL, then the
      mutation succeeds, `bin/mysql -e 'select status, downloadPath from media_sources where
      infoHash="H"'` still shows `DOWNLOADING` and `P`, and no new empty folder appears under the
      downloads root.
- [ ] **AC-2**: Continuing AC-1, when the torrent finishes, the source reaches `SCANNED` and the
      title is encoded. There is no `error.source.scan_no_video`.
- [ ] **AC-3**: Given an episode whose source for `H` is `READY` or `SCANNED`, when the same magnet is
      added again, even with `force: true`, then the row's status is unchanged, no row is demoted to
      `ERROR`, and the episode's status is unchanged.
- [ ] **AC-4**: Given a film whose source for `H` is `ERROR` because the race arbiter stopped the
      torrent and `force` later replaced it, while qBittorrent still holds `H` as stopped, when the
      user adds `H` again, then the row returns to an active status with its original
      `downloadPath`, and qBittorrent's Web UI shows `H` running.
- [ ] **AC-5** *(failure path)*: Given a film whose source for `H` is `ERROR` and qBittorrent is
      stopped (`docker compose stop torrent`), when the user adds `H` again, then the mutation fails
      with the existing torrent-client error, and the row is still `ERROR` with the same
      `downloadPath` and `errorKey`.
- [ ] **AC-6** *(failure path)*: Given `H` attached to film A, when the user adds `H` to film B, then
      the mutation is refused with `error.magnet.already_attached` naming film A, and film A's source
      is untouched.
- [ ] **AC-7**: AC-1 and AC-3 repeated through a season pack (`addTorrentToSeason`/
      `addMagnetToSeason`) behave identically.
- [ ] **AC-8**: `bin/npm api run test` passes with new tests covering REQ-1, REQ-2 and REQ-3 for all
      three twins, each opening with the Article IX header.

## Out of Scope

- **Repairing rows already carrying a wrong `downloadPath`** (NFR-2). This is a deliberate choice,
  given the installation's scale. The known cost: deleting such a source through `047` removes the
  empty folder the row points at, not the real one, so the real files stay under the downloads root
  until removed by hand. They are never in the library (Article XII is unaffected).
- **Collapsing the duplicate rows in the search list.** Two rows that turn out to be one torrent
  stay two rows. Resolving every hash-less row's `infoHash` at search time is exactly the per-row
  outbound fetch `037` REQ-3 removed. This spec only makes adding both harmless.
- **Changing how `add()` names a torrent's folder** (for example, from the `infoHash` instead of the
  URL). That would make a second add land on the same folder by construction, but it changes the
  layout of every future download. With REQ-1 in place, `add()` is simply never called twice for
  the same torrent, so the naming stops mattering.
- **Two genuinely different torrents with the same file name.** Different `infoHash`es are
  different torrents to qBittorrent as well. They race as siblings, as `022` already defines.
- **A notice telling the user the release was already added.** Decided against for REQ-1. It would
  add an i18n key and a contract change for a case where nothing went wrong.
- **Concurrent adds of the same hash.** Two mutations racing on the same `infoHash` within the same
  request window are no more protected than today. The `@unique` constraint still prevents a
  second row.

---
title: Validate infoHash before it reaches qBittorrent
spec_version: 0.1.0
author: security-audit run-1 (draft)
created_at: 2026-11-20
last_updated: 2026-11-20
status: Draft
services: [api]
source_finding: api/acquisition/addTorrentTo-unvalidated-infoHash-qbittorrent-all
audit_verdict: needs_validation
priority: 2
---

# SPEC (draft): Validate infoHash before it reaches qBittorrent

> Draft written from a static security audit (`security-audit` skill, run-1, profile `quick`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `98f8779`.

## Context & Goal

`addTorrentToMovie`, `addTorrentToEpisode` and `addTorrentToSeason` take `infoHash` as a free
nullable `String` (`movies.resolver.ts:138`, `episodes.resolver.ts:22`, `seasons.resolver.ts:19`).
`AttachSourceService.attach` stores it in `MediaSource.infoHash` (`attach-source.service.ts:187`)
after `qbittorrent.add(urls)` succeeds with a real magnet. The column is `VarChar(40) @unique`
(`schema.prisma:277`), so `"all"` fits.

The stored value is later sent to qBittorrent's multi-target `hashes` parameter:
`QbittorrentClient.normalizeHashes` (`clients/torrent/client.ts:110`) only lowercases and joins
with `|`. qBittorrent's WebUI API treats `hashes=all` as **every torrent**. A user who owns any
title could attach a release with `infoHash: "all"` and then call `downloadDelete` on their own
source: `findOwnedSource` passes, `unwindSource` (`downloads.service.ts:1079`) calls
`remove("all", true)` and every torrent in the installation is deleted with its files.
`downloadStop` would pause them all (`downloads.service.ts:1033`). A `|` in the value widens the
target list the same way.

`addMagnetTo*` already validates (`magnet.ts:38`, `HEX_40`/`BASE32_32`). The goal is that every
producer of `infoHash` does, and that the torrent client refuses to forward anything that is not a
hash even if a bad row already exists.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Input format)**: `addTorrentTo*` must refuse an `infoHash` that is not a 40-character
      hex string (or a 32-character base32 btih, normalised to hex as `addMagnetTo*` does) before any
      call to qBittorrent or the database.
- [ ] **REQ-2 (Resolved hash format)**: A hash extracted by `resolveInfoHash`
      (`extractInfoHashFromMagnet`, `resolve-info-hash.ts:13`, today `[^&]+`) must meet the same
      format or be treated as unresolved.
- [ ] **REQ-3 (Client guard)**: The torrent client must refuse to send any hash that is not 40-char
      hex, so the reserved word `all` and the `|` separator can never reach qBittorrent from a stored
      row.
- [ ] **REQ-4 (Existing rows)**: [NEEDS CLARIFICATION: should a migration or boot check flag/clear
      any `MediaSource.infoHash` that does not match the format, or is REQ-3 enough?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (One validator)**: A single shared hash validator is used by magnets, `addTorrentTo*`,
      `resolveInfoHash` and the client.

## GraphQL Contract Delta

No shape change. New refusal:

| Condition | GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `infoHash` not a valid btih | `BadRequestException` with i18n key [NEEDS CLARIFICATION: reuse the magnet path's invalid-hash key or add `error.download.invalid_info_hash`] | Spanish/English catalog copy, "El hash del torrent no es válido" or similar |

`web` only sends hashes it got from `searchTorrents`, so the error is not expected in normal use;
it shows the generic error toast.

## Data Model Changes

None (optionally a data fix, see REQ-4).

## Acceptance Criteria

- [ ] **AC-1**: `addTorrentToMovie` with `infoHash: "all"` fails and creates no `MediaSource` and no
      torrent.
- [ ] **AC-2**: `addTorrentToMovie` with `infoHash: "<hex40>|<hex40>"` fails.
- [ ] **AC-3**: With a mocked `fetch`, `QbittorrentClient.remove("all", true)` throws and posts
      nothing to `torrents/delete`.
- [ ] **AC-4**: A valid upper-case 40-hex hash is accepted and stored lowercase (`053` unchanged).
- [ ] **AC-5**: `extractInfoHashFromMagnet("magnet:?xt=urn:btih:all")` returns no hash.

## Out of Scope

- **Batch `remove(hashes[])` callers.** Covered by REQ-3 at the client; a review of every batch call
  site was deferred by the audit.

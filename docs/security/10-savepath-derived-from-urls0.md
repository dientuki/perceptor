---
title: Give every source its own download folder, independent of the release URL
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-22
status: Draft
services: [api]
source_finding: api/acquisition/savepath-derived-from-urls0-with-unbound-infohash-cross-user-rm
audit_verdict: needs_validation
priority: 10
---

# SPEC (draft): Give every source its own download folder, independent of the release URL

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `7365e13`
> (source unchanged since `98f8779`).
> Shares its root cause with spec 02 (the caller-chosen `infoHash`); fixing 02 alone narrows this
> spec but does not close it, because two legitimate sources can still carry the same `urls[0]`.

## Context & Goal

`QbittorrentClient.add` computes the save folder as the first 16 hex characters of
`sha256(urls[0] ?? "")` joined to the downloads root (`clients/torrent/client.ts:196`) and returns it;
`AttachSourceService.attach` stores it as `MediaSource.downloadPath`
(`attach-source.service.ts:187`). The source itself is keyed by the caller-supplied `infoHash`
(`:67`), which nothing ties to `urls`, and the conflict check compares `infoHash` only (`:69`).
`downloadPath` is a plain nullable `VarChar(500)` with no unique constraint (`schema.prisma:283`).

A user who owns any title can therefore call `addTorrentToMovie` with the same `urls[0]` another user
already attached and a different, well-formed 40-hex `infoHash`. The new row gets the other user's
`downloadPath`. `downloadDelete` on the new row runs `deleteResidue`, whose only guard is
`isInsideRoot('downloads', path)` (`downloads.service.ts:1195`) and whose comment asserts the folder
is "owned by this source alone" (`:1215`); it then runs `rm(downloadPath, { recursive: true, force: true })`
(`:1218`). The `qbittorrent.remove` for the forged hash is a no-op (`:1076`), so the original torrent
keeps running, but its not-yet-encoded files are gone. An empty `urls` array maps every such attach to
one shared folder (`sha256("")`).

Impact is limited to in-flight download residue of another user; the library is never touched
(constitution Article XII). The goal is that a source's folder is unique to it and that no delete
removes a folder another source still references.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Unique folder per source)**: The download folder must be derived from something unique
      to the source (its validated lowercase `infoHash`, per spec 02), not from request content such
      as `urls[0]`. [NEEDS CLARIFICATION: `infoHash` as the key, or a random id stored on the row?
      The `infoHash` is stable across re-adds, which `060`'s "reactivate in place keeping
      `downloadPath`" relies on.]
- [ ] **REQ-2 (Shared-path guard)**: `deleteResidue` must not remove a path that any other
      `MediaSource` row still references as its `downloadPath` (equal, or a parent/child of it). It
      logs and skips instead.
- [ ] **REQ-3 (Empty urls refused)**: An attach with no usable `urls[0]` and no resolvable hash is
      refused before any qBittorrent call, so `sha256("")` can never be a shared folder.
      (Overlaps spec 11 REQ-1.)

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Article XII)**: No change widens what the api may delete; REQ-2 only narrows it.
- [ ] **NFR-2 (Existing rows)**: Rows already created with a `sha256(urls[0])` folder keep working;
      REQ-1 applies to new attaches only. [NEEDS CLARIFICATION: does a boot check need to flag rows
      that already share a `downloadPath`?]

## GraphQL Contract Delta

No shape change. No new error is required for REQ-1; REQ-3 reuses the validation error of spec 11.

## Data Model Changes

None required. [NEEDS CLARIFICATION: a non-unique index on `downloadPath` would make REQ-2's lookup
cheap; a unique constraint is not possible while `LOCAL_FOLDER` sources may point at a shared
folder.]

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: With a stub qBittorrent and a test DB, user A attaches `urls[0] = U`
      to title X; user B attaches the same `U` with a different 40-hex `infoHash` to title Y; a file is
      created in the shared folder; `downloadDelete` on B's source currently removes the folder while
      A's source still references it. After the fix the folder and file survive.
- [ ] **AC-2**: After REQ-1, the two attaches in AC-1 get different `downloadPath` values.
- [ ] **AC-3**: Two attaches with empty `urls` never share a folder, or are refused.
- [ ] **AC-4**: Deleting a source whose folder is referenced by no other row still removes it, for a
      torrent, a season pack and an upload; `065`/`060` re-add and Play-resume keep their path.

## Out of Scope

- **Format validation of `infoHash`** — spec 02. **Validation of `urls[]`** — spec 11.
- **Real qBittorrent behaviour** when re-adding an existing URL under a forged claimed hash; the
  deployment validation step in the audit covers it.

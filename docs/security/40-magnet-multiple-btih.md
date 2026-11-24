---
title: Forward a canonical magnet built from the one infoHash Perceptor stores
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/clients/torrent/parseMagnet-first-btih-vs-forwarded-raw-magnet-hash-divergence
audit_verdict: needs_validation
priority: 40
---

# SPEC (draft): Forward a canonical magnet built from the one infoHash Perceptor stores

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> `needs_validation`: which hash qBittorrent's libtorrent picks for a magnet with several `xt` values
> is not visible in source and no qBittorrent was available to test it. Line numbers refer to commit
> `2a3976a`.
> Sibling of spec 11 (raw `urls`/magnet forwarded to qBittorrent) and spec 02 (free `infoHash`);
> spec 02 already gives a user the same cross-torrent effect without any parser divergence.

## Context & Goal

`addMagnetToMovie` (`movies/movies.service.ts:738`), `addMagnetToEpisode`
(`episodes/episodes.service.ts:63`) and `addMagnetToSeason` (`seasons/seasons.service.ts:103`) call
`parseMagnet(input.magnet)` and then attach with `urls: [input.magnet]` (`:745`, `:70`, `:110`) and
the parsed `infoHash`.

`parseMagnet` (`clients/torrent/magnet.ts:25`) reads `URLSearchParams.getAll('xt')` (`:31`), an
exact-case name, and keeps the **first** `urn:btih:` value (`:33-35`). It does not check that only one
`xt` exists, and it ignores `xt.1`/`xt.2` and an upper-case `XT` name. The hunter's harness confirmed
the parser accepts multi-`xt`, `xt.N` and `XT` magnets and returns the first hash.

`AttachSourceService.attach` passes the raw `input.urls` to `qbittorrent.add`
(`acquisition/attach-source.service.ts:158`), which joins them verbatim into the `urls` field
(`clients/torrent/client.ts:201`), while the row stores the parsed `infoHash` (`:191`). Every later
`stop`/`start`/`remove` sends that stored value as `hashes` (`client.ts:255`, `:271-278`;
`remove` defaults to `deleteFiles: true`).

If libtorrent resolves a different hash than the first `btih` (the last `xt`, an `xt.N`, a
case-insensitive name), Perceptor's row points at a torrent it did not create, and the torrent it did
create is untracked. A delete could then remove another source's torrent and files, provided that
hash is not already a `MediaSource` row (`infoHash` is unique). Unproven: libtorrent's choice.

Goal: the magnet qBittorrent receives can only resolve to the hash Perceptor stores.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Single btih)**: `parseMagnet` rejects a magnet that carries more than one `urn:btih:`
      exact topic, counting `xt`, `xt.N` and any letter case of the name, with the existing
      `MAGNET_INVALID_INFOHASH` key or a new one. [NEEDS CLARIFICATION: is a hybrid v1+v2 magnet
      (`btih` plus `btmh`) still accepted, as today, when it has exactly one `btih`?]
- [ ] **REQ-2 (Canonical forward)**: The three `addMagnetTo*` paths forward
      `magnet:?xt=urn:btih:<parsed hash>` plus the original `dn` and `tr` parameters, never the raw
      string. [NEEDS CLARIFICATION: REQ-1, REQ-2 or both? REQ-2 alone makes the divergence
      impossible whatever libtorrent does; REQ-1 alone gives the user a clear error.]
- [ ] **REQ-3 (Stored url)**: `MediaSource.downloadUrl` stores the same string forwarded to
      qBittorrent, so a retry re-adds exactly that.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Same folder)**: REQ-2 changes `urls[0]` and so the `sha256(urls[0])` save folder for
      new attaches only; spec 060's re-add of an existing hash keeps its stored `downloadPath`.
      (Spec 10 replaces that folder derivation altogether.)
- [ ] **NFR-2 (Real magnets)**: Magnets from Prowlarr and from common sites (one `btih`, any number
      of `tr`) attach exactly as before.

## GraphQL Contract Delta

None in shape. If REQ-1 uses a new key, `error.magnet.multiple_infohash` [NEEDS CLARIFICATION:
reuse `invalid_infohash`?] is added to `web`'s `messages/{en,es}.json`.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: Against a throwaway qBittorrent of the installed version, POST
      `torrents/add` with `magnet:?xt=urn:btih:<A>&xt=urn:btih:<B>`, then `xt.1=…&xt.2=…`, then
      `XT=…`, and read `torrents/info`; record which hash qBittorrent creates and compare with
      `parseMagnet`'s first hash. Any mismatch confirms the finding.
- [ ] **AC-2**: After the fix each of the three magnets is either refused (REQ-1) or forwarded as a
      single-`btih` magnet whose hash equals the stored `infoHash` (REQ-2), checked with a stub
      qBittorrent recording the `urls` body.
- [ ] **AC-3**: A normal magnet with `dn` and several `tr` attaches, and its forwarded string keeps
      them.

## Out of Scope

- Validating the free `infoHash` argument of `addTorrentTo*` — spec 02.
- Validating `urls[]` and the newline split — spec 11.
- The `urls[0]`-derived save folder — spec 10.

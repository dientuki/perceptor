---
title: Validate torrent urls and magnets before they reach qBittorrent
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-22
status: Draft
services: [api]
source_finding: api/acquisition/torrent-urls-unvalidated-forwarded-to-qbittorrent-newline-split
audit_verdict: needs_validation
priority: 11
---

# SPEC (draft): Validate torrent urls and magnets before they reach qBittorrent

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `7365e13`
> (source unchanged since `98f8779`).
> Sibling of spec 02 (same entry points, the `infoHash` argument) and spec 05 (the same user URLs
> fetched by the api itself in `resolveInfoHash`); a shared URL validator serves all three.

## Context & Goal

`addTorrentToMovie` (and the episode and season equivalents) take `urls: [String]` from any
authenticated user with no scheme, host, count or length check (`movies.resolver.ts:139`).
`addMagnetToMovie` validates only the `magnet:?` prefix and the `xt` parameter via `parseMagnet`
(`movies.service.ts:745`, `magnet.ts:30-52`), then forwards the whole raw string as `urls: [input.magnet]`.
`AttachSourceService.attach` passes `input.urls` straight to `qbittorrent.add` (`:158`), which joins
them with `"\n"` into qBittorrent's `torrents/add` `urls` field (`client.ts:201`); qBittorrent splits
on newline and fetches every entry. `urls[0]` is also persisted as `downloadUrl` (`:177`).

Any authenticated user can thus make the `torrent` container issue GET requests to attacker-chosen
http(s) URLs, including services on `perceptor-net` (blind SSRF). Impact is limited: the response is
not returned, only GETs are issued, and the newline smuggling through a magnet's `dn` adds nothing
beyond what `urls[]` already allows. Whether qBittorrent also loads non-URL lines as local file paths,
and whether the container's egress is filtered, is not visible in source.

The goal is that only a magnet link or an http(s) `.torrent` URL, in bounded number and length, ever
reaches the client.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (urls[] shape)**: `addTorrentTo*` must refuse, before any client or database call,
      an empty list, more than a small bound of entries, an entry over a length bound, an entry
      containing `\n` or `\r`, and an entry that is neither a `magnet:?` link nor an `http:`/`https:`
      URL. [NEEDS CLARIFICATION: bounds — 1 entry and 2048 characters? Does any web flow send more
      than one URL?]
- [ ] **REQ-2 (Magnet is a single magnet)**: `addMagnetTo*` must forward the magnet as validated:
      no control characters or newlines anywhere in the string, bounded length.
- [ ] **REQ-3 (Client guard)**: `QbittorrentClient.add` must itself refuse an entry with a newline or
      a scheme other than `magnet`/`http`/`https`, so a future caller cannot bypass REQ-1.
- [ ] **REQ-4 (Destination policy)**: [NEEDS CLARIFICATION: should http(s) hosts be restricted (no
      loopback, link-local, private or compose service names), reusing the policy chosen in spec 05,
      or is REQ-1 enough given qBittorrent does the fetch and the response is never returned?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (One validator)**: One shared URL/magnet validator serves `addTorrentTo*`,
      `addMagnetTo*`, the client and, per spec 05, `resolveInfoHash`.
- [ ] **NFR-2 (Indexer results still work)**: Release URLs returned by Prowlarr (including its
      proxied download links) must pass REQ-1. [NEEDS CLARIFICATION: confirm which hosts/schemes
      Prowlarr emits, e.g. `http://indexer:9696/...`, since REQ-4 must not break them.]

## GraphQL Contract Delta

No shape change. New refusal on the six `addTorrentTo*`/`addMagnetTo*` mutations:

| Condition | GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| An entry is not a magnet or http(s) URL, has a newline, or exceeds the bounds | `BadRequestException`, key [NEEDS CLARIFICATION: `error.magnet.invalid_url`? reuse `MAGNET_INVALID_*`?] | the existing attach error dialog |

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: Against a stub qBittorrent endpoint, `addTorrentToMovie` with
      `urls: ['http://127.0.0.1:PORT/probe']` currently makes the stub receive that entry in the
      `urls` form field; after REQ-4 (if adopted) it is refused, and with REQ-1 only it is still
      accepted (documenting the residual blind SSRF).
- [ ] **AC-2**: `addMagnetToMovie` with a magnet whose `dn` contains a newline followed by a URL
      currently reaches the stub with two lines in `urls`; after REQ-2 it is refused.
- [ ] **AC-3**: `urls: ['file:///etc/passwd']`, `['/downloads/x']`, `[]`, and an entry containing
      `\n` are all refused with no client call and no `MediaSource` row.
- [ ] **AC-4**: A real magnet, a Prowlarr download URL and a pasted magnet still attach for a film,
      an episode and a season.

## Out of Scope

- **`infoHash` format** — spec 02. **Download folder derivation** — spec 10.
- **`resolveInfoHash`'s own fetch** (api-side SSRF, unbounded body) — spec 05.
- **qBittorrent container egress filtering** — deployment concern.

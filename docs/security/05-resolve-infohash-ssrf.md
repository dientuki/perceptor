---
title: Restrict and bound resolveInfoHash fetches
spec_version: 0.1.0
author: security-audit run-1 (draft)
created_at: 2026-11-20
last_updated: 2026-11-20
status: Draft
services: [api]
source_finding: api/clients/indexer/resolveInfoHash-unrestricted-fetch-unbounded-body
audit_verdict: needs_validation
priority: 5
---

# SPEC (draft): Restrict and bound resolveInfoHash fetches

> Draft written from a static security audit (`security-audit` skill, run-1, profile `quick`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `98f8779`.

## Context & Goal

`040`/`053` resolve `infoHash` lazily: when `addTorrentTo*` gets `infoHash: null`,
`resolveInfoHash(urls)` (`clients/indexer/resolve-info-hash.ts`) GETs each non-magnet URL from the
api container (`:39`) and parses the body as a `.torrent`. The `urls` come straight from the GraphQL
argument of any signed-in user (`episodes.resolver.ts:23`, `movies.service.ts:723`,
`seasons.service.ts:87`, `attach-source.service.ts:67`). There is no scheme or host check, so this
is a blind SSRF into `perceptor-net` and host-local services (success, failure and timing are
observable), and the 2xx body is read with `arrayBuffer()` with no byte cap (`:54`) — only an 8 s
timeout per URL (`:10`) and no limit on the number of URLs beyond the 2 MB JSON body limit.
Concurrent calls can exhaust the shared api process's memory. The same URLs are then handed to
qBittorrent, which fetches them again from the `torrent` container.

The intended source is a Prowlarr download link returned by `searchTorrents`.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Allowed targets)**: `resolveInfoHash` must fetch only URLs that point at the configured
      indexer (Prowlarr) and refuse everything else without a request.
      [NEEDS CLARIFICATION: do some Prowlarr results carry a direct tracker URL that must stay
      resolvable? If so, the rule is "http(s) only, never a private/loopback/link-local address" instead
      of an indexer-only allowlist.]
- [ ] **REQ-2 (Body cap)**: A response body over a fixed limit must be aborted while streaming.
      [NEEDS CLARIFICATION: limit — a `.torrent` for a season pack can reach a few MB; 10 MB?]
- [ ] **REQ-3 (URL count)**: The number of URLs accepted per call must be bounded.
- [ ] **REQ-4 (Redirects)**: Redirects stay manual and a `Location` pointing at a magnet is the only
      one followed for its hash; a redirect to an http URL is checked against REQ-1.
- [ ] **REQ-5 (qBittorrent hand-off)**: [NEEDS CLARIFICATION: should the same URL rule apply to what
      `addTorrentTo*` passes to `qbittorrent.add`, so the torrent container is not an SSRF relay?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Same posture as today on failure)**: A refused or capped URL makes the hash unresolved,
      which already has a defined outcome; no new user-visible state.

## GraphQL Contract Delta

No shape change. A refused URL yields the existing unresolved-hash error of `addTorrentTo*`
[NEEDS CLARIFICATION: confirm which key that is today, or add `error.download.url_not_allowed`].

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: `addTorrentToMovie` with `infoHash: null` and `urls: ["http://redis:6379/"]` makes no
      outbound request and fails.
- [ ] **AC-2**: A loopback fixture serving a 64 MB 200 body is aborted at the cap; api RSS does not grow
      by the body size.
- [ ] **AC-3**: A call with more URLs than the limit is refused.
- [ ] **AC-4**: A real Prowlarr download link from `searchTorrents` still resolves its hash.

## Out of Scope

- **Outbound hosts set by an admin** (`media_server_host`, provider URLs). Deferred by the audit; an
  admin choosing a host is a different trust level.

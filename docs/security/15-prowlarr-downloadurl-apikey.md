---
title: Never forward Prowlarr's API key to users inside downloadUrl
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-22
status: Draft
services: [api]
source_finding: api/indexer/prowlarr-downloadurl-apikey-passed-to-users
audit_verdict: needs_validation
priority: 15
---

# SPEC (draft): Never forward Prowlarr's API key to users inside downloadUrl

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `7365e13`
> (source unchanged since `98f8779`).

## Context & Goal

`filterData` maps each Prowlarr row to `items[].downloadUrl = item.magnetUrl ?? item.downloadUrl ??
item.guid ?? null` (`clients/indexer/client.ts:91`) with no scrubbing. `searchTorrents`
(`indexer.resolver.ts:23-45`) is open to any authenticated user (no admin guard) and returns it as
`TorrentLink.downloadUrl` (`entities/torrent-result.entity.ts:6`); `web` renders it
(`SearchTorrent.tsx:332`).

For indexers without a magnet, Prowlarr's proxied download link is expected to carry
`?apikey=<Prowlarr API key>`, the same value the api sends as `X-Api-Key` (`client.ts:125`,
`tracker_api_key` / `INDEXER_API_KEY`). If so, any user can read the admin credential of Prowlarr,
which is published on `INDEXER_PORT` and behind Traefik (`indexer.<DOMAIN>`), and administer it
(add or remove indexers, read other settings). Whether the key is present depends on Prowlarr's
response format, which is outside this repository; no `apikey` handling exists in `clients/indexer/`
or `indexer/`.

The same URL is submitted back by the user to `addTorrentTo*` and handed to qBittorrent
(`attach-source.service.ts:177`), and the sweeps use it directly (`acquire-movies.task.ts:115`,
`acquire-episodes.task.ts:114`), so removing it is not free: qBittorrent must still be able to fetch.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (No credential to the client)**: A `downloadUrl` returned by `searchTorrents` must not
      contain Prowlarr's API key in any query parameter.
- [ ] **REQ-2 (Still acquirable)**: A non-magnet release must still attach and download. Smallest fix
      candidate: strip `apikey` from the returned URL and have the api re-add it server-side when
      it fetches or hands the URL on (only for URLs on `tracker_host:tracker_port`).
      [NEEDS CLARIFICATION: alternatively resolve the `.torrent` to a magnet/hash in the api (as
      `resolveInfoHash` already does) and return only that; which is preferred?]
- [ ] **REQ-3 (Redis cache)**: Cached `TorrentResult` entries must not hold the key either; entries
      written before the fix are dropped or scrubbed on read. [NEEDS CLARIFICATION: bump the cache
      key version or scrub on read?]
- [ ] **REQ-4 (Rotation note)**: After fixing, the owner rotates the Prowlarr key (`INDEXER_API_KEY`,
      restart `indexer` and `api`); document it in the spec's rollout notes.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No logging)**: The key is not logged when URLs are logged.
- [ ] **NFR-2 (SSRF interplay)**: Re-adding the key applies only to the configured Prowlarr origin,
      so it is never sent to a user-chosen host. See spec 05.

## GraphQL Contract Delta

No shape change; the value of `TorrentLink.downloadUrl` loses the credential.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: With one non-magnet indexer in a sandbox Prowlarr, `searchTorrents` as a non-admin
      currently returns an `items[].downloadUrl` containing `apikey=<tracker_api_key>` (reproduces,
      if Prowlarr emits it); after the fix no returned item contains the key, tested with a mocked
      Prowlarr row too.
- [ ] **AC-2**: Attaching that release from the (scrubbed) URL still downloads through qBittorrent.
- [ ] **AC-3**: A magnet row is unchanged.
- [ ] **AC-4**: A cached result from before the fix is not served with the key (REQ-3).
- [ ] **Deployment check**: the owner inspects `searchTorrents` on their install; if the key shows,
      rotate it after the fix.

## Out of Scope

- **Exposure of `indexer.<DOMAIN>` through Traefik** and Prowlarr's own auth, an infra question.

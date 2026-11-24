---
title: Range-check media-server provider ids so one bad item cannot fail the index rebuild
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/media-server-index/provider-id-int-overflow-aborts-whole-rebuild
audit_verdict: needs_validation
priority: 44
---

# SPEC (draft): Range-check media-server provider ids so one bad item cannot fail the index rebuild

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> `needs_validation`: the real Prisma/MariaDB rejection of a value above `Int` range in `createMany`
> was not run, and whether a catalog title can plant a `[tmdbid=N]` tag Jellyfin then trusts is
> unverified. Line numbers refer to commit `2a3976a`.
> Related to spec 16 (any user's Refresh triggers a rebuild); together they turn one bad item into a
> repeatable failed sync, but neither fix closes the other.

## Context & Goal

The media-server clients accept any positive integer as a TMDB id. Jellyfin's `toLibraryEntries`
(`clients/media-server/jellyfin.ts:133`) runs `Number(item.ProviderIds.Tmdb)` (`:141`) and keeps it if
`Number.isInteger(tmdbId) && tmdbId > 0` (`:142`); Plex's `extractTmdbId` (`plex.ts:67`) does the
same (`:77-78`). Neither has an upper bound, so `99999999999` passes.

`MediaServerIndexService.rebuild` (`media-server-index/media-server-index.service.ts:61`) dedupes
entries by `mediaType:tmdbId` (`:91`) and then runs one `$transaction` of `deleteMany` plus chunked
`createMany` (`:94-102`) into `MediaServerItem.tmdbId`, a 32-bit `Int` (`schema.prisma:686`). One row
above 2147483647 should make the whole transaction reject; the catch writes state `failed` (`:106-108`)
and, since the `deleteMany` is rolled back with it, the previous index stays. `indexUsable`
(`media-server/media-server-reconcile.service.ts:265-270`) then reads `failed`, so every title
Refresh/sync returns `failed` (`:137`) until the bad item disappears from the media server.

How the bad id gets there: an administrator's faulty or hostile media server can return it directly.
A lower-trust path is plausible but unverified: the worker's `sanitize` (`worker/src/paths/build-output-path.ts:19-25`)
strips `:`, `-`, `'`, quotes and path characters but keeps `[`, `]` and `=`, so a catalog title
containing `[tmdbid=99999999999]` would reach the library folder name beside the real tag (`:50`).
Whether Jellyfin takes that tag into `ProviderIds.Tmdb`, and which tag wins, is not known.

The goal is that an out-of-range id is dropped per item and never fails the rebuild.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Range check at ingestion)**: Both clients' `toLibraryEntries`/`extractTmdbId` drop an
      id above 2147483647 the same way they already drop a non-integer or non-positive one.
- [ ] **REQ-2 (Defence at the sink)**: `rebuild` filters any entry whose `tmdbId` is outside the
      `Int` range before `createMany`, logging the count dropped, so a future client cannot
      reintroduce the failure.
- [ ] **REQ-3 (Folder tag)**: [NEEDS CLARIFICATION: should the worker's `sanitize` also strip `[`,
      `]`, `{`, `}` and `=` from catalog titles so a title can never forge a `[tmdbid=…]` or
      `{tmdb-…}` tag? That changes folder names of new deliveries for titles that legitimately
      contain brackets; it is a `worker` task and needs the layout rules of `072` re-checked.]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Unchanged semantics)**: A rebuild that fails for any other reason still keeps the old
      index and reports `failed` (spec 034 REQ-4/REQ-5, spec 069's "an outcome, not an error").
- [ ] **NFR-2 (No schema widening)**: TMDB ids fit in `Int`; the column is not widened to `BigInt`.

## GraphQL Contract Delta

None.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: In a dev stack with MariaDB, call `rebuild` with a fake client
      whose `listLibrary` returns one valid entry and one with `tmdbId: 99999999999`; today Prisma
      rejects the `createMany`, the state becomes `failed` and the old rows remain. After the fix the
      state is `ready` with the valid entry only.
- [ ] **AC-2**: `toLibraryEntries` (Jellyfin and Plex) unit tests: `"2147483647"` is kept,
      `"2147483648"` and `"99999999999"` are dropped.
- [ ] **AC-3**: A title Refresh after AC-1's library promotes/demotes normally instead of `failed`.
- [ ] **AC-4 (deployment, informational)**: On a test Jellyfin, a folder
      `X [tmdbid=99999999999] (2020) [tmdbid=603]` with a dummy mkv is scanned and
      `Items?fields=ProviderIds` read, to settle whether REQ-3 is needed.

## Out of Scope

- **Throttling the rebuild a Refresh triggers** — spec 16.
- **Trusting the media server at all** — the administrator chooses it; this spec only bounds the
  damage of one malformed item.

---
title: Throttle the media-server rebuild a title Refresh triggers
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-22
status: Draft
services: [api]
source_finding: api/media-server-index/user-refresh-triggers-unthrottled-full-library-rebuild
audit_verdict: needs_validation
priority: 16
---

# SPEC (draft): Throttle the media-server rebuild a title Refresh triggers

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `7365e13`
> (source unchanged since `98f8779`). Availability only, bounded: a self-hosted install with
> admin-provisioned users.

## Context & Goal

`refreshMovie` (`movies.resolver.ts:286`) and `refreshShow` (`shows.resolver.ts:240`) are callable
by any authenticated owner of one title. They reach `syncMovie`/`syncShow`
(`media-server-reconcile.service.ts:133`, `:167`), which call `indexUsable` (`:265`), which calls
`refreshAndWait` (`:269`) and so `rebuild` (`media-server-index.service.ts:61`) with no staleness
check. Each rebuild lists the admin's whole Jellyfin or Plex library and does a `deleteMany` plus
chunked `createMany` on the shared `MediaServerItem` table (`:96`).

The only controls are a per-title refresh claim and a 20-minute Redis claim (`REBUILD_CLAIM_KEY`,
`:8`, `:10`, taken at `:66`). The latter serialises rebuilds but does not bound their frequency:
chained refreshes on different titles keep the media server and database busy, and other users'
refreshes poll `readState` (`:136`) until the deadline equal to the claim TTL. Secondary defect:
the `finally` deletes the claim unconditionally (`:110`), even if its TTL expired and another
rebuild now holds it.

The goal is a minimum interval between rebuilds, installation-wide, without breaking `069`'s
guarantee that a Refresh acts on a fresh index.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Minimum interval)**: `refreshAndWait` reuses a `ready` index younger than a minimum
      age instead of rebuilding. [NEEDS CLARIFICATION: threshold (e.g. 60 s?) and whether the admin's
      explicit "Re-sincronizar" and the boot/scheduler paths bypass it, which seems right.]
- [ ] **REQ-2 (Freshness contract)**: When the throttled path serves an index younger than the
      threshold, the Refresh outcome is still computed against it, never `FAILED`.
      [NEEDS CLARIFICATION: is a 069 Refresh right after a file delivery allowed to see an index
      older than the delivery? A delivery may need to force a rebuild.]
- [ ] **REQ-3 (Own the claim)**: `rebuild` releases the claim only if it still holds it (store a
      token, delete by compare-and-delete).
- [ ] **REQ-4 (Per-user)**: [NEEDS CLARIFICATION: also a per-user rate limit on `refreshMovie`/
      `refreshShow`, or is REQ-1 enough?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Article XII)**: No change to what is written to or deleted from the library.
- [ ] **NFR-2 (Reads unchanged)**: Index `lookup` behaviour is unchanged.

## GraphQL Contract Delta

None. Behaviour of `refreshMovie`/`refreshShow` only.

## Data Model Changes

None. `MediaServerIndexStatusSnapshot` already carries the last-built timestamp
(`writeState('ready', n, new Date())`).

## Acceptance Criteria

- [ ] **AC-1**: With a mock Jellyfin counting `/Items` requests and a seeded user, calling
      `syncMovie` N times for different titles currently produces N full listings (reproduces);
      after the fix, N calls inside the interval produce one.
- [ ] **AC-2**: A Refresh after the interval rebuilds again and still promotes/demotes correctly
      (`069`).
- [ ] **AC-3**: An admin "Re-sincronizar" rebuilds regardless of age.
- [ ] **AC-4**: A rebuild whose claim expired does not delete the claim a second rebuild now holds.
- [ ] **Deployment check**: the owner times repeated Refresh clicks from two test users on a large
      library and watches request volume to Jellyfin/Plex.

## Out of Scope

- **Rebuild cost itself** (streaming the listing, upserting rather than `deleteMany`), a larger
  redesign. Spec 06 and 07 are unrelated session fixes.

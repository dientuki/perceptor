---
title: Restrict the mediaRoots query to administrators
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/media-roots/media-roots-query-returns-host-paths-to-any-user
audit_verdict: needs_validation
priority: 43
---

# SPEC (draft): Restrict the mediaRoots query to administrators

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> `needs_validation`: a host path is not a credential, so whether non-admin visibility matters is an
> owner decision, and the real `JwtAuthGuard` was not exercised with a non-admin token.
> Line numbers refer to commit `2a3976a`.

## Context & Goal

`MediaRootsResolver.mediaRoots` (`media-roots/media-roots.resolver.ts:9-15`) has no `@UseGuards`;
only the global `JwtAuthGuard` applies, so any user with a live session reaches it.
`MediaRootsService.getRoots` (`media-roots.service.ts:14-21`) maps every configured root to `id`,
`label`, `hostPath` (straight from `HOST_DOWNLOADS_DIR` / `HOST_DESTINATIONS_DIR`) and `available`
(whether the container path exists), with no filtering by caller. `MediaRoot.hostPath` is a non-null
public field (`entities/media-root.entity.ts:11-12`).

The sibling `environmentInfo`, which returns the same class of deployment-layout data, is
`AdminGuard`-gated per method (`environment/environment.resolver.ts:16`). The only `web` consumer of
`mediaRoots` is `getMediaRoots` (`web/src/actions/media-roots.ts:19`), called from the Settings page
(`app/(dashboard)/settings/page.tsx:52`), which itself 404s for a non-admin (`:37-38`). No non-admin
feature needs the field.

A non-admin user can therefore read the absolute host paths of the downloads and library roots.
Impact is a layout disclosure only. The goal is that `mediaRoots` follows the `environmentInfo`
policy.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Admin only)**: `mediaRoots` is gated with `@UseGuards(AdminGuard)` on the method,
      following the per-method convention `environment.resolver.ts` documents.
- [ ] **REQ-2 (Admin unchanged)**: An administrator's Settings page receives the same four fields
      as today.
- [ ] **REQ-3 (Policy decision)**: [NEEDS CLARIFICATION: is non-admin visibility of host mount paths
      acceptable on a ~5-user install? If yes, this spec closes as "won't fix" and the decision is
      recorded beside `environmentInfo`'s guard.]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Internal callers)**: `MediaRootsService` methods used inside `api` (`toHostPath`,
      `containerToHostPath`, `isInsideRoot`, media-server notify) are unaffected; only the GraphQL
      entry point changes.

## GraphQL Contract Delta

No shape change. Behavioural change only:

| Condition | GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Non-admin calls `mediaRoots` | existing `error.auth.admin_required` (forbidden) | none (`web` only calls it from the admin-only Settings page) |

`docs/spec/graphql-contract.md` should note the operation is admin-only.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: Against a dev stack, a non-admin user sends
      `query { mediaRoots { id hostPath } }`; today the host paths are returned. After the fix the
      call fails with `error.auth.admin_required` and returns no data.
- [ ] **AC-2**: An admin sends the same query and receives `id`, `label`, `hostPath` and `available`
      for both roots.
- [ ] **AC-3**: The Settings page renders the path fields for an admin with no error.

## Out of Scope

- **Container paths** — they never cross the GraphQL boundary today and this spec keeps it so.
- **An audit of other non-admin fields that may carry host paths** — not part of this finding.

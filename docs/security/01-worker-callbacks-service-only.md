---
title: Worker callbacks reachable by user sessions
spec_version: 0.1.0
author: security-audit run-1 (draft)
created_at: 2026-11-20
last_updated: 2026-11-20
status: Draft
services: [api]
source_finding: api/auth/allow-service-admits-user-principal-on-worker-callbacks
audit_verdict: needs_validation
priority: 1
---

# SPEC (draft): Worker callbacks reachable by user sessions

> Draft written from a static security audit (`security-audit` skill, run-1, profile `quick`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `98f8779`.
> Promote to `docs/spec/features/NNN-slug/` through `/specify` before implementing.

## Context & Goal

`@AllowService()` is **additive**: `JwtAuthGuard` (`services/api/src/auth/guards/jwt-auth.guard.ts:51`)
rejects a service principal on an operation that lacks it, but never rejects a *user* principal on
an operation that has it. Several resolvers treat the decorator as if it meant "service only" and
skip the in-body `principal.type === 'service'` assertion that their siblings make
(`encodeWorkerStarted`, `sourceScanFailed`, the subtitle-embed operations through `assertService`,
`subtitle-embed.resolver.ts:252`).

The nine operations without that assertion are `processJob`, `encodeStarted`, `encodeProgress`,
`encodeCompleted`, `encodeFailed`, `downloadRemove` (`process-jobs.resolver.ts`), `mediaSource`,
`sourceScanned` (`media-sources.resolver.ts`) and `torrentCompleted` (`downloads.resolver.ts:19`).
Their services act on caller-chosen ids with no ownership check. Any signed-in user could therefore:

- `downloadRemove(mediaSourceId)`: remove any user's torrent **and its files** from qBittorrent
  (`process-jobs.service.ts:664-671`), bypassing `downloadDelete`'s `findOwnedSource`.
- `encodeCompleted`: write an arbitrary string into another user's `Movie/Episode.filePath`
  (`process-jobs.service.ts:397,403`) and trigger the media-server notify and the library probe.
- `sourceScanned`: register caller-chosen file paths and queue encodes (see spec 03).
- `processJob`/`mediaSource`: read other users' pipeline rows and container paths
  (`getEncodeJobDetails`, `process-jobs.service.ts:92`).

Once this ships, every worker/hook callback refuses a user principal, whatever the decorator says.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Service-only operations)**: An operation meant only for the worker or the qBittorrent
      AutoRun hook must refuse a user principal with the same unauthenticated error a service
      principal gets on a user-only operation.
- [ ] **REQ-2 (Coverage)**: REQ-1 must hold for all nine operations above and for any operation
      added later with the same intent, without relying on each resolver remembering an in-body check.
- [ ] **REQ-3 (Shared operations unchanged)**: An operation that is genuinely reachable by both users
      and the service keeps working for both. [NEEDS CLARIFICATION: is any `@AllowService` operation
      today meant for both principals? An inventory of every `@AllowService` usage decides which
      decorator (additive vs exclusive) each one gets.]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Fail closed)**: The default for a new service operation must be service-only; opening
      it to users must be an explicit, visible choice.
- [ ] **NFR-2 (No worker change)**: The worker and the AutoRun hook keep using `SERVICE_TOKEN`
      unchanged; no contract change on their side.

## GraphQL Contract Delta

None in shape — no operation, argument or type changes. Behavioural change only:

| Condition | GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| User session calls a service-only operation | existing `AUTH_UNAUTHENTICATED` / `error.auth.*` key | none — `web` never calls these operations |

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: Given user B signed in and a `MediaSource` owned only by user A, when B sends
      `downloadRemove(mediaSourceId)`, then the call fails unauthenticated and `TorrentClient.remove`
      is never called.
- [ ] **AC-2**: Given user B, when B sends `encodeCompleted` for a job on A's film, then it fails and
      `Movie.filePath` is unchanged.
- [ ] **AC-3**: Each of the nine operations, called with a user JWT, fails; called with
      `SERVICE_TOKEN`, it behaves as today (regression test per operation).
- [ ] **AC-4**: A full pipeline run (torrent → scan → encode → library) still completes with the
      worker on `SERVICE_TOKEN`.

## Out of Scope

- **Ownership checks inside the service methods.** Once only the service can reach them, the worker
  is trusted to pass the ids it was given; adding per-owner checks would need a principal the
  worker does not have.
- **Path confinement of `sourceScanned` input.** Tracked separately in spec 03 (defence in depth even
  against a compromised worker).

## Suggested approach (non-normative)

Either an exclusive decorator (`@ServiceOnly()`) read by `JwtAuthGuard`, or turning `@AllowService`
into exclusive and adding a separate `@AllowUserAndService` for the rare shared case. A guard-level
fix is preferred over nine copies of `assertService`.

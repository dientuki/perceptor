---
title: Bound who can record ffprobe logs and how much they can store
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/ffprobe-logs/record-ffprobe-user-callable-unbounded-persistent-rows
audit_verdict: needs_validation
priority: 41
---

# SPEC (draft): Bound who can record ffprobe logs and how much they can store

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> `needs_validation`: real MariaDB growth was not exercised (no database on the host), and whether a
> logged-in user filling the shared database is in scope for a ~5-user install is a policy call.
> Line numbers refer to commit `2a3976a`.
> Shares its root cause with spec 01 (`@AllowService` admits a user principal); spec 01's guard-level
> fix closes the user-reachable half of this spec on its own.

## Context & Goal

`recordFfprobe` (`ffprobe-logs/ffprobe-logs.resolver.ts:13-23`) carries only `@AllowService()`. As
spec 01 describes, that decorator is additive: the global `JwtAuthGuard` (`app.module.ts:81`, the
only `APP_GUARD`) still admits a user session, and the method makes no `principal.type === 'service'`
assertion. Its siblings `ffprobeLogs`, `ffprobeLog` and `deleteFfprobeLog` are `AdminGuard`-gated
(`:25`, `:38`, `:47`); only the worker calls `recordFfprobe` (`worker/src/jobs/encode.job.ts:175`).

`FfprobeLogsService.record` (`ffprobe-logs.service.ts:12`) only checks that `file` and `ffprobe` are
non-blank (`:13`) and then `prisma.ffprobeLog.create` (`:17`) stores both strings unmodified. The
column is `MediumText` (`schema.prisma:671`, up to 16 MB; `file` is `VarChar(500)`), the table has no
owner column, and the only request bound is the 2 MB JSON body limit (`main.ts:48`). There is no
throttle, quota or retention: spec 023 lists pruning as out of scope ("grows one row per encode
forever") and `067` deliberately keeps `FfprobeLog` when a title is removed.

Any signed-in user can therefore append ~2 MB rows at will, growing the shared MariaDB volume and
every `./backups` dump, and plant forged diagnostic rows that an administrator later reads as worker
output. The goal is that only the worker writes this table and that a single row has a bound.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Service only)**: `recordFfprobe` refuses a user principal with the same
      unauthenticated error the other worker callbacks return. Satisfied by spec 01 REQ-1/REQ-2 if
      that ships first; otherwise an in-body `assertService` here.
- [ ] **REQ-2 (Row bound)**: `record` refuses an `ffprobe` payload above a fixed byte cap with a
      keyed `badRequest`, before any write. [NEEDS CLARIFICATION: the cap. A real `ffprobe -show_streams
      -show_format` JSON of a Blu-ray remux with many tracks and chapters is the sizing case; measure
      the largest one in the existing table before picking a number.]
- [ ] **REQ-3 (Retention)**: [NEEDS CLARIFICATION: does this spec add a retention rule (row count or
      age), or does it stay deferred as spec 023 decided? With REQ-1 in place the growth rate is one
      row per encode again, which 023 judged negligible.]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Encode never blocked)**: A refused or failed `recordFfprobe` keeps today's behaviour
      in the worker: the encode still reaches `encodeCompleted` (spec 023 NFR-1).
- [ ] **NFR-2 (Existing rows)**: Rows already stored are left untouched; nothing is truncated or
      deleted at boot.

## GraphQL Contract Delta

No shape change. Behavioural change only:

| Condition | GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| User session calls `recordFfprobe` | existing `error.auth.unauthenticated` | none (`web` never calls it) |
| `ffprobe` above the cap (REQ-2) | new `error.ffprobeLog.payload_too_large` | none (worker only, logged) |

## Data Model Changes

None. REQ-3, if adopted, needs no column: `createdAt` is already stored.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: Against a disposable MariaDB, a non-admin user's JWT calls
      `recordFfprobe(file: "x", ffprobe: <1.9 MB string>)` twenty times; today every call succeeds,
      twenty rows persist and `information_schema.tables.data_length` for `ffprobe_logs` grows by
      roughly 38 MB, and no job ever prunes them. After the fix every call fails unauthenticated and
      no row is written.
- [ ] **AC-2**: `SERVICE_TOKEN` with a payload above the REQ-2 cap is refused and writes nothing;
      one just under the cap is stored.
- [ ] **AC-3**: A full encode with the worker still records exactly one row before `encodeCompleted`,
      and a refused record does not fail the encode (NFR-1).

## Out of Scope

- **The decorator semantics for every other worker callback** — spec 01.
- **An admin screen for the log** — still out of scope as in spec 023.

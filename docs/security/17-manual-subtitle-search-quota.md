---
title: Bound manual subtitle searches per user and per day
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-22
status: Draft
services: [api]
source_finding: api/subtitle-search/manual-search-unbounded-shared-quota-and-sync-queue
audit_verdict: needs_validation
priority: 17
---

# SPEC (draft): Bound manual subtitle searches per user and per day

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `7365e13`
> (source unchanged since `98f8779`). Availability only, low impact on a self-hosted install of
> about five trusted users.

## Context & Goal

`searchMovieSubtitles` / `searchEpisodeSubtitles` (`subtitle-search.resolver.ts:78`) need only an
authenticated user (`assertUser`) and `subtitleSearchAvailable`. `requestForCaller`
(`subtitle-search-request.service.ts:93`) checks ownership and file possession through the embed
preflight (`:98`), then `createGuarded` (`:202`), whose only throttle is superseding a non-terminal
search of the **same target**. There is no limit on how many titles one user can search.

Each search downloads up to three candidates per language from the admin's single OpenSubtitles /
Subdivx account (a small daily quota, spec `106`) and, for each candidate, enqueues an `ffsubsync`
job (`subtitle-search.driver.ts:851` -> `subtitle-sync-queue.service.ts:19`) into one queue that the
worker consumes with `concurrency: 1` (`services/worker/src/index.ts:212`), shared with admin
embed-sync jobs, each allowed 20 minutes (`subtitle-sync.job.ts:15`). A user who owns many titles
with files can start a search on all of them and exhaust the quota (the rest then read
`error.subtitleSearch.quota_exhausted`, `driver.ts:811`) and keep the sync queue busy for hours,
degrading the feature for everyone else. Nothing crashes; the cost is one shared feature.

Goal: a small, per-user budget on manual searches, so one user cannot spend the whole shared quota.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Per-user daily budget)**: `requestForCaller` must refuse a new manual search once the
      caller has started N searches in the last 24 hours.
      [NEEDS CLARIFICATION: N, and whether the budget is configurable in Settings or fixed — the
      provider quota is about 20 downloads a day and a search can spend up to 3 per language.]
- [ ] **REQ-2 (Per-user in-flight cap)**: A user may have at most M non-terminal searches at once.
      [NEEDS CLARIFICATION: M — 2 or 3?]
- [ ] **REQ-3 (Administrators)**: [NEEDS CLARIFICATION: are administrators exempt, or counted like
      everyone? An admin already controls the account that owns the quota.]
- [ ] **REQ-4 (Refusal is keyed)**: A refused search answers `BadRequestException` with an i18n key and
      creates no row, no provider call and no queue job.
- [ ] **REQ-5 (Automatic search unaffected)**: The `103` automatic search (delivery-triggered) is not
      counted against the manual budget.
      [NEEDS CLARIFICATION: should it share the provider budget instead? The audit only covered the
      manual entry point.]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No new state)**: The count is read from existing `SubtitleSearch` rows (owner and
      `createdAt`); no counter column or Redis key is introduced.
      [NEEDS CLARIFICATION: does `SubtitleSearch` record the requesting user today? Not confirmed.]
- [ ] **NFR-2 (Concurrency-safe)**: Two simultaneous requests from one user cannot both pass the
      budget check (count and insert in the same transaction as `createGuarded`).

## GraphQL Contract Delta

No shape change. New refusal on both mutations:

| Condition | GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Budget or in-flight cap reached | `BadRequestException`, key [NEEDS CLARIFICATION: `error.subtitleSearch.rate_limited`?] | "Alcanzaste el límite de búsquedas de subtítulos por hoy" (Rioplatense, both catalogs) |

## Data Model Changes

None expected, subject to NFR-1. If the requesting user is not stored, a nullable
`SubtitleSearch.requestedById` plus an index on (`requestedById`, `createdAt`) is the smallest
addition [NEEDS CLARIFICATION: confirm with the schema].

## Acceptance Criteria

- [ ] **AC-1 (reproduces the bug)**: With a stub provider and a non-admin owner of 30 titles that hold
      a file, calling `searchMovieSubtitles` for each succeeds 30 times and enqueues 30 sync jobs
      today; this must fail from the (N+1)-th call.
- [ ] **AC-2**: A second user's search, made after the first user hit the budget, is accepted.
- [ ] **AC-3**: The refused call leaves no `SubtitleSearch` row, no provider download and no job.
- [ ] **AC-4**: Two concurrent calls at budget N-1 yield exactly one success.
- [ ] **AC-5**: Re-searching the same title still supersedes the running search as before and a normal
      single search still resolves.

## Out of Scope

- **A global provider-quota ledger** (reading the provider's remaining-download header). Worth its own
  look; the per-user budget is the smallest fix.
- **Splitting the `subtitle-sync` queue** so embed-sync jobs do not wait behind searches
  (`services/worker`).

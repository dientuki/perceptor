---
title: Group indexer rows without a prototype-bearing key
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-22
status: Draft
services: [api]
source_finding: api/indexer/filterdata-proto-key-throws-search
audit_verdict: needs_validation
priority: 14
---

# SPEC (draft): Group indexer rows without a prototype-bearing key

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `7365e13`
> (source unchanged since `98f8779`).

## Context & Goal

`filterData` groups Prowlarr rows in a plain object, `const grouped: GroupedItems = {}`
(`clients/indexer/client.ts:64`, `type GroupedItems = Record<string, Item[]>` at `:44`), keyed by
`item.infoHash?.toLowerCase() || extractInfoHashFromGuid(item.guid) || deriveGroupKey(item)`
(`:68`). The value comes from a tracker, through Prowlarr. A row whose `infoHash` is the string
`__proto__` makes `grouped[hash]` resolve to `Object.prototype` (truthy), so no array is created
(`:72-73`) and `grouped[hash].push(item)` (`:75`) throws a `TypeError`. A non-string `infoHash`
also throws on `toLowerCase`.

`ProwlarrClient.search` (`:177`) has no catch around `filterData`, and `IndexerService.search`
writes the cache only after a success (`indexer.service.ts:190`), so the failure is neither
contained nor cached: every `searchTorrents` and every acquisition sweep that returns that row
fails, again on each attempt. A hostile public tracker could deny search for the queries it matches.
Whether Prowlarr forwards such a value unchanged is not visible in this repository.

The goal is that one malformed row can only lose that row, never the whole search.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (No prototype key)**: Grouping must use a `Map` (or `Object.create(null)`), so no
      upstream string can collide with an `Object.prototype` member.
- [ ] **REQ-2 (Hash format)**: An `infoHash` that is not a string, or not 40-character hex, is
      treated as absent and falls through to `extractInfoHashFromGuid`/`deriveGroupKey`. Same
      validator as spec 02's NFR-1.
- [ ] **REQ-3 (Row isolation)**: A row that still cannot be grouped is dropped with a log line;
      it never rejects the whole `filterData` call.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Result shape)**: Output for well-formed rows is unchanged (ids, ordering by size,
      seeder sums), so cached entries in Redis stay valid.

## GraphQL Contract Delta

None.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: Unit-calling `filterData` with a mocked Prowlarr row `{ infoHash: '__proto__' }`
      alongside a normal row currently rejects with a `TypeError` (reproduces the bug); after the fix
      it returns the normal row and the odd one under its derived key or dropped.
- [ ] **AC-2**: Rows with `infoHash` of `constructor`, `toString`, a number, an object, or an empty
      string do not throw.
- [ ] **AC-3**: A normal search result is byte-identical to the one before the change.
- [ ] **Deployment check**: the owner confirms in a test Prowlarr whether an item with an `infoHash`
      attribute of `__proto__` is emitted verbatim in `/api/v1/search` JSON.

## Out of Scope

- **Prowlarr-side sanitising** and the SSRF on the resolved hash (spec 05). The shared hash validator
  is the overlap with spec 02.

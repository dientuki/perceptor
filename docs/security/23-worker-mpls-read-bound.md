---
title: Bound the size of a Blu-ray playlist file the worker reads
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-22
status: Draft
services: [worker]
source_finding: worker/disc/scan-disc-unbounded-readfile-of-mpls
audit_verdict: needs_validation
priority: 23
---

# SPEC (draft): Bound the size of a Blu-ray playlist file the worker reads

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `7365e13`
> (source unchanged since `98f8779`).

## Context & Goal

`scanDisc` loads every downloaded `BDMV/PLAYLIST/*.mpls` with `readFile` and hands the buffer to
`parseMpls` (`services/worker/src/disc/scan-disc.ts:37`). `findDiscRoots` classifies a playlist by
directory and `.mpls` extension only (`disc/find-disc.ts:25`), and the guard before the read is just
`isDownloaded` (`scan-disc.ts:32`). `enumerateFolder` already stats each file's size
(`scan/scan-folder.ts:46`) but `scanDisc` never uses it.

A hostile release can ship a huge file named like a playlist beside any `.m2ts` clip. The worker
allocates a buffer of that size per playlist while scanning a film; node refuses above about 2 GiB
(caught by the surrounding `try/catch`), but anything below can pressure memory. The worker also
runs every encode and the compose files set no memory limit, so an OOM kill is host-dependent. The
victim must add the release and download the full bytes: a transient availability hit. A real
`.mpls` is a few KiB.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Size cap)**: `scanDisc` must not read a playlist whose inventoried `size` exceeds a
      named constant (proposed 1 MiB, orders of magnitude above any real `.mpls`); it is treated as
      unplayable, exactly like a playlist that fails to parse today.
- [ ] **REQ-2 (No new failure mode)**: An oversize playlist never throws out of `scanDisc`; the
      existing selection (`selectPlaylist`) and the `error.source.disc_playlist_ambiguous` path are
      unchanged. [NEEDS CLARIFICATION: log a warning with the path and size, as other worker
      guards do?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Single source of truth)**: The cap uses the `size` already in `InventoriedFile`; no
      second `stat`, so no stat/read race on a file that grows.
- [ ] **NFR-2 (Related, not covered)**: The same pattern exists for provider `.srt` content in
      `subtitles/subtitle-variant.ts:26` (`readFile` without a size check); see spec 24.

## GraphQL Contract Delta

None. No new key; an oversize playlist degrades to the existing unplayable handling.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduce first)**: In a worker container with a memory limit, a sparse
      `BDMV/PLAYLIST/00000.mpls` of about 1.5 GB plus `BDMV/STREAM/00000.m2ts`, run through
      `scanDisc`, shows peak RSS near the file size today; after the fix RSS stays flat.
- [ ] **AC-2**: A unit test with an inventoried `.mpls` whose `size` is above the cap does not call
      `readFile` and yields an unplayable candidate.
- [ ] **AC-3**: A real-sized playlist (a few KiB) still parses and a normal disc still selects its
      main playlist (spec 100 fixtures).

## Out of Scope

- A worker memory limit in compose (owned by infra).
- Confinement of scan paths to the source folder (spec 03; the worker side is still unchecked).

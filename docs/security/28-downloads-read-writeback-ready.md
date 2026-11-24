---
title: Stop the live torrent read-back writing READY without enqueueing the scan
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/downloads/live-read-writeback-promotes-ready-bypassing-completion-hook
audit_verdict: confirmed
severity: medium
priority: 28
---

# SPEC (draft): Stop the live torrent read-back writing READY without enqueueing the scan

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> **confirmed** with overall severity medium: a fresh verifier reproduced it in a sandboxed local
> harness (real service code, in-memory fakes for Prisma/Redis/fetch). Line numbers refer to commit
> `2a3976a`.
> Evidence: `agents/v-api-downloads-live-read-writeback-promotes-ready-bypassing-r2/artifacts/evidence/`
> (`readback.ts`, `readback.log`) in the run-3 audit directory.
> Touches the same handler as spec 29 (`torrentCompleted` trusting its caller); the two fixes are
> independent but should land together.

## Context & Goal

Since `089` every live torrent read writes the client's state back onto the `MediaSource` rows it
fetched. `liveInfoByHash` (`downloads.service.ts:211`, called by `downloads` at `:528`,
`movieDownloads` and `showDownloads`) and `liveInfoForHash` (`:1245`) both call
`writeBackLiveStates` (`:225`). `mapTorrentState` returns `READY` whenever `completion_on` is set,
whatever the raw state (`clients/torrent/client.ts:49`). For a non-`ERROR` source whose stored status
differs, `writeBackLiveStates` calls `writeStatusIfNonTerminal(source.id, live.state)` (`:255`), whose
guard set `NON_TERMINAL_STATUSES` (`:628`) is `PENDING`/`QUEUED`/`DOWNLOADING`/`PAUSED`, so `READY` is
written directly.

`READY` is otherwise written only by `handleTorrentCompleted` (`:1403`), after `resolveRace` (`:1398`)
and the `downloadPath` check, and immediately followed by the status recompute, `addSourceReady`
(`:1416`) and the torrent stop. Its idempotency guard (`:1361`) treats a `READY`/`SCANNED` source as
already processed. So if any read lands between qBittorrent setting `completion_on` and the AutoRun
hook reaching `torrentCompleted`, the hook answers `ya procesado` and nothing ever enqueues the scan.
`resumeScanStage` (`:820`) only restarts a source from `ERROR`. The title stays downloaded and
unscanned until the source is deleted and re-added. The `ERROR`-recovery branch (`:242`) already
routes a `READY` reading through `handleTorrentCompleted`; the normal branch does not.

`downloads` is unscoped (`downloads.resolver.ts:43`) and `web` loads it, so any signed-in user, owning
nothing, triggers the write for every user's torrents. A completed but paused race loser is promoted
the same way, and `isRaceWinner` returns true for any `READY` source
(`pipeline-status/pipeline-status.ts:355`).

The goal is that only the completion path moves a source to `READY`, always together with its scan.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (No bare READY from a read)**: `writeBackLiveStates` must never write `READY` through
      `writeStatusIfNonTerminal`.
- [ ] **REQ-2 (Completion routed)**: When the live state is `READY` for a non-terminal source, the
      read-back either leaves the row untouched (the hook owns the transition) or calls
      `handleTorrentCompleted(infoHash)` as the `ERROR`-recovery branch does. [NEEDS CLARIFICATION:
      routing a read into the completion handler makes every `downloads` read able to start a scan and
      pause siblings; leaving it to the hook means a lost hook still leaves the source unscanned.
      Which one is intended? A third option is a scheduled reconciliation.]
- [ ] **REQ-3 (Paused losers)**: A source `resolveRace` paused must not become `READY` (a race winner)
      through the read-back.
- [ ] **REQ-4 (Other states unchanged)**: `QUEUED`/`DOWNLOADING`/`PAUSED`/`ERROR` mirroring from `089`
      REQ-7 keeps working.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No new client calls)**: The fix adds no torrent client call to a read (`089` NFR-1).
- [ ] **NFR-2 (Existing wedged rows)**: [NEEDS CLARIFICATION: should a boot or scheduled pass
      re-enqueue a `READY` source with no queued scan and no `ProcessJob`, to repair rows already
      wedged?]

## GraphQL Contract Delta

None. A torrent that has finished but not yet been processed keeps reading its previous status until
the hook arrives (under REQ-2's first option).

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: Replay the verifier's harness: one `DOWNLOADING` source, fake client
      reporting `stalledUP` with `completion_on` set. Call `downloads` as a user owning no title, then
      `handleTorrentCompleted`. Today the read sets `READY`, the hook returns `ya procesado` and
      `addSourceReady` is never called. After the fix `addSourceReady` is called exactly once.
- [ ] **AC-2**: Control: `handleTorrentCompleted` alone still enqueues the scan and stops the torrent.
- [ ] **AC-3**: A `PAUSED` race loser whose torrent reports complete is not read back as `READY`.
- [ ] **AC-4**: A `DOWNLOADING` source whose client reports `queuedDL` or `stoppedDL` is still mirrored
      as `QUEUED`/`PAUSED`.

## Out of Scope

- **Who may call `torrentCompleted`, and checking completion with the client** — spec 29.
- **Scoping the `downloads` query to owned titles** — deliberate since `064`.

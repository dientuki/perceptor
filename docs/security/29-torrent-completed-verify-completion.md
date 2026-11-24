---
title: Accept torrentCompleted only from the service and only for a finished torrent
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/downloads/torrent-completed-trusts-caller-no-completion-check
audit_verdict: confirmed
severity: medium
priority: 29
---

# SPEC (draft): Accept torrentCompleted only from the service and only for a finished torrent

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> **confirmed** with overall severity medium: a fresh verifier reproduced it in a sandboxed local
> harness (real service code, in-memory fakes for Prisma/Redis/fetch). Line numbers refer to commit
> `2a3976a`.
> Evidence: `agents/v-api-downloads-torrent-completed-trusts-caller-no-completio/artifacts/evidence/`
> (`premature-complete.ts`, `premature-complete.log`) in the run-3 audit directory.
> Shares its root cause with spec 01, which already lists `torrentCompleted` among the nine
> service-only operations a user session can reach; this spec adds the completion check spec 01 does
> not cover. Touches the same handler as spec 28.

## Context & Goal

`torrentCompleted` (`downloads.resolver.ts:14-21`) is the qBittorrent AutoRun callback. It carries
`@AllowService()` and no principal check. `JwtAuthGuard` rejects a service principal on an operation
without the decorator (`auth/guards/jwt-auth.guard.ts:51`) but never rejects a user principal on one
with it, and the resolver does not call `assertService` (used elsewhere, e.g.
`subtitle-search/subtitle-search.resolver.ts:130`). Any signed-in user can call it.

`handleTorrentCompleted` (`downloads.service.ts:1350`) never asks the torrent client whether the
torrent finished. It gates only on stored status (`READY`/`SCANNED` at `:1361`, `ERROR` at `:1371`,
missing `downloadPath` at `:1382`), then runs `resolveRace` (`:1398`), which stops each in-flight
sibling and sets it `PAUSED` (`:1342`), writes the source `READY` (`:1403`), enqueues its scan
(`:1416`) and stops the torrent (`:1420`).

The selector is not secret: the global `downloads` query returns `infoHash` for every source of every
user (`downloads.service.ts:446`, field `entities/download.entity.ts:12`). A user owning nothing can
therefore take the hash of another user's `DOWNLOADING` source and mark it finished: its siblings are
paused, its partial files are scanned and encoded, and the torrent is stopped. The verifier's harness
shows source 1 `DOWNLOADING` to `READY`, sibling 2 stopped and `PAUSED`, `addSourceReady` enqueued,
torrent stopped, and `qbittorrent.info` never called.

The goal is that completion is reported only by the hook and believed only when the client agrees.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Service principal only)**: `torrentCompleted` refuses a user principal with
      `AUTH_UNAUTHENTICATED`. Satisfied by spec 01 REQ-1 if it lands first; otherwise an in-body
      `assertService(principal)`.
- [ ] **REQ-2 (Client confirms completion)**: Before any write, `handleTorrentCompleted` reads the
      torrent from the client and proceeds only if it reports completion (`completion_on` set, i.e.
      `mapTorrentState` returns `READY`). Otherwise it returns an "ignored" outcome and writes nothing.
- [ ] **REQ-3 (Client unreachable)**: [NEEDS CLARIFICATION: when the client cannot be read, does the
      handler refuse (the hook's call is lost, see spec 28 REQ-2 on recovery) or fall back to today's
      behaviour for a service caller?]
- [ ] **REQ-4 (Hash exposure)**: [NEEDS CLARIFICATION: should `Download.infoHash` be null on a row the
      caller does not own (`Download.owned = false`)? `web` uses it for magnet links on owned rows;
      REQ-1 and REQ-2 already remove the abuse, so this is defence in depth only.]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Hook unchanged)**: The AutoRun hook keeps calling with `SERVICE_TOKEN` and the same
      argument; no change in `services/torrent`.
- [ ] **NFR-2 (One extra client call)**: REQ-2 adds at most one client read per completion, filtered
      to the hash.
- [ ] **NFR-3 (Internal callers)**: The `ERROR`-recovery path in `writeBackLiveStates` (`:244`) calls
      the handler after already reading the client; it must keep working without a redundant read.

## GraphQL Contract Delta

None in shape. A user session calling `torrentCompleted` gets `AUTH_UNAUTHENTICATED`; `web` never
calls it.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: Replay the verifier's harness: a `DOWNLOADING` source with a
      sibling, fake client reporting the torrent unfinished. Today `handleTorrentCompleted` returns
      `encolado`, the sibling is `PAUSED` and `addSourceReady` runs. After the fix nothing is written,
      no torrent is stopped and nothing is enqueued.
- [ ] **AC-2**: `torrentCompleted` with a user JWT fails `AUTH_UNAUTHENTICATED` before the service is
      called.
- [ ] **AC-3**: With `SERVICE_TOKEN` and a client reporting completion, behaviour is as today (scan
      enqueued once, siblings paused, torrent stopped).
- [ ] **AC-4**: A full pipeline run (torrent, hook, scan, encode, library) still completes.

## Out of Scope

- **The read-back writing `READY` on its own** — spec 28.
- **The other eight service-only operations** — spec 01.
- **Validating `infoHash` format** — spec 02.

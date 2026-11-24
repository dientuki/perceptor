---
title: Keep films with no candidate from starving the acquire_movies run cap
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/scheduler/acquire-movies-run-cap-starved-by-unfindable-titles
audit_verdict: confirmed
severity: low
priority: 30
---

# SPEC (draft): Keep films with no candidate from starving the acquire_movies run cap

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> **confirmed** with overall severity low: a fresh verifier reproduced it in a sandboxed local harness
> (real service code, in-memory fakes for Prisma/Redis/fetch). Line numbers refer to commit `2a3976a`.
> Evidence: `agents/v-api-scheduler-acquire-movies-run-cap-starved-by-unfindable/artifacts/evidence/`
> (`starve.ts`, `starve.log`) in the run-3 audit directory.

## Context & Goal

The opt-in `acquire_movies` sweep (`076`, armed by `SchedulerService.arm`,
`scheduler/scheduler.service.ts:126`) loads every film with an opted-in owner (`109` REQ-15) and a
typed release date (`scheduler/tasks/acquire-movies.task.ts:32`), keeps those deriving `MISSING`
(`:45`), resolves each one's open window (`:68`), then sorts by `openedAt` ascending and keeps the
first `MAX_MOVIES_PER_RUN = 20` (`:11`, `:87-89`). `openedAt` is the release date plus a constant
offset (`scheduler/tasks/acquisition-window.ts:80`), so older films always sort first.

A film with no `candidateRank === 1` release only increments `skipped` (`:105-107`); a film whose
attach throws only increments `failed` (`:123-127`). Nothing is persisted, so on the next run the same
films head the list again. `setAutoAcquireFor` (`movies/movies.service.ts:324`) lets any owner opt in
any number of owned films. One user with 20 or more old films that no indexer can find therefore
occupies every slot of every run, and no other user's opted-in film is ever searched. The verifier's
harness (25 old unfindable films for user A, one newer findable film for user B) shows three runs each
searching 20 films, B's never among them, nothing attached. Manual search and download are
unaffected. This also happens with no malice, from a large watchlist of obscure titles.

The goal is that a film that keeps finding nothing cannot hold a slot forever, and one user's titles
cannot hold every slot.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Rotation)**: A film the sweep searched without attaching must sort behind films not yet
      tried in the next runs, so every eligible film is eventually searched. [NEEDS CLARIFICATION:
      persisted last-attempt timestamp with ordering by it, or an exponential backoff that skips a
      film for N runs?]
- [ ] **REQ-2 (Per-owner fairness)**: [NEEDS CLARIFICATION: is REQ-1 enough, or should the 20 slots
      also be shared round-robin across owners, so one user with many recently opened films cannot
      delay another user's single film by days?]
- [ ] **REQ-3 (Failures too)**: A film whose attempt threw (`failed`) rotates the same way as one that
      was skipped.
- [ ] **REQ-4 (Reset on progress)**: A film that is attached, or whose owners change its windows,
      loses any backoff state.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (External call budget)**: The cap stays at 20 indexer searches per run; the fix changes
      which films are searched, not how many.
- [ ] **NFR-2 (Fresh status)**: The sweep keeps deriving status from live rows (`089`'s deliberate
      exception); no status column is trusted.

## GraphQL Contract Delta

None.

## Data Model Changes

REQ-1 likely needs a per-film attempt marker. [NEEDS CLARIFICATION: a nullable
`Movie.autoAcquireAttemptedAt DateTime` (one migration), or a Redis key with an expiry, which needs no
migration but is lost on `FLUSHALL`?]

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: Replay the verifier's harness against the real `AcquireMoviesTask`:
      25 films for user A with `digitalReleaseDate` 2020-01-01 and no indexer results, one film for
      user B with `digitalReleaseDate` 2024-01-01 and a rank-1 candidate. Today three runs never search
      B's film. After the fix B's film is searched and attached within two runs.
- [ ] **AC-2**: No run performs more than 20 indexer searches.
- [ ] **AC-3**: With fewer than 20 eligible films, every one is searched every run, as today.
- [ ] **AC-4**: A film that becomes findable after being skipped is attached once its turn comes.

## Out of Scope

- **`acquire_episodes`**: it has the same shape (`MAX_EPISODES_PER_RUN = 20`,
  `scheduler/tasks/acquire-episodes.task.ts:12,69`) but was not part of this finding; whether it is
  affected is for `/specify` to decide.
- **Capping how many films a user may opt in** — not proposed.

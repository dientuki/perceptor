---
title: Stop the acquisition sweeps acting for a disabled user
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/users/disable-user-keeps-auto-acquire-sweeps-running
audit_verdict: needs_validation
priority: 53
---

# SPEC (draft): Stop the acquisition sweeps acting for a disabled user

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding
> is `needs_validation`: whether disabling a user is meant to stop background acquisition is a
> product decision spec 004 does not make, and the sweeps were not executed. Line numbers refer to
> commit `2a3976a`.
> Same family as spec 06 (remove revokes sessions) and spec 09 (login racing a disable): what
> "disabled" has to stop.

## Context & Goal

`UsersService.update` (`users/users.service.ts:59`) handles a disable by revoking the user's
sessions (`:113-115`) and nothing else. Spec 004 promises exactly that: no new login (REQ-2) and
every live session ended (REQ-3, NFR-3) (`docs/spec/features/004-user-disable/spec.md:44-51`).

The `109` 0.3.0 per-owner `autoAcquire` switch keeps acting on that user's behalf afterwards. Every
query that decides whether, and for whom, a sweep acquires filters on `autoAcquire: true` only, with
no `user.isEnabled` predicate:

- `AcquireMoviesTask.run` selection (`scheduler/tasks/acquire-movies.task.ts:35`);
- `AcquireEpisodesTask.run` selection (`scheduler/tasks/acquire-episodes.task.ts:52`) and its owner
  lookup (`:82`);
- `RankingContextService.forMovieOwners` (`indexer/ranking-context.service.ts:162`), which also
  unions the owners' acquisition windows, and `forShowOwners` (`:115`).

So a disabled owner's opted-in titles are still searched on Prowlarr, attached and downloaded, and
their preferences still shape ranking for other owners of the same title. The scheduled list import
already takes the opposite stance: `TmdbListsService.importAll` filters `user: { isEnabled: true }`
(`tmdb-lists/tmdb-lists.service.ts:130`). Impact is bounded: the account was trusted and an
administrator disabled it; nothing new is exposed to that user, whose sessions are gone.

The goal is one background policy for a disabled user, the same in every sweep.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Policy)**: [NEEDS CLARIFICATION: does disabling a user stop background work done on
      their behalf? This spec assumes yes, matching `importAll`.]
- [ ] **REQ-2 (Selection)**: The `acquire_movies` and `acquire_episodes` selection queries count only
      owners with `autoAcquire: true` **and** `user.isEnabled: true`, so a title whose only opted-in
      owners are disabled is not selected and never consumes a per-run slot.
- [ ] **REQ-3 (Owner context)**: `forMovieOwners`, `forShowOwners` and the episode owner lookup
      (`acquire-episodes.task.ts:82`) apply the same predicate, so a disabled owner's windows,
      languages and groups no longer shape ranking.
- [ ] **REQ-4 (No data change)**: Disabling a user does not rewrite their `autoAcquire` flags;
      re-enabling them resumes the sweeps for their titles with no further action.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Work in flight)**: Downloads and encodes already started are not cancelled by a
      disable; only new acquisitions stop. [NEEDS CLARIFICATION: confirm.]
- [ ] **NFR-2 (One predicate)**: The "active opted-in owner" filter lives in one shared helper so the
      four call sites cannot drift again.

## GraphQL Contract Delta

None.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduce first)**: With a fake Prisma, seed a disabled user holding an aired film with
      `autoAcquire` on and a fake indexer returning a candidate; run `AcquireMoviesTask` and observe
      that today the film is attached. In a deployment, disable a test account holding an
      `autoAcquire` title and check whether it gains a new source after the daily run.
- [ ] **AC-2**: After REQ-2 the same run attaches nothing and does not count the film against the
      per-run limit; the same holds for an episode under `acquire_episodes`.
- [ ] **AC-3**: A title owned by one enabled and one disabled opted-in owner is still acquired, with
      a ranking context built from the enabled owner only.
- [ ] **AC-4**: Re-enabling the user makes the next run select the title again.

## Out of Scope

- **Session revocation on remove, password change and the login/disable race** — specs 06, 07, 09.
- **Manual searches** — a disabled user has no session to start one.
- **TMDB list import** — already filtered; its error isolation is spec 52.

---
title: A login racing a disable cannot leave a live session
spec_version: 0.1.0
author: security-audit run-1 (draft)
created_at: 2026-11-20
last_updated: 2026-11-20
status: Draft
services: [api]
source_finding: api/auth/login-disable-race-session-survives
audit_verdict: needs_validation
priority: 9
---

# SPEC (draft): A login racing a disable cannot leave a live session

> Draft written from a static security audit (`security-audit` skill, run-1, profile `quick`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `98f8779`.
> Closed for free by spec 06 REQ-2 (request-time user check); kept separate so its AC is tested.

## Context & Goal

`AuthService.login` reads the user (`auth.service.ts:20`), spends a bcrypt compare (`:28`), checks the
already-read `isEnabled` (`:46`) and only then writes `session:<jti>` and adds the jti to
`user-sessions:<id>` (`session.service.ts:16-19`). If an admin's disable commits and
`revokeAllForUser` (`smembers` snapshot, then `del`, `session.service.ts:48`) runs inside that
window, the new jti is not in the snapshot and survives. `JwtStrategy.validate` never re-reads
`isEnabled`, so the disabled user keeps a session for up to 12 h / 30 d. A user expecting to be
disabled can widen the odds by looping logins; nothing tells the admin to disable again.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Disabled means out)**: Once a disable has committed, no request from that user is
      served, whatever the order of a concurrent login.
- [ ] **REQ-2 (Login re-check)**: [NEEDS CLARIFICATION: is the request-time check of spec 06 enough,
      or should `login` also re-read the user after creating the session and revoke it if disabled,
      so a stale session key is not even left in Redis?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No lock on login)**: The fix must not serialize logins of different users.

## GraphQL Contract Delta

None.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: With `bcrypt.compare` stubbed behind a latch: start `login(U)`, run
      `UsersService.update(U, { isEnabled: false })` to completion, release the latch; the returned
      token is refused on its first request.
- [ ] **AC-2**: Normal login of an enabled user is unaffected.

## Out of Scope

- **Rate limiting login attempts.** Not part of this finding.

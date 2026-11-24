---
title: Removing a user ends their sessions
spec_version: 0.1.0
author: security-audit run-1 (draft)
created_at: 2026-11-20
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/users/remove-user-keeps-sessions-live
audit_verdict: confirmed
severity: low
priority: 6
---

# SPEC (draft): Removing a user ends their sessions

> Draft written from a static security audit (`security-audit` skill, run-1, profile `quick`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `98f8779`.
> Shares a fix with specs 07 and 09 (`JwtStrategy.validate` re-checking the user); implement together.
>
> **Run-3 update (2026-11-23):** now **confirmed**, overall severity low (likelihood low, impact low). A fresh verifier reproduced it in a sandboxed local harness (real service code, in-memory fakes); evidence in `~/security-audit-skill/perceptor/run-3/agents/v-api-users-remove-user-keeps-sessions-live/artifacts/evidence/`. The final record is `api/users/remove-user-keeps-sessions-live` in run-3's `findings.json`.

## Context & Goal

`removeUser` (`users.resolver.ts:44`) calls `UsersService.remove` (`users.service.ts:120-138`), which
deletes the `User` row without `SessionService.revokeAllForUser` — the disable path in `update()`
does call it (`:113-114`). `JwtStrategy.validate` (`auth/strategies/jwt.strategy.ts:25,40`) never
reads the user row; it only checks that `session:<jti>` exists in Redis. A deleted user's token
keeps authenticating until the session TTL ends (`SESSION_TTL` 12 h, `REMEMBER_ME_TTL` 30 d,
`auth.constants.ts:6`), and can still call operations that need no row of its own, such as the
installation-wide `downloads` query (`downloads.resolver.ts:43`).

The constitution/`CLAUDE.md` promise for disabling ("revokes live sessions immediately") should hold
for deleting too.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Revoke on delete)**: Deleting a user must revoke every session of that user at once.
- [ ] **REQ-2 (Request-time check)**: A user principal whose row no longer exists, or is disabled,
      must be refused on every request, independent of the session registry.
- [ ] **REQ-3 (Error)**: The refusal is the existing session-expired error, so `web` sends the user to
      the login page as it already does.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Cost)**: REQ-2 adds at most one indexed read per request, or a short cache.
      [NEEDS CLARIFICATION: plain DB read per request vs a Redis-cached user state invalidated by
      update/remove? `deployment-scale` says ~5 users, so a DB read is acceptable.]
- [ ] **NFR-2 (Service principal)**: `SERVICE_TOKEN` is unaffected.

## GraphQL Contract Delta

None — no new error; `error.auth.session_expired` is reused.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: Given user U with a live session, when an admin removes U, then
      `SessionService.exists(jti)` is false for every U session.
- [ ] **AC-2**: Given a session key that survives (seeded in Redis) for a deleted user, a `downloads`
      query with that token fails with `error.auth.session_expired`.
- [ ] **AC-3**: The admin performing the delete keeps their own session.

## Out of Scope

- **Short-lived JWTs / refresh tokens.** A redesign of session lifetime is not needed to close this.

---
title: Changing a password ends other sessions
spec_version: 0.1.0
author: security-audit run-1 (draft)
created_at: 2026-11-20
last_updated: 2026-11-20
status: Draft
services: [api]
source_finding: api/users/password-change-keeps-sessions-live
audit_verdict: needs_validation
priority: 7
---

# SPEC (draft): Changing a password ends other sessions

> Draft written from a static security audit (`security-audit` skill, run-1, profile `quick`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `98f8779`.
> Related to specs 06 and 09.

## Context & Goal

No password write revokes existing sessions: the self-service `updateProfile`
(`profile.resolver.ts:25` → `users.service.ts:167-172`), the admin `updateUser`
(`users.service.ts:98`, revocation only when `isDisabling`, `:113`) and the recovery script
`scripts/reset-password.ts:97` all rewrite only the bcrypt hash. `revokeAllForUser`
(`session.service.ts:46`) has a single caller, the disable branch. Since `JwtStrategy.validate`
accepts any token whose `session:<jti>` exists, whoever already holds a stolen `auth_token` keeps
access after the victim or an admin changes the password — up to 30 days with remember-me. That
includes the admin account, whose documented recovery path is exactly `bin/reset-password`.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Self change)**: When a user changes their own password, every other session of that
      user must be revoked; the session that made the change stays valid.
- [ ] **REQ-2 (Admin change)**: When an admin sets another user's password, every session of that
      user must be revoked.
- [ ] **REQ-3 (Recovery script)**: `reset-password` must revoke every session of the user it resets.
      It also rewrites the qBittorrent and Prowlarr logins (`061`); those are out of this spec.
- [ ] **REQ-4 (Only on real change)**: [NEEDS CLARIFICATION: revoke when the password field is sent
      at all, or only when the new hash differs from the old one?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Script reaches Redis)**: The script runs inside the `api` container
      (`docker compose exec api node dist/scripts/reset-password.js`) and must use the same Redis
      connection settings as the api; a Redis failure is reported, not swallowed.

## GraphQL Contract Delta

None. `web` already handles `error.auth.session_expired` on the other devices.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: User U with sessions A and B changes password from session A; B's next request fails
      with `error.auth.session_expired`, A keeps working.
- [ ] **AC-2**: An admin sets U's password; every U session fails on its next request.
- [ ] **AC-3**: `bin/reset-password <admin>` leaves no `session:*` key for that admin in Redis.
- [ ] **AC-4**: Changing only the display name revokes nothing.

## Out of Scope

- **Notifying the user by email** of a password change — Perceptor sends no mail.

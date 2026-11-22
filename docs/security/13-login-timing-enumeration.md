---
title: Equalise login timing for unknown usernames
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-22
status: Draft
services: [api]
source_finding: api/auth/login-username-enumeration-timing
audit_verdict: needs_validation
priority: 13
---

# SPEC (draft): Equalise login timing for unknown usernames

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `7365e13`
> (source unchanged since `98f8779`). Low impact; shares the login path with spec 12.

## Context & Goal

`AuthService.validateUser` returns `null` right after the user lookup when the username is not found
(`auth.service.ts:24`) and only runs `bcrypt.compare` when the row exists (`:28`). `login` (`:36`)
raises the same `AUTH_INVALID_CREDENTIALS` key either way, so the only difference an anonymous
caller sees is response time (a bcrypt compare versus none). The mutation is public
(`auth.resolver.ts:66`) and has no throttle (spec 12), so usernames, including the canonical admin
name, can be probed before guessing passwords.

Impact is low: Perceptor is self-hosted, has no public registration and usernames are not
credentials. The real timing gap over a network is unmeasured. This is the smallest fix of the
login-hardening set.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Dummy comparison)**: When the username is not found, `validateUser` must run a
      `bcrypt.compare` against a fixed dummy hash of the same cost as real hashes (computed once at
      module start with `bcrypt.hash(..., 10)`, matching `users.service.ts`), discard the result and
      return `null`.
- [ ] **REQ-2 (Same shape)**: The unknown-user and wrong-password branches must raise the identical
      error and perform the same amount of work before it.
- [ ] **REQ-3 (Disabled account)**: [NEEDS CLARIFICATION: `login` reveals `account_disabled` only
      after a correct password (`:41`), so it is not an oracle without the password; confirm that
      stays as is.]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Cost parity)**: If the stored hash cost ever changes, the dummy hash follows the same
      constant so the two branches stay equal.

## GraphQL Contract Delta

None.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: Against an isolated api with one dummy user, the median `login` time for an unknown
      username is clearly lower than for the known one with a wrong password (reproduces the bug);
      after the fix the two distributions are indistinguishable at the measurement noise.
- [ ] **AC-2**: Both branches still answer `error.auth.invalid_credentials`.
- [ ] **AC-3**: A correct login, remember-me and the disabled-account refusal still behave as before.

## Out of Scope

- **Throttling and alias limits**: spec 12.
- **Timing of other endpoints** (e.g. `/uploads`, `/ca.crt`).

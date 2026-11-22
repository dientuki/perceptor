---
title: Require the current password to change a password
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-22
status: Draft
services: [api, web]
source_finding: api/users/updateProfile-password-change-without-current-password
audit_verdict: needs_validation
priority: 20
---

# SPEC (draft): Require the current password to change a password

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `7365e13`
> (source unchanged since `98f8779`). Complements spec 07 (revocation); not dependent on it.

## Context & Goal

`updateProfile` (`profile.resolver.ts:25`) only requires a user principal and passes the input to
`UsersService.updateProfile`, which hashes `input.password` and writes it to the caller's row
(`users.service.ts:168`) without checking the existing hash. `UpdateProfileInput` has an optional
`password` (`MinLength(6)`) and no current-password field (`dto/update-profile.input.ts:26`). A
short-lived session compromise (stolen `auth_token`, unattended browser) therefore becomes
persistent account takeover that also locks the owner out. This is a missing re-authentication
control (CWE-620); it needs a prior session compromise. Spec 07 (revoking other sessions on a
change) limits the attacker's lingering access but does not stop this takeover, so both are needed.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Current password required)**: When `updateProfile` carries a new `password`, it must
      also carry `currentPassword`, verified with `bcrypt.compare` against the caller's stored hash
      before anything is written. A wrong or missing value refuses the whole mutation (no partial
      name/username update).
- [ ] **REQ-2 (Name-only edits unchanged)**: An edit that sends no `password` needs no
      `currentPassword`.
- [ ] **REQ-3 (Keyed error)**: A wrong current password raises a distinct keyed error
      ([NEEDS CLARIFICATION: `error.user.current_password_invalid`?], 401/400) and counts as a failed
      attempt for spec 12's throttle so the check is not a password oracle for a stolen session.
- [ ] **REQ-4 (Admin reset)**: `updateUser` by an admin for another user keeps working without the
      target's current password. [NEEDS CLARIFICATION: should an admin changing their own password
      through `updateUser` also be asked for it?]
- [ ] **REQ-5 (`web`)**: The profile form adds a "current password" field, shown and required only
      when the new password field is filled.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Contract first)**: The `UpdateProfileInput` change lands in
      `docs/spec/graphql-contract.md` before either service (Article VIII). `currentPassword` is
      optional in the schema, so an old `web` talking to a new api fails only when it sets a
      password.

## GraphQL Contract Delta

`UpdateProfileInput` gains `currentPassword: String` (nullable). New refusal:

| Condition | GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `password` set and `currentPassword` missing or wrong | `UnauthorizedException`, key [NEEDS CLARIFICATION: `error.user.current_password_invalid`] | "The current password is not correct" |

`web`'s `messages/{en,es}.json` get the new key (Spanish keeps the Rioplatense register).

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: In an isolated instance, `updateProfile` with only a new `password` and a valid
      session currently succeeds and the old password then fails to log in (reproduces the bug);
      after the fix it is refused and the old password still works.
- [ ] **AC-2**: `updateProfile` with the correct `currentPassword` and a new `password` succeeds;
      the new password logs in.
- [ ] **AC-3**: A wrong `currentPassword` changes neither the password nor the name/username sent in
      the same call.
- [ ] **AC-4**: A name-only edit still succeeds without `currentPassword`.
- [ ] **AC-5**: Admin `updateUser` setting another user's password still works.

## Out of Scope

- **Session revocation on password change**: spec 07.
- **Re-authentication for other sensitive actions** (username change, user creation).

---
title: Stop the boot seed promoting whoever holds the ADMIN_USER username
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/bootstrap/seed-upsert-by-env-username-promotes-user-to-admin-every-boot
audit_verdict: confirmed
severity: medium
priority: 27
---

# SPEC (draft): Stop the boot seed promoting whoever holds the ADMIN_USER username

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> **confirmed** with overall severity medium: a fresh verifier reproduced it in a sandboxed local
> harness (real service code, in-memory fakes for Prisma/Redis/fetch). Line numbers refer to commit
> `2a3976a`.
> Evidence: `agents/v-api-bootstrap-seed-upsert-by-env-username-promotes-user-to/artifacts/evidence/`
> (`repro.ts`, `repro.log`) in the run-3 audit directory.
> Related to spec 20 (`updateProfile` re-authentication); neither fix closes the other.

## Context & Goal

`bootstrap()` runs `seedProduction` on every boot unless `PERCEPTOR_AUTO_MIGRATE=false`
(`src/main.ts:28,34`), and `seedProduction` calls `seedUsers` (`src/database/seed/production-seed.ts:8`).
`seedUsers` upserts by `username = ADMIN_USER || 'admin'` (`prisma/seeds/users.ts:8,12`) and its
update branch is unconditionally `{ isAdmin: true }` (`:16`); the comment calls this repairing "an
install that lost its admin". The upsert does not check whether the row it matches is the admin it
created.

`updateProfile` (`src/users/profile.resolver.ts:25`) lets any signed-in user rename their own row;
`UsersService.updateProfile` (`src/users/users.service.ts:147`) refuses only a name another row
already holds (`:155`). There is no reserved name. `AdminGuard` reads `isAdmin` from the database on
every call (`src/auth/guards/admin.guard.ts:25`), so a flag written by the seed is effective at once.

Sequence: the original admin renames their account (or is deleted while another admin exists,
`users.service.ts:128`), a regular user renames themselves to the freed `ADMIN_USER` name, and the
next api boot makes them administrator with no admin action. The verifier's run of the real
`seedUsers` and `updateProfile` over a fake Prisma shows `boot2 [juan:true, admin:true]`, where
`admin` was the regular user `mallory`. If nobody claims the name, the seed instead creates a fresh
admin row under it (legacy `ADMIN_PASSWORD` if still in `.env`, else a random unusable password).

The goal is that the boot seed only ever creates an administrator when the install has none, and
never changes `isAdmin` on an existing row.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (No promotion of existing rows)**: The seed must never set `isAdmin` on a row that
      already exists. The upsert's update branch becomes a no-op (or the upsert is replaced by a
      conditional create).
- [ ] **REQ-2 (Repair only when no admin exists)**: The seed creates the `ADMIN_USER` admin only when
      no administrator exists. [NEEDS CLARIFICATION: "no admin" or "no *enabled* admin"? Spec 004
      REQ-5 already prevents disabling the last enabled admin, so the two only differ after a direct
      database edit.]
- [ ] **REQ-3 (Name already taken by a non-admin)**: When REQ-2 applies but `ADMIN_USER` is held by a
      non-admin row, the seed must not promote it. [NEEDS CLARIFICATION: log and skip (the operator
      recovers with `bin/reset-password` and a manual flag), or create the admin under a different
      name?]
- [ ] **REQ-4 (Optional reserved name)**: [NEEDS CLARIFICATION: should `updateProfile` and the admin
      `updateUser` refuse renaming a non-admin onto `ADMIN_USER`? `scripts/reset-password.ts:88` also
      treats that name as the shared qBittorrent/Prowlarr login, so a non-admin holding it is
      surprising there too.]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Existing installs)**: An install whose admin still holds `ADMIN_USER` boots exactly as
      today; an install with no admin row (fresh database) still gets one on first boot (`049`
      REQ-10).
- [ ] **NFR-2 (Idempotent)**: Running the seed any number of times leaves every existing row's
      `isAdmin` unchanged.

## GraphQL Contract Delta

None for REQ-1 to REQ-3. If REQ-4 is adopted, `updateProfile` reuses `USER_USERNAME_TAKEN` (or a new
key, decided at `/specify`) when the requested name is `ADMIN_USER`.

## Data Model Changes

None. [NEEDS CLARIFICATION: tracking the seeded admin by a stable id (a Setting holding its `User.id`)
is an alternative to REQ-2's "no admin exists" test; it needs no schema change but adds a Setting.]

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: Replay the verifier's harness against the real `seedUsers` and
      `UsersService.updateProfile`: seed; add regular user `mallory`; rename `admin` to `juan`; rename
      `mallory` to `admin`; seed again. Today `admin` (formerly `mallory`) reads `isAdmin: true`.
      After the fix it reads `false` and `juan` is still the only admin.
- [ ] **AC-2**: On an empty user table the seed creates `ADMIN_USER` with `isAdmin: true`.
- [ ] **AC-3**: With an admin `juan` and no row named `ADMIN_USER`, a second seed creates no new admin
      row.
- [ ] **AC-4**: With the admin still named `ADMIN_USER`, repeated seeds change nothing
      (`production-seed.spec.ts` extended).

## Out of Scope

- **Requiring the current password on `updateProfile`** — spec 20.
- **Session revocation on rename or role change** — specs 06 and 07.

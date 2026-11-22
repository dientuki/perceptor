---
title: Stop the source-build overlay exposing Redis and MariaDB to the network
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-22
status: Draft
services: [infra]
source_finding: infra/compose/build-overlay-publishes-redis-and-db-on-all-interfaces-with-default-creds
audit_verdict: needs_validation
priority: 21
---

# SPEC (draft): Stop the source-build overlay exposing Redis and MariaDB to the network

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `7365e13`
> (source unchanged since `98f8779`).
> Shares the Redis exposure with spec 26; this spec closes the host-facing half.

## Context & Goal

`docker-compose.build.yaml` publishes `db` as `"${DB_PORT}:3306"` (`:47`) and `redis` as
`"${REDIS_PORT}:${REDIS_PORT}"` (`:51`) with no host address, so Docker binds them on every host
interface. `bin/prod` and `bin/dev` always load that overlay (`bin/prod:24`). The base file starts
`redis-server` with no `requirepass` or ACL (`docker-compose.yaml:418`), and the checkout `.env`
comes from `.env.example`, which ships `DB_ROOT_PASSWORD=rootpassword` and `devuser`/`devpassword`
(`.env.example:121`) and which `bin/install` does not change.

Anything on the same LAN as a checkout-based stack could therefore read and write the BullMQ
queues and session-related keys in Redis, or log in to MariaDB as root. Mitigating: the base file
documents the republish as deliberate for Redis Insight/TablePlus in development, and the
end-user `install.sh` generates its own credentials and never loads the overlay.

Goal: keep the developer convenience, but make it loopback-only, and stop shipping a static root
password that a published port makes reachable.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Loopback bind)**: The `db` and `redis` host publications in the build overlay bind
      to `127.0.0.1` (for example `"127.0.0.1:${DB_PORT}:3306"`), so they are no longer reachable
      from another host.
- [ ] **REQ-2 (Opt-in wider bind)**: A developer who needs LAN access can still get it through an
      explicit variable [NEEDS CLARIFICATION: `DB_BIND_ADDRESS`/`REDIS_BIND_ADDRESS` defaulting to
      `127.0.0.1`, or drop the option?].
- [ ] **REQ-3 (No static root secret)**: `bin/install` generates `DB_ROOT_PASSWORD` (and
      [NEEDS CLARIFICATION: `DB_PASSWORD`?]) the way it already generates `JWT_SECRET`, instead of
      leaving `rootpassword` in the checkout `.env`.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Dev tooling)**: `bin/mysql`, `bin/dbinit`, `bin/dbreset` and a host Redis client on
      `127.0.0.1` keep working; the in-network `DATABASE_URL` is unaffected.
- [ ] **NFR-2 (Existing checkouts)**: An existing `.env` is never rewritten silently; REQ-3 only
      fills a missing or still-default value, as `bin/install` already does for the secrets.
- [ ] **NFR-3 (End-user install)**: `install.sh` and `docker-compose.yaml` are untouched in
      behaviour (no port published, Article-level NFR-8 of spec 049 holds).

## GraphQL Contract Delta

None. This is infra only.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: On a host started with `bin/prod` or `bin/dev` before the fix, `docker compose ps`
      shows `0.0.0.0:3306` and `0.0.0.0:6379`, and `redis-cli -h <lan-ip> ping` answers from
      another machine (reproduces the bug).
- [ ] **AC-2**: After the fix the same check shows `127.0.0.1:` bindings only and the LAN connection
      is refused.
- [ ] **AC-3**: `bin/mysql -e 'show tables'` and a host `redis-cli -h 127.0.0.1 ping` still work.
- [ ] **AC-4**: A fresh `bin/install` produces a `.env` whose `DB_ROOT_PASSWORD` is not `rootpassword`
      and the stack still boots and migrates.
- [ ] **AC-5**: `docker compose -f docker-compose.yaml config` (no overlay) shows no published port
      for `db` or `redis`.

## Out of Scope

- **Redis authentication** (`requirepass`/ACL) for in-network clients: see spec 26.
- Host firewall configuration and whether a given deployment kept the defaults: deployment facts the
  audit could not observe.

---
title: Create and rewrite .env with owner-only permissions
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [infra]
source_finding: infra/install/env-file-created-world-readable
audit_verdict: confirmed
severity: low
priority: 34
---

# SPEC (draft): Create and rewrite .env with owner-only permissions

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding
> is **confirmed** with overall severity low: a fresh verifier reproduced it in a sandboxed local
> harness (real service code, in-memory fakes for Prisma/Redis/fetch). Line numbers refer to commit
> `2a3976a`.
> Evidence: `run-3/agents/v-infra-install-env-file-created-world-readable/artifacts/evidence/out.txt`
> (harness `h.sh`: `set_env_var` copied verbatim from `install.sh`, run under `umask 022`).
> Same file and helpers as spec 35; implement together. Spec 54 covers the database dumps in
> `./backups`; spec 21 covers the build overlay publishing the database port.

## Context & Goal

`.env` holds every installation secret: `JWT_SECRET` (`install.sh:282`), `DB_PASSWORD` and
`DB_ROOT_PASSWORD` (`:332-333`), `INDEXER_API_KEY` (`:298`), `TORRENT_API_KEY` and the non-expiring
`SERVICE_TOKEN` (`:383`). Neither `install.sh` nor `bin/install` sets a `umask` or runs `chmod` on it.

- A fresh end-user install downloads `.env.example` straight into `.env` with `curl -o .env`
  (`install.sh:114`), under the process umask.
- Every edit goes through `set_env_var` (`install.sh:66-71`): `sed ... .env > .env.tmp && mv .env.tmp
  .env`. The temp file is a new file with the default mode, and `mv` replaces `.env` with it, so any
  `chmod 600` an operator applied by hand is lost on the next run. `ensure_env_var` (`:73-80`)
  calls it or appends with `>>`.
- `bin/install` creates the developer `.env` with `cp .env.example .env` (`bin/install:43`) and
  carries the same `set_env_var` (`bin/install:14`).

Under the common `umask 022` the result is mode `0644`; the verifier observed exactly `644` after
`set_env_var`. Any other local OS user who can traverse the install directory can read the file.
With `JWT_SECRET` they can sign a non-expiring `typ: service` token or a user token for any account;
the database credentials are additionally usable only where the db port is reachable (spec 21) or
from the Docker network.

The precondition is a multi-user host with a traversable install directory; typical self-hosted
installs are single-user. The goal is that `.env` is `0600`, owned by the installing user, after
every installer step.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Restrictive creation)**: `install.sh` and `bin/install` set `umask 077` before the
      first write of `.env` (the `curl -o .env` and the `cp`), so the file is born `0600`.
- [ ] **REQ-2 (Mode kept on rewrite)**: `set_env_var` keeps `0600` across rewrites: the temp file is
      created under the same umask, or `chmod 600 .env.tmp` runs before the `mv`.
- [ ] **REQ-3 (Repair existing installs)**: A re-run of `install.sh` (the documented update/repair
      path) runs `chmod 600 .env` once, so installs made before this change are fixed.
- [ ] **REQ-4 (Scope of umask)**: [NEEDS CLARIFICATION: `umask 077` for the whole script also
      affects `docker-compose.yaml` and any directory the script creates (for example a bind-mounted
      media folder another container user must read). Set it script-wide, or only around `.env`
      writes?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Containers unaffected)**: Docker Compose reads `.env` as the invoking user, so `0600`
      owned by that user does not break `docker compose` or the `bin/` wrappers. A user who runs
      Compose under `sudo` as root still reads it.
- [ ] **NFR-2 (Portable)**: The fix uses only POSIX `umask`/`chmod`, keeping the GNU/BSD portability
      that `set_env_var`'s comment cares about.

## GraphQL Contract Delta

None.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: Under `umask 022` in a scratch directory, create `.env`, define
      `set_env_var` exactly as `install.sh:66-71`, call `set_env_var JWT_SECRET deadbeef` and `stat`
      the file. Today the mode is `644`. After the fix it is `600`.
- [ ] **AC-2**: A fresh `install.sh` run (docker and curl faked as in the audit harnesses) leaves
      `.env` at `600`; so does a fresh `bin/install`.
- [ ] **AC-3**: An existing `.env` at `644` is `600` after a repair re-run of `install.sh`.
- [ ] **AC-4**: `docker compose config` and `bin/dev` still read the file as the installing user.

## Out of Scope

- **Shell-sourcing `.env` and the adopted indexer key** — spec 35.
- **Database dumps under `./backups`** — spec 54. **`./certs/ca.key`**, written by the `certs`
  container, was not examined by this finding.
- **The db/redis ports published by the build overlay** — spec 21.

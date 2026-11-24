---
title: Write database backup dumps readable by their owner only
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [infra]
source_finding: infra/compose/backup-dumps-world-readable-with-plaintext-settings-secrets
audit_verdict: needs_validation
priority: 54
---

# SPEC (draft): Write database backup dumps readable by their owner only

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding
> is `needs_validation`: source confirms no restrictive mode is set, but the effective file and
> directory modes and whether the host has other local users are host facts, not observable without
> Docker. Line numbers refer to commit `2a3976a`.

## Context & Goal

The one-shot `backup` service (`docker-compose.yaml:217`, `049` REQ-12) runs to completion before every `api`
start (`api` waits on it, `:167-168`). It uses the `mariadb` image with its default user (root), bind-mounts
`./backups` to `/backups` (`:227`), and runs a bash script (`set -euo pipefail`, `:239`) that writes
`mariadb-dump ... | gzip > "$dest"` (`:247`) and keeps the five newest dumps (`:250`). Nothing in
the script sets a `umask` or calls `chmod`; the only `umask 077`/`chmod 700/600` in the file belong to
the `certs` service (`:274`, `:356-361`). A missing host source directory is created by Docker as
root with mode 0755, so the dumps most likely land as root-owned 0644 files in a world-traversable
directory.

Each dump holds the whole database: user password hashes, sessions, and the `settings` table, whose
provider credentials are stored as plain values (`opensubtitles_password` and `subdivx_api_key` are
only hidden from the `settings` query, `settings/settings.resolver.ts:51`, not encrypted), plus the
media-server and indexer API keys and the TMDB key. Any other local account on the host, or anything
that can read the install directory's storage, can read all five copies.

The goal is that a dump is created, and stays, readable by its owner only.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Umask)**: The backup script sets `umask 077` before creating anything, so every dump
      is created mode 0600.
- [ ] **REQ-2 (Directory)**: The script sets `/backups` to mode 0700 on every run, so an existing
      install's 0755 directory is tightened on its next upgrade.
- [ ] **REQ-3 (Existing dumps)**: Dumps already present are set to 0600 on the same run, before
      rotation.
- [ ] **REQ-4 (Ownership)**: [NEEDS CLARIFICATION: keep root ownership (restoring needs `sudo` or a
      container), or `chown` to `${PUID}:${PGID}` as `certs` has those variables? `install.sh` tells
      the user `./backups` is one of the files that matter.]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Backup semantics unchanged)**: `pipefail`, the `ERR` trap that removes a partial dump,
      rotation to five, and the `service_completed_successfully` gate keep working exactly as now.
- [ ] **NFR-2 (Both installers)**: The change lives in `docker-compose.yaml` only, so `install.sh`
      users get it by pulling the new compose file; `bin/dev`/`bin/prod` get it unchanged.
- [ ] **NFR-3 (Docs)**: The restore instructions say who can read the dumps.

## GraphQL Contract Delta

None.

## Data Model Changes

None. Encrypting provider credentials at rest is out of scope.

## Acceptance Criteria

- [ ] **AC-1 (reproduce first)**: On a stock install, after one `api` start, run `ls -ln ./backups`
      and `stat -c %a ./backups ./backups/*.sql.gz`; expect 755 for the directory and 644 for dumps
      owned by uid 0. Confirm a credential row is present with
      `zcat ./backups/*.sql.gz | grep -c opensubtitles_password`, without copying the output anywhere.
- [ ] **AC-2**: After the fix a new dump is 0600 and the directory 0700.
- [ ] **AC-3**: An install upgraded from a 0755/0644 state has every dump at 0600 after the next run.
- [ ] **AC-4**: A dump that fails mid-way is still removed by the trap, and `api` still refuses to
      start after a failed backup.

## Out of Scope

- **Encrypting settings secrets at rest**, or excluding them from the dump.
- **Off-host backup storage** and its permissions.
- **Network exposure of MariaDB in the build overlay** — spec 21.

---
title: Validate the indexer key adopted from the volume and stop executing .env as shell code
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [infra]
source_finding: infra/install/env-sourced-by-shell-with-unvalidated-volume-apikey
audit_verdict: confirmed
severity: low
priority: 35
---

# SPEC (draft): Validate the indexer key adopted from the volume and stop executing .env as shell code

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding
> is **confirmed** with overall severity low: a fresh verifier reproduced it in a sandboxed local
> harness (real service code, in-memory fakes for Prisma/Redis/fetch). Line numbers refer to commit
> `2a3976a`.
> Evidence: `run-3/agents/v-infra-install-env-sourced-by-shell-with-unvalidated-volume/artifacts/evidence/repro.log`
> (unmodified `install.sh`; only `docker` and `curl` were faked, `fake-docker.sh`).
> Same file and helpers as spec 34; implement together.

## Context & Goal

When `INDEXER_API_KEY` is empty in `.env`, `install.sh` adopts the key of an existing Prowlarr
volume (`install.sh:285-303`): it runs `docker compose run ... indexer` with `sed` over
`/config/config.xml` (`:294-295`), keeps whatever sits between `<ApiKey>` and `</ApiKey>`, strips
only CR/LF (`tr -d '\r\n'`, `:295`) and writes it verbatim with `ensure_env_var INDEXER_API_KEY`
(`:298`). `env_var_is_empty` (`:84-86`) checks only emptiness; there is no format check.

The installer then sources `.env` as shell code: `set -a; . ./.env; set +a` (`install.sh:341`, and
`:293` on a later run). `$(...)`, backticks and `;` in a value execute on the host as the installing
user. The developer installer does the same adoption (`bin/install:125-129`) and sources at
`bin/install:148`; `bin/dev:18`, `bin/prod:17`, `bin/build:18` and `bin/stop:36` source the same file.

`config.xml` lives in the indexer's Docker volume, written by the Prowlarr container. A party who can
modify it (a compromised indexer container, or a tampered Prowlarr config migrated into the volume)
gets command execution on the host at the next installer run that adopts the key, and again at every
later sourcing, since the payload stays in `.env`. The verifier placed
`<ApiKey>abc123$(touch .../PWNED_CMDSUB);touch .../PWNED_SEMI</ApiKey>` in the faked volume: the
value landed in `.env` verbatim, `install.sh` exited 0, and both marker files were created.

Preconditions are prior write access to the volume plus an operator re-running the installer with an
empty `INDEXER_API_KEY`. The goal is that a volume-supplied value can never reach a shell parser
unvalidated, and that `.env` is treated as data.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Validate adopted key)**: Both installers accept the adopted value only if it matches
      a plain token pattern (proposed `^[A-Za-z0-9]{16,64}$`; Prowlarr keys are 32 hex characters).
      Anything else is ignored with a message, and a fresh key is generated with
      `openssl rand -hex 16`, as the no-volume branch already does.
      [NEEDS CLARIFICATION: a generated key no longer matches the volume, so the indexer's
      `10-prowlarr-apikey` init script rewrites `<ApiKey>` to it on next start. Is that the wanted
      outcome for a rejected value, or should the installer stop and ask?]
- [ ] **REQ-2 (Parse, do not source)**: The installers and the `bin/` wrappers read the variables
      they need from `.env` with a parser (`grep`/`cut`, as `install.sh` already does for
      `PERCEPTOR_TAG` at `:95`) instead of `. ./.env`.
      [NEEDS CLARIFICATION: which variables does each script actually need after `set -a`? If the
      full environment is required for `docker compose`, Compose already reads `.env` itself.]
- [ ] **REQ-3 (Values written safely)**: `set_env_var`/`ensure_env_var` refuse a value containing a
      newline, `|`, `$`, a backtick, `;` or a quote, since the `|`-delimited `sed` (`:70`) and any
      remaining shell consumer would misread it. All generated secrets are hex or alphanumeric, so
      no legitimate value is lost.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Existing installs)**: A re-run of `install.sh` checks an already-present
      `INDEXER_API_KEY` against REQ-1's pattern before any sourcing and refuses to continue (with
      instructions) if it fails, so an `.env` already carrying a payload is not executed again.
- [ ] **NFR-2 (Same behaviour on a clean volume)**: Adopting a real 32-hex Prowlarr key keeps working
      and does not invalidate an existing Prowlarr configuration (`bin/install:128`'s promise).

## GraphQL Contract Delta

None.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: In a sandbox directory with `.env` holding `PERCEPTOR_TAG` and an
      empty `INDEXER_API_KEY`, put the fake `docker` (whose `compose run` prints the payload
      `<ApiKey>abc123$(touch PWNED_CMDSUB);touch PWNED_SEMI</ApiKey>`) and `curl` first on `PATH` and
      run the unmodified `install.sh` with stdin from `/dev/null`. Today both marker files are
      created and `.env` holds the payload. After the fix neither marker exists and `.env` holds a
      32-hex key.
- [ ] **AC-2**: The same with `bin/install` and its `docker compose ... run`.
- [ ] **AC-3**: A volume holding a valid 32-hex key is adopted unchanged by both installers.
- [ ] **AC-4**: An `.env` that already contains `INDEXER_API_KEY=x$(touch PWNED)` is not executed by
      a re-run of `install.sh` or by `bin/dev`.

## Out of Scope

- **`.env` file mode** — spec 34.
- **Hardening the indexer container itself** against compromise.
- Docker Compose's own `.env` interpolation, which is not a shell and does not execute `$(...)`.

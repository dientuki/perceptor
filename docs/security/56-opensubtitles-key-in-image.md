---
title: Decide and document the exposure of the OpenSubtitles key in the public api image
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [infra, api]
source_finding: infra/release/opensubtitles-app-key-baked-into-public-image
audit_verdict: needs_validation
priority: 56
---

# SPEC (draft): Decide and document the exposure of the OpenSubtitles key in the public api image

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding
> is `needs_validation`: the real secret value and the actual GHCR package visibility cannot be
> observed from source, and whether the exposure is acceptable is an owner decision. Line numbers
> refer to commit `2a3976a`.
> Spec 107 already states the key "is not secret from whoever pulls the image" (REQ-13) and lists
> hiding it as out of scope; this spec asks the owner to confirm that acceptance with the audit's
> evidence in hand, not to reverse it.

## Context & Goal

The release workflow's `api` leg refuses to build without a non-empty `OPENSUBTITLES_API_KEY`
secret (`.github/workflows/release.yml:70-78`) and passes it to BuildKit as the
`opensubtitles_api_key` build secret (`:87`). The `prod` stage of `services/api/Dockerfile` mounts
it and copies it to `/app/secrets/opensubtitles_api_key` with mode `0444` (`:68-73`); nothing later
removes it. `api` reads that path (`src/clients/opensubtitles/key.ts:4`) when the environment
variable is empty. The `merge` job then sets each package to `visibility=public`
(`release.yml:178-190`, best effort).

The Dockerfile comment (`:66-67`) is accurate as far as it goes: no `ARG`/`ENV` carries the key, so
`docker inspect` and `docker history` do not show it (spec 107 NFR-6). The file itself, however, is
in a layer of an anonymously pullable image, so anyone can run
`docker run --rm --entrypoint cat <image> /app/secrets/opensubtitles_api_key`.

Impact is limited to the project's single OpenSubtitles application key: someone can spend its
quota or get it banned, which disables subtitle search for every installation until a new key and
release ship. No user data or account password is exposed; each administrator's OpenSubtitles
account stays in their own Settings. Spec 107 rejects a project-run proxy as the alternative.

The goal is an explicit, recorded decision, plus whatever cheap mitigation the owner chooses.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Confirm exposure)**: The owner confirms, against a published tag, that the key file
      is readable from a logged-out pull, and records the result in spec 107's Amendments.
- [ ] **REQ-2 (Decision)**: [NEEDS CLARIFICATION: accept as spec 107 already does; or change the
      delivery (for example a key fetched at install time by `install.sh`, which only moves the
      exposure to the install directory); or proxy, which spec 107 rejected. The audit has no
      preferred answer; the key must be usable in clear by `api` on the user's machine.]
- [ ] **REQ-3 (Accurate comment)**: The Dockerfile comment at `:66-67` states that the key is in the
      image filesystem and readable by anyone who pulls it, so a later reader does not take
      "never reaches image metadata" to mean "not exposed".
- [ ] **REQ-4 (Rotation runbook)**: The rotation steps (new key, update the GitHub secret, cut a
      release, installs update `PERCEPTOR_TAG`) are written down where the release process lives.
      [NEEDS CLARIFICATION: `docs/` or the release agent's brief?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No regression of 107)**: `docker inspect` and `docker history --no-trunc` still show
      no key; a fork or local build without the secret still builds and logs the missing-key warning.
- [ ] **NFR-2 (Override kept)**: The environment variable still wins over the file, so an operator
      whose shared key was banned can supply another one without waiting for a release.

## GraphQL Contract Delta

None.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: From a host not logged in to GHCR,
      `docker pull ghcr.io/dientuki/perceptor-api:<tag>` then
      `docker run --rm --entrypoint cat <image> /app/secrets/opensubtitles_api_key` prints a
      non-empty key; the result is recorded (REQ-1). Locally, a `docker build --target prod
      --secret id=opensubtitles_api_key,src=<dummy>` shows the same with a dummy value.
- [ ] **AC-2**: The decision of REQ-2 is recorded in spec 107's Amendments with the date.
- [ ] **AC-3**: The Dockerfile comment no longer implies the key is hidden (REQ-3).
- [ ] **AC-4**: `docker history --no-trunc` and `docker inspect` of the release image contain no
      key (NFR-1), and `OPENSUBTITLES_API_KEY` set in the environment overrides the file (NFR-2).

## Out of Scope

- **Per-installation keys** — forbidden by OpenSubtitles (spec 107).
- **A project-run proxy** — rejected by spec 107; revisiting it is a new feature spec, not this one.
- **Subdivx credentials** (spec 121) — entered by each administrator, never shipped in an image.
- **Other workflow hardening** of `release.yml` (tag-name expression injection in the `merge` step) — a separate audit finding.

---
title: Pass the release tag list to the manifest step through an environment variable
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [infra]
source_finding: infra/release/merge-step-expression-injection-via-tag-name
audit_verdict: needs_validation
priority: 55
---

# SPEC (draft): Pass the release tag list to the manifest step through an environment variable

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding
> is `needs_validation`: the substitution executing a command is reproduced in a sandbox, but it only
> grants something if tag creation is restricted to principals who cannot already push a modified
> workflow, a repository setting not visible in source. Line numbers refer to commit `2a3976a`.

## Context & Goal

`release.yml` runs on any pushed tag matching `v*.*.*` or `v*.*.*-*`
(`.github/workflows/release.yml:20-24`); the tag name is chosen by whoever pushes it. In the `merge`
job (`:115`, `permissions: packages: write`, `:119-121`), the "Resolve image tags" step builds
`tags="${image}:${GITHUB_REF_NAME}"...` (`:134`) and writes it to `GITHUB_OUTPUT` (`:139-143`). Up
to here the tag is only a shell variable value. The "Create manifest list and push" step then pastes
it into script text with an expression, `done <<< "${{ steps.tags.outputs.tags }}"` (`:174`), so
the runner substitutes the tag into the script before bash parses it. A tag such as
`v1.0.0-$(cmd${IFS}args)` (a valid git ref, no spaces) runs `cmd` inside a job that has already
logged in to GHCR with `GITHUB_TOKEN` (`docker/login-action`, `:148-153`), so injected code could
push to `ghcr.io/dientuki/perceptor-*`. The verifier reproduced the substitution executing an
injected `touch` (`agents/v-infra-release-merge-step-expression-injection-via-tag-name/artifacts/
evidence/sim.sh`, `sim.log`).

A tag-triggered run uses the workflow at the tagged commit, so anyone able to push a tag on a commit
of their choice could already change the workflow; the injection adds privilege only under a tag
ruleset that lets someone create `v*` tags without being able to push branches or edit workflows, or
only on reviewed commits. The fix is cheap and correct either way: no event-controlled value should
reach a `run:` script through `${{ }}`.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Env, not expression)**: The manifest step receives the tag list as
      `env: TAGS: ${{ steps.tags.outputs.tags }}` and reads `<<< "$TAGS"`; no `${{ }}` that can carry
      the tag name appears inside any `run:` block.
- [ ] **REQ-2 (Tag shape)**: The "Resolve image tags" step refuses, with a clear error and before any
      push, a `GITHUB_REF_NAME` that is not `v` + SemVer (`^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$`),
      which is also the set of valid Docker tags this workflow can produce.
- [ ] **REQ-3 (Audit the rest)**: Every other `${{ }}` inside a `run:` in the file is checked; the ones
      today carry only `matrix.*`, `steps.build.outputs.digest` and `steps.platform.outputs.pair`,
      none tag-derived. [NEEDS CLARIFICATION: move those to `env:` too, for one uniform rule?]

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Release unchanged)**: For a valid tag, the same images, digests and tags (exact tag and
      `latest`) are published; `083`'s build/merge split and NFR-6 are untouched.
- [ ] **NFR-2 (Repository settings)**: [NEEDS CLARIFICATION: owner to record who may create `v*`
      tags (Settings > Rules) and whether any such principal lacks branch push or workflow-edit
      rights; that decides the severity, not the fix.]

## GraphQL Contract Delta

None.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1 (reproduce first)**: Rerun `sim.sh` from the verifier evidence; it shows the injected
      command running through the current substitution. Optionally, in a throwaway fork with the
      publish steps stubbed, push tag `v0.0.0-$(id)` and see the command's output in the merge log.
- [ ] **AC-2**: With REQ-1 the same simulation passes the literal string through and runs nothing.
- [ ] **AC-3**: With REQ-2 the fork run fails in "Resolve image tags" for that tag and pushes nothing.
- [ ] **AC-4**: A normal `vX.Y.Z-rcN` tag publishes all five images with both tags as today.

## Out of Scope

- **Tag rulesets and branch protection** — a hosted setting, recorded under NFR-2, not changed here.
- **Pinning third-party actions to commit SHAs** — a separate hardening item.
- **`latest` moving on release candidates** — deliberate during the closed alpha.

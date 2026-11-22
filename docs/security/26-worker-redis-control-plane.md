---
title: Stop the worker trusting unauthenticated Redis messages and stored verdicts
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-22
status: Draft
services: [worker, infra]
source_finding: worker/redis/unauthenticated-control-plane-cancel-and-verdict-poisoning
audit_verdict: needs_validation
priority: 26
---

# SPEC (draft): Stop the worker trusting unauthenticated Redis messages and stored verdicts

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `7365e13`
> (source unchanged since `98f8779`).
> Shares the Redis exposure with spec 21; spec 01 closes the api-side forged-callback twin.

## Context & Goal

Redis runs with no password or ACL on `perceptor-net` (`docker-compose.yaml:412-418`), reachable by
every container there (qBittorrent, Prowlarr and others that parse untrusted tracker and torrent
content) and by the host when the build overlay publishes `REDIS_PORT` (`docker-compose.build.yaml:51`,
spec 21). The worker trusts it in two ways:

1. **Cancel channel.** The `encode:cancel` subscriber (`src/index.ts:170`) acts on any message whose
   `processJobId` is a number. `cancelEncode` aborts the running encode, which is rethrown as an
   `UnrecoverableError` and reports nothing, so `api` keeps the job `ENCODING` until the next worker
   boot (spec 054).
2. **Stored verdicts.** `readVerdict` returns `JSON.parse(raw) as T` for any `perceptor:encode:*` key
   (`src/encode/verdict-store.ts:105`). `dubtrim` re-checks type and range on read
   (`dub-trim.ts:184`), but `resolveStreamEndTrim` returns the stored `streamtrim` value as is
   (`stream-end-trim.ts:139`). It becomes the `-t` cut (`encode.ffmpeg.ts:44`), so a tiny positive
   value written over an existing key truncates a retried encode, which is then delivered as
   `COMPLETED` and its source cleaned up. The attacker can only overwrite keys that already exist
   (`SCAN` finds them), so poisoning needs an input that is encoded again (retry or Play resume).

Goal: validate what the worker reads from Redis, and remove network position as the only authority.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Verdict shape)**: Every verdict kind is validated on read with its own check (type and
      range) and an invalid value is a miss that is recomputed, as `dubtrim` already does;
      `streamtrim` is validated as `number | null` with a finite value above zero and not above the
      file's own duration [NEEDS CLARIFICATION: the duration is known to the caller, not to
      `readVerdict` — validate in each resolver or pass a validator into `readVerdict<T>`?].
- [ ] **REQ-2 (Cancel authenticity)**: A cancel message is honoured only if it proves it came from
      `api`, [NEEDS CLARIFICATION: Redis ACL users per service, an HMAC over the message keyed from
      `SERVICE_TOKEN`/a dedicated secret, or a cancel flag read back from `api` over GraphQL?].
- [ ] **REQ-3 (Cancel is reconciled)**: A cancel the worker applies that `api` never asked for does
      not leave the job `ENCODING` forever: either REQ-2 rejects it, or the worker reports the abort
      so `api` can requeue it (spec 054 path).
- [ ] **REQ-4 (Redis auth)**: Redis requires authentication (`requirepass` or per-service ACL users)
      with a generated secret in `.env`, used by `api`, `worker` and the healthcheck
      [NEEDS CLARIFICATION: in scope here, or a separate spec? It touches both installers, every
      `REDIS_*` consumer and the upgrade path of existing installs].

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Spec 111)**: A Redis failure still only means recomputing; validation adds no new
      failure mode for the encode.
- [ ] **NFR-2 (Upgrade)**: An existing install without the new secret keeps booting until the
      installer or documented step adds it [NEEDS CLARIFICATION].
- [ ] **NFR-3 (Delete-mid-encode)**: Spec 047's guarantee holds: a genuine delete still aborts the
      running encode promptly.

## GraphQL Contract Delta

None for REQ-1 and REQ-2 if the signature option is chosen. If cancellation moves to a GraphQL
read, that is a contract change and must be frozen first (Article VIII).

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: In a disposable stack, publishing `{"processJobId":N}` to `encode:cancel` from another
      container during an encode aborts it and leaves `api` showing `ENCODING` (reproduces the bug);
      after the fix an unsigned or unauthenticated message is ignored and logged.
- [ ] **AC-2**: Setting an existing `perceptor:encode:streamtrim:*` key to `1`, then retrying that
      encode, produces a 1 s `COMPLETED` output before the fix (reproduces the bug); after the fix the
      value is rejected, recomputed, and the full-length file is delivered.
- [ ] **AC-3**: Non-numeric, negative, `NaN`-like and over-duration values for each verdict kind are
      treated as a miss.
- [ ] **AC-4**: Deleting a source mid-encode through the normal path still cancels the encode (spec
      047).
- [ ] **AC-5**: If REQ-4 is taken, a Redis client without the secret is refused and the stack boots
      with `bin/dev`, `bin/prod` and `install.sh`.

## Out of Scope

- Redis exposure to the host: spec 21.
- Forged `api` callbacks reachable by users: spec 01.
- BullMQ job-payload validation on the producer side (not yet audited, see README).

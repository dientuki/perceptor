---
title: Pin the OpenSubtitles session host before sending the application key
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/clients/opensubtitles/redis-session-cache-baseurl-unvalidated-key-forwarding
audit_verdict: needs_validation
priority: 39
---

# SPEC (draft): Pin the OpenSubtitles session host before sending the application key

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding is
> `needs_validation`: it needs Redis write access, which the default compose does not give a
> lower-trust principal, and the hunter's harness was not independently re-run. Line numbers refer to
> commit `2a3976a`.
> Depends on the Redis exposure of spec 21 (host-facing) and spec 26 (in-network); this spec is the
> defence-in-depth half on the api side.

## Context & Goal

`OpenSubtitlesClient.session()` (`clients/opensubtitles/client.ts:191`) caches the login result in
Redis under `opensubtitles:token:<sha256(key + username + password)>` (`:193-195`). On a hit it
returns `JSON.parse(cached) as OsSession` with no validation (`:197-198`). `authed()` then builds the
request URL from `session.baseUrl` (`:154`) and sends it with the application `Api-Key`
(`baseHeaders`, `:176`) and `Authorization: Bearer <session.token>` (`:155-158`).

Redis runs with no password (`docker-compose.yaml:412-418`). A Redis writer cannot derive the cache
key (it hashes secrets) but can list it with `KEYS opensubtitles:token:*` and overwrite the value
with an attacker `baseUrl`. The next subtitle search then sends Perceptor's own OpenSubtitles
application key (one per application, shipped in the published image) and the admin account's
provider token to that host. The fresh login path also builds `baseUrl` from the provider's
`base_url` with no host check (`:230`); that response comes over TLS from `api.opensubtitles.com`
(`:23`, `:205`), so it is lower risk.

Mitigating: the runtime compose does not publish Redis; the source-build overlay does
(`docker-compose.build.yaml:49-51`, spec 21). A principal with Redis write already has broader
powers (queue injection, spec 26), so the incremental effect is disclosure of the application key
and a provider token.

Goal: credentials are only ever sent to an OpenSubtitles host, whatever Redis holds.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Host pin on read)**: A cached session is used only when its `baseUrl` parses as an
      `https:` URL whose host is `api.opensubtitles.com` or a subdomain of `opensubtitles.com`, with the
      `/api/v1` path; otherwise the entry is dropped (`dropSession`) and a fresh login runs.
      [NEEDS CLARIFICATION: is a suffix match on `opensubtitles.com` enough, or should only the hosts
      OpenSubtitles documents for `base_url` (e.g. `vip-api.opensubtitles.com`) be allowed?]
- [ ] **REQ-2 (Host pin on login)**: The same check applies to the `base_url` returned by `/login`
      before it is cached; an unexpected host falls back to `DEFAULT_HOST`.
- [ ] **REQ-3 (Shape check)**: A cached value that is not an object with string `token` and
      `baseUrl` is treated as a miss, not trusted through a type cast.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No secret in logs)**: Rejecting a cached entry logs a warning naming neither the
      token, the key nor the offending URL in full.
- [ ] **NFR-2 (Quota)**: A valid cached session is still reused for its TTL; REQ-1 adds no login
      call for a well-formed entry (memory: conserve external API calls).

## GraphQL Contract Delta

None.

## Data Model Changes

None. Existing cache entries written by the current code pass REQ-1 unchanged.

## Acceptance Criteria

- [ ] **AC-1 (reproduces first)**: In a tsx/vitest harness with fake Redis and `fetch`, preload
      `opensubtitles:token:<hash>` with `{ token: "t", baseUrl: "https://attacker.test/api/v1" }` and
      call `search()`: today the fake `fetch` records a request to `attacker.test` carrying `Api-Key`
      and `Authorization: Bearer t`.
- [ ] **AC-2**: After REQ-1 the same call sends nothing to `attacker.test`, logs in at
      `api.opensubtitles.com` and overwrites the cache entry.
- [ ] **AC-3**: A login answer with `base_url: "evil.test"` caches the default host (REQ-2); a
      malformed cached value (`"[]"`, `"{}"`) triggers a fresh login (REQ-3).
- [ ] **AC-4 (deployment)**: The owner checks from a non-stack host whether the Redis port is
      reachable; if so, `KEYS opensubtitles:token:*` and a non-destructive overwrite with a dummy host
      confirm the precondition, then the key is deleted.

## Out of Scope

- Putting a password or ACL on Redis — spec 26; unpublishing its port — spec 21.
- The Subdivx provider client (no cached base URL).

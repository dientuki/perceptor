---
title: Throttle anonymous login and bound its bcrypt cost
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-22
status: Draft
services: [api]
source_finding: api/auth/login-unbounded-bcrypt-no-throttle-or-alias-limit
audit_verdict: needs_validation
priority: 12
---

# SPEC (draft): Throttle anonymous login and bound its bcrypt cost

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `7365e13`
> (source unchanged since `98f8779`). Related to spec 13 (timing) and spec 09 (login/disable race).

## Context & Goal

`login` is a `@Public()` mutation (`auth.resolver.ts:63`) that runs `bcrypt.compare` once per
attempt for an existing username (`auth.service.ts:28`). Nothing counts, delays or limits attempts:
`main.ts:48` only sets a 2 MB json body limit, and `GraphQLModule.forRoot` (`app.module.ts:41`) has
no validation rules, alias, depth or batching limit. One GraphQL document can carry many aliased
`login` fields, so a single HTTP request multiplies both guesses and bcrypt work on the libuv pool,
and defeats any per-request limiter placed in front. The password policy is `MinLength(6)` only
(`users/dto/create-user.input.ts:18`).

The admin password is shared with qBittorrent and Prowlarr (`061`), so a brute-force win is wider
than the api. Whether the api is reachable from untrusted networks, and whether Traefik applies any
rate limit, is a deployment fact the repository does not answer.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Attempt throttle)**: Failed logins must be throttled per username and per client
      address (Redis-backed counters, since `api` already depends on Redis), with an increasing delay
      or a temporary refusal after a small number of failures. [NEEDS CLARIFICATION: thresholds and
      window; lockout must not let an anonymous caller lock the admin out indefinitely, so prefer
      delay/backoff over a hard lock.]
- [ ] **REQ-2 (Operation bound)**: A single GraphQL request may contain at most one `login`
      operation field; aliased or batched repeats are refused before any bcrypt work, with a keyed
      error. [NEEDS CLARIFICATION: apply as a global alias/field-count validation rule on
      `GraphQLModule`, or only to unauthenticated operations?]
- [ ] **REQ-3 (Bcrypt concurrency cap)**: The number of concurrent `bcrypt.compare` calls from login
      must be capped, so a flood cannot saturate the threadpool and starve other requests.
- [ ] **REQ-4 (Throttled reply)**: A throttled attempt returns a distinct keyed error
      (`error.auth.too_many_attempts`, [NEEDS CLARIFICATION: key and `web` copy]) without running
      bcrypt, and a successful login clears the counter.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Proxy address)**: The client address is taken from the trusted-proxy chain Traefik
      sets, never from a client-supplied header unchecked. [NEEDS CLARIFICATION: is `trust proxy`
      configured today?]
- [ ] **NFR-2 (Redis failure)**: If Redis is unavailable the throttle fails closed for the account
      counter only after weighing availability; [NEEDS CLARIFICATION: fail open or closed?].
- [ ] **NFR-3 (Password policy)**: Raising the minimum length is a separate decision, left out of
      this spec.

## GraphQL Contract Delta

No shape change. New refusals on `login`:

| Condition | GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Too many recent failures | `UnauthorizedException`/429-style, key `error.auth.too_many_attempts` [NEEDS CLARIFICATION] | "Too many attempts, try again later" |
| More than one `login` field in one document | `BadRequestException`, key [NEEDS CLARIFICATION: `error.auth.login_batch_refused`?] | generic error |

`docs/spec/graphql-contract.md` and `web`'s catalogs (`messages/{en,es}.json`) move first (Article VIII).

## Data Model Changes

None. Counters live in Redis with a short expiry.

## Acceptance Criteria

- [ ] **AC-1**: With an isolated api and a dummy user, one document with N aliased `login` fields
      is currently accepted and runs N bcrypt compares (reproduces the bug); after the fix it is
      refused and runs none.
- [ ] **AC-2**: After K wrong passwords for a username, the next attempt, even with the right
      password, is refused with the throttled key until the window passes.
- [ ] **AC-3**: A successful login resets the counter; failures for a username that does not exist
      are throttled too and answer the same way as for one that does.
- [ ] **AC-4**: While a burst of logins is in flight, an authenticated `me` query stays responsive
      (threadpool not saturated).
- [ ] **AC-5**: Normal single login, remember-me login and the disabled-account message still work.

## Out of Scope

- **Reverse-proxy rate limiting** (Traefik middleware) as the only control: valuable but cannot see
  aliases inside one request; it complements, not replaces, REQ-2.
- **Password strength policy**, MFA, CAPTCHA.

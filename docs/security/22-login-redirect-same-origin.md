---
title: Accept only same-origin paths as the post-login redirect
spec_version: 0.1.0
author: security-audit run-2 (draft)
created_at: 2026-11-22
last_updated: 2026-11-22
status: Draft
services: [web]
source_finding: web/auth/login-redirect-allows-protocol-relative-url
audit_verdict: needs_validation
priority: 22
---

# SPEC (draft): Accept only same-origin paths as the post-login redirect

> Draft written from a static security audit (`security-audit` skill, run-2, profile `standard`).
> Nothing was executed; the finding is `needs_validation`. Line numbers refer to commit `7365e13`
> (source unchanged since `98f8779`).

## Context & Goal

`LoginForm` reads the `redirect` query parameter (`components/auth/LoginForm.tsx:18`) and binds it
to `loginAction`, which accepts it when it merely `startsWith("/")` (`actions/auth.ts:45`) and calls
`redirect(destination)` after the session cookie is set (`:76`). `//evil.example` and `/\evil.example`
both start with `/` but are network-path references: the client resolves them against the page URL
and may navigate to another origin. `proxy.ts:27` also copies `pathname` into the `redirect`
parameter, so a request for `//host` builds the same value without the attacker crafting the link.

Impact is low: it needs the victim to log in and no token leaves with the redirect (the cookie is
`HttpOnly`), but it gives phishing a trusted login page as a launch point. The audit did not read
how Next 16's client treats such a value, hence `needs_validation`.

Goal: the destination is always a path on this origin, or `/`.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Same-origin only)**: `loginAction` accepts a destination only when it is a single
      leading `/` followed by neither `/` nor `\`, and falls back to `/` otherwise.
- [ ] **REQ-2 (Canonical check)**: The check is a shared helper that parses the value against a dummy
      base and requires the resulting origin to equal that base, so encoded or control-character
      variants (`/%5Cevil`, `/\t/evil`, leading whitespace) are refused too [NEEDS CLARIFICATION:
      percent-decoded forms — refuse or keep?].
- [ ] **REQ-3 (Producer side)**: `proxy.ts` builds the `redirect` parameter from the same helper, so a
      request path such as `//host` is not propagated.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Legitimate targets)**: Deep links with a query string or hash (`/movies/12?tab=x`)
      still round-trip through login.
- [ ] **NFR-2 (No contract change)**: `web` only; no API change.

## GraphQL Contract Delta

None.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: Calling `loginAction` with redirect `//example.invalid` or `/\example.invalid` before
      the fix reaches `redirect()` with that value (reproduces the bug); after the fix it redirects
      to `/`.
- [ ] **AC-2**: In a test install, opening `/login?redirect=//example.invalid` and logging in lands on
      `/`, never off-origin.
- [ ] **AC-3**: `/login?redirect=/movies/12?tab=x` still lands on that path after login.
- [ ] **AC-4**: A request for `//example.invalid` while signed out produces a login URL whose
      `redirect` is `/` or absent.

## Out of Scope

- Logout and other redirects in `actions/auth.ts` that do not take user input.
- Next 16 client behaviour for a `//host` action redirect (the fix removes the dependency on it).

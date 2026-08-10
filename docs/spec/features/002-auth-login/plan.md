---
title: Login and the Authentication Boundary — Implementation Plan
spec_version: 1.0.0
last_updated: 2026-08-10
status: Implemented
---

# PLAN: Login and the Authentication Boundary (`plan.md`)

## Approach

Do not build an auth system. Connect the four pieces that already exist but are disconnected —
`JwtStrategy`, `GqlAuthGuard`, `AuthService.login`, the `auth_token` cookie — and close what they
cannot close on their own: the default-open guard, the second (machine) identity, and session
revocation. Three seams:

1. **One guard, registered once** (`APP_GUARD`), with two Reflector axes — `@Public()` (is a
   credential required?) and `@AllowService()` (may a machine principal call this?). Closed by
   default on both axes.
2. **One JWT format, three payload shapes** — user session (with `jti` tied to a Redis-backed
   session record), service principal (`typ: 'service'`, no `jti`, no expiry), upload ticket
   (`typ: 'upload'`, `jti`, 60s) — all signed with the same `JWT_SECRET`, verified by the same
   strategy.
3. **One credential-forwarding point per consumer**: `fetchGraphQL` in `web`, `fetchGraphQL` in
   `worker`, one `curl` call in the qBittorrent AutoRun script.

Reused rather than rebuilt: `services/api/src/auth/strategies/jwt.strategy.ts` (extractor list
swapped, `validate` retyped and made async), `services/api/src/redis/redis.service.ts` (already an
`ioredis` instance — becomes both the session store and the upload-ticket spend store, no Prisma
change needed), the `UploadFinishError` pattern in `services/api/src/uploads/uploads.service.ts`
(tus reads `status_code`/`body` off a thrown error — the new `onUploadCreate` hook reuses that
exact shape), and `web`'s documented server-action error-handling pattern in
`services/web/CLAUDE.md` (extended by one helper call per action, not replaced).

## Order of Work

Three phases, **not** a strict api-then-web-then-worker sequence, because a literal api-first order
would leave the worker, web, and the qBittorrent hook all broken while the guard is live —
reopening exactly the NFR-2 risk (silent pipeline break) the spec is most worried about.

- **Phase A — `api`, fully additive.** Everything is written but the two lines that make it
  load-bearing are NOT flipped: the `JwtAuthGuard` class is authored but not registered as
  `APP_GUARD`, and `onUploadCreate` is authored but not wired into the tus `Server` options.
  `me: String!` → `me: User!` is breaking in the SDL but safe to ship immediately — grep confirms
  no consumer exists yet anywhere in `web` or `worker`.
- **Phase B — consumers, genuinely parallel.** `[web]`, `[worker]`, and orchestrator-owned
  compose/`.env`/script work all proceed at once, once the env var names are fixed (that's the one
  dependency). They start sending credentials at an API that still accepts anonymous requests, so
  every change here is independently verifiable and a no-op in production terms until Phase C.
- **Phase C — the flip, two lines.** Register `APP_GUARD` in `app.module.ts`; wire
  `onUploadCreate` into the tus server. This is the entire breaking change, reviewable at a glance,
  trivially revertible.

| Step | Owner | Phase | Why here |
| :-- | :-- | :-- | :-- |
| 1 | `[api]` | A | `auth.constants.ts` (secret getter, TTL constants, boot assertion) — everything else imports from it |
| 2 | `[api]` | A | `auth.types.ts` (`AuthPrincipal` union, `toPrincipal()`) + its spec — pure, testable, the security hinge |
| 3 | `[api]` | A | `session.service.ts` (Redis-backed session create/exists/revoke) + its spec |
| 4 | `[api]` | A | `JwtStrategy`: dual extractor (bearer + cookie), deduped secret, `toPrincipal`, session check |
| 5 | `[api]` | A | `@Public()` / `@AllowService()` decorators + `JwtAuthGuard` class (not registered yet); delete `gql-auth.guard.ts` |
| 6 | `[api]` | A | Apply `@Public()` to `login`; `@AllowService()` to the nine machine-reachable operations |
| 7 | `[api]` | A | `me: User!`, guarded `logout` (revokes session), `LoginInput.rememberMe`, TTL wiring — diff `schema.gql` against the frozen delta |
| 8 | `[api]` | A | Upload tickets: `UploadTicket` entity, `upload-tickets.service.ts` + spec, `uploads.resolver.ts`, `onUploadCreate` written but not wired |
| 9 | `[api]` | A | `scripts/mint-service-token.ts` + npm script |
| 10 | `[orch]` | B | `.env.example` + `docker-compose.yaml` env wiring (`JWT_SECRET`→api, `SERVICE_TOKEN`→worker+torrent) + `bin/install` generates both. Blocks 11–13 |
| 11 | `[worker]` `[P]` | B | `graphql-client.ts` bearer forwarding + its spec |
| 12 | `[orch]` `[P]` | B | `on-torrent-completed.sh` bearer header + body/status check |
| 13 | `[web]` `[P]` | B | config rename, `fetchGraphQL` forwarding, `auth-session.ts`, 11 action call sites, login/logout actions, dashboard layout + `me`, upload ticket flow |
| 14 | `[api]` | C | Register `APP_GUARD`; wire `onUploadCreate`. The flip |
| 15 | `[docs]` | C | Root + api + web `CLAUDE.md`, `docs/spec/graphql-contract.md` |
| 16 | `[verify]` | C | AC-1…AC-13 |

Steps 11, 12 and 13 are marked `[P]`: genuinely parallel once step 10 lands, because each targets an
API that is still open during Phase B — nothing one of them does can break another.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen. Four things an implementer will want to
change and must not:

- **`me: User!` needs a DB read.** It looks wasteful from inside `auth/` — the JWT payload almost
  has enough already. Don't add `name` to the JWT payload to avoid it: that grows every token and
  goes stale on rename, and the DB lookup is the only user-deleted check the system has.
- **`logout`'s shape (`Boolean!`) doesn't change even though its behavior does** — it now revokes a
  Redis session record instead of (uselessly) trying to clear a cookie the API can never reach.
- **The upload ticket is not re-checked on `PATCH`** — only at creation. Looks like a hole;
  re-checking a 60s ticket per chunk would make large uploads impossible, and the spec accepts this
  residual risk explicitly.
- **Don't add a sixth user-facing error message** for "service principal called a user-only
  operation" — reuse `No autenticado` (log server-side for diagnosability instead).

A prerequisite step, before Phase A starts, amends `spec.md` itself: the Out of Scope section's
"Server-side logout / token blocklist" entry is replaced by the Redis session-registry decision
above, and the "Fixing `auth.service.spec.ts`" entry is removed because that file no longer exists
(see Verification § Baseline below).

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, and re-brief every
service listed in `services:`. Never patch it from inside one slice (Constitution, Article VIII).

## Migrations

**None.** No Prisma schema, field or enum changes — sessions and upload tickets both live in Redis,
not the database, exactly as the spec requires (`isAdmin` and any schema work belongs to `003`).

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| NFR-2 — the pipeline breaks silently | Guard lands, `encodeProgress` 401s mid-encode, the AutoRun hook exits 0 after a 401 — downloads complete, nothing gets scanned, no UI shows it | Phase B fully lands before Phase C flips — no window exists. The nine `@AllowService()` targets are enumerated by name in the api slice. A smoke call to all nine with `SERVICE_TOKEN` is part of Phase C verification |
| Apollo returns HTTP 200 for GraphQL-level auth errors | A status-only check (in the bash hook or a naive client) sees 200 and reports success | The AutoRun hook checks the response body for `"errors"` in addition to the HTTP status; the worker keeps its existing `json.errors` throw and adds `res.ok` as a second, independent check |
| Guard reaches `UploadsController` | tus 401s on every `PATCH`, killing multi-GB uploads at the second chunk | `canActivate` short-circuits to `true` for any non-GraphQL execution context — the guard structurally cannot reach REST routes |
| `@Public()` checked after Passport runs | A corrupted/expired cookie makes `login` itself unreachable — permanent lockout with no recovery path | Guard checks `@Public()` metadata before calling `super.canActivate()`; verified by logging in with a deliberately corrupt cookie present |
| Redis is lost or restarted | Every session drops at once; every signed-in user is bounced to `/signin` | Accepted consequence of session-in-Redis. Redis already runs `--save 60 1` with a persistent volume; document the ~60s window of acceptable loss |
| `rememberMe` renders as `Boolean` instead of `Boolean = false` in the generated schema | Article VIII violation — existing callers omitting the field fail at runtime with no compile-time signal | Use `defaultValue: false`, never `nullable: true`; diff the generated `schema.gql` line against the frozen delta before calling Phase A done |
| `JWT_SECRET` rotated without re-minting `SERVICE_TOKEN` | Same silent-break shape as the NFR-2 row, triggered later by an unrelated ops action | Documented in `.env.example` next to both variables; the AutoRun hook's non-zero exit surfaces it in the qBittorrent container log |
| Browser session restore keeps "session" cookies alive across restarts | AC-4's unchecked-checkbox case appears to fail, tempting a `maxAge` fix that silently defeats REQ-8 | Verification step explicitly calls for a fresh profile / session restore disabled |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/cli web npx --no tsc --noEmit
bin/cli worker npx --no tsc --noEmit
bin/npm api test
```

**Baseline** (measured 2026-08-10, after the stale `services/api/src/auth/test/` and
`services/api/test/app.e2e-spec.ts` files were deleted — they tested an auth implementation that
never matched the real code): `api` 0 typecheck errors, `web` 12 errors across 5 pre-GraphQL files
unrelated to auth (`importFolderModal.tsx`, `ImportMagnetSeasonModal.tsx`, `SearchTorrentModal.tsx`,
`SearchForm.tsx`, `ResultsForm.tsx`), `worker` clean. Because `api` now starts from zero, the bar
there is genuinely zero net-new errors; `web`'s bar stays at "no more than 12".

Then live checks against the running stack, run from the `torrent` container (the only image in the
stack with `curl`):

```bash
docker compose exec torrent curl -sS -X POST http://api:4000/graphql \
  -H 'Content-Type: application/json' -d '{"query":"{ users { id } }"}'
```

— AC-1 (no credential → `No autenticado`, no data), AC-2 (bearer token → data), REQ-5 in both
directions (SERVICE_TOKEN against `users`/`me` → rejected; against `processJob` → data), REQ-3
(`-H 'Cookie: auth_token=...'` also works), AC-11 (`POST /uploads` with no ticket → 401, zero bytes
written under the downloads root), AC-12 (replayed ticket → 401; mismatched movieId → 403), AC-10
(run the hook with `SERVICE_TOKEN` unset → non-zero exit, reason on stderr), AC-8 (blank
`JWT_SECRET` → api refuses to boot with an explicit message), AC-7
(`docker compose logs web | grep -iE 'password|Bearer|access_token'` empty).

Manual UI pass: AC-3, AC-4 (both checkbox states, fresh browser profile), AC-5 (logout → reload
protected page → `/signin`, AND a replayed old cookie is now genuinely rejected because of the
Redis session check), AC-6, AC-9 (full pipeline run with the guard live), AC-13 (real upload with
pause/resume, confirming via the network tab that resume does NOT issue a second `POST /uploads`).

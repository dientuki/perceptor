---
title: Login and the Authentication Boundary
spec_version: 1.1.0
author: Juan Farias
created_at: 2026-08-09
last_updated: 2026-08-10
status: Approved
services: [api, web, worker]
---

# SPEC: Login and the Authentication Boundary (`spec.md`)

## Context & Goal

Perceptor has a login screen, a JWT, a Passport strategy and a GraphQL guard. None of them are
connected to each other. `web` stores the token it gets from `login` in an HttpOnly cookie
(`src/actions/auth.ts`) and then never sends it anywhere: `fetchGraphQL` in
`services/web/src/lib/graphql-client.ts` builds every request with `Content-Type` and nothing else.
Even if it did send the cookie, the names would not match — `web` writes `auth_token`
(`src/lib/config.ts`), the JWT strategy reads `req.cookies.token`
(`src/auth/strategies/jwt.strategy.ts`) and the `logout` mutation clears a third one. And even if
the names matched, it would change almost nothing, because `GqlAuthGuard` is applied exactly once in
the whole API: on the `me` query.

The practical consequence is that the API is unauthenticated. `api.${DOMAIN}/graphql` is routed by
Traefik, and anyone who can reach it can list users, create users, delete users, register titles,
change settings and drive the download pipeline. The only thing resembling access control is
`services/web/src/proxy.ts`, which redirects to `/signin` when the cookie is *absent* — a presence
check, with no signature verification, on a service that is not the one holding the data. The same
applies to `POST/PATCH/HEAD /uploads` (`services/api/src/uploads/`), the project's one REST route:
its tus server declares `onUploadFinish` but no `onUploadCreate`, so there is no point in the
request lifecycle where anyone asks who is uploading.

This feature closes that boundary. When it ships, a request to `/graphql` without a valid credential
returns an error instead of data; `login` is the only public operation in the schema; every
non-browser caller of the API authenticates; an upload has to present a ticket minted by an
authenticated user; and the "keep me logged in" checkbox, which is decorative today, actually
changes how long the session lasts. No pipeline stage in the root `CLAUDE.md` changes status —
every stage keeps working, which is itself a requirement here (NFR-2), because a global guard is
exactly the kind of change that silently breaks a background consumer.

There are **two** such non-browser callers, not one, and missing the second would break the pipeline
at its first step. The worker calls six mutations and two queries over
`services/worker/src/api/graphql-client.ts`. Separately, qBittorrent calls `torrentCompleted` from
`services/torrent/commands/on-torrent-completed.sh` — a bash script with `curl`, bind-mounted into a
third-party container, invoked by qBittorrent's AutoRun hook when a download finishes. It sends
`Content-Type` and nothing else. If only the worker is given a credential, downloads will complete
and nothing will ever be scanned, with the failure visible only in the qBittorrent container's log.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Token reaches the API)**: Every call `web` makes to `api` on behalf of a signed-in
      user must carry that user's token. A server action that has a session and does not forward it
      is a defect, not a style choice.
- [ ] **REQ-2 (One cookie name)**: The session cookie must have exactly one name, defined in one
      place, used by every producer and consumer of it. The current `authTtoken` typo is corrected
      as part of this.
- [ ] **REQ-3 (Two carriers, one token)**: The API must accept the token both as a bearer
      `Authorization` header and as a cookie. The cookie is the browser↔`web` channel; the bearer
      header is the `web`/`worker`↔`api` channel. A single JWT format serves both.
- [ ] **REQ-4 (Closed by default)**: Every GraphQL operation must require a valid credential unless
      it is explicitly marked public. **`login` is the only public operation.** Adding a resolver
      must not be a way to accidentally add an unauthenticated endpoint.
- [ ] **REQ-5 (Machines have an identity)**: Every non-browser caller of the API must authenticate
      without impersonating a human user, and its credential must be distinguishable from a user
      session, so that a leaked machine credential cannot be used to read or modify user accounts.
      There are two such callers and both are in scope: the **worker**
      (`services/worker/src/api/graphql-client.ts`) and the **qBittorrent AutoRun hook**
      (`services/torrent/commands/on-torrent-completed.sh`, which reaches the API with `curl` from
      a third-party container).
- [ ] **REQ-6 (No default secret)**: The JWT signing secret must come from configuration. If it is
      absent the API must refuse to start. It must not fall back to a literal in the source.
- [ ] **REQ-7 (Credentials are never logged)**: No log line may contain a password or a token.
      Today `graphql-client.ts` prints the whole request body, which means every login writes the
      user's plaintext password to the `web` container log.
- [ ] **REQ-8 (Keep me logged in)**: The sign-in form's "keep me logged in" checkbox must control
      session lifetime. Checked: 30 days. Unchecked: the session ends when the browser closes. The
      token's expiry and the cookie's expiry must always agree — a cookie that outlives its token
      produces a user the UI treats as signed in and the API rejects.
- [ ] **REQ-9 (`me` works)**: `me` must return the authenticated user, and must actually resolve for
      a signed-in user. Today it cannot, whatever the resolver says, because no token reaches the
      API. This is the acceptance canary for REQ-1 and REQ-3.
- [ ] **REQ-10 (Logout ends the session)**: Signing out must leave the browser unable to make
      authenticated calls. The API side must not claim to clear a cookie it cannot reach.
- [ ] **REQ-11 (Uploads are authenticated)**: Starting an upload must require proof that an
      authenticated user asked for it, for a specific movie. That proof must be single-use and
      short-lived, and must be verified when the upload is created — not only when it finishes,
      by which point the bytes are already on disk.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (The boundary holds)**: No request to `/graphql` without a valid credential returns
      data, for any operation other than `login`.
- [ ] **NFR-2 (The pipeline survives)**: Download → scan → encode → media-server notification keeps
      working end to end with the guard in place. This is the requirement most likely to be
      forgotten, because the worker has no UI to notice it in.
- [ ] **NFR-3 (No new secret in the repo)**: Both new secrets (`JWT_SECRET`, the worker credential)
      live in `.env`, are listed in `.env.example` with placeholder values, and are passed to the
      containers that need them and no others.
- [ ] **NFR-4 (Existing sessions)**: Cookies issued before this ships will not validate. That is
      acceptable — the app has one seeded user — but users must land on the sign-in screen rather
      than on an error page.

## GraphQL Contract Delta

Frozen once `status: Approved` (Constitution, Article VIII). Implementers read it, never edit it.

```graphql
type User {
  id: ID!
  name: String!
  username: String!
}

type UploadTicket {
  token: String!
  expiresAt: DateTime!
}

input LoginInput {
  username: String!
  password: String!
  rememberMe: Boolean = false
}

type Query {
  me: User!
}

type Mutation {
  login(loginInput: LoginInput!): LoginResponse!
  logout: Boolean!
  createUploadTicket(movieId: Int!): UploadTicket!
}
```

Three changes, one of them breaking:

| Change | Kind | Notes |
| :-- | :-- | :-- |
| `me: String!` → `me: User!` | **Breaking** | Safe: `grep -rn "me" services/web/src services/worker/src` finds no consumer today |
| `LoginInput.rememberMe` | Additive, defaulted | Existing callers keep compiling; `web` must start sending it for REQ-8 to be observable |
| `createUploadTicket` + `UploadTicket` | Additive | New surface for REQ-11 |
| `logout: Boolean!` | Unchanged shape | Its *behaviour* changes (REQ-10): it stops clearing a cookie the browser never sees |

### The part the schema cannot express

**Most of this feature is an accessibility change, and GraphQL has no syntax for it.** Every
operation below is identical in SDL before and after, and starts returning an error to callers that
worked yesterday. `web` and `worker` retype the schema by hand and there is no codegen
(`docs/spec/graphql-contract.md`), so nothing fails at compile time. This table is the contract:

| Operation group | Before | After |
| :-- | :-- | :-- |
| `login` | Public | Public — the only one |
| `me`, `logout` | `me` guarded, `logout` open | Guarded |
| `users`, `user`, `createUser`, `updateUser`, `removeUser` | Open | Guarded (admin gate arrives in `003`) |
| Movies, media sources, settings, media-roots, media-server, indexer | Open | Guarded |
| `processJob`, `mediaSource`, `sourceScanned`, `encodeStarted`, `encodeProgress`, `encodeCompleted`, `encodeFailed`, `downloadRemove` — the worker's eight | Open | Guarded — reachable with the machine credential |
| `torrentCompleted` — **qBittorrent's, not the worker's** | Open | Guarded — reachable with the machine credential |
| `POST/PATCH/HEAD /uploads` (REST) | Open | Upload creation requires a ticket |

### Errors

| Condition | GraphQL / HTTP error | Message the user sees |
| :-- | :-- | :-- |
| No credential presented | `UnauthorizedException` | `No autenticado` |
| Token expired or badly signed | `UnauthorizedException` | `Tu sesión expiró, iniciá sesión de nuevo` |
| Wrong username or password | `UnauthorizedException` | `Credenciales inválidas` (already the string in `auth.service.ts`) |
| Upload ticket missing, expired or already used | HTTP `401` from tus | `El permiso de subida venció, volvé a intentar` |
| Upload ticket does not match the movie being uploaded | HTTP `403` from tus | `El permiso de subida no corresponde a esta película` |

What each consumer does with them:

- **`web`** — on "no autenticado" or "sesión expiró", the server action deletes the cookie and
  redirects to `/signin` rather than rendering an error. Any other message renders inline, as
  `SignInForm` already does with `state.error`.
- **`worker`** — `src/api/graphql-client.ts` already throws on `json.errors`, which is correct and
  must be preserved. An auth failure must fail the job loudly. A worker that logged the error and
  reported the job completed would leave a movie stuck with nothing written, which is this service's
  central failure mode (`services/worker/CLAUDE.md`).
- **qBittorrent's AutoRun script** — `on-torrent-completed.sh` runs `set -euo pipefail` but calls
  `curl -sS` without `--fail`, so a `401` body is printed and the script still exits `0`. With the
  guard in place that becomes a silent break: qBittorrent reports the hook as successful and the
  download is never scanned. The script must treat a non-2xx response, and a response containing
  `errors`, as a failure.

### The upload ticket, in enough detail to implement

The session cookie **cannot** travel to the upload endpoint, and this constrains the design:
it is HttpOnly and scoped to `${DOMAIN}`, while the browser uploads directly to `api.${DOMAIN}`.
Exposing it to client-side JavaScript so it could be sent manually would defeat the HttpOnly flag
that protects it. So the ticket is not an addition to the session — **it is the session, delegated**:
it is minted by an authenticated GraphQL call and carries the user it was minted for.

- The ticket is a short-lived signed token (≈60 seconds) bound to a user and a `movieId`, with a
  unique id so it can be spent.
- It is verified **when the upload is created**, at the tus `POST`, in an `onUploadCreate` hook that
  does not exist yet. On success its unique id is recorded as spent so it cannot be replayed.
- It is **not** verified on subsequent `PATCH` requests. That is deliberate and follows the tus
  model: once created, the upload URL is the capability. Re-checking a 60-second ticket on every
  chunk would make any multi-gigabyte upload impossible.
- **Known residual risk, accepted:** anyone who learns an in-flight upload URL can append to it.
  tus ids are random and that is the whole protection at that stage. Narrowing it further would
  require per-chunk credentials and is out of scope.

## Data Model Changes

**None.** No Prisma model, field or enum changes in this feature. `isAdmin` arrives in
`003-auth-user-management`; adding it here would be a schema change smuggled into a feature that
does not need it (Constitution, Article VII).

## Acceptance Criteria

- [ ] **AC-1**: A `POST` to `/graphql` with `query { users { id } }` and no cookie or header returns
      an error and no data. Same for a movies query, a settings mutation and `encodeStarted`.
- [ ] **AC-2**: The same request with a valid bearer token returns data.
- [ ] **AC-3**: Signing in through the UI and loading `/dashboard` shows the library. `me` returns
      the signed-in user's `id`, `name` and `username`.
- [ ] **AC-4**: Signing in with "keep me logged in" **unchecked**, then closing and reopening the
      browser, lands on `/signin`. With it **checked**, the same sequence lands on `/dashboard`, and
      the cookie's expiry is ~30 days out.
- [ ] **AC-5**: Signing out and then reloading a protected page lands on `/signin`, and a
      hand-crafted request replaying the old cookie is rejected by the API.
- [ ] **AC-6 (failure path)**: Signing in with a wrong password shows `Credenciales inválidas`
      inline in the form, no redirect, no stack trace.
- [ ] **AC-7 (failure path)**: `docker compose logs web` after a successful login contains neither
      the password nor the token.
- [ ] **AC-8 (failure path)**: Starting the API with `JWT_SECRET` unset fails to boot with an
      explicit message. It must not start with a default.
- [ ] **AC-9**: A full pipeline run — add a magnet, let it download, let it encode — completes with
      the guard in place, and `ProcessJob` reaches its terminal state. Nothing in
      `docker compose logs worker` mentions an authentication error.
- [ ] **AC-10 (failure path)**: Running `on-torrent-completed.sh` inside the `torrent` container
      with the machine credential removed from its environment exits **non-zero** and says why. It
      must not exit `0` after receiving a `401` — that is the shape of the silent break this
      feature is most likely to introduce.
- [ ] **AC-11 (failure path)**: A tus `POST` to `/uploads` with no ticket is rejected with `401`
      before any bytes are written. Verifiable with `curl` — no file appears in the downloads root.
- [ ] **AC-12 (failure path)**: Replaying a ticket that was already used, or one minted for a
      different `movieId` than the upload metadata declares, is rejected.
- [ ] **AC-13**: Uploading a real file through the UI still works end to end, including pausing and
      resuming, which is what proves the ticket is checked at creation and not per chunk.

## Out of Scope

- **Roles and permissions.** `003-auth-user-management` adds `isAdmin` and gates the user
  mutations. This feature only establishes *authenticated vs not*.
- **Refresh tokens.** A 30-day token whose session record isn't renewed until it's used again is
  the accepted trade-off for a self-hosted single-admin app. Rotating the token itself (issuing a
  new one before the old one expires) is a feature of its own.
- **Server-side session state, beyond a single revocable record per login.** REQ-10 requires that
  a logout make the token that logout used unusable, replayed cookie included — not achievable
  with a purely stateless JWT and a `token blocklist` was ruled out in an earlier draft of this
  spec for exactly that reason, until AC-5 made explicit that replay must actually be rejected.
  The mechanism is a **session registry in Redis**: `login` mints a `jti`, records
  `session:<jti> -> userId` with the token's TTL; `logout` deletes that key; the JWT strategy
  checks the key exists for every user principal (not for service principals, which carry no
  `jti` and never expire). This is *not* a full session-management feature — there is no listing
  of active sessions, no per-device revocation, no idle-timeout distinct from the token's own TTL.
  It exists solely to make REQ-10 and AC-5 true.
- **Rate limiting and lockout on `login`.** Worth doing; needs a store and a policy, and does not
  belong in the change that first makes authentication real.
- **Password recovery.** There is no SMTP in the stack. `003` adds a `bin/reset-password` script
  instead, and removes the dead `/reset-password` link.
- **Per-chunk upload authentication.** See the residual risk above.

## Process note: files this feature touches that no agent owns

`services: [api, web, worker]` in the frontmatter is accurate for the three services with agents,
but REQ-5 and NFR-3 also require editing:

- `services/torrent/commands/on-torrent-completed.sh` — the AutoRun hook. `services/torrent/` is
  configuration for a third-party container; there is no `torrent` agent and there should not be
  one, since there is no code of ours to implement there beyond this script.
- `docker-compose.yaml` and `.env.example` — for `JWT_SECRET` and the machine credential.

All three agent definitions in `.claude/agents/` scope writes to `services/<svc>/` for their own
service. These tasks must be tagged so `/implement` does not try to route them; the orchestrator
does them directly, the same way it handles `[docs]`. `003-auth-user-management` hits the same gap
with `bin/reset-password`.

Two features in a row exposing this is enough evidence to fix the flow itself afterwards — either a
fourth tag for repo-root and third-party-container territory, or an explicit statement in
`.claude/commands/implement.md`. Not resolved by this spec.

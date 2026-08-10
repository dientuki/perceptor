---
title: Login and the Authentication Boundary — Tasks
last_updated: 2026-08-10
status: In Progress
---

# TASKS: Login and the Authentication Boundary (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[orch]` | Repo-root and third-party-container territory — `docker-compose.yaml`, `.env.example`, `bin/`, `services/torrent/`. Owned by the orchestrator for the same reason as `[docs]`: no agent's scope covers it. Unlike `[docs]`, these are executable config, so they carry a real *Done when*. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

The groups map onto the three phases in `plan.md`. **Group 1 is additive — nothing breaks.**
Group 3 makes the consumers send credentials at an API that still accepts anonymous requests.
**Group 4 is the entire breaking change, in two lines.** Do not reorder them: the phasing is what
keeps NFR-2 (the silent pipeline break) from having a window to happen in.

Baseline to beat, measured 2026-08-10: `api` **0** typecheck errors, `web` **12** across 5
pre-existing pre-GraphQL files, `worker` **0**.

## Tasks

### Group 1 — Phase A: the auth core, fully additive

Sequential. Each task imports from the one before it. Nothing here changes what any existing caller
can reach: the guard class is written but **not registered**, and `onUploadCreate` is written but
**not wired**.

- [ ] **T001** `[api]` Create `src/auth/auth.constants.ts` with `AUTH_COOKIE_NAME = 'auth_token'`,
      `SESSION_TTL = '12h'`, `REMEMBER_ME_TTL = '30d'`, `UPLOAD_TICKET_TTL_SECONDS = 60`,
      `getJwtSecret()` (throws an explicit message when `JWT_SECRET` is absent — no fallback
      literal) and `assertAuthEnv()`. Call `assertAuthEnv()` as the first statement of
      `bootstrap()` in `src/main.ts`. Remove the `|| 'super-secreto-perceptor'` fallback from
      `src/auth/auth.module.ts` (via `JwtModule.registerAsync`) and
      `src/auth/strategies/jwt.strategy.ts`; drop `signOptions` from the module registration so
      every TTL is decided at the call site.
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean, and
      `bin/cli api env JWT_SECRET= node -e "require('./dist/main')"` — or simply restarting `api`
      with the variable blanked — exits non-zero printing the explicit message, never booting with
      a default (AC-8).

- [ ] **T002** `[api]` Create `src/auth/auth.types.ts`: the `AuthPrincipal` union
      (`{type:'user', id, username}` | `{type:'service', name}`), the `JwtPayload` variants, and
      the pure `toPrincipal(payload)` mapper — `typ === 'service'` yields a principal with **no
      `id`**, so a machine credential cannot resolve a user even by accident. Write
      `src/auth/auth.types.spec.ts` alongside it. → T001
      *Done when:* `bin/npm api test -- auth.types` passes, covering both directions (a service
      payload never returns `type: 'user'`, a user payload never returns `type: 'service'`).

- [ ] **T003** `[api]` Create `src/auth/session.service.ts` over the existing `RedisService`:
      `create(userId, ttlSeconds) -> jti`, `exists(jti)`, `revoke(jti)`, keys `session:<jti>` with
      the TTL matching the token's. Import `RedisModule` into `auth.module.ts`. Write
      `src/auth/session.service.spec.ts`. → T002
      *Done when:* `bin/npm api test -- session.service` passes, proving a revoked `jti` reports
      `exists === false` and that the key carries a TTL rather than living forever.

- [ ] **T004** `[api]` Rewrite `src/auth/strategies/jwt.strategy.ts`: `jwtFromRequest:
      ExtractJwt.fromExtractors([ExtractJwt.fromAuthHeaderAsBearerToken(), cookie extractor reading
      `AUTH_COOKIE_NAME`])` — bearer first, an explicit header beats an ambient cookie. `secretOrKey:
      getJwtSecret()`. `validate` becomes async: map through `toPrincipal`, and for **user**
      principals only, reject when `SessionService.exists(jti)` is false. Service principals carry
      no `jti` and skip the check. Write `src/auth/test/jwt.strategy.spec.ts`. → T003
      *Done when:* `bin/npm api test -- jwt.strategy` passes, covering: token extracted from a
      bearer header; token extracted from the cookie; a service principal not subjected to the
      session lookup; a revoked session rejected.

- [ ] **T005** `[api]` Create `src/auth/decorators/public.decorator.ts` (`IS_PUBLIC_KEY`,
      `@Public()`) and `src/auth/decorators/allow-service.decorator.ts` (`ALLOW_SERVICE_KEY`,
      `@AllowService()`). Create `src/auth/guards/jwt-auth.guard.ts`: `canActivate` checks
      `@Public()` **before** calling `super.canActivate()` (reversed, a corrupt cookie would make
      `login` itself unreachable), short-circuits to `true` for any non-GraphQL execution context,
      and rejects a service principal on any operation lacking `@AllowService()`; `getRequest` is
      gql/http aware; `handleRequest` maps passport-jwt's `TokenExpiredError`/`JsonWebTokenError` to
      `Tu sesión expiró, iniciá sesión de nuevo` and a missing token to `No autenticado`. **Do not
      register it yet.** Delete `src/auth/guards/gql-auth.guard.ts` and its `@UseGuards(GqlAuthGuard)`
      on `me` in the same task so the service keeps compiling. Retype
      `src/auth/decorators/current-user.decorator.ts` to return `AuthPrincipal`. → T004
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean and
      `grep -rn "GqlAuthGuard" services/api/src` returns nothing.

- [ ] **T006** `[api]` Apply the two decorators. `@Public()` on the `login` mutation in
      `src/auth/auth.resolver.ts` — the only public operation. `@AllowService()`, per method and
      never per class, on exactly nine: `processJob`, `encodeStarted`, `encodeProgress`,
      `encodeCompleted`, `encodeFailed`, `downloadRemove` in
      `src/process-jobs/process-jobs.resolver.ts`; `mediaSource`, `sourceScanned` in
      `src/media-sources/media-sources.resolver.ts`; `torrentCompleted` in
      `src/downloads/downloads.resolver.ts`. → T005
      *Done when:* `grep -rn "@AllowService" services/api/src | wc -l` returns exactly 9 and
      `grep -rn "@Public" services/api/src` returns exactly 1, on `login`.

- [ ] **T007** `[api]` The contract changes. `src/auth/dto/login.input.ts` gains
      `@Field(() => Boolean, { defaultValue: false }) rememberMe` — `defaultValue`, never
      `nullable`. `AuthService.login(username, pass, rememberMe)` mints a `jti` through
      `SessionService.create` and signs with a per-call `expiresIn` of `REMEMBER_ME_TTL` or
      `SESSION_TTL`. New `AuthService.getProfile(userId)` reads through the already-injected
      `PrismaService` and throws `No autenticado` when the row is gone — do **not** import
      `UsersService`, that module belongs to `003`. `me` becomes `@Query(() => User)` returning
      `getProfile`. `logout` stays `Boolean!`, is guarded, and revokes the caller's session instead
      of calling `clearCookie` on a cookie the API can never reach. → T006
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean and the regenerated
      `src/schema.gql` shows `me: User!`, `logout: Boolean!` and `rememberMe: Boolean = false`
      character for character against the frozen delta in `spec.md` — `Boolean` without the
      `= false` is a contract violation, not a formatting difference.

- [ ] **T008** `[api]` Upload tickets. `src/uploads/entities/upload-ticket.entity.ts`
      (`UploadTicket { token: String!, expiresAt: DateTime! }` — the `DateTime` scalar is already
      registered). `src/uploads/upload-tickets.service.ts`: `mint(userId, movieId)` signs
      `{sub, movieId, typ:'upload', jti}` with `expiresIn: 60`; `verifyAndSpend(token, movieId)`
      checks `typ`, then the movieId match, **then** spends the `jti` with an atomic
      `SET upload:ticket:<jti> 1 EX <remaining> NX` — the movieId check comes first on purpose so a
      mismatch does not burn the ticket. `src/uploads/uploads.resolver.ts` exposes
      `createUploadTicket(movieId: Int!)`, user principals only, no `@AllowService()`. Write
      `onUploadCreate` in `src/uploads/uploads.service.ts` reading the bearer token via
      `req.headers.get('authorization')` — `@tus/server` v2.4 types `req` as a Fetch `Request`, not
      an Express one — throwing the shared `UploadHttpError` (`status_code`/`body`, the shape tus
      actually reads) with 401/403 per the spec's error table, but **do not pass it into the tus
      `Server` options yet**. Add `allowedHeaders: ['Authorization']`. Wire `AuthModule` +
      `RedisModule` into `uploads.module.ts`. Write
      `src/uploads/upload-tickets.service.spec.ts`. → T007
      *Done when:* `bin/npm api test -- upload-tickets` passes, covering: a fresh ticket accepted;
      the same `jti` rejected on replay; an expired token rejected; `typ !== 'upload'` rejected; a
      movieId mismatch rejected **without** spending the ticket (AC-12). `schema.gql` carries
      `createUploadTicket(movieId: Int!): UploadTicket!`.

- [ ] **T009** `[api]` Create `services/api/scripts/mint-service-token.ts` — reads `JWT_SECRET`
      from the environment and prints a signed `{sub: 'service:perceptor', typ: 'service'}` token
      with **no `exp`** to stdout, nothing else. Register `"token:service": "ts-node
      scripts/mint-service-token.ts"` in `package.json`. → T008
      *Done when:* `bin/npm api run token:service` prints a single JWT on stdout and nothing else,
      and decoding its payload shows `typ: 'service'` with no `exp` and no `jti`.

### Group 2 — Phase B: secrets and infrastructure

One task, and it blocks all of Group 3 — before it lands, "parallel" would mean each consumer
inventing its own environment variable name.

- [ ] **T010** `[orch]` Add `JWT_SECRET` and `SERVICE_TOKEN` to `.env.example` with placeholder
      values, an `openssl rand -hex 32` hint, and a note that rotating `JWT_SECRET` invalidates
      `SERVICE_TOKEN` and requires re-minting. In `docker-compose.yaml`: `JWT_SECRET` into the
      `api` environment block, `SERVICE_TOKEN` into `worker` and `torrent`, **and no others**
      (NFR-3). In `bin/install`, generate both in the right order — `JWT_SECRET` written to `.env`
      *before* `docker compose up` (line ~79), because without it `api` will not boot; then, once
      `api` is healthy, `SERVICE_TOKEN` from `bin/npm api run token:service`. Handle the
      "reuse the existing `.env`" branch too: `set_env_var` only substitutes keys that already
      exist, so a pre-existing `.env` needs an append fallback. → T009
      *Done when:* a fresh `bin/install` on a clean checkout produces a `.env` with both variables
      populated and finishes without manual intervention; `docker compose config | grep -c
      SERVICE_TOKEN` shows it reaching exactly `worker` and `torrent`, and `JWT_SECRET` exactly
      `api`.

### Group 3 — Phase B: the consumers start sending credentials

Three independent tracks, all `[P]` with each other: the worker, the AutoRun script, and the `web`
chain (which has internal ordering of its own). Everything here is a no-op in production terms —
the API still accepts anonymous requests until Group 4 — so each task is verifiable on its own.

- [ ] **T011** `[worker] [P]` In `src/api/graphql-client.ts`: read `process.env.SERVICE_TOKEN`
      with the same fail-fast shape as the existing `INTERNAL_GRAPHQL_URL` check (throw at call
      time rather than sending an anonymous request), send `Authorization: Bearer ${token}`, add a
      `res.ok` check as an independent second net, and guard the non-JSON error body so a 401 HTML
      page does not surface as an opaque `SyntaxError` from `res.json()`. **Leave the existing
      `json.errors` throw exactly as it is** — it is already correct and is what makes an auth
      failure fail a job loudly. No call site changes; all 8 operations funnel through this one
      function. Write `src/api/graphql-client.spec.ts`. → T010
      *Done when:* `bin/npm worker test -- graphql-client` passes, covering: a 401 body containing
      `errors` throws; an absent `SERVICE_TOKEN` throws before any request is sent; a non-2xx
      non-JSON response throws a legible error. `bin/cli worker npx --no tsc --noEmit` stays clean.

- [ ] **T012** `[orch] [P]` Rewrite the request in
      `services/torrent/commands/on-torrent-completed.sh`: require `SERVICE_TOKEN` (under
      `set -u`, via `${SERVICE_TOKEN:-}`) and exit non-zero with a message on stderr if empty; send
      `Authorization: Bearer`; capture body and status with `-w $'\n%{http_code}'`; exit non-zero
      on a non-2xx status **and** on a body containing `"errors"`. The body check is the
      load-bearing one — Apollo answers **HTTP 200** with an `errors` array when a guard throws, so
      a `--fail` or status-only implementation would look hardened and still exit `0` on a 401.
      → T010
      *Done when:* running the script inside the `torrent` container with `SERVICE_TOKEN` blanked
      exits **non-zero** and says why on stderr (AC-10); running it with a valid token against a
      real infoHash exits `0` and prints the API's response.

- [ ] **T013** `[web] [P]` Rename `CONFIG.authTtoken` → `CONFIG.authCookie` in
      `src/lib/config.ts`, keeping the value `"auth_token"` so no already-issued cookie needs a
      name migration, and update the reader in `src/proxy.ts`. → T010
      *Done when:* `grep -rn "authTtoken" services/web/src` returns nothing and
      `bin/cli web npx --no tsc --noEmit` still reports 12 errors, none of them in these two files.

- [ ] **T014** `[web]` In `src/lib/graphql-client.ts`: read `cookies()` inside `fetchGraphQL` and
      forward `Authorization: Bearer <token>` when one exists, tolerating its absence so `login`
      still works; move the `...options` spread **ahead** of `method`/`headers`/`body` (it is
      currently spread last and silently overrides all three); delete both `console.log` calls —
      one of them prints the whole request body, which writes every login password in plaintext to
      the `web` container log (REQ-7); and guard a non-JSON error response. Create
      `src/lib/auth-session.ts` exporting `redirectIfUnauthenticated(errors)`, which matches
      `No autenticado` / `Tu sesión expiró, iniciá sesión de nuevo`, deletes the cookie and calls
      `redirect('/signin')`. → T013
      *Done when:* `bin/cli web npx --no tsc --noEmit` still reports 12 errors, and
      `grep -n "console.log" services/web/src/lib/graphql-client.ts` returns nothing.

- [ ] **T015** `[web]` Call `redirectIfUnauthenticated(errors)` immediately after each of the 11
      `await fetchGraphQL(...)` sites — `src/actions/movies.ts` (4), `settings.ts` (2),
      `indexer.ts` (2), `imports.ts` (1), `media-roots.ts` (1), `media-server.ts` (1) — at the same
      nesting level as the existing `errors` check and **never inside a `try`**: Next's `redirect()`
      works by throwing, and a surrounding `catch` would convert the redirect into a generic inline
      error. `loginAction` does not get one; a failed login is not an expired session. → T014
      *Done when:* `grep -c redirectIfUnauthenticated services/web/src/actions/*.ts` totals 11,
      `bin/cli web npx --no tsc --noEmit` still reports 12 errors, and — as the regression this
      task is most likely to cause — signing in with a wrong password still renders
      `Credenciales inválidas` inline with no redirect and no stack trace (AC-6). That message must
      not be matched by `redirectIfUnauthenticated`: a bad password is not an expired session.

- [ ] **T016** `[web]` Wire "keep me logged in" end to end: add an optional `name?: string` prop to
      `src/components/form/input/Checkbox.tsx` forwarded to the underlying `<input>`; render
      `<Checkbox name="rememberMe" …>` in `src/components/auth/SignInForm.tsx` and delete its two
      stray `console.log`s; in `loginAction`, read `formData.get('rememberMe') === 'on'`, send it
      in `LoginInput`, and set the cookie's `maxAge` to 30 days when checked while omitting
      **both** `maxAge` and `expires` when unchecked, so it becomes a real session cookie.
      → T007, T014
      *Done when:* signing in with the box checked shows a cookie expiring ~30 days out in
      devtools; unchecked, it shows `Session` (AC-4).

- [ ] **T017** `[web]` Add `logoutAction` to `src/actions/auth.ts`: call the `logout` mutation
      best-effort (swallow its errors — a failed no-op must not block signing out), **then** delete
      the cookie, **then** `redirect('/signin')`; the order matters because the mutation needs the
      cookie the deletion removes. Replace the dead `<Link href="/signin">` sign-out in
      `src/components/header/UserDropdown.tsx` with
      `<form action={logoutAction}><button type="submit">…</button></form>`. → T007, T014
      *Done when:* signing out lands on `/signin` and reloading a protected page stays there
      instead of bouncing back to `/dashboard` (AC-5, browser half — the replayed-cookie half is
      the session check from T003/T004 and is confirmed in T022).

- [ ] **T018** `[web]` Consume `me`. Add `getCurrentUser()` to `src/actions/auth.ts` wrapping the
      `me { id name username }` query. Extract the current body of `src/app/(dashboard)/layout.tsx`
      into a new `"use client"` `src/layout/AdminShell.tsx` taking `user` and `children` as props;
      the layout itself becomes a **server** component calling `getCurrentUser()`. Forward `user`
      through `src/layout/AppHeader.tsx` into `src/components/header/UserDropdown.tsx`, replacing
      the hardcoded TailAdmin placeholder name and email with the real values. → T007, T014
      *Done when:* `/dashboard` renders the library and the signed-in user's real name and
      username in the header dropdown (AC-3), and `grep -rn "Musharof" services/web/src` returns
      nothing.

- [ ] **T019** `[web]` Create `src/actions/uploads.ts` with `createUploadTicketAction(movieId)`.
      Make `handleFileChange` in `src/components/import/importFileModal.tsx` async: mint a ticket
      first, then construct `tus.Upload` with `headers: { Authorization: 'Bearer ' + ticket.token }`
      — a header, not tus metadata, because tus persists metadata to the sidecar on disk and echoes
      it back on `HEAD`. A mint failure sets the inline error and the upload never starts. Leave the
      pause/resume mechanics alone: `abort()` without `true` keeps `upload.url`, so `start()`
      resumes with HEAD+PATCH and never issues a second POST. → T008, T014
      *Done when:* `bin/cli web npx --no tsc --noEmit` still reports 12 errors, and a real upload
      started from the UI succeeds with the guard still off.

### Group 4 — Phase C: the flip

Two lines, and the entire breaking change. Reviewable at a glance and trivially revertible if the
pipeline check below fails.

- [ ] **T020** `[api]` Register `{ provide: APP_GUARD, useClass: JwtAuthGuard }` in
      `src/app.module.ts` and pass `onUploadCreate` into the tus `Server` options in
      `src/uploads/uploads.service.ts`. → T011, T012, T015, T016, T017, T018, T019
      *Done when:* an unauthenticated `POST /graphql` for `{ users { id } }` returns
      `No autenticado` with no data, and the same holds for a movies query, a settings mutation and
      `encodeStarted` (AC-1); the same request with a valid bearer token returns data (AC-2); a
      `POST /uploads` carrying no ticket is rejected with `401` and leaves no file under the
      downloads root (AC-11); all nine `@AllowService()` operations answer with `SERVICE_TOKEN`
      while `users` and `me` reject it (REQ-5, both directions); and `docker compose ps` shows
      `api` still `healthy` — `GET /graphql` with no query never reaches a resolver, so the
      healthcheck must keep passing.

### Group 5 — verification and docs

- [ ] **T021** `[docs]` Update the documentation the feature invalidates: the root `CLAUDE.md`
      environment-variable list (both new secrets) and its "Current state" error counts;
      `services/api/CLAUDE.md`, whose `auth/` module-map bullet still describes `GqlAuthGuard` and
      must describe `APP_GUARD` + `@Public()` + `@AllowService()` + the service principal; and
      `docs/spec/graphql-contract.md`, recording that both clients now send `Authorization` and the
      `AUTH_COOKIE_NAME` ↔ `CONFIG.authCookie` pairing as a cross-runtime boundary fact.
      `services/web/CLAUDE.md`'s Auth section was already rewritten ahead of this feature, because
      it actively instructed readers to preserve the `authTtoken` typo that REQ-2 removes — verify
      it matches what shipped rather than rewriting it. → T020
      *Done when:* `grep -rn "GqlAuthGuard\|authTtoken" services/*/CLAUDE.md CLAUDE.md docs/`
      returns nothing outside this feature's own historical notes.

- [ ] **T022** `[docs]` Walk all thirteen acceptance criteria in `spec.md`, ticking each box only
      after observing it hold — including the ones no unit test reaches: AC-9 (a full magnet →
      download → scan → encode run with the guard live, with no auth error in
      `docker compose logs worker` and the `ProcessJob` reaching a terminal state), AC-13 (a real
      upload paused and resumed, confirming in the network tab the **absence** of a second
      `POST /uploads`), AC-4 (both checkbox states in a fresh browser profile with session restore
      disabled, or the session-cookie case will appear to fail through no fault of the code), and
      AC-7 (`docker compose logs web | grep -iE 'password|Bearer|access_token'` empty). Then flip
      `status: Implemented` on `spec.md`, `plan.md` and all three `<svc>/plan.md`, and
      `status: Done` here. → T021
      *Done when:* every AC box in `spec.md` is ticked and every status line is flipped.

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty
entry is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.

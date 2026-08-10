---
title: Login and the Authentication Boundary — api slice
service: api
last_updated: 2026-08-10
status: Implemented
---

# PLAN: Login and the Authentication Boundary — `api` (`api/plan.md`)

## Scope

This slice owns the entire auth boundary: the global guard, the dual-carrier JWT strategy, service
principals, session-backed logout/revocation, `me`, and the upload ticket mint+verify path. It does
NOT touch `services/web` or `services/worker` — those get their own plans — and does not add
`isAdmin` or any role concept (that's `003-auth-user-management`).

Writes confined to `services/api/`.

## Files

| File | New/Mod | What changes |
| :-- | :-- | :-- |
| `src/auth/auth.constants.ts` | New | `AUTH_COOKIE_NAME = 'auth_token'`, `SESSION_TTL = '12h'`, `REMEMBER_ME_TTL = '30d'`, `UPLOAD_TICKET_TTL_SECONDS = 60`, `getJwtSecret()`, `assertAuthEnv()` |
| `src/auth/auth.types.ts` | New | `AuthPrincipal` union (`{type:'user', id, username}` \| `{type:'service', name}`), `JwtPayload` variants, `toPrincipal(payload)` |
| `src/auth/auth.types.spec.ts` | New | See Tests |
| `src/auth/session.service.ts` | New | `create(userId, ttl) -> jti`, `exists(jti)`, `revoke(jti)` over `RedisService`, keys `session:<jti>` |
| `src/auth/session.service.spec.ts` | New | See Tests |
| `src/auth/decorators/public.decorator.ts` | New | `IS_PUBLIC_KEY` + `@Public()` |
| `src/auth/decorators/allow-service.decorator.ts` | New | `ALLOW_SERVICE_KEY` + `@AllowService()` |
| `src/auth/guards/jwt-auth.guard.ts` | New | `JwtAuthGuard extends AuthGuard('jwt')`: `canActivate` (Reflector checks, non-GraphQL short-circuit), `getRequest` (gql vs http aware), `handleRequest` (maps passport-jwt errors to the spec's message table) |
| `src/auth/guards/gql-auth.guard.ts` | Delete | Superseded by `JwtAuthGuard`; only referenced from `auth.resolver.ts` |
| `src/main.ts` | Mod | `assertAuthEnv()` as the first statement of `bootstrap()` |
| `src/app.module.ts` | Mod | `{ provide: APP_GUARD, useClass: JwtAuthGuard }` — Phase C only |
| `src/auth/auth.module.ts` | Mod | `JwtModule.registerAsync({ useFactory: () => ({ secret: getJwtSecret() }) })`, no `signOptions`; import `RedisModule`; `exports: [JwtModule]` |
| `src/auth/auth.service.ts` | Mod | `login(username, pass, rememberMe)` mints `jti` via `SessionService.create`, signs with per-call `expiresIn`; `logout(jti)` calls `SessionService.revoke`; new `getProfile(userId)` via `PrismaService` |
| `src/auth/auth.resolver.ts` | Mod | `@Public()` on `login`; `logout` guarded, revokes the caller's session, no `clearCookie`; `me` returns `User!` via `getProfile` |
| `src/auth/strategies/jwt.strategy.ts` | Mod | `jwtFromRequest: ExtractJwt.fromExtractors([bearer, cookie])`; `secretOrKey: getJwtSecret()`; `validate` becomes async, calls `toPrincipal`, and for user principals checks `SessionService.exists(jti)` |
| `src/auth/decorators/current-user.decorator.ts` | Mod | Typed to return `AuthPrincipal`; gql/http context aware like the guard |
| `src/auth/dto/login.input.ts` | Mod | `@Field(() => Boolean, { defaultValue: false }) rememberMe: boolean` |
| `src/auth/test/jwt.strategy.spec.ts` | New | See Tests (the old `auth/test/` directory was deleted before this feature started) |
| `src/uploads/entities/upload-ticket.entity.ts` | New | `@ObjectType() UploadTicket { token: String!, expiresAt: DateTime! }` — `DateTime` scalar already registered |
| `src/uploads/upload-tickets.service.ts` | New | `mint(userId, movieId)` signs `{sub, movieId, typ:'upload', jti}` exp 60s; `verifyAndSpend(token, movieId)` checks `typ`, movieId match, then atomic `SET upload:ticket:<jti> 1 EX <ttl-remaining> NX` |
| `src/uploads/upload-tickets.service.spec.ts` | New | See Tests |
| `src/uploads/uploads.resolver.ts` | New | `createUploadTicket(movieId: Int!): UploadTicket!` — user principals only, no `@AllowService()` |
| `src/uploads/uploads.service.ts` | Mod | Add `onUploadCreate` to the tus `Server` options (wired in Phase C only); add `allowedHeaders: ['Authorization']`; extract `UploadFinishError` into a shared `UploadHttpError` used by both hooks |
| `src/uploads/uploads.module.ts` | Mod | Import `AuthModule` (for `JwtService`) + `RedisModule`; register `UploadsResolver` + `UploadTicketsService` |
| `src/process-jobs/process-jobs.resolver.ts` | Mod | `@AllowService()` on `processJob`, `encodeStarted`, `encodeProgress`, `encodeCompleted`, `encodeFailed`, `downloadRemove` |
| `src/media-sources/media-sources.resolver.ts` | Mod | `@AllowService()` on `mediaSource`, `sourceScanned` |
| `src/downloads/downloads.resolver.ts` | Mod | `@AllowService()` on `torrentCompleted` |
| `scripts/mint-service-token.ts` | New | Reads `JWT_SECRET` from env, prints a signed `{sub:'service:perceptor', typ:'service'}` token (no `exp`) to stdout |
| `package.json` | Mod | `"token:service": "ts-node scripts/mint-service-token.ts"` |
| `src/schema.gql` | Regenerated | Article IV artifact — never hand-edited; diff against the frozen delta after Phase A |

## Existing code to reuse

- `src/auth/strategies/jwt.strategy.ts` — extend, don't replace: keep the class, swap the extractor
  list and secret source, retype `validate`.
- `src/redis/redis.service.ts` — an `ioredis` instance, already exported by `RedisModule`. Becomes
  the session store and the upload-ticket spend store; no new infrastructure.
- `src/uploads/uploads.service.ts`'s `UploadFinishError` pattern — the `status_code`/`body` shape
  tus reads off a thrown error. `onUploadCreate` throws the same shape.
- `src/prisma/prisma.service.ts` — already injected into `AuthService`, used for the new
  `getProfile` lookup. Do not import `UsersService`; that module belongs to `003`.

## Steps

1. `src/auth/auth.constants.ts` — secret getter, TTL constants, boot assertion. Everything else in
   this slice imports from it.
2. `src/auth/auth.types.ts` + `auth.types.spec.ts` — the `AuthPrincipal` union and `toPrincipal()`.
   Pure, testable, the security hinge.
3. `src/auth/session.service.ts` + `session.service.spec.ts` — Redis-backed session create/exists/
   revoke.
4. `src/auth/strategies/jwt.strategy.ts` — dual extractor (bearer + cookie), deduped secret,
   `toPrincipal`, session check for user principals.
5. `src/auth/decorators/public.decorator.ts`, `src/auth/decorators/allow-service.decorator.ts`,
   `src/auth/guards/jwt-auth.guard.ts` (class authored, not registered yet); delete
   `src/auth/guards/gql-auth.guard.ts`.
6. Apply `@Public()` to `login` in `auth.resolver.ts`; apply `@AllowService()` to the nine
   machine-reachable operations (see Contract obligations).
7. `me: User!`, guarded `logout` that revokes the session, `LoginInput.rememberMe`, TTL wiring in
   `auth.service.ts`. Diff the regenerated `schema.gql` against the frozen delta.
8. Upload tickets: `upload-ticket.entity.ts`, `upload-tickets.service.ts` +
   `upload-tickets.service.spec.ts`, `uploads.resolver.ts`. `onUploadCreate` is written into
   `uploads.service.ts` but not yet passed into the tus `Server` options.
9. `scripts/mint-service-token.ts` + the `token:service` npm script.

## Contract obligations

Produce exactly the SDL and error table in `../spec.md` § GraphQL Contract Delta. The delta is
read-only. If it looks wrong from inside this slice, stop and report — do not adjust it.

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

| Change | Kind | Notes |
| :-- | :-- | :-- |
| `me: String!` → `me: User!` | Breaking | Safe: no consumer exists today in `web` or `worker` |
| `LoginInput.rememberMe` | Additive, defaulted | Existing callers keep compiling |
| `createUploadTicket` + `UploadTicket` | Additive | New surface for REQ-11 |
| `logout: Boolean!` | Unchanged shape | Behavior changes: revokes a Redis session instead of clearing an unreachable cookie |

Operation-group before/after:

| Operation group | Before | After |
| :-- | :-- | :-- |
| `login` | Public | Public — the only one |
| `me`, `logout` | `me` guarded, `logout` open | Guarded |
| `users`, `user`, `createUser`, `updateUser`, `removeUser` | Open | Guarded (admin gate arrives in `003`) |
| Movies, media sources, settings, media-roots, media-server, indexer | Open | Guarded |
| `processJob`, `mediaSource`, `sourceScanned`, `encodeStarted`, `encodeProgress`, `encodeCompleted`, `encodeFailed`, `downloadRemove` — the worker's eight | Open | Guarded — reachable with the machine credential |
| `torrentCompleted` — qBittorrent's, not the worker's | Open | Guarded — reachable with the machine credential |
| `POST/PATCH/HEAD /uploads` (REST) | Open | Upload creation requires a ticket |

## Tests

| File | Defends against |
| :-- | :-- |
| `src/auth/auth.types.spec.ts` | `toPrincipal` mislabeling a service payload as a user (or vice versa) — the request would succeed with the wrong principal attached, making `users` readable with a leaked machine token. Pure function, no Nest, no network |
| `src/auth/session.service.spec.ts` | A session store that doesn't actually revoke — logout "succeeds" in the UI while the old cookie still authenticates via `curl`. This is the whole of AC-5 |
| `src/uploads/upload-tickets.service.spec.ts` | Ticket replay via a non-atomic spend check (wrong Redis argument order, GET-then-SET instead of SET NX) — passes a single-request test by accident and fails under concurrency. Cover: fresh ticket accepted; same `jti` twice rejected; expired token rejected; `typ !== 'upload'` rejected; movieId mismatch rejected without spending the ticket |
| `src/auth/test/jwt.strategy.spec.ts` | Wrong-carrier extraction (bearer ignored, or cookie preferred over an explicit header) and a service principal incorrectly subjected to the session check |

Not owed: the guard itself (fails loudly — wrong decisions are a visible 401 or a visible open
endpoint, covered by AC-1/AC-2 as live checks) and the resolvers (pure wiring).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
```

Plus: `bin/cli api grep -E 'me:|createUploadTicket|rememberMe' -A3 src/schema.gql` matches the
frozen delta.

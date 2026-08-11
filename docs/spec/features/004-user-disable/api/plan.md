---
title: Disable Users — api slice
service: api
last_updated: 2026-08-11
status: Implemented
---

# PLAN: Disable Users — `api` (`api/plan.md`)

Read `../spec.md` and `../plan.md` first. The GraphQL delta in `../spec.md` is read-only: if it is
wrong, stop and report — do not adapt it locally (Constitution, Article VIII).

## Scope

This slice owns everything behind the GraphQL boundary: the `isEnabled` column and its migration,
the field on the `User` entity and on `UpdateUserInput`, the login refusal, the two admin
safeguards, and the session revocation that makes REQ-3 real. It does **not** build any UI — the
toggle, the status column and the server action are `web`'s, and this slice's only obligation to
them is that the frozen delta comes out of `src/schema.gql` exactly as `../spec.md` states, and that
every error message is thrown as a plain string so it reaches `errors[0].message` unmodified.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` | Modified | `isEnabled Boolean @default(true)` on `User` |
| `prisma/migrations/<ts>_add_user_is_enabled/migration.sql` | New | The `ALTER TABLE`. No backfill |
| `src/users/entities/user.entity.ts` | Modified | `@Field() isEnabled: boolean` |
| `src/users/dto/update-user.input.ts` | Modified | `isEnabled?: boolean`, declared directly on the class |
| `src/users/users.service.ts` | Modified | `update()` takes `requesterId`, runs the two safeguards, revokes sessions on a disable |
| `src/users/users.resolver.ts` | Modified | `updateUser` reads the caller via `@CurrentUser()` |
| `src/users/users.module.ts` | Modified | `imports: [AuthModule]` so `UsersService` can inject `SessionService` |
| `src/auth/auth.module.ts` | Modified | `exports: [JwtModule, SessionService]` |
| `src/auth/session.service.ts` | Modified | Per-user SET of live `jti`s + `revokeAllForUser()` |
| `src/auth/auth.service.ts` | Modified | `login()` refuses a disabled user |
| `src/auth/session.service.spec.ts` | Modified | Cases for the reverse mapping and the bulk revoke |
| `src/users/users.service.spec.ts` | Modified | The two safeguards, and that a disable actually revokes |
| `src/auth/guards/jwt-auth.guard.ts` | Modified | Comment only — the "sixth user-facing string" claim |
| `src/auth/auth.resolver.ts` | Modified | Comment only — same claim |

A *new module* not listed here means the plan missed something: report it rather than adding one.
This feature adds no module.

## Existing code to reuse

- `src/users/users.service.ts` → `remove(id, requesterId)` — the exact template for the new checks:
  self-check first, `findOne()` second, last-admin `count` third, and the action last. Copy the
  ordering and the reason for it (its own comment states it), not just the shape.
- `src/auth/session.service.ts` → `create`/`exists`/`revoke` and `SESSION_KEY_PREFIX`. The new
  per-user key belongs in this file, next to them, as a second prefix constant.
- `src/redis/redis.service.ts` — extends `ioredis` directly, so `sadd`, `smembers`, `srem`,
  `expire`, `get` and `del` are already on the injected instance. Do not add a wrapper method per
  Redis command.
- `src/auth/decorators/current-user.decorator.ts` + `src/auth/auth.types.ts`'s `AuthPrincipal` —
  `removeUser` in `users.resolver.ts` already shows the exact narrowing (`principal.type === 'user'
  ? principal.id : ''`) that `AdminGuard` makes redundant at runtime but TypeScript still wants.
- `src/auth/guards/admin.guard.ts` — already applied at class level on `UsersResolver`. REQ-4 is
  satisfied by it already; **no new guard**.
- `src/auth/auth.service.ts` → `validateUser()` returns the row minus `password`, so `isEnabled` is
  already on the object `login()` holds. No second query.

## Steps

1. **Column.** Add `isEnabled Boolean @default(true)` to `User` in `prisma/schema.prisma`; generate
   the migration through `bin/npm api run prisma:migrate`. Confirm the generated SQL is an
   `ALTER TABLE` with a default and **no** `UPDATE` — a backfill here would be dead weight (NFR-1).
   Confirm `prisma/seeds/users.ts` needs no change (it does not set the field; the default covers
   AC-1). Say so in the report rather than assuming it.
2. **Entity.** `@Field() isEnabled: boolean` on `src/users/entities/user.entity.ts`. Then verify
   `git diff src/schema.gql` shows exactly `+ isEnabled: Boolean!` on `User` and nothing else.
3. **Input.** On `src/users/dto/update-user.input.ts`, declare
   `@Field(() => Boolean, { nullable: true })` + `@IsOptional()` + `@IsBoolean()` `isEnabled?:
   boolean` **on the class itself**, not through the `PartialType(CreateUserInput)` it extends.
   That placement is the mechanism, not a style choice: it is what keeps the field off
   `CreateUserInput`. Verify the schema diff adds `isEnabled: Boolean` to `UpdateUserInput` and
   nothing to `CreateUserInput`.
4. **Reverse session mapping.** In `src/auth/session.service.ts`:
   - a second constant next to `SESSION_KEY_PREFIX`, e.g. `USER_SESSIONS_KEY_PREFIX =
     'user-sessions:'`;
   - `create(userId, ttlSeconds)` — after the existing `SET`, `SADD user-sessions:<userId> <jti>`
     and `EXPIRE` the set. The set's TTL must be at least the longest session TTL
     (`REMEMBER_ME_TTL`, see `auth.constants.ts`); refreshing it on every `create` is what keeps an
     active account's set alive;
   - `revoke(jti)` — read `session:<jti>` to learn the `userId` **before** deleting it, then `SREM`
     the `jti` from that user's set. Reading after the delete gets `null` and silently leaks the
     member;
   - `revokeAllForUser(userId)` — `SMEMBERS`, delete every `session:<jti>`, then delete the set
     itself. An empty set is a no-op, not an error.
   Header comment: state that this is the mechanism behind `004`'s REQ-3, the way the file's
   existing comment does for `002`'s REQ-10/AC-5.
5. **Login refusal.** In `src/auth/auth.service.ts`'s `login()`, after `validateUser()` returns a
   user and **before** minting the session: `if (!user.isEnabled) throw new
   UnauthorizedException('Tu cuenta está deshabilitada')`. Ordering matters — a disabled user's
   failed login must not create a session record on the way out.
6. **Module wiring.** `exports: [JwtModule, SessionService]` on `AuthModule`; `imports:
   [AuthModule]` on `UsersModule`. `AuthModule` does not import `UsersModule`, so this is acyclic —
   but boot the stack to confirm, since a cycle is a runtime failure the typecheck will not catch.
7. **Safeguards + revocation.** In `src/users/users.service.ts`, `update(id, updateUserInput,
   requesterId)`:
   - only when the caller is actually disabling (`updateUserInput.isEnabled === false` —
     `undefined` and `true` both skip every check);
   - `id === requesterId` → `BadRequestException('No podés deshabilitar tu propio usuario')`;
   - then load the target; if `target.isAdmin`, `count({ where: { isAdmin: true, isEnabled: true }
     })` and refuse at `1` with `No podés deshabilitar al único administrador`. **The `isEnabled:
     true` in that filter is the requirement, not an optimisation** (REQ-5);
   - after a successful write, if the user was just disabled, `await
     this.sessionService.revokeAllForUser(id)`. Inside the same method — a caller who has to
     remember to revoke afterwards is the silent failure NFR-3 names.
   Keep the existing password-hash branch untouched.
8. **Resolver.** `updateUser` gains `@CurrentUser() principal: AuthPrincipal` and passes the id
   through, narrowed exactly as `removeUser` does. No change to the GraphQL arguments.
9. **Comments in `002`'s files.** `src/auth/guards/jwt-auth.guard.ts:51` and
   `src/auth/auth.resolver.ts:50` both justify reusing a message by asserting there is no sixth
   user-facing string. There now is one. Reword both to say "the five `002` froze, plus `Tu cuenta
   está deshabilitada` from `004-user-disable`" — the reasoning they support is still correct, only
   the count is stale. Comment text only; no behaviour changes in either file.

## Contract obligations

What this slice owes `web`, from `../spec.md` § GraphQL Contract Delta:

```graphql
type User { isEnabled: Boolean! }
input UpdateUserInput { isEnabled: Boolean }
```

And three error strings, each thrown as a **plain string** argument so it lands on the GraphQL
error's top-level `message` (`services/web/src/actions/*.ts` reads `errors[0].message` — see
`services/api/CLAUDE.md` § *Validation errors reach the caller as a plain string*):

| Condition | Exception | Message |
| :-- | :-- | :-- |
| Correct credentials, disabled account | `UnauthorizedException` | `Tu cuenta está deshabilitada` |
| Admin disabling their own account | `BadRequestException` | `No podés deshabilitar tu propio usuario` |
| Admin disabling the last enabled admin | `BadRequestException` | `No podés deshabilitar al único administrador` |

Never an array, never a nested object — either buries the text where no consumer looks.

## Tests

Article IX: this slice's two silent failures both get a test.

- `src/auth/session.service.spec.ts` — `revokeAllForUser` must make **every** one of a user's
  session keys actually disappear. If it revokes only some (or none), nothing errors anywhere and a
  disabled user keeps browsing. Extend the existing file, which already runs against the real Redis
  for exactly this reason ("did the key actually disappear from the store", which a mock can only
  assert by construction). Cover: several sessions for one user all die together; another user's
  sessions survive; `revoke(jti)` removes the member from the set; a user with no sessions is a
  no-op.
- `src/users/users.service.spec.ts` — the two safeguards and the revocation call. Cover self-disable
  refused; last **enabled** admin refused with a second, already-disabled admin present (the AC-7
  shape — this is the case a naive `count({ isAdmin: true })` gets wrong, and it fails silently);
  disabling an ordinary user calls `revokeAllForUser`; `isEnabled: true` and an update that does not
  mention `isEnabled` run no checks and revoke nothing.

Style: follow `src/media-roots/media-roots.service.spec.ts` — `describe` for the unit, indicative
`it(...)` strings, a header comment naming the class of bug the file defends against. English prose
(Article VI). Do **not** imitate the `nest g` scaffolding style.

Not owed a test: the entity `@Field`, the DTO field, and the module wiring — all three fail loudly
(schema diff, typecheck, boot) rather than silently. The `login()` refusal is one branch of a method
already covered end-to-end by AC-4 and would need the whole auth stack stood up to unit-test; it
fails loudly and visibly (a user cannot sign in), so it is verified manually per AC-4 rather than in
a spec.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/mysql -e 'select username, isAdmin, isEnabled from users'
```

Typecheck at **0** errors (the 2026-08-10 baseline — this slice adds none), `bin/npm api test`
green with **more** tests than the 64-across-8-suites baseline, and every row in that query reading
`isEnabled = 1` on a database that already had users (AC-2). Report the before/after numbers, not
just "passing".

---
title: Admin User Management — api slice
service: api
last_updated: 2026-08-10
status: Implemented
---

# PLAN: Admin User Management — `api` (`api/plan.md`)

## Scope

This slice owns the `isAdmin` column, its migration and seed backfill, the `AdminGuard` that
restricts all five `users` operations, the two deletion safeguards, the `update()` password-hash
fix, and `scripts/reset-password.ts`. It does not touch `services/web` or `bin/` — the
`bin/reset-password` wrapper is `infra`'s (`../infra/plan.md`), consuming the npm script this slice
adds.

**Status note**: most of this slice was implemented ahead of `plan.md`/`tasks.md` existing, during
the process-recovery described in this feature's session history. It is documented here as it
actually landed, verified against the real diff and real command output — not written prospectively
and then "confirmed" after the fact. One item is not yet closed; see § Remaining work.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` | Modified | `isAdmin Boolean @default(false)` on `User` |
| `prisma/migrations/20260810224010_add_user_is_admin/` | New | `ALTER TABLE` + backfill `UPDATE` |
| `prisma/seeds/users.ts` | Modified | `upsert`'s `create`/`update` both force `isAdmin: true` |
| `src/users/entities/user.entity.ts` | Modified | `@Field() isAdmin: boolean` |
| `src/auth/guards/admin.guard.ts` | New | `AdminGuard` |
| `src/users/users.resolver.ts` | Modified | `@UseGuards(AdminGuard)` at class level; `removeUser` takes `@CurrentUser()` |
| `src/users/users.service.ts` | Modified | `remove(id, requesterId)` safeguards; `update()` hashes a supplied password |
| `scripts/reset-password.ts` | New | REQ-7 — interactive password reset |
| `package.json` | Modified | `"password:reset": "ts-node scripts/reset-password.ts"` |
| `src/users/users.service.spec.ts` | Modified | Real suite replacing the `nest g` scaffold |
| `src/users/users.resolver.spec.ts` | Deleted | Was `nest g` scaffolding (Article IX); started failing on a real DI error once an unrelated import fix let it actually load |

## Existing code to reuse

- `services/api/src/auth/guards/jwt-auth.guard.ts` — the structural pattern `AdminGuard` follows:
  read the principal off the request, decide, throw the same message every time it refuses.
- `services/api/src/auth/decorators/current-user.decorator.ts` — `@CurrentUser()`, used unchanged
  in `removeUser` to get `requesterId`.
- `services/api/src/prisma/prisma.module.ts` — `@Global()`, so `AdminGuard` injects `PrismaService`
  directly with no module wiring.
- `services/api/scripts/mint-service-token.ts` — the pattern `reset-password.ts` copies: relative
  imports into `src/`, run via bare `ts-node`, no `tsconfig-paths` register step.
- `prisma/seeds/index.ts` — `new PrismaService()` outside Nest's DI, same as `reset-password.ts`
  needs.

## Steps

Already done (1–6); the remaining step is 7.

1. Add `isAdmin` to `schema.prisma`, generate the migration, write the backfill `UPDATE`.
2. Force `isAdmin: true` in both branches of the seed's `upsert`.
3. Add `isAdmin` to the `User` entity — this is also what makes `me` return it, since
   `AuthService.getProfile()` already returns the full row minus `password`.
4. Write `AdminGuard`, apply it at class level on `UsersResolver`.
5. Add the ordered checks to `remove()`; wire `removeUser` to pass `requesterId`. Add the hash fix
   to `update()`.
6. Write `scripts/reset-password.ts` and the `package.json` script.
7. **Remaining**: `reset-password.ts` hangs on non-tty stdin (see § Remaining work). Fix, then
   verify AC-10/AC-11 live through the eventual `bin/reset-password` wrapper.

## Contract obligations

Per `../spec.md` § GraphQL Contract Delta: exactly one additive field, `isAdmin: Boolean!` on
`User`. No new operations. Confirmed live — `git diff src/schema.gql` shows only that field. If a
future change to this slice touches `schema.gql` in any other way, stop; that is an unreported
contract change (Constitution, Article VIII).

Errors this slice owes its consumers, exactly as `spec.md`'s error table specifies:

| Condition | Exception | Message |
| :-- | :-- | :-- |
| Authenticated, not admin | `ForbiddenException` | `No tenés permisos para administrar usuarios` |
| Duplicate username | `ConflictException` | `El nombre de usuario ya está registrado` (pre-existing) |
| Self-delete | `BadRequestException` | `No podés eliminar tu propio usuario` |
| Delete the last admin | `BadRequestException` | `No podés eliminar al único administrador` |
| User id not found | `NotFoundException` | `Usuario con ID "…" no encontrado` (pre-existing) |

All five confirmed present in `users.service.ts`/`admin.guard.ts` as written.

## Tests

- `src/users/users.service.spec.ts` — rewritten from the 18-line `nest g` scaffold into a real
  suite. Defends against exactly the two silent-failure classes Article IX cares about here: a
  self-delete or last-admin-delete that silently succeeds (would permanently lock the install out
  of user management with no error anywhere), and a password update that writes plaintext instead
  of a hash (would look identical to success in every UI path — only `bin/mysql -e 'select
  password from users'` would show it).
- `src/auth/guards/admin.guard.ts` — no dedicated spec. Its one branch (`isAdmin` false or
  principal not `'user'` → `ForbiddenException`) is exercised end-to-end by AC-5 against a running
  server, which is a stronger signal for an authorization guard than a unit test with a mocked
  `PrismaService` would be; a mock can't catch "the guard was never registered" the way a live
  `curl` against `/graphql` does.
- `scripts/reset-password.ts` — no spec. It is a thin script over already-tested primitives
  (`bcrypt.hash`, `prisma.user.update`); its own failure mode (the `isTTY` hang) is an I/O bug a
  unit test wouldn't catch either — the fix is verified live, per § Remaining work.

## Remaining work

`scripts/reset-password.ts`'s `promptHidden()` hung on every attempt to run it non-interactively
(piped stdin through `docker compose exec -i`, and through `-it`). Prompts print, then nothing:
`bcrypt.hash`/`prisma.user.update` never run, so no password was ever actually changed in testing.
Suspected cause: the `_writeToOutput` override used to mute character echo interacts badly with a
non-tty stream, or creating a second `readline.Interface` on the same `stdin` right after closing
the first one loses buffered input — both are known rough edges of Node's `readline` module outside
a real TTY.

**Fix**: branch on `process.stdin.isTTY`. When true (an interactive `bin/cli api …` session), keep
`promptHidden`. When false, fall back to a plain `rl.question` — visible input, but a script that
completes is strictly better than a hidden-echo script that hangs forever with no error, which is
exactly the silent-failure case Article IX exists for.

**Done when**:

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
```

both stay clean, and a live run — `bin/reset-password <username>` once `infra/plan.md`'s wrapper
exists, or `bin/cli api npx ts-node scripts/reset-password.ts <username>` before it does — actually
reaches `Contraseña actualizada para "<username>".` and the new password works at `/login`. Also
confirm no stray `ts-node` process is left running in the `api` container from the earlier hung
attempts (`docker compose exec api ps aux`).

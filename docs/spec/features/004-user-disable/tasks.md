---
title: Disable Users — Tasks
last_updated: 2026-08-11
status: Done
---

# TASKS: Disable Users (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. This feature does not touch `worker` or `infra`. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**Baseline to beat**, measured 2026-08-10: `api` **0** typecheck errors / **64** tests passing
across 8 suites (this feature adds tests, so the count must go up); `web` **12** errors across the
same 5 pre-existing pre-GraphQL files listed in `services/web/CLAUDE.md`. Every agent reports the
number before and after to prove it added nothing.

## Tasks

### Group 1 — contract and schema (`api`)

Sequential — each depends on what the one before it introduces. Nothing outside `api` can start
until this group is done and `src/schema.gql` carries the frozen delta.

- [x] **T001** `[api]` Add `isEnabled Boolean @default(true)` to `User` in `prisma/schema.prisma`
      and generate the migration `<ts>_add_user_is_enabled` through
      `bin/npm api run prisma:migrate`. No backfill (NFR-1). Confirm — and state in the report —
      whether `prisma/seeds/users.ts` needs any change (it should not: it never sets the field, so
      the column default covers AC-1).
      *Done when:* the generated `migration.sql` is a single `ALTER TABLE users ADD COLUMN
      isEnabled BOOLEAN NOT NULL DEFAULT true` with no `UPDATE`, and
      `bin/mysql -e 'select username, isEnabled from users'` shows every pre-existing row at `1`
      after the migration runs (AC-1, AC-2).
- [x] **T002** `[api]` Add `@Field() isEnabled: boolean` to `src/users/entities/user.entity.ts`.
      → T001
      *Done when:* `git diff src/schema.gql` shows exactly `+ isEnabled: Boolean!` on `User` and
      nothing else.
- [x] **T003** `[api]` Declare `@Field(() => Boolean, { nullable: true }) @IsOptional()
      @IsBoolean() isEnabled?: boolean` **directly on** `UpdateUserInput`
      (`src/users/dto/update-user.input.ts`), not through the `PartialType(CreateUserInput)` it
      extends — that placement is what keeps the field off `CreateUserInput` (`plan.md`
      § Contract Freeze). → T002
      *Done when:* `git diff src/schema.gql` adds `isEnabled: Boolean` to `UpdateUserInput` and
      **nothing** to `CreateUserInput`; `bin/cli api npx --no tsc --noEmit` still at 0 errors.

### Group 2 — behaviour (`api`)

The feature's actual work. T004 and T005 are independent of each other; T006 needs both.

- [x] **T004** `[api] [P]` In `src/auth/session.service.ts`, add the reverse mapping REQ-3 needs: a
      `USER_SESSIONS_KEY_PREFIX` constant next to `SESSION_KEY_PREFIX`; `create()` also does
      `SADD` + `EXPIRE` on `user-sessions:<userId>` (TTL at least `REMEMBER_ME_TTL`, refreshed on
      every create); `revoke(jti)` reads the `userId` **before** deleting `session:<jti>` so it can
      `SREM` the member; new `revokeAllForUser(userId)` does `SMEMBERS` → delete every
      `session:<jti>` → delete the set. Extend `session.service.spec.ts` against the real Redis, as
      that file already does: several sessions of one user all die together, another user's survive,
      `revoke` removes the set member, an empty set is a no-op. → T003
      *Done when:* `bin/npm api test` green with more tests than the 64 baseline, and the new
      revoke-all cases fail if `revokeAllForUser` is stubbed to a no-op (verify that once — a test
      that passes against a broken implementation is the silent failure NFR-3 names).
- [x] **T005** `[api] [P]` In `src/auth/auth.service.ts`'s `login()`, after `validateUser()` returns
      a user and **before** the session is minted, throw
      `new UnauthorizedException('Tu cuenta está deshabilitada')` when `!user.isEnabled`. Ordering
      matters: a refused login must not leave a session record behind. → T001
      *Done when:* a live `login` mutation with a disabled user's **correct** password returns
      exactly `Tu cuenta está deshabilitada` (not `Credenciales inválidas`), and `bin/mysql`
      confirms that user's row is the one that was disabled (AC-4).
- [x] **T006** `[api]` Wire `SessionService` into `users`: `exports: [JwtModule, SessionService]` on
      `AuthModule` (`src/auth/auth.module.ts`), `imports: [AuthModule]` on `UsersModule`
      (`src/users/users.module.ts`). Then in `src/users/users.service.ts`,
      `update(id, updateUserInput, requesterId)` — only when `updateUserInput.isEnabled === false` —
      refuses self-disable (`No podés deshabilitar tu propio usuario`), then refuses disabling the
      last admin counted as `{ isAdmin: true, isEnabled: true }`
      (`No podés deshabilitar al único administrador`), in that order, mirroring `remove()`; and
      after a successful write, calls `revokeAllForUser(id)` inside the same method. `updateUser` in
      `src/users/users.resolver.ts` passes `requesterId` via `@CurrentUser()`, narrowed exactly as
      `removeUser` does — no new GraphQL argument. Cover both safeguards and the revocation call in
      `src/users/users.service.spec.ts`, including the AC-7 shape (one enabled admin plus a second,
      already-disabled admin) and the no-op cases (`isEnabled: true`, or an update that never
      mentions `isEnabled`). → T004, T005
      *Done when:* `bin/cli api npx --no tsc --noEmit` at 0 and `bin/npm api test` green with the
      new cases; the stack boots (a module cycle is a runtime failure the typecheck will not catch);
      live, a disable returns the two refusal messages verbatim for AC-6 and AC-7.
- [x] **T007** `[api] [P]` Comment-only fix in `src/auth/guards/jwt-auth.guard.ts:51` and
      `src/auth/auth.resolver.ts:50`: both currently justify reusing a message by asserting there is
      no sixth user-facing string, which `T005` makes false. Reword to "the five `002` froze, plus
      `Tu cuenta está deshabilitada` from `004-user-disable`". The reasoning they support is still
      correct — only the count is stale. No behaviour change in either file. → T005
      *Done when:* `git diff` on both files touches comment lines only, and
      `bin/cli api npx --no tsc --noEmit` is unchanged.

### Group 3 — consumer (`web`)

Everything here depends on Group 1: `web` cannot select a field the schema does not have.

- [x] **T008** `[web]` Add `isEnabled: boolean` to `AdminUser` (`src/types/users.ts`); add
      `isEnabled` to `USERS_QUERY`'s selection set and add `UPDATE_USER_MUTATION` +
      `setUserEnabledAction` to `src/actions/users.ts`, copying `deleteUserAction`'s shape exactly
      (`redirectIfUnauthenticated` first, then `errors[0].message` passed through unmodified,
      `revalidatePath('/users')` on success). Send **only** `{ id, isEnabled }` — a partial input
      carrying `name`/`username` would let a status toggle silently rewrite fields nobody edited —
      and parse the boolean explicitly from the string `formData` carries
      (`formData.get('isEnabled') === 'true'`); a raw truthy check turns every disable into an
      enable with no error anywhere. → T003
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports the same 12 errors in the same 5
      pre-existing files, none in `actions/users.ts` or `types/users.ts`.
- [x] **T009** `[web]` In `src/components/users/UsersManager.tsx`, add an "Estado" column
      (`Habilitado`/`Deshabilitado` as the same pill the role cell uses) and a second
      `useActionState` form per row for the toggle: hidden inputs carrying `id` and the *target*
      state (`!user.isEnabled`), label `Deshabilitar`/`Habilitar` with a pending state, disabled on
      `isSelf` with the same `title` treatment the delete button already has. Errors render through
      the existing error `<tr>` and `ERROR_CLASS` — widen its `colSpan` for the new column. Never
      `alert()`. → T008
      *Done when:* signed in as admin, toggling a user off **and back on** updates the row with no
      page error (AC-3); the admin's own toggle is greyed out (AC-6, UI half); a disabled user's
      already-open session in a second browser is bounced to `/login` on its very next request
      (AC-5); re-enabling lets them sign in with their existing password (AC-8). Typecheck
      unchanged from baseline.
- [x] **T009b** `[web]` Not in the original plan — found while walking AC-5 live. `AdminLayout`
      (`src/app/(dashboard)/layout.tsx`, a Server Component) calls `getCurrentUser()` →
      `redirectIfUnauthenticated`, which tries `cookieStore.delete()` during render — illegal
      outside a Server Action/Route Handler in this Next version, so it threw a 500 instead of
      redirecting. Unreachable before this feature: a live session could previously only go stale
      by TTL expiry or explicit logout (both Server Actions). `004`'s revocation is the first thing
      that invalidates a session while it's actively being used, which is exactly what AC-5
      exercises. Fixed by adding `redirectToClearSession` (`src/lib/auth-session.ts`, redirect-only,
      safe in render) and a new Route Handler (`src/app/api/auth/clear-session/route.ts`) that does
      the actual cookie deletion; `getCurrentUser`, `getSettings`, `getMediaRoots`,
      `getMediaServerOptions` and `getMovieById` — every read function a Server Component awaits
      directly — now use it. `redirectIfUnauthenticated` itself is unchanged for its Server Action
      callers. → T009
      *Done when:* disabling a live session's user and then navigating that session to a protected
      route lands cleanly on `/login` (no 500, no redirect loop back to `/dashboard`) — verified
      live, both by the implementing agent and independently by the orchestrator in a real browser
      session.

### Group 4 — verification and docs

- [x] **T010** `[docs]` Update `docs/spec/graphql-contract.md` (the `isEnabled: Boolean!` field on
      `User`, the `isEnabled: Boolean` on `UpdateUserInput`, the sixth login error string, and the
      note that `updateUser` now reads its caller via `@CurrentUser()` like `removeUser`), plus
      `services/api/CLAUDE.md` (the `users/` and `auth/` bullets: the new column, the per-user
      session set, `revokeAllForUser`) and `services/web/CLAUDE.md` (its admin-user-management
      section). Also the root `CLAUDE.md:134-137` — the sentence describing the seeded administrator
      and `/users` gains the second lever this feature adds (an admin can disable a user instead of
      deleting them, and disabling kills their live sessions). The root pipeline table is **not**
      touched: no pipeline stage changed status. → T007, T009
- [x] **T011** `[docs]` Add one dated line to `docs/spec/features/002-auth-login/spec.md` pointing
      forward to `004-user-disable` as the feature that added a sixth user-facing string on the
      login boundary. A pointer only: `002`'s `status: Implemented`, its acceptance criteria and its
      own § Errors table stay exactly as they are — reopening a shipped spec to add a requirement it
      never had would erase what its ticked boxes currently attest to (`spec.md` § Errors).
      → T010
- [x] **T012** `[docs]` Walk every acceptance criterion in `spec.md` (AC-1…AC-8) live, tick each
      box, and set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`.
      AC-5 must be walked in a real second browser session, not signed off by reading code — it is
      the criterion this whole feature exists for. → T011

## Blocked

Nothing currently blocked.

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.

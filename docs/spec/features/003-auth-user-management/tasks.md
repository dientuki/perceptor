---
title: Admin User Management — Tasks
last_updated: 2026-08-10
status: Done
---

# TASKS: Admin User Management (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. This feature does not touch `worker`. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**Status note**: several tasks below are marked `[x]` already done. They were implemented during
this feature's own process-recovery — see `plan.md`'s status notes and each `<svc>/plan.md` — and
are recorded here with the real command output that verified them, not written prospectively.
Baseline to beat, measured 2026-08-10: `api` **0** typecheck errors / **64** tests passing across
8 suites, `web` **12** errors across the same 5 pre-existing pre-GraphQL files noted in
`services/web/CLAUDE.md`.

## Tasks

### Group 1 — Contract and schema (`api`)

Sequential — each depends on the column or guard the one before it introduces.

- [x] **T001** `[api]` Add `isAdmin Boolean @default(false)` to `User` in `prisma/schema.prisma`;
      generate migration `20260810224010_add_user_is_admin` with a backfill `UPDATE` marking the
      oldest user (by `createdAt`) as admin; force `isAdmin: true` in both branches of
      `prisma/seeds/users.ts`'s `upsert`.
      *Done when:* `bin/mysql -e 'select username, isAdmin from users'` shows the seeded admin with
      `isAdmin = 1` (confirmed live after `prisma migrate deploy`).
- [x] **T002** `[api]` Add `@Field() isAdmin: boolean` to `src/users/entities/user.entity.ts`.
      → T001
      *Done when:* `git diff src/schema.gql` shows exactly `+ isAdmin: Boolean!` on `User` and
      nothing else (confirmed — matches `spec.md`'s frozen delta).
- [x] **T003** `[api]` Create `src/auth/guards/admin.guard.ts` (`ForbiddenException` with
      `No tenés permisos para administrar usuarios` for a non-user principal or `isAdmin: false`,
      read fresh from the database, never from the JWT); apply `@UseGuards(AdminGuard)` at class
      level on `UsersResolver`. → T002
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean; a live GraphQL call to any of
      `users`/`user`/`createUser`/`updateUser`/`removeUser` with a non-admin's valid token returns
      that exact message (AC-5).
- [x] **T004** `[api]` In `src/users/users.service.ts`: `remove(id, requesterId)` refuses
      self-delete (`No podés eliminar tu propio usuario`) before the not-found check, and refuses
      deleting the last admin (`No podés eliminar al único administrador`) after it; `removeUser`
      in the resolver passes `requesterId` via `@CurrentUser()`. Also fix `update()` to
      `bcrypt.hash` a supplied `password` before writing, matching what `create()` already does.
      → T003
      *Done when:* `bin/npm api test` passes (`src/users/users.service.spec.ts`, rewritten from the
      `nest g` scaffold into a real suite covering both safeguards and the hash fix) — confirmed:
      8 suites / 64 tests passing.
- [x] **T005** `[api]` Fix `scripts/reset-password.ts`: `promptHidden()` hangs on non-tty stdin
      (verified — three attempts through `docker compose exec`, piped and `-it`, all hung after
      printing both prompts with no write ever reached). Branch on `process.stdin.isTTY`; fall back
      to a plain `rl.question` when false. → T001 (needs the `isAdmin`-aware schema only
      incidentally — this task is really independent of T002–T004, listed here because it's the
      same file/script as the rest of this group's `api` work)
      *Done when:* `bin/cli api npx --no tsc --noEmit` stays clean, and a live run —
      `bin/cli api npx ts-node scripts/reset-password.ts admin` — actually reaches
      `Contraseña actualizada para "admin".` (not just prints the prompts), and the new password
      works at `/login`. Confirm no stray `ts-node` process remains in the `api` container from the
      earlier hung attempts. Confirmed live, non-interactively — the actual bug was a second
      `rl.question()` losing the buffered second line on non-tty stdin, fixed with a shared
      async-iterator readline interface, not just the `isTTY` branch alone. `bin/npm api test`
      still 8/8 suites, 64/64 tests. Admin password restored to `.env`'s value after verification.

### Group 2 — Consumers (`web`, `infra`)

`[P]`-marked tasks in this group may run together once Group 1 is complete — the contract is
frozen and produced. T009 depends on T008, not just Group 1.

- [x] **T006** `[web] [P]` Remove the dead `Forgot password?` link from
      `src/components/auth/LoginForm.tsx`; narrow `src/proxy.ts`'s `AUTH_ROUTES` to `['/login']`.
      *Done when:* `/reset-password` 404s or redirects to `/login` (confirmed: 307 to
      `/login?redirect=%2Freset-password`); `/login`'s rendered HTML contains no "Forgot password"
      or "reset-password" string (AC-9, confirmed).
- [x] **T007** `[web] [P]` Add `isAdmin` to `CurrentUser`, `ME_QUERY` and `LOGIN_MUTATION`'s
      `user { … }` block in `src/actions/auth.ts`. → T002
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports the same 12 errors in the same 5
      pre-existing files, none in `actions/auth.ts` (confirmed).
- [x] **T008** `[web] [P]` Create `src/actions/users.ts` following `src/actions/settings.ts`'s
      shape: `getUsers()` (throws on error), `createUserAction`/`deleteUserAction`
      (`useActionState`-shaped, pass `errors[0].message` straight through so every message in
      `web/plan.md`'s contract-obligations table reaches the caller unmodified). → T004
      *Done when:* `bin/cli web npx --no tsc --noEmit` unchanged from baseline. Confirmed — 12
      errors, same 5 pre-existing files.
- [x] **T009** `[web]` Create `src/app/(dashboard)/users/page.tsx` (server component: `getCurrentUser()`
      + `getUsers()`, `notFound()` if `!user.isAdmin`) and
      `src/components/users/UsersManager.tsx` (client component: table with per-row delete,
      disabled on the caller's own row; create form via `useActionState`; every error rendered
      inline with `LoginForm.tsx`'s error class, never `alert()`). → T008
      *Done when:* signed in as admin, `/users` lists users and creating/deleting works without a
      page error (AC-3); creating a duplicate username / 2-char username / 5-char password shows
      each message inline (AC-6); the admin's own row cannot be deleted from the UI and the
      underlying attempt is still refused server-side (AC-7); deleting the sole admin is refused
      (AC-8); signed in as a freshly created non-admin, navigating to `/users` directly 404s (AC-4).
      AC-3, AC-4, AC-7 confirmed live. AC-4 required a real fix: the original `Promise.all([getCurrentUser(),
      getUsers()])` let `getUsers()` throw for a non-admin before the `isAdmin` gate ran, producing a
      500 instead of a 404 — rewritten to check `isAdmin` and call `notFound()` before ever calling
      `getUsers()`. AC-6 only half-confirmed: duplicate-username renders correctly; the two
      length-validation messages do not reach `errors[0].message` today (see new **T014** below —
      that is a pre-existing `ValidationPipe` formatting gap in `api`, not a `web` bug). AC-8 verified
      by code reading only — see plan.md's Risks; the "delete the last admin" branch appears
      structurally unreachable given `AdminGuard` + the self-delete check ordering (deleting a
      distinct last admin requires a non-admin caller, which the guard already refuses), so the
      *outcome* AC-8 asks for (deleting the sole admin is refused) already holds, just via the
      self-delete message rather than the last-admin one. Flagged, not changed.
- [x] **T010** `[web] [P]` Pass `isAdmin={user.isAdmin}` from `src/layout/AdminShell.tsx` to
      `src/layout/AppSidebar.tsx`; accept the prop there and append one `Users`-icon nav item
      (`lucide-react`) pointing at `/users`, only when `isAdmin` is true. → T007
      *Done when:* signed in as the non-admin user from T009's check, "Users" does not appear in
      the sidebar (AC-4, the usability half of REQ-4). Confirmed live via HTTP against the running
      stack: admin sees the `/users` sidebar link, a freshly created non-admin does not.
- [x] **T011** `[infra] [P]` Create `bin/reset-password` (`bin/cli api npx ts-node
      scripts/reset-password.ts "$@"`, `chmod +x`), following `bin/npm`'s shape as the closest
      sibling. → T005
      *Done when:* `bin/reset-password admin` sets a working password, verified by signing in with
      it at `/login` (AC-10); `bin/reset-password doesnotexist` prints
      `Usuario "doesnotexist" no encontrado` to stderr, exits non-zero, and
      `bin/mysql -e 'select password from users'` shows no change (AC-11). Both confirmed live via
      the `login` mutation. Also fixed a pre-existing bug in `bin/mysql` found while verifying:
      it referenced `${DB_DATABASE}`, which doesn't exist in `.env` — the real variable is
      `DB_NAME` — so `bin/mysql` was failing outright before this fix.

### Group 3 — verification and docs

- [x] **T014** `[api]` **(Discovered during T009's live verification, not in the original task
      breakdown.)** `main.ts`'s global `ValidationPipe` uses Nest's default `exceptionFactory`,
      which throws a `BadRequestException` whose top-level `.message` is the generic
      `"Bad Request Exception"` string — the real `class-validator` messages (already written
      correctly in `users/dto/create-user.input.ts`'s `@MinLength` decorators, e.g.
      `"El nombre de usuario debe tener al menos 3 caracteres"`) only exist nested under
      `errors[0].extensions.originalError.message[0]`. Every consumer in this codebase
      (`services/web/src/actions/*.ts`) reads `errors[0].message` directly — the house
      convention `web/plan.md` documents and relies on — so today these two messages render as
      the generic string instead of the specific one. This blocks AC-6's username/password-length
      half. Fix: give `ValidationPipe` a custom `exceptionFactory` that throws `BadRequestException`
      with a single string (the first validation error's message), matching how every other
      `BadRequestException` in this codebase is already constructed (`users.service.ts`,
      `media-roots.service.ts`, `settings.service.ts` all pass a plain string, never an array).
      This does not touch `schema.gql` or any resolver signature — it changes only how one class of
      exception serializes its message, so it is not a contract change (Article VIII). → T009
      *Done when:* `bin/cli api npx --no tsc --noEmit` and `bin/npm api test` stay clean; a live
      `createUser` call with a 2-char username returns
      `errors[0].message === "El nombre de usuario debe tener al menos 3 caracteres"` (not
      `"Bad Request Exception"`); same for a 5-char password. Then confirm AC-6 fully live through
      the actual `/users` form (no `web` changes needed — `users.ts`'s actions already pass
      `errors[0].message` through verbatim). Both messages confirmed live, exact match. Typecheck
      and `bin/npm api test` (8/8 suites, 64/64 tests) stayed clean. Found and flagged, not fixed
      (out of this task's scope): `SettingInput`'s `@IsNotEmpty` decorators don't appear to be
      exercised by the global pipe at all — pre-existing, unrelated to this feature.
- [x] **T012** `[docs]` Update `docs/spec/graphql-contract.md` (the `isAdmin: Boolean!` field and
      the `users`/`createUser`/`updateUser`/`removeUser`/`user` operations going admin-only) and
      the root `CLAUDE.md` (a row for `bin/reset-password` in the `bin/` wrapper table; a note that
      `ADMIN_USER` is the administrator and that there is no public registration). → T011, T014
- [x] **T013** `[docs]` Walk every acceptance criterion in `spec.md`, tick each box, set
      `status: Implemented` on `spec.md`, `plan.md`, and every `<svc>/plan.md`. → T012

## Blocked

Nothing currently blocked. T005's `reset-password.ts` non-tty hang (previously listed here) is
resolved — see T005's own entry above.

Nothing here is a contract problem (Constitution, Article VIII) — the `isAdmin: Boolean!` delta
was implemented exactly as frozen; the blocked item is a script I/O bug, not a schema mismatch.

---
title: Admin User Management — Tasks
last_updated: 2026-08-10
status: Draft
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
- [ ] **T005** `[api]` Fix `scripts/reset-password.ts`: `promptHidden()` hangs on non-tty stdin
      (verified — three attempts through `docker compose exec`, piped and `-it`, all hung after
      printing both prompts with no write ever reached). Branch on `process.stdin.isTTY`; fall back
      to a plain `rl.question` when false. → T001 (needs the `isAdmin`-aware schema only
      incidentally — this task is really independent of T002–T004, listed here because it's the
      same file/script as the rest of this group's `api` work)
      *Done when:* `bin/cli api npx --no tsc --noEmit` stays clean, and a live run —
      `bin/cli api npx ts-node scripts/reset-password.ts admin` — actually reaches
      `Contraseña actualizada para "admin".` (not just prints the prompts), and the new password
      works at `/login`. Confirm no stray `ts-node` process remains in the `api` container from the
      earlier hung attempts.

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
- [ ] **T008** `[web] [P]` Create `src/actions/users.ts` following `src/actions/settings.ts`'s
      shape: `getUsers()` (throws on error), `createUserAction`/`deleteUserAction`
      (`useActionState`-shaped, pass `errors[0].message` straight through so every message in
      `web/plan.md`'s contract-obligations table reaches the caller unmodified). → T004
      *Done when:* `bin/cli web npx --no tsc --noEmit` unchanged from baseline.
- [ ] **T009** `[web]` Create `src/app/(dashboard)/users/page.tsx` (server component: `getCurrentUser()`
      + `getUsers()`, `notFound()` if `!user.isAdmin`) and
      `src/components/users/UsersManager.tsx` (client component: table with per-row delete,
      disabled on the caller's own row; create form via `useActionState`; every error rendered
      inline with `LoginForm.tsx`'s error class, never `alert()`). → T008
      *Done when:* signed in as admin, `/users` lists users and creating/deleting works without a
      page error (AC-3); creating a duplicate username / 2-char username / 5-char password shows
      each message inline (AC-6); the admin's own row cannot be deleted from the UI and the
      underlying attempt is still refused server-side (AC-7); deleting the sole admin is refused
      (AC-8); signed in as a freshly created non-admin, navigating to `/users` directly 404s (AC-4).
- [ ] **T010** `[web] [P]` Pass `isAdmin={user.isAdmin}` from `src/layout/AdminShell.tsx` to
      `src/layout/AppSidebar.tsx`; accept the prop there and append one `Users`-icon nav item
      (`lucide-react`) pointing at `/users`, only when `isAdmin` is true. → T007
      *Done when:* signed in as the non-admin user from T009's check, "Users" does not appear in
      the sidebar (AC-4, the usability half of REQ-4).
- [ ] **T011** `[infra] [P]` Create `bin/reset-password` (`bin/cli api npx ts-node
      scripts/reset-password.ts "$@"`, `chmod +x`), following `bin/npm`'s shape as the closest
      sibling. → T005
      *Done when:* `bin/reset-password admin` sets a working password, verified by signing in with
      it at `/login` (AC-10); `bin/reset-password doesnotexist` prints
      `Usuario "doesnotexist" no encontrado` to stderr, exits non-zero, and
      `bin/mysql -e 'select password from users'` shows no change (AC-11).

### Group 3 — verification and docs

- [ ] **T012** `[docs]` Update `docs/spec/graphql-contract.md` (the `isAdmin: Boolean!` field and
      the `users`/`createUser`/`updateUser`/`removeUser`/`user` operations going admin-only) and
      the root `CLAUDE.md` (a row for `bin/reset-password` in the `bin/` wrapper table; a note that
      `ADMIN_USER` is the administrator and that there is no public registration). → T011
- [ ] **T013** `[docs]` Walk every acceptance criterion in `spec.md`, tick each box, set
      `status: Implemented` on `spec.md`, `plan.md`, and every `<svc>/plan.md`. → T012

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T005 | `api` | `scripts/reset-password.ts`'s `promptHidden()` hangs on non-tty stdin; three live attempts confirmed no password was ever written | The `isTTY` fallback in T005 itself, plus a live re-verification once it's in place |

Nothing here is a contract problem (Constitution, Article VIII) — the `isAdmin: Boolean!` delta
was implemented exactly as frozen; the blocked item is a script I/O bug, not a schema mismatch.

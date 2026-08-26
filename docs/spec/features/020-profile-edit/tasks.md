---
title: Profile Edit — Tasks
last_updated: 2026-08-26
status: Done
---

# TASKS: Profile Edit (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

A task is one coherent change an agent can finish and verify on its own. If it cannot be checked
off without also doing something in another service, it is scoped wrong — split it.

## Tasks

### Group 1 — contract and schema (`api`)

`plan.md` § Order of Work: `api` owns the contract and must land first, since there is no codegen
to catch a `web` call against a mutation the schema does not have.

- [x] **T001** `[api]` Add `UpdateProfileInput` in
      `services/api/src/users/dto/update-profile.input.ts` per `api/plan.md` § Steps 1: `name`
      (`@IsNotEmpty`), `username` (`@MinLength(3)`), optional `password` (`@IsOptional()` +
      `@MinLength(6)`, so an empty string still fails). Do not extend `CreateUserInput` or
      `PartialType` of anything.
      *Done when:* the file exists, exports `UpdateProfileInput` with exactly those three fields
      and validator messages matching `spec.md` § GraphQL Contract Delta's error table.
- [x] **T002** `[api]` Add `UsersService.updateProfile(userId, input)` in
      `services/api/src/users/users.service.ts` per `api/plan.md` § Steps 2: exclude the caller's
      own id from the duplicate-username check, build the `data` object field by field (never
      spread `input`), hash the password with `bcrypt.hash(…, 10)` only when present, catch `P2002`
      and rethrow as the same `ConflictException`. → T001
      *Done when:* the method exists and the five `users.service.spec.ts` cases in T004 pass
      against it.
- [x] **T003** `[api]` Add `ProfileResolver` (`services/api/src/users/profile.resolver.ts`) with
      the `updateProfile` mutation per `api/plan.md` § Steps 3, and register it in
      `services/api/src/users/users.module.ts` providers (Step 4). `@UseGuards(JwtAuthGuard)` on
      the class, no `id` argument ever, non-user principal throws `UnauthorizedException('No
      autenticado')`. → T002
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and the regenerated
      `services/api/src/schema.gql` matches `spec.md` § GraphQL Contract Delta character for
      character (Constitution, Article VIII).
- [x] **T004** `[api]` Add the `describe('updateProfile')` block to
      `services/api/src/users/users.service.spec.ts` per `api/plan.md` § Tests: the five cases —
      writes only the three allowed keys, hashes the password, omits `password` when absent,
      accepts the caller's own current username, rejects a username belonging to someone else. →
      T002
      *Done when:* `bin/npm api test` passes with the suite count unchanged at 16 and the case
      count up by exactly 5, no failures.

### Group 2 — consumer (`web`)

Depends on Group 1: `web` calls a mutation that must exist and match the frozen contract first.

- [x] **T005** `[web]` Add `services/web/src/actions/profile.ts` per `web/plan.md` § Steps 1:
      `updateProfileAction`, the two password-pair rules before any network call, `variables` that
      omit `password` entirely when unset, `redirectIfUnauthenticated` before reading errors,
      unmodified `errors[0].message` passthrough. → T003
      *Done when:* the file exists and exports `updateProfileAction` matching the signature in
      `web/plan.md`.
- [x] **T006** `[web]` Add `services/web/src/components/profile/ProfileModal.tsx` per
      `web/plan.md` § Steps 2–5: controlled inputs (not `useActionState`), native constraint
      validation left on, the error banner above the first field, focus-on-error via
      `formRef.current?.elements.namedItem("name")`, `onClose()` + `router.refresh()` on success. →
      T005
      *Done when:* the component renders the four fields plus submit/cancel and compiles clean.
- [x] **T007** `[web]` Modify `services/web/src/components/header/UserDropdown.tsx` per
      `web/plan.md` § Steps 6–7: add `isProfileOpen` state, wire *Editar perfil*'s `onItemClick` to
      open the modal instead of navigating (no `href`), render `<ProfileModal>` as a sibling of
      `Dropdown`, and swap the entry's icon from `User` to `UserPen` (REQ-11) — `Settings` and
      `LogOut` untouched, `size={18}` unchanged. → T006
      *Done when:* `grep -n "UserPen" services/web/src/components/header/UserDropdown.tsx` matches
      both the import and the render (AC-12), the bare `User` icon no longer appears in the JSX,
      `bin/cli web npx --no tsc --noEmit` reports 0 errors and `bin/npm web run build` exits 0.

### Group 3 — verification and docs

- [x] **T008** `[docs]` `grep -rn "\"/profile\"\|'/profile'" services/web/src` returns nothing and
      no `profile` directory exists under `services/web/src/app` (AC-10). No `CLAUDE.md` needs a
      pipeline-table change — this feature adds no stage and moves none forward (per `spec.md` §
      Context & Goal); the root `CLAUDE.md` `services/api` module map does not name individual
      resolvers, so nothing there is stale either. → T007
      *Done when:* both grep/`ls` checks above confirm clean.
- [x] **T009** `[docs]` Walk every acceptance criterion (AC-1 through AC-12) against the running
      stack (`bin/dev`) per `plan.md` § Verification's manual pass, signed in as a non-admin user.
      Tick each box in `spec.md`, then set `status: Implemented` on `spec.md`, `plan.md`,
      `api/plan.md` and `web/plan.md`. → T008
      *Done when:* all twelve AC boxes in `spec.md` are `[x]` and all four files read
      `status: Implemented`.

Group 1 tasks are sequential (T001 → T002 → T003 → T004 all touch overlapping api surface and
build on one another); Group 2 tasks are sequential for the same reason within `web`. No `[P]`
tasks exist — this feature is small enough, and each service's steps depend on the one before it,
that parallelism would buy nothing but a race against an unfinished file.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

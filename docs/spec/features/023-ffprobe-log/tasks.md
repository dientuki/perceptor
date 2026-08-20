---
title: ffprobe Log — Tasks
last_updated: 2026-08-20
status: Done
---

# TASKS: ffprobe Log (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[worker]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

`web` and `infra` appear nowhere in this feature: `services:` is `[api, worker]`, the contract is
purely additive (NFR-5), and nothing about the stack's boot or wiring changes.

## Tasks

### Group 1 — schema, vocabulary and contract

- [x] **T001** `[api] [P]` Add `model FfprobeLog` to `services/api/prisma/schema.prisma` —
      `id` autoincrement, `file String @db.VarChar(500)`, `ffprobe String @db.MediumText`,
      `createdAt DateTime @default(now())`, `@@index([file])`, `@@map("ffprobe_logs")`, no
      relations and no `updatedAt` — and generate the migration with
      `bin/npm api run prisma:migrate` named `add_ffprobe_logs`.
      *Done when:* `bin/cli api npx prisma migrate status` reports no pending migration, and
      `bin/mysql -e 'show create table ffprobe_logs'` shows `ffprobe` as **`mediumtext`** (not
      `text`) and a non-unique index on `file`.
- [x] **T002** `[api] [P]` Add `FFPROBE_LOG_NOT_FOUND: 'error.ffprobeLog.not_found'` and
      `FFPROBE_LOG_EMPTY_PAYLOAD: 'error.ffprobeLog.empty_payload'` to
      `services/api/src/i18n/error-keys.ts`, with the two English templates from `spec.md`'s error
      table in `services/api/src/i18n/messages.en.ts` (`{id}` placeholder included).
      *Done when:* `bin/npm api test` passes `src/i18n/messages.en.spec.ts` — it iterates
      `ERROR_KEYS`, so both a missing template and an orphaned one fail it.
- [x] **T003** `[api]` Create `services/api/src/ffprobe-logs/` — `entities/ffprobe-log.entity.ts`,
      `ffprobe-logs.service.ts` (`record`/`findAll`/`findOne`/`remove`, throwing through
      `i18nError`), `ffprobe-logs.resolver.ts` (the four operations, `@AllowService()` on
      `recordFfprobe` only and `@UseGuards(AdminGuard)` on the other three **per method, never at
      class level** — see `api/plan.md` § Existing code to reuse) — and register
      `FfprobeLogsModule` in `services/api/src/app.module.ts`. → T001, T002
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and, after a boot,
      `services/api/src/schema.gql` contains `type FfprobeLog`, `ffprobeLogs`, `ffprobeLog`,
      `recordFfprobe` and `deleteFfprobeLog` byte-identical to `spec.md` § GraphQL Contract Delta,
      defaults `take: Int! = 50` / `skip: Int! = 0` included.
- [x] **T004** `[api]` Write `services/api/src/ffprobe-logs/ffprobe-logs.resolver.spec.ts` (the
      guard wiring, read from the metadata Nest actually sees) and
      `services/api/src/ffprobe-logs/ffprobe-logs.service.spec.ts` (`remove` on a missing id gives
      the keyed `not_found`, not a raw Prisma `P2025`; `findAll` orders `createdAt` **desc**), each
      opening with the Article IX header paragraph. → T003
      *Done when:* `bin/npm api test` is green with both new suites, and each case has been
      fault-injected — flipping the guard onto `recordFfprobe` and flipping the order to `asc` each
      make exactly one case fail.

### Group 2 — the worker side

T005 touches nothing `api` produces and may start immediately, in parallel with Group 1. T006 calls
`recordFfprobe` and cannot be verified before T003 exists.

- [x] **T005** `[worker] [P]` Change `services/worker/src/ffmpeg/metadata.ts`'s `getMetadata` to
      return `{ metadata, raw }` — the parsed object plus the untouched `ffprobe` stdout string,
      never re-serialized — and update its one caller,
      `services/worker/src/encode/encode.ffmpeg.ts`, to destructure it. The `catch` branch and its
      `ERROR_ENCODE_PROBE_FAILED` throw are untouched.
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports 0 errors and `bin/npm worker test`
      stays green; `grep -rn "getMetadata" services/worker/src` shows no other call site.
- [x] **T006** `[worker]` Wire `onProbe` end to end: add it to `EncodeFn` in
      `services/worker/src/encode/types.ts` as a **required** parameter, thread it through
      `encode/index.ts`, accept-and-ignore it in `encode/encode.mock.ts`, `await onProbe(input, raw)`
      in `encode/encode.ffmpeg.ts` **before** `buildFfmpegCommand`, and define it in
      `jobs/encode.job.ts` next to `onProgress` — issuing `recordFfprobe(file:, ffprobe:) { id }`
      through `fetchGraphQL`, wrapped in a `try/catch` around **that call only** that logs and
      returns. Do not add the two `error.ffprobeLog.*` keys to the worker's `error-keys.ts`.
      → T003, T005
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports 0 errors, and with `api` running,
      a live encode inserts a row into `ffprobe_logs` while the `ProcessJob` is still `ENCODING`.
- [x] **T007** `[worker]` Extend `services/worker/src/jobs/encode.job.spec.ts` with the three cases
      in `worker/plan.md` § Tests: `recordFfprobe` is sent with the driver's raw string **before**
      `encodeCompleted` (assert call ordering, not just occurrence); a rejecting `recordFfprobe`
      still reaches `encodeCompleted` and sends no `encodeFailed`; a throwing probe still fails with
      `error.encode.probe_failed` and sends **no** `recordFfprobe`. → T006
      *Done when:* `bin/npm worker test` is green with the three added cases, and moving the
      recording to after the encode makes the first one fail.

### Group 3 — verification and docs

- [x] **T008** `[docs]` Add a `### The ffprobe log is written before the encode, not after (023-ffprobe-log)`
      section to `docs/spec/graphql-contract.md` with the frozen SDL, and add the two new keys to
      its vocabulary table under `api`. → T003
- [x] **T009** `[docs]` Update the `CLAUDE.md` files: `services/api/CLAUDE.md`'s module map gains
      `ffprobe-logs/` (noting the per-method guard split and why class-level `AdminGuard` is wrong
      here); `services/worker/CLAUDE.md`'s "The encode driver seam" gains `onProbe` and its
      "Errors must not be swallowed" section gains the **second** documented exception. The root
      `CLAUDE.md` pipeline table is unchanged — no stage changes status — so touch only its test
      counts if they moved. → T004, T007
- [x] **T010** `[docs]` Ran `plan.md` § Verification: the five commands (all pass — 21/190 api,
      13/116 worker, migrate status clean) plus the GraphQL-reachable half of the manual pass
      (AC-2, AC-3, AC-6, AC-7's service-token half, AC-8, AC-9, all against the live `api`).
      Six of ten AC boxes ticked with the observed result; four recorded in **Blocked** below
      because they need a real FFmpeg encode or a second user account that this run should not
      fabricate. `status: Implemented` set on `spec.md`, `plan.md`, `api/plan.md`, `worker/plan.md`.
      → T008, T009
      *Done when:* every AC box is ticked with the observed result, or an unticked one is recorded
      in **Blocked** below with what it needs. — met: 6 ticked, 4 in Blocked, none silently skipped.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T010 — AC-1 | verification | Needs a real FFmpeg encode observed **while it is still running**. The implementation run has no multi-track source file to encode, and a `mock`-driver encode proves nothing: the mock never calls `onProbe`, by design. | Start an encode with `ENCODE_DRIVER=ffmpeg` on a movie with several audio/subtitle tracks, then `bin/mysql -e 'select id, file, length(ffprobe) from ffprobe_logs order by id desc limit 1'` while the `ProcessJob` is still `ENCODING`. |
| T010 — AC-4 | verification | Same: needs a real encode, then killed mid-transcode. | `docker compose restart worker` mid-encode; confirm the row is present and complete. |
| T010 — AC-5 | verification | Same: needs a real encode with `api` stopped. | `docker compose stop api`, run an encode, read `docker compose logs worker` for the swallowed recording error, confirm the job still reaches `COMPLETED`. Bring `api` back with `bin/dev`. |
| T010 — AC-7 (non-admin half) | verification | This instance has one user, the seeded admin. Creating a second account to test with is a side effect on the user's database, not the implementation run's call to make. | Create a non-admin user from `/users`, call `ffprobeLogs` with their session, expect `error.auth.admin_required`. The `SERVICE_TOKEN` half of AC-7 is already verified. |

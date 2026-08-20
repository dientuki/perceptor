---
title: ffprobe Log
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-08-20
last_updated: 2026-08-20
status: Implemented
services: [api, worker]
---

# SPEC: ffprobe Log (`spec.md`)

## Context & Goal

Every encode starts with one `ffprobe` call. `services/worker/src/ffmpeg/metadata.ts`'s
`getMetadata(filePath)` shells out to `ffprobe -show_format -show_streams -of json`, parses the
result and hands it to `buildFfmpegCommand`, which decides the whole command from it — codec,
tonemap, which audio and subtitle tracks survive, whether the source is a remux. That JSON is the
single input to every rule in `src/ffmpeg/params.ts`, and today it is thrown away the moment the
encode finishes. When a file comes out wrong — a subtitle that should not be there, a dropped
language, a misclassified remux — the evidence that would explain it is gone, and reproducing it
means finding the original file (often already deleted by `cleanup-source.ts`) and re-probing it.

The workflow this blocks is the one `services/worker/ffmpeg/` was built for: each case in that
corpus is the **verbatim `ffprobe` output of a real file** plus the argument array it must produce,
and `.claude/agents/ffmpeg.md` adds a case whenever a rule is wrong. Producing a case currently
depends on still having the file. Persisting each probe turns that into a database read: pick the
row for the file that came out wrong, paste its JSON into a new case, fix the rule.

This feature adds one table and the plumbing to fill it. The worker keeps calling `ffprobe` exactly
once per encode as it does now, and immediately reports the raw JSON to `api` through a new
mutation — before FFmpeg starts, so the probe is on record whatever the encode goes on to do;
`api` persists it and exposes it for reading. The encode that fails, or the container that is
killed mid-transcode, is exactly the case worth having evidence for, so the row must not wait for
a successful outcome to be written. No pipeline stage in the root `CLAUDE.md`
changes status — this is a diagnostic side-channel hanging off the transcode stage, not a new stage.
The worker holds no database client (Constitution, Articles II and III), so the migration, the model
and the CRUD all live in `api`.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Record on every probe)**: Every `ffprobe` run in `worker` that produced output must
      result in one new row holding the probed file's path and the raw JSON exactly as `ffprobe`
      emitted it, before any parsing or normalization by the worker. The row is written **after the
      probe returns and before the encode starts**, and its existence does not depend on the encode:
      a job that later fails, is killed, or never finishes still leaves its probe recorded.
- [ ] **REQ-2 (Append-only)**: A second probe of the same path must add a second row, never replace
      the first. Rows are immutable once written; there is no edit path.
- [ ] **REQ-3 (Read the log)**: An administrator must be able to list recorded probes newest-first,
      optionally filtered by exact file path, with paging, and to fetch a single row by id.
- [ ] **REQ-4 (Delete a row)**: An administrator must be able to delete a single row by id, so a
      log that has served its purpose can be pruned.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Best-effort, never fails an encode)**: A failure to record — `api` unreachable, the
      mutation erroring, the row rejected — must be logged and swallowed by `worker`; the encode
      continues and the `ProcessJob` is unaffected. This is the same reasoning that puts
      `cleanupSource` outside the encode's `try` (`012-post-download-processing`): a diagnostic
      write must never demote a job that produced a good file. It is the second documented
      exception to this service's "errors must not be swallowed" rule.
- [ ] **NFR-2 (Write is service-only, read is admin-only)**: The recording mutation carries
      `@AllowService()` — the worker calls it with `SERVICE_TOKEN`. Both queries and the delete
      mutation are restricted to administrators, since the stored `file` is an absolute container
      path and the JSON carries full source metadata.
- [ ] **NFR-3 (The column holds a real ffprobe payload)**: The JSON column must be sized for the
      largest real output, not for a typical one — a season pack episode with many audio and
      subtitle tracks and long `NUMBER_OF_FRAMES`/`side_data_list` blocks runs well past what a
      default `VARCHAR` holds. It is stored as an opaque string, never as a parsed structure.
- [ ] **NFR-4 (No blocking on the write)**: Recording must not delay the start of the FFmpeg
      process in a way a user would notice; it is one extra GraphQL round-trip against a job that
      runs for hours.
- [ ] **NFR-5 (Additive contract)**: Every element of the delta below is new. No existing type,
      field, argument or mutation changes, so `web` needs no change and old and new services
      interoperate (`docs/spec/graphql-contract.md` § "Additive changes are safe").

## GraphQL Contract Delta

```graphql
type FfprobeLog {
  id: Int!
  file: String!
  ffprobe: String!
  createdAt: DateTime!
}

type Query {
  ffprobeLogs(file: String, take: Int = 50, skip: Int = 0): [FfprobeLog!]!
  ffprobeLog(id: Int!): FfprobeLog!
}

type Mutation {
  recordFfprobe(file: String!, ffprobe: String!): FfprobeLog!
  deleteFfprobeLog(id: Int!): Boolean!
}
```

`ffprobe` is the raw `ffprobe` stdout as a `String`, not a JSON scalar — the same hand-encoded
convention `errorParams` already uses; this repo has no custom scalars. `ffprobeLogs` orders by
`createdAt` descending, then `id` descending, so paging is stable when several probes land in the
same second. `file` filters on exact equality, not on a prefix or a `LIKE`.

New error keys, both owned by `api`, to be added to `services/api/src/i18n/error-keys.ts` and to the
vocabulary table in `docs/spec/graphql-contract.md`:

| Condition | GraphQL error | English `message` | `extensions.i18n.key` | Params |
| :-- | :-- | :-- | :-- | :-- |
| `ffprobeLog(id)` / `deleteFfprobeLog(id)` names an id that does not exist | `NotFoundException` | `ffprobe log <id> does not exist` | `error.ffprobeLog.not_found` | `{ id }` |
| `recordFfprobe` called with an empty `file` or an empty `ffprobe` | `BadRequestException` | `recordFfprobe requires a non-empty file and ffprobe payload` | `error.ffprobeLog.empty_payload` | — |
| Any of the four called by a non-admin user session | `ForbiddenException` | existing admin guard | `error.auth.admin_required` | — |
| Any of the four called with no credential | `UnauthorizedException` | existing guard | `error.auth.unauthenticated` | — |

Consumer behaviour:

- **`worker`** calls only `recordFfprobe`, and treats **every** error above as non-fatal: it
  `console.error`s and continues (NFR-1). It reads nothing off the response beyond the fact that it
  succeeded, so a key it does not recognize costs nothing.
- **`web`** consumes none of these (see Out of Scope). No `messages/{en,es}.json` entry is added for
  the two new keys; the English `message` is the fallback anyone reading them will see, which is
  REQ-8 of `018-ui-i18n` working as designed.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `FfprobeLog` | **New model.** `id Int @id @default(autoincrement())` | — | No — new table, starts empty |
| `FfprobeLog` | `file String @db.VarChar(500)` — absolute container path of the probed file, matching the width `MediaSource.downloadPath` and `ProcessJob.outputFilePath` already use | non-null | No |
| `FfprobeLog` | `ffprobe String @db.MediumText` — raw `ffprobe` stdout (NFR-3) | non-null | No |
| `FfprobeLog` | `createdAt DateTime @default(now())` | default | No |
| `FfprobeLog` | Index on `file` — the filter in REQ-3. Non-unique: REQ-2 is append-only | — | No |
| `FfprobeLog` | `@@map("ffprobe_logs")` — every model in `schema.prisma` maps to a snake_case plural table | — | No |

No relation to `ProcessJob`, `SourceFile` or `MediaSource`. The log outlives the rows the probe was
taken for — a `ProcessJob` is deleted with its movie via `onDelete: Cascade`, and a cascade that
took the evidence with it would defeat the point of keeping it. The file path is the only join key,
and it is a weak one on purpose.

## Acceptance Criteria

Verified 2026-08-20 against the running dev stack. Six hold and are ticked with what was observed.
**Four are not ticked**: AC-1, AC-4 and AC-5 need a real FFmpeg encode of a real multi-track file,
and AC-7's non-admin half needs a second, non-admin user account — neither of which the
implementation run could produce without inventing the result. They are recorded in `tasks.md`
§ Blocked with what each one needs. The code path they cover is exercised by
`services/worker/src/jobs/encode.job.spec.ts` and `services/api/src/ffprobe-logs/*.spec.ts`, but a
passing unit test is not the same observation these criteria ask for.

- [ ] **AC-1**: Given a movie whose download has completed, when its encode starts — while the
      `ProcessJob` is still `ENCODING` and long before an output file exists — then
      `bin/mysql -e 'select id, file, length(ffprobe) from ffprobe_logs order by id desc limit 1'`
      already shows one new row whose `file` is the encode's input path and whose `ffprobe` length
      is greater than zero (REQ-1).
- [x] **AC-2** *(verified)*: a payload sent through `recordFfprobe` came back from `ffprobeLog(id)`
      **byte-identical** to what was sent, parsed as JSON and reported the same stream count. The
      other half — that what the worker sends is the verbatim probe rather than a re-serialization —
      is carried by `getMetadata` returning `{ metadata, raw }` and by `encode.job.spec.ts`
      asserting the mutation receives the driver's raw string unchanged.
      Given that row, when its `ffprobe` column is piped through `jq '.streams | length'`,
      then it parses as JSON and reports the same stream count `ffprobe` reports for that file run
      by hand — i.e. the stored payload is the verbatim probe, usable as a `services/worker/ffmpeg/`
      case without editing.
- [x] **AC-3** *(verified)*: three `recordFfprobe` calls for one path left three rows, ids 1/2/3,
      none replaced. Given the same file is encoded a second time, when the encode finishes, then the
      table holds **two** rows for that path, the older one unchanged (REQ-2).
- [ ] **AC-4** *(failure path)*: Given an encode that fails after the probe — a corrupt source, or
      `docker compose restart worker` mid-transcode — when the `ProcessJob` lands in `ERROR` or is
      left `ENCODING`, then its `ffprobe_logs` row is present and complete. The probe of the file that
      broke the encode is exactly the one worth reading (REQ-1).
- [ ] **AC-5** *(failure path)*: Given `api` is stopped (`docker compose stop api`) — or the
      `recordFfprobe` call is made to fail — when an encode runs, then `docker compose logs worker`
      shows the recording error and the encode still reaches `COMPLETED` with its output file
      present on disk. No `ProcessJob` moves to `ERROR` because of the log (NFR-1).
- [x] **AC-6** *(failure path, verified)*: returned
      `message: "ffprobe log 999999 does not exist"` with
      `extensions.i18n = { key: "error.ffprobeLog.not_found", params: { id: 999999 } }`. The
      `empty_payload` row of the error table was checked the same way and returns
      `error.ffprobeLog.empty_payload`.
      `ffprobeLog(id: 999999)` as an admin returns an error whose
      `message` is English and whose `extensions.i18n.key` is `error.ffprobeLog.not_found` with
      `params` `{"id":999999}`.
- [ ] **AC-7** *(failure path, half verified)*: the `SERVICE_TOKEN` half **holds** — `ffprobeLogs`
      with the machine credential is rejected with `error.auth.unauthenticated`, since only
      `recordFfprobe` carries `@AllowService()`, and the same call with no credential is rejected
      identically. The non-admin half is **unverified**: this instance has exactly one user, the
      seeded admin, and creating a second account is not something the implementation run should do
      unasked. `ffprobeLogs` called with a non-admin user session is rejected with
      `error.auth.admin_required`; called with the `SERVICE_TOKEN` it is also rejected, since only
      `recordFfprobe` carries `@AllowService()` (NFR-2).
- [x] **AC-8** *(verified)*: with three rows for one path, `take: 1` returned id 3 and
      `take: 1, skip: 1` returned id 2 — newest first, stable.
- [x] **AC-9** *(verified)*: the first `deleteFfprobeLog` returned `true`, the second on the same id
      returned `error.ffprobeLog.not_found` with `params { id: 1 }`.
- [x] **AC-10** *(verified)*: `bin/cli api npx --no tsc --noEmit` and
      `bin/cli worker npx --no tsc --noEmit` both exit 0; `bin/npm api test` is 190 passed across
      21 suites and `bin/npm worker test` is 116 passed across 13 files. `bin/cli api npx --no tsc --noEmit` and `bin/cli worker npx --no tsc --noEmit` exit
      0; `bin/npm api run test` and `bin/npm worker test` stay green.

## Out of Scope

- **A web UI.** There is no `/ffprobe-logs` screen, no link from a movie or episode detail page, and
  no `web` change at all — `services:` is `[api, worker]`. The log is read from `bin/mysql` or from
  the GraphQL playground while debugging a rule. Adding a screen later is additive and needs no
  contract change.
- **An update mutation.** "A normal CRUD" would have one; an append-only log has nothing to update,
  and Article X says do not add a path that exists only for symmetry. Create, read (list + by id)
  and delete are the whole surface. Fixing a bad row means deleting it and re-probing.
- **Retention, pruning or a size cap.** The table grows one row per encode forever. At the volume
  this instance runs, that is negligible, and `deleteFfprobeLog` is the manual escape hatch. A
  scheduled prune is a later feature, with the growth curve in hand.
- **Recording probes taken outside the encode driver.** `getMetadata` in
  `services/worker/src/ffmpeg/metadata.ts` is the only `ffprobe` call site in the codebase today. If
  a second one appears, recording from it is that change's job, not this one's.
- **Deduplicating identical payloads.** Two probes of an unchanged file store the same JSON twice.
  Hashing to collapse them trades a clear log for a cache, and REQ-2 explicitly wants the history.
- **Backfilling past encodes.** The evidence for anything already transcoded does not exist; the
  table starts empty and fills from the next encode on.
- **Linking a row to its `ProcessJob`.** Deliberately excluded above — the cascade would delete the
  evidence along with the media. Correlating a log with a job is done by comparing file paths.

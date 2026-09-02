---
title: Encode Report Durability — Tasks
last_updated: 2026-09-01
status: In Progress
---

# TASKS: Encode Report Durability (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Read `spec.md` and `plan.md` before starting, plus your own `<svc>/plan.md`. The
`## GraphQL Contract Delta` in `spec.md` is frozen (Article VIII) — if it looks wrong from inside
your slice, stop and record it under **Blocked** rather than adapting it locally.

New code carries no explanatory comments (Article XI). These files are heavily commented legacy;
leave the comments you are not editing alone, and do not add new ones to the code you write.

## Tasks

### Group 1 — the outcome mutations become repeat-safe (`api`)

This group is what the worker's retry depends on. Nothing in Group 4 may start before it lands:
a retry against an api that is not repeat-safe double-notifies the media server on every lost
response.

- [x] **T001** `[api]` Add `UPLOAD_SUPERSEDED: 'error.upload.superseded'` to
      `services/api/src/i18n/error-keys.ts` and its English rendering
      (`'Superseded by a newer upload'`) to `services/api/src/i18n/messages.en.ts`. Place it with
      the existing `error.upload.*` REST family, not with the GraphQL upload key. No `params` — the
      message takes no interpolation.
      *Done when:* `bin/cli api npx --no tsc --noEmit -p tsconfig.json` exits 0 and
      `bin/cli api grep -n "upload.superseded" src/i18n/error-keys.ts src/i18n/messages.en.ts`
      returns both files.

- [x] **T002** `[api]` Make `encodeCompleted` repeat-safe and source-aware in
      `services/api/src/process-jobs/process-jobs.service.ts`. Read the job before writing; widen
      its `include` so the source's `status` is available alongside `sourceFile.mediaSourceId`.
      When the job is already `COMPLETED` with the same `outputFilePath`, skip `notifyCreated` and
      skip the `movie`/`episode` update. When the source's status is `ERROR` (demoted), write the
      `ProcessJob` row but skip the `movie`/`episode` update entirely — no `COMPLETED`, no
      `filePath`. **Always** recompute and return the existing four-field verdict; do not add a
      field to `EncodeCompletedResult` and do not suppress the verdict on a second delivery
      (`../plan.md` § Contract Freeze).
      *Done when:* `bin/cli api npx --no tsc --noEmit -p tsconfig.json` exits 0 and
      `bin/cli api grep -n "notifyCreated" src/process-jobs/process-jobs.service.ts` shows the call
      inside a conditional rather than unconditional.

- [x] **T003** `[api]` Apply the same demoted-source guard to `encodeFailed` in the same file: read
      the job's source status, and when it is `ERROR`, record the failure on the `ProcessJob` row
      only — never propagating `ERROR` to the `movie`/`episode`. A demoted source's failure must not
      fail the title the winner is still encoding (REQ-8). Confirm a second identical delivery
      leaves the same stored state. → T002
      *Done when:* `bin/cli api npx --no tsc --noEmit -p tsconfig.json` exits 0 and both
      `movie.update`/`episode.update` calls in `encodeFailed` sit behind the guard.

### Group 2 — the upload always wins its race (`api`)

Independent of Group 1 in code; both are `api` and run in whichever order the agent takes them.

- [x] **T004** `[api]` In `services/api/src/uploads/uploads.service.ts`, delete the opening
      `if (!(await this.uploadTickets.isReplaceAuthorised(uploadId))) return;` from
      `demoteSupersededSources` so every completed upload demotes its target's `READY`/`SCANNED`
      sources (REQ-6). In the same method, and in the same `$transaction` as the demotion, move that
      source's `ProcessJob` rows in `WAITING`/`QUEUED`/`ENCODING` to `ERROR` with the
      `SOURCE_REPLACED` key (REQ-9) — `ProcessJob` reaches its source through
      `sourceFile.mediaSourceId`, not a direct column. Do **not** delete `isReplaceAuthorised` or
      its other call sites: the `COMPLETED` + `force` guard higher up in both branches stays exactly
      as it is (NFR-3). Do **not** touch `DownloadsService.resolveRace` (NFR-4). Do not move the
      demote-before-create-before-resolveRace ordering.
      *Done when:* `bin/cli api npx --no tsc --noEmit -p tsconfig.json` exits 0 and
      `bin/cli api grep -n "isReplaceAuthorised" src/uploads/uploads.service.ts` shows it only in
      the two `*_ALREADY_COMPLETED` guards, no longer in `demoteSupersededSources`.

- [x] **T005** `[api]` In both branches of `handleUploadFinish`, replace the
      `if (raceResult.startsWith('ignorado')) { console.log(...); return; }` early return with
      `throw new UploadHttpError(409, ERROR_KEYS.UPLOAD_SUPERSEDED)` (REQ-7). After T004 this branch
      is reachable only when a concurrent upload demoted this row between its `create` and its race
      resolution — the loser of an upload-versus-upload race. → T001, T004
      *Done when:* `bin/cli api npx --no tsc --noEmit -p tsconfig.json` exits 0 and
      `bin/cli api grep -n "ignorado" src/uploads/uploads.service.ts` returns nothing.

### Group 3 — the tests that make the silence loud (`api`)

Both defend against failures that produce no error anywhere — Article IX's exact class, and the
incident this feature exists for. Use the house fault-injection technique
(`services/api/CLAUDE.md` § Tests): each case must be verified to go red when its rule is removed.
Open each new block with the one-paragraph header Article XI permits.

- [x] **T006** `[api] [P]` Extend
      `services/api/src/process-jobs/process-jobs.service.spec.ts`: a second `encodeCompleted` for
      the same job does not call `notifyCreated` and leaves the stored row identical (AC-8); a job
      whose `MediaSource` is `ERROR` leaves `episode.status` and `filePath` untouched on
      `encodeCompleted` (AC-7) **and** on `encodeFailed`. Fault-inject: drop the `ERROR` check and
      the last two cases must fail. → T002, T003
      *Done when:* `bin/npm api test` is green and the new cases fail when the guard is removed.

- [x] **T007** `[api] [P]` Extend `services/api/src/uploads/uploads.service.spec.ts`: an upload
      against a target holding a `SCANNED` sibling demotes it, moves the title to `ENCODING` and
      enqueues `bull:process` (AC-5, AC-6); the demotion leaves none of that source's `ProcessJob`
      rows in `WAITING`/`QUEUED`/`ENCODING` (AC-9); a row demoted out from under its own
      `resolveRace` throws `409` with `error.upload.superseded` rather than returning (AC-10).
      Fault-inject: restore the `isReplaceAuthorised` guard and the first case must fail — that
      failure *is* the incident. → T004, T005
      *Done when:* `bin/npm api test` is green and the demotion case fails when the guard is
      restored.

### Group 4 — consumers (`worker`, `web`)

Everything here depends on Group 1: the contract's new obligation must be honoured by `api` before
the worker starts exercising it. The `worker` chain and the `web` task share no file.

- [x] **T008** `[worker] [P]` In `services/worker/src/api/graphql-client.ts`, export
      `class ApiUnreachableError extends Error` and throw it **only** where the `await fetch(...)`
      call itself rejects, carrying the original as `cause`. Everything below stays exactly as it
      is and stays terminal: the non-2xx `Error`, the invalid-JSON `Error`, the unkeyed
      `GraphQL error: …` and the `KeyedError`. Do not widen this to HTTP 5xx — `INTERNAL_GRAPHQL_URL`
      reaches `api:4000` with no proxy, so a 5xx is the api answering (`../plan.md` § Contract
      Freeze). → T002, T003
      *Done when:* `bin/cli worker npx --no tsc --noEmit` exits 0 and the class is exported from
      exactly one file.

- [x] **T009** `[worker]` Add `services/worker/src/api/deliver-report.ts` exporting
      `deliverReport<T>(label: string, send: () => Promise<T>): Promise<T>`: call `send()`; on
      `ApiUnreachableError` log one line naming `label` and the next delay (NFR-1), wait, retry —
      unbounded, never giving up (NFR-2). Rethrow every other error immediately (REQ-3). Backoff
      starts near 5 s, doubles, caps near 60 s, with the timings as module constants so a test can
      drive them fast. → T008
      *Done when:* `bin/cli worker npx --no tsc --noEmit` exits 0 and the module exports exactly one
      function.

- [x] **T010** `[worker]` In `services/worker/src/jobs/encode.job.ts`, move the `encodeCompleted`
      `fetchGraphQL` call **out** of the `try` block — the `try` now ends once the encode or
      passthrough has returned and `ffmpegCommand`/`finalOutputPath` are set. Route the relocated
      call through `deliverReport`, and route the `catch`'s `encodeFailed` call through it too,
      **removing** that call's trailing `.catch((err) => console.error(...))` — swallowing it is the
      bug that lost the incident's report. Keep the `throw error` that follows. Keep all four fields
      in the `encodeCompleted` selection: the existing missing-field guard reads an absent
      instruction as "skip cleanup entirely". Do not route `onProgress` or `onProbe` through the
      wrapper — both are designed to be droppable. Do not add BullMQ `attempts`. → T009
      *Done when:* `bin/cli worker npx --no tsc --noEmit` exits 0, and the `encodeCompleted` call is
      lexically outside the `try` that contains the `encodeFailed` call.

- [x] **T011** `[worker]` Cover the retry primitive: extend
      `services/worker/src/api/graphql-client.spec.ts` so a rejecting `fetch` produces
      `ApiUnreachableError` while an HTTP 500, an unkeyed GraphQL error and a keyed one produce
      errors that are **not** that class; add `services/worker/src/api/deliver-report.spec.ts`
      asserting it retries while `ApiUnreachableError` is thrown and returns the eventual value,
      rethrows any other error on the first attempt without retrying (AC-4), and waits between
      attempts rather than spinning. → T009
      *Done when:* `bin/npm worker test` is green with both files running.

- [x] **T012** `[worker]` Add the incident case to
      `services/worker/src/jobs/encode.job.spec.ts`: given an encode that succeeds and an
      `encodeCompleted` that throws `ApiUnreachableError` once and then succeeds, assert
      `encodeFailed` is **never** called and cleanup still runs on the verdict that eventually
      arrived (AC-1, AC-2). Assert too that a genuinely failed encode still reports `encodeFailed`
      with its key intact (AC-3). Fault-inject: move the `encodeCompleted` call back inside the
      `try` and the first case must go red. → T010
      *Done when:* `bin/npm worker test` is green and the case fails when the call is moved back.

- [x] **T013** `[web] [P]` Add `superseded` to the `errors.upload` object in
      `services/web/messages/es.json` (`"Otra subida más nueva reemplazó a esta"`) and in
      `services/web/messages/en.json` (`"Superseded by a newer upload"`). Two lines, nothing else —
      no component, action, type or route changes. The string carries no interpolation placeholder.
      → T001
      *Done when:* `bin/npm web run build` exits 0 and both files parse with the key nested under
      `errors.upload`, not at the top level.

### Group 5 — verification and docs

- [x] **T014** `[docs]` Update the `CLAUDE.md` files this feature makes stale: the root pipeline
      table's "Detect completion, enqueue" row (the arbiter no longer treats a finished sibling as
      a standing winner for uploads); `services/api/CLAUDE.md`'s `uploads/` section (which states
      `demoteSupersededSources` "runs only for an upload whose ticket authorised a replacement" —
      no longer true) and its `downloads/`/`process-jobs/` notes on repeat-safety; and
      `services/worker/CLAUDE.md` § "Errors must not be swallowed", whose documented exception list
      loses the `encodeFailed` swallow and gains the retry. → T012, T013
      *Done when:* no `CLAUDE.md` still describes the demote-on-force-only behaviour, and each
      changed section names this feature.

- [ ] **T015** `[docs]` Run the manual pass in `plan.md` § Verification — stop `api` mid-encode,
      confirm the retry logs and that no `encodeFailed` is sent, restart, confirm the job lands
      `COMPLETED` with its real path; then the upload-over-a-`SCANNED`-source pass. Walk every
      acceptance criterion in `spec.md`, tick each box, and set `status: Implemented` on `spec.md`,
      `plan.md`, `api/plan.md`, `web/plan.md` and `worker/plan.md`. Record the remeasured test
      counts for `api` and `worker`. → T014
      *Done when:* every AC box in `spec.md` is ticked or listed under **Blocked** with a reason,
      and all five files read `status: Implemented`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

---
title: Post-Download Processing — Tasks
last_updated: 2026-08-17
status: Done            # Draft | In Progress | Done
---

# TASKS: Post-Download Processing (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[web]` and no `[infra]` tasks. No screen changes anything this feature touches, and no `bin/`
script, `docker-compose.yaml`, Dockerfile or `.env.example` key moves — the volumes, the
`SERVICE_TOKEN` and the two media roots already exist and keep their current meaning.

## Tasks

### Group 1 — `api`: the contract

T001 is the only task the `worker` slice waits on. T002 depends on T001; T003 depends on nothing in
this group and may run alongside T001.

- [x] **T001** `[api]` Add `downloadsRoot` to `src/process-jobs/entities/encode-job-details.entity.ts`
      as a non-null `@Field()` beside `outputRoot`, with a comment recording that it is the
      downloads **root** and not `path_downloads` (torrents save under `<root>/<path_downloads>/<hash>`,
      uploads stage under `<root>/imports/<uploadId>`; containment has to cover both). Resolve it in
      `ProcessJobsService.getEncodeJobDetails` inside the shared `base` object — not per branch —
      with `this.mediaRoots.resolveFromRoot('downloads', '.')`.
      *Done when:* `bin/cli api cat src/schema.gql | grep downloadsRoot` prints
      `downloadsRoot: String!`; `bin/cli api npx --no tsc --noEmit` reports 0 errors.
- [x] **T002** `[api] [P]` Add a `downloadsRoot` `describe` block to
      `src/process-jobs/process-jobs.service.spec.ts`, opening with a header comment naming the
      silent failure (resolving the wrong root makes every uploaded file fail the worker's
      containment check, so cleanup skips it forever, with no error in any log). Three cases:
      `resolveFromRoot` called with exactly `('downloads', '.')`; the resolved value present on a
      `MOVIE` payload; the same on an `EPISODE` payload. → T001
      *Done when:* `bin/npm api test` is green with the new block, and the first case is verified to
      **fail** when the argument is switched to the `path_downloads` setting (report the failing
      output, then restore).
- [x] **T003** `[api] [P]` Correct the comment above `SourceFile.filePath` in
      `prisma/schema.prisma`: the original **is** deleted after a successful encode (REQ-10) — for
      torrents already, and for every source kind once this feature lands. Comment only.
      *Done when:* `bin/cli api npx prisma migrate status` reports no drift and
      `git status services/api/prisma/migrations/` shows no new directory — a Prisma comment
      produces no migration, and an empty migration must not be committed.

### Group 2 — `worker`: the three defects

T004 and T007 depend on nothing and can start immediately, in parallel with all of Group 1. T006 is
the only task that needs T001: the code compiles either way (there is no codegen), so the dependency
is a runtime one — until the field ships, `downloadsRoot` arrives `undefined` and every cleanup
refuses.

- [x] **T004** `[worker] [P]` Create `src/paths/is-inside-root.ts` exporting
      `isInsideRoot(root, candidate): boolean` — `resolve()` both, true only when equal or the
      candidate starts with `root + sep`; an empty or non-absolute root returns **false**. No
      filesystem access. Plus `src/paths/is-inside-root.spec.ts` per `worker/plan.md` § Tests.
      *Done when:* `bin/npm worker test` is green and the suite includes a case proving
      `/media/downloads-old` is not inside `/media/downloads`, and one proving an empty root
      refuses.
- [x] **T005** `[worker]` Create `src/jobs/cleanup-source.ts` exporting
      `cleanupSource(input): Promise<void>` with a locally declared `CleanupInput`
      (`mediaSourceId`, `sourceKind`, `infoHash`, `downloadPath`, `downloadsRoot`), following
      `src/paths/build-output-path.ts`'s narrow-input pattern. Order: `downloadRemove` first when
      `infoHash` is non-null; return early when `downloadPath` is null; refuse and log when
      `isInsideRoot` is false; then branch on `sourceKind` — `LOCAL_FILE` deletes the file and
      **non-recursively** `rmdir`s its parent (swallowing `ENOTEMPTY`), every other kind deletes
      recursively. The function must never throw; every failure is caught and logged with
      `[cleanup]` and the mediaSource id, with a comment saying why swallowing is correct *here*
      specifically (REQ-11) against `services/worker/CLAUDE.md` § Errors must not be swallowed.
      Plus `src/jobs/cleanup-source.spec.ts` covering all eight cases in `worker/plan.md` § Tests.
      → T004
      *Done when:* `bin/npm worker test` green; the `LOCAL_FILE` case is verified to **fail** when
      the branch is switched back to `infoHash` (report the failing output, then restore); a
      throwing `fetchGraphQL` and a throwing `rm` both leave `cleanupSource` resolved, not rejected.
- [x] **T006** `[worker]` Wire it into `src/jobs/encode.job.ts`: add `downloadsRoot: string` to the
      local `EncodeJobDetails` type **and** to the `processJob(id)` query selection in the same
      edit; delete the `if (details.infoHash) { … }` block from inside the encode's `try`; call
      `cleanupSource(...)` after that `try/catch` closes, wrapped in its own `try` whose `catch`
      only logs. Keep the comment explaining the media-server notification is `api`'s job.
      → T001, T005
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports 0 errors;
      `grep -n "infoHash" src/jobs/encode.job.ts` shows no filesystem operation guarded by it; the
      cleanup call sits outside the `try` that wraps the encode.
- [x] **T007** `[worker] [P]` Create `src/scan/scan-folder.spec.ts` against a real `mkdtemp`: the
      largest video wins regardless of name, a larger non-video does not win, a folder with no video
      yields `matchedFilePath: null`, and a single-file `downloadPath` is inventoried as one entry.
      Header comment naming the silent failure — a wrong pick here encodes the sample instead of the
      film and the job still reports success.
      *Done when:* `bin/npm worker test` green with the new suite.

### Group 3 — docs and verification

- [x] **T008** `[docs]` Add a `### The encode payload carries the downloads root
      (012-post-download-processing)` section to `docs/spec/graphql-contract.md`, before
      `### The one non-GraphQL route`: the SDL, why it is the root and not `path_downloads`, why it
      is non-null, and that `downloadRemove`'s `omitido: …` response no longer means "nothing to
      delete". Bump `spec_version`. → T001
- [x] **T009** `[docs]` Update the affected `CLAUDE.md` files. `services/worker/CLAUDE.md`: the
      layout block gains `src/jobs/cleanup-source.ts` and `src/paths/is-inside-root.ts`, the dev-loop
      test count moves off 4 suites / 31 tests, and the "Errors must not be swallowed" section gains
      the one documented exception. `services/api/CLAUDE.md`: the `process-jobs/` bullet mentions
      `downloadsRoot`, and the test counts move. Root `CLAUDE.md`: no pipeline row changes status —
      say so rather than editing the table. → T006
- [x] **T010** `[docs]` Walk every acceptance criterion in `spec.md` against the running stack per
      `plan.md` § Verification — the four `bin/` gates, then the seven-step manual pass, with
      `ENCODE_DRIVER=mock` for everything except the AV1 checks. Tick each box, then set
      `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and `worker/plan.md`, and
      `status: Done` here. → T009
      *Done when:* AC-4, AC-6 and AC-7 — the three marked "Fails today" — now pass, with the
      before/after reported; `bin/npm api test` and `bin/npm worker test` both green;
      `bin/cli web npx --no tsc --noEmit` still reports exactly its 11 known errors across the same
      4 files and not one more.

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty
entry is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.

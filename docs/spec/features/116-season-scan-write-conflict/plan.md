---
title: Season scan write conflict — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-11-07
status: Implemented         # Draft | Approved | Implemented
---

# PLAN: Season scan write conflict (`plan.md`)

## Approach

Two independent changes inside `api`, both behind tests written first.

**Ordering.** The repo already has the right order in three places: `DownloadsService.handleTorrentCompleted`
(recompute, then `addSourceReady`) and both non-season branches of `UploadsService.handleUploadFinish`
(same). The two paths that break it, `SeasonsService.finishSeasonUpload` and `downloadStart`'s
scan resume, are brought in line with that existing convention. No new mechanism, no new
`TitleStatusService` method: the same `recomputeSeason`/`recomputeStatus` calls move ahead of the
enqueue. `downloadStart` ends with an unconditional `recomputeStatus(source)` for every stage, so
for the scan stage that trailing call has to move ahead of the enqueue rather than be duplicated,
or the race survives behind the new early call.

**Retry.** `sourceScanned` keeps its single interactive transaction, its read-first shape and its
enqueue-after-commit block. It gains a bounded retry around the transaction, limited to the one
error class the spec names. Prisma 7 with `@prisma/adapter-mariadb` does not map MariaDB 1020 to
`P2034` (that mapping exists only for 1213, deadlock). It surfaces as a
`PrismaClientKnownRequestError` with code `P2039` ("Database error") whose
`meta.driverAdapterError.cause.originalCode` is `'1020'`, verified in the production log and in
`node_modules/@prisma/client/runtime/client.js`. The classifier matches exactly that and nothing
else, so it never retries an unrelated `P2039`. It is a small pure function in `src/prisma/`
(beside `PrismaService`, since it is about the driver, not about media sources) so a later audit
of the other interactive transactions can reuse it. There is no existing retry helper in `api` to
reuse: the two `P2034` handlers in `subtitle-search/` and `subtitle-embed/` map the conflict to a
user-facing `busy` key and do not retry.

Alternatives rejected: lowering the isolation level of that one transaction to `READ COMMITTED`
(excluded by spec NFR-2, and it would only hide the next conflict); reading the season's episodes
outside the transaction (the FK check that fails is MariaDB's own, on the insert, not on our read,
so moving the read changes nothing).

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` — failing tests | spec REQ-6: the five tests exist and are observed failing before any production change |
| 2 | `api` — ordering fix | smallest change, removes the known production race; tests (a)/(b) go green |
| 3 | `api` — retry | tests (c)/(d)/(e) go green |
| 4 | verify | typecheck, full suite, then the live pass |

Single service, so nothing runs in parallel. Steps 2 and 3 touch different files and could be one
task each in any order, but both depend on step 1.

## Contract Freeze

`## GraphQL Contract Delta` in `spec.md` is "None" and frozen as of `status: Approved`. Things an
implementer will be tempted to change and must not:

- **A new error key for "scan conflict, retries exhausted".** Spec REQ-5 forbids it: the exhausted
  error propagates unchanged and the worker reports `error.source.scan_failed`, which `web`
  already renders. A new key would need a `web` catalog entry and a contract amendment.
- **Retrying deadlocks (`P2034`/1213) too.** It looks like the same family, but REQ-3 names only
  1020. Widening it is a spec amendment, not a local decision.
- **Adding `attempts` to the `process` queue in `worker`.** Out of scope by the spec; the retry lives
  in `api`, where the transaction is.
- **Dropping the trailing recompute in `downloadStart` for every stage.** Only the scan stage races;
  the encode and download stages enqueue no scan and keep their trailing recompute as is.

## Migrations

None.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| State accumulated by a failed attempt leaks into the next one (`processJobIdsToQueue`, `episodeIdsToRecompute`, `scanFailedTarget` are declared outside the transaction today) | Silent: a retried scan enqueues a `ProcessJob` id that was rolled back (BullMQ job for a row that does not exist, the worker fails it later as `processJob.not_found`) or enqueues the same id twice | Per-attempt state, committed only from the attempt that succeeded; test (c) asserts each `addEncode` exactly once and only for the committed ids |
| The classifier matches too much | Silent: a real bug (e.g. another `P2039`) is retried twice and logged as a conflict, hiding its cause for longer | Match `P2039` **and** `originalCode === '1020'`; test (e) covers a non-conflict error making one attempt |
| The classifier matches nothing (wrong path into `meta`) | Silent in tests that build the error by hand the wrong way; in production the 1020 keeps failing exactly as today | Tests build the error with the shape Prisma 7 actually produces (`new Prisma.PrismaClientKnownRequestError(msg, { code: 'P2039', clientVersion, meta: { driverAdapterError: { cause: { originalCode: '1020' } } } })`), and the live pass in AC-3 must show no `1020` in the worker log |
| The trailing recompute in `downloadStart` stays after the enqueue for the scan stage | Silent: Play on a failed season scan keeps failing with 1020, no new error | Test (b) records call order across `recomputeSeason` and `addSourceReady` for a season source in `ERROR` at stage `SCAN` |
| Moving `recomputeSeason` ahead of `addSourceReady` changes what the lift reads | The season's episodes would read `MISSING` while the scan runs | The source is already `READY` (flipped by the guarded `updateMany`) before the recompute, and `isLiftedBySeasonPack` lifts on any non-`ERROR`, non-`SCANNED` season source, so the derived result is the same as today's; AC-7 checks it live |

## Verification

```bash
bin/npm api test -- src/seasons/seasons.service.spec.ts src/downloads/downloads.service.spec.ts src/media-sources/media-sources.service.spec.ts src/prisma
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/comments api
```

The first command is run twice: once after step 1, where the five new tests must **fail** (output
pasted into the task report, spec AC-1), and once at the end, where everything passes.

Manual pass on a stack running the fixed `api`:

1. Upload two or more episode files of one season through the season header's import button
   (AC-3). Expect the source `SCANNED`, one `ProcessJob` per file on `/downloads`, and
   `docker compose logs worker` showing `completed media-source-<id>` with no `1020`.
2. While that scan runs, the season's aired episodes read `QUEUED` (AC-7).
3. In production, press Play on source 422's row after deploying (AC-4). It reaches `SCANNED` and
   S02E02/S02E03 queue for encoding.

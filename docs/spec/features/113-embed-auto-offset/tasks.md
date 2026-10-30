---
title: Automatic Offset for Subtitle Embed — Tasks
last_updated: 2026-10-30
status: Done
---

# TASKS: Automatic Offset for Subtitle Embed (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` | Which subagent owns the task. Exactly one per task. A task that needs two services is two tasks. |
| `[docs]` | Documentation and the manual pass. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer. |

**Measuring.** The stack running on this host is the end-user install, not this checkout, so
`bin/cli`/`bin/npm` may find no container. When they do not, run each *Done when* command through
the throwaway container described in memory (`measuring-without-dev-stack`):

```bash
docker run --rm --user 1000:1000 -v "$PWD/services/<svc>":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c '<command>'
```

Report which form was used.

## Tasks

### Group 1 — `api`: schema, contract and the `SYNCING` stage

T003, T004 and T005 depend on nothing and can start alongside T001.

- [x] **T001** `[api]` Add `SYNCING` to `SubtitleEmbedStatus`:
      - in `prisma/schema.prisma` (first value);
      - in a new migration `subtitle_embed_syncing`;
      - in `src/subtitle-embed/entities/subtitle-embed-status.enum.ts`.

      *Done when:* `bin/cli api npx prisma migrate status` reports up to date, `git status
      services/api/prisma/` shows one new migration directory, and `schema.gql`'s
      `enum SubtitleEmbedStatus` lists `SYNCING QUEUED RUNNING COMPLETED FAILED`.
- [x] **T002** `[api]` Collapse the three active-status lists into one exported
      `ACTIVE_EMBED_STATUSES = ['SYNCING', 'QUEUED', 'RUNNING']` in `active-embed.guard.ts`:
      - `SubtitleEmbedService.createGuarded` uses that list and takes the initial status as a
        parameter;
      - `ProcessJobsService.reconcileOrphanedEncodes` fails `SYNCING` as well as `RUNNING` with
        `error.subtitleEmbed.interrupted`;
      - `SubtitleSearchDriver.embedActive` is left alone (`api/plan.md` § Steps 2). → T001

      *Done when:* new cases pass in `bin/npm api test`:
      - a `SYNCING` row makes `hasActiveEmbed` true;
      - a `SYNCING` row makes `createGuarded` refuse with `busy`;
      - `reconcileOrphanedEncodes` moves a `SYNCING` row to `FAILED`/`interrupted`.

      `grep -rn "'QUEUED', 'RUNNING'" services/api/src/subtitle-embed services/api/src/process-jobs`
      returns nothing.
- [x] **T003** `[api] [P]` Add a pure `decodeSidecar(buf: Buffer): string` in
      `src/subtitle-embed/sidecar-text.ts`. It handles UTF-8 BOM, UTF-16LE BOM and UTF-16BE BOM,
      and falls back to UTF-8.
      *Done when:* `sidecar-text.spec.ts` proves that `lastCueEndMs(decodeSidecar(buf))` is
      non-null and equal for the same cues in UTF-8, UTF-8+BOM, UTF-16LE and UTF-16BE fixtures, and
      `bin/npm api test` is green.
- [x] **T004** `[api] [P]` Add to `src/i18n/error-keys.ts` and `src/i18n/messages.en.ts`:
      - `SUBTITLE_EMBED_SYNC_FAILED`
      - `_SYNC_FRAMERATE_MISMATCH`
      - `_SYNC_OFFSET_TOO_LARGE`
      - `_SYNC_INCOMPLETE`
      - `_SYNC_LOW_SCORE`
      - `_SYNC_NOT_FOUND`

      Each value is the `error.subtitleEmbed.*` key named in `spec.md`'s error table.
      *Done when:* typecheck is clean and the existing messages coverage test (if any) passes with
      the six keys present.
- [x] **T005** `[api] [P]` In `src/queue/types.ts`, add:
      - `SUBTITLE_EMBED_SYNC_JOB = 'subtitle-embed-sync'`;
      - `SubtitleEmbedSyncJob = { subtitleEmbedId: number; fileName: string }`.

      In `SubtitleSyncQueueService`, add `addEmbedSync(payload, trackIndex)` with job id
      `subtitle-embed-sync-<embedId>-<trackIndex>` and `attempts: 1`.
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean.
- [x] **T006** `[api]` Add `SubtitleEmbedSyncService` (`src/subtitle-embed/subtitle-embed-sync.service.ts`)
      per `api/plan.md` § Steps 6:
      - `enqueue`, `details`, `completed`, `failed`;
      - the `RejectionKey → error.subtitleEmbed.sync_*` map;
      - the serializable read-modify-write of `tracks`;
      - the `SYNCING → QUEUED` flip, then `addEmbed`, with `FAILED`/`sync_failed` if the enqueue
        throws.

      Also add:
      - the `SubtitleEmbedSyncDetails` entity;
      - the provider in `subtitle-embed.module.ts`;
      - the three `@AllowService()` operations in `subtitle-embed.resolver.ts`, named and typed
        exactly as in `spec.md`.

      Import `accept()`/`lastCueEndMs()` as files, never `SubtitleSearchModule`. → T001, T003, T004,
      T005

      *Done when:* `subtitle-embed-sync.service.spec.ts` covers every case listed in
      `api/plan.md` § Tests and `bin/npm api test` is green. `schema.gql` shows the type
      `SubtitleEmbedSyncDetails`, the query `subtitleEmbedSyncDetails` and the mutations
      `subtitleEmbedSyncCompleted`/`subtitleEmbedSyncFailed` verbatim from `spec.md`.
- [x] **T007** `[api]` Add `autoOffset` to `SubtitleEmbedInput` (`@Field({ defaultValue: false })`).
      `validateSelection` range-checks only manual tracks. `embed()` stores `autoOffset` on each
      `StoredTrack`, creates the row `SYNCING` when any track is automatic, and calls
      `SubtitleEmbedSyncService.enqueue`. A failed enqueue deletes the row and rethrows. A
      manual-only embed is unchanged. → T002, T006

      *Done when:* `subtitle-embed.service.spec.ts` covers the following and `bin/npm api test`,
      `bin/npm api run lint` and `bin/comments api` are green:
      - automatic → `SYNCING` with N `addEmbedSync` calls and 0 `addEmbed` calls;
      - `offsetMs: 999999` on an automatic track is not refused;
      - manual-only → `QUEUED`;
      - a failed enqueue → the row is deleted.

      `schema.gql` shows `autoOffset: Boolean! = false` on `SubtitleEmbedInput`, and `git diff
      services/api/src/schema.gql` contains nothing outside the `spec.md` delta.

### Group 2 — consumers

T008 only moves existing code and can start immediately. T009 and T010 consume the operations and
the input that Group 1 produces, so they wait for those tasks. Once those land, T009 and T010 run in
parallel.

- [x] **T008** `[worker] [P]` Extract the measurement body of `src/jobs/subtitle-sync.job.ts` into
      `measureSync(filePath, candidatePath, signal)` in `src/subtitles/measure-sync.ts`. The body
      runs from `getMetadata` through `parseFfsubsyncOutput`, including the temporary directory and
      its `rm`. `handleSubtitleSync` calls it, and its behaviour is unchanged.
      *Done when:* `subtitle-sync.job.spec.ts` passes **unmodified** and `bin/npm worker test` is
      green.
- [x] **T009** `[worker] [P]` Add the embed measurement job:
      - copy `SUBTITLE_EMBED_SYNC_JOB`/`SubtitleEmbedSyncJob` from `api`'s `src/queue/types.ts`
        into `src/queue/types.ts`;
      - add `src/api/subtitle-embed-sync-reports.ts`, with the three operations typed from
        `spec.md`;
      - add `src/jobs/subtitle-embed-sync.job.ts`:
        - `details`; on `sync_not_found`, report nothing;
        - `measureSync`;
        - `Completed`, or `Failed` with `error.subtitleEmbed.sync_failed`, always through
          `deliverReport`;
      - make the `subtitle-sync` `Worker` in `src/index.ts` dispatch on `job.name`;
      - add the key and message in `src/i18n/`;
      - update the `subtitle-sync` row of `services/worker/CLAUDE.md`'s queue table.

      → T005, T006, T008

      *Done when:* `subtitle-embed-sync.job.spec.ts` covers success, a `measureSync` throw,
      `sync_not_found`, and the temporary directory being removed with nothing written beside the
      sidecar in every path. `bin/npm worker test`, `bin/npm worker run lint` and `bin/comments
      worker` are green.
- [x] **T010** `[web] [P]` Add the "Automático" checkbox and the `SYNCING` state, per
      `web/plan.md` § Steps:
      - `src/types/media.ts`: `"SYNCING"` and `autoOffset`;
      - `EmbedSubtitlesModal.tsx`:
        - the "Automático" checkbox, checked by default;
        - the offset input disabled while it is checked;
        - validity ignores the offset for an automatic row;
        - the payload sends `autoOffset`, and `offsetMs: 0` when automatic;
      - `EmbedSubtitlesButton.tsx`:
        - in-flight means any status other than `COMPLETED`/`FAILED`;
        - the label is "Sincronizando subtítulos…" for `SYNCING`;
      - `messages/{en,es}.json`: `autoOffset`, `syncing` and the five
        `errors.subtitleEmbed.sync_*` strings, with the `es` strings verbatim from `spec.md`.

      → T007

      *Done when:* `bin/cli web npx --no tsc --noEmit`, `bin/npm web run lint`, `bin/cli web node
      scripts/check-messages.mjs` and `bin/comments web` are green. Never run `bin/npm web run
      build` while the dev stack is up.

### Group 3 — verification and docs

- [x] **T011** `[docs]` Add a `113-embed-auto-offset` section to `docs/spec/graphql-contract.md`:
      - the SDL delta;
      - the queue contract (job `subtitle-embed-sync` on `subtitle-sync`, payload);
      - the rule that the worker reports only `sync_failed` and `api` owns the verdict;
      - the error key table.

      → T007
      *Done when:* the section exists and matches `spec.md` § GraphQL Contract Delta word for word
      on every operation name and argument.
- [x] **T012** `[docs]` Update the affected `CLAUDE.md` files. → T007, T009, T010
      - Root `CLAUDE.md`: add a "Since `113`" sentence to the "Notify media server" row (the
        automatic offset of a hand embed, measured with `103`'s sync and acceptance, all or
        nothing, `SYNCING`), and add `113` to that row's spec list.
      - `services/api/CLAUDE.md`: add to the `subtitle-embed/` module-map entry:
        `SubtitleEmbedSyncService`, `SYNCING`, the shared `ACTIVE_EMBED_STATUSES`, `sidecar-text.ts`
        and the three service-only operations.
      - `services/web/CLAUDE.md`: add a line only if it documents the embed dialog today.

      *Done when:* `grep -n "113" CLAUDE.md services/api/CLAUDE.md` shows the new text.
- [x] **T013** `[docs]` Append a `113` entry to `docs/spec/history.md` with re-measured
      typecheck/test counts, the migration and the contract diff, then run `bin/pending-acs`.
      → T007, T009, T010
      *Done when:* the entry is the newest in `history.md`, and `bin/pending-acs --check` exits 0.
- [~] **T014** `[docs]` Run the manual pass in `plan.md` § Verification (steps 1–8, covering AC-1
      through AC-9) against a dev stack with Jellyfin. Tick each acceptance criterion in `spec.md`
      that was observed, and mark `[~]` any that could not be run here, naming the blocker. Set
      `status: Implemented` on `spec.md`, `plan.md` and the three `<svc>/plan.md`, and `status:
      Done` here. → T011, T012, T013
      *Done when:* every AC in `spec.md` is `[x]` or `[~]` with a named blocker, and all five
      files read `Implemented`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

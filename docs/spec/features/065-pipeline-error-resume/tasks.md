---
title: Pipeline Error Visibility and Resume — Tasks
last_updated: 2026-09-19
status: Done
---

# TASKS: Pipeline Error Visibility and Resume (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Every service task reads `spec.md`, `plan.md` and its own `<svc>/plan.md` first. The GraphQL
Contract Delta in `spec.md` is frozen — a task that finds it wrong stops and lands in **Blocked**.

## Tasks

### Group 1 — `api`: the contract, the derivation, the resume

- [x] **T001** `[api]` Add the six keys to `src/i18n/error-keys.ts` and their English messages to
      `src/i18n/messages.en.ts`: `error.download.torrent_client_error` (`{state}`),
      `error.source.scan_failed` (`{detail}`), `error.download.retry_replaced`,
      `error.download.retry_superseded`, `error.download.retry_unavailable`,
      `error.download.retry_enqueue_failed` (`api/plan.md` § Steps 1).
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `bin/npm api test`
      passes (any existing key/message parity spec included).
- [x] **T002** `[api]` Add the pure `isRaceWinner` and `deriveResume` to
      `src/pipeline-status/pipeline-status.ts` with their cases in `pipeline-status.spec.ts`
      (`api/plan.md` § Steps 2–3, § Tests: candidate selection ignores non-`ERROR` jobs; stage
      mapping incl. `REPLACED` on a job; null-key fallback; refusal order; partial pack and
      still-encoding cases for `isRaceWinner`). → T001
      *Done when:* `bin/npm api test -- pipeline-status` passes, and removing the "no active job"
      clause from `isRaceWinner` makes at least one case fail (fault injection, reverted).
- [x] **T003** `[api]` Expose the fields: new `src/downloads/entities/download-error.entity.ts`,
      `Download.lastError`/`Download.retryable`; `toDownload` takes siblings and calls
      `deriveResume`; `jobsBySourceId` selects job `id`/error fields/`updatedAt` in its one query;
      `movieDownloads`/`showDownloads` group siblings in memory; `resolveRace` uses `isRaceWinner`
      with siblings' jobs (`api/plan.md` § Steps 4–6). → T002
      *Done when:* typecheck 0 errors; `bin/npm api test` passes including a new
      `downloads.service.spec.ts` case where a `SCANNED` sibling whose only job is `ERROR` does not
      block `resolveRace`; `src/schema.gql` shows `DownloadError`, `lastError`, `retryable`.
- [x] **T004** `[api]` Widen `downloadStart` in `src/downloads/downloads.service.ts`: non-`ERROR`
      path unchanged; `ERROR` path refuses via `deriveResume` before any write, then resumes
      `ENCODE` (guarded `ERROR→WAITING`, `removeEncode`+`addEncode`, guarded `WAITING→QUEUED`,
      restore on failure), `SCAN` (guarded `ERROR→READY`, `resolveRace`, `removeSourceReady`+
      `addSourceReady`, revert on failure) or `DOWNLOAD` (`qbittorrent.start`); then
      `recomputeStatus` (`api/plan.md` § Steps 7). → T003
      *Done when:* `bin/npm api test -- downloads.service` passes with cases for: `remove*` called
      before `add*` on both stages; enqueue failure leaves source/jobs `ERROR` with the original
      key and throws `error.download.retry_enqueue_failed`; a second call after the guarded write
      matched nothing enqueues nothing; `retry_replaced`/`retry_superseded`/`retry_unavailable`
      thrown with zero writes; a non-`ERROR` upload still throws `error.download.not_a_torrent`.
- [x] **T005** `[api]` Add `sourceScanFailed` to `MediaSourcesService` and its resolver
      (`@AllowService()` + explicit `principal.type !== 'service'` rejection), extracting the
      empty-match branch's writes into one private method both paths call (`api/plan.md` § Steps 8).
      → T001
      *Done when:* `bin/npm api test -- media-sources` passes with cases for: `READY` source →
      `ERROR` with the given key and its movie/episode `ERROR`; `SCANNED` source unchanged, returns
      `true`; missing source returns `true`; the existing empty-match cases still pass unchanged.
- [x] **T006** `[api]` Regenerate and check the schema and the whole slice. → T004, T005
      *Done when:* `bin/cli api npx --no tsc --noEmit` 0 errors; `bin/npm api test` all green;
      `git status --short services/api/prisma` empty; `git diff services/api/src/schema.gql` is
      exactly `DownloadError`, `Download.lastError`, `Download.retryable`, `Mutation.sourceScanFailed`.

### Group 2 — consumers

Depends on Group 1: the fields and the mutation must exist in `schema.gql` before anyone consumes
them. `worker` and `web` do not share code and run in parallel.

- [x] **T007** `[worker] [P]` Report failed scans: add `ERROR_SOURCE_SCAN_FAILED` to
      `src/i18n/error-keys.ts` with its message in `src/i18n/messages.en.ts`; wrap
      `handleSourceReady` in `src/jobs/source-ready.job.ts`, report through `deliverReport` →
      `sourceScanFailed`, rethrow as `UnrecoverableError`; new `src/jobs/source-ready.job.spec.ts`
      with the Article IX header (`worker/plan.md` § Steps, § Tests). → T006
      *Done when:* `bin/cli worker npx --no tsc --noEmit` 0 errors; `bin/npm worker run build`
      exits 0; `bin/npm worker test` passes apart from the pre-existing `src/ffmpeg/` failures;
      removing the report call makes the new spec fail (fault injection, reverted);
      `git diff --stat services/worker/src/ffmpeg services/worker/src/encode` empty.
- [x] **T008** `[web] [P]` Retype and select: `DownloadError`, `lastError`, `retryable` in
      `src/types/downloads.ts` and `DOWNLOAD_FIELDS` in `src/actions/downloads.ts`; extract
      `translateGraphQLError`'s lookup into a pure helper in `src/lib/graphql-error.ts` taking a
      translator, with `translateGraphQLError` behaviour unchanged (`web/plan.md` § Steps 1–2).
      → T006
      *Done when:* `bin/cli web npx --no tsc --noEmit` 0 errors; `/movies/<id>` still renders its
      panel against the T006 `api` (no GraphQL "Cannot query field" error in the `web` log).
- [x] **T009** `[web]` Render it: new `src/components/downloads/DownloadErrorLine.tsx` (guarded
      `JSON.parse` of `params`, stage label, translated message with English fallback);
      `DownloadRow.tsx` shows it and renders Play by `status === "ERROR" ? retryable :
      isControllable`; `router.refresh()` after `retry_replaced`/`retry_superseded`/
      `retry_unavailable`, compared on `errorKey` (`web/plan.md` § Steps 3–4, § Contract
      obligations). → T008
      *Done when:* typecheck 0 errors; `bin/npm web run build` exits 0; on a stack with a film whose
      encode failed, its row shows the stage and message and a Play button.
- [x] **T010** `[web]` Catalogs: every key in `web/plan.md` § Steps 5 in `messages/en.json` and
      `messages/es.json` (Rioplatense), including all `error.encode.*` keys with the param names
      read from `services/worker/src/i18n/messages.en.ts`, and `downloads.panel.stage.*`. → T008
      *Done when:* `bin/cli web node scripts/check-messages.mjs` reports no drift; every key
      exported by `services/worker/src/i18n/error-keys.ts` and every key added in T001 has an
      `errors.*` entry in both files (checked with a `grep` per key, listed in the report).

### Group 3 — verification and docs

- [x] **T011** `[docs]` Add a `065` section to `docs/spec/graphql-contract.md`: `DownloadError` and
      the two fields, `downloadStart`'s widened behaviour behind an unchanged signature and its four
      new keys, `sourceScanFailed` as the second service-only mutation, and that `lastError.params`
      is a JSON string unlike `extensions.i18n.params`. → T006
      *Done when:* the section exists and its SDL matches `git diff services/api/src/schema.gql`.
- [x] **T012** `[docs]` Update `CLAUDE.md`s: root pipeline table ("Download", "Detect completion,
      enqueue", "Scan files", "Transcode" gain `065`'s resume path; "Current state" entry with the
      measured counts from T006/T007/T009); `services/api/CLAUDE.md` (`downloads/`, `media-sources/`,
      `pipeline-status/` entries); `services/worker/CLAUDE.md` § "Errors must not be swallowed"
      (scan now reports); `services/web/CLAUDE.md` (translation helper, row error line).
      → T007, T009, T010
      *Done when:* each file mentions `065` in the places listed, and the numbers in "Current state"
      come from runs made in this task, not copied from the task reports.
- [x] **T013** `[docs]` Manual pass: walk AC-1 … AC-12 (incl. AC-8b) in `spec.md` against a running
      stack following `plan.md` § Verification, tick each box that was observed, record any not run
      and why; set `status: Implemented` on `spec.md`, `plan.md`, every `<svc>/plan.md`, and
      `status: Done` here. → T011, T012
      *Done when:* every AC box is ticked or carries a one-line reason it was not run, and the five
      status fields are flipped.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

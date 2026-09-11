---
title: Deselected torrent files must never be encoded — Tasks
last_updated: 2026-09-10
status: In Progress
---

# TASKS: Deselected torrent files must never be encoded (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[worker]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Contract source: `spec.md` § GraphQL Contract Delta, frozen. Per-service briefs: `api/plan.md`,
`worker/plan.md`. Neither is editable from inside a slice (Constitution, Article VIII).

## Tasks

### Group 1 — the contract and the fact behind it (`api`)

- [x] **T001** `[api]` Add `TorrentClientFile` (`name`, `priority`, `progress`) and
      `files: (hash: string) => Promise<TorrentClientFile[]>` to
      `services/api/src/clients/torrent/types.ts`, and implement `files(hash)` in
      `services/api/src/clients/torrent/client.ts` — `GET torrents/files?hash=<hash.toLowerCase()>`,
      built with the same `new URL(…, await this.baseUrl())` + `URLSearchParams` shape as `info()`,
      throwing `TorrentClientError(message, status)` on any non-2xx (404 included), mapping each row
      to those three fields and nothing else. No retry, no timeout, no cache.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and
      `grep -n "toLowerCase" services/api/src/clients/torrent/client.ts` shows the hash normalised
      before the request.

- [x] **T002** `[api]` Add `downloadedFiles(source)` to
      `services/api/src/media-sources/media-sources.service.ts`: `null` when the row has no
      `infoHash`; otherwise `files(infoHash)` inside a `try`, returning the `name` of every row with
      `priority !== 0 && progress >= 1`; on **any** throw, log one line naming the source and return
      `null` — never `[]`, never a rethrow (REQ-2, REQ-8). Import `QbittorrentClient` from the
      `SettingsModule` export and add that import to
      `services/api/src/media-sources/media-sources.module.ts` (no new provider, no `forwardRef`). → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `bin/dev -d` brings `api`
      up healthy (`docker compose ps api` → healthy), proving the Nest module graph still resolves.

- [x] **T003** `[api]` Expose the field: `@Field(() => [String], { nullable: true }) downloadedFiles`
      on `services/api/src/media-sources/entities/media-source.entity.ts`, and a
      `@ResolveField(() => [String], { nullable: true })` on
      `services/api/src/media-sources/media-sources.resolver.ts` calling T002's method with
      `@Parent()`, typed locally against `{ infoHash: string | null }` (the Prisma row), not against
      the `MediaSource` `@ObjectType`. → T002
      *Done when:* after a restart, `grep -n "downloadedFiles" services/api/src/schema.gql` prints
      exactly `downloadedFiles: [String!]` (nullable list, non-null items), and a service-token query
      `{ mediaSource(id: <an upload-sourced id>) { downloadedFiles } }` returns `null` without
      erroring.

- [x] **T004** `[api]` Add `@Field() @IsBoolean() isDownloaded: boolean` to
      `services/api/src/media-sources/dto/source-file.input.ts`, with a comment naming the worker as
      the owner of the rule, in the spirit of `isVideo`'s. Required, no default (see `plan.md`
      § Contract Freeze).
      *Done when:* `grep -n -A3 "input SourceFileInput" services/api/src/schema.gql` shows
      `isDownloaded: Boolean!`, and a `sourceScanned` call whose `files` omit it is rejected with a
      validation message naming the field.

- [x] **T005** `[api]` Add `SOURCE_SCAN_NO_DOWNLOADED_VIDEO: 'error.source.scan_no_downloaded_video'`
      to `services/api/src/i18n/error-keys.ts` and its English rendering to
      `services/api/src/i18n/messages.en.ts` —
      `'No video file in this download has any content — check which files are selected in the torrent client'`.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and the key appears in both
      files with no `i18nError` call site (it is stored on the row, never thrown).

- [x] **T006** `[api]` Apply the two conditions inside `sourceScanned`
      (`services/api/src/media-sources/media-sources.service.ts`): `hasUnmatchedFiles` becomes
      `files.some((f) => f.isVideo && f.isDownloaded && !resolvedPaths.has(f.filePath))` (REQ-6), and
      the `resolvedMatches.length === 0` branch picks `SOURCE_SCAN_NO_DOWNLOADED_VIDEO` when
      `files.some((f) => f.isVideo && !f.isDownloaded)`, else keeps `SOURCE_SCAN_NO_VIDEO` (REQ-7).
      Everything else in that branch is unchanged, and the `files` array is never filtered (REQ-5).
      → T004, T005
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and
      `git diff services/api/src/media-sources/media-sources.service.ts` shows two changed
      conditions — no new branch, no new helper, no early return.

- [x] **T007** `[api]` Extend `services/api/src/media-sources/media-sources.service.spec.ts` with the
      six cases in `api/plan.md` § Tests (no `infoHash` → `null`; client throws → `null`, no throw;
      `priority: 0` and `progress: 0.4` rows dropped; uppercase hash sent lowercase; `hasUnmatchedFiles`
      ignoring a not-downloaded video; the two error keys). House fault-injection technique: verify each
      case fails with its rule removed before keeping it. → T002, T006
      *Done when:* `bin/npm api test` is green and its test count is **above** the root `CLAUDE.md`
      § Current state figure by the number of cases added; report both numbers.

### Group 2 — the consumer (`worker`)

The contract is frozen and, from T003/T004, actually served. T008 is pure and depends on nothing at
runtime; T010 cannot be verified end to end until Group 1 is deployed.

- [x] **T008** `[worker] [P]` Add `services/worker/src/scan/mark-downloaded.ts`:
      `InventoriedFile = ScannedFile & { isDownloaded: boolean }` and
      `markDownloaded(files, downloadedFiles, downloadPath)` — `null` list ⇒ everything `true`
      (REQ-4); otherwise a `Set` of `normalize(join(downloadPath, entry))` matched against
      `normalize(file.filePath)`, both sides normalised. Pure: no `fs`, no logging, no GraphQL. Plus
      `mark-downloaded.spec.ts` with the five cases in `worker/plan.md` § Tests — including `[]`
      behaving as "nothing downloaded", **not** as `null`.
      *Done when:* `bin/npm worker test` runs the new suite green and
      `bin/cli worker npx --no tsc --noEmit` reports 0 errors.

- [x] **T009** `[worker]` Narrow the candidate set in
      `services/worker/src/scan/select-matches.ts`: the parameter becomes `InventoriedFile[]` and the
      filter becomes `file.isVideo && file.isDownloaded`. Nothing below that line changes — not the
      `single` reduce, not the `bestByEpisode` map. Update `select-matches.spec.ts`'s fixtures and add
      AC-7's case (the **larger** video flagged `false`, the smaller `true`, smaller wins) in both
      `single` and `season` modes. → T008
      *Done when:* `bin/npm worker test` is green, the AC-7 case is verified to fail when the
      `isDownloaded` term is removed from the filter, and that verification is stated in the report.

- [x] **T010** `[worker]` Wire it into `services/worker/src/jobs/source-ready.job.ts`: add
      `downloadedFiles` to the `mediaSource` query **and** to `MediaSourceQueryResult` as
      `string[] | null` in the same edit; call `markDownloaded` between `scanFolder` and
      `selectMatches`; send the marked files — all of them — as `sourceScanned`'s `files`; log one
      line on **both** paths saying whether narrowing was applied and with how many entries, and
      distinguish "video no resuelto" from "video no bajado" in the existing skipped loop. Spanish log
      prose, English comments and identifiers (Article VI). → T008, T009, T003, T004
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports 0 errors,
      `bin/npm worker run build` exits 0, and a real completed download prints the new line in
      `docker compose logs worker`.

### Group 3 — verification and docs

- [x] **T011** `[docs]` Add a `052` section to `docs/spec/graphql-contract.md` recording
      `MediaSource.downloadedFiles` (relative paths; `null` = unknowable vs `[]` = nothing downloaded,
      and why they must not collapse), `SourceFileInput.isDownloaded` (required, worker-owned, the
      `isVideo` precedent), the two stored error keys, and the worker's consumer obligation. → T003, T004
      *Done when:* the section exists and its SDL is byte-identical to `spec.md` § GraphQL Contract
      Delta.

- [x] **T012** `[docs]` Update the `CLAUDE.md` files: the root pipeline table's **Scan files,
      inventory** row (it gains the downloaded-file list as an input; add `052` to its spec refs, and
      to the **Detect completion, enqueue** row for the new error key), `services/api/CLAUDE.md`'s
      `media-sources/` and `clients/` bullets, and `services/worker/CLAUDE.md`'s layout block plus the
      scan section (the new module, and `selectMatches` now taking `InventoriedFile[]`). → T010
      *Done when:* each edited file names `052` and no longer describes `selectMatches` as operating
      on every enumerated video.

- [ ] **T013** `[docs]` Walk every acceptance criterion in `spec.md` against the running stack
      (`plan.md` § Verification's manual pass, in order — including the deselected-file download, the
      all-deselected failure, the `docker compose stop torrent` outage and a tus upload), tick each
      box, record the final test counts and typecheck results in the root `CLAUDE.md` § Current state,
      and set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and `worker/plan.md`
      (`status: Done` on this file). → T007, T010, T011, T012
      *Done when:* every `- [ ]` in `spec.md` § Acceptance Criteria is `- [x]` with the observed
      result noted where it is not self-evident, or listed in **Blocked** below with what stopped it.
      AC-1 through AC-6 need a live stack, a real two-file torrent and a human at qBittorrent — this
      task is not complete on the strength of the unit suites alone.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T013 (AC-1) | `[docs]` | Verifying the reported bug is actually fixed requires a real two-file torrent with one file deselected in qBittorrent | Live stack (`bin/dev -d`), a real torrent, a human at the qBittorrent WebUI |
| T013 (AC-2) | `[docs]` | Same live scenario as AC-1 — inventory/`hasUnmatchedFiles` check against a real `sourceScanned` call | Same as AC-1 |
| T013 (AC-3) | `[docs]` | Requires the AC-1 encode to actually run to completion and the download folder to be observed gone | Same as AC-1, plus a full encode |
| T013 (AC-4) | `[docs]` | Requires a torrent with every video file deselected, run to completion | Live stack, a real torrent, a human at qBittorrent |
| T013 (AC-5) | `[docs]` | Requires `docker compose stop torrent` mid-flow against a real scan | Live stack, ability to stop/start the `torrent` container |
| T013 (AC-6) | `[docs]` | Requires a real tus upload through the web UI | Live stack, a browser upload |

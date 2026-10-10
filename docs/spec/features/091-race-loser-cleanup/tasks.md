---
title: The Race Loser Sweep Actually Sweeps — Tasks
last_updated: 2026-10-09
status: In Progress
---

# TASKS: The Race Loser Sweep Actually Sweeps (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

`090-replaced-source-not-an-error` is implemented, so NFR-1's gate is satisfied and
`MediaSource.retiredAt` exists. T001 exists because of what it left unfinished — see its note.

## Tasks

### Group 1 — `api`: the predicate, the sweep's new home, the field

- [x] **T001** `[api]` Plumb `retiredAt` through the sibling read in
      `src/downloads/downloads.service.ts`: add it to the `SiblingSource` type, to `siblingsOf`'s
      Prisma `select`, and to `siblingsIn`'s mapped object. Today the select omits it and
      `siblingsIn` never maps it, so every `ResumeSibling` built in this file carries
      `retiredAt: undefined` and `deriveResume`'s `?? null` turns a **retired** sibling into a race
      winner — `090` REQ-3 ("a retired source must never count as a race winner") holds in
      `resolveRace`, which reads full rows, and silently does not hold here. 091 reads this exact
      value through `hasRaceWinner`, so it must be correct before anything else lands.
      *Done when:* a unit test with one retired sibling (`SCANNED`, one `COMPLETED` job,
      `retiredAt` set) proves an `ERROR` source is **not** refused with
      `error.download.retry_superseded`, and fails against the current code.
- [x] **T002** `[api]` Export `hasRaceWinner(siblings: ResumeSibling[]): boolean` from
      `src/pipeline-status/pipeline-status.ts` as
      `siblings.some((s) => isRaceWinner(s.status, s.jobs, s.retiredAt ?? null))`, and replace that
      exact expression inside `deriveResume` with the call. No behaviour change. → T001
      *Done when:* `bin/npm api run test` passes with no test modified for this task, and
      `grep -n "isRaceWinner" src/pipeline-status/pipeline-status.ts` shows the predicate called in
      one place inside `deriveResume`.
- [x] **T003** `[api]` Add `async unwindLosingSiblings(winner)` to `DownloadsService`, mirroring
      `unwindSourcesForTitle`'s shape: resolve `targetWhere` from the winner's three ids, load
      siblings with `id: { not: winner.id }`, keep only rows where `isDeliveredSource(status, jobs,
      retiredAt)` is false **and** `retiredAt` is null, one batched
      `qbittorrent.remove(hashes, true)` through `callTorrentClient`, then `unwindSource(row, {
      removeTorrent: false })` per row, then `recomputeStatus(winner)` once. Both filter terms are
      required: `090` made `isDeliveredSource` return false for a retired source, so "not delivered"
      alone would purge it. → T001
      *Done when:* a spec case over one target holding the delivering winner, a `PAUSED` loser, a
      `SCANNED` sibling whose only job is `ERROR`, a `SCANNED` sibling with a `COMPLETED` job and a
      retired sibling asserts exactly the first two extra rows are unwound; plus a fault-injected
      case where `qbittorrent.remove` rejects and every loser row and its residue are still removed
      (REQ-4 — the failure must not short-circuit the unwind).
- [x] **T004** `[api]` Delete `sweepLosingSiblings` from `src/process-jobs/process-jobs.service.ts`,
      call `this.downloads.unwindLosingSiblings(mediaSource)` in its place inside `downloadRemove`
      — same position, after the winner's own conditional `torrentClient.remove` and **before** the
      `!mediaSource.infoHash` early return — and add `DownloadsModule` to
      `process-jobs.module.ts`'s imports. Keep `downloadRemove`'s signature, its `@AllowService()`
      guard, its `deleteFiles` default and both response strings. → T003
      *Done when:* `grep -rn "sweepLosingSiblings" services/` is empty, `bin/npm api run test`
      passes, and one case proves `downloadRemove` delegates for a source with `infoHash: null`
      while still returning `omitido: mediaSource <id> no es un torrent`.
- [x] **T005** `[api]` Add `lostRace` to `src/downloads/entities/download.entity.ts` as
      `@Field() lostRace: boolean;` and compute it in `toDownload` as `hasRaceWinner(siblings)`,
      beside the existing `retryable` and `retiredAt`. No new query and no new parameter — all four
      `toDownload` call sites already pass `siblings`. → T002
      *Done when:* `git diff -- services/api/src/schema.gql` shows `lostRace: Boolean!` on
      `Download` and nothing else, and `bin/cli api npx tsc --noEmit` is clean.
- [x] **T006** `[api]` In `downloadStart`, after `deriveSourceStatus` and after the
      `derived.status === 'ERROR'` return into `resumeErroredSource`, and before
      `requireTorrent(source)`, throw `i18nError.conflict(ERROR_KEYS.DOWNLOAD_RETRY_SUPERSEDED)`
      when `hasRaceWinner(siblings)`. The placement is load-bearing: this is the **third** refusal
      in this method, after `090`'s `source.retiredAt` guard at the top and `resumeErroredSource`'s
      `deriveResume` verdict — ahead of the `ERROR` branch it would pre-empt the more specific
      `error.download.retry_replaced`, and since both are 409s the only symptom would be a wrong
      message. → T002
      *Done when:* three spec cases pass — a `PAUSED` source whose sibling is `READY` throws 409
      `error.download.retry_superseded` and calls neither `qbittorrent.start` nor any write; an
      `ERROR` source whose last error is `error.source.replaced` and whose sibling is a winner still
      answers `error.download.retry_replaced`; and a `PAUSED` source whose only sibling is `SCANNED`
      with a failed encode is started normally with `lostRace` false (REQ-8).

### Group 2 — consumers

Both depend on Group 1 being merged: each is observable only through `api`. They share no file, no
type and no test.

- [x] **T007** `[web] [P]` Consume `lostRace`: add `lostRace: boolean` to `src/types/downloads.ts`,
      add `lostRace` to the selection set in `src/actions/downloads.ts`, fold it into `canStart`
      only, and render the mark in `DownloadRow.tsx` mirroring `090`'s `isRetired` badge
      (`<Badge variant="light" color="light" size="sm">`) with a new `downloads.panel` entry —
      `Discarded` / `Descartada` — in `messages/{en,es}.json`. **Do not** add it to
      `isControllable`: the neighbouring `090` code hides Stop for a retired row, and REQ-6 requires
      the opposite here — a loser whose stop call failed is still downloading and Stop is the user's
      only remedy. Nothing is owed a test (`web/plan.md` § Tests). → T005, T006
      *Done when:* `bin/cli web npx tsc --noEmit`, `bin/cli web node scripts/check-messages.mjs` and
      `bin/comments web` pass, and in `/downloads` a loser row shows the `PAUSED` badge with a
      "Descartada" mark, no error line, no Play and a working Stop.
- [x] **T008** `[worker] [P]` Drop `&& infoHash` from the `removeTorrent` condition in
      `src/jobs/cleanup-source.ts`, extend its locator to `// Spec 013, REQ-8; Spec 091, REQ-1`, and
      invert the two tests in `src/jobs/cleanup-source.spec.ts` that currently assert
      `downloadRemove` is never called — the `LOCAL_FILE` case and the `LOCAL_FOLDER` case — so each
      asserts it **was** called with that `mediaSourceId`, keeping the folder-deletion assertions as
      they are. Rename the cases rather than deleting them: they are the record of the decision.
      `infoHash` stays on `CleanupInput` and stays destructured for the filesystem branches below.
      → T004
      *Done when:* `bin/npm worker test` and `bin/cli worker npx tsc --noEmit` pass,
      `bin/comments worker` passes, and `grep -n "removeTorrent &&" services/worker/src` is empty.

### Group 3 — docs

- [x] **T009** `[docs]` Update the three `CLAUDE.md` files. Root: the *Download* stage gains the
      sweep's repair (`091`), and the *Detect completion, enqueue* stage is explicitly unchanged.
      `services/api/CLAUDE.md`: the loser sweep now lives in `downloads/`, not `process-jobs/`, and
      `pipeline-status/` gains `hasRaceWinner` as the one reader of "someone already won".
      `services/worker/CLAUDE.md`: its post-encode cleanup paragraph already claims `cleanupSource`
      "branches on `sourceKind`, not `infoHash`" — note that this is now true of the
      `downloadRemove` call too. → T007, T008
      *Done when:* each file names `091` where the behaviour changed, and no file still describes
      the sweep as living in `process-jobs/`.
- [ ] **T010** `[docs]` Walk AC-1 through AC-9 in `spec.md` against the running stack following
      `plan.md` § Verification, tick each box, set `status: Implemented` on `spec.md`, `plan.md` and
      the three `<svc>/plan.md`, and append the post-flight measurement to `docs/spec/history.md`
      (newest first, per `086` REQ-11 — never into the root `CLAUDE.md`). → T009
      *Done when:* every AC box is ticked or listed in **Blocked** with a reason, and
      `git diff --stat -- services/api/prisma` is empty, proving the "no migration" claim.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T010 (AC-1–AC-8) | `[docs]` | All automated verification passed (`bin/npm api run test` 1000/1000, `bin/npm worker test` 323/323, `bin/cli web npx tsc --noEmit`, `bin/cli web node scripts/check-messages.mjs`, `bin/comments api/web/worker` all clean, no Prisma diff, `sweepLosingSiblings` gone tree-wide). The eight live-race acceptance criteria (AC-1 through AC-8) require the manual pass in `plan.md` § Verification steps 1–8 against the actually-running dev stack — real torrents attached, real qBittorrent downloads, real encode time, a deliberately-stopped `torrent` container for AC-4. That is a real-world action against the user's live stack (bandwidth, wall-clock time, picking test content) that the orchestrator should not launch unprompted. | The user to run the manual pass (or explicitly direct the orchestrator to drive it) |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.

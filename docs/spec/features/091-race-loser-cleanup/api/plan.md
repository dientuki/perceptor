---
title: The Race Loser Sweep Actually Sweeps — api slice
service: api
last_updated: 2026-10-08
status: Approved
---

# PLAN: The Race Loser Sweep Actually Sweeps — `api` (`api/plan.md`)

## Scope

`api` owns everything but two lines in other services. It moves the loser sweep out of
`process-jobs/` into `downloads/` so it runs through the existing per-source unwind, narrows what
the sweep selects to sources that actually lost, recomputes the target afterwards, exposes
`Download.lostRace`, and refuses `downloadStart` for a source whose target already has a winner.

It is **not** changing how a loss is recorded: `resolveRace` keeps writing a loser `PAUSED` and a
late finisher `ERROR` / `error.source.superseded`, and its `continue` stays (`spec.md` § Out of
Scope says why — the row says `DOWNLOADING` because it is downloading, and REQ-6's Stop is the
remedy). It is not hiding any button — `web` owns that — and not changing when the worker calls
`downloadRemove`, which is `worker`'s one line. There is no migration.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/pipeline-status/pipeline-status.ts` | Modified | `hasRaceWinner(siblings)` exported; `deriveResume`'s inline `siblings.some(isRaceWinner)` calls it instead |
| `services/api/src/downloads/downloads.service.ts` | Modified | `unwindLosingSiblings(winner)` added (public, REQ-2/3/4/5); `lostRace` computed in `toDownload`; the `downloadStart` refusal |
| `services/api/src/downloads/entities/download.entity.ts` | Modified | `lostRace: Boolean!` field |
| `services/api/src/process-jobs/process-jobs.service.ts` | Modified | `sweepLosingSiblings` **deleted**; `downloadRemove` calls `DownloadsService.unwindLosingSiblings` |
| `services/api/src/process-jobs/process-jobs.module.ts` | Modified | imports `DownloadsModule` |
| `services/api/src/downloads/downloads.service.spec.ts` | Modified | the REQ-2 selection cases and the REQ-6 refusal |
| `services/api/src/process-jobs/process-jobs.service.spec.ts` | Modified | the sweep's assertions follow it out of this file |
| `services/api/src/schema.gql` | Regenerated | `lostRace` — artifact only, never hand-edited (Article IV) |

## Existing code to reuse

- `downloads/downloads.service.ts`'s `private unwindSource(source, { removeTorrent })` — the one
  per-source unwind: torrent client, `encodeQueue.publishCancel` + `removeEncode` per job,
  `queue.removeSourceReady`, `deleteResidue`, then `prisma.mediaSource.delete`. REQ-3 **is** calling
  this. Do not add a second removal sequence beside it.
- `downloads/downloads.service.ts`'s `unwindSourcesForTitle(scope)` (`067`) — the exact shape
  `unwindLosingSiblings` should mirror: collect the rows, one batched
  `qbittorrent.remove(hashes, true)` through `callTorrentClient`, then `unwindSource(row, {
  removeTorrent: false })` per row. Copy the shape, not the body.
- `downloads/downloads.service.ts`'s `private recomputeStatus(source)` — REQ-5's recompute, already
  routing to `recomputeMovie`/`recomputeEpisode`/`recomputeSeason`. Call it once after the sweep.
- `downloads/downloads.service.ts`'s `jobsBySourceId(ids)` and `hasDeliveredSource`/
  `demoteDeliveredSources` (`087`) — the established way to evaluate `isDeliveredSource` over a set
  of rows in two queries. REQ-2's "not delivered" test follows `demoteDeliveredSources`' filter
  shape.
- `downloads/downloads.service.ts`'s `private callTorrentClient(fn)` — the try/log/degrade wrapper.
  REQ-4 is this wrapper applied so the failure cannot escape past the batched remove.
- `pipeline-status/pipeline-status.ts`'s `isRaceWinner` and `isDeliveredSource` — the two
  predicates. Neither changes.
- `downloads/downloads.service.ts`'s `siblingsOf(source)` / module-level `siblingsIn(...)` and the
  `siblings: ResumeSibling[]` parameter already threaded through all four `toDownload` call sites
  (lines ~257, ~398, ~421, ~466). `lostRace` needs **no** new query and no new parameter.

## Steps

1. In `pipeline-status/pipeline-status.ts`, export
   `hasRaceWinner(siblings: ResumeSibling[]): boolean` as
   `siblings.some((sibling) => isRaceWinner(sibling.status, sibling.jobs))`, and replace that exact
   expression inside `deriveResume` with the call. `deriveResume`'s behaviour must not change.
2. In `downloads/downloads.service.ts`, add
   `async unwindLosingSiblings(winner: { id: number; movieId: number | null; episodeId: number | null; seasonId: number | null }): Promise<void>`:
   resolve `targetWhere` from the winner's three ids (return early when all are null); load the
   siblings with `id: { not: winner.id }`; load their jobs with `jobsBySourceId`; keep only rows
   where `isDeliveredSource(row.status, jobs)` is **false** *and* `row.retiredAt` is null; batch one
   `qbittorrent.remove(hashes, true)` through `callTorrentClient`; `unwindSource(row, { removeTorrent: false })`
   per remaining row; then `recomputeStatus(winner)` once.
3. In `toDownload`, compute `lostRace: hasRaceWinner(siblings)` beside the existing `retryable`, and
   add the field to the returned object.
4. In `downloads/entities/download.entity.ts`, declare `@Field() lostRace: boolean;`.
5. In `downloads/downloads.service.ts`'s `downloadStart`, **after** `deriveSourceStatus` and
   **after** the `derived.status === 'ERROR'` early return into `resumeErroredSource`, and **before**
   `requireTorrent(source)`: if `hasRaceWinner(siblings)`, throw
   `i18nError.conflict(ERROR_KEYS.DOWNLOAD_RETRY_SUPERSEDED)`. The placement is load-bearing — ahead
   of the `ERROR` branch it would pre-empt `deriveResume`'s more specific
   `error.download.retry_replaced` for a `090` replaced source, and both are 409s so the only
   symptom would be a wrong message.
6. In `process-jobs/process-jobs.service.ts`, delete `sweepLosingSiblings` entirely and replace its
   call in `downloadRemove` with `this.downloads.unwindLosingSiblings(mediaSource)`. Keep the call
   where it is: after the winner's own conditional `torrentClient.remove`, **before** the
   `!mediaSource.infoHash` early return. Keep that early return and its `omitido:` string exactly
   as they are — it is the response to the call `worker` is about to start sending.
7. In `process-jobs/process-jobs.module.ts`, add `DownloadsModule` to `imports`, and inject
   `DownloadsService` into `ProcessJobsService`. `DownloadsModule` exports it and does not import
   `ProcessJobsModule`, so there is no cycle; if one appears, stop and report rather than reaching
   for `forwardRef`.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

- `Download.lostRace: Boolean!` — non-null on every `Download`, mutation results included (the same
  rule `owned` already follows). True exactly when another source of this target is a race winner by
  `isRaceWinner`. Derived per request. Never a column.
- `downloadStart` on such a source: `ConflictException` (409) with
  `extensions.i18n.key = error.download.retry_superseded`. The key already exists in
  `i18n/error-keys.ts` and `i18n/messages.en.ts` with this copy and is already thrown as a 409 by
  `resumeErroredSource` — do not add a key, do not add a second status for this key, do not produce
  a new message.
- `downloadRemove(mediaSourceId: Int!, deleteFiles: Boolean = true): String!` — signature, guard,
  default and both response strings unchanged.

## Tests

`services/api/src/downloads/downloads.service.spec.ts`:

- **REQ-2 selection** — the silent failure this whole slice exists for. A target holding: the
  delivering winner, a `PAUSED` loser, a `SCANNED` sibling whose only job is `ERROR` (not delivered,
  must be purged), a `SCANNED` sibling with a `COMPLETED` job (delivered, must survive), and a
  retired sibling (`retiredAt` non-null, must survive). Assert exactly which ids are unwound. A
  status-shaped filter (`status !== 'SCANNED'`) passes a one-loser test and fails this one, which is
  the point.
- **REQ-4** — `qbittorrent.remove` rejecting must still delete every loser row and still delete
  residue. Fault-injected, and it is the unit half of AC-4; the live half is the manual pass.
- **REQ-6** — `downloadStart` on a `PAUSED` source whose sibling is `READY` throws a 409 with
  `error.download.retry_superseded` and calls neither `qbittorrent.start` nor any write. Plus the
  ordering case: an `ERROR` source whose last error is `error.source.replaced` and whose sibling is
  a winner must still answer `error.download.retry_replaced`, not `retry_superseded`.
- **REQ-8** — the same `PAUSED` source whose only sibling is `SCANNED` with a failed encode: no
  refusal, `lostRace` false, `qbittorrent.start` called.

`services/api/src/process-jobs/process-jobs.service.spec.ts`: the existing sweep assertions move to
the `DownloadsService` spec with the code. What stays here is one case proving `downloadRemove`
delegates — including for a source with `infoHash: null`, where the sweep must still run and the
`omitido:` string must still come back.

Not owed a test: `hasRaceWinner` itself (a one-line extraction of an expression already covered
through `deriveResume`), the entity field, and the module wiring — a missing import fails at boot,
loudly.

## Done when

```bash
bin/npm api run test
bin/cli api npx tsc --noEmit
bin/comments api
grep -rn "sweepLosingSiblings" services/          # empty
git diff --stat -- services/api/prisma            # empty
git diff -- services/api/src/schema.gql           # lostRace only
```

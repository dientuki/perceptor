---
title: Stop and resume a running encode — web slice
service: web
last_updated: 2026-10-17
status: Implemented
---

# PLAN: Stop and resume a running encode — `web` (`web/plan.md`)

## Scope

Three things. The parent row shows Stop while it reads `ENCODING` and Play while it reads `PAUSED`,
for an upload as well as a torrent (REQ-10). The child row shows Pause on a `QUEUED`/`ENCODING` job
and Play on a `PAUSED` one (REQ-14), calling the new `encodeJobStop` and the existing
`encodeJobStart`. `DownloadJob.status` accepts `PAUSED` (REQ-13).

REQ-15/16 need nothing here: `Download.lostRace` already decides whether a row offers Play
(`canStart` and `canAct` both read it), and `api` now flips it when a source is stopped or resumed.

`web` never tells an encode pause from a torrent pause (`../plan.md` § Contract Freeze) and does not
touch `api` or `worker`.

Writes are confined to `services/web/`.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/downloads.ts` | Modified | `DownloadJob.status` comment lists `PAUSED` |
| `src/actions/downloads.ts` | Modified | `ENCODE_JOB_STOP_MUTATION` + `stopEncodeJobAction` |
| `src/components/downloads/DownloadRow.tsx` | Modified | `canStop` / `canStart` predicates |
| `src/components/downloads/DownloadJobRow.tsx` | Modified | Pause button; Play on `PAUSED` |
| `messages/en.json`, `messages/es.json` | Modified | `error.processJob.not_running`; child-row pause/resume titles and default errors |

## Existing code to reuse

- `src/actions/downloads.ts`'s `startEncodeJobAction`/`discardEncodeJobAction` — the exact shape
  for `stopEncodeJobAction` (same selection set, `redirectIfUnauthenticated`, `toActionError`).
- `DownloadJobRow.tsx`'s `handleRetry`, `REFRESH_ON_KEYS`, `rowError` — the pause handler is the
  same pattern; Play on a `PAUSED` job reuses `handleRetry` (it already calls `encodeJobStart`).
- `DownloadRow.tsx`'s `handleStart`/`handleStop` — unchanged; only when the buttons render changes.
- `StatusBadge.tsx` already renders `PAUSED`.
- `lucide-react`'s `Pause`/`Play`, as `DownloadRow` already imports `Play`/`Square`.

## Steps

1. `types/downloads.ts`: add `PAUSED` to the `DownloadJob.status` comment.
2. `actions/downloads.ts`: `ENCODE_JOB_STOP_MUTATION` selecting what `ENCODE_JOB_START_MUTATION`
   selects; `stopEncodeJobAction(processJobId)`.
3. `DownloadRow.tsx`:
   - `canStop = owned && !isRetired && status !== "DISCARDED" && (status === "ENCODING" || infoHash != null)`
     — replaces `isControllable` as the Stop condition.
   - `canStart` gains: `owned && !isRetired && !lostRace && status === "PAUSED"` regardless of
     `infoHash`; and is false while `status === "ENCODING"` (Stop only on an encoding row).
4. `DownloadJobRow.tsx`:
   - `canPause = canAct && ["QUEUED", "ENCODING"].includes(job.status)` → Pause button calling
     `stopEncodeJobAction`.
   - `canRetry` becomes `canAct && ((status === "ERROR" && retryable) || status === "PAUSED")`. Use a
     Play icon and a resume title for `PAUSED`, keep `RotateCcw` and the retry title for `ERROR`.
   - Add `error.processJob.not_running` to `REFRESH_ON_KEYS` (the job moved on since the page
     rendered).
   - `DISCARDABLE` gains `PAUSED` (spec REQ-13).
5. Catalogs: `error.processJob.not_running` (`es`: `Este archivo no se está codificando`), the
   pause/resume button titles, and `pauseErrorDefault`, in both `en.json` and `es.json`.

## Contract obligations

Consumes `encodeJobStop(processJobId: Int!): Download!` (new) and `encodeJobStart`,
`downloadStart`, `downloadStop` (unchanged signatures). Errors that can reach a row, all rendered
through `rowError` from `toActionError`: `error.processJob.not_found`,
`error.download.retry_replaced`, `error.download.retry_superseded`, `error.processJob.not_running`
(new), `error.processJob.not_resumable`, `error.download.retry_enqueue_failed`,
`error.download.not_a_torrent`, `error.source.not_found`. `error.encode.stopped` never reaches `web`.

## Tests

None owed: the change is which buttons render and one action with the existing error mapping. A
wrong predicate is immediately visible on `/downloads` (Article IX). Covered by AC-1, AC-3, AC-12,
AC-17 and AC-18 in the manual pass; `check-messages.mjs` covers catalog parity.

## Done when

```bash
bin/cli web npx tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments web
```

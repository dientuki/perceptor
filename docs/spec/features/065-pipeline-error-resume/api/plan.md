---
title: Pipeline Error Visibility and Resume — api slice
service: api
last_updated: 2026-09-19
status: Approved
---

# PLAN: Pipeline Error Visibility and Resume — `api` (`api/plan.md`)

## Scope

`api` exposes the last error and the retry verdict on every `Download`, makes `downloadStart`
resume an `ERROR` source from the stage that failed, stops counting a failed encode as a race
winner, and adds the service-only `sourceScanFailed` mutation the worker will call. It owns every
new error key and its English message.

Not this slice: rendering or translating anything (`web`), catching the scan failure and calling
the mutation (`worker`), `docs/spec/graphql-contract.md` and the root `CLAUDE.md` (`[docs]`).

Writes are confined to `services/api/`. No Prisma change — if one seems needed, stop and report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/pipeline-status/pipeline-status.ts` | Modified | add `isRaceWinner` and `deriveResume` (pure) |
| `src/pipeline-status/pipeline-status.spec.ts` | Modified | cases for both |
| `src/downloads/entities/download-error.entity.ts` | New | `DownloadError` `@ObjectType` |
| `src/downloads/entities/download.entity.ts` | Modified | `lastError`, `retryable` fields |
| `src/downloads/downloads.service.ts` | Modified | `toDownload` fills the two fields; `downloadStart` ERROR branch; `resolveRace` uses `isRaceWinner`; lists load sibling data |
| `src/downloads/downloads.service.spec.ts` | Modified | resume ordering, refusal, idempotency |
| `src/downloads/downloads.module.ts` | Modified (if needed) | nothing new should be needed — `ProcessQueueService`/`EncodeQueueService` are already injected |
| `src/media-sources/media-sources.service.ts` | Modified | `sourceScanFailed`; empty-match branch writes extracted |
| `src/media-sources/media-sources.resolver.ts` | Modified | `sourceScanFailed` mutation, `@AllowService()` + explicit principal check |
| `src/media-sources/media-sources.service.spec.ts` | Modified | guarded transition cases |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | six new keys (below) |
| `src/schema.gql` | Regenerated | never hand-edited (Article IV) |

## Existing code to reuse

- `src/pipeline-status/pipeline-status.ts` — `deriveSourceStatus` is where "is this row `ERROR`"
  is decided. `deriveResume` takes its `status` as input; it never re-derives it.
- `DownloadsService.jobsBySourceId` — already one query per list; extend its `select` with `id`,
  `errorKey`, `errorParams`, `errorMessage` so job errors need no second query. It stays one query.
- `DownloadsService.recomputeStatus` (`047`) — the only way this slice writes `Movie.status`/
  `Episode.status` after a resume. Do not write `ENCODING`/`DOWNLOADING` by hand.
- `ProcessJobsService.requeueOrphanedEncodes` (`054`) — the ordering to copy for the encode resume
  (rows `WAITING` → `removeEncode` + `addEncode` → guarded flip to `QUEUED`). It is private and
  shaped for recovery (`recoveryCount: { increment: 1 }`); do not call it — the resume resets
  `recoveryCount` to `0` and clears the error. Write the resume in `DownloadsService` with the same
  ordering, and say so in the commit.
- `ProcessQueueService.removeSourceReady` + `addSourceReady` — the scan re-enqueue, in that order.
- `DownloadsService.callTorrentClient` / `liveInfoForHash` — the download-stage resume and the live
  reading for the returned row.
- `MediaSourcesService.sourceScanned`'s empty-match branch (the `resolvedMatches.length === 0`
  block) — its writes (source `ERROR` + key/params/message; `Movie`/`Episode` → `ERROR`) become one
  private method taking `(tx, mediaSource, errorKey, errorParams, errorMessage)`, called from both
  `sourceScanned` and `sourceScanFailed`.
- `ProcessJobsResolver.encodeWorkerStarted` — the `@AllowService()` + `principal.type !== 'service'`
  → `i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED)` pattern for `sourceScanFailed`.
- `i18nError.{badRequest, conflict, serviceUnavailable}` — every new thrown key.

## Steps

1. **Keys.** Add to `error-keys.ts` and `messages.en.ts` (English; `web` owns `es`):
   `DOWNLOAD_TORRENT_CLIENT_ERROR` `error.download.torrent_client_error` (`{state}`),
   `SOURCE_SCAN_FAILED` `error.source.scan_failed` (`{detail}`),
   `DOWNLOAD_RETRY_REPLACED` `error.download.retry_replaced`,
   `DOWNLOAD_RETRY_SUPERSEDED` `error.download.retry_superseded`,
   `DOWNLOAD_RETRY_UNAVAILABLE` `error.download.retry_unavailable`,
   `DOWNLOAD_RETRY_ENQUEUE_FAILED` `error.download.retry_enqueue_failed`.
2. **`isRaceWinner(status, jobs)`** in `pipeline-status.ts`: `READY` → true; `SCANNED` → false iff
   some job is `ERROR` and none is `WAITING`/`QUEUED`/`ENCODING`, else true; anything else → false.
3. **`deriveResume`** in `pipeline-status.ts`. Input: the derived status; the source's `status`,
   `infoHash`, `downloadPath`, stored error fields and `updatedAt`; its jobs with status, error
   fields and `updatedAt`; the live reading's raw state; its siblings' `(status, jobs)`. Output:
   `lastError` (`null` unless derived status is `ERROR`), `retryable`, and when not retryable the
   refusal key. Rules, in order:
   - **Candidates** for `lastError`: the source's stored error if its column is `ERROR`; each job
     whose status is `ERROR`. Most recent `updatedAt` wins. None, and the raw live state is `error`
     or `missingFiles` → `torrent_client_error` `{state}`, stage `DOWNLOAD`.
   - **Stage**: a key of `error.source.replaced` (source or job) → `REPLACED`; any other job error →
     `ENCODE`; `error.source.no_download_path` → `DOWNLOAD`; any other source error → `SCAN`.
   - **Null stored key** (rows written before `018`): report `error.source.scan_failed` (source) or
     `error.encode.unexpected` (job) with `{ detail: errorMessage }` — `key` is non-null in the
     contract. `error.encode.unexpected` is worker-owned; reuse the string, do not add it to
     `ERROR_KEYS` unless `messages.en.ts` needs it to render.
   - **Refusal**, first match wins: stage `REPLACED` → `retry_replaced`; any sibling
     `isRaceWinner` → `retry_superseded`; key `no_download_path`, or stage `SCAN` with no
     `downloadPath`, or stage `DOWNLOAD` with no `infoHash` → `retry_unavailable`. Otherwise
     retryable.
4. **Entities.** `DownloadError { stage, key, params, message }` (all `String`, `params`
   nullable); `Download.lastError` nullable, `Download.retryable: Boolean!`.
5. **Lists.** `toDownload` gains the siblings argument and calls `deriveResume`. `movieDownloads`
   and `showDownloads` already hold every sibling (siblings = same `movieId`, same `episodeId`,
   same `seasonId`); group in memory, no extra query. Load `errorKey/errorParams/errorMessage/
   updatedAt` on sources (already on the row via `findMany`) and on jobs (step "reuse" above).
6. **`resolveRace`** calls `isRaceWinner` for `alreadyWon`, loading the siblings' jobs with
   `jobsBySourceId`. The `losers` filter is unchanged.
7. **`downloadStart`.** `findOwnedSource`; load its jobs, siblings (+ their jobs) and live reading;
   derive status. Not `ERROR` → existing code unchanged (`requireTorrent` stays there). `ERROR` →
   `deriveResume`; if refused, throw its key (`conflict` for replaced/superseded, `badRequest` for
   unavailable) before any write. Then by stage:
   - `ENCODE`: snapshot the `ERROR` jobs' error fields; guarded `updateMany where id in … and status
     = ERROR` → `WAITING`, `progress 0`, `encodeSpeed null`, `recoveryCount 0`, error fields `null`.
     Only the ids that matched continue (NFR-2: a second concurrent Play matches none and falls
     through to the non-`ERROR` path's result). For each: `removeEncode`, `addEncode`. Any throw →
     guarded `WAITING → ERROR` restoring the snapshot, throw `retry_enqueue_failed`
     (`serviceUnavailable`). Success → guarded `WAITING → QUEUED`.
   - `SCAN`: guarded `updateMany where id and status = ERROR` → `READY` (error fields left; the scan
     outcome overwrites or clears them). No match → nothing to do (NFR-2). `removeSourceReady`,
     `addSourceReady`; throw → guarded `READY → ERROR`, throw `retry_enqueue_failed`.
     Call `resolveRace` after the `READY` write so any sibling downloading meanwhile is paused.
   - `DOWNLOAD` (live torrent error): today's `callTorrentClient(() => qbittorrent.start(hash))`.
   Then `recomputeStatus(source)` (REQ-12) and return `toDownload` of the re-read row.
8. **`sourceScanFailed(mediaSourceId, errorKey, errorParams, errorMessage)`** in
   `MediaSourcesService`: in a transaction, guarded on the source existing and being `READY`; if
   not, log and return `true`. Otherwise the extracted empty-match writes. Resolver:
   `@AllowService()`, principal check, returns `Boolean`.
9. `bin/npm api run start:dev` once (or let the dev container reload) to regenerate `schema.gql`;
   confirm the diff is exactly the four additions.

## Contract obligations

Expose exactly `../spec.md` § GraphQL Contract Delta: `DownloadError`, `Download.lastError`
(non-null iff `status == "ERROR"`), `Download.retryable` (false whenever `status != "ERROR"`),
`downloadStart` widened with the four new keys, `sourceScanFailed`. `lastError.params` is the stored
JSON string passed through, `null` when the column is `null` — never re-encoded, never an object.
`lastError.message` is the stored English `errorMessage` (or `messages.en.ts`'s rendering for the
synthetic `torrent_client_error` / null-key cases).

If `064-global-downloads-page` has landed when you start, its global query must build rows through
`toDownload` with siblings supplied; if it has not, note in your report that `064`'s implementer
owns that.

## Tests

- `src/pipeline-status/pipeline-status.spec.ts` — `isRaceWinner` and `deriveResume`. Defends
  against the arbiter and the Play button disagreeing about the winner (two encodes of one title,
  no error anywhere), a stale error on a `COMPLETED` job being shown as "last", and a replaced
  source being resumable. Fault-inject: drop the "no active job" clause and the still-encoding case
  must fail.
- `src/downloads/downloads.service.spec.ts` — resume ordering with queues mocked: `remove*` called
  before `add*` for both stages (BullMQ's silent no-op on a retained id); enqueue failure restores
  `ERROR` and the snapshot; a second `downloadStart` after the guarded write matched nothing does
  not enqueue; refusal throws before any write; `resolveRace` treats a failed-encode `SCANNED`
  sibling as not won.
- `src/media-sources/media-sources.service.spec.ts` — `sourceScanFailed` on a `SCANNED` source
  changes nothing (the lost-response case); on a missing source returns `true`.
- Not owed: the entity files, the resolver's plumbing beyond the principal check (the check itself
  is covered by AC-11 live; add a resolver test only if one already exists for
  `encodeWorkerStarted`'s check, to follow it).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
git status --short services/api/prisma
git diff --stat services/api/src/schema.gql
```

0 type errors; suites pass; `prisma` empty; `schema.gql` diff limited to the delta.

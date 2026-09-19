---
title: Duplicate Torrent Add — api slice
service: api
last_updated: 2026-09-18
status: Approved         # Draft | Approved | Implemented
---

# PLAN: Duplicate Torrent Add — `api` (`api/plan.md`)

## Scope

`api` is the only service in this feature. It changes what the three `attachTorrentSource` twins do
when the `infoHash` being added is already attached to the **same** target. Nothing else changes:
not the different-target conflict, not the genuine first add, not `QbittorrentClient.add()`'s
folder naming, not `torrentCompleted`, not the schema and not the GraphQL surface. Rows already
carrying a wrong `downloadPath` are left alone (spec NFR-2). `web` and `worker` are untouched.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/movies/movies.service.ts` | Modified | Same-target branch of `attachTorrentSource` split into no-op / reactivate / genuine add |
| `services/api/src/episodes/episodes.service.ts` | Modified | Same change, episode twin |
| `services/api/src/seasons/seasons.service.ts` | Modified | Same change, season twin |
| `services/api/src/movies/movies.module.ts` | Modified | Import `DownloadsModule` |
| `services/api/src/episodes/episodes.module.ts` | Modified | Import `DownloadsModule` |
| `services/api/src/seasons/seasons.module.ts` | Modified | Import `DownloadsModule` |
| `services/api/src/movies/movies.service.spec.ts` | Modified | New cases (see Tests) plus a `DownloadsService` mock provider |
| `services/api/src/episodes/episodes.service.spec.ts` | Modified | Same |
| `services/api/src/seasons/seasons.service.spec.ts` | Modified | Same |

No new module, no new client method, no new file under `src/`.

## Existing code to reuse

- `QbittorrentClient.info()` (`src/clients/torrent/client.ts`). Called with no tag, it returns
  every torrent as `TorrentClientInfo`. Match `hash` lowercased against the lowercased `infoHash`
  (indexer hashes used to be stored uppercase). `state === SourceStatus.READY` means qBittorrent
  reports the torrent finished (`mapTorrentState` returns `READY` whenever `completion_on !== -1`).
  It throws `TorrentClientError` on any failure; **let it propagate**.
- `QbittorrentClient.start(hash)`. It already lowercases, and it throws `TorrentClientError` on
  non-2xx. Let that propagate too.
- `DownloadsService.handleTorrentCompleted(infoHash)` (`src/downloads/downloads.service.ts`). It is
  the one path REQ-4 must run. It ignores `READY`/`SCANNED`/`ERROR` rows, so it must be called
  **after** the row is written back to `QUEUED`. Its string return value is a log line; the attach
  path does not branch on it.
- `DownloadsModule` already `exports: [DownloadsService]`.
- **Do not** use `DownloadsService`'s private `liveInfoForHash()` pattern. Its `try/catch` returns
  `undefined` on a client failure, which here would mean "torrent absent" and route an unreachable
  client into the genuine-add path.
- **Do not** route these calls through `DownloadsService.callTorrentClient` or map them to
  `TORRENT_CLIENT_REJECTED`. The attach path's existing error for a client failure is `add()`'s raw
  `TorrentClientError`, and NFR-1 keeps it.

## Steps

The new flow of each twin, in this order. The movie twin has no demote-on-`force` block, so step 5
does not apply to it.

1. **Ownership lookup (unchanged).** Load the target, scoped by user.
2. **`existingSource` lookup and the different-target conflict checks (unchanged)**, including
   `error.magnet.already_attached`. In all three twins they currently run
   **after** the `COMPLETED`/`force` check. Move them above it; their logic does not change.
3. **REQ-1/REQ-2, the no-op.** If `existingSource` belongs to this target and
   `existingSource.status !== 'ERROR'`, return the target now with the twin's existing final read:
   - movie: a plain `movie.findUniqueOrThrow({ where: { id } })`, **not** the trailing `update`;
   - episode: `episode.findUniqueOrThrow`;
   - season: the same `season.findUniqueOrThrow` **with `episodes` included**.

   No qBittorrent call, no write, no `force` handling.
4. **`COMPLETED`/`force` conflict check (unchanged)**, now running only for a first add or an
   `ERROR` reactivation.
5. **For the episode and season twins, `activeSource` for the demote block (unchanged).**
6. **REQ-3/REQ-4, an `ERROR` duplicate.** If `existingSource` belongs to this target (so it is
   `ERROR` by now), call `info()` and find the hash.
   - **Held and not finished:** `start(hash)`, then the existing demote-on-`force` block (episode
     and season), then `mediaSource.update` setting **only** `status: 'QUEUED'`, `errorMessage:
     null`, `errorKey: null` and `errorParams: null`. `downloadPath`, `downloadUrl`,
     `releaseTitle` and `kind` stay as they are. Then the target's `DOWNLOADING` write and final
     read, as today.
   - **Held and finished (`READY`):** no `start()`. Run the same demote, the same row update and
     the same target write, then `await downloadsService.handleTorrentCompleted(hash)`. Then run
     the final read, so the returned target reflects whatever `ENCODING` write it made.
   - **Not held:** fall through to today's code: `add()` produces a new `downloadPath`, and the
     existing `update` branch writes it together with `downloadUrl`/`releaseTitle`/`kind`.

   Every qBittorrent call here happens before any DB write, keeping today's "the client accepts
   first, then we write" ordering (NFR-1).
7. **A first add (no `existingSource`) is unchanged.**
8. Add `DownloadsModule` to the `imports` of the three modules and inject `DownloadsService` into
   the three services.

Keep the three twins structurally identical. A reader diffing them should see only the target
type change. No new comment beyond what Article XI allows. The legacy Spanish comments these
methods already carry follow Article XI's "leave until editing" rule: a comment on a line you
rewrite may go, but do not translate or delete untouched ones wholesale.

## Contract obligations

None. `../spec.md` § GraphQL Contract Delta is "None": all six mutations keep their signatures,
return types and error keys. `services/api/src/schema.gql` must not change. If it does after a
boot, a decorator was touched by mistake. Stop and report.

## Tests

Every case below is owed under Article IX: each one fails today with a successful response and
nothing in any log. Add them to the existing `attachTorrentSource`/`addTorrentTo*` describe blocks
of `movies.service.spec.ts`, `episodes.service.spec.ts` and `seasons.service.spec.ts`. Extend each
file's header paragraph with one sentence naming this failure class (a duplicate add silently
re-pointing `downloadPath` at an empty folder). Mock `DownloadsService` as a provider with a
`handleTorrentCompleted` jest fn. Use the fault-injection standard: each case must fail when the
rule it covers is removed.

Per twin:

- **Active duplicate is a no-op:** an existing same-target row in `DOWNLOADING`. Assert that
  `add`, `info` and `start` were never called, that `mediaSource.update`/`create` were never
  called, and that the target's `update` was never called (movie). Include a second URL that
  differs from the first, the case that triggered the bug.
- **No-op holds under `force` and `COMPLETED`:** a `COMPLETED` target with a `SCANNED`
  same-target row and `force: true`. Assert no refusal, no demote `updateMany`, and no row write.
  Fault injection: move the no-op below the `COMPLETED` check and the case must fail.
- **`ERROR` duplicate, held and not finished:** assert `start(hash)` is called, `add` is not, and
  the row update's `data` contains no `downloadPath`/`downloadUrl` key.
- **`ERROR` duplicate, held and finished:** assert `start` is not called and
  `handleTorrentCompleted(hash)` is called **after** the row update. Check the jest
  `invocationCallOrder`.
- **`ERROR` duplicate, not held:** assert `add` is called and its returned path is written, which
  is today's behaviour, pinned.
- **`ERROR` duplicate, client unreachable:** `info` rejects with a `TorrentClientError`. Assert the
  same error propagates and that no `mediaSource`, target or demote write happened (AC-5).

The different-target conflict (REQ-5) already has coverage in `movies.service.spec.ts`
(`addMagnetToMovie (attachTorrentSource conflict key)`). Confirm it still passes; do not duplicate
it.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
git status --short services/api/prisma
git diff --stat services/web services/worker
```

- The typecheck reports 0 errors.
- The test suite is green, and the count grows by the new cases (baseline: `536`/`46` suites
  after `059`; re-measure first rather than trusting that number).
- `prisma/` is empty.
- `web`/`worker` are empty.
- `src/schema.gql` is not in the diff.

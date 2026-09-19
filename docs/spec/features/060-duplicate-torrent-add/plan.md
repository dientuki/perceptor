---
title: Duplicate Torrent Add — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-19
status: Implemented
---

# PLAN: Duplicate Torrent Add (`plan.md`)

## Approach

The whole fix lives in the **same-target** branch of the three `attachTorrentSource` twins
(`services/api/src/movies/movies.service.ts`, `episodes/episodes.service.ts`,
`seasons/seasons.service.ts`). Today that branch collapses three different situations into one
"retry" path: call `QbittorrentClient.add()` again, overwrite the row, and reset it to `QUEUED`. The
plan splits it by the existing row's status:

1. **The row is not `ERROR`** (REQ-1/REQ-2). Return the target as a fresh read, before any
   qBittorrent call and before the `COMPLETED`/`force` conflict check.
2. **The row is `ERROR`** (REQ-3/REQ-4). Ask qBittorrent whether it still holds the hash.
   - If it does, reactivate the row in place: keep `downloadPath`, never call `add()`, and start the
     torrent if it has not finished. If it has finished, hand the hash to the existing
     `DownloadsService.handleTorrentCompleted()` once the row is active again.
   - If it does not, this is a genuine add and today's code path runs unchanged.

What is **reused** instead of written again:

- `QbittorrentClient.info()` and `start()` (`services/api/src/clients/torrent/client.ts`). `info()`
  already maps "finished" to `SourceStatus.READY` via `mapTorrentState`. No new client method is
  needed; the lookup is `info()` plus a lowercased hash match.
- `DownloadsService.handleTorrentCompleted()` (`services/api/src/downloads/downloads.service.ts`) for
  REQ-4. The spec requires exactly the path a real completion notice takes: `resolveRace`, `READY`,
  the target moved to `ENCODING`, then `addSourceReady`. This avoids a second copy of that sequence.
  `DownloadsModule` already exports `DownloadsService` (for `UploadsModule`), and it imports nothing
  from `movies`/`episodes`/`seasons`, so adding it to their imports creates no cycle.

**Alternative rejected:** deriving `add()`'s folder from the `infoHash` instead of the URL. It would
have made a second add land on the same folder by construction, but it changes the layout of every
future download. It also would not fix the stuck-`QUEUED` or stopped-torrent cases, which come from
the reset, not from the folder (spec § Out of Scope).

**Alternative rejected:** reusing `DownloadsService`'s private `liveInfoForHash()`. It swallows
client errors and returns `undefined`, which here would be read as "qBittorrent no longer holds
it". That would send an unreachable client down the genuine-add path and overwrite the path, the
exact bug this feature fixes (see Risks).

The three twins stay separate (Constitution Article X; `006-media-search` § Out of Scope). Each one
gets the same branch; nothing is extracted into a shared helper.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | The only service touched. There is no contract change, so nothing waits on it. |

Inside `api` the three twins are independent and could be written in any order. Movies goes first
because its suite already has an `attachTorrentSource` describe block to extend, and it sets the
pattern for the other two.

## Contract Freeze

`spec.md` § GraphQL Contract Delta is **None**, and it is frozen as of `status: Approved`. Things an
implementer will be tempted to change and must not:

- **A "ya estaba agregado" notice for REQ-1.** It was rejected explicitly. The no-op returns the
  same success payload a real attach does.
- **Wrapping the new qBittorrent calls in `TORRENT_CLIENT_REJECTED`.** `DownloadsService` wraps its
  client calls through `callTorrentClient`, but the attach path has always let `add()`'s
  `TorrentClientError` propagate as-is. NFR-1 says "the same error ... today", so the new `info()`
  and `start()` calls in the attach path propagate the same way. A new i18n key or a different
  exception would be a contract change.
- **Mutation return shapes.** The no-op has to return exactly what each twin returns today: a
  `Movie` row, an `Episode` row, and a `Season` **with its `episodes` included** (see the warning in
  `services/api/CLAUDE.md`).

## Migrations

None. `MediaSource.infoHash` is already `@unique` and `downloadPath` already exists (NFR-4).
Existing rows with a wrong `downloadPath` are deliberately left alone (NFR-2). There is no backfill
and no reconciliation.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| An unreachable client is read as "torrent absent" | An `ERROR` row goes down the genuine-add path, `add()` fails or lands elsewhere, and the path may be overwritten: the original bug again | The lookup propagates errors and never catches. It must not reuse `liveInfoForHash()`. A test injects a throwing `info()` and asserts no row write (AC-5). |
| The no-op check placed after the `COMPLETED`/`force` block | A `COMPLETED` target re-adding its own hash without `force` is refused. With `force`, episodes and seasons demote the target's own `SCANNED` source to `ERROR` (`error.source.replaced`), silently undoing a finished title | The no-op check runs right after the different-target conflict checks and before the `COMPLETED` check. Tested with `force: true` against a `SCANNED` row (AC-3), fault-injected by moving the check. |
| A finished torrent is reactivated but left `QUEUED` | No completion notice ever arrives, so it stays `QUEUED` forever with no error | REQ-4: `handleTorrentCompleted(hash)` is called **after** the row is written back to a non-`ERROR` status. That method ignores `ERROR` rows, so calling it earlier is a silent no-op. Tested by asserting the call order. |
| A reactivated row gets a new `downloadUrl` but keeps its old `downloadPath` | `downloadUrl` is documented as what `add()` hashed to build the folder. Mismatching the two breaks that invariant with no error | When the torrent is still held, only `status` and the three error fields change. `downloadUrl`, `releaseTitle`, `kind` and `downloadPath` stay as they were. |
| A finished duplicate is started before `handleTorrentCompleted` | If the race says it is a late loser, a torrent the arbiter wanted stopped is now seeding | `start()` is called only when the torrent has not finished. A finished one goes straight to `handleTorrentCompleted`. |
| A no-op still writes the target's status | Today every attach ends with `status: 'DOWNLOADING'` on the target, which would drag a `COMPLETED`/`ENCODING` film backwards | The no-op returns a plain read (`findUniqueOrThrow` or the equivalent), never the `update`. Asserted in the test. |

A pre-existing issue is noted but **not** fixed here: a genuine add or a reactivation still writes
the target to `DOWNLOADING` unconditionally, even when a sibling already won. That is today's
behaviour for any second acquisition, unrelated to duplicates.

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
git status --short services/api/prisma
git diff --stat services/web services/worker
```

Expected results: 0 type errors; the test suite passes with the new cases; `prisma/` is empty (no
migration); `web`/`worker` are empty; `services/api/src/schema.gql` is not in the diff.

Manual pass against a running stack (`bin/dev -d`):

1. **AC-1/AC-2.** Search a film that returns two rows for the same torrent from different indexers
   (or add the same magnet twice, the second time with an extra `&tr=` so the URL differs). Add
   both. Check `bin/mysql -e 'select id, status, downloadPath from media_sources where
   infoHash="<hash>"'` before and after the second add: same row, same path. `ls` the downloads
   root and confirm no new empty folder. Let it finish and watch it reach `SCANNED`.
2. **AC-3.** Re-add the magnet of an episode already `SCANNED`, once without `force` and once with
   it. The row and the episode's status are unchanged.
3. **AC-4.** Take a film with two racing sources. Let one win so the other is stopped, then replace
   it with `force` so the loser goes to `ERROR`. Re-add the loser's magnet: it returns to `QUEUED`
   with its original `downloadPath`, and qBittorrent's UI shows it running.
4. **AC-5.** Run `docker compose stop torrent`, re-add an `ERROR` source's magnet, confirm the
   mutation errors and the row is unchanged, then run `docker compose start torrent`.
5. **AC-6.** Add a film's magnet to a different film: `error.magnet.already_attached` naming the
   first film.
6. **AC-7.** Repeat step 1 and step 2 from a season header (`addMagnetToSeason`).

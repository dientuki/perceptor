---
title: The Race Loser Sweep Actually Sweeps
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-08
last_updated: 2026-10-08
status: Approved
services: [api, web, worker]
---

# SPEC: The Race Loser Sweep Actually Sweeps (`spec.md`)

## Context & Goal

Racing several releases of one title is deliberate behaviour and the cleanup behind it was already
specified: `022-download-status-tags` REQ-12 pauses every sibling the moment one source completes,
and REQ-15 — "Cleanup wipes the losers" — removes each loser's torrent with its files and deletes
its row outright once the winner's encode is done. REQ-16 draws the line that still holds: a failed
encode deletes nothing, the losers stay paused with their files intact, and the user decides. All
of that is implemented. `ProcessJobsService.sweepLosingSiblings`
(`services/api/src/process-jobs/process-jobs.service.ts`) runs from `downloadRemove`, which the
worker calls after the last `ProcessJob` of a source finishes. Download three torrents of one film
today and the two losers really do disappear.

This feature is not that cleanup. It is four holes in it, each of which makes the sweep do nothing,
too much, or half of what it claims, and none of which produces an error anywhere.

The first is that the sweep never runs for a winner that is not a torrent. `022` wrote the hazard
down in prose — "an upload that wins a race leaves every losing torrent downloading forever,
silently. The sweep must run for a winner of either kind; only the winner's own
`torrentClient.remove` is skipped" — and `api` honoured it by placing the sweep *ahead* of
`downloadRemove`'s `!infoHash` early return. The guard simply moved to the other side of the
boundary: the worker calls the mutation only `if (removeTorrent && infoHash)`
([cleanup-source.ts:33](services/worker/src/jobs/cleanup-source.ts)), so for an upload winner the
mutation is never sent at all and `api`'s careful ordering is unreachable. The worker's own test
asserts this as correct behaviour. It also contradicts `013` REQ-8, the requirement that line cites,
whose text is that cleanup fires by how many episodes a source carries "never on whether it was a
torrent or a local file". `022` recorded that this path was verified by a fault-injected unit test
and never by a live race, which is how it shipped.

The second is that the sweep selects *every* sibling of the winner with no test of what that sibling
is, and deletes it. That was defensible when a non-winning source could only be a loser.
`090-replaced-source-not-an-error` makes it false: a delivered source the user replaced on purpose
is retired and kept as history, and the next delivery's sweep would delete exactly the row `090`
exists to preserve. The third is that the sweep is its own deletion path rather than `047`'s — it
removes the torrent and the row and stops, so a loser with no torrent leaves its bytes in the
downloads root, queued and running work is never withdrawn, the target's status is never recomputed
through `TitleStatusService` (`089`), and a torrent-client call that throws `continue`s past the row,
orphaning it with nothing to retry it. The fourth is on the other end: between a source winning and
its encode delivering, a loser sits `PAUSED` and `downloadStart` has no guard for it, so `web`
offers Play on a row whose only possible outcome is to finish, fall into `resolveRace`'s superseded
branch, and turn red.

Once this ships, the sweep fires for any winner, touches only the sources that actually lost, unwinds
them the way a user-initiated delete already does, and a loser cannot be resumed into a dead end in
the meantime. No pipeline stage in the root `CLAUDE.md` gains or loses a step; the *Download* stage's
cleanup goes from mostly working to working.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (The sweep fires for any winner)**: The post-encode cleanup must reach `api` for the
      last-finishing `ProcessJob` of a source whatever that source's kind, including one with no
      `infoHash`. The "is this a torrent?" test belongs to `api` alone, which already applies it to
      the winner's own `torrentClient.remove` and already answers `omitido: mediaSource <id> no es un
      torrent` — a response that exists for exactly the call the worker is withholding. The worker's
      copy of that test is therefore removed rather than refined: one guard, on the side that owns
      the decision (Article X). The worker test that currently asserts the mutation is never sent for
      a `LOCAL_FILE` source is asserting the bug and must be inverted, not deleted.
- [ ] **REQ-2 (The sweep touches only losers)**: The sweep must select the winner's siblings by
      target (`movieId`/`episodeId`/`seasonId`, never by tag — `022` REQ-14 is unchanged) and then
      purge only those that actually lost: neither delivered themselves (`087`'s
      `isDeliveredSource`) nor retired (`090`'s `retiredAt` non-null). A retired source and a second
      delivered source must survive the sweep untouched.
- [ ] **REQ-3 (One deletion path)**: Purging a loser must unwind it the way deleting a source by hand
      already does (`047`) — torrent and data removed from the client, queued and running work
      withdrawn, residue deleted from the downloads root, row deleted — rather than removing the
      torrent and the row alone. A loser with no torrent must have its residue deleted too.
- [ ] **REQ-4 (A failed external call does not orphan a row)**: If the torrent client cannot be
      reached for a loser, the failure is logged and the rest of that loser's unwind still proceeds.
      No loser may be left as a row because an external call threw.
- [ ] **REQ-5 (The target is recomputed, not assumed)**: After a sweep the target's status must be
      recomputed through `TitleStatusService` (`089`) rather than left as whatever the deleted rows
      last implied, and a delivered title must still read `COMPLETED` afterwards.
- [ ] **REQ-6 (A loser is not resumable, but is still stoppable)**: `downloadStart` must refuse a
      source whose target already has a race winner, writing nothing and calling nothing, and `web`
      must not offer the start control for such a row — there is nothing to resume it into. The
      **stop** control stays, for both services: a loser whose stop call to the torrent client failed
      is still downloading, and stopping it by hand is the only remedy the user has. Delete stays
      available and unchanged, and remains how a user reclaims a loser's disk before the winner
      delivers.
- [ ] **REQ-7 (Visibly discarded)**: `web` must mark such a row as discarded, distinctly from a
      `PAUSED` row the user paused themselves and from an errored one, in `/downloads` and in a
      title's own download list. The mark is neutral in tone: losing a race is not a failure. The row
      keeps its `PAUSED` badge and its existing `working` filter bucket — `statusTone` backs every
      status badge in the application and is not re-mapped for this.
- [ ] **REQ-8 (`022` REQ-16 is unchanged)**: Winning a race still purges nothing. If the winner's
      scan or encode then fails, every loser must still be present with its files intact, and must
      become startable again on its own — the "lost the race" condition is derived from the siblings'
      live rows, never stored, so a winner that stops being a race winner (`065`) un-sets it with no
      write anywhere. Starting a loser at that point resumes it normally and it can go on to win.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Depends on `090`)**: REQ-2 reads `MediaSource.retiredAt` and this feature must land
      after `090-replaced-source-not-an-error`. Landing it first leaves REQ-2 with no way to tell a
      deliberately kept source from a loser.
- [ ] **NFR-2 (Article XII)**: Every removal resolves against the downloads root through
      `MediaRootsService` before anything is unlinked. No file under the destinations root is
      touched, including the one the delivering source just wrote.
- [ ] **NFR-3 (Safe to receive twice)**: The delivery report the sweep hangs off is already safe to
      receive more than once (`038`). The sweep must be too: a repeated report finds nothing left to
      purge, must not error, must not re-call the torrent client for rows that are gone, and must not
      change any status.
- [ ] **NFR-4 (One sweep, not two)**: REQ-3 reuses `DownloadsService`'s existing per-source unwind
      rather than growing a second deletion path beside it (Article X). If that requires the unwind
      to be reachable from `process-jobs/`, it is moved or shared, not copied.
- [ ] **NFR-5 (Tested where it failed silently)**: `022` recorded REQ-15 and REQ-19 as verified by
      fault-injected unit test and never by a live race, which is how REQ-1's hole shipped. The
      upload-winner path and the retired-sibling exclusion each owe a test that fails before the fix
      (Article IX), and the acceptance pass below is live, not mocked.

## GraphQL Contract Delta

```graphql
type Download {
  # ...unchanged fields...
  lastError: DownloadError
  retryable: Boolean!
  lostRace: Boolean!     # another source of this target has already won the race, so this one
                         # will never be processed. Derived per request from the target's sibling
                         # rows, never stored: it un-sets itself if that winner later fails (065).
                         # `web` renders a neutral "discarded" mark and offers neither the start nor
                         # the stop control. Not an error — `lastError` stays null and `status`
                         # stays "PAUSED".
  readAt: DateTime!
}
```

`downloadRemove(mediaSourceId: Int!, deleteFiles: Boolean = true): String!` keeps its signature, its
`@AllowService()` guard, its `omitido: mediaSource <id> no es un torrent` response and its return
type exactly as they are — REQ-1 changes only *when the worker sends it*, which no typechecker on
either side can see, and REQ-2/REQ-3 change only what it does internally. `Download.status` gains no
new value and no bucket changes: a loser reports `PAUSED`, which `web` already tones as `progress`
and counts under `working`.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `downloadStart` on a source whose `lostRace` is true | `ConflictException` (409), `extensions.i18n.key = error.download.retry_superseded` | `Otra fuente de este título ya se está procesando` |

The key is the existing `error.download.retry_superseded`, already in both catalogs with exactly this
copy and already thrown as a `409` by `DownloadsService.resumeErroredSource` for the `ERROR` case of
the same situation — no new key, and one status per key. `web` already lists it in `DownloadRow`'s
`REFRESH_ON_KEYS`, so a row that goes stale between render and click refreshes itself; that is
unchanged and is the fallback if the control is ever shown when it should not be.

The "discarded" mark is `web`-side copy keyed off `lostRace` — a new catalog entry in
`messages/{en,es}.json`, `Discarded` / `Descartada` — not a message `api` produces.

## Data Model Changes

**None.** `lostRace` is derived from the sibling rows `DownloadsService` already loads for every
`Download` (`siblingsOf`), and the sweep deletes rows rather than marking them. `090`'s `retiredAt`
is the only column this feature reads that does not exist today, and it is `090`'s to add (NFR-1).

## Acceptance Criteria

- [ ] **AC-1** *(REQ-1, the hole that shipped)*: Given a film with two torrents downloading, when a
      file is uploaded to that same film and wins the race, then after its encode completes both
      losing torrents are gone from qBittorrent's list and their rows are gone from `media_sources`.
      `bin/mysql -e "SELECT id, status FROM media_sources WHERE movieId = <id>"` returns one row.
- [ ] **AC-2** *(REQ-2, the `090` collision)*: Given a film whose delivered source was replaced with
      `force` so it is retired, when the replacement delivers, then the retired row is still present
      with `retiredAt` non-null while every non-retired, non-delivered sibling is gone.
- [ ] **AC-3** *(REQ-3)*: Given three torrents on one film, when the winner delivers, then the two
      losers' folders are gone from the downloads root, no `bull:process` or `bull:encode` entry
      remains for them, and the delivered file is still present under the destinations root.
- [ ] **AC-4** *(failure path, REQ-4)*: Given the same three sources and the `torrent` container
      stopped, when the winner delivers, then both loser rows are still deleted, their residue is
      still gone from the downloads root, and the `api` log carries one torrent-client failure per
      loser — no row survives the failed call.
- [ ] **AC-5** *(failure path, REQ-6)*: Calling `downloadStart` on a loser between the win and the
      delivery returns a `409` carrying `error.download.retry_superseded`, the row's `status` and
      `infoHash` are unchanged, and qBittorrent still reports that torrent stopped. In `/downloads`
      that row shows a `PAUSED` badge with a neutral "Descartada" mark, no red error line, no Play
      and a working Stop.
- [ ] **AC-6** *(failure path, REQ-8 — the fallback this must not destroy)*: Given three sources,
      when the winner's scan fails (`sourceScanFailed` with `error.source.scan_no_downloaded_video`),
      then both losers are still present with their bytes on disk, `lostRace` reads false for both,
      Play is offered again, and starting one resumes it in qBittorrent and lets it go on to win and
      deliver.
- [ ] **AC-7** *(REQ-5)*: After each sweep above, the film still reads `COMPLETED` on its detail page
      and in `/downloads`, and `bin/mysql -e "SELECT status, filePath FROM movies WHERE id = <id>"`
      shows `COMPLETED` with the new path.
- [ ] **AC-8**: Given three season packs attached to one season, when the first pack's *first*
      episode encode completes, then both other packs are still present; when its *last* episode
      encode completes, then both are gone.
- [ ] **AC-9**: `bin/npm api run test`, `bin/npm web run test` and `bin/npm worker run test` pass;
      `bin/comments api`, `bin/comments web` and `bin/comments worker` pass.

## Out of Scope

- **How a loss is recorded.** `resolveRace` writes a loser `PAUSED` and a late finisher `ERROR` /
  `error.source.superseded`, and both stay exactly as they are. Those rows are transient — REQ-2's
  sweep removes them at delivery either way — and unifying the two outcomes would be churn in the
  one function this feature otherwise does not touch.
- **The `continue` in `resolveRace`'s pause loop, which is left as it is on purpose.** A loser whose
  stop call throws is never written `PAUSED` and keeps downloading. Writing it `PAUSED` anyway would
  be the worse outcome: the row would read stopped while qBittorrent, which never received the
  request, keeps downloading. The row says `DOWNLOADING` because it is downloading, and the leak is
  bounded at both ends — REQ-2's sweep removes that row when the winner delivers, and until then a
  sibling still downloading is exactly the fallback REQ-8 protects. REQ-6 is what makes this safe
  rather than stuck: the stop control stays on a loser, so the user can finish by hand what the
  failed call did not. The only thing owed here is that the failure is logged, which it already is.
- **Losers that already exist in a running installation.** An install predating this holds rows whose
  targets were delivered long ago, so no delivery report will fire for them again. The per-row Delete
  button already performs the full `047` unwind and is how they are cleared. A boot-time sweep is its
  own feature, and a SQL migration is not a candidate: it can delete the row but not the torrent or
  the bytes, turning a visible leak into an invisible one.
- **Limiting how many sources a title may race.** Racing several releases on purpose stays
  unrestricted and unwarned.
- **Retiring a loser instead of deleting it.** `022` REQ-15 decided this and `090`'s Out of Scope
  restates it: a loser delivered nothing, so there is no fact about it worth keeping once the title
  is in the library. `090`'s `retiredAt` is for a source that delivered a file the user watched.
- **The dead `ERROR`-winner guard at the top of `resolveRace`.** Unreachable, because
  `handleTorrentCompleted`'s own `ERROR` rung runs first. Nothing here makes it reachable; it is a
  tidy-up for whoever next edits that function.

---
title: Stop and resume a running encode — Implementation Plan
spec_version: 0.3.0
last_updated: 2026-10-17
status: Implemented
---

# PLAN: Stop and resume a running encode (`plan.md`)

## Approach

`095` already built almost every seam this feature needs, for its own `DISCARDED` state. The work
is to add a second user-chosen job state, `STOPPED`, beside it, and answer for each existing seam
whether `STOPPED` behaves like `DISCARDED` (refused, ignored) or like an active job (in flight).

What `095` left in place, and this feature reuses rather than rebuilds:

- **Per-job ownership and race gates.** `DownloadsService.loadOwnedJob` resolves a job, its owned
  source, its siblings, and refuses a retired source or a race loser. `encodeJobStop` is
  `loadOwnedJob` + a guarded write, exactly as `encodeJobDiscard` is.
- **Cancel and withdraw.** `encodeJobDiscard`'s `publishCancel` + `removeEncode` block (best-effort,
  logged on failure) is the same sequence Stop needs.
- **Resume with rollback.** `resumeEncodeStage` already moves jobs to `WAITING`, re-enqueues, checks
  `EncodeQueueService.isEncodePending`, rolls back and raises `retry_enqueue_failed`. Stop's resume
  is this method widened to `STOPPED`, restoring each job to the state it came from on rollback.
- **Report guards.** `encodeStarted` already refuses `DISCARDED` with a guarded `updateMany`;
  `encodeProgress` already writes only while `ENCODING`; `encodeFailed` already returns early for
  `DISCARDED`. Each gains `STOPPED`.
- **Worker refusal arm.** `encode.job.ts` already abandons on `error.encode.discarded`. It widens to
  `error.encode.stopped`.
- **Child rows.** `web`'s `DownloadJobRow` already has `canAct`, a retry button wired to
  `encodeJobStart`, and `REFRESH_ON_KEYS`; it gains a pause button and Play on `PAUSED`.

The pivot is **one constant**. `pipeline-status.ts` keeps `ACTIVE_ENCODE_STATUSES`
(`WAITING`/`QUEUED`/`ENCODING`: FFmpeg runs or will) and gains `IN_FLIGHT_ENCODE_STATUSES` (active +
`STOPPED`: work the user still owes the title). Every place that today reads
`ACTIVE_ENCODE_STATUSES` or the literal `['WAITING', 'QUEUED', 'ENCODING']` gets one of the two by
name, decided per site in `api/plan.md`. The decisions that matter:

| Question | Constant | Why |
| :-- | :-- | :-- |
| Does the source read `ENCODING`? (`deriveSourceStatus` rule 3) | active | a stopped source reads `PAUSED` (REQ-4) |
| Is the source delivered? (`isDeliveredSource`) | in-flight | NFR-1 |
| Is the source the race winner? (`isRaceWinner`) | active | REQ-15: a stopped source gives the race up |
| Remove the torrent? (`cleanupDecision`) | in-flight | NFR-1: a stopped job still needs its input |
| Close jobs on replacement (two demotions) | in-flight | NFR-1: no `STOPPED` left on a demoted source |
| Media server may promote/demote? | in-flight | a stopped title is not the server's to touch |

`deriveTitleStatus` gains one line: a `STOPPED` job contributes `PAUSED`. That is what keeps the
`073`/`076` sweeps (which acquire only `MISSING`) away from a stopped title.

**REQ-15 is a change to `isRaceWinner` and nothing else.** Today a `SCANNED` source is a winner
unless it failed with nothing active. After this feature it is a winner only while it has an active
job or a completed-and-nothing-pending shape; a source with `STOPPED` jobs and nothing active is not.
Every consumer follows without edits: `resolveRace` (a sibling that finishes now wins), `lostRace`
on `Download` (siblings lose their mark, `web` shows Play), `downloadStart`/`loadOwnedJob`'s
`hasRaceWinner` refusal (REQ-16 — Play on the stopped source is refused while a sibling holds the
race), and `unwindLosingSiblings` (REQ-17 — the new winner's delivery sweeps the stopped source,
because it is not delivered). No new sweep, no new refusal path.

The ordering inside `downloadStart` is what makes REQ-16 fall out: retired check → `ERROR` branch →
`hasRaceWinner` refusal → **new stopped-encode branch** → torrent path. The stopped branch must sit
after the race refusal, never before it.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration, both keys, `encodeJobStop`, and every behaviour change; `encodeStarted`'s refusal must exist before the worker branches on it |
| 2a | `worker` | Only observable once `encodeStarted` can refuse with the new key |
| 2b | `web` | Calls `encodeJobStop`, which must exist in the schema first |

`worker` and `web` run in parallel once `api` lands.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will be tempted to change and must not:

- **No `stopped`/`stoppedEncode` field on `Download`.** `web` shows Stop on `ENCODING` and Play on
  `PAUSED`; `api` decides whether the button reaches the encode or the torrent.
- **`STOPPED` is exposed as `PAUSED`, not `STOPPED`.** In `DownloadJob.status` too — `projectJobStatus`
  maps it. `web` never sees the storage name.
- **`encodeJobStart` keeps one name for two meanings** (retry an `ERROR` job, resume a `STOPPED`
  one), the same way `downloadStart` already does for a source. Do not add `encodeJobResume`.
- **REQ-16's refusal reuses `error.download.retry_superseded`.** Do not add a stopped-specific key.
- **`error.encode.stopped` is never shown to a user** — no entry in `web/messages/*.json`.
  `error.processJob.not_running` is user-facing and needs both catalogs.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief all three
services (Constitution, Article VIII).

## Migrations

1. `encode_status_stopped` — adds `STOPPED` to the `EncodeStatus` enum on `ProcessJob.status`.
   Generated through `bin/npm api run prisma:migrate`.
2. Backfill: none (spec NFR-6).

Reversibility: dropping the value while any row is `STOPPED` fails on MariaDB. Roll back by first
setting those rows to `ERROR` (inspect with `bin/mysql -e "select id from ProcessJob where status =
'STOPPED'"`). Noted, not automated.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `deriveTitleStatus` ignores `STOPPED` | A stopped film with no file reads `MISSING`; the next `acquire_movies` run attaches another release. No error anywhere | `pipeline-status.spec.ts` case; AC-9 |
| `isRaceWinner` still counts a stopped source | REQ-15 silently absent: Play on siblings refused, a sibling that completes ends `superseded`, and a stopped bad release blocks the title forever | `pipeline-status.spec.ts` case; AC-17 |
| Stopped branch placed before the race refusal in `downloadStart` | Play on B while C encodes resumes B: two sources encode for one title, both write the library file | ordering fixed in `api/plan.md`; `downloads.service.spec.ts` case; AC-18 |
| `isDeliveredSource` ignores `STOPPED` | A pack stopped after episode 2 counts as delivered: `unwindLosingSiblings` skips it, so REQ-17's sweep leaves B behind; a forced replacement retires it with `STOPPED` jobs still open | in-flight constant; spec case; AC-17 |
| Demotions skip `STOPPED` | A replaced source keeps `STOPPED` jobs; the title reads `PAUSED` forever | in-flight constant in both demotions; AC-15 |
| `cleanupDecision` ignores `STOPPED` | The last running episode completes and the torrent is removed while episode 4 is stopped; Play on 4 still works (files kept) but seeding ends early | in-flight constant; AC-13 |
| Play inside the 10 s kill grace | The cancelled BullMQ entry is still `active`: `removeEncode` removes nothing, `addEncode` is a no-op, and `isEncodePending` answers true **because it accepts `active`**. Row reads `QUEUED`, the active entry then fails, and the job never runs | `api/plan.md` step 6: after `removeEncode`, an entry that still exists is an enqueue failure → rollback to `STOPPED`, `retry_enqueue_failed`; user presses Play again |
| `encodeStarted` revives a stopped job | Worker dequeued a job after Stop (withdrawal lost or raced); it encodes although stopped | guard + `error.encode.stopped`; AC-10 |
| Stop order revives a pack's next episode | Cancelling episode 3 first frees the worker, which dequeues episode 4 before it is withdrawn | Stop withdraws queued jobs first, cancels the running one last; the `encodeStarted` guard is the backstop |

## Verification

```bash
bin/npm api run prisma:migrate
bin/npm api run test
bin/cli api npx tsc --noEmit
bin/npm worker test
bin/cli worker npx tsc --noEmit
bin/cli web npx tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments api
bin/comments web
bin/comments worker
git status --short services/api/prisma          # schema.prisma + one new migration
grep -rn "'WAITING', 'QUEUED', 'ENCODING'" services/api/src --include=*.ts | grep -v -e spec.ts -e pipeline-status.ts   # empty
git diff -- services/api/src/schema.gql         # only encodeJobStop added
```

Manual pass (a film at `1080p` with compression on, so an encode runs for minutes):

1. AC-1/AC-2 — Stop at ~30% in `/downloads`: `bin/cli worker ps` shows no `ffmpeg`; row and film
   `PAUSED`; qBittorrent unchanged. Play: restarts at 0%, ends `COMPLETED`.
2. AC-3 — same with a file uploaded through the film's import button.
3. AC-4, AC-12, AC-13 — season pack: Stop the parent mid-pack, check the job counts with `bin/mysql`;
   resume; pause one episode from its child row, let the rest finish, resume it.
4. AC-5 — two films, stop A while B is queued, Play A: B runs first.
5. AC-6 — `bin/stop -y && bin/dev -d`: job still `STOPPED`.
6. AC-7 — no `*.part.mkv`/`*.working.mkv` under downloads or destinations.
7. AC-8 — `docker compose stop redis`, Play → `retry_enqueue_failed`, still `STOPPED`; restart redis,
   Play works. Also press Stop then Play within 10 s: either it resumes or it shows
   `retry_enqueue_failed` — never a row stuck `QUEUED`.
8. AC-9 — stopped film inside an open window: run `acquire_movies` from Settings; no new source.
9. AC-10 — set a `QUEUED` job to `STOPPED` with `bin/mysql` and let the worker dequeue it: log shows
   `stopped, reporting nothing`.
10. AC-11 — Stop/Play on a torrent still `DOWNLOADING` behaves as before.
11. AC-14 — `encodeJobStop` on a `COMPLETED` job returns `not_running`.
12. AC-15 — upload a replacement over a stopped film.
13. AC-16, AC-17, AC-18 — three releases of one film; let one win; stop it; Play another; Play on the
    stopped one is refused; after the new winner finishes, only it remains.

---
title: Automatic Offset for Subtitle Embed — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-30
status: Implemented
---

# PLAN: Automatic Offset for Subtitle Embed (`plan.md`)

## Approach

The feature adds a stage in front of `101`'s embed and reuses everything below it.

- **New `api` provider.** `SubtitleEmbedSyncService` lives in `services/api/src/subtitle-embed/`.
  It owns the `SYNCING` stage: it queues one measurement per automatic track, answers the three
  service-only operations the worker calls, judges each report and moves the embed on.
- **`SubtitleEmbedService.embed()`.** It keeps every `101` check in its current order. When at
  least one track is automatic, it creates the row as `SYNCING` instead of `QUEUED`, and the new
  provider queues the measurements instead of the remux.
- **Shared code, used as is.** Acceptance is `103`'s pure `accept()` from
  `services/api/src/subtitle-search/acceptance.ts`. The last cue comes from
  `services/api/src/subtitle-search/last-cue.ts`. Both are imported as plain functions, not through
  `SubtitleSearchModule`. That module already depends on `SubtitleEmbedModule` (`embedStaged`), so
  a module import would create a cycle.
- **Queue.** `subtitle-sync` is the existing queue. `SubtitleSyncQueueService` gains a second
  producer method.

In the worker, the measurement body of `services/worker/src/jobs/subtitle-sync.job.ts` moves into
one function, `measureSync(filePath, candidatePath, signal)`. That body runs from `getMetadata`
through `parseFfsubsyncOutput`. The `103` handler and the new `subtitle-embed-sync` handler both
call it, so there is exactly one way to run `ffsubsync`. The existing `subtitle-sync` `Worker` in
`index.ts` dispatches on `job.name`. No second consumer and no new queue are added.

`web` changes one dialog and one button.

**Alternatives rejected:**

- **Reusing `SubtitleSearchAttempt` and `subtitleSyncDetails` for the embed.** These are keyed by a
  search, and the operations read a `stagedPath` under the downloads root. Faking a search row for
  a hand embed would make every `103` reader (`derive-languages`, the driver, the staging cleanup)
  see searches that never searched.
- **Measuring inside the worker's `subtitle-embed` job.** This breaks `103`'s rule that the worker
  reports measurements and never a verdict. It also needs a round trip in the middle of a job to
  learn the verdict.
- **A new table per measurement.** `(subtitleEmbedId, fileName)` is already unique (`101` REQ-4),
  and the per-track measurement fits in the `tracks` JSON the row already carries.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the enum migration, the input field, the three service-only operations and the job producer. The other two read all of these. |
| 2a | `worker` | Consumes `subtitle-embed-sync` and calls the three operations. Can start once the contract is frozen, which is now. |
| 2b | `web` | Sends `autoOffset` and renders `SYNCING` and the new keys. Independent of the worker. |
| 3 | `docs` (orchestrator) | Adds a `113` section to `docs/spec/graphql-contract.md` (the delta, the queue contract, the keys) and `docs/spec/history.md`. |

Steps 2a and 2b can run in parallel with step 1, because the contract in `spec.md` is frozen. The
live pass (Verification) needs all three.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. These are the parts
an implementer will be tempted to change and must not:

- **`offsetMs` stays `Int!`.** It is ignored when `autoOffset` is true. Making it nullable looks
  cleaner but breaks every existing caller's variables type. `web` sends `0` for an automatic row.
- **No `subtitleEmbedSyncStarted`.** The worker goes straight from `subtitleEmbedSyncDetails` to
  measuring. A duplicate job measures twice, which is harmless: the first report that lands for a
  track wins, and later ones answer `true` with no change. Do not add a fourth operation "for
  symmetry with `103`".
- **The worker reports a single key, `error.subtitleEmbed.sync_failed`.** It never reports the
  four rejection keys (`sync_framerate_mismatch`, `sync_offset_too_large`, `sync_incomplete`,
  `sync_low_score`). Those are `api`'s verdict, mapped from `accept()`'s `error.subtitleSearch.*`
  result.
- **The worker never sees `SYNCING`.** `subtitleEmbedStarted` keeps refusing anything not `QUEUED`.
  The `subtitle-embed` job and `SubtitleEmbedDetails` are untouched.
- **`SubtitleEmbedSyncDetails` is its own type.** It is not `SubtitleSyncDetails` with an extra
  field. `103`'s type and operations do not change (NFR-5).

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, and re-brief all three
services (Constitution, Article VIII).

## Migrations

1. `<ts>_subtitle_embed_syncing` adds `SYNCING` to the `SubtitleEmbedStatus` enum, which in MariaDB
   is a `MODIFY COLUMN status ENUM(...)`.
   - Existing rows keep their value and need no backfill.
   - The column default stays `QUEUED`.
2. There is no column change. The new per-track fields live in the existing `tracks` JSON:
   `autoOffset?: boolean` and `measurement?: { offsetMs, framerateRatio, reference, score,
   reasonKey }`. A row written before this feature has neither field, and reading it treats every
   track as manual.

Reversibility: the enum value can be dropped only once no row reads `SYNCING`. A rollback first
runs `UPDATE subtitle_embeds SET status='FAILED', errorKey='error.subtitleEmbed.interrupted' WHERE
status='SYNCING'`. The extra JSON fields are ignored by older code.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| One of the three active-status lists misses `SYNCING`: `ActiveEmbedGuard.ACTIVE_EMBED_STATUSES`, `createGuarded`'s literal `['QUEUED', 'RUNNING']`, and `reconcileOrphanedEncodes`' `RUNNING` | Silent. A torrent attaches mid-measurement, or two embeds race, or a worker restart leaves `SYNCING` forever with the button frozen in "Sincronizando…" | The three lists collapse into one exported constant used by all three sites. Tests cover a `SYNCING` row blocking acquisition and being reconciled on worker boot. |
| The sidecar is not UTF-8 (UTF-16 with BOM is common in the wild), so `lastCueEndMs` finds no cue | No error. A good sidecar is rejected as `sync_incomplete`, a misleading reason that the admin works around with the manual mode and never reports | `api` decodes BOM-aware before `lastCueEndMs`: UTF-8, UTF-16LE and UTF-16BE BOMs, else UTF-8. Test with a UTF-16LE fixture. The `103` path is unaffected, since it stages UTF-8. |
| The `SYNCING → QUEUED` flip succeeds but `addEmbed` fails (Redis down) | The row reads `QUEUED` with no job. `QUEUED` is never reconciled, so the title is busy forever | Flip and enqueue mirror `101`'s `queueEmbed`. On enqueue failure the row goes to `FAILED` with `sync_failed`, logged. Test. |
| Two reports for different tracks of the same embed land concurrently and both read-modify-write `tracks` | The last write drops the other's measurement, so the embed never sees all tracks measured and sits in `SYNCING` | The report handler does its read-modify-write in a serializable `$transaction` guarded on `status: 'SYNCING'`. On `P2034` it throws, so `deliverReport` in the worker retries. The worker's `subtitle-sync` concurrency is 1 today, so this is defence, not the common path. |
| Enqueueing the N measurements partly fails | Some tracks never get a job and the embed waits forever | Enqueue failure in `embed()` deletes the row and rethrows, exactly like `101`'s `queueEmbed`, so the user sees the error and nothing is left behind. |
| `accept()`'s `error.subtitleSearch.*` result is stored verbatim on the embed | `web` shows a search-flavoured message ("El subtítulo es de una versión…") on the embed button, and the spec's keys are never produced | A fixed map from `RejectionKey` to `error.subtitleEmbed.sync_*`, tested so every `RejectionKey` maps. An unmapped key falls back to `sync_failed` with a warning. |
| The worker drops a job for a stale embed without reporting, by design | A job queued for a row that was then deleted (title removal) loops or errors | `subtitleEmbedSyncDetails` throws `error.subtitleEmbed.sync_not_found`. The worker treats that key as "report nothing", the same posture as `103`'s `sync_not_found`. |

## Verification

```bash
bin/cli api npx prisma migrate status
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/npm api run lint
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/npm worker run lint
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/cli web node scripts/check-messages.mjs
bin/comments
```

Then the manual pass, with Jellyfin configured and an admin signed in:

1. Open a film whose folder holds one `.srt` sidecar. In "Incrustar en archivo", confirm that
   "Automático" is checked and the offset input is disabled. Uncheck it and type `abc`: the confirm
   button disables. Check it again: confirm re-enables. (AC-1)
2. Shift a known-good sidecar by +2 s (e.g. `ffmpeg -itsoffset 2 -i in.srt out.srt`) and embed it
   automatically. Watch the button read "Sincronizando subtítulos…", then "Incrustando…". Then check:
   - `bin/mysql -e "select status, tracks from subtitle_embeds order by id desc limit 1"` shows
     `COMPLETED` and an `offsetMs` near `-2000`;
   - playback is in sync;
   - the `.srt` is gone. (AC-2, AC-9)
3. Embed manually with offset `1500`. The row is never `SYNCING` and the stored offset is `1500`.
   (AC-3)
4. Embed a 25 fps sidecar on a 23.976 fps file. The button shows the framerate reason, and the
   `.mkv` `stat` and the `.srt` are unchanged. (AC-4)
5. Embed two sidecars, one from another film. The result is `FAILED` with a `sync_*` key, both
   `.srt` files remain, and no `bull:subtitle-embed:*` key was added in Redis. (AC-5)
6. Start an automatic embed, then `docker compose restart worker` while it reads `SYNCING`. The
   result is `FAILED` with `interrupted`. (AC-6)
7. During `SYNCING`, add a magnet to the film. It is refused with `busy`. (AC-7)
8. Run a `106` manual search to completion. Its embed row is never `SYNCING`. (AC-8)

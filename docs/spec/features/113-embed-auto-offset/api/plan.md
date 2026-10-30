---
title: Automatic Offset for Subtitle Embed — api slice
service: api
last_updated: 2026-10-30
status: Implemented
---

# PLAN: Automatic Offset for Subtitle Embed — `api` (`api/plan.md`)

## Scope

`api` owns all of the following:

- the `SYNCING` enum value and its migration;
- `SubtitleEmbedInput.autoOffset`;
- the decision in `embed()` to create the row as `SYNCING`;
- enqueueing one `subtitle-embed-sync` job per automatic track;
- the three service-only operations (`subtitleEmbedSyncDetails`, `subtitleEmbedSyncCompleted`,
  `subtitleEmbedSyncFailed`);
- judging each measurement with `103`'s `accept()`;
- the `SYNCING → QUEUED` flip and the remux enqueue;
- `SYNCING` in every busy and reconcile check;
- the five new keys in `ERROR_KEYS` and `messages.en.ts`.

It does **not** run `ffsubsync`. It does not touch `103`'s `SubtitleSearch*` rows, operations or
driver. It writes nothing under the destinations root: it only reads the sidecar to find its last
cue.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` + `prisma/migrations/<ts>_subtitle_embed_syncing/` | Modified / New | `SYNCING` added to `SubtitleEmbedStatus` |
| `src/subtitle-embed/entities/subtitle-embed-status.enum.ts` | Modified | `SYNCING` |
| `src/subtitle-embed/dto/subtitle-embed.input.ts` | Modified | `autoOffset: boolean`, `@Field({ defaultValue: false })`, `@IsOptional() @IsBoolean()` |
| `src/subtitle-embed/entities/subtitle-embed-sync-details.entity.ts` | New | `SubtitleEmbedSyncDetails` exactly as in `../spec.md` |
| `src/subtitle-embed/active-embed.guard.ts` | Modified | Exports `ACTIVE_EMBED_STATUSES = ['SYNCING', 'QUEUED', 'RUNNING']`, the single list |
| `src/subtitle-embed/subtitle-embed.service.ts` (+ spec) | Modified | `StoredTrack.autoOffset?`/`measurement?`; `embed()` branches on any automatic track; `createGuarded` takes the initial status and uses the shared list; `assertOffsetInRange` only for manual tracks |
| `src/subtitle-embed/subtitle-embed-sync.service.ts` (+ spec) | New | `SubtitleEmbedSyncService`: `enqueue`, `details`, `completed`, `failed`, the flip |
| `src/subtitle-embed/sidecar-text.ts` (+ spec) | New | Pure BOM-aware decode of a sidecar `Buffer` to a string |
| `src/subtitle-embed/subtitle-embed.resolver.ts` (+ spec) | Modified | The three `@AllowService()` operations |
| `src/subtitle-embed/subtitle-embed.module.ts` | Modified | Provides `SubtitleEmbedSyncService` |
| `src/queue/types.ts` | Modified | `SUBTITLE_EMBED_SYNC_JOB = 'subtitle-embed-sync'`; `SubtitleEmbedSyncJob = { subtitleEmbedId: number; fileName: string }` |
| `src/queue/subtitle-sync-queue.service.ts` | Modified | `addEmbedSync(payload, trackIndex)` |
| `src/process-jobs/process-jobs.service.ts` (+ spec) | Modified | `reconcileOrphanedEncodes` fails `SYNCING` as well as `RUNNING` |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | `SUBTITLE_EMBED_SYNC_FAILED`, `_SYNC_FRAMERATE_MISMATCH`, `_SYNC_OFFSET_TOO_LARGE`, `_SYNC_INCOMPLETE`, `_SYNC_LOW_SCORE`, `_SYNC_NOT_FOUND` |
| `src/schema.gql` | Regenerated | Never hand-edited (Article IV) |

## Existing code to reuse

- **`src/subtitle-search/acceptance.ts`.** Use `accept(measurement)` and the `SyncMeasurement`
  type. Import the file directly and never copy the rule (spec REQ-4). Do **not** import
  `SubtitleSearchModule`: it imports `SubtitleEmbedModule`, so the module import would be a cycle.
- **`src/subtitle-search/last-cue.ts`.** Use `lastCueEndMs(text)`. Feed it the output of
  `sidecar-text.ts`, never `readFile(..., 'utf8')`.
- **`SubtitleSearchService.completed()`/`failed()`.** These are the shape the new report handlers
  follow:
  - an unknown row answers `false`;
  - a row in a terminal or other non-`SYNCING` state answers `true` with no change;
  - an unknown worker error key is stored as `sync_failed` with a warning.
- **`SubtitleEmbedService.queueEmbed()`.** Its "enqueue failed → delete the row and rethrow" is the
  posture for enqueueing the measurements from inside `embed()`.
- **`SubtitleEmbedService.createGuarded()`.** Its serializable `$transaction` with `P2034 → busy`
  stays the single row-creation path. It gains a `status` parameter and does not get a twin.
- **`SubtitleSyncQueueService.addSync()`.** `addEmbedSync` sits beside it on the same `Queue`
  instance, with `attempts: 1`. Its job id is `subtitle-embed-sync-<embedId>-<trackIndex>`; the
  index is used because a file name is not a safe job id.
- **`@AllowService()` + `assertService(principal)`.** Every service-only operation in
  `subtitle-embed.resolver.ts` already uses this pair.
- **`i18nError.notFound/conflict/badRequest`.** Use these with `ERROR_KEYS`, never a bare Nest
  exception.

## Steps

1. **Migration and enum.** Add `SYNCING` to `SubtitleEmbedStatus` in `schema.prisma` (listed first,
   matching the SDL order). Run `bin/cli api npx prisma migrate dev --name subtitle_embed_syncing`.
   Mirror the value in `subtitle-embed-status.enum.ts`.
2. **The single active list.** Export `ACTIVE_EMBED_STATUSES` from `active-embed.guard.ts`,
   including `SYNCING`. Then:
   - `createGuarded` counts against that list;
   - `reconcileOrphanedEncodes` updates `where: { status: { in: ['SYNCING', 'RUNNING'] } }` with
     the existing `interrupted` key;
   - `SubtitleSearchDriver.embedActive` is **left alone**. A staged embed never reads `SYNCING`
     (NFR-5), and editing `103`'s driver is out of scope.
3. **Input.** Add `autoOffset` to `SubtitleEmbedInput`, defaulting to `false` so the existing
   `web` payload keeps working. In `validateSelection`, call `assertOffsetInRange` only for
   `!autoOffset`.
4. **`embed()`.**
   - Build `StoredTrack`s as today, carrying `autoOffset: true` on automatic ones. Their `offsetMs`
     is stored as `0` until measured.
   - If no track is automatic, the path is unchanged.
   - Otherwise, `createGuarded(..., 'SYNCING')`. Then `SubtitleEmbedSyncService.enqueue(row)`
     enqueues one job per automatic track. If any enqueue throws, delete the row and rethrow, as
     `queueEmbed` does.
   - Return `toEntity(row)`.
5. **`sidecar-text.ts`.** Write a pure `decodeSidecar(buf: Buffer): string`:
   - BOM `EF BB BF` → UTF-8 without the BOM;
   - `FF FE` → UTF-16LE;
   - `FE FF` → UTF-16BE (swap the bytes, then decode as UTF-16LE);
   - anything else → UTF-8.
   The cue timings are ASCII, so a Latin-1 file decoded as UTF-8 still matches.
6. **`SubtitleEmbedSyncService`.**
   - **`details(subtitleEmbedId, fileName)`.** Refuse with
     `notFound(SUBTITLE_EMBED_SYNC_NOT_FOUND)` unless the row is `SYNCING` and `fileName` names an
     automatic track. Otherwise return `{ subtitleEmbedId, fileName, filePath: row.filePath,
     candidatePath: join(dirname(row.filePath), fileName) }`.
   - **`completed(subtitleEmbedId, fileName, report)`.**
     - An unknown row answers `false`. A row not `SYNCING`, or a track already measured, answers
       `true` with no change.
     - Read the sidecar (outside the transaction) and `lastCueEndMs(decodeSidecar(buf))`. A read
       error gives `null`, which `accept()` turns into `incomplete`.
     - Run `accept()` and map its result through a fixed `RejectionKey → error.subtitleEmbed.sync_*`
       table.
     - In a serializable `$transaction` guarded on `status: 'SYNCING'`, write the track's
       `measurement` and, if accepted, its `offsetMs`.
       - Rejected: set the row to `FAILED` with the mapped key and `finishedAt`.
       - Accepted and every automatic track now has an accepted measurement: set the row to
         `QUEUED`.
     - After the transaction, if it flipped to `QUEUED`, call `queue.addEmbed({ subtitleEmbedId })`.
       If that throws, `updateMany({ id, status: 'QUEUED' } → FAILED, sync_failed)` and log.
     - On `P2034`, rethrow so the worker's `deliverReport` retries.
   - **`failed(subtitleEmbedId, fileName, errorKey)`.** The only accepted key is
     `SUBTITLE_EMBED_SYNC_FAILED`; anything else is warned and stored as that key. Use a guarded
     `updateMany({ id, status: 'SYNCING' })` to `FAILED`. Always answer `true` for a known row.
7. **Resolver.** Add the three operations with `@AllowService()`, names and argument types exactly
   as in `../spec.md`. `subtitleEmbedSyncCompleted`'s `framerateRatio`/`score` are `Float`, and
   `lastCueEnd` is never an argument.
8. **Keys.** Add the six new `ERROR_KEYS` and their English `messages.en.ts` entries. The five
   stored ones match `../spec.md`'s table. `SYNC_NOT_FOUND` is worker-facing.

## Contract obligations

`api` exposes exactly `../spec.md` § GraphQL Contract Delta:

- `SubtitleEmbedStatus.SYNCING`;
- `SubtitleEmbedInput.autoOffset: Boolean! = false`;
- the `SubtitleEmbedSyncDetails` type;
- `subtitleEmbedSyncDetails`, `subtitleEmbedSyncCompleted` and `subtitleEmbedSyncFailed`.

It also exposes the queue contract: job `subtitle-embed-sync` on queue `subtitle-sync`, with payload
`{ subtitleEmbedId: number, fileName: string }`.

Every row it stores as `FAILED` from this feature carries one of these keys:

- `sync_failed`
- `sync_framerate_mismatch`
- `sync_offset_too_large`
- `sync_incomplete`
- `sync_low_score`
- `interrupted`

The contract is read-only. If it is wrong, stop and report.

## Tests

- **`subtitle-embed-sync.service.spec.ts`.**
  - Defends against a `SYNCING` embed that never leaves `SYNCING`:
    - an accepted single track flips to `QUEUED` and calls `addEmbed` once;
    - two tracks flip only after the second is accepted;
    - a rejected track sets `FAILED` with the mapped key and calls `addEmbed` zero times;
    - a duplicate report for a measured track changes nothing;
    - a report for a non-`SYNCING` row answers `true` and writes nothing;
    - an `addEmbed` failure after the flip ends `FAILED`/`sync_failed`.
  - Every `RejectionKey` maps to an `error.subtitleEmbed.sync_*` key, so a search key never leaks
    onto the embed.
  - `details` refuses a manual track and a non-`SYNCING` row.
- **`sidecar-text.spec.ts`.** UTF-16LE and UTF-16BE BOM fixtures produce a non-null
  `lastCueEndMs`; plain UTF-8 and UTF-8-with-BOM do too. Without this, a valid sidecar is silently
  rejected as `incomplete`.
- **`subtitle-embed.service.spec.ts`.**
  - An automatic track creates `SYNCING` and enqueues N measurements, not the remux.
  - An automatic track with `offsetMs: 999999` is not refused.
  - A manual-only embed still creates `QUEUED`.
  - An enqueue failure deletes the row.
  - A `SYNCING` row makes `createGuarded` refuse with `busy`.
- **`process-jobs.service.spec.ts`.** `reconcileOrphanedEncodes` fails a `SYNCING` embed with
  `interrupted`.
- **Not tested.** The resolver's three operations beyond the existing service-only pattern: they
  are thin delegations, and `subtitle-embed.resolver.spec.ts` already proves the
  `@AllowService` + `assertService` pair. Add one case per operation only if that spec enumerates
  every operation today.

## Done when

```bash
bin/cli api npx prisma migrate status
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/npm api run lint
bin/comments api
```

The migration is applied, typecheck and lint are clean, and every test passes. `schema.gql` shows
the delta verbatim, with no other diff in it.

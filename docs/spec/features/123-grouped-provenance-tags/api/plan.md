---
title: Grouped Provenance Tags — api slice
service: api
last_updated: 2026-11-20
status: Implemented
---

# PLAN: Grouped Provenance Tags — `api` (`api/plan.md`)

## Scope

`api` does three things in this feature:

- sends the subtitle embed three new per-track facts (`provider`, `syncScore`, `framerateRatio`);
- owns the library tag migration end to end: the two new tables, the admin query and mutation,
  the worker-facing item query and report, the `library-tags` queue producer, the busy guard in
  both directions, re-enqueueing on worker boot and the media-server notification after a
  `MIGRATED` file;
- parses the stored `ProcessJob.ffmpegCommand` into the plain values that
  `LibraryTagMigrationItemDetails` carries (REQ-15).

`api` does **not** build tag XML, read or write any library file, or decide `MIGRATED`/`UNCHANGED`.
Those belong to the worker. It does not render anything, which belongs to `web`. It does not touch
the encode path at all: everything the encode's group needs is worker-local.

The destinations root stays read-only in `api` (Article XII Check).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/prisma/schema.prisma` | Modified | `LibraryTagMigration`, `LibraryTagMigrationItem`, enums `LibraryTagMigrationStatus`, `LibraryTagOutcome`; back-relations on `Movie`/`Episode` |
| `services/api/prisma/migrations/<ts>_123_library_tag_migration/` | New | the migration |
| `services/api/src/subtitle-embed/entities/subtitle-embed-details.entity.ts` | Modified | `provider: String!`, `syncScore: Float`, `framerateRatio: Float` on `SubtitleEmbedTrack`; `provenance` description now says it feeds `PERCEPTOR` → `SOURCE` |
| `services/api/src/subtitle-embed/subtitle-embed.service.ts` | Modified | `StagedTrackInput`/`StoredTrack` gain `provider`, `syncScore`, `framerateRatio`; `embedFromSidecars` stores `provider: 'user'`; `details()` resolves all three (an auto-offset track reads them from its `measurement`) |
| `services/api/src/subtitle-search/subtitle-search.driver.ts` | Modified | passes the accepted attempt's provider (lower-cased kind), `score`, `framerateRatio` into `embedStaged`; the provenance expression moves to the shared function below |
| `services/api/src/subtitle-search/provenance.ts` | New | `provenanceOf(attempt)`: the one expression for a staged track's `SOURCE` (`providerFileName ?? <kind>:<providerSubtitleId>`), used by the driver and by the migration's matcher |
| `services/api/src/subtitle-embed/active-embed.guard.ts` | Modified | `assertNoActiveEmbed` also refuses with `error.libraryTags.busy` when the target has a claimed, unsettled `LibraryTagMigrationItem` (season target: any episode of the season) |
| `services/api/src/library-tags/library-tags.module.ts` | New | module |
| `services/api/src/library-tags/library-tags.resolver.ts` | New | `libraryTagMigration`, `startLibraryTagMigration` (`AdminGuard`), `libraryTagMigrationItem`, `libraryTagMigrationItemFinished` (`@AllowService`, service principal only) |
| `services/api/src/library-tags/library-tags.service.ts` | New | start, claim, settle, finish, re-enqueue on worker boot, notify the media server |
| `services/api/src/library-tags/ffmpeg-command.ts` | New | pure parser `parseEncodeCommand(command) → { videoCodec, crf, preset, contentKind, resolutionCeiling, outputResolution, deinterlaced, grainApplied }` with quote-aware tokenizing; every field nullable |
| `services/api/src/library-tags/entities/*.ts` | New | the GraphQL object types and enums from the spec |
| `services/api/src/queue/types.ts` | Modified | `LIBRARY_TAGS_QUEUE = 'library-tags'`, `LIBRARY_TAGS_JOB = 'library-tags'`, `LibraryTagsJob = { itemId: number }` |
| `services/api/src/queue/library-tags-queue.service.ts` | New | producer, `jobId` = `library-tags-<itemId>`, small `attempts`/backoff for stall retry |
| `services/api/src/process-jobs/process-jobs.service.ts` | Modified | `reconcileOrphanedEncodes` (the `encodeWorkerStarted` handler) also calls the migration's re-enqueue |
| `services/api/src/i18n/error-keys.ts`, `messages.en.ts` | Modified | `LIBRARY_TAGS_MIGRATION_RUNNING`, `LIBRARY_TAGS_BUSY`, `LIBRARY_TAGS_ITEM_NOT_FOUND`, `LIBRARY_TAGS_ITEM_SETTLED`, `LIBRARY_TAGS_FILE_MISSING`, `LIBRARY_TAGS_WRITE_FAILED`, `LIBRARY_TAGS_VERIFY_FAILED` |
| `services/api/CLAUDE.md` | Modified | a `library-tags/` section; the `subtitle-embed/` section names the three new track fields |

## Existing code to reuse

- `src/subtitle-embed/active-embed.guard.ts`: the one busy guard every acquisition entry point and
  the embed service already call. Extend it; do not add a second guard that call sites would have
  to remember.
- `src/subtitle-embed/subtitle-embed.service.ts` `notifyMediaServer()`: the `modifiedMedia` call
  with its host-path translation and failure handling. Extract it, or call it through a small
  shared service, for NFR-6. Do not write a third media-server notify.
- `src/library-location/library-location.service.ts` `locate()`: resolves a title the media server
  holds to a container path. Use it when a title has no `filePath`. `not_held`/`outside_library`
  settle `MISSING`, and so does `unavailable` (see Steps, step 5).
- `src/media-roots/media-roots.service.ts` `containerToHostPath('library', …)`: for
  `LibraryTagMigrationFailure.path` and the stored `hostPath`.
- `src/queue/library-probe-queue.service.ts`: the producer pattern for a per-title worker job,
  including the deterministic `jobId`.
- `src/auth/guards/admin.guard.ts`, `@AllowService()` plus the `principal.type === 'service'` check
  in `process-jobs.resolver.ts`: the two authorization shapes this module needs.
- `src/environment/`: the module whose panel hosts the button. The migration gets its own module,
  but keep `environmentInfo` read-only (`055`). Do not fold the migration into it.
- `src/subtitle-embed/subtitle-embed-sync.service.ts`: `measurement` on an auto-offset track
  already holds `score`/`framerateRatio`. Read it; do not store a copy.

## Steps

1. **Schema and migration.** Add the two models and enums, with an index on
   `(migrationId, outcome)`. An item stores `movieId` or `episodeId`, `claimedAt`, `outcome`,
   `reasonKey`, `hostPath`, `settledAt`.
2. **`provenanceOf`.** Extract it from the driver unchanged and use it in the driver. Behaviour
   does not change.
3. **Embed track facts.**
   - Extend `StagedTrackInput`/`StoredTrack`.
   - The driver passes `provider` (`kindOf(attempt).toLowerCase()`) and the attempt's `score` and
     `framerateRatio`.
   - `embedFromSidecars` stores `provider: 'user'`.
   - `details()` returns `provider`: the stored value, else `user` for a sidecar or
     `opensubtitles` for a staged row from before this feature, the same fallback `provenance`
     already uses.
   - `details()` returns `syncScore`/`framerateRatio` from the stored values or from an
     auto-offset track's `measurement`, and `null` otherwise.
   - Add the three entity fields.
4. **Command parser** (`ffmpeg-command.ts`). It is pure and reads by flag:
   - `-c:v` gives `av1` for `libsvtav1` and `copy` for `copy`;
   - `-crf` and `-preset` are integers;
   - `-svtav1-params` gives `LIVE_ACTION` only when `scm=0`, otherwise null. It gives
     `grainApplied` from `film-grain=<n>`, as `n > 0`;
   - `-vf`: `scale=W:H` gives `resolutionCeiling` through the tier boxes (1920×1080 → `1080p`,
     1280×720 → `720p`, 854×480 → `480p`, 640×360 → `360p`). `outputResolution` is always null:
     `force_original_aspect_ratio=decrease` only bounds the output, it does not state it. The
     worker reads the real value from the file's own video stream instead, and the file wins
     (REQ-15). `bwdif` gives `deinterlaced: true`.

   Anything absent or unparseable is null. It never throws.
5. **Migration service.**
   - `start()`. Refuse with `migration_running` when one is `RUNNING`. Otherwise create the run
     and one item for every `Movie`/`Episode` that has a `filePath` or a `mediaServerPresentAt`
     (REQ-13), then enqueue every item. With zero items, the run is `COMPLETED` immediately.
   - `claim(itemId)`, the details query:
     - unknown id → `item_not_found`; already settled → `item_settled`;
     - title busy (a `ProcessJob` `ENCODING`/`WAITING`, `ACTIVE_EMBED_STATUSES`, or a
       `SubtitleSearch` past `WAITING`) → settle `BUSY` and throw `item_settled`;
     - resolve the path: `filePath` first, else `locate()`. No path → settle `MISSING`
       (`file_missing`) and throw `item_settled`;
     - otherwise set `claimedAt` and `hostPath`, and return the details.

     For the details, the global facts come from the parser over the delivering `ProcessJob`
     (the latest `COMPLETED` job for that movie/episode whose `outputFilePath` equals the path),
     plus `ENCODED_AT` = that job's `updatedAt`. Track facts come from the `ACCEPTED` attempts and
     `COMPLETED` embeds of the title, keyed by `provenanceOf(attempt)`, or `user` for a sidecar.
     `EMBEDDED_AT` is the embed's `finishedAt`. Trims are always null (REQ-15).
   - `finish(itemId, outcome, reasonKey)`. It is idempotent: an already settled item returns
     `true` and changes nothing. Otherwise it settles the item, increments the counters, and
     marks the run `COMPLETED` with `finishedAt` when nothing is left unsettled. On `MIGRATED` it
     calls the media-server notification. A failure there is logged and the outcome stays
     `MIGRATED` (NFR-6).
   - `requeueAfterWorkerBoot()`. For a `RUNNING` run, clear `claimedAt` on unsettled items and
     re-enqueue them. Call it from `reconcileOrphanedEncodes`.
6. **Busy guard.** Extend `ActiveEmbedGuard.assertNoActiveEmbed` so a claimed, unsettled item for
   the target throws `LIBRARY_TAGS_BUSY`. Check the embed first, so an embed conflict keeps its own
   key.
7. **Resolver and entities**, exactly as the spec's SDL. `libraryTagMigration` returns the latest
   run, or null. Its `failures` are the `FAILED` items' `hostPath` + `reasonKey`.
8. **Queue producer and types.** `src/queue/types.ts` is the source of truth that the worker copies
   by hand.
9. **i18n keys** and `CLAUDE.md`.

Unavailable media server (decision taken in planning, not in the spec): `locate()` returning
`unavailable` settles the item `MISSING` with `file_missing`, the same as `not_held`. The spec's
outcome enum has no transient-failure value, and a run is cheap to repeat. The api log line names
the cause, so it is still diagnosable.

## Contract obligations

`api` exposes exactly the spec's `## GraphQL Contract Delta` (v0.3.1):

- three new `SubtitleEmbedTrack` fields;
- `LibraryTagMigration*` types and enums;
- `libraryTagMigration`, `libraryTagMigrationItem`, `startLibraryTagMigration`,
  `libraryTagMigrationItemFinished`.

It raises every error in the spec's table with that exact key:
- `error.auth.admin_required` from `AdminGuard`;
- `migration_running`, `busy`, `item_not_found`, `item_settled`;
- the three per-file `reasonKey`s, accepted from the worker and stored verbatim. Log an unknown
  `reasonKey` and store it anyway: it is display data, and `web` falls back to the generic key.

## Tests

- `src/library-tags/ffmpeg-command.spec.ts` defends against a mis-parsed command written into a
  library file as truth. Use real stored commands from the `011`, `057`, `058`, `092` and `115`
  eras, and one with a path containing spaces. Check that `ANIME`/`CGI` give a null kind, a copy
  gives null CRF/preset/grain, and garbage gives all nulls without throwing.
- `src/library-tags/library-tags.service.spec.ts` defends against:
  - a title left busy forever (claim then worker boot → claim cleared and item re-enqueued);
  - a run stuck `RUNNING` (the last settle completes it, and a duplicate report is a no-op);
  - `BUSY`/`MISSING` overwritten by a late worker report;
  - a second run starting while one is running;
  - the media-server failure path leaving `MIGRATED` intact.
- `src/subtitle-embed/active-embed.guard.spec.ts` (extend): a claimed item refuses with
  `libraryTags.busy`, a settled one does not, and an active embed still wins with its own key.
- `src/subtitle-embed/subtitle-embed.service.spec.ts` (extend): `details()` resolves
  `provider`/`syncScore`/`framerateRatio` for a staged track, a manual sidecar, an auto-offset
  sidecar and a pre-feature row (fallbacks, nulls).
- `src/subtitle-search/provenance.spec.ts` defends against the matcher and the driver diverging
  (the `providerFileName` and fallback forms).
- The resolver is not owed its own test beyond the guard wiring, which the existing `AdminGuard`
  spec covers.

## Done when

```bash
bin/cli api npx prisma migrate status
bin/cli api npx --no tsc --noEmit
bin/npm api run test
bin/comments api
```

All four pass, and `services/api/src/schema.gql` matches the spec's SDL field for field.

---
title: Season Pack Post-Download Processing — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-08-17
status: Approved
---

# PLAN: Season Pack Post-Download Processing (`plan.md`)

## Approach

The feature has three seams and each one is an extension of something that already exists — none of
them is a new subsystem.

**The scan seam.** `services/worker/src/scan/scan-folder.ts` today does two jobs in one function:
enumerate the download, and pick the single largest video. The plan splits them. `scanFolder` keeps
only the enumeration (it already handles the `LOCAL_FILE` `ENOTDIR` case, and that stays untouched)
and starts reporting `isVideo` per file, using the `VIDEO_EXTENSIONS` list it already owns. Selecting
*which* files matter moves into two new pure modules beside it — `src/scan/parse-episode.ts` (the
`SxxEyy` regex, nothing else) and `src/scan/select-matches.ts` (the two selection rules: "largest
video wins" for a film/episode source, "one per episode, largest duplicate wins" for a season). That
split is the house pattern in this service already — small pure modules with locally declared types,
exactly like `src/paths/build-output-path.ts` and `src/paths/is-inside-root.ts` — and it is what
makes AC-8 testable without a filesystem. The alternative, teaching `scanFolder` a `mode` argument,
was rejected: it would put a rule-dense branch inside the one function in the service that does I/O,
which is precisely the shape `011-av1-transcode` had to undo in `buildCommand.ts`.

**The fan-out seam.** `MediaSourcesService.sourceScanned` already contains every piece the season
case needs — the transaction, the `SourceFile` upsert on `@@unique([mediaSourceId, filePath])`, the
find-or-create of `ProcessJob` that refuses to reset a job past `WAITING`, and the deliberate
enqueue-after-commit. It is extended from one match to a loop over N, not rewritten. Its existing
`processJobIdsToQueue` array was already plural for the enqueue step, which is the shape the loop
wants. Episode resolution is one `season.episodes` include on the `MediaSource` lookup plus an
in-memory map by `episodeNumber` — no per-file query.

**The cleanup seam.** The gate lives in `ProcessJobsService.encodeCompleted`, which already updates
the job and already branches on `movieId`/`episodeId`. It gains a sibling query and returns three
instructions instead of a bare string. The worker keeps `cleanupSource()` exactly where it is in
`handleEncode` — after the encode's `try/catch`, inside its own logging-only `try` — and passes the
instructions into it; nothing about the "cleanup may never demote a finished job" contract moves.

Inside `cleanup-source.ts` the change is smaller than the contract makes it look, because the
function already does all three actions — it just did them unconditionally and in a fixed
combination. Each is now behind its own flag, and one new deletion target appears: the job's own
input file, which needs its own `isInsideRoot(downloadsRoot, inputFilePath)` check. That guard is not
optional and not implied by the one on `downloadPath`: for a season pack the two paths differ, and
`inputFilePath` comes from `SourceFile.filePath`, which is worker-reported data that made a round
trip through the database. `removeTorrent` stays where it is today — on the last job of the source — and
the per-episode deletions happen underneath a still-loaded torrent on purpose: a season torrent is
100% complete before the first encode starts, so nothing can be interrupted, and qBittorrent showing
it as missing files for the duration of the pack is cosmetic. What does change is that
`downloadRemove` stops asking qBittorrent to delete anything (`deleteFiles: false`), which leaves
exactly one code path in the whole system that removes a file, with exactly one containment check in
front of it.

**Reused, not reinvented**: `services/api/src/episodes/episodes.service.ts`'s `attachTorrentSource`
is the template for the season one. It will be the **third** structural twin of that method
(`movies`, `episodes`, now `seasons`) and it is still not being extracted into a shared helper —
`010-episode-acquisition`'s `api/plan.md` records why, and the ownership join, the conflict scope and
the "which row do we demote" query differ in each. Copying it a third time is the decision, taken
deliberately; a fourth twin would be the moment to revisit.

## Order of Work

`api` first. It owns the migration, the two changed mutation signatures and the new module, and the
worker cannot send `matches` to a resolver that still takes `matchedFilePath`.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | owns the `hasUnmatchedFiles` migration and both contract changes; nothing the worker sends is accepted until this lands |
| 2 | `worker` | consumes `matches`/`isVideo`/`cleanupSource`, all of which must exist server-side first |
| 3 | `docs` | root `CLAUDE.md` pipeline table, `services/*/CLAUDE.md`, `docs/spec/graphql-contract.md` |

**Steps 1 and 2 may genuinely run in parallel**, because the contract is frozen below and both
slices retype it from the same document rather than from each other's code. What may **not** overlap
is verification: the stack is broken in between — an `api` that expects `matches` and a worker that
still sends `matchedFilePath` fails at runtime with a GraphQL validation error, not a compile error.
Neither slice may be considered done until both are in and `bin/dev` runs a real download through.

## Contract Freeze

`spec.md` § GraphQL Contract Delta is frozen as of `status: Approved`. Three things will look wrong
from inside one service and are right for the feature as a whole:

- **`SourceFileInput.isVideo` looks redundant to `api`** — it already receives a file list and could
  test extensions itself. It must not. The extension list lives in the worker
  (`VIDEO_EXTENSIONS` in `src/scan/scan-folder.ts`); a second copy in `api` is a second truth that
  drifts the first time someone adds `.mkv3`, and the drift is silent: `api` would count a video it
  does not recognise as unmatched and suppress cleanup forever.
- **`matches` carries `seasonNumber`/`episodeNumber` that `api` ignores for a film or a
  single-episode source.** The worker sends `null` there anyway, but even a populated value must not
  redirect such a source. From the worker's side it looks like dead data; it is what keeps AC-3 true.
- **`encodeCompleted` returning three booleans instead of a string looks like churn to the worker**
  — it only wanted the log line. None of the three can be computed anywhere else: they depend on the
  sibling `ProcessJob` rows and on `hasUnmatchedFiles`, neither of which the worker can see
  (Constitution, Article III). Do not approximate any of them worker-side from job counts, from the
  payload, or from what is on disk.
- **`downloadRemove(deleteFiles: false)` looks like a regression to `api`** — the old call passed
  `true` and the files went away with the torrent. They still go away, one line later, from the
  worker, behind `isInsideRoot`. Passing `true` here would delete files through a path no containment
  check covers, and for a season pack it would delete the inputs of every episode that has not
  encoded yet.
- **`removeTorrent` fires on the last job to *finish*, not the last to *succeed*.** A pack whose
  fifth episode failed still drops the torrent once the tenth finishes; only the folder is kept. The
  two conditions look interchangeable and are not.

If any of this turns out wrong mid-flight: stop, amend `spec.md`, re-approve, re-brief both slices.

## Migrations

1. `add_has_unmatched_files_to_media_sources` — adds `hasUnmatchedFiles Boolean @default(false)` to
   `media_sources`. Generated with `bin/npm api run prisma:migrate`, never hand-written SQL
   (Constitution, Article III).
2. Backfill: **none needed.** `false` is the correct value for every existing row — no historical
   source was scanned with per-file resolution, and each row's value is recomputed the next time
   `sourceScanned` runs against it. The column is non-null with a default, so the migration is a
   plain `ALTER TABLE ... ADD COLUMN` with no data step.

Reversibility: dropping the column reverts cleanly at the schema level. What does not revert is the
mutation signature — a rollback of `api` alone, with the new worker still deployed, breaks every
scan. Roll both services back together or neither.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `hasUnmatchedFiles` computed from *all* files instead of video files | every `.nfo`/`.srt` in a torrent counts as unmatched, so `cleanupSource` is `false` forever, no download is ever deleted and the disk fills — nothing logs an error, every job says `COMPLETED` | `isVideo` is on the frozen contract; `api`'s spec asserts a source with a `.nfo` sibling and one matched video clears the flag |
| `deleteDownloadPath` fires on the first sibling of a pack | encode #1 deletes the directory holding the inputs of #2..#10; those jobs then fail with `ENOENT` *after* the user already saw one episode succeed | the three verdicts are computed server-side in `encodeCompleted`, covered by AC-6 and AC-9; the worker has no path to a deletion that does not go through them |
| `deleteInputFile` deletes the wrong file | the flag is per-job and the path comes from `SourceFile.filePath`; a job handed another job's path silently destroys an input that has not been encoded yet, and the loss is invisible until that episode's encode fails much later | the worker deletes `details.inputFilePath` — the same string it just fed to FFmpeg — and never re-derives it; `isInsideRoot` guards it separately from `downloadPath` |
| The torrent is still loaded while files disappear | qBittorrent shows the torrent as missing files for the duration of the pack | **accepted.** The download is complete before any encode starts, so nothing is interrupted; the client entry is dropped at the last job. Only a seeding policy would care, and there is none — see `spec.md` § Out of Scope |
| `downloadRemove` keeps deleting files client-side | two independent deletion paths, only one of which is behind `isInsideRoot`; for a pack, qBittorrent takes the whole folder at the first completion and the remaining episodes fail | the argument defaults to `true` for existing callers but this pipeline always passes `false`; asserted in `api`'s spec |
| A worker field is added to the query but not to the local type (or the reverse) | the field arrives `undefined`; a falsy `deleteDownloadPath` silently never cleans up, and a falsy `removeTorrent` leaves torrents accumulating in the client — the exact `allowedLanguagesIso3` failure `011-av1-transcode` documented | both edits are one step in `worker/plan.md`, and `handleEncode` skips cleanup entirely and logs a `console.error` naming any of the three that arrives `undefined`, rather than reading it as `false` |
| `SxxEyy` parsed off the full path instead of the base name | a download folder named `.../Show S02 COMPLETE/ep3.mkv` makes every file in it resolve to S02E00, or worse, all to the same episode — jobs are created against wrong episodes and the wrong files land in the library, all reporting success | REQ-3 fixes the base name; `parse-episode.spec.ts` asserts the path case explicitly (AC-8) |
| Two files resolving to the same episode | two `ProcessJob` rows write the same output path; the second overwrites the first mid-play, or both run at once through the queue | `select-matches.ts` keeps the largest per episode; the rest count as unmatched, which also suppresses cleanup so the user still has the discarded file |
| An episode already has an active source when its season pack lands | the episode gets two `ProcessJob` rows from two `MediaSource`s racing for the same output path, and `addMagnetToSeason`'s conflict check does not see them — it is season-scoped, exactly as `addMagnetToEpisode`'s is episode-scoped | **accepted, not mitigated.** Documented here and in `spec.md` § Out of Scope's neighbourhood; the cross-scope conflict check needs a rule the spec does not have (which source wins?) and would expand the feature. It requires the user to deliberately request both. |
| `Season` returned from `addMagnetToSeason` without its episodes | `Season.episodes` is `[Episode!]!` — a return that does not `include` them fails the whole mutation *after* qBittorrent already accepted the torrent and the rows were written, so the user sees an error for an operation that actually succeeded | `api/plan.md` names the `include` explicitly; the manual pass in Verification calls the mutation selecting `episodes { id }` |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/cli api npx prisma migrate status
```

Manual pass, with `bin/dev` up:

1. Register a series from the UI and let its seasons sync. Note a season id from
   `bin/mysql -e 'select id, show_id, season_number from seasons order by id desc limit 5'`.
2. Call `addMagnetToSeason(seasonId: …, magnet: "…")` against `api`'s GraphQL playground with a
   season-pack magnet, selecting `{ id seasonNumber episodes { id } }` — the selection is part of
   the check (see the `Season.episodes` risk).
3. Watch `docker compose logs -f worker`: the scan line must report N matches, and name every video
   it skipped.
4. `bin/mysql -e 'select id, media_source_id, file_path from source_files order by id desc limit 15'`
   and the same for `process_jobs` — one row per episode present in the pack, no row for anything
   skipped.
5. Let the encodes run, watching `ls "<HOST_DOWNLOADS_DIR>/…/<the pack folder>"` between them: after
   each completion one more input file is gone; after the last one the folder itself is gone and the
   torrent is no longer listed in qBittorrent.
6. Repeat with a pack containing one unclassifiable video: the torrent is still dropped at the last
   encode, but the folder survives holding only that file, and `has_unmatched_files` is `1`.
6b. Run one ordinary film download start to finish and confirm nothing changed for it — torrent gone,
   folder gone, one step, after its single encode.
7. `ls "<HOST_DESTINATIONS_DIR>/<path_shows>/<Show> (<year>) [tmdbid=<id>]/Season NN/"` — file names
   must carry the episode titles from the `episodes` table, not from the release.

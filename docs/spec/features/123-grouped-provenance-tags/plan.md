---
title: Grouped Provenance Tags — Implementation Plan
spec_version: 0.3.1
last_updated: 2026-11-20
status: Implemented
---

# PLAN: Grouped Provenance Tags (`plan.md`)

## Approach

The feature has three parts, and each extends something that already exists:

1. **New encodes write the group.** The worker already finishes every encode with a `mkvmerge`
   pass (`services/worker/src/ffmpeg/runner.ts`, `mkvmerge -o <part> <working>`). That pass gains
   `--global-tags <xml>`, so the nested `PERCEPTOR` group is written by the tool that already owns
   the final file. No extra pass or tool is added to the encode. FFmpeg stops writing the flat
   `-metadata PERCEPTOR_SOURCE=` (`buildCommand.ts`). `-metadata title=` stays, because it becomes
   the segment title players read. The facts come from the encode driver
   (`src/encode/encode.ffmpeg.ts`), which already has every verdict in hand: grain, both trims,
   the content kind, the box. Only grain needs more than it returns today: `resolveFilmGrain`
   returns a bare boolean and must also say which stage decided. That stage name is already in
   its own log line. `OUTPUT_RESOLUTION` is read by one `ffprobe` of the working file after FFmpeg
   exits, not computed from the filter, so it records what was actually written.

2. **New subtitle embeds write the group.** `src/subtitles/embed-tags.ts`'s `buildTrackTagsXml`
   already produces the per-track XML that `mkvmerge --tags 0:<xml>` takes. It changes shape from
   two flat `Simple`s to one nested `PERCEPTOR`. `api` sends the three new `SubtitleEmbedTrack`
   fields:
   - `provider`: for a staged track, the attempt's `SubtitleProviderKind` lower-cased, the same
     expression `subtitle-search.driver.ts` already uses for its fallback provenance; `user` for a
     hand embed.
   - `syncScore`/`framerateRatio`: from the accepted `SubtitleSearchAttempt` for a staged track,
     or from a `113` auto-offset track's stored `measurement`.

3. **The library migration** is a new `api` module with two tables and a new BullMQ queue
   (`library-tags`, one job per file). Its worker job is a new handler built from the `mkvtoolnix` tools already in the image:
   - it extracts the file's whole tag XML with `mkvextract tags` into a temporary file outside
     the library;
   - it reads the track list with `mkvmerge -J`;
   - it builds one replacement XML in which every non-Perceptor tag is kept verbatim and the flat
     tags are replaced by the merged groups;
   - it writes that XML back with `mkvpropedit --tags all:<xml>`. `api` parses the stored
   `ProcessJob.ffmpegCommand` for REQ-15. `api` owns the database, and the parser is
   `api`-internal: the worker receives plain values (`crf`, `preset`, …) and never sees the
   command string.

**Alternatives rejected.**
- Writing the encode's group with `mkvpropedit` after `rename`. That edits the library file in
  place on every encode. Constitution 1.8.0 allows that only for the admin's migration, and the
  `mkvmerge` pass already exists.
- Parsing `ffmpegCommand` in the worker. That would send a raw command string across the contract
  and spread knowledge of `api`'s rows into the worker.
- One BullMQ job for the whole walk. A worker restart would lose its position, and one bad file
  would make the whole walk fail or retry.

**Resume after a restart (NFR-4).** It comes from BullMQ, not from new machinery:
- Each item is its own job, and `jobId` is the item id, so a re-enqueue is idempotent.
- An in-flight job that BullMQ sees stall is retried.
- `api` re-enqueues every unsettled item of a `RUNNING` migration when the worker announces its
  boot (`encodeWorkerStarted`, `054`). That covers a Redis that lost the jobs.
- The migration reads `COMPLETED` when its last item is settled.

**Busy (REQ-17).** It reuses `ActiveEmbedGuard` (`services/api/src/subtitle-embed/active-embed.guard.ts`).
The guard is already called by every acquisition entry point (`AttachSourceService`, the uploads
resolver) and by the embed service. It gains one more check: an item of this title that is claimed
and not yet settled. That check throws `error.libraryTags.busy`. In the other direction, `api`
settles an item as `BUSY` when the worker asks for its details. It does that if the title has a
live encode, an active embed, or a search past `WAITING`.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration, the new tables, the contract fields and the queue name the worker consumes. |
| 2 | `infra` | Adds the `PERCEPTOR_VERSION` build arg/env to the worker image. Independent of everything else, so it can run in parallel with step 1. |
| 3 | `worker` | Consumes the frozen contract; needs `api`'s queue name, both query/mutation shapes and `PERCEPTOR_VERSION` (falls back to `dev` without it, so it is not blocked by step 2). |
| 4 | `web` | Renders `LibraryTagMigration`; needs only `api`'s query/mutation. Can run in parallel with step 3 once step 1 has landed. |

Steps 1 and 2 are parallel. After step 1, steps 3 and 4 are parallel. The contract is frozen by
this approval, so "parallel" here does not mean "diverging".

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` (v0.3.1) is frozen as of `status: Approved`. Things
an implementer will be tempted to change, and must not:

- **`SubtitleEmbedTrack.provider` is a `String`, not an enum.** From inside `api` an enum mirroring
  `SubtitleProviderKind` looks tidier. REQ-10 needs the worker to write a future provider verbatim
  with no worker change, and an enum would force a worker change for each new provider.
- **`provenance` keeps its name and value.** It now feeds `PERCEPTOR` → `SOURCE`. Renaming it to
  `source` would break a worker built before this feature, against a newer `api`, with no compile
  error.
- **`LibraryTagMigrationItemDetails` carries values, never the command string.** The worker must
  not ask for `ffmpegCommand`.
- **`item_settled` means "report nothing".** A worker that reports `UNCHANGED` after an
  `item_settled` would overwrite the `BUSY`/`MISSING` that `api` already wrote.
- **`LibraryTagMigrationFailure.path` is a host path.** The container path never crosses the
  GraphQL boundary to `web` (root `CLAUDE.md`, Paths).
- **Every child name** (`SOURCE`, `ENCODE`/`CRF`, `GRAIN`/`DECIDED_BY`, …) and every enumerated
  value (`av1`/`copy`, `title`/`setting`/`gate`/`probe`/`short`, `yes`/`no`) are spelled exactly as
  REQ-4 to REQ-9 give them. These names are the external interface a human or tool reads, and the
  migration's idempotence check compares them.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, and re-brief
`api`, `web` and `worker`.

## Migrations

1. `123_library_tag_migration` (`api`) adds `LibraryTagMigration` and `LibraryTagMigrationItem`,
   with two enums: `LibraryTagMigrationStatus` (`RUNNING`, `COMPLETED`) and `LibraryTagOutcome`
   (`MIGRATED`, `UNCHANGED`, `BUSY`, `MISSING`, `FAILED`). Items carry:
   - nullable `movieId`/`episodeId` with `onDelete: Cascade`;
   - nullable `claimedAt`, `outcome`, `reasonKey` and `hostPath`;
   - `@@index([migrationId, outcome])`.

   The new tables need no backfill.
2. `SubtitleEmbed.tracks` is JSON. Tracks gain optional `provider`, `syncScore` and
   `framerateRatio`. No migration is needed: old rows read them as absent (REQ-2).

Reversibility: dropping both tables loses only migration history. No other row references them,
and the library files keep whatever tags were already written.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `mkvmerge` copies the working file's own global tags along with `--global-tags` | A new encode carries both the group and a leftover flat tag, or two `PERCEPTOR` groups. No error anywhere. | FFmpeg no longer writes the flat tag. The worker's tag-building unit is tested to produce exactly one group. AC-1 is checked live with `mkvinfo`. |
| `mkvpropedit` cannot fit the new `Tags` element in place and rewrites more of the file than expected | A slow edit with a longer non-atomic window. Accepted by Article XII exception 3. | Before/after probe comparison (NFR-4). The window is logged per file. |
| The stored `ffmpegCommand` quoting (`runner.ts` wraps an argument that contains a space in `"`) is parsed naively | A path with spaces shifts every later argument. The wrong CRF or preset is written as truth. | The `api` parser reads values by flag (`-crf`, `-preset`, `-svtav1-params`, `-vf`, `-c:v`) with quote-aware tokenizing, and is tested against real stored commands from each era (`011`, `057`, `058`, `092`, `115`). An unparseable value is omitted, never guessed. |
| An `ANIME`/`CGI` command is reported as one of them | A false `CONTENT_KIND` on migrated files. No error. | The parser returns a kind only for `scm=0` (`LIVE_ACTION`). For the shared `scm=2` parameters it returns null (REQ-15). Tested. |
| A track's `SOURCE` does not match any attempt's `providerFileName` | Provider and sync are left out for that track. Silent but correct (REQ-2). | The matcher reuses the driver's own provenance expression, including the `<kind>:<id>` fallback. That expression is moved out of the driver into a shared function, so the two cannot drift. Tested. |
| An item is claimed, and the worker dies before reporting | The title stays busy forever and refuses every acquisition, with `error.libraryTags.busy` and no way out. | On `encodeWorkerStarted`, `api` clears `claimedAt` on every unsettled item and re-enqueues those items. BullMQ stall retry covers a worker that survived. Tested in `api`. |
| A migration never reaches `COMPLETED` (a job was lost) | The panel reads "running" forever, and REQ-19 refuses every new run. | Same re-enqueue on worker boot. The panel also shows `processed / total`, so a stuck count is visible. AC-12 is checked live. |
| A new encode on an old `api` (mixed versions) | The worker asks for fields that do not exist and the query errors. | Not new to this feature: a single `PERCEPTOR_TAG` across all images already rules out mixed versions (root `CLAUDE.md`). |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
bin/cli worker npx --no tsc --noEmit
bin/npm worker run test
bin/cli web npx --no tsc --noEmit
bin/npm web run test
bin/comments
bin/build prod worker
```

Then the manual pass (dev stack, compression on, Jellyfin configured):

1. Encode a film. Run `mkvinfo` on the library file and check AC-1. With `dub_trim_enabled` on and
   a known trimmed file (`fixtures/dub-trim/` cases), check AC-2. Run
   `docker image inspect perceptor-worker:local-prod` plus a test encode from that image for AC-3.
2. Set `compression_enabled` off, deliver a film, and check AC-4.
3. Run a subtitle search that accepts a Subdivx candidate. Then hand-embed a sidecar with a manual
   offset. Check AC-5 with `mkvinfo`, including that the existing tracks' tags are unchanged.
4. Sign in as a non-admin and check AC-6, in the UI and by calling `startLibraryTagMigration` directly.
5. Copy an old library file that has flat tags. Run the migration and check AC-7, AC-7b and AC-7c
   (in the api log, and by opening the item in Jellyfin). Run it again for AC-8.
6. `chmod 000` one file and delete another, then run the migration (AC-9). Press the button twice
   (AC-10). Start an embed and run the migration while it is `RUNNING` (AC-11). Run
   `docker compose restart worker` mid-walk (AC-12).

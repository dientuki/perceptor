---
title: Jellyfin Subtitle Embed — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-10-23
status: Implemented
---

# PLAN: Jellyfin Subtitle Embed (`plan.md`)

## Approach

The feature is a new, small job type that follows the same shape the encode already has. `api`
owns the decision, the state and the two Jellyfin conversations: listing the sidecars, then
refreshing the item. The worker owns every write to the library: the remux, the rename, and deleting
the sidecars it embedded. `web` renders a list and a modal.

Jellyfin is a **directory of sidecars**, nothing more. It says which `.srt` files belong to which
item, with their language and forced flag. Its stream index and its `DeleteSubtitle` endpoint are
not used. A sidecar's identity is its base file name, which is stable, human-readable and not a
path (Article V).

**`api`** extends the existing Jellyfin client (`services/api/src/clients/media-server/jellyfin.ts`)
rather than adding a second HTTP client. It adds two reads (an item's external subtitles, and a
series' episodes with theirs) and a "modified" notification beside `createdMedia`, with the same
`MediaBrowser Token` header and read timeout. The `MediaServerClient` type in `types.ts` gains them
as **optional** members, the way `listLibrary` already is. Plex and the `none` client compile
unchanged, and "not supported" falls out of a missing method rather than a client-name check. The
item id comes from `findByTmdbId` (the `034` index). For an episode it comes from the series'
episode listing, matched by season and episode number exactly as `toPresentEpisodes` already does.

A new `subtitle-embed/` module holds the `SubtitleEmbed` model, the two admin mutations, the two
`@ResolveField`s on `Movie`/`Episode`, the three service-only worker reports and the
`subtitleEmbedDetails` query. It reuses:

- `AdminGuard` per method (the `ffprobe-logs.resolver.ts` split, never class-level, because the
  worker-facing operations in the same resolver carry `@AllowService()`);
- `MoviesService.findOneFromDb` / the episode ownership lookup for visibility;
- `pipeline-status/`'s `IN_FLIGHT_ENCODE_STATUSES`, `hasPossession` and the season-pack lift
  predicate for REQ-16, never a new definition of "in flight";
- `MediaRootsService` for both directions of path translation (a `hostToContainerPath` twin of
  `containerToHostPath` is added there, not inline);
- the BullMQ producer pattern of `queue/encode-queue.service.ts` for a third queue;
- `process-jobs/`'s `reconcileOrphanedEncodes`, called from `encodeWorkerStarted`, for NFR-3;
- `MediaServerService`'s settings→client construction, extracted so the new module does not copy it.

The reverse half of REQ-16 (an acquisition refused while an embed is queued or running) is one check
in `AttachSourceService.attach()`, which since `088` is the single attach body for films, episodes and
seasons. Two more go in the upload ticket mint and `startSeasonUpload`.

`api` mounts the destinations root **read-only** (`docker-compose.yaml`), and the plan keeps it that
way. `api` only `stat`s the `.mkv` and the sidecars. It never copies, stages or deletes anything,
and AC-14 asserts no removal in `services/api/src`.

**`worker`** opens a third BullMQ `Worker` on a new `subtitle-embed` queue (`concurrency: 1`). It is a
separate queue for the same reason `process` and `encode` are separate: a remux must not wait hours
behind an encode. The handler:

1. reads `subtitleEmbedDetails`;
2. removes any stale `<final>.part.mkv` unconditionally (the `054` posture);
3. reports `subtitleEmbedStarted`, and abandons silently on `false`;
4. checks writability and ownership;
5. reads each sidecar from the library and rewrites it into normalized UTF-8 in a private temp
   directory (`os.tmpdir()`), with the offset applied and negative cues dropped (a pure function);
6. runs `mkvmerge` through the existing `runFfmpegCapture(…, { binary: 'mkvmerge' })` seam, with the
   original first and the subtitles appended;
7. verifies the result with the existing `getMetadata` (ffprobe);
8. restores mode and owner, then makes one `rename`;
9. deletes each sidecar under REQ-12's guards;
10. removes the temp directory and reports the outcome through `deliverReport`.

**Why the offset is applied by rewriting the SRT rather than `mkvmerge --sync`.** The charset
conversion (REQ-8) already forces a rewrite of every subtitle file. Doing the shift in that same pure
function makes REQ-7's "drop cues before zero" deterministic and unit-testable without a binary.

**Why the worker deletes the sidecar instead of Jellyfin's `DeleteSubtitle`.** That endpoint takes
Jellyfin's stream index, which numbers external streams ahead of the file's own and can renumber
after any delete or rescan. A stale index deletes the wrong file with `204` and no error anywhere.
The file name is stable, the worker already holds write access to that folder, and a refresh
afterwards is all Jellyfin needs.

**`web`** adds an `EmbedSubtitlesButton` and modal under `components/media/`, beside
`RefreshTitleButton`. It is used once in `components/movies/Movie.tsx` and once per episode row in
`components/shows/SeasonAccordion.tsx`, fed by two new fields on the existing `getMovieById` and
show queries. There is no separate request.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 0 | `[orch]` | Article XII amendment through `/constitution` (NFR-1, both exceptions). Nothing may write or delete in the library under a rule that forbids it. |
| 1 | `api` | Owns the migration, the schema, the queue payload's source of truth and the Jellyfin client. The other two consume it. |
| 2a | `worker` | Consumes the queue payload, `subtitleEmbedDetails` and the three reports. |
| 2b | `web` | Consumes the two fields and the two mutations. |
| 3 | `[orch]` | `docs/spec/graphql-contract.md` section, root `CLAUDE.md` pipeline rows, `history.md` entry. |
| 4 | `[verify]` | Live pass on Green Book (see Verification). |

Steps 2a and 2b run **in parallel** once step 1's `schema.gql` diff matches the spec's delta.
`worker` can start its pure modules (the SRT rewrite, the verification comparator, the mkvmerge
argument builder, the deletion guard) in parallel with step 1, since none of them touches the wire.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` (v0.2.0) is frozen as of `status: Approved`. Things an
implementer will be tempted to change:

- **`externalSubtitles` is non-null and empty on every failure.** From inside `api` it looks like
  it should throw on an unreachable Jellyfin. It must not: the detail pages render it inline, and a
  throw would break the whole page (REQ-2, the `069` posture).
- **`fileName` is a base name, never a path.** `api` rebuilds the container path by joining it to
  the `.mkv`'s directory. It must reject a `fileName` containing a separator or `..`, and treat it
  like an unlisted name (`stale_listing`). The worker trusts only `sourcePath` from the details.
- **No Jellyfin stream index anywhere.** Not in the contract, not in the row, not in a log line
  `web` reads. Reintroducing it reintroduces the wrong-file-deleted risk.
- **`SubtitleEmbedTrack.trackTitle` is resolved by `api`.** The worker never looks up a language
  title itself.
- **`subtitleEmbedDetails` answers for any status, `FAILED` included.** The worker reads it before
  `subtitleEmbedStarted` to clean a stale scratch file after a crash.
- **`subtitleEmbedCompleted` carries only the sidecar warning.** `jellyfin_refresh_failed` is
  `api`'s to write, since `api` makes that call. The worker never sends it.
- **The queue payload is `{ subtitleEmbedId }`, nothing else.** Paths are resolved at read time
  (Article V).

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief `api`,
`worker` and `web`.

## Migrations

1. `add_subtitle_embed`: new enum `SubtitleEmbedStatus` and new table `subtitle_embeds` with:
   - `movieId`/`episodeId` nullable FKs with `onDelete: Cascade`;
   - `status` default `QUEUED`;
   - `filePath VarChar(500)`;
   - `tracks Json`;
   - `errorKey`/`warningKey` nullable `VarChar(100)`;
   - `createdAt`, and `finishedAt` nullable.

   Add an index on `(movieId, createdAt)` and one on `(episodeId, createdAt)` for "latest per
   target". The "exactly one of `movieId`/`episodeId`" rule is enforced in the service, the same way
   `MediaSource`'s target columns are.
2. Backfill: none (new table).

Reversibility: dropping the table and enum loses only embed history. No other model references it.
A title's deletion (`067`) cascades its embeds.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The worker deletes the wrong file | A file in the library vanishes with no error anywhere | The worker deletes only `sourcePath` values from the details, and only if each is inside the destinations root (`is-inside-root.ts`), in the **same directory** as `filePath`, ends in `.srt`, and is a regular file (`lstat`, not a symlink). `api` builds `sourcePath` from a separator-free `fileName`. One worker test per guard |
| Sidecars deleted before the rename, or on failure | The subtitle is lost and the `.mkv` lacks it | Deletion is the step after `rename` and is unreachable from every failure branch. Test that a verify rejection and an mkvmerge error leave the sidecars |
| Worker crashes mid-remux | `api` fails the embed (`interrupted`), but a multi-GB `.part.mkv` stays beside the library file | The handler reads `subtitleEmbedDetails` and removes the stale scratch **before** `subtitleEmbedStarted`. BullMQ's stall recovery redelivers the job after the restart, so that read happens. AC-7 checks it live |
| Worker crashes between the rename and the sidecar deletion | The `.mkv` already carries the tracks but the embed reads `interrupted` and the sidecars remain. A retry embeds them a second time (duplicate tracks) | The window is a few `unlink`s, milliseconds. Accepted and documented. The `interrupted` message tells the admin to check before retrying. Not worth a two-phase protocol for v1 |
| mkvmerge exit code 1 read as failure | Every embed of a subtitle with harmless warnings fails | Reuse `assemble-playlist.ts`'s `code === 0 \|\| code === 1` rule. Test with a fake exit 1 |
| Default flag left on an old track | Two default subtitle tracks, the player picks the wrong one; no error | The worker emits `--default-track-flag <tid>:0` for every pre-existing subtitle track. Test it |
| Verification compares only stream counts | A result with a dropped audio track plus an extra subtitle passes | Compare the ordered `(codec_type, codec_name, language)` tuples of the original against the result's prefix, then the new suffix. Test with a swapped track |
| cp1252 subtitle passed as UTF-8 | `Ã±` in every Spanish track, no error anywhere | The decoder order in `worker/plan.md`. Test with a real cp1252 fixture |
| Replace changes owner or mode | Jellyfin running as another user can no longer read the file | Pre-check, then `chmod`/`chown` before the rename. AC-13 |
| Embed and replacement encode race on the same file | One result silently lost | REQ-16 in both directions, one check in `AttachSourceService.attach()`. Tests in both directions |
| Jellyfin path ≠ Perceptor's host path | Translation fails for every sidecar | Sidecar paths are never translated from Jellyfin: `api` joins the base name to the `.mkv`'s container directory. Only a reconciled-only title's `.mkv` uses Jellyfin's path (REQ-13) |
| Page render waits on Jellyfin | Detail page slow when Jellyfin hangs | The existing `READ_TIMEOUT_MS` (5 s). On a series page one call per series (NFR-2) |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/comments
git diff services/api/src/schema.gql
```

The `schema.gql` diff must match the spec's delta exactly (Article VIII).

**Note:** the stack running on this host is the end-user install `ptor`, not this checkout (memory:
measuring-without-dev-stack). The unit commands may need the throwaway-container form until
`bin/dev` can run without colliding with `ptor`'s ports.

**Manual pass.** Green Book is in the live Jellyfin with `.eng.srt` and `.spa.srt` from the plugin.
It is not in the development Perceptor, so register it there first:

1. AC-1/AC-2: open Green Book as an administrator. Embed `spa` with offset `+1200`. Check `ffprobe`,
   the first cue time, that `.spa.srt` is gone and `.eng.srt` is still there, and Jellyfin's
   subtitle menu.
2. AC-3: embed `eng` with "default" checked and check the flags.
3. AC-4/AC-6: use a hand-made cp1252 `.srt` beside a test film, plus one with bytes 0x81/0x8D.
4. AC-5: a series episode with a plugin-downloaded subtitle. Count Jellyfin calls in `api`'s log.
5. AC-7: `docker compose kill worker` during an embed of a large file, then start it again.
6. AC-8: same page as a non-administrator.
7. AC-9: an embed while a torrent replaces the film, and the reverse.
8. AC-10: delete the `.srt` on disk with the modal open.
9. AC-11/AC-12: media server `none`; Jellyfin stopped right after the remux.
10. AC-13/AC-14/AC-15: `ls -l` before and after, the grep, and the titles' status.

`sha256sum` the library file before every failure case and compare after.

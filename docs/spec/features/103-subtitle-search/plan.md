---
title: Subtitle Search — Implementation Plan
spec_version: 0.5.0
last_updated: 2026-10-26
status: Approved
---

# PLAN: Subtitle Search (`plan.md`)

## Approach

The feature has three parts:

- **`api`** keeps a small state machine per search and drives it.
- **`worker`** measures timing, and nothing else.
- **`web`** adds two checkboxes and one status line.

The library write is `101`'s existing embed. This spec adds no second remux, rename or verification
anywhere.

**One driver, woken through BullMQ.** A new `subtitle-search` queue is both produced and
**consumed by `api`** (`concurrency: 1`). It is the first BullMQ consumer inside `api`, which until
now only produced jobs for the worker. It has to be `api`: the steps talk to Jellyfin, write to the
downloads root and read the database, and the worker does none of those.

Every job is the same thing, `advance { searchId }`: a **wake-up**, not a unit of work. The database
row stays the only state. The handler, `SubtitleSearchDriver.advance(searchId)`, re-reads the search
and its attempts and runs at most one step whose precondition holds, otherwise nothing:

1. WAITING: look up the Jellyfin item.
2. SEARCHING: remote search, then fetch one candidate and enqueue its validation.
3. VALIDATING: read the attempt the worker reported on, then try the next candidate or move on.
4. EMBEDDING: start the `101` embed, then finalize once that embed is terminal.

Because a wake-up only says "look again", an extra one is harmless and a lost one is recovered.
What wakes a search:

| Waker | Delay |
| :-- | :-- |
| `requestFor` on delivery | 5 min (REQ-6's first check) |
| A WAITING miss | the next step of 5, 10, 20, 40, 45 min |
| A step that changed the state | none: the next step runs at once |
| `subtitleSyncCompleted`/`subtitleSyncFailed` (the worker's report) | none |
| A `subtitle-sync` job enqueued | 6 h, the backstop for a lost worker job |
| EMBEDDING with the embed still running | 2 min, re-checking until the embed is terminal |
| `api` boot | none, one per non-terminal search (NFR-5) |

Jobs carry `removeOnComplete`/`removeOnFail` and `attempts: 1`. A handler failure is caught inside
`advance` and fails the search with the step's key; BullMQ retries are never relied on. Every
transition lives in one place, and the worker's report mutations only record the attempt and add a
wake-up. Waiting for the embed by re-checking avoids a `SubtitleEmbed → SubtitleSearch` call that
would put a cycle into the module graph.

This replaces an in-process interval (`@nestjs/schedule`, as `scheduler/` uses). With the interval,
every step would wait up to its period, and the 2-hour wait would need a `nextCheckAt` column and a
query on every tick. BullMQ's delayed jobs do both, and survive an `api` restart in Redis.

**Starting a search** is a leaf, not the driver. `ProcessJobsService.encodeCompleted` already calls
`mediaServer.notifyCreated` exactly once per real delivery. Right after it, the method calls
`SubtitleSearchRequestService.requestFor(target)`, which:

1. evaluates the effective flag (REQ-1/REQ-3);
2. supersedes an earlier non-terminal search of the same target (REQ-12);
3. inserts a `WAITING` row and adds its first wake-up (5 min);
4. swallows and logs any error, so a delivery never fails because of this (REQ-14).

It lives in its own leaf module, which `ProcessJobsModule` imports without a cycle. This follows the
precedent of `101`'s `ActiveEmbedGuardModule`.

**Jellyfin is reused, not re-wrapped.**

- `ItemSubtitles` (`101`) gains `presentLanguagesIso3`, computed from the same `MediaStreams` that
  `listItemSubtitles`/`listSeriesEpisodeSubtitles` already fetch: every subtitle stream, embedded or
  external, that is not forced. REQ-7 costs no extra call.
- The client gains two optional members, `searchRemoteSubtitles` and `fetchRemoteSubtitle`, beside
  `101`'s. Plex and `none` lack them, so "unsupported" falls out of a missing member, the same way
  `101` does it.
- `findByTmdbId` is index-backed for Jellyfin, so a freshly delivered film is not in the index yet.
  A WAITING check whose lookup misses calls `MediaServerIndexService.refreshAndWait` (the `069` path)
  once, then looks up again. There are at most five checks in the 2-hour window (5, 10, 20, 40 and
  45 minutes), so at most five library listings per search.

**Staging.** Candidates are written by `api`, which mounts the downloads root read-write (it already
deletes download residue there, `047`/`095`). They go to
`<downloads root>/.perceptor/subtitle-search/<searchId>/<attemptId>.srt`, resolved through
`MediaRootsService`. `api` deletes the whole `<searchId>` directory when the search is terminal. A
wake-up for a search that no longer exists deletes its directory, and `api`'s boot sweeps every
directory whose search is terminal or missing. Together these cover a title deleted mid-search
(`067` cascades the rows). The destinations root stays read-only in `api`.

**Embedding through `101`.** `SubtitleEmbedService` gains a public `embedStaged(ref, tracks)` method
that shares the tail of the private `embed()`:

- REQ-13's `.mkv` resolution;
- `assertUsableMkv`;
- `assertNotBusy`;
- `createGuarded`;
- the enqueue.

It skips what only makes sense for an administrator's request: the admin and visibility checks, and
the Jellyfin sidecar re-listing (REQ-15 of `101`). A stored track gains an optional `stagedPath`.
`details()` resolves `sourcePath` to `stagedPath` when set, and sets the new `isSidecar` from its
absence. The worker's existing `deleteSidecars` only receives the tracks with `isSidecar: true`. That
is the whole `101` delta.

**`ffsubsync` in the worker.** The new `subtitle-sync` queue (`concurrency: 1`) runs the job:

1. read `subtitleSyncDetails`;
2. report `subtitleSyncStarted`;
3. pick the reference from the library file's `ffprobe` (first text subtitle stream that is not
   forced, else the default audio stream, else the first audio stream);
4. run `ffsubsync <mkv> -i <candidate> -o <tmp>/out.srt --reference-stream <spec>
   --max-offset-seconds 600` through the existing capture seam (`runFfmpegCapture` with a new
   `binary: 'ffsubsync'`);
5. parse offset, framerate scale factor and score from its log;
6. report.

The output file is discarded: `101` applies the offset itself. `api` owns the acceptance rule and its
two provisional thresholds (REQ-10), so re-measuring them never needs a worker change.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 0 | `[orch]` | Done: Article XII amended, constitution v1.6.0 (NFR-1). |
| 1 | `api` | Owns the migration, the schema, the `subtitle-sync` payload, its own `subtitle-search` queue, the Jellyfin client and the `101` delta (`isSidecar`). Both consumers read it. |
| 2a | `worker` | Consumes `subtitle-sync`, `subtitleSyncDetails`, the three reports and `SubtitleEmbedTrack.isSidecar`. |
| 2b | `web` | Consumes `subtitleSearchAvailable`, the three flag mutations and `latestSubtitleSearch`. |
| 3 | `[verify]` | Threshold measurement (REQ-10), with the worker image built. It feeds `api`'s two constants. |
| 4 | `[orch]` | `docs/spec/graphql-contract.md` (new types, the `subtitle-sync` queue, `isSidecar`), root `CLAUDE.md` pipeline rows, the `history.md` entry with the threshold measurements. |
| 5 | `[verify]` | Live pass (see Verification). |

Steps 2a and 2b run **in parallel** once step 1's `schema.gql` diff matches the spec's delta. Some
worker work can start in parallel with step 1, since it does not touch the wire:

- the image change, measured on both architectures (NFR-3);
- the reference picker;
- the `ffsubsync` log parser.

Step 3 needs the worker image and can start as soon as it builds. `api` ships the constants as
placeholders that reject everything until step 3 lands, never as values that accept everything.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` (v0.5.0) is frozen as of `status: Approved`. Things an
implementer will be tempted to change:

- **The worker reports measurements, never a verdict.** `subtitleSyncCompleted` carries offset,
  ratio, reference and score. Adding an `accepted` flag would move the threshold into the worker and
  put it out of reach of a re-measurement in `api`.
- **`offsetMs` is the value `101` applies, with `101`'s sign convention**: positive delays.
  The worker establishes how `ffsubsync`'s reported offset maps to that convention from a fixture
  with a known shift: an `.srt` deliberately delayed by +2 s must report `offsetMs ≈ -2000`, the
  correction that undoes it. It converts with `Math.round`. A sign error produces doubled desync and
  no error anywhere, which is why the worker owes a test on it.
- **`framerateRatio` is reported even when it is 1.** `api` rejects anything outside 1 ± 0.001.
  The worker never decides that.
- **`SubtitleEmbedTrack.isSidecar` defaults to `true` on read.** A `101` row written before this spec
  has no `stagedPath`, so it must keep being deleted after the rename exactly as today.
- **The queue payload is `{ subtitleSyncId }`, nothing else.** Paths are resolved at read time
  (Article V).
- **`latestSubtitleSearch.languages` is derived, not stored.** Each language's outcome is computed
  from the search's attempts and its lookup. Do not add a column that can disagree with them.
- **The `subtitle-search` queue is `api`-internal.** It is not part of the worker's queue contract,
  and the worker never produces or consumes it. Do not copy it into `services/worker/src/queue/types.ts`.
- **`set*SubtitleSearch` refuses only on `subtitleSearchAvailable` being false.** It does not refuse
  when the caller's preference is off. The preference gates the effective flag (REQ-3), not the
  write, so a checked title stays checked across a preference toggle (AC-1b).

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief `api`,
`worker` and `web`.

## Migrations

`add_subtitle_search`, one migration:

1. `users.subtitleSearch`, `user_movies.subtitleSearch` and `user_shows.subtitleSearch`:
   `BOOLEAN NOT NULL DEFAULT false`. Existing rows read `false`, which is the spec's default, so no
   backfill is needed.
2. New enums `SubtitleSearchStatus` (`WAITING`, `SEARCHING`, `VALIDATING`, `EMBEDDING`, `COMPLETED`,
   `FAILED`), `SubtitleSearchAttemptStatus` (`QUEUED`, `RUNNING`, `ACCEPTED`, `REJECTED`, `FAILED`)
   and `SubtitleSyncReference` (`SUBTITLE`, `AUDIO`).
3. New table `subtitle_searches`:
   - `movieId`/`episodeId`: nullable foreign keys, `onDelete: Cascade`;
   - `status`;
   - `errorKey`: nullable;
   - `wantedLanguages`: JSON array of ISO 639-2 codes, snapshotted at request time, so a later
     preference edit does not rewrite history;
   - `presentLanguages`: JSON, nullable until the lookup;
   - `itemId`: nullable, Jellyfin's item id, cached after the lookup;
   - `subtitleEmbedId`: nullable foreign key, `onDelete: SetNull`;
   - `checkCount` (REQ-6's bounded wait; the wait itself is a delayed job, not a column);
   - `createdAt`, `finishedAt`.

   Indexes on `status` (boot re-wake and sweep), plus `(movieId, createdAt)` and
   `(episodeId, createdAt)` for "latest per target".
4. New table `subtitle_search_attempts`:
   - `searchId`: foreign key, `onDelete: Cascade`;
   - `languageIso3`, `providerSubtitleId`, `releaseName`, `rank`;
   - `stagedPath`, `status`, `offsetMs`, `framerateRatio`, `reference`, `score`, `reasonKey`;
   - `createdAt`, `finishedAt`.

   Index on `(searchId, languageIso3)`.

`101`'s `subtitle_embeds.tracks` JSON needs no migration. An absent `stagedPath` is the `101` case.

Reversibility: dropping the two tables, three enums and three columns loses only search history and
the opt-ins. No other model reads them.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Offset sign inverted between `ffsubsync` and `101` | Every embedded subtitle ends twice as far out of sync, and the search reads `EMBEDDED` | The contract fixes the convention. The worker test converts a captured `ffsubsync` log with a known positive shift and asserts the sign. AC-4 checks it live by watching the track |
| Threshold too permissive | A subtitle from another cut is accepted and embedded. Nothing errors: the library file now carries a wrong track | Thresholds measured on known-bad pairs (step 3). Until measured, the placeholders reject everything. Embedding never sets the default flag, so a bad track is never the one that plays automatically |
| Jellyfin item still describes the old file after a replacement | REQ-7 reads the replaced file's streams and marks languages present (or missing) wrongly | REQ-6's path match: the item counts only when its `Path` equals the delivered file's host path (`MediaRootsService.containerToHostPath`). Test with a stale path |
| A future change widens `101`'s busy guard to a whole season | Every episode of a pack except the last ends `FAILED`/`busy`, which reads like a normal outcome | Today the guard ignores a pack once it is `SCANNED` (`isLiftedBySeasonPack`), and an episode is only delivered after that. A driver test delivers E01 of a scanned pack while E02 encodes and asserts the embed is queued, so a widening breaks a test instead of silently failing searches |
| Staged files leak in the downloads root | Hidden `.srt` files pile up with no error | Deletion at every terminal transition, on a wake-up for a missing search, and in the boot sweep. Test all three |
| The worker deletes a staged track as a sidecar | `deleteSidecars` refuses it (another directory) and the embed completes with a spurious `sidecar_delete_failed` warning | `isSidecar` filters before `deleteSidecars`. Worker test: a staged track is never passed to the guard |
| Quota burned by repeated fetches | The OpenSubtitles daily quota runs out silently and later searches all read `NOT_FOUND` or `FAILED` | Attempt rows are the record: a fetch happens only when inserting an attempt row, at most 3 per language, and a wake-up re-running after a crash finds the row and does not fetch again. Test the cap |
| Two wake-ups of one search run at once | The same candidate is fetched twice | The `subtitle-search` consumer has `concurrency: 1`, and a single `api` instance is a standing assumption (`054`). Each step is also guarded by a conditional `updateMany` on the state it leaves |
| A wake-up is lost (Redis flushed, job dropped) | The search sits non-terminal forever, readable as "searching" in the panel | The boot re-wakes every non-terminal search (NFR-5), and the 6-hour backstop covers a lost `subtitle-sync` job. Test the boot re-wake |
| `ffsubsync` hangs on a pathological file | The `subtitle-sync` queue stalls behind it, and every later search waits | A wall-clock kill (20 min) in the job, reported as `sync_failed` |
| Alpine image cannot build `ffsubsync`'s native dependencies on arm64 | The arm64 image fails to build, and the release fails | NFR-3: the worker proves both architectures before the contract work merges. Build dependencies go in a virtual `apk` package removed in the same layer |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/npm api run lint
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/comments
bin/build prod worker
bin/cli worker ffsubsync --version
bin/cli api npx prisma migrate status
git diff services/api/src/schema.gql
```

The `schema.gql` diff must match the spec's delta exactly (Article VIII). The arm64 build is proven by
`.github/workflows/release.yml` on a release-candidate tag (Article I: no hand-run `docker buildx`).

**Note:** the stack running on this host is the end-user install, not this checkout (memory:
measuring-without-dev-stack). The unit commands may need the throwaway-container form.

**Threshold measurement (step 3).** Run the built worker image's `ffsubsync` by hand on four pairs and
record the scores:

- a film carrying an English text track, with a matching and a mismatched (other cut) `.srt`;
- the same film with `--reference-stream a:0`, against the same two `.srt` files.

Set each threshold between that reference's good and bad scores, and record all four numbers in
`history.md`.

**Manual pass.**

1. AC-1/AC-1b/AC-2: toggle the media server and the preference, and check both forms.
2. AC-3/AC-4: a film with an English-only release, opted in for `eng` + `spa`. Wait for the search,
   then `mkvmerge -J` the library file, play it in Jellyfin, and read the attempt row.
3. AC-5: a film whose release has no text subtitles.
4. AC-6: replace a staged candidate on disk with an `.srt` from another cut, between fetch and
   validation (or use a film known to have only bad candidates). List the library folder before and
   after.
5. AC-7: stop Jellyfin before delivery. Shorten the wake-up schedule in a dev build only, and
   restore it.
6. AC-8: deliver a title nobody opted into, then check `bin/mysql` and Jellyfin's log.
7. AC-9/AC-9b: a two-episode season pack, then a replacement during `WAITING`.
8. AC-10: a language with no candidates, then one with only rejects.
9. AC-11: `docker compose kill worker` during a validation, then start it again.

## Amendment 0.4.0 (2026-10-25)

`../spec.md` § Amendments 0.4.0 adds REQ-10's coverage check and tightens the framerate tolerance.
Tasks: `tasks.md` Group 5.

- **Order of work**: `api` first (T030: the two new `subtitleSyncCompleted` arguments and the rule),
  then `worker` (T029) and `web` (T031) in parallel, then T024 (thresholds). A worker that sends
  the new arguments before `api` accepts them fails every report, and `deliverReport` retries it
  forever.
- **Contract freeze**: `mediaDurationMs: Int!` and `lastChapterStartMs: Int` are the only contract
  change. The worker reports the raw last chapter start; whether it qualifies (2+ chapters, after
  80 % of the duration) is `api`'s decision, like every other part of the verdict.
- **Risk (silent)**: with the score thresholds still `+Infinity`, the new checks change nothing
  observable. Their tests are the only evidence until T024 lands.
- **Risk (silent)**: a staged file `api` cannot parse must be rejected as `incomplete`. Treating
  "no last cue found" as coverage 100 % would accept a broken file.
- **No migration**: coverage is computed at report time and not stored; the rejection key is the
  record.

## Amendment 0.5.0 (2026-10-26)

`../spec.md` § Amendments 0.5.0 removes the per-title flag. Everything above that mentions the
per-title flag, the three flag mutations or the "effective flag" (the Approach's `requestFor` step, the
2b row, the `set*SubtitleSearch` contract note, the migration list and AC-1b/AC-8 in Verification) is
superseded by this section.

- **Approach**: `requestFor` opts an owner in when REQ-1 holds and `User.subtitleSearch` is on. The
  owners are read when the encode ends, so a preference changed before then is honoured.
- **Order of Work**: `api` first (migration, contract, request service), then `web`; both ship under
  one `PERCEPTOR_TAG`, since a stale `web` would still query the removed fields.
- **Contract Freeze**: the four removed members are in `../spec.md` § GraphQL Contract Delta (v0.5.0).
  `setSubtitleSearch` stays and refuses only on the capability.
- **Migration**: drop `user_movies.subtitleSearch` and `user_shows.subtitleSearch`. No backfill; the
  stored values are discarded. `users.subtitleSearch` and every `SubtitleSearch` row stay.
- **Risk (silent)**: behaviour widens on upgrade. A user with the preference on and no title ticked
  starts getting searches, and each one spends provider quota (NFR-2). Intended; stated in the
  `/preferences` help text and the `history.md` entry.
- **Risk (silent)**: a leftover per-title query in `web` fails the whole detail page with a GraphQL
  validation error, no compile error anywhere. The `grep` in T033's *Done when* is the guard.
- **Verification**: AC-1b is now "preference on, no per-title action, delivery creates a search"
  (the *Stand by Me* case); AC-8 is "preference off, no row". Run both against a real delivery.

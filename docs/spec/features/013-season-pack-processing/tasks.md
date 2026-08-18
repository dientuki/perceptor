---
title: Season Pack Post-Download Processing — Tasks
last_updated: 2026-08-17
status: Draft
---

# TASKS: Season Pack Post-Download Processing (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[web]` and no `[infra]` tasks. No screen touches any of this — `addMagnetToSeason` has no UI by
design (`spec.md` § Out of Scope) — and no `bin/` script, `docker-compose.yaml`, Dockerfile or
`.env.example` key moves: the queues, the two media roots and `SERVICE_TOKEN` all keep their current
meaning.

**A note on "parallel" across services.** The contract is frozen (`spec.md` is `Approved`), so Group
2 does not have to wait for Group 1 to compile — there is no codegen between `api` and `worker`, and
each side retypes the delta from `spec.md`. What Group 2 cannot do is *run*: until T004 and T006
land, a worker sending `matches` gets a GraphQL validation error and every job fails. Every
cross-service dependency below is therefore a **runtime** dependency, marked as such.

## Tasks

### Group 1 — `api`: schema, the fan-out, and the cleanup verdict

T001 is the only task everything else in this group waits on. T007 and T009 depend on nothing and
may start immediately.

- [ ] **T001** `[api]` Add `hasUnmatchedFiles Boolean @default(false)` to `MediaSource` in
      `prisma/schema.prisma` and generate the migration with `bin/npm api run prisma:migrate`, named
      `add_has_unmatched_files_to_media_sources`. Add a comment recording what it means: at least one
      **video** file of this source resolved to no episode, which suppresses the deletion of the
      download path but not the per-episode input deletions (REQ-11).
      *Done when:* `git status services/api/prisma/` shows both a modified `schema.prisma` and a new
      migration directory, and `bin/cli api npx prisma migrate status` reports it applied with no
      drift.
- [ ] **T002** `[api] [P]` Add `isVideo: Boolean!` to `SourceFileInput`
      (`src/media-sources/dto/source-file.input.ts`, `@Field()` + `@IsBoolean()`), and create
      `src/media-sources/dto/scanned-match.input.ts` — `filePath: String!` (`@IsNotEmpty()`),
      `seasonNumber: Int` and `episodeNumber: Int`, both nullable, `@IsOptional() @IsInt()`. Comment
      on `isVideo` why `api` does not test extensions itself (the list lives in the worker; a second
      copy drifts silently and suppresses cleanup forever — `plan.md` § Contract Freeze).
      *Done when:* after a boot, `bin/cli api cat src/schema.gql` shows `isVideo: Boolean!` inside
      `input SourceFileInput` and the whole `input ScannedMatchInput` block, both byte-matching
      `spec.md` § GraphQL Contract Delta.
- [ ] **T003** `[api]` Expose `seasonId: Int` and `hasUnmatchedFiles: Boolean!` on
      `src/media-sources/entities/media-source.entity.ts`, and select `seasonId` in
      `MediaSourcesService.findOneFlat` (it is a real column — unlike `movieId`, nothing needs
      flattening). → T001
      *Done when:* `bin/cli api cat src/schema.gql | grep -A 10 "type MediaSource"` shows both
      fields; `bin/cli api npx --no tsc --noEmit` reports 0 errors.
- [ ] **T004** `[api]` Rework `sourceScanned` end to end: the resolver argument becomes
      `matches: [ScannedMatchInput!]!`, and `MediaSourcesService.sourceScanned` fans out per
      `api/plan.md` § Steps 5 — load the source with its season's episodes, refuse a source that
      targets nothing with `El mediaSource <id> no apunta a ninguna película, episodio ni temporada`,
      resolve each match (episode/film sources ignore the parsed numbers; a season source maps by
      `episodeNumber` and skips a mismatched `seasonNumber`), write `hasUnmatchedFiles` from the
      `isVideo` entries only, loop the existing upsert + find-or-create, set each matched
      `Episode.status = 'ENCODING'`, and keep the existing empty-scan `ERROR` branch — now reached by
      `matches: []` **or** by every match being skipped. The transaction, the
      never-reset-a-job-past-`WAITING` rule and the enqueue-after-commit block stay as they are.
      → T001, T002, T003
      *Done when:* `bin/cli api cat src/schema.gql | grep sourceScanned` prints the new signature with
      no `matchedFilePath`; `bin/cli api npx --no tsc --noEmit` reports 0 errors.
- [ ] **T005** `[api]` Write `src/media-sources/media-sources.service.spec.ts`, opening with the
      paragraph naming the silent failures it defends against (a file filed under the wrong episode
      number; `hasUnmatchedFiles` computed over sidecars so cleanup never runs; two files racing one
      episode). Cases per `api/plan.md` § Tests. → T004
      *Done when:* `bin/npm api test` is green with the new suite, and the wrong-episode case is
      verified to **fail** when the `episodeNumber` lookup is switched to array position (report the
      failing output, then restore).
- [ ] **T006** `[api]` Create `src/process-jobs/entities/encode-completed-result.entity.ts`
      (`message`, `removeTorrent`, `deleteInputFile`, `deleteDownloadPath`, all non-null), change the
      resolver to `@Mutation(() => EncodeCompletedResult)`, and compute the three verdicts in
      `ProcessJobsService.encodeCompleted` from the sibling `ProcessJob` rows and the source's
      `hasUnmatchedFiles`, per the table in `spec.md`. `notifyCreated`, the `movieId`/`episodeId`
      propagation and today's return string (now `message`) all stay exactly where they are. → T001
      *Done when:* `bin/cli api cat src/schema.gql | grep -A 6 "type EncodeCompletedResult"` matches
      the delta; a film's single job resolves to `(removeTorrent: true, deleteInputFile: false,
      deleteDownloadPath: true)`, i.e. today's behaviour.
- [ ] **T007** `[api] [P]` Add `deleteFiles: Boolean = true` to `downloadRemove` (resolver argument
      and service parameter) and forward it to the existing
      `torrentClient.remove(infoHash, deleteFiles)`. Do not change the default, and leave the
      `omitido: mediaSource <id> no es un torrent` answer untouched. Comment that this pipeline always
      passes `false` because the worker owns every deletion, behind `isInsideRoot`.
      *Done when:* `bin/cli api cat src/schema.gql | grep downloadRemove` prints
      `downloadRemove(mediaSourceId: Int!, deleteFiles: Boolean = true): String!`.
- [ ] **T008** `[api]` Extend `src/process-jobs/process-jobs.service.spec.ts` with the verdict table:
      single-job source → `(true, false, true)`; a middle job of three → `(false, true, false)`; last
      with all `COMPLETED` → `(true, true, true)`; last with a sibling in `ERROR` →
      `(true, true, false)`; last with `hasUnmatchedFiles: true` → `(true, true, false)`. Plus one
      case asserting `deleteFiles` reaches `torrentClient.remove` unchanged. → T006, T007
      *Done when:* `bin/npm api test` is green, and the `deleteDownloadPath` case is verified to
      **fail** when the sibling check is dropped (report the failing output, then restore).
- [ ] **T009** `[api] [P]` Build `src/seasons/` — module, resolver and service — from `src/episodes/`,
      exposing `addMagnetToSeason(seasonId: Int!, magnet: String!, force: Boolean = false): Season!`
      with ownership through `UserShow`, the season-scoped active-source conflict, and the demote-on-
      `force` ordering (qBittorrent accepts first, then demote, then create). Register `SeasonsModule`
      in `app.module.ts`. The final read **must** `include` the season's episodes — `Season.episodes`
      is non-null and a bare row fails the mutation after the torrent was already accepted.
      *Done when:* `bin/cli api cat src/schema.gql | grep addMagnetToSeason` matches the delta;
      calling it against a season the caller does not own answers `La temporada <id> no existe`.
- [ ] **T010** `[api]` Write `src/seasons/seasons.service.spec.ts` mirroring the `010` cases that
      matter: an unowned season is indistinguishable from a missing one, and `force` demotes the
      previous source to `ERROR` **after** qBittorrent accepted and **before** the replacement is
      created. → T009
      *Done when:* `bin/npm api test` is green, and the demotion-ordering case is verified to **fail**
      when the `updateMany` is moved after the create (report the failing output, then restore).

### Group 2 — `worker`: parsing, fan-out reporting, gated cleanup

T011 and T012 depend on nothing at all and may start alongside Group 1. T014 and T016 compile
without Group 1 but cannot **run** until T004 and T006 respectively are deployed — the seam has no
compiler across it.

- [ ] **T011** `[worker] [P]` Create `src/scan/parse-episode.ts` exporting
      `parseEpisode(fileName)`: case-insensitive `SxxEyy` over the **base name only**, returning
      `null` unless exactly one distinct `(season, episode)` pair is present. Comment that the caller
      passes a file name, never a path, and why (a folder named `Show S02 COMPLETE` would otherwise
      capture every file in it). Add `src/scan/parse-episode.spec.ts` opening with the silent failure
      it prevents.
      *Done when:* `bin/npm worker test` is green with cases `S01E02`, `s1e2`,
      `Show.S01E02.1080p.x265-GRP.mkv` → `(1, 2)` and `S01E01E02`, `Show.1x02.mkv`, `episode 3.mkv`,
      `Show S02 COMPLETE/ep3.mkv` → `null`.
- [ ] **T012** `[worker] [P]` Reduce `src/scan/scan-folder.ts` to enumeration: `ScannedFile` gains
      `isVideo: boolean` (from the existing `VIDEO_EXTENSIONS`), `ScanResult` becomes
      `{ files }`, and the largest-video selection and its sort are removed — they move to T013. Keep
      the `stat().isFile()` `LOCAL_FILE` branch and its comment untouched. Update
      `src/scan/scan-folder.spec.ts`: drop the `matchedFilePath` assertions, keep the enumeration and
      `LOCAL_FILE` ones, add that `isVideo` is `true` for `.mkv` and `false` for `.nfo`.
      *Done when:* `bin/npm worker test` is green and `grep -rn matchedFilePath services/worker/src`
      returns nothing.
- [ ] **T013** `[worker]` Create `src/scan/select-matches.ts` exporting `selectMatches(files, mode)`
      with `mode` of `{ kind: 'single' }` (the largest video, one entry, both numbers `null` — today's
      rule moved verbatim) or `{ kind: 'season' }` (every video parsed, unparseable dropped, grouped
      by episode with the largest of each group winning). Add `src/scan/select-matches.spec.ts`.
      → T011, T012
      *Done when:* `bin/npm worker test` is green with cases: `single` ignores `.nfo`/`.srt` and any
      `SxxEyy` in the names; `season` returns one entry per episode; two files for one episode yield
      the larger only; a pack with no parseable name yields `[]`.
- [ ] **T014** `[worker]` Rework `src/jobs/source-ready.job.ts`: add `seasonId` to the
      `mediaSource(id)` query **and** to `MediaSourceQueryResult` in the same edit; pick the mode
      (`movieId`/`episodeId` → `single`, else `seasonId` → `season`, else throw); send
      `sourceScanned(mediaSourceId, files, matches)` with `isVideo` on every file entry; log the match
      count and, by name, every video file not in the matches. → T013, runtime → T004
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports 0 errors, and a real season download
      logs one line per skipped file and N matches.
- [ ] **T015** `[worker]` Put each of `cleanup-source.ts`'s three existing actions behind its own
      flag: `CleanupInput` gains `inputFilePath` and the three booleans; the body runs
      `downloadRemove(mediaSourceId, deleteFiles: false)` when `removeTorrent`, then the input file
      when `deleteInputFile` — behind its **own** `isInsideRoot(downloadsRoot, inputFilePath)`, which
      the `downloadPath` guard does not cover — then today's `LOCAL_FILE`/recursive branch when
      `deleteDownloadPath`. The swallow-everything contract and its header comment stay. Extend
      `src/jobs/cleanup-source.spec.ts` with one case per flag, including an `inputFilePath` outside
      the root being refused without suppressing the other two actions. → runtime T006, T007
      *Done when:* `bin/npm worker test` is green with the new cases, and the refusal case is verified
      to **fail** when the second `isInsideRoot` call is removed (report the failing output, then
      restore).
- [ ] **T016** `[worker]` In `src/jobs/encode.job.ts`, select all four fields of
      `encodeCompleted`'s result and retype it locally in the same edit; pass the three instructions
      plus `details.inputFilePath` into `cleanupSource(...)`, keeping the call after the encode's
      `try/catch` and inside its own logging-only `try`. If any of the three arrives `undefined`, skip
      cleanup entirely and `console.error` the missing field name — never read a missing instruction
      as `false`, and never as `true`. → T015, runtime → T006
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports 0 errors; deleting one field from
      the mutation selection makes the job log the named `console.error` and delete nothing.

### Group 3 — verification and docs

- [ ] **T017** `[docs]` Add a section to `docs/spec/graphql-contract.md` for `013`: the
      `matchedFilePath` → `matches` replacement and why it was safe (one consumer, same commit),
      `SourceFileInput.isVideo` and where the extension list lives, the `EncodeCompletedResult`
      verdict table, `downloadRemove`'s new argument with the note that this pipeline always passes
      `false`, and `addMagnetToSeason`. Record the consumer obligations for `worker` and the explicit
      "none" for `web`.
- [ ] **T018** `[docs]` Update the `CLAUDE.md` files: the root pipeline table (the scan row now
      resolves every video to its episode; the transcode row covers a whole season; note that season
      acquisition is api-only with no UI), `services/api/CLAUDE.md` (the new `seasons/` module, the
      third `attachTorrentSource` twin and why it is not extracted, the fan-out in `sourceScanned`,
      the cleanup verdict), and `services/worker/CLAUDE.md` (the scan split into
      enumerate/parse/select, the gated `cleanup-source.ts`, the new suite counts).
      → T001–T016
- [ ] **T019** `[docs]` Walk every acceptance criterion in `spec.md` against the running stack —
      including the manual pass in `plan.md` § Verification (a real season pack, the per-episode
      deletions between encodes, the unmatched-file variant, and one ordinary film to prove AC-6b).
      Tick each box, then set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and
      `worker/plan.md`, and `status: Done` here. → T018

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

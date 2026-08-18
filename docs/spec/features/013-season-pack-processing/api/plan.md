---
title: Season Pack Post-Download Processing — api slice
service: api
last_updated: 2026-08-17
status: Implemented
---

# PLAN: Season Pack Post-Download Processing — `api` (`api/plan.md`)

## Scope

This slice owns everything that touches the database and both ends of the contract the worker reads:
the `hasUnmatchedFiles` column and its migration, the fan-out inside `sourceScanned` (N matches → N
`SourceFile`/`ProcessJob` rows, episode resolution by number within the source's season), the
cleanup verdict returned by `encodeCompleted`, and a new `seasons/` module exposing
`addMagnetToSeason` so the pipeline is reachable at all.

It does **not** parse file names. The `SxxEyy` regex lives in the worker and its output arrives as
two integers; `api` never re-derives season/episode from a path, and never decides what counts as a
video file — that is what `SourceFileInput.isVideo` is for. It also does not touch the encode
pipeline, the output path, or anything under `services/worker/`.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` | Modified | `MediaSource.hasUnmatchedFiles Boolean @default(false)` |
| `prisma/migrations/<ts>_add_has_unmatched_files_to_media_sources/` | New | the generated migration |
| `src/media-sources/dto/source-file.input.ts` | Modified | adds `isVideo: Boolean!` |
| `src/media-sources/dto/scanned-match.input.ts` | New | `filePath`, nullable `seasonNumber`/`episodeNumber` |
| `src/media-sources/entities/media-source.entity.ts` | Modified | adds `seasonId: Int`, `hasUnmatchedFiles: Boolean!` |
| `src/media-sources/media-sources.resolver.ts` | Modified | `matchedFilePath` arg → `matches: [ScannedMatchInput!]!` |
| `src/media-sources/media-sources.service.ts` | Modified | the fan-out; `findOneFlat` also exposes `seasonId` |
| `src/media-sources/media-sources.service.spec.ts` | New | see Tests |
| `src/process-jobs/entities/encode-completed-result.entity.ts` | New | `message`, `removeTorrent`, `deleteInputFile`, `deleteDownloadPath` |
| `src/process-jobs/process-jobs.resolver.ts` | Modified | `encodeCompleted` returns the new type; `downloadRemove` gains `deleteFiles` |
| `src/process-jobs/process-jobs.service.ts` | Modified | the three cleanup verdicts in `encodeCompleted`; `downloadRemove` forwards `deleteFiles` |
| `src/process-jobs/process-jobs.service.spec.ts` | Modified | adds the gate cases |
| `src/seasons/seasons.module.ts` | New | registered in `app.module.ts` |
| `src/seasons/seasons.resolver.ts` | New | `addMagnetToSeason` |
| `src/seasons/seasons.service.ts` | New | `findOneFromDb` + `attachTorrentSource`, season-scoped |
| `src/seasons/seasons.service.spec.ts` | New | see Tests |
| `src/app.module.ts` | Modified | imports `SeasonsModule` |
| `src/schema.gql` | Regenerated | never edited by hand (Constitution, Article IV) |

## Existing code to reuse

- `src/episodes/episodes.service.ts` — the template for the whole `seasons/` module.
  `findOneFromDb` becomes `season.findFirst({ where: { id, show: { users: { some: { userId } } } } })`
  (one relation shallower than the episode version, which goes through `season.show`).
  `attachTorrentSource` is copied with three changes: the conflict query is
  `mediaSource.findFirst({ where: { seasonId, status: { not: 'ERROR' } } })`, the demotion on `force`
  is `updateMany({ where: { seasonId, status: { not: 'ERROR' } } })`, and the created/updated
  `MediaSource` carries `seasonId` instead of `episodeId`. **Do not extract a shared helper** — this
  is the third deliberate twin, see `../plan.md` § Approach.
- `src/episodes/episodes.module.ts` — the module shape to copy verbatim (it imports `SettingsModule`
  because the torrent client needs it).
- `src/shows/entities/season.entity.ts` — the return type. It declares `episodes: [Episode!]!`
  non-null, so the mutation's final read **must** be
  `season.findUniqueOrThrow({ where: { id }, include: { episodes: { orderBy: { episodeNumber: 'asc' } } } })`.
  Returning a bare season row fails the mutation after the torrent was already accepted.
- `src/clients/torrent/magnet.ts`'s `parseMagnet` and `src/clients/torrent/client.ts`'s `add()` —
  same call order as `addMagnetToEpisode`: parse first, `add()` before any write, demote only after
  qBittorrent accepted.
- `src/process-jobs/process-jobs.service.ts`'s `downloadRemove` and
  `src/clients/torrent/client.ts`'s `remove(hashes, deleteFiles = true)` — the flag already exists on
  the client; only the mutation needs to stop hardcoding it.
- `src/media-sources/media-sources.service.ts` — its own existing transaction, `sourceFile.upsert` on
  the `mediaSourceId_filePath` unique, the find-or-create that never resets a job past `WAITING`, and
  the enqueue-after-commit block with `processJobIdsToQueue`. All of it stays; only the arity changes.
- `src/process-jobs/process-jobs.service.ts`'s `encodeCompleted` — keep its existing body (status,
  progress, `outputFilePath`, `ffmpegCommand`, the `movieId`/`episodeId` propagation, the
  `mediaServer.notifyCreated` call) and its exact return string, which becomes `message`.

## Steps

1. Add `hasUnmatchedFiles` to `MediaSource` in `schema.prisma` and run
   `bin/npm api run prisma:migrate` with the name `add_has_unmatched_files_to_media_sources`.
   Verify both a modified `schema.prisma` and a new migration directory appear in `git status`.
2. Add `isVideo: Boolean!` to `SourceFileInput` (`@Field()`, `@IsBoolean()`), and create
   `ScannedMatchInput` beside it: `filePath: String!` (`@IsNotEmpty()`), `seasonNumber: Int` and
   `episodeNumber: Int`, both nullable and `@IsOptional() @IsInt()`.
3. Expose `seasonId` and `hasUnmatchedFiles` on the `MediaSource` entity, and add `seasonId` to what
   `findOneFlat` returns (it is a real column, unlike `movieId` — no flattening needed, just select it).
4. Change the resolver signature of `sourceScanned` to take `matches: [ScannedMatchInput!]!`.
5. Rework `MediaSourcesService.sourceScanned`:
   - load the `MediaSource` with `{ movie: { select: { id: true } }, season: { include: { episodes:
     { select: { id: true, episodeNumber: true } } } } }`;
   - throw `BadRequestException('El mediaSource <id> no apunta a ninguna película, episodio ni temporada')`
     when all three targets are null;
   - validate every `match.filePath` against `files` with the existing message, per entry;
   - resolve the target episode per match: `mediaSource.episodeId` when the source targets an episode,
     `mediaSource.movie.id` when it targets a film (numbers ignored in both cases), and for a season
     source a lookup in a `Map<episodeNumber, id>` built from the include — **skipping** any match
     whose `seasonNumber` is not the season's own `seasonNumber`, or whose `episodeNumber` is absent
     from the map. Every skip is a `console.log` naming the file;
   - `hasUnmatchedFiles` = `files.filter(f => f.isVideo).some(f => !resolvedPaths.has(f.filePath))`,
     written on the same `mediaSource.update` that sets `SCANNED`, and written as `false` when nothing
     was skipped;
   - keep the existing empty branch, now triggered by `matches.length === 0` **or** by every match
     being skipped: `ERROR` + the existing message, and the existing movie/episode demotion;
   - loop the upsert + find-or-create over the resolved matches, pushing into `processJobIdsToQueue`;
   - set `Episode.status = 'ENCODING'` for each episode a job was created or re-queued for — for an
     episode source this repeats what `DownloadsService` already did and is harmless; for a season
     source it is the only place it happens.
6. Create `EncodeCompletedResult` (`message: String!`, `removeTorrent: Boolean!`,
   `deleteInputFile: Boolean!`, `deleteDownloadPath: Boolean!`) and change the resolver's
   `@Mutation(() => EncodeCompletedResult)`.
7. In `ProcessJobsService.encodeCompleted`, after the existing update (add
   `include: { sourceFile: { select: { mediaSourceId: true } } }` to it), read the siblings with
   `processJob.findMany({ where: { sourceFile: { mediaSourceId } }, select: { id: true, status: true } })`
   and the source's `hasUnmatchedFiles`, then compute the verdict table from `../spec.md`:
   - `removeTorrent` — no sibling is left in `WAITING`/`QUEUED`/`ENCODING`. It is the **last to
     finish**, not the last to succeed: a pack whose fifth episode failed still drops the torrent
     when the tenth finishes;
   - `deleteInputFile` — `siblings.length > 1`;
   - `deleteDownloadPath` — every sibling is `COMPLETED` **and** `hasUnmatchedFiles` is `false`.
   Keep `notifyCreated` and the `movieId`/`episodeId` propagation exactly where they are, and keep
   the return string as `message`.
7b. Add `deleteFiles: Boolean = true` to `downloadRemove` (resolver arg and service parameter) and
   forward it to the existing `torrentClient.remove(infoHash, deleteFiles)` — which already takes the
   flag, defaulting to `true`. Do not change the default: it keeps every existing caller identical.
   The `omitido: mediaSource <id> no es un torrent` answer for a source with no infohash is unchanged.
8. Build `src/seasons/` from `src/episodes/` per § Existing code to reuse, and register
   `SeasonsModule` in `app.module.ts`.
9. Boot once (`bin/dev`) so `schema.gql` regenerates, and confirm the regenerated SDL matches
   `../spec.md` § GraphQL Contract Delta exactly (Constitution, Article VIII's check).

## Contract obligations

`api` is the producer of the whole delta in `../spec.md`. Two obligations are easy to miss:

- `sourceScanned` must keep returning `MediaSource!` and must keep answering
  `El mediaSource <id> no existe` / the existing `matchedFilePath <path> no está en la lista de files
  reportada` strings — the worker does not parse them, but they are the only diagnostic a human gets.
- `encodeCompleted`'s `message` must be byte-identical to today's return string
  (`completado: processJob <id>`), because the worker logs it and `012`'s manual verification reads
  that line.

The delta is read-only. If it is wrong, stop and report.

## Tests

- `src/media-sources/media-sources.service.spec.ts` (new) — this is the file the feature most needs.
  It defends against three failures that produce no error anywhere: a file resolved to the **wrong**
  episode (right show, right season, wrong number → the library gets S02E05's video under S02E04's
  name, and both jobs report success); `hasUnmatchedFiles` computed over all files instead of video
  files (cleanup suppressed forever, disk fills, every job green); and a season source where two
  files hit the same episode (two jobs, one output path). Cases: one match on an episode source; N
  matches on a season source; a match whose `seasonNumber` differs from the season's; a match whose
  `episodeNumber` is not in the season; a `.nfo` in `files` with `isVideo: false` not tripping the
  flag; a skipped video tripping it; `matches: []` taking the existing `ERROR` branch. Mock
  `PrismaService` and `EncodeQueueService` the way `process-jobs.service.spec.ts` already does.
- `src/process-jobs/process-jobs.service.spec.ts` (extended) — the three verdicts, per AC-9. A wrong
  boolean here either deletes nine pending inputs with every job reporting `COMPLETED`, or never
  deletes anything and fills the disk; neither logs a thing. Cases: single-job source →
  `(removeTorrent: true, deleteInputFile: false, deleteDownloadPath: true)`; a middle job of three →
  `(false, true, false)`; last with all `COMPLETED` → `(true, true, true)`; last with a sibling in
  `ERROR` → `(true, true, false)`; last with `hasUnmatchedFiles: true` → `(true, true, false)`. Plus one on
  `downloadRemove` asserting `deleteFiles` reaches `torrentClient.remove` unchanged.
- `src/seasons/seasons.service.spec.ts` (new) — mirrors the `010` cases in
  `episodes.service.spec.ts` that matter: an unowned season is indistinguishable from a missing one,
  and `force` demotes the previous source to `ERROR` **before** creating the replacement and **after**
  qBittorrent accepted. A missed demotion means a late `torrentCompleted` for the superseded infoHash
  moves a season that was already replaced — no error, wrong files.
- Not owed: the entity and DTO classes (declarations only), `app.module.ts` wiring, and the resolver
  methods, which are one-line delegations to the tested services.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
```

Typecheck reports 0 errors, the suite is green with the three new/extended specs, and
`migrate status` reports the new migration applied with no drift.

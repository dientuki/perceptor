---
title: Season Pack Post-Download Processing
spec_version: 0.2.0
author: Juan Farias
created_at: 2026-08-17
last_updated: 2026-08-17
status: Approved
services: [api, worker]
---

# SPEC: Season Pack Post-Download Processing (`spec.md`)

## Context & Goal

`010-episode-acquisition` wired the three per-episode buttons on `/shows/<id>` to real acquisition
flows and deliberately left the worker out, saying so in its own Context: "recognising which file
inside a release belongs to which episode, and building a series output path, is its work, not this
one's. Until that spec lands, an episode download reaches `bull:process` and stops there." Half of
that debt turned out to be already paid. A source that targets **one** episode works end to end
today: `src/jobs/source-ready.job.ts` already reads `episodeId`, `ProcessJobsService.getEncodeJobDetails`
already has its `processJob.episode` branch, and `src/paths/build-output-path.ts` already composes
`<outputRoot>/Fallout (2024) [tmdbid=106379]/Season 01/Fallout S01E03 The Head.mkv`. The half that
is missing is the other shape of a series release: a **season pack** — one torrent or one folder
carrying every episode of a season.

Nothing in the stack can process that today, and the blocker is not the worker's parsing, it is the
contract. `sourceScanned(mediaSourceId, files, matchedFilePath: String)` reports exactly **one**
winner, chosen by `src/scan/scan-folder.ts` as "the largest video file", with a comment saying it
deliberately does not parse season, episode or quality. `MediaSourcesService.sourceScanned` then
creates exactly one `SourceFile` and one `ProcessJob`, stamped with `mediaSource.episodeId` — the
single episode the request was made against. Ten episodes in a folder produce one encode and nine
ignored files, with no error anywhere. `MediaSource.seasonId` has existed in
`services/api/prisma/schema.prisma` since before `010` and is read and written by nobody: no
mutation creates a season-scoped source, so the shape this feature is about cannot even be
requested.

Two failure modes come with the fan-out and both are new. First, `src/jobs/cleanup-source.ts` runs
at the end of **every** encode and deletes the whole download directory: with ten `ProcessJob` rows
sharing one `MediaSource`, the first encode to finish deletes the input of the other nine, and the
existing "cleanup must never flip a completed job to ERROR" contract means it would do so silently.
Second, a pack routinely contains video files that resolve to no episode in the database — extras,
a sample, a recap, an episode TMDB does not list. Those must not block the rest, but they must also
not be thrown away with the torrent: if anything was discarded, the source stays on disk and stays
in qBittorrent so the user can look at it.

Once this ships, the root `CLAUDE.md`'s **Scan downloaded files, inventory** row stops meaning "pick
the biggest video" and starts meaning "resolve every video to its episode", and the **Transcode**
row covers a full season in one acquisition. The **Find release (indexer)** row does **not** change:
the only season-level entry point this feature adds is a magnet mutation on `api`, with no UI.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Three source shapes, one scan step)**: The scan step must branch on what the
      `MediaSource` targets, and the branch must be decided from data the API returns, never from
      the shape of the directory. A source targeting a film keeps today's behaviour exactly. A
      source targeting a single episode keeps today's behaviour exactly — the largest video file
      wins, no filename parsing, one `ProcessJob`, whether the download is a lone file or a folder.
      A source targeting a **season** enters the new behaviour below. A source targeting none of the
      three is an error.
- [ ] **REQ-2 (Every video file is a candidate)**: For a season source the scan must consider every
      video file in the download, at any depth, not only the largest one. Non-video files are
      ignored as they are today and are never reported as candidates.
- [ ] **REQ-3 (`SxxEyy` parsing, filename only)**: For each candidate the season and episode numbers
      must be read from the file's **base name**, matching `S<digits>E<digits>` case-insensitively
      (`S01E02`, `s1e2`, `Show.S01E02.1080p-GRP.mkv`). The parse must never look at the directory
      path, and no other information — quality, group, language, episode title — may be derived from
      the name. A base name containing more than one distinct `SxxEyy` (`S01E01E02`, a group name
      that repeats it) is ambiguous and must be treated as unresolved, not guessed.
- [ ] **REQ-4 (The API resolves the episode, the worker never does)**: The worker reports the parsed
      numbers; `api` alone turns them into an `Episode` row, resolved within the season the
      `MediaSource` targets. A file whose parsed season number is not that season's number is
      unresolved — a pack of season 2 does not silently file an S03 episode.
- [ ] **REQ-5 (One `SourceFile` and one `ProcessJob` per resolved episode)**: Each resolved file must
      produce its own `SourceFile` and its own `ProcessJob`, each carrying that episode's id, and
      each must be enqueued on `bull:encode`. Two files resolving to the **same** episode are not
      two jobs: the largest wins and the rest are unresolved, so a `sample` copy or a leftover
      duplicate cannot produce a second encode of the same episode.
- [ ] **REQ-6 (Episode status follows its own job)**: Each matched episode must move to `ENCODING`
      when its job is created, and to `COMPLETED`/`ERROR` when that job finishes — independently of
      its siblings. A pack must never move an episode it did not deliver a file for, and one failed
      episode must not move the other nine.
- [ ] **REQ-7 (Unresolved files are skipped, not fatal)**: Video files that resolve to no episode
      must be logged and skipped. They must not create rows, must not fail the scan, and must not
      prevent the resolved files from being encoded. A pack where at least one file resolved is a
      successful scan.
- [ ] **REQ-8 (When cleanup happens, by source shape)**: Cleanup is three physical actions — drop
      the torrent from the client, delete this job's input file, delete the whole download path — and
      when each one fires depends on how many episodes the source carries, never on whether it was a
      torrent or a local file:
      - **A film**, and **a source that targets a single episode**: one `ProcessJob`, so when it
        completes successfully the whole source goes at once — torrent dropped, download path
        deleted. Identical to today's behaviour.
      - **A season pack**: each episode's input file is deleted **as soon as that episode's own
        encode succeeds**, so a ten-episode pack does not hold ten source files on disk while the
        last one encodes. The download path itself is deleted only when the **whole season** is
        done.
- [ ] **REQ-9 (One deletion path, and the client is not it)**: The torrent must be dropped from the
      client once nothing else needs its files — at the **last** `ProcessJob` of the source to
      finish — and the client must never be asked to delete the files itself. A season pack does
      delete files while the torrent is still loaded, and that is safe: the download is already
      complete before any encode starts, so nothing can be interrupted by it. Every deletion in this
      pipeline is performed by the worker, behind the containment check, and that must remain the
      only path by which a file is removed.
- [ ] **REQ-10 (The download path waits for the last sibling)**: Deleting the download path must
      happen at most once, after the **last** `ProcessJob` of that `MediaSource` has finished, and
      only if every one of them completed successfully and no video file was left unresolved. While
      any sibling is `WAITING`/`QUEUED`/`ENCODING`, no encode may delete the path. A source with any
      `ERROR` job never has its path deleted — the inputs of the episodes that did succeed are
      already gone by then, and the failed episode's input is exactly what a retry needs.
- [ ] **REQ-11 (Something was discarded ⇒ the download path survives)**: If any video file of a
      source was left unresolved, that fact must be recorded against the `MediaSource` and must
      suppress the deletion of the download path — but not the per-episode input deletions, which
      only ever remove files this pipeline successfully encoded. What is left on disk is precisely
      the set of files nobody could classify, which is the point. The record must be recomputed by a
      re-scan, not accumulated.
- [ ] **REQ-12 (The worker does not decide any of this)**: All three decisions depend on rows the
      worker cannot see — its sibling `ProcessJob`s and the unresolved-files flag. `api` must hand
      the worker the three answers at the moment the encode is reported complete; the worker executes
      them and must not infer any of them from anything else it holds.
- [ ] **REQ-13 (Empty scan is still an error)**: A season source where **no** video file resolved to
      an episode must move the `MediaSource` to `ERROR` with an explanatory message and create no
      `ProcessJob`, mirroring what a film or episode source already does when it finds no video. No
      episode of the season may be left in `ENCODING`.
- [ ] **REQ-14 (A season source can be requested)**: `api` must expose one way to create a
      `MediaSource` bound to a season, so this pipeline is reachable and testable without hand-written
      SQL (Constitution, Article III). A pasted magnet is enough: same ownership scope, same
      one-active-source-with-`force` conflict rule and same superseding-to-`ERROR` behaviour that
      `addMagnetToEpisode` already implements.
- [ ] **REQ-15 (Output paths are unchanged)**: `src/paths/build-output-path.ts` already produces the
      required layout and must not be modified by this feature. A pack of *Invincible* season 4 lands
      as `<outputRoot>/Invincible (2021) [tmdbid=95557]/Season 04/Invincible S04E03 I GOTTA GET SOME AIR.mkv`,
      with the episode title coming from the database, never from the file name.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (`sourceScanned` changes shape, and `worker` is its only caller)**: Replacing
      `matchedFilePath: String` with a list is a breaking change to the mutation. It is safe only
      because `worker` is the single consumer (`web` never calls it) and both services ship from the
      same commit. `docs/spec/graphql-contract.md` must record the replacement, and both sides must
      change in the same feature — there is no codegen and no compiler across that seam.
- [ ] **NFR-2 (Hand-retyped types, all of them)**: The worker retypes every payload it reads. A field
      added to the `sourceScanned` input or to the `encodeCompleted` result must be added to the
      worker's local type in the same edit, or it silently arrives `undefined` — the exact failure
      `011-av1-transcode` documented for `allowedLanguagesIso3`.
- [ ] **NFR-3 (No database in the worker)**: The worker learns the target shape, the episode title
      and the cleanup verdict from GraphQL only (Constitution, Articles II and III). It gains no new
      environment variable and no second source of truth for any of them.
- [ ] **NFR-4 (Encode concurrency is unchanged)**: The `encode` queue stays at `concurrency: 1`. A
      ten-episode pack is ten serial encodes; nothing in this feature may run two FFmpegs at once or
      collapse the two queues in `src/index.ts`.
- [ ] **NFR-5 (Cleanup still cannot demote a finished job)**: The cleanup call keeps its current
      position in `handleEncode` — after the encode's own `try/catch` has closed, inside a second
      `try` that only logs. Adding the new gate must not move it back inside the encode's error
      path.
- [ ] **NFR-6 (Tests where the failure is silent)**: The filename parser and the cleanup gate both
      fail without producing an error anywhere — a mis-parsed name files an episode under the wrong
      number, and a mis-timed cleanup deletes nine pending inputs while every job still reports
      success. Both are owed unit tests (Constitution, Article IX), each opening with the sentence
      naming the failure it prevents.
- [ ] **NFR-7 (Re-scan converges)**: Re-running `sourceScanned` for the same source must converge,
      not duplicate: existing `SourceFile`/`ProcessJob` rows for a file are reused and a job already
      past `WAITING` is never reset, exactly as the current implementation guarantees for the single
      match.

## GraphQL Contract Delta

```graphql
input SourceFileInput {
  # …every existing field, unchanged…
  isVideo: Boolean!
}

input ScannedMatchInput {
  filePath: String!
  seasonNumber: Int
  episodeNumber: Int
}

type MediaSource {
  # …every existing field, unchanged…
  seasonId: Int
  hasUnmatchedFiles: Boolean!
}

type EncodeCompletedResult {
  message: String!
  removeTorrent: Boolean!
  deleteInputFile: Boolean!
  deleteDownloadPath: Boolean!
}

type Mutation {
  # replaces: sourceScanned(mediaSourceId: Int!, files: [SourceFileInput!]!, matchedFilePath: String): MediaSource!
  sourceScanned(mediaSourceId: Int!, files: [SourceFileInput!]!, matches: [ScannedMatchInput!]!): MediaSource!

  # replaces: encodeCompleted(processJobId: Int!, outputFilePath: String!, ffmpegCommand: String!): String!
  encodeCompleted(processJobId: Int!, outputFilePath: String!, ffmpegCommand: String!): EncodeCompletedResult!

  # gains an argument; the default preserves the current call site's behaviour
  downloadRemove(mediaSourceId: Int!, deleteFiles: Boolean = true): String!

  addMagnetToSeason(seasonId: Int!, magnet: String!, force: Boolean = false): Season!
}
```

Semantics the SDL cannot carry:

- **`matches` replaces `matchedFilePath`, and an empty list means what `null` used to mean.**
  `matches: []` is the "no video file found" branch, not a no-op. A film or single-episode source
  sends exactly one entry with `seasonNumber: null, episodeNumber: null` — the numbers are only
  filled in for a season source, and `api` ignores them whenever the source targets a film or a
  single episode. Every `filePath` must also appear in `files`; that validation already exists for
  the single match and now applies per entry.
- **`hasUnmatchedFiles` is set by `sourceScanned`, on every call, from that call's result only** —
  `true` when at least one entry of `files` with `isVideo: true` is absent from `matches`, `false`
  otherwise. It is the persisted half of REQ-11; a re-scan that resolves everything clears it.
- **`SourceFileInput.isVideo` exists so `api` can compute that without knowing what a video is.**
  `files` stays a complete inventory of the download, `.nfo`/`.srt`/`.txt` included, and the
  extension list stays where it already lives (`services/worker/src/scan/scan-folder.ts`). Without
  this flag `api` would have to treat every non-video sidecar as an unmatched file, which would set
  `hasUnmatchedFiles` on essentially every torrent and suppress cleanup forever — a silent
  disk-filling bug, not a visible one.
- **The three booleans on `EncodeCompletedResult` are instructions, not status.** They are
  independent, each answers one physical action, and the worker performs whichever are `true` in the
  order they are listed. `api` computes them from three rules, evaluated after the job it was told
  about has already been written as `COMPLETED`:

  | Field | `true` exactly when |
  | :-- | :-- |
  | `removeTorrent` | **no** `ProcessJob` of the source is left non-terminal — this is the last one to finish, whatever the others ended as. For a film or single-episode source, that is its only job. Sent on as `downloadRemove(mediaSourceId, deleteFiles: false)`. |
  | `deleteInputFile` | the source has **more than one** `ProcessJob` — i.e. it is a season pack, where each episode's input is released as it is consumed. Always `false` for a single-job source, where the next rule already removes everything. |
  | `deleteDownloadPath` | **every** `ProcessJob` of the source ended `COMPLETED` **and** `hasUnmatchedFiles` is `false`. |

  Worked through, in `(removeTorrent, deleteInputFile, deleteDownloadPath)` order: a film or single
  episode → `(true, false, true)`, exactly today's behaviour; a ten-episode pack → `(false, true,
  false)` on episodes one through nine and `(true, true, true)` on the tenth; the same pack with a
  skipped file → `(true, true, false)` on the tenth, so the torrent goes but the folder stays holding
  precisely the files nobody could classify; the same pack with episode five failing → no result at
  all for five (that is `encodeFailed`), `(false, true, false)` for the others, and — if five is the
  last to finish — no completion call at all, so the torrent stays in the client alongside its
  surviving input. That is the intended outcome: a failed episode leaves everything a retry needs.

  `message` carries the string `encodeCompleted` returns today, unchanged, so the existing log line
  survives the type change.
- **`removeTorrent` never asks the client to delete anything.** `downloadRemove` gains
  `deleteFiles: Boolean = true` and this pipeline always passes `false`. Every deletion is performed
  by the worker, behind `isInsideRoot` — one deletion path with one guard, rather than a second one
  inside qBittorrent that no containment check covers. The default stays `true` so no other caller
  changes meaning.
- **`encodeFailed` is untouched and never returns instructions.** A failed episode's input file is
  never deleted and its source's path is never deleted; that is the intended outcome, not a leak —
  the input of a failed encode is the only thing a retry can use.
- **`Season` gains no field.** The active-source conflict of REQ-14 is resolved server-side, the
  same way it is for an episode: `Episode` exposes no `mediaSourceId` either, and adding one to
  `Season` would put an acquisition detail on a type `show(id)` returns to every consumer.
- **`addMagnetToSeason` is scoped through `UserShow`**, like every other show-side operation: a
  season that does not exist and a season of another user's show answer identically. It carries no
  `@AllowService()`.

| Condition | GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `sourceScanned` for an unknown source | `NotFoundException` | `El mediaSource <id> no existe` (existing) |
| A `matches` entry whose `filePath` is not in `files` | `BadRequestException` | `matchedFilePath <path> no está en la lista de files reportada` (existing string, now per entry) |
| A season source where the season has no episode with that number | *not an error* | — (logged, file skipped, REQ-7) |
| A source targeting neither film, episode nor season | `BadRequestException` | `El mediaSource <id> no apunta a ninguna película, episodio ni temporada` |
| `matches: []` | *not an error* | source and, for a film/episode source, its media move to `ERROR` with the existing `Escaneo sin archivo de video principal: carpeta vacía o sin video` |
| `addMagnetToSeason` on an unknown or unowned season | `NotFoundException` | `La temporada <id> no existe` — one string for both cases, as `El episodio <id> no existe` already is |
| `addMagnetToSeason` on a season that already has a non-`ERROR` source, without `force` | `ConflictException` | `Esta temporada ya tiene una descarga en curso. Confirmá para reemplazarla.` |
| The magnet's infoHash already belongs to a film or another episode/season | `ConflictException` | `Ese magnet ya está asociado a «<título>»` (existing string, extended to the season case) |
| Malformed magnet | `BadRequestException` | existing `parseMagnet` message, unchanged |

Consumer obligations. **`worker`**: adds `seasonId` to the `mediaSource(id)` query in
`src/jobs/source-ready.job.ts` and to its local result type; sends `matches` instead of
`matchedFilePath`; reads `cleanupSource` from `encodeCompleted` and calls `cleanupSource()` only
when it is `true`. **`web`**: none — it calls neither mutation and does not read `MediaSource`.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `MediaSource` | add `hasUnmatchedFiles Boolean` | non-null, `@default(false)` | No — the default is correct for every existing row, and each row's value is recomputed on its next scan |

`MediaSource.seasonId`, `SourceFile.episodeId` and `ProcessJob.episodeId` already exist and are
unchanged; this feature is the first writer of the first one. No new model, no new enum, no new
index.

## Acceptance Criteria

- [ ] **AC-1**: Given a registered show whose season 2 has episodes 1–3, when `addMagnetToSeason` is
      called with a magnet for a pack containing `Show.S02E01.mkv`, `Show.S02E02.mkv` and
      `Show.S02E03.mkv` and the download completes, then `bin/mysql -e 'select id, episode_id, status
      from process_jobs order by id desc limit 3'` shows three rows, one per episode of that season,
      and `select status from episodes where season_id = …` shows all three at `ENCODING`.
- [ ] **AC-2**: After those three encodes finish, three files exist under
      `<HOST_DESTINATIONS_DIR>/<path_shows>/<Show> (<year>) [tmdbid=<id>]/Season 02/`, named
      `<Show> S02E01 <episode title>.mkv` and so on, with the titles matching the `episodes` table and
      not the release file names.
- [ ] **AC-3 (regression, case 1)**: A magnet added with `addMagnetToEpisode` whose torrent is a
      folder containing one video plus `.nfo`/`.srt` files still produces exactly **one**
      `ProcessJob`, against the requested episode, and one output file — the parsed `SxxEyy` in the
      file name is not consulted and cannot redirect it to another episode.
- [ ] **AC-4 (failure path, unresolved file)**: Given the AC-1 pack plus a fourth video
      `Show.S02E09.mkv` for an episode the season does not have, then three `ProcessJob` rows are
      created (not four), `select has_unmatched_files from media_sources where id = …` returns `1`,
      `docker compose logs worker` names the skipped file, and **after the third encode completes**
      the download directory still exists and contains `Show.S02E09.mkv` and nothing else — the three
      encoded inputs were each deleted as their episode finished.
- [ ] **AC-5 (failure path, empty scan)**: Given a season source whose download contains no video
      file at all, then the `MediaSource` row is `ERROR` with
      `Escaneo sin archivo de video principal: carpeta vacía o sin video`, no `ProcessJob` row exists
      for it, and every episode of that season is still at its previous status — none is left at
      `ENCODING`.
- [ ] **AC-6 (cleanup gate, per episode then whole folder)**: With the AC-1 pack (all files
      resolved), watching the download directory across the three encodes shows: after the first
      completes, `Show.S02E01.mkv` is gone and the other two files are still there; after the second,
      only `Show.S02E03.mkv` remains; after the third, the directory itself is gone and the torrent
      is no longer listed in qBittorrent.
- [ ] **AC-6b (a film is unchanged)**: A film download still leaves nothing behind: after its single
      encode completes the torrent is gone from qBittorrent and the download directory is deleted, in
      one step, exactly as before this feature.
- [ ] **AC-7 (failure path, one bad episode)**: If the second episode's encode fails, the first and
      third still reach `COMPLETED` with their output files in place, only the second episode is
      `ERROR`, the download directory is **not** deleted, and `Show.S02E02.mkv` is still inside it —
      the input a retry needs survives, while the two consumed inputs are gone.
- [ ] **AC-8**: `bin/npm worker test` passes, including new specs that assert `S01E02`, `s1e2` and
      `Show.S01E02.1080p-GRP.mkv` parse to `(1, 2)`, and that `S01E01E02`, `Season 01/episode 3.mkv`
      and `Show.1x02.mkv` parse to nothing.
- [ ] **AC-9**: `bin/npm api test` passes, including a spec that walks the verdict table field by
      field: `removeTorrent` only on the first sibling to complete; `deleteInputFile` only when the
      source has more than one job; `deleteDownloadPath` `false` while a sibling is pending, `false`
      when a sibling ended in `ERROR`, `false` when the source has unmatched files, and `true` only
      for the last job of a fully successful, fully matched source.
- [ ] **AC-10**: `bin/cli api npx --no tsc --noEmit` and `bin/cli worker npx --no tsc --noEmit` both
      report 0 errors.

## Out of Scope

- **Any `web` UI for a season.** No season-level buttons on the `/shows/<id>` accordion, no season
  search modal, no folder-import modal. `addMagnetToSeason` exists in this feature only so the
  pipeline is reachable from a GraphQL call; wiring it to the accordion is its own spec, and it is
  what `010-episode-acquisition` would have been for seasons.
- **`addTorrentToSeason` and a season upload ticket.** The indexer search flow and the tus upload
  flow both stay episode-level. One entry point is enough to exercise the pipeline; three would drag
  `web` into the feature.
- **Numbering schemes other than `SxxEyy`.** `1x02`, bare `102`, anime absolute numbering (`Show -
  57`) and date-based numbering are all treated as unresolved. Supporting them is a parser change
  behind the same contract and can be added later without touching either service's plumbing.
- **Multi-episode files.** A single file holding `S01E01E02` is discarded, not split and not filed
  twice; splitting it is an FFmpeg operation this pipeline has no shape for.
- **External subtitle files.** `.srt`/`.ass` siblings in a pack are ignored exactly as they are
  today; `011-av1-transcode` keeps embedded text subtitles only.
- **Seeding after the encodes.** A season pack deletes each episode's file as it is consumed, so
  from the first completion onward the torrent is incomplete from the client's point of view and
  qBittorrent will show it as missing files until it is dropped at the end. Nothing is at risk — the
  download finished before any encode began — but a seed-for-N-days policy would need the deletions
  to wait, which is the opposite of what a pack is trying to achieve on disk. That is a
  settings-shaped feature, not a fix to this one.
- **Surfacing the skipped files in the UI.** `hasUnmatchedFiles` is a boolean the pipeline acts on,
  not a report. Listing *which* files were skipped, or letting a user assign one by hand, needs a
  `web` surface and its own spec.
- **Unifying `movieId`/`episodeId` into `mediaId`.** Still the dated debt in the root `CLAUDE.md`;
  this feature adds `seasonId` beside them and changes neither, for the reason `010`'s NFR-1 gives.

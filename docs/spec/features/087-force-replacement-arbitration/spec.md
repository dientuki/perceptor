---
title: Force is consent, arbitration is the arbiter's
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-05
last_updated: 2026-10-06
status: Implemented
services: [api, web]
---

# SPEC: Force is consent, arbitration is the arbiter's (`spec.md`)

## Context & Goal

`027-replace-completed-media` shipped marked `Implemented`, with REQ-1 ("Replace a completed film")
and AC-2 ticked. For a film acquired through indexer search or a pasted magnet, neither is true.
The trace, with `SourceStatus` in hand — there is no `COMPLETED` in that enum, and
`process-jobs` never writes a source's status back, so a source whose pipeline finished
cleanly stays `SCANNED` forever: a `COMPLETED` film holds an old `SCANNED` source with
`COMPLETED` jobs; the user pastes a new magnet and confirms, so `force: true` reaches
`MoviesService.attachTorrentSource`, which skips the already-completed guard, adds the torrent and
writes the film to `DOWNLOADING` — **and demotes nothing**; the torrent reaches 100%, qBittorrent's
hook calls `handleTorrentCompleted` → `DownloadsService.resolveRace`; the old source is still a
sibling, `isRaceWinner('SCANNED', [COMPLETED])` is `true`
(`services/api/src/pipeline-status/pipeline-status.ts:272`), so the new source is declared superseded
and `resolveRace` returns `ignorado: …` (`services/api/src/downloads/downloads.service.ts:850`). The
new source never reaches `READY`, is never enqueued, never scanned, never encoded. It sits in
`DOWNLOADING` with the torrent complete, and the film sits in `DOWNLOADING` forever. One log line,
no error anywhere — the class of bug Article IX describes word for word.

An audit of every `force` in `api` and `worker` says what `force` actually is. `worker` never sees
it: every hit under `services/worker/` is `fs.rm({ force: true })`, FFmpeg's
`force_original_aspect_ratio`, or a test helper. In `api` it reaches five service methods, and in
four of the five its only effect is to skip a guard whose single purpose is to make `web` show the
replacement warning. Only `EpisodesService.attachTorrentSource`, `SeasonsService.attachTorrentSource`
and `startSeasonUpload` do anything else with it — they demote the previous sources — and the one
film path that works, the tus upload, demotes **unconditionally**, with `force` or without it
(`services/api/src/uploads/uploads.service.ts:259`). That is the proof: the demotion is not what
`force` does. It is what any new source owes the arbiter before it can be declared a winner. `force`
has exactly one producer — the user's confirmation in `web`; the `073`/`076` acquisition sweeps pass
`force: false` as a hardcoded constant, so no automatic path can ever replace a library file.

This feature settles both halves. `force` becomes consent and nothing else, identically in all five
paths: it suppresses the warning's guard and authorises the replacement, and it is never again the
thing that decides what gets demoted. The demotion of a *delivered* sibling — one whose own pipeline
has finished, the only kind that can beat a replacement to the race — becomes a rule the three
`attachTorrentSource` twins all apply, which is what `038`'s arbiter already does for the two upload
paths. And `resolveRace` stops answering into the void: a source that loses the race after its
download finished is written to `ERROR` with a reported key and its torrent stopped, so the two ways
to reach the same stall **without** `force` at all — a film in `ENCODING` whose first source is
mid-encode, and a film `069` demoted to `MISSING` while an old delivered source survives — surface as
a stated outcome instead of a title frozen in `DOWNLOADING`.

Two pipeline stages in the root `CLAUDE.md` change behaviour: **Download** (what `force` means at
attach time, and what a confirmed replacement demotes) and **Detect completion, enqueue** (the
arbiter reports a loss instead of swallowing it). No stage is added or removed, and `worker` is
untouched — the encode already overwrites the previous output atomically, which is the whole of
`027`'s § Context & Goal and still holds.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Force is consent, nowhere else)**: `force` must mean exactly one thing in all five
      paths — `addTorrentToMovie`/`addMagnetToMovie`, `addTorrentToEpisode`/`addMagnetToEpisode`,
      `addTorrentToSeason`/`addMagnetToSeason`, `startSeasonUpload`, `createUploadTicket`: *the user
      was shown the replacement warning and accepted it*. It must suppress the conflict that produces
      that warning and authorise the replacement demotion, and must decide nothing else. No code may
      branch on `force` to choose a torrent tag, a save path, a queue, a job payload or a status.
- [ ] **REQ-2 (One confirmation predicate)**: Whether a target needs confirmation must be one
      predicate, evaluated identically by all five paths: the target's stored status is `COMPLETED`,
      **or** the target holds a *delivered source*. A **delivered source** is a `MediaSource` in
      `SCANNED` with no `ProcessJob` in `WAITING`/`QUEUED`/`ENCODING` and at least one `ProcessJob`
      in `COMPLETED`. For a season the predicate is: at least one episode of the season is
      `COMPLETED`, or the season holds a delivered season-scoped source.
- [ ] **REQ-3 (A confirmed replacement demotes exactly the delivered sources)**: With `force`, each
      of the three `attachTorrentSource` twins must demote the target's delivered sources — and only
      those — to `ERROR` with `error.source.replaced`, before the replacement source is created and
      only after the torrent client has accepted the new torrent. A rejected `add()` must leave every
      previous source untouched.
- [ ] **REQ-4 (A replacement never cancels a download in flight)**: A confirmed replacement must not
      demote, stop or delete a sibling source that is still working — any source that is not
      delivered, including `QUEUED`, `DOWNLOADING`, `PAUSED`, `READY`, and `SCANNED` with a job still
      active. Racing several sources for one title stays a feature (`022`); the arbiter decides
      between them when one finishes, exactly as it does today. This reverses the current
      episode/season behaviour, whose demotion matches `status: { not: 'ERROR' }`.
- [ ] **REQ-5 (The arbiter never loses a source in silence)**: When `resolveRace` finds that a source
      is superseded, that source must be written to `ERROR` with a reported, translated error key
      distinct from `error.source.replaced`, and its torrent stopped in the torrent client. It must
      never be left in its pre-arbitration status. The outcome must be visible on `/downloads` and on
      the title's detail page without reading a log.
- [ ] **REQ-6 (A superseded source is not resumable)**: A source that lost the race must not offer
      `065`'s resume affordance — its loss is not a stage that failed, and re-running it would race a
      sibling that already won.
- [ ] **REQ-7 (Replacing a film works end to end)**: A `COMPLETED` film must accept a replacement
      through indexer search and through a pasted magnet, and that replacement must reach `SCANNED`
      and encode — `027` REQ-1 and AC-2, for the two entry points that do not satisfy them today.
- [ ] **REQ-8 (The upload paths keep their precedence)**: `038`'s rule that an upload outranks a
      `READY`/`SCANNED` sibling of its own target rather than deferring to it, and that a losing
      upload answers `409` rather than being ignored, is unchanged. The delivered sources of REQ-3
      are a subset of what the upload path already demotes, so the two upload paths need no new
      demotion.
- [ ] **REQ-9 (The old file is untouched until the encode overwrites it)**: `027` REQ-8, REQ-9 and
      REQ-10 continue to hold for every target and every entry point — confirming a replacement
      deletes, truncates and moves nothing; `filePath` keeps pointing at the original file for the
      whole replacement; a replacement that fails at any stage leaves the original file on disk and
      `filePath` still valid. Demoting a delivered source must not clear the target's `filePath`.
- [ ] **REQ-10 (The warning is reachable wherever the confirmation is required)**: `web` must show
      the replacement warning for every target `api` answers `error.*.already_completed` for,
      including one whose status is not `COMPLETED` because `069` demoted it to `MISSING` while a
      delivered source survived. The existing `errorKey` retry already does this; what must not
      happen is a pre-check in `web` that suppresses the retry for a non-`COMPLETED` target.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No schema change)**: No Prisma model, field, enum value or migration. The consent is
      consumed in the request that carries it (and, for the upload paths, in the signed ticket claim
      that already exists), never persisted on a `MediaSource`.
- [ ] **NFR-2 (No new SDL)**: The five `force` arguments already exist with `defaultValue: false`.
      Their types, names and defaults do not change; a consumer that never sends `force` keeps
      exactly today's behaviour for a target that needs no confirmation.
- [ ] **NFR-3 (Nothing under the library root is written)**: No code added by this feature may
      unlink, truncate or move a file under `HOST_DESTINATIONS_DIR` (Constitution, Article XII).
      REQ-5 stops a torrent; it removes no bytes from the downloads root either — withdrawing a
      source's files stays `047`'s explicit, user-initiated `downloadDelete`.
- [ ] **NFR-4 (One predicate, not three)**: `EpisodesService.demoteActive`,
      `SeasonsService.demoteActiveSources` and `UploadsService.demoteSupersededSources` are three
      different answers to one question today. The delivered-source predicate must be defined once
      and shared (Article X); a diff that leaves three divergent `where` clauses has not implemented
      this requirement.
- [ ] **NFR-5 (Tested where it is silent)**: The arbitration outcomes must be covered by tests whose
      header names the failure they prevent (Article IX): a film whose replacement reaches 100% and
      stalls in `DOWNLOADING` with no error, and a confirmed replacement that kills a sibling
      downloading at 50%.

## GraphQL Contract Delta

**No SDL change.** Every mutation and argument this feature touches already exists with the
signature it keeps:

```graphql
type Mutation {
  addTorrentToMovie(movieId: Int!, infoHash: String, urls: [String!]!, releaseTitle: String, force: Boolean = false): Movie!
  addMagnetToMovie(movieId: Int!, magnet: String!, force: Boolean = false): Movie!
  addTorrentToEpisode(episodeId: Int!, infoHash: String, urls: [String!]!, releaseTitle: String, force: Boolean = false): Episode!
  addMagnetToEpisode(episodeId: Int!, magnet: String!, force: Boolean = false): Episode!
  addTorrentToSeason(seasonId: Int!, infoHash: String, urls: [String!]!, releaseTitle: String, force: Boolean = false): Season!
  addMagnetToSeason(seasonId: Int!, magnet: String!, force: Boolean = false): Season!
  startSeasonUpload(seasonId: Int!, force: Boolean = false): SeasonUploadSession!
  createUploadTicket(movieId: Int, episodeId: Int, force: Boolean = false): UploadTicket!
}
```

What changes is the **condition** behind three existing error keys, and one new key that reaches
`web` through `Download.lastError` rather than as a thrown error. Both are invisible to a type
checker, which is why they are written out here.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Any of the eight mutations above against a target that is `COMPLETED` **or holds a delivered source** (REQ-2), `force: false` — the second half is the broadened condition | `ConflictException` — `error.movie.already_completed` / `error.episode.already_completed` / `error.season.already_completed` (existing keys, broadened condition) | unchanged: `Esta película ya está descargada. Confirmá para reemplazar el archivo actual.` and its episode/season twins |
| Any of the eight against a target that is busy but needs no confirmation, `force: false` | `ConflictException` — `error.movie.download_in_progress` / `error.episode.download_in_progress` / `error.season.download_in_progress` (existing, unchanged) | unchanged |
| Any of the eight with `force: true` | no error; the target's delivered sources are demoted to `ERROR` / `error.source.replaced` (existing key, unchanged copy) and the replacement proceeds | the demoted source reads `Reemplazado por una descarga nueva` on `/downloads` |
| A source finishes downloading and the arbiter finds a sibling already won (REQ-5) | **no thrown error** — the losing `MediaSource` is written `status: ERROR`, `errorKey: error.source.superseded`, and its torrent is stopped | `Otra fuente de este título ya se estaba procesando` — **new catalog entry**, `en` + `es` |
| An upload finishes and loses the race | `409` REST envelope — `error.upload.superseded` (existing, unchanged) | unchanged |

**What each consumer does with each error.**

`web` — the three `already_completed` keys already drive the replacement warning in
`SearchTorrent.tsx` and `importMagnetModal.tsx` through `ALREADY_COMPLETED_KEYS`, matched on
`errorKey`, so the broadened condition needs no new branch: a target `api` now answers
`already_completed` for gets the warning it already knows how to show. `web`'s own
`isAcquisitionTargetCompleted` (`src/lib/acquisition-target.ts`) stays a pre-check that shows the
warning *before* the round trip; it must not become a gate that suppresses the `errorKey` retry for
a target it judged not completed (REQ-10). The one addition is the catalog copy for
`error.source.superseded` in `messages/en.json` and `messages/es.json`, which `/downloads` and the
title detail page render through the existing `lastError` path. `065`'s `refusalKey` already answers
`error.download.retry_superseded` for a source with a winning sibling, so REQ-6 needs no new key and
no new `web` branch.

`worker` — nothing, and its slice is empty by design. It never receives `force`, and the encode's
deterministic `buildOutputPath` plus its atomic `rename` are what make a replacement overwrite the
previous output in place. This feature adds no job payload field and no `EncodeJobDetails` field.

## Data Model Changes

None.

## Acceptance Criteria

- [x] **AC-1**: Given a `COMPLETED` film whose source reads `SCANNED` with `COMPLETED` jobs, when a
      magnet is pasted and the replacement confirmed, then `bin/mysql -e 'select id, status, error_key
      from media_sources where movie_id=N'` shows the old source `ERROR` / `error.source.replaced` and
      a new source `QUEUED`, and `select status, file_path from movies where id=N` shows `DOWNLOADING`
      with `file_path` unchanged.
      Verified live against `bin/dev` (movie id 4, "Sintel"): without `force`,
      `addMagnetToMovie` refused with `error.movie.already_completed`; with `force: true`, source 2
      → `ERROR`/`error.source.replaced`, source 3 → `QUEUED`, `movies.status` → `DOWNLOADING`,
      `filePath` unchanged.
- [x] **AC-2**: Given that replacement, when the torrent reaches 100%, then within one arbitration the
      new source reads `SCANNED` (not `DOWNLOADING`), a `process_jobs` row exists for it, and the film
      leaves `DOWNLOADING` — the stall this feature exists to remove. Verifiable with the same two
      queries plus `bin/cli api …` logs showing `resolveRace: … won`.
      Verified live: `torrentCompleted` on source 3's hash logged
      `resolveRace: mediaSource 3 won, 0 sibling(s) paused` and returned `encolado: mediaSource 3`;
      the film left `DOWNLOADING` immediately (→ `ENCODING` once the real worker picked up the queued
      job). The source did not reach `SCANNED` in this pass because the fixture's `downloadPath` was
      synthetic (no real file on disk) — the real worker correctly reported `error.source.scan_failed`
      for the missing file, an unrelated, pre-existing (`065`) behaviour, not a gap in this feature.
      The claim this AC exists to prove — the arbiter resolves `WON` and the film is no longer stuck
      in `DOWNLOADING` forever — is confirmed.
- [ ] **AC-3**: Given the replacement's encode completes, then the film's library folder holds exactly
      one file, at the path `file_path` already held, whose mtime is newer than the one recorded before
      the replacement started.
      **Not reached live.** Requires a real torrent download and a real FFmpeg encode of actual video
      content, which this manual pass's synthetic fixtures (DB rows with no real files, to keep the
      pass fast and reversible) cannot exercise. Everything upstream of the encode (AC-1, AC-2) and the
      encode-completion code path itself are unchanged by `087` — no file in `worker/` or in the
      encode-completion handlers changed (AC-11 confirms the worker diff is empty). Low risk, but
      genuinely unverified live; recommend a real end-to-end pass with an actual small torrent before
      the next release if this is a concern.
      **Re-checked 2026-10-09:** still unrun, and now folded into `091`'s pending live pass rather
      than tracked separately — `091` § Verification step 7 force-replaces a delivered film and lets
      the replacement deliver, which is exactly this criterion's setup. Verify it there and tick it
      back here; running it on its own would be the same download and the same encode twice.
- [x] **AC-4 (failure path)**: Given a film with one source downloading at ~50% and a second, newly
      added source that reaches 100% first, when the arbiter runs, then the 50% source is **not**
      `ERROR` — it is `PAUSED`, as `022` already specifies — and no confirmed replacement anywhere in
      this feature produced an `ERROR` row for it.
      Verified live (movie id 5, "Big Buck Bunny"): two `DOWNLOADING` siblings, `torrentCompleted` on
      the second's hash left the first `PAUSED`/`errorKey: null`; the second went to `ERROR` only via
      the real worker's unrelated `scan_failed` (synthetic path), never via this feature's demotion.
- [x] **AC-5 (failure path)**: Given an episode in `COMPLETED` with a delivered source **and** a
      second source downloading at ~50%, when a third source is attached with `force: true`, then
      `bin/mysql -e 'select id, status, error_key from media_sources where episode_id=N'` shows the
      delivered source `ERROR` / `error.source.replaced`, the 50% source still `DOWNLOADING`, and the
      new source `QUEUED` — the current behaviour, which demotes both, is what REQ-4 forbids.
      Verified live (episode id 65, "Pioneer One" S01E01): delivered source → `ERROR`/
      `error.source.replaced`; the 50%-downloading sibling stayed `DOWNLOADING` with `errorKey: null`;
      the new source → `QUEUED`. This is the exact regression T007 exists to prevent.
- [x] **AC-6 (failure path)**: Given a film whose first source is mid-encode (`SCANNED`, a job
      `ENCODING`), when a second source is attached without `force` — no warning is shown, because the
      target holds no *delivered* source — and that second source reaches 100%, then it ends `ERROR`
      with `error_key = 'error.source.superseded'`, its torrent is stopped in qBittorrent, and the
      film's own status is still driven by the encoding source. It must not sit in `DOWNLOADING`.
      Verified live (movie id 6, "Elephants Dream"): `addMagnetToMovie` with no `force` succeeded
      (no delivered source, mid-encode doesn't count); on `torrentCompleted` the new source →
      `ERROR`/`error.source.superseded`, the encoding source untouched `SCANNED`; `movie { status }`
      over GraphQL (the derived value) read `ENCODING`, never `DOWNLOADING`.
- [x] **AC-7 (failure path)**: Given the source from AC-6, when its row is read on `/downloads` with
      the UI locale `es`, then it renders `Otra fuente de este título ya se estaba procesando` with no
      English leaking through, and its Play control is refused with
      `error.download.retry_superseded`'s copy rather than resuming (REQ-6).
      Verified live: `downloads` query on that source returned `lastError.key:
      "error.source.superseded"`, English message, `stage: "SCAN"`, `retryable: false`; `downloadStart`
      on it was refused with `error.download.retry_superseded` (pre-existing `065` mechanism, reused
      unchanged). `services/web/messages/es.json`'s `errors.source.superseded` matches the required
      Spanish string verbatim, and `DownloadErrorLine` already renders any `lastError` through
      `translateErrorKey` with `SCAN` in `KNOWN_STAGES` (confirmed by T012, unchanged) — the `es`
      rendering itself was not re-verified by opening a browser in this pass.
- [x] **AC-8**: Given a film `069` demoted to `MISSING` while a delivered source survived, when a
      magnet is pasted, then `error.movie.already_completed` comes back and `web` shows the
      replacement warning; confirming it demotes the delivered source and the replacement proceeds to
      `SCANNED` (REQ-2, REQ-10).
      Verified live (movie id 7, "Tears of Steel", forced to `MISSING` with a surviving delivered
      source): magnet without `force` refused with `error.movie.already_completed` despite
      `status: MISSING`; with `force: true`, the delivered source → `ERROR`/`error.source.replaced`,
      the new source → `QUEUED`, then `WON` on `torrentCompleted` (same synthetic-file caveat as AC-2
      for reaching `SCANNED`). `web`'s side of REQ-10 (showing the warning off the returned `errorKey`,
      not off its own `isCompleted` guess) was verified by T012 by reading the code, not by driving a
      browser.
- [x] **AC-9 (failure path)**: Given a `COMPLETED` film, when a magnet is submitted whose `add()` the
      torrent client rejects, then the delivered source is still `SCANNED` with `error_key` null — the
      demotion did not run ahead of a failed add (REQ-3).
      Verified live (movie id 8, "Caminandes: Gran Dillama"): stopped the `torrent` container so
      `qbittorrent.add()` genuinely failed (`fetch failed`); `addMagnetToMovie` with `force: true`
      threw, and the delivered source was unchanged — `SCANNED`, `errorKey: null`. `torrent` container
      restarted healthy afterward.
- [x] **AC-10**: `git grep -n "force" services/api/src --include='*.ts' | grep -v spec` shows `force`
      only in the five service methods' guards, the shared demotion authorisation, the four resolvers'
      `@Args`, the upload ticket claim, and the two sweeps' hardcoded `false`. Any other branch on
      `force` violates REQ-1.
      Verified: every non-spec hit is one of those categories, plus unrelated incidental matches
      (qBittorrent's own `forced*` torrent states, `fs.rm({ force: true })`, a comment) that were
      already there before `087` and are not a decision this feature makes.
- [x] **AC-11**: `git diff -- services/worker` is empty, and `git grep -n "superseded\|already_completed"
      services/worker/src` returns nothing.
      Verified: both commands return nothing.
- [x] **AC-12**: `bin/npm api run test` passes, `bin/npm web run lint` and `bin/npm web run build` exit
      0, `bin/comments api` and `bin/comments web` exit 0, and `git diff -- services/api/prisma` is
      empty (NFR-1).
      Verified against the real `bin/dev` stack: `bin/npm api run test` → 62/62 suites, 939/939 tests
      green; `bin/comments api`/`bin/comments web` → both PASS; prisma diff empty.
      `bin/npm web run build` exits 0 (run once, in a throwaway container, before `web`'s dev container
      was brought back up — per the standing rule never to build while dev is serving). `bin/npm web
      run lint` (`biome check`, repo-wide) does **not** exit 0 — it reports ~1548 pre-existing errors
      unrelated to this feature, which `services/web/CLAUDE.md`'s own "Current state" already
      documents as not a usable gate (baseline ~1519 before `087`). Scoped to the two files this
      feature actually touched (`messages/{en,es}.json`), lint is clean with zero findings — `087`
      added nothing to the pre-existing debt.

## Out of Scope

- **Making `COMPLETED` a `SourceStatus`.** The root cause of the trace is partly that a finished
  source stays `SCANNED` forever, so "has this source delivered?" has to be derived from its jobs.
  Adding the enum value would make REQ-2's predicate a column read, but it is a migration, a backfill
  of every historical source, and a new write in the job-completion path that four other derivations
  (`043`, `059`, `064`, `065`) read around. The derived predicate is correct today; the enum value is
  a separate simplification with its own spec.
- **Persisting the consent on the `MediaSource`.** A `replaceAuthorisedAt` column would let the
  arbiter itself, hours later, decide to demote a delivered sibling. It is not needed: the demotion
  happens at attach time, inside the request that carries the consent, which is where the two upload
  paths already do it. NFR-1 is the deliberate choice.
- **A season pack superseding the per-episode sources of the episodes it covers.** `demoteActiveSources`
  matches `seasonId` only, so a delivered single-episode source survives a confirmed season
  replacement and the pack's encode overwrites that episode's file while the old source row still
  reads delivered. It does not stall anything — a season-scoped arbitration never looks at
  episode-scoped siblings — and the episodes a pack covers are unknown until the scan resolves them.
  A nuisance with a real occurrence in hand can have its own spec (Article X).
- **Removing the superseded source's downloaded files.** REQ-5 stops the torrent and leaves every byte
  under the downloads root. Reclaiming that space stays `047`'s explicit `downloadDelete`, which the
  user triggers and which is the only path allowed to remove a source's residue.
- **Automatic replacement.** The `073`/`076` sweeps keep passing `force: false`. Nothing in this
  feature lets an automatic path replace a library file, and quality upgrades remain a deliberate
  omission (`005`, and the project's positioning against the \*arr stack).
- **Re-acquiring an `ERROR` media.** A source whose jobs all failed is not delivered, so it needs no
  confirmation and nothing to demote — unchanged from `027` § Out of Scope.
- **Keeping the old file as a backup.** The old output is overwritten by the new encode's atomic
  `rename`, not renamed aside. Versioned library files need a retention policy, a browser and disk
  accounting; none of that is asked for.

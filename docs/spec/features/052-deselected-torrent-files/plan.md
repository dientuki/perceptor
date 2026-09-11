---
title: Deselected torrent files must never be encoded — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-10
status: Approved
---

# PLAN: Deselected torrent files must never be encoded (`plan.md`)

## Approach

The whole feature is one new fact travelling one hop further than it does today: qBittorrent already
knows which files of a torrent it was told to download, `api` already talks to qBittorrent, and the
worker already asks `api` for the `MediaSource` right before it scans. We add
`GET /api/v2/torrents/files?hash=…` to the existing `QbittorrentClient`
(`services/api/src/clients/torrent/client.ts`), expose its answer as a resolved-on-demand
`MediaSource.downloadedFiles`, and let the worker narrow its candidate set with it before
`selectMatches` runs.

Three deliberate choices, each with a real alternative:

- **The filtering rule lives in `MediaSourcesService`, not in the client.** `QbittorrentClient.files()`
  maps qBittorrent's rows into a typed shape (`{ name, priority, progress }`) exactly as `info()`
  already maps `torrents/info`, and nothing else. The "selected **and** complete" rule (REQ-1) is
  applied one level up, where a mocked client can exercise it — a rule buried inside a `fetch` wrapper
  is a rule no test reaches without a live qBittorrent. This mirrors the existing split between
  `client.ts`'s pure adapter and `IndexerService`'s cache/rules above it.
- **A `@ResolveField` on `MediaSourcesResolver`, not a field computed inside `findOne`.** NFR-1 says
  the torrent-client call must happen only for a caller that asks. `findOne` is also the read behind
  `sourceScanned`'s return value, and `MediaSource` is returned from several mutations; computing the
  list eagerly would put an external HTTP call on paths that have no use for it. The parent object the
  resolver receives is the Prisma row `findOneFlat` returns, so `infoHash` and `downloadPath` are
  already in hand — no second query.
- **A new pure module in the worker (`src/scan/mark-downloaded.ts`), not a new branch inside
  `scan-folder.ts`.** `scanFolder` enumerates what is on disk; it cannot know what a torrent client
  thinks, and giving it a parameter it would only pass through would blur the one boundary
  `013-season-pack-processing` deliberately drew (enumerate → select, see that file's header comment).
  The new module is the house pattern for small pure modules with local types
  (`paths/is-inside-root.ts`, `metadata/container-tags.ts`).

Reused rather than rebuilt: `QbittorrentClient` and its `TorrentClientError`/`baseUrl()`/`HTTP_METHOD`
plumbing; `SettingsModule`'s existing export of that client (`MediaSourcesModule` imports it, the same
way `DownloadsModule`/`ProcessJobsModule` already do); `i18nError`/`ERROR_KEYS`/`MESSAGES_EN` for the
new key; `sourceScanned`'s existing transaction, empty-match `ERROR` branch and `hasUnmatchedFiles`
computation, both of which gain a condition rather than a new code path; the worker's existing
`selectMatches` rules, which are untouched — only the set of files handed to them changes.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the schema. `MediaSource.downloadedFiles` and `SourceFileInput.isDownloaded` must exist before the worker can query or send them; a worker sending `isDownloaded` to an older `api` is rejected by the `ValidationPipe`, and one querying a field that does not exist fails the whole query. |
| 2 | `worker` | Consumes both ends of step 1: reads the list, reports the flag. |
| 3 | `[docs]` | `docs/spec/graphql-contract.md` gains a `052` section recording the two additions and the worker's obligation. Can be written any time after the contract freeze; it documents, it does not gate. |

**Nothing here runs in parallel across services.** The two slices are small and the second is defined
entirely by the first's output; the only genuinely parallel work is the `[docs]` step, which depends
on the frozen spec rather than on either implementation.

Within `api`, the client method (step 1a) and the `sourceScanned` rule changes (step 1c) are
independent of each other and may be done in either order; the resolver field (step 1b) depends on 1a.

## Contract Freeze

`## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Three things an
implementer will want to change and must not:

- **`downloadedFiles` is `[String!]` (nullable list), not `[String!]!`.** From inside `api` it is
  tempting to make it non-null and return `[]` when there is no torrent — every other list field on
  the schema is non-null. Here `null` and `[]` are different facts (REQ-2): `[]` means the client
  answered and nothing was downloaded, which must fail the scan under REQ-7; `null` means nobody knows,
  which must fall back to today's behaviour under REQ-4. Collapsing them makes every tus upload look
  like an empty torrent and breaks the upload path with no error anywhere.
- **`SourceFileInput.isDownloaded` is required, not optional with a default.** An optional boolean
  that defaults to `true` would let a worker that forgot to send it compile, pass validation and
  silently reinstate this bug. NFR-3 accepts that an older worker image breaks loudly instead.
- **The entries are relative paths, not absolute ones.** Returning absolute container paths would save
  the worker a `join` and violate Article V. The worker owns the join, against the `downloadPath` it
  already has.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief both services
(Article VIII). Do not adapt it from inside a slice.

## Migrations

**None.** No Prisma model, column or enum changes (NFR-2). The `isDownloaded` flag is consumed inside
`sourceScanned`'s existing transaction and never persisted; `downloadedFiles` is resolved on demand
and never stored.

Reversibility: reverting the feature is reverting code. No rows change shape, so a rollback needs no
data work — the only consequence is that the bug returns.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **Path assembly drifts** — qBittorrent's per-file `name` is relative to the torrent's save path, which is exactly `MediaSource.downloadPath` (`client.ts`'s `add()` returns that `savepath`). If that ever stops holding, every path misses the set. | Silent and total: no enumerated file matches the list, every video is marked not-downloaded, and **every** torrent scan fails with the new REQ-7 error instead of encoding. | The join lives in one worker module with its own spec (`mark-downloaded.spec.ts`), including a case where nothing matches. AC-1 exercises the real assembly end to end; AC-4's error is only correct when it is *also* the right answer, so a live AC-1 run is what separates the two. |
| **infoHash case** — the column holds an uppercase hash for an indexer-sourced release (`clients/indexer/client.ts` uppercases) and a lowercase one for a magnet; MySQL's collation hides the difference on the DB side, qBittorrent's API does not. | `/torrents/files` answers 404 for a hash that exists, the field degrades to `null` (REQ-2), and the feature quietly does nothing for exactly the sources that came from the indexer — the common case. | `api` lowercases the hash before the request, and the service spec pins it with an uppercase-hash case. |
| **A 404 read as an outage, or an outage read as "nothing downloaded"** | Both collapse into the same wrong answer if the client method returns `[]` on failure: REQ-7 then fails a scan that should have succeeded. | `QbittorrentClient.files()` throws `TorrentClientError` on any non-2xx and never returns `[]` for an error; `MediaSourcesService` maps *any* throw to `null` and logs. Covered by a spec case per branch. |
| **Field threaded into the query but not into the worker's local type (or the reverse)** — the standing hazard of a hand-retyped contract with no codegen. | `downloadedFiles` arrives `undefined`, `markDownloaded` reads it as "no information", narrowing silently never happens, and the bug persists with a green test suite. | `mark-downloaded.ts` distinguishes `null` from `undefined` is *not* a defence — instead the worker's local type declares the field required-and-nullable (`string[] \| null`), so omitting it from the type fails the typecheck, and the handler logs one line per scan naming whether narrowing was applied. AC-1 and AC-6 read that line. |
| **`handleSourceReady` has no spec** and gains its first branch. | A wiring mistake in the handler (wrong order, flag not attached to the reported files) produces a correct-looking scan that reports `isDownloaded: true` for everything. | Accepted, not solved: the two rules it composes are covered as pure functions, and AC-2 (`has_unmatched_files = 0` with a deselected file present) cannot pass unless the flag was actually threaded through to `sourceScanned`. Writing the first spec for that handler is deliberately out of this feature's scope. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/npm worker run build
```

`worker` is expected to keep its two pre-existing, unrelated failures (`ffmpeg/2.json`'s stale
track-title string and `buildCommand.spec.ts`'s CRF mismatch, both recorded in the root `CLAUDE.md`
§ Current state). Anything beyond those two is this feature's.

Manual pass, in order:

1. Add a torrent with two same-sized video files to a film or episode; in qBittorrent set the second
   to *Do not download*; let it finish. Watch `docker compose logs -f worker` for
   `[source-ready] <id>:` — it must report both files, one match, and the line naming how many files
   the torrent client reported as downloaded (AC-1, AC-2).
2. `bin/mysql -e 'select id, file_path from source_files order by id desc limit 2'` — the selected
   file is the one left enabled in qBittorrent.
3. `bin/mysql -e 'select id, status, has_unmatched_files, error_key from media_sources order by id desc limit 1'`
   — `SCANNED`, `0`, `NULL` (AC-2).
4. Let the encode finish; confirm the download folder under the downloads root is gone, placeholder
   included (AC-3).
5. Repeat with **every** video file deselected: the source must end `ERROR` with
   `error_key = 'error.source.scan_no_downloaded_video'`, no `process_jobs` row, and no
   `error.encode.probe_failed` anywhere in the worker log (AC-4).
6. `docker compose stop torrent`, then re-run a scan (`bin/cli api …` re-enqueue, or a fresh
   download completed before stopping): the job completes, the source reaches `SCANNED`, and one log
   line says the downloaded-file list could not be resolved (AC-5). `docker compose start torrent`
   afterwards.
7. Import a film through the tus upload modal and confirm its scan behaves exactly as before, with
   every reported file flagged downloaded (AC-6).

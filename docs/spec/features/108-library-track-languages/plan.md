---
title: Library Track Languages — Implementation Plan
spec_version: 0.1.1
last_updated: 2026-10-27
status: Approved
---

# PLAN: Library Track Languages (`plan.md`)

## Approach

A new read-only worker job, `library-probe`, reads one library file and reports its languages; `api`
stores them on `Movie`/`Episode` and exposes two nullable fields; `web` renders them. The shape
copies `107`'s `subtitle-probe` end to end (a BullMQ queue `api` produces and the worker consumes, a
service-only details query, a service-only report mutation), minus everything that made `107`'s
probe stateful: there is no row tracking a read in flight, no start report and no failure report
(spec NFR-3, NFR-4). A read is identified by its title, not by a search id.

What is reused rather than rewritten:

- **The pure units of `107`.** The worker's `src/subtitles/embedded-languages.ts` (embedded,
  non-forced, `normalizeIso3`, `und` dropped) and `src/subtitles/sidecars.ts` (exact `<base>.`
  prefix, `forced`/`foreign` dropped) are called as they are. `api`'s
  `src/subtitle-search/sidecar-languages.ts` (`resolveSidecarLanguages`) resolves the raw tags against
  the `Language` table, exactly as `subtitleProbeCompleted` does. Only audio is new: one small pure
  unit beside them.
- **`107`'s path resolution for a title with no `filePath`.** `SubtitleSearchRequestService`'s private
  `resolveLibraryPath` (media-server client → `findByTmdbId` → `mediaHostPath` →
  `hostToContainerPath`) is extracted into one shared provider that both features call. It returns an
  outcome instead of throwing `error.subtitleSearch.*` keys, and each caller maps the outcome to its
  own keys. A second copy of that chain is the specific thing this plan exists to prevent.
- **The existing trigger points.** Every place REQ-3 names already exists and already notifies
  something: `ProcessJobsService.encodeCompleted` (beside `mediaServer.notifyCreated` and `103`'s
  `requestFor`), `SubtitleEmbedService.completed` (beside `notifyMediaServer`),
  `MediaServerReconcileService.reconcileMovie`/`reconcileShow`/`syncMovie`/`syncShow` (beside their
  guarded `updateMany`s). Each gains one fire-and-forget `request(target)` call.
- **The queue idiom.** `SubtitleSearchQueueService`'s `removeOnComplete`/`removeOnFail` plus a
  per-title `jobId` gives REQ-3's "never more than one queued" for free, and is also what keeps a
  *later* request from being swallowed (see Risks).
- **`web`'s existing surfaces.** `Movie.tsx`'s poster column, `SeasonAccordion.tsx`'s episode table
  and `SearchSubtitlesButton` are extended in place; the box style is the header search box's
  (`src/layout/AppHeader.tsx`), and the icons come from `lucide-react`, already a dependency.

The alternative considered and rejected: widening `107`'s `subtitle-probe` to also report audio and
writing the inventory from `subtitleProbeCompleted`. It would only cover titles someone searched
subtitles for, it computes an OpenSubtitles hash every library file does not need, and it would tie
the inventory's lifecycle to a search row (spec § Out of Scope).

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration, the queue payload type, the two service-only operations, the two new fields and every trigger. |
| 2 | `worker` | Consumes `library-probe` and calls the two operations. |
| 3 | `web` | Reads the two new fields; moves `106`'s button into the new column. |
| 4 | `[docs]` | `docs/spec/graphql-contract.md` gains a `108` section (the fifth queue contract); root, `api`, `worker` and `web` `CLAUDE.md`; `docs/spec/history.md`. |

**Parallel:** `worker` and `web` may start as soon as this plan is approved: both build against the
frozen SDL in `spec.md` and neither reads anything `api` will improvise. `api` must land first in the
merge order: a worker calling `libraryProbeDetails` against an `api` without it gets a GraphQL
validation error, logs it and reads nothing, and `web` querying `fileAudioLanguages` against an old
`api` fails the whole film page query.

## Contract Freeze

`spec.md` § GraphQL Contract Delta is frozen as of `status: Approved` (0.1.1). Things an implementer
will want to change and must not:

- **`fileAudioLanguages` / `fileSubtitleLanguages`, not `audioLanguages` / `subtitleLanguages`.**
  `Movie.audioLanguages` already exists and means the caller's preferred languages (`039`); reusing
  the name on `Episode` would also make the two types disagree.
- **Nullable lists, `null` ≠ `[]`.** `null` is "never read" (the boxes are hidden), `[]` is "read,
  nothing there" (`—`). Collapsing either way makes `web` lie.
- **No `libraryProbeStarted` / `libraryProbeFailed`.** A failed read changes nothing (NFR-3), so
  there is nothing to report. Do not add a row or a mutation to make failures visible.
- **`libraryProbeCompleted` carries the `filePath` it read.** It is how `api` discards a report
  about a file that has since been replaced (REQ-5); the worker must echo the exact string
  `libraryProbeDetails` returned.
- **One queue job per title, keyed by title.** The job id is `library-probe-movie-<id>` /
  `library-probe-episode-<id>`. Keying by anything else (a timestamp, a path) breaks REQ-3's
  de-duplication.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, and re-brief every
service in `services:`.

## Migrations

One migration, `api`-owned, `<timestamp>_108_library_track_languages`:

1. `movies` and `episodes`: add `fileAudioLanguages JSON NULL`, `fileSubtitleLanguages JSON NULL`,
   `tracksReadAt DATETIME(3) NULL`.

No data step. Every existing row reads `null` ("never read") and the UI hides its boxes until the
one-time pass of REQ-3.4 reaches it. That pass is not SQL: it is `api` code that runs on every boot
and enqueues a read for every title with a file and `tracksReadAt IS NULL`, so a title whose read
failed is retried on the next boot and a title already read is never re-queued by it.

Reversibility: dropping three nullable columns loses only derived data, re-readable from the files.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| BullMQ keeps a finished job under its id | Every later `request()` for that title is a silent no-op: a film read once is never re-read after an embed or a replacement, and its chips go stale with no error anywhere | `removeOnComplete: true`, `removeOnFail: true` on the add, as `SubtitleSearchQueueService` does; an `api` test asserts the options, and AC-5 checks a second read live |
| A report about a replaced file | The old file's languages overwrite the new one's | The report echoes `filePath`; `api` writes through an `updateMany` whose `where` requires that the title's current `filePath` still equals it (or, for a media-server-only title, that `filePath` is still null and `mediaServerPresentAt` still set); a miss returns `false` |
| The media-server path resolves wrong (host ↔ container mapping) | `libraryProbeDetails` answers `not_found`, the worker abandons silently, the title never gets boxes | The resolution is the exact chain `107`'s manual search already exercises (AC-13 there); AC-2/AC-3 here check it live for Jellyfin and Plex |
| The one-time pass on a large library | Thousands of jobs; a boot that waits on them, or an encode that queues behind them | The pass is detached from boot (`void` + catch), only enqueues, and the reads have their own queue at concurrency 1 (NFR-2); AC-10 |
| A demotion that forgets the new columns | A title that lost its file keeps showing chips | `syncMovie`/`syncShow`'s demotion `updateMany` clears the three columns in the same `data` as `filePath`/`mediaServerPresentAt`; a test fails if they are dropped from it |
| Reading a file while it is being replaced by an embed's rename | `ffprobe` reads the old or the new inode, both valid | Harmless: the embed's completion queues a fresh read after the rename |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
bin/comments api
git diff services/api/src/schema.gql          # exactly spec.md § GraphQL Contract Delta
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/comments worker
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments web
```

Manual pass (the dev stack up, media server configured):

1. After the first boot on the migration, `bin/mysql -e "select count(*) from movies where tracksReadAt is null and (filePath is not null or mediaServerPresentAt is not null)"` drains to 0 within minutes; `/` loads normally meanwhile (AC-10).
2. A film delivered with English audio and English + Spanish subtitles shows `ENG` / `ENG SPA` under the poster (AC-1). `ls -la --time-style=full-iso` of its folder before and after the read is identical (AC-11).
3. Add a film Jellyfin already holds: the boxes appear within a minute (AC-2). Same with Plex (AC-3).
4. Drop `<base>.es.srt` beside a film with no embedded Spanish, Refresh: `SPA` once; a lone `<base>.es.forced.srt` adds nothing (AC-4).
5. Run a `107` search that embeds Spanish: reload, `SPA` appears with no Refresh (AC-5).
6. A series: the new column shows audio, subtitles and the "Buscar subtítulos" button, which is gone from where it was (AC-6).
7. Media server `none`, a film with no `filePath`: no boxes, no read in either log (AC-7).
8. `chmod 000` a film's file, Refresh: boxes unchanged, worker log names title and path (AC-8). Delete a film's file outside Perceptor, Refresh: `MISSING`, boxes gone (AC-9).
9. A file with an `und` audio track and a `fra` one shows `FRE` only (AC-12).

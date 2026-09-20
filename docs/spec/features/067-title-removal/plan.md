---
title: Title Removal — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-09-20
status: Approved
---

# PLAN: Title Removal (`plan.md`)

## Approach

The feature is two mutations and a dialog, and almost all of its risk lives in one decision: who
owns the unwind of a title's in-flight pipeline. The answer is **`DownloadsService`, not
`MoviesService`/`ShowsService`** — `services/api/src/downloads/downloads.service.ts` already holds
the whole of `047-source-deletion` (torrent client first, then `encodeQueue.publishCancel` +
`removeEncode` per job, then `queue.removeSourceReady`, then `deleteResidue`, then the row), and
that ordering *is* the safety guarantee. Reimplementing it inside the two title services would give
the repository a second, subtly different unwind, which is exactly what Article X forbids and the
kind of divergence that fails silently: a missed `publishCancel` leaves an encode writing into a
folder nobody will ever read.

So `downloadDelete`'s body is split. The per-source steps become a private
`unwindSource(source, jobs)`; `downloadDelete` keeps its `findOwnedSource` + single-source shape and
calls it, behaviour unchanged. A new public `unwindSourcesForTitle(scope)` — where `scope` is
`{ movieId }` or `{ showId }` — loads every `MediaSource` reachable from the title (for a series:
across its seasons and their episodes, three nullable FKs, `movieId`/`seasonId`/`episodeId`, all
already indexed or reachable through `season.showId`), removes **every** torrent in **one**
`qbittorrent.remove(hashes[], true)` call, and only then runs the per-source steps.

That single batched call is the load-bearing detail for NFR-2. `QbittorrentClient.remove()`
(`services/api/src/clients/torrent/client.ts:279`) already takes `string | string[]` and
`normalizeHashes` joins them — so a title with five torrents is one HTTP request, one failure point,
and a rejection aborts before anything on disk or in the database has moved. Looping
`downloadDelete` per source (the obvious shortcut) would have given N failure points with N-1
torrents already gone; it was rejected for that reason alone.

`recomputeStatus` is deliberately **not** called on the title path. `047` recomputes because the
target survives its source; here the target is about to be deleted, so recomputing it is a write to
a row that will not exist a moment later. For the shared-title case (REQ-3) nothing is unwound at
all, so nothing needs recomputing either.

Everything above only runs on the last-owner branch. The branch itself is a count, and it is the
same count the new `Movie.otherOwners`/`Show.otherOwners` `@ResolveField`s expose: `prisma.userMovie
.count({ where: { movieId, userId: { not: userId } } })`. When it is greater than zero the mutation
is a single `prisma.userMovie.delete(...)` on the composite key and returns
`{ deleted: false, remainingOwners: n }` — the per-title language rows go with it through the
cascade already declared on `UserMovieLanguage.userMovie`, which is why REQ-3's "preferences go too"
costs no code.

On the `web` side there is a finished template for this dialog:
`services/web/src/components/downloads/DeleteDownloadModal.tsx`. It already does error-in-dialog,
clear-on-reopen, pending state, `variant="danger"`, and a conditional second paragraph
(`download.status === "ENCODING"`). The new `RemoveTitleModal` is that component with a different
action and a different conditional — not a new pattern.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the two mutations, the `TitleRemoval` type, the two `otherOwners` fields and the `DownloadsService` refactor. `web` cannot select a field the schema does not have, and cannot phrase the dialog without `otherOwners`. |
| 2 | `web` | Consumes the frozen contract: the two detail pages, the shared modal, the two server actions, and the two missing message-catalog keys (REQ-13). |

**No step runs in parallel.** The `web` slice depends on `otherOwners` existing to render its own
primary requirement (REQ-7), so starting it before `api` lands means guessing at the one thing this
feature's UI is about. `worker` is not in `services:` and gets no directory (NFR-4).

Inside step 1 the `DownloadsService` refactor must come **before** the two title services call it:
`unwindSource`/`unwindSourcesForTitle` are the seam, and `downloadDelete`'s existing suite
(`downloads.service.spec.ts:742`) is the regression net that proves extracting them changed nothing.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Three things an
implementer will be tempted to change:

- **`removeMovie` and `removeShow` are two mutations, not one `removeMedia(type:, id:)`.** From
  inside `api` the two bodies look near-identical and the merge looks like Article X. It is not:
  `006-media-search` § Out of Scope keeps `movies`/`shows` deliberately separate, the two refusals
  are different keys (`error.movie.not_found` vs `error.show.not_available`), and the series branch
  has to reach sources through two extra levels that the film branch does not have.
- **`TitleRemoval` is an object, not a `Boolean!`.** `web` needs `deleted` to pick the success copy,
  and `remainingOwners` to report it. Collapsing it to a boolean to match `downloadDelete` would
  force `web` to re-query to find out what just happened.
- **`otherOwners` is a `@ResolveField`, not a column and not part of any listing.** It must not be
  added to the `movies`/`shows` list queries: that is a per-row count across the whole library and
  exactly the N+1 the `@ResolveField` comments in `movies.resolver.ts:27` warn about. Only the two
  detail pages select it.

If the contract turns out wrong: stop, amend `spec.md`, re-approve, re-brief both services. Never
patch it from inside one slice (Article VIII).

## Migrations

**None.**

Every cascade this feature relies on is already declared in
`services/api/prisma/schema.prisma`: `UserMovie.movie` / `UserShow.show`, `Season.show`,
`Episode.season`, `MediaSource.movie`/`.season`/`.episode`, `SourceFile.mediaSource`,
`ProcessJob.sourceFile`, and `UserMovieLanguage.userMovie` / `UserShowLanguage.userShow`.
`FfprobeLog` and `MediaServerItem` carry no relation to any media row by design, which is what
satisfies REQ-9 with no code at all.

`git status --short services/api/prisma` must be **empty** when this feature closes. A migration
appearing there means someone solved a problem the schema had already solved.

Reversibility: not applicable — nothing to roll back. The removals themselves are irreversible by
nature, which is why REQ-7 exists.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The `downloadDelete` refactor drops a step (most likely `publishCancel`, the only one with no visible effect from `api`) | Nothing errors. The title row is gone, the worker keeps encoding into a `.working.mkv` for a `ProcessJob` that no longer exists, and only reports on completion — into `error.processJob.not_found`. | `downloads.service.spec.ts:742`'s existing assertions run unchanged against the extracted `unwindSource`; the title-scoped suite asserts the same call set for a multi-source title. AC-5 catches it live. |
| A series' sources are collected incompletely — the season-pack sources hang off `Season`, the per-episode ones off `Episode`, and it is easy to query only one | No error: the title deletes, the missed torrent keeps seeding forever in qBittorrent with its folder on disk, invisible to Perceptor because the row that named it is gone. | A dedicated test fixture with all three shapes at once (film-style `movieId`, a `seasonId` pack and an `episodeId` single) asserting every hash reaches the single `remove()` call. AC-3 plus a qBittorrent check in the manual pass. |
| Partial torrent removal when the client fails mid-way | Not possible with the batched call, and that is the whole reason for it. A per-source loop would fail here silently in the worst way: some torrents gone, the title still listed, and a retry that cannot tell which. | One `qbittorrent.remove(hashes, true)` before any other step; AC-6 asserts the whole state is untouched after a rejection. |
| `otherOwners` read at render, acted on at confirm | Another user registers the same title in between; the dialog promised "se elimina de Perceptor" and the mutation correctly only drops the reference. | Advisory-by-contract (spec § GraphQL Contract Delta): `web` reports the outcome from `TitleRemoval`, never from the value it rendered with. No lock, no re-check — the mutation is already right. |
| `deleteResidue` throwing on one source aborts the rest | A title with three sources deletes one folder and keeps two, then fails the mutation, leaving rows for torrents already removed from the client. | NFR-3: residue deletion never throws — `deleteResidue` already swallows and logs (`downloads.service.ts:706`), and the title path must keep that posture per source, not wrap the loop in a single try. |
| The two `errors.movie.not_found` / `errors.show.not_available` catalog keys are added to `en.json` only | `check-messages.mjs` catches drift, but a key added to *neither* file still silently renders `api`'s English — which is the bug REQ-13 exists to fix, so an incomplete fix looks identical to no fix. | AC-16 checks the rendered Spanish string specifically, not just that the script passes. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
git status --short services/api/prisma
git diff --stat services/worker
```

The last two must print nothing (NFR-1, NFR-4). `schema.gql` must diff to exactly `TitleRemoval`,
`removeMovie`, `removeShow` and the two `otherOwners` fields — anything else is an unreported
contract change (Article VIII's Check).

The manual pass, against a running stack with two users (A and B):

1. Register a film as both A and B. On A's `/movies/<id>`, the remove dialog says the reference will
   be dropped. Confirm: A's `/movies` no longer lists it, B's still does (AC-2, AC-15).
   `bin/mysql -e 'select count(*) from user_movies where movie_id = <id>'` returns 1, and
   `select count(*) from user_movie_languages where user_id = "<A>" and movie_id = <id>` returns 0
   (AC-12).
2. As B, reopen the same film: the dialog now says it will be deleted from Perceptor (AC-17).
3. Register a film as A only, add a magnet, let it reach `DOWNLOADING`. Remove it: the torrent is
   gone from qBittorrent's UI, its folder under `HOST_DOWNLOADS_DIR` is gone, `select count(*) from
   movies where id = <id>` returns 0 (AC-1, AC-4).
4. Same, but let it reach `ENCODING` first. `docker compose logs -f worker` shows the FFmpeg process
   terminated by cancellation and no outcome reported (AC-5).
5. Take a `COMPLETED` film, note its `filePath` and that file's mtime under `HOST_DESTINATIONS_DIR`.
   Remove it. `ls -l --time-style=full-iso` on that path shows the same file, same mtime (AC-9,
   Article XII). Search and register the same title again: it appears with status `MISSING` and a
   new id (AC-8, AC-10).
6. `docker compose stop torrent`, then remove a film with a live torrent: the dialog shows the
   translated `torrent_client_rejected` message, the film is still listed, and
   `select count(*) from media_sources where movie_id = <id>` is unchanged (AC-6). `docker compose
   start torrent`, confirm again, and it succeeds.
7. As B, call `removeMovie` with A's film id through the GraphQL endpoint: `error.movie.not_found`,
   rendered in Spanish with `uiLocale = es` (AC-7, AC-16). Call it again on an id already removed:
   same refusal, no 500 in `docker compose logs api` (AC-8, NFR-5).
8. Register a series as A only with a season pack in flight and a single-episode torrent in flight.
   Remove the series: both torrents gone from qBittorrent, `select count(*) from seasons where
   show_id = <id>` and the episode count both 0 (AC-3), and
   `select count(*) from ffprobe_logs` is unchanged from before the removal (AC-11).
9. Set `shows_enabled` to false in Settings, call `removeShow`: `error.media.type_disabled`, the
   series row unchanged (AC-13).

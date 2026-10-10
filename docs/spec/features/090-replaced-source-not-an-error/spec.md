---
title: A Replaced Source Is Not An Error
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-08
last_updated: 2026-10-08
status: Implemented
services: [api, web]
---

# SPEC: A Replaced Source Is Not An Error (`spec.md`)

## Context & Goal

A user downloads a season pack, it scans, it encodes, the file lands in the library and the title
reads `COMPLETED`. Then they watch it and the picture is green — a bad encode, a bad release, it
does not matter. They search again, find another release and attach it with `force`. The pipeline
does the right thing: the old delivered source steps aside so the new one can win the race. What it
does *wrong* is how it records that: `DownloadsService.demoteDeliveredSources`
(`services/api/src/downloads/downloads.service.ts`) writes the old row `status: 'ERROR'` with
`errorKey: 'error.source.replaced'`. In `/downloads` that row turns into a red `ERROR` badge under
a red error line, and it is counted by the panel's `Error` filter chip. Nothing failed. The download
finished, encoded, and delivered a file the user actually watched. Being superseded by a newer
release is a fact about that source's *relationship to its target*, not about how it ended.

The reason the demotion reaches for `ERROR` is that `ERROR` is the only value in `SourceStatus` that
every "is this source still in play?" test already excludes. There are two such tests that matter
here, both in `services/api/src/pipeline-status/pipeline-status.ts`: `isRaceWinner`, which decides
whether a sibling has already won and therefore whether a newly completed source is declared
`SUPERSEDED`, and `isDeliveredSource`, which backs `087`'s `force` guard. Both read a `SCANNED`
source with completed jobs as live. Writing `ERROR` is how the demotion takes the old row out of
their way. The giveaway is the comment at `resolveRace` in the same downloads service, which has to
explain that a source "already `ERROR` (`027`'s force demotion) is not a legitimate race winner" —
a value that means *failed* being read, everywhere it matters, as *out of play*. One column is
carrying two unrelated questions.

This feature separates them. `MediaSource` gains a `retiredAt` timestamp: the source's `status`
column is left exactly as it was, so a delivered-then-replaced source stays `SCANNED` and
`deriveSourceStatus`'s existing Rule 2 keeps deriving it as `COMPLETED` with no change to the
eight-value vocabulary. `isRaceWinner` and `isDeliveredSource` stop asking about `ERROR` and start
asking about `retiredAt`, which is the question they were always asking. In `web` the row keeps its
green `COMPLETED` badge, moves out of the `Error` chip into `Completed`, loses the red error line
and gains a neutral "Reemplazada" mark. No pipeline stage in the root `CLAUDE.md` changes behaviour;
the Download stage changes only what it records about a source it was already stepping aside.

Retirement applies to a **delivered** source and only to one — `087`'s `isDeliveredSource` is the
exact test. A source replaced *before* it delivered anything (the upload path's
`UploadsService.demoteSupersededSources` also demotes a `READY` sibling, or one still mid-encode
whose jobs it cancels) genuinely never finished, and calling that `COMPLETED` would be a worse lie
than calling it an error. Those rows keep today's behaviour untouched, and so do `deriveResume`'s
`REPLACED` stage and the `error.download.retry_replaced` refusal that serves them.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Retirement, not failure)**: Replacing a *delivered* source must record it as retired
      at a point in time, leaving its `status` column unchanged. It must not write `ERROR`, and must
      not write `errorKey`, `errorMessage` or `errorParams` for the replacement.
- [ ] **REQ-2 (Reads COMPLETED)**: A retired delivered source must report the normalized status
      `COMPLETED`, carry no `lastError`, and be `retryable: false` — the same as any other source
      whose jobs all completed.
- [ ] **REQ-3 (Out of play)**: A retired source must never count as a race winner and never count as
      a delivered source. Attaching a replacement to a title whose previous source was retired must
      let the new source win its race and reach the library; it must never be declared `SUPERSEDED`
      and the title must never stall with no error anywhere.
- [ ] **REQ-4 (Scope of retirement)**: Exactly the sources that are *delivered* at the moment of
      replacement are retired. A source replaced before delivering — `READY`, or `SCANNED` with an
      encode still running — keeps today's `ERROR` / `error.source.replaced` outcome on both the
      source and its cancelled jobs, on every path that replaces one.
- [ ] **REQ-5 (No live controls)**: A retired source is history, not a running download. It must not
      be startable — `downloadStart` must refuse it — and `web` must offer neither the start nor the
      stop control for it. Deleting it by hand stays available and unchanged, and remains the way to
      remove whatever the torrent client still holds for it.
- [ ] **REQ-6 (Re-attachable)**: Re-adding the same `infoHash` to the same target after its source
      was retired must reactivate that row — the `060` behaviour it has today while the row is
      `ERROR` — rather than becoming a silent no-op.
- [ ] **REQ-7 (Visible as replaced)**: `web` must mark a retired row as replaced, distinctly from
      both an ordinary completed row and an errored one, in `/downloads` and in a title's own
      download list. The mark is neutral in tone — it is not a failure and must not read as one.
- [ ] **REQ-8 (Counted as completed)**: A retired row must fall into the `/downloads` panel's
      `Completed` filter bucket and out of `Error`. The `Error` chip must count only sources that
      actually failed.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Backfill)**: Existing rows already written `ERROR` / `error.source.replaced` must be
      corrected in the migration, not left as a second class of row that renders differently from a
      replacement made after this ships. A row is corrected when, and only when, it is delivered by
      `087`'s test evaluated over its stored jobs — at least one `COMPLETED` job and none still
      `WAITING`/`QUEUED`/`ENCODING`. A corrected row is restored to `SCANNED`, has its replacement
      `errorKey`/`errorMessage`/`errorParams` cleared and is marked retired as of its last update.
      Every other `error.source.replaced` row is left exactly as it is.
- [ ] **NFR-2 (No status recomputation)**: The migration must not change any `Movie`, `Episode` or
      `Show` status. A delivered source's target already reads `COMPLETED` off its `filePath`
      (`089`), and the correction above cannot change what `deriveTitleStatus` returns — it skips
      both `ERROR` and `SCANNED` sources.
- [ ] **NFR-3 (One way back, and only one)**: Nothing un-retires a source except REQ-6's
      reactivation, which is a deliberate re-acquisition of that exact row by the user. Reactivating
      must clear `retiredAt` in the same write that makes the row live again — a row left retired
      while live would be excluded from its own race and stall the title with no error anywhere.
      No other path, scheduled or manual, un-retires anything.

## GraphQL Contract Delta

```graphql
type Download {
  # ...unchanged fields...
  lastError: DownloadError
  retryable: Boolean!
  retiredAt: DateTime        # non-null when this source was replaced by a newer one after
                             # delivering its file. The row still reads status "COMPLETED":
                             # this is why it is no longer live, not a failure. `web` renders a
                             # neutral "replaced" mark and suppresses the row's start control.
  readAt: DateTime!
}
```

`Download.status` gains no new value — a retired row reports `COMPLETED`, which `web` already
knows. `web`'s `statusTone` and the `/downloads` panel's bucketing both key off `status` and
therefore need no change to satisfy REQ-8; `retiredAt` only adds the mark and removes the control.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `downloadStart` on a source with `retiredAt` set | `ConflictException` (409), `extensions.i18n.key = error.download.retry_replaced` | `Este medio fue reemplazado por otro y no se puede retomar` |

The key is the existing `error.download.retry_replaced`, already in both catalogs with exactly this
copy, and `409` is the status its only other producer already uses
(`DownloadsService.resumeErroredSource`) — no new error key and no second status for one key. `web` already lists it in `DownloadRow`'s `REFRESH_ON_KEYS`,
so a row that goes stale between render and click refreshes itself; that behaviour is unchanged and
is the fallback if the control is ever shown when it should not be.

The "replaced" mark itself is **not** an error and must not travel as one. It is `web`-side copy
keyed off `retiredAt`, a new catalog entry in `messages/{en,es}.json` — `Replaced` / `Reemplazada` —
not a message produced by `api`.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `MediaSource` | `+ retiredAt DateTime?` — set when a delivered source is replaced by a newer one; null for every live or failed source | nullable, no default | Yes — NFR-1 |

No enum changes. `SourceStatus` is untouched, deliberately: the whole point is that a replaced
source's *status* was never the thing that was wrong.

## Acceptance Criteria

- [x] **AC-1**: Given a film whose source is `SCANNED` with all jobs `COMPLETED` and whose
      `filePath` is set, when a new torrent is attached with `force: true`, then the old row renders
      in `/downloads` with a green `COMPLETED` badge and a neutral "Reemplazada" mark, with no red
      error line.
- [x] **AC-2**: In the same state, the `/downloads` panel's `Error` chip counts `0` and the
      `Completed` chip counts the old row. Reproduces the reported case directly: a season pack
      replaced after a bad encode must not leave `Error 1` on the panel.
- [x] **AC-3** *(failure path — the regression this must not cause)*: In the same state, when the
      replacement torrent reaches 100% and reports completion, then it is **not** written
      `error.source.superseded`, its scan is enqueued, it encodes, and the title ends `COMPLETED`
      with the new file. `SELECT status, errorKey FROM media_sources WHERE id = <new>` shows
      `SCANNED` and `NULL`.
- [x] **AC-4** *(failure path)*: Calling `downloadStart` on a retired source returns a
      `ConflictException` (409) carrying `error.download.retry_replaced`, and writes nothing. The
      row's start and stop controls are both absent in `web`.
- [x] **AC-5** *(failure path)*: Given a source still `ENCODING` when an upload replaces it, then it
      is still written `ERROR` / `error.source.replaced`, its running job is still cancelled, it
      still renders red, and `retiredAt` stays null — REQ-4's boundary holds.
- [x] **AC-6**: After `bin/cli api npx prisma migrate deploy` on a database holding both kinds of
      pre-existing `error.source.replaced` row, the delivered ones read `SCANNED`, `retiredAt`
      non-null, `errorKey` null; the undelivered ones are byte-for-byte unchanged.
      `bin/mysql -e "SELECT status, errorKey, retiredAt FROM media_sources WHERE errorKey = 'error.source.replaced' OR retiredAt IS NOT NULL"` shows the split.
- [x] **AC-7**: Re-adding the exact `infoHash` of a retired source to the same target reactivates
      that row rather than answering with a no-op, and leaves it with `retiredAt` null — then that
      same source completes and reaches the library, proving NFR-3's clearing is real.
- [x] **AC-8**: `bin/npm api run test` and `bin/npm web run test` pass; `bin/comments api` and
      `bin/comments web` pass.

## Out of Scope

- **The race losers, and the disk they leak.** When one of several sources for a title wins,
  `resolveRace` stops the siblings in the torrent client and writes them `PAUSED`, leaving
  half-downloaded rows in `/downloads` and their bytes in the downloads root forever. The intended
  end state is that they are unwound and removed, leaving one completed source — but that is a
  cleanup and disk-reclamation feature with its own `047`-shaped unwind, not a status question, and
  it does not touch the reported case. Its own spec.
- **`error.source.superseded` (`087`).** The same family of "not really an error", but it marks a
  source that lost the race *without delivering anything*. It belongs with the cleanup above, which
  would delete those rows outright rather than retire them — marking them retired here would be
  work that spec immediately undoes.
- **`deriveResume`'s `REPLACED` stage and `error.download.retry_replaced` as a resume refusal.**
  Both stay, because REQ-4 keeps undelivered replaced sources on the `ERROR` path that produces
  them.
- **A reason for retirement.** `retiredAt` records *when*, not *why*, because today there is exactly
  one way to be retired. If the cleanup spec above ever retires a source for a second reason rather
  than deleting it, that is when a reason column earns its place.
- **The dead job-closing branch in `demoteDeliveredSources`.** That function closes active
  `ProcessJob`s for the sources it demotes, but it only ever selects sources `isDeliveredSource`
  accepts, and that test already requires no active job — so the branch can never close one. Noted
  while mapping the territory; removing it is a tidy-up, not this feature.

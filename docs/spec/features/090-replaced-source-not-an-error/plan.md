---
title: A Replaced Source Is Not An Error — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-08
status: Approved
---

# PLAN: A Replaced Source Is Not An Error (`plan.md`)

## Approach

The whole feature is the separation of one overloaded column into two, and the plan's shape follows
from where that column is actually read. `MediaSource.status` answers *how did this source end*;
`MediaSource.retiredAt` answers *is this source still in play*. Today the second question is asked
by writing `ERROR` into the first.

The reach is far smaller than the symptom suggests, and that is the point of doing it this way
rather than adding a `SourceStatus` value. Leaving `status` as `SCANNED` means
`deriveSourceStatus`'s Rule 2 in `services/api/src/pipeline-status/pipeline-status.ts` already
derives `COMPLETED` for a retired row with no change at all, so the eight-value vocabulary, `web`'s
`statusTone` (`services/web/src/lib/status-tone.ts`) and the `/downloads` panel's bucketing in
`DownloadsPanel.tsx` all satisfy REQ-2 and REQ-8 without being touched. A new enum member would
have meant auditing every `status === 'ERROR'` comparison in `api` and `worker` with no codegen to
catch a miss — the `083`-class risk this repository cannot absorb cheaply.

Four reads need to change, and `087` already concentrated three of them:

- `isRaceWinner` and `isDeliveredSource` (`pipeline-status.ts`) gain the retirement check. These
  are the two functions the `ERROR` write existed to fool.
- `DownloadsService.hasDeliveredSource` and `DownloadsService.demoteDeliveredSources`
  (`services/api/src/downloads/downloads.service.ts`) are the **only** two entry points for the
  `087` force guard and the demotion — eight call sites across `movies`, `episodes`, `seasons`,
  `uploads` and `acquisition` go through them. Adding `retiredAt: null` to their Prisma `where`
  covers all eight without any of those modules being edited. Reuse this; do not add a per-module
  filter.
- `AttachSourceService` (`services/api/src/acquisition/attach-source.service.ts`) owns both the
  `060` reactivation test and the reactivation write, so REQ-6 and NFR-3's clearing are one file.

`UploadsService.demoteSupersededSources` is the one place that genuinely splits in two, because it
is the only replacement path that demotes sources which never delivered (`READY`, or `SCANNED` with
a live encode it cancels). REQ-4 keeps those on today's `ERROR` path untouched; its delivered subset
is delegated to `DownloadsService.demoteDeliveredSources` rather than growing a second retirement
writer beside it (Article X). After this, exactly one function in the codebase sets `retiredAt`.

In `web` the change is a field in one GraphQL fragment, one new catalog entry per locale, and two
conditions in `DownloadRow.tsx`. `DownloadErrorLine` is not touched: a retired row has no
`lastError` to render, so it simply stops being mounted.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration, the backfill and the `Download.retiredAt` field. `web` cannot select a field the schema does not have, and the whole behavioural change — REQ-1 through REQ-6 — lives here. |
| 2 | `web` | Consumes `retiredAt`. Purely presentational: the mark and the suppressed controls. |

**Nothing runs in parallel.** The `web` slice is small and depends entirely on a field `api`
introduces; starting it first means writing against a schema that does not answer. The contract is
frozen as of this plan, so `web` *may* begin once `api`'s entity and resolver land, without waiting
for the backfill — but the acceptance pass needs both.

## Contract Freeze

The `## GraphQL Contract Delta` in `../spec.md` is frozen as of `status: Approved`. Two things an
implementer will want to change and must not:

- **`Download.status` stays `COMPLETED` for a retired row; there is no ninth status value.** From
  inside `api` it will look cleaner to emit a distinct status string than to ship a parallel
  nullable field, and from inside `web` it will look cleaner to branch on one status than on
  `status` plus `retiredAt`. It is wrong for the feature as a whole: a ninth value lands in
  `statusTone`, `StatusBadge`, `PIPELINE_STATUSES`, the panel's bucket map and the `worker`'s
  tolerance for unknown statuses, none of which are in `services:`. The row *is* completed. Only
  its liveness changed.
- **`retiredAt` is a timestamp, not a boolean and not an enum.** "Why" is not recorded, because
  today there is exactly one way to be retired (`../spec.md` § Out of Scope). An implementer who
  adds a reason column is building for the race-loser cleanup spec, which has not been written and
  which intends to *delete* those rows rather than retire them.
- **The error key for a refused start is the existing `error.download.retry_replaced` at `409`.**
  Not a new key, and not `400`: `DownloadsService.resumeErroredSource` already throws exactly this
  key as a conflict, and one key answering with two statuses is a `web` bug waiting to happen.

If the contract turns out wrong: stop, amend `spec.md`, re-approve, re-brief both services. Never
patch it from inside a slice (Article VIII).

## Migrations

Owned by `api` (Article III), generated through `bin/npm api run prisma:migrate`.

1. **Add the column** — `MediaSource.retiredAt DateTime?`, nullable, no default. Nullable is not a
   convenience here: null *is* the meaningful value for every live and every failed source, and a
   non-null default would need a sentinel date that means nothing.
2. **Backfill (NFR-1)**, in the same migration, as SQL over the rows already written by the two
   demotion paths. The candidate set is `status = 'ERROR' AND errorKey = 'error.source.replaced'`.
   A candidate is corrected when, and only when, `087`'s delivered test holds over its stored jobs:
   it has at least one `ProcessJob` in `COMPLETED` through its `SourceFile`s, and none in
   `WAITING`/`QUEUED`/`ENCODING`. A corrected row is set to `status = 'SCANNED'`,
   `retiredAt = updatedAt`, and `errorKey`/`errorMessage`/`errorParams` to `NULL`. Every other
   candidate is left byte-for-byte alone — that is REQ-4's boundary applied retroactively.
   `updatedAt` is the right stamp because the demotion write is the last thing that touched those
   rows; it is approximate for a row edited since, and approximate is correct for a display-only
   timestamp.
3. **Verified by AC-6**, with the before/after `bin/mysql` query named there. Run it *before* the
   migration too and keep the row ids — a backfill that silently matches nothing looks identical to
   a backfill that worked.

**Reversibility.** Dropping the column is clean schema-wise and lossy behaviourally: the corrected
rows would come back as `SCANNED` with no error key and nothing marking them replaced, so they
would read as live delivered sources and the `087` force guard would start refusing replacements
for titles the user already replaced. A rollback therefore has to restore those rows to
`ERROR`/`error.source.replaced` as well. Say so in the migration directory, not only here.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `isRaceWinner` not taught about `retiredAt` | **The silent one.** The replacement downloads to 100%, `resolveRace` sees the retired `SCANNED` sibling as a winner, writes the *new* source `error.source.superseded` and stops its torrent. The title sits at `COMPLETED` on the old bad file, the user sees a red row they did not cause, and no log anywhere says the replacement was refused. This is exactly the stall class `087` closed, re-opened from the other side. | AC-3 is written as a failure-path criterion precisely for this. `pipeline-status.spec.ts` owes a case; `downloads.service.spec.ts` owes the `resolveRace` case. Both named in `api/plan.md`. |
| `retiredAt` left set on a reactivated row (REQ-6 / NFR-3) | Same stall, by a different door: the row goes live as `QUEUED` but is excluded from its own race forever. No error. | NFR-3 makes the clearing part of the reactivation write rather than a separate step; AC-7 carries the reactivated source all the way to the library rather than stopping at "the row is `QUEUED`". |
| `hasDeliveredSource` filtered but `demoteDeliveredSources` not, or vice versa | Half-applied: either the force guard keeps demanding confirmation for a title already replaced, or the demotion re-processes a row it already retired and the log count lies. Neither throws. | Both are adjacent in one file and are listed as one step in `api/plan.md`; the spec file covers both. |
| Backfill's delivered test written against `MediaSource` → `ProcessJob` directly | There is no direct relation — jobs hang off `SourceFile`. A join written from memory silently matches zero rows, the migration "succeeds", and every pre-existing replaced row stays red forever. | AC-6 asserts the split on real rows, and step 3 above requires capturing the candidate ids before migrating so "matched nothing" is distinguishable from "nothing to match". |
| `web` hides the controls but `api` does not refuse | The row looks inert, but a stale tab, a `router.refresh()` race or a direct call still starts a retired torrent. | REQ-5 puts the refusal in `api` and the hiding in `web`; AC-4 exercises the mutation directly, not the button. |

## Verification

```bash
bin/cli api npx tsc --noEmit
bin/npm api run test
bin/cli web npx tsc --noEmit
bin/npm web run test
bin/comments api
bin/comments web
bin/cli api npx prisma migrate status
```

Then the manual pass, which is AC-1 through AC-7 in order. The shortest route to the reported bug:

1. Pick a title already `COMPLETED` with a `SCANNED` source whose jobs all completed. Confirm the
   starting point: `bin/mysql -e "SELECT id, status, errorKey, retiredAt FROM media_sources WHERE movieId = <id>"`.
2. From the title's detail page, attach a different torrent and accept the replacement warning.
3. `/downloads` — the old row is green `COMPLETED` with the "Reemplazada" mark and no red line; the
   `Error` chip reads `0` and the row is inside the `Completed` filter (AC-1, AC-2).
4. The old row offers neither start nor stop, only delete (AC-4, UI half).
5. Let the replacement finish. It must scan, encode and land — `bin/mysql -e "SELECT id, status, errorKey FROM media_sources WHERE movieId = <id>"`
   shows the new row `SCANNED` with a null `errorKey`, never `error.source.superseded` (AC-3). This
   step is the one that cannot be skipped; it is the risk table's first row.
6. Re-add the retired row's own magnet to the same title: it reactivates with `retiredAt` null and
   runs to completion (AC-7).
7. The REQ-4 boundary (AC-5) needs a source killed mid-encode by an upload; if no live case is at
   hand it is covered by `uploads.service.spec.ts` rather than by hand.

---
title: A Replaced Source Is Not An Error — api slice
service: api
last_updated: 2026-10-08
status: Approved
---

# PLAN: A Replaced Source Is Not An Error — `api` (`api/plan.md`)

## Scope

`api` owns everything behavioural in this feature: the `retiredAt` column and its backfill, the two
`pipeline-status/` guards that decide whether a source is still in play, the two `downloads/` entry
points that read and write retirement, the split in the upload demotion path, the reactivation
clearing, the refusal on `downloadStart`, and the new `Download.retiredAt` field on the wire.

`api` does **not** decide how a retired row looks. There is no "replaced" message, label or copy
produced here: the mark is `web`-side copy keyed off `retiredAt`, and the only string `api` emits
for this feature is the existing `error.download.retry_replaced`. Do not add an error key, do not
set `errorMessage` on a retired row, and do not invent a ninth status value — `../spec.md` §
GraphQL Contract Delta and `../plan.md` § Contract Freeze are read-only.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` | Modified | `MediaSource.retiredAt DateTime?` |
| `prisma/migrations/<generated>/migration.sql` | New | The column plus the NFR-1 backfill |
| `src/pipeline-status/pipeline-status.ts` | Modified | `isRaceWinner` and `isDeliveredSource` take retirement into account; `ResumeSibling` carries it |
| `src/pipeline-status/pipeline-status.spec.ts` | Modified | The two guards' retirement cases |
| `src/downloads/downloads.service.ts` | Modified | `MediaSourceRow` gains the field; `hasDeliveredSource`/`demoteDeliveredSources` exclude and set it; `resolveRace` sibling read; `downloadStart` refusal; `toDownload` maps it |
| `src/downloads/downloads.service.spec.ts` | Modified | The `resolveRace` regression, the demotion write, the refusal |
| `src/downloads/entities/download.entity.ts` | Modified | `retiredAt` field |
| `src/acquisition/attach-source.service.ts` | Modified | `060` reactivation test and the clearing write |
| `src/uploads/uploads.service.ts` | Modified | `demoteSupersededSources` splits delivered from undelivered |
| `src/uploads/uploads.service.spec.ts` | Modified | REQ-4's boundary |

No new module. If this slice grows one, the plan missed something — stop and report.

## Existing code to reuse

- **`src/downloads/downloads.service.ts`'s `hasDeliveredSource` and `demoteDeliveredSources`** —
  `087` already made these the single read and the single write behind the force guard and the
  demotion, with eight callers across `movies/`, `episodes/`, `seasons/`, `uploads/` and
  `acquisition/`. Adding `retiredAt: null` to their Prisma `where` is how every one of those
  callers gets REQ-3 for free. Do not filter retirement in any of the eight.
- **`src/pipeline-status/pipeline-status.ts`'s `isDeliveredSource`** — it is already the exact
  definition of "delivered" the spec's REQ-4 and NFR-1 both name. Use it for the upload split and
  express the backfill's SQL as the same test; do not write a second notion of delivered.
- **`src/pipeline-status/pipeline-status.ts`'s `deriveSourceStatus` Rule 2** — a `SCANNED` source
  with all jobs `COMPLETED` already derives `COMPLETED`. REQ-2 needs **no** change here. If you find
  yourself editing `deriveSourceStatus`, re-read the approach: leaving `status` alone is the design.
- **`src/i18n/i18n-error.ts`'s `i18nError.conflict`** and the existing
  `ERROR_KEYS.DOWNLOAD_RETRY_REPLACED` — `resumeErroredSource` in the same service already throws
  this exact pair. The new refusal matches it; no new key, no new status code.
- **`DownloadsService.toDownload`** — the single projection every `Download` goes through
  (`downloads`, `movieDownloads`, `showDownloads`, `downloadStart`, `downloadStop`). Mapping
  `retiredAt` there covers all five.

## Steps

1. **Schema + migration.** Add `MediaSource.retiredAt DateTime?` to `prisma/schema.prisma`,
   generate with `bin/npm api run prisma:migrate`. Then write the NFR-1 backfill into the generated
   `migration.sql` — see `../plan.md` § Migrations for the exact rule and the `SourceFile` join
   trap. Capture the candidate ids with the AC-6 query *before* applying, so "matched nothing" is
   distinguishable from "nothing to match".
2. **The two guards.** `isRaceWinner` and `isDeliveredSource` in `pipeline-status.ts` must answer
   `false` for a retired source. They take `(status, jobs)` today; widening them to take retirement
   is a signature change with three call sites in `downloads.service.ts` and one inside
   `deriveResume` — `ResumeSibling` needs the field too, so a source that errored while its only
   winning sibling was retired becomes resumable again rather than being refused
   `retry_superseded`.
3. **The two entry points.** `hasDeliveredSource` and `demoteDeliveredSources` gain
   `retiredAt: null` in their `where`. `demoteDeliveredSources` stops writing
   `status`/`errorKey`/`errorMessage`/`errorParams` for the rows it retires and writes
   `retiredAt` instead (REQ-1). Its job-closing branch can stay as it is; it is unreachable either
   way (`../spec.md` § Out of Scope) and removing it is not this feature.
4. **`resolveRace`.** Its `alreadyWon` read must pass retirement through to `isRaceWinner`. This is
   the single most important line in the slice — `../plan.md` § Risks, first row.
5. **The refusal.** `downloadStart` must throw `i18nError.conflict(ERROR_KEYS.DOWNLOAD_RETRY_REPLACED)`
   for a retired source, before it reaches `requireTorrent` or the torrent client, and before the
   `derived.status === 'ERROR'` branch — a retired row is not `ERROR`, so
   `resumeErroredSource` would never catch it.
6. **Reactivation.** In `attach-source.service.ts`, the `060` no-op test
   (`existingSource && sameTarget && existingSource.status !== 'ERROR'`) must also treat a retired
   row as reactivatable (REQ-6), and the reactivation write that sets `status: 'QUEUED'` and clears
   the error fields must clear `retiredAt` in the same write (NFR-3).
7. **The upload split.** `UploadsService.demoteSupersededSources` keeps its `ERROR` /
   `error.source.replaced` write and its job cancellation for every source it demotes that is
   **not** delivered, and hands the delivered ones to `DownloadsService.demoteDeliveredSources`
   instead (REQ-4). One retirement writer in the codebase, not two.
8. **The wire.** `retiredAt` on `download.entity.ts` as a nullable `Date` field, added to
   `MediaSourceRow`'s type and every `select` that feeds it, mapped in `toDownload`. Let
   `schema.gql` regenerate on boot; never hand-edit it (Article IV).

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

- `Download.retiredAt: DateTime` — nullable, non-null only for a source replaced *after* delivering
  its file.
- A retired row must report `status: "COMPLETED"`, `lastError: null`, `retryable: false`. The first
  comes free from Rule 2, the other two from `deriveResume` returning early on a non-`ERROR` status
  — verify rather than assume.
- `downloadStart` on a retired source: `ConflictException` (409) carrying
  `extensions.i18n.key = error.download.retry_replaced`.

Nothing else on `Download` changes. No new error key.

## Tests

Owed under Article IX — every one of these fails *silently* if wrong:

- `src/pipeline-status/pipeline-status.spec.ts` — `isRaceWinner` returning `true` for a retired
  source is how the replacement gets declared `SUPERSEDED` and the title keeps the bad file with no
  error in any log. Also `isDeliveredSource` (the force guard refusing forever) and `deriveResume`'s
  `retry_superseded` refusal against a retired winner. The file already carries its Article IX
  header; extend it, and name retirement in the new `describe`.
- `src/downloads/downloads.service.spec.ts` — `resolveRace` must return `WON` when the only
  delivered sibling is retired (the end-to-end shape of the risk above); `demoteDeliveredSources`
  must write `retiredAt` and must **not** write `ERROR` or any error field; `downloadStart` must
  refuse a retired source with the conflict, before touching the torrent client.
- `src/uploads/uploads.service.spec.ts` — REQ-4's boundary. A `READY` or mid-encode source replaced
  by an upload must still land in `ERROR` with its job cancelled. Getting this backwards marks a
  half-finished download `COMPLETED`, which is a worse lie than the bug being fixed and shows up
  nowhere.

**Not owed**: the `download.entity.ts` field and the `toDownload` mapping. A missing field fails
loudly — `web`'s query errors on an unknown field and the typecheck catches the mapping.

## Done when

```bash
bin/cli api npx tsc --noEmit
bin/npm api run test
bin/cli api npx prisma migrate status
bin/comments api
```

`migrate status` reports no pending migration, the test suite passes with the new cases, and
`git status services/api/prisma/` shows both a modified `schema.prisma` and a new migration
directory (Article III's check).

---
title: Per-file breakdown of multi-file sources — web slice
service: web
last_updated: 2026-10-17
status: Implemented
---

# PLAN: Per-file breakdown of multi-file sources — `web` (`web/plan.md`)

## Scope

Render `Download.jobs` as child rows behind a chevron on any row with two or more jobs. Show the
parent's `N de M` label. Offer Retry and Discard per child (Discard behind a confirmation dialog).
Paint the new `DISCARDED` status. This applies to every view that renders `DownloadsPanel`:
`/downloads` and both detail pages (REQ-19).

`web` decides nothing about status, progress or retryability. `api` derives all of it, and `web`
only reads `status`, `retryable`, `owned`, `retiredAt` and `lostRace`. There are no Pause/Play
buttons on a child (`097`). There is no polling (NFR-8).

Writes are confined to `services/web/`.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/downloads.ts` | Modified | `DownloadJob` interface; `jobs: DownloadJob[]` on `Download` |
| `src/actions/downloads.ts` | Modified | `jobs { … }` in `DOWNLOAD_FIELDS`; `ENCODE_JOB_START_MUTATION`/`ENCODE_JOB_DISCARD_MUTATION`; `startEncodeJobAction`/`discardEncodeJobAction` |
| `src/components/downloads/DownloadRow.tsx` | Modified | chevron + expanded state; renders `DownloadJobRow` per job after its own `<tr>`; parent `N de M` label |
| `src/components/downloads/DownloadJobRow.tsx` | New | one child `<tr>` |
| `src/components/downloads/DiscardJobModal.tsx` | New | confirmation dialog |
| `src/components/status/StatusBadge.tsx` | Modified | `DISCARDED` → `t("discarded")` |
| `messages/en.json`, `messages/es.json` | Modified | `status.discarded`; `downloads.panel` keys below; `downloads.discardModal.*`; `errors.processJob.not_resumable`/`not_discardable` |

## Existing code to reuse

- `src/components/downloads/DownloadRow.tsx`: `handleStart`'s shape (`useTransition`, `rowError`,
  `REFRESH_ON_KEYS`, `router.refresh()`). The child row copies that shape for its two actions rather
  than inventing another.
- `src/components/downloads/DeleteDownloadModal.tsx`: the `Modal`/error-box/pending pattern for
  `DiscardJobModal`.
- `src/components/downloads/DownloadProgressBar.tsx`: the child's progress bar (one per child, encode
  only).
- `src/components/downloads/DownloadErrorLine.tsx`: the child's error line, fed `job.lastError`.
- `src/components/status/StatusBadge.tsx`: the child's badge. Do not add a second pill component.
- `src/lib/status-tone.ts`: `DISCARDED` already falls to `missing` (gray) by its `default`. No change
  is needed, and `DownloadsPanel`'s filter buckets leave a `DISCARDED` row out of every toggle, as
  they already do for `missing`.
- `src/lib/format.ts`'s `formatEncodeSpeed`: the child's speed column.
- `src/actions/downloads.ts`'s `startDownloadAction`: the shape of the two new actions
  (`redirectIfUnauthenticated` + `toActionError`, returning `DownloadActionResult`).
- `components/ui/button/Button.tsx` and `lucide-react` icons (`ChevronRight`/`ChevronDown`,
  `RotateCcw` for Retry, `X` for Discard), following `DownloadRow`'s existing button chrome and the
  44×44 mobile hit-area rule.

## Steps

1. **Types.** Add `DownloadJob` (ten fields, nullability as in `../spec.md`; `id`-like ints stay
   `number` here since they are only passed back to `Int!` args) and `jobs: DownloadJob[]` on
   `Download`.
2. **Actions.**
   - Add `jobs { processJobId label episodeId seasonNumber episodeNumber status progress encodeSpeed
     lastError { stage key params message } retryable }` to `DOWNLOAD_FIELDS`, so every listing and
     every mutation return carries it.
   - Add `startEncodeJobAction(processJobId)` and `discardEncodeJobAction(processJobId)`, copied from
     `startDownloadAction`.
3. **`StatusBadge`.** Add a `DISCARDED` case reading `status.discarded`.
4. **`DownloadJobRow.tsx`** (one component, its own file):
   - A `<tr>` indented under the parent, with the label, `StatusBadge`, a `DownloadProgressBar` (none
     when `DISCARDED`), and `formatEncodeSpeed` while `ENCODING`.
   - Retry shows when `job.status === "ERROR" && job.retryable`. Discard shows when the status is
     `QUEUED`/`ENCODING`/`ERROR`. Both are gated on the parent's `owned && retiredAt == null &&
     !lostRace`, passed down as one boolean.
   - A `DISCARDED` label is struck through (`line-through` + muted text). An `ERROR` child renders
     `DownloadErrorLine`.
   - The row has its own `rowError`, so an action failure shows on the child, not the parent.
5. **`DiscardJobModal.tsx`**: copy `DeleteDownloadModal`'s structure. The title names the job label,
   and the body says the four things REQ-22 lists. Confirm calls `discardEncodeJobAction`. Close and
   `router.refresh()` on success; on failure, show the error inline and stay open.
6. **`DownloadRow.tsx`.**
   - `const hasChildren = download.jobs.length >= 2`. With it, render a chevron button in the label
     cell (`aria-expanded`, translated `aria-label`). Expanded state is local `useState(false)` and
     is not persisted.
   - The component now returns a fragment: its own `<tr>`, then, when expanded, one `DownloadJobRow`
     per job.
   - Under the encode progress bar, while `jobs.length >= 2`, show
     `t("jobsProgress", { done, total })`. `done` is the count of `COMPLETED` jobs; `total` is the
     count of non-`DISCARDED` jobs. The percentage itself is `encodeProgress`, unchanged.
   - A `DISCARDED` parent shows only Delete. Today's `canStart`/`isControllable` already exclude it,
     because neither matches a `DISCARDED` status; verify this instead of adding a branch.
7. **Copy.** In both catalogs:
   - `status.discarded`: `Discarded` / `Descartado`.
   - `downloads.panel`:
     - `expand`/`collapse`: `Show files` / `Ver archivos`, `Hide files` / `Ocultar archivos`
     - `jobsProgress`: `{done} of {total}` / `{done} de {total}`
     - `retryJobTitle`: `Retry` / `Reintentar`
     - `discardJobTitle`: `Discard` / `Descartar`
     - `retryErrorDefault`
     - `discardErrorDefault`
   - `downloads.discardModal`: `title`, `message` with `{target}` (REQ-22's four points), `confirm`,
     `cancel`.
   - `errors.processJob.not_resumable`: `Este archivo no se puede reintentar`.
   - `errors.processJob.not_discardable`: `Este archivo ya no se puede descartar`.
   - Run `check-messages.mjs`.

## Contract obligations

Consumes `Download.jobs` and the `DownloadJob` fields exactly as `../spec.md` lists them. It also
consumes the new `Download.status` value `DISCARDED`, `encodeJobStart(processJobId: Int!): Download!`
and `encodeJobDiscard(processJobId: Int!): Download!`. Errors to render as the child's error line:
- `error.processJob.not_found`;
- `error.download.retry_replaced`/`retry_superseded` (also `router.refresh()`, as `REFRESH_ON_KEYS`
  already does);
- `error.processJob.not_resumable`;
- `error.processJob.not_discardable` (also `router.refresh()`, since the job moved on);
- `error.download.retry_enqueue_failed`.

`error.encode.discarded` never reaches `web`.

## Tests

None owed, and this service has no runner (see `services/web/CLAUDE.md` § Tests). Every change here
is visible on the page: a wrong predicate hides or shows a button, and a wrong field fails the query
loudly. Verified by the manual pass AC-2 to AC-13 in `../plan.md`, plus `check-messages.mjs` for
catalog parity.

One thing to check by hand because it fails silently: `DOWNLOAD_FIELDS` is shared by every query
and both mutations. A typo inside `jobs { … }` breaks every downloads view at once, not only the
new rows.

## Done when

```bash
bin/cli web npx tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments web
```

---
title: Downloads Panel Filters, Order and Placement — web slice
service: web
last_updated: 2026-09-19
status: Approved
---

# PLAN: Downloads Panel Filters, Order and Placement — `web` (`web/plan.md`)

## Scope

`web` owns the three filter toggles with their count badges and single-selection behaviour
(REQ-1..5), the localized season-pack label in the panel (REQ-8), the catalog entry for the new
conflict key (REQ-10's rendering), and moving the panel into the detail card on the film and show
pages (REQ-11). It does **not** sort (REQ-6 is `api`'s — render the order received), does not
parse `label`, and adds nothing to the contract.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/types/downloads.ts` | Modified | `seasonNumber: number \| null` |
| `services/web/src/actions/downloads.ts` | Modified | `seasonNumber` added to `DOWNLOAD_FIELDS` |
| `services/web/src/components/downloads/DownloadsPanel.tsx` | Modified | Filter state, three toggles with count badges left of Refresh, filtered rendering, empty state for an empty bucket; optional `showTitle` prop passed to rows |
| `services/web/src/components/downloads/DownloadRow.tsx` | Modified | Season row name from `showTitle` + `seasonAccordion.seasonLabel` |
| `services/web/src/app/(dashboard)/movies/[id]/page.tsx` | Modified | Panel moved inside the card, between `<Movie>` and `<SearchTorrent>` |
| `services/web/src/app/(dashboard)/shows/[id]/page.tsx` | Modified | Panel moved inside the card after `<Show>`, passing `showTitle={show.title}` |
| `services/web/messages/en.json`, `services/web/messages/es.json` | Modified | `downloads.panel` toggle labels (+ an aria/group label if used); `error.magnet.already_attached_season` |

## Existing code to reuse

- `src/lib/status-tone.ts` `statusTone()` — **the** bucket rule. `completed` → completed,
  `progress` → working, `error` → error, `missing` → no bucket. Do not write a second switch over
  the eight statuses.
- `src/components/ui/button/Button.tsx` — the toggles are `Button`s (`size="sm"`, `outline` for
  inactive, `primary` for active), matching the Refresh button next to them.
- `src/components/ui/badge/Badge.tsx` — the count badge.
- `seasonAccordion.seasonLabel` (`Season {number}` / `Temporada {number}`) — the existing catalog
  key used by `SeasonAccordion.tsx`, `SearchTorrent.tsx`, `SearchTorrentModal.tsx`,
  `importMagnetModal.tsx`. Reuse it; do not add a `downloads.panel.season` twin.
- `src/lib/graphql-error.ts` `translateGraphQLError` — already turns `extensions.i18n` into catalog
  copy with params (fixed during `059`); the new key only needs catalog entries.

## Steps

1. Types and query: add `seasonNumber` to `Download` and `DOWNLOAD_FIELDS`.
2. Catalogs: toggle labels under `downloads.panel` (e.g. `filterCompleted` / `filterWorking` /
   `filterError`) and `error.magnet.already_attached_season` — en
   `That magnet is already attached to «{show} Season {number}»`, es
   `Ese magnet ya está asociado a «{show} Temporada {number}»` — in both files.
3. `DownloadsPanel`: `useState<"completed" | "working" | "error" | null>(null)`. Counts derive from
   the `downloads` prop; the rendered rows are `downloads.filter(...)` (never `.sort`). Clicking the
   active toggle sets `null`. Toggles render in order completed, working, error, directly left of
   Refresh, each with `aria-pressed`. An empty filtered list shows the existing `empty` message.
   Do **not** key the panel or its parent on `downloads` — state must survive `router.refresh()`
   (REQ-5).
4. `DownloadRow`: when `download.seasonNumber != null` and a `showTitle` is available, render
   `` `${showTitle} ${tSeasonAccordion("seasonLabel", { number })}` `` instead of `download.label`;
   otherwise `download.label` as today.
5. Pages: move `<DownloadsPanel>` into the card's `space-y-6` container — on the film page between
   `<Movie>` and `<SearchTorrent>`, on the show page after `<Show>` (with `showTitle`). Remove the
   now-empty `mt-6` wrappers. Shorts use `/movies/[id]`, so they are covered.

Per Article XI, no new comments.

## Contract obligations

Consumes exactly `../spec.md` § GraphQL Contract Delta:

- `Download.seasonNumber: Int` — nullable; non-null only on season-pack rows.
- `Download.label` — now `"<Show> S<NN>"` for a season pack; used as the fallback when no
  `showTitle` is passed.
- `movieDownloads`/`showDownloads` — already ordered by last activity; render as received.
- `error.magnet.already_attached_season` `{ show: string, number: number }` — raised by
  `addMagnetToSeason`/`addTorrentToSeason`. The season magnet/search modals already surface keyed
  conflicts through `translateGraphQLError`; nothing new to wire beyond the catalog entries. Every
  other error from these queries/mutations is unchanged and keeps its current handling.

Read-only — stop and report if it is wrong.

## Tests

`web` has no test suite (`services/web/CLAUDE.md`). The silent failures here — filter reset on
refresh, counts over the filtered list, re-sorting, a missing `es` key — are covered by
`check-messages.mjs` (catalog drift) and by the manual pass in `../plan.md` § Verification
(AC-1..6, AC-8, AC-9).

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

0 typecheck errors, build exits 0, no `en`/`es` drift.

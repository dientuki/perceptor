---
title: Downloads Panel Filters, Order and Placement — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-19
status: Approved
---

# PLAN: Downloads Panel Filters, Order and Placement (`plan.md`)

## Approach

Filtering and counting are purely presentational and live entirely in `web`, over the list the
panel already receives. The bucket rule (REQ-2) is **not** a new mapping: it is
`services/web/src/lib/status-tone.ts`'s `statusTone()` — `completed` / `progress` / `error` —
with `missing` meaning "no bucket". Reusing it keeps the panel's filter and the status pill's
colour from ever disagreeing about what counts as "working". Filter state is plain component state
in `DownloadsPanel`; `router.refresh()` re-renders a client component with new props without
remounting it, so REQ-5 holds without persistence — the only way to break it is to key or remount
the panel on its data, which the web plan forbids.

Ordering (REQ-6) is `api`'s, in `services/api/src/downloads/downloads.service.ts`. The alternative —
exposing a timestamp and letting `web` sort — was rejected: it adds a contract field that only
exists to be sorted on, and a second consumer would have to re-implement the rule. `api` already
loads every row the rule needs: the `MediaSource` rows (whose `updatedAt` is always ≥ `createdAt`,
so "added" is subsumed) and the per-source `ProcessJob`s through `jobsBySourceId()`, which just
needs `updatedAt` in its select. The sort is an in-memory step after both loads, shared by
`movieDownloads` and `showDownloads`; no extra query.

The season label (REQ-7..10) follows the pattern `018-ui-i18n` set: `api` carries structure plus
a key, `web` owns the words. `api` adds `seasonNumber` to `Download`, rewrites its `seasonLabel()`
helper to the language-neutral `"<Show> S<NN>"`, and replaces `SeasonsService.seasonDisplayTitle()`
(the other Spanish string) with a dedicated error key whose params are structural. `web` renders a
season row as `<show title> + seasonAccordion.seasonLabel` — the catalog key the season accordion
and every acquisition modal already use. The show title comes from the page, which already has the
show loaded; the contract does not grow a `showTitle` field for it.

Placement (REQ-11) is a JSX move on two pages; no component changes shape for it.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns `seasonNumber`, the new error key and the order; regenerates `schema.gql` |
| 2 | `web` | Selects `seasonNumber` and renders the new key — both need step 1 to exist at runtime |
| 3 | `[docs]` | `docs/spec/graphql-contract.md` `Download` block and the root `CLAUDE.md` pipeline row |

Steps 1 and 2 **may run in parallel** — the contract delta in `spec.md` is frozen and small, and
`web`'s filter/placement work does not depend on `api` at all. Only the live verification waits
for both. Step 3 after both, so it records what shipped.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will be tempted to change and must not:

- **No `showTitle` on `Download`.** `web` looks like it needs one to label a season row; it already
  has the show on the page. Adding it is a contract change.
- **No timestamp on `Download`.** Ordering is `api`'s; `web` must not re-sort, so it has no use for
  one. Don't add `updatedAt`/`lastActivityAt` "for flexibility".
- **`label` keeps its type and stays non-null**; only the season-pack value changes, to
  `"<Show> S<NN>"` (two-digit, zero-padded, same padding as `episodeLabel`).
- **`error.magnet.already_attached_season` params are `{ show, number }`, `number` a number.** Not
  `title`, not a padded string. `error.magnet.already_attached` stays exactly as it is for the
  film/episode conflicts — do not fold the two into one key with optional params.
- **`seasonNumber` is non-null exactly when `seasonId` is.** An episode row has a season too, but
  gets `seasonNumber: null` — the field describes the row's target, not its ancestry.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief both `api`
and `web` (Article VIII).

## Migrations

None. `MediaSource.createdAt`/`updatedAt` and `ProcessJob.updatedAt` already exist (NFR-1).

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Order computed from the source row only | An old source whose encode just failed or progressed stays at the bottom; no error anywhere | NFR-5 unit test: old source + fresh job sorts above a newer idle source; AC-5 live |
| Filter reset on refresh | Panel keyed/remounted on `downloads`, so every Refresh or row action silently drops the user back to "all" | `web` plan forbids keying the panel on its data; AC-3 live |
| Badge counts computed over the filtered list | Counts collapse to the active bucket and others read 0 — looks plausible | Counts derive from the `downloads` prop, never the filtered array; AC-2 checks badges after filtering |
| New error key missing from one catalog | `translateGraphQLError` falls back to the English `message` in `es` — silently half-translated again | Key added to both catalogs; `check-messages.mjs` (NFR-4); AC-8 in both locales |
| `seasonNumber` added to `toDownload` for the queries but not for `downloadStart`/`downloadStop` | Row a user just paused comes back without it; the next full refresh fixes it, so it looks flaky | `api` plan routes all four callers through the same label/seasonNumber resolution |
| `web` re-sorts, or `Array.prototype.sort` on a filtered copy reorders | Wrong order, no error | `web` plan: `filter` only, never `sort` |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
git status --short services/api/prisma
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
git diff services/api/src/schema.gql
```

Expected: 0 typecheck errors in both; api tests all passing including the new ordering test;
`services/api/prisma` untouched; web build exits 0; no catalog drift; `schema.gql` diff is exactly
`seasonNumber: Int` on `Download`.

Manual pass (running stack, `bin/dev -d`):

1. A film with sources in `COMPLETED`, in-progress and `ERROR` → toggles, counts, single
   selection, deselect-to-all, badges unchanged while filtered (AC-1, AC-2). A title with no errors
   → **error** shows `0` and the empty state (AC-4).
2. Activate **working**, click Refresh, then stop a row → still **working** (AC-3).
3. Two idle sources on one film → newest first; trigger activity on the older one → it moves up
   after refresh (AC-5).
4. A show with a season pack, in `en` then `es` via the profile language → `Reacher Season 3` /
   `Reacher Temporada 3` (AC-6); GraphiQL `showDownloads` → `seasonNumber`, `label: "Reacher S03"`
   (AC-7).
5. Season 2's magnet modal with a magnet already on season 3 → translated conflict in both locales
   (AC-8).
6. `/movies/<film>`, `/movies/<short>`, `/shows/<id>` → panel inside the card, above search /
   seasons (AC-9).

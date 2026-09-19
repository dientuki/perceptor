---
title: Global Downloads Page and Sidebar Badge — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-09-19
status: Approved
---

# PLAN: Global Downloads Page and Sidebar Badge (`plan.md`)

## Approach

`api` gets one new reader and one count, both in the existing
`services/api/src/downloads/downloads.service.ts`, both built from the machinery `movieDownloads`/
`showDownloads` already use: `jobsBySourceId()` (one job query for every listed source),
`liveInfoByHash()` (one qBittorrent `info` call — called **without** a tag here, which the client's
`info(tag?)` already supports), `liveFor()` (the single lowercased `infoHash` join from `053`),
`toDownload()` (the single place a row's status is derived) and `byLastActivity()` (the `063` order).
Nothing about the derivation is re-implemented. `activeDownloadCount` is computed **from the global
list itself** — build the rows, then count distinct title keys among rows in the four active statuses.
The alternative, a cheaper DB-only count, was rejected: a source's derived status depends on live
qBittorrent state (`DOWNLOADING` vs `PAUSED`), so a count that skips the derivation would drift from
what the page shows (REQ-18), silently. At this installation's scale the extra work is negligible.

The three new `Download` fields (`showId`, `showTitle`, `owned`) are filled on **every** query that
returns a `Download`, not only the new one, through one shared projection of a source's target
(label, season number, show id/title, ownership) — replacing today's three near-copies (inline in
`movieDownloads`, inline in `showDownloads`, `labelFor()` for the mutations). Ownership is resolved
by loading each source's title with its `users` relation filtered to the caller (the shape
`findOwnedSource()` already uses) in the same `findMany`, never a query per row.

`web` does grouping, filtering and pagination client-side over the full list, inside the existing
`DownloadsPanel.tsx`, switched on by a single prop that only `/downloads` passes; detail pages keep
the `063` behaviour untouched (REQ-15). The grouping is a pure, order-preserving partition keyed on
`movieId` / `showId` in a new `src/lib/` helper. `DownloadRow` starts reading `download.showTitle` and
`download.owned` from the row, which lets the show page drop its `showTitle` prop — the one
simplification this feature buys (Article X). The badge count is fetched in the dashboard layout
beside `getMediaCapabilities()` and threaded through `AdminShell` to `AppSidebar`, the same path
`capabilities` already takes; `router.refresh()` (Refresh button, row actions) re-renders the layout,
which is what makes REQ-20 hold with no polling.

This deliberately reverses one line of `063`'s plan ("No `showTitle` on `Download`"): that was right
for a panel that only ever showed one show; the global page has no page-level show to pass down.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 0 | — | `063-downloads-panel-filters` must be implemented and verified first: this feature reuses its filters, its `byLastActivity` order and `seasonNumber`. Its remaining tasks close before any `064` task starts |
| 1 | `api` | Owns the two queries and three fields; regenerates `schema.gql` |
| 2 | `web` | Selects the new fields and queries — needs step 1 at runtime, not at compile time |
| 3 | `[docs]` | `docs/spec/graphql-contract.md`, root `CLAUDE.md` ("One gap worth knowing", pipeline "Browse library" row), `services/api/CLAUDE.md` / `services/web/CLAUDE.md` downloads sections |

Steps 1 and 2 **may run in parallel** once `spec.md` is Approved — the delta is small and frozen, and
most of `web`'s work (grouping, pagination, header, badge rendering) needs no live `api`. Only the
manual verification waits for both. Step 3 after both.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will be tempted to change and must not:

- **`downloads` takes no arguments.** No `page`/`pageSize`/`status` — pagination and filtering are
  `web`'s (spec § Out of Scope). Adding them server-side means the filter counts and the pages can
  disagree.
- **`activeDownloadCount` counts titles, not rows or targets, and excludes `PAUSED`.** It is not
  `downloads.filter(working).length` and must not be "simplified" into a web-side count from the
  list (the layout never loads the list).
- **`owned` is non-null and present on every `Download`**, including the mutation results. Do not
  make it nullable "because only `downloads` needs it" — `web` gates controls on it everywhere.
- **`showId`/`showTitle` are filled on `showDownloads` and the mutations too**, not only on
  `downloads`. The show page stops passing `showTitle`; if `showDownloads` leaves it null, every
  season row on `/shows/<id>` silently falls back to `"<Show> S03"`.
- **Grouping keys are ids** (`movieId`, `showId`), never `label`/`showTitle`.
- **No `isShort`/type field on `Download`.** The group header is a name and a count; a type badge is
  not in the spec.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief `api` and `web`
(Article VIII).

## Migrations

None (NFR-1).

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `owned` computed against *any* user instead of the caller | Every row shows buttons to every user; the mutations still refuse, so it looks like random "not found" errors — or the inverse, owners lose their controls | NFR-6 unit test (owned vs not owned for the same source); AC-7 live with two users |
| Count derived differently from the list | Badge says `2`, page shows three active titles; no error anywhere | Count built from the same row list (Approach); NFR-6 tests; AC-1/AC-2 live |
| Untagged `info()` joined with a raw `live.get(infoHash)` | Indexer-era uppercase hashes lose live state on `/downloads` only | Reuse `liveFor()`; no new join site |
| `showDownloads` not filling `showTitle` after the prop is removed | `/shows/<id>` season rows regress to `"<Show> S03"` in both locales | Contract Freeze bullet; AC-3 checked on `/shows/<id>` as well as `/downloads` |
| Panel keyed/remounted on its data | Refresh resets filter, page size and page (REQ-14) with no error | `web` plan forbids keying on data; clamp the page at render time, not in an effect; AC-6 |
| Group ordering done by re-sorting | Titles jump order vs the `063` activity order | Grouping is a stable partition in list order; `web` plan forbids sorting |
| Badge fetch throws in the layout | Every dashboard page 500s because qBittorrent/api hiccupped | `getActiveDownloadCount` returns `0` on non-auth errors (NFR-8); AC-9 |
| Layout not re-rendered after a row action | Badge stale until a hard reload | Row actions already call `router.refresh()`, which re-renders layouts; AC-2 checks it live |
| `063` not landed | Missing `seasonNumber`/order; `064` plans against code that isn't there | Order-of-work step 0 |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
git status --short services/api/prisma
git diff services/api/src/schema.gql
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

Expected: 0 typecheck errors in both; `api` suite green including the new `downloads.service.spec.ts`
cases; `prisma` status empty; the `schema.gql` diff is exactly `showId`, `showTitle`, `owned`,
`downloads`, `activeDownloadCount`; build exits 0; no catalog drift.

Manual pass against a running stack (`bin/dev -d`), with two users A and B:

1. As A, three films with two active sources each → `/downloads` shows three headed groups, badge `3`,
   `Showing 1–3 of 3` (AC-1). Pause sources one by one and watch the badge after each action (AC-2).
2. A show with a season pack and two episodes in flight → one group, badge counts it once; toggle UI
   language and check the season label on `/downloads` **and** `/shows/<id>` (AC-3).
3. Single-source film → no header; `error` filter on a two-row film → no header (AC-4).
4. Enough titles for three pages (or temporarily pick 10 with >10 titles): prev/next, the X–Y of Z
   line, 25 per page, filter resets to page 1, Refresh keeps the page, delete emptying the last page
   (AC-5, AC-6).
5. As B: same groups and badge, no buttons; add F1, reload, F1 gets buttons; `downloadDelete` on an
   F2 source from GraphiQL → `error.source.not_found` (AC-7, AC-8).
6. `docker compose stop torrent` → `/downloads` and every sidebar render, no 500s (AC-9); restart it.
7. Nothing active → no badge (AC-10); `shows_enabled` off with a pack in flight (AC-11); detail pages
   have no headers/pagination (AC-12).

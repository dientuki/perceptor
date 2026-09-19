---
title: Global Downloads Page and Sidebar Badge — Tasks
last_updated: 2026-09-19
status: Draft
---

# TASKS: Global Downloads Page and Sidebar Badge (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**Precondition (not a task of this feature):** `063-downloads-panel-filters` is implemented and its
`tasks.md` is closed. Every task below assumes `byLastActivity`, `seasonNumber` and the `063` filter
toggles already exist in the code. `/implement 064` must not start while `063` has open tasks.

## Tasks

### Group 1 — contract producer (`api`)

- [ ] **T001** `[api]` Add `showId` (`Int`, nullable), `showTitle` (nullable) and `owned`
      (`Boolean`, non-null) to `src/downloads/entities/download.entity.ts`. In
      `src/downloads/downloads.service.ts` replace the inline label logic of `movieDownloads`/
      `showDownloads` and `labelFor()` with one private target projection returning
      `{ label, seasonNumber, showId, showTitle, owned }` (ownership = the film's or show's `users`
      filtered to the caller is non-empty, loaded in the same query — `findOwnedSource()`'s include
      shape), and have `toDownload()` take it. `movieDownloads`, `showDownloads`, `downloadStart`,
      `downloadStop` all fill the three fields; `showDownloads` season and episode rows **must** carry
      `showId`/`showTitle`. Add to `downloads.service.spec.ts`: `showDownloads` season and episode
      rows carry `showTitle`; `movieDownloads` rows carry `owned: true`, `showId: undefined`.
      *Done when:* `bin/npm api run test` passes; `bin/cli api npx --no tsc --noEmit` reports 0
      errors.
- [ ] **T002** `[api]` Add `downloads(userId)` to `DownloadsService` — `mediaSource.findMany` with no
      `where`, the T001 projection's relations included, one untagged `liveInfoByHash()` (make its tag
      optional; no new "read all torrents" helper), `jobsBySourceId(allIds)`, `compressionEnabled()`,
      ordered by `byLastActivity`, mapped through the projection and `toDownload()` — and the
      `@Query(() => [Download], { name: 'downloads' })` in `downloads.resolver.ts` (`@CurrentUser()`,
      no `@AllowService()`, no ownership refusal). Tests: the same source reads `owned: true` for a
      caller in the title's `users` and `false` for one who is not; a season-pack row carries
      `showId`/`showTitle`; exactly one `qbittorrent.info` call, with no tag, for several sources
      across several titles; qBittorrent rejecting → rows returned with null live fields. Extend the
      suite's Article IX header by one sentence naming the ownership-flag failure. → T001
      *Done when:* `bin/npm api run test` passes with the new cases; 0 typecheck errors.
- [ ] **T003** `[api]` Add `activeDownloadCount(userId)` to `DownloadsService`, built from
      `downloads()`'s rows: distinct `movie:<movieId>` / `show:<showId>` keys over rows whose `status`
      is in a module-level constant `QUEUED`/`DOWNLOADING`/`DOWNLOADED`/`ENCODING`; and the
      `@Query(() => Int, { name: 'activeDownloadCount' })` in the resolver. Tests: 3 films × 2 active
      sources → `3`; one show with an active season pack and two active episodes → `1`; a film whose
      only source is paused → `0`; `COMPLETED`/`ERROR`-only titles → `0`. Extend the header by one
      sentence naming the badge-drift failure. Boot the api so `schema.gql` regenerates. → T002
      *Done when:* `bin/npm api run test` passes; `git diff services/api/src/schema.gql` shows exactly
      `showId: Int`, `showTitle: String`, `owned: Boolean!` on `Download` and `downloads: [Download!]!`,
      `activeDownloadCount: Int!` on `Query`; `git status --short services/api/prisma` is empty.

### Group 2 — consumer (`web`)

Everything here waits for T003: the contract must exist before anything selects it. After T004
(types + actions), T005, T006 and T009 are independent of each other and run in parallel.

- [ ] **T004** `[web]` Add `showId`, `showTitle`, `owned` to `src/types/downloads.ts` and to
      `DOWNLOAD_FIELDS` in `src/actions/downloads.ts`; add `DOWNLOADS_QUERY`/`getDownloads()` (auth →
      `redirectToClearSession`, other errors → log + `[]`) and
      `ACTIVE_DOWNLOAD_COUNT_QUERY`/`getActiveDownloadCount()` (auth → `redirectToClearSession`, other
      errors → log + `0`, never throws), both following `getMovieDownloads`. → T003
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors; with the stack up,
      `/movies/<id>` and `/shows/<id>` still render their panels (no GraphQL "Cannot query field").
- [ ] **T005** `[web] [P]` In `src/components/downloads/DownloadRow.tsx` render start/stop only when
      `owned && infoHash != null` and delete only when `owned`; build the season label from
      `download.showTitle` + `seasonAccordion.seasonLabel`; remove the `showTitle` prop from
      `DownloadRow` and `DownloadsPanel` and stop passing it in `src/app/(dashboard)/shows/[id]/page.tsx`.
      → T004
      *Done when:* 0 typecheck errors; `/shows/<id>` season rows read `<Show> Season N` / `<Show>
      Temporada N` per UI locale; `/movies/<id>` rows keep their three buttons.
- [ ] **T006** `[web] [P]` Create `src/lib/download-groups.ts` (pure, single-pass,
      order-preserving `groupByTitle` keyed `movie:<movieId>` / `show:<showId>`, fallback
      `source:<mediaSourceId>`, title from `showTitle` or `label`; no sorting),
      `src/components/downloads/DownloadGroupHeader.tsx` (one `<tr>`/`<td colSpan={5}>`, name +
      `Badge` count, visually distinct) and `src/components/downloads/DownloadsPagination.tsx`
      (previous/next `Button`s disabled at the edges, "showing {from}–{to} of {total}" line, `Select`
      with 10/25/50). Add their `downloads.panel.*` keys (`showing`, `previous`, `next`, `perPage`,
      plus any header label) to both `messages/en.json` and `messages/es.json`. → T004
      *Done when:* 0 typecheck errors; `bin/npm web run lint` clean;
      `bin/cli web node scripts/check-messages.mjs` reports no drift.
- [ ] **T007** `[web]` Add an opt-in grouped mode to `src/components/downloads/DownloadsPanel.tsx`
      (one prop, only `/downloads` passes it): filter rows (`063`) → `groupByTitle` → slice groups by
      page → render a `DownloadGroupHeader` only for groups with ≥2 visible rows → rows →
      `DownloadsPagination` below the table when ≥1 group is listed. State `page` (1-based) and
      `pageSize` (default 10); filter or page-size change resets `page` to 1; clamp to the last page at
      render time (no effect); never key/remount the panel on its data. Filter counts stay over the
      full `downloads` prop. Also accept the empty-state text as a prop. Without the prop the panel
      renders exactly as today. → T005, T006
      *Done when:* 0 typecheck errors; `/movies/<id>` and `/shows/<id>` show no headers and no
      pagination (AC-12).
- [ ] **T008** `[web]` Replace `src/app/(dashboard)/downloads/page.tsx` with a server page modelled
      on `calendar/page.tsx`: `generateMetadata` from `pages.downloads`, `PageBreadcrumb`,
      `getDownloads()`, `<DownloadsPanel>` in grouped mode with a global empty text. No capability
      check. Add `pages.downloads.{title, metadataTitle, metadataDescription}` and
      `downloads.panel.emptyAll` to both catalogs. → T004, T007
      *Done when:* 0 typecheck errors; no catalog drift; with the stack up `/downloads` lists every
      source grouped by title with pagination, and the empty state with no sources.
- [ ] **T009** `[web] [P]` Sidebar badge: `src/app/(dashboard)/layout.tsx` fetches
      `getActiveDownloadCount()` alongside the existing calls; `src/layout/AdminShell.tsx` passes it to
      `src/layout/AppSidebar.tsx`, which renders a `Badge` on the Downloads entry when `> 0` — beside
      the text when expanded/hovered/mobile-open, overlaid on the icon when collapsed — with an
      accessible label `nav.downloadsBadge` (`{count}` param) in both catalogs. → T004
      *Done when:* 0 typecheck errors; no catalog drift; with one active title the badge reads `1` on
      every dashboard page, expanded and collapsed; with none, no badge; Refresh on a detail panel
      re-reads it.
- [ ] **T010** `[web]` Full build gate. → T005, T006, T007, T008, T009
      *Done when:* `bin/cli web npx --no tsc --noEmit` 0 errors; `bin/npm web run lint` clean;
      `bin/npm web run build` exits 0; `bin/cli web node scripts/check-messages.mjs` no drift.

### Group 3 — verification and docs

- [ ] **T011** `[docs]` `docs/spec/graphql-contract.md`: add `showId`/`showTitle`/`owned` to the
      `Download` block and a `064` section recording that `downloads` and `activeDownloadCount` are
      installation-wide (not caller-scoped), unpaginated / title-counted, and that `owned` — not
      `kind`, not query membership — gates controls. → T003
      *Done when:* the section exists and matches `spec.md` § GraphQL Contract Delta verbatim in
      field names and nullability.
- [ ] **T012** `[docs]` Update `CLAUDE.md`s: root — the "One gap worth knowing" paragraph (the
      `/downloads` queue is the one installation-wide listing, read-only for foreign titles) and the
      "Browse library" pipeline row (`064`); `services/api/CLAUDE.md` `downloads/` bullet (global
      reader, count, shared target projection); `services/web/CLAUDE.md` downloads section (grouped
      mode, pagination, `owned` gating, `showTitle` from the row, sidebar badge path); add the test
      counts to "Current state". → T010, T011
      *Done when:* each file names `064` and none still says the show page passes `showTitle` or that
      `/downloads` renders nothing.
- [ ] **T013** `[docs]` Manual pass (plan.md § Verification, steps 1–7) with two users against
      `bin/dev -d`, plus the command gate: `bin/cli api npx --no tsc --noEmit`,
      `bin/npm api run test`, `git status --short services/api/prisma`,
      `git diff services/api/src/schema.gql`, T010's web commands. → T010
      *Done when:* each of AC-1 … AC-13 has been observed, and any that failed is recorded in
      § Blocked instead of ticked.
- [ ] **T014** `[docs]` Tick every acceptance criterion in `spec.md`, set `status: Implemented` on
      `spec.md`, `plan.md`, `api/plan.md`, `web/plan.md`, and `status: Done` here. → T012, T013
      *Done when:* `grep -n "^status" -r docs/spec/features/064-global-downloads-page` shows
      `Implemented` ×4 and `Done` ×1, and no unticked `AC-` box remains.

## Acceptance criteria coverage

| AC | Produced by | Observed in |
| :-- | :-- | :-- |
| AC-1, AC-2 | T002, T003, T007, T008, T009 | T013 |
| AC-3 | T001, T005, T006, T009 | T013 |
| AC-4 | T006, T007 | T013 |
| AC-5, AC-6 | T006, T007 | T013 |
| AC-7, AC-8 | T001, T002, T005 | T013 |
| AC-9 | T002, T003, T004 | T013 |
| AC-10 | T008, T009 | T013 |
| AC-11 | T002, T008 | T013 |
| AC-12 | T007 | T013 |
| AC-13 | T003, T010 | T013 |

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

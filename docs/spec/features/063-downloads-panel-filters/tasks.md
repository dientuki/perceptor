---
title: Downloads Panel Filters, Order and Placement — Tasks
last_updated: 2026-09-19
status: In Progress
---

# TASKS: Downloads Panel Filters, Order and Placement (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

## Tasks

### Group 1 — contract producer (`api`)

- [x] **T001** `[api]` Add `seasonNumber` (`@Field(() => Int, { nullable: true })`) to
      `src/downloads/entities/download.entity.ts`; in `src/downloads/downloads.service.ts` rewrite
      `seasonLabel()` to `"<Show> S<NN>"` and populate `seasonNumber` on every `Download` — from the
      included season in `showDownloads`, from `labelFor()`'s season lookup in
      `downloadStart`/`downloadStop`, `undefined` for film and episode rows. Add spec cases in
      `downloads.service.spec.ts`: a season row carries `seasonNumber: 3` and `label: "Reacher S03"`,
      an episode row carries no `seasonNumber`. Boot the api so `schema.gql` regenerates.
      *Done when:* `bin/npm api run test` passes; `git diff services/api/src/schema.gql` shows only
      `seasonNumber: Int` added to `Download`.
- [x] **T002** `[api]` Order `movieDownloads` and `showDownloads` by last activity desc
      (max of `MediaSource.updatedAt` and the source's latest `ProcessJob.updatedAt`; tie → id desc)
      in `src/downloads/downloads.service.ts`: extend `jobsBySourceId()` to also return the latest
      job `updatedAt` per source (same single query; `SourceAltitudeJob` untouched), one shared pure
      sort used by both queries, drop `orderBy: { createdAt: 'asc' }`. Add the NFR-5 tests to
      `downloads.service.spec.ts`: older source with a recent job above a newer idle source; no jobs
      → newer `updatedAt` first; equal activity → higher id first; at least one case through
      `showDownloads`. → T001
      *Done when:* `bin/npm api run test` passes with the new ordering cases;
      `bin/cli api npx --no tsc --noEmit` reports 0 errors.
- [x] **T003** `[api] [P]` Add `MAGNET_ALREADY_ATTACHED_SEASON: 'error.magnet.already_attached_season'`
      to `src/i18n/error-keys.ts` and `That magnet is already attached to «{show} Season {number}»`
      to `src/i18n/messages.en.ts`; in `src/seasons/seasons.service.ts` the different-season conflict
      throws it with `{ show, number }` (number as a number); delete `seasonDisplayTitle()`. Update
      the existing "refuses an infoHash already owned by a different season" case in
      `seasons.service.spec.ts` to the new key, params and message.
      *Done when:* `bin/npm api run test` passes; `grep -rn "Temporada" services/api/src --include=*.ts`
      finds no user-facing string (only legacy comments/logs, if any);
      `git status --short services/api/prisma` is empty.

T003 touches different files from T001/T002 and may run alongside them.

### Group 2 — consumer (`web`)

The contract is frozen in `spec.md`; the filter and placement work (T005, T006) does not read any new
field and can start immediately. T004 consumes `seasonNumber` and the new error key.

- [x] **T004** `[web]` Add `seasonNumber: number | null` to `src/types/downloads.ts` and to
      `DOWNLOAD_FIELDS` in `src/actions/downloads.ts`; add an optional `showTitle` prop to
      `DownloadsPanel` passed through to `DownloadRow`, which renders a season row as
      `` `${showTitle} ${t("seasonAccordion.seasonLabel", { number })}` `` and falls back to
      `download.label` otherwise; add `error.magnet.already_attached_season` to
      `messages/en.json` (`That magnet is already attached to «{show} Season {number}»`) and
      `messages/es.json` (`Ese magnet ya está asociado a «{show} Temporada {number}»`). → T001, T003
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors;
      `bin/cli web node scripts/check-messages.mjs` reports no drift.
- [x] **T005** `[web] [P]` In `src/components/downloads/DownloadsPanel.tsx` add the three toggles
      (completed, working, error — in that order, directly left of Refresh), bucketed with
      `statusTone()` from `src/lib/status-tone.ts` (`progress` = working, `missing` = no bucket),
      each a `Button` (`outline` inactive / `primary` active, `aria-pressed`) with a `Badge` count
      derived from the full `downloads` prop; single selection, clicking the active one clears it;
      rows rendered via `filter` only, never `sort`; an empty bucket shows the existing `empty`
      message; the panel is not keyed on its data. Toggle labels in both catalogs under
      `downloads.panel`.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors;
      `bin/cli web node scripts/check-messages.mjs` reports no drift.
- [x] **T006** `[web] [P]` Move `<DownloadsPanel>` inside the detail card's `space-y-6` container:
      in `src/app/(dashboard)/movies/[id]/page.tsx` between `<Movie>` and `<SearchTorrent>`, in
      `src/app/(dashboard)/shows/[id]/page.tsx` after `<Show>` passing `showTitle={show.title}`;
      remove the emptied `mt-6` wrappers. → T004 (for the `showTitle` prop)
      *Done when:* `bin/npm web run build` exits 0.

### Group 3 — verification and docs

- [ ] **T007** `[docs]` Live verification against a running stack (`bin/dev -d`), per `plan.md`
      § Verification: AC-1 to AC-9 walked by hand, plus the full command list (api typecheck and
      tests, `prisma/` untouched, `schema.gql` diff, web typecheck, build, `check-messages.mjs`)
      for AC-10. Record any failure in § Blocked rather than fixing across services. → T002, T003, T005, T006
      *Done when:* every AC has an observed result written next to it in this task's notes.
      *Status:* AC-10 verified by the orchestrator (api 609/609, tsc 0, prisma untouched, schema.gql
      diff = `seasonNumber`, check-messages OK at 446 keys, web build exit 0). AC-1 to AC-9 are
      **pending manual validation by the user** in the running stack.
- [x] **T008** `[docs]` Update `docs/spec/graphql-contract.md`'s `Download` block (`seasonNumber`,
      season `label` now `"Reacher S03"`, last-activity order) and add the
      `error.magnet.already_attached_season` key where the magnet errors are listed; update the root
      `CLAUDE.md` "Browse library"/"Download" pipeline row with a `063` note and a Current-state entry
      with the measured test counts; update `services/web/CLAUDE.md`'s downloads-panel paragraph
      (filters, placement inside the card, `showTitle`). → T007
      *Done when:* `grep -n "Temporada 3" docs/spec/graphql-contract.md` returns nothing and all
      three files mention `063`.
- [ ] **T009** `[docs]` Walk the acceptance criteria in `spec.md`, tick each box, set
      `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md`, `web/plan.md`, and `status: Done`
      here. → T008
      *Done when:* `grep -n "^status" docs/spec/features/063-downloads-panel-filters/**/*.md` shows
      no `Approved`/`Draft`.

## AC coverage

| AC | Task(s) |
| :-- | :-- |
| AC-1, AC-2, AC-3, AC-4 | T005, verified in T007 |
| AC-5 | T002, verified in T007 |
| AC-6 | T001 + T004, verified in T007 |
| AC-7 | T001, verified in T007 |
| AC-8 | T003 + T004, verified in T007 |
| AC-9 | T006, verified in T007 |
| AC-10 | T001–T006 commands, re-run in T007 |

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

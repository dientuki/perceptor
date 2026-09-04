---
title: Pipeline Status Normalization — Tasks
last_updated: 2026-09-03
status: Done
---

# TASKS: Pipeline Status Normalization (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

There is no `[worker]` task in this feature and that is deliberate (NFR-2). An agent that finds
itself needing to edit `services/worker` stops and reports to the Blocked table.

## Tasks

### Group 1 — the derivation

The single source of truth for all eight values. Pure — no Nest, no Prisma, no injection. Everything
else in this feature calls into it.

- [x] **T001** `[api]` Create `src/pipeline-status/pipeline-status.ts` with the eight normalized
      values, the REQ-4 rank ladder, the `SourceStatus` translation (`PENDING`/`QUEUED` → `QUEUED`,
      `READY`/`SCANNED` → `DOWNLOADED`), and the **source-altitude** derivation: REQ-3's six rules as
      ordered early returns, returning `{ status, downloadProgress, encodeProgress }`. The 0..1 →
      0..100 conversion lives here and nowhere else. Add `src/pipeline-status/pipeline-status.spec.ts`
      covering, fault-injection style: `SCANNED` + `COMPLETED` job → `COMPLETED` (AC-1); `QUEUED` +
      live downloading → `DOWNLOADING` with a percentage (AC-2); no live reading → column with `null`
      progress (AC-6); three jobs 100/50/0 with one `ENCODING` → `ENCODING` at 50 (AC-5); live
      `0.42` → `42`.
      *Done when:* `bin/npm api test` is green and each new case has been verified to **fail** when
      the single rule it covers is removed.

- [x] **T002** `[api]` Add the **title-altitude** derivation to the same file: `ERROR` if and only if
      the stored column is `ERROR`; otherwise the maximum over the ladder of (a) the column, (b) each
      non-`ERROR` source's translated status, (c) the job set with `ERROR` jobs ignored. Takes no live
      reading (REQ-5) and does **not** group jobs by source — see `plan.md` § Approach decision 1.
      Extend the spec file: column `COMPLETED` + one `ERROR` source + one `SCANNED` source with a
      `COMPLETED` job → `COMPLETED` (AC-8); column `ERROR` + a `COMPLETED` job → `ERROR` (AC-7); no
      sources and no jobs → the column verbatim (AC-9); an episode with empty `mediaSources` and an
      `ENCODING` job → `ENCODING`; a `COMPLETED` column with a `QUEUED` source stays `COMPLETED`
      (NFR-3). → T001
      *Done when:* `bin/npm api test` green, and the AC-8 case fails when `ERROR` is read off the raw
      job set instead of the column.

### Group 2 — `api` surfaces

Everything here consumes Group 1. T003 and T004 touch the same file and are ordered for that reason,
not by data dependency.

- [x] **T003** `[api]` Rename `progress` → `downloadProgress` and add `encodeProgress: Float` /
      `compressionEnabled: Boolean!` in `src/downloads/entities/download.entity.ts`. In
      `src/downloads/downloads.service.ts`: load every listed source's jobs in **one** query
      (`where: { sourceFile: { mediaSourceId: { in: ids } } }`, selecting `status`, `progress`,
      `sourceFile.mediaSourceId`) and group by `mediaSourceId`; read `compression_enabled` once per
      request via `SettingsService.getMap()` using the exact predicate
      `settingsMap['compression_enabled'] !== 'false'`; and make `toDownload` call the T001
      derivation instead of copying `source.status` and recomputing `progress`. The three control
      mutations call `toDownload` too — they need the same inputs for their single source. Add a
      `downloads.service.spec.ts` case proving two sources on one title do not pool each other's jobs.
      → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and a `movieDownloads` query
      returns `downloadProgress`, `encodeProgress` and `compressionEnabled`, with no `progress` field
      left in `schema.gql`.

- [x] **T004** `[api]` REQ-7: in `downloads.service.ts`, after the torrent client accepts the call,
      `downloadStop` writes `PAUSED` and `downloadStart` writes `QUEUED` — both as an `updateMany`
      **guarded in the `where` on non-terminal statuses only** (`PENDING`, `QUEUED`, `DOWNLOADING`,
      `PAUSED`), never a read-then-write. See `plan.md` § Approach decision 2. Add the spec case.
      → T003
      *Done when:* `bin/npm api test` green, including a case proving `downloadStart` on a `READY`
      source leaves it `READY` — which fails without the `where` guard.

- [x] **T005** `[api] [P]` In `src/movies/movies.service.ts`, map the T002 title status onto every
      row returned by `findAll` and `findOneFromDb`, using the `mediaSources`/`processJobs` those two
      queries **already include**. No query change; confirm the includes before editing. Do it in the
      service, not as a resolver field. → T002
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `movie(id)` returns a
      status from the eight-value set for a film mid-download.

- [x] **T006** `[api] [P]` In `src/shows/shows.service.ts`, add `mediaSources: true,
      processJobs: true` to the `episodes` include inside `findOneFromDb` and map the T002 title
      status onto each episode. **Do not touch `findAll`** (no include by design) and do not derive
      `Show.status` (out of scope). → T002
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `show(id)` returns
      `COMPLETED` for an episode whose `MediaSource` is `SCANNED` and whose job is `COMPLETED`.

### Group 3 — `web`

T007 onward consume the contract T003 produces. **T008 depends on nothing** — a message catalog is
not a schema consumer — so it can start immediately, in parallel with all of Group 1 and 2.

- [x] **T007** `[web]` In `src/types/downloads.ts` rename `progress` → `downloadProgress` and add
      `encodeProgress: number | null` / `compressionEnabled: boolean`; in `src/actions/downloads.ts`
      update the shared `DOWNLOAD_FIELDS` constant to select all three. Keep the type's header
      comment true and point it at `043`. → T003
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and the panel loads on a film
      detail page without a GraphQL validation error in the server log.

- [x] **T008** `[web] [P]` Add the top-level `status` namespace with the eight keys and the exact
      strings tabled in `spec.md` § Status keys, to **both** `messages/en.json` and
      `messages/es.json`.
      *Done when:* `bin/cli web node scripts/check-messages.mjs` exits 0 with all eight keys present
      in both catalogs.

- [x] **T009** `[web]` Create `src/components/status/StatusBadge.tsx` — a client component taking the
      raw status string, mapping it to a color (`COMPLETED` green, `ERROR` red, `MISSING` gray, the
      rest the pulsing blue in-progress treatment) and to its label via `useTranslations("status")`.
      Keep the existing pill markup. An unrecognised value renders the raw string rather than
      crashing or rendering empty. Deliberately **not** under `components/ui/`, which is template
      territory, and deliberately **not** a wrapper over `ui/badge/Badge.tsx` — see `plan.md`
      § Approach. → T008
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and Biome is clean **on this
      file** (never repo-wide — ~1519 pre-existing errors).

- [x] **T010** `[web]` In `src/components/downloads/DownloadsPanel.tsx`: delete the local
      `statusBadgeClass`, render `StatusBadge`, and replace the plain progress cell with two bars
      reusing the track/fill markup from `src/components/import/importFileModal.tsx` — the download
      bar always, the compression bar **only when `download.compressionEnabled` is true**. A `null`
      percentage renders an empty track and `—`, never a spinner. → T007, T009
      *Done when:* a film with an encoding job shows two bars, and flipping `compression_enabled` off
      in `/settings` leaves only the download bar (AC-3, AC-4).

- [x] **T011** `[web] [P]` In `src/components/shows/SeasonAccordion.tsx`, delete the local
      `statusBadgeClass` and render `StatusBadge` for `episode.status`. → T009
      *Done when:* no `statusBadgeClass` definition remains anywhere in `services/web/src`
      (`grep -rn "statusBadgeClass" services/web/src` returns nothing after T010 and T011).

- [x] **T012** `[web] [P]` In `src/components/movies/Movie.tsx` and `src/components/shows/Show.tsx`,
      replace the bare `{movie.status}` / `{show.status}` in the meta line with the translated label
      from the same catalog (REQ-9). `Show.status` will read *Falta* for every series — that is
      `api`'s known gap, out of scope, not to be worked around here. → T009
      *Done when:* a film detail page renders its status in Spanish under the `es` locale and in
      English under `en`, with no uppercase raw literal left on either page.

### Group 4 — verification and docs

- [x] **T013** `[docs]` Update the three affected `CLAUDE.md` files: `services/api/CLAUDE.md` gains
      `pipeline-status/` in its module map and a note that `Movie`/`Episode.status` are derived while
      `MediaSource.status` stays raw for the worker; `services/web/CLAUDE.md` records `StatusBadge`
      as the single status pill and the new `status` catalog namespace, replacing the duplicated
      `statusBadgeClass` it currently describes; the root `CLAUDE.md` gets refreshed test/typecheck
      counts. **No pipeline stage changes status** — the table's rows stay as they are. → T010, T011,
      T012, T005, T006
      *Done when:* no `CLAUDE.md` still describes `statusBadgeClass` as duplicated or `Download.progress`
      as a field.

- [x] **T014** `[docs]` Walk every acceptance criterion in `spec.md` and tick it, running the manual
      pass from `plan.md` § Verification under `bin/dev`: AC-1 and AC-2 on the two reported titles,
      AC-3/AC-4 on a live encode with the setting flipped, AC-10 followed by `docker compose stop
      torrent` to prove the REQ-7 write landed, AC-6 with the client still stopped, then
      `docker compose start torrent`. Confirm AC-13 with `git diff --stat` touching nothing under
      `services/worker/` or `services/api/prisma/`. Then set `status: Implemented` on `spec.md`,
      `plan.md`, `api/plan.md` and `web/plan.md`, and `status: Done` here. → T013, T004
      *Done when:* all 13 acceptance criteria are ticked, or any that cannot be met is recorded in
      the Blocked table below rather than ticked.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.

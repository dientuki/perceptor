---
title: A Replaced Source Is Not An Error — Tasks
last_updated: 2026-10-08
status: Draft
---

# TASKS: A Replaced Source Is Not An Error (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Most of this feature is one service, so `[P]` is used strictly: two `[api]` tasks are marked
parallel only when they touch **different files**. T003, T004, T005 and T008 all edit
`src/downloads/downloads.service.ts` and are therefore sequential no matter who dispatches them.

## Tasks

### Group 1 — schema and the two guards

- [ ] **T001** `[api] [P]` Add `MediaSource.retiredAt DateTime?` to `prisma/schema.prisma`,
      generate the migration with `bin/npm api run prisma:migrate`, and write the NFR-1 backfill
      into that same generated `migration.sql` **before applying it** — a migration already applied
      cannot be edited, so the column and its backfill are one task, not two. The backfill rule and
      the `SourceFile` join trap are in `plan.md` § Migrations; capture the candidate ids with the
      AC-6 query first so "matched nothing" stays distinguishable from "nothing to match".
      *Done when:* `bin/cli api npx prisma migrate status` reports no pending migration,
      `git status services/api/prisma/` shows both a modified `schema.prisma` and a new migration
      directory, and
      `bin/mysql -e "SELECT status, errorKey, retiredAt FROM media_sources WHERE errorKey = 'error.source.replaced' OR retiredAt IS NOT NULL"`
      shows delivered rows as `SCANNED` / null `errorKey` / non-null `retiredAt`, and every other
      candidate unchanged (AC-6).
- [ ] **T002** `[api] [P]` Teach `isRaceWinner` and `isDeliveredSource` in
      `src/pipeline-status/pipeline-status.ts` to answer `false` for a retired source, widen
      `ResumeSibling` to carry retirement so `deriveResume` stops refusing `retry_superseded`
      against a retired winner, and extend `pipeline-status.spec.ts` with all three cases.
      Independent of T001: these are pure functions over plain arguments, not Prisma rows.
      *Done when:* `bin/npm api run test` passes with new cases proving a retired `SCANNED` source
      with completed jobs is neither a race winner nor delivered.

### Group 2 — the `api` behaviour

Everything here depends on Group 1: the column must exist and the guards must already know the
question before any caller is rewired.

- [ ] **T003** `[api]` In `src/downloads/downloads.service.ts`, add `retiredAt: null` to the
      `where` of `hasDeliveredSource` and `demoteDeliveredSources`, and change
      `demoteDeliveredSources` to write `retiredAt` instead of
      `status`/`errorKey`/`errorMessage`/`errorParams` (REQ-1). Leave its unreachable job-closing
      branch alone — removing it is out of scope. Do **not** add a retirement filter to any of the
      eight callers in `movies/`, `episodes/`, `seasons/`, `uploads/` or `acquisition/`; these two
      methods are the single read and the single write. → T001 T002
      *Done when:* `bin/npm api run test` passes with a case asserting the demotion writes
      `retiredAt` and writes **no** error field and no `ERROR` status.
- [ ] **T004** `[api]` Pass retirement through `resolveRace`'s `alreadyWon` read into
      `isRaceWinner`, in the same file. This is the feature's highest-risk line (`plan.md` §
      Risks, first row): get it wrong and the replacement is written
      `error.source.superseded` with no log anywhere saying why. → T003
      *Done when:* `bin/npm api run test` passes with a case where `resolveRace` returns `WON`
      because the only delivered sibling is retired, and the new source is neither stopped in the
      torrent client nor written an error key (AC-3's unit half).
- [ ] **T005** `[api]` Make `downloadStart` throw
      `i18nError.conflict(ERROR_KEYS.DOWNLOAD_RETRY_REPLACED)` for a retired source, before
      `requireTorrent`, before the torrent client, and before the `derived.status === 'ERROR'`
      branch — a retired row is not `ERROR`, so `resumeErroredSource` would never catch it. No new
      error key, and `409`, matching the key's only other producer. → T003
      *Done when:* `bin/npm api run test` passes with a case asserting the conflict is thrown and
      the qBittorrent client is never called (AC-4's server half).
- [ ] **T006** `[api] [P]` In `src/acquisition/attach-source.service.ts`, treat a retired row as
      reactivatable in the `060` no-op test (REQ-6) and clear `retiredAt` in the same write that
      sets `status: 'QUEUED'` and clears the error fields (NFR-3). Leaving it set is the second
      silent stall in `plan.md` § Risks: the row goes live but is excluded from its own race
      forever. Different file from T003–T005, so parallel-safe with them. → T001 T002
      *Done when:* `bin/npm api run test` passes with a case proving re-adding a retired source's
      `infoHash` to the same target reactivates it and leaves `retiredAt` null, rather than
      answering `UNCHANGED` (AC-7's unit half).
- [ ] **T007** `[api] [P]` Split `UploadsService.demoteSupersededSources` in
      `src/uploads/uploads.service.ts`: delegate its **delivered** sources to
      `DownloadsService.demoteDeliveredSources`, and keep today's `ERROR` /
      `error.source.replaced` write and job cancellation for every source it demotes that never
      delivered (REQ-4). After this there is exactly one function in the codebase that sets
      `retiredAt`. Different file from T003–T005. → T003
      *Done when:* `bin/npm api run test` passes with a case proving a source still `ENCODING`
      when an upload replaces it is written `ERROR` with its job cancelled and `retiredAt` left
      null (AC-5).
- [ ] **T008** `[api]` Put `retiredAt` on the wire: a nullable `Date` field on
      `src/downloads/entities/download.entity.ts`, the field on `MediaSourceRow` and every `select`
      that feeds it, and the mapping in `toDownload` — the single projection behind `downloads`,
      `movieDownloads`, `showDownloads`, `downloadStart` and `downloadStop`. Never hand-edit
      `schema.gql`; let it regenerate on boot (Article IV). → T004 T005
      *Done when:* `bin/cli api npx tsc --noEmit` passes and, after a boot, the regenerated
      `src/schema.gql` shows `retiredAt: DateTime` on `type Download` and nothing else changed on
      that type (Article VIII's check against `spec.md` § GraphQL Contract Delta).

### Group 3 — the `web` consumer

Blocked on T008: `web` cannot select a field the schema does not answer.

- [ ] **T009** `[web]` Add `retiredAt: string | null` to the `Download` interface in
      `src/types/downloads.ts` keeping the file's existing comment convention, add `retiredAt` to
      the single `DOWNLOAD_FIELDS` fragment in `src/actions/downloads.ts`, and add one key under
      `downloads.panel` in both `messages/en.json` (`Replaced`) and `messages/es.json`
      (`Reemplazada`). → T008
      *Done when:* `bin/cli web npx --no tsc --noEmit` passes and `/downloads` still renders with
      no GraphQL error in the server log — proof the field exists on the other side.
- [ ] **T010** `[web]` In `src/components/downloads/DownloadRow.tsx`, render the neutral mark via
      the existing `components/ui/badge/Badge.tsx` when `retiredAt != null` (never `color="error"`
      or `"warning"`), and make both `canStart` and `isControllable` false for that row, leaving
      the delete button gated on `owned` alone (REQ-5). Do **not** touch `DownloadErrorLine.tsx`,
      `lib/status-tone.ts`, `StatusBadge.tsx` or `DownloadsPanel.tsx`'s bucketing — a retired row
      arrives as `COMPLETED` and those already place and paint it correctly. → T009
      *Done when:* in `/downloads`, a retired row shows a green `COMPLETED` badge with the
      "Reemplazada" mark and no red line, sits inside the `Completed` filter with `Error` reading
      `0`, and offers only the delete control (AC-1, AC-2, AC-4's UI half).

### Group 4 — verification and docs

- [ ] **T011** `[docs]` Record the contract and the behaviour change in prose: `Download.retiredAt`
      in `docs/spec/graphql-contract.md` (the boundary doc future features read, not optional); the
      Download row of the root `CLAUDE.md` pipeline table — a replaced delivered source is retired,
      not errored, and `force`'s demotion no longer writes `ERROR`; the `downloads/`,
      `pipeline-status/` and `acquisition/` notes in `services/api/CLAUDE.md`; and the downloads
      panel section of `services/web/CLAUDE.md`. → T010
      *Done when:* `grep -rn "retiredAt" docs/spec/graphql-contract.md CLAUDE.md services/api/CLAUDE.md services/web/CLAUDE.md`
      returns a hit in each of the four, and no surviving sentence in them says a replaced source
      is written `ERROR`.
- [ ] **T012** `[docs]` Walk every acceptance criterion in `spec.md` against the running stack —
      including the manual pass in `plan.md` § Verification, whose step 5 (the replacement actually
      reaching the library) is the one that cannot be skipped — tick each box, append the
      measurement entry to `docs/spec/history.md` (newest first; never to the root `CLAUDE.md`,
      `086` REQ-11), and set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and
      `web/plan.md`. → T011
      *Done when:* `bin/cli api npx tsc --noEmit`, `bin/npm api run test`,
      `bin/cli web npx --no tsc --noEmit`, `bin/npm web run test`, `bin/comments api` and
      `bin/comments web` all pass (AC-8); every `- [ ]` in `spec.md` § Acceptance Criteria is
      `- [x]`; and `docs/spec/history.md` carries a new top entry for `090`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

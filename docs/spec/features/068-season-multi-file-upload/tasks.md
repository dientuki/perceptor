---
title: Season Multi-File Upload — Tasks
last_updated: 2026-09-20
status: In Progress
---

# TASKS: Season Multi-File Upload (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[worker]` and no `[infra]` tasks exist in this feature, deliberately: NFR-1 makes an untouched
`worker` the mechanism by which a partial season upload already behaves like a partial season
torrent, and nothing about how the stack boots changes.

## Tasks

### Group 1 — `api`: vocabulary and the session guard

Everything else in this feature reads one of these two. They are the only tasks that can start
immediately, and T001/T002 are independent of each other.

- [x] **T001** `[api] [P]` Add `UPLOAD_SESSION_NOT_FOUND`, `UPLOAD_SESSION_NOT_OPEN`,
      `UPLOAD_SESSION_EMPTY`, `UPLOAD_SESSION_CLOSED` and `UPLOAD_TICKET_WRONG_SOURCE` to
      `src/i18n/error-keys.ts`, with their English renderings in `src/i18n/messages.en.ts`. Key
      strings exactly as written in `spec.md`'s two error tables.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and
      `grep -c "error.upload.session" services/api/src/i18n/error-keys.ts` returns 3.

- [x] **T002** `[api] [P]` Write the single session lookup that answers "is this `mediaSourceId` an
      open season upload session owned by this user?" — season-scoped, `kind: LOCAL_FOLDER`,
      `status: PENDING`, ownership through `season.show.users`. One implementation, reachable by
      both `seasons/` and `uploads/` without a circular module import (see `api/plan.md` § Steps 2
      for the `src/uploads/session.service.ts` escape hatch).
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and the guard has exactly
      one definition — the three callers added in Group 2 all import it from the same file, which a
      reviewer can confirm from their import lines.

### Group 2 — `api`: the three mutations and the tus branch

- [x] **T003** `[api]` Add `src/seasons/entities/season-upload-session.entity.ts`
      (`SeasonUploadSession { mediaSourceId: Int!, seasonId: Int! }`) and
      `SeasonsService.startSeasonUpload(seasonId, force, userId)` + its resolver mutation:
      `findOneFromDb` ownership, the `COMPLETED`-episode count behind `!force`,
      `demoteActiveSources` on force, `mkdir` of the per-session folder **before** the
      `MediaSource` create. → T001
      *Done when:* calling `startSeasonUpload` for an owned season returns a `mediaSourceId`,
      `bin/mysql -e 'select kind, status, seasonId, downloadPath from media_sources order by id desc limit 1'`
      shows `LOCAL_FOLDER`/`PENDING`/that season with a non-null path, and the same
      call on a season holding a `COMPLETED` episode without `force` answers
      `error.season.already_completed`.

- [x] **T004** `[api]` Widen `UploadTicketTarget` with `{ mediaSourceId }` in
      `src/uploads/upload-tickets.service.ts` (including `UploadTicketMismatchError`'s `target`),
      and add `createSeasonUploadTicket(mediaSourceId: Int!)` to `src/uploads/uploads.resolver.ts`.
      `createUploadTicket`'s signature is untouched (NFR-6). → T001, T002
      *Done when:* `createSeasonUploadTicket` against an open session returns a token, against a
      closed or unowned one answers `error.upload.session_not_found`, and
      `git diff services/api/src/uploads/uploads.resolver.ts` shows no change to
      `createUploadTicket`'s arguments.

- [x] **T005** `[api]` Add the session branch to `src/uploads/uploads.service.ts`: `onUploadCreate`
      verifying against `{ mediaSourceId }` (403 wrong-source, 401 expired, 400 when
      `mediaSourceId` arrives together with `movieId`/`episodeId`), and `handleUploadFinish`
      branching on `mediaSourceId` **first** — re-read the session, 409 `session_closed` when it is
      gone or no longer `PENDING`, re-check `isInsideRoot('downloads', downloadPath)`, move the file
      in under its sanitised name disambiguating on collision, and return without creating a source,
      resolving a race or enqueuing anything. → T001, T002, T004
      *Done when:* three files uploaded against one session land as three distinct files in that
      session's folder (`bin/bash api`, `ls`), the `media_sources` table gained no row beyond the
      session's, and no `bull:process` job was enqueued.

- [x] **T006** `[api]` Add `SeasonsService.finishSeasonUpload(mediaSourceId, userId)` + its resolver
      mutation, and widen `UploadsService.demoteSupersededSources` to accept `{ seasonId }`:
      session guard → `session_not_open`; on-disk file count zero → `session_empty` leaving the row
      `PENDING`; demote, then `resolveRace` → `superseded` when not the winner; `status: 'READY'`;
      `addSourceReady`. Writes **no** episode status (REQ-8). → T001, T002, T003
      *Done when:* closing a session with files flips the row to `READY` and then `SCANNED`, a
      second call answers `error.upload.session_not_open`, closing an empty session answers
      `error.upload.session_empty` with the row still `PENDING`, and
      `bin/mysql -e 'select status from episodes where seasonId = <n>'` is unchanged by the close
      itself.

### Group 3 — `api`: the tests Article IX owes

These pin the four silent failures named in `plan.md` § Risks. All three are independent of each
other.

- [x] **T007** `[api] [P]` Extend `src/seasons/seasons.service.spec.ts`: the double close (a second
      `finishSeasonUpload` must not enqueue a second scan), the empty close, the
      `force`/`SEASON_ALREADY_COMPLETED` guard, and the `resolveRace` loser answering
      `superseded` rather than succeeding. Open the new block with the Article IX paragraph naming
      the failure. → T006
      *Done when:* `bin/npm api run test -- seasons.service` passes with the new cases, and each
      fails if its guard is removed.

- [x] **T008** `[api] [P]` Extend `src/uploads/upload-tickets.service.spec.ts` for the
      `{ mediaSourceId }` target: a mismatch throws **and does not spend** the ticket — replaying
      it against its real session still succeeds (AC-7). → T004
      *Done when:* `bin/npm api run test -- upload-tickets` passes, including a case that mints
      once, mismatches once, then succeeds with the same token.

- [x] **T009** `[api] [P]` Cover the session branch in `src/uploads/uploads.service.spec.ts`: a
      session whose `downloadPath` escapes the downloads root is refused before any write; two
      files with the same basename both survive (no silent overwrite); a session deleted mid-upload
      answers 409. Article IX paragraph at the top. → T005
      *Done when:* `bin/npm api run test -- uploads.service` passes, and the collision case fails
      if the disambiguation is removed.

- [x] **T010** `[api]` Boot the api once so `autoSchemaFile` regenerates `src/schema.gql`, and
      confirm the diff is exactly the four additions in `spec.md`. Never hand-edit it
      (Constitution, Article IV). → T003, T004, T006
      *Done when:* `git diff services/api/src/schema.gql` shows only `SeasonUploadSession`,
      `startSeasonUpload`, `createSeasonUploadTicket` and `finishSeasonUpload` (AC-12), and
      `git status --short services/api/prisma` is empty (AC-10, NFR-2).

### Group 4 — `web`: the consumer

Everything here depends on T010: the contract must exist and be regenerated before anyone retypes
it. T011 is the one exception — it is a local type change that touches no mutation.

- [x] **T011** `[web] [P]` Widen `FileAcquisitionTarget` in `src/types/media.ts` to admit the
      `"season"` branch and update the comment that explains the old exclusion. Narrow
      `importFileModal.tsx` and `createUploadTicketAction` at their own boundary so a season still
      cannot reach `movieId: undefined, episodeId: undefined` — `059`'s type-level guarantee must
      survive the widening.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors, and passing a
      `{ kind: "season" }` target to `createUploadTicketAction` is still a type error.

- [x] **T012** `[web]` Add `startSeasonUploadAction`, `createSeasonUploadTicketAction` and
      `finishSeasonUploadAction` to `src/actions/uploads.ts`, following the standard server-action
      shape (errors returned as data through `toActionError`, never thrown; variables sent by name;
      `endpoint` filled from `PUBLIC_UPLOAD_URL` through `withRequestScheme`).
      `createUploadTicketAction` is untouched. → T010, T011
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and each action returns a
      translated string for its refusal rather than throwing.

- [x] **T013** `[web]` Add `src/components/import/ImportSeasonFilesModal.tsx`: replace warning →
      multi-file picker → `startSeasonUploadAction` → one ticket and one `tus.Upload` per file, up
      to 4 concurrent with the rest queued, every instance held in one ref; per-file progress rows
      plus an overall reading; **one** pause/resume over the whole batch; auto-close through
      `finishSeasonUploadAction` when every file is terminal and at least one uploaded, or
      `deleteDownloadAction` when none did; cancel and confirmed-close abort everything and delete
      the session. Every error row of `spec.md`'s two tables wired to its own behaviour. → T012
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and the modal renders the
      selection, one row per file and a single pause control.

- [x] **T014** `[web]` Drop `disabled` from the import button in
      `src/components/shows/SeasonAcquisitionButtons.tsx`, give it an `onImportFile` prop, and wire
      `handleOpenSeasonFileModal` + a fourth `useModal()` in
      `src/components/shows/SeasonAccordion.tsx`, setting the season `activeTarget` before opening.
      → T013
      *Done when:* on `/shows/<id>` the season import button is enabled, clicking it opens the
      season modal titled `<Show> Temporada N`, and the accordion does not expand or collapse
      (AC-1).

- [x] **T015** `[web]` Add every new string to `messages/en.json` and `messages/es.json` — the
      modal's copy and the four new `errors.upload.*` entries — `es` in the existing Rioplatense
      register of the neighbouring `import.file` keys. → T013, T014
      *Done when:* `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift, and
      `bin/npm web run build` exits 0.

### Group 5 — verification and docs

- [x] **T016** `[docs]` Update the affected `CLAUDE.md` files: the root pipeline table
      (**Download** and **Detect completion, enqueue** rows gain the season upload entry point),
      `services/api/CLAUDE.md`'s `uploads/` and `seasons/` module entries (the third ticket target,
      the session branch, the three mutations), and `services/web/CLAUDE.md`'s
      "The `AcquisitionTarget` union" section, whose `FileAcquisitionTarget` paragraph and `059`
      REQ-2 note are now stale. → T015
      *Done when:* no `CLAUDE.md` still states that a season has no upload entry point, and the
      root pipeline table names `068` on both affected rows.

- [ ] **T017** `[docs]` Walk every acceptance criterion in `spec.md`, running
      `plan.md` § Verification's command block and its six-step manual pass, tick each box, and set
      `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`. Record the
      measured test/typecheck numbers in the root `CLAUDE.md` § Current state, and note explicitly
      which criteria were proven live and which rest on unit tests. → T016
      *Done when:* `bin/npm api run test`, `bin/cli web npx --no tsc --noEmit`,
      `bin/npm web run build` and `bin/cli web node scripts/check-messages.mjs` all pass (AC-11),
      `git diff --stat services/worker` and `git status --short services/api/prisma` are both empty
      (AC-10), and every `- [ ]` in `spec.md` is `- [x]`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Empty, which is the normal state. A contract problem always lands here (Constitution, Article VIII):
an agent that finds the GraphQL delta wrong stops and reports rather than amending it from inside
its slice.

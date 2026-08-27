---
title: Replace a completed media — Tasks
last_updated: 2026-08-26
status: Done
---

# TASKS: Replace a completed media (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**`services/worker/` is out of bounds for every task below** (`spec.md` NFR-3, AC-12). The old
library file is destroyed by the replacement encode's own atomic `rename`, which already works —
this feature adds no deletion anywhere. A task that seems to need `worker` means the stale-output
mechanism removed during planning is creeping back: stop and report.

`services/api/src/process-jobs/` is likewise untouched.

## Tasks

### Group 1 — the error vocabulary and the two-valued conflict guard

The three new keys come first: every branch below throws one of them, and `web` cannot translate a
key `api` does not emit.

- [x] **T001** `[api]` Add `MOVIE_ALREADY_COMPLETED`, `EPISODE_ALREADY_COMPLETED` and
      `SEASON_ALREADY_COMPLETED` to `ERROR_KEYS` (`src/i18n/error-keys.ts`), each beside its
      `*_DOWNLOAD_IN_PROGRESS` twin in the "movies, shows, seasons, episodes" block, with the
      matching English strings in `src/i18n/messages.en.ts` in the same relative positions. The exact
      key strings are in `../spec.md` § GraphQL Contract Delta and are read-only.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and
      `grep -c "already_completed" src/i18n/error-keys.ts src/i18n/messages.en.ts` returns 3 for each
      file.
- [x] **T002** `[api] [P]` In `MoviesService.attachTorrentSource` (`src/movies/movies.service.ts`),
      throw `MOVIE_ALREADY_COMPLETED` instead of `MOVIE_DOWNLOAD_IN_PROGRESS` when
      `movie.status === 'COMPLETED'`. The guard condition (`movie.mediaSourceId && !input.force`) and
      everything after it are unchanged. → T001
      *Done when:* `addMagnetToMovie` against a `COMPLETED` film with no `force` answers
      `extensions.i18n.key = "error.movie.already_completed"`, and against a `DOWNLOADING` one still
      answers `error.movie.download_in_progress`.
- [x] **T003** `[api] [P]` The same branch in `EpisodesService.attachTorrentSource`
      (`src/episodes/episodes.service.ts`), keyed on `episode.status === 'COMPLETED'`.
      `findOneFromDb` already returned the episode — no extra query. → T001
      *Done when:* `addMagnetToEpisode` against a `COMPLETED` episode answers
      `error.episode.already_completed`; against a busy one, `error.episode.download_in_progress`.
- [x] **T004** `[api] [P]` The same branch in `SeasonsService.attachTorrentSource`
      (`src/seasons/seasons.service.ts`). A season has no status of its own, so the condition is
      `prisma.episode.count({ where: { seasonId, status: 'COMPLETED' } }) > 0` (`../spec.md` REQ-3),
      evaluated **only** inside the existing `activeSource && !input.force` branch that is about to
      throw — never on the happy path. → T001
      *Done when:* `addMagnetToSeason` against a season with at least one `COMPLETED` episode answers
      `error.season.already_completed`; against a season with an active source and no `COMPLETED`
      episode, `error.season.download_in_progress`; and the happy path issues no extra query
      (verify by reading the code path, not by count). With `force: true` the call proceeds
      (**AC-10**).
- [x] **T005** `[api]` Write `src/movies/movies.service.spec.ts` — **defends against the wrong
      warning reaching the user**: a `COMPLETED` film must produce `error.movie.already_completed`
      and a merely-busy one `error.movie.download_in_progress`. Getting this backwards shows the mild
      "a download is already running" copy to someone about to destroy a finished file, with nothing
      failing anywhere. Open the file with that sentence as its Article IX header. → T002
      *Done when:* `bin/npm api test` is green and the new suite fails if the two keys are swapped.

### Group 2 — the upload replace path

`createUploadTicket` becomes the file entry point's conflict check, so the refusal lands before the
browser sends a byte instead of after a multi-gigabyte upload.

- [x] **T006** `[api]` In `src/uploads/upload-tickets.service.ts`, add `force?: boolean` to
      `UploadTicketPayload` and to `mint`'s signature and sign it into the ticket. Change
      `verifyAndSpend` to resolve to `{ userId, force }` instead of the bare `userId` string — there
      is exactly one caller, and an object makes the new value impossible to drop silently.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors (the single caller in
      `uploads.service.ts` compiles against the new shape) and a ticket minted with `force: true`
      decodes with `force: true` in its payload.
- [x] **T007** `[api]` In the same file, add the replace marker: a `UPLOAD_REPLACE_KEY_PREFIX`
      constant, a `REPLACE_MARKER_TTL_SECONDS` constant (7 days), and `markReplaceAuthorised(uploadId)`
      / `isReplaceAuthorised(uploadId)` over the Redis client this service already uses. **Absence of
      the key means no replacement** — fail closed, and say so where the constant is defined. No
      delete method; the TTL is the cleanup. → T006
      *Done when:* `isReplaceAuthorised('never-written')` resolves `false`, and after
      `markReplaceAuthorised('x')` the key is visible via
      `bin/cli redis redis-cli get "upload:replace:x"`.
- [x] **T008** `[api]` In `src/uploads/uploads.resolver.ts`, add
      `@Args('force', { type: () => Boolean, nullable: true, defaultValue: false })` to
      `createUploadTicket`, and run the pre-flight conflict check after the existing ownership lookup
      and **before** minting: a non-null `Movie.mediaSourceId` for a film, a non-`ERROR` `MediaSource`
      against the `episodeId` for an episode. On conflict with `force: false`, throw the same key the
      matching `attachTorrentSource` would — `*_ALREADY_COMPLETED` when the target's `status` is
      `COMPLETED`, `*_DOWNLOAD_IN_PROGRESS` otherwise. The `hasMovieId === hasEpisodeId` check and its
      `NotFoundException`s stay exactly as they are. → T001, T006
      *Done when:* `createUploadTicket(movieId: <a COMPLETED film>)` with no `force` returns a
      GraphQL error carrying `error.movie.already_completed` and mints nothing (**AC-6**); the same
      call with `force: true` returns a token (**AC-7**).
- [x] **T009** `[api]` In `UploadsService.onUploadCreate` (`src/uploads/uploads.service.ts`),
      destructure the new `{ force }` off `verifyAndSpend` and call `markReplaceAuthorised(upload.id)`
      when it is true. Nothing else in the hook changes; its three `UploadHttpError` branches stay.
      → T006, T007
      *Done when:* a tus `POST` with a `force: true` ticket leaves the marker key in Redis; the same
      `POST` with a `force: false` ticket leaves no key.
- [x] **T010** `[api]` In `UploadsService.handleUploadFinish`, in **both** the episode and the film
      branch, read `await this.uploadTickets.isReplaceAuthorised(upload.id)` and skip the existing
      `409` throw when it is true. Read it from the marker **only** — never from `upload.metadata`
      (`../plan.md` § Contract Freeze). Everything after the throw is unchanged. → T007, T009
      *Done when:* an upload started with `force: true` against a `COMPLETED` film completes and
      creates a `LOCAL_FILE` `MediaSource` with the film in `ENCODING`; an upload started with
      `force: false` against a film that acquired a source mid-upload is refused with `409` and the
      staged file is not adopted (**AC-8**).
- [x] **T011** `[api]` Extend `src/uploads/upload-tickets.service.spec.ts` — **defends against a
      forged replacement**: a ticket minted with `force: false` must never yield a `true` decision,
      and the marker must be written only when the ticket itself carried the flag. This fails in the
      worst way — the upload succeeds, the film is replaced, and the only evidence is a library file
      that is now a different film. The file already opens with an Article IX header; extend it and
      keep the header accurate. → T006, T007, T009
      *Done when:* `bin/npm api test` is green (**AC-11**, api half) and the new cases fail if
      `onUploadCreate` is changed to read the flag from `upload.metadata`.
- [x] **T012** `[api]` Boot the service and confirm the regenerated `src/schema.gql`. → T008
      *Done when:* `git diff services/api/src/schema.gql` shows **only** the `force` argument on
      `createUploadTicket`; `git status services/api/prisma/` is empty; and
      `git diff --stat services/api/src/process-jobs services/worker` is empty (**AC-12**).

### Group 3 — the consumer

Everything here depends on Group 2: `web` cannot be verified against an argument the schema does not
carry yet. T013–T015 touch nothing that crosses the boundary and are safe to start immediately.

- [x] **T013** `[web] [P]` Add `toActionError(error)` to `src/lib/graphql-error.ts`, returning
      `{ error: await translateGraphQLError(error), errorKey: error.extensions?.i18n?.key }` — the
      key passed through untouched, no prefix strip. Do not change `translateGraphQLError`.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors.
- [x] **T014** `[web] [P]` Add `AcquisitionResult` to `src/types/media.ts`:
      `{ success: true; id: number; status: string } | { error: string; errorKey?: string }`. It
      exists because a `throw` from a Server Action loses `extensions.i18n.key`, which is why the
      Spanish path is broken today.
      *Done when:* typecheck reports 0 errors.
- [x] **T015** `[web] [P]` **Add** to both `messages/en.json` and `messages/es.json`: the six
      `errors.*` keys REQ-11 names — `movie.already_completed`, `episode.already_completed`,
      `season.already_completed`, `movie.download_in_progress`, `episode.download_in_progress`,
      `season.download_in_progress` — plus the `import.replace.*` UI copy the warning block and the
      two confirm controls need. The three `download_in_progress` keys are **pre-existing keys `api`
      already emits that neither catalog has**, which is why those messages render in English today.
      Additive only: `conflictMarker` stays for now (T022 removes it).
      *Done when:* `bin/cli web node scripts/check-messages.mjs` exits 0, `es` copy is in the
      existing Rioplatense register, and under locale `es` a conflict message renders in Spanish
      instead of the api's English — the case that is broken today (**AC-9**).
- [x] **T016** `[web]` Change `importMagnetAction` (`src/actions/imports.ts`),
      `addTorrentToMovieAction` (`src/actions/indexer.ts`), `addTorrentToEpisodeAction` and
      `addMagnetToEpisodeAction` (`src/actions/shows.ts`) to return `AcquisitionResult` instead of
      throwing. Keep `redirectIfUnauthenticated(errors)` first in the error branch, then
      `return await toActionError(errors[0])`. Do not touch the GraphQL documents. → T013, T014
      *Done when:* typecheck reports 0 errors and each action returns `{ errorKey }` for a refusal
      rather than throwing.
- [x] **T017** `[web]` Add `$force: Boolean` to `CREATE_UPLOAD_TICKET_MUTATION` and a `force = false`
      parameter to `createUploadTicketAction` (`src/actions/uploads.ts`); change its return to
      `{ success: true; ticket: UploadTicket } | { error: string; errorKey?: string }` so the
      pre-flight refusal — now the *expected* outcome for a `COMPLETED` target — arrives as data. The
      two local throws for a missing ticket and an unset `PUBLIC_UPLOAD_URL` become the same shape.
      → T013, T014, T008
      *Done when:* calling it against a `COMPLETED` film returns
      `{ errorKey: "error.movie.already_completed" }` and with `force: true` returns a ticket.
- [x] **T018** `[web]` Create `src/components/import/ReplaceWarning.tsx` — a presentational client
      block taking the target's label and rendering the warning copy from `import.replace.*`, and
      nothing else. The confirm control stays in each caller, which already owns a differently-shaped
      submit. One component so the sentence warning about destroying a file is written once. → T015
      *Done when:* it renders the Spanish copy under locale `es` and the English under `en`, inline
      (never `window.confirm()` — `services/web/CLAUDE.md` § Small conventions).
- [x] **T019** `[web]` Rework `src/components/import/importMagnetModal.tsx`: derive `isCompleted`
      from `target.movie.status` / `target.episode.status`, render `<ReplaceWarning />` above the
      input when true, and submit with `force: true` from the start. Replace the
      `catch`/`message.includes` block with a check of the returned `errorKey` against the three
      `*_already_completed` and three `*_download_in_progress` keys. Delete `CONFLICT_MESSAGE`.
      → T016, T018
      *Done when:* on a `COMPLETED` film the warning is visible before submitting, the button reads
      *Reemplazar*, and no `MediaSource` row exists until the user confirms (**AC-1**).
- [x] **T020** `[web]` Rework `src/components/import/importFileModal.tsx`: when `isCompleted` and the
      user has not confirmed, render `<ReplaceWarning />` **in place of** the file input with a
      confirm button setting local `replaceConfirmed`; the picker appears only after. Pass that state
      as `force` into `createUploadTicketAction` and handle its new result shape.
      `translateUploadError` and the REST envelope reader stay exactly as they are — the mid-upload
      race still comes back that way. → T017, T018
      *Done when:* on a `COMPLETED` film the warning appears before the picker does anything and the
      network tab shows the `createUploadTicket` refusal with no upload started (**AC-6**); after
      confirming, the upload runs to completion (**AC-7**).
- [x] **T021** `[web]` Rework `src/components/search/SearchTorrent.tsx`: render `<ReplaceWarning />`
      once at the top of the results area when `isCompleted`, pass `force: isCompleted` into
      `submitTorrent` for the first attempt, and rewrite `handleAddTorrent`'s error branch to read
      `errorKey` instead of `message.includes(CONFLICT_MESSAGE)`. `handleConfirmReplace` keeps its
      shape. Delete `CONFLICT_MESSAGE`. → T016, T018
      *Done when:* adding a release to a `COMPLETED` film shows the warning and succeeds on the first
      click; a busy-but-not-completed target still shows the milder copy with the retry control.
- [x] **T022** `[web]` Delete `search.torrent.conflictMarker` and `import.magnet.conflictMarker` from
      both catalogs. → T019, T021
      *Done when:* `grep -rn "conflictMarker" services/web/src services/web/messages` and
      `grep -rn "message.includes" services/web/src/components` both return nothing;
      `bin/cli web node scripts/check-messages.mjs` exits 0; `bin/npm web run build` exits 0
      (**AC-11**, web half).

### Group 4 — verification and docs

- [x] **T023** `[docs]` Update `services/api/CLAUDE.md` (the uploads section: `createUploadTicket`
      now performs the conflict pre-flight, the ticket carries the replace decision, and the Redis
      marker carries it from `onUploadCreate` to `onUploadFinish` — never tus metadata) and
      `services/web/CLAUDE.md` (the acquisition server actions return `AcquisitionResult` rather than
      throwing, and why; the substring `conflictMarker` pattern is gone). The root `CLAUDE.md`
      pipeline table does **not** change — no stage changed status. → T012, T022
      *Done when:* both files describe the shipped behaviour and neither still describes the
      acquisition actions as throwing.
- [x] **T024** `[docs]` Walk the acceptance criteria in `spec.md` against the running stack, using
      the manual pass in `plan.md` § Verification. Most criteria were already proven by the task
      that produced them — AC-1 (T019), AC-6/AC-7 (T008, T020), AC-8 (T010), AC-9 (T015),
      AC-10 (T004), AC-11 (T011, T022), AC-12 (T012). **Four are pure verification and no task
      produces them**, because they assert that behaviour this feature deliberately leaves alone
      still holds once a replacement is possible:
      **AC-2** (after confirming, `movies.file_path` still holds the original path and the file is
      still on disk), **AC-3** (a failed replacement leaves `ERROR` with the original file intact and
      playable), **AC-4** (a completed replacement leaves exactly one file, same path, different
      size or mtime — the atomic `rename` overwrote in place), and **AC-5** (nothing else under the
      library root was created, moved or removed). Run `plan.md` § Verification steps 1–5 for these;
      a failure here is a real defect, not a doc gap. Then tick every box, set
      `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md`, `web/plan.md` and `tasks.md`, and
      refresh the "Current state" test counts in the root `CLAUDE.md`, `services/api/CLAUDE.md` and
      `services/web/CLAUDE.md` from a fresh measurement. → T023
      *Done when:* every `- [ ]` in `spec.md` is `- [x]`, `bin/npm api test` and
      `bin/npm web run build` pass with the numbers recorded, and no file in the feature directory
      is still `Approved`.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice. So does any task
that appears to require touching `services/worker/` or `services/api/src/process-jobs/`.

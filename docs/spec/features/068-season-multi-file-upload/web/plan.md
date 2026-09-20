---
title: Season Multi-File Upload — web slice
service: web
last_updated: 2026-09-20
status: Approved
---

# PLAN: Season Multi-File Upload — `web` (`web/plan.md`)

## Scope

This slice owns the browser side of a batch: enabling the season import button, a season-scoped
multi-file modal that drives N concurrent tus uploads with one pause control, the three server
actions that bracket the batch, and the Spanish/English copy for all of it — including the four new
error keys `api` adds.

It does **not** own: any decision about what is in the session folder (`api` counts the files
itself), episode resolution (`worker` parses `SxxEyy`; `web` never inspects a filename), the
deletion mechanics (`deleteDownloadAction` already exists), or the per-film/per-episode import modal,
which is unchanged (NFR-6).

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/types/media.ts` | Modified | `FileAcquisitionTarget` widens to include the `"season"` branch — `059`'s REQ-2 exclusion is superseded (REQ-1). Keep the comment honest about why it is no longer excluded. |
| `src/actions/uploads.ts` | Modified | `startSeasonUploadAction`, `createSeasonUploadTicketAction`, `finishSeasonUploadAction`, beside the untouched `createUploadTicketAction`. |
| `src/components/import/ImportSeasonFilesModal.tsx` | New | The batch modal: multi-file picker, N progress rows, one pause/resume, overall progress, cancel. |
| `src/components/shows/SeasonAcquisitionButtons.tsx` | Modified | The import button loses `disabled` and gains an `onImportFile` prop. |
| `src/components/shows/SeasonAccordion.tsx` | Modified | A fourth `useModal()` for the season file modal, a `handleOpenSeasonFileModal`, and the new modal rendered beside the three existing ones. |
| `messages/en.json`, `messages/es.json` | Modified | The modal's copy under `import.season` and the four new `errors.upload.*` entries. |

## Existing code to reuse

- `src/components/import/importFileModal.tsx` — the reference implementation for everything
  tus-shaped: `CHUNK_SIZE`/`RETRY_DELAYS`, `formatBytes`, `parseRestErrorBody`,
  `translateUploadError` (the REST `{ message, i18n: { key, params? } }` envelope read through
  `useTranslations("errors")`, never `translateGraphQLError`, which is server-only), and the
  `abort()`-to-pause / `abort(true)`-to-cancel distinction. **Read it before writing a line.** The
  new modal is a batch-shaped sibling, not a rewrite — the single-file modal stays exactly as it is.
- `src/lib/acquisition-target.ts` — `isAcquisitionTargetCompleted(target)` already returns true for
  a season with any `COMPLETED` episode, and `buildAcquisitionTargetLabel(target, formatSeasonLabel)`
  already builds `<Show> Temporada N`. Both switch exhaustively on `kind`; the season branch is
  already written. Use them; do not re-derive either.
- `src/components/import/ReplaceWarning.tsx` — the replace warning and its confirm button, shown
  before the file picker exactly as the single-file modal shows it (REQ-9).
- `src/components/shows/SeasonAccordion.tsx` — the `activeTarget`-then-`openModal` pattern, and the
  `handleOpenSeasonSearchModal`/`handleOpenSeasonMagnetModal` pair the new handler copies.
- `src/actions/downloads.ts` — the existing `downloadDelete` action is what cancel calls (REQ-10).
  Do not write a second delete.
- `src/actions/media-server.ts` — the canonical server-action shape (`services/web/CLAUDE.md`);
  the three new actions follow it, returning `AcquisitionResult`-shaped data rather than throwing,
  since a throw loses `extensions.i18n` at the Server Action boundary.
- `src/lib/graphql-error.ts`'s `toActionError` — how a keyed GraphQL refusal becomes translated
  text in a server action.
- `src/hooks/useModal.ts` — the modal open/close pair, one per modal.
- `scripts/check-messages.mjs` — run it; `en`/`es` drift is a build-level failure here.

## Steps

1. **Widen `FileAcquisitionTarget`** in `src/types/media.ts` to admit the `"season"` branch, and
   update the comment that currently explains why a season is excluded. `importFileModal.tsx` and
   `createUploadTicketAction` must keep refusing a season — narrow them to the film/episode union at
   their own boundary rather than letting a season reach `movieId: undefined, episodeId: undefined`
   (that type-level guarantee is the whole point of the original exclusion and must survive).
2. **Server actions** in `src/actions/uploads.ts`. `startSeasonUploadAction(seasonId, force)` returns
   the session's `mediaSourceId` or a translated error; `createSeasonUploadTicketAction
   (mediaSourceId)` returns a ticket with `endpoint` filled from `PUBLIC_UPLOAD_URL` through
   `withRequestScheme`, exactly as `createUploadTicketAction` does; `finishSeasonUploadAction
   (mediaSourceId)` returns success or a translated error. Variables are sent **by name**, never
   positionally.
3. **The modal**, `ImportSeasonFilesModal.tsx`. Flow: replace warning when
   `isAcquisitionTargetCompleted(target)` (REQ-9) → multi-file `<input multiple accept="video/*,
   .mkv,.mp4,.avi">` → on selection, `startSeasonUploadAction(seasonId, confirmed)`; a refusal
   (`error.season.already_completed`) renders the warning and the confirm-and-replace action rather
   than a dead end. Then mint one ticket per file and start the uploads, **up to 4 concurrent**,
   the rest queued behind them (REQ-5); every `tus.Upload` instance is held in one ref keyed by file
   so the batch's state is computed over the whole selection, never the running subset.
4. **Progress and pause.** One row per file (name, bytes, percent, per-file state) plus an overall
   reading. **One** pause/resume control: pause calls `abort()` on every in-flight upload and stops
   the queue from starting more; resume calls `start()` on each paused instance and refills the
   concurrency window. Never a per-file pause (REQ-5).
5. **Closing the batch.** When every selected file is terminal (uploaded, failed or cancelled):
   if at least one uploaded → `finishSeasonUploadAction(mediaSourceId)`, then `onClose()` and
   `router.refresh()` (the same criterion the existing modals use); if zero uploaded →
   `deleteDownloadAction(mediaSourceId)` and show the batch error instead (REQ-6).
6. **Cancel and close.** The cancel action, and confirming the close button while a batch is in
   flight, abort every upload and delete the session through `deleteDownloadAction`, then
   `router.refresh()`. Closing the modal before any file is selected just closes it. Do not leave a
   silent path that dismisses the modal while a session is open and uploads are running.
7. **Error handling.** Wire each condition from `../spec.md`'s two error tables to a distinct
   behaviour: `season.already_completed` → replace warning + confirm; `upload.ticket_*`,
   `upload.session_closed`, `upload.session_not_found`, `upload.session_not_open` → mark that file
   failed, stop the batch, show the message, offer cancel (a retry cannot succeed);
   `upload.session_empty` → batch error with the session left open; `upload.superseded` → message
   plus `router.refresh()`. Resolution goes through the REST helper for a tus failure and
   `toActionError` for a mutation; never render a bare key.
8. **Buttons and wiring.** Drop `disabled` from the import button in
   `SeasonAcquisitionButtons.tsx`, add its `onImportFile` prop, and wire a
   `handleOpenSeasonFileModal` in `SeasonAccordion.tsx` that sets the season `activeTarget` before
   opening the new modal — and, as the three existing buttons already guarantee, does not toggle the
   accordion (REQ-1).
9. **Catalogs.** Add every new string to both `messages/en.json` and `messages/es.json` — `es` in
   the existing Rioplatense register, matching the tone of the neighbouring `import.file` keys — and
   run `scripts/check-messages.mjs`.

## Contract obligations

This service consumes exactly the SDL in `../spec.md` § GraphQL Contract Delta, retyped by hand —
there is no codegen, so a field name or argument typed wrong here compiles fine and fails at
runtime. It must handle **every** row of both error tables, not just the happy path: the "What
`web` does with each" paragraph under them is a requirement of this slice, not commentary.

`SeasonUploadSession` carries no `downloadPath` and never will — `web` must not display, log or
reason about where the session folder is (Constitution, Article V).

The delta is read-only. If it is wrong, stop and report.

## Tests

**None, and the reason is structural**: this service has no test suite
(`services/web/CLAUDE.md`, and the root `CLAUDE.md`'s Current state notes it at every measurement).
Adding one for this feature is its own decision and its own spec, not a side effect of a modal.
The failure modes this slice can produce are covered instead by: the typecheck (the widened
`FileAcquisitionTarget` and the retyped mutation shapes), `scripts/check-messages.mjs` (a key
present in one catalog and not the other), and `../plan.md` § Verification's manual pass — AC-4
(one pause stops every file) and AC-6 (a deleted session surfaces translated copy) exist precisely
because no unit test here will catch them.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

Typecheck reports 0 errors, the build exits 0, and the catalog check reports no `en`/`es` drift.

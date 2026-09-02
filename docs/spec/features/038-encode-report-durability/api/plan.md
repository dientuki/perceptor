---
title: Encode Report Durability — api slice
service: api
last_updated: 2026-09-01
status: Approved
---

# PLAN: Encode Report Durability — `api` (`api/plan.md`)

## Scope

This slice makes the two outcome mutations safe to receive more than once (REQ-5), stops a demoted
source from moving its title (REQ-8) and from orphaning its jobs (REQ-9), and makes a user's upload
always win its target's race instead of being silently discarded (REQ-6, REQ-7).

It does **not** touch the worker's retry behaviour — that is `worker`'s slice, and this slice's only
obligation to it is that repeat delivery is safe. It does **not** add Spanish copy for the new error
key — that is `web`'s two lines. It does **not** repair the rows wedged by the incident, and it does
**not** change `DownloadsService.resolveRace`, whose current `alreadyWon` behaviour is required
unchanged for the torrent path (NFR-4).

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/i18n/error-keys.ts` | Modified | Add `UPLOAD_SUPERSEDED: 'error.upload.superseded'` |
| `services/api/src/i18n/messages.en.ts` | Modified | English rendering for the new key |
| `services/api/src/uploads/uploads.service.ts` | Modified | Always demote (REQ-6); throw instead of returning silently (REQ-7); close orphaned jobs (REQ-9) |
| `services/api/src/process-jobs/process-jobs.service.ts` | Modified | Repeat-safe `encodeCompleted`/`encodeFailed` (REQ-5); demoted-source guard in both (REQ-8) |
| `services/api/src/uploads/uploads.service.spec.ts` | Modified | Cases for REQ-6, REQ-7, REQ-9 |
| `services/api/src/process-jobs/process-jobs.service.spec.ts` | Modified | Cases for REQ-5, REQ-8 |

No new module. If this slice grows one, the plan missed something — stop and report.

## Existing code to reuse

- `services/api/src/uploads/uploads.service.ts::demoteSupersededSources` — already performs exactly
  the demotion REQ-6 needs (`updateMany` over `READY`/`SCANNED` → `ERROR` with the `SOURCE_REPLACED`
  key). REQ-6 is implemented by **deleting its opening `isReplaceAuthorised` early return**, not by
  writing a second demotion path beside it.
- `services/api/src/uploads/uploads.service.ts::UploadHttpError` — the REST error envelope
  (`status_code` + `{ message, i18n }` body) tus already knows how to render. The new 409 uses it;
  do not invent a second error shape for the REST surface.
- `services/api/src/i18n/error-keys.ts` + `messages.en.ts` — the key vocabulary. The new key follows
  the existing `error.upload.*` REST family (`ticket_expired`, `metadata_incomplete`, …).
- `services/api/src/downloads/downloads.service.ts::resolveRace` — called exactly as it is today
  from both upload branches. **Read-only in this slice.**
- `services/api/src/media-server/media-server.service.ts::notifyCreated` — already swallows its own
  errors. REQ-5 gates the *call*, and does not change this method.

## Steps

1. **Add the key.** `UPLOAD_SUPERSEDED: 'error.upload.superseded'` in `error-keys.ts`; its English
   text in `messages.en.ts` (`'Superseded by a newer upload'`). Follow the neighbouring
   `error.upload.*` entries.

2. **Always demote (REQ-6).** In `demoteSupersededSources`, remove the
   `if (!(await this.uploadTickets.isReplaceAuthorised(uploadId))) return;` guard so every completed
   upload demotes its target's `READY`/`SCANNED` sources. Both call sites (the episode branch and
   the movie branch of `handleUploadFinish`) already invoke it before creating the new row and
   before `resolveRace`; that ordering is load-bearing and must not move. `isReplaceAuthorised` stays
   in use for the `409` COMPLETED guard higher up in both branches — do not delete the method or its
   other call sites (NFR-3).

3. **Close the jobs the demotion orphans (REQ-9).** In the same method, for each source it demotes,
   move that source's `ProcessJob` rows in `WAITING`/`QUEUED`/`ENCODING` to `ERROR` carrying the
   `SOURCE_REPLACED` key, in the same `$transaction` as the demotion. `ProcessJob` reaches its source
   through `sourceFile.mediaSourceId` (see `encodeCompleted`'s existing `include`), not through a
   direct column.

4. **Stop discarding silently (REQ-7).** In both branches of `handleUploadFinish`, replace the
   `if (raceResult.startsWith('ignorado')) { console.log(...); return; }` early return with a throw
   of `new UploadHttpError(409, ERROR_KEYS.UPLOAD_SUPERSEDED)`. After step 2 this branch is reachable
   only when a concurrent upload demoted *this* row between its `create` and its `resolveRace` — the
   loser of an upload-versus-upload race, which is genuinely a 409.

5. **Make `encodeCompleted` repeat-safe (REQ-5).** Read the job's current state before writing.
   When it is already `COMPLETED` with the same `outputFilePath`, skip `notifyCreated` and skip the
   title update; still recompute and return the cleanup verdict, because the worker retrying means
   the first verdict may never have reached it (`../plan.md` § Contract Freeze). Do not add a field
   to the return type.

6. **Guard both outcomes on the source (REQ-8).** Widen `encodeCompleted`'s existing
   `include: { sourceFile: { select: { mediaSourceId: true } } }` to also select the source's
   `status`, and add the equivalent read to `encodeFailed`. When that status is `ERROR`, write the
   `ProcessJob` row as normal and **skip** the `movie`/`episode` update entirely — no `COMPLETED`, no
   `filePath`, no `ERROR`. Return the same shape as always; the worker must not be able to tell.

7. **Make `encodeFailed` repeat-safe (REQ-5).** Its `update` is already idempotent in effect; confirm
   a second delivery produces identical stored state once step 6's guard is in place, and cover it.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta — **read-only**:

- `encodeCompleted(processJobId: Int!, outputFilePath: String!, ffmpegCommand: String!)` keeps its
  signature and its `EncodeCompletedResult` shape exactly. It gains an obligation, not a field: safe
  to receive repeatedly, notifying the media server at most once per job.
- `encodeFailed(processJobId: Int!, errorKey: String!, errorParams: String, errorMessage: String!)`
  keeps its signature and gains the same obligation.
- The new key is `error.upload.superseded`, on the REST `/uploads` surface, HTTP `409`, in the
  top-level `i18n` body shape (not `extensions` — this is not a GraphQL response).
- No SDL changes at all. If `schema.gql` shows a diff beyond regeneration noise, something in this
  slice changed the contract — stop and report.

## Tests

Owed under Article IX — every one of these fails **silently** today:

- `services/api/src/process-jobs/process-jobs.service.spec.ts` — a second `encodeCompleted` that
  notifies the media server again, and a demoted source's late outcome that moves the title. Both
  produce a perfectly successful mutation and a wrong library. Assert: second delivery does not call
  `notifyCreated`; a job whose source is `ERROR` leaves `episode.status`/`filePath` untouched on
  **both** `encodeCompleted` and `encodeFailed`.
- `services/api/src/uploads/uploads.service.spec.ts` — an upload against a target holding a
  `SCANNED` sibling must demote it, move the title to `ENCODING` and enqueue; the pre-fix behaviour
  returned success and did nothing at all, which is the exact incident. Assert also that the
  demotion leaves no non-terminal `ProcessJob` (REQ-9), and that a row demoted out from under its
  own `resolveRace` throws `409` rather than returning.

Use the house fault-injection technique (`services/api/CLAUDE.md` § Tests): verify each case fails
when its rule is removed — put the `isReplaceAuthorised` guard back and the demotion case must go
red; drop the `ERROR` check and the REQ-8 case must go red.

Not owed: the key/message additions in `i18n/` (a missing entry fails loudly at the throw site).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
```

0 typecheck errors, and the suite green with the new cases passing. Report the before/after test
counts — the current numbers in `services/api/CLAUDE.md` are stale by design and must be remeasured,
not cited.

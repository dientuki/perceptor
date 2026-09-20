---
title: Season Multi-File Upload — api slice
service: api
last_updated: 2026-09-20
status: Approved
---

# PLAN: Season Multi-File Upload — `api` (`api/plan.md`)

## Scope

This slice owns the whole server side of an upload session: the three mutations
(`startSeasonUpload`, `createSeasonUploadTicket`, `finishSeasonUpload`), the `SeasonUploadSession`
type, a third `UploadTicketTarget` member, a third branch in the tus hooks, and four new error
keys with their English messages.

It does **not** own: the deletion path (`downloadDelete` already exists and is not modified), the
scan (`worker`, untouched — NFR-1), any Prisma change (none — NFR-2), or any Spanish copy (`web`
owns every catalog; this service produces English only). It also does not touch
`createUploadTicket`'s signature or the film/episode branches of `handleUploadFinish` (NFR-6).

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/seasons/entities/season-upload-session.entity.ts` | New | `@ObjectType() SeasonUploadSession { mediaSourceId: Int!, seasonId: Int! }`. |
| `src/seasons/seasons.service.ts` | Modified | `startSeasonUpload(seasonId, force, userId)` and `finishSeasonUpload(mediaSourceId, userId)`. |
| `src/seasons/seasons.resolver.ts` | Modified | The two mutations above, behind the default `JwtAuthGuard` with `@CurrentUser()`. |
| `src/seasons/seasons.module.ts` | Modified | Whatever the two new dependencies need (`UploadsModule`/`MediaRootsModule`/`ProcessQueueService`) — see Steps for the exact seam. |
| `src/uploads/upload-tickets.service.ts` | Modified | `UploadTicketTarget` gains `{ mediaSourceId: number }`; `mint`/`verifyAndSpend` handle it; `UploadTicketMismatchError`'s `target` gains `'source'`. |
| `src/uploads/uploads.resolver.ts` | Modified | `createSeasonUploadTicket(mediaSourceId: Int!)`. |
| `src/uploads/uploads.service.ts` | Modified | The session branch in `onUploadCreate` and `handleUploadFinish`; a `moveIntoSession` sibling of `moveUploadedFile`. |
| `src/uploads/session.service.ts` *(or equivalent)* | New, optional | Only if the session lookup/guard is needed by both `seasons/` and `uploads/` — see Steps 2 and 5 before creating it. |
| `src/i18n/error-keys.ts` | Modified | `UPLOAD_SESSION_NOT_FOUND`, `UPLOAD_SESSION_NOT_OPEN`, `UPLOAD_SESSION_EMPTY`, `UPLOAD_SESSION_CLOSED`, `UPLOAD_TICKET_WRONG_SOURCE`. |
| `src/i18n/messages.en.ts` | Modified | The English rendering of each new key. |
| `src/seasons/seasons.service.spec.ts` | Modified | Open/close guards — see Tests. |
| `src/uploads/upload-tickets.service.spec.ts` | Modified | The session target's mismatch-before-spend behaviour. |
| `src/uploads/uploads.service.spec.ts` | New or Modified | The session branch's path guard and filename collision — see Tests. |

## Existing code to reuse

- `src/seasons/seasons.service.ts` — `findOneFromDb(id, userId)` is the ownership check
  (`season -> show -> UserShow`); `attachTorrentSource`'s `episode.count({ seasonId, status:
  'COMPLETED' })` guard behind `!input.force` is the `SEASON_ALREADY_COMPLETED` rule verbatim;
  `demoteActiveSources(seasonId)` is the force demotion. Follow all three, in that order. Do not
  copy anything torrent-shaped: no `parseMagnet`, no `infoHash` uniqueness check, no
  `qbittorrent.add`, no tags.
- `src/downloads/downloads.service.ts` — `resolveRace(mediaSourceId)` is the shared arbiter and the
  only correct way to decide whether this session may proceed. `handleTorrentCompleted`'s tail is
  the exact shape `finishSeasonUpload` mirrors for a **season** source: resolve the race, write
  `status: 'READY'`, enqueue, and write **no** title status (a season source has neither
  `movie` nor `episode` to update — REQ-8). Its `READY`/`SCANNED` early return is the model for the
  double-close guard.
- `src/uploads/uploads.service.ts` — `demoteSupersededSources(target, uploadId)` already takes
  `{ movieId } | { episodeId }`; widen it to accept `{ seasonId }` rather than writing a second
  demotion. `moveUploadedFile` is the model for the session move (re-resolve the root, `mkdir
  -p`, `rename`), and `sanitizeFilename`/`ILLEGAL_CHARS` and `UploadHttpError` are reused as-is.
- `src/uploads/upload-tickets.service.ts` — `mint`/`verifyAndSpend` with the target check **before**
  the Redis `SET … NX` spend. That ordering is the feature's AC-7 and must not move.
- `src/media-roots/media-roots.service.ts` — `resolveFromRoot('downloads', segment)` builds the
  session folder; `isInsideRoot('downloads', path)` is the guard re-run before every session write.
- `src/queue/process-queue.service.ts` — `addSourceReady({ mediaSourceId })`, the one enqueue.
- `src/i18n/i18n-error.ts` — every GraphQL refusal is `i18nError.notFound`/`.conflict(key, params?)`.
  Never a bare Nest exception, never an invented key outside `error-keys.ts`.

## Steps

1. **Error keys.** Add the five keys to `src/i18n/error-keys.ts` and their English messages to
   `src/i18n/messages.en.ts`, using the exact key strings in `../spec.md`'s two error tables.
2. **The session guard.** Write one lookup that answers "is this `mediaSourceId` an open season
   upload session owned by this user?" — season-scoped, `kind: LOCAL_FOLDER`, `status: PENDING`,
   ownership through `season.show.users`. All three callers (`createSeasonUploadTicket`,
   `onUploadCreate`/`handleUploadFinish`, `finishSeasonUpload`) need it, so it lives in **one**
   place. Put it wherever it can be reached without a circular module import; if `seasons/` and
   `uploads/` cannot both reach it without one, that is what the optional `src/uploads/
   session.service.ts` row in the Files table is for. Do not write it twice.
3. **`startSeasonUpload(seasonId, force, userId)`** in `SeasonsService`:
   `findOneFromDb` → `SEASON_NOT_FOUND`; the `COMPLETED` episode count behind `!force` →
   `SEASON_ALREADY_COMPLETED`; on `force`, `demoteActiveSources(seasonId)`; then resolve a fresh,
   unique session folder under the downloads root (`resolveFromRoot('downloads', <path_downloads>)`
   plus an `imports/`-style per-session segment from a `randomUUID()`), `mkdir` it, and create the
   `MediaSource` (`kind: 'LOCAL_FOLDER'`, `status: 'PENDING'`, `seasonId`, `downloadPath`). Create
   the folder **before** the row, so a failed `mkdir` leaves no row pointing at nothing. Return
   `{ mediaSourceId, seasonId }`.
4. **`createSeasonUploadTicket(mediaSourceId)`** in `UploadsResolver`: reject a non-user principal
   the way `createUploadTicket` does, run the Step 2 guard → `UPLOAD_SESSION_NOT_FOUND`, then
   `uploadTickets.mint(principal.id, { mediaSourceId })`. `force` does not travel on this ticket —
   the replace decision was already spent when the session was opened (NFR-4), and a session is
   never a `COMPLETED` target in its own right.
5. **The tus session branch.** In `onUploadCreate`: when `upload.metadata.mediaSourceId` is present
   *and* `movieId`/`episodeId` are absent, verify the ticket against `{ mediaSourceId }` — mismatch
   → `403 UPLOAD_TICKET_WRONG_SOURCE`, expiry/replay → `401 UPLOAD_TICKET_EXPIRED`. Metadata
   carrying `mediaSourceId` **together with** `movieId`/`episodeId`, or an unparseable id, is
   `400 UPLOAD_METADATA_INCOMPLETE` — never resolved by precedence. Write no replace marker.
   In `handleUploadFinish`: branch on `mediaSourceId` **first**, re-read the session row, re-run the
   Step 2 guard → `409 UPLOAD_SESSION_CLOSED` when it is gone or no longer `PENDING`, re-check
   `isInsideRoot('downloads', session.downloadPath)` (never trust the stored path alone), then move
   the staged file into the session folder under its sanitised name — **disambiguating on collision
   with the tus upload id rather than overwriting** — and return. Nothing else: no `MediaSource`
   create, no `resolveRace`, no `addSourceReady`, no title status write.
6. **`finishSeasonUpload(mediaSourceId, userId)`** in `SeasonsService`: Step 2 guard →
   `UPLOAD_SESSION_NOT_OPEN` (a `404`-shaped miss and a wrong-state row both land here for a
   caller that owns the season; keep `UPLOAD_SESSION_NOT_FOUND` for the ticket path); count the
   files actually on disk in the session folder → zero is `UPLOAD_SESSION_EMPTY` and leaves the row
   `PENDING`; `demoteSupersededSources({ seasonId }, …)`; `resolveRace(mediaSourceId)` → not a
   winner is `UPLOAD_SUPERSEDED`; write `status: 'READY'`; `addSourceReady({ mediaSourceId })`;
   return the season through the existing `findSeasonWithEpisodes(seasonId)`.
7. **Wire the resolver and entity**, boot once so `autoSchemaFile` regenerates `src/schema.gql`,
   and diff it against `../spec.md` (AC-12). Never hand-edit it (Constitution, Article IV).

## Contract obligations

This service owes `web` exactly the SDL in `../spec.md` § GraphQL Contract Delta, and exactly the
keys in its two error tables — no more (an invented key renders as a bare string or falls back to
English on `web`) and no fewer (a missing key means a refusal `web` cannot translate). Every
refusal listed there must reach the wire with its `extensions.i18n` for GraphQL, or its top-level
`i18n` for the REST body, through `i18nError` and `UploadHttpError` respectively.

The delta is read-only. If it is wrong, stop and report — do not adapt it locally
(Constitution, Article VIII).

## Tests

Owed under Article IX — each of these fails with **no error anywhere**:

- `src/uploads/uploads.service.spec.ts` — **a file written outside the session folder, and a file
  silently overwriting another.** Both answer `200` to the browser and produce a folder that looks
  plausible: in the first case the episode never encodes because the file is not where the scan
  looks, in the second two files collapse into one and an episode disappears from an otherwise
  successful season. Cover: the `isInsideRoot` re-check refusing a session whose `downloadPath`
  escapes the root; the collision disambiguation keeping both files; and the `409` when the session
  was deleted mid-upload.
- `src/uploads/upload-tickets.service.spec.ts` — **a session ticket burned by a mismatch.** The
  existing suite already pins this for films and episodes; the `{ mediaSourceId }` member must
  inherit it, or a client that mis-addresses one file of a batch loses the ticket it needed and the
  batch stalls with a generic error. Cover AC-7: mismatch throws, then the same ticket still
  succeeds against its real session.
- `src/seasons/seasons.service.spec.ts` — **the double close, and the empty close.** A second
  `finishSeasonUpload` that is not refused enqueues a second scan of the same folder and encodes the
  season twice into the same destination paths, with two successful-looking responses; an empty
  session closed as `READY` enqueues a scan of an empty folder and reports a season that will never
  produce a job. Also cover the `force`/`SEASON_ALREADY_COMPLETED` guard and the `resolveRace`
  loser answering `UPLOAD_SUPERSEDED` rather than succeeding.

**Not owed**: the `SeasonUploadSession` entity (a data shape with no behaviour), the resolver
plumbing (thin argument passing over the tested service methods, the same call the existing
`seasons.resolver.ts` mutations make), and the error-key/message additions (constants; a typo in
one is caught by `web`'s `scripts/check-messages.mjs` drift check, not by a unit test here).

Every new spec file opens with the paragraph Article IX requires, naming the failure it prevents.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
git status --short services/api/prisma   # empty — no migration (NFR-2)
git diff services/api/src/schema.gql     # exactly the four additions in ../spec.md (AC-12)
```

Typecheck reports 0 errors, the suite passes with the new specs included, `prisma/` is untouched,
and the `schema.gql` diff is `SeasonUploadSession` plus the three mutations and nothing else.

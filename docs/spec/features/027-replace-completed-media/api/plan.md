---
title: Replace a completed media — api slice
service: api
last_updated: 2026-08-26
status: Approved
---

# PLAN: Replace a completed media — `api` (`api/plan.md`)

## Scope

`api` owns everything this feature adds to the contract: three new error keys and the branch that
chooses between them, the `force` argument on `createUploadTicket` plus the pre-flight conflict
check it performs, and the Redis marker that carries the replace decision from `onUploadCreate` to
`onUploadFinish`.

**`api` deletes nothing and `process-jobs/` is not touched.** The old library file is destroyed by
the replacement encode's own atomic `rename` (`../spec.md` REQ-9), so `encodeCompleted`,
`EncodeCompletedResult` and `resolveOutputRoot` are all out of scope. An earlier draft had this
slice compute a stale-output path for `worker` to delete; it was removed (`../plan.md` § Approach).
If a task or a diff reaches `process-jobs/`, stop and report.

`api` also does not translate anything — it emits English plus a key, and `web` renders the Spanish.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/i18n/error-keys.ts` | Modified | Three constants: `MOVIE_ALREADY_COMPLETED`, `EPISODE_ALREADY_COMPLETED`, `SEASON_ALREADY_COMPLETED`. |
| `services/api/src/i18n/messages.en.ts` | Modified | The English rendering of each, beside its `*_DOWNLOAD_IN_PROGRESS` twin. |
| `services/api/src/movies/movies.service.ts` | Modified | `attachTorrentSource` picks the key by `movie.status`. |
| `services/api/src/episodes/episodes.service.ts` | Modified | Same, by `episode.status`. |
| `services/api/src/seasons/seasons.service.ts` | Modified | Same, by "any episode of this season is `COMPLETED`". |
| `services/api/src/uploads/uploads.resolver.ts` | Modified | `force` argument; the pre-flight conflict check; passes the decision to `mint`. |
| `services/api/src/uploads/upload-tickets.service.ts` | Modified | `force` in the ticket payload; `verifyAndSpend` returns it; the replace marker's key/TTL constants and its read/write helpers. |
| `services/api/src/uploads/uploads.service.ts` | Modified | `onUploadCreate` writes the marker; `handleUploadFinish` reads it and skips the conflict throw when it says replace. |
| `services/api/src/uploads/upload-tickets.service.spec.ts` | Modified | New cases for the `force` round trip and the forged-metadata defence. |
| `services/api/src/movies/movies.service.spec.ts` | New | The conflict-key branch for a film. |
| `services/api/src/schema.gql` | Regenerated | Never hand-edited (Article IV) — it changes because the decorators above changed. |

Nothing under `services/api/src/process-jobs/` appears in this table, and nothing should appear in
the diff either.

## Existing code to reuse

- `src/i18n/i18n-error.ts` — `i18nError.conflict(key, params?)`. The new keys go through the same
  factory at the same throw sites. Do not build a new exception type.
- `src/i18n/error-keys.ts` / `src/i18n/messages.en.ts` — the frozen vocabulary and its English
  renderings. Add beside `MOVIE_DOWNLOAD_IN_PROGRESS` and copy that entry's register
  ("… Confirm to replace it.").
- `MoviesService.attachTorrentSource` / `EpisodesService.attachTorrentSource` /
  `SeasonsService.attachTorrentSource` — three deliberate structural twins
  (`010-episode-acquisition` § Approach, `013-season-pack-processing` § Approach). Change each in
  place. **Do not extract a shared helper**; that collapse is a spec-level decision and this is not
  that spec (Constitution, Article X's named exception).
- `UploadTicketsService`'s Redis usage (`this.redis.set(key, '1', 'EX', ttl, 'NX')`) — the same
  client and the same shape back the replace marker.
- `MoviesService.findOneFromDb` / `EpisodesService.findOneFromDb` — the ownership-scoped lookups
  `createUploadTicket` already calls; the pre-flight check reads `status` off what they return
  rather than issuing a second query.

## Steps

1. Add `MOVIE_ALREADY_COMPLETED`, `EPISODE_ALREADY_COMPLETED`, `SEASON_ALREADY_COMPLETED` to
   `ERROR_KEYS`, in the "movies, shows, seasons, episodes" block, each beside its
   `*_DOWNLOAD_IN_PROGRESS` twin. Add the matching English strings to `MESSAGES_EN` in the same
   relative positions. The exact key strings are in `../spec.md` § GraphQL Contract Delta and are
   read-only.
2. `MoviesService.attachTorrentSource`: where it throws `MOVIE_DOWNLOAD_IN_PROGRESS`, choose
   `MOVIE_ALREADY_COMPLETED` instead when `movie.status === 'COMPLETED'`. The guard condition itself
   (`movie.mediaSourceId && !input.force`) does not change, and neither does anything after it.
3. `EpisodesService.attachTorrentSource`: the same, keyed on `episode.status === 'COMPLETED'`.
   `findOneFromDb` already returned the episode, so no extra query.
4. `SeasonsService.attachTorrentSource`: a season has no status of its own, so "completed" is
   *at least one episode of this season in `COMPLETED`* (`../spec.md` REQ-3). One
   `prisma.episode.count({ where: { seasonId, status: 'COMPLETED' } })`, evaluated **only** when the
   existing `activeSource && !input.force` branch is about to throw — never on the happy path.
5. `UploadTicketsService`: add `force?: boolean` to `UploadTicketPayload` and to `mint`'s signature;
   sign it into the ticket. Change `verifyAndSpend` to resolve to `{ userId, force }` instead of the
   bare `userId` string — there is exactly one caller (`UploadsService.onUploadCreate`), and an
   object makes the new value impossible to drop silently at the call site.
6. `UploadTicketsService`: add the replace marker — a `UPLOAD_REPLACE_KEY_PREFIX` constant, a
   `REPLACE_MARKER_TTL_SECONDS` constant (7 days; long enough for a paused resumable upload, short
   enough to expire), and two small methods, `markReplaceAuthorised(uploadId)` and
   `isReplaceAuthorised(uploadId)`. Absence of the key means **no replacement** — fail closed, and
   say so where the constant is defined. Do not add a delete method; the TTL is the cleanup.
7. `UploadsResolver.createUploadTicket`: add
   `@Args('force', { type: () => Boolean, nullable: true, defaultValue: false })`. After the
   existing ownership lookup and **before** minting, run the pre-flight (REQ-6): for a film, a
   non-null `mediaSourceId` is a conflict; for an episode, a non-`ERROR` `MediaSource` against that
   `episodeId` is. When there is a conflict and `force` is false, throw the same key the matching
   `attachTorrentSource` would — `*_ALREADY_COMPLETED` if the target's `status` is `COMPLETED`,
   `*_DOWNLOAD_IN_PROGRESS` otherwise. When `force` is true, mint the ticket carrying it.
   The `hasMovieId === hasEpisodeId` check and its `NotFoundException`s stay exactly as they are.
8. `UploadsService.onUploadCreate`: destructure the new `{ force }` off `verifyAndSpend`, and when
   it is true call `markReplaceAuthorised(upload.id)` before returning. Nothing else in this hook
   changes; its three `UploadHttpError` branches stay.
9. `UploadsService.handleUploadFinish`: in **both** branches, read
   `await this.uploadTickets.isReplaceAuthorised(upload.id)` and skip the existing 409 throw when it
   is true. Read it from the marker only — **never** from `upload.metadata` (`../plan.md` §
   Contract Freeze). Everything after the throw (the `moveUploadedFile`, the `MediaSource` create,
   the status update, the queue push) is unchanged, including for a replacement: REQ-8 says nothing
   on disk in the library is touched here.
10. Boot the service and confirm `src/schema.gql` regenerated with **only** the `force` argument on
    `createUploadTicket` and nothing else.

There is no step touching `process-jobs/`. `encodeCompleted` already writes the new `filePath` over
the old one and the encode already overwrote the file itself — that is the entire replacement
mechanism (`../spec.md` REQ-9).

## Contract obligations

Read `../spec.md` § GraphQL Contract Delta. It is read-only; if it is wrong, stop and report.

What this slice must expose, exactly:

```graphql
createUploadTicket(movieId: Int, episodeId: Int, force: Boolean = false): UploadTicket!
```

That is the whole schema delta. `EncodeCompletedResult` is **not** part of it, and the five `add*`
mutations keep their current signatures untouched — only the error key they answer with changes.

The error table in `../spec.md` lists every condition and the exact key. `web` reads these keys by
hand with no codegen and branches its UI on them, so a key emitted with a name not in that table
reaches the browser as untranslated English with nothing failing.

## Tests

- `src/uploads/upload-tickets.service.spec.ts` (extend) — **defends against a forged replacement.**
  A ticket minted with `force: false` must never yield a `true` decision, and the marker must be
  written only when the ticket itself carried the flag. This fails silently in the worst way: the
  upload succeeds, the film is replaced, and the only evidence is a library file that is now a
  different film. The file already opens with an Article IX header; extend it, keep the header
  accurate.
- `src/movies/movies.service.spec.ts` (new) — **defends against the wrong warning reaching the
  user.** A `COMPLETED` film must produce `error.movie.already_completed` and a merely-busy one
  `error.movie.download_in_progress`. Getting this backwards shows the mild "a download is already
  running" copy to someone who is about to destroy a finished file, with nothing failing. Open the
  file with that sentence as its header comment.
- **Not owed:** the `force` argument's plumbing through the resolver, and the episode/season twins
  of the key branch. The resolver fails loudly (a `schema.gql` diff, a GraphQL validation error);
  the twins are the same branch as the film's and are covered by the manual pass in `../plan.md`
  § Verification. Do not add `expect(service).toBeDefined()` scaffolding to reach a count
  (Article IX).
- **Deliberately gone:** the three `process-jobs.service.spec.ts` cases an earlier draft owed for
  `staleOutputPath`. The mechanism they defended no longer exists, which is the point — the cheapest
  way to be sure you never delete the wrong file is to have no code that deletes files.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/mysql -e 'select 1'
```

Expected: 0 typecheck errors; the test suite green with the new cases counted on top of the
pre-change baseline (measure it first, report both numbers); `git status services/api/prisma/`
**empty** — this feature has no migration, and a stray one means a step grew a column it did not
need. `git diff services/api/src/schema.gql` shows exactly the `force` argument on
`createUploadTicket`, nothing else.

```bash
git diff --stat services/api/src/process-jobs services/worker
```

must be empty (`../spec.md` AC-12).

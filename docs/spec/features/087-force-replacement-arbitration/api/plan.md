---
title: Force is consent, arbitration is the arbiter's — api slice
service: api
last_updated: 2026-10-06
status: Implemented
---

# PLAN: Force is consent, arbitration is the arbiter's — `api` (`api/plan.md`)

Read `../spec.md` and `../plan.md` first. The GraphQL delta there is read-only.

## Scope

This service carries every behavioural requirement in the feature. It defines the delivered-source
predicate once, gives the three `attachTorrentSource` twins the replacement demotion that only two of
them have today (and narrows those two so a confirmed replacement stops killing downloads in flight),
broadens the confirmation guard in all five paths from `status === 'COMPLETED'` to the spec's REQ-2
predicate, and makes `resolveRace` record a superseded source instead of answering into a log line.

It is **not** adding a migration, a schema field, an SDL change or a `ResumeStage` value — see
`../plan.md` § Contract Freeze for why the last one is tempting and forbidden. It is **not** changing
`resolveRace`'s message strings, which are the `torrentCompleted` mutation's response body. It is
**not** touching `services/worker/` or `services/web/`: `worker` has no slice in this feature and
`web`'s is two catalog entries.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/pipeline-status/pipeline-status.ts` | Modified | `isDeliveredSource(status, jobs)` exported beside `isRaceWinner`; `RaceJob` reused as its job shape |
| `src/pipeline-status/pipeline-status.spec.ts` | Modified | the predicate's boundary cases (Article IX) |
| `src/i18n/error-keys.ts` | Modified | `SOURCE_SUPERSEDED: 'error.source.superseded'` |
| `src/i18n/messages.en.ts` | Modified | its English rendering |
| `src/downloads/downloads.service.ts` | Modified | `hasDeliveredSource` + `demoteDeliveredSources`; `resolveRace` returns a typed outcome and records the loser; `resumeScanStage` honours it; `handleTorrentCompleted` reads `outcome` |
| `src/downloads/downloads.service.spec.ts` | Modified | the arbitration outcomes (Article IX) |
| `src/movies/movies.service.ts` | Modified | broadened guard + the replacement demotion it has never had |
| `src/movies/movies.service.spec.ts` | Modified | the stall, as a regression test |
| `src/episodes/episodes.service.ts` | Modified | broadened guard; `demoteActive` deleted in favour of the shared method |
| `src/episodes/episodes.service.spec.ts` | Modified | REQ-4: the 50% sibling survives |
| `src/seasons/seasons.service.ts` | Modified | broadened guard; `demoteActiveSources` deleted; `finishSeasonUpload` reads `outcome` |
| `src/seasons/seasons.service.spec.ts` | Modified | same two shapes, season-scoped |
| `src/uploads/uploads.resolver.ts` | Modified | `createUploadTicket`'s guard broadened |
| `src/uploads/uploads.service.ts` | Modified | `handleUploadFinish`'s two finish-time guards broadened; both race checks read `outcome` |
| `src/uploads/uploads.service.spec.ts` | Modified | the losing upload no longer leaves a `READY` orphan |

No new module, no new provider, no new file. If this slice wants one, the plan missed something —
report it.

## Existing code to reuse

- `src/pipeline-status/pipeline-status.ts:272` — `isRaceWinner(status, jobs)`, the pure sibling
  predicate `resolveRace` consults. `isDeliveredSource` goes directly beside it, over the same two
  inputs and the same `RaceJob[]` shape, and reuses the module-level `ACTIVE_ENCODE_STATUSES`
  (`:91`) rather than re-listing `WAITING`/`QUEUED`/`ENCODING`.
- `src/downloads/downloads.service.ts:182` — `jobsBySourceId(ids)`, which already loads
  `ProcessJob` rows through `sourceFile.mediaSourceId` and groups them per source. Both new helpers
  use it; do not write a second `processJob.findMany`.
- `src/uploads/uploads.service.ts:289` — `demoteSupersededSources(target, uploadId)`. Its
  `$transaction` body is the exact shape `demoteDeliveredSources` needs: `findMany` the ids, one
  `updateMany` to `ERROR` with `ERROR_KEYS.SOURCE_REPLACED` and `MESSAGES_EN[...]`, one `updateMany`
  closing active `ProcessJob` rows. Copy that shape into the shared method; **leave this method
  itself alone** — `038`'s upload precedence over a `READY`/`SCANNED` sibling is deliberate and REQ-8
  keeps it.
- `src/episodes/episodes.service.ts:127` — `demoteActive`, and
  `src/seasons/seasons.service.ts:295` — `demoteActiveSources`. These two are what the shared method
  replaces; delete them rather than leaving them unused (Article X). Their *call ordering* is the
  part worth preserving verbatim: the existing "demote after `qbittorrent.add()` accepted, before the
  replacement row is written" placement is AC-9, and the movie path must copy it.
- `src/downloads/downloads.service.ts:860` — the existing loser loop's `if (loser.infoHash)` guard
  and its `try/catch` around `qbittorrent.stop`. REQ-5's torrent stop reuses exactly that: a source
  with no `infoHash` (an upload) is nothing to stop, and a torrent-client failure logs and continues
  rather than failing the arbitration (`022` NFR-6).
- `src/i18n/i18n-error.ts` + `src/i18n/error-keys.ts` — every user-facing throw goes through
  `i18nError.conflict(KEY)`. The broadened guards keep throwing the three existing
  `*_ALREADY_COMPLETED` keys; they do not invent a new one.

## Steps

1. **`isDeliveredSource`** in `pipeline-status.ts`, beside `isRaceWinner`: true when `status` is
   `'SCANNED'`, no job's status is in `ACTIVE_ENCODE_STATUSES`, and at least one job's status is
   `'COMPLETED'`. Export it. A `READY` source, a `SCANNED` source with no jobs, and a `SCANNED`
   source with an active job are all false. Everything else in the feature depends on this step, so
   it lands first.
2. **`SOURCE_SUPERSEDED`** in `error-keys.ts` and its English message in `messages.en.ts`. Wording in
   English, per Article VI; `web` carries the Spanish (`../web/plan.md`).
3. **`DownloadsService.hasDeliveredSource(target)`** — `target` is the
   `{ movieId } | { episodeId } | { seasonId }` union. Load that target's `SCANNED` sources, get their
   jobs through `jobsBySourceId`, return whether any satisfies `isDeliveredSource`.
4. **`DownloadsService.demoteDeliveredSources(target, reason)`** — the same selection, written to
   `ERROR` / `ERROR_KEYS.SOURCE_REPLACED` in one transaction, closing any `ProcessJob` still in
   `WAITING`/`QUEUED`/`ENCODING` for the demoted ids (a no-op for a genuinely delivered source, and
   the safety net for a `SCANNED` source whose jobs are a mix of `COMPLETED` and `ERROR`). Returns how
   many it demoted. It must write no `Movie`/`Episode`/`Season` column — REQ-9.
5. **`resolveRace` returns `{ outcome, message }`**, `outcome` being `'WON' | 'SUPERSEDED' |
   'IGNORED'`. Every existing `return` keeps its exact Spanish `message`; the two "does not exist" /
   "no target" / "already ERROR" returns are `'IGNORED'`, the superseded return is `'SUPERSEDED'`, the
   final one is `'WON'`. Do not translate the strings.
6. **`resolveRace` records the loser** on the `SUPERSEDED` branch, before returning: write that
   source to `status: 'ERROR'`, `errorKey: SOURCE_SUPERSEDED`, `errorMessage: MESSAGES_EN[...]`,
   `errorParams: null`, and stop its torrent if it has an `infoHash`, reusing the loser loop's
   guard-and-catch. This is the one write that makes REQ-5 true for all four call sites at once.
7. **Update the four call sites** to read `outcome` instead of prefix-matching `message`:
   `handleTorrentCompleted` (`:922`, `'IGNORED'` and `'SUPERSEDED'` both return the message, as the
   prefix check does today), `uploads.service.ts:226` and `:273` (anything but `'WON'` still throws
   `409` / `ERROR_KEYS.UPLOAD_SUPERSEDED` — REQ-8), `seasons.service.ts:271` (anything but `'WON'`
   still throws `UPLOAD_SUPERSEDED`). After this step
   `git grep -n "startsWith('ganador'\|startsWith('ignorado'" services/api/src` must be empty.
8. **`resumeScanStage`** (`:585`) — it calls `resolveRace` and discards the result. Honour it: if the
   outcome is not `'WON'`, do not `addSourceReady`, and leave the row as the arbiter wrote it rather
   than rolling it back to `ERROR` through the existing `catch`.
9. **`MoviesService.attachTorrentSource`** (`:702`) — broaden the guard to
   `movie.status === 'COMPLETED' || (await hasDeliveredSource({ movieId }))`, and add the demotion
   `force` authorises: on the reactivation branch before the status writes, and on the main branch
   after `qbittorrent.add()` resolves and before the `MediaSource` create/update. This is the step
   that makes `027` REQ-1 true.
10. **`EpisodesService.attachTorrentSource`** (`:122`) — same guard broadening; replace
    `demoteActive`'s body with `demoteDeliveredSources({ episodeId }, …)` and drop the
    `activeSource` gate, which is what currently makes it fire for a merely-downloading sibling.
    `findActiveSource` stays — other callers use it — but it no longer gates the demotion.
11. **`SeasonsService`** — same in `attachTorrentSource` (`:142`) and `startSeasonUpload` (`:229`):
    the guard becomes "an episode of this season is `COMPLETED` **or**
    `hasDeliveredSource({ seasonId })`", and `demoteActiveSources` is replaced by
    `demoteDeliveredSources({ seasonId }, …)` at its three existing call sites. Keep the existing
    season-scoped target: a season replacement does not reach the episodes' own sources
    (`../spec.md` § Out of Scope).
12. **`UploadsResolver.createUploadTicket`** (`:50`, `:63`) — broaden both guards the same way.
    `DownloadsModule` is already in `UploadsModule`'s graph (`UploadsService` injects
    `DownloadsService`), so injecting it here needs no module edit and no `forwardRef`.
13. **`UploadsService.handleUploadFinish`** (`:201`, `:250`) — broaden both finish-time guards, which
    today re-read `status === 'COMPLETED'` against the ticket's `isReplaceAuthorised`. The ticket
    claim stays the authority (`027` REQ-7); only the condition it is weighed against broadens.

## Contract obligations

This service produces, unchanged in name and status, `error.movie.already_completed` /
`error.episode.already_completed` / `error.season.already_completed` as `ConflictException` — now also
for a target that is not `COMPLETED` but holds a delivered source. It keeps producing
`error.upload.superseded` as the `409` for a losing upload, and `error.source.replaced` on a demoted
delivered source. It adds exactly one key, `error.source.superseded`, which reaches `web` on a
`MediaSource` row through the existing `Download.lastError` field — never as a thrown GraphQL error.

No SDL changes. The eight `force` arguments keep their names, types and `defaultValue: false`.
`torrentCompleted`'s `String!` response body stays byte-identical.

## Tests

Article IX applies hard here: every failure this feature fixes produces no error anywhere.

- `src/pipeline-status/pipeline-status.spec.ts` — `isDeliveredSource`'s boundaries, which are the
  difference between "replace the library file" and "cancel a user's encode": `SCANNED` + all jobs
  `COMPLETED` → true; `SCANNED` + one job `ENCODING`/`QUEUED`/`WAITING` → false; `SCANNED` + zero
  jobs → false; `READY` with and without jobs → false; `SCANNED` + all jobs `ERROR` → false.
- `src/downloads/downloads.service.spec.ts` — the arbiter. A source whose sibling already won must
  come back `'SUPERSEDED'` **and** be left in `ERROR` / `error.source.superseded` with
  `qbittorrent.stop` called for its hash; the stop throwing must not change the outcome; a source
  with no `infoHash` must be recorded without calling `stop`. Also that a `WON` outcome still pauses
  the in-flight losers exactly as `022` specifies.
- `src/movies/movies.service.spec.ts` — the regression this feature exists for: a `COMPLETED` film
  with a `SCANNED` source and `COMPLETED` jobs, replaced with `force: true`, demotes that source and
  leaves `Movie.filePath` untouched; without `force` it throws `MOVIE_ALREADY_COMPLETED`; a film in
  `MISSING` holding a delivered source throws it too (REQ-2); a `qbittorrent.add` rejection leaves the
  delivered source `SCANNED` with `errorKey` null (AC-9).
- `src/episodes/episodes.service.spec.ts` and `src/seasons/seasons.service.spec.ts` — REQ-4 in both:
  a target holding one delivered source and one `DOWNLOADING` source, replaced with `force: true`,
  demotes the delivered one and leaves the `DOWNLOADING` one alone. This asserts against the
  behaviour those two services have today, so a test that passes before the change is wrong.
- `src/uploads/uploads.service.spec.ts` — a losing upload throws `409` **and** its just-created
  `MediaSource` is left `ERROR`, not `READY`. The orphan is the silent part: a `READY` row is a race
  winner, so it would block every future source of that target with nothing failing.

Not owed a test: the `error-keys.ts` / `messages.en.ts` constants (a missing key is a compile error),
and `UploadsResolver`'s argument plumbing (covered through the service tests above).

## Done when

```bash
bin/cli api npx --no tsc -p tsconfig.json --noEmit
bin/npm api run test
bin/comments api
git diff --quiet -- services/api/prisma && echo "no migration: ok"
git grep -n "startsWith('ganador'\|startsWith('ignorado'" services/api/src || echo "no prefix matching: ok"
```

All four must pass, and `src/schema.gql` must either not appear in the diff or appear with no
field-level change (Article IV).

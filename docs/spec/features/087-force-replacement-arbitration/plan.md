---
title: Force is consent, arbitration is the arbiter's — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-06
status: Implemented
---

# PLAN: Force is consent, arbitration is the arbiter's (`plan.md`)

## Approach

Three existing seams carry this whole feature; nothing new is introduced beside them.

**The predicate.** `services/api/src/pipeline-status/pipeline-status.ts` already holds
`isRaceWinner(status, jobs)` — the pure function `resolveRace` consults to decide whether a sibling
beat the source in hand. The spec's *delivered source* (REQ-2) is the same shape of question asked of
the same two inputs, so it becomes `isDeliveredSource(status, jobs)` directly beside it: `SCANNED`,
no `ProcessJob` in `WAITING`/`QUEUED`/`ENCODING`, at least one in `COMPLETED`. Pure, exported,
unit-testable, and the one definition NFR-4 asks for. A `READY` source with no jobs is deliberately
**not** delivered — it is a source that finished downloading and has not been scanned, which is a
race in flight, not a delivery.

**The query.** The predicate needs each candidate source's jobs, which `DownloadsService` already
loads through its private `jobsBySourceId(ids)` (`downloads.service.ts:182`). So the two target-shaped
helpers live there — `hasDeliveredSource(target)` and `demoteDeliveredSources(target, reason)` — taking
the same `{ movieId } | { episodeId } | { seasonId }` union `UploadsService.demoteSupersededSources`
already takes, and writing `ERROR` / `error.source.replaced` in the same transaction shape that method
already uses. `MoviesService`, `EpisodesService`, `SeasonsService` and `UploadsService` **all four
already inject `DownloadsService`**, so this needs no new module wiring, no new provider and no
`forwardRef`. This is what lets `EpisodesService.demoteActive` and
`SeasonsService.demoteActiveSources` be deleted rather than edited (Article X): two private helpers
collapse into one shared method, and `MoviesService` gains the behaviour it never had.

**The arbiter.** `resolveRace` today answers with a Spanish sentence, and its four call sites decide
what to do by prefix-matching it — `raceResult.startsWith('ignorado')`
(`downloads.service.ts:922`), `!raceResult.startsWith('ganador')` (`uploads.service.ts:226`,
`:273`, `seasons.service.ts:271`). REQ-5 needs those call sites to tell a *superseded* source from a
*nonexistent* one, which a prefix cannot express, so `resolveRace` returns
`{ outcome: 'WON' | 'SUPERSEDED' | 'IGNORED', message }` where `message` is byte-identical to the
string it returns today. That matters: `handleTorrentCompleted` returns that string as the
`torrentCompleted` mutation's `String!`, read by the qBittorrent AutoRun hook, and this feature
changes no response body. The ERROR write and the torrent stop of REQ-5 go **inside** `resolveRace`,
so all four call sites inherit the fix rather than each repeating it — including the two upload paths,
where it closes a leak the spec did not name: a losing upload throws its `409` today **after** having
created a `READY` `MediaSource`, and that orphan row is itself a race winner by `isRaceWinner`, so it
silently blocks every future source of the same target.

The alternative considered and rejected was persisting the consent on the `MediaSource` (a
`replaceAuthorisedAt` column) so the arbiter could demote a delivered sibling hours later, at
completion time. It is a migration plus a backfill for a decision that can be taken in the request
that carries the consent — which is exactly where the two upload paths already take it. `spec.md`
§ Out of Scope records the rejection; NFR-1 is the consequence.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the predicate, the arbiter, all five guards and the new error key. Every behavioural requirement in the spec is an `api` requirement. |
| 2 | `web` | Two catalog entries for `error.source.superseded`, plus the REQ-10 verification that `isAcquisitionTargetCompleted` stays a pre-check. |

**Step 2 can run fully in parallel with step 1.** `web` depends on nothing but the key *name*, which
`spec.md` § GraphQL Contract Delta freezes, and `translateErrorKey`
(`services/web/src/lib/graphql-error.ts`) already falls back to the English `message` for an unknown
key — so neither order produces a broken intermediate state. Within `api`, the predicate (step A
below) blocks everything else; the five guards and the arbiter are independent of each other once it
exists.

## Contract Freeze

`spec.md` § GraphQL Contract Delta is frozen as of `status: Approved`. There is **no SDL change** in
this feature, which makes the freeze easier to violate by accident rather than harder — the things an
implementer will be tempted to change and must not:

- **`resolveRace`'s `message` strings.** They are Spanish and they are load-bearing as the
  `torrentCompleted` mutation's return value. Translating them is a separate change with its own
  reasoning (see the recent `[api][worker][web] translate runtime log and error strings` commits);
  doing it inside this feature mixes a response-body change into a behavioural fix. Keep them
  byte-identical and carry the decision in `outcome`.
- **`ResumeStage`.** A superseded source resolves to `stage: 'SCAN'` through the existing `stageOf`
  (`pipeline-status.ts:338`), because its `errorKey` is not `SOURCE_REPLACED`. That is deliberate:
  `stageOf` returning `'REPLACED'` would make `deriveResume` answer
  `error.download.retry_replaced`, and AC-7 requires `error.download.retry_superseded`. Adding a
  sixth `ResumeStage` value *would* read better in `DownloadErrorLine` and is **not** in the delta —
  do not add it.
- **The three `already_completed` keys.** Their *condition* broadens (REQ-2); their names, their HTTP
  status and their user-facing copy do not. `web` branches on the key, so renaming or splitting one
  silently removes the replacement warning.
- **`error.upload.superseded`.** A losing upload still answers `409` with that existing key (REQ-8).
  The new `error.source.superseded` is what lands on the `MediaSource` row; the two are different
  keys for different audiences and neither replaces the other.
- **`force`'s defaults.** All eight arguments stay `Boolean = false`.

If the contract turns out wrong: stop, amend `spec.md`, re-approve, re-brief both services. Never
patch it from inside one slice (Article VIII).

## Migrations

**None.** No Prisma model, field, enum value or migration (NFR-1). `git diff -- services/api/prisma`
must be empty when this feature closes (AC-12).

Reversibility: the whole feature is a behavioural change to existing code paths with no stored state
of its own, so reverting the commits is a complete rollback. Rows this feature wrote
(`error.source.superseded` on a `MediaSource`) survive a revert harmlessly — they render through
`translateErrorKey`'s English fallback once the catalog entry is gone, and `deriveResume` still
refuses to resume them because the winning sibling is still a winner.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A call site keeps prefix-matching `resolveRace`'s message | `!message.startsWith('ganador')` against a typed object is always true, or never true. A losing upload answers `200` and the file is adopted anyway; or every winning upload answers `409`. No type error — the field still exists. | The method's return type changes, so TypeScript flags every site that reads it as a string. `git grep -n "startsWith('ganador'\|startsWith('ignorado'\|startsWith(\"ganador\|startsWith(\"ignorado" services/api/src` must return nothing (verification below). |
| `isDeliveredSource` accepts a `SCANNED` source whose jobs are still queued | A confirmed replacement demotes a source mid-encode, killing an encode the user never asked to cancel, and `047`'s cancel channel is never published so the worker keeps writing to a path whose job row now reads `ERROR`. No error anywhere. | REQ-4 is the requirement; `pipeline-status.spec.ts` covers the `WAITING`/`QUEUED`/`ENCODING` job for each of the three statuses, and the api slice owes an `AC-5`-shaped service test. |
| `hasDeliveredSource` called with the wrong target shape | `{ movieId }` where `{ episodeId }` was meant matches zero rows, the guard never fires, no warning is shown and the replacement stalls exactly as it does today — the bug this feature exists to remove, reintroduced with a passing build. | One test per target kind, not one test for "a target". The three twins are deliberately separate code (`006` § Out of Scope) and get three separate assertions. |
| The demotion runs before `qbittorrent.add()` | A rejected magnet leaves the delivered source in `ERROR` and the title with nothing in flight: the library file is still on disk and still in `filePath`, but Perceptor's own record of it reads replaced-by-nothing. Nothing errors. | AC-9 is written as a failure-path criterion; the existing episode/season ordering comment already encodes it and the movie path must copy it. |
| `resumeScanStage` ignores the arbiter | It flips a source `ERROR → READY`, calls `resolveRace` discarding the result (`downloads.service.ts:593`), and enqueues. With REQ-5 in place the arbiter writes the source back to `ERROR` and `resumeScanStage` then enqueues an `ERROR` source — a scan that runs against a row nothing will accept. | The api slice honours the outcome at that call site. In practice `065`'s `refusalKey` already blocks the Play control when a sibling is a winner, so this is a defensive fix, not a live path — but the discarded return is what would make it silent. |
| A film's `filePath` is cleared by the demotion | `027` REQ-10 inverts: the title reads replaced while pointing at nothing, and the media server shows a gap with no error. | REQ-9. `demoteDeliveredSources` writes only `MediaSource` columns; no plan step touches `Movie.filePath` or `Episode.filePath`. AC-1 asserts `file_path` unchanged. |

## Verification

```bash
bin/cli api npx --no tsc -p tsconfig.json --noEmit
bin/npm api run test
bin/comments api
bin/npm web run lint
bin/npm web run build
bin/comments web
git diff --quiet -- services/api/prisma && echo "no migration: ok"
git diff --quiet -- services/worker && echo "worker untouched: ok"
git grep -n "startsWith('ganador'\|startsWith('ignorado'" services/api/src || echo "no prefix matching: ok"
git grep -n "superseded\|already_completed" services/worker/src || echo "worker knows nothing: ok"
```

Then the manual pass, which is where AC-1 through AC-9 are actually reached. With the dev stack up:

1. **AC-1/AC-2/AC-3 — the feature.** Take a film that reads `COMPLETED` with a `SCANNED` source and
   `COMPLETED` jobs (`bin/mysql -e "select m.id, m.status, s.id, s.status from movies m join
   media_sources s on s.movie_id = m.id where m.status='COMPLETED'"`). Paste a new magnet from its
   detail page, confirm the replacement. Immediately: the old source is `ERROR` /
   `error.source.replaced`, a new one is `QUEUED`, `movies.status` is `DOWNLOADING` and
   `movies.file_path` is unchanged. When the torrent completes, the new source must reach `READY`
   then `SCANNED` with a `process_jobs` row — **not** sit at `DOWNLOADING`. When the encode finishes,
   `bin/cli worker ls -l "<file_path>"` shows a newer mtime at the same path.
2. **AC-4/AC-5 — the race is not collateral.** Attach two sources to one episode, let one reach ~50%,
   confirm a replacement with a third. The 50% source must still read `DOWNLOADING`; only the
   delivered one goes `ERROR`.
3. **AC-6/AC-7 — the silent stall, gone.** While a film's first source is encoding, attach a second
   from search (no warning appears — correct, nothing is delivered yet). When it completes:
   `bin/mysql -e "select status, error_key from media_sources where id=N"` reads `ERROR` /
   `error.source.superseded`, the torrent is stopped in qBittorrent, and `/downloads` with
   `uiLocale = es` renders `Otra fuente de este título ya se estaba procesando` with the Play control
   refused.
4. **AC-8 — the broadened guard.** Demote a film to `MISSING` by hand
   (`bin/mysql -e "update movies set status='MISSING' where id=N"`, inspection-adjacent but the only
   way to stage `069`'s outcome without the media server) while its delivered source survives. Paste a
   magnet: `error.movie.already_completed` must come back and the Replace control must appear.
5. **AC-9 — the rejected add.** Paste a syntactically valid magnet the torrent client refuses. The
   delivered source must still read `SCANNED` with `error_key` null.

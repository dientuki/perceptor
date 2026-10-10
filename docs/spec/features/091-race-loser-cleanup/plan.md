---
title: The Race Loser Sweep Actually Sweeps — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-08
status: Approved
---

# PLAN: The Race Loser Sweep Actually Sweeps (`plan.md`)

## Approach

Nothing here is a new mechanism. `022-download-status-tags` already built the sweep; this feature
moves it to where the unwind it should have been using lives, narrows what it selects, removes the
guard that stops it being called, and closes the one user-facing hole at the other end. Every step
is net-subtractive or close to it.

The pivot is **where the sweep lives**. `ProcessJobsService.sweepLosingSiblings`
(`services/api/src/process-jobs/process-jobs.service.ts`) is a second deletion path beside
`DownloadsService.unwindSource` — it removes the torrent and the row and stops, which is exactly
REQ-3's complaint. Rather than making `unwindSource` public and reaching across from
`process-jobs/`, the sweep moves **into** `DownloadsService` as a public method and
`sweepLosingSiblings` is deleted. `DownloadsService` already owns `unwindSource`, already owns
`unwindSourcesForTitle` (`067`'s batched-remove-then-unwind shape, which the new method mirrors),
and its module already imports `QueueModule`, `SettingsModule`, `MediaRootsModule` and
`TitleStatusModule` — the four things REQ-3 and REQ-5 need and `process-jobs/` would otherwise have
to acquire. `DownloadsModule` exports `DownloadsService` and does not depend on `ProcessJobsModule`,
so `ProcessJobsModule` importing `DownloadsModule` introduces no cycle. The alternative — exporting
`unwindSource` and keeping the loop in `process-jobs/` — leaves the selection logic and the unwind
in two modules with no reason, and leaves a second `targetWhere` ladder in a file that does not
otherwise need one.

The second reuse is the predicate. `deriveResume` in `pipeline-status/pipeline-status.ts` already
computes `siblings.some((sibling) => isRaceWinner(sibling.status, sibling.jobs))` to produce the
`error.download.retry_superseded` refusal for an `ERROR` source. `lostRace` is that same question
asked of a source that is not in `ERROR`, so it becomes one exported predicate read by three
callers — `deriveResume` (behaviour unchanged), `toDownload` (the new field) and `downloadStart`
(the new refusal) — rather than a second notion of "someone already won". `lostRace` needs no new
plumbing at all: `siblings: ResumeSibling[]` is already a parameter of `toDownload` at all four of
its call sites, computed by the existing `siblingsOf`/`siblingsIn` pair.

On the worker side the change is a deletion: `cleanup-source.ts`'s `if (removeTorrent && infoHash)`
loses its second term. `api`'s `downloadRemove` already applies that exact test to the winner's own
`torrentClient.remove` and already has a response written for the call the worker is withholding
(`omitido: mediaSource <id> no es un torrent`). The worker's own `CLAUDE.md` states the intended
design — "`cleanupSource` branches on `sourceKind`, not `infoHash`" — which this one line has always
contradicted.

## Order of Work

`api` first and alone, because `web` cannot render `lostRace` before the schema has it and because
`worker`'s one-line change is only *observable* once REQ-2 is in place — removing the gate while the
sweep still deletes every sibling would hand the upload-winner path a sweep that is wrong in a new
way. `web` and `worker` are independent of each other and can run in parallel once `api` lands.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the sweep's new home, the `lostRace` field the schema must expose before `web` can select it, and the REQ-2 narrowing that must exist before the worker starts calling the mutation for more winners |
| 2a | `web` | Cannot select or branch on a field the schema does not have yet |
| 2b | `worker` | Its deletion is safe only once REQ-2 narrows what the sweep touches |

**2a and 2b are genuinely parallel.** They share no file, no type and no test. Neither may start
before step 1 is merged, since both are observable only through `api`.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Three things an
implementer will be tempted to change and must not:

- **`downloadRemove` keeps its signature, its `@AllowService()` guard, its default
  `deleteFiles: Boolean = true` and its `omitido: mediaSource <id> no es un torrent` string.** From
  inside `worker` the mutation looks like it wants a new argument or a new name now that it is
  called for non-torrents; it does not. REQ-1 changes *when the worker sends it*, nothing about the
  mutation. From inside `api` the `omitido:` branch looks like dead code worth tidying; it is the
  response to the call REQ-1 restores.
- **`lostRace` is `Boolean!`, derived per request, and never stored.** It will look like it belongs
  on `MediaSource` as a column — one query instead of a sibling read. It must not become one: REQ-8
  depends on it un-setting itself the moment the winner stops being a race winner (`065`), which a
  column can only do if something remembers to write it, and nothing will.
- **`lostRace` is not an error.** `lastError` stays null and `status` stays `PAUSED` for such a row.
  An implementer reaching for `error.source.superseded` to make the row "explain itself" is
  re-creating the red badge this feature exists to avoid; the explanation is `web`-side copy.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief all three
services (Article VIII).

## Migrations

**None.** `lostRace` is derived and the sweep deletes rows. No Prisma schema change, no backfill,
nothing to roll back.

One ordering constraint that is not a migration but behaves like one: **REQ-2 reads
`MediaSource.retiredAt`, which `090-replaced-source-not-an-error` adds.** `090` is Approved and not
yet implemented. If `091` is implemented first, REQ-2 has no column to exclude on and AC-2 cannot
be satisfied — the sweep would delete the row `090` exists to preserve. Either land `090` first, or
stop and report. Do not substitute a proxy for `retiredAt` (`errorKey = 'error.source.replaced'` is
the obvious one and is wrong: `090` REQ-4 keeps that key on *undelivered* replacements, which REQ-6
here purges on purpose).

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The worker test that asserts the bug is left alone | The REQ-1 fix turns `never calls downloadRemove for a LOCAL_FILE source` red; the next person "fixes the test" by reverting the gate, and the hole returns with a green suite defending it | REQ-1 names the inversion as part of the change; `worker/plan.md` makes it its own step, not collateral |
| The sibling filter is written as a status test instead of the two predicates | `status !== 'SCANNED'` reads as "not delivered" and is not: it keeps a `SCANNED` loser whose encode failed and, with `090` in, deletes a retired row. No error anywhere — the user just finds history missing | REQ-2 names `isDeliveredSource` and `retiredAt` explicitly; `api/plan.md` requires a test with a retired sibling and a failed-encode `SCANNED` sibling in the same target |
| The old sweep is left in place beside the new one | Two sweeps run per delivery; the `process-jobs/` one still deletes every sibling, so REQ-2 is silently void while every test of the new one passes | `api/plan.md` step 5 is the deletion, and `grep -rn "sweepLosingSiblings"` returning nothing is a `Done when` condition |
| The sibling filter includes the winner | The just-delivered source's row and its downloads-root residue are destroyed moments after it delivered. The library file survives (Article XII), so the title still plays and nothing errors — the pipeline simply forgets how the file got there | The existing `id: { not: winner.id }` clause is preserved verbatim; AC-7 checks the target still reads `COMPLETED` with its path after every sweep |
| `lostRace` becomes stored, or is computed from a stale read | Play stays hidden on a loser after its winner failed, so REQ-8's fallback is unreachable through the UI and the user's only route is Delete | Contract Freeze forbids the column; `toDownload` computes it from the `siblings` argument it already receives, in the same place `retryable` is computed |
| The `downloadStart` guard is placed ahead of the `ERROR` branch | A replaced source (`090`) answers `error.download.retry_superseded` instead of the more specific `error.download.retry_replaced`; both are 409s, so the only symptom is a wrong message | `api/plan.md` fixes the placement: the guard belongs in the non-`ERROR` path only, after `deriveSourceStatus`, since `resumeErroredSource` already handles the `ERROR` case through `deriveResume` |
| REQ-4's "log and continue the unwind" is read as "log and skip the row" | Exactly today's `continue`, preserved under a new name: the row survives a torrent-client outage forever | `api/plan.md` requires the torrent-client call to be wrapped so its failure cannot short-circuit the rest of the unwind; AC-4 is the live check with `torrent` stopped |

## Verification

```bash
bin/npm api run test
bin/cli api npx tsc --noEmit
bin/npm worker test
bin/cli worker npx tsc --noEmit
bin/cli web npx tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments api
bin/comments web
bin/comments worker
git diff --stat -- services/api/prisma            # must be empty: no migration
grep -rn "sweepLosingSiblings" services/          # must be empty: the old path is gone
```

`bin/npm web run build` only with the dev stack down (root `CLAUDE.md`).

Then the manual pass, with the stack up. All of it needs a film registered and at least three
findable releases; the acceptance criteria in `spec.md` are reachable in this order, which is also
the order that reuses state rather than rebuilding it:

1. Attach three torrents to one film from the torrent modal. Watch `/downloads` show three rows.
2. When the first completes: the other two read `PAUSED` with a "Descartada" mark, no Play, a
   working Stop (AC-5's UI half). Click Play on one through the server action anyway if the button
   is somehow rendered — it must answer `error.download.retry_superseded`.
3. Let the winner's encode finish. The two loser rows disappear, their folders are gone from the
   downloads root, and the film reads `COMPLETED` with its file under the destinations root
   (AC-3, AC-7).
4. Repeat 1–2, then make the winner's scan fail (deselect every file in qBittorrent before it
   completes, which produces `error.source.scan_no_downloaded_video`). Both losers stay, Play comes
   back, starting one resumes it and it goes on to deliver (AC-6).
5. `bin/stop torrent`, repeat 1–2, then let the winner deliver: both loser rows are still deleted
   and the `api` log carries one torrent-client failure per loser (AC-4).
6. Register a second film, upload a file to it while two torrents for it are downloading, let the
   upload win and encode: both torrents are gone from qBittorrent and from `media_sources` (AC-1 —
   the hole that shipped).
7. With `090` in: force-replace a delivered film, let the replacement deliver, confirm the retired
   row survives (AC-2).
8. Attach three season packs to one season, watch the first pack's first episode finish (both other
   packs still present) and its last (both gone) (AC-8).

---
title: Automatic Episode Acquisition — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-26
status: Approved
---

# PLAN: Automatic Episode Acquisition (`plan.md`)

## Approach

Two changes land together, and the first one exists to make the second one possible.

**The comparator moves into `api`.** `services/web/src/lib/torrent-ranking.ts` is ported to
`services/api/src/indexer/ranking.ts` and deleted from `web`. The port is a *move*, not a rewrite:
every veto, every criterion and the lexicographic comparator keep their current behaviour
(REQ-4), and `services/api/src/indexer/ranking.spec.ts` is what proves it. One shape change is
unavoidable and is the whole point of the contract delta: the current function returns only the
survivors, already sorted, which is fine for a UI that swaps one array for another but useless for
a response that must also carry the rows the UI shows when the toggle is off. The ported function
returns **every** input row, in the input's order, each annotated with `ranking`, `candidate` and
`candidateRank`. "Sorted by the comparator" becomes "ordered by `candidateRank`", computed once on
the server. `web` then filters and sorts on those two fields instead of importing an algorithm.

**The ranking's inputs get one resolver, used by both callers.** Today `SearchTorrent.tsx` assembles
them in the component: the title's audio languages with a fallback to the caller's global
`/preferences`, the caller's torrent groups scoped by media type, and a cinema-capture veto that
only applies to a film. That assembly moves to a new `RankingContextService`
(`services/api/src/indexer/ranking-context.service.ts`) with exactly two entry points —
`forCaller(userId, target)` for the `searchTorrents` query, and `forShowOwners(showId)` for the
sweep's union of owners (REQ-11). Both return the same `RankingContext`, so there is one definition
of "what arms the ranking" rather than a per-caller reinvention. It reuses
`PreferencesService.findForUser`, `LanguagesService.findShow/MoviePreferredTrackLanguagesFor` and
each domain service's `findOneFromDb`/`findAudioMandatoryFor` rather than querying those tables
again.

**The sweep is a scheduled task, not a new mechanism.** `035-scheduled-tasks` already owns cadence,
enablement, the run record, the concurrency guard and the manual trigger; this feature adds one
registry entry (`acquire_episodes`, `mediaType: 'show'`) and one handler beside
`RefreshEpisodesTask`, whose shape it copies: select rows, walk them **sequentially**, catch per
item, count. Eligibility is not a bespoke query — an episode is eligible when
`deriveEpisodeStatus(...)` from `services/api/src/pipeline-status/pipeline-status.ts` reads
`MISSING`, which is the same derivation the detail page and the calendar already trust and is
already aware of the `059` season-pack lift. The attach goes through
`EpisodesService.addTorrentToEpisode`, untouched.

Two alternatives were considered and rejected. Copying the comparator into `api` and leaving
`web`'s copy in place was rejected on Article X: two lexicographic comparators with no codegen
between them drift silently, and the drift shows up as "the automatic pick disagrees with the
button". Giving the sweep a simpler rule of its own (top resolution, most seeders) was rejected for
the same reason in a different disguise — the user would have two definitions of "best" and no way
to see which one ran.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the ported comparator, the new fields on `TorrentResult` and the task. `web` cannot read a field the schema does not have. |
| 2 | `web` | Consumes `ranking`/`candidate`/`candidateRank` and deletes its own copy. |

Step 2 may be written **in parallel** with step 1 once `spec.md` is `Approved`: `web` retypes the
contract by hand anyway, so it needs the frozen delta, not a running `api`. What cannot be
parallelised is verification — the live pass in § Verification needs both slices deployed, and
`web` must not be merged in a state where it selects fields `api` does not yet expose.

Within `api`, the ranking port (and its spec) comes before the task: the task consumes
`rankTorrentResults` and `RankingContextService`.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will want to change and must not:

- **`searchTorrents` returns rows in the indexer's order, not the comparator's.** It is tempting to
  sort the response best-first and drop `candidateRank`. The default view of the modal is the
  indexer's order (`036` REQ-16), and `web` must be able to show both views from one response
  without a second query.
- **Every row carries a non-null `ranking`, vetoed rows included.** A vetoed row is not absent and
  its `ranking` is not null — it is a row with `candidate: false`. Filtering vetoed rows out of the
  response would silently change what the modal lists today.
- **There is no `allowCinemaReleases` argument.** It is derived from the target's kind and the
  caller's own preference (REQ-3). Adding it back would let a caller widen its own veto.
- **`candidateRank` is 1-based and null for a non-candidate.** Not 0-based, not `-1`.
- **The task exposes no SDL of its own.** `scheduledTasks`/`runScheduledTask` already carry any
  registry entry. A new query or mutation for "acquisition status" is out of contract.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief both services
(Constitution, Article VIII).

## Migrations

**None.** No Prisma model, field or enum changes (NFR-4).

Three Settings rows, all owned by `api`:

1. `schedule_acquire_episodes_enabled` — seeded `'false'`, catalog kind `boolean` (NFR-5).
2. `schedule_acquire_episodes_cron` — seeded `'0 3 * * *'`, catalog kind `cron`.
3. `auto_acquire_episodes_since` — seeded `''`, deliberately **not** in `SETTINGS_CATALOG`, so
   `updateSettings` refuses it like any other unknown key. Written by `api` itself, following the
   precedent in `media-server-index.service.ts` (a machine-written Setting row updated through
   `prisma.setting.update`, not through `SettingsService.updateMany`).

Existing installations: the seed adds the three rows on the next boot with `PERCEPTOR_AUTO_MIGRATE`
on; the feature stays off until an administrator flips the switch. Reversibility: turning the
switch off stops the sweep immediately on the next `arm()`; nothing it already attached is undone
(those are ordinary sources the user deletes through `/downloads` if they want them gone).

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The port changes the comparator's answer | No error anywhere: the modal quietly ranks differently, and the sweep auto-downloads a worse release every night | `ranking.spec.ts` is written fault-injection style (Article IX) over the criteria the move could plausibly reorder; AC-9 compares the live modal against today's behaviour |
| `candidateRank` computed over the wrong subset | The toggle shows candidates in an order nobody asked for; the sweep's "first candidate" is not the modal's first row — the two disagree with no error | One derivation, in `api`, consumed by both; a spec case asserts `candidateRank === 1` is the same row the comparator sorts first, and AC-4 checks the attached release against the modal's first row |
| The sweep's query string diverges from `web`'s prefill | The sweep searches `The Show S01E02`, the user sees results for a differently-cleaned string, and "there was nothing good" is really "we searched something else" | Accepted duplication, named in `api/plan.md` § Existing code to reuse: the cleaning rule is copied verbatim from `SearchTorrent.tsx`'s prefill and pinned by a unit case; AC-4 is written to compare both |
| Air-date arithmetic done in local time | The grace silently becomes 0 or 2 days depending on the host's `TZ`; an episode is attempted the day it airs, which is exactly what REQ-6 exists to prevent | UTC start-of-day arithmetic, mirroring `RefreshEpisodesTask`'s existing cutoff constant; unit cases at both boundaries |
| The cutoff row is missing while the task is armed | Interpreted as "no lower bound", the first run sweeps the entire history of every registered series and floods qBittorrent | Defensive rule (see § Decisions in the report): an empty cutoff is stamped **now** and the run proceeds with that bound, so the worst case is "nothing acquired today", never a flood |
| Every episode fails but the run reads `SUCCESS` | Prowlarr down for a week shows a green run history every morning and nobody looks | The handler rethrows when it attempted at least one episode and **every** attempt failed, so a total outage records `FAILED` (AC-6) while a single bad release does not (AC-7) |
| A second source is attached for an episode already in flight | Two torrents race for one episode, both encode, the library file is written twice | Eligibility is `deriveEpisodeStatus(...) === 'MISSING'`, the same derivation the UI trusts, which already accounts for a season pack in flight (`059`); `060`'s no-op covers the re-add of an identical infoHash |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
git diff services/api/src/schema.gql
```

The `schema.gql` diff must match `spec.md` § GraphQL Contract Delta exactly — `ReleaseRanking`, the
three new fields on `TorrentResult`, the three new arguments on `searchTorrents`, nothing else
(Article IV/VIII).

Manual pass, on a dev stack with at least one registered series:

1. Open a series, press an episode's search button. The list, the "Best candidates" toggle and the
   per-row chips behave as before (AC-9). Note the first row under the toggle.
2. Settings → Scheduling: `acquire_episodes` is listed, off (AC-1). Turn it on, save, and confirm
   `auto_acquire_episodes_since` now holds today (AC-2); save the tab again and confirm it did not
   move.
3. With an episode dated today, "Ejecutar ahora" → `SUCCESS`, 0 items, episode still `MISSING`
   (AC-3).
4. Move that episode's `releaseDate` back one day (`bin/mysql`), run again → one source attached,
   and the release title matches what step 1 showed first (AC-4).
5. Set an episode's `releaseDate` before the cutoff → repeated runs attach nothing (AC-5).
6. `docker compose stop indexer`, run again → the run records a failure with its error visible in
   the Scheduling tab; start it again and confirm the next run attaches normally (AC-6).
7. An episode with a live source, and an episode whose season has a pack in flight, are both
   skipped (AC-8).

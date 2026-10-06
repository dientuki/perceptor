---
title: Status materialization — api slice
service: api
last_updated: 2026-10-06
status: Approved
---

# PLAN: Status materialization — `api` (`api/plan.md`)

> Read `../spec.md` and `../plan.md` first. Possession is recorded in a new
> `mediaServerPresentAt DateTime?` column on `Movie` and `Episode`, **not** in the existing
> `media_server_items` index — that index cannot express an episode, since `Episode` has no `tmdbId`.
> `../plan.md` § "Why possession is a column and not the existing index" has the reasoning; `spec.md`
> REQ-4 is the requirement.

## Scope

`api` is the only service in this feature. It owns the migration, the new `title-status/` owner, the
pure changes to `pipeline-status/`, the conversion of 24 literal status writes into notifications, the
switch of the read sites to the stored column, and the torrent-state write-back.

**Not doing:** anything in `services/web/` or `services/worker/`. The GraphQL surface does not change
(`../spec.md` § GraphQL Contract Delta: "None"), so neither consumer needs a change — `web`'s
`StatusBadge` already handles all eight values and `worker` reads no title status. If a change here
appears to require a `web` or `worker` edit, the contract is wrong: **stop and report**, do not edit
another service (`.claude/agents/api.md`).

Also not doing: adding a poller, a scheduled task or an interval for torrent state (REQ-10 forbids it),
and not adding a single new call to the torrent client (NFR-1).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/prisma/schema.prisma` | Modified | `MediaStatus` gains `QUEUED`, `PAUSED`, `DOWNLOADED`; `Movie` and `Episode` gain `mediaServerPresentAt DateTime?` |
| `services/api/prisma/migrations/<ts>_widen_media_status/` | New | the enum widening |
| `services/api/prisma/migrations/<ts>_add_media_server_presence/` | New | the two columns **and** the SQL backfill of `mediaServerPresentAt` |
| `services/api/src/scripts/recompute-statuses.ts` | New | the one-shot, idempotent recompute of every title after `migrate deploy` (NFR-3) |
| `services/api/src/pipeline-status/pipeline-status.ts` | Modified | `deriveTitleStatus` loses its stored-status input and gains possession; `toMediaStatus` deleted; `deriveShowStatus` added |
| `services/api/src/pipeline-status/pipeline-status.spec.ts` | Modified | the ladder's new shape, the possession arm, the `Show` aggregation |
| `services/api/src/title-status/title-status.module.ts` | New | imports `PrismaModule` only |
| `services/api/src/title-status/title-status.service.ts` | New | `recomputeMovie` / `recomputeEpisode` / `recomputeSeason` / `recomputeShow` — the only writer of the three status columns |
| `services/api/src/title-status/title-status.service.spec.ts` | New | Article IX: every silent failure in this slice lives here |
| `services/api/src/downloads/downloads.service.ts` | Modified | `recomputeMovieStatus`/`recomputeEpisodeStatus` moved out; 4 literal writes → notifications; torrent write-back added |
| `services/api/src/downloads/downloads.module.ts` | Modified | imports `TitleStatusModule` |
| `services/api/src/movies/movies.service.ts` | Modified | 2 literal writes → notifications; `withDerivedStatus` reads the column |
| `services/api/src/movies/movies.module.ts` | Modified | imports `TitleStatusModule` |
| `services/api/src/episodes/episodes.service.ts` | Modified | 2 literal writes → notifications |
| `services/api/src/episodes/episodes.module.ts` | Modified | imports `TitleStatusModule` |
| `services/api/src/shows/shows.service.ts` | Modified | the two episode read sites read the column |
| `services/api/src/seasons/seasons.service.ts` | Modified | season-scoped acquisition notifies a season recompute |
| `services/api/src/seasons/seasons.module.ts` | Modified | imports `TitleStatusModule` |
| `services/api/src/uploads/uploads.service.ts` | Modified | 4 literal writes → notifications |
| `services/api/src/uploads/uploads.module.ts` | Modified | imports `TitleStatusModule` |
| `services/api/src/media-sources/media-sources.service.ts` | Modified | 3 literal writes → notifications |
| `services/api/src/media-sources/media-sources.module.ts` | Modified | imports `TitleStatusModule` |
| `services/api/src/process-jobs/process-jobs.service.ts` | Modified | 4 literal writes → notifications (`filePath` still written) |
| `services/api/src/process-jobs/process-jobs.module.ts` | Modified | imports `TitleStatusModule` |
| `services/api/src/media-server/media-server-reconcile.service.ts` | Modified | writes/clears `mediaServerPresentAt` beside the status it already writes |
| `services/api/src/clients/torrent/client.ts` | Modified | `queuedDL` moves from `DOWNLOADING_STATES` to a `QUEUED` mapping |
| `services/api/src/clients/torrent/client.spec.ts` *(or the nearest existing spec)* | New/Modified | the three buckets stay distinguishable |
| `services/api/src/scheduler/tasks/refresh-episodes.task.ts` | Modified | recomputes the series it already walks (REQ-12) |

A **new module** not listed here means this plan missed something — report it.

## Existing code to reuse

- **`src/pipeline-status/pipeline-status.ts`** — the whole derivation. `RANK`, `maxStatus`,
  `translateSourceStatus`, `isLiftedBySeasonPack`, `deriveTitleStatus`, `deriveEpisodeStatus`,
  `isRaceWinner`, `isDeliveredSource`, `deriveResume`. Do not write a second ladder. It stays a
  **pure module with no Nest module and no Prisma import** (`services/api/CLAUDE.md`: "a plain
  exported function, no Nest module, no injection") — that is what makes it unit-testable, and NFR-6
  requires it.
- **`DownloadsService.recomputeMovieStatus` / `recomputeEpisodeStatus`** (`downloads.service.ts:838`)
  — already the exact shape `TitleStatusService` needs: seed at `MISSING`, read sources and jobs,
  write. **Move them, do not reimplement them.** `047`'s unwind
  (`unwindSourcesForTitle`) keeps calling them through the new service.
- **`DownloadsService.writeStatusIfNonTerminal`** (`:499`) — the REQ-8 guard, with `DOWNLOADING`
  already in `NON_TERMINAL_STATUSES`. Every write-back goes through it. Never a bare
  `mediaSource.update({ data: { status } })`.
- **`DownloadsService.liveInfoByHash` / `liveInfoForHash`** (`:170`, `:873`) — the readings REQ-7
  persists. Both already return every row the call brought back; `liveInfoForHash` already calls
  `info()` **untagged** and discards all but one. Persist what they already hold; fetch nothing.
- **`mapTorrentState`** (`clients/torrent/client.ts:42`) — REQ-9 is one string moving between two
  existing `Set`s plus a `QUEUED` return. Do not restructure the mapping or narrow the coarse
  grouping: `stalledDL`, `metaDL`, `allocating`, `checkingDL`, `checkingResumeData`, `forcedDL` and
  the unrecognised-state fallback all stay `DOWNLOADING`.
- **The guarded-`updateMany` pattern** at `media-server-reconcile.service.ts:128` and
  `process-jobs.service.ts:402` — `where` names the status it expects to replace. This is how NFR-2 is
  satisfied; follow it rather than inventing a lock.
- **`i18nError`** (`src/i18n/i18n-error.ts`) — if anything in this slice ever throws user-facing. It
  should not: a failed recompute writes nothing and surfaces nothing (NFR-4).
- **`src/scripts/`** — the existing one-shot script conventions (`reset-password.ts`,
  `mint-service-token.ts`) for the backfill recompute. Follow them; do not add a CLI framework.

## Steps

**Step 1 — migration: widen the enum.** `MediaStatus` gains `QUEUED`, `PAUSED`, `DOWNLOADED` (REQ-5).
Generated with `bin/npm api run prisma:migrate`. Additive; nothing is rewritten.

**Step 2 — migration: possession columns.**
`mediaServerPresentAt DateTime?` on `Movie` and `Episode`, nullable, no default. In the **same**
migration, backfill:

```sql
update movies   set media_server_present_at = now() where status = 'COMPLETED' and file_path is null;
update episodes set media_server_present_at = now() where status = 'COMPLETED' and file_path is null;
```

Exact rather than a guess: `filePath` is written in exactly one place
(`process-jobs.service.ts:307`) and always together with `COMPLETED`, so `COMPLETED` with a null
`filePath` is reachable only through reconciliation.

**Step 3 — `pipeline-status/`, pure changes, with its tests.** Nothing else moves until this is green.

1. `deriveTitleStatus` drops `status: MediaStatus` from `TitleAltitudeInput` and gains possession:
   `{ filePath: string | null; mediaServerPresentAt: Date | null }`. Possession ⇒ `COMPLETED`
   (REQ-3/REQ-4), and it is checked **before** the ladder. The seed becomes `MISSING` unconditionally —
   which is what `recomputeMovieStatus` already passes, so the ladder itself does not change.
2. Delete `toMediaStatus` (REQ-5). Fix its two call sites in `downloads.service.ts` by deletion, not
   by widening it.
3. `069` REQ-17's exclusions stay: a `SCANNED` source and a `COMPLETED` job still do not lift. Do not
   "fix" them — with possession now an explicit input, they are what keep a demotion sticking.
4. Add `deriveShowStatus(episodes, now)` (REQ-11): `COMPLETED` when every **aired** episode is
   `COMPLETED`; aired is `releaseDate !== null && releaseDate <= now`, the same test
   `isLiftedBySeasonPack` already applies — reuse it rather than re-expressing the predicate.
   Otherwise the max over the episodes by the existing ladder. No aired episode ⇒ `MISSING`.
   `Show` has no `filePath` and no possession column; it aggregates only.

**Step 4 — `title-status/`.** New module importing **only** `PrismaModule`. `TitleStatusService`
exposes `recomputeMovie(movieId)`, `recomputeEpisode(episodeId)`, `recomputeSeason(seasonId)`,
`recomputeShow(showId)` — each taking an **id and nothing else**. It injects nothing from any caller,
so the Nest graph stays a tree; if a dependency is needed in the other direction, stop and report.

Blast radius is this service's responsibility, not the caller's:

- `recomputeEpisode` cascades to `recomputeShow` of its series.
- `recomputeSeason` recomputes **every episode of the season** before the show — required by REQ-13,
  because the `059` lift now has to be un-written when a pack is scanned, errors or is deleted.
- Each write is a guarded `updateMany` (NFR-2).
- A target that no longer exists is a silent no-op (the two moved methods already do this via
  `if (!movie) return`).

**Step 5 — convert the 24 literal writes.** Each becomes a notification passing the id. Delete the
literal; do not keep it "for clarity". The complete inventory:

| File | Lines | Today |
| :-- | :-- | :-- |
| `movies/movies.service.ts` | 732, 780 | `movie.status = 'DOWNLOADING'` at attach |
| `episodes/episodes.service.ts` | 142, 188 | `episode.status = 'DOWNLOADING'` at attach |
| `media-sources/media-sources.service.ts` | 63, 67 | `'ERROR'` on scan failure |
| `media-sources/media-sources.service.ts` | 233 | `'ENCODING'` when the scan enqueues |
| `uploads/uploads.service.ts` | 232, 280 | `'ENCODING'` on upload close |
| `uploads/uploads.service.ts` | 306, 320 | `'ERROR'` |
| `downloads/downloads.service.ts` | 272, 285 | `'ERROR'` |
| `downloads/downloads.service.ts` | 1046, 1053 | `'ENCODING'` on `torrentCompleted` |
| `downloads/downloads.service.ts` | 847, 852, 863, 868 | the two `recompute*Status` bodies — moved in Step 4, their call sites now call the service |
| `process-jobs/process-jobs.service.ts` | 307, 312 | `'COMPLETED'` + `filePath` — **keep writing `filePath`**, drop only the status |
| `process-jobs/process-jobs.service.ts` | 393, 395 | `'ERROR'` via `propagateJobError` |

`media-server-reconcile.service.ts` (`:60`, `:101`, `:128`, `:132`, `:207`) is **not** in this list.
Those writes are the media server's verdict, which `069` REQ-17 makes authoritative — see Step 6.

**Step 6 — reconciliation records possession.** In `media-server-reconcile.service.ts`, every place
that promotes to `COMPLETED` also sets `mediaServerPresentAt: new Date()`, and every place that
demotes also clears it to `null` **in the same `updateMany`** as the existing `filePath: null`
(`:133`, `:207`). A demotion that clears `filePath` but not the presence column only half-works: the
next recompute reads possession and promotes the title straight back, with no error anywhere. Covers
all five sites, including `reconcileShow`'s per-episode promotion at `:101`, which is the one the
index could never have expressed.

**Step 7 — switch the read sites to the column.** Must not land before Step 5.

- `movies/movies.service.ts:153` — `withDerivedStatus` returns `movie.status` directly.
- `shows/shows.service.ts:118`, `:139` — the two `deriveEpisodeStatus` calls return the stored
  episode status. `/calendar` inherits this through `ShowsService.findEpisodesReleasedBetween`, which
  is why the calendar and the detail page still cannot disagree.
- **`scheduler/tasks/acquire-movies.task.ts:46` and `acquire-episodes.task.ts:67` keep reading the
  live rows** — do *not* switch them to the column. Their question is "is there work in flight",
  which the sources and jobs answer directly, and a momentarily stale `MISSING` would make the sweep
  attach a second release for a title already downloading, spending bandwidth with no error anywhere
  (`087`'s guard refuses a `COMPLETED` target, not a `QUEUED` one). This is a deliberate asymmetry,
  not an oversight.

**Step 8 — torrent write-back (REQ-7) and the three buckets (REQ-9).**

1. In `clients/torrent/client.ts`, move `queuedDL` out of `DOWNLOADING_STATES` and return
   `SourceStatus.QUEUED` for it. Nothing else in the mapping changes.
2. In `DownloadsService`, after each existing live read, persist **every row the call returned** —
   not only the row the caller asked about — through `writeStatusIfNonTerminal`. The three sites:
   `liveInfoByHash` (serving `movieDownloads`, `showDownloads` and `downloads`) and `liveInfoForHash`
   (serving `downloadStart`, `downloadStop`, `downloadDelete`). An empty map from a failed read writes
   nothing (NFR-4).
3. A write-back that actually changed a source's status notifies that source's target. Do not
   recompute per row unconditionally — a `/downloads` load touching fifty unchanged rows must not fire
   fifty recomputes.

**Step 9 — the airing transition (REQ-12).** `refresh_episodes` already walks episodes daily; have it
recompute the series it touched. It must not depend on a task the installation opted into — if the
chosen host is opt-in, put the recompute where it runs unconditionally instead, and say so in the
report.

**Step 10 — the backfill script.** `src/scripts/recompute-statuses.ts`: recompute every `Movie`,
`Episode` and `Show` through `TitleStatusService`. Idempotent by construction. Invoked after
`migrate deploy`; it is what un-sticks every title left at `DOWNLOADING` by the ratchet and the only
thing that moves `Show.status` off `MISSING` on an existing install (NFR-3).

## Contract obligations

`api` exposes **no new GraphQL surface**, and that is the obligation: `../spec.md` § GraphQL Contract
Delta is read-only.

What `api` owes the two consumers it is not editing:

- **`Movie.status` / `Show.status` / `Episode.status` keep emitting the eight-value `PipelineStatus`
  vocabulary as `String!`.** They do today, from `deriveTitleStatus`. Step 7 switches to the column, so
  **Step 1 must already have widened the enum** — otherwise the wire silently narrows to five values
  and `QUEUED`/`PAUSED`/`DOWNLOADED` vanish. `web`'s `StatusBadge` would simply stop matching, with no
  compile error: there is no codegen.
- **`Show.status` starts moving off `MISSING`.** First time any value but `MISSING` crosses for a
  series. No consumer change is owed — same field, same vocabulary `Movie`/`Episode` already use — but
  it is behaviourally visible, and `docs/spec/graphql-contract.md` must record it beside the existing
  `Episode.status` note from `059`. That doc edit is a `[docs]` task, not an `api` one.
- **`Download.status` is unchanged**, still derived per row by `deriveSourceStatus`'s six rules from
  the live reading. REQ-7 changes where `DOWNLOADING` is stored, not what `/downloads` sends.
- **No new error key.** A failed recompute, an unreachable torrent client and an absent possession
  record all write nothing and surface nothing (NFR-4, NFR-5). Do not add an `ERROR_KEYS` entry for
  any of them.
- **Nothing in this slice reads or writes `media_server_items`.** Possession is the two row-level
  columns (REQ-4). An earlier draft of the spec routed it through the index and carried a
  registration-time requirement to populate it; both are gone, and `MediaServerIndexService` is
  untouched. If a step seems to need the index, re-read `../plan.md` § "Why possession is a column".

If any of this is wrong, **stop and report**. Do not adapt the contract from inside this slice
(Article VIII).

## Tests

Article IX: tests are owed where failure is silent. Every failure mode in this feature is silent —
nothing throws — so this slice is unusually test-heavy, and each file opens with the paragraph naming
what it defends against. The two standards to imitate are
`src/media-roots/media-roots.service.spec.ts` and `src/clients/torrent/magnet.spec.ts`; the
`expect(service).toBeDefined()` files under `src/users/` are scaffolding and must not be imitated.

- **`src/pipeline-status/pipeline-status.spec.ts`** (modified) — defends against the ratchet itself:
  that `deriveTitleStatus` can now *fall*. A source moving `QUEUED → PAUSED` must lower the answer,
  which is impossible to assert while the stored status is an input. Plus possession beating the
  ladder, `deriveShowStatus` ignoring unaired episodes, and a series with no aired episode reading
  `MISSING`. This is the cheapest place to prove REQ-2, because the module is pure.
- **`src/title-status/title-status.service.spec.ts`** (new) — defends against the blast radius being
  wrong, which is silent by definition: a season-scoped change that does not recompute its episodes
  leaves the `059` lift stuck at `QUEUED` forever (REQ-13), and an episode recompute that does not
  cascade to its show leaves a series reading `COMPLETED` after an episode is lost. Also: a
  media-server-promoted target with no `filePath`, no source and no job is **not** demoted — a film (AC-8)
  and an episode (AC-9), the case the index could never express. Plus: a demotion clears both columns
  so a recompute does not promote the title straight back (AC-10), and a null possession value never
  demotes on its own (AC-11, NFR-5).
- **`src/downloads/downloads.service.spec.ts`** (modified) — defends against the two destructive
  write-back failures. A `SCANNED` source whose torrent is seeding must not be demoted to `READY`
  (AC-4): unguarded, `isRaceWinner` hands the race to a source whose encode already failed. And a
  failed/empty live read must write nothing rather than demoting every source (AC-5, NFR-4). Also
  that a write-back persists **every** row the call returned (AC-7), since persisting only the acted-on
  row is the plausible wrong implementation and produces no error.
- **`src/clients/torrent/client.spec.ts`** (new or extended — follow `magnet.spec.ts`'s header
  convention) — defends against the buckets collapsing again: `queuedDL → QUEUED`,
  `stalledDL`/`metaDL`/`allocating`/`checkingResumeData` → `DOWNLOADING`, an unrecognised state →
  `DOWNLOADING` with the loud log rather than `ERROR` (the regression `037` fixed), and a completed
  torrent → `READY`.
- **`src/media-server/media-server-reconcile.service.spec.ts`** (modified, if it exists; new
  otherwise) — defends against the half-demotion: clearing `filePath` without clearing
  `mediaServerPresentAt` makes the next recompute promote the title straight back, and `069`'s
  demotion silently stops working (AC-10). Covers the per-episode promotion at `:101` too.

**Not owed a test, with the reason:** the Nest module wiring (`*.module.ts`) — a missing provider
fails at boot, loudly, not silently. The 24 call-site conversions in Step 5 are not each owed a test
either: they are one-line notifications whose behaviour is entirely in `TitleStatusService`, which is
tested above, and AC-15's grep is the standing check that no literal returned. The backfill script is
covered by NFR-3's verification rather than a unit test, because what it must get right is a real
database's contents.

## Done when

```bash
bin/npm api run prisma:migrate
bin/npm api run test
bin/cli api npx tsc --noEmit
bin/comments api
```

All four clean. Then:

```bash
bin/mysql -e "select status, count(*) from media_sources group by status"
bin/mysql -e "select status, count(*) from shows group by status"
grep -rn "status: *'\(DOWNLOADING\|ENCODING\)'" services/api/src --include=*.ts | grep -v spec.ts
```

`media_sources` shows a non-zero `DOWNLOADING` while a torrent transfers (zero today in every state
of the system). `shows` shows rows outside `MISSING` (all `MISSING` today). The grep returns no
`movie.update` / `episode.update` / `show.update` call site.

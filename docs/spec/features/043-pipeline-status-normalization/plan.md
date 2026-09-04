---
title: Pipeline Status Normalization — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-03
status: Implemented
---

# PLAN: Pipeline Status Normalization (`plan.md`)

## Approach

The whole feature is one pure function and its two callers. `api` gains a leaf module,
`src/pipeline-status/`, holding a **pure** `pipeline-status.ts` — no Nest decorators, no Prisma, no
injection, taking plain rows and returning `{ status, downloadProgress, encodeProgress }`. That is
the single derivation REQ-2 demands, and being pure is what makes it testable at the granularity
Article IX wants without a database.

Two callers reach it, at two altitudes, and the difference between them is the load-bearing part of
this plan:

- **Source altitude** (`DownloadsService.toDownload`) has one `MediaSource` in hand, its own
  `ProcessJob` rows, and optionally the live qBittorrent reading. It runs REQ-3's six rules exactly
  as written.
- **Title altitude** (`MoviesService`, `ShowsService`) has a `Movie`/`Episode` row, its
  `mediaSources` and its `processJobs`, and by REQ-5 **no live reading at all**. It runs REQ-4's
  maximum.

The reuse story is unusually good here, because most of what this needs already exists and is
currently being thrown away:

- **`mapTorrentState`** (`src/clients/torrent/client.ts`) already collapses qBittorrent's dozen
  states into a `SourceStatus`, with the 5.0 `stopped*` spellings that `022` fixed, and already logs
  and falls back rather than throwing on an unknown state. `TorrentClientInfo.state` carries the
  result to `DownloadsService` **and is discarded there today** — rule 5 is largely a matter of
  reading a value the request already computed. Do not write a second state table.
- **`MoviesService.findAll` and `findOneFromDb` already `include: { mediaSources: true,
  processJobs: true }`.** NFR-6 is satisfied for films with **no query change whatsoever**. Verify
  this before assuming otherwise; it is the reason the movies slice is small.
- **`where: { sourceFile: { mediaSourceId } }`** is the established traversal from a source to its
  jobs (`ProcessJobsService.encodeCompleted` computes its cleanup verdict this way). `MediaSource`
  has **no direct `processJobs` relation** — the path is `sourceFiles → processJob`. Reuse this
  `where`; do not add a relation to the schema (NFR-1).

**The two altitudes fall out of the model; they are not a design choice.** `ProcessJob` carries
`movieId`/`episodeId` and nothing else, because a film and an episode are the **leaves** — the
things that become one file. `Show` and `Season` are containers (a series holds seasons, a season
holds episodes), so no media→job relation exists for them and none should be added. Crossing that
with the other axis, `sourceFile → processJob`, which is file→job and 1:1, gives the split:

- A **season pack** can only be reached file-first. Its `MediaSource` targets a `seasonId`, there is
  no `season.processJobs`, so the panel row's `encodeProgress` comes from
  `where: { sourceFile: { mediaSourceId } }` — the only path that reaches it.
- An **episode inside that pack** can only be reached media-first. It has no `MediaSource` of its
  own (the source belongs to the season) but it does have `processJobs`, denormalized per episode by
  `sourceScanned`.

Neither altitude can serve the other's case. Do not try to collapse them into one function.
- **`settingsMap['compression_enabled'] !== 'false'`** is the exact predicate
  `ProcessJobsService.getEncodeJobDetails` uses. `DownloadsModule` already imports `SettingsModule`,
  which exports `SettingsService`. Copy the predicate verbatim — an installation where the panel and
  the encoder disagree about whether compression is on is precisely this feature's class of bug.

### Two decisions the spec did not pin down

**1. Title altitude does not group jobs by source, and takes `ERROR` from the column only.**
REQ-4's wording ("the derived status of each of its non-`ERROR` `MediaSource` rows") reads as though
the title derivation runs REQ-3 per source, which would need each job's owning source — a
`sourceFiles` join on every listing row. It does not, and it must not: `Movie.processJobs` and
`Episode.processJobs` are **denormalized** columns (`movieId`/`episodeId` on `ProcessJob`, added
precisely "para consultar por media sin join extra"), so the title's whole job set is already in
hand.

The title rule is therefore: `ERROR` if and only if the **stored column** is `ERROR`; otherwise the
maximum, over the REQ-4 ranking, of (a) the column, (b) each non-`ERROR` source's status translated,
and (c) the job set with `ERROR` jobs ignored — `ENCODING` if any remaining job is
`WAITING`/`QUEUED`/`ENCODING`, `COMPLETED` if there is at least one and all remaining are
`COMPLETED`.

Taking `ERROR` from the column alone is not a shortcut, it is what makes AC-7 and AC-8 both pass at
once. `encodeCompleted`/`encodeFailed` already skip the title update when their source has been
demoted (`ProcessJobsService`, `038` REQ-8), so the column is *already* the row that knows whether a
failure belongs to this title or to a superseded attempt. Reading `ERROR` off the raw job set would
undo that guard and make a demoted attempt's failed job poison a completed title — exactly AC-8.

**2. `downloadStart` must not write `QUEUED` unconditionally.** REQ-7 says the two control mutations
record their intent on the row. Written naively, `downloadStart` on a finished torrent that is
merely seeding would move a `READY`/`SCANNED` source back to `QUEUED`, and the title would walk
backwards through the ranking — a direct NFR-3 violation, introduced by the requirement meant to
support it. Both writes are therefore **guarded to non-terminal statuses only**
(`PENDING`/`QUEUED`/`DOWNLOADING`/`PAUSED`), in the `where` clause of an `updateMany`, never as a
read-then-write. This is the same shape `MediaServerReconcileService` uses to make its
`MISSING`→`COMPLETED` promotion atomic against a concurrent `torrentCompleted`, and it is used here
for the same reason.

### Alternatives rejected

- **Persisting a normalized column.** Rejected in `spec.md` § Out of Scope: it needs a write at
  every one of ~30 existing transition sites, which is the drift this feature removes.
- **Reconciling `MediaSource.status` when its jobs complete** (moving `SCANNED` to something
  terminal). That is the same idea in miniature, adds a write to the encode path, and the derivation
  makes it unnecessary.
- **Wrapping the existing `src/components/ui/badge/Badge.tsx`** for the web status pill. Rejected:
  `Badge` takes no `className`, so the pill's `uppercase tracking-wider` and the pulsing
  in-progress state would require widening a shared template component — the trap
  `services/web/CLAUDE.md` names for `InputField`. Its `size="md"` also renders the banned
  `text-sm`. `StatusBadge` is standalone and owns the markup both call sites already duplicate.

## Order of Work

`api` first, and not only by convention: `web` cannot select `encodeProgress` or `compressionEnabled`
from a schema that does not have them, and the `progress` → `downloadProgress` rename means the two
slices are **mutually breaking** in one direction — `web` selecting the new name against an old
schema gets a GraphQL validation error, while `web` still selecting `progress` against the new
schema also fails. There is no window in which a half-deployed pair works.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the derivation, the `Download` shape and the two renamed/new fields every `web` step reads |
| 2 | `api` | The title-altitude wiring (`movies`, `shows`) and the REQ-7 control writes — independent of step 1's entity changes, same service |
| 3 | `web` | Retypes `Download`, adds the catalogs, unifies the badge, draws the bars |

**Parallelism**: steps 1 and 2 are independent within `api` and may be done in either order or
together. Step 3 may be **authored** in parallel with 1-2 — the contract is frozen as of this
document, so `web` has everything it needs — but it cannot be **verified** until `api` is running
with step 1 merged. Do not report step 3 green on a typecheck alone; AC-2 and AC-6 are runtime.

`worker` does not appear in this table. It has no step (NFR-2).

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Implementers read
it; they do not edit it. Four things will look wrong from inside one slice and are right for the
feature:

- **`MediaSource.status` stays raw `SourceStatus`** (REQ-8) while `Download.status` beside it is
  normalized. From inside `api` this reads as a missed spot. It is not: the worker selects
  `mediaSource(id) { status }` in `source-ready.job.ts`, and normalizing it would change a contract
  a service outside this feature reads. Leave it.
- **`Show.status` stays broken.** It is `MISSING` for the life of every row because nothing writes
  it. Fixing it is a product question (what *is* a series' status?), excluded by explicit request.
  Do not opportunistically derive it because the code is right there.
- **`progress` → `downloadProgress` is a rename, not an addition.** Do not keep `progress` as an
  alias "for safety". A deprecated duplicate of a status/progress field is how this codebase got
  into this state; the whole point is one name per fact. `web` is the only consumer.
- **The status stays `String!`, not a GraphQL enum.** `graphql-contract.md` fixed that for `Movie`
  and `Show` together. Registering an enum for one type is the specific thing that note forbids.

If the contract turns out wrong mid-flight: stop, amend `spec.md`, re-approve, re-brief both
services. Never patch it from inside a slice (Constitution, Article VIII).

## Migrations

**None.** No model, field or enum changes (NFR-1); `git status services/api/prisma/` must stay clean
for the whole feature, and AC-13 checks exactly that.

REQ-7 writes two values into the existing `MediaSource.status` column — `PAUSED` and `QUEUED`, both
already declared by `SourceStatus`, both already written elsewhere by the race arbiter and the
acquisition path respectively. No existing row changes meaning, and no backfill exists to run: every
status a user sees after this ships is computed from rows as they already stand.

Reversibility: complete. Reverting the commits restores the previous reporting behaviour with no
data to undo — which is the main practical argument for deriving rather than persisting.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The `progress` → `downloadProgress` rename lands in one service only | `web` renders `—` in the progress column forever. No error, no console warning, no failed build — the field is simply absent from the response | The two slices ship together (Order of Work); AC-2 requires seeing a *moving* percentage, which a `—` cannot satisfy |
| Title derivation reads `ERROR` off the raw job set | A superseded attempt's failed job turns a completed title red. Silent: the title is genuinely in the library, and the row that says so is being ignored | Approach § decision 1 takes `ERROR` from the column only; AC-8 is the regression test, and the unit case must be written fault-injection style |
| `downloadStart` writes `QUEUED` over a `READY` source | The title walks backwards from `DOWNLOADED`/`COMPLETED` to `QUEUED` on a click that was supposed to be a no-op. Silent — the click succeeded | Approach § decision 2: `updateMany` guarded on non-terminal statuses in its `where`. AC-10 exercises the pause; the guard is owed a unit case of its own |
| Job progress averaged over the wrong set | A season pack shows one episode's percentage as the pack's, or a demoted source's job drags the mean down. Plausible-looking number, no error | Group strictly by `sourceFile.mediaSourceId`; AC-5 pins the arithmetic at three jobs (100/50/0 → 50) |
| The live 0..1 → 0..100 conversion happens twice | Every download renders at 1% | The conversion stays exactly where it is today, in `DownloadsService`; `TorrentClientInfo.progress` remains 0..1 at the adapter boundary. `graphql-contract.md` already warns about this |
| `compression_enabled` read with a different predicate than the encoder's | The panel draws a compression bar for an installation that never compresses, or hides it for one that does | Copy `settingsMap['compression_enabled'] !== 'false'` verbatim from `ProcessJobsService`; AC-4 checks the false branch |
| Rule order rewritten as a `switch` on the source status | The six REQ-3 rules stop being ordered; a `SCANNED` source with a completed job resolves to `DOWNLOADED` instead of `COMPLETED`, reintroducing the reported Daredevil bug in a new place | The rules are a sequence of early returns in the order written; AC-1 is the guard and its unit case must fail when rule 2 is removed |
| An episode inside a season pack derives from its own (empty) `mediaSources` | Every episode of a pack reads `MISSING` while it encodes, because the source belongs to the *season*, not the episode | Title altitude uses `episode.processJobs` (denormalized, populated per episode by `sourceScanned`) as well as `episode.mediaSources`. Worth an explicit unit case |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

Baseline to beat, **re-measured before touching anything** rather than cited: `api` was 342 tests
across 36 suites at 0 errors as of `042-encode-global-language-preferences` (2026-09-03); `web`
typechecks at 0 and builds clean. `web` has no test runner and none is being added.

Then the manual pass, on the two titles that produced this spec:

1. `bin/dev` and sign in.
2. **AC-2** — open a film with a torrent actively downloading. The status beside the title and the
   status in the downloads panel must read the same word, and the panel's download bar must advance
   between two refreshes. Before this feature these read `DOWNLOADING` and `QUEUED`.
3. **AC-1** — open a series with a finished episode. The season accordion's badge and that
   episode's panel row must both read *Completado*. Before this feature the panel read `SCANNED`.
4. **AC-3/AC-4** — with a job encoding, confirm two bars; flip `compression_enabled` off in
   `/settings` and confirm the second bar disappears without a reload of anything but the page.
5. **AC-10** — click *Detener* on a live download, confirm *Pausado*; then
   `docker compose stop torrent`, reload, and confirm it still reads *Pausado* rather than falling
   back to a queued-looking state. This is the only check that proves REQ-7's write landed.
6. **AC-6** — with `torrent` still stopped, confirm the panel renders every row with `—` for
   progress and speed, and no error banner.
7. `docker compose start torrent`.
8. **AC-13** — `git diff --stat` touches nothing under `services/worker/` or
   `services/api/prisma/`.

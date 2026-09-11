---
title: Downloads panel repair — api slice
service: api
last_updated: 2026-09-11
status: Implemented
---

# PLAN: Downloads panel repair — `api` (`api/plan.md`)

## Scope

This service owns the whole casing defect (REQ-1..REQ-4) and the persistence and exposure half of
the encode speed (REQ-8's storage, REQ-9's field, REQ-10, NFR-1, NFR-4). It owns the migration and
both halves of the contract its two consumers read.

It is **not** doing: the parsing of FFmpeg's `speed=` (that is `worker`), any rendering or
formatting decision (that is `web`), and nothing about REQ-5/6/7, which are `web`-local.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/clients/indexer/client.ts` | Modified | `item.infoHash?.toUpperCase()` → `.toLowerCase()`; `extractInfoHashFromGuid`'s `toUpperCase()` → `toLowerCase()` |
| `services/api/src/clients/torrent/client.ts` | Modified | `normalizeHashes` lowercases every hash it joins |
| `services/api/src/media-sources/media-sources.service.ts` | Modified | Deletes the now-redundant `.toLowerCase()` at the `files()` call site |
| `services/api/prisma/schema.prisma` | Modified | `ProcessJob.encodeSpeed Float?` |
| `services/api/prisma/migrations/<new>/migration.sql` | New | The column add plus the `media_sources.info_hash` `LOWER()` rewrite |
| `services/api/src/pipeline-status/pipeline-status.ts` | Modified | `SourceAltitudeJob.encodeSpeed`, `DerivedProgress.encodeSpeed`, surfaced from Rule 3 only |
| `services/api/src/downloads/downloads.service.ts` | Modified | New private `liveFor`; both list call sites use it; `jobsBySourceId` selects `encodeSpeed`; `toDownload` carries it through |
| `services/api/src/downloads/entities/download.entity.ts` | Modified | `encodeSpeed?: number` as a nullable `Float` |
| `services/api/src/process-jobs/process-jobs.resolver.ts` | Modified | `encodeProgress` gains an optional `speed` argument |
| `services/api/src/process-jobs/process-jobs.service.ts` | Modified | `encodeProgress` persists it; `encodeCompleted`/`encodeFailed` null it |
| `services/api/src/downloads/downloads.service.spec.ts` | Modified | The casing join cases |
| `services/api/src/pipeline-status/pipeline-status.spec.ts` | Modified | The `encodeSpeed`-only-while-ENCODING cases |
| `services/api/src/clients/indexer/client.spec.ts` | Modified | The grouping key is lowercase |

## Existing code to reuse

- **`services/api/src/clients/torrent/client.ts`'s `files()`** — already lowercases its hash inline,
  with the cause in its doc comment (`052-deselected-torrent-files`). `normalizeHashes` is the same
  rule for the three mutating endpoints; put it there rather than repeating `.toLowerCase()` at each
  of `start`/`stop`/`remove`. Once `normalizeHashes` owns it, the caller-side lowercase in
  `media-sources.service.ts` is a second defense against one bug — delete it (Article X). `files()`'s
  own inline lowercase stays: it is a different code path that does not go through `normalizeHashes`.
- **`services/api/src/pipeline-status/pipeline-status.ts`'s `deriveSourceStatus`** — the single
  derivation behind every status and progress number a user reads (`043-pipeline-status-normalization`).
  `encodeSpeed` belongs here, beside `encodeProgress`, not computed a second time in
  `DownloadsService`. Its six rules are **ordered early returns and the order is the specification** —
  add a field to the returns, never reorder or collapse them.
- **`meanProgress` in the same file** — the existing idiom for reducing a season pack's several jobs
  to one number. `encodeSpeed`'s aggregation mirrors it rather than inventing a different shape.
- **`DownloadsService.jobsBySourceId`** — already loads every listed source's `ProcessJob` rows in
  **one** query grouped by `mediaSourceId` (the standing REQ-3 of `022-download-status-tags`). Add
  `encodeSpeed` to its `select`; do not add a query. This is what makes NFR-1 free.
- **`i18nError` / `ERROR_KEYS`** — not needed here. This slice raises no new error condition; the
  contract's error table says so explicitly.

## Steps

1. **`clients/indexer/client.ts`** — change `item.infoHash?.toUpperCase()` to `.toLowerCase()` in
   `filterData`, and `extractInfoHashFromGuid`'s `match[1].toUpperCase()` to `.toLowerCase()`. Both,
   not one: they feed the same `hash` variable, which becomes the group key **and**
   `TorrentResult.infoHash`, which the user's "add" hands straight back to
   `addTorrentToMovie`/`addTorrentToEpisode` and from there into `MediaSource.infoHash`. The
   `NOHASH:` derived key from `deriveGroupKey` is untouched — it is not a hash and is never stored.
2. **`clients/torrent/client.ts`** — make `normalizeHashes` lowercase each entry before joining on
   `|`. It is the single funnel for `start`/`stop`/`remove`; an uppercase hash there is a `200 OK`
   that touches nothing, never an error, which is AC-3's failure path.
3. **`media-sources.service.ts`** — drop the `.toLowerCase()` at the `torrentClient.files(...)` call
   site now that the client owns the rule. Behaviour-identical; this is a deletion.
4. **`schema.prisma`** — add `encodeSpeed Float?` to `ProcessJob`, beside `progress`. Nullable, no
   default.
5. **Generate the migration** with `bin/npm api run prisma:migrate`, then hand-add the backfill
   statement to the generated `migration.sql`:
   `UPDATE media_sources SET infoHash = LOWER(infoHash) WHERE infoHash IS NOT NULL;`
   (the Prisma column has no `@map`, so its real SQL name is the camelCase `infoHash`)
   Both changes in **one** migration directory. Do not run SQL against the database by hand
   (Article III) — `bin/mysql` is for inspection only.
6. **`pipeline-status.ts`** — add `encodeSpeed: number | null` to `SourceAltitudeJob` and to
   `DerivedProgress`. Return it as `null` from Rules 1, 2, 4, 5 and 6. Return it from **Rule 3 only**,
   computed from the jobs whose own `status === 'ENCODING'` — not the whole `ACTIVE_ENCODE_STATUSES`
   set, since a `WAITING`/`QUEUED` job is not running and has nothing to report. Mean of the non-null
   values among those; `null` when there are none. The encode queue runs at `concurrency: 1`, so in
   practice this reduces to the one running job; the mean is what keeps it defined if that ever
   changes.
7. **`downloads.service.ts`** — add one private method:
   `liveFor(source: { infoHash: string | null }, live: Map<string, TorrentClientInfo>)`, returning
   `source.infoHash ? live.get(source.infoHash.toLowerCase()) : undefined`. Key `liveInfoByHash`'s
   map on `row.hash.toLowerCase()`. Replace the raw `live.get(source.infoHash)` at **both** call
   sites — `movieDownloads` and `showDownloads`, which are structural twins; fixing one and not the
   other is the named risk in `../plan.md`. Lowercase both sides of the comparison in
   `liveInfoForHash` too (`rows.find((row) => row.hash.toLowerCase() === wanted)`), the single-hash
   re-read the three control mutations run after acting.
8. **`downloads.service.ts`, continued** — add `encodeSpeed: true` to `jobsBySourceId`'s `select`,
   carry it into the `SourceAltitudeJob` objects it builds, and pass `derived.encodeSpeed ?? undefined`
   through `toDownload` onto the `Download`. Follow how `encodeProgress` already travels that exact
   path; do not add a parallel one.
9. **`download.entity.ts`** — `@Field(() => Float, { nullable: true }) encodeSpeed?: number;`
   immediately after `downloadSpeed`, so the generated SDL matches the delta's field order. The
   schema is code-first: never hand-edit `schema.gql` (Article IV).
10. **`process-jobs.resolver.ts`** — `encodeProgress` gains
    `@Args('speed', { type: () => Float, nullable: true }) speed?: number`. **Nullable is the
    contract** (`../plan.md` § Contract Freeze) — do not tighten it.
11. **`process-jobs.service.ts`** — `encodeProgress(processJobId, progress, speed)` writes
    `encodeSpeed` alongside `progress` in its existing `update`. Coerce a non-finite or negative
    value to `null` rather than rejecting it: the contract's error table says a bad speed is accepted
    and nulled, never an error, because a decoration must not fail a report (NFR-3). Then add
    `encodeSpeed: null` to the `data:` object already being written by `encodeCompleted` and by
    `encodeFailed` — one field each, no new branch, no new read.

## Contract obligations

This service must expose exactly the delta in `../spec.md`:

- `Download.encodeSpeed: Float` — nullable. Non-null **only** while that source has a job currently
  encoding. FFmpeg's realtime multiplier, unrescaled: `1.23` means `1.23x`.
- `Mutation.encodeProgress(processJobId: Int!, progress: Int!, speed: Float): String!` — the third
  argument optional, the return type and the first two arguments unchanged.

Every other field on `Download` keeps its current name, type and nullability. `downloadSpeed` stays
bytes per second and stays a separate field.

No new error condition. Per the delta's table: an omitted or `null` `speed` is accepted and stored
as `null`; a negative or non-finite `speed` is accepted, coerced to `null`, and never rejected.
`encodeProgress`'s behaviour for an unknown `processJobId` is unchanged — do not add a guard the
contract does not declare.

The delta is read-only. If it is wrong, stop and report; do not adapt it locally (Article VIII).

## Tests

Three files, all existing — extend them, do not create new ones. Follow the house style
(`media-roots.service.spec.ts`, `magnet.spec.ts`): a header paragraph naming the class of bug, and
**fault injection** — each case must be verified to fail when the rule it covers is removed.

- **`src/downloads/downloads.service.spec.ts`** — defends against the bug this feature exists for: a
  `MediaSource` whose `infoHash` is stored uppercase must still join to the qBittorrent row that
  reports it lowercase, in **both** `movieDownloads` and `showDownloads`. This is the canonical
  Article IX case — it produces no error anywhere, MariaDB's case-insensitive collation hides it from
  every SQL check, and the row renders plausibly with a stale status. Verify by reverting `liveFor`'s
  `.toLowerCase()` and watching it fail.
- **`src/pipeline-status/pipeline-status.spec.ts`** — defends against a stale speed outliving its
  encode (REQ-10). Cases: a job `ENCODING` with a speed surfaces it; the same job `COMPLETED` with
  the same stored value surfaces `null`; a mix of one `COMPLETED` (stale value) and one `WAITING`
  surfaces `null`, not the completed job's number. A pure function with no database, so these are
  cheap and exact.
- **`src/clients/indexer/client.spec.ts`** — the grouping key and `TorrentResult.infoHash` are
  lowercase for a row whose indexer supplied the hash uppercase. One case; it pins the write path so
  the readers' tolerance is not the only thing standing between the repo and a repeat.

**Not owed**: the `normalizeHashes` change (its failure is loud in the manual pass — AC-3 — and
mocking a `fetch` to assert a lowercased body tests the mock, not the rule); the `Download.encodeSpeed`
field plumbing (a dropped field is caught by the typecheck on the entity and by AC-6); the
`encodeCompleted`/`encodeFailed` nulling (belt-and-braces on top of a guarantee `pipeline-status.spec.ts`
already pins — a test there would assert the belt while the braces hold).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx --no prisma migrate status
bin/mysql -e "select count(*) from media_sources where cast(infoHash as binary) <> cast(lower(infoHash) as binary)"
```

0 typecheck errors; the suite green and above the 454 tests / 42 suites recorded in the root
`CLAUDE.md`; `migrate status` reporting no pending migration; the `media_sources` count `0`. Report
the before and after numbers rather than asserting the change added nothing.

`git status --short services/api/prisma` must show **both** a modified `schema.prisma` and one new
migration directory — one without the other is an Article III violation.

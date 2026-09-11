---
title: Downloads panel repair — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-11
status: Implemented
---

# PLAN: Downloads panel repair (`plan.md`)

## Approach

Four problems, three of which are independent and one of which is the reason the feature exists.
They are planned together because they land in the same component and the same panel read, not
because they share a mechanism.

**The casing bug is fixed at four altitudes, and the lowest one is the real fix.** The cause is a
single expression — `item.infoHash?.toUpperCase()` in
`services/api/src/clients/indexer/client.ts` — which is the only one of the three write paths that
does not produce lowercase (`clients/torrent/magnet.ts`'s `base32ToHex` returns `toString(16)`,
lowercase, and the 40-hex branch lowercases explicitly; `clients/indexer/resolve-info-hash.ts`
lowercases at both of its return sites). Removing that `toUpperCase()` fixes every row written from
now on and nothing that already exists, which is why the other three layers are owed too: a data
migration rewrites the rows already stored (REQ-3), `QbittorrentClient.normalizeHashes` lowercases
so `start`/`stop`/`remove` cannot be silent no-ops against a legacy row still in flight during the
upgrade (REQ-2), and `DownloadsService` grows one private `liveFor(source, live)` used by both list
methods so no call site does a raw `live.get(source.infoHash)` again. Layered deliberately: the
migration alone would leave the class of bug intact, and the tolerance alone would leave the
database inconsistent — the user chose both.

`normalizeHashes` is the right home for the client-side half because it is already the single
funnel for `start`/`stop`/`remove`, and because `files()` (added by `052-deselected-torrent-files`)
already lowercases its own hash inline, with the cause written in its doc comment. That inline
lowercase and the one at its caller in `media-sources.service.ts` become redundant once the rule
lives in one place; the caller's is deleted (Article X — two defenses against one bug is how the
next reader stops knowing where the rule lives).

**The encode speed reuses every seam that already carries progress, and adds none.** FFmpeg's
`-progress pipe:1` stream that `ffmpeg/runner.ts` already parses `out_time_us=` out of also carries
`speed=1.23x`; the worker reads it from the same chunks, remembers the last parsed value, and hands
it to the existing `onProgress` callback — widened to `(progress, speed)` rather than joined by a
second callback. Widening is not the shorter option; it is the one this repository already argued
for. `023-ffprobe-log` added `onProbe` as a **required** parameter on the same seam with the reason
written down in `services/worker/CLAUDE.md`: an optional callback a call site forgets to pass
compiles clean and records nothing forever. The same applies here, and it buys REQ-11 for free —
`passthrough.ts` must now pass an explicit `null`, so "compression off reports no speed" is enforced
by the compiler instead of by discipline. On the `api` side the value rides the existing
`encodeProgress` mutation at the existing `PROGRESS_STEP` throttle (NFR-2) into a new nullable
`ProcessJob.encodeSpeed` column, and is surfaced through `pipeline-status/`'s existing
`deriveSourceStatus` — which already loads each source's `ProcessJob` rows in one grouped query, so
NFR-1 costs nothing.

**REQ-10 is structural, not a cleanup step.** `deriveSourceStatus` returns `encodeSpeed` only from
Rule 3, the `ENCODING` branch, and only from jobs whose own status is `ENCODING` — so a completed,
failed, cancelled or not-yet-started job's stored value is never read, whatever it happens to hold.
`encodeCompleted`/`encodeFailed` also null the column, but that is hygiene on top of a guarantee
that already holds; it is one field added to two `data:` objects that are already being written, not
a new code path.

**The `web` split is a move.** `DownloadRow` leaves `DownloadsPanel.tsx` for its own file (REQ-5),
the duplicated bar markup collapses into `DownloadProgressBar.tsx` — the row draws that bar twice
today, and REQ-7's geometry has to be decided in exactly one place or the two bars drift again — and
the two formatters leave the `.tsx` for `src/lib/format.ts`. The table stays a `<table>`: REQ-7 is
satisfied by a fixed-width progress column plus a two-column grid inside each bar row, which is the
smallest change that makes both bars equal within a row and across rows. Replacing the table with a
CSS grid was considered and rejected — it would discard the semantics and the header/cell
association for a geometry problem two utility classes solve, and NFR-5 asks for a move, not a
redesign.

## Order of Work

`api` first, and this is a hard sequence rather than a preference: `web` selecting `encodeSpeed`
against a schema that lacks it is a GraphQL **validation** error, which fails the whole
`movieDownloads` document — the panel would render empty, not merely without a speed. The worker
sending `speed:` to a mutation that does not declare it fails the same way, swallowed by the
existing `try/catch` around the progress report, so it degrades to "no progress ever reported"
rather than crashing.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration, the `ProcessJob.encodeSpeed` column, and both halves of the contract the other two consume. Also owns the whole casing fix (REQ-1..REQ-4), which touches no other service. |
| 2a | `web` | Cannot select a field the schema does not have. Independent of 2b. |
| 2b | `worker` | Cannot pass an argument the mutation does not declare. Independent of 2a. |

**2a and 2b are genuinely parallel** once step 1 is merged and `spec.md` is `Approved` — they share
no file, and the only thing between them is the contract, which is frozen. Nothing in `web` reads
the worker's output except through `api`.

Within step 1 the casing work (REQ-1..REQ-4) and the speed work (REQ-8's `api` half) are themselves
independent and may be done in either order; only the migration must precede the acceptance check
that counts uppercase rows.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Three things an
implementer will want to change and must not:

- **`encodeProgress`'s `speed` argument is optional (`Float`, not `Float!`).** From inside `api` it
  looks like a field the worker always sends, and tightening it to non-null would be a one-character
  "improvement". It is optional on purpose twice over: a worker image that predates this feature
  must keep reporting progress against a freshly-migrated `api` (the two are versioned together by
  `PERCEPTOR_TAG`, but nothing enforces that they are deployed together), and a chunk where FFmpeg
  reported `speed=N/A` must be sendable as `null` rather than as a guessed number.
- **`encodeSpeed` and `downloadSpeed` stay two fields.** They sit next to each other on `Download`,
  both `Float`, both nullable, and collapsing them into one "speed" field is the obvious
  simplification. They are different **units** — bytes per second versus a dimensionless realtime
  multiplier — and a consumer that formatted them through one function renders `1.23 B/s`. Article X
  asks for less code, not for two meanings in one field.
- **`encodeSpeed` is a multiplier, not a percentage and not a rate.** `1.0` means realtime. Do not
  rescale it anywhere on the way through — this is the same class of mistake as
  `downloadProgress`'s 0..1 versus 0..100 conversion, which `docs/spec/graphql-contract.md` already
  records as converted exactly once, server-side.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief `web` and
`worker`. Never patch it from inside one slice (Article VIII).

## Migrations

One migration directory, generated through `bin/npm api run prisma:migrate` (Article III), carrying
both a schema change and a data change:

1. **`ProcessJob.encodeSpeed Float?`** — nullable, no default. No backfill: `null` is the correct
   value for every existing row, since none of them is encoding right now and REQ-10 says a
   non-running job has no speed.
2. **Backfill: `UPDATE media_sources SET infoHash = LOWER(infoHash) WHERE infoHash IS NOT NULL;`**
   (the Prisma column has no `@map`, so its real SQL name is the camelCase `infoHash`, not `info_hash` — corrected during T004)
   — written into the same migration's SQL. It must tolerate rows already lowercase, which `LOWER()`
   does by construction. It cannot collide against the column's `@unique` constraint: MariaDB's
   collation on that column is case-insensitive, so two rows differing only by case could never have
   been inserted in the first place.

Verified by AC-2, which must cast to `binary` on both sides — a plain `infoHash <> lower(infoHash)`
returns `0` under that same case-insensitive collation whether or not the migration ran, so the
naive check passes vacuously and proves nothing.

**Reversibility**: the column add is trivially reversible. The `LOWER()` rewrite is **not** — the
original casing is not recorded anywhere and cannot be reconstructed. That is acceptable and is the
point: uppercase was never a meaningful value, only an accident of one write path, and every reader
after this feature is case-insensitive anyway.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A fourth `infoHash` write path appears later and uppercases again | Exactly today's bug, resurfacing: rows render with no progress, no speed and a stale status, no error anywhere, and MariaDB's collation hides it from every SQL check | `normalizeHashes` + `liveFor` make every *reader* case-insensitive, so a future bad writer degrades to a cosmetically-wrong column rather than a broken panel. `downloads.service.spec.ts` pins the join against an uppercase-stored row. |
| The `liveFor` helper is added but one call site keeps its raw `live.get(...)` | One of `movieDownloads`/`showDownloads` is fixed and the other is not — and they are structural twins, so whichever page the implementer tested looks correct | Both call sites are named explicitly in `api/plan.md`; the spec file covers both methods, not one. |
| `encodeSpeed` read from a job that is not running | A finished encode shows the multiplier it died at, forever — looks alive, is not (REQ-10) | Structural: `deriveSourceStatus` surfaces it only from Rule 3 and only from jobs whose status is `ENCODING`. Pinned in `pipeline-status.spec.ts`, which is a pure function with no database. |
| `web` forgets to add `encodeSpeed` to `DOWNLOAD_FIELDS` | The field arrives `undefined`, the column silently renders `—` forever, and nothing fails to compile — the "no codegen" failure this repository keeps hitting | Named as its own step in `web/plan.md`. `DOWNLOAD_FIELDS` is one shared constant used by all four documents, so it is one edit, not four. |
| Speed is reported per FFmpeg frame instead of per `PROGRESS_STEP` | Floods `api` with mutations and re-opens the MariaDB 1020 "Record has changed since last read" contention that `encode.job.ts`'s await-per-report comment exists to prevent | NFR-2. The worker sends speed **inside** the existing throttled `onProgress`, never on its own schedule; `runner.ts` only *remembers* the last parsed value between reports. |
| The `-progress` block splits across stdout chunks | A chunk carries `out_time_us=` without `speed=` (or the reverse); naively requiring both in one chunk drops most reports | `runner.ts` keeps the last parsed speed in a variable and reads it at report time, rather than matching both keys in one buffer. |
| An unparseable speed fails the encode | An hours-long transcode lost to a decoration | NFR-3. Every parse failure resolves to `null`; nothing in the speed path throws. |
| The `web` split changes rendering | A "move" that quietly loses the row error message, the `line-clamp` on the release title, or the `isControllable` gate | NFR-5. The extracted component is moved verbatim except for REQ-7's classes; `web/plan.md` names what must survive the move. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx --no prisma migrate status
bin/mysql -e "select count(*) from media_sources where cast(infoHash as binary) <> cast(lower(infoHash) as binary)"

bin/cli worker npx --no tsc --noEmit
bin/npm worker run build
bin/npm worker test

bin/cli web npx --no tsc --noEmit
bin/npm web run build
```

Expected: `api` typecheck 0 errors and its suite green above the 454/42 recorded in the root
`CLAUDE.md`; the `media_sources` count `0`; `worker` build exits 0 and its suite green modulo the
two pre-existing `src/ffmpeg/` failures and the two pre-existing `src/metadata/container-tags.spec.ts`
typecheck errors, all four recorded in the root `CLAUDE.md` under `052-deselected-torrent-files`;
`web` typecheck 0 errors and build exit 0.

Then the manual pass, which is where AC-1 and AC-3 actually live — neither is reachable from a test
suite, because both need a real qBittorrent with a real torrent in it:

1. Register a film **from an indexer search result** (not a pasted magnet) and let qBittorrent start
   downloading it. Open `/movies/<id>`. The panel row must show a percentage, a speed, and status
   `DOWNLOADING` — AC-1. Do this against a row created *before* the fix too, if one is still in
   flight, to confirm the migration reached it.
2. Click Stop on that row, then check the torrent in qBittorrent's own UI. It must actually be
   stopped — AC-3. At `HEAD` this returns success and pauses nothing.
3. With two rows whose target labels differ in length, measure both progress bars. Equal within a
   row and across rows — AC-5.
4. Let an encode start with `compression_enabled` on. Refresh the panel: a multiplier appears in the
   Speed column and changes between refreshes — AC-6. Refresh again after it completes: the column
   is empty — AC-7.
5. Turn `compression_enabled` off from Settings and run a source through. No speed is ever shown and
   the file still lands at its destination — AC-8.

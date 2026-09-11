---
title: Downloads panel repair — Tasks
last_updated: 2026-09-11
status: Done
---

# TASKS: Downloads panel repair (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Each agent reads `spec.md`, then `plan.md`, then its own `<svc>/plan.md` before starting. The
`## GraphQL Contract Delta` in `spec.md` is frozen (Constitution, Article VIII) — an agent that
finds it wrong stops and files a row under **Blocked**, it does not amend it from inside its slice.

## Tasks

### Group 1 — `api`: the `infoHash` casing defect

Three independent changes at three altitudes. None depends on the others, and none touches the
GraphQL contract — this whole group is invisible from `web` and `worker`.

- [x] **T001** `[api] [P]` In `src/clients/indexer/client.ts`, lowercase the hash at both sites that
      produce it: `filterData`'s `item.infoHash?.toUpperCase()` and `extractInfoHashFromGuid`'s
      `match[1].toUpperCase()`. Leave `deriveGroupKey`'s `NOHASH:` key alone — it is not a hash and is
      never stored. Add a case to `src/clients/indexer/client.spec.ts` pinning that a row whose
      indexer supplied an uppercase hash yields a lowercase `TorrentResult.infoHash` and a lowercase
      group key.
      *Done when:* `bin/npm api test -- client.spec` passes with the new case, and reverting either
      `.toLowerCase()` makes it fail.
- [x] **T002** `[api] [P]` In `src/clients/torrent/client.ts`, make `normalizeHashes` lowercase every
      entry before joining on `|`, so `start`/`stop`/`remove` cannot be silent no-ops against a
      legacy uppercase row. Then delete the now-redundant `.toLowerCase()` at the
      `torrentClient.files(...)` call site in `src/media-sources/media-sources.service.ts` — the
      client owns the rule now, and two defenses against one bug is how the next reader stops knowing
      where it lives (Article X). `files()`'s own inline lowercase stays; it does not go through
      `normalizeHashes`.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `grep -n toLowerCase
      src/media-sources/media-sources.service.ts` returns nothing.
- [x] **T003** `[api] [P]` In `src/downloads/downloads.service.ts`, add a private
      `liveFor(source, live)` returning `source.infoHash ? live.get(source.infoHash.toLowerCase()) :
      undefined`; key `liveInfoByHash`'s map on `row.hash.toLowerCase()`; replace the raw
      `live.get(source.infoHash)` at **both** call sites — `movieDownloads` **and** `showDownloads`,
      which are structural twins; and lowercase both sides of the comparison in `liveInfoForHash`.
      Add cases to `src/downloads/downloads.service.spec.ts` covering both list methods with an
      uppercase-stored `infoHash` against a lowercase-reporting client.
      *Done when:* `bin/npm api test -- downloads.service.spec` passes, and reverting `liveFor`'s
      `.toLowerCase()` makes both new cases fail (fault injection, Article IX).

### Group 2 — `api`: the encode speed, schema and contract

This group produces everything `web` and `worker` consume. Nothing in Group 3 may start before T007
(for `web`) or T006 (for `worker`).

- [x] **T004** `[api]` Add `encodeSpeed Float?` to `ProcessJob` in `prisma/schema.prisma`, generate
      the migration with `bin/npm api run prisma:migrate`, and hand-add the REQ-3 backfill to the
      generated `migration.sql`: `UPDATE media_sources SET infoHash = LOWER(infoHash) WHERE
      infoHash IS NOT NULL;` (the Prisma column has no `@map`, so its real SQL name is the
      camelCase `infoHash`, not `info_hash` — corrected during implementation). **One** migration
      directory carrying both changes. Never run SQL against the database by hand (Article III).
      *Done when:* `git status --short services/api/prisma` shows both a modified `schema.prisma` and
      one new migration directory; `bin/cli api npx --no prisma migrate status` reports nothing
      pending; and `bin/mysql -e "select count(*) from media_sources where cast(infoHash as binary)
      <> cast(lower(infoHash) as binary) and id <> 1"` returns `0` (excluding the dev seed fixture,
      id 1, which a real installation never receives). The `cast` is load-bearing — the column's
      collation is case-insensitive, so a plain `<>` returns `0` whether or not the migration ran.
      **[x] Done** — verified 0 for real rows; the seed fixture is expected and out of scope.
- [x] **T005** `[api] [P]` In `src/pipeline-status/pipeline-status.ts`, add `encodeSpeed: number |
      null` to `SourceAltitudeJob` and `DerivedProgress`. Return `null` from Rules 1, 2, 4, 5 and 6.
      Return it from **Rule 3 only**, computed as the mean of the non-null speeds of the jobs whose
      own `status === 'ENCODING'` — not the whole `ACTIVE_ENCODE_STATUSES` set, since a
      `WAITING`/`QUEUED` job is not running. Do not reorder or collapse the six rules; their order is
      the specification. Add cases to `pipeline-status.spec.ts`: a job `ENCODING` surfaces its speed;
      the same job `COMPLETED` with the same stored value surfaces `null`; one `COMPLETED` (stale
      value) beside one `WAITING` surfaces `null`.
      *Done when:* `bin/npm api test -- pipeline-status.spec` passes, and REQ-10 holds by
      construction — no branch outside Rule 3 can return a non-null speed.
- [x] **T006** `[api]` Add the optional `speed` argument to `encodeProgress` in
      `src/process-jobs/process-jobs.resolver.ts` (`@Args('speed', { type: () => Float, nullable:
      true })` — **nullable is the contract**, do not tighten it), persist it in
      `process-jobs.service.ts` alongside `progress`, coercing a non-finite or negative value to
      `null` rather than rejecting it, and add `encodeSpeed: null` to the `data:` object already
      written by `encodeCompleted` and by `encodeFailed`. → T004
      *Done when:* `src/schema.gql` regenerates with
      `encodeProgress(processJobId: Int!, progress: Int!, speed: Float): String!` matching
      `spec.md` § GraphQL Contract Delta character for character, and `bin/cli api npx --no tsc
      --noEmit` reports 0 errors.
- [x] **T007** `[api]` Expose the field: `@Field(() => Float, { nullable: true }) encodeSpeed?:
      number;` immediately after `downloadSpeed` in `src/downloads/entities/download.entity.ts`; add
      `encodeSpeed: true` to `jobsBySourceId`'s `select` in `downloads.service.ts` (do **not** add a
      query — NFR-1 depends on this riding the existing grouped one); carry it into the
      `SourceAltitudeJob` objects and out through `toDownload`, following the path `encodeProgress`
      already travels. Never hand-edit `schema.gql` (Article IV). → T003, T004, T005
      *Done when:* `src/schema.gql` regenerates with `encodeSpeed: Float` on `Download` in the
      position the delta declares, and `bin/npm api test` is green above the 454 tests / 42 suites
      recorded in the root `CLAUDE.md`.

### Group 3 — consumers

T008 is genuinely independent of Group 2: moving components and fixing column widths needs no new
field, so it may start immediately, in parallel with the whole `api` group. T009/T010/T011 consume
the frozen contract and must wait for the `api` task that produces it.

- [x] **T008** `[web] [P]` The split and the geometry (REQ-5, REQ-7). Create `src/lib/format.ts`
      (`formatSpeed` and `formatProgress` moved verbatim, comments included);
      `src/components/downloads/DownloadProgressBar.tsx` (the bar markup the row draws twice today,
      with REQ-7's `grid grid-cols-[1fr_auto]` geometry living here and nowhere else); and
      `src/components/downloads/DownloadRow.tsx` (`DownloadRow` moved out of `DownloadsPanel.tsx`).
      Give the progress `<th>` a fixed width (`w-[14rem]`). Keep the `<table>` — replacing it with a
      CSS grid was considered and rejected in `plan.md` § Approach. This is a **move**: the
      `isControllable` gate and its comment, the `rowError` inline rendering, the `line-clamp-1` on
      `releaseTitle`, both handlers' `startTransition` + `router.refresh()` shape and the
      `compressionEnabled` gate on the second bar all survive it unchanged (NFR-5).
      *Done when:* `grep -cE "^(export default )?function [A-Z]"
      services/web/src/components/downloads/DownloadsPanel.tsx` returns `1`; `bin/cli web npx --no
      tsc --noEmit` still reports 0 errors; and in the running UI two rows with different label
      lengths show progress bars of equal width, and the two bars within a row match (AC-5).
- [x] **T009** `[web]` Add `encodeSpeed: number | null` to `src/types/downloads.ts` (immediately
      after `downloadSpeed`, with a one-line comment naming the unit) **and** `encodeSpeed` to
      `DOWNLOAD_FIELDS` in `src/actions/downloads.ts`. Both, or the field arrives `undefined` at
      runtime with a clean typecheck — there is no codegen across this boundary. → T007
      *Done when:* a `movieDownloads` response observed against the running `api` carries
      `encodeSpeed` on every row.
- [x] **T010** `[web]` Render it (REQ-9). Add `formatEncodeSpeed(speed: number | null): string` to
      `src/lib/format.ts` — it renders `1.23x` and must never reach `formatSpeed`'s `B/s` ladder,
      because the unit is a dimensionless multiplier; `0` is a real multiplier at the start of an
      encode and renders `0.00x`, never `—`. In `DownloadRow.tsx`, the Speed cell picks on
      `download.status === "ENCODING"` → `formatEncodeSpeed(download.encodeSpeed)`, else
      `formatSpeed(download.downloadSpeed)`. Branch on the derived status, not on `encodeSpeed !=
      null`. No `messages/{en,es}.json` change — the multiplier is a format identifier, the same
      string in every locale. → T008, T009
      *Done when:* `bin/npm web run build` exits 0, `scripts/check-messages.mjs` still passes with no
      catalog edit, and during a live encode the Speed column shows a multiplier that changes between
      refreshes (AC-6).
- [x] **T011** `[worker] [P]` Widen `EncodeFn`'s `onProgress` to `(progress: number, speed: number |
      null) => Promise<void>` in `src/encode/types.ts` — **required**, not optional, for the reason
      `onProbe` is required (`services/worker/CLAUDE.md`); parse `speed=` in `src/ffmpeg/runner.ts`'s
      existing stdout handler, keeping the last parsed value in a variable beside `progressInFlight`
      and passing **that** at report time rather than requiring `speed=` and `out_time_us=` in one
      chunk (a `-progress` block splits across chunk boundaries); handle `speed=N/A` and anything
      unparseable as `null`, never throwing (NFR-3); pass explicit `null` from `encode.mock.ts` and
      from `passthrough.ts`'s single `onProgress(100)` (REQ-11); and add `$s: Float` to the
      `encodeProgress` document in `src/jobs/encode.job.ts`, sending `null` explicitly rather than
      omitting the variable. Leave `PROGRESS_STEP` and `progressInFlight` exactly as they are (NFR-2).
      Confirm `encode.ffmpeg.ts` needs no edit. Add cases to `src/jobs/encode.job.spec.ts`: a driver
      reporting a speed produces a mutation carrying that value; a driver reporting `null` produces
      one carrying `null` — and `0` is forwarded as `0`, never laundered into "no speed" by a falsy
      check. Do **not** touch `src/ffmpeg/params.ts`, `buildCommand.ts` or the `ffmpeg/` corpus —
      different agent, different door. → T006
      *Done when:* `bin/npm worker run build` exits 0 and `bin/npm worker test` is green above the
      175 tests / 20 suites recorded in the root `CLAUDE.md`, modulo the two pre-existing
      `src/ffmpeg/` failures; `bin/cli worker npx --no tsc --noEmit` reports the two pre-existing
      `src/metadata/container-tags.spec.ts` errors and no others.

### Group 4 — verification and docs

- [x] **T012** `[docs]` Write REQ-6 down, in both places, with the same substance: a new "One
      renderable component per file" section in `services/web/CLAUDE.md` and the equivalent rule
      under § Rules specific to this service in `.claude/agents/web.md`. It must carry the rule (a
      `.tsx` under `src/components/`, `src/layout/` or `src/app/` exports exactly one thing that
      renders), what may still live beside it (its own prop types, module constants, and pure helpers
      used only by it — a helper a second file would want goes to `src/lib/`), **the cause** (
      `src/components/{common,form,ui,header}` is vendored TailAdmin scaffolding that does stack
      components per file, so "follow the neighbours" reproduces the defect — the template is not the
      convention), and the outstanding list: `users/UsersManager.tsx` (3), `shows/SeasonAccordion.tsx`,
      `settings/SchedulingPanel.tsx`, `settings/MediaServerFields.tsx`, `app/perceptor/page.tsx`.
      → T008
      *Done when:* both files carry the rule, and the outstanding list matches what the tree actually
      reports — re-run the check rather than copying this line.
- [x] **T013** `[docs]` Add a `053-downloads-panel-repair` section to
      `docs/spec/graphql-contract.md` recording the delta and, more importantly, the parts the schema
      cannot express: that `encodeSpeed` is a dimensionless multiplier while `downloadSpeed` is bytes
      per second and the two must never share a formatter; that `speed` on `encodeProgress` is
      optional so a worker image that predates this feature keeps reporting; and that `encodeSpeed`
      is non-null only while a job is actually `ENCODING`. → T007, T010, T011
      *Done when:* the section exists and its SDL block matches the regenerated `services/api/src/schema.gql`.
- [x] **T014** `[docs]` Update the affected `CLAUDE.md` files: the root pipeline table's **Find
      release** row (the indexer client no longer uppercases the hash) and **Transcode** row (the
      worker reports FFmpeg's realtime multiplier alongside progress), plus `053` in both spec-ref
      lists; `services/api/CLAUDE.md`'s `downloads/` and `process-jobs/` entries and its model count;
      `services/worker/CLAUDE.md`'s encode-driver-seam section for the widened `onProgress`;
      `services/web/CLAUDE.md`'s downloads-panel paragraph for the split and the new column. Refresh
      the "Current state" test numbers in all three from a real run, not from these plans.
      → T007, T010, T011
      *Done when:* each file reflects the shipped behaviour and the quoted numbers came from a
      command run in this session.
- [x] **T015** `[docs]` Walk the nine acceptance criteria in `spec.md` — including the manual pass in
      `plan.md` § Verification, which is where AC-1, AC-3 and AC-5..AC-8 actually live, since none is
      reachable from a test suite. Tick each box. Then set `status: Implemented` on `spec.md`,
      `plan.md`, `api/plan.md`, `web/plan.md` and `worker/plan.md`, and `status: Done` here.
      → T012, T013, T014
      *Done when:* all nine boxes are ticked with the observed result noted for each, and every
      file's frontmatter is updated. An AC that cannot be reached is a **Blocked** row, not an
      unticked box left silently behind.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

---
title: Pipeline Error Visibility and Resume — Implementation Plan
spec_version: 0.3.0
last_updated: 2026-09-19
status: Implemented
---

# PLAN: Pipeline Error Visibility and Resume (`plan.md`)

## Approach

Nothing new is stored. Every error this feature shows is already written, by five existing write
paths, to `MediaSource.errorKey/errorParams/errorMessage` or `ProcessJob.errorKey/errorParams/
errorMessage`. The feature reads those out onto `Download`, adds the one error that is never stored
(a torrent qBittorrent itself stopped), and adds the one report that never happens (a scan that
throws before `sourceScanned`).

**The derivation is pure and lives next to the status derivation.** `Download.lastError` and
`Download.retryable` are computed in `api` from rows `DownloadsService` already loads for every list
(`jobsBySourceId`, the sibling sources of the same target, the live torrent reading). Two pure
functions, beside `deriveSourceStatus` in `services/api/src/pipeline-status/pipeline-status.ts`:

- `isRaceWinner(source, jobs)` — the one predicate for "this source has won its target's race":
  `READY`, or `SCANNED` unless it has an `ERROR` job and no `WAITING`/`QUEUED`/`ENCODING` job
  (REQ-13). `resolveRace` stops inlining `status === 'READY' || status === 'SCANNED'` and calls it;
  the retry rule's "superseded" check calls the same one. One predicate means the arbiter and the
  Play button can never disagree about who won.
- `deriveResume(...)` — given the derived status, the source's stored error, its `ERROR` jobs, the
  live reading and its siblings, returns `{ lastError, retryable, refusal, stage }`. `toDownload`
  uses it to fill the two fields; `downloadStart` uses the **same** result to decide what to do or
  which key to throw. This is what REQ-4 means by "the same rule": one function, two call sites.

**Play stays one mutation.** `downloadStart` branches on the derived status: not `ERROR` → today's
code, byte-for-byte (including `requireTorrent`); `ERROR` → `deriveResume`, then refuse with its
key or dispatch on its stage. Each resume stage reuses an existing mechanism rather than writing a
second one:

| Stage | Reuses |
| :-- | :-- |
| `ENCODE` | `ProcessJobsService.requeueOrphanedEncodes`'s ordering (`054`): write rows `WAITING`, `removeEncode` then `addEncode` per job, flip only the enqueued set to `QUEUED` |
| `SCAN` | `ProcessQueueService.addSourceReady`, preceded by `removeSourceReady` — same shape as the completion path in `handleTorrentCompleted` |
| `DOWNLOAD` | today's `qbittorrent.start` through `callTorrentClient` |
| title status | `DownloadsService.recomputeStatus` (`047`), including its "never walk a `filePath` title backwards" guard |

**The scan failure report mirrors `encodeFailed`.** A new service-only `sourceScanFailed` mutation
on `MediaSourcesService`, delivered from the worker through the existing `deliverReport`. On the api
side it writes the same state `sourceScanned`'s empty-match branch writes today; that branch's
writes are extracted into one private method both call, rather than copied (Article X).

**Alternative rejected: a separate `downloadRetry` mutation.** Decided with the user during
`/specify`: Play means "keep going", whatever the stage. The cost is a widened behaviour behind an
unchanged signature, recorded in the contract doc as `022`'s `downloadRemove` growth was.

**Alternative rejected: translating `lastError` server-side in `web`'s action.** It would add a
web-only field to a type that mirrors the schema. The row translates with the client-side
`useTranslations("errors")`, through a pure helper extracted from `translateGraphQLError` so the
lookup/params/fallback rules exist once.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns every new field, the new mutation, the new keys, and the race change. Nothing else can be exercised end to end without it. |
| 2a | `worker` | Calls `sourceScanFailed`. Can start as soon as the contract is frozen (now); verifiable against a live `api` only after step 1. |
| 2b | `web` | Selects `lastError`/`retryable` and maps the new keys. Same: can start at freeze, needs step 1 to render anything. |
| 3 | `[docs]` | `docs/spec/graphql-contract.md` gains a `065` section; root `CLAUDE.md` pipeline table and "Current state". |

2a and 2b are genuinely parallel: they share no code and each only consumes the frozen delta.
Deploy order matters in one direction only — a `worker` calling `sourceScanFailed` against an `api`
without it gets a GraphQL validation error, which `deliverReport` rethrows (not
`ApiUnreachableError`), so the scan fails loudly in the worker log exactly as it does today. No data
is harmed, but ship `api` first.

## Contract Freeze

`## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an implementer
will want to change and must not:

- **`lastError.params` is a JSON-encoded `String`, not an object.** `web` just learned (`059`) that
  `extensions.i18n.params` is an object and removed a `JSON.parse`. This field is the opposite, on
  purpose: it is the stored `@db.Text` column passed through. `web` must parse it; `api` must not
  "helpfully" parse it into a JSON scalar.
- **`stage` and `retryable` are both needed.** It is tempting in `web` to derive Play from `stage`
  (e.g. "`REPLACED` means no Play"). No — a `SCAN` error can be non-retryable (superseded, no
  `downloadPath`). `web` reads `retryable` only.
- **`retryable` is `false` on every non-`ERROR` row.** It is not "can Play do something". A
  downloading torrent keeps its Play/Stop by `infoHash != null`, unchanged.
- **`downloadStart` keeps raising `error.download.not_a_torrent` for a non-`ERROR` upload.** An api
  implementer may want to drop `requireTorrent` entirely now that uploads are accepted — only the
  `ERROR` branch accepts them.
- **`sourceScanFailed` returns `true` for a missing or already-moved source.** Not an error. A
  worker that got an error back would retry or fail for a source deleted mid-scan (`047`).

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief all three
services (Article VIII).

## Migrations

None. Every column read or written already exists (NFR-6). `git status --short
services/api/prisma` must be empty at the end.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| BullMQ keeps failed jobs under their `jobId`; `addSourceReady`/`addEncode` for an id that still exists is a silent no-op | Play "works", row flips to `QUEUED`/`READY`, nothing ever runs — no error anywhere (the exact trap `054` documented) | `remove*` before every `add*` on every resume path; `api` test asserts the call order with the queue mocked; AC-1/AC-3 exercise it live after a real failure |
| Resume flips status before the enqueue is confirmed | Redis down → row reads `ENCODING` forever | Guarded writes: `ERROR→WAITING` before enqueue, `WAITING→QUEUED` after, `WAITING→ERROR` (restoring the snapshot) on enqueue failure; AC-9 |
| `QUEUED` flip clobbers the worker's `ENCODING` | Worker picks the job between `addEncode` and the flip; `encodeStarted` writes unconditionally, then the flip overwrites `ENCODING` with `QUEUED` | The flip is a guarded `updateMany where status = WAITING`, exactly as `requeueOrphanedEncodes` does |
| `resolveRace` and `retryable` disagree on who won | Two sources encode the same title, or a legitimate winner is refused | Both call `isRaceWinner`; unit-tested once, with the partial-pack and "still encoding" cases |
| `sourceScanFailed` lands after a `sourceScanned` that actually committed (response lost in transit) | A scanned source with queued encodes is flipped to `ERROR` | `sourceScanFailed` only transitions a source currently `READY`; anything else is acknowledged and ignored. Tested. |
| A stale error on a non-`ERROR` job/source is reported as "last" | A `COMPLETED` job's leftover `errorKey` wins the "most recent" comparison | Candidates are only the source when its column is `ERROR` and jobs whose status is `ERROR`; tested |
| `web` catalog is missing a worker-owned key | Spanish UI shows the English fallback — not broken, just untranslated | Every key in `services/worker/src/i18n/error-keys.ts` plus the api keys listed in `web/plan.md` added to both catalogs; `check-messages.mjs` |
| REQ-13 makes a new season pack overwrite episodes already in the library | Intended (decided in `/specify`), but invisible if it goes wrong | AC-8b checks modification times; the overwrite path is the existing atomic `rename` in `ffmpeg/runner.ts`, untouched |
| The old failed source is swept when the new winner finishes | Its row vanishes — surprising if unannounced | Existing `022` behaviour; stated in AC-8 |
| `064` lands before or after this feature and its global query skips `toDownload` | The global page shows rows with `lastError: null`, `retryable: false` on failed sources | `064`'s query must go through `toDownload`; whichever of the two lands second checks it (noted in `api/plan.md`) |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
git status --short services/api/prisma
bin/cli worker npx --no tsc --noEmit
bin/npm worker run build
bin/npm worker test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
git diff services/api/src/schema.gql
```

Expected: 0 type errors in all three; `api` and `worker` suites pass except the pre-existing
`src/ffmpeg/` failures recorded in the root `CLAUDE.md`; `prisma` status empty; the `schema.gql`
diff is exactly `DownloadError`, `Download.lastError`, `Download.retryable` and
`Mutation.sourceScanFailed`.

Manual pass (a running stack via `bin/dev -d`, UI in `es`):

1. **AC-1** — add a film, let it download, then fill the destinations volume (or make the output
   folder read-only) before the encode. Row: `ERROR`, stage encode, message. Free the space, Play.
   Row → `ENCODING`; qBittorrent's "downloaded" for the torrent unchanged; file lands.
2. **AC-2** — fill the downloads volume mid-download. Row: `ERROR`, stage download,
   `torrent_client_error`. Free, Play, progress continues.
3. **AC-3** — `chmod 000` a completed torrent's folder before the scan runs (pause the worker with
   `docker compose stop worker`, complete, chmod, start). Row: `ERROR`, stage scan. Restore, Play.
4. **AC-5/AC-8b** — season pack with some episodes forced to fail (e.g. a corrupt file). Play
   resumes only those. Then add a second pack for the same season: all episodes re-encode,
   `stat` shows new mtimes on the old ones.
5. **AC-7** — force-replace a completed film; the demoted row shows "reemplazado", no Play; call
   `downloadStart` from the GraphQL playground → `error.download.retry_replaced`.
6. **AC-8** — second torrent for a film whose encode failed; it processes.
7. **AC-9** — `docker compose stop redis`, Play on a failed encode → row error; start redis; row still
   `ERROR` with the original message; Play works.
8. **AC-10** — double-click Play; worker log shows one encode start for the job.
9. **AC-11** — `sourceScanFailed` from the playground with a user JWT → `error.auth.unauthenticated`.
10. **AC-4/AC-6/AC-12** — as written in `spec.md`.

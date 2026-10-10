---
title: Force is consent, arbitration is the arbiter's — Tasks
last_updated: 2026-10-06
status: Done
---

# TASKS: Force is consent, arbitration is the arbiter's (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Tests live in the task that changes the behaviour they defend, not in a task of their own — an
`api` task is not done until `bin/npm api run test` passes with its own assertions added. Where two
tasks would touch one file, they are merged, so no two agents edit the same file in the same batch.

## Tasks

### Group 1 — the shared definitions

Nothing else in the feature can start without T001: it is the one definition of "delivered" that
NFR-4 asks for, and five guards plus the arbiter read it.

- [x] **T001** `[api]` Add `isDeliveredSource(status, jobs)` to
      `src/pipeline-status/pipeline-status.ts`, directly beside `isRaceWinner` (`:272`) and over the
      same `RaceJob[]` shape: true when `status === 'SCANNED'`, no job's status is in the existing
      module-level `ACTIVE_ENCODE_STATUSES` (`:91`), and at least one job's status is `'COMPLETED'`.
      Export it. Cover it in `src/pipeline-status/pipeline-status.spec.ts` with an Article IX header
      naming the failure it prevents (a confirmed replacement cancelling an encode in flight):
      `SCANNED` + all jobs `COMPLETED` → true; `SCANNED` + one job `WAITING`, `QUEUED` or `ENCODING`
      → false; `SCANNED` + zero jobs → false; `READY` with and without jobs → false; `SCANNED` + all
      jobs `ERROR` → false.
      *Done when:* `bin/npm api run test -- pipeline-status` passes with the six cases green.
- [x] **T002** `[api] [P]` Add `SOURCE_SUPERSEDED: 'error.source.superseded'` to
      `src/i18n/error-keys.ts` and its English rendering to `src/i18n/messages.en.ts`, in the
      `error.source.*` block beside `SOURCE_REPLACED`. English only — `web` carries the Spanish.
      *Done when:* `bin/cli api npx --no tsc -p tsconfig.json --noEmit` passes and
      `bin/cli api node -e "…"` (or a one-line grep) shows the key present in both files.

### Group 2 — the arbiter and the shared demotion

Both depend on Group 1. T003 and T004 touch different concerns of `downloads.service.ts`; run T003
first and T004 second so one agent holds that file at a time.

- [x] **T003** `[api]` Add two methods to `src/downloads/downloads.service.ts`, both taking the
      `{ movieId } | { episodeId } | { seasonId }` union `UploadsService.demoteSupersededSources`
      (`uploads.service.ts:289`) already takes, and both loading jobs through the existing private
      `jobsBySourceId` (`:182`) — no second `processJob.findMany`:
      `hasDeliveredSource(target)` returns whether any of that target's `SCANNED` sources satisfies
      `isDeliveredSource`; `demoteDeliveredSources(target, reason)` writes exactly those to `ERROR`
      with `ERROR_KEYS.SOURCE_REPLACED` and `MESSAGES_EN[...]` in one `$transaction`, closing any
      `ProcessJob` still in `WAITING`/`QUEUED`/`ENCODING` for the demoted ids, and returns how many it
      demoted. It must write no `Movie`, `Episode` or `Season` column — REQ-9. Leave
      `demoteSupersededSources` itself untouched (REQ-8). → T001
      *Done when:* `bin/npm api run test` passes and
      `git grep -n "processJob.findMany" services/api/src/downloads` shows only the pre-existing
      `jobsBySourceId` occurrence.
- [x] **T004** `[api]` Rework the arbiter in `src/downloads/downloads.service.ts`: `resolveRace`
      returns `{ outcome: 'WON' | 'SUPERSEDED' | 'IGNORED', message }` where every `message` is
      **byte-identical** to the string that branch returns today (they are `torrentCompleted`'s
      response body — do not translate them, see `../plan.md` § Contract Freeze). On the
      `SUPERSEDED` branch, before returning, write that source to `status: 'ERROR'`,
      `errorKey: SOURCE_SUPERSEDED`, `errorMessage: MESSAGES_EN[...]`, `errorParams: null`, and stop
      its torrent when it has an `infoHash`, reusing the existing loser loop's `if (loser.infoHash)`
      guard and its `try/catch` around `qbittorrent.stop` (`:860`) so a torrent-client failure logs
      and continues (`022` NFR-6). Update the two call sites in this file: `handleTorrentCompleted`
      (`:922`) reads `outcome` instead of `message.startsWith('ignorado')` and returns `message`
      unchanged for anything but `'WON'`; `resumeScanStage` (`:593`), which discards the result today,
      must not `addSourceReady` when the outcome is not `'WON'` and must leave the row as the arbiter
      wrote it rather than rolling it back through its existing `catch`. Cover all of it in
      `src/downloads/downloads.service.spec.ts` with an Article IX header: a source whose sibling
      already won comes back `'SUPERSEDED'` **and** is left `ERROR` / `error.source.superseded` with
      `qbittorrent.stop` called for its hash; `stop` throwing does not change the outcome; a source
      with no `infoHash` is recorded without calling `stop`; a `'WON'` outcome still pauses the
      in-flight losers as `022` specifies. → T001, T002
      *Done when:* `bin/npm api run test -- downloads.service` passes, and
      `git grep -n "startsWith('ganador'\|startsWith('ignorado'" services/api/src/downloads` is empty.
- [x] **T005** `[web] [P]` Add `errors.source.superseded` to `messages/es.json` —
      `"Otra fuente de este título ya se estaba procesando"`, the exact string `../spec.md` § GraphQL
      Contract Delta and AC-7 name — and to `messages/en.json`, matching the English rendering T002
      wrote so the catalog and `translateErrorKey`'s fallback never disagree. Both go in the existing
      `errors.source` block beside `replaced`. Add no component, no `lib/` helper and no error branch:
      `DownloadErrorLine` already renders any `lastError` through `translateErrorKey`, and a superseded
      source arrives with `stage: "SCAN"`, which `KNOWN_STAGES` already carries. → T002
      *Done when:* `bin/npm web run lint` exits 0 and
      `bin/cli web node -e "for (const l of ['en','es']) { const m = require('./messages/'+l+'.json'); if (!m.errors.source.superseded) { console.error(l+': missing'); process.exit(1); } } console.log('both catalogs: ok')"`
      prints `both catalogs: ok`.

### Group 3 — the five guards

All five broaden the same guard from `status === 'COMPLETED'` to REQ-2's predicate, and the three
`attachTorrentSource` twins also gain or narrow the demotion `force` authorises. They touch five
different files and are genuinely parallel. Each is owed its own assertions — the three twins are
deliberately separate code (`006` § Out of Scope), so three separate tests, not one shared one.

- [x] **T006** `[api] [P]` `src/movies/movies.service.ts` — broaden the guard at `:702` to
      `movie.status === 'COMPLETED' || (await hasDeliveredSource({ movieId }))`, and add the
      demotion the film path has never had: on the reactivation branch before the status writes, and
      on the main branch **after** `qbittorrent.add()` resolves and **before** the `MediaSource`
      create/update, copying the ordering the episode path's existing comment already encodes. This
      is the step that makes `027` REQ-1 true. In `src/movies/movies.service.spec.ts`, with an
      Article IX header: a `COMPLETED` film with a `SCANNED` source and `COMPLETED` jobs, replaced
      with `force: true`, demotes that source and leaves `Movie.filePath` untouched; without `force`
      it throws `MOVIE_ALREADY_COMPLETED`; a film in `MISSING` holding a delivered source throws it
      too (REQ-2); a `qbittorrent.add` rejection leaves the delivered source `SCANNED` with
      `errorKey` null (AC-9). → T003
      *Done when:* `bin/npm api run test -- movies.service` passes with those four cases green.
- [x] **T007** `[api] [P]` `src/episodes/episodes.service.ts` — broaden the guard at `:122` the same
      way with `{ episodeId }`, and delete the private `demoteActive` (`:127`) in favour of
      `demoteDeliveredSources({ episodeId }, …)` at its two existing call sites, dropping the
      `activeSource` gate that currently makes it fire for a merely-downloading sibling. Keep
      `findActiveSource` — other callers use it — but it no longer gates the demotion. In
      `src/episodes/episodes.service.spec.ts`, REQ-4: an episode holding one delivered source **and**
      one `DOWNLOADING` source, replaced with `force: true`, demotes only the delivered one and leaves
      the `DOWNLOADING` one alone. That assertion fails against today's behaviour, which is the point
      — a version of it that passes before the change is wrong. → T003
      *Done when:* `bin/npm api run test -- episodes.service` passes and
      `git grep -n "demoteActive" services/api/src/episodes` is empty.
- [x] **T008** `[api] [P]` `src/seasons/seasons.service.ts` — broaden both guards, at `:142`
      (`attachTorrentSource`) and `:229` (`startSeasonUpload`), to "an episode of this season is
      `COMPLETED` **or** `hasDeliveredSource({ seasonId })`"; delete `demoteActiveSources` (`:295`)
      in favour of `demoteDeliveredSources({ seasonId }, …)` at its three call sites (`:162`, `:188`,
      `:243`), keeping the season-scoped target — a season replacement deliberately does not reach the
      episodes' own sources (`../spec.md` § Out of Scope); and make `finishSeasonUpload` (`:271`) read
      `outcome !== 'WON'` instead of `!message.startsWith('ganador')`, still throwing
      `UPLOAD_SUPERSEDED`. In `src/seasons/seasons.service.spec.ts`, the same two shapes as T007,
      season-scoped. → T003, T004
      *Done when:* `bin/npm api run test -- seasons.service` passes and
      `git grep -n "demoteActiveSources\|startsWith('ganador'" services/api/src/seasons` is empty.
- [x] **T009** `[api] [P]` `src/uploads/uploads.resolver.ts` — broaden `createUploadTicket`'s two
      guards (`:50`, `:63`) the same way, with `{ movieId }` and `{ episodeId }`. `DownloadsModule` is
      already in `UploadsModule`'s graph (`UploadsService` injects `DownloadsService`), so this needs
      no module edit and no `forwardRef`. Do not touch the three raw Spanish `throw`s in this file —
      they are a separate, already-queued change and editing them here collides with it. → T003
      *Done when:* `bin/cli api npx --no tsc -p tsconfig.json --noEmit` passes and
      `bin/npm api run test` stays green.
- [x] **T010** `[api] [P]` `src/uploads/uploads.service.ts` — broaden both finish-time guards in
      `handleUploadFinish` (`:201`, `:250`), keeping the ticket's `isReplaceAuthorised` as the
      authority (`027` REQ-7) and broadening only the condition it is weighed against; make both race
      checks (`:226`, `:273`) read `outcome !== 'WON'`, still throwing `409` /
      `ERROR_KEYS.UPLOAD_SUPERSEDED` (REQ-8). In `src/uploads/uploads.service.spec.ts`, with an
      Article IX header: a losing upload throws `409` **and** its just-created `MediaSource` is left
      `ERROR`, not `READY` — the orphan is the silent part, since a `READY` row is itself a race
      winner and would block every future source of that target with nothing failing anywhere.
      → T003, T004
      *Done when:* `bin/npm api run test -- uploads.service` passes and
      `git grep -n "startsWith('ganador'" services/api/src/uploads` is empty.

### Group 4 — verification and docs

- [x] **T011** `[api]` Run the api gate from `api/plan.md` § Done when and report each result:
      `bin/cli api npx --no tsc -p tsconfig.json --noEmit`, `bin/npm api run test`,
      `bin/comments api`, `git diff --quiet -- services/api/prisma`, and
      `git grep -n "startsWith('ganador'\|startsWith('ignorado'" services/api/src`. Confirm
      `src/schema.gql` either does not appear in the diff or appears with no field-level change
      (Article IV), and that `git diff -- services/worker` is empty. Fix what fails inside `api`;
      stop and report anything that would need another service. → T006, T007, T008, T009, T010
      *Done when:* all five commands pass, the prisma and worker diffs are empty, and the grep returns
      nothing.
- [x] **T012** `[web] [P]` Verify REQ-10 without changing it: in
      `src/components/search/SearchTorrent.tsx` and `src/components/import/importMagnetModal.tsx`,
      confirm that a submit with `force: false` whose `errorKey` is in `ALREADY_COMPLETED_KEYS` sets
      the confirm state **regardless** of `isCompleted`, and that the confirm control re-issues with
      `force: true`. Report what you found. Change nothing if it already holds; stop and report if it
      does not — a fix there is a behavioural change the plan did not budget for. Then run
      `bin/npm web run lint`, `bin/npm web run build` and `bin/comments web`. → T005
      *Done when:* the three commands exit 0 and the report states, per component, which line drives
      the confirm state. Do not run the build while the dev stack is serving.
- [x] **T013** `[docs]` Update `docs/spec/graphql-contract.md`: add `error.source.superseded` to the
      `api` — media-sources/process-jobs key list (`:828`), and record in an `087` note that the three
      `error.*.already_completed` conditions broaden from `status === 'COMPLETED'` to "or the target
      holds a delivered source", with their names, status and copy unchanged. Then the `CLAUDE.md`
      files: the root pipeline table's **Download** row (what `force` means — consent only, one
      producer, the `073`/`076` sweeps hardcode `false`) and **Detect completion, enqueue** row (the
      arbiter records a superseded source instead of swallowing it); `services/api/CLAUDE.md` for the
      shared `isDeliveredSource` predicate and the two `DownloadsService` helpers replacing three
      divergent demotions. → T011, T012
      *Done when:* `bin/comments api` and `bin/comments web` still pass, and both rows of the root
      table name `087`.
- [x] **T014** `[docs]` Run the manual pass in `plan.md` § Verification against `bin/dev` (AC-1
      through AC-9), confirm AC-10 through AC-12 from T011's and T012's outputs, tick each box in
      `spec.md`, record any AC not reached live and why, append an entry to `docs/spec/history.md`
      (newest first, with the measured typecheck/test counts — never to `CLAUDE.md`, `086` REQ-11),
      and set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md`, `web/plan.md`, and
      `status: Done` here. → T013
      *Done when:* every AC box in `spec.md` is ticked or carries a recorded reason, and all five
      files carry their final status.

## Acceptance criteria coverage

| AC | Reached by |
| :-- | :-- |
| AC-1, AC-2, AC-3 | T006 (the demotion + guard), T004 (the arbiter declaring it a winner), T014 live |
| AC-4 | T004 (the `'WON'` branch still pauses in-flight losers), T014 live |
| AC-5 | T007 and T008 (REQ-4: the 50% sibling survives), T001 (the predicate that excludes it), T014 live |
| AC-6 | T004 (records the loser, stops the torrent), T014 live |
| AC-7 | T005 (the `es` copy), T004 (the key on the row), T014 live |
| AC-8 | T006 and T009 and T010 (the broadened guard, per entry point), T012 (REQ-10 holds in `web`), T014 live |
| AC-9 | T006 (demote after `add()` accepted), T014 live |
| AC-10 | T011 (the `force` audit grep) |
| AC-11 | T011 (worker diff empty, no `superseded`/`already_completed` in `worker`) |
| AC-12 | T011 (api gate + prisma diff), T012 (`web` lint/build/comments) |

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

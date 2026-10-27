---
title: Library Track Languages — Tasks
last_updated: 2026-10-27
status: In Progress
---

# TASKS: Library Track Languages (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` | Which subagent owns the task. Exactly one per task: a task that needs two services is two tasks. |
| `[docs]` | Documentation, the contract doc and the manual pass. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer. |

**Measuring.** If `bin/cli`/`bin/npm` find no container, run each *Done when* command through the
throwaway container (`measuring-without-dev-stack`): `docker run --rm --user 1000:1000 --network
perceptor_perceptor-net -v "$PWD/services/<svc>":/app -w /app -e HOME=/tmp
node:24.18.0-alpine sh -c '<command>'` (`api` also needs `-e NODE_OPTIONS=--experimental-vm-modules`
and `DATABASE_URL`). Report which form was used. Never `git stash`/`checkout`/`reset` in the shared
tree: other agents write there in parallel.

## Tasks

### Group 1 — `api`: schema, contract and triggers

- [x] **T001** `[api] [P]` Schema, migration and keys (`api/plan.md` Steps 1–2): `Movie` and `Episode`
      gain `fileAudioLanguages Json?`, `fileSubtitleLanguages Json?`, `tracksReadAt DateTime?` in
      migration `<ts>_108_library_track_languages` (no data step); `error.libraryProbe.invalid_target`,
      `not_found`, `media_server_unavailable` in `error-keys.ts` and `messages.en.ts`.
      *Done when:* `prisma migrate status` reports the migration applied and `tsc --noEmit` exits 0.
- [x] **T002** `[api] [P]` Extract `LibraryLocationService` (`api/plan.md` Step 3): the media-server
      path chain moves out of `SubtitleSearchRequestService.resolveLibraryPath` into
      `src/library-location/`, returning `{ path } | { reason }` and throwing nothing;
      `SubtitleSearchRequestService` maps each reason to its existing key and still calls
      `assertUsableMkv` itself.
      *Done when:* `bin/npm api test -- subtitle-search-request` passes with its spec file
      **unmodified** (`git diff --stat` of that spec is empty), and `grep -rn
      "hostToContainerPath('library'" services/api/src --include=*.ts | grep -v spec` matches only
      `library-location/`.
- [x] **T003** `[api] [P]` Queue (`api/plan.md` Step 4): `LIBRARY_PROBE_QUEUE`/`LIBRARY_PROBE_JOB`/
      `LibraryProbeJob` in `src/queue/types.ts`; `LibraryProbeQueueService.request(target)` with job id
      `library-probe-movie-<id>`/`library-probe-episode-<id>`, `attempts: 1`, `removeOnComplete: true`,
      `removeOnFail: true`, never throwing. `library-probe-queue.service.spec.ts`.
      *Done when:* `bin/npm api test -- library-probe-queue` passes, and the options case fails when
      `removeOnComplete` is removed.
- [x] **T004** `[api]` The probe service, resolver and fields (`api/plan.md` Steps 5–7):
      `LibraryProbeService.details`/`completed`/`backfill` (detached `onApplicationBootstrap`),
      `libraryProbeDetails`/`libraryProbeCompleted` with `@AllowService()` + the service-principal
      check, `fileAudioLanguages`/`fileSubtitleLanguages` on the `Movie` and `Episode` entities and in
      every read path that builds them. `library-probe.service.spec.ts` per `api/plan.md` § Tests.
      *Done when:* `bin/npm api test -- library-probe` passes (the stale-`filePath` case fails when the
      `filePath` arm of the `where` is dropped), and `git diff services/api/src/schema.gql` shows exactly
      `spec.md` § GraphQL Contract Delta and nothing else. → T001, T002, T003
- [x] **T005** `[api]` Triggers and clearing (`api/plan.md` Steps 8–9): `request()` from
      `ProcessJobsService.encodeCompleted` (non-demoted delivery only), `SubtitleEmbedService.completed`,
      `MediaServerReconcileService.reconcileMovie`/`reconcileShow`/`syncMovie`/`syncShow`; the
      `syncMovie`/`syncShow` demotion clears the three columns. Extend the four specs.
      *Done when:* `bin/npm api test -- process-jobs subtitle-embed media-server-reconcile` passes, and
      the demotion case fails when the three columns are dropped from its `data`. → T001, T003
- [x] **T006** `[api]` Slice gate (`api/plan.md` § Done when).
      *Done when:* `tsc --noEmit` 0 errors; the full `bin/npm api test` green with counts before and
      after; `bin/comments api` passes; `migrate status` up to date; the `schema.gql` diff unchanged
      from T004's. → T004, T005

### Group 2 — consumers

`worker` and `web` consume what T004 produced. T007 depends on nothing.

- [x] **T007** `[worker] [P]` `src/subtitles/audio-languages.ts` and its spec (`worker/plan.md` Step 2):
      audio streams only, `normalizeIso3`, `und`/empty/untagged dropped, de-duplicated in stream order.
      *Done when:* `bin/npm worker test -- audio-languages` passes, and the `und` case fails when the
      `und` filter is removed.
- [x] **T008** `[worker]` The job (`worker/plan.md` Steps 1, 3–5): queue types identical to `api`'s,
      `src/api/library-probe-reports.ts`, `src/jobs/library-probe.job.ts` (keyed details error → report
      nothing; read failure → log title and path, report nothing; echo the exact `filePath`), the
      `Worker` on `library-probe` in `src/index.ts`, concurrency 1, after `encodeWorkerStarted`.
      `library-probe.job.spec.ts`.
      *Done when:* `bin/cli worker npx --no tsc --noEmit` exits 0, the full `bin/npm worker test` is
      green, and `bin/comments worker` passes. → T004, T007
- [x] **T009** `[web] [P]` Film boxes (`web/plan.md` Steps 1–3 and the film half of 5): the two fields
      in the film and episode queries and types, `src/components/media/FileTrackLanguages.tsx`
      (`boxes`/`compact`, hidden on `null`, `—` on `[]`, upper-cased chips, `Music2`/`Captions`), the
      boxes under the poster in `Movie.tsx`, the two accessible labels in `messages/{es,en}.json`.
      *Done when:* `bin/cli web npx --no tsc --noEmit` adds no error beyond `Calendar.tsx`'s 7,
      `check-messages` and `bin/comments web` pass. → T004
- [x] **T010** `[web]` Episode column (`web/plan.md` Step 4 and the column header in 5): the new
      column in `SeasonAccordion.tsx` with the two `compact` lines and `SearchSubtitlesButton` moved into
      it, same visibility condition, removed from its old cell.
      *Done when:* the same three checks as T009 pass, and `grep -c "SearchSubtitlesButton"
      services/web/src/components/shows/SeasonAccordion.tsx` shows the import plus exactly one usage.
      → T009

### Group 3 — verification and docs

- [x] **T011** `[docs]` A `108-library-track-languages` section in `docs/spec/graphql-contract.md`: the
      two field pairs (and why they are prefixed `file`), the input, the query and mutation, the fifth
      queue contract, the error keys and the worker's abandon-silently rule, copied from `spec.md`.
      *Done when:* the section's SDL matches `spec.md` word for word. → T006
- [x] **T012** `[docs]` Root `CLAUDE.md` (**Browse library** row: the boxes and the episode column;
      **Notify media server** row: the reads queued on reconcile/Refresh; `108` in both spec lists),
      `services/api/CLAUDE.md` (`library-probe/`, `library-location/`), `services/worker/CLAUDE.md` (the
      `library-probe` queue row), `services/web/CLAUDE.md` if it lists the detail-page panels, and a
      `docs/spec/history.md` entry measured with the commands at the top of that file.
      *Done when:* `grep -n "108" CLAUDE.md services/*/CLAUDE.md` finds each touched entry and
      `bin/comments` passes. → T006, T008, T010
- [~] **T013** `[docs]` Manual pass, `plan.md` § Verification items 1–9, covering AC-1 to AC-12.
      Requires the dev stack up (another Perceptor install on this host holds its ports: stop it with
      `bin/stop -y` first) with Jellyfin; AC-3 needs a Plex server. AC-13 is T006 + T008's gates.
      *Done when:* each AC ticked from an observed run, or left `[~]` with what is missing.
      → T006, T008, T010
- [~] **T014** `[docs]` Walk AC-1 to AC-13 in `spec.md`, tick each one verified, set
      *Status:* `pending-acs.md` row written; no AC is ticked, none was observed live. `spec.md`, the plans and this file stay `Approved`/`In Progress` until the manual pass (T013) is run.
      `status: Implemented` on `spec.md`, `plan.md` and every `<svc>/plan.md`, set this file to `Done`,
      and run `/pending-acs`.
      *Done when:* no AC is unaccounted for (ticked, or `[~]` with a named blocker) and
      `bin/pending-acs --check` exits 0. → T011, T012, T013

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports; it does not amend the delta from inside its slice.

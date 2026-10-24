---
title: Jellyfin Subtitle Embed — Tasks
last_updated: 2026-10-23
status: Done
---

# TASKS: Jellyfin Subtitle Embed (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation, the constitution amendment and measurement. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer. |

There is no `[infra]` task. `mkvmerge` is already in the `worker` image (`100`, NFR-3). The
destinations root is already mounted read-write in `worker` and read-only in `api`, and the plan
keeps it that way.

**Measuring.** The stack running on this host is the end-user install `ptor`, not this checkout, so
`bin/cli`/`bin/npm` find no container. Until a `perceptor` dev stack is up without colliding with
`ptor`'s ports, run each *Done when* command through the throwaway container described in memory
(`measuring-without-dev-stack`): `docker run --rm --user 1000:1000 -v
"$PWD/services/<svc>":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c '<command>'`. Report
which form was used.

## Tasks

### Group 0 — the rule first

Nothing may write or delete under the destinations root while Article XII forbids it (`plan.md`
§ Order of Work, step 0).

- [x] **T001** `[docs]` Amend Article XII through `/constitution`, per spec NFR-1. Add two
      exceptions, both applying only at an administrator's explicit request:
      1. a library `.mkv` may be replaced, by one atomic rename, with its verified remux adding
         subtitle tracks, with the worker's `<final>.part.mkv` removed on every outcome;
      2. after that rename, the worker deletes exactly the sidecar `.srt` files it embedded, under
         REQ-12's guards.

      Update the **Check** line to name `services/worker/src/jobs/subtitle-embed.job.ts` (rename,
      sidecar unlink) and `services/worker/src/subtitles/sidecar-guard.ts`. Bump `version` to
      1.5.0 and append the changelog row (ratified alongside `101`).
      *Done when:* `docs/constitution.md` shows `version: 1.5.0`, Article XII names both exceptions
      and the new Check sites, and the changelog has the 1.5.0 row.

### Group 1 — `api`: schema, contract and behaviour

`api` produces everything the other two consume.

- [x] **T002** `[api]` Per `api/plan.md` step 1: add the `SubtitleEmbedStatus` enum and the
      `SubtitleEmbed` model to `prisma/schema.prisma`, with back-relations on `Movie`/`Episode`,
      cascade on delete, and the `(movieId, createdAt)` / `(episodeId, createdAt)` indexes.
      Generate the `add_subtitle_embed` migration. → T001
      *Done when:* `git status services/api/prisma/` shows a modified `schema.prisma` plus one new
      migration directory, and `bin/cli api npx prisma migrate status` is up to date.
- [x] **T003** `[api] [P]` Per step 2: in `src/clients/media-server/types.ts`, add the optional
      members `listItemSubtitles`, `listSeriesEpisodeSubtitles` and `modifiedMedia`, plus the
      `ExternalSubtitleStream`/`ItemSubtitles` types. In `jellyfin.ts`, implement them and the pure
      `toExternalSubtitles(mediaPath, streams)`, sharing the `Library/Media/Updated` body builder
      with `createdMedia`. Extract `MediaServerService`'s settings→client construction into one
      reusable method. → T001
      *Done when:* `jellyfin.spec.ts` covers each of these and `bin/npm api test` is green:
      - embedded streams, non-`subrip`, path-less, other-directory and non-`.srt` entries dropped;
      - `null` language kept as `null`;
      - the episode map matched by season/episode, `Virtual` excluded;
      - `UpdateType: 'Modified'` sent.
- [x] **T004** `[api] [P]` Per step 3: add `MediaRootsService.hostToContainerPath(rootId,
      hostAbsolutePath)` and extend `media-roots.service.spec.ts`. → T001
      *Done when:* the spec covers an outside-root path and a relative `hostPath` (both `null`) and
      a nested in-root path, and passes.
- [x] **T005** `[api]` Add the `subtitle-embed` queue constants and `SubtitleEmbedJob` to
      `src/queue/types.ts`, plus `src/queue/subtitle-embed-queue.service.ts` (`jobId: embed-<id>`,
      `attempts: 1`) registered in `queue.module.ts`. Add every `error.subtitleEmbed.*` key from
      both spec tables to `src/i18n/error-keys.ts` and `messages.en.ts`. → T002
      *Done when:* typecheck reports 0 errors and the `messages.en` spec (if present) renders every
      new key.
- [x] **T006** `[api]` Per step 4: create the `src/subtitle-embed/` module, with the
      `externalSubtitles` and `subtitleEmbed` `@ResolveField`s on `Movie` and `Episode`. Admin is
      re-read from the DB with no guard throw. Every failure returns `[]`. The series listing is
      memoized on the request context. → T003, T004, T005
      *Done when:* `subtitle-embed.service.spec.ts` covers each of these and passes:
      - a non-administrator gets `[]` with no client call;
      - an unreachable Jellyfin gets `[]`;
      - `fileName` is the base name;
      - N episodes of one series cost one client call;
      - `subtitleEmbed` returns the latest row.
- [x] **T007** `[api]` Per step 5: add `embedMovieSubtitles`/`embedEpisodeSubtitles` (one service
      method). The checks run in the plan's order:
      - admin, visibility, client support;
      - the input validations; a `fileName` with a separator or `..` is `stale_listing`;
      - possession, then REQ-13 `.mkv` resolution;
      - busy, then the Jellyfin re-read plus `stat` of each `sourcePath`.

      Then insert inside a `$transaction` that re-checks for an active embed, and enqueue. → T006
      *Done when:* the service spec covers each refusal in the spec's first table and passes,
      including a concurrent second embed, a `DOWNLOADING` source, a `STOPPED` job, a season pack in
      flight, and `trackTitle` resolved to the base row (`Español`, never `es-419`'s).
- [x] **T008** `[api]` Per step 6: add `subtitleEmbedStarted`, `subtitleEmbedCompleted(id,
      warningKey)`, `subtitleEmbedFailed(id, errorKey)` and `subtitleEmbedDetails`, all
      `@AllowService()` plus the `principal.type !== 'service'` rejection. `Completed` notifies
      Jellyfin via `modifiedMedia` only on the transition, and sets `jellyfin_refresh_failed` only
      when the worker sent no warning. Unknown worker keys are coerced and logged. → T007
      *Done when:* the spec covers each of these and passes:
      - `Started` is true only from `QUEUED`;
      - repeats of `Completed`/`Failed` write and notify nothing;
      - a refresh error yields `jellyfin_refresh_failed`;
      - `sidecar_delete_failed` from the worker survives a refresh error;
      - `Details` answers for a `FAILED` row, with `sourcePath` in `filePath`'s directory;
      - an unknown `errorKey` is stored as `remux_failed`;
      - a user principal is refused.
- [x] **T009** `[api] [P]` Per step 7: add `hasActiveEmbed(target)` in a leaf provider (no
      `forwardRef`). Call it from `AttachSourceService.attach()` before `targetDef.refuse`, from
      `createUploadTicket`, and from `startSeasonUpload`. A season target checks every episode of
      the season. → T002
      *Done when:* `attach-source.service.spec.ts` refuses with `error.subtitleEmbed.busy` for a
      film, an episode, and a season whose episode has a `RUNNING` embed, and passes. The Nest app
      boots with no circular-dependency error.
- [x] **T010** `[api] [P]` Per step 8: in `reconcileOrphanedEncodes`, move every `RUNNING` embed to
      `FAILED`/`error.subtitleEmbed.interrupted` with `finishedAt`. → T002
      *Done when:* `process-jobs.service.spec.ts` shows a `RUNNING` embed failed and `QUEUED`/
      `COMPLETED` untouched, and the returned count is still the encode count.
- [x] **T011** `[api]` Contract and slice check. → T006, T007, T008, T009, T010
      *Done when:*
      - typecheck reports 0 errors;
      - `bin/npm api test` is green (report the counts);
      - lint and `bin/comments api` are clean;
      - `git diff services/api/src/schema.gql` matches `spec.md` § GraphQL Contract Delta (v0.2.0)
        exactly;
      - `grep -rn "unlink\|rmSync\|rm(" services/api/src/subtitle-embed` is empty.

### Group 2 — consumers

The worker's pure modules and both catalogs only read frozen strings, so they start after T001.
Everything that crosses the wire waits for T011.

- [x] **T012** `[worker]` Add `subtitle_unreadable`, `charset_undetected`, `remux_failed`,
      `verify_failed`, `not_writable` and `sidecar_delete_failed` (full `error.subtitleEmbed.`
      prefix) to `src/i18n/error-keys.ts` and `messages.en.ts`. → T001
      *Done when:* `messages.en.spec.ts` renders each new key and `bin/npm worker test` is green.
- [x] **T013** `[worker] [P]` Per `worker/plan.md` step 2: `src/subtitles/normalize-srt.ts` with its
      spec and fixtures (a real cp1252 file, a UTF-8-with-BOM file, a file with `0x81`). → T012
      *Done when:* the spec covers each of these and passes:
      - `¿Señor?` survives cp1252;
      - the BOM is dropped;
      - `0x81` gives `charset_undetected`;
      - a negative offset drops and clamps cues;
      - a positive offset shifts;
      - CRLF parses;
      - zero cues after the shift fails.
- [x] **T014** `[worker] [P]` Per step 3: `src/subtitles/embed-args.ts` and its spec. → T012
      *Done when:* the spec covers each of these and passes:
      - the original comes first and the new tracks follow in request order;
      - with a default, every pre-existing subtitle gets `:0`;
      - without one, existing tracks are not mentioned;
      - no audio/video track is named;
      - no `--sync`;
      - the forced flag is mapped.
- [x] **T015** `[worker] [P]` Per step 4: `src/subtitles/verify-embed.ts` and its spec. → T012
      *Done when:* the spec covers each of these and passes:
      - rejects a swapped or missing original track at equal counts;
      - rejects a 2 s drift;
      - rejects two defaults;
      - accepts `ger` vs `deu`.
- [x] **T016** `[worker] [P]` Per step 5: `src/subtitles/sidecar-guard.ts` and its spec. → T001
      *Done when:* the spec refuses another directory, a `../` escape, a non-`.srt` name and the
      `.mkv` itself, accepts a sibling `.spa.srt`, and passes.
- [x] **T017** `[worker]` Hand-copy the `subtitle-embed` queue constants and `SubtitleEmbedJob` into
      `src/queue/types.ts`. Add `src/api/subtitle-embed-reports.ts` with the four documents typed
      from the spec. → T011
      *Done when:* typecheck reports 0 errors and the copied names are byte-identical to
      `services/api/src/queue/types.ts` (`diff` of the relevant lines is empty).
- [x] **T018** `[worker]` Per step 6: add `src/jobs/subtitle-embed.job.ts` and its spec, and wire the
      third `Worker` into `src/index.ts` (`concurrency: 1`, constructed after `encodeWorkerStarted`,
      closed on shutdown). → T013, T014, T015, T016, T017
      *Done when:* `subtitle-embed.job.spec.ts` covers each of these and passes:
      - the scratch is removed before `subtitleEmbedStarted`;
      - `false` reports nothing;
      - exit `1` is success;
      - exit `2` is `remux_failed` with the part removed and the sidecars intact;
      - a verify rejection never renames and leaves the sidecars;
      - success renames once, after `chmod`/`chown`, and unlinks only afterwards;
      - a failed unlink gives `COMPLETED` with `sidecar_delete_failed`;
      - a missing sidecar gives no warning;
      - the temp dir is removed on every branch.

      Typecheck reports 0 errors, the full worker suite is green as uid 1000 (report the counts),
      and `bin/comments worker` is clean.
- [x] **T019** `[web] [P]` Per `web/plan.md` step 6: add `media.embedSubtitles.*` UI copy and every
      `errors.subtitleEmbed.*` key from both spec tables to `messages/en.json` and `es.json`, with
      the Spanish exactly as in the spec. → T001
      *Done when:* `bin/cli web node scripts/check-messages.mjs` reports parity and
      `bin/npm web run lint` passes.
- [x] **T020** `[web]` Per steps 1–2: retype `ExternalSubtitle`/`SubtitleEmbed`/
      `SubtitleEmbedStatus`/`SubtitleEmbedInput` in `src/types/media.ts`. Add the two fields to
      `getMovieById` and to `GetShow`'s episodes. Add `embedMovieSubtitlesAction`/
      `embedEpisodeSubtitlesAction`, sending `fileName` copied from the listed entry. → T011
      *Done when:* typecheck reports 0 errors and lint passes.
- [x] **T021** `[web]` Per steps 3–5: add `src/components/media/EmbedSubtitlesButton.tsx` and
      `EmbedSubtitlesModal.tsx`, rendered in `components/movies/Movie.tsx` beside Refresh/Remove and
      in `SeasonAccordion.tsx`'s episode action cell. Handle every condition in the plan's
      contract-obligations table. → T019, T020
      *Done when:*
      - typecheck reports 0 errors and lint and `bin/comments web` are clean;
      - with a stubbed `externalSubtitles: []`, no button renders;
      - with a `RUNNING` embed, the button is disabled and reads "Incrustando…".

### Group 3 — docs and verification

- [x] **T022** `[docs]` Add a `101-jellyfin-subtitle-embed` section to
      `docs/spec/graphql-contract.md`: the delta, the second queue contract, `fileName` as a base
      name (Article V), and no Jellyfin stream index. → T011
      *Done when:* the section exists and matches `spec.md` v0.2.0.
- [x] **T023** `[docs]` Update the docs. → T018, T021
      *Done when:* each of these says what changed:
      - root `CLAUDE.md`: the **Notify media server** and **Browse library** rows, with `101` in
        their spec refs;
      - `services/api/CLAUDE.md`: a `subtitle-embed/` module-map entry, the Jellyfin client's new
        members, and the reverse guard in `acquisition/`;
      - `services/worker/CLAUDE.md`: "Two queues" becomes three, plus `src/subtitles/`;
      - `services/web/CLAUDE.md`: the new components, if it lists components;
      - a new `docs/spec/history.md` entry with the measured counts.
- [~] **T024** `[docs]` Manual pass on Green Book (register it in the dev Perceptor first; it has
      `.eng.srt` and `.spa.srt` from the plugin) plus the fixtures the plan names. Walk AC-1 through
      AC-15 in order: `sha256sum` before each failure case, `ls -l` before and after, the AC-14 grep,
      and the titles' status checks. → T018, T021
      *Done when:* every AC has an observed result written next to it, or is marked `[~]` with the
      blocker named.
- [x] **T025** `[docs]` Tick the acceptance criteria in `spec.md`. Set `status: Implemented` on
      `spec.md`, `plan.md` and every `<svc>/plan.md`, and `status: Done` here. Run `/pending-acs`.
      → T022, T023, T024
      *Done when:* `bin/pending-acs --check` exits 0 and the 101 row shows the remaining unticked
      ACs with their blocker.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T024 | docs | Needs a perceptor dev stack beside `ptor` (port collision), Green Book registered in it, a real Jellyfin library and the maintainer's eyes on the modal | Maintainer manual pass of AC-1..AC-13 and AC-15 |

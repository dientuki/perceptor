---
title: Grouped Provenance Tags — Tasks
last_updated: 2026-11-20
status: Done
---

# TASKS: Grouped Provenance Tags (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation, live passes and acceptance. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Inside `[worker]` there are two territories, as in `110` and `122`:

- **(ffmpeg)** tasks touch `src/ffmpeg/` or the case corpus `services/worker/ffmpeg/`. They are
  dispatched to the `ffmpeg` agent.
- every other `[worker]` task goes to the `worker` agent.

Tests and typecheck run from a throwaway container, because the stack on this host (`ptor`) is a
production install, not this checkout. `‹svc›` below means:

```bash
docker run --rm --user 1000:1000 -v "$PWD/services/<svc>":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c '<command>'
```

Two `api` suites need a real Redis (`ci.yml`). Use a throwaway `redis:7-alpine` on its own
network, never `ptor`'s. A step that needs MariaDB (`prisma migrate`) runs against a throwaway
`mariadb` container in the same way, or is left to the live pass and named there.

## Tasks

### Group 1 — schema, contract and the image (`api`, `infra`)

`T008` is independent of every `api` task. Inside `api` the order is the dependency chain.

- [x] **T001** `[api]` Schema and migration `<ts>_123_library_tag_migration` (`api/plan.md` step 1):
      `LibraryTagMigration`, `LibraryTagMigrationItem`, enums `LibraryTagMigrationStatus` and
      `LibraryTagOutcome`, back-relations on `Movie`/`Episode` (`onDelete: Cascade`), and the index
      `(migrationId, outcome)`.
      *Done when:* `‹api› npx prisma validate` passes, and `npx prisma migrate diff
      --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script`
      prints nothing (the migration matches the schema). Exactly one new directory exists under
      `prisma/migrations/`.
- [x] **T002** `[api]` Extract `provenanceOf(attempt)` into `src/subtitle-search/provenance.ts` and
      use it in `subtitle-search.driver.ts`, with no behaviour change. Add
      `provenance.spec.ts` (`api/plan.md` step 2).
      *Done when:* `‹api› npx jest src/subtitle-search` is green, and `grep -n "providerSubtitleId}"
      src/subtitle-search/subtitle-search.driver.ts` finds nothing (the expression lives in one
      place).
- [x] **T003** `[api]` Embed track facts (`api/plan.md` step 3). `SubtitleEmbedTrack.provider:
      String!`, `syncScore: Float`, `framerateRatio: Float`. `StagedTrackInput`/`StoredTrack` gain
      the three fields. The driver passes them for a staged track, and `embedFromSidecars` stores
      `provider: 'user'`. `details()` resolves them, including from an auto-offset track's
      `measurement`, with pre-feature fallbacks. Update the `provenance` description. Extend
      `subtitle-embed.service.spec.ts`. → T002
      *Done when:* the spec covers four cases: staged, manual sidecar, auto-offset sidecar and a
      pre-feature row. It is green, and `src/schema.gql` shows the three fields exactly as in the
      spec's SDL.
- [x] **T004** `[api]` `src/library-tags/ffmpeg-command.ts`, the pure parser, plus
      `ffmpeg-command.spec.ts` (`api/plan.md` step 4). Fixtures are real stored commands from the
      `011`, `057`, `058`, `092` and `115` eras (take them from `process_jobs.ffmpegCommand` on a
      library you can read, with paths anonymised), plus one with a path containing spaces.
      *Done when:* the spec is green, and it asserts all of the following:
      - `ANIME`/`CGI` give a null kind, and `scm=0` gives `LIVE_ACTION`;
      - a copy gives null CRF/preset/grain;
      - `outputResolution` is always null;
      - garbage gives all nulls without throwing.
- [x] **T005** `[api]` Migration module (`api/plan.md` steps 5, 7, 8 and 9). This covers:
      - `src/library-tags/`: module, service, resolver and entities per the spec's SDL;
      - `src/queue/types.ts` gains `LIBRARY_TAGS_QUEUE`/`LIBRARY_TAGS_JOB`/`LibraryTagsJob`;
      - `src/queue/library-tags-queue.service.ts`, with `jobId` `library-tags-<itemId>`;
      - the i18n keys;
      - start, claim (the `BUSY`/`MISSING`/`item_settled`/`item_not_found` logic), finish
        (idempotent, completes the run, notifies the media server on `MIGRATED` through the
        extracted `notifyMediaServer`);
      - `requeueAfterWorkerBoot`, called from `reconcileOrphanedEncodes`.

      Add `library-tags.service.spec.ts`. → T001, T002, T004
      *Done when:* the service spec is green on all of these:
      - a second `start` while running → `migration_running`;
      - a busy title → settled `BUSY` and `item_settled`;
      - no path → `MISSING`;
      - a late report after `BUSY` changes nothing;
      - a duplicate finish is a no-op;
      - the last finish → `COMPLETED`;
      - worker boot clears claims and re-enqueues them;
      - a media-server failure keeps `MIGRATED`.

      `src/schema.gql` matches the spec's SDL field for field.
- [x] **T006** `[api]` Extend `ActiveEmbedGuard.assertNoActiveEmbed` to refuse with
      `error.libraryTags.busy` when the target has a claimed, unsettled item. For a season, check
      any episode. Extend `active-embed.guard.spec.ts` (`api/plan.md` step 6). → T005
      *Done when:* the guard spec is green on three cases: a claimed item → `libraryTags.busy`; a
      settled item → passes; an active embed → still `subtitleEmbed.busy`. `‹api› npx --no tsc
      --noEmit` exits 0.
- [x] **T007** `[api]` Close the slice: update `services/api/CLAUDE.md` with the `library-tags/`
      section and the three new `subtitle-embed/` track fields. Run the full suite. → T003, T006
      *Done when:* `‹api› npx --no tsc --noEmit` exits 0, `npm test` is green with the throwaway
      Redis, and `bin/comments api` passes.
- [x] **T008** `[infra] [P]` In `services/worker/Dockerfile`, add `ARG PERCEPTOR_VERSION=dev` and
      `ENV PERCEPTOR_VERSION=$PERCEPTOR_VERSION` in `base`, after the package installs. In
      `.github/workflows/release.yml`, pass `build-args: PERCEPTOR_VERSION=${{ github.ref_name }}`
      on the worker leg only (`infra/plan.md`).
      *Done when:* `bin/build prod worker` succeeds, and the following prints the `mkvpropedit`
      and `mkvextract` paths, then `dev`:
      `docker run --rm --entrypoint sh perceptor-worker:local-prod -c 'command -v mkvpropedit
      mkvextract; echo $PERCEPTOR_VERSION'`. If either tool is missing, stop and report it as
      Blocked.

### Group 2 — consumers (`worker`, `web`)

These consume the contract `T003`/`T005` produce. `T009`–`T011` and `T015` do not read the
contract and could start earlier, but they share files with the tasks that do, so they wait for
the `api` slice to settle.

- [x] **T009** `[worker] [P]` Add `src/version.ts` and `src/tags/perceptor-tags.ts` (the single
      builder of `PERCEPTOR` trees: omission rule, hygiene via `sanitizeTagValue`, decimal and
      timestamp formats, global vs track targets), plus `perceptor-tags.spec.ts` (`worker/plan.md`
      steps 1 and 2). → T007
      *Done when:* `‹worker› npx jest src/tags` is green, and it asserts all of these:
      - one group per target;
      - a null child is omitted, never written empty or as `0`;
      - control characters are stripped;
      - `ENCODED_AT` has the form `YYYY-MM-DDTHH:MM:SSZ`.
- [x] **T010** `[worker]` Embed group (`worker/plan.md` step 3). `buildTrackTagsXml` emits the nested
      group with `SOURCE`, `OFFSET`, `PROVIDER`, `SYNC_SCORE`, `FRAMERATE_RATIO` and `EMBEDDED_AT`.
      `subtitle-embed.job.ts` reads the three new details fields and timestamps the embed just
      before the `rename`. An absent `provider` logs and omits the child. Update
      `embed-tags.spec.ts` and `subtitle-embed.job.spec.ts`. → T009
      *Done when:* both specs are green, and they assert two things: no flat `PERCEPTOR_SOURCE` or
      `PERCEPTOR_OFFSET` remains in the XML, and an unknown provider string is written verbatim.
- [x] **T011** `[worker] [P]` Grain stage (`worker/plan.md` step 4). `resolveFilmGrain` returns
      `{ filmGrain, decidedBy }`:
      - effective `ON` → `title`;
      - effective `OFF` → no stage;
      - `gate`, `short`, `probe` from their branches;
      - a failure → no stage;
      - the Redis verdict stores the stage, and an old boolean entry reads with no stage.

      Update `grain-mode.spec.ts`. Callers keep compiling: `encode.ffmpeg.ts` reads `.filmGrain`.
      → T007
      *Done when:* `‹worker› npx jest src/encode/grain` is green and covers every branch plus the
      old-cache read.
- [x] **T012** `[worker]` **(ffmpeg)** Drop `-metadata PERCEPTOR_SOURCE=…` from `buildCommand.ts`
      and keep `title`. Add an optional `globalTags` producer to `runFfmpeg`: called after FFmpeg
      exits and before `mkvmerge`, it writes a temp XML that is cleaned up with the other temps.
      Add `--no-global-tags` to the input and `--global-tags <xml>` when non-null. Update every
      case in `services/worker/ffmpeg/` (`worker/plan.md` step 6). → T009
      *Done when:* `‹worker› npx jest src/ffmpeg` is green, and `grep -rn PERCEPTOR_SOURCE
      services/worker/ffmpeg services/worker/src/ffmpeg` finds nothing.
- [x] **T013** `[worker]` Encode facts (`worker/plan.md` step 5). `encode.ffmpeg.ts` collects:
      - `SOURCE`, `VERSION`, `ENCODED_AT`;
      - `ENCODE`: codec and CRF/preset from a flag returned by `getVideoParams`, not re-parsed;
        `CONTENT_KIND`; `RESOLUTION_CEILING`; `SOURCE_RESOLUTION`; `OUTPUT_RESOLUTION` from a probe
        of the working file; `DEINTERLACED`;
      - `GRAIN`, `DUB_TRIM`, `STREAM_END_TRIM`.

      It passes the producer to `runFfmpeg`. A fact that throws is omitted with one warning
      (NFR-3). The `getVideoParams` return-shape change is an **(ffmpeg)** sub-step: dispatch it to
      the `ffmpeg` agent first if it touches `params.ts`. → T009, T011, T012
      *Done when:* `‹worker› npx --no tsc --noEmit` exits 0, and a driver-level spec with a mocked
      runner asserts two things: the producer's XML contains every REQ-4/REQ-5 child for an encode
      and omits `CRF`/`PRESET`/`GRAIN` for a copy; a throwing resolution probe leaves out only
      `OUTPUT_RESOLUTION`.
- [x] **T014** `[worker]` `src/tags/merge-library-tags.ts` plus `merge-library-tags.spec.ts`
      (`worker/plan.md` step 7). → T009
      *Done when:* the spec is green and covers all of these:
      - flat → group conversion, with values kept verbatim;
      - non-Perceptor tags kept in order and unchanged;
      - track groups keyed by UID;
      - the file wins over api facts;
      - `OUTPUT_RESOLUTION` from the probe only when a group is written;
      - `unchanged` for an already-migrated file and for a file with nothing to add;
      - its own output fed back in → `unchanged`.
- [x] **T015** `[worker]` `src/jobs/library-tags.job.ts`, the queue copy in `src/queue/types.ts`
      (identical to `api`'s), the seventh `Worker` in `src/index.ts` (concurrency 1, after
      `encodeWorkerStarted`), and the i18n keys (`worker/plan.md` steps 8 and 9). Writability is
      checked with `fs.access`, never a `.perceptor-probe`. The temp XML lives under the OS temp
      directory. Reports go through `deliverReport`. Add `library-tags.job.spec.ts`. → T005, T014
      *Done when:* the job spec is green on these cases:
      - `item_settled`/`item_not_found` → no report;
      - missing → `MISSING`;
      - unwritable → `FAILED` with no `mkvpropedit` spawned;
      - `mkvpropedit` non-zero → `write_failed`;
      - probe mismatch → `verify_failed` with no second write;
      - `unchanged` → `UNCHANGED` with no write;
      - temps removed on every path.

      `diff <(grep -A3 LIBRARY_TAGS services/api/src/queue/types.ts) <(grep -A3 LIBRARY_TAGS
      services/worker/src/queue/types.ts)` is empty.
- [x] **T016** `[worker]` Close the slice. In `services/worker/CLAUDE.md`, add the queue-table row,
      a section on the tag group and the migration, and update the `046`/`107` mentions of the flat
      tags. Run the full suite. → T010, T013, T015
      *Done when:* `‹worker› npx --no tsc --noEmit` exits 0, `npm test` is green as uid 1000, and
      `bin/comments worker` passes.
- [x] **T017** `[web] [P]` Types, actions and the block (`web/plan.md` steps 1–3). This covers
      `src/types/library-tags.ts`, `src/actions/library-tags.ts`,
      `LibraryTagMigrationBlock.tsx`, and wiring through `EnvironmentPanel`, `SettingsForm` and
      `settings/page.tsx`. Add `LibraryTagMigrationBlock.test.tsx`. → T007
      *Done when:* the block renders the three states, disables the start button while running, calls
      the action once on confirm, shows `migration_running` inline and lists failures with a
      translated reason. `web` has no test runner (`services/web/CLAUDE.md` forbids adding one in a
      feature task), so this is checked by typecheck here and by the live pass (T020, AC-10).

      `‹web› npx --no tsc --noEmit` exits 0.
- [x] **T018** `[web]` Catalogs (`web/plan.md` step 4). Add `settings.environment.libraryTags.*`
      and `errors.libraryTags.*` in `en` and `es`, with the spec's Spanish strings verbatim. Check
      that the torrent, magnet and upload modals and the embed dialog render
      `error.libraryTags.busy` through the keyed display. → T017
      *Done when:* `‹web› node scripts/check-messages.mjs` passes and `bin/comments web` passes
      (`web` has no `npm test`).

### Group 3 — docs, live pass and acceptance

- [x] **T019** `[docs]` Root `CLAUDE.md`:
      - the Transcode row records that the flat `PERCEPTOR_SOURCE` became the nested `PERCEPTOR`
        group with its children, written by the final `mkvmerge`, and that `VERSION` is baked into
        the image;
      - the Notify media server row records the track group (`PROVIDER`, sync metrics) and the
        admin library tag migration (Settings → Environment, `mkvpropedit` in place, Article XII
        exception 3);
      - spec ref `123` in both rows.

      Append a `docs/spec/history.md` entry with the typecheck/test counts from T007, T016 and
      T018, the migration, and the contract diff. → T007, T008, T016, T018
      *Done when:* both rows name `123`, and `history.md`'s newest entry is `123` with real counts.
- [x] **T020** (partial, see record below) `[docs]` Live pass on a dev stack started from this checkout (not `ptor`). Follow
      `plan.md` § Verification steps 1–6, covering AC-1 to AC-12, including AC-7b/AC-7c. Record
      the `mkvinfo` excerpts and api log lines in this file under each criterion. → T019
      *Done when:* every AC has either an excerpt showing it, or a named blocker that is also
      written in `docs/spec/pending-acs.md` by `bin/pending-acs`.
- [x] **T021** `[docs]` Walk the acceptance criteria in `spec.md` and tick each verified box. Set
      `status: Implemented` on `spec.md`, `plan.md` and every `<svc>/plan.md`, and `status: Done`
      here. Run `/pending-acs`. → T020
      *Done when:* `grep -c "^- \[x\] \*\*AC" spec.md` equals the number of criteria verified in
      T020, and `bin/pending-acs --check` exits 0.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

## Live pass record (T020)

Done on 2026-11-20 with a throwaway container of `perceptor-worker:local-dev` (real `ffmpeg`, `mkvmerge`,
`mkvextract`, `mkvpropedit`) and the real `mergeLibraryTags`, no `api`, no browser:

- A one-second `.mkv` with a flat `PERCEPTOR_SOURCE` plus an unrelated `OTHER` tag was migrated:
  `mkvextract tags` output (with its BOM and `TagLanguageIETF`) merged into a `PERCEPTOR` group
  (`SOURCE`, `ENCODE` with `VIDEO_CODEC`, `CRF`, `PRESET`, `OUTPUT_RESOLUTION`), `OTHER` kept, then
  written with `mkvpropedit --tags all:`. Extracting again shows the group and no flat tag.
- Feeding that file back in returned `unchanged` (the file-level half of AC-8).

Observed holding: the global half of AC-7 and the file-level half of AC-8, on real tool output.
Not observed (named blockers, also written in `docs/spec/pending-acs.md`):

- AC-1, AC-2, AC-4: need a real encode on a dev stack with a library.
- AC-3: needs the first RC built from this change.
- AC-5, AC-7 (track half), AC-7b: need a real subtitle search, an embed and a delivered `ProcessJob`.
- AC-6, AC-10, AC-11, AC-12: need the admin UI in a browser, an embed in flight, a worker restart.
- AC-7c: needs Jellyfin configured.
- AC-9: needs a `chmod 000` file and a deleted one in a real library walk.

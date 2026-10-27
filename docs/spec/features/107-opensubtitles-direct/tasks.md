---
title: OpenSubtitles Direct — Tasks
last_updated: 2026-10-27
status: In Progress
---

# TASKS: OpenSubtitles Direct (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task: a task that needs two services is two tasks. |
| `[docs]` | Documentation, the contract doc and the manual pass. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |
| `[x]` `[~]` | `[~]` = implemented, awaiting a manual run by the maintainer. |

**Measuring.** The stack running on this host may be the end-user install, not this checkout, so
`bin/cli`/`bin/npm` may find no container. In that case, run each *Done when* command through the
throwaway container described in memory (`measuring-without-dev-stack`): `docker run --rm --user
1000:1000 -v "$PWD/services/<svc>":/app -w /app -e HOME=/tmp node:24.18.0-alpine sh -c '<command>'`.
Report which form was used.

**The key.** The real application key is in the maintainer's `.env` and in the repository's
`OPENSUBTITLES_API_KEY` GitHub Actions secret. No task writes it anywhere else, and none prints it.
A check that needs to compare against it reads it from `.env` inside the command; it is never typed
into one.

## Tasks

### Group 1 — `api`: schema, key, adapter and contract

- [x] **T001** `[api]` Schema, migration, settings and error keys (`api/plan.md` Steps 1, 2 and 4):
      - in `prisma/schema.prisma`, `SubtitleSearch` gains `movieHash`, `fileSizeBytes`, `probeCount`
        and `languageErrors`, and loses `itemId` and `checkCount`;
      - migration `107_opensubtitles_direct`, hand-ordered as `../plan.md` § Migrations: add
        columns, then the two `UPDATE`s, then the drops;
      - `opensubtitles_username` (`string`) and `opensubtitles_password` (`secret`) in
        `settings.catalog.ts` and `prisma/seeds/settings.ts`, and no key entry;
      - the seven new keys in `src/i18n/error-keys.ts` and `messages.en.ts`;
      - `media_server_unavailable`'s English copy no longer names Jellyfin.

      Existing code that still reads `itemId`/`checkCount` (the driver and the request service) is
      left compiling, by keeping only what T008/T007 replace. If it cannot compile, stub the read
      with a `// Spec 107, T008` locator and report it.
      *Done when:* `bin/cli api npx prisma migrate status` reports the migration applied, and
      `bin/cli api npx --no tsc --noEmit` exits 0.
- [x] **T002** `[api]` Application key and availability (`api/plan.md` Steps 3 and 13):
      - `src/clients/opensubtitles/key.ts` resolves `OPENSUBTITLES_API_KEY` (trimmed, non-empty),
        then `/app/secrets/opensubtitles_api_key` (read once, memoized, never throwing), then
        `null`;
      - the boot warning in `SubtitleSearchDriver.onApplicationBootstrap` when it resolves `null`,
        with no value logged;
      - `MediaCapabilitiesService`: availability = key resolves and both settings are non-empty;
        `assertSubtitleSearchAvailable` throws `provider_not_configured`;
      - the field description on `media-capabilities.entity.ts` matches the SDL in `spec.md`.

      Tests:
      - `key.spec.ts` on a real `mkdtemp` file;
      - `subtitle-search-flags.spec.ts` rewritten;
      - the settings case refusing an `opensubtitles_api_key` entry with
        `error.setting.not_editable`.

      All are listed in `api/plan.md` § Tests.
      *Done when:* `bin/npm api test -- key subtitle-search-flags settings` passes, and each new case
      fails when its rule is removed (env-over-file order, empty-variable fall-through, the settings
      refusal). → T001
- [x] **T003** `[api]` `OpenSubtitlesClient` (`api/plan.md` Step 5): `src/clients/opensubtitles/
      {client,types,errors}.ts`, consisting of:
      - `login` (with the Redis token cache keyed by a SHA-256 of key + username + password);
      - `search`;
      - `download`, returning `{ bytes, remaining }`;
      - the `401` re-login once, `406` → `quota`, the `429` wait bounded to 10 s, the rest →
        `unavailable`;
      - `User-Agent: Perceptor v<package.json version>`;
      - errors carrying method, path and status only.

      Provide it in `SubtitleSearchModule` (import `RedisModule`). Write `client.spec.ts` with
      `fetch` stubbed (cases in `api/plan.md` § Tests, including AC-8's "no error message contains
      the password or the key").
      *Done when:* `bin/npm api test -- opensubtitles` passes. → T002
- [x] **T004** `[api] [P]` Pure mappers and ranking (`api/plan.md` Step 6 and the `candidates.ts`
      row):
      - `sidecar-languages.ts` and `provider-languages.ts` against `Language` rows;
      - `candidates.ts` moves to a provider-neutral `SubtitleCandidate`. The filter becomes "exactly
        one file, not foreign-parts-only, not machine/AI-translated". The comparator and
        `releaseSimilarity` stay byte-identical.

      Specs for all three, per `api/plan.md` § Tests.
      *Done when:* `bin/npm api test -- candidates sidecar-languages provider-languages` passes, and
      the two-file case fails when the `fileCount` filter is removed. → T001
- [x] **T005** `[api]` The probe contract (`api/plan.md` Steps 7 and 9):
      - `SUBTITLE_PROBE_QUEUE`/`SUBTITLE_PROBE_JOB`/`SubtitleProbeJob` in `src/queue/types.ts`;
      - `src/queue/subtitle-probe-queue.service.ts` (`addProbe`, `removeProbe`, jobId
        `subtitle-probe-<id>`, `attempts: 1`);
      - `SubtitleProbeDetails` entity;
      - the four service-only operations in `SubtitleSearchService` and the resolver, with
        `@AllowService()` plus the explicit service-principal check;
      - `probeCompleted` resolves sidecar tags through T004's mapper;
      - `derive-languages.ts` reads `languageErrors`.

      Extend `subtitle-search.service.spec.ts`, `derive-languages.spec.ts` and add
      `subtitle-probe-queue.service.spec.ts` (remove before add).
      *Done when:* the tests pass, and `git diff services/api/src/schema.gql` shows
      `SubtitleProbeDetails`, `subtitleProbeDetails`, the three probe mutations and the new
      `subtitleSearchAvailable` description: exactly `spec.md` § GraphQL Contract Delta, nothing
      else. → T002, T004
- [x] **T006** `[api] [P]` Media-server clients and the embed (`api/plan.md` Steps 11 and 12,
      minus the Jellyfin removal, which is T008's):
      - optional `mediaHostPath` on `MediaServerClient`, implemented by Jellyfin and by Plex;
      - Plex `modifiedMedia` = the section-scoped scan `createdMedia` runs;
      - `SubtitleEmbedService.embedStaged(ref, tracks, mkvPath)` no longer resolves through a listing
        client;
      - `notifyJellyfin` → `notifyMediaServer`: no client means no warning.

      Extend `plex.spec.ts` and `subtitle-embed.service.spec.ts`.
      *Done when:* `bin/npm api test -- plex subtitle-embed` passes, including "no client →
      `completed` stores no warning" and the episode match by `parentIndex`/`index`. → T001
- [x] **T007** `[api]` Press-time path and delivery wake (`api/plan.md` Step 10):
      - `requestForCaller` resolves a no-`filePath` title's path through `createClient()` →
        `findByTmdbId` → `mediaHostPath` → `hostToContainerPath` → `assertUsableMkv`;
      - it throws `no_library_path` / `media_server_unavailable` /
        `error.subtitleEmbed.outside_library` before creating any row;
      - it stores `libraryPath`;
      - `requestFor` wakes at 0 and drops `checkCount`.

      Extend `subtitle-search-request.service.spec.ts`.
      *Done when:* `bin/npm api test -- subtitle-search-request` passes, including "no client → no
      row" and "Plex path → row carries `libraryPath`". → T006
- [x] **T008** `[api]` The driver (`api/plan.md` Step 8):
      - `WAITING` queues the probe with a 60-minute backstop;
      - `SEARCHING`/fetch go through `OpenSubtitlesClient`;
      - quota, unauthorized and rate-limit outcomes go into `languageErrors`;
      - search-wide failure ends `FAILED`;
      - `embedStaged` receives `search.libraryPath ?? filePath`;
      - the Jellyfin wait is removed (`MISS_DELAYS_MS`, `MAX_MISSES`, `resolveItem`, `clientOnce`'s
        media-server check, the `MediaServerService`/`MediaServerIndexService` injections).

      In the same task, remove `searchRemoteSubtitles`, `fetchRemoteSubtitle` and
      `RemoteSubtitleCandidate` from `clients/media-server/{types,jellyfin}.ts` and their specs. The
      driver is their only caller, so removing them in T006 would break the build in between.
      Extend `subtitle-search.driver.spec.ts`.
      *Done when:* `bin/npm api test -- subtitle-search` passes, including:
      - `WAITING` calls no OpenSubtitles method;
      - `remaining: 0` stops the next download and keeps the accepted language;
      - unauthorized fails the search;
      - `embedStaged` gets `libraryPath`.

      Also, `grep -rn "searchRemoteSubtitles\|fetchRemoteSubtitle\|RemoteSubtitleCandidate"
      services/api/src` is empty. → T003, T004, T005, T006
- [x] **T009** `[api]` Probe crash recovery (`api/plan.md` Step 14) in
      `ProcessJobsService.reconcileOrphanedEncodes`: `probeCount >= 2` → `FAILED interrupted`,
      `probeCount === 1` → `removeProbe` then `addProbe`, `0` left alone. Extend
      `process-jobs.service.spec.ts`.
      *Done when:* `bin/npm api test -- process-jobs` passes, and the re-queue case fails when the
      `removeProbe` call is moved after `addProbe`. → T005
- [x] **T010** `[api]` Slice gate (`api/plan.md` § Done when).
      *Done when:* all of the following hold:
      - `bin/cli api npx --no tsc --noEmit` reports 0 errors;
      - `bin/npm api test` is green;
      - `bin/npm api run lint` is clean;
      - `bin/comments api` passes;
      - `prisma migrate status` is up to date;
      - `grep -rn "checkCount\|itemId" services/api/src/subtitle-search` is empty;
      - the `schema.gql` diff is unchanged from T005's.

      The report includes test counts before and after. → T007, T008, T009

### Group 2 — consumers and the build

`worker` and `web` consume the contract T005 produced. The `worker`'s pure units and all of
`infra` depend on nothing in Group 1 (`infra` only on the key file path frozen in `plan.md`), so
they may start at once.

- [x] **T011** `[worker] [P]` Pure probe units (`worker/plan.md` Steps 3–5):
      - `src/subtitles/opensubtitles-hash.ts` (read-only handle, BigInt sum, 16 hex);
      - `embedded-languages.ts` (non-forced, any codec, `normalizeIso3`, `und` dropped);
      - `sidecars.ts` (exact `<base>.` prefix, first segment = raw tag, `forced`/`foreign` dropped).

      A spec for each, per `worker/plan.md` § Tests.
      *Done when:* `bin/npm worker test -- opensubtitles-hash embedded-languages sidecars` passes,
      including the prefix-collision case and the `'r'`-flag assertion.
- [x] **T012** `[worker]` The probe job (`worker/plan.md` Steps 1, 2, 6 and 7):
      - the queue constants and `SubtitleProbeJob` in `src/queue/types.ts`, identical to `api`'s;
      - `src/api/subtitle-probe-reports.ts`;
      - `src/jobs/subtitle-probe.job.ts`: `probe_not_found` and `started === false` report nothing;
        any throw reports `probe_failed`;
      - the `Worker` on `subtitle-probe` in `src/index.ts`, concurrency 1, built after the lease and
        `encodeWorkerStarted`.

      Write `subtitle-probe.job.spec.ts`.
      *Done when:* `bin/cli worker npx --no tsc --noEmit` exits 0, `bin/npm worker test` is green and
      `bin/comments worker` passes. → T005, T011
- [~] **T013** `[web] [P]` Settings → General (`web/plan.md` Steps 1–3):
      - `CLEARABLE_KEYS` in `src/actions/settings.ts` (the two keys, sent blank included);
      - the OpenSubtitles block in `GeneralPanel.tsx`: two fields, the paragraph, the sign-up link
        (confirm the URL; never the consumers page);
      - the wiring in `SettingsForm.tsx`.

      There is no API key field anywhere.
      *Done when:* `bin/cli web npx --no tsc --noEmit` exits 0, and with the dev stack up, saving the
      block then emptying the username persists `""` (`bin/mysql -e "select value from settings
      where \`key\`='opensubtitles_username'"`). → T001
- [x] **T014** `[web] [P]` Copy (`web/plan.md` Steps 4–5):
      - rename `subtitleSearchRequiresJellyfin` → `subtitleSearchRequiresProvider` with the new
        text;
      - add the seven `errors.subtitleSearch.*` keys;
      - change the copy of `media_server_unavailable` and `subtitleEmbed.jellyfin_refresh_failed`.

      This applies to both `messages/es.json` and `en.json`.
      *Done when:* typecheck exits 0, `bin/npm web run lint` and `bin/comments web` pass, and
      `grep -c "subtitleSearchRequiresJellyfin" -r services/web` is 0. → T001
- [x] **T015** `[infra] [P]` The image (`infra/plan.md` Steps 1 and 4):
      - in `services/api/Dockerfile`'s `prod` stage, the `RUN --mount=type=secret,
        id=opensubtitles_api_key` writing `/app/secrets/opensubtitles_api_key` with mode `0444`,
        only when present, before `USER nestjs`;
      - in `docker-compose.build.yaml`, `api.build.secrets` and the top-level `secrets:` entry;
      - verify Compose reads it from `.env`. If it does not, `bin/build`/`bin/prod` export that one
        line.

      *Done when:* with the key in `.env`, `bin/build prod api` succeeds and
      `docker run --rm --entrypoint stat perceptor-api:local-prod -c %a
      /app/secrets/opensubtitles_api_key` prints `444`. `docker history --no-trunc` and
      `docker inspect` of that image do not contain the key (grep with the value read from `.env`).
      Without the line in `.env`, the same build succeeds and the file is absent (AC-17, first
      half).
- [x] **T016** `[infra] [P]` Development wiring (`infra/plan.md` Steps 3 and 5):
      - `OPENSUBTITLES_API_KEY=${OPENSUBTITLES_API_KEY:-}` under `api.environment` in
        `docker-compose.dev.yaml`, with its comment;
      - the commented, empty `OPENSUBTITLES_API_KEY=` in `.env.example`.

      `docker-compose.yaml` is untouched.
      *Done when:* `docker compose -f docker-compose.yaml -f docker-compose.build.yaml -f
      docker-compose.dev.yaml config` lists the variable under `api` (check with `grep -c`, never
      printing the value), the same `config` without the dev overlay does not, and `git diff
      docker-compose.yaml` is empty.
- [x] **T017** `[infra]` The release (`infra/plan.md` Step 2), in `.github/workflows/release.yml`'s
      `build` job:
      - the "Require the OpenSubtitles key" step, scoped to `matrix.service == 'api' &&
        github.repository == 'dientuki/perceptor'`;
      - the `secrets:` input, conditional on the `api` leg.

      *Done when:* the workflow parses (`gh workflow view release.yml` or an
      `actionlint`/`yamllint` run in a throwaway container), `grep -n "secrets:"` shows the input
      only on the build step and scoped to `api`, and no step echoes the value. Not exercised by a
      real tag here: the live check is AC-16 (T021). → T015

### Group 2b — provenance tags (spec 0.4.0, REQ-14)

Added after the first implementation pass, during the manual test. T001–T017 are untouched.

- [x] **T023** `[api]` Provenance (`api/plan.md` Step 15):
      - a **new** migration `<timestamp>_107_subtitle_provenance` adding
        `subtitle_search_attempts.providerFileName VARCHAR(500) NULL` (never edit
        `107_opensubtitles_direct`, already applied in dev);
      - `OpenSubtitlesClient.search` maps `files[0].file_name` to `SubtitleCandidate.fileName`;
        ranking untouched;
      - the driver stores `providerFileName` on the attempt and passes `provenance` (that name, else
        `opensubtitles:<providerSubtitleId>`) to `embedStaged`;
      - `StoredTrack.provenance`: `embedStaged` stores it, `101`'s hand embed stores `user`;
      - `SubtitleEmbedTrack.provenance: String!` with the SDL description in `spec.md`; `details()`
        serves `user` (sidecar) / `opensubtitles` (staged) for a stored track without it.

      Tests per `api/plan.md` § Tests (Provenance).
      *Done when:* `prisma migrate status` reports the new migration applied; `tsc` 0 errors; the
      full `api` jest suite is green; `git diff services/api/src/schema.gql` shows only T005's delta
      plus the `provenance` field; `bin/comments api` passes.
- [x] **T024** `[worker]` Provenance tags (`worker/plan.md` Step 8):
      - `subtitleEmbedDetails` selects `provenance` (optional in the hand-typed track);
      - `src/subtitles/embed-tags.ts`: `sanitizeTagValue` and `buildTrackTagsXml`;
      - the embed job writes one tags XML per track with a non-empty `provenance`, in the same
        scratch directory and cleanup as the normalized `.srt`;
      - `embed-args.ts` adds `--tags 0:<path>` for a track with `tagsPath`, nothing otherwise.

      `embed-tags.spec.ts` and the `embed-args.spec.ts` cases per `worker/plan.md` § Tests. Also run
      `mkvmerge` once in the worker image over a tiny generated `.mkv` + `.srt` with the XML, and
      `mkvinfo` the output: the two tags sit on the subtitle track (this is the unverified assumption
      in `plan.md`).
      *Done when:* `tsc` 0 errors, the full `worker` suite is green, `bin/comments worker` passes, and
      the `mkvinfo` check shows `PERCEPTOR_SOURCE`/`PERCEPTOR_OFFSET` on the new track. → T023
- [x] **T025** `[docs]` 0.4.0 in the docs: `docs/spec/graphql-contract.md`'s `107` section gains
      `SubtitleEmbedTrack.provenance`; `services/api/CLAUDE.md` (`subtitle-search/`, `subtitle-embed/`)
      and `services/worker/CLAUDE.md` (`subtitle-embed` row) mention the two tags; a `history.md`
      addendum with the re-measured counts.
      *Done when:* `grep -n "provenance\|PERCEPTOR_OFFSET"` finds each of those files. → T023, T024

### Group 3 — verification and docs

- [x] **T018** `[docs]` Add a `107-opensubtitles-direct` section to `docs/spec/graphql-contract.md`:
      - the probe query and three mutations;
      - the queue payload;
      - `subtitleSearchAvailable`'s new meaning;
      - the new, kept and retired error keys;
      - the worker's abandon-silently rules.

      Copy them from `spec.md` § GraphQL Contract Delta.
      *Done when:* the section matches the SDL in `spec.md` word for word, and the `103` section's
      Jellyfin wording carries a "superseded by 107" note. → T010
- [x] **T019** `[docs]` Update the docs:
      - root `CLAUDE.md`:
        - the **Notify media server**, **Transcode** and **Browse library** pipeline rows (`107`
          added to their spec lists; the search no longer goes through Jellyfin);
        - an `OPENSUBTITLES_API_KEY` bullet in § Environment (dev `.env`, release secret baked into
          the `api` image, never a Setting, rotation = new key + secret + release);
      - `services/api/CLAUDE.md`'s `subtitle-search/` and `subtitle-embed/` entries and the
        `clients/` paragraph (the `opensubtitles/` adapter, `mediaHostPath`, Plex `modifiedMedia`);
      - `services/worker/CLAUDE.md` (the `subtitle-probe` job);
      - `services/web/CLAUDE.md` if it describes the Settings tabs;
      - a `docs/spec/history.md` entry measured with the commands at the top of that file.

      *Done when:* `grep -n "107" CLAUDE.md services/*/CLAUDE.md` finds each touched entry, and
      `bin/comments` passes. → T010, T012, T014, T017
- [~] **T020** `[docs]` Manual pass, `plan.md` § Verification items 1–12 and 14, covering AC-1 to AC-14,
      AC-17 and AC-18. Requires the maintainer's real opensubtitles.com account and the key in `.env`. AC-15 is
      T010 + T012's gates.
      *Done when:* each AC ticked from an observed run, or left `[~]` with what is missing (a
      2-CD title for AC-3, an account at zero for AC-6, a Plex server for AC-13). → T010, T012,
      T013, T014, T016, T024
- [~] **T021** `[docs]` AC-16, after the first release candidate that carries 107: the key file on
      the published tag, with mode `444`, and absent from `docker inspect`/`docker history`.
      *Done when:* AC-16 is ticked, or left `[~]` with "no RC cut yet" and named as its blocker in
      `docs/spec/pending-acs.md`. → T017
- [ ] **T022** `[docs]` Walk the acceptance criteria in `spec.md` (AC-1 to AC-18), tick each one
      verified, set `status: Implemented` on `spec.md`, `plan.md` and every `<svc>/plan.md`, set this
      file to `Done`, and run `/pending-acs`.
      *Done when:* no AC is unaccounted for (ticked, or `[~]` with a named blocker), and
      `bin/pending-acs --check` exits 0. → T018, T019, T020, T021, T025

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty
entry is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.

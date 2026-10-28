# Measurement history

Every `/implement` run's post-flight measurement (typecheck, test counts, migrations, GraphQL
contract diff, live manual pass), newest first. Moved out of the root `CLAUDE.md` by
`086-comment-locator-convention` REQ-10 — that file's `## Current state` had grown to a 213-line
changelog nobody could skim.

**Cadence rule (REQ-11):** a new measurement after `/implement` is appended here, at the top,
never into the root `CLAUDE.md`. Re-measure with:

```bash
bin/npm api run test
bin/cli api npx tsc --noEmit
bin/npm worker test
bin/cli worker npx tsc --noEmit
bin/cli web npx tsc --noEmit
bin/npm web run build   # only with the dev stack down — see root CLAUDE.md
bin/cli web node scripts/check-messages.mjs
git status --short services/api/prisma
git diff --stat -- docs/spec/graphql-contract.md services/api/schema.gql 2>/dev/null || true
```

**Re-run the checks rather than trusting these numbers** — they exist so an agent can prove a
change added nothing, not as a fact to cite.

## 2026-10-28 — `109-tmdb-list-import` 0.3.0 (per-title "download automatically")

`api`, `web`; one Prisma migration (`20261028043654_title_auto_acquire`: `UserMovie.autoAcquire`, `UserShow.autoAcquire`, both `NOT NULL`; created `DEFAULT true`, then switched to `DEFAULT false` by `20261028044526_title_auto_acquire_default_off` and every existing row reset to `false` by `20261028044540_title_auto_acquire_reset_existing`, after the maintainer asked for off by default), applied on the dev stack (`prisma migrate status`: up to date) and `api` restarted afterwards. GraphQL contract: `Movie.autoAcquire`, `Show.autoAcquire`, `setMovieAutoAcquire`, `setShowAutoAcquire`, matching the amended SDL.

- `api` typecheck: 0 errors. Full suite: 93 suites, 1546 tests passed (the three touched suites, 46 tests, include the `MAX_MOVIES_PER_RUN` + 1 opted-out cap cases for films and episodes and the opted-out-owner cases in `ranking-context`). `bin/comments api`: PASS (1274 locators).
- `web` typecheck: 0 errors (the seven `Calendar.tsx` errors recorded earlier no longer appear). `check-messages`: 766 keys in parity. `bin/comments web`: PASS (138 locators). Biome clean on the new file; 4 pre-existing `noNonNullAssertion` warnings in `actions/shows.ts`.
- Not observed: the switch rendered in a browser on a `MISSING` and a `COMPLETED` title, and a live sweep run with the switch off (AC-18 … AC-22 stay open; the sweep behaviour is proven by unit tests only).

## 2026-10-28 — `109-tmdb-list-import` 0.2.0 (lists pages)

`api`, `web`; one Prisma migration (`20261028033541_tmdb_list_item_count`: `UserTmdbList.itemCount`), applied on the dev stack (`prisma migrate status`: 51 migrations, up to date). GraphQL contract: `TmdbList.itemCount`, `TmdbList.movies`/`shows` and `Query.tmdbList(id)`, matching the amended SDL. The lists UI moved out of `/preferences` into "Mis listas" (`/lists`, `/lists/<id>`).

- `api` typecheck: 0 errors. Tests: `tmdb-lists` 2 suites, 20 passed; `client.spec` 4 suites, 57 passed. `bin/comments api`: PASS (1257 locators). Full suite and lint not run.
- `web` typecheck: only the 7 known `Calendar.tsx` errors. Biome clean on every new or changed file except 3 pre-existing errors in `AppSidebar.tsx`. `check-messages`: 762 keys in parity. `bin/comments web`: PASS (133 locators).
- Live pass as a throwaway non-admin user, since removed: AC-14, AC-16, AC-17 observed; AC-15 observed for films (11 posters, 10 after a removal) but not for a series or a short.
- Process note: after `prisma migrate dev`, the running `api` still held the old Prisma client (`Unknown argument itemCount`, one `FAILED` run) until `docker compose restart api`.

## 2026-10-27 — `109-tmdb-list-import`

`api`, `web`; one Prisma migration (`20261027140000_tmdb_list_import`: `user_tmdb_lists`, `user_tmdb_list_items`), written offline with `prisma migrate diff` and `prisma validate`, then **applied** by `api`'s own boot on the dev stack (`prisma migrate status`: schema up to date, both tables present, both `schedule_import_lists_*` settings seeded). GraphQL contract: `schema.gql` carries the five spec pieces (`TmdbList`, `tmdbLists`, `addTmdbList`, `removeTmdbList`, `MediaCapabilities.listImportEnabled`), generated offline with `GraphQLSchemaFactory` and copied in by hand, not by a real boot. Also fixes the `register()` create race for films and series (NFR-4).

- Measured in the throwaway node container as uid 1000 (the stack on this host is a different install).
- `api` typecheck: 0 errors. Tests: 91 of 93 suites pass, **1516 passed, 20 failed**; the two failing suites (`auth/session.service.spec`, `uploads/upload-tickets.service.spec`) use a real Redis and are in files this feature does not touch. The feature's own suites (movies, shows, tmdb client, tmdb-lists, media-capabilities, scheduler): 16 suites, **265 passed**. Comments gate: PASS (1252 locators).
- `api` lint (`npm run lint`): **not verified**. It reports 3180 problems tree-wide in the container, so it cannot be attributed to this change; `tmdb-lists.service.spec.ts` has unsafe-`any` mock typing like its neighbours.
- `web` typecheck: 7 errors, all the pre-existing `@fullcalendar` ones in `Calendar.tsx`. `check-messages`: 754 keys match. Comments gate: PASS (125 locators). Biome on the eight files this change touched: no errors (2 warnings); tree-wide `biome check` reports 1549 errors in the container, not attributed.
- Not measured: the manual pass (AC-1 to AC-5, AC-7 to AC-13), the live `runScheduledTask(id: "import_lists")`, `prisma migrate status`, and the `/preferences` section in a browser at 375 px. Only AC-6b is ticked (the forced-`P2002` cases in the movies and shows specs).

- Live pass (2026-10-28, dev stack of this checkout, two throwaway users since removed): `runScheduledTask("import_lists")` → `SUCCESS` with 11 titles from a public 11-film list, then 0 on every rerun (AC-3); a film removed by the user was not re-added (AC-4); a second user attaching the same list owned all 11 with no duplicate `tmdbId` (AC-6); the `/preferences` section rendered and showed its inline error with no horizontal scroll at 375 px. It surfaced one defect, fixed: the last-import time threw a hydration error because server and browser formatted it in different time zones (`mounted` guard, as `SchedulingPanel`). Not covered: a list with a series, a real private list, the disabled-task notice on screen.

## 2026-10-27 — `108-library-track-languages`

`api`, `worker`, `web`; one Prisma migration (`20261027130000_108_library_track_languages`: `fileAudioLanguages`, `fileSubtitleLanguages`, `tracksReadAt` on `movies` and `episodes`), applied; `prisma migrate status` up to date (49 migrations). GraphQL contract: `schema.gql` carries exactly the spec delta (four `file*Languages` fields, `LibraryProbeTarget`, `LibraryProbeDetails`, `libraryProbeDetails`, `libraryProbeCompleted`).

- `api` typecheck: 0 errors. Tests (`bin/npm api test`): 90 suites, **1508 passed** (1475 after `107`). Comments gate: PASS (1230 locators).
- `worker` typecheck: 0 errors. Tests: 56 files, **680 passed** (657). Comments gate: PASS (392 locators).
- `web` typecheck: 7 errors, all pre-existing in `Calendar.tsx`. `check-messages`: 730 keys match. Comments gate: PASS (118 locators). No web test runner.
- `107`'s `subtitle-search-request` spec is byte-identical after the `LibraryLocationService` extraction (the service keeps `mediaServer`/`mediaRoots` and takes the locator as an optional seventh constructor argument).
- Not measured: the manual pass (AC-1 to AC-12) needs the other Perceptor install on this host stopped (`bin/stop -y`) and, for AC-3, a Plex server. AC-13 (no write to the library) is covered by the worker spec's before/after directory listing.

## 2026-10-27 — `107-opensubtitles-direct`

**Addendum — amendment 0.4.0 (provenance tags, T023–T025).** One more migration
(`20261027120000_107_subtitle_provenance`: `providerFileName VARCHAR(500) NULL`), applied; `prisma migrate status` up to date (48 migrations).

- `api`: typecheck 0 errors; 87 suites, **1477 passed**; comments PASS (1195 locators). `schema.gql` gains only `SubtitleEmbedTrack.provenance: String!`.
- `worker`: typecheck 0 errors; 54 files, **663 passed**; comments PASS (386 locators).
- `mkvmerge --tags 0:<xml>` with empty `Targets` verified in the worker image's tooling: `mkvmerge -J` shows `tag_perceptor_source` / `tag_perceptor_offset` on the new subtitle track only, none on video or audio (AC-18 mechanism; the full manual pass is still open).


`api`, `worker`, `web`, `infra`; one Prisma migration (`20261027021722_107_opensubtitles_direct`: four `ADD COLUMN`s on `subtitle_searches`, two `UPDATE`s retiring searches still waiting on Jellyfin, then `DROP COLUMN itemId, checkCount`; `migrate status`: "Database schema is up to date!"). Contract delta: `SubtitleProbeDetails`, `subtitleProbeDetails`, `subtitleProbeStarted`/`Completed`/`Failed`, the new `subtitleSearchAvailable` description, and a `subtitle-probe` queue; `schema.gql` diff is exactly that (42 insertions, 1 deletion), edited by hand because the `api` container could not boot (cross-checked against `GraphQLSchemaFactory` output). Jellyfin's `searchRemoteSubtitles`/`fetchRemoteSubtitle` removed.

- `api` typecheck: 0 errors. Tests (throwaway container on the compose network): 87 suites, **1475 passed** (1414 after `106`). `bin/comments api`: PASS (1188 locators). Full-service ESLint is not a usable gate (3061 problems, almost all on untouched files); not run as a gate.
- `worker` typecheck: 0 errors. Tests: 53 files, **657 passed**. Comments gate: PASS (380 locators).
- `web` typecheck: 7 errors, all in `src/components/calendar/Calendar.tsx` (`@fullcalendar/react` not installed in this checkout; present before 107). `check-messages`: OK (727 keys). Comments gate: PASS (116 locators). No test script.
- `infra`: `bin/build prod api` with the key in `.env` produces `/app/secrets/opensubtitles_api_key` with mode `444`; the key value appears in neither `docker history --no-trunc` nor `docker inspect` (0 matches each). Without the key the build exits 0 and the file is absent. `release.yml` passes `actionlint` 1.7.7. `docker-compose.yaml` untouched.
- Not measured: the live stack (another Perceptor install holds ports 4000/9696 on this host), so the manual pass and AC-16 (needs the first RC) are open.

## 2026-10-26 — `106-manual-subtitle-search`

`api`, `web`; one Prisma migration (`20261026130000_106_subtitle_search_library_path`, one nullable `ADD COLUMN`; `migrate status`: "Database schema is up to date!"). `worker` untouched. Contract delta: `searchMovieSubtitles(movieId)` and `searchEpisodeSubtitles(episodeId)` added to `Mutation`, plus two error keys (`error.subtitleSearch.in_progress`, `no_languages`); `schema.gql` also reordered some existing blocks on regeneration (Nest module ordering, no content change). Constitution Article XII amended to v1.7.0 first.

- `api` typecheck: 0 errors. Tests (throwaway container on the compose network, so Redis is reachable): 82 suites, **1414 passed**. `bin/comments api` gate: PASS (1143 locators).
- `web` typecheck: 7 errors, all in `Calendar.tsx` (`@fullcalendar/react`), predating this feature. `check-messages`: "en.json and es.json match exactly (715 keys)". `bin/comments web` gate: PASS (116 locators).
- Article XII Check: `grep -rn "embedStaged\|requestFor" services/api/src --include=*.ts`, specs excluded, lists only `process-jobs/`, the driver, the request service, the resolver and the `embedStaged` definition.
- Not done: the UI and the live pass were not exercised (no dev stack; the Jellyfin OpenSubtitles plugin and quota are needed): AC-1 to AC-8b stay with the maintainer, see `tasks.md` T010.

## 2026-10-26 — `103-subtitle-search` (amendment 0.5.0 implemented; feature not closed)

`api`, `web`; one Prisma migration (`20261026120000_drop_per_title_subtitle_search`, two `DROP COLUMN`, no backfill; `migrate status`: "Database schema is up to date!"). `worker` untouched. Contract delta: `Movie.subtitleSearch`, `Show.subtitleSearch`, `setMovieSubtitleSearch` and `setShowSubtitleSearch` removed (`schema.gql`: 14 lines deleted, nothing else). The user preference is now the only switch.

- `api` typecheck: 0 errors. Tests (`bin/npm api test`): 82 suites, **1396 passed**. `bin/comments api`: PASS.
- `web` typecheck: 7 errors, all in `Calendar.tsx` (`@fullcalendar/react`), predating this feature. `check-messages`: "en.json and es.json match exactly (706 keys)". `bin/comments web`: PASS (111 locators). No per-title `subtitleSearch` reference remains in `services/web/src` (`grep`).
- Not done: the UI was not exercised (the dev stack could not start, another install holds ports 80/3000/4000); the manual pass for AC-1, AC-1b, AC-2 and AC-8 is T035.
- Behaviour change to expect: a user with the preference on now gets a search on every later delivery, which spends provider quota.

## 2026-10-25 — `104-torrent-api-key-auth`

`infra`, `api`, `web`; no Prisma migration (a seed entry deleted), `worker` untouched. Contract delta: one new error key (`error.download.torrent_client_unauthorized`), no type or operation change; `git diff src/schema.gql` is empty.

- `api` typecheck: 0 errors. Tests (`npm test` in a throwaway container with a throwaway Redis, since no dev stack was up): 82 suites, **1401 passed**. Run without Redis, `auth/session.service` and `uploads/upload-tickets.service` fail with `MaxRetriesPerRequestError`; with it they pass. Six assertions in the `episodes`/`seasons`/`movies` specs expected the raw `TorrentClientError` and were updated to the keyed error `104` now raises. `bin/comments api` gate: PASS (1136 locators).
- `web` typecheck: 7 errors, all in `Calendar.tsx` (`@fullcalendar/react`), predating this feature. `scripts/check-messages.mjs`: "en.json and es.json match exactly (709 keys)". `worker`: unchanged, not re-run.
- Live pass on the dev stack (`bin/dev -d` after rebuilding `torrent`, `indexer`, `api`): `torrent.<DOMAIN>/api/v2/app/version` and `localhost:8080/...` both `403`, `200` with the bearer, `AuthSubnetWhitelistEnabled=false` in the conf, `api`'s environment key accepted by `torrent` (`200`; none or another key `403`), zero occurrences of the key in `torrent`/`api`/`indexer` logs. AC-10 under compose: with `INDEXER_API_KEY=` the `indexer` restarts (exit 1), its log names the variable, `config.xml`'s `<ApiKey>` hash is unchanged, and recreating with the real `.env` brings `/ping` back to `200`. AC-7 verified in throwaway containers (empty key and a hex key both exit non-zero, naming `TORRENT_API_KEY`, key absent from the log). AC-1 to AC-6, AC-8 and AC-9 stay open: see `docs/spec/pending-acs.md`.

## 2026-10-25 — `103-subtitle-search` (amendment 0.4.0 implemented; feature not closed)

`api`, `worker`, `web`, `infra`; one Prisma migration (`20261024192157_add_subtitle_search`, `migrate status`: "Database schema is up to date!"). Contract delta: `subtitleSyncCompleted` gained `mediaDurationMs: Int!` and `lastChapterStartMs: Int` in 0.4.0; the `schema.gql` diff is exactly those two arguments.

- `api` typecheck (`bin/cli api npx tsc --noEmit`): 0 errors. Tests (`bin/npm api test`): 81 suites, **1382 passed**. `bin/comments api`: PASS (1127 locators).
- `worker` typecheck: 0 errors. Tests (`bin/npm worker test`): 49 files, **635 passed**. `bin/comments worker`: PASS (370 locators).
- `web` typecheck: 7 errors, all in `Calendar.tsx` (`@fullcalendar/react`), predating this feature. `bin/cli web node scripts/check-messages.mjs`: "en.json and es.json match exactly (708 keys)". `bin/comments web`: PASS (115 locators). No web test runner exists.
- Thresholds, measured 2026-10-25 on the dev stack with real Jellyfin/OpenSubtitles candidates (user verdicts in brackets):

| Candidate | Reference | Score | Offset (s) | Ratio | Note |
| :-- | :-- | --: | --: | --: | :-- |
| Split #1 / #2 / #3 | subtitle | 630 129 / 633 427 / 629 973 | 0 / -1 / 0 | 1.000 | |
| Up in the Air #1 / #2 / #3 | subtitle | 373 920 / 364 547 / 382 513 | -6.28 / -1.15 / -7.21 | 1.000 | |
| Lost World #1 | subtitle | 604 068 | -4.16 | 1.000 | 94 % of duration [good] |
| Lost World #2 / #3 | subtitle | 307 289 / 320 324 | -0.08 / -3.38 | 1.000 | 2-CD halves, 48 % / 50 % |
| Resident Evil #1 / #2 | audio | -274 713 / -249 509 | 586.89 / -558.20 | 1.043 / 1.042 | PAL |
| Resident Evil #3 | audio | 247 976 | -0.13 | 1.000 | [good] |
| Shutter Island es #1 / #2 / #3 | audio | 191 485 / 217 484 / 197 537 | 55.51 / 1.03 / 0.58 | 1.043 / 1.000 / 1.001 | #2 [good] |
| Shutter Island en #1 / #2 | audio | 179 955 / 202 612 | — | 1.043 / 1.000 | #2 [good] |
| Guyver good / bad | subtitle | 438 001 / 28 446 | — | — | earlier pass |
| Guyver good / bad | audio | 211 884 / -1 051 | — | — | earlier pass |

  Set: `SUBTITLE_REFERENCE_MIN_SCORE` = 100 000, `AUDIO_REFERENCE_MIN_SCORE` = 50 000. Last-chapter starts at 94–96 % of the duration on all five films; good candidates cover at least 99 % of that start, the 2-CD halves 51–53 %. The audio reference took about 2 min per run, the subtitle reference 6–15 s. The coverage shares (85 % / 60 %) and the 80 % chapter gate are provisional.
- Not measured: the live pass (T027), the arm64 proof of `ffsubsync` (T013, waits for an RC tag run), the browser checks (T020–T022), and four English downloads (Resident Evil en #1–#3, Shutter Island en #3) that failed when the provider's daily download quota ran out (Jellyfin's log: `OpenSubtitles download limit reached`; the API answers a bare 500).
- Process note: `bin/npm api run lint` auto-fixes and rewrote about 170 unrelated `api` files during T030; they were restored with `git checkout -- services/api`. Do not run it as a check.

## 2026-10-24 — `102-subtitle-content-pruning`

`worker` only; no Prisma migration, GraphQL Contract Delta **None** (`schema.gql` untouched by this feature).

- `worker` typecheck (`bin/cli worker npx --no tsc --noEmit`, dev stack running): 0 errors.
- `worker` tests (`bin/npm worker test`): 46 files, **607 passed** (44 files / 551 before this feature: `subtitle-content.spec.ts` 41, `subtitle-prune.spec.ts` 8, the C0 and `contentDrops` cases in `params.spec.ts`, the Running Man corpus case `ffmpeg/3.json`).
- Comments gate (`bin/comments worker`): PASS (355 locators resolved, spanish=0, malformed=0).
- Fixtures: `grep -rc "Berk" services/worker/fixtures/subtitle-content/*/` prints only `0`s; every `manifest.json` verdict is asserted through `pruneLanguage`.
- Library scan, read-only (`resolveSubtitlePruning` over every `.mkv` under `/mnt/perceptor/Movies` and `Shows`, 968 files, spoken languages unrestricted): 178 files have more than one text track in a language; the rules would drop at least one track in 38 (6 films, 32 episodes: 39 `sdh`, 2 `same`, 2 `contained`) and leave 140 alone (regional Spanish variants, files already reduced by the tag rules).
- Not measured: T011 (the live pass on a stack running the new worker image: AC-1, AC-2, AC-3, AC-9, AC-10, AC-11).

## 2026-10-23 — `101-jellyfin-subtitle-embed`

All three services plus a constitution amendment (Article XII, v1.5.0, T001). One Prisma migration
(`20261024021356_add_subtitle_embed`, applied to this checkout's `perceptor-db-1`; `migrate status`:
43 migrations, up to date) and a GraphQL contract delta.

- `api` typecheck (`tsc --noEmit`, throwaway `node:24.18.0-alpine` container as uid 1000, no dev stack): 0 errors.
- `api` tests: 72 suites, **1250 passed**, run with a temporary `redis:7-alpine` on a scratch network (without Redis `session.service` and `upload-tickets.service` time out in their hooks, as before this feature).
- `worker` typecheck: 0 errors. `worker` tests: 44 files, **551 passed** (540 before T017/T018; the subtitle-embed job spec is 11 of them).
- `web` typecheck: 7 errors, all in `src/components/calendar/Calendar.tsx` (fullcalendar types, a file this feature does not touch; none in 101's files). `check-messages.mjs`: parity OK, 674 keys. Biome was run per touched file only (the container's `node_modules` carries biome 2.2.0, not the pinned version); the full-tree run was not trusted.
- Comments gate (`node tools/comments/check.mjs`): api PASS (994 locators), worker PASS (326), web PASS (105).
- GraphQL contract: `git diff services/api/src/schema.gql` is 96 added lines and matches the spec's Contract Delta, plus one line outside it, `EncodeJobDetails.streamEndTrimEnabled` — drift from `099`, whose section in `graphql-contract.md` already documents it; the committed schema was stale and regenerating it picked it up.
- AC-14 grep: no removal in `services/api/src` from this feature (the only three `rm(` hits are `downloads.service.ts`, pre-existing, downloads root); in `services/worker/src` the new removals are `subtitle-embed.job.ts` only: the chown probe file and `<final>.part.mkv` (scratch), the temp dir, and the guarded sidecar `unlink`.
- mkvmerge track ids against ffprobe stream indexes (`mkvmerge -J` vs `ffprobe` on a generated MKV inside `ptor-worker-1`, nothing under `/mnt/perceptor`): identical (0 video, 1 audio, 2 subtitles). A real `mkvmerge` run with the argv shape `embed-args.ts` produces appended a `spa`/`Español` track as default, cleared the existing track's default and kept the original streams in order.
- Not measured: the pipeline end to end against a live Jellyfin and a real library file (Green Book, AC-1..AC-15 manual pass), the UI in a browser, and `Items/{id}` with `fields=MediaStreams,Path` (the series listing was probed read-only during planning; the single-item read was not). See `pending-acs.md`.

## 2026-10-21 — `100-bluray-disc-remux`

`worker` and `web` (two catalog keys); no `api`, no migration, no GraphQL schema change (`graphql-contract.md` only gained the two key names in its worker error row).

- `worker` typecheck (`tsc --noEmit`, throwaway `perceptor-worker:local-dev` container because the compose `worker` was not running): clean.
- `worker` tests: 39 files, 506 passed (was 36 files / 477 before the first task of this feature; the baseline count of the run before 100 was not recorded). `bin/comments worker`: PASS, 296 locators.
- `web`: `check-messages.mjs` parity OK (639 keys, run on the host's Node). `bin/npm web run lint` **not run** — the `web` container was not up.
- Real disc (The Transformers: The Movie 1986, 2160p BDMV, run outside the pipeline with the real `scanDisc` + `assemblePlaylist`): selected `00002.mpls` (85 min, 13 marks, only `.mpls` flagged video; `00001.mpls`, a menu-loop shape, was discarded); `mkvmerge` produced a 59.3 GB MKV in 875 s, 5100.8 s long, HEVC 3840x2160, three audio and two PGS tracks with `eng`/`spa` tags. Fixtures: `services/worker/fixtures/bdmv/transformers-the-movie-1986/`.
- Not measured: the full pipeline (api states, library file, folder cleanup, stop/delete mid-assembly, retry) — see `pending-acs.md`.

## 2026-10-20 — `098-dub-card-tail-trim` rule correction (T011)

`worker` only, plus a REQ-7 amendment in the spec. A library pass over 808 episodes, 145 films and 10
shorts showed the original "80% of the whole run" rule rejected real dubbing tails that open with
several non-card segments (Dragons: Race to the Edge S01, 75%) and could not tell Haven S01E01 (no
cards, a false positive) apart. The rule now scores the trailing cards only: after setting aside a
non-multiple last segment, at least 5 consecutive multiples of 2.002 s counted from the end, at least
3 of them exactly 2.002 s; the cut stays the start of the whole run. Re-evaluated offline on 383 real
freeze logs: all 244 earlier cuts unchanged to the same second, Haven S01E01 now kept, six Race to the
Edge S01 episodes now cut, Arrival, Dawn of the Dragon Racers, Chernobyl and DreamWorks Dragons kept.
Margins are thin: the smallest real tail has exactly 5 trailing cards and the largest rejected one 4.

| Check | Result |
| :-- | :-- |
| `bin/npm worker test` | 33 files, 448 tests passed |
| `bin/cli worker npx tsc --noEmit` | 0 `error TS` |
| `bin/comments worker` | PASS (268 locators) |
| live manual pass | still not run |

## 2026-10-19 — `098-dub-card-tail-trim` (code complete; live pass pending)

`api` + `worker` + `web`, no migration. `api` makes `dub_trim_enabled` an editable boolean setting
(seeded `"false"`) and hands it to the worker as `EncodeJobDetails.dubTrimEnabled`, not combined with
`compressionEnabled`. `worker` gains `src/encode/dub-trim.ts` (freezedetect over the last 300 s of the
video stream, 2.002 s card-ratio rule, per-input-path verdict cache, silent on failure),
`src/ffmpeg/capture.ts` (the grain probe's spawn helper, moved) and a `trimAt` parameter folded into
`buildFfmpegCommand`'s single `-t`. `web` adds the Compression-tab switch.

| Check | Result |
| :-- | :-- |
| `bin/npm api run test` | 70 suites, 1146 tests passed |
| `bin/cli api npx tsc --noEmit` | 0 `error TS` |
| `bin/npm worker test` | 32 files, 405 tests passed |
| `bin/cli worker npx tsc --noEmit` | 0 `error TS` |
| `bin/cli web npx tsc --noEmit` | 7 `error TS`, all in `src/components/calendar/Calendar.tsx` (missing `@fullcalendar/react` submodules in the image); no file of this feature is involved |
| `check-messages.mjs` | OK, 636 keys |
| `bin/comments api` / `web` / `worker` | PASS (891 / 100 / 246 locators) |
| migrations | none; `git status --short services/api/prisma` shows only `seeds/settings.ts` |
| `schema.gql` diff | exactly `+  dubTrimEnabled: Boolean!` on `EncodeJobDetails` |
| live manual pass | not run: no stack was reachable for this session (host ports held by another install) and the AC-1 sources are the maintainer's own files |

The worker and web checks ran through `docker compose run --rm --no-deps` because their containers
were not up.

## 2026-10-17 — `097-encode-stop` (code complete; live pass pending)

`api` + `worker` + `web`, one migration (`20261017200942_encode_status_stopped`, widens
`process_jobs.status` with `STOPPED`, no backfill). `api` adds `EncodeStatus.STOPPED` (exposed as
`PAUSED`), `IN_FLIGHT_ENCODE_STATUSES` beside `ACTIVE_ENCODE_STATUSES`, `encodeJobStop`, the encode
branch of `downloadStop`/`downloadStart`, `resumeEncodeStage` over `ERROR` and `STOPPED` (a queue entry
`removeEncode` cannot remove is an enqueue failure), the `encodeStarted`/`encodeFailed` guards, and
`isRaceWinner` false for a stopped source (REQ-15). `worker` abandons silently on
`error.encode.stopped`. `web` shows Stop/Play on the encode and Pause/Play per file.

| Check | Result |
| :-- | :-- |
| `bin/npm api run test` | 70 suites, 1135 tests passed |
| `bin/cli api npx tsc --noEmit` | 0 `error TS` |
| `bin/npm worker test` | 31 files, 380 tests passed |
| `bin/cli worker npx tsc --noEmit` | 0 `error TS` |
| `bin/cli web npx tsc --noEmit` | 0 `error TS` |
| `bin/cli web node scripts/check-messages.mjs` | OK, 635 keys |
| `bin/comments api` / `web` / `worker` | PASS (887 / 100 / 221 locators) |
| `git status --short services/api/prisma` | `schema.prisma` + one new migration |
| `schema.gql` diff | only `encodeJobStop` added |

`web` has no test suite for this change (Article IX); `bin/npm web run lint` reports 1545 errors across
176 files, none in the touched files (baseline not compared). The manual pass in `plan.md` §
Verification (AC-1..AC-18 against a live encode) has not been run.

## 2026-10-17 — `095-season-pack-per-file-encode` (code complete; live pass pending)

`api` + `worker` + `web`, one migration (`20261017183533_encode_status_discarded`, widens
`process_jobs.status` with `DISCARDED`, no backfill). `api` stops a finished torrent, exposes
`Download.jobs`/`DownloadJob`, `encodeJobStart` and `encodeJobDiscard`, derives the per-file rules in
`pipeline-status.ts` (`cleanupDecision` shared with `encodeCompleted`) and guards the worker's reports;
`worker` abandons an `error.encode.discarded` refusal silently; `web` adds the chevron, child rows and
the discard dialog. The `schema.gql` diff is exactly `DownloadJob`, `Download.jobs`, `encodeJobStart` and
`encodeJobDiscard` (22 insertions, nothing else).

- `api`: `bin/npm api test` 70 suites / 1111 tests passed (was 1068; 25 new in
  `downloads.service.spec.ts`); `tsc --noEmit` 0 errors; `bin/comments api` PASS (854 locators);
  `prisma migrate status` up to date, 41 migrations.
- `worker`: `bin/npm worker test` 31 files / 379 tests passed; `tsc --noEmit` 0 errors; `bin/comments
  worker` PASS (218 locators).
- `web`: `tsc --noEmit` 0 errors; `check-messages.mjs` OK (631 keys); `bin/comments web` PASS (97
  locators). `bin/npm web run build` not run (dev stack up). `web` has no test runner.
- Fault injection: swapping the active and job-`ERROR` rules in `deriveSourceStatus` fails the
  "reads ENCODING while a job is active even if another job is ERROR" case.
- Not observed: AC-1 through AC-13 all need a signed-in session and a real season pack in the dev
  stack; none was run, so none is ticked. Recorded in `pending-acs.md`.
- Found while implementing: the plan assumed a `DISCARDED` parent already hid Play/Stop; it did not
  (`isControllable` never read `status`), fixed under REQ-9.

## 2026-10-17 — `096-date-format` (code complete; live pass pending)

`api` + `web`, one migration (`20261017074958_add_user_date_month_first`, nullable `users.dateMonthFirst`).
`api` exposes `User.dateMonthFirst`, `Query.defaultDateMonthFirst` (authenticated, `null` for unset) and
`Mutation.setDateMonthFirst`, plus the `date_month_first` catalog key and `""` seed row; the
`schema.gql` diff is exactly those three additions. `web` formats every date through
`formatDate`/`formatDateTime` (zero-padded, Settings stamps 24-hour) with the order resolved once in
`(dashboard)/layout.tsx`, and adds the Settings → General and `/preferences` pickers.

- `api`: `bin/npm api run test` 70 suites / 1068 tests passed (six new cases in
  `settings.resolver.spec.ts`); `tsc --noEmit` 0 errors; `bin/comments api` PASS (811 locators).
- `web`: `tsc --noEmit` 0 errors; `check-messages.mjs` OK (616 keys); `bin/comments web` PASS (91
  locators); `grep -rn "toLocaleDateString\|toLocaleString" services/web/src` prints nothing.
  `bin/npm web run build` not run (dev stack up). `web` has no test runner.
- Observed holding: AC-8 (unauthenticated `defaultDateMonthFirst` refused with
  `error.auth.unauthenticated`, re-run by curl) and AC-9 (read `getDefaultDateMonthFirst`: every error
  branch returns `null`).
- Not observed: AC-1…AC-7, AC-10…AC-12 need a signed-in session (no credentials in the agent run);
  recorded in `pending-acs.md`.

## 2026-10-17 — `093-movie-release-dates-display` (code complete; live pass pending)

`api` + `web`, no migration (`git status --short services/api/prisma` empty). `api` exposes
`Movie.theatricalReleaseDate`/`digitalReleaseDate`/`physicalReleaseDate`, the `MovieReleaseType` enum
and `CalendarEntry.releaseTypes`; the `schema.gql` diff is exactly those (26 insertions, nothing
else). `calendar(from, to)` now expands a film into one entry per distinct in-range typed day
(`calendar/movie-release-days.ts`), falling back to `releaseDate` with `[]` only when all three typed
dates are `NULL`; `findReleasedBetween` is an `OR` over the four columns. `web` renders the typed
dates under the year on the detail page and prefixes calendar entries with `(cine)`/`(digital)`/
`(físico)`.

- `api`: `bin/npm api test` 70 suites / 1062 tests passed; `tsc --noEmit` 0 errors; `bin/comments api`
  PASS (803 locators). New `movie-release-days.spec.ts` (8 cases) and six new cases in
  `calendar.service.spec.ts`.
- `web`: `tsc --noEmit` 0 errors; `check-messages.mjs` OK (614 keys); `bin/comments web` PASS (77
  locators); `next build` exit 0, run in a throwaway container with the dev stack stopped, then
  `.next` removed and the stack restarted.
- Not measured: no signed-in session was available, so the detail page and `/calendar` were not
  opened and `calendar` was not queried live; `worker` untouched and not re-run.

## 2026-10-17 — `094-automatic-grain-detection` (code complete; calibration pending)

`api` + `worker`. `api` exposes `EncodeJobDetails.isShort: Boolean!` (raw `Movie.isShort`, `false` for
an episode); the `schema.gql` diff is exactly that one line, `git status` on `services/api/prisma`
is clean. `worker` moves grain resolution from `buildFfmpegCommand` into the async encode driver and
replaces `092`'s stub with a metadata gate (`grain-gate.ts`) and an encode probe (`grain-probe.ts`),
cached per `mediaSourceId`.

`api` 69/69 suites, 1048/1048 tests (+3 `isShort` cases). `worker` 31 files, 378 tests, all passing.
`bin/cli api npx --no tsc --noEmit` and `bin/cli worker npx --no tsc --noEmit`: 0 errors.
`bin/comments api`: PASS, 797 locators; `bin/comments worker`: PASS, 215 locators. No JSON case under
`services/worker/ffmpeg/` was edited.

**Not verified.** `GRAIN_PROBE_SAVED_MBPS_THRESHOLD = 0.886` is the CRF 24 fit; T008 (re-measure the
corpus at CRF 22, two runs per file, cross-check Lionheart through the worker) is deferred to the
maintainer's own files, so REQ-7 stays provisional and the live acceptance criteria are unticked.
The Lionheart unit test reproduces the arithmetic from a synthetic split of the published sum, not
from real windows.

## 2026-10-15 — `089-status-materialization`, amendment 0.3.0 (a replacement in flight outranks possession)

`api` only; no GraphQL, schema or migration change (`git status` on `services/api/prisma` and the
schema file: clean). `deriveTitleStatus` now reads sources and jobs before possession, so a title
holding a file reads the work in flight on it (REQ-15); a possessed aired episode also counts its
season's real unscanned pack sources, at their own status. `hasPossession`/`POSSESSION_WHERE` became
the one spelling of "holds a file", and the five `087` `force` guards plus `054`'s orphan recovery
switched to it (REQ-16). Found on `shows.id = 6`, S02E09: `COMPLETED` while its replacement was queued.

`api` 69/69 suites, 1034/1034 tests — up from 1015 (+15 in `pipeline-status.spec.ts`, +4 across the
guard and recovery specs). `bin/cli api npx --no tsc --noEmit`: 0 errors. `bin/comments api`: PASS,
793 locators resolved.

Live pass: `episodes.id = 195` read `COMPLETED` before and `ENCODING` after `api` hot-reloaded
(job 11, `ENCODING` at 24%); `shows.id = 6` read `ENCODING`; every other episode stayed `COMPLETED`
and the five specials `MISSING` (AC-23). Not observed live: the return to `COMPLETED` when job 11
finishes (AC-20), a failed replacement (AC-21), a refused second attempt (AC-22) and a season-pack
replacement (AC-24) — all four are covered by unit tests only. `uploads.resolver.ts` has no spec
file; its guard is the same `hasPossession` call as `uploads.service.ts`'s, which is covered.

## 2026-10-15 — `089-status-materialization`, amendment 0.2.0 (specials leave the series aggregation)

`api` only; no GraphQL, schema or migration change. `TitleStatusService.recomputeShow` now reads only
seasons with `seasonNumber` not 0 (REQ-14). The same session also fixed `ProcessJobsService.encodeStarted`,
which wrote `ProcessJob.status = ENCODING` without notifying `TitleStatusService` — a title sat on its
pre-encode status for the whole encode (found on `movies.id = 9`); two tests added, no spec amendment.

`api` 69/69 suites, 1015/1015 tests — up from 1012 (+2 `encodeStarted`, +1 season-0 filter). `bin/cli
api npx tsc --noEmit`: 0 errors. `bin/comments api`: PASS, 751 locators resolved, 0 malformed.

Live pass: `shows.id = 6` ("Lost in Space", 28 regular episodes `COMPLETED`, 5 specials `MISSING`) read
`DOWNLOADED` before and `COMPLETED` after `api` hot-reloaded through its boot-time `recomputeAllStatuses`,
with the five specials still `MISSING` (AC-17, AC-19). AC-18's second half (a series with only aired
specials reads `MISSING`) is the existing no-aired-episode rule, covered by `pipeline-status.spec.ts`.

## 2026-10-15 — `092-film-grain-optimization`

`api`, `web` and `worker` all touched. GraphQL Contract Delta matches `spec.md` exactly: two new
enums (`GrainMode`, `EffectiveGrainMode`), `Movie.grainMode`/`Show.grainMode: GrainMode!`,
`EncodeJobDetails.grainMode: EffectiveGrainMode!`, and `setMovieGrainMode`/`setShowGrainMode` on
`Mutation` — nothing else changed. One migration, `20261015041754_add_grain_mode` — additive
(`Movie.grainMode`/`Show.grainMode GrainMode @default(INHERIT)`, no backfill); `prisma migrate
status` reports up to date. `git status --short services/api/prisma` shows the modified
`schema.prisma`, the modified `prisma/seeds/settings.ts` (seeds `grain_auto_enabled: 'false'`) and
the new migration directory.

`api` 69/69 suites, 1012/1012 tests — up from the pre-feature baseline of 68 suites / 1000 tests
(+12: 6 in the new `settings/grain-mode.spec.ts` fault-injection suite, 2 in
`movies.resolver.spec.ts`'s guard-order case, 4 in `process-jobs.service.spec.ts`'s film/episode
resolution cases). `bin/cli api npx tsc --noEmit`: 0 errors. `bin/comments api`: PASS, 748 locators
resolved, 0 malformed.

`worker` 29/29 suites, 337/337 tests — up from the pre-feature baseline of 28 suites / 323 tests
(+14: 11 in the new `encode/grain-mode.spec.ts`, net +3 in `ffmpeg/params.spec.ts` where the three
pre-existing `film-grain=0` assertions became six on/off cases across the three content kinds;
`buildCommand.spec.ts`/`cases.spec.ts` gained only a fixture field, no new cases).
`bin/cli worker npx tsc --noEmit`: 0 errors. `bin/comments worker`: PASS, 176 locators resolved, 0
malformed.

`web`: `bin/cli web npx tsc --noEmit` 0 errors; `bin/comments web`: PASS, 76 locators resolved, 0
malformed (after fixing two malformed-reference comments — prose mixed into a `// Spec NNN, <ref>`
locator line — found by the gate and corrected to match the precedent `ContentKindSelect.tsx`
already sets: plain explanatory prose with no locator at all, rather than a locator carrying
trailing prose); `bin/cli web node scripts/check-messages.mjs`: en/es catalogs match exactly (608
keys, +14: the `grainMode` namespace, `settings.compression.grainAutoLabel`, and `grainModeLabel`
under both `movies.detail` and `shows.detail`). `web` has no `test` script in this repo
(pre-existing, not a gap introduced by this feature) — `web/plan.md` recorded no tests owed here,
matching `070`'s precedent for the same kind of control.

Live manual pass, against the running dev stack: `setMovieGrainMode(movieId: 1, grainMode: ON)`
over raw GraphQL, confirmed via `bin/mysql` and a `/movies/1` re-fetch that the select persists the
value across a reload (AC-2's settings half); `setMovieGrainMode` for a nonexistent id returned
`error.movie.not_found` with no stored-value change (AC-7); `/shows/1` rendered the control exactly
once with no per-episode duplicate (AC-5's web half); the Settings switch rendered off on the
seeded `grain_auto_enabled: 'false'` row (AC-9), and rendered disabled with its hidden input still
emitting the stored value once `compression_enabled` was flipped off (AC-12's settings half). The
database was restored to its pre-test state afterward. AC-1/AC-2/AC-3/AC-4/AC-6/AC-8/AC-10's
encode-side claims and AC-12's worker-side claim (no FFmpeg invocation, no `[grain]` line with
compression off) rest on the unit-test coverage above and direct code reading of the
`compressing`-gated ternary in `encode.job.ts` rather than a live encode against a real video
file — the same standard `057`/`058`/`070` closed their argument-string-level criteria against,
and neither appears in `docs/spec/pending-acs.md` as a result. AC-11 is the gate commands
themselves, all green as reported above.

## 2026-10-09 — verification pass over `002`–`071` (no code change)

Third and widest pass of the same exercise, working downwards from `071`. `git diff --stat --
services/` is empty; only `docs/spec/features/*/spec.md` and this file changed. 193 criteria were
unticked across 28 specs in this range; eight are now ticked and the other 185 carry a written
blocker in place of a bare `[ ]`.

**Measured this pass** (branch `fix/tech-debt`, commit `b65ef65`, dev stack up):

```
bin/npm api run test            68 suites, 1000 tests, 0 failures, exit 0
bin/npm worker test             28 files,   323 tests, 0 failures, exit 0
bin/npm web test                MISSING SCRIPT — web has no test runner at all
bin/cli api    npx tsc --noEmit 0 errors
bin/cli web    npx tsc --noEmit 0 errors
bin/cli worker npx tsc --noEmit 0 errors
check-messages.mjs              en/es match exactly, 602 keys
git status --short services/api/prisma   empty
```

The pre-existing `src/ffmpeg/` failures that several specs' criteria explicitly allow for **no longer
exist**, so those bars are cleared outright rather than by exemption.

Ticked: **`038` AC-11**, **`039` AC-10**, **`070` AC-11** (each the suites + typechecks + `web`
build above — `038` goes from 0/11 verified to 1/11, its first). **`064` AC-13** (all four clauses:
suites including NFR-6's four counting cases, clean `prisma`, and the `schema.gql` delta confirmed
to be exactly `showId`/`showTitle`/`owned` on `Download` plus `downloads`/`activeDownloadCount` on
`Query`, neither carrying `@AllowService()`). **`039` AC-7** (both preference mutations called with
the installation's `SERVICE_TOKEN` answer `error.auth.unauthenticated`, refused in
`JwtAuthGuard.canActivate`; preference tables unchanged after). **`071` AC-7** (`mediaCapabilities`
takes no principal, so there is no non-admin variant to run; `catalogKeyConfigured` is a pure
emptiness test on the key). **`066` AC-3** and **`066` AC-5** — see below.

**`066` turned out to be the most verifiable spec in the band, and its boxes badly understated it.**
This checkout *is* an HTTPS installation, and TLS claims need `openssl`, not a browser. The CA
carries `X509v3 Name Constraints: critical, Permitted: DNS:perceptor.local`; the leaf carries
`SAN: perceptor.local, *.perceptor.local` — that is AC-5, ticked. `curl -sI -H 'Host:
perceptor.local' http://localhost/` returns `307` to `/login?redirect=%2F`, a relative path with no
`3xx` to `https://`, and `/login` answers `200` over plain HTTP — AC-3, ticked. Beyond the ticks:
`openssl s_client -servername perceptor.local -CAfile certs/ca.crt` returns **`Verify return code: 0
(ok)`**, as do `api.`, `torrent.` and `indexer.perceptor.local` off the wildcard SAN (AC-2's
cryptographic content), and the same handshake against the host's default trust store returns
`verify error:num=20` / code 21 while HTTP keeps answering `200` (AC-8's). `GET /ca.crt` with no
cookie returns `200`, `application/x-x509-ca-cert`, byte-identical to `certs/ca.crt`, and `web`'s
only certificate mount is `ca_public` read-only with no key file anywhere in the container (three of
AC-11's four clauses). What is left in each case is the browser's own chrome.

**The traefik `unhealthy` flagged in the previous pass is not a routing fault.** Routing works over
both schemes, as the measurements above show. The healthcheck is what fails — `Head
"http://:8080/ping": dial tcp :8080: connect: connection refused`, i.e. it probes a ping entrypoint
that is not enabled. Worth fixing, but it is not evidence against any criterion.

**The structural finding of this pass: the whole range reduces to four unlocks, not 185.** Measured
on this installation — 1 user, 3 films, 2 series, 64 episodes, **1** `media_sources` row (a pre-`053`
orphan), **0** `process_jobs`, **0** `ffprobe_logs`. No pipeline run has ever completed on this
branch, and there is exactly one account.

| Unlock | Criteria it opens |
| :-- | :-- |
| **an admin session in a browser** | `007` AC-11/12 · `036` AC-4e/6/18 · `039` AC-2/3/4/11/12/13 · `062` all 14 · `063` all 9 · `064` AC-1–6/9–12 · `068` all 7 · `070` AC-3/4/5 · `071` AC-2/6 — plus it is a precondition for nearly everything below |
| **a second user** | `023` AC-7 · `042` AC-7 · `062` AC-6 · `064` AC-7/8 · `067` AC-2/7/12/17 · `069` AC-11 — no public registration, so this is itself a session task |
| **one completed pipeline run** | `002` AC-9 · `012` AC-1/2/8/9/10/11/12 · `013` all 6 · `023` AC-1/4/5 · `032` AC-6/8 · `052` all 6 · `054` AC-4/5 · `058` AC-2–10/12/13 · `060` all 7 · `065` all 13 · `067` AC-9/10/11 — the single highest-leverage item in the backlog |
| **a fresh `install.sh` / `bin/prod` run** | `015` AC-7/8 · `049` AC-5/9/12 · `061` AC-1–4/8 · `066` AC-1/10 |

A fifth group is small and genuinely cheap: **one signed-in user's bearer token**, no UI and no
pipeline, closes `037` AC-3, `039` AC-5/6, `062` AC-9 and `065` AC-11 — five criteria, five curls.
Each was attempted this pass with the `SERVICE_TOKEN` and refused at the guard, which is itself the
correct behaviour and is recorded as such in each spec.

Corrections made to stale notes, since a wrong recorded reason is worse than none:

- **`012` AC-11** said it was not re-verified because the stack had `media_server_client = jellyfin`.
  It reads **`none`** today, so the precondition is already met; the real blocker is the absent
  encode. The `none` branch itself is structurally sound — `createMediaServerClient` yields nothing
  and `notifyCreated` returns before any request.
- **`061`** — this checkout still carries `ADMIN_PASSWORD`, `QBITTORRENT_PASSWORD` and
  `INDEXER_PASSWORD` in `.env`, so it is a **pre-`061` installation**: AC-8's subject, not AC-1's.
  Nine of its ten criteria need either a fresh installer run or writing a real credential across
  three services, which no verification pass should do unasked.
- **`065` AC-11** — the refusal is not the `@AllowService()` decorator (which *permits* a service
  principal rather than excluding a user) but an explicit `principal.type !== 'service'` throw in the
  resolver body, before the service is reached, so "leaves the source untouched" cannot fail
  independently of the error key.
- **`036` AC-4e/AC-6** — their "`web` has no test runner" reasoning is now measured rather than
  assumed: `npm test` in `web` exits with `Missing script: "test"`.
- **`052`** ships but still reads `status: Approved` — the third instance this week of the
  status-setting `[docs]` task never having run (`077` and `080` were the first two).

Also recorded: Prowlarr holds two enabled indexers (Knaben, The Pirate Bay) and **neither carries a
tag**, so no indexer sits behind FlareSolverr — which is `014`'s deliberate manual step and the
standing blocker on `078` AC-9.

## 2026-10-09 — verification pass over `072`–`081` (no code change)

Second pass of the same exercise, working downwards from `081`. `git diff --stat services/` is empty;
only `docs/spec/features/*/spec.md` changed. 102 criteria were unticked across the ten specs; four are
now ticked and the rest are written up with the specific thing each one is waiting on.

Ticked: **`073` AC-10** (`rankTorrentResults` grep empty, `src/lib/torrent-ranking.ts` absent),
**`077` AC-11** (commit `c219812` touches no file under `services/api/` or `services/worker/`),
**`077` AC-12** (the production build exits 0 — run in a throwaway `perceptor-web:local-dev`
container as uid 1000 with the dev `.next` parked and restored, since `bin/npm` shells into the
running container and a build against a live dev stack is forbidden), **`080` AC-10** (commit
`ae6c23b` is five files, none of them `api`/`worker`).

Partial records, box left unticked: `073` AC-9's grep half (`resolutionTier` appears only as a type
field and a selection-set line — no comparator in `web`), `077` AC-10's parity half (602 keys, no
drift).

Three findings worth carrying forward:

1. **`081` is not verification debt at all.** It is `status: Draft`, holds `spec.md` alone with no
   `plan.md`/`tasks.md`, and `migrateLibraryLayout` exists in no service. Its gate is NFR-1: Article
   XII must be amended to 1.3.0 before `/plan-feature` may run, which is a human decision not yet
   taken. Its 17 boxes should be excluded from any repository-wide count of unverified criteria, or a
   deliberate "not built" reads as "built but unverified" — the two need opposite responses.
2. **`080`'s criteria are much cheaper than they read.** The service worker registers behind
   `window.isSecureContext`, not `USE_HTTPS`, and `ServiceWorkerRegistration` sits in the root
   `layout.tsx`, so AC-1/AC-2/AC-4/AC-5/AC-6 need neither HTTPS, nor a trusted `certs/ca.crt`, nor a
   session — `http://localhost:3000` on the login page suffices. They were still not run: registration
   failed in the available browser, and a control origin (a one-line static worker served by
   `python -m http.server`) failed identically, so the browser blocks service workers outright. Not a
   Perceptor fault, and AC-3 is *unrunnable* there rather than merely unrun, since a missing worker at
   a non-secure origin cannot be told apart from the gate working.
3. **`080`'s implementation largely landed inside `079`'s commit.** `sw.js`, `offline/page.tsx` and
   `ServiceWorkerRegistration.tsx` were added by `94aee98` ("implement 079 spec, mobile") and
   `manifest.json` by `689c65e` ("favicon"); `080`'s own commit only adjusted `sw.js` and
   `globals.css`. That is why `spec.md` still reads `status: Approved` — the `/implement` run was
   folded into its predecessor's, so the status-setting `[docs]` task never ran.

What the remainder is waiting on, grouped by the actual blocker rather than by spec:

| Blocker | Specs and criteria |
| :-- | :-- |
| **an authenticated admin session** — `runScheduledTask` carries `AdminGuard` and **no** `@AllowService()`, so the service credential cannot trigger a sweep, and every UI criterion needs a login | `073` AC-2–AC-9, `074` AC-1–AC-11, `075` AC-1–AC-10, `076` AC-1–AC-17, `077` AC-1–AC-10, `078` AC-1–AC-8 |
| a browser that permits service workers | `080` AC-1–AC-7, AC-9 |
| a physical iOS device | `079` AC-6, `080` AC-8 |
| a reachable Plex server (none exists here: `media_server_client` is `none`, `media_server_host` empty; the owner asked that nothing be exercised against Plex) | `072` AC-1–AC-13 |
| a Cloudflare-fronted indexer tagged `flaresolverr` | `078` AC-9 |
| real torrents and real encode time — folded into `091`'s pending live pass | `073` AC-4, `076` AC-4/AC-5b/AC-6/AC-8/AC-12 |
| an Article XII amendment, then `/plan-feature` | `081`, all 17 |

The encouraging half: the TMDB key is configured (`movie_db_api_key` is set), so **`074` and `075`
are reachable in full with nothing but a session** — every one of their criteria is a hand-set
database column, an "Ejecutar ahora", and a read back. No downloads, no encodes, no external service.
That is twenty criteria of desk work and it is the next thing to do.

## 2026-10-09 — verification pass over `082`–`087` (no code change)

Not an `/implement` run: a pass over the ACs left unticked by `082`, `083`, `084`, `085` and `087`,
working downwards from `087` as the backlog order calls for. `git diff --stat services/` is empty and
no migration, contract or catalog was touched — only `docs/spec/features/*/spec.md`. `086` needed
nothing, all 17 of its ACs were already ticked.

Four criteria closed, each against the live host rather than by inference:

- **`082` AC-9** — `bin/stop -y` then `bin/dev -d`, with the user's consent, since the note that had
  kept it unrun was that it would stop the tester's live install. State captured before and diffed
  after is identical on all three axes: the same ten containers, the same seven volumes (with
  `perceptor_mariadb_data` keeping its original 2026-09-10 `CreatedAt`, so it was never recreated),
  the same single `perceptor_perceptor-net`. `movies`/`media_sources`/`users`/`settings` row counts
  unchanged at 3/1/1/50, `.env` md5 unchanged, and `bin/stop` reported no Perceptor container left
  running outside the project.
- **`083` AC-1** — `docker manifest inspect` on the published `:latest` for all five images: each is
  an OCI image index carrying `linux/amd64` and `linux/arm64`, plus two `unknown/unknown`
  attestation manifests that are not platforms.
- **`083` AC-4** — the development host's own end-user install (project `ptor`, `PERCEPTOR_TAG=v0.4.0-rc4`,
  published images, no `build:` section, no `--platform` anywhere) came up with `api` healthy,
  `uname -m` reading `x86_64` in `api`/`worker`/`web`, and `.env` unchanged by md5. Its `api` digest
  (`sha256:ea808ad5…`) is the one `:latest` resolves to here, so NFR-2's "the same tag" is the same
  image.
- **`084` AC-12** — the published pages serve Spanish `og:title`/`og:description` with `og:locale`
  `es_AR` at `/es/` and the English pair with `en_US` at the root. This one had already been verified
  and recorded on `dev` (`082d516`, 2026-10-03); `fix/tech-debt` forked before it, so the gap was
  branch divergence, not an unrun check.

Eight remain open, and the reason is hardware or an unmerged default branch, not diligence —
recorded in each `spec.md` so an agent reading one does not mistake an unrunnable box for an
unexamined one. `083` AC-2/AC-3/AC-3b need an Apple Silicon Mac and say *native, not emulated*, so
registering QEMU here would not satisfy them (this host has no arm64 handler under
`/proc/sys/fs/binfmt_misc/` either); `083` AC-5 needs a deliberately red release run; `083` AC-6c
needs the directory of a failed pre-083 arm64 install, which cannot be faithfully fabricated on x86.
**`083` REQ-6 carries the only real residual risk in this set**: nothing verified so far
distinguishes an arm64 image that starts from one that encodes. `085` AC-1/AC-2/AC-3 are
*unobservable*, not unverified — `.github/dependabot.yml` lives on `fix/tech-debt` alone (`master`,
`stage` and `dev` all lack it) and Dependabot reads only the default branch. `087` AC-3 was folded
into `091`'s pending live pass, whose § Verification step 7 is the same force-replacement with the
same download and the same encode.

`091` itself: its automated half was re-run from scratch rather than trusted — `api` 1000/1000,
`worker` 323/323, `tsc --noEmit` clean on all three, `bin/comments` clean on all three,
`check-messages.mjs` at 602 keys with no drift, empty Prisma diff, `sweepLosingSiblings` gone
tree-wide, `lostRace: Boolean!` present in `schema.gql`. T010's eight live-race criteria are still
open and still correctly in **Blocked**.

## 2026-10-09 — `090-replaced-source-not-an-error`

`api` and `web` touched; `worker` untouched. GraphQL Contract Delta matches `spec.md` exactly: one
hunk on `services/api/src/schema.gql`, `Download` gains `retiredAt: DateTime` (nullable), nothing
else. One migration, `20261009061717_add_media_source_retired_at` — additive (`MediaSource.retiredAt
DateTime?`, no default) plus the NFR-1 backfill UPDATE for pre-existing `error.source.replaced` rows
that pass the delivered test; `prisma migrate status` reports up to date. `git status --short
services/api/prisma` shows the modified `schema.prisma` and the new migration directory.

`api` 68/68 suites, 993/993 tests — up from the pre-feature baseline of 68 suites / 985 tests
(+8 tests across `pipeline-status.spec.ts`, `downloads.service.spec.ts`,
`attach-source.service.spec.ts`, `uploads.service.spec.ts`). `bin/cli api npx tsc --noEmit`: 0
errors. `bin/comments api`: PASS, 735 locators resolved, 0 malformed.

`web`: `bin/cli web npx tsc --noEmit` 0 errors; `bin/comments web`: PASS, 76 locators resolved, 0
malformed; `bin/cli web node scripts/check-messages.mjs`: en/es catalogs match exactly (601 keys,
+1 each for `downloads.panel.replaced`). `web` has no `test` script in this repo (pre-existing,
not a gap introduced by this feature) — `web/plan.md` recorded no tests owed here since every
failure mode (a withheld control, a stray error-colored badge) is loud or visible, not silent.

Live manual pass: the five backend predicates (`isRaceWinner`/`isDeliveredSource` retirement
awareness, `resolveRace`'s `alreadyWon` threading, `downloadStart`'s 409 refusal, the reactivation
clear) were each verified with a fault-injection case — reverting the fix and watching the specific
test fail — rather than mock-only coverage. The `retiredAt` field was confirmed live against the
running dev stack's GraphQL endpoint (`{ downloads { retiredAt } }` resolves `null` cleanly with
no server error) and `/downloads` renders with no GraphQL error in the server log. The
`DownloadRow.tsx` badge/control logic (neutral `Badge variant="light" color="light"`, never
`"error"`/`"warning"`; `canStart`/`isControllable` both forced `false` when `retiredAt != null`;
delete gated on `owned` alone) was verified by direct code reading against the exact AC-1/AC-2/AC-4
wording, not by exercising a live retired row end-to-end through a real torrent — the dev database
held no row that had actually been through the replace flow, and fabricating one by hand in the
shared dev stack's database was avoided as a risk to the running install rather than attempted.

One spec defect caught and fixed during closeout, not during `/plan-feature`: `spec.md`'s AC-4 still
named `BadRequestException` after the earlier defect-fix pass had corrected the contract's error
table to `ConflictException` (409) — the two had drifted. Fixed in `spec.md` before closing.

## 2026-10-06 — `089-status-materialization`

`api` only touched; `web` and `worker` untouched (`git diff --stat -- services/web services/worker`
empty) and no SDL change (`git diff --stat services/api/src/schema.gql` empty) — the GraphQL
Contract Delta is "None" as frozen in `spec.md`: `Movie.status`/`Episode.status`/`Show.status` keep
their exact `String!` shape and eight-value vocabulary, only where the value comes from changed.

Two new migrations: `20261006223933_widen_media_status` (additive — `QUEUED`/`PAUSED`/`DOWNLOADED`
join the `MediaStatus` enum) and `20261006223959_add_media_server_presence` (`Movie`/`Episode` gain
a nullable `mediaServerPresentAt DateTime?`, backfilled from existing `COMPLETED`+no-`filePath` rows
in the same migration — not exposed on any GraphQL type).

`api` 68/68 suites, 980/980 tests — up from the pre-feature baseline of 65 suites / 954 tests
(+3 suites, +26 tests: `src/title-status/title-status.service.spec.ts`,
`src/title-status/show-status-sweep.service.spec.ts`, `src/clients/torrent/client.spec.ts`).
`bin/cli api npx tsc --noEmit` clean. `bin/comments api`: `comments gate: PASS (716 locators
resolved)`.

A new `src/title-status/` module is the single writer of `Movie.status`/`Episode.status`/
`Show.status` (`TitleStatusService.recomputeMovie/recomputeEpisode/recomputeSeason/recomputeShow`,
each notified by id only); `src/pipeline-status/pipeline-status.ts` dropped the stored-status input
it used to take (the ratchet bug — a title could only rise, never fall, because it fed its own
column back into its derivation) in favour of an explicit possession check (`filePath`/
`mediaServerPresentAt`) ahead of the ladder, and gained `deriveShowStatus`; `toMediaStatus` is
deleted. Every former literal status write across `movies/`, `episodes/`, `media-sources/`,
`uploads/`, `downloads/`, `process-jobs/` and `seasons/` now notifies `TitleStatusService` instead.
`clients/torrent/client.ts`'s `queuedDL` now maps to `QUEUED` rather than the coarse `DOWNLOADING`
bucket, and `downloads.service.ts`'s live-read helpers write back every row a torrent-client call
already returned, not only the row a caller explicitly asked about — no new torrent-client call.
`ShowStatusSweepService` (an always-on `@Cron(EVERY_HOUR)` provider, independent of the opt-in
`schedule_<id>_enabled` Settings rows) and `src/scripts/recompute-statuses.ts` (wired into the
existing `PERCEPTOR_AUTO_MIGRATE` boot seam, so it runs unconditionally on every boot) are what
un-stick a title an existing install left stuck at `DOWNLOADING` or `Show.status` left at `MISSING`
forever. The two daily acquisition sweeps (`acquire_movies`/`acquire_episodes`) are a deliberate,
documented exception: they still derive fresh from live rows rather than trust the column.

Verified live on the dev DB during the implementation's final pass: `select status, count(*) from
media_sources group by status` showed a non-zero `DOWNLOADING` count (AC-3, impossible before this
feature in any state of the system) while a torrent was transferring.

## 2026-10-06 — `088-acquisition-path-unification`

`api` only touched; `web` and `worker` untouched (`git diff --stat -- services/web` and
`services/worker` both empty; `git grep -n "attachTorrentSource\|AttachSourceService"
services/worker/src` returns nothing). No migration (`git status --short services/api/prisma`
empty) and no SDL change (`git diff --stat services/api/src/schema.gql` empty) — every refusal this
feature adds or corrects (a season-collision refusal on the movie/episode mutations; an
episode-collision message now naming the holder) reaches `web` only through the existing error
envelope and two error keys (`error.magnet.already_attached`,
`error.magnet.already_attached_season`) that already existed in both `api` and both
`services/web/messages/*.json` catalogs.

`api` 65/65 suites, 954/954 tests — up from the pre-feature baseline of 939 tests across 62 suites
(+15 tests, +3 suites: `src/acquisition/attach-source.service.spec.ts`,
`src/episodes/episode-title.spec.ts`, `src/media/catalog-search.service.spec.ts`). `bin/cli api npx
tsc --noEmit` clean. `bin/comments api` PASS at 649 locators resolved (up from 619 before this
feature), zero Spanish, zero malformed, zero dangling.

Three god-object duplications this feature closed, all verified by grep rather than asserted:
`grep -rn "function sanitizeTag" services/api/src` → 1 hit (was 4); `grep -rn "findActiveSource"
services/api/src` → 0 hits (was 1, dead); `grep -rn "episodeDisplayTitle" services/api/src
--include=*.ts` → 1 definition (was 3); `movies.service.ts` 729 lines (was 812); `shows.service.ts`
637 lines (was 641) — both shrank, per NFR-7. The two-target invariant query
(`select count(*) from media_sources where (movieId is not null) + (seasonId is not null) +
(episodeId is not null) <> 1`) read 0 both before (T001) and after (T021) this feature — the
historical REQ-2 gap left no corrupted rows to find, so there was nothing to repair, only to stop
recurring.

Full repo `git diff --shortstat`: 17 files changed, 551 insertions(+), 621 deletions(-) — net
removal (NFR-7/AC-11), plus five new files under `src/acquisition/` and `src/media/catalog-*`
that a tracked-file diff doesn't count.

**No live manual pass performed as part of this measurement** — `087`'s own live-stack
regression coverage (REQ-3/REQ-4's replacement-arbitration guarantees, re-exercised end to end)
was the only acceptance criterion this feature could not satisfy with a unit test; see `spec.md`'s
AC-7 and `tasks.md`'s T026 for that pass.

## 2026-10-06 — `087-force-replacement-arbitration`

`api` and `web` touched; `worker` untouched (`git diff --stat -- services/worker` empty, and
`git grep -n "superseded\|already_completed" services/worker/src` returns nothing — AC-11).
No migration (`git status --short services/api/prisma` empty, NFR-1) and no SDL change
(`git diff -- services/api/src/schema.gql` empty, NFR-2) — `error.source.superseded` is a backend
constant reaching `web` only through `Download.lastError`, never new GraphQL surface.

`api` 62/62 suites, 939/939 tests, measured against the real `bin/dev` stack (a real Redis, not a
throwaway container) — up from the pre-feature baseline of 903 tests across the same 62 suites
(+36 tests, 0 new suites: every new case lives inside an existing spec file next to the behaviour
it covers). `bin/cli api npx tsc --noEmit` clean. `bin/comments api` PASS at 619 locators resolved
(up from 586 before this feature), zero Spanish, zero malformed, zero dangling — every new comment
carries `// Spec 087, REQ-n`. `bin/comments web` PASS at 76 locators resolved, unchanged count
(this feature added no new comment to `web`, only two catalog strings).

`bin/npm web run build` exits 0 (run once, before the dev stack's own `web` container was brought
back up, per the standing rule against building while dev serves). `bin/npm web run lint`
(`biome check`, whole repo) does **not** exit 0 — ~1548 pre-existing findings, documented in
`services/web/CLAUDE.md`'s own "Current state" as not a usable gate (baseline ~1519 before this
feature); scoped to the two files `087` actually touched (`messages/{en,es}.json`), lint is clean.

**Live manual pass, against a real `bin/dev` stack with a real qBittorrent, using five synthetic
movies and one synthetic episode (DB rows with no real downloaded files, created and removed
through the app's own `addMedia`/`removeMovie`/`removeShow` mutations) plus direct `bin/mysql`
writes to fast-forward pipeline state:** AC-1, AC-2, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9 all
confirmed live, including the `resolveRace: … won`/`… superseded` log lines, the `error.source.
superseded` row with `stage: SCAN`/`retryable: false`, the `es` catalog string, and a real
`qbittorrent.add()` rejection (achieved by stopping the `torrent` container) leaving a delivered
source untouched. **AC-3 not reached live** — it needs a real torrent download and a real FFmpeg
encode of actual video content, which the synthetic DB-row fixtures used for speed and
reversibility cannot exercise; the encode-completion code path itself is unchanged by this feature
(confirmed by the empty `worker` diff), so the risk is judged low but is recorded, not silently
closed. AC-10, AC-11, AC-12 confirmed by command output, detailed in `spec.md`'s own AC list.

## 2026-10-05 — `054-interrupted-encode-recovery` NFR-4 follow-up (worker singleton lease)

Not an `/implement` run — a bug fix closing the one requirement `054` recorded and deliberately left
to the deployment. `worker` only, plus one compose declaration: `src/lease/worker-lease.ts` takes a
Redis lease before `encodeWorkerStarted` is called, so a second worker exits 1 instead of
reconciling the first one's live encode, and `docker-compose.yaml` declares `deploy: replicas: 1`
for the worker.

`worker` 323 tests / 28 suites, up from the 317/27 of `086` below — the +6/+1 is exactly
`src/lease/worker-lease.spec.ts` and nothing else moved. `npx tsc --noEmit` clean in `worker`.
`node tools/comments/check.mjs worker` PASS at 165 locators resolved (up from 161), zero Spanish,
zero malformed, zero dangling; every new comment carries `Spec 054, NFR-4`, which is well-formed and
resolves, since NFR-4 exists in that spec. `docker compose -f docker-compose.yaml config` exits 0.
No migration (`git status --short services/api/prisma` empty) and no contract change
(`git diff services/api/src/schema.gql` empty) — `api` and `web` have no changed file at all, so
their counts are unmeasured and unchanged from `086`.

**Not yet proven live.** The unit suite covers the lease's own asymmetries (expired-lease retake,
holder-guarded renew and release) against a fake Redis with a virtual clock, but nobody has run
`--scale worker=2` against a live encode to watch the second container refuse. That is the test this
work exists for, and it is still owed.

## 2026-10-05 — `086-comment-locator-convention`

All three services untouched structurally — `git status --short services/api/prisma` empty (no
migration, NFR-3) and `git diff services/api/src/schema.gql` empty (no contract change). `bin/comments`
exits 0 across the whole tree: 801 locators resolved, zero Spanish, zero malformed, zero dangling.
`api` 903/62 suites, `worker` 317/27 suites (the +3 tests/+1 suite over the pre-feature baseline —
measured at a throwaway checkout of the commit just before this feature started — is exactly
`src/ffmpeg/runner.spec.ts`, the one REQ-4 test this feature owed and T013 wrote; nothing else moved),
`web` typechecks at 0 errors and `check-messages` confirms no `en`/`es` drift at 600 keys — all
measured live via a disposable PR (dientuki/perceptor#13) that also proved the new `comments` CI job:
appending the AC-2 Spanish comment failed only that job (`services/api/src/app.module.ts:70`), the
other five passed, and `release.yml`'s `build` (needs `verify`, which is `ci.yml`) never ran since it
gates on a tag push, not a PR. All 17 acceptance criteria carry a tick with real command output as
evidence (the AC-7 tree-wide grep surfaces three lines inside Article IX test-header prose with no
`Spec NNN,` on that exact line — REQ-1b's inline exception, not a violation; `bin/comments` itself,
which groups multi-line comments before checking, passes them clean). `## Current state` moved to
this file (you are reading the result); the root `CLAUDE.md` lost "the eleven rules" (the constitution
holds twelve articles and growing) and gained a `bin/comments` row plus a Comments convention entry.
REQ-12's 35 Spanish `it`/`describe` strings and REQ-13's three stale `CLAUDE.md` passages pointing at
collapsed comments are both done. Not run: nothing — every AC rests on command output pasted during
this implementation, not a deferred live pass.

## 2026-10-03 — `085-dependency-update-cadence`

`.github/dependabot.yml` now watches five ecosystems (`npm` at each of `services/api`, `services/web`, `services/worker`; `github-actions` at `/`; `docker` across all five service Dockerfiles plus `docker-compose.yaml`), every one opening PRs against `dev` and the `docker` one excluding the project's own `ghcr.io/dientuki/perceptor-*` images. `ci.yml` gained an `audit` job (`tools/audit/check.mjs`, invoked locally via the new `bin/audit`) that reconciles each service's production `npm audit` against `tools/audit/allowlist.json` and fails the build on any unallowlisted `high`/`critical` finding, a stale allowlist entry, or an entry with no reachability argument — sitting inside `release.yml`'s existing `verify` → `build` chain, so a tag cannot publish past it (confirmed live: a scratch tag pinning `next` back to a vulnerable version failed `verify` and left `build`/`merge` skipped, publishing no image). Measured outcome: `api`'s production advisory count dropped from 15 to 6, all six now accepted and documented in `tools/audit/allowlist.json` (the remaining Prisma-family transitives have no fixed release upstream; reachability rests on the `perceptor-net` bridge carrying no external traffic); `web` dropped from 4 to 0 via `next` 16.2.12 → 16.3.8; `worker` stays at 0, untouched. No pipeline stage changed status — this feature is process, not product. **Re-run the checks rather than trusting these numbers** — they exist so an agent can prove a change added nothing, not as a fact to cite.

## 2026-10-03 — `084-landing-page-i18n`

the public landing page (`site/index.html`) is now generated from `tools/site/template.html` plus one flat string catalog per locale (`tools/site/en.json`/`es.json`) via the new `bin/site`, with `site/es/index.html` published alongside it — no pipeline stage changed status, `git diff --stat services/` is empty, no migration, `schema.gql` untouched. A `site` job in `.github/workflows/ci.yml` regenerates and diffs `site/` on every push/PR so the committed output can't go stale unnoticed; `.github/workflows/pages.yml` is unchanged — it still just uploads `site/` as-is.

## 2026-10-02 — `083-multi-arch-images`

`git diff --stat services/` is empty, no migration, no `schema.gql` delta — the same posture as `082`, since this feature crosses no service boundary either. `.github/workflows/release.yml`'s single `build-and-push` job is now `build` (a `service × platform` matrix, ten legs, each pushing by digest only, native on `ubuntu-24.04-arm` for `linux/arm64` and `ubuntu-latest` for `linux/amd64`) and `merge` (a matrix over the five services, `needs: build`, assembling each one's two digests into one manifest list with `docker buildx imagetools create` and applying both tags) — confirmed by parsing the file (`jobs` keys are exactly `verify`/`build`/`merge`, the `build` matrix expands to ten legs, no `tags:` key inside `build`, `merge` declares `needs: build`, and the digest artifact name carries both `matrix.service` and the platform). `install.sh`'s preflight block gained a fourth check reusing the same `docker info` call `082` already made (`--format '{{.Architecture}}'`), confirmed with `DOCKER_HOST=unix:///nonexistent.sock bash install.sh` still printing `082`'s exact engine message and not an architecture one, and a scratch copy with the captured value hand-substituted to an unsupported one printing the detected value and the supported list — both exiting `1` and leaving the directory empty. **AC-1 to AC-5 need a real release-candidate tag pushed to GitHub and AC-2, AC-3, AC-3b and AC-6c need an Apple Silicon machine — none of that has been run from this development host, which has no `binfmt`/QEMU registered and cannot emulate arm64 even for a smoke test.** Push a release tag and run the manual pass in `plan.md` § Verification before telling anyone the Mac install works.

## 2026-10-02 — `082-docker-engine-preflight`

there is nothing to measure on the service side — `git diff --stat services/` is empty, no migration, no `schema.gql` delta, so the api/worker/web numbers above still stand untouched. What this feature is verified by instead is its own acceptance criteria, all runnable: `for f in bin/*; do [ -f "$f" ] && bash -n "$f"; done` and `bash -n install.sh` parse clean; `DOCKER_HOST=unix:///nonexistent.sock` against `install.sh` (in an empty directory, which stays empty), `bin/install`, `bin/dev`, `bin/prod`, `bin/build`, `bin/cli`, `bin/log` and `bin/stop` prints the engine message and exits non-zero; `bin/log db` and `bin/cli db sh -c 'echo inside-container-ok'` are unaffected with the engine up; `. bin/_docker.sh && compose_project_name` prints `perceptor`, which is the REQ-8 regression — it used to print `perceptor-`, so `install.sh`'s guard against installing fresh over an existing `perceptor_mariadb_data` volume had never once fired. `bin/stop` was verified against a dry-run copy with its two mutating lines echoed (the development host had a second live install under project `ptor`); AC-9, `bin/stop` followed by `bin/dev`, has not been run.

## 2026-09-28 — `080-installable-pwa`

`bin/cli web npx --no tsc --noEmit` reports 0 errors, `bin/cli web node scripts/check-messages.mjs` confirms no `en`/`es` drift at 600 keys, and `git diff --stat services/api services/worker` is empty (no pipeline stage changed, no contract delta — REQ-3's "cache nothing but `/offline`" and NFR-1's "no new dependency" both hold as written).

## 2026-09-28 — `079-mobile-legibility-pass`

`web` typechecks at 0 errors, `bin/npm web run build` exits 0, `check-messages` confirms no drift at 594 keys (this feature added no string — the 594 reflects `078`, landed just before it), and `grep -rEn "text-xs|text-theme-xs" services/web/src` returns nothing tree-wide. No pipeline stage changed status; `git diff --stat services/api services/worker` empty, no migration, `schema.gql` untouched. The live pass ran at 375px and 1280px, both themes, every route this table lists plus `/calendar`, `/downloads`, `/preferences`, `/settings` and its six tabs, `/users` and its modals, `/login`, and the season-accordion/torrent-search/import modals — no page-level horizontal scroll, no rendered text below 14px, and (after six follow-up touch-target fixes the task breakdown had missed — the shared modal close button, `MediaCarousel`'s arrows, the calendar's own toolbar buttons, a sixth form primitive `Checkbox.tsx`, and one icon-link from `078`) no interactive control under 44×44 below 768px except a documented, out-of-scope exception (an individual calendar event pill inside a 7-column day-grid at 375px, which would need a calendar redesign to enlarge). `AC-6` (iOS Safari zoom) is discharged structurally — no `<input>`/`<textarea>`/`<select>` renders below 16px anywhere — and recorded as unverified on a physical device, not as passed.

## 2026-09-27 — `the CI pass (no spec, Article VII`

`api` 887/62 suites, `worker` 314/26 suites, all green; `worker`'s three long-standing `src/ffmpeg/` failures are gone — the ANIME CRF test now expects 22 (`057` keeps CRF independent of `contentKind`), and `ffmpeg/1.json`/`2.json` were regenerated to the `058` rules (colour tags on every AV1 output, `force_divisible_by=2`, plain `AV1` title). `auth-error-keys.spec.ts` no longer depends on the container's `JWT_SECRET`. `.github/workflows/ci.yml` runs typecheck plus tests for `api`/`worker` and typecheck plus `check-messages` for `web` on push to `master` and on pull requests; `release.yml` now needs it, so a tag cannot publish images that failed it. Not in CI: `web`'s `next build` (the release's Docker build covers it) and `biome check`, which fails on formatting in existing `web` files.

## 2026-09-27 — `077-title-detail-three-column-layout`

`web` only — `web` typechecks at 0 errors, `bin/npm web run build` exits 0, `check-messages` confirms no drift at 568 keys; no pipeline stage changed status; `git diff --stat services/api services/worker` empty, no migration, `schema.gql` untouched.

## 2026-09-26 — `076-automatic-movie-acquisition`

`api` 883/62 suites, 0 typecheck errors, one migration (`add_user_acquisition_windows`), `schema.gql` gains exactly `acquireTheatrical`/`acquireDigital`/`acquirePhysical` on `UserPreferences` and `setAcquisitionWindows`. `web` typechecks at 0 errors, `bin/npm web run build` exits 0, `check-messages` confirms no drift at 560 keys. `worker` untouched (`git diff --stat services/worker` empty).

## 2026-09-26 — `075-movie-refresh-sweep`

`api` 844/60 suites, 0 typecheck errors, `prisma migrate status` up to date with one new migration (`add_movie_release_windows`, five nullable `Movie` columns), `schema.gql` untouched (no GraphQL delta), `git diff --stat services/web services/worker` empty. The live pass (a real TMDB key, one film) confirmed AC-2, AC-3, AC-4, AC-11 and AC-12; AC-1, AC-5 to AC-10 have not been run live.

## 2026-09-26 — `074-show-refresh-sweep`

`api` 817/58 suites, 0 typecheck errors, one migration (`Show.tmdbStatus String?` — `git status --short services/api/prisma` shows a modified `schema.prisma` and one new migration directory), `schema.gql` diff empty (no contract change). `web`/`worker` untouched. The live pass (AC-1 to AC-11) has not been run: the dev stack has no series and `shows_enabled` is off.

## 2026-09-26 — `073-automatic-episode-acquisition`

`api` 806/57 suites, 0 typecheck errors, no migration, `schema.gql` carries exactly `ReleaseRanking`, `ranking`/`candidate`/`candidateRank` on `TorrentResult` and `movieId`/`seasonId`/`episodeId` on `searchTorrents`. `web` typechecks at 0 errors, `bin/npm web run build` exits 0, `check-messages` confirms no drift at 557 keys (`worker` untouched). Only AC-1 was confirmed live.

## 2026-09-26 — `072-plex-media-server`

`api` 756 tests pass across 57 suites, 4 further suites fail to parse (`acquire-episodes.task.spec.ts`, `ranking-context.service.spec.ts`, `scheduler.service.spec.ts`, `settings.resolver.spec.ts`, a Jest transform error through `uploads.service.ts`, the same at `HEAD` before this pass); 0 typecheck errors on `api`, `web` and `worker`; `git status --short services/api/prisma` empty (no migration), `schema.gql` carries `defaultPort`/`credentialLabel`/`credentialHelpUrl` on `MediaServerOption` and `libraryLayout: String!` on `EncodeJobDetails`. `web` `check-messages` confirms no drift at 557 keys. `worker` 314 tests, 311 passing — the same 3 pre-existing `src/ffmpeg/` failures. AC-1 to AC-11 and AC-13 have not been run (T014 skipped, no Plex); AC-12 rests on its unit test.

## 2026-09-25 — `071-tmdb-key-onboarding`

`api` 735/52 suites, 0 typecheck errors, `git status --short services/api/prisma` empty (no migration), `schema.gql` diff is exactly `catalogKeyConfigured: Boolean!` on `MediaCapabilities`. `web` typechecks at 0 errors, `bin/npm web run build` exits 0, and `bin/cli web node scripts/check-messages.mjs` confirms no `en`/`es` drift at 553 keys (`worker` untouched). The live pass on the dev stack as admin confirmed AC-1, AC-3, AC-4 and AC-5; AC-2 and the non-admin half of AC-7 have not been run (no non-admin login), and AC-6 is partial (signup, login and API-terms answer 200; `/settings/api` needs a TMDB login).

## 2026-09-25 — `070-subtitle-format-selection`

`api` 726/52 suites, 0 typecheck errors, `git status --short services/api/prisma` shows only `prisma/seeds/settings.ts` (no migration), `schema.gql` gains `allowedSubtitleFormats: [String!]!` on `EncodeJobDetails` (its diff also carries `069`'s unrelated changes). `web` typechecks at 0 errors, `bin/npm web run build` completes, `check-messages` confirms no drift at 534 keys. `worker` typechecks at 0 errors, `bin/npm worker run build` exits 0, `bin/npm worker test` 290 tests across 24 suites, 287 passing — the same 3 pre-existing `src/ffmpeg/` failures recorded under `058`; `git diff --stat services/worker/ffmpeg` empty. A browser pass on Settings → Compression confirmed AC-1, AC-2 (defaults, locking that keeps state, the image group unlocking) and the settings half of AC-3 (an empty text list saved through the UI, persisted as `''`, survived `docker compose restart api` and a reload). AC-3's encode half, AC-4, AC-5 and AC-6 to AC-10 have not been run: there is no `ProcessJob`, no source file with ASS/PGS subtitles, and no admin token for a raw `updateSettings` call (AC-4 rests on its unit tests).

## 2026-09-25 — `069-title-refresh`

`api` 716/51 suites, 0 typecheck errors, `git status --short services/api/prisma` empty (no migration), `schema.gql` diff is exactly `refreshMovie`, `refreshShow`, `TitleRefresh`, `RefreshCatalogOutcome` and `RefreshMediaServerOutcome`. `web` typechecks at 0 errors, `bin/npm web run build` exits 0, and `bin/cli web node scripts/check-messages.mjs` confirms no `en`/`es` drift at 534 keys (`worker` untouched). The live pass ran on a dev stack with one film, no media server and one user: AC-1, AC-3, AC-8, AC-9 and AC-10 were confirmed on `/movies/<id>` (AC-10 under `en` only); AC-2, AC-4 to AC-7, AC-5c and AC-11 have not been run (no series, Jellyfin, delivered title or second user). A refresh rewrites `overview` in TMDB's default language, whatever locale the title was registered in.

## 2026-09-20 — `067-title-removal`

`api` 678/51 suites, 0 typecheck errors, `git status --short services/api/prisma` empty (no migration), `schema.gql` diff is exactly `TitleRemoval`, `Mutation.removeMovie`/`removeShow` and `Movie.otherOwners`/`Show.otherOwners`. `web` typechecks at 0 errors, `bin/npm web run build` exits 0, and `bin/cli web node scripts/check-messages.mjs` confirms no `en`/`es` drift at 498 keys (`worker` untouched, NFR-4). The live two-user manual pass has not been run.

## 2026-09-20 — `066-https-local-ca`

`api` 661/50 suites, 0 typecheck errors, `git status --short services/api/prisma` empty (no migration), `schema.gql` diff is exactly `useHttps: Boolean!` on `EnvironmentInfo`. `web` typechecks at 0 errors, `bin/npm web run build` exits 0, and `bin/cli web node scripts/check-messages.mjs` confirms no `en`/`es` drift at 488 keys (`worker` untouched). The certificate step was verified live on the dev stack (AC-1, AC-3, AC-5, AC-6, AC-7, AC-10, AC-11); the browser-side pass (AC-2, AC-4, AC-4b, AC-8, AC-9) and `install.sh` end to end have not been run.

## 2026-09-20 — `065-pipeline-error-resume`

`api` 657/50 suites, 0 typecheck errors, `git status --short services/api/prisma` empty (no migration), `schema.gql` diff is exactly `DownloadError`, `Download.lastError`, `Download.retryable` and `Mutation.sourceScanFailed`. `web` typechecks at 0 errors, `bin/npm web run build` exits 0, and `bin/cli web node scripts/check-messages.mjs` confirms no `en`/`es` drift at 484 keys. `worker` typechecks at 0 errors, `bin/npm worker run build` exits 0, and `bin/npm worker test` runs 253 tests across 23 suites, 250 passing — the same 3 pre-existing `src/ffmpeg/` failures recorded under `058`. The live manual pass (AC-1 to AC-12) has not been run.

## 2026-09-19 — `064-global-downloads-page`

`api` 618/50 suites, 0 typecheck errors, `git status --short services/api/prisma` empty (no migration), `schema.gql` diff is exactly `showId`, `showTitle`, `owned` on `Download` plus `downloads` and `activeDownloadCount` on `Query`. `web` typechecks at 0 errors, `bin/npm web run build` exits 0, and `bin/cli web node scripts/check-messages.mjs` confirms no `en`/`es` drift at 455 keys (`worker` untouched). The live manual pass on `/downloads` with two users has not been run.

## 2026-09-19 — `063-downloads-panel-filters`

`api` 609/50 suites, 0 typecheck errors, `git status --short services/api/prisma` empty (no migration), `schema.gql` diff is exactly `seasonNumber: Int` on `Download`. `web` typechecks at 0 errors, `bin/npm web run build` exits 0, and `bin/cli web node scripts/check-messages.mjs` confirms no `en`/`es` drift at 446 keys. `worker` untouched. The downloads panel now has completed/working/error filters, orders by last activity and sits inside the detail card; a season-pack row's name is built by `web` from `seasonNumber`. The live manual pass (AC-1 to AC-9) has not been run.

## 2026-09-19 — `062-release-calendar`

`api` 603/50 suites, 0 typecheck errors, `git status --short services/api/prisma` empty (no migration), `schema.gql` diff is exactly the `calendar` query, `CalendarEntry` and `CalendarEntryKind`. `web` typechecks at 0 errors, `bin/npm web run build` exits 0, and `bin/cli web node scripts/check-messages.mjs` confirms no `en`/`es` drift at 442 keys. `worker` untouched. The live manual pass on `/calendar` has not been run.

## 2026-09-19 — `060-duplicate-torrent-add`

`api` 559/46 suites, 0 typecheck errors, `git status --short services/api/prisma` empty (no migration), `schema.gql` not in the diff. `web`/`worker` untouched. The live manual pass (AC-1 to AC-7 against a running stack) has not been run.

## 2026-09-17 — `059-season-pack-acquisition-ui`

`api` 536/46 suites, 0 typecheck errors, `git status --short services/api/prisma` empty (no migration — NFR-1, every column REQ-7 needs already existed). `web` typechecks at 0 errors, `bin/npm web run build` exits 0, and `bin/cli web node scripts/check-messages.mjs` confirms no `en`/`es` drift at 428 keys. `worker` untouched (`git diff --stat services/worker` empty, NFR-4). `schema.gql` diff is exactly the one mutation in `spec.md`'s contract delta, `addTorrentToSeason`. Manual pass on `/shows/<id>` confirmed AC-1, AC-2, AC-6 and AC-8 live against a running stack (season header buttons, a season magnet lifting aired episodes to `QUEUED` while future ones stayed `MISSING`, the "already attached" refusal naming the film, and episodes reverting on delete); AC-3/AC-5/AC-7 rely on the same unchanged `attachTorrentSource`/scan pipeline already covered by `013`'s and this feature's own unit tests rather than a live end-to-end run. **AC-9 surfaced, and this pass fixed, a pre-existing, unrelated bug**: `services/web/src/lib/graphql-error.ts`'s `translateGraphQLError` did `JSON.parse` on `extensions.i18n.params`, but `api` sends `params` as a plain object, never `JSON.stringify`'d — every keyed error with params (`error.season.not_found`, `error.magnet.already_attached`, and any pre-`059` error carrying params, e.g. `addMagnetToMovie`'s) silently fell back to English regardless of UI locale; a param-less key already translated correctly. Confirmed present on the pre-`059` movie path too, so not a regression this feature introduced — fixed as a direct one-file change (no spec needed, Article VII: single service, no schema/contract change) rather than left as debt: `GraphQLErrorLike.params` retyped to `Record<string, unknown>`, the `JSON.parse` removed. Re-verified live in `es` afterward.

## 2026-09-16 — `058-compression-resolution`

— and again 2026-09-16 after `058-compression-resolution` spec 0.5.0's REQ-17 (empty `PERCEPTOR_SOURCE` on uploaded files, found validating the feature against real logs): `worker` typecheck (`bin/cli worker npx --no tsc --noEmit`) now reports **0 errors** — the two `src/metadata/container-tags.spec.ts` `TS2554` errors recorded under `052` above are resolved, not merely unchanged. `bin/npm worker run build` exits 0; `bin/npm worker test` runs 248 tests across 22 suites, 245 passing — the same 3 pre-existing, unrelated `src/ffmpeg/` failures noted just above, confirmed unchanged; `git diff --stat services/worker/src/paths services/worker/src/ffmpeg` empty.

## 2026-09-16 — `058-compression-resolution`

`api` 517/46 suites, 0 typecheck errors, `git status --short services/api/prisma` shows only `prisma/seeds/settings.ts` modified (no migration — NFR-4, `compression_resolution` already existed). `web` typechecks at 0 errors, `bin/npm web run build` exits 0, and `bin/cli web node scripts/check-messages.mjs` confirms no `en`/`es` drift at 423 keys. `worker` typecheck reports the same 2 pre-existing `src/metadata/container-tags.spec.ts` errors noted under `052` above and no others; `bin/npm worker run build` exits 0; `bin/npm worker test` runs 244 tests across 22 suites, 241 passing — the 3 failures are the pre-existing `buildCommand.spec.ts` CRF mismatch plus the stale `ffmpeg/1.json`/ `2.json` corpus cases in `cases.spec.ts`, both confirmed unrelated and explicitly out of scope for this feature (spec § Out of Scope; the corpus predates the rule this feature replaced and is not a reference for it).

## 2026-09-14 — `056-shorts-runtime-classification`

`api` 483/44 suites, 0 typecheck errors, `git status --short services/api/prisma` empty (no migration — `Movie.isShort` already existed). `web` typechecks at 0 errors, `bin/npm web run build` exits 0, and `bin/cli web node scripts/check-messages.mjs` confirms no `en`/`es` drift (`worker` untouched by this feature, deliberately — no pipeline stage changed, only who/what decides `Movie.isShort` at registration).

## 2026-09-14 — `055-environment-panel`

`api` 477/44 suites, 0 typecheck errors, `git status --short services/api/prisma` empty (no Prisma model, no migration). `web` typechecks at 0 errors, `bin/npm web run build` exits 0, and `bin/cli web node scripts/check-messages.mjs` confirms no `en`/`es` drift (`worker` untouched by this feature — no pipeline stage changed, only the admin Settings screen's new read-only tab).

## 2026-09-11 — `054-interrupted-encode-recovery`

`api` 471/43 suites, 0 typecheck errors, one migration (`ProcessJob.recoveryCount Int @default(0)` — `git status --short services/api/prisma` shows a modified `schema.prisma` and one new migration directory). `worker` `bin/npm worker run build` exits 0 and `bin/npm worker test` runs 181 tests across 20 suites, 179 passing — same 2 pre-existing `src/ffmpeg/` failures as above, confirmed unchanged; `worker` typecheck reports the same 2 pre-existing `src/metadata/container-tags.spec.ts` errors noted under `052` above and no others (`web` untouched by this feature).

## 2026-09-11 — `053-downloads-panel-repair`

`api` 460/42 suites, 0 typecheck errors, one migration (`ProcessJob.encodeSpeed Float?` plus the `infoHash` lowercase data backfill — `git status --short services/api/prisma` shows a modified `schema.prisma` and one new migration directory). `web` typechecks at 0 errors and `bin/npm web run build` exits 0. `worker` `bin/npm worker run build` exits 0 and `bin/npm worker test` runs 178 tests across 20 suites, 176 passing — same 2 pre-existing `src/ffmpeg/` failures as above, confirmed unchanged; `worker` typecheck reports the same 2 pre-existing `src/metadata/container-tags.spec.ts` errors noted under `052` above and no others.

## 2026-09-11 — `052-deselected-torrent-files`

`api` 454/42 suites, 0 typecheck errors, no Prisma migration (`git status --short services/api/prisma` empty). `worker` `bin/npm worker run build` exits 0 and `bin/npm worker test` runs 175 tests across 20 suites, 173 passing — same 2 pre-existing `src/ffmpeg/` failures as above, confirmed unchanged. `worker` typecheck (`bin/cli worker npx --no tsc --noEmit`) reports 2 errors in `src/metadata/container-tags.spec.ts` (`TS2554: Expected 3 arguments, but got 2`) — confirmed via `git stash` to already exist on `master` at the tip of `051-language-track-titles`, before this feature touched anything; likely a spec left stale when `051` changed `buildContainerTitle`/ `buildSourceTag`'s signature. Not fixed here — `src/metadata/` is untouched by `052`, and the error does not affect `bin/npm worker run build` (which excludes `*.spec.ts`). Worth a follow-up.

## 2026-09-10 — `051-language-track-titles`

`api` 447/42 suites, `worker` typechecks at 0 errors, `bin/npm worker run build` exits 0, and `bin/npm worker test` runs 168 tests across 19 suites, 166 passing (the 2 failures are the same pre-existing, unrelated ones recorded above under `047-source-deletion` — the stale `ffmpeg/2.json` track-title string and the `buildCommand.spec.ts` CRF mismatch — confirmed still exactly those two and no others)

## 2026-09-09 — `048-shorts-category`

`api` 436/40 suites, `web` typechecks at 0 errors and `bin/npm web run build` exits 0 (`worker` untouched by that feature, deliberately — NFR-2 makes an untouched worker the mechanism by which `outputRoot` stays a resolved string the worker cannot tell a short from a feature film by)

## 2026-09-08 — `047-source-deletion`

`api` 414/39 suites, `web` typechecks at 0 errors and `bin/npm web run build` exits 0, `worker` typechecks at 0 errors, `bin/npm worker run build` exits 0, and `bin/npm worker test` runs 164 tests across 18 suites, 162 passing (the 2 failures are pre-existing and unrelated — the stale `ffmpeg/2.json` track-title string above, plus a CRF mismatch in `src/ffmpeg/buildCommand.spec.ts`, both confirmed present at `HEAD` before this feature touched anything, in `src/ffmpeg/` territory this feature does not own)

## 2026-09-04 — `046-encode-metadata-tags`

`worker` typechecks at 0 errors, `bin/npm worker run build` exits 0, and `bin/npm worker test` runs 157 tests across 17 suites, 156 passing (`api`/`web` untouched by that feature; the one failure is the pre-existing, unrelated stale track-title string in `ffmpeg/2.json` first recorded under `039-per-title-language-split` above, still present and still out of scope here)

## 2026-09-04 — `045-media-type-availability`

`api` 390/39 suites, `web` typechecks at 0 errors and `bin/npm web run build` exits 0 (`worker` untouched by that feature, deliberately — NFR-5 makes an untouched worker the mechanism by which a title already in flight finishes even after its type is disabled mid-pipeline)

## 2026-09-04 — `044-settings-screen-polish`

`api` 363/37 suites, `web` typechecks at 0 errors and `bin/npm web run build` exits 0 (`worker` untouched by that feature, deliberately — no pipeline stage changed, only the admin Settings screen and the `/preferences` torrent-group catalog it feeds)

## 2026-09-03 — `043-pipeline-status-normalization`

`api` 361/37 suites, `web` typechecks at 0 errors and `bin/npm web run build` exits 0 (`worker` untouched by that feature, deliberately — no pipeline stage changed status, the reporting layer above them did)

## 2026-09-03 — `042-encode-global-language-preferences`

`api` 342/36 suites (`worker`/`web` untouched by that feature)

## 2026-09-03 — `041-episode-info-refresh`

`api` 336/36 suites (`worker`/`web` untouched by that feature)

## 2026-09-03 — `035-scheduled-tasks`

`api` 331/35 suites, `web` typechecks at 0 errors and `bin/npm web run build` exits 0 (`worker` untouched by that feature)

## 2026-09-02 — `040-indexer-search-cache`

`api` 321/34 suites (`worker`/`web` untouched by that feature)

## 2026-09-02 — `039-per-title-language-split`

`api` 313/33 suites, `worker` 151/152 tests across 16 suites (one pre-existing, unrelated failure in `src/ffmpeg/cases.spec.ts` — a stale expected track-title string in the `2.json` corpus fixture, confirmed present at `HEAD` before this feature touched anything; not fixed here since `params.ts` was explicitly out of scope), `web` typechecks at 0 errors and `bin/npm web run build` exits 0

## 2026-09-02 — `021-user-preferences`

`api` 308/33 suites, `web` typechecks at 0 errors and `bin/npm web run build` exits 0 (`worker` untouched by that feature)

## 2026-09-01 — `038-encode-report-durability`

`api` 301/32 suites (`worker` untouched by that feature)

## 2026-09-01 — `037-indexer-result-loss`

`api` 294/32 suites (`worker` untouched by that feature)

## 2026-08-31 — `034-jellyfin-library-reconciliation`

`api` 285/31 suites (`worker` untouched; `web` has no test suite — see `services/web/CLAUDE.md`)

## 2026-08-28 — `033-billboard-and-navigation`

`api` 256/28 suites (`worker` untouched by that feature)

## 2026-08-27 — `028-users-screen-refactor`

All three services typecheck clean (0 errors) and `bin/npm web run build` exits 0, measured 2026-08-27 after `028-users-screen-refactor`. Test counts then: `api` 217/23 suites, `worker` 93/12 — remeasured 2026-08-28 after `032-optional-compression`: `api` 249/26 suites, `worker` 140/15 suites

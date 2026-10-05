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

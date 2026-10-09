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

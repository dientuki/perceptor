---
title: Dependency Update Cadence
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-10-03
last_updated: 2026-10-03
status: Implemented
services: [api, web, infra]
---

# SPEC: Dependency Update Cadence (`spec.md`)

## Context & Goal

Nothing in this repository updates a dependency. There is no `.github/dependabot.yml`, no Renovate
config, no `npm audit` anywhere in `bin/`, `install.sh` or the three workflows under
`.github/workflows/`. Every version in `services/{api,web,worker}/package-lock.json` is whatever
resolved the day someone last typed `npm install` — `api`'s lockfile is dated 2026-09-03, `web`'s
2026-09-19, `worker`'s 2026-08-07. The five published images carry those trees verbatim, and the
only thing that moves a base image is a hand edit to a `Dockerfile`. Measured 2026-10-03,
`npm audit --omit=dev` reports **15 vulnerabilities on `api` (13 high, 2 moderate), 4 on `web`
(1 critical, 3 high) and 0 on `worker`** — the `worker`'s own 6 are all dev-only, the `vitest` 2.1
chain three majors behind current.

Two facts found while grounding this spec decide its shape, and neither is visible from the audit
summary. On `api`, a lockfile refresh that changes **no declared version range** clears 9 of the 15
(`fast-uri` via `ajv`, `multer` via `@nestjs/platform-express`, `ws` via `graphql-ws`, `qs` via
`express`, and the parents npm counts alongside them). The 6 that survive are all exact-pinned
transitives of the Prisma family with **no fixed release published anywhere**:
`@prisma/adapter-mariadb` pins `mariadb: 3.4.5` at every version it has ever shipped, latest
`7.10.0` included and the `8.1.0-dev` line too; `prisma` pins `mysql2: 3.15.3` and, through
`@prisma/config`, `deepmerge-ts: 7.1.5`; `prisma@latest` is `8.0.0-rc.19`, a prerelease. On `web`
the mirror image holds: all 4 collapse into one bump, `next 16.2.12 → 16.3.8`, which carries
`postcss` to the fixed `8.5.23` and lets `sharp` resolve past the libvips CVEs, with the `react`/
`react-dom` peer range and the `babel-plugin-react-compiler` peer unchanged between the two
versions. The advisory that actually sits on a reachable path is not the headline one — the Next.js
unauthenticated RCE (`GHSA-p293-qw3h-jr36`) is Windows-hosted only and unreachable from an Alpine
container — it is the AVIF Image Optimization RCE (`GHSA-2xp9-vwfh-vxw4`) plus the `sharp`/libvips
CVEs, both on the `next/image` remote-pattern path that `next.config.ts` opens to
`image.tmdb.org/t/p/**` and that `MediaCard`, `Movie`, `Show`, `UserDropdown`,
`IndexerSetupGuide` and the login page all render through.

This feature does two things and no more: it installs the cadence that does not exist, and it
lowers today's floor once so that the cadence starts from a known state. Afterwards
`.github/dependabot.yml` watches five ecosystems (npm in all three services, `github-actions`, and
the `docker` base images) and opens its PRs against `dev`; a CI job per service fails on any
production advisory at `high` or above that is not in a committed allowlist, and that job sits
inside the `verify` gate `release.yml` already depends on, so a tag cannot publish images past a
new unreviewed high; the allowlist holds exactly the 6 Prisma-family entries, each naming the
topology fact that makes it unreachable and the condition that would reopen it. The `api` and `web`
audits go from 15 and 4 to 6-allowlisted and 0.

**No pipeline stage in the root `CLAUDE.md` changes status.** No stage is added or removed, no
Prisma model moves, no GraphQL field appears. This is repo-health debt item 2, named in that memory
note since 2026-10-03.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Dependabot config)**: `.github/dependabot.yml` must exist and be accepted by GitHub
      with no configuration error, declaring five update targets: `npm` rooted at
      `/services/api`, `/services/web` and `/services/worker`, `github-actions` at `/`, and
      `docker` covering the five service `Dockerfile`s (`api`, `web`, `worker`, `torrent`,
      `indexer`) and `docker-compose.yaml`. The `docker` target may declare those paths under a
      single `directories:` list — "five update targets" counts configurations, not directories.
- [x] **REQ-2 (PRs target `dev`)**: Every ecosystem must open its pull requests against `dev`, not
      the repository's default branch. `master` and `stage` take changes only through the flow in
      the branch model (feature → `dev` → `stage` → `master`), and both are protected against
      direct push.
- [x] **REQ-3 (Own images excluded)**: The `docker` ecosystem must not propose changes to the five
      `ghcr.io/dientuki/perceptor-*:${PERCEPTOR_TAG:-latest}` entries in `docker-compose.yaml`.
      Those are this project's own images and their version is `PERCEPTOR_TAG`, set per
      installation; pinning one to a concrete tag would break the published-images install path.
- [x] **REQ-4 (`api` floor, no range changes)**: `services/api`'s production audit must drop from 15
      vulnerabilities to exactly the 6 recorded in the allowlist, with **no change to any declared
      version range** in `services/api/package.json` — the whole reduction comes from the lockfile.
- [x] **REQ-5 (`web` floor, zero)**: `services/web`'s production audit must read 0 vulnerabilities,
      achieved by moving `next` to at least `16.3.8` so that `postcss` resolves to `8.5.23` or
      later and `sharp` to `0.35.5` or later.
- [x] **REQ-6 (Advisory allowlist)**: A committed, human-readable file must record every accepted
      production advisory. Each entry must carry the advisory identifier, the package and version
      range, the severity, the date it was accepted, the reachability argument that justifies
      accepting it, and the concrete condition that would require revisiting it. An entry with no
      reachability argument is not a valid entry, and the gate must reject it as such rather than
      honour it.
- [x] **REQ-7 (CI gate)**: CI must fail when any one of the three services has a production
      dependency advisory at `high` or above that is not in the allowlist. Dev-only advisories must
      not fail it.
- [x] **REQ-8 (Unknown advisory fails)**: A production advisory at `high` or above that appears and
      is absent from the allowlist must fail the gate and the failure output must name the advisory
      identifier and the package, so a reader of the failed run knows what to decide about without
      re-running the audit locally.
- [x] **REQ-9 (Stale allowlist entry fails)**: An allowlist entry for an advisory the audit no
      longer reports must also fail the gate. An allowlist that outlives the reason it was written
      is how an accepted risk becomes an unexamined one.
- [x] **REQ-10 (A green run states what it allowed)**: When the gate passes, its output must list
      the allowlist entries it honoured. A green run that says only "passed" hides the 6 accepted
      advisories from everyone who did not read the allowlist file.
- [x] **REQ-11 (Release gated)**: The gate must run inside the `verify` job `release.yml` already
      declares `needs:` on, so a `vX.Y.Z` or `vX.Y.Z-rcN` tag cannot publish the five images past a
      new unreviewed high-severity production advisory.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (No behaviour change)**: No pipeline stage, GraphQL field, Prisma model or
      user-visible string changes. `api` must typecheck at 0 errors and keep its full suite green
      (903 tests / 62 suites at the measured baseline of 2026-10-03); `web` must typecheck at 0
      errors, keep `check-messages` parity at 600 keys and produce a successful production build.
- [x] **NFR-2 (No `overrides`)**: The remediation must not introduce an npm `overrides` block.
      Forcing `mariadb@^3.5.4` into the nested tree would run Prisma's MariaDB adapter against a
      minor its author pinned away from, and the failure surface would be the database connection
      layer. The 6 are accepted and documented instead; **NFR-3** records the trigger for
      revisiting that.
- [x] **NFR-3 (Reachability is written, and revocable)**: Each accepted advisory must name the
      topology fact it rests on, and the fact must be one a reader can check. The two that apply
      today: `api` reaches `db` over the `perceptor-net` Docker bridge inside a single host with no
      TLS configured (`PrismaMariaDb` receives `DATABASE_URL` unmodified, no charset override, so
      `GHSA-g5xc-5w98-jfvm`'s big5/gbk/sjis/cp932/gb18030 range does not apply either), which makes
      an MitM on that link equivalent to already holding the host; and `mysql2`/`deepmerge-ts` enter
      only through the `prisma` CLI, which `src/bootstrap/run-migrations.ts` invokes at boot against
      that same local database, reading the project's own committed `prisma.config.ts`. **Either of
      those ceasing to hold — real TLS between `api` and `db`, or a database reachable from outside
      the host — reopens the decision**, and the allowlist entry must say so.
- [x] **NFR-4 (No new service dependency)**: The gate must not add anything to any service's
      `dependencies`. A dev-only tool or a plain script is acceptable; a production dependency added
      to make CI work is not.
- [x] **NFR-5 (Docker-first)**: Every command this feature documents for a human runs through a
      wrapper in `bin/` (Constitution, Article I). Steps that run on a GitHub runner are CI's own
      context and keep the shape `ci.yml` already uses.
- [x] **NFR-6 (`worker` untouched)**: `git diff --stat services/worker` must be empty. Its
      production audit is already 0 and its 6 dev advisories are out of scope (see below).
- [x] **NFR-7 (`web` verification is manual)**: `web` has no test suite — 0 spec files. The `next`
      minor is therefore verified by typecheck, message parity, a production build and a live pass
      over the routes that render `next/image`, not by tests. The production build must not be run
      against a live dev stack: `next build` overwrites `.next` and un-hydrates every page of a
      running `bin/dev`.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.**

No resolver, entity, DTO or enum is touched, so `services/api/src/schema.gql` must not appear in
the diff at all (Constitution, Article IV: it may appear alone as a regeneration artifact, and here
there is nothing to regenerate). `web` and `worker` retype the schema by hand with no codegen, and
this feature gives them nothing new to retype. The error table is empty for the same reason: no
code path can now fail in a way a user sees. The only new failure surface is a CI job, whose
audience is a maintainer reading a workflow log, not a user reading a translated message — so no
`extensions.i18n` key is added and `services/web/messages/{en,es}.json` stays at 600 keys.

## Data Model Changes

**None.** `services/api/prisma/schema.prisma` is untouched and no migration directory is created;
`git status --short services/api/prisma` must be empty after this feature.

## Acceptance Criteria

- [ ] **AC-1**: `.github/dependabot.yml` exists, and GitHub's Insights → Dependency graph →
      Dependabot view lists five update configurations with no "config error" banner.
- [ ] **AC-2**: The first pull requests Dependabot opens have `dev` as their base branch, not
      `master`.
- [ ] **AC-3**: No Dependabot pull request proposes a change to a
      `ghcr.io/dientuki/perceptor-*:${PERCEPTOR_TAG:-latest}` line in `docker-compose.yaml`.

  **AC-1, AC-2 and AC-3 are unticked on purpose, not an oversight.** Dependabot reads
  `.github/dependabot.yml` from the repository's **default branch** only (a GitHub constraint, not
  a choice made here), so the config does nothing until it reaches `master` through the normal
  `dev` → `stage` → `master` flow — observable only after this branch merges well past its own
  close. Recorded in `tasks.md` T016 as deferred past this feature's merge; tick them there once the
  config has actually reached `master` and the first Dependabot PRs have opened.

- [x] **AC-4**: A production audit of `services/api` reports exactly 6 vulnerabilities, and every
      one of them appears in the allowlist: `deepmerge-ts` (`GHSA-ggr8-5vv4-36mx`), `mariadb`
      (`GHSA-cqhc-2h57-wpxf`, `GHSA-42r5-vhpq-m858`, `GHSA-g5xc-5w98-jfvm`), `mysql2`
      (`GHSA-3f6p-5ww8-9rcr`, `GHSA-rgwj-5xj2-c3m3`) and the three parents npm counts beside them
      (`@prisma/config`, `prisma`, `@prisma/adapter-mariadb`).
- [x] **AC-5**: `git diff services/api/package.json` is empty while
      `git diff --stat services/api/package-lock.json` is not.
- [x] **AC-6**: A production audit of `services/web` reports `found 0 vulnerabilities`, and
      `services/web/package-lock.json` resolves `next` to `16.3.8` or later, `postcss` under
      `node_modules/next` to `8.5.23` or later, and `sharp` to `0.35.5` or later.
- [x] **AC-7**: A production audit of `services/worker` reports `found 0 vulnerabilities` and
      `git diff --stat services/worker` is empty.
- [x] **AC-8 (failure path)**: With one allowlist entry temporarily deleted, the gate exits
      non-zero and its output names that advisory's identifier and package. Restoring the entry
      makes the same run pass.
- [x] **AC-9 (failure path)**: With a fabricated allowlist entry added for an advisory no audit
      reports, the gate exits non-zero and its output names the stale entry.
- [x] **AC-10**: The gate is green on the feature branch with the allowlist as committed, and its
      output lists the 6 honoured entries.
- [x] **AC-11**: `.github/workflows/release.yml`'s `build` job reaches the new gate transitively —
      reading the two files shows `build` declares `needs: verify` and `verify` calls `ci.yml`,
      which contains the gate.
- [x] **AC-12**: `bin/cli api npx --no tsc --noEmit` reports 0 errors and `bin/npm api test` is
      green at 903 tests / 62 suites or better.
- [x] **AC-13**: `bin/cli web npx --no tsc --noEmit` reports 0 errors,
      `bin/cli web node scripts/check-messages.mjs` confirms `en`/`es` parity at 600 keys, and
      `bin/npm web run build` exits 0 — the last one with no dev stack running.
- [x] **AC-14**: After the `next` bump, posters render on `/`, `/movies`, a film's detail page,
      `/shows`, the user dropdown and `/login` — the six `next/image` call sites — with no broken
      image and no error in the browser console.
- [x] **AC-15 (failure path)**: Reintroducing a known-vulnerable production dependency on a scratch
      branch (for example pinning `next` back to `16.2.12`) makes the gate fail on `web` naming
      `GHSA-2xp9-vwfh-vxw4`, and a `vX.Y.Z-rcN` tag pushed from that branch does not publish any
      image, because `build` never runs.
- [x] **AC-16 (failure path)**: When the audit itself cannot complete — no network to the registry,
      or output that is not parseable JSON — the gate exits non-zero with a message saying the audit
      failed, and does **not** report a pass. Verified by running it with the registry unreachable.
- [x] **AC-17 (failure path)**: An allowlist entry whose reachability argument is empty makes the
      gate exit non-zero naming that entry, rather than honouring the entry.

## Out of Scope

- **`worker`'s `vitest` 2.1 → 5.x chain.** Six advisories (one critical), every one dev-only and
  every one inside the test runner: `vitest`, `vite`, `vite-node`, `@vitest/mocker`, `esbuild`,
  `nanoid`. The only fix npm offers is `vitest@5.0.3`, three majors up, which would have to be
  re-validated against all 314 `worker` tests. The gate this feature adds is production-only, so
  that jump never blocks a merge or a tag; Dependabot will open the PR and it gets reviewed on its
  own. Keeping it here would turn a cadence feature into a test-runner migration.
- **Prisma 8 and `overrides`.** `prisma@latest` is `8.0.0-rc.19`, a prerelease, and a major that
  moves the client, the CLI, the adapter and the migration path at once is not a security fix — it
  is its own feature with its own migration risk. **NFR-3** names the two conditions that reopen
  the `overrides` question before then.
- **Whether a non-security Dependabot PR gets merged.** A spec can require that a new high-severity
  production advisory blocks a merge and a tag — **REQ-7** through **REQ-11** do. It cannot require
  that a human reads a queue. The gate is deliberately the only enforced part; the rest is a queue
  of proposals, and an unread queue degrades to exactly today's situation with better visibility,
  not worse.
- **Auto-merge for Dependabot PRs.** Would need a green `web` test suite to be safe, and `web` has
  none. Revisit if `web` ever gets one.
- **Bumping the base images themselves.** `node:24.18.0-alpine`, `mariadb:12.3.2`, `redis:7-alpine`,
  `traefik:v3.7`, `lscr.io/linuxserver/qbittorrent:5.2.3`,
  `lscr.io/linuxserver/prowlarr:2.5.2` and `flaresolverr:v3.5.0` stay exactly as pinned. This
  feature only makes something watch them; each proposal is reviewed on its own, and a MariaDB or
  Redis major is a data-migration question, not a dependency bump.
- **`biome check` on `web`.** 1549 errors and 69 warnings over 172 files, ~270 of them real lint
  diagnostics including 7 `noBlankTarget` reverse-tabnabbing hits. A genuine security-adjacent
  item, but a different one: it is repo-health debt 3, needs a formatting-only commit first, and
  touches one service.
- **Container-image scanning.** `npm audit` covers the npm trees; it says nothing about the Alpine
  packages in the five published images. A Trivy or Grype pass over the release artifacts is a
  separate, larger piece of work with its own allowlist problem.
- **The acceptance-criteria verification backlog.** 308 unticked ACs across specs `060`–`083` is
  the larger debt item; it is not this one.

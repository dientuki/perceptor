---
title: Dependency Update Cadence — Tasks
last_updated: 2026-10-03
status: Draft
---

# TASKS: Dependency Update Cadence (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[infra]` | Which subagent owns the task. Exactly one per task. `[worker]` appears nowhere: `NFR-6` makes an untouched `worker` a requirement, not an oversight — its production audit is already 0 and its six dev advisories are out of scope. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[infra]` | Repo-root and third-party-container territory. **For this feature it also covers `tools/audit/`, `.github/dependabot.yml` and `.github/workflows/ci.yml`**, which no agent owns today — the same per-feature grant `084-landing-page-i18n` used for `tools/site/` and the `site` job (see `infra/plan.md` § Scope). `.github/workflows/release.yml` is read, never edited. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Nothing in this feature crosses the GraphQL boundary, so the usual "contract first, consumers
second" ordering does not apply. What orders these groups instead is that **the gate is verified
last**: a gate verified before the two lockfile floors drop is a gate verified red.

## Tasks

### Group 1 — the two floors and the cadence

Three independent tracks. They share no file, no image and no lockfile, so the `[P]` here is real
rather than aspirational.

- [ ] **T001** `[api] [P]` Refresh `services/api/package-lock.json` from inside a container on the
      service's own `node:24.18.0-alpine` base (`npm audit fix`, not `--package-lock-only`), then
      read the diff: movement must be confined to the dependency paths of the nine cleared
      advisories (`fast-uri` under `ajv`, `multer` under `@nestjs/platform-express`, `ws` under
      `graphql-ws`/`subscriptions-transport-ws`, `qs` under `express`/`body-parser`/`superagent`,
      plus the parents npm counts beside them). Anything that moved under `@prisma/*`, `mariadb`,
      `ioredis`, `bullmq` or `@nestjs/core` is outside the brief — report it, do not commit it.
      No `overrides` block (`NFR-2`).
      *Done when:* a production audit of `services/api` reports exactly **6** vulnerabilities and
      they are exactly `deepmerge-ts`, `@prisma/config`, `prisma`, `mariadb`,
      `@prisma/adapter-mariadb`, `mysql2`; `git diff services/api/package.json` is empty;
      `git diff --stat services/api/package-lock.json` is not; `bin/cli api npx --no tsc --noEmit`
      reports 0 errors and `bin/npm api test` is green at ≥ 903 tests / 62 suites.
      *(AC-4, AC-5, AC-12)*

- [ ] **T002** `[api]` Confirm the refreshed lockfile survives a real database connection: bring the
      stack up and watch `api` reach healthy — which means `prisma migrate deploy` and the
      production seed both completed against MariaDB through `@prisma/adapter-mariadb` — then answer
      one real GraphQL query. Most of the 903 tests mock Prisma, so this is the only check that
      covers a transitive moving under `@prisma/*`/`mariadb`/`ioredis`; because `api` migrates before
      `app.listen()`, that failure presents as a container that never turns healthy rather than as a
      line in any test report. → T001
      *Done when:* `docker compose ps` shows `api` healthy and `/` renders for a signed-in user
      (one GraphQL round trip confirmed).

- [ ] **T003** `[web] [P]` Change `"next": "16.2.12"` → `"next": "16.3.8"` in
      `services/web/package.json` (exact pin, no caret — matching how `next`, `react`, `react-dom`,
      `@biomejs/biome` and `babel-plugin-react-compiler` are already pinned) and install **from
      inside the `web` container** with a targeted `npm install next@16.3.8`. **Do not run
      `npm audit fix` in this service** — it has 0 test files, so the diff has to stay small enough
      for a human to read. Then read the lockfile diff and confirm every moved package sits inside
      `next`'s own subtree (`next`, `@next/env`, `postcss`, `nanoid`, `@swc/helpers`, `styled-jsx`,
      `sharp`, `@img/*`); `tailwind-merge`, `lucide-react`, `next-intl`, `@fullcalendar/*` or
      `tus-js-client` moving is collateral this service cannot detect — report it.
      *Done when:* a production audit of `services/web` reports `found 0 vulnerabilities`; the
      lockfile resolves `next` ≥ `16.3.8`, `postcss` under `node_modules/next` ≥ `8.5.23`, `sharp`
      ≥ `0.35.5`, **and carries both `@img/sharp-linuxmusl-x64` and `@img/sharp-linuxmusl-arm64` at
      the new version** (today's lockfile holds all 25 `@img/*` variants; fewer is a stop-and-report
      — the published images are the only place it breaks, and only at request time);
      `git diff services/web/package.json` is one line. *(AC-6)*

- [ ] **T004** `[web]` Verify the bump statically. `bin/npm web run build` must **not** run while a
      dev stack is up for this checkout — `next build` overwrites `.next` and un-hydrates every page
      of the running dev server until the next `next dev` rebuild (`NFR-7`), so stop the stack
      first. → T003
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors,
      `bin/cli web node scripts/check-messages.mjs` confirms `en`/`es` parity at 600 keys, and
      `bin/npm web run build` exits 0. *(AC-13)*

- [ ] **T005** `[web]` Live pass over the six `next/image` call sites — `MediaCard.tsx`,
      `Movie.tsx`, `Show.tsx`, `UserDropdown.tsx`, `IndexerSetupGuide.tsx`, `login/page.tsx`: visit
      `/`, `/movies`, a film's detail page, `/shows`, open the user dropdown, sign out to `/login`.
      This is the only check in the repository that catches a dropped musl `sharp` binary, which
      passes `tsc`, passes `next build`, builds a clean image, and then returns 500 for every
      poster. → T004
      *Done when:* every poster renders and the browser console is clean on all six. *(AC-14)*

- [ ] **T006** `[infra] [P]` Create `.github/dependabot.yml` with five update configurations: `npm`
      at `/services/api`, `/services/web`, `/services/worker`; `github-actions` at `/`; and `docker`
      with one `directories:` list covering `/services/api`, `/services/web`, `/services/worker`,
      `/services/torrent`, `/services/indexer` and `/` (the last for `docker-compose.yaml`). Every
      configuration carries `target-branch: "dev"`; the `docker` one carries an `ignore` for
      `ghcr.io/dientuki/perceptor-*`. Set `open-pull-requests-limit` and a `groups` block
      deliberately rather than inheriting the default of 5 per ecosystem — minor and patch grouped
      per ecosystem, majors separate so one can be ignored without ignoring the rest. Weekly for
      `npm` and `github-actions`; monthly for `docker`.
      **Two GitHub behaviours this task must not fight** (both found while deriving these tasks, not
      in `plan.md`): Dependabot reads this file from the repository's **default branch** only, so the
      config does nothing until it reaches `master` through the normal flow — which is why its three
      acceptance criteria live in T016 and not here. And a configuration that sets `target-branch`
      **disables Dependabot *security* updates** for that package manager, leaving only the
      scheduled version updates. That is accepted: the enforcement mechanism in this feature is the
      CI gate, which blocks a merge and a tag rather than merely opening a PR, and the weekly
      version updates still carry security bumps. Dependabot *alerts* are unaffected.
      *Done when:* the file parses as YAML locally and declares exactly five configurations, each
      with `target-branch: "dev"`, and the `docker` one ignoring `ghcr.io/dientuki/perceptor-*`.

### Group 2 — the gate

Writable in parallel with Group 1 (the six allowlist entries are already measured and recorded in
`spec.md` § AC-4), but **verified** after it — T012 is where the two meet.

- [ ] **T007** `[infra] [P]` Create `tools/audit/allowlist.json` with the six accepted `api`
      advisories. Three are leaf packages carrying advisory identifiers — `deepmerge-ts`
      (`GHSA-ggr8-5vv4-36mx`), `mariadb` (`GHSA-cqhc-2h57-wpxf`, `GHSA-42r5-vhpq-m858`,
      `GHSA-g5xc-5w98-jfvm`), `mysql2` (`GHSA-3f6p-5ww8-9rcr`, `GHSA-rgwj-5xj2-c3m3`) — and three
      are the parents npm counts beside them, which carry no advisory of their own and are
      identified by what they pull in: `@prisma/config` (via `deepmerge-ts`), `prisma` (via
      `@prisma/config` and `mysql2`), `@prisma/adapter-mariadb` (via `mariadb`). The schema must
      hold both kinds. Each entry carries the service, package, version range, severity, date
      accepted (`2026-10-03`), a non-empty reachability argument and the condition that reopens it —
      transcribed from `spec.md` § NFR-3, not reinvented.
      *Done when:* the file parses as JSON, holds six entries, and every one has a non-empty
      reachability argument and reopen condition.

- [ ] **T008** `[infra]` Create `tools/audit/check.mjs`, following `tools/site/build.mjs`'s house
      style (header paragraph, `node:` imports only, `repoRoot` from `import.meta.url`, a non-zero
      exit that names the offending item). For each service it runs `npm audit --json --omit=dev`
      with that service directory as cwd and **branches on parsing stdout, never on the child's exit
      code** — `npm audit` exits non-zero whenever it finds anything, so the exit code says nothing
      about whether the audit ran. Valid JSON with a `vulnerabilities` map is a completed audit;
      anything else is a failed invocation and exits non-zero saying the audit failed. Reconciliation:
      a reported `high`/`critical` with no entry fails naming the advisory id and package; a
      `moderate` or below with no entry prints without failing (npm reports
      `@prisma/adapter-mariadb` itself as `moderate`, which is why six entries are allowlisted while
      five are gate-blocking); an entry matching nothing the audit reports fails as stale; an entry
      with an empty reachability argument fails naming the entry rather than being honoured; a clean
      reconciliation passes, printing the honoured entries. An optional positional argument narrows
      the run to one service. Nothing is added to any service's `dependencies` (`NFR-4`). → T007
      *Done when:* `node tools/audit/check.mjs` runs to completion inside the `web` image and prints
      a per-service result for all three services.

- [ ] **T009** `[infra]` Create `bin/audit`, modelled line for line on `bin/site`: `set -e`,
      `cd "$(dirname "$0")/.."`, source `bin/_docker.sh` and call `require_docker` first
      (`082-docker-engine-preflight` made this mandatory for every wrapper), refuse in Spanish if
      `.env` is missing, `set -a; . ./.env; set +a`, then `docker compose … run --rm --no-deps
      --user "$(id -u):$(id -g)" -v "$(pwd):/repo" --workdir /repo --entrypoint node web
      tools/audit/check.mjs "$@"`. The whole repo root is bind-mounted, not one service, because the
      script reads all three manifests. `chmod +x`. → T008
      *Done when:* `bash -n bin/audit` parses; `bin/audit` and `bin/audit api` both run and print
      their results; with the Docker engine stopped, `bin/audit` prints `082`'s engine message and
      exits non-zero.

- [ ] **T010** `[infra]` Exercise all four of the gate's failure paths for real and paste the actual
      output. This task exists because wiring an unexercised script into CI is exactly how the
      feature's worst silent failure reaches `master`. → T009
      *Done when:* (a) with one allowlist entry deleted, `bin/audit` exits non-zero naming that
      advisory and package, and restoring the entry makes the same run pass — *AC-8*; (b) with a
      fabricated entry for an advisory no audit reports, it exits non-zero naming the stale entry —
      *AC-9*; (c) with the registry unreachable, it exits non-zero saying the **audit itself**
      failed and does not report a pass — *AC-16*; (d) with one entry's reachability argument
      blanked, it exits non-zero naming that entry — *AC-17*.

- [ ] **T011** `[infra]` Add an `audit` job to `.github/workflows/ci.yml`, matching the existing
      `site` job's shape: `ubuntu-latest`, `actions/checkout@v5`, `actions/setup-node@v5` with
      `node-version: ${{ env.NODE_VERSION }}`, **no `npm ci`** (npm audit reads the manifests and
      needs no `node_modules`), then one `node tools/audit/check.mjs` step. → T010
      *Done when:* the workflow parses and the job appears in CI on the pushed branch.

### Group 3 — integration verification

Where the two floors and the gate meet. Everything here needs Group 1 and Group 2 complete.

- [ ] **T012** `[infra]` Run the gate against the landed floors and confirm it is green for the
      right reasons, including the service nobody touched. → T001, T003, T009
      *Done when:* `bin/audit` exits 0 and its output lists the six honoured allowlist entries
      (*AC-10*, `REQ-10`); `bin/audit worker` reports `found 0 vulnerabilities` and
      `git diff --stat services/worker` is empty (*AC-7*, `NFR-6`);
      `git status --short services/api/prisma` is empty and `services/api/src/schema.gql` does not
      appear anywhere in the feature's diff.

- [ ] **T013** `[infra]` Confirm by reading `.github/workflows/release.yml` and
      `.github/workflows/ci.yml` that the new job sits inside the release gate — `build` declares
      `needs: verify` and `verify` is `uses: ./.github/workflows/ci.yml`. `release.yml` is **not**
      edited: that existing chain is what satisfies `REQ-11`. → T011
      *Done when:* both lines are quoted from the two files with their line numbers. *(AC-11)*

- [ ] **T014** `[infra]` Prove a tag cannot publish past a new high-severity production advisory:
      on a scratch branch, pin `next` back to `16.2.12`, push a throwaway `vX.Y.Z-rcN` tag, and
      confirm `release.yml` stops at `verify` with the gate naming `GHSA-2xp9-vwfh-vxw4`, publishing
      no image. Because `build` never runs, `latest` is not moved — which is the guarantee being
      tested. Delete the tag and the branch afterwards. **This pushes a tag to the shared GitHub
      repository: ask the user before running it and do not proceed without an explicit yes.**
      → T011
      *Done when:* the run's `build` job shows as skipped, no image appears under
      `ghcr.io/dientuki/perceptor-*` for that tag, and the `audit` job's log names the advisory.
      *(AC-15)*

### Group 4 — verification and docs

- [ ] **T015** `[docs]` Update the root `CLAUDE.md`: add `bin/audit` to the § *Docker-first
      workflow* wrapper table, extend the CI note in § *Current state* to say `ci.yml` now runs an
      `audit` job gating production advisories at `high` or above against
      `tools/audit/allowlist.json`, and record the measured outcome (api 15 → 6 allowlisted, web
      4 → 0, worker 0 unchanged) plus the fact that `.github/dependabot.yml` watches five
      ecosystems. No pipeline stage changes status — do not touch the pipeline table. → T011
      *Done when:* `bin/audit` appears in the wrapper table and the `audit` job in the CI
      paragraph.

- [ ] **T016** `[docs]` **Deferred past this feature's merge, by GitHub's own behaviour.**
      Dependabot reads `.github/dependabot.yml` from the repository's **default branch** only, so
      AC-1, AC-2 and AC-3 become observable after the config reaches `master` through the normal
      flow (`dev` → `stage` → `master`), not when this branch merges to `dev`. Once it is there:
      confirm Insights → Dependency graph → Dependabot lists five configurations with no config
      error (*AC-1*), that the first PRs have `dev` as their base branch (*AC-2*), and that none of
      them touches a `ghcr.io/dientuki/perceptor-*` line in `docker-compose.yaml` (*AC-3*).
      → T006
      *Done when:* the three criteria are ticked, or recorded as still pending with the reason —
      never ticked on inference.

- [ ] **T017** `[docs]` Walk every acceptance criterion in `spec.md`, tick what was actually
      observed, and leave unticked what was not, with a one-line reason — a spec whose own record
      says "not run" is the project's only honest statement about whether a feature works. AC-1,
      AC-2 and AC-3 are expected to be unticked at merge time (T016's reason). Then set
      `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md`, `web/plan.md` and
      `infra/plan.md`. → T002, T005, T012, T013, T015
      *Done when:* every AC is either ticked or carries a reason, and all five files read
      `status: Implemented`.

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty
entry is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice. For this feature
the delta is an absence, so the shape of that report is "something made `services/api/src/schema.gql`
appear in the diff" — see `plan.md` § Contract Freeze.

---
title: Dependency Update Cadence — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-10-03
status: Approved
---

# PLAN: Dependency Update Cadence (`plan.md`)

## Approach

Three independent pieces, one of which gates the other two. The **floors** are two lockfile
operations with nothing clever about them: `api` gets a lockfile-only refresh that changes no
declared range and clears 9 of its 15 production advisories, and `web` gets one targeted version
move, `next` `16.2.12 → 16.3.8`, that clears all 4 of its own. The **cadence** is
`.github/dependabot.yml`. The **gate** is a plain Node script plus a JSON allowlist, run in CI as
its own job and reachable by a human through a `bin/` wrapper.

The gate deliberately reuses the pattern this repository already has twice over rather than adding
a tool. `services/web/scripts/check-messages.mjs` is the precedent for "a CI gate is a plain node
script that exits non-zero and names what is wrong", and `tools/site/build.mjs` + `bin/site`
(`084-landing-page-i18n`) is the precedent for "repo-root tooling lives in `tools/`, runs inside a
service image with the repo root bind-mounted, and gets a thin `bin/` wrapper so Article I holds for
a human". So: `tools/audit/check.mjs`, `tools/audit/allowlist.json`, `bin/audit` modelled line for
line on `bin/site`, and an `audit` job in `.github/workflows/ci.yml` modelled on the existing `site`
job, which likewise runs `node tools/...` directly on the runner with no `npm ci` in front of it.
`npm audit` reads `package.json` plus `package-lock.json` and needs no `node_modules`, which is what
makes a single fast job over all three services possible.

The real alternative was `audit-ci` or `better-npm-audit` as a devDependency in each of the three
services. Rejected on three counts: it is three new dependency trees to satisfy a requirement about
dependency trees; its allowlist formats carry an advisory id and nothing else, where **REQ-6**
demands a reachability argument and an expiry condition per entry and **REQ-9**/**AC-17** demand
those be enforced; and Article X asks for one shared 150-line script over three third-party tools
when the script is the smaller artifact. The cost of the choice is that `tools/audit/check.mjs` owns
the `npm audit --json` shape itself, which is the subject of the first risk below.

Two deliberate asymmetries between the two floors, both in the service plans and both load-bearing.
`api` uses `npm audit fix` and accepts whatever the lockfile resolver does, because it has 903 tests
and 62 suites to catch a regression. `web` must **not** use `npm audit fix` — it has zero test
files — so it moves exactly one declared version and the lockfile diff is reviewed for anything
outside `next`'s own subtree. And `web` keeps its exact pin style (`"next": "16.3.8"`, no caret),
matching how `next`, `react`, `react-dom`, `@biomejs/biome` and `babel-plugin-react-compiler` are
already pinned in `services/web/package.json`.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Lockfile-only refresh. Depends on nothing; produces the exact set of 6 survivors the allowlist must then match. |
| 2 | `web` | The `next` move. Depends on nothing. **Parallel with 1** — different lockfile, different image, no shared file. |
| 3 | `infra` | `.github/dependabot.yml`. Depends on nothing — the cadence is independent of today's floor. **Parallel with 1 and 2.** |
| 4 | `infra` | `tools/audit/check.mjs`, `tools/audit/allowlist.json`, `bin/audit`. Writable in parallel with 1–3, since the 6 allowlist entries are already measured and recorded in `spec.md` § AC-4. **Its verification is not parallel**: AC-10 (green gate, 6 honoured entries) can only be observed after 1 and 2 have landed. |
| 5 | `infra` | The `audit` job in `.github/workflows/ci.yml`. Gated on 4 — there is no point wiring CI to a script whose exit codes have not been exercised locally. |
| 6 | `[docs]` | Root `CLAUDE.md`: `bin/audit` in the wrapper table, the `audit` job in the CI note, a "Current state" line. Gated on 5. |

Steps 1, 2, 3 and the *writing* half of 4 are genuinely concurrent. Nothing in this feature crosses
the GraphQL boundary, so the usual "api first because it owns the contract" ordering does not apply;
what orders this feature instead is that **the gate is the last thing verified**, because a gate
verified before the floors drop is a gate verified red.

`[infra]` territory is extended for this feature, exactly as `084-landing-page-i18n` extended it
(see that feature's `tasks.md`, legend row 1): for `085` an `[infra]` task may also write inside
`tools/audit/`, `.github/dependabot.yml` and `.github/workflows/ci.yml`. `.claude/agents/infra.md`
names only `.github/workflows/release.yml` today; this plan is the per-feature grant, and
`release.yml` itself is **not** edited — **REQ-11** is satisfied by the chain that already exists
(`build` → `needs: verify` → `uses: ./.github/workflows/ci.yml`).

In-file comments: repo-root tooling in this repository is documented in-file —
`tools/site/build.mjs` opens with a 19-line header, and `bin/_docker.sh` and `docker-compose.yaml`
are heavily commented. Article XI's "no comments" is observed inside `services/*/src`, which this
feature does not touch. Match `tools/site/build.mjs`'s header convention for `tools/audit/check.mjs`
and `bin/site`'s for `bin/audit`.

## Contract Freeze

`spec.md`'s `## GraphQL Contract Delta` reads **"None — this feature does not cross the service
boundary."** and is frozen as of `status: Approved`. The freeze here is unusual in that its content
is an absence, so what an implementer must not do is additive:

- **`services/api/src/schema.gql` must not appear in the diff at all.** Not as a regeneration
  artifact either — nothing in this feature changes a decorator, so a boot that rewrites it means
  something else moved. If it shows up, stop and report rather than committing it.
- **No `extensions.i18n` key, and `services/web/messages/{en,es}.json` stays at 600 keys.** The gate
  speaks to a maintainer reading a workflow log, not to a user reading a screen. An implementer who
  adds a translated string for an audit failure has misread the audience.
- **No npm `overrides` block, in any service** (**NFR-2**). The temptation is concentrated and
  specific: `api`'s six survivors all vanish from the audit if `mariadb@^3.5.4` and
  `mysql2@^3.24` are forced into the nested tree, and the diff looks like a clean win. It is not
  one — `@prisma/adapter-mariadb` pins `mariadb: 3.4.5` exactly at every version it has ever
  published, so the override runs Prisma's adapter against a minor its author pinned away from, and
  the blast radius is the database connection layer. **NFR-3** records the two conditions that
  reopen this; neither holds today.
- **The gate's threshold is `high`, production-only.** An implementer who finds the `worker`'s
  critical `vitest` advisory and widens the gate to include dev dependencies has turned a cadence
  feature into a three-major test-runner migration, which `spec.md` § Out of Scope excludes by
  name.
- **`api`'s `package.json` is not edited** (**REQ-4**), and `web`'s is edited on exactly one line
  (**REQ-5**).

## Migrations

**None.** `services/api/prisma/schema.prisma` is untouched, no migration directory is created, and
`git status --short services/api/prisma` must be empty when this feature closes. Nothing is
reversible-by-migration because nothing is a migration; the whole feature reverts with
`git revert`, and the only state outside the repository is Dependabot's own PR queue on GitHub,
which deleting `.github/dependabot.yml` stops.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **`npm audit`'s non-zero exit conflated with "the audit failed"** — the feature's single worst silent failure | `npm audit` exits non-zero *whenever it finds anything*, which is almost always. A script that treats a non-zero child exit as "could not run" either fails forever (and gets deleted within a month, leaving the repo exactly where it started) or — the dangerous inversion — is written to tolerate the non-zero exit and then silently tolerates a genuine registry outage too, reporting a pass over an audit that never ran. No error anywhere; a green check that means nothing. | `check.mjs` must parse stdout as JSON and branch on **the parse**, never on the exit code: valid JSON with a `vulnerabilities` map is a completed audit regardless of exit status; anything else is a failed invocation and exits non-zero with its own distinct message. **AC-16** exercises exactly this with the registry unreachable, and it is the one AC that must be run before the job is wired into `ci.yml` (step 5), not after. |
| **`sharp`'s musl binaries dropped from `web`'s lockfile** | `sharp` is an optionalDependency with a per-platform binary; the lockfile today carries all 25 `@img/*` variants including `@img/sharp-linuxmusl-x64` and `@img/sharp-linuxmusl-arm64`, which are the only two the Alpine images can use and the only two that matter after `083` added arm64. Regenerating the lockfile from a context that resolves fewer optional packages drops them. `tsc --noEmit` passes, `next build` passes, the image builds — and then `next/image` fails at request time on poster URLs, in the published image only, possibly on one architecture only. | The install runs inside the `web` container (Article I), never on the host. The `web` slice carries an explicit assertion step: both `linuxmusl` entries present at `0.35.5` or later after the bump. **AC-6** names them and **AC-14** is the live pass over all six `next/image` call sites. |
| **`npm audit fix` smuggling unrelated bumps into `web`** | `web` has 0 test files. A transitive of `tailwind-merge`, `lucide-react`, `next-intl` or `@fullcalendar/*` moving as collateral surfaces as a visual or interaction regression that no command in this repository can detect. | `web` does not run `npm audit fix` at all — one targeted `npm install next@16.3.8`, then the lockfile diff is read and anything resolved outside `next`'s own subtree is reported, not committed silently. |
| **The allowlist outliving its reason** | An accepted advisory is a judgement about topology, not a property of the package. Nobody re-reads a JSON file that never fails. Six entries quietly become six unexamined risks, and the gate's green check certifies them. | **REQ-9**: an entry for an advisory the audit no longer reports fails the gate, so a fixed upstream forces the entry out. **REQ-6** + **AC-17**: an entry with an empty reachability argument is rejected rather than honoured, so the next person cannot add one by pattern-matching the shape. **REQ-10**: a green run prints the six, so they are visible to someone who never opens the file. |
| **`api`'s lockfile refresh breaking the database layer outside jest's reach** | Most of `api`'s 903 tests mock Prisma. A transitive that moves under `@prisma/*`, `mariadb` or `ioredis` can leave every suite green and still fail on the first real connection — which, because `api` migrates and seeds before `app.listen()`, presents as a container that never turns healthy rather than as an error anyone reads in a test report. | The `api` slice's *Done when* is not jest alone: bring the stack up, confirm `api` reaches healthy (so `prisma migrate deploy` and the production seed both ran against real MariaDB), and answer one real GraphQL query. |
| **Dependabot opening against the wrong branch** | Dependabot defaults to the repository's default branch. `master` and `stage` are protected against direct push and take changes only through the flow; PRs landing there are not merely noisy, they are unmergeable by the agreed model, and the queue looks "handled" while nothing moves. | **REQ-2** makes `target-branch: dev` explicit per ecosystem, and **AC-2** is observed on the first real PRs, not inferred from the config. |
| **Five ecosystems × weekly on a solo project** | A queue nobody reads is the cadence failing in its own terms. | Grouped updates: one PR per ecosystem per run for minor and patch, majors kept separate so they can be ignored individually; `open-pull-requests-limit` set deliberately rather than left at the default of 5 per ecosystem. The exact grouping is the `infra` slice's call and is tunable afterwards without a spec. |

## Verification

The repository is Docker-first, so the audit itself runs inside a container (Article I). The stack
running on this development host belongs to a **different** install — `bin/audit` uses
`docker compose run --rm --no-deps`, which creates a one-off container under *this* directory's
project and disturbs nothing. If `perceptor-web:local-dev` does not exist yet, `bin/build dev web`
first.

```bash
bin/build dev web

bin/audit                              # all three services; the gate as a human runs it
bin/audit api                          # one service

bin/cli api npx --no tsc --noEmit      # expect 0 errors
bin/npm api test                       # expect >= 903 tests / 62 suites green

bin/cli web npx --no tsc --noEmit      # expect 0 errors
bin/cli web node scripts/check-messages.mjs   # expect en/es parity at 600 keys

bin/stop                               # before the next line — see below
bin/npm web run build                  # expect exit 0

git status --short services/api/prisma  # expect empty
git diff --stat services/worker         # expect empty
git diff services/api/package.json      # expect empty
```

`bin/npm web run build` must **not** run while a dev stack is up for this checkout: `next build`
overwrites `.next`, which un-hydrates every page of the running dev server until the next
`next dev` rebuild (**NFR-7**).

The failure paths, which are the point of the gate and none of which CI will exercise for you:

```bash
# AC-8  — delete one allowlist entry, expect non-zero naming that advisory, then restore
# AC-9  — add a fabricated entry for an advisory no audit reports, expect non-zero "stale"
# AC-16 — run the gate with the registry unreachable, expect non-zero "audit failed", never a pass
# AC-17 — blank one entry's reachability argument, expect non-zero naming that entry
```

Then the manual pass:

1. `bin/dev -d`, wait for `api` to report healthy (`docker compose ps`) — this is the `api` slice's
   real gate: healthy means `prisma migrate deploy` and the production seed both completed against
   MariaDB on the refreshed lockfile. Sign in and load `/` to confirm one GraphQL round trip.
2. With the stack up, visit `/`, `/movies`, a film's detail page, `/shows`, open the user dropdown,
   and sign out to `/login` — the six `next/image` call sites (`MediaCard.tsx`, `Movie.tsx`,
   `Show.tsx`, `UserDropdown.tsx`, `IndexerSetupGuide.tsx`, `login/page.tsx`). Every poster renders,
   browser console clean (**AC-14**). This is the only check that catches a dropped musl `sharp`.
3. Push the branch. Confirm the `audit` job appears in CI and is green, and that its log lists the
   six honoured allowlist entries (**AC-10**, **REQ-10**).
4. On GitHub: Insights → Dependency graph → Dependabot shows five configurations with no config
   error (**AC-1**). When the first PRs arrive, confirm their base branch is `dev` (**AC-2**) and
   that none of them touches a `ghcr.io/dientuki/perceptor-*` line in `docker-compose.yaml`
   (**AC-3**).
5. **AC-15** needs a scratch branch and a throwaway `-rcN` tag: pin `next` back to `16.2.12`, push
   the tag, confirm `release.yml` stops at `verify` and publishes no image. Delete the tag
   afterwards — every tag, RC or final, moves `latest` while the project is in closed alpha.

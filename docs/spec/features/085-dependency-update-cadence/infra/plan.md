---
title: Dependency Update Cadence — infra slice
service: infra
last_updated: 2026-10-03
status: Approved
---

# PLAN: Dependency Update Cadence — `infra` (`infra/plan.md`)

## Scope

The cadence and the gate — everything in this feature that is not a lockfile. Four deliverables:
`.github/dependabot.yml` (`REQ-1`–`REQ-3`), `tools/audit/allowlist.json` (`REQ-6`),
`tools/audit/check.mjs` plus `bin/audit` (`REQ-7`–`REQ-10`), and an `audit` job in
`.github/workflows/ci.yml` (`REQ-11`, satisfied transitively — `release.yml` is **not** edited).

**Territory grant.** `.claude/agents/infra.md` lists `.github/workflows/release.yml` and says
nothing about `tools/` or `.github/dependabot.yml`. For this feature that territory is extended
exactly as `084-landing-page-i18n` extended it (see that feature's `tasks.md`, legend row 1): an
`[infra]` task on `085` may also write inside `tools/audit/`, `.github/dependabot.yml` and
`.github/workflows/ci.yml`. Nothing else changes — `release.yml`, `install.sh`,
`docker-compose*.yaml`, `.env.example` and the five `Dockerfile`s are all untouched by this feature,
and nothing under `services/*/src`, `services/*/prisma`, `services/*/package.json` or any
`package-lock.json` is yours. The two lockfile floors are the `api` and `web` slices' work; if the
gate is red because a floor has not landed yet, that is the expected order (`../plan.md` § Order of
Work, step 4), not something to fix from here.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `.github/dependabot.yml` | New | Five update configurations: npm × 3 service dirs, `github-actions`, `docker` |
| `tools/audit/check.mjs` | New | The gate: runs `npm audit --json --omit=dev` per service, reconciles against the allowlist, exits non-zero with a reason |
| `tools/audit/allowlist.json` | New | The six accepted `api` advisories, each with its reachability argument and reopen condition |
| `bin/audit` | New | Thin wrapper so a human runs the gate through a container (Article I) |
| `.github/workflows/ci.yml` | Modified | One new `audit` job, alongside `api`/`web`/`worker`/`site` |

Root `CLAUDE.md` is **not** yours — it is a `[docs]` task for the orchestrator (`../plan.md` § Order
of Work, step 6).

## Existing code to reuse

This slice adds no new pattern to the repository. Every piece has a precedent to copy, and copying
it is the point:

- `bin/site` — the exact shape `bin/audit` must take: `set -e`, `cd "$(dirname "$0")/.."`, source
  `bin/_docker.sh` and call `require_docker` (mandatory — `082-docker-engine-preflight` made this
  the first thing every wrapper does), refuse with a Spanish message if `.env` is missing,
  `set -a; . ./.env; set +a`, then
  `docker compose $COMPOSE_FILES run --rm --no-deps --user "$(id -u):$(id -g)" -v "$(pwd):/repo" --workdir /repo --entrypoint node web tools/audit/check.mjs "$@"`.
  The whole repo root is bind-mounted, not just one service, because the script reads all three
  services' manifests — the same reason `bin/site` mounts the root.
- `tools/site/build.mjs` — the house style for a repo-root Node script: a header paragraph stating
  what it does and that it runs through its `bin/` wrapper, `node:` imports, `repoRoot` derived from
  `import.meta.url`, and a non-zero exit that *names the offending key* rather than printing a
  generic failure. Article XI's "no comments" governs `services/*/src`; repo-root tooling in this
  repository is documented in-file, and `build.mjs` is the reference for how much.
- `services/web/scripts/check-messages.mjs` — the precedent for the gate's output shape: a parity
  check that prints exactly what is missing and exits non-zero. `build.mjs`'s own header points at
  it for the same reason.
- `.github/workflows/ci.yml`'s `site` job — the template for the new `audit` job: `ubuntu-latest`,
  `actions/checkout@v5`, `actions/setup-node@v5` with `node-version: ${{ env.NODE_VERSION }}`, **no
  `npm ci`**, then a single `node tools/...` step. `npm audit` reads `package.json` plus
  `package-lock.json` and needs no `node_modules`, which is what keeps this one job fast enough to
  cover all three services.
- `.github/workflows/release.yml` — read it, do not edit it. `build` declares `needs: verify` and
  `verify` is `uses: ./.github/workflows/ci.yml`, so a job added to `ci.yml` is inside the release
  gate automatically. That chain *is* `REQ-11`; `AC-11` verifies it by reading the two files.

## Steps

1. `.github/dependabot.yml`. Five configurations. `npm` at `/services/api`, `/services/web`,
   `/services/worker`; `github-actions` at `/`; `docker` with a single `directories:` list covering
   `/services/api`, `/services/web`, `/services/worker`, `/services/torrent`, `/services/indexer`
   and `/` (the last for `docker-compose.yaml`). Every configuration carries
   `target-branch: "dev"` (`REQ-2` — `master` and `stage` are protected against direct push and
   take changes only through the flow). The `docker` configuration carries an `ignore` for
   `ghcr.io/dientuki/perceptor-*` (`REQ-3`): those are this project's own images, versioned by
   `PERCEPTOR_TAG` per installation, and pinning one to a concrete tag would break the
   published-images install path. Set `open-pull-requests-limit` and a `groups` block deliberately
   rather than inheriting the default of 5 per ecosystem — minor and patch grouped per ecosystem,
   majors left separate so one can be ignored without ignoring the rest (`../plan.md` § Risks, last
   row). Weekly for npm and `github-actions`; monthly is defensible for `docker`, where a MariaDB or
   Redis major is a data-migration question rather than a bump.
2. `tools/audit/allowlist.json`. Six entries, exactly the ones in `../spec.md` § AC-4. Three are
   leaf packages carrying advisory identifiers — `deepmerge-ts` (`GHSA-ggr8-5vv4-36mx`), `mariadb`
   (`GHSA-cqhc-2h57-wpxf`, `GHSA-42r5-vhpq-m858`, `GHSA-g5xc-5w98-jfvm`) and `mysql2`
   (`GHSA-3f6p-5ww8-9rcr`, `GHSA-rgwj-5xj2-c3m3`) — and three are the parents npm counts beside
   them, which carry no advisory of their own and are identified by the package they pull in:
   `@prisma/config` (via `deepmerge-ts`), `prisma` (via `@prisma/config` and `mysql2`) and
   `@prisma/adapter-mariadb` (via `mariadb`). The schema must therefore hold both kinds. Every entry
   carries the service, the package, the version range, the severity, the date accepted
   (`2026-10-03`), a non-empty reachability argument, and the condition that reopens it — the
   arguments are written out in `../spec.md` § NFR-3 and are transcribed, not reinvented.
3. `tools/audit/check.mjs`. For each of `api`, `web`, `worker`: run `npm audit --json --omit=dev`
   with that service directory as cwd, and **branch on parsing stdout, never on the child's exit
   code** — `npm audit` exits non-zero whenever it finds anything, so the exit code says nothing
   about whether the audit ran. Valid JSON carrying a `vulnerabilities` map is a completed audit;
   anything else is a failed invocation and exits non-zero with a message that says the audit
   failed. This is the feature's worst silent failure (`../plan.md` § Risks, row 1) and `AC-16`
   exists for it. Then reconcile:
   - a reported vulnerability at `high` or `critical` with no allowlist entry → **fail**, naming the
     advisory identifier and the package (`REQ-8`);
   - a reported vulnerability at `moderate` or below with no entry → print, do not fail (`REQ-7`
     sets the threshold at `high`; npm reports `@prisma/adapter-mariadb` itself as `moderate`, which
     is why the allowlist holds six entries while only five are gate-blocking);
   - an allowlist entry matching nothing the audit reports → **fail** as stale (`REQ-9`);
   - an allowlist entry whose reachability argument is empty or missing → **fail**, naming the
     entry, rather than honouring it (`REQ-6`, `AC-17`);
   - everything reconciled → pass, printing the honoured entries (`REQ-10`).
   An optional positional argument narrows the run to one service (`bin/audit api`); no argument
   runs all three. Nothing is added to any service's `dependencies` (`NFR-4`) — this is a plain
   script with `node:` imports only.
4. `bin/audit`, per `bin/site` above. `chmod +x`.
5. Exercise all four exit paths locally **before** step 6. `AC-8` (entry deleted → fails naming the
   advisory, restored → passes), `AC-9` (fabricated entry → fails as stale), `AC-16` (registry
   unreachable → fails saying the audit failed, never a pass), `AC-17` (blank argument → fails
   naming the entry). Wiring an unexercised script into CI is how the one risk above reaches
   `master`.
6. The `audit` job in `.github/workflows/ci.yml`, per the `site` job's shape. `AC-10` (green with
   the six honoured, after the `api` and `web` floors land) and `AC-11` (the `release.yml` chain,
   verified by reading) close the slice.

## Contract obligations

`../spec.md` § GraphQL Contract Delta reads **"None — this feature does not cross the service
boundary."** This slice is the one most likely to be tempted across it, in one specific way: the
gate's failure messages are **English, log-facing, and carry no `extensions.i18n` key**. They are
read by a maintainer in a workflow log, not by a user on a screen, so they are not user-facing copy
and the Article VI carve-out does not apply to them. `services/web/messages/{en,es}.json` stays at
600 keys and nothing is added to `services/api/src/i18n/`.

The one user-facing exception is `bin/audit`'s own refusals — a missing `.env`, a stopped Docker
engine — which follow the existing wrapper convention: Spanish for what a human operator reads
interactively, matching `bin/site` and `bin/_docker.sh`.

The delta is read-only. If it is wrong, stop and report — do not adapt it locally.

## Tests

There is no typecheck and no linter for `bin/` or `tools/`, and this slice adds no test file. The
gate is itself the test — but it is a test that can lie, which is where Article IX lands here:

- **`tools/audit/check.mjs`'s exit-code handling is the one unit in this feature whose failure is
  genuinely silent.** A script that misreads `npm audit`'s non-zero exit either fails forever (and
  gets deleted within a month, leaving the repository exactly where it started) or — the dangerous
  inversion — tolerates a registry outage and reports a pass over an audit that never ran. Nothing
  errors; CI is green; the gate means nothing. Step 5 is the test, and it is a real-execution test
  by necessity rather than a `.spec.ts`: the behaviour under test is how a child process' stdout and
  exit status interact, which is exactly what a mock would assume rather than verify. `AC-16` must
  be observed, not reasoned about.
- `.github/dependabot.yml` cannot fail silently in the same way: a malformed file shows as a config
  error in GitHub's Dependabot view (`AC-1`), and a wrong `target-branch` shows as the base branch
  of the first real PR (`AC-2`). Both are observed, not inferred.

## Done when

```bash
bin/build dev web          # bin/audit runs in the web image; needed once if it is absent
bin/audit                  # all three services; exit 0, printing the six honoured entries
bin/audit api              # one service; 6 vulnerabilities, all allowlisted
bash -n bin/audit          # parses
```

The four failure paths of step 5, each confirmed by running it and reading the real output. Paste
the output in the report — "it fails correctly" is not a result.

Then, after the `api` and `web` floors have landed: push the branch, confirm the `audit` job is
green in CI and that its log lists the six honoured allowlist entries (`AC-10`), and confirm by
reading `release.yml` and `ci.yml` that `build` → `needs: verify` → `uses: ./.github/workflows/ci.yml`
puts the new job inside the release gate (`AC-11`).

On GitHub, once the branch is merged to `dev`: Insights → Dependency graph → Dependabot lists five
configurations with no config error (`AC-1`), the first PRs target `dev` (`AC-2`), and none touches a
`ghcr.io/dientuki/perceptor-*` line in `docker-compose.yaml` (`AC-3`).

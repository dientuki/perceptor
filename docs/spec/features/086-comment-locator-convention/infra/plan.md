---
title: Comment Locator Convention — infra slice
service: infra
last_updated: 2026-10-03
status: Implemented
---

# PLAN: Comment Locator Convention — `infra` (`infra/plan.md`)

## Scope

You build the validator the whole feature rests on, and later the CI job that keeps it honest. You
do **not** sweep a single comment: the three service agents own everything under
`services/*/src`, and the orchestrator owns `CLAUDE.md`, `docs/constitution.md` and
`docs/spec/history.md`.

Your territory for this feature is `bin/` plus two per-feature grants, in the precedent
`084-landing-page-i18n` set for `tools/site/` and `085-dependency-update-cadence` set for
`tools/audit/`: **`tools/comments/` and `.github/workflows/ci.yml`**, which no agent owns by
default. `.github/workflows/release.yml` you **read** and never edit — it already declares
`needs: verify` against `ci.yml`, so your new job lands inside the release gate without touching it.

Your work splits across two steps of `../plan.md` § Order of Work, and the gap between them
matters: **step 2 builds the validator and it is expected to exit non-zero.** A tree nobody has
swept has roughly 700 Spanish comment lines and 613 malformed references in it. That red run is the
worklist the three sweeps consume, and it is your deliverable, not a failure. The `ci.yml` job
comes later, in step 4, only after the tree is at zero.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `tools/comments/check.mjs` | New | The validator: walks `services/{api,web,worker}/src`, extracts comments, applies the four rules, exits non-zero naming file, line and rule. |
| `tools/comments/check.spec.mjs` | New | The detector's own test (NFR-5). See § Tests — it is not a Jest suite; there is no test runner at the repo root. |
| `bin/comments` | New | Wrapper, modelled line for line on `bin/audit`. |
| `.github/workflows/ci.yml` | Modified | One new `comments` job beside the existing `site` and `audit` jobs. Step 4 only. |

## Existing code to reuse

- `tools/audit/check.mjs` (`085`) — the house style for a repo-root validator: plain ESM, `node:fs`
  only, no dependency, resolves `repoRoot` via `fileURLToPath(import.meta.url)`, optional first
  positional argument naming one service, accumulates into a `hadFailure` flag and prints every
  finding before exiting rather than dying on the first. Follow all of it, including printing a
  `PASS`/`FAIL` summary line. Do **not** copy `tools/audit/allowlist.json` or anything that reads
  it: NFR-4 forbids a suppression file.
- `services/web/scripts/check-messages.mjs` (`018`) — the smaller precedent, and the one whose
  output format to match on success: `OK: … (N keys).` with the count. Yours prints the number of
  locators it resolved (REQ-6).
- `bin/audit` — copy it. Same `require_docker`, same `.env` guard, same
  `docker compose run --rm --no-deps --user "$(id -u):$(id -g)" -v "$(pwd):/repo" --workdir /repo
  --entrypoint node web tools/comments/check.mjs "$@"`. The whole repo root is bind-mounted, not
  one service, because the script reads all three services **and** `docs/spec/features/`.
- `.github/workflows/ci.yml`'s `site` and `audit` jobs — your job is the same three steps:
  `actions/checkout@v5`, `actions/setup-node@v5` with `${{ env.NODE_VERSION }}`, then one
  `node tools/comments/check.mjs`. No `npm ci`: the script has no dependency.

## Steps

1. `tools/comments/check.mjs`. Walk `services/{api,web,worker}/src` recursively for `*.ts` and
   `*.tsx`. Extract comments — `//` to end of line, and `/* … */` including its `*` continuation
   lines. You must not treat a `//` inside a string literal or a regex as a comment; the cheap,
   sufficient rule is to scan each line left to right tracking quote state (`'`, `"`, `` ` ``) and
   take the first unquoted `//`. Getting this wrong flags `const url = 'http://…'` as a comment.

2. The four rules, each reported with `file:line` and the rule that fired, all findings printed
   before exiting (REQ-6):
   - **Spanish.** A comment containing Spanish fails. Detection is specified in step 3.
   - **Malformed reference.** A comment containing `REQ-n`, `NFR-n`, `AC-n` or `Tnnn` in any
     spelling other than `Spec NNN, <ref>[ <ref>…]`, with `;` between specs, fails. The message
     prints REQ-1's grammar (AC-5).
   - **Dangling spec.** `Spec NNN` with no `docs/spec/features/NNN-*/` directory fails, saying so
     (AC-3).
   - **Dangling id.** `REQ-n`/`NFR-n`/`AC-n` that does not appear in that directory's `spec.md`
     fails, naming the resolved path (AC-4). `Tnnn` resolves against `tasks.md` instead, and a
     feature directory with no `tasks.md` makes the reference fail rather than be skipped — see
     `../plan.md` § Risks, row 5.

3. The Spanish detector, and its two hard constraints. **Strip every quoted run — `'…'`, `"…"`,
   `` `…` `` — out of the comment text before testing.** Two comments in the tree today are English
   Article IX test headers that quote Spanish user-facing copy, and both must pass:
   `services/api/src/auth/test/auth-error-keys.spec.ts:213` quotes `'No autenticado'` and
   `'Tu sesión expiró, iniciá sesión de nuevo'`; `services/api/src/languages/languages.service.spec.ts:360`
   quotes `Español` inside an English sentence. The trigger set is the Spanish accent and
   punctuation characters (`á é í ó ú ñ ü ¿ ¡` and their capitals) plus Spanish function words that
   are **not** also English words. Exclude the ambiguous ones — `no`, `la`, `son`, `si`, `me`, `van`,
   `ten` are all English — and accept false negatives over false positives: a missed Spanish comment
   is debt, a false positive is a broken build on someone else's branch.

4. REQ-1b's two-context rule. Inside a comment that is an Article XI exception-2 test header or an
   exception-3 security-guard doc comment, a reference is normalized in place and the surrounding
   prose is legal; everywhere else the comment must be the locator alone. You cannot detect "is a
   security guard" from the text, so detect the context structurally: a comment immediately
   preceding a `describe(` in a `*.spec.ts` file is a test header, and a comment is exception-3
   only when the file:line pair appears in a short list you hardcode — today that list has one
   entry, `services/api/src/media-roots/media-roots.service.ts`'s `resolveFromRoot` neighbourhood.
   A hardcoded list of one is correct here and an allowlist is not: this names where an
   *already-sanctioned* exception lives, it does not excuse a violation.

5. REQ-7's tolerance, which is the rule most likely to be got wrong: **an English comment carrying
   no spec reference passes.** There are ~5,000 of them. A validator that fails on them is
   unmergeable the day it lands. Verify this deliberately with AC-6 before you call the script done.

6. `tools/comments/check.spec.mjs` (see § Tests), then `bin/comments`, `chmod +x`.

7. Run `bin/comments` against the unswept tree and **paste the real output** — the finding count
   per service and a sample of each rule firing. Report the counts: they are the three sweeps'
   worklists and the orchestrator hands them to the service agents.

8. Exercise all five failure paths for real, by appending each line in `../plan.md` § Verification
   to a file under `services/api/src`, running `bin/comments`, and reverting. Paste the actual
   output of each. AC-6 must come back clean while the other four come back non-zero.

9. **Step 4 of the order of work, after the three sweeps land:** add the `comments` job to
   `.github/workflows/ci.yml`. Then confirm by reading `release.yml` and `ci.yml` that `build`
   declares `needs: verify` and `verify` is `uses: ./.github/workflows/ci.yml`, so a tag cannot
   publish past the new job (REQ-8, AC-8). Do not edit `release.yml`.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **None** — you consume and expose no GraphQL. Your
contract is with humans and with the other three agents, and it has one clause: the validator's
**message text is the specification an implementer reads at 3am.** A finding that says
`invalid comment` teaches nothing. Each one names the file, the line, the rule that fired, and for
a malformed reference the grammar it violated. For a resolved locator, print the first line of the
requirement it points at — `../plan.md` § Risks, row 1 depends on that output being readable, since
it is how a human spot-checks a locator the validator can only prove *exists*.

## Tests

There is no test runner at the repo root — `jest` lives inside `api` and `worker`, and `tools/` has
never had a suite. `tools/comments/check.spec.mjs` is therefore a plain `node`-runnable script in
the shape of the thing it tests: a list of fixture comment strings with their expected verdict, run
with `node tools/comments/check.spec.mjs`, printing failures and exiting non-zero. Export the
detector and the reference parser from `check.mjs` so the fixtures can call them directly.

It opens with the Article IX header naming what it defends against, and it is owed because the
failure is silent in both directions:

- `tools/comments/check.spec.mjs` — defends against a Spanish detector nobody can reproduce. A rule
  that drifts broad fails honest English comments and gets the gate disabled; a rule that drifts
  narrow passes Spanish and the debt regrows with a green check mark on it. The fixtures must
  include, verbatim, the two real lines named in step 3 (quoted Spanish inside English prose, both
  expected to **pass**), one plain Spanish comment expected to fail, and one comment containing
  only the ambiguous words that are also English, expected to pass.

Add the script to the `comments` CI job as a second `run:` step, so a change to the detector cannot
land without its fixtures passing.

## Done when

```bash
bin/comments                     # step 2: non-zero, with the per-service finding counts
node tools/comments/check.spec.mjs   # through bin/comments' own image, or bin/cli web node …
bash -n bin/comments
bin/comments api                 # the one-service form works

# step 4, after the sweeps:
bin/comments                     # 0, printing the count of resolved locators
```

Plus the five appended failure lines of `../plan.md` § Verification, each run for real with its
output pasted, and `git diff --stat services/` empty — you touch no service file.

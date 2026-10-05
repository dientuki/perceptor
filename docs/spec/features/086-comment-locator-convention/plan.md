---
title: Comment Locator Convention — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-10-03
status: Implemented
---

# PLAN: Comment Locator Convention (`plan.md`)

## Approach

The feature has four moving parts and only one of them is code: an amendment, a validator, three
comment sweeps, and a documentation edit. The shape that makes it safe is **the validator exists
before any sweep begins**, and is allowed to be red for the duration. An agent sweeping a service
with no way to check its own work produces a diff nobody can verify; an agent sweeping against a
validator that already tells it which lines are wrong produces a worklist.

`tools/comments/check.mjs` is built in the mould of `tools/audit/check.mjs`
(`085-dependency-update-cadence`) and `services/web/scripts/check-messages.mjs`
(`018-ui-i18n`): a plain ESM script run with `node`, no framework, no build step, reading files and
exiting non-zero with a message that names the file, the line and the rule. `bin/comments` is
`bin/audit` copied almost verbatim — `docker compose run --rm --no-deps` into the `web` image with
the repo root bind-mounted, since the script reads all three services plus
`docs/spec/features/` (Article I). Nothing new is invented at the tooling layer, and
`tools/audit/allowlist.json` is deliberately **not** copied: NFR-4 forbids a suppression file,
because an exemption list is the "leave it for later" clause this feature exists to retire.

The sweeps themselves are not a `sed` pass. 497 of the 613 existing ad-hoc references carry no
spec number on their line (`api` 348, `worker` 110, `web` 39) — a bare `REQ-3` that is
unresolvable by reading. They **are** resolvable mechanically, and this is the plan's central
technique: every one of those lines was written by a commit, and this repository's commits are
named `implement NNN spec, <slug>`. `git blame -L <line>,<line> --porcelain <file>` on
`importFileModal.tsx:167` returns `summary try to implement 010 episode acquisition spec`, which is
exactly the `Spec 010, NFR-1` that a hand grep through eighty-five `spec.md` files also produced.
Resolution is therefore `git blame` first, the spec's own text second (confirm the id exists and
describes this code), and **deletion under REQ-4 third** — never inference from vibes. An agent
that cannot produce the blame line and the requirement sentence deletes the comment instead of
inventing a locator, because a locator pointing at a real spec and a real id that has nothing to do
with the code is worse than the Spanish comment it replaced: it is wrong *and* it looks
authoritative, and no validator can ever catch it.

The alternative considered and rejected was translating in place, which is what Article VI's
carve-out literally asks for. It fails on its own terms: an English paragraph where the Spanish one
was still violates Article XI, so the work would have to be done twice, and the second pass would
face the same 497 unresolvable references with one less reason to be undertaken.

Two per-feature territory grants, following the precedent `084-landing-page-i18n` set for
`tools/site/` and the `site` job and `085-dependency-update-cadence` set for `tools/audit/`:
`[infra]` owns `tools/comments/` and `.github/workflows/ci.yml` for this feature.
`.github/workflows/release.yml` is read, never edited — it already declares
`needs: verify` against `ci.yml`, so the new job sits inside the release gate for free.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `[docs]` | The Article XI amendment. Until it lands, every locator the sweeps write is itself a violation of the constitution as written. Through `/constitution`, bumping to `1.3.0`. |
| 2 | `[infra]` | `tools/comments/check.mjs` + `bin/comments`. **Expected to exit non-zero** on a tree nobody has swept — that red run, with its ~700 Spanish findings and 613 malformed references, *is* the worklist the three sweeps consume. No CI job yet. |
| 3 | `[api]` `[web]` `[worker]` | The three sweeps, genuinely in parallel: no shared file, no contract between them, and each verifies itself with `bin/comments <service>`. |
| 4 | `[infra]` | The `comments` job in `ci.yml`, added only once step 3 has the tree at zero. Adding it earlier makes every intermediate commit red and teaches everyone to ignore it. |
| 5 | `[docs]` | `docs/spec/history.md`, the `CLAUDE.md` edits, the wrapper-table row for `bin/comments`. Last because REQ-11's cadence sentence has to describe tooling that exists. |

Step 3's three slices are the only ones that overlap, and they overlap completely. Steps 1, 2, 4
and 5 are strictly serial: each one's input is the previous one's output.

## Contract Freeze

`spec.md` § GraphQL Contract Delta says **None**, and that is the frozen fact: this feature adds no
GraphQL surface and changes no resolver, type, field or error condition. The thing implementers
will be tempted to change is not the contract but the grammar, so it is frozen on the same terms:

- **`// Spec NNN, <ref>` and nothing else on the line.** An agent mid-sweep will find a comment
  whose rationale genuinely does not fit in a locator and will want to keep "just one clause" of
  prose. That clause is how the no-prose rule dies in the first week. The options are the locator,
  deletion (REQ-4), or — if the lost rationale describes a failure that produces no error anywhere
  — a test under Article IX. Not a fourth thing.
- **REQ-1b is narrow on purpose.** Inline prose around a reference survives *only* inside an
  Article XI exception-2 test header or an exception-3 security-guard doc comment. The guard at
  `services/api/src/media-roots/media-roots.service.ts:57` is the one that exists today. A method
  that merely feels important is not a guard: `toHostPath()` three methods above it keeps no
  comment.
- **No allowlist.** If the gate is too strict to land, the gate's rule is wrong and gets amended in
  `spec.md`; it does not get a file of exceptions (NFR-4).
- **English comments without a spec reference stay.** REQ-7 is not a loophole an agent should feel
  bad about — it is what keeps the gate green on the day it lands, with ~5,000 of them in the tree.
  An agent that "helpfully" sweeps those too produces a diff an order of magnitude larger than the
  one this spec approved.

## Migrations

**None.** No Prisma model, field, enum or migration (NFR-3). `git status --short
services/api/prisma` and `git diff services/api/src/schema.gql` are both empty at the end, and
either one being non-empty means a sweep touched code.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **A plausible but wrong locator.** The headline risk. An agent resolves a bare `REQ-3` by picking a spec that looks related; `REQ-3` exists in that spec, so the validator passes. | Completely silent, and worse than the original: a future reader follows the pointer, reads an unrelated requirement, and changes the code to match it. No test, no typecheck and no gate can detect it — the validator only proves the id exists. | Resolution is mechanical and auditable, not inferential: `git blame -L` → the `implement NNN spec` commit → confirm the id's sentence in that `spec.md` actually describes this code. Every service plan requires the agent to **report a table** of each replaced comment with its blame commit and the requirement sentence it resolved to; the orchestrator spot-checks the table against the diff before committing. Unresolvable ⇒ delete (REQ-4), never guess. The validator prints each resolved requirement's first line beside the locator so the table can be checked by reading. |
| **A code change smuggled inside a comment diff.** An agent reformats a line, drops a `?.`, or deletes a line of code along with the comment block above it. | `tsc` catches a type error, but a behaviour change inside a correctly-typed line produces no error anywhere — and nobody reviews a 700-line comment diff closely enough to see it. | NFR-1/NFR-2 verification is mechanical: `git diff -U0` filtered to non-comment added/removed lines must come back empty, and each surviving hunk must be a trailing-comment removal whose code half is byte-identical. Plus AC-9's parity: identical test counts and 0 typecheck errors on all three services. One commit per service keeps each diff readable. |
| **The Spanish detector flags an English comment that quotes Spanish user-facing copy.** Two confirmed cases in the tree today: `services/api/src/auth/test/auth-error-keys.spec.ts:213` (an English test header quoting `'No autenticado'` and `'Tu sesión expiró, iniciá sesión de nuevo'`) and `services/api/src/languages/languages.service.spec.ts:360` (English prose quoting `Español`). | Not silent — it fails loudly — but it fails *in CI, on someone else's branch*, and the obvious fix is to delete a legitimate Article IX test header or mangle the quoted copy. That is a real regression caused by the gate. | The detector excludes anything inside a quote (`'…'`, `"…"`, `` `…` ``) before testing for Spanish. Both lines above are named in `infra/plan.md` as required fixtures of the detector's own test (NFR-5), so the rule cannot be dropped later without a test going red. |
| **The detector's heuristic is unreproducible.** A word list nobody can see turns a blocking gate into folklore; an over-broad list (`no`, `la`, `son`, `si` are all English words too) fails honest comments. | Either direction ends with the gate being disabled rather than fixed. | NFR-5 requires the rule and its trigger list to live in the detector's test, with the test naming the failure it prevents (Article IX). The list is accent characters plus Spanish function words that are **not** English words — the ambiguous ones are excluded by design, accepting false negatives over false positives, since a missed Spanish comment is debt and a false positive is a broken build. |
| **`Tnnn` references resolve against the wrong file.** `REQ`/`NFR`/`AC` ids live in `spec.md`; task ids live in `tasks.md`, which not every feature directory has. | A locator naming a task that does not exist reads as authoritative and points nowhere. | The validator resolves `Tnnn` against that feature's `tasks.md` and rejects the reference when the file is absent, rather than skipping the check for ids it cannot verify. |
| **The sweep's deletions lose a real piece of knowledge.** REQ-4 deletes what no spec covers, and `services/worker/src/ffmpeg/runner.ts:100` (Docker signals `SIGTERM`, not `SIGINT`; the old runner listened on `SIGINT` alone and a `docker compose stop` orphaned ffmpeg) is exactly that: true, load-bearing, and in no spec. | An orphaned ffmpeg after `docker compose stop` burns a core with the container gone and no log line anywhere — the Article IX failure class precisely. | REQ-4 makes the test the replacement, not the deletion the end of it. `worker/plan.md` names this line and owes a test for it. Third-party behaviour that has a public URL keeps the URL (Article XI exception 1), which is how `process-queue.service.ts`'s BullMQ job-id constraint survives. |

## Verification

```bash
bin/comments                      # 0, printing the count of resolved locators (AC-1)
bin/comments api                  # one service at a time, same contract

bin/cli api npx --no tsc --noEmit
bin/npm api run test
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs

git status --short services/api/prisma            # empty (NFR-3, AC-10)
git diff services/api/src/schema.gql              # empty (NFR-3, AC-10)
grep -n "eleven rules" CLAUDE.md                  # nothing (REQ-9, AC-11)
grep -c '^## Article' docs/constitution.md        # 12, and CLAUDE.md agrees
```

The code-change guard for NFR-1/NFR-2, run per service before the commit:

```bash
git diff -U0 -- 'services/api/src/**/*.ts' \
  | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vE '^[+-]\s*(//|/\*|\*)'
```

Anything it prints is a line where code moved, and every surviving hunk must be a trailing-comment
removal whose code half is byte-identical before and after. A hunk that is anything else is a
stop-and-report.

The failure pass, which is where this feature is actually proven (AC-2 to AC-6b). Append each of
these to a file under `services/api/src`, run `bin/comments`, and revert:

```
// esto arranca el encode cuando el torrent ya bajó      -> non-zero, names file:line   (AC-2)
// Spec 999, REQ-1                                        -> non-zero, "no 999-* dir"   (AC-3)
// Spec 048, REQ-99                                       -> non-zero, "REQ-99 not in 048-shorts-category/spec.md" (AC-4)
// per 018-ui-i18n REQ-7, the key survives                -> non-zero, malformed, prints the grammar (AC-5)
// the guard runs before the first write                  -> 0, English, no reference    (AC-6)
```

Then the CI pass (AC-8): push a branch carrying the AC-2 comment, confirm the `comments` job fails
and that `release.yml`'s `build`/`merge` do not run behind the failed `verify`.

Then the documentation pass (AC-11, AC-12, AC-13): `docs/spec/history.md` exists and holds every
measurement that was in `CLAUDE.md`'s `## Current state`; what replaces that section is 15 lines or
fewer and the commands it names run as written; Article XI shows four exceptions and no "leave them
until you are editing that code" sentence; the Changelog has a `1.3.0` row.

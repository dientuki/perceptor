---
title: Comment Locator Convention — Tasks
last_updated: 2026-10-03
status: In Progress
---

# TASKS: Comment Locator Convention (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[infra]` | Repo-root territory. **For this feature it also covers `tools/comments/` and `.github/workflows/ci.yml`**, which no agent owns today — the same per-feature grant `084-landing-page-i18n` used for `tools/site/` and the `site` job, and `085-dependency-update-cadence` for `tools/audit/` (see `infra/plan.md` § Scope). `.github/workflows/release.yml` is read, never edited. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Two rules cut across every task in Groups 2 and 3, and an agent that breaks either one has failed
the task regardless of what `bin/comments` says:

1. **Resolution is mechanical, never inferred.** `git blame -L <line>,<line> --porcelain <file>`
   → the `implement NNN spec` commit → confirm the id's sentence in that `spec.md` describes this
   code → write `// Spec NNN, <ref>`. If either step fails, **delete the comment** (REQ-4).
   Every sweep task reports a resolution table: `file:line`, blame commit subject, locator written,
   first line of the requirement it points at (`plan.md` § Risks, row 1).
2. **No production code changes.** Before reporting, run the guard from `plan.md` § Verification and
   account for every line it prints; each surviving hunk must be a trailing-comment removal whose
   code half is byte-identical.

The orchestrator commits each service's sweep as **one commit** (NFR-2). Agents do not commit.

## Tasks

### Group 1 — the amendment

Nothing else can start. Until Article XI admits the locator, every line the sweeps write violates
the constitution as written, and an agent reading `docs/constitution.md` mid-sweep would be right to
stop.

- [x] **T001** `[docs]` Amend `docs/constitution.md` through `/constitution`: add the REQ-1
      locator as Article XI's fourth exception, with REQ-1b's narrowing (inline prose around a
      reference is legal only inside an exception-2 test header or an exception-3 guard doc
      comment). Retire Article XI's "leave them until you are editing that code for another reason"
      sentence and Article VI's matching Spanish-comment carve-out — this feature discharges both.
      Update Article XI's **Check** line to name the fourth case, bump `version` to `1.3.0`,
      `last_amended` to today, and append a Changelog row naming this spec.
      *Done when:* `sed -n '/^## Article XI/,/^## Article XII/p' docs/constitution.md` shows four
      numbered exceptions and no "leave them until you are editing" sentence;
      `grep -n '1.3.0' docs/constitution.md` returns both the frontmatter and a Changelog row; and
      `grep -n 'same rule Article VI applies to Spanish comments' docs/constitution.md` returns
      nothing (AC-13).

### Group 2 — the validator, red on purpose

The whole group is `[infra]`. It ends with a `bin/comments` that **exits non-zero** on roughly 700
Spanish findings and 613 malformed references. That red run is the deliverable: it is the worklist
Group 3 consumes. The CI job is deliberately not here — it comes in Group 4, after the tree is
green, because a gate that is red for the duration of the work teaches everyone to ignore it.

- [x] **T002** `[infra]` Create `tools/comments/check.mjs` in the house style of
      `tools/audit/check.mjs`: plain ESM, `node:fs` only, no dependency, `repoRoot` via
      `fileURLToPath(import.meta.url)`, optional first positional argument naming one service,
      accumulating into a `hadFailure` flag so every finding prints before it exits. Walk
      `services/{api,web,worker}/src` for `*.ts`/`*.tsx` and extract comments — `//` to end of
      line, `/* … */` with its `*` continuations — scanning each line left to right tracking quote
      state so a `//` inside a string or regex is never read as a comment. Implement the three
      reference rules: malformed spelling (anything other than `Spec NNN, <ref>[ <ref>…]`, `;`
      between specs) prints REQ-1's grammar; `Spec NNN` with no `docs/spec/features/NNN-*/`
      directory; and an id absent from that directory's `spec.md`, with `Tnnn` resolving against
      `tasks.md` instead and **failing** when that file is absent rather than being skipped. Every
      finding names `file:line` and the rule that fired, and each resolved locator prints the first
      line of the requirement it points at. **Do not** create an allowlist file or any code that
      reads one (NFR-4).
      *Done when:* `bin/cli web node tools/comments/check.mjs` runs to completion, exits non-zero,
      and prints findings that each carry a file, a line and a named rule — plus a resolved
      requirement line for each well-formed locator. → T001
- [x] **T003** `[infra]` Add the Spanish detector to `check.mjs`, and the REQ-12 rule beside it (a
      Spanish `it(...)`/`describe(...)`/`test(...)` string in a `*.spec.ts` fails, which is a string
      check, not a comment check). **Strip every quoted run — `'…'`, `"…"`, `` `…` `` — from the
      comment text before testing for Spanish**: two comments in the tree are English Article IX
      headers quoting Spanish user-facing copy and must pass
      (`services/api/src/auth/test/auth-error-keys.spec.ts:213`,
      `services/api/src/languages/languages.service.spec.ts:360`). Trigger on Spanish accent and
      punctuation characters plus Spanish function words that are **not** also English words —
      exclude `no`, `la`, `son`, `si`, `me`, `van`, `ten` and anything like them, accepting false
      negatives over false positives. Add REQ-1b's structural context detection: a comment
      immediately preceding a `describe(` in a `*.spec.ts` is an exception-2 header, and exception-3
      is a hardcoded list that today holds one entry,
      `services/api/src/media-roots/media-roots.service.ts`'s `resolveFromRoot` neighbourhood.
      *Done when:* the two named lines above produce **no** finding, a plain Spanish comment
      produces one, and `// the guard runs before the first write` produces none (REQ-7, AC-6). → T002
- [x] **T004** `[infra]` Create `tools/comments/check.spec.mjs`: a plain `node`-runnable fixture
      script (there is no test runner at the repo root), opening with the Article IX header naming
      what it defends against — a detector that drifts broad breaks honest builds and gets disabled,
      one that drifts narrow passes Spanish under a green check. Export the detector and the
      reference parser from `check.mjs` so the fixtures call them directly. Fixtures must include,
      verbatim, both real lines from T003 (expected to **pass**), one plain Spanish comment
      (fail), one comment made only of the ambiguous English-also words (pass), and one of each
      reference-rule failure.
      *Done when:* `bin/cli web node tools/comments/check.spec.mjs` exits 0, and exits non-zero with
      a named fixture when the quote-stripping line in `check.mjs` is commented out (NFR-5). → T003
- [x] **T005** `[infra] [P]` Create `bin/comments`, copied from `bin/audit`: `set -e`,
      `require_docker`, the `.env` guard, then
      `docker compose $COMPOSE_FILES run --rm --no-deps --user "$(id -u):$(id -g)" -v "$(pwd):/repo"
      --workdir /repo --entrypoint node web tools/comments/check.mjs "$@"`. The whole repo root is
      bind-mounted, not one service, because the script reads all three services **and**
      `docs/spec/features/`. `chmod +x`.
      *Done when:* `bash -n bin/comments` parses, `bin/comments` reproduces T002's output, and
      `bin/comments api` scopes to one service. → T002
- [x] **T006** `[infra]` Run `bin/comments` against the unswept tree and **paste the real output**:
      the finding count per service broken down by rule. Report the three per-service worklists —
      the orchestrator hands them to the Group 3 agents.
      *Done when:* the report carries the actual per-service, per-rule counts, non-zero exit, and a
      sample of each of the five rules firing on a real line of the repo. → T004, T005
- [x] **T007** `[infra]` Exercise every failure path for real: append each line below to a file
      under `services/api/src`, run `bin/comments`, paste the actual output, revert. Then confirm
      AC-6b by reading `services/api/src/media-roots/media-roots.service.ts:57` — its guard doc
      comment must be accepted as prose once its reference reads `Spec 047, REQ-10`, while the same
      prose on a non-guard method is accepted too unless it contains Spanish.
      ```
      // esto arranca el encode cuando el torrent ya bajó   -> non-zero, names file:line  (AC-2)
      // Spec 999, REQ-1                                     -> non-zero, "no 999-* dir"  (AC-3)
      // Spec 048, REQ-99                                    -> non-zero, names 048-shorts-category/spec.md (AC-4)
      // per 018-ui-i18n REQ-7, the key survives             -> non-zero, prints the grammar (AC-5)
      // the guard runs before the first write               -> 0                          (AC-6)
      it('rechaza una ruta absoluta', () => {})             -> non-zero                   (AC-15)
      ```
      *Done when:* all six runs are pasted with their real output, five non-zero and AC-6's clean,
      and `git status --short` is clean afterwards. → T006

### Group 3 — the three sweeps

Everything here depends on Group 2: an agent sweeping without the validator cannot verify its own
work. The three services share no file and no contract, so all of Group 3 is genuinely parallel
across services; within a service the tasks are ordered only where noted.

- [x] **T008** `[api] [P]` Sweep the Spanish comments in `services/api/src` (REQ-3, REQ-4) —
      roughly 417 lines, concentrated in `media-sources/media-sources.service.ts` (43),
      `movies/movies.service.ts` (38), `media-roots/media-roots.service.ts` (29),
      `shows/shows.service.ts` (21), `process-jobs/process-jobs.service.ts` (19). Resolve or delete
      per the Legend's rule 1. `src/auth/auth.service.ts`'s three comments are the deletion
      archetype. The header paragraphs of `media-roots/media-roots.service.spec.ts` and
      `clients/torrent/magnet.spec.ts` are **translated**, not deleted (Article XI exception 2);
      `media-roots.service.ts:57`'s guard doc comment keeps its prose (REQ-1b) while `toHostPath()`
      three methods above loses its comment entirely. Leave
      `auth/test/auth-error-keys.spec.ts:213` and `languages/languages.service.spec.ts:360`
      untouched — if either is flagged, that is an `infra` bug to report, not a comment to edit.
      *Done when:* `bin/comments api` reports zero Spanish findings (reference findings may remain),
      `bin/cli api npx --no tsc --noEmit` is 0 errors, `bin/npm api run test` reports unchanged test
      and suite counts, and the resolution table is in the report. → T007
- [x] **T009** `[api] [P]` Normalize the 445 ad-hoc references in `services/api/src` to
      `// Spec NNN, <ref>` (REQ-5) — 348 of them carry no spec number on their line and are
      resolved by `git blame`, not by reading. `src/app.module.ts`'s four-line
      `(018-ui-i18n REQ-7)` block collapsing to `// Spec 018, REQ-7` is the archetype;
      `src/queue/process-queue.service.ts:13` keeps the BullMQ job-id URL beside
      `// Spec 012, REQ-2` (Article XI exception 1); `src/media-roots/media-roots.service.ts:57`
      becomes `(Spec 047, REQ-10)` with its prose intact.
      *Done when:* `bin/comments api` exits 0, `grep -rEn "REQ-|NFR-|AC-|T[0-9]{3}" services/api/src`
      shows every reference preceded by `Spec NNN, ` with no bare id surviving (AC-7),
      `git status --short services/api/prisma` and `git diff services/api/src/schema.gql` are both
      empty (AC-10), and the resolution table is in the report. → T008
- [x] **T010** `[api] [P]` Rewrite the 34 Spanish `it(...)`/`describe(...)` strings in
      `services/api/src` in English (REQ-12), indicative mood, matching the style
      `services/api/CLAUDE.md` § testing names (`it('rejects a symlink pointing outside the
      root')`). Change only the string — the two suites Article IX cites as the standard,
      `media-roots/media-roots.service.spec.ts` and `clients/torrent/magnet.spec.ts`, are the main
      holders.
      *Done when:* `bin/npm api run test` reports the **same** test and suite counts as before the
      task, `bin/comments api` reports no Spanish-string finding, and
      `grep -rEn "it\('[^']*[áéíóúñ]" services/api/src` returns nothing. → T007
- [x] **T011** `[api]` Correct the passage in `services/api/CLAUDE.md` § testing that records
      "Both files still have Spanish `it(...)` strings predating Article VI" — false after T010.
      Keep the surrounding guidance to copy those suites' structure, and the fault-injection
      paragraph, untouched (REQ-13).
      *Done when:* `grep -n "still have Spanish" services/api/CLAUDE.md` returns nothing and the
      § testing section still names both reference suites as the convention. → T010
- [x] **T012** `[worker] [P]` Sweep the Spanish comments in `services/worker/src` **except
      `src/ffmpeg/runner.ts`** (REQ-3, REQ-4) — roughly 142 lines across
      `encode/encode.mock.ts` (25), `paths/build-output-path.ts` (18), `encode/encode.ffmpeg.ts`
      (18), `index.ts` (17), `jobs/encode.job.ts` (11), `scan/scan-folder.ts` (8),
      `ffmpeg/buildCommand.ts` (8). `index.ts`'s two-`Worker` rationale and its
      `process.umask(0o002)` note both collapse: the prose is already in English in
      `services/worker/CLAUDE.md` and stays there. Same for `api/graphql-client.ts`'s and
      `jobs/cleanup-source.ts`'s top comments. Do **not** touch `src/ffmpeg/cases.spec.ts` or the
      `ffmpeg/*.json` corpus — that is the `ffmpeg` agent's territory; report anything you find there.
      *Done when:* `bin/comments worker` reports zero Spanish findings outside `runner.ts`,
      `bin/cli worker npx --no tsc --noEmit` is 0 errors, `bin/npm worker test` reports unchanged
      counts, and the resolution table is in the report. → T007
- [x] **T013** `[worker] [P]` Sweep `src/ffmpeg/runner.ts` (58 Spanish lines, a third of the slice)
      and write `src/ffmpeg/runner.spec.ts`. The signal comment at `runner.ts:100` resolves to no
      requirement — `047-source-deletion` mentions `SIGINT`/`SIGTERM` once, in its Context, only to
      say process signals are shutdown rather than per-job cancellation — so it is a REQ-4 deletion
      that **owes the test**. New suite, following `src/encode/cancellation.spec.ts`: **vitest**,
      not jest (`import { describe, expect, it } from 'vitest'`), opening with the Article IX header
      naming the failure — Docker signals `SIGTERM` on `docker compose stop`/`restart`, so a
      `SIGINT`-only runner leaves the FFmpeg child alive after its own container exits, burning a
      core with the job gone from the queue and no error in any log. Assert both signals are
      registered and that each kills the active child.
      *Done when:* `bin/comments worker` reports zero Spanish findings,
      `bin/npm worker test` passes with the new suite and no other count changed,
      `bin/npm worker run build` exits 0, and the report lists every REQ-4 deletion whose knowledge
      you judged load-bearing with what you did with it (test, `CLAUDE.md`, or URL). → T012
- [x] **T014** `[worker] [P]` Normalize the 124 ad-hoc references in `services/worker/src` to
      `// Spec NNN, <ref>` (REQ-5) — 110 carry no spec number and are resolved by `git blame`.
      `src/encode/cancellation.spec.ts`'s header `(NFR-1)` is one of them.
      *Done when:* `bin/comments worker` exits 0,
      `grep -rEn "REQ-|NFR-|AC-|T[0-9]{3}" services/worker/src` shows every reference preceded by
      `Spec NNN, `, and the resolution table is in the report. → T013
- [x] **T015** `[worker] [P]` Rewrite the one Spanish `it(...)`/`describe(...)` string in
      `services/worker/src` in English (REQ-12).
      *Done when:* `bin/npm worker test` reports the same counts as before and
      `bin/comments worker` reports no Spanish-string finding. → T007
- [x] **T016** `[worker]` Correct the three passages in `services/worker/CLAUDE.md` that point a
      reader at comments T012 and T013 removed (REQ-13): line ~21's "The reasoning is in the
      comments in `index.ts` — don't collapse them" (the reasoning is already written in English
      three lines above it — keep that paragraph, stop pointing at the comments), § *Errors must not
      be swallowed*'s "the comment at the top says why" for `api/graphql-client.ts`, and the
      `cleanup-source.ts` "The reasoning is written as a comment at the top of the file itself".
      *Done when:* `grep -n "don't collapse them" services/worker/CLAUDE.md` returns nothing, no
      remaining passage tells a reader to read or preserve a comment that no longer exists (AC-16),
      and the queue-separation, umask and error-swallowing rationales are all still stated in the
      document itself. → T013
- [x] **T017** `[web] [P]` Sweep `services/web/src` end to end — the Spanish comments (~78 lines)
      and the 44 ad-hoc references (39 of them bare) in one pass, since the slice is an order of
      magnitude smaller than the other two. `components/import/importFileModal.tsx:167`'s bare
      `(NFR-1)` becomes `// Spec 010, NFR-1; Spec 006, NFR-1b` (blame: `try to implement 010
      episode acquisition spec`). A comment that *quotes* a Spanish UI string keeps the quoted
      literal verbatim while its prose becomes English or a locator —
      `components/settings/SchedulingPanel.tsx`'s `"Ejecutar ahora"` and
      `components/settings/PathPicker.tsx`'s `"la raíz misma"` are the cases.
      `services/web/messages/{en,es}.json` is untouchable (NFR-6). **Do not run
      `bin/npm web run build`** — it writes `.next` into the host working copy and un-hydrates a
      running dev stack. No tests are owed: `web` has no suite, by standing decision.
      *Done when:* `bin/comments web` exits 0, `bin/cli web npx --no tsc --noEmit` is 0 errors,
      `bin/cli web node scripts/check-messages.mjs` reports no drift at the same key count as before
      (AC-14), `git diff --stat services/web/messages/` is empty, and the resolution table is in the
      report. → T007

### Group 4 — the gate

Only now, with the tree at zero. Added earlier, the job is red for the length of the feature and
stops being read.

- [x] **T018** `[infra]` Add a `comments` job to `.github/workflows/ci.yml`, matching the existing
      `site` and `audit` jobs: `actions/checkout@v5`, `actions/setup-node@v5` with
      `${{ env.NODE_VERSION }}`, then `node tools/comments/check.mjs` and
      `node tools/comments/check.spec.mjs` as two `run:` steps. No `npm ci` — the script has no
      dependency (REQ-8).
      *Done when:* `bin/comments` exits 0 on the swept tree (AC-1), the job appears in `ci.yml`
      beside the other five, and the workflow parses. → T009, T011, T014, T016, T017
- [x] **T019** `[infra]` Prove the gate bites. Push a branch carrying the AC-2 Spanish comment,
      confirm the `comments` job fails on it, and confirm by **reading** `release.yml` and `ci.yml`
      that `build` declares `needs: verify` and `verify` is `uses: ./.github/workflows/ci.yml`, so
      `build`/`merge` are skipped behind the failure. Do not edit `release.yml`.
      *Done when:* the failed run and the skipped `build`/`merge` are pasted from the real GitHub
      run, and the branch is deleted afterwards (AC-8). → T018

### Group 5 — verification and docs

- [x] **T020** `[docs]` Create `docs/spec/history.md` and move the root `CLAUDE.md`'s
      `## Current state` section into it verbatim, **newest first** (REQ-10) — the section is 213
      lines today, `CLAUDE.md:306–519`. Open the file with the cadence rule: a new measurement is
      appended here and never to `CLAUDE.md` (REQ-11), plus the commands an agent runs to re-measure
      all three services.
      *Done when:* `docs/spec/history.md` contains every measurement that was in `## Current state`,
      ordered newest first, and the commands it names run as written (AC-12). → T019
- [x] **T021** `[docs]` Edit the root `CLAUDE.md`: replace `## Current state` with a pointer of at
      most 15 lines to `docs/spec/history.md` plus the re-measure commands and the
      never-append-here rule (REQ-10, REQ-11); correct "the eleven rules" to agree with the twelve
      articles the constitution holds, or drop the count rather than restate a number that goes
      stale (REQ-9); add a `bin/comments` row to the § *Docker-first workflow* wrapper table; and
      record the new convention in § *Conventions* beside the existing Language entry, naming
      `// Spec NNN, REQ-n` and Article XI's fourth exception. Leave § *Known debt* untouched.
      *Done when:* `grep -n "eleven rules" CLAUDE.md` returns nothing (AC-11), the surviving
      constitution reference agrees with `grep -c '^## Article' docs/constitution.md` (12), the
      replacement section is 15 lines or fewer, and `bin/comments` appears in the wrapper table. → T020
- [ ] **T022** `[docs]` Walk all 17 acceptance criteria in `spec.md`, tick each box against evidence
      actually produced (and record as unverified anything that was not run, rather than ticking it),
      then set `status: Implemented` on `spec.md`, `plan.md` and all four `<svc>/plan.md`, and
      `status: Done` on this file. Re-run the cross-service parity checks as the final evidence:
      `bin/comments` at 0, the three typechecks at 0 errors, `bin/npm api run test` and
      `bin/npm worker test` at their post-sweep counts, `check-messages` with no drift,
      `git status --short services/api/prisma` and `git diff services/api/src/schema.gql` empty, and
      `grep -rEn "REQ-|NFR-|AC-|T[0-9]{3}" services/api/src services/web/src services/worker/src`
      showing every reference preceded by `Spec NNN, ` tree-wide (AC-7).
      *Done when:* every criterion carries either a tick with its evidence or an explicit
      "not run", and `grep -rn "^status:" docs/spec/features/086-comment-locator-convention/`
      shows no `Approved` or `Draft` left. → T021

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Two stop-and-report conditions are specific to this feature, and both land here rather than being
worked around:

- A sweep agent that finds `bin/comments` flagging
  `auth/test/auth-error-keys.spec.ts:213` or `languages/languages.service.spec.ts:360` — English
  headers quoting Spanish copy. That is a broken quote-stripping rule in `tools/comments/check.mjs`
  (`[infra]`, T003), never a comment to edit.
- A sweep agent that finds a REQ-4 deletion whose knowledge is load-bearing and has nowhere to go —
  no spec, no public URL, no `CLAUDE.md` paragraph — in a service with no test suite (`web`).
  Introducing the first suite in that service as a side effect of a comment sweep is not a decision
  an implementer makes.

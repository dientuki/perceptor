---
title: Comment Locator Convention
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-10-03
last_updated: 2026-10-03
status: Approved
services: [api, web, worker, infra]
---

# SPEC: Comment Locator Convention (`spec.md`)

## Context & Goal

Two of the three services carry a body of Spanish comments that the constitution already calls
drift. Article VI says comments are English; Article XI says there should be almost no comments at
all, and then explicitly sanctions leaving the existing ones alone — "leave them until you are
editing that code for another reason, since translating or deleting them wholesale creates noisy
diffs". That carve-out was written to avoid one bad diff, and the cost of it is that the gap keeps
widening: a sweep over `services/*/src` today finds roughly 700 line comments containing Spanish
prose, concentrated in `api`, then `worker`, then `web`. Nothing in the repository detects a new
one, so every feature can add more without any check firing.

Translating them is the wrong fix, because Article XI does not want an English paragraph where the
Spanish one was — it wants the rationale to live in the feature spec and the comment to be gone. The
tree has already been inventing the right answer on its own: about 876 comment lines carry a
reference to the spec that explains them, in at least five mutually incompatible spellings
(`018-ui-i18n REQ-7`, `(018 REQ-9)`, `035-scheduled-tasks REQ-7`, `../plan.md § Risks, row 1`, and a
bare `REQ-3` that is unresolvable the moment you read it outside the file it was written in). A
reader who finds `// Idle installation: zero TMDB calls (NFR-2, AC-4)` cannot tell which of
eighty-five specs owns that NFR.

This feature makes the locator the sanctioned form and the only one. A comment becomes
`// Spec 048, REQ-3` — no prose, a pointer to the authoritative text under
`docs/spec/features/048-*/`. Article XI gains a fourth exception to admit it (an amendment through
`/constitution`, on which this feature depends). The Spanish prose is replaced by a locator where a
spec covers it and deleted where none does. The 876 ad-hoc references are normalized to the same
grammar. A validator (`tools/comments/check.mjs`, reachable as `bin/comments`, wired into
`.github/workflows/ci.yml` beside the existing `site` and `audit` jobs) rejects a Spanish comment
and a malformed or dangling locator, so the debt cannot grow back.

The same pass fixes the doc drift that sits on top of it. The root `CLAUDE.md` tells every agent the
constitution holds "the eleven rules"; it has held twelve articles since `047-source-deletion`
ratified Article XII. And its `## Current state` section is 213 lines of running changelog
(CLAUDE.md:306–519) that every session loads in full, ending in an instruction not to trust the
numbers in it. That history moves to `docs/spec/history.md` and leaves a pointer plus the commands
to re-measure.

No pipeline stage in the root `CLAUDE.md` pipeline table changes status. No stage changes behaviour
at all: this feature edits comments, two documents and CI.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Locator Grammar)**: Must define exactly one form for a comment that points at a
      feature spec: `// Spec NNN, <ref>[ <ref>…]`, where `NNN` is the zero-padded number of a
      directory that exists under `docs/spec/features/`, and each `<ref>` is one of `REQ-n`,
      `NFR-n`, `AC-n` or `Tnnn`. Two specs in one comment are separated by `;` —
      `// Spec 047, REQ-4; Spec 060, REQ-2`. The line carries no other text: no prose before the
      locator, none after it, no parentheses around it.
- [ ] **REQ-1b (Reference Inside An Older Exception)**: Must allow the same spelling —
      `Spec NNN, <ref>` — to appear inline inside a comment that Article XI's exception 2 (the
      Article IX test header) or exception 3 (a security guard's doc comment) already permits,
      where prose is the point and a locator-only line would delete the reasoning the exception
      exists to carry. `MediaRootsService.resolveFromRoot`'s neighbours are the case that exists
      today. REQ-1's locator-only rule binds the fourth exception only; the validator must
      distinguish the two contexts rather than reject one for the other's rule.
- [ ] **REQ-2 (Fourth Exception)**: Must be ratified by an amendment to Article XI adding the
      locator of REQ-1 as a fourth permitted comment, alongside the external URL, the Article IX
      test header and the security-guard doc comment. The amendment also retires Article XI's
      "leave them until you are editing that code" sentence and Article VI's matching carve-out,
      both of which this feature discharges. The amendment lands through `/constitution` before any
      service is swept.
- [ ] **REQ-3 (Spanish Sweep, Covered)**: Must replace every Spanish comment in
      `services/{api,web,worker}/src` whose rationale is covered by an existing feature spec with
      the REQ-1 locator for the requirement that covers it. The replacement is a locator, never an
      English translation of the prose.
- [ ] **REQ-4 (Spanish Sweep, Uncovered)**: Must delete, not translate, every Spanish comment that
      no feature spec covers — code that predates the spec flow, or a note about something no
      requirement ever stated. Where the deleted comment was load-bearing (it described a failure
      that produces no error anywhere), the sweep owes a test instead, per Article IX, and the
      rationale goes in that test's header and the commit message.
- [ ] **REQ-5 (Locator Normalization)**: Must rewrite every existing ad-hoc spec reference in a
      comment into the REQ-1 grammar, including resolving a bare `REQ-n`/`AC-n`/`NFR-n` to the spec
      number that owns it and converting a slug-bearing reference (`018-ui-i18n REQ-7`) to its
      number. A reference to a `plan.md` section maps to the requirement it came from; if it maps
      to none, the comment is deleted under REQ-4. Inside an exception-2 or exception-3 comment the
      reference is normalized in place and the prose around it survives (REQ-1b); everywhere else
      the whole comment collapses to the locator.
- [ ] **REQ-6 (Validator)**: Must add `tools/comments/check.mjs`, invoked through a new `bin/comments`
      wrapper in the pattern of `bin/audit` (inside the `web` image, repo root bind-mounted —
      Article I), that walks `services/{api,web,worker}/src` and exits non-zero on: a comment
      containing Spanish, a comment that references a spec in any form other than REQ-1's, a
      locator naming a spec directory that does not exist, and a locator naming a `REQ`/`NFR`/`AC`
      id that does not appear in that spec's `spec.md`. With a clean tree it exits 0 and prints the
      number of locators it resolved.
- [ ] **REQ-7 (Validator Tolerance)**: Must not reject an English comment that carries no spec
      reference. Those are the remaining ~5,000 Article XI violations, out of scope here (see § Out
      of Scope); a gate that failed on them would be unmergeable on the day it landed.
- [ ] **REQ-8 (CI Gate)**: Must run the validator as its own job in `.github/workflows/ci.yml`, on
      push to the tracked branches and on pull requests, so a new Spanish comment or a dangling
      locator fails the build. `release.yml` already needs `ci.yml`, so a tag cannot publish past it.
- [ ] **REQ-9 (Article Count)**: Must correct the root `CLAUDE.md`'s "the eleven rules" to match the
      twelve articles the constitution actually holds, and must state the count in a form that does
      not go stale silently — or drop the count rather than restate it.
- [ ] **REQ-10 (History Extraction)**: Must move the root `CLAUDE.md`'s `## Current state` changelog
      to `docs/spec/history.md` verbatim, newest first, and leave in `CLAUDE.md` a pointer to that
      file plus the commands an agent runs to re-measure the three services. The surviving section
      is at most 15 lines.
- [ ] **REQ-12 (Spanish Test Descriptions)**: Must rewrite in English the 35 Spanish `it(...)` /
      `describe(...)` strings that remain in `services/api/src` (34) and `services/worker/src` (1),
      and must extend the validator to reject a new one. These are an Article VI violation of the
      same kind as the comments — "test descriptions follow the code: English `it(...)` strings" —
      and `services/api/CLAUDE.md` already records them as debt ("Both files still have Spanish
      `it(...)` strings predating Article VI"). They sit in the files this sweep already opens,
      including `media-roots.service.spec.ts`, and renaming a description changes no behaviour and
      no test count. The two suites Article IX names as the standard are the worst offenders, which
      is why this cannot be left behind a gate that by construction cannot see it.
- [ ] **REQ-13 (Service CLAUDE.md Repair)**: Must correct every passage in a service's own
      `CLAUDE.md` that points a reader at a comment this sweep removes or rewrites.
      `services/worker/CLAUDE.md` has three (`"The reasoning is in the comments in index.ts — don't
      collapse them"`, the `graphql-client.ts` top comment, the `cleanup-source.ts` top comment) and
      `services/api/CLAUDE.md` has the REQ-12 debt note. A document that instructs the next agent to
      preserve a comment this feature deletes is the kind of drift this feature exists to close.
- [ ] **REQ-11 (History Cadence)**: Must state, in `docs/spec/history.md` and in the pointer that
      replaces it, that a measurement is appended to the history file and never to `CLAUDE.md`, so
      the section cannot regrow.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Behaviour Unchanged)**: Must change no runtime behaviour in any service. A comment
      sweep that alters a line of code is a different change and does not belong in this diff; the
      only exception is a test file added under REQ-4, which adds no production code.
- [ ] **NFR-2 (Reviewable Diff)**: Must land as one commit per service, so each diff is a comment
      diff a human can read end to end. `git diff --stat` for `api`, `web` and `worker` shows
      `.ts`/`.tsx` files with comment-only hunks plus, at most, new `*.spec.ts` files.
- [ ] **NFR-3 (No Schema, No Contract)**: Must add no Prisma migration and no change to
      `services/api/src/schema.gql`. Both diffs are empty.
- [ ] **NFR-4 (Validator Has No Allowlist)**: Must not ship a suppression file in the shape of
      `tools/audit/allowlist.json`. An exemption would reintroduce exactly the "leave it for later"
      clause REQ-2 retires. A comment either conforms or is deleted.
- [ ] **NFR-5 (Spanish Detection Is Stated)**: Must document, inside `tools/comments/check.mjs`'s
      own test, how a Spanish comment is detected and which words or characters trigger it, since a
      heuristic that no one can reproduce turns a blocking CI job into a mystery. The detection
      rule is owed a test naming the failure it prevents (Article IX).
- [ ] **NFR-6 (User-Facing Copy Untouched)**: Must not touch `services/web/messages/{en,es}.json`
      or any Spanish string that reaches a user. Article VI's exception for user-facing copy is
      unaffected; `bin/cli web node scripts/check-messages.mjs` reports the same key count before
      and after.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.** It edits comments, two documents, one
CI workflow and adds one validator script. No resolver, type, field, argument or error condition
changes; `web` and `worker` have nothing to retype.

## Data Model Changes

**None.** No Prisma model, field, enum or migration (NFR-3).

## Acceptance Criteria

- [ ] **AC-1**: `bin/comments` exits 0 and prints the count of resolved locators, with the sweep
      complete on all three services.
- [ ] **AC-2**: Appending `// esto arranca el encode cuando el torrent ya bajó` to any file under
      `services/api/src` makes `bin/comments` exit non-zero and name that file and line. Reverting
      it returns the run to 0.
- [ ] **AC-3**: Appending `// Spec 999, REQ-1` makes `bin/comments` exit non-zero with a message
      saying no `docs/spec/features/999-*` directory exists.
- [ ] **AC-4**: Appending `// Spec 048, REQ-99` makes `bin/comments` exit non-zero with a message
      saying `REQ-99` does not appear in `docs/spec/features/048-shorts-category/spec.md`.
- [ ] **AC-5**: Appending `// per 018-ui-i18n REQ-7, the key survives` makes `bin/comments` exit
      non-zero as a malformed locator, naming REQ-1's grammar in the message.
- [ ] **AC-6**: Appending `// the guard runs before the first write` — English, no spec
      reference — leaves `bin/comments` at 0 (REQ-7).
- [ ] **AC-6b**: `services/api/src/media-roots/media-roots.service.ts` keeps its
      `resolveFromRoot` guard doc comment as prose, with its reference reading `Spec 047, REQ-10`,
      and `bin/comments` accepts it; the same prose attached to a non-guard method is rejected
      only if it contains Spanish (REQ-1b, REQ-7).
- [ ] **AC-7**: `grep -rEn "REQ-|NFR-|AC-|T[0-9]{3}" services/api/src services/web/src
      services/worker/src` returns only lines where the reference is preceded by `Spec NNN, `, with
      every match resolving to an id that exists in that spec's `spec.md`. No bare `REQ-n` survives.
- [ ] **AC-8**: The CI run on a pull request shows a `comments` job; a branch carrying the AC-2
      comment fails it, and the jobs after it in `release.yml`'s chain do not run.
- [ ] **AC-9**: `bin/npm api run test`, `bin/npm worker test` and
      `bin/cli web npx --no tsc --noEmit` report the same counts and 0 errors before and after the
      sweep, except for test files added under REQ-4 (NFR-1).
- [ ] **AC-10**: `git status --short services/api/prisma` is empty and
      `git diff services/api/src/schema.gql` is empty (NFR-3).
- [ ] **AC-11**: `grep -n "eleven rules" CLAUDE.md` returns nothing, and the surviving mention of the
      constitution in `CLAUDE.md` agrees with `grep -c '^## Article' docs/constitution.md`.
- [ ] **AC-12**: `docs/spec/history.md` exists and contains every measurement that was in
      `CLAUDE.md`'s `## Current state`; the section that replaces it in `CLAUDE.md` is 15 lines or
      fewer, and the commands it names run as written.
- [ ] **AC-13**: `sed -n '/^## Article XI/,/^## Article XII/p' docs/constitution.md` shows four
      numbered exceptions and no "leave them until you are editing that code" sentence, and
      `grep -n '1.3.0' docs/constitution.md` returns a Changelog row (REQ-2).
- [ ] **AC-14**: `bin/cli web node scripts/check-messages.mjs` reports the same key count as it did
      before this feature and no `en`/`es` drift (NFR-6).
- [ ] **AC-15**: `bin/comments` exits non-zero on an appended `it('rechaza una ruta absoluta', …)`
      in any `*.spec.ts`, and `bin/npm api run test` reports the same test and suite counts before
      and after REQ-12's rewrite (a description change moves no count).
- [ ] **AC-16**: `grep -n "don't collapse them" services/worker/CLAUDE.md` returns nothing, and no
      passage in `services/{api,web,worker}/CLAUDE.md` tells a reader to read or preserve a comment
      that no longer exists (REQ-13).

## Out of Scope

- **The ~5,000 English explanatory comments.** Article XI forbids them too, and they outnumber the
  Spanish ones seven to one. Sweeping them is a separate feature with the same shape as this one;
  this feature deliberately builds the grammar, the validator and the amendment that such a sweep
  would need, and stops. REQ-7 is what keeps the gate green in the meantime.
- **Block comments and JSDoc.** 61 occurrences in `api` and 50 in `web`. The validator reads them
  for the Spanish check, but normalizing a docblock into a locator changes what the editor shows on
  hover and is worth deciding separately.
- **Comments in `bin/`, `install.sh`, `tools/` and the workflow files.** Article XI governs
  `services/*/src`; a shell wrapper's header is the only documentation it has, and `bin/audit`'s is
  the model, not a violation.
- **Commented-out code.** Article XI forbids it and the validator does not detect it — detecting
  commented-out TypeScript reliably means parsing it. It is deleted on sight during the sweep where
  a Spanish comment sits next to it, and otherwise left for the English sweep above.
- **Rewriting any spec to accept a locator pointed at it.** If the rationale in a Spanish comment is
  real and the spec that should cover it does not say it, the comment is deleted under REQ-4 and a
  test is owed. Amending a closed spec to retrofit a requirement is not part of this pass.
- **The `movieId` debt in `CLAUDE.md`'s `## Known debt`.** It stays exactly as written. This feature
  touches the `## Current state` section and the article count, nothing else in that file's content.

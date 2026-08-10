---
description: Review the project constitution, or guide an amendment to it
argument-hint: [the change you want to make — omit to just review]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(grep:*), Bash(ls:*), AskUserQuestion
---

Read `docs/constitution.md`.

**With no arguments**: summarise the nine articles and, for each, say whether it currently holds.
Run the `Check` line where it is mechanical — `grep -rn "@prisma/client" services/web/src
services/worker/src` for Article II, and so on. Report any article the codebase is already
violating. That list is more useful than the summary.

**With arguments** — the proposed amendment is: **$ARGUMENTS**

## 1. Decide whether it belongs here

The constitution holds rules that are **non-negotiable and verifiable**. Not preferences, not
current best guesses, not anything that changes per feature.

If the proposal is really a convention, it belongs in the relevant `services/<svc>/CLAUDE.md`. If
it is really a design decision for one change, it belongs in that feature's `spec.md`. Say so and
stop — a constitution that accumulates advice stops being read.

## 2. Check what it collides with

An article is worthless if other files contradict it. Before writing, grep the places that would
have to agree:

- `CLAUDE.md` at the root and in each service
- `docs/spec/features/_templates/*.md`
- `.claude/agents/*.md`
- `.claude/commands/*.md`

List every contradiction you find. If the amendment lands, those files are part of the same
change — an amendment nobody propagated is just a second source of truth.

## 3. Write it

Same shape as the existing articles: a short statement of the rule, the reasoning only where it is
not obvious, and a **Check** line that someone can actually run or observe. If you cannot write
the Check, the rule is not ready.

Bump `version` in the frontmatter — MAJOR to remove or reverse an article, MINOR to add one, PATCH
for wording — update `last_amended`, and append a Changelog row saying what changed and why.

## 4. Report

The new or changed article, the version bump, and the list of files that now need updating to
match. Offer to make those edits; do not make them silently as part of the amendment.

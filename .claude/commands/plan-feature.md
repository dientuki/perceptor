---
description: Turn an approved feature spec into a cross-service plan plus one plan per service
argument-hint: [NNN or slug — defaults to the most recent feature]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(ls:*), Bash(bin/cli:*), Bash(grep:*), AskUserQuestion
---

Write the implementation plan for feature **$ARGUMENTS** (if empty, use the highest-numbered
directory in `docs/spec/features/`).

## 1. Gate

Read `docs/spec/features/NNN-*/spec.md`.

```bash
grep -n "NEEDS CLARIFICATION" docs/spec/features/NNN-*/spec.md
```

**If anything matches, stop.** Print the open questions and tell the user to resolve them in
`spec.md` first. Planning around an unanswered question is how two services end up implementing
two different features. This gate is the whole reason the markers exist.

## 2. Ground yourself

Read `docs/constitution.md`, `docs/spec/graphql-contract.md`, and the `CLAUDE.md` of every service
in the spec's `services:` list.

Then read the real code each slice will touch. The plan's job is to name what already exists and
must be **reused** — an existing service method, an existing component, an existing utility. A
plan that quietly introduces a second way to do something the repo already does is the most common
way this codebase gets worse.

## 3. Write the cross-service `plan.md`

From `docs/spec/features/_templates/plan.md`. This file is only for what spans services:

- **Approach** — the shape of the solution and, where a real alternative existed, why this one.
- **Order of Work** — which service first and why; which steps can truly run in parallel (only
  after the contract is frozen).
- **Contract Freeze** — call out anything an implementer will be tempted to change and must not.
- **Migrations** — the Prisma migration and what happens to existing rows. `api` owns this.
- **Risks** — be concrete about the *silent* ones, the failures that produce no error anywhere.
- **Verification** — the actual `bin/` commands, plus the manual pass.

Do not put per-service file lists here.

## 4. Write one `<svc>/plan.md` per service

From `docs/spec/features/_templates/service-plan.md`, into
`docs/spec/features/NNN-slug/<svc>/plan.md` — **only** for services in `services:`. No empty
directories: a `worker/` folder on a feature that does not touch the worker will make an agent
believe it has work.

Each one is the brief its subagent reads. It must stand on its own well enough that the agent
never has to guess what another service is doing — but it must not restate the shared contract,
which lives in `../spec.md` and is read-only.

Name the files, name the existing code to reuse, list the steps in order, and state which units
are owed a test under Article IX and which are not and why.

## 5. Close

Set `status: Approved` on `spec.md` (this is the freeze) and on every plan file. Update
`last_updated`.

Report: the files you created, the order of work, the risks, and anything you had to decide that
the spec did not cover — that last list is what the user most needs to see. Then tell them to run
`/tasks NNN`.

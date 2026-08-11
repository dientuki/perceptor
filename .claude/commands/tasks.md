---
description: Break an approved feature plan into service-tagged, dispatchable tasks
argument-hint: [NNN or slug — defaults to the most recent feature]
allowed-tools: Read, Write, Glob, Grep, Bash(ls:*)
---

Derive `tasks.md` for feature **$ARGUMENTS** (if empty, the highest-numbered directory in
`docs/spec/features/`).

## 1. Gate

Read `spec.md`, `plan.md` and every `<svc>/plan.md`. All must be `status: Approved`. If any is
still `Draft`, stop and say which — `/plan-feature` has not finished.

## 2. Derive the tasks

One task = one coherent change one agent can finish **and verify** on its own.

- **Exactly one tag per task** — `[api]`, `[web]`, `[worker]`, `[infra]` for the four service
  agents, plus one the orchestrator handles itself: `[docs]` for documentation. `[infra]` covers
  repo-root and third-party-container territory — `bin/`, `docker-compose.yaml`, `.env.example`,
  `services/*/Dockerfile`, `docs/spec/docker/`. The difference between `[infra]` and `[docs]` is
  executable config versus prose — an `[infra]` task changes how the stack boots or what a `bin/`
  wrapper does, so it carries a real *Done when*, not a "the file now says X". A task that needs
  two services (including infra) is scoped wrong: split it. This is not a formality; it is what
  lets a subagent stop at its boundary instead of helpfully editing someone else's service.
- **Every task gets a *Done when*** line: an observable result. A command's output, a row's
  contents, something visible in the UI. "Implemented correctly" is not a done condition.
- **Dependencies are explicit** — `→ T001`. Anything consuming the GraphQL contract depends on the
  `api` task that produces it. Do not let a `web` task race the resolver it calls.
- **`[P]` only where genuinely independent** — two services can overlap only once the contract
  they share is frozen and produced. Before that, "parallel" means "diverging".

Group them so the groups tell the story: contract and schema first, consumers second,
verification and docs last.

## 3. Always include the closing tasks

- A `[docs]` task for the affected `CLAUDE.md` — the root pipeline table if a stage changed
  status, the service's own if a convention or module map changed. Stale docs are the failure this
  whole process exists to prevent.
- A `[docs]` task that walks the acceptance criteria in `spec.md`, ticks each box, and flips
  `status: Implemented` across the feature's files.

Every acceptance criterion in `spec.md` must be reachable by some task. If one is not, the plans
missed something — say so rather than papering over it.

## 4. Write and report

Write `docs/spec/features/NNN-slug/tasks.md` from
`docs/spec/features/_templates/tasks.md`, `status: Draft`.

Report the task count per service, the critical path, and which tasks can run in parallel. Then
tell the user to run `/implement NNN`.

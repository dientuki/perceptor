---
title: <Feature Name> — <service> slice
service: <api | web | worker>
last_updated: <YYYY-MM-DD>
status: Draft            # Draft | Approved | Implemented
---

# PLAN: <Feature Name> — `<service>` (`<service>/plan.md`)

> Template for a per-service plan, living at `docs/spec/features/NNN-slug/<service>/plan.md`.
> This is the file the `<service>` subagent reads as its brief. It must be complete enough that
> the agent never needs to guess what another service is doing — everything shared lives in
> `../spec.md` and `../plan.md`, which the agent reads first.
> Delete this blockquote and every `<placeholder>` before `status: Approved`.

## Scope

One paragraph: what this service is responsible for in this feature, and — just as important —
what it is explicitly **not** doing because another service owns it.

Writes are confined to `services/<service>/` and this directory. Anything else is a stop-and-report
(see the agent definition in `.claude/agents/<service>.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/<service>/src/…` | New | <one line> |

List the files that are known up front. It is fine for an implementer to touch a file not listed
here, but a *new module* that is not listed means the plan missed something — report it.

## Existing code to reuse

The patterns and utilities in this service that this slice must follow rather than reinvent, with
paths. This is the section that keeps the codebase from growing a second way to do everything.

- `<path>` — <what it already does and how this slice uses it>.

## Steps

Ordered, each one small enough to be a task in `tasks.md`.

1. <Step, naming the file and the change.>
2. <…>

## Contract obligations

What this service owes the others, taken from `../spec.md` § GraphQL Contract Delta. For `api`:
the exact shape it must expose. For `web`/`worker`: the exact shape it consumes, **including every
error condition** — there is no codegen, so a consumer that only handles the happy path compiles
fine and fails at runtime (see `docs/spec/graphql-contract.md`).

The delta is read-only. If it is wrong, stop and report — do not adapt it locally.

## Tests

Which units in this slice are owed a test under Article IX (failure is silent), and which are not
and why. Name the file paths.

- `<path>.spec.ts` — defends against <the specific silent failure>.

If nothing in this slice can fail silently, say so explicitly. "No tests" with a reason is a valid
outcome; "no tests" with no reason is an omission.

## Done when

The commands that must pass, and their expected result. All through `bin/`.

```bash
<bin/… typecheck>
<bin/… test or lint>
```

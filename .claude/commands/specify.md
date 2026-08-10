---
description: Create a new feature spec from a plain-language description
argument-hint: <what you want to build, in a sentence or two>
allowed-tools: Read, Write, Glob, Grep, Bash(ls:*), Bash(git log:*), AskUserQuestion
---

Create a feature spec for: **$ARGUMENTS**

You are writing the **what**, not the **how**. No code, no implementation steps, no file-by-file
plan — that is `/plan-feature`'s job. Do not edit anything under `services/`.

## 1. Pick the number and slug

```bash
ls docs/spec/features/
```

Take the next free `NNN` (zero-padded, `_templates` doesn't count) and a short kebab-case slug from
the description. Create `docs/spec/features/NNN-slug/`.

## 2. Ground yourself before writing

Read, in this order:

- `docs/constitution.md`
- the root `CLAUDE.md` pipeline table — decide which stage(s) this touches
- `docs/spec/graphql-contract.md` if this crosses a service boundary
- the actual code the feature touches. **Search first.** A spec that proposes something the
  codebase already has is worse than no spec.

Then decide `services:` — the list of services the feature genuinely touches. Remember there is no
`db` service: schema changes belong to `api` (Constitution, Article III).

If the change touches one service, changes no schema and no GraphQL, it may not need a spec at
all (Constitution, Article VII). Say so and stop rather than generating ceremony.

## 3. Write `spec.md`

Copy `docs/spec/features/_templates/spec.md` and fill every section. Keep `status: Draft`.

The two sections that carry the weight:

- **GraphQL Contract Delta** — SDL as it will appear in `schema.gql`, *plus* the error table.
  `web` and `worker` retype this by hand with no codegen, so an unlisted error condition is a
  runtime bug in a service you are not writing.
- **Acceptance Criteria** — verifiable from outside the code. At least one must exercise a
  **failure** path.

## 4. Mark what you don't know

Anything you had to guess becomes `[NEEDS CLARIFICATION: <the actual question>]` inline. Be
specific — "what should happen if the user submits twice?" not "unclear behaviour".

Then use **AskUserQuestion** for the ones that genuinely change the shape of the feature, and
resolve them in the file. Leave the rest as markers: `/plan-feature` refuses to run while any
remain, which is the point.

## 5. Report

Print the path you created, the `services:` list, the acceptance criteria, and every remaining
`[NEEDS CLARIFICATION]`. Tell the user to review it and then run `/plan-feature NNN`.

Do **not** create `plan.md`, `tasks.md` or any `<svc>/` subdirectory. Those come later, and
creating them empty makes an agent think it has work.

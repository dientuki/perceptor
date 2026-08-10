---
title: <Feature Name> — Implementation Plan
spec_version: 0.1.0
last_updated: <YYYY-MM-DD>
status: Draft            # Draft | Approved | Implemented
---

# PLAN: <Feature Name> (`plan.md`)

> Template. This is the **cross-service** plan: sequencing, the contract freeze, migrations and
> risk. Per-service detail lives in `<svc>/plan.md` next to this file — do not duplicate it here.
> Delete this blockquote and every `<placeholder>` before `status: Approved`.

## Approach

The shape of the solution in prose: which existing module or utility this extends, what the new
seam is, and — where a real alternative existed — why this one and not that one.

Name what is being **reused**. A plan that introduces a new helper next to an existing one that
already does the job is a plan with a bug in it. Reference the file path.

## Order of Work

Which service goes first, and why. Usually `api` first (it owns the schema and the contract), then
its consumers — but say it explicitly rather than leaving it implied.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | <e.g. owns the migration the others read through> |
| 2 | `web` | <e.g. cannot render a field the schema does not have yet> |

Mark which steps can genuinely run **in parallel**. Two services can only overlap once the
contract between them is frozen; before that, "parallel" means "diverging".

## Contract Freeze

State plainly that the `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`,
and record here anything an implementer will want to change and must not:

- **<Field or behaviour>** — <why it looks wrong from inside one service and is right for the
  feature as a whole.>

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, and re-brief every
service listed in `services:`. Never patch it from inside one slice (Constitution, Article VIII).

## Migrations

The Prisma migration, in order, and what happens to existing rows. Owned by `api`.

1. `<migration name>` — <what it does>.
2. Backfill: <the statement or script, and how it is verified>.

Reversibility: <can this be rolled back, and what breaks if it is?> Write **"None."** if there is
no schema change.

## Risks

The failure modes that are specific to this feature, and how the plan defends against each. Be
concrete about the *silent* ones — the ones that produce no error (Constitution, Article IX).

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| <e.g. stored hash ≠ hash the client reports> | <no error anywhere; state stuck forever> | <test + live check in the acceptance criteria> |

## Verification

How the feature is proven end to end, as commands. Everything through `bin/` (Constitution,
Article I). This section is the source for the `[verify]` tasks in `tasks.md`.

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
```

Then the manual pass: what to click, what to query, what to see. If the acceptance criteria in
`spec.md` cannot all be reached from this section, one of the two is incomplete.

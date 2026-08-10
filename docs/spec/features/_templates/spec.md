---
title: <Feature Name>
spec_version: 0.1.0
author: <Name>
created_at: <YYYY-MM-DD>
last_updated: <YYYY-MM-DD>
status: Draft            # Draft | Approved | Implemented | Superseded
services: [api, web]     # only the services this feature actually touches
---

# SPEC: <Feature Name> (`spec.md`)

> Template. Copy the whole directory shape, not just this file:
> `docs/spec/features/NNN-slug/{spec.md, plan.md, tasks.md, <svc>/plan.md}`.
> Create a `<svc>/` subdirectory **only** for services listed in `services:` above.
> Delete this blockquote and every `<placeholder>` before setting `status: Approved`.

## Context & Goal

Why this exists. What is broken, missing or awkward today, what the user is trying to do, and what
the world looks like once this ships. Two or three paragraphs of prose — no bullet lists here.

Name the concrete files or pipeline stages involved so a reader can find the territory without
grep. If a stage of the pipeline in the root `CLAUDE.md` changes status because of this feature,
say which one.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (<Short Name>)**: Must <observable behaviour, in the user's or the system's terms>.
- [ ] **REQ-2 (<Short Name>)**: Must <…>.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (<Short Name>)**: Must <constraint on performance, security, failure mode,
      migration, backwards compatibility, …>.

Requirements describe **what**, never **how**. "Must reject a magnet whose infoHash does not
decode" is a requirement; "must call `parseMagnet` before `qbittorrent.add`" is a plan step and
belongs in `plan.md`.

Mark anything undecided as `[NEEDS CLARIFICATION: <the actual question>]`. `/plan-feature` refuses
to run while any of those remain — an unanswered question resolved by an implementer at 3am is how
services drift apart.

## GraphQL Contract Delta

The handshake between services. Frozen once `status: Approved` (Constitution, Article VIII) —
implementers read it, never edit it.

Write it as it will appear in the generated `services/api/src/schema.gql`:

```graphql
type Mutation {
  <mutationName>(<arg>: <Type>!): <ReturnType>!
}
```

Then the parts the schema cannot express, because `web` and `worker` retype all of this by hand
and there is no codegen to catch a mismatch:

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| <what went wrong> | `<NestException>` | `<exact string — Spanish, this is user-facing copy>` |

Consumers must also record what they will do with each error — a `web` action that only knows the
happy path is not implementing the contract. If this feature adds no GraphQL surface, write
**"None — this feature does not cross the service boundary."** and say why.

## Data Model Changes

Prisma models, fields, enums and their migration. Owned by `api` (Constitution, Article III).

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |

Write **"None."** if the schema is untouched. If a column is added non-null to a populated table,
the backfill is a requirement, not an implementation detail — put it in `NFR-n` too.

## Acceptance Criteria

Verifiable from outside the code. Each line is something a human can do and watch happen —
a command with an expected output, a UI action with an expected result, a row with expected
contents. "Works correctly" is not an acceptance criterion.

- [ ] **AC-1**: Given <state>, when <action>, then <observable result>.
- [ ] **AC-2**: `<bin/… command>` prints/returns <expected>.

At least one criterion must exercise the **failure** path. Features that only prove the happy path
are how silent failures reach production (Constitution, Article IX).

## Out of Scope

What a reader might reasonably assume is included, and is not — with the reason. This section is
what stops an implementer from helpfully expanding the feature.

- **<Thing>.** <Why it is deliberately excluded and, if known, what it would take.>

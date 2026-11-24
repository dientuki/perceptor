---
title: Isolate each list in the scheduled TMDB list import and bound the stored name
spec_version: 0.1.0
author: security-audit run-3 (draft)
created_at: 2026-11-23
last_updated: 2026-11-23
status: Draft
services: [api]
source_finding: api/tmdb-lists/importAll-list-name-update-unguarded-aborts-sweep
audit_verdict: needs_validation
priority: 52
---

# SPEC (draft): Isolate each list in the scheduled TMDB list import and bound the stored name

> Draft written from a security audit (`security-audit` skill, run-3, profile `deep`). The finding
> is `needs_validation`: source confirms the unguarded write, but whether TMDB allows a list name
> over 191 characters and whether the deployment's MariaDB errors rather than truncates are not
> source-visible. Line numbers refer to commit `2a3976a`.

## Context & Goal

Spec 109's `import_lists` task (`scheduler/tasks/import-lists.task.ts:11`) calls
`TmdbListsService.importAll` (`tmdb-lists/tmdb-lists.service.ts:125`), which loads every attached
list of every enabled user ordered by `createdAt, id` (`:129-132`) and walks them in one `for` loop.
The per-list `try/catch` (`:140-152`) covers only `readAllPages`. Outside it:

- the success update (`:154-162`) writes `name: pages.name || list.name` into
  `user_tmdb_lists.name`, a `VARCHAR(191)` column
  (`prisma/migrations/20261027140000_tmdb_list_import/migration.sql:6`);
- the failure update inside the `catch` (`:144-147`) writes `lastError`;
- `importItems` (`:164`) and its queries.

`TmdbClient.list` returns `name: data.name ?? ''` with no length bound
(`clients/tmdb/client.ts:253`). Attaching a list with an over-long name fails at create time
(`tmdb-lists.service.ts:64`), but a list's TMDB owner can rename it after another user attached it.
If the update then throws (Prisma `P2000` under strict SQL mode), `importAll` rejects, the loop
stops, and every list ordered after it, for every user, is skipped on every run until the list is
detached. The task only reports `listsFailed` (`import-lists.task.ts:14`); a thrown `importAll`
fails the whole run.

The goal is that one list's database error can never stop the others, and that an upstream name
always fits the column.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Bounded name)**: The name written by `importAll` (and by attach, `:64`) is truncated
      to the column's length before the write. [NEEDS CLARIFICATION: truncate by characters with
      an ellipsis, or plain cut? `utf8mb4` counts characters, not bytes.]
- [ ] **REQ-2 (Per-list isolation)**: Everything `importAll` does for one list — the name/itemCount
      update, the `lastError` update and `importItems` — is inside per-list error isolation; a
      failure counts in `listsFailed`, is logged, and the loop continues with the next list.
- [ ] **REQ-3 (Error recorded)**: A list that failed for a database reason stores a stored error key
      (`storedErrorKey`) the same way a read failure does; if even that write fails, it is logged and
      skipped, never rethrown.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Spec 109 semantics)**: Additive, once-only import is unchanged; a list's partial
      `importItems` progress before a failure stays as it is today.
- [ ] **NFR-2 (Run outcome)**: The task still throws at the end when `listsFailed > 0`, so the
      scheduler shows the run as failed, but only after every list has been attempted.

## GraphQL Contract Delta

None.

## Data Model Changes

None required. [NEEDS CLARIFICATION: widen `name` to `VARCHAR(500)` or `TEXT` instead of, or as
well as, truncating?]

## Acceptance Criteria

- [ ] **AC-1 (reproduce first)**: Against a throwaway MariaDB with default strict mode, update a
      `user_tmdb_lists` row with a 300-character name through Prisma and confirm the `P2000` error;
      then run `importAll` with two lists where a stubbed TMDB returns a 300-character name for the
      first, and confirm today the second list is never processed.
- [ ] **AC-2**: After the fix the second list is imported and the first stores a truncated name.
- [ ] **AC-3**: A forced failure in `importItems` for one list leaves later lists imported and
      `listsFailed` counting it.
- [ ] **AC-4**: A normal run with names under 191 characters is unchanged.

## Out of Scope

- **TMDB's own limit on list names** — the deployment validation step in the audit covers it.
- **Disabled users' lists** — `importAll` already filters `user.isEnabled` (`:130`); see spec 53
  for the acquisition sweeps that do not.

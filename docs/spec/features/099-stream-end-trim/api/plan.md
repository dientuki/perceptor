---
title: Stream-End Trim — api slice
service: api
last_updated: 2026-10-19
status: Approved
---

# PLAN: Stream-End Trim — `api` (`api/plan.md`)

## Scope

`api` stores the installation switch and hands it to the worker: it makes the
`stream_end_trim_enabled` Setting editable (catalog), seeds it as `"false"`, and resolves it onto
`EncodeJobDetails.streamEndTrimEnabled`. It does **not** analyse anything, does not combine the
switch with `compression_enabled` or with `dub_trim_enabled`, adds no Prisma column, no migration, no
mutation and no error key. `web`'s switch and the worker's analysis belong to the other slices.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/settings/settings.catalog.ts` | Modified | `stream_end_trim_enabled: { kind: 'boolean' }`, right after `dub_trim_enabled` |
| `services/api/prisma/seeds/settings.ts` | Modified | `{ key: 'stream_end_trim_enabled', value: 'false' }`, right after `dub_trim_enabled` |
| `services/api/src/process-jobs/entities/encode-job-details.entity.ts` | Modified | `@Field() streamEndTrimEnabled: boolean`, right after `dubTrimEnabled` |
| `services/api/src/process-jobs/process-jobs.service.ts` | Modified | `getEncodeJobDetails()` sets it on `base` from `settingsMap`, beside `dubTrimEnabled` |
| `services/api/src/process-jobs/process-jobs.service.spec.ts` | Modified | the REQ-2 cases below |
| `services/api/src/schema.gql` | Regenerated | appears only as the boot artifact (Article IV) |

## Existing code to reuse

- The `dub_trim_enabled` entry in each of the four files above (`098`) — this slice is that entry
  again under a new key, in the same four places. Copy it; do not refactor the two into a list.
- `SettingsService.updateMany`'s `kind: 'boolean'` validation — already yields
  `error.setting.expected_boolean`; adding the catalog entry is the whole write path.
- `getEncodeJobDetails()`'s single `settingsMap` read and shared `base` — the field goes on `base`,
  so films and episodes read the same value with no extra query.
- The `=== 'true'` idiom (REQ-2), inline — no helper for a one-line comparison (Article X).

## Steps

1. Add `stream_end_trim_enabled: { kind: 'boolean' }` to `SETTINGS_CATALOG` (`// Spec 099, REQ-1`).
2. Add the seed row `{ key: 'stream_end_trim_enabled', value: 'false' }` (`// Spec 099, REQ-2`).
3. Add `streamEndTrimEnabled: boolean` (`@Field()`) to `EncodeJobDetails`.
4. In `getEncodeJobDetails()`, set
   `streamEndTrimEnabled: settingsMap['stream_end_trim_enabled'] === 'true'` on `base`
   (`// Spec 099, REQ-2`).
5. Extend the spec file, boot once so `schema.gql` regenerates, run the checks.

## Contract obligations

Expose exactly `EncodeJobDetails.streamEndTrimEnabled: Boolean!` as in `../spec.md` § GraphQL
Contract Delta, non-null on every job, film or episode. `updateSettings` refuses a non-boolean value
through the existing `error.setting.expected_boolean`; nothing new to add. The delta is read-only —
if it is wrong, stop and report.

## Tests

- `src/process-jobs/process-jobs.service.spec.ts` — owed (Article IX): a wrong read silently trims
  every encode or none. Mirror the `dubTrimEnabled` block: `'true'` → `true`; `'false'` → `false`;
  **absent row → `false`**; `'TRUE'`/`'1'` → `false`; the episode path reads the same value as the
  film path; and the two switches are independent (`dub_trim_enabled = 'true'` alone leaves
  `streamEndTrimEnabled` `false`, and vice versa).
- Catalog entry and seed row: no test of their own — boolean validation is covered by the settings
  suite, the seed by AC-11.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/comments api
```

all pass, and `services/api/src/schema.gql` shows `streamEndTrimEnabled: Boolean!` on
`EncodeJobDetails` and nothing else changed.

---
title: Dub-Card Tail Trim — api slice
service: api
last_updated: 2026-10-19
status: Implemented
---

# PLAN: Dub-Card Tail Trim — `api` (`api/plan.md`)

## Scope

`api` stores the installation switch and hands it to the worker. It makes the `dub_trim_enabled`
Setting editable (catalog), seeds it as `"false"`, and resolves it onto
`EncodeJobDetails.dubTrimEnabled`. It does **not** detect anything, does not combine the switch with
`compression_enabled` (the worker does that), adds no Prisma column, no migration, no mutation and no
error key. `web`'s switch and the worker's detector belong to the other slices.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/settings/settings.catalog.ts` | Modified | `dub_trim_enabled: { kind: 'boolean' }`, next to `grain_auto_enabled` |
| `services/api/prisma/seeds/settings.ts` | Modified | `{ key: 'dub_trim_enabled', value: 'false' }`, next to `grain_auto_enabled` |
| `services/api/src/process-jobs/entities/encode-job-details.entity.ts` | Modified | `@Field() dubTrimEnabled: boolean`, next to `compressionEnabled` |
| `services/api/src/process-jobs/process-jobs.service.ts` | Modified | `getEncodeJobDetails()` sets it on `base` from `settingsMap` |
| `services/api/src/process-jobs/process-jobs.service.spec.ts` | Modified | the REQ-2 cases below |
| `services/api/src/schema.gql` | Regenerated | appears only as the boot artifact (Article IV) |

## Existing code to reuse

- `src/settings/settings.catalog.ts` — the boolean `kind` already gets `"true"`/`"false"` validation
  and `error.setting.expected_boolean` from `SettingsService.updateMany`; adding the entry is the
  whole write path.
- `ProcessJobsService.getEncodeJobDetails()` — already reads `settingsMap` once
  (`this.settings.getMap()`) and builds a shared `base` for films and episodes. The new field goes on
  `base` — one place, both target kinds, no extra read (spec NFR-3 of `092`'s shape).
- `src/settings/grain-mode.ts` — the `=== 'true'` idiom to copy (REQ-2). Do **not** add a
  `dub-trim.ts` helper for a one-line comparison (Article X); inline it on `base`.
- `prisma/seeds/settings.ts` — create-only seed rows; copy the `grain_auto_enabled` entry.

## Steps

1. Add `dub_trim_enabled: { kind: 'boolean' }` to `SETTINGS_CATALOG`, with a `// Spec 098, REQ-1`
   locator.
2. Add the seed row `{ key: 'dub_trim_enabled', value: 'false' }` (`// Spec 098, REQ-2`).
3. Add `dubTrimEnabled: boolean` (`@Field()`) to `EncodeJobDetails`.
4. In `getEncodeJobDetails()`, set `dubTrimEnabled: settingsMap['dub_trim_enabled'] === 'true'` on
   `base` (`// Spec 098, REQ-2`). Not ANDed with `compressionEnabled` (see `../plan.md` § Contract
   Freeze).
5. Extend `process-jobs.service.spec.ts` (step below), boot once so `schema.gql` regenerates, and run
   the checks.

## Contract obligations

Expose exactly `EncodeJobDetails.dubTrimEnabled: Boolean!` as in `../spec.md` § GraphQL Contract
Delta, non-null on every job, film or episode. `updateSettings` refuses a non-boolean value through
the existing `error.setting.expected_boolean`; nothing new to add. The delta is read-only — if it is
wrong, stop and report.

## Tests

- `src/process-jobs/process-jobs.service.spec.ts` — owed (Article IX): a wrong read here silently
  trims every encode, or none, with no error. Mirror the existing `getEncodeJobDetails — grainMode`
  block: `dub_trim_enabled` `'true'` → `true`; `'false'` → `false`; **absent row → `false`**; a
  hand-edited `'TRUE'`/`'1'` → `false`; and the episode path reads the same value as the film path.
- The catalog entry and seed row need no test of their own — the boolean validation is already
  covered by the settings service suite, and the seed is verified by AC-9.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/comments api
```

all pass, and `services/api/src/schema.gql` shows `dubTrimEnabled: Boolean!` on `EncodeJobDetails`
and nothing else changed.

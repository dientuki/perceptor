---
title: Subtitle Format Selection — api slice
service: api
last_updated: 2026-09-25
status: Approved
---

# PLAN: Subtitle Format Selection — `api` (`api/plan.md`)

## Scope

`api` owns the five settings (catalog, validation, seed) and resolves them into the one effective
list `EncodeJobDetails.allowedSubtitleFormats`. It does **not** decide which streams are kept or how
they are written — that is the worker's `getSubtitleParams` — and it does not render anything.

Writes are confined to `services/api/` and this directory. Read `../spec.md` (REQ-5/6/7, NFR-1/2,
§ GraphQL Contract Delta) and `../plan.md` § "Decisions this plan makes" first.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/settings/settings.catalog.ts` | Modified | `SUBTITLE_TEXT_FORMATS`, `SUBTITLE_IMAGE_FORMATS` constants; `enum_list` in `SettingKind`; five catalog entries. |
| `services/api/src/settings/settings.service.ts` | Modified | `enum_list` branch in `updateMany`; excluded from the value-required check. |
| `services/api/src/settings/subtitle-formats.ts` | New | Pure `resolveAllowedSubtitleFormats(settingsMap): string[]` (REQ-7, NFR-2). |
| `services/api/src/settings/subtitle-formats.spec.ts` | New | Resolver tests. |
| `services/api/src/settings/settings.service.spec.ts` | Modified | `enum_list` validation/normalization cases. |
| `services/api/src/i18n/error-keys.ts` | Modified | `SETTING_EXPECTED_ENUM_LIST: 'error.setting.expected_enum_list'`. |
| `services/api/src/process-jobs/entities/encode-job-details.entity.ts` | Modified | `@Field(() => [String]) allowedSubtitleFormats: string[]`, no description. |
| `services/api/src/process-jobs/process-jobs.service.ts` | Modified | `base` gains `allowedSubtitleFormats` from the existing `settingsMap`. |
| `services/api/src/process-jobs/process-jobs.service.spec.ts` | Modified | Field present on both the movie and episode branch. |
| `services/api/prisma/seeds/settings.ts` | Modified | Five rows; empty-backfill opt-out on the two lists. |
| `services/api/src/schema.gql` | Regenerated | Exactly the one field. Never hand-edited (Article IV). |

## Existing code to reuse

- `COMPRESSION_RESOLUTIONS` / `DEFAULT_COMPRESSION_RESOLUTION` in `settings.catalog.ts` — the model
  for exported catalog constants the catalog entry and the resolver both read. Same note applies:
  the seed cannot import them (plain ts-node, no `@/*`), so its literals must match by hand.
- The `languages` branch of `SettingsService.updateMany` — split/trim/drop-empty and the rule that
  `""` is the empty list. `enum_list` follows it and adds dedupe + catalog-order re-sort.
- The `enum` branch — its error params shape `{ key, options: options.join(', ') }`; the new key uses
  the same params so `web` interpolates it identically.
- `i18nError.badRequest` + `ERROR_KEYS` — no ad-hoc exception.
- `ProcessJobsService.getEncodeJobDetails`'s existing `settingsMap` and `base` object — the new field
  goes into `base` beside `compressionResolution`, so both the movie and episode branches get it
  without duplication. No second `getMap()` call.
- The seed's create-only loop — extend its entry shape with an opt-out, don't add a second loop.

## Steps

1. `settings.catalog.ts`: export `SUBTITLE_TEXT_FORMATS = ['srt','ass','webvtt','mov_text'] as const`
   and `SUBTITLE_IMAGE_FORMATS = ['pgs','vobsub','dvb'] as const`; add `'enum_list'` to
   `SettingKind`; add `subtitles_enabled`/`subtitles_text_enabled`/`subtitles_image_enabled`
   (`boolean`) and `subtitles_text_formats`/`subtitles_image_formats`
   (`{ kind: 'enum_list', options: [...] }`).
2. `error-keys.ts`: add `SETTING_EXPECTED_ENUM_LIST`.
3. `settings.service.ts`: `enum_list` branch — split on `,`, trim, drop empty, dedupe; any id not in
   `options` → `i18nError.badRequest(SETTING_EXPECTED_ENUM_LIST, { key, options: options.join(', ') })`;
   push the value re-ordered into catalog order joined by `,`. Leave `enum_list` out of the
   value-required condition. Validation still completes for every entry before any write (existing
   two-loop structure).
4. `subtitle-formats.ts`: `resolveAllowedSubtitleFormats(map)`:
   - `subtitles_enabled === 'false'` → `[]`.
   - text on unless `subtitles_text_enabled === 'false'`; image on only if
     `subtitles_image_enabled === 'true'`.
   - each list: row absent (`undefined`) → full catalog for that group (NFR-1 defaults: all text ids,
     all image ids); present → split/trim, keep only ids in that group's catalog (NFR-2), catalog
     order.
   - result: text ids (if on) then image ids (if on).
5. `encode-job-details.entity.ts`: add the field. `process-jobs.service.ts`: add
   `allowedSubtitleFormats: resolveAllowedSubtitleFormats(settingsMap)` to `base`.
6. Seed: add the five rows with NFR-1 values
   (`true`, `true`, `srt,ass,webvtt,mov_text`, `false`, `pgs,vobsub,dvb`); give the entry type an
   optional `backfillEmpty: false` honoured by the `existing.value === ''` branch, set on the two list
   rows only.
7. Boot `api` (`bin/dev -d` already running hot-reloads) so `schema.gql` regenerates; confirm the
   diff is the one field.

## Contract obligations

Expose exactly `allowedSubtitleFormats: [String!]!` on `EncodeJobDetails`, always a list (never
`null`), containing only ids from REQ-1's catalog, empty for "no subtitles". `updateSettings` refuses
an out-of-group id with `error.setting.expected_enum_list`, params `{ key, options }`, and writes
nothing from that call. Missing rows and corrupt stored ids never fail `processJob` (NFR-2). Do not
expose the raw subtitle settings on `EncodeJobDetails`. The delta is read-only — stop and report if
it looks wrong.

## Tests

- `src/settings/subtitle-formats.spec.ts` — owed (Article IX): a wrong default here silently strips
  or adds subtitles in every encode and the files are permanent. Header paragraph names that.
  Cases: all rows missing → text catalog; `subtitles_enabled=false` → `[]` regardless of the rest;
  text on + empty list → `[]` (REQ-7); image row missing → no image ids; image on → text then image;
  corrupt ids (`pgs,garbage`, an image id in the text list) dropped; order is catalog order.
- `src/settings/settings.service.spec.ts` — owed: an `enum_list` that accepted a wrong id or dropped
  an empty value fails silently at encode time. Cases: `srt,pgs` and `srt,foo` refused with the new
  key and no upsert called; `""` accepted and stored as `""`; `"ass, srt,srt"` stored as `srt,ass`.
- `src/process-jobs/process-jobs.service.spec.ts` — extend the existing details assertions with the
  field on both branches; one case is enough, the logic is covered by the resolver test.
- The seed opt-out has no test harness today; it is covered by AC-3's restart check instead.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
git status --short services/api/prisma
git diff services/api/src/schema.gql
```

0 typecheck errors; all suites green; `prisma/` shows only `seeds/settings.ts` modified; the
`schema.gql` diff is exactly the one field.

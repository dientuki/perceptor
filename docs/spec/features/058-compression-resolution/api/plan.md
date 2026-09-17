---
title: Compression resolution — api slice
service: api
last_updated: 2026-09-16
status: Implemented
---

# PLAN: Compression resolution — `api` (`api/plan.md`)

## Scope

`api` accepts a fifth `compression_resolution` value (`480p`) and hands the installation's resolution
to the worker as `EncodeJobDetails.compressionResolution`, resolved at query time and normalized to
`1080p` when the stored row is missing or invalid. It does **not** decide anything about scaling,
codecs or tiers — that is `worker`'s — and it does not touch the Settings screen, which `web` owns.
No Prisma change and no migration.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/settings/settings.catalog.ts` | Modified | `480p` added to `COMPRESSION_RESOLUTIONS` between `720p` and `360p`; a `DEFAULT_COMPRESSION_RESOLUTION = '1080p'` export beside it |
| `services/api/src/process-jobs/entities/encode-job-details.entity.ts` | Modified | `@Field() compressionResolution: string;` after `compressionEnabled`, no comment, no description |
| `services/api/src/process-jobs/process-jobs.service.ts` | Modified | `getEncodeJobDetails` adds `compressionResolution` to `base`, from the same `settingsMap` |
| `services/api/src/process-jobs/process-jobs.service.spec.ts` | Modified | New `describe` for REQ-2/REQ-4 beside the existing `compressionEnabled` one |
| `services/api/prisma/seeds/settings.ts` | Modified | Delete the comment above `compression_resolution` — it says "one of the four values", now wrong (Article XI: comments are removed when the code around them is edited). The seeded value stays `'1080p'` |
| `services/api/src/schema.gql` | Regenerated | One line, `compressionResolution: String!` in `EncodeJobDetails` — generated, never hand-edited (Article IV) |
| `services/api/CLAUDE.md` | Modified | The `process-jobs/`/settings bullet that describes `compressionEnabled` mentions `compressionResolution` beside it, with the `1080p` fallback |

## Existing code to reuse

- `SETTINGS_CATALOG`'s `enum` kind (`settings.catalog.ts`) — already validates against
  `COMPRESSION_RESOLUTIONS` and raises `error.setting.expected_enum` listing the options. Widening
  the array is the whole of REQ-1; add no validation code.
- `ProcessJobsService.getEncodeJobDetails` — already calls `this.settings.getMap()` once and derives
  `compressionEnabled` from it. Read `compression_resolution` from that same map; do not call
  `getMap()` or `SettingsService.get()` a second time.
- The `compressionEnabled` tests in `process-jobs.service.spec.ts` (around line 203) — the mocked
  `settings.getMap` pattern is the template for the new cases.

## Steps

1. `settings.catalog.ts`: `COMPRESSION_RESOLUTIONS = ['4k', '1080p', '720p', '480p', '360p'] as const`
   and export `DEFAULT_COMPRESSION_RESOLUTION` typed as one of them.
2. `encode-job-details.entity.ts`: add the field.
3. `process-jobs.service.ts`: in `base`, resolve `settingsMap['compression_resolution']` — the raw
   value if it is one of `COMPRESSION_RESOLUTIONS`, otherwise `DEFAULT_COMPRESSION_RESOLUTION`. Both
   the film and the episode branch spread `base`, so REQ-2's "film and episode alike" follows.
4. `prisma/seeds/settings.ts`: remove the stale comment.
5. Tests (below). Regenerate `schema.gql` by booting the dev server and confirm the diff is exactly one
   added line.
6. Update `services/api/CLAUDE.md`.

## Contract obligations

Expose, exactly as `../spec.md` § GraphQL Contract Delta:

```graphql
type EncodeJobDetails {
  compressionResolution: String!
}
```

- Always one of `4k`, `1080p`, `720p`, `480p`, `360p` — never `null`, never the raw invalid row.
- Missing row or invalid value → `1080p`, no error, no log required.
- `updateSettings` with any other value → `BadRequestException` with `error.setting.expected_enum`
  (existing behaviour, now listing `480p`).

Not an enum, no field description. If either looks wrong, stop and report.

## Tests

- `src/process-jobs/process-jobs.service.spec.ts` — **owed**. A fallback that returns the raw row, or
  `undefined`, produces no error on this side and encodes at the wrong size on the other. Cases: each
  of the five values passes through verbatim; a missing row resolves to `1080p`; an unrecognised value
  (`'garbage'`, `'4K'` — case matters) resolves to `1080p`; an episode job carries it too.
- `settings.catalog.ts` / enum validation — **not owed**. The enum validator is generic and already
  tested for other enum keys; `480p` is data. A `updateSettings` round-trip for `480p` is covered by
  the manual pass (AC-1/AC-11).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
git status --short services/api/prisma
git diff services/api/src/schema.gql
```

0 typecheck errors; tests green with the new cases counted; `prisma/` shows only the seed file
modified (no migration directory); the `schema.gql` diff is the single added field.

---
title: Optional compression — api slice
service: api
last_updated: 2026-08-28
status: Implemented
---

# PLAN: Optional compression — `api` (`api/plan.md`)

## Scope

`api` makes `compression_enabled` a storable, validated settings key and hands its value to the
worker on the `processJob` query it already answers. That is the whole slice: three files, no new
module, no new resolver, no new guard, no Prisma migration.

`api` does **not** decide anything about compression. It does not skip, choose, or describe an
encode; it does not learn about file extensions or containers (`worker` owns REQ-10); it does not
render the switch (`web` owns REQ-1–REQ-4). It also does not open a settings query to the service
principal — `Query.settings` stays administrator-only, which is precisely why the flag travels on
`EncodeJobDetails`.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/settings/settings.catalog.ts` | Modified | One entry: `compression_enabled: { kind: 'boolean' }` |
| `services/api/prisma/seeds/settings.ts` | Modified | One row: `{ key: 'compression_enabled', value: 'true' }` |
| `services/api/src/process-jobs/entities/encode-job-details.entity.ts` | Modified | New `@Field()` `compressionEnabled: boolean` |
| `services/api/src/process-jobs/process-jobs.service.ts` | Modified | `getEncodeJobDetails` resolves the flag into `base` |
| `services/api/src/process-jobs/process-jobs.service.spec.ts` | Modified | New `describe` for REQ-7 (see § Tests) |
| `services/api/src/schema.gql` | Regenerated | Artifact of the decorator change — never hand-edited (Article IV) |

## Existing code to reuse

- `services/api/src/settings/settings.catalog.ts` — the `kind: 'boolean'` entries `movies_enabled`
  and `shows_enabled` are the exact precedent. Adding the entry is the *entire* validation change:
  `SettingsService.updateMany` already rejects any value that is not `"true"`/`"false"` with
  `ERROR_KEYS.SETTING_EXPECTED_BOOLEAN`, and already rejects unknown keys with
  `SETTING_NOT_EDITABLE`. **Write no new validation.**
- `services/api/src/settings/settings.service.ts` — `getMap()` is the house way to read a setting as
  `Record<string, string>`; `ProcessJobsService` already calls it in `resolveOutputRoot`.
- `services/api/src/process-jobs/process-jobs.service.ts` — `SettingsService` is already injected
  (constructor, `private readonly settings`) and `ProcessJobsModule` already imports
  `SettingsModule`. No wiring, no new provider, no module edit.
- `services/api/prisma/seeds/settings.ts` — the create-only loop at the bottom (`findUnique` →
  `create`, plus the empty-value backfill) is what makes seeding idempotent. Add the row to the
  array; do not touch the loop.
- `services/api/src/process-jobs/entities/encode-job-details.entity.ts` — the flattened
  "everything the worker needs in one round trip" entity. `isLiveAction: boolean` is the shape to
  copy for a non-null boolean field.

## Steps

1. Add `compression_enabled: { kind: 'boolean' }` to `SETTINGS_CATALOG`, beside `movies_enabled` /
   `shows_enabled`.
2. Add `{ key: 'compression_enabled', value: 'true' }` to the array in `prisma/seeds/settings.ts`,
   beside the same two.
3. Add the field to `EncodeJobDetails`:
   ```ts
   @Field()
   compressionEnabled: boolean;
   ```
   Copy the SDL description from `../spec.md` § GraphQL Contract Delta into the decorator's
   `description` only if the surrounding fields do it that way; otherwise leave the decorator bare
   and let the spec carry the prose (Article XI — the existing explanatory comments in this file are
   legacy, do not add more).
4. In `getEncodeJobDetails`, resolve the flag once and put it on `base`, so both the movie and the
   episode branch carry it. The read is `(await this.settings.getMap())['compression_enabled']`, and
   the rule is REQ-7: **anything other than the exact string `"false"` means compress**, so a missing
   row is `true`. Do not write it as `=== 'true'` — that reads a missing row as "off", which is the
   failure REQ-7 exists to forbid.
5. Reboot `api` so `autoSchemaFile` regenerates `src/schema.gql`, and confirm the regenerated field
   matches the frozen delta character for character (Article VIII's check).
6. Add the test in § Tests.

## Contract obligations

`api` owes `worker` exactly this, on the `processJob` query:

```graphql
type EncodeJobDetails {
  compressionEnabled: Boolean!
}
```

Non-null. Always answered, for every `ProcessJob`, in both the `MOVIE` and the `EPISODE` branch — a
field present on one branch and missing on the other is the shape of bug this entity's flat design
exists to prevent, which is why it goes on `base` rather than being repeated twice.

`api` owes `web` one new **catalog** key, `compression_enabled`, kind `boolean`, seeded `"true"`,
editable through the existing `updateSettings`. Its error conditions are the existing ones and no new
key is minted:

| Condition | Exception | i18n key |
| :-- | :-- | :-- |
| value is not `"true"`/`"false"` | `BadRequestException` | `error.setting.expected_boolean` |
| key absent from the catalog (i.e. this step was skipped) | `BadRequestException` | `error.setting.not_editable` |
| caller is not an administrator | `ForbiddenException` | `error.auth.admin_required` |

The delta is read-only. If it looks wrong from inside this service, stop and report — do not adapt
it locally (Constitution, Article VIII).

## Tests

Owed, in `services/api/src/process-jobs/process-jobs.service.spec.ts` (extend the existing suite —
its mocks for `PrismaService`, `SettingsService`, `MediaRootsService` are already in place):

- **REQ-7, the silent one.** A missing or unexpected `compression_enabled` row read as "off" produces
  no error anywhere: every job completes, every file lands in the right place, and an entire library
  is quietly left un-transcoded — discovered by disk usage, months later. Assert `compressionEnabled`
  is `true` when `getMap()` returns no such key, `true` for `"true"`, `false` for exactly `"false"`,
  and `true` for a junk value that somehow reached the row. Open the new `describe` with the sentence
  naming that failure (Article IX).
- Assert the field is present on **both** the movie and the episode branch.

Not owed: the catalog entry and the seed row. The boolean validation path they hook into is already
covered by `settings.service.spec.ts`'s existing kind checks, and a missing catalog entry fails loudly
and immediately (`error.setting.not_editable` on the first Save), which is the opposite of silent.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
bin/mysql -e 'select `key`, value from Setting where `key`="compression_enabled"'
```

`tsc` clean, the suite green with the new cases, and — after `bin/dbreset` or a fresh seed run — the
row present with value `true`. `git status services/api/src/schema.gql` shows the regenerated field
and nothing else changed in that file.

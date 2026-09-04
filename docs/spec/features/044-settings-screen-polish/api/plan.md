---
title: Settings Screen Polish — api slice
service: api
last_updated: 2026-09-04
status: Implemented
---

# PLAN: Settings Screen Polish — `api` (`api/plan.md`)

## Scope

This slice owns everything behind the GraphQL boundary: the Prisma migration that moves
`TorrentGroupScope` from `torrent_groups` to `user_torrent_groups`, the two administrator mutations
that fill and empty the catalog, the resulting shape changes on `TorrentGroup` and
`UserPreferences`, and the new `compression_resolution` setting key with its seed.

It does **not** touch any screen. Every visual requirement in `../spec.md` (REQ-1 through REQ-8) is
`web`'s, including the group input that calls the mutations written here. This slice also does not
make anything *read* `compression_resolution` — it is a validated, stored value and nothing more
(`../spec.md` § Out of Scope).

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` | Modified | `TorrentGroup.scope` dropped, `name` becomes `@unique`; `UserTorrentGroup.scope` added and joined into the `@@id` |
| `prisma/migrations/<timestamp>_torrent_group_scope_per_user/migration.sql` | New | The seven ordered statements in `../plan.md` § Migrations |
| `prisma/seeds/settings.ts` | Modified | One line: `{ key: 'compression_resolution', value: '1080p' }` |
| `src/settings/settings.catalog.ts` | Modified | `compression_resolution: { kind: 'enum', options: COMPRESSION_RESOLUTIONS }` |
| `src/preferences/entities/torrent-group.entity.ts` | Modified | `scope` field removed |
| `src/preferences/entities/user-preferences.entity.ts` | Modified | `torrentGroups` replaced by `movieTorrentGroups` / `showTorrentGroups` |
| `src/preferences/preferences.service.ts` | Modified | `findCatalog` loses its argument; scope narrowing moves onto the join row; `createTorrentGroup` / `deleteTorrentGroup` added |
| `src/preferences/preferences.resolver.ts` | Modified | `torrentGroups` loses `scope`; two `AdminGuard` mutations added; class header comment rewritten |
| `src/preferences/preferences.module.ts` | Modified | Only if `AdminGuard`'s dependency needs wiring — check before editing |
| `src/i18n/error-keys.ts` | Modified | `TORRENT_GROUP_NAME_TAKEN` and `VALIDATION_TORRENT_GROUP_NAME_REQUIRED` added; `TORRENT_GROUP_WRONG_SCOPE` removed |
| `src/i18n/messages.en.ts` | Modified | English copy for the two new keys; the removed key deleted |
| `src/preferences/preferences.service.spec.ts` | Modified | Fake gains `scope` on the selection row; the `wrong_scope` test is deleted; two new tests (below) |
| `src/schema.gql` | Regenerated | Never hand-edited (Constitution, Article IV) |

## Existing code to reuse

- `src/settings/settings.catalog.ts` — the `enum` `SettingKind` already exists and
  `SettingsService.updateMany` already validates against `options` and rejects `''`. `compression_resolution`
  needs **no validation code at all**, only a catalog entry. Declare the four values as an exported
  const in the catalog file the way `MEDIA_SERVER_IDS` and `SUPPORTED_LOCALES` are pulled in — one
  list, not a literal repeated between catalog and seed.
- `src/i18n/i18n-error.ts` — every throw goes through `i18nError.badRequest` / `i18nError.notFound`
  with a key from `error-keys.ts`. Never `new BadRequestException('...')`.
- `src/auth/guards/admin.guard.ts` — applied per method with `@UseGuards(AdminGuard)`. It re-reads
  `isAdmin` from the database on every call; do not add an `isAdmin` check of your own beside it.
  `src/settings/settings.resolver.ts` is the precedent for one resolver mixing guard strengths per
  method — read its class header comment before writing this one's.
- `PreferencesService.findSelectedTorrentGroupsFor(userId, scope?)` — already the single read path
  for a user's selection. It stays; only its `where` changes, from a join through `torrentGroup` to
  a plain column on `user_torrent_groups`.
- `src/preferences/preferences.service.spec.ts` — the in-memory fake of the two tables. Extend it
  with the new column; do not replace it with argument-recording mocks (its own header explains why).

## Steps

1. **Schema.** In `prisma/schema.prisma`: drop `scope` from `TorrentGroup`, replace
   `@@unique([name, scope])` with `name String @unique`; add `scope TorrentGroupScope` to
   `UserTorrentGroup` and change `@@id([userId, torrentGroupId])` to
   `@@id([userId, torrentGroupId, scope])`. The `TorrentGroupScope` enum itself is unchanged.
2. **Migration.** Generate with `bin/npm api run prisma:migrate`, then reorder the generated SQL to
   match `../plan.md` § Migrations exactly. The widened primary key (statement 4) **must** be in
   place before the duplicate repoint (statement 5) — Prisma will not produce that order on its own,
   and getting it wrong aborts the migration mid-way on any populated installation. Apply it and
   confirm with `bin/cli api npx --no prisma migrate status`.
3. **Entities.** Remove `@Field` `scope` from `TorrentGroup`. On `UserPreferences`, replace the
   `torrentGroups` field with `movieTorrentGroups` and `showTorrentGroups`, both
   `[TorrentGroup!]!`, keeping the descriptions accurate — the current one says "web splits it by
   `scope`", which stops being true.
4. **Service reads.** `findCatalog()` loses its `scope` parameter and its `where`. `toTorrentGroup`
   loses the `scope` mapping and its row type. `findSelectedTorrentGroupsFor(userId, scope?)`
   narrows on `{ userId, scope }` directly instead of `{ torrentGroup: { scope } }`. `findForUser`
   resolves both scopes — two calls into the existing helper, feeding the two new fields.
5. **Service writes.** In `setPreferredTorrentGroupsFor`: the `row.scope !== prismaScope` rejection
   is **deleted** (any catalog id is now valid for either scope) along with `TORRENT_GROUP_WRONG_SCOPE`;
   the `deleteMany` narrows on `{ userId, scope: prismaScope }`; `createMany` writes the `scope` on
   each row. The duplicate-id and not-found rejections stay exactly as they are. Keep the whole thing
   inside the existing `$transaction`.
6. **Catalog writes.** Add `createTorrentGroup(name)` and `deleteTorrentGroup(id)` to
   `PreferencesService`. `create` trims the name, rejects empty with
   `VALIDATION_TORRENT_GROUP_NAME_REQUIRED`, and rejects a collision with `TORRENT_GROUP_NAME_TAKEN`
   — compared **case-insensitively**, and additionally by catching Prisma's `P2002` on the insert,
   because MariaDB's default collation makes the unique index case-insensitive too and a raw `P2002`
   would reach the user untranslated. `delete` throws `TORRENT_GROUP_NOT_FOUND` for an id no row has;
   the `onDelete: Cascade` on `UserTorrentGroup` already removes every user's selection of it, so do
   not delete those rows by hand.
7. **Resolver.** `torrentGroups` loses its `@Args('scope')`. Add the two mutations, each
   `@UseGuards(AdminGuard)`, returning `TorrentGroup!` and `Boolean!` per the frozen delta. Rewrite
   the class header comment — "every operation is rooted at `@CurrentUser()`" is no longer true, and
   the reason the catalog query stays non-admin (`/preferences` is not an admin screen) belongs
   there.
8. **Settings key.** Add `compression_resolution` to `SETTINGS_CATALOG` as an `enum` over
   `['4k', '1080p', '720p', '360p']`, and the seeded default `'1080p'` to `prisma/seeds/settings.ts`.
   The seed is create-only, so an existing installation gains the key without any other key being
   touched.
9. **i18n.** Add the two new keys to `error-keys.ts` and their English text to `messages.en.ts`.
   Delete `TORRENT_GROUP_WRONG_SCOPE` from both — leaving a key nothing throws is dead weight
   (Article X), and `web` deletes its side in the same feature.
10. **Regenerate and diff.** Boot the api, then `git diff services/api/src/schema.gql` and confirm it
    matches `../spec.md` § GraphQL Contract Delta line for line. Any difference is a contract
    violation, not a formatting detail.

## Contract obligations

This slice **produces** the shape in `../spec.md` § GraphQL Contract Delta. Exactly:

- `TorrentGroup { id: Int!, name: String! }` — no `scope`.
- `torrentGroups: [TorrentGroup!]!` — no argument, `JwtAuthGuard` only, **not** `AdminGuard`.
- `UserPreferences.movieTorrentGroups` / `.showTorrentGroups`, both `[TorrentGroup!]!`.
- `createTorrentGroup(name: String!): TorrentGroup!` and `deleteTorrentGroup(id: Int!): Boolean!`,
  both `AdminGuard`.
- `setPreferredTorrentGroups(scope: TorrentGroupScope!, ids: [Int!]!): [TorrentGroup!]!` — signature
  unchanged.

Errors, with the exact key each condition must throw:

| Condition | Throw |
| :-- | :-- |
| `createTorrentGroup`, name already in the catalog (trimmed, case-insensitive, or `P2002`) | `i18nError.badRequest(TORRENT_GROUP_NAME_TAKEN, { name })` |
| `createTorrentGroup`, empty or whitespace-only name | `i18nError.badRequest(VALIDATION_TORRENT_GROUP_NAME_REQUIRED)` |
| `deleteTorrentGroup`, unknown id | `i18nError.notFound(TORRENT_GROUP_NOT_FOUND, { id })` |
| Either mutation, non-administrator | `AdminGuard` throws `AUTH_ADMIN_REQUIRED` — write no check of your own |
| `compression_resolution` outside the four values | `SettingsService.updateMany` already throws `SETTING_EXPECTED_ENUM` — write no check of your own |

If the delta is wrong, stop and report. Do not adapt it locally (Constitution, Article VIII).

## Tests

- `src/preferences/preferences.service.spec.ts` — **owed, and already exists**. The silent failure it
  defends against is unchanged in substance: a `deleteMany` that loses its narrowing wipes the
  sibling scope's rows, or another user's rows, with no exception and no failing assertion in `web`.
  What changes is that the narrowing is now a column rather than a join, which is a rewrite of the
  fake's `where` handling, not of the suite's purpose. Concretely: `SelectionRow` gains `scope`; the
  two "leaves the sibling scope / another user's rows in place" tests must pass unchanged in intent;
  the `wrong_scope` test is deleted; and one new test is owed — **the same group id selected for
  both scopes produces two rows and neither save clobbers the other**, which is the case the old
  `(userId, torrentGroupId)` primary key made impossible and the new one permits.
- `src/preferences/preferences.service.spec.ts` (catalog writes) — one test for the case-insensitive
  collision. A `FLUX`/`flux` pair that passes the service check and is caught only by the unique
  index reaches the user as an untranslated `P2002`, which is a visible failure but the wrong one;
  worth a test because the JS comparison and the column collation are two different authorities that
  nothing forces to agree.
- `src/settings/settings.service.spec.ts` — **not owed**. `compression_resolution` adds a catalog
  entry and no code; the `enum` kind's validation is already exercised there by `media_server_client`
  and `ui_locale`. A fourth copy of that assertion tests the same branch a third time.
- The migration itself — **not unit-testable here**. It is verified by applying it and by AC-10,
  which reads the resulting rows directly.

## Done when

```bash
bin/cli api npx --no prisma migrate status
bin/npm api run test
bin/cli api npx --no tsc --noEmit
git diff services/api/src/schema.gql
```

`migrate status` reports no pending migration, the suite is green with no reduction in the passing
count beyond the one deleted `wrong_scope` test, `tsc` is at 0 errors, and the `schema.gql` diff
matches `../spec.md` § GraphQL Contract Delta exactly.

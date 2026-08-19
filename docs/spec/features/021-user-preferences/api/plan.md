---
title: User Preferences — api slice
service: api
last_updated: 2026-08-19
status: Approved
---

# PLAN: User Preferences — `api` (`api/plan.md`)

Read `../spec.md` and `../plan.md` first. The GraphQL delta in `../spec.md` is read-only.

## Scope

`api` owns the migration, the new `TorrentGroupScope` enum, a new `torrent-groups/` module, one new
column on `User`, and the two new mutations plus the one new query in `../spec.md`'s delta. It also
adds one guarded field resolver, `User.preferredTorrentGroups`, beside the existing
`User.preferredLanguages`.

`api` does **not** touch the language surface. `setPreferredLanguages`, `LanguagesService` and the
`languages` query are re-used by `web` exactly as they are and must come out of this feature byte
for byte unchanged — `web` is only moving the card that calls them to a different page. `api` also
does not touch `setUiLocale` / `supportedLocales` / `User.uiLocale`: those are `018-ui-i18n`'s and
must already exist when this slice starts. `api` builds no UI and seeds no torrent groups — the
catalog ships empty on purpose (REQ-7), and the admin CRUD that fills it is a different feature.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report (see
`.claude/agents/api.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/prisma/schema.prisma` | Modified | `TorrentGroupScope` enum, `TorrentGroup`, `UserTorrentGroup`, `User.allowCinemaReleases` + the `torrentGroups` back-relation |
| `services/api/prisma/migrations/…_add_torrent_groups_and_cinema_flag/` | New | Two tables, one column. No backfill |
| `services/api/src/torrent-groups/torrent-groups.module.ts` | New | Provides + exports `TorrentGroupsService`, provides `TorrentGroupsResolver` |
| `services/api/src/torrent-groups/entities/torrent-group.entity.ts` | New | `@ObjectType() TorrentGroup` + the `TorrentGroupScope` enum registered for GraphQL |
| `services/api/src/torrent-groups/torrent-groups.service.ts` | New | `findAll(scope?)`, `findPreferredFor(userId)`, `setPreferredFor(userId, scope, ids)` |
| `services/api/src/torrent-groups/torrent-groups.resolver.ts` | New | `torrentGroups` query, `setPreferredTorrentGroups` mutation |
| `services/api/src/torrent-groups/torrent-groups.service.spec.ts` | New | The scope-isolation and validation cases (see § Tests) |
| `services/api/src/users/entities/user.entity.ts` | Modified | `allowCinemaReleases` plain field, `preferredTorrentGroups` field-resolver-backed field |
| `services/api/src/users/users.service.ts` | Modified | `setAllowCinemaReleases(userId, allowed)` |
| `services/api/src/auth/auth.resolver.ts` | Modified | `setAllowCinemaReleases` mutation + the guarded `preferredTorrentGroups` field resolver |
| `services/api/src/auth/auth.module.ts` | Modified | Import `TorrentGroupsModule` (the field resolver reads its service) |
| `services/api/src/app.module.ts` | Modified | Register `TorrentGroupsModule` |
| `services/api/src/i18n/error-keys.ts` | Modified | The three `error.torrent_group.*` keys |
| `services/api/src/i18n/messages.en.ts` | Modified | Their English templates, from `../spec.md`'s error table |
| `services/api/src/schema.gql` | Regenerated | Never hand-edited (Article IV) |

`TorrentGroupsModule` is the **only** new Nest module in this slice. A second one means the plan
missed something — report it rather than creating it.

## Existing code to reuse

- **`src/languages/` in its entirety** — this module is the template, not merely an inspiration.
  `languages.module.ts` (no explicit `PrismaModule` import; it is global), `entities/language.entity.ts`
  (`@ObjectType`, `@Field(() => ID)` on the numeric id), `languages.resolver.ts` (the
  `@CurrentUser()`-only mutation with no user argument and no `@AllowService()`), and above all
  `languages.service.ts`. Copy its structure; do not invent a different one.

- **`LanguagesService.resolveLanguageIds` (`languages.service.ts:40-70`)** — the exact shape
  `resolveTorrentGroupIds` must take: reject duplicates from a `Set` first, return early on an empty
  list, then one `findMany` and a map lookup that throws on the first unknown id. The new work on top
  is the scope check, which belongs in the same pass — an id that resolves but whose `scope` differs
  from the argument throws `error.torrent_group.wrong_scope` there, before any write.

- **The file-header comment on `languages.service.ts:8-16`** — it states why validation precedes the
  delete and why the pair is transactional. Write the equivalent paragraph on the new service; do not
  copy the words, and do not ship the file without it.

- **`setPreferredLanguagesFor` (`languages.service.ts:73-87`)** — the `$transaction` /
  `deleteMany` + `createMany` / re-read shape. The **one** deliberate divergence: its `deleteMany`
  filters on `{ userId }`, and yours must filter on `{ userId, torrentGroup: { scope } }` (or the
  equivalent id-list form). This is the single line where a copy-paste becomes the top risk in
  `../plan.md`.

- **`AuthResolver.preferredLanguages` (`auth.resolver.ts:73-90`)** — the guarded field resolver,
  including the comment explaining that field resolvers attach per *type*, so the admin
  `users`/`user(id)` queries can select it too, and that a non-caller parent gets `[]` rather than a
  thrown error. `preferredTorrentGroups` is the same guard against the same hole; put it directly
  beside it.

- **`UsersService`'s write methods (`src/users/users.service.ts`)** — `setAllowCinemaReleases` is an
  ordinary `prisma.user.update` returning the row minus `password`. Nothing to validate: a boolean
  cannot be invalid. Follow `018-ui-i18n`'s placement of `setUiLocale` — the write in `UsersService`,
  the mutation exposed on `AuthResolver` where the self-service surface lives, not on
  `UsersResolver`, which is `@UseGuards(AdminGuard)` in its entirety.

- **`AuthService.getProfile` (`auth.service.ts:82`) and `UsersService.findAll`/`findOne`** — all three
  return whole Prisma rows with no `select`, so `allowCinemaReleases` arrives automatically once the
  column exists. **No change is needed in any of them**; if you find yourself editing a `select`, you
  are on the wrong path.

- **`src/i18n/error-keys.ts`, `messages.en.ts` and `i18n-error.ts` (`018-ui-i18n`)** — the three new
  keys are constants there and the throws use the existing `badRequest(key, params)` factory. Do not
  throw a bare `new BadRequestException('…')` with a Spanish sentence; that is the coupling `018`
  just removed.

- **`SettingsService` / `settings.catalog.ts`** — named here only to be excluded. `allowCinemaReleases`
  is per-user; `Setting` is one global key/value table. Adding a key would be wrong even though
  `movies_enabled` sits right beside it in the same UI today.

## Steps

1. Add `TorrentGroupScope`, `TorrentGroup`, `UserTorrentGroup` and `User.allowCinemaReleases` (plus
   the `torrentGroups UserTorrentGroup[]` back-relation on `User`) to `schema.prisma`, following the
   `Language`/`UserLanguage` block immediately above as the model — including `@@map` to snake_case
   table names and `@@index` on the non-leading half of the composite key. Generate the migration
   with `bin/npm api run prisma:migrate`. Confirm `git status services/api/prisma/` shows both a
   modified schema and a new migration directory.

2. Add the three `error.torrent_group.*` keys to `src/i18n/error-keys.ts` and their English templates
   to `messages.en.ts`, copied from `../spec.md`'s error table. Do this before the service, so the
   throws have something to reference.

3. Write `entities/torrent-group.entity.ts`: the `TorrentGroupScope` enum registered with
   `registerEnumType`, and the `@ObjectType() TorrentGroup`. Mirror `language.entity.ts`, including a
   header comment saying what the model is for and that the catalog is administrator-loaded.

4. Write `torrent-groups.service.ts`:
   - `findAll(scope?: TorrentGroupScope)` — the catalog, optionally filtered, sorted by `name`.
   - `resolveTorrentGroupIds(scope, ids)` — private; duplicates, then unknown, then wrong-scope, all
     before any write.
   - `setPreferredFor(userId, scope, ids)` — resolve, then `$transaction`: delete only this user's
     rows **in this scope**, insert the new ones, re-read.
   - `findPreferredFor(userId)` — both scopes, unfiltered, for the field resolver.

5. Write `torrent-groups.resolver.ts` — the `torrentGroups` query (optional `scope` arg, any
   authenticated user) and the `setPreferredTorrentGroups` mutation (`@CurrentUser()`, no user
   argument, no `@AllowService()`), copying `languages.resolver.ts`'s comment about why there is no
   user argument.

6. Write `torrent-groups.module.ts` and register it in `app.module.ts`.

7. Add the `preferredTorrentGroups` field resolver to `auth.resolver.ts` beside `preferredLanguages`,
   with the identical non-caller `[]` guard, and import `TorrentGroupsModule` in `auth.module.ts`
   (extend the existing comment there that explains why `LanguagesModule` is imported).

8. Add `allowCinemaReleases` and `preferredTorrentGroups` to `user.entity.ts` — the first a plain
   `@Field()`, the second `@Field(() => [TorrentGroup])` and optional in TypeScript for the same
   reason `preferredLanguages` is: nothing that constructs a bare `User` populates it.

9. Add `setAllowCinemaReleases` to `users.service.ts` and expose the mutation on `auth.resolver.ts`.

10. Write `torrent-groups.service.spec.ts` (see § Tests).

11. Restart `api` so `schema.gql` regenerates, and diff it against `../spec.md`'s delta. They must
    match exactly (Article VIII's check). A difference is either an unreported contract change or a
    stale spec — stop and report either way.

## Contract obligations

`api` must expose exactly the SDL in `../spec.md` § GraphQL Contract Delta, plus the three error keys
in its table. Points that are easy to get subtly wrong:

- `torrentGroups(scope: TorrentGroupScope)` — the argument is **optional**; omitted returns the whole
  catalog. `web` calls it in that form.
- `preferredTorrentGroups: [TorrentGroup!]!` — **not** scope-filtered and takes no argument. `web`
  splits it by `scope`.
- `setPreferredTorrentGroups(scope: TorrentGroupScope!, ids: [Int!]!): [TorrentGroup!]!` — returns
  the selection **for the scope just written**, not both scopes.
- `setAllowCinemaReleases(allowed: Boolean!): User!` — returns the whole updated user.
- Every error is a key, params and an English message, never a Spanish sentence (`018-ui-i18n`).
- `allowCinemaReleases` is non-null in the schema. The column is `NOT NULL DEFAULT false`, so this
  holds for pre-existing rows without a backfill.

The delta is read-only. If it is wrong, stop and report — do not adapt it locally.

## Tests

`services/api/src/torrent-groups/torrent-groups.service.spec.ts` — **owed**, and it is the reason
this feature has a test at all. Open it with the paragraph Article IX requires, naming the failure:
a scope-blind write reports success while destroying the user's selection in the *other* scope, and
a scope-blind read/filter reports success for a set that is not the set the caller sent. Neither
produces an error in any log; the user discovers it later on a screen they were not looking at.

Cases, following `languages.service.spec.ts`'s mocked-Prisma style:

- Writing `MOVIE` preferences leaves the user's `SHOW` rows intact — the `deleteMany` is called with
  a scope-narrowed `where`, never with a bare `{ userId }`.
- An id belonging to the other scope is rejected with `error.torrent_group.wrong_scope`, and
  **`deleteMany` is never called** — proving validation precedes the write.
- An unknown id is rejected with `error.torrent_group.not_found`, likewise with no write.
- A duplicated id is rejected with `error.torrent_group.duplicated` without even querying
  `torrent_groups` — it is a pure input check, exactly as `resolveLanguageIds` treats duplicates.
- An empty `ids` list clears only the given scope and performs no `createMany`.

**Not owed**: `setAllowCinemaReleases` (a boolean write with nothing to validate; a bug there is
visible on the first reload), `findAll` (a `findMany` and a sort), and the `preferredTorrentGroups`
field resolver — the guard is three lines copied verbatim from an existing one, and AC-11 exercises
it live. Do not add `expect(service).toBeDefined()` files; Article IX names those as scaffolding.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
```

Typecheck reports **0 errors**. The suite reports no failures and one more suite than the 16
recorded in the root `CLAUDE.md` — report the before and after counts rather than the expected ones.
`migrate status` reports the database up to date with no pending migration. `git status
services/api/prisma/` shows a modified `schema.prisma` and exactly one new migration directory.

---
title: TMDB List Import — api slice
service: api
last_updated: 2026-10-28
status: Implemented
---

# PLAN: TMDB List Import — `api` (`api/plan.md`)

## Scope

`api` owns everything that persists or talks to TMDB in this feature: the two new tables and their
migration, the two seeded schedule settings, the `TmdbList` type with its query and two mutations,
`MediaCapabilities.listImportEnabled`, the `import_lists` scheduled task, the TMDB list read, and the
`register()` create-race fix for films and series (NFR-4). It does **not** render anything:
`/preferences` and the scheduler task's label are `web`'s. It never starts an acquisition (REQ-11).

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` + `prisma/migrations/<ts>_tmdb_list_import/` | Modified / New | `UserTmdbList`, `UserTmdbListItem`, back-relation on `User` |
| `prisma/seeds/settings.ts` | Modified | `schedule_import_lists_enabled`/`_cron` rows |
| `src/settings/settings.catalog.ts` | Modified | the two keys as `boolean`/`cron`, like `schedule_acquire_movies_*` |
| `src/clients/tmdb/client.ts`, `types.ts`, `errors.ts` | Modified | `list(listId, page)` returning name, items (`movie`/`show` + tmdbId), `totalPages`; TMDB's error `status_code` carried on `TmdbHttpError` |
| `src/tmdb-lists/` (module, resolver, service, `entities/tmdb-list.entity.ts`, `list-reference.ts`) | New | the contract surface, attach/detach, and the per-list import |
| `src/scheduler/tasks/import-lists.task.ts` | New | handler calling `TmdbListsService.importAll()` |
| `src/scheduler/scheduler.registry.ts`, `scheduler.module.ts` | Modified | register `import_lists` (`0 */6 * * *`, no `mediaType`), import `TmdbListsModule` |
| `src/media/media.module.ts` | Modified | export `MediaDispatchService` |
| `src/media/entities/media-capabilities.entity.ts`, `media-capabilities.service.ts` | Modified | `listImportEnabled` |
| `src/movies/movies.service.ts`, `src/shows/shows.service.ts` | Modified | create-race recovery in `register()` |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | four new `error.tmdbList.*` keys |
| `src/app.module.ts` | Modified | import `TmdbListsModule` |

## Existing code to reuse

- `src/media/media-dispatch.service.ts` — `resolve(type).register(tmdbId, userId)` is **the** way
  to register; never call `MoviesService`/`ShowsService` by type switch in the new module.
- `src/media/media-capabilities.service.ts` — `isEnabled(type)` for REQ-8's skip; `read()` already
  holds the settings map `listImportEnabled` is computed from. Read the key
  `schedule_import_lists_enabled` by name there — importing `scheduler.registry.ts` would pull every
  task handler into the media module's import graph.
- `src/clients/tmdb/client.ts` `fetchOne()` — build `list()` on it (key, host, version, error);
  `fetchResults()` drops `total_pages`, so it is the wrong base.
- `src/media/popular-media.service.ts` — the `TmdbHttpError` 401 → `MEDIA_CATALOG_UNAUTHORIZED`,
  other → `MEDIA_CATALOG_UNAVAILABLE` mapping; follow it, extended with 404/private →
  `error.tmdbList.unreadable`.
- `src/scheduler/tasks/refresh-movies.task.ts` — per-item `try`, count, then throw one summary
  error at the end if anything failed, so the run is `FAILED` but complete.
- `src/i18n/i18n-error.ts` (`i18nError.badRequest/conflict/notFound/serviceUnavailable`) for every
  thrown error; never a bare Nest exception with English prose.
- `CurrentUser` + `AuthPrincipal` as in `src/preferences/preferences.resolver.ts`; refuse a
  non-`user` principal the way the existing user-scoped resolvers do.

## Steps

1. **Race fix (NFR-4)**, independent of the rest: in `MoviesService.register()` and
   `ShowsService.register()`, a Prisma unique violation (`P2002`) on the title `create` re-reads the
   row by `tmdbId` and continues through the existing "already registered" branch (link,
   reconcile; for a series the hydrate-or-reconcile choice). Nothing else changes in either
   method.
2. **Schema + migration**: `UserTmdbList { id Int @id @default(autoincrement()), userId, tmdbListId
   Int, name String, lastImportedAt DateTime?, lastError String?, createdAt; @@unique([userId,
   tmdbListId]); @@map("user_tmdb_lists") }` and `UserTmdbListItem { listId, tmdbId Int, mediaType
   String @db.VarChar(5), seenAt @default(now()); @@id([listId, tmdbId, mediaType]);
   @@map("user_tmdb_list_items") }`, cascades as in the spec. `bin/npm api run prisma:migrate`.
3. **Seed + catalog**: the two `schedule_import_lists_*` rows and catalog entries.
4. **TMDB client**: `list(listId: number, page: number)` against `list/{id}?page=n`; map
   `media_type` `movie` → `movie`, `tv` → `show`, drop anything else. Carry TMDB's body
   `status_code` on `TmdbHttpError` (optional field) so a caller can tell an invalid key
   (`status_code` 7) from a private list.
5. **`list-reference.ts`**: pure `parseListReference(input): number | null` — a positive integer,
   or a `themoviedb.org` URL whose path ends `/list/<digits>` optionally followed by `-slug`, with
   any locale prefix, query or fragment. Anything else is `null`.
6. **`TmdbListsService`**:
   - `attach(userId, reference)`: parse → `invalid_reference`; empty key → `catalog_unauthorized`;
     duplicate (check first, and map the unique violation too) → `already_attached`; `list(id, 1)`
     with the mapping above → stores `name`.
   - `detach(userId, id)`: delete scoped by `userId`; zero rows → `not_found`.
   - `listFor(userId)`: ordered by `createdAt`.
   - `importAll()`: if the key is empty, return 0 without any call (NFR-3). For every list of every
     `isEnabled` user, oldest first, sequentially: read every page; on failure write the mapped
     key to `lastError` and move on; on success write `name`, `lastImportedAt`, clear `lastError`,
     then for each item in order: already seen → skip; type disabled → skip, not seen; owned by
     the user → mark seen; else `register` then mark seen, and an item failure leaves it unseen.
     Load the list's seen set and the user's owned `tmdbId`s once per list, not per item (NFR-1).
     Return titles registered and lists failed.
7. **Resolver**: `tmdbLists`, `addTmdbList`, `removeTmdbList` exactly as the spec's SDL.
8. **Task**: `ImportListsTask.run()` calls `importAll()`; throws a summary error when any list
   failed, else returns `itemsProcessed` = titles registered. Register in the registry and module.
9. **Capabilities**: `listImportEnabled = map['schedule_import_lists_enabled'] === 'true'`.
10. **i18n**: `error.tmdbList.invalid_reference`, `unreadable`, `already_attached`, `not_found` in
    `error-keys.ts` and English text in `messages.en.ts`.

## Contract obligations

Expose exactly `../spec.md` § GraphQL Contract Delta: `TmdbList { id, tmdbListId, name,
lastImportedAt, lastError }`, `MediaCapabilities.listImportEnabled: Boolean!`, `tmdbLists:
[TmdbList!]!`, `addTmdbList(reference: String!): TmdbList!`, `removeTmdbList(id: Int!): Boolean!`,
with every error in the spec's table carried as its i18n key. `lastError` holds only one of the
three keys the spec lists. The generated `schema.gql` diff must match the SDL (Article VIII); a
nullable you did not expect, or a renamed argument, is a stop-and-report, not a local fix.

## Tests

- `src/movies/movies.service.spec.ts`, `src/shows/shows.service.spec.ts` — extend: a `create` that
  throws `P2002` ends with the caller linked and reconciled and no error. Defends against the loser
  of a concurrent registration silently not owning what it added (NFR-4, AC-6b).
- `src/tmdb-lists/tmdb-lists.service.spec.ts` — new, header naming the silent failures: a seen
  item re-registered after the user removed it (REQ-7), a disabled-type item marked seen and never
  imported (REQ-8), a failed item marked seen, one failing list stopping the others (REQ-10), only
  page one imported, an owned item calling `register()`. Fake `TmdbClient` and dispatch; real
  logic.
- `src/tmdb-lists/list-reference.spec.ts` — new: a mis-parsed URL attaches a different list than
  the one pasted, and the only evidence is a name the user may not recognise.
- Not owed: the resolver (thin delegation, errors covered in the service spec), the task handler
  (one call plus the existing summary-error pattern), `listImportEnabled` (one comparison, visible
  in `/preferences` on the manual pass).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/npm api run lint
bin/comments api
bin/cli api npx prisma migrate status
```

All pass; `schema.gql` regenerated on boot shows exactly the spec's SDL delta.

## Amendment 0.2.0

1. `UserTmdbList.itemCount Int?` and migration `tmdb_list_item_count` (`bin/npm api run
   prisma:migrate`, applied on the dev stack).
2. `TmdbClient.list()` also returns `itemCount` from TMDB's body `item_count` (absent → `null`).
3. `attach` stores it; a successful list read in `importAll` writes it beside `name`/`lastImportedAt`.
4. `TmdbList` entity: `itemCount`; `Query.tmdbList(id)` (user principal, `null` when not the
   caller's); `@ResolveField` `movies`/`shows` on `TmdbList`: titles whose `tmdbId` is in the list's
   `UserTmdbListItem` rows of that media type **and** owned by the caller (`users: { some: { userId
   } }`), ordered by title, selecting what `web`'s listing selects. Reuse the existing `Movie`/`Show`
   entities.
5. Tests (Article IX), in `tmdb-lists.service.spec.ts`: the titles read returns only items both seen
   by the list and owned by the caller (a title owned but not in the list, and a title in the list but
   owned only by another user, are both excluded); `itemCount` is written on attach and on a
   successful read and left untouched by a failed read.

## Amendment 0.3.0

Reuse: `audioMandatory`'s whole read/write path — `MoviesService` around `setAudioMandatoryFor`
(`movies.service.ts`, the read beside it at the `row?.audioMandatory ?? false` line), the
`audioMandatory` `@ResolveField` in `movies.resolver.ts`, and the `ShowsService`/`ShowsResolver`
twins. Do not invent a different shape.

1. `UserMovie.autoAcquire Boolean @default(false)`, `UserShow.autoAcquire Boolean @default(false)`,
   migration `title_auto_acquire`; apply on the dev stack and **restart `api`** afterwards (the
   running process kept the old Prisma client after 0.2.0's migration).
2. `Movie.autoAcquire`/`Show.autoAcquire` field resolvers (caller's own value, `false` when no row —
   same fallback idiom as `audioMandatory`), `setMovieAutoAcquire(movieId, autoAcquire)` /
   `setShowAutoAcquire(showId, autoAcquire)` returning `Boolean!`, refusing with
   `error.movie.not_found` / `error.show.not_available` exactly where the `audioMandatory`
   mutations do. User principal only.
3. `acquire-movies.task.ts`: `users: { some: { autoAcquire: true } }` in the `findMany` instead of
   `users: { some: {} }`. `acquire-episodes.task.ts`: the same inside `season.show.users`, and the
   owner lookup (`userShow.findFirst`) filtered to `autoAcquire: true`.
4. `RankingContextService.forMovieOwners`/`forShowOwners`: `where: { movieId, autoAcquire: true }` /
   `{ showId, autoAcquire: true }`. `forCaller` (manual search) is untouched.
5. Nothing in `register()`, `addMedia` or `tmdb-lists/` writes `autoAcquire`.

Tests (Article IX, fault injection):
- `acquire-movies.task.spec.ts`: a film owned only by an opted-out user is not selected and does not
  consume a slot (with `MAX_MOVIES_PER_RUN` + 1 opted-out films ahead of one wanted film, the wanted
  one is still attached); a two-owner film is attached as the opted-in owner.
- `acquire-episodes.task.spec.ts`: the same two cases for episodes.
- `ranking-context.service.spec.ts` (or the nearest existing suite): an opted-out owner's languages
  and groups are not in the union.
- Not owed: the field resolvers and mutations (thin, the `audioMandatory` twins; failure is visible
  on the page).

Done when: `prisma migrate status` up to date; `npx tsc --noEmit` 0 errors; the touched suites
green; `bin/comments api` PASS; `schema.gql` diff equals the 0.3.0 SDL.

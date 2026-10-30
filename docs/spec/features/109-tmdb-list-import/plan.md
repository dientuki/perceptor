---
title: TMDB List Import — Implementation Plan
spec_version: 0.3.0
last_updated: 2026-10-28
status: Implemented
---

# PLAN: TMDB List Import (`plan.md`)

## Approach

A new `api` module, `src/tmdb-lists/`, owns the two new tables, the three GraphQL operations and
the import itself. The scheduled task `import_lists` is a thin handler in
`src/scheduler/tasks/import-lists.task.ts` that calls that module, the same split
`refresh-movies.task.ts` uses with `MoviesService.refreshCatalog()`. Registration is not
reimplemented: every new item goes through `MediaDispatchService.resolve(type).register(tmdbId,
userId)` (`src/media/media-dispatch.service.ts`), the exact call `addMedia` makes, so the
derivations, the reconciliation and a series' background hydrate come for free.

Reading a list is one new method on the existing `TmdbClient` (`src/clients/tmdb/client.ts`),
built on its private `fetchOne()` so the key, host, API version and `TmdbHttpError` handling stay in
one place. The 401/404 → i18n key mapping follows `src/media/popular-media.service.ts`.

`listImportEnabled` is one more boolean computed in `MediaCapabilitiesService.read()`
(`src/media/media-capabilities.service.ts`) from the settings map it already loads — no new query,
no new round trip for `web`, which already fetches `mediaCapabilities` on `/preferences`.

`register()`'s create race (NFR-4) is fixed inside `MoviesService.register()` and
`ShowsService.register()` themselves rather than in the import, because the spec requires it for
every caller: a unique-constraint violation on the title's `create` re-reads the row the other call
created and continues down the existing "already registered" branch. Alternative rejected: an
upsert on `tmdbId` — it would still pay the TMDB derivations twice and would overwrite the winner's
derived fields with the loser's, which a re-read never does.

`web` adds one self-contained section component to `/preferences`, outside the existing
`PreferencesForm` (which saves as one form): attach and detach act immediately, each through its
own server action.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration, the seed rows, the contract and the import; `web` has nothing to call before it. |
| 2 | `web` | Consumes `tmdbLists`/`addTmdbList`/`removeTmdbList` and `MediaCapabilities.listImportEnabled`. |
| 3 | `[docs]` | `docs/spec/graphql-contract.md`, the root `CLAUDE.md` "Register title in DB" row, `docs/spec/history.md`. |

The contract is frozen by this plan's approval, so `web` may start in parallel with `api` against
the spec's SDL; it cannot be verified until `api` is up. The `register()` race fix (api step) is
independent of everything else in `api` and may be done first.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will be tempted to change and must not:

- **`TmdbList.lastError` is a bare i18n key string, not a `DownloadError`-shaped object.** It looks
  inconsistent with `Download.lastError`; it is deliberate — a list error has no stage, no params
  and no retryable flag, and `web` translates it directly.
- **`listImportEnabled` lives on `MediaCapabilities`, not on `UserPreferences` or a scheduler type.**
  The scheduler queries are admin-only and must stay so; capabilities is the one installation-wide
  read every user already makes.
- **`addTmdbList` takes a single `reference: String!`, not an `Int` id.** Parsing the URL is `api`'s
  job so both input forms share one validator and one error key.
- **`removeTmdbList` returns `Boolean!`.** `web` refetches `tmdbLists`; do not return the list.
- **No `importNow` mutation.** Immediate import is out of scope; the admin's existing
  `runScheduledTask(id: "import_lists")` is the way to run it sooner.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, and re-brief `api` and
`web`. Never patch it from inside one slice (Article VIII).

## Migrations

1. `tmdb_list_import` — creates `user_tmdb_lists` (`UserTmdbList`) and `user_tmdb_list_items`
   (`UserTmdbListItem`), both cascading from their parent (`User`, then `UserTmdbList`). Generated
   with `bin/npm api run prisma:migrate`.
2. Seed: `schedule_import_lists_enabled = false`, `schedule_import_lists_cron = 0 */6 * * *` in
   `prisma/seeds/settings.ts`; the production seed inserts missing keys on boot, so an upgraded
   install gets them disabled.
3. Backfill: none — both tables start empty (NFR-6).

Reversibility: dropping both tables and the two setting rows loses only attached lists and their
seen records; no title, ownership or pipeline row references them.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A private list answers TMDB with 401 instead of 404 | Silent misclassification: the list shows "TMDB rejected the key" while the key is fine, and nothing else is wrong | The list read inspects TMDB's error body (`status_code` 7 = invalid key); any other 401/404 is `unreadable`. Verified live against a real private list in the manual pass (AC-8). |
| An already-seen item is re-registered | A title the user removed comes back every six hours; no error anywhere (REQ-7, AC-4) | Seen check runs before the ownership check; owed a unit test in `api`. |
| A disabled-type item is marked seen | The series never imports after shows are re-enabled; no error anywhere (REQ-8, AC-7) | Skip before marking; same unit test file. |
| One failing list or item aborts the run | Every list after it silently stops importing | Per-list and per-item `try`; the run throws a summary error at the end only (the `refresh-movies.task.ts` pattern), so the scheduler marks it `FAILED` while the rest is done. |
| `register()` create race | The losing caller does not own what it added; raw Prisma error (NFR-4) | Fixed in both services, owed a test that forces the unique violation. |
| Import cycle from reading the task key | `media-capabilities.service.ts` importing `scheduler.registry.ts` pulls every task handler into the media module graph | Read the `schedule_import_lists_enabled` key from the settings map by name; do not import the registry. |
| TMDB paging assumption | A list longer than one page silently imports only its first 20 items | The read loops `total_pages`; unit test with a two-page fake. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/comments api
bin/comments web
bin/mysql -e 'show tables like "user_tmdb_list%"'
```

Manual pass (covers AC-1 … AC-13):

1. Create a public TMDB list with two films and one series, and a private one.
2. In `/preferences`, paste the public list's URL (AC-1); paste it again (AC-10); paste `hello`, a
   TMDB movie URL and the private list's id (AC-8). Confirm the disabled-task notice (AC-12).
3. As admin, enable `import_lists` in Settings, then `runScheduledTask` it; check `/movies`,
   `/shows`, `/downloads` (AC-2, AC-12). Run again and compare `bin/mysql -e 'select count(*) from
   user_tmdb_list_items'` and the `movies`/`shows` counts (AC-3).
4. Remove one film, run again (AC-4). Add a film on TMDB, run again (AC-5).
5. Second user owning one film attaches the same list, run, then the duplicate query in AC-6.
6. Disable shows, attach a fresh list with a series, run; enable shows, run (AC-7).
7. Make the list private, run (AC-9); public again, run.
8. Detach a list (AC-11). Second user tries `removeTmdbList` with the first user's id (AC-13).
9. AC-6b is covered by `api`'s NFR-4 test, not by hand.

## Amendment 0.2.0 (lists pages)

`api` first: migration `tmdb_list_item_count` (`UserTmdbList.itemCount Int?`), `TmdbClient.list()`
also returns TMDB's `item_count`, `attach` and a successful `importAll` read store it, then
`Query.tmdbList(id)` and the `TmdbList.movies`/`shows` field resolvers. `web` second, against the
frozen SDL: sidebar entry, `/lists`, `/lists/[id]`, and the section removed from `/preferences`.

Risks: `movies`/`shows` must be scoped to the caller's ownership **and** the list's seen record —
dropping either shows another user's titles or every title the caller owns, with no error anywhere;
owed a test. `MediaCard` resolves its link from the `mediaType` prop, so a mixed grid that passes
one `mediaType` links every series to `/movies/<id>`; `/lists/[id]` must pass each card its own type.

Manual pass adds: the sidebar entry as a non-admin (AC-14); a list's page before and after removing
a film (AC-15); another user's id and `abc` (AC-16); a list attached before the migration (AC-17).

## Amendment 0.3.0 (per-title "download automatically")

**Approach.** A per-owner boolean beside `audioMandatory` on `UserMovie`/`UserShow`, read and written
exactly the way `039`'s `audioMandatory` is (a field resolver returning the caller's own value, a
mutation guarded by the same ownership read). The two sweeps learn it in their **selection query**,
not in their loop, and `RankingContextService.forMovieOwners`/`forShowOwners` — whose only callers
are the two sweeps — union only the owners who have it on. `web` adds one client component,
`AutoAcquireSwitch`, rendered under the poster on both detail pages. Alternative rejected: a
title-level column on `Movie`/`Show` — one user could then stop another's download.

**Order.** `api` first (migration, contract, sweeps); `web` against the frozen SDL, verifiable once
`api` is up.

**Contract freeze.** `Movie.autoAcquire`/`Show.autoAcquire` are the caller's own value, never an
aggregate over owners ("does anyone want it" is the sweeps' business, not a field). The mutations
return `Boolean!`, like `setMovieAudioMandatory`; `web` keeps its own state, it does not refetch the
title. The argument is named `autoAcquire`, not `mandatory`/`enabled`.

**Migration.** `title_auto_acquire`: `UserMovie.autoAcquire` and `UserShow.autoAcquire`, `Boolean
@default(true)`. Existing rows read `true` through the column default; nothing to backfill. Dropping
the two columns restores today's behaviour exactly.

**Risks.**

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The filter applied after the 20-per-run cap | Opted-out titles keep taking slots of the cap (`acquire_movies` slices after the window sort, `acquire_episodes` before choosing an owner); with enough of them the titles someone wants are never reached, every run reads `SUCCESS` | Filter in each sweep's `findMany` (`users: { some: { autoAcquire: true } }`), before ordering and slicing; owed a test per sweep |
| The ranking unions an opted-out owner | A release is picked by the languages/groups/cinema veto of a user who asked not to download it, and attached under their name | `forMovieOwners`/`forShowOwners` read only `autoAcquire: true` owners; `acquire_episodes`' owner lookup gets the same filter; tested |
| A new ownership row written with the wrong value | `addMedia` or a list import starts a title opted out, so it silently never downloads | Rely on the column default; no code path writes `autoAcquire` except the two mutations — the `register()` upserts must not set it in `update`/`create` |
| The switch hidden while the stored value is off | A title whose file disappears (media server demotion) comes back `MISSING` and stays undownloaded with the switch showing the stored "off" — intended, but invisible while hidden | The page shows the stored value whenever it renders the switch; documented in REQ-17, no extra state |

**Verification.** As 0.2.0, plus a live pass for AC-18 … AC-22: a film's and a series' switch, a run
of each sweep with the switch off and on (an indexer configured, or a forced empty result to observe
"no search"), a two-owner film, and `setMovieAutoAcquire` from a second user.

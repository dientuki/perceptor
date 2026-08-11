---
title: Movie Search and Per-User Libraries — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-11
status: Implemented
---

# PLAN: Movie Search and Per-User Libraries (`plan.md`)

## Approach

The whole feature hangs off one join table. `Movie` is left exactly as it is — same columns, same
global `tmdbId @unique` — and a new `UserMovie` records which users have which films. Nothing about
the download pipeline moves: `MediaSource`, `SourceFile` and `ProcessJob` still hang off the shared
`Movie` row, which is what makes REQ-5 (shared status, no second download) fall out of the data
model instead of needing to be enforced in code. Every read that used to mean "all movies" becomes
a read through that join.

The alternative was scoping the movie itself — dropping the global unique for a composite
`@@unique([userId, tmdbId])` and giving each user their own row. It was rejected because it makes
the same film downloadable twice by construction, and because every downstream stage
(`torrentCompleted` matching by `infoHash`, `ProcessJob`, the encode output path) assumes one film
is one row. The join is additive; the composite key would have been a rewrite of the pipeline.

On the `api` side this extends `MoviesService`
(`services/api/src/movies/movies.service.ts`) rather than adding a module: it already owns
`searchMovies`, `addMovie`, the Redis cache and `attachTorrentSource`. The caller is read with
`@CurrentUser()` exactly as `UsersResolver` already does for `updateUser`/`removeUser` — the
narrowing idiom `principal.type === 'user' ? principal.id : …` is copied from there, not reinvented.
The REQ-2 fallback reuses `TmdbClient.details()`, which already exists and is already mapped; the
only genuinely new code is turning its relative `posterPath` into the absolute `posterUrl` the rest
of the slice uses, and that string is extracted into **one** helper so the search path and the
fallback path cannot drift to different image sizes.

On the `web` side nothing new is introduced at all. The invisible button is fixed by using the
shared `Button` component (`services/web/src/components/ui/button/Button.tsx`) that every other
screen already uses, rather than by inventing a `--color-primary` token to satisfy one orphan
class. The "Ir" affordance is a `next/link` inside the `renderAction` slot `MediaCard` already
exposes.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 0 | `web` | REQ-9 (visible submit button) touches only Tailwind classes in `SearchInput.tsx`. It depends on nothing and can start immediately, before or during step 1. |
| 1 | `api` | Owns the migration, the join table and the two enriched fields. `web` cannot select `inLibrary` from a schema that does not have it, and cannot verify a scoped `movies` query that is not scoped yet. |
| 2 | `web` | Consumes `movieId`/`inLibrary` and rewrites the add flow. |

Only step 0 is genuinely parallel. Steps 1 and 2 are not: the contract is frozen, but `web`'s work
is unverifiable until `api` actually serves the fields — and "compiles" is not verification in a
repo with no codegen. Do not run them concurrently and call it done.

Within step 1 the internal order matters and is stated in `api/plan.md`: migration and backfill
first, then scoping, then enrichment. Enrichment written before scoping produces a search screen
that correctly reports ownership of a library that is still global.

## Contract Freeze

`## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Three things an
implementer will be tempted to change and must not:

- **`movieId` and `inLibrary` are two fields, not one nullable id.** From inside `api` it looks like
  redundancy — if the caller has it, it exists. It is not: `movieId` is non-null for a film any user
  has registered, `inLibrary` is true only for the caller's own. REQ-3 needs the first and REQ-8
  needs the second, and collapsing them makes "exists but is someone else's" unrepresentable, which
  is precisely the state the multi-user model creates.
- **`movies` and `addMovie` keep their signatures.** Adding a `userId` argument to either would make
  the change visible to a typechecker, which is tempting for exactly that reason. It would also let
  a caller ask for someone else's library. The caller is read server-side from the principal, the
  same way `removeUser` already does it — never passed in.
- **The refusal for an unowned film is the existing `La película <id> no existe`.** Writing a new,
  more helpful "no es tuya" string looks like better UX from inside the resolver. `spec.md`
  § Errors explains why it is not, and a new user-facing string is a contract change, not a wording
  choice.

If any of this turns out wrong mid-flight: stop, amend `spec.md`, re-approve, re-brief both
services (Constitution, Article VIII). Do not patch it from inside one slice.

## Migrations

Owned by `api`. One migration, generated through `bin/npm api run prisma:migrate` (Article III),
then hand-extended with the backfill in the same `migration.sql`.

1. `<timestamp>_add_user_movies` — creates `user_movies` (`userId` → `users.id`, `movieId` →
   `movies.id`, `createdAt`), composite primary key on the pair, index on `movieId`, both foreign
   keys `ON DELETE CASCADE`.
2. **Backfill**, appended to the same file: link every existing `movies` row to the oldest enabled
   administrator, resolved from the database because a migration cannot read `.env` and because
   `ADMIN_USER` may have been renamed since the seed ran.

   ```sql
   INSERT INTO `user_movies` (`userId`, `movieId`, `createdAt`)
   SELECT (SELECT `id` FROM `users`
            WHERE `isAdmin` = true AND `isEnabled` = true
            ORDER BY `createdAt` ASC LIMIT 1),
          `id`, NOW()
     FROM `movies`
    WHERE EXISTS (SELECT 1 FROM `users` WHERE `isAdmin` = true AND `isEnabled` = true);
   ```

   The `EXISTS` guard is not defensive decoration: without it, an installation with no enabled admin
   inserts `NULL` into a non-null foreign key and the migration fails halfway. With it, that
   installation gets an empty table and a working app.

   This follows the precedent set by `20260810224010_add_user_is_admin`, which appended its own
   backfill (oldest user becomes admin) to a generated migration for the same reason. Read that file
   before writing this one — it also documents MariaDB's refusal to read and write one table in a
   single statement, which is why that one needed a derived-table wrapper. This statement reads
   `users`/`movies` and writes `user_movies`, so the wrapper is not needed here.

3. Verified by AC-8: `select count(*) from user_movies` equals `select count(*) from movies`.

**Reversibility**: dropping `user_movies` restores the previous behaviour at the database level, but
not at the application level — `api` would then be querying a table that no longer exists. A
rollback is drop-the-table *and* revert the code, together. No data is lost by rolling back, since
the table only records links and never owned any film data.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **Enrichment poisons the shared cache** | The Redis payload under `tmdb:movie:<id>` is a serialized `MediaSearchResult`. If `inLibrary` is set on the objects *before* `cacheMovies` writes them, one user's ownership is cached globally and served to everyone who searches that film for the next 24 hours. Nothing errors; user B is simply told they already own a film they have never seen. | The cached shape stays catalog-only: `clients/types.ts`'s `MediaSearchResult` is **not** given the new fields, and enrichment happens after the cache write, per request. Covered by a test in `api/plan.md`. |
| **`movies` scoped in `api`, not re-verified in `web`** | The query keeps its exact signature, so `web` compiles and renders whatever it gets. If the two steps land out of order or the scoping is dropped in review, every user quietly sees everyone's library. No error, no type failure, no log. | This is NFR-2. AC-10 verifies it against `api` directly with a second user's token, not through the UI. Recorded in `docs/spec/graphql-contract.md` as a cross-cutting rule so a future feature does not undo it. |
| **Backfill runs but attaches nothing** | An installation whose oldest admin is disabled, or that has no admin at all, silently inserts zero rows. The upgrade "succeeds" and every library is empty. | The `EXISTS` guard makes the zero-row case correct rather than broken, and AC-8 compares the two counts rather than merely checking the migration exited 0. |
| **`addMovie` duplicates the link on a re-add** | A user registering a film they already have would hit the composite primary key and surface a raw Prisma `P2002` as a GraphQL error, on the happy path of a button the UI is about to stop showing. | `addMovie` stays idempotent end to end: the link is written with an upsert-style create-if-missing, matching the existing "already in the library, return the existing row" behaviour it has today. |
| **The seed leaves a fresh install with an orphan film** | `prisma/seeds/movie.ts` creates *Inception* with no owner. After this feature that row belongs to nobody and the seeded admin's `/movies` is empty on a brand-new database — which looks exactly like the backfill failing. | The seed links it to the seeded admin. `prisma/seeds/index.ts` already runs `seedUsers` before `seedMovies`, so the user exists. See "Decided here" below. |
| **Poster size drifts between the two paths** | `searchMovies` builds `…/w300/…`; a fallback that builds `…/w500/…` produces a film whose poster silently changes resolution depending on whether the cache was warm. | One exported helper, used by both. Named in `api/plan.md`. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
```

`api` must stay at **0** typecheck errors. `web` is at **12** errors across 5 files before this
feature (all pre-GraphQL leftovers on dead paths, listed in `services/web/CLAUDE.md`); it must be
12 or fewer after — report the number before and after.

Database state, after `bin/dev`:

```bash
bin/mysql -e 'select count(*) as movies from movies; select count(*) as links from user_movies'
bin/mysql -e 'select u.username, count(*) from user_movies um join users u on u.id = um.userId group by u.username'
```

Manual pass, which is where AC-1 through AC-11 actually get proved:

1. Sign in as the admin, open `/movies/add`. The submit button is visible in both themes (AC-1);
   toggle the theme without reloading.
2. Search a film, register it. The URL stays on `/movies/add`, the results stay on screen, that card
   now reads `Ir` (AC-2). Click it — `/movies/<id>` (AC-3). Go back, search the same term again: the
   card reads `Ir` on first render (AC-4).
3. `bin/cli redis redis-cli del tmdb:movie:<n>`, then register film `<n>` from the results still on
   screen. It registers; no `no está en cache` (AC-7).
4. Create a second user from `/users`, sign in as them in a private window. Search the film the
   admin registered: the card offers to add, not `Ir` (AC-5, first half). Register it, then check the
   two counts above — one `movies` row, two `user_movies` rows (AC-5).
5. With a download in flight on the admin's side, the second user's `/movies` shows the same status
   and qBittorrent shows no second torrent (AC-6).
6. That second user's `/movies` shows only what they registered (AC-9), and the same holds querying
   `movies` directly with their token rather than through the UI (AC-10).
7. `addMagnetToMovie` against a film that user has not registered is refused with
   `La película <id> no existe`, and the film's existing source is unchanged (AC-11).

AC-8 needs a database that predates the migration — verify it on a copy of a real installation, or
by checking out the previous commit, running `bin/dev`, adding films, then returning and running
`bin/cli api npx prisma migrate deploy`.

## Decided here, not in the spec

Three things the spec did not settle, resolved in the service plans:

- **The seed links *Inception* to the seeded admin** (`prisma/seeds/movie.ts`). The spec's § Data
  Model Changes covers the migration backfill for existing installations but says nothing about a
  fresh one, where the seeded film would otherwise be ownerless and indistinguishable from a broken
  backfill.
- **The two new fields go on the GraphQL entity only**, not on `clients/types.ts`'s
  `MediaSearchResult`. The spec froze the wire shape; where it lives internally is a plan decision,
  and it is the one that keeps the Redis cache correct (see § Risks).
- **`addMovie`'s unused `type` parameter in `web`'s server action stays.** It is accepted and
  ignored today. Removing it is a rename across `SearchContainer`'s prop type for no behavioural
  gain, and it is not in scope.

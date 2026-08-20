# services/api

Rules that outrank this file: `docs/constitution.md`. Agent brief: `.claude/agents/api.md`.
Cross-service boundary: `docs/spec/graphql-contract.md`.

NestJS 11 + Apollo (GraphQL) + Prisma 7 + MariaDB, run only inside Docker — see the root
`CLAUDE.md` for the Docker-first workflow and `bin/` wrappers before running anything here.

This service owns the database and the GraphQL schema for the whole system. There is no `db`
service: a schema change is an `api` change (Constitution, Article III).

## GraphQL is code-first

`src/app.module.ts` configures `GraphQLModule.forRoot` with `autoSchemaFile` conditional on
`NODE_ENV`: a file at `src/schema.gql` in development, `true` (in-memory, nothing written) under
`NODE_ENV=production`, because the `runner` image has no `/app/src` to write into.

- The **source of truth** is the TypeScript decorators on resolvers, entities (`@ObjectType`,
  `@Field`, …) and DTOs (`@InputType`, …) under each module's `entities/` and `dto/`.
- `src/schema.gql` is **regenerated on every boot** and marked "DO NOT MODIFY". Never hand-edit it —
  change the decorators.
- `playground`/`introspection` are on outside of `NODE_ENV=production`.

## Validation errors reach the caller as a plain string

`main.ts`'s global `ValidationPipe` has a custom `exceptionFactory`: it throws `BadRequestException`
with a single string — the first `class-validator` constraint message. Nest's default would throw
the raw `ValidationError[]`, which serializes as a generic `"Bad Request Exception"` at the GraphQL
error's top-level `message` and buries the real text under `extensions.originalError.message[0]`.
Every consumer in `services/web/src/actions/*.ts` reads `errors[0].message` directly, so a DTO's
`@MinLength`/`@IsNotEmpty` message reaches the screen unmodified.

## Errors carry a translation key (`018-ui-i18n`)

Every user-facing exception is built through `src/i18n/i18n-error.ts`'s `i18nError.{notFound,
badRequest, conflict, unauthorized, forbidden, serviceUnavailable}(key, params?)` — a thin factory
over Nest's real exception classes (never a parallel hierarchy), whose response body is
`{ message, i18n: { key, params? } }`. `key` is one of the constants in `src/i18n/error-keys.ts`;
`message` is always the English rendering from `src/i18n/messages.en.ts`, `{param}`-interpolated.
`src/i18n/graphql-error.formatter.ts`, wired into `GraphQLModule.forRoot`'s `formatError`, lifts
`i18n` onto the outgoing error's `extensions` — a keyed throw arrives on the wire as
`extensions.i18n = { key, params }`, an un-migrated or genuinely unexpected error passes through
unchanged (no invented key). `main.ts`'s `exceptionFactory` (above) also understands a
`class-validator` `message` option that is itself a key string, rendering it the same way.

This service **only ever produces English** — translating a key into another language is `web`'s
job (`docs/spec/graphql-contract.md` § "UI internationalization" has the full vocabulary and the
error envelope shape). `User.uiLocale`, `Query.supportedLocales` and `Mutation.setUiLocale` exist
so `web` can resolve and persist the active locale; `api` never reads `uiLocale` itself.

## Prisma 7 via driver adapter

`prisma/schema.prisma` declares `datasource db { provider = "mysql" }` with **no `url`** — the
connection string is not read from the datasource block. `src/prisma/prisma.service.ts` builds a
`PrismaMariaDb` adapter (`@prisma/adapter-mariadb`) and passes it into `new PrismaClient({ adapter })`.

- Don't expect `DATABASE_URL` alone to configure the client — connection details live in the adapter
  constructor call (see Known debt).
- Migrations still work through `prisma migrate`; the adapter only affects the runtime client, not
  the CLI's own connection.
- `PrismaService` implements `OnModuleInit`/`OnModuleDestroy` to `$connect`/`$disconnect`.

## Module map

Every domain module is `<name>.module.ts` + `<name>.resolver.ts` + `<name>.service.ts`, with GraphQL
types in `entities/` and inputs in `dto/`. Follow the neighbours.

- **`auth/`** — JWT + Passport, the authentication boundary for the whole API.
  `guards/jwt-auth.guard.ts` is registered once as `APP_GUARD`, so **every GraphQL operation requires
  a credential by default**. Two `Reflector` decorators carve out exceptions: `@Public()` (only on
  `login`) and `@AllowService()` (the worker/qBittorrent-reachable operations). `auth.types.ts`'s
  `toPrincipal()` decides between a **user** principal (`{type:'user', id, username}`, checked against
  `session.service.ts`'s Redis session record so `logout` can actually revoke a stateless JWT) and a
  **service** principal (`{type:'service', name}` — no id, no expiry, minted by
  `scripts/mint-service-token.ts`, never session-checked). `SessionService` keeps a per-user reverse
  index (`user-sessions:<userId>`) so `revokeAllForUser()` kills every live session at once.
  The guard **short-circuits for non-GraphQL contexts**, so it never touches `/uploads` — that route
  authenticates per-request by ticket. `guards/admin.guard.ts` is applied at class level on
  `UsersResolver` and **re-reads `isAdmin` from the DB on every call** rather than trusting the JWT,
  so a demoted admin stops working on the next request, not at token expiry.
  `scripts/reset-password.ts` is the recovery path — run via `bin/reset-password`, never bare.
- **`users/`** — CRUD over `User`, entirely behind `AdminGuard`. `remove()` refuses self-delete and
  refuses deleting the last admin. `update()` refuses self-disable and refuses disabling the last
  *enabled* admin (`{ isAdmin: true, isEnabled: true }` — counting disabled admins would let someone
  lock the app out one disable at a time). A successful disable calls `revokeAllForUser()` in the same
  method. `login()` refuses a disabled user with a distinct message, even on correct credentials.
- **`media/`** — the boundary that turns a `type` argument into a choice of service. Exposes
  `searchMedia(query, type)` and `addMedia(tmdbId, type)`, the only catalog operations in the schema.
  `media-dispatch.service.ts` holds a `Record<MediaType, MediaTypeService>` lookup and throws for
  anything else. `media-type.interface.ts` is the whole contract: `search(query, userId)` and
  `register(tmdbId, userId)`, nothing else — cache keys, endpoints, error strings and Prisma models
  stay private to each implementation by design. A third media type costs one new service plus one
  lookup entry, not an edit to the dispatch.
- **`movies/`** — CRUD over `Movie`, plus `search`/`register` (implementing `MediaTypeService`) and
  `addTorrentToMovie`/`addMagnetToMovie`, the two entry points into the download pipeline. `Movie` is
  a **shared catalog row** (`tmdbId @unique`, never duplicated) joined to `User` through `UserMovie`.
  Everything user-visible is scoped through that join: `movies`, `search`'s `inLibrary`, and
  `movie(id)` via `findOneFromDb(id, userId)` (a `findFirst` with
  `where: { id, users: { some: { userId } } }`). A `null` from `movie(id)` therefore means "not
  available to you", identically for a missing id and an unowned film. The acquisition mutations
  refuse a film the caller hasn't registered with that same `La película <id> no existe`.
  **Ordering trap:** `search` enriches results with `mediaId`/`inLibrary` *after* the Redis cache
  write in `cacheMovies`. That cache key is global across all users — computing ownership before it
  leaks one user's `inLibrary` into every other user's results for 24h (`movies.service.spec.ts`).
- **`shows/`** — `ShowsService`, `MoviesService`'s structural twin, **deliberately not factored into
  a shared base class** (see `006-media-search/spec.md` § Out of Scope). Same cache-before-enrich
  ordering, same upsert-based idempotent linking, scoped through `UserShow`. `shows` is a per-user
  listing; `show(id)` is `findOneFromDb`'s twin one level deeper, with a nested `include` on
  `seasons`/`episodes` ordered server-side. `Show.status` is a `MediaStatus` in Prisma but crosses
  GraphQL as a plain `String!`, exactly as `Movie.status` does — **do not `registerEnumType` it for
  one type only.** `register()` kicks off a detached, never-awaited hydration (`ShowsService.hydrate`):
  one request for the season list, then one **sequential** request per season (never `Promise.all` —
  TMDB rate-limits), claimed via a Redis `SET … NX` so concurrent registrations fetch once.
  `Show.seasonsSyncedAt` is set only once every season and episode is written; it stays `null` on any
  failure, and the next `register()` retries whenever it is `null`.
- **`languages/`** — the `languages` query (reads the seeded `Language` table, deriving an English
  `name` per `iso2` from `language-names.ts`, not stored — `web` renders the localized display name
  via `Intl.DisplayNames` since `018-ui-i18n`; this map is an internal English label, not the UI
  string) plus the preference writes backing
  `setPreferredLanguages`/`setMoviePreferredLanguages`/`setShowPreferredLanguages`. Each write
  validates every `iso2`, rejects duplicates within one argument, then replaces the whole set
  atomically (`deleteMany` + `createMany` in a `$transaction`). Exported so `auth/`, `movies/` and
  `shows/` each host their own `@ResolveField()` for `preferredLanguages` — deliberately not
  centralised. **Sharp edge:** a `@ResolveField()` attaches to the *type*, not the query that reaches
  it, so `User.preferredLanguages` needs an identity guard comparing `@Parent()` against
  `@CurrentUser()` — without it the field is readable through the admin `users`/`user(id)` queries
  even though it is self-service only.
- **`media-sources/`** — the `MediaSource` row representing one acquisition attempt. `sourceScanned`
  takes `matches: [ScannedMatchInput!]!`, one entry per file the worker resolved (a film or single
  episode reports exactly one, both numbers `null`). The service loads the source with its season's
  episodes, refuses a source targeting nothing, maps a season match to an episode by `episodeNumber`
  (skipping a mismatched `seasonNumber` or an unknown number), and writes `hasUnmatchedFiles` from
  the **video entries only** (`SourceFileInput.isVideo` — the extension list lives once, in the
  worker, on purpose). The `ERROR` branch is reached by `matches: []` **or** by every match resolving
  to nothing. The transaction, the never-reset-a-`ProcessJob`-past-`WAITING` rule and the
  enqueue-after-commit block are load-bearing.
- **`episodes/`** — `MoviesService`'s structural twin one level deeper: `findOneFromDb` scoped through
  `season.show.users`, plus `addTorrentToEpisode`/`addMagnetToEpisode` mirroring
  `attachTorrentSource`'s ownership lookup, active-source conflict (`force`), demote-then-replace and
  symmetric `infoHash` collision check. `MoviesService.attachTorrentSource`'s collision guard also
  recognises an `infoHash` owned by an **episode**, not just another movie — without that, an
  episode-owned hash falls through and gets silently re-pointed at a film. Reuses
  `shows/entities/episode.entity.ts` rather than declaring a second `Episode`.
- **`seasons/`** — the **third** structural twin of `attachTorrentSource`, same deliberate
  non-abstraction. Exactly one mutation, `addMagnetToSeason(seasonId, magnet, force)`, scoped through
  `season.show.users`, with a season-scoped conflict on `MediaSource.seasonId` and the same
  demote-on-`force` ordering (qBittorrent accepts the magnet first, *then* the previous source is
  demoted, *then* the replacement is created). No web UI by design. Its final read is a
  `season.findUniqueOrThrow` that **must `include` the episodes** — `Season.episodes` is non-null, so
  a bare row fails the mutation *after* qBittorrent already accepted the torrent, orphaning the
  download with no `MediaSource` tracking it.
- **`downloads/`** — `torrentCompleted`, called by qBittorrent's AutoRun hook. Matches **exclusively
  by infoHash** and silently ignores unknown hashes by design. An episode-owned source moves its
  `Episode` to `ENCODING` just as a movie-owned one does; a source already `ERROR` (superseded by a
  `force` replacement) is left untouched.
- **`process-jobs/`** — the `ProcessJob` lifecycle: `sourceScanned` → encode queued →
  `encodeCompleted`. Resolves `outputRoot` and `downloadsRoot` for the worker; `downloadsRoot` is
  `resolveFromRoot('downloads', '.')` — the **root itself**, not `path_downloads`, because a torrent's
  save path and a tus upload's staging directory sit under different segments of it.
  `encodeCompleted` returns `EncodeCompletedResult` (`message`, `removeTorrent`, `deleteInputFile`,
  `deleteDownloadPath`): the cleanup verdict for the job that just finished, computed from its sibling
  jobs (a season pack shares one `MediaSource` across many jobs) and the source's
  `hasUnmatchedFiles`. A one-job source always resolves to `(true, false, true)`; a season pack's
  episodes withhold `removeTorrent`/`deleteDownloadPath` until the **last** job finishes, whatever the
  others ended as — full verdict table in `docs/spec/graphql-contract.md` § 013. `downloadRemove`
  takes `deleteFiles: Boolean = true`; the cleanup pipeline is the one caller passing `false`, since
  the worker's `cleanup-source.ts` owns every filesystem deletion.
  `getEncodeJobDetails` resolves `allowedLanguagesIso3`: the title's original language followed by the
  union of every owner's global and per-title preference, deduplicated, selecting `language.iso3` and
  **never `iso2`**. **This is the one place that merge happens** — `Movie.preferredLanguages` and
  `Show.preferredLanguages` deliberately return only the calling user's own list.
- **`settings/`** — key/value settings with a typed catalog in `settings.catalog.ts` and server-side
  validation in `updateMany`.
- **`media-roots/`** — the two declared roots and every path translation. See below.
- **`media-server/`** — post-encode notification (Jellyfin today), opt-in from Settings.
- **`indexer/`** — Prowlarr search surface.
- **`uploads/`** — the project's only REST route (tus); see the root `CLAUDE.md` for why.
  Authenticated **by ticket, not by `JwtAuthGuard`** (which skips non-GraphQL contexts): a signed-in
  user mints one via `createUploadTicket`, the browser sends it as `Authorization: Bearer <ticket>` on
  the tus `POST`, and `onUploadCreate` verifies and spends it exactly once via a Redis `SET … NX`
  (atomic, so two concurrent POSTs can't both win). Never re-checked on `PATCH`, by design.
  `createUploadTicket(movieId: Int, episodeId: Int)` takes both nullable and requires **exactly one**;
  `UploadTicketsService.mint`/`verifyAndSpend` take a `UploadTicketTarget = { movieId } | { episodeId }`,
  and the target check runs **before** the Redis spend — a mismatch must not burn the ticket. It also
  requires the caller's `user_movies` link, calling the same `findOneFromDb` that `movie(id)` uses.
  `handleUploadFinish` keeps a bare `prisma.movie.findUnique` — not an ownership hole, since a ticket
  is only mintable for an owned film and is bound to that target. The tus metadata key names are
  deliberately **not** unified — see root `CLAUDE.md` → Known debt.

**Infrastructure**: `prisma/` (`PrismaModule` + `PrismaService`, effectively global), `redis/`,
`queue/` (BullMQ producers; `queue/types.ts` is the job payload contract with the worker).

**`clients/`** is not a Nest module — plain adapter classes grouped by external system:
`clients/tmdb/`, `clients/indexer/`, `clients/torrent/` (qBittorrent client + `magnet.ts` parser),
`clients/media-server/` (with a `registry.ts`), plus the shared `clients/types.ts`.

Loose `app.*` files at `src/` root wire it together and expose a trivial REST health item.

## Commands

Everything through `bin/npm api …` from the repo root (never bare `npm`/`npx`/`prisma`):

| Command | Purpose |
| :-- | :-- |
| `bin/npm api run start:dev` | Nest in watch mode (what the `dev` Docker stage runs) |
| `bin/npm api test` | Jest unit tests (`*.spec.ts`) |
| `bin/npm api run test:cov` | Jest with coverage, written to `coverage/` |
| `bin/npm api run test:e2e` | Jest e2e suite, config in `test/jest-e2e.json` |
| `bin/npm api run lint` | ESLint with `--fix` |
| `bin/npm api run prisma:generate` | regenerate `@prisma/client` |
| `bin/npm api run prisma:migrate` | `prisma migrate dev` — run after `bin/dbinit` on a fresh DB |

Seed data runs via `prisma/seeds/index.ts`, wired as the `seed` command in `prisma.config.ts`;
`prisma migrate dev` prompts to run it. It calls `seedLanguages`, `seedUsers`, `seedMovies`,
`seedSettings` and `seedMediaSource` in turn. `prisma/seeds/settings.ts` seeds
`path_downloads`/`path_movies`/`path_shows` as **segments relative to the declared roots**
(`.`/`Movies`/`Shows`), plus torrent/tracker/media-server/TMDB config keys. All create-only (checks
`findUnique` before `create`), so re-running never clobbers a real value already set through the UI.

`src/media-roots/` is the single owner of "is this path inside a declared root?" — used by settings
validation, by `QbittorrentClient` to resolve `path_downloads`, and by `ProcessJobsService` to resolve
`path_movies`/`path_shows` into the worker's `outputRoot`. `MediaRootsService.resolveFromRoot()` is
the actual traversal/symlink guard — see its doc comments and `media-roots.service.spec.ts` for the
escape suite it defends against.

## Schema/enum reality check

`prisma/schema.prisma` defines exactly four enums — verify with `grep -n '^enum' prisma/schema.prisma`
rather than trusting this list:

| Enum | Values |
| :-- | :-- |
| `SourceKind` | `TORRENT_SEARCH`, `TORRENT_FILE`, `LOCAL_FILE`, `LOCAL_FOLDER` |
| `SourceStatus` | `PENDING`, `QUEUED`, `DOWNLOADING`, `PAUSED`, `READY`, `SCANNED`, `ERROR` |
| `EncodeStatus` | `WAITING`, `QUEUED`, `ENCODING`, `COMPLETED`, `ERROR` |
| `MediaStatus` | `MISSING`, `DOWNLOADING`, `ENCODING`, `COMPLETED`, `ERROR` |

**There is no `MEDIA_TYPE` or `MediaType` enum**, here or anywhere in Prisma. `services/web` declares
its own `MEDIA_TYPE` (`MOVIE`/`SHOW`) in `src/types/media.ts` — a web-side type, not a database one.
A movie/show discriminator in `api` would have to be added to `schema.prisma` and migrated first.

There are 15 models and 17 migrations (counted 2026-08-17) — verify with
`grep -c "^model " prisma/schema.prisma` rather than trusting the number. Worth knowing: the three
`*Language` join tables reference `UserMovie`/`UserShow` through their composite FK rather than
`User`+`Movie`/`Show` separately, so a language preference disappears automatically when the title
leaves the library.

## Tests

- Unit specs are `*.spec.ts` colocated under `src/` (jest `rootDir: "src"`).
- E2E specs live in `test/*.e2e-spec.ts` with their own config. Note `src/auth/test/auth.e2e-spec.ts`
  is picked up by **both** configs, because the default `testRegex` also matches `e2e-spec`.

**Two styles coexist. Only one is the convention.**

Follow `src/media-roots/media-roots.service.spec.ts` and `src/clients/torrent/magnet.spec.ts`:
`describe` for the unit, `it(...)` strings in the indicative (`it('rejects a symlink pointing outside
the root')`), a header comment stating *what class of bug this defends against*, and real fixtures
where mocking would defeat the purpose — `media-roots.service.spec.ts` runs against a real `mkdtemp`
with real symlinks because a bug there is a real path traversal. Both files still have Spanish
`it(...)` strings predating Article VI: copy their *structure*, write new prose in English.

The house technique is **fault injection** — a case earns its place by being verified to fail when
the rule it covers is removed (an ownership `where` clause dropped, a `select` switched from `iso3`
to `iso2`, a demote moved after its create). Write new cases that way.

Do **not** extend or imitate `users.resolver.spec.ts` or `app.controller.spec.ts` — those 18-line
`expect(service).toBeDefined()` files are `nest g` scaffolding (Constitution, Article IX).
`src/users/users.service.spec.ts` *used to be* on that list and is now a real suite; follow it.

## Current state

As of 2026-08-20 (`018-ui-i18n`): `bin/cli api npx --no tsc --noEmit` reports **0 errors**,
`bin/npm api test` is green at **179** tests across **19** suites. **Re-run both rather than
trusting these numbers** — they exist so an agent can prove a change added nothing, not as a fact
to cite.

## Known debt

- `src/prisma/prisma.service.ts` hardcodes the MariaDB connection string in the `PrismaMariaDb(...)`
  constructor call even though `DATABASE_URL` already exists in `.env`.
- `prisma/schema.prisma`'s `datasource db` has no `url` — see "Prisma 7 via driver adapter" above.

# services/api

Rules that outrank this file: `docs/constitution.md`. Agent brief: `.claude/agents/api.md`.
Cross-service boundary: `docs/spec/graphql-contract.md`.

NestJS 11 + Apollo (GraphQL) + Prisma 7 + MariaDB, run only inside Docker — see the root
`CLAUDE.md` for the Docker-first workflow and `bin/` wrappers before running anything here.

This service owns the database and the GraphQL schema for the whole system. There is no `db`
service: a schema change is an `api` change (Constitution, Article III).

## GraphQL is code-first

`src/app.module.ts` configures `GraphQLModule.forRoot` with `autoSchemaFile:
join(process.cwd(), 'src/schema.gql')`. That means:

- The **source of truth** is the TypeScript decorators on resolvers, entities (`@ObjectType`,
  `@Field`, …) and DTOs (`@InputType`, …) under each module's `entities/` and `dto/` directories.
- `src/schema.gql` is **generated on every boot** and marked "DO NOT MODIFY" at its top. Never
  hand-edit it — change the decorators and let Nest regenerate it.
- `playground`/`introspection` are on outside of `NODE_ENV=production`.

## Validation errors reach the caller as a plain string

`main.ts`'s global `ValidationPipe` has a custom `exceptionFactory` (`003-auth-user-management`):
it throws `BadRequestException` with a single string — the first `class-validator` constraint
message — instead of Nest's default, which throws the raw `ValidationError[]` and serializes as
the generic `"Bad Request Exception"` at the GraphQL error's top-level `message`, burying the real
text under `extensions.originalError.message[0]`. Every consumer in `services/web/src/actions/*.ts`
reads `errors[0].message` directly, so any DTO's `@MinLength`/`@IsNotEmpty` message (e.g.
`create-user.input.ts`) now reaches the screen unmodified, the same way a plain
`throw new BadRequestException('...')` always has.

## Prisma 7 via driver adapter

`prisma/schema.prisma` declares `datasource db { provider = "mysql" }` with **no `url`** — the
connection string is not read from the datasource block. Instead `src/prisma/prisma.service.ts`
builds a `PrismaMariaDb` adapter (`@prisma/adapter-mariadb`) explicitly and passes it into
`new PrismaClient({ adapter })`. Implications:

- Don't expect `DATABASE_URL` alone to configure the client the way plain Prisma does — the
  connection details currently live in the adapter constructor call (see Known debt below).
- Migrations still work through `prisma migrate` as usual; the adapter only affects the runtime
  client, not the CLI's own connection for migrations (which Prisma resolves separately).
- `PrismaService` implements `OnModuleInit`/`OnModuleDestroy` to `$connect`/`$disconnect` with the
  Nest lifecycle.

## Module map

Every domain module is `<name>.module.ts` + `<name>.resolver.ts` + `<name>.service.ts`, with
GraphQL types in `entities/` and inputs in `dto/`. Follow the neighbours.

**Domain modules** (all registered in `app.module.ts`):

- `auth/` — JWT + Passport (`passport-jwt`), the authentication boundary for the whole API
  (`002-auth-login`). `guards/jwt-auth.guard.ts` exposes `JwtAuthGuard`, registered once as
  `APP_GUARD` in `app.module.ts` — every GraphQL operation requires a valid credential by default.
  Two `Reflector`-driven decorators carve out the exceptions: `decorators/public.decorator.ts`'s
  `@Public()` (currently only on `login`) and `decorators/allow-service.decorator.ts`'s
  `@AllowService()` (the worker/qBittorrent-reachable operations — see `auth.types.ts`). A request
  carries one of two principal shapes, decided by `auth.types.ts`'s `toPrincipal()`: a **user**
  principal (`{type:'user', id, username}`, checked against `session.service.ts`'s Redis-backed
  session record so `logout` can actually revoke it — this is what makes AC-5 hold for a stateless
  JWT) or a **service** principal (`{type:'service', name}`, no `id`, no expiry, minted by
  `scripts/mint-service-token.ts` and never subjected to the session check). `guards/jwt-auth.guard.ts`
  short-circuits for any non-GraphQL execution context, so it never touches `/uploads` — that REST
  route is authenticated separately, per-request, by the ticket mechanism in `src/uploads/`.
  `decorators/current-user.decorator.ts` exposes `@CurrentUser()`, typed to the principal union.
  Specs under `auth/test/`. `guards/admin.guard.ts` exposes `AdminGuard` (`003-auth-user-management`),
  applied at class level on `UsersResolver` — it re-reads `isAdmin` fresh from `PrismaService` on
  every call rather than trusting the JWT, so a demoted admin's still-valid session stops working on
  the very next request instead of at token expiry. `scripts/reset-password.ts` is the host-side
  recovery path when no admin can sign in — run through `bin/reset-password`, never bare.
- `users/` — CRUD over the `User` model. `isAdmin: Boolean!` (`003-auth-user-management`) gates the
  whole module via `AdminGuard`; `remove()` refuses self-delete and refuses deleting the last admin.
- `movies/` — CRUD over `Movie`, plus `addTorrentToMovie` / `addMagnetToMovie` (the two entry
  points into the download pipeline) and the in-progress `movies.search.ts`.
- `media-sources/` — the `MediaSource` row that represents one acquisition attempt.
- `downloads/` — `torrentCompleted`, the mutation qBittorrent's AutoRun hook calls; matches
  **exclusively by infoHash** and silently ignores unknown hashes by design.
- `process-jobs/` — the `ProcessJob` lifecycle: `sourceScanned` → encode queued → `encodeCompleted`.
  Resolves `outputRoot` for the worker.
- `settings/` — key/value settings with a typed catalog in `settings.catalog.ts` and server-side
  validation in `updateMany`.
- `media-roots/` — the two declared roots and every path translation. See below.
- `media-server/` — post-encode notification (Jellyfin today), opt-in from Settings.
- `indexer/` — Prowlarr search surface.
- `uploads/` — the project's only REST route (tus). See the root `CLAUDE.md` for why. Authenticated
  by ticket, not by `JwtAuthGuard` (that guard skips non-GraphQL contexts entirely): a signed-in
  user mints one via the `createUploadTicket` mutation (`uploads.resolver.ts`, guarded, user
  principals only — see `auth/`), the browser sends it as `Authorization: Bearer <ticket>` on the
  tus `POST`, and `uploads.service.ts`'s `onUploadCreate` hook verifies and spends it exactly once
  via `upload-tickets.service.ts` (a Redis `SET ... NX`, atomic so two concurrent POSTs can't both
  win). Never re-checked on `PATCH` — by design, see `002-auth-login`'s spec.

**Infrastructure**: `prisma/` (`PrismaModule` + `PrismaService`, effectively global), `redis/`,
`queue/` (BullMQ producers; `queue/types.ts` is the job payload contract with the worker).

**`clients/`** is not a Nest module — plain adapter classes grouped by external system:
`clients/tmdb/`, `clients/indexer/`, `clients/torrent/` (qBittorrent client + `magnet.ts` parser),
`clients/media-server/` (with a `registry.ts`), plus the shared `clients/types.ts`.

Loose `app.*` files at `src/` root wire it together and expose a trivial REST health item.

## Commands

Everything through `bin/npm api …` from the repo root (never bare `npm`/`npx`/`prisma` — see root
`CLAUDE.md`):

| Command | Purpose |
| :-- | :-- |
| `bin/npm api run start:dev` | Nest in watch mode (this is what the `dev` Docker stage runs) |
| `bin/npm api test` | Jest unit tests (`*.spec.ts`) |
| `bin/npm api run test:cov` | Jest with coverage, written to `coverage/` |
| `bin/npm api run test:e2e` | Jest e2e suite, config in `test/jest-e2e.json` |
| `bin/npm api run lint` | ESLint over `src/apps/libs/test` with `--fix` |
| `bin/npm api run prisma:generate` | `prisma generate` — regenerate `@prisma/client` |
| `bin/npm api run prisma:migrate` | `prisma migrate dev` — run after `bin/dbinit` on a fresh DB |

Seed data runs via `prisma/seeds/index.ts`, wired as the `seed` command in `prisma.config.ts`
(`ts-node prisma/seeds/index.ts`); `prisma migrate dev` prompts to run it automatically. It calls
`seedLanguages`, `seedUsers`, `seedMovies`, `seedSettings` and `seedMediaSource` in turn
(`prisma/seeds/{languages,users,movie,settings,media-source}.ts`). `prisma/seeds/settings.ts`
seeds `path_downloads`/`path_movies`/`path_shows` as segments relative to the roots declared in
`.env` (`.`/`Movies`/`Shows`) — see `src/media-roots/` below — plus torrent/tracker/media-server/TMDB
config keys. Create-only (checks `findUnique` before `create`), so re-running the seed never
clobbers real values (API keys, a custom path) already set through the UI.

`src/media-roots/` is the single owner of "is this path inside a declared root?" — used by settings
validation (`SettingsService.updateMany`), by `QbittorrentClient` to resolve `path_downloads` to an
absolute container path, and by `ProcessJobsService` to resolve `path_movies`/`path_shows` into the
`outputRoot` the worker uses to build the final file path. `MediaRootsService.resolveFromRoot()` is
the actual traversal/symlink guard — see its own doc comments and `media-roots.service.spec.ts` for
the escape suite it defends against.

## Schema/enum reality check

`prisma/schema.prisma` defines exactly four enums — verify with
`grep -n '^enum' prisma/schema.prisma` rather than trusting this list:

| Enum | Values |
| :-- | :-- |
| `SourceKind` | `TORRENT_SEARCH`, `TORRENT_FILE`, `LOCAL_FILE`, `LOCAL_FOLDER` |
| `SourceStatus` | `PENDING`, `QUEUED`, `DOWNLOADING`, `PAUSED`, `READY`, `SCANNED`, `ERROR` |
| `EncodeStatus` | `WAITING`, `QUEUED`, `ENCODING`, `COMPLETED`, `ERROR` |
| `MediaStatus` | `MISSING`, `DOWNLOADING`, `ENCODING`, `COMPLETED`, `ERROR` |

**There is no `MEDIA_TYPE` or `MediaType` enum**, here or anywhere in Prisma. `services/web`
declares its own `MEDIA_TYPE` (`MOVIE`/`SHOW`) in `src/types/media.ts` — that is a web-side type,
not a database one. If `api` needs a movie/show discriminator it must be added to `schema.prisma`
and migrated first.

There are 10 models (`Setting`, `User`, `Language`, `MediaSource`, `SourceFile`, `ProcessJob`,
`Movie`, `Show`, `Season`, `Episode`) and 10 migrations. `Show`/`Season`/`Episode` exist in the
schema but have no module and no GraphQL surface yet — the API is movies-only today.

## Tests

- Unit specs are `*.spec.ts` colocated under `src/` (jest `rootDir: "src"` in `package.json`).
- E2E specs live in `test/*.e2e-spec.ts` with their own config at `test/jest-e2e.json`, run via
  `bin/npm api run test:e2e`. Note `src/auth/test/auth.e2e-spec.ts` is picked up by **both**
  configs, because the default `testRegex` also matches `e2e-spec`.

**Two styles coexist. Only one is the convention.**

Follow `src/media-roots/media-roots.service.spec.ts` and `src/clients/torrent/magnet.spec.ts`:
`describe` for the unit, `it(...)` strings in the indicative (`it('rejects a symlink pointing
outside the root')`), a header comment stating *what class of bug this defends against*, and real
fixtures where mocking would defeat the purpose — `media-roots.service.spec.ts` runs against a
real `mkdtemp` with real symlinks because a bug there is a real path traversal.

Both of those files currently have Spanish `it(...)` strings; they predate Constitution Article VI.
Copy their *structure*, write the new prose in English.

Do **not** extend or imitate `src/users/users.service.spec.ts`, `users.resolver.spec.ts` or
`app.controller.spec.ts` — those 18-line `expect(service).toBeDefined()` files are `nest g`
scaffolding. Constitution, Article IX has the rule.

## Current state — do not treat as reference code

As of 2026-08-10, `bin/cli api npx --no tsc --noEmit` reports **0 errors**. The previously-listed
`src/auth/test/auth.service.spec.ts` (two `'user' is possibly 'null'`, one wrong arity — written
against a `login()` signature that never existed) is gone: it was deleted ahead of
`002-auth-login`, whose spec had originally left "fixing" it explicitly Out of Scope before the
file was removed entirely, taking those 3 errors with it.

The TMDB search slice that used to be listed here **now compiles**; `src/clients/TMDBClient.ts` is
gone, replaced by `src/clients/tmdb/{client,types}.ts`. Treat that vertical as ordinary code again.

Re-run the typecheck rather than trusting this count — the number is the useful part, and it is
what an agent reports before/after to prove it added nothing.

## Known debt

- `src/clients/tmdb/client.ts` hardcodes the TMDB bearer token as a literal string, and there is no
  `TMDB_API_KEY` in `.env` to replace it with — documented debt, not something to silently "fix" as
  a side effect of unrelated work.
- `src/prisma/prisma.service.ts` hardcodes the MariaDB connection string in the `PrismaMariaDb(...)`
  constructor call even though `DATABASE_URL` already exists in `.env`.
- `prisma/schema.prisma`'s `datasource db` has no `url` — see "Prisma 7 via driver adapter" above.

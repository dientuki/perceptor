# services/api

NestJS 11 + Apollo (GraphQL) + Prisma 7 + MariaDB, run only inside Docker — see the root
`CLAUDE.md` for the Docker-first workflow and `bin/` wrappers before running anything here.

## GraphQL is code-first

`src/app.module.ts` configures `GraphQLModule.forRoot` with `autoSchemaFile:
join(process.cwd(), 'src/schema.gql')`. That means:

- The **source of truth** is the TypeScript decorators on resolvers, entities (`@ObjectType`,
  `@Field`, …) and DTOs (`@InputType`, …) under each module's `entities/` and `dto/` directories.
- `src/schema.gql` is **generated on every boot** and marked "DO NOT MODIFY" at its top. Never
  hand-edit it — change the decorators and let Nest regenerate it.
- `playground`/`introspection` are on outside of `NODE_ENV=production`.

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

- `auth/` — JWT + Passport (`passport-jwt`). `guards/gql-auth.guard.ts` exposes `GqlAuthGuard` for
  resolvers; `decorators/current-user.decorator.ts` exposes `@CurrentUser()`. Service/guard/strategy
  specs live under `auth/test/`.
- `users/` — CRUD resolver/service over the `User` Prisma model, with `dto/` and `entities/`.
- `movies/` — CRUD resolver/service over the `Movie` Prisma model (`dto/`, `entities/`), plus the
  in-progress `movies.search.ts` (see Current state below).
- `prisma/` — `PrismaModule` + `PrismaService`, imported once in `AppModule` and effectively
  global to the app.
- `clients/` — external API clients, currently `TMDBClient.ts` (TMDB) and its `types.ts`.
- Loose `app.*` files at `src/` root (`app.module.ts`, `app.controller.ts`, `app.resolver.ts`,
  `app.service.ts`) wire the above together and expose a trivial REST health item alongside
  GraphQL.

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
`seedLanguages`, `seedUsers`, `seedMovies` in turn. Note `prisma/seeds/settings.ts` was removed;
`seeds/index.ts` never referenced it, so nothing else needs to change for that removal.

## Schema/enum reality check

`prisma/schema.prisma` defines exactly these enums: `DownloadStatus`, `EncodeStatus`,
`MediaStatus`. **There is no `MEDIA_TYPE` or `MediaType` enum in the Prisma schema.** Any code
importing `MEDIA_TYPE` from `@prisma/client` (e.g. `src/clients/TMDBClient.ts`,
`src/clients/types.ts`) will not compile — see "Current state" below. If you need a movie/show
discriminator, it has to be added to `schema.prisma` and regenerated first; don't assume it
already exists because some files reference it.

## Tests

- Unit specs are `*.spec.ts` colocated under `src/` (jest `rootDir: "src"` in `package.json`),
  e.g. `src/auth/test/auth.service.spec.ts`, `src/users/users.service.spec.ts`.
- E2E specs live in `test/*.e2e-spec.ts` with their own Jest config at `test/jest-e2e.json`, run
  via `bin/npm api run test:e2e`.

## Current state — do not treat as reference code

The TMDB search vertical slice is mid-refactor and does not compile:

- `src/movies/movies.search.ts` imports `@/clients/MovieDB/types` and `../types` — neither path
  exists.
- `src/movies/movies.resolver.ts` references an undefined `MovieType` and calls
  `moviesService.searchMovies()`, which is commented out in `movies.service.ts`.
- `src/clients/types.ts` and `src/clients/TMDBClient.ts` import `@/types/media` (only exists in
  `services/web`, not here) and use `MEDIA_TYPE` from `@prisma/client`, which does not exist (see
  above).

Full context and cross-service list: root `CLAUDE.md` → "Current state" and the
`perceptor-wip-tmdb-search` memory note.

## Known debt

- `src/clients/TMDBClient.ts` hardcodes the TMDB bearer token as a literal string even though
  `TMDB_API_KEY` already exists in `.env` — documented debt, not something to silently "fix" as a
  side effect of unrelated work.
- `src/prisma/prisma.service.ts` hardcodes the MariaDB connection string in the `PrismaMariaDb(...)`
  constructor call even though `DATABASE_URL` already exists in `.env`.
- `prisma/schema.prisma`'s `datasource db` has no `url` — see "Prisma 7 via driver adapter" above.

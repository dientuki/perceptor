@AGENTS.md

# services/web

Next 16 App Router, React 19, React Compiler (`reactCompiler: true` in `next.config.ts`),
`output: 'standalone'`, Tailwind 4 via PostCSS (`@tailwindcss/postcss`). Run everything through
`bin/npm web …` from the repo root (bare `web` is also `bin/npm`'s default service — see root
`CLAUDE.md`).

## Lint/format: Biome, not ESLint/Prettier

This service uses `@biomejs/biome` exclusively (`biome.json`) — there is no ESLint or Prettier
config here, unlike `services/api`.

- `bin/npm web run lint` → `biome check`
- `bin/npm web run format` → `biome format --write`

## Data-access rule: GraphQL only, no Prisma in web

Server actions in `src/actions/` must talk to the API exclusively through `fetchGraphQL` in
`src/lib/graphql-client.ts` (which reads `INTERNAL_GRAPHQL_URL`). **`services/web` has no Prisma
client of its own and no direct DB access.** Any `@prisma/client` import you see in this service
(there are several right now, listed below) is a leftover from a pre-GraphQL version of the app —
treat it as something to remove/replace with a GraphQL call, not as a working dependency.

## Auth

The auth cookie's name is not a literal string in call sites — it comes from `CONFIG.authTtoken`
in `src/lib/config.ts` (note the typo in the key, `authTtoken`, not `authToken` — it's load-bearing,
keep it consistent if you touch this). Route gating happens in `src/proxy.ts`: it reads the cookie,
then redirects unauthenticated requests away from protected routes and authenticated requests away
from `/signin` etc. `AUTH_ROUTES`/`PUBLIC_ROUTES` there define the exceptions.

## UI origin: TailAdmin template

`src/layout/`, `src/components/common|form|ui`, and `src/context/` come from the TailAdmin Next.js
admin template this project was bootstrapped from. If a component or context provider under those
directories looks unused by the current app, it's probably unused template scaffolding, not dead
code introduced during this project's development — check before deleting.

## Current state — broken imports, do not treat as reference code

These files were carried over from a pre-GraphQL version of the app and reference modules that do
not exist in this service:

- `src/components/search/SearchTorrent.tsx` — imports `{ Movie, Episode }` and `MediaType` from
  `@prisma/client` (no Prisma client in web), `TorrentResult` from `@/clients/indexer/types`,
  `@/lib/logger`, and `searchTorrentsAction`/`addTorrentToQueueAction` from `@/actions/indexer` —
  none of `clients/indexer`, `lib/logger`, or `actions/indexer` exist.
- `src/components/search/SearchTorrentModal.tsx` — imports `Modal` from `@/components/ui/modal`
  (doesn't exist; only `@/components/ui/button` etc. from TailAdmin do) and `{ MediaType, Episode,
  Movie }` from `@prisma/client`.
- `src/components/search/SearchForm.tsx` — imports `EnvelopeIcon` from `../../icons`, i.e.
  `src/icons`, which doesn't exist.
- `src/app/(dashboard)/movies/[id]/page.tsx` — imports `getMovieById` from
  `@/models/movies.model` (no `models/` directory in web) and `MediaType` from `@prisma/client`.
- `src/actions/movies.ts` — imports `MediaType` from `@/types/media` (this one *does* exist, at
  `src/types/media.ts`) and `MediaSearchResult` from `@/types/search`. Both `addMovie` and
  `searchMovies` are stubbed as `return true`; `searchMovies`'s declared return type is
  `Promise<MediaSearchResult[]>`, so that stub doesn't even satisfy its own signature. Neither
  function is actually implemented.

Full cross-service list (including the `services/api` side of the same slice): root `CLAUDE.md` →
"Current state" and the `perceptor-wip-tmdb-search` memory note.

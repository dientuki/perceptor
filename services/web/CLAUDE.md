@AGENTS.md

# services/web

Rules that outrank this file: `docs/constitution.md`. Agent brief: `.claude/agents/web.md`.
Cross-service boundary: `docs/spec/graphql-contract.md`.

Next 16 App Router, React 19, React Compiler (`reactCompiler: true` in `next.config.ts`),
`output: 'standalone'`, Tailwind 4 via PostCSS. Run everything through `bin/npm web …` from the repo
root (bare `web` is also `bin/npm`'s default service).

## Lint/format: Biome, not ESLint/Prettier

This service uses `@biomejs/biome` exclusively (`biome.json`) — no ESLint or Prettier config here,
unlike `services/api`. `bin/npm web run lint` → `biome check`; `run format` → `biome format --write`.

## Data-access rule: GraphQL only, no Prisma in web

Server actions in `src/actions/` talk to the API exclusively through `fetchGraphQL` in
`src/lib/graphql-client.ts` (which reads `INTERNAL_GRAPHQL_URL`). **`services/web` has no Prisma
client and no direct DB access.** Treat any `@prisma/client` import as a bug to flag, not a working
dependency.

### The server-action pattern

Every file in `src/actions/` has the same shape. Copy `src/actions/media-server.ts`; don't invent a
variant.

```ts
'use server'

import { fetchGraphQL } from '@/lib/graphql-client';

const MEDIA_SERVER_CLIENTS_QUERY = `
  query MediaServerClients { mediaServerClients { id label } }
`;

export async function getMediaServerOptions(): Promise<MediaServerOption[]> {
  const { data, errors } = await fetchGraphQL<{ mediaServerClients: MediaServerOption[] }>(
    MEDIA_SERVER_CLIENTS_QUERY,
  );

  if (errors && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Error al obtener los media servers soportados');
  }

  return data?.mediaServerClients ?? [];
}
```

`'use server'` on line 1; the document as a module-level `const NAME_QUERY`/`NAME_MUTATION` in
SCREAMING_SNAKE; the shape as the `fetchGraphQL<T>` type parameter; errors read from
`errors[0].message` with a Spanish fallback. Read functions `throw`; form actions used with
`useActionState` take `(prevState, formData)` and return `{ error?: string } | { success: true }`
(see `updateSettingsAction` in `src/actions/settings.ts`).

**There is no codegen.** That `<T>` is a hand-copy of `api`'s schema and nothing checks it — a
renamed field, a new non-null argument or an unhandled error condition all compile fine here and fail
at runtime. Read `docs/spec/graphql-contract.md` before changing anything that crosses the boundary.

**A server action can enrich its return value with something that never touched GraphQL.**
`createUploadTicketAction` (`src/actions/uploads.ts`) reads `process.env.PUBLIC_UPLOAD_URL`
server-side and adds it as `endpoint` alongside the ticket. The upload modal reads that instead of a
`NEXT_PUBLIC_*` variable: `NEXT_PUBLIC_*` is inlined into the browser bundle at *build* time, which
would bake whichever `.env` was present during `next build` into the image; resolving at *request*
time keeps the image deployment-agnostic. If the variable is unset the action throws before the modal
constructs the upload, rather than letting `tus.Upload({ endpoint: undefined })` fail silently.

## UI internationalization (`018-ui-i18n`)

`web` owns every string a user reads and is the only service that translates. `src/i18n/request.ts`
(next-intl's `getRequestConfig`) resolves the active locale server-side, once per request, in REQ-1's
order: `User.uiLocale` (via `getCurrentUserOrNull()`, below) → the request's `Accept-Language`
header, language-range negotiated by `src/i18n/negotiate.ts` → `en`. `src/i18n/locales.ts`'s
`SUPPORTED_LOCALES`/`DEFAULT_LOCALE` is the **one** list every consumer of the supported set reads
— never hardcode `'es'`/`'en'` anywhere else. `src/app/layout.tsx` is `async`, sets `<html lang>`
from the resolved locale, and wraps the tree in `NextIntlClientProvider` with the server-loaded
catalog. Catalogs live at `messages/en.json`/`messages/es.json`; `es` keeps the existing Rioplatense
register verbatim. `scripts/check-messages.mjs` (a plain script, not a test — this service adds no
test runner) fails non-zero on catalog drift between the two files.

**Every GraphQL/REST error is translated through a key, never rendered as raw API text.**
`src/lib/graphql-error.ts`'s `translateGraphQLError(error)` reads `extensions.i18n.key`, looks it up
in the `errors` catalog namespace (`error.auth.unauthenticated` → `errors.auth.unauthenticated`),
`JSON.parse`s `extensions.i18n.params` when present, and falls back to the error's English `message`
whenever there is no key, no catalog entry, or a parse failure — it must never return the raw key
string. Every `src/actions/*.ts` read/write derives its error text through this helper now; the REST
`/uploads` error body (`services/api/CLAUDE.md`'s uploads section) carries the same `{ message, i18n
}` shape but **not** wrapped in `extensions`, so `importFileModal.tsx` reads it directly rather than
reusing `translateGraphQLError`. See `docs/spec/graphql-contract.md` § "UI internationalization" for
the full envelope and key vocabulary — `api` and `worker` own the keys; `web` never invents one.

**Language names are not a catalog entry.** `LanguagePicker.tsx` renders each option through
`Intl.DisplayNames([activeLocale], { type: 'language' })` and sorts with `localeCompare(...,
activeLocale)` — `api`'s `languages` query returns English names only (display authority moved
here); do not add a language-name list to either catalog.

## Auth

The cookie name is never a literal at call sites — it comes from `CONFIG.authCookie`
(`src/lib/config.ts`, value `"auth_token"`), defined in one place. `fetchGraphQL` reads that cookie
and forwards it as `Authorization: Bearer …` on every server-action call; a server action that has a
session and skips this is a defect, not a style choice.

`src/lib/auth-session.ts`'s `isAuthError(errors)` matches on `error.extensions.i18n.key` against
`error.auth.unauthenticated`/`error.auth.session_expired` — **not** on `error.message` text. Before
`018-ui-i18n` it string-matched the literal Spanish sentences `api` returned, which meant
translating those sentences would have silently broken session handling; the key is stable across
locales by construction, so this now works identically no matter which language is rendering.

Route gating is in `src/proxy.ts`: a cheap **presence check** on the cookie, redirecting
unauthenticated requests away from protected routes and authenticated ones away from `/login`
(`AUTH_ROUTES`/`PUBLIC_ROUTES` define the exceptions). The real enforcement point is `api`'s global
guard — `src/app/(dashboard)/layout.tsx` calls `getCurrentUser()` (the `me` query) server-side.

### `redirectIfUnauthenticated` vs `redirectToClearSession` — not interchangeable

Both live in `src/lib/auth-session.ts` and both send an unauthenticated caller to `/login`. The
difference is **cookie mutation, which is legal only from a Server Action or a Route Handler**:

- `redirectIfUnauthenticated` deletes the stale cookie, then redirects. Use it from **form actions**.
- `redirectToClearSession` only calls `redirect()`. The deletion happens in
  `src/app/api/auth/clear-session/route.ts`, the Route Handler it redirects to (exempt from
  `proxy.ts`'s matcher, so it always runs). Use it from **any read function a Server Component
  `await`s during its render pass** — `getCurrentUser`, `getSettings`, `getMediaRoots`,
  `getMediaServerOptions`, `getMovieById`, `getShowById`, `getMovies`, `getShows`, `getLanguages`.

Getting this wrong is not a style bug. Cookie mutation *throws* during a render pass; and without the
real deletion, `proxy.ts`'s presence-only check bounces `/login` straight back to `/dashboard` on the
stale cookie — a loop, not a fix. **Pick based on where the call actually happens, not by copying the
nearest example**, and re-derive it if you move a fetch between server and client.

## Admin user management

`src/actions/users.ts` (`getUsers`/`createUserAction`/`deleteUserAction`/`setUserEnabledAction`),
`src/app/(dashboard)/users/page.tsx`, `src/components/users/UsersManager.tsx` (client table + create
form), `src/types/users.ts` (`AdminUser`). The `isAdmin`-gated sidebar entry is wired through
`src/layout/AdminShell.tsx` → `AppSidebar.tsx`.

- `page.tsx` checks `getCurrentUser().isAdmin` and calls `notFound()` **before** calling `getUsers()`,
  **sequentially, never via `Promise.all`** — racing them turns `api`'s `AdminGuard` refusal into a
  500 instead of a clean 404.
- The per-row enable toggle and the delete button are disabled on the caller's own row as a usability
  affordance only; the real enforcement (self-disable, last-admin, session revocation) is server-side.
- `setUserEnabledAction` sends only `{ id, isEnabled }`, never the rest of `UpdateUserInput`, and
  parses the target state as `=== 'true'` rather than a truthy check — `formData` values are always
  strings and `"false"` is truthy.

## Media search

`SearchContainer.tsx` backs both `/movies/add` and `/shows/add`, parameterized by a `type: MediaType`
prop, with `searchAction`/`addAction` passed in by the page (`searchMedia`/`addMedia` from
`src/actions/media.ts`). `handleAdd` never calls `router.push` after a successful add — the user
stays on the search screen and that card changes, tracked in local `addedMediaIds` state until the
next search.

Each `MediaSearchResult` carries `mediaId` (the registered row's id, if *anyone* has registered it,
else `null`) and `inLibrary` (true only for the caller). **`renderAction` treats a card as owned when
`inLibrary` is true or it was added this session — never when `mediaId !== null` alone**, since a
title someone else registered is still addable by the caller (that add only links them, it never
re-downloads). The owned branch splits by type: a film renders an `Ir` link to `/movies/<mediaId>`, a
series a non-interactive `Agregada` badge with no `href` (nothing has asked for it to link to
`/shows/[id]`, which does exist).

`SearchInput.tsx`'s submit button is the shared `Button` (`src/components/ui/button/Button.tsx`,
`bg-brand-500`), not a hand-rolled element — a `bg-primary` class silently compiles to nothing, since
this service's Tailwind 4 `@theme` only defines `--color-brand-*`. Do not reintroduce a `primary`
token; reuse the shared component.

## Detail pages are scoped, with a route-segment 404

`/movies/[id]` and `/shows/[id]` are structural twins. `api` returns `null` both for a nonexistent id
and for a title the caller does not own, and **these pages cannot and must not tell the two apart**.

- Validate the route param (`parseMovieId`, positive integers only) **before** fetching, in both the
  page component and `generateMetadata` — a non-numeric id reaches the API as `NaN` and surfaces as
  an uncaught 500, since it isn't one of the auth-error strings `redirectToClearSession` checks for.
- `generateMetadata` returns a fixed `UNAVAILABLE_METADATA` (Spanish, no title-derived text) for both
  an invalid param and a `null` result, so the browser tab cannot leak a title's existence.
- The unavailable page is a **segment-scoped** `not-found.tsx` per route, rendering
  `Recurso no disponible para este usuario` as a real HTTP 404. Deliberately not an app-wide 404 —
  `/users`'s `notFound()` is untouched.

`/shows/[id]` renders `src/components/shows/Show.tsx` (`Movie.tsx`'s twin minus the acquisition
buttons — a series has none at that level), then one `SeasonAccordion.tsx` per season, the highest
`seasonNumber` expanded by default (computed once via `Math.max`, not per-season inside the loop).
Each episode row carries the same three buttons `Movie.tsx` uses (buscar / importar archivo / añadir
torrent).

## The `AcquisitionTarget` union

`SearchTorrentModal.tsx`, `SearchTorrent.tsx`, `importMagnetModal.tsx` and `importFileModal.tsx` all
take a single `target: AcquisitionTarget | null` prop:

```ts
export type AcquisitionTarget =
  | { kind: "movie"; movie: Movie }
  | { kind: "episode"; episode: Episode; showTitle: string; seasonNumber: number };
```

(`src/types/media.ts`.) This makes illegal states unrepresentable: the old `item`/`mediaType` pair
could disagree — an episode paired with `MEDIA_TYPE.MOVIE` — which is exactly how an episode id
reached a film mutation's `movieId` argument with no compile error. Each caller builds a `target`
locally (`Movie.tsx` for a film, `SeasonAccordion.tsx` for an episode, setting `activeEpisode`
**before** opening a modal — all three modals early-return `null` on a null target). Follow this for
any new acquisition entry point rather than reintroducing a bare id/type pair.

`Episode` is a single type, re-exported from `src/actions/shows.ts`. Import it from there, never
redeclare it.

## Language pickers: three call sites, one component

`src/actions/languages.ts` follows the standard server-action shape; `getLanguages` uses
`redirectToClearSession`, the three writes use `redirectIfUnauthenticated` (see the auth section).
`src/components/media/LanguagePicker.tsx` is the one client component all three call sites share —
a multi-select bound to a `useActionState` action, generic over `options`/`selected`/action.

`PreferredLanguagesCard.tsx` wraps it for the global preference and renders on `/settings` as its
**own card, not inside `SettingsForm`** — that form posts through `updateSettings`/`EDITABLE_KEYS`,
installation-wide key/value config, and a language preference is per-user, not a `SETTINGS_CATALOG`
entry. `Movie.tsx` and `Show.tsx` each bind the picker to their own per-title action; `Show.tsx`
stays a Server Component with the picker as a client child.

**The listing queries deliberately do not select `preferredLanguages`.** They are `api` field
resolvers that only run when selected — `getMovieById`/`getShowById` select them, `getMovies`/
`getShows` must not, or 200 rows become 200 preference queries.

## Library listings: two parallel screens, not one parameterized one

`/movies` and `/shows` are deliberately **separate** implementations (`getMovies()` +
`components/movies/Movies.tsx`, `getShows()` + `components/shows/Shows.tsx`). This is the opposite of
`SearchContainer` above and is not an oversight: `api` exposes `movies` and `shows` as two sibling
queries with two independent types. Do not merge them; the duplication is cheaper than the parameter.

What *is* shared is the rendering: both pass rows to `src/components/media/MediaList.tsx`, which takes
a `mediaType` prop and already produces the right Spanish empty state for each. Never pass a custom
`emptyMessage`, never fork `MediaList`/`MediaCard`.

**Both list components are Server Components, not client fetches** — `async function` components that
`await` their action during render, no `"use client"`, no `useEffect`. An earlier client-fetching
version served the empty state first and repainted after hydration on every navigation. Consequences:
they call `redirectToClearSession` (see the auth section), and a non-auth error is logged with
`console.error` and swallowed to `[]` rather than thrown — there is no `app/(dashboard)/error.tsx`, so
an uncaught throw would surface Next's default error screen instead of the shared empty state.

**`MediaCard` resolves its detail `href` from the `mediaType` prop, not a payload field.** Neither
`Movie` nor `Show` has ever carried a `type` field; do not add one to solve a routing decision that is
already solved, and do not resolve `href` off `item.type`.

## UI origin: TailAdmin template

`src/layout/`, `src/components/common|form|ui`, and `src/context/` come from the TailAdmin Next.js
template this project was bootstrapped from. A component under those directories that looks unused is
probably template scaffolding, not dead code from this project — check before deleting.

## Tests: there are none

No test file, no runner, no `test` script. This is the largest maturity gap of the three services.
The quality gate is the typecheck, Biome on the file you touched, and actually opening the page.

Do **not** add Vitest or Playwright as a side effect of a feature task — introducing a test toolchain
here is its own decision and deserves its own spec. `scripts/check-messages.mjs` (`018-ui-i18n`) is
a plain Node script, not an exception to this rule — it has no framework, no assertions, just a
parity check with an exit code.

## Small conventions that are easy to get wrong

- **Controlled inputs use a raw `<input>`**, not `@/components/form/input/InputField`. That shared
  component's `InputProps` accepts `defaultValue` and *not* `value`; every controlled input
  (`PathPicker`, the import modals) uses a raw element with InputField's Tailwind classes copied in.
  Follow that rather than widening the shared component.
- **`id` is a `string`** in this service's types even where the GraphQL argument is `Int!`. Wrap with
  `Number(...)` at the call site, as `SearchTorrent.tsx` and `importMagnetModal.tsx` do.
- **Errors render inline**, never through `alert()` or `window.confirm()`. The import modals are the
  reference.
- **`next build` must run under `NODE_ENV=production`** — `package.json`'s `build` script sets it
  explicitly, because the dev container passes `NODE_ENV=development` in. Building under
  `development` resolves React's development export conditions and produces a mismatched React
  instance, failing prerender with `Cannot read properties of null (reading 'useState')` on every
  client component. Do not "fix" that class of error by opting a page out of prerendering or
  suppressing the compiler.
- **`useSearchParams()` needs a `<Suspense>` boundary** to prerender (`/login` wraps `<LoginForm />`
  that way). Next's documented pattern, not a workaround.

## Current state

As of 2026-08-20 (`018-ui-i18n`): `bin/cli web npx --no tsc --noEmit` reports **0 errors** and
`bin/npm web run build` exits 0. Re-run both rather than trusting this — report the numbers before
and after a change to prove you added nothing.

`bin/npm web run lint` is **not** a usable gate: `biome check` reports ~1598 errors and ~96 warnings
across the pre-existing template, with or without any given change. Judge a new file by running Biome
on that file, never on the repo.

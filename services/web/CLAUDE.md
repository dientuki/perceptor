@AGENTS.md

# services/web

Rules that outrank this file: `docs/constitution.md`. Agent brief: `.claude/agents/web.md`.
Cross-service boundary: `docs/spec/graphql-contract.md`.

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

**There is no codegen.** That `<T>` is a hand-copy of `api`'s schema, and nothing checks it — a
renamed field, a new non-null argument or an unhandled error condition all compile fine here and
fail at runtime. Read `docs/spec/graphql-contract.md` before changing anything that crosses the
boundary.

## Auth

The auth cookie's name is not a literal string in call sites — it comes from `CONFIG.authCookie` in
`src/lib/config.ts` (value `"auth_token"`; older revisions of this file had it as `authTtoken`, a
typo corrected by `002-auth-login`'s REQ-2 — one cookie name, defined in one place). `fetchGraphQL`
(`src/lib/graphql-client.ts`) reads that cookie and forwards it as `Authorization: Bearer …` on
every server-action call to `api`; a server action that has a session and skips this is a defect,
not a style choice. Route gating happens in `src/proxy.ts`: it reads the cookie for a cheap
presence check and redirects unauthenticated requests away from protected routes and authenticated
requests away from `/login` etc. — `AUTH_ROUTES`/`PUBLIC_ROUTES` there define the exceptions. The
real enforcement point is `api`'s global guard: `src/app/(dashboard)/layout.tsx` calls
`getCurrentUser()` (the `me` query) server-side, and `src/lib/auth-session.ts`'s
`redirectIfUnauthenticated` sends any action that gets back `No autenticado` or a session-expired
error straight to `/login`, deleting the stale cookie first.

## Admin user management (`003-auth-user-management`, `004-user-disable`)

`src/actions/users.ts` (`getUsers`/`createUserAction`/`deleteUserAction`/`setUserEnabledAction`,
same server-action shape as `settings.ts`), `src/app/(dashboard)/users/page.tsx` (server component —
checks `getCurrentUser().isAdmin` and calls `notFound()` **before** calling `getUsers()`,
sequentially, never via `Promise.all`: racing them turns `api`'s `AdminGuard` refusal into a 500
instead of a clean 404), `src/components/users/UsersManager.tsx` (the client-side table + create
form), and `src/types/users.ts` (`AdminUser`). The `isAdmin`-gated "Users" sidebar entry is wired
through `src/layout/AdminShell.tsx` → `src/layout/AppSidebar.tsx`.

`AdminUser.isEnabled` drives an "Estado" column and a per-row toggle form
(`setUserEnabledAction`), disabled on the caller's own row the same way the delete button already
is — the real enforcement (self-disable, last-admin, session revocation) is server-side, this is a
usability affordance only. `setUserEnabledAction` sends only `{ id, isEnabled }`, never the rest of
`UpdateUserInput`, and parses the target state explicitly from `formData` (`=== 'true'`) rather
than a truthy check, since `formData` values are always strings and `"false"` is truthy.

## Session invalidation from a Server Component render (`004-user-disable`)

`redirectIfUnauthenticated` (`src/lib/auth-session.ts`) deletes the auth cookie before redirecting
to `/login` — legal only from a Server Action or a Route Handler. `getCurrentUser()`
(`src/actions/auth.ts`), `getSettings`, `getMediaRoots`, `getMediaServerOptions` and `getMovieById`
are all read functions a Server Component `await`s directly during its render pass (the dashboard
layout, `/settings`, `/movies/[id]`), where cookie mutation throws instead of working. Those call
`redirectToClearSession` instead, which only calls `redirect()` — the actual cookie deletion
happens in the new `src/app/api/auth/clear-session/route.ts` Route Handler it redirects to (exempt
from `src/proxy.ts`'s matcher, so it always runs). Without the real deletion, `proxy.ts`'s
presence-only check on `/login` would bounce straight back to `/dashboard` since the stale cookie
never went away — a loop, not a fix. This surfaced because `004-user-disable`'s session revocation
is the first thing that can invalidate a *live, in-use* session from outside; before it, a cookie
only went stale via explicit logout (a Server Action) or TTL expiry. Any new read function a
Server Component awaits directly needs `redirectToClearSession`, not `redirectIfUnauthenticated` —
the two are not interchangeable, pick based on the caller's context, not by copying the nearest
example.

## Media search and per-user libraries (`005-movie-search`, generalized by `006-media-search`)

`src/components/search/SearchInput.tsx`'s submit button is the shared `Button`
(`src/components/ui/button/Button.tsx`, `bg-brand-500`), not a hand-rolled element — a
`bg-primary` class silently compiled to nothing before `005-movie-search`, since `web`'s Tailwind 4
`@theme` only ever defined `--color-brand-*`. Do not reintroduce a `primary` colour token here;
reuse the shared component instead of styling a bare `<button>`.

`src/components/search/SearchContainer.tsx` now backs both `/movies/add` and `/shows/add`,
parameterized by its `type: MediaType` prop — `searchAction`/`addAction` are passed in by the page
(`searchMedia`/`addMedia` from `src/actions/media.ts`, since `006-media-search`; `src/actions/movies.ts`
no longer exports a search/add pair). `handleAdd` never calls `router.push` after a successful add
— the user stays on the search screen and that result's card changes, tracked in local
`addedMediaIds` state (keyed by TMDB id) until the next search. Each `MediaSearchResult` carries
`mediaId` (the registered row's id in whatever table `type` names, if *anyone* has registered it,
else `null` — renamed from `movieId` by `006-media-search`; see `docs/spec/graphql-contract.md`
for why the sibling `movieId`s elsewhere in this service were deliberately left alone) and
`inLibrary` (true only for the caller). `renderAction` treats a card as owned when
`item.inLibrary` is true **or** it was added this session, never when `mediaId !== null` alone,
since something someone else already registered is still addable by the caller (that add only
links them, it never re-downloads). **The owned branch itself now splits by type**: a film renders
the `Ir` link (`next/link` → `/movies/<mediaId>`) exactly as before; a series renders a
non-interactive `Agregada` badge with no `href`. `/shows/[id]` exists as a real route since
`009-show-detail` — this badge was never revisited to link there, since `SearchContainer` is scoped
to search results, not the library listing, and nothing in that feature asked for it.

## Movie and show detail are scoped, with a route-segment 404 (`008-movie-detail`, `009-show-detail`)

`src/app/(dashboard)/movies/[id]/page.tsx` still calls the same `getMovieById` query it always did
(`src/actions/movies.ts`), unchanged — the API now returns `null` for a film the caller does not
own, on top of the `null` it already returned for a nonexistent id, and this page cannot and must
not tell the two apart. `page.tsx` validates the route param (`parseMovieId`, positive integers
only) *before* fetching, in both the page component and `generateMetadata` — a non-numeric id used
to reach the API as `NaN` and surface as an uncaught 500, since it isn't one of the two auth-error
strings `redirectToClearSession` checks for. `generateMetadata` returns a fixed
`UNAVAILABLE_METADATA` (Spanish, no film-derived text) for both an invalid param and a `null`
film — same title and description either way, so the browser tab cannot leak a film's existence
even when the page body looks correct.

The unavailable page itself is a segment-scoped `src/app/(dashboard)/movies/[id]/not-found.tsx`,
rendering `Recurso no disponible para este usuario`, served as a real HTTP 404 by Next when
`notFound()` fires in this segment. It is deliberately **not** an app-wide 404 — `/users`'s
`notFound()` (see above) is untouched.

`009-show-detail` shipped `/shows/[id]` as the structural twin one level deeper: `getShowById`
(`src/actions/shows.ts`) follows the same `parseId`-guard-then-fetch-then-`notFound()` shape,
its own `src/app/(dashboard)/shows/[id]/not-found.tsx` renders the identical string, and `api`'s
`show(id)` is scoped through `UserShow` the same way `movie(id)` is scoped through `UserMovie` —
same `null`-means-"not available to you" rule, no way to tell "doesn't exist" from "not yours".
Below the show's own metadata (rendered by `src/components/shows/Show.tsx`, `Movie.tsx`'s twin
minus the acquisition buttons — a series has none at that level), the page renders one
`src/components/shows/SeasonAccordion.tsx` per season, the highest `seasonNumber` expanded by
default (computed once via `Math.max`, not per-season inside the render loop). Each episode row
renders three buttons (buscar / importar archivo / añadir torrent); since `010-episode-acquisition`
these are wired to the same three modals `Movie.tsx` uses for a film — see the section below.

## Per-episode acquisition and the `AcquisitionTarget` union (`010-episode-acquisition`)

`SearchTorrentModal.tsx`, `SearchTorrent.tsx`, `importMagnetModal.tsx` and `importFileModal.tsx`
all take a single `target: AcquisitionTarget | null` prop instead of the old `item`/`mediaType`
pair:

```ts
export type AcquisitionTarget =
  | { kind: "movie"; movie: Movie }
  | { kind: "episode"; episode: Episode; showTitle: string; seasonNumber: number };
```

(`src/types/media.ts`). This exists to make illegal states unrepresentable — before this feature,
`item`/`mediaType` could disagree (an episode paired with `MEDIA_TYPE.MOVIE`), which is exactly how
an episode id used to reach a film mutation's `movieId` argument with no compile error. Every
caller builds a `target` locally (`Movie.tsx` for a film, `SeasonAccordion.tsx` for an episode,
holding `activeEpisode` state and setting it **before** opening a modal — all three modals early-
return `null` on a null target) and passes the same `target` to whichever modal(s) it opens. Follow
this pattern for any new acquisition entry point rather than reintroducing a bare id/type pair.

`Episode` is now a single type, re-exported from `src/actions/shows.ts` (the real one, added by
`009-show-detail`) — the placeholder stub that used to live in `src/types/media.ts` is gone. Import
`Episode` from `@/actions/shows`, never redeclare it.

## Language pickers, three call sites sharing one component (`011-av1-transcode`)

`src/actions/languages.ts` (`getLanguages`, `setPreferredLanguagesAction`,
`setMoviePreferredLanguagesAction`, `setShowPreferredLanguagesAction`) follows the standard
server-action shape above; `getLanguages` uses `redirectToClearSession` (awaited during a Server
Component render, on `/settings` and both detail pages), the three writes use
`redirectIfUnauthenticated`. `src/components/media/LanguagePicker.tsx` is the one client component
all three call sites share — a multi-select bound to a `useActionState` action, generic over
`options`/`selected`/which action it's bound to. `src/components/settings/PreferredLanguagesCard.tsx`
wraps it for the global preference and renders on `/settings` as its **own card**, not inside
`SettingsForm` — that form posts through `updateSettings`/`EDITABLE_KEYS`, installation-wide
key/value config, and a language preference is per-user, not a `SETTINGS_CATALOG` entry.
`Movie.tsx` and `Show.tsx` each render the same `LanguagePicker` bound to their own per-title
action; `Show.tsx` stays a Server Component, the picker is a client child. None of the three
listing queries (`getMovies`/`getShows`, or the picker's own `options` source `getLanguages`) are
touched by this — `Movie.preferredLanguages`/`Show.preferredLanguages` are `api` field resolvers
that only run when selected, so `getMovieById`/`getShowById` select the field but the listing
queries deliberately do not, or 200 rows in a listing become 200 preference queries.

## Library listings: two parallel screens, not one parameterized one (`007-library-listing`)

`/movies` and `/shows` are deliberately **separate** implementations — `src/actions/movies.ts`'s
`getMovies()` + `src/components/movies/Movies.tsx`, and `src/actions/shows.ts`'s `getShows()` +
`src/components/shows/Shows.tsx`. This is the opposite of what `SearchContainer` did above, and it
is not an oversight: `api` exposes `movies` and `shows` as two sibling queries with two independent
types (see `docs/spec/graphql-contract.md` → `007-library-listing`). Do not merge them; the
duplication is cheaper than the parameter.

What *is* shared is the rendering: both pass their rows to `src/components/media/MediaList.tsx`,
which takes a `mediaType` prop and already produces the right Spanish empty state for each ("No hay
series registradas" for `MEDIA_TYPE.SHOW`). Never pass a custom `emptyMessage` and never fork
`MediaList`/`MediaCard` — those two are the one thing the two listings genuinely share.

**Both list components are Server Components, not client fetches.** `Movies.tsx` and `Shows.tsx`
are `async function` components that `await getMovies()` / `await getShows()` directly during
render and hand the rows to `MediaList` — no `"use client"`, no `useState`/`useEffect`. This
replaced an earlier version where each was a client component fetching in `useEffect`, which
served the empty state first and repainted after hydration on every navigation. Because the fetch
now runs during a Server Component's render, cookie mutation is illegal on the auth-error path —
both actions call `redirectToClearSession`, **not** `redirectIfUnauthenticated` (see the
session-invalidation section above for why that distinction is by caller context, not by
resemblance). A non-auth error is logged with `console.error` and swallowed to `[]` rather than
thrown — there is no `app/(dashboard)/error.tsx`, so an uncaught throw from this path would
surface Next's default error screen instead of the shared empty state.

If you add a third listing (or move either of these back to a client fetch — e.g. for polling),
re-derive which of `redirectIfUnauthenticated`/`redirectToClearSession` applies from where the call
actually happens; don't copy whichever this section currently says.

The directory casing that used to be inconsistent (`src/components/Shows/` vs
`src/components/movies/`) is fixed — both are lowercase now.

**The series card's detail link is fixed, without a `type` field on `Show` (`009-show-detail`).**
`MediaCard` resolves its `href` from a `mediaType` prop, not from a payload field — `MediaList`
already received `mediaType` for its own empty-state text and now forwards it into `MediaCard` too.
`getShows()` still does not select (and `Show` still does not carry) a `type` field; do not add one
to solve a routing decision that is already solved client-side, and do not resolve `href` off
`item.type` again — that field has never existed on either `Movie` or `Show`.

## UI origin: TailAdmin template

`src/layout/`, `src/components/common|form|ui`, and `src/context/` come from the TailAdmin Next.js
admin template this project was bootstrapped from. If a component or context provider under those
directories looks unused by the current app, it's probably unused template scaffolding, not dead
code introduced during this project's development — check before deleting.

## Tests: there are none

No test file, no test runner, no `test` script. This is the largest maturity gap of the three
services. Your quality gate is the typecheck, Biome, and actually opening the page you changed.

Do **not** add Vitest or Playwright as a side effect of a feature task — introducing a test
toolchain here is its own decision and deserves its own spec.

## Small conventions that are easy to get wrong

- **Controlled inputs use a raw `<input>`**, not `@/components/form/input/InputField`. That shared
  component's `InputProps` accepts `defaultValue` and *not* `value`; every controlled input in the
  codebase (`PathPicker`, the import modals) uses a raw element with InputField's Tailwind classes
  copied in. Follow that rather than widening the shared component.
- **`id` is a `string`** in this service's types (`src/actions/movies.ts`) even where the GraphQL
  argument is `Int!`. Wrap with `Number(...)` at the call site, as `SearchTorrent.tsx` and
  `importMagnetModal.tsx` do.
- **Errors render inline**, never through `alert()` or `window.confirm()`. The import modals are
  the reference.

## Current state — do not treat as reference code

As of 2026-08-14, after `010-episode-acquisition`, `bin/cli web npx --no tsc --noEmit` reports **11
errors across 4 files**, down from 12 across 5 — `src/components/search/SearchTorrentModal.tsx`'s
`@prisma/client` import is gone, retyped against `AcquisitionTarget` (this service's last Article II
violation; `grep -rn "@prisma/client" services/web/src` now returns nothing). The remaining 4 are
unchanged leftovers from a pre-GraphQL version of the app; none are on a path the running UI uses.

| File | Problem |
| :-- | :-- |
| `src/components/import/importFolderModal.tsx` | imports `@/actions/jobs` (does not exist); passes `value` to `InputField` |
| `src/components/import/ImportMagnetSeasonModal.tsx` | same two, for season-level bulk import — deliberately out of scope for `010-episode-acquisition` (episode-level only), kept as-is |
| `src/components/search/SearchForm.tsx` | imports `../../icons` (no `src/icons/`); implicit `any` props |
| `src/components/search/ResultsForm.tsx` | untyped destructured props (5 implicit `any`) |

The 6th error that used to be listed here — `Cannot find module '@/components/movies/Shows'` on
`src/app/(dashboard)/shows/page.tsx` — is **gone as of `007-library-listing`**, which finished that
untracked paste into the real series listing. `009-show-detail` similarly rewrote
`src/app/(dashboard)/shows/[id]/page.tsx`, `src/components/shows/Show.tsx` and
`src/components/shows/SeasonAccordion.tsx` from scratch (they were broken, uncommitted drafts at
the time); `010-episode-acquisition` wired `SeasonAccordion.tsx`'s three per-episode buttons to
real modals (see the section above) — neither ever contributed to this count.
`src/actions/languages.ts`, `src/types/languages.ts`, `LanguagePicker.tsx`,
`PreferredLanguagesCard.tsx` and the touched fetches in `src/actions/{auth,movies,shows}.ts`
(`011-av1-transcode`) don't contribute either. Verified 2026-08-17: `bin/cli web npx --no tsc
--noEmit` reports 11 errors across the 4 files above and nothing else.

`bin/npm web run lint` is **not** a usable gate today: `biome check` reports ~1598 errors and ~96
warnings across the pre-existing template, with or without any given change. Judge a new file by
running Biome on that file (a new action like `src/actions/shows.ts` should come back clean) rather
than on the repo.

Files that used to be on this list and now compile: `SearchTorrent.tsx`,
`src/app/(dashboard)/movies/[id]/page.tsx`, `src/actions/movies.ts`. The new
`src/app/(dashboard)/movies/[id]/not-found.tsx` (`008-movie-detail`) is clean too — not among the
12. `@/components/ui/modal` and
`@/hooks/useModal` exist now, built for the import modals.

Re-run the typecheck rather than trusting the count. The number is the point: report it before and
after a change to prove you added nothing.

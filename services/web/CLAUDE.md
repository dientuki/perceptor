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

As of 2026-08-10, `bin/cli web npx --no tsc --noEmit` reports **12 errors across 5 files**. All are
leftovers from a pre-GraphQL version of the app; none are on a path the running UI uses.
(Previously logged here as 13 — that was never the real count; these same five files have always
produced 12, confirmed while implementing `002-auth-login`.)

| File | Problem |
| :-- | :-- |
| `src/components/import/importFolderModal.tsx` | imports `@/actions/jobs` (does not exist); passes `value` to `InputField` |
| `src/components/import/ImportMagnetSeasonModal.tsx` | same two, for shows/seasons the API doesn't expose yet |
| `src/components/search/SearchTorrentModal.tsx` | imports `@prisma/client` — a direct Constitution Article II violation |
| `src/components/search/SearchForm.tsx` | imports `../../icons` (no `src/icons/`); implicit `any` props |
| `src/components/search/ResultsForm.tsx` | untyped destructured props (5 implicit `any`) |

Files that used to be on this list and now compile: `SearchTorrent.tsx`,
`src/app/(dashboard)/movies/[id]/page.tsx`, `src/actions/movies.ts`. `@/components/ui/modal` and
`@/hooks/useModal` exist now, built for the import modals.

Re-run the typecheck rather than trusting the count. The number is the point: report it before and
after a change to prove you added nothing.

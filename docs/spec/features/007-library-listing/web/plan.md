---
title: Library Listing for Movies and Shows — web slice
service: web
last_updated: 2026-08-12
status: Implemented
---

# PLAN: Library Listing for Movies and Shows — `web` (`web/plan.md`)

> Before writing any Next.js code, read the relevant guide under
> `services/web/node_modules/next/dist/docs/` — see `services/web/AGENTS.md`. This is Next 16 with
> the React Compiler on; conventions differ from older versions.

## Scope

This slice makes `/shows` render the caller's series: one new server action (`getShows`), one new
type, and finishing the two untracked, currently-broken files that were pasted from the Movies UI.
It consumes the `shows` query `api` adds — **`api` must land first**; there is nothing here that can
be verified against a schema that does not have `shows` in it yet.

It does **not** touch the film listing. `src/actions/movies.ts`, `src/components/movies/Movies.tsx`,
`src/app/(dashboard)/movies/page.tsx` and the shared `MediaList`/`MediaCard` come out of this
feature unchanged (spec REQ-7). It does not fix the series detail link and does not touch
`src/app/(dashboard)/shows/[id]/page.tsx` or `src/components/Shows/Movie.tsx` — both belong to the
next spec. It adds no test toolchain (`services/web/CLAUDE.md`: that is its own decision).

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report (see
`.claude/agents/web.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/actions/shows.ts` | New | `getShows()` server action + the `Show` type |
| `services/web/src/components/Shows/Shows.tsx` | Modified | Currently calls `getMovies()` and renders `MEDIA_TYPE.MOVIE`; must call `getShows()` and render `MEDIA_TYPE.SHOW` |
| `services/web/src/app/(dashboard)/shows/page.tsx` | Modified | Currently imports the non-existent `@/components/movies/Shows`; must import the real component, and its metadata/breadcrumb say "Movies" |

Both modified files are **untracked** — they have never been committed. Treat them as scaffolding to
finish, not as working code to preserve.

Naming note: the existing directory is `src/components/Shows/` (capitalised), while the film
equivalent is `src/components/movies/` (lowercase). Leave the casing as it is; renaming a directory
is churn this feature does not need, and `components/Shows/Movie.tsx` next door belongs to the next
spec.

## Existing code to reuse

- `src/actions/movies.ts` (`getMovies`, lines 22-41) — the exact server-action shape to copy:
  `'use server'` on line 1, the document as a module-level `const … _QUERY`, the shape as
  `fetchGraphQL<T>`'s type parameter, `redirectIfUnauthenticated(errors)` then
  `throw new Error(errors[0]?.message || '…')`, and `return data?.shows ?? []`. The Spanish fallback
  here is `'Error al obtener series'` (spec § Errors).
- `src/components/movies/Movies.tsx` — the client component pattern: `"use client"`, `useState`,
  load in `useEffect`, `catch` and log. `Shows.tsx` is already a copy of it; the change is which
  action it calls and which `mediaType` it passes.
- `src/components/media/MediaList.tsx` — **already handles series.** Passing
  `mediaType={MEDIA_TYPE.SHOW}` makes its empty state read "No hay series registradas" (spec REQ-6,
  AC-12). Do not add a component, and do not pass a custom `emptyMessage`.
- `src/components/media/MediaCard.tsx` — renders poster/title/year off a generic `item`. **Do not
  modify it.** See Contract obligations.
- `src/app/(dashboard)/movies/page.tsx` — the page shell (breadcrumb + card wrapper) `shows/page.tsx`
  should mirror, with "Shows"/series copy instead of the "Movies" strings it was pasted with.
- `src/types/media.ts` — `MEDIA_TYPE.SHOW` already exists.

## Steps

1. Create `src/actions/shows.ts`: a `Show` interface matching `../spec.md` § GraphQL Contract Delta
   (`id` as `string` — this service types ids as strings even where GraphQL says `Int!`, see
   `services/web/CLAUDE.md`), a `GET_SHOWS_QUERY` selecting the fields the card needs, and
   `getShows()` following `getMovies()`.
2. Fix `src/components/Shows/Shows.tsx`: import `getShows`/`Show` from `@/actions/shows`, rename the
   default export from `Movies` to `Shows`, pass `mediaType={MEDIA_TYPE.SHOW}`, and translate the
   pasted Spanish `console` strings to series. Keep `showLink={true}` — see Contract obligations.
3. Fix `src/app/(dashboard)/shows/page.tsx`: import from `@/components/Shows/Shows`, and replace the
   pasted `"Movies | Perceptor"` metadata, the `"List of tracked movies"` description, the
   `pageTitle="Movies"` breadcrumb and the `MoviesPage` function name with series equivalents.
4. Typecheck and lint. Report the error count before and after.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is read-only. This service consumes
`shows: [Show!]!` — never null, `[]` for an empty library, so an empty result is a normal render and
not an error branch.

Every error condition, and what this slice does with it (there is no codegen; a consumer that only
handles the happy path compiles fine and fails at runtime):

| Condition | Message | What `getShows()` does |
| :-- | :-- | :-- |
| No credential / expired JWT | `Unauthorized` | `await redirectIfUnauthenticated(errors)` before throwing — the user lands on `/login` |
| Anything else (DB down, etc.) | `Error al obtener series` | `throw new Error(errors[0]?.message \|\| 'Error al obtener series')`; `Shows.tsx`'s `catch` logs it and the grid stays empty |

`redirectIfUnauthenticated` — **not** `redirectToClearSession` — is correct here, because `getShows`
is called from a **client** component's `useEffect`, which reaches the action as a Server Action
where cookie mutation is legal. The two are not interchangeable and `services/web/CLAUDE.md`
documents the trap; pick by caller context, not by copying the nearest example. If a later change
makes a Server Component `await getShows()` during render, that call needs the other function.

Two things this slice must **not** do, both of which will look like obvious one-line improvements:

- **Do not add `type` to the query document or the `Show` interface.** `MediaCard` builds its href
  as `item.type === MEDIA_TYPE.SHOW ? '/shows/<id>' : '/movies/<id>'`, so adding it would "fix" the
  broken series link — and send users to `src/app/(dashboard)/shows/[id]/page.tsx`, which is an
  untracked paste that fetches a **movie** by that id and would render a real film under a series'
  name. Wrong content, no error. The link and the detail page are the next spec, together.
- **Do not modify `MediaCard.tsx` or `MediaList.tsx`.** They are shared with the film listing, which
  spec REQ-7 requires to be unchanged.

## Tests

**None owed, and this is not an omission.** This service has no test runner and adding one is
explicitly its own decision (`services/web/CLAUDE.md`), not a side effect of a feature task. The
slice is a fetch and a render with no logic that can fail silently: the one silent failure in this
feature — the ownership filter — lives in `api` and is covered by `shows.service.spec.ts`. The gate
here is the typecheck, Biome, and opening `/shows` (spec AC-11, AC-12).

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
```

Expected: **12 errors across the 5 documented pre-GraphQL files and no sixth** — the
`Cannot find module '@/components/movies/Shows'` error on `app/(dashboard)/shows/page.tsx` is gone
(spec AC-10). Do not attempt to clear the other 12; they are out of scope and none of them are on a
path this feature touches.

`bin/npm web run build` still fails on those 12 (`next.config.ts` sets no `ignoreBuildErrors`, so
the build typechecks every included file). That is expected and is **not** a gate for this slice.

Then open `/shows` in the browser with a library of a few series, and again as a user with none.
Clicking a card navigates to `/movies/<id>` and shows the wrong thing — that is the known,
deliberate gap; do not report it as a defect and do not fix it.

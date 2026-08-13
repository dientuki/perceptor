---
title: Movie Detail Resource, Scoped to Its Owner — web slice
service: web
last_updated: 2026-08-12
status: Implemented
---

# PLAN: Movie Detail Resource, Scoped to Its Owner — `web` (`web/plan.md`)

Read `../spec.md` and `../plan.md` first. The GraphQL delta in `../spec.md` is read-only.

## Scope

This slice gives `/movies/[id]` a Spanish page for the case where the film is not available to the
caller, and stops a non-numeric route param from reaching the API. That is all.

The GraphQL call does not change — not the query text, not the fields, not the typing.
`getMovieById` already returns `null` when the API answers `movie: null`, and after the `api` slice
lands that null also covers "this film belongs to someone else". The reason the user currently sees
an English 404 is simply that **no `not-found.tsx` exists anywhere under
`services/web/src/app`**, so `notFound()` falls through to the Next default.

Explicitly **not** this slice: the ownership rule itself (`api` owns it — a film the caller does not
own must never arrive here in the first place; do not filter client-side); `/shows/[id]`, which is
an untracked paste of this page and is out of scope in `../spec.md`; and an app-wide 404 page —
this one is scoped to the `movies/[id]` route segment on purpose, so `/users`'s `notFound()` keeps
its current behaviour.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/app/(dashboard)/movies/[id]/not-found.tsx` | New | The unavailable page — `Recurso no disponible para este usuario` |
| `services/web/src/app/(dashboard)/movies/[id]/page.tsx` | Modified | Route-param guard; `generateMetadata` stops emitting film-derived text on the unavailable path |

`services/web/src/actions/movies.ts` is **not** on this list and should not need to change. If it
does, the contract was misread — stop and report.

## Existing code to reuse

- **`services/web/src/app/(dashboard)/movies/[id]/page.tsx:11`** — `const getMovie =
  cache(getMovieById)`. Already collapses the page render and `generateMetadata` into one fetch.
  Keep it; both entry points must apply the new guard and both must go through this same wrapper, or
  the tab title and the body can disagree.
- **`services/web/src/actions/movies.ts:61`** — `getMovieById`. Already correct: it returns `null`
  for `data.movie === null` and calls `redirectToClearSession` (not `redirectIfUnauthenticated`) for
  auth errors, because a Server Component render may not mutate cookies. Do not touch either
  behaviour — see `services/web/CLAUDE.md` § Session invalidation from a Server Component render.
- **`services/web/src/components/common/PageBreadCrumb.tsx`** — used by the detail page; reuse it on
  the unavailable page only if it needs no film-derived title. A hardcoded generic label is fine; a
  breadcrumb naming the requested film is a REQ-5 leak.
- **Tailwind card shell** — the detail page's wrapper (`rounded-2xl border border-gray-200 bg-white
  p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6`) is the surface style used across dashboard
  pages. Reuse those classes rather than inventing a panel style.
- **`src/components/ui/button/Button.tsx`** — if the page offers a way back to `/movies`, use the
  shared `Button` (or a plain `next/link`), never a hand-rolled `<button>` with a `bg-primary`
  class. That token does not exist in this service's Tailwind `@theme`; only `--color-brand-*` does,
  and a `bg-primary` compiles silently to nothing.

## Steps

1. **Create `movies/[id]/not-found.tsx`.** A server component, no props (Next passes none). It must
   render the exact string `Recurso no disponible para este usuario` and nothing derived from the
   requested film. Next serves it with **HTTP 404** automatically when `notFound()` is called in the
   segment — do not set a status manually. Keep it in the dashboard layout's visual language using
   the card shell above.

2. **Guard the route param in `page.tsx`.** `Number(id)` on `/movies/abc` yields `NaN`, which is
   currently sent as an `Int!` and comes back as a GraphQL error that is *not* an auth error — so
   `redirectToClearSession` ignores it and `getMovieById` throws, producing a 500 instead of the
   unavailable page (REQ-6). Parse once and check it is a positive integer before fetching; call
   `notFound()` when it is not. The guard must run in **both** `generateMetadata` and the page
   component, before `getMovie` is awaited.

3. **Stop `generateMetadata` from leaking (REQ-5).** It currently returns
   `` `${movie.title} | Perceptor` `` or the English `"Movie Not Found"`, with
   `movie?.overview || "Movie details page"` as the description. On the unavailable path both must
   be generic and Spanish, identical for "does not exist" and "not yours" — the tab title is the
   easiest place for this feature to leak a film's name while the body looks correct (AC-6). The
   owner path keeps the title it has today.

4. **Leave the owner path alone.** For a film the caller owns, the page renders exactly as it does
   now — `PageBreadcrumb`, `Movie`, `SearchTorrent` (AC-1). This slice adds a branch; it does not
   restyle the working page.

## Contract obligations

`web` consumes, unchanged, from `../spec.md` § GraphQL Contract Delta:

```graphql
query GetMovie($id: Int!) {
  movie(id: $id) { id tmdbId title overview posterUrl releaseDate originalLanguage isLiveAction status }
}
```

There is **no codegen**: that shape is a hand-copy of `api`'s schema and nothing checks it. Every
condition this consumer must handle:

| What comes back | What `web` must do |
| :-- | :-- | 
| `data.movie` is the film | Render the detail page as today (AC-1). |
| `data.movie` is `null` because no such id exists | Unavailable page, 404 (AC-5). |
| `data.movie` is `null` because the film belongs to another user | **The same** unavailable page, same 404, same tab title. `web` cannot tell these two apart and must not try — no distinct copy, no "esta película es de otro usuario" (AC-2, AC-3). |
| `errors[0].message` is `No autenticado` or `Tu sesión expiró, iniciá sesión de nuevo` | Existing behaviour: `redirectToClearSession`. Unchanged. |
| Any other `errors` entry | Existing behaviour: `getMovieById` throws. Unchanged. |
| Route param is not a positive integer | Unavailable page, 404, **without** calling the API. |

The delta is read-only. If it is wrong, stop and report — do not adapt it locally.

## Tests

**None, and this is not an omission.** This service has no test file, no test runner and no `test`
script; adding Vitest or Playwright as a side effect of a feature task is explicitly forbidden by
`services/web/CLAUDE.md` and deserves its own spec.

The silent-failure risk in this slice — the page hiding the film while the tab title still shows its
name — is covered by AC-6 in the manual pass instead. The gate here is the typecheck, Biome on the
changed files, and actually opening the page as both users.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
```

Expected: **exactly 12** errors, all in the five pre-existing pre-GraphQL files listed in
`services/web/CLAUDE.md` (`importFolderModal.tsx`, `ImportMagnetSeasonModal.tsx`,
`SearchTorrentModal.tsx`, `SearchForm.tsx`, `ResultsForm.tsx`). Report the count before and after.
Neither `movies/[id]/page.tsx` nor the new `not-found.tsx` may appear.

```bash
bin/npm web run lint
```

Not a repo-wide gate — `biome check` reports ~1598 pre-existing errors with or without this change.
Judge the two files this slice touches individually; both should come back clean.

Manual, with two users: as the owner, `/movies/<id>` renders in full; as the other user, the same
URL shows `Recurso no disponible para este usuario` with a 404 and no film data anywhere in the
response — including the tab title. `/movies/abc` and `/movies/999999999` reach the same page with
no 500 in the `api` logs.

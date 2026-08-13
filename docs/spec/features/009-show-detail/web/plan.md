---
title: Show Detail Screen — web slice
service: web
last_updated: 2026-08-13
status: Implemented
---

# PLAN: Show Detail Screen — `web` (`web/plan.md`)

## Scope

`web` builds the real `/shows/[id]` route: a `getShowById` server action, a rewritten page (mirroring
`movies/[id]/page.tsx`) with its own segment `not-found.tsx`, a rewritten `Show` component (metadata,
no acquisition buttons) and a rewritten `SeasonAccordion` component (one collapsible section per
season, episodes with three inert buttons). It also fixes the series-card link (REQ-7) in
`MediaCard`/`MediaList`. `web` does **not** wire any modal to a real action, does not add
`src/actions/jobs.ts`, and does not touch anything under `services/api`. The three per-episode
buttons render and do nothing — the code that would open a modal is written but commented out, not
left unwritten and not deleted from a working draft (there is no working draft to keep; see below).

The two uncommitted files already at `src/components/shows/Show.tsx` and
`src/components/shows/SeasonAccordion.tsx`, and the broken `src/app/(dashboard)/shows/[id]/page.tsx`,
are **discarded, not patched** — `Show.tsx` is a literal copy of `Movie.tsx` with the wrong prop
type, and `SeasonAccordion.tsx` imports `@prisma/client` types (`Prisma.SeasonGetPayload`) against a
GraphQL query that never existed, a direct Constitution Article II violation. All three are rewritten
from the ground up against `getShowById`'s real return shape.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/actions/shows.ts` | Modified | adds `Season`/`Episode` interfaces, extends `Show`, adds `getShowById(id)` |
| `services/web/src/app/(dashboard)/shows/[id]/page.tsx` | Modified (currently broken) | full rewrite, mirroring `movies/[id]/page.tsx` |
| `services/web/src/app/(dashboard)/shows/[id]/not-found.tsx` | New | mirrors `movies/[id]/not-found.tsx`, link back to `/shows` |
| `services/web/src/components/shows/Show.tsx` | Modified (currently an uncommitted copy of `Movie.tsx`) | full rewrite: metadata only, no `ImportFileModal`/`ImportMagnetModal` |
| `services/web/src/components/shows/SeasonAccordion.tsx` | Modified (currently uncommitted, `@prisma/client`-typed) | full rewrite: typed against `Season`/`Episode` from `@/actions/shows`, hand-rolled accordion, inert per-episode buttons |
| `services/web/src/components/media/MediaCard.tsx` | Modified | accepts `mediaType` prop, hrefs off it instead of `item.type` |
| `services/web/src/components/media/MediaList.tsx` | Modified | forwards its existing `mediaType` prop into `MediaCard` |

## Existing code to reuse

- `src/app/(dashboard)/movies/[id]/page.tsx` — the page shape to copy exactly: `parseId` guard
  (rename `parseMovieId` → e.g. `parseShowId`, same body), `cache()`-wrapped fetch, fixed
  `UNAVAILABLE_METADATA`, `notFound()` on both the invalid-param and null-show paths, both in
  `generateMetadata` and the page component.
- `src/app/(dashboard)/movies/[id]/not-found.tsx` — copy verbatim, changing only the link target
  (`/movies` → `/shows`) and the button label (`Volver a películas` → `Volver a series`).
- `src/actions/movies.ts`'s `getMovieById` — the action shape to copy: `'use server'`, a module-level
  `GET_SHOW_QUERY` in SCREAMING_SNAKE, `fetchGraphQL<{ show: Show | null }>`, `redirectToClearSession`
  on `errors`, `data?.show ?? null` on success. `src/actions/shows.ts` already has this file's
  `'use server'` header and its own `Show` interface (currently metadata-only, matching the `shows`
  listing query) — extend it rather than creating a second file.
- `src/components/movies/Movie.tsx` — the layout to adapt for `Show`: poster left, metadata block
  right (title, year/language/status line, "Sinopsis" block). Drop the `File`/`Magnet` buttons and
  their two `useModal()` instances and the two modal renders at the bottom entirely — `Show` has no
  acquisition action at its own level (REQ-1).
- `src/hooks/useModal.ts` — reuse for each episode's (currently inert) button state if the rewritten
  `SeasonAccordion` needs local open/close state for anything other than the accordion toggle itself;
  otherwise a plain `useState<number | null>` for "which season is open" is enough and matches the
  discarded draft's own mechanic.
- `src/components/ui/button/Button.tsx` — reuse for the season-header toggle and the three per-episode
  buttons, per `services/web/CLAUDE.md`'s "small conventions" section (raw `<button>` only for
  controlled inputs, not general buttons — `Movie.tsx`'s `File`/`Magnet` buttons are the pattern).
- `src/types/media.ts`'s `MEDIA_TYPE` — reuse for the `MediaCard`/`MediaList` fix; no new type needed.

## Steps

1. In `src/actions/shows.ts`, add:
   ```ts
   export interface Episode {
     id: string;
     episodeNumber: number;
     title?: string;
     overview?: string;
     releaseDate?: string;
     status: string;
   }

   export interface Season {
     id: string;
     seasonNumber: number;
     releaseDate?: string;
     episodes: Episode[];
   }
   ```
   Extend the existing `Show` interface with `seasons: Season[]` (only present when fetched via
   `getShowById` — the `shows` listing query still doesn't request it, so callers of `getShows()`
   see `undefined`; do not make `getShows()` request `seasons` just for type convenience).
2. Add `GET_SHOW_QUERY` and `getShowById(id: number): Promise<Show | null>`, copying
   `getMovieById`'s structure exactly (see "Existing code to reuse" above), requesting every `Show`
   scalar field plus:
   ```graphql
   seasons {
     id
     seasonNumber
     releaseDate
     episodes {
       id
       episodeNumber
       title
       overview
       releaseDate
       status
     }
   }
   ```
3. Rewrite `src/app/(dashboard)/shows/[id]/page.tsx`: `parseShowId`, `cache(getShowById)`,
   `UNAVAILABLE_METADATA`, `generateMetadata` and the page component both guard-then-fetch-then-
   `notFound()`. Page body:
   ```tsx
   <div>
     <PageBreadcrumb pageTitle={show.title} />
     <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] lg:p-6">
       <div className="space-y-6">
         <Show show={show} />
       </div>
     </div>
     <div className="mt-6 space-y-4">
       {show.seasons.map((season) => (
         <SeasonAccordion
           key={season.id}
           season={season}
           defaultOpen={season.seasonNumber === lastSeasonNumber}
         />
       ))}
     </div>
   </div>
   ```
   where `lastSeasonNumber = Math.max(...show.seasons.map(s => s.seasonNumber))`, computed once
   before the render (REQ-4) — do not recompute per-season inside the `.map`.
4. Create `src/app/(dashboard)/shows/[id]/not-found.tsx`, copying
   `movies/[id]/not-found.tsx` with the link/label changes noted above.
5. Rewrite `src/components/shows/Show.tsx`: `"use client"` only if it needs no interactivity — check
   whether anything in the component actually needs client state; if it's pure display (poster +
   metadata + overview, no buttons), it can drop `"use client"` entirely, unlike `Movie.tsx`. Props
   `{ show: Show }` typed from `@/actions/shows`. Same poster/metadata/overview layout as `Movie.tsx`,
   no `File`/`Magnet` buttons, no modal imports.
6. Rewrite `src/components/shows/SeasonAccordion.tsx`: `"use client"` (needs open/close state).
   Props `{ season: Season, defaultOpen: boolean }`, typed from `@/actions/shows` — no
   `@prisma/client` import anywhere in this file. `useState(defaultOpen)` for the open/close flag, a
   `Button`-based header (season number, chevron icon that rotates), and when open, one row per
   episode showing episode number, title, overview, release date, status, and three `Button`s
   (buscar / importar archivo / añadir torrent — icons from `lucide-react`, matching `Movie.tsx`'s
   icon usage). Each button's `onClick` is present in the JSX but commented out — e.g.:
   ```tsx
   <Button size="sm" variant="outline" /* onClick={() => openSearchModal(episode)} */>
     <Search size={16} />
     Buscar
   </Button>
   ```
   No `useModal()` call, no modal import, no modal render at the bottom of this file — there is
   nothing to open yet (REQ-5). Do not import `SearchTorrentModal`, `ImportFileModal`,
   `ImportMagnetModal`, `ImportMagnetSeasonModal` or `ImportFolderModal`.
7. In `src/components/media/MediaCard.tsx`, add a `mediaType?: typeof MEDIA_TYPE[keyof typeof
   MEDIA_TYPE]` prop to `MediaCardProps` and change the `href` ternary from
   `item.type === MEDIA_TYPE.SHOW` to `mediaType === MEDIA_TYPE.SHOW`.
8. In `src/components/media/MediaList.tsx`, pass its existing `mediaType` prop through to
   `<MediaCard mediaType={mediaType} ... />`.

## Post-ship correction (2026-08-13)

Two display-only corrections landed after the initial review, both amending `../spec.md` (REQ-2,
REQ-3, NFR-2, AC-2 — see that file's "Display-order correction" section):

- **Step 3 (page.tsx)**: map over `[...show.seasons].reverse()`, not `show.seasons` directly —
  `lastSeasonNumber`/`defaultOpen` logic is unchanged (REQ-4 still picks the highest `seasonNumber`,
  which is now also the first section rendered). The reversal is display-only; `show.seasons` itself
  is never mutated or reassigned.
- **Step 6 (SeasonAccordion.tsx)**: two changes —
  1. Map over `[...season.episodes].reverse()`, not `season.episodes` directly, same reasoning.
  2. Replaced the per-episode card layout with a `<table>`: columns `# | Título (overview as a
     second line inside the same cell) | Fecha de estreno | Estado | Acciones`, the three inert
     buttons collapsed into icon-only buttons (with a `title` tooltip) in the Acciones cell instead
     of full-width text buttons. Still typed against `Episode`/`Season` from `@/actions/shows`, still
     no `@prisma/client`, still no `useModal()`/modal import, still `onClick` commented out (REQ-5
     unaffected).

Neither change touches `getShowById`, `api`, or any prop/type signature — pure JSX inside two
already-approved files.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta — this is what `web` consumes:

- `show(id: Int!): Show`, nullable. `getShowById` must treat `data.show === null` exactly like
  `getMovieById` treats `data.movie === null`: return `null` up to the page, which calls `notFound()`.
  **Do not** attempt to distinguish "id doesn't exist" from "not yours" — the API guarantees they are
  the same value on purpose (NFR-1).
- On a GraphQL `errors` response, `getShowById` must call `redirectToClearSession(errors)` — this
  runs inside a Server Component render (the page and its `generateMetadata`), where cookie mutation
  is illegal, exactly the constraint `getMovieById` and `getShows` are already under (see
  `services/web/CLAUDE.md` § "Session invalidation from a Server Component render"). Do not use
  `redirectIfUnauthenticated` here.
- `seasons`/`episodes` arrive pre-ordered (`seasonNumber`/`episodeNumber` ascending) — `web` must not
  re-sort them; doing so would silently mask an ordering regression on the `api` side instead of
  surfacing it (NFR-2 is `api`'s obligation, not something `web` should compensate for).
- A `SERVICE_TOKEN`-authenticated call would get `No autenticado` — not reachable from any `web` code
  path, since `web` always authenticates as a user; noted here only so nobody adds a service-token
  code path against this query later without re-reading this section.

This delta is read-only. If a field is missing or shaped differently once `api` ships it, stop and
report rather than adapting `getShowById` to paper over the mismatch.

## Tests

`services/web` has no test runner (`services/web/CLAUDE.md` § "Tests: there are none") — this slice
adds none, matching every prior `web` feature. The quality gate is the typecheck plus opening the
page in a browser to verify AC-1 through AC-4 and AC-7 directly.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
```

Expected: exactly 12 errors, the same 5 pre-existing files
(`importFolderModal.tsx`, `ImportMagnetSeasonModal.tsx`, `SearchTorrentModal.tsx`, `SearchForm.tsx`,
`ResultsForm.tsx`) and nothing else. None of the seven files this slice touches may appear in that
count.

```bash
bin/npm web run lint
```

Not a repo-wide gate (~1598 pre-existing Biome errors, per `services/web/CLAUDE.md`) — run it and
confirm the new/changed files in this slice individually come back clean, the same way
`008-movie-detail` judged its own new files.

Then open `/shows/<id>` for an owned series with 2+ seasons in a browser and confirm AC-1 through
AC-4 directly (metadata renders without acquisition buttons, correct season starts expanded, toggle
works, episode buttons are inert with zero network requests in dev tools), plus AC-7 from `/shows`.

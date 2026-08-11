---
title: Movie Search and Per-User Libraries — web slice
service: web
last_updated: 2026-08-11
status: Implemented
---

# PLAN: Movie Search and Per-User Libraries — `web` (`web/plan.md`)

## Scope

This slice owns everything the user sees on the search screen: making the submit button visible
(REQ-9), replacing the automatic redirect with an explicit `Ir` (REQ-7), and rendering `Ir` from the
first paint for films the user already has (REQ-8). It also selects the two new fields in the
`searchMovies` document, since there is no codegen and a field nobody asks for simply never arrives.

It does **not** decide who owns what. `inLibrary` and `movieId` are computed by `api` and consumed
here as given; `web` must never infer ownership from the movie list, from local state persisted
across searches, or from anything other than those two fields — that is how the two services drift
apart. It also does not change `/movies` (`Movies.tsx`) or the film detail page: `movies` narrows to
the caller's library inside `api` with an unchanged signature, so both keep working untouched. If a
change here seems to need a new GraphQL field, stop and report — the contract is frozen.

Writes are confined to `services/web/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/search/SearchInput.tsx` | Modified | Submit button rendered with the shared `Button`; drop the dead `primary` classes |
| `services/web/src/components/search/SearchContainer.tsx` | Modified | No `router.push` on add; per-card `Agregar` → `Ir` |
| `services/web/src/actions/movies.ts` | Modified | `movieId`, `inLibrary` added to `SEARCH_MOVIES_QUERY` |
| `services/web/src/types/search.ts` | Modified | The same two fields on `MediaSearchResult` |

No new component. If this slice grows one, the plan missed something — report it.

## Existing code to reuse

- `src/components/ui/button/Button.tsx` — the shared button every other screen uses. It already
  takes `type="submit"`, `disabled`, `startIcon` and `className`. This is the fix for REQ-9:
  `SearchInput.tsx`'s hand-rolled `<button className="… bg-primary …">` is the only place in the
  service that references a `primary` colour, and `web`'s Tailwind 4 `@theme`
  (`src/app/globals.css`) defines only `--color-brand-*`. The class compiles to nothing, so the
  button is transparent with white text. **Use the shared component; do not add a `--color-primary`
  token** — inventing a second colour scale to rescue one orphan class is exactly the kind of
  second-way-to-do-things this plan exists to prevent. The input's `focus:border-primary` is dead
  for the same reason and goes with it.
- `src/components/media/MediaCard.tsx` — already renders whatever `renderAction(item)` returns,
  under the poster. Both `Agregar` and `Ir` go through that existing slot; the card itself does not
  change.
- `next/link` — the `Ir` affordance is a link to `/movies/<movieId>`, not a `router.push` in an
  onClick. `MediaCard` already builds that href for `showLink`; follow the same shape.
- `src/actions/movies.ts` — the established server-action pattern (module-level SCREAMING_SNAKE
  document, `fetchGraphQL<T>`, `redirectIfUnauthenticated(errors)` then throw with a Spanish
  fallback). These are Server Actions called from a client component, so `redirectIfUnauthenticated`
  is correct here — **not** `redirectToClearSession`, which is for read functions a Server Component
  awaits during render. The two are not interchangeable.

## Steps

1. **REQ-9, independent of everything else.** Rewrite `SearchInput.tsx`'s submit as the shared
   `Button` with `type="submit"` and `disabled={loading}`, keeping the `Buscar` / `Buscando...`
   copy. Replace the input's `focus:border-primary` with the brand token the rest of the service
   uses. This step depends on no API change and can be done first.
2. **Select the new fields.** Add `movieId` and `inLibrary` to `SEARCH_MOVIES_QUERY` in
   `src/actions/movies.ts`, and to the `MediaSearchResult` type in `src/types/search.ts`
   (`movieId: number | null`, `inLibrary: boolean`). The hand-written type and the document must be
   changed together — there is no codegen, and a field left out of the document arrives `undefined`
   with no type error.
3. **Stop the redirect.** Remove `router.push(...)` from `handleAdd` in `SearchContainer.tsx`, and
   with it the now-unused `useRouter`. On success, record that this result is now in the library —
   keyed by the result's TMDB id, holding the `Movie` id that `addMovie` returns — and clear the
   pending state. `addingId` is currently never cleared on success because the page was navigating
   away; it must be cleared now, or the card stays disabled forever.
4. **Render the right affordance.** In `renderAction`, a result is "in the library" when
   `item.inLibrary` is true **or** it was added during this session (step 3). In that case render an
   `Ir` link to `/movies/<id>`, using `item.movieId` for the former and the id returned by
   `addMovie` for the latter. Otherwise render the add button — with the label `Agregar`, in
   Spanish; it currently reads `Add`, which is the only English string on this screen.
5. **Errors.** Keep the existing inline error paragraph. An add failure must clear that card's
   pending state and leave the rest of the results on screen — the user must be able to try the next
   result without searching again.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, which is read-only here:

```graphql
type MediaSearchResult {
  movieId: Int          # Movie.id if any user has registered this film; null otherwise
  inLibrary: Boolean!   # true only for the calling user
}
```

Both are needed and they are not the same question. `inLibrary` decides `Agregar` vs `Ir`.
`movieId` is the href for `Ir`, and it is non-null for films registered by **other** users too — so
`movieId !== null` must never be used as the test for "I have this". A film that exists in the
system but belongs to someone else shows `Agregar` (REQ-8), and adding it links the caller to the
existing row without downloading anything again.

`movies` and `addMovie` keep identical signatures and change meaning — `movies` now returns only the
caller's films. Nothing in `web` changes for that, and nothing in `web` should compensate for it: no
client-side filtering, no ownership inference. If `/movies` ever shows another user's films, the bug
is in `api`, and patching it here would hide it.

Errors this slice must handle — a consumer that implements only the happy path compiles cleanly and
is wrong (`docs/spec/graphql-contract.md`):

| Message from `api` | Where it can appear | What `web` does |
| :-- | :-- | :-- |
| `No encontramos la película en el catálogo` | `addMovie` | Inline error above the results; that card returns to its add state, the rest of the list is untouched |
| `La película <id> no existe` | `addMagnetToMovie` / `addTorrentToMovie` on the detail page | Existing inline error paths in the import modals — unchanged by this slice |
| `No autenticado` | any | Already routed to `/login` by `redirectIfUnauthenticated` — no new handling |

## Tests

**None, and the reason is not "it is only UI".** This service has no test file, no runner and no
`test` script; `services/web/CLAUDE.md` is explicit that introducing Vitest or Playwright is its own
decision and must not arrive as a side effect of a feature task. Do not add one here.

The two failures this slice could produce are also not silent, which is what Article IX actually
asks. An invisible button and a wrong `Agregar`/`Ir` label are both visible on the screen in one
look, and both are covered by AC-1, AC-2, AC-4 and AC-5. The genuinely silent failure in this
feature — one user's library leaking into another's — lives in `api` and is tested there.

The quality gate here is the typecheck, Biome, and opening the page.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
```

The typecheck reports **12 errors or fewer** across the same five pre-existing files listed in
`services/web/CLAUDE.md` — none of them in a file this slice touched. Report the count before and
after; the number is the proof that this slice added nothing.

Then, with `bin/dev` running, `/movies/add`: the submit button is visible in light and dark themes
(AC-1); registering a film leaves the URL on `/movies/add` with the results still rendered and that
card reading `Ir` (AC-2); `Ir` navigates to `/movies/<id>` (AC-3); repeating the search shows `Ir`
on first render (AC-4).

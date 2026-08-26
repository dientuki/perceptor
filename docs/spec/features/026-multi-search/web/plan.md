---
title: Multi Search — web slice
service: web
last_updated: 2026-08-26
status: Implemented
---

# PLAN: Multi Search — `web` (`web/plan.md`)

## Scope

This slice turns the header's inert search box into the entry point of a mixed search, adds the
`/search` results screen it lands on, puts a type badge on the result cards there, and makes an
already-owned series offer `Ir` to `/shows/<id>` — on the new screen **and** on the existing
`/shows/add`, which is where that change is actually verified.

It is **not** doing: any filtering, ranking or de-duplication of results (the api returns the
catalog's order and only films and series — `web` renders what it is given, in the order it is
given); any change to how a title is registered (the existing `addMedia` action is reused verbatim);
any change to `/movies`, `/shows`, `/movies/[id]`, `/shows/[id]`; and any removal of `/movies/add` or
`/shows/add`, which stay exactly as they are apart from the shared action extraction.

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report
(`.claude/agents/web.md`). Read `services/web/AGENTS.md` first: this is Next 16, and
`node_modules/next/dist/docs/` is the authority on its App Router APIs, not training data.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/actions/media.ts` | Modified | Add the `searchAllMedia(query)` server action beside the existing two |
| `services/web/src/layout/AppHeader.tsx` | Modified | The search form navigates to `/search` with the query instead of `preventDefault`-ing into nothing |
| `services/web/src/app/(dashboard)/search/page.tsx` | New | Server Component: reads the query from the URL, fetches, renders |
| `services/web/src/components/search/MultiSearchResults.tsx` | New | Client component: the grid plus per-card add state and inline error |
| `services/web/src/components/search/MediaResultAction.tsx` | New | The per-card action (`Agregar` / `Agregando...` / `Ir`), extracted from `SearchContainer` and shared by both screens |
| `services/web/src/components/search/SearchContainer.tsx` | Modified | `renderAction` delegates to the extracted component; the owned-series branch stops being a dead badge |
| `services/web/src/components/media/MediaList.tsx` | Modified | Threads an opt-in "show the type badge" flag down to the card |
| `services/web/src/components/media/MediaCard.tsx` | Modified | Renders the badge over the poster when asked, from `item.type` |
| `services/web/messages/en.json` | Modified | New keys; `search.container.added` removed |
| `services/web/messages/es.json` | Modified | The same keys, Rioplatense register |

## Existing code to reuse

- `services/web/src/actions/media.ts` — the file, the pattern and `addMedia` itself. The new action
  is a third export in the same shape: `'use server'`, a module-level `SEARCH_ALL_MEDIA_QUERY`
  const, `fetchGraphQL<T>`, `redirectIfUnauthenticated` then `translateGraphQLError` on errors.
  Select **exactly** the fields `SEARCH_MEDIA_QUERY` selects — there is no codegen, and a field
  invented here arrives `undefined` with no error (`services/web/CLAUDE.md`).
- `services/web/src/components/search/SearchContainer.tsx` — the source of the extraction, and the
  behaviour to preserve: `addingId` disables the button in flight, a successful add updates local
  `addedMediaIds` and **never** navigates, `owned` is `inLibrary || addedThisSession` and **never**
  `mediaId !== null`.
- `services/web/src/components/media/MediaList.tsx` / `MediaCard.tsx` — the grid and the card. Reuse
  both; do not fork either, and do not pass a custom `emptyMessage` on the listing screens.
- `services/web/src/components/ui/button/Button.tsx` — the add button. Not a hand-rolled element,
  and no `bg-primary` (that token does not exist in this service's Tailwind theme).
- `services/web/src/types/search.ts` — `MediaSearchResult`, already carrying `type`, `mediaId` and
  `inLibrary`. No new type is needed; a mixed list is `MediaSearchResult[]`.
- `services/web/src/types/media.ts` — `MEDIA_TYPE`. Compare `item.type` against it, never against a
  `"movie"` literal.
- `services/web/src/lib/graphql-error.ts` — `translateGraphQLError`. Every error the user reads goes
  through it; nothing renders a raw API string.
- `services/web/src/app/(dashboard)/movies/add/page.tsx` — the page skeleton to copy for `/search`:
  `generateMetadata` from `getTranslations`, `PageBreadcrumb`, the same card wrapper classes.

## Steps

1. **`actions/media.ts`** — add `searchAllMedia(query: string): Promise<MediaSearchResult[]>`.
   Short-circuit `!query.trim()` to `[]` before the round trip, as `searchMedia` already does. Same
   field selection, same error handling.

2. **`components/search/MediaResultAction.tsx`** — extract the current `renderAction` body into a
   client component taking the item, the owned state, the in-flight state and an `onAdd` callback.
   The owned branch is now **one shape for both types**: a link to `/movies/<id>` for a film and
   `/shows/<id>` for a series, with the same styling the film link has today and the `go` label. The
   non-owned branch is the existing `Button`. `errorAdd`'s noun follows **the item's own type**, not
   a screen-level type — this is what makes one page able to add a film and a series.

3. **`components/search/SearchContainer.tsx`** — render the extracted component from `renderAction`.
   The `MEDIA_TYPE.SHOW` branch that renders the non-interactive `Agregada` badge is deleted, not
   kept as a fallback. Everything else about this file — the form, the search state, the noun for the
   placeholder and empty state — stays exactly as it is, because `/movies/add` and `/shows/add` must
   not change behaviour beyond this (AC-15).

4. **`components/media/MediaCard.tsx`** — add the badge, rendered only when the caller asks for it,
   absolutely positioned over the poster (top-left, as in the design), above the image in stacking
   order and legible on any poster: an opaque pill, `text-white`, uppercase, small. Colour follows
   the type — `bg-brand-500` for a film, `bg-purple-500` for a series. **Do not introduce a new
   Tailwind theme token for this**; `--color-brand-*` is what `@theme` defines and the default
   palette covers the rest. Text comes from the message catalog (NFR-6), never a literal. The badge
   reads `item.type`, not the `mediaType` prop — on a mixed grid the prop is one value for cards of
   two kinds.

5. **`components/media/MediaList.tsx`** — thread the opt-in flag through to `MediaCard`. Default it
   off, so `/movies`, `/shows`, `/movies/add` and `/shows/add` are untouched.

6. **`components/search/MultiSearchResults.tsx`** — a client component taking the fetched results
   and an optional error string from the page. It owns `addingId` and `addedMediaIds` exactly as
   `SearchContainer` does, calls `addMedia(item.id, item.type)` — the item's type, per card — and
   renders `MediaList` with `showLink={false}`, the badge flag on, and `MediaResultAction` as its
   `renderAction`. The empty state distinguishes "nothing searched yet" from "searched, no results",
   reusing `search.container.resultsEmptyPrompt` / `resultsEmptySearched`. Errors render inline;
   never `alert()`.

7. **`app/(dashboard)/search/page.tsx`** — a Server Component. Read the query from `searchParams`
   (in Next 16 it is a `Promise` — `await` it; check `node_modules/next/dist/docs/` rather than
   assuming). `await searchAllMedia(q)` inside a `try`/`catch`: on failure log with `console.error`
   and pass the translated message down as the error prop with an empty result list, so a dead
   catalog renders an inline error and a usable page rather than Next's error screen (AC-11) — there
   is no `app/(dashboard)/error.tsx` in this service. `generateMetadata` follows the `/movies/add`
   pattern. Because this is a read function running during a render pass, an auth failure must use
   `redirectToClearSession`, not `redirectIfUnauthenticated` — the action already handles that;
   do not add cookie mutation in the page (`services/web/CLAUDE.md` § auth).

8. **`layout/AppHeader.tsx`** — give the input a `name`, drop the `preventDefault`-only handler for
   one that reads the query and pushes `/search?q=<encoded>` via `useRouter()` from
   `next/navigation`. Navigate even when the box is empty: the action short-circuits and the page
   renders its empty state, which is one rule instead of a special case (AC-12). Leave the ⌘K focus
   handler, the placeholder key and the three-element header layout alone (`025-header-redesign`).

9. **`messages/en.json` + `messages/es.json`** — add the badge labels (`MOVIE`/`SERIES`,
   `PELÍCULA`/`SERIE`) under the card namespace and the `/search` page's title and metadata under
   `pages`. **Remove `search.container.added`** from both — step 3 deletes its last reference, and
   leaving it is exactly the kind of dead catalog entry that outlives the code it belonged to. Keep
   the two files in the same order and shape; `scripts/check-messages.mjs` fails on drift.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, read-only:

```graphql
searchAllMedia(query: String!): [MediaSearchResult!]!
```

The element is the `MediaSearchResult` this service already types in `src/types/search.ts` — no new
field to add, and in particular **no badge or label field on the wire**: the badge is derived here
from `type`. Every element's `type` is `"movie"` or `"show"`; nothing else can arrive, and no card
needs a fallback rendering for a third value.

Every error condition and what this slice does with it:

| Condition | What arrives | What `web` does |
| :-- | :-- | :-- |
| Blank / whitespace query | `[]`, no error | The "search for something" empty state — not an error |
| Catalog matched nothing, or every row was filtered out | `[]`, no error | `resultsEmptySearched` |
| `movie_db_api_key` unset, or TMDB unreachable | a generic GraphQL error with **no** `extensions.i18n` | `translateGraphQLError` falls back to the English message; render it inline, keep the page usable |
| Session expired / unauthenticated | keyed auth error | The action's `redirectIfUnauthenticated` / the page's read path — do not hand-roll a check on `errors[0].message` |
| Add fails (`addMedia`) | the existing keyed errors, unchanged by this feature | Re-enable that card's button, render the message inline, noun taken from **that card's** type |

The delta is read-only. If it is wrong, stop and report — do not adapt it locally.

## Tests

**None, and the reason is structural, not an omission:** this service has no test file, no runner
and no `test` script, and introducing one is its own decision with its own spec
(`services/web/CLAUDE.md` § Tests). Do not add Vitest or Playwright as a side effect of this feature.

The quality gate is therefore the typecheck, Biome on the touched files only (never repo-wide — it
reports ~1598 pre-existing errors), the catalog parity script, and actually opening the pages. The
one thing that could fail silently here — a card claiming ownership it does not have — is defended
on the `api` side, in `media-search.service.spec.ts`; this slice's job is not to re-derive
`inLibrary` locally. In particular: never treat `mediaId !== null` as owned.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/npm web run build
```

Typecheck stays at 0 errors, the catalog parity check exits 0, and the build exits 0. Then, with the
stack up: `/search?q=spider-man` shows films and series with badges in both locales, adding one of
each works without navigating, an owned series shows `Ir` on `/search` **and** on `/shows/add`, and
`/movies/add` behaves exactly as it did before.

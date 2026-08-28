---
title: Billboard and Navigation — web slice
service: web
last_updated: 2026-08-28
status: Implemented
---

# PLAN: Billboard and Navigation — `web` (`web/plan.md`)

## Scope

Everything a user sees in this feature. Two halves, and they are independent:

- **Navigation** — the sidebar's seven entries, the billboard at `/`, the landing moved to
  `/perceptor`, `proxy.ts`'s public/auth route lists, the two login destinations, the empty
  `/calendar` and `/downloads` routes, and both message catalogs. Depends on nothing new from `api`
  and can start immediately.
- **Billboard** — the carousel component, the `MediaCard` flag that hides the metadata block, the
  `getPopularMedia` action, and the `/` page that renders the two strips. Needs `popularMedia` live.

Not this slice: the query itself, the Redis cache, the TMDB call and the locale that is sent to
TMDB — all `api`. In particular, **do not add a `language` argument** to the query when the carousel
comes back in the wrong language; `api` resolves it from the caller and the contract has no such
argument (`../plan.md` § Contract Freeze).

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/layout/AppSidebar.tsx` | Modified | The seven entries, their labels, paths and icons; the logo's `href`. |
| `src/app/(dashboard)/page.tsx` | New | The billboard. Fetches both lists, renders two carousels. |
| `src/app/(dashboard)/dashboard/page.tsx` | Deleted | Replaced by the route above. |
| `src/app/page.tsx` | Deleted | Moves verbatim to `src/app/perceptor/page.tsx`. |
| `src/app/perceptor/page.tsx` | New | The landing, unchanged in content. |
| `src/app/(dashboard)/calendar/page.tsx` | New | Empty route. |
| `src/app/(dashboard)/downloads/page.tsx` | New | Empty route. |
| `src/proxy.ts` | Modified | `PUBLIC_ROUTES`: `/perceptor` replaces `/`; the signed-in bounce off `/login` targets `/`. |
| `src/actions/auth.ts` | Modified | The post-login default destination becomes `/`. |
| `src/components/auth/LoginForm.tsx` | Modified | Its `redirect` fallback becomes `/`. |
| `src/components/media/MediaCarousel.tsx` | New | The scrolling strip and its two arrow controls. |
| `src/components/media/MediaCard.tsx` | Modified | New opt-in `showMeta` flag. |
| `src/components/billboard/PopularCarousel.tsx` | New | Client component: one strip's add state, cards and per-strip error. |
| `src/actions/media.ts` | Modified | `getPopularMedia(type)`. |
| `messages/en.json`, `messages/es.json` | Modified | `nav.*` relabelled, `pages.billboard`, `errors.media.*`; `pages.dashboard` removed. |

## Existing code to reuse

- `src/components/search/MediaResultAction.tsx` — **the** add/go control. Use it unchanged; a
  carousel card must not grow its own button.
- `src/components/search/MultiSearchResults.tsx` — the client-side add pattern to copy for a strip:
  local `addingId` and `addedMediaIds`, `addMedia(item.id, item.type)` per card, `owned` computed as
  `item.inLibrary || addedMediaIds[item.id] !== undefined`, and **never** `mediaId !== null` alone.
- `src/app/(dashboard)/search/page.tsx` — the server-page shape: awaits its data in `try`/`catch`,
  calls `unstable_rethrow(err)` first in the catch, and passes a translated error down as a prop
  rather than throwing. There is no `error.tsx` under `(dashboard)`; this is why.
- `src/components/media/MediaCard.tsx` — the poster, the aspect ratio, the badge and the action slot
  already exist there. Extend it; do not fork it.
- `src/actions/media.ts` — the server-action shape, `redirectToClearSession` + `translateGraphQLError`
  in the read path (`searchAllMedia` is the exact precedent — same render-pass constraint).
- `globals.css`'s `@utility no-scrollbar` — already defined, used by the sidebar. The strip reuses it.
- `src/app/(dashboard)/movies/page.tsx` — a listing page's `generateMetadata` + `PageBreadcrumb`
  shape, for the billboard's own page furniture.

## Steps

**Navigation half**

1. `AppSidebar.tsx`: entries become Cartelera `/` (`Popcorn`), Mis películas `/movies` (`Film`),
   Mis series `/shows` (`TvMinimal`), Calendario `/calendar` (`Calendar`), Descargas `/downloads`
   (`Download` — `LayoutList` is currently on two entries at once), then the admin pair as today.
   `t("dashboard")` → `t("billboard")`, `t("queue")` → `t("downloads")`. Point the logo `Link` at
   `/`. Leave `isActive`'s exact-equality rule alone — `/` as an entry works under it, and making it
   prefix-matching would light up every entry at once.
2. Move `src/app/page.tsx` to `src/app/perceptor/page.tsx` with no content change, and delete
   `src/app/(dashboard)/dashboard/`. `perceptor/` stays **outside** every route group: inside
   `(dashboard)` it would inherit the layout's `getCurrentUser()` and become auth-gated.
3. `proxy.ts`: `PUBLIC_ROUTES` becomes `["/perceptor", "/terms", "/privacy"]` and the authenticated
   bounce off `/login` targets `/`. Both are required — leaving `/` public means an anonymous visit
   renders the dashboard shell before the layout's own check turns it away.
4. `actions/auth.ts`'s destination fallback and `LoginForm.tsx`'s `redirect` fallback both become `/`.
5. `calendar/page.tsx` and `downloads/page.tsx`: a default export returning `null`. No breadcrumb, no
   heading, no copy, no `generateMetadata` (spec REQ-13).
6. Message catalogs, both files, same keys: `nav.billboard` (`Browse` / `Cartelera`), `nav.movies`
   (`My movies` / `Mis películas`), `nav.shows` (`My series` / `Mis series`), `nav.downloads`
   (`Downloads` / `Descargas`); drop `nav.dashboard`, `nav.queue` and the `pages.dashboard` block;
   add `pages.billboard` (title + metadata) and `billboard.moviesHeading`/`showsHeading` for the two
   strips. Add `errors.media.catalog_unavailable` and `errors.media.unsupported_type` — snake_case
   leaves, matching `errors.movie.already_completed`. Keep `landing.*` as it is.

**Billboard half**

7. `MediaCard.tsx`: add `showMeta = true`. When false, the whole `{/* Info */}` block does not
   render. Nothing else about the card changes and no existing call site passes the flag.
8. `MediaCarousel.tsx` — a client component taking a heading and children:
   - The strip is one element with `flex`, `overflow-x-auto`, `overscroll-x-contain`,
     `snap-x snap-mandatory`, `scroll-smooth` and `no-scrollbar`; each child is `snap-start` with a
     fixed responsive width. The browser owns the scrolling — no wheel, drag or pointer handler.
   - Two buttons top-right. `onClick` sets `scrollLeft` by `Math.floor(clientWidth / cardWidth) *
     cardWidth` in the appropriate direction, measuring `cardWidth` off the first child rather than a
     hardcoded number, so paging never leaves a card clipped.
   - Reaching an end is read from the element, not remembered: an `onScroll` handler sets
     `atStart`/`atEnd` from `scrollLeft` and `scrollWidth - clientWidth` with a small pixel margin,
     so dragging updates the controls exactly as pressing them does. A control at its end is
     `disabled` and visibly dimmed — rendered, never removed.
   - No new dependency, no `requestAnimationFrame` animation loop, no ref to a third-party instance.
9. `PopularCarousel.tsx` — the client half of one strip: takes `items`, a heading and an optional
   `initialError`, owns the add state exactly as `MultiSearchResults` does, and renders
   `MediaCarousel` with one `MediaCard showMeta={false} showTypeBadge showLink={false}` per item,
   each with `MediaResultAction` in the action slot. With an error it renders the message in the
   strip's place and no cards.
10. `actions/media.ts` — `getPopularMedia(type: MediaType)`, selecting the same field set the two
    search documents select. Read path awaited during a render pass, so `redirectToClearSession`,
    **not** `redirectIfUnauthenticated` (see `services/web/CLAUDE.md`); errors go through
    `translateGraphQLError`.
11. `app/(dashboard)/page.tsx` — a Server Component. Fetch both lists in parallel with
    `Promise.allSettled`, then for every rejected result call `unstable_rethrow(reason)` **before**
    treating it as a catalog failure: `redirectToClearSession` throws Next's redirect, and a settled
    rejection would otherwise swallow it and strand a stale session on a permanent error page. Pass
    each list, or its translated error, to its own `PopularCarousel`. Films first.

## Contract obligations

Consumed, retyped by hand from `../spec.md` § GraphQL Contract Delta — read-only:

```graphql
query PopularMedia($type: String!) {
  popularMedia(type: $type) {
    id title releaseDate posterUrl originalLanguage overview type mediaId inLibrary
  }
}
```

`MediaSearchResult` is the type `src/types/search.ts` already declares — no new local type.

Every error condition and what this service does with it:

| `extensions.i18n.key` | What `web` does |
| :-- | :-- |
| `error.media.catalog_unavailable` | Render the translated message in that strip's place. The other strip, the sidebar and the header are unaffected. |
| `error.media.unsupported_type` | Unreachable from the UI (only `MEDIA_TYPE` literals are sent), but the catalog carries the key so it renders translated rather than as raw English if it ever surfaces. |
| `error.auth.unauthenticated` / `error.auth.session_expired` | `redirectToClearSession` inside the action, rethrown past `allSettled` by `unstable_rethrow` (step 11). |
| No response at all | `errors.network.connectionFailed`, as elsewhere. |

## Tests

This service has no test runner, and this feature does not introduce one
(`services/web/CLAUDE.md` § "Tests: there are none"). The gates are the typecheck, Biome on the files
touched, `scripts/check-messages.mjs` for catalog parity, and the manual pass in `../plan.md`
§ Verification.

The one failure here that would be silent — the swallowed auth redirect in step 11 — is not
test-covered and is instead pinned by an explicit acceptance check: sign in, delete the `auth_token`
cookie in the browser, reload `/`, and confirm the result is `/login`, not two error strips.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

0 typecheck errors, `build` exits 0, catalog parity passes, and
`grep -rn 'quenue\|"/dashboard"' services/web/src` returns nothing. Run `bin/cli web npx --no biome
check <file>` on each new file — never on the repo, which reports ~1600 pre-existing errors.

---
title: Billboard and Navigation — Tasks
last_updated: 2026-08-28
status: Draft
---

# TASKS: Billboard and Navigation (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[worker]` and no `[infra]` task in this feature: the encode pipeline is untouched, and nothing
about the stack, the wrappers or `.env` changes. No Prisma migration either — a diff under
`services/api/prisma/` on this feature means something went wrong (`api/plan.md` § Scope).

Groups 1 and 2 run **at the same time**: Group 2 consumes nothing new from the contract, so the two
cannot diverge. Group 3 is the only part that needs `api` live.

## Tasks

### Group 1 — the contract (`api`)

- [ ] **T001** `[api] [P]` Add `MEDIA_CATALOG_UNAVAILABLE: 'error.media.catalog_unavailable'` to
      `services/api/src/i18n/error-keys.ts`, in the "movies, shows, seasons, episodes" block beside
      `MEDIA_UNSUPPORTED_TYPE`, and its template to `services/api/src/i18n/messages.en.ts`:
      `Could not reach the catalog. Check the TMDB API key.` The key string is frozen in
      `spec.md` § GraphQL Contract Delta — match it character for character.
      *Done when:* `bin/npm api test` is green, including the existing `messages.en.spec.ts` parity
      suite, which fails if a key has no template.

- [ ] **T002** `[api] [P]` Add the TMDB popular reach. New
      `services/api/src/clients/tmdb/popular.ts`: pure `mapPopularMovies(rows: TmdbMovie[])` /
      `mapPopularShows(rows: TmdbShow[])` returning the catalog-only `MediaSearchResult` from
      `@/clients/types`, mapping exactly as `MoviesService.search`/`ShowsService.search` already do
      and building every poster through `posterUrl()`. Sibling of `multi.ts` in structure, including
      the TMDB reference URL as its one permitted comment. In
      `services/api/src/clients/tmdb/client.ts`, extract `fetchPage`'s URL build + fetch + `res.ok`
      check + `TmdbSearchResponse` unwrap into a private
      `fetchResults<T>(endpoint, params: Record<string, string>)`, have `fetchPage` call it with
      `{ query, page }` — its signature and behaviour must not change — then add
      `popular(type: MediaType, language: string)` hitting `movie/popular` / `tv/popular` through the
      existing `TMDB_ENDPOINT` map with `{ language, page: '1' }` and **no `region`**. Declare no new
      row interfaces: the popular endpoints return `TmdbMovie`/`TmdbShow` in the same envelope.
      *Done when:* `bin/cli api npx --no tsc --noEmit` is clean and `bin/npm api test` is green with
      no change to any existing search test — `search`, `searchMulti` and `details` are untouched.

- [ ] **T003** `[api]` Add `services/api/src/media/popular-media.service.ts`, modelled on
      `media-search.service.ts`. `list(type, userId)` runs, in this order and only this order:
      `mediaDispatch.resolve(type)` (throws for an unsupported type before anything else);
      `resolveCatalogLocale(userId)` — the caller's `User.uiLocale`, else the `ui_locale` setting via
      `SettingsService.getMap()`, else `en`, every candidate passed through
      `isSupportedLocale` (`@/i18n/locales`) and an unsupported one skipped rather than used; a read
      of `tmdb:popular:<type>:<locale>` where a Redis error or a parse failure is logged and treated
      as a miss; on a miss `tmdb.popular(type, locale)` inside a `try`/`catch` wrapping the TMDB call
      **only**, rethrowing as `i18nError.serviceUnavailable(ERROR_KEYS.MEDIA_CATALOG_UNAVAILABLE)`; a
      best-effort write of those catalog-only rows with `EX 86400`, errors logged and dropped, never
      awaited into the response path; and finally `service.cacheAndEnrich(rows, userId)`. Register it
      in `media.module.ts` and add the query to `media.resolver.ts` —
      `@Query(() => [MediaSearchResult], { name: 'popularMedia' })`, one `@Args('type')`, the same
      `principal.type === 'user' ? principal.id : ''` narrowing its neighbours use, **no
      `@AllowService()` and no `@Public()`** (NFR-2). → T001, T002
      *Done when:* after an `api` reboot `git diff services/api/src/schema.gql` shows
      `popularMedia(type: String!): [MediaSearchResult!]!` and nothing else, matching
      `spec.md` § GraphQL Contract Delta exactly (Article VIII's check); the query returns 20 items
      for `"movie"` and for `"show"`; `bin/cli redis redis-cli --scan --pattern 'tmdb:popular:*'`
      then lists one key per list with `ttl` at or just under `86400` (AC-8), a second call makes no
      further TMDB request and leaves that TTL counting down, and a caller whose `uiLocale` is `es`
      produces `tmdb:popular:movie:es` while `en` produces `tmdb:popular:movie:en`, each with its own
      TTL (AC-12).

- [ ] **T004** `[api]` Add `services/api/src/media/popular-media.service.spec.ts`, opening with the
      paragraph naming the three silent failures it defends against. Fault-inject each case — it
      must be verified to fail when the rule is removed. (1) **Ownership never reaches the shared
      list cache**: the string handed to Redis parses to rows carrying neither `mediaId` nor
      `inLibrary`, while the returned value carries both; injection: move the write after
      `cacheAndEnrich`. (2) **The locale is clamped**: an unsupported `uiLocale` produces the `:en`
      key, and an unset `uiLocale` with `ui_locale = es` produces `:es`; injection: drop the
      `isSupportedLocale` guard. (3) **An unsupported type costs nothing**: `type: 'person'` throws
      `error.media.unsupported_type` and neither the Redis client nor the `TmdbClient` was called;
      injection: move `resolve(type)` below the cache read. → T003
      *Done when:* `bin/npm api test` is green with the new suite counted, and each case has been
      observed to fail under its injection (AC-9, AC-11, AC-12).

- [ ] **T005** `[docs] [P]` Record the delta in `docs/spec/graphql-contract.md`: a new section for
      `033-billboard-and-navigation` carrying `popularMedia(type:)`, why it reuses
      `MediaSearchResult` rather than a leaner type, that it has **no `language` argument** because
      `api` resolves the locale itself and a client-supplied one would unbound the cache-key space,
      the day-long `tmdb:popular:<type>:<lang>` list cache and its catalog-only invariant beside the
      existing cache-before-enrich note, and `error.media.catalog_unavailable` in the error-key
      vocabulary.
      *Done when:* the file describes exactly what `spec.md` froze, with no field, argument or error
      key that is not in the spec.

### Group 2 — navigation (`web`)

Runs in parallel with Group 1 — nothing here selects a new GraphQL field. Sequential within itself.

- [ ] **T006** `[web] [P]` Update both message catalogs, same keys in each: `nav.billboard`
      (`Browse` / `Cartelera`), `nav.movies` (`My movies` / `Mis películas`), `nav.shows`
      (`My series` / `Mis series`), `nav.downloads` (`Downloads` / `Descargas`); remove
      `nav.dashboard`, `nav.queue` and the whole `pages.dashboard` block; add `pages.billboard`
      (title + metadata strings) and the two strip headings; add `errors.media.catalog_unavailable`
      and `errors.media.unsupported_type` as snake_case leaves, matching
      `errors.movie.already_completed`'s shape. Leave `landing.*` exactly as it is — the landing
      moves, its copy does not. The `es` register stays Rioplatense.
      *Done when:* `bin/cli web node scripts/check-messages.mjs` exits 0, and
      `grep -rn '"dashboard"\|"queue"' services/web/messages/` returns nothing.

- [ ] **T007** `[web]` Rewrite the entry list in `services/web/src/layout/AppSidebar.tsx`: Cartelera
      `/` (`Popcorn`), Mis películas `/movies` (`Film`), Mis series `/shows` (`TvMinimal`),
      Calendario `/calendar` (`Calendar`), Descargas `/downloads` (`Download` — `LayoutList` is
      currently on two entries at once), then the admin-only Settings and Users as today. Relabel
      through `t("billboard")` and `t("downloads")`, and point the logo `Link` at `/`. Leave
      `isActive`'s exact-equality rule alone: `/` works under it, and making it prefix-matching would
      light up every entry at once. → T006
      *Done when:* signed in as an administrator the sidebar lists all seven in that order and every
      one navigates to a page that renders; signed in as a regular user Settings and Users are absent
      and the other five still resolve (AC-1).

- [ ] **T008** `[web]` Move the routes. Create `services/web/src/app/(dashboard)/page.tsx` — for now
      the page furniture only (`generateMetadata` + `PageBreadcrumb` from `pages.billboard`, no
      carousels; T013 fills it) — and delete `src/app/(dashboard)/dashboard/`. Move
      `src/app/page.tsx` to `src/app/perceptor/page.tsx` with **no content change**; it stays outside
      every route group, since inside `(dashboard)` it would inherit the layout's `getCurrentUser()`
      and become auth-gated. Add `src/app/(dashboard)/calendar/page.tsx` and
      `src/app/(dashboard)/downloads/page.tsx`, each a default export returning `null` — no
      breadcrumb, no heading, no copy, no `generateMetadata` (REQ-13). → T006
      *Done when:* `bin/npm web run build` exits 0; `/` renders inside the shell, `/dashboard`
      answers 404, `/perceptor` renders the landing hero, and `/calendar` and `/downloads` answer 200
      with an empty content area for a regular user (AC-13).

- [ ] **T009** `[web]` Retarget the three redirect destinations. `services/web/src/proxy.ts`:
      `PUBLIC_ROUTES` becomes `["/perceptor", "/terms", "/privacy"]` and the authenticated bounce off
      `/login` targets `/`. `services/web/src/actions/auth.ts`'s post-login fallback and
      `services/web/src/components/auth/LoginForm.tsx`'s `redirect` fallback both become `/`. All
      three are required: leaving `/` in `PUBLIC_ROUTES` lets an anonymous request render the
      dashboard shell before the layout's own check turns it away. → T008
      *Done when:* signing in with no `redirectTo` lands on `/` and the logo keeps you there (AC-2);
      with no session cookie, requesting `/` ends at `/login` while `/perceptor` renders the landing
      with its "Ingresar" button and no sidebar (AC-3); and
      `grep -rn 'quenue\|"/dashboard"' services/web/src` returns nothing.

### Group 3 — the billboard (`web`)

T012 and T013 consume the contract, so they wait on T003. T010 and T011 are pure UI and do not.

- [ ] **T010** `[web] [P]` Add an opt-in `showMeta = true` prop to
      `services/web/src/components/media/MediaCard.tsx`: when false the `{/* Info */}` block —
      title, overview, year — does not render. Change nothing else, and thread nothing through
      `MediaList.tsx`; no existing call site passes the flag.
      *Done when:* `bin/cli web npx --no tsc --noEmit` is clean and `/search`, `/movies`, `/shows`,
      `/movies/add` and `/shows/add` look exactly as they did.

- [ ] **T011** `[web] [P]` Add `services/web/src/components/media/MediaCarousel.tsx`, a client
      component taking a heading and children. The strip is one element with `flex`,
      `overflow-x-auto`, `overscroll-x-contain`, `snap-x snap-mandatory`, `scroll-smooth` and the
      existing `no-scrollbar` utility from `globals.css`; each child is `snap-start` at a fixed
      responsive width. The browser owns the scrolling — no wheel, drag or pointer handler. Two
      buttons top-right set `scrollLeft` by `Math.floor(clientWidth / cardWidth) * cardWidth`, with
      `cardWidth` measured off the first child, never hardcoded. `atStart`/`atEnd` are read from the
      element in an `onScroll` handler (`scrollLeft`, `scrollWidth - clientWidth`, small pixel
      margin), so dragging updates the controls exactly as pressing them does; a control at its end
      is `disabled` and visibly dimmed — rendered, never removed. No animation loop, no third-party
      instance.
      *Done when:* rendered against 20 placeholder children, a trackpad swipe, a touch drag and
      shift+wheel each reach the last child with the arrows untouched, the page itself never scrolls
      sideways and no scrollbar is drawn (AC-5); one press of the next arrow leaves no card clipped
      at either edge (AC-5); dragging to either end leaves that end's arrow inert and the other live
      (AC-6); and `git diff services/web/package.json services/web/package-lock.json` shows no added
      dependency (AC-7).

- [ ] **T012** `[web]` Add `getPopularMedia(type: MediaType)` to
      `services/web/src/actions/media.ts`, selecting the same field set the two search documents
      select. It is awaited during a Server Component render pass, so the auth branch is
      `redirectToClearSession`, **not** `redirectIfUnauthenticated` — `searchAllMedia` in the same
      file is the precedent and `services/web/CLAUDE.md` explains why getting this backwards throws
      during render. Errors go through `translateGraphQLError`. Do **not** add a `language` argument:
      the contract has none and `api` resolves the locale from the caller. → T003
      *Done when:* `bin/cli web npx --no tsc --noEmit` is clean and the action returns 20 items for
      each type against the running `api`.

- [ ] **T013** `[web]` Render the billboard. Add
      `services/web/src/components/billboard/PopularCarousel.tsx` — the client half of one strip:
      `items`, a heading and an optional `initialError`, owning `addingId`/`addedMediaIds` exactly as
      `MultiSearchResults.tsx` does, computing `owned` as
      `item.inLibrary || addedMediaIds[item.id] !== undefined` and **never** from `mediaId` alone,
      rendering `MediaCarousel` with one `MediaCard showMeta={false} showTypeBadge showLink={false}`
      per item and the shared `MediaResultAction` in each action slot; with an error it renders the
      message in the strip's place and no cards. Then fill
      `services/web/src/app/(dashboard)/page.tsx`: fetch both lists with `Promise.allSettled`, and
      for every rejected result call `unstable_rethrow(reason)` **before** treating it as a catalog
      failure — `redirectToClearSession` works by throwing Next's redirect, and a settled rejection
      would swallow it and strand a stale session on a permanent error page. Films first, series
      second. → T008, T010, T011, T012
      *Done when:* `bin/npm web run build` exits 0; `/` shows 20 cards per strip, each a poster, a
      badge and a button with no title and no year anywhere on the card; a card the user does not own
      offers **Agregar**, becomes **Ir** with no reload, and is still **Ir** after reloading `/`
      (AC-4); with `movie_db_api_key` invalid and the popular keys flushed, `/` still renders with
      its sidebar and header and each strip carries the translated
      `errors.media.catalog_unavailable`, both filling again once the key is restored (AC-10); and
      deleting the `auth_token` cookie in the browser and reloading `/` lands on `/login`, not on two
      error strips.

### Group 4 — verification and docs

- [ ] **T014** `[docs]` Update the `CLAUDE.md` files this feature falsifies. `services/api/CLAUDE.md`:
      the `media/` module map entry gains `popularMedia` and its list cache, and the sentence in
      § "Errors carry a translation key" asserting that **`api` never reads `uiLocale` itself** is now
      false — it reads it to pick TMDB's `language`, still never to translate. `services/web/CLAUDE.md`:
      the sidebar's entries and the new home route, `/perceptor`, the `MediaCard` `showMeta` flag, the
      carousel and its no-dependency rule, and the `allSettled` + `unstable_rethrow` requirement
      beside the existing `redirectIfUnauthenticated` vs `redirectToClearSession` section. Root
      `CLAUDE.md`: the **Browse library** row of the pipeline table now includes `/` as the billboard,
      with spec `033`. No pipeline stage changes status. → T004, T013
      *Done when:* no sentence in any `CLAUDE.md` still says `api` never reads `uiLocale`, still calls
      `/dashboard` a route, or still describes `/` as the public landing.

- [ ] **T015** `[docs]` Walk every acceptance criterion in `spec.md` against the running stack, tick
      each box, and set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and
      `web/plan.md`. Re-measure the `api` test count rather than citing the root `CLAUDE.md`'s.
      → T014
      *Done when:* AC-1 … AC-14 are all ticked from an observed run, and
      `bin/cli api npx --no tsc --noEmit`, `bin/npm api test`,
      `bin/cli web npx --no tsc --noEmit`, `bin/npm web run build` and
      `bin/cli web node scripts/check-messages.mjs` all pass, with `git status services/api/prisma/`
      clean.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

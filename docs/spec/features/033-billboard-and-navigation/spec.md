---
title: Billboard and Navigation
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-28
last_updated: 2026-08-28
status: Approved
services: [api, web]
---

# SPEC: Billboard and Navigation (`spec.md`)

## Context & Goal

The sidebar (`services/web/src/layout/AppSidebar.tsx`) is still the TailAdmin skeleton the project
started from, and three of its five non-admin entries are broken. The first item, labelled
`nav.dashboard`, points at `/` — which is not the dashboard at all but
`services/web/src/app/page.tsx`, the public marketing landing with its hero and its "Ingresar"
button. A signed-in user who clicks the first item in their own sidebar, or the logo above it, is
thrown back out to a login call-to-action. Meanwhile the actual placeholder screen lives at
`/dashboard` (`services/web/src/app/(dashboard)/dashboard/page.tsx`), reachable only because
`services/web/src/actions/auth.ts` redirects there after login. The other two broken entries are
`nav.calendar` → `/calendar` and `nav.queue` → `/quenue` (sic), neither of which exists: both are
404s behind a menu item that looks live.

Which of those routes is public is decided in one more place: `services/web/src/proxy.ts` lists
`/` under `PUBLIC_ROUTES` and bounces an already-signed-in visitor from `/login` to `/dashboard`.
Both of those facts invert with this feature.

This feature settles the navigation and gives the first item something to show. The billboard —
**Cartelera** in Spanish, **Browse** in English — moves to `/`, inside the authenticated dashboard
shell; the marketing landing keeps existing but at `/perceptor`, where a future first-run flow can
point at it. `/dashboard` disappears and login lands on `/`. Calendario and Descargas become real
but deliberately empty routes, so a menu item never 404s again. Settings and Users keep the
administrator-only treatment `029-settings-screen-tabs` gave them.

The billboard's content is two carousels of the TMDB popular lists — [`/movie/popular`](https://developer.themoviedb.org/reference/movie-popular-list)
and [`/tv/popular`](https://developer.themoviedb.org/reference/tv-series-popular-list) — served
through a new `popularMedia(type:)` query on `api`, beside the existing `searchMedia`/`addMedia`
pair in `services/api/src/media/`. Each card is poster, type badge and the same add/go button
`/search` already uses (`services/web/src/components/search/MediaResultAction.tsx`) — no title, no
year. The strip itself follows [Jellyseerr's `Slider`](https://github.com/seerr-team/seerr/blob/develop/src/components/Slider/index.tsx):
a natively scrolling, scrollbar-less overflow container with a pair of arrows that page it by whole
cards. We take that structure and not its dependencies — Jellyseerr animates the scroll with
`react-spring` and debounces its resize handler with `lodash`, and this carousel adds neither. Because this is the screen every user lands on after login, its TMDB calls are cached in
Redis for a day, the same 24-hour catalog cache `MoviesService`/`ShowsService` already write per
title; otherwise a handful of users refreshing their home page would burn hundreds of TMDB calls a
day for a list that changes daily at most.

No pipeline stage in the root `CLAUDE.md` changes status. This is navigation plus one read-only
catalog query.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Sidebar items)**: The sidebar must show exactly these entries, in this order, each
      resolving to an existing route: **Cartelera** (`/`), **Mis películas** (`/movies`),
      **Mis series** (`/shows`), **Calendario** (`/calendar`), **Descargas** (`/downloads`), and —
      for an administrator only — **Settings** (`/settings`) and **Users** (`/users`). No entry may
      point at a route that does not exist; `/quenue` and `/dashboard` are gone.
- [ ] **REQ-2 (Billboard is the home route)**: `/` must render the billboard inside the
      authenticated dashboard shell. A visitor without a valid session who requests `/` must be sent
      to `/login`, and a successful login with no explicit destination must land on `/`. A visitor
      who *does* hold a session and requests `/login` must be sent to `/` rather than to
      `/dashboard`. `/dashboard` must no longer resolve.
- [ ] **REQ-3 (Landing moves)**: The current marketing landing must keep working, unchanged in
      content, at `/perceptor`, publicly reachable with no session. Nothing in the app links to it
      in this feature.
- [ ] **REQ-4 (Logo target)**: The sidebar logo must lead to `/` — the billboard — for a signed-in
      user, not to the landing.
- [ ] **REQ-5 (Two carousels)**: The billboard must render two horizontally scrollable carousels,
      films first and series second, each holding the 20 titles of page 1 of the corresponding TMDB
      popular list, in the order TMDB returns them.
- [ ] **REQ-6 (Card contents)**: A carousel card must show the poster, a badge naming its type
      (film or series) and the add/go action — and nothing else. No title, no release year, no
      rating, no overview. A card whose title has no poster must still render, occupy the same slot
      and keep its action usable.
- [ ] **REQ-7 (Carousel mechanics)**: The strip must scroll natively and horizontally — the browser's
      own overflow scrolling, so a trackpad swipe, a touch drag and a shift+wheel all work without
      any handler of ours. The native scrollbar is hidden (`no-scrollbar` already exists in
      `services/web/src/app/globals.css`), cards snap to their left edge as the strip settles, and
      the strip never scrolls the page horizontally: the overflow is contained to the carousel.
      A previous/next control sits at the strip's top right and advances by one screenful of whole
      cards — never leaving a card half-visible. The control for a direction with nothing left to
      show is rendered but visibly inert, not removed, so the pair does not jump around as the user
      scrolls. Reaching either end by dragging must update those controls the same way pressing them
      does. The carousel must reach its last card with the pointing device alone, with the controls
      ignored or unavailable.
- [ ] **REQ-8 (No new dependencies)**: The carousel must be built from HTML and CSS with the
      project's existing toolset — Tailwind 4 utilities, `globals.css`, React state only for what
      CSS cannot express (which control is inert). No carousel, slider, animation or gesture package
      may be added to `services/web/package.json`; this is modelled on Jellyseerr's `Slider`, whose
      structure we follow and whose `react-spring`/`lodash` dependencies we do not.
- [ ] **REQ-9 (Add/go semantics)**: The card's action must behave exactly as it does on `/search`:
      a title the calling user does not own offers **add**, which registers it and, without a page
      reload, turns into **go**; a title the user already owns offers **go**, linking to that
      title's detail page. Ownership is the calling user's, never "somebody registered this".
- [ ] **REQ-10 (Popular lists are cached for a day)**: The result of each popular list must be
      cached in Redis with a 24-hour TTL and served from there while it is warm, so that repeated
      visits to the billboard by any number of users produce at most one TMDB call per list per day.
      A cache miss, an expired entry or an unreachable Redis must fall through to TMDB rather than
      fail the screen.
- [ ] **REQ-11 (Cached payload is catalog-only)**: What is written to Redis must contain only
      catalog data. Whether the calling user owns a title, and the id of the registered row, are
      computed per request **after** the cache write — the same ordering `searchMedia` already owes
      (`docs/spec/graphql-contract.md`, "cache-before-enrich"). One user's library must never be
      visible in what another user sees for the rest of the day.
- [ ] **REQ-12 (Localised catalog)**: The popular lists must be requested from TMDB in the calling
      user's effective UI language (their own `uiLocale`, else the installation's `ui_locale`, else
      `en`), with no `region` parameter — the list is the global one. Each language is cached
      separately.
- [ ] **REQ-13 (Empty routes)**: `/calendar` and `/downloads` must resolve for any signed-in user
      and render nothing — no breadcrumb, no heading, no placeholder copy. They exist so their menu
      entries are not 404s; what they will contain is a later spec.
- [ ] **REQ-14 (One carousel's failure is not the page's)**: If a popular list cannot be obtained —
      TMDB unreachable, an unset or rejected API key, a malformed response — the billboard must
      still render, with a translated error in place of that carousel only. The other carousel, the
      sidebar and the header must be unaffected.
- [ ] **REQ-15 (Unsupported type)**: `popularMedia` must refuse a `type` other than `movie` or
      `show` with the same error the rest of the media dispatch already returns, before any TMDB or
      Redis call is made.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (TMDB call budget)**: With a warm cache, loading the billboard must make **zero** TMDB
      calls. The steady-state cost of this screen is two calls per UI language per day.
- [ ] **NFR-2 (Authenticated, never the service token)**: `popularMedia` requires a user credential.
      It must not be exempted for the worker/qBittorrent service token, and must add no anonymous
      surface — `defaultUiLocale` stays the only public field (`029-settings-screen-tabs`, NFR-3).
- [ ] **NFR-3 (Error copy is catalog-driven)**: Every error crosses the boundary as English text
      plus an `extensions.i18n` key, resolved by `web` against `messages/{en,es}.json`
      (`018-ui-i18n`). No new hardcoded Spanish in `api`.
- [ ] **NFR-4 (No dead menu entry)**: Every sidebar entry visible to a given user must answer 200
      for that user. This is verifiable and is the point of REQ-13.
- [ ] **NFR-5 (No new user-facing English)**: The three renamed entries (Cartelera, Mis películas,
      Mis series) and Descargas are catalog keys, translated in both `en` and `es`. The `es` register
      stays Rioplatense.

## GraphQL Contract Delta

```graphql
type Query {
  """
  Page 1 of TMDB's popular list for `type` ("movie" | "show"), 20 items, in the
  order TMDB returns them. Cached for 24h per type and UI language; `mediaId`
  and `inLibrary` are computed per caller, after the cache write.
  """
  popularMedia(type: String!): [MediaSearchResult!]!
}
```

`MediaSearchResult` is unchanged — the same type `searchMedia` and `searchAllMedia` already return,
reused deliberately so `web` retypes nothing new and the carousel card can reuse the existing
add/go component. Fields the card does not render (`title`, `releaseDate`, `overview`, `status`)
are still populated; the card choosing not to show them is a `web` decision, not a contract one.

One key is added to the frozen error vocabulary in `services/api/src/i18n/error-keys.ts`:
`MEDIA_CATALOG_UNAVAILABLE: 'error.media.catalog_unavailable'`. It exists because a TMDB failure on
this screen is now a normal, user-visible condition — the billboard is the first page after login,
and an installation with an unset `movie_db_api_key` (a fresh install, per the root `CLAUDE.md`)
must show a message rather than a raw `TMDB request failed: 401 Unauthorized` string.

| Condition | HTTP / GraphQL error | i18n key | Message the user sees |
| :-- | :-- | :-- | :-- |
| `type` is not `movie` or `show` | `BadRequestException` | `error.media.unsupported_type` | existing copy — `Tipo de medio no soportado: <type>` |
| TMDB unreachable, rejects the key, or answers non-JSON | `ServiceUnavailableException` | `error.media.catalog_unavailable` | `No se pudo consultar el catálogo. Revisá la API key de TMDB.` |
| No session, or it expired | `UnauthorizedException` | existing | existing — `web` clears the session and redirects to `/login` |

What `web` does with each: the billboard fetches the two lists independently, so a failing list
renders the translated message inside that carousel's strip and the other carousel renders normally
(REQ-14). `error.media.unsupported_type` is not reachable from the UI — `web` only ever sends the
two known values — but it is in the table because the query is callable directly. An
`UnauthorizedException` goes through `redirectIfUnauthenticated` as it does today. A network failure
that never reaches `api` shows `errors.network.connectionFailed`.

A Redis failure is **not** in this table: it is invisible to the caller by REQ-10, logged and
followed by a live TMDB call.

## Data Model Changes

None. No Prisma model, field or enum changes; the only persistence this feature adds is a Redis key
with a TTL, which is a cache and not a schema.

## Acceptance Criteria

- [ ] **AC-1**: Signed in, the sidebar lists Cartelera, Mis películas, Mis series, Calendario and
      Descargas in that order; each one navigates to a page that renders (no 404). Signed in as an
      administrator, Settings and Users follow them; signed in as a regular user, they are absent.
- [ ] **AC-2**: Signing in with no `redirectTo` lands on `/`, which shows two carousels. Requesting
      `/dashboard` afterwards answers 404. Clicking the sidebar logo stays on `/`.
- [ ] **AC-3 (failure path)**: With the browser holding no session cookie, requesting `/` ends at
      `/login`. Requesting `/perceptor` in the same state renders the landing hero with its
      "Ingresar" button and no sidebar.
- [ ] **AC-4**: The films carousel holds 20 cards; each shows a poster and a badge, and neither the
      title nor the year appears anywhere on the card. A card for a title the user does not own
      offers add; pressing it registers the title and the same card offers go without a reload;
      reloading `/` shows go for that card.
- [ ] **AC-5**: With a pointing device alone — trackpad swipe, touch drag or shift+wheel, arrows
      untouched — the films carousel reaches its twentieth card, the page itself never scrolls
      sideways, and no scrollbar is drawn under the strip. Pressing the next arrow once advances by
      whole cards and leaves none clipped at either edge.
- [ ] **AC-6**: At the strip's left end the previous arrow is present but inert; dragging to the
      right end without touching the arrows leaves the next arrow inert and the previous one live.
- [ ] **AC-7**: `git diff services/web/package.json services/web/package-lock.json` for this feature
      shows no added dependency.
- [ ] **AC-8**: Loading `/` once, then
      `bin/cli redis redis-cli --scan --pattern 'tmdb:popular:*'` lists one key per list, and
      `bin/cli redis redis-cli ttl <key>` returns a value at or just under `86400`. Reloading `/`
      several times leaves the TTL counting down from that first load — it is not refreshed, and
      `api`'s log shows no further TMDB request.
- [ ] **AC-9**: `bin/cli redis redis-cli get tmdb:popular:movie:<lang>` returns a payload with no
      `inLibrary` and no `mediaId` field, while the GraphQL response for the same load has
      `inLibrary` set per the calling user. Signing in as a second user who owns none of those
      titles shows every card as add, with the same TTL still counting down.
- [ ] **AC-10 (failure path)**: With `movie_db_api_key` set to an invalid value and the popular cache
      flushed (`bin/cli redis redis-cli --scan --pattern 'tmdb:popular:*' | xargs -r bin/cli redis
      redis-cli del`), `/` still renders with its sidebar and header, and each carousel strip shows
      the translated `error.media.catalog_unavailable` copy instead of cards. Restoring the key and
      reloading fills both carousels.
- [ ] **AC-11 (failure path)**: A `popularMedia(type: "person")` call is refused with
      `error.media.unsupported_type`, and `bin/cli redis redis-cli --scan --pattern
      'tmdb:popular:person*'` lists nothing — the type was rejected before anything was fetched or
      written.
- [ ] **AC-12**: With the user's `uiLocale` set to `es`, `/` produces `tmdb:popular:movie:es`;
      switching that user to `en` and reloading produces `tmdb:popular:movie:en` alongside it, and
      both keys keep their own TTL.
- [ ] **AC-13**: `/calendar` and `/downloads` answer 200 for a regular user and render an empty
      content area — no heading, no breadcrumb, no placeholder text — inside the normal shell.
- [ ] **AC-14**: `bin/npm web run build` exits 0, `bin/npm api run test` is green, and
      `grep -rn 'quenue\|"/dashboard"' services/web/src` returns nothing — the route-group directory
      `(dashboard)/` keeps its name, only the URL is gone.

## Out of Scope

- **What Calendario and Descargas will show.** They are empty routes by REQ-13. The download
  monitoring UI already exists as components (`services/web/src/components/downloads/`) mounted on
  the film and series detail pages; giving `/downloads` an installation-wide view of those is its
  own feature, with its own contract question about which downloads a non-owner may see.
- **A first-run flow that shows `/perceptor`.** The landing moves and keeps working (REQ-3); when
  and to whom the app offers it is deliberately not decided here.
- **Honouring `movies_enabled` / `shows_enabled`.** Both settings are stored and editable
  (`029-settings-screen-tabs`) but nothing reads them yet anywhere in the codebase. The billboard
  renders both carousels unconditionally rather than becoming the first consumer of a setting whose
  meaning has never been specified.
- **The rest of Jellyseerr's `Slider`.** Its loading placeholders and empty-state message have no
  counterpart here — the billboard is server-rendered with the list already in hand, so there is no
  loading state to fill, and an empty popular list is a catalog failure (REQ-14), not an empty
  state. Its animated scroll is dropped with `react-spring` (REQ-8); the browser's own smooth
  scrolling is what the arrows get.
- **More than page 1, or a "see all" screen.** 20 items per list, no pagination, no infinite
  carousel. Extending it is a TMDB `page` argument and a spec for what the extra screen is.
- **Other TMDB lists.** Top rated, now playing, trending, upcoming and per-genre rows are all the
  same shape and all deliberately absent — two rows is what the billboard is today.
- **Recommendations based on the user's library.** The lists are TMDB's global popular ones; nothing
  here is personalised beyond the add/go state of each card.
- **Renaming `MediaSearchResult`.** It now backs a query that is not a search, and the name is
  imprecise. Renaming a type `web` retypes by hand, with no codegen, is the same class of risk as
  the `movieId` debt in the root `CLAUDE.md` — it needs its own spec, and the contract document
  moves first.

---
title: Billboard and Navigation — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-28
status: Approved
---

# PLAN: Billboard and Navigation (`plan.md`)

## Approach

Two independent pieces of work sit under one spec. The first is pure `web`: the sidebar's entries,
the move of the billboard to `/` and of the landing to `/perceptor`, the two empty routes, and the
carousel component. The second crosses the boundary: a new `popularMedia(type:)` query that `api`
serves from TMDB through a day-long Redis list cache.

**`api` reuses the `026-multi-search` shape rather than the `MediaTypeService` interface.**
`searchAllMedia` is served by `src/media/media-search.service.ts` — one `TmdbClient` call, a pure
mapper in `src/clients/tmdb/multi.ts`, then `mediaDispatch.resolve(type).cacheAndEnrich(rows,
userId)` per type for the cache-then-enrich ordering. `popularMedia` is the same shape:
`TmdbClient.popular(type, language)` + a pure mapper beside `multi.ts` + the same `cacheAndEnrich`.
The alternative — adding `popular()` to `MediaTypeService` so `MoviesService` and `ShowsService`
each implement it — was rejected because the new thing this feature adds is a **list-level** cache
(`tmdb:popular:<type>:<lang>`), and putting it behind the per-type interface means writing it twice,
in two services that are already deliberate twins. The per-type boundary stays exactly as
`media-type.interface.ts` describes it: no cache key, no endpoint, no `type` getter.

Nothing about the existing per-title cache changes. `cacheAndEnrich` still writes `tmdb:movie:<id>`
/ `tmdb:show:<id>` with its 24-hour TTL, which is a free win here: a card the user adds from the
billboard hits `getCachedMovie`'s warm path rather than re-fetching the title from TMDB.

**`api` resolves the TMDB `language` itself.** The spec fixes the resolution order (the caller's
`uiLocale`, else the `ui_locale` setting, else `en`) but not where it is computed. `web` sending it
as an argument would let any caller name any language, and each distinct value is its own cache key
and its own daily TMDB call — an unbounded key space behind an authenticated query. `api` resolves
it from the principal and clamps the result to `SUPPORTED_LOCALES` (`src/i18n/locales.ts`), so the
key space is exactly two entries per list. This is the first time `api` reads `uiLocale` for its own
purposes; `services/api/CLAUDE.md`'s "`api` never reads `uiLocale` itself" line becomes stale and is
corrected as part of this feature.

**`web` reuses its card, its action and its list.** `MediaResultAction.tsx` is the add/go control
`/search` and `/movies/add` already share and the carousel uses it unchanged. `MediaCard.tsx` gets
one new opt-in flag (`showMeta`, defaulting to today's behaviour) that suppresses the title/overview/
year block — the same shape the type badge was threaded through in `026-multi-search`, and smaller
than a second card component that would duplicate the poster, the badge and the action slot. The
carousel itself is a new, generic component: a natively scrolling strip with two arrow buttons and no
new dependency (spec REQ-7, REQ-8).

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the contract. `popularMedia` and `error.media.catalog_unavailable` must exist before `web` can select the field or translate the failure. |
| 2 | `web` — navigation slice | Sidebar entries, `/` ⇄ `/perceptor`, `proxy.ts`, login destinations, `/calendar`, `/downloads`, message catalogs. Touches no new GraphQL field. |
| 3 | `web` — billboard slice | The carousel, the `MediaCard` flag, `getPopularMedia`, and the `/` page that renders the two strips. Needs step 1 live to render against. |
| 4 | `docs` | `docs/spec/graphql-contract.md`, root `CLAUDE.md`, `services/api/CLAUDE.md`, `services/web/CLAUDE.md`. |

**Step 2 runs in parallel with step 1** — it consumes nothing new, and the contract is already
frozen, so the two cannot diverge. Step 3 must not start against a guessed schema: the field name,
the argument and the error key are read from `../spec.md`, and if the running `api` does not have
them yet, the slice waits rather than stubbing them.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Three things an
implementer will be tempted to change and must not:

- **`popularMedia` returns `MediaSearchResult`, the search type.** It looks wrong from inside `api`:
  this is not a search, and the type carries `title`, `releaseDate` and `overview` that the billboard
  card never renders. Introducing a leaner `PopularMediaItem` would cost `web` a second hand-retyped
  shape, a second action type and a second card path, for fields that are already free. The naming
  discomfort is recorded in `spec.md` § Out of Scope as a rename that needs its own spec.
- **`type` is a plain `String!`, not an enum.** Same reason `searchMedia`/`addMedia` are — the schema
  has no media-type enum and both consumers compare against `MEDIA_TYPE` literals.
- **No `language` argument.** See § Approach. A `web` implementer who wants the carousel in the
  user's language must not add one — `api` already resolves it.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief both services
(Constitution, Article VIII).

## Migrations

None. No Prisma model, field or enum changes. The only new persistence is a Redis key with a TTL,
which is a cache: deleting every `tmdb:popular:*` key costs one cold page load and nothing else.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Ownership written into the list cache | `cacheAndEnrich`'s output serialised into `tmdb:popular:<type>:<lang>` instead of the catalog-only rows. Every user sees the first visitor's `inLibrary`/`mediaId` for 24 hours. No error anywhere — the page renders, the buttons are just wrong. | The list-cache write takes the pre-enrichment rows and happens before `cacheAndEnrich` is called; `popular-media.service.spec.ts` asserts the serialised payload has neither field, fault-injected by moving the write after the enrich. |
| Locale not clamped to `SUPPORTED_LOCALES` | A `uiLocale` or `ui_locale` value outside the supported set becomes part of the cache key. The key space grows with the data, cache hits fall, and the TMDB budget quietly multiplies until the key is rate-limited. | `resolveCatalogLocale` clamps through `isSupportedLocale` and falls back to `en`; the spec covers it with a test asserting an unsupported value produces the `:en` key. |
| `Promise.allSettled` swallowing the auth redirect | The two lists are fetched in parallel; `redirectToClearSession` works by *throwing* Next's internal redirect. Caught as a settled rejection, it never reaches Next: a user with a stale cookie sees "no se pudo consultar el catálogo" on both strips forever instead of being bounced to `/login`. | Every rejected result passes through `unstable_rethrow(reason)` before being treated as a catalog failure — the same guard `app/(dashboard)/search/page.tsx` already applies in its `catch`. Called out again in `web/plan.md`. |
| A TMDB failure taking the whole page down | `/` has no `error.tsx`; an uncaught throw in the Server Component shows Next's default error screen, so a stale API key would make the app's home page unreachable rather than degraded. | Both fetches are caught and rendered as per-strip errors (REQ-14), the pattern `/search` already uses. AC-10 exercises it with an invalid key. |
| Redis treated as a source rather than a cache | Copying `getCachedMovie`, where a Redis error propagates by design, would make the billboard fail whenever Redis hiccups — even though TMDB could answer. | The list cache is best-effort in both directions: a read error is a miss, a write error is logged and dropped, exactly as `cacheMovies` already does on the write side. |
| `/perceptor` placed inside `(dashboard)` | The landing would inherit `layout.tsx`'s `getCurrentUser()` and become auth-gated — the opposite of its purpose, and invisible until someone signs out to check. | It stays a top-level route outside every group, and `proxy.ts`'s `PUBLIC_ROUTES` lists `/perceptor` in place of `/`. AC-3 checks it with no session cookie. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

Then the manual pass, signed in as an administrator with a valid `movie_db_api_key`:

1. Land on `/` after login. Two strips, films then series, 20 cards each, poster + badge + button,
   no title and no year. Scroll each strip with the trackpad to its last card; the page itself never
   moves sideways and no scrollbar is drawn. Page one strip with its arrows — no card ends clipped;
   at each end the corresponding arrow is visible and inert.
2. Add a card. It becomes **Ir** without a reload; reload `/` and it is still **Ir**, linking to that
   title's detail page.
3. Walk every sidebar entry, then sign in as a non-administrator and confirm Settings and Users are
   absent and the other five still resolve. `/calendar` and `/downloads` render an empty content area.
4. `bin/cli redis redis-cli --scan --pattern 'tmdb:popular:*'` and `… ttl <key>` for the cache
   evidence; `… get <key>` to confirm no `inLibrary`/`mediaId` in the stored payload.
5. Break `movie_db_api_key`, flush the popular keys, reload `/`: sidebar and header intact, both
   strips carrying the translated failure. Restore the key and reload.
6. Sign out; `/` lands on `/login`, `/perceptor` renders the landing with no sidebar, `/dashboard`
   is a 404.

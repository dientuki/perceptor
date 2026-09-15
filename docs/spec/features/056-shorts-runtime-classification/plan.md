---
title: Shorts classified by runtime — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-14
status: Implemented
---

# PLAN: Shorts classified by runtime (`plan.md`)

## Approach

This feature removes a GraphQL argument and replaces the value it carried with a derivation. Both
halves are subtractive except for one new private path inside `MoviesService`.

On the `web` side there is nothing to design: `services/web/src/components/search/MediaResultAction.tsx`
had exactly this shape before `048-shorts-category` touched it (`git show 1a1305c~1`), a single
`<Button className="mt-2">` with no wrapper, and it returns to it. The same applies to the
`addItem(item, asShort)` split in `SearchContainer.tsx` and `MultiSearchResults.tsx`: both collapse
back into the `handleAdd` they were. The one thing that must **not** be removed along the way is the
`shortsEnabled` prop on those two containers — it also feeds `MediaList`'s `showShortBadge`, which
REQ-2 keeps. An agent reading "remove the shorts affordance" will be tempted to pull that prop out
with it; that would silently drop the badge on every already-registered short.

On the `api` side the derivation lives in `MoviesService.register()`, not in the resolver. The
resolver's job in `048` was to police a user's choice; there is no choice any more, so the resolver
loses both guards and `MediaResolver` stops importing `MEDIA_TYPE`, `i18nError` and `ERROR_KEYS`
entirely. `register()` is where the `movie.create` happens and therefore where `isShort` is decided.
`MoviesService` gains one dependency, `MediaCapabilitiesService` — already exported by
`MediaCapabilitiesModule`, which `MoviesModule` **already imports** for `MoviesResolver`, so there is
no new module wiring and no circular dependency.

Runtime resolution reuses the three pieces that already exist in `movies.service.ts` rather than
adding a fourth: `cacheKey(tmdbId)` for the key, `cacheMovies(results)` for the best-effort TTL write,
and `TmdbClient.details()` for the fetch. The field goes on `MediaSearchResult` in
`src/clients/types.ts` — the *internal* interface, which is a different type from the `@ObjectType`
of the same name in `src/media/entities/`. That distinction is the whole reason `runtime` can live on
the shared cache object without reaching the schema.

`getCachedMovie()` grows one branch. It already has two paths — a Redis hit and a cold
`fetchMovieFromTMDB()` fallback — and the cold one maps from `MovieDetail`, which carries `runtime`
for free. So only the warm path needs a top-up, and only when the derivation will actually consume it:

1. `fetchMovieFromTMDB()` includes `runtime` in the object it builds, and `getCachedMovie()` writes
   that object back through `cacheMovies()` (it does not today), so a cold registration populates
   the cache complete.
2. A warm entry written by a search carries no `runtime`. `deriveIsShort()` asks
   `MediaCapabilitiesService.isShortsEnabled()` **first** and returns `false` without any HTTP when
   shorts are off — a TMDB call whose only consumer is a flag that will be `false` is a call this
   feature must not make. Only when shorts are on does it call `TmdbClient.details()`, write the
   enriched object back through `cacheMovies()`, and classify.

The failure branch is deliberately asymmetric: a TMDB error while topping up a runtime is swallowed
and classifies as not-a-short (NFR-2), and **nothing is written back** — caching a `runtime: null`
produced by an outage would pin that answer for 24 hours. A TMDB error on the *cold* path keeps
throwing `error.movie.not_in_catalog` exactly as today, because there the catalog is the source of
the title itself, not of a decoration.

The 40-minute boundary is a module-level constant with a module-level predicate beside it, following
`sanitizeTag`/`movieTags` at the top of the same file. The predicate is where REQ-5 lives: a
`runtime` that is `undefined`, `null` or `0` is not a duration, and the comparison is strict `<`, so
exactly 40 is a feature film.

## Order of Work

**`web` goes first, and this is the opposite of this repository's usual order.** The template's
default — `api` first, consumers after — is right for an *addition*: a consumer cannot select a field
the schema does not have yet. This feature is a *removal*, and a removal inverts it. `web`'s
`ADD_MEDIA_MUTATION` declares `$asShort: Boolean` in its document text; the moment `api` drops the
argument, that document fails GraphQL validation and **every** add button on every search screen
stops working, films and series alike. Patching `web` first costs nothing: `asShort` is optional, so
an `api` that still accepts it is perfectly happy to be sent nothing.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `web` | Stops sending `asShort` while `api` still accepts it. The reverse order breaks every add mutation in the window between the two. |
| 2 | `api` | Removes the argument only once nothing sends it, and adds the derivation that replaces it. |

**Do not run these in parallel.** The contract is frozen, so parallel work would not *diverge* — but
the running dev stack is broken for the whole overlap, and the manual pass in § Verification cannot
be done from a stack whose add button is throwing. The two slices are small; sequence them.

Within step 2, `api`'s own work has an internal order: the contract removal (resolver, interface,
error key) before the derivation (`MoviesService`), because the derivation's tests are written
against a `register()` whose signature has already lost its `options` parameter.

## Contract Freeze

`spec.md`'s `## GraphQL Contract Delta` is frozen as of `status: Approved`. Things an implementer
will want to change and must not:

- **`MediaSearchResult.runtime` does not exist in GraphQL.** `runtime` is added to the interface in
  `services/api/src/clients/types.ts` and to nothing else. It must not gain a `@Field()` on
  `src/media/entities/media-search-result.entity.ts`. Two different types share that name; only the
  first one is a cache shape. Exposing it would be a contract change nobody announced, and `web` has
  no use for it — a duration per search result is exactly what NFR-1 forbids paying for.
- **`assertShortsEnabled()` stays.** It leaves `addMedia` and stays on `setMovieShort`
  (`MoviesResolver`), unchanged, along with `error.media.shorts_disabled`. Only
  `error.media.shorts_not_a_movie` is retired.
- **`shortsEnabled` keeps being threaded into `SearchContainer` and `MultiSearchResults`.** It no
  longer gates a button; it still gates `showShortBadge` (REQ-2). Removing the prop is a silent
  regression — the badge simply stops rendering and nothing fails.
- **`MediaCapabilities` is untouched.** No new capability, no new Settings row. The 40-minute
  threshold is a constant (NFR-3).

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief both services.
Never patch it from inside one slice (Constitution, Article VIII).

## Migrations

**None.** `Movie.isShort Boolean @default(false)` already exists from `048-shorts-category`, with the
right type and the right default. Nothing is backfilled (NFR-6): a film registered before this
feature keeps whatever flag it has.

`git status --short services/api/prisma` must be **empty** when this feature closes. A migration
directory appearing there means someone misread the spec.

Reversibility: nothing to roll back at the schema level. Reverting the code reverts the feature.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `shortsEnabled` pulled out of `SearchContainer`/`MultiSearchResults` along with the button | The short badge silently stops rendering on every search result. No error, no typecheck failure — the prop just defaults to `false` and `showShortBadge` goes off | Called out in § Contract Freeze and in `web/plan.md` § Scope; AC-1 checks the button is gone, AC-2 checks the badge is still there |
| `runtime` added to the GraphQL entity as well as the interface | The schema grows a field nobody asked for; `schema.gql` stops matching the frozen delta (Article VIII's check) | `api/plan.md` names the one file that changes; the `schema.gql` diff is part of § Verification |
| `isShort` written onto the cached object | 048's rule breaks: one installation's derived flag lands in the Redis key every user reads for 24h | `movies.service.spec.ts:169` already asserts `expect(cached).not.toHaveProperty('isShort')` — it must stay green, not be adjusted |
| Off-by-one on the threshold | A 40-minute film files under `path_shorts`. Nothing fails; the file is simply in the wrong folder, and 048 guarantees it is never moved back | A boundary case at exactly 40 is owed a test (`api/plan.md` § Tests) |
| A later search overwrites a runtime-carrying cache entry | `cacheMovies()` is also called by `cacheAndEnrich()` with search rows that have no `runtime`, so the field can be wiped before the TTL expires | **Accepted.** The cost is one extra detail call on a future first registration, and a film registered once never re-derives (REQ-7). Not worth a read-before-write per search result |
| Runtime fetched even with shorts disabled | A TMDB call per registration whose result is discarded. Silent — registration succeeds either way | `deriveIsShort()` checks the capability before it fetches; `api/plan.md` § Steps fixes that order |
| A failed top-up cached as `runtime: null` | A transient TMDB outage pins "not a short" for the film for 24h | The write-back is on the success branch only; the failure branch returns the cached object untouched |
| `asShort` left in `web`'s mutation document after `api` drops it | Every add mutation fails GraphQL validation at runtime. No codegen, so nothing catches it at compile time | The order of work above, plus AC-11's `grep -rn 'asShort'` over both `src` trees |

## Verification

```bash
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/npm web run build
bin/cli api npx --no tsc --noEmit
bin/npm api test
git status --short services/api/prisma
grep -rn 'asShort\|shorts_not_a_movie' services/api/src services/web/src
```

Expected: 0 typecheck errors in both services, `check-messages.mjs` and `build` exit 0, `bin/npm api
test` green with no suite count regression against `services/api/CLAUDE.md` § Current state,
`git status` on `prisma` **empty**, and the final `grep` returning **nothing** (exit 1).

Also diff the generated schema — Article VIII's own check:

```bash
git diff services/api/src/schema.gql
```

Expected: exactly one hunk, `addMedia` losing `asShort: Boolean`. Anything else is an unreported
contract change.

Manual pass, with shorts **enabled** in Settings:

1. `/search` and `/movies/add` — search any film. One action per card, no "Agregar como corto"
   anywhere (AC-1). A film already registered as a short still shows its badge (AC-2).
2. Register a short (pick one and confirm its runtime on TMDB first) → it lands in `/shorts`, not
   `/movies`. `bin/mysql -e 'select tmdbId, isShort from movies order by id desc limit 5'` confirms
   (AC-2).
3. Register a feature film → `/movies`, `isShort = 0` (AC-3).
4. `bin/cli redis redis-cli get tmdb:movie:<T>` shows a `runtime` field (AC-4).
5. Turn shorts **off** in Settings, register a short → `isShort = 0`. Turn them back on → still `0`
   until flipped from the film's detail page (AC-8).
6. `mutation { addMedia(tmdbId: <T>, type: "movie", asShort: true) { id } }` from the playground →
   unknown-argument validation error, no row created (AC-6).

AC-5 (TMDB unreachable during the top-up) is not reproducible by clicking; it is covered by a unit
test in `api/plan.md` § Tests instead.

---
title: Shorts classified by runtime
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-14
last_updated: 2026-09-14
status: Implemented
services: [api, web]
---

# SPEC: Shorts classified by runtime (`spec.md`)

## Context & Goal

`048-shorts-category` made "is this film a short?" a question the user answers twice, in two
different places, and the first of the two is the wrong place. A search result for a film renders a
second button beside "Agregar" — "Agregar como corto" (`services/web/src/components/search/MediaResultAction.tsx`,
threaded down through `SearchContainer.tsx`, `MultiSearchResults.tsx` and `src/actions/media.ts`) —
which reaches `api` as `addMedia(tmdbId:, type:, asShort:)` and lands in
`MoviesService.register(..., { asShort })`. The user is being asked to classify a title from a
poster, a year and an overview, at the one moment they know least about it, and 048 itself records
why the UI cannot help: TMDB's search endpoints carry no `runtime`, so the badge beside a result
only ever reflects what somebody already registered. The second place — the toggle on the film's own
detail page, `setMovieShort` — is the right one, and is where a user actually has the film in front
of them.

So the affordance comes out of search, and the initial value stops being a user decision at all: it
is derived from the duration TMDB reports. Under 40 minutes is a short. The user never has to think
about it at registration time, and can still correct any of it later from the film's page, which
after this feature is the only place the flag is set by hand. `addMedia(asShort:)` leaves the
contract with it, and so does `error.media.shorts_not_a_movie`, an error that existed only to guard
that argument.

The duration itself has to be fetched, because the shape written to the shared Redis key
`tmdb:movie:<id>` (24h TTL, `MoviesService.cacheKey`) comes from TMDB's *search* response and has no
runtime in it. `TmdbClient.details()` already returns one (`MovieDetail.runtime`), so registration
resolves it there — one detail call for the one film being registered, cached back into that same
Redis entry so a second registration of the same film inside the TTL never asks again. Fetching a
runtime per *search result* is the thing this must not do: a page of twenty results would become
twenty-one TMDB calls for a catalog most of which nobody will register.

This touches two rows of the root `CLAUDE.md` pipeline table — **Search catalog (TMDB)**, which
loses the `addMedia(asShort:)` registration path and its badge-adjacent button, and **Register title
in DB**, where `isShort` gains a derivation. Nothing downstream of registration changes: the
destination is still resolved once by `ProcessJobsService.getEncodeJobDetails` reading `movie.isShort`,
and `worker` still cannot tell a short from a feature film.

## Requirements

### Functional Requirements

- [x] **REQ-1 (One add button)**: A film in any search result list must offer exactly one
      registration action. The "add as short" affordance must be gone from every screen that renders
      a search result — `/search`, `/movies/add` and `/shows/add` alike.
- [x] **REQ-2 (Badge survives)**: A search result for a film already registered as a short must keep
      rendering its short badge, unchanged. The badge reports what is registered; it was never the
      affordance.
- [x] **REQ-3 (`asShort` leaves the contract)**: `addMedia` must no longer accept an `asShort`
      argument. A caller that sends one must be refused by GraphQL's own argument validation, not by
      a hand-written guard.
- [x] **REQ-4 (Derived at registration)**: Registering a film not already in the database must set
      `isShort` from the runtime TMDB reports for it: strictly under 40 minutes is a short,
      40 minutes or more is not.
- [x] **REQ-5 (Unknown duration never classifies)**: A runtime that is absent, `null` or `0` — what
      TMDB returns for a title it has no duration for — must register as **not** a short. An unknown
      duration is never treated as a short duration.
- [x] **REQ-6 (Runtime is cached)**: The runtime resolved for a film must be written into that
      film's existing `tmdb:movie:<id>` Redis entry, under its existing TTL, so a subsequent
      registration of the same film within the TTL resolves the runtime without a TMDB call. An
      entry already cached by a search — which carries no runtime — must trigger the fetch and be
      rewritten with the runtime included.
- [x] **REQ-7 (Already-registered films are untouched)**: Registering a film that is already in the
      database must leave its stored `isShort` exactly as it is, derivation included. This is 048's
      REQ-6 restated: the detail-page toggle is the only thing that reclassifies a registered film.
- [x] **REQ-8 (Shorts off means no classification)**: While `shortsEnabled` — 048's effective
      capability, `movies_enabled && shorts_enabled` — is false, registration must store
      `isShort: false` regardless of runtime. No retroactive pass runs when the capability is later
      turned on; a film registered during that window is corrected from its own detail page.
- [x] **REQ-9 (Manual toggle unchanged)**: `setMovieShort` must keep its current behaviour,
      signature, guard order and error keys. The derivation produces an initial value only, and
      never runs again over a film a user has reclassified.
- [x] **REQ-10 (Dead error key removed)**: `error.media.shorts_not_a_movie` must be removed from
      `api`'s error keys and English messages and from both `web` message catalogs, since the only
      condition that raised it is gone.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (One TMDB call per registration, never per result)**: Resolving the runtime must cost
      at most one additional TMDB request, made only when a film is actually registered and only on
      a cache miss for its runtime. No search, popular-list or billboard render may gain a TMDB call.
- [x] **NFR-2 (A missing runtime never fails a registration)**: If the runtime cannot be resolved —
      TMDB unreachable, rate-limited, or answering without the field — and the film's catalog data is
      otherwise available, registration must still succeed, as not-a-short (REQ-5). Classification is
      a convenience; it must never be the reason a title fails to register. The existing failure
      where the catalog knows nothing about the `tmdbId` at all is unchanged and still surfaces
      `error.movie.not_in_catalog`.
- [x] **NFR-3 (Threshold is a constant)**: The 40-minute boundary lives in code as a single named
      constant, not as a Settings row and not as a per-user value. The fine-grained decision is
      per-film, from that film's detail page.
- [x] **NFR-4 (Cache shape stays catalog-only)**: `runtime` is a property of the film as the catalog
      describes it, so it may live on the shared `tmdb:movie:<id>` object. `isShort` must **not** —
      048's rule that the derived, per-installation flag never enters the shared cache stands.
- [x] **NFR-5 (No worker change)**: `worker` is untouched. `EncodeJobDetails.outputRoot` is already a
      resolved string by the time the worker sees it.
- [x] **NFR-6 (No migration)**: `Movie.isShort` already exists with the right type and default. No
      Prisma migration, and no backfill of films registered before this feature — their flag stays
      whatever it is.

## GraphQL Contract Delta

One argument is removed. Nothing is added.

```graphql
type Mutation {
  addMedia(tmdbId: Int!, type: String!): MediaRef!
}
```

Everything else 048 declared is unchanged and stays as written in
`docs/spec/graphql-contract.md` § "Shorts are a flag on `Movie`, not a third media type":
`MediaCapabilities.shortsEnabled`, `Movie.isShort`, `MediaSearchResult.isShort`,
`movies(isShort: Boolean)` and `setMovieShort(movieId:, isShort:)` all keep their current shape and
semantics.

`addMedia` keeps both remaining guards in their current order — `assertEnabled(type)` first, and
nothing else in the resolver. `assertShortsEnabled()` no longer runs there at all: registration can
no longer be *asked* for a short, so there is nothing for it to refuse. The capability is still
consulted during registration (REQ-8), but as a branch, never as a throw.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `addMedia(asShort: …)` from an unpatched consumer | GraphQL validation: `Unknown argument "asShort" on field "Mutation.addMedia"` (400) | Not user-facing — no `web` screen sends it after this feature |
| `addMedia` for a disabled type | `error.media.type_disabled` (403, existing) | `Las películas están deshabilitadas en este sistema` (existing copy) |
| `addMedia` for a `tmdbId` the catalog does not know | `error.movie.not_in_catalog` (404, existing) | existing copy, unchanged |
| Runtime lookup fails for an otherwise-resolvable film | **none** — registration succeeds as not-a-short (NFR-2) | none |
| `setMovieShort` while shorts are not effectively enabled | `error.media.shorts_disabled` (403, existing) | `Los cortos están deshabilitados en este sistema` (existing copy) |
| `setMovieShort` for a film id the caller does not own, or that does not exist | `error.movie.not_found` (404, existing) | existing copy, unchanged |

`error.media.shorts_not_a_movie` is **retired** (REQ-10). It had exactly one raise site, the
`asShort && type !== 'movie'` guard in `MediaResolver.addMedia`, which this feature deletes.

Consumer obligations: `web` drops `asShort` from its `AddMedia` mutation document and from the
`addMedia` server action's signature, and stops threading `shortsEnabled` into `MediaResultAction`
for the purpose of offering the extra button. `web` keeps reading `capabilities.shortsEnabled` for
everything else 048 gave it — the sidebar entry, the `/movies` ↔ `/shorts` split, the search badge
and the detail-page toggle. `worker` has no obligation and no change.

## Data Model Changes

**None.** `Movie.isShort Boolean @default(false)` already exists from `048-shorts-category`; this
feature only changes what writes it at registration. No migration, no backfill (NFR-6).

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| — | none | — | no |

## Acceptance Criteria

- [x] **AC-1**: Given shorts are enabled, when a user searches any film from `/search`, `/movies/add`
      or `/shows/add`, then each result card renders exactly one action — "Agregar", or "Ir" for a
      title already in the library — and no "Agregar como corto" button appears anywhere.
- [x] **AC-2**: Given shorts are enabled and a film TMDB reports under 40 minutes (any short; call
      its id `<T>`, confirm the runtime on TMDB first) is not yet registered, when the user registers
      it from a search result, then
      `bin/mysql -e 'select tmdbId, isShort from movies where tmdbId=<T>'` shows `isShort = 1`, the
      film appears under `/shorts`, and it does **not** appear under `/movies`.
- [x] **AC-3**: Given the same conditions and a feature-length film (for example tmdbId 27205,
      runtime 148), when the user registers it, then its row shows `isShort = 0` and it appears
      under `/movies`, not `/shorts`.
- [x] **AC-4**: After AC-2, `bin/cli redis redis-cli get tmdb:movie:<T>` returns a JSON object
      containing a `runtime` field, and registering the same film again (from a second user's
      account) produces no further TMDB request for it.
- [x] **AC-5** *(failure path)*: Given a film whose Redis entry exists from a search but carries no
      runtime, and TMDB is unreachable when the runtime fetch is attempted, when the user registers
      that film, then registration **succeeds**, the film is stored with `isShort = 0`, and no error
      reaches the UI.
- [x] **AC-6** *(failure path)*: Sending `mutation { addMedia(tmdbId: <T>, type: "movie", asShort: true) { id } }`
      against `api` returns a GraphQL validation error naming `asShort` as an unknown argument, and
      creates no row.
- [x] **AC-7**: Given a film TMDB reports with `runtime: 0` or no runtime at all (an unreleased
      title), when the user registers it, then its row shows `isShort = 0`.
- [x] **AC-8**: Given shorts are **disabled** in Settings, when the user registers a 28-minute film,
      then its row shows `isShort = 0`; and after an administrator enables shorts, that film is still
      `isShort = 0` until a user flips it from the film's own detail page.
- [x] **AC-9**: Given a film already registered with `isShort = 1` and a runtime of 148 minutes
      (reclassified by hand), when another user registers the same film, then the row still shows
      `isShort = 1` — the derivation does not run over it.
- [x] **AC-10**: `bin/cli web node scripts/check-messages.mjs` exits 0 — `shorts_not_a_movie` is gone
      from both `en` and `es` with no drift between them.
- [x] **AC-11**: `bin/npm api run test` and `bin/npm web run build` both exit 0, and neither
      `services/api/src` nor `services/web/src` still mentions `asShort` or `shorts_not_a_movie`
      (`grep -rn 'asShort\|shorts_not_a_movie' services/{api,web}/src` returns nothing).

## Out of Scope

- **A configurable threshold.** 40 minutes is a constant (NFR-3). Making it a Setting invites an
  installation-wide number to be tuned for one film, when the per-film toggle already does that job
  precisely. If it ever needs to move, it moves in one place.
- **Backfilling films registered before this feature.** Their `isShort` stays as-is (NFR-6). A sweep
  that reclassified an existing library would silently move nothing (048: flipping the flag is never
  a file move) while overwriting deliberate manual choices — strictly worse than leaving them alone.
- **Re-deriving on a later registration or on a scheduled refresh.** The derivation produces an
  initial value once, at first registration, and never runs again (REQ-7, REQ-9). Teaching
  `scheduler/`'s refresh tasks to revisit runtimes would put an automatic writer in permanent
  competition with the user's own toggle.
- **A runtime on `MediaSearchResult`.** Exposing duration in search results would require a detail
  call per result, which NFR-1 exists to forbid. The badge on a result keeps meaning "already
  registered as a short", exactly as 048 defined it.
- **Shorts for series.** `isShort` is a film-only flag; nothing here changes that, and with
  `addMedia(asShort:)` gone there is no longer even a way to ask for it wrongly.
- **`worker` and the output path.** Untouched (NFR-5). Where a short is filed is still 048's
  decision, made once in `getEncodeJobDetails`.

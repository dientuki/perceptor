---
title: Shorts classified by runtime — Tasks
last_updated: 2026-09-14
status: Done
---

# TASKS: Shorts classified by runtime (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**The group order below is deliberately the reverse of this repository's usual one.** This feature
*removes* a GraphQL argument, and a removal inverts the normal `api`-then-consumers sequence:
`web`'s mutation document declares `$asShort: Boolean`, so the moment `api` drops the argument that
document fails validation and every add button on every search screen breaks. `web` goes first, while
`api` still accepts an argument nobody sends. See `plan.md` § Order of Work.

There is **no `[worker]` task and no `[infra]` task**: no pipeline stage changes and nothing about
how the stack boots changes. There is also **no migration task** — `Movie.isShort` already exists.

## Tasks

### Group 1 — `web` stops sending `asShort`

- [x] **T001** `[web]` Remove the "add as short" affordance from the three search components:
      `src/components/search/MediaResultAction.tsx` (drop the `shortsEnabled` / `addingShort` /
      `onAddAsShort` props, the `showAddAsShort` const and the second `<Button>`; restore the
      pre-`048` single-button shape, `git show 1a1305c~1` on that path), and
      `src/components/search/SearchContainer.tsx` + `src/components/search/MultiSearchResults.tsx`
      (drop `addingShortId` and `handleAddAsShort`, fold `addItem` back into `handleAdd`, narrow
      `SearchContainer`'s `addAction` prop type to two parameters).
      **Do not remove the `shortsEnabled` prop from either container** — it still feeds
      `MediaList`'s `showShortBadge` (`spec.md` REQ-2), and removing it drops the short badge with
      no error anywhere.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors, and
      `grep -rn 'onAddAsShort\|addingShort\|showAddAsShort' services/web/src` returns nothing while
      `grep -rn 'showShortBadge' services/web/src` still returns its three call sites.

- [x] **T002** `[web]` Drop `asShort` from `src/actions/media.ts` — `ADD_MEDIA_MUTATION` loses the
      `$asShort: Boolean` variable and the argument, `addMedia` loses its third parameter — and
      remove `search.container.addShortButton`, `search.container.addingShort` and
      `errors.media.shorts_not_a_movie` from both `messages/en.json` and `messages/es.json` in the
      same edit. Leave `errors.media.shorts_disabled` in place; `setMovieShort` still raises it.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors,
      `bin/cli web node scripts/check-messages.mjs` exits 0 with no drift, `bin/npm web run build`
      exits 0, and `grep -rn 'asShort\|shorts_not_a_movie' services/web/src services/web/messages`
      returns nothing. → T001

### Group 2 — `api` removes the argument

Depends on Group 1: the argument can only be removed once nothing sends it.

- [x] **T003** `[api]` Remove `addMedia(asShort:)` and everything that existed only to guard it —
      `src/media/media.resolver.ts` (the `@Args('asShort')` parameter, both guards, the REQ-14
      comment, and the `MEDIA_TYPE` / `i18nError` / `ERROR_KEYS` imports that become unused);
      `src/media/media-type.interface.ts` (`register(tmdbId, userId)`, its `options` parameter and
      comment block deleted); `src/i18n/error-keys.ts` and `src/i18n/messages.en.ts`
      (`MEDIA_SHORTS_NOT_A_MOVIE` and its English rendering). Update
      `src/media/media.resolver.spec.ts`: delete the whole `addMedia(asShort:) guards` suite with
      its header comment, and drop `{ asShort: undefined }` from the two surviving
      `toHaveBeenCalledWith` assertions. Leave `MEDIA_SHORTS_DISABLED`, `assertShortsEnabled()` and
      `setMovieShort` untouched.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, `bin/npm api test` is
      green, and after a boot `git diff services/api/src/schema.gql` shows exactly one hunk —
      `addMedia` losing `asShort: Boolean`. → T002

### Group 3 — `api` derives `isShort` from the runtime

- [x] **T004** `[api]` Put the runtime on the cache shape. Add `runtime?: number | null` to the
      `MediaSearchResult` interface in `src/clients/types.ts` — that file only; the `@ObjectType`
      of the same name in `src/media/entities/` must **not** gain a `@Field()`. In
      `src/movies/movies.service.ts`, have `fetchMovieFromTMDB()` include
      `runtime: detail.runtime ?? null`, and have `getCachedMovie()`'s Redis-miss branch pass the
      fetched object through `void this.cacheMovies([...])` before returning it, so a cold
      registration leaves the cache populated. Reuse `cacheKey()` and `cacheMovies()` — no second
      Redis key, no direct `redis.set`.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, `bin/npm api test` is
      green (including the existing `TMDB fallback (cold Redis cache)` suite), `git diff
      services/api/src/schema.gql` is unchanged from T003, and registering a film whose Redis key
      was empty leaves `bin/cli redis redis-cli get tmdb:movie:<T>` showing a `runtime` field. → T003

- [x] **T005** `[api]` Derive the flag in `src/movies/movies.service.ts`: a module-level
      `SHORT_MAX_RUNTIME_MINUTES = 40` and a pure predicate beside `sanitizeTag`/`movieTags` that
      is true only for a real number `> 0` and strictly `< 40`; inject `MediaCapabilitiesService`
      into the constructor; add a private `deriveIsShort(cached)` that checks
      `isShortsEnabled()` **before** any HTTP, classifies from `cached.runtime` when it is already a
      number, and otherwise calls `TmdbClient.details()` inside a `try` — writing the enriched
      object back through `cacheMovies()` on success and, on failure, returning `false` while
      writing **nothing**. `register()` drops its `options` parameter and takes `isShort` from
      `deriveIsShort(cached)`; its already-registered early-return branch stays exactly as it is and
      must not call `deriveIsShort` at all (`spec.md` REQ-7).
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, and with shorts enabled,
      registering a film TMDB reports under 40 minutes gives `isShort = 1` in
      `bin/mysql -e 'select tmdbId, isShort from movies order by id desc limit 5'` while a
      feature-length film gives `0`. → T004

- [x] **T006** `[api]` Add the derivation's test cases to `src/movies/movies.service.spec.ts` under
      a `describe('register (short classification)')`, plus the `MediaCapabilitiesService` mock in
      the `let` block, `beforeEach` and `providers` array (follow the `mediaServerReconcile` entry
      directly above it), and one new bullet on the file's existing header comment. The cases owed
      are listed in `api/plan.md` § Tests: the 40-minute boundary, `0`/`null`/absent runtimes, shorts
      disabled meaning **both** `isShort: false` and no `tmdb.details` call, a warm cache entry
      without a runtime triggering exactly one call plus a write-back, a cached runtime triggering
      none, a rejecting `tmdb.details` still registering the film with nothing written to Redis, and
      an already-registered film never reaching the derivation. Each case must be verified to fail
      when the rule it covers is removed. The existing
      `expect(cached).not.toHaveProperty('isShort')` assertion must stay green **unmodified**.
      *Done when:* `bin/npm api test` is green with a suite/test count above
      `services/api/CLAUDE.md` § Current state, and
      `grep -rn 'asShort\|shorts_not_a_movie' services/api/src` returns nothing. → T005

### Group 4 — docs and verification

T007, T008 and T009 are independent of each other and touch three different files.

- [x] **T007** `[docs] [P]` Amend `docs/spec/graphql-contract.md` § "Shorts are a flag on `Movie`,
      not a third media type (`048-shorts-category`)": the SDL block's `addMedia` loses
      `asShort: Boolean`, the "**`addMedia(asShort:)` keeps registration atomic**" paragraph is
      replaced by one describing the runtime derivation and its capability gate, the
      `error.media.shorts_not_a_movie` row leaves the error table (and the `addMedia(asShort: true)`
      half leaves the `shorts_disabled` row), and the consumer-obligations paragraph drops "the
      'add as short' affordance" from the list `web` gates on `shortsEnabled` while keeping the
      badge. Note the amendment as `056-shorts-runtime-classification` in the section, the way other
      sections cite the feature that changed them. → T006

- [x] **T008** `[docs] [P]` Update `services/api/CLAUDE.md`'s module map (lines ~153–157): the
      `addMedia` optional-`asShort` sentence, its three-step guard order and the
      `options?: { asShort?: boolean }` register signature are all wrong after this feature. Replace
      with the derivation — `MoviesService.register()` reads `MediaCapabilitiesService.isShortsEnabled()`
      first, then the runtime off the `tmdb:movie:<id>` cache entry (topping it up from
      `TmdbClient.details()` once, best-effort), and classifies under
      `SHORT_MAX_RUNTIME_MINUTES`. Keep everything about `setMovieShort`, `shortsEnabled` and
      `error.media.shorts_disabled` as-is. → T006

- [x] **T009** `[docs] [P]` Update the root `CLAUDE.md` pipeline table: the **Search catalog (TMDB)**
      row loses "and a search result can be registered directly into the new 'Cortos' category via
      `addMedia(asShort:)`", and the **Register title in DB** row's "set at registration via
      `addMedia(asShort:)` or later from the film's own detail page" becomes the runtime derivation
      (under 40 minutes, from a TMDB detail call made once per registration and cached, skipped
      entirely when shorts are disabled) with `setMovieShort` as the only manual control. Add `056`
      to both rows' spec-ref column. The "never inferred" phrasing in the Search row is now false for
      registration and must go; the badge itself is still never inferred. → T006

- [x] **T010** `[docs]` Walk every acceptance criterion in `spec.md` against the running stack —
      including the manual pass in `plan.md` § Verification and the full command block there — tick
      each box, append the measured numbers to `services/api/CLAUDE.md` and `services/web/CLAUDE.md`
      § Current state (`services/web/CLAUDE.md` needs no other edit: it never documented the shorts
      affordance) and to the root `CLAUDE.md` § Current state, and set `status: Implemented` on
      `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`.
      *Done when:* all eleven AC boxes are ticked, `git status --short services/api/prisma` is
      empty, and `grep -rn 'asShort\|shorts_not_a_movie' services/api/src services/web/src` returns
      nothing. → T007, T008, T009

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

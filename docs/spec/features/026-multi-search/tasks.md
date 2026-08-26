---
title: Multi Search — Tasks
last_updated: 2026-08-26
status: In Progress
---

# TASKS: Multi Search (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

Each agent reads `spec.md`, `plan.md` and its own `<svc>/plan.md` before starting. The GraphQL delta
in `spec.md` is frozen (Constitution, Article VIII): an agent that finds it wrong stops and reports
into § Blocked rather than adapting it locally.

## Tasks

### Group 1 — the catalog adapter

- [ ] **T001** `[api]` Add the raw `search/multi` row shape to
      `services/api/src/clients/tmdb/types.ts`, then write `services/api/src/clients/tmdb/multi.ts`:
      one exported pure function mapping raw rows to `MediaSearchResult[]` (the `@/clients/types`
      catalog-only interface), keyed by `media_type` — `movie` reads `title`/`release_date`, `tv`
      reads `name`/`first_air_date` and becomes `MEDIA_TYPE.SHOW`. Everything else is dropped, as is
      any row with no usable title. Posters through the existing exported `posterUrl()`.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports the same error count as before the
      task, and the function is exported from a file that imports nothing from `src/media/`,
      `src/movies/` or `src/shows/`.

- [ ] **T002** `[api]` Write `services/api/src/clients/tmdb/multi.spec.ts`, structured like
      `src/clients/torrent/magnet.spec.ts`: a header comment naming the silent failure it defends
      against, English `it(...)` strings, each case verified to fail when the rule it covers is
      removed. Cover a film row, a series row (`type === "show"`, not `"tv"`), a `person` row
      dropped, an unknown future `media_type` dropped, a titleless row dropped, catalog order
      preserved across survivors, and a null `poster_path` yielding `posterUrl === null`. → T001
      *Done when:* `bin/npm api test` is green with these cases added to the previous total.

- [ ] **T003** `[api]` Add `searchMulti(query, page?)` to `services/api/src/clients/tmdb/client.ts`,
      built on the existing private `fetchPage` against `search/multi` and returning T001's mapper
      output. The TMDB reference URL is the only comment owed (Article XI, exception 1). Do not
      touch `search()`, `details()` or `seasonDetails()`. → T001
      *Done when:* typecheck error count unchanged, and `git diff` on `client.ts` shows exactly one
      added method plus one import.

### Group 2 — the per-type seam

- [ ] **T004** `[api]` Widen `services/api/src/media/media-type.interface.ts` with a third method,
      `cacheAndEnrich(results, userId)`, and implement it in **both**
      `services/api/src/movies/movies.service.ts` and `services/api/src/shows/shows.service.ts` by
      **moving** steps 3–4 of each `search()` into it — the best-effort cache write first, the
      ownership enrichment second, with the existing comments explaining why that order is
      load-bearing. Each `search()` then ends in `return this.cacheAndEnrich(results, userId)`.
      Nothing else in either file changes; the two services are **not** factored into a shared base
      class (`006-media-search` § Out of Scope).
      *Done when:* `bin/npm api test` is green with **no** change to
      `movies.service.spec.ts`/`shows.service.spec.ts` — both already assert the ordering through
      `search()`, and their passing unmodified is the proof the extraction preserved it.

### Group 3 — the fan-out

Depends on the adapter (Group 1) and the seam (Group 2) both existing.

- [ ] **T005** `[api]` Add `services/api/src/media/media-search.service.ts` with one public method:
      blank/whitespace query returns `[]` before contacting the catalog; one `tmdb.searchMulti()`;
      group rows by `type`; one `MediaDispatchService.resolve(type).cacheAndEnrich(group, userId)`
      per group present; then rebuild the response by walking the **original** ordered rows, looking
      each up by the composite key `${type}:${id}` — never the bare id, which collides across types.
      Then add the `searchAllMedia` query to `services/api/src/media/media.resolver.ts`, mirroring
      `searchMedia`'s auth exactly (no `@AllowService()`, principal narrowed to `'user'`), and wire
      `services/api/src/media/media.module.ts` — import `SettingsModule` (it exports `TmdbClient`),
      provide the new service. `media-dispatch.service.ts` gains nothing. → T003, T004
      *Done when:* the api boots and `src/schema.gql` regenerates with `searchAllMedia(query:
      String!): [MediaSearchResult!]!` added and **no other line changed**; a live query returns
      films and series in one list.

- [ ] **T006** `[api]` Write `services/api/src/media/media-search.service.spec.ts` with the Article
      IX header comment. Five cases: (1) cache-before-enrich over a **mixed** set — assert on what is
      handed to each service to cache, and that neither cached object carries `inLibrary` or
      `mediaId`; (2) catalog order survives regrouping (film, series, film comes back in that order);
      (3) cross-type id collision — film `42` and series `42` in one response, only one owned by the
      caller, ownership lands on the right card; (4) caller scoping over a mixed set — another user's
      film and series report `inLibrary: false` with a non-null `mediaId`; (5) a blank query returns
      `[]` and the TMDB mock is never called. → T005
      *Done when:* `bin/npm api test` is green, and each case is verified to fail when the rule it
      covers is removed (fault injection, `services/api/CLAUDE.md` § Tests).

### Group 4 — the consumer

Everything here depends on Group 3: the query must exist before `web` can call it. Within the group
the order is real — the shared action component and the badge both land in files the results screen
then consumes, and three of these tasks touch `messages/{en,es}.json`, so they do not overlap.

- [ ] **T007** `[web] [P]` Add `searchAllMedia(query)` to `services/web/src/actions/media.ts`,
      third export in the existing shape: `'use server'`, a module-level `SEARCH_ALL_MEDIA_QUERY`,
      `fetchGraphQL<T>`, `redirectIfUnauthenticated` then `translateGraphQLError`. Select **exactly**
      the fields `SEARCH_MEDIA_QUERY` selects. Short-circuit a blank query to `[]` before the round
      trip. → T005
      *Done when:* `bin/cli web npx --no tsc --noEmit` stays at 0 errors and the action returns rows
      of both types against the running api.

- [ ] **T008** `[web] [P]` Extract `SearchContainer.tsx`'s `renderAction` body into
      `services/web/src/components/search/MediaResultAction.tsx` (client component: item, owned
      state, in-flight state, `onAdd`), and render it from `SearchContainer`. The owned branch is now
      one shape for both types — an `Ir` link to `/movies/<id>` or `/shows/<id>` — so the
      non-interactive `Agregada` badge for series is **deleted**, not kept as a fallback. `errorAdd`'s
      noun follows the item's own type. Remove the now-unreferenced `search.container.added` key from
      both `services/web/messages/en.json` and `es.json`. Preserve the rest of `SearchContainer`
      exactly: the form, the search state, the placeholder/empty-state nouns, `owned = inLibrary ||
      addedThisSession` (**never** `mediaId !== null`), and no navigation after a successful add.
      *Done when:* on `/shows/add`, a series already in the caller's library renders `Ir` linking to
      `/shows/<id>` and the link resolves (AC-9); `/movies/add` behaves exactly as before;
      `bin/cli web node scripts/check-messages.mjs` exits 0 and `grep -rn "container.added"
      services/web/src` returns nothing.

- [ ] **T009** `[web]` Add the type badge to `services/web/src/components/media/MediaCard.tsx`,
      rendered only when asked for, threaded as an opt-in flag through
      `services/web/src/components/media/MediaList.tsx` and defaulting **off**. Absolutely positioned
      top-left over the poster, above the image in stacking order, opaque pill, uppercase,
      `text-white`; `bg-brand-500` for a film and `bg-purple-500` for a series. It reads `item.type`,
      not the `mediaType` prop — on a mixed grid that prop is one value for cards of two kinds. Text
      from new catalog keys in both message files (`MOVIE`/`SERIES`, `PELÍCULA`/`SERIE`); no literal,
      and no new Tailwind theme token. → T008
      *Done when:* `/movies`, `/shows`, `/movies/add` and `/shows/add` render with **no** badge, and
      `bin/cli web node scripts/check-messages.mjs` exits 0.

- [ ] **T010** `[web]` Add `services/web/src/components/search/MultiSearchResults.tsx` (client: owns
      `addingId`/`addedMediaIds`, calls `addMedia(item.id, item.type)` per card, renders `MediaList`
      with `showLink={false}`, the badge flag on and `MediaResultAction` as `renderAction`, inline
      errors, never `alert()`) and `services/web/src/app/(dashboard)/search/page.tsx` (Server
      Component: `await` the `searchParams` promise — Next 16, confirm against
      `node_modules/next/dist/docs/` — call the action in `try`/`catch`, pass the translated message
      down as an error prop with an empty list on failure, `generateMetadata` following
      `/movies/add`). Add the page's title/metadata keys to both message files. → T007, T008, T009
      *Done when:* `/search?q=spider-man` renders films and series in one badged grid; adding one of
      each on the same page changes both cards without navigating and grows `movies`/`user_movies`
      and `shows`/`user_shows` by exactly one each (AC-5, AC-6); with `movie_db_api_key` cleared the
      page shows an inline error and stays usable, with no Next error screen (AC-11).

- [ ] **T011** `[web]` Wire `services/web/src/layout/AppHeader.tsx`: give the input a `name`, replace
      the `preventDefault`-only handler with one that pushes `/search?q=<encoded>` via `useRouter()`
      from `next/navigation`. Navigate even on an empty box — the action short-circuits and the page
      renders its empty state. Leave the ⌘K focus handler, the placeholder key and the
      three-element header layout untouched (`025-header-redesign`). → T010
      *Done when:* typing a query in the header and pressing Enter lands on `/search` with the query
      in the address, reloading it re-renders the same results (AC-1, AC-2), and submitting it empty
      produces no TMDB call in `docker compose logs api` (AC-12).

### Group 5 — verification and docs

- [ ] **T012** `[docs]` Update the affected `CLAUDE.md` files: `services/api/CLAUDE.md`'s module map
      (`media/` now exposes a third operation and holds `MediaSearchService`; `MediaTypeService` is
      three methods, not two, and the third is where the cache-before-enrich ordering now lives for
      both entry points), `services/web/CLAUDE.md` (the header search is no longer inert; the
      `/search` screen and its Server-Component-plus-client-child shape; the shared
      `MediaResultAction` and the fact that an owned series now links rather than showing a badge;
      the opt-in card badge), and the root `CLAUDE.md` pipeline table's *Search catalog (TMDB)* row
      spec refs. → T011
      *Done when:* no sentence in any of the three files describes behaviour this feature changed —
      in particular `services/web/CLAUDE.md`'s "deliberately inert" header note and its
      "non-interactive `Agregada` badge" note are both gone.

- [ ] **T013** `[docs]` Walk every acceptance criterion in `spec.md` against the running stack —
      including the manual pass in `plan.md` § Verification (the Redis reads for AC-7, the
      second-user pass for AC-10, the `/movies/add` regression for AC-15) — tick each box, then set
      `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`, and
      `status: Done` here. → T012
      *Done when:* all five gate commands pass —
      ```bash
      bin/cli api npx --no tsc --noEmit
      bin/npm api test
      bin/cli web npx --no tsc --noEmit
      bin/cli web node scripts/check-messages.mjs
      bin/npm web run build
      ```
      — with both typechecks at their pre-feature error counts and the api suite green at a total
      **greater** than before (AC-14), and every AC box in `spec.md` is ticked.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

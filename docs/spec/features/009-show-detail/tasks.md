---
title: Show Detail Screen — Tasks
last_updated: 2026-08-13
status: Done
---

# TASKS: Show Detail Screen (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation and cross-service verification. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[worker]` or `[infra]` tasks: the worker is untouched and nothing in `bin/`,
`docker-compose.yaml` or `.env.example` changes. No Prisma migration (see `plan.md` § Migrations).

## Tasks

### Group 1 — `api`: the `show(id)` query and its shape

- [x] **T001** `[api]` Add the `Season` and `Episode` GraphQL entities and wire `seasons` onto
      `Show`. Create `src/shows/entities/episode.entity.ts` (`id`, `episodeNumber`, `title?`,
      `overview?`, `releaseDate?`, `status`) and `src/shows/entities/season.entity.ts` (`id`,
      `seasonNumber`, `releaseDate?`, `episodes: [Episode!]!`), following `show.entity.ts`'s existing
      style — plain `@ObjectType()`, `status` a bare `@Field()` string, never `registerEnumType`'d.
      Add `@Field(() => [Season]) seasons: Season[]` to `show.entity.ts` and update its header
      comment (it currently claims to be a full field-for-field twin of `Movie`; `seasons` is the
      exception).
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors, and
      `bin/cli api cat src/schema.gql` (after a boot) shows `Episode`, `Season` types and `Show.seasons`
      matching `spec.md` § GraphQL Contract Delta exactly — no extra field, no missing one.

- [x] **T002** `[api]` Add `ShowsService.findOneFromDb(id, userId)` and
      `ShowsResolver.getShowById`, copying `MoviesService.findOneFromDb`/`MoviesResolver.getMovieById`
      (`008-movie-detail`) shape for shape: `findFirst({ where: { id, users: { some: { userId } } },
      include: { seasons: { orderBy: { seasonNumber: 'asc' }, include: { episodes: { orderBy: {
      episodeNumber: 'asc' } } } } } })`, and `@Query(() => Show, { name: 'show', nullable: true })`
      with the same `principal.type === 'user' ? principal.id : ''` narrowing `getShows` already uses.
      → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors; a manual GraphQL call to
      `show(id: <owned id>)` returns the show with seasons/episodes in ascending order, and
      `show(id: <unowned or nonexistent id>)` returns `null` with no `errors`.

- [x] **T003** `[api] [P]` Add a `describe('findOneFromDb')` block to the existing
      `src/shows/shows.service.spec.ts` (joins the existing suite — do not create a new one). Cases:
      the Prisma `where` clause asserted **equal** (not `objectContaining`) to
      `{ id, users: { some: { userId } } }`; `null` for a show the caller has no `UserShow` link to;
      the same `null` for an id that does not exist; and one case asserting the nested `include`
      carries `orderBy: { seasonNumber: 'asc' }` and `orderBy: { episodeNumber: 'asc' }`. Extend the
      suite's header comment with the silent-failure class this defends against (per
      `api/plan.md` § Tests). → T002
      *Done when:* `bin/npm api test` is green, `shows.service.spec.ts` stays the same suite (suite
      count unchanged from today's count), and the ownership case has been verified to fail when the
      `users` clause is removed — report both the before/after test count and that verification.

### Group 2 — `web`: the route, the components, the card link fix

Everything in this group except T007 depends on Group 1: the query, the field shapes and the
ordering guarantee must exist before `web` can consume or verify against them.

- [x] **T004** `[web]` Extend `src/actions/shows.ts`: add `Episode`/`Season` interfaces and
      `seasons: Season[]` on `Show`, add `GET_SHOW_QUERY` and `getShowById(id: number): Promise<Show
      | null>`, copying `getMovieById`'s structure exactly (`'use server'`, `fetchGraphQL`,
      `redirectToClearSession` on `errors`, `data?.show ?? null` on success — see
      `web/plan.md` § Steps 1-2 for the exact query fields). → T002
      *Done when:* `bin/cli web npx --no tsc --noEmit` shows no new error attributable to this file,
      and a direct call to `getShowById` against an owned show id returns seasons/episodes in the
      order the API sent them.

- [x] **T005** `[web] [P]` Rewrite `src/app/(dashboard)/shows/[id]/page.tsx` (currently a broken,
      uncommitted paste — replace it wholesale, do not patch it) and create
      `src/app/(dashboard)/shows/[id]/not-found.tsx`, mirroring `movies/[id]/{page,not-found}.tsx`
      line for line: `parseShowId` guard before any fetch, `cache(getShowById)` shared between
      `generateMetadata` and the page, fixed `UNAVAILABLE_METADATA`, `notFound()` on both the
      invalid-param and null-show paths, and the season list rendered below `<Show show={show} />`
      with `defaultOpen` computed from the highest `seasonNumber` (see `web/plan.md` § Steps 3-4).
      → T004
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports **exactly 12** errors total, across
      the 5 known pre-existing files only — neither this page nor its `not-found.tsx` in that count.

- [x] **T006** `[web] [P]` Rewrite `src/components/shows/Show.tsx` from scratch (discard the
      uncommitted copy of `Movie.tsx`). Props `{ show: Show }` typed from `@/actions/shows`. Same
      poster/title/metadata-line/"Sinopsis" layout as `Movie.tsx`, with no `File`/`Magnet` buttons,
      no `useModal()`, no modal imports — drop `"use client"` if nothing in the file needs it (see
      `web/plan.md` § Step 5). → T004
      *Done when:* `bin/cli web npx --no tsc --noEmit` stays at exactly 12 pre-existing errors, this
      file not among them; the component renders poster, title, year/language/status and overview
      with no torrent/file controls, matching REQ-1.

- [x] **T007** `[web] [P]` Rewrite `src/components/shows/SeasonAccordion.tsx` from scratch (discard
      the uncommitted `@prisma/client`-typed draft — Constitution, Article II). Props
      `{ season: Season, defaultOpen: boolean }` typed from `@/actions/shows` only. `"use client"`,
      local open/close state, a `Button`-based season header with a rotating chevron, and per-episode
      rows (number, title, overview, release date, status) each with three `Button`s (buscar,
      importar archivo, añadir torrent) whose `onClick` modal-opening code is written but commented
      out — no `useModal()`, no modal import, no modal render (REQ-5; see `web/plan.md` § Step 6).
      → T004
      *Done when:* `bin/cli web npx --no tsc --noEmit` stays at exactly 12 pre-existing errors, this
      file not among them; `grep -n "@prisma/client" services/web/src/components/shows/SeasonAccordion.tsx`
      returns nothing; clicking any of the three buttons in a browser opens nothing and fires no
      network request (checked in dev tools).

- [x] **T008** `[web] [P]` Fix the series-card link. Add a `mediaType` prop to `MediaCardProps` in
      `src/components/media/MediaCard.tsx` and switch the `href` ternary from
      `item.type === MEDIA_TYPE.SHOW` to `mediaType === MEDIA_TYPE.SHOW`; forward `MediaList`'s
      existing `mediaType` prop into `<MediaCard mediaType={mediaType} .../>` in
      `src/components/media/MediaList.tsx`. No GraphQL field added (`web/plan.md` § Contract Freeze).
      This task has no dependency on Group 1 and may start immediately.
      *Done when:* `bin/cli web npx --no tsc --noEmit` stays at exactly 12 pre-existing errors; in a
      browser, a series card on `/shows` links to `/shows/<id>`, and a film card on `/movies` still
      links to `/movies/<id>` (regression check).

### Group 3 — verification and docs

- [x] **T009** `[docs]` Add a `009-show-detail` section to `docs/spec/graphql-contract.md`,
      following the shape of the existing `007-library-listing`/`008-movie-detail` sections: the
      `show(id)` SDL, the `status`-as-string note, the "no image field" note, the `null`-means-
      "not available to you" note, and the "no `@AllowService()`" note (`api/plan.md` § Steps 7).
      → T002
      *Done when:* `grep -n "show(id)" docs/spec/graphql-contract.md` finds the new section, and its
      content matches `spec.md` § GraphQL Contract Delta with no contradiction.

- [x] **T010** `[docs]` Run the manual acceptance pass from `plan.md` § Verification with two users
      (the seeded admin plus one created from `/users`). Register a series with 2+ seasons as user B;
      confirm its `/shows` card links to `/shows/<id>` (AC-7); open `/shows/<id>` as B and confirm
      metadata with no torrent/file controls (AC-1), the highest season expanded with the rest
      collapsed and correctly ordered episodes (AC-2), toggle behavior (AC-3), and that each
      episode's three buttons open nothing and fire no request per the network panel (AC-4); open
      `/shows/<id>` as A (non-owner) and confirm the identical `Recurso no disponible para este
      usuario` 404 the movie detail screen uses (AC-5); confirm `/shows/999999999` renders the same
      (AC-6). → T003, T005, T006, T007, T008, T009
      *Done when:* every criterion above has an observed result recorded (screenshot or explicit
      note per criterion). Any that fails goes to **Blocked**, not a workaround.

- [x] **T011** `[docs]` Update the affected `CLAUDE.md` files. Root `CLAUDE.md`'s pipeline table row
      for "Browse library": the parenthetical noting the series card links to the wrong detail page
      is now stale — the card links to `/shows/<id>` and that route now renders real data.
      `services/api/CLAUDE.md`'s `shows/` module-map bullet: replace "There is still no `show(id)`
      query and no detail route" with what is true now, and update the model/migration counts if
      they moved. `services/web/CLAUDE.md`: add a note alongside "Movie detail is scoped..." for the
      show detail screen, and re-verify the 12-error table is still exactly that after this feature's
      files are added. → T010
      *Done when:* none of the three files still claims `show(id)` doesn't exist or that the series
      card is knowingly broken, and every count quoted matches what T003/T005 actually reported.

- [x] **T012** `[docs]` Walk the acceptance criteria in `spec.md`, tick each box against the evidence
      from T003/T010, and set `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and
      `web/plan.md`. Update `last_updated` on each. → T009, T010, T011
      *Done when:* all 7 acceptance criteria are ticked with an observed result behind each, and
      `grep -n "^status:" docs/spec/features/009-show-detail/{spec.md,plan.md,api/plan.md,web/plan.md}`
      shows `Implemented` four times. Any criterion that could not be met stays unticked and is
      listed in **Blocked**.

## Post-ship corrections

Changes made after T012 closed, in response to user review of the shipped screen. Tracked here
rather than as new numbered tasks — each is a small, single-file-scope `web` display fix with no
contract or plan-of-work impact, amending `../spec.md` and `web/plan.md` directly (see each file's
"correction" section) rather than restarting the dispatch pipeline.

- [x] **PS-1** `[web]` Reverse season display order (newest `seasonNumber` first) and episode
      display order within each season (newest `episodeNumber` first). Amends REQ-2, REQ-3, NFR-2,
      AC-2. Files: `src/app/(dashboard)/shows/[id]/page.tsx`, `src/components/shows/SeasonAccordion.tsx`.
      *Done when:* `bin/cli web npx --no tsc --noEmit` stays at exactly 12 pre-existing errors;
      verified in browser on `/shows/6` — Temporada 5 listed first, its episode 16 listed before
      episode 1.
- [x] **PS-2** `[web]` Replace the per-episode card layout with a table (`# | Título con overview
      debajo | Fecha de estreno | Estado | Acciones`), matching the pre-feature discarded draft's
      layout convention. File: `src/components/shows/SeasonAccordion.tsx`. No REQ/AC change — same
      fields, same inert buttons (REQ-3, REQ-5 unaffected).
      *Done when:* `bin/cli web npx --no tsc --noEmit` stays at exactly 12 pre-existing errors;
      verified in browser — episode rows render as table rows with the five columns above.

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty
entry is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice. For this feature
that specifically includes anything that looks like it needs `@AllowService()` on `show(id)`, a
`userId` argument on the query, a distinct "not yours" error, or a `type` field added to `Show` —
all four are frozen shut in `plan.md` § Contract Freeze.

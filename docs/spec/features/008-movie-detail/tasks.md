---
title: Movie Detail Resource, Scoped to Its Owner — Tasks
last_updated: 2026-08-12
status: Done
---

# TASKS: Movie Detail Resource, Scoped to Its Owner (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation and cross-service verification. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[worker]` or `[infra]` tasks: the worker is untouched (NFR-5) and nothing in `bin/`,
`docker-compose.yaml` or `.env.example` changes.

## Tasks

### Group 1 — `api`: scope the single-film read

- [x] **T001** `[api]` Scope `MoviesService.findOneFromDb` and clear every caller it breaks. Change
      the signature to `(id: number, userId: string)` and the body to
      `findFirst({ where: { id, users: { some: { userId } } }, include: { mediaSource: true,
      processJobs: true } })`, copying the clause shape from `attachTorrentSource`
      (`movies.service.ts:270`). Add `@CurrentUser()` to `MoviesResolver.getMovieById` with the same
      narrowing `getMovies` uses. Replace `update()`/`remove()`'s existence check with a direct
      `prisma.movie.findUnique`. Delete `src/movies/movies.controller.ts` — do **not** patch it with
      `findOneFromDb(id, '')`. Fix the now-false comment above `findAll` (lines 35-38) and translate
      the Spanish comment above `getMovieById` to English (Article VI).
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports **0** errors (report the count before
      and after); `grep -rn "MoviesController" services/api/src` returns nothing; and
      `services/api/src/schema.gql` is **unchanged** in the diff — the SDL does not move.

- [x] **T002** `[api] [P]` Add a `describe('findOneFromDb')` block to the existing
      `src/movies/movies.service.spec.ts` (the tenth suite — do **not** create an eleventh). Three
      cases: the query is scoped through the `user_movies` join, asserted as `args.where` **equal**
      to `{ id, users: { some: { userId } } }`; `null` for a film the caller is not linked to; the
      same `null` for an id that does not exist. Extend the suite's header comment with the silent
      failure this defends against. → T001
      *Done when:* `bin/npm api test` is green across **10** suites with the new cases added to the
      existing 87, **and** the scoping case has been verified to fail when the `users` clause is
      removed — a test that passes against the bug is worse than no test. Report both facts. (AC-10)

- [x] **T003** `[api] [P]` Make `createUploadTicket` refuse an unowned film. Add `MoviesModule` to
      `UploadsModule`'s `imports` (it already `exports: [MoviesService]`), inject `MoviesService`
      into `UploadsResolver`, and after the existing `principal.type !== 'user'` guard call
      `findOneFromDb(movieId, principal.id)`, throwing
      `NotFoundException(\`La película ${movieId} no existe\`)` on null. **That exact string** — the
      one `attachTorrentSource` already throws. No new message. Leave
      `uploads.service.ts`'s `handleUploadFinish` alone (see `api/plan.md` § Steps, closing note).
      → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` still reports 0 errors, Nest boots with no
      circular-dependency warning, and a `createUploadTicket(movieId: <another user's film>)` call
      returns exactly `La película <id> no existe`. (AC-7)

### Group 2 — `web`: render the unavailable case

This group does **not** depend on Group 1, and that is deliberate rather than an oversight. The
GraphQL contract does not move — `movie(id)` already returns `null` for an id that does not exist,
so both tasks below are fully verifiable against `/movies/999999999` before `api` lands. What Group
1 adds is a *second* reason that null arrives, which `web` cannot and must not distinguish.

- [x] **T004** `[web] [P]` Create `src/app/(dashboard)/movies/[id]/not-found.tsx` — a server
      component rendering the exact string `Recurso no disponible para este usuario`, in the
      dashboard's visual language (reuse the detail page's card-shell classes; use the shared
      `Button`/`next/link` for any way back, never a bare `<button>` with `bg-primary`, a token this
      service's Tailwind theme does not define). Nothing on it may derive from the requested film.
      Do not set an HTTP status by hand — Next serves a segment `not-found.tsx` as 404 when
      `notFound()` is called. Scope it to this segment only; no app-wide 404 page.
      *Done when:* `/movies/999999999` renders that message and the response status is **404**, and
      `bin/cli web npx --no tsc --noEmit` still reports **exactly 12** errors across the same five
      pre-existing files, with `not-found.tsx` not among them. (REQ-4)

- [x] **T005** `[web]` Guard the route param and stop the metadata leak in
      `src/app/(dashboard)/movies/[id]/page.tsx`. Parse `id` once and call `notFound()` unless it is
      a positive integer, **before** awaiting the fetch, in both `generateMetadata` and the page
      component (both must keep going through the shared `cache(getMovieById)` wrapper, or the tab
      title and the body can disagree). On the unavailable path `generateMetadata` must return a
      generic Spanish title and description — identical for "does not exist" and "not yours", and
      carrying no film-derived text. The owner path renders exactly as it does today. → T004
      *Done when:* `/movies/abc` reaches the same unavailable page with status 404 and **no 500 in
      `bin/cli api` logs**; the browser tab title on `/movies/abc` and `/movies/999999999` is
      identical and names no film; a film the caller owns still renders in full. `bin/cli web npx
      --no tsc --noEmit` reports exactly 12 errors, none in this file. (REQ-5, REQ-6, AC-5, AC-6)

### Group 3 — verification and docs

- [x] **T006** `[docs]` Run the cross-service acceptance pass from `plan.md` § Verification. It
      spans both services, so no service agent can own it. Needs two users (the seeded admin plus
      one created from `/users`) and, for the last step, the `worker` container up. Walk all nine
      numbered steps: owner renders in full (AC-1); non-owner gets the Spanish page with 404 and no
      film data in the **response body or tab title** — confirm in the network panel, not by eye
      (AC-2, AC-6); `movie(id)` for an unowned film diffs identical against a nonexistent id (AC-3)
      while the owner still gets the film (AC-4); `createUploadTicket` refuses for the non-owner
      (AC-7) and a real tus upload still completes for the owner (AC-8);
      `addTorrentToMovie`/`addMagnetToMovie` still refuse with the same string (AC-9); a
      `SERVICE_TOKEN` bearer gets `No autenticado`, identical to a credential-less request (AC-13);
      and one of the owner's films goes through the full pipeline, landing at
      `<outputRoot>/<Title> (<year>) [tmdbid=<id>]/<Title> (<year>).mkv` (AC-14).
      → T002, T003, T005
      *Done when:* every step above has been executed and its observed result recorded — including
      the AC-3 diff output and the AC-14 output path. Any step that fails goes to **Blocked**, not
      into a workaround.

- [x] **T007** `[docs]` Supersede the contract record. `docs/spec/graphql-contract.md:196` currently
      states that `movie(id)` "was deliberately left unscoped: any authenticated user can still read
      a single film by internal id". That becomes false with T001. Replace it with what is true
      after this feature — the query resolves against the caller's library only, its `null` now
      means "no such film *for you*", and the two reasons for that null are indistinguishable by
      design — and record that no `@AllowService()` was added, since the worker reads film metadata
      through `processJob` instead. This is the only place the semantic change is recorded: the SDL
      does not move and there is no codegen (NFR-2, Article VIII). → T001
      *Done when:* `grep -n "movie(id)" docs/spec/graphql-contract.md` shows no surviving claim that
      the query is unscoped, and the new paragraph names both the scoping and the service-principal
      behaviour. (AC-12)

- [x] **T008** `[docs]` Update the affected `CLAUDE.md` files. `services/api/CLAUDE.md:105` says
      "`movie(id)` stays unscoped" — correct it, and note in the `uploads/` bullet that
      `createUploadTicket` now also requires the caller's `user_movies` link. Refresh that file's
      test/typecheck counts under "Current state" with T001/T002's reported numbers. In
      `services/web/CLAUDE.md`, record the new `not-found.tsx` and re-verify the 12-error table is
      still exact. In the root `CLAUDE.md`, update the **Browse library** pipeline row: no stage
      changes status, but the row's parenthetical about the detail link is now stale — the movie
      detail route is per-user as of this feature, and `MediaCard` already routes series to
      `/shows/<id>` (the broken half is `/shows/[id]`'s page, still out of scope). → T006
      *Done when:* none of the three files still asserts that `movie(id)` is readable by any
      authenticated user, and the counts quoted match what T001/T002 actually reported.

- [x] **T009** `[docs]` Walk the acceptance criteria in `spec.md`, tick each box against the
      evidence from T002/T003/T005/T006, and set `status: Implemented` on `spec.md`, `plan.md`,
      `api/plan.md` and `web/plan.md`. Update `last_updated` on each. → T006, T007, T008
      *Done when:* all 14 criteria are ticked with an observed result behind each, and
      `grep -n "^status:" docs/spec/features/008-movie-detail/{spec.md,plan.md,api/plan.md,web/plan.md}`
      shows `Implemented` four times. Any criterion that could not be met stays unticked and is
      listed in **Blocked** — do not tick a box you did not watch happen.

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty
entry is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice. For this feature
that specifically includes anything that looks like it needs `@AllowService()` on `movie(id)`, a
second user-facing error string, or a `userId` argument on the query — all three are frozen shut in
`plan.md` § Contract Freeze.

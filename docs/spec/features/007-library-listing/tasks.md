---
title: Library Listing for Movies and Shows — Tasks
last_updated: 2026-08-12
status: Done
---

# TASKS: Library Listing for Movies and Shows (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks at the same point in the graph. |
| `→ Tnnn` | Blocked by that task. |

There are no `[worker]` or `[infra]` tasks: the worker is untouched, and nothing about how the
stack boots changes.

## Before you start

`api` and `web` are not running (`docker compose ps` shows only `db`, `redis`, `torrent`,
`indexer`, `traefik`). Nothing below can be verified until the stack is up:

```bash
bin/dev
```

Every command in this file goes through `bin/` (Constitution, Article I).

## Tasks

### Group 1 — schema and migration

- [x] **T001** `[api]` Change `Show.status` in `services/api/prisma/schema.prisma` from `String?` to
      `MediaStatus @default(MISSING)`, generate the migration with
      `bin/npm api run prisma:migrate` named `add_show_status_enum`, then **read the generated
      `migration.sql`** and confirm it backfills existing rows before making the column `NOT NULL`.
      If Prisma emitted a bare `MODIFY … NOT NULL`, add
      `UPDATE shows SET status = 'MISSING' WHERE status IS NULL;` ahead of it in the generated file.
      Touch no other field on `Show`.
      *Done when:* `bin/mysql -e 'select status, count(*) from shows group by status'` returns only
      `MISSING` rows and zero NULLs (AC-9), and `git status services/api/prisma/` shows both a
      modified `schema.prisma` and a new migration directory (Article III).

### Group 2 — the contract

- [x] **T002** `[api]` Add the read surface for series, as one change: `Show` `@ObjectType()` in
      `services/api/src/shows/entities/show.entity.ts` with exactly the 12 fields in `spec.md`
      § GraphQL Contract Delta (`status` is a bare `@Field()` typed `string` — **no**
      `registerEnumType`); `findAll(userId)` on `ShowsService` (one `findMany`,
      `where: { users: { some: { userId } } }`, `orderBy: { createdAt: 'desc' }`, no `include`);
      `ShowsResolver` with the single `shows` query, copying `movies.resolver.ts:16-21` verbatim
      including the `principal.type === 'user' ? principal.id : ''` narrowing; register the resolver
      in `ShowsModule` and `ShowsModule` in `app.module.ts`. → T001
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports **0 errors** (AC-7), and
      `git diff services/api/src/schema.gql` shows **only** the added `Show` type and
      `shows: [Show!]!` — no change to `Movie` or `movies` (AC-13, NFR-3).

- [x] **T003** `[api] [P]` Verify the scoping and auth behaviour of `shows` against the running API
      over GraphQL, with two real users who each own series (one of them a series both own). → T002
      *Done when:* all five hold, with the actual responses pasted into the report —
      user A sees exactly A's series and none of B's (AC-1); a series both registered appears once
      for each independently (AC-2); a user with no series gets `{"data":{"shows":[]}}` with no
      `errors` key (AC-3); the most recently registered series is first in the array (AC-4); a
      request with no `Authorization` header returns `Unauthorized` and no `data.shows` (AC-5); and
      a request authenticated with `SERVICE_TOKEN` returns `{"data":{"shows":[]}}` rather than any
      user's library or the whole table (AC-6).

- [x] **T004** `[api] [P]` Extend `services/api/src/shows/shows.service.spec.ts` with a `describe`
      block for `findAll`, opening with a header comment naming the failure it defends against (a
      cross-user leak that produces no error anywhere). Cases: the `prisma.show.findMany` call
      carries `where: { users: { some: { userId } } }` with the caller's id; it carries
      `orderBy: { createdAt: 'desc' }`; an empty result returns `[]`. English `it(...)` strings in
      the indicative, following the existing file's style. → T002
      *Done when:* `bin/npm api test` is green with the new cases (AC-8), and the agent has
      confirmed by temporarily deleting the `where` clause that the ownership case **fails** —
      report both the failing output and that the clause was restored. A test that passes with the
      filter removed is not defending anything.

### Group 3 — consumer

Depends on Group 2's contract existing and answering. May overlap T003 and T004.

- [x] **T005** `[web]` Make `/shows` render the caller's series: create
      `services/web/src/actions/shows.ts` (`getShows()` + a `Show` interface, following
      `getMovies()` in `src/actions/movies.ts` — `redirectIfUnauthenticated` then throw, Spanish
      fallback `'Error al obtener series'`, `id` typed `string`); fix
      `src/components/Shows/Shows.tsx` to call `getShows()` and pass
      `mediaType={MEDIA_TYPE.SHOW}`, renaming its default export to `Shows`; fix
      `src/app/(dashboard)/shows/page.tsx` to import `@/components/Shows/Shows` and replace the
      pasted "Movies" metadata, description, breadcrumb and function name with series equivalents.
      Read the relevant guide under `services/web/node_modules/next/dist/docs/` first
      (`services/web/AGENTS.md`). **Do not** add `type` to the query or the interface, and do not
      touch `MediaCard.tsx`, `MediaList.tsx`, or anything under `src/components/movies/` or
      `src/app/(dashboard)/movies/`. → T002
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports **12 errors across the 5 documented
      pre-GraphQL files and no sixth** — the `Cannot find module '@/components/movies/Shows'` error
      is gone (AC-10) — `bin/npm web run lint` passes, and `git status services/web/src/components/movies/
      services/web/src/app/\(dashboard\)/movies/` is clean (AC-11, film half). Report the error count
      before and after. `bin/npm web run build` still failing on those 12 is expected and is not a gate.

### Group 4 — verification and docs

- [x] **T006** `[docs]` Add a section to `docs/spec/graphql-contract.md` for `007-library-listing`:
      `shows: [Show!]!` as a sibling of `movies` rather than a parameterized listing and why;
      `Show.status` crossing as `String!` while being a Prisma enum, matching `Movie`; the service
      principal resolving to `[]` rather than an error; and that `Show` carries no `type` field, so
      a consumer cannot yet distinguish a series from a film by payload alone. → T002
      *Done when:* the section states the shape and the reasoning, and a reader who only has that
      file could hand-write `getShows()` correctly.

- [x] **T007** `[docs]` Update the three `CLAUDE.md` files against the real post-change numbers.
      Root: the pipeline table's **Browse library** row moves from "working for the movie list" to
      covering both, and the "Current state" paragraph drops the 6th `web` error.
      `services/api/CLAUDE.md`: the `shows/` module map entry no longer says "No resolver in this
      module … no `shows`/`show(id)` GraphQL query yet"; the "Schema/enum reality check" section's
      matching claim and the migration count; the test/typecheck counts.
      `services/web/CLAUDE.md`: the 6th-error paragraph goes, the library-listing pattern is
      recorded, and the count is re-stated from a live run. → T004, T005
      *Done when:* every count in the three files comes from a command run in this session, not
      from the previous values, and no file still claims series cannot be read back over GraphQL.

- [x] **T008** `[docs]` Walk the acceptance criteria in `spec.md`, tick each box, and set
      `status: Implemented` on `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`.
      AC-11 and AC-12 need a **human at a browser** — sign in with a library of a few series and
      confirm `/shows` renders the cards most-recent-first and `/movies` is unchanged, then sign in
      as a user with none and confirm the empty state reads "No hay series registradas". Clicking a
      series card navigating to `/movies/<id>` and showing the wrong thing is the known deliberate
      gap (next spec) — do not file it as a defect. → T003, T004, T005, T006, T007
      *Done when:* all 13 boxes are ticked with the evidence noted, or any that cannot be ticked is
      recorded in Blocked below rather than checked off optimistically.

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T008 (AC-11, AC-12 only) | `[docs]` | Both criteria say "in the browser". No agent can sign in — entering a password to authenticate is off-limits — so neither can be ticked honestly. Everything short of the rendered pixels was verified over HTTP: `GET /shows` with a real session cookie returns 200 with the `Shows` breadcrumb and, pre-hydration, the shared empty state "No hay series registradas"; the `getShows` Server Action, invoked exactly as `Shows.tsx`'s `useEffect` does, returned the caller's four series in `createdAt desc` with poster, title and date present. `/movies` returns 200 and `git status services/web/src/components/movies/` is clean. | A human at a browser: `/shows` with a few series, `/shows` as a user with none, `/movies` unchanged. A series card navigating to `/movies/<id>` is the known deliberate gap — not a defect. |

Two spec amendments were made during implementation, on the user's decision, and **no code changed
for either**: REQ-5 and AC-6 said a `SERVICE_TOKEN` caller receives an empty list, when the global
`JwtAuthGuard` in fact refuses any service principal outright (`movies` behaves identically), and
the error table said `Unauthorized` where the real string is `No autenticado`. AC-4 also gained a
caveat: the order key is the shared `shows.createdAt`, not the `user_shows` link, exactly as
`movies` orders on `movie.createdAt`.

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.

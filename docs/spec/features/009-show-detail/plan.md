---
title: Show Detail Screen — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-13
status: Implemented
---

# PLAN: Show Detail Screen (`plan.md`)

## Approach

This is a structural twin of `008-movie-detail`, one level deeper. `api` already has the exact
pattern to copy: `MoviesService.findOneFromDb(id, userId)` — a `findFirst` with
`where: { id, users: { some: { userId } } }` — is the ownership clause `ShowsService` gains too,
against `UserShow` instead of `UserMovie`. The only real addition on top of that precedent is depth:
`movie(id)`'s `include` is one level (`mediaSource`, `processJobs`); `show(id)`'s `include` is two
(`seasons`, and each season's `episodes`), both ordered server-side. Two new `@ObjectType`s
(`Season`, `Episode`, in `shows/entities/`) carry that shape over GraphQL — nothing here is a new
kind of resolver, just a new entity pair following `Show`'s own entity file line for line.

`web` reuses the same shape `movies/[id]/page.tsx` already proved: a `parseId` guard, a
`cache()`-wrapped fetch, a fixed Spanish `UNAVAILABLE_METADATA`, a segment `not-found.tsx`. The two
components already sitting uncommitted in `src/components/shows/` (`Show.tsx`, `SeasonAccordion.tsx`)
are discarded, not repaired — `Show.tsx` is a literal copy of `Movie.tsx` with the wrong type import,
and `SeasonAccordion.tsx` imports `@prisma/client` types against a query that never existed
(Constitution, Article II). Both are rewritten from scratch against `getShowById`'s return shape.

The accordion itself reuses no existing primitive because none exists (`services/web/CLAUDE.md`
confirms `@/components/ui/` has no accordion) — it is hand-rolled `useState` + conditional render,
the same shape `SeasonAccordion.tsx`'s discarded draft already used for the open/close mechanic,
just re-typed and re-scoped to real data.

The series-card link fix (REQ-7) is the smallest possible change: `MediaList.tsx` already receives
a `mediaType` prop and already threads it into its own empty-state text, but never passes it to
`MediaCard`, which instead reads a `type` field `Show`/`Movie` never had. `MediaCard` gains a
`mediaType` prop (mirroring `MediaList`'s), `MediaList` forwards its own `mediaType` down, and the
`href` ternary switches from `item.type === MEDIA_TYPE.SHOW` to `mediaType === MEDIA_TYPE.SHOW`. No
GraphQL field, no new prop threaded through search results — `Movies.tsx`/`Shows.tsx` already pass a
fixed `mediaType` to `MediaList` for their own empty-state text, so this is one more consumer of a
value that already flows to that call site.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns `show(id)` and the `Season`/`Episode` types. `web` cannot render seasons/episodes or exercise the ownership 404 until the query exists. |
| 2 | `web` | Consumes the query from step 1 (`getShowById`, the page, `Show`/`SeasonAccordion`) and independently fixes the `MediaCard` link (REQ-7, no dependency on step 1). |

The `MediaCard`/`MediaList` link fix can start in parallel with step 1 — it touches neither the new
query nor its consumers. The rest of `web`'s slice (the page, the two components) cannot start
usefully before `api`'s entities exist, since their field shape is fixed by the frozen contract
below, not guessed at.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`.

- **`show(id: Int!): Show`, nullable, no new argument beyond `id`.** Same shape as `movie(id)`. Do
  not add a `userId` argument — the caller is always the credential, per `008-movie-detail`'s
  precedent, which this feature extends rather than revisits.
- **`null` means "not available to you", covering both "does not exist" and "not yours", with no
  new error string.** Exactly `movie(id)`'s rule. An implementer who is tempted to add a
  `NotFoundException` with a distinct message for the unowned case is re-opening a question
  `008-movie-detail` already closed for the sibling query.
- **`Episode.status`/`Show.status` cross as plain `String!`, not a registered GraphQL enum.** Same
  reasoning as `Movie.status` and today's `Show.status` — do not `registerEnumType` one status field
  while the other two stay strings.
- **No image field on `Season`/`Episode`.** The schema does not have one; do not add a Prisma column
  as a side effect of this feature to backfill a field the spec never asked for.
- **No `@AllowService()` on `show(id)`.** The worker has no call site for it. If one appears later,
  that is its own decision with its own justification, not a default grant here.
- **No `type` field added to `Show`.** REQ-7 is satisfied entirely in `web`, via the `mediaType` prop
  already flowing through `MediaList`. Adding a schema field to solve a client-side rendering
  decision would be scope creep the spec explicitly ruled out.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief both services.
Never patch it from inside one slice (Article VIII).

## Migrations

None. `Season` and `Episode` already exist in `services/api/prisma/schema.prisma` with every field
this feature needs (`seasonNumber`, `episodeNumber`, `title`, `overview`, `releaseDate`, `status`).
This feature only adds GraphQL entities and a resolver method over existing rows.

Reversibility: full. Reverting the diff removes the query and the two entity types; no data is
written or altered by this feature (`show(id)` is a read).

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `findOneFromDb` on `ShowsService` is written with `where: { id }` and the `users` join moved into `include` instead of `where` | Every authenticated caller can read every show's seasons and episodes by id, not just their own — the query succeeds, the page renders real data, nothing errors | Unit test asserts `args.where` **equals** `{ id, users: { some: { userId } } }` by full equality, not a loose `objectContaining` — same technique `movies.service.spec.ts:170` uses, verified to fail when the clause is removed |
| Nested `include` on `seasons`/`episodes` omits `orderBy`, or orders only one level | Episodes render in DB-insertion order (usually still ascending by luck, since `hydrate()` writes them in TMDB order) until a re-hydration or manual edit reorders the underlying rows, and nothing anywhere reports the wrong order as an error | NFR-2 plus an explicit test asserting the `orderBy: { seasonNumber: 'asc' }` / `orderBy: { episodeNumber: 'asc' }` shape is present in the Prisma call, not just that the mocked return happens to look sorted |
| `SeasonAccordion`/`Show.tsx` are "fixed" by patching the existing uncommitted files instead of rewriting against `getShowById`'s real shape | The `@prisma/client` import (Constitution Article II) or the nonexistent-query assumption survives into the committed version, reintroducing exactly the defect this feature exists to remove | The uncommitted `Show.tsx`/`SeasonAccordion.tsx` are treated as discarded drafts, not a base — the plan says rewrite, and the `git status` diff for this feature should show them replaced wholesale, not patched |
| The three per-episode buttons are wired all the way to a real `useModal()`/modal-open call, "since the modal already exists" | REQ-5 is violated: a click opens `SearchTorrentModal` against an `Episode` shape `show(id)` doesn't provide the fields for (no TMDB search context, no season number threaded in the same way `SearchTorrent.tsx` expects), producing a modal that opens and then does nothing useful or errors quietly | AC-4 explicitly checks the network panel for zero new requests; code review confirms the open-modal call is commented out, not executed |
| `MediaCard`'s link fix is done by adding a `type` field to the `Show`/`Movie` GraphQL types instead of threading `mediaType` from `MediaList` | Reopens a question `007-library-listing`'s contract doc closed on purpose (`Show` carries no `type` field) and drifts `spec.md`'s frozen contract without re-approval | Contract Freeze section above states this explicitly; `docs/spec/graphql-contract.md` is not touched by this feature's `web` slice |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
```

Expected: `api` stays at 0 errors; the suite grows with a `findOneFromDb`/ordering block in
`shows.service.spec.ts` (joining the existing suite, not a new one — same choice
`008-movie-detail` made for `movies.service.spec.ts`). `web` reports **exactly 12** errors across
the 5 known pre-GraphQL files and nothing else — the new/rewritten files
(`src/actions/shows.ts`'s `getShowById`, `app/(dashboard)/shows/[id]/page.tsx`,
`app/(dashboard)/shows/[id]/not-found.tsx`, `components/shows/Show.tsx`,
`components/shows/SeasonAccordion.tsx`, `components/media/MediaCard.tsx`,
`components/media/MediaList.tsx`) must not appear in that count.

Then the manual pass, with two users (the seeded admin plus one created from `/users`):

1. As B, register a series with at least two seasons from `/shows/add`. Confirm its card in `/shows`
   now links to `/shows/<id>` (AC-7), not `/movies/<id>`.
2. As B, open `/shows/<id>` — poster/title/year/language/status/overview render, no torrent/file
   controls at the top level (AC-1); the highest-numbered season is expanded with its episodes in
   ascending order, the rest collapsed (AC-2); clicking a season header toggles it (AC-3); each
   episode row shows its three buttons and clicking one opens nothing and fires no request, checked
   in the browser's network panel (AC-4).
3. As A, open `/shows/<id>` for B's series — the same `Recurso no disponible para este usuario` 404
   the movie detail screen uses, no series data anywhere in the response (AC-5).
4. `/shows/999999999` renders the identical 404 (AC-6).
5. With `SERVICE_TOKEN` as bearer, `show(id: <id>)` returns `No autenticado`, matching `shows`' and
   `movie(id)`'s existing behavior for a service credential.

Finally: confirm `docs/spec/graphql-contract.md` gains a `009-show-detail` section documenting
`show(id)` the same way it documents `movie(id)` — the doc is not itself part of the frozen delta,
but the pattern established by `007`/`008` is to record every shipped feature there.

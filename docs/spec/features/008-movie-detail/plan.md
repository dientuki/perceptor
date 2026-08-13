---
title: Movie Detail Resource, Scoped to Its Owner — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-12
status: Implemented
---

# PLAN: Movie Detail Resource, Scoped to Its Owner (`plan.md`)

## Approach

The feature is a scoping change, not a new surface. Everything it needs already exists: the
`UserMovie` join written by `005-movie-search`, the ownership `where` clause that
`MoviesService.attachTorrentSource` already uses, and a detail page that already renders correctly
for its owner. The work is to make one read agree with rules the rest of the module already follows,
and to give `web` a Spanish page for the case that read now produces.

`api` changes `MoviesService.findOneFromDb` from `prisma.movie.findUnique({ where: { id } })` to a
`findFirst` carrying **the exact `where` shape already in use** at
`services/api/src/movies/movies.service.ts:270` — `{ id, users: { some: { userId } } }`. That
clause is the thing to reuse: it is the module's one definition of "this film is the caller's", and
`attachTorrentSource` is the precedent for answering an unowned film exactly as it answers a missing
one. No new helper, no new "ownership service" — a second way to express this is how the two reads
drift apart later.

`createUploadTicket` gets the same treatment by reusing the same method rather than growing its own
query. `MoviesModule` already `exports: [MoviesService]`, so `UploadsModule` imports it and
`UploadsResolver` asks `findOneFromDb(movieId, principal.id)` before minting. The alternative —
injecting `PrismaService` into `UploadTicketsService` and writing a second ownership lookup there —
was rejected: it puts a second copy of the rule in a service whose job is JWT minting, and
`UploadTicketsService` deliberately has no database access today.

`web` does not change its GraphQL call at all. `getMovieById` already returns `null` on
`data.movie === null`; the only reason the page currently shows an English 404 is that nothing
under `services/web/src/app` defines a `not-found.tsx`, so `notFound()` falls through to the Next
default. The fix is a route-segment `not-found.tsx` under `movies/[id]/`, which is also what keeps
this from becoming an app-wide 404 page (out of scope in `spec.md`). The page adds one guard for a
non-numeric route param, which today would send `NaN` across the wire as an `Int!`.

### A dead REST controller stands in the way

`services/api/src/movies/movies.controller.ts` calls `findOneFromDb(id)` and would not compile
against the new signature. It is dead code: `MoviesController` is registered in no module
(`movies.module.ts` has no `controllers` array), referenced by nothing, and its own `findAll`
already carries a comment explaining that `005-movie-search` passed `''` to keep it compiling after
that feature scoped `findAll`.

**This plan deletes the file** rather than paper over it a second time with
`findOneFromDb(id, '')`. Repeating the trick would leave a movies-shaped REST surface that returns
`null` for every film if anyone ever registered it — a landmine that looks like working code.
Article II names `/uploads` as the single sanctioned REST route and forbids a second; deleting an
unregistered, unreachable movies controller moves the repo toward that rule, not away from it.
`CreateMovieDto`/`UpdateMovieDto` stay — `MoviesService.create`/`update` still use them.

`MoviesService.update()` and `remove()` call `findOneFromDb` purely as an existence check and have
no user in scope. They lose their only caller with the controller, but the methods stay; their
existence check becomes a direct `prisma.movie.findUnique`, decoupling them from a read that now
means something narrower than "does this row exist".

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the scoping. Until `findOneFromDb` filters by the join, there is no state in which `web`'s unavailable page can be reached for an unowned film, so `web`'s slice cannot be verified. |
| 2 | `web` | Renders the outcome of step 1. |

**These two can genuinely run in parallel**, and this is the unusual case where that is safe: the
GraphQL contract does not move at all. The SDL is byte-identical before and after (`movie(id): Movie`
keeps its name, argument and nullability), and `web` already handles `movie: null` — it just handles
it with the wrong page. `web`'s slice is "render a Spanish page when the action returns null" plus a
route-param guard, neither of which depends on *why* the null arrives. Sequence them only if one
agent is doing both.

What must **not** overlap: the manual end-to-end pass (AC-2, AC-3, AC-7, AC-14) needs both slices
landed, and AC-14 needs the worker running.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. This feature is
unusual in that the freeze is mostly about what must *not* change:

- **`movie(id: Int!): Movie` keeps its exact SDL.** No rename, no new argument, no change to
  nullability. An implementer will be tempted to add a `userId` argument or make the return
  non-null and throw instead — both are wrong. The caller is identified by the credential, never by
  an argument, and the nullable return is what carries "not available to you".
- **`null` is the answer for both "does not exist" and "not yours".** Do not add a distinct error,
  a distinct message, or an `extensions` code that separates them. REQ-3 exists because separating
  them lets a caller enumerate other users' libraries, and `attachTorrentSource` already set this
  precedent deliberately.
- **`createUploadTicket` refuses with `La película <id> no existe`** — the exact string
  `attachTorrentSource` already throws. Not a new "no es tuya" string. `002-auth-login` froze five
  user-facing strings and `004-user-disable` added a sixth; this feature adds **none**.
- **No `@AllowService()` on `movie(id)`.** A service principal keeps being rejected by the guard
  with `No autenticado`. An implementer who sees the worker fail a call to this query has found a
  worker bug, not a missing decorator — the worker does not call it (NFR-5).
- **`web` keeps calling the same query with the same fields.** The unavailable page is a rendering
  decision, not a contract change.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, re-brief both services.
Never patch it from inside one slice (Article VIII).

## Migrations

**None.** `UserMovie` (`user_movies`, composite PK `[userId, movieId]`, index on `movieId`) was
created by `005-movie-search` and is already populated, including that feature's backfill of every
pre-existing film onto the oldest enabled admin. This feature only reads it.

Reversibility: full. Reverting the diff restores the previous behaviour with no data to undo.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The ownership `where` clause is dropped, or written against the wrong id | Every user sees every film again. The query succeeds, the page renders a real film with a real poster — the only wrong thing is whose it is. No error anywhere. | The `findOneFromDb` unit test asserts on the **call arguments** handed to Prisma, not the return value — a mocked client returns whatever it was told regardless of the query. Same technique as `shows.service.spec.ts:106`, which was verified to fail when its clause is removed. |
| `findFirst` is written with `where: { id }` and the join added as an `include` | Ownership becomes decorative: the film is returned regardless, with a `users` array attached. Compiles, no error, looks scoped in a diff. | Same argument-shape assertion. The test must assert `args.where` **equals** `{ id, users: { some: { userId } } }`, not that it merely contains `id`. |
| `MoviesController` is kept and patched with `findOneFromDb(id, '')` | Nothing fails now. If the controller is ever registered, every film 404s, and the empty-string userId reads as a deliberate sentinel rather than a paper-over. | The file is deleted. Verified by `grep -rn "MoviesController" services/api/src` returning nothing. |
| `createUploadTicket` is left unscoped because it "isn't the detail query" | A user standing on another user's detail page attaches a file to a film that is not theirs. The upload succeeds. The owner's film silently acquires someone else's source. | REQ-7 and AC-7. The check reuses `findOneFromDb`, so it cannot drift from the query's rule. |
| The `Number(id)` route param is not guarded | `/movies/abc` sends `NaN` as an `Int!`; the GraphQL error is not an auth error, so `redirectToClearSession` ignores it and `getMovieById` throws — a 500, not the unavailable page. | REQ-6, AC-5. The guard runs before the fetch, in both the page and `generateMetadata`. |
| `generateMetadata` keeps fetching and leaks the title | The page body hides the film but the browser tab shows its name. The most likely thing to be missed, because the page itself looks correct. | REQ-5, AC-6. Both entry points share the same `cache()`-wrapped read and the same guard. |
| Scoping `movie(id)` is assumed to break the worker | Someone "fixes" it by adding `@AllowService()`, reopening the hole this feature closes. | NFR-5 names the worker's eight operations and the `processJob` path it actually uses. AC-14 proves the pipeline end to end. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
```

Expected: `api` 0 errors and the suite green at **87 + the new cases** across 10 suites (no new
suite — the `findOneFromDb` cases join `movies.service.spec.ts`). `web` reports **exactly 12**
errors across the 5 pre-existing pre-GraphQL files and nothing else; `movies/[id]/page.tsx` and the
new `not-found.tsx` must not appear.

```bash
bin/npm web run lint
```

Not a repo-wide gate (~1598 pre-existing Biome errors). Judge the new/changed `web` files
individually — `not-found.tsx` and `page.tsx` should come back clean.

Then the manual pass, with two users (the seeded admin plus one created from `/users`):

1. As B, register a film from `/movies/add`. Note its id from the card link.
2. As B, open `/movies/<id>` — full detail renders, import buttons and release search present (AC-1).
3. As A, open `/movies/<id>` — the Spanish unavailable page, HTTP 404, no film data in the response
   body and none in the tab title (AC-2, AC-6). Confirm with the network panel, not just the eye.
4. As A, query `movie(id: <id>)` directly and diff it against `movie(id: 999999999)` — identical
   (AC-3). As B, the same query returns the film (AC-4).
5. `/movies/999999999` and `/movies/abc` both give the same page, no 500 in `bin/cli api` logs (AC-5).
6. As A, call `createUploadTicket(movieId: <id>)` — `La película <id> no existe`, no ticket in Redis
   (AC-7). As B, mint one and complete a real tus upload (AC-8).
7. As A, `addTorrentToMovie`/`addMagnetToMovie` on `<id>` still refuse with the same string (AC-9).
8. With `SERVICE_TOKEN` as bearer, `movie(id: <id>)` returns `No autenticado`, identical to a
   credential-less request (AC-13).
9. With `worker` up, take one of B's films through the full pipeline and confirm the output lands at
   `<outputRoot>/<Title> (<year>) [tmdbid=<id>]/<Title> (<year>).mkv` (AC-14).

Finally, AC-12: `docs/spec/graphql-contract.md` no longer claims `movie(id)` is unscoped.

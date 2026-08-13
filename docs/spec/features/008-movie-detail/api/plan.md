---
title: Movie Detail Resource, Scoped to Its Owner — api slice
service: api
last_updated: 2026-08-12
status: Implemented
---

# PLAN: Movie Detail Resource, Scoped to Its Owner — `api` (`api/plan.md`)

Read `../spec.md` and `../plan.md` first. The GraphQL delta in `../spec.md` is read-only.

## Scope

This slice makes two reads agree with the ownership rule the `movies/` module already enforces
everywhere else: `movie(id)` must resolve only against the caller's own library, and
`createUploadTicket(movieId)` must refuse a film the caller is not linked to. It also removes the
dead REST controller that stands in the way of the signature change.

**The SDL does not move.** `movie(id: Int!): Movie` and `createUploadTicket(movieId: Int!):
UploadTicket!` keep their exact shapes — no new argument, no changed nullability, no new error
string. `schema.gql` should come out of this byte-identical; if it does not, something was changed
that should not have been (Article IV: it regenerates from decorators, and no decorator here
changes).

Explicitly **not** this slice: the unavailable page and the route-param guard (`web` owns those —
see `../web/plan.md`); any change to the worker or to `processJob` (NFR-5 — the worker never calls
`movie(id)`); and adding `@AllowService()` to anything.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/movies/movies.service.ts` | Modified | `findOneFromDb(id, userId)` scopes through the `user_movies` join; `update`/`remove` stop using it as an existence check |
| `services/api/src/movies/movies.resolver.ts` | Modified | `getMovieById` takes `@CurrentUser()` and passes the caller's id |
| `services/api/src/movies/movies.controller.ts` | **Deleted** | Dead, unregistered REST controller — see `../plan.md` § A dead REST controller |
| `services/api/src/uploads/uploads.resolver.ts` | Modified | Ownership check before minting |
| `services/api/src/uploads/uploads.module.ts` | Modified | Imports `MoviesModule` to reach `MoviesService` |
| `services/api/src/movies/movies.service.spec.ts` | Modified | New `findOneFromDb` describe block (no new suite) |

## Existing code to reuse

- **`services/api/src/movies/movies.service.ts:270`** — `attachTorrentSource`'s
  `where: { id: movieId, users: { some: { userId } } }`. This is the module's one expression of
  "this film belongs to this caller". Copy the clause shape exactly; do not write a variant, do not
  extract it into a new helper for two call sites.
- **`services/api/src/movies/movies.service.ts:39`** — `findAll`'s
  `where: { users: { some: { userId } } }`, the same join read for the listing. `findOneFromDb`
  becomes its single-row sibling.
- **`services/api/src/movies/movies.resolver.ts:16-19`** — the `@CurrentUser()` +
  `principal.type === 'user' ? principal.id : ''` narrowing already used by `getMovies`. Copy it
  verbatim into `getMovieById`. It is structurally unreachable (the guard rejects service
  principals on an operation without `@AllowService()`), and it stays for the same reason it exists
  on its neighbours.
- **`services/api/src/movies/movies.module.ts:10`** — already `exports: [MoviesService]`. Nothing to
  add there; `UploadsModule` just imports the module.
- **`services/api/src/shows/shows.service.spec.ts:105-133`** — the `findAll` describe block. Its
  technique (assert on the arguments handed to a mocked Prisma, because the mock returns whatever it
  was told regardless of the query) is exactly what the new tests need. Follow its structure; write
  the prose in English.
- **`services/api/src/uploads/uploads.resolver.ts:23-25`** — the existing
  `principal.type !== 'user'` guard. The new check goes after it, so `principal.id` is already
  narrowed.

## Steps

1. **`movies.service.ts` — scope `findOneFromDb`.** Change the signature to
   `findOneFromDb(id: number, userId: string)` and the body from `findUnique({ where: { id } })` to
   `findFirst({ where: { id, users: { some: { userId } } }, include: { mediaSource: true,
   processJobs: true } })`. Keep the `include` exactly as it is — `web` reads `status` and the page
   is unchanged for an owner. Replace the stale comment above `findAll` (lines 35-38) that says
   "findOneFromDb() is deliberately left unscoped — movie(id) stays readable by any authenticated
   user"; it becomes false with this change and is the kind of comment a future reader trusts.

2. **`movies.service.ts` — decouple `update`/`remove`.** Both call `findOneFromDb(id)` purely to
   assert existence and have no user in scope. Replace each call with a direct
   `prisma.movie.findUnique({ where: { id } })` plus the `NotFoundException` they imply, so an
   existence check does not silently become an ownership check. These two methods have no caller
   once step 3 lands; leaving them correct is cheaper than reasoning about them later.

3. **Delete `movies.controller.ts`.** Registered in no module, referenced by nothing (verify:
   `grep -rn "MoviesController" services/api/src` must return nothing afterwards). Do **not** patch
   it with `findOneFromDb(id, '')`. Leave `dto/create-movie.dto.ts` and `dto/update-movie.dto.ts`
   alone — `MoviesService.create`/`update` still use them.

4. **`movies.resolver.ts` — pass the caller.** Add `@CurrentUser() principal: AuthPrincipal` to
   `getMovieById`, narrow it with the same ternary as `getMovies`, and pass the id through. Update
   the Spanish comment above it ("Si querés obtener una sola película por su ID interno de DB") to
   English, per Article VI, and say that the read is scoped to the caller's library.

5. **`uploads.module.ts` — import `MoviesModule`.** Add it to `imports`. Watch for a circular
   import: `MoviesModule` imports `RedisModule` and `SettingsModule` only, so there is none — if
   Nest reports one, stop and report rather than reaching for `forwardRef`.

6. **`uploads.resolver.ts` — check ownership before minting.** Inject `MoviesService`. After the
   existing `principal.type !== 'user'` guard, call `findOneFromDb(movieId, principal.id)` and throw
   `NotFoundException(\`La película ${movieId} no existe\`)` when it returns null. **That exact
   string** — the one `attachTorrentSource` already throws. No new message.

7. **`movies.service.spec.ts` — add the `findOneFromDb` block.** See § Tests.

Note on the tus path: `uploads.service.ts`'s `handleUploadFinish` still does a bare
`prisma.movie.findUnique({ where: { id: movieId } })` (line 129). It stays as is and is not a hole:
a ticket is now only mintable for a film the caller owns, `verifyAndSpend` binds the ticket to that
`movieId`, and the ticket TTL is short. Do not add a second ownership check there — it would need a
user id the REST request does not carry as a session.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, which this service must expose exactly:

- `movie(id: Int!): Movie` — **unchanged SDL**. Returns the film when the caller is linked to it via
  `user_movies`; returns `null` otherwise. `null` must be returned for a non-existent id and for an
  unowned film **identically**: same value, no `errors` array, no `extensions` code distinguishing
  them. A caller must not be able to tell the two apart.
- `createUploadTicket(movieId: Int!): UploadTicket!` — **unchanged SDL**. Throws
  `NotFoundException` with message `La película <id> no existe` when the caller is not linked to the
  film. Same string as a missing film.
- Neither operation gains `@AllowService()`. A `service` principal keeps being rejected by the
  global guard with `No autenticado` — the same string as no credential at all
  (`auth/guards/jwt-auth.guard.ts:50-55`).
- `addTorrentToMovie` / `addMagnetToMovie` / `movies` / `searchMedia` / `addMedia` are untouched.

The delta is read-only. If it is wrong, stop and report — do not adapt it locally.

## Tests

Article IX applies squarely here: a dropped ownership clause produces **no error anywhere**. The
query succeeds, `movie` resolves a real film with a real poster, and the page renders correctly —
the only wrong thing about the response is whose library it came from.

Add a `describe('findOneFromDb')` block to the existing
`services/api/src/movies/movies.service.spec.ts` (the tenth suite; do **not** create an eleventh —
`007-library-listing` set that precedent). Extend the suite's header comment with the failure this
block defends against. Cases:

- **scopes the query to the caller through the `user_movies` join** — assert on the arguments handed
  to the mocked `prisma.movie.findFirst`: `args.where` must **equal** `{ id: 7, users: { some: {
  userId: 'user-1' } } }`. Equality, not a partial match — a version that keeps `where: { id }` and
  moves the join into `include` would pass a looser assertion while being entirely unscoped.
- **returns null for a film the caller is not linked to** — the mock resolves `null`; the method
  must return `null`, not throw. `web` depends on the null.
- **returns the same null for an id that does not exist** — REQ-3. The two cases must be
  indistinguishable from the caller's side.
- Verify the first case actually fails when the `users` clause is removed, the way
  `shows.service.spec.ts`'s equivalent was verified. A test that passes against the bug is worse
  than no test.

Also owed: a case for the `createUploadTicket` refusal, in
`services/api/src/uploads/upload-tickets.service.spec.ts` **only if** the check lands in that
service. Per step 6 it lands in the resolver, and the existing suite covers ticket minting and
spending rather than resolver wiring — so instead assert the refusal through the `findOneFromDb`
block above (the resolver's check is a direct call to it) and cover the end-to-end refusal with
AC-7 in the manual pass. State this reasoning in the report rather than silently skipping it.

Not owed: the resolver's `principal.type === 'user' ? … : ''` narrowing. It is structurally
unreachable given the guard, its neighbours are untested for the same reason, and a test would
assert TypeScript's behaviour rather than the system's.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
```

Expected: **0** typecheck errors (the count before this slice was 0 — report both numbers), and the
suite green across **10** suites with the new `findOneFromDb` cases added to the existing 87. No new
suite file.

```bash
grep -rn "MoviesController" services/api/src
```

Expected: no output.

Also confirm `services/api/src/schema.gql` is unchanged in the diff. It regenerates on boot; if it
differs, a decorator was changed that should not have been.

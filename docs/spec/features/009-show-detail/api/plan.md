---
title: Show Detail Screen — api slice
service: api
last_updated: 2026-08-13
status: Implemented
---

# PLAN: Show Detail Screen — `api` (`api/plan.md`)

## Scope

`api` adds a single ownership-scoped read, `show(id: Int!): Show`, that returns a show together
with its seasons and each season's episodes, ordered server-side. It is the structural twin of
`movie(id)` (`008-movie-detail`) one level deeper. `api` does **not** touch any acquisition path
(torrent search, magnet, upload) for episodes — those stay exactly as they are today (dead ends for
non-movie media), since `spec.md` explicitly keeps them out of scope. `api` does not add a `type`
discriminant to `Show`, migrate any schema, or touch anything under `services/web`.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/shows/entities/season.entity.ts` | New | `@ObjectType() Season`: `id`, `seasonNumber`, `releaseDate`, `episodes: [Episode!]!` |
| `services/api/src/shows/entities/episode.entity.ts` | New | `@ObjectType() Episode`: `id`, `episodeNumber`, `title`, `overview`, `releaseDate`, `status` |
| `services/api/src/shows/entities/show.entity.ts` | Modified | adds `@Field(() => [Season]) seasons: Season[]` |
| `services/api/src/shows/shows.service.ts` | Modified | adds `findOneFromDb(id, userId)` |
| `services/api/src/shows/shows.resolver.ts` | Modified | adds `show(id: Int!): Show` query, `nullable: true`, same `principal.type === 'user' ? principal.id : ''` narrowing as `getShows` |
| `services/api/src/shows/shows.service.spec.ts` | Modified | adds a `findOneFromDb` `describe` block |
| `docs/spec/graphql-contract.md` | Modified | new `009-show-detail` section documenting `show(id)`, following the `007`/`008` sections' shape |

No other file in `services/api` is expected to need a change. If one does, stop and report rather
than expanding the diff quietly.

## Existing code to reuse

- `services/api/src/movies/movies.service.ts:54` (`findOneFromDb`) — the exact ownership clause to
  copy: `this.prisma.show.findFirst({ where: { id, users: { some: { userId } } }, include: {...} } })`.
  Swap `movie`/`users: { some: { userId } }` (via `UserMovie`) for `show`/`users: { some: { userId } }`
  (via `UserShow` — same relation name on the `Show` model, see `shows.service.ts:41-42`'s `findAll`
  for the identical filter shape already in this file).
- `services/api/src/movies/movies.resolver.ts:24-28` (`getMovieById`) — the resolver shape to copy
  line for line: `@Query(() => Show, { name: 'show', nullable: true })`, `@Args('id', { type: () =>
  Int })`, the same `principal.type === 'user' ? principal.id : ''` narrowing already used by
  `shows.resolver.ts`'s existing `getShows`.
- `services/api/src/shows/entities/show.entity.ts` — the entity style to copy for the two new
  entities: plain `@ObjectType()` classes, `@Field({ nullable: true })` for optional Prisma columns,
  `status` as a bare `@Field()` (`string`) never `registerEnumType`'d, matching the header comment
  already on this file about why.
- `services/api/prisma/schema.prisma`'s `Season`/`Episode` models — the field list the two new
  entities must match exactly; no new column, this is a read-only projection.
- `services/api/src/movies/movies.service.spec.ts:155-187` (`findOneFromDb` block) — the test shape
  to copy: one case asserting the Prisma `where` clause by full equality, one case for "not linked to
  the caller", one case for "id does not exist", both resolving to the same `null`.

## Steps

1. Create `shows/entities/episode.entity.ts` — `@ObjectType() Episode` with `id: ID`, `episodeNumber:
   Int`, `title?: string`, `overview?: string`, `releaseDate?: Date`, `status: string`. No image
   field — the Prisma model has none.
2. Create `shows/entities/season.entity.ts` — `@ObjectType() Season` with `id: ID`, `seasonNumber:
   Int`, `releaseDate?: Date`, `episodes: () => [Episode]` (import `Episode` from
   `./episode.entity`).
3. Add `@Field(() => [Season]) seasons: Season[]` to `shows/entities/show.entity.ts`, importing
   `Season` from `./season.entity`. Update the file's existing header comment (it currently says
   `Show` is a "field-for-field twin of Movie... minus the film-only fields" — note the new
   `seasons` field is the one place that stops being true, and why).
4. Add `ShowsService.findOneFromDb(id: number, userId: string)`:
   ```ts
   async findOneFromDb(id: number, userId: string) {
     return this.prisma.show.findFirst({
       where: { id, users: { some: { userId } } },
       include: {
         seasons: {
           orderBy: { seasonNumber: 'asc' },
           include: { episodes: { orderBy: { episodeNumber: 'asc' } } },
         },
       },
     });
   }
   ```
   Place it next to `findAll`, matching `MoviesService`'s layout (`findAll` then `findOneFromDb`).
5. Add `ShowsResolver.getShowById`:
   ```ts
   @Query(() => Show, { name: 'show', nullable: true })
   async getShowById(@Args('id', { type: () => Int }) id: number, @CurrentUser() principal: AuthPrincipal) {
     const userId = principal.type === 'user' ? principal.id : '';
     return this.showsService.findOneFromDb(id, userId);
   }
   ```
   Import `Args`, `Int` from `@nestjs/graphql` (not yet imported in this file — only `Resolver`,
   `Query` are today).
6. Extend `shows.service.spec.ts` with a `findOneFromDb` `describe` block: the ownership `where`
   assertion (full equality, not `objectContaining`), the "not linked" → `null` case, the "id doesn't
   exist" → same `null` case, and one case asserting the nested `orderBy` shape is present in the
   `include` passed to Prisma (mock `findFirst` to return a fixed shape and assert on
   `args.include.seasons.orderBy` / `args.include.seasons.include.episodes.orderBy`).
7. Add the `009-show-detail` section to `docs/spec/graphql-contract.md`, following the structure of
   the existing `007-library-listing`/`008-movie-detail` sections: the SDL, the four bullet points
   from `spec.md`'s Contract Delta (status-as-string, no image field, `null` semantics, no
   `@AllowService()`), and a note that `web` retypes this by hand with no codegen.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta — this is what `api` must expose, verbatim:

```graphql
type Episode {
  id: ID!
  episodeNumber: Int!
  title: String
  overview: String
  releaseDate: DateTime
  status: String!
}

type Season {
  id: ID!
  seasonNumber: Int!
  releaseDate: DateTime
  episodes: [Episode!]!
}

type Show {
  # existing fields unchanged
  seasons: [Season!]!
}

type Query {
  show(id: Int!): Show
}
```

Error behavior owed to `web`: `show(id)` returns `null` for a nonexistent id and for a show the
caller has no `UserShow` link to — the same value, no `errors`, no `extensions` code, matching
`movie(id)`. A `SERVICE_TOKEN` principal is rejected by the global `JwtAuthGuard` before the
resolver runs (`No autenticado`) — do not add `@AllowService()`.

This delta is read-only. If a field or ordering guarantee here turns out to be wrong once `web`
starts consuming it, stop and report to the orchestrator rather than adjusting it locally.

## Tests

- `services/api/src/shows/shows.service.spec.ts` — new `findOneFromDb` block. Defends against the
  same class of bug `008-movie-detail`'s equivalent test defends against: a query that resolves a
  show (and its seasons/episodes) for any authenticated caller instead of just the one linked to it
  would still return a real, correctly-shaped record — no exception, no wrong-looking data, just the
  wrong owner. Also defends against nested `orderBy` silently missing, which would only surface as
  episodes appearing in the wrong order on screen, not as an error anywhere (Constitution, Article
  IX — both are "succeeds with wrong content" bugs).
- No test is owed for the two new entity files — they are declarative field lists with no logic,
  the same reason `show.entity.ts`/`movies.entity.ts` have no spec today.
- No test is owed for the resolver method itself — `ShowsResolver` has no existing spec file (same
  as `MoviesResolver`), and its one line (`principal.type === 'user' ? principal.id : '' ` then
  delegate) carries no logic beyond what `findOneFromDb`'s tests already cover.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
```

Expected: 0 TypeScript errors; the existing `shows.service.spec.ts` suite passes with the new
`findOneFromDb` block included, no new suite file, no regression in the other 9 suites' pass count.

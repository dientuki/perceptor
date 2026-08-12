---
title: Library Listing for Movies and Shows — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-12
status: Implemented
---

# PLAN: Library Listing for Movies and Shows (`plan.md`)

## Approach

This feature is deliberately the least inventive possible: `movies` already works end to end, and
every piece of it has a `shows` counterpart that is either missing or half-written. The plan is to
complete the counterpart by following the existing file, not by abstracting the two together.

On `api`, `MoviesService.findAll(userId)` (`services/api/src/movies/movies.service.ts:39`) is the
model — a single `findMany` filtered through the join (`where: { users: { some: { userId } } }`)
ordered `createdAt: 'desc'`. `ShowsService` gains a `findAll(userId)` shaped the same way against
`show`/`user_shows`, minus the `include` (there is no `mediaSource`/`processJobs` on `Show`, and
seasons are out of scope). The resolver is the other half: `shows/` has no resolver at all today, so
a new `ShowsResolver` is created following `MoviesResolver`'s exact shape, including the
`principal.type === 'user' ? principal.id : ''` narrowing on line 19 that makes the service
principal resolve to an empty library. That narrowing is copied deliberately — it is what REQ-5
specifies, and it is the reason no `ForbiddenException` appears in the contract.

The entity is the one genuinely new type. `Show` is a new `@ObjectType()` under
`services/api/src/shows/entities/`, modelled field-for-field on
`services/api/src/movies/entities/movies.entity.ts` — `id` as `ID`, `tmdbId` as `Int`, dates as
`DateTime`, `status` as a plain `String!` exactly as `Movie.status` already is. **`findAll` is not
added to `MediaTypeService`** (`services/api/src/media/media-type.interface.ts`) and
`MediaDispatchService` is not touched: the spec rejected a parameterized listing, and widening that
interface would drag both services back toward the shared shape the spec declined.

On `web`, `getMovies()` in `services/web/src/actions/movies.ts` is the model for a new
`getShows()` in a new `services/web/src/actions/shows.ts`. The rendering side needs almost nothing
new: `MediaList` (`services/web/src/components/media/MediaList.tsx`) already accepts
`mediaType={MEDIA_TYPE.SHOW}` and already emits "No hay series registradas" for the empty case, and
`MediaCard` already renders poster/title/year off a generic `item`. So the web slice is one server
action plus fixing the two untracked, broken files — `app/(dashboard)/shows/page.tsx` and
`components/Shows/Shows.tsx` — to point at the right component and the right action.

The real alternative on `web` was to delete `components/Shows/` and parameterize
`components/movies/Movies.tsx` by media type, the way `SearchContainer` was parameterized in
`006-media-search`. Rejected for the same reason the API stays split: `Movies.tsx` is a 30-line
`useEffect` fetch, the duplication is trivial, and REQ-7 requires the film listing to come out of
this feature byte-identical — parameterizing it would touch it.

## Order of Work

`api` first, and strictly first. `web`'s slice consumes a `shows` query that does not exist yet;
starting it in parallel means writing a server action against an unverifiable shape, which is
exactly the failure mode the no-codegen gap produces.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration (`Show.status`) and the `Show` type. Nothing else can be verified until `schema.gql` regenerates with `shows` in it. |
| 2 | `api` | The `shows.service.spec.ts` case for the ownership filter — same slice, same agent, but a separate task so it is not skipped when the resolver "works". |
| 3 | `web` | Cannot render a query the schema does not have. Needs `api` up to verify anything at all. |
| 4 | `[docs]` | `graphql-contract.md`, the two `CLAUDE.md`s, and the pipeline table — after both slices land, so the recorded typecheck/test counts are the real post-change ones. |

**Nothing in this feature runs in parallel.** With two services, one contract addition and a strict
dependency between them, there is no overlap worth the coordination. Step 2 could in principle
overlap step 3, but both are cheap and sequencing them keeps a single agent's report readable.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Implementers read
it; they do not edit it. What an implementer will be tempted to change, and must not:

- **`status: String!` and not an enum.** From inside `api` this looks plainly wrong — the column
  *is* a Prisma enum after this migration, and `@Field(() => MediaStatus)` with a
  `registerEnumType` is the idiomatic Nest thing to write. It is wrong for the feature: `Movie.status`
  already crosses as `String!`, `web`'s `Movie` type declares `status: string`, and introducing a
  GraphQL enum for `Show` alone makes the two listings structurally different in the one place the
  spec is trying to keep them identical. If the enum should cross the boundary, that is a change to
  *both* types and its own feature.
- **`seasonsSyncedAt` on the type but not on the screen.** `web` will notice it fetches a field it
  never renders and will want to drop it from the query document. Leave it: it is in the contract
  so the detail-page feature does not have to reopen it, and a field in the SDL that no consumer
  selects costs nothing.
- **No `type` field on `Show`.** `web` will discover that adding `type: "show"` to the payload would
  make `MediaCard`'s link point at `/shows/<id>` and fix the broken link in one line. It must not.
  The destination page does not exist yet (`app/(dashboard)/shows/[id]/page.tsx` is an untracked
  paste that fetches a *movie* by that id), so the one-line "fix" would send users to a page that
  renders the wrong title or 404s. This is the next spec, whole.
- **`MediaTypeService` stays at two methods.** No `findAll`/`list` added, no dispatch entry.

If the contract turns out to be wrong mid-flight: stop, amend `spec.md`, re-approve, re-brief both
services. Never patch it from inside one slice (Constitution, Article VIII).

## Migrations

One migration, owned by `api`.

1. `add_show_status_enum` — alters `shows.status` from `varchar` (nullable) to the `MediaStatus`
   enum, non-null, `@default(MISSING)`. Generated through `bin/npm api run prisma:migrate`, never
   hand-written SQL against a running database (Constitution, Article III).
2. Backfill: every existing row to `MISSING`. The column is **all-NULL in every deployed database**
   — nothing in the codebase has ever written `shows.status`, confirmed by grep across
   `services/api/src` — so this is a single `UPDATE shows SET status = 'MISSING'` and not a data
   migration with judgment calls. Prisma will generate the `ALTER`; the implementer must verify the
   generated SQL contains the backfill (or precedes the `NOT NULL` with one) rather than assuming
   `@default` covers existing rows, **because it does not** — a `DEFAULT` applies to future inserts,
   and MariaDB will either fail the `ALTER` or silently coerce NULLs to the enum's first value
   depending on strict mode. Verified by AC-9.
3. Ordering: the migration lands before the resolver is wired, so a boot never exposes a `status:
   String!` field over a column that can still be NULL — that combination is a GraphQL non-null
   violation at read time, which surfaces as a whole-query error, not a null field.

Reversibility: rolling back means widening the column back to nullable `varchar`. Nothing is lost —
every value is `MISSING`, which carries no information that did not already exist as NULL. The
`Show` type and `shows` query are purely additive and can be dropped without affecting films.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `findAll` forgets the `users: { some: { userId } }` filter | Every user sees every series in the database. **No error anywhere** — the page renders, the cards look right, and it is only wrong if you know whose library it should be. This is the single highest-value defect in the feature. | AC-1 + a `shows.service.spec.ts` case that asserts the `where` clause carries the caller's id (step 2 is its own task so it cannot be dropped) |
| Service principal resolves to `userId: ''` and the filter is dropped rather than matching nothing | `SERVICE_TOKEN` returns the whole `shows` table to the worker or the AutoRun hook. Silent — nothing logs it. | AC-6 asserts `[]` explicitly; the resolver copies `movies.resolver.ts:19` verbatim rather than reinventing the narrowing |
| Migration marks the column `NOT NULL` without backfilling | On a database with existing series the migration fails loudly (good) — or, under a non-strict MariaDB mode, coerces NULLs to the enum's first value and passes silently (bad). `MISSING` *is* the first value, so the silent path happens to produce the right data, which means a missing backfill would go unnoticed until a later enum reorder. | Migrations step 2 above; AC-9 queries the actual rows rather than trusting the migration exited 0 |
| `web` copies `getMovies()` including `redirectIfUnauthenticated` into a Server Component render path | Cookie mutation is illegal during a Server Component render — it throws instead of redirecting. This is the exact trap `004-user-disable` documented in `services/web/CLAUDE.md`. | `Shows.tsx` is a **client** component calling the action from `useEffect`, same as `Movies.tsx`, so `redirectIfUnauthenticated` is correct here — but the web plan states the rule so the agent picks by caller context, not by copying |
| Someone "fixes" the series card link in passing | Users land on `/shows/<id>`, which renders a movie fetched by that id — a real film with a coincidentally matching id, shown under a series' name. Wrong content, no error. | Contract Freeze above; Out of Scope in `spec.md`; the `web` plan names the file and says do not touch it |
| `Show` entity drifts from `Movie`'s field conventions (`ID` vs `Int` for id, `Date` vs `String` for dates) | `web` hand-retypes the shape; a `tmdbId` that arrives as `ID!` instead of `Int!` deserialises to a string and any arithmetic on it silently misbehaves. No codegen catches it. | The delta in `spec.md` is field-exact; the `api` plan says model it on `movies.entity.ts` line for line |

## Verification

Both services must be up — `web` and `api` are **not currently running** (`docker compose ps` shows
only `db`, `redis`, `torrent`, `indexer`, `traefik`), so start the stack first.

```bash
bin/dev
```

```bash
bin/npm api run prisma:migrate
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/mysql -e 'select status, count(*) from shows group by status'
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
```

Expected: `api` typecheck 0 errors (baseline is 0 — anything else is this feature's fault); `api`
tests green at 84 + the new cases; the `shows` status query returns only `MISSING` with zero NULLs;
`web` typecheck **12 errors across the 5 documented pre-GraphQL files and no sixth**. Note that
`bin/npm web run build` still fails on those 12 — see `spec.md` AC-10; it is not a gate here.

The GraphQL pass, against `api` directly (playground is on outside production):

```bash
bin/cli api sh -c 'curl -s -X POST localhost:${API_PORT}/graphql -H "Content-Type: application/json" -H "Authorization: Bearer $SERVICE_TOKEN" -d "{\"query\":\"{ shows { id title status } }\"}"'
```

Expected `{"data":{"shows":[]}}` — AC-6. Then the same query with a real user's JWT for AC-1..AC-4,
and with no `Authorization` header at all for AC-5 (`Unauthorized`).

The manual pass:

1. Sign in as user A, go to `/shows/add`, register two series. Go to `/shows` — both appear as
   cards with poster, title and year, most recent first (AC-4, AC-11).
2. Sign in as user B (create one from `/users` if needed), go to `/shows` — the empty state reads
   "No hay series registradas" (AC-12). Register one of A's two series from `/shows/add`; it now
   appears for B, and A still sees exactly two (AC-1, AC-2).
3. Open `/movies` as A and confirm it is unchanged (AC-11).
4. `git diff services/api/src/schema.gql` — only the `Show` type and the `shows` query (AC-13).

Clicking a series card is expected to navigate to `/movies/<id>` and show the wrong thing. That is
the known, deliberate gap; do not report it as a defect.

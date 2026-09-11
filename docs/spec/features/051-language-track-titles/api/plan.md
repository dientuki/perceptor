---
title: Language track titles move to the database — api slice
service: api
last_updated: 2026-09-10
status: Implemented
---

# PLAN: Language track titles move to the database — `api` (`api/plan.md`)

## Scope

`api` owns the column, the migration, the backfill and the new `trackTitles` query. It also owns the
one piece of knowledge this feature is moving out of the worker: **which row supplies the title when
several share an `iso3`**. That collapse happens here and is published already resolved, so no
consumer ever sees the ambiguity.

`api` is **not** changing anything the worker does with the value, and is **not** adding the field to
the `Language` GraphQL type — `languages` stays exactly the pickable catalog `web` renders today
(`web` is not in this feature's `services:` list and must not need a change). Writes are confined to
`services/api/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` | Modified | `Language` gains `trackTitle String?`. No other field on the model is touched — `tag` in particular keeps its type and its `@unique` |
| `prisma/migrations/<ts>_add_language_track_title/migration.sql` | New | The generated `ALTER TABLE`, plus the 20 `UPDATE` backfill statements appended below it |
| `prisma/seeds/languages.ts` | Modified | Each of the 20 base entries in the `languages` array gains its `trackTitle`; `es-419`/`es-ES` do not |
| `src/languages/entities/language-track-title.entity.ts` | New | `@ObjectType()` with two non-null `String` fields, `iso3` and `title` |
| `src/languages/languages.service.ts` | Modified | New `findTrackTitles()` method beside `findAll()` |
| `src/languages/languages.resolver.ts` | Modified | New `trackTitles` query delegating to it |
| `src/languages/languages.service.spec.ts` | Modified | Cases for the collapse rule and the exclusions |
| `src/schema.gql` | Regenerated | Never edited by hand (Article IV) — it changes because the decorators did |

## Existing code to reuse

- `src/languages/languages.service.ts` — `findAll()` is the model to follow, and its base-row rule
  (`tag === iso2` when more than one row shares that `iso2`) is the **same** rule `findTrackTitles()`
  needs, applied for the opposite purpose: `findAll()` uses it to decide what to hide from the
  picker, `findTrackTitles()` uses it to decide which row wins an `iso3`. Do not write a second,
  differently-worded version of that test — factor it out only if it reads better, and if factoring
  it out changes `findAll()`'s behaviour in any way, stop and report.
- `src/languages/languages.module.ts` — already provides both the service and the resolver; the
  global `PrismaModule` already supplies `PrismaService`. No module changes are needed, and adding
  one would be a second way to wire something already wired.
- `src/languages/entities/language.entity.ts` — the `@ObjectType()`/`@Field()` shape the new entity
  copies. It is otherwise **untouched**: no `trackTitle` field is added to it.
- `src/database/seed/production-seed.ts` → `prisma/seeds/languages.ts` — the seed path that a fresh
  install and `bin/dbreset` both run. Its find-then-create loop stays as it is; only the data array
  grows.

## Steps

1. Add `trackTitle String?` to `model Language` in `prisma/schema.prisma`.
2. Generate the migration with `bin/npm api run prisma:migrate`, named `add_language_track_title`.
3. Append the backfill to the **generated** `migration.sql` — 20 `UPDATE languages SET trackTitle =
   '<value>' WHERE tag = '<tag>';` statements, exactly the table in `../spec.md` REQ-2. Nothing for
   `es-419` or `es-ES`. Write the native scripts as literal UTF-8; do not escape them.
4. Immediately verify the encoding survived the round trip:
   `bin/mysql -e "select tag, trackTitle from languages where tag in ('ja','ko','ru','ar','th','hi')"`.
   If any prints `?` or mojibake, **stop and report** — the column or table charset is not `utf8mb4`,
   and a second `UPDATE` over mangled bytes will not fix it.
5. Add the `trackTitle` values to the 20 base entries in `prisma/seeds/languages.ts`.
6. Add `src/languages/entities/language-track-title.entity.ts`.
7. Add `findTrackTitles(): Promise<LanguageTrackTitle[]>` to `LanguagesService`: read every row, keep
   only rows with a non-null, non-empty `trackTitle`, and where several surviving rows share an
   `iso3`, keep the base row (`tag === iso2`). Return one entry per `iso3`.
8. Add the `trackTitles` query to `LanguagesResolver`, mirroring how `languages` is declared
   (`@Query(() => [LanguageTrackTitle], { name: 'trackTitles', description: … })`). No `@Public()` —
   it stays behind the global `JwtAuthGuard`, which the worker's `SERVICE_TOKEN` satisfies (NFR-4).
9. Restart `api` and confirm the regenerated `src/schema.gql` matches `../spec.md`'s delta exactly —
   including that `type Language` did **not** gain a field.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

```graphql
type LanguageTrackTitle {
  iso3: String!
  title: String!
}

type Query {
  trackTitles: [LanguageTrackTitle!]!
}
```

Both fields non-null. A row with no title contributes **no entry** — never an entry with an empty or
null `title`. The list is unordered as far as the contract is concerned; the worker builds a
`Record` from it and never depends on order.

`api` introduces no new error condition here. The query reads seeded data, takes no arguments, and
cannot fail on user input. Do not add a "no languages seeded" throw — an empty list is a legal
answer that the worker already handles as REQ-8's fallback.

## Tests

`src/languages/languages.service.spec.ts` — the collapse rule is exactly the class of bug Article IX
is about: every wrong answer here is a valid-looking list that produces silently mistitled tracks
hours later, in a different service, with no error anywhere. Cases owed:

- Three rows share `iso3: 'spa'` (`es`, `es-419`, `es-ES`) → exactly one `spa` entry, and its title
  is the base row's `Español`. This is the case that fails if the collapse picks a variant row, and
  it fails *silently*: `es-ES` carries no title, so picking it drops `spa` from the list entirely and
  every Spanish track ends up titled `spa`.
- `es-419`/`es-ES` never appear as entries of their own — the response is keyed by `iso3`, and their
  titles belong to `variants.ts` in the worker (REQ-6).
- A row whose `trackTitle` is `null` produces no entry at all, rather than an entry with an empty
  title (REQ-8, AC-6).
- The seeded set yields 20 entries with `jpn → 日本語`, `kor → 한국어`, `fre → Français` among them
  (AC-1), asserting the native script survives as a string.

`LanguagesResolver` is owed no test: it is a one-line delegation with no logic, and the existing
resolvers in this service are not tested either.

## Done when

```bash
bin/cli api npx tsc --noEmit
bin/npm api test
bin/mysql -e "select tag, iso3, trackTitle from languages order by tag"
```

Typecheck at 0 errors; the suite green with a count higher than before by the cases above and no
previously-passing test broken; the `select` printing native script for all 20 base rows and `NULL`
for `es-419` and `es-ES`.

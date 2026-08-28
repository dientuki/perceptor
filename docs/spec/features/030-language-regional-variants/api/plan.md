---
title: Language Regional Variants — api slice
service: api
last_updated: 2026-08-28
status: Implemented
---

# PLAN: Language Regional Variants — `api` (`api/plan.md`)

## Scope

This service owns everything except the screen. It adds `Language.tag`, drops the unique index on
`Language.iso2`, seeds the two Spanish variant rows, switches all three language write paths from
validating `iso2` to validating `tag`, filters base-with-variants rows out of the `languages` query,
and extends the encode merge to emit `allowedLanguageTags` beside the existing
`allowedLanguagesIso3`.

It is **not** building the picker, not touching display copy, and not deciding how a variant is
presented — that is `web`'s slice. It is also **not** changing anything the worker reads: the new
payload field is additive and the worker is not modified by anyone in this feature (NFR-4). Writes
are confined to `services/api/` and this directory; anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` | Modified | `Language.tag String @unique`; `iso2` loses `@unique` |
| `prisma/migrations/<ts>_add_language_tag/` | New | The migration above, created with `--create-only` |
| `prisma/seeds/languages.ts` | Modified | Every row gains `tag`; `es-419` and `es-ES` added; `create` → `upsert` for NFR-2 |
| `src/languages/entities/language.entity.ts` | Modified | `@Field() tag: string` |
| `src/languages/language-names.ts` | Modified | Keyed by tag; entries for `es-419`, `es-ES` |
| `src/languages/languages.service.ts` | Modified | `findAll` filter; validator keyed by `tag`; both setters take tags |
| `src/languages/languages.service.spec.ts` | Modified | Cases for the filter and for tag validation |
| `src/movies/movies.resolver.ts` | Modified | `@Args('iso2')` → `@Args('tags')` on `setMoviePreferredLanguages` |
| `src/shows/shows.resolver.ts` | Modified | Same rename on `setShowPreferredLanguages` |
| `src/settings/settings.service.ts` | Modified | The `kind: 'languages'` branch passes tags through |
| `src/process-jobs/process-jobs.service.ts` | Modified | `resolveIso3` → `resolveOriginalLanguage`; merge emits both lists |
| `src/process-jobs/entities/encode-job-details.entity.ts` | Modified | `@Field(() => [String]) allowedLanguageTags` |
| `src/process-jobs/process-jobs.service.spec.ts` | Modified | Cases for the tag list and the base-row lookup |
| `src/schema.gql` | Regenerated | Artifact of boot, never hand-edited (Article IV) |

## Existing code to reuse

- `src/languages/languages.service.ts` — `validateAndResolveLanguageIds` is already the **one**
  validator behind both per-title mutations and `SettingsService`'s `default_languages` branch
  (public since `029-settings-screen-tabs`). Change the column it queries; do not add a second
  validator for tags beside it. Its duplicate check and its validate-everything-before-writing
  ordering are load-bearing and stay exactly as they are.
- `src/languages/languages.service.ts` — `setMoviePreferredLanguagesFor` /
  `setShowPreferredLanguagesFor` already replace the whole set atomically (`deleteMany` +
  `createMany` in a `$transaction`). Only the parameter's meaning changes; the transaction does not.
- `src/i18n/i18n-error.ts` + `src/i18n/error-keys.ts` — `LANGUAGE_DUPLICATE` and
  `LANGUAGE_UNAVAILABLE` already exist. **Reuse both keys unchanged**; only their `params` payload
  goes from `{ iso2 }` to `{ tag }`. Do not mint a new key for a tag that does not resolve — it is
  the same failure as before with a different alphabet.
- `src/i18n/messages.en.ts` — the two English renderings interpolate `{iso2}` today and become
  `{tag}`. `api` only ever produces English; the Spanish copy is `web`'s (REQ-11).
- `src/process-jobs/process-jobs.service.ts` — `collectAllowedLanguages` already owns the
  original-first, `Set`-deduplicated merge. Extend that one walk to carry tags alongside iso3 codes;
  do not add a second merge method that re-reads the same owners.
- `prisma/seeds/settings.ts` — the create-only idiom (`findUnique` before `create`) that keeps a
  re-run from clobbering a real value. `seedLanguages` currently uses a bare `create` and must adopt
  an equivalent (NFR-2).

## Steps

1. **Schema.** In `prisma/schema.prisma`, add `tag String @unique` to `Language` and remove
   `@unique` from `iso2`. Generate the migration **without applying it**
   (`bin/npm api run prisma:migrate -- --create-only`), then `bin/dbreset` — see `../plan.md` §
   Migrations for why the plain apply fails on a populated table.

2. **Seed.** In `prisma/seeds/languages.ts`, give every existing row a `tag` equal to its `iso2`,
   add `{ tag: 'es-419', iso2: 'es', iso3: 'spa' }` and `{ tag: 'es-ES', iso2: 'es', iso3: 'spa' }`,
   and make the loop idempotent (`upsert` on `tag`, or `findUnique`-then-`create` like
   `seeds/settings.ts`). The `es` row stays — `resolveOriginalLanguage` needs it.

3. **Entity and names.** Add `tag` to `Language` (`entities/language.entity.ts`). Re-key
   `LANGUAGE_NAMES` in `language-names.ts` by tag and add English labels for the two variants.
   `languageNameFor` keeps its fallback-to-the-code behaviour rather than throwing.

4. **Catalog filter.** In `LanguagesService.findAll()`, omit a row whose `tag` equals its `iso2`
   **only when another row shares that `iso2`**. Read `../plan.md` § Risks before writing this: the
   naive form of the rule ("tag equals iso2") hides every ordinary language.

5. **Validator.** Point `validateAndResolveLanguageIds` at `tag` — parameter name, the `findMany`
   `where`, the map key, and the `{ tag }` params on both thrown errors. It validates against the
   **whole table, not the filtered catalog**: `es` submitted directly is accepted, because the
   validator's question is "is this a language we have a row for?" and `es` is one. See § Contract
   obligations for why this is deliberate.

6. **Mutation arguments.** Rename `@Args('iso2')` to `@Args('tags')` in `movies.resolver.ts` and
   `shows.resolver.ts`, and the parameter that carries it. The ownership guard above each call
   (`findOneFromDb` → `MOVIE_NOT_FOUND` / `SHOW_NOT_AVAILABLE`) is untouched (NFR-6).

7. **Settings.** `SettingsService.updateMany`'s `kind: 'languages'` branch keeps its split/trim/
   drop-empty normalization exactly as it is — only the vocabulary it forwards changes. Nothing in
   `settings.catalog.ts` changes.

8. **Original language lookup.** Replace `ProcessJobsService.resolveIso3(iso2)` with
   `resolveOriginalLanguage(iso2)` returning `{ tag, iso3 }`, looking up **by `tag`** (a base row's
   tag is its ISO-639-1 code). Keep the existing fallback behaviour for an unseeded language —
   `{ tag: 'en', iso3: 'eng' }` — rather than throwing; a language with no row must not stop an
   encode from starting. Do **not** use `findFirst` on `iso2`: see `../plan.md` § Risks.

9. **Merge.** Extend `collectAllowedLanguages` and its two callers to select `tag` alongside `iso3`
   from each owner's preference, and add a tag twin of `resolveDefaultLanguagesIso3` — or better,
   one method returning both, since it reads the same setting and the same rows. Emit
   `allowedLanguageTags` on both the `MOVIE` and `EPISODE` payload branches, deduplicated and
   original-first, exactly like the existing list. Add the field to
   `entities/encode-job-details.entity.ts`.

10. **Regenerate and check.** Boot the service so `src/schema.gql` regenerates, then confirm the
    diff matches `../spec.md` § GraphQL Contract Delta (Article VIII's check).

## Contract obligations

`api` exposes exactly what `../spec.md` § GraphQL Contract Delta specifies. The delta is read-only;
if it is wrong, stop and report rather than adapting it here.

Two obligations are easy to get subtly wrong:

- **`Query.languages` returns the pickable rows, not every row.** `web` derives its grouping from
  the rows it receives — two or more sharing an `iso2` form a group — so a leaked `es` row would
  render as a third selectable Spanish entry, and an over-eager filter would empty the picker.
  `iso2` must stay on every returned row for that grouping to be possible.

- **The validator's catalog is the table; the query's catalog is filtered.** These are deliberately
  different sets. `es` is not offered to a user (REQ-3) but is not rejected if submitted, because it
  is a real row that means "Spanish, no variant preference" and the encode merge resolves it
  correctly. The error in `../spec.md`'s table fires for a tag with **no row at all** (`es-AR`),
  never for a release that lacks a track (REQ-12) — nothing in this slice inspects a file.

`allowedLanguageTags` is additive and unread this cycle. Do not remove, rename or narrow
`allowedLanguagesIso3` to compensate; the worker is not being changed and matches on it (NFR-4).

## Tests

- `src/languages/languages.service.spec.ts` — **extend.** The existing suite already covers unknown
  and duplicate codes and the delete-before-create ordering; those cases move from `iso2` to `tag`.
  Two new cases are genuinely owed, both silent: `findAll` omits `es` **while still returning every
  single-row language** (the naive filter empties the picker and nothing throws), and
  `validateAndResolveLanguageIds` resolves `es-419` and `es-ES` to two *different* ids despite their
  shared `iso2` (a lookup left on `iso2` returns the same row twice, and the user's two-variant
  choice silently collapses into one preference).

- `src/process-jobs/process-jobs.service.spec.ts` — **extend.** Its header already names this class
  of bug: a wrong join or a wrong selected column drops a language with no error anywhere. Three
  cases are owed: `allowedLanguageTags` carries the variant a per-title preference chose;
  `allowedLanguagesIso3` still contains `spa` exactly **once** when both variants are chosen (the
  dedup is the whole reason the two lists differ in length); and a title whose `originalLanguage` is
  `"es"` resolves to the base row — `tag: 'es'`, `iso3: 'spa'` — rather than to a variant row, which
  is the `findFirst` trap in `../plan.md` § Risks and produces a preference the user never expressed.

- Follow the house technique (`services/api/CLAUDE.md` § Tests): verify each new case actually fails
  when the rule it covers is removed. Both files already open with the Article IX header paragraph —
  extend the existing one rather than adding a second.

- `src/settings/settings.service.spec.ts` needs no new case beyond its existing ones moving to tag
  vocabulary: the branch it covers is unchanged, it only forwards a different alphabet to the same
  validator, and the validator's own suite is where that logic is defended.

- The resolver argument rename is not owed a test. A wrong argument name is a GraphQL schema error
  at call time, not a silent one, and `src/schema.gql`'s diff is the check (Article VIII).

## Done when

```bash
bin/npm api run prisma:migrate -- --create-only
bin/dbreset
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/mysql -e 'select tag, iso2, iso3 from languages where iso2 = "es" order by tag'
```

`tsc` reports 0 errors; `bin/npm api test` is green with no pre-existing suite newly failing (it was
217 tests across 23 suites at the last measurement in the root `CLAUDE.md` — re-run rather than
citing that); the `bin/mysql` query returns exactly three rows, `es`, `es-419` and `es-ES`, all with
`iso3 = spa`. `git status services/worker/` is clean.

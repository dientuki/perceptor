---
title: Language Regional Variants — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-28
status: Implemented
---

# PLAN: Language Regional Variants (`plan.md`)

## Approach

The feature turns one column into the identity of a language. `Language` gains `tag` (BCP-47,
unique) and `iso2` loses its uniqueness, which is the whole mechanism: three rows can now share
`es`, and `es-419`/`es-ES` become ordinary rows rather than a new concept. Because
`UserMovieLanguage` and `UserShowLanguage` already reference `Language.id`, **neither join table
changes** — a preference for a variant is exactly the kind of row a preference for a language
already was. That is why this feature is a column and a seed rather than a new table.

`api` reuses what already exists rather than growing a parallel path.
`LanguagesService.validateAndResolveLanguageIds` (`src/languages/languages.service.ts`) stays the
single validator for all three write paths — both per-title mutations and `SettingsService`'s
`kind: 'languages'` branch — and switches the column it looks up from `iso2` to `tag`. The
"hide a base row that has variants" rule lives in exactly one place, `LanguagesService.findAll()`,
and nowhere else; `language-names.ts` keys by tag instead of `iso2`.

One consolidation is owed on the way through. `ProcessJobsService.resolveIso3` currently does a
`findUnique({ where: { iso2 } })`, which stops being valid the moment `iso2` is not unique. Rather
than switching it to `findFirst` — which would happily return the `es-419` row for a Spanish film —
it becomes `resolveOriginalLanguage(iso2)` returning `{ tag, iso3 }` from **one lookup keyed by
`tag`**. That is exact, not a coincidence: TMDB's `originalLanguage` is an ISO-639-1 code, and a base
row's tag *is* its ISO-639-1 code. The merge then produces `allowedLanguagesIso3` and
`allowedLanguageTags` from the same walk, with the same dedup and the same original-first ordering,
instead of two merges that can drift.

In `web` the two divergent pickers collapse into one component. `media/LanguagePicker.tsx` (a
`<select multiple>`) and `settings/DownloadPanel.tsx`'s use of `form/MultiSelect.tsx` (a dropdown
with chips) are replaced by a single dual-pane control: a scrolling list of available entries on the
left where a click toggles, and the chosen set on the right as removable badges built on the
existing `ui/badge/Badge.tsx`. It keeps its own state and emits **one** hidden input carrying a
comma-separated value, named by a `name` prop. That single serialization is what lets the same
component serve `default_languages` (which is already a comma-separated string in one `Setting` row)
and the two per-title mutations without a mode flag, and it is what keeps `Show.tsx` a Server
Component with the picker as its client child — the alternative, a controlled component, would force
state into `Show.tsx` and make it client-side for no gain.

The realistic alternative for the data model was a `variant`/`region` column with a composite unique
on `(iso2, region)`. It was rejected because every consumer — the setting's stored value, the two
mutation arguments, the job payload — needs a single string to carry, and a composite key would have
had to be flattened into one anyway at each of those seams. `tag` is that string, and BCP-47 means
it is a standard one that `Intl.DisplayNames` already knows how to render.

## Order of Work

`api` goes first and alone. `web` cannot render `Language.tag` before the field exists, cannot call
`setMoviePreferredLanguages(tags:)` before the argument is renamed, and cannot test the grouping
without `languages` actually omitting `es`. There is no useful parallelism here: the two slices are
one contract change and one consumer of it.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the schema, the migration and the seed. Every field and argument `web` consumes is defined here first (Article III). |
| 2 | `api` | The merge in `process-jobs/` and the catalog filter in `languages/` are internal to this service and independent of `web`; they can land in the same pass as step 1. |
| 3 | `web` | Cannot begin usefully until `languages` returns `tag` and omits `es` — a picker built against the old shape has nothing to group. |

Steps 1 and 2 are the same service and may interleave freely. Step 3 must not start early: `web`
has no test runner, so its only gate is opening the page against a running `api`, which means a
half-migrated `api` makes `web`'s work unverifiable rather than merely blocked.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Three things will
look wrong from inside one slice and must not be changed:

- **`iso2` stays on the `Language` type.** From `web`'s side it now looks redundant next to `tag`,
  and from `api`'s side it looks like a column that lost its job. It is neither: `web` groups rows
  by shared `iso2` and renders the group heading from it through `Intl.DisplayNames`, and that
  grouping is the entire presentation rule (REQ-4). Removing it forces a hard-coded list of which
  languages have variants, which REQ-4 explicitly forbids.

- **`allowedLanguagesIso3` stays, unchanged, beside `allowedLanguageTags`.** From `api`'s side the
  tag list looks like a superset that makes the ISO-639-2/B list redundant. It does not: the worker
  matches `ffprobe`'s `tags.language`, which only ever speaks ISO-639-2/B, and it is not being
  changed in this feature (NFR-4). Dropping or narrowing the old field breaks every encode with no
  compile error in either service.

- **`Query.languages` returns the pickable catalog, not every row.** From `api`'s side, filtering a
  query named "the full seeded catalog" reads like the filter belongs in `web`. It does not: `web`
  would then need to know which rows are base rows, which is the same forbidden hard-coded list.
  `api` owns the rule because `api` owns the table.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve, and re-brief both
services. Never patch it from inside one slice (Article VIII).

## Migrations

Owned by `api`. One migration, and it must be created before it is applied.

1. **`add_language_tag`** — adds `Language.tag` as `String @unique`, non-null, no default; drops the
   unique index on `Language.iso2`, leaving the column in place.

2. **No backfill** (NFR-1). The project is in development and the corrected seed is the only source
   of truth for these rows.

**Ordering trap.** `bin/npm api run prisma:migrate` runs `prisma migrate dev`, which tries to apply
the migration immediately — and adding a non-null unique column to a `languages` table that already
holds 20 rows fails. Generate it without applying, then reset:

```bash
bin/npm api run prisma:migrate -- --create-only
bin/dbreset
```

`bin/dbreset` replays every migration against an empty database and reseeds, which is where the new
rows and the `tag` values actually come from. An implementer who runs the plain `prisma:migrate`
first will hit the failure, and the fix is not to add a default — a default would make `tag`
silently equal to the empty string on every existing row and only the unique index would complain.

**Reversibility.** Rolling back is not clean: restoring the unique index on `iso2` is impossible
while three rows share `es`, so a rollback must delete the `es-419` and `es-ES` rows first, which
discards any preference pointing at them. In development the answer is `bin/dbreset` on the previous
schema, not a down-migration.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The catalog filter is written as "hide any row whose `tag` equals its `iso2`" | Every ordinary language is a row whose tag equals its iso2 (`en`, `ja`, `fr`…). The picker empties out to just the two Spanish variants. Loud in the UI, but trivially reachable, and the naive reading of REQ-3 produces exactly it | The rule is "hide a base row **only when another row shares its `iso2`**". AC-2 asserts both halves: `es` absent *and* every single-row language still present |
| `resolveIso3` switched from `findUnique` to `findFirst` on `iso2` | Prisma stops accepting `findUnique({ where: { iso2 } })` once the unique index is gone, and `findFirst` is the mechanical fix. For a Spanish film it may return the `es-419` row — `iso3` is still `spa`, so nothing breaks, but `allowedLanguageTags` silently opens with `es-419`: a variant preference the user never expressed, on every Spanish-language title | Look up by **`tag`**, not `iso2` — a base row's tag is its ISO-639-1 code by construction. Covered by AC-10 and a case in `process-jobs.service.spec.ts` |
| `allowedLanguageTags` added to the entity but not to the merge | The field ships as `[]` or `undefined`. The worker does not read it in this spec, so **nothing fails anywhere** — the bug surfaces only when the follow-up spec ships and its rules see an empty list | AC-9, plus a dedicated case in the existing `process-jobs.service.spec.ts` merge suite, which was written for precisely this class of failure |
| One of the two mutation renames (`iso2` → `tags`) is missed in `web` | `web` retypes both documents by hand in `src/actions/languages.ts` with no codegen. The stale one fails at runtime as "Unknown argument" — on the film page or the series page, whichever was missed, and only when someone saves | AC-6 exercises the film path; the series path is in the manual pass below. Both documents are in one file, listed explicitly in `web/plan.md` |
| `resolveDefaultLanguagesIso3` keeps querying by `iso2` | The stored setting now holds tags. `where: { iso2: { in: ['es-419'] } }` matches nothing, so the installation default silently contributes **no** languages to any encode. The original language still comes through, so encodes keep succeeding with a quietly narrower track set | Query by `tag`. The existing merge suite already covers "unions `default_languages` with a per-title preference"; the case is extended to a variant tag |
| The picker's badges and its list fall out of sync | Removing a badge must un-toggle the corresponding entry and vice versa. If the two panes read different state, a user removes a badge, sees the entry still ticked, clicks it, and re-adds what they just removed | One state value owns both panes; REQ-5 states the equivalence and AC-3 exercises the round trip |

## Verification

```bash
bin/npm api run prisma:migrate -- --create-only
bin/dbreset
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/npm worker run test
```

`bin/npm api test` and `bin/npm worker run test` must both stay green with no new failures; the
worker run is not ceremony, it is how NFR-4 is proven, together with `git status services/worker/`
being clean. `bin/npm web run lint` is **not** a gate in this service — run Biome on the files
touched, never on the repo (`services/web/CLAUDE.md`).

Row-level checks:

```bash
bin/mysql -e 'select tag, iso2, iso3 from languages where iso2 = "es" order by tag'
bin/mysql -e 'select value from settings where `key` = "default_languages"'
bin/mysql -e 'select * from user_movie_languages'
```

Then the manual pass:

1. `/settings` → Descarga. Spanish is a heading, not an option; "Español latinoamericano" and
   "Español de España" sit under it. Click one, see a badge appear; click the badge's X, see the
   entry untick. Save, reload, see the choice persisted (AC-3, AC-5).
2. Switch the UI locale to English and reload `/settings`. The two entries read "Latin American
   Spanish" and "European Spanish" and are still adjacent under a "Spanish" heading rather than
   filed under E and L (AC-4).
3. A film's detail page: choose "Español de España", save, reload (AC-6). **Then do the same on a
   series' detail page** — it is the second hand-retyped mutation and the one a film-only pass
   misses.
4. Tab into the picker: reach every entry and toggle it with the keyboard, then reach a badge's
   remove control and activate it (AC-12).
5. Trigger a real encode on a title with a variant chosen and read the enqueued payload — both
   `allowedLanguagesIso3` and `allowedLanguageTags` present, `spa` appearing once even with both
   variants chosen (AC-9).

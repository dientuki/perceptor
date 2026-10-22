---
title: Movie Release Dates Display — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-16
status: Implemented
---

# PLAN: Movie Release Dates Display (`plan.md`)

## Approach

Everything this feature shows is already stored: `075` writes `Movie.theatricalReleaseDate`,
`digitalReleaseDate` and `physicalReleaseDate`, and `076` reads them. The feature is a read-only
exposure plus two renderings, with no schema change and no TMDB call.

**`movie(id)` / `movies`.** `MoviesService.findOneFromDb`/`findAll` already return the whole Prisma
row, and `Movie` (`services/api/src/movies/entities/movies.entity.ts`) is a code-first object type
over it. Adding three nullable `@Field`s is enough. No resolver or service change is needed, and
none is wanted: a `@ResolveField` would be a second path to a value the row already carries.

**`calendar(from, to)`.** Two things change. The film read
(`MoviesService.findReleasedBetween`, used only by `CalendarService`) widens from "`releaseDate`
in range" to "any of the four dates in range". The expansion of one film into 0–3 entries is a new
pure function beside `calendar/group-episodes.ts`, which does the same job for episodes. It is a
module-level function, not a service, and it is unit-testable without Nest. `CalendarService.list`
calls it in place of the single `entries.push` it has today. Sorting, capability gating and the
episode branch stay as they are.

The alternative was a database query that returns one row per (film, typed date). Rejected: Prisma
cannot unpivot columns without raw SQL. The candidate set is already bounded to one month of one
user's films, and the in-range check still has to run per date, because a film whose digital date
is in range may have its physical date outside it.

**`web`.** The detail page gets one new component that renders the dates row under the existing
year line in `components/movies/Movie.tsx`. The calendar gets a prefix. `lib/calendar-label.ts`
already builds the event title string and stays the one place that does. `CalendarEventContent`
renders `entry.title` rather than the label, so it has to render the same prefix too, and both read
it from one helper in `lib/` so the two can never disagree. Day formatting reuses the pattern
already in `components/shows/SeasonAccordion.tsx`: `toLocaleDateString(locale, { timeZone: "UTC" })`.
`timeZone: "UTC"` is required, because the stored value is UTC midnight and a browser west of UTC
would otherwise show the previous day.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the schema: the three `Movie` fields, `MovieReleaseType`, `CalendarEntry.releaseTypes` and the multi-entry expansion |
| 2 | `web` | Selects fields and an enum that do not exist until step 1 boots |

Both slices can be written **in parallel** once `spec.md` is Approved, because the delta is frozen
and fully additive (NFR-3). `web` can only be verified against an `api` that has booted step 1.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. These are the
points an implementer will be tempted to change and must not:

- **`releaseTypes` is nullable, `null` for episodes and `[]` for the fallback.** Making it
  `[MovieReleaseType!]!` with `[]` for episodes looks tidier. It is not what was frozen, and it
  breaks the "null unless kind is …" convention every other kind-specific field on `CalendarEntry`
  follows.
- **The `date` field stays a `YYYY-MM-DD` string, one entry per distinct day.** Do not add a
  per-type date to `CalendarEntry`. Same-day types merge into one entry (REQ-4), and that merge is
  the decision the user made.
- **`releaseDate` on `Movie` is untouched.** It is still TMDB's earliest date of any type (`075`
  REQ-2). Do not "fix" it to equal the theatrical date.
- **No `@ResolveField` and no extra selection on the listings.** `movies` carries the fields
  because they are on the type, and `web`'s listings do not select them. Do not add them to
  `getMovies`.
- **Labels are `web` copy.** `api` returns enum values only, never `(cine)` or any other string.

## Migrations

None. The three columns exist since `075` and nothing else is stored.

Reversibility: dropping the feature means removing three fields, an enum and one field from the
schema. An older `web` never selected them, so nothing breaks.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Off-by-one day in the browser | A UTC-midnight date rendered in the local zone shows the day before for any user west of UTC. No error, just a wrong date on the detail page | `web` always formats with `timeZone: "UTC"` (same as `SeasonAccordion`). Manual check in AC-1 against `bin/mysql` |
| Film listed on `releaseDate` *and* on its typed dates | A premiere shows as an unlabelled extra entry, which is exactly what REQ-6 forbids. Nothing errors | The pure expansion function decides the fallback only when all three typed dates are null. A unit test covers a film whose `releaseDate` is in range but whose typed dates are not: zero entries |
| Widened query drops a film | `findReleasedBetween` keeps filtering on `releaseDate` only, so a film whose digital date is in range but whose `releaseDate` is months earlier never appears. Silent | The `where` becomes an `OR` over the four columns. `calendar.service.spec.ts` asserts the mock call. AC-6 is the live check |
| Out-of-range typed date leaks in | The `OR` matches a film for its digital date, and the expansion also emits its physical date from next month. The entry shows on the wrong grid or duplicates across months. Silent | The expansion function filters each day against the parsed range. Unit test plus AC-6 |
| Same-day duplicate | Theatrical and digital on one day produce two entries instead of one. Silent | Expansion groups by day string. Unit test plus AC-5 |
| Unknown enum value in `web` | A future `api` adds a type and `web` crashes or renders `undefined` | `web` maps only the three known values and skips anything else (spec § Consumer handling) |
| `web` build clobbers dev `.next` | Running `bin/npm web run build` with the dev stack up un-hydrates every page | Done-when for `web` runs the build only with the dev stack down (project memory `web-build-clobbers-dev-next`) |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/comments api
git diff services/api/src/schema.gql
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments web
```

`bin/npm web run build` runs only with the dev stack stopped.

The `schema.gql` diff must show exactly the three `Movie` fields, the `MovieReleaseType` enum and
`CalendarEntry.releaseTypes` (AC-10).

Manual pass, with the stack up:

1. Pick three films with `bin/mysql -e "select id, title, releaseDate, theatricalReleaseDate,
   digitalReleaseDate, physicalReleaseDate from movies"`: one with three distinct typed dates, one
   with only theatrical, and one with all three `NULL`. If no film has all three `NULL`, set one
   temporarily and revert afterwards, the same way `062`'s pass did.
2. Open `/movies/<id>` for each and check AC-1, AC-2 and AC-3 (detail half).
3. Open `/calendar` on the relevant months and check AC-3 (calendar half), AC-4, AC-5 and AC-6. For
   AC-5, if no real film has a shared day, set two of its dates equal temporarily and revert.
4. Turn `shorts_enabled` off and check that no entry for a short appears (AC-7). Switch the locale to
   `en` and check AC-8. Confirm that episode entries look unchanged (AC-9).

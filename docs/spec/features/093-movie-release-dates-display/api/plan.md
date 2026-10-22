---
title: Movie Release Dates Display — api slice
service: api
last_updated: 2026-10-16
status: Implemented
---

# PLAN: Movie Release Dates Display — `api` (`api/plan.md`)

## Scope

`api` exposes the three typed release dates `075` already stores, on `Movie`. It also changes
`calendar(from, to)` so that a film or short yields one entry per distinct typed day in range,
tagged with which release types fall on that day. A film with no typed date falls back to today's
single entry on `releaseDate`, tagged `[]`.

Out of this slice: no Prisma change, no migration, no TMDB call and no new resolver. All user-facing
labels belong to `web`. Writes are confined to `services/api/`.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/movies/entities/movies.entity.ts` | Modified | Three nullable `DateTime` fields with the descriptions from `../spec.md` |
| `services/api/src/movies/entities/movie-release-type.enum.ts` | New | `MovieReleaseType` enum plus `registerEnumType` |
| `services/api/src/calendar/entities/calendar-entry.entity.ts` | Modified | `releaseTypes?: MovieReleaseType[] \| null`, nullable list, description from the delta |
| `services/api/src/calendar/movie-release-days.ts` | New | Pure function: one film row plus the range → 0..n `{ date, releaseTypes }` |
| `services/api/src/calendar/movie-release-days.spec.ts` | New | Article IX suite for the function above |
| `services/api/src/movies/movies.service.ts` | Modified | `findReleasedBetween`'s `where` becomes an `OR` over `releaseDate` and the three typed columns, each `{ gte: from, lt: toExclusive }` |
| `services/api/src/calendar/calendar.service.ts` | Modified | The film branch pushes one entry per element the function returns. Episode entries get no `releaseTypes` (stays `null`) |
| `services/api/src/calendar/calendar.service.spec.ts` | Modified | The `film()` fixture gains the three typed fields. Assert the multi-entry and fallback paths through the service |
| `services/api/src/schema.gql` | Regenerated | Boot artifact only (Article IV) |

## Existing code to reuse

- `services/api/src/calendar/group-episodes.ts` is the precedent for a pure grouping function beside
  `CalendarService`, with its own spec file. Follow its shape: exported types, no Nest, no Prisma
  import.
- `services/api/src/calendar/calendar-range.ts` (`parseCalendarRange`) already yields
  `{ from, toExclusive }` as `Date`s. The new function takes that same pair. Do not re-parse strings.
- `movie.releaseDate.toISOString().slice(0, 10)` in `calendar.service.ts` is the existing way a
  UTC-midnight `DateTime` becomes the `date` string. Use the same conversion for each typed date, so
  the existing "UTC-midnight release reads as the same calendar day" test keeps holding.
- `services/api/src/media/entities/content-kind.enum.ts` and `grain-mode.enum.ts` are the enum file
  pattern (`registerEnumType` with a description).
- `services/api/src/movies/release-window.ts` reads the same three columns for `075`/`076`. Do
  **not** reuse it here. It answers "is the window closed", which is a different question, and
  coupling the two would make a closure change move the calendar.

## Steps

1. Add `movie-release-type.enum.ts` with `THEATRICAL`, `DIGITAL` and `PHYSICAL`.
2. Add the three fields to `Movie` (`@Field({ nullable: true, description })`, typed `Date | null`).
   The Prisma row already carries them, so `movie(id)` and `movies` serve them with no service
   change.
3. Add `releaseTypes` to `CalendarEntry`:
   `@Field(() => [MovieReleaseType], { nullable: true, description })`.
4. Write `movie-release-days.ts`. Input: the film's `releaseDate` and three typed dates (all
   `Date | null`) plus the range. Rules:
   - If any typed date is non-null, keep only the typed dates inside `[from, toExclusive)`, group
     them by `YYYY-MM-DD`, and emit one item per day. Each item's `releaseTypes` is in the fixed
     order THEATRICAL, DIGITAL, PHYSICAL. `releaseDate` is ignored entirely (REQ-6).
   - If all three typed dates are null, emit one item `{ date: releaseDate day, releaseTypes: [] }`
     when `releaseDate` is non-null and in range. Otherwise emit nothing.
   - Order the output by date ascending.
5. Widen `findReleasedBetween` to `OR: [{ releaseDate: … }, { theatricalReleaseDate: … },
   { digitalReleaseDate: … }, { physicalReleaseDate: … }]`. Keep the ownership clause and the
   `include` as they are. The name stays: it still means "released in this window".
6. In `CalendarService.list`, replace the single push with a loop over the function's output. Each
   entry copies `kind`, `mediaId`, `title` and `status` from the film, and takes `date` and
   `releaseTypes` from the item. Drop the `if (!movie.releaseDate) continue` guard, because the
   function now owns that decision. Keep the shorts-capability skip before the expansion.
7. Boot and confirm that the regenerated `schema.gql` diff matches `../spec.md` exactly.

## Contract obligations

Expose exactly the SDL in `../spec.md` § GraphQL Contract Delta:

- `Movie.theatricalReleaseDate`, `digitalReleaseDate`, `physicalReleaseDate`: `DateTime`, nullable.
- `enum MovieReleaseType { THEATRICAL DIGITAL PHYSICAL }`.
- `CalendarEntry.releaseTypes: [MovieReleaseType!]`: `null` for `EPISODES`, `[]` for a fallback film
  entry, and otherwise non-empty and ordered.
- `(mediaId, date)` is unique among `MOVIE`/`SHORT` entries in one response.

No new error. `calendar`'s invalid-range error (`062`) and `movie(id)`'s unavailable path (`008`)
are unchanged. The delta is read-only. If it looks wrong, stop and report.

## Tests

- `services/api/src/calendar/movie-release-days.spec.ts` is owed. Every failure in this function is
  silent: a duplicated, missing or misplaced coloured cell with no error anywhere. The header
  paragraph should say so (Article IX). Cases:
  - three distinct in-range days give three items, each with one type;
  - theatrical and digital on the same day give one item `[THEATRICAL, DIGITAL]`;
  - all three on one day give one item with all three, in the fixed order;
  - one typed date in range and another out of range give only the in-range item;
  - typed dates present, all out of range, and `releaseDate` in range give **zero** items (REQ-6);
  - all typed dates null and `releaseDate` in range give one item with `[]`;
  - all typed dates null and `releaseDate` null give zero items;
  - a date equal to `toExclusive` is excluded and a date equal to `from` is included.
- `services/api/src/calendar/calendar.service.spec.ts` is extended, not duplicated. Cover one film
  yielding two entries that share `mediaId`/`status`, episode entries carrying no `releaseTypes`,
  and the existing ordering test still holding when one film spans two days.
- `movies.entity.ts`, the enum and the `findReleasedBetween` `where` clause get no dedicated test.
  The entity is declarative and the schema diff checks it. The `where` is covered by AC-6's live
  check, plus the service spec's assertion on the call arguments if that is cheap. Prisma's
  behaviour itself is not tested here.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/comments api
git diff services/api/src/schema.gql
```

Typecheck has 0 errors, every suite is green, and `bin/comments` is clean. The schema diff shows
exactly the three `Movie` fields, `MovieReleaseType` and `CalendarEntry.releaseTypes`, and nothing
else. `git status services/api/prisma` is clean.

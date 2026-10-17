---
title: Movie Release Dates Display — web slice
service: web
last_updated: 2026-10-16
status: Approved
---

# PLAN: Movie Release Dates Display — `web` (`web/plan.md`)

## Scope

`web` renders two things:

- **Detail page.** Under the existing year line on a film's detail page, it shows the typed release
  dates the film has, side by side.
- **Calendar.** On `/calendar`, it prefixes each film or short entry with one parenthesised label per
  release type the entry carries.

Every label is catalog-driven in `en` and `es`. `web` does not decide which days a film appears on;
`api` does, and `web` renders the entries it receives. Writes are confined to `services/web/`.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/actions/movies.ts` | Modified | `Movie` interface gains `theatricalReleaseDate?`, `digitalReleaseDate?` and `physicalReleaseDate?` (`string \| null`). `GET_MOVIE_QUERY` selects all three. `getMovies`' listing query is **not** changed |
| `services/web/src/components/movies/MovieReleaseDates.tsx` | New | One component: receives the three dates and renders the known ones in order theatrical, digital, physical, or renders nothing when none is known |
| `services/web/src/components/movies/Movie.tsx` | Modified | Renders `<MovieReleaseDates …/>` directly under the year/language/status `<p>`. The year line itself is unchanged |
| `services/web/src/types/calendar.ts` | Modified | `MovieReleaseType = "THEATRICAL" \| "DIGITAL" \| "PHYSICAL"`. `CalendarEntry.releaseTypes: MovieReleaseType[] \| null` |
| `services/web/src/actions/calendar.ts` | Modified | `CALENDAR_QUERY` selects `releaseTypes` |
| `services/web/src/lib/calendar-label.ts` | Modified | New exported `releaseTypePrefix(types, translate)` that returns `"(cine) (digital) "` or `""`. `calendarEntryLabel` takes the same translate function and prepends the prefix for film/short entries |
| `services/web/src/components/calendar/Calendar.tsx` | Modified | Passes `t` into `calendarEntryLabel` |
| `services/web/src/components/calendar/CalendarEventContent.tsx` | Modified | Renders `releaseTypePrefix(entry.releaseTypes, t)` before `entry.title`. The `title=` hover text already uses `label`, which now carries the prefix |
| `services/web/messages/es.json`, `services/web/messages/en.json` | Modified | Keys listed below |

## Existing code to reuse

- `components/shows/SeasonAccordion.tsx:49` formats with
  `new Date(x).toLocaleDateString(activeLocale, { timeZone: "UTC" })` and `useLocale()`. Use exactly
  this. `timeZone: "UTC"` is mandatory: the values are UTC midnight, and without it a user west of
  UTC sees the previous day.
- `lib/calendar-label.ts` is already the one builder of a calendar entry's text, so the prefix
  helper lives there. Do not add a second helper file and do not inline the mapping in two
  components.
- `components/movies/Movie.tsx` already reads the `movies.detail` namespace (`unknownYear` and
  others). The detail labels go in that namespace, and the calendar labels go in the existing
  `calendar` namespace.
- `services/web/CLAUDE.md` § "One renderable component per file" is why `MovieReleaseDates` is its
  own file rather than a second function in `Movie.tsx`.

## Steps

1. Add the catalog keys to both locales, keeping `es` in the Rioplatense register:
   - `movies.detail.releaseTheatrical` / `releaseDigital` / `releasePhysical`: `Cine` / `Digital` /
     `Físico` in `es`, `Theatrical` / `Digital` / `Physical` in `en`.
   - `calendar.releaseTheatrical` / `releaseDigital` / `releasePhysical`: `(cine)` / `(digital)` /
     `(físico)` in `es`, `(theatrical)` / `(digital)` / `(physical)` in `en`.
2. Extend `Movie` and `GET_MOVIE_QUERY` in `actions/movies.ts`.
3. Write `MovieReleaseDates.tsx`. Use a `flex flex-wrap gap-x-6` row of label/value pairs in the same
   muted text classes the year line uses. Return `null` when all three dates are null or absent.
4. Mount it in `Movie.tsx` right after the year `<p>`.
5. Extend `types/calendar.ts` and `CALENDAR_QUERY`.
6. Add `releaseTypePrefix` to `lib/calendar-label.ts`. It maps only the three known values, skips any
   other value silently (spec § Consumer handling), and treats `null` and `[]` alike as no prefix.
   Thread `t` through `calendarEntryLabel`.
7. Update `Calendar.tsx` and `CalendarEventContent.tsx` to use it. The kind icon stays where it is,
   before the prefix.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, read-only:

- `movie(id)` gains `theatricalReleaseDate`, `digitalReleaseDate` and `physicalReleaseDate`
  (`DateTime`, nullable, ISO strings on the wire). Any of them may be null.
- `calendar` entries gain `releaseTypes`: `null` for episodes, `[]` for a film placed on its generic
  `releaseDate`, and otherwise ordered THEATRICAL, DIGITAL, PHYSICAL. One film can now come back as
  up to three entries with the same `mediaId`. `Calendar.tsx`'s event `id` already includes `date`
  and `index`, so it stays unique. Do not key anything by `mediaId` alone.
- No new error. `getCalendarEntries`' `{ error }` branch and the detail page's not-found path are
  unchanged and stay handled exactly as today.

## Tests

None, and that is the stated position of this service (`services/web/CLAUDE.md` § "Tests: there are
none"). The silent failures in this feature, a wrong or duplicated day, live in `api`'s
`movie-release-days.spec.ts`. What `web` can get silently wrong is the off-by-one-day render. It is
defended by reusing the `timeZone: "UTC"` pattern above and by the manual check of AC-1 against
`bin/mysql`. `scripts/check-messages.mjs` catches catalog drift between `en` and `es`.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments web
```

Typecheck has 0 errors, the catalogs are in sync, and `bin/comments` is clean. Run
`bin/npm web run build` (exit 0) only with the dev stack **stopped**: building while it is up
clobbers the dev `.next` and un-hydrates every page.

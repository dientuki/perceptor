---
title: Release Calendar — api slice
service: api
last_updated: 2026-09-19
status: Implemented
---

# PLAN: Release Calendar — `api` (`api/plan.md`)

## Scope

`api` exposes `Query.calendar(from, to): [CalendarEntry!]!` exactly as `../spec.md` § GraphQL Contract
Delta states, plus the two keyed errors. It reads only the database (NFR-3): no TMDB, Redis-cached
catalog, qBittorrent or media-server call. It owns the episode grouping, the group status (REQ-7), the
group counts (REQ-7b), the media-type filtering (REQ-9) and the range validation (NFR-2). It does not
decide colours, labels, the "no count for a single episode" display rule, or anything about months —
those are `web`'s. No Prisma schema change and no migration.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `src/pipeline-status/pipeline-status.ts` | Modified | New pure `deriveEpisodeStatus(seasonSources, episode, now)` — the body of `ShowsService.deriveSeasonEpisodeStatuses`'s per-episode map, moved. |
| `src/pipeline-status/pipeline-status.spec.ts` | Modified | Cases for `deriveEpisodeStatus` (lifted / not lifted / unaired / `ERROR` column wins). |
| `src/shows/shows.service.ts` | Modified | `deriveSeasonEpisodeStatuses` calls `deriveEpisodeStatus`; new `findEpisodesReleasedBetween(userId, from, toExclusive)`. |
| `src/movies/movies.service.ts` | Modified | New `findReleasedBetween(userId, from, toExclusive)` returning rows through the existing `withDerivedStatus`. |
| `src/calendar/calendar.module.ts` | New | Imports `MoviesModule`, `ShowsModule`, and whatever module provides `MediaCapabilitiesService`. |
| `src/calendar/calendar.resolver.ts` | New | `@Query(() => [CalendarEntry], { name: 'calendar' })`, args `from`/`to` as `String`. |
| `src/calendar/calendar.service.ts` | New | Parse/validate the range, fetch both, filter by capability, group, order. |
| `src/calendar/calendar-range.ts` | New | Pure `parseCalendarRange(from, to)` → `{ from: Date, toExclusive: Date }` or throws the keyed errors. |
| `src/calendar/group-episodes.ts` | New | Pure grouping + group status + counts. |
| `src/calendar/entities/calendar-entry.entity.ts` | New | `@ObjectType() CalendarEntry`. |
| `src/calendar/entities/calendar-entry-kind.enum.ts` | New | `CalendarEntryKind` + `registerEnumType`, same shape as `src/media/entities/content-kind.enum.ts`. |
| `src/calendar/calendar-range.spec.ts`, `src/calendar/group-episodes.spec.ts`, `src/calendar/calendar.service.spec.ts` | New | See § Tests. |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | `CALENDAR_INVALID_DATE: 'error.calendar.invalid_date'` (`Invalid date: {value}`), `CALENDAR_INVALID_RANGE: 'error.calendar.invalid_range'` (`Invalid calendar range`). |
| `src/app.module.ts` | Modified | Register `CalendarModule`. |
| `src/schema.gql` | Regenerated | Never hand-edited (Article IV). |

## Existing code to reuse

- `src/pipeline-status/pipeline-status.ts` — `deriveTitleStatus`, `isLiftedBySeasonPack`. The calendar
  never re-implements either; after this slice the only callers of the lift are through
  `deriveEpisodeStatus`.
- `MoviesService.withDerivedStatus` (private, `src/movies/movies.service.ts`) — the new ranged read
  includes `mediaSources: true, processJobs: true` exactly as `findOneFromDb` does and maps through it.
- `ShowsService.findOneFromDb`'s include shape — season `mediaSources` filtered `status: { not: 'ERROR' }`,
  episode `mediaSources` + `processJobs`. The ranged episode read uses the same filters so the lift sees
  the same inputs.
- The ownership clause `users: { some: { userId } }` from both `findAll`s, and the resolver idiom
  `principal.type === 'user' ? principal.id : ''` from `ShowsResolver.getShows`.
- `MediaCapabilitiesService.read()` (`src/media/media-capabilities.service.ts`) — one call per request,
  giving `moviesEnabled`, `showsEnabled`, `shortsEnabled` (already `movies && shorts`).
- `i18nError.badRequest(key, params)` (`src/i18n/i18n-error.ts`) — the only way the two errors are thrown.
- `messages.en.spec.ts` already asserts every key has a template; adding both keys to both files keeps it green.

## Steps

1. Extract `deriveEpisodeStatus` into `pipeline-status.ts`; make `ShowsService.deriveSeasonEpisodeStatuses`
   call it with one `now` per call (unchanged behaviour). Existing `shows.service.spec.ts` must stay green
   untouched — that is the proof the extraction is a move.
2. Add the two error keys and English templates.
3. `calendar-range.ts`: accept only `^\d{4}-\d{2}-\d{2}$` that round-trips through a UTC `Date`
   (rejects `2026-02-30`, `2026-13-01`) → `error.calendar.invalid_date` with `{ value }` naming the first
   bad argument. Then `to < from` or an inclusive span of more than 62 days → `error.calendar.invalid_range`.
   Return `from` at UTC midnight and `toExclusive = to + 1 day` at UTC midnight.
4. `MoviesService.findReleasedBetween` — `releaseDate: { gte: from, lt: toExclusive }`, ownership clause,
   derived status.
5. `ShowsService.findEpisodesReleasedBetween` — episodes with `releaseDate` in range whose show is owned by
   the user; select show id/title, season number and season `mediaSources` (same filter as the detail
   read); status through `deriveEpisodeStatus` with one `now`. Season 0 (specials) is included like any
   other season.
6. `group-episodes.ts` — key `(showId, seasonNumber, UTC day)`; per group: `firstEpisodeNumber`/
   `lastEpisodeNumber` = min/max, `episodeCount` = members, `completedCount` = members with `COMPLETED`,
   `episodeTitle` = the member's title only when `episodeCount === 1`, status per REQ-7: any `ERROR` →
   `ERROR`; else any of `QUEUED`/`PAUSED`/`DOWNLOADING`/`DOWNLOADED`/`ENCODING` → the most advanced of
   those present on the rank ladder (so the string is still one of the eight); else all `COMPLETED` →
   `COMPLETED`; else `MISSING`.
7. `CalendarService.list(userId, from, to)` — parse range; `read()` capabilities once; fetch films only if
   `moviesEnabled`, drop `isShort` films unless `shortsEnabled`; fetch episodes only if `showsEnabled`;
   map films to `MOVIE`/`SHORT`, groups to `EPISODES`; `date` = UTC `YYYY-MM-DD`; order by `date`, `title`,
   `seasonNumber`, `firstEpisodeNumber`.
8. Resolver + entity + enum + module; register in `app.module.ts`; boot once to regenerate `schema.gql`
   and diff it against `../spec.md`.

## Contract obligations

Exactly `../spec.md` § GraphQL Contract Delta: `enum CalendarEntryKind { MOVIE SHORT EPISODES }`,
`type CalendarEntry` with the nine fields and their nullability, `calendar(from: String!, to: String!)`.
`seasonNumber`, `firstEpisodeNumber`, `lastEpisodeNumber`, `episodeCount`, `completedCount` are non-null
for every `EPISODES` entry and null otherwise; `episodeTitle` is non-null only for a single-episode
group (and may still be null if the episode has no title). Errors: `error.calendar.invalid_date` with
`params.value`, `error.calendar.invalid_range` with no params, both as `BadRequestException`; the
existing guard handles unauthenticated calls. A disabled type is never an error. The delta is
read-only — if it is wrong, stop and report.

## Tests

- `src/calendar/calendar-range.spec.ts` — defends against a release on the first or last visible day
  silently disappearing, and against `2026-02-30`-style dates silently rolling into March: both edges
  inclusive, 62-day span accepted, 63 refused, `to < from` refused, impossible dates refused with the
  right `value`.
- `src/calendar/group-episodes.spec.ts` — defends against a failed episode hidden behind a green group
  and against wrong counts: every REQ-7 branch, the *Reacher* case (3 same-day + weekly singles → one
  group of 3 plus singles), two seasons same day → two groups, `episodeTitle` only for groups of one.
- `src/calendar/calendar.service.spec.ts` — defends against disabled types leaking and ordering drift:
  capability combinations (movies off, shows off, shorts off with movies on), `SHORT` from `isShort`,
  `date` formatted in UTC for a `releaseDate` of `2026-09-19T00:00:00Z`.
- `src/pipeline-status/pipeline-status.spec.ts` — `deriveEpisodeStatus` cases; the calendar/detail
  divergence in the Risks table is silent otherwise.
- The two new service methods are thin Prisma reads; their ownership clause is asserted through the
  mocked Prisma call in the existing `movies.service.spec.ts`/`shows.service.spec.ts` style — one case
  each, not a new file. The resolver and module are wiring: no test.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
git status --short services/api/prisma
```

0 errors; every suite green, count above 559/46; `prisma` status empty; the regenerated `schema.gql`
diff is exactly the enum, the type and the query.

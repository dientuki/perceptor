---
title: Content kind classification — api slice
service: api
last_updated: 2026-09-14
status: Approved
---

# PLAN: Content kind classification — `api` (`api/plan.md`)

## Scope

This slice owns everything that decides a title's content kind and everything that publishes it: the
Prisma enum and migration, the classification rule, the TMDB genre/keyword reads and their caching,
the two reclassification mutations, and `EncodeJobDetails.contentKind`. It is also responsible for
removing `isLiveAction` from the schema — which breaks `web` and `worker` until their own slices
land, by design (see `../plan.md` § Order of Work).

Not this slice: the film/series detail-page control and its server actions (`web`), and the FFmpeg
parameter branches that consume the value (`worker`, and inside it the `ffmpeg` agent). Writes are
confined to `services/api/` and this directory; anything else is a stop-and-report
(`.claude/agents/api.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` | Modified | `enum ContentKind`; `Movie.isLiveAction`/`Show.isLiveAction` dropped, `contentKind ContentKind @default(LIVE_ACTION)` added to both |
| `prisma/migrations/<timestamp>_<name>/migration.sql` | New | generated, never hand-written |
| `src/media/entities/content-kind.enum.ts` | New | the TS enum plus its `registerEnumType`, mirroring `src/preferences/entities/language-track-kind.enum.ts` |
| `src/media/content-kind.ts` | New | `classifyContentKind({ genreIds, keywordIds })` — the whole rule, pure, no Nest |
| `src/media/content-kind.spec.ts` | New | the rule's cases (see § Tests) |
| `src/clients/types.ts` | Modified | `MediaSearchResult` gains `genreIds?`/`keywordIds?`; `MovieDetail`/`ShowDetail` gain `genreIds`; `MovieDBClient` gains `keywords(type, id)` |
| `src/clients/tmdb/types.ts` | Modified | `genres` on both details shapes, `genre_ids` on `TmdbMultiSearchResult`, the two keywords response shapes |
| `src/clients/tmdb/client.ts` | Modified | both detail mappers map `genres` → `genreIds`; new `keywords(type, id): Promise<number[]>` |
| `src/clients/tmdb/client.spec.ts` | New | the `/movie` vs `/tv` keywords asymmetry (see § Tests) |
| `src/clients/tmdb/popular.ts`, `src/clients/tmdb/multi.ts` | Modified | carry `genre_ids` through into `genreIds` |
| `src/movies/movies.service.ts` | Modified | one shared catalog top-up feeding both `deriveIsShort` and the new content-kind derivation; `setContentKind` |
| `src/movies/movies.service.spec.ts` | Modified | derivation + single-top-up + cache-shape cases |
| `src/movies/movies.resolver.ts` | Modified | `setMovieContentKind` |
| `src/movies/movies.resolver.spec.ts` | Modified | guard order for the new mutation |
| `src/movies/entities/movies.entity.ts` | Modified | `isLiveAction` → `contentKind` |
| `src/movies/dto/create-movie.dto.ts` | Modified | `isLiveAction?` → `contentKind?` |
| `src/shows/shows.service.ts` | Modified | the same derivation on the series path; `setContentKind` |
| `src/shows/shows.service.spec.ts` | Modified | series derivation cases |
| `src/shows/shows.resolver.ts` | Modified | `setShowContentKind` |
| `src/shows/entities/show.entity.ts` | Modified | `isLiveAction` → `contentKind` |
| `src/process-jobs/process-jobs.service.ts` | Modified | both arms return `contentKind` instead of `isLiveAction` |
| `src/process-jobs/process-jobs.service.spec.ts` | Modified | existing fixtures move to the enum |
| `src/process-jobs/entities/encode-job-details.entity.ts` | Modified | `isLiveAction` → `contentKind` |
| `prisma/seeds/movie.ts` | Modified | the dev fixture's `isLiveAction: true` → `contentKind` |
| `src/schema.gql` | Regenerated | never edited by hand (Constitution, Article IV) |

## Existing code to reuse

- `src/preferences/entities/language-track-kind.enum.ts` — the exact shape for a Prisma enum
  republished to GraphQL: a TS enum with string values plus one `registerEnumType`. `ContentKind`
  lives under `src/media/entities/` because `media/` owns the media-type boundary; importing it from
  `movies/`, `shows/` and `process-jobs/` is a plain TS import and adds **no Nest module edge**,
  exactly as `shows.resolver.ts` already imports `LanguageTrackKind` from `preferences/`.
- `src/pipeline-status/pipeline-status.ts` — the precedent for a rule as a plain exported function
  with no module and no injection. `src/media/content-kind.ts` follows it; do not make it a provider.
- `MoviesService.deriveIsShort()` / `getCachedMovie()` / `cacheMovies()` (`056`) — the top-up-and-
  recache mechanism this feature extends. Reuse the single `tmdb:movie:<id>` entry and its TTL;
  do not add a second Redis key.
- `MoviesService.setShort()` + `MoviesResolver.setMovieShort` (`048`) — the template for a per-title
  write: `findOneFromDb` ownership gate first, `assertEnabled(MEDIA_TYPE…)` in the resolver, plain
  `prisma.<model>.update`, return the row through `withDerivedStatus`.
- `ShowsResolver.setShowAudioMandatory` (`shows.resolver.ts:104`) — the series-side template: the
  ownership check lives in the **resolver** here (`findOneFromDb`, then
  `i18nError.notFound(ERROR_KEYS.SHOW_NOT_AVAILABLE)`), not inside the service as `MoviesService.setShort`
  does it. Follow each side's own neighbour rather than unifying them; that asymmetry is why the
  contract's error table names two different keys.
- `MoviesService.fetchMovieFromTMDB` / `ShowsService.fetchShowFromTMDB` — the only places a
  `details()` call may be made on a registration path; extend them rather than adding a third.
- `TmdbClient.fetchOne` / `fetchResults` / `TMDB_ENDPOINT` — the keywords method is one more
  `fetchOne` against an existing endpoint map, not a new fetch helper.

## Steps

1. `prisma/schema.prisma`: add `enum ContentKind`, drop both `isLiveAction` columns, add
   `contentKind ContentKind @default(LIVE_ACTION)` to `Movie` and `Show`. Generate the migration
   with `bin/npm api run prisma:migrate`. No backfill (`../plan.md` § Migrations).
2. `src/media/entities/content-kind.enum.ts`: the TS enum + `registerEnumType({ name: 'ContentKind' })`.
3. `src/media/content-kind.ts`: `classifyContentKind({ genreIds, keywordIds })`, with the genre id and
   the three keyword ids as named module constants. Order is load-bearing: not animated →
   `LIVE_ACTION` (and the caller must not have fetched keywords at all); animated and `3d-animation`
   present → `CGI`; animated and `anime`/`cartoon` present → `ANIME`; animated otherwise, including
   an absent/empty keyword list → `CGI`.
4. `src/clients/tmdb/types.ts` + `src/clients/types.ts` + `src/clients/tmdb/client.ts`: map `genres`
   to `genreIds` on both detail mappers; add `keywords(type, id): Promise<number[]>` reading
   `keywords` for a film and `results` for a series, returning `[]` for a body with neither. Widen
   `MovieDBClient`. Thread `genre_ids` through `popular.ts` and `multi.ts`, and through the two
   `search()` mappers in `movies.service.ts`/`shows.service.ts`.
5. `MoviesService.register()`: after `getCachedMovie()`, top the entry up **once** when either
   `runtime` or `genreIds` is missing, cache it once, then derive `isShort` (unchanged `056` logic)
   and `contentKind` from the resulting object. Fetch keywords only when `genreIds` says animated and
   `keywordIds` is not already cached; cache them back into the same entry. Every failure in this
   paragraph is caught and degrades per NFR-2 — never rethrown.
6. `ShowsService.register()`: the same, minus the runtime (a series has none). Note
   `getCachedShow()` currently does **not** write its fallback fetch back to Redis the way
   `getCachedMovie()` does — if this slice adds a top-up there, it caches the result the same way
   `cacheShows()` already offers, still best-effort and never awaited into the caller's path.
7. `MoviesService.setContentKind(id, userId, kind)` and its `ShowsService` twin: ownership gate,
   single-column update, return the row (films through `withDerivedStatus`, series as `show(id)`
   already returns one).
8. `MoviesResolver.setMovieContentKind` / `ShowsResolver.setShowContentKind`: `assertEnabled` for the
   type, then the service call. **No `assertShortsEnabled` analogue** — content kind has no
   capability of its own and is never disabled.
9. `process-jobs.service.ts` + `encode-job-details.entity.ts`: replace `isLiveAction` with
   `contentKind` in both the film arm and the episode arm (the episode reads its series' value).
   Nothing else in this file changes — `outputRoot`'s resolution is untouched.
10. `movies.entity.ts`, `show.entity.ts`, `create-movie.dto.ts`, `prisma/seeds/movie.ts`: the field
    rename. Confirm `src/schema.gql` regenerates to exactly the delta in `../spec.md`.

## Contract obligations

This service must expose exactly what `../spec.md` § GraphQL Contract Delta declares: the
`ContentKind` enum, `contentKind: ContentKind!` on `Movie`, `Show` and `EncodeJobDetails`, and the
two mutations with the refusals in that section's table — `error.media.type_disabled` (403) before
anything else, `error.movie.not_found` / `error.show.not_available` (404) for a title the caller does
not own or that does not exist, `error.auth.unauthenticated` (401) with no session, and GraphQL's own
argument validation for a value outside the enum. No new error key is added to
`src/i18n/error-keys.ts` or `src/i18n/messages.en.ts`.

`isLiveAction` must be gone from `schema.gql` entirely. The delta is read-only: if it is wrong, stop
and report.

## Tests

Owed under Article IX — each of these fails silently today:

- `src/media/content-kind.spec.ts` — the rule itself. A wrong precedence produces a perfectly valid
  enum value and a wrongly-tuned encode nobody sees until they watch the file. Cover: not animated
  (and that keywords are irrelevant), `3d-animation` alone, `anime` alone, `cartoon` alone, both
  `anime` and `3d-animation` (REQ-4's precedence — this is the case the author reversed once, so it
  earns an explicit `it(...)`), animated with an empty list, animated with `undefined`.
- `src/movies/movies.service.spec.ts` — three distinct silent failures: (a) a cache entry missing
  both `runtime` and `genreIds` must cost **one** `tmdb.details` call, asserted on the mock's call
  count (a second call is free of errors and doubles TMDB cost); (b) a failing `details()` or
  `keywords()` must still register the film, with the kind NFR-2 prescribes; (c) the derived
  `contentKind` must **not** appear in the object handed to `cacheMovies` — fault-inject by adding
  it and watching the case fail, the same technique the existing `inLibrary` ordering case uses.
- `src/clients/tmdb/client.spec.ts` — `keywords()` against a film body (`keywords:`) and a series
  body (`results:`). Reading the wrong key returns `undefined`, which the rule then reads as "no
  keywords" and classifies as `CGI` — a real answer and a fallback, indistinguishable downstream.
- `src/movies/movies.resolver.spec.ts` — guard order for `setMovieContentKind`, extending the
  existing `setMovieShort` suite's shape (a disabled type must refuse before the ownership read
  runs, or a caller learns whether a title exists in an installation that has films turned off).

Not owed: the `isLiveAction` → `contentKind` renames in `movies.entity.ts`, `show.entity.ts`,
`create-movie.dto.ts` and the dev seed — a mistake there is a typecheck or schema-generation error,
not a silent one. `process-jobs.service.spec.ts` is edited only to move its existing fixtures to the
enum; no new case is owed there, since `048` already covers that method's resolution shape.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/mysql -e 'select contentKind, count(*) from movies group by contentKind'
git status --short services/api/prisma
git diff services/api/src/schema.gql
```

0 typecheck errors; the suite green with at least the four test groups above added; the `bin/mysql`
read showing every pre-existing row on `LIVE_ACTION`; `git status` showing a modified
`schema.prisma` plus exactly one new migration directory; and the `schema.gql` diff matching
`../spec.md` § GraphQL Contract Delta with nothing extra.

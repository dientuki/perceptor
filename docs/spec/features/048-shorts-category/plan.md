---
title: Shorts Category — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-09
status: Implemented
---

# PLAN: Shorts Category (`plan.md`)

## Approach

Shorts are not a third media type. Everything this feature needs already exists as a seam somewhere
in `api`, and the plan is to widen those seams rather than open new ones:

- **The capability.** `045-media-type-availability` built `MediaCapabilitiesService`
  (`services/api/src/media/media-capabilities.service.ts`) as the one place `movies_enabled` /
  `shows_enabled` are read as booleans, with an `assertEnabled` enforcement half and an absent-row
  reads-as-enabled rule. `shortsEnabled` is a third computed property on that same service —
  `moviesEnabled && shorts_enabled !== 'false'`, and note the asymmetry: `shorts_enabled` seeds
  `false` and an **absent row reads as off**, the opposite of its two twins, because a category that
  does not exist yet must not appear on an install that predates it. The service moves into its own
  tiny `MediaCapabilitiesModule` (same directory, same file, no rename) so `MoviesModule` and
  `ProcessJobsModule` can import it without the cycle they would create by importing `MediaModule`,
  which already imports `MoviesModule`.
- **The classification.** One `Boolean @default(false)` column on `Movie`, and one mutation
  (`setMovieShort`) that goes through `MoviesService.findOneFromDb(id, userId)` — the same ownership
  gate every per-title mutation already runs, producing the same `error.movie.not_found` for "not
  yours" as for "does not exist".
- **The badge.** `MoviesService.enrichWithOwnership` already runs one `movie.findMany` per results
  page to attach `mediaId`/`inLibrary`. `isShort` is one more column in that `select` — no extra
  query, no extra TMDB call, and it reaches the billboard and both search screens at once because
  `MediaSearchService` and `PopularMediaService` both funnel through `cacheAndEnrich`.
- **The output root.** `ProcessJobsService.resolveOutputRoot` is already the single place a film's
  destination is decided, and the worker consumes the resolved string blindly
  (`services/worker/src/paths/build-output-path.ts`). One `isShort` branch there is the entire
  filing change — which is why `services/worker/` is untouched.
- **The listing split.** `MoviesService.findAll(userId)` gains an optional `isShort` filter argument
  rather than a second method; `web`'s `/shorts` is a new page that renders the existing
  `MediaList`/`MediaCard` with `mediaType: MEDIA_TYPE.MOVIE` and links to the existing
  `/movies/[id]`.

The alternative considered and rejected for the registration path was **`addMedia` unchanged plus a
follow-up `setMovieShort`** from `web`. It needs no new argument, but it makes registering a short
two round trips that can half-fail: the film lands as a feature, and nothing says so. `asShort` as an
optional argument on `addMedia` keeps registration atomic for one extra optional field.

The alternative rejected for classification itself is recorded in `spec.md` § Out of Scope: no
runtime threshold, no heuristic. Nothing in this plan calls TMDB.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the Prisma migration, the two Settings catalog entries and every field/argument in the delta. `web` cannot render `isShort`, filter `movies(isShort:)` or read `shortsEnabled` before the schema has them. |
| 2 | `web` | Consumes the frozen contract: capability read, listing split, badge, toggle, Settings panel. |
| 3 | `docs` | `docs/spec/graphql-contract.md` gains a `048` section once the shape is real in `schema.gql`. |

**Nothing runs in parallel across services here.** The `web` slice is almost entirely reads of
fields that do not exist until step 1 lands, so starting it early buys a diff that cannot be typed
against anything. Within `api`, the migration + catalog work (steps 1–3 of `api/plan.md`) must
precede everything else; within `web`, the capability plumbing must precede the routes that gate on
it. Step 3 can overlap step 2.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Four things an
implementer will be tempted to change and must not:

- **`MediaCapabilities.shortsEnabled` is the effective value, not the stored row.** `api` computes
  `movies_enabled && shorts_enabled` and ships one boolean. A `web` slice that re-derives
  `moviesEnabled && shortsEnabled` is harmless today and wrong the moment the rule gains a third
  term; an `api` slice that ships the raw row breaks REQ-3 in every consumer at once.
- **`isShort` must not enter `MediaSearchResult` in `services/api/src/clients/types.ts`.** That
  interface is the shape written to the shared Redis key `tmdb:movie:<tmdbId>` (24h, read by every
  user). `isShort` belongs beside `mediaId`/`inLibrary` on the **entity**
  (`src/media/entities/media-search-result.entity.ts`), computed per request after the cache write.
  Putting it on the cached shape is the ordering violation `docs/spec/graphql-contract.md` warns
  about in the `006-multi-search` section, and it fails silently for 24 hours.
- **`movies(isShort: Boolean)` stays optional and tri-state.** `null`/omitted means "every film I
  own", and that is the exact value `/movies` sends while shorts are disabled (REQ-11). Making it
  non-null with a `false` default would hide every already-flagged film the moment an administrator
  turns shorts off — a library that silently shrinks, with no error.
- **`Movie.isShort` and `MediaSearchResult.isShort` are non-null.** Every producer of a
  `MediaSearchResult` must set it, `ShowsService.cacheAndEnrich` included (`false` there, always). A
  missed producer is a GraphQL non-null violation at runtime on a screen that renders fine in the
  other service's tests.

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief both services.
Never patch it from inside one slice (Constitution, Article VIII).

## Migrations

1. **`add_movie_is_short`** — `ALTER TABLE movies ADD COLUMN isShort BOOLEAN NOT NULL DEFAULT false`,
   generated through `bin/npm api run prisma:migrate` from a `isShort Boolean @default(false)` field
   on `model Movie` (Constitution, Article III: `schema.prisma` and the migration directory land in
   the same diff, never one without the other).
2. **Backfill: none, deliberately.** The column default is the correct value for every existing row —
   `spec.md` § Out of Scope rules out inferring shortness from anything, so there is nothing to
   compute. This is the property that makes the migration a pure `ALTER TABLE` on a table whose size
   is a home library's, not a fleet's.
3. **Seeds** — `services/api/prisma/seeds/settings.ts` gains `{ key: 'shorts_enabled', value:
   'false' }` and `{ key: 'path_shorts', value: 'Shorts' }`. The seed is upsert-shaped, so an
   existing install picks both up on the next seed run; an install that never reruns the seed is
   covered by the absent-row defaults (NFR-3) rather than by an error.

**Reversibility.** Dropping the column loses only hand-set classifications; no file on disk and no
other row depends on it. Rolling back while shorts were enabled leaves already-filed shorts under
`path_shorts`, where they stay — Perceptor does not move library files in either direction
(Constitution, Article XII).

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| `isShort` leaks into the shared TMDB Redis cache | One user's registered-short flag is served to every other user searching that film for 24h. No error, anywhere — the same class of bug the cache-before-enrich ordering already exists to prevent. | Contract Freeze bullet 2; `movies.service.spec.ts` already asserts the ordering and gains an assertion that the object handed to `cacheMovies` carries no `isShort`. |
| Wrong `outputRoot` for a short | The film is transcoded successfully and filed in the wrong folder. Every status says `COMPLETED`; the only symptom is a file the user cannot find. | `process-jobs.service.spec.ts` covers all four combinations (short/not × shorts enabled/disabled), including `path_shorts` missing → `error.setting.missing`. AC-5 checks it live. |
| Absent `shorts_enabled` row read as enabled | An install that predates the seed would show a Shorts category nobody turned on, and start filing films into a `path_shorts` that may not resolve. | The default is deliberately inverted from its two twins (absent ⇒ **off**) and is asserted in `media-capabilities.service.spec.ts`. Named explicitly in `api/plan.md` because the surrounding code reads `!== 'false'` everywhere and the idiom invites a copy-paste. |
| A `MediaSearchResult` producer forgets `isShort` | Non-null violation at runtime; the whole search response comes back as an error. Loud, but on a screen no `api` test renders. | `shows.service.spec.ts` and `movies.service.spec.ts` both assert the field is present on every enriched row; `media-search.service.spec.ts` covers the mixed grid. |
| Module cycle `MoviesModule ↔ MediaModule` | Nest fails to boot with an "circular dependency" error, or worse, resolves a partially-initialised provider through `forwardRef`. | `MediaCapabilitiesModule` depends only on `SettingsModule` and is imported by the other three. No `forwardRef` anywhere in this feature — if an implementer reaches for one, the module split was done wrong. |
| Toggling `isShort` mid-encode | Confusing rather than silent: a job whose details were already fetched files under the old root. | REQ-13 states the rule; no lock is added. `api/plan.md` says explicitly not to add one. |
| `web` re-derives the `&&` | Drifts from `api` the moment the rule changes; both look right in isolation. | Contract Freeze bullet 1; `web/plan.md` names `capabilities.shortsEnabled` as the only value any component reads. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
bin/npm web run lint
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
git status services/worker        # must be clean (NFR-2)
```

Then the manual pass, which is `spec.md`'s acceptance criteria in order:

1. `bin/dbreset`, sign in. No **Shorts** in the sidebar; `/shorts` renders the not-found page (AC-1).
2. Settings → Media Manager: the shorts switch and its folder picker are greyed while **Movies** is
   off, live again when it is on. Turn shorts on, save, reload — **Shorts** appears (AC-2, AC-10).
3. Search a short from the header, register it with "add as short": it appears in `/shorts`, not in
   `/movies`; `bin/mysql -e 'select isShort from movies order by id desc limit 1'` returns `1` (AC-3).
4. Open an existing feature film's `/movies/[id]`, flip the toggle, reload: the card moves to
   `/shorts` and the title is badged in `/search` (AC-4).
5. Acquire and complete both a flagged and an unflagged film; check the two destination folders
   (AC-5), then flip a `COMPLETED` film's flag and confirm nothing moved (AC-9).
6. The three refusals, issued by hand against `/graphql` with a user token: `setMovieShort` with
   shorts off → `error.media.shorts_disabled` (AC-6); `addMedia(type: "show", asShort: true)` →
   `error.media.shorts_not_a_movie` (AC-7); `setMovieShort` on another user's film →
   `error.movie.not_found` (AC-8).

---
title: Shorts Category
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-07
last_updated: 2026-09-09
status: Implemented
services: [api, web]
---

# SPEC: Shorts Category (`spec.md`)

## Context & Goal

A short film is a film. Perceptor registers it in `movies`, downloads it, transcodes it and files it
under `path_movies` alongside everything else, and that is correct — a short needs no separate
pipeline, no separate ffprobe rules and no separate acquisition path. What it does not survive is
volume: fifty shorts in the same folder as forty features turns both `/movies` and the library
directory into something the user has to scan rather than browse, and a media server pointed at that
folder inherits the same mess.

This feature adds an opt-in **Shorts** category that reuses the film pipeline end to end and changes
exactly two things about a film the user has marked: which listing it appears in, and which library
folder it is filed into. It is a `Movie` row with a new `isShort` flag (`services/api/prisma/schema.prisma`,
`model Movie`), a new `shorts_enabled` switch and a new `path_shorts` folder in Settings
(`services/api/src/settings/settings.catalog.ts`, `components/settings/MediaManagerPanel.tsx`), a new
`/shorts` listing in `web` that reuses the existing `/movies/[id]` detail page, and one extra branch
in `ProcessJobsService.resolveOutputRoot` (`services/api/src/process-jobs/process-jobs.service.ts`),
which is already the single place a film's `outputRoot` is decided.

Shorts are **subordinate to movies**: `shorts_enabled` only takes effect while `movies_enabled` is
also on, in the same system-wide, every-user sense `045-media-type-availability` established for the
existing pair. The flag itself is set by hand — at registration time from the search results, or
later from the film's own detail page — and never inferred, because TMDB's search endpoints return no
`runtime` and buying a `runtime` per search row would mean a details call for every result of every
search. Nothing about a title's classification is guessed from its length, its genre or its filename.

No pipeline stage in the root `CLAUDE.md` changes status and `services/worker/` is not touched: the
worker already receives a resolved `outputRoot` in its job payload and joins the film folder layout
onto it (`services/worker/src/paths/build-output-path.ts`), so "file this one somewhere else" is
entirely an `api` decision. Files already written are never moved (Constitution, Article XII) —
marking an already-filed film as a short changes where its *next* encode lands, not where its
existing file lives.

## Requirements

### Functional Requirements

- [x] **REQ-1 (The flag)**: A film must carry a boolean `isShort`, `false` by default. It is a
      property of the film, shared by every user who has it in their library — the same stance as
      `isLiveAction`, and the reason is the same: `path_shorts` is one system-wide folder, so a
      per-user classification would file the same film in two places.
- [x] **REQ-2 (Two new settings)**: Settings must carry `shorts_enabled` (boolean, seeded `false`)
      and `path_shorts` (a segment relative to the `library` root, seeded `Shorts`), editable from
      Settings → Media Manager next to their movies/series twins.
- [x] **REQ-3 (Subordinate to movies)**: The **effective** shorts capability is
      `movies_enabled && shorts_enabled`. Turning movies off turns shorts off with it, without ever
      rewriting the stored `shorts_enabled` value — re-enabling movies restores shorts exactly as the
      administrator left them (same stance as `045` REQ-9 for scheduled tasks). In Settings, the
      shorts switch and the `path_shorts` picker are non-interactive while movies is off.
- [x] **REQ-4 (Capability query)**: `mediaCapabilities` must expose the effective shorts capability
      alongside the existing two, so every `web` surface reads one value and never re-derives the
      `&&` itself.
- [x] **REQ-5 (Register as a short)**: While shorts are enabled, a film search result must offer
      registering the title as a short in addition to the plain add. Both paths run the identical
      registration `addMedia` runs today — same TMDB cache read, same `user_movies` link, same media
      server reconciliation — and differ only in the value written to `isShort`.
- [x] **REQ-6 (Toggle from the detail page)**: While shorts are enabled, the film detail page
      (`/movies/[id]`) must let a user who owns the film flip `isShort` in both directions, so a title
      registered as a feature can be reclassified later and vice versa. This is the only way an
      already-registered film becomes a short — there is no migration and no automatic backfill.
- [x] **REQ-7 (Search badge)**: While shorts are enabled, a search result already registered as a
      short must be badged as such, next to the existing movie/series type badge. A result nobody has
      registered carries no badge — the system does not know, and does not ask TMDB, whether an
      unregistered title is short.
- [x] **REQ-8 (Sidebar and listings)**: While shorts are enabled, the sidebar must show a **Shorts**
      entry between Movies and Series, `/shorts` must list exactly the caller's films with
      `isShort: true`, and `/movies` must list exactly the caller's films with `isShort: false`. The
      split is a server-side filter on the `movies` query, not a client-side filter of a full list.
- [x] **REQ-9 (One detail page)**: A card in `/shorts` links to `/movies/[id]`. There is no
      `/shorts/[id]`: the detail page, its torrent search modal, its upload modal and its language
      preferences are reused unchanged.
- [x] **REQ-10 (Route gating)**: While shorts are disabled, `/shorts` must answer the existing
      not-found page, exactly as `/shows` does with series disabled (`045` REQ-6).
- [x] **REQ-11 (Disabled means invisible, not lost)**: While shorts are disabled, `isShort` has no
      effect anywhere: `/movies` lists every film the caller owns including the ones flagged short, no
      badge is rendered, no toggle is offered, and every film — flagged or not — is filed under
      `path_movies`. The stored flags are left untouched, so enabling shorts again re-sorts the
      library listing with no data migration.
- [x] **REQ-12 (Output root)**: A `ProcessJob` for a film with `isShort: true` must resolve its
      `outputRoot` from `path_shorts` instead of `path_movies`, and only while shorts are effectively
      enabled. Everything else about the job payload — the folder layout, the filename, the metadata
      tags of `046`, the language selection — is identical to a feature film's.
- [x] **REQ-13 (Reclassification is not a move)**: Flipping `isShort` never moves, renames, copies or
      deletes a file already written to the library, and never rewrites a film's stored `filePath`. It
      takes effect on the next encode of that film, at the moment the worker asks `api` for that job's
      details; a job whose details were already handed out finishes at the root it was given.
- [x] **REQ-14 (Enforcement, not just hiding)**: `api` must refuse to register a title as a short, and
      refuse to flip the flag, while shorts are not effectively enabled — a hidden control is not the
      only thing standing between a disabled category and a flagged row.
- [x] **REQ-15 (Nothing else is gated)**: Acquisition, download progress, the tus upload route,
      `torrentCompleted`, `encodeCompleted`/`encodeFailed`, `/downloads`, `/calendar` and every
      `worker` job behave identically for a short and for a feature film. Disabling shorts mid-flight
      never refuses work already under way (the rule `045` REQ-11 set, applied here unchanged).

### Non-Functional & Operational Requirements

- [x] **NFR-1 (No new external calls)**: This feature adds no TMDB request on any path. The search
      badge of REQ-7 is served from the ownership query `MoviesService.enrichWithOwnership` already
      runs once per results page — one extra selected column, not one extra query and never one
      request per row.
- [x] **NFR-2 (Worker untouched)**: No file under `services/worker/` changes. `outputRoot` is already
      resolved by `api` and consumed blindly by `buildOutputPath`, which is what makes REQ-12 a
      one-branch change rather than a pipeline change.
- [x] **NFR-3 (Migration is additive)**: `Movie.isShort` is added non-null with a `false` default, so
      every existing row is correct without a backfill script. The two new Settings rows are seeded
      and, when absent from an install that predates them, read as their defaults rather than as an
      error — `shorts_enabled` absent means shorts off, `path_shorts` absent means shorts cannot be
      effectively enabled and `resolveOutputRoot` raises the existing `error.setting.missing`.
- [x] **NFR-4 (Path safety)**: `path_shorts` is a `kind: 'path'` catalog entry against the `library`
      root and is validated by `MediaRootsService` on write like its twins. An absolute container path
      never crosses the GraphQL boundary in either direction (Constitution, Article V).
- [x] **NFR-5 (One capability read per render)**: A page render reads `mediaCapabilities` once and
      passes it down, reusing the `cache()`-wrapped `getMediaCapabilities()` of `045` rather than
      adding a second fetch.
- [x] **NFR-6 (System-wide)**: Like `movies_enabled`/`shows_enabled`, the shorts capability is
      identical for every user, administrator included. There is no per-user override.

## GraphQL Contract Delta

```graphql
type MediaCapabilities {
  moviesEnabled: Boolean!
  showsEnabled: Boolean!
  shortsEnabled: Boolean!
}

type Movie {
  isShort: Boolean!
}

type MediaSearchResult {
  isShort: Boolean!
}

type Query {
  movies(isShort: Boolean): [Movie!]!
}

type Mutation {
  addMedia(tmdbId: Int!, type: String!, asShort: Boolean): MediaRef!
  setMovieShort(movieId: Int!, isShort: Boolean!): Movie!
}
```

`MediaCapabilities.shortsEnabled` is the **effective** capability of REQ-3 (`movies_enabled &&
shorts_enabled`), never the raw stored row — no consumer recombines it. `Movie.isShort` and
`MediaSearchResult.isShort` are new non-null fields; on a search result `isShort` is `false` for any
title not registered by anyone, and reflects the registered row otherwise (REQ-7). Only the `Movie`
listing takes the new optional `isShort` argument: omitted or `null` means "every film the caller
owns", which is what `/movies` sends while shorts are disabled (REQ-11). `addMedia` gains one
optional argument defaulting to `false`, so an unpatched consumer keeps working; `movie(id:)`,
`shows`, `searchMedia`, `searchAllMedia`, `popularMedia` and every acquisition mutation are unchanged.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `addMedia(asShort: true)` or `setMovieShort` while shorts are not effectively enabled | `ForbiddenException`, `error.media.shorts_disabled` | `Los cortos están deshabilitados en este sistema` |
| `addMedia(asShort: true, type: "show")` | `BadRequestException`, `error.media.shorts_not_a_movie` | `Sólo una película puede registrarse como corto` |
| `movies(isShort: …)` or `setMovieShort` while movies are disabled | `ForbiddenException`, `error.media.type_disabled` (existing) | `Las películas están deshabilitadas en este sistema` |
| `setMovieShort` for a film id the caller does not own (or that does not exist) | `NotFoundException`, `error.movie.not_found` (existing) | `Recurso no disponible para este usuario` |
| `getEncodeJobDetails` for a short while `path_shorts` is missing from Settings | `NotFoundException`, `error.setting.missing` (existing) | `Falta la configuración path_shorts` |

The two new keys (`error.media.shorts_disabled`, `error.media.shorts_not_a_movie`) join `ERROR_KEYS`
in `services/api/src/i18n/error-keys.ts` with their English rendering in `messages.en.ts`, and get an
`en`/`es` entry in `services/web/messages/{en,es}.json`.

What each consumer does with them:

- **`web` — `/search` and `MultiSearchResults`.** The "add as short" affordance is only rendered
  while `shortsEnabled`, so `error.media.shorts_disabled` is the backstop for the race where an
  administrator flips the switch between render and submit. It surfaces through the existing
  `translateGraphQLError` path in the same inline error slot the failed-add message already uses,
  never swallowed and never retried as a plain add.
- **`web` — `/movies/[id]`.** The toggle reverts to its previous state and shows the translated
  error on refusal; it never leaves the UI showing a flag the server did not accept.
- **`web` — `/movies` and `/shorts`.** Both send the `isShort` argument only while shorts are
  enabled; `error.media.type_disabled` from either is already handled by the existing movies-disabled
  path of `045`.
- **`worker`.** Consumes none of this. `EncodeJobDetails` keeps its exact shape — `outputRoot` is a
  resolved string and the worker cannot tell a short from a feature (NFR-2).

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `Movie` | new field `isShort Boolean` | non-null, `@default(false)` | No — the default is correct for every existing row (NFR-3) |
| `Setting` | two new seeded rows: `shorts_enabled` (`'false'`), `path_shorts` (`'Shorts'`) | rows, not columns | No — absent rows read as their defaults |

The migration lives in `services/api/prisma/migrations/` and is generated through
`bin/npm api run prisma:migrate` (Constitution, Article III). `SETTINGS_CATALOG` gains
`shorts_enabled: { kind: 'boolean' }` and `path_shorts: { kind: 'path', rootId: 'library' }`, and
`services/web/src/actions/settings.ts`'s `EDITABLE_KEYS` gains both.

## Acceptance Criteria

- [x] **AC-1**: After `bin/dbreset`, `bin/mysql -e "select value from settings where \`key\` in ('shorts_enabled','path_shorts')"` returns `false` and `Shorts`; the sidebar shows no **Shorts** entry and `/shorts` renders the not-found page.
- [x] **AC-2**: Turning `shorts_enabled` on in Settings → Media Manager and reloading makes the **Shorts** sidebar entry and the `/shorts` route appear, with `/movies` still listing every film (all of which are `isShort: false` at this point).
- [x] **AC-3**: With shorts enabled, searching a short film and registering it as a short lands it in `/shorts` and not in `/movies`, and `bin/mysql -e 'select isShort from movies order by id desc limit 1'` returns `1`.
- [x] **AC-4**: With shorts enabled, opening an already-registered feature film's `/movies/[id]`, flipping the shorts toggle on and reloading moves the card from `/movies` to `/shorts`, and re-searching that title in `/search` now shows it badged as a short.
- [x] **AC-5**: Acquiring and completing a film flagged `isShort` files the output under the `path_shorts` folder (`Shorts/<Title> (<year>) [tmdbid=…]/…`), while a film not flagged, completed in the same session, still lands under `path_movies`.
- [x] **AC-6 (failure path)**: With `shorts_enabled` off, a hand-issued `setMovieShort(movieId: <id>, isShort: true)` is rejected with `extensions.i18n.key = "error.media.shorts_disabled"` and writes nothing: `bin/mysql -e 'select isShort from movies where id = <id>'` returns the same value before and after. The same call with `movies_enabled` off is rejected with `error.media.type_disabled`.
- [x] **AC-7 (failure path)**: A hand-issued `addMedia(tmdbId: 1399, type: "show", asShort: true)` is rejected with `error.media.shorts_not_a_movie` and creates no row in `shows`.
- [x] **AC-8 (failure path)**: A hand-issued `setMovieShort` naming a film registered by a **different** user is rejected with `error.movie.not_found`, indistinguishable from a film id that does not exist.
- [x] **AC-9 (nothing is moved)**: Flipping `isShort` on a film already `COMPLETED` leaves its file exactly where it is — the path under `path_movies` still exists, no file appears under `path_shorts`, and the film's stored `filePath` is unchanged.
- [x] **AC-10 (regression)**: With shorts enabled and at least one film flagged, turning `movies_enabled` off hides Movies **and** Shorts from the sidebar, makes both routes answer the not-found page, and leaves both stored settings untouched (`bin/mysql -e "select value from settings where \`key\` = 'shorts_enabled'"` still returns `true`); turning movies back on restores both.
- [x] **AC-11**: `bin/npm api test` passes, `bin/cli api npx --no tsc --noEmit` reports 0 errors, and `bin/npm web run build` exits 0. `git status services/worker` is clean, per NFR-2.

## Out of Scope

- **Detecting a short automatically.** No runtime threshold, no genre heuristic, no filename parsing.
  TMDB's search endpoints carry no `runtime`, so an automatic badge in search results would cost one
  details request per row per search; a threshold applied only at add time would leave the search
  results unbadged, which is the surface the classification is most useful on. The flag is set by
  hand (REQ-5, REQ-6). A later spec can add inference on top of the same column without changing
  anything here.
- **A backfill of existing films.** Nothing scans the library or asks TMDB about films already
  registered. They stay `isShort: false` until a user flips the toggle (REQ-6), which is also the
  only reason `Movie.isShort` can be added without a data migration (NFR-3).
- **Moving files when a film is reclassified.** REQ-13 and Constitution Article XII: Perceptor never
  removes from the destinations root, and a copy-then-orphan is worse than leaving the file where the
  user's media server already indexed it.
- **A "popular shorts" carousel.** TMDB has no shorts-popular endpoint and the billboard is built on
  `popularMedia(type:)`; the dashboard is unchanged by this feature.
- **A Shorts tab in `/preferences`.** A short is a film: it inherits the movie language preferences
  and the per-title `audioMandatory` flag through the same `/movies/[id]` controls (REQ-9). Splitting
  the preference set would mean a second `UserPreference` scope for no stated need.
- **Series shorts, and shorts inside a series.** `isShort` exists on `Movie` only. A one-off special
  or a short episode stays an `Episode` under its series and is filed under `path_shows`.
- **`/downloads` and `/calendar`.** Both are about work in flight and both stay mixed, exactly as
  `045` left them (REQ-15).
- **Media server configuration.** Pointing Jellyfin at the new shorts folder is the operator's job.
  `MediaServerService.notifyCreated` keeps translating whatever output path it is handed
  (`MediaRootsService.containerToHostPath()`); nothing about the notification or the local index
  changes.
- **A per-user classification.** REQ-1 is explicit that `isShort` belongs to the film, not to the
  `user_movies` row, because `path_shorts` is one system-wide folder.

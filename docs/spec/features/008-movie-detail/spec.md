---
title: Movie Detail Resource, Scoped to Its Owner
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-12
last_updated: 2026-08-12
status: Implemented
services: [api, web]
---

# SPEC: Movie Detail Resource, Scoped to Its Owner (`spec.md`)

## Context & Goal

The film detail screen already exists and works. `/movies/<id>`
(`services/web/src/app/(dashboard)/movies/[id]/page.tsx`) resolves the route param through
`getMovieById` (`services/web/src/actions/movies.ts`), which asks the API for
`movie(id: Int!): Movie`, and renders two things: the `Movie` component
(`services/web/src/components/movies/Movie.tsx` — poster, title, year/language/status line,
synopsis, and the File/Magnet import buttons) and `SearchTorrent`
(`services/web/src/components/search/SearchTorrent.tsx` — the Prowlarr release search that feeds
`addTorrentToMovie`). The library card at `services/web/src/components/media/MediaCard.tsx` links
here when `showLink` is set. None of that behaviour is in question; this spec exists to write it
down and to close the one hole in it.

The hole is ownership. `005-movie-search` made the library per-user — `movies` returns only the
caller's films through the `user_movies` join, and `attachTorrentSource` refuses a film the caller
is not linked to — but `movie(id)` was **deliberately left unscoped**, and
`docs/spec/graphql-contract.md` says so in as many words: "any authenticated user can still read a
single film by internal id, because the catalog itself is shared."
`MoviesResolver.getMovieById` (`services/api/src/movies/movies.resolver.ts`) takes no
`@CurrentUser()` at all and calls `MoviesService.findOneFromDb(id)`, a bare
`prisma.movie.findUnique({ where: { id } })`. In practice that means user A typing `/movies/7` in
the URL bar sees user B's film — its title, poster, synopsis, pipeline status, and (through
`generateMetadata`, which fetches the same record) its title in the browser tab — plus a live
release-search panel pointed at it. The library listing was made private; its detail page was not,
and the shared-catalog argument does not survive contact with a screen that also exposes per-user
pipeline state.

A second, quieter instance of the same hole sits on the same screen. `createUploadTicket(movieId)`
(`services/api/src/uploads/uploads.resolver.ts`) mints an upload ticket for whatever `movieId` it is
handed after checking only that the caller is a user, never that the caller owns that film. The
File button on the detail page is what calls it, so a user standing on someone else's detail page
can attach a file to a film that is not theirs. `addTorrentToMovie` and `addMagnetToMovie` on the
same screen are already scoped and stay as they are.

Once this ships, `movie(id)` answers only for films in the caller's own library, and a request for
anything else — a film that does not exist, or one that exists but belongs to somebody else — is a
single indistinguishable "not available" response. The web page turns that into a Spanish page
saying the resource is not available for this user, instead of the framework's stock English 404
(there is no `not-found.tsx` anywhere under `services/web/src/app` today, so `notFound()` currently
falls through to Next's default). No pipeline stage in the root `CLAUDE.md` changes status: the
**Browse library** row already says "working", and this makes its detail half correct rather than
newly functional.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Detail read)**: A user must be able to open a film that is in their own library by
      its internal id and see its title, poster, synopsis, release year, original language and
      pipeline status.
- [x] **REQ-2 (Ownership scope)**: The single-film read must return a film only when the calling
      user is linked to it. A film registered by another user, and not linked to the caller, must
      not be readable — even though the `movies` row itself is shared between them.
- [x] **REQ-3 (Indistinguishable absence)**: A film that does not exist and a film the caller does
      not own must produce the **same** response. The API must not let a caller tell the two apart,
      by message, error type, or timing-independent shape — an enumerable "exists but not yours"
      is itself a leak about another user's library.
- [x] **REQ-4 (Unavailable page)**: When the film is not available to the caller, the web app must
      render a page carrying the message `Recurso no disponible para este usuario` and must not
      render any part of the film — no title, no poster, no synopsis, no import buttons, no release
      search.
- [x] **REQ-5 (No leak through page metadata)**: The document title and description of the
      unavailable page must not contain any data belonging to the requested film.
- [x] **REQ-6 (Malformed id)**: A route param that is not a positive integer must reach the same
      unavailable page, not a crash and not a server error.
- [x] **REQ-7 (Upload ticket scope)**: Minting an upload ticket for a film must require that the
      calling user is linked to that film, and must refuse otherwise.
- [x] **REQ-8 (Actions unchanged)**: The import and release-search actions already reachable from
      the detail page must keep working unchanged for a film the caller owns.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Authentication)**: Every caller must already be authenticated — the global
      `JwtAuthGuard` (registered as `APP_GUARD` in `services/api/src/app.module.ts`) covers this. A
      caller holding the service credential (`SERVICE_TOKEN`) must keep being **refused outright**:
      `movie(id)` carries no `@AllowService()`, and the guard is deny-by-default for a `service`
      principal, so the request fails with `UnauthorizedException('No autenticado')` before the
      resolver runs at all
      (`services/api/src/auth/guards/jwt-auth.guard.ts:44-57`). The decorator must **not** be added
      by this feature — the requirement here is to preserve a rejection that already exists, not to
      make a machine caller resolve to an empty result.
- [x] **NFR-2 (Contract note)**: `docs/spec/graphql-contract.md` currently states in writing that
      `movie(id)` is intentionally unscoped. That paragraph becomes false with this change and must
      be superseded in the same delivery — the SDL does not move, so this document is the only place
      the semantic change is recorded, and `web` retypes the schema by hand with no codegen to catch
      it (Article VIII).
- [x] **NFR-3 (No behavioural regression elsewhere)**: `movie(id)` has exactly one consumer,
      `getMovieById` in `services/web/src/actions/movies.ts`. Nothing in `worker` reads it. Scoping
      it must not require a change to any other query or mutation.
- [x] **NFR-4 (Typecheck baseline)**: `bin/cli api npx --no tsc --noEmit` must still report 0
      errors, and `bin/cli web npx --no tsc --noEmit` must still report exactly the 12 pre-existing
      errors across the 5 pre-GraphQL files listed in the root `CLAUDE.md` — no more, and none in a
      file this feature touches.
- [x] **NFR-5 (Worker unaffected)**: `worker` must require no change whatsoever, and no compensating
      exemption must be added on its behalf. It never reads a film by internal id — its eight
      operations are `mediaSource`/`sourceScanned` (`services/worker/src/jobs/source-ready.job.ts`)
      and `processJob` plus the five encode notifications (`services/worker/src/jobs/encode.job.ts`),
      and none of them is `movie(id)`. Every film field it needs to build the output path and the
      FFmpeg command — `tmdbId`, `title`, `year`, `originalLanguage`, `originalLanguageIso3`,
      `isLiveAction`, `outputRoot` — arrives pre-joined on `processJob`, which the API assembles by
      joining `Movie` itself in `ProcessJobsService.getEncodeJobDetails`
      (`services/api/src/process-jobs/process-jobs.service.ts:18-58`) and which already carries
      `@AllowService()` (`services/api/src/process-jobs/process-jobs.resolver.ts:16`).
      `buildOutputPath` (`services/worker/src/paths/build-output-path.ts:49`) consumes exactly that
      payload. The machine credential's legitimate need for film data is therefore already served by
      an authorized channel this feature does not touch.

## GraphQL Contract Delta

The SDL is **unchanged**. `movie(id: Int!): Movie` keeps its name, argument and nullable return
type; `createUploadTicket(movieId: Int!): UploadTicket!` keeps its signature. What changes is
semantics that no typechecker can see, which is precisely why it is written here:

```graphql
type Query {
  # unchanged shape — now resolves against the CALLER'S library only
  movie(id: Int!): Movie
}

type Mutation {
  # unchanged shape — now refuses a movieId the caller is not linked to
  createUploadTicket(movieId: Int!): UploadTicket!
}
```

`movie(id)` **no longer returns a film the caller does not own.** It returns `null` in that case,
the same `null` it already returns for an id that does not exist. `null` therefore stops meaning
"no such film" and starts meaning "no such film *for you*" — consumers must not read a non-null
result as proof the film is globally unique, nor a null as proof the row is absent from the
database. This supersedes the paragraph in `docs/spec/graphql-contract.md` under `005-movie-search`
that records `movie(id)` as deliberately unscoped.

The choice of `null` over an error is deliberate and follows the precedent already set by
`attachTorrentSource`, which answers an unowned film with the identical
`NotFoundException('La película <id> no existe')` it uses for a missing one: one response, one
message, no way to enumerate other users' libraries (see `005-movie-search/spec.md` § Errors).

**The user scoping introduces no exemption for the machine principal, and needs none.** `movie(id)`
carries no `@AllowService()`, so a `SERVICE_TOKEN` caller is rejected by the guard before the
resolver runs — that is true today and stays true. The worker's real need for film metadata is
already served by `processJob`, which does carry `@AllowService()` and returns `Movie`'s fields
pre-joined by the API (see NFR-5). So there is no principal for which `movie(id)` returns an
unowned film, and "the caller's library" has exactly one meaning here rather than two. Any future
change that grants the service credential access to this query must state which worker code path
requires it, because none does today.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `movie(id)` where the id does not exist | none — `data.movie` is `null`, no `errors` | *(none from the API; `web` renders the page below)* |
| `movie(id)` where the film exists but the caller is not linked to it | none — `data.movie` is `null`, no `errors` | *(none from the API; `web` renders the page below)* |
| `web` receives `movie: null` for either reason | HTTP 404 on the page response | `Recurso no disponible para este usuario` |
| Route param is not a positive integer | HTTP 404 on the page response, no API call needed | `Recurso no disponible para este usuario` |
| `createUploadTicket(movieId)` where the caller is not linked to the film | `NotFoundException` | `La película <id> no existe` — the exact string `attachTorrentSource` already uses, for the same reason |
| Any of the above with an expired/absent credential | `UnauthorizedException` (existing global guard) | unchanged from today |

Consumer obligations:

- **`web` — `getMovieById`**: must keep returning `null` on `data.movie === null` and must **not**
  turn it into a thrown error. Its existing `redirectToClearSession(errors)` handling for auth
  errors stays as is (cookie mutation is illegal inside a Server Component render, which is why that
  path exists at all).
- **`web` — the detail page**: must map that `null` to the unavailable page for both the page render
  and `generateMetadata`, and must not call `SearchTorrent` or the import components in that branch.
- **`web` — the upload flow**: `createUploadTicket` failing with `NotFoundException` is now reachable
  by a user who never should have seen the button; the existing error surface for that mutation is
  sufficient and must not be widened with a distinct "not yours" message.
- **`worker`**: no obligation — it does not read `movie(id)`.

## Data Model Changes

**None.** The `UserMovie` join (`user_movies`, composite PK `[userId, movieId]`, indexed on
`movieId`) introduced by `005-movie-search` is exactly the table this scoping reads, and it is
already populated — including the backfill that put every pre-existing film on the oldest enabled
admin. No migration.

## Acceptance Criteria

- [x] **AC-1**: Given user A has film `X` in their library, when A opens `/movies/<X.id>`, then the
      page renders `X`'s title, poster, synopsis and status, and the import buttons and release
      search are present — unchanged from today.
- [x] **AC-2**: Given film `X` is in user B's library and **not** in user A's, when A opens
      `/movies/<X.id>`, then the page shows `Recurso no disponible para este usuario`, the HTTP
      status is 404, and the response body contains none of `X`'s title, poster URL or synopsis.
- [x] **AC-3**: With A's session cookie, `movie(id: <X.id>)` returns `{"data":{"movie":null}}` with
      no `errors` array — byte-identical to the response for an id that exists in no library at all
      (verify by running both and diffing).
- [x] **AC-4**: With B's session cookie, the same `movie(id: <X.id>)` query returns the film. The
      row was never deleted; only the caller changed.
- [x] **AC-5**: `/movies/999999999` (no such id) and `/movies/abc` (not a number) both render the
      same unavailable page with status 404, and neither produces a 500 or an unhandled exception in
      `bin/cli api` logs.
- [x] **AC-6**: The browser tab title on the unavailable page contains no film title — it is the
      generic unavailable-resource title, identical for AC-2 and AC-5.
- [x] **AC-7**: With A's session, `createUploadTicket(movieId: <X.id>)` (B's film) returns a GraphQL
      error whose message is `La película <X.id> no existe`, and no ticket is minted (no
      corresponding `jti` in Redis).
- [x] **AC-8**: With B's session, `createUploadTicket(movieId: <X.id>)` still mints a ticket, and the
      full tus upload through `POST /uploads` still completes and registers the `MediaSource` — the
      existing upload path is untouched for the owner.
- [x] **AC-9**: With A's session, `addTorrentToMovie(movieId: <X.id>, …)` and
      `addMagnetToMovie(movieId: <X.id>, …)` still fail with `La película <X.id> no existe` — proving
      this feature did not regress the scoping `005-movie-search` already put there.
- [x] **AC-10**: `bin/npm api test` passes, including a new case asserting that `findOneFromDb`
      returns `null` for a film the given user is not linked to.
- [x] **AC-11**: `bin/cli api npx --no tsc --noEmit` reports 0 errors; `bin/cli web npx --no tsc
      --noEmit` reports exactly 12, all in the five pre-existing files.
- [x] **AC-12**: `docs/spec/graphql-contract.md` no longer asserts that `movie(id)` is unscoped, and
      records the new meaning of its `null`.
- [x] **AC-13**: With `SERVICE_TOKEN` as the bearer (no user cookie), `movie(id: <X.id>)` returns a
      GraphQL error whose message is exactly `No autenticado` — byte-identical to the response for a
      request carrying no credential at all, so a machine caller cannot distinguish "wrong principal
      type" from "unauthenticated" (`services/api/src/auth/guards/jwt-auth.guard.ts:50-55`). No film
      data appears in the response.
- [x] **AC-14**: With the `worker` container running, a film owned by user B goes through the full
      pipeline end to end — source scanned, `ProcessJob` picked up, FFmpeg encode completed — and the
      output lands at `<outputRoot>/<Title> (<year>) [tmdbid=<id>]/<Title> (<year>).mkv`. This is the
      direct proof that scoping `movie(id)` did not touch the worker's path: it never called that
      query, and `processJob` still answers it with the machine credential.

## Out of Scope

- **The series detail page.** `services/web/src/app/(dashboard)/shows/[id]/page.tsx` is a
  byte-for-byte copy of the movie detail page — it imports `getMovieById` and renders
  `MEDIA_TYPE.MOVIE`, so `/shows/<id>` currently shows *a film* with that id, or nothing. There is
  no `show(id)` query on `ShowsResolver` at all. That is a real bug and a real gap, and the root
  `CLAUDE.md`'s "next spec" note points at it, but fixing it means designing the series detail
  surface (seasons, episodes, per-episode sources), which is a feature, not a scoping change. This
  spec deliberately covers only `/movies/<id>`.
- **Sharing a film between users.** Nothing here lets user A grant user B access to a film. The only
  way a film enters a library stays `addMedia`, and this feature makes the detail page agree with
  that rule rather than adding a new one.
- **Hiding the film from TMDB search.** `searchMedia` still reports `movieId` (registered by
  *anyone*) alongside `inLibrary` (registered by *me*), and that stays — those two fields answer
  different questions on purpose, and `movieId` is what lets a second user register an
  already-cached film without a duplicate row.
- **An app-wide 404 page.** This feature adds the unavailable page for the film detail route. Other
  routes that call `notFound()` (`/users`, and `/shows/<id>` once it is real) keep whatever they do
  today; unifying them is a separate cleanup.
- **A distinct "this is not yours" message.** Explicitly rejected by REQ-3: telling a caller that a
  film exists but belongs to someone else is exactly the enumeration this feature closes.
- **Granting the service credential global read access to films.** Considered and rejected. The
  worker's need for film data is real, but it is met by `processJob`, which already carries
  `@AllowService()` and returns `Movie`'s fields pre-joined — `movie(id)` has no worker caller and
  never has (NFR-5). Adding `@AllowService()` to it, or a `service`-principal bypass around the
  ownership filter, would open an unscoped read path with zero consumers, which is how an escape
  hatch outlives the reason it was cut. If a future worker code path genuinely needs to read a film
  by internal id, that feature adds the grant with its own justification. This note exists so the
  absence reads as a decision rather than an oversight.
- **Rate limiting id enumeration.** A caller can still probe ids and learn nothing but "available /
  not available for me", which is the intended answer. Throttling that probe is an operational
  concern, not this feature's.

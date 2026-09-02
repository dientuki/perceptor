---
title: The GraphQL Contract
spec_version: 1.9.0
author: Juan Farias
created_at: 2026-08-09
last_updated: 2026-09-01
status: Approved
target_service: api, web, worker
---

# SPEC: The GraphQL Contract (`graphql-contract.md`)

## Context & Goal

GraphQL is the only way `web` and `worker` reach `api` (Constitution, Article II). It is also the
only thing the three services share: they have separate `package.json` files, separate toolchains,
separate containers, and no common package.

That makes the schema the single seam of the whole system — and it is a seam **without a
compiler across it**. `api` generates its schema from decorators; `web` and `worker` retype the
parts they use, by hand, in TypeScript. Nothing checks that the two halves agree.

This document is what an implementer or agent reads before touching that seam. It exists because
the failure mode here is the worst kind: a mismatch compiles cleanly on both sides and fails at
runtime, on a code path that may not run until a torrent finishes an hour later.

## How the schema is produced

`services/api/src/app.module.ts` configures Apollo code-first:

```ts
autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
```

The decorators in each module's `entities/*.entity.ts` and `dto/*.input.ts` are the source of
truth. `services/api/src/schema.gql` is regenerated on every boot and opens with a
generated-file banner. **It is never hand-edited** (Constitution, Article IV) — the next boot
silently reverts the edit, which is exactly the kind of change that looks applied and is not.

To read the current contract:

```bash
bin/cli api cat src/schema.gql
```

## How it is consumed

### Exposed consumers

| Consumer | Client | Errors | Types |
| :-- | :-- | :-- | :-- |
| `web` | `services/web/src/lib/graphql-client.ts` — `fetchGraphQL<T>` | Returned as `{ data, errors }`; **each caller checks** | Hand-written in `src/types/*.ts` and inline |
| `worker` | `services/worker/src/api/graphql-client.ts` — `fetchGraphQL<T>` | **Throws** on `json.errors` | Hand-written in `src/queue/types.ts` and inline |

The two clients differ deliberately, and the reason is written at the top of the worker's:
`web` renders errors to a user, so it must be able to see them; a worker that swallowed an error
would mark the job completed without having written anything.

**Both clients authenticate every call** (`002-auth-login`): `api` requires a credential on every
operation except `login` (`JwtAuthGuard`, registered as `APP_GUARD` in `app.module.ts`). `web`'s
`fetchGraphQL` reads the session cookie via `cookies()` and forwards it as `Authorization: Bearer
<token>`; `worker`'s `fetchGraphQL` forwards `Authorization: Bearer $SERVICE_TOKEN`, a machine
credential distinct from a user session (no `id`, no expiry — see `services/api/CLAUDE.md`'s
`auth/` bullet). A third caller, `services/torrent/commands/on-torrent-completed.sh`, sends the
same `SERVICE_TOKEN` outside either client, straight from `curl`.

**The cookie name is a cross-runtime boundary fact, not just a `web`-internal detail.** `api` reads
it via `AUTH_COOKIE_NAME` in `services/api/src/auth/auth.constants.ts`; `web` writes it via
`CONFIG.authCookie` in `services/web/src/lib/config.ts`. Both currently hold the literal
`"auth_token"`. There is no shared package to enforce this — same seam as the schema itself — so a
change to one without the other silently breaks every browser session while leaving the bearer
carrier (what `web`'s own server actions use) completely unaffected, which makes the failure easy
to miss in testing that only exercises `web`→`api` calls.

### The `web` server-action pattern

Every file in `services/web/src/actions/` follows the same shape. Reproduce it rather than
inventing a variant:

```ts
'use server'

import { fetchGraphQL } from '@/lib/graphql-client';

const MEDIA_SERVER_CLIENTS_QUERY = `
  query MediaServerClients { mediaServerClients { id label } }
`;

export async function getMediaServerOptions(): Promise<MediaServerOption[]> {
  const { data, errors } = await fetchGraphQL<{ mediaServerClients: MediaServerOption[] }>(
    MEDIA_SERVER_CLIENTS_QUERY,
  );

  if (errors && errors.length > 0) {
    throw new Error(errors[0]?.message || 'Error al obtener los media servers soportados');
  }

  return data?.mediaServerClients ?? [];
}
```

- `'use server'` on line 1.
- Document as a module-level `const NAME_QUERY` / `NAME_MUTATION`, SCREAMING_SNAKE.
- The response shape is passed as the `fetchGraphQL<T>` type parameter — **this is the hand-copied
  part**, see the next section.
- Errors: read `errors[0].message`, fall back to a Spanish user-facing string.

Two return conventions coexist, both valid: read functions `throw`; form actions used with
`useActionState` take `(prevState, formData)` and return `{ error?: string } | { success: true }`
(see `updateSettingsAction` in `services/web/src/actions/settings.ts`).

## The gap: no codegen

There is no `@graphql-codegen`, no `graphql` package in `web`, no schema check in CI (there is no
CI). The type parameter on every `fetchGraphQL<T>` call is a human's copy of what `api` returns.

**Consequences an implementer must plan around:**

| Change on `api` | What TypeScript says in `web`/`worker` | What actually happens |
| :-- | :-- | :-- |
| Field renamed | Nothing — the hand-written type still has the old name | Field arrives `undefined` at runtime |
| Field made nullable | Nothing | `null` flows into code that assumed a value |
| Non-null argument added | Nothing | Every call fails with a GraphQL validation error |
| Enum value added | Nothing | Falls through a `switch` with no default |
| New error condition | Nothing | Consumer treats a failure as success |

The last row is the one that matters most, and it is why `spec.md`'s `## GraphQL Contract Delta`
requires an error table and not just SDL. A consumer that implements only the happy path compiles,
lints, and is wrong.

### What to do when the schema changes

1. Write the delta in the feature's `spec.md` **before** implementing (Constitution, Article VIII).
2. On the `api` side, change the decorator and let `schema.gql` regenerate. Confirm the diff
   matches the delta.
3. For each consumer in the feature's `services:` list, grep for the affected operation and update
   the hand-written type **and** the error handling:
   ```bash
   grep -rn "<mutationOrQueryName>" services/web/src services/worker/src
   ```
4. If a consumer is *not* in `services:` but the grep finds a hit there, the spec is wrong. Stop
   and report — do not fix it quietly in a slice that was never scoped for it.

### Additive changes are safe, and are the default

Adding a nullable field or a new mutation breaks no existing consumer. Renaming, removing, or
tightening nullability does. Prefer additive changes; when a breaking change is genuinely right,
it is a requirement in `spec.md`, not a detail in a plan.

## Contracts & Interfaces

### `users` operations are admin-only

Since `003-auth-user-management`, `User` carries `isAdmin: Boolean!` and the five `users`
operations (`users`, `user`, `createUser`, `updateUser`, `removeUser`) require the caller to be an
admin, not just authenticated. `AdminGuard` (`services/api/src/auth/guards/admin.guard.ts`) reads
`isAdmin` fresh from the database on every call — it is deliberately never embedded in the JWT, so
a demoted admin's still-valid session stops working immediately instead of at token expiry. A
non-admin caller gets `No tenés permisos para administrar usuarios` from every one of the five.

No schema shape changed beyond the additive `isAdmin` field — `removeUser` still takes only `id`;
the caller is read server-side via `@CurrentUser()`, not passed as an argument. `createUser` has no
`isAdmin` argument — the `/users` screen can only create ordinary users.

### Users can be disabled (`004-user-disable`)

`User` also carries `isEnabled: Boolean!`, and `UpdateUserInput` gained `isEnabled: Boolean` —
additive, no shape change to `updateUser` itself. `updateUser` now reads its caller via
`@CurrentUser()`, the same way `removeUser` already did — no new GraphQL argument for "who is
asking". `isEnabled` is deliberately not on `CreateUserInput`: a user is always created enabled.

A disabled user's `login` is refused, and disabling revokes every session that user currently
holds (not just their next login attempt) — see `services/api/CLAUDE.md`'s `auth/` bullet for the
per-user Redis SET this uses. `updateUser` refuses two attempts, mirroring `remove()`'s existing
self/last-admin safeguards:

| Condition | Exception | Message |
| :-- | :-- | :-- |
| Correct credentials, account disabled (`login`) | `UnauthorizedException` | `Tu cuenta está deshabilitada` |
| Admin disabling their own account | `BadRequestException` | `No podés deshabilitar tu propio usuario` |
| Admin disabling the last enabled administrator | `BadRequestException` | `No podés deshabilitar al único administrador` |

`Tu cuenta está deshabilitada` is a sixth user-facing string on the login/session boundary that
`002-auth-login`'s `spec.md` froze at five — see that file's dated pointer for why `002` itself was
not reopened.

### `movies` and `addMovie` are scoped to the caller, with unchanged signatures (`005-movie-search`)

A film is a single shared `Movie` row (`tmdbId @unique`, never duplicated) joined to `User` through
`UserMovie` — one movie, many owners, one shared download/encode status. `movies: [Movie!]!` and
`addMovie(tmdbId: Int!): Movie!` kept byte-identical shapes across this change: `movies` now
returns only the films the caller has registered (previously every film in the system), and
`addMovie` now also links the caller to the film in addition to creating/returning it. **Neither
change is visible to a typechecker** — this is exactly the class of risk this document's "gap"
section warns about, and it is why this section exists rather than leaving the semantic shift
implicit in the unchanged SDL. `movie(id)` was originally left unscoped — any authenticated user
could read a single film by internal id, because the catalog itself is shared. **`008-movie-detail`
closed that**; see that section below for the current behaviour.

`MediaSearchResult` (returned by `searchMovies`) gained two additive fields: `movieId: Int`
(`Movie.id` if *any* user has registered this film, `null` otherwise) and `inLibrary: Boolean!`
(true only for the calling user). They answer different questions on purpose — collapsing them into
one nullable id would make "registered, but not by me" unrepresentable. **Never treat `movieId !==
null` as an ownership test**; only `inLibrary` means "mine". `searchMovies` computes both **after**
its best-effort write to the shared, 24-hour Redis cache (`tmdb:movie:<tmdbId>`) — that cache key is
read by every user who searches the same film, so enriching before the cache write would leak one
user's ownership into what every other user sees for a day, with no error anywhere. Any future
change to `searchMovies` must preserve that ordering.

`attachTorrentSource` (backing `addTorrentToMovie`/`addMagnetToMovie`) now also requires the
caller's link, refusing an unowned film with the same `NotFoundException('La película <id> no
existe')` it already used for a missing one — deliberately one string, not a second "no es tuya"
message (see `005-movie-search/spec.md` § Errors for why).

### `searchMovies`/`addMovie` are gone; `searchMedia`/`addMedia` replace them, parameterized by type (`006-media-search`)

`searchMovies(query: String!)` and `addMovie(tmdbId: Int!)` **no longer exist** — the catalog is
searched and registered through `searchMedia(query: String!, type: String!):
[MediaSearchResult!]!` and `addMedia(tmdbId: Int!, type: String!): MediaRef!`, both defined in a
new `src/media/` module that dispatches on `type` to the service that owns that media type
(`MoviesService` for `"movie"`, `ShowsService` for `"show"`). `type` is a plain `String!`, not a
GraphQL enum — the schema has none, and `MEDIA_TYPE` already holds `"movie"`/`"show"` as literals
on both `api` and `web`. An unsupported `type` is refused with `BadRequestException('Tipo de medio
no soportado: <type>')`, thrown by the dispatch itself before any per-type service runs.

`addMedia` returns `MediaRef { id: Int!, type: String! }`, not the created row — `web` only ever
read `.id` from `addMovie`'s response, and a polymorphic return would need a GraphQL union with
hand-written inline fragments and no codegen to check them.

`MediaSearchResult.movieId` is renamed to `mediaId: Int` — the registered row's id in whatever
table `type` names, still `null` when nothing is registered, still never an ownership test (only
`inLibrary` means "mine"). **This is the one rename in the whole feature, and it is scoped
narrowly on purpose**: `movieId` also appears, unrenamed and meaning something else, as an
argument on `addTorrentToMovie`/`addMagnetToMovie`/`createUploadTicket`, as the tus upload
metadata key, and on `MediaSource.movieId` — the last one read by `worker`
(`services/worker/src/jobs/source-ready.job.ts`), a consumer this feature does not touch.
Renaming any of those by matching the string rather than the meaning breaks the download pipeline
with no error anywhere.

**The cache-before-enrich ordering is now an obligation on every per-type service, not a fact
about `searchMovies`.** `search()` must hand its catalog-only results to the shared Redis cache
(`tmdb:<type>:<tmdbId>`, 24h TTL) before computing `mediaId`/`inLibrary` for the caller — that
cache key is read by every user who searches the same item, so enriching first leaks one caller's
ownership into what everyone else sees for a day. Because each per-type service implements this
independently (`MoviesService`, `ShowsService`, and whatever comes next), it can be broken
independently — `services/api/src/shows/shows.service.spec.ts` asserts it exactly the way
`movies.service.spec.ts` already did, and any new per-type service owes the same test.

`show` also registers a series' seasons and episodes, fetched in the background after `addMedia`
returns (never awaited) and marked complete only in `Show.seasonsSyncedAt` — not part of the
GraphQL contract, since no field surfaces it; see `006-media-search/spec.md` for the full shape.

### `shows` is a sibling of `movies`, not a parameterized listing (`007-library-listing`)

A user's series are read back through `shows: [Show!]!` — a second query alongside `movies`, with
its own `Show` type, not `library(type:)` and not a `MediaTypeService.list()`. This is the opposite
choice from `searchMedia`/`addMedia` above, and it is deliberate: search and registration genuinely
*are* the same operation for both media types, while the two listings share fields but not shape
(`Movie` carries `filePath` and `mediaSource`, `Show` carries seasons). Unifying the return type
would either flatten both to a lowest common denominator or force a union every consumer has to
narrow by hand — with no codegen, that narrowing is unchecked. `MediaTypeService` stays at two
methods; the dispatch pattern is scoped to search and registration.

```graphql
type Show {
  id: ID!
  tmdbId: Int!
  title: String!
  overview: String
  posterUrl: String
  releaseDate: DateTime
  originalLanguage: String!
  isLiveAction: Boolean!
  status: String!
  seasonsSyncedAt: DateTime
  createdAt: DateTime!
  updatedAt: DateTime!
}
```

Four things a consumer needs that the SDL does not say:

- **`status` crosses as `String!` although Prisma has it as an enum.** `007-library-listing`
  migrated `shows.status` from a nullable `String` to `MediaStatus @default(MISSING)`, matching
  `Movie` — but like `Movie.status` it is **not** `registerEnumType`'d, so `web` receives one of
  `"MISSING" | "DOWNLOADING" | "ENCODING" | "COMPLETED" | "ERROR"` as a plain string. Introducing a
  GraphQL enum for one of the two types would make the listings structurally different in the one
  place they are kept identical; if the enum should cross, it crosses for both, as its own change.
- **Scoping is by ownership, ordering is by catalog row.** `shows` returns only the caller's series,
  through the `UserShow` join, ordered `shows.createdAt desc` — the *shared catalog row's* creation
  date, not the ownership link's, exactly as `movies` orders on `movie.createdAt`. A user who
  registers a title someone else added months ago therefore sees it at the bottom of their library.
  Both listings behave this way; changing it is a change to both.
- **A service credential is refused, not handed an empty list.** `shows` carries no
  `@AllowService()`, so the global `JwtAuthGuard` rejects a `SERVICE_TOKEN` principal before the
  resolver runs: `errors[0].message` is `No autenticado` and `data` is `null`. The `worker` has no
  business reading a user's library and must not call this query. (The string is `No autenticado`,
  not `Unauthorized` — the latter appears only under `extensions.originalError.error`, and every
  `web` action reads `errors[0].message`.)
- **`Show` carries no `type` field.** A consumer cannot tell a series from a film by payload alone.
  This is not an oversight: `web`'s shared `MediaCard` resolves its href from a `mediaType` prop
  `MediaList` already threads down (not from a payload field) — see `009-show-detail` below for how
  the series card was pointed at `/shows/<id>` without adding one.

An empty library is `{"data":{"shows":[]}}`, never `null` and never an error. `movies`, `Movie`,
`searchMedia` and `addMedia` are unchanged by this feature.

### `movie(id)` is scoped like `movies`; `createUploadTicket` requires the same link (`008-movie-detail`)

`movie(id: Int!): Movie` kept its exact SDL — no new argument, no changed nullability — but stopped
being the one unscoped read in the `movies` module. It now resolves through the same `UserMovie`
join `movies`/`attachTorrentSource` already use: `null` for an id that does not exist, and **the
same `null`** for a film that exists but the caller has no link to. A caller cannot tell those two
apart from the response — same value, no `errors`, no `extensions` code — which is the point:
`005-movie-search`'s `attachTorrentSource` already set the precedent of one shared "does not exist"
answer rather than a second "not yours" string, and this closes the one query that had not followed
it. **`movie(id)`'s `null` therefore means "not available to you", not "does not exist in the
database"** — do not read a non-null result as proof no other user shares the row, and do not read
`null` as proof the row is absent.

`createUploadTicket(movieId: Int!): UploadTicket!` gained the same check: it now calls the same
`findOneFromDb(movieId, userId)` before minting, and refuses with the identical
`NotFoundException('La película <id> no existe')` `attachTorrentSource` already throws for an
unowned film. No new message.

Neither operation gained `@AllowService()`. A `SERVICE_TOKEN` principal is rejected by the global
guard on both with `No autenticado`, exactly as it always was — this feature did not add or remove
that rejection. That rejection is also not a gap for the machine credential: the `worker` never
called `movie(id)` before this feature and still does not. Its actual need for film metadata —
`tmdbId`, `title`, `year`, `originalLanguage`, `isLiveAction`, `outputRoot` — is served by
`processJob(id)`, which does carry `@AllowService()` and returns those fields pre-joined from
`Movie` (`services/api/src/process-jobs/process-jobs.service.ts`). If a future worker code path
genuinely needs to read a film by internal id, that grant is added then, with its own
justification — not as a side effect of this feature.

### `show(id)` returns seasons and episodes, scoped like `movie(id)` (`009-show-detail`)

`Show` gains `seasons: [Season!]!`, resolved through a new query, `show(id: Int!): Show`:

```graphql
type Episode {
  id: ID!
  episodeNumber: Int!
  title: String
  overview: String
  releaseDate: DateTime
  status: String!
}

type Season {
  id: ID!
  seasonNumber: Int!
  releaseDate: DateTime
  episodes: [Episode!]!
}

type Query {
  show(id: Int!): Show
}
```

- **`Episode.status` crosses as plain `String!`, same reasoning as `Movie.status`/`Show.status`.**
  Not `registerEnumType`'d — introducing an enum for the third structurally-parallel status field
  and not the other two would make them diverge for no reason.
- **No image field on `Season` or `Episode`.** The schema has none — only `Show.posterUrl` exists;
  this query never surfaces a season or episode still.
- **`null` means "not available to you", identical to `movie(id)`'s rule (`008-movie-detail`).**
  `show(id)` resolves through the same `UserShow` join `shows` already uses:
  `findFirst({ where: { id, users: { some: { userId } } }, include: { seasons: { orderBy: {
  seasonNumber: 'asc' }, include: { episodes: { orderBy: { episodeNumber: 'asc' } } } } } })`. A
  nonexistent id and an id the caller has no `UserShow` link to return the exact same `null`, no
  `errors`, no `extensions` code — do not read either outcome as proof of the other's absence.
- **`seasons`/`episodes` arrive pre-ordered.** `seasonNumber` and `episodeNumber` ascending, both
  server-side in the Prisma `include` above, not sorted by any consumer. A consumer that re-sorts
  client-side would mask a future ordering regression instead of surfacing it.
- **No `@AllowService()`.** A `SERVICE_TOKEN` principal is rejected by the global `JwtAuthGuard`
  before the resolver runs, `No autenticado`, matching `shows` and `movie(id)`. The worker has no
  call site for `show(id)` today; add the grant only when one exists, with its own justification.

The series-card link (`MediaCard`) is fixed entirely in `web`, with no schema change: `MediaList`
already receives a `mediaType` prop for its own empty-state text and now forwards it into
`MediaCard`, which resolves its `href` off that prop instead of a nonexistent `item.type` field.
`web` retypes this query by hand in `src/actions/shows.ts`'s `getShowById`, same as every other
query — no codegen.

### Language preferences drive the encode payload, in two different ISO vocabularies (`011-av1-transcode`, revised by `029-settings-screen-tabs`, `030-language-regional-variants`, `039-per-title-language-split`)

```graphql
type Language {
  id: ID!
  tag: String!
  iso2: String!
  iso3: String!
  name: String!
}

type Query {
  languages: [Language!]!
}

type Movie {
  audioLanguages: [Language!]!
  subtitleLanguages: [Language!]!
  audioMandatory: Boolean!
}

type Show {
  audioLanguages: [Language!]!
  subtitleLanguages: [Language!]!
  audioMandatory: Boolean!
}

type UserPreferences {
  audioMandatory: Boolean!
}

type Mutation {
  setMoviePreferredTrackLanguages(movieId: Int!, kind: LanguageTrackKind!, tags: [String!]!): [Language!]!
  setShowPreferredTrackLanguages(showId: Int!, kind: LanguageTrackKind!, tags: [String!]!): [Language!]!
  setMovieAudioMandatory(movieId: Int!, mandatory: Boolean!): Boolean!
  setShowAudioMandatory(showId: Int!, mandatory: Boolean!): Boolean!
  setAudioMandatory(mandatory: Boolean!): UserPreferences!
}

type EncodeJobDetails {
  # …every existing field, unchanged…
  allowedAudioLanguagesIso3: [String!]!
  allowedAudioLanguageTags: [String!]!
  allowedSubtitleLanguagesIso3: [String!]!
  allowedSubtitleLanguageTags: [String!]!
}
```

As of `039-per-title-language-split`, `Movie.preferredLanguages`/`Show.preferredLanguages` and
`setMoviePreferredLanguages`/`setShowPreferredLanguages` are **gone, not deprecated** —
`audioLanguages`/`subtitleLanguages` and `setMoviePreferredTrackLanguages`/
`setShowPreferredTrackLanguages` (taking `kind: LanguageTrackKind!`) replace them one for one, backed
by the same `UserMovieLanguage`/`UserShowLanguage` join tables, now keyed additionally by `kind`
(`@@id([userId, movieId, languageId, kind])`). `EncodeJobDetails.allowedLanguagesIso3`/
`allowedLanguageTags` are gone the same way, replaced by an audio pair and a subtitle pair built by
one walk over the same merge described below — see that section for the split.

`Language.tag` is the identifier as of `030-language-regional-variants`: a unique BCP-47 tag (`en`,
`ja`, `es-419`, `es-ES`). `iso2` stays on the type and in the table but **is no longer unique** —
three rows now carry `es`, since `es-419` (Latin American Spanish) and `es-ES` (European Spanish) are
ordinary rows that share it. `iso2` remains the join to TMDB's `originalLanguage` and the grouping key
`web` renders its picker's headings from — two or more rows sharing an `iso2` form a group, one row
stands alone, and `web` reconstructs this purely from the rows `languages` returns, never from a
hard-coded list of which languages carry regional variants.

`languages` reads the 22-row seeded `languages` table (`services/api/prisma/seeds/languages.ts`) but
returns only the **pickable** rows: a base-language row is omitted whenever variant rows of it exist.
Today that hides exactly `es` — a title's TMDB `originalLanguage` still resolves through it
server-side, but a user is never offered it directly as a choice. `name` is an English display string
derived server-side from `tag` (`src/languages/language-names.ts`), not stored, and is a fallback
only — `web` renders the localized name through `Intl.DisplayNames`, never through `name` or a message
catalog entry. `languages` is the only source `web` populates its language picker from — never a
hard-coded list.

Two join tables back the per-title preferences: `UserMovieLanguage` and `UserShowLanguage`, each a
composite-key row pointing at `Language`, cascading through the *ownership* row (`UserMovie`/
`UserShow`), not through `Movie`/`Show` directly — a preference has no meaning once the title leaves
the user's library. Both mutations **replace** the whole list; there is no add/remove pair, and `[]`
clears it.

`Movie.audioLanguages`/`Movie.subtitleLanguages` (and the `Show` twins) resolve to the **calling
user's own** list for that title and kind, never the merge across owners — the merge is an
encode-time-only concept. Both mutations are scoped exactly like `movie(id)`/`show(id)` already are:
an unowned title is refused with the existing `La película <id> no existe` / `Recurso no disponible
para este usuario`, reused verbatim, never a new string. Neither mutation carries `@AllowService()`.
`Movie.audioMandatory`/`Show.audioMandatory` are read the same way, off the `user_movies`/
`user_shows` ownership row rather than a join table — see "The *Audio mandatory* flag is inert by
design" below.

Both mutations' list argument is `tags` as of `030-language-regional-variants` — renamed from `iso2`,
since a stored preference is now identified by BCP-47 tag rather than ISO-639-1 code. This is the
one breaking rename in that feature's delta, and it breaks silently: there is no codegen between
`api` and `web`, so a stale `$iso2` variable in `web`'s hand-retyped documents
(`services/web/src/actions/languages.ts`) fails at runtime with no compile error in either service.
The validator behind both mutations (`validateAndResolveLanguageIds` in
`services/api/src/languages/languages.service.ts`) checks the submitted tag against the **whole**
`languages` table, not the filtered/pickable catalog `languages` returns — a directly-submitted `es`
is accepted, because it is a real row meaning "Spanish, no variant preference," even though it is
never offered as a choice. Submitting a tag with no row at all (a malformed or unseeded tag such as
`es-AR`) is rejected with `error.language.unavailable`; a tag repeated in the same call is rejected
with `error.language.duplicate`. Both are **write-path** errors only — they answer "is this a tag we
have a row for," never "does this release contain the track" — nothing in either mutation inspects a
file.

**The per-user global level (`User.preferredLanguages`, `Mutation.setPreferredLanguages`,
`UserLanguage`) is gone as of `029-settings-screen-tabs`.** It is replaced by the installation-wide
`default_languages` setting (see "Settings become administrator-only" below) — one value administrators set from the
Descarga tab, not a row per user. `collectAllowedLanguages` in
`services/api/src/process-jobs/process-jobs.service.ts` now unions the title's original language ∪
`default_languages` (resolved iso2 → iso3) ∪ each owner's per-title preference, original first,
deduplicated — the per-title level above is completely unchanged; only the global level moved from a
per-user table to a single setting. No backfill: the old `user_languages` rows were discarded with
the table, since the project was still in development when this shipped.

`EncodeJobDetails.allowedAudioLanguagesIso3`/`allowedSubtitleLanguagesIso3` is where the two
vocabularies meet. Every stored preference is a BCP-47 tag (`es`, `es-419`, `es-ES`, `en`, `ja`) —
`es-419`/`es-ES` share the ISO-639-1 code `es` with the base row, which is the same alphabet
`Movie.originalLanguage`/`Show.originalLanguage` already use, since that's what TMDB returns. But
`ffprobe` reports `tags.language` in ISO-639-2/B (`spa`, `eng`, `jpn`), and that's what the worker
actually compares against. As of `039-per-title-language-split`, this used to be **one** merged list
feeding both the audio and subtitle rule functions; it is now **two**, each built the same way —
`{original} ∪ ⋃(`default_languages`) ∪ ⋃(per-title preference of every owner, of that kind only)`,
deduplicated, original first — resolved server-side into `iso3` before either ever leaves `api`,
because `Language` (with both codes) only exists on this side of the boundary. `originalLanguageIso3`
stays on the payload alongside the audio pair only, not redundant with either list's first element:
the worker needs to know *which* of the allowed audio languages is the mandatory one, and inferring
that from list position is a rule that breaks the moment someone reorders the list. Both fields are
hand-retyped in **two** places on the worker side with no compiler across either seam —
`src/jobs/encode.job.ts`'s `EncodeJobDetails` and `src/encode/types.ts`'s `EncodeInput` — miss one and
that field silently arrives `undefined`, which the rule function reads as "no preference of that
kind," no error anywhere. **`default_languages` itself is not split** — the same installation-wide
setting seeds both the audio and the subtitle pair, unsplit, exactly as it did before this feature;
only the per-title, per-owner preference is kind-specific.

`EncodeJobDetails.allowedAudioLanguageTags`/`allowedSubtitleLanguageTags` are the same two merges,
expressed in tags instead of resolved to ISO-639-2/B — added by `030-language-regional-variants` (as
one field) and consumed by the worker since `031-worker-language-variants`; split into a pair by
`039-per-title-language-split` alongside the iso3 pair, for the identical reason. They exist because
the collapse to `iso3` is lossy by design: `es-419` and `es-ES` both resolve to `spa`, so the iso3
lists alone cannot tell the worker which Spanish variant, if any, was actually asked for — the tag
lists preserve that. Neither tag list is a superset that makes its iso3 counterpart redundant — the
worker only ever matches `ffprobe`'s ISO-639-2/B output, so neither iso3 list can be dropped or
narrowed without breaking every encode. All four fields are produced by **one walk** over four `Set`s
in `collectAllowedLanguages` (`services/api/src/process-jobs/process-jobs.service.ts`) — the original
language and every `default_languages` entry seed all four unconditionally, and each owner's per-title
preference seeds only the pair matching its `kind` — so the audio and subtitle lists cannot drift
apart from being built by two separate passes over the same data. `EncodeJobDetails` resolves a
title's `originalLanguage` (ISO-639-1) to `{ tag, iso3 }` via `resolveOriginalLanguage`, a single
lookup **keyed by `tag`** rather than `iso2` — a base row's tag is its ISO-639-1 code by construction,
so this is exact, unlike a lookup on the now-non-unique `iso2`, which could return a variant row
instead of the base one and open every Spanish-original title's tag lists with a variant nobody chose.
`031-worker-language-variants` is the follow-up `030` left this to: the worker reads the tags and uses
them to choose *which* Spanish track to keep, routing the audio pair to `getAudioParams` and the
subtitle pair to `getSubtitleParams` in `src/ffmpeg/buildCommand.ts` — two argument pairs into two
functions, never crossed. It resolves `es-419`/`es-ES` → `spa` from a worker-local table
(`services/worker/src/ffmpeg/variants.ts`), in the same spirit as `iso639.ts`, because the payload
carries flat lists and not the tag→`iso3` association — only `api` holds the `languages` table that
links them. Moving `{ tag, iso3 }` pairs onto the wire would remove that duplication and is the right
move the day a third language grows variants; it stayed out of scope here too.

**The *Audio mandatory* flag is inert by design (`039-per-title-language-split`, `0.2.0`).**
`UserPreferences.audioMandatory`, `Movie.audioMandatory` and `Show.audioMandatory` are three
independent booleans (`User.audioMandatory`, `UserMovie.audioMandatory`, `UserShow.audioMandatory` —
one column each, default `false`, not per-language and not tri-state), written by
`setAudioMandatory`/`setMovieAudioMandatory`/`setShowAudioMandatory` respectively. **Nothing reads
any of the three** — `EncodeJobDetails` gains no field for it, `collectAllowedLanguages` never touches
it, and `grep -rn "audioMandatory" services/worker/` returns nothing. This is the requirement, not an
oversight left for later: the flag exists in the UI and the database only, as a placeholder for a
future worker rule that does not exist yet. A future change that starts consuming it must add a new
`EncodeJobDetails` field explicitly — reading `UserMovie.audioMandatory` directly from `worker` would
violate Article III (the database belongs to `api`) even once a consumer exists.

A missing original-language audio track is a hard failure (`encodeFailed`, no new GraphQL surface) —
replacing the previous behaviour of silently copying every audio track untranscoded. A missing *extra*
language is not an error; the encode continues with what's present.

### The encode payload carries the downloads root (`012-post-download-processing`)

```graphql
type EncodeJobDetails {
  # …every existing field, unchanged…
  downloadsRoot: String!
}
```

Resolved in `services/api/src/process-jobs/process-jobs.service.ts` with
`mediaRoots.resolveFromRoot('downloads', '.')` — the **root itself**, not the `path_downloads`
setting. Torrents save under `<root>/<path_downloads>/<hash>` while tus uploads stage under
`<root>/imports/<uploadId>`, and the worker's containment check (`REQ-12`) has to cover both, so it
needs the root, not the narrower segment either kind happens to live under.

It is non-null and, like `outputRoot`, an absolute **container** path that reaches `worker` and
stops there — it never crosses into `web`. If the downloads root is not mounted,
`resolveFromRoot` throws and the whole `processJob(id)` query fails with the existing
`La raíz "<label>" no está montada en este container — revisá HOST_DOWNLOADS_DIR en el .env y
volvé a levantar el stack.` — the worker cannot usefully encode into a stack whose volumes are
wrong, so failing loudly here is the intended outcome, not something a consumer should catch.

`downloadRemove(mediaSourceId: Int!): String!` is unchanged, including its
`omitido: mediaSource <id> no es un torrent` response for a source with no infohash. What changed
is on the `worker` side, in `src/jobs/cleanup-source.ts`: that string no longer means "nothing to
delete" — the worker calls `downloadRemove` only for a torrent (branching on `sourceKind`), but
deletes files for every source kind. Reading `omitido: …` as "cleanup is done" would silently
reinstate the bug this feature fixes, where an uploaded file's `imports/<uploadId>` directory was
never removed.

Consumer obligations: `worker` adds `downloadsRoot` to the `processJob(id)` query and to the local
`EncodeJobDetails` type in `src/jobs/encode.job.ts` — both, in the same edit, per the usual
hand-retyped-contract risk this document warns about. `web` has no obligation; it never queries
`processJob`.

### Season packs replace `matchedFilePath` with a fan-out (`013-season-pack-processing`)

```graphql
input SourceFileInput {
  # …existing…
  isVideo: Boolean!
}
input ScannedMatchInput {
  filePath: String!
  seasonNumber: Int
  episodeNumber: Int
}
type MediaSource {
  # …existing…
  seasonId: Int
  hasUnmatchedFiles: Boolean!
}
type EncodeCompletedResult {
  message: String!
  removeTorrent: Boolean!
  deleteInputFile: Boolean!
  deleteDownloadPath: Boolean!
}
type Mutation {
  sourceScanned(mediaSourceId: Int!, files: [SourceFileInput!]!, matches: [ScannedMatchInput!]!): MediaSource!
  encodeCompleted(processJobId: Int!, outputFilePath: String!, ffmpegCommand: String!): EncodeCompletedResult!
  downloadRemove(mediaSourceId: Int!, deleteFiles: Boolean = true): String!
  addMagnetToSeason(seasonId: Int!, magnet: String!, force: Boolean = false): Season!
}
```

**`matchedFilePath: String` → `matches: [ScannedMatchInput!]!` was safe to replace outright**, not
additively, because it had exactly one consumer (`worker`'s `source-ready.job.ts`) and both sides
of the seam changed in the same feature's commits. A source used to report a single winning file;
now it reports every file it resolved to an episode (or, for a film/single episode, still exactly
one). `matches: []` — or every match failing to resolve — reaches the same `ERROR` branch the old
empty-scan case did.

**`SourceFileInput.isVideo`** exists so `api` never has to guess a file's kind from its extension. The
`VIDEO_EXTENSIONS` list lives once, in `services/worker/src/scan/scan-folder.ts`; `api` trusts the
flag the worker reports per file. Duplicating that list into `api` was considered and rejected
during planning — the two lists would drift silently, and the failure mode is invisible: a sidecar
misclassified as video (or a video misclassified as a sidecar) changes `hasUnmatchedFiles`, which
changes whether `deleteDownloadPath` ever fires, with no error anywhere.

**`MediaSource.hasUnmatchedFiles`** is recomputed on every `sourceScanned` call, never accumulated —
true when at least one *video* file of the download resolved to no episode. It does not count
non-video files: a `.nfo`/`.srt` sidecar sitting next to every matched episode does not suppress
cleanup.

**`EncodeCompletedResult`** replaces `encodeCompleted`'s bare `String!` return. The three booleans are
the cleanup verdict for the `ProcessJob` that just finished, computed server-side because only
`api` can see the sibling jobs of a season pack's shared `MediaSource`:

| Flag | True when |
| :-- | :-- |
| `removeTorrent` | No sibling `ProcessJob` of this source is left non-terminal — this is the **last** job to finish, whether it succeeded or not. |
| `deleteInputFile` | The source has **more than one** `ProcessJob` (a season-pack episode; false for a film or a single-episode source). |
| `deleteDownloadPath` | **Every** job of the source ended `COMPLETED` **and** `hasUnmatchedFiles` is `false`. |

A film or single-episode source (one job) always resolves to `(true, false, true)` — today's
behaviour, preserved exactly. A season pack's episodes each get `(false, true, false)` until the
last one finishes, which flips `removeTorrent` (and `deleteDownloadPath`, if nothing went wrong) —
this is intentional, not a race to fix: qBittorrent holds the torrent, showing it as "missing files"
for the duration of the pack, but the download itself completed before any encode started, so no
file the torrent is seeding disappears out from under it mid-download. See `spec.md`'s Risks table.

**`downloadRemove`'s new `deleteFiles` argument** defaults to `true` — unchanged default, unchanged
behaviour for any caller that omits it. The season-pack cleanup pipeline is the one caller that
always passes `false`: the worker's `cleanup-source.ts` now owns every filesystem deletion behind
its own `isInsideRoot` checks, so `downloadRemove` there only has to detach the torrent from
qBittorrent, not touch its files.

**`addMagnetToSeason`** is the minimal trigger this feature needed to create a season-scoped
`MediaSource` at all — nothing else does, and without it the fan-out above would have been
untestable without hand-written SQL (Constitution Article III forbids that as more than
inspection). It has no web UI by design (`spec.md` § Out of Scope); a season-request screen is a
later feature. `Season` itself gains no new field — its active-source conflict is resolved
server-side in `SeasonsService.attachTorrentSource`, scoped by `MediaSource.seasonId` the same way
`EpisodesService.attachTorrentSource` is scoped by `episodeId`.

Consumer obligations: `worker` adds `seasonId` to the `mediaSource(id)` query and to
`MediaSourceQueryResult` in `source-ready.job.ts`, sends `matches` instead of `matchedFilePath`
with `isVideo` on every file, and reads all four fields of `encodeCompleted`'s result in
`encode.job.ts` — reading a missing field as `false` (silently skipping a deletion) or as `true`
(silently deleting something live) is exactly the bug this document exists to prevent, so a missing
field there is a hard `console.error` and cleanup is skipped entirely, never guessed. `web` has no
obligation; it queries neither `sourceScanned`, `encodeCompleted`, nor `addMagnetToSeason`.

### UI internationalization (`018-ui-i18n`)

`User` gained `uiLocale: String` (nullable — `null` means "not set, fall through to
`Accept-Language`"), plus `Query.supportedLocales: [String!]!` and
`Mutation.setUiLocale(locale: String!): User!`. `MediaSource` gained `errorKey: String` and
`errorParams: String` alongside its existing `errorMessage`; `ProcessJob` gained the same two
columns but they are **not** exposed on the GraphQL type — only persisted, read back by nothing
outside `api` itself. `Mutation.encodeFailed` changed arity from `(processJobId, errorMessage):
String!` to `(processJobId: Int!, errorKey: String!, errorParams: String, errorMessage: String!):
Boolean!` — a breaking change, which is why `017`'s note above about the queue payload applies
here too: `worker` and `api` must ship this together, or a failed encode reports nothing and the
`ProcessJob` sits in `ENCODING` forever with no error logged anywhere.

```graphql
type User {
  uiLocale: String
}

type MediaSource {
  errorKey: String
  errorParams: String
}

type Query {
  supportedLocales: [String!]!
}

type Mutation {
  setUiLocale(locale: String!): User!
  encodeFailed(
    processJobId: Int!
    errorKey: String!
    errorParams: String
    errorMessage: String!
  ): Boolean!
}
```

**The error envelope.** Every `api` exception that carries a key now arrives on the wire as:

```json
{
  "message": "Movie 42 does not exist",
  "extensions": {
    "code": "NOT_FOUND",
    "i18n": { "key": "error.movie.not_found", "params": { "id": 42 } }
  }
}
```

`message` is always English and always present — REQ-8's fallback, and the thing that keeps a row
legible from `bin/mysql` with no catalog. `extensions.i18n` is present only when the throw site has
been keyed; an un-migrated or genuinely unexpected error (a 500, a database error) passes through
with no `i18n` extension at all — `web`'s `graphql-error.ts` and `worker`'s `graphql-client.ts` both
fall back to `message` in that case, never rendering a bare key. `params`, when present, is a JSON
object **encoded as a `String`**, not a JSON scalar — both sides `JSON.parse`/`JSON.stringify` it by
hand, since this repo has no custom GraphQL scalars.

The REST `/uploads` route (below) carries the same `{ key, params? }` shape under a top-level
`i18n` field in its JSON error body — **not** wrapped in `extensions`, since it isn't a GraphQL
response. `web`'s uploads modal reads that shape directly rather than reusing the GraphQL-shaped
translator.

**The key vocabulary is split across two hand-synced files**, the same pattern
`services/*/src/queue/types.ts` already uses for the BullMQ payload: `api` owns
`services/api/src/i18n/error-keys.ts`, `worker` owns `services/worker/src/i18n/error-keys.ts`.
Three keys are defined by `api` and reused byte-identical by `worker` — `error.processJob.not_found`,
`error.source.no_target`, `error.source.no_download_path` — because `worker` calls `api`'s
`mediaSource`/`processJob` queries and needs to recognize the same failure, not invent a
worker-local variant. Nothing checks the two lists agree; `worker`'s Docker build context
(`./services/worker`) cannot physically see `../api`. `web` reads keys off the wire, translates
them through its own catalog (`messages/{en,es}.json`, under an `errors.*` namespace with the
leading `error.` stripped — `error.auth.unauthenticated` → `errors.auth.unauthenticated`), and
never needs its own copy of the key *list*, since REQ-8's English fallback covers whatever a
catalog gap leaves untranslated.

The full vocabulary, by owner:

| Owner | Keys |
| :-- | :-- |
| `api` — auth | `error.auth.unauthenticated`, `error.auth.session_expired`, `error.auth.invalid_credentials`, `error.auth.account_disabled`, `error.auth.admin_required` |
| `api` — users | `error.user.username_taken`, `error.user.not_found`, `error.user.cannot_disable_self`, `error.user.cannot_disable_last_admin`, `error.user.cannot_delete_self`, `error.user.cannot_delete_last_admin`, `error.user.unsupported_locale` |
| `api` — movies/shows/seasons/episodes | `error.movie.not_found`, `error.movie.not_in_catalog`, `error.movie.download_in_progress`, `error.show.not_available`, `error.show.not_in_catalog`, `error.season.not_found`, `error.season.download_in_progress`, `error.episode.not_found`, `error.episode.download_in_progress`, `error.magnet.already_attached`, `error.media.unsupported_type`, `error.media.catalog_unavailable` (`033-billboard-and-navigation`) |
| `api` — magnet parsing | `error.magnet.not_a_magnet`, `error.magnet.invalid_infohash`, `error.magnet.v2_unsupported` |
| `api` — media-roots | `error.mediaRoot.unknown`, `error.mediaRoot.not_mounted`, `error.mediaRoot.invalid_path`, `error.mediaRoot.absolute_path`, `error.mediaRoot.escapes_root`, `error.mediaRoot.folder_not_found`, `error.mediaRoot.not_a_folder` |
| `api` — settings/languages/clients | `error.setting.not_editable`, `error.setting.expected_boolean`, `error.setting.expected_int`, `error.setting.expected_enum`, `error.setting.missing`, `error.language.duplicate`, `error.language.unavailable`, `error.mediaServer.unknown`, `error.mediaServer.not_configured` (`034-jellyfin-library-reconciliation`), `error.indexer.unavailable`, `error.indexer.no_infohash` |
| `api` — media-sources/process-jobs | `error.source.not_found`, `error.source.no_target`, `error.source.match_not_reported`, `error.source.scan_no_video`, `error.source.no_download_path`, `error.source.replaced`, `error.processJob.not_found` |
| `api` — ffprobe-logs | `error.ffprobeLog.not_found`, `error.ffprobeLog.empty_payload` |
| `api` — uploads (GraphQL) | `error.upload.target_ambiguous` |
| `api` — uploads (REST) | `error.upload.ticket_expired`, `error.upload.ticket_wrong_movie`, `error.upload.ticket_wrong_episode`, `error.upload.metadata_incomplete` |
| `api` — DTO validation | `error.validation.setting_key_required`, `error.validation.setting_value_required`, `error.validation.user_id_required`, `error.validation.login_username_required`, `error.validation.login_password_required`, `error.validation.user_name_required`, `error.validation.username_min_length`, `error.validation.password_min_length` |
| `worker` — encode pipeline | `error.encode.no_video_stream`, `error.encode.no_original_audio`, `error.encode.probe_failed`, `error.encode.ffmpeg_failed`, `error.encode.no_output`, `error.encode.mkvmerge_failed`, `error.encode.episode_numbers_missing`, `error.encode.unknown_driver`, `error.encode.move_failed` (`032-optional-compression`, the passthrough path used when compression is off), `error.encode.unexpected` (catch-all for a non-`KeyedError` throw — `encodeFailed`'s `errorKey` is required, so a failure never reports with no key) |
| `worker` — reused from `api` | `error.processJob.not_found`, `error.source.no_target`, `error.source.no_download_path` |

**Locale resolution never crosses the GraphQL boundary as a header or argument.** `web` resolves
the active locale itself, server-side (the exact order gained a step in `029-settings-screen-tabs`,
below). `api` and `worker` never see which locale is active — they only ever produce English
`message`/`errorMessage` text and a key.
`Query.supportedLocales` is the one place the supported set crosses the boundary, and it exists
so `setUiLocale` and any future locale picker have a single source of truth to validate against
instead of a second hardcoded list in `web`.

### Settings become administrator-only, plus the installation default locale (`029-settings-screen-tabs`)

```graphql
type Query {
  """
  The installation's default UI language, or null when unset. Public: `web`
  resolves the request locale before it knows who is asking.
  """
  defaultUiLocale: String

  """Administrator only."""
  settings: [Setting!]!
}

type Mutation {
  """Administrator only."""
  updateSettings(entries: [SettingInput!]!): [Setting!]!
}
```

`Query.settings` and `Mutation.updateSettings` now require an administrator —
`error.auth.admin_required`, the same refusal `users`/`updateUser` already return. `defaultUiLocale`
is the one exception, `@Public()` like `login`, because `web` calls it while rendering `/login`,
before it knows who is asking; `AdminGuard` is applied per method on `SettingsResolver`, never at
class level, or that single query would break for every logged-out visitor.

The settings catalog gained two keys: `ui_locale` (one of `Query.supportedLocales`, validated as an
ordinary `enum` catalog entry — rejecting an unsupported value with `error.setting.expected_enum`,
the same key `media_server_client` already uses) and `default_languages` (a comma-separated,
possibly-empty, ordered list of ISO-639-1 codes, validated through the same
`error.language.unavailable`/`error.language.duplicate` checks `setMoviePreferredLanguages` uses).
`SettingInput.value`'s validation relaxed from `@IsNotEmpty()` to `@IsString()` so the empty string —
"no default languages" — is representable on the wire; the per-kind emptiness rule now lives in the
settings catalog instead.

**Locale resolution order gained a step.** `web` now resolves the active locale as
`User.uiLocale` (via `me`) → `defaultUiLocale` (if set and supported) → the request's
`Accept-Language` header → `en`. This applies to every request, including an anonymous one — the
installation default is what lets an administrator set the language once for every user who never
picked their own.

### The ffprobe log is written before the encode, not after (`023-ffprobe-log`)

```graphql
type FfprobeLog {
  id: Int!
  file: String!
  ffprobe: String!
  createdAt: DateTime!
}

type Query {
  ffprobeLogs(file: String, take: Int! = 50, skip: Int! = 0): [FfprobeLog!]!
  ffprobeLog(id: Int!): FfprobeLog!
}

type Mutation {
  recordFfprobe(file: String!, ffprobe: String!): FfprobeLog!
  deleteFfprobeLog(id: Int!): Boolean!
}
```

Purely additive — no existing type, field or argument changed, so `web` needed no change at all and
consumes none of this.

`ffprobe` is the raw `ffprobe` stdout as a `String`, **not** a JSON scalar: this repo has no custom
scalars, and `errorParams` above already travels hand-encoded the same way. That is not just
consistency — the stored bytes must stay byte-identical to what `ffprobe` emitted, because a row is
meant to be pasted straight into the case corpus at `services/worker/ffmpeg/`, which is verbatim
probe output. A scalar that round-trips through `JSON.parse`/`JSON.stringify` reorders keys and
reformats numbers, and the corpus would quietly drift from reality. For the same reason
`getMetadata` in `services/worker/src/ffmpeg/metadata.ts` returns `{ metadata, raw }` rather than
re-serializing its parsed value.

`ffprobeLogs` orders `createdAt` descending then `id` descending, so paging stays stable when
several probes land inside the same second; `file` filters on **exact equality**, never a prefix or
a `LIKE`. `take`/`skip` are non-null with defaults — Nest emits `Int! = 50` for an argument carrying
a `defaultValue`, so the generated SDL reads `Int!` where `spec.md`'s delta wrote `Int`. Same
behaviour for every caller; the shipped `schema.gql` above is the authority.

**The authorization split is per method, and it is load-bearing.** `recordFfprobe` carries
`@AllowService()` — it is the worker's write path, called with `SERVICE_TOKEN`. The other three
carry `@UseGuards(AdminGuard)` **individually**. `AdminGuard` rejects any principal whose
`type !== 'user'`, so the class-level placement `UsersResolver` uses would also reject the worker on
`recordFfprobe` — and the worker swallows that rejection by design (below), so the table would stay
empty forever with no error anywhere except one line in the worker log. `services/api/src/ffprobe-logs/ffprobe-logs.resolver.spec.ts`
asserts the wiring off the metadata Nest actually sees, because no runtime test would catch it.

Consumer obligations: `worker` calls **only** `recordFfprobe`, selects `{ id }` and discards the
result. It treats **every** error in this feature as non-fatal — `error.ffprobeLog.empty_payload`, a
stale `SERVICE_TOKEN` giving `error.auth.unauthenticated`, a transport failure, anything unforeseen:
`console.error` and the encode continues. This is the second documented exception to the worker's
"errors must not be swallowed" rule, and the reasoning is `cleanupSource`'s from
`012-post-download-processing` — a diagnostic write must never demote a job that produced a good
file. The `try/catch` therefore wraps the `fetchGraphQL` call **only**; widening it to cover the
probe would turn a real `ffprobe` failure into a silent skip and let the encode run with no
metadata.

**Timing is part of the contract, not an implementation detail.** The mutation is sent after
`ffprobe` returns and **before** FFmpeg starts, not when the encode finishes. An encode that fails,
or a container killed mid-transcode, is exactly the case worth having evidence for. Mechanically
this is why `EncodeFn` (`services/worker/src/encode/types.ts`) gained a required `onProbe(file, ffprobe)`
callback alongside `onProgress`: the encode driver is a documented no-GraphQL seam, so the driver
invokes the callback and `jobs/encode.job.ts` owns the network call. Returning the probe out of the
driver would have been simpler and wrong — the driver only returns once the encode has finished.

`web` consumes none of these keys and gets no `messages/{en,es}.json` entry for them; the English
`message` is the fallback anyone reading them sees, which is REQ-8 of `018-ui-i18n` working as
designed.

### Download status and torrent tags (`022-download-status-tags`)

```graphql
type Download {
  mediaSourceId: Int!
  infoHash: String          # null for a LOCAL_FILE upload racing alongside torrents
  kind: String!             # SourceKind, plain String! — for display, not for branching
  label: String!            # "Transformers" | "Reacher S03E08" | "Reacher Temporada 3"
  releaseTitle: String
  movieId: Int
  seasonId: Int
  episodeId: Int
  status: String!           # SourceStatus, plain String! like every other status field
  torrentState: String      # raw qBittorrent state; null when the torrent is not in the client
  progress: Float           # 0..100; null when the torrent is not in the client
  downloadSpeed: Float      # bytes per second; null when the torrent is not in the client
  readAt: DateTime!
}

type Query {
  movieDownloads(movieId: Int!): [Download!]!
  showDownloads(showId: Int!): [Download!]!
}

type Mutation {
  downloadStart(mediaSourceId: Int!): Download!
  downloadStop(mediaSourceId: Int!): Download!
  downloadDelete(mediaSourceId: Int!): Boolean!
}
```

`Movie.mediaSourceId: Float` is **removed** from the schema — a consequence of inverting the
`Movie` ↔ `MediaSource` relation (below), not an independent decision. No consumer selected it.

**`downloadDelete` is not `downloadRemove`, and the names are close enough to be dangerous.** The
existing `downloadRemove(mediaSourceId: Int!, deleteFiles: Boolean = true): String!` is unchanged —
`@AllowService()`, called only by the worker's `cleanup-source.ts`, always with `deleteFiles: false`.
`downloadDelete` is the user-facing sibling: ownership-scoped, no `deleteFiles` argument, always
deletes files, returns a boolean rather than `downloadRemove`'s `omitido: …` string.

**`downloadRemove`'s behaviour grew without its signature changing.** When it removes a winner's
torrent it now also removes that source's losing siblings — the "race" below. The worker's call
site, arguments and return type are identical, so no typechecker on either side sees this; it is
recorded here for exactly that reason.

**The list is DB-first, joined to qBittorrent on `infoHash`.** Rows come from `media_sources`
filtered by the caller's owned title; a tag only narrows the `torrents/info` read on the qBittorrent
side. A tag is a title string with no ownership and no identity — deriving the list from it would
leak one user's downloads to another and pick up torrents a human tagged by hand. A torrent missing
from the client is still a row: `torrentState`/`progress`/`downloadSpeed` come back `null`, `status`
and `label` still come from the database.

**`infoHash != null` is the controllability test; `kind` is display-only.** `infoHash: null` means
the row is an upload with no torrent to start, stop or delete. `SourceKind` has two torrent values
(`TORRENT_SEARCH`, `TORRENT_FILE`), and both consumers hand-retype it with no codegen — branching on
`kind === 'TORRENT'` would compile, render, and silently strip the buttons off every row.

**`progress` is 0..100 over GraphQL, not qBittorrent's 0..1.** Converted once, server-side, in
`DownloadsService`; `TorrentClientInfo.progress` at the adapter boundary stays 0..1, passed through
unrescaled. A consumer that multiplies again renders 1%.

**A title may now race several acquisitions at once.** `Movie.mediaSourceId Int? @unique` — a
database-level 1:1 — is replaced by `MediaSource.movieId Int?`, making all four owner relations
(`movieId`/`episodeId`/`seasonId`, plus the existing torrent linkage) symmetric. The seven guards
that used to refuse a second acquisition with `…_DOWNLOAD_IN_PROGRESS` now refuse only a
**`COMPLETED`** target; a target that is merely downloading accepts a second, third, or Nth source
with no prompt. `force` and the three `…_ALREADY_COMPLETED` keys are unchanged —
`027-replace-completed-media`'s authorisation to replace a *completed* title, not this feature's to
touch. The `…_DOWNLOAD_IN_PROGRESS` keys themselves are deleted, not narrowed: `error-keys.ts`,
`messages.en.ts` and both `services/web/messages/*.json` catalogs, plus the key arrays in
`importMagnetModal.tsx`/`SearchTorrent.tsx`.

**The race arbiter is one shared method on `DownloadsService`, entered from two places.** A torrent
announces completion through the existing `torrentCompleted` webhook; a tus upload announces its own
completion through `UploadsService.onUploadFinish`, which never passes through `DownloadsService`
otherwise. Both call the same `resolveRace(mediaSourceId)`: if a sibling of the same target already
reached `READY`/`SCANNED`, the call is a no-op; otherwise every other non-terminal sibling is stopped
in qBittorrent and moved to `PAUSED`, and the winner is left running to keep seeding. Siblings are
always selected by `movieId`/`episodeId`/`seasonId`, never by tag — a tag is a title string two
different shows can share. When the winner's post-encode cleanup runs, `downloadRemove` sweeps the
losing siblings too: removed from the client with their files, rows deleted outright. This holds
**regardless of whether the winner itself has an `infoHash`** — an upload can win, and
`downloadRemove`'s pre-existing `!infoHash` early return no longer sits in front of the sweep, only
in front of the winner's own `torrentClient.remove` call.

Consumer obligations:

- **`web`**: retypes `Download` by hand in `src/types/downloads.ts` and `src/actions/downloads.ts`;
  keeps `force` on the acquisition actions and `createUploadTicket` untouched (027's); branches the
  panel's three row buttons on `infoHash != null`, never on `kind`; treats `progress`/`downloadSpeed`/
  `torrentState` arriving `null` as a normal, renderable state, not a loading state.
- **`worker`**: no obligation. `cleanup-source.ts` keeps calling `downloadRemove(mediaSourceId,
  deleteFiles: false)` for the winner with an unchanged signature and receives an unchanged
  `omitido: …` shape; it does not see the sweep happening beside its own call.

### Compression becomes optional (`032-optional-compression`)

```graphql
type EncodeJobDetails {
  """
  Whether this job must be re-encoded by FFmpeg. Resolved from the
  `compression_enabled` setting when this query is answered, not when the
  ProcessJob was enqueued. False means: skip ffprobe, ffmpeg and mkvmerge, and
  move the input file to the destination path instead. Everything else about
  the job — output path, completion report, cleanup — is unchanged.
  """
  compressionEnabled: Boolean!
}
```

No other type, field, argument or mutation changed. `Mutation.updateSettings` already accepts
arbitrary `SettingInput` entries validated against the server-side catalog, so persisting the new
key needed no signature change.

The settings catalog gained one key, beside `movies_enabled`/`shows_enabled`: `compression_enabled`
(`boolean`, seeded `"true"`, editable from Settings → Compression). Same
`error.setting.expected_boolean` validation as the other two booleans — a value that is not exactly
`"true"`/`"false"` is rejected and the row keeps its previous value.

**`compressionEnabled` is resolved when the worker asks, not when the job was enqueued.** An
administrator can flip the switch mid-download; the job that starts encoding afterward reads
whatever the setting says at that moment. `ProcessJobsService.getEncodeJobDetails` reads it off
`SettingsService.getMap()` alongside every other field already flattened onto `EncodeJobDetails`,
and a missing row (a fresh install predating this feature, or the row deleted by hand) resolves to
`true` — the exact string `"false"` is the only value that means "skip compression". `worker` must
mirror that rule: `undefined` on the wire also means compress, never `false`. Reading either the
missing-row case or a wire skew as falsy would compress nothing an administrator ever asked to
leave uncompressed only by accident of a stale deploy — the failure mode this field exists to
avoid working the other way is silent, not loud.

`false` does not mean "skip this job" — it means "skip only the FFmpeg/mkvmerge step". The worker
still moves the input file to its final destination path, under the library name, with the
**source's own extension** (not the `.mkv` `buildOutputPath` assumes for a compressed output),
still stops the seed and runs the same cleanup, and still reports `encodeCompleted` with a real
output path and progress reaching 100 — only `ffmpegCommand` comes back the empty string, which is
the contract for "this job was moved, not encoded", not a placeholder for a command that failed to
record.

Consumer obligations:

- `web` sends `compression_enabled` explicitly (`"true"`/`"false"`) on every save of the main
  settings form, the same `BOOLEAN_KEYS` idiom as `movies_enabled`/`shows_enabled`. It never reads
  `EncodeJobDetails.compressionEnabled` — that field is worker-only.
- `worker` retypes `compressionEnabled` into its local `EncodeJobDetails` type and adds it to the
  `processJob` selection set. The passthrough path is a third `EncodeFn`
  (`services/worker/src/encode/passthrough.ts`) selected directly by `encode.job.ts` on
  `details.compressionEnabled === false` — **not** registered in `src/encode/index.ts`'s `DRIVERS`,
  so it cannot be reached through `ENCODE_DRIVER` and an operator's stored switch always wins over a
  developer's `mock`/`ffmpeg` choice.

The error vocabulary gained one worker-owned key, added to the "encode pipeline" row below:
`error.encode.move_failed` (`No se pudo mover el archivo al destino: {detail}`), reported through
`encodeFailed` exactly like any other encode failure — the job ends `FAILED`, the source file is
left in place, and no final-named file exists at the destination.

### The billboard's popular lists (`033-billboard-and-navigation`)

```graphql
type Query {
  """
  Page 1 of TMDB's popular list for `type` ("movie" | "show"), 20 items, in the
  order TMDB returns them. Cached for 24h per type and UI language; `mediaId`
  and `inLibrary` are computed per caller, after the cache write.
  """
  popularMedia(type: String!): [MediaSearchResult!]!
}
```

`popularMedia` returns `MediaSearchResult` — the same type `searchMedia`/`searchAllMedia` already
return — rather than a leaner, purpose-built type. The billboard card renders only a poster, a type
badge and the existing add/go action, but reusing the search result type means `web` retypes
nothing new and the carousel card reuses `MediaResultAction` unchanged; a narrower type would still
carry `mediaId`/`inLibrary` (the fields the action needs) plus whatever else it took to describe a
poster, at which point it is the same shape by another name. Fields the card does not render
(`title`, `releaseDate`, `overview`, `status`) are still populated — the card choosing not to show
them is a `web` decision, not a contract one.

**`popularMedia` takes no `language` argument.** Unlike `searchMedia`, which searches whatever the
caller typed, the popular list is resolved entirely server-side: `api` reads the calling user's
effective UI language (`User.uiLocale` → `defaultUiLocale` → `en`, the same order `018-ui-i18n`/
`029-settings-screen-tabs` already established) and requests TMDB in that language itself. A
client-supplied language argument was considered and rejected — it would let any caller mint an
arbitrary cache key (`tmdb:popular:<type>:<anything>`), unbounding the cache-key space the 24-hour
TTL is meant to keep small (REQ-12). The set of languages actually cached stays exactly the set of
`uiLocale`/`defaultUiLocale` values in use on the installation.

**The result is cached in Redis for a day, keyed `tmdb:popular:<type>:<lang>`** — `<type>` is
`movie`/`show`, `<lang>` is the resolved UI language, so `es` and `en` (or any other supported
locale) each keep their own entry and their own TTL, alongside the existing per-title
`tmdb:movie:<tmdbId>`/`tmdb:<type>:<tmdbId>` caches `006-media-search` established. The same
catalog-only invariant applies: what is written to Redis carries no `mediaId` and no `inLibrary` —
those are computed per caller **after** the cache write, exactly the cache-before-enrich ordering
`005-movie-search`/`006-media-search` already owe on `searchMedia`. Enriching before the write would
leak one user's library into what every other user (and every other day's visitors, for the rest of
the TTL) sees for that language. A cache miss, an expired entry, or an unreachable Redis falls
through to a live TMDB call rather than failing the screen — a Redis failure here is invisible to
the caller, logged, and never turns into a GraphQL error.

`popularMedia` requires an ordinary user credential like `searchMedia`; it is not exempted for the
`SERVICE_TOKEN` principal, and adds no anonymous surface — `defaultUiLocale` stays the only
`@Public()` field.

One key is added to the error vocabulary, in the "movies/shows/seasons/episodes" row below:
`error.media.catalog_unavailable`, thrown as a `ServiceUnavailableException` when TMDB is
unreachable, rejects the configured key, or answers something that is not the JSON popular-list
shape. `error.media.unsupported_type` — already in the vocabulary from `006-media-search` — covers
the same refusal `popularMedia` gives a `type` outside `"movie"`/`"show"`, thrown before any TMDB or
Redis call is made. `web` fetches the two lists independently, so a failing list renders the
translated `error.media.catalog_unavailable` copy inside that carousel's strip while the other
carousel renders normally; an `UnauthorizedException` goes through `redirectToClearSession`, not
`redirectIfUnauthenticated` — the billboard's fetch runs during a Server Component render pass,
where mutating cookies is illegal, so it hands off to the Route Handler instead, exactly as
`searchAllMedia` already does in `src/actions/media.ts`.

Consumer obligations: `web` adds a `popularMedia` server action alongside `searchMedia`'s, retyping
the same `MediaSearchResult` shape it already has in `src/actions/media.ts`, using
`redirectToClearSession` for the same render-pass reason, and renders each list's own error
independently rather than failing the whole billboard on one carousel. `worker` has no obligation;
it never queries `popularMedia`.

### The media-server index is admin-only and rebuilt out of band (`034-jellyfin-library-reconciliation`)

```graphql
type MediaServerIndexStatus {
  """never | syncing | ready | failed — `never` also covers a media server set to `none`."""
  state: String!
  itemCount: Int!
  syncedAt: DateTime
}

type Query {
  mediaServerIndexStatus: MediaServerIndexStatus!
}

type Mutation {
  resyncMediaServerIndex: MediaServerIndexStatus!
}
```

Both operations carry their own `@UseGuards(AdminGuard)`, the `ffprobe-logs.resolver.ts` per-method
precedent — the existing `mediaServerClients` query stays unguarded, so the guard is not lifted to
class level. `state` is a plain `String!`, not a GraphQL enum, for the same reason `Movie.status`
and `Show.status` already cross as strings: a value the client doesn't recognize yet must not fail
to parse.

`resyncMediaServerIndex` returns **immediately** — it starts the rebuild detached and answers with
`readState()` as it stands at that moment, not after the rebuild finishes. A rebuild already in
flight is not an error: calling it again while `state` is `syncing` simply returns the in-progress
status a second time. Calling it while the configured client is `none` or has no host throws
`error.mediaServer.not_configured`.

**`addMedia` is unchanged**, and `Movie`, `Show` and `Episode` gain no field. The reconciliation
this index exists to support is invisible on the wire — a newly registered title's status reflects
what the media server already holds, but there is no new field a consumer reads to find that out;
it is the same `status` column `addMedia`'s caller already re-fetches. Nothing in `web` or `worker`
observes `MediaServerIndexStatus` except the Settings screen's own read/resync round trip.

### `TorrentResult` survives a missing infoHash instead of dropping the row (`037-indexer-result-loss`)

```graphql
type TorrentResult {
  id: String!
  infoHash: String
  title: String
  size: Float
  seeders: Int!
  leechers: Int!
  items: [TorrentLink!]!
  infoUrl: [TorrentLink!]!
}

type Mutation {
  addTorrentToMovie(movieId: Int!, infoHash: String, urls: [String!]!, releaseTitle: String, force: Boolean): Movie!
  addTorrentToEpisode(episodeId: Int!, infoHash: String, urls: [String!]!, releaseTitle: String, force: Boolean): Episode!
}
```

Before this feature, `searchTorrents`' `filterData` resolved every hash-less release's `infoHash` at
search time, firing one HTTP fetch per row with an 8s abort each; whatever did not settle in time
was silently dropped from the response — measured at 227 of 780 raw Prowlarr rows on one real
query. `TorrentResult.infoHash` is now nullable and every row survives: grouped by uppercased
`infoHash` when the indexer supplied one, else by a 40-hex hash pulled from `guid`, else by a key
derived from the normalized title and size. No HTTP call happens during a search any more.

**`TorrentResult.id` is display identity only — never sent back to the API.** It is the grouping
key above, stable within one search response and unique across it, but **not** stable across two
searches (a hash-less key is derived from title+size, not a persistent identifier). It exists so
`web` has a React key and an in-flight marker that survives a null `infoHash` without re-deriving
the same normalization independently — two implementations of "normalize this title" with no
codegen between them is exactly the drift this document exists to prevent.

**`infoHash` resolution moved from the search path to the add path.** `addTorrentToMovie`/
`addTorrentToEpisode` now accept a nullable `infoHash`; when the caller (`web`) sends `null` — the
row it clicked never had one — `api` resolves it lazily, once, only for the release the user
actually chose, via the same three-step ladder `filterData` used to run eagerly on all 250+
hash-less rows. If resolution fails, the mutation throws `error.indexer.no_infohash` rather than
writing an empty-string hash: `attachTorrentSource`'s own `infoHash: string` parameter stayed
non-null on purpose, so an unresolvable release surfaces as a visible error instead of a
`MediaSource` row whose hash qBittorrent will never report, stuck in `DOWNLOADING` forever with no
error anywhere.

`error.indexer.no_infohash` already existed in `api`'s key list (see the vocabulary table above);
this feature is the first to give it a `web` translation, since a Spanish user previously saw the
raw English fallback for it.

Consumer obligations: `web` selects `id` alongside `infoHash` in `searchTorrents`, sends `infoHash`
as `string | null` on both add mutations with **no `?? ''` coercion**, and keys/tracks
in-flight-add state off `id` instead of `infoHash`. `worker` has no obligation; it never queries
`searchTorrents` or either add mutation.

### The one non-GraphQL route

`POST/PATCH/HEAD /uploads` on `api` (`services/api/src/uploads/`) is the project's only REST
endpoint, and the exception is closed (Constitution, Article II). The browser talks to `api`
directly, bypassing `web`, because a resumable multi-gigabyte tus upload fits neither a GraphQL
mutation nor a Next Server Action (1 MB body limit by default).

`onUploadFinish` closes its own loop — creates the `MediaSource`, updates the `Movie`, enqueues
`bull:process` — inside the request that receives the last chunk, so there is no window in which a
file exists but is unregistered.

Since `002-auth-login`, the route also authenticates — separately from the GraphQL guard, which
never reaches non-GraphQL contexts. A signed-in user mints a short-lived, single-use ticket via the
`createUploadTicket` GraphQL mutation; the browser sends it as `Authorization: Bearer <ticket>` on
the tus `POST`; `onUploadCreate` verifies and spends it. See `services/api/CLAUDE.md`'s `uploads/`
bullet for the mechanism.

### The queue payload is a second, parallel contract

`api` → `worker` also communicates through BullMQ, and that payload is **not** covered by the
GraphQL schema. Both ends declare it, and both files say so in their opening comment:

- `services/api/src/queue/types.ts` — producer
- `services/worker/src/queue/types.ts` — consumer

They must be changed together. Nothing enforces it. A feature touching the queue declares that
payload in its `spec.md` the same way it declares the GraphQL delta.

### What never crosses the boundary

- **Absolute container paths.** Constitution, Article V — `web` sees host paths, `worker` receives
  a resolved `outputRoot`, and `MediaRootsService` owns every translation.
- **Prisma types.** `grep -rn "@prisma/client" services/web/src services/worker/src` must return
  nothing. Enums crossing the boundary are re-declared as GraphQL enums or plain string unions
  (`services/web/src/types/media.ts`).

## Known debt

- **No codegen.** The whole "gap" section above exists because of this. Fixing it means adding
  `@graphql-codegen` against `services/api/src/schema.gql` in both consumers — it touches two
  `package.json` files and both build pipelines, so it is a feature in its own right and a good
  candidate for the first real `/specify`.

Both items formerly logged here — `fetchGraphQL` logging full request bodies (including the
plaintext login password) and the `CONFIG.authTtoken` typo — were fixed by `002-auth-login`
(REQ-2, REQ-7). See `services/web/CLAUDE.md`'s Auth section for the current shape.

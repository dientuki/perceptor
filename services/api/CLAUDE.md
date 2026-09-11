# services/api

Rules that outrank this file: `docs/constitution.md`. Agent brief: `.claude/agents/api.md`.
Cross-service boundary: `docs/spec/graphql-contract.md`.

NestJS 11 + Apollo (GraphQL) + Prisma 7 + MariaDB, run only inside Docker — see the root
`CLAUDE.md` for the Docker-first workflow and `bin/` wrappers before running anything here.

This service owns the database and the GraphQL schema for the whole system. There is no `db`
service: a schema change is an `api` change (Constitution, Article III).

## Migrates and seeds itself on boot

`src/main.ts` runs `src/bootstrap/run-migrations.ts` (`prisma migrate deploy` as a child process)
and then `src/database/seed/production-seed.ts` (languages, the administrator user, settings) right
after `assertAuthEnv()` and before `NestFactory.create` — unless `PERCEPTOR_AUTO_MIGRATE=false`. A
rejection logs the exact `docker compose exec` command to resolve it and `process.exit(1)`s before
the process ever reaches `app.listen()`, so the health check never goes green on a half-migrated
database (`049-published-images-install`, REQ-10/NFR-2). `prisma/seeds/index.ts` is the
**development** seed only: it calls `production-seed.ts` first, then the `movie.ts`/
`media-source.ts` fixtures a real installation must never receive.

## GraphQL is code-first

`src/app.module.ts` configures `GraphQLModule.forRoot` with `autoSchemaFile` conditional on
`NODE_ENV`: a file at `src/schema.gql` in development, `true` (in-memory, nothing written) under
`NODE_ENV=production`, because the `prod` image has no `/app/src` to write into.

- The **source of truth** is the TypeScript decorators on resolvers, entities (`@ObjectType`,
  `@Field`, …) and DTOs (`@InputType`, …) under each module's `entities/` and `dto/`.
- `src/schema.gql` is **regenerated on every boot** and marked "DO NOT MODIFY". Never hand-edit it —
  change the decorators.
- `playground`/`introspection` are on outside of `NODE_ENV=production`.

## Validation errors reach the caller as a plain string

`main.ts`'s global `ValidationPipe` has a custom `exceptionFactory`: it throws `BadRequestException`
with a single string — the first `class-validator` constraint message. Nest's default would throw
the raw `ValidationError[]`, which serializes as a generic `"Bad Request Exception"` at the GraphQL
error's top-level `message` and buries the real text under `extensions.originalError.message[0]`.
Every consumer in `services/web/src/actions/*.ts` reads `errors[0].message` directly, so a DTO's
`@MinLength`/`@IsNotEmpty` message reaches the screen unmodified.

## Errors carry a translation key (`018-ui-i18n`)

Every user-facing exception is built through `src/i18n/i18n-error.ts`'s `i18nError.{notFound,
badRequest, conflict, unauthorized, forbidden, serviceUnavailable}(key, params?)` — a thin factory
over Nest's real exception classes (never a parallel hierarchy), whose response body is
`{ message, i18n: { key, params? } }`. `key` is one of the constants in `src/i18n/error-keys.ts`;
`message` is always the English rendering from `src/i18n/messages.en.ts`, `{param}`-interpolated.
`src/i18n/graphql-error.formatter.ts`, wired into `GraphQLModule.forRoot`'s `formatError`, lifts
`i18n` onto the outgoing error's `extensions` — a keyed throw arrives on the wire as
`extensions.i18n = { key, params }`, an un-migrated or genuinely unexpected error passes through
unchanged (no invented key). `main.ts`'s `exceptionFactory` (above) also understands a
`class-validator` `message` option that is itself a key string, rendering it the same way.

This service **only ever produces English** — translating a key into another language is `web`'s
job (`docs/spec/graphql-contract.md` § "UI internationalization" has the full vocabulary and the
error envelope shape). `User.uiLocale`, `Query.supportedLocales` and `Mutation.setUiLocale` exist
so `web` can resolve and persist the active locale. **Since `033-billboard-and-navigation`, `api`
does read `uiLocale` itself** — `PopularMediaService` resolves it (falling back to the `ui_locale`
setting, then `en`) to pick TMDB's `language` for the popular lists, never to translate anything;
every error this service throws is still English-only.

## Prisma 7 via driver adapter

`prisma/schema.prisma` declares `datasource db { provider = "mysql" }` with **no `url`** —
Prisma 7 hard-rejects `datasource.url` inside schema files (`P1012`), so the connection string is
never read from the datasource block. `src/prisma/prisma.service.ts` builds a `PrismaMariaDb`
adapter (`@prisma/adapter-mariadb`) from `process.env.DATABASE_URL` alone and passes it into
`new PrismaClient({ adapter })`, throwing loudly at construction if it is unset — no default, ever.

- `DATABASE_URL` **is** the single source of the connection string for the running app. There is no
  hardcoded fallback (`049-published-images-install` closed that item — see root `CLAUDE.md`).
- The CLI resolves the same variable through a **Prisma config file**, not the datasource block —
  Prisma 7 moved connection URLs there. Two configs exist for two different runtimes:
  `prisma.config.ts` (repo root, TypeScript, `ts-node`+`dotenv`) is what `bin/npm api run
  prisma:migrate` and the dev seed use from a checkout; `prisma/runtime.config.mjs` (plain `.mjs`,
  no TypeScript, no `dotenv`) is what `src/bootstrap/run-migrations.ts` passes via `--config` when
  `api` applies migrations at boot inside the **published** image — that image has no
  `prisma.config.ts` (outside `prisma/`, and `ts-node`/`dotenv` are devDependencies stripped by the
  prod stage's `npm prune --omit=dev`), but it does already receive `prisma/runtime.config.mjs` via the
  existing `COPY --from=builder .../prisma ./prisma` step.
- `PrismaService` implements `OnModuleInit`/`OnModuleDestroy` to `$connect`/`$disconnect`.

## Module map

Every domain module is `<name>.module.ts` + `<name>.resolver.ts` + `<name>.service.ts`, with GraphQL
types in `entities/` and inputs in `dto/`. Follow the neighbours.

- **`auth/`** — JWT + Passport, the authentication boundary for the whole API.
  `guards/jwt-auth.guard.ts` is registered once as `APP_GUARD`, so **every GraphQL operation requires
  a credential by default**. Two `Reflector` decorators carve out exceptions: `@Public()` (only on
  `login`) and `@AllowService()` (the worker/qBittorrent-reachable operations). `auth.types.ts`'s
  `toPrincipal()` decides between a **user** principal (`{type:'user', id, username}`, checked against
  `session.service.ts`'s Redis session record so `logout` can actually revoke a stateless JWT) and a
  **service** principal (`{type:'service', name}` — no id, no expiry, minted by
  `scripts/mint-service-token.ts`, never session-checked). `SessionService` keeps a per-user reverse
  index (`user-sessions:<userId>`) so `revokeAllForUser()` kills every live session at once.
  The guard **short-circuits for non-GraphQL contexts**, so it never touches `/uploads` — that route
  authenticates per-request by ticket. `guards/admin.guard.ts` is applied at class level on
  `UsersResolver` and **re-reads `isAdmin` from the DB on every call** rather than trusting the JWT,
  so a demoted admin stops working on the next request, not at token expiry.
  `scripts/reset-password.ts` is the recovery path — run via `bin/reset-password`, never bare.
- **`users/`** — CRUD over `User`, entirely behind `AdminGuard`. `remove()` refuses self-delete and
  refuses deleting the last admin. `update()` refuses self-disable and refuses disabling the last
  *enabled* admin (`{ isAdmin: true, isEnabled: true }` — counting disabled admins would let someone
  lock the app out one disable at a time). A successful disable calls `revokeAllForUser()` in the same
  method. `login()` refuses a disabled user with a distinct message, even on correct credentials.
- **`media/`** — the boundary that turns a `type` argument into a choice of service. Exposes
  `searchMedia(query, type)`, `addMedia(tmdbId, type)` and, since `026-multi-search`,
  `searchAllMedia(query)` — one search across both catalogs, films and series interleaved in the
  catalog's own order. `media-dispatch.service.ts` holds a `Record<MediaType, MediaTypeService>`
  lookup and throws for anything else; `026` added nothing to it. `media-type.interface.ts` is the
  whole contract: `search(query, userId)`, `register(tmdbId, userId)` and, since `026`,
  `cacheAndEnrich(results, userId)` — the best-effort cache write followed by caller-scoped
  ownership enrichment, extracted out of each service's `search()` so both the per-type entry point
  and the mixed one run the identical ordering-critical code. `media-search.service.ts` is the
  fan-out for `searchAllMedia`: one `TmdbClient.searchMulti()` call, group rows by type, one
  `cacheAndEnrich` per type via the existing dispatch, then rebuild the response by walking the
  original ordered rows keyed by `${type}:${id}` — never the bare id, which collides across types.
  Cache keys, endpoints, error strings and Prisma models stay private to each per-type
  implementation by design. A third media type costs one new service plus one lookup entry, not an
  edit to the dispatch. Since `033-billboard-and-navigation`, `popular-media.service.ts` is a third
  fan-out beside `media-search.service.ts`: `PopularMediaService.list(type, userId)` backs the
  `popularMedia` query behind the billboard's two carousels, resolving the caller's UI language
  first, then reading/writing a day-long `tmdb:popular:<type>:<lang>` list cache (via
  `TmdbClient.popular()`) before running the same `cacheAndEnrich` ownership step every other entry
  point uses — the cache write happens strictly before enrichment, same ordering trap as
  `movies/`'s below. A TMDB failure here surfaces as `error.media.catalog_unavailable`
  (`ServiceUnavailableException`), a new key in `error-keys.ts`. Since
  `045-media-type-availability`, `MediaCapabilitiesService` reads the `movies_enabled`/
  `shows_enabled` Settings (`!== 'false'`, an absent row reads as enabled — same idiom as
  `compression_enabled`) and answers `read()`/`isEnabled(type)`/`assertEnabled(type)`/
  `enabledTypes()`. The `mediaCapabilities` query exposes the pair to every authenticated user with
  no `AdminGuard` (the `settings` query stays admin-only — it also holds the TMDB bearer token and
  other credentials this query must never leak). `assertEnabled` gates `searchMedia`, `popularMedia`
  and `addMedia` before the dispatch call, and `searchAll` narrows its rows to the enabled types
  before grouping — never after, since filtering post-`cacheAndEnrich` would still write a disabled
  type's rows into that type's Redis cache. An unrecognised type is left to
  `MediaDispatchService.resolve()`'s own `MEDIA_UNSUPPORTED_TYPE`, not reinterpreted here. Nothing
  downstream of registration is gated — an in-flight download/encode for a type disabled mid-flight
  still finishes (REQ-11). Since `048-shorts-category`, `MediaCapabilitiesService` lives in its own
  `MediaCapabilitiesModule` (imports `SettingsModule` only) rather than being declared directly by
  `MediaModule`, so `MoviesModule` and `ProcessJobsModule` can read the capability without importing
  `MediaModule` itself — `MediaModule` already imports `MoviesModule`, and the reverse import would
  be a Nest circular dependency. **No `forwardRef` anywhere in this split**: the module boundary was
  drawn so none is needed. `read()` gained a third field, `shortsEnabled`
  (`moviesEnabled && map['shorts_enabled'] === 'true'`) — note the `=== 'true'`, the deliberate
  **opposite** of the `!== 'false'` idiom two lines above it, so an install predating this feature
  reads the absent row as *off* rather than growing a category nobody enabled.
  `isShortsEnabled()`/`assertShortsEnabled()` are `shortsEnabled`'s single-purpose twins of
  `isEnabled`/`assertEnabled`, throwing `error.media.shorts_disabled`. `addMedia` gained an optional
  `asShort` argument: guarded, in order, by `assertEnabled(type)`, then
  `error.media.shorts_not_a_movie` when `asShort` is set for a non-movie type, then
  `assertShortsEnabled()` — before `MediaTypeService.register`'s new optional third parameter
  (`options?: { asShort?: boolean }`) is even reached.
- **`movies/`** — CRUD over `Movie`, plus `search`/`register` (implementing `MediaTypeService`) and
  `addTorrentToMovie`/`addMagnetToMovie`, the two entry points into the download pipeline. `Movie` is
  a **shared catalog row** (`tmdbId @unique`, never duplicated) joined to `User` through `UserMovie`.
  Everything user-visible is scoped through that join: `movies`, `search`'s `inLibrary`, and
  `movie(id)` via `findOneFromDb(id, userId)` (a `findFirst` with
  `where: { id, users: { some: { userId } } }`). A `null` from `movie(id)` therefore means "not
  available to you", identically for a missing id and an unowned film. The acquisition mutations
  refuse a film the caller hasn't registered with that same `La película <id> no existe`.
  **Ordering trap:** `cacheAndEnrich` enriches results with `mediaId`/`inLibrary` *after* the Redis
  cache write in `cacheMovies`. That cache key is global across all users — computing ownership
  before it leaks one user's `inLibrary` into every other user's results for 24h
  (`movies.service.spec.ts`, plus `media-search.service.spec.ts` for the mixed-search entry point).
  Since `048-shorts-category`, `Movie.isShort` (`Boolean @default(false)`) follows the exact same
  rule: `enrichWithOwnership` adds it to the same per-request `select`, alongside `mediaId`/
  `inLibrary`, never to the cached shape (`false` for anything unregistered). `findAll` takes an
  optional `isShort` filter applied to the Prisma `where` only when given — omitted/`null` still
  means "every film the caller owns", which is what `/movies` sends while the category is disabled.
  `setShort(id, userId, isShort)` is a single-column update behind the same `findOneFromDb` ownership
  gate every per-title mutation already runs, exposed as `setMovieShort`, guarded by
  `assertEnabled('movie')` then `assertShortsEnabled()` in that order.
- **`shows/`** — `ShowsService`, `MoviesService`'s structural twin, **deliberately not factored into
  a shared base class** (see `006-media-search/spec.md` § Out of Scope). Same cache-before-enrich
  ordering, same upsert-based idempotent linking, scoped through `UserShow`. `shows` is a per-user
  listing; `show(id)` is `findOneFromDb`'s twin one level deeper, with a nested `include` on
  `seasons`/`episodes` ordered server-side. `Show.status` is a `MediaStatus` in Prisma but crosses
  GraphQL as a plain `String!`, exactly as `Movie.status` does — **do not `registerEnumType` it for
  one type only.** `register()` kicks off a detached, never-awaited hydration (`ShowsService.hydrate`):
  one request for the season list, then one **sequential** request per season (never `Promise.all` —
  TMDB rate-limits), claimed via a Redis `SET … NX` so concurrent registrations fetch once.
  `Show.seasonsSyncedAt` is set only once every season and episode is written; it stays `null` on any
  failure, and the next `register()` retries whenever it is `null`.
- **`languages/`** — the `languages` query (reads the seeded `Language` table, deriving an English
  `name` per `tag` from `language-names.ts`, not stored — `web` renders the localized display name
  via `Intl.DisplayNames` since `018-ui-i18n`; this map is an internal English label, not the UI
  string) plus the per-title preference writes backing
  `setMoviePreferredTrackLanguages`/`setShowPreferredTrackLanguages`. **Since
  `039-per-title-language-split`, every per-title write and read takes a `kind: LanguageTrackKind`**
  (`AUDIO`/`SUBTITLE`, the enum `029-settings-screen-tabs`/`021-user-preferences` already seeded) —
  `UserMovieLanguage`/`UserShowLanguage` are keyed additionally by it
  (`@@id([userId, movieId, languageId, kind])`), and both `set…PreferredTrackLanguagesFor`/
  `find…PreferredTrackLanguagesFor` narrow every `deleteMany`/`createMany`/read `where` to
  `{ userId, movieId, kind }` (or `showId`) — dropping `kind` from a `where` would silently wipe or
  read the caller's *other* kind, not fail. **Since `030-language-regional-variants`, `Language.tag`
  (a unique BCP-47 tag) is the identifier, not `iso2`** — `iso2` stays on the row and in the table but
  is no longer unique, since a base language and its regional variants share it (`es`, `es-419`,
  `es-ES` all carry `iso2: "es"`). `findAll()` omits a base row from the query's result only when
  another row shares its `iso2` — the naive rule "hide any row whose `tag` equals its `iso2`" would
  hide every ordinary language, since `en`'s tag *is* `en`. The validator,
  `validateAndResolveLanguageIds` (public since `029-settings-screen-tabs`, reused by `settings/`'s
  `default_languages` validation), checks a submitted tag against the table `findAll()` reads from
  *before* filtering — a directly-submitted `es` is accepted even though the query never offers it,
  because it is a real row meaning "Spanish, no variant preference." Each write validates every `tag`
  through it, rejects duplicates within one argument, then replaces the whole set atomically
  (`deleteMany` + `createMany` in a `$transaction`). Exported so `movies/` and `shows/` each host their
  own two `@ResolveField()`s, `audioLanguages`/`subtitleLanguages` (replacing the single
  `preferredLanguages` field `039-per-title-language-split` removed, not deprecated) — deliberately
  not centralised. **The per-user global level was removed by `029-settings-screen-tabs`**
  (`setPreferredLanguages`, `User.preferredLanguages` and the old `UserLanguage` table), replaced at
  the time by the installation-wide `default_languages` setting alone (see `settings/` below). **It
  came back with `021-user-preferences`**, reshaped: `UserLanguagePreference` (`preferences/` below),
  split by `kind` from the start, unlike the table `029` removed. Its rows had no encode-time reader
  until `042-encode-global-language-preferences`, which folds each owner's global rows into the same
  merge as the installation default and the per-title preference (`process-jobs/` below) — a
  `/preferences` edit now reaches the next encode of anything that user owns. Neither join table
  (`UserMovieLanguage`/`UserShowLanguage`) changed shape for the tag rework — both still reference
  `Language.id`, so a preference for a variant is the same kind of row a preference for a language
  already was.
- **`media-sources/`** — the `MediaSource` row representing one acquisition attempt. `sourceScanned`
  takes `matches: [ScannedMatchInput!]!`, one entry per file the worker resolved (a film or single
  episode reports exactly one, both numbers `null`). The service loads the source with its season's
  episodes, refuses a source targeting nothing, maps a season match to an episode by `episodeNumber`
  (skipping a mismatched `seasonNumber` or an unknown number), and writes `hasUnmatchedFiles` from
  the **video entries only** (`SourceFileInput.isVideo` — the extension list lives once, in the
  worker, on purpose). The `ERROR` branch is reached by `matches: []` **or** by every match resolving
  to nothing. The transaction, the never-reset-a-`ProcessJob`-past-`WAITING` rule and the
  enqueue-after-commit block are load-bearing. Since `052-deselected-torrent-files`,
  `hasUnmatchedFiles` also requires `SourceFileInput.isDownloaded` — a video file the torrent client
  never wrote (deselected in qBittorrent, full announced size, no real content) must not count as
  unmatched, or the cleanup verdict withholds `deleteDownloadPath` forever — and the empty-match
  `ERROR` branch picks `error.source.scan_no_downloaded_video` instead of `error.source.scan_no_video`
  when at least one reported video file was not downloaded. `downloadedFiles(source)` is a
  `@ResolveField`, not eager in `findOne` (NFR-1: one torrent-client call only for a caller that
  asks) — `null` whenever the answer isn't knowable (no `infoHash`, unknown hash, client unreachable
  or rejecting, degraded via the same try/log/return-`null` shape as `downloads/`'s
  `liveInfoForHash()`), otherwise the torrent's selected-and-complete files as paths relative to
  `downloadPath`. `api` never re-derives `isDownloaded` itself and never filters the `files` array it
  receives — the worker owns both the narrowing and the join.
- **`episodes/`** — `MoviesService`'s structural twin one level deeper: `findOneFromDb` scoped through
  `season.show.users`, plus `addTorrentToEpisode`/`addMagnetToEpisode` mirroring
  `attachTorrentSource`'s ownership lookup, a `COMPLETED`-only conflict (`force`), demote-then-replace
  and symmetric `infoHash` collision check — narrowed from "any active source conflicts" by
  `022-download-status-tags`, which lets a target hold several concurrent sources (see `downloads/`
  below). `MoviesService.attachTorrentSource`'s collision guard also
  recognises an `infoHash` owned by an **episode**, not just another movie — without that, an
  episode-owned hash falls through and gets silently re-pointed at a film. Reuses
  `shows/entities/episode.entity.ts` rather than declaring a second `Episode`.
- **`seasons/`** — the **third** structural twin of `attachTorrentSource`, same deliberate
  non-abstraction. Exactly one mutation, `addMagnetToSeason(seasonId, magnet, force)`, scoped through
  `season.show.users`, with a season-scoped conflict on `MediaSource.seasonId` and the same
  demote-on-`force` ordering (qBittorrent accepts the magnet first, *then* the previous source is
  demoted, *then* the replacement is created). No web UI by design. Its final read is a
  `season.findUniqueOrThrow` that **must `include` the episodes** — `Season.episodes` is non-null, so
  a bare row fails the mutation *after* qBittorrent already accepted the torrent, orphaning the
  download with no `MediaSource` tracking it.
- **`pipeline-status/`** — since `043-pipeline-status-normalization`, the single derivation behind
  every status a user reads: a plain exported function, no Nest module, no injection.
  `deriveSourceStatus` decides one `MediaSource`'s status from its column, its `ProcessJob` rows
  (reached via `sourceFile → processJob`, since `MediaSource` has no direct job relation) and an
  optional live torrent reading, by REQ-3's six ordered rules — used by `downloads/`. Since
  `053-downloads-panel-repair`, `SourceAltitudeJob`/`DerivedProgress` also carry `encodeSpeed:
  number | null`, surfaced **only** from Rule 3 (mean of the non-null speeds of jobs whose own
  `status === 'ENCODING'`) and `null` from every other rule — so a completed, failed, cancelled or
  not-yet-started job's stored speed is never read, by construction, not by a consumer remembering
  to clear it (REQ-10).
  `deriveTitleStatus` decides one `Movie`/`Episode`'s status as the maximum, over an eight-value
  rank ladder, of its own stored `MediaStatus` and each non-`ERROR` source's derived status — `ERROR`
  surfaces **only** from the stored column, never from a raw job/source read, so a demoted
  (`SOURCE_REPLACED`) sibling can never poison a completed title. Takes no live reading and does not
  group jobs by source (title-level `processJobs` are already denormalized to the film/episode).
  Both read `services/api/prisma/schema.prisma`'s existing enums only — no migration, no new column;
  the eight-value vocabulary (`MISSING`/`QUEUED`/`DOWNLOADING`/`PAUSED`/`DOWNLOADED`/`ENCODING`/
  `COMPLETED`/`ERROR`) is a read-time projection over `SourceStatus`/`EncodeStatus`/`MediaStatus`,
  which stay exactly as they were. `MediaSource.status` itself is **not** routed through this
  module — it stays the raw `SourceStatus` column, since the worker reads it.
- **`downloads/`** — `torrentCompleted`, called by qBittorrent's AutoRun hook. Matches **exclusively
  by infoHash** and silently ignores unknown hashes by design. An episode-owned source moves its
  `Episode` to `ENCODING` just as a movie-owned one does; a source already `ERROR` (superseded by a
  `force` replacement) is left untouched.
  Since `022-download-status-tags` this module also owns the user-facing read/control surface:
  `movieDownloads`/`showDownloads` (DB-first, scoped through the same ownership clause
  `movies/`/`shows/` use, written locally rather than imported — deliberate, see
  `010`'s triplication precedent) joined to one `torrents/info?tag=` read per title, and
  `downloadStart`/`downloadStop`/`downloadDelete`. `downloadStart`/`downloadStop` still refuse a
  source with no `infoHash` (a `LOCAL_FILE` upload) with `DOWNLOAD_NOT_A_TORRENT` before any client
  call. Since `047-source-deletion`, `downloadDelete` no longer does — it accepts any owned source,
  torrent or upload, and is the orchestrator for the whole unwind: the torrent client (only if
  `infoHash` is set, the one step that can fail the mutation), a Redis `encode:cancel` publish plus
  a queue withdrawal per `ProcessJob`, the source's downloads-side residue deleted from disk
  (confined to the downloads root via `MediaRootsService.isInsideRoot`), the row (Prisma cascades
  take `SourceFile`/`ProcessJob` with it), then the target's status recomputed from what remains —
  never walking a title with `filePath` already set backwards. The library itself is never touched
  (constitution Article XII). `DownloadsService`
  also exposes the shared race arbiter, `resolveRace(mediaSourceId)`: called from
  `torrentCompleted` **and** from `uploads/uploads.service.ts`'s `onUploadFinish` — a tus upload
  competes in the same race as any torrent of its target and never passes through this module any
  other way. Given a winner, every non-terminal sibling of the same target (`movieId`/`episodeId`/
  `seasonId`, **never** by tag) is stopped and moved to `PAUSED`, unless a sibling already reached
  `READY`/`SCANNED`, in which case the call is a no-op. `process-jobs/`'s `downloadRemove` sweeps
  the losing siblings when the winner's cleanup runs, regardless of whether the winner itself has an
  `infoHash`.
  Since `043-pipeline-status-normalization`, `Download.status`/`downloadProgress`/`encodeProgress`/
  `compressionEnabled` are produced by `pipeline-status/`'s `deriveSourceStatus` rather than copying
  `source.status` — `toDownload` loads every listed source's `ProcessJob` rows in one query (grouped
  by `mediaSourceId`, never per-row) and reads `compression_enabled` once per request alongside the
  existing `torrents/info?tag=` call. `downloadStart`/`downloadStop` also write `QUEUED`/`PAUSED` to
  the `MediaSource` row (REQ-7), guarded via `updateMany`'s `where` to the non-terminal statuses only
  — so a manual pause is visible to a reader with no live torrent data, and resuming an
  already-finished download can never regress it. `Movie.status`/`Episode.status` are mapped through
  `deriveTitleStatus` in `movies.service.ts`/`shows.service.ts`, with no extra query — both queries
  already include the `mediaSources`/`processJobs` the derivation needs. `Show.status` and
  `MediaSource.status` are unchanged (see `pipeline-status/` above). Since
  `053-downloads-panel-repair`, `liveFor`/`liveInfoForHash` lowercase both sides of every join
  against the torrent client's reported hash — `MediaSource.infoHash` can be stored either case
  (an indexer-sourced row used to be written uppercase; a legacy row may still be), qBittorrent
  reports and accepts lowercase only, and MariaDB's case-insensitive collation hid the mismatch
  from every SQL check while the in-memory join kept missing. `clients/indexer/client.ts` and
  `clients/torrent/client.ts`'s `normalizeHashes` now also write/compare lowercase at the source.
- **`process-jobs/`** — the `ProcessJob` lifecycle: `sourceScanned` → encode queued →
  `encodeCompleted`. Resolves `outputRoot` and `downloadsRoot` for the worker; `downloadsRoot` is
  `resolveFromRoot('downloads', '.')` — the **root itself**, not `path_downloads`, because a torrent's
  save path and a tus upload's staging directory sit under different segments of it.
  `resolveOutputRoot`'s film arm is the single place a film's destination is decided: since
  `048-shorts-category`, it resolves from `path_shorts` instead of `path_movies` when
  `movie.isShort && await mediaCapabilities.isShortsEnabled()`, imports `MediaCapabilitiesModule` for
  the check, and adds no lock and no snapshot of the flag — a job whose details were already handed
  out keeps whatever root it was given at that moment (REQ-13). The episode arm is untouched; a
  short is `Movie`-only, never a `Show`/`Episode` concept.
  `encodeCompleted` returns `EncodeCompletedResult` (`message`, `removeTorrent`, `deleteInputFile`,
  `deleteDownloadPath`): the cleanup verdict for the job that just finished, computed from its sibling
  jobs (a season pack shares one `MediaSource` across many jobs) and the source's
  `hasUnmatchedFiles`. A one-job source always resolves to `(true, false, true)`; a season pack's
  episodes withhold `removeTorrent`/`deleteDownloadPath` until the **last** job finishes, whatever the
  others ended as — full verdict table in `docs/spec/graphql-contract.md` § 013. `downloadRemove`
  takes `deleteFiles: Boolean = true`; the cleanup pipeline is the one caller passing `false`, since
  the worker's `cleanup-source.ts` owns every filesystem deletion.
  **Both `encodeCompleted` and `encodeFailed` are safe to receive more than once for the same job**
  (`038-encode-report-durability`, REQ-5) — the worker retries a report it could not deliver (`api`
  unreachable), so a second delivery must not double-notify the media server or re-derive a
  different verdict. Each reads the job (and its source's `status`) before writing: a repeat of an
  already-`COMPLETED` job with the same `outputFilePath` skips `notifyCreated` and the title update
  but still recomputes and returns the cleanup verdict, since the worker's first delivery may never
  have arrived. A job whose source has since been demoted to `ERROR` (REQ-8, see `uploads/` above)
  writes the `ProcessJob` row as normal but skips the `movie`/`episode` update entirely on **both**
  mutations — a demoted source's late outcome, success or failure, must not move the title the
  winner is still encoding.
  Since `053-downloads-panel-repair`, `encodeProgress` also takes an optional `speed: Float` —
  FFmpeg's own realtime multiplier, forwarded by the worker on the same throttled report — and
  persists it as `ProcessJob.encodeSpeed`; a non-finite or negative value is coerced to `null`,
  never rejected (a bad speed must not fail a report). `encodeCompleted`/`encodeFailed` both null
  it out, belt-and-braces on top of `pipeline-status/`'s Rule-3-only derivation below.
  `getEncodeJobDetails` resolves four fields, an audio pair and a subtitle pair — since
  `039-per-title-language-split` this is no longer one merged list: `allowedAudioLanguagesIso3`/
  `allowedAudioLanguageTags` and `allowedSubtitleLanguagesIso3`/`allowedSubtitleLanguageTags`. Each
  pair is the title's original language, plus the union of the installation-wide `default_languages`
  setting (unsplit — the same setting seeds both pairs), plus every owner's global
  `UserLanguagePreference` **of that kind** (`042-encode-global-language-preferences`), plus every
  owner's per-title preference **of that kind only**, deduplicated. **This is the one place the merge
  happens** — `Movie.audioLanguages`/`subtitleLanguages` and the `Show` twins deliberately return only
  the calling user's own per-title list, per kind, never the global one (`042` REQ-6). Since
  `030-language-regional-variants`, `resolveOriginalLanguage(iso2)` resolves a title's TMDB
  `originalLanguage` to `{ tag, iso3 }` via a single lookup **keyed by `tag`, not `iso2`** — a base
  row's tag is its ISO-639-1 code by construction, so this is exact where `findFirst` on the now
  non-unique `iso2` would not be: it could return a variant row for an ordinary Spanish-original title.
  `collectAllowedLanguages` produces all four fields from **one walk** building four `Set`s — original
  language and every `default_languages` entry seed all four unconditionally, each owner's global and
  per-title rows each seed only the pair matching their `kind`, through the same branch — one merge,
  not two (or four) that can drift apart. The global rows ride along on the same `userMovie`/`userShow`
  `findMany` that already fetches the per-title rows (`user: { select: { languages: {…} } }`, the
  `UserLanguagePreference` back-relation on `User`), so this costs no extra query — resolved fresh on
  every `getEncodeJobDetails` call, so a `/preferences` edit applies to anything encoded afterwards
  with no backfill. `resolveDefaultLanguages` (the renamed `resolveDefaultLanguagesIso3`) looks the
  setting's stored tags up **by `tag`**; left on `iso2` it would silently match nothing, since
  `default_languages` now stores tags. The tag lists exist so the variant survives the collapse to
  `iso3` (`es-419`/`es-ES` both resolve to `spa`); the worker has read them since
  `031-worker-language-variants`, now split per kind and routed to `getAudioParams`/`getSubtitleParams`
  respectively (`services/worker/CLAUDE.md`).
- **`ffprobe-logs/`** — an append-only diagnostic log: one row per `ffprobe` the worker runs, holding
  the probed path and the raw JSON as an opaque `MediumText` string this service never parses.
  `recordFfprobe` is the worker's write path and carries `@AllowService()`; `ffprobeLogs`,
  `ffprobeLog` and `deleteFfprobeLog` carry `@UseGuards(AdminGuard)` **per method**.
  **Do not lift `AdminGuard` to class level the way `UsersResolver` does it** — it rejects any
  principal whose `type !== 'user'`, so at class level it would also reject the worker on
  `recordFfprobe`, and the worker swallows that rejection by design (`023-ffprobe-log` NFR-1). The
  table would stay empty forever with no error anywhere. `ffprobe-logs.resolver.spec.ts` asserts the
  split off the metadata Nest actually resolves, reading the class **and** method targets, because
  nothing at runtime would surface the mistake. The model has **no relation** to `ProcessJob` or
  `MediaSource` on purpose: a cascade would delete the evidence along with the media, and the file
  path is the only (deliberately weak) join key.
- **`settings/`** — key/value settings with a typed catalog in `settings.catalog.ts` and server-side
  validation in `updateMany`. Since `029-settings-screen-tabs`, `settings`/`updateSettings` carry
  `@UseGuards(AdminGuard)` **per method** (the `ffprobe-logs.resolver.ts` split, not
  `UsersResolver`'s class-level form), and a third method, `@Public() defaultUiLocale`, deliberately
  sits outside that guard — `web` reads it while rendering `/login`, before it knows who is asking.
  The catalog's newest keys are `ui_locale` (an ordinary `kind: 'enum'` entry, options from
  `SUPPORTED_LOCALES`) and `default_languages` (a new `kind: 'languages'`, delegating to
  `LanguagesService.validateAndResolveLanguageIds` — the installation-wide replacement for the old
  per-user global language preference; see `languages/` and `process-jobs/`), plus
  `compression_enabled` (`kind: 'boolean'`, seeded `"true"` — `032-optional-compression`, beside
  `movies_enabled`/`shows_enabled`), and `kind: 'cron'` (`035-scheduled-tasks`, validated via
  `CronTime` from the `cron` package), which the eight `schedule_<id>_enabled`/`schedule_<id>_cron`
  rows use — see `scheduler/` below for what reads them. It is not read by any resolver directly: `ProcessJobsService`
  reads it off `SettingsService.getMap()` and flattens it onto `EncodeJobDetails.compressionEnabled`
  at query time, since the worker authenticates as a service principal and cannot call the
  admin-only `settings` query itself. Three more rows — `media_server_index_state`,
  `media_server_index_synced_at`, `media_server_index_count` (`034-jellyfin-library-reconciliation`)
  — are seeded but **absent from `settings.catalog.ts`**, the same non-editable treatment as
  `torrent_port`: they are state the system writes about the media-server index rebuild, not
  configuration a person sets, so `updateSettings` rejects a write to any of them with
  `error.setting.not_editable`. `MediaServerIndexService` reads and writes them through
  `prisma.setting` directly, never through `SettingsService`.
- **`preferences/`** (`021-user-preferences`, torrent-group ABM added by `044-settings-screen-polish`)
  — the caller's own settings, distinct from `settings/`'s installation-wide config: `Query.preferences`,
  `Query.torrentGroups` (no longer scoped — the catalog is one flat list, offered on both the movies
  and series tabs), `Mutation.setAllowCinemaReleases`/`setPreferredTrackLanguages`/
  `setPreferredTorrentGroups`/`setAudioMandatory`, all self-only (no operation takes a user id; every
  one carries the same explicit `principal.type !== 'user'` guard `auth.resolver.ts` uses, never
  `@AllowService()`). **The *Audio mandatory* flag has three independent scopes, not one** —
  `User.audioMandatory` (this module's `setAudioMandatory`, twin of `setAllowCinemaReleases`),
  `UserMovie.audioMandatory` (`movies/`'s `setMovieAudioMandatory`) and `UserShow.audioMandatory`
  (`shows/`'s `setShowAudioMandatory`), each its own column on its own ownership row, default `false`,
  written by a plain `update` (never an `upsert` — a row that passed the mutation's ownership check
  already exists). **Nothing reads any of the three** — `EncodeJobDetails` gains no field for it and
  `process-jobs/` never imports it; the flag is inert by requirement, not by omission (see
  `docs/spec/graphql-contract.md` § "The *Audio mandatory* flag is inert by design").
  `PreferencesService.setAllowCinemaReleases` delegates the write to `UsersService`, then re-reads;
  `setPreferredTorrentGroupsFor` is the one write this module owns directly — it resolves every id
  against `torrent_groups` before any write (`TORRENT_GROUP_NOT_FOUND`/`_DUPLICATED`, each leaving the
  stored set untouched; the old `_WRONG_SCOPE` rejection is gone — any catalog id is valid for either
  scope now), then replaces inside a `$transaction` whose `deleteMany` is narrowed to the caller **and**
  the scope directly on `user_torrent_groups.scope` — `044` moved the scope column off `TorrentGroup`
  (which only ever meant "one release-group name, admin-managed") onto `UserTorrentGroup` (a per-user,
  per-scope selection), since the same physical group can be someone's Movies pick and someone else's
  (or the same user's) Series pick. **`createTorrentGroup`/`deleteTorrentGroup`** (`044`) are this
  module's first non-self operations — both `@UseGuards(AdminGuard)`, building the catalog every other
  operation here reads from; `torrentGroups` itself stays `JwtAuthGuard`-only since any authenticated
  user needs to read the catalog to pick from it. The language half is not here:
  `setPreferredTrackLanguagesFor`/`findPreferredTrackLanguagesFor` live on `LanguagesService`, beside
  the per-title pairs, narrowed to `{ userId, kind }` for the same reason. Imports `LanguagesModule`
  and `UsersModule` (which now `exports: [UsersService]` for this).
- **`media-roots/`** — the two declared roots and every path translation. See below.
- **`media-server/`** — post-encode notification (Jellyfin today), opt-in from Settings, **plus**
  (`034-jellyfin-library-reconciliation`) reflecting what that server already holds back onto a newly
  registered title. `MediaServerReconcileService.reconcileMovie`/`reconcileShow` resolve a title's
  `tmdbId` against the configured client's `findByTmdbId` and promote `MISSING` → `COMPLETED` via an
  `updateMany` guarded by `status: 'MISSING'` in its own `where` clause — never a read-then-write,
  since that guard is what makes the promotion atomic against a concurrent `torrentCompleted` and is
  what stops a download in progress from ever being clobbered. Called from `MoviesService.register()`
  (awaited) and from `ShowsService.hydrate()`'s tail plus `ShowsService.register()`'s existing-show
  branch (both detached). `MediaServerResolver` gained `mediaServerIndexStatus`/
  `resyncMediaServerIndex`, each with its own `@UseGuards(AdminGuard)` — the existing
  `mediaServerClients` query stays unguarded.
- **`media-server-index/`** — a leaf module (imports only `RedisModule`; `PrismaService` comes from
  the global `PrismaModule`) holding the local index a client with no native provider-id filter
  (Jellyfin) needs: a `MediaServerItem` row per `(mediaType, tmdbId)` mapping to that server's own
  item id. Deliberately its own module rather than living inside `media-server/`: `SettingsResolver`
  has to trigger a rebuild and `MediaServerModule` already imports `SettingsModule`, so folding the
  index into `media-server/` would make `SettingsModule ⇄ MediaServerModule` circular.
  `MediaServerIndexService.rebuild()` claims a Redis `SET … NX` lock, enumerates the client's whole
  library via its optional `listLibrary()`, and replaces the table wholesale inside one
  `$transaction` (an explicit `timeout` — the 5s default does not survive a real library) —
  deduplicated by `(mediaType, tmdbId)` first, since a real library is not guaranteed unique there
  (two items, e.g. two versions of one film, can share a TMDB id) and an unmodified `createMany`
  would trip the composite unique constraint and fail the whole rebuild. `readState()` **derives**
  `state` rather than trusting the stored value: `syncing` reads back as `failed` when the Redis claim
  is no longer held, so a process that dies mid-rebuild does not wedge the UI on "syncing" forever.
  `clients/media-server/types.ts`'s `MediaServerClient` widened to add `findByTmdbId`,
  `listPresentEpisodes` (both required) and `listLibrary` (**optional** — a client that resolves
  provider ids natively, e.g. Emby, never implements it, and a rebuild is a no-op for it); every
  factory now takes a second argument, `MediaServerIndexPort`, the one-method port a client reaches
  for when it cannot resolve a TMDB id against the server itself.
- **`indexer/`** — Prowlarr search surface. `entities/torrent-result.entity.ts`'s `TorrentResult`
  carries a non-null `id` (display/grouping identity, never sent back) and a nullable `infoHash` —
  a search groups every Prowlarr row instead of dropping the ones missing a hash
  (`037-indexer-result-loss`); see `clients/indexer/` below for where the grouping and the
  now-lazy resolution actually happen. The read-through Redis cache (10-minute TTL, normalized
  query as key) lives in `IndexerService.search()`, not `ProwlarrClient` — `client.ts` stays a
  pure adapter, mirroring how `TmdbClient` sits below `PopularMediaService`'s own cache
  (`040-indexer-search-cache`).
- **`uploads/`** — the project's only REST route (tus); see the root `CLAUDE.md` for why.
  Authenticated **by ticket, not by `JwtAuthGuard`** (which skips non-GraphQL contexts): a signed-in
  user mints one via `createUploadTicket`, the browser sends it as `Authorization: Bearer <ticket>` on
  the tus `POST`, and `onUploadCreate` verifies and spends it exactly once via a Redis `SET … NX`
  (atomic, so two concurrent POSTs can't both win). Never re-checked on `PATCH`, by design.
  `createUploadTicket(movieId: Int, episodeId: Int, force: Boolean = false)` takes both nullable and
  requires **exactly one**; `UploadTicketsService.mint`/`verifyAndSpend` take a
  `UploadTicketTarget = { movieId } | { episodeId }`, and the target check runs **before** the Redis
  spend — a mismatch must not burn the ticket. It also requires the caller's `user_movies` link,
  calling the same `findOneFromDb` that `movie(id)` uses. `handleUploadFinish` keeps a bare
  `prisma.movie.findUnique` — not an ownership hole, since a ticket is only mintable for an owned film
  and is bound to that target. The tus metadata key names are deliberately **not** unified — see root
  `CLAUDE.md` → Known debt.
  **Replacing a `COMPLETED` film or episode** (`027-replace-completed-media`): the resolver runs a
  pre-flight conflict check *before* minting — same-shaped guard as `attachTorrentSource`'s, throwing
  `*_ALREADY_COMPLETED` when the target's `status` is `COMPLETED`. Since `022-download-status-tags`
  a merely-downloading target raises nothing at all — the guard fires only for `COMPLETED`, and the
  `*_DOWNLOAD_IN_PROGRESS` keys it used to throw otherwise no longer exist. With `force: true` the ticket mints
  and carries the flag in its signed payload; `onUploadCreate` writes a Redis marker
  (`UPLOAD_REPLACE_KEY_PREFIX`, 7-day TTL, no delete method — the TTL is the cleanup) keyed by
  `upload.id`, and `handleUploadFinish` reads that marker — **never** `upload.metadata`, which is
  client-controlled and forging it must not authorise a replacement — to decide whether to skip its
  existing `409`. Nothing here deletes a library file: the replacement encode's own atomic `rename`
  overwrites the old output in place, so no code in this module or in `process-jobs/` touches disk for
  the old file.
  **A completed upload always demotes its target's `READY`/`SCANNED` siblings** (`038-encode-report
  -durability`, REQ-6) — `demoteSupersededSources` no longer gates that on `isReplaceAuthorised`
  (which stays exactly what it was for the `COMPLETED` + `force` guard above; the two are unrelated
  checks that happened to share a method). The demotion also moves the demoted source's non-terminal
  `ProcessJob` rows to `ERROR` in the same transaction, so a superseded source cannot leave a job
  wedged in `ENCODING` with nothing consuming it (REQ-9). `handleUploadFinish` no longer swallows the
  losing side of an upload-versus-upload race: what used to be a `console.log` and a silent early
  return is now `throw new UploadHttpError(409, ERROR_KEYS.UPLOAD_SUPERSEDED)` — the browser sees a
  real error instead of a completed-looking upload that never starts encoding.
- **`scheduler/`** (`035-scheduled-tasks`) — a cron-driven registry of four tasks (`refresh_movies`,
  `refresh_shows`, `refresh_episodes`, `acquire_pending`). Three still stub `run()` returning
  `{ itemsProcessed: 0 }` — the per-task logic is deliberately out of scope for those; this module
  only owns the schedule itself. `refresh_episodes` is real since `041-episode-info-refresh`:
  `RefreshEpisodesTask.run()` selects every `Episode` whose `releaseDate` is `NULL` or on/after a
  fixed two-day-grace cutoff (UTC start-of-day, module-level constant — not a Setting), groups the
  selection by `` `${show.tmdbId}:${season.seasonNumber}` ``, and walks the groups **sequentially**
  (never `Promise.all`, same reason as `ShowsService.hydrate()`) calling `TmdbClient.seasonDetails`
  once per group and writing back only `title`/`overview`/`releaseDate` on the rows it selected — an
  episode TMDB doesn't return is left untouched and uncounted, and it never creates a row or touches
  `Season`/`Show`/`Episode.status`. A per-group TMDB failure is caught individually so the rest of the
  sweep still runs, but the handler then throws (naming the failed/succeeded counts), which is what
  makes `SchedulerService.runTask` record the run as `FAILED` rather than a silently-partial
  `SUCCESS`. Cadence and
  enablement are ordinary `settings/` rows (`schedule_<id>_enabled`/`schedule_<id>_cron`, catalog
  kind `'cron'`), not mutation arguments, so the Scheduling tab saves through the same
  `updateSettings` as every other setting; `SettingsResolver.updateSettings` calls
  `SchedulerService.arm()` after a changed `schedule_*` write re-arms `SchedulerRegistry`
  live, no restart (a `forwardRef` on both `SettingsModule` and `SchedulerModule` — each needs the
  other). `SchedulerService.runTask(id, trigger)` is the single execution path for both a cron tick
  and `Mutation.runScheduledTask` — it never rethrows (a stub or, eventually, a real handler that
  throws still leaves the process up: `AC-5`), guards concurrency with an in-memory `Set` (a
  single-process assumption, not a distributed lock — documented as a known limitation, not solved
  here), and writes one `ScheduledTaskRun` row per attempt (`finishedAt: null` is the "still
  running" marker, since `ScheduledTaskOutcome` has no `RUNNING` value). `onModuleInit` closes out
  any row still `finishedAt: null` at boot, so a crash mid-run can never permanently lock a task out
  as "already running". `scheduledTasks`/`runScheduledTask` carry `@UseGuards(AdminGuard)` **per
  method** (the `ffprobe-logs.resolver.ts` split). Since `045-media-type-availability`, a task's
  `ScheduledTaskDefinition` carries an optional `mediaType` (`refresh_movies` → movie,
  `refresh_shows`/`refresh_episodes` → show, `acquire_pending` → none, always available) and
  `ScheduledTask.available` reports whether that type is currently enabled — derived from the same
  settings map `arm()`/`runTask()`/`buildStatus()` already hold, deliberately **not** by injecting
  `MediaCapabilitiesService` (that would add a third edge to the existing `SettingsModule ⇄
  SchedulerModule` `forwardRef` cycle for two boolean reads). `arm()` skips registering a cron job
  for an unavailable task even if its own `schedule_*_enabled` is `true`; `runTask()` throws
  `SCHEDULE_TASK_UNAVAILABLE` for a `'manual'` trigger and returns silently (no run row) for a
  `'cron'` one. Flipping `movies_enabled`/`shows_enabled` through `updateSettings` now also re-arms
  the scheduler — the `scheduleChanged` guard's key list was widened to include them, so an
  administrator disabling a type doesn't leave its cron armed and firing until the next restart. The
  stored `schedule_<id>_enabled` value is never rewritten by any of this — only its *effective*
  availability changes.

**Infrastructure**: `prisma/` (`PrismaModule` + `PrismaService`, effectively global), `redis/`,
`queue/` (BullMQ producers; `queue/types.ts` is the job payload contract with the worker).

**`clients/`** is not a Nest module — plain adapter classes grouped by external system:
`clients/tmdb/`, `clients/indexer/` (`client.ts`'s `filterData` groups every raw Prowlarr row by
uppercased `infoHash`, else a 40-hex hash pulled from `guid`, else a key derived from the
normalized title and size — it issues no HTTP request beyond the one to Prowlarr; the old
eager-resolve-with-8s-timeout-then-drop behaviour and its dead scoring path (`filterIAData` and the
module that scored results by source/audio) are gone. `resolve-info-hash.ts` holds the extracted
`resolveInfoHash(urls, timeoutMs?)` —
same three-step ladder, same 8s per-URL abort — called only from the add path
(`movies`/`episodes`' `attachTorrentSource` callers) when the row the user picked has no hash yet;
it throws `error.indexer.no_infohash` rather than ever returning a falsy string, since
`attachTorrentSource`'s own `infoHash` parameter stays non-null by design), `clients/torrent/`
(qBittorrent client + `magnet.ts` parser —
since `022-download-status-tags` also `start()`, tag-aware `add()`/`info()`, and state sets brought
to qBittorrent 5.0; deliberately **no** `setForceStart`, a member with no caller; since
`052-deselected-torrent-files` also `files(hash)` — `GET torrents/files?hash=<lowercased>`, a sibling
of `info()` read the same way, throwing `TorrentClientError` on any non-2xx including a 404 for an
unknown hash — lowercasing is load-bearing, since an indexer-sourced `infoHash` is stored uppercase
and qBittorrent 404s on the mismatch), `clients/media-server/`
(with a `registry.ts`), plus the shared `clients/types.ts`.
`clients/tmdb/multi.ts` is the pure mapper for `search/multi` rows (film/series discriminated by
`media_type`, everything else dropped), used by `TmdbClient.searchMulti()`.

Loose `app.*` files at `src/` root wire it together and expose a trivial REST health item.

## Commands

Everything through `bin/npm api …` from the repo root (never bare `npm`/`npx`/`prisma`):

| Command | Purpose |
| :-- | :-- |
| `bin/npm api run start:dev` | Nest in watch mode (what the `dev` Docker stage runs) |
| `bin/npm api test` | Jest unit tests (`*.spec.ts`) |
| `bin/npm api run test:cov` | Jest with coverage, written to `coverage/` |
| `bin/npm api run test:e2e` | Jest e2e suite, config in `test/jest-e2e.json` |
| `bin/npm api run lint` | ESLint with `--fix` |
| `bin/npm api run prisma:generate` | regenerate `@prisma/client` |
| `bin/npm api run prisma:migrate` | `prisma migrate dev` — run after `bin/dbinit` on a fresh DB |

Seed data runs via `prisma/seeds/index.ts`, wired as the `seed` command in `prisma.config.ts`;
`prisma migrate dev` prompts to run it. It calls `seedLanguages`, `seedUsers`, `seedMovies`,
`seedSettings` and `seedMediaSource` in turn. `prisma/seeds/languages.ts` seeds every ISO-639-1
language keyed by its now-unique `tag`, plus two regional variants for Spanish —
`{ tag: 'es-419', iso2: 'es', iso3: 'spa' }` and `{ tag: 'es-ES', iso2: 'es', iso3: 'spa' }` — beside
the base `es` row (`030-language-regional-variants`); idempotent via `findUnique` on `tag` before
`create`, same as every other seeder here. `prisma/seeds/settings.ts` seeds
`path_downloads`/`path_movies`/`path_shows` as **segments relative to the declared roots**
(`.`/`Movies`/`Shows`), plus torrent/tracker/media-server/TMDB config keys. All create-only (checks
`findUnique` before `create`), so re-running never clobbers a real value already set through the UI.

`src/media-roots/` is the single owner of "is this path inside a declared root?" — used by settings
validation, by `QbittorrentClient` to resolve `path_downloads`, and by `ProcessJobsService` to resolve
`path_movies`/`path_shows` into the worker's `outputRoot`. `MediaRootsService.resolveFromRoot()` is
the actual traversal/symlink guard — see its doc comments and `media-roots.service.spec.ts` for the
escape suite it defends against. Since `047-source-deletion`, it also answers a plain containment
question — `isInsideRoot(rootId, absolutePath): Promise<boolean>`, built on the same
`realpath`-of-deepest-existing-ancestor check — used by `DownloadsService` to gate an on-disk delete
to the downloads root before it recurses. **Do not use `containerToHostPath` for containment**: it
returns `null` whenever `hostPath` is relative, the `.env.example` default, which would silently
refuse every path on a default install.

## Schema/enum reality check

`prisma/schema.prisma` defines exactly six enums — verify with `grep -n '^enum' prisma/schema.prisma`
rather than trusting this list:

| Enum | Values |
| :-- | :-- |
| `SourceKind` | `TORRENT_SEARCH`, `TORRENT_FILE`, `LOCAL_FILE`, `LOCAL_FOLDER` |
| `SourceStatus` | `PENDING`, `QUEUED`, `DOWNLOADING`, `PAUSED`, `READY`, `SCANNED`, `ERROR` |
| `EncodeStatus` | `WAITING`, `QUEUED`, `ENCODING`, `COMPLETED`, `ERROR` |
| `MediaStatus` | `MISSING`, `DOWNLOADING`, `ENCODING`, `COMPLETED`, `ERROR` |
| `LanguageTrackKind` | `AUDIO`, `SUBTITLE` (`021-user-preferences`) |
| `TorrentGroupScope` | `MOVIE`, `SHOW` (`021-user-preferences`) |

**There is no `MEDIA_TYPE` or `MediaType` enum**, here or anywhere in Prisma. `services/web` declares
its own `MEDIA_TYPE` (`MOVIE`/`SHOW`) in `src/types/media.ts` — a web-side type, not a database one.
A movie/show discriminator in `api` would have to be added to `schema.prisma` and migrated first.

There are 20 models and 31 migrations (counted 2026-09-11, after
`053-downloads-panel-repair`, which added no model — only `ProcessJob.encodeSpeed Float?` and a
data-only `infoHash` lowercase backfill) — verify with
`grep -c "^model " prisma/schema.prisma` rather than trusting the number. Worth knowing: the three
`*Language` join tables reference `UserMovie`/`UserShow` through their composite FK rather than
`User`+`Movie`/`Show` separately, so a language preference disappears automatically when the title
leaves the library. The three newest models — `UserLanguagePreference`, `TorrentGroup`,
`UserTorrentGroup` (`021-user-preferences`) — are the per-user counterpart: `UserLanguagePreference`
is keyed `@@id([userId, languageId, kind])`, split by `LanguageTrackKind` rather than per-title, and
`UserTorrentGroup` carries its own `scope` column (`044-settings-screen-polish` moved it here from
`TorrentGroup`, which is now just `{ id, name }`) as part of its widened `@@id([userId,
torrentGroupId, scope])` — a write scoped to one `TorrentGroupScope` narrows its `deleteMany` to
`{ userId, scope }` directly, no join needed, or it would silently wipe both scopes at once.

## Tests

- Unit specs are `*.spec.ts` colocated under `src/` (jest `rootDir: "src"`).
- E2E specs live in `test/*.e2e-spec.ts` with their own config. Note `src/auth/test/auth.e2e-spec.ts`
  is picked up by **both** configs, because the default `testRegex` also matches `e2e-spec`.

**Two styles coexist. Only one is the convention.**

Follow `src/media-roots/media-roots.service.spec.ts` and `src/clients/torrent/magnet.spec.ts`:
`describe` for the unit, `it(...)` strings in the indicative (`it('rejects a symlink pointing outside
the root')`), a header comment stating *what class of bug this defends against*, and real fixtures
where mocking would defeat the purpose — `media-roots.service.spec.ts` runs against a real `mkdtemp`
with real symlinks because a bug there is a real path traversal. Both files still have Spanish
`it(...)` strings predating Article VI: copy their *structure*, write new prose in English.

The house technique is **fault injection** — a case earns its place by being verified to fail when
the rule it covers is removed (an ownership `where` clause dropped, a `select` switched from `iso3`
to `iso2`, a demote moved after its create). Write new cases that way.

Do **not** extend or imitate `users.resolver.spec.ts` or `app.controller.spec.ts` — those 18-line
`expect(service).toBeDefined()` files are `nest g` scaffolding (Constitution, Article IX).
`src/users/users.service.spec.ts` *used to be* on that list and is now a real suite; follow it.

## Current state

As of 2026-09-11 (`053-downloads-panel-repair`): `bin/cli api npx --no tsc --noEmit`
reports **0 errors**, `bin/npm api test` is green at **460** tests across **42** suites, and
`git status --short services/api/prisma` shows a modified `schema.prisma` plus one new migration
directory (`ProcessJob.encodeSpeed Float?` and the `infoHash` lowercase data backfill — see root
`CLAUDE.md`). **Re-run both rather than trusting these numbers** — they exist so an agent can
prove a change added nothing, not as a fact to cite.

## Known debt

None currently recorded for this service.

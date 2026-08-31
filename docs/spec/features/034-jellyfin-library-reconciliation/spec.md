---
title: Reconcile a newly registered title against the media server
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-08-31
last_updated: 2026-08-31
status: Approved
services: [api, web]
---

# SPEC: Reconcile a newly registered title against the media server (`spec.md`)

## Context & Goal

Perceptor assumes it is the only way a file reaches the library. `MoviesService.register()` creates
the `Movie` row with `status` at its Prisma default, `MISSING`, and `ShowsService.hydrate()` writes
every `Episode` the same way; from there only `ProcessJobsService.encodeCompleted()` ever promotes a
row to `COMPLETED` (`services/api/src/process-jobs/process-jobs.service.ts:265-280`). That is wrong
for the ordinary case of a user who already has a Jellyfin library. They search "Rambo", add it, and
Perceptor tells them it has nothing — while the file is sitting in Jellyfin, indexed, playable, and
one directory away from where `buildOutputPath` would have written it. The user's only recourse is
to download a film they already own, or to remember which titles are which.

The stack already talks to Jellyfin, but in one direction only. `MediaServerService.notifyCreated()`
(`services/api/src/media-server/media-server.service.ts`) pushes a "there is a new file here"
notification after an encode, and the client interface behind it —
`services/api/src/clients/media-server/types.ts` — has exactly two methods, `refreshLibrary` and
`createdMedia`, both writes. Nothing ever asks the media server what it holds.

The obvious way to ask — "give me the item whose TMDB id is 1399" — **does not exist in Jellyfin**.
`ItemsController.GetItems` has no provider-id filter of any kind; the closest parameter is
`hasTmdbId=true`, which filters to items that *have* some TMDB id without letting you say which.
The feature request for it ([jellyfin#16192](https://github.com/jellyfin/jellyfin/issues/16192)) is
open and unimplemented. This is not uniform across media servers: Emby answers it natively with
`AnyProviderIdEquals=tmdb.1399`, and Plex carries the id but only as a secondary
`<Guid id="tmdb://1399"/>` entry with no server-side filter, so the community workaround there is to
enumerate the library and build a lookup. Three servers, three different answers to the same
question.

So the question belongs to the client, and the answer needs somewhere to live. This feature adds
`findByTmdbId` to the media-server client interface, and a `media_server_items` table mapping
`(mediaType, tmdbId)` to the media server's own item id. A client that can resolve the id natively —
Emby, when someone writes it — answers from the server and ignores the table. A client that cannot —
Jellyfin, Plex — enumerates the library once into the table and answers from it afterwards. Building
that index is triggered by configuring the media server in Settings, and by an explicit
**Re-sync** button beside it, since a library that grows after configuration would otherwise stay
invisible forever.

Once this ships, adding "Rambo" to a library whose Jellyfin already has it shows `COMPLETED`
immediately. Adding "Rocky", which Jellyfin does not have, shows `MISSING` exactly as today. Adding
the series "Dexter" when Jellyfin holds only S01E01 shows that one episode `COMPLETED` and every
other episode `MISSING`, so the detail page is a real inventory of what is and is not on disk rather
than a uniform wall of "missing". The **Register title in DB** row of the root `CLAUDE.md` pipeline
table gains this reconciliation; no other stage changes and `worker` is not touched at all.

Two consequences are deliberate and worth stating up front. First, the `Movie` and `Show` rows are
global (`tmdbId @unique`); ownership lives in `user_movies`/`user_shows`. A status set from the media
server is therefore visible to every user who registers the same title, which is already true of
every status this system writes. Second, a `COMPLETED` title refuses acquisition without `force`
(`movies.service.ts:322`, `episodes.service.ts:118`, `uploads.resolver.ts:61,75`), so a title
adopted from the media server behaves like a title Perceptor encoded itself: the user gets `027`'s
explicit replacement warning and can confirm through it. That is the intended behaviour, not a side
effect to work around.

## Requirements

### Functional Requirements

#### The index

- [ ] **REQ-1 (Index contents)**: The installation must keep a table mapping a media type plus a TMDB
      id to the media server's own item id, for every item in the media server's library that carries
      a TMDB id. The media type is part of the key: TMDB id `1399` identifies a different title as a
      film than as a series, and the two must never collide.
- [ ] **REQ-2 (Populated on configuration)**: Changing any of `media_server_client`,
      `media_server_host`, `media_server_port` or `media_server_api_key` to a new value must trigger a
      background rebuild of the index. Saving Settings without changing any of those four must not.
      A different host with the same client is a different library and must rebuild.
- [ ] **REQ-3 (Populated on demand)**: An administrator must be able to trigger the same rebuild
      explicitly from the Media Server tab of Settings, without changing any setting. This is the
      supported way to pick up files added to the media server after it was configured.
- [ ] **REQ-4 (Rebuild is a replacement)**: A rebuild replaces the whole index for the configured
      server. Entries from a previously configured client or host must not survive it. At no point may
      a reader observe the index as empty or half-written because a rebuild is in progress — a
      rebuild either has not landed yet or has landed whole.
- [ ] **REQ-5 (Rebuild state is recorded)**: The index must record whether its last rebuild completed,
      when it completed, and how many entries it holds. A rebuild that fails partway must leave the
      index in its previous state and be recorded as failed. A half-populated index that reads as
      complete is the failure this requirement exists to prevent.
- [ ] **REQ-6 (Rebuild state is visible)**: The Media Server tab must show the last rebuild's outcome,
      its timestamp and the entry count, so an administrator can tell a never-indexed installation
      from an up-to-date one without reading a log.
- [ ] **REQ-7 (One rebuild at a time)**: Triggering a rebuild while one is already running must not
      start a second one. The caller is told a rebuild is already in progress rather than receiving an
      error.
- [ ] **REQ-8 (Native resolution skips the index)**: A media-server client that can resolve a TMDB id
      against the server directly must be able to do so without the index, and must not be forced to
      enumerate the library to populate one it will never read. Adding Emby later must not cost a
      library enumeration.

#### The reconciliation

- [ ] **REQ-9 (Film found)**: Registering a film that the media server holds, with a real file behind
      it, must leave that film's `status` at `COMPLETED`.
- [ ] **REQ-10 (Film absent)**: Registering a film the media server does not hold must leave the film
      at `MISSING`. This feature never writes `MISSING`; absence is simply the Prisma default going
      unchanged.
- [ ] **REQ-11 (Series, per episode)**: Registering a series must reconcile **each** episode
      independently. An episode the media server holds becomes `COMPLETED`; every other episode of
      that series stays `MISSING`. A series is never reconciled as a single unit.
- [ ] **REQ-12 (Match by TMDB id only)**: A media-server item counts as the registered title only when
      its TMDB id equals the title's `tmdbId`. No title, year, path or fuzzy match is ever used, in
      either direction, at reconciliation time or while building the index. A library entry the media
      server has not identified against TMDB is invisible to this feature and its title stays
      `MISSING`.
- [ ] **REQ-13 (Episode identity)**: Within a matched series, an episode is matched by its season
      number and episode number against `seasons.seasonNumber` + `episodes.episodeNumber`. Season 0
      (specials) participates like any other season, consistent with `007`/`009` never filtering it.
- [ ] **REQ-14 (Placeholders do not count)**: A media-server item that exists as metadata only, with no
      file behind it, must not promote anything. This is not an edge case: Jellyfin's
      `TvShowsController.GetEpisodes` computes
      `shouldIncludeMissingEpisodes = (user is not null && user.DisplayMissingEpisodes) || User.GetIsApiKey()`,
      so **authenticating with an API key — which is how this installation authenticates — always
      returns virtual episodes**, regardless of any user's display preference. Filtering them out is
      mandatory, not defensive.
- [ ] **REQ-15 (Never downgrade, never clobber)**: Reconciliation may only move a row from `MISSING` to
      `COMPLETED`. A row already `DOWNLOADING`, `ENCODING`, `COMPLETED` or `ERROR` is left exactly as
      it is. A title mid-pipeline must never be disturbed by what the media server happens to report.
- [ ] **REQ-16 (No file path is recorded)**: A row promoted by this feature keeps `filePath` at `null`.
      Perceptor does not adopt, translate or store the media server's path. `filePath` continues to
      mean "a file this installation produced".
- [ ] **REQ-17 (Runs at registration)**: Reconciliation is triggered by `addMedia` and by nothing else.
      No periodic job, no scheduler, and no per-title re-check mutation. Rebuilding the index does not
      retroactively reconcile titles already registered.
- [ ] **REQ-18 (Re-registering re-reconciles)**: `addMedia` for a title already in the database must
      reconcile again, on both the new-row and existing-row branches of `register()`. Adding a title a
      second time is the user-visible way to reconcile a title that was registered before the index
      was built.
- [ ] **REQ-19 (Series reconcile after hydration)**: For a series, reconciliation must run only once
      that series' seasons and episodes exist in the database, since there is nothing to promote
      before then. It must not delay or gate `addMedia`'s response, and its outcome must not affect
      `shows.seasonsSyncedAt` — a failed reconciliation must not make the next `register()` re-fetch
      the whole catalog.
- [ ] **REQ-20 (Not configured means not attempted)**: When `media_server_client` is `none`, absent, or
      set to a client with `media_server_host` empty, no index is built, no reconciliation is
      attempted, and no error or warning noise is produced. This is the default state of a fresh
      install.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Never fails the registration)**: No media-server outcome — unreachable host, timeout,
      HTTP 401, malformed response, an unknown client id, a missing or stale index — may surface as a
      GraphQL error from `addMedia` or prevent the title from being registered and linked to the user.
      The same rule `notifyCreated` already follows, and for the same reason: a lost reconciliation is
      recoverable by adding the title again, a failed registration is not.
- [ ] **NFR-2 (Bounded)**: Every media-server request carries a timeout of 5 seconds, except the
      library enumeration of a rebuild, which is bounded at 5 minutes. Registering a title must not
      hang on an unresponsive media server.
- [ ] **NFR-3 (Bounded request count at registration)**: Reconciling a film must cost **zero**
      media-server requests when the client is index-backed — the index alone answers it. Reconciling
      a series costs one request, for that series' episode inventory. Never one request per season and
      never one per episode. The expensive enumeration happens on configuration and on the Re-sync
      button, not on the path a user waits on.
- [ ] **NFR-4 (Failure is visible)**: A rebuild or reconciliation that was attempted and failed must
      log which title or which server it was for and why, and a failed rebuild must additionally be
      visible in Settings (REQ-6). Silence is reserved for REQ-20, where nothing was attempted.
- [ ] **NFR-5 (The client contract stays uniform)**: Resolving a TMDB id to a media-server item, and
      listing a series' present episodes, are added to the `MediaServerClient` interface in
      `services/api/src/clients/media-server/types.ts`, so they are properties of "a media server" and
      not of Jellyfin specifically. Whether a client backs them with the shared index is the client's
      own business and must not appear in the interface (REQ-8). The registry
      (`clients/media-server/registry.ts`) keeps its one-line-per-server shape: adding Plex or Emby
      later must still be one new file plus one line.
- [ ] **NFR-6 (Index rebuild does not block the api)**: A rebuild runs in the background and never
      holds a request open. Saving Settings returns as fast as it does today.
- [ ] **NFR-7 (Admin-only)**: The index status query and the re-sync mutation are administrator-only,
      consistent with every other Settings operation since `029-settings-screen-tabs`.
- [ ] **NFR-8 (Tested where failure is silent)**: The matching rules — TMDB id equality including the
      media-type half of the key, the season + episode number pairing, placeholder rejection, and the
      never-downgrade guard — are owed tests under Article IX. A wrong match here marks a film
      `COMPLETED` that nobody has, and the user finds out only when they try to watch it; nothing in
      any log says anything went wrong.

## GraphQL Contract Delta

`addMedia(tmdbId, type)` keeps its exact signature and its `MediaRef` return — the reconciliation is
work `api` does behind it, and `web` needs no change for it. `Movie.status`, `Show.status` and
`Episode.status` are unchanged in type and meaning; `web` already renders every `MediaStatus` value
on the listings, the detail pages and the billboard, and never reads `filePath`
(`grep -rn filePath services/web/src` is empty). `worker` is not involved at any point.

What is new is the index's status and its manual rebuild, both for the Media Server tab of Settings:

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

`resyncMediaServerIndex` starts the rebuild in the background and returns immediately with the
status as of that moment — `state: "syncing"` on a fresh start, and the already-running status when
a rebuild is in flight (REQ-7). It never waits for the rebuild to finish.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Caller is not an administrator | `ForbiddenException` — `error.auth.admin_required` (existing) | `No tenés permisos de administrador` |
| `media_server_client` is `none`, or the chosen client has no `media_server_host` | `BadRequestException` — `error.mediaServer.not_configured` (**new key**) | `Configurá un media server antes de sincronizar la biblioteca` |
| `media_server_client` names a client not in the registry | `BadRequestException` — `error.mediaServer.unknown` (existing) | (existing copy) |

`error.mediaServer.not_configured` is the one addition to the frozen `ERROR_KEYS` vocabulary in
`services/api/src/i18n/error-keys.ts`, and needs an entry in `services/api/src/i18n/messages.en.ts`
plus `services/web/messages/{en,es}.json`.

**What `web` does with each of them.** The Media Server tab renders `mediaServerIndexStatus` beside
the existing fields and disables the Re-sync button while `state` is `syncing`. On
`error.mediaServer.not_configured` it shows the translated message inline and leaves the form
untouched — it does not retry. On `error.auth.admin_required` it falls through to the same handling
every other Settings operation already has; the tab is not reachable by a non-administrator anyway.
`state: "failed"` is rendered as a warning with the `syncedAt` of the last **successful** rebuild, not
of the failed attempt.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `MediaServerItem` (**new**, `media_server_items`) | `id Int @id @default(autoincrement())` | — | No |
| `MediaServerItem` | `mediaType String @db.VarChar(10)` — `movie` / `show`, the `MEDIA_TYPE` vocabulary already used across the GraphQL boundary | not null | No |
| `MediaServerItem` | `tmdbId Int` | not null | No |
| `MediaServerItem` | `externalId String @db.VarChar(100)` — the media server's own item id | not null | No |
| `MediaServerItem` | `createdAt DateTime @default(now())` | default | No |
| `MediaServerItem` | `@@unique([mediaType, tmdbId])` — REQ-1: the media type is half the key | — | — |
| `Setting` | three seeded, **non-catalog** rows: `media_server_index_state`, `media_server_index_synced_at`, `media_server_index_count` | seeded empty / `never` | No |

The table starts empty on every installation, existing and new, so there is nothing to backfill: a
fresh index is one rebuild away and titles registered before it are reconciled by re-adding them
(REQ-18).

The three `Setting` rows carry REQ-5's rebuild state. They are deliberately **not** added to
`SETTINGS_CATALOG` (`services/api/src/settings/settings.catalog.ts`), following the `torrent_port`
precedent of a seeded row that exists in the database but is not user-editable: they are state the
system writes, not configuration a person sets, and `updateSettings` must keep rejecting them.

No existing model, column or enum changes. `MediaStatus` gains no member: this feature writes only
the existing `COMPLETED` value.

Note for the reader: `Show.status` exists in `schema.prisma` but is written by nothing in the
codebase today and stays `MISSING` on every series. This feature does not change that — see
Out of Scope.

## Acceptance Criteria

- [ ] **AC-1**: Given a Jellyfin with a library of identified films, when an administrator sets
      `media_server_client` to `jellyfin` with a valid host and key and saves, then
      `bin/mysql -e 'select count(*) from media_server_items'` returns a non-zero count within the
      rebuild's timeout, and the Media Server tab shows the entry count and a timestamp.
- [ ] **AC-2**: Given that index, when the user adds "Rambo" and Jellyfin holds it, then the film's
      card and detail page show `COMPLETED`, and
      `bin/mysql -e "select status, filePath from movies where title='Rambo'"` returns `COMPLETED`
      with `filePath` `NULL`.
- [ ] **AC-3**: Given Jellyfin does not hold "Rocky", when the user adds it, then it shows `MISSING`
      and `bin/mysql -e "select status from movies where title='Rocky'"` returns `MISSING`.
- [ ] **AC-4**: Given Jellyfin holds the series "Dexter" with only S01E01 as a real file, when the
      user adds "Dexter" and the season hydration finishes, then the detail page shows S01E01 as
      `COMPLETED` and every other episode as `MISSING`;
      `bin/mysql -e "select count(*) from episodes e join seasons s on s.id=e.seasonId join shows sh on sh.id=s.showId where sh.title='Dexter' and e.status='COMPLETED'"`
      returns `1`.
- [ ] **AC-5**: Given files added to Jellyfin after the index was built, when the administrator presses
      Re-sync in the Media Server tab and then adds one of those titles, then the title reconciles to
      `COMPLETED` (REQ-3, REQ-18).
- [ ] **AC-6**: Given `mediaType` is half the index key, when the library contains both a film and a
      series whose TMDB ids are equal, then `bin/mysql -e 'select mediaType, tmdbId, externalId from media_server_items where tmdbId = <that id>'`
      returns two rows with different `externalId`s, and adding either title reconciles against its own
      one (REQ-1).
- [ ] **AC-7** (failure path): Given `media_server_host` points at a host that refuses connections,
      when the user adds any title, then `addMedia` returns normally within a few seconds, the title
      is registered and linked to the user, its status is `MISSING`, and the `api` log
      (`docker compose logs api`) contains one warning naming the title and the failure. No GraphQL
      error reaches the browser.
- [ ] **AC-8** (failure path): Given a populated index, when a rebuild is triggered and the media
      server dies partway through the enumeration, then `bin/mysql -e 'select count(*) from media_server_items'`
      returns the **same** count as before the attempt, the Media Server tab shows `failed` with the
      previous successful timestamp, and reconciliation keeps working against the old index (REQ-4,
      REQ-5).
- [ ] **AC-9** (failure path): Given a film whose status is `DOWNLOADING` because a torrent is in
      flight, and Jellyfin also holds that film, when a second user adds the same film, then the
      film's status is still `DOWNLOADING` — the in-flight download is not overwritten (REQ-15).
- [ ] **AC-10** (failure path): Given `media_server_client` is `none`, when an administrator presses
      Re-sync, then the mutation fails with `error.mediaServer.not_configured` and the tab shows the
      translated message in both `en` and `es`. Adding a title in that state makes no outbound HTTP
      request and logs no media-server warning at all (REQ-20).
- [ ] **AC-11**: Given Jellyfin has "Dexter" S01E02 as a virtual item with no file — which an API-key
      request returns unconditionally (REQ-14) — when the user adds "Dexter", then S01E02 is `MISSING`.
- [ ] **AC-12**: `bin/npm api run test` passes, including new specs covering TMDB-id matching with the
      media-type key, the season/episode pairing, placeholder rejection and the never-downgrade guard
      (NFR-8). `bin/npm web run build` exits 0.

## Out of Scope

- **Any status other than `COMPLETED`.** A title the media server holds is indistinguishable, from
  here on, from one Perceptor encoded itself. A new `MediaStatus` member such as `IN_LIBRARY` would
  be more honest about provenance, but it touches the enum, every `web` component that paints a
  status, and the acquisition guards in `movies`, `episodes`, `seasons` and `uploads`. Decided
  against deliberately: the ask was "completada".
- **Adopting the media server's file path.** `filePath` stays `null` (REQ-16). Storing it would need a
  `hostToContainerPath()` that `MediaRootsService` does not have — only the `containerToHostPath()`
  direction exists — and the path can legitimately fall outside both media roots, since the media
  server runs outside the stack. A force-replacement of such a title writes a new file at
  `buildOutputPath`'s location and leaves the media server's original where it is; that is accepted,
  not solved here.
- **Reconciling titles already registered when the index is rebuilt.** A rebuild updates the index, not
  the library (REQ-17). Sweeping every registered title after every rebuild is a different feature
  with its own cost and its own interaction with REQ-15.
- **Periodic re-indexing.** There is no scheduler in the stack and this feature does not add one. The
  Re-sync button is the deliberate substitute.
- **Reconciling on any path other than `addMedia`.** Opening a detail page, listing the library, or the
  billboard queries do not trigger a media-server call. Read paths stay reads.
- **`Show.status`.** It is dead today and stays dead. Rolling episode statuses up into a series-level
  status is a real feature — it needs a rule for partially-available series and for series still
  airing — and inventing one inside this change would be scope creep.
- **Emby and Plex clients.** Only `jellyfin` exists in the registry. REQ-8 and NFR-5 exist so that Emby
  can resolve natively and Plex can share Jellyfin's index strategy, but neither client is written
  here.
- **Indexing anything other than TMDB ids.** IMDb and TVDB ids are in the same provider payload and are
  deliberately not stored. Perceptor's catalog is TMDB (`005`, `006`); a second id vocabulary would be
  a second matching rule with nothing to match against.
- **Deleting or unlinking a title that vanished from the media server.** This feature only ever
  promotes. A title whose file is later removed keeps its `COMPLETED` status; nothing demotes it.

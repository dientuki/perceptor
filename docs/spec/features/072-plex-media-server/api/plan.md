---
title: Plex media server client — api slice
service: api
last_updated: 2026-09-26
status: Approved
---

# PLAN: Plex media server client — `api` (`api/plan.md`)

## Scope

`api` owns both halves of the contract and the registry that feeds them: a new Plex client
implementing the existing `MediaServerClient` port, three descriptive fields on `MediaServerOption`,
a `layout` declaration per registry entry, and the resolution of that layout onto
`EncodeJobDetails.libraryLayout`.

It is explicitly **not** doing: any path building (the worker owns `paths/`, and `api` never learns
what a layout string means beyond passing it on), any Settings UI (`web`), and any change to the
consumers of `createMediaServerClient` — `MediaServerService`, `MediaServerReconcileService`,
`MediaServerIndexService` and `SettingsResolver`'s rebuild trigger are correct as written and must
come out of this feature untouched. There is no migration and no seed change.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/clients/media-server/plex.ts` | New | The Plex client: pure mappers plus `createPlexClient` |
| `services/api/src/clients/media-server/plex.spec.ts` | New | Unit tests for the three pure mappers |
| `services/api/src/clients/media-server/registry.ts` | Modified | The `plex` entry; `layout`, `defaultPort`, `credentialLabel`, `credentialHelpUrl` per entry; `MEDIA_SERVER_OPTIONS` carries them through |
| `services/api/src/clients/media-server/types.ts` | Modified | `LibraryLayout` union + `DEFAULT_LIBRARY_LAYOUT`; the registry entry's declared shape |
| `services/api/src/media-server/entities/media-server-option.entity.ts` | Modified | Three nullable `@Field`s |
| `services/api/src/media-server/media-server.service.ts` | Modified | One method: resolve the configured client's layout (see step 5) |
| `services/api/src/media-server/media-server.service.spec.ts` | New | Layout resolution, including the `none` and unknown-id cases |
| `services/api/src/process-jobs/entities/encode-job-details.entity.ts` | Modified | `libraryLayout: String!` |
| `services/api/src/process-jobs/process-jobs.service.ts` | Modified | Resolve `libraryLayout` into the `base` object |
| `services/api/src/process-jobs/process-jobs.service.spec.ts` | Modified | A `getEncodeJobDetails — libraryLayout` describe block |

`schema.gql` regenerates on boot (Article IV) — never hand-edit it.

## Existing code to reuse

- `src/clients/media-server/jellyfin.ts` — the shape to follow exactly: pure exported mappers
  (`toLibraryEntries`, `toPresentEpisodes`) tested without a network, a `create…Client` closure over
  `config`, `READ_TIMEOUT_MS` vs `LIST_LIBRARY_TIMEOUT_MS`, paginated enumeration, and error strings
  that quote the status and body but never the request URL. Plex's client is the same file with
  different endpoints.
- `src/clients/media-server/types.ts` — `MediaServerClient`, `MediaServerConfig`,
  `MediaServerIndexPort`, `MediaServerLibraryEntry`, `MediaServerEpisodeRef`, `MEDIA_SERVER_NONE`.
  All reused as-is; `MediaServerConfig` needs no new field.
- `src/clients/media-server/registry.ts` — `MEDIA_SERVERS`, and the derived `MEDIA_SERVER_OPTIONS` /
  `MEDIA_SERVER_IDS`. Extend the entry shape; do not add a parallel map.
- `src/settings/settings.catalog.ts` — `media_server_client: { kind: 'enum', options: MEDIA_SERVER_IDS }`
  already derives from the registry. **Nothing to change here**; adding the registry entry is what
  makes `plex` a valid stored value.
- `src/process-jobs/process-jobs.service.ts` — `getEncodeJobDetails`'s `base` object and its single
  `await this.settings.getMap()`. `libraryLayout` goes in `base` next to `compressionResolution`; do
  not add a second `getMap()` call.
- `src/media-server/media-server.service.ts` — already holds `SettingsService` and is already the
  module `ProcessJobsService` injects (`private readonly mediaServer: MediaServerService`). The
  layout resolver belongs here, which is why no new module or provider is needed.
- `src/clients/media-server/jellyfin.spec.ts` — the Article IX header style: a paragraph naming the
  silent failure, then cases that were each verified to fail when their rule is removed.

## Steps

1. **`types.ts`** — add `export type LibraryLayout = 'jellyfin' | 'plex'` and
   `export const DEFAULT_LIBRARY_LAYOUT: LibraryLayout = 'jellyfin'`. Widen the registry entry's
   declared shape to `{ label, create, layout, defaultPort, credentialLabel, credentialHelpUrl? }`.
2. **`plex.ts`** — three pure, exported mappers first, each testable with no network:
   - `toLibraryEntries(items, mediaType)` — pulls the TMDB id from `Guid[]` (`tmdb://<id>`) or a
     legacy `guid` (`com.plexapp.agents.themoviedb://<id>`), drops anything with neither, keeps
     `ratingKey` as `externalId` (REQ-9).
   - `toPresentEpisodes(items)` — keeps an episode only when it has a `Media[].Part[].file` and both
     `parentIndex` and `index` (REQ-11).
   - `chooseSectionForPath(sections, filePath)` — longest matching `Location.path` prefix, on a
     path-separator boundary so `/media/movies-4k` never matches `/media/movies`; `null` when none
     matches (REQ-6).
   Then `createPlexClient(config, index)` returning the five-method client: `refreshLibrary`
   (`/library/sections/all/refresh`), `createdMedia` (list sections → `chooseSectionForPath` →
   `GET /library/sections/{key}/refresh?path=<url-encoded directory>`, falling back to
   `refreshLibrary()` **and logging that it did** when the chooser returns null),
   `findByTmdbId` (delegates to `index.lookup`, REQ-10), `listPresentEpisodes`
   (`/library/metadata/{ratingKey}/allLeaves`), and `listLibrary` (every section of type `movie` and
   every section of type `show` — there may be several of each — via
   `/library/sections/{key}/all?includeGuids=1`, paginated with the `X-Plex-Container-Start` /
   `X-Plex-Container-Size` headers). Every request sends `X-Plex-Token` and `Accept: application/json`
   as **headers** (REQ-5). `LIST_LIBRARY_TIMEOUT_MS` for `listLibrary`, `READ_TIMEOUT_MS` for the rest
   (NFR-5).
3. **`registry.ts`** — uncomment and fill the `plex` entry; add `layout`/`defaultPort`/
   `credentialLabel`/`credentialHelpUrl` to `jellyfin` too. Jellyfin: `jellyfin` / `8096` / `API key`.
   Plex: `plex` / `32400` / `Plex token` /
   `https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/`.
   `MEDIA_SERVER_OPTIONS` carries the new keys through for the `none` row as `null`.
4. **`media-server-option.entity.ts`** — `@Field(() => Int, { nullable: true }) defaultPort`,
   `@Field(() => String, { nullable: true }) credentialLabel`,
   `@Field(() => String, { nullable: true }) credentialHelpUrl`.
5. **`media-server.service.ts`** — add `async resolveLibraryLayout(settingsMap): Promise<LibraryLayout>`
   (or taking no argument and reading the map itself — but `ProcessJobsService` already has the map,
   so prefer the argument form and keep the single read). It returns the configured client's declared
   layout, and `DEFAULT_LIBRARY_LAYOUT` when the client is missing, `none`, or an id in no registry
   entry (REQ-15). It must not throw for an unknown id — unlike `createMediaServerClient`, whose
   `error.mediaServer.unknown` is correct for a caller trying to *use* the client.
6. **`encode-job-details.entity.ts`** — `@Field() libraryLayout: string;`
7. **`process-jobs.service.ts`** — resolve it into `base` from the `settingsMap` already in hand.
8. Tests (below), then confirm `schema.gql` regenerated to exactly the four fields.

## Contract obligations

From `../spec.md` § GraphQL Contract Delta, read-only:

```graphql
type MediaServerOption { id: ID!  label: String!  defaultPort: Int  credentialLabel: String  credentialHelpUrl: String }
type EncodeJobDetails { libraryLayout: String! }
```

- `defaultPort`/`credentialLabel`/`credentialHelpUrl` are **nullable** — `none` has none of them.
- `libraryLayout` is **`String!`, not an enum**, and is **always sent**: `jellyfin` or `plex` today,
  `jellyfin` when nothing is configured. Resolved at query time, never written to the `ProcessJob`.
- No new error key. `error.mediaServer.unknown` and `error.mediaServer.not_configured` keep their
  current behaviour and their current throw sites; do not add a third.
- `mediaServerClients` stays **unguarded** (the per-method guard pattern in
  `media-server.resolver.ts`) — it feeds the Settings combo before anything is configured.

If any of this looks wrong from inside `api`, stop and report. Do not adjust it locally
(Article VIII).

## Tests

Owed under Article IX — each of these fails silently:

- `src/clients/media-server/plex.spec.ts` — the three pure mappers. A wrong field name yields an
  empty list, not an error: the index then "successfully" builds with zero entries and every title
  reads `MISSING` forever, which is also the correct output for an empty library. Cover: modern
  `tmdb://` GUID, legacy agent GUID, an item with neither, an item with a non-numeric id; an episode
  with no `Part`, one with no `file`, one missing `parentIndex`/`index`; and for the chooser, longest
  prefix wins, shared-prefix sibling refused, no match → null. Each case must be verified to fail
  when its rule is removed. Open with the Article IX header paragraph.
- `src/media-server/media-server.service.spec.ts` — layout resolution for `jellyfin`, `plex`, `none`,
  a missing row and an unknown id. A wrong answer here files every encode under the wrong layout with
  no error anywhere.
- `src/process-jobs/process-jobs.service.spec.ts` — a `libraryLayout` describe block mirroring the
  existing `compressionResolution` one, asserting the value rides `EncodeJobDetails` for both the
  movie and episode branches.

**Not owed**: the `MediaServerOption` entity fields (a GraphQL field that fails to serialize fails
loudly, and `schema.gql` is the check), and `registry.ts` itself (a missing entry means the combo
lacks a row — immediately visible, AC-1).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
git status --short services/api/prisma        # empty — no migration (NFR-1)
git diff services/api/src/schema.gql          # exactly the four fields
```

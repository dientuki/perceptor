---
title: Plex media server client
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-09-26
last_updated: 2026-09-26
status: Implemented
services: [api, web, worker]
---

# SPEC: Plex media server client (`spec.md`)

## Context & Goal

Perceptor already knows how to talk to a media server, but it only knows one. `034-jellyfin-library-reconciliation`
built the seam for exactly this moment: `services/api/src/clients/media-server/types.ts` declares a
five-method `MediaServerClient` port, `registry.ts` maps an id to a factory, and the comment at the
top of that registry promises that adding a server is "escribí `clients/media-server/<nombre>.ts` …
y sumá UNA línea acá". The registry even carries the commented-out `plex:` line. Everything
downstream — the `media_server_client` enum in `settings.catalog.ts`, its server-side validation,
the `mediaServerClients` query, the Settings combo in `MediaServerFields.tsx`, the shared index in
`media-server-index/`, and the promote/demote reconciliation in `media-server-reconcile.service.ts`
— is derived from that map and stays untouched by a second entry. A Plex user today picks "Ninguno"
and loses the whole media-server half of the product: no library notification after an encode, no
`COMPLETED`/`MISSING` reconciliation at registration, and no Refresh outcome on a title's detail
page (`069`).

Three things do not fit the "one line" promise. **The connection defaults differ**: Jellyfin listens
on 8096 and calls its credential an API key; Plex listens on 32400 and calls its credential an
`X-Plex-Token`. Today `MediaServerFields.tsx` renders a hardcoded "API key" label and the port comes
from a single stored value seeded to 8096, so a Plex admin is told to fill in a field that does not
exist in their product and is handed the wrong port. **The notify call is not path-addressed** the
way Jellyfin's `Library/Media/Updated` is: a Plex partial scan is scoped to a *library section*
(`GET /library/sections/{id}/refresh?path=<folder>`), so the client has to discover which section
owns the file it was just handed before it can ask for the cheap scan.

**And the files themselves are named for Jellyfin.** `services/worker/src/paths/build-output-path.ts`
writes `Alita Battle Angel (2019) [tmdbid=299534]/Alita Battle Angel (2019).mkv` — the square-bracket
provider-id syntax is Jellyfin's, and Plex's own naming documentation warns that square brackets can
produce wrong matches. Plex wants `{tmdb-299534}`. The id tag exists precisely so matching does not
depend on the title string; against Plex it currently contributes nothing and may actively mislead
the scanner. This is where the feature reaches the worker, and the shape it takes matters: the
worker must not learn the roster of media servers. It learns **layouts**. The registry declares
which layout each client wants, `api` resolves that onto the encode job the same way it already
resolves `outputRoot`, `compressionResolution` and `allowedSubtitleFormats`, and the worker picks a
path builder from a value it treats as opaque data — defaulting and logging, never failing, when it
does not recognise one. A layout is a property shared by servers, not a synonym for one: Emby will
reuse Jellyfin's, and that day is one line in `api` and nothing at all in the worker.

Pipeline stages affected: **Notify media server**, which gains a second client behind the unchanged
`MediaServerService` / `MediaServerReconcileService` / `MediaServerIndexService` surface, and
**Transcode**, whose destination path becomes layout-aware while staying, as it is today, an `api`
decision the worker consumes blindly. **Browse library** is affected only indirectly: a Plex
installation starts getting the same `COMPLETED`/`MISSING` truth a Jellyfin one already gets. No
pipeline stage is added or removed.

Three decisions were taken with the user while writing this spec: the credential is a token the
admin pastes (no plex.tv sign-in flow); the four `media_server_*` settings stay shared across
clients rather than namespaced per client; and the worker receives a layout name rather than a
client id or a bag of rendered naming tokens.

## Requirements

### Functional Requirements

#### The client

- [ ] **REQ-1 (Registry entry)**: `plex` must be a selectable media-server client everywhere the
      registry already feeds — the `media_server_client` setting's accepted values, its server-side
      validation, and the Settings combo — with no list of client ids written by hand in `web`.

- [ ] **REQ-2 (Per-client connection hints)**: Each client in the registry must declare its default
      port and the human name of its credential; `none` declares neither. The Settings screen must
      render the credential field with the selected client's own name for it (Jellyfin: `API key`,
      Plex: `Plex token`) rather than one hardcoded label.

- [ ] **REQ-3 (Default port on switch)**: Changing the client in the Settings combo must replace the
      port input's value with the newly selected client's default port, before anything is saved, so
      the admin can still edit it and nothing is written until Save. Loading the screen must show the
      stored port, never a default that overwrites it.

- [ ] **REQ-4 (Credential help)**: A client may declare a documentation URL for obtaining its
      credential; when present the Settings screen must link to it next to the credential field. Plex
      declares the official "Finding an authentication token" article.

- [ ] **REQ-5 (Authenticated as Plex expects)**: Every request the Plex client makes must carry the
      token in the `X-Plex-Token` **header** and ask for `Accept: application/json`. The token must
      never appear in a URL, a query string, a log line, or a GraphQL response.

- [ ] **REQ-6 (Notify a new file)**: Given a host-side file path, the Plex client must ask Plex to
      scan the narrowest thing that contains it: list the server's library sections, choose the
      section whose configured location is the longest prefix of that path, and request a partial
      scan of the file's own directory within it. If no section's location contains the path, it must
      fall back to refreshing every section rather than doing nothing, and must say in the log that
      it did. A Plex running with different filesystem mounts than Perceptor's host paths is the
      expected cause of that fallback, not a bug.

- [ ] **REQ-7 (Refresh the library)**: The client's whole-library refresh must ask Plex to refresh
      every section.

- [ ] **REQ-8 (Enumerate for the index)**: The client must be able to enumerate the whole library
      into the `(mediaType, tmdbId, externalId)` entries the shared index stores: every section of
      type movie and every section of type show — an installation may legitimately have several of
      each — paginating rather than requesting an unbounded list. An item Plex has not matched to
      TMDB must be dropped, never coerced to a fabricated id. The same title appearing in two
      sections must not fail the rebuild.

- [ ] **REQ-9 (Both GUID shapes)**: A TMDB id must be recognised both from Plex's modern external
      GUID list (`tmdb://<id>`) and from a legacy agent GUID (`com.plexapp.agents.themoviedb://<id>…`).
      An item carrying neither is not in the index.

- [ ] **REQ-10 (TMDB lookup)**: Resolving a TMDB id to a Plex item must go through the shared index,
      the same as Jellyfin — Plex offers no dependable server-side filter by external GUID, so this
      client is index-backed and participates in every rebuild.

- [ ] **REQ-11 (Present episodes)**: For a matched series the client must report every episode that
      actually has a file on disk, identified by season and episode number. An episode Plex lists
      without a playable file, or without both numbers, must not be reported as present.

- [ ] **REQ-12 (Index is per-configuration)**: Switching the configured client (or its host, port or
      token) must leave no entry of the previous server's library answering lookups once the rebuild
      that the change already triggers completes.

- [ ] **REQ-13 (Failure is an outcome, not an error)**: An unreachable Plex, a rejected token, or a
      malformed response must leave the notify path silent-but-logged (never failing a finished
      encode), leave the index rebuild in `failed` with the previous index intact, and leave
      reconciliation writing nothing — exactly the posture Jellyfin has today.

#### The library layout

- [ ] **REQ-14 (Layout declared per client)**: Every registry entry must declare the library layout
      its server expects. `jellyfin` declares the Jellyfin layout, `plex` the Plex layout. Two clients
      may declare the same layout; that is the mechanism by which a future Emby entry costs one line.

- [ ] **REQ-15 (Layout reaches the encode job)**: `EncodeJobDetails` must carry the configured
      client's layout, resolved when the worker asks for the job's details and never frozen onto the
      `ProcessJob` row — the same rule `contentKind`, `compressionEnabled`, `compressionResolution`
      and `allowedSubtitleFormats` already follow. With no media server configured (`none`), the
      layout must be the Jellyfin one, which is what every installation writes today.

- [ ] **REQ-16 (Jellyfin layout unchanged)**: The Jellyfin layout must produce byte-for-byte the
      paths `build-output-path.ts` produces today, including the `(0000)` year fallback, the
      title sanitisation rules and the season-folder padding. No existing installation may see a file
      land under a different name because of this feature.

- [ ] **REQ-17 (Plex layout)**: The Plex layout must write, for a film:
      `<outputRoot>/<Title> (<Year>) {tmdb-<id>}/<Title> (<Year>) {tmdb-<id>}.mkv` — the id tag on
      both the folder and the file, because Plex reads the folder first and the filename as fallback
      and its documentation recommends they match. For an episode:
      `<outputRoot>/<Title> (<Year>) {tmdb-<id>}/Season <NN>/<Title> - S<NN>E<NN> - <Episode title>.mkv`,
      with the ` - <Episode title>` segment omitted when the episode has no title. Season 0 files
      under `Season 00`, which Plex accepts for specials. Title sanitisation, the `(0000)` fallback
      and the source-extension rule for an uncompressed pass-through apply identically to both
      layouts.

- [ ] **REQ-18 (Unknown layout never fails an encode)**: An absent or unrecognised layout value must
      make the worker use the Jellyfin layout and log, never throw — the posture already established
      for `contentKind` and `compressionResolution`.

- [ ] **REQ-19 (Nothing already written is renamed)**: Changing the configured media server must
      never rename, move or re-file anything already in the library. Only files written after the
      change use the new layout; a library that predates it stays mixed, and correcting an old title
      is the user's own action in their media server.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No schema change)**: No Prisma model, column or migration. `MediaServerItem` already
      stores `externalId` as an opaque string; a Plex `ratingKey` fits it unchanged.

- [ ] **NFR-2 (No new settings keys)**: The four `media_server_*` keys stay as they are and stay
      shared across clients. An installation that switches from Jellyfin to Plex re-enters host, port
      and token; nothing is namespaced, nothing is backfilled.

- [ ] **NFR-3 (The worker knows layouts, never clients)**: No client id, host, port, token or
      media-server concept may reach `services/worker`. It receives a layout name and treats it as
      opaque data. Adding a media server that reuses an existing layout must require no worker change
      at all.

- [ ] **NFR-4 (Existing installs unchanged)**: The seeded default port stays 8096 and the seeded
      client stays `none`, so no existing Jellyfin installation changes behaviour on upgrade —
      neither its connection settings nor the names of the files it writes (REQ-16).

- [ ] **NFR-5 (Timeout posture mirrored)**: The whole-library enumeration gets the long timeout the
      index rebuild is designed around; every other call gets the short, user-facing one. A large
      library must not race a short timeout, and a request/response call in a registration flow must
      not hang on a dead host.

- [ ] **NFR-6 (Tested where failure is silent)**: The GUID extraction, the section-for-path choice,
      the present-episode filter and both layout builders must be unit-tested against real response
      shapes and real titles. Each is a place where a wrong answer produces no error anywhere: a
      dropped GUID silently leaves a title `MISSING` forever, a wrong section silently scans the
      wrong folder, a missing present-episode filter silently marks an empty series `COMPLETED` (the
      exact bug `034` hit with Jellyfin's virtual episodes), and a layout regression silently files a
      correct encode where no scanner will match it.

## GraphQL Contract Delta

One existing type gains three fields; one gains a field. No new query, mutation, argument or error
key.

```graphql
type MediaServerOption {
  id: ID!
  label: String!
  defaultPort: Int
  credentialLabel: String
  credentialHelpUrl: String
}

type EncodeJobDetails {
  libraryLayout: String!
}
```

`MediaServerOption`'s three new fields are nullable because `none` is a real option of this list and
has no connection settings at all. `web` must treat a null `defaultPort` as "leave the port input
alone" and a null `credentialLabel` as "the credential field is not shown" — already the case, since
the connection fields only render when the selection is not `none`.

`label`, `credentialLabel` and `credentialHelpUrl` are sent from `api` as literal strings, not i18n
keys — the same as the existing `label: 'Jellyfin'`. They are product nouns and URLs, not translated
copy.

`EncodeJobDetails.libraryLayout` is non-null and always sent: `jellyfin` or `plex` today, `jellyfin`
when no media server is configured. It is `String!`, not an enum, for the same reason
`MediaServerIndexStatus.state` is a string in `web`'s types — there is no codegen across this
boundary, and a third layout added later must reach an old worker as an unrecognised value it
degrades on (REQ-18), not as a deserialisation failure.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `media_server_client` saved with an id in no registry entry | `BadRequestException` — `error.mediaServer.unknown` (existing) | `El media server "{id}" no existe` |
| Re-sync requested with no client, or with a client and no host | `BadRequestException` — `error.mediaServer.not_configured` (existing) | `Configurá un media server antes de sincronizar la biblioteca.` |
| Plex unreachable / token rejected during a rebuild | none — not an error | The index panel reads `Última sincronización fallida`; the previous index keeps answering |
| Plex unreachable / token rejected during a notify | none — not an error | Nothing; the encode stays `COMPLETED` and the failure is logged server-side |
| `libraryLayout` absent or unrecognised by the worker | none — not an error | Nothing; the file is written with the Jellyfin layout and the worker logs the value it did not recognise |

`web` already handles both existing keys (`MediaServerFields.tsx`'s re-sync panel surfaces the
second one, `actions/settings.ts` the first) and must keep doing so unchanged. `worker` must add
`libraryLayout` to the encode-job query it retypes by hand; a worker that does not ask for the field
gets REQ-18's fallback and keeps working, which is the intended degradation.

## Data Model Changes

None.

## Acceptance Criteria

- [ ] **AC-1**: With the stack running, the Settings → Media server combo lists `Ninguno`,
      `Jellyfin` and `Plex`, and `mediaServerClients` returns the same three with `plex` carrying
      `defaultPort: 32400` and a non-null `credentialLabel`.
- [ ] **AC-2**: Selecting `Plex` in the combo changes the port input to `32400` and the credential
      field's label to `Plex token` with a link beside it; selecting `Jellyfin` changes them to
      `8096` and `API key`. Reloading the page after saving shows the port that was saved, not the
      default.
- [ ] **AC-3**: With `Plex` selected, a reachable host and a valid token, pressing **Re-sync** moves
      the index status to `Sincronizando…` and then to `Actualizada` with an item count matching the
      number of TMDB-matched films plus series in that Plex library
      (`bin/mysql -e 'select mediaType, count(*) from MediaServerItem group by mediaType'`).
- [ ] **AC-4**: Registering a film that Plex already holds leaves it `COMPLETED` rather than
      `MISSING` on `/movies/<id>`, with no download ever started.
- [ ] **AC-5**: Registering a series Plex holds partially marks exactly the episodes with a file as
      `COMPLETED` and leaves the rest `MISSING`; a series Plex holds with no files at all stays fully
      `MISSING`.
- [ ] **AC-6**: With `Plex` configured, finishing an encode for a film writes
      `<root>/Some Film (2019) {tmdb-12345}/Some Film (2019) {tmdb-12345}.mkv`, and the file appears
      in Plex without a manual scan; the api log names the section that was scanned.
- [ ] **AC-7**: With `Plex` configured, finishing an encode for an episode writes
      `<root>/Some Show (2021) {tmdb-999}/Season 01/Some Show - S01E02 - The Gold Mine.mkv`, and Plex
      matches it to the right episode.
- [ ] **AC-8**: With `Jellyfin` configured — or with `none` — the same two encodes write exactly the
      paths they write on `master` today (`Some Film (2019) [tmdbid=12345]/Some Film (2019).mkv` and
      `Some Show (2021) [tmdbid=999]/Season 01/Some Show S01E02 The Gold Mine.mkv`).
- [ ] **AC-9 (failure)**: With `Plex` selected and a deliberately wrong token, **Re-sync** leaves the
      index panel reading `Última sincronización fallida`, `select count(*) from MediaServerItem`
      returns the same count it had before, and no GraphQL error reaches the Settings screen other
      than the panel's own state.
- [ ] **AC-10 (failure)**: With `Plex` configured and its host stopped, finishing an encode still
      leaves the job `COMPLETED` and the title's file in place; the api log carries one
      `[media-server]` failure line and no `encodeFailed` is reported.
- [ ] **AC-11 (failure)**: A file written to a path under no Plex library location still produces a
      scan request — the whole-library fallback — and the api log says the fallback was taken.
- [x] **AC-12 (failure)**: An encode whose job details carry a `libraryLayout` of `not-a-layout`
      completes, writes the Jellyfin-layout path, and logs the unrecognised value.
- [ ] **AC-13**: Switching the configured client from Jellyfin to Plex and letting the automatic
      rebuild finish leaves `MediaServerItem` holding only Plex `externalId`s
      (`bin/mysql -e 'select externalId from MediaServerItem limit 5'` shows numeric rating keys, not
      Jellyfin GUID hex strings). Files written before the switch keep their old names on disk.
- [x] **AC-14**: `git status --short services/api/prisma` shows no migration, and the `schema.gql`
      diff is exactly the three new fields on `MediaServerOption` plus `libraryLayout` on
      `EncodeJobDetails`.

## Out of Scope

- **A plex.tv sign-in flow.** The admin pastes an `X-Plex-Token`, decided explicitly. Signing in
  against plex.tv to mint one would add an external auth flow, 2FA handling and a second credential
  to store, for a value that is copied once per installation.
- **Per-client stored configuration.** Host, port and token stay one shared set (NFR-2). Keeping a
  Jellyfin config and a Plex config side by side would mean new settings keys, a backfill, and a
  settings catalog that is no longer a fixed list — worth doing the day someone actually runs both.
- **Renaming a library that predates the switch** (REQ-19). Article XII: Perceptor writes to the
  destinations root and never removes from it, and `048` already settled that reclassifying a title
  never moves a file already written. A re-file pass would be its own feature with its own answer to
  "what happens when the move fails halfway".
- **`refreshLibrary` staying uncalled.** It has had no production caller since `034` and Plex will
  implement it anyway, decided with the user. Removing it from the port is a separate cleanup.
- **Plex Watchlist, collections, playlists, users or sharing.** This feature implements the existing
  five-method port and nothing beyond it.
- **Emby.** Its `AnyProviderIdEquals` filter is the reason `listLibrary` is optional on the port
  (REQ-8 of `034`), and it would reuse the Jellyfin layout (REQ-14) — but nobody has asked for it and
  an unexercised third client is speculation.
- **Deleting from Plex.** Article XII: a demotion to `MISSING` is a status write in Perceptor's own
  database, never a delete against the media server.
- **Any `docker-compose.yaml` change.** Plex, like Jellyfin, runs outside this stack; that is why the
  notify path translates a container path to a host path before sending it.

---
title: Season Pack Acquisition UI
spec_version: 0.2.0
author: Juan Farias
created_at: 2026-09-16
last_updated: 2026-09-17
status: Implemented
services: [api, web]
---

# SPEC: Season Pack Acquisition UI (`spec.md`)

## Context & Goal

`013-season-pack-processing` made a season pack processable end to end — one download fans out into
one `ProcessJob` per episode — and added `addMagnetToSeason(seasonId, magnet, force)` as the minimal
trigger that made that pipeline reachable. Its Out of Scope said so explicitly: the mutation "has no
web UI by design; a season-request screen is a later feature". This is that feature. Today the root
`CLAUDE.md` still lists "acquiring a season pack is api-only (`addMagnetToSeason`), with no web UI"
as one of its two known gaps, and the only way to request a whole season is a hand-written GraphQL
call.

On `/shows/<id>`, `services/web/src/components/shows/SeasonAccordion.tsx` renders one accordion per
season whose header is just the "Temporada N" label, and one row per episode carrying three buttons
— search, import file, add magnet — wired through `SearchTorrentModal`, `ImportFileModal` and
`ImportMagnetModal` to `addTorrentToEpisode`/`createUploadTicket`/`addMagnetToEpisode`. Those modals
take an `AcquisitionTarget` (`services/web/src/types/media.ts`) that is either a film or an episode;
there is no season branch. On the `api` side, `SeasonsService` (`services/api/src/seasons/`) is the
third structural twin of `MoviesService`/`EpisodesService.attachTorrentSource`, but exposes only the
magnet entry point: there is no `addTorrentToSeason`, so a release picked from the indexer cannot be
attached to a season at all.

A second gap becomes visible the moment the button exists. A season-scoped `MediaSource` carries
`seasonId` and no `episodeId`; the per-episode `ProcessJob`s only appear once the worker has scanned
the finished download. Episode status is derived at read time (`deriveTitleStatus`,
`services/api/src/pipeline-status/pipeline-status.ts`, `043-pipeline-status-normalization`) from the
episode's own sources and jobs only — so for the whole duration of a pack download every episode of
the season keeps reading `MISSING`, and a user who just clicked "download season" sees nothing change
on the page. This feature makes a season's active pack count toward each of its episodes until the
scan takes over.

Once this ships, the season accordion header carries the acquisition buttons for the whole season,
search and magnet work end to end, and the **Find release** and **Download** rows of the root
`CLAUDE.md` cover a season as well as a film and an episode. The "season pack is api-only" gap is
removed from the root `CLAUDE.md`.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Season-level buttons)**: Each season accordion header on `/shows/<id>` must show
      acquisition buttons for the whole season beside the "Temporada N" label, in the same order and
      with the same icons as an episode row: search, import file, add magnet. Clicking any of them
      must not expand or collapse the accordion.
- [x] **REQ-2 (Import file is rendered disabled)**: Importing a local file for a whole season is not
      part of this feature (§ Out of Scope). The season-level "import file" button must be rendered
      in its place but disabled: it opens nothing and fires no request. The next spec wires it.
- [x] **REQ-3 (Magnet for a season)**: The magnet button must open the existing magnet modal against
      the season and submit through `addMagnetToSeason`. The modal must identify the target as
      "<Show> Temporada N" (the label `DownloadsService` and `SeasonsService` already use).
- [x] **REQ-4 (Search for a season)**: The search button must open the existing torrent-search modal
      against the season, pre-filled with the cleaned show title followed by the zero-padded season
      token (`Invincible S04`), editable before searching. The result list, the text filter and the
      "Best candidates" re-ranking behave exactly as they do for an episode, reading the series'
      audio-language requirement and the user's `showTorrentGroups`.
- [x] **REQ-5 (Attach a searched release to a season)**: `api` must accept a release chosen from
      search results for a season — same inputs, same lazy `infoHash` resolution when the row has
      none, same ownership scope, same conflict/`force`/demotion rules and same qBittorrent tagging
      (show title + `Season <n>`) that `addMagnetToSeason` already applies. The created `MediaSource`
      is season-scoped and indistinguishable downstream from one created by magnet, except for its
      `kind` (`TORRENT_SEARCH`).
- [x] **REQ-6 (Replacing a season with delivered episodes)**: When any episode of the season is
      already `COMPLETED`, both modals must behave as they do for a completed episode: the replace
      warning is shown up front, and the request is sent with `force`. If the server refuses with
      `error.season.already_completed` (the page was stale), the modal shows the message and offers
      the confirm-and-replace action rather than failing silently.
- [x] **REQ-7 (Episodes reflect an in-flight pack)**: While a season has a non-`ERROR` season-scoped
      `MediaSource` that has not yet been scanned, every **aired** episode of that season must read at
      least `QUEUED` on `/shows/<id>`, whatever the pack's own torrent state is (its progress lives in
      the downloads panel, not on the episodes). "At least" is the usual "most advanced wins" rule, so
      an episode already `DOWNLOADING` through its own source, `ENCODING` or `COMPLETED` is
      unaffected. An episode is aired when its `releaseDate` is today or earlier; an episode whose
      `releaseDate` is in the future **or null** is not lifted and keeps reading what it read before
      (normally `MISSING`), since no pack can contain it yet. Once the source is scanned, it stops
      contributing: each episode reads only its own sources and jobs, so an episode the pack did not
      contain goes back to what it was.
- [x] **REQ-8 (Deleting the pack un-does REQ-7)**: Deleting a season source from the downloads panel
      (`047-source-deletion`) must leave the season's episodes reading what they read before the pack
      was requested — no episode stays `QUEUED` because of a source that no longer exists or is
      `ERROR`.
- [x] **REQ-9 (Refresh after success)**: A successful season request closes the magnet modal (the
      search modal stays open, as for an episode) and refreshes the page so REQ-7 is visible
      immediately.
- [x] **REQ-10 (Every refusal is translated)**: Every error key either season mutation can return
      (§ GraphQL Contract Delta) must have an `en` and an `es` entry in `services/web/messages/`, so a
      Spanish user never sees the raw English fallback.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (No schema change)**: `MediaSource.seasonId` and every status column already exist.
      REQ-7 is a read-time derivation, not a stored column; no migration and no backfill.
- [x] **NFR-2 (Twin, not shared helper)**: The season search entry point follows the deliberate
      three-twin structure of `attachTorrentSource` (Constitution, Article X names it as outranking
      simplification). This feature does not collapse the twins.
- [x] **NFR-3 (No extra external calls)**: REQ-7 must be answered from the database alone — no
      qBittorrent reading per episode and no TMDB call — the same constraint `deriveTitleStatus`
      already has (`043` REQ-5). Loading `/shows/<id>` must not grow a query per episode.
- [x] **NFR-4 (Worker untouched)**: The season pack pipeline downstream of the download
      (`013-season-pack-processing`) is unchanged. `worker` is not in `services:` and its diff must be
      empty.
- [x] **NFR-5 (Media type availability)**: Neither season mutation refuses a disabled series type
      (`045-media-type-availability`), matching `addTorrentToEpisode`/`addMagnetToEpisode`, which do
      not either: acquiring for a title already registered is work in flight. The season buttons
      only render on `/shows/<id>`, which `web` already 404s when series are disabled.

## GraphQL Contract Delta

```graphql
type Mutation {
  """Envía un release elegido a qBittorrent y lo asocia a la temporada"""
  addTorrentToSeason(seasonId: Int!, infoHash: String, urls: [String!]!, releaseTitle: String, force: Boolean = false): Season!
}
```

`addMagnetToSeason(seasonId: Int!, magnet: String!, force: Boolean = false): Season!` is unchanged;
this feature adds its first consumer.

`Episode.status` keeps its type (`String!`); only the value it derives to changes, per REQ-7 — it
can now read `QUEUED` for an episode with no source or job of its own. `web` already renders every
pipeline status through `StatusBadge`, so no consumer change follows from that. `Season`
gains no field.

Errors, for both `addTorrentToSeason` and `addMagnetToSeason` (`extensions.i18n.key`):

| Condition | GraphQL error | Key | Message the user sees (`es`) |
| :-- | :-- | :-- | :-- |
| Season id does not exist **or** belongs to a show the caller has not registered (indistinguishable) | `NotFoundException` | `error.season.not_found` (`{ id }`) | `La temporada {id} no existe` (new `web` translation; `api`'s English text already exists) |
| At least one episode of the season is `COMPLETED` and `force` is false | `ConflictException` | `error.season.already_completed` | `Esta temporada ya tiene episodios descargados. Confirmá para reemplazar los archivos actuales.` (existing) |
| The `infoHash` is already attached to a film, an episode, or a different season | `ConflictException` | `error.magnet.already_attached` (existing key, `{ title }`) | existing translation |
| qBittorrent refuses the torrent | existing | `error.download.torrent_client_rejected` | existing translation |
| `addTorrentToSeason` only — `infoHash` was null and could not be resolved from `urls` | `BadRequestException` | `error.indexer.no_infohash` | `No se pudo determinar el infoHash de este release` (existing) |
| `addMagnetToSeason` only — the magnet does not parse, has a malformed infoHash, or is v2-only | `BadRequestException` | `error.magnet.not_a_magnet` / `error.magnet.invalid_infohash` / `error.magnet.v2_unsupported` (existing, thrown by `parseMagnet` exactly as for `addMagnetToEpisode`) | existing translations |
| Unauthenticated / `SERVICE_TOKEN` principal | global guard | — | `No autenticado` → redirect to login (existing `redirectIfUnauthenticated`) |

Consumer obligations (`web`):

- Sends `infoHash` as `string | null` with no `?? ''` coercion, exactly like `addTorrentToEpisode`.
- Selects only `id` from the returned `Season` — it refreshes the page rather than patching state
  from the response.
- `error.season.already_completed` → shows the message and switches the action to "replace",
  re-sending with `force: true` (REQ-6). Every other key → shows the translated message inline in
  the modal, no retry offered. A network failure → the existing `errors.network.connectionFailed`.

`worker` has no obligation; it calls neither mutation and reads no episode status.

## Data Model Changes

None.

## Acceptance Criteria

- [x] **AC-1**: Given `/shows/<id>` for a registered series, when the page renders, then every
      season header shows search, import-file and magnet buttons beside "Temporada N"; the import-file
      one is disabled and clicking it does nothing, and clicking search or magnet does not toggle the
      accordion. Observed live against a running stack (2026-09-17): three buttons on "Season 1",
      import-file `disabled=""` with no click handler, and the search/magnet buttons confirmed as
      true DOM siblings of the toggle `<button>`, never its descendant.
- [x] **AC-2**: Given a season with no completed episodes, when the user pastes a valid magnet into
      the season's magnet modal and confirms, then the modal closes, the downloads panel shows a new
      row labelled "<Show> Temporada N", and every aired episode of that season reads `QUEUED`
      while every episode with a future or empty release date still reads `MISSING`. `bin/mysql -e 'select seasonId, episodeId, kind from media_sources order by id desc limit 1'`
      shows the season id, a null `episodeId` and `TORRENT_FILE`. Observed live (2026-09-17): a
      season 1 magnet on Neon Genesis Evangelion closed the modal, produced a
      "Neon Genesis Evangelion Temporada 1" downloads row, and every one of its (all-aired) episodes
      read `QUEUED`; the DB query returned exactly `seasonId=1, episodeId=NULL, kind=TORRENT_FILE`.
- [x] **AC-3**: Given the same season, when the user opens the season's search modal, then the query
      field reads `<Show> S0N`; searching and clicking a result's download button creates a
      `MediaSource` with that `seasonId`, a null `episodeId` and `kind = TORRENT_SEARCH`, and the
      aired episodes switch to `QUEUED` after the refresh. The prefill (`Neon Genesis Evangelion S01`)
      was observed live in both `en` and `es`; the create-and-lift half is unchanged
      `attachTorrentSource` code exercised by AC-2 above plus `seasons.service.spec.ts`'s dedicated
      `kind: 'TORRENT_SEARCH'`/`seasonId` case (T001) — this sandbox's indexer returns no live results
      to click through end to end.
- [x] **AC-4**: Given a search result with a null `infoHash` whose URL cannot be resolved to one, when
      the user adds it to a season, then the modal shows "No se pudo determinar el infoHash de este
      release", no `MediaSource` row is created and no torrent appears in qBittorrent. Verified via
      `seasons.service.spec.ts`'s fault-injected case (a rejected `resolveInfoHash` propagates with no
      `qbittorrent.add` call and no `mediaSource` write) — no live indexer result to click through in
      this sandbox, same limitation as AC-3.
- [x] **AC-5**: Given a season where episode 3 is `COMPLETED`, when the user opens either season
      modal, then the replace warning is visible before submitting; submitting sends `force` and
      episode 3 still reads `COMPLETED` while the other aired episodes read `QUEUED`. The replace
      warning/`force` resend is unchanged `ReplaceWarning`/`ALREADY_COMPLETED_KEYS` code shared with
      the movie/episode paths; the status guarantee is `shows.service.spec.ts`'s dedicated case
      ("a `COMPLETED` episode stays `COMPLETED`" under a lifting season source, T003) — not re-run
      live against a season with a real completed episode in this sandbox.
- [x] **AC-6**: Given a magnet already attached to a film, when the user submits it for a season,
      then the modal shows the "already attached" message naming that film and no new row is created.
      Observed live (2026-09-17): reattaching "Inception"'s infoHash to Season 1 showed
      "That magnet is already attached to «Inception»" and `media_sources` for that season stayed at
      count 0.
- [x] **AC-7**: Given a pack download that finishes and is scanned, when the scan matched episodes
      1–8 of a 10-episode season, then episodes 1–8 read `ENCODING`/`COMPLETED` as their jobs advance
      and episodes 9–10 read `MISSING` again. The "stops lifting after `SCANNED`" guarantee this
      depends on is `pipeline-status.spec.ts`'s fault-injected case (T002: removing the `SCANNED`
      exclusion makes the case fail) — this sandbox has no real seeding peer to carry a torrent
      through an actual scan.
- [x] **AC-8**: Given a season pack still downloading, when the user deletes it from the downloads
      panel, then after refresh every episode of that season reads the status it had before the pack
      was requested. Observed live (2026-09-17): deleting the AC-2 magnet's in-flight row returned
      every episode of Season 1 to `MISSING`, its pre-pack status.
- [ ] **AC-9**: With the UI locale set to `es`, each refusal in the error table above renders its
      Spanish message; `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift. The
      catalog half holds (`check-messages.mjs`: 428 keys, no drift) and a param-less key translates
      correctly live (`error.magnet.not_a_magnet` → "Eso no parece un enlace magnet" in `es`), but a
      keyed error **with params** does not: `error.season.not_found` (`{id}`) and
      `error.magnet.already_attached` (`{title}`) both render their English `message` even under the
      `es` locale. Root cause and scope: `tasks.md` § Blocked — a pre-existing bug in
      `services/web/src/lib/graphql-error.ts` (`JSON.parse` on an `extensions.i18n.params` that `api`
      never `JSON.stringify`s), reproduced identically on the pre-`059` `addMagnetToMovie` path, so
      not a regression this feature introduced. Left unchecked rather than papered over; not fixed
      here since no file either service plan names owns it.
- [x] **AC-10**: `bin/npm api run test` passes, and the api suite covers REQ-7's edges: a
      non-scanned season source lifts an aired `MISSING` episode to `QUEUED`; it does not lift an
      episode with a future or null `releaseDate`; it does not lower an episode already more
      advanced; and a scanned (or `ERROR`) season source lifts nothing. `bin/npm api test`: 536/46
      suites passing (above the 517/46 baseline), including `pipeline-status.spec.ts`'s
      `isLiftedBySeasonPack` describe block and `shows.service.spec.ts`'s season-pack lift cases.

## Out of Scope

- **Importing a local file for a season.** `createUploadTicket` takes `movieId`/`episodeId` and a tus
  upload is a single file; a season import is a folder or several files, which is a different upload
  shape and a different worker entry. Deliberately deferred to its own spec (see REQ-2).
- **`Show.status` / the library listing and billboard.** Only per-episode status on the detail page
  changes; a series-level status is untouched, as `043` left it.
- **Automatic season-vs-episode choice.** Nothing decides for the user whether to grab a pack or
  individual episodes, and search results are not filtered to "pack-looking" releases — the query
  token is a starting point the user can edit.
- **A season-level status badge in the accordion header.** The episodes already carry the status
  (REQ-7) and the downloads panel carries the progress; a third place would duplicate both.
- **Changing what a pack does after download.** Scan, fan-out, cleanup and unresolved-file handling
  are `013`'s and stay as they are.

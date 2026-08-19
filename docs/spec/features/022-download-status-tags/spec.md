---
title: Download Status and Torrent Tags
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-08-19
last_updated: 2026-08-19
status: Approved         # Draft | Approved | Implemented | Superseded
services: [api, web]
---

# SPEC: Download Status and Torrent Tags (`spec.md`)

## Context & Goal

Between "the user sends a release to qBittorrent" and "the file appears in the library" the product
says nothing at all. The reason is not a missing screen, it is that `web` has no way to ask. `Movie`
exposes `mediaSourceId: Float` and nothing else source-related; `Show`, `Season` and `Episode`
expose nothing at all; the one query that could answer, `mediaSource(id)`, carries `@AllowService()`
and is refused to a browser session with `No autenticado`. Nor would answering help much today,
because nothing in `api` ever reads a torrent's live state back:
`services/api/src/clients/torrent/client.ts` declares `info()` and it has **no caller anywhere in
`src/`**, its `TorrentClientInfo` carries no progress and no speed, its `stop()` is likewise never
called, and there is no start or resume method at all. `MediaSource.status` therefore never moves
from `QUEUED` to `DOWNLOADING` or `PAUSED` — it jumps straight to `READY` when the qBittorrent
AutoRun hook fires `torrentCompleted`. The only real status UI in the product is
`services/web/src/components/shows/SeasonAccordion.tsx:13-24`, a pill rendering the raw
`MediaStatus` enum; `components/movies/Movie.tsx:68` and `components/shows/Show.tsx:50` print the
same enum as text in a subtitle line.

The user's own fallback — open qBittorrent and look — is nearly as bad, because
`QbittorrentClient.add()` sends exactly two things, `urls` and `savepath`, and the save path is
`sha256(urls[0]).slice(0,16)`. Every torrent Perceptor creates lands untagged, uncategorised, in a
folder named after a hash. There is no way to tell which download belongs to which film, and no way
for `api` to ask qBittorrent for "the torrents of this title" without pulling the entire list.

Two constraints in the current design also make it impossible to try more than one release at a
time, which is what a user actually wants when a release is slow or dead.
`services/api/prisma/schema.prisma` gives `Movie` a `mediaSourceId Int? @unique` — a database-level
1:1, so a film physically cannot hold two sources. Episodes and seasons are already 1:N
(`MediaSource.episodeId` / `.seasonId`), but all three `attachTorrentSource` implementations
enforce a one-active-source rule in code, refusing a second request with
`… ya tiene una descarga en curso. Confirmá para reemplazarla.` unless the caller passes
`force: true`, which demotes the previous source to `ERROR`.

This feature replaces all of that. Torrents are tagged when they are added, so qBittorrent's own
sidebar becomes usable and `api` can fetch a title's torrents with one filtered call. The film and
series detail pages grow a downloads panel showing, per download, how much is done and how fast it
last went — values the **server** read from qBittorrent, refreshed when the user asks — with
force-start, stop and delete controls acting on the torrent client. And a title may race several
downloads at once: the first to finish stops the others while it keeps seeding, and the cleanup that
already runs after a successful encode wipes the losers.

In the root `CLAUDE.md` pipeline table the **Download** row stops being fire-and-forget: `api` now
reads live state back out of qBittorrent and starts, stops and deletes torrents on the user's
behalf. The **Detect completion, enqueue** row gains a race arbiter. Nothing about **Transcode** or
**Scan files** changes, which is why `worker` is not in `services:`.

## Requirements

> **Scope**: films, single episodes and season packs — every acquisition path that produces a
> `MediaSource` with an `infoHash`. Uploads (`LOCAL_FILE`, `LOCAL_FOLDER`) have no torrent and are
> deliberately absent from every screen and mutation this feature adds.

### Functional Requirements

- [ ] **REQ-1 (Film tag)**: Sending a release or a magnet to a film must tag the resulting torrent
      in the torrent client with the film's title. A film named Transformers produces the single
      tag `Transformers`.
- [ ] **REQ-2 (Episode tags)**: Sending a release or a magnet to an episode must apply **three**
      tags: the show's title, `Season <n>` and `Episode <n>`. For Reacher S03E08 that is `Reacher`,
      `Season 3`, `Episode 8`. The two keywords are always English regardless of the interface
      language, and the numbers are **not** zero-padded — this is deliberately different from the
      `S03E08` form used in search queries and display titles.
- [ ] **REQ-3 (Season-pack tags)**: `addMagnetToSeason` must apply **two** tags, the show's title
      and `Season <n>`, following REQ-2's vocabulary. Stated explicitly so it is not left to an
      implementer to infer.
- [ ] **REQ-4 (Tags are flat and deliberately ambiguous)**: The season and episode tags carry no
      show name and no hierarchy, so `Season 3` is shared by every series the user downloads. This
      is the intended trade: those two tags exist for the human filtering qBittorrent's own sidebar,
      and the server never queries by them. Every server-side lookup of a title's torrents uses the
      **title tag only**.
- [ ] **REQ-5 (Tag sanitisation)**: A comma is qBittorrent's tag separator, so a title containing
      one would silently split into two wrong tags. Commas must be replaced with a space, runs of
      whitespace collapsed, and the result trimmed, before the tag is sent. A title that sanitises
      to an empty string must fall back to a stable, non-empty tag derived from the row's id — a
      torrent must never end up with no title tag, since that is the only handle the server has on
      it.
- [ ] **REQ-6 (N concurrent downloads)**: A film, an episode and a season may each hold several
      active `MediaSource` rows at the same time. A second acquisition request against a target that
      already has one must succeed without warning the user, without asking for confirmation, and
      without touching the sources already there.
- [ ] **REQ-7 (`force` is retired)**: The `force` argument must be removed from
      `addTorrentToMovie`, `addMagnetToMovie`, `addTorrentToEpisode`, `addMagnetToEpisode` and
      `addMagnetToSeason`, together with the three `ConflictException`s it guarded and the
      demote-the-previous-source-to-`ERROR` path that `force: true` triggered. The two places in
      `web` that detect the conflict by substring-matching the Spanish sentence
      (`components/import/importMagnetModal.tsx`, `components/search/SearchTorrent.tsx`) must be
      deleted rather than adapted, along with their `needsConfirm` / "Reemplazar" states. The
      **cross-title** infoHash collision is unaffected and stays; re-sending the same infoHash to
      the same target stays idempotent, updating the existing row instead of creating a second.
      **The tus upload route carries two more copies of the same conflict** — `uploads.service.ts`
      raises a 409 with that sentence for an episode with an active source and for a film with a
      non-null `Movie.mediaSourceId`, neither of which has a `force` escape hatch. Both go too. The
      film one is not optional: the column it reads disappears with the data model change below.
      Keeping the episode one would mean a user may race two torrents but may not upload a file
      while one runs, which is incoherent with REQ-6.
- [ ] **REQ-8 (Downloads panel)**: `/movies/<id>` and `/shows/<id>` must each render one flat list
      of that title's downloads, above the existing content. The series list must cover the whole
      show — every season pack and every single-episode download — with each row naming its target,
      not be split across the season accordion.
- [ ] **REQ-9 (Server-read values)**: Each row must show at least the percentage completed and the
      most recent download speed, and both must be values `api` read from the torrent client. The
      browser must never call qBittorrent, and the values must not be persisted to a column and
      served stale from the database.
- [ ] **REQ-10 (Manual refresh)**: The panel must carry a refresh control that re-reads the values
      from the torrent client. There must be no polling loop, no automatic interval and no
      websocket — a value on screen is only ever as fresh as the last load or the last click.
- [ ] **REQ-11 (Row controls)**: Each row must offer three actions, all executed against the torrent
      client: **force-start**, **stop**, and **delete**. Force-start must be qBittorrent's force
      start, not a plain resume — the point of the control is that it sometimes shakes a stalled
      torrent loose. Delete must require an explicit confirmation in the interface before it fires,
      and must remove the torrent **together with its files**.
- [ ] **REQ-12 (Race — the winner keeps seeding, the rest stop)**: When one of a target's downloads
      completes, every **other** non-terminal source of that same target must be stopped in the
      torrent client and its `MediaSource` moved to `PAUSED`. The completed one must be left running
      so it continues seeding. Given `Transformers 4k` and `Transformers 1080p` racing, the moment
      1080p finishes it keeps seeding and 4k is paused.
- [ ] **REQ-13 (One winner only)**: A completion notice for a target that already has a source in
      `READY` or `SCANNED` must be ignored — no status change, no second `bull:process` job. This
      must hold for a loser that finishes inside the window between the winner completing and the
      pause taking effect. This requirement is what replaces the protection the retired `force`
      demotion used to give (`DownloadsService.handleTorrentCompleted` guard 3, "ignored,
      reemplazado"), and REQ-15's row deletion is only safe because of it.
- [ ] **REQ-14 (Siblings are selected by target, never by tag)**: Every operation that acts on "the
      other downloads of this title" — REQ-12's pause and REQ-15's cleanup — must select them by
      `movieId` / `episodeId` / `seasonId`, never by tag. A tag is a title string: two different
      shows can share one, and a user can create one by hand in qBittorrent.
- [ ] **REQ-15 (Cleanup wipes the losers)**: When the post-encode cleanup removes the winner's
      torrent, every losing sibling of that source must also have its torrent removed **with its
      files**, and its `media_sources` row deleted outright. No history row is kept.
- [ ] **REQ-16 (A failed encode stops the cascade)**: If the encode ends in `ERROR`, nothing is
      deleted and nothing is resumed. The losers stay paused, their rows and their files intact, and
      the user decides what to do from the panel.
- [ ] **REQ-17 (Ownership scope)**: The new queries and mutations must resolve through the same
      `UserMovie` / `UserShow` clauses the detail queries already use, and must answer for a title
      the caller does not own exactly as they answer for one that does not exist — same exception,
      same message, indistinguishable — per `008-movie-detail`. None of them may carry
      `@AllowService()`.
- [ ] **REQ-18 (Torrent-backed sources only)**: The panel must list only sources that have an
      `infoHash`. A source without one must be refused by the three control mutations before any
      call reaches the torrent client.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (The torrent client stays unauthenticated)**: `QbittorrentClient` performs no login
      and holds no credential; it reaches qBittorrent because the container whitelists the Docker
      subnet (`services/torrent/Dockerfile`, `WebUI\AuthSubnetWhitelist=172.16.0.0/12`). Every
      endpoint this feature adds rides the same assumption. Do not add a login flow, a SID cookie or
      a credential read as part of this work — that is a separate change with its own reasoning.
- [ ] **NFR-2 (`worker` is untouched and gets no exemption)**: The loser cleanup is `api`-side,
      triggered from the mutation the worker already calls. `services/worker` must require no
      change: `cleanup-source.ts` keeps calling `downloadRemove(mediaSourceId, deleteFiles: false)`
      for the winner, keeps owning every filesystem deletion for the winner's own paths, and sends
      and receives byte-identical shapes. The losers' files are deleted **by qBittorrent**, on
      `api`'s instruction, which is outside the worker's remit and outside the `isInsideRoot` checks
      it owns.
- [ ] **NFR-3 (i18n sequencing)**: `018-ui-i18n` is Approved and **not implemented** — there is no
      `services/web/messages/`, no `next-intl`, no `extensions.i18n` on any error. New copy in this
      feature is therefore Spanish literals at their render sites, matching the current tree, and
      `018` re-extracts them like everything else. This feature must not half-adopt `next-intl` or
      start emitting `extensions.i18n`. It does *delete* two of the string-matchers `018` lists as
      targets (REQ-7), which shrinks `018`'s work rather than conflicting with it.
- [ ] **NFR-4 (Typecheck and build baseline)**: `api` must stay at 0 errors. `web` must not regress
      its committed error count, and `bin/npm web run build` must exit 0. Re-measure both before and
      after rather than trusting the numbers in the root `CLAUDE.md`.
- [ ] **NFR-5 (Test where the failure is silent)**: Constitution Article IX. Two failure classes here
      produce no error anywhere and both owe a test whose opening comment names them:
      **(a)** two sources of one target both reaching `ENCODING` because a loser's completion was
      not ignored (REQ-13) — the target ends with two `ProcessJob`s writing the same output path,
      and nothing logs a problem; **(b)** cleanup selecting siblings by tag rather than by target id
      (REQ-14) — a second series sharing a title string loses downloads the user never touched, and
      the deletion succeeds, so there is no error to find.
- [ ] **NFR-6 (No unchecked call to the torrent client)**: Every torrent-client method this feature
      adds or newly relies on must check the HTTP response and fail loudly, as `add()` already does
      and as `stop()` and `remove()` currently do **not**. A silent failure here is invisible in both
      directions: an unacknowledged stop leaves a loser downloading while the database reads
      `PAUSED`, and an unacknowledged delete leaves the file on disk after the row is gone.
- [ ] **NFR-7 (Bring `mapTorrentState` to qBittorrent 5.0)**: `mapTorrentState`
      (`services/api/src/clients/torrent/client.ts:39-49`) still classifies by the 4.x state names.
      5.0 renamed the paused states to stopped, and its state sets never followed: `PAUSED_STATES`
      lists `pausedDL`/`pausedUP` but not `stoppedDL`/`stoppedUP`, and `DOWNLOADING_STATES` has
      `metaDL` and `forcedDL` but not `forcedMetaDL`. Verified against the running container, which
      is reporting `stoppedDL`, `forcedDL` and `forcedMetaDL` right now. The sets must be corrected
      before REQ-12 or REQ-11 can work, because the function's fallthrough returns `SourceStatus.ERROR`
      and `ERROR` is precisely what `DownloadsService.handleTorrentCompleted` reads as "superseded,
      ignore" — so a correctly paused loser would be indistinguishable from a discarded one.
      An unrecognised state must additionally stop being laundered into `ERROR`: that fallthrough is
      what let this survive a whole major version with nothing in any log.
- [ ] **NFR-8 (Destructive migration is acceptable)**: The `Movie` ↔ `MediaSource` inversion below
      may drop and recreate rather than backfill. The stack is in development and the user has
      confirmed no data needs preserving. This is recorded so a reviewer does not read the missing
      backfill as an omission.

## GraphQL Contract Delta

Two new queries, three new mutations, one new type, and a breaking change to the five acquisition
mutations. Written as it will appear in the generated `services/api/src/schema.gql`.

```graphql
type Download {
  mediaSourceId: Int!
  infoHash: String!
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

  # CHANGED: `force: Boolean = false` removed from all five.
  addTorrentToMovie(movieId: Int!, infoHash: String!, urls: [String!]!, releaseTitle: String): Movie!
  addMagnetToMovie(movieId: Int!, magnet: String!): Movie!
  addTorrentToEpisode(episodeId: Int!, infoHash: String!, urls: [String!]!, releaseTitle: String): Episode!
  addMagnetToEpisode(episodeId: Int!, magnet: String!): Episode!
  addMagnetToSeason(seasonId: Int!, magnet: String!): Season!
}

type Movie {
  # REMOVED: mediaSourceId: Float
  # …every other field unchanged…
}
```

Notes the SDL cannot carry:

- **`downloadDelete` is not `downloadRemove`, and the names are close enough to be dangerous.** The
  existing `downloadRemove(mediaSourceId: Int!, deleteFiles: Boolean = true): String!` stays exactly
  as it is — `@AllowService()`, called only by the worker's `cleanup-source.ts`, always with
  `deleteFiles: false`. `downloadDelete` is the user-facing sibling: ownership-scoped, no
  `deleteFiles` argument, always deletes files, returns a boolean rather than
  `downloadRemove`'s `omitido: …` string. Neither may be implemented in terms of the other's
  arguments without preserving both defaults.
- **`downloadRemove`'s behaviour changes without its signature changing.** When it removes a
  winner's torrent it now also removes that source's losing siblings (REQ-15). The worker's call
  site, its arguments and its return type are identical, so no typechecker on either side sees
  anything — which is precisely why it is recorded here. Its `omitido: mediaSource <id> no es un
  torrent` response is unchanged and still does not mean "cleanup is done"
  (`012-post-download-processing`).
- **The list is DB-first and joined to qBittorrent on `infoHash`.** The rows the user sees come from
  `media_sources` filtered by the caller's owned title; the tag only narrows the `torrents/info`
  read on the qBittorrent side. A tag carries no ownership and no identity — deriving the list from
  it would show one user another's downloads and would pick up torrents a human tagged by hand.
- **A torrent missing from the client is still a row.** `torrentState`, `progress` and
  `downloadSpeed` come back `null`; `status`, `label` and the ids still come from the database. It
  is never silently dropped from the list, because "it vanished from qBittorrent" is exactly what
  the user needs to see.
- **`progress` is 0..100, not qBittorrent's 0..1.** Converted once, server-side. A consumer that
  multiplies again renders 1%.
- **`torrentState` is qBittorrent's raw state string**, not the mapped `SourceStatus`. `status` is
  the mapped, persisted one. Both are present because they answer different questions and the
  mapping is lossy (`mapTorrentState` collapses a dozen qBittorrent states into seven).
- **`label` is computed server-side** with the display helpers already duplicated across the three
  services — `` `${show.title} S${SS}E${EE}` `` for an episode, `` `${show.title} Temporada ${n}` ``
  for a season, the plain title for a film. It is not the tag: it is Spanish where the tags are
  English, and zero-padded where the tags are not.
- **Retiring `force` is a breaking change with five consumers in `web`**, all updated in the same
  delivery: `actions/imports.ts` (`importMagnetAction`), `actions/indexer.ts`
  (`addTorrentToMovieAction`), `actions/shows.ts` (`addTorrentToEpisodeAction`,
  `addMagnetToEpisodeAction`), plus the two components that pass it. Because `force` had a default,
  a consumer that simply stops sending it keeps compiling and keeps working — but a consumer that
  *keeps* sending it fails at runtime with a GraphQL validation error on every call.
- **`Movie.mediaSourceId: Float` is removed from the schema.** No consumer selects it — neither
  `GET_MOVIE_QUERY` in `services/web/src/actions/movies.ts` nor anything in `worker`. Its
  disappearance is a consequence of the data model change below, not an independent decision.
- **No `@AllowService()` on any new operation.** A `SERVICE_TOKEN` principal is refused by the
  global `JwtAuthGuard` with `No autenticado`, matching `movie(id)` and `show(id)`.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `movieDownloads` for a film that does not exist | `NotFoundException` | `La película <id> no existe` |
| `movieDownloads` for a film the caller has no `UserMovie` link to | `NotFoundException` — identical to the row above | `La película <id> no existe` *(deliberately indistinguishable, per `005-movie-search` and `008-movie-detail`)* |
| `showDownloads` for a show that does not exist, or that the caller has no `UserShow` link to | `NotFoundException` | `Recurso no disponible para este usuario` |
| `mediaSourceId` does not exist | `NotFoundException` | `El mediaSource <id> no existe` |
| The source exists but belongs to a title the caller does not own | `NotFoundException` — identical to the row above | `El mediaSource <id> no existe` |
| The source has no `infoHash` (an upload) | `BadRequestException` | `Esa descarga no es un torrent` |
| The torrent client refuses or is unreachable, on a **mutation** | `Error` (existing shape, thrown before any DB write) | `qBittorrent rechazó la operación (<status>)` |
| The torrent client is unreachable, on a **query** | none — not an error | rows render with `torrentState`, `progress` and `downloadSpeed` null |
| Magnet is not a magnet link | `BadRequestException` (from `parseMagnet`, existing) | `No parece un magnet link` |
| Magnet has no usable infoHash | `BadRequestException` (existing) | `El magnet no tiene un infoHash válido` |
| BitTorrent v2 magnet | `BadRequestException` (existing) | `Magnet de BitTorrent v2, todavía no soportado` |
| The infoHash is already attached to another title | `ConflictException` (existing, **kept**) | `Ese magnet ya está asociado a «<title>»` |
| Any of the above with an absent or expired credential | `UnauthorizedException` (existing global guard) | unchanged from today |

All five `… ya tiene una descarga en curso. Confirmá para reemplazarla.` conflicts are **deleted**,
not reworded: the three GraphQL ones (film, episode, season) plus the two `UploadHttpError(409)`
copies on the tus route (REQ-7). They are the only user-facing strings this feature removes, and
REQ-7 requires the `web` matchers that depend on them to go with them.

Two strings are new: `Esa descarga no es un torrent` and `qBittorrent rechazó la operación
(<status>)`. The second follows the existing `qBittorrent rechazó el torrent (<status>)` shape
verbatim except for the noun. Everything else in the table already exists in `services/api/src`.

### The torrent client interface is a second, parallel contract

`TorrentClient` (`services/api/src/clients/torrent/types.ts`) is a typed interface with a second,
declared-but-unimplemented member (`TORRENT_CLIENTS.TRANSMISSION`). Changing it is a contract change
in the same sense the BullMQ payload is, so it is declared here rather than left to `plan.md` —
the same way `docs/spec/graphql-contract.md` declares the queue payload it does not own.

```ts
export type TorrentClientInfo = {
  hash: string;
  state: SourceStatus;
  rawState: string;
  root_path: string;  // unchanged — see the note below; this field is real and load-bearing
  progress: number;   // NEW — 0..1, exactly as qBittorrent reports it
  dlspeed: number;    // NEW — bytes per second
  forceStarted: boolean; // NEW — qBittorrent's `force_start`
  tags: string[];     // NEW — split from qBittorrent's comma-concatenated string
};

export type TorrentClient = {
  info: (tag?: string) => Promise<TorrentClientInfo[]>;                        // CHANGED
  add: (urls: string[], tags?: string[]) => Promise<string>;                   // CHANGED
  start: (hashes: string | string[]) => Promise<void>;                         // NEW
  forceStart: (hashes: string | string[], value?: boolean) => Promise<void>;   // NEW
  stop: (hashes: string | string[]) => Promise<void>;                          // unchanged
  remove: (hashes: string | string[], deleteFiles?: boolean) => Promise<void>; // unchanged
  setSavePath: (path: string) => Promise<void>;                                // unchanged
};
```

Verified against the qBittorrent 5.0 WebUI API wiki, which is the reference every existing method in
`client.ts` already links to from its JSDoc, **and against the running `torrent` container**, which
is the authority where the two disagree:

| Interface method | Endpoint | Parameters |
| :-- | :-- | :-- |
| `add` | `torrents/add` | existing `urls`, `savepath`, plus **`tags`** — a comma-separated list |
| `info` | `torrents/info` | **`tag`** — a single URL-encoded tag name; omitted means every torrent |
| `start` | `torrents/start` | `hashes`, `\|`-separated |
| `forceStart` | `torrents/setForceStart` | `hashes`, plus **`value`** (`true`/`false`) |
| `stop` | `torrents/stop` | `hashes` — already implemented, already correct for 5.0 |
| `remove` | `torrents/delete` | `hashes`, `deleteFiles` — already implemented |

Four things this pins down that would otherwise be guessed:

- **Tags are applied on `add`, not in a second call.** `torrents/add` takes `tags` directly, so
  REQ-1 through REQ-3 need no `createTags`/`addTags` round trip and no window in which a torrent
  exists untagged. `addTags`, `removeTags`, `createTags` and `tags` all exist and none is needed
  here; adding them is scope creep.
- **`tags` is comma-separated on the wire, which is why REQ-5 exists.** The same separator makes
  the sanitisation mandatory rather than defensive.
- **`progress` is a float 0..1 at the client boundary.** The interface passes it through unchanged
  because that is what qBittorrent returns and an adapter that silently rescales is an adapter that
  lies; the ×100 to reach the GraphQL `Float` happens in the service, once.
- **`forceStart` is a flag, not a verb.** `setForceStart(value: true)` marks the torrent forced; it
  is not a synonym for `start`. REQ-11's control is satisfied by the observable end state — running
  **and** marked forced in qBittorrent (AC-7) — not by any one endpoint. `torrents/info` reports the
  flag back as `force_start`, which is why `TorrentClientInfo` carries `forceStarted`: without it the
  panel cannot tell a forced torrent from a merely running one, and AC-7 is unverifiable from
  inside the product.

**`root_path` stays exactly as it is.** It is absent from the 5.0 wiki but present and populated in
the running container, and it is not redundant with the `savepath` this project already forces.
`add()` sends `savepath = <downloads root>/sha256(urls[0]).slice(0,16)` precisely so that a
single-file release cannot dump its file into a directory shared with other torrents; `save_path`
reads that value back. `root_path` is a different fact — the top-level item the release actually
created *inside* that folder, which for a scene release is a long directory name nobody can predict
from the magnet:

```
save_path:  /media/downloads/cdb220315cb063f9
root_path:  /media/downloads/cdb220315cb063f9/www.UIndex.org    -    Reacher S02E02 …-FLUX
```

It is empty string, not `undefined`, while the torrent is still fetching metadata (`metaDL`), which
is a state the panel will routinely display. Treat empty as "not known yet", never as an error.

Three behaviours the current `client.ts` has that this feature must change, none of them visible to
a typechecker:

- **`mapTorrentState` does not know qBittorrent 5.0's state names, and this feature depends on the
  two it is missing.** 5.0 renamed the paused states to stopped — the same rename that produced the
  `torrents/stop` / `torrents/start` endpoints `client.ts` already uses correctly — but
  `PAUSED_STATES` still lists only `pausedDL`/`pausedUP`, and `DOWNLOADING_STATES` has `metaDL` and
  `forcedDL` but not `forcedMetaDL`. The live container is currently reporting all three of
  `stoppedDL`, `forcedDL` and `forcedMetaDL`. Because the function's fallthrough returns
  `SourceStatus.ERROR`, a stopped torrent and a force-started one still fetching metadata both map
  to `ERROR`. That is not cosmetic here: REQ-12 pauses every loser, and `ERROR` is the exact status
  `DownloadsService.handleTorrentCompleted` treats as "superseded, ignore". The state sets must be
  brought to 5.0 — `stoppedDL`, `stoppedUP`, `forcedMetaDL` at minimum — and the fallthrough must
  stop laundering an unrecognised state into `ERROR`, since that is what hid this for a full major
  version.
- **`stop()` and `remove()` do not check `response.ok`.** `add()` does, with a comment explaining
  exactly why. The same reasoning now applies to the rest: REQ-12's pause failing silently leaves a
  loser downloading with the database saying `PAUSED`, and a failed delete leaves the user's file on
  disk with the row gone. Every method this feature adds or calls must check, and surface the
  failure as the error table's `qBittorrent rechazó la operación (<status>)`.

New methods follow the conventions already in `client.ts` without exception: `new URL("<name>",
await this.baseUrl())` for the path, `HTTP_METHOD` from `@/types/http` for the verb,
a `URLSearchParams` body, `this.normalizeHashes()` for the `|` join, and a JSDoc block opening with
a one-line description and the deep link to the matching wiki anchor. The wiki documents `start`,
`stop` and `delete` as GET; `client.ts` already POSTs to `stop` and `delete` and that is what works
against the running container, so the new methods POST too — consistency with the working
neighbours beats consistency with the wiki's verb column.

Consumer obligations:

- **`web`**: retype `Download` by hand in a new action module and drop `force` from the four actions
  that pass it; delete the `CONFLICT_MESSAGE` substring matching and the `needsConfirm` /
  "Reemplazar" flow in `importMagnetModal.tsx` and `SearchTorrent.tsx`; handle `progress` /
  `downloadSpeed` / `torrentState` arriving `null` as a normal state and not as a loading state.
  There is no shared confirm dialog in `services/web/src/components/ui/` today — REQ-11's
  confirmation is built on the existing `Modal` + `useModal` pair.
- **`worker`**: **no obligation.** It sends and receives identical shapes (NFR-2). If a change to
  `services/worker` appears necessary during implementation, that is a contract error — stop and
  report rather than adjusting the delta (Constitution, Article VIII).

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `MediaSource` | **add** `movieId Int?` plus the `movie Movie?` relation on the owning side, mirroring `episodeId` / `seasonId` | nullable, no default | No — see NFR-8 |
| `Movie` | **remove** `mediaSourceId Int? @unique` and its `mediaSource MediaSource?` relation | — | No — see NFR-8 |

This inversion is the change that makes REQ-6 possible at all: `Movie.mediaSourceId @unique` is a
database constraint, so no amount of application logic can let a film hold two sources while it
exists. Episodes and seasons need no migration — they are already the pointed-at side.

Three consequences worth stating so they are not rediscovered during implementation:

- **After this, all four owner relations are symmetric.** `MediaSource` points at a film, an
  episode or a season the same way, and "the other sources of this target" is one query shape rather
  than three.
- **`MediaSource.movieId` keeps its exact GraphQL name and type.** Today it is resolved from the 1:1
  back-relation; after this it is a real column. `worker`'s `src/jobs/source-ready.job.ts` selects
  that field and must see no change — which is the whole reason the new column reuses the name
  rather than introducing a second one beside it. This is the `movieId`-means-two-things debt in the
  root `CLAUDE.md` being *narrowed*, not resolved: the argument on the acquisition mutations and the
  tus metadata key still mean "a film, specifically", and this feature does not rename them.
- **No new enum value.** `SourceStatus` already carries `PAUSED`, which is what REQ-12 needs; the
  race arbiter introduces no state the schema cannot already express.

## Acceptance Criteria

- [ ] **AC-1**: Sending a release to the film Transformers produces a torrent in qBittorrent
      carrying exactly one tag, `Transformers`, visible in qBittorrent's tag sidebar.
- [ ] **AC-2**: Sending a release to Reacher S03E08 produces a torrent carrying exactly three tags —
      `Reacher`, `Season 3`, `Episode 8` — and `addMagnetToSeason` for Reacher season 3 produces one
      carrying exactly two, `Reacher` and `Season 3`.
- [ ] **AC-3**: With a film whose title contains a comma, the torrent carries **one** tag with the
      comma replaced by a space, not two tags split at it.
- [ ] **AC-4**: Sending two different releases to the same film succeeds both times with no
      confirmation prompt and no error, and
      `bin/mysql -e "select id, status, info_hash, movie_id from media_sources where movie_id = <id>"`
      returns two rows, both non-`ERROR`.
- [ ] **AC-5**: `/movies/<id>` lists both downloads from AC-4, each showing a percentage and a
      download speed. Clicking refresh changes at least the percentage on an actively downloading
      row.
- [ ] **AC-6**: `/shows/<id>` lists a season-pack download and a single-episode download of the same
      show in one list, each row naming its target (`Reacher Temporada 3`, `Reacher S03E08`).
- [ ] **AC-7**: Clicking stop on a row moves that torrent to a stopped state in qBittorrent's own
      UI; clicking force-start moves it back and qBittorrent shows it as forced. In both cases the
      panel's own status column must agree — `stoppedDL` must read as paused and `forcedDL` /
      `forcedMetaDL` as downloading, never as an error (NFR-7).
- [ ] **AC-8**: Clicking delete opens a confirmation; cancelling leaves the torrent in place;
      confirming removes it from qBittorrent **and** removes its files from disk.
- [ ] **AC-9**: Given AC-4's two racing downloads, when one completes, qBittorrent shows the
      completed one still running and seeding and the other stopped, and `bin/mysql` shows the
      loser's `media_sources` row at `status = 'PAUSED'` — **not** `ERROR`, which is what today's
      `mapTorrentState` would produce for `stoppedDL` and what `torrentCompleted` reads as
      "superseded, ignore".
- [ ] **AC-10**: A torrent that has just been added and is still fetching metadata renders in the
      panel with an empty `root_path` and a downloading status, not an error row — the
      `metaDL`/`forcedMetaDL` case.
- [ ] **AC-11**: After the winner's encode completes, both torrents are gone from qBittorrent, the
      loser's `media_sources` row is gone from the database, and the loser's download folder is gone
      from disk.
- [ ] **AC-12 (failure path)**: With user A's session, `movieDownloads` for a film only user B owns
      returns a GraphQL error whose message is exactly `La película <id> no existe` —
      byte-identical to the response for a film id that exists nowhere.
- [ ] **AC-13 (failure path)**: `downloadStart` against a `MediaSource` with `kind = LOCAL_FILE`
      fails with `Esa descarga no es un torrent`, and `docker compose logs torrent` shows no request
      reached qBittorrent.
- [ ] **AC-14 (failure path)**: With the `torrent` container stopped, `/movies/<id>` still renders
      and still lists its downloads, with the percentage and speed columns empty rather than
      returning a 500 or an error page.
- [ ] **AC-15 (failure path)**: Firing `torrentCompleted` with the **loser's** infoHash after the
      winner has already reached `READY` leaves the film's status untouched, adds no
      `bull:process` job to Redis, and creates no second `ProcessJob` row.
- [ ] **AC-16 (failure path)**: With an encode forced to fail, the losing downloads remain
      `PAUSED`, their `media_sources` rows still exist and their files are still on disk — nothing
      is deleted and nothing is resumed.
- [ ] **AC-17 (failure path)**: With the `torrent` container stopped, clicking stop or delete on a
      row surfaces `qBittorrent rechazó la operación (<status>)` in the interface and leaves the
      `media_sources` row exactly as it was — the database must not record a pause or a deletion the
      torrent client never acknowledged.
- [ ] **AC-18 (regression)**: Every existing acquisition path still works end to end with `force`
      gone — release search and magnet import from `/movies/<id>`, both from an episode row, and a
      full tus upload — each producing the same rows it produces today, and the upload path still
      reaching `ENCODING` without passing through `DOWNLOADING`.
- [ ] **AC-19**: `bin/npm api run test` passes, including the two NFR-5 cases; each new test file
      opens with a comment naming the failure class it defends against.
- [ ] **AC-20**: `bin/cli api npx --no tsc --noEmit` reports 0 errors, `bin/cli web npx --no tsc
      --noEmit` reports no more than the committed baseline measured before the change, and
      `bin/npm web run build` exits 0.

## Out of Scope

- **Automatic refresh, polling or websockets.** The user asked for a refresh button and nothing
  else. Adding an interval would multiply `torrents/info` calls by every open tab for no stated
  benefit; if it is wanted later it is a small, additive change on top of this.
- **Retagging torrents added before this ships.** A one-off backfill over the existing
  `media_sources` rows is a migration script with its own failure modes, and in a development stack
  the cheaper answer is to re-add. Torrents added before this feature simply have no tags and will
  not appear in a filtered qBittorrent view — they still appear in the panel, which is DB-first.
- **A season-request web UI.** `addMagnetToSeason` remains api-only, as `013-season-pack-processing`
  decided. This feature displays season-pack downloads and controls them; it does not add a screen
  for creating one.
- **Torrent-client authentication.** See NFR-1. The subnet whitelist is the current design and
  changing it is its own spec.
- **A Transmission implementation.** `TORRENT_CLIENTS.TRANSMISSION` has been declared and
  unimplemented since before this feature; the new `TorrentClient` interface methods make that gap
  wider, and closing it is not this feature's job.
- **Per-download bandwidth limits, priorities, file selection, or category management.** qBittorrent
  exposes all of them; none was asked for, and each is an independent addition to the client
  interface.
- **Adopting `next-intl`.** See NFR-3. `018-ui-i18n` owns that migration and this feature must not
  start it.
- **Renaming `movieId` on the acquisition mutations and the tus metadata key.** The root
  `CLAUDE.md`'s known-debt item stands. This feature narrows it by making `MediaSource.movieId` a
  real column with unchanged name and meaning; the cross-service rename remains its own work.

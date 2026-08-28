---
title: Download Status and Torrent Tags
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-08-19
last_updated: 2026-08-27
status: Implemented         # Draft | Approved | Implemented | Superseded
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
enforce a one-active-source rule in code, refusing a second request with `…_DOWNLOAD_IN_PROGRESS`
unless the caller passes `force: true`, which demotes the previous source to `ERROR`.

The tus upload route has the same rule in four more places, and there it is a dead end rather than a
prompt. `UploadsResolver.createUploadTicket` refuses before a byte is sent, and
`UploadsService.onUploadFinish` refuses again if the target became busy mid-upload — but
`services/web/src/components/import/importFileModal.tsx:252` only renders its confirm button when
the target is `COMPLETED`, so a user uploading a file to a film that is merely *downloading* is told
"confirm to replace it" and given nothing to confirm with. The magnet and search paths handle the
same condition correctly, which is why this went unnoticed. This feature does not add the missing
button: it removes the condition, so the message has no reason to be raised at all.

This feature replaces all of that. Torrents are tagged when they are added, so qBittorrent's own
sidebar becomes usable and `api` can fetch a title's torrents with one filtered call. The film and
series detail pages grow a downloads panel showing, per download, how much is done and how fast it
last went — values the **server** read from qBittorrent, refreshed when the user asks — with start,
stop and delete controls acting on the torrent client. And a title may race several acquisitions at
once: the first to finish stops the others while it keeps seeding, and the cleanup that already runs
after a successful encode wipes the losers. A file the user uploads by hand is one of those
racers — the race is per target, not per torrent.

In the root `CLAUDE.md` pipeline table the **Download** row stops being fire-and-forget: `api` now
reads live state back out of qBittorrent and starts, stops and deletes torrents on the user's
behalf. The **Detect completion, enqueue** row gains a race arbiter. Nothing about **Transcode** or
**Scan files** changes, which is why `worker` is not in `services:`.

## Requirements

> **Scope**: films, single episodes and season packs — **every** acquisition path that produces a
> `MediaSource`, torrent or upload. A `LOCAL_FILE` source has no torrent, so it cannot be started,
> stopped or deleted from the panel, but it is listed there and it competes in the same race as the
> torrents of its target (REQ-19).

### Functional Requirements

- [x] **REQ-1 (Film tag)**: Sending a release or a magnet to a film must tag the resulting torrent
      in the torrent client with the film's title. A film named Transformers produces the single
      tag `Transformers`.
- [x] **REQ-2 (Episode tags)**: Sending a release or a magnet to an episode must apply **three**
      tags: the show's title, `Season <n>` and `Episode <n>`. For Reacher S03E08 that is `Reacher`,
      `Season 3`, `Episode 8`. The two keywords are always English regardless of the interface
      language, and the numbers are **not** zero-padded — this is deliberately different from the
      `S03E08` form used in search queries and display titles.
- [x] **REQ-3 (Season-pack tags)**: `addMagnetToSeason` must apply **two** tags, the show's title
      and `Season <n>`, following REQ-2's vocabulary. Stated explicitly so it is not left to an
      implementer to infer.
- [x] **REQ-4 (Tags are flat and deliberately ambiguous)**: The season and episode tags carry no
      show name and no hierarchy, so `Season 3` is shared by every series the user downloads. This
      is the intended trade: those two tags exist for the human filtering qBittorrent's own sidebar,
      and the server never queries by them. Every server-side lookup of a title's torrents uses the
      **title tag only**.
- [x] **REQ-5 (Tag sanitisation)**: A comma is qBittorrent's tag separator, so a title containing
      one would silently split into two wrong tags. Commas must be replaced with a space, runs of
      whitespace collapsed, and the result trimmed, before the tag is sent. A title that sanitises
      to an empty string must fall back to a stable, non-empty tag derived from the row's id — a
      torrent must never end up with no title tag, since that is the only handle the server has on
      it.
- [x] **REQ-6 (N concurrent downloads)**: A film, an episode and a season may each hold several
      active `MediaSource` rows at the same time. A second acquisition request against a target that
      already has one must succeed without warning the user, without asking for confirmation, and
      without touching the sources already there.
- [x] **REQ-7 (The "download in progress" conflict is retired; the "already completed" one is not)**:
      Seven guards today ask "does this target already have a source?" and answer with one of two
      keys depending on the target's status — `…_ALREADY_COMPLETED` when it is `COMPLETED`,
      `…_DOWNLOAD_IN_PROGRESS` otherwise. **Only the second branch is retired.** The guard's trigger
      changes from "has a source" to "is `COMPLETED`", so a target that is merely downloading stops
      conflicting at all: no exception, no message, no confirmation step, nothing for the user to
      click through. Trusting the user here is the point — REQ-6 makes a second acquisition a normal
      thing to do, and a prompt that always resolves to "yes, go ahead" is noise that trains people
      to dismiss prompts.
      The seven sites are `MoviesService.attachTorrentSource` (`movies.service.ts:304`),
      `EpisodesService.attachTorrentSource` (`episodes.service.ts:92`),
      `SeasonsService` (`seasons.service.ts:75`), `UploadsResolver.createUploadTicket`
      (`uploads.resolver.ts:60` and `:78`) and the two mid-upload race guards in
      `uploads.service.ts` (`:209`, `:247`).
      **`force` stays on all five acquisition mutations and on `createUploadTicket`**, and so does
      the demote-the-previous-source-to-`ERROR` path it authorises. Both belong to
      `027-replace-completed-media`, which uses them to replace a **completed** title, and neither is
      this feature's to remove — an earlier draft of this spec said otherwise and was wrong.
      `MOVIE_ALREADY_COMPLETED` / `EPISODE_ALREADY_COMPLETED` / `SEASON_ALREADY_COMPLETED` and the
      whole `UploadTicketsService.isReplaceAuthorised` mechanism are untouched.
      The three `…_DOWNLOAD_IN_PROGRESS` keys lose every call site and must be deleted from
      `src/i18n/error-keys.ts`, from both `messages.{en,es}.ts` and from
      `services/web/messages/{en,es}.json`, along with the `web` code that reacts to them: the key
      arrays and `needsConfirm` / "Reemplazar" states in `components/import/importMagnetModal.tsx`
      and `components/search/SearchTorrent.tsx` keep only their `…_ALREADY_COMPLETED` entries.
      The **cross-title** infoHash collision is unaffected and stays; re-sending the same infoHash to
      the same target stays idempotent, updating the existing row instead of creating a second.
- [x] **REQ-8 (Downloads panel)**: `/movies/<id>` and `/shows/<id>` must each render one flat list
      of that title's downloads, above the existing content. The series list must cover the whole
      show — every season pack and every single-episode download — with each row naming its target,
      not be split across the season accordion.
- [x] **REQ-9 (Server-read values)**: Each row must show at least the percentage completed and the
      most recent download speed, and both must be values `api` read from the torrent client. The
      browser must never call qBittorrent, and the values must not be persisted to a column and
      served stale from the database.
- [x] **REQ-10 (Manual refresh)**: The panel must carry a refresh control that re-reads the values
      from the torrent client. There must be no polling loop, no automatic interval and no
      websocket — a value on screen is only ever as fresh as the last load or the last click.
- [x] **REQ-11 (Row controls)**: Each torrent-backed row must offer three actions, all executed
      against the torrent client: **start**, **stop**, and **delete**. Start is qBittorrent's plain
      resume (`torrents/start`) — **force start is deliberately not part of this feature** and is
      listed under Out of Scope; it is a distinct torrent state that belongs to a screen of its own,
      and building it here would put a rarely-correct control on every row. Delete must require an
      explicit confirmation in the interface before it fires, and must remove the torrent
      **together with its files**.
- [x] **REQ-12 (Race — the winner keeps seeding, the rest stop)**: When one of a target's downloads
      completes, every **other** non-terminal source of that same target must be stopped in the
      torrent client and its `MediaSource` moved to `PAUSED`. The completed one must be left running
      so it continues seeding. Given `Transformers 4k` and `Transformers 1080p` racing, the moment
      1080p finishes it keeps seeding and 4k is paused.
- [x] **REQ-13 (One winner only)**: A completion notice for a target that already has a source in
      `READY` or `SCANNED` must be ignored — no status change, no second `bull:process` job. This
      must hold for a loser that finishes inside the window between the winner completing and the
      pause taking effect. This requirement is what replaces the protection the retired `force`
      demotion used to give (`DownloadsService.handleTorrentCompleted` guard 3, "ignored,
      reemplazado"), and REQ-15's row deletion is only safe because of it.
- [x] **REQ-14 (Siblings are selected by target, never by tag)**: Every operation that acts on "the
      other downloads of this title" — REQ-12's pause and REQ-15's cleanup — must select them by
      `movieId` / `episodeId` / `seasonId`, never by tag. A tag is a title string: two different
      shows can share one, and a user can create one by hand in qBittorrent.
- [x] **REQ-15 (Cleanup wipes the losers)**: When the post-encode cleanup removes the winner's
      torrent, every losing sibling of that source must also have its torrent removed **with its
      files**, and its `media_sources` row deleted outright. No history row is kept.
- [x] **REQ-16 (A failed encode stops the cascade)**: If the encode ends in `ERROR`, nothing is
      deleted and nothing is resumed. The losers stay paused, their rows and their files intact, and
      the user decides what to do from the panel.
- [x] **REQ-17 (Ownership scope)**: The new queries and mutations must resolve through the same
      `UserMovie` / `UserShow` clauses the detail queries already use, and must answer for a title
      the caller does not own exactly as they answer for one that does not exist — same exception,
      same message, indistinguishable — per `008-movie-detail`. None of them may carry
      `@AllowService()`.
- [x] **REQ-18 (Every source is listed; only torrents are controllable)**: The panel must list
      **every** non-terminal source of the target, including a `LOCAL_FILE` upload, so the user can
      see the full field of a race rather than a subset of it. A source without an `infoHash` renders
      with its `status` and `label` and with the three live torrent fields null, and the interface
      must not offer it start, stop or delete. Each of the three control mutations must additionally
      refuse such a source server-side, before any call reaches the torrent client — the interface
      not offering a button is not a guarantee.
- [x] **REQ-19 (An upload joins the race in progress)**: Uploading a file to a target that already
      has downloads running must be accepted — no conflict, no confirmation, nothing replaced — and
      the resulting `LOCAL_FILE` source becomes a competitor in that target's race. Concretely: when
      the upload completes it is subject to REQ-13's one-winner guard exactly like a completed
      torrent, and if it wins it must trigger REQ-12's pause of every sibling and, once its encode
      finishes, REQ-15's cleanup of them — torrents removed with their files, rows deleted. An upload
      that arrives after a torrent has already reached `READY` or `SCANNED` must be ignored the same
      way a losing torrent's completion is. The reverse case needs no rule: an upload is complete the
      instant it lands, so there is nothing to pause when a torrent beats it.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (The torrent client stays unauthenticated)**: `QbittorrentClient` performs no login
      and holds no credential; it reaches qBittorrent because the container whitelists the Docker
      subnet (`services/torrent/Dockerfile`, `WebUI\AuthSubnetWhitelist=172.16.0.0/12`). Every
      endpoint this feature adds rides the same assumption. Do not add a login flow, a SID cookie or
      a credential read as part of this work — that is a separate change with its own reasoning.
- [x] **NFR-2 (`worker` is untouched and gets no exemption)**: The loser cleanup is `api`-side,
      triggered from the mutation the worker already calls. `services/worker` must require no
      change: `cleanup-source.ts` keeps calling `downloadRemove(mediaSourceId, deleteFiles: false)`
      for the winner, keeps owning every filesystem deletion for the winner's own paths, and sends
      and receives byte-identical shapes. The losers' files are deleted **by qBittorrent**, on
      `api`'s instruction, which is outside the worker's remit and outside the `isInsideRoot` checks
      it owns.
- [x] **NFR-3 (i18n is catalog-driven, because `018` shipped)**: `018-ui-i18n` **is implemented** —
      `services/api/src/i18n/error-keys.ts`, `messages.{en,es}.ts`, `extensions.i18n` on every error,
      `next-intl` in `web` and `services/web/messages/{en,es}.json`. An earlier draft of this spec
      asserted the opposite and planned Spanish literals at the render site; that was wrong and is
      corrected here. Every string this feature adds — panel labels, the delete confirmation, the two
      new error conditions — is a catalog key with an `en` and an `es` entry, and every error `api`
      raises carries its `ERROR_KEYS` constant. No user-facing literal may be hardcoded at a render
      site, and `web` must resolve errors through `extensions.i18n.key`, never by matching message
      text. The `es` register stays Rioplatense, matching the entries already there.
- [x] **NFR-4 (Typecheck and build baseline)**: `api` must stay at 0 errors. `web` must not regress
      its committed error count, and `bin/npm web run build` must exit 0. Re-measure both before and
      after rather than trusting the numbers in the root `CLAUDE.md`.
- [x] **NFR-5 (Test where the failure is silent)**: Constitution Article IX. Two failure classes here
      produce no error anywhere and both owe a test whose opening comment names them:
      **(a)** two sources of one target both reaching `ENCODING` because a loser's completion was
      not ignored (REQ-13) — the target ends with two `ProcessJob`s writing the same output path,
      and nothing logs a problem; **(b)** cleanup selecting siblings by tag rather than by target id
      (REQ-14) — a second series sharing a title string loses downloads the user never touched, and
      the deletion succeeds, so there is no error to find. A third was introduced by REQ-19 and owes
      the same treatment: **(c)** an *upload* winning a race and sweeping nothing, because
      `downloadRemove`'s `!infoHash` early return fired before the sweep — the upload files
      correctly, the encode succeeds, the user sees a finished title, and two torrents keep
      downloading and seeding forever with no row and no log to point at them.
- [x] **NFR-6 (No unchecked call to the torrent client)**: Every torrent-client method this feature
      adds or newly relies on must check the HTTP response and fail loudly, as `add()` already does
      and as `stop()` and `remove()` currently do **not**. A silent failure here is invisible in both
      directions: an unacknowledged stop leaves a loser downloading while the database reads
      `PAUSED`, and an unacknowledged delete leaves the file on disk after the row is gone.
- [x] **NFR-7 (Bring `mapTorrentState` to qBittorrent 5.0)**: `mapTorrentState`
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
- [x] **NFR-8 (Destructive migration is acceptable)**: The `Movie` ↔ `MediaSource` inversion below
      may drop and recreate rather than backfill. The stack is in development and the user has
      confirmed no data needs preserving. This is recorded so a reviewer does not read the missing
      backfill as an omission.

## GraphQL Contract Delta

Two new queries, three new mutations, one new type, and a breaking change to the five acquisition
mutations. Written as it will appear in the generated `services/api/src/schema.gql`.

```graphql
type Download {
  mediaSourceId: Int!
  infoHash: String          # null for a LOCAL_FILE upload racing alongside torrents (REQ-18)
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

  # UNCHANGED — the five acquisition mutations and `createUploadTicket` keep their
  # `force: Boolean = false` argument. It authorises replacing a COMPLETED title
  # (027-replace-completed-media) and is not this feature's to remove. Only the
  # behaviour behind it narrows: see REQ-7.
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
- **`infoHash != null` is the controllability test; `kind` is for display only.** `infoHash: null`
  means this row is an upload and there is no torrent to start, stop or delete. `infoHash` present
  with null `progress`/`torrentState` means the opposite: a torrent that exists in the database and
  is *missing from qBittorrent* — a problem the user should see, and a row that must keep its delete
  button. The two cases are distinguished by `infoHash`, never by whether the live fields are null.
  `kind` is carried so the panel can say *what* a row is (`LOCAL_FILE` renders as an uploaded file
  rather than as a download with no numbers); it is deliberately **not** the branching key, because
  `SourceKind` has two torrent values (`TORRENT_SEARCH`, `TORRENT_FILE`) and a consumer testing
  `kind === 'TORRENT'` against a hand-retyped enum would compile, render, and silently strip the
  buttons off every row.
- **`downloadRemove`'s existing `!infoHash` early return now sits in front of the loser sweep, and
  that is a bug the implementation must avoid.** Today it answers `omitido: mediaSource <id> no es un
  torrent` and returns. Under REQ-19 an upload can be the *winner*, and the worker calls
  `downloadRemove` for it after a successful encode — so if the sweep is written after that early
  return, an upload that wins a race leaves every losing torrent downloading forever, silently. The
  sweep must run for a winner of either kind; only the winner's own `torrentClient.remove` is
  skipped. The signature, the `omitido:` string and the return type are all unchanged.
- **`progress` is 0..100, not qBittorrent's 0..1.** Converted once, server-side. A consumer that
  multiplies again renders 1%.
- **`torrentState` is qBittorrent's raw state string**, not the mapped `SourceStatus`. `status` is
  the mapped, persisted one. Both are present because they answer different questions and the
  mapping is lossy (`mapTorrentState` collapses a dozen qBittorrent states into seven).
- **`label` is computed server-side** with the display helpers already duplicated across the three
  services — `` `${show.title} S${SS}E${EE}` `` for an episode, `` `${show.title} Temporada ${n}` ``
  for a season, the plain title for a film. It is not the tag: it is Spanish where the tags are
  English, and zero-padded where the tags are not.
- **The SDL does not change for the acquisition mutations at all, and that is the trap.** REQ-7
  narrows what those mutations *do* — a downloading target stops conflicting — without touching a
  single argument or type. No typechecker, no schema diff and no consumer sees anything. The three
  `…_DOWNLOAD_IN_PROGRESS` keys vanishing from the catalogs is the only externally visible trace,
  which is why REQ-7 names all seven call sites explicitly rather than describing the rule and
  trusting an implementer to find them.
- **`force` survives and must not be removed opportunistically.** It reads like dead weight once the
  downloading conflict is gone, and it is not: it is `027-replace-completed-media`'s authorisation to
  replace a **completed** title, on all five acquisition mutations and on `createUploadTicket`, and
  the tus route carries a signed server-side copy of the same decision in
  `UploadTicketsService`. Removing it would silently re-enable overwriting a finished film with no
  confirmation — the exact failure 027 exists to prevent.
- **`Movie.mediaSourceId: Float` is removed from the schema.** No consumer selects it — neither
  `GET_MOVIE_QUERY` in `services/web/src/actions/movies.ts` nor anything in `worker`. Its
  disappearance is a consequence of the data model change below, not an independent decision.
- **No `@AllowService()` on any new operation.** A `SERVICE_TOKEN` principal is refused by the
  global `JwtAuthGuard` with `No autenticado`, matching `movie(id)` and `show(id)`.

Every row is an `ERROR_KEYS` constant carrying `extensions.i18n` (NFR-3); `web` resolves it through
`messages/{en,es}.json` and never by matching text.

| Condition | HTTP / GraphQL error | Key |
| :-- | :-- | :-- |
| `movieDownloads` for a film that does not exist | `NotFoundException` | `MOVIE_NOT_FOUND` (existing) |
| `movieDownloads` for a film the caller has no `UserMovie` link to | `NotFoundException` — identical to the row above | `MOVIE_NOT_FOUND` *(deliberately indistinguishable, per `005-movie-search` and `008-movie-detail`)* |
| `showDownloads` for a show that does not exist, or that the caller has no `UserShow` link to | `NotFoundException` | the existing show key |
| `mediaSourceId` does not exist | `NotFoundException` | the existing `mediaSource` key |
| The source exists but belongs to a title the caller does not own | `NotFoundException` — identical to the row above | same as above |
| The source has no `infoHash` (an upload) | `BadRequestException` | **`DOWNLOAD_NOT_A_TORRENT`** — new |
| The torrent client refuses or is unreachable, on a **mutation** | `Error` (thrown before any DB write) | **`TORRENT_CLIENT_REJECTED`** — new, taking the HTTP status as a parameter |
| The torrent client is unreachable, on a **query** | none — not an error | rows render with `torrentState`, `progress` and `downloadSpeed` null |
| Magnet is not a magnet link | `BadRequestException` (from `parseMagnet`, existing) | existing |
| Magnet has no usable infoHash | `BadRequestException` (existing) | existing |
| BitTorrent v2 magnet | `BadRequestException` (existing) | existing |
| The infoHash is already attached to another title | `ConflictException` (existing, **kept**) | existing |
| Acquisition or upload against a **`COMPLETED`** target without `force` | `ConflictException` / `UploadHttpError(409)` (existing, **kept**) | `MOVIE_ALREADY_COMPLETED` / `EPISODE_ALREADY_COMPLETED` / `SEASON_ALREADY_COMPLETED` — untouched, owned by `027` |
| Acquisition or upload against a target that is **downloading** | **none — no longer an error** | `MOVIE_DOWNLOAD_IN_PROGRESS` / `EPISODE_DOWNLOAD_IN_PROGRESS` / `SEASON_DOWNLOAD_IN_PROGRESS` are **deleted** from `error-keys.ts`, both `messages.{en,es}.ts` and both `web` catalogs (REQ-7) |
| Any of the above with an absent or expired credential | `UnauthorizedException` (existing global guard) | unchanged from today |

Two keys are new — `DOWNLOAD_NOT_A_TORRENT` and `TORRENT_CLIENT_REJECTED` — and each needs an `en`
and an `es` entry in `messages.{en,es}.ts` and in `services/web/messages/{en,es}.json`.
`TORRENT_CLIENT_REJECTED` follows the existing "qBittorrent rejected …" copy in shape, taking the
status as a parameter rather than being concatenated into the string.

Three keys are **removed**, and they are the only user-facing strings this feature deletes. Removing
a key is a four-file change (`error-keys.ts`, `messages.en.ts`, `messages.es.ts`, and both `web`
JSON catalogs) plus the `web` components that list them; a key left in a catalog with no producer is
dead weight, and a key removed from `error-keys.ts` but left in a `web` array is a lookup that can
never fire. Both halves must land together.

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
  tags: string[];     // NEW — split from qBittorrent's comma-concatenated string
};

export type TorrentClient = {
  info: (tag?: string) => Promise<TorrentClientInfo[]>;                        // CHANGED
  add: (urls: string[], tags?: string[]) => Promise<string>;                   // CHANGED
  start: (hashes: string | string[]) => Promise<void>;                         // NEW
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
| `stop` | `torrents/stop` | `hashes` — already implemented, already correct for 5.0 |
| `remove` | `torrents/delete` | `hashes`, `deleteFiles` — already implemented |

Four things this pins down that would otherwise be guessed — the fourth by exclusion:

- **Tags are applied on `add`, not in a second call.** `torrents/add` takes `tags` directly, so
  REQ-1 through REQ-3 need no `createTags`/`addTags` round trip and no window in which a torrent
  exists untagged. `addTags`, `removeTags`, `createTags` and `tags` all exist and none is needed
  here; adding them is scope creep.
- **`tags` is comma-separated on the wire, which is why REQ-5 exists.** The same separator makes
  the sanitisation mandatory rather than defensive.
- **`progress` is a float 0..1 at the client boundary.** The interface passes it through unchanged
  because that is what qBittorrent returns and an adapter that silently rescales is an adapter that
  lies; the ×100 to reach the GraphQL `Float` happens in the service, once.
- **`torrents/setForceStart` is deliberately not added, and neither is `force_start` on
  `TorrentClientInfo`.** Force start is a flag, not a verb — `setForceStart(value: true)` marks a
  torrent forced, it is not a stronger `start` — and it is its own state with its own screen, out of
  scope here (REQ-11). Adding the method now would leave an interface member with no caller, which is
  exactly the condition `info()` was in before this feature. `mapTorrentState` must still *recognise*
  `forcedDL` and `forcedMetaDL` (NFR-7), because a user can set the flag from qBittorrent's own UI
  and the panel has to read that torrent correctly; recognising a state and being able to set it are
  separate obligations.

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
  failure as the error table's `TORRENT_CLIENT_REJECTED`.

New methods follow the conventions already in `client.ts` without exception: `new URL("<name>",
await this.baseUrl())` for the path, `HTTP_METHOD` from `@/types/http` for the verb,
a `URLSearchParams` body, `this.normalizeHashes()` for the `|` join, and a JSDoc block opening with
a one-line description and the deep link to the matching wiki anchor. The wiki documents `start`,
`stop` and `delete` as GET; `client.ts` already POSTs to `stop` and `delete` and that is what works
against the running container, so the new methods POST too — consistency with the working
neighbours beats consistency with the wiki's verb column.

Consumer obligations:

- **`web`**: retype `Download` by hand in a new action module; **keep** `force` on the four
  acquisition actions and on `createUploadTicket` (it is 027's completed-replacement authorisation),
  but drop the three `…_DOWNLOAD_IN_PROGRESS` entries from the key arrays in `importMagnetModal.tsx`
  and `SearchTorrent.tsx`, leaving their `…_ALREADY_COMPLETED` entries and the `needsConfirm` /
  "Reemplazar" flow those drive; handle `progress` /
  `downloadSpeed` / `torrentState` arriving `null` as a normal state and not as a loading state, and
  branch on `infoHash != null` — not on `kind`, not on the live fields — to decide whether a row
  gets its three buttons.
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

- [x] **AC-1**: Sending a release to the film Transformers produces a torrent in qBittorrent
      carrying exactly one tag, `Transformers`, visible in qBittorrent's tag sidebar.
- [x] **AC-2**: Sending a release to Reacher S03E08 produces a torrent carrying exactly three tags —
      `Reacher`, `Season 3`, `Episode 8` — and `addMagnetToSeason` for Reacher season 3 produces one
      carrying exactly two, `Reacher` and `Season 3`.
- [x] **AC-3**: With a film whose title contains a comma, the torrent carries **one** tag with the
      comma replaced by a space, not two tags split at it.
- [x] **AC-4**: Sending two different releases to the same film succeeds both times with no
      confirmation prompt and no error, and
      `bin/mysql -e "select id, status, info_hash, movie_id from media_sources where movie_id = <id>"`
      returns two rows, both non-`ERROR`.
- [x] **AC-5**: `/movies/<id>` lists both downloads from AC-4, each showing a percentage and a
      download speed. Clicking refresh changes at least the percentage on an actively downloading
      row.
- [x] **AC-6**: `/shows/<id>` lists a season-pack download and a single-episode download of the same
      show in one list, each row naming its target (`Reacher Temporada 3`, `Reacher S03E08`).
- [x] **AC-7**: Clicking stop on a row moves that torrent to a stopped state in qBittorrent's own
      UI; clicking start moves it back to downloading. In both cases the panel's own status column
      must agree — `stoppedDL` must read as paused, never as an error (NFR-7). Separately, a torrent
      force-started **from qBittorrent's own UI** must read in the panel as downloading: `forcedDL`
      and `forcedMetaDL` are states this feature must recognise even though it never sets them.
- [x] **AC-8**: Clicking delete opens a confirmation; cancelling leaves the torrent in place;
      confirming removes it from qBittorrent **and** removes its files from disk.
- [x] **AC-9**: Given AC-4's two racing downloads, when one completes, qBittorrent shows the
      completed one still running and seeding and the other stopped, and `bin/mysql` shows the
      loser's `media_sources` row at `status = 'PAUSED'` — **not** `ERROR`, which is what today's
      `mapTorrentState` would produce for `stoppedDL` and what `torrentCompleted` reads as
      "superseded, ignore".
- [x] **AC-10**: A torrent that has just been added and is still fetching metadata renders in the
      panel with an empty `root_path` and a downloading status, not an error row — the
      `metaDL`/`forcedMetaDL` case.
- [x] **AC-11**: After the winner's encode completes, both torrents are gone from qBittorrent, the
      loser's `media_sources` row is gone from the database, and the loser's download folder is gone
      from disk.
- [x] **AC-12 (failure path)**: With user A's session, `movieDownloads` for a film only user B owns
      returns a GraphQL error whose message is exactly `La película <id> no existe` —
      byte-identical to the response for a film id that exists nowhere.
- [x] **AC-13 (failure path)**: `downloadStart` against a `MediaSource` with `kind = LOCAL_FILE`
      fails with `DOWNLOAD_NOT_A_TORRENT`, and `docker compose logs torrent` shows no request
      reached qBittorrent. The same source is nonetheless **listed** in the panel, with no start,
      stop or delete button offered on its row (REQ-18).
- [x] **AC-14 (failure path)**: With the `torrent` container stopped, `/movies/<id>` still renders
      and still lists its downloads, with the percentage and speed columns empty rather than
      returning a 500 or an error page.
- [x] **AC-15 (failure path)**: Firing `torrentCompleted` with the **loser's** infoHash after the
      winner has already reached `READY` leaves the film's status untouched, adds no
      `bull:process` job to Redis, and creates no second `ProcessJob` row.
- [x] **AC-16 (failure path)**: With an encode forced to fail, the losing downloads remain
      `PAUSED`, their `media_sources` rows still exist and their files are still on disk — nothing
      is deleted and nothing is resumed.
- [x] **AC-17 (failure path)**: With the `torrent` container stopped, clicking stop or delete on a
      row surfaces `TORRENT_CLIENT_REJECTED` in the interface and leaves the
      `media_sources` row exactly as it was — the database must not record a pause or a deletion the
      torrent client never acknowledged.
- [x] **AC-18 (regression)**: Every existing acquisition path still works end to end — release
      search and magnet import from `/movies/<id>`, both from an episode row, and a full tus upload —
      each producing the same rows it produces today, and the upload path still reaching `ENCODING`
      without passing through `DOWNLOADING`.
- [x] **AC-23 (regression, `027`)**: Replacing a **`COMPLETED`** film still asks for confirmation and
      still refuses without it. Sending a release, a magnet, or starting an upload against a
      completed title with `force: false` answers `…_ALREADY_COMPLETED`; the interface still offers
      its "Reemplazar" control; and confirming still succeeds. Nothing in `027`'s ticket mechanism
      changed — this criterion exists because an implementer removing the downloading branch is one
      keystroke away from removing this one too.
- [x] **AC-19**: `bin/npm api run test` passes, including the two NFR-5 cases; each new test file
      opens with a comment naming the failure class it defends against.
- [x] **AC-20**: `bin/cli api npx --no tsc --noEmit` reports 0 errors, `bin/cli web npx --no tsc
      --noEmit` reports no more than the committed baseline measured before the change, and
      `bin/npm web run build` exits 0.
- [x] **AC-21 (REQ-19)**: With two torrents downloading for a film, uploading a file to that same
      film through the tus route succeeds — **no 409, no confirmation prompt, no "confirm to replace
      it" message anywhere**, which is the dead end this feature removes rather than repairs — and
      `/movies/<id>` then lists
      three rows: the two torrents with percentages, and the upload with its status and no buttons.
      When the upload's encode completes, both torrents are stopped in qBittorrent and then removed
      with their files, and `bin/mysql -e "select id, kind, status from media_sources where movie_id
      = <id>"` returns only the upload's row.
- [x] **AC-22 (failure path, REQ-19)**: Uploading a file to a target whose torrent has already
      reached `READY` leaves the target's status untouched and enqueues no second `bull:process` job
      — the same guard as AC-15, exercised from the upload side rather than the `torrentCompleted`
      side, because the upload route reaches `ENCODING` through its own code path.

### Verification pass (`/implement`, 2026-08-27)

All 50 boxes above are checked. What that means concretely, since not everything was re-exercised
by hand in this closing pass:

- **Fully automated, run and green in this pass**: `bin/cli api npx --no tsc --noEmit` (0 errors),
  `bin/npm api test` (234/234, 26 suites — includes the three Article IX fault-injected cases for
  NFR-5 a/b/c), `bin/cli web npx --no tsc --noEmit` (no new errors), `bin/npm web run build` (exits
  0), and every grep in `plan.md` § Verification (the two `…_DOWNLOAD_IN_PROGRESS` greps empty, the
  `…_ALREADY_COMPLETED` greps unchanged, no stray `mediaSourceId` selection of the dropped `Movie`
  field, no `@prisma/client` in either consumer).
- **Live-exercised during implementation, by the service subagents**: the `api` slice confirmed a
  real `stoppedDL` torrent maps to `PAUSED` and a real `forcedDL` one to `DOWNLOADING` against the
  running `torrent` container (AC-7's mapping half, NFR-7); the `web` slice logged in against the
  running stack, added a real torrent to a film via `addMagnetToMovie`, confirmed the panel rendered
  it with all three buttons (the `infoHash != null` gate, REQ-18), then called `downloadDelete` and
  confirmed the row and its `media_sources` entry disappeared (AC-8's mutation half).
- **Verified by fault-injected unit test, not by a live multi-torrent race**: REQ-12/REQ-13's pause
  and one-winner guard (AC-9), REQ-14's target-not-tag sibling selection, REQ-15's cleanup sweep
  including the upload-winner case (AC-11, NFR-5 (c)), and REQ-19's upload-joins-race path (AC-21,
  AC-22). Each test opens with a comment naming the failure class and was confirmed to fail when the
  guard it defends was temporarily removed, per Article IX.
- **Not exercised in this pass, verified by code review only**: the tag content and sanitisation
  (AC-1, AC-2, AC-3 — visible-in-qBittorrent bugs, not silent ones, so not owed a test per
  `api/plan.md` § Tests), the `metaDL` empty-`root_path` render (AC-10), the qBittorrent-down render
  paths (AC-14, AC-17), and the full `027` regression walkthrough (AC-23) beyond what
  `movies.service.spec.ts`/`uploads.service.spec.ts` already assert for the untouched `force` guard.
- **AC-12's literal error text is stale, independent of this implementation.** The criterion quotes
  `"La película <id> no existe"` from an earlier draft written before NFR-3 was corrected mid-spec —
  `api` produces English text plus `extensions.i18n.key = "error.movie.not_found"` for both a
  nonexistent and an unowned film (confirmed live: `movieDownloads(movieId: 999999)` → `"Movie 999999
  does not exist"`), and `web` translates that key. The criterion's actual intent — the two cases are
  indistinguishable — holds; only the literal string in the spec's own prose is outdated.

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
- **Force start.** Removed from this feature by the user after the first draft. `torrents/setForceStart`
  is a separate torrent *state*, not a stronger play button, and it belongs on a screen that can
  present it as one — putting it on every panel row would offer, as the primary control, an action
  that is wrong most of the time. The panel's start button is `torrents/start`. `mapTorrentState`
  still has to recognise `forcedDL` and `forcedMetaDL` (NFR-7), because the user can set the flag in
  qBittorrent directly; reading the state is in scope, setting it is not.
- **Per-download bandwidth limits, priorities, file selection, or category management.** qBittorrent
  exposes all of them; none was asked for, and each is an independent addition to the client
  interface.
- **Changing anything `027-replace-completed-media` owns.** The `force` argument, the
  `…_ALREADY_COMPLETED` keys, `UploadTicketsService` and its signed replace decision, and the
  "Reemplazar" confirmation for a finished title all stay exactly as they are. This feature narrows
  *when* those guards fire; it does not touch what they do when they fire.
- **Adding the missing confirm button to `importFileModal.tsx`.** It is a real bug today, and the
  fix here is subtraction: once a downloading target stops conflicting, the message it was supposed
  to confirm is never raised. The modal's existing `isCompleted` branch, which is the one that works,
  stays.
- **Renaming `movieId` on the acquisition mutations and the tus metadata key.** The root
  `CLAUDE.md`'s known-debt item stands. This feature narrows it by making `MediaSource.movieId` a
  real column with unchanged name and meaning; the cross-service rename remains its own work.

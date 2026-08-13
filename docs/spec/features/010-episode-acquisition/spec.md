---
title: Per-Episode Acquisition (Search, Magnet, File)
spec_version: 0.1.0
author: Juan Farias
created_at: 2026-08-13
last_updated: 2026-08-13
status: Approved
services: [api, web]
---

# SPEC: Per-Episode Acquisition (Search, Magnet, File) (`spec.md`)

## Context & Goal

`009-show-detail` shipped `/shows/<id>` with a season accordion whose every episode row carries
three buttons — buscar, importar archivo, añadir torrent — that do nothing. That was deliberate:
its REQ-5 required the wiring to be written and commented out rather than deleted, and its AC-4
verifies that a click opens no modal and fires no request. The reason was never the UI. It was that
`api` has no episode-level acquisition surface at all: `MoviesResolver` exposes `addTorrentToMovie`
and `addMagnetToMovie`, `UploadsResolver` exposes `createUploadTicket(movieId)`, and
`ShowsResolver` (`services/api/src/shows/shows.resolver.ts`) exposes two queries and **zero
mutations**. A film has three ways into the download pipeline; an episode has none.

The data model, unusually, is already there and is not the obstacle.
`services/api/prisma/schema.prisma` gives `MediaSource` both `seasonId` and `episodeId`, and gives
`SourceFile` and `ProcessJob` an `episodeId` too. More of the downstream plumbing is episode-aware
than the pipeline table suggests: `MediaSourcesService.sourceScanned`
(`src/media-sources/media-sources.service.ts:119-128`) already writes `episodeId: mediaSource.episodeId`
onto the `ProcessJob` it creates, `ProcessJobsService` already branches on `processJob.episodeId` to
move `Episode.status`, the `MediaSource` GraphQL type already exposes `episodeId: Int`, and the
worker's `source-ready.job.ts` already selects that field. What is missing is narrower than it
looks, and it is in three places: nothing ever **creates** a `MediaSource` with an `episodeId`;
`DownloadsService.handleTorrentCompleted` (`src/downloads/downloads.service.ts`) includes only
`{ movie: true }` and so moves only a film to `ENCODING` when a download finishes; and
`sourceScanned` stamps `movieId` but not `episodeId` onto the `SourceFile` it upserts, and its
`matchedFilePath === null` branch marks only a `Movie` as `ERROR`, leaving an episode stuck in
`ENCODING` forever.

On the `web` side there is ported code from the old version that looks finished and is not. Worse
than not compiling, two of those files compile *and are wrong*:
`src/components/import/importMagnetModal.tsx` and `importFileModal.tsx` both accept
`item: Movie | Episode` and then call `importMagnetAction(Number(item.id), …)` and
`createUploadTicketAction(Number(item.id))` — which put an episode id into the `movieId` argument.
Both ids are `number`, so nothing fails to compile, nothing throws, and if a movie happens to share
that id the API cheerfully attaches the torrent to a film the user never asked for. Alongside them,
`src/components/search/SearchTorrent.tsx` already builds the `"{Show} S01E02"` query but stops at
`if (mediaType !== MEDIA_TYPE.MOVIE) return;`, and `src/components/search/SearchTorrentModal.tsx`
imports `MediaType, Episode, Movie` from `@prisma/client` — forbidden in `web` (Constitution,
Article II).

This feature makes the three episode buttons real, end to end on the `api` side: send the release
to qBittorrent, register the `MediaSource` against the episode, process qBittorrent's completion
callback for an episode, and enqueue `bull:process`. In the root `CLAUDE.md` pipeline table, the
**Find release (indexer)** and **Download** rows stop being film-only and cover a single episode
too; the **Browse library** row's note that the season accordion's buttons "are visible but inert"
becomes false and must be rewritten. The **worker is deliberately excluded** and gets its own spec:
recognising which file inside a release belongs to which episode, and building a series output
path, is its work, not this one's. Until that spec lands, an episode download reaches
`bull:process` and stops there — the same way `ProcessJob` rows already sit in `WAITING` for films.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Search modal, prefilled)**: The buscar button on an episode row must open a modal
      whose search input is pre-filled with the show's title, the season and the episode in
      `<Title> S<season>E<episode>` form, both numbers zero-padded to two digits (a show named
      Reacher, season 4, episode 1 gives `Reacher S04E01`). The field must be editable before
      submitting.
- [ ] **REQ-2 (Search results)**: Submitting that field must query the indexer and list the
      returned releases with the same columns the film search already shows.
- [ ] **REQ-3 (Scrolling body, fixed header)**: In that result list the column header must stay
      visible while the rows scroll. Only the body scrolls; the header does not move with it.
- [ ] **REQ-4 (Filter results)**: The user must be able to narrow the listed results before
      choosing one.
- [ ] **REQ-5 (Send a release to the episode)**: Clicking a result must send that release to
      qBittorrent and register it **against the episode**. No path in this feature may attach an
      episode's acquisition to a `Movie` row.
- [ ] **REQ-6 (Magnet)**: The magnet button must open a modal where the user pastes a magnet link,
      behaving as the film magnet modal does — including its two-step in-modal replace confirmation
      — and registering the result against the episode.
- [ ] **REQ-7 (File)**: The file button must open a resumable upload modal equivalent to the film
      one (tus, pause/resume/cancel), and the finished upload must be registered against the
      episode.
- [ ] **REQ-8 (Ownership scope)**: All three operations must require that the calling user is
      linked through `UserShow` to the show the episode belongs to. An episode that does not exist
      and an episode belonging to another user's show must be indistinguishable to the caller —
      same message, same error type — exactly as `attachTorrentSource` already treats films.
- [ ] **REQ-9 (One active source per episode)**: An episode may accumulate several `MediaSource`
      rows over time, but only one may be active at a time. A request against an episode that
      already has an active source must be refused with a conflict the user can override with a
      `force` flag, mirroring the film behaviour. When the user forces a replacement, the previous
      active source must be moved to `ERROR` with an explanatory `errorMessage`, so that a late
      `torrentCompleted` for the superseded infoHash cannot move the episode.
- [ ] **REQ-10 (Completion)**: When an episode's download completes, `torrentCompleted` must move
      that episode to `ENCODING` and enqueue `bull:process`, the same way it already does for a
      film. An episode whose scan reports no video file must be moved to `ERROR`, not left in
      `ENCODING`.
- [ ] **REQ-11 (Supersedes 009's inert buttons)**: This feature explicitly supersedes
      `009-show-detail`'s **REQ-5** (buttons must be inert, wiring commented out) and its **AC-4**
      (a click must open no modal and fire no request). Both are inverted here; `009`'s spec must
      be annotated to say so rather than left contradicting this one.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (`movieId` is not renamed)**: `docs/spec/graphql-contract.md` records that
      `006-media-search` renamed `MediaSearchResult.movieId` → `mediaId` because that field's
      *meaning* changed, and that three other occurrences of the same string mean something else
      and must not follow: the argument on `addTorrentToMovie`/`addMagnetToMovie`/
      `createUploadTicket`, the **tus upload metadata key**, and `MediaSource.movieId`, which the
      worker reads in `services/worker/src/jobs/source-ready.job.ts`. This feature touches two of
      those three, so the rule is restated as a requirement: add `episodeId` **beside** `movieId`,
      never generalise one into the other, and leave the three film operations byte-identical.
      Renaming them breaks no compile in any service — it breaks the download pipeline at runtime,
      in the worker, with no error logged anywhere. The unification itself is recorded as dated debt
      in the root `CLAUDE.md` → `## Known debt`; NFR-1 freezes the situation for the duration of
      this feature, it does not decide against the rename.
- [ ] **NFR-2 (No Prisma types in `web`)**: `SearchTorrentModal.tsx` must be ported to the current
      structure — typed against the shapes the actions return (`Episode` from `@/actions/shows`,
      `MEDIA_TYPE` from `@/types/media`), the way `009-show-detail` ported `Show.tsx` and
      `SeasonAccordion.tsx`. The file is fixed, not deleted. Criterion:
      `grep -rn "@prisma/client" services/web/src` returns nothing (Constitution, Article II).
- [ ] **NFR-3 (Typecheck baseline)**: `api` must stay at 0 errors. `web` must drop from 12
      committed errors to **exactly 11**, across **4** files — `ResultsForm.tsx` (5),
      `SearchForm.tsx` (2), `ImportMagnetSeasonModal.tsx` (2), `importFolderModal.tsx` (2). The one
      error removed is `SearchTorrentModal.tsx`'s `@prisma/client` import, by NFR-2. The 7 errors
      currently visible in `SeasonAccordion.tsx` come from an uncommitted work-in-progress diff, are
      not part of the baseline, and must be gone — that file is rewritten here.
- [ ] **NFR-4 (Worker untouched)**: `services/worker` must require no change and must be granted no
      compensating exemption. Its `mediaSource` query already selects `episodeId` and `sourceScanned`
      keeps its exact signature, so nothing it sends or receives changes shape.
- [ ] **NFR-5 (Test the silent failure)**: Constitution Article IX does not ask for coverage, it
      asks for a test wherever a bug produces no error anywhere — and this feature's central bug
      class is already demonstrable in the current tree. `importMagnetModal.tsx` accepts
      `item: Movie | Episode` and passes `item.id` to the `movieId` argument of `addMagnetToMovie`.
      Both are `number`, so there is no compile error; if episode 47 and movie 47 both exist, the
      API finds the *movie*, attaches the torrent, and returns success — no exception, no log, and a
      magnet welded to a film the user never touched. A test must fix the invariant: an episode id
      does not resolve through the film path, and the new mutations write `episodeId` and never
      `movieId`. The test file opens with a comment naming this failure class, as the article
      requires.
- [ ] **NFR-6 (Existing film paths unchanged)**: `addTorrentToMovie`, `addMagnetToMovie` and the
      film upload flow must keep working with no change to their SDL beyond `createUploadTicket`'s
      argument nullability, and no change to their behaviour.

## GraphQL Contract Delta

Smaller than it first appears, because `MediaSource.episodeId` is **already** in the schema
(`services/api/src/media-sources/entities/media-source.entity.ts`) and the worker already selects
it. Nothing is added to `MediaSource`, and nothing is added to the `Episode` type from
`009-show-detail`: after a mutation, `web` calls `router.refresh()`, which refetches `show(id)`,
which already carries `Episode.status`. A field with no consumer is not added here, following
`008-movie-detail`'s reasoning about `@AllowService()`.

```graphql
type Mutation {
  addTorrentToEpisode(
    episodeId: Int!
    infoHash: String!
    urls: [String!]!
    releaseTitle: String
    force: Boolean = false
  ): Episode!

  addMagnetToEpisode(episodeId: Int!, magnet: String!, force: Boolean = false): Episode!

  # CHANGED: was createUploadTicket(movieId: Int!): UploadTicket!
  # Both arguments are now nullable; exactly one must be supplied.
  createUploadTicket(movieId: Int, episodeId: Int): UploadTicket!
}
```

Notes the SDL cannot carry:

- **`createUploadTicket` is the one breaking change in this delta.** `movieId` goes from `Int!` to
  `Int`. It has exactly one consumer, `createUploadTicketAction` in
  `services/web/src/actions/uploads.ts`, updated in the same delivery. Supplying both ids, or
  neither, is an error rather than a silent preference for one — a caller that passes both has a
  bug, and picking a winner would hide it. The signed ticket payload gains `episodeId` alongside
  `movieId`, and `verifyAndSpend` binds the ticket to whichever one it was minted for.
- **The tus upload metadata gains an `episodeId` key beside `movieId`.** The `movieId` key keeps its
  name and meaning (NFR-1). `onUploadFinish` requires exactly one of the two, matching the ticket
  it verified in `onUploadCreate`; a mismatch between the ticket's target and the metadata's target
  is refused, not reconciled.
- **`sourceScanned` does not change signature.** `sourceScanned(mediaSourceId, files, matchedFilePath)`
  stays exactly as it is, and the worker sends exactly what it sends today. What changes is
  `api`-side semantics: the `SourceFile` it upserts is stamped with `episodeId` as well as
  `movieId` (today only `movieId`), and its `matchedFilePath === null` branch moves an `Episode` to
  `ERROR` the same way it already moves a `Movie`. This is a semantics-only change recorded here
  because no typechecker crosses that boundary.
- **`torrentCompleted` does not change signature either.** It keeps matching exclusively by
  `infoHash` and keeps silently ignoring unknown hashes. Its `include` gains `episode`, and it moves
  an episode to `ENCODING` where today it moves only a film.
- **Return type is `Episode!`, not `Show!`.** The film mutations return the `Movie` they acted on;
  these return the `Episode`, so a caller can read the new `status` off the response without
  refetching the whole show.
- **No `@AllowService()` on either new mutation.** No machine caller needs them; a `SERVICE_TOKEN`
  request is refused by the global guard with `No autenticado`, the same as `show(id)`.
- **Reused, not invented, error strings.** Every message below either already exists verbatim in
  `services/api/src` or follows the established `El <entity> <id> no existe` shape already used by
  `El mediaSource <id> no existe` and `El processJob <id> no existe`.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `episodeId` does not exist | `NotFoundException` | `El episodio <id> no existe` |
| Episode exists, caller has no `UserShow` link to its show | `NotFoundException` — identical to the row above | `El episodio <id> no existe` *(deliberately indistinguishable, per `005-movie-search` and `008-movie-detail`)* |
| Episode already has an active `MediaSource`, `force` not set | `ConflictException` | `Este episodio ya tiene una descarga en curso. Confirmá para reemplazarla.` |
| The infoHash is already attached to another title | `ConflictException` | `Ese magnet ya está asociado a «<title>»` — for an episode source the title renders as `<Show> S04E01` |
| Magnet is not a magnet link | `BadRequestException` (from `parseMagnet`) | `No parece un magnet link` |
| Magnet has no usable infoHash | `BadRequestException` | `El magnet no tiene un infoHash válido` |
| BitTorrent v2 magnet | `BadRequestException` | `Magnet de BitTorrent v2, todavía no soportado` |
| qBittorrent refuses the torrent | `Error` (existing, thrown before any DB write) | `qBittorrent rechazó el torrent (<status>)` |
| `createUploadTicket` with both ids, or with neither | `BadRequestException` | `Indicá exactamente uno de movieId o episodeId` |
| Upload metadata targets a different entity than the ticket | `UploadHttpError(403)` | `El permiso de subida no corresponde a este episodio` |
| Any of the above with an absent/expired credential | `UnauthorizedException` (existing global guard) | unchanged from today |

Consumer obligations:

- **`web` — actions**: `src/actions/shows.ts` (or a sibling) gains the two episode mutations;
  `createUploadTicketAction` is updated for the new nullable arguments and must name its argument
  explicitly rather than passing a bare id positionally, which is how the current bug got in.
- **`web` — modals**: `importMagnetModal.tsx` and `importFileModal.tsx` must dispatch on
  `mediaType` and call the episode operation for an episode. Passing an episode id to a film
  operation is the defect NFR-5 tests against; it must become impossible to express, not merely
  avoided by convention.
- **`web` — search**: `SearchTorrent.tsx`'s `if (mediaType !== MEDIA_TYPE.MOVIE) return;` guard is
  removed and replaced by a real branch. The conflict string
  `Esta película ya tiene una descarga en curso` is currently matched by substring in two places;
  those matchers must handle the episode wording too, or the replace-confirmation flow silently
  stops offering the override.
- **`worker`**: **no obligation.** It sends and receives the same shapes. Its inability to match a
  file inside a season pack to an episode is real and is the next spec's subject, not a contract
  change here.

## Data Model Changes

**None.** Every column this feature needs already exists in `services/api/prisma/schema.prisma`:
`MediaSource.episodeId`, `SourceFile.episodeId` and `ProcessJob.episodeId`, all nullable, all with
their relations declared. No migration.

One asymmetry must be handled in code because the schema does not express it. A film owns its
source (`Movie.mediaSourceId Int? @unique`), so "one source per film" is a database constraint. An
episode is the *pointed-at* side (`MediaSource.episodeId`), so an episode can have many sources and
nothing stops it. REQ-9's "one active source per episode" is therefore an application invariant:
active is defined as a `MediaSource` with that `episodeId` whose `status` is not `ERROR`, and the
`force` path is what keeps at most one such row by demoting the previous one. Adding a unique index
instead was considered and rejected — an episode legitimately accumulates historical failed
attempts, which is exactly what a unique constraint would forbid.

## Acceptance Criteria

- [ ] **AC-1**: Given a show the caller owns, clicking buscar on the row for season 4 episode 1 of a
      show named Reacher opens a modal whose input reads exactly `Reacher S04E01`, and the field can
      be edited before submitting.
- [ ] **AC-2**: Submitting that search lists indexer results. With more results than fit the modal,
      scrolling the list keeps the column header fixed in place while the rows move under it
      (verified visually and by the header remaining in the viewport at scroll bottom).
- [ ] **AC-3**: Typing in the filter control narrows the listed results without re-querying the
      indexer.
- [ ] **AC-4**: Clicking a result creates one `media_sources` row with `episode_id` set to that
      episode and `movie_id` unset, and the episode's status becomes `DOWNLOADING`. Verify with
      `bin/mysql -e "select id, kind, status, episode_id, info_hash from media_sources order by id desc limit 1"`
      and by reloading `/shows/<id>`.
- [ ] **AC-5**: Pasting a valid magnet in the magnet modal produces the same result as AC-4 with
      `kind = TORRENT_FILE`, and the episode row shows `DOWNLOADING` after the modal closes.
- [ ] **AC-6**: Uploading a file through the file modal completes, produces a `media_sources` row
      with `kind = LOCAL_FILE`, `status = READY` and `episode_id` set, and moves the episode to
      `ENCODING` — without ever passing through `DOWNLOADING`, matching the film upload path.
- [ ] **AC-7**: Firing `torrentCompleted` with the infoHash from AC-4 moves that `media_sources`
      row to `READY`, moves the **episode** to `ENCODING`, and enqueues one `bull:process` job
      (visible in Redis and in `docker compose logs api`). The show's other episodes are untouched.
- [ ] **AC-8 (failure path)**: With user A's session, calling `addTorrentToEpisode` for an episode
      of a show only user B owns returns a GraphQL error whose message is exactly
      `El episodio <id> no existe` — byte-identical to the response for an episode id that exists in
      no show at all. No `media_sources` row is created.
- [ ] **AC-9 (failure path)**: A second acquisition request against an episode that already has an
      active source, with `force` unset, fails with
      `Este episodio ya tiene una descarga en curso. Confirmá para reemplazarla.` and creates no
      row. Retrying with `force: true` succeeds, and the previously active `media_sources` row is
      then `status = ERROR` with a non-null `error_message`.
- [ ] **AC-10 (failure path)**: Following AC-9, firing `torrentCompleted` with the **superseded**
      infoHash leaves the episode in the state the replacement put it in — the demoted source does
      not move the episode.
- [ ] **AC-11 (failure path)**: `createUploadTicket(movieId: 1, episodeId: 1)` and
      `createUploadTicket` with neither argument both fail with
      `Indicá exactamente uno de movieId o episodeId`, and no ticket `jti` is written to Redis in
      either case.
- [ ] **AC-12 (failure path)**: Pasting `not-a-magnet` into the episode magnet modal surfaces
      `No parece un magnet link` in the modal, and no `media_sources` row is created.
- [ ] **AC-13 (failure path)**: A completed episode download whose folder contains no video file
      leaves the `media_sources` row `ERROR` **and** the episode `ERROR` — not stuck in `ENCODING`.
- [ ] **AC-14 (regression)**: The three film paths still work unchanged end to end — release search
      from `/movies/<id>`, magnet import, and a full tus upload — each producing the same rows they
      produce today.
- [ ] **AC-15**: `bin/npm api test` passes, including the NFR-5 case asserting that an episode id
      does not resolve through the film path and that the new mutations write `episodeId`, never
      `movieId`. The new test file opens with a comment naming that failure class.
- [ ] **AC-16**: `bin/cli api npx --no tsc --noEmit` reports 0 errors, and
      `bin/cli web npx --no tsc --noEmit` reports exactly 11 across the 4 files named in NFR-3 —
      none of them a file this feature touches.
- [ ] **AC-17**: `grep -rn "@prisma/client" services/web/src` returns nothing.
- [ ] **AC-18**: `009-show-detail/spec.md` records that its REQ-5 and AC-4 are superseded by this
      feature, and the root `CLAUDE.md` no longer describes the episode buttons as inert.

## Out of Scope

- **The worker.** Explicit decision. Recognising which file inside a downloaded release belongs to
  which episode, building a series output path, and running the episode encode all live in
  `services/worker` and get their own spec. Until it lands, an episode's `MediaSource` reaches
  `bull:process` and the pipeline stops there — the same place films already stop, since transcode
  has never been started. This feature is complete without it: everything it claims is `api`-side
  and independently verifiable.
- **Season-level bulk actions.** Importing a whole folder, or one magnet covering an entire season,
  stays out. `src/components/import/importFolderModal.tsx` and `ImportMagnetSeasonModal.tsx` are
  **kept exactly as they are** — not deleted, not repaired — and their `@/actions/jobs` import is
  not created here. They keep contributing 4 of the 11 baseline errors in NFR-3. A season pack is
  only useful once the worker can split it, which is the previous bullet.
- **`ResultsForm.tsx` and `SearchForm.tsx`.** Dead ported files, referenced by nothing, contributing
  7 of the 11 baseline errors. Cleaning them up is unrelated to this feature and would blur what
  NFR-3 is measuring.
- **Generalising `addTorrentToMovie` into `addTorrentToMedia`.** Considered and rejected. It is the
  tidier schema, but it renames `movieId` in exactly the places
  `docs/spec/graphql-contract.md` warns not to, across three services with no codegen between them,
  as part of a feature whose real subject is elsewhere. The twin-mutation shape leaves the working
  film pipeline byte-identical. The unification is recorded as dated debt in the root `CLAUDE.md`
  instead (NFR-1) — this is a scheduling decision, not a verdict.
- **A separate `createEpisodeUploadTicket` mutation.** The twin pattern would argue for it, and it
  would avoid the one breaking SDL change in this delta. Rejected because the tus flow behind it is
  a single endpoint with a single ticket mechanism: two mutations minting structurally identical
  tickets for one `onUploadCreate` to verify would duplicate the branch rather than remove it.
- **Showing acquisition progress on the episode row.** The row keeps rendering `Episode.status`, as
  `009-show-detail` built it. Percentage, release title, or a link to the running torrent would need
  new fields on the `Episode` type with no consumer today.
- **`@AllowService()` on the new mutations.** No worker code path calls them. Adding the grant now
  would open an unscoped write path with zero consumers, which is how an escape hatch outlives its
  reason (`008-movie-detail` made the same call for `movie(id)`).

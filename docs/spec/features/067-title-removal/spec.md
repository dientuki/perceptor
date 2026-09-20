---
title: Title Removal
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-09-20
last_updated: 2026-09-20
status: Approved
services: [api, web]
---

# SPEC: Title Removal (`spec.md`)

## Context & Goal

Perceptor can register a title and can now unwind a single download (`047-source-deletion`), but it
has no way to get rid of the title itself. Once a film, a short or a series is registered it stays in
`/movies`, `/shorts` or `/shows` forever: a title added by mistake, a series the user stopped caring
about, or a film registered against the wrong TMDB entry can only be emptied of its downloads, never
removed. `MoviesResolver`/`ShowsResolver` expose no deletion mutation at all today — the operations
are `addTorrentToMovie`, `addMagnetToMovie`, `setMoviePreferredTrackLanguages`,
`setMovieAudioMandatory`, `setMovieShort`, `setMovieContentKind` and the `shows` twins — and `web`'s
`/movies/[id]` and `/shows/[id]` detail pages have no control for it.

The shape of the removal is decided by the ownership model already in the schema. `Movie` and `Show`
rows are **global** (`tmdbId @unique`); whose library a title is in lives in the `UserMovie`/`UserShow`
join tables, whose own comments say so. So deleting a title means two different things depending on
who else holds it: if another user still owns the same title, the only thing that may disappear is
the caller's `UserMovie`/`UserShow` row — the title, its seasons, its episodes, its sources and its
jobs all stay, because they belong to that other user's pipeline too. If the caller is the **last**
owner, nothing is left pointing at the title and the whole registration goes: the row, its cascaded
seasons/episodes/sources/jobs, and — reusing exactly the unwind `047` already performs per source —
the live torrents, the running encode, the queue entries and the downloads-side residue.

Two boundaries are non-negotiable and shape the feature rather than decorate it. **Article XII**: the
finished file under the destinations root is never touched, so a `COMPLETED` title that is removed
leaves its transcoded file in the library, orphaned and intact, and the same title can be registered
again from search as if it were new. And the **debug history survives**: `FfprobeLog` is already
append-only with no relation to any media row, written that way precisely so it outlives the cascades
— every ffprobe of every file of a removed title stays queryable. Nothing else of the pipeline is
kept, and no new audit table is introduced.

This touches the **Browse library** stage of the root `CLAUDE.md` pipeline table (the three resolvers
plus `/movies`, `/shorts`, `/shows` and their detail pages) and, for the last-owner case, reaches
into the **Download** and **Transcode** stages the same way `047` does — it cancels them, it does not
change them. `worker` is untouched: an encode is stopped through the existing `encode:cancel` Redis
channel, which the worker already honours.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Remove A Film)**: Must let the owner of a film remove it from Perceptor from the film's
      own detail page, whether it is a feature film or a short.
- [ ] **REQ-2 (Remove A Series)**: Must let the owner of a series remove it from Perceptor from the
      series' own detail page. The removal is always the whole series; a season or a single episode is
      not separately removable.
- [ ] **REQ-3 (Shared Title Drops The Reference Only)**: Must, when at least one **other** user still
      owns the title, remove only the caller's ownership row and leave the title, its seasons, its
      episodes, its sources, its jobs, its torrents and its files untouched. The caller's per-title
      preferences (language picks, `audioMandatory`) go with that row.
- [ ] **REQ-4 (Last Owner Removes The Title)**: Must, when the caller is the only remaining owner,
      remove the title itself from Perceptor together with everything the pipeline attached to it —
      for a series that includes every season and every episode.
- [ ] **REQ-5 (In-Flight Work Is Unwound)**: Must, in the REQ-4 case, cancel and clean up everything
      still in flight for the title: every torrent removed from the torrent client **with its files**,
      every running or queued encode cancelled, every queue entry withdrawn, and every source's
      residue under the downloads root deleted. This is the same unwind `047-source-deletion`
      performs for one source, applied to every source of the title.
- [ ] **REQ-6 (Library File Is Never Touched)**: Must never delete, move or rename anything under the
      destinations root. A removed `COMPLETED` title leaves its transcoded file in the library
      (Constitution, Article XII).
- [ ] **REQ-7 (Removal Is Confirmed)**: Must ask the user to confirm before removing, and the
      confirmation must state which of the two outcomes will happen — which means the detail page
      must be able to read, before the removal, whether anyone else owns the title — "se quita de tu biblioteca" when
      another user still holds the title, "se elimina de Perceptor" when the caller is the last owner
      — and, when the title has a file in the library, that the file itself stays.
- [ ] **REQ-8 (Re-Registration Is Clean)**: Must leave a removed title registrable again from search
      as a brand-new registration, with no leftover row keeping the old state.
- [ ] **REQ-9 (Debug History Survives)**: Must leave every `FfprobeLog` row written for the removed
      title's files in place and queryable after the removal.
- [ ] **REQ-10 (Not Yours, Not There)**: Must refuse a removal of a title the caller does not own, or
      that does not exist, with the same indistinguishable not-found refusal the other per-title
      mutations already use.
- [ ] **REQ-11 (After Removal The User Lands Somewhere)**: Must send the user off the detail page once
      the removal succeeds, to the listing the title came from, and that listing must no longer show
      the title.
- [ ] **REQ-12 (Disabled Type Refuses)**: Must refuse a removal of a media type the installation has
      disabled (`movies_enabled`/`shows_enabled`, `045`), the same way the other per-title mutations do.
- [ ] **REQ-13 (Refusals Are Translated)**: Must show the two not-found refusals in the user's own
      language, which means adding `errors.movie.not_found` and `errors.show.not_available` to both
      `services/web/messages/en.json` and `es.json` — neither key exists in either catalog today, so
      both currently render `api`'s English fallback even in a Spanish session.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No Schema Change)**: Must need no Prisma migration. The cascades REQ-4 relies on
      (`UserMovie`/`UserShow`, `Season`, `Episode`, `MediaSource`, `SourceFile`, `ProcessJob`) are
      already declared `onDelete: Cascade`, and `FfprobeLog` is already relation-free.
- [ ] **NFR-2 (Torrent Client Failure Aborts)**: Must not remove any row, file or queue entry if the
      torrent client rejects the removal or is unreachable — the same ordering guarantee `047` gives:
      the torrent-client step runs first and is the only step that can fail the mutation.
- [ ] **NFR-3 (Disk Failure Does Not Block)**: Must not fail the mutation because residue under the
      downloads root could not be deleted; the failure is logged and the removal completes, so a user
      is never stuck unable to remove a title.
- [ ] **NFR-4 (Worker Untouched)**: Must require no change in `services/worker`. A cancelled encode is
      cancelled through the existing `encode:cancel` channel; `git diff --stat services/worker` is
      empty when the feature closes.
- [ ] **NFR-5 (Idempotent Enough)**: Must treat a second removal of a title already removed as the
      ordinary not-found refusal (REQ-10), never as a partial delete or a 500.

## GraphQL Contract Delta

Two mutations, one per media type — the same deliberate `movies`/`shows` duplication
`006-media-search` § Out of Scope keeps, not one generalized `removeMedia`.

```graphql
type Movie {
  """How many *other* users have this film in their library. 0 when the caller is the last owner."""
  otherOwners: Int!
}

type Show {
  """How many *other* users have this series in their library. 0 when the caller is the last owner."""
  otherOwners: Int!
}

type Mutation {
  removeMovie(id: Int!): TitleRemoval!
  removeShow(id: Int!): TitleRemoval!
}

"""The outcome of removing a title from the caller's library."""
type TitleRemoval {
  """True when the caller was the last owner and the title itself was deleted from Perceptor."""
  deleted: Boolean!

  """How many users still own the title after this removal. 0 when `deleted` is true."""
  remainingOwners: Int!
}
```

`TitleRemoval` is the one piece of surface the boolean of `downloadDelete` could not carry: `web` has
to tell the user which of the two things happened, and it cannot infer it from a `Boolean!`.

`Movie.otherOwners`/`Show.otherOwners` exist because REQ-7 needs the answer **before** the mutation
runs: the confirmation dialog has to say "se quita de tu biblioteca" or "se elimina de Perceptor",
and a return value only arrives after the removal it is meant to warn about. Both are
`@ResolveField`s in the same family as `audioMandatory`/`audioLanguages` — computed per caller, only
when the client selects them, never stored. Only the two detail pages select them; no listing does.
`web` treats `otherOwners > 0` as "drop my reference" and `0` as "delete from Perceptor", and must
treat the value as advisory: another user can register the same title between the page render and
the confirm, so the authoritative answer is always the `TitleRemoval` the mutation returns.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `removeMovie` for a film id that does not exist, or that the caller does not own | `NotFoundException`, `error.movie.not_found` (existing) | `La película {id} no existe` — **new `web` catalog entry**, see REQ-13 |
| `removeShow` for a series id that does not exist, or that the caller does not own | `NotFoundException`, `error.show.not_available` (existing) | `Recurso no disponible para este usuario` — **new `web` catalog entry**, see REQ-13 |
| `removeMovie` while `movies_enabled` is false, `removeShow` while `shows_enabled` is false | `ForbiddenException`, `error.media.type_disabled` (existing) | unchanged from `045` |
| The torrent client rejects the removal, or is unreachable (last-owner path only) | `ServiceUnavailableException`, `error.download.torrent_client_rejected` (existing) | `El cliente de torrents rechazó la solicitud ({status})` |
| No authenticated session | `error.auth.unauthenticated` (existing) | unchanged |

No new error key is introduced on the `api` side. Every condition reuses a key already in
`services/api/src/i18n/error-keys.ts` and in the vocabulary table of
`docs/spec/graphql-contract.md`.

Two of them, however, have **no entry in `web`'s catalogs today** — neither
`services/web/messages/en.json` nor `es.json` defines `errors.movie.not_found` or
`errors.show.not_available`, so both currently fall back to `api`'s English text
(`Movie {id} does not exist`, `Resource not available for this user`) regardless of the user's
locale. This feature is the first to put either in front of a user in a dialog, so it adds them
(REQ-13). That is a catalog addition, not a contract change.

**What `web` does with each.** `removeMovie`/`removeShow` are called from a server action; the action
translates through `translateGraphQLError` and returns the message to the confirmation dialog, which
stays open showing it rather than navigating. `error.movie.not_found`/`error.show.not_available` and
`error.media.type_disabled` are terminal — the dialog shows the message and the only remaining action
is closing it. `error.download.torrent_client_rejected` is retryable: the dialog keeps the confirm
button enabled, since NFR-2 guarantees nothing was removed. On success the action revalidates the
listing and redirects per REQ-11.

**`worker` has no obligation.** It observes a removal only as an `encode:cancel` publish it already
handles (`047`) and, for a job whose row disappeared, as the `error.processJob.not_found` its own
report path already tolerates.

## Data Model Changes

None.

Every cascade REQ-4 depends on is already declared in `services/api/prisma/schema.prisma`:
`UserMovie.movie`/`UserShow.show`, `Season.show`, `Episode.season`, `MediaSource.movie`/`.season`/
`.episode`, `SourceFile.mediaSource`, `ProcessJob.sourceFile`, and the per-title language rows keyed
through `UserMovie`/`UserShow`. `FfprobeLog` and `MediaServerItem` deliberately carry no relation to
any media row and are untouched by the delete.

## Acceptance Criteria

- [ ] **AC-1**: Given a film only user A owns, when A confirms removal on `/movies/<id>`, then A lands
      on `/movies`, the film is gone from the listing, and `bin/mysql -e 'select count(*) from movies
      where id = <id>'` returns 0.
- [ ] **AC-2**: Given a film users A and B both own, when A confirms removal, then the film is gone
      from A's `/movies` but still listed for B, `bin/mysql -e 'select count(*) from movies where id =
      <id>'` returns 1, and `select count(*) from user_movies where movie_id = <id>` returns 1.
- [ ] **AC-3**: Given a series only user A owns with three seasons registered, when A confirms removal
      on `/shows/<id>`, then `select count(*) from seasons where show_id = <id>` and `select count(*)
      from episodes e join seasons s on e.season_id = s.id where s.show_id = <id>` both return 0.
- [ ] **AC-4**: Given a film only user A owns with a torrent actively downloading, when A confirms
      removal, then the torrent is gone from qBittorrent's web UI, its folder under the downloads root
      is gone, and the film's row is gone.
- [ ] **AC-5**: Given a film only user A owns with an encode in progress, when A confirms removal,
      then the worker log shows the encode terminated by cancellation and the worker reports no
      outcome for it.
- [ ] **AC-6 (failure path)**: Given the `torrent` container is stopped and a film with a live torrent,
      when A confirms removal, then the dialog shows the translated
      `error.download.torrent_client_rejected` message, the film is **still** in `/movies`, its
      `media_sources` rows are still present, and its files under the downloads root are still on disk.
- [ ] **AC-7 (failure path)**: Given user B is signed in and a film only user A owns, when B calls
      `removeMovie(id: <A's film id>)`, then the response is `error.movie.not_found` with the same
      shape as calling it with a nonexistent id, and `select count(*) from movies where id = <id>`
      still returns 1.
- [ ] **AC-8 (failure path)**: Given a film already removed, when the same `removeMovie(id:)` is
      called again, then the response is `error.movie.not_found` and no 500 appears in `api`'s log.
- [ ] **AC-9**: Given a `COMPLETED` film only user A owns, when A confirms removal, then the file at
      the film's former `filePath` under the destinations root is still on disk with an unchanged
      mtime, and `select count(*) from movies where id = <id>` returns 0.
- [ ] **AC-10**: Given the film of AC-9, when A searches the same title again and registers it, then it
      appears in `/movies` with status `MISSING` and a new row id.
- [ ] **AC-11**: Given a film only user A owns whose files were ffprobed, when A confirms removal, then
      `select count(*) from ffprobe_logs where file like '%<downloadPath>%'` returns the same count as
      before the removal.
- [ ] **AC-12**: Given a shared film, when A removes it, then A's rows in `user_movie_languages` for
      that film are gone (`select count(*) … where user_id = '<A>' and movie_id = <id>` returns 0) and
      B's are unchanged.
- [ ] **AC-13**: Given `shows_enabled` is false, when `removeShow` is called, then the response is
      `error.media.type_disabled` and the series row is unchanged.
- [ ] **AC-14**: `bin/npm api run test` passes and `git status --short services/api/prisma` is empty
      (NFR-1). `git diff --stat services/worker` is empty (NFR-4).
- [ ] **AC-15**: The confirmation dialog for a title only the caller owns and one the caller shares
      with another user show different copy, matching the two outcomes of REQ-7, in both `en` and `es`.
- [ ] **AC-16**: With `User.uiLocale = es`, AC-7's refusal renders in Spanish in the dialog, not
      `Movie {id} does not exist` (REQ-13), and `bin/cli web node scripts/check-messages.mjs` reports
      no `en`/`es` drift.
- [ ] **AC-17**: Given a film users A and B both own, when A opens `/movies/<id>`, then the
      `movie(id:)` response carries `otherOwners: 1`; after B removes it, the same query for A
      carries `otherOwners: 0`.

## Out of Scope

- **Deleting anything from the library.** Constitution Article XII. The transcoded file stays where
  the worker put it; a user who wants it gone removes it themselves or through their media server.
  Nothing in this feature is allowed to walk the destinations root.
- **Per-season and per-episode removal.** A series is removed whole. Removing one season would need
  its own contract surface and its own status recompute across the remaining seasons, and the
  acquisition side already lets a user delete a season's downloads from `/downloads` (`064`) without
  unregistering anything.
- **A deletion audit table.** `FfprobeLog` is the debug history that survives (REQ-9). Recording who
  removed what and when would be a new Prisma model and a migration for a question nobody has asked
  yet; Article X says the later change can add it with the use case in hand.
- **Telling the media server.** `MediaServerService` is notified on creation, not on removal, and the
  file it indexed is still there anyway (REQ-6), so there is nothing to retract. The
  `media_server_items` index is keyed by `tmdbId` with no relation to `Movie`/`Show` by design and is
  left alone; "Re-sincronizar" already rebuilds it.
- **Removing a title from the `/downloads` global queue.** `064`'s page lists sources, not titles, and
  its delete button is `downloadDelete`. This feature adds no control there.
- **Bulk removal.** One title at a time, from its own detail page. A multi-select on the listings is a
  separate UI feature.
- **Any change to how a title is registered.** `addMedia` and `MoviesService.register()` are untouched;
  REQ-8 is satisfied by the removal being complete, not by a new registration path.
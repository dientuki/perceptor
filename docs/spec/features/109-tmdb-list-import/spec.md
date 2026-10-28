---
title: TMDB List Import
spec_version: 0.3.0
author: Juan "Dientuki" Farias
created_at: 2026-10-27
last_updated: 2026-10-28
status: Implemented
services: [api, web]
---

# SPEC: TMDB List Import (`spec.md`)

## Context & Goal

Today a title enters Perceptor through exactly one door: a user opens Perceptor, searches it and
presses Add (`addMedia`, `src/media/media.resolver.ts`, which dispatches to
`MoviesService.register()`/`ShowsService.register()`). A user who already keeps what they want to
watch somewhere else has to copy it by hand, one title at a time. The *arr stack's lists are the
feature most of its users rely on to never open the app at all; this spec adds the narrowest version
of that door that costs nothing new: **public TMDB lists**, read with the installation's existing
TMDB key, so no per-user credential, no OAuth and no new external service.

Each user attaches one or more public TMDB lists in `/preferences`, by list id or by the list's
`themoviedb.org` URL. A new opt-in scheduled task, `import_lists` (`src/scheduler/`, beside
`refresh_*`/`acquire_*`), reads every attached list of every enabled user and registers each item it
has not seen before into **that user's** library, through the same per-type `register()` that
`addMedia` calls — so a new title gets the same derivations (`isShort` `056`, `contentKind` `057`,
typed release dates `075`), the same media-server reconciliation (`034`) and, for a series, the same
background season fetch. The import is additive and remembers what it has seen: an item is imported
once, the first time a sweep sees it on that list, so a title the user later removes from Perceptor
stays removed even while it remains on the list.

This touches the **Register title in DB** stage of the root `CLAUDE.md` pipeline table: a second
entry point into it, scheduled rather than user-pressed. It never acquires anything: whether a
registered title is then downloaded stays entirely with the existing `acquire_episodes` (`073`) and
`acquire_movies` (`076`) sweeps and their per-user preferences, exactly as for a title added by hand.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Attach a list)**: A signed-in user must be able to attach a public TMDB list to their
      own account by giving either its numeric id or a `themoviedb.org` list URL (`/list/<id>` with
      or without a `-slug` suffix, with or without a locale prefix or query string). Attaching reads
      the list from TMDB exactly once to confirm it is readable and to store its name and its item
      count; it imports nothing.
- [ ] **REQ-2 (Validation on attach)**: Attaching must be refused — with nothing stored — when the
      reference parses to no list id, when TMDB answers that the list does not exist or is private,
      when the caller already has that list attached, or when the catalog key is missing or rejected
      or TMDB is unreachable (one error per cause, see the error table).
- [ ] **REQ-3 (List the caller's lists)**: A user must be able to read their own attached lists — name,
      TMDB list id, how many items TMDB says the list holds, when it was last imported and the last
      import error, if any. A user never sees
      another user's lists.
- [ ] **REQ-4 (Detach a list)**: A user must be able to detach one of their own lists. Detaching
      removes the list and its record of seen items; it never removes, unowns or otherwise touches a
      title the list already imported. Re-attaching the same list later starts with an empty seen
      record (so its current items import again on the next sweep).
- [ ] **REQ-5 (Scheduled task)**: A new scheduled task `import_lists` must exist in the scheduler
      registry, **disabled by default** like every other task, administrator-toggleable from the
      existing scheduler Settings, with a default cadence of every six hours. It is not tied to a
      media type (no `mediaType`), so it stays available whatever `movies_enabled`/`shows_enabled`
      say. Attaching a list while the task is disabled is allowed.
- [ ] **REQ-6 (What a run does)**: Each run must, for every attached list of every enabled user
      (`User.isEnabled`), read the list's items from TMDB (every page) and, for each film or series
      on it the list has not seen before:
      - if the user already owns the title: mark it seen and do nothing else (no `register()` call,
        no reconciliation, no TMDB call);
      - otherwise: register it for that user through the per-type `register()` that `addMedia`
        uses, then mark it seen.
- [ ] **REQ-7 (Seen means imported once)**: An item marked seen on a list must never be registered
      again by that list, whatever happens to the title afterwards — in particular a title the user
      removed (`removeMovie`/`removeShow`, `067`) while it is still on the list is not re-added.
      The seen record is per attached list, so the same title on two of the user's lists is
      registered at most once and then seen by both.
- [ ] **REQ-8 (Disabled media type)**: An item whose type is disabled installation-wide
      (`movies_enabled`/`shows_enabled`, `045`) must be skipped and **not** marked seen, so it is
      imported by the first run after that type is enabled. Shorts follow the existing
      registration rule unchanged: `shorts_enabled` affects only how `register()` classifies a
      film, never whether the item is imported.
- [ ] **REQ-9 (Item failure does not stop the run)**: An item whose registration fails (the title is
      missing from TMDB's catalog, a transient TMDB error) must be left unseen, so the next run
      retries it, and must not prevent the remaining items of that list or any other list from
      being imported.
- [ ] **REQ-10 (List failure is recorded on the list)**: When a list cannot be read during a run,
      the run must record the cause on that list (its `lastError`), keep the list attached and its
      seen record intact, and continue with the next list. A successful read must clear
      `lastError`, set `lastImportedAt` and refresh the stored name and item count from TMDB.
- [ ] **REQ-11 (No acquisition)**: Neither attaching a list nor a run may add a source, search an
      indexer, or start a download, encode or subtitle search.
- [ ] **REQ-12 (Task state visible to users)**: Every signed-in user must be able to tell whether
      the `import_lists` task is currently enabled, so `/lists` can say that attached lists
      are not being imported while it is off. This exposes only that boolean, never the cron.
- [ ] **REQ-13 (`web`: the lists page)**: The sidebar must carry a "Mis listas" entry (icon
      `list-video`) for every signed-in user, leading to `/lists`. That page is where the user pastes
      an id or URL to attach, and where each attached list is shown: its name (linking to the list's
      own page, REQ-14), the item count TMDB reported (unknown until the list is first read after
      this amendment), a link to the list on TMDB, the last import time in the user's date order
      (`096`), the last error translated from its key, and a detach action behind a confirmation
      that states titles already imported stay. While the task is disabled the page shows a notice
      saying lists are imported only once an administrator enables the "Importar listas" task.
      `/preferences` no longer carries any of this.
- [ ] **REQ-14 (`web`: a list's page)**: `/lists/<id>` must show the list's name and the titles of
      that list that are in the caller's library — the items the list has seen that the caller
      owns today — as a poster grid like `/movies`, each card marked as a film, a short or a series
      and linking to that title's own page. It reads no TMDB data: an item that was never imported
      (disabled type, failed registration) or that the user removed is not shown. An id that is
      not one of the caller's lists renders the same not-available 404 as `/movies/<id>`.

- [ ] **REQ-15 (Per-title "download automatically")**: Each owner of a film or a series must have
      their own on/off choice, "Descargar automáticamente", stored on their ownership of that title,
      **on by default** — for every existing ownership and for every title added afterwards by any
      path (`addMedia`, a list import). It is the caller's own choice: setting it never changes
      another owner's.
- [ ] **REQ-16 (The sweeps respect it)**: `acquire_movies` (`076`) and `acquire_episodes` (`073`)
      must consider only the owners who have it on. A title (for a series, every episode of it) is
      acquired automatically only while at least one owner has it on; the owners whose marks,
      languages and preferred groups the ranking unions, and the owner the release is attached as,
      are drawn from those owners only. With every owner off the title is skipped silently: no
      search, no attempt counted, not a failure. Manual acquisition (search, magnet, upload) is
      never affected.
- [ ] **REQ-17 (`web`: the switch)**: A film's and a series' detail page must show the switch under
      the poster, reflecting the caller's own choice, **only while the title does not hold a file**
      (its status is not `COMPLETED`). Turning it off or on saves immediately; a refusal reverts the
      switch and shows the translated error. Hiding the switch never changes the stored choice.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (TMDB call budget)**: A run must cost, per attached list, one TMDB request per page of
      that list, plus the calls `register()` already makes for each **new, unowned** item —
      nothing per already-seen or already-owned item. Two users attaching the same list read it
      twice (lists are per user); no cross-user cache is required.
- [ ] **NFR-2 (No cap)**: A run imports every new item it finds; there is no per-run limit. A large
      list costs once, on its first run.
- [ ] **NFR-3 (Missing or rejected key)**: With an empty catalog key a run makes no TMDB request
      and changes no list. A key TMDB rejects (401) is recorded on each list read with it as
      `error.media.catalog_unauthorized` (REQ-10), the same key `popularMedia` already surfaces.
- [ ] **NFR-4 (Concurrent registration)**: Registering a film or series that another call is
      creating at the same moment must succeed for **every** caller of the per-type `register()` —
      `addMedia`, this spec's run, and any future one — exactly as if the title had already existed:
      the caller ends owning it, the media-server reconciliation runs, no error reaches the user and
      no duplicate title or ownership row is written. Today ownership linking is already an upsert
      but the title's own creation is not, so the call that loses the race fails with a raw
      unique-constraint error and leaves its user not owning the title. This spec closes that for
      both `MoviesService` and `ShowsService`; it is owed a test (Article IX: today the loser fails
      with no translated error and silently does not own what it added).
- [ ] **NFR-5 (User deletion)**: Deleting a user removes their attached lists and seen records with
      them; titles stay governed by the existing ownership rules.
- [ ] **NFR-6 (Migration)**: The new tables start empty; no backfill.

## GraphQL Contract Delta

```graphql
type TmdbList {
  id: Int!
  tmdbListId: Int!
  name: String!
  lastImportedAt: DateTime
  lastError: String
  """Items TMDB reported for the list at its last successful read; null until then (109 0.2.0)."""
  itemCount: Int
  """Films of this list the caller owns today (seen by the list), ordered by title."""
  movies: [Movie!]!
  """Series of this list the caller owns today (seen by the list), ordered by title."""
  shows: [Show!]!
}

extend type Movie {
  """The caller's own "download automatically" choice for this film (109 0.3.0). Default false."""
  autoAcquire: Boolean!
}

extend type Show {
  """The caller's own "download automatically" choice for this series and its episodes (109 0.3.0). Default false."""
  autoAcquire: Boolean!
}

extend type MediaCapabilities {
  """True while the import_lists scheduled task is enabled (109 REQ-12). Never exposes its cadence."""
  listImportEnabled: Boolean!
}

extend type Query {
  tmdbLists: [TmdbList!]!
  """One of the caller's lists; null for an id that is not theirs (109 0.2.0)."""
  tmdbList(id: Int!): TmdbList
}

extend type Mutation {
  addTmdbList(reference: String!): TmdbList!
  removeTmdbList(id: Int!): Boolean!
  """Sets the caller's own "download automatically" choice for a film they own (109 0.3.0)."""
  setMovieAutoAcquire(movieId: Int!, autoAcquire: Boolean!): Boolean!
  """Sets the caller's own "download automatically" choice for a series they own (109 0.3.0)."""
  setShowAutoAcquire(showId: Int!, autoAcquire: Boolean!): Boolean!
}
```

`TmdbList.lastError` is an i18n key (one of `error.tmdbList.unreadable`,
`error.media.catalog_unauthorized`, `error.media.catalog_unavailable`), never English prose; `web`
translates it through its message catalog. `lastImportedAt` is null until the first successful run.
`tmdbLists` returns the caller's lists ordered by attach time, oldest first. `tmdbList(id)` answers
`null` both for a missing id and for another user's list, the same posture as `movie(id)`.
`movies`/`shows` are field resolvers, run only when selected: the `/lists` listing does not select
them, the list's own page does. `Movie.isShort` is how `web` tells a short from a film. All three operations
require a user principal; the service principal is refused with the existing authorization error.

The new task appears in the existing admin-only scheduled-task query with id `import_lists` — no
change to that type, only one more row.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `reference` is neither a positive integer nor a `themoviedb.org` `/list/<id>` URL | `BadRequestException` `error.tmdbList.invalid_reference` (new) | `No es un ID ni un enlace de lista de TMDB.` |
| TMDB says the list does not exist or is private (404) | `BadRequestException` `error.tmdbList.unreadable` (new) | `TMDB no encontró la lista, o no es pública.` |
| The caller already has that TMDB list attached | `ConflictException` `error.tmdbList.already_attached` (new) | `Ya tenés esta lista vinculada.` |
| Catalog key empty, or TMDB rejects it (401) | `BadRequestException` `error.media.catalog_unauthorized` (reused from `071`) | its existing message |
| Any other TMDB failure (network, 5xx, 429) | `ServiceUnavailableException` `error.media.catalog_unavailable` (reused) | its existing message |
| `setMovieAutoAcquire` on a film the caller does not own (or that does not exist) | `NotFoundException` `error.movie.not_found` (reused, as `setMovieAudioMandatory`) | its existing message |
| `setShowAutoAcquire` on a series the caller does not own (or that does not exist) | `NotFoundException` `error.show.not_available` (reused, as `setShowAudioMandatory`) | its existing message |
| `removeTmdbList` with an id that is not one of the caller's lists | `NotFoundException` `error.tmdbList.not_found` (new) | `La lista no existe.` |

What `web` does with each:

- `invalid_reference`, `unreadable`, `already_attached`, `catalog_unauthorized`,
  `catalog_unavailable` on attach: shown inline under the input, the input keeps its value.
- `not_found` on detach: the list is refreshed (it was already gone) and the message shown as a
  toast.
- `lastError` on a listed row: shown on that row, translated; the row stays fully usable.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `UserTmdbList` (new, `user_tmdb_lists`) | `id` Int PK; `userId` → `User` (cascade); `tmdbListId` Int; `name` String; `lastImportedAt` DateTime; `lastError` String (an i18n key); `createdAt`; unique (`userId`, `tmdbListId`) | `lastImportedAt`, `lastError` nullable | No |
| `UserTmdbListItem` (new, `user_tmdb_list_items`) | the seen record: `listId` → `UserTmdbList` (cascade); `tmdbId` Int; `mediaType` (`movie`/`show`); `seenAt`; PK (`listId`, `tmdbId`, `mediaType`) | — | No |
| `UserTmdbList` (0.2.0, second migration `tmdb_list_item_count`) | `itemCount` Int | nullable, `null` until the next successful read | No — written by the next attach or run |
| `UserMovie`, `UserShow` (0.3.0, migration `title_auto_acquire`) | `autoAcquire` Boolean | `false` | No — the default writes `false` on every existing row |
| `Setting` (seed) | `schedule_import_lists_enabled` = `false`, `schedule_import_lists_cron` = `0 */6 * * *` | — | Seeded on boot like the other `schedule_*` rows |

## Acceptance Criteria

- [ ] **AC-1**: Given a public TMDB list with two films and one series, when a user pastes its
      `https://www.themoviedb.org/list/<id>-<slug>` URL in `/lists`, then the list appears with
      its TMDB name, an item count of 3, no last import time and no error, and no title has been
      added to the library.
- [ ] **AC-2**: Given AC-1's list and `import_lists` enabled, when the task is run, then the two films
      and the series appear in that user's `/movies` and `/shows`, the series with its seasons and
      episodes, the list row shows a last import time, and no source or download exists for any of
      them.
- [x] **AC-3**: Given AC-2, when the task is run again with the list unchanged, then no title is
      registered and the run's TMDB traffic is one request per list page (verifiable in `api`'s
      logs or by counting `UserTmdbListItem` rows unchanged and no new `Movie`/`Show` rows).
- [x] **AC-4**: Given AC-2, when the user removes one of the films from Perceptor and the task runs
      again with the film still on the TMDB list, then the film is not re-added.
- [ ] **AC-5**: Given AC-2, when a film is added to the list on TMDB and the task runs, then only
      that film is registered.
- [x] **AC-6**: Given a second user who already owns one of the list's films, when that second user
      attaches the same list and the task runs, then they own all three titles and no title row is
      duplicated (`bin/mysql -e 'select tmdbId, count(*) from movies group by tmdbId having count(*) > 1'`
      returns nothing).
- [x] **AC-6b (failure)**: Given a film registered by nobody, when two users' `addMedia` calls for
      it overlap (or one `addMedia` overlaps a run importing it), then both calls succeed, both
      users own the film, and there is exactly one `Movie` row for it; the same holds for a series.
      Verified by `api`'s test for NFR-4, since the overlap cannot be timed by hand.
- [ ] **AC-7**: Given `shows_enabled` off and AC-1's list, when the task runs, then only the two films
      are imported; when shows are enabled and the task runs again, then the series is imported.
- [ ] **AC-8 (failure)**: Pasting `hello`, a TMDB *movie* URL, or the id of a private list each
      leaves nothing attached and shows `No es un ID ni un enlace de lista de TMDB.` (first two) or
      `TMDB no encontró la lista, o no es pública.` (the private one) under the input.
- [ ] **AC-9 (failure)**: Given an attached list that its owner then makes private on TMDB, when the
      task runs, then that list's row shows the translated `error.tmdbList.unreadable` message, the
      user's other lists are still imported in the same run, and the list's titles already imported
      are untouched. Making it public again and re-running clears the error.
- [ ] **AC-10 (failure)**: Pasting the same list twice shows `Ya tenés esta lista vinculada.` and
      leaves one row.
- [ ] **AC-11**: Detaching a list (after confirming) removes the row and keeps every title it
      imported in the user's library.
- [ ] **AC-12**: With `import_lists` disabled, `/lists` shows the notice that lists are not
      being imported; enabling the task from Settings removes the notice on the next load.
- [ ] **AC-13**: A user signed in as another account sees none of the first user's lists, and
      `removeTmdbList` with the first user's list id answers `La lista no existe.`
- [x] **AC-14**: Every signed-in user, admin or not, sees "Mis listas" in the sidebar, and
      `/preferences` no longer shows any TMDB list section.
- [ ] **AC-15**: Given AC-2, clicking the list's name in `/lists` opens `/lists/<id>` showing the
      list's name and the two films and the series as posters, each marked film, short or series
      and linking to its own page; after the user removes one film it is no longer shown there.
- [x] **AC-16 (failure)**: `/lists/<id>` with another user's list id, a missing id or `abc` renders
      `Recurso no disponible para este usuario` as a 404, and `tmdbList(id:)` with the other user's
      id answers `null`.
- [x] **AC-17**: A list attached before this amendment shows no count until its next successful
      read, then shows TMDB's count.
- [ ] **AC-18**: A film the caller just added shows "Descargar automáticamente" off under its poster;
      once the film is `COMPLETED` the switch is gone.
- [ ] **AC-19**: Given `acquire_movies` enabled, a window marked and a `MISSING` film with an open
      window owned only by the caller, with the switch at its default (off) and the task run, then
      no source is attached to that film and the run is not `FAILED` because of it; turning it
      on and running again attaches one.
- [ ] **AC-20**: Given a series whose only owner left the switch off and `acquire_episodes`
      enabled, a newly aired `MISSING` episode gets no source on the next run; a manual search and
      add on that same episode still works.
- [ ] **AC-21**: Given a film owned by two users where one turned the switch off and the other did
      not, the sweep still acquires it, attached as the owner who has it on; the first user's switch
      still reads off.
- [ ] **AC-22 (failure)**: `setMovieAutoAcquire` on a film the caller does not own answers
      `error.movie.not_found` and changes nothing; a second user's choice is unaffected by the
      first user's toggle.

## Out of Scope

- **Personal TMDB watchlist and private lists.** They need each user to authorize Perceptor against
  their TMDB account (TMDB v4 user auth), a stored per-user token and a revocation path. A future
  spec.
- **Plex watchlist, IMDb lists, Trakt.** Each is a new source with its own id translation or
  credential; the attach/seen model here is meant to be reused by them, not pre-built for them.
- **Removing titles when they leave a list.** Import is additive by design; removing a title from
  Perceptor stays a user action (`067`).
- **Immediate import on attach.** Attaching only validates; the first import is the next run. An
  administrator who wants it sooner runs the task from the scheduler Settings.
- **Acquisition.** No release search or download is started here; `073`/`076` decide that, per
  their own opt-ins and per-user windows.
- **Installation-wide or shared lists.** Every list belongs to one user and fills only that user's
  library.
- **Per-list options** (type filter, language overrides, a per-list auto-acquire default). Every item is
  registered with the same defaults as a manual Add.
- **"Download automatically" per season or per episode** (0.3.0). One switch per series; a
  finer level, like Sonarr's, is future work if needed.

## Amendments

### 0.2.0 — 2026-10-28: the lists get their own pages

The attach/list/detach UI moves out of `/preferences` into a sidebar entry "Mis listas" (`/lists`),
which also shows each list's item count, and each list gets a page (`/lists/<id>`) with the titles
it brought into the caller's library. Contract delta: `TmdbList.itemCount: Int`, the field resolvers
`TmdbList.movies`/`TmdbList.shows`, and `Query.tmdbList(id)`. Data: `UserTmdbList.itemCount`
(second migration). Decided with the maintainer: the count is TMDB's own total, stored at each
successful read (no TMDB call when `/lists` renders); a list's page shows only what the caller owns,
never a live TMDB read. REQ-13 replaced, REQ-14 and AC-14 … AC-17 added, AC-1/AC-12 point at
`/lists`. The `import_lists` task, the import rules and the 0.1.0 tables are unchanged.

### 0.3.0 — 2026-10-28: per-title "download automatically"

A per-owner on/off choice on each film and series (`UserMovie.autoAcquire`, `UserShow.autoAcquire`,
default off), exposed as `Movie.autoAcquire`/`Show.autoAcquire` (the caller's own value) and set with
`setMovieAutoAcquire`/`setShowAutoAcquire`, following `039`'s `audioMandatory` shape. The two
acquisition sweeps count only the owners who have it on. The switch sits under the poster and only
while the title holds no file. Motivated by a title brought in by a list the user wants to keep in
the library without it being downloaded. Decided with the maintainer: per owner, not per title; a
title is acquired while any owner wants it; one switch per series, no season or episode level;
no per-list default. REQ-15 … REQ-17 and AC-18 … AC-22 added.

Same day, after the first live look: the default is **off**, not on (`@default(false)`; the field
resolvers answer `false` when the caller has no row; existing rows reset to `false`), asked for by
the maintainer. A title is therefore never acquired by a sweep until an owner turns the switch on;
manual search is unaffected.

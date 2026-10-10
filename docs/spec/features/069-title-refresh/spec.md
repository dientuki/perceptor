---
title: Title Refresh
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-09-25
last_updated: 2026-09-25
status: Implemented
services: [api, web]
---

# SPEC: Title Refresh (`spec.md`)

## Context & Goal

A title's catalog data is written once, at registration, and almost never again. A film's title,
overview, poster and release date are copied from TMDB by `MoviesService.register()` and never
revisited; the `refresh_movies`/`refresh_shows` scheduled tasks exist (`035-scheduled-tasks`) but are
stubs that report zero items. A series fares slightly better — `ShowsService.hydrate()` fetches every
season and episode in the background at registration, and `041-episode-info-refresh`'s
`refresh_episodes` sweep rewrites title/overview/air date for episodes still in flight — but a
season TMDB announces after the series was hydrated never appears, an episode that aired more than
two days ago is never corrected, and the series' own row (poster, overview) is frozen. The only
workaround today is removing the title and adding it back, which `067-title-removal` makes
destructive.

The media-server side has the same shape. `034-jellyfin-library-reconciliation`'s
`MediaServerReconcileService` runs only at registration (and on a re-add), only ever promotes
`MISSING` to `COMPLETED`, and for Jellyfin answers "does the server hold this title" from the local
`media-server-index` table, which is only as fresh as the last admin-triggered "Re-sincronizar". A
film the user copied into Jellyfin by hand after registering it stays `MISSING`; a file deleted from
Jellyfin stays `COMPLETED` forever.

This feature adds a **Refresh** button to a film's and a series' detail page. One press re-reads the
title from TMDB (for a series: the series, every season and every episode, adding any TMDB now lists
that Perceptor does not), rebuilds the media-server index, and re-derives the stored
`MISSING`/`COMPLETED` status of the film or of each episode from what the media server holds — in
both directions, but never touching a title that has work in flight in Perceptor's own pipeline.
The media server becomes the source of truth for "delivered or missing": a finished encode is a
historical record, not a reason to keep showing `COMPLETED` for a file the server no longer has. It
touches the "Register title in DB" and "Notify media server" stages of the root `CLAUDE.md` pipeline
table; no stage changes status, and `worker` is not involved.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Refresh a film)**: Must offer, on a film's detail page, a Refresh action that
      re-reads the film from TMDB and overwrites its stored `title`, `overview`, `posterUrl`,
      `releaseDate` (the earliest release date, the same value registration writes) and
      `originalLanguage` with what TMDB answers now.
- [ ] **REQ-2 (Refresh a series)**: Must offer, on a series' detail page, a Refresh action that
      re-reads the series from TMDB and overwrites its stored `title`, `overview`, `posterUrl`,
      `releaseDate` and `originalLanguage`, then re-reads **every** season TMDB lists (season 0
      included, as `hydrate()` does) and, for each, every episode: an existing season/episode has its
      `releaseDate` / `title`, `overview`, `releaseDate` overwritten; a season or episode TMDB lists
      that Perceptor does not have is created.
- [ ] **REQ-3 (Nothing disappears)**: A season or episode Perceptor holds that TMDB no longer lists
      must be left untouched — never deleted, never blanked. The same holds for any field TMDB answers
      as empty where Perceptor already has a value for `releaseDate` (an absent air date never erases
      a known one, same rule as `hydrate()`).
- [ ] **REQ-4 (Fresh data)**: The catalog read must come from TMDB itself, not from the 24h Redis
      catalog cache `getCachedMovie`/`getCachedShow` read through; after a successful read the cache
      entry for that title is replaced with what was just fetched, so a later search/registration does
      not serve the older copy.
- [ ] **REQ-5 (Classification untouched)**: `Movie.isShort`, `Movie.contentKind` and
      `Show.contentKind` must not be re-derived or written by a refresh. They may be manual corrections
      (`setMovieShort`, `setMovieContentKind`, `setShowContentKind`) and nothing distinguishes a
      corrected value from a derived one.
- [ ] **REQ-6 (Index rebuilt first)**: When the configured media-server client resolves titles
      through the local `media-server-index` (Jellyfin today), a refresh must rebuild that index and
      wait for the rebuild to finish before checking the title. If a rebuild is already in flight
      (started from Settings or by another refresh), the refresh must not start a second one; it waits
      for the one in flight and uses its outcome. A client that resolves TMDB ids natively skips this
      step.
- [ ] **REQ-7 (Promote)**: When the media server holds the film, a film whose stored status is
      `MISSING` must become `COMPLETED`. For a series, every episode the media server reports present
      whose stored status is `MISSING` must become `COMPLETED` — the same rule `034` applies at
      registration.
- [ ] **REQ-8 (Demote)**: When the media server answered successfully and does **not** hold the film,
      a film whose stored status is `COMPLETED` must become `MISSING`. For a series, every episode the
      media server does not report present (including every episode, when the server does not hold
      the series at all) whose stored status is `COMPLETED` must become `MISSING`.
- [ ] **REQ-9 (In-flight work is never touched)**: REQ-7 and REQ-8 apply only to a film/episode whose
      stored status is `MISSING` or `COMPLETED` **and** whose derived pipeline status (`043`,
      `deriveTitleStatus`/`deriveEpisodeStatus`, including `059`'s season-pack lift) is not `QUEUED`,
      `PAUSED`, `DOWNLOADING`, `DOWNLOADED` or `ENCODING` — derived under REQ-17's rule, so a finished
      pipeline run never counts as in flight. A stored `ERROR` is never touched. The
      write must be conditional on the status it read (an update that no longer matches is a no-op),
      so a `torrentCompleted`/`encodeCompleted` landing mid-refresh is never overwritten.
- [ ] **REQ-10 (What the media-server step writes)**: A promotion writes `status` only — `filePath`
      is never filled from the media server, same as `034`. A demotion writes `status = MISSING` **and
      clears `filePath`**: `filePath` is what `DownloadsService.recomputeMovieStatus`/
      `recomputeEpisodeStatus` read as "already delivered, never walk backwards", so leaving it set
      would let the next source event silently re-promote the title. Clearing the column touches no
      file — the library file, if any, stays exactly where it is (Constitution, Article XII) — and
      the path stays on record in the `ProcessJob.outputFilePath` that produced it. Never written: a
      `MediaSource`, a `ProcessJob`, `Show.status` (a series' status stays whatever is derived from
      its episodes).
- [ ] **REQ-17 (The media server is the source of truth for delivered/missing)**: A title's derived
      status (`043`, `deriveTitleStatus`/`deriveEpisodeStatus`) must no longer be lifted to
      `COMPLETED` — or to `DOWNLOADED` — by a pipeline run that already finished. A source whose
      encode jobs are all `COMPLETED`, and those jobs, are history: they contribute nothing to the
      title's derived status, and `COMPLETED`/`MISSING` comes from the stored status alone, which
      `encodeCompleted` sets on delivery and the media server corrects on refresh. Consequence, and
      the point of this requirement: a film Perceptor encoded and the user then deleted from the
      media server reads `MISSING` after a refresh, and can be acquired again without `force`
      (`attachTorrentSource` only refuses a stored `COMPLETED`). A source or job still in flight
      keeps contributing exactly as today. This changes every read of the derived status (listings,
      detail pages, calendar, the `/downloads` title grouping), not only the refresh; with no refresh
      ever pressed the visible result is unchanged, since `encodeCompleted` already stores
      `COMPLETED` for every delivered title.
- [ ] **REQ-11 (Steps are independent)**: The catalog step and the media-server step must each run
      even when the other fails, and the result must report the outcome of each separately: catalog
      `DONE`/`FAILED`; media server `DONE`/`SKIPPED` (no client configured, or a client with no host —
      the same "nothing to reconcile against" condition as `034`)/`FAILED` (server unreachable, index
      rebuild failed, lookup threw). A step failure is an outcome in the result, not a GraphQL error.
- [ ] **REQ-12 (No status writes on doubt)**: When the media-server step is `FAILED`, neither
      promotions nor demotions are written — an unreachable server or a failed index rebuild must
      never read as "the server holds nothing".
- [ ] **REQ-13 (Counts)**: The result must say how many films/episodes were promoted and how many
      were demoted, so `web` can tell the user what changed.
- [ ] **REQ-14 (Who)**: Any user who holds the title may refresh it; ownership is checked the same way
      every other detail-page mutation checks it (a title the caller does not hold answers not-found).
      Not admin-only, even though it rebuilds the index an admin would otherwise rebuild from Settings.
- [ ] **REQ-15 (One at a time)**: A second refresh of the same title while one is running, or a
      series refresh while that series' background `hydrate()` holds its claim, must be refused with a
      conflict error rather than run twice.
- [ ] **REQ-16 (UI)**: The Refresh button sits on the film and series detail pages, is disabled and
      shows progress while the mutation runs, reloads the page's data on completion, and shows a
      message built from the result: catalog outcome, media-server outcome, promoted/demoted counts.
      All copy is catalog-driven in `en` and `es` (`018-ui-i18n`).

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Sequential TMDB)**: A series refresh fetches its seasons one after another, never in
      parallel — the same rate-limit reasoning as `hydrate()` (NFR-6 of its spec) and
      `refresh_episodes` (`041` NFR-1). Cost is 1 details call plus 1 call per season for a series, and
      at most 2 calls (details + earliest release date) for a film.
- [ ] **NFR-2 (Synchronous)**: The mutation answers after both steps finish; there is no background
      job and no polling. A series with dozens of seasons is expected to take seconds, not minutes, at
      this installation's scale (~5 users, a local media server).
- [ ] **NFR-3 (Partial catalog writes)**: A TMDB failure partway through a series leaves the seasons
      already written written — each season/episode write is an idempotent upsert, and a second
      refresh completes the rest. The catalog outcome is `FAILED` in that case, never `DONE`.
- [ ] **NFR-4 (No schema change)**: Every column this feature writes already exists.
- [ ] **NFR-5 (Disabled type)**: Refreshing a film while `movies_enabled` is false, or a series while
      `shows_enabled` is false, is refused with the existing `045` error — consistent with
      `removeMovie`/`removeShow`.

## GraphQL Contract Delta

Two mutations, one per media type — the deliberate `movies`/`shows` duplication (`006-media-search`
§ Out of Scope), as `067` did for removal.

```graphql
type Mutation {
  refreshMovie(id: Int!): TitleRefresh!
  refreshShow(id: Int!): TitleRefresh!
}

"""The outcome of refreshing a title from TMDB and from the media server."""
type TitleRefresh {
  """Whether the TMDB catalog data was re-read and written in full."""
  catalog: RefreshCatalogOutcome!

  """Whether the media server was checked, skipped because none is configured, or failed."""
  mediaServer: RefreshMediaServerOutcome!

  """Films/episodes moved from MISSING to COMPLETED. 0 unless mediaServer is DONE."""
  promoted: Int!

  """Films/episodes moved from COMPLETED to MISSING. 0 unless mediaServer is DONE."""
  demoted: Int!
}

enum RefreshCatalogOutcome {
  DONE
  FAILED
}

enum RefreshMediaServerOutcome {
  DONE
  SKIPPED
  FAILED
}
```

`web` reloads the detail page's data after the mutation returns rather than reading the refreshed
title off the result — the page already fetches everything it renders, and a `Show` with every
season and episode is too large to return from a mutation just to discard.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `refreshMovie` for a film id that does not exist, or the caller does not hold | `NotFoundException`, `error.movie.not_found` (existing) | `La película {id} no existe` |
| `refreshShow` for a series id that does not exist, or the caller does not hold | `NotFoundException`, `error.show.not_available` (existing) | `Recurso no disponible para este usuario` |
| `refreshMovie` while `movies_enabled` is false, `refreshShow` while `shows_enabled` is false | `ForbiddenException`, `error.media.type_disabled` (existing) | unchanged from `045` |
| A refresh of the same title is already running, or the series' background hydration holds its claim | `ConflictException`, `error.media.refresh_in_progress` (**new**) | `Ya se está actualizando este título, probá de nuevo en un momento` |
| No authenticated session | `error.auth.unauthenticated` (existing) | unchanged |

TMDB and media-server failures are deliberately **not** in this table: they are `FAILED` outcomes on
a successful response (REQ-11). `web` must handle every row: not-found and type-disabled show the
translated error; `refresh_in_progress` shows the translated error and re-enables the button; any
`FAILED` outcome shows a warning naming which step failed, alongside whatever the other step did.

## Data Model Changes

None.

## Acceptance Criteria

**Verification status — 2026-10-09** (pass over 002–071 on `fix/tech-debt`, no code change)

Every open criterion here is blocked on something this installation does not have, and the blockers
are three, not eight:

- **A configured media server.** `media_server_client` reads **`none`** in `settings`, and no
  Jellyfin or Plex container is part of `docker-compose.yaml` (deliberate — see the root
  `CLAUDE.md`). AC-2, AC-4, AC-5, AC-5b, AC-5c, AC-6 and AC-7 each open with "Given Jellyfin
  configured"; AC-7 additionally wants it configured *and stopped*. Nothing short of a reachable
  media server with a library on disk can run them. The promote/demote rules themselves are covered
  by `api/src/media-server/media-server-reconcile.service.spec.ts` and
  `api/src/media-server-index/media-server-index.service.spec.ts`, and a failed rebuild writing
  nothing is an asserted case there — so what is missing is the integration, not the logic.
- **A second user.** AC-11 ("a film held only by user A, when user B calls `refreshMovie(id)`") needs
  two accounts; the `users` table holds **exactly one row**, the seeded admin. There is no public
  registration, so a second user is an admin creating one from `/users` — which needs a session too.
- **An admin session in a browser.** Everything above is driven from a title's Refresh button.

For whoever runs this: the library state to build on is 3 films, 2 series, 64 episodes, and
`media_server_index_state` reads `never` — the index has never been built on this installation, so
AC-2's and AC-4's "rebuild, wait, then reconcile" path would be exercised from cold, which is the
interesting case rather than a limitation.

- [x] **AC-1**: Given a registered film whose `overview` was changed by hand in the database
      (`bin/mysql -e "update movies set overview='x' where id=<id>"`), when the owner presses Refresh
      on `/movies/<id>`, then the page shows TMDB's current overview and `catalog` is `DONE`.
- [ ] **AC-2**: Given a series with one episode row deleted from `episodes` and one season whose
      episodes' titles were blanked by hand, when Refresh is pressed on `/shows/<id>`, then the deleted
      episode reappears with its TMDB title and the blanked titles are restored.
- [x] **AC-3**: Given a film manually reclassified as a short and as `ANIME`, when it is refreshed,
      then `isShort` and `contentKind` are unchanged in `movies`.
- [ ] **AC-4**: Given Jellyfin configured, a film registered as `MISSING`, and that film then copied
      into Jellyfin's library (no "Re-sincronizar" pressed), when Refresh is pressed, then the film
      reads `COMPLETED`, `promoted` is 1, and Settings' media-server index shows a new sync time.
- [ ] **AC-5**: Given a series whose episode S01E02 is `COMPLETED` (stored, no source or job) and is
      then removed from Jellyfin, when Refresh is pressed, then S01E02 reads `MISSING` and `demoted` is
      1; every other episode Jellyfin still holds is unchanged.
- [ ] **AC-5b**: Given a film Perceptor downloaded and encoded (stored `COMPLETED`, `filePath` set, a
      `SCANNED` source and a `COMPLETED` job), whose file is then removed from Jellyfin's library, when
      Refresh is pressed, then the film reads `MISSING` on its detail page and in `/movies`,
      `movies.filePath` is `NULL`, the `processJobs` row still carries its `outputFilePath`, and
      adding a new torrent to it no longer asks for `force`.
- [ ] **AC-5c**: Given a delivered film that was never refreshed, then it still reads `COMPLETED`
      everywhere, exactly as before this feature (REQ-17's rule changes nothing until a refresh
      demotes something).
- [ ] **AC-6**: Given an episode with a torrent in `DOWNLOADING`, and Jellyfin not holding it, when the
      series is refreshed, then that episode still reads `DOWNLOADING` and is not counted in `demoted`.
- [ ] **AC-7 (failure)**: Given Jellyfin configured but stopped, and a film stored `COMPLETED`, when
      Refresh is pressed, then the mutation succeeds with `mediaServer: FAILED`, `promoted: 0`,
      `demoted: 0`, the film still reads `COMPLETED`, the catalog step still ran (`catalog: DONE`),
      and the UI shows a warning that the media server could not be checked.
- [x] **AC-8 (failure)**: Given the TMDB key set to an invalid value in Settings, when a film is
      refreshed, then the result is `catalog: FAILED`, the stored catalog fields are unchanged, the
      media-server step still reports its own outcome, and the UI names the catalog step as failed.
- [x] **AC-9**: Given `media_server_client` set to `none`, when a title is refreshed, then
      `mediaServer` is `SKIPPED`, no status changes, and the UI does not present it as an error.
- [x] **AC-10 (failure)**: Given two browser tabs on the same series, when Refresh is pressed in both
      within the same second, then one completes and the other shows the translated
      `error.media.refresh_in_progress` message; in `es` it reads in Spanish.
- [ ] **AC-11**: Given a film held only by user A, when user B calls `refreshMovie(id)` directly, then
      the answer is `error.movie.not_found` and nothing is written.
- [x] **AC-12**: `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift, and the
      `schema.gql` diff is exactly the two mutations, `TitleRefresh` and the two enums above.

> **Live pass, 2026-09-25 (dev stack, one film, no media server, one user).** AC-1, AC-3, AC-8, AC-9
> and AC-10 were exercised through the film's detail page; AC-12 by command. **Not run live:** AC-2
> (no series registered, `shows_enabled` off), AC-4 to AC-7 (no Jellyfin configured — the derivation
> and guard logic is covered by `pipeline-status.spec.ts` and `media-server-reconcile.service.spec.ts`
> only), AC-5c (no delivered title), AC-11 (a single user). AC-10 was seen under `en`, not `es`.
> **Observed:** a refresh writes what `tmdb.details()` returns, which carries no language, so a film
> registered from a search in another UI locale gets its `overview` rewritten in TMDB's default
> language (English here; it was Spanish before). `register()`'s own fallback has the same behaviour.

## Out of Scope

- **Filling in the `refresh_movies`/`refresh_shows` scheduled-task stubs.** The logic this feature adds
  is the obvious body for them, but a scheduled sweep of the whole library has its own cost and
  failure questions (TMDB volume against `deployment-scale`'s "conserve external calls", demotions
  nobody asked for). A later spec can wire them once this exists.
- **A library-wide "refresh everything" button.** Same reason; one title per press.
- **Re-deriving `isShort`/`contentKind`.** REQ-5 — no way to tell a manual correction from a derived
  value without a new column recording which is which.
- **Deleting seasons/episodes TMDB dropped.** REQ-3 — an episode row may carry sources, jobs and a
  library file; removing it is `067`'s territory, not a catalog sync.
- **Moving or renaming library files when TMDB renames a title.** The file under the destinations root
  keeps the name it was written with (Article XII); only the database row changes.
- **Asking the media server to rescan.** Refresh reads what the server already knows; it does not call
  Jellyfin's library refresh first. A file copied in that Jellyfin has not scanned yet stays
  undetected until Jellyfin picks it up.
- **Writing `filePath` from the media server's copy.** Same as `034`: the path Jellyfin reports is a
  host path of a file Perceptor did not produce.
- **Re-acquiring a demoted title with the same release.** After REQ-8/REQ-17 a demoted title accepts
  a new source without `force`, but re-adding the *same* `infoHash` is still `060`'s no-op, since its
  finished `SCANNED` source still exists. Deleting that source first (`047`) or picking another
  release is the path; making a finished source re-runnable is a separate decision.

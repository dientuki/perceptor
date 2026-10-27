---
title: Manual Subtitle Search
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-26
last_updated: 2026-10-26
status: Implemented
services: [api, web]
---

# SPEC: Manual Subtitle Search (`spec.md`)

## Context & Goal

`103-subtitle-search` finds, validates and embeds missing subtitle languages, but it has exactly one
trigger: a delivery (`encodeCompleted`, REQ-4). Its Out of Scope says so: turning the preference on
for a film already in the library does nothing until its next delivery, and "a manual 'search now'
button is a later feature". This is that feature. A user with films delivered before `103` shipped,
or delivered while their preference was off, has no way to fill those gaps today short of
re-downloading the title.

This spec adds a "Buscar subtítulos" button to a film's detail page and to each episode row. It
starts the same `103` search a delivery would have started, for a title that already holds a file.
Everything after the search is created is `103` unchanged: waiting for the Jellyfin item, missing
languages, candidates, fetch, timing validation, embed and outcomes (`103` REQ-6 to REQ-14). The
search is created through the same entry point a delivery uses
(`services/api/src/subtitle-search/subtitle-search-request.service.ts`), so there is still one path,
with two callers.

The constraint that shapes it is the provider's quota. Jellyfin's OpenSubtitles plugin on a free
account allows about 20 downloads a day, and one search can cost up to 3 per missing language
(`103` NFR-2). That is why there is no scheduled sweep, no season or series button, and why a press
never replaces a search already running. Every download spent is one a user asked for, one title at a
time.

Pipeline stages touched: **Browse library** (the two detail pages gain a button) and **Notify media
server** (`103`'s search gains a second trigger). No title `status` ever changes. The provider stays
Jellyfin; calling OpenSubtitles directly is `107`.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Entry points)**: A search starts on demand for:
      - a film, from its detail page (`searchMovieSubtitles`);
      - an episode, from its row on the series detail page (`searchEpisodeSubtitles`).

      There is no season, series or library-wide trigger (see Out of Scope).
- [ ] **REQ-2 (Who)**: Any owner of the title may start one: the film's owner, or the series' owner
      for an episode. Being an administrator grants nothing extra. A caller who does not own the
      title gets the same answer the title's own detail gives a non-owner.
- [ ] **REQ-3 (Refusals)**: The mutation refuses, creating no search and making no call to Jellyfin,
      checked in this order:
      1. `subtitleSearchAvailable` is false (`103` REQ-1);
      2. the caller does not own the title (REQ-2);
      3. the title holds no file: neither `filePath` nor `mediaServerPresentAt` is set;
      4. the library file is known and is not an `.mkv` (`101`'s embed refuses anything else, so the
         search would spend quota and then fail);
      5. a `101` embed of the title is queued or running, or the title has a source or job in flight
         (`101` REQ-16's guard, `error.subtitleEmbed.busy`);
      6. the title's latest search is not terminal (`WAITING`, `SEARCHING`, `VALIDATING`,
         `EMBEDDING`);
      7. the wanted languages (REQ-4) are empty.
- [ ] **REQ-4 (Wanted languages)**: The wanted languages are the union of:
      - the caller's effective subtitle languages (`103` REQ-5's rule: the per-title list (`039`) when
        it is non-empty, otherwise the caller's `subtitleLanguages` preference), whether the caller's
        `subtitleSearch` preference is on or off. Pressing the button is the caller's consent for
        that title;
      - the effective subtitle languages of every other owner whose preference is on, exactly as
        `103` REQ-5 computes them for a delivery.

      An owner whose preference is off and who did not press the button contributes nothing.
- [ ] **REQ-5 (Same search, no first wait)**: The search created is a `103` search in every respect,
      including the 2-hour bound on waiting for the Jellyfin item (`103` REQ-6). The one difference:
      its first check of the Jellyfin item runs immediately, not after `103`'s 5-minute delay, since
      the file was delivered long ago.
- [ ] **REQ-6 (Release name for ranking)**: `103` REQ-8 ranks candidates by similarity to the
      delivered source's release name. For a title whose delivering job or source no longer
      exists, or never existed, there is no release name: that ranking step treats every candidate
      as equal and the remaining steps (hearing-impaired, download count) decide.
- [ ] **REQ-7 (Titles with no `filePath`)**: A title Perceptor never delivered but the media server
      holds (`mediaServerPresentAt` set, `filePath` null) is included. `103` REQ-6 accepts a Jellyfin
      item only when its path equals the delivered file's host path, which such a title does not
      have. For it, the search instead:
      - accepts the item `findByTmdbId` returns (matched by season and episode for an episode),
        with no path comparison, the same way `101` resolves a manual embed's file;
      - takes the library file's path from that item, for the validation reference and the embed;
      - before any remote subtitle search, ends `FAILED` when that path is not an `.mkv`
        (`error.subtitleEmbed.not_mkv`) or does not resolve inside the destinations root
        (`error.subtitleEmbed.outside_library`), so neither spends quota. REQ-3.4 cannot check the
        extension at press time for this title, since the path is only known from Jellyfin.

      When Jellyfin holds more than one version of the title, the search uses whichever item
      Jellyfin returns; Perceptor has no file of its own to tell them apart. A title with a
      `filePath` keeps `103`'s path comparison unchanged.
- [ ] **REQ-8 (Interaction with deliveries)**: A delivery that finishes while a manual search is
      not terminal supersedes it, exactly as `103` REQ-12 already does for any earlier search. A
      press never supersedes: it is refused (REQ-3.6), because the running search may already have
      spent downloads that a fresh one would spend again.
- [ ] **REQ-9 (`web`)**: The button sits in the audio/subtitle panel where `103` shows the latest
      search's outcome, on the film's page and on each episode row. It is:
      - absent when `subtitleSearchAvailable` is false or the title holds no file;
      - disabled, with a hint, while the latest search is not terminal;
      - enabled otherwise, including after a `COMPLETED` or `FAILED` search, so a `NOT_FOUND`
        language can be tried again later.

      Pressing it opens a confirmation dialog stating that the search uses the subtitle provider's
      daily download quota. On success the panel shows the new search (`WAITING`). On a refusal the
      dialog shows the message from the error table and creates nothing.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Constitution amendment)**: Article XII's first exception (replacing a library `.mkv`
      with its verified remux) applied to a `103` embed "for a title one of its owners opted into".
      A manual search with the caller's preference off was outside that wording. The article is
      amended to also cover an embed started by a `106` search an owner requested by hand for that
      title. The second exception (sidecar deletion) is untouched: a `106` search stages in the
      downloads root, like `103`'s. *Ratified as constitution v1.7.0 on 2026-10-26.*
- [ ] **NFR-2 (Quota)**: Nothing in this spec starts a search on its own. One press creates at most
      one search for one film or one episode. There is no batch, retry or schedule.
- [ ] **NFR-3 (Tests where failure is silent, Article IX)**: Covered by tests that fail when the rule
      is removed:
      - each refusal of REQ-3 creates no `SubtitleSearch` row and makes no Jellyfin call;
      - a non-`.mkv` library file is refused before any search exists;
      - with the caller's preference off, the caller's languages are wanted; another owner with the
        preference off contributes none;
      - a manual search's first check is scheduled with no delay; a delivery's still waits 5 minutes;
      - a press while a search is not terminal is refused and leaves that search untouched;
      - a delivery still supersedes a running manual search;
      - a missing release name does not fail the ranking;
      - a title with no `filePath` is matched without a path comparison, and one whose Jellyfin path
        is not `.mkv` or lies outside the destinations root fails before any remote search call;
      - a title with a `filePath` still rejects an item whose path differs.

## GraphQL Contract Delta

```graphql
type Mutation {
  """Starts a 103 subtitle search for a film the caller owns that already holds a file (106)."""
  searchMovieSubtitles(movieId: Int!): SubtitleSearch!
  """Same, for an episode of a series the caller owns."""
  searchEpisodeSubtitles(episodeId: Int!): SubtitleSearch!
}
```

`SubtitleSearch`, its enums, `Movie.latestSubtitleSearch` and `Episode.latestSubtitleSearch` are
`103`'s, unchanged. The mutation returns the new search, `WAITING`, so `web` can render it without
re-reading the title.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `subtitleSearchAvailable` is false | `BadRequestException` `error.subtitleSearch.unsupported_media_server` (reused from `103`) | `La búsqueda de subtítulos requiere Jellyfin como servidor de medios.` |
| Film not owned by the caller, or unknown | the key `MoviesService` already throws for it (`error.movie.not_found`) | its existing message |
| Episode of a series not owned by the caller, or unknown | `NotFoundException` `error.episode.not_found`, the key `101`'s embed already throws for it | its existing message |
| Title holds no file | `BadRequestException` `error.subtitleEmbed.no_file` (reused from `101`) | `Este título no tiene un archivo en la biblioteca.` |
| Library file is not `.mkv` | `BadRequestException` `error.subtitleEmbed.not_mkv` (reused from `101`) | `Solo se pueden incrustar subtítulos en archivos MKV.` |
| Embed, source or job in flight | `ConflictException` `error.subtitleEmbed.busy` (reused from `101`) | `Este título tiene una descarga, codificación o incrustación en curso.` |
| Latest search not terminal | `ConflictException` `error.subtitleSearch.in_progress` (new) | `Ya hay una búsqueda de subtítulos en curso para este título.` |
| No wanted languages | `BadRequestException` `error.subtitleSearch.no_languages` (new) | `No hay idiomas de subtítulos elegidos para este título.` |

`103`'s outcome keys (a search's `errorKey` when `FAILED`, shown in the panel, never thrown) gain two,
both reused from `101` with their existing messages: `error.subtitleEmbed.not_mkv` and
`error.subtitleEmbed.outside_library` (REQ-7). `web` already renders any key in that slot through the
catalog, so this needs only the two keys resolving there.

`web` shows every row in the confirmation dialog and closes nothing. On `in_progress` it also
refreshes the title, since the panel was stale.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `SubtitleSearch` | add `libraryPath String?` (container path, `VarChar(500)` like `Movie.filePath`) | null | No |

`libraryPath` is the library file a REQ-7 search resolved from Jellyfin, written when the search
leaves `WAITING`, so the worker's validation reads the same file the item lookup found. It stays null
for a title with a `filePath`, which keeps reading `filePath`. Otherwise a manual search is a
`SubtitleSearch` row like any other; nothing records who pressed the button.

## Acceptance Criteria

- [ ] **AC-1**: An owner with the `subtitleSearch` preference **off**, wanting `eng` and `spa`, opens a
      film delivered before `103` whose file carries only English. Pressing "Buscar subtítulos" and
      confirming shows the panel at `WAITING` straight away. Within minutes (not after 5) it moves
      on, and it ends with English `ALREADY_PRESENT` and Spanish `EMBEDDED`. `mkvmerge -J` lists the
      new `spa` track.
- [ ] **AC-2**: An episode row's button starts a search for that episode only; no other episode of the
      series gets a `subtitle_searches` row.
- [ ] **AC-3 (failure)**: Pressing the button again while AC-1's search is `SEARCHING` shows
      `Ya hay una búsqueda de subtítulos en curso para este título.`, the button is disabled after
      the refresh, and `subtitle_searches` still holds exactly one row for the film.
- [ ] **AC-4 (failure)**: For a film whose library file is an `.mp4`, the press is refused with
      `Solo se pueden incrustar subtítulos en archivos MKV.`, no row is created, and Jellyfin's log
      shows no remote subtitle search.
- [ ] **AC-5 (failure)**: With the media server set to none, the button is absent, and calling
      `searchMovieSubtitles` directly returns `La búsqueda de subtítulos requiere Jellyfin como
      servidor de medios.`
- [ ] **AC-6 (failure)**: A second user who does not own the film calls `searchMovieSubtitles` for it
      and gets the not-found answer; no row is created.
- [ ] **AC-7**: While a manual search is `WAITING`, the film is replaced and its new delivery
      finishes. The manual search reads `FAILED` with `error.subtitleSearch.superseded`, and a new
      search exists for the delivery.
- [ ] **AC-8**: A film whose delivering download was deleted (no job left to name a release) still
      gets its search through to an outcome; nothing fails on the missing release name.
- [ ] **AC-8b**: A film registered after it was already in Jellyfin (`mediaServerPresentAt` set,
      `filePath` null, an `.mkv` in the library) gets a search that leaves `WAITING` on its first
      check and reaches an outcome. The same film as an `.mp4` in Jellyfin ends `FAILED` with
      `error.subtitleEmbed.not_mkv` and Jellyfin's log shows no remote subtitle search.
- [x] **AC-9**: No code path creates a search other than a delivery and the two mutations (no
      scheduler task, no season or series mutation in `schema.gql`).
- [ ] **AC-10**: `bin/npm api run test` passes, including NFR-3's cases, and `bin/npm web run test`
      passes.

## Out of Scope

- **A scheduled sweep over the library.** About 20 provider downloads a day cannot absorb a backlog
  pass, and a sweep would spend them on titles nobody asked about that day.
- **A season, series or "all missing" button.** One season with one missing language can cost up to
  30 downloads. Each episode is requested on its own.
- **Re-searching automatically.** A `NOT_FOUND` language stays that way until someone presses the
  button again.
- **Superseding a running search by hand, or cancelling one.** A running search already spent
  part of the quota, so it is refused rather than restarted. A search that has to be stopped ends on
  its own within `103`'s bounds.
- **Recording who requested a search.** No audit column. The panel shows the latest search the same
  way whatever started it.
- **Calling OpenSubtitles without Jellyfin, and filtering multi-CD subtitles before downloading
  them.** `107`.

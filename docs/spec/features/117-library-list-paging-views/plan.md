---
title: Library list paging, list view and possession filter — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-11-10
status: Implemented
---

# PLAN: Library list paging, list view and possession filter (`plan.md`)

## Approach

`api` gains two page queries, `moviePage` and `showPage`, beside the untouched `movies`/`shows`
(NFR-2). Each is one `count` plus one `findMany` over the same ownership `where` the existing
`MoviesService.findAll`/`ShowsService.findAll` already use, with the possession filter as a plain
condition on the `089` `status` column, order `createdAt desc, id desc` (the `id` tie-break is what
REQ-8 needs — `createdAt` alone is not unique, and `skip`/`take` over a non-unique order can repeat
or drop a row with no error), and `skip`/`take` from a clamped page. The page query does **not**
`include` `mediaSources`/`processJobs` as `findAll` does: since `089` `status` is a column and
`withDerivedStatus` is a pass-through, so the include is dead weight NFR-1 forbids. Clamping and the
possession `where` are one pure helper shared by both services, so the two queries cannot drift.

A series' languages are **stored** (spec REQ-13): two nullable `Json` columns on `Show`, same shape
as `108`'s `Movie`/`Episode` columns, and exposed through a third field resolver beside `108`'s
`MovieLibraryTracksResolver`/`EpisodeLibraryTracksResolver`, reusing their `asLanguages`. The
recompute is one method, `recompute(showId)`, in a new small `show-track-languages/` module that
depends on Prisma alone. It lives in its own module rather than in `library-probe/` or `shows/`
because both of its two callers must reach it without an import cycle: `LibraryProbeService.completed`
(the one place an episode's languages are set) and `MediaServerReconcileService.syncShow` (the one
place they are cleared, via `CLEARED_TRACKS`). `shows/` already imports `media-server/` for
registration-time reconciliation, so putting `recompute` in `shows/` would close a cycle. The same
module runs the NFR-5 backfill detached at boot, mirroring `LibraryProbeService.onApplicationBootstrap`.
The intersection rule itself is a pure function so it can be tested without Prisma.

`web` replaces the bodies of `Movies.tsx`/`Shorts.tsx`/`Shows.tsx` (still Server Components, still
two parallel screens per `services/web/CLAUDE.md` § "Library listings") with a call to new
`getMoviePage`/`getShowPage` actions, and adds shared rendering pieces under `components/media/`:
a toolbar (filter, view switch, page-size select), a pager, and a table for the list view. The grid
keeps using `MediaList`/`MediaCard` unchanged. URL state is parsed once by a pure `src/lib/` helper
that also reads the cookie defaults; out-of-range input is corrected with a server-side `redirect()`
to the canonical URL rather than a client rewrite, so the page never renders twice. The cookie is
written by a server action (cookie mutation is illegal in a Server Component render), called by the
toolbar before it navigates. `getMovies`/`getShows` lose their last callers and are deleted
(Article X); the `api` queries stay for the contract.

Rejected alternatives: computing the series intersection at read time (the user chose stored on
2026-11-10, spec REQ-13); paging in `web` over the full list (the user chose `api`, spec Context);
a client-side URL rewrite for REQ-11 (a flash of the wrong page, and the cookie would be read twice).

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Migration for `Show.fileAudioLanguages`/`fileSubtitleLanguages`, the `show-track-languages/` module and its two call sites, backfill |
| 2 | `api` | `LibraryPossession`, `MoviePage`/`ShowPage`, `moviePage`/`showPage` — `web` cannot query a field the schema does not have |
| 3 | `web` | Consumes step 2's contract; can start once step 2's schema is generated |
| 4 | `[docs]` | Contract section in `docs/spec/graphql-contract.md`, root `CLAUDE.md` Browse-library row, `docs/spec/history.md` |

Step 1 and step 2 are independent inside `api` and may be done in either order. Step 3 may start
in parallel with step 1 — it depends only on the frozen contract, which is in `spec.md` — but its
manual pass (AC-6, AC-7) needs both `api` steps live.

## Contract Freeze

`spec.md` § GraphQL Contract Delta is frozen as of this approval. Things an implementer will want to
change and must not:

- **Out-of-range `page`/`pageSize` is clamped, never an error.** From inside `api` a
  `BadRequestException` looks more correct; it would turn a stale bookmark into an error screen in
  `web`, which REQ-11 forbids. The response's `page`/`pageSize` are how `web` learns what was clamped.
- **`totalPages` is 1, not 0, for an empty result.** "Page 1 of 0" is meaningless and `web` hides the
  pager on `totalCount == 0` anyway; `0` would make `web`'s "last page" arithmetic go to page 0.
- **`Show.fileAudioLanguages`/`fileSubtitleLanguages` are `[String!]` nullable, the `108` shape** —
  not `[Language!]`. `null` means no episode in scope, `[]` means episodes in scope share no language.
  `web` renders both as `—` (REQ-6), but `api` must keep the distinction.
- **`movies(isShort)`/`shows` are untouched**, including their `include` of sources and jobs. Do not
  "fix" them in passing (NFR-2, AC-15).
- **`LibraryPossession.ADDED` means `status != COMPLETED`**, every other value including `ERROR` and
  `MISSING`. Not `MISSING` only (the user rejected that reading on 2026-11-10).

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, and re-brief both
`api` and `web`. Never patch it from inside one slice (Constitution, Article VIII).

## Migrations

1. `<timestamp>_show_file_track_languages` — `ALTER TABLE shows ADD fileAudioLanguages JSON NULL,
   ADD fileSubtitleLanguages JSON NULL` (generated by `prisma migrate dev`, column names exactly as on
   `Movie`/`Episode`). Every existing row starts `NULL`, which reads `—` — never a wrong intersection
   (NFR-5).
2. Backfill: no SQL in the migration. `ShowTrackLanguagesService.onApplicationBootstrap` recomputes
   every series, detached (`void … .catch(log)`), the same pattern as `LibraryProbeService`'s `108`
   backfill. It runs on every boot, not once behind a marker: it reads only the database, is
   idempotent, and also heals any series whose recompute failed (NFR-6). Verified by AC-7c.

Reversibility: dropping the two columns loses only derived data; `web` would then fail the
`showPage` selection of those fields, so a rollback of `api` must be paired with a rollback of `web`.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Order not total | `createdAt` ties (bulk `import_lists`, `109`, registers many titles in one second) make `skip`/`take` repeat a title on two pages or skip one; no error | `id desc` tie-break in the shared helper; a test that removes it and fails |
| Possession filter drift between films and series | `ADDED` written as `status: 'MISSING'` in one service: in-flight and errored titles vanish from every filter except All; no error | one shared `where` builder used by both services, tested on `ERROR`/`DOWNLOADING` |
| Clamp applied after `skip` is computed | page 99 computes `skip` past the end and returns `[]` with `page: 99`; `web` shows the filter-empty message for a non-empty library | count first, clamp, then `findMany`; a test with `page` past the end |
| Series recompute not called on a write path | a series keeps stale languages after an embed or after a sync clears an episode; nothing errors, the column is simply wrong | exactly two call sites (`completed`, `syncShow`), each with a fault-injection test that removes the call; boot backfill heals what slips |
| Recompute throws inside `completed` | the worker's `libraryProbeCompleted` report fails and is retried/abandoned, losing the episode's own write semantics | recompute runs after the episode's `updateMany`, wrapped so it logs and never throws (NFR-6) |
| Season 0 or an unread episode counted | a special, or an episode with no file, empties the intersection; every incomplete series reads `—` | the pure intersection function filters `seasonNumber != 0` and `tracksReadAt != null`; tests for both |
| Redirect loop on URL correction | a canonical URL that itself fails normalization (e.g. cookie page size invalid) redirects forever | the canonical URL is built from the normalized state, and normalization is idempotent; checked by AC-9 |
| Cookie read but never written | the toolbar navigates before the server action resolves, or writes the wrong name; AC-8 silently fails | the toolbar awaits the action, then navigates; AC-8 in the manual pass |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test -- page library show-track-languages library-probe media-server-reconcile
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments
```

(Do not run `bin/npm web run build` while the dev stack is up — it clobbers the dev `.next`.)

Manual pass, dev stack up with a library of at least 30 films, 5 shorts and a few series:

1. `/movies`: page 1 of 2 at 24 (AC-1); size 12 → 1 of 3, URL updated (AC-2); Last → oldest 6,
   no repeats (AC-3); Downloaded/Added partition the total (AC-4).
2. List view on page 2 with Added (AC-5); a never-read film shows `—`, a read one shows chips (AC-6).
3. `/shows` list view on a series with uneven subtitle coverage (AC-7); embed the missing subtitle on
   the remaining episodes from an episode row, wait for the probe, reload (AC-7b first half); stop
   Jellyfin seeing one episode's file and Refresh the series (AC-7b second half).
4. `bin/mysql -e 'update shows set fileAudioLanguages = null, fileSubtitleLanguages = null'`, then
   `docker compose restart api`, reload `/shows` (AC-7c).
5. Choose List + 48 on `/movies`, open `/shows` bare (AC-8).
6. `/movies?page=99`, then `/movies?page=abc&pageSize=7&filter=foo&view=bar` (AC-9); Downloaded on a
   library with nothing completed (AC-10); `docker compose stop api`, open `/shows` (AC-11).
7. Toggle shorts in Settings and compare `/movies`/`/shorts` totals (AC-12).
8. GraphQL playground: `moviePage(page: 1, pageSize: 7)`, `page: 0`, `page: 999` (AC-13).
9. Mobile viewport 375 px, `/movies` List (AC-14); `movies`/`shows` in the playground unchanged (AC-15).

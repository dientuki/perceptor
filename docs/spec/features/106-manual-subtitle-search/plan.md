---
title: Manual Subtitle Search — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-26
status: Implemented
---

# PLAN: Manual Subtitle Search (`plan.md`)

## Approach

The feature is a second caller of `103`'s single entry point, not a second search. Everything after
a `SubtitleSearch` row exists is `103`'s state machine (`SubtitleSearchDriver.advance`) unchanged,
with one new branch for a title that has no `filePath`.

`api` builds it out of three pieces that already exist:

- **`SubtitleSearchRequestService`** (`services/api/src/subtitle-search/subtitle-search-request.service.ts`)
  already computes the wanted languages (`103` REQ-5) and creates the row. It gains a second public
  method for a press, beside `requestFor`, which the delivery path keeps calling unchanged. The two
  share the language union and the row creation. They differ in three ways:
  - a press adds the caller's own effective languages;
  - it refuses when a search is running instead of superseding it;
  - it wakes the driver with no delay and throws its refusals instead of logging them.
- **`SubtitleEmbedService`** (`services/api/src/subtitle-embed/subtitle-embed.service.ts`) already
  owns, as private methods, every check REQ-3 needs:
  - `resolveTarget(ref, userId)`: ownership, `filePath`/`mediaServerPresentAt`, and the episode's
    season numbers;
  - `hasPossession`;
  - `assertUsableMkv`: the extension, inside the library root, a regular file;
  - `assertNotBusy`: `101` REQ-16.

  They are exposed through one new public preflight method rather than copied. A second copy of the
  busy rule is exactly the drift Article X warns about, since `101`'s guard has already been
  refined once for season packs.
- **`SubtitleSearchDriver.waiting`** already resolves the Jellyfin item through `resolveItem`. It
  only uses the result when `filePath` is set. For a `mediaServerPresentAt`-only title it now uses
  the item without the path comparison, translates its host path with `MediaRootsService`, runs the
  same `.mkv`/library checks and stores the result in the new `SubtitleSearch.libraryPath`.
  `SubtitleSearchService.details` reads `filePath ?? libraryPath`.

`web` adds one button component and two server actions, next to `101`'s `EmbedSubtitlesButton`,
which is the pattern to copy: a modal, a translated error key and `router.refresh()`.

The alternative was a separate `ManualSubtitleSearchService` with its own checks. It was rejected
because it would duplicate the busy rule and the language union. The constitution's v1.7.0 Check
also names `SubtitleSearchRequestService` as the only place a search is created.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration (`libraryPath`), the two mutations and the two new error keys `web` translates. |
| 2 | `web` | Calls mutations that must exist in `schema.gql`. |

The two can run **in parallel** once this plan is approved: the contract delta in `spec.md` is
complete, and `web` needs nothing from `api` beyond it. `web` can only be checked live after `api`
lands.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an implementer
will be tempted to change and must not:

- **A press refuses (`error.subtitleSearch.in_progress`), it never supersedes.** From inside
  `SubtitleSearchRequestService`, reusing the supersede transaction looks like less code. It would
  throw away downloads a running search already spent (spec REQ-8).
- **The episode's non-owner answer is `error.episode.not_found`**, not `error.show.not_available`.
  That is what `101`'s `resolveTarget` throws, and the preflight reuses it.
- **Refusals reuse `101`'s keys** (`error.subtitleEmbed.no_file`, `not_mkv`, `busy`,
  `outside_library`) rather than new `subtitleSearch` copies. `web` already has their catalog
  entries.
- **The mutation returns the new `SubtitleSearch`**, not `Movie`/`Episode`. `web` renders it in place
  and then refreshes.
- **No delay on the first wake** for a press, while a delivery keeps `103`'s 5 minutes
  (`FIRST_WAKE_DELAY_MS`). Do not "simplify" both to zero: Jellyfin needs those minutes to index a
  fresh delivery.

## Migrations

1. `106_subtitle_search_library_path`: adds `libraryPath VARCHAR(500) NULL` to `subtitle_searches`.
   Existing rows keep null, which is correct, since every existing search is for a title with a
   `filePath`.

Reversibility: dropping the column loses only the path of REQ-7 searches. A non-terminal one would
then fail in `subtitleSyncDetails` with `sync_not_found` and end `FAILED`. Nothing in the library is
affected.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The press path swallows errors like `requestFor` does | `requestFor` catches and logs everything (a delivery must never fail on it). A press reusing it would return success with no row, the button would look like it worked, and nothing would happen | The manual method throws its refusals. A test asserts each REQ-3 refusal reaches the caller as its key and creates no row |
| Two presses race past the in-progress check | Two searches for one title, double quota | The "no non-terminal search" check and the insert run in one serializable transaction, the pattern `SubtitleEmbedService.createGuarded` already uses. A serialization failure (`P2034`) answers `in_progress` |
| A REQ-7 title's validation and embed read different files | `libraryPath` is fixed when the search leaves `WAITING`, but `embedStaged` re-resolves the path from Jellyfin's listing. If Jellyfin's item changed in between, the embed targets another file than the one validated | `embedStaged` already refuses a path that is not a usable `.mkv` in the library. The window is minutes, and the case (a second version swapped in mid-search) is in the spec's "whichever item Jellyfin returns" caveat. Recorded, not engineered around |
| A REQ-7 title has no Jellyfin item at all | The search sits `WAITING` for `103`'s two hours and ends `item_not_found` | Accepted. It is `103`'s posture, it costs no quota, and the outcome is visible in the panel |
| The caller's languages are dropped when their preference is off | `optedInOwners` filters `user.subtitleSearch: true`. A naïve union never includes the caller, and the press refuses `no_languages` or searches only other owners' languages | A test with the caller's preference off and no other owner asserts the caller's languages are wanted |
| `web` shows the button on a title that is not searchable | A refusal on every press | `web` gates it on `status === 'COMPLETED'` and `subtitleSearchAvailable` (see `web/plan.md`). `api` refuses anything that slips through, with a translated message |

## Verification

```bash
bin/cli api npx prisma migrate status
bin/cli api npx --no tsc --noEmit
bin/npm api run test
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/comments api
bin/comments web
```

`web` has no test runner (`services/web/CLAUDE.md`), so its gate is the typecheck, Biome on the
touched files and the manual pass.

Manual pass (needs Jellyfin configured, its OpenSubtitles plugin logged in, and quota left):

1. A user with the `subtitleSearch` preference **off** opens a film delivered before `103` whose file
   lacks one of their subtitle languages. They press "Buscar subtítulos" and confirm. The panel shows
   `WAITING` at once and moves on within a minute (AC-1). `mkvmerge -J` on the library file lists the
   new track.
2. Pressing again while it is `SEARCHING` shows the in-progress message, and
   `bin/mysql -e 'select count(*) from subtitle_searches where movie_id=<id>'` is still 1 (AC-3).
3. An episode row's button: only that episode gets a row (AC-2).
4. A `.mp4` title: refused, with no row and no remote search in Jellyfin's log (AC-4).
5. Media server set to none: the button is gone, and the mutation called directly answers the
   capability message (AC-5).
6. A second user calls the mutation for a film they do not own: not found, no row (AC-6).
7. A film registered after it was already in Jellyfin (`file_path` null, `media_server_present_at`
   set): the search leaves `WAITING` on its first check, and `subtitle_searches.library_path` holds
   its container path (AC-8b).
8. `grep -rn "embedStaged\|requestFor" services/api/src --include=*.ts`: the only callers outside
   tests are `process-jobs/`, the driver and the new resolver (constitution Article XII Check).

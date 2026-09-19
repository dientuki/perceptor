---
title: Downloads Panel Filters, Order and Placement — api slice
service: api
last_updated: 2026-09-19
status: Approved
---

# PLAN: Downloads Panel Filters, Order and Placement — `api` (`api/plan.md`)

## Scope

`api` owns three things in this feature: the order in which `movieDownloads`/`showDownloads` return
rows (REQ-6), the new `Download.seasonNumber` field and the language-neutral season `label`
(REQ-7, REQ-9), and the new `error.magnet.already_attached_season` key replacing the Spanish
season title in `SeasonsService`'s conflict error (REQ-10). It does **not** do any filtering or
counting (that is `web`'s, client-side), adds no timestamp to the contract, and touches no Prisma
schema.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/downloads/entities/download.entity.ts` | Modified | `seasonNumber?: number` as `@Field(() => Int, { nullable: true })` |
| `services/api/src/downloads/downloads.service.ts` | Modified | `seasonLabel()` → `"<Show> S<NN>"`; `seasonNumber` populated on every `Download`; `jobsBySourceId()` also yields the latest job `updatedAt`; last-activity sort in both queries |
| `services/api/src/downloads/downloads.service.spec.ts` | Modified | Ordering test (NFR-5); `seasonNumber`/label assertions |
| `services/api/src/i18n/error-keys.ts` | Modified | `MAGNET_ALREADY_ATTACHED_SEASON: 'error.magnet.already_attached_season'` |
| `services/api/src/i18n/messages.en.ts` | Modified | `That magnet is already attached to «{show} Season {number}»` |
| `services/api/src/seasons/seasons.service.ts` | Modified | Season conflict throws the new key with `{ show, number }`; `seasonDisplayTitle()` deleted |
| `services/api/src/seasons/seasons.service.spec.ts` | Modified | The "different season" case asserts the new key/params and English message |
| `services/api/src/schema.gql` | Regenerated | Boot artifact only — never hand-edited (Article IV) |

## Existing code to reuse

- `downloads.service.ts` `episodeLabel()` — the padding convention (`padStart(2, '0')`) the new
  `seasonLabel()` must match.
- `downloads.service.ts` `jobsBySourceId()` — the single batched `ProcessJob` read per page
  (`REQ-3` of `043`). Extend its select with `updatedAt` and return the per-source maximum
  alongside the grouped jobs; do **not** add a second query, and do **not** widen
  `SourceAltitudeJob` in `src/pipeline-status/pipeline-status.ts` (shared with movies/shows
  status derivation, which has no use for a timestamp).
- `downloads.service.ts` `labelFor()` — the one place `downloadStart`/`downloadStop` resolve a
  label. It already loads the season for a season row; have it resolve `seasonNumber` in the same
  lookup so the mutations return the same shape as the queries.
- `src/i18n/i18n-error.ts` `i18nError.conflict(key, params)` and the `ERROR_KEYS` /
  `MESSAGES_EN` pair — the only way a keyed error is built (`services/api/CLAUDE.md` § "Errors carry
  a translation key").

## Steps

1. Add `seasonNumber` to `Download` (entity). Populate it in `toDownload()`'s callers: from
   `source.season.seasonNumber` in `showDownloads` (already included), from `labelFor()`'s season
   lookup in the mutations, `undefined` for film and episode rows.
2. Rewrite `seasonLabel()` to `` `${show.title} S${NN}` ``.
3. Extend `jobsBySourceId()` to also return, per `mediaSourceId`, the latest `ProcessJob.updatedAt`.
   Adjust its four callers.
4. Add a small pure sort: last activity = max(`source.updatedAt`, latest job `updatedAt`), desc;
   tie → `source.id` desc. Apply it in `movieDownloads` and `showDownloads` after the rows are
   built (or on the sources before mapping — either, as long as both queries use the same
   function). Drop the now-meaningless `orderBy: { createdAt: 'asc' }`. `showDownloads` must also
   select `updatedAt`, which `findMany` already returns by default.
5. Add `MAGNET_ALREADY_ATTACHED_SEASON` to `error-keys.ts` and its English message to
   `messages.en.ts`.
6. In `SeasonsService.attachTorrentSource`, the different-season branch throws
   `i18nError.conflict(ERROR_KEYS.MAGNET_ALREADY_ATTACHED_SEASON, { show: existingSource.season.show.title, number: existingSource.season.seasonNumber })`.
   Delete `seasonDisplayTitle()` (Article X — nothing else calls it).
7. Update the specs (below); boot the api once so `schema.gql` regenerates.

Per Article XI, no new comments. Existing comments on edited lines that became false (e.g. the
`"<Show> Temporada <n>"` one above `seasonDisplayTitle`) go with the code they describe.

## Contract obligations

Exactly `../spec.md` § GraphQL Contract Delta: `Download.seasonNumber: Int` (non-null iff
`seasonId` is non-null), season `label` = `"<Show> S<NN>"`, both queries ordered by last
activity desc, and the new conflict key with params `{ show: string, number: number }` and English
message `That magnet is already attached to «{show} Season {number}»`. Film/episode conflicts keep
`error.magnet.already_attached` `{ title }` unchanged. Read-only — stop and report if it is wrong.

## Tests

- `src/downloads/downloads.service.spec.ts` — **owed** (NFR-5): a wrong order produces no error.
  Cases: (a) an older source whose `ProcessJob.updatedAt` is recent sorts above a newer idle source;
  (b) with no jobs, newer `updatedAt` first; (c) equal activity → higher id first. Cover
  `showDownloads` at least once since it has its own `findMany`. Also assert a season row carries
  `seasonNumber` and `label: "Reacher S03"`, and an episode row carries `seasonNumber` undefined.
  The file already has a header paragraph; extend its `describe`s rather than adding a new file.
- `src/seasons/seasons.service.spec.ts` — update the existing "refuses an infoHash already owned
  by a different season" case to the new key, params and English message. It already exists; a
  stale expectation here would pass on the old Spanish string.
- `error-keys.ts` / `messages.en.ts` — not owed separately; a missing message would fail the
  seasons spec's message assertion.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api run test
git status --short services/api/prisma
git diff services/api/src/schema.gql
```

0 typecheck errors; all tests pass; `prisma/` untouched; `schema.gql` diff is exactly
`seasonNumber: Int` on `Download`.

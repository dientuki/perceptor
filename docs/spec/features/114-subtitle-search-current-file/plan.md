---
title: Subtitle search outcome follows the current file — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-10-30
status: Approved         # Draft | Approved | Implemented
---

# PLAN: Subtitle search outcome follows the current file (`plan.md`)

## Approach

The per-language outcome is already a pure function, `deriveLanguages(search, attempts)` in
`services/api/src/subtitle-search/derive-languages.ts`, called from one place,
`SubtitleSearchService.latest()`. This feature extends that function with a third input, the title's
current `fileSubtitleLanguages` (`string[] | null`), and applies REQ-1's override after the existing
per-language derivation. It does not add a second derivation path or store anything (NFR-1).

The current file's languages come from the **GraphQL parent**, not a new query. The
`latestSubtitleSearch` field resolvers (`MovieSubtitleSearchFieldsResolver`,
`EpisodeSubtitleSearchFieldsResolver`) receive the Prisma `Movie`/`Episode` row as `@Parent()`, and
that row already carries `fileSubtitleLanguages`. `108`'s `MovieLibraryTracksResolver` and
`EpisodeLibraryTracksResolver` read it from the same parent. The resolver passes the parent value
through `latestForMovie`/`latestForEpisode`. NFR-2 and NFR-3 hold with zero extra queries.

The alternative was a Prisma `include` of the title relation inside `latest()`. That costs a join
per call, and the episode list already makes one `findFirst` per episode. The parent value is already
in memory. The two mutations that also call `latestForMovie`/`latestForEpisode`
(`searchMovieSubtitles`/`searchEpisodeSubtitles`) have no parent row. They return a search that just
started and is non-terminal, where REQ-3 says no override, so they pass nothing and get today's result.

`web` only learns two new enum strings and drops one. `SubtitleSearchStatus.tsx` already maps
outcome → colour (`OUTCOME_TEXT_CLASS`) and outcome → label (`media.subtitleSearch.outcome.*`).

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the enum. `schema.gql` is regenerated from it (Article IV). |
| 2 | `web` | Renders the new values; can run in parallel with step 1 since the delta is frozen. |
| 3 | `[docs]` | `graphql-contract.md` `114` section plus the superseded note on `103`'s enum line. |

`api` and `web` can run in parallel: the only shared surface is three enum strings, fixed in
`spec.md`.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`.

- **`EMBEDDED` is removed, not kept as a deprecated alias.** From inside `web` it looks safer to keep
  it in the union. Don't: the user asked for one "resolved" result whatever the route (REQ-2), and a
  leftover `EMBEDDED` branch would keep a second green label alive.
- **`reasonKey` is `null` for `RESOLVED` and `MISSING`.** It is tempting to carry the search's old
  rejection reason onto `MISSING`, or a "resolved manually" key onto `RESOLVED`. Don't: the reason
  described the search, the new outcomes describe the file.
- **The search's top-level `status` badge does not change.** A `FAILED` search with every language
  `RESOLVED` still reads "Fallida" (spec, Out of Scope).

## Migrations

None.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| A query path builds the parent `Movie`/`Episode` without `fileSubtitleLanguages` (a `select` subset) | The value reads `undefined`, which is treated as "never read". The panel silently keeps the stale red, which is today's bug. | REQ-4 makes `undefined` ≡ `null` deliberately, so nothing crashes. The live pass checks film 73 (detail page) and an episode row (season page), the two parents `web` actually renders. Any parent where `108`'s `fileSubtitleLanguages` field already shows a value has the column. |
| Override applied to a search in flight | A language reads `RESOLVED` while the search is still about to embed it, then flips again. | REQ-3: only `COMPLETED`/`FAILED`. Unit test for a `SEARCHING` search with the language in the file. |
| Mixed images (`api` new, `web` old or the reverse) | An unknown outcome string renders raw and grey. No error. | One `PERCEPTOR_TAG` for every image. `web`'s existing fallback is acceptable for the window. |
| `fileSubtitleLanguages` treats a forced-only track as present | A forced Spanish track would turn a rejection green. | `108` REQ-1 already excludes forced tracks. AC-5 checks it live. No new code. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/npm api run lint
bin/comments api
bin/cli web npx --no tsc --noEmit
bin/npm web run lint
bin/cli web node scripts/check-messages.mjs
bin/comments web
```

Manual pass, on an install that has the data:

1. Film 73 (or any film whose latest search rejected a language that was later embedded by hand):
   the detail page reads "Español: Resuelto" in green (AC-1).
2. A film whose search embedded a language itself: it reads "Resuelto" (AC-2).
3. An episode with the same history as step 1: its row in the season accordion reads "Resuelto"
   (AC-7).
4. A title whose search reads `NOT_FOUND` and whose file lacks the language: unchanged (AC-4).
5. Before and after opening the pages, `select * from subtitle_searches where movieId=73` and its
   attempts are identical (AC-9).

AC-3, AC-5, AC-6 and AC-8 are covered by `derive-languages.spec.ts` (AC-10). A live check for them
needs a file replacement or a search caught mid-flight. Tick them from the unit tests and note that
in `pending-acs`.

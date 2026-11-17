---
title: Subtitle Search and Replace — api slice
service: api
last_updated: 2026-11-15
status: Implemented
---

# PLAN: Subtitle Search and Replace — `api` (`api/plan.md`)

## Scope

`api` validates and stores the ticked languages, makes the driver search them as missing, hands
the accepted subset to the embed, exposes it to the worker, and derives `REPLACED`. It owns the
migration and the two error keys.

It does not choose tracks or touch the file: the worker drops tracks by language. It does not
render anything.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` | Modified | `SubtitleSearch.replaceLanguages Json?`, `SubtitleEmbed.replaceLanguages Json?` |
| `prisma/migrations/<ts>_subtitle_search_replace/migration.sql` | New | The two nullable columns |
| `src/subtitle-search/subtitle-search.resolver.ts` | Modified | Optional `replaceLanguages: [String!]` on `searchMovieSubtitles`/`searchEpisodeSubtitles`, passed to `requestForCaller` |
| `src/subtitle-search/subtitle-search-request.service.ts` | Modified | `requestForCaller` validates and lower-cases the list, `createGuarded` stores it; `requestFor` (automatic) never sets it |
| `src/subtitle-search/subtitle-search.driver.ts` | Modified | `missingLanguages` subtracts the ticked set from `presentLanguages`; `embedding` passes the accepted ticked languages to `embedStaged` |
| `src/subtitle-search/derive-languages.ts` | Modified | `SearchRow` gains `replaceLanguages: unknown`; ticked languages: `REPLACED` on accepted + `COMPLETED`; never `ALREADY_PRESENT`; skip `114`'s file override |
| Every caller of `deriveLanguages` (the `SubtitleSearch` field resolvers) | Modified | Select `replaceLanguages` with the rest of the row, or a ticked language derives as unticked |
| `src/subtitle-search/entities/*` (outcome enum) | Modified | `REPLACED` |
| `src/subtitle-embed/subtitle-embed.service.ts` | Modified | `embedStaged(ref, staged, mkvPath, replaceLanguages = [])` stores it on the row; `details()` returns it |
| `src/subtitle-embed/entities/subtitle-embed-details.entity.ts` | Modified | `replaceLanguagesIso3: [String!]!` |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | `SUBTITLE_SEARCH_REPLACE_LANGUAGE_NOT_WANTED`, `SUBTITLE_SEARCH_REPLACE_LANGUAGE_NOT_PRESENT` |

## Existing code to reuse

- `SubtitleSearchRequestService.wantedLanguages(target, userId)` — the wanted set the
  `not_wanted` check is made against. Do not recompute it.
- The target's stored `fileSubtitleLanguages` (`108`) — the `not_present` check.
  `assertManualSearchPreflight`'s target (`resolveTarget`) does **not** select it today: read it
  with one `select: { fileSubtitleLanguages: true }` on the movie/episode inside
  `requestForCaller`, only when the list is non-empty (no extra query for a plain search). Do not
  widen `resolveTarget`, which `embedStaged` and the hand embed share. Compare lower-cased; a `null`
  value means nothing is present. The column includes sidecar languages (`108` resolves sidecar
  tags into it); that is accepted, see spec REQ-7.
- `createGuarded` — the only create for a manual search; add the column there, keep the
  serializable guard.
- `SubtitleSearchDriver.missingLanguages` — the one predicate every step iterates. Changing it is
  enough for searching, validating, `unresolved` and the 3-attempt cap.
- `SubtitleEmbedService.embedStaged` / `queueEmbed` — the existing staged embed; extend, do not
  fork.
- `strings()`/`asStrings()` — the Json-to-string[] readers the driver and derivation already use.

## Steps

1. Schema + migration (apply through api boot or `bin/cli api npx prisma migrate dev`).
2. Error keys and English messages: "That language is not one of the languages searched for this
   title." / "The file has no subtitle in that language to replace."
3. Resolver argument and `requestForCaller(target, userId, replaceLanguages?)`: lower-case, dedupe;
   refuse `not_wanted` first, then `not_present`; both before `createGuarded`. Empty or absent list
   stores `NULL`.
4. Driver: `missingLanguages` = wanted − (present − ticked). `embedding`: the ticked languages that
   have an `ACCEPTED` attempt, passed to `embedStaged`.
5. `embedStaged` stores the list on `SubtitleEmbed.replaceLanguages`; `subtitleEmbedDetails`
   resolves it as `replaceLanguagesIso3` (empty array when `NULL`; the hand embed path never sets
   it).
6. `deriveLanguages`: add `replaceLanguages` to `SearchRow` and to every caller's select. A ticked
   language skips both the `present` short-circuit inside `deriveLanguage` and `114`'s file-language
   override in the outer map; accepted + `COMPLETED` → `REPLACED`; otherwise the normal derivation
   (`languageErrors` → `FAILED`, accepted + `FAILED` search → `FAILED` with the embed's key, which
   is AC-6). `REPLACED` does not depend on whether the worker dropped anything (spec REQ-8).
7. Regenerate `schema.gql` and compare with the spec's delta.

## Contract obligations

Exposes exactly the spec's delta: the optional argument on both mutations, `REPLACED`, the two
`BadRequest` keys, and `SubtitleEmbedDetails.replaceLanguagesIso3: [String!]!` for the worker. The
delta is read-only; if it is wrong, stop and report.

## Tests

- `subtitle-search-request.service.spec.ts` — refuses a language not wanted and one not in the
  file, creates no row; stores the lower-cased list; automatic `requestFor` stores `NULL`.
- `subtitle-search.driver.spec.ts` — a ticked present language is searched; the embed gets only
  ticked languages with an accepted attempt; nothing ticked behaves as before.
- `derive-languages.spec.ts` — ticked + accepted + `COMPLETED` → `REPLACED`; ticked + not found →
  `NOT_FOUND` even though the file holds the language (the silent `114` override); ticked +
  accepted + search `FAILED` → `FAILED`; ticked + `languageErrors` entry → `FAILED`; unticked
  present → `ALREADY_PRESENT`.
- `subtitle-embed.service.spec.ts` — `embedStaged` stores the list; details returns `[]` for
  `NULL`.

## Done when

```bash
bin/cli api npx --no tsc --noEmit        # 0 errors
bin/npm api test                          # all suites pass
bin/comments api                          # PASS
```

and `services/api/src/schema.gql` shows exactly the delta.

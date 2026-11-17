---
title: Subtitle Variant Detection — api slice
service: api
last_updated: 2026-11-15
status: Implemented
---

# PLAN: Subtitle Variant Detection — `api` (`api/plan.md`)

## Scope

`api` owns four things here: the effective subtitle opt-in for an encode
(`EncodeJobDetails.subtitleVariantDetection`), the wanted-variant snapshot of a subtitle search,
the provider query for the wanted variant, and the decision to reject or title a downloaded
candidate from the `variantTag` the worker reports. It also owns the migration.

It does **not** score anything. Every marker, threshold and text read lives in the worker.
`api` never reads a subtitle's text for this feature. It also does not touch `web`'s checkbox
logic: the preference column, mutation and `UserPreferences` field from `110` are unchanged apart
from one description string.

Writes are confined to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` | Modified | `SubtitleSearch.wantedVariants Json?`, `SubtitleSearchAttempt.variantTag String? @db.VarChar(10)` |
| `prisma/migrations/<ts>_subtitle_variant_check/migration.sql` | New | The two `ALTER TABLE … ADD … NULL` |
| `src/languages/variant-opt-in.ts` | New | Pure functions `wantsVariantDetection(owner, kind, variantIso3s)` and `wantedVariants(owners, variantIso3s)`, plus `VARIANT_TRACK_TITLES` |
| `src/languages/variant-opt-in.spec.ts` | New | Case tables for both kinds and for the wanted-variant derivation |
| `src/process-jobs/process-jobs.service.ts` | Modified | `collectAllowedLanguages` calls the shared predicate for `AUDIO` (unchanged result) and `SUBTITLE` (new field) |
| `src/process-jobs/entities/encode-job-details.entity.ts` | Modified | `subtitleVariantDetection: Boolean!` |
| `src/preferences/entities/user-preferences.entity.ts` | Modified | New description of `audioVariantDetection` only |
| `src/subtitle-search/subtitle-search-request.service.ts` | Modified | Resolve and store `wantedVariants` on both create paths |
| `src/subtitle-search/provider-languages.ts` | Modified | `providerVariantCode(tag)` from a constant map |
| `src/subtitle-search/subtitle-search.driver.ts` | Modified | `searchProvider` runs the variant query, then the plain one if short. Dedupe and slice. `embedding` passes `variantTag` |
| `src/subtitle-search/entities/subtitle-sync-details.entity.ts` | Modified | `variantDetectionIso3: String` (nullable) |
| `src/subtitle-search/subtitle-search.resolver.ts` | Modified | `variantTag` argument on `subtitleSyncCompleted` |
| `src/subtitle-search/subtitle-search.service.ts` | Modified | `details()` fills `variantDetectionIso3`. `completed()` validates `variantTag`, applies the wrong-variant rule before `accept()` and stores `variantTag` |
| `src/subtitle-embed/subtitle-embed.service.ts` | Modified | `embedStaged` takes an optional `variantTag` per staged track and titles from `VARIANT_TRACK_TITLES` |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | `SUBTITLE_SEARCH_WRONG_VARIANT: 'error.subtitleSearch.wrong_variant'` and its English text |

## Existing code to reuse

- `src/languages/languages.service.ts` — `regionalVariantIso3s()` is the one source of "which
  `iso3` has variants". Both the encode and the search call it once per request. Do not
  recompute it from tags.
- `src/process-jobs/process-jobs.service.ts` — `collectAllowedLanguages` and its owners select
  (`owner.languages`, `owner.user.languages`, `LanguageTrackKind`) are the merge REQ-3 names.
  The new predicate takes the same row shape, so the search request builds that shape rather than
  inventing a second one.
- `src/subtitle-search/subtitle-search-request.service.ts` — `request()` and `createGuarded()` are
  the only two places a `SubtitleSearch` row is created. Both get `wantedVariants`.
- `src/subtitle-search/candidates.ts` — `filterAndRank` and `MAX_CANDIDATES_PER_LANGUAGE`, applied
  per query. The merge then dedupes and slices.
- `src/subtitle-search/acceptance.ts` — `accept()` stays as is. The variant rule sits next to it
  in `completed()`, not inside it, because it needs the search's snapshot and `accept()` is pure
  over a measurement.
- `src/subtitle-search/derive-languages.ts` — already surfaces the last rejection's `reasonKey`
  as the language's outcome. Nothing to add for REQ-18.
- `src/subtitle-embed/subtitle-embed.service.ts` — `lookupBaseTitles` stays the default, and the
  variant title only overrides it for a decided track.

## Steps

0. **T0, confirm the provider code.** With the dev `.env`'s OpenSubtitles key, call
   `GET https://api.opensubtitles.com/api/v1/infos/languages` once
   (`bin/cli api node -e` with `fetch`, `Api-Key` header) and record here the code OpenSubtitles
   lists for Latin American Spanish, and whether one exists at all. If none exists, the map in
   step 6 stays empty, and REQ-13b's "no code of its own" path covers it. Report this in the task
   result. It is the one external fact this slice depends on.

   **Result (2026-11-15, T002):** OpenSubtitles lists a code of its own for Latin American
   Spanish: **`ea`**. `GET /infos/languages` returned HTTP 200, and the `es`-related lines are:
   `{"language_code":"es","language_name":"Spanish"}`,
   `{"language_code":"sp","language_name":"Spanish (EU)"}` and
   `{"language_code":"ea","language_name":"Spanish (LA)"}`. So in step 6
   `PROVIDER_VARIANT_CODES = { 'es-419': 'ea' }`. The response also names `sp` for European Spanish,
   but no step here needs it, since `es-ES` stays unmapped and uses the plain query.
1. **Migration.** Add both columns to `schema.prisma` and generate
   `<ts>_subtitle_variant_check` with `bin/cli api npx prisma migrate dev --name
   subtitle_variant_check`. Check the SQL is exactly two nullable `ADD`s.
2. **`src/languages/variant-opt-in.ts`.**
   - `wantsVariantDetection(owner, kind, variantIso3s)`: the owner's preference is on and their
     merged rows of `kind` include an `iso3` in `variantIso3s`. This is `110` REQ-4's predicate,
     lifted verbatim and parameterised by kind.
   - `wantedVariants(owners, variantIso3s)`: returns `null` when no owner passes
     `wantsVariantDetection(…, SUBTITLE, …)`. Otherwise it returns an object holding, for each
     `iso3` in `variantIso3s`, the single distinct region-subtagged tag those owners' subtitle rows
     name for it. A language whose owners name zero or two distinct region tags is omitted. Plain
     tags (`es`) are ignored, the same rule as `031`'s `requestedVariants`, so `es` + `es-419`
     wants `es-419`.
   - `VARIANT_TRACK_TITLES = { 'es-419': 'Latino', 'es-ES': 'Español (España)' }`.
3. **Encode.** In `collectAllowedLanguages`, replace the inline `110` predicate with
   `wantsVariantDetection(…, AUDIO, …)` and add
   `subtitleVariantDetection = owners.some(o => wantsVariantDetection(o, SUBTITLE, variantIso3s))`.
   Thread it to the three `EncodeJobDetails` builders next to `audioVariantDetection`, and add the
   entity field.
4. **Search snapshot.** In `subtitle-search-request.service.ts`, load the title's owners with
   `user.audioVariantDetection`, their global subtitle rows and their per-title subtitle rows, in
   the shape step 2 takes. Covering every owner of the title, not only those opted into
   `subtitleSearch`, is spec REQ-3's wording. Store `wantedVariants(…)` on the created row in
   `request()` and `createGuarded()`.
5. **`details()`.** Set `variantDetectionIso3` to the attempt's `languageIso3` when
   `search.wantedVariants !== null` **and** that `iso3` is in `regionalVariantIso3s()`. Otherwise
   set it to `null`.
6. **Provider query.** Add `PROVIDER_VARIANT_CODES: Record<string, string>` in
   `provider-languages.ts`, holding T0's code for `es-419` or nothing, and
   `providerVariantCode(tag)`. In `searchProvider`, when `wantedVariants?.[language]` maps to a
   code, query that code first, `filterAndRank` it, and if fewer than
   `MAX_CANDIDATES_PER_LANGUAGE` came back, query the plain codes too. Concatenate the variant
   group first, drop a plain-group candidate whose `id` is already present, and slice to the max.
   Log both queries at `debug` with their counts. Otherwise the query is exactly today's.
7. **`completed()`.** Add the `variantTag` argument (nullable) on the resolver and pass it to the
   service.
   - Validate it: keep it only if a `Language` row has that tag, contains `-` and shares the
     attempt's `iso3`. Otherwise log a warning and use `null`.
   - Evaluate the variant rule first: if the search's `wantedVariants?.[iso3]` exists and the
     valid tag differs from it, `reasonKey = SUBTITLE_SEARCH_WRONG_VARIANT`. Only otherwise run
     `accept()`.
   - Write `variantTag` in the same guarded `updateMany` as the rest of the measurement.
8. **Embed title.** In `subtitle-search.driver.ts`'s `embedding()`, carry the accepted attempt's
   `variantTag` into each staged track. In `embedStaged`, use
   `VARIANT_TRACK_TITLES[variantTag] ?? baseTitles.get(iso3) ?? iso3` for the `trackTitle`. The
   stored `languageIso3` stays the `iso3` (REQ-16).
9. **Error key.** Add `SUBTITLE_SEARCH_WRONG_VARIANT` and its English message ("The subtitle found
   is in the other variant of the language.").
10. **Schema check.** Regenerate `schema.gql` by booting the dev `api`, then
    `git diff services/api/src/schema.gql`. The diff is exactly the spec's delta: one description,
    two nullable additions and one non-null field.

## Contract obligations

`api` exposes exactly `spec.md` § GraphQL Contract Delta:

- `EncodeJobDetails.subtitleVariantDetection: Boolean!` — never null. `false` when no owner
  qualifies.
- `SubtitleSyncDetails.variantDetectionIso3: String` — `null` unless the snapshot is non-null and
  the language has regional variants.
- `subtitleSyncCompleted(…, variantTag: String)` — an absent argument and `null` are the same
  thing. An invalid tag is logged and ignored, never an error. The mutation keeps its idempotent
  `true`/`false` behaviour.
- `UserPreferences.audioVariantDetection` — the description changes and nothing else does.
  `setAudioVariantDetection` is untouched.
- The wrong-variant outcome is not an error. It is `SubtitleSearchLanguage { outcome: REJECTED,
  reasonKey: "error.subtitleSearch.wrong_variant" }` through the existing derivation.

## Tests

- `src/languages/variant-opt-in.spec.ts` — defends against the opt-in or the wanted variant being
  derived wrongly, which is silent: detection runs for nobody, or rejects the variant the user
  asked for. Cases: audio-only and subtitle-only owners for each kind; preference off; per-title
  rows merged with global ones; `es` + `es-419` → `es-419`; `es-419` + `es-ES` across two owners →
  omitted; nobody opted in → `null`. It also pins `VARIANT_TRACK_TITLES` against the worker's
  `031` strings.
- `src/process-jobs/process-jobs.service.spec.ts` — the existing `110` cases stay green
  **unchanged**, which proves the lift kept audio's result. Add cases where
  `subtitleVariantDetection` follows the subtitle rows only.
- `src/subtitle-search/subtitle-search.service.spec.ts` — defends against a wrong-variant candidate
  being accepted, or a good one rejected, both silent. Cases: wanted `es-419`, reported `es-ES` →
  `REJECTED`/`wrong_variant` even with a perfect measurement; reported `es-419` → `accept()`
  decides; `null` → `accept()` decides; an invalid tag → treated as `null` and logged; a snapshot
  of `null` → never rejected for variant; a candidate that fails both rules shows `wrong_variant`.
  `variantTag` is stored in every case.
- `src/subtitle-search/subtitle-search.driver.spec.ts` — defends against spending quota twice or
  over the limit. Cases: variant query returns 3 → no plain query; returns 1 → plain query, the
  variant one ranks first, at most 3 in total; an overlapping id is deduped; no wanted variant →
  only the plain query, exactly today's call. `embedding()` passes `variantTag` through.
- `src/subtitle-search/provider-languages.spec.ts` — extend with `providerVariantCode` for a mapped
  tag, an unmapped tag and `es-ES`.
- `src/subtitle-embed/subtitle-embed.service.spec.ts` — a decided `es-419` staged track is titled
  `Latino`, and an undecided one keeps `lookupBaseTitles`' `Español`.
- Not owed: the entity field additions and the resolver argument plumbing. The schema diff in
  step 10 and the service specs above catch a missing field.

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli api npx prisma migrate status
bin/comments api
git diff services/api/src/schema.gql
```

All pass, `migrate status` reports no pending migration, and the schema diff matches the spec's
delta and nothing else.

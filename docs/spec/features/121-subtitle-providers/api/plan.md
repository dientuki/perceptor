---
title: Subtitle Providers — api slice
service: api
last_updated: 2026-11-17
status: Approved
---

# PLAN: Subtitle Providers — `api` (`api/plan.md`)

## Scope

`api` owns everything in this feature except the Settings tab's UI and the provider label on a
resolved language. That covers:

- the migration and the seed rows;
- the `subtitle-providers/` module with its four admin operations and `chainFor`;
- the Subdivx client;
- in-memory archive extraction and UTF-8 normalization at staging;
- the driver's per-language provider chain;
- `SubtitleSearchLanguage.provider`;
- `subtitleSearchAvailable`'s new meaning;
- refusing `opensubtitles_*`/`subdivx_api_key` in `updateSettings` and hiding both secrets from
  `settings`;
- REQ-11's IMDb ids.

It does **not** touch the worker's queues, payloads or the `subtitle-sync`/`subtitle-embed`
contracts. Every staged file is still one UTF-8 `.srt` at the same path shape. Writes are confined
to `services/api/` and this directory.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `prisma/schema.prisma` + one migration | Modified / New | `SubtitleProviderKind` enum, `SubtitleSearchAttempt.provider`, `SubtitleSearch.providerProgress`, `Movie`/`Show` `imdbId` + `imdbIdCheckedAt` |
| `prisma/seeds/settings.ts` | Modified | `subdivx_api_key`, `subtitle_provider_default`, `subtitle_provider_languages` (create-only) |
| `src/subtitle-providers/registry.ts` | New | The two kinds: setting keys, `isConfigured(map, appKeyPresent)`, `servesLanguage(iso3)` |
| `src/subtitle-providers/language-chain.ts` | New | Pure: parse stored default/languages, derive the effective default (REQ-5), `chain(iso3, variantTag, baseTag, configured, default, languages)` (REQ-7) |
| `src/subtitle-providers/subtitle-providers.service.ts` | New | `read()`, `save()`, `remove()`, `setLanguages()`, `chainFor()` |
| `src/subtitle-providers/subtitle-providers.resolver.ts` | New | Four operations, `@UseGuards(AdminGuard)` per method |
| `src/subtitle-providers/entities/*`, `dto/*` | New | `SubtitleProvider`, `SubtitleProviderLanguage`, `SubtitleProviderSettings`, the two inputs, `registerEnumType(SubtitleProviderKind)` |
| `src/subtitle-providers/subtitle-providers.module.ts` | New | Imports `SettingsModule` (getMap) and `LanguagesModule` (tag validation) |
| `src/clients/subtitle-provider-error.ts` | New | `SubtitleProviderHttpError(provider, kind, method, path, status)` |
| `src/clients/opensubtitles/errors.ts` | Deleted | Replaced by the shared class |
| `src/clients/opensubtitles/client.ts` | Modified | Throws the shared class. The 429 wait helper moves out (next row) |
| `src/clients/retry-after.ts` | New | Pure `boundedRetryAfterMs(res, maxMs, defaultMs)`, extracted from `OpenSubtitlesClient.rateLimitWaitMs`, used by both clients |
| `src/clients/subdivx/client.ts`, `types.ts` | New | `search(params)`, `download(id)` against SubX API |
| `src/subtitle-search/subdivx-candidates.ts` | New | Pure: SubX items → `SubtitleCandidate[]`, REQ-12 episode matching, season packs after exact matches |
| `src/subtitle-search/archive.ts` | New | Pure, in-memory: bytes → `{ srt: Buffer, entryName } \| { rejected }` (REQ-13, NFR-1) |
| `src/subtitle-search/to-utf8.ts` | New | Pure: bytes → UTF-8 bytes (REQ-14) |
| `src/subtitle-search/subtitle-search.driver.ts` | Modified | Provider chain, provider-scoped flags, `archive`/`to-utf8` before `staging.write`, provenance |
| `src/subtitle-search/derive-languages.ts` | Modified | Last-provider rule, `provider` on the output |
| `src/subtitle-search/entities/subtitle-search.entity.ts` | Modified | `SubtitleSearchLanguage.provider` |
| `src/subtitle-search/subtitle-search.module.ts` | Modified | Imports `SubtitleProvidersModule`, `ImdbIdsModule`; provides `SubdivxClient` |
| `src/imdb-ids/imdb-ids.service.ts`, `imdb-ids.module.ts` | New | `record(type, id, imdbId)`, `resolve(type, id)` |
| `src/clients/tmdb/client.ts` + its mappers/types | Modified | `details()` returns `imdbId`; series request appends `external_ids` |
| `src/movies/movies.service.ts`, `src/shows/shows.service.ts` | Modified | Carry or record `imdbId` where details are already read |
| `src/media/media-capabilities.service.ts` | Modified | `subtitleSearchAvailable` = some registry kind configured; description per REQ-16 |
| `src/media/entities/media-capabilities.entity.ts` | Modified | Field description only |
| `src/settings/settings.catalog.ts` | Modified | Remove `opensubtitles_username`/`opensubtitles_password` |
| `src/settings/settings.resolver.ts` | Modified | `settings` omits `opensubtitles_password` and `subdivx_api_key` |
| `src/i18n/error-keys.ts`, `src/i18n/messages.en.ts` | Modified | `error.subtitleProvider.*` (six keys), `error.subtitleSearch.no_provider`, `error.subtitleSearch.archive_unusable`; reword the three provider keys provider-neutrally |
| `package.json` | Modified | `fflate`, `node-unrar-js` |

## Existing code to reuse

- `src/subtitle-search/candidates.ts` — `SubtitleCandidate`, `filterAndRank`,
  `MAX_CANDIDATES_PER_LANGUAGE`, `releaseSimilarity`. Subdivx maps onto the same shape. Do not
  write a second ranker.
- `src/subtitle-search/staging.ts` — `write(searchId, attemptId, bytes)` stays the only writer;
  it receives the normalized `.srt` bytes. `removeSearch`/`sweep` already clean what this feature
  stages.
- `src/subtitle-search/provider-languages.ts` — `providerLanguageCodes`/`providerVariantCode` stay
  OpenSubtitles-only (Subdivx is Spanish-only and takes no language parameter). Its base-tag rule
  (`!tag.includes('-')`) is the one `language-chain.ts` uses to find a language's base tag.
- `src/subtitle-embed/sidecar-text.ts` — `decodeSidecar`'s BOM/UTF-16 handling. `to-utf8.ts`
  imports it as a file (never `SubtitleEmbedModule`, the `113` precedent).
- `src/clients/opensubtitles/client.ts` — `send`'s single bounded 429 retry and the shape of
  `search`/`download`. `SubdivxClient` follows the same posture: fetch failures become `unavailable`
  with a fixed message, never the raw error.
- `src/languages/languages.service.ts` — `validateAndResolveLanguageIds` for language entry tags
  (`error.language.unavailable`). The data-driven Spanish check follows `regionalVariantIso3s()`'s
  idiom: read `Language` rows by `iso3`.
- `src/media-server-index/media-server-index.service.ts` — the precedent for Setting rows written
  through `prisma.setting` outside `SETTINGS_CATALOG`.
- `src/settings/settings.service.ts` — `getMap()` is the one read of Settings. `updateMany` already
  refuses keys missing from the catalog with `error.setting.not_editable`, so removing the two
  `opensubtitles_*` entries is all REQ's refusal needs.
- `src/clients/opensubtitles/key.ts` — `openSubtitlesApiKey()` stays the only source of the
  application key, for `registry.ts`'s OpenSubtitles predicate and for `app_key_missing`.
- `src/auth/guards/admin.guard.ts` — per method, the `ffprobe-logs.resolver.ts` split.

## Steps

1. **Schema.** Add the enum, the five columns and the migration (`bin/npm api run prisma:migrate`),
   then seed the three Setting rows create-only.
2. **Shared error and retry helper.** Introduce `SubtitleProviderHttpError` and
   `boundedRetryAfterMs`. Move `OpenSubtitlesClient` onto them. Delete
   `clients/opensubtitles/errors.ts` and update its spec and the driver's `instanceof` checks.
3. **Registry and language chain (pure).** `registry.ts`:
   - `OPENSUBTITLES` is configured iff `openSubtitlesApiKey() !== null` and a trimmed username and
     a non-empty password exist.
   - `SUBDIVX` is configured iff `subdivx_api_key` is non-empty after trimming.
   - Served languages: all for OpenSubtitles; for Subdivx, `iso3 === 'spa'`.

   `language-chain.ts`:
   - `effectiveDefault` follows REQ-5: the stored value if it names a configured kind, else the
     first configured kind in enum order, else `null`.
   - `parseLanguages` is defensive: garbage reads as `[]` and logs once.
   - `chain(...)` follows REQ-7: the variant language entry, else the base-tag language entry, then the default.
     Unconfigured or non-serving kinds are skipped and none repeats.
4. **`SubtitleProvidersService`.**
   - `read()` builds `SubtitleProviderSettings` from `getMap()`. `secretSet` is true when the
     secret is non-empty. `languageTags` is `null` for OpenSubtitles and, for Subdivx, the
     `Language.tag`s with `iso3 = spa`.
   - `save(input)` covers `field_not_allowed`, `app_key_missing` and `incomplete`. A null or empty
     secret keeps the stored one. Per the plan decision, persist the derived default before
     configuring a second kind while the stored default is `""`. Write the rows in one
     `$transaction`.
   - `remove(kind)` raises `not_configured` for an unconfigured kind. Otherwise it clears the
     kind's rows and drops its languages. If it was the stored default, it writes `""` so REQ-5
     derives the remaining one.
   - `setLanguages(default, languages)` checks, in the order of the spec's error table:
     `not_configured` (default), then per language entry the tag (`error.language.unavailable`),
     `language_unsupported`, `language_invalid` and `language_duplicate`. It then writes both rows in
     one `$transaction`.
   - Every operation returns `read()`.
5. **Resolver and module.** Expose the four operations, each with `@UseGuards(AdminGuard)` per
   method.
6. **Settings.** Remove the two catalog entries. Filter `opensubtitles_password` and
   `subdivx_api_key` out of the `settings` query's result, in the resolver and not in
   `findAll()`, which `getMap()` needs. Rewrite `subtitleSearchAvailable` in
   `MediaCapabilitiesService.read()` through `registry.ts`, plus its field description.
7. **TMDB and IMDb.**
   - `details()` maps `imdb_id` (film) and `external_ids.imdb_id` (series, via
     `?append_to_response=external_ids` on the same request) to `imdbId: string | null`. A value
     not matching `^tt\d+$` reads as `null`.
   - `ImdbIdsService.record(type, id, imdbId)` writes both columns.
   - `resolve(type, id)` returns the stored value when `imdbIdCheckedAt` is set. Otherwise it
     makes one `details()` call: on success it records, even a `null`; on a TMDB failure it stamps
     nothing and returns `null`.
   - Wire `record` (or carry into `create`) at:
     - `MoviesService.topUpCatalogFacts`: carry `imdbId` on `topped` into `register()`'s `create`,
       with `imdbIdCheckedAt` only when details were actually read;
     - `refreshCatalog`;
     - `ShowsService.hydrate`/`syncCatalogFromTmdb` (covers Refresh, `refresh_shows` and
       hydration).

   - REQ-11 (c): in `MoviesService.register()`, after the row is created and only when
     `topUpCatalogFacts` read no details, start `void this.imdbIds.resolve('movie', movie.id)`.
     It is detached and never awaited; failures are caught and logged inside `resolve`. It also
     runs on the `P2002` re-read branch only if that row's `imdbIdCheckedAt` is `NULL`.
     `ShowsService.register()` gets no such call (`hydrate` covers it).

     Do **not** add `imdbId` to the cached `MediaSearchResult` shape. TMDB search returns no IMDb
     id, so it would be absent there anyway. There is no other `details()` call for it.
8. **Subdivx client.** Base URL `https://subx-api.duckdns.org/api` (link to the docs above the
   class, Article XI exception 1). Header `Authorization: Bearer <subdivx_api_key>`.
   - `search({ imdbId?, title?, year?, query? })` calls `GET /subtitles/search` with `limit=200`
     and returns `items`.
   - `download(id)` calls `GET /subtitles/{id}/download` and returns
     `{ bytes, fileName | null }`, with the file name parsed from `Content-Disposition`.
   - Status mapping:
     - 401/403 → `unauthorized`;
     - 429 → one wait through `boundedRetryAfterMs` (10 s cap), then `rate_limited`;
     - 400, 404 or 502 on a download → a candidate-level fetch failure (the driver records
       `fetch_failed` and tries the next candidate);
     - any other non-2xx, or a network error → `unavailable`.
9. **`subdivx-candidates.ts` (pure).** Map items to `SubtitleCandidate`: `id`;
   `release = description ?? title`; `downloadCount = downloads`; `fileCount = 1`; every flag
   `false`. For an episode, keep an item when:
   - `season` and `episode` both equal the target's; or
   - both are null and the title or description matches `S0?<s>E0?<e>` (case-insensitive,
     word-bounded); or
   - `season` equals the target's and `episode` is null (season pack).

   Exact matches come first. Then run `filterAndRank` separately on each group (exact matches,
   then season packs) and keep the first `MAX_CANDIDATES_PER_LANGUAGE`.
10. **`archive.ts` and `to-utf8.ts` (pure).**
    - Detect zip (`PK\x03\x04`) or rar (`Rar!\x1a\x07`) by magic bytes; anything else is passed
      through as a plain `.srt`.
    - Enumerate entries from headers first and reject when there are more than 500 entries or the
      declared total exceeds 20 MB. Ignore directories, `__MACOSX/` and dot-files.
    - Pick per REQ-13 (`episode` arg optional), then inflate **only** the chosen entry, aborting
      past 20 MB.
    - Every rejection returns `archive_unusable`; nothing throws.
    - `to-utf8.ts`: `decodeSidecar` for a BOM, else a strict `TextDecoder('utf-8', { fatal: true })`,
      else `TextDecoder('windows-1252')`. It returns UTF-8 bytes without a BOM.
11. **Driver.**
    - Inject `SubtitleProvidersService`, `SubdivxClient` and `ImdbIdsService`.
    - Load `chainFor(iso3, wantedVariants[iso3])` once per `advance` per language, cached in
      `StepContext`.
    - An empty chain writes `languageErrors[iso3] = no_provider` at the top of `searching()`.
    - `attemptsOf(search, language)` filters to the current provider: the first chain entry with
      no `providerProgress` marker. Rewrite `unresolved()` to look for `ACCEPTED` across **all**
      providers of the language.
    - When the current provider ends with nothing accepted, write its marker:
      - `empty` after a zero-candidate search;
      - `exhausted` when every attempt of it is terminal and none is accepted;
      - the error key from a `SubtitleProviderHttpError`.

      Then continue the same loop iteration with the next provider. When none is left and the
      last marker is an error key, write it to `languageErrors`.
    - `flagLanguages` becomes `flagProvider(kind, languages, key)`. It writes the marker for
      `kind` only, and only for languages whose current provider is `kind`. OpenSubtitles'
      `remaining === 0` quota path uses it.
    - `searchProvider` dispatches by kind:
      - OpenSubtitles: unchanged.
      - Subdivx, film: `imdbId` from `ImdbIdsService.resolve` → `search({ imdbId })`. Without an
        IMDb id, `search({ title, year })` instead.
      - Subdivx, episode: the series' `imdbId` → `search({ imdbId })` → `subdivx-candidates`.
        With no id, or no match, a single fallback `search({ query: "<Series> SxxEyy" })` →
        `subdivx-candidates`.
    - `createMany` writes `provider`.
    - `startNext` downloads through the attempt's own provider, runs `archive.ts`
      (`archive_unusable` → `failAttempt` with that key, then the next candidate), then
      `to-utf8.ts`, then `staging.write`.
    - Store `providerFileName` per the plan's decision. Provenance in `embedding` becomes
      `providerFileName ?? \`${kind.toLowerCase()}:${providerSubtitleId}\``, with Subdivx's
      prefixed `subdivx:` when it comes from a file name (REQ-15).
    - Keep `searching()`'s resume logic (`withAttempts`/`start`) correct: a language counts as
      "has attempts" if any provider produced attempts for it.
12. **`deriveLanguages`.** Pass `providerProgress` and each attempt's `provider`. A language's
    outcome comes from the attempts of the last provider in `providerProgress` insertion order. A
    language whose only marker is `empty` reads `NOT_FOUND` once the search is past `SEARCHING`.
    An `ACCEPTED` attempt of any provider wins. `provider` is set on `RESOLVED`/`REPLACED` only,
    from the accepted attempt. `114`/`119` overrides are untouched: they keep `provider` when the
    outcome stays `RESOLVED`/`REPLACED` and null it otherwise.
13. **i18n.** Add the eight new English messages. Reword `provider_unauthorized`,
    `provider_unavailable`, `quota_exhausted` and `provider_not_configured` without naming
    OpenSubtitles.
14. **Amendment 0.2.0.**
    - REQ-10: `searchSubdivx`'s film branch retries once by `title` (every `:` removed) and
      `year` when the IMDb lookup returns no items. Done during the live pass, with two driver
      cases.
    - REQ-18: a pure `subtitle-search/film-rate.ts` holds `FILM_RATE_RATIOS` (`24/23.976` and its
      inverse), `filmRateRatio(reported)` (the exact ratio for a report within 0.0005 of either,
      else `null`) and `rescaleSrt(text, ratio)` (every `HH:MM:SS,mmm` cue time multiplied and
      re-rendered, nothing else touched; `null` when a cue time does not parse). `accept()` gains
      an optional `{ filmRate: true }`, passed by `SubtitleSearchService.completed()` only, under
      which a film-rate ratio passes the framerate check and coverage reads `lastCueEndMs × ratio
      + offset`. `113`'s `SubtitleEmbedSyncService` keeps calling `accept()` without it.
      `completed()` rewrites the staged file with `rescaleSrt` before the attempt is written
      `ACCEPTED`. A rewrite that fails (unparseable cue, write error) rejects the attempt with
      `error.subtitleSearch.incomplete`, never accepts an unscaled file. The stored
      `framerateRatio` stays the reported value. No contract, no migration, no `worker` change.

## Contract obligations

Exactly the delta in `../spec.md` § GraphQL Contract Delta:

- the `SubtitleProviderKind` enum;
- the three object types and the two inputs;
- `Query.subtitleProviders`;
- the three mutations;
- `SubtitleSearchLanguage.provider` (nullable);
- `MediaCapabilities.subtitleSearchAvailable`'s new description, with name and type unchanged.

Every error in the spec's table is raised with its key, through `i18nError`, before any write. The
`updateSettings` refusal comes from the existing catalog check. `web` and `worker` retype this by
hand, so a renamed field or an unlisted key is a runtime failure in another service. If the delta
is wrong, stop and report.

The worker-facing contracts (`subtitleSyncDetails`, `subtitleEmbedDetails`, the queue payloads) do
**not** change. `SubtitleEmbedTrack.provenance` keeps its type; only its value can now start with
`subdivx:`.

## Tests

All new suites open with the Article IX header naming the silent failure.

- `src/subtitle-providers/language-chain.spec.ts` — a wrong chain silently sends a language to the wrong
  provider or skips the fallback. Cases: variant language entry beats base language entry; base language entry applies to a
  variant without its own; default appended once; unconfigured/non-serving kinds skipped; empty
  chain; REQ-5 derivation with `""` and with a stale stored default; garbage languages JSON.
- `src/subtitle-providers/subtitle-providers.service.spec.ts` — REQ-17 (only OpenSubtitles rows
  set reads as configured and default); a second provider never flips the default; remove drops
  languages and the default; every error key in the table; a blank secret keeps the stored one.
- `src/settings/settings.resolver.spec.ts` (extend if present, else new) — `settings` never contains
  `opensubtitles_password`/`subdivx_api_key`. NFR-4 leaks produce no error.
- `src/settings/settings.service.spec.ts` (extend) — `updateMany` refuses the three keys.
- `src/subtitle-search/subtitle-search.driver.spec.ts` (extend). This is the highest-risk unit;
  fault-inject each case:
  - three rejected Subdivx attempts → OpenSubtitles searched;
  - a zero-candidate Subdivx → OpenSubtitles searched;
  - Subdivx unauthorized → falls back and the search does not FAIL;
  - OpenSubtitles quota does not mark an `es-419` language still on Subdivx;
  - an empty chain → `no_provider` with no client called;
  - English never calls Subdivx;
  - `providerProgress` written (drop the write and the "no re-search on wake" case must fail);
  - archive rejection tries the next candidate;
  - provenance prefix.
- `src/subtitle-search/derive-languages.spec.ts` (extend) — last-provider rule, `provider` set only
  for `RESOLVED`/`REPLACED`, `114`/`119` overrides still applied.
- `src/subtitle-search/subdivx-candidates.spec.ts` — a wrong episode match stages a subtitle for
  another episode, which sync might even accept. Cases: field match, `SxxEyy` in the description,
  season pack ranked after exact matches, other season dropped, film passthrough.
- `src/subtitle-search/archive.spec.ts` — fixtures built in-test for zip (`fflate.zipSync`). Rar
  uses a tiny committed fixture under `src/subtitle-search/__fixtures__/`, since rar cannot be
  written from Node. Cases: single srt; several with one `SxxEyy` match; several ambiguous; no srt
  (only `.sub`); `../evil.srt` entry name; more than 500 entries; declared size over 20 MB;
  corrupt bytes; plain srt passthrough.
- `src/subtitle-search/to-utf8.spec.ts` — Windows-1252 bytes (`0xE1` → `á`), UTF-8 with accents
  unchanged, UTF-8 BOM stripped, UTF-16LE BOM decoded.
- `src/clients/subdivx/client.spec.ts` — status → kind mapping, one bounded 429 retry, Bearer
  header present, `Content-Disposition` parsing, key never in a thrown message.
- `src/clients/tmdb/client.spec.ts` (extend) — film `imdb_id`, series `external_ids.imdb_id` and the
  `append_to_response` parameter on the **same** request, an invalid id reads as `null`.
- `src/imdb-ids/imdb-ids.service.spec.ts` — a stamped "none" is never re-fetched; a TMDB failure
  stamps nothing and does not throw (it runs detached, where a throw would be an unhandled
  rejection).
- `src/movies/movies.service.spec.ts` (extend) — `register()` starts the detached `resolve` only
  when the top-up read no details, and a rejected `resolve` does not fail `register()`.
- `src/subtitle-search/film-rate.spec.ts` — a wrong factor or direction embeds a subtitle that
  drifts by seconds with no error anywhere. Cases: `0.999` and `1.001` map to the exact inverse
  pair, `1.043` and `1.0` map to `null`, rescaling `01:00:00,000` by `24/23.976` gives
  `01:00:03,604`, cue text and numbering are untouched, an unparseable time returns `null`.
- `src/subtitle-search/acceptance.spec.ts` (extend) — `0.999` is rejected without `filmRate` and
  accepted with it, `1.043` is rejected either way, coverage uses the scaled last cue.
- `src/subtitle-search/subtitle-search.service.spec.ts` (extend) — an accepted film-rate attempt
  rewrites its staged file before the `ACCEPTED` write; a PAL one leaves the file untouched.
- Not owed: the resolver wiring and entities (no logic), and `media-capabilities.service.ts` (one
  delegated predicate, covered through the language configuration/registry specs).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/comments api
bin/audit api
git status --short services/api/prisma
git diff services/api/src/schema.gql
```

- The typecheck reports 0 errors and the tests pass.
- `bin/comments` and `bin/audit` are clean.
- `git status` shows a modified `schema.prisma` plus exactly one new migration directory.
- The `schema.gql` diff matches `../spec.md` § GraphQL Contract Delta.

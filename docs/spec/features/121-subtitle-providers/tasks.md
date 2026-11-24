---
title: Subtitle Providers — Tasks
last_updated: 2026-11-17
status: In Progress
---

# TASKS: Subtitle Providers (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation and the live pass. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

There is no `[worker]` task: staging still hands the worker one UTF-8 `.srt` at the same path
shape. There is no `[infra]` task either: archives are opened in memory with pure JS/WASM
dependencies (`plan.md` § Approach). If an implementer finds a native binary unavoidable, that is
a stop-and-report, not a Dockerfile edit.

## Tasks

### Group 1 — schema and the contract `web` reads (`api`)

- [x] **T001** `[api]` Migration `<ts>_subtitle_providers` (`api/plan.md` step 1):
      - `enum SubtitleProviderKind`
      - `SubtitleSearchAttempt.provider` (default `OPENSUBTITLES`)
      - `SubtitleSearch.providerProgress Json?`
      - `Movie`/`Show` `imdbId` + `imdbIdCheckedAt`
      - Seed rows `subdivx_api_key`, `subtitle_provider_default` and `subtitle_provider_languages`,
        all create-only.

      *Done when:* `bin/cli api npx prisma migrate status` reports the migration applied, and
      `bin/mysql -e "select count(*) from subtitle_search_attempts where provider <> 'OPENSUBTITLES'"`
      → 0. The three Setting rows exist with `""`/`""`/`"[]"`.
- [x] **T002** `[api]` Registry and language chain, both pure, with their spec (`api/plan.md` step 3):
      - `src/subtitle-providers/registry.ts`
      - `src/subtitle-providers/language-chain.ts`: REQ-5 effective default, defensive language entry parsing,
        REQ-7 chain.
      - Add `error.subtitleProvider.*` (six keys), `error.subtitleSearch.no_provider` and
        `error.subtitleSearch.archive_unusable` to `error-keys.ts` and `messages.en.ts`.
      - Reword the three provider-wide messages and `provider_not_configured` without naming
        OpenSubtitles.

      → T001
      *Done when:* `language-chain.spec.ts` passes. It covers variant language entry over base language entry, base language entry
      for an unassigned variant, default appended once, unconfigured and non-serving kinds skipped,
      an empty chain, `""` and stale stored defaults, and garbage JSON. Removing the "skip
      non-serving" line makes a case fail.
- [x] **T003** `[api]` `SubtitleProvidersService`, resolver, entities, DTOs and module
      (`api/plan.md` steps 4–5): `subtitleProviders`, `saveSubtitleProvider`,
      `removeSubtitleProvider` and `setSubtitleProviderLanguages`, `AdminGuard` per method. → T002
      *Done when:* `subtitle-providers.service.spec.ts` passes. It covers every error key in the
      spec's table, a blank secret keeping the stored one, a second provider not flipping the
      default, remove dropping languages and the stored default, and REQ-17 (only OpenSubtitles rows
      → configured and default). `schema.gql` shows the enum, three types, two inputs, the query
      and the three mutations exactly as in `spec.md`.
- [x] **T004** `[api]` Settings and capability (`api/plan.md` step 6):
      - remove `opensubtitles_username`/`opensubtitles_password` from `SETTINGS_CATALOG`;
      - make the `settings` query omit `opensubtitles_password` and `subdivx_api_key`;
      - compute `subtitleSearchAvailable` through `registry.ts` (some kind configured) and update
        its field description.

      → T002
      *Done when:* specs prove that `updateSettings` refuses all three keys with
      `error.setting.not_editable` and that `settings` contains neither secret. A capability case
      shows only Subdivx configured → `true` and nothing configured → `false`. `schema.gql`
      shows the new description only.

### Group 2 — the search itself (`api`)

These change no contract `web` reads except `SubtitleSearchLanguage.provider` (T009).

- [x] **T005** `[api] [P]` Shared provider error and retry helper (`api/plan.md` step 2):
      - `src/clients/subtitle-provider-error.ts`
      - `src/clients/retry-after.ts`
      - move `OpenSubtitlesClient` onto both
      - delete `clients/opensubtitles/errors.ts`

      → T001
      *Done when:* `grep -rn "OpenSubtitlesHttpError" services/api/src` is empty and
      `clients/opensubtitles/client.spec.ts` passes unchanged in substance.
- [x] **T006** `[api] [P]` IMDb ids (`api/plan.md` step 7):
      - `TmdbClient.details()` returns `imdbId` (film `imdb_id`; series `external_ids` on the same
        request);
      - `src/imdb-ids/` with `record`/`resolve`;
      - wired into `register()`'s create, `refreshCatalog`, `ShowsService.hydrate` and
        `syncCatalogFromTmdb`;
      - the detached REQ-11 (c) `resolve` in `MoviesService.register()`.

      → T001
      *Done when:* `tmdb/client.spec.ts` shows both mappings and exactly one request for a series.
      `imdb-ids.service.spec.ts` shows a stored "none" never re-fetched and a TMDB failure stamping
      nothing and not throwing. `movies.service.spec.ts` shows the detached call only when the
      top-up read no details, and a rejected `resolve` not failing `register()`.
- [x] **T007** `[api] [P]` Archive and encoding, both pure (`api/plan.md` step 10):
      - `src/subtitle-search/archive.ts` (zip via `fflate`, rar via `node-unrar-js`, in memory,
        NFR-1 caps)
      - `src/subtitle-search/to-utf8.ts`
      - a tiny committed `.rar` fixture

      → T001
      *Done when:* `archive.spec.ts` and `to-utf8.spec.ts` pass. They cover a single srt, an
      `SxxEyy` pick, an ambiguous set, `.sub` only, `../evil.srt`, more than 500 entries, a
      declared size over 20 MB, corrupt bytes and plain-srt passthrough; Windows-1252 `0xE1` →
      `á`; UTF-8 unchanged; a stripped BOM; UTF-16LE. `bin/audit api` passes with the two new
      dependencies. (`bin/audit api` fails on five pre-existing advisories, `@nestjs/apollo`, `@nestjs/graphql`, `fdir`, `picomatch`, `tinyglobby`, whose locked versions are unchanged from HEAD; neither new package is involved. Reported at close.)
- [x] **T008** `[api]` Subdivx client and candidate mapping (`api/plan.md` steps 8–9):
      - `src/clients/subdivx/` (Bearer key, `limit=200`, `Content-Disposition`, status → kind,
        one bounded 429 retry)
      - `src/subtitle-search/subdivx-candidates.ts` (REQ-12 matching, season packs after exact
        matches, `filterAndRank` reused per group)

      → T005
      *Done when:* `subdivx/client.spec.ts` and `subdivx-candidates.spec.ts` pass. They cover
      401/403 → `unauthorized`, 429 → one retry then `rate_limited`, a download 404/502 as a
      candidate failure and the key never in an error message; field match, `SxxEyy` in the
      description, season pack ranked last, another season dropped and film passthrough.
- [x] **T009** `[api]` Driver chain and outcome (`api/plan.md` steps 11–12):
      - per-language provider chain and `providerProgress`, with the 3-attempt budget per
        provider;
      - provider-scoped flags and `no_provider`;
      - Subdivx dispatch (IMDb, then title/`query` fallback);
      - archive and UTF-8 before `staging.write`;
      - provenance;
      - `deriveLanguages` last-provider rule;
      - `SubtitleSearchLanguage.provider`.

      → T003, T006, T007, T008
      *Done when:* `subtitle-search.driver.spec.ts` passes with fault-injected cases. Dropping the
      `providerProgress` write makes the "no re-search on wake" case fail. The other cases:
      - three rejected Subdivx attempts → OpenSubtitles;
      - zero Subdivx candidates → OpenSubtitles;
      - Subdivx unauthorized → fallback with the search not FAILED;
      - an OpenSubtitles quota leaves an `es-419` language on Subdivx searchable;
      - an empty chain → `no_provider` with no client call;
      - English never calls Subdivx;
      - an archive rejection → the next candidate;
      - provenance `subdivx:` prefix.

      `derive-languages.spec.ts` covers the last-provider rule and `provider` only on
      `RESOLVED`/`REPLACED`. `schema.gql` shows `SubtitleSearchLanguage.provider`.
- [x] **T010** `[api]` Close the slice: regenerate `schema.gql` and compare it with the spec's
      delta; typecheck; full suite; gates. → T004, T009
      *Done when:*
      - `bin/cli api npx --no tsc --noEmit` → 0 errors;
      - `bin/npm api test` → all pass;
      - `bin/comments api` → PASS;
      - `bin/audit api` → PASS;
      - `git status --short services/api/prisma` → `schema.prisma` plus one migration;
      - the `schema.gql` diff equals `spec.md` § GraphQL Contract Delta.

### Group 3 — consumers (`web`)

T011 and T012 can start once T003/T004 have produced the schema; they do not wait for Group 2.

- [x] **T011** `[web] [P]` Settings → Subtítulos (`web/plan.md` steps 1–5 and the tab half of
      step 6):
      - `types/subtitle-providers.ts`
      - `actions/subtitle-providers.ts`
      - `components/subtitle-providers/` (panel, row, add/edit modal, remove modal, languages
        editor)
      - the `subtitles` tab rendered as a sibling of the form
      - `getSubtitleProviders()` and `getLanguages()` in `settings/page.tsx`'s `Promise.all`
      - `subtitleProviders.*` and `errors.subtitleProvider.*` catalog entries

      → T003, T004
      *Done when:* `bin/cli web npx --no tsc --noEmit` → 0 errors and `check-messages.mjs` passes.
      (Static gates verified; the browser walk runs in T017.) In the browser, Settings → Subtítulos adds Subdivx, edits it with a blank key (still
      `secretSet`), refuses `en → Subdivx` inline with the modal and edits kept, and removes a
      provider together with its languages.
- [x] **T012** `[web] [P]` General tab and copy (`web/plan.md` step 6's General half and step 8):
      - remove the OpenSubtitles block from `GeneralPanel` and its props from `SettingsForm`;
      - delete `CLEARABLE_KEYS` from `actions/settings.ts`;
      - add `errors.subtitleSearch.no_provider`/`archive_unusable`;
      - reword the provider-wide keys and point `provider_not_configured` and
        `subtitleSearchRequiresProvider` at "Ajustes → Subtítulos".

      → T004
      *Done when:* saving Settings → General succeeds against the new `api` (no
      `not_editable`), and `grep -n "OpenSubtitles" services/web/messages/es.json` shows only the
      provider name entries and the moved help copy.
- [x] **T013** `[web]` Provider on a resolved language (`web/plan.md` step 7): select `provider` in
      every `latestSubtitleSearch { languages { … } }` of `actions/movies.ts`/`actions/shows.ts`,
      type it in `types/media.ts`, render it in `SubtitleSearchStatus.tsx`. → T009
      *Done when:* a film whose search resolved a language shows "Subdivx" or "OpenSubtitles"
      beside it, and a `NOT_FOUND`/`FAILED` language shows no provider.
- [x] **T014** `[web]` Close the slice: typecheck, catalog parity, Biome on the touched files,
      comments gate. → T011, T012, T013
      *Done when:* the four commands in `web/plan.md` § Done when are clean.

### Group 4 — documentation and verification

- [x] **T015** `[docs]` `docs/spec/graphql-contract.md`: a `121-subtitle-providers` section with the
      delta, the error table, the `updateSettings` refusal, the widened `subtitleSearchAvailable`,
      and a note that `107`'s "travel through `settings`/`updateSettings`" no longer holds.
      → T010
- [x] **T016** `[docs]` `CLAUDE.md` files. → T010, T014
      - Root pipeline table, "Notify media server" row: providers, chain and fallback, Subdivx
        via SubX API.
      - Root "Register title" row: IMDb ids (REQ-11).
      - `services/api/CLAUDE.md`: module map entries for `subtitle-providers/`, `imdb-ids/` and
        `clients/subdivx/`; the `subtitle-search/` paragraph (chain, `providerProgress`, archive,
        UTF-8); `settings/` (keys moved out of the catalog, secrets hidden).
      - `services/web/CLAUDE.md`: the Subtitles tab section, the General tab no longer holding
        OpenSubtitles, and `103`'s capability wording.
- [x] **T018** `[api]` Amendment 0.2.0, REQ-10: a film retries Subdivx by title (no `:`) and year
      when its IMDb lookup returns no items (`api/plan.md` step 14).
      *Done when:* the two new driver cases pass and fail when the empty-result condition is
      forced true. (Done during the live pass: 64 driver tests green, 2 failing under the fault.)
- [x] **T019** `[api]` Amendment 0.2.0, REQ-18: film-rate rescale (`api/plan.md` step 14 and its
      tests).
      *Done when:* `film-rate.spec.ts` passes; the extended `acceptance.spec.ts` and
      `subtitle-search.service.spec.ts` cases pass and fail when `filmRateRatio` is forced to
      `null` and when the rescale is skipped; `bin/cli api npx --no tsc --noEmit` is 0 errors;
      the full `bin/npm api test` is green; `bin/comments api` passes; `git diff
      services/api/src/schema.gql` is empty.
- [ ] **T017** `[docs]` Live pass: walk AC-1…AC-17 per `plan.md` § Verification on the dev stack
      with a real OpenSubtitles account and a SubX API key. Tick each criterion in `spec.md`; name
      the blocker for any left open. Run `bin/pending-acs`. Set `status: Implemented` on
      `spec.md`, `plan.md`, `api/plan.md` and `web/plan.md`, and `status: Done` here.
      → T015, T016, T019

## Acceptance criteria coverage

| AC | Produced by | Proven in |
| :-- | :-- | :-- |
| AC-1 | T003 (REQ-17), T004, T012 | T017 |
| AC-2 | T003, T004, T011 | T017 |
| AC-3, AC-4, AC-5 | T009 | T017 |
| AC-6, AC-7 | T009 | T017 |
| AC-8 | T003, T011 | T017 |
| AC-9, AC-10 | T007, T009 | T017 |
| AC-11, AC-16 | T008, T009 | T017 |
| AC-12 | T003, T011 | T017 |
| AC-13 | T004 | T017 |
| AC-14, AC-15, AC-17 | T006 | T017 |
| AC-18, AC-19 | T019 | T017 |
| AC-20 | T018 | T017 |

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

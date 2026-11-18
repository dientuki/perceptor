---
title: Subtitle Providers — Implementation Plan
spec_version: 0.1.3
last_updated: 2026-11-17
status: Approved
---

# PLAN: Subtitle Providers (`plan.md`)

## Approach

The search driver (`services/api/src/subtitle-search/subtitle-search.driver.ts`) already does
everything after "a candidate list exists for a language": attempts, one-at-a-time fetch into
`staging.ts`, the worker's sync, `acceptance.ts`, the 3-attempt budget, the embed. This feature
changes two things in it. Candidates now come from **a provider chosen per language**, and a
language moves to the **next provider of its chain** when the current one ends with nothing
accepted. Nothing downstream of staging changes, which is why `worker` is not in `services:`.

Five pieces in `api`, one in `web`:

1. **`subtitle-providers/` (new module).** It is the one owner of "which providers exist, which are
   configured, which is default, where a language goes".
   - A static registry of the two kinds lists, per kind, its Settings keys, its "configured"
     predicate and which languages it serves. `OPENSUBTITLES` serves all of them. `SUBDIVX`
     serves the `Language` rows with `iso3 = spa`, data-driven like `110`'s
     `regionalVariantIso3s()`, never a hardcoded tag list.
   - A service exposes the four GraphQL operations plus `chainFor(iso3, variantTag)` for the
     driver.
   - Storage is plain `Setting` rows (spec § Data Model), written through `prisma.setting`
     directly the way `MediaServerIndexService` writes its non-catalog rows. They never go through
     `SettingsService.updateMany`, which refuses them because they leave `SETTINGS_CATALOG`.
   - `MediaCapabilitiesService.read()` computes `subtitleSearchAvailable` by calling the registry's
     `configured` predicate over the settings map it already holds. It does not inject the new
     service, which would add a module edge for one boolean.
2. **A provider-neutral seam for the driver.** One error class,
   `SubtitleProviderHttpError(provider, kind)`, replaces `OpenSubtitlesHttpError`; the kinds
   (`unauthorized`, `quota`, `rate_limited`, `unavailable`) are unchanged. One candidate shape is
   kept: `candidates.ts`'s `SubtitleCandidate`. Subdivx rows map onto it with
   `hashMatch`/`hearingImpaired`/flags all `false` and `fileCount: 1`, so `filterAndRank` is
   **reused unchanged** for REQ-12's ordering. The existing `OpenSubtitlesClient` keeps its
   `search`/`download` methods. A new `clients/subdivx/` client is its sibling. The driver picks
   the client by `kind`; there is no plugin framework.
3. **Chain progress in the driver.**
   - Attempts gain `provider`. A new nullable JSON `SubtitleSearch.providerProgress`
     (`{ [iso3]: { [kind]: <marker> } }`) records, per language, each provider that is *done*:
     `exhausted` (no accepted attempt left), `empty` (zero candidates) or a provider-wide error key.
   - The current provider of a language is the first entry of `chainFor(...)` with no marker.
     `attemptsOf(search, language)` becomes "this language's attempts **of the current
     provider**", so the 3-attempt budget is per provider for free (REQ-8). When the current
     provider gets a marker, the same `advance` call continues with the next one.
   - `languageErrors` keeps its meaning: the language's *final* key. It is written only when the
     chain runs out on an error, or immediately as `no_provider` for an empty chain (REQ-9).
   - `flagLanguages` becomes provider-scoped. An OpenSubtitles quota or unauthorized marks
     OpenSubtitles done for every unresolved language currently on OpenSubtitles. It never fails a
     language that still has another provider.
4. **Staging gains two pure steps, for every provider.** `subtitle-search/archive.ts` detects
   zip/rar by magic bytes and picks REQ-13's single `.srt` **in memory**. Nothing is extracted to
   disk, so path traversal and links are impossible by construction, and NFR-1's caps are checked
   against entry headers and actual bytes. `subtitle-search/to-utf8.ts` normalizes encoding (BOM
   handling reused from `subtitle-embed/sidecar-text.ts`'s `decodeSidecar`, imported as a file,
   then strict UTF-8, else `windows-1252`). Running both on OpenSubtitles bytes too is a no-op for
   a UTF-8 `.srt` and keeps one staging path.
5. **IMDb ids (REQ-11).** `TmdbClient.details()` returns `imdbId` for both types. For a film it is
   read from the body's `imdb_id`. For a series the same request gains
   `append_to_response=external_ids`. A small `imdb-ids/` module (Prisma + `TmdbClient`) offers
   `record(type, id, imdbId)` and `resolve(type, id)`. `record` is called by every path that
   already reads details and holds a row id. `resolve` is the single fetch-if-never-answered. Two
   callers use it: `MoviesService.register()`, detached after the row is created when the top-up
   read no details (REQ-11 c, the `void this.cacheMovies(...)` / `ShowsService.hydrate` detached
   idiom), and the Subdivx path (REQ-11 b). A series needs no (c) call, since its detached
   hydration already reads details.
6. **`web`:** a "Subtítulos" tab in Settings, rendered as a sibling of the main `<form>` like
   `EnvironmentPanel`, since it saves through its own three mutations. The OpenSubtitles fields
   are removed from General. A resolved language shows its provider.

**Alternatives rejected:**
- *A `SubtitleProvider` Prisma model.* Two fixed kinds and three scalar rows do not justify a
  table, and REQ-17 then needs no data migration.
- *Extracting archives to disk with a native `unrar`/`bsdtar`.* NFR-1's traversal and link guards
  would have to be written and tested, and NFR-2 would pull `infra` in. In-memory extraction with
  pure JS/WASM libraries (`fflate` for zip, `node-unrar-js` for rar; `bin/audit api` must stay
  green) avoids both.
- *Snapshotting the chain on the search row like `wantedVariants`.* It is recomputed on every
  `advance` from current Settings instead. A provider removed mid-search is then simply skipped,
  and nothing has to reconcile a stale snapshot.

**Decisions the spec did not cover** (also in the closing report):
- **REQ-5 with no stored default.** `subtitle_provider_default` = `""` derives as the first
  configured kind in enum order (`OPENSUBTITLES` before `SUBDIVX`). When `saveSubtitleProvider`
  configures a second provider while the stored default is `""`, it persists the derived default
  first, so adding Subdivx can never flip which provider is default.
- **`opensubtitles_username`.** Only the two secrets are hidden from the `settings` query (NFR-4).
  The username is still returned there but can no longer be written through `updateSettings`.
- **Last provider for `deriveLanguages`.** A language's outcome is derived from the attempts of the
  last provider in `providerProgress` insertion order (REQ-8 "keeps the outcome of the last
  provider"). An `ACCEPTED` attempt of any provider still wins.
- **Archive entries.** Directory entries, `__MACOSX/` and dot-files are ignored before counting
  `.srt` files. The `SxxEyy` match is case-insensitive over the entry's base name.
- **Provenance file name.** For Subdivx, `providerFileName` is the chosen archive entry's base
  name, else the `Content-Disposition` file name, else `subdivx:<id>`.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration, the four operations, `SubtitleSearchLanguage.provider` and the refusal of the old keys in `updateSettings`. |
| 2 | `web` | Consumes all of it, and must stop sending `opensubtitles_*` through `updateSettings` in the same release. |

Inside `api` the steps are mostly sequential (the driver change needs the module and the client).
`web` can start once step 1's `schema.gql` regenerates, in parallel with `api`'s driver and
archive work, because those add no contract surface.

**Release coupling.** A `web` from before this feature, against this `api`, fails **every**
General-tab save loudly with `error.setting.not_editable`, because its `CLEARABLE_KEYS` always sends
`opensubtitles_*`. They ship together. `PERCEPTOR_TAG` is one tag for all images, so a normal
install cannot mix them.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Things an
implementer will be tempted to change and must not:

- **`subtitleProviders` returns every kind, configured or not.** `web` decides what "Add provider"
  offers from `configured: false`. Do not filter server-side.
- **`secretSet`, never the secret.** Not masked, not truncated, not a hash.
- **`setSubtitleProviderLanguages` replaces default and languages together.** There is no per-language
  add/remove mutation. `web` sends the full set every time.
- **`SubtitleSearchLanguage.provider` is null unless the outcome is `RESOLVED`/`REPLACED`.** Not
  "the provider currently being tried". There is no in-flight provider on the wire.
- **`subtitleSearchAvailable` keeps its name.** Its meaning widens (REQ-16). `web`'s consumers of it
  do not change.
- **`languageTags: null` means "every language".** It is not an empty list.
- **Outcome keys `no_provider` and `archive_unusable` are `reasonKey`s, never thrown.**

If the contract has to change mid-flight: stop, amend `spec.md`, re-approve, re-brief `api` and
`web` (Constitution, Article VIII).

## Migrations

1. `<ts>_subtitle_providers` (one migration, generated by `bin/npm api run prisma:migrate`):
   - `enum SubtitleProviderKind { OPENSUBTITLES SUBDIVX }`
   - `SubtitleSearchAttempt.provider SubtitleProviderKind @default(OPENSUBTITLES)`, non-null
   - `SubtitleSearch.providerProgress Json?`
   - `Movie.imdbId String? @db.VarChar(20)`, `Movie.imdbIdCheckedAt DateTime?`, and the same two
     on `Show`
2. Seed (production seed, create-only like every other row): `subdivx_api_key` = `""`,
   `subtitle_provider_default` = `""`, `subtitle_provider_languages` = `"[]"`.
3. Backfill: none.
   - Every existing attempt row is OpenSubtitles, which the column default states.
   - A `NULL` `providerProgress` on an in-flight search reads as "no provider done yet". With the
     REQ-17 default being OpenSubtitles, its existing attempts are exactly the current provider's,
     so a search caught mid-flight by the upgrade continues as before.
   - `imdbId` is filled lazily.

Reversibility: dropping the columns and the enum restores the old schema. Attempts lose only their
provider label. A rolled-back `api` reads the three new Setting rows as unknown and ignores them.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Chain progress not persisted, or persisted under the wrong language | Silent loop: the same provider is searched again on every wake, burning OpenSubtitles' ~20 daily downloads, or the fallback never happens and the language reads `NOT_FOUND` with Subdivx never asked | Fault-injected driver specs: drop the `providerProgress` write and the "falls back after three rejected" case must fail. AC-4 live. |
| Provider-wide flag not scoped to its provider | An OpenSubtitles quota marks an `es-419` language FAILED although Subdivx was next, with no error anywhere | Driver spec: OpenSubtitles quota with one language on Subdivx leaves that language searchable. |
| Old "every unresolved language shares a provider-wide key → fail the search" rule firing on an intermediate marker | The whole search ends FAILED although a fallback was still pending | The rule reads only `languageErrors` (final keys), never `providerProgress`. Covered by AC-6. |
| `deriveLanguages` reading attempts across providers | A language rejected on Subdivx and `NOT_FOUND` on OpenSubtitles reads `REJECTED`. That is not wrong data, but it is not REQ-8 | `derive-languages.spec.ts` case for exactly that. |
| Secrets in the `settings` query | `opensubtitles_password` is returned to `web` today; NFR-4 makes that a leak | Resolver-level filter plus a spec asserting both keys absent (AC-2). |
| Encoding misdetection | A Windows-1252 file that happens to be valid UTF-8 is left as is (only possible with no byte ≥ 0x80, i.e. plain ASCII, which is identical in both). A genuinely UTF-8 file is never re-decoded | `to-utf8.spec.ts` with a real 1252 sample, a UTF-8 sample with accents and a UTF-16 BOM sample. AC-9 live. |
| Archive bomb or traversal | Memory blow-up in `api`, or a write outside staging | In-memory only, so no write path exists. Caps checked from headers **and** while inflating. `archive.spec.ts` covers an oversize entry, 501 entries, a `../x.srt` entry name and nested dirs. |
| Lazy IMDb fetch failing or TMDB having none | Episode lookup by `query` only, more misses | `imdbIdCheckedAt` stores "TMDB has none" and is not stamped on a TMDB failure, so a failure retries next time while a definite "none" does not. |
| Settings languages JSON hand-edited to garbage | Chain computation throws and every search fails | `chainFor` parses defensively: an unparseable value reads as "no languages" and logs a warning. |
| Film-rate rescale applied in the wrong direction or to the rounded ratio (REQ-18) | The embedded track drifts by up to ~7 s over two hours, worse than leaving it out, with no error anywhere | Exact ratios from `ffsubsync`'s own constant, never the three-decimal report; a spec pinning one known time; AC-18 checked live against the file's own subtitle. |
| Film-rate relaxation leaking into `113`'s hand embed | A hand embed with automatic offset accepts a 24 fps sidecar and embeds it unscaled | The relaxation is an explicit option only `completed()` passes; `113`'s caller is unchanged. |
| Older `web` against new `api` | Every General save refused | Release coupling above. Both slices ship in one release. |

## Verification

```bash
bin/npm api run prisma:migrate
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli web npx --no tsc --noEmit
bin/cli web node scripts/check-messages.mjs
bin/comments api
bin/comments web
bin/audit api
bin/pending-acs --check
```

`git diff services/api/src/schema.gql` must match `spec.md` § GraphQL Contract Delta exactly.

Manual pass (the dev stack, an OpenSubtitles account and a SubX API key):

1. **AC-1, AC-13:** on a database whose OpenSubtitles fields were already set, open Settings.
   Subtítulos shows OpenSubtitles configured and default, General has no OpenSubtitles fields.
   `updateSettings` with `opensubtitles_password` from the GraphQL playground is refused.
2. **AC-2:** add Subdivx with the key, then reload. `settings` and `subtitleProviders` in the
   playground show no key. `bin/cli api` logs are free of it.
3a. **AC-18, AC-19, AC-20 (amendment 0.2.0):** *Night Cries* (2015, movie 45) for the 23.976 ↔ 24
   rescale; *Jurassic World Dominion* (movie 44) for the title-and-year retry and the
   still-rejected 1.043 candidates.
3. **AC-8:** set the language entry `es-419 → Subdivx`. Then try `en → SUBDIVX` and see it refused.
4. **AC-3, AC-4, AC-5:** with a user wanting `es-419` and `en`, press "Buscar subtítulos" on a
   film. `bin/mysql -e 'select languageIso3, provider, status, reasonKey from
   subtitle_search_attempts where searchId = …'` shows the Subdivx attempts, the fallback if
   needed, and English on OpenSubtitles only. Check the embedded `PERCEPTOR_SOURCE` with
   `mkvinfo` or `ffprobe`.
5. **AC-9, AC-10:** find a Subdivx candidate delivered as `.rar` and run `file -i` on its staged
   path under `<downloads>/.perceptor/subtitle-search/<id>/`.
6. **AC-11, AC-16:** run an episode search on a series with an IMDb id, then on one without.
7. **AC-6, AC-7, AC-12:** set a wrong key, then remove OpenSubtitles, then remove Subdivx.
8. **AC-14, AC-15, AC-17:** check `imdbId`/`imdbIdCheckedAt` after a lazy lookup, a Refresh, a new
   series registration and a film added from a warm search cache. Read the `api` log for TMDB
   request counts. Add a film with TMDB blocked (wrong `movie_db_host`) to see the add succeed
   and the column stay `NULL`.

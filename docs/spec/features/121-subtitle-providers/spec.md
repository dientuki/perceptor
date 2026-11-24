---
title: Subtitle Providers
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-11-17
last_updated: 2026-11-17
status: Approved
services: [api, web]
---

# SPEC: Subtitle Providers (`spec.md`)

## Context & Goal

The subtitle search (specs `103`, `106`, `107`, `118`, `119`) has exactly one provider,
OpenSubtitles.com, wired directly into the driver (`services/api/src/subtitle-search/subtitle-search.driver.ts`
→ `services/api/src/clients/opensubtitles/`). Its account is two loose Settings rows,
`opensubtitles_username`/`opensubtitles_password`, edited from Settings → General
(`services/web/src/components/settings/GeneralPanel.tsx`). For Rioplatense and Latin American
Spanish OpenSubtitles is thin. Subdivx is the reference catalog for that audience. It is reachable
through SubX API (`https://subx-api.duckdns.org`, docs at
`https://subx-api.duckdns.org/docs/getting-started/quickstart/`), an unofficial wrapper that takes a
personal API key, searches by IMDb id or title, and returns only Spanish subtitles, often packed in
`.zip` or `.rar`.

This feature turns the provider into a choice. Settings gains a "Subtitles" tab where an
administrator adds or removes providers, each with its own credentials (OpenSubtitles: username and
password; Subdivx: API key). One configured provider is the **default**, and a language or a
regional variant can be **assigned** to another provider. Example: OpenSubtitles as the default and
`es-419` assigned to Subdivx. A search for Latin American Spanish then asks Subdivx first and falls
back to OpenSubtitles when Subdivx yields nothing usable, while English goes straight to
OpenSubtitles. The fallback runs only when both providers are configured.

Everything downstream of "a candidate `.srt` is staged in the downloads root" stays as it is: the
worker's sync measurement and variant check, `acceptance.ts`, the three-attempt cap per language, the
embed remux, `114`'s current-file view and `119`'s replace. Stages touched: **Notify media server**
(the `103` search: where candidates come from) and **Browse library** (Settings → Subtitles, plus the
provider shown on a resolved language). The pipeline table's "Notify media server" row changes
wording, not status.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Provider kinds)**: There are exactly two provider kinds, `OPENSUBTITLES` and
      `SUBDIVX`. An installation holds at most one provider of each kind. Each kind declares the
      languages it can serve: `OPENSUBTITLES` serves every language; `SUBDIVX` serves Spanish only
      (`spa`, including the `es`, `es-419` and `es-ES` tags).
- [ ] **REQ-2 (Configured)**: A provider is *configured* when its credentials are complete:
      `OPENSUBTITLES` needs the existing application key (`107`, unchanged, never a Setting) plus a
      non-empty username and password. `SUBDIVX` needs a non-empty API key.
- [ ] **REQ-3 (Settings tab)**: Settings gains a "Subtitles" tab (Spanish copy "Subtítulos"),
      admin-only like the rest of Settings, listing the configured providers. "Add provider" offers
      only the kinds not yet configured and asks for that kind's fields. Each listed provider can be
      edited or removed. Removing one asks for confirmation first. The OpenSubtitles username and
      password fields leave Settings → General. This tab is now their only editor.
- [ ] **REQ-4 (Secrets never read back)**: The OpenSubtitles password and the Subdivx API key are
      write-only through this tab's surface. The query reports only whether each is set. Editing a
      provider with the secret left blank keeps the stored secret.
- [ ] **REQ-5 (Default)**: While at least one provider is configured, exactly one configured provider
      is the default. With a single configured provider, that provider is the default. With two, the
      administrator chooses. Removing the default leaves the remaining provider (if any) as the
      default.
- [ ] **REQ-6 (Languages)**: The administrator can assign a language tag from the `Language` table (a
      base tag such as `es` or a regional variant such as `es-419`) to a configured provider. A
      language entry is refused when its provider is not configured, does not serve that language (REQ-1),
      or is the default (redundant). One language entry per tag. Removing a provider removes every language entry
      that points at it.
- [ ] **REQ-7 (Provider chain)**: For each language a search resolves, the providers are tried in
      this order, skipping any that is not configured or does not serve the language, and never
      repeating one:
      1. the language entry for the wanted variant tag (`SubtitleSearch.wantedVariants`, spec `118`), if any;
      2. otherwise, the language entry for the language's base tag, if any;
      3. the default provider.

      With OpenSubtitles as the default and `es-419 → Subdivx`: a Latin American Spanish search tries
      Subdivx, then OpenSubtitles. An English search tries only OpenSubtitles. If only Subdivx is
      configured, an English search has an empty chain.
- [ ] **REQ-8 (Fallback)**: The search moves to the next provider in the chain when the current
      provider produces no `ACCEPTED` attempt for that language. That covers: zero candidates; every
      candidate rejected (sync, coverage, score, wrong variant, archive); or a provider-level failure
      (unauthorized, rate limit, unavailable, quota). Each provider gets its own budget of
      `MAX_CANDIDATES_PER_LANGUAGE` (3) attempts. A language whose last provider still has no
      accepted attempt keeps the outcome and reason of that last provider.
- [ ] **REQ-9 (Empty chain)**: A language with an empty chain reads `FAILED` with
      `error.subtitleSearch.no_provider`. No provider is called for it.
- [ ] **REQ-10 (Subdivx lookup)**: Each lookup is one search request, at the maximum `limit` (200).
      Both shapes below were validated against Subdivx by hand (0.1.2).
      - **Film:** looked up by its IMDb id. When the film has no IMDb id, or that lookup returns
        no items, the lookup is by `title` plus `year` instead (once), with every `:` removed from
        the title (0.2.0: SubX files some films under no IMDb id or a wrong one).
      - **Episode:** looked up by its series' IMDb id with no season or episode filter. The target
        episode is then picked out of the response (REQ-12). When the series has no IMDb id, or
        that response holds no match for the target, the lookup falls back once to the free-text
        `query` `"<Series title> SxxEyy"` (two-digit season and episode), with its results filtered
        the same way.
- [ ] **REQ-11 (IMDb id)**: A film's or series' IMDb id is stored on the title, together with when
      TMDB last answered about it. "TMDB has none" is stored as an answer too. It is captured in
      three ways. A TMDB request made only for it happens in cases (b) and (c), at most once per
      title:
      - **(a) Piggyback.** Whenever `api` already reads a title's TMDB details, it stores the IMDb
        id from that same response and overwrites any previous value (TMDB may add one later).
        For a film the details response already carries `imdb_id`. For a series the request that
        already reads the series' details gains TMDB's `external_ids` in the same call. The paths
        that already read details are registration's catalog top-up (`056`/`057`), the
        detail-page Refresh (`069`), the `refresh_movies`/`refresh_shows` sweeps (`074`/`075`) and
        series hydration.
      - **(c) On registration, in the background.** When registering a new title did not already
        capture it through (a) (a film whose cached catalog entry needed no details top-up),
        registration starts one detached details read for it. The read never delays or fails
        `addMedia`, and its result is stored like (a). A series always has it from (a), because its
        hydration already reads the details.
      - **(b) Lazy.** A Subdivx lookup on a title TMDB has never answered about (a title registered
        before this feature, or one whose (c) failed) fetches it once, then stores it like (a).

      A title TMDB has already answered about is never fetched by (b) or (c) again. The search
      cache in Redis does not carry the IMDb id: TMDB's search endpoints do not return it, and
      fetching it per result would cost one request per result.
- [ ] **REQ-12 (Subdivx ranking)**: Subdivx candidates are ranked by similarity between their
      description (Subdivx's release text) and the delivered release name, the same Jaccard measure
      `candidates.ts` uses, then by download count. For an episode, a candidate matches the target
      when its `season` and `episode` fields equal the target's, or, when those fields are null,
      when its title or description carries the target's `SxxEyy`. A candidate for the right
      season with no episode (a season pack) also matches, ranked after every exact match: REQ-13
      picks the episode out of its archive. Every other candidate is dropped. At most three are
      kept.
- [ ] **REQ-13 (Subdivx download)**: Subdivx returns `.srt`, `.zip` or `.rar`. An archive is
      extracted inside the search's staging folder. If it holds exactly one `.srt`, that file is
      the candidate. If it holds several, the candidate is the one whose name carries the target's
      `SxxEyy` (an episode), and only if exactly one does. Anything else (no `.srt`, an
      ambiguous set, another format, a corrupt archive) rejects that candidate with
      `error.subtitleSearch.archive_unusable`. The search then tries the next candidate.
- [ ] **REQ-14 (Encoding)**: A staged `.srt` that is not UTF-8 (Subdivx files are often Windows-1252
      or ISO-8859-1) is re-encoded to UTF-8 at staging. The worker and the embed receive UTF-8 only.
- [ ] **REQ-15 (Provenance)**: Every attempt records which provider it came from. The embedded
      track's provenance tag (`107` amendment 0.4.0) names it: `subdivx:<file name or id>` for
      Subdivx and unchanged for OpenSubtitles. A resolved language reports its provider.
- [ ] **REQ-16 (Capability)**: `MediaCapabilities.subtitleSearchAvailable` is true while at least
      one provider is configured, in place of "OpenSubtitles is configured". `103`'s preference,
      `106`'s button and `119`'s dialog read it unchanged.
- [ ] **REQ-17 (Existing installations)**: An installation whose OpenSubtitles username and password
      are already set reads, after upgrading, as OpenSubtitles configured and default, with no
      languages. No administrator action is required, and its searches behave exactly as before this
      feature.

- [ ] **REQ-18 (Film-rate rescale)**: A candidate from any provider whose measured framerate ratio
      is the 23.976 ↔ 24 fps conversion (`ffsubsync` reports `1.001` or `0.999`, from its fixed set
      `24/23.976` and its inverse) is no longer rejected for its framerate. Its cue times are
      multiplied by that exact ratio (`24/23.976` or `23.976/24`, never the rounded report) in the
      staged `.srt` before it is embedded, and the measured offset is applied after the scaling,
      the order `ffsubsync` measures them in. Coverage (`103` REQ-10) is judged on the scaled last
      cue. Every other check, the offset bound and the score thresholds are unchanged. Any other
      ratio, including the PAL conversions (`25/23.976`, `25/24` and their inverses), is still
      `framerate_mismatch`. The attempt keeps the measured ratio. `113`'s automatic offset for a
      hand embed is unchanged and still rejects any ratio other than 1.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Archive safety)**: Extraction never writes outside the search's staging folder
      (absolute paths, `..` entries and links are refused), caps total extracted size at 20 MB and
      the entry count at 500, and removes everything it extracted when the search's staging is
      swept (`staging.ts`). An archive that breaks a cap is rejected like REQ-13's failures.
- [ ] **NFR-2 (No host tool)**: `.rar` support must work in the published `api` image on both
      `linux/amd64` and `linux/arm64` (`083`). If the plan picks a native extractor, it is part of
      the image, and `infra` joins `services:` at plan time.
- [ ] **NFR-3 (Call budget)**: Subdivx is called only for a language whose chain reaches it. A
      search costs at most two search requests per such language (REQ-10's fallback) and one
      download per attempt. A `429` is waited out once when `Retry-After` is at most 10 s, the
      same bound the OpenSubtitles client uses. Otherwise it is a provider-level failure (REQ-8).
- [ ] **NFR-4 (Secrets)**: Neither secret is logged, returned by any query (including `settings`),
      or sent anywhere but its own provider.
- [ ] **NFR-5 (Article XII)**: Nothing changes about what is written under the destinations root.
      Staging and extraction live in the downloads root only.

## GraphQL Contract Delta

```graphql
enum SubtitleProviderKind {
  OPENSUBTITLES
  SUBDIVX
}

type SubtitleProvider {
  kind: SubtitleProviderKind!
  """True when this provider's credentials are complete (121 REQ-2)."""
  configured: Boolean!
  isDefault: Boolean!
  """OpenSubtitles only; null for SUBDIVX."""
  username: String
  """True when the password (OPENSUBTITLES) or API key (SUBDIVX) is stored. Never the value."""
  secretSet: Boolean!
  """ISO 639 tags this kind can serve; null means every language."""
  languageTags: [String!]
}

type SubtitleProviderLanguage {
  languageTag: String!
  provider: SubtitleProviderKind!
}

type SubtitleProviderSettings {
  """Every kind, configured or not, in enum order."""
  providers: [SubtitleProvider!]!
  languages: [SubtitleProviderLanguage!]!
}

input SubtitleProviderInput {
  kind: SubtitleProviderKind!
  """OPENSUBTITLES only."""
  username: String
  """Password (OPENSUBTITLES) or API key (SUBDIVX). Null or empty keeps the stored value."""
  secret: String
}

input SubtitleProviderLanguageInput {
  languageTag: String!
  provider: SubtitleProviderKind!
}

extend type Query {
  """Admin only."""
  subtitleProviders: SubtitleProviderSettings!
}

extend type Mutation {
  """Admin only. Adds or edits one provider."""
  saveSubtitleProvider(input: SubtitleProviderInput!): SubtitleProviderSettings!
  """Admin only. Clears the provider's credentials and drops its languages (REQ-5, REQ-6)."""
  removeSubtitleProvider(kind: SubtitleProviderKind!): SubtitleProviderSettings!
  """Admin only. Replaces the default and the whole language entry set at once."""
  setSubtitleProviderLanguages(
    defaultProvider: SubtitleProviderKind!
    languages: [SubtitleProviderLanguageInput!]!
  ): SubtitleProviderSettings!
}

type SubtitleSearchLanguage {
  languageIso3: String!
  outcome: SubtitleSearchLanguageOutcome!
  reasonKey: String
  """Provider of the accepted subtitle when outcome is RESOLVED or REPLACED, else null."""
  provider: SubtitleProviderKind
}
```

`MediaCapabilities.subtitleSearchAvailable` keeps its name and type. Only its description changes,
to REQ-16. `opensubtitles_username`/`opensubtitles_password` stay as Settings rows (REQ-17 needs no
data move), but `updateSettings` refuses them with `error.setting.not_editable` from now on: the
three mutations above are their only write path. A new `subdivx_api_key` row behaves the same way.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| Non-admin calls any of the four operations | `ForbiddenException` (existing `AdminGuard`) | existing `errors.auth.*` copy |
| `saveSubtitleProvider` leaves the provider incomplete (OpenSubtitles without username, or no secret stored or given) | `BadRequestException` `error.subtitleProvider.incomplete` | "Completá todos los datos del proveedor." |
| `saveSubtitleProvider` with `username` for `SUBDIVX` | `BadRequestException` `error.subtitleProvider.field_not_allowed` | "Ese dato no aplica a este proveedor." |
| `saveSubtitleProvider(OPENSUBTITLES)` while Perceptor's OpenSubtitles application key is missing | `BadRequestException` `error.subtitleProvider.app_key_missing` | "Esta instalación no tiene la clave de aplicación de OpenSubtitles." |
| `removeSubtitleProvider` of a kind that is not configured | `NotFoundException` `error.subtitleProvider.not_configured` | "Ese proveedor no está configurado." |
| `setSubtitleProviderLanguages` with a default that is not configured | `BadRequestException` `error.subtitleProvider.not_configured` | "Ese proveedor no está configurado." |
| A language entry whose `languageTag` is not a `Language` tag | `BadRequestException` `error.language.unavailable` (existing) | existing copy |
| A language entry to a provider that does not serve its language | `BadRequestException` `error.subtitleProvider.language_unsupported` (params `provider`, `languageTag`) | "{provider} no tiene subtítulos en {languageTag}." |
| A language entry to the default provider, or to an unconfigured one | `BadRequestException` `error.subtitleProvider.language_invalid` | "Ese idioma no es válido: el proveedor debe estar configurado y no ser el predeterminado." |
| Two languages for the same tag | `BadRequestException` `error.subtitleProvider.language_duplicate` | "Hay dos entradas para el mismo idioma." |
| `updateSettings` touching `opensubtitles_*` or `subdivx_api_key` | `BadRequestException` `error.setting.not_editable` (existing) | existing copy |

New outcome keys (not thrown; they appear as `SubtitleSearchLanguage.reasonKey`, rendered through
`translateErrorKey` like every other `error.subtitleSearch.*` key):

| Key | When | Spanish copy |
| :-- | :-- | :-- |
| `error.subtitleSearch.no_provider` | REQ-9 | "Ningún proveedor configurado tiene subtítulos en este idioma." |
| `error.subtitleSearch.archive_unusable` | REQ-13, NFR-1 | "El archivo descargado no contiene un único subtítulo .srt utilizable." |

The existing `provider_unauthorized`/`provider_unavailable`/`quota_exhausted` keys now apply to
whichever provider failed. `web`'s Spanish copy for them must not name OpenSubtitles.

Consumers: `web` renders every error above inline in the tab's modal or form, keeping it open (the
`112` indexer modal is the reference). After a successful write it re-renders from the returned
`SubtitleProviderSettings` and calls `router.refresh()` so `subtitleSearchAvailable` is re-read.
`worker` consumes none of this. `SubtitleSearchLanguage.provider` is display-only: `web` shows the
provider's name beside a resolved language.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `Setting` rows | new `subdivx_api_key` (secret), `subtitle_provider_default` (enum `OPENSUBTITLES`/`SUBDIVX`, `""` = derive per REQ-5), `subtitle_provider_languages` (JSON list of `{languageTag, provider}`, `"[]"`) | seeded empty | No: REQ-17 holds through the derivation |
| `SubtitleSearchAttempt` | `provider` (`SubtitleProviderKind`) | non-null, default `OPENSUBTITLES` | No: every existing row came from OpenSubtitles, and the default expresses that |
| `Movie`, `Show` | `imdbId String? @db.VarChar(20)` plus `imdbIdCheckedAt DateTime?` (REQ-11: set whenever a TMDB response answered, whatever the answer) | nullable | No: new titles get it at registration (REQ-11 a/c), older ones on the next details read (a) or the first Subdivx lookup (b) |
| `SubtitleSearch` | per-language provider progress, enough to resume the chain after an `api` restart (`103` NFR-4) | nullable | No. The shape is the plan's decision |

## Acceptance Criteria

- [ ] **AC-1**: On an installation with OpenSubtitles credentials set before upgrading, Settings →
      Subtitles lists OpenSubtitles as configured and default, with no languages. Settings → General
      no longer shows OpenSubtitles fields. A manual search for an English subtitle behaves as it
      did before the upgrade.
- [ ] **AC-2**: Adding Subdivx with an API key and saving shows it configured. Reloading the page
      shows `secretSet` true and an empty key field. The key appears in no GraphQL response
      (`settings` included) and in no `bin/cli api` log line.
- [x] **AC-3**: With OpenSubtitles default and `es-419 → Subdivx`, a manual search on a film whose
      user wants `es-419` subtitles records Subdivx attempts first (`bin/mysql -e 'select
      provider, status from subtitle_search_attempts …'`). If one is accepted, the film's panel
      shows the language resolved with provider Subdivx and the embedded track's
      `PERCEPTOR_SOURCE` tag starts with `subdivx:`.
- [x] **AC-4**: Same setup, a film Subdivx has nothing for (or whose Subdivx candidates are all
      rejected): the attempts show up to three Subdivx rows and then OpenSubtitles rows for the same
      language, and the language resolves from OpenSubtitles if one is accepted.
- [ ] **AC-5**: Same setup, an English wanted language: no Subdivx request is made (no
      `subdivx` attempt row, nothing in SubX's `X-RateLimit-Remaining` change), only OpenSubtitles.
- [ ] **AC-6 (failure)**: Subdivx configured with an invalid API key and `es-419` assigned to it: the
      search records Subdivx as `provider_unauthorized` for that language, falls back to
      OpenSubtitles, and finishes. It does not fail the whole search.
- [ ] **AC-7 (failure)**: Only Subdivx configured, a user wanting English and Spanish: English reads
      `FAILED` with "Ningún proveedor configurado tiene subtítulos en este idioma." and Spanish is
      searched on Subdivx.
- [x] **AC-8 (failure)**: `setSubtitleProviderLanguages` with the language entry `en → SUBDIVX` is refused with
      `error.subtitleProvider.language_unsupported`, and the stored languages are unchanged.
- [x] **AC-9**: A Subdivx candidate delivered as a `.rar` holding one `.srt` is staged as that
      `.srt`, in UTF-8 (`file -i` on the staged path reports `utf-8` even when the source was
      Windows-1252), and accented characters render correctly in the embedded track.
- [x] **AC-10 (failure)**: A Subdivx candidate whose archive holds several `.srt` with no unique
      `SxxEyy` match (or a `.sub` only) is rejected with `error.subtitleSearch.archive_unusable` and
      the next candidate is tried. Nothing is written outside the search's staging folder.
- [ ] **AC-11**: An episode search on Subdivx for a series with an IMDb id stages a subtitle for
      exactly that episode: the staged file carries the target `SxxEyy` and its attempt's sync is
      measured against that episode's file. The `api` log shows one Subdivx search request by
      IMDb id and no `query` request.
- [ ] **AC-16**: The same search on a series whose IMDb id is not stored and cannot be found (or
      whose IMDb response holds no row for the target) makes a second request with
      `query="<Series title> SxxEyy"` and stages from its results.
- [ ] **AC-12**: Removing Subdivx while `es-419 → Subdivx` exists drops that language entry. A following
      `es-419` search goes straight to OpenSubtitles. Removing the only configured provider turns
      `subtitleSearchAvailable` false and disables the "Buscar subtítulos" button.
- [ ] **AC-13**: `updateSettings` with `opensubtitles_password` is refused with
      `error.setting.not_editable`.
- [ ] **AC-14**: After a first Subdivx lookup on a film registered before this feature,
      `bin/mysql -e 'select imdbId, imdbIdCheckedAt from movies where id = …'` shows both set. A
      second search makes no TMDB request for it.
- [ ] **AC-15**: Registering a new series, or pressing Refresh on an existing film, leaves `imdbId`
      and `imdbIdCheckedAt` set. The `api` log shows no TMDB request beyond the ones that
      operation already made before this feature (one details request per title, no separate
      external-ids request).
- [ ] **AC-17**: Adding a film from search whose cached entry needed no top-up returns as fast as
      before. Within a few seconds `imdbId` and `imdbIdCheckedAt` are set, after exactly one
      extra TMDB details request in the `api` log. With TMDB unreachable at that moment, the add
      still succeeds, `imdbIdCheckedAt` stays `NULL`, and a later Subdivx lookup fetches it (b).

- [ ] **AC-18**: A film whose file runs at 23.976 fps and whose best candidate was made for
      24 fps (the attempt records `framerateRatio` 0.999 or 1.001): the attempt is `ACCEPTED`, the
      embedded track stays in sync from the first to the last line, and its last cue ends within a
      second of where it ends in the file's own reference subtitle.
- [ ] **AC-19 (failure)**: A candidate whose ratio is a PAL conversion (about 1.043) is still
      `REJECTED` with `error.subtitleSearch.framerate_mismatch`, and its staged file is not
      rewritten.
- [x] **AC-20**: A film whose IMDb lookup on Subdivx returns no items (seen with *Jurassic World
      Dominion*, `tt8041270`) is looked up again by title and year: `subdivx:` attempts exist for
      it.

## Out of Scope

- **More than one provider of the same kind**, and any third kind (Addic7ed, Podnapisi, SubDL…).
  REQ-1's two kinds are what was asked; the model keeps one row per kind and a third kind is a new
  spec.
- **Validating credentials on save.** A wrong key surfaces as `provider_unauthorized` at search
  time, as OpenSubtitles' does today (`107`). A "test connection" button costs a provider call per
  click and was not asked for.
- **Per-user language configuration.** Languages and the default are installation-wide, like the provider accounts.
- **Configuration by anything but language tag** (per title, per media type, per release group).
- **Re-ranking across providers.** The chain is strictly sequential; candidates from two providers
  are never mixed into one list.
- **Subtitle formats other than `.srt`** (`.ass`, `.ssa`, `.sub`) from Subdivx. They are rejected
  as unusable, the same `srt`-only rule `candidates.ts` applies to OpenSubtitles.
- **The bug fix in `120-subtitle-embed-trailing-cues`.** It is independent and unchanged by this
  spec.
- **Showing the IMDb id anywhere in `web`.** It exists only for the Subdivx lookup.
- **Rescaling PAL candidates.** `ffsubsync` also reports the 25 fps conversions, but `103`'s
  measurements found those candidates bad in other ways too (different cut, large offsets), and
  rescaling them is a separate decision with its own measurements.
- **Rescaling in `113`'s hand embed.** It shares `accept()`, but REQ-18's relaxation applies to the
  search only.
- **A bulk IMDb backfill.** REQ-11's piggyback and lazy paths cover every title that will ever
  reach Subdivx. A pass over the whole library would cost one TMDB request per title for ids
  that may never be used.

## Amendments

### 0.2.0 (2026-11-17, during the live pass)

1. **REQ-10: a film retries by title and year when its IMDb lookup returns nothing.** SubX holds
   *Jurassic World Dominion* (14 entries by title and year) under no IMDb id or `tt20234914`, so the
   lookup by its real id `tt8041270` returned zero items and Subdivx was never tried. The retry
   strips `:` from the title. It stays within NFR-3's two search requests.
2. **REQ-18: the 23.976 ↔ 24 fps conversion is rescaled instead of rejected.** The best candidate
   seen for *Night Cries* (2015) measured ratio 0.999, offset −17 s and score 330 270, the highest
   of the pass, and was rejected only for its framerate. `103` REQ-10 rejects any ratio other than 1
   because `101`'s embed applies a constant offset only; `103`'s Out of Scope names framerate
   correction as the missing piece. Rescaling the staged file in `api` supplies it with no contract
   or `worker` change.
3. **Vocabulary:** "route/routing" became "language/language entry" throughout, in the contract
   (`SubtitleProviderSettings.languages`, `SubtitleProviderLanguage`,
   `SubtitleProviderLanguageInput`, `setSubtitleProviderLanguages`), the error keys
   (`language_invalid`, `language_duplicate`) and the stored Setting (`subtitle_provider_languages`,
   renamed by migration `20261117200000_subtitle_provider_languages_key`).


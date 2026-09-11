---
title: Language track titles move to the database
spec_version: 0.2.0
author: Juan "Dientuki" Farias
created_at: 2026-09-10
last_updated: 2026-09-10
status: Implemented
services: [api, worker]
---

# SPEC: Language track titles move to the database (`spec.md`)

## Context & Goal

When the worker transcodes a file (the "Transcode" pipeline stage in the root `CLAUDE.md`), it
writes a human-readable `title=` metadata tag on every muxed audio and subtitle stream — e.g.
`title=Español Stereo (Opus)` — via `trackLanguageTitle()` in
`services/worker/src/ffmpeg/params.ts`. That function reads from a local, hardcoded
`languageTitles: Record<string, string>` table that covers exactly two ISO-639-2 codes (`eng`,
`spa`) out of the 22 rows seeded in `api`'s `Language` table
(`services/api/prisma/seeds/languages.ts`). Every other language — Japanese, Korean, French,
Portuguese, German, Chinese, Russian and thirteen more — falls back to its bare ISO code (`jpn`,
`kor`, `por`, …) as the track title, which is what a user actually sees inside a media player's
audio/subtitle track selector for, say, an anime with Japanese audio.

The obvious fix — adding rows to that literal — is the wrong one, and adding them is what surfaced
this spec. The title of a language is installation data, not worker code: it belongs beside the
`Language` row it describes, in the database `api` owns (Constitution, Article III), so that a
language added to the seed carries its title with it instead of requiring a matching edit in a
second service that has no way to know it fell out of sync.

This feature adds the title to the `Language` model, exposes it over a dedicated GraphQL query
already collapsed into the shape the worker consumes, backfills all 20 base rows with a
native-script endonym, and deletes the worker's hardcoded table — while leaving
`detectVariant`/`variantTitle`'s regional-variant override and the ISO-code fallback exactly as they
behave today.

Two shape decisions are load-bearing and are the reason this is not simply "add a column and read
it":

- **The worker looks up by `iso3`, the table is keyed by `tag`, and the mapping is many-to-one.**
  `es`, `es-419` and `es-ES` all carry `iso3: 'spa'`. Deciding which of the three is "the Spanish
  title" is exactly the kind of knowledge this feature is trying to move *out* of the worker, so
  `api` collapses it and publishes a flat `iso3 → title` list. That also sidesteps `languages`'
  deliberate hiding of the bare `es` row (`LanguagesService.findAll()` filters a base row whose
  `tag === iso2` when another row shares that `iso2`, so `languages` never returns `es` at all) —
  which is why this is a new query rather than a field on that one.
- **Regional-variant titles stay in the worker.** `variants.ts`'s `LANGUAGE_VARIANTS` already owns
  `es-419 → 'Latino'` and `es-ES → 'Español (España)'`, coupled to the release-name markers that
  detect them. Those two tags therefore contribute nothing to the flat map, and the `Language` rows
  for them carry no title.

## Requirements

### Functional Requirements

- [x] **REQ-1 (New column)**: `Language` must gain a field holding the native-script display title
      written into the muxed track's `title=` metadata tag, distinct from the existing `name` field
      (the internal English label `language-names.ts` derives — untouched by this feature).
- [x] **REQ-2 (Backfill of the base rows)**: Every **base** row seeded by
      `services/api/prisma/seeds/languages.ts` — all 22 except the two regional variants `es-419`
      and `es-ES`, which per REQ-6 carry no title — must receive this value, in the endonym style
      the existing `spa: 'Español'` set:

      | `tag` | `iso3` | value | | `tag` | `iso3` | value |
      | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
      | `es` | `spa` | Español | | `nl` | `dut` | Nederlands |
      | `en` | `eng` | English | | `nb` | `nor` | Norsk |
      | `pt` | `por` | Português | | `pl` | `pol` | Polski |
      | `ja` | `jpn` | 日本語 | | `tr` | `tur` | Türkçe |
      | `ko` | `kor` | 한국어 | | `th` | `tha` | ไทย |
      | `fr` | `fre` | Français | | `cs` | `cze` | Čeština |
      | `de` | `ger` | Deutsch | | `it` | `ita` | Italiano |
      | `zh` | `chi` | 中文 | | `ru` | `rus` | Русский |
      | `hi` | `hin` | हिन्दी | | `ar` | `ara` | العربية |
      | `sv` | `swe` | Svenska | | `da` | `dan` | Dansk |

- [x] **REQ-3 (`api` publishes a flat `iso3` map)**: `api` must expose these titles as a list of
      `iso3`/title pairs, already collapsed from `tag` to `iso3`, so that no consumer has to decide
      which of several rows sharing an `iso3` is the authoritative one. Where more than one row
      shares an `iso3`, the base row (`tag === iso2`) is the one that supplies the title; a row with
      no title contributes no entry at all.
- [x] **REQ-4 (Worker reads from `api`)**: The worker must resolve a track's title from this
      api-sourced map instead of its local table, and
      `services/worker/src/ffmpeg/params.ts`'s `languageTitles` literal must be gone once it does.
      The resolution rule at the call site is otherwise unchanged: the same
      `map[normalizeIso3(lang)] ?? lang` it is today, against a map that now arrives from `api`.
- [x] **REQ-5 (Variant override unchanged)**: `detectVariant`/`variantTitle`'s regional-variant
      title must continue to take precedence over the flat per-`iso3` lookup, exactly as it does
      today against the hardcoded table — a track detected as `es-419` still titles `Latino`, never
      the `spa` entry's `Español`.
- [x] **REQ-6 (Variant rows carry no title)**: The `es-419` and `es-ES` rows must **not** be given a
      title value. Their titles live in `variants.ts` (REQ-5), coupled to the markers that detect
      them; a second copy in the database would be unreachable data free to drift from the value
      actually written — `es-ES` in particular is `Español (España)` there, not `Español`.
- [x] **REQ-7 (B/T normalization unchanged)**: The lookup must continue to resolve for a source file
      tagging either the ISO-639-2/B or /T form of a code — a source tagged `fra` still resolves the
      `fre` entry. `api` publishes the /B form it seeds, as it always has; `normalizeIso3` keeps
      being the worker-local translation, not a contract concern.
- [x] **REQ-8 (Fallback unchanged)**: A language with no entry in the map (no row, a row with no
      title, or a code `api` does not know at all) must still fall back to rendering its bare
      ISO-639-2 code as the title, exactly as `languageTitles[lang] ?? lang` does today — never a
      thrown error, never an empty title.
- [x] **REQ-9 (An unreachable `api` does not fail the encode)**: If the worker cannot obtain the map
      for a job, every track falls back to REQ-8's bare ISO code and the encode proceeds. A title is
      cosmetic metadata; failing a multi-hour transcode over it is a worse outcome than a track
      labelled `jpn`.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (Existing-install migration)**: Adding the column is not enough — every row already
      present on an installation upgrading through this feature must end up carrying REQ-2's value.
      Note that `seeds/languages.ts` is find-then-create and **skips** rows that already exist, so a
      re-run of the seed alone does not satisfy this. A fresh install and an upgraded install must
      converge on the identical end state.
- [x] **NFR-2 (No extra query cost per track)**: The worker must not issue one GraphQL round trip
      per audio/subtitle stream. The map is fetched at most once per encode job, alongside the
      single `getEncodeJobDetails` call `encode.job.ts` already makes.
- [x] **NFR-3 (`web` untouched)**: `web`'s `Intl.DisplayNames`-based rendering of language names in
      the UI is a separate display path and must not be modified by this feature.
- [x] **NFR-4 (No new public surface)**: The new query sits behind the same `JwtAuthGuard` every
      other query does — the worker reaches it with the existing `SERVICE_TOKEN`, and no `@Public()`
      is introduced.

## GraphQL Contract Delta

```graphql
type LanguageTrackTitle {
  iso3: String!
  title: String!
}

type Query {
  trackTitles: [LanguageTrackTitle!]!
}
```

`Language` itself is **unchanged** on the GraphQL surface: the new column backs this query, but is
not added to the `Language` type. `languages` stays exactly what it is — the pickable catalog `web`
renders, filtered (`findAll()` hides the bare `es` row), locale-rendered client-side. `trackTitles`
is a different consumer with a different key and a different filter, and the two are deliberately
not merged.

Both fields are non-null: a row without a title contributes no entry (REQ-3), rather than an entry
with a `null` title. "Absent from the list" is the single representation of "no title", so the
worker has one case to handle, and it is the same `?? lang` case it handles today.

| Condition | GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| — | — | This feature introduces no new failure condition. `trackTitles` reads seeded data and cannot fail on user input; a language with no title is an absent list entry, not an error. |

Consumer: the worker's `services/worker/src/api/graphql-client.ts`, called once per encode job the
same way `encode.job.ts` already calls `getEncodeJobDetails`. It turns the list into the
`Record<string, string>` that `trackLanguageTitle` reads, and treats an absent `iso3` exactly as it
treats "not in the table" today. A failed or unreachable call yields an empty map, which by
construction produces REQ-8's fallback for every track (REQ-9) — the worker must not propagate it as
a job failure.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `Language` | add `trackTitle String?` | nullable, no default | **Yes** — the 20 base rows of REQ-2, on a fresh seed and on an existing installation's migration alike (NFR-1). `es-419`/`es-ES` stay `null` on purpose (REQ-6) |

Nullable rather than required: REQ-6 needs two rows to legally carry no value, and REQ-8 needs a
future seed row without a title to be a valid state rather than something that blocks the row from
existing at all.

## Acceptance Criteria

- [x] **AC-1**: The `trackTitles` query returns `{ iso3: "jpn", title: "日本語" }`,
      `{ iso3: "kor", title: "한국어" }` and `{ iso3: "spa", title: "Español" }` among exactly 20
      entries — one per REQ-2 row, none for `es-419`/`es-ES`.
- [x] **AC-2**: Running the migration against a database seeded by a version of this project that
      predates this feature (all 22 `Language` rows present, no `trackTitle`) leaves every one of
      REQ-2's 20 rows carrying its value afterward — verifiable with
      `bin/mysql -e 'select tag, trackTitle from Language order by tag'`.
- [x] **AC-3**: Transcoding a file with a Korean audio track produces a muxed output whose audio
      stream `title` metadata reads `한국어 Stereo (Opus)` (or the 5.1/7.1 variant, per the existing
      channel-count logic in `getAudioParams`) — sourced from `api`, with no `languageTitles`
      literal left anywhere in `services/worker/src`.
- [x] **AC-4**: A source tagged with the ISO-639-2/T code `fra` still produces `Français`, proving
      REQ-7 — the map is keyed by the /B `fre` that `api` seeds.
- [x] **AC-5 (failure path)**: With `api` returning an error or nothing for `trackTitles`, an encode
      of a Japanese-audio file still completes, and the track title is the bare `jpn` — the worker
      does not throw, does not fail the job, does not omit the `-metadata` argument, and does not
      write an empty `title=`.
- [x] **AC-6 (failure path)**: A `Language` row with a `null` `trackTitle` produces no entry in
      `trackTitles`, and a file tagged with that language transcodes to a track titled with its bare
      ISO-639-2 code.
- [x] **AC-7**: A release whose Spanish track is marked Latin American (triggering `detectVariant`)
      still titles that track `Latino`, not `Español` — REQ-5's precedence is unchanged, and the
      `spa` entry does not override it.

## Out of Scope

- **Moving the regional-variant titles to the database.** `es-419 → 'Latino'` and
  `es-ES → 'Español (España)'` stay in `variants.ts` beside the release-name markers that detect
  them (REQ-6). Splitting the marker from the title it produces across two services buys nothing
  here; if variants ever become installation-configurable, that is its own feature.
- **`web`'s language name rendering.** `Intl.DisplayNames` display names in the UI are a separate
  concern (NFR-3), neither read nor written by this feature.
- **Per-user or per-installation customization of track titles.** The value stays one global
  constant per language, exactly as the worker's table was. An admin override from Settings would be
  a follow-up.
- **Retroactively re-tagging already-transcoded files.** This changes what the worker writes on the
  *next* encode; it does not walk the library rewriting metadata on files already in a collection.
- **Adding languages beyond the 22 already seeded.** Scope is titles for the rows that exist today.
  A language added to the seed later without a title is explicitly legal (AC-6) and is a question
  for whoever adds it.

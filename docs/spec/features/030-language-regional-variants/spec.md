---
title: Language Regional Variants
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-08-28
last_updated: 2026-08-28
status: Implemented
services: [api, web]
---

# SPEC: Language Regional Variants (`spec.md`)

## Context & Goal

A release of a film or a series routinely ships two Spanish audio tracks — one dubbed for Latin
America, one for Spain — and the same split again in the subtitles. They are different products for
different audiences, and a user who wants one is actively annoyed by the other. Today Perceptor
cannot express that preference anywhere. Every language the system knows is an ISO-639 row in the
`languages` table (`services/api/prisma/seeds/languages.ts`), keyed by a unique `iso2`, and both
Spanish variants collapse into the single code `es`. The installation-wide `default_languages`
setting, `UserMovieLanguage` and `UserShowLanguage` all store that code, so "Spanish" is the only
thing a user can ask for.

The one place the distinction exists at all is a hard-coded heuristic in the worker:
`LATIN_AMERICAN_MARKERS` in `services/worker/src/ffmpeg/params.ts` reads the *track title* and, for
any `spa` track, silently prefers the Latin American one for both audio and subtitles. That
heuristic exists because the file itself carries no better signal — `ffprobe` reports
`tags.language` as `spa` for both variants, with nothing else to go on. The heuristic is not the
problem this spec solves; the problem is that the user has no way to tell it which variant they
actually want, so it guesses the same way for everyone.

This spec gives the preference a home: a place in the database, a wire representation, and one
component in `web` that presents it — in Settings and on the film/series detail page, the two
screens that already carry a language picker. It deliberately stops there. The worker keeps its
current behaviour unchanged; the preference reaches its job payload as a new additive field it does
not yet read, so that the follow-up spec that teaches the FFmpeg rules to honour it starts with the
data already arriving rather than blocked on `api`. No pipeline stage in the root `CLAUDE.md`
changes status.

Because the variant is invisible in the file's own metadata, a chosen variant is a **preference,
not a filter**: asking for Latin American Spanish means "prefer the Latin American track, and if the
release ships a single undistinguished `spa` track, keep that one". That semantics is what makes a
plain, variant-less "Spanish" option redundant — it would say the same thing a second time — and it
is why the base language name becomes a non-selectable group heading rather than an option.

## Requirements

### Functional Requirements

- [x] **REQ-1 (Variant Rows)**: A language must be identifiable by a BCP-47 tag, so that more than
      one row can share an ISO-639 code. `es-419` (Latin American Spanish) and `es-ES` (European
      Spanish) must exist alongside `es`, all three resolving to the same ISO-639-2/B code `spa`.

- [x] **REQ-2 (Tag Is The Identifier)**: Every stored language preference — the `default_languages`
      setting, `UserMovieLanguage`, `UserShowLanguage` — and every language value crossing the
      GraphQL boundary must be identified by its BCP-47 tag rather than by its ISO-639-1 code.

- [x] **REQ-3 (Base Row Not Offered)**: A language whose row has regional variants must not be
      offered as a choice. `es` must remain in the catalog — it is how a title whose TMDB
      `originalLanguage` is `"es"` resolves to `spa` — but must not appear among the options a user
      can pick.

- [x] **REQ-4 (Grouped Presentation)**: A language with more than one row must be presented as a
      group headed by the base language's name, with its variants as the selectable entries
      underneath. A language with a single row must be presented as a plain entry. The grouping must
      be derived from the catalog, never from a list of languages hard-coded in `web`.

- [x] **REQ-5 (Chosen Set Always Visible)**: The picker must show the currently chosen languages as
      a distinct, always-visible list of removable badges, not only as highlighted entries inside a
      scrolling list. Removing a badge and de-selecting the corresponding entry must be equivalent.

- [x] **REQ-6 (One Component, Both Screens)**: Settings and the film/series detail page must present
      this choice through the same component. The two divergent pickers in use today —
      `services/web/src/components/media/LanguagePicker.tsx` and the `MultiSelect` usage inside
      `services/web/src/components/settings/DownloadPanel.tsx` — must both be served by it.

- [x] **REQ-7 (Names Come From The Locale)**: The name shown for a tag must be resolved for the
      active UI locale, so that `es-419` reads "Español latinoamericano" under `es` and "Latin
      American Spanish" under `en` without either string being added to a message catalog.

- [x] **REQ-8 (Variant Reaches The Job)**: The encode job payload must carry the merged set of
      chosen tags alongside the existing merged ISO-639-2/B list, so that the variant survives the
      collapse to `spa` and a later spec can act on it.

- [x] **REQ-9 (Nothing Preselected)**: A fresh installation must have no language chosen by default,
      in `default_languages` and on every title.

- [x] **REQ-10 (Duplicate And Unknown Rejected)**: Submitting a tag that is not in the catalog, or
      the same tag twice, must be rejected before anything is written, leaving the previously stored
      preference intact.

- [x] **REQ-11 (Error Copy)**: `web` must render `error.language.unavailable` and
      `error.language.duplicate` from its own message catalogs in both locales. Today neither key
      has a catalog entry and both fall through to `api`'s English message; the picker is where a
      user meets them, so this feature is what owes them.

- [x] **REQ-12 (Preference, Not Guarantee)**: A chosen language is a request, never a promise about
      the resulting file. What tracks an encode actually keeps is decided by the worker's rules
      against what the release contains, and nothing in this feature reports, validates or warns
      about a preference the release cannot satisfy. In particular, a variant that no track in a
      release matches is not an error condition anywhere in this spec, and neither is a language
      with no track at all.

### Non-Functional & Operational Requirements

- [x] **NFR-1 (No Backfill)**: The project is still in development, so there is no data migration.
      The seed is corrected and an existing development database is refreshed with `bin/dbreset`.
      This follows the precedent `029-settings-screen-tabs` set when it dropped `user_languages`.

- [x] **NFR-2 (Idempotent Seed)**: The language seed must tolerate being re-run against a database
      that already holds its rows, rather than failing on a duplicate key.

- [x] **NFR-3 (Original Language Still Resolves)**: Resolving a title's TMDB `originalLanguage`
      (ISO-639-1) to the ISO-639-2/B code the worker needs must keep working for every language,
      including `es`. A title whose original language cannot be resolved would fail every encode of
      that title, since the original language is the one mandatory track.

- [x] **NFR-4 (Worker Untouched)**: No file under `services/worker/` changes. The new payload field
      is additive; the worker's existing `allowedLanguagesIso3` handling and its FFmpeg selection
      rules must behave exactly as they do today.

- [x] **NFR-5 (Keyboard And Screen Reader)**: The picker replaces a native `<select multiple>` with
      custom controls, so it must carry the listbox semantics and keyboard operation the native
      element provided for free — every entry reachable and togglable without a mouse, and every
      badge's remove control likewise.

- [x] **NFR-6 (Scoping Unchanged)**: The per-title mutations stay scoped exactly as they are today —
      a title the calling user does not own is refused with the existing message, and
      `Movie.preferredLanguages`/`Show.preferredLanguages` keep resolving to the calling user's own
      list rather than the merge across owners.

## GraphQL Contract Delta

```graphql
type Language {
  id: ID!
  tag: String!
  iso2: String!
  iso3: String!
  name: String!
}

type Query {
  languages: [Language!]!
}

type Mutation {
  setMoviePreferredLanguages(movieId: Int!, tags: [String!]!): [Language!]!
  setShowPreferredLanguages(showId: Int!, tags: [String!]!): [Language!]!
}

type EncodeJobDetails {
  # …every existing field, unchanged…
  allowedLanguagesIso3: [String!]!
  allowedLanguageTags: [String!]!
}
```

`Language.tag` is the identifier from this feature on: unique, BCP-47 (`en`, `ja`, `es-419`,
`es-ES`). `iso2` stays on the type and in the table but **stops being unique** — three rows now
carry `es`. It remains the join to TMDB's `originalLanguage` and the basis for the base-language
name `web` groups under. `iso3` is unchanged, and all three Spanish rows carry `spa`.

`Query.languages` returns the **pickable** catalog, not every row: a base-language row is omitted
whenever variant rows of it exist. Today that hides exactly one row, `es`. `web` reconstructs the
grouping from the returned rows by their shared `iso2` — two or more rows with the same `iso2` form
a group, one row stands alone — and renders the group heading from `iso2` through
`Intl.DisplayNames`. No `selectable` flag crosses the wire; the rule is derived on both sides from
the same fact.

Both per-title mutations rename their list argument from `iso2` to `tags`. This is the one breaking
change in the delta and it breaks silently — `web` retypes these operations by hand in
`services/web/src/actions/languages.ts`, and a stale `$iso2` variable would fail at runtime with no
compile error in either service. The `default_languages` setting keeps its shape, a comma-separated
string in one `Setting` row, but its members are now tags.

`EncodeJobDetails.allowedLanguageTags` is the same merge `allowedLanguagesIso3` already performs —
`{original} ∪ default_languages ∪ ⋃(per-title preference of every owner)`, deduplicated, original
first — expressed in tags instead of resolved to ISO-639-2/B. Both fields ship on every payload.
They are not redundant: the ISO-639-2/B list is what matches `ffprobe`'s `tags.language`, and it is
lossy by design, since `es-419` and `es-ES` both collapse into `spa`. The tag list is what preserves
which variant was asked for. The worker does not read the new field in this spec, so its two
hand-retyped copies of `EncodeJobDetails` (`src/jobs/encode.job.ts` and `src/encode/types.ts`) stay
as they are; the field arriving unread is the intended state until the follow-up spec.

One preference governs **both** audio and subtitles. `buildFfmpegCommand` passes one allow-list to
`getAudioParams` and `getSubtitleParams`, and this feature does not split it. Asking for Latin
American audio with European Spanish subtitles is not expressible, deliberately — see Out of Scope.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| A submitted tag is not a row in the `languages` catalog — a malformed or unseeded tag such as `es-AR`, never a release that lacks the track | `BadRequestException`, key `error.language.unavailable`, params `{ tag }` | `El idioma «es-AR» no está disponible` |
| The same tag appears twice in one submission | `BadRequestException`, key `error.language.duplicate`, params `{ tag }` | `El idioma «es-419» está repetido` |
| `setMoviePreferredLanguages` / `setShowPreferredLanguages` for a title the caller does not own | existing scoping error, reused verbatim, no new key | `La película <id> no existe` / `Recurso no disponible para este usuario` |
| A `default_languages` value containing an unknown or duplicated tag | the same two keys above, raised from the settings write path | as above |

The `params` key on both language errors changes from `iso2` to `tag`, following the argument
rename. Consumers: the picker keeps its own submission in local state and renders the translated
message inline beside the control without discarding what the user had selected, so a rejected save
is correctable rather than lost. `web` adds `errors.language.unavailable` and
`errors.language.duplicate` to `messages/en.json` and `messages/es.json` (REQ-11); until a key has a
catalog entry `translateGraphQLError` falls back to `api`'s English message, which is why the two
keys are listed here even though `api` already raises them today.

Both errors belong to the **write** path only — they answer "is this a language we know?", never "is
this language in the release?". The name `error.language.unavailable` invites the second reading and
does not mean it; nothing in this feature inspects a file, so a preference the release cannot satisfy
produces no error, no warning and no GraphQL surface (REQ-12).

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `Language` | add `tag String @unique` | non-null, no default | No — development-mode reseed (NFR-1) |
| `Language` | `iso2` drops `@unique` | unchanged | No |
| `Language` | seed gains rows `es-419` and `es-ES`, both `iso2: es`, `iso3: spa` | — | No |
| `Language` | existing seeded rows gain `tag` equal to their `iso2` | — | No |
| `UserMovieLanguage` | none — still points at a `Language` row by id | — | No |
| `UserShowLanguage` | none — still points at a `Language` row by id | — | No |
| `Setting` (`default_languages`) | no schema change; value members become tags | seeded `''` | No |

The join tables need no change precisely because they reference `Language.id`: a variant is a row,
so a preference for a variant is the same kind of row a preference for a language already was.

## Acceptance Criteria

- [x] **AC-1**: `bin/dbreset` completes, and `bin/mysql -e 'select tag, iso2, iso3 from languages
      where iso2 = "es" order by tag'` returns exactly three rows — `es`, `es-419`, `es-ES` — all
      with `iso3 = spa`.

- [x] **AC-2**: The `languages` query returns `es-419` and `es-ES` and does **not** return `es`,
      while every single-row language (`en`, `ja`, …) is still returned.

- [x] **AC-3**: On `/settings` → Descarga, Spanish appears as a non-clickable heading with
      "Español latinoamericano" and "Español de España" as the two entries under it. Clicking one
      adds a badge to the chosen list; clicking it again, or clicking the badge's X, removes it.

- [x] **AC-4**: With the UI locale set to `en`, the same two entries read "Latin American Spanish"
      and "European Spanish" and remain grouped together, not scattered alphabetically through the
      list.

- [x] **AC-5**: Choosing "Español latinoamericano" in Settings and saving stores it, and
      ``bin/mysql -e 'select value from settings where `key` = "default_languages"'`` shows a value
      containing `es-419`. Reloading the page shows the same badge still chosen.

- [x] **AC-6**: On a film's detail page, choosing "Español de España" and saving, then reloading,
      shows the choice persisted; the film's `preferredLanguages` in the GraphQL response contains a
      `Language` whose `tag` is `es-ES`.

- [x] **AC-7** *(failure path)*: Calling `setMoviePreferredLanguages(movieId: <owned>, tags: ["es-419",
      "es-AR"])` is rejected with `error.language.unavailable`, and `bin/mysql` shows the film's rows
      in `user_movie_languages` unchanged from before the call — the valid first tag was not written.

- [x] **AC-8** *(failure path)*: Submitting `tags: ["es-419", "es-419"]` is rejected with
      `error.language.duplicate`, and the picker renders the translated Spanish message inline while
      keeping the user's selection on screen rather than clearing it.

- [x] **AC-9**: A film with `es-419` chosen produces an encode job whose `allowedLanguageTags`
      contains `es-419` and whose `allowedLanguagesIso3` contains `spa` exactly once, even when both
      Spanish variants are chosen.

- [x] **AC-10**: A film whose TMDB `originalLanguage` is `"es"` still enqueues an encode job with
      `originalLanguageIso3 = "spa"` — the hidden `es` row still resolves.

- [x] **AC-11**: `bin/npm worker run test` passes with zero changes under `services/worker/`, and
      `git status services/worker/` is clean.

- [x] **AC-12**: The picker is fully operable from the keyboard: entries reachable and togglable
      without a mouse, and each badge's remove control focusable and activatable.

## Out of Scope

- **Teaching the worker to honour the variant.** `params.ts` keeps its current hard-coded
  preference for Latin American Spanish, for both audio and subtitles. This spec only guarantees the
  chosen tags arrive on the job payload. The follow-up spec owns the harder half — what to do when a
  release marks no variant, when it marks one the user did not ask for, and when both were requested
  but only one exists — which is exactly the reasoning this feature was scoped to keep out.

- **Separate preferences for audio and subtitles.** One preference governs both, because
  `buildFfmpegCommand` passes one allow-list to both rule functions. Splitting it would double the
  picker on every screen that carries it, for a case that is rare against how often it would be in
  the way. Recorded as a decision, not an omission.

- **Variants for any language other than Spanish.** `pt-BR`/`pt-PT`, `zh-Hans`/`zh-Hant` and
  `fr-CA`/`fr-FR` are the same shape of problem and the model handles them, but each is two seed
  rows and no code, so they are added when someone wants them rather than speculatively (Article X).

- **Detecting which variants a release actually contains.** Nothing in this feature inspects a file
  or a release name to tell the user "this one has a Latin American track". The preference is
  expressed against the catalog, never against a specific release's contents.

- **Deleting `services/web/src/components/form/MultiSelect.tsx`.** It loses its only importer when
  Settings moves to the shared picker, and stays in the repository unused as template scaffolding.

- **Renaming `MediaSource.movieId` and its two siblings.** The known-debt item in the root
  `CLAUDE.md` is untouched here; this feature adds no new occurrence of it.

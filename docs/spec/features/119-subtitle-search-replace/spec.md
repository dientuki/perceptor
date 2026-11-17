---
title: Subtitle Search and Replace
spec_version: 0.1.1
author: Juan "Dientuki" Farias
created_at: 2026-11-15
last_updated: 2026-11-15
status: Implemented
services: [api, web, worker]
---

# SPEC: Subtitle Search and Replace (`spec.md`)

## Context & Goal

Pressing "Buscar subtitulos" (spec `106`) only looks for the languages the file does not hold: the
driver compares the wanted languages with the ones already present by ISO 3 code alone
(`SubtitleSearch.presentLanguages`), so a track that is already there counts as done even when it is
wrong. Spec `118` made that visible: a file whose embedded Spanish track is the Spain variant, when
the user wanted Latin American, is never fixed by a new search. The only way out today is to remove
the track by hand.

This feature makes the manual search dialog able to replace. The dialog is retitled "Search and
replace subtitle" and lists, for every wanted language the file already holds, a checkbox that is
off by default. A language the user ticks is searched as if the file did not have it. If a candidate
is accepted, the existing track or tracks of that language are removed and the new one is embedded
in the same remux; if no candidate is accepted, the file is left exactly as it was. Nothing is ever
replaced without the user ticking the box, and the automatic search (spec `103`) never replaces.

Stages touched: Notify media server (the `103`/`106` search and `101`'s embed remux, whose
worker job today only appends tracks). Browse library: the dialog in `web`.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Dialog)**: The manual search dialog (`SearchSubtitlesButton`, films and episodes)
      must be titled "Search and replace subtitle" (Spanish copy: see the table below) and, under
      its existing explanation, list one checkbox per wanted language that the title's file
      already holds. Every checkbox starts unticked on every open of the dialog.
- [ ] **REQ-2 (No checkboxes)**: A wanted language the file does not hold has no checkbox, and
      is searched exactly as today. When no wanted language is already present the dialog shows
      no checkbox section at all.
- [ ] **REQ-3 (Request)**: Confirming sends the ticked languages with the search request. An
      empty or absent list behaves exactly as `106` does today.
- [ ] **REQ-4 (Search as if absent)**: A ticked language counts as missing for the whole search:
      it is queried from the provider, its candidates go through `103`'s acceptance and, when
      the user opted into variant detection, `118`'s wrong-variant rule, with the same cap of three
      attempts. Its outcome is reported like any other searched language.
- [ ] **REQ-5 (Replace on accept)**: When a candidate for a ticked language is accepted, the
      embed removes every existing text subtitle track of that language and adds the new one,
      in the same single atomic remux (`101`). The new track carries the same title, flags and
      provenance tags `107`/`118` give any embedded track.
- [ ] **REQ-6 (Keep on miss)**: When no candidate for a ticked language is accepted (none found,
      all rejected, provider failure, quota exhausted), the existing tracks of that language stay
      untouched and the language's outcome says so (`NOT_FOUND`, `REJECTED` or `FAILED`, with the
      reason key, as today).
- [ ] **REQ-7 (Other languages)**: Replacing one language never changes another language's
      tracks. Forced tracks and image-format tracks are never removed. A ticked language whose
      only existing tracks are image-format ones is searched, and the new text track is added
      beside them (nothing to replace). The same holds for a ticked language held only as a
      sidecar (`fileSubtitleLanguages` and `presentLanguages` both count sidecars): it is
      searched, the new track is embedded, and the sidecar stays (REQ-9).
- [ ] **REQ-8 (Outcome)**: A ticked language whose accepted candidate was embedded reads as a new
      `REPLACED` value in the search's per-language outcome, distinct from `RESOLVED`. `REPLACED`
      means "searched with replace and embedded": it states that the file's non-forced text
      tracks of that language were replaced by the new one, not that anything else of that
      language (an image track, a forced track, a sidecar) is gone. `api` never learns how many
      tracks the worker dropped, and the outcome does not depend on it.
- [ ] **REQ-9 (Manual only)**: Only the manual mutations carry the list. The automatic search
      started at delivery never replaces and never receives one. A sidecar the user supplied is
      not a track of the file and is never touched.
- [ ] **REQ-10 (Library record)**: After a replace the title's stored file subtitle languages
      (`108`) and the media server are refreshed the same way a normal embed refreshes them.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Safety)**: The replace is all or nothing with the embed: the file is verified
      before the rename (`101`), and a failed remux leaves the original file and its tracks
      intact. A search that ends with nothing accepted never starts a remux for the ticked
      language.
- [ ] **NFR-2 (Quota)**: Ticking a language costs provider downloads like any search; the
      dialog's existing quota warning stays and covers it.
- [ ] **NFR-3 (Compatibility)**: The new argument is optional; an older `web` that omits it
      keeps today's behaviour. No data migration.
- [ ] **NFR-4 (Language)**: Spanish copy for the user, English everywhere committed.

## GraphQL Contract Delta

```graphql
type Mutation {
  searchMovieSubtitles(movieId: Int!, replaceLanguages: [String!]): SubtitleSearch!
  searchEpisodeSubtitles(episodeId: Int!, replaceLanguages: [String!]): SubtitleSearch!
}

enum SubtitleSearchLanguageOutcome {
  PENDING
  ALREADY_PRESENT
  RESOLVED
  REPLACED
  MISSING
  NOT_FOUND
  REJECTED
  FAILED
}
```

`replaceLanguages` holds ISO 3 codes (lower case, as `languageIso3` everywhere). `web` builds it
from the dialog's ticked boxes and reads which languages are present from the title's stored
`fileSubtitleLanguages` (`108`), which already reaches it.

Worker boundary: the `subtitle-embed` job's payload (the `SubtitleEmbedDetails` the worker reads
from `api`) gains the list of ISO 3 languages whose existing text tracks must be dropped in the
remux; absent or empty means append only, as today. The worker reads a missing value as empty.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| `replaceLanguages` names a language that is not one of the search's wanted languages | `BadRequest`, `error.subtitleSearch.replace_language_not_wanted` | `Ese idioma no está entre los que se buscan en este título.` |
| `replaceLanguages` names a wanted language the file does not hold | `BadRequest`, `error.subtitleSearch.replace_language_not_present` | `El archivo no tiene subtítulos en ese idioma para reemplazar.` |
| All existing refusals of `106` | unchanged | unchanged |

`web` consumers: the action maps both new keys through the existing error translator; the
dialog only offers present wanted languages, so these appear only against a stale page. `worker`
treats an unknown language in the drop list as nothing to drop.

## Data Model Changes

| Model | Change | Nullable / default | Backfill needed? |
| :-- | :-- | :-- | :-- |
| `SubtitleSearch` | new `replaceLanguages Json?` snapshotting the ticked languages when the search starts | nullable, absent = none | No |
| `SubtitleEmbed` | records the languages to drop for its remux (nullable list) | nullable | No |
| `SubtitleSearchLanguageOutcome` (GraphQL only) | new value `REPLACED`; the outcome is derived at read time, never stored | n/a | No |

## Copy (user-facing, Spanish)

| Where | Text |
| :-- | :-- |
| Dialog title | `Buscar y reemplazar subtítulos` |
| Section label | `Reemplazar los que ya están` |
| Section hint | `Marcá un idioma para buscar uno nuevo y reemplazar el que está dentro del archivo. Si no se encuentra uno aceptable, el actual se conserva. Los subtítulos forzados, los de imagen y los externos no se tocan.` |
| Outcome `REPLACED` | `Reemplazado` |

## Acceptance Criteria

- [ ] **AC-1**: Given a film whose file holds Spanish and English subtitles and wanted languages
      spa and eng, when the dialog opens, then it is titled "Buscar y reemplazar subtítulos" and shows
      two checkboxes, both unticked.
- [ ] **AC-2**: Given a wanted language the file lacks, when the dialog opens, then that language
      has no checkbox; with no present wanted language the checkbox section is absent.
- [ ] **AC-3**: Given spa ticked and a provider candidate that passes acceptance, when the search
      completes, then the file's `spa` track(s) are replaced by one new track, the English track is
      unchanged, and the spa outcome reads `Reemplazado`.
- [ ] **AC-4**: Given a user opted into variant detection with Spain Spanish embedded and es-419
      wanted, when spa is ticked and an es-419 candidate is accepted, then the Spain track is gone
      and the new one is titled `Latino`.
- [ ] **AC-5 (failure)**: Given spa ticked and every candidate rejected (or the provider returns
      none), when the search finishes, then the file is byte-identical to before, no remux ran, and
      the spa outcome reads `NOT_FOUND` or `REJECTED` with its reason.
- [ ] **AC-6 (failure)**: Given a remux that fails verification, when a replace was requested, then
      the original file remains and the search reports failure for that language.
- [ ] **AC-7**: Given nothing ticked, when the user confirms, then the search behaves exactly as
      `106`/`114` (present languages are `ALREADY_PRESENT`).
- [ ] **AC-8 (failure)**: A request naming a language not present in the file is refused with
      `error.subtitleSearch.replace_language_not_present` and no search row is created.
- [ ] **AC-9**: Given a file with a forced Spanish track and a regular one, when spa is replaced,
      then the forced track stays.
- [ ] **AC-10**: The automatic search at delivery never carries replace languages.
- [ ] **AC-11 (failure)**: A request naming a language that is not one of the search's wanted
      languages is refused with `error.subtitleSearch.replace_language_not_wanted` and no search
      row is created.
- [ ] **AC-12**: Given a ticked language held only as a sidecar, when a candidate is accepted,
      then the new track is embedded, the sidecar file is still on disk, and the outcome reads
      `Reemplazado`.

## Out of Scope

- **A per-track choice.** The ticked language replaces all of its text tracks (decided with the
  user); picking one among several is a separate feature.
- **Replacing from the "Incrustar en archivo" dialog or a user's own sidecar.** Sidecars are never
  checked or touched (`118`).
- **Automatic replacement of a wrong variant.** Only a manual tick replaces; inferring that an
  existing track is the wrong variant stays out (`118`).
- **Season or library-wide replace, or a scheduled sweep.** Same quota reasoning as `106`.
- **Replacing audio tracks.**

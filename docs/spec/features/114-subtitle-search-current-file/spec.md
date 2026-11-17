---
title: Subtitle search outcome follows the current file
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-30
last_updated: 2026-10-30
status: Implemented         # Draft | Approved | Implemented | Superseded
services: [api, web]
---

# SPEC: Subtitle search outcome follows the current file (`spec.md`)

## Context & Goal

A film's panel and each episode row show the latest subtitle search (`latestSubtitleSearch`, `103`,
`106`, `107`) with one line per wanted language. That line is derived in `api`
(`services/api/src/subtitle-search/derive-languages.ts`) only from the search's own row:
`wantedLanguages`, `presentLanguages` and its attempts. Once the search ends nothing it shows can
change again. When a language the search could not get later reaches the file by another route, the
line stays red forever. The other routes are a manual embed (`101`, `113`) or a new file delivered
with that track. The reverse is also true: a language the search embedded keeps reading green after
the file is replaced by one that lacks it.

The live case: film 73 (Guyver: Dark Hero). Search #38 rejected both Spanish candidates
(`error.subtitleSearch.framerate_mismatch`). The user then embedded a Spanish `.srt` by hand with
`113`'s automatic offset (embed #25, `COMPLETED`). `108`'s read stored
`fileSubtitleLanguages = ["eng","spa"]`, but the panel still reads "Español: Rechazado" in red.

Once this ships, the status of a language describes the library file as it is now, not the moment
of the search. A wanted language the file holds reads as resolved, whether the search embedded it
or the user did. A wanted language the file no longer holds reads as missing, whatever the search
once achieved. The source of truth is `108`'s `Movie`/`Episode.fileSubtitleLanguages`, which
already uses the same rule the search uses (non-forced embedded tracks plus sidecars, one entry per
language) and is refreshed on delivery, embed, Refresh and media-server sync. This changes the
"Notify media server" and "Browse library" stages' display only; no pipeline behaviour changes.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Current file wins once the search is terminal)**: For a search whose `status` is
      `COMPLETED` or `FAILED`, and whose title's `fileSubtitleLanguages` is not `null`, each wanted
      language's outcome must be decided by the current file first:
      - in `fileSubtitleLanguages` → `ALREADY_PRESENT` if the language was in the search's
        `presentLanguages`, otherwise `RESOLVED`, with `reasonKey` `null`;
      - not in `fileSubtitleLanguages`, and the search's own outcome would be `RESOLVED` or
        `ALREADY_PRESENT` → `MISSING`, with `reasonKey` `null`;
      - not in `fileSubtitleLanguages` otherwise → the search's own outcome, unchanged
        (`NOT_FOUND`, `REJECTED`, `FAILED` with its existing `reasonKey`).
- [ ] **REQ-2 (One "resolved" outcome)**: A language the search itself embedded and a language that
      reached the file any other way must read the same outcome, `RESOLVED`. The outcome previously
      named `EMBEDDED` is renamed `RESOLVED` everywhere, including the search's own derivation
      before REQ-1 applies.
- [ ] **REQ-3 (Search in flight keeps its own view)**: While the search is `WAITING`, `SEARCHING`,
      `VALIDATING` or `EMBEDDING`, its languages must be derived exactly as today (with `EMBEDDED`
      read as `RESOLVED`). The current file does not override a search that is still deciding.
- [ ] **REQ-4 (Never read means no override)**: When the title's `fileSubtitleLanguages` is `null`
      (`108`: never read, or cleared because the file is gone), the search's own outcome must stand.
      This also covers the gap between an embed finishing and `108`'s read landing.
- [ ] **REQ-5 (Films and episodes)**: REQ-1 to REQ-4 must apply to `Movie.latestSubtitleSearch` and
      `Episode.latestSubtitleSearch` alike, each against its own `fileSubtitleLanguages`.
- [ ] **REQ-6 (Display)**: `web` must show `RESOLVED` in green with the label "Resuelto" /
      "Resolved", and `MISSING` in red with the label "Falta en el archivo" / "Missing from file",
      wherever `SubtitleSearchStatus` renders (film panel, episode row).

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (Derived, never stored)**: The outcome stays derived at read time, as `103` set it.
      No row of `subtitle_searches` or `subtitle_search_attempts` is written to reflect a later
      file change, and the search's own `status`/`finishedAt` do not change.
- [ ] **NFR-2 (No extra external calls)**: Resolving an outcome must not touch the media server,
      OpenSubtitles or the worker; it reads only rows `api` already holds.
- [ ] **NFR-3 (Read cost)**: A season's episode list must not issue one extra query per episode to
      read `fileSubtitleLanguages` when the resolver already has the parent row loaded.

## GraphQL Contract Delta

```graphql
enum SubtitleSearchLanguageOutcome {
  PENDING
  ALREADY_PRESENT
  RESOLVED   # replaces EMBEDDED: the wanted language is in the file, by the search or any other way
  MISSING    # new: the search had it (resolved or already present) and the current file does not
  NOT_FOUND
  REJECTED
  FAILED
}
```

`EMBEDDED` is removed, not deprecated. `web` is the only consumer (`types/media.ts`,
`SubtitleSearchStatus.tsx`) and both ship in the same release (`PERCEPTOR_TAG` is one version for
all images). The worker does not read this type.

`reasonKey` stays non-null only for `FAILED` and `REJECTED`; it is `null` for `RESOLVED` and
`MISSING`. The schema description of `SubtitleSearchLanguage.reasonKey` is unchanged.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| — | — | — |

No new error: this feature changes what a successful read returns. `web`'s handling: an unknown
outcome string (a mixed set of images) falls back to the raw value with neutral colour, which is
what `SubtitleSearchStatus`'s `label` helper and `OUTCOME_TEXT_CLASS` default already do.

`docs/spec/graphql-contract.md` gets a `114` section and a "Superseded by `114`" note on `103`'s
enum line.

## Data Model Changes

None. `fileSubtitleLanguages` (`108`) and every `subtitle_searches` column already exist.

## Acceptance Criteria

- [ ] **AC-1**: Given film 73, whose latest search #38 reads Spanish `REJECTED`
      (`framerate_mismatch`) and whose `fileSubtitleLanguages` is `["eng","spa"]` after embed #25,
      when its detail page is opened, then the subtitle search panel reads "Español: Resuelto" in
      green and no red line remains.
- [ ] **AC-2**: Given a completed search that embedded Spanish itself, when the page is opened after
      `108`'s read, then Spanish reads "Resuelto" in green (previously "Incrustado").
- [x] **AC-3**: Given a film whose search embedded Spanish, when its file is replaced by a delivery
      with no Spanish subtitle and `108`'s read stores a `fileSubtitleLanguages` without `spa`,
      then Spanish reads "Falta en el archivo" in red.
- [ ] **AC-4**: Given a completed search with Spanish `NOT_FOUND` and a file without Spanish, when
      the page is opened, then Spanish still reads "No encontrado" (failure path: no false green).
- [x] **AC-5**: Given a search with Spanish `REJECTED` and a file that holds Spanish only as a
      forced track, when the page is opened, then Spanish still reads "Rechazado" with its reason
      (failure path: a forced track does not resolve a language).
- [x] **AC-6**: Given a title whose `fileSubtitleLanguages` is `null`, when the page is opened, then
      every language reads exactly the search's own outcome.
- [ ] **AC-7**: Given an episode whose search rejected Spanish and that was later embedded by hand,
      when its season is expanded, then the episode row reads "Español: Resuelto" in green.
- [x] **AC-8**: Given a search still `SEARCHING` while the file already holds a wanted language,
      when the page is opened, then that language reads `PENDING`, not `RESOLVED`.
- [ ] **AC-9**: After any of the above, `subtitle_searches` and `subtitle_search_attempts` rows for
      the title are byte-identical to before the page was opened (NFR-1).
- [x] **AC-10**: `api`'s unit tests cover each branch of REQ-1 to REQ-4 for the derivation
      (Article IX: a wrong colour here is a silent failure).

## Out of Scope

- **Starting a new search, or re-running one, when the file changes.** The status reflects the
  current file; acquiring a subtitle for a `MISSING` language is still the manual button (`106`)
  or the opt-in automatic search on delivery (`103`).
- **Changing the search's own `status` badge.** A search that `FAILED` still reads "Fallida" at the
  top; only the per-language lines follow the file. The badge describes what the search did, the
  lines describe what the file needs.
- **Languages the file has but the search did not want.** The panel lists the search's
  `wantedLanguages` only; the full track list is already `108`'s subtitle box.
- **Reflecting changes to the user's language preferences.** `wantedLanguages` stays the snapshot
  taken when the search started.

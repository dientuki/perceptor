---
title: Movie Release Dates Display
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-10-16
last_updated: 2026-10-16
status: Approved
services: [api, web]
---

# SPEC: Movie Release Dates Display (`spec.md`)

## Context & Goal

Since `075-movie-refresh-sweep`, every film carries three typed release dates — theatrical, digital
and physical — beside the single `Movie.releaseDate` it always had (`theatricalReleaseDate`,
`digitalReleaseDate`, `physicalReleaseDate`, each the earliest matching day across every country
TMDB lists). `076` reads them to decide when to acquire a film. Nobody can **see** them: `075`
NFR-7 deliberately kept them off the GraphQL surface, so the film's detail page
(`services/web/src/components/movies/Movie.tsx`) still shows only a year derived from `releaseDate`,
and the calendar (`062-release-calendar`, `services/api/src/calendar/calendar.service.ts`) still
places a film on `releaseDate` alone. That date is TMDB's earliest release of any type — often a
festival premiere — so a user waiting for a digital or physical release cannot tell from Perceptor
when it lands, and cannot tell why `acquire_movies` has or has not picked a film up yet.

This feature exposes the three typed dates and uses them in two places. The film's detail page keeps
the year and adds, under it, the dates that are known, side by side. The calendar lists a film once
per distinct typed date instead of once on `releaseDate`, each entry prefixed with which release it
is — `(cine)`, `(digital)`, `(físico)` — and a film whose theatrical and digital releases share a day
shows a single entry carrying both labels. A film with no typed date at all keeps today's single,
unlabelled entry on `releaseDate`, so a library registered before `075`'s columns were populated
loses nothing.

Films and shorts only — episodes have one air date and are unchanged. No pipeline stage changes
status; this touches the "Browse library" row of the root `CLAUDE.md` table (the detail page and
`/calendar`) and adds read-only fields to the GraphQL contract. No schema change: every value read
here is already stored.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Expose the typed dates)**: The `Movie` GraphQL type must expose the film's
      theatrical, digital and physical release dates, each nullable, exactly as `075` REQ-1 stores
      them. The existing `releaseDate` field is unchanged in meaning and value.
- [ ] **REQ-2 (Detail page — year stays)**: The film's detail page must keep showing the year it
      shows today (derived from `releaseDate`, or the "unknown year" text when there is none).
- [ ] **REQ-3 (Detail page — the dates)**: Under the year line, the detail page must show each
      typed date the film **has**, side by side on one row, each with its label (Cine / Digital /
      Físico in `es`; Theatrical / Digital / Physical in `en`) and the full day formatted for the
      active UI locale. A typed date that is null is omitted, not shown as a dash. A film with none
      of the three shows no row at all. Order is always theatrical, digital, physical. Applies to a
      short exactly as to a film (same page).
- [ ] **REQ-4 (Calendar — one entry per distinct typed day)**: For a film or short that has at least
      one typed date, `calendar(from, to)` must return one entry per **distinct day** among its
      non-null typed dates that falls inside the requested range. Two or three typed dates on the same
      day produce a single entry for that day.
- [ ] **REQ-5 (Calendar — which releases an entry is)**: Each film/short entry must carry the set of
      release types whose date falls on that entry's day, in the fixed order theatrical, digital,
      physical.
- [ ] **REQ-6 (Calendar — fallback)**: A film or short with **none** of the three typed dates keeps
      exactly today's behaviour: one entry on `releaseDate` (when it falls in range), carrying an
      empty set of release types. A film that has at least one typed date is never listed on
      `releaseDate` as well — if `releaseDate` is a premiere/festival day matching no typed date, that
      day shows nothing for this film.
- [ ] **REQ-7 (Calendar — label)**: The calendar page must render each film/short entry's title
      prefixed by one parenthesised label per release type it carries — `(cine)`, `(digital)`,
      `(físico)` in `es`, `(theatrical)`, `(digital)`, `(physical)` in `en` — e.g.
      `(cine) (digital) Título`. An entry with an empty set renders the bare title, as today. The
      kind icon (film/short) stays. The hover title text includes the labels too.
- [ ] **REQ-8 (Calendar — everything else unchanged)**: Every entry of the same film carries the
      film's single status (`062` REQ-6 colouring), links to the same `/movies/<id>`, and obeys
      `045`/`048` type availability as today. Ordering within a day is unchanged (`date`, then title).
      Episode entries are untouched and carry no release types.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (No TMDB call)**: Neither the detail page nor the calendar may cause a TMDB request;
      both read only stored columns (`deployment-scale`: conserve external calls).
- [ ] **NFR-2 (No schema change, no backfill)**: No Prisma change. A film whose typed dates are still
      `NULL` (registered before `075` and not yet swept or manually refreshed — a `COMPLETED` film is
      never swept, `075` REQ-6) falls under REQ-6 and REQ-3's "no row" case; filling it is the
      existing Refresh button's job, not this feature's.
- [ ] **NFR-3 (Additive contract)**: Every GraphQL change is additive (graphql-contract.md
      § "Additive changes are safe"); an un-updated `web` keeps working against the new `api`.
- [ ] **NFR-4 (Calendar range still bounded)**: The calendar's film lookup must still be bounded by
      the requested range — a film qualifies when any of its typed dates, or (for the fallback)
      `releaseDate`, falls inside it — not by loading the user's whole film library.
- [ ] **NFR-5 (i18n)**: Every new label lives in `services/web/messages/{en,es}.json`, `es` in the
      existing Rioplatense register.

## GraphQL Contract Delta

```graphql
type Movie {
  # existing fields unchanged …

  """Earliest theatrical (TMDB types 2 and 3) day across every country, or null (075 REQ-1)."""
  theatricalReleaseDate: DateTime

  """Earliest digital (TMDB type 4) day across every country, or null (075 REQ-1)."""
  digitalReleaseDate: DateTime

  """Earliest physical (TMDB type 5) day across every country, or null (075 REQ-1)."""
  physicalReleaseDate: DateTime
}

enum MovieReleaseType {
  THEATRICAL
  DIGITAL
  PHYSICAL
}

type CalendarEntry {
  # existing fields unchanged …

  """
  Null unless kind is MOVIE or SHORT. The release types whose date is this entry's day, ordered
  THEATRICAL, DIGITAL, PHYSICAL. Empty when the film has no typed date and the entry sits on
  releaseDate (093 REQ-6).
  """
  releaseTypes: [MovieReleaseType!]
}
```

`calendar(from, to)`'s signature is unchanged; what changes is that a single film may now yield up to
three entries in one response (REQ-4), each with the same `kind`/`mediaId`/`title`/`status` and a
different `date`. A consumer must not key entries by `mediaId` alone — `(mediaId, date)` is unique
for film/short entries.

The `movie(id)` and `movies` queries carry the three new fields with no new arguments. Where they
are selected (today only the detail page needs them) is a `web` choice.

Errors:

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| None new. `calendar` keeps `062`'s invalid-range error; `movie(id)` keeps `008`'s unavailable-title error | — | — |

Consumer handling: `web` treats `releaseTypes: null` (episodes) and `[]` (fallback) identically —
no prefix. An enum value `web` does not recognise is rendered as no label rather than failing the
page (forward compatibility, same posture as `057`'s `contentKind` default).

## Data Model Changes

None. `Movie.theatricalReleaseDate`, `digitalReleaseDate` and `physicalReleaseDate` already exist
(`075`).

## Acceptance Criteria

- [ ] **AC-1**: Given a film whose `theatricalReleaseDate`, `digitalReleaseDate` and
      `physicalReleaseDate` are all non-null and distinct, when its detail page opens in `es`, then
      the year line is unchanged and under it one row shows `Cine`, `Digital` and `Físico` each with
      its full day, in that order, matching `bin/mysql -e "select theatricalReleaseDate,
      digitalReleaseDate, physicalReleaseDate from movies where id=<id>"`.
- [ ] **AC-2**: Given a film with only a theatrical date (digital and physical `NULL`), its detail
      page shows the year and a single `Cine <day>` entry — no `Digital`, no `Físico`, no dash.
- [ ] **AC-3 (failure / missing data)**: Given a film with all three typed dates `NULL` but a
      `releaseDate`, the detail page shows the year and **no** dates row; on `/calendar` the film
      appears exactly once, on `releaseDate`'s day, with its bare title and no `(…)` prefix — identical
      to before this feature.
- [ ] **AC-4**: Given the AC-1 film with all three dates in the same month, `/calendar` for that month
      shows three entries for it: `(cine) <title>`, `(digital) <title>`, `(físico) <title>` on their
      respective days, all three the same status colour and all linking to `/movies/<id>`. No entry
      sits on `releaseDate`'s day unless it equals one of the three.
- [ ] **AC-5**: Given a film whose theatrical and digital dates are the same day, that day shows one
      entry `(cine) (digital) <title>`, and the `calendar` query returns one entry for that day with
      `releaseTypes: [THEATRICAL, DIGITAL]`.
- [ ] **AC-6**: Given a film whose digital date is in month M and physical date in month M+1, the
      calendar for M shows only `(digital) <title>`; navigating to M+1 shows only `(físico) <title>`.
- [ ] **AC-7**: Given a short with a typed date while `shorts_enabled` is off, it appears on neither
      the calendar nor (unchanged) anywhere else short-gated — `045`/`048` gating applies to every one
      of its entries.
- [ ] **AC-8**: Switching the UI locale to `en` renders `(theatrical)`/`(digital)`/`(physical)` on the
      calendar and `Theatrical`/`Digital`/`Physical` on the detail page.
- [ ] **AC-9**: Episode entries on `/calendar` render exactly as before and carry
      `releaseTypes: null` in the `calendar` response.
- [ ] **AC-10**: The final `services/api/src/schema.gql` diff contains exactly the three `Movie`
      fields, the `MovieReleaseType` enum and `CalendarEntry.releaseTypes` (Article VIII).

## Out of Scope

- **Showing the typed dates anywhere else** (search results, library cards, billboard, `/shorts`
  listing). Asked for on the detail page and the calendar only; the fields are available should a
  later spec want them.
- **Distinguishing DVD from Blu-ray/UHD.** TMDB's physical type (5) does not; the label is
  `(físico)`, not `(blu-ray)`, for that reason.
- **Per-country dates.** `075` stores the earliest day across every country; choosing a region is a
  `075` change, not a display one.
- **Showing the premiere / generic `releaseDate` on the calendar alongside typed dates.** Decided
  against (REQ-6): a film with typed dates is placed only on them.
- **Backfilling typed dates for films that lack them.** Existing Refresh (`069`) and the
  `refresh_movies` sweep (`075`) already do this; NFR-2.
- **Showing why `acquire_movies` did or did not pick a film** (which window applies, days remaining).
  Plausible next step, separate spec.
- **Series and episodes.** One air date each; nothing to type.

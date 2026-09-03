---
title: Global language preferences reach the encode merge
spec_version: 0.1.0
author: Juan "Dientuki" Farias
created_at: 2026-09-03
last_updated: 2026-09-03
status: Implemented
services: [api]
---

# SPEC: Global language preferences reach the encode merge (`spec.md`)

## Context & Goal

A user configures their audio and subtitle languages once, in `/preferences` — English plus
Rioplatense Spanish, say — and expects every title they own to keep those tracks. That is not what
happens. Those lists are stored in `UserLanguagePreference` (`021-user-preferences`, split by
`LanguageTrackKind` since then) and **nothing reads them when a file is encoded**. The only readers
today are `LanguagesService.findPreferredTrackLanguagesFor` and the `/preferences` screen that wrote
them: the preference round-trips through the UI and dies there.

The allow-list the worker actually receives is assembled once, in
`ProcessJobsService.getEncodeJobDetails` → `collectAllowedLanguages`
(`services/api/src/process-jobs/process-jobs.service.ts`), as
`{title's original language} ∪ default_languages (the installation Setting) ∪ every owner's
per-title preference of that kind`. On a fresh installation `default_languages` is seeded empty
(`services/api/prisma/seeds/settings.ts`), and a title the user never gave a per-title override to
contributes nothing either — so for an English-original film the four `allowed*` fields collapse to
exactly `["eng"]` / `["en"]`. Observed on a real encode of *Underworld: Evolution*, whose source
file carried Latin-American Spanish audio **and** subtitles:

```
[encode] 5: compressing=true allowedAudioLanguagesIso3=["eng"] allowedSubtitleLanguagesIso3=["eng"] originalLanguageIso3=eng
[ffmpeg] no text subtitle in an allowed language survived the rules.
```

Both Spanish tracks were dropped, silently and correctly per the rule as written. This is not a
broken fallback — `resolveOriginalLanguage` resolved `en` accurately — it is a preference with no
consumer.

This feature gives it one. Every owner of the title contributes their own global preference, of the
matching `kind`, to the same union, on the same terms as everything else already in it: additive,
deduplicated, never a replacement. It is resolved **at encode time** — the worker pulls
`encodeJobDetails(id)` when it picks the job up, and the queue payload carries no languages — so a
change in `/preferences` applies to everything encoded afterwards, with no backfill and nothing to
re-enqueue. It supersedes the explicit boundary `039-per-title-language-split` drew in its Out of
Scope section ("Those are stored, already split by kind, but nothing reads them at encode time
today"); the reason that boundary existed was scope, not a rule, and the field evidence above is
what reopens it.

Pipeline stage touched: **Transcode** — specifically which tracks survive, never how a surviving
track is encoded. No stage changes status in the root `CLAUDE.md` table. Under Article VII this
change (one service, no schema, no contract) would not require a spec; it gets one by explicit
decision, because it reverses a documented scope boundary of another spec and a future reader needs
the trail.

## Requirements

### Functional Requirements

- [ ] **REQ-1 (Global preference contributes)**: `EncodeJobDetails`' four `allowed*` fields must
      include, for every user who owns the title being encoded, the languages that user stored as
      their general preference (`UserLanguagePreference`), each contributing only to the pair
      matching its own `kind` — `AUDIO` to `allowedAudioLanguagesIso3`/`allowedAudioLanguageTags`,
      `SUBTITLE` to `allowedSubtitleLanguagesIso3`/`allowedSubtitleLanguageTags`.

- [ ] **REQ-2 (Additive, never replacing)**: The contribution is a union with what the merge already
      produces — the title's original language, the `default_languages` Setting, and every owner's
      per-title preference. No source of languages is dropped, narrowed or overridden by another,
      and the result stays deduplicated. A user with a global preference *and* a per-title override
      for the same title gets both, not the more specific one.

- [ ] **REQ-3 (Ownership is the scope)**: Only users linked to the title contribute — `UserMovie`
      for a film, `UserShow` for a series, the same ownership rows the merge already walks. A user
      who does not own the title never affects its encode, whatever their preferences say. A title
      with no owners is unaffected by this feature and still falls through to original +
      `default_languages`.

- [ ] **REQ-4 (Resolved at encode time)**: The languages are resolved when the worker requests
      `encodeJobDetails`, not when the job is enqueued. The `process` queue payload gains no
      language field and no user field. A `/preferences` change made after a job was queued but
      before it was picked up must take effect on that job.

- [ ] **REQ-5 (Series behave as films)**: Both the movie branch and the episode branch of
      `getEncodeJobDetails` gain the contribution, on the same terms — a season pack's every episode
      job included.

- [ ] **REQ-6 (Per-title read surface unchanged)**: `Movie.audioLanguages`, `Movie.subtitleLanguages`
      and the `Show` twins must keep returning **only the calling user's own per-title list** for
      that kind. The merge stays exclusive to `getEncodeJobDetails`; no read surface starts showing
      other owners' preferences or the global list.

### Non-Functional & Operational Requirements

- [ ] **NFR-1 (One walk, not two merges)**: All four lists continue to be produced by a single pass
      building four `Set`s, the invariant `039-per-title-language-split` REQ-5 established. A second,
      parallel merge for the global preference — even one that looks equivalent — is a violation:
      two merges can drift so that the `Iso3` list and the `Tags` list disagree, which mismatches on
      the wire with no error in any service.

- [ ] **NFR-2 (Query count stays bounded)**: Resolving `encodeJobDetails` must not issue one query
      per owner. The global preferences of all owners are read in a single query, in keeping with a
      resolver the worker hits once per encode job (and once per episode of a season pack).

- [ ] **NFR-3 (No schema change, no migration, no backfill)**: `UserLanguagePreference` already
      exists with `@@id([userId, languageId, kind])` and is already written by
      `setPreferredTrackLanguages`. Nothing is added, migrated or backfilled; existing installations
      pick the behaviour up on their next encode.

- [ ] **NFR-4 (`039`'s boundary is retired in writing)**: `039-per-title-language-split`'s Out of
      Scope entry stating that these preferences have no encode-time reader is annotated as
      superseded by this spec — a reader arriving at `039` first must not be told the old rule.
      `services/api/CLAUDE.md` (§ `process-jobs/`, § `languages/`) and
      `docs/spec/graphql-contract.md` are updated wherever they state the old composition of the
      `allowed*` fields.

- [ ] **NFR-5 (Typecheck and tests)**: `bin/cli api npx --no tsc --noEmit` reports 0 errors and
      `bin/npm api test` reports no failures. `web` and `worker` are untouched by this feature and
      are not re-measured.

## GraphQL Contract Delta

**None — this feature does not cross the service boundary.**

`EncodeJobDetails` already carries the four fields this feature changes the *contents* of:

```graphql
type EncodeJobDetails {
  allowedAudioLanguagesIso3: [String!]!
  allowedAudioLanguageTags: [String!]!
  allowedSubtitleLanguagesIso3: [String!]!
  allowedSubtitleLanguageTags: [String!]!
}
```

Their names, types, nullability and cardinality are unchanged, no argument is added or removed, and
no new error condition exists — a user with no global preference simply contributes nothing, which
is the behaviour of every empty source already in the merge. `worker` needs no change and is not
told anything new: it keeps consuming the same four lists it has consumed since
`039-per-title-language-split`, routed to `getAudioParams`/`getSubtitleParams` as before. The lists
are simply no longer wrong.

| Condition | HTTP / GraphQL error | Message the user sees |
| :-- | :-- | :-- |
| — | — | No new error condition. |

## Data Model Changes

**None.** `UserLanguagePreference` (`user_language_preferences`, `@@id([userId, languageId, kind])`)
already exists from `021-user-preferences` and already holds the data; this feature adds a reader,
not a column. No migration, no backfill.

## Acceptance Criteria

- [x] **AC-1** *(unit-verified; end-to-end half pending the user's manual pass)*: Given a user who
      owns an English-original film, whose `/preferences` audio list is `en, es-419` and whose
      subtitle list is `en, es-419`, and who has set **no** per-title preference on that film, and
      given `default_languages` is empty — when the worker requests `encodeJobDetails` for that
      film's job, then `allowedAudioLanguagesIso3` is `["eng","spa"]`, `allowedAudioLanguageTags`
      contains `es-419`, and both subtitle lists match. Proven at the unit level by the AC-1 case in
      `process-jobs.service.spec.ts`, fault-injection-verified. **Still open**: the worker log line
      and the output file actually carrying both Spanish tracks — `plan.md` § Verification steps
      1–6, the user's own pass with a real source file.

- [x] **AC-2** *(failure path)*: Given a user whose global preference has `es-419` under `AUDIO`
      only and nothing under `SUBTITLE`, when the same job is resolved, then `es-419`/`spa` appears
      in the two audio lists and appears in **neither** subtitle list. A global audio preference
      must not silently widen the subtitle allow-list — that is the bug class `039` split the kinds
      to prevent, and it would surface only as an unexpected subtitle track in a finished file.
      Verified by the AC-2 case in `process-jobs.service.spec.ts`, fault-injection-verified.

- [x] **AC-3** *(failure path)*: Given a film owned by user A only, and a user B who owns nothing but
      has `fr` in both global lists, when the film's job is resolved, then no list contains `fra` or
      `fr`. An unowned title's encode must not be shaped by a stranger's preferences. Verified by the
      AC-3 case in `process-jobs.service.spec.ts`, fault-injection-verified.

- [x] **AC-4**: Given a film owned by two users, A with global audio `es-419` and B with global audio
      `pt`, plus a per-title audio override of `es-419` by A, when the job is resolved, then the
      audio lists contain the original plus `spa` and `por` exactly once each — the union is
      deduplicated across sources and across owners, and the per-title override neither replaces nor
      duplicates the global entry. Verified by the AC-4 case in `process-jobs.service.spec.ts`,
      fault-injection-verified.

- [x] **AC-5**: `bin/npm api test` reports no failures and includes new cases in
      `services/api/src/process-jobs/process-jobs.service.spec.ts` covering AC-1 through AC-4, each
      verified to fail when the contribution it covers is removed (the house fault-injection
      technique, Constitution Article IX). Confirmed independently: 342/342 tests, 36/36 suites, up
      from the 336/36 baseline by exactly the 6 cases added.

- [x] **AC-6**: `bin/cli api npx --no tsc --noEmit` reports 0 errors. Confirmed independently.

- [ ] **AC-7** *(pending the user's manual pass)*: Querying `movie(id:)` as user A returns in
      `audioLanguages`/`subtitleLanguages` only A's own per-title lists — unchanged by this feature,
      and in particular not showing A's global preference nor any other owner's entries (REQ-6). No
      code in `movies.service.ts`/`shows.service.ts` was touched by this feature, so the guarantee
      holds by construction, but confirming it live is `plan.md` § Verification step 6.

## Out of Scope

- **Seeding the global preference into `UserMovieLanguage`/`UserShowLanguage` when a title is
  registered.** `linkUserToMovie`/`linkUserToShow` keep creating the ownership row with no language
  rows. Copying at registration time would freeze the preference at the moment of registration and
  would need a backfill for every title already in the library; reading live at encode time achieves
  the same outcome with neither.

- **Filling the `default_languages` Setting.** It stays seeded empty, and an administrator setting
  it remains a valid installation-wide choice. It is a workaround for this bug, not its fix, and
  this feature deliberately does not change its seed or its unsplit contribution to both pairs.

- **The English fallback in `resolveOriginalLanguage`.** A TMDB `originalLanguage` with no matching
  `Language.tag` row still silently resolves to `{ tag: 'en', iso3: 'eng' }`. That is a second real
  gap — a non-English title mislabelled as English — but it is independent of this one and fixing it
  means deciding what an unknown language code *should* resolve to, which this spec does not decide.

- **Any precedence or inheritance rule between the global and the per-title lists.** `039` left this
  open deliberately; this spec answers it in exactly one direction — union, both contribute — and
  answers nothing about the *Audio mandatory* flags, which remain inert (`039` REQ-11).

- **Any change to which tracks `getAudioParams`/`getSubtitleParams` pick once the allow-list is
  fixed.** Same boundary `039` drew: this feature changes which list arrives at the worker, never
  the selection rule applied to it. `services/worker/` is not touched.

- **Surfacing the merged allow-list anywhere in `web`.** The result stays visible only in its effect
  on the encoded file, as it is today.

---
title: Global language preferences reach the encode merge — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-09-03
status: Implemented
---

# PLAN: Global language preferences reach the encode merge (`plan.md`)

## Approach

One reader is added to code that already exists. `ProcessJobsService.collectAllowedLanguages`
(`services/api/src/process-jobs/process-jobs.service.ts`) already walks every owner of the title and
folds their per-title rows into four `Set`s; this feature extends the *rows those owners arrive
with*, not the walk. `mergeMovieAllowedLanguages` and `mergeShowAllowedLanguages` each already issue
exactly one `findMany` over the ownership table (`userMovie` / `userShow`) with a `select` that
pulls `languages` — the per-title join. Both selects grow a second branch,
`user: { select: { userPreferences: … } }`, so each owner row carries its user's global preference
alongside its per-title one and the query count does not change (NFR-2). `collectAllowedLanguages`
then folds both lists inside the same loop iteration, into the pair matching each row's `kind`.

The relation name is `User.userPreferences` (`prisma/schema.prisma`, `UserLanguagePreference`
back-relation) — not `languages`, which on `User` is a different relation. Reading the wrong one
compiles and returns plausible rows, which is precisely the class of silent failure this merge is
prone to.

Two alternatives were considered and rejected:

- **A second `findMany` on `userLanguagePreference` keyed by `{ userId: { in: ownerIds } }`.** It
  works and stays one query, but it requires plumbing `userId` out of the owner select and re-joining
  the two result sets by hand — a second collection to keep aligned with the first, for no gain over
  letting Prisma do the join it is already doing.
- **Reusing `LanguagesService.findPreferredTrackLanguagesFor`.** It is the existing reader for this
  table, but it is `(userId, kind)`-scoped — one call per owner per kind, i.e. four queries for a
  two-owner title, against a resolver the worker hits once per episode of a season pack. It also
  drags a `LanguagesModule` import into `ProcessJobsModule` for a single `findMany`. The nested
  select stays cheaper and closer to the code it lives beside.

`ProcessJobsModule` gains no import, no dependency and no new method: the change is confined to the
two merge methods' `select` and to `collectAllowedLanguages`' loop body and signature.

## Order of Work

Single service. There is no sequencing problem and no consumer waiting on a contract.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns `getEncodeJobDetails` and the merge; nothing else in the repository reads or produces these four fields. |
| 2 | `docs` | The prose corrections (NFR-4) describe behaviour that must already be true when they are written. |

Nothing runs in parallel. `worker` and `web` are untouched — `worker` keeps consuming the same four
fields it has consumed since `039-per-title-language-split` and is not re-briefed, not re-typed and
not re-measured.

## Contract Freeze

`spec.md`'s `## GraphQL Contract Delta` is frozen as of `status: Approved`. It is deliberately
empty — **no schema change is authorised by this feature.** What an implementer will be tempted to
do and must not:

- **Add a field exposing where a language came from** (global vs per-title vs default). Nothing
  consumes it, `worker` would have to be re-typed by hand across two seams to receive it, and the
  merge is intentionally a flat union with no provenance (`039` § Out of Scope, "Reconciling the
  three flags with each other").
- **Split `default_languages`, or change its unsplit contribution to both pairs.** Out of scope
  since `039` NFR-4 and reaffirmed here.
- **Widen `Movie.audioLanguages` / `Movie.subtitleLanguages` or the `Show` twins** to include the
  global preference so the UI "matches" the encode. REQ-6 forbids it: those resolvers answer "what
  did *I* set on *this title*", and folding the global list in would make the `/preferences` screen
  and the title screen disagree about what a per-title override even is.
- **Add a precedence rule** where a per-title list replaces the global one. REQ-2 is a union. A
  narrowing rule is a different feature and needs its own spec.

If the contract turns out to be wrong: stop, amend `spec.md`, re-approve. Never patch it from inside
the slice (Constitution, Article VIII).

## Migrations

**None.** `UserLanguagePreference` (`user_language_preferences`, `@@id([userId, languageId, kind])`)
has existed since `021-user-preferences` and is already populated by `setPreferredTrackLanguages`.
No column is added, no row is rewritten, no backfill runs.

Reversibility: total. Reverting the diff restores the previous allow-list on the next encode, since
nothing is persisted from the merge — it is recomputed per `encodeJobDetails` call (REQ-4).

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| Wrong relation read on `User` (`languages` instead of `userPreferences`) | Both relations exist on `User`; the wrong one type-checks and returns rows, so the encode gets a plausible but wrong allow-list. No error anywhere. | The nested select is exercised by AC-1's test with a fixture whose global list differs from every other language in the case, so reading the wrong relation yields the wrong array, not an empty one. |
| Global `AUDIO` preference leaks into the subtitle pair | An unexpected subtitle track appears in a finished file. `ffprobe` is valid, the job succeeds, nothing logs. | AC-2 is a dedicated failure-path test; the fold reuses the existing `kind` branch rather than adding a second one. |
| Two merges drift (NFR-1) | A tag reaches `allowedAudioLanguageTags` but not `allowedAudioLanguagesIso3`. The worker matches on iso3 only, so the variant silently disappears at the collapse — exactly what `030`/`031` added the tag lists to prevent. | The fold happens inside the existing single walk over four `Set`s. A reviewer check: `collectAllowedLanguages` still has exactly one loop over owners and one `return` building all four arrays. |
| Ownership scope dropped from the new select | A user's preferences shape a title they do not own. Invisible until someone notices a stray language. | The global rows hang off the *existing* ownership `findMany` — there is no new `where` clause to get wrong. AC-3 covers it anyway, since the guarantee now depends on a join rather than on a filter. |
| Duplicate languages across owners or across levels | Not silent, but it would produce repeated entries the worker's rule functions then match twice. | The four `Set`s already deduplicate; AC-4 asserts it across two owners and across the global/per-title boundary. |
| Stale documentation (NFR-4) | The next agent reads `039` § Out of Scope or `services/api/CLAUDE.md` and reimplements the old rule, or "fixes" this one back. | The doc edits are tasks in this feature, not follow-up work: `039`'s entry gets a superseded annotation pointing here. |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
```

Both must be measured against the current baseline (`336` tests / `36` suites, `0` errors, recorded
2026-09-03) and re-recorded in `services/api/CLAUDE.md` § Current state, not cited from it.

Manual pass, which is the acceptance case that actually failed in the field:

1. As a user owning an English-original film, set `/preferences` audio and subtitle lists to English
   plus `es-419`, and leave that film's own language preferences empty.
2. Confirm `default_languages` is still empty in Settings → Descarga (the bug reproduces only when
   the installation default contributes nothing, and filling it is the workaround this feature
   replaces).
3. Trigger an encode of a source carrying Latin-American Spanish audio and subtitles.
4. In the worker log, the `[encode]` line must read `allowedAudioLanguagesIso3=["eng","spa"]` with
   `es-419` present in `allowedAudioLanguageTags`, and the same for the subtitle pair — not the
   `["eng"]` recorded in `spec.md` § Context.
5. `[ffmpeg] no text subtitle in an allowed language survived the rules.` must not appear, and the
   output file must carry both Spanish tracks.
6. Open the film's detail page and confirm its per-title language controls are still empty — the
   global preference reached the encode without being written back anywhere (REQ-6, AC-7).

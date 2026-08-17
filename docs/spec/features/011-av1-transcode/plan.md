---
title: AV1 Transcode — Implementation Plan
spec_version: 0.1.0
last_updated: 2026-08-17
status: Approved            # Draft | Approved | Implemented
---

# PLAN: AV1 Transcode (`plan.md`)

## Approach

The encode driver already exists and works. This feature does not rewrite it — it replaces the four
decision rules that feed it and adds the preference data those rules need.

The data side extends what is already there rather than inventing a parallel structure. `Language`
(`services/api/prisma/schema.prisma`) is already a seeded `iso2`/`iso3` table, and
`ProcessJobsService.resolveIso3` already uses it for exactly this purpose — turning the TMDB `iso2`
on `Movie`/`Show` into the `iso3` `ffprobe` reports. The three new join tables point at that table,
so the merge query of REQ-3 comes back in `iso3` with no second translation step and no new
vocabulary. Ownership is read through `UserMovie`/`UserShow`, the same joins
`MoviesService.findOneFromDb` and `ShowsService.findOneFromDb` already scope every read with.

The delivery side reuses the seam that already exists for exactly this shape of data:
`EncodeJobDetails` (`services/api/src/process-jobs/entities/encode-job-details.entity.ts`) is where
`api` hands the worker things it has already resolved — `outputRoot` from the path settings,
`originalLanguageIso3` from the `languages` table. `allowedLanguagesIso3` is one more field of that
kind and needs no new query, no new guard and no new `@AllowService()` grant.

Inside the worker, the three rule functions in `src/ffmpeg/params.ts` keep their signatures' shape
but stop building their own allow-list: `getAudioParams`/`getSubtitleParams` receive the resolved
list instead of deriving `[original, 'spa', 'eng']`, and `buildFfmpegCommand` decides `quality` from
the probe result instead of the input filename. Everything downstream of the argument array —
`runner.ts`, the working-path/part-path/rename sequence, the progress parsing — is untouched.

The alternative considered and rejected on the data side was a single `preferredLanguages` string
column (CSV or JSON) on `User`, `UserMovie` and `UserShow`. It is fewer tables, but the merge of
REQ-3 then has to happen in application code after fetching every owner's row and splitting strings,
and an `iso2` that is not a real language becomes unrepresentable-but-storable. Three join tables
with real foreign keys make the invalid state impossible and let the merge be one query.

The alternative considered and rejected on the UI side was putting the global preference into the
existing `SETTINGS_CATALOG`/`updateSettings` mechanism. It is one installation-wide value, and the
feature needs one value *per user* — a catalog key cannot express that. The picker lives on the same
`/settings` screen but as its own card with its own action, not as another `EDITABLE_KEYS` entry.

## Order of Work

`api` first, without exception: it owns the migration, the `languages` query the pickers read, and
the payload field the worker consumes. Neither consumer can be written against a schema that does
not exist yet, and `web` in particular has no codegen to warn it.

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the migration (three new tables), the `languages` query, the three mutations, the two field resolvers, and the `allowedLanguagesIso3` merge on the encode payload |
| 2 | `web` | Cannot render a picker against a `languages` query or a `preferredLanguages` field the schema does not have |
| 2 | `worker` | Cannot select the field on `processJob(id)` until it exists; a missing field is a GraphQL error, and `graphql-client.ts` throws on it |
| 3 | `docs` | `docs/spec/graphql-contract.md`, the three `CLAUDE.md` files, the Transcode row in the root table |

**Steps 2 run genuinely in parallel.** `web` and `worker` touch disjoint files, consume disjoint
parts of the contract, and neither reads the other's output. They may only start once `api` has
landed and the contract is frozen — which it is, as of this file's `status: Approved`.

Within step 1, the migration must land before the resolvers: `prisma generate` has to have run for
the new models to exist on the client.

## Contract Freeze

The `## GraphQL Contract Delta` in `../spec.md` is frozen as of `status: Approved`. Four things in
it will look wrong from inside one service and are right for the feature as a whole:

- **`allowedLanguagesIso3` is ISO-639-2, while every preference is stored and displayed as
  ISO-639-1.** From inside `web` this looks like a pointless second vocabulary; from inside `api`
  it looks like leaking a worker concern into the payload. It is neither: `ffprobe` reports
  `tags.language` in `iso3` and TMDB supplies `originalLanguage` in `iso2`, so the translation has
  to happen somewhere, and `api` is the only service with the `languages` table (Article III). Do
  not "simplify" the field to `iso2` on either side.
- **`originalLanguageIso3` stays on the payload even though it is always the first element of
  `allowedLanguagesIso3`.** It looks redundant. It is what makes REQ-6 checkable: the worker must
  know *which* of the allowed languages is the mandatory one, and inferring it from list position
  is a rule that breaks the first time someone sorts the list.
- **`Movie.preferredLanguages`/`Show.preferredLanguages` return the calling user's own list, not
  the merged set.** From inside `api` the merge is right there and returning it is one line. It
  would leak another user's choices into `web`, and it would make the picker show values the user
  cannot unset. The merge exists only inside `getEncodeJobDetails`.
- **`setPreferredLanguages` takes no user argument.** From inside the admin `/users` surface
  (`003-auth-user-management`) that looks like a missing capability. It is self-service by design;
  an admin editing someone else's languages is listed Out of Scope in the spec.

If any of this turns out to be wrong mid-flight: stop, amend `../spec.md`, re-approve, and re-brief
all three services. Never patch it from inside one slice (Article VIII).

## Migrations

One additive migration, owned by `api`. No `ALTER` on a populated table, so nothing can fail
halfway on existing data.

1. `add_language_preferences` — `CREATE TABLE user_languages`, `user_movie_languages`,
   `user_show_languages`. Composite primary keys, foreign keys to `languages` and to the existing
   ownership rows, `ON DELETE CASCADE` throughout. Generated through
   `bin/npm api run prisma:migrate`, never hand-written (Article III).
2. Backfill: **none**. Absence of a row is the correct default for every user and every title —
   "no preference" means the encode keeps only the original language, which is REQ-1's stated
   zero case.

Reversibility: fully reversible by dropping the three tables. Nothing outside the feature reads
them; `Movie`, `Show`, `User`, `UserMovie`, `UserShow` and `Language` are untouched. Rolling back
after `web` and `worker` have shipped leaves `languages`/`preferredLanguages` resolving against
missing models — roll the whole feature back, not the migration alone.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| **ISO-639-2/B vs /T** — the seed stores `fre`, `ger`, `chi`, `dut`, `cze`; Matroska files commonly tag those tracks `fra`, `deu`, `zho`, `nld`, `ces` | A French track is present, the user asked for French, the codes never compare equal, the track is dropped. Encode succeeds. No error anywhere, and the user only finds out while watching | `worker` normalizes both sides through a `/B`↔`/T` alias table before comparing (worker slice, step 4). It is a pure function with a spec — the five affected pairs are enumerated in `worker/plan.md`. No contract change: the alias table is worker-local |
| **`iso2` sent where `iso3` is expected** | Every extra language silently vanishes; the output has exactly one audio track and the job reports success | The field name says `Iso3`; `api`'s merge selects `language.iso3` from the join, never `iso2`; AC-1 counts four audio streams by tag, which fails loudly if this regresses |
| **`avg_frame_rate` parsed wrong** — `ffprobe` reports it as the string `"24000/1001"`, not a number | `Number("24000/1001")` is `NaN`, bits-per-pixel is `NaN`, `NaN >= 0.25` is false, so *every* file classifies as non-remux and silently gets CRF 24 forever | Owed a test (`worker/plan.md` § Tests): a probe fixture with a rational frame rate must produce CRF 22 on a real remux. This is the archetypal Article IX bug — a wrong number, no error, a worse file |
| **The removed copy-all fallback** turns previously-succeeding encodes into failures | Files whose original-language track is absent or mistagged now end `FAILED` where they used to produce a (wrong) output | Intended, and it is REQ-6. The mitigation is the message: it must name the missing `iso3`, so the user can see it is a tagging problem and not a crash. AC-4 checks the row |
| **N+1 on the library listings** — `preferredLanguages` as a field resolver on `Movie`/`Show` | 200 films in a listing become 200 preference queries; no error, just a slow page | `web`'s listing queries (`getMovies`/`getShows`) must not select the field, and the detail queries must. Stated in `web/plan.md`; a field resolver only runs when selected |
| **Contract drift with no compiler** — `EncodeJobDetails` is retyped by hand in `worker/src/jobs/encode.job.ts` *and* in `worker/src/encode/types.ts` | The worker asks for a field it did not add to its local type, or forwards `undefined` into the rule functions. `undefined.length` throws mid-encode, or worse, an empty array silently means "original only" | Both files named explicitly in `worker/plan.md` § Files, and the worker slice is done only when a real encode produces the AC-1 stream count |
| **Ownership row absent** — a `Movie` with no `UserMovie` (orphaned by a deleted user) | The merge returns an empty owner set | Falls through to `{original}`, which is the correct and safe result. No special case needed; called out here so nobody adds one |

## Verification

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
bin/cli worker npx --no tsc --noEmit
bin/npm worker test
bin/cli web npx --no tsc --noEmit
```

Expected: `api` 0 errors and its suite green (104 tests across 11 suites before this feature — the
number must go up, never down); `worker` 0 errors with the new `params`/`buildCommand` specs
passing; `web` exactly 11 errors across the 4 known files and not one more
(`services/web/CLAUDE.md` § Current state).

Schema regeneration is the Article VIII check:

```bash
git diff services/api/src/schema.gql
```

Expected: the diff contains exactly the types, fields and mutations in `../spec.md` §
GraphQL Contract Delta — `Language`, `languages`, `preferredLanguages` on `User`/`Movie`/`Show`, the
three `set*PreferredLanguages` mutations, `allowedLanguagesIso3` on `EncodeJobDetails`. Anything
else is an unreported contract change.

Then the manual pass, with the stack up (`bin/dev`):

1. Sign in, open `/settings`, pick two languages in the new card, save. Reload — both still
   selected. Confirm the rows landed: `bin/mysql -e 'select * from user_languages'` (AC-9).
2. Open a series at `/shows/<id>`, add a third language for that title only, save, reload.
   Sign in as a second user who also owns it — their picker is empty (AC-10).
3. Queue a real encode of a file with several audio tracks. While it runs,
   `docker compose logs -f worker` shows the assembled command; check its `-crf` against the
   source's nature (AC-5, AC-6, AC-7) and its `-map` count against the merged preference (AC-1).
4. `ffprobe` the output: audio stream count and language tags match, subtitle streams are text-only
   (AC-1, AC-2, AC-8).
5. The failure path: point a `ProcessJob` at a file with no original-language audio and confirm
   `bin/mysql -e 'select status, errorMessage from process_jobs order by id desc limit 1'` shows
   `ERROR` and a message naming the `iso3`, and that no file appeared under the library root (AC-4).

`ENCODE_SAMPLE_SECONDS` in `.env` keeps steps 3–5 to seconds instead of hours; it is already read by
`encode.ffmpeg.ts` and `buildCommand.ts`.

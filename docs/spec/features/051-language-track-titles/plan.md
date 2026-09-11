---
title: Language track titles move to the database — Implementation Plan
spec_version: 0.2.0
last_updated: 2026-09-10
status: Implemented
---

# PLAN: Language track titles move to the database (`plan.md`)

## Approach

The feature deletes one literal and replaces it with one query. Everything else is plumbing that
already exists and must be reused rather than reinvented.

On `api`, the title is a nullable column on the existing `Language` model, and the query that
publishes it is a method on the existing `LanguagesService` behind the existing `LanguagesResolver`
— no new module, no second Prisma access path. The collapse from `tag` to `iso3` happens there,
inside `findAll()`'s neighbour, using the same base-row rule (`tag === iso2`) `findAll()` already
applies for a different purpose. That rule is the whole reason `trackTitles` is a separate query and
not a field on `Language`: `findAll()` *hides* the base `es` row from the pickable catalog, and the
base `es` row is precisely the one carrying `Español`. Adding the field to `Language` would have
published the title on every row except the one the worker most needs.

On `worker`, the map travels the same seam `046-encode-metadata-tags` already cut for
`containerTitle`/`sourceTag`: a field on `EncodeInput` (`src/encode/types.ts`), filled once in
`handleEncode`, passed through `buildFfmpegCommand` into `getAudioParams`/`getSubtitleParams`, and
read by `trackLanguageTitle`. `trackLanguageTitle` keeps its exact shape — variant first, then
`map[normalizeIso3(lang)] ?? lang` — with the map arriving as an argument instead of closing over a
module constant.

The alternative considered and rejected on the worker side was a module-level cache in `params.ts`
that `handleEncode` populates once at startup. It would have avoided threading a parameter through
three functions, but it makes `getAudioParams` depend on hidden mutable state set by a different
module: two tests running in either order would see different tables, and the exact silent failure
this feature exists to prevent (a track quietly titled `jpn`) would become order-dependent and
untestable. Passing it as data keeps every unit pure, which is what `params.spec.ts` already relies
on.

## Order of Work

| Step | Service | Why it must come here |
| :-- | :-- | :-- |
| 1 | `api` | Owns the column, the migration and the backfill (Article III). Nothing can read a field the schema does not have |
| 2 | `api` | Exposes `trackTitles`. The worker cannot be verified against a query that does not answer |
| 3 | `worker` | Consumes the query and deletes `languageTitles` |
| 4 | `docs` | `docs/spec/graphql-contract.md` § "Language preferences drive the encode payload…" gains the `trackTitles` paragraph. Orchestrator task — it is not inside any service directory |

Steps 1–2 and step 3 **may overlap** once `status: Approved` freezes the contract: the worker's unit
tests inject the map as a fixture and never reach the network, so its whole slice is testable before
`api` answers. What cannot overlap is verification — AC-3, AC-4 and AC-7 are end-to-end and need
step 2 merged and the container restarted.

## Contract Freeze

The `## GraphQL Contract Delta` in `spec.md` is frozen as of `status: Approved`. Three things an
implementer will be tempted to change and must not:

- **`trackTitles` is keyed by `iso3`, not by `tag`.** From inside `api` this looks like it discards
  information the table has, and a `tag` field looks free to add. It is not free: the worker only
  ever holds an `iso3` (`ffprobe` reports `tags.language` in ISO-639-2), so a `tag` on the response
  would be a field with no reader and a second, ambiguous lookup key for the next person.
- **Both fields are non-null, and a row without a title contributes no entry.** From inside `api` a
  nullable `title` mirrors the nullable column more faithfully. It also gives the worker two ways to
  spell "no title" — absent, and present-but-null — where it needs one, and the one it needs is
  already the `?? lang` case it has handled since `011`.
- **`Language` is not touched on the GraphQL surface.** The column exists; the field does not. Do
  not add `trackTitle` to `language.entity.ts`. `languages` stays the pickable catalog `web`
  renders, and the two consumers stay separable.

If the contract turns out wrong: stop, amend `spec.md`, re-approve, re-brief both services. Never
patch it from inside one slice (Article VIII).

## Migrations

1. `add_language_track_title` — `ALTER TABLE languages ADD COLUMN trackTitle VARCHAR(191) NULL`,
   generated from the `schema.prisma` change through `bin/npm api run prisma:migrate` (Article III —
   never hand-written schema SQL).
2. Backfill, in the same migration file, appended after the generated `ALTER`: 20 `UPDATE languages
   SET trackTitle = ? WHERE tag = ?` statements, one per REQ-2 row. `es-419` and `es-ES` are
   deliberately not among them (REQ-6).

The backfill lives in the migration rather than in the seed because `seeds/languages.ts` is
find-then-create and **skips rows that already exist** — on every installation that already has its
22 rows, a re-run of the seed would write nothing at all, and NFR-1 would silently not happen. The
seed's own array gains the `trackTitle` values too, so a fresh database gets them at create time;
the two paths converge because the migration's `UPDATE` is a no-op against a table the seed has not
filled yet, and the seed's `create` is a no-op against rows the migration already updated.

Reversibility: dropping the column is safe and loses only the titles. The worker's REQ-8 fallback
means a rolled-back `api` in front of a new worker produces bare ISO codes on the next encode, not
a failure.

## Risks

| Risk | How it fails | Mitigation |
| :-- | :-- | :-- |
| The `latin1` default charset of the `languages` table mangles `日本語`/`한국어`/`Русский` on write | No error at any layer. The column accepts the bytes, the query returns them, and the muxed file carries mojibake nobody sees until a track selector is opened | Verify explicitly after the migration: `bin/mysql -e "select tag, trackTitle from languages where tag in ('ja','ko','ru','ar')"` must print the native script, not `?????`. If it does not, the column needs `utf8mb4` before the backfill, not after — a second `UPDATE` over mangled bytes does not recover them |
| The `tag → iso3` collapse picks a variant row over the base row | `es-ES` carries no title (REQ-6), so picking it yields *no* `spa` entry at all and every Spanish track silently titles `spa` | Owed a unit test in `languages.service.spec.ts` asserting `spa → 'Español'` against the three-row fixture — the single most likely wrong answer in this feature |
| The worker cannot reach `api` for the map | Every track titles with its bare ISO code, on a two-hour encode, with nothing in the log saying why | REQ-9 makes this deliberate rather than accidental, and the worker logs the empty map explicitly at job start so the degraded run is visible in `bin/cli worker` output |
| A future seed row stores an ISO-639-2/**T** code | `normalizeIso3` canonicalizes the worker's side to /B, so a /T-keyed entry never matches and falls back silently | REQ-7 states `api` publishes the /B form it seeds; the `fre`/`fra` case is owed a test on the worker side (AC-4) |
| `languageTitles` is deleted but a caller keeps a stale copy | Not silent — TypeScript fails the build | None needed; `bin/cli worker npx tsc --noEmit` is the check |

## Verification

```bash
bin/npm api run prisma:migrate
bin/cli api npx tsc --noEmit
bin/npm api test
bin/mysql -e "select tag, iso3, trackTitle from languages order by tag"
bin/cli worker npx tsc --noEmit
bin/npm worker test
```

`bin/npm worker test` is expected to report two **pre-existing, unrelated** failures inherited from
before this feature — a stale track-title string in the `ffmpeg/2.json` corpus fixture and a CRF
mismatch in `buildCommand.spec.ts`, both recorded in the root `CLAUDE.md` under `047-source-deletion`.
Confirm they are the same two and that the count did not grow; do not fix them here.

Manual pass, after `bin/dev` is back up:

1. Query `trackTitles` from `api` and count 20 entries, `jpn → 日本語` and `spa → Español` among them,
   no entry whose title is `Latino` or `Español (España)` (AC-1).
2. Run an encode of a file with a Japanese or Korean audio track and read the resulting
   `-metadata:s:a:N title=` in the worker log, then `ffprobe` the output file itself (AC-3).
3. Stop `api`, start an encode from an already-queued job, and confirm the output's track titles are
   bare ISO codes and the job still reaches `COMPLETED` (AC-5).
4. Encode a release whose Spanish track is marked Latin American and confirm the title is `Latino`,
   not `Español` (AC-7).

Before any of this: the working tree carries an uncommitted edit to
`services/worker/src/ffmpeg/params.ts` (adding `jpn`/`kor`/`fre` to the literal this feature
deletes) and a matching edit to `params.spec.ts`. Revert both first —
`git checkout -- services/worker/src/ffmpeg/params.ts services/worker/src/ffmpeg/params.spec.ts` —
so the diff of this feature is the change it claims to be.

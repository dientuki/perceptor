---
title: Language track titles move to the database — Tasks
last_updated: 2026-09-10
status: Done
---

# TASKS: Language track titles move to the database (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[worker]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[ffmpeg]` | The `ffmpeg` agent (`.claude/agents/ffmpeg.md`), which owns `services/worker/src/ffmpeg/` and `services/worker/ffmpeg/`. **Not in the standard vocabulary** — see the note below; using `[worker]` for these would dispatch them to an agent whose brief forbids those two directories. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

> **On the `[ffmpeg]` tag.** `.claude/commands/tasks.md` lists `[api] [web] [worker] [infra] [docs]`,
> but `services/worker/CLAUDE.md` states that `src/ffmpeg/` and `ffmpeg/` are owned by the `ffmpeg`
> agent and not by the `worker` agent. The precedent is `024-retire-gpu-tonemap-strategy` and
> `046-encode-metadata-tags`, both of which split a worker feature the same way.
> `/implement` must dispatch `[ffmpeg]` to the `ffmpeg` agent.

A task is one coherent change an agent can finish and verify on its own. If it cannot be checked
off without also doing something in another service, it is scoped wrong — split it.

## Tasks

### Group 1 — schema, migration and backfill

- [x] **T001** `[api]` Add `trackTitle String?` to `model Language` in `prisma/schema.prisma`,
      generate the migration through `bin/npm api run prisma:migrate` named
      `add_language_track_title`, and append the 20 `UPDATE languages SET trackTitle = … WHERE tag =
      …` statements from `spec.md` REQ-2 to the **generated** `migration.sql`. Nothing for `es-419`
      or `es-ES` (REQ-6). Write the native scripts as literal UTF-8.
      *Done when:* `bin/mysql -e "select tag, iso3, trackTitle from languages order by tag"` prints
      the native script for all 20 base rows — `日本語`, `한국어`, `Русский`, `العربية`, `ไทย`,
      `हिन्दी` legible, not `?????` — and `NULL` for `es-419` and `es-ES`. If any row is mojibake,
      **stop and report**: the column charset is not `utf8mb4`, and a second `UPDATE` over mangled
      bytes does not recover them.
- [x] **T002** `[api] [P]` Add the matching `trackTitle` values to the 20 base entries of the
      `languages` array in `prisma/seeds/languages.ts`. Leave the find-then-create loop unchanged;
      `es-419`/`es-ES` get no value. → T001
      *Done when:* `bin/dbreset` followed by the `select` from T001 produces the identical 20 rows,
      proving a fresh install and an upgraded install converge (NFR-1).

### Group 2 — the query

- [x] **T003** `[api] [P]` Add `src/languages/entities/language-track-title.entity.ts` (`iso3`,
      `title`, both non-null), `findTrackTitles()` on `LanguagesService` — keeping only rows with a
      non-empty `trackTitle`, and where several share an `iso3`, the base row (`tag === iso2`), the
      same rule `findAll()` already applies — and the `trackTitles` query on `LanguagesResolver`. No
      `@Public()`, no module change, and **no** `trackTitle` field on `language.entity.ts`. → T001
      *Done when:* after an `api` restart, the regenerated `src/schema.gql` contains
      `type LanguageTrackTitle` and `trackTitles: [LanguageTrackTitle!]!` and `type Language` is
      byte-identical to before; querying `trackTitles` returns 20 entries.
- [x] **T004** `[api]` Extend `src/languages/languages.service.spec.ts` for `findTrackTitles()`:
      three rows sharing `iso3: 'spa'` collapse to one entry carrying the base row's `Español`;
      `es-419`/`es-ES` never appear as entries of their own; a `null` `trackTitle` produces no entry
      rather than an empty one; the seeded set yields 20 entries with `jpn → 日本語`,
      `kor → 한국어`, `fre → Français`. → T003
      *Done when:* `bin/npm api test` is green and the `spa` collapse case fails if the rule is
      inverted to prefer a variant row — that is the silent bug this test exists for.

### Group 3 — the worker consumers

Everything here depends on Group 2: the contract must exist before anyone consumes it.

- [x] **T005** `[ffmpeg]` Revert the two uncommitted working-tree edits that add `jpn`/`kor`/`fre`
      to the literal this feature deletes:
      `git checkout -- services/worker/src/ffmpeg/params.ts services/worker/src/ffmpeg/params.spec.ts`.
      *Done when:* `git status --short services/worker/src/ffmpeg/` prints nothing.
- [x] **T006** `[worker] [P]` Add `src/api/track-titles.ts` — `fetchTrackTitles()` querying
      `{ trackTitles { iso3 title } }` through the existing `fetchGraphQL`, folding the list into a
      `Record<string, string>`, returning `{}` on any thrown error and logging one `console.warn`
      naming the ISO-code fallback — plus `src/api/track-titles.spec.ts` covering the fold and the
      rejecting-client case. No retry, no timeout, no second client. → T003
      *Done when:* `bin/npm worker test` shows both new cases green, and the rejecting case asserts
      `fetchTrackTitles` resolves to `{}` rather than throwing (REQ-9, AC-5).
- [x] **T007** `[worker]` Add `trackTitles: Record<string, string>` (required, not optional) to
      `EncodeInput` in `src/encode/types.ts`, call `fetchTrackTitles()` once in `handleEncode`
      (`src/jobs/encode.job.ts`) after the `processJob` query, and pass the result into the
      `EncodeInput` literal at **both** the `passthrough` and the `encode` call sites. → T006
      *Done when:* `bin/cli worker npx tsc --noEmit` is 0 errors and
      `grep -c "trackTitles:" services/worker/src/jobs/encode.job.ts` returns 2 — one call site
      missed means a compression-disabled install silently loses its titles.
- [x] **T008** `[ffmpeg]` In `src/ffmpeg/params.ts`, delete the `languageTitles` literal and its
      comment, give `trackLanguageTitle` a map parameter, and thread it through `getAudioParams` and
      `getSubtitleParams`; in `src/ffmpeg/buildCommand.ts`, forward `details.trackTitles` into both.
      Resolution order stays byte-identical — variant first, then `map[normalizeIso3(lang)] ?? lang`.
      `variants.ts` and `iso639.ts` are **not** touched. New code carries no comments (Article XI).
      → T005, T007
      *Done when:* `grep -rn "languageTitles" services/worker/src` returns nothing and
      `bin/cli worker npx tsc --noEmit` is 0 errors (AC-3).
- [x] **T009** `[ffmpeg]` Update the three affected spec files: give `cases.spec.ts` a shared fixture
      holding the 20 seeded pairs (test data mirroring `api`, never back in `params.ts`), read
      `trackTitles` from a case's JSON when present and fall back to that fixture, add the field to
      `buildCommand.spec.ts`'s fixtures, and extend `params.spec.ts` with: an injected map titling a
      `jpn` track `日本語 Stereo (Opus)` (AC-3); a source tagged `fra` resolving the `fre` key (AC-4);
      an empty map titling every track with its bare ISO code (AC-5/AC-6); and a Latin-American-marked
      Spanish track still titling `Latino` **while** `spa → Español` is in the map (AC-7). → T008
      *Done when:* `bin/npm worker test` reports exactly the two pre-existing failures recorded in
      the root `CLAUDE.md` under `047-source-deletion` (the stale `ffmpeg/2.json` track-title string
      and the `buildCommand.spec.ts` CRF mismatch) and no others. If the count grew, report rather
      than fixing territory this feature does not own.

### Group 4 — verification and docs

- [x] **T010** `[docs] [P]` Add the `trackTitles` paragraph to `docs/spec/graphql-contract.md` § "Language
      preferences drive the encode payload, in two different ISO vocabularies", stating that it is
      keyed by `iso3` rather than `tag`, that `api` performs the collapse, that a language with no
      title is an absent entry, and that it is a separate query from `languages` precisely because
      `findAll()` hides the base `es` row the worker needs.
- [x] **T011** `[docs] [P]` Update the three stale documents: `.claude/agents/ffmpeg.md` § L2 — the
      title table is no longer worker-local or "incomplete on purpose", it is the `Language` rows and
      a new language's title is added to the seed, not to `params.ts`, while the four variant rows in
      its table still come from `variants.ts`; `services/worker/CLAUDE.md:203` — `src/ffmpeg/` no
      longer owns "the table of track titles written to the output"; and the root `CLAUDE.md`
      Transcode row — the stage now reads titles from `api` once per job and degrades to ISO codes
      when it cannot.
- [x] **T012** `[docs]` Run the full gate (`bin/cli api npx tsc --noEmit`, `bin/npm api test`,
      `bin/cli worker npx tsc --noEmit`, `bin/npm worker run build`, `bin/npm worker test`) and the
      manual pass in `plan.md` § Verification: 20 entries from `trackTitles` with no `Latino` or
      `Español (España)` among them (AC-1); the `select` after the migration (AC-2); a Korean-audio
      encode `ffprobe`d to read `한국어 Stereo (Opus)` (AC-3); `api` stopped mid-queue and the job
      still reaching `COMPLETED` with bare ISO titles (AC-5); a Latin-American release still titling
      `Latino` (AC-7). Then tick every acceptance criterion in `spec.md`, record the new test counts
      in the root `CLAUDE.md` § Current state, and set `status: Implemented` on `spec.md`, `plan.md`,
      `api/plan.md` and `worker/plan.md`. → T004, T009, T010, T011

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.

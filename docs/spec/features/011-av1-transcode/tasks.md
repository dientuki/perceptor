---
title: AV1 Transcode — Tasks
last_updated: 2026-08-17
status: Draft            # Draft | In Progress | Done
---

# TASKS: AV1 Transcode (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[infra]`/`[orch]` tasks. This feature changes no `bin/` script, no `docker-compose.yaml`, no
Dockerfile and no `.env.example` key — `ENCODE_DRIVER`, `ENCODE_SAMPLE_SECONDS` and
`ENCODE_MOCK_SECONDS` already exist and keep their current meaning.

## Tasks

### Group 1 — `api`: schema, then the contract

T001 is the gate for everything else in this group: the three models must exist on the Prisma client
before any resolver can reference them. Within the group, T004–T007 are independent of each other —
they touch four different resolvers and share only the service T003 produces.

- [ ] **T001** `[api]` Add `UserLanguage`, `UserMovieLanguage` and `UserShowLanguage` to
      `prisma/schema.prisma` (composite PKs, `onDelete: Cascade`, `@@map` to `user_languages` /
      `user_movie_languages` / `user_show_languages`; the two per-title tables reference
      `UserMovie`/`UserShow` through their composite FK, not `User` and `Movie` separately), then
      generate the migration with `bin/npm api run prisma:migrate` named `add_language_preferences`.
      No backfill.
      *Done when:* `git status services/api/prisma/` shows both a modified `schema.prisma` **and** a
      new migration directory (Article III's check); `bin/mysql -e 'show tables'` lists the three
      new tables; `bin/cli api npx --no tsc --noEmit` reports 0 errors.
- [ ] **T002** `[api]` Create `src/languages/` — `entities/language.entity.ts` (`id`, `iso2`,
      `iso3`, `name`), `language-names.ts` (Spanish display names for all 20 seeded `iso2` codes),
      `languages.service.ts` with `findAll()`, `languages.resolver.ts` with the `languages` query,
      and `languages.module.ts` exporting the service. Register in `src/app.module.ts`. → T001
      *Done when:* the regenerated `src/schema.gql` contains `type Language { id: ID! iso2: String!
      iso3: String! name: String! }` and `languages: [Language!]!`; querying `languages` through the
      playground returns 20 rows, each with a non-empty Spanish `name`.
- [ ] **T003** `[api]` Add the preference read/write methods to `LanguagesService`: one write per
      target (user / user+movie / user+show), each validating every `iso2` against `languages`,
      rejecting duplicates within one argument, and replacing the whole set in a transaction
      (`deleteMany` + `createMany`); plus one read per target returning the caller's own rows. Write
      `src/languages/languages.service.spec.ts` per `api/plan.md` § Tests. → T002
      *Done when:* `bin/npm api test` is green with the new suite, and each of its four cases
      (replace removes the old rows / `[]` clears / unknown `iso2` throws *before* deleting /
      duplicated `iso2` throws) has been verified to fail when the rule it covers is removed.
- [ ] **T004** `[api] [P]` Add `setPreferredLanguages(iso2: [String!]!)` to `LanguagesResolver`
      (reads `@CurrentUser()`, takes **no** user argument) and a `@ResolveField()` for
      `User.preferredLanguages` on `src/auth/auth.resolver.ts`, declaring the field on
      `src/users/entities/user.entity.ts`. → T003
      *Done when:* `src/schema.gql` shows the mutation and `preferredLanguages: [Language!]!` on
      `User`; a `me { preferredLanguages { iso2 } }` query returns what
      `setPreferredLanguages(iso2: ["es","pt"])` just saved, and `bin/mysql -e 'select * from
      user_languages'` shows exactly two rows.
- [ ] **T005** `[api] [P]` Add `setMoviePreferredLanguages(movieId: Int!, iso2: [String!]!)` and a
      `@ResolveField()` for `Movie.preferredLanguages` to `src/movies/movies.resolver.ts`, declaring
      the field on `src/movies/entities/movies.entity.ts`. The mutation calls the existing
      `MoviesService.findOneFromDb(id, userId)` first and propagates its refusal unchanged. → T003
      *Done when:* `src/schema.gql` shows both; the mutation on a film the caller does not own is
      refused with the existing `La película <id> no existe` (not a new string); `movie(id) {
      preferredLanguages { iso2 } }` returns the caller's own list and **not** another owner's.
- [ ] **T006** `[api] [P]` The same for series: `setShowPreferredLanguages(showId: Int!, iso2:
      [String!]!)` and a `@ResolveField()` for `Show.preferredLanguages` on
      `src/shows/shows.resolver.ts` + `src/shows/entities/show.entity.ts`, guarded by
      `ShowsService.findOneFromDb`. Keep the `movies`/`shows` structural symmetry — do **not**
      factor T005 and T006 into a shared base class. → T003
      *Done when:* `src/schema.gql` shows both; an unowned series is refused with the existing
      `Recurso no disponible para este usuario`; `show(id) { preferredLanguages { iso2 } }` returns
      the caller's own list.
- [ ] **T007** `[api] [P]` Build the REQ-3 merge in `ProcessJobsService.getEncodeJobDetails` and add
      `allowedLanguagesIso3: [String!]!` to
      `src/process-jobs/entities/encode-job-details.entity.ts`. Original language first (via the
      existing `resolveIso3`), then the union of every owner's global and per-title preference,
      deduplicated, selecting `language.iso3` and never `iso2`. Owners come from `UserMovie` for a
      film and from `UserShow` on `episode.season.showId` for an episode. Write
      `src/process-jobs/process-jobs.service.spec.ts` per `api/plan.md` § Tests. → T001
      *Done when:* `src/schema.gql` shows the field on `EncodeJobDetails`; the new suite is green
      with all five cases, and the case asserting `iso3` output has been verified to fail when the
      select is switched to `iso2`; a title with two owners and different preferences returns their
      union; a title with no owners returns exactly one element.

### Group 2 — consumers

Everything here except T008 depends on Group 1: the contract must exist before anyone selects it,
and `worker/src/api/graphql-client.ts` throws on a GraphQL error, so a field selected before it
exists fails the job rather than degrading. **T008 has no `api` dependency at all** — remux
detection and the ISO alias table are worker-local pure functions and may start immediately, in
parallel with Group 1.

The `worker` chain (T008 → T009 → T010 → T011) and the `web` chain (T012 → T013/T014/T015) are
independent of one another and run in parallel once their `api` dependencies have landed.

- [ ] **T008** `[worker] [P]` Create `src/ffmpeg/iso639.ts` (`normalizeIso3`, mapping the ISO-639-2
      /B↔/T pairs — `fre`/`fra`, `ger`/`deu`, `chi`/`zho`, `dut`/`nld`, `cze`/`ces` among the 20
      seeded) and `src/ffmpeg/remux-detection.ts` (`isRemux(metadata)` per REQ-10: lossless audio,
      or bits-per-pixel-per-frame ≥ 0.25 from `bit_rate` → `tags.BPS` → `format.size/duration`,
      parsing `avg_frame_rate` as a **rational string**, filename only when no bitrate is
      computable). Write `src/ffmpeg/remux-detection.spec.ts`.
      *Done when:* `bin/npm worker test` is green with the new suite, and the case for a 30 Mbps
      1080p stream at `avg_frame_rate: "24000/1001"` has been verified to **fail** against a
      `Number(avg_frame_rate)` implementation — that mistake makes every file classify as non-remux
      with no error anywhere; `bin/cli worker npx --no tsc --noEmit` reports 0 errors.
- [ ] **T009** `[worker]` Plumb the new payload field: add `allowedLanguagesIso3: string[]` to
      `EncodeJobDetails` in `src/jobs/encode.job.ts`, add it to that file's `processJob(id)` GraphQL
      document, add it to `EncodeInput` in `src/encode/types.ts`, and forward it in the `encode(...)`
      details object. **All three edits, or the field arrives `undefined` and the rules silently
      behave as "original only".** → T007
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports 0 errors and a real job logs a
      non-empty list (`docker compose logs worker`) rather than `undefined`.
- [ ] **T010** `[worker]` Rewrite the three rule functions in `src/ffmpeg/params.ts`: restore
      `getQuality`'s `if (!isLiveAction) return "20"` branch (deleting the commented-out copy);
      change `getAudioParams`/`getSubtitleParams` to take the resolved allow-list plus the mandatory
      original instead of deriving `[original, 'spa', 'eng']`, comparing both sides through
      `normalizeIso3`; **remove the copy-all fallback** and throw `El archivo no tiene ninguna pista
      de audio en el idioma original (<iso3>)` instead. Keep the blacklist, the `latin`/`latino`
      narrowing, the codec→channels→bitrate ranking, the Opus emission, the subtitle text-codec /
      `BPS > 2` / title-replacement rules. Write `src/ffmpeg/params.spec.ts`. → T008, T009
      *Done when:* `bin/npm worker test` green with the new suite covering all ten cases in
      `worker/plan.md` § Tests, including a `fra`-tagged track matching an allowed `fre`, a file
      with no original-language track throwing with the `iso3` in the message, and PGS subtitles
      producing zero subtitle arguments (AC-8).
- [ ] **T011** `[worker]` In `src/ffmpeg/buildCommand.ts`, replace the filename-based `isRemux` with
      `isRemux(metadata)` and forward `details.allowedLanguagesIso3` into both rule functions. The
      argument order in the assembled array does not change. Write
      `src/ffmpeg/buildCommand.spec.ts`. → T008, T010
      *Done when:* `bin/npm worker test` green; `isLiveAction: false` yields `-crf 20` even on a
      remux (AC-7), a live-action remux yields `-crf 22` (AC-5), a live-action web-DL yields
      `-crf 24` (AC-6), and `ENCODE_SAMPLE_SECONDS` still appends `-t`.
- [ ] **T012** `[web]` Create `src/types/languages.ts` (`Language`) and `src/actions/languages.ts`
      with `getLanguages()` (`redirectToClearSession` — it is awaited during a Server Component
      render) and the three save actions (`redirectIfUnauthenticated`, returning `{ error }` /
      `{ success: true }`), following `src/actions/media-server.ts`'s shape exactly. Handle all five
      contract errors per `web/plan.md`. → T002, T004, T005, T006
      *Done when:* `bin/cli web npx --no tsc --noEmit` still reports exactly 11 errors across the 4
      known files and not one more; `bin/npm web run lint` on the two new files comes back clean.
- [ ] **T013** `[web] [P]` Create `src/components/media/LanguagePicker.tsx` (shared multi-select +
      save, `useActionState`, inline errors, the shared `Button`, a raw `<input>`/`<select>` rather
      than `InputField`) and `src/components/settings/PreferredLanguagesCard.tsx`; render the card
      on `src/app/(dashboard)/settings/page.tsx` **as its own card, not inside `SettingsForm`**, and
      add `preferredLanguages { id iso2 name }` to `getCurrentUser()`'s `me` document in
      `src/actions/auth.ts`. → T012
      *Done when:* on `/settings`, selecting two languages and saving then reloading shows both
      still selected, and `bin/mysql -e 'select count(*) from user_languages'` returns 2 (AC-9).
- [ ] **T014** `[web] [P]` Add `preferredLanguages { id iso2 name }` to `getMovieById`'s document in
      `src/actions/movies.ts`, extend the local `Movie` type, and render `LanguagePicker` in
      `src/components/movies/Movie.tsx` bound to `setMoviePreferredLanguagesAction`. Do **not** add
      the field to `getMovies()` — it is an `api` field resolver and selecting it in the listing
      turns one query into one per row. → T012, T013
      *Done when:* `/movies/<id>` shows the signed-in user's own selection; signing in as a second
      user who owns the same film shows an empty picker, not the first user's choices (AC-10).
- [ ] **T015** `[web] [P]` The same for series: `getShowById` in `src/actions/shows.ts`, the local
      `Show` type, and `LanguagePicker` in `src/components/shows/Show.tsx` bound to
      `setShowPreferredLanguagesAction`. `Show.tsx` stays a Server Component — the picker is a
      client child. Do **not** add the field to `getShows()`. → T012, T013
      *Done when:* `/shows/<id>` behaves as T014 does for a film, and
      `bin/cli web npx --no tsc --noEmit` still reports exactly 11 errors across 4 files.

### Group 3 — verification and docs

- [ ] **T016** `[docs]` Record the delta in `docs/spec/graphql-contract.md`: the `Language` type and
      `languages` query, `preferredLanguages` on `User`/`Movie`/`Show` (caller's own list, never the
      merge), the three `set*PreferredLanguages` mutations, and `allowedLanguagesIso3` on
      `EncodeJobDetails` — including why `originalLanguageIso3` stays beside it and why the payload
      is ISO-639-2 while the preferences are ISO-639-1. → T007, T011, T015
- [ ] **T017** `[docs]` Update the `CLAUDE.md` files: the root pipeline table's **Transcode** row
      moves from *not started* to *working*, naming the new rule files; `services/api/CLAUDE.md`
      gains `languages/` in the module map, the new migration count and the new test count;
      `services/worker/CLAUDE.md` drops the stale "No tests, and no `vitest.config.ts`" debt entry
      (both exist — `vitest.config.ts` and `src/api/graphql-client.spec.ts` predate this feature)
      and records the three new spec files and the `iso639`/`remux-detection` modules;
      `services/web/CLAUDE.md` records `src/actions/languages.ts`, `LanguagePicker` and the
      re-verified error count. → T016
- [ ] **T018** `[docs]` Run the manual pass in `plan.md` § Verification end to end with
      `ENCODE_SAMPLE_SECONDS` set — a real encode of a multi-track file for AC-1/AC-2/AC-3/AC-8, and
      a file with no original-language audio for AC-4. Then walk every acceptance criterion in
      `spec.md`, tick each box, and set `status: Implemented` on `spec.md`, `plan.md`,
      `api/plan.md`, `web/plan.md` and `worker/plan.md`. → T017

## Blocked

Anything an agent stopped on rather than working around. Empty is the normal state; a non-empty
entry is a decision waiting for a human.

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

Contract problems always land here (Constitution, Article VIII): an agent that finds the GraphQL
delta wrong stops and reports, it does not amend the delta from inside its slice.

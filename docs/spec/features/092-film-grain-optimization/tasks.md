---
title: Film Grain Optimization — Tasks
last_updated: 2026-10-15
status: Done
---

# TASKS: Film Grain Optimization (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` `[infra]` | Which subagent owns the task. Exactly one per task — a task that needs two services is two tasks. |
| `[docs]` | Documentation only. Owned by the orchestrator, not a service agent. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

No `[infra]` task in this feature: nothing about how the stack boots changes, and `.env` gains no
variable — the installation switch is a Settings row, not an environment one.

## Tasks

### Group 1 — contract, schema and resolution (`api`)

Nothing outside this group may start until the field or mutation it consumes exists. The
`## GraphQL Contract Delta` in `spec.md` is frozen (Article VIII): an agent that finds it wrong
stops and files a row under **Blocked**.

- [x] **T001** `[api]` Add `enum GrainMode { INHERIT ON OFF }` to `prisma/schema.prisma` plus
      `grainMode GrainMode @default(INHERIT)` on `Movie` and on `Show`, and generate the migration
      with `bin/npm api run prisma:migrate`. No backfill — the default covers every existing row.
      *Done when:* `git status --short services/api/prisma` shows a modified `schema.prisma` **and**
      exactly one new migration directory, `bin/cli api npx --no prisma migrate status` reports up
      to date, and `bin/mysql -e "select grainMode from movies limit 5"` returns `INHERIT` for every
      pre-existing row.
- [x] **T002** `[api] [P]` Create `src/media/entities/grain-mode.enum.ts` with both GraphQL enums —
      `GrainMode` (`INHERIT`/`ON`/`OFF`) and `EffectiveGrainMode` (`AUTO`/`ON`/`OFF`) — each
      `registerEnumType`d, following `content-kind.enum.ts`'s file shape exactly.
      *Done when:* after a boot, `grep -A4 "^enum GrainMode" services/api/src/schema.gql` and the
      same for `EffectiveGrainMode` both print the three values named in the contract delta.
- [x] **T003** `[api] [P]` Add `grain_auto_enabled: { kind: 'boolean' }` to
      `src/settings/settings.catalog.ts` and `{ key: 'grain_auto_enabled', value: 'false' }` to
      `prisma/seeds/settings.ts` (create-only, beside the two `compression_*` rows).
      *Done when:* on a seeded database `bin/mysql -e "select value from settings where \`key\` =
      'grain_auto_enabled'"` returns `false`, and an `updateSettings` call writing `"maybe"` to that
      key is refused with `error.setting.expected_boolean` while `"true"` is accepted.
- [x] **T004** `[api]` Create `src/settings/grain-mode.ts` with the pure
      `resolveEffectiveGrainMode(titleGrainMode, settingsMap)` — `ON`→`ON`, `OFF`→`OFF`,
      `INHERIT`→`AUTO` only when `settingsMap['grain_auto_enabled'] === 'true'`, else `OFF` — modelled
      on `settings/subtitle-formats.ts`. Add `src/settings/grain-mode.spec.ts` covering all three
      title values against the row present / absent / `'maybe'`, written as fault injection.
      → T002 T003
      *Done when:* `bin/npm api test` is green with the new suite, and flipping the `=== 'true'`
      operator to `!== 'false'` makes the absent-row case fail.
- [x] **T005** `[api] [P]` Film side: `@Field(() => GrainMode) grainMode` on
      `movies/entities/movies.entity.ts`, `MoviesService.setGrainMode(id, userId, grainMode)` cloned
      from `setContentKind` (ownership gate in the service, `withDerivedStatus` on the way out), and
      `MoviesResolver.setMovieGrainMode` with `assertEnabled(MOVIE)` **before** the ownership read.
      Add the ordering case to `movies.resolver.spec.ts`. → T001 T002
      *Done when:* `setMovieGrainMode` flips a film's stored value; calling it for a film the caller
      does not own returns `error.movie.not_found` and `bin/mysql -e "select grainMode from movies
      where id = <id>"` still shows the previous value (**AC-7**); `bin/npm api test` green.
- [x] **T006** `[api] [P]` Series twin: the field on `shows/entities/show.entity.ts`,
      `ShowsService.setGrainMode(id, grainMode)` and `ShowsResolver.setShowGrainMode` — with the
      ownership gate in the **resolver** and `error.show.not_available`, preserving `057`'s
      asymmetry rather than unifying it. → T001 T002
      *Done when:* `setShowGrainMode` flips a series' stored value and is refused with
      `error.show.not_available` for a series the caller does not own; `bin/npm api test` green.
- [x] **T007** `[api]` Add `@Field(() => EffectiveGrainMode) grainMode` to
      `process-jobs/entities/encode-job-details.entity.ts` and resolve it onto `base` in
      `getEncodeJobDetails`, off the `settingsMap` already in hand (NFR-1). The film arm passes
      `movie.grainMode`; **the episode arm passes `show.grainMode`** — the series is already loaded
      for `contentKind`. Add both cases to `process-jobs.service.spec.ts`. → T001 T002 T004
      *Done when:* querying `processJob(id:)` for a film job on `INHERIT` with the setting off
      returns `grainMode: OFF`, with the setting on returns `AUTO`, and an **episode** job of a
      series set to `ON` returns `ON`; the value is resolved per call and stored on no
      `ProcessJob` column (**AC-10**); `bin/npm api test` green.

### Group 2 — consumers (`web` ∥ `worker`)

The two chains share no file and may run concurrently, each internally ordered. T008 and T011 are
pure local additions and depend on nothing in Group 1 — they can start immediately.

- [x] **T008** `[worker] [P]` Create `src/encode/grain-mode.ts` mirroring `encode/content-kind.ts`:
      the local `GrainMode` union, `normalizeGrainMode` (absent, null or unrecognised — **including
      a literal `'INHERIT'`** — degrades to `OFF`, warns once under a `[grain]` prefix, never
      throws), and `resolveFilmGrain(mode, metadata)` returning `ON`→true, `OFF`→false,
      `AUTO`→false while logging the mode it resolved. `metadata` is accepted and unused: it is the
      seam the next spec replaces. Add `src/encode/grain-mode.spec.ts` with the Article IX header.
      *Done when:* `bin/npm worker test` green, with cases pinning `undefined → OFF + warning`,
      `'INHERIT' → OFF + warning`, and `AUTO → false`.
- [x] **T009** `[worker]` Wire it into the job: `grainMode: GrainMode` on `EncodeInput`
      (`src/encode/types.ts`), `grainMode: string` on `encode.job.ts`'s local `EncodeJobDetails`,
      **`grainMode` added to the hand-written query string**, `const grainMode = compressing ?
      normalizeGrainMode(details.grainMode) : 'OFF'`, the value in the existing `[encode]` log line,
      and both `EncodeInput` literals (passthrough and encode) supplying it. → T007 T008
      *Done when:* an encode logs `grainMode=…` on the `[encode]` line; with compression off no
      `[grain]` warning is emitted even for a job whose payload field is missing;
      `bin/cli worker npx --no tsc --noEmit` reports 0 errors.
- [x] **T010** `[worker]` Apply it to the command: `resolveFilmGrain(details.grainMode, metadata)`
      beside the `quality` line in `src/ffmpeg/buildCommand.ts`, and `filmGrain: boolean` threaded
      through `getVideoParams` → `buildAv1EncodeArgs` → `svtav1KindParams`, where each of the three
      `case` arms substitutes its trailing `film-grain=0` for `film-grain=8`,
      `film-grain-denoise=1`. The three arms stay three arms. Extend `src/ffmpeg/params.spec.ts` to
      six cases (each content kind × on/off). → T009
      *Done when:* `bin/npm worker test` green, the on cases asserting both grain terms **and** the
      kind's own terms unchanged, the off cases asserting `film-grain=0` plus
      `not.toContain('film-grain-denoise')` (**AC-1, AC-2, AC-6**).
- [x] **T011** `[web] [P]` Add every new key to `messages/en.json` and `messages/es.json` together:
      the `grainMode` namespace (`INHERIT`/`ON`/`OFF`, where inherit reads as "use the installation
      default", not a bare "inherit"), `settings.compression.grainAutoLabel`, and `grainModeLabel`
      under both `movies.detail` and `shows.detail`. `es` keeps the Rioplatense register.
      *Done when:* `bin/cli web node scripts/check-messages.mjs` confirms the two catalogs match
      exactly, at the new key count.
- [x] **T012** `[web]` Add `GrainMode` + the ordered `GRAIN_MODES` to `src/types/media.ts` and
      create `src/components/media/GrainModeSelect.tsx`, cloned from `ContentKindSelect.tsx` —
      controlled `Select`, local state reverted to the previous value on a refusal, error inline.
      **No `key`-remount trick**: `Select` is controlled, so it would be dead code. → T011
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and Biome is clean on the
      new file.
- [x] **T013** `[web]` Add `grainMode` to the `MovieRecord`/`Show` types and to the two detail
      queries, and add `setMovieGrainModeAction` / `setShowGrainModeAction` to
      `src/actions/movies.ts` and `src/actions/shows.ts`, following the `setMovieContentKindAction`
      shape — enum as a plain variable, never a quoted string; `redirectIfUnauthenticated` then
      `translateGraphQLError`. The **listing** queries must not select the field. → T005 T006
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and a detail page's GraphQL
      response carries `grainMode`.
- [x] **T014** `[web]` Render `<GrainModeSelect>` in `Movie.tsx` and `Show.tsx`, in the right-hand
      column **below the short switch** and above `ContentKindSelect`, unconditional (not gated on
      any capability). `Show.tsx` stays a Server Component. → T012 T013
      *Done when:* both detail pages show the control at its stored value; changing it persists
      across a reload; a refused change reverts the select and shows the translated message inline;
      no episode row anywhere renders a control (**AC-5**).
- [x] **T015** `[web]` Settings: a `grainAutoEnabled` prop plus the `Switch` + hidden-input block
      for `grain_auto_enabled` in `CompressionPanel.tsx` (after the resolution radios, before the
      subtitles section), the prop wired in `SettingsForm.tsx` via
      `getSettingValue("grain_auto_enabled") === "true"`, and the key added to `BOOLEAN_KEYS` in
      `src/actions/settings.ts` — **not** `EDITABLE_KEYS`. When compression is off the switch is
      `disabled` with its state preserved and its hidden input still emitting the stored value.
      → T003 T011
      *Done when:* the switch renders off on an upgraded database and saving writes `false`
      (**AC-9**); with compression off it renders disabled at its stored value and saving the tab
      leaves the row unchanged (**AC-12**); `bin/cli web npx --no tsc --noEmit` reports 0 errors.

### Group 3 — verification and docs

- [ ] **T016** `[docs]` Add a `092-film-grain-optimization` section to
      `docs/spec/graphql-contract.md`: the two-enum split, why `INHERIT` never crosses the wire,
      the two-level resolution living in `api`, and the worker's `AUTO` stub as the next spec's seam.
      → T007 T010 T015
- [ ] **T017** `[docs]` Update the `CLAUDE.md` files the feature changes: the root pipeline table's
      **Transcode** row (the grain branch and its two levels) and **Register title in DB** row (the
      new per-title column), `services/api/CLAUDE.md` (`settings/`, `movies/`, `shows/`,
      `process-jobs/`, and the enum table's count), `services/web/CLAUDE.md` (the detail-page
      header and the Compression tab), `services/worker/CLAUDE.md` (the new `encode/` module and
      the parameter branch). → T016
- [ ] **T018** `[docs]` Run the full verification from `plan.md` § Verification — all four
      typechecks, both test suites, `check-messages.mjs`, `bin/comments` on the three services, the
      `schema.gql` diff against the contract delta — then the nine-step live pass. Walk every
      acceptance criterion in `spec.md`, tick the boxes that pass, and set `status: Implemented` on
      `spec.md`, `plan.md` and the three `<svc>/plan.md`. Append the measurement entry to
      `docs/spec/history.md` (never to a `CLAUDE.md`). → T017

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |

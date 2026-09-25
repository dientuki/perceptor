---
title: Subtitle Format Selection — Tasks
last_updated: 2026-09-25
status: In Progress
---

# TASKS: Subtitle Format Selection (`tasks.md`)

## Legend

| Marker | Meaning |
| :-- | :-- |
| `[api]` `[web]` `[worker]` | Which subagent owns the task. Exactly one per task. |
| `[docs]` | Documentation and the cross-service verification sweep. Owned by the orchestrator. |
| `[P]` | May run in parallel with the other `[P]` tasks in the same group. |
| `→ Tnnn` | Blocked by that task. |

**One task carries a dispatch override.** `T009` is tagged `[worker]` because it lives in
`services/worker/`, but `services/worker/src/ffmpeg/` belongs to the **`ffmpeg` agent**
(`.claude/agents/ffmpeg.md`), not the `worker` agent. Dispatch `T009` to `ffmpeg`. `T008` is the
`worker` agent's and must not touch `src/ffmpeg/`.

**The FFmpeg case corpus is not edited.** `services/worker/ffmpeg/*.json` stays byte-identical;
`cases.spec.ts` defaults to the pre-`070` format set (`['srt','mov_text']`) so its expectations are
the regression proof (`plan.md` § Decisions). The three pre-existing `src/ffmpeg/` failures recorded
in the root `CLAUDE.md` stay out of scope — "no new failures" is the bar, not "all green".

## Tasks

### Group 1 — the contract and settings (`api`) and the settings screen (`web`)

`api` produces the catalog, the validation, the seed rows and the field the worker consumes. `web`
changes no GraphQL shape — only five more keys through `updateSettings` — so it runs beside `api`.

- [x] **T001** `[api] [P]` In `src/settings/settings.catalog.ts`, export
      `SUBTITLE_TEXT_FORMATS = ['srt','ass','webvtt','mov_text'] as const` and
      `SUBTITLE_IMAGE_FORMATS = ['pgs','vobsub','dvb'] as const`, add `'enum_list'` to `SettingKind`,
      and add the five catalog entries (`subtitles_enabled`/`subtitles_text_enabled`/
      `subtitles_image_enabled` as `boolean`; `subtitles_text_formats`/`subtitles_image_formats` as
      `enum_list` with those options). Add `SETTING_EXPECTED_ENUM_LIST: 'error.setting.expected_enum_list'`
      to `src/i18n/error-keys.ts`. In `SettingsService.updateMany`, add the `enum_list` branch
      (split, trim, drop empty, dedupe, reject any id outside `options` with params
      `{ key, options: options.join(', ') }`, store in catalog order) and keep `enum_list` out of the
      value-required check. Extend `src/settings/settings.service.spec.ts`: `srt,pgs` and `srt,foo`
      refused with the new key and no upsert; `""` stored as `""`; `"ass, srt,srt"` stored as `srt,ass`.
      *Done when:* `bin/cli api npx --no tsc --noEmit` reports 0 errors and `bin/npm api run test`
      passes with the new cases counted.
- [x] **T002** `[api]` Create `src/settings/subtitle-formats.ts` exporting the pure
      `resolveAllowedSubtitleFormats(settingsMap: Record<string, string>): string[]` per
      `api/plan.md` step 4 (`subtitles_enabled === 'false'` → `[]`; text on unless exactly `'false'`;
      image on only if exactly `'true'`; missing list row → that group's full catalog; present list
      filtered to its own group's ids; text ids then image ids, catalog order). Add
      `src/settings/subtitle-formats.spec.ts` with the Article IX header and the cases in
      `api/plan.md` § Tests. → T001
      *Done when:* `bin/npm api run test` passes including the new suite.
- [x] **T003** `[api]` Add `@Field(() => [String]) allowedSubtitleFormats: string[];` to
      `src/process-jobs/entities/encode-job-details.entity.ts` after `compressionResolution` (no
      comment, no description). In `ProcessJobsService.getEncodeJobDetails`, add
      `allowedSubtitleFormats: resolveAllowedSubtitleFormats(settingsMap)` to `base` — no second
      `getMap()`. Extend `process-jobs.service.spec.ts` to assert the field on a movie and an episode
      job. → T002
      *Done when:* after the dev server regenerates it, `git diff services/api/src/schema.gql` shows
      exactly one added line, `allowedSubtitleFormats: [String!]!`, inside `type EncodeJobDetails`, and
      `bin/npm api run test` passes.
- [x] **T004** `[api]` In `prisma/seeds/settings.ts`, add the five rows with NFR-1 values
      (`subtitles_enabled=true`, `subtitles_text_enabled=true`,
      `subtitles_text_formats=srt,ass,webvtt,mov_text`, `subtitles_image_enabled=false`,
      `subtitles_image_formats=pgs,vobsub,dvb`), and give the entry shape an optional
      `backfillEmpty: false` that the `existing.value === ''` branch honours, set only on the two list
      rows. → T001
      *Done when:* after `bin/dbreset`,
      `bin/mysql -e "select \`key\`, value from Setting where \`key\` like 'subtitles_%'"` returns the
      five NFR-1 rows (AC-1); after `bin/mysql -e "update Setting set value='' where \`key\`='subtitles_text_formats'"`
      and `docker compose restart api`, the same query still shows `subtitles_text_formats` empty;
      `git status --short services/api/prisma` lists only `prisma/seeds/settings.ts`.
- [x] **T005** `[web] [P]` Add to both `messages/en.json` and `messages/es.json`:
      `settings.compression.subtitles.{label, none, allowText, allowImage}` and
      `errors.setting.expected_enum_list` (en `{key} may only contain: {options}`, es
      `El valor de {key} sólo puede contener: {options}`), Spanish in the existing register.
      *Done when:* `bin/cli web node scripts/check-messages.mjs` reports no `en`/`es` drift.
- [x] **T006** `[web]` Extend `src/components/settings/CompressionPanel.tsx` with the subtitles
      section per `web/plan.md` steps 1–3: local `TEXT_FORMATS`/`IMAGE_FORMATS` with REQ-1 labels,
      five new props, state initialised from them, `Checkbox` controls with no `name`, locking per
      REQ-3 (whole section off with the compression switch; groups and formats off under "no
      subtitles"; a group's formats off with its toggle) without ever clearing state (REQ-4), and
      hidden inputs for the five keys (lists as checked ids in catalog order, possibly `""`). In
      `SettingsForm.tsx`, pass the five values through `getSettingValue`. → T005
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and Settings → Compression
      renders the section with the locking behaviour of AC-2 (before saving). *(tsc/build verified; the visual locking check is deferred to T013.)*
- [x] **T007** `[web] [P]` In `src/actions/settings.ts`, add the three subtitle booleans to
      `BOOLEAN_KEYS` and a `LIST_KEYS` array (`subtitles_text_formats`, `subtitles_image_formats`)
      whose values are always pushed when present in the form — `""` included — never through
      `EDITABLE_KEYS`' blank filter.
      *Done when:* `bin/cli web npx --no tsc --noEmit` reports 0 errors and `bin/npm web run build`
      exits 0.

### Group 2 — the worker consumes the field

Depends on `T003`: selecting `allowedSubtitleFormats` against an `api` without it fails every
`processJob` query.

- [x] **T008** `[worker]` Create `src/encode/subtitle-formats.ts` (`SubtitleFormat` union,
      `SUBTITLE_FORMAT_VALUES`, `DEFAULT_SUBTITLE_FORMATS = ['srt','ass','webvtt','mov_text']`,
      `normalizeSubtitleFormats(raw: unknown)` — non-array → warn + default; array → known ids,
      deduped, warn on dropped unknowns; `[]` → `[]`) modelled on `src/encode/compression-resolution.ts`,
      with `src/encode/subtitle-formats.spec.ts` (Article IX header; cases in `worker/plan.md`
      § Tests). Add `allowedSubtitleFormats: SubtitleFormat[]` to `EncodeInput` (`src/encode/types.ts`).
      In `src/jobs/encode.job.ts`: add the field to the local `EncodeJobDetails` and the `processJob`
      selection, normalize beside `compressionResolution`, append it to the `[encode]` log line, and
      set it in both `EncodeInput` literals. Do not touch `src/ffmpeg/`. → T003
      *Done when:* `bin/npm worker test -- subtitle-formats` passes. (Full typecheck goes green only
      with T009 — `buildCommand.spec.ts`/`cases.spec.ts` build an `EncodeInput`.)
- [x] **T009** `[worker]` **(dispatch to the `ffmpeg` agent)** In `src/ffmpeg/params.ts`, replace
      `TEXT_SUBTITLE_CODECS`/`isTextSubtitle` with a `Record<SubtitleFormat, { group, codecs }>` map
      holding REQ-1's table and rewrite `getSubtitleParams(subtitleStreams, allowedFormats,
      allowedLanguagesIso3, allowedLanguageTags, trackTitles)` per `worker/plan.md` step 5: empty
      list → REQ-11 log and `[]`; filter by language ∧ allowed format ∧ `hasCuePayload`; per language
      S4, S5, then `preferring(langStreams, isImageGroup)` (REQ-9); `-c:s:<n> srt` for text, `copy`
      for image; shared title line; reworded empty-selection log. Pass
      `details.allowedSubtitleFormats` from `buildCommand.ts`. Update existing `params.spec.ts`
      subtitle calls with `['srt','mov_text']`, add the new cases in `worker/plan.md` § Tests, add the
      field to `buildCommand.spec.ts`'s literal, and make `cases.spec.ts` pass
      `input.allowedSubtitleFormats ?? ['srt','mov_text']`. → T008
      *Done when:* `bin/cli worker npx --no tsc --noEmit` reports 0 errors, `bin/npm worker run build`
      exits 0, `bin/npm worker test` fails only the three pre-existing `src/ffmpeg/` cases (same names
      as in the root `CLAUDE.md`), and `git diff --stat services/worker/ffmpeg` is empty.

### Group 3 — docs and verification

- [x] **T010** `[docs] [P]` Add a `070-subtitle-format-selection` section to
      `docs/spec/graphql-contract.md` for `EncodeJobDetails.allowedSubtitleFormats`, in the shape of
      `058`'s: SDL, why `[String!]!` and not an enum, "already effective" semantics, query-time
      resolution, error table (including `error.setting.expected_enum_list`) and consumer
      obligations. → T003
      *Done when:* the section exists and its SDL matches the `schema.gql` diff from T003 exactly.
- [x] **T011** `[docs]` Update the prose that now lies: root `CLAUDE.md` Transcode row (subtitles
      are setting-driven: text → SRT, image copied, text before image per language, ASS typesetting
      flattened) and its spec list; `services/worker/CLAUDE.md` § "Audio/subtitle/quality rules read a
      resolved list" (the format list beside the language pair); `services/api/CLAUDE.md` where it
      lists `SettingKind`s and `getEncodeJobDetails`'s fields; `services/web/CLAUDE.md` where it
      describes the Compression tab; `.claude/agents/ffmpeg.md` § Subtitles — S1 rewritten to the
      REQ-1 catalog filtered by `allowedFormats`, a new rule for REQ-9, and the per-group output codec.
      → T007, T009
      *Done when:* `grep -rn "subrip.*mov_text.*tx3g\|Text codecs only" CLAUDE.md services/*/CLAUDE.md .claude/agents/ffmpeg.md`
      returns nothing that describes the pre-`070` rule as current.
- [ ] **T012** `[docs]` Run the `plan.md` § Verification sweep and record results in the root
      `CLAUDE.md` Current state (AC-11). Then exercise the API-level criteria: AC-4 (both refused
      `updateSettings` calls with an admin token; error key and params; row unchanged) and AC-5
      (hand-edit `subtitles_image_formats` to `pgs,garbage`, enable image, query `processJob` with
      `SERVICE_TOKEN`; `garbage` absent). → T004, T009, T011
      *Done when:* every command in `plan.md` § Verification produces its expected result and AC-4,
      AC-5, AC-11 are observed.
- [ ] **T013** `[docs]` Live manual pass on a running stack (use `ENCODE_SAMPLE_SECONDS`): AC-2
      (locking + reload), AC-3 (empty list via the UI, survives `docker compose restart api`, encode
      has no text track), AC-6 (defaults: ASS → `subrip`, PGS dropped), AC-7 (both groups:
      `spa` SRT + `eng` PGS kept, `spa` PGS dropped), AC-8 (image only: PGS copied with its track
      title), AC-9 ("no subtitles": no subtitle stream, `COMPLETED`, REQ-11 log line), AC-10 (switch to
      "no subtitles" while a job is queued). Inspect outputs with
      `bin/cli worker ffprobe -v error -show_streams -of json <output>`. → T012
      *Done when:* each listed AC is observed as stated in `spec.md`, or recorded under Blocked with
      what was seen instead.
- [ ] **T014** `[docs]` Walk the acceptance criteria in `spec.md`, tick each box that T012/T013
      observed, set `status: Implemented` on `spec.md`, `plan.md` and every `<svc>/plan.md`, and
      `status: Done` here. → T013
      *Done when:* `grep -n "^status" docs/spec/features/070-*/{spec,plan,tasks}.md docs/spec/features/070-*/*/plan.md`
      shows `Implemented`/`Done` everywhere, and any unobserved AC is named in the root `CLAUDE.md`
      Current state as not run.

## AC coverage

| AC | Task |
| :-- | :-- |
| AC-1 | T004 |
| AC-2 | T006 (render), T013 (save + reload) |
| AC-3 | T004 (seed), T007 (web sends `""`), T013 (end to end) |
| AC-4 | T001 (unit), T012 (live) |
| AC-5 | T002 (unit), T012 (live) |
| AC-6 – AC-10 | T009 (unit), T013 (live) |
| AC-11 | T012 |

## Blocked

| Task | Service | What blocked it | Needs |
| :-- | :-- | :-- | :-- |
| T012 (AC-4, AC-5 live), T013 | orchestrator | `bin/dbreset` (run by the api agent for T004) left the app admin without a password and there is no `ProcessJob` row, so an admin token and a `processJob` query are unavailable; the reset step needs an interactive prompt | the user runs `bin/reset-password <admin>`, then a running stack with a real encode |

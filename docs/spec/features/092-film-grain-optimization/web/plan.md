---
title: Film Grain Optimization — web slice
service: web
last_updated: 2026-10-15
status: Implemented
---

# PLAN: Film Grain Optimization — `web` (`web/plan.md`)

## Scope

Two controls and the copy for them: the installation-wide **Automatic Grain Optimization** switch on
Settings → Compression, and the per-title **Grain Optimization** three-value select on a film's and
a series' detail page, below the short switch. Plus the server actions behind the second one and the
`grainMode` field added to the two existing detail queries.

It does **not** decide anything: the precedence between the two controls is `api`'s
(`../api/plan.md`), and `web` never selects `EncodeJobDetails.grainMode` — that field is the
worker's alone. No episode row gets a control (REQ-5).

Writes are confined to `services/web/` and this directory. Anything else is a stop-and-report.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/types/media.ts` | Modified | `GrainMode` type + `GRAIN_MODES` ordered array |
| `services/web/src/components/media/GrainModeSelect.tsx` | New | The controlled three-value select, shared by both detail pages |
| `services/web/src/components/movies/Movie.tsx` | Modified | Render it below the short switch |
| `services/web/src/components/shows/Show.tsx` | Modified | Render it in the same slot |
| `services/web/src/actions/movies.ts` | Modified | `grainMode` on the detail query + `MovieRecord`; `setMovieGrainModeAction` |
| `services/web/src/actions/shows.ts` | Modified | The series twins |
| `services/web/src/components/settings/CompressionPanel.tsx` | Modified | The `Switch` + hidden input for `grain_auto_enabled` |
| `services/web/src/components/settings/SettingsForm.tsx` | Modified | Pass `grainAutoEnabled` into the panel |
| `services/web/src/actions/settings.ts` | Modified | `grain_auto_enabled` in `BOOLEAN_KEYS` |
| `services/web/messages/en.json` | Modified | `grainMode` namespace, `settings.compression.grainAutoLabel`, `grainModeLabel` under both `*.detail` |
| `services/web/messages/es.json` | Modified | The same keys, Rioplatense register |

## Existing code to reuse

- `src/components/media/ContentKindSelect.tsx` — `GrainModeSelect.tsx` is its clone, same directory,
  same reasons: a controlled `Select` with `value`/`onSave`/`label` props, local `selected` state
  reverted to the previous value on a refusal, the error rendered inline as `<p className="text-error-500">`.
  **Do not copy the shorts `Switch`'s `shortSwitchKey` remount trick** — `Select` is controlled, so
  the remount would be dead code from day one. That file's own comment says so; keep the reasoning,
  not a second copy of the prose.
- `src/types/media.ts`'s `CONTENT_KINDS` — the ordered `readonly` array a select maps over. `GRAIN_MODES`
  is `['INHERIT', 'ON', 'OFF']`, inherit first since it is the default.
- `src/actions/movies.ts`'s `setMovieContentKindAction` — the exact action shape, including the
  comment that matters: the enum must reach `fetchGraphQL` as a plain variable typed `GrainMode!`,
  never a quoted string. Same `try`/`catch` → `network.connectionFailed`, same
  `redirectIfUnauthenticated(errors)` then `translateGraphQLError(errors[0])`, same
  `{ error } | { success: true }` return. `src/actions/shows.ts`'s twin likewise.
- `src/components/settings/CompressionPanel.tsx`'s own `compression_enabled` block — `Switch` with
  `defaultChecked`, local state, and a sibling `<input type="hidden" name=... value={x ? "true" : "false"}>`.
  That idiom exists because `Switch` renders no `name`d input of its own; copy it verbatim.
- The same file's `sectionOn` / `textFormatsOn` / `imageFormatsOn` booleans — the panel's existing
  "locking only disables, never clears" rule (`070`). The grain switch locks off the same `enabled`
  state, by the same mechanism; do not invent a second one.
- `src/actions/settings.ts`'s `BOOLEAN_KEYS` — adding the key there is the whole persistence change.
  It must **not** go in `EDITABLE_KEYS`, whose blank-value filter is for text fields.
- `SettingsForm.tsx`'s `getSettingValue("compression_enabled") === "true"` — the prop-passing line to
  clone. `=== "true"` is also the correct read here on its own merits (REQ-2's default-off).
- `src/components/form/Label.tsx` and `src/components/form/Select.tsx` — already used by
  `ContentKindSelect`; no new form primitive.

## Steps

1. `src/types/media.ts`: `export type GrainMode = "INHERIT" | "ON" | "OFF"` and
   `export const GRAIN_MODES: readonly GrainMode[]` in that order.
2. New `src/components/media/GrainModeSelect.tsx`, cloned from `ContentKindSelect.tsx`, options
   labelled from a `grainMode.*` catalog namespace.
3. `src/actions/movies.ts`: add `grainMode: GrainMode` to the `MovieRecord` type and `grainMode` to
   the detail query's field list; add `SET_MOVIE_GRAIN_MODE_MUTATION` and
   `setMovieGrainModeAction(movieId: number, grainMode: GrainMode)`.
4. `src/actions/shows.ts`: the same three additions for the series.
5. `Movie.tsx`: bind the action and render `<GrainModeSelect>` in the right-hand column —
   **below the short switch**, above `ContentKindSelect` (REQ-3). The short switch is wrapped in
   `{shortsEnabled && …}`; the grain select is **not** conditional on anything.
6. `Show.tsx`: render it in the same slot. `Show.tsx` stays a Server Component — `GrainModeSelect`
   is the `"use client"` boundary, exactly as `ContentKindSelect` already is there.
7. `CompressionPanel.tsx`: add a `grainAutoEnabled: boolean` prop and a `Switch` + hidden-input
   block for `grain_auto_enabled`. Place it after the resolution radio group and before the
   subtitles section. It is a single yes/no with no sub-options (REQ-1), and it follows the
   **locking rule this panel already implements** for the subtitle controls: when the panel's
   `enabled` state is false the switch is `disabled`, its state is **not** cleared, and the hidden
   input keeps emitting the stored value — so turning compression back on restores the
   administrator's choice untouched (REQ-10). Clearing it, or dropping the hidden input while
   disabled, would silently rewrite the row on the next save of any unrelated tab — the same trap
   `SchedulingPanel.tsx` documents for an unavailable task's `schedule_<id>_enabled`.
8. `SettingsForm.tsx`: pass `grainAutoEnabled={getSettingValue("grain_auto_enabled") === "true"}`.
9. `src/actions/settings.ts`: add `"grain_auto_enabled"` to `BOOLEAN_KEYS`.
10. Both message catalogs: a `grainMode` namespace (`INHERIT`/`ON`/`OFF` labels — inherit should
    read as "use the installation default", not a bare "inherit"), `settings.compression.grainAutoLabel`,
    and `grainModeLabel` under both `movies.detail` and `shows.detail`. Add every key to `en.json`
    and `es.json` together; `scripts/check-messages.mjs` fails on drift.

## Contract obligations

Consumed from `../spec.md` § GraphQL Contract Delta, read-only. There is no codegen — every line
below is hand-retyped and nothing checks it:

- `Movie.grainMode: GrainMode!` and `Show.grainMode: GrainMode!`, selected in the two detail
  queries only. The **listing** queries (`getMovies`/`getShows`) must not select it — no reason to,
  and that directory's rule about listing selections exists for the field resolvers.
- `setMovieGrainMode(movieId: Int!, grainMode: GrainMode!): Movie!` and
  `setShowGrainMode(showId: Int!, grainMode: GrainMode!): Show!`. The mutation selects `{ id }`
  only, as the `contentKind` twins do.
- Every error condition, all four of which must be handled rather than assumed away:
  | Key | When | What this slice does |
  | :-- | :-- | :-- |
  | `error.movie.not_found` | film absent or not owned | revert the select, render the translated message inline |
  | `error.show.not_available` | series absent or not owned | same |
  | `error.media.type_disabled` | the type's switch was flipped off between render and submit | same — this is the race `045` left `web` to absorb; the catalog key already exists |
  | `error.setting.expected_boolean` | a `grain_auto_enabled` write that is not `"true"`/`"false"` | unreachable from this UI (the hidden input emits one of the two literals), but it surfaces through `updateSettingsAction`'s existing error path with no new code |
  Plus the unauthenticated path: `redirectIfUnauthenticated(errors)` before reading the message, as
  every mutating action in `src/actions/` already does.
- `web` must **not** select `EncodeJobDetails.grainMode`, and must not read `grain_auto_enabled` to
  predict what `INHERIT` will resolve to — `api` owns that precedence and a second copy of the rule
  here would be a second place to get it wrong.

## Tests

**None, and that is the standing position for this service** — there is no test file, no runner and
no `test` script, and introducing one is its own spec (see `services/web/CLAUDE.md` § "Tests: there
are none"). Do not add Vitest or Playwright as a side effect of this feature.

The gate here is the typecheck, `scripts/check-messages.mjs` for catalog parity, Biome on the files
touched (never the repo — it reports ~1519 pre-existing errors), and actually opening the two detail
pages and the Settings tab. The one failure this slice could produce silently is a missing
translation key, which is exactly what `check-messages.mjs` is for.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
bin/comments web
```

Typecheck 0 errors, the build exiting 0, the two catalogs matching exactly, and the comment gate
clean. **Do not run `bin/npm web run build` while the dev stack is up** — it clobbers the dev
`.next` and un-hydrates every page.

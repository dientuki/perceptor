---
title: Subtitle Format Selection — web slice
service: web
last_updated: 2026-09-25
status: Approved
---

# PLAN: Subtitle Format Selection — `web` (`web/plan.md`)

## Scope

`web` renders the subtitles section of Settings → Compression and persists its five settings through
the existing `updateSettings` flow. It does **not** resolve the effective list (that is `api`) and
never selects `EncodeJobDetails.allowedSubtitleFormats`.

Writes are confined to `services/web/` and this directory. Read `../spec.md` (REQ-2 … REQ-6, NFR-6,
§ GraphQL Contract Delta) and `../plan.md` first.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/web/src/components/settings/CompressionPanel.tsx` | Modified | Subtitles section: state, locking, hidden inputs. |
| `services/web/src/components/settings/SettingsForm.tsx` | Modified | Pass the five setting values into `CompressionPanel`. |
| `services/web/src/actions/settings.ts` | Modified | Three keys into `BOOLEAN_KEYS`; a list-key path that always sends the value, empty included. |
| `services/web/messages/en.json`, `es.json` | Modified | `settings.compression.subtitles.*` labels; `errors.setting.expected_enum_list`. |

## Existing code to reuse

- `CompressionPanel.tsx` itself — its pattern is the one to extend: `useState` initialised from
  props, controls without a `name` (see the comment on the radios about successful controls), one
  hidden input per persisted key, `disabled={!enabled}` tied to the compression switch, greyed label
  classes when disabled.
- `components/form/input/Checkbox.tsx` — controlled, renders no named input; used for "no subtitles",
  both group toggles and all seven format checkboxes.
- `BOOLEAN_KEYS` in `actions/settings.ts` — the explicit `'true'/'false'` read by hidden-input value;
  add the three boolean keys there.
- `translateGraphQLError` (`src/lib/graphql-error.ts`) — already interpolates `params` since the
  `059` fix; the new error key only needs catalog entries.
- `getSettingValue` in `SettingsForm.tsx` — how the other compression values reach the panel.

## Steps

1. `CompressionPanel.tsx`: local constants `TEXT_FORMATS = ['srt','ass','webvtt','mov_text']` and
   `IMAGE_FORMATS = ['pgs','vobsub','dvb']` with display labels from REQ-1 (`SRT`, `ASS / SSA`,
   `WebVTT`, `MP4 text`, `PGS (Blu-ray)`, `VobSub (DVD)`, `DVB` — not translated). New props:
   `subtitlesEnabled`, `subtitlesTextEnabled`, `subtitlesTextFormats` (string), `subtitlesImageEnabled`,
   `subtitlesImageFormats` (string). Parse each list by splitting on `,`, keeping only known ids.
2. State: `noSubtitles` (inverse of `subtitlesEnabled`), `textEnabled`, `imageEnabled`, and a `Set`
   per group. Disabled rules (REQ-3): whole section when `!enabled`; groups and formats when
   `noSubtitles`; a group's formats when that group is off. Disabling never mutates the underlying
   state (REQ-4).
3. Hidden inputs: `subtitles_enabled` = `noSubtitles ? 'false' : 'true'`; the two group booleans;
   `subtitles_text_formats`/`subtitles_image_formats` = checked ids in catalog order joined by `,`
   (possibly `""`).
4. `SettingsForm.tsx`: pass the five values via `getSettingValue`, the booleans compared to `"true"`
   exactly as `compression_enabled` is.
5. `actions/settings.ts`: add the three booleans to `BOOLEAN_KEYS`; add a `LIST_KEYS` array with the
   two format keys, pushed as `{ key, value: formData.get(key) ?? "" }` when the field is present in
   the form (a `string`), **not** passed through `EDITABLE_KEYS`' blank filter (REQ-5, risk "web
   filters the empty list out").
6. Messages: in both catalogs, `settings.compression.subtitles.{label, none, allowText, allowImage}`
   and `errors.setting.expected_enum_list` (en `{key} may only contain: {options}` /
   es `El valor de {key} sólo puede contener: {options}`). Spanish copy in the existing Rioplatense
   register.

## Contract obligations

Consumes only `settings`/`updateSettings`, shapes unchanged. Must send all five keys on every Save of
the Settings form, the lists as comma-joined ids including the empty string. Must surface
`error.setting.expected_enum_list` through `translateGraphQLError` with `{ key, options }` (only
reachable if the local list and `api`'s catalog drift), and the existing
`error.setting.expected_boolean`. Never selects `allowedSubtitleFormats`. The delta is read-only.

## Tests

`web` has no test suite (see `services/web/CLAUDE.md`). The silent failure in this slice — an empty
list dropped before reaching `api` — is covered by AC-3's manual check against the database. Nothing
here is owed an automated test beyond typecheck, build and message-drift.

## Done when

```bash
bin/cli web npx --no tsc --noEmit
bin/npm web run build
bin/cli web node scripts/check-messages.mjs
```

0 typecheck errors, build exits 0, no `en`/`es` drift.
